(function () {
  'use strict';

  const CONFIG = window.SISLOT_CONFIG || {};
  const PERFIL_LABEL = { ADMIN: 'Administrador', SOCIO: 'Sócio', GERENTE: 'Gerente', OPERADOR: 'Operador' };

  if (!window.supabase || !CONFIG.url || !CONFIG.anonKey) {
    document.addEventListener('DOMContentLoaded', () => mostrarAviso('Configuração do Supabase não encontrada. Confira sislot-config.js.'));
    return;
  }

  const sb = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
  const $ = (id) => document.getElementById(id);
  const int = (v) => Number(v || 0);

  const state = {
    usuario: null,
    boloes: [],
    snapshots: [],
    coletas: [],
    series: [],
    loading: false
  };

  init();

  function init() {
    document.addEventListener('DOMContentLoaded', async () => {
      bindUI();
      startClock();
      try {
        await validarSessao();
        await carregarTudo();
        setInterval(() => carregarTudo(true), 60000);
      } catch (err) {
        console.error('[Marketplace CAIXA] erro inicial', err);
        mostrarAviso(err.message || 'Erro ao iniciar Marketplace CAIXA.');
        atualizarLive('Erro ao carregar', 'Confira permissões, sessão e console do navegador.', true);
      }
    });
  }

  function bindUI() {
    $('btnAtualizar')?.addEventListener('click', () => carregarTudo());
    $('btnLogout')?.addEventListener('click', async () => window.SISLOT_SECURITY?.sair ? window.SISLOT_SECURITY.sair() : sb.auth.signOut());
    $('btnComandoColetor')?.addEventListener('click', () => { $('modalColetor').hidden = false; });
    $('btnFecharModal')?.addEventListener('click', () => { $('modalColetor').hidden = true; });
    $('modalColetor')?.addEventListener('click', (e) => { if (e.target?.id === 'modalColetor') $('modalColetor').hidden = true; });
    $('btnExportarSerieCsv')?.addEventListener('click', exportarSerieCsv);
    $('btnExportarBoloesCsv')?.addEventListener('click', exportarBoloesCsv);

    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => ativarAba(btn.dataset.tab));
    });

    ['filtroLoja', 'filtroModalidade', 'filtroConcurso', 'filtroPagina', 'filtroPeriodo', 'filtroOrdenacao', 'filtroApenasMovimento']
      .forEach(id => $(id)?.addEventListener('input', () => {
        montarSeries();
        renderTudo(false);
      }));
  }

  function startClock() {
    const update = () => {
      const el = $('relogio');
      if (!el) return;
      const now = new Date();
      el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR');
    };
    update();
    setInterval(update, 1000);
  }

  async function validarSessao() {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) throw new Error(error.message || 'Erro ao verificar sessão.');
    if (!session?.user?.id) {
      setTimeout(() => { location.href = './login.html'; }, 600);
      throw new Error('Sessão do SISLOT não encontrada. Redirecionando para login...');
    }

    let usuario = null;
    if (window.SISLOT_SECURITY?.validarUsuarioLogavel) {
      usuario = await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
    }
    state.usuario = usuario || { nome: session.user.email || 'Usuário', perfil: '—' };
    preencherUsuario(state.usuario);
  }

  function preencherUsuario(usuario) {
    const nome = String(usuario?.nome || usuario?.email || 'Usuário').trim();
    const iniciais = nome.split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
    if ($('userName')) $('userName').textContent = nome;
    if ($('userRole')) $('userRole').textContent = PERFIL_LABEL[usuario?.perfil] || usuario?.perfil || '—';
    if ($('userAvatar')) $('userAvatar').textContent = iniciais;
  }

  async function carregarTudo(silencioso = false) {
    if (state.loading) return;
    state.loading = true;
    if (!silencioso) atualizarLive('Atualizando dados', 'Buscando bolões, snapshots e últimas coletas...', false);
    mostrarAviso('');

    try {
      const periodo = Number($('filtroPeriodo')?.value || 6);
      const since = new Date(Date.now() - periodo * 60 * 60 * 1000).toISOString();

      const [boloes, snapshots, coletas] = await Promise.all([
        buscarBoloes(),
        buscarSnapshots(since),
        buscarColetas()
      ]);

      state.boloes = boloes;
      state.snapshots = snapshots;
      state.coletas = coletas;

      montarFiltros();
      montarSeries();
      renderTudo(true);

      const ultima = coletas[0]?.finalizado_em || coletas[0]?.iniciado_em || maiorData(boloes.map(b => b.ultima_coleta_em));
      atualizarLive('Marketplace atualizado', `Última coleta: ${fmtDataHora(ultima)} · ${boloes.length} bolões ativos`, false);
    } catch (err) {
      console.error('[Marketplace CAIXA] falha ao carregar', err);
      mostrarAviso(err.message || 'Erro ao carregar dados do marketplace.');
      atualizarLive('Erro ao atualizar', err.message || 'Falha ao consultar Supabase.', true);
    } finally {
      state.loading = false;
    }
  }

  async function buscarBoloes() {
    const { data, error } = await sb
      .from('marketplace_caixa_boloes')
      .select('codigo_bolao_caixa,codigo_loterica,nome_loteria,modalidade,concurso,qtd_apostas,qtd_numeros,qtd_trevos,qtd_simples_loteca,qtd_duplos_loteca,qtd_triplos_loteca,qtd_cota_total,qtd_cota_digital,qtd_cota_disponivel,valor_cota,valor_cota_sem_tarifa,tarifa_servico,valor_ultima_cota,contem_residuo,status_marketplace,ultima_coleta_em,payload_caixa')
      .eq('status_marketplace', 'ATIVO')
      .order('codigo_loterica', { ascending: true })
      .order('modalidade', { ascending: true })
      .order('concurso', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function buscarSnapshots(sinceIso) {
    const { data, error } = await sb
      .from('marketplace_caixa_snapshots')
      .select('codigo_bolao_caixa,codigo_loterica,modalidade,concurso,qtd_cota_total,qtd_cota_digital,qtd_cota_disponivel,qtd_cota_indisponivel,valor_cota,coletado_em,pagina_origem,payload_caixa')
      .gte('coletado_em', sinceIso)
      .order('coletado_em', { ascending: true })
      .limit(20000);
    if (error) throw error;
    return data || [];
  }

  async function buscarColetas() {
    const { data, error } = await sb
      .from('marketplace_caixa_coletas')
      .select('id,origem,status,iniciado_em,finalizado_em,paginas_esperadas,paginas_capturadas,registros_informados,registros_capturados,registros_unicos,versao_caixa,versao_extensao,mensagem_erro,escopo')
      .order('iniciado_em', { ascending: false })
      .limit(24);
    if (error) throw error;
    return data || [];
  }

  function montarFiltros() {
    preencherSelect($('filtroLoja'), montarLojas());
    preencherSelect($('filtroModalidade'), montarModalidades());
    preencherSelect($('filtroPagina'), montarPaginas());
  }

  function montarLojas() {
    const lojas = new Map();
    state.boloes.forEach(b => lojas.set(String(b.codigo_loterica), `${b.codigo_loterica} — ${b.nome_loteria || ''}`));
    return [...lojas.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }

  function montarModalidades() {
    const mods = new Set(state.boloes.map(b => b.modalidade).filter(Boolean));
    return [...mods].sort().map(m => [m, normalizarModalidade(m)]);
  }

  function montarPaginas() {
    const pags = new Set(state.boloes.map(paginaOrigemBolao).filter(p => p && p !== '—'));
    return [...pags].sort((a, b) => Number(a) - Number(b)).map(p => [p, `Pág. ${p}`]);
  }

  function preencherSelect(select, entries) {
    if (!select) return;
    const atual = select.value;
    const first = select.querySelector('option')?.outerHTML || '<option value="">Todos</option>';
    select.innerHTML = first + entries.map(([v, label]) => `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`).join('');
    select.value = [...select.options].some(o => o.value === atual) ? atual : '';
  }

  function montarSeries() {
    const periodoHoras = Number($('filtroPeriodo')?.value || 6);
    const sinceMs = Date.now() - periodoHoras * 60 * 60 * 1000;
    const byBolao = new Map();

    state.snapshots
      .filter(s => new Date(s.coletado_em).getTime() >= sinceMs)
      .forEach(s => {
        const key = s.codigo_bolao_caixa;
        if (!byBolao.has(key)) byBolao.set(key, []);
        byBolao.get(key).push({
          t: s.coletado_em,
          d: int(s.qtd_cota_disponivel),
          digital: int(s.qtd_cota_digital),
          total: int(s.qtd_cota_total),
          valor: Number(s.valor_cota || 0),
          pagina: paginaOrigemSnapshot(s)
        });
      });

    const series = state.boloes.map(b => {
      const pontos = (byBolao.get(b.codigo_bolao_caixa) || [])
        .sort((a, b) => new Date(a.t) - new Date(b.t));

      if (!pontos.length && b.ultima_coleta_em) {
        pontos.push({
          t: b.ultima_coleta_em,
          d: int(b.qtd_cota_disponivel),
          digital: int(b.qtd_cota_digital),
          total: int(b.qtd_cota_total),
          valor: Number(b.valor_cota || 0),
          pagina: paginaOrigemBolao(b)
        });
      }

      const stats = calcularSerie(pontos);
      return {
        bolao: b,
        pontos,
        pagina: paginaOrigemBolao(b) !== '—' ? paginaOrigemBolao(b) : (pontos.find(p => p.pagina)?.pagina || '—'),
        ...stats
      };
    });

    state.series = aplicarFiltrosSeries(series);
  }

  function aplicarFiltrosSeries(series) {
    const loja = $('filtroLoja')?.value || '';
    const modalidade = $('filtroModalidade')?.value || '';
    const concurso = $('filtroConcurso')?.value || '';
    const pagina = $('filtroPagina')?.value || '';
    const apenasMovimento = $('filtroApenasMovimento')?.checked;
    const ordenacao = $('filtroOrdenacao')?.value || 'movimento';

    const filtradas = series.filter(item => {
      const b = item.bolao;
      if (loja && String(b.codigo_loterica) !== loja) return false;
      if (modalidade && String(b.modalidade) !== modalidade) return false;
      if (concurso && String(b.concurso) !== concurso) return false;
      if (pagina && String(item.pagina) !== pagina) return false;
      if (apenasMovimento && item.movimentoTotal === 0) return false;
      return true;
    });

    filtradas.sort((a, b) => {
      if (ordenacao === 'queda') return b.saidas - a.saidas || b.movimentoTotal - a.movimentoTotal;
      if (ordenacao === 'entrada') return b.entradas - a.entradas || b.movimentoTotal - a.movimentoTotal;
      if (ordenacao === 'atual') return a.atual - b.atual || b.movimentoTotal - a.movimentoTotal;
      if (ordenacao === 'pagina') return Number(a.pagina || 999) - Number(b.pagina || 999) || ordenarIdentidade(a, b);
      if (ordenacao === 'loja') return ordenarIdentidade(a, b);
      return b.movimentoTotal - a.movimentoTotal || Math.abs(b.delta) - Math.abs(a.delta);
    });

    return filtradas;
  }

  function ordenarIdentidade(a, b) {
    return String(a.bolao.codigo_loterica).localeCompare(String(b.bolao.codigo_loterica), 'pt-BR')
      || String(a.bolao.modalidade).localeCompare(String(b.bolao.modalidade), 'pt-BR')
      || Number(a.bolao.concurso || 0) - Number(b.bolao.concurso || 0)
      || Number(a.pagina || 999) - Number(b.pagina || 999);
  }

  function calcularSerie(pontos) {
    if (!pontos.length) {
      return { inicio: 0, atual: 0, min: 0, max: 0, delta: 0, saidas: 0, entradas: 0, movimentoTotal: 0, ultimoMovimento: null };
    }
    const valores = pontos.map(p => int(p.d));
    let saidas = 0;
    let entradas = 0;
    let ultimoMovimento = null;

    for (let i = 1; i < pontos.length; i++) {
      const d = int(pontos[i].d) - int(pontos[i - 1].d);
      if (d < 0) saidas += Math.abs(d);
      if (d > 0) entradas += d;
      if (d !== 0) ultimoMovimento = { delta: d, t: pontos[i].t, anterior: pontos[i - 1].d, atual: pontos[i].d };
    }

    const inicio = valores[0];
    const atual = valores[valores.length - 1];
    return {
      inicio,
      atual,
      min: Math.min(...valores),
      max: Math.max(...valores),
      delta: atual - inicio,
      saidas,
      entradas,
      movimentoTotal: saidas + entradas,
      ultimoMovimento
    };
  }

  function renderTudo(rebuildBoloes = false) {
    renderStats();
    renderTimeline();
    if (rebuildBoloes) {
      renderBoloes();
      renderColetas();
    }
  }

  function renderStats() {
    const lojas = new Set(state.boloes.map(b => b.codigo_loterica));
    const disponiveis = state.boloes.reduce((s, b) => s + int(b.qtd_cota_disponivel), 0);
    const saidas = state.series.reduce((s, x) => s + x.saidas, 0);
    const entradas = state.series.reduce((s, x) => s + x.entradas, 0);
    const ultima = state.coletas[0]?.finalizado_em || state.coletas[0]?.iniciado_em || maiorData(state.boloes.map(b => b.ultima_coleta_em));

    setText('statBoloes', fmtInt(state.boloes.length));
    setText('statLojas', fmtInt(lojas.size));
    setText('statDisponiveis', fmtInt(disponiveis));
    setText('statSaidasPeriodo', fmtInt(saidas));
    setText('statEntradasPeriodo', fmtInt(entradas));
    setText('statUltimaColeta', fmtDataCurta(ultima));
  }

  function renderTimeline() {
    const box = $('timelineList');
    if (!box) return;

    const periodo = $('filtroPeriodo')?.value || 6;
    setText('timelineResumo', `${state.series.length} bolão(ões) exibidos · período: últimas ${periodo}h`);

    if (!state.series.length) {
      box.innerHTML = `<div class="empty">Nenhum bolão com os filtros selecionados. Desmarque “apenas bolões com variação” ou aumente o período.</div>`;
      return;
    }

    box.innerHTML = state.series.map(renderTimelineRow).join('');
  }

  function renderTimelineRow(item) {
    const b = item.bolao;
    const classeMov = item.delta < 0 ? 'movement-down' : item.delta > 0 ? 'movement-up' : 'movement-stable';
    const deltaClass = item.delta < 0 ? 'negative' : item.delta > 0 ? 'positive' : '';
    const ultimo = item.ultimoMovimento
      ? `${item.ultimoMovimento.delta > 0 ? '+' : ''}${item.ultimoMovimento.delta} em ${fmtHora(item.ultimoMovimento.t)}`
      : 'Sem variação no período';

    return `
      <article class="timeline-row ${classeMov}">
        <div class="timeline-info">
          <div class="timeline-head">
            <span class="mod-chip">${escapeHtml(normalizarModalidade(b.modalidade))}</span>
            <span class="page-chip">Pág. ${escapeHtml(item.pagina || '—')}</span>
            <span class="code-chip" title="${escapeHtml(b.codigo_bolao_caixa || '')}">${escapeHtml(shortCode(b.codigo_bolao_caixa))}</span>
          </div>
          <h3 class="timeline-title">Conc. ${escapeHtml(b.concurso || '—')} · ${escapeHtml(b.nome_loteria || b.codigo_loterica || '—')}</h3>
          <div class="timeline-meta">
            <span><strong>${escapeHtml(descricaoBolao(b))}</strong></span>
            <span>${fmtBRL(b.valor_cota)}</span>
            <span>Total ${fmtInt(b.qtd_cota_total)} · Digital ${fmtInt(b.qtd_cota_digital)}</span>
          </div>
        </div>

        <div class="series-box">
          ${renderSparkline(item)}
        </div>

        <div class="timeline-summary">
          <div class="current-box">
            <span>Disponível atual</span>
            <strong>${fmtInt(item.atual)}</strong>
          </div>
          <div class="summary-chips">
            <div class="sum-chip down"><span>Saíram</span><strong>${fmtInt(item.saidas)}</strong></div>
            <div class="sum-chip up"><span>Entraram</span><strong>${fmtInt(item.entradas)}</strong></div>
            <div class="sum-chip delta ${deltaClass}"><span>Δ período</span><strong>${item.delta > 0 ? '+' : ''}${fmtInt(item.delta)}</strong></div>
            <div class="sum-chip"><span>Mín/Máx</span><strong>${fmtInt(item.min)} / ${fmtInt(item.max)}</strong></div>
          </div>
          <div class="last-move">Último mov.: ${escapeHtml(ultimo)}</div>
        </div>
      </article>
    `;
  }

  function renderSparkline(item) {
    const pontos = item.pontos;
    if (!pontos.length) {
      return `<div class="spark-wrap"><div class="empty">Sem snapshots no período.</div></div>`;
    }

    const width = 560;
    const height = 62;
    const padX = 12;
    const padY = 8;
    const min = item.min;
    const max = item.max;
    const span = Math.max(max - min, 1);
    const denom = Math.max(pontos.length - 1, 1);

    const coords = pontos.map((p, i) => {
      const x = padX + (i / denom) * (width - padX * 2);
      const y = padY + ((max - p.d) / span) * (height - padY * 2);
      return { x, y, d: p.d, t: p.t };
    });

    let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
    for (let i = 1; i < coords.length; i++) {
      path += ` H ${coords[i].x.toFixed(2)} V ${coords[i].y.toFixed(2)}`;
    }

    const area = `${path} V ${height - padY} H ${coords[0].x.toFixed(2)} Z`;
    const dots = coords.map((c, i) => `<circle class="spark-dot ${i === coords.length - 1 ? 'last' : ''}" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="3"><title>${fmtDataHora(c.t)} · ${c.d} disponíveis</title></circle>`).join('');

    const segments = [];
    for (let i = 1; i < pontos.length; i++) {
      const d = pontos[i].d - pontos[i - 1].d;
      segments.push(`<i class="segment ${d < 0 ? 'down' : d > 0 ? 'up' : 'same'}" title="${fmtDataHora(pontos[i].t)} · ${d > 0 ? '+' : ''}${d}"></i>`);
    }
    if (!segments.length) segments.push('<i class="segment same"></i>');

    return `
      <div class="spark-wrap">
        <svg class="spark-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Série temporal de disponibilidade">
          <path class="spark-area" d="${area}"></path>
          <path class="spark-line" d="${path}"></path>
          ${dots}
        </svg>
        <div class="segment-bar">${segments.join('')}</div>
      </div>
      <div class="series-scale">
        <span>${fmtHora(pontos[0].t)}</span>
        <span>${fmtInt(min)}–${fmtInt(max)} cotas</span>
        <span>${fmtHora(pontos[pontos.length - 1].t)}</span>
      </div>
    `;
  }

  function renderBoloes() {
    const box = $('boloesGrid');
    if (!box) return;
    if (!state.boloes.length) {
      box.innerHTML = `<div class="empty">Nenhum bolão ativo capturado.</div>`;
      return;
    }
    box.innerHTML = state.boloes.map(b => {
      const c = calcularBolao(b);
      const pagina = paginaOrigemBolao(b);
      return `
        <article class="bolao-card">
          <div class="bolao-card-head">
            <div>
              <div class="timeline-head">
                <span class="mod-chip">${escapeHtml(normalizarModalidade(b.modalidade))}</span>
                <span class="page-chip">Pág. ${escapeHtml(pagina)}</span>
              </div>
              <h3>Conc. ${escapeHtml(b.concurso || '—')} · ${escapeHtml(b.nome_loteria || b.codigo_loterica || '—')}</h3>
              <p>${escapeHtml(descricaoBolao(b))} · ${fmtBRL(b.valor_cota)}</p>
            </div>
            <span class="code-chip" title="${escapeHtml(b.codigo_bolao_caixa || '')}">${escapeHtml(shortCode(b.codigo_bolao_caixa))}</span>
          </div>
          <div class="disp-bar"><div class="disp-fill" style="width:${Math.max(0, Math.min(100, c.percDisp)).toFixed(2)}%"></div></div>
          <div class="bolao-grid-mini">
            <div class="mini-stat"><span>Total</span><strong>${fmtInt(c.total)}</strong></div>
            <div class="mini-stat"><span>Digital</span><strong>${fmtInt(c.digital)}</strong></div>
            <div class="mini-stat"><span>Disponível</span><strong>${fmtInt(c.disp)}</strong></div>
            <div class="mini-stat"><span>Indisp.</span><strong>${fmtInt(c.indisponivel)}</strong></div>
            <div class="mini-stat"><span>Fora digital</span><strong>${fmtInt(c.foraDigital)}</strong></div>
            <div class="mini-stat"><span>Coleta</span><strong>${escapeHtml(fmtDataCurta(b.ultima_coleta_em))}</strong></div>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderColetas() {
    const box = $('coletasGrid');
    if (!box) return;
    if (!state.coletas.length) {
      box.innerHTML = `<div class="empty">Nenhuma coleta encontrada.</div>`;
      setStatusColetor('Sem coletas', 'warn');
      return;
    }

    const ultima = state.coletas[0];
    const ok = String(ultima.status || '').toUpperCase() === 'CONCLUIDA';
    setStatusColetor(ok ? 'Coletor OK' : 'Verificar coletor', ok ? 'ok' : 'err');

    box.innerHTML = state.coletas.map(c => {
      const status = String(c.status || '').toUpperCase();
      const cls = status === 'CONCLUIDA' ? 'ok' : 'err';
      const escopo = c.escopo || {};
      const codigo = escopo.codigoLoterica || escopo.codigo_loterica || '—';
      return `
        <article class="coleta-card ${cls}">
          <div class="timeline-head">
            <span class="pill ${cls}">${escapeHtml(status || '—')}</span>
            <span class="code-chip">Coleta #${escapeHtml(c.id)}</span>
          </div>
          <h3>${escapeHtml(c.origem || '—')} · Lotérica ${escapeHtml(codigo)}</h3>
          <p>${escapeHtml(c.mensagem_erro || 'Coleta registrada sem erro.')}</p>
          <div class="coleta-meta">
            <div class="mini-stat"><span>Páginas</span><strong>${fmtInt(c.paginas_capturadas)} / ${fmtInt(c.paginas_esperadas)}</strong></div>
            <div class="mini-stat"><span>Registros</span><strong>${fmtInt(c.registros_unicos)}</strong></div>
            <div class="mini-stat"><span>Versão CAIXA</span><strong>${escapeHtml(c.versao_caixa || '—')}</strong></div>
            <div class="mini-stat"><span>Finalizada</span><strong>${escapeHtml(fmtDataCurta(c.finalizado_em || c.iniciado_em))}</strong></div>
          </div>
        </article>
      `;
    }).join('');
  }

  function ativarAba(tab) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
  }

  function setStatusColetor(txt, tipo) {
    const el = $('statusColetor');
    if (!el) return;
    el.textContent = txt;
    el.className = `pill ${tipo || ''}`;
  }

  function atualizarLive(titulo, sub, erro) {
    setText('liveStatusTitulo', titulo);
    setText('liveStatusSub', sub);
    const dot = $('liveDot');
    if (dot) dot.style.background = erro ? 'var(--red)' : 'var(--green)';
  }

  function mostrarAviso(msg) {
    const el = $('mpAviso');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function exportarSerieCsv() {
    const rows = state.series.flatMap(item => item.pontos.map(p => ({
      codigo_loterica: item.bolao.codigo_loterica,
      nome_loteria: item.bolao.nome_loteria,
      modalidade: item.bolao.modalidade,
      concurso: item.bolao.concurso,
      pagina_caixa: item.pagina,
      codigo_bolao_caixa: item.bolao.codigo_bolao_caixa,
      coletado_em: p.t,
      qtd_cota_disponivel: p.d,
      valor_cota: item.bolao.valor_cota
    })));
    baixarCsv('marketplace-caixa-serie-bolao.csv', rows);
  }

  function exportarBoloesCsv() {
    const rows = state.boloes.map(b => ({
      codigo_loterica: b.codigo_loterica,
      nome_loteria: b.nome_loteria,
      modalidade: b.modalidade,
      concurso: b.concurso,
      pagina_caixa: paginaOrigemBolao(b),
      codigo_bolao_caixa: b.codigo_bolao_caixa,
      qtd_apostas: b.qtd_apostas,
      qtd_numeros: b.qtd_numeros,
      qtd_cota_total: b.qtd_cota_total,
      qtd_cota_digital: b.qtd_cota_digital,
      qtd_cota_disponivel: b.qtd_cota_disponivel,
      valor_cota: b.valor_cota,
      ultima_coleta_em: b.ultima_coleta_em
    }));
    baixarCsv('marketplace-caixa-boloes-capturados.csv', rows);
  }

  function baixarCsv(nome, rows) {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(';')]
      .concat(rows.map(r => headers.map(h => csvCell(r[h])).join(';')))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(v) {
    const s = String(v ?? '').replaceAll('"', '""');
    return `"${s}"`;
  }

  function calcularBolao(b) {
    const total = int(b.qtd_cota_total);
    const digital = int(b.qtd_cota_digital);
    const disp = int(b.qtd_cota_disponivel);
    return {
      total,
      digital,
      disp,
      indisponivel: Math.max(digital - disp, 0),
      foraDigital: Math.max(total - digital, 0),
      percDisp: digital > 0 ? disp / digital * 100 : 0
    };
  }

  function paginaOrigemBolao(b) {
    const payload = b?.payload_caixa || {};
    const candidatos = [b?.pagina_origem, b?.paginaOrigem, payload?.paginaOrigem, payload?.pagina_origem, payload?.pagina, payload?.paginaAtual];
    for (const v of candidatos) {
      if (v === null || v === undefined || v === '') continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return String(n);
      return String(v);
    }
    return '—';
  }

  function paginaOrigemSnapshot(s) {
    const payload = s?.payload_caixa || {};
    const candidatos = [s?.pagina_origem, s?.paginaOrigem, payload?.paginaOrigem, payload?.pagina_origem, payload?.pagina, payload?.paginaAtual];
    for (const v of candidatos) {
      if (v === null || v === undefined || v === '') continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return String(n);
      return String(v);
    }
    return '';
  }

  function descricaoBolao(b) {
    const mod = String(b.modalidade || '').toUpperCase();
    if (mod === 'MAIS_MILIONARIA') {
      const trevos = b.qtd_trevos ? ` e ${fmtInt(b.qtd_trevos)} trevos` : '';
      return `${fmtInt(b.qtd_apostas)} jogo(s) de ${fmtInt(b.qtd_numeros)} números${trevos}`;
    }
    if (mod === 'LOTECA') {
      const partes = [];
      if (int(b.qtd_simples_loteca)) partes.push(`${fmtInt(b.qtd_simples_loteca)} simples`);
      if (int(b.qtd_duplos_loteca)) partes.push(`${fmtInt(b.qtd_duplos_loteca)} duplos`);
      if (int(b.qtd_triplos_loteca)) partes.push(`${fmtInt(b.qtd_triplos_loteca)} triplos`);
      return partes.length ? `Loteca com ${partes.join(', ')}` : `${fmtInt(b.qtd_apostas)} jogo(s) Loteca`;
    }
    return `${fmtInt(b.qtd_apostas)} jogo(s) de ${fmtInt(b.qtd_numeros)} dezenas`;
  }

  function normalizarModalidade(mod) {
    return String(mod || '—').replaceAll('_', ' ');
  }

  function fmtInt(v) { return int(v).toLocaleString('pt-BR'); }
  function fmtBRL(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function fmtDataHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
  function fmtDataCurta(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function fmtHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  }
  function maiorData(datas) {
    const nums = datas.map(d => d ? new Date(d).getTime() : NaN).filter(Number.isFinite);
    return nums.length ? new Date(Math.max(...nums)).toISOString() : null;
  }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt ?? '—'; }
  function shortCode(s) { return s ? String(s).slice(0, 8) + '…' : '—'; }
  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }
})();
