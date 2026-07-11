(function () {
  'use strict';

  const CONFIG = window.SISLOT_CONFIG || {};
  const PAGE_SIZE = 1000;

  if (!window.supabase || !CONFIG.url || !CONFIG.anonKey) {
    document.addEventListener('DOMContentLoaded', () => mostrarAviso('Configuração do Supabase não encontrada. Confira sislot-config.js.'));
    return;
  }

  const sb = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
  const $ = (id) => document.getElementById(id);
  const int = (value) => Number(value || 0);

  const state = {
    usuario: null,
    snapshots: [],
    series: [],
    cadastroLoterias: new Map(),
    loading: false
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindUI();
    startClock();
    definirPeriodoPadrao();

    try {
      await validarSessao();
      await carregarCadastroLoterias();
      await carregarOpcoesIniciais();
    } catch (error) {
      console.error('[Histórico Marketplace] falha inicial', error);
      mostrarAviso(error.message || 'Erro ao iniciar histórico.');
    }
  }

  function bindUI() {
    $('btnBuscar')?.addEventListener('click', buscarHistorico);
    $('btnLimpar')?.addEventListener('click', limparFiltros);
    $('btnExportarCsv')?.addEventListener('click', exportarCsv);
    $('btnConcursoAnterior')?.addEventListener('click', selecionarConcursoAnterior);
    $('btnLogout')?.addEventListener('click', async () => {
      if (window.SISLOT_SECURITY?.sair) {
        await window.SISLOT_SECURITY.sair();
      } else {
        await sb.auth.signOut();
        location.href = './login.html';
      }
    });
    $('filtroModalidade')?.addEventListener('change', carregarConcursosRecentesDaModalidade);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target?.matches('input,select')) {
        buscarHistorico();
      }
    });
  }

  function startClock() {
    const update = () => {
      const now = new Date();
      setText('relogio', now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR'));
    };
    update();
    setInterval(update, 1000);
  }

  function definirPeriodoPadrao() {
    const fim = new Date();
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - 30);
    if ($('filtroDataInicial')) $('filtroDataInicial').value = isoDate(inicio);
    if ($('filtroDataFinal')) $('filtroDataFinal').value = isoDate(fim);
  }

  async function validarSessao() {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) throw new Error(error.message || 'Erro ao verificar sessão.');
    if (!session?.user?.id) {
      location.href = './login.html';
      throw new Error('Sessão não encontrada.');
    }

    if (window.SISLOT_SECURITY?.validarUsuarioLogavel) {
      state.usuario = await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
    } else {
      state.usuario = { nome: session.user.email || 'Usuário' };
    }
  }

  async function carregarCadastroLoterias() {
    const tentativas = [
      'codigo_caixa,nome,ativo',
      'codigo_caixa,nome'
    ];

    for (const select of tentativas) {
      const { data, error } = await sb
        .from('marketplace_caixa_loterias')
        .select(select)
        .order('nome', { ascending: true });

      if (!error) {
        (data || []).forEach((loja) => {
          const codigo = String(loja.codigo_caixa || '').trim();
          if (!codigo) return;
          state.cadastroLoterias.set(codigo, {
            codigo,
            nome: loja.nome || `Lotérica ${codigo}`
          });
        });
        return;
      }
    }

    console.warn('[Histórico Marketplace] cadastro de lotéricas indisponível; usando snapshots e lista local.');
  }

  async function carregarOpcoesIniciais() {
    atualizarLive('Preparando histórico', 'Buscando modalidades e lotéricas já coletadas...');

    const recentes = await buscarSnapshotsPaginados({
      apenasColunas: 'codigo_loterica,modalidade,concurso,coletado_em',
      dataInicial: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      limiteMaximo: 8000
    });

    recentes.forEach((row) => {
      const codigo = String(row.codigo_loterica || '').trim();
      if (codigo && !state.cadastroLoterias.has(codigo)) {
        state.cadastroLoterias.set(codigo, {
          codigo,
          nome: `Lotérica ${codigo}`
        });
      }
    });

    preencherSelect(
      $('filtroModalidade'),
      [...new Set(recentes.map((row) => row.modalidade).filter(Boolean))]
        .sort()
        .map((modalidade) => [modalidade, normalizarModalidade(modalidade)])
    );

    atualizarFiltroLojas();
    atualizarLive('Histórico pronto', 'Informe um concurso ou período e clique em buscar.');
  }

  async function carregarConcursosRecentesDaModalidade() {
    const modalidade = $('filtroModalidade')?.value || '';
    if (!modalidade) return;

    const recentes = await buscarSnapshotsPaginados({
      apenasColunas: 'concurso,modalidade,coletado_em',
      modalidade,
      dataInicial: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
      limiteMaximo: 5000
    });

    const concursos = [...new Set(recentes.map((row) => Number(row.concurso)).filter(Number.isFinite))]
      .sort((a, b) => b - a);

    const input = $('filtroConcurso');
    if (input) {
      if (!input.value && concursos.length) input.placeholder = `Ex.: ${concursos[0]}`;
      input.dataset.concursos = concursos.slice(0, 30).join(',');
    }
  }

  function atualizarFiltroLojas() {
    const atual = $('filtroLoja')?.value || '';

    const lojas = [...state.cadastroLoterias.values()]
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
      .map((loja) => [loja.codigo, `${loja.codigo} — ${loja.nome}`]);

    preencherSelect($('filtroLoja'), lojas);

    if ([...($('filtroLoja')?.options || [])].some((option) => option.value === atual)) {
      $('filtroLoja').value = atual;
    }
  }

  async function selecionarConcursoAnterior() {
    const input = $('filtroConcurso');
    const atual = Number(input?.value || 0);

    if (atual > 0) {
      input.value = String(atual - 1);
      await buscarHistorico();
      return;
    }

    const modalidade = $('filtroModalidade')?.value || '';
    if (!modalidade) {
      mostrarAviso('Selecione uma modalidade ou informe um concurso atual.');
      return;
    }

    await carregarConcursosRecentesDaModalidade();
    const concursos = String(input?.dataset.concursos || '')
      .split(',')
      .map(Number)
      .filter(Number.isFinite);

    if (concursos.length > 1) {
      input.value = String(concursos[1]);
      await buscarHistorico();
    } else {
      mostrarAviso('Não encontrei um concurso anterior no período pesquisado.');
    }
  }

  async function buscarHistorico() {
    if (state.loading) return;

    state.loading = true;
    mostrarAviso('');
    atualizarLive('Buscando histórico', 'Consultando snapshots antigos no Supabase...');

    try {
      const filtros = obterFiltros();
      validarFiltros(filtros);

      state.snapshots = await buscarSnapshotsPaginados({
        loja: filtros.loja,
        modalidade: filtros.modalidade,
        concurso: filtros.concurso,
        dataInicial: filtros.dataInicial,
        dataFinal: filtros.dataFinal
      });

      montarSeries();
      renderTudo();

      atualizarLive(
        'Histórico carregado',
        `${state.snapshots.length.toLocaleString('pt-BR')} snapshots · ${state.series.length.toLocaleString('pt-BR')} bolões`
      );
    } catch (error) {
      console.error('[Histórico Marketplace] falha na busca', error);
      mostrarAviso(error.message || 'Erro ao buscar histórico.');
      atualizarLive('Erro na busca', error.message || 'Falha ao consultar snapshots.');
    } finally {
      state.loading = false;
    }
  }

  function obterFiltros() {
    const inicio = $('filtroDataInicial')?.value || '';
    const fim = $('filtroDataFinal')?.value || '';

    return {
      loja: $('filtroLoja')?.value || '',
      modalidade: $('filtroModalidade')?.value || '',
      concurso: $('filtroConcurso')?.value || '',
      dataInicial: inicio ? `${inicio}T00:00:00-03:00` : '',
      dataFinal: fim ? `${fim}T23:59:59.999-03:00` : ''
    };
  }

  function validarFiltros(filtros) {
    if (!filtros.concurso && !filtros.modalidade && !filtros.loja) {
      if (!filtros.dataInicial || !filtros.dataFinal) {
        throw new Error('Informe um concurso, modalidade, lotérica ou período completo.');
      }

      const dias = (new Date(filtros.dataFinal).getTime() - new Date(filtros.dataInicial).getTime()) / 86400000;
      if (dias > 90) {
        throw new Error('Para uma busca ampla, use um período máximo de 90 dias.');
      }
    }
  }

  async function buscarSnapshotsPaginados({
    apenasColunas = 'codigo_bolao_caixa,codigo_loterica,modalidade,concurso,qtd_cota_total,qtd_cota_digital,qtd_cota_disponivel,qtd_cota_indisponivel,valor_cota,coletado_em,pagina_origem,payload_caixa',
    loja = '',
    modalidade = '',
    concurso = '',
    dataInicial = '',
    dataFinal = '',
    limiteMaximo = 50000
  } = {}) {
    const rows = [];

    for (let from = 0; from < limiteMaximo; from += PAGE_SIZE) {
      let query = sb
        .from('marketplace_caixa_snapshots')
        .select(apenasColunas)
        .order('coletado_em', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (loja) query = query.eq('codigo_loterica', loja);
      if (modalidade) query = query.eq('modalidade', modalidade);
      if (concurso) query = query.eq('concurso', Number(concurso));
      if (dataInicial) query = query.gte('coletado_em', dataInicial);
      if (dataFinal) query = query.lte('coletado_em', dataFinal);

      const { data, error } = await query;
      if (error) throw error;

      const page = data || [];
      rows.push(...page);

      if (page.length < PAGE_SIZE) break;
    }

    return rows;
  }

  function montarSeries() {
    const byBolao = new Map();

    state.snapshots.forEach((snapshot) => {
      const codigoBolao = String(snapshot.codigo_bolao_caixa || '');
      if (!codigoBolao) return;


      if (!byBolao.has(codigoBolao)) byBolao.set(codigoBolao, []);

      byBolao.get(codigoBolao).push({
        ...snapshot,
        qtd_cota_disponivel: int(snapshot.qtd_cota_disponivel)
      });
    });

    state.series = [...byBolao.entries()]
      .map(([codigoBolao, pontos]) => {
        pontos.sort((a, b) => new Date(a.coletado_em) - new Date(b.coletado_em));

        const stats = calcularSerie(pontos);
        const primeiro = pontos[0] || {};
        const loja = obterLoja(primeiro.codigo_loterica);

        return {
          codigoBolao,
          pontos,
          loja,
          modalidade: primeiro.modalidade,
          concurso: primeiro.concurso,
          qtdTotal: int(primeiro.qtd_cota_total),
          qtdDigital: int(primeiro.qtd_cota_digital),
          valorCota: Number(primeiro.valor_cota || 0),
          pagina: paginaOrigem(primeiro),
          ...stats
        };
      })
      .sort((a, b) =>
        b.movimentoTotal - a.movimentoTotal ||
        String(a.loja.nome).localeCompare(String(b.loja.nome), 'pt-BR')
      );
  }

  function calcularSerie(pontos) {
    if (!pontos.length) {
      return { inicio: 0, atual: 0, min: 0, max: 0, delta: 0, saidas: 0, entradas: 0, movimentoTotal: 0 };
    }

    const valores = pontos.map((ponto) => int(ponto.qtd_cota_disponivel));
    let saidas = 0;
    let entradas = 0;

    for (let index = 1; index < pontos.length; index += 1) {
      const delta = int(pontos[index].qtd_cota_disponivel) - int(pontos[index - 1].qtd_cota_disponivel);
      if (delta < 0) saidas += Math.abs(delta);
      if (delta > 0) entradas += delta;
    }

    return {
      inicio: valores[0],
      atual: valores[valores.length - 1],
      min: Math.min(...valores),
      max: Math.max(...valores),
      delta: valores[valores.length - 1] - valores[0],
      saidas,
      entradas,
      movimentoTotal: saidas + entradas,
      primeiraColeta: pontos[0].coletado_em,
      ultimaColeta: pontos[pontos.length - 1].coletado_em
    };
  }

  function renderTudo() {
    renderStats();
    renderLista();
  }

  function renderStats() {
    const lojas = new Set(state.series.map((item) => item.loja.codigo));
    const saidas = state.series.reduce((total, item) => total + item.saidas, 0);
    const entradas = state.series.reduce((total, item) => total + item.entradas, 0);
    const delta = state.series.reduce((total, item) => total + item.delta, 0);
    const datas = state.snapshots.map((item) => item.coletado_em).filter(Boolean).sort();

    setText('statBoloes', fmtInt(state.series.length));
    setText('statLojas', fmtInt(lojas.size));
    setText('statSnapshots', fmtInt(state.snapshots.length));
    setText('statSaidas', fmtInt(saidas));
    setText('statEntradas', fmtInt(entradas));
    setText('statPeriodo', datas.length ? `${fmtDataCurta(datas[0])} → ${fmtDataCurta(datas[datas.length - 1])}` : '—');
  }

  function renderLista() {
    const box = $('historyList');
    if (!box) return;

    const filtros = obterFiltros();

    setText(
      'resultadoResumo',
      `${state.series.length} bolão(ões) · ${state.snapshots.length} snapshots` +
      `${filtros.concurso ? ` · concurso ${filtros.concurso}` : ''}`
    );

    if (!state.series.length) {
      box.innerHTML = '<div class="empty history-empty">Nenhum dado histórico encontrado para os filtros selecionados.</div>';
      return;
    }

    box.innerHTML = state.series.map(renderLinha).join('');
  }

  function renderLinha(item) {
    const classeMovimento =
      item.delta < 0 ? 'movement-down' :
      item.delta > 0 ? 'movement-up' :
      'movement-stable';

    return `
      <article class="timeline-row history-row ${classeMovimento}">
        <div class="timeline-info">
          <div class="timeline-head">
            <span class="mod-chip">${escapeHtml(normalizarModalidade(item.modalidade))}</span>
            <span class="page-chip">Pág. ${escapeHtml(item.pagina)}</span>
            <span class="code-chip">Lotérica ${escapeHtml(item.loja.codigo)}</span>
            <span class="code-chip" title="${escapeHtml(item.codigoBolao)}">${escapeHtml(shortCode(item.codigoBolao))}</span>
          </div>
          <h3 class="timeline-title">Conc. ${escapeHtml(item.concurso || '—')} · ${escapeHtml(item.loja.nome || item.loja.codigo)}</h3>
          <div class="timeline-meta">
            <span>Total ${fmtInt(item.qtdTotal)} · Digital ${fmtInt(item.qtdDigital)}</span>
            <span>${fmtBRL(item.valorCota)}</span>
          </div>
          <div class="history-period">${fmtDataHora(item.primeiraColeta)} → ${fmtDataHora(item.ultimaColeta)}</div>
        </div>

        <div class="series-box">${renderSparkline(item)}</div>

        <div class="timeline-summary">
          <div class="history-first-last">
            <div class="mini-stat"><span>Inicial</span><strong>${fmtInt(item.inicio)}</strong></div>
            <div class="mini-stat"><span>Final</span><strong>${fmtInt(item.atual)}</strong></div>
          </div>
          <div class="summary-chips">
            <div class="sum-chip down"><span>Saídas</span><strong>${fmtInt(item.saidas)}</strong></div>
            <div class="sum-chip up"><span>Reposições</span><strong>${fmtInt(item.entradas)}</strong></div>
            <div class="sum-chip"><span>Mín/Máx</span><strong>${fmtInt(item.min)} / ${fmtInt(item.max)}</strong></div>
            <div class="sum-chip delta ${item.delta < 0 ? 'negative' : item.delta > 0 ? 'positive' : ''}">
              <span>Δ líquido</span><strong>${item.delta > 0 ? '+' : ''}${fmtInt(item.delta)}</strong>
            </div>
          </div>
          <div class="history-snapshot-count">${fmtInt(item.pontos.length)} snapshots</div>
        </div>
      </article>
    `;
  }

  function renderSparkline(item) {
    const pontos = item.pontos;
    if (!pontos.length) return '<div class="empty">Sem snapshots.</div>';

    const width = 560;
    const height = 62;
    const padX = 14;
    const padY = 11;
    const span = Math.max(item.max - item.min, 1);

    const tempos = pontos.map((ponto) => {
      const timestamp = new Date(ponto.coletado_em).getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    });

    const tempoInicial = Math.min(...tempos);
    const tempoFinal = Math.max(...tempos);
    const intervaloTempo = Math.max(tempoFinal - tempoInicial, 1);

    const coords = pontos.map((ponto, index) => {
      const proporcaoTempo = pontos.length === 1
        ? 0.5
        : (tempos[index] - tempoInicial) / intervaloTempo;

      return {
        x: padX + proporcaoTempo * (width - padX * 2),
        y: padY + ((item.max - int(ponto.qtd_cota_disponivel)) / span) * (height - padY * 2),
        d: int(ponto.qtd_cota_disponivel),
        t: ponto.coletado_em
      };
    });

    let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
    for (let index = 1; index < coords.length; index += 1) {
      path += ` H ${coords[index].x.toFixed(2)} V ${coords[index].y.toFixed(2)}`;
    }

    const area = `${path} V ${height - padY} H ${coords[0].x.toFixed(2)} Z`;
    const labels = selecionarLabels(coords, item.min, item.max)
      .map((coord) => {
        const left = Math.max(4, Math.min(96, (coord.x / width) * 100));
        const top = Math.max(11, Math.min(57, 5 + (coord.y / height) * 51 - 9));
        return `<span class="spark-label ${coord.d === item.min ? 'min' : ''} ${coord.d === item.max ? 'max' : ''}" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}px">${fmtInt(coord.d)}</span>`;
      })
      .join('');

    const dots = coords
      .map((coord, index) =>
        `<circle class="spark-dot ${index === coords.length - 1 ? 'last' : ''}" cx="${coord.x.toFixed(2)}" cy="${coord.y.toFixed(2)}" r="${index === coords.length - 1 ? '3.2' : '2.5'}"><title>${fmtDataHora(coord.t)} · ${coord.d} disponíveis</title></circle>`
      )
      .join('');

    return `
      <div class="spark-wrap">
        <svg class="spark-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          <path class="spark-area" d="${area}"></path>
          <path class="spark-line" d="${path}"></path>
          ${dots}
        </svg>
        ${labels}
      </div>
      <div class="series-scale">
        <span>${fmtDataCurta(item.primeiraColeta)}</span>
        <span>${fmtInt(item.min)}–${fmtInt(item.max)} cotas</span>
        <span>${fmtDataCurta(item.ultimaColeta)}</span>
      </div>
    `;
  }

  function selecionarLabels(coords, min, max) {
    const pesos = [];
    const indices = new Set([0, coords.length - 1]);

    coords.forEach((coord, index) => {
      if (coord.d === min || coord.d === max) indices.add(index);
    });

    for (let index = 1; index < coords.length; index += 1) {
      const delta = Math.abs(coords[index].d - coords[index - 1].d);
      if (delta > 0) pesos.push({ index, delta });
    }

    pesos
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 4)
      .forEach((item) => indices.add(item.index));

    return [...indices]
      .sort((a, b) => a - b)
      .slice(0, 8)
      .map((index) => coords[index]);
  }

  function limparFiltros() {
    $('filtroLoja').value = '';
    $('filtroModalidade').value = '';
    $('filtroConcurso').value = '';
    definirPeriodoPadrao();
    state.snapshots = [];
    state.series = [];
    renderTudo();
    atualizarFiltroLojas();
    atualizarLive('Filtros limpos', 'Informe os critérios e faça uma nova busca.');
  }

  function exportarCsv() {
    if (!state.series.length) {
      mostrarAviso('Faça uma busca antes de exportar.');
      return;
    }

    const rows = state.series.map((item) => ({
      codigo_loterica: item.loja.codigo,
      nome_loteria: item.loja.nome,
      modalidade: item.modalidade,
      concurso: item.concurso,
      pagina_caixa: item.pagina,
      codigo_bolao_caixa: item.codigoBolao,
      snapshots: item.pontos.length,
      disponibilidade_inicial: item.inicio,
      disponibilidade_final: item.atual,
      disponibilidade_minima: item.min,
      disponibilidade_maxima: item.max,
      saidas_observadas: item.saidas,
      reposicoes: item.entradas,
      variacao_liquida: item.delta,
      primeira_coleta: item.primeiraColeta,
      ultima_coleta: item.ultimaColeta
    }));

    baixarCsv('historico-marketplace.csv', rows);
  }

  function obterLoja(codigo) {
    const key = String(codigo || '').trim();

    return state.cadastroLoterias.get(key) || {
      codigo: key,
      nome: `Lotérica ${key}`
    };
  }

  function paginaOrigem(snapshot) {
    const payload = snapshot?.payload_caixa || {};
    const candidatos = [
      snapshot?.pagina_origem,
      snapshot?.paginaOrigem,
      payload?.paginaOrigem,
      payload?.pagina_origem,
      payload?.pagina,
      payload?.paginaAtual
    ];

    for (const value of candidatos) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? String(number) : String(value);
    }

    return '—';
  }

  function preencherSelect(select, entries) {
    if (!select) return;

    const atual = select.value;
    const primeira = select.querySelector('option')?.outerHTML || '<option value="">Todas</option>';

    select.innerHTML =
      primeira +
      entries.map(([value, label]) =>
        `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
      ).join('');

    select.value = [...select.options].some((option) => option.value === atual) ? atual : '';
  }

  function atualizarLive(titulo, subtitulo) {
    setText('liveStatusTitulo', titulo);
    setText('liveStatusSub', subtitulo);
  }

  function mostrarAviso(message) {
    const element = $('mpAviso');
    if (!element) return;
    element.textContent = message || '';
    element.hidden = !message;
  }

  function baixarCsv(nome, rows) {
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(';'),
      ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(';'))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = nome;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
  }

  function normalizarModalidade(value) {
    return String(value || '—').replaceAll('_', ' ');
  }

  function isoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function fmtInt(value) {
    return int(value).toLocaleString('pt-BR');
  }

  function fmtBRL(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function fmtDataHora(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  function fmtDataCurta(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';

    return date.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function shortCode(value) {
    return value ? String(value).slice(0, 8) + '…' : '—';
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value ?? '—';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));
  }
})();
