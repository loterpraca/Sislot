(function () {
  'use strict';

  const CONFIG = window.SISLOT_CONFIG || {};
  if (!window.supabase || !CONFIG.url || !CONFIG.anonKey) {
    document.addEventListener('DOMContentLoaded', () => showAlert('Configuração do Supabase não encontrada. Confira sislot-config.js.'));
    return;
  }

  const sb = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
  const $ = (id) => document.getElementById(id);
  const fmtMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtInt = new Intl.NumberFormat('pt-BR');
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const state = {
    session: null,
    usuario: null,
    lotericas: [],
    perfis: [],
    boloes: [],
    monitoramentos: new Map(),
    matches: [],
    loading: false
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindUI();
    startClock();
    try {
      await validarSessao();
      await carregarTudo();
    } catch (error) {
      console.error('[Radar Marketplace] erro inicial:', error);
      showAlert(error.message || 'Não foi possível iniciar o Radar.');
      setStatus('Erro ao carregar', 'Confira sessão, permissões e console do navegador.');
    }
  }

  function bindUI() {
    $('btnLogout')?.addEventListener('click', async () => {
      if (window.SISLOT_SECURITY?.sair) return window.SISLOT_SECURITY.sair();
      await sb.auth.signOut();
      location.href = './login.html';
    });
    $('btnAtualizarRadar')?.addEventListener('click', () => carregarTudo());
    $('btnNovaLoterica')?.addEventListener('click', () => abrirLoterica());
    $('btnNovoPerfil')?.addEventListener('click', () => abrirPerfil());
    $('btnNovoPerfil2')?.addEventListener('click', () => abrirPerfil());
    $('formQuickAdd')?.addEventListener('submit', quickAddLoterica);
    $('formLoterica')?.addEventListener('submit', salvarLoterica);
    $('formPerfil')?.addEventListener('submit', salvarPerfil);

    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => ativarAba(btn.dataset.tab)));
    document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => fecharModal(btn.dataset.closeModal)));
    document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) fecharModal(modal.id); }));
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.modal:not([hidden])').forEach(m => fecharModal(m.id));
    });

    ['filtroRadarLoterica', 'filtroRadarModalidade', 'filtroRadarPerfil', 'filtroClassificacao', 'filtroSomenteAtivas', 'mostrarTodosBoloes', 'ordenacaoAchados']
      .forEach(id => $(id)?.addEventListener('change', () => renderTudo()));

    document.addEventListener('click', async e => {
      const editLot = e.target.closest('[data-edit-loterica]');
      if (editLot) return abrirLoterica(editLot.dataset.editLoterica);

      const toggleLot = e.target.closest('[data-toggle-loterica]');
      if (toggleLot) return toggleLoterica(toggleLot.dataset.toggleLoterica);

      const favoriteLot = e.target.closest('[data-favorite-loterica]');
      if (favoriteLot) return favoritarLoterica(favoriteLot.dataset.favoriteLoterica);

      const editPerfil = e.target.closest('[data-edit-perfil]');
      if (editPerfil) return abrirPerfil(editPerfil.dataset.editPerfil);

      const togglePerfil = e.target.closest('[data-toggle-perfil]');
      if (togglePerfil) return togglePerfilAtivo(togglePerfil.dataset.togglePerfil);

      const monitorBtn = e.target.closest('[data-monitor-bolao]');
      if (monitorBtn) return acompanharBolao(monitorBtn.dataset.monitorBolao, monitorBtn);
    });
  }

  function startClock() {
    const update = () => {
      const now = new Date();
      if ($('relogio')) $('relogio').textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR');
    };
    update();
    setInterval(update, 1000);
  }

  async function validarSessao() {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) throw new Error(error.message || 'Erro ao verificar sessão.');
    if (!session?.user?.id) {
      location.href = './login.html';
      throw new Error('Sessão do SISLOT não encontrada.');
    }
    state.session = session;
    if (window.SISLOT_SECURITY?.validarUsuarioLogavel) {
      state.usuario = await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
    } else {
      state.usuario = { nome: session.user.email || 'Usuário' };
    }
  }

  async function carregarTudo(silencioso = false) {
    if (state.loading) return;
    state.loading = true;
    if (!silencioso) setStatus('Atualizando Radar', 'Consultando lotéricas, perfis e bolões atuais...');
    showAlert('');
    try {
      const [lotericas, perfis, monitoramentos] = await Promise.all([
        buscarLotericas(), buscarPerfis(), buscarMonitoramentosSeguro()
      ]);
      state.lotericas = lotericas;
      state.perfis = perfis;
      state.monitoramentos = new Map((monitoramentos || []).map(m => [String(m.codigo_bolao_caixa), m]));
      state.boloes = await buscarBoloesRadar(lotericas.filter(l => l.ativo).map(l => l.codigo_loterica));
      montarMatches();
      montarFiltros();
      renderTudo();
      setStatus('Radar atualizado', `${state.lotericas.filter(l => l.ativo).length} lotéricas ativas · ${state.boloes.length} bolões capturados no escopo`);
    } catch (error) {
      console.error('[Radar Marketplace] falha ao carregar:', error);
      showAlert(error.message || 'Falha ao consultar os dados do Radar.');
      setStatus('Erro no Radar', error.message || 'Falha ao consultar Supabase.');
    } finally {
      state.loading = false;
    }
  }

  async function buscarLotericas() {
    const { data, error } = await sb.from('marketplace_radar_lotericas').select('*').order('prioridade', { ascending: true }).order('codigo_loterica', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function buscarPerfis() {
    const { data, error } = await sb.from('marketplace_radar_perfis').select('*').order('ativo', { ascending: false }).order('nome', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function buscarBoloesRadar(codigos) {
    if (!codigos.length) return [];
    const rows = [];
    const chunkSize = 100;
    for (let i = 0; i < codigos.length; i += chunkSize) {
      const lote = codigos.slice(i, i + chunkSize);
      const { data, error } = await sb
        .from('marketplace_caixa_boloes')
        .select('codigo_bolao_caixa,codigo_loterica,nome_loteria,razao_social,municipio,uf,modalidade,concurso,dt_sorteio,qtd_apostas,qtd_numeros,qtd_trevos,qtd_cota_total,qtd_cota_digital,qtd_cota_disponivel,valor_cota,valor_cota_sem_tarifa,status_marketplace,primeira_coleta_em,ultima_coleta_em,contem_residuo')
        .in('codigo_loterica', lote)
        .eq('status_marketplace', 'ATIVO')
        .order('ultima_coleta_em', { ascending: false })
        .limit(5000);
      if (error) throw error;
      rows.push(...(data || []));
    }
    return dedupe(rows, row => String(row.codigo_bolao_caixa));
  }

  async function buscarMonitoramentosSeguro() {
    const { data, error } = await sb.from('marketplace_caixa_detalhe_monitoramentos').select('codigo_bolao_caixa,intervalo_minutos,ativo');
    if (error) {
      console.warn('[Radar Marketplace] monitoramentos indisponíveis:', error.message);
      return [];
    }
    return data || [];
  }

  function montarMatches() {
    const ativos = state.perfis.filter(p => p.ativo);
    state.matches = state.boloes.map(b => {
      const matched = ativos.filter(p => bolaoCombinaPerfil(b, p));
      return { ...b, perfis_match: matched, score: matched.length };
    });
  }

  function bolaoCombinaPerfil(b, p) {
    if (p.modalidade && normalize(p.modalidade) !== normalize(b.modalidade)) return false;
    if (!within(b.qtd_numeros, p.qtd_numeros_min, p.qtd_numeros_max)) return false;
    if (!within(b.qtd_apostas, p.qtd_apostas_min, p.qtd_apostas_max)) return false;
    if (!within(b.valor_cota, p.valor_cota_min, p.valor_cota_max)) return false;
    if (!within(b.qtd_cota_total, p.qtd_cotas_min, p.qtd_cotas_max)) return false;
    return true;
  }

  function within(value, min, max) {
    if (min == null && max == null) return true;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (min != null && n < Number(min)) return false;
    if (max != null && n > Number(max)) return false;
    return true;
  }

  function montarFiltros() {
    const lotSelect = $('filtroRadarLoterica');
    const lotCurrent = lotSelect?.value || '';
    if (lotSelect) {
      lotSelect.innerHTML = '<option value="">Todas</option>' + state.lotericas.filter(l => l.ativo).map(l => `<option value="${esc(l.codigo_loterica)}">${esc(l.apelido ? `${l.apelido} · ${l.codigo_loterica}` : l.codigo_loterica)}</option>`).join('');
      lotSelect.value = state.lotericas.some(l => l.codigo_loterica === lotCurrent) ? lotCurrent : '';
    }

    const modalities = [...new Set(state.boloes.map(b => b.modalidade).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
    const modSelect = $('filtroRadarModalidade');
    const modCurrent = modSelect?.value || '';
    if (modSelect) {
      modSelect.innerHTML = '<option value="">Todas</option>' + modalities.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
      modSelect.value = modalities.includes(modCurrent) ? modCurrent : '';
    }

    const profileSelect = $('filtroRadarPerfil');
    const profileCurrent = profileSelect?.value || '';
    if (profileSelect) {
      profileSelect.innerHTML = '<option value="">Todos</option>' + state.perfis.filter(p => p.ativo).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
      profileSelect.value = state.perfis.some(p => String(p.id) === profileCurrent) ? profileCurrent : '';
    }

    const perfilModalidade = $('perfilModalidade');
    const perfilModCurrent = perfilModalidade?.value || '';
    if (perfilModalidade) {
      const baseMods = [...new Set([...modalities, 'MEGA_SENA', 'LOTOFACIL', 'QUINA', 'TIMEMANIA', 'DUPLA_SENA', 'DIA_DE_SORTE', 'SUPER_SETE', 'MILIONARIA'])].sort();
      perfilModalidade.innerHTML = '<option value="">Qualquer</option>' + baseMods.map(m => `<option value="${esc(m)}">${esc(m.replaceAll('_',' '))}</option>`).join('');
      perfilModalidade.value = perfilModCurrent;
    }
  }

  function renderTudo() {
    renderStats();
    renderLotericas();
    renderPerfis();
    renderAchados();
  }

  function renderStats() {
    const ativas = state.lotericas.filter(l => l.ativo);
    const favoritas = ativas.filter(l => l.classificacao === 'FAVORITA');
    const perfisAtivos = state.perfis.filter(p => p.ativo);
    const matches = state.matches.filter(b => b.score > 0);
    const monitorados = state.matches.filter(b => state.monitoramentos.get(String(b.codigo_bolao_caixa))?.ativo);
    setText('statRadarLotericas', ativas.length);
    setText('statRadarFavoritas', favoritas.length);
    setText('statRadarPerfis', perfisAtivos.length);
    setText('statRadarBoloes', state.boloes.length);
    setText('statRadarAchados', perfisAtivos.length ? matches.length : '—');
    setText('statRadarMonitorados', monitorados.length);
    setText('tabAchadosCount', perfisAtivos.length ? matches.length : state.boloes.length);
  }

  function renderLotericas() {
    const grid = $('radarLotericasGrid');
    if (!grid) return;
    const classFilter = $('filtroClassificacao')?.value || '';
    const onlyActive = $('filtroSomenteAtivas')?.checked ?? true;
    const counts = contarBoloesPorLoterica();
    let rows = state.lotericas.filter(l => (!classFilter || l.classificacao === classFilter) && (!onlyActive || l.ativo));

    if (!rows.length) {
      grid.innerHTML = emptyHtml('fa-satellite-dish', 'Nenhuma lotérica no Radar', 'Digite um código lotérico acima para começar o mapeamento.');
      return;
    }

    grid.innerHTML = rows.map(l => {
      const count = counts.get(String(l.codigo_loterica)) || { total: 0, matches: 0 };
      const aderencia = count.total ? Math.round((count.matches / count.total) * 100) : 0;
      const scan = l.ultima_varredura_em ? fmtDateTime(l.ultima_varredura_em) : 'ainda não varrida';
      return `<article class="radar-loterica-card" data-class="${esc(l.classificacao)}">
        <div class="radar-loterica-head">
          <div class="radar-code-wrap">
            <div class="radar-code-icon"><i class="fas fa-tower-broadcast"></i></div>
            <div><div class="radar-loterica-code">${esc(l.codigo_loterica)}</div><div class="radar-loterica-alias">${esc(l.apelido || l.observacao || 'Sem apelido')}</div></div>
          </div>
          <span class="radar-class-pill ${esc(l.classificacao)}">${rotuloClassificacao(l.classificacao)}</span>
        </div>
        <div class="radar-loterica-meta">
          ${metaBox('Bolões atuais', count.total)}
          ${metaBox('Aderentes', state.perfis.some(p=>p.ativo) ? count.matches : '—')}
          ${metaBox('Aderência', state.perfis.some(p=>p.ativo) ? `${aderencia}%` : '—')}
          ${metaBox('Intervalo', `${l.intervalo_minutos || 180} min`)}
        </div>
        <div class="radar-loterica-foot">
          <div class="radar-last-scan"><i class="far fa-clock"></i> ${esc(scan)}${l.ultimo_status ? ` · ${esc(l.ultimo_status)}` : ''}</div>
          <div class="radar-card-actions">
            <button class="radar-icon-btn" type="button" data-favorite-loterica="${l.id}" title="Marcar como favorita"><i class="${l.classificacao === 'FAVORITA' ? 'fas' : 'far'} fa-star"></i></button>
            <button class="radar-icon-btn" type="button" data-edit-loterica="${l.id}" title="Editar"><i class="fas fa-pen"></i></button>
            <button class="radar-icon-btn ${l.ativo ? 'danger' : ''}" type="button" data-toggle-loterica="${l.id}" title="${l.ativo ? 'Desativar' : 'Ativar'}"><i class="fas fa-${l.ativo ? 'pause' : 'play'}"></i></button>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  function contarBoloesPorLoterica() {
    const map = new Map();
    for (const b of state.matches) {
      const key = String(b.codigo_loterica);
      if (!map.has(key)) map.set(key, { total: 0, matches: 0 });
      const obj = map.get(key);
      obj.total += 1;
      if (b.score > 0) obj.matches += 1;
    }
    return map;
  }

  function renderPerfis() {
    const grid = $('radarPerfisGrid');
    if (!grid) return;
    if (!state.perfis.length) {
      grid.innerHTML = emptyHtml('fa-filter-circle-dollar', 'Nenhum perfil criado', 'Crie um perfil para o Radar começar a medir aderência entre as lotéricas.');
      return;
    }
    grid.innerHTML = state.perfis.map(p => {
      const count = state.matches.filter(b => b.perfis_match.some(x => x.id === p.id)).length;
      return `<article class="radar-perfil-card ${p.ativo ? '' : 'inactive'}">
        <div class="radar-perfil-head"><div><div class="radar-perfil-title">${esc(p.nome)}</div><div class="radar-perfil-mod">${esc(p.modalidade || 'QUALQUER MODALIDADE')}</div></div><span class="pill ${p.ativo ? 'ok' : ''}">${p.ativo ? 'ATIVO' : 'PAUSADO'}</span></div>
        <div class="radar-perfil-criteria">${criteriaFor(p)}</div>
        <div class="radar-perfil-note">${esc(p.observacao || 'Sem observação.')}</div>
        <div class="radar-perfil-foot"><span class="radar-match-count"><i class="fas fa-bullseye"></i> ${count} achado(s) atual(is)</span><div class="radar-card-actions"><button class="radar-icon-btn" type="button" data-edit-perfil="${p.id}" title="Editar"><i class="fas fa-pen"></i></button><button class="radar-icon-btn" type="button" data-toggle-perfil="${p.id}" title="${p.ativo ? 'Pausar' : 'Ativar'}"><i class="fas fa-${p.ativo ? 'pause' : 'play'}"></i></button></div></div>
      </article>`;
    }).join('');
  }

  function criteriaFor(p) {
    const chips = [];
    pushRange(chips, 'Dezenas', p.qtd_numeros_min, p.qtd_numeros_max);
    pushRange(chips, 'Jogos', p.qtd_apostas_min, p.qtd_apostas_max);
    pushRange(chips, 'Cotas', p.qtd_cotas_min, p.qtd_cotas_max);
    if (p.valor_cota_min != null || p.valor_cota_max != null) {
      const a = p.valor_cota_min != null ? fmtMoney.format(Number(p.valor_cota_min)) : '—';
      const b = p.valor_cota_max != null ? fmtMoney.format(Number(p.valor_cota_max)) : '—';
      chips.push(`<span class="criteria-chip">Cota <strong>${esc(a)} → ${esc(b)}</strong></span>`);
    }
    return chips.length ? chips.join('') : '<span class="criteria-chip">Sem restrições numéricas</span>';
  }

  function pushRange(chips, label, min, max) {
    if (min == null && max == null) return;
    chips.push(`<span class="criteria-chip">${label} <strong>${min ?? '—'} → ${max ?? '—'}</strong></span>`);
  }

  function renderAchados() {
    const grid = $('radarAchadosGrid');
    if (!grid) return;
    const loteria = $('filtroRadarLoterica')?.value || '';
    const modalidade = $('filtroRadarModalidade')?.value || '';
    const perfilId = $('filtroRadarPerfil')?.value || '';
    const showAll = $('mostrarTodosBoloes')?.checked || !state.perfis.some(p => p.ativo);
    const ordering = $('ordenacaoAchados')?.value || 'ADERENCIA';

    let rows = state.matches.filter(b => {
      if (loteria && String(b.codigo_loterica) !== String(loteria)) return false;
      if (modalidade && b.modalidade !== modalidade) return false;
      if (perfilId && !b.perfis_match.some(p => String(p.id) === String(perfilId))) return false;
      if (!showAll && b.score === 0) return false;
      return true;
    });

    rows.sort((a,b) => compareAchados(a,b,ordering));
    const totalMatch = rows.filter(r => r.score > 0).length;
    setText('radarAchadosResumo', state.perfis.some(p=>p.ativo)
      ? `${rows.length} bolão(ões) exibido(s) · ${totalMatch} aderente(s) aos perfis ativos.`
      : 'Nenhum perfil ativo: mostrando todos os bolões atuais das lotéricas do Radar.');

    if (!rows.length) {
      grid.innerHTML = emptyHtml('fa-crosshairs', 'Nenhum achado com estes filtros', 'Ajuste os filtros, cadastre mais lotéricas ou amplie os perfis de interesse.');
      return;
    }

    grid.innerHTML = rows.slice(0, 1000).map(b => {
      const monitor = state.monitoramentos.get(String(b.codigo_bolao_caixa));
      const monitored = !!monitor?.ativo;
      const lot = state.lotericas.find(l => String(l.codigo_loterica) === String(b.codigo_loterica));
      return `<article class="radar-achado-card ${b.score ? 'match' : ''}">
        <div class="radar-achado-head"><div><span class="radar-achado-mod">${esc(b.modalidade || '—')}</span><div class="radar-achado-title">Concurso ${esc(b.concurso || '—')} <small>· ${esc(lot?.apelido || b.nome_loteria || b.codigo_loterica)}</small></div></div><div class="radar-achado-price">${moneyOrDash(b.valor_cota)}</div></div>
        <div class="radar-achado-meta">${metaBox('Dezenas', valueOrDash(b.qtd_numeros))}${metaBox('Jogos', valueOrDash(b.qtd_apostas))}${metaBox('Cotas', valueOrDash(b.qtd_cota_total))}${metaBox('Disponíveis', valueOrDash(b.qtd_cota_disponivel))}</div>
        <div class="radar-achado-profiles">${b.perfis_match.length ? b.perfis_match.map(p => `<span class="profile-match-chip"><i class="fas fa-bullseye"></i>${esc(p.nome)}</span>`).join('') : '<span class="profile-no-match">Sem correspondência com os perfis ativos</span>'}</div>
        <div class="radar-achado-foot"><div class="radar-achado-code">${esc(b.codigo_loterica)} · ${esc(b.codigo_bolao_caixa)} · ${fmtDateTime(b.ultima_coleta_em)}</div><button class="btn-monitor-radar ${monitored ? 'monitored' : ''}" type="button" data-monitor-bolao="${esc(b.codigo_bolao_caixa)}"><i class="${monitored ? 'fas fa-star' : 'far fa-star'}"></i>${monitored ? `${monitor.intervalo_minutos} min` : 'Acompanhar'}</button></div>
      </article>`;
    }).join('');
  }

  function compareAchados(a,b,ordering) {
    if (ordering === 'RECENTE') return dateValue(b.ultima_coleta_em) - dateValue(a.ultima_coleta_em);
    if (ordering === 'PRECO_ASC') return num(a.valor_cota, Infinity) - num(b.valor_cota, Infinity);
    if (ordering === 'PRECO_DESC') return num(b.valor_cota, -Infinity) - num(a.valor_cota, -Infinity);
    if (ordering === 'DEZENAS_DESC') return num(b.qtd_numeros, -Infinity) - num(a.qtd_numeros, -Infinity);
    return b.score - a.score || dateValue(b.ultima_coleta_em) - dateValue(a.ultima_coleta_em);
  }

  async function quickAddLoterica(event) {
    event.preventDefault();
    const input = $('quickCodigoLoterica');
    const codigo = onlyDigits(input?.value);
    if (!codigo) return showAlert('Informe um código lotérico válido.');
    if (state.lotericas.some(l => l.codigo_loterica === codigo)) return showAlert(`A lotérica ${codigo} já está cadastrada no Radar.`);
    try {
      setQuickLoading(true);
      const solicitadoEm = new Date().toISOString();
      const { error } = await sb.from('marketplace_radar_lotericas').insert({
        codigo_loterica: codigo,
        classificacao: 'TESTE',
        prioridade: 3,
        intervalo_minutos: 180,
        ativo: true,
        proxima_varredura_em: solicitadoEm,
        ultimo_status: 'PENDENTE',
        ultimo_erro: null
      });
      if (error) throw error;
      input.value = '';
      await carregarTudo(true);
      showToast(`Lotérica ${codigo} adicionada. Buscando agora...`);
      void aguardarPrimeiraVarredura(codigo, solicitadoEm);
    } catch (error) { showAlert(humanDbError(error)); }
    finally { setQuickLoading(false); }
  }

  async function aguardarPrimeiraVarredura(codigo, solicitadoEm) {
    const inicio = Date.parse(solicitadoEm || '') || Date.now();
    const maxTentativas = 30;

    for (let tentativa = 0; tentativa < maxTentativas; tentativa += 1) {
      await wait(2000);

      const { data, error } = await sb
        .from('marketplace_radar_lotericas')
        .select('codigo_loterica,ultima_varredura_em,ultimo_status,ultimo_erro,ultimo_total_boloes')
        .eq('codigo_loterica', codigo)
        .maybeSingle();

      if (error || !data) continue;

      const status = String(data.ultimo_status || '').toUpperCase();
      const varreduraEm = Date.parse(data.ultima_varredura_em || '') || 0;
      const finalizado = status && status !== 'PENDENTE' && (varreduraEm >= inicio - 1000 || status === 'ERRO' || status === 'COBERTA_MONITORAMENTO');

      if (!finalizado) continue;

      await carregarTudo(true);

      if (status === 'ERRO') {
        showAlert(`A primeira busca da lotérica ${codigo} falhou: ${data.ultimo_erro || 'erro não informado'}.`);
        return;
      }

      const total = Number(data.ultimo_total_boloes);
      if (Number.isFinite(total)) {
        showToast(`Radar atualizado: ${codigo} · ${fmtInt.format(total)} bolão(ões) encontrado(s).`);
      } else {
        showToast(`Radar atualizado: primeira busca da lotérica ${codigo} concluída.`);
      }
      return;
    }

    await carregarTudo(true);
    showToast(`A lotérica ${codigo} continua na fila do Radar. O coletor fará a busca assim que estiver livre.`);
  }

  function setQuickLoading(loading) {
    const btn = $('formQuickAdd')?.querySelector('button[type="submit"]');
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading ? '<i class="fas fa-circle-notch fa-spin"></i> Salvando' : '<i class="fas fa-plus"></i> Adicionar ao Radar';
  }

  function abrirLoterica(id = '') {
    const item = state.lotericas.find(l => String(l.id) === String(id));
    $('lotericaId').value = item?.id || '';
    $('lotericaCodigo').value = item?.codigo_loterica || '';
    $('lotericaCodigo').disabled = !!item;
    $('lotericaApelido').value = item?.apelido || '';
    $('lotericaClassificacao').value = item?.classificacao || 'TESTE';
    $('lotericaPrioridade').value = String(item?.prioridade || 3);
    $('lotericaIntervalo').value = String(item?.intervalo_minutos || 180);
    $('lotericaAtivo').checked = item?.ativo ?? true;
    $('lotericaTags').value = Array.isArray(item?.tags) ? item.tags.join(', ') : '';
    $('lotericaObservacao').value = item?.observacao || '';
    setText('modalLotericaTitle', item ? `Editar lotérica ${item.codigo_loterica}` : 'Adicionar lotérica');
    abrirModal('modalLoterica');
    setTimeout(() => (item ? $('lotericaApelido') : $('lotericaCodigo'))?.focus(), 50);
  }

  async function salvarLoterica(event) {
    event.preventDefault();
    const id = $('lotericaId').value;
    const payload = {
      codigo_loterica: onlyDigits($('lotericaCodigo').value),
      apelido: nullIfBlank($('lotericaApelido').value),
      classificacao: $('lotericaClassificacao').value,
      prioridade: Number($('lotericaPrioridade').value || 3),
      intervalo_minutos: Number($('lotericaIntervalo').value || 180),
      ativo: $('lotericaAtivo').checked,
      tags: $('lotericaTags').value.split(',').map(v => v.trim()).filter(Boolean),
      observacao: nullIfBlank($('lotericaObservacao').value),
      atualizado_em: new Date().toISOString()
    };
    if (!payload.codigo_loterica) return showAlert('Informe um código lotérico válido.');
    try {
      setFormButton('btnSalvarLoterica', true);
      let query;
      if (id) {
        const { codigo_loterica, ...update } = payload;
        query = sb.from('marketplace_radar_lotericas').update(update).eq('id', id);
      } else {
        payload.proxima_varredura_em = new Date().toISOString();
        payload.ultimo_status = 'PENDENTE';
        payload.ultimo_erro = null;
        query = sb.from('marketplace_radar_lotericas').insert(payload);
      }
      const { error } = await query;
      if (error) throw error;
      fecharModal('modalLoterica');
      await carregarTudo(true);
      showToast('Lotérica salva no Radar.');
    } catch (error) { showAlert(humanDbError(error)); }
    finally { setFormButton('btnSalvarLoterica', false, '<i class="fas fa-floppy-disk"></i> Salvar'); }
  }

  async function toggleLoterica(id) {
    const item = state.lotericas.find(l => String(l.id) === String(id));
    if (!item) return;
    const { error } = await sb.from('marketplace_radar_lotericas').update({ ativo: !item.ativo, atualizado_em: new Date().toISOString(), ...(item.ativo ? {} : { proxima_varredura_em: new Date().toISOString() }) }).eq('id', item.id);
    if (error) return showAlert(humanDbError(error));
    await carregarTudo(true);
  }

  async function favoritarLoterica(id) {
    const item = state.lotericas.find(l => String(l.id) === String(id));
    if (!item) return;
    const next = item.classificacao === 'FAVORITA' ? 'PROMISSORA' : 'FAVORITA';
    const { error } = await sb.from('marketplace_radar_lotericas').update({ classificacao: next, prioridade: next === 'FAVORITA' ? 1 : item.prioridade, atualizado_em: new Date().toISOString() }).eq('id', item.id);
    if (error) return showAlert(humanDbError(error));
    await carregarTudo(true);
  }

  function abrirPerfil(id = '') {
    const item = state.perfis.find(p => String(p.id) === String(id));
    $('perfilId').value = item?.id || '';
    $('perfilNome').value = item?.nome || '';
    $('perfilModalidade').value = item?.modalidade || '';
    $('perfilAtivo').checked = item?.ativo ?? true;
    $('perfilNumerosMin').value = nullToBlank(item?.qtd_numeros_min);
    $('perfilNumerosMax').value = nullToBlank(item?.qtd_numeros_max);
    $('perfilApostasMin').value = nullToBlank(item?.qtd_apostas_min);
    $('perfilApostasMax').value = nullToBlank(item?.qtd_apostas_max);
    $('perfilValorMin').value = nullToBlank(item?.valor_cota_min);
    $('perfilValorMax').value = nullToBlank(item?.valor_cota_max);
    $('perfilCotasMin').value = nullToBlank(item?.qtd_cotas_min);
    $('perfilCotasMax').value = nullToBlank(item?.qtd_cotas_max);
    $('perfilObservacao').value = item?.observacao || '';
    setText('modalPerfilTitle', item ? `Editar perfil: ${item.nome}` : 'Novo perfil de interesse');
    abrirModal('modalPerfil');
    setTimeout(() => $('perfilNome')?.focus(), 50);
  }

  async function salvarPerfil(event) {
    event.preventDefault();
    const id = $('perfilId').value;
    const payload = {
      nome: $('perfilNome').value.trim(),
      modalidade: nullIfBlank($('perfilModalidade').value),
      qtd_numeros_min: numericOrNull($('perfilNumerosMin').value),
      qtd_numeros_max: numericOrNull($('perfilNumerosMax').value),
      qtd_apostas_min: numericOrNull($('perfilApostasMin').value),
      qtd_apostas_max: numericOrNull($('perfilApostasMax').value),
      valor_cota_min: numericOrNull($('perfilValorMin').value),
      valor_cota_max: numericOrNull($('perfilValorMax').value),
      qtd_cotas_min: numericOrNull($('perfilCotasMin').value),
      qtd_cotas_max: numericOrNull($('perfilCotasMax').value),
      observacao: nullIfBlank($('perfilObservacao').value),
      ativo: $('perfilAtivo').checked,
      atualizado_em: new Date().toISOString()
    };
    if (!payload.nome) return showAlert('Informe um nome para o perfil.');
    const invalid = validateRanges(payload);
    if (invalid) return showAlert(invalid);
    try {
      setFormButton('btnSalvarPerfil', true);
      const { error } = id
        ? await sb.from('marketplace_radar_perfis').update(payload).eq('id', id)
        : await sb.from('marketplace_radar_perfis').insert(payload);
      if (error) throw error;
      fecharModal('modalPerfil');
      await carregarTudo(true);
      showToast('Perfil salvo. O Radar recalculou os achados.');
    } catch (error) { showAlert(humanDbError(error)); }
    finally { setFormButton('btnSalvarPerfil', false, '<i class="fas fa-floppy-disk"></i> Salvar perfil'); }
  }

  function validateRanges(p) {
    const pairs = [
      ['dezenas', p.qtd_numeros_min, p.qtd_numeros_max],
      ['jogos', p.qtd_apostas_min, p.qtd_apostas_max],
      ['valor da cota', p.valor_cota_min, p.valor_cota_max],
      ['cotas', p.qtd_cotas_min, p.qtd_cotas_max]
    ];
    for (const [label,min,max] of pairs) if (min != null && max != null && Number(min) > Number(max)) return `No perfil, o mínimo de ${label} não pode ser maior que o máximo.`;
    return '';
  }

  async function togglePerfilAtivo(id) {
    const item = state.perfis.find(p => String(p.id) === String(id));
    if (!item) return;
    const { error } = await sb.from('marketplace_radar_perfis').update({ ativo: !item.ativo, atualizado_em: new Date().toISOString() }).eq('id', item.id);
    if (error) return showAlert(humanDbError(error));
    await carregarTudo(true);
  }

  async function acompanharBolao(codigo, button) {
    if (!codigo) return;
    const current = state.monitoramentos.get(String(codigo));
    const interval = current?.ativo ? Number(current.intervalo_minutos || 5) : 5;
    try {
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Salvando';
      const payload = { codigo_bolao_caixa: codigo, intervalo_minutos: interval, ativo: true, criado_por: state.session?.user?.id || null, atualizado_em: new Date().toISOString() };
      const { error } = await sb.from('marketplace_caixa_detalhe_monitoramentos').upsert(payload, { onConflict: 'codigo_bolao_caixa' });
      if (error) throw error;
      try { await sb.rpc('marketplace_caixa_solicitar_detalhe', { p_codigo_bolao_caixa: codigo }); } catch (_) {}
      state.monitoramentos.set(String(codigo), payload);
      renderStats();
      renderAchados();
      showToast(`Bolão ${codigo} enviado para monitoramento a cada ${interval} minutos.`);
    } catch (error) {
      showAlert(humanDbError(error));
      button.disabled = false;
      button.innerHTML = '<i class="far fa-star"></i>Acompanhar';
    }
  }

  function ativarAba(tab) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
  }

  function abrirModal(id) { const el = $(id); if (el) el.hidden = false; }
  function fecharModal(id) { const el = $(id); if (el) el.hidden = true; }
  function setFormButton(id, loading, normalHtml = '') { const b = $(id); if (!b) return; b.disabled = loading; if (loading) b.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Salvando'; else if (normalHtml) b.innerHTML = normalHtml; }
  function setStatus(title, subtitle) { setText('radarStatusTitulo', title); setText('radarStatusSub', subtitle); }
  function setText(id, value) { if ($(id)) $(id).textContent = value ?? ''; }
  function showAlert(message) { const el = $('radarAviso'); if (!el) return; el.hidden = !message; el.textContent = message || ''; }
  function showToast(message) { showAlert(''); setStatus('Radar atualizado', message); setTimeout(() => { if ($('radarStatusTitulo')?.textContent === 'Radar atualizado') carregarTudo(true); }, 1800); }
  function onlyDigits(v) { return String(v || '').replace(/\D+/g, ''); }
  function nullIfBlank(v) { const s = String(v ?? '').trim(); return s ? s : null; }
  function numericOrNull(v) { const s = String(v ?? '').trim().replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }
  function nullToBlank(v) { return v == null ? '' : v; }
  function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  function valueOrDash(v) { return v == null || v === '' ? '—' : fmtInt.format(Number(v)); }
  function moneyOrDash(v) { const n = Number(v); return Number.isFinite(n) ? fmtMoney.format(n) : '—'; }
  function dateValue(v) { const n = new Date(v || 0).getTime(); return Number.isFinite(n) ? n : 0; }
  function fmtDateTime(v) { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  function normalize(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,''); }
  function dedupe(items, keyFn) { const map = new Map(); items.forEach(i => map.set(keyFn(i), i)); return [...map.values()]; }
  function esc(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function metaBox(label, value) { return `<div class="radar-meta-box"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function emptyHtml(icon, title, text) { return `<div class="radar-empty"><i class="fas ${icon}"></i><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`; }
  function rotuloClassificacao(v) { return ({TESTE:'TESTE',PROMISSORA:'PROMISSORA',FAVORITA:'FAVORITA',DESCARTADA:'DESCARTADA'})[v] || v || 'TESTE'; }
  function humanDbError(error) { const msg = error?.message || String(error || 'Erro desconhecido.'); if (/duplicate key|unique constraint/i.test(msg)) return 'Esse registro já existe no Radar.'; if (/row-level security|permission denied|42501/i.test(msg)) return 'O Supabase bloqueou esta operação pelas permissões/RLS. Confira as políticas das tabelas do Radar.'; return msg; }
})();
