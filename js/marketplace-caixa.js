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
    detalhes: new Map(),
    monitoramentos: new Map(),
    monitoramentosDisponiveis: true,
    detalheDisponivel: true,
    detalheAtual: null,
    detalheCodigoAtual: '',
    detalhePollingToken: 0,
    detalheLoading: false,
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

    $('btnFecharDetalhe')?.addEventListener('click', fecharDetalhamento);
    $('btnAtualizarDetalhe')?.addEventListener('click', solicitarAtualizacaoDetalhe);
    $('btnSalvarMonitoramento')?.addEventListener('click', salvarMonitoramentoDetalhe);
    $('modalDetalheBolao')?.addEventListener('click', (e) => {
      if (e.target?.id === 'modalDetalheBolao') fecharDetalhamento();
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-detalhe-bolao]');
      if (!btn) return;
      e.preventDefault();
      abrirDetalhamento(btn.dataset.detalheBolao);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('modalDetalheBolao')?.hidden) fecharDetalhamento();
    });

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

      const [boloes, snapshots, coletas, detalhes, monitoramentos] = await Promise.all([
        buscarBoloes(),
        buscarSnapshots(since),
        buscarColetas(),
        buscarDetalhesResumoSeguro(),
        buscarMonitoramentosSeguro()
      ]);

      state.boloes = boloes;
      state.snapshots = snapshots;
      state.coletas = coletas;
      state.detalhes = new Map(
        detalhes.map(d => [String(d.codigo_bolao_caixa), d])
      );
      state.monitoramentos = new Map(
        monitoramentos.map(m => [String(m.codigo_bolao_caixa), m])
      );

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

  async function buscarDetalhesResumoSeguro() {
    const { data, error } = await sb
      .from('marketplace_caixa_detalhes')
      .select('codigo_bolao_caixa,qtd_cota_total,qtd_cota_disponivel,qtd_cota_fisica,qtd_cota_baixadas_impressas,qtd_cota_vendidas,qtd_cota_reservada,qtd_cota_baixadas,origem_ultima_coleta,ultima_coleta_em')
      .order('ultima_coleta_em', { ascending: false })
      .limit(5000);

    if (error) {
      state.detalheDisponivel = false;
      console.warn('[Marketplace CAIXA] detalhamento ainda não disponível:', error);
      return [];
    }

    state.detalheDisponivel = true;
    return data || [];
  }

  async function buscarMonitoramentosSeguro() {
    const { data, error } = await sb
      .from('marketplace_caixa_detalhe_monitoramentos')
      .select('codigo_bolao_caixa,intervalo_minutos,ativo,atualizado_em')
      .eq('ativo', true)
      .limit(5000);

    if (error) {
      state.monitoramentosDisponiveis = false;
      console.warn('[Marketplace CAIXA] monitoramentos individuais ainda não disponíveis:', error);
      return [];
    }

    state.monitoramentosDisponiveis = true;
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
          ${renderAcaoDetalheTimeline(b)}
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
    const padX = 14;
    const padY = 11;
    const min = item.min;
    const max = item.max;
    const span = Math.max(max - min, 1);
    const denom = Math.max(pontos.length - 1, 1);

    const coords = pontos.map((p, i) => {
      const x = padX + (i / denom) * (width - padX * 2);
      const y = padY + ((max - p.d) / span) * (height - padY * 2);
      return { x, y, d: p.d, t: p.t, idx: i };
    });

    let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
    for (let i = 1; i < coords.length; i++) {
      path += ` H ${coords[i].x.toFixed(2)} V ${coords[i].y.toFixed(2)}`;
    }

    const area = `${path} V ${height - padY} H ${coords[0].x.toFixed(2)} Z`;
    const labelIdx = selecionarLabelsInteligentes(pontos, min, max);

    const dots = coords.map((c, i) => {
      const extra = i === coords.length - 1 ? 'last' : '';
      return `<circle class="spark-dot ${extra}" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${i === coords.length - 1 ? '3.2' : '2.5'}"><title>${fmtDataHora(c.t)} · ${c.d} disponíveis</title></circle>`;
    }).join('');

    const labels = coords
      .filter(c => labelIdx.has(c.idx))
      .map(c => {
        const left = Math.max(4, Math.min(96, (c.x / width) * 100));
        const top = Math.max(11, Math.min(57, 5 + (c.y / height) * 51 - 9));
        const cls = [
          'spark-label',
          c.idx === coords.length - 1 ? 'last' : '',
          c.d === min ? 'min' : '',
          c.d === max ? 'max' : ''
        ].filter(Boolean).join(' ');
        return `<span class="${cls}" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}px" title="${escapeHtml(fmtDataHora(c.t))}">${fmtInt(c.d)}</span>`;
      }).join('');

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
        ${labels}
        <div class="segment-bar">${segments.join('')}</div>
      </div>
      <div class="series-scale">
        <span>${fmtHora(pontos[0].t)}</span>
        <span>${fmtInt(min)}–${fmtInt(max)} cotas</span>
        <span>${fmtHora(pontos[pontos.length - 1].t)}</span>
      </div>
    `;
  }

  function selecionarLabelsInteligentes(pontos, min, max) {
    const set = new Set();
    if (!pontos.length) return set;

    const last = pontos.length - 1;
    set.add(0);
    set.add(last);

    pontos.forEach((p, i) => {
      if (p.d === min || p.d === max) set.add(i);
    });

    const mudancas = [];
    for (let i = 1; i < pontos.length; i++) {
      const delta = pontos[i].d - pontos[i - 1].d;
      if (delta !== 0) mudancas.push({ i, peso: Math.abs(delta), delta });
    }

    mudancas
      .sort((a, b) => b.peso - a.peso || b.i - a.i)
      .slice(0, 5)
      .forEach(m => set.add(m.i));

    // Evita excesso de rótulos em séries muito densas.
    if (set.size > 8) {
      const essenciais = new Set([0, last]);
      pontos.forEach((p, i) => { if (p.d === min || p.d === max) essenciais.add(i); });
      mudancas.slice(0, Math.max(0, 8 - essenciais.size)).forEach(m => essenciais.add(m.i));
      return essenciais;
    }

    return set;
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
      const detalhe = state.detalhes.get(String(b.codigo_bolao_caixa));
      const monitoramento = state.monitoramentos.get(String(b.codigo_bolao_caixa));
      const detalheTextoBase = detalhe
        ? `${fmtInt(detalhe.qtd_cota_vendidas)} vendidas · ${fmtInt(detalhe.qtd_cota_baixadas_impressas)} impressas`
        : (state.detalheDisponivel ? 'Aguardando primeira coleta' : 'Detalhamento não instalado');
      const detalheTexto = monitoramento?.ativo
        ? `★ ${fmtInt(monitoramento.intervalo_minutos)} min · ${detalheTextoBase}`
        : detalheTextoBase;
      const detalheClasse = monitoramento?.ativo
        ? 'intensive'
        : (detalhe ? '' : 'pending');

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
          <div class="bolao-card-footer">
            <div class="bolao-detail-state">
              <span>Detalhamento</span>
              <strong class="${detalheClasse}">${escapeHtml(detalheTexto)}</strong>
            </div>
            ${botaoDetalheHtml(b.codigo_bolao_caixa, Boolean(detalhe))}
          </div>
        </article>
      `;
    }).join('');
  }


  function renderAcaoDetalheTimeline(b) {
    const detalhe = state.detalhes.get(String(b.codigo_bolao_caixa));
    const monitoramento = state.monitoramentos.get(String(b.codigo_bolao_caixa));
    const intensivo = monitoramento?.ativo
      ? `<span class="intensive-mark">★ ${fmtInt(monitoramento.intervalo_minutos)} min</span> · `
      : '';
    const resumo = detalhe
      ? `${intensivo}<strong>${fmtInt(detalhe.qtd_cota_vendidas)}</strong> vendidas · <strong>${fmtInt(detalhe.qtd_cota_baixadas_impressas)}</strong> impressas`
      : `${intensivo}${state.detalheDisponivel ? 'Detalhe aguardando coleta' : 'Detalhamento não instalado'}`;

    return `
      <div class="timeline-detail-actions">
        <div class="detail-summary-inline">${resumo}</div>
        ${botaoDetalheHtml(b.codigo_bolao_caixa, Boolean(detalhe), 'Ver')}
      </div>
    `;
  }

  function botaoDetalheHtml(codigoBolao, temDetalhe, label = 'Detalhamento') {
    if (!codigoBolao) return '';
    return `
      <button
        type="button"
        class="btn-detail ${temDetalhe ? 'has-detail' : ''}"
        data-detalhe-bolao="${escapeHtml(codigoBolao)}"
        title="Ver situação real das cotas e atualizar este bolão"
      >
        <i class="fas fa-list-check"></i>
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  async function abrirDetalhamento(codigoBolao) {
    const codigo = String(codigoBolao || '').trim();
    if (!codigo) return;

    state.detalheCodigoAtual = codigo;
    state.detalhePollingToken += 1;
    $('modalDetalheBolao').hidden = false;
    document.body.classList.add('detail-modal-open');

    const bolao = state.boloes.find(b => String(b.codigo_bolao_caixa) === codigo);
    setText(
      'detalheTitulo',
      bolao
        ? `${normalizarModalidade(bolao.modalidade)} · Concurso ${bolao.concurso || '—'}`
        : 'Detalhamento do bolão'
    );
    setText(
      'detalheSubtitulo',
      bolao
        ? `${bolao.nome_loteria || `Lotérica ${bolao.codigo_loterica || '—'}`} · ${descricaoBolao(bolao)}`
        : shortCode(codigo)
    );

    atualizarControlesMonitoramento(codigo);
    definirStatusDetalhe('Consultando o último detalhamento salvo...', 'loading');
    setDetalheBodyLoading();
    await carregarDetalhamento(codigo);
  }

  function fecharDetalhamento() {
    const modal = $('modalDetalheBolao');
    if (modal) modal.hidden = true;
    document.body.classList.remove('detail-modal-open');
    state.detalhePollingToken += 1;
    state.detalheLoading = false;
    state.detalheAtual = null;
    state.detalheCodigoAtual = '';
  }

  async function carregarDetalhamento(codigoBolao, options = {}) {
    const codigo = String(codigoBolao || '').trim();
    if (!codigo || state.detalheLoading) return;

    state.detalheLoading = true;
    atualizarBotaoDetalhe(true, 'Carregando...');

    try {
      const [detalheResult, snapshotsResult, solicitacaoResult] = await Promise.all([
        sb
          .from('marketplace_caixa_detalhes')
          .select('*')
          .eq('codigo_bolao_caixa', codigo)
          .maybeSingle(),

        sb
          .from('marketplace_caixa_detalhes_snapshots')
          .select('id,codigo_bolao_caixa,qtd_cota_total,qtd_cota_disponivel,qtd_cota_fisica,qtd_cota_baixadas_impressas,qtd_cota_vendidas,qtd_cota_reservada,qtd_cota_baixadas,origem_coleta,coletado_em')
          .eq('codigo_bolao_caixa', codigo)
          .order('coletado_em', { ascending: false })
          .limit(12),

        sb
          .from('marketplace_caixa_detalhe_solicitacoes')
          .select('id,status,origem,solicitado_em,iniciado_em,concluido_em,erro,resultado')
          .eq('codigo_bolao_caixa', codigo)
          .order('solicitado_em', { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);

      if (detalheResult.error) throw detalheResult.error;
      if (snapshotsResult.error) throw snapshotsResult.error;
      if (solicitacaoResult.error) throw solicitacaoResult.error;

      const detalhe = detalheResult.data || null;
      const snapshots = snapshotsResult.data || [];
      const solicitacao = solicitacaoResult.data || null;

      state.detalheAtual = detalhe;

      if (detalhe) {
        state.detalhes.set(codigo, detalhe);
      }

      renderDetalhamento(detalhe, snapshots, solicitacao);

      if (!options.preservarStatus) {
        atualizarStatusSolicitacao(detalhe, solicitacao);
      }
    } catch (err) {
      console.error('[Marketplace CAIXA] falha no detalhamento:', err);
      definirStatusDetalhe(err.message || 'Falha ao consultar o detalhamento.', 'error');
      $('detalheBody').innerHTML = `
        <div class="detail-error">
          <i class="fas fa-triangle-exclamation"></i>
          <strong>Não foi possível carregar o detalhamento</strong>
          <span>${escapeHtml(err.message || 'Erro desconhecido.')}</span>
        </div>
      `;
    } finally {
      state.detalheLoading = false;
      atualizarBotaoDetalhe(false, 'Atualizar agora');
    }
  }

  function renderDetalhamento(detalhe, snapshots, solicitacao) {
    const body = $('detalheBody');
    if (!body) return;

    if (!detalhe) {
      body.innerHTML = `
        <div class="detail-empty">
          <i class="fas fa-hourglass-half"></i>
          <strong>Aguardando a primeira coleta detalhada</strong>
          <span>
            O coletor inclui bolões novos automaticamente. Clique em
            “Atualizar agora” para colocar este bolão no início da fila.
          </span>
          ${renderSolicitacaoDetalhe(solicitacao)}
        </div>
      `;
      return;
    }

    const payload = obterPayloadDetalhe(detalhe);
    const conferencia = calcularConferenciaDetalhe(detalhe);
    const apostas = Array.isArray(payload.apostas) ? payload.apostas : [];

    body.innerHTML = `
      <section class="detail-section">
        <div class="detail-section-head">
          <div>
            <h4>Situação atual das cotas</h4>
            <p>Quantidades retornadas diretamente pelo endpoint detalhar-bolao.</p>
          </div>
          <div class="detail-updated">
            <span>Última atualização</span>
            <strong>${escapeHtml(fmtDataHora(detalhe.ultima_coleta_em))}</strong>
            <em>${escapeHtml(rotuloOrigemDetalhe(detalhe.origem_ultima_coleta))}</em>
          </div>
        </div>

        <div class="detail-stat-grid">
          ${detailStat('Disponíveis', detalhe.qtd_cota_disponivel, 'available')}
          ${detailStat('Vendidas', detalhe.qtd_cota_vendidas, 'sold')}
          ${detailStat('Impressas', detalhe.qtd_cota_baixadas_impressas, 'printed')}
          ${detailStat('Reservadas', detalhe.qtd_cota_reservada, 'reserved')}
          ${detailStat('Baixadas', detalhe.qtd_cota_baixadas, 'downloaded')}
          ${detailStat('Físicas', detalhe.qtd_cota_fisica, 'physical')}
        </div>

        <div class="detail-conference ${conferencia.ok ? 'ok' : 'warn'}">
          <span>
            Conferência: disponíveis + vendidas + impressas + reservadas + baixadas + físicas
          </span>
          <strong>${fmtInt(conferencia.soma)} / ${fmtInt(conferencia.total)}</strong>
        </div>

        ${renderSolicitacaoDetalhe(solicitacao)}
      </section>

      <section class="detail-section">
        <div class="detail-section-head">
          <div>
            <h4>Valores e composição</h4>
            <p>Valores do bolão e da cota informados pela CAIXA.</p>
          </div>
        </div>
        <div class="detail-values-grid">
          ${detailValue('Cota sem tarifa', fmtBRL(detalhe.vr_cota_sem_tarifa))}
          ${detailValue('Cota com tarifa', fmtBRL(detalhe.vr_cota_com_tarifa))}
          ${detailValue('Tarifa da cota', fmtBRL(detalhe.vr_tarifa_servico_cota))}
          ${detailValue('Última cota', fmtBRL(detalhe.vr_ultima_cota_com_tarifa))}
          ${detailValue('Total sem tarifa', fmtBRL(detalhe.vr_total_bolao_sem_tarifa))}
          ${detailValue('Total com tarifa', fmtBRL(detalhe.vr_total_bolao_com_tarifa))}
          ${detailValue('Tarifa total', fmtBRL(detalhe.vr_tarifa_bolao))}
          ${detailValue('Apostas', fmtInt(detalhe.qtd_apostas))}
        </div>
      </section>

      <section class="detail-section">
        <div class="detail-section-head">
          <div>
            <h4>Últimas coletas detalhadas</h4>
            <p>Histórico horário e atualizações feitas pelo botão.</p>
          </div>
        </div>
        ${renderHistoricoDetalhe(snapshots)}
      </section>

      <section class="detail-section">
        <div class="detail-section-head">
          <div>
            <h4>Jogos do bolão</h4>
            <p>${apostas.length ? `${apostas.length} aposta(s) retornada(s) pelo detalhamento.` : 'Nenhuma aposta retornada.'}</p>
          </div>
        </div>
        ${renderApostasDetalhe(apostas)}
      </section>
    `;
  }

  function detailStat(label, value, classe) {
    return `
      <div class="detail-stat ${classe}">
        <span>${escapeHtml(label)}</span>
        <strong>${fmtInt(value)}</strong>
      </div>
    `;
  }

  function detailValue(label, value) {
    return `
      <div class="detail-value">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function calcularConferenciaDetalhe(detalhe) {
    const total = int(detalhe.qtd_cota_total);
    const soma =
      int(detalhe.qtd_cota_disponivel) +
      int(detalhe.qtd_cota_vendidas) +
      int(detalhe.qtd_cota_baixadas_impressas) +
      int(detalhe.qtd_cota_reservada) +
      int(detalhe.qtd_cota_baixadas) +
      int(detalhe.qtd_cota_fisica);

    return { total, soma, ok: total === soma };
  }

  function obterPayloadDetalhe(detalhe) {
    const documento = detalhe?.payload_detalhe;
    if (!documento || typeof documento !== 'object') return {};
    const payload = documento.payload;
    return payload && typeof payload === 'object' ? payload : documento;
  }

  function renderSolicitacaoDetalhe(solicitacao) {
    if (!solicitacao) return '';

    const status = String(solicitacao.status || '').toUpperCase();
    const mapa = {
      PENDENTE: ['pending', 'Aguardando o coletor'],
      PROCESSANDO: ['processing', 'Coletor consultando a CAIXA'],
      CONCLUIDO: ['done', 'Atualização concluída'],
      ERRO: ['error', 'Falha na atualização']
    };
    const [classe, titulo] = mapa[status] || ['', status || 'Solicitação'];

    const data =
      solicitacao.concluido_em ||
      solicitacao.iniciado_em ||
      solicitacao.solicitado_em;

    return `
      <div class="detail-request ${classe}">
        <strong>${escapeHtml(titulo)}</strong>
        · ${escapeHtml(fmtDataHora(data))}
        ${solicitacao.origem === 'MANUAL' ? ' · atualização manual' : ''}
        ${solicitacao.erro ? ` · ${escapeHtml(solicitacao.erro)}` : ''}
      </div>
    `;
  }

  function renderHistoricoDetalhe(snapshots) {
    if (!snapshots?.length) {
      return `<div class="empty">Ainda não existem snapshots detalhados deste bolão.</div>`;
    }

    return `
      <div class="detail-history-wrap">
        <table class="detail-history">
          <thead>
            <tr>
              <th>Coletado em</th>
              <th>Disp.</th>
              <th>Vend.</th>
              <th>Impr.</th>
              <th>Reserv.</th>
              <th>Baix.</th>
              <th>Físicas</th>
              <th>Origem</th>
            </tr>
          </thead>
          <tbody>
            ${snapshots.map(s => `
              <tr>
                <td>${escapeHtml(fmtDataHora(s.coletado_em))}</td>
                <td>${fmtInt(s.qtd_cota_disponivel)}</td>
                <td>${fmtInt(s.qtd_cota_vendidas)}</td>
                <td>${fmtInt(s.qtd_cota_baixadas_impressas)}</td>
                <td>${fmtInt(s.qtd_cota_reservada)}</td>
                <td>${fmtInt(s.qtd_cota_baixadas)}</td>
                <td>${fmtInt(s.qtd_cota_fisica)}</td>
                <td>
                  <span class="detail-origin ${s.origem_coleta === 'MANUAL' ? 'manual' : ''}">
                    ${escapeHtml(rotuloOrigemDetalhe(s.origem_coleta, true))}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderApostasDetalhe(apostas) {
    if (!apostas.length) {
      return `<div class="empty">A CAIXA não retornou a composição dos jogos neste detalhamento.</div>`;
    }

    return `
      <div class="detail-bets">
        ${apostas.map((aposta, index) => renderApostaDetalhe(aposta, index)).join('')}
      </div>
    `;
  }

  function renderApostaDetalhe(aposta, index) {
    const dezenas = arrayNumerico(
      aposta?.dezenas ||
      aposta?.numeros ||
      aposta?.numerosApostados
    );
    const trevos = arrayNumerico(
      aposta?.trevos ||
      aposta?.numerosTrevos
    );

    const extras = [];
    if (aposta?.indicadorSurpresinha === true) extras.push('Surpresinha');
    if (aposta?.timeCoracao) extras.push(`Time: ${aposta.timeCoracao}`);
    if (aposta?.mesSorte) extras.push(`Mês: ${aposta.mesSorte}`);

    const camposNaoExibidos = Object.entries(aposta || {})
      .filter(([chave, valor]) =>
        !['dezenas', 'numeros', 'numerosApostados', 'trevos', 'numerosTrevos', 'indicadorSurpresinha', 'timeCoracao', 'mesSorte'].includes(chave)
        && valor !== null
        && valor !== undefined
        && typeof valor !== 'object'
      )
      .slice(0, 4)
      .map(([chave, valor]) => `${normalizarCampo(chave)}: ${valor}`);

    return `
      <article class="detail-bet">
        <div class="detail-bet-head">
          <strong>Jogo ${index + 1}</strong>
          <span>${extras.join(' · ') || 'Aposta registrada'}</span>
        </div>
        <div class="detail-number-list">
          ${dezenas.length
            ? dezenas.map(n => `<span class="detail-number">${escapeHtml(formatarNumeroAposta(n))}</span>`).join('')
            : '<span class="detail-extra-line">Sem dezenas numéricas para exibir.</span>'
          }
          ${trevos.map(n => `<span class="detail-number trevo" title="Trevo">${escapeHtml(formatarNumeroAposta(n))}</span>`).join('')}
        </div>
        ${(camposNaoExibidos.length || extras.length)
          ? `<div class="detail-extra-line">${escapeHtml([...extras, ...camposNaoExibidos].join(' · '))}</div>`
          : ''
        }
      </article>
    `;
  }

  function arrayNumerico(valor) {
    if (!Array.isArray(valor)) return [];
    return valor.filter(v => v !== null && v !== undefined && v !== '');
  }

  function formatarNumeroAposta(v) {
    const n = Number(v);
    return Number.isFinite(n) ? String(n).padStart(2, '0') : String(v);
  }

  function normalizarCampo(campo) {
    return String(campo || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' ')
      .toLowerCase();
  }

  function atualizarControlesMonitoramento(codigoBolao) {
    const codigo = String(codigoBolao || '').trim();
    const monitoramento = state.monitoramentos.get(codigo);
    const intervalo = monitoramento?.ativo
      ? Number(monitoramento.intervalo_minutos || 60)
      : 60;

    const select = $('detalheIntervaloMonitoramento');
    if (select) select.value = String(intervalo);

    const status = $('detalheMonitoramentoStatus');
    if (status) {
      status.textContent = intervalo === 60
        ? 'Padrão: a cada 60 minutos'
        : `Intensivo: a cada ${intervalo} minuto(s)`;
      status.className = intervalo === 60 ? '' : 'intensive';
    }

    const button = $('btnSalvarMonitoramento');
    if (button) {
      button.classList.toggle('active', intervalo !== 60);
    }
  }

  async function salvarMonitoramentoDetalhe() {
    const codigo = state.detalheCodigoAtual;
    const select = $('detalheIntervaloMonitoramento');
    const intervalo = Number(select?.value || 60);
    const button = $('btnSalvarMonitoramento');

    if (!codigo || !Number.isFinite(intervalo)) return;

    if (button) {
      button.disabled = true;
      const span = button.querySelector('span');
      if (span) span.textContent = 'Salvando...';
    }

    definirStatusDetalhe('Salvando a frequência deste bolão...', 'loading');

    try {
      const { data, error } = await sb.rpc(
        'marketplace_caixa_configurar_monitoramento_detalhe',
        {
          p_codigo_bolao_caixa: codigo,
          p_intervalo_minutos: intervalo
        }
      );

      if (error) throw error;

      if (intervalo === 60) {
        state.monitoramentos.delete(codigo);
      } else {
        state.monitoramentos.set(codigo, {
          codigo_bolao_caixa: codigo,
          intervalo_minutos: intervalo,
          ativo: true,
          atualizado_em: new Date().toISOString()
        });
      }

      atualizarControlesMonitoramento(codigo);
      renderTimeline();
      renderBoloes();

      definirStatusDetalhe(
        data?.mensagem ||
        (intervalo === 60
          ? 'Monitoramento normal restaurado: 60 minutos.'
          : `Monitoramento intensivo ativado a cada ${intervalo} minuto(s).`),
        'ok'
      );
    } catch (error) {
      console.error('[Marketplace CAIXA] falha ao salvar monitoramento:', error);
      definirStatusDetalhe(
        error.message || 'Não foi possível salvar a frequência.',
        'error'
      );
    } finally {
      if (button) {
        button.disabled = false;
        const span = button.querySelector('span');
        if (span) span.textContent = 'Salvar frequência';
      }
    }
  }

  function rotuloOrigemDetalhe(origem, curto = false) {
    const value = String(origem || '').toUpperCase();

    if (value === 'MANUAL') {
      return curto ? 'Manual' : 'solicitação manual';
    }

    if (value === 'INTENSIVO') {
      return curto ? 'Intensivo' : 'monitoramento intensivo';
    }

    if (value === 'FECHAMENTO_2044') {
      return curto ? '20:44' : 'coleta pré-encerramento das 20:44';
    }

    return curto ? 'Automático' : 'coleta automática de 60 minutos';
  }

  async function solicitarAtualizacaoDetalhe() {
    const codigo = state.detalheCodigoAtual;
    if (!codigo || state.detalheLoading) return;

    const coletaAnterior = state.detalheAtual?.ultima_coleta_em || null;
    atualizarBotaoDetalhe(true, 'Solicitando...');
    definirStatusDetalhe('Enviando solicitação ao coletor...', 'loading');

    try {
      const { data, error } = await sb.rpc(
        'marketplace_caixa_solicitar_detalhe',
        { p_codigo_bolao_caixa: codigo }
      );

      if (error) throw error;

      const resposta = data || {};
      const status = String(resposta.status || '').toUpperCase();

      if (status === 'ATUALIZADO_RECENTE') {
        definirStatusDetalhe(
          resposta.mensagem || 'Este bolão foi atualizado há menos de um minuto.',
          'ok'
        );
        await carregarDetalhamento(codigo, { preservarStatus: true });
        return;
      }

      definirStatusDetalhe(
        resposta.mensagem || 'Atualização solicitada. Aguardando o coletor...',
        status === 'PROCESSANDO' ? 'loading' : 'warn'
      );

      const token = ++state.detalhePollingToken;
      await aguardarAtualizacaoDetalhe(codigo, coletaAnterior, token);
    } catch (err) {
      console.error('[Marketplace CAIXA] erro ao solicitar detalhe:', err);
      definirStatusDetalhe(err.message || 'Não foi possível solicitar a atualização.', 'error');
    } finally {
      atualizarBotaoDetalhe(false, 'Atualizar agora');
    }
  }

  async function aguardarAtualizacaoDetalhe(codigo, coletaAnterior, token) {
    const limiteTentativas = 45;

    for (let tentativa = 0; tentativa < limiteTentativas; tentativa += 1) {
      await esperar(2000);

      if (
        token !== state.detalhePollingToken ||
        codigo !== state.detalheCodigoAtual ||
        $('modalDetalheBolao')?.hidden
      ) {
        return;
      }

      const [detalheResult, solicitacaoResult] = await Promise.all([
        sb
          .from('marketplace_caixa_detalhes')
          .select('codigo_bolao_caixa,ultima_coleta_em')
          .eq('codigo_bolao_caixa', codigo)
          .maybeSingle(),

        sb
          .from('marketplace_caixa_detalhe_solicitacoes')
          .select('status,erro,concluido_em')
          .eq('codigo_bolao_caixa', codigo)
          .order('solicitado_em', { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);

      if (detalheResult.error) throw detalheResult.error;
      if (solicitacaoResult.error) throw solicitacaoResult.error;

      const novaColeta = detalheResult.data?.ultima_coleta_em || null;
      const status = String(solicitacaoResult.data?.status || '').toUpperCase();

      if (status === 'ERRO') {
        definirStatusDetalhe(
          solicitacaoResult.data?.erro || 'O coletor não conseguiu atualizar este bolão.',
          'error'
        );
        await carregarDetalhamento(codigo, { preservarStatus: true });
        return;
      }

      if (
        status === 'CONCLUIDO' ||
        (novaColeta && (!coletaAnterior || new Date(novaColeta) > new Date(coletaAnterior)))
      ) {
        definirStatusDetalhe('Detalhamento atualizado com sucesso.', 'ok');
        await carregarDetalhamento(codigo, { preservarStatus: true });

        const detalhes = await buscarDetalhesResumoSeguro();
        state.detalhes = new Map(
          detalhes.map(d => [String(d.codigo_bolao_caixa), d])
        );
        renderTimeline();
        renderBoloes();
        return;
      }

      definirStatusDetalhe(
        status === 'PROCESSANDO'
          ? 'Coletor consultando a CAIXA...'
          : 'Solicitação na fila. Aguardando o próximo ciclo do coletor...',
        status === 'PROCESSANDO' ? 'loading' : 'warn'
      );
    }

    definirStatusDetalhe(
      'A solicitação continua na fila. Confirme se o coletor do Windows está aberto.',
      'warn'
    );
    await carregarDetalhamento(codigo, { preservarStatus: true });
  }

  function atualizarStatusSolicitacao(detalhe, solicitacao) {
    const status = String(solicitacao?.status || '').toUpperCase();

    if (status === 'PENDENTE') {
      definirStatusDetalhe('Atualização aguardando o coletor do Windows.', 'warn');
      return;
    }

    if (status === 'PROCESSANDO') {
      definirStatusDetalhe('Coletor consultando o detalhe deste bolão...', 'loading');
      return;
    }

    if (status === 'ERRO') {
      definirStatusDetalhe(solicitacao.erro || 'Última atualização falhou.', 'error');
      return;
    }

    if (detalhe) {
      definirStatusDetalhe(
        `Último detalhe salvo em ${fmtDataHora(detalhe.ultima_coleta_em)}.`,
        'ok'
      );
      return;
    }

    definirStatusDetalhe('Ainda não existe detalhamento salvo para este bolão.', 'warn');
  }

  function definirStatusDetalhe(texto, tipo = '') {
    const el = $('detalheStatus');
    if (!el) return;
    el.textContent = texto || '';
    el.className = `detail-status ${tipo}`.trim();
  }

  function atualizarBotaoDetalhe(loading, texto) {
    const btn = $('btnAtualizarDetalhe');
    if (!btn) return;
    btn.disabled = Boolean(loading);
    const span = btn.querySelector('span');
    const icon = btn.querySelector('i');

    if (span) span.textContent = texto || 'Atualizar agora';
    if (icon) {
      icon.className = loading
        ? 'fas fa-circle-notch fa-spin'
        : 'fas fa-rotate';
    }
  }

  function setDetalheBodyLoading() {
    const body = $('detalheBody');
    if (!body) return;
    body.innerHTML = `
      <div class="detail-loading">
        <i class="fas fa-circle-notch fa-spin"></i>
        <span>Carregando detalhamento...</span>
      </div>
    `;
  }

  function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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