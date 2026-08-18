/**
 * SISLOT — Theme Manager
 * Centraliza a lógica de tema por lotérica.
 * Versão: 3.1
 *
 * v3.1:
 * - LotoPrime adicionada.
 * - registrarLoja()/registrarLojas() para lojas vindas do banco.
 * - fallback de logo sem gerar loop de 404.
 */
(function () {
  'use strict';

  const LOJAS = {
    'boulevard':    { nome: 'Boulevard',    slug: 'boulevard',    cor: '#3b82f6', logo: './icons/boulevard.png' },
    'centro':       { nome: 'Centro',       slug: 'centro',       cor: '#00c896', logo: './icons/centro.png' },
    'lotobel':      { nome: 'Lotobel',      slug: 'lotobel',      cor: '#ef4444', logo: './icons/lotobel.png' },
    'santa-tereza': { nome: 'Santa Tereza', slug: 'santa-tereza', cor: '#a855f7', logo: './icons/santa-tereza.png' },
    'via-brasil':   { nome: 'Via Brasil',   slug: 'via-brasil',   cor: '#eab308', logo: './icons/via-brasil.png' },
    'lotoprime':    { nome: 'LotoPrime',    slug: 'lotoprime',    cor: '#f59e0b', logo: './icons/lotoprime.png' },
    'todas':        { nome: 'Todas',        slug: 'todas',        cor: '#94a3b8', logo: './icons/loterpraca.png' },
  };

  const STORAGE_KEY = 'sislot_loja_slug';

  function registrarLoja(loja) {
    const slug = String(
      loja?.slug ??
      loja?.loteria_slug ??
      ''
    ).trim();

    if (!slug || slug === 'todas') return null;

    const nome = String(
      loja?.nome ??
      loja?.loteria_nome ??
      slug
    ).trim();

    const atual = LOJAS[slug] || {};

    LOJAS[slug] = {
      ...atual,
      nome: nome || atual.nome || slug,
      slug,
      cor: loja?.cor || atual.cor || '#64748b',
      logo:
        loja?.logo ||
        loja?.logo_url ||
        loja?.logo_path ||
        atual.logo ||
        `./icons/${slug}.png`
    };

    return LOJAS[slug];
  }

  function registrarLojas(lista) {
    (Array.isArray(lista) ? lista : []).forEach(registrarLoja);
    return listLojas();
  }

  function aplicarTema(slug) {
    const solicitado = String(slug || 'todas').trim();
    const loja = LOJAS[solicitado] || LOJAS['todas'];

    document.body.dataset.loja = loja.slug;
    sessionStorage.setItem(STORAGE_KEY, loja.slug);

    _atualizarHeaderLogo(loja);
    _atualizarHeaderNome(loja);
    _dispatchTemaEvent(loja);
  }

  function lojaAtiva() {
    const slug =
      document.body.dataset.loja ||
      sessionStorage.getItem(STORAGE_KEY) ||
      'todas';

    return LOJAS[slug] || LOJAS['todas'];
  }

  function lojaSlug() {
    return lojaAtiva().slug;
  }

  function listLojas() {
    return Object.values(LOJAS)
      .filter(loja => loja.slug !== 'todas');
  }

  function init(fallback = 'todas') {
    const salvo = sessionStorage.getItem(STORAGE_KEY);
    const slug =
      salvo && LOJAS[salvo]
        ? salvo
        : fallback;

    aplicarTema(slug);

    const relogio = document.getElementById('relogio');
    if (relogio) _startClock('relogio');

    const sel = document.getElementById('sl-loja-select');
    if (sel) {
      _preencherSeletorLoja(sel);
      sel.addEventListener(
        'change',
        e => aplicarTema(e.target.value)
      );
    }
  }

  function _atualizarHeaderLogo(loja) {
    const img = document.querySelector('.sl-loja-logo img');
    if (!img) return;

    img.style.display = '';
    img.alt = loja.nome;

    const principal =
      loja.logo ||
      `./icons/${loja.slug}.png`;

    const fallback = './icons/loterpraca.png';

    img.onerror = () => {
      img.onerror = null;

      if (img.src.endsWith('/loterpraca.png')) {
        img.style.display = 'none';
        return;
      }

      img.src = fallback;
    };

    img.src = principal;
  }

  function _atualizarHeaderNome(loja) {
    const el = document.querySelector('.sl-header-nome');
    if (el) el.textContent = loja.nome;
  }

  function _dispatchTemaEvent(loja) {
    document.dispatchEvent(
      new CustomEvent(
        'sislot:tema',
        { detail: { ...loja } }
      )
    );
  }

  function _preencherSeletorLoja(sel) {
    const ativo = lojaSlug();

    sel.innerHTML = Object.values(LOJAS)
      .map(loja =>
        `<option value="${loja.slug}" ${
          loja.slug === ativo ? 'selected' : ''
        }>${loja.nome}</option>`
      )
      .join('');
  }

  function _startClock(id) {
    const el = document.getElementById(id);
    if (!el) return;

    const tick = () => {
      const now = new Date();

      el.textContent =
        now.toLocaleTimeString('pt-BR') +
        ' — ' +
        now.toLocaleDateString('pt-BR', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
    };

    tick();
    setInterval(tick, 1000);
  }

  window.SISLOT_THEME = {
    init,
    aplicarTema,
    lojaAtiva,
    lojaSlug,
    listLojas,
    registrarLoja,
    registrarLojas,
    LOJAS
  };

  console.log('✓ SISLOT_THEME carregado (v3.1 dinâmico)');
})();
