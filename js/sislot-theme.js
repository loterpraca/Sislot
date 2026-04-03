/**
 * SISLOT — Theme + Context Manager
 * Centraliza:
 * - contexto do usuário
 * - lojas permitidas
 * - loja principal
 * - tema visual por loja
 * - seletor de loja
 * - eventos globais de troca
 *
 * Requer:
 * - window.SISLOT_CONFIG.url
 * - window.SISLOT_CONFIG.anonKey
 * - views:
 *   - vw_usuario_contexto
 *   - vw_usuarios_loterias_ativas
 */

(function () {
  'use strict';

  const VIEW_USUARIO_CONTEXTO = 'vw_usuario_contexto';
  const VIEW_USUARIOS_LOTERIAS_ATIVAS = 'vw_usuarios_loterias_ativas';
  const STORAGE_KEY = 'sislot_loja_slug';

  const LOJAS = {
    'boulevard': {
      nome: 'Boulevard',
      slug: 'boulevard',
      cor: '#3b82f6',
      logo: './icons/boulevard.png'
    },
    'centro': {
      nome: 'Centro',
      slug: 'centro',
      cor: '#00c896',
      logo: './icons/centro.png'
    },
    'lotobel': {
      nome: 'Lotobel',
      slug: 'lotobel',
      cor: '#ef4444',
      logo: './icons/lotobel.png'
    },
    'santa-tereza': {
      nome: 'Santa Tereza',
      slug: 'santa-tereza',
      cor: '#a855f7',
      logo: './icons/santa-tereza.png'
    },
    'via-brasil': {
      nome: 'Via Brasil',
      slug: 'via-brasil',
      cor: '#eab308',
      logo: './icons/via-brasil.png'
    },
    'todas': {
      nome: 'Todas',
      slug: 'todas',
      cor: '#94a3b8',
      logo: ''
    }
  };

  const state = {
    client: null,
    session: null,
    contexto: null,
    lojasPermitidas: [],
    lojaAtual: null,
    clockTimer: null,
    options: {
      fallback: 'todas',
      selectId: 'sl-loja-select',
      clockId: 'relogio',
      includeTodas: false,
      logoSelector: '.sl-loja-logo img',
      nomeSelector: '.sl-header-nome'
    }
  };

  function getClient() {
    if (state.client) return state.client;

    if (window.sb && typeof window.sb.from === 'function') {
      state.client = window.sb;
      return state.client;
    }

    if (
      window.supabase &&
      typeof window.supabase.createClient === 'function' &&
      window.SISLOT_CONFIG?.url &&
      window.SISLOT_CONFIG?.anonKey
    ) {
      state.client = window.supabase.createClient(
        window.SISLOT_CONFIG.url,
        window.SISLOT_CONFIG.anonKey
      );
      return state.client;
    }

    throw new Error('Supabase client não encontrado.');
  }

  function _mergeOptions(opts = {}) {
    state.options = { ...state.options, ...opts };
  }

  function _setThemeVars(loja) {
    const root = document.documentElement;
    const body = document.body;

    root.dataset.lojaSlug = loja.slug;
    body.dataset.loja = loja.slug;

    root.style.setProperty('--store-color', loja.cor || '#94a3b8');
    root.style.setProperty('--brand', loja.cor || '#94a3b8');
  }

  function _dispatchTemaEvent(loja, source = 'manual') {
    const detail = {
      loja,
      source,
      contexto: state.contexto,
      lojasPermitidas: state.lojasPermitidas
    };

    document.dispatchEvent(new CustomEvent('sislot:tema', { detail }));
    window.dispatchEvent(new CustomEvent('sislot:loja-change', { detail }));
  }

  function _atualizarHeaderLogo(loja) {
    const img = document.querySelector(state.options.logoSelector);
    if (!img) return;

    if (!loja.logo) {
      img.style.display = 'none';
      return;
    }

    img.style.display = '';
    img.src = loja.logo;
    img.alt = loja.nome;
    img.onerror = () => {
      img.style.display = 'none';
    };
  }

  function _atualizarHeaderNome(loja) {
    const el = document.querySelector(state.options.nomeSelector);
    if (el) el.textContent = loja.nome;
  }

  function _startClock(id) {
    const el = document.getElementById(id);
    if (!el) return;

    if (state.clockTimer) clearInterval(state.clockTimer);

    const tick = () => {
      const now = new Date();
      el.textContent =
        now.toLocaleTimeString('pt-BR') + ' — ' +
        now.toLocaleDateString('pt-BR', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
    };

    tick();
    state.clockTimer = setInterval(tick, 1000);
  }

  function _slugPermitido(slug) {
    if (slug === 'todas') return !!state.options.includeTodas;
    return state.lojasPermitidas.some(l => l.slug === slug);
  }

  function _resolverLoja(slug) {
    if (slug === 'todas') return { ...LOJAS.todas, loteria_id: null };

    const vinculada = state.lojasPermitidas.find(l => l.slug === slug);
    const canonica = LOJAS[slug];

    if (vinculada) {
      return {
        nome: vinculada.nome,
        slug: vinculada.slug,
        cor: canonica?.cor || '#94a3b8',
        logo: canonica?.logo || '',
        loteria_id: vinculada.id,
        principal: !!vinculada.principal
      };
    }

    return { ...LOJAS.todas, loteria_id: null };
  }

  function _slugInicial() {
    const salvo = sessionStorage.getItem(STORAGE_KEY);
    if (salvo && _slugPermitido(salvo)) return salvo;

    const principal = state.contexto?.loteria_principal_slug;
    if (principal && _slugPermitido(principal)) return principal;

    if (state.lojasPermitidas.length) return state.lojasPermitidas[0].slug;

    return state.options.fallback || 'todas';
  }

  function _preencherSeletorLoja(sel) {
    const ativo = state.lojaAtual?.slug || _slugInicial();

    const opcoes = [];

    if (state.options.includeTodas) {
      opcoes.push({
        nome: 'Todas',
        slug: 'todas'
      });
    }

    state.lojasPermitidas.forEach(l => {
      opcoes.push({
        nome: l.nome,
        slug: l.slug
      });
    });

    sel.innerHTML = opcoes.map(l => {
      return `<option value="${l.slug}" ${l.slug === ativo ? 'selected' : ''}>${l.nome}</option>`;
    }).join('');
  }

  async function _carregarSessao() {
    const sb = getClient();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    state.session = data?.session || null;
    return state.session;
  }

  async function _carregarContexto() {
    const sb = getClient();
    const authUserId = state.session?.user?.id;
    if (!authUserId) return null;

    const { data, error } = await sb
      .from(VIEW_USUARIO_CONTEXTO)
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (error) throw error;

    state.contexto = data || null;
    return state.contexto;
  }

  async function _carregarLojasPermitidas() {
    const sb = getClient();
    const authUserId = state.session?.user?.id;
    if (!authUserId) {
      state.lojasPermitidas = [];
      return [];
    }

    const { data, error } = await sb
      .from(VIEW_USUARIOS_LOTERIAS_ATIVAS)
      .select('loteria_id,loteria_nome,loteria_slug,principal,papel_na_loja,perfil')
      .eq('auth_user_id', authUserId)
      .order('principal', { ascending: false })
      .order('loteria_nome', { ascending: true });

    if (error) throw error;

    state.lojasPermitidas = (data || []).map(r => ({
      id: r.loteria_id,
      nome: r.loteria_nome,
      slug: r.loteria_slug,
      principal: !!r.principal,
      papel_na_loja: r.papel_na_loja,
      perfil: r.perfil
    }));

    return state.lojasPermitidas;
  }

  function aplicarTema(slug, opts = {}) {
    const { persist = true, source = 'manual' } = opts;

    const slugFinal = _slugPermitido(slug) ? slug : _slugInicial();
    const loja = _resolverLoja(slugFinal);

    state.lojaAtual = loja;

    _setThemeVars(loja);
    _atualizarHeaderLogo(loja);
    _atualizarHeaderNome(loja);

    if (persist) {
      sessionStorage.setItem(STORAGE_KEY, loja.slug);
    }

    const sel = document.getElementById(state.options.selectId);
    if (sel && sel.value !== loja.slug) {
      sel.value = loja.slug;
    }

    _dispatchTemaEvent(loja, source);
    return loja;
  }

  function lojaAtiva() {
    return state.lojaAtual || _resolverLoja(_slugInicial());
  }

  function lojaSlug() {
    return lojaAtiva().slug;
  }

  function listLojas() {
    return [...state.lojasPermitidas];
  }

  function getContexto() {
    return state.contexto;
  }

  function getAllowedStoreIds() {
    return state.lojasPermitidas.map(l => l.id);
  }

  function getAllowedStores() {
    return [...state.lojasPermitidas];
  }

  async function init(opts = {}) {
    _mergeOptions(opts);

    await _carregarSessao();
    await _carregarContexto();
    await _carregarLojasPermitidas();

    const sel = document.getElementById(state.options.selectId);
    if (sel) {
      _preencherSeletorLoja(sel);
      sel.addEventListener('change', e => {
        aplicarTema(e.target.value, { source: 'selector' });
      });
    }

    const slug = _slugInicial();
    aplicarTema(slug, { source: 'init' });

    const relogio = document.getElementById(state.options.clockId);
    if (relogio) _startClock(state.options.clockId);

    return {
      session: state.session,
      contexto: state.contexto,
      lojasPermitidas: state.lojasPermitidas,
      lojaAtual: state.lojaAtual
    };
  }

  window.SISLOT_THEME = {
    init,
    aplicarTema,
    lojaAtiva,
    lojaSlug,
    listLojas,
    getContexto,
    getAllowedStoreIds,
    getAllowedStores,
    LOJAS,
    state
  };

  console.log('✓ SISLOT_THEME carregado');
})();
