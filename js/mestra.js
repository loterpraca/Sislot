/* ═══════════════════════════════════════════════════════════
   SISLOT — Mestra Financeira
   Segurança → Estado → Dados → Normalização → UI
   ═══════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const CONFIG = Object.freeze({
    timezone: 'America/Sao_Paulo',
    perfisPermitidos: ['SOCIO', 'ADMIN'],
    manualTable: 'faturamento_mensal_manual',
    cacheMs: 180000,
    pageSize: 1000,
    tabs: {
      boloes: {
        eyebrow: 'Bolões',
        title: 'Resultado dos bolões',
        subtitle: 'Cada linha representa um bolão pela loja de origem, com venda, encalhe, prêmio e lucro.'
      },
      telesena: {
        eyebrow: 'Tele Sena',
        title: 'Resultado da Tele Sena',
        subtitle: 'Venda mensal por campanha e tipo, com faturamento líquido, custo e lucro.'
      },
      raspadinha: {
        eyebrow: 'Raspadinha',
        title: 'Resultado das raspadinhas',
        subtitle: 'Venda mensal por produto, com custo real e margem apurada.'
      },
      federal: {
        eyebrow: 'Federal',
        title: 'Resultado da Federal',
        subtitle: 'Extrações da competência, vendas, encalhe, prêmio e resultado.'
      },
      resultado: {
        eyebrow: 'Consolidado',
        title: 'Resultado da operação',
        subtitle: 'Consolidação por loja de Bolões, Tele Sena, Raspadinha, Federal, Jogos e Serviços Bancários.'
      }
    }
  });

  let sb = null;
  let ctx = null;
  let toastTimer = null;
  let loadSequence = 0;
  let bootReady = false;

  const cache = new Map();

  const state = {
    competencia: mesAtualSP(),
    lojaId: 'ALL',
    lojaSlug: 'todas',
    lojas: [],
    tab: 'boloes',
    filtro: '',
    ultimoDataset: null,
    loading: false
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  document.addEventListener('DOMContentLoaded', bootstrap);

  /* ─────────────────────────────────────────────────────────
     BOOTSTRAP / SEGURANÇA / TEMA
     ───────────────────────────────────────────────────────── */

  async function bootstrap() {
    vincularEventos();
    $('competencia').value = state.competencia;

    try {
      validarDependencias();

      sb = window.supabase.createClient(
        window.SISLOT_CONFIG.url,
        window.SISLOT_CONFIG.anonKey
      );

      ctx = await window.SISLOT_SECURITY.protegerPagina(sb, {
        perfisPermitidos: CONFIG.perfisPermitidos
      });

      await carregarLojas();
      preencherSeletorMobile();

      if (window.SISLOT_THEME?.init) {
        window.SISLOT_THEME.init('todas');
        const slug = window.SISLOT_THEME.lojaSlug?.() || 'todas';
        sincronizarLojaPorSlug(slug, { carregar: false });
      } else {
        inicializarTemaFallback();
      }

      atualizarCabecalhos();
      bootReady = true;
      await carregarAbaAtual({ force: true });
    } catch (erro) {
      console.error('[Mestra] Falha no bootstrap:', erro);
      mostrarErro(normalizarErro(erro));
    }
  }

  function validarDependencias() {
    if (!window.supabase?.createClient) {
      throw new Error('Biblioteca Supabase não carregada.');
    }
    if (!window.SISLOT_CONFIG?.url || !window.SISLOT_CONFIG?.anonKey) {
      throw new Error('SISLOT_CONFIG não foi carregado corretamente.');
    }
    if (!window.SISLOT_SECURITY?.protegerPagina) {
      throw new Error('sislot-security.js não foi carregado corretamente.');
    }
  }

  async function carregarLojas() {
    let lojas = [];

    if (typeof window.SISLOT_SECURITY?.carregarTodasLojas === 'function') {
      try {
        lojas = await window.SISLOT_SECURITY.carregarTodasLojas();
      } catch (erro) {
        console.warn('[Mestra] carregarTodasLojas indisponível:', erro);
      }
    }

    if (!Array.isArray(lojas) || !lojas.length) {
      lojas = ctx?.lojasPermitidas || [];
    }

    state.lojas = (lojas || [])
      .map(normalizarLoja)
      .filter(loja =>
        Number.isFinite(loja.id) &&
        loja.id > 0 &&
        loja.slug &&
        loja.slug !== 'todas'
      )
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    if (!state.lojas.length) {
      throw new Error('Nenhuma loja ativa disponível para a Mestra.');
    }
  }

  function normalizarLoja(loja) {
    const id = Number(loja?.loteria_id ?? loja?.id);
    const nome = String(
      loja?.loteria_nome ?? loja?.nome ?? `Loja ${id}`
    ).trim();
    const slug = String(
      loja?.loteria_slug ?? loja?.slug ?? slugificar(nome)
    ).trim();

    return { id, nome, slug };
  }

  function preencherSeletorMobile() {
    const select = $('mestra-mobile-loja');
    if (!select) return;

    select.innerHTML = [
      '<option value="todas">Todas as lojas</option>',
      ...state.lojas.map(loja =>
        `<option value="${escAttr(loja.slug)}">${esc(loja.nome)}</option>`
      )
    ].join('');

    select.value = state.lojaSlug;
  }

  function inicializarTemaFallback() {
    const headerSelect = $('sl-loja-select');

    if (headerSelect) {
      headerSelect.innerHTML = [
        '<option value="todas">Todas as lojas</option>',
        ...state.lojas.map(loja =>
          `<option value="${escAttr(loja.slug)}">${esc(loja.nome)}</option>`
        )
      ].join('');

      headerSelect.addEventListener('change', (e) => {
        aplicarTemaFallback(e.target.value || 'todas');
      });
    }

    aplicarTemaFallback('todas');
    iniciarRelogioFallback();
  }

  function aplicarTemaVisualFallback(slug) {
    const loja = state.lojas.find(l => l.slug === slug) || null;
    document.body.dataset.loja = loja?.slug || 'todas';

    const logo = $('headerLogo');
    if (logo) {
      logo.src = loja ? `./icons/${loja.slug}.png` : './icons/todas.png';
      logo.alt = loja?.nome || 'Todas';
      logo.onerror = () => {
        logo.onerror = null;
        logo.src = './icons/todas.png';
      };
    }

    $('headerNome').textContent = loja?.nome || 'Todas';
  }

  function aplicarTemaFallback(slug) {
    aplicarTemaVisualFallback(slug);
    sincronizarLojaPorSlug(slug);
  }

  function sincronizarLojaPorSlug(slug, { carregar = true } = {}) {
    const normalizado = String(slug || 'todas').trim();
    const loja = normalizado === 'todas'
      ? null
      : state.lojas.find(l => l.slug === normalizado) || null;

    state.lojaSlug = loja?.slug || 'todas';
    state.lojaId = loja ? String(loja.id) : 'ALL';

    const mobile = $('mestra-mobile-loja');
    if (mobile && [...mobile.options].some(o => o.value === state.lojaSlug)) {
      mobile.value = state.lojaSlug;
    }

    const header = $('sl-loja-select');
    if (header && [...header.options].some(o => o.value === state.lojaSlug)) {
      header.value = state.lojaSlug;
    }

    $('heroEscopo').textContent = loja?.nome || 'Todas as lojas';

    state.filtro = '';
    if ($('buscaTabela')) $('buscaTabela').value = '';
    atualizarCabecalhos();

    if (bootReady && carregar) {
      void carregarAbaAtual();
    }
  }

  function vincularEventos() {
    document.addEventListener('sislot:tema', (e) => {
      const slug = e?.detail?.slug || 'todas';

      // Se a Mestra já aplicou esta loja pelo filtro próprio,
      // o evento do tema serve só para acabamento visual.
      if (slug === state.lojaSlug) return;

      sincronizarLojaPorSlug(slug);
    });

    $('mestra-mobile-loja')?.addEventListener('change', async (e) => {
      const slug = e.target.value || 'todas';

      // REGRA CRÍTICA:
      // a loja é aplicada diretamente no estado financeiro da Mestra.
      // O recálculo NÃO depende mais do sislot-theme.js emitir evento.
      sincronizarLojaPorSlug(slug, { carregar: false });

      if (window.SISLOT_THEME?.aplicarTema) {
        try {
          window.SISLOT_THEME.aplicarTema(slug);
        } catch (erro) {
          console.warn('[Mestra] Tema da loja não aplicado:', erro);
        }
      } else {
        aplicarTemaVisualFallback(slug);
      }

      invalidarCacheAtual();
      await carregarAbaAtual({ force: true });
    });

    $('btnLojaLogo')?.addEventListener('click', () => {
      const select = $('mestra-mobile-loja') || $('sl-loja-select');
      if (!select) return;
      select.focus();
      if (typeof select.showPicker === 'function') {
        try { select.showPicker(); } catch (_) {}
      }
    });

    $('competencia')?.addEventListener('change', async (e) => {
      if (!/^\d{4}-\d{2}$/.test(e.target.value || '')) return;
      state.competencia = e.target.value;
      state.filtro = '';
      if ($('buscaTabela')) $('buscaTabela').value = '';
      atualizarCabecalhos();
      await carregarAbaAtual();
    });

    $('btnMesAnterior')?.addEventListener('click', () => alterarMes(-1));
    $('btnProximoMes')?.addEventListener('click', () => alterarMes(1));

    $('btnAtualizar')?.addEventListener('click', async () => {
      invalidarCacheAtual();
      await carregarAbaAtual({ force: true });
      toast('Dados atualizados.');
    });

    $('btnExportar')?.addEventListener('click', exportarAtual);

    $('buscaTabela')?.addEventListener('input', debounce((e) => {
      state.filtro = String(e.target.value || '').trim().toLowerCase();
      rerenderUltimoDataset();
    }, 90));

    $('mestraTabs')?.addEventListener('click', async (e) => {
      const button = e.target.closest('[data-tab]');
      if (!button || button.dataset.tab === state.tab) return;

      state.tab = button.dataset.tab;
      state.filtro = '';
      if ($('buscaTabela')) $('buscaTabela').value = '';

      $$('.mestra-tab').forEach(btn => {
        const ativo = btn.dataset.tab === state.tab;
        btn.classList.toggle('is-active', ativo);
        btn.setAttribute('aria-selected', String(ativo));
      });

      atualizarCabecalhos();
      await carregarAbaAtual();
    });
  }

  async function alterarMes(delta) {
    const [ano, mes] = state.competencia.split('-').map(Number);
    const data = new Date(ano, mes - 1 + delta, 1, 12);

    state.competencia =
      `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;

    $('competencia').value = state.competencia;
    atualizarCabecalhos();
    await carregarAbaAtual();
  }

  function atualizarCabecalhos() {
    const meta = CONFIG.tabs[state.tab] || CONFIG.tabs.boloes;
    $('sectionEyebrow').textContent = meta.eyebrow;
    $('sectionTitle').textContent = meta.title;
    $('sectionSubtitle').textContent = meta.subtitle;
    $('heroCompetencia').textContent = nomeCompetencia(state.competencia);

    const loja = state.lojaId === 'ALL'
      ? null
      : state.lojas.find(l => String(l.id) === String(state.lojaId));

    $('heroEscopo').textContent = loja?.nome || 'Todas as lojas';

    const searchWrap = $('searchWrap');
    if (searchWrap) {
      searchWrap.style.display = state.tab === 'resultado' ? 'none' : '';
    }
  }

  /* ─────────────────────────────────────────────────────────
     CACHE / ORQUESTRAÇÃO
     ───────────────────────────────────────────────────────── */

  async function carregarAbaAtual({ force = false } = {}) {
    const seq = ++loadSequence;
    state.loading = true;
    setStatus('');
    renderLoading();

    try {
      let dataset;

      if (state.tab === 'boloes') {
        dataset = await cached('boloes', () => buscarBoloes(), force);
      } else if (state.tab === 'telesena') {
        dataset = await cached(
          'telesena',
          () => buscarProdutos('TELESENA'),
          force
        );
      } else if (state.tab === 'raspadinha') {
        dataset = await cached(
          'raspadinha',
          () => buscarProdutos('RASPADINHA'),
          force
        );
      } else if (state.tab === 'federal') {
        dataset = await cached('federal', () => buscarFederal(), force);
      } else {
        dataset = await cached(
          'resultado',
          () => buscarResultadoConsolidado(),
          force
        );
      }

      if (seq !== loadSequence) return;

      state.ultimoDataset = dataset;
      renderDataset(dataset);
    } catch (erro) {
      if (seq !== loadSequence) return;
      console.error(`[Mestra/${state.tab}]`, erro);
      mostrarErro(normalizarErro(erro));
    } finally {
      if (seq === loadSequence) state.loading = false;
    }
  }

  async function cached(scope, fetcher, force = false) {
    const key = cacheKey(scope);
    const existente = cache.get(key);

    if (
      !force &&
      existente &&
      (Date.now() - existente.at) < CONFIG.cacheMs
    ) {
      return existente.data;
    }

    const data = await fetcher();
    cache.set(key, { at: Date.now(), data });
    return data;
  }

  function cacheKey(scope) {
    return `${scope}|${state.competencia}|${state.lojaId}`;
  }

  function invalidarCacheAtual() {
    const scopes = state.tab === 'resultado'
      ? ['resultado', 'boloes', 'telesena', 'raspadinha', 'federal', 'manual']
      : [state.tab, 'resultado'];

    for (const key of [...cache.keys()]) {
      if (scopes.some(scope => key.startsWith(`${scope}|`))) {
        cache.delete(key);
      }
    }
  }

  function rerenderUltimoDataset() {
    if (state.ultimoDataset) renderDataset(state.ultimoDataset);
  }

  async function fetchPaged(buildQuery, pageSize = CONFIG.pageSize) {
    const all = [];
    let from = 0;

    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await buildQuery(from, to);

      if (error) throw error;

      const page = data || [];
      all.push(...page);

      if (page.length < pageSize) break;
      from += pageSize;

      if (from > 100000) {
        throw new Error('Consulta interrompida: volume acima do limite de segurança.');
      }
    }

    return all;
  }

  /* ─────────────────────────────────────────────────────────
     BOLÕES
     ───────────────────────────────────────────────────────── */

  async function buscarBoloes({
    lojaId = state.lojaId,
    competencia = state.competencia
  } = {}) {
    const range = intervaloMes(competencia);

    const base = await fetchPaged((from, to) => {
      let query = sb
        .from('view_resultado_bolao')
        .select(`
          bolao_id,loteria_id,loteria_origem,modalidade,concurso,dt_concurso,
          valor_cota,qtd_cotas_total,custo_jogo,qtd_vendida_total,receita_total,
          enc_origem_total,enc_destinos_total,enc_geral_total,
          premio_origem_total,premio_destinos_total,premio_total,
          resultado_final,status
        `)
        .gte('dt_concurso', range.inicio)
        .lt('dt_concurso', range.proximo)
        .order('dt_concurso', { ascending: true })
        .order('modalidade', { ascending: true })
        .range(from, to);

      if (lojaId !== 'ALL') {
        query = query.eq('loteria_id', Number(lojaId));
      }

      return query;
    });

    const ids = unicosNumericos(base.map(x => x.bolao_id));
    const metaMap = await buscarMetadadosBoloes(ids);

    const rows = base.map(b => {
      const meta = metaMap.get(Number(b.bolao_id)) || {};
      const encalhe = n(b.enc_geral_total);
      const premioCota = nullableNumber(meta.vlr_premio);
      const premioRecebido = premioCota === null
        ? n(b.premio_total)
        : premioCota * encalhe;

      const receita = n(b.receita_total);
      const custo = n(b.custo_jogo);
      const lucro = nullableNumber(b.resultado_final) ??
        (receita + premioRecebido - custo);

      return {
        id: b.bolao_id,
        storeId: Number(b.loteria_id),
        origem: b.loteria_origem || nomeLoja(b.loteria_id),
        modalidade: formatModalidade(b.modalidade),
        concurso: b.concurso || '—',
        data: b.dt_concurso,
        jogos: nullableNumber(meta.qtd_jogos),
        dezenas: nullableNumber(meta.qtd_dezenas),
        cotas: n(b.qtd_cotas_total),
        valorCota: n(b.valor_cota),
        vendidas: n(b.qtd_vendida_total),
        encalhe,
        custoJogo: custo,
        premioCota,
        premioRecebido,
        receita,
        lucro,
        status: b.status || ''
      };
    });

    return {
      type: 'boloes',
      rows,
      totals: {
        faturamento: soma(rows, 'receita'),
        custo: soma(rows, 'custoJogo'),
        premios: soma(rows, 'premioRecebido'),
        resultado: soma(rows, 'lucro'),
        volume: soma(rows, 'vendidas'),
        registros: rows.length
      }
    };
  }

  async function buscarMetadadosBoloes(ids) {
    const map = new Map();

    for (const bloco of chunkArray(ids, 200)) {
      const { data, error } = await sb
        .from('boloes')
        .select('id,qtd_jogos,qtd_dezenas,vlr_premio')
        .in('id', bloco);

      if (error) {
        console.warn('[Mestra] Metadados adicionais de bolões:', error);
        continue;
      }

      (data || []).forEach(row => map.set(Number(row.id), row));
    }

    return map;
  }

  /* ─────────────────────────────────────────────────────────
     TELE SENA / RASPADINHA
     ───────────────────────────────────────────────────────── */

  async function buscarProdutos(
    produto,
    { lojaId = state.lojaId, competencia = state.competencia } = {}
  ) {
    const range = intervaloMes(competencia);

    const sales = await fetchPaged((from, to) => {
      let query = sb
        .from('produtos_vendas')
        .select(`
          id,loteria_vendedora_id,canal,produto,raspadinha_id,telesena_item_id,
          qtd_vendida,valor_unitario,valor_bruto,desconto,valor_liquido,
          data_referencia
        `)
        .eq('produto', produto)
        .gte('data_referencia', range.inicio)
        .lt('data_referencia', range.proximo)
        .order('data_referencia', { ascending: true })
        .range(from, to);

      if (lojaId !== 'ALL') {
        query = query.eq('loteria_vendedora_id', Number(lojaId));
      }

      return query;
    });

    const metadata = await carregarMetadadosProduto(produto, sales);
    const grouped = new Map();

    for (const venda of sales) {
      const storeId = Number(venda.loteria_vendedora_id);
      const itemId = Number(
        produto === 'RASPADINHA'
          ? venda.raspadinha_id
          : venda.telesena_item_id
      );

      const key = `${storeId}|${itemId}`;
      const meta = metadata.get(itemId) || {};

      if (!grouped.has(key)) {
        grouped.set(key, {
          id: key,
          storeId,
          loja: nomeLoja(storeId),
          produto,
          campanha: meta.campanha ||
            (produto === 'RASPADINHA' ? meta.nome : '—'),
          item: meta.nome || 'Produto sem nome',
          valorVenda: n(meta.valorVenda ?? venda.valor_unitario),
          valorCusto: n(meta.valorCusto),
          qtdVendida: 0,
          faturamentoBruto: 0,
          desconto: 0,
          faturamentoLiquido: 0,
          custo: 0,
          lucro: 0
        });
      }

      const row = grouped.get(key);
      const qtd = n(venda.qtd_vendida);
      const bruto = nullableNumber(venda.valor_bruto) ??
        (qtd * n(venda.valor_unitario));
      const desconto = n(venda.desconto);
      const liquido = nullableNumber(venda.valor_liquido) ??
        (bruto - desconto);

      row.qtdVendida += qtd;
      row.faturamentoBruto += bruto;
      row.desconto += desconto;
      row.faturamentoLiquido += liquido;
      row.custo += qtd * row.valorCusto;
    }

    const rows = [...grouped.values()]
      .map(row => ({
        ...row,
        lucro: row.faturamentoLiquido - row.custo
      }))
      .sort((a, b) =>
        a.loja.localeCompare(b.loja, 'pt-BR') ||
        a.campanha.localeCompare(b.campanha, 'pt-BR') ||
        a.item.localeCompare(b.item, 'pt-BR')
      );

    return {
      type: produto === 'TELESENA' ? 'telesena' : 'raspadinha',
      rows,
      totals: {
        faturamento: soma(rows, 'faturamentoLiquido'),
        bruto: soma(rows, 'faturamentoBruto'),
        custo: soma(rows, 'custo'),
        desconto: soma(rows, 'desconto'),
        resultado: soma(rows, 'lucro'),
        volume: soma(rows, 'qtdVendida'),
        registros: rows.length
      }
    };
  }

  async function carregarMetadadosProduto(produto, vendas) {
    const map = new Map();

    if (produto === 'RASPADINHA') {
      const ids = unicosNumericos(vendas.map(v => v.raspadinha_id));

      for (const bloco of chunkArray(ids, 200)) {
        const { data, error } = await sb
          .from('raspadinhas')
          .select('id,nome,valor_venda,valor_custo,margem_percentual')
          .in('id', bloco);

        if (error) {
          console.warn('[Mestra] Metadados de raspadinha:', error);
          continue;
        }

        (data || []).forEach(r => map.set(Number(r.id), {
          nome: r.nome || `Raspadinha ${r.id}`,
          campanha: r.nome || '',
          valorVenda: n(r.valor_venda),
          valorCusto: n(r.valor_custo)
        }));
      }

      return map;
    }

    const itemIds = unicosNumericos(vendas.map(v => v.telesena_item_id));
    const itens = [];

    for (const bloco of chunkArray(itemIds, 200)) {
      const { data, error } = await sb
        .from('telesena_itens')
        .select('id,nome,valor_venda,valor_custo,campanha_id')
        .in('id', bloco);

      if (error) {
        console.warn('[Mestra] Metadados de Tele Sena:', error);
        continue;
      }

      itens.push(...(data || []));
    }

    const campanhaIds = unicosNumericos(itens.map(i => i.campanha_id));
    const campanhas = new Map();

    for (const bloco of chunkArray(campanhaIds, 200)) {
      const { data, error } = await sb
        .from('telesena_campanhas')
        .select('id,nome')
        .in('id', bloco);

      if (!error) {
        (data || []).forEach(c =>
          campanhas.set(Number(c.id), c.nome || '')
        );
      }
    }

    itens.forEach(i => map.set(Number(i.id), {
      nome: i.nome || `Tele Sena ${i.id}`,
      campanha: campanhas.get(Number(i.campanha_id)) || 'Campanha',
      valorVenda: n(i.valor_venda),
      valorCusto: n(i.valor_custo)
    }));

    return map;
  }

  /* ─────────────────────────────────────────────────────────
     FEDERAL
     ───────────────────────────────────────────────────────── */

  async function buscarFederal({
    lojaId = state.lojaId,
    competencia = state.competencia
  } = {}) {
    const range = intervaloMes(competencia);

    const data = await fetchPaged((from, to) => {
      let query = sb
        .from('view_resumo_federal')
        .select('*')
        .gte('dt_sorteio', range.inicio)
        .lt('dt_sorteio', range.proximo)
        .order('dt_sorteio', { ascending: true })
        .order('concurso', { ascending: true })
        .range(from, to);

      if (lojaId !== 'ALL') {
        query = query.eq('loteria_id', Number(lojaId));
      }

      return query;
    });

    const rows = (data || []).map(f => {
      const vendaInterna = n(f.qtd_venda_interna_total);
      const vendaExterna = n(f.qtd_venda_externa);
      const valorFracao = n(f.valor_fracao);
      const valorCusto = n(f.valor_custo);
      const receitasTerceiros = n(f.receitas_terceiros);
      const premioEncalhe = n(f.premio_encalhe_total);
      const vendaBrutaInterna = vendaInterna * valorFracao;
      const custoInterno = vendaInterna * valorCusto;

      return {
        id: f.federal_id,
        storeId: Number(f.loteria_id),
        origem: f.loja_origem || nomeLoja(f.loteria_id),
        modalidade: f.modalidade || 'Federal',
        concurso: f.concurso || '—',
        data: f.dt_sorteio,
        valorFracao,
        valorCusto,
        qtdInicial: n(f.qtd_inicial),
        vendaInterna,
        vendaExterna,
        encalhe: n(f.qtd_encalhe),
        premioEncalhe,
        receitasTerceiros,
        vendaBrutaInterna,
        custoInterno,
        resultado: n(f.resultado)
      };
    });

    return {
      type: 'federal',
      rows,
      totals: {
        faturamento:
          soma(rows, 'vendaBrutaInterna') +
          soma(rows, 'receitasTerceiros'),
        custo: soma(rows, 'custoInterno'),
        premios: soma(rows, 'premioEncalhe'),
        resultado: soma(rows, 'resultado'),
        volume:
          soma(rows, 'vendaInterna') +
          soma(rows, 'vendaExterna'),
        registros: rows.length
      }
    };
  }

  /* ─────────────────────────────────────────────────────────
     LANÇAMENTOS MANUAIS
     ───────────────────────────────────────────────────────── */

  async function buscarManuais({
    lojaId = state.lojaId,
    competencia = state.competencia
  } = {}) {
    const competenciaDate = `${competencia}-01`;

    let query = sb
      .from(CONFIG.manualTable)
      .select(`
        id,loteria_id,competencia,relatorio_jogos,
        relatorio_servicos_bancarios,observacao,updated_at
      `)
      .eq('competencia', competenciaDate);

    if (lojaId !== 'ALL') {
      query = query.eq('loteria_id', Number(lojaId));
    }

    const { data, error } = await query;

    if (error) {
      const message = String(error.message || '').toLowerCase();
      if (
        message.includes('does not exist') ||
        message.includes(CONFIG.manualTable.toLowerCase())
      ) {
        throw new Error(
          `A tabela ${CONFIG.manualTable} ainda não está disponível. ` +
          'Execute o arquivo mestra.sql no SQL Editor do Supabase.'
        );
      }
      throw error;
    }

    return {
      type: 'manual',
      rows: (data || []).map(row => ({
        id: row.id,
        storeId: Number(row.loteria_id),
        competencia: row.competencia,
        jogos: n(row.relatorio_jogos),
        bancarios: n(row.relatorio_servicos_bancarios),
        observacao: row.observacao || '',
        updatedAt: row.updated_at || null
      }))
    };
  }

  async function salvarManual() {
    if (state.lojaId === 'ALL') {
      toast(
        'Selecione uma loja para lançar os relatórios mensais.',
        'error'
      );
      return;
    }

    const jogos = parseMoneyInput(
      $('inputRelatorioJogos')?.value
    );
    const bancarios = parseMoneyInput(
      $('inputServicosBancarios')?.value
    );
    const btn = $('btnSalvarManual');

    if (jogos < 0 || bancarios < 0) {
      toast('Os valores não podem ser negativos.', 'error');
      return;
    }

    setButtonLoading(btn, true);

    try {
      const payload = {
        loteria_id: Number(state.lojaId),
        competencia: `${state.competencia}-01`,
        relatorio_jogos: jogos,
        relatorio_servicos_bancarios: bancarios,
        updated_at: new Date().toISOString()
      };

      const { error } = await sb
        .from(CONFIG.manualTable)
        .upsert(payload, {
          onConflict: 'loteria_id,competencia'
        });

      if (error) throw error;

      invalidarScopes(['manual', 'resultado']);
      toast('Competência salva com sucesso.');
      await carregarAbaAtual({ force: true });
    } catch (erro) {
      console.error('[Mestra] Falha ao salvar manual:', erro);
      toast(normalizarErro(erro), 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function invalidarScopes(scopes) {
    for (const key of [...cache.keys()]) {
      if (scopes.some(scope => key.startsWith(`${scope}|`))) {
        cache.delete(key);
      }
    }
  }

  /* ─────────────────────────────────────────────────────────
     RESULTADO CONSOLIDADO
     ───────────────────────────────────────────────────────── */

  async function buscarResultadoConsolidado() {
    const opts = {
      lojaId: state.lojaId,
      competencia: state.competencia
    };

    const [boloes, telesena, raspadinha, federal, manual] =
      await Promise.all([
        cached('boloes', () => buscarBoloes(opts)),
        cached('telesena', () => buscarProdutos('TELESENA', opts)),
        cached('raspadinha', () => buscarProdutos('RASPADINHA', opts)),
        cached('federal', () => buscarFederal(opts)),
        cached('manual', () => buscarManuais(opts))
      ]);

    const storeIds = state.lojaId === 'ALL'
      ? state.lojas.map(loja => loja.id)
      : [Number(state.lojaId)];

    const rows = storeIds.map(storeId => {
      const boloesResultado =
        somaPorLoja(boloes.rows, storeId, 'lucro');
      const telesenaResultado =
        somaPorLoja(telesena.rows, storeId, 'lucro');
      const raspadinhaResultado =
        somaPorLoja(raspadinha.rows, storeId, 'lucro');
      const federalResultado =
        somaPorLoja(federal.rows, storeId, 'resultado');

      const manualRow = manual.rows.find(
        row => Number(row.storeId) === Number(storeId)
      );

      const jogos = n(manualRow?.jogos);
      const bancarios = n(manualRow?.bancarios);

      const operacional =
        boloesResultado +
        telesenaResultado +
        raspadinhaResultado +
        federalResultado;

      const relatorios = jogos + bancarios;

      return {
        storeId,
        loja: nomeLoja(storeId),
        boloes: boloesResultado,
        telesena: telesenaResultado,
        raspadinha: raspadinhaResultado,
        federal: federalResultado,
        jogos,
        bancarios,
        operacional,
        relatorios,
        total: operacional + relatorios
      };
    });

    return {
      type: 'resultado',
      rows,
      manualRows: manual.rows,
      totals: {
        boloes: soma(rows, 'boloes'),
        telesena: soma(rows, 'telesena'),
        raspadinha: soma(rows, 'raspadinha'),
        federal: soma(rows, 'federal'),
        jogos: soma(rows, 'jogos'),
        bancarios: soma(rows, 'bancarios'),
        operacional: soma(rows, 'operacional'),
        relatorios: soma(rows, 'relatorios'),
        resultado: soma(rows, 'total'),
        lojas: rows.length
      }
    };
  }

  /* ─────────────────────────────────────────────────────────
     RENDER — DISPATCH
     ───────────────────────────────────────────────────────── */

  function renderDataset(dataset) {
    if (!dataset) return;

    if (dataset.type === 'boloes') {
      renderBoloes(dataset);
    } else if (
      dataset.type === 'telesena' ||
      dataset.type === 'raspadinha'
    ) {
      renderProdutos(dataset);
    } else if (dataset.type === 'federal') {
      renderFederal(dataset);
    } else if (dataset.type === 'resultado') {
      renderResultado(dataset);
    }
  }

  function renderBoloes(dataset) {
    atualizarKpis({
      resultado: dataset.totals.resultado,
      aLabel: 'Venda de cotas',
      a: dataset.totals.faturamento,
      aMeta: `${fmtInt(dataset.totals.volume)} cotas vendidas`,
      bLabel: 'Custo dos jogos',
      b: dataset.totals.custo,
      bMeta: `${fmtInt(dataset.totals.registros)} bolões`,
      cLabel: 'Prêmios recebidos',
      c: dataset.totals.premios,
      cMeta: 'Prêmio por cota × encalhe'
    });

    const rows = filtrarRows(dataset.rows, [
      'origem',
      'modalidade',
      'concurso',
      'jogos',
      'dezenas',
      'cotas',
      'vendidas'
    ]);

    if (!rows.length) {
      return renderEmpty(
        'Nenhum bolão encontrado',
        'Não há bolões nessa competência com os filtros atuais.'
      );
    }

    const body = rows.map(row => `
      <tr>
        ${tdBadge('Origem', row.origem, corLoja(row.storeId))}
        ${td('Modalidade', row.modalidade, 'strong')}
        ${td('Concurso', row.concurso)}
        ${td('Jogos', showNum(row.jogos), 'num')}
        ${td('Dezenas', showNum(row.dezenas), 'num')}
        ${td('Cotas', fmtInt(row.cotas), 'num')}
        ${td('Valor cota', fmtBRL(row.valorCota), 'num')}
        ${td('Vendidas', fmtInt(row.vendidas), 'num strong')}
        ${td('Encalhe total', fmtInt(row.encalhe), 'num')}
        ${td('Preço jogo', fmtBRL(row.custoJogo), 'num')}
        ${td(
          'Prêmio/cota',
          row.premioCota === null
            ? '—'
            : fmtBRL(row.premioCota),
          'num'
        )}
        ${td(
          'Prêmio recebido',
          fmtBRL(row.premioRecebido),
          'num'
        )}
        ${td(
          'Lucro',
          fmtBRL(row.lucro),
          `num ${classeResultado(row.lucro)}`
        )}
      </tr>
    `).join('');

    $('mestraContent').innerHTML = tableCard({
      headers: [
        'Origem',
        'Modalidade',
        'Concurso',
        'Jogos',
        'Dezenas',
        'Cotas',
        'Valor cota',
        'Vendidas',
        'Encalhe total',
        'Preço jogo',
        'Prêmio/cota',
        'Prêmio recebido',
        'Lucro'
      ],
      body,
      totals: [
        ['Venda de cotas', fmtBRL(dataset.totals.faturamento)],
        ['Custo', fmtBRL(dataset.totals.custo)],
        ['Prêmios', fmtBRL(dataset.totals.premios)],
        ['Lucro', fmtBRL(dataset.totals.resultado)]
      ]
    });
  }

  function renderProdutos(dataset) {
    const tele = dataset.type === 'telesena';

    atualizarKpis({
      resultado: dataset.totals.resultado,
      aLabel: 'Faturamento líquido',
      a: dataset.totals.faturamento,
      aMeta: `Bruto ${fmtBRL(dataset.totals.bruto)}`,
      bLabel: 'Custo',
      b: dataset.totals.custo,
      bMeta: `Descontos ${fmtBRL(dataset.totals.desconto)}`,
      cLabel: 'Unidades vendidas',
      cRaw: fmtInt(dataset.totals.volume),
      cMeta: `${fmtInt(dataset.totals.registros)} itens`
    });

    const rows = filtrarRows(dataset.rows, [
      'loja',
      'campanha',
      'item',
      'valorVenda',
      'qtdVendida'
    ]);

    if (!rows.length) {
      return renderEmpty(
        tele
          ? 'Nenhuma Tele Sena vendida'
          : 'Nenhuma raspadinha vendida',
        'Não há vendas registradas nessa competência com os filtros atuais.'
      );
    }

    const body = rows.map(row => `
      <tr>
        ${tdBadge('Loja', row.loja, corLoja(row.storeId))}
        ${tele
          ? td('Campanha', row.campanha, 'strong')
          : ''}
        ${td(
          tele ? 'Tipo' : 'Produto',
          row.item,
          tele ? '' : 'strong'
        )}
        ${td('Valor venda', fmtBRL(row.valorVenda), 'num')}
        ${td('Valor custo', fmtBRL(row.valorCusto), 'num')}
        ${td('Vendidas', fmtInt(row.qtdVendida), 'num strong')}
        ${td(
          'Faturamento bruto',
          fmtBRL(row.faturamentoBruto),
          'num'
        )}
        ${td('Descontos', fmtBRL(row.desconto), 'num')}
        ${td(
          'Faturamento líquido',
          fmtBRL(row.faturamentoLiquido),
          'num'
        )}
        ${td('Custo', fmtBRL(row.custo), 'num')}
        ${td(
          'Lucro',
          fmtBRL(row.lucro),
          `num ${classeResultado(row.lucro)}`
        )}
      </tr>
    `).join('');

    const headers = tele
      ? [
          'Loja',
          'Campanha',
          'Tipo',
          'Valor venda',
          'Valor custo',
          'Vendidas',
          'Fat. bruto',
          'Descontos',
          'Fat. líquido',
          'Custo',
          'Lucro'
        ]
      : [
          'Loja',
          'Produto',
          'Valor venda',
          'Valor custo',
          'Vendidas',
          'Fat. bruto',
          'Descontos',
          'Fat. líquido',
          'Custo',
          'Lucro'
        ];

    $('mestraContent').innerHTML = tableCard({
      headers,
      body,
      totals: [
        [
          'Faturamento líquido',
          fmtBRL(dataset.totals.faturamento)
        ],
        ['Custo', fmtBRL(dataset.totals.custo)],
        ['Volume', fmtInt(dataset.totals.volume)],
        ['Lucro', fmtBRL(dataset.totals.resultado)]
      ]
    });
  }

  function renderFederal(dataset) {
    atualizarKpis({
      resultado: dataset.totals.resultado,
      aLabel: 'Receita operacional',
      a: dataset.totals.faturamento,
      aMeta: 'Venda interna + receitas de terceiros',
      bLabel: 'Custo das vendas',
      b: dataset.totals.custo,
      bMeta: 'Custo interno estimado',
      cLabel: 'Prêmio encalhe',
      c: dataset.totals.premios,
      cMeta: `${fmtInt(dataset.totals.volume)} frações`
    });

    const rows = filtrarRows(dataset.rows, [
      'origem',
      'concurso',
      'data',
      'vendaInterna',
      'vendaExterna',
      'encalhe'
    ]);

    if (!rows.length) {
      return renderEmpty(
        'Nenhuma Federal encontrada',
        'Não há extrações da Federal nessa competência com os filtros atuais.'
      );
    }

    const body = rows.map(row => `
      <tr>
        ${tdBadge('Origem', row.origem, corLoja(row.storeId))}
        ${td('Concurso', row.concurso, 'strong')}
        ${td('Sorteio', fmtData(row.data))}
        ${td('Valor fração', fmtBRL(row.valorFracao), 'num')}
        ${td('Custo', fmtBRL(row.valorCusto), 'num')}
        ${td('Venda interna', fmtInt(row.vendaInterna), 'num')}
        ${td('Venda externa', fmtInt(row.vendaExterna), 'num')}
        ${td('Encalhe', fmtInt(row.encalhe), 'num')}
        ${td(
          'Prêmio encalhe',
          fmtBRL(row.premioEncalhe),
          'num'
        )}
        ${td(
          'Receitas terceiros',
          fmtBRL(row.receitasTerceiros),
          'num'
        )}
        ${td(
          'Resultado',
          fmtBRL(row.resultado),
          `num ${classeResultado(row.resultado)}`
        )}
      </tr>
    `).join('');

    $('mestraContent').innerHTML = tableCard({
      headers: [
        'Origem',
        'Concurso',
        'Sorteio',
        'Valor fração',
        'Custo',
        'Venda interna',
        'Venda externa',
        'Encalhe',
        'Prêmio encalhe',
        'Receitas terceiros',
        'Resultado'
      ],
      body,
      totals: [
        [
          'Receita operacional',
          fmtBRL(dataset.totals.faturamento)
        ],
        ['Custo vendas', fmtBRL(dataset.totals.custo)],
        [
          'Prêmio encalhe',
          fmtBRL(dataset.totals.premios)
        ],
        ['Resultado', fmtBRL(dataset.totals.resultado)]
      ]
    });
  }

  function renderResultado(dataset) {
    atualizarKpis({
      resultado: dataset.totals.resultado,
      resultadoMeta:
        `${dataset.totals.lojas} ` +
        `${dataset.totals.lojas === 1 ? 'loja' : 'lojas'} no consolidado`,
      aLabel: 'Operacional',
      a: dataset.totals.operacional,
      aMeta: 'Bolões + produtos + Federal',
      bLabel: 'Relatórios Caixa',
      b: dataset.totals.relatorios,
      bMeta: 'Jogos + serviços bancários',
      cLabel: 'Lojas',
      cRaw: fmtInt(dataset.totals.lojas),
      cMeta:
        state.lojaId === 'ALL'
          ? 'Visão da rede'
          : 'Visão individual'
    });

    const totalAbs = Math.max(
      1,
      Math.abs(dataset.totals.boloes) +
      Math.abs(dataset.totals.telesena) +
      Math.abs(dataset.totals.raspadinha) +
      Math.abs(dataset.totals.federal) +
      Math.abs(dataset.totals.jogos) +
      Math.abs(dataset.totals.bancarios)
    );

    const comps = [
      ['Bolões', dataset.totals.boloes],
      ['Tele Sena', dataset.totals.telesena],
      ['Raspadinha', dataset.totals.raspadinha],
      ['Federal', dataset.totals.federal],
      ['Rel. Jogos', dataset.totals.jogos],
      ['Serv. Bancários', dataset.totals.bancarios]
    ];

    const composition = comps.map(([label, value]) => `
      <div class="mestra-comp-row">
        <div class="mestra-comp-label">${esc(label)}</div>
        <div class="mestra-comp-track">
          <div
            class="mestra-comp-fill"
            style="--pct:${Math.min(
              100,
              (Math.abs(value) / totalAbs) * 100
            ).toFixed(2)}%"
          ></div>
        </div>
        <div class="mestra-comp-value">${fmtBRL(value)}</div>
      </div>
    `).join('');

    const manual = dataset.manualRows.find(
      row => String(row.storeId) === String(state.lojaId)
    );

    const manualCard = state.lojaId === 'ALL'
      ? `
        <article class="mestra-manual-card">
          <h3>Relatórios mensais por loja</h3>
          <p>
            Relatório de Jogos e Serviços Bancários são individuais.
            Selecione uma loja para lançar ou alterar os valores da competência.
          </p>
          <div class="mestra-manual-actions">
            <span class="mestra-badge">
              Selecione uma loja para editar
            </span>
          </div>
        </article>
      `
      : `
        <article class="mestra-manual-card">
          <h3>Lançamentos da competência</h3>
          <p>
            ${esc(nomeLoja(state.lojaId))} ·
            ${esc(nomeCompetencia(state.competencia))}
          </p>

          <div class="mestra-manual-fields">
            <label class="mestra-money-field">
              <span>Relatório de Jogos</span>
              <div class="mestra-money-input">
                <input
                  id="inputRelatorioJogos"
                  class="sl-input"
                  inputmode="decimal"
                  autocomplete="off"
                  value="${escAttr(fmtInputMoney(manual?.jogos || 0))}"
                />
              </div>
            </label>

            <label class="mestra-money-field">
              <span>Serviços Bancários</span>
              <div class="mestra-money-input">
                <input
                  id="inputServicosBancarios"
                  class="sl-input"
                  inputmode="decimal"
                  autocomplete="off"
                  value="${escAttr(fmtInputMoney(manual?.bancarios || 0))}"
                />
              </div>
            </label>
          </div>

          <div class="mestra-manual-actions">
            <button
              id="btnSalvarManual"
              class="sl-btn sl-btn--primary"
              type="button"
            >
              Salvar competência
            </button>
          </div>
        </article>
      `;

    const rowsHtml = dataset.rows.map(row => `
      <tr>
        ${tdBadge('Loja', row.loja, corLoja(row.storeId))}
        ${td(
          'Bolões',
          fmtBRL(row.boloes),
          `num ${classeResultado(row.boloes)}`
        )}
        ${td(
          'Tele Sena',
          fmtBRL(row.telesena),
          `num ${classeResultado(row.telesena)}`
        )}
        ${td(
          'Raspadinha',
          fmtBRL(row.raspadinha),
          `num ${classeResultado(row.raspadinha)}`
        )}
        ${td(
          'Federal',
          fmtBRL(row.federal),
          `num ${classeResultado(row.federal)}`
        )}
        ${td('Rel. Jogos', fmtBRL(row.jogos), 'num')}
        ${td(
          'Serv. Bancários',
          fmtBRL(row.bancarios),
          'num'
        )}
        ${td(
          'Total',
          fmtBRL(row.total),
          `num strong ${classeResultado(row.total)}`
        )}
      </tr>
    `).join('');

    const totalRow = state.lojaId === 'ALL'
      ? `
        <tr class="mestra-network-total">
          ${td('Loja', 'REDE', 'strong')}
          ${td('Bolões', fmtBRL(dataset.totals.boloes), 'num')}
          ${td(
            'Tele Sena',
            fmtBRL(dataset.totals.telesena),
            'num'
          )}
          ${td(
            'Raspadinha',
            fmtBRL(dataset.totals.raspadinha),
            'num'
          )}
          ${td('Federal', fmtBRL(dataset.totals.federal), 'num')}
          ${td(
            'Rel. Jogos',
            fmtBRL(dataset.totals.jogos),
            'num'
          )}
          ${td(
            'Serv. Bancários',
            fmtBRL(dataset.totals.bancarios),
            'num'
          )}
          ${td(
            'Total',
            fmtBRL(dataset.totals.resultado),
            `num strong ${classeResultado(
              dataset.totals.resultado
            )}`
          )}
        </tr>
      `
      : '';

    $('mestraContent').innerHTML = `
      <div class="mestra-result-grid">
        <article class="mestra-result-card">
          <h3>Composição do resultado</h3>
          <p>
            Participação de cada fonte no consolidado da competência.
          </p>
          <div class="mestra-composition">
            ${composition}
          </div>
        </article>

        ${manualCard}

        <article class="mestra-table-card mestra-result-table-wrap">
          <div class="mestra-table-scroll">
            <table class="mestra-table mestra-result-table">
              <thead>
                <tr>
                  <th>Loja</th>
                  <th class="num">Bolões</th>
                  <th class="num">Tele Sena</th>
                  <th class="num">Raspadinha</th>
                  <th class="num">Federal</th>
                  <th class="num">Rel. Jogos</th>
                  <th class="num">Serv. Bancários</th>
                  <th class="num">Total</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
                ${totalRow}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    `;

    $('btnSalvarManual')?.addEventListener(
      'click',
      salvarManual
    );

    vincularMoneyInputs();
  }

  function atualizarKpis({
    resultado = 0,
    resultadoMeta = 'Resultado da competência',
    aLabel = 'Faturamento',
    a = 0,
    aMeta = '—',
    bLabel = 'Custo',
    b = 0,
    bMeta = '—',
    cLabel = 'Volume',
    c = 0,
    cRaw = null,
    cMeta = '—'
  }) {
    $('kpiResultado').textContent = fmtBRL(resultado);
    $('kpiResultadoMeta').textContent = resultadoMeta;

    $('kpiLabelA').textContent = aLabel;
    $('kpiA').textContent = fmtBRL(a);
    $('kpiMetaA').textContent = aMeta;

    $('kpiLabelB').textContent = bLabel;
    $('kpiB').textContent = fmtBRL(b);
    $('kpiMetaB').textContent = bMeta;

    $('kpiLabelC').textContent = cLabel;
    $('kpiC').textContent =
      cRaw === null ? fmtBRL(c) : String(cRaw);
    $('kpiMetaC').textContent = cMeta;
  }

  function tableCard({ headers, body, totals = [] }) {
    return `
      <article class="mestra-table-card">
        <div class="mestra-table-scroll">
          <table class="mestra-table">
            <thead>
              <tr>
                ${headers
                  .map(header => `<th>${esc(header)}</th>`)
                  .join('')}
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>

        <div class="mestra-table-foot">
          ${totals.map(([label, value]) => `
            <div class="mestra-total-cell">
              <div class="mestra-total-label">
                ${esc(label)}
              </div>
              <div class="mestra-total-value">
                ${esc(value)}
              </div>
            </div>
          `).join('')}
        </div>
      </article>
    `;
  }

  function td(label, value, className = '') {
    return `
      <td
        data-label="${escAttr(label)}"
        class="${escAttr(className)}"
      >
        ${esc(value)}
      </td>
    `;
  }

  function tdBadge(label, value, color) {
    return `
      <td data-label="${escAttr(label)}">
        <span
          class="mestra-badge"
          style="--badge-color:${escAttr(color)}"
        >
          ${esc(value)}
        </span>
      </td>
    `;
  }

  function renderLoading() {
    $('mestraContent').innerHTML = `
      <div class="mestra-loading">
        <div class="mestra-skeleton mestra-skeleton--lg"></div>
        <div class="mestra-skeleton"></div>
        <div class="mestra-skeleton"></div>
        <div class="mestra-skeleton"></div>
      </div>
    `;
  }

  function renderEmpty(title, subtitle) {
    $('mestraContent').innerHTML = `
      <div class="mestra-empty">
        <div>
          <div class="mestra-state-icon">0</div>
          <div class="mestra-state-title">
            ${esc(title)}
          </div>
          <div class="mestra-state-sub">
            ${esc(subtitle)}
          </div>
        </div>
      </div>
    `;
  }

  function mostrarErro(message) {
    setStatus(message, 'err');

    $('mestraContent').innerHTML = `
      <div class="mestra-error">
        <div>
          <div class="mestra-state-icon">!</div>
          <div class="mestra-state-title">
            Não foi possível carregar esta visão
          </div>
          <div class="mestra-state-sub">
            ${esc(message)}
          </div>
          <div style="margin-top:14px">
            <button
              class="sl-btn sl-btn--primary"
              id="btnTentarNovamente"
              type="button"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </div>
    `;

    $('btnTentarNovamente')?.addEventListener(
      'click',
      () => carregarAbaAtual({ force: true })
    );
  }

  /* ─────────────────────────────────────────────────────────
     FILTRO LOCAL / EXPORTAÇÃO
     ───────────────────────────────────────────────────────── */

  function filtrarRows(rows, fields) {
    if (!state.filtro) return rows;

    return rows.filter(row =>
      fields.some(field =>
        String(row?.[field] ?? '')
          .toLowerCase()
          .includes(state.filtro)
      )
    );
  }

  function exportarAtual() {
    const dataset = state.ultimoDataset;

    if (!dataset?.rows?.length) {
      toast('Não há dados para exportar.', 'error');
      return;
    }

    let records = [];

    if (dataset.type === 'boloes') {
      records = dataset.rows.map(row => ({
        Origem: row.origem,
        Modalidade: row.modalidade,
        Concurso: row.concurso,
        Jogos: row.jogos ?? '',
        Dezenas: row.dezenas ?? '',
        Cotas: row.cotas,
        Valor_Cota: row.valorCota,
        Vendidas: row.vendidas,
        Encalhe_Total: row.encalhe,
        Preco_Jogo: row.custoJogo,
        Premio_Cota: row.premioCota ?? '',
        Premio_Recebido: row.premioRecebido,
        Lucro: row.lucro
      }));
    } else if (
      dataset.type === 'telesena' ||
      dataset.type === 'raspadinha'
    ) {
      records = dataset.rows.map(row => ({
        Loja: row.loja,
        Campanha: row.campanha,
        Item: row.item,
        Valor_Venda: row.valorVenda,
        Valor_Custo: row.valorCusto,
        Vendidas: row.qtdVendida,
        Faturamento_Bruto: row.faturamentoBruto,
        Desconto: row.desconto,
        Faturamento_Liquido: row.faturamentoLiquido,
        Custo: row.custo,
        Lucro: row.lucro
      }));
    } else if (dataset.type === 'federal') {
      records = dataset.rows.map(row => ({
        Origem: row.origem,
        Concurso: row.concurso,
        Sorteio: row.data,
        Valor_Fracao: row.valorFracao,
        Valor_Custo: row.valorCusto,
        Venda_Interna: row.vendaInterna,
        Venda_Externa: row.vendaExterna,
        Encalhe: row.encalhe,
        Premio_Encalhe: row.premioEncalhe,
        Receitas_Terceiros: row.receitasTerceiros,
        Resultado: row.resultado
      }));
    } else {
      records = dataset.rows.map(row => ({
        Loja: row.loja,
        Boloes: row.boloes,
        Tele_Sena: row.telesena,
        Raspadinha: row.raspadinha,
        Federal: row.federal,
        Relatorio_Jogos: row.jogos,
        Servicos_Bancarios: row.bancarios,
        Total: row.total
      }));
    }

    baixarCsv(
      `mestra-${state.tab}-${state.competencia}-${state.lojaSlug}.csv`,
      records
    );
  }

  function baixarCsv(nome, records) {
    if (!records.length) return;

    const headers = Object.keys(records[0]);
    const lines = [
      headers.join(';'),
      ...records.map(record =>
        headers
          .map(header => csvCell(record[header]))
          .join(';')
      )
    ];

    const blob = new Blob(
      ['\uFEFF' + lines.join('\r\n')],
      { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = nome;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);
    toast('CSV exportado.');
  }

  /* ─────────────────────────────────────────────────────────
     INPUTS / STATUS / TOAST
     ───────────────────────────────────────────────────────── */

  function vincularMoneyInputs() {
    [
      'inputRelatorioJogos',
      'inputServicosBancarios'
    ].forEach(id => {
      const input = $(id);
      if (!input) return;

      input.addEventListener(
        'focus',
        () => input.select()
      );

      input.addEventListener('blur', () => {
        input.value = fmtInputMoney(
          parseMoneyInput(input.value)
        );
      });
    });
  }

  function setButtonLoading(button, loading) {
    if (!button) return;

    button.disabled = loading;

    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

    button.textContent = loading
      ? 'Salvando…'
      : button.dataset.originalText;
  }

  function setStatus(message = '', type = 'ok') {
    const el = $('status');
    if (!el) return;

    if (!message) {
      el.textContent = '';
      el.className = 'sl-status-bar';
      return;
    }

    const normalized =
      type === 'error' ? 'err' : type;

    el.textContent = message;
    el.className =
      `sl-status-bar show ${normalized}`;
  }

  function toast(message, type = 'ok') {
    const el = $('toast');
    if (!el) return;

    $('toastMsg').textContent = message;
    el.classList.toggle(
      'is-error',
      type === 'error'
    );
    el.classList.add('is-visible');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => el.classList.remove('is-visible'),
      3200
    );
  }

  /* ─────────────────────────────────────────────────────────
     UTILITÁRIOS
     ───────────────────────────────────────────────────────── */

  function iniciarRelogioFallback() {
    const tick = () => {
      const el = $('relogio');
      if (!el) return;

      el.textContent = new Intl.DateTimeFormat(
        'pt-BR',
        {
          timeZone: CONFIG.timezone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }
      ).format(new Date());
    };

    tick();
    setInterval(tick, 1000);
  }

  function mesAtualSP() {
    const parts = new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit'
      }
    ).formatToParts(new Date());

    const year =
      parts.find(p => p.type === 'year')?.value;
    const month =
      parts.find(p => p.type === 'month')?.value;

    return `${year}-${month}`;
  }

  function intervaloMes(competencia) {
    const [year, month] =
      competencia.split('-').map(Number);

    const next = new Date(
      year,
      month,
      1,
      12
    );

    const nextYear = next.getFullYear();
    const nextMonth =
      String(next.getMonth() + 1).padStart(2, '0');

    return {
      inicio: `${competencia}-01`,
      proximo: `${nextYear}-${nextMonth}-01`
    };
  }

  function nomeCompetencia(competencia) {
    const [year, month] =
      competencia.split('-').map(Number);

    const label = new Intl.DateTimeFormat(
      'pt-BR',
      {
        month: 'long',
        year: 'numeric'
      }
    ).format(
      new Date(year, month - 1, 1, 12)
    );

    return (
      label.charAt(0).toUpperCase() +
      label.slice(1)
    );
  }

  function nomeLoja(id) {
    return (
      state.lojas.find(
        loja => Number(loja.id) === Number(id)
      )?.nome ||
      `Loja ${id}`
    );
  }

  function corLoja(id) {
    const loja = state.lojas.find(
      item => Number(item.id) === Number(id)
    );

    const themeColor =
      window.SISLOT_THEME?.LOJAS?.[
        loja?.slug || ''
      ]?.cor;

    return themeColor || 'var(--t1)';
  }

  function slugificar(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  function formatModalidade(value) {
    const key = String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    const map = {
      LOTOFACIL: 'LOTOFÁCIL',
      MEGA_SENA: 'MEGA-SENA',
      DUPLA_SENA: 'DUPLA SENA',
      DIA_DE_SORTE: 'DIA DE SORTE',
      SUPER_SETE: 'SUPER SETE',
      SUPERSETE: 'SUPER SETE',
      MAIS_MILIONARIA: '+MILIONÁRIA',
      MILIONARIA: '+MILIONÁRIA',
      TIMEMANIA: 'TIMEMANIA',
      QUINA: 'QUINA',
      LOTOMANIA: 'LOTOMANIA',
      LOTECA: 'LOTECA'
    };

    return (
      map[key] ||
      key.replace(/_/g, ' ') ||
      '—'
    );
  }

  function fmtBRL(value) {
    return new Intl.NumberFormat(
      'pt-BR',
      {
        style: 'currency',
        currency: 'BRL'
      }
    ).format(n(value));
  }

  function fmtInt(value) {
    return new Intl.NumberFormat(
      'pt-BR',
      { maximumFractionDigits: 0 }
    ).format(n(value));
  }

  function fmtData(value) {
    if (!value) return '—';

    const match = String(value).match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );

    if (match) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';

    return new Intl.DateTimeFormat(
      'pt-BR',
      { timeZone: CONFIG.timezone }
    ).format(date);
  }

  function fmtInputMoney(value) {
    return n(value).toLocaleString(
      'pt-BR',
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    );
  }

  function parseMoneyInput(value) {
    const text = String(value ?? '').trim();
    if (!text) return 0;

    let normalized =
      text.replace(/[R$\s]/g, '');

    if (normalized.includes(',')) {
      normalized = normalized
        .replace(/\./g, '')
        .replace(',', '.');
    }

    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function n(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function nullableNumber(value) {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number)
      ? number
      : null;
  }

  function showNum(value) {
    return value === null || value === undefined
      ? '—'
      : fmtInt(value);
  }

  function soma(rows, field) {
    return (rows || []).reduce(
      (total, row) =>
        total + n(row?.[field]),
      0
    );
  }

  function somaPorLoja(
    rows,
    storeId,
    field
  ) {
    return (rows || [])
      .filter(
        row =>
          Number(row.storeId) ===
          Number(storeId)
      )
      .reduce(
        (total, row) =>
          total + n(row[field]),
        0
      );
  }

  function unicosNumericos(values) {
    return [
      ...new Set(
        (values || [])
          .map(Number)
          .filter(
            value =>
              Number.isFinite(value) &&
              value > 0
          )
      )
    ];
  }

  function chunkArray(values, size = 200) {
    const chunks = [];

    for (
      let i = 0;
      i < values.length;
      i += size
    ) {
      chunks.push(values.slice(i, i + size));
    }

    return chunks;
  }

  function classeResultado(value) {
    const number = n(value);
    if (number > 0) return 'positive';
    if (number < 0) return 'negative';
    return '';
  }

  function normalizarErro(error) {
    const message = String(
      error?.message ||
      error ||
      'Erro inesperado.'
    );

    if (
      message.includes('permission denied') ||
      message.includes('row-level security')
    ) {
      return (
        'Seu usuário não possui permissão ' +
        'no banco para esta operação.'
      );
    }

    return message;
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escAttr(value) {
    return esc(value)
      .replace(/`/g, '&#096;');
  }

  function csvCell(value) {
    const text = String(value ?? '')
      .replace(/"/g, '""');

    return `"${text}"`;
  }

  function debounce(fn, delay = 120) {
    let timer = null;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(
        () => fn(...args),
        delay
      );
    };
  }
})();
