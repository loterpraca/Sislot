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
    detalheCodigoAtual: '',
    detalheItemAtual: null,
    detalheDocumentoAtual: null,
    detalheSnapshotsAtuais: [],
    detalheLoading: false,
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
    $('btnFecharHistoricoDetalhe')?.addEventListener('click', fecharHistoricoDetalhe);
    $('btnExportarHistoricoDetalhe')?.addEventListener('click', exportarHistoricoDetalhe);

    $('modalHistoricoDetalhe')?.addEventListener('click', (event) => {
      if (event.target?.id === 'modalHistoricoDetalhe') fecharHistoricoDetalhe();
    });

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-history-detail]');
      if (!button) return;
      abrirHistoricoDetalhe(button.dataset.historyDetail);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('modalHistoricoDetalhe')?.hidden) {
        fecharHistoricoDetalhe();
        return;
      }

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
  state.cadastroLoterias.clear();

  // Primeiro tenta o cadastro oficial das lotéricas.
  const { data: cadastro, error: erroCadastro } = await sb
    .from('marketplace_caixa_loterias')
    .select('codigo_caixa,nome')
    .order('nome', { ascending: true });

  if (!erroCadastro) {
    (cadastro || []).forEach((loja) => {
      registrarLoja(
        loja.codigo_caixa,
        loja.nome
      );
    });
  } else {
    console.warn(
      '[Histórico Marketplace] não foi possível carregar marketplace_caixa_loterias:',
      erroCadastro
    );
  }

  // Complementa com os nomes já existentes nos bolões coletados.
  const { data: boloes, error: erroBoloes } = await sb
    .from('marketplace_caixa_boloes')
    .select(
      'codigo_loterica,nome_loteria,payload_caixa'
    )
    .limit(5000);

  if (!erroBoloes) {
    (boloes || []).forEach((bolao) => {
      registrarLoja(
        bolao.codigo_loterica,
        bolao.nome_loteria ||
          nomeLoteriaPayload(
            bolao.payload_caixa
          )
      );
    });
  } else {
    console.warn(
      '[Histórico Marketplace] não foi possível carregar nomes dos bolões:',
      erroBoloes
    );
  }
}

  async function carregarOpcoesIniciais() {
    atualizarLive('Preparando histórico', 'Buscando modalidades e lotéricas já coletadas...');

    const recentes = await buscarSnapshotsPaginados({
      apenasColunas:'codigo_loterica,modalidade,concurso,coletado_em,payload_caixa',
      dataInicial: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      limiteMaximo: 8000
    });

recentes.forEach((row) => {
  registrarLoja(
    row.codigo_loterica,
    nomeLoteriaPayload(row.payload_caixa)
  );
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

registrarLoja(
  primeiro.codigo_loterica,
  nomeLoteriaPayload(
    primeiro.payload_caixa
  )
);

const loja = obterLoja(
  primeiro.codigo_loterica
);

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
          <div class="history-snapshot-count">${fmtInt(item.pontos.length)} snapshots de disponibilidade</div>
          <div class="history-detail-action">
            <button
              class="btn-history-detail"
              type="button"
              data-history-detail="${escapeHtml(item.codigoBolao)}"
              title="Ver vendas, impressões, reservas e baixas coletadas para este bolão"
            >
              <i class="fas fa-list-check"></i>
              Detalhes reais
            </button>
          </div>
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
const denom = Math.max(pontos.length - 1, 1);

const coords = pontos.map((ponto, index) => ({
  x:
    padX +
    (index / denom) *
      (width - padX * 2),

  y:
    padY +
    (
      (
        item.max -
        int(ponto.qtd_cota_disponivel)
      ) / span
    ) *
      (height - padY * 2),

  d: int(ponto.qtd_cota_disponivel),
  t: ponto.coletado_em
}));

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


  async function abrirHistoricoDetalhe(codigoBolao) {
    const codigo = String(codigoBolao || '').trim();
    if (!codigo || state.detalheLoading) return;

    const item = state.series.find((serie) => serie.codigoBolao === codigo) || null;

    state.detalheCodigoAtual = codigo;
    state.detalheItemAtual = item;
    state.detalheDocumentoAtual = null;
    state.detalheSnapshotsAtuais = [];

    $('modalHistoricoDetalhe').hidden = false;
    document.body.classList.add('history-detail-open');

    setText(
      'historyDetailTitle',
      item
        ? `${normalizarModalidade(item.modalidade)} · Concurso ${item.concurso || '—'}`
        : 'Detalhamento histórico do bolão'
    );

    setText(
      'historyDetailSubtitle',
      item
        ? `${item.loja.nome || item.loja.codigo} · Lotérica ${item.loja.codigo} · ${shortCode(codigo)}`
        : shortCode(codigo)
    );

    definirStatusHistoricoDetalhe('Consultando snapshots detalhados...', 'loading');
    definirCorpoHistoricoDetalheLoading();
    atualizarBotaoExportarHistoricoDetalhe(false);

    state.detalheLoading = true;

    try {
      const filtros = obterFiltros();

      const [documentoResult, snapshotsDetalhados] = await Promise.all([
        sb
          .from('marketplace_caixa_detalhes')
          .select('*')
          .eq('codigo_bolao_caixa', codigo)
          .maybeSingle(),

        buscarDetalhesSnapshotsPaginados({
          codigoBolao: codigo,
          dataInicial: filtros.dataInicial,
          dataFinal: filtros.dataFinal
        })
      ]);

      if (documentoResult.error) throw documentoResult.error;

      state.detalheDocumentoAtual = documentoResult.data || null;
      state.detalheSnapshotsAtuais = snapshotsDetalhados;

      renderHistoricoDetalhe(
        state.detalheDocumentoAtual,
        snapshotsDetalhados,
        filtros
      );

      atualizarBotaoExportarHistoricoDetalhe(snapshotsDetalhados.length > 0);

      if (snapshotsDetalhados.length) {
        definirStatusHistoricoDetalhe(
          `${fmtInt(snapshotsDetalhados.length)} coleta(s) detalhada(s) no período selecionado.`,
          'ok'
        );
      } else if (state.detalheDocumentoAtual) {
        definirStatusHistoricoDetalhe(
          'Existe um detalhamento salvo, mas não há snapshots detalhados dentro do período selecionado.',
          'warn'
        );
      } else {
        definirStatusHistoricoDetalhe(
          'Este bolão ainda não possui coleta detalhada salva.',
          'warn'
        );
      }
    } catch (error) {
      console.error('[Histórico Marketplace] falha ao carregar detalhes', error);
      definirStatusHistoricoDetalhe(
        error.message || 'Falha ao consultar o histórico detalhado.',
        'err'
      );

      $('historyDetailBody').innerHTML = `
        <div class="history-detail-error">
          <i class="fas fa-triangle-exclamation"></i>
          <strong>Não foi possível carregar o histórico detalhado</strong>
          <span>${escapeHtml(error.message || 'Erro desconhecido.')}</span>
        </div>
      `;
    } finally {
      state.detalheLoading = false;
    }
  }

  function fecharHistoricoDetalhe() {
    const modal = $('modalHistoricoDetalhe');
    if (modal) modal.hidden = true;

    document.body.classList.remove('history-detail-open');

    state.detalheCodigoAtual = '';
    state.detalheItemAtual = null;
    state.detalheDocumentoAtual = null;
    state.detalheSnapshotsAtuais = [];
    state.detalheLoading = false;

    atualizarBotaoExportarHistoricoDetalhe(false);
  }

  async function buscarDetalhesSnapshotsPaginados({
    codigoBolao,
    dataInicial = '',
    dataFinal = '',
    limiteMaximo = 10000
  }) {
    const rows = [];

    for (let from = 0; from < limiteMaximo; from += PAGE_SIZE) {
      let query = sb
        .from('marketplace_caixa_detalhes_snapshots')
        .select(
          'id,codigo_bolao_caixa,codigo_loterica,modalidade,concurso,' +
          'qtd_cota_digital,qtd_cota_total,qtd_cota_disponivel,' +
          'qtd_cota_fisica,qtd_cota_baixadas_impressas,qtd_cota_vendidas,' +
          'qtd_cota_reservada,qtd_cota_baixadas,origem_coleta,' +
          'solicitacao_id,coletor_id,coletado_em'
        )
        .eq('codigo_bolao_caixa', codigoBolao)
        .order('coletado_em', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

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

  function renderHistoricoDetalhe(documento, snapshots, filtros) {
    const body = $('historyDetailBody');
    if (!body) return;

    if (!documento && !snapshots.length) {
      body.innerHTML = `
        <div class="history-detail-empty">
          <i class="fas fa-database"></i>
          <strong>Nenhum detalhamento coletado</strong>
          <span>
            A coleta detalhada começou após a instalação do novo coletor.
            Concursos anteriores a essa data continuarão apenas com o histórico
            de disponibilidade.
          </span>
        </div>
      `;
      return;
    }

    const primeiro = snapshots[0] || documento;
    const ultimo = snapshots[snapshots.length - 1] || documento;
    const payload = obterPayloadHistoricoDetalhe(documento);
    const apostas = Array.isArray(payload.apostas) ? payload.apostas : [];

    const inicioTexto = snapshots.length
      ? fmtDataHora(snapshots[0].coletado_em)
      : fmtDataHora(documento?.primeira_coleta_em);

    const fimTexto = snapshots.length
      ? fmtDataHora(snapshots[snapshots.length - 1].coletado_em)
      : fmtDataHora(documento?.ultima_coleta_em);

    const conferencia = calcularConferenciaHistoricoDetalhe(ultimo);
    const dataFiltroInicio = filtros.dataInicial ? fmtDataHora(filtros.dataInicial) : 'sem limite';
    const dataFiltroFim = filtros.dataFinal ? fmtDataHora(filtros.dataFinal) : 'sem limite';

    body.innerHTML = `
      <section class="history-detail-section">
        <div class="history-detail-section-head">
          <div>
            <h4>Evolução real das cotas</h4>
            <p>
              Diferencia vendas, impressões, reservas e baixas.
              Os valores abaixo representam a última coleta do período.
            </p>
          </div>
          <div class="history-detail-period">
            <span>Período detalhado encontrado</span>
            <strong>${escapeHtml(inicioTexto)} → ${escapeHtml(fimTexto)}</strong>
          </div>
        </div>

        <div class="history-detail-current-grid">
          ${historicoDetalheStat(
            'Disponíveis',
            ultimo?.qtd_cota_disponivel,
            diferencaDetalhe(ultimo, primeiro, 'qtd_cota_disponivel'),
            'available'
          )}
          ${historicoDetalheStat(
            'Vendidas',
            ultimo?.qtd_cota_vendidas,
            diferencaDetalhe(ultimo, primeiro, 'qtd_cota_vendidas'),
            'sold'
          )}
          ${historicoDetalheStat(
            'Impressas',
            ultimo?.qtd_cota_baixadas_impressas,
            diferencaDetalhe(ultimo, primeiro, 'qtd_cota_baixadas_impressas'),
            'printed'
          )}
          ${historicoDetalheStat(
            'Reservadas',
            ultimo?.qtd_cota_reservada,
            diferencaDetalhe(ultimo, primeiro, 'qtd_cota_reservada'),
            'reserved'
          )}
          ${historicoDetalheStat(
            'Baixadas',
            ultimo?.qtd_cota_baixadas,
            diferencaDetalhe(ultimo, primeiro, 'qtd_cota_baixadas'),
            'downloaded'
          )}
          ${historicoDetalheStat(
            'Físicas',
            ultimo?.qtd_cota_fisica,
            diferencaDetalhe(ultimo, primeiro, 'qtd_cota_fisica'),
            'physical'
          )}
        </div>

        <div class="history-detail-conference ${conferencia.ok ? 'ok' : 'warn'}">
          <span>
            Conferência da última coleta:
            disponíveis + vendidas + impressas + reservadas + baixadas + físicas
          </span>
          <strong>${fmtInt(conferencia.soma)} / ${fmtInt(conferencia.total)}</strong>
        </div>

        <div class="history-detail-comparison">
          ${historicoComparacaoCard(
            'Primeira coleta detalhada',
            snapshots.length ? fmtDataHora(primeiro.coletado_em) : fmtDataHora(documento?.primeira_coleta_em)
          )}
          ${historicoComparacaoCard(
            'Última coleta detalhada',
            snapshots.length ? fmtDataHora(ultimo.coletado_em) : fmtDataHora(documento?.ultima_coleta_em)
          )}
          ${historicoComparacaoCard(
            'Filtro solicitado',
            `${dataFiltroInicio} → ${dataFiltroFim}`
          )}
        </div>
      </section>

      <section class="history-detail-section">
        <div class="history-detail-section-head">
          <div>
            <h4>Coletas detalhadas</h4>
            <p>
              Cada linha corresponde a uma consulta automática de hora em hora
              ou a uma atualização manual.
            </p>
          </div>
          <div class="history-detail-period">
            <span>Registros</span>
            <strong>${fmtInt(snapshots.length)}</strong>
          </div>
        </div>
        ${renderTabelaHistoricoDetalhe(snapshots)}
      </section>

      ${documento ? `
        <section class="history-detail-section">
          <div class="history-detail-section-head">
            <div>
              <h4>Valores e composição mais recentes</h4>
              <p>
                Documento completo mais recente salvo para este bolão,
                mesmo que esteja fora do período filtrado.
              </p>
            </div>
            <div class="history-detail-period">
              <span>Documento completo</span>
              <strong>${escapeHtml(fmtDataHora(documento.ultima_coleta_em))}</strong>
            </div>
          </div>

          <div class="history-detail-values">
            ${historicoDetalheValue('Cota sem tarifa', fmtBRL(documento.vr_cota_sem_tarifa))}
            ${historicoDetalheValue('Cota com tarifa', fmtBRL(documento.vr_cota_com_tarifa))}
            ${historicoDetalheValue('Tarifa da cota', fmtBRL(documento.vr_tarifa_servico_cota))}
            ${historicoDetalheValue('Última cota', fmtBRL(documento.vr_ultima_cota_com_tarifa))}
            ${historicoDetalheValue('Total sem tarifa', fmtBRL(documento.vr_total_bolao_sem_tarifa))}
            ${historicoDetalheValue('Total com tarifa', fmtBRL(documento.vr_total_bolao_com_tarifa))}
            ${historicoDetalheValue('Tarifa total', fmtBRL(documento.vr_tarifa_bolao))}
            ${historicoDetalheValue('Quantidade de apostas', fmtInt(documento.qtd_apostas))}
          </div>
        </section>

        <section class="history-detail-section">
          <div class="history-detail-section-head">
            <div>
              <h4>Jogos do bolão</h4>
              <p>
                As dezenas completas são preservadas no documento mais recente;
                não são repetidas em todos os snapshots para economizar espaço.
              </p>
            </div>
          </div>
          ${renderApostasHistoricoDetalhe(apostas)}
        </section>
      ` : ''}
    `;
  }

  function historicoDetalheStat(label, value, delta, classe) {
    const deltaNumero = Number(delta || 0);
    const deltaClasse =
      deltaNumero > 0 ? 'positive' :
      deltaNumero < 0 ? 'negative' :
      '';

    return `
      <div class="history-detail-current ${classe}">
        <span>${escapeHtml(label)}</span>
        <strong>${fmtInt(value)}</strong>
        <span class="history-detail-delta ${deltaClasse}">
          Δ ${deltaNumero > 0 ? '+' : ''}${fmtInt(deltaNumero)}
        </span>
      </div>
    `;
  }

  function historicoComparacaoCard(label, value) {
    return `
      <div class="history-detail-comparison-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function historicoDetalheValue(label, value) {
    return `
      <div class="history-detail-value">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function diferencaDetalhe(ultimo, primeiro, campo) {
    return int(ultimo?.[campo]) - int(primeiro?.[campo]);
  }

  function calcularConferenciaHistoricoDetalhe(detalhe) {
    const total = int(detalhe?.qtd_cota_total);
    const soma =
      int(detalhe?.qtd_cota_disponivel) +
      int(detalhe?.qtd_cota_vendidas) +
      int(detalhe?.qtd_cota_baixadas_impressas) +
      int(detalhe?.qtd_cota_reservada) +
      int(detalhe?.qtd_cota_baixadas) +
      int(detalhe?.qtd_cota_fisica);

    return {
      total,
      soma,
      ok: total === soma
    };
  }

  function renderTabelaHistoricoDetalhe(snapshots) {
    if (!snapshots.length) {
      return `
        <div class="empty">
          Não existem snapshots detalhados dentro do período selecionado.
        </div>
      `;
    }

    return `
      <div class="history-detail-table-wrap">
        <table class="history-detail-table">
          <thead>
            <tr>
              <th>Coletado em</th>
              <th>Disponíveis</th>
              <th>Vendidas</th>
              <th>Impressas</th>
              <th>Reservadas</th>
              <th>Baixadas</th>
              <th>Físicas</th>
              <th>Total</th>
              <th>Origem</th>
            </tr>
          </thead>
          <tbody>
            ${snapshots.map((snapshot) => `
              <tr>
                <td>${escapeHtml(fmtDataHora(snapshot.coletado_em))}</td>
                <td>${fmtInt(snapshot.qtd_cota_disponivel)}</td>
                <td>${fmtInt(snapshot.qtd_cota_vendidas)}</td>
                <td>${fmtInt(snapshot.qtd_cota_baixadas_impressas)}</td>
                <td>${fmtInt(snapshot.qtd_cota_reservada)}</td>
                <td>${fmtInt(snapshot.qtd_cota_baixadas)}</td>
                <td>${fmtInt(snapshot.qtd_cota_fisica)}</td>
                <td>${fmtInt(snapshot.qtd_cota_total)}</td>
                <td>
                  <span class="history-detail-origin ${snapshot.origem_coleta === 'MANUAL' ? 'manual' : ''}">
                    ${snapshot.origem_coleta === 'MANUAL' ? 'Manual' : 'Automático'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function obterPayloadHistoricoDetalhe(documento) {
    const bruto = documento?.payload_detalhe;
    if (!bruto || typeof bruto !== 'object') return {};

    const payload = bruto.payload;
    return payload && typeof payload === 'object' ? payload : bruto;
  }

  function renderApostasHistoricoDetalhe(apostas) {
    if (!apostas.length) {
      return `
        <div class="empty">
          O documento completo não contém apostas para exibição.
        </div>
      `;
    }

    return `
      <div class="history-detail-bets">
        ${apostas.map((aposta, index) => renderApostaHistoricoDetalhe(aposta, index)).join('')}
      </div>
    `;
  }

  function renderApostaHistoricoDetalhe(aposta, index) {
    const dezenas = arrayHistoricoDetalhe(
      aposta?.dezenas ||
      aposta?.numeros ||
      aposta?.numerosApostados
    );

    const trevos = arrayHistoricoDetalhe(
      aposta?.trevos ||
      aposta?.numerosTrevos
    );

    const marcadores = [];
    if (aposta?.indicadorSurpresinha === true) marcadores.push('Surpresinha');
    if (aposta?.timeCoracao) marcadores.push(`Time: ${aposta.timeCoracao}`);
    if (aposta?.mesSorte) marcadores.push(`Mês: ${aposta.mesSorte}`);

    return `
      <article class="history-detail-bet">
        <div class="history-detail-bet-head">
          <strong>Jogo ${index + 1}</strong>
          <span>${escapeHtml(marcadores.join(' · ') || 'Aposta registrada')}</span>
        </div>
        <div class="history-detail-number-list">
          ${dezenas.map((numero) => `
            <span class="history-detail-number">${escapeHtml(formatarNumeroHistoricoDetalhe(numero))}</span>
          `).join('')}
          ${trevos.map((numero) => `
            <span class="history-detail-number trevo" title="Trevo">${escapeHtml(formatarNumeroHistoricoDetalhe(numero))}</span>
          `).join('')}
        </div>
        ${marcadores.length
          ? `<div class="history-detail-note">${escapeHtml(marcadores.join(' · '))}</div>`
          : ''
        }
      </article>
    `;
  }

  function arrayHistoricoDetalhe(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) =>
      item !== null &&
      item !== undefined &&
      item !== ''
    );
  }

  function formatarNumeroHistoricoDetalhe(value) {
    const numero = Number(value);
    return Number.isFinite(numero)
      ? String(numero).padStart(2, '0')
      : String(value);
  }

  function definirStatusHistoricoDetalhe(texto, tipo = '') {
    const element = $('historyDetailStatus');
    if (!element) return;

    element.textContent = texto || '';
    element.className = `history-detail-status ${tipo}`.trim();
  }

  function definirCorpoHistoricoDetalheLoading() {
    const body = $('historyDetailBody');
    if (!body) return;

    body.innerHTML = `
      <div class="history-detail-loading">
        <i class="fas fa-circle-notch fa-spin"></i>
        <span>Carregando histórico detalhado...</span>
      </div>
    `;
  }

  function atualizarBotaoExportarHistoricoDetalhe(enabled) {
    const button = $('btnExportarHistoricoDetalhe');
    if (button) button.disabled = !enabled;
  }

  function exportarHistoricoDetalhe() {
    const snapshots = state.detalheSnapshotsAtuais;
    const item = state.detalheItemAtual;

    if (!snapshots.length) {
      definirStatusHistoricoDetalhe(
        'Não existem snapshots detalhados para exportar.',
        'warn'
      );
      return;
    }

    const rows = snapshots.map((snapshot) => ({
      codigo_loterica: snapshot.codigo_loterica || item?.loja?.codigo || '',
      nome_loteria: item?.loja?.nome || '',
      modalidade: snapshot.modalidade || item?.modalidade || '',
      concurso: snapshot.concurso || item?.concurso || '',
      codigo_bolao_caixa: snapshot.codigo_bolao_caixa,
      coletado_em: snapshot.coletado_em,
      qtd_cota_total: snapshot.qtd_cota_total,
      qtd_cota_digital: snapshot.qtd_cota_digital,
      qtd_cota_disponivel: snapshot.qtd_cota_disponivel,
      qtd_cota_vendidas: snapshot.qtd_cota_vendidas,
      qtd_cota_baixadas_impressas: snapshot.qtd_cota_baixadas_impressas,
      qtd_cota_reservada: snapshot.qtd_cota_reservada,
      qtd_cota_baixadas: snapshot.qtd_cota_baixadas,
      qtd_cota_fisica: snapshot.qtd_cota_fisica,
      origem_coleta: snapshot.origem_coleta
    }));

    baixarCsv(
      `historico-detalhado-${item?.modalidade || 'bolao'}-${item?.concurso || ''}.csv`,
      rows
    );
  }

  function limparFiltros() {
    $('filtroLoja').value = '';
    $('filtroModalidade').value = '';
    $('filtroConcurso').value = '';
    definirPeriodoPadrao();
    state.snapshots = [];
    state.series = [];
    fecharHistoricoDetalhe();
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
function registrarLoja(codigo, nome) {
  const key = String(codigo || '').trim();
  const nomeLimpo = String(nome || '').trim();

  if (!key) return;

  const atual =
    state.cadastroLoterias.get(key);

  const atualEhGenerico =
    !atual?.nome ||
    atual.nome === `Lotérica ${key}`;

  if (
    nomeLimpo &&
    (
      !atual ||
      atualEhGenerico
    )
  ) {
    state.cadastroLoterias.set(key, {
      codigo: key,
      nome: nomeLimpo
    });

    return;
  }

  if (!atual) {
    state.cadastroLoterias.set(key, {
      codigo: key,
      nome: `Lotérica ${key}`
    });
  }
}

function nomeLoteriaPayload(payload) {
  const dados = payload || {};

  return String(
    dados.nomeFantasia ||
    dados.nome_fantasia ||
    dados.nomeLoteria ||
    dados.nome_loteria ||
    dados.nomeRazaoSocial ||
    dados.nome_razao_social ||
    ''
  ).trim();
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