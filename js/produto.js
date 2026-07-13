(() => {
  'use strict';

  if (window.__SISLOT_PRODUTO_CARREGADO__) {
    console.warn('[SISLOT Produto] Script já carregado; segunda execução ignorada.');
    return;
  }
  window.__SISLOT_PRODUTO_CARREGADO__ = true;

/**
 * SISLOT — Produto
 * Cadastro · Movimentação · Estoque · Mestra
 */

const sb = window.supabase && window.SISLOT_CONFIG
  ? supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey)
  : null;

const utils = window.SISLOT_UTILS || {};
const $     = utils.$     || (id => document.getElementById(id));
const fmtBR = utils.fmtBR || (v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
const fmtBRL= utils.fmtBRL|| (v => parseFloat(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

// ── Margens de custo por tipo ─────────────────────────
// Raspadinha: lucro 20% → custo = venda × 0.80
// Tele Sena:  lucro  8% → custo = venda × 0.92
const MARGEM_CUSTO = {
  RASPADINHA: 0.80,
  TELESENA:   0.92,
};

function calcularCusto(tipo, valorVenda) {
  const fator = MARGEM_CUSTO[tipo] ?? 0.80;
  return Number((Number(valorVenda || 0) * fator).toFixed(2));
}

// ── Lojas do sistema — carregadas dinamicamente ───────
// Switch: somente lojas permitidas ao usuário.
// Movimentação: todas as lojas ativas cadastradas no banco.
function normalizarCaminhoLogo(caminho, slug) {
  const valor = String(caminho || '').trim();

  if (!valor) return `./icons/${slug}.png`;
  if (/^(https?:|data:|blob:|\/|\.\/|\.\.\/)/i.test(valor)) return valor;
  if (valor.startsWith('icons/')) return `./${valor}`;

  return `./icons/${valor}`;
}

function normalizarLojaProduto(loja = {}) {
  const id = Number(loja.id ?? loja.loteria_id ?? 0);
  const slug = String(loja.slug ?? loja.loteria_slug ?? '').trim();
  const nome = String(loja.nome ?? loja.loteria_nome ?? slug ?? '').trim();

  return {
    id,
    nome: nome || 'Loja',
    slug,
    codigo: loja.codigo ?? loja.loteria_codigo ?? '',
    codLoterico: loja.cod_loterico ?? loja.loteria_cod_loterico ?? '',
    logo: normalizarCaminhoLogo(
      loja.logo_url ?? loja.logo_path ?? loja.loteria_logo_url ?? '',
      slug
    ),
    logoPosicao: loja.logo_posicao ?? loja.logo_pos ?? '50% 50%',
    tema: loja.tema ?? slug ?? 'centro',
    iconeEmoji: loja.icone_emoji ?? '📍',
    iconeClasse: loja.icone_classe ?? 'fas fa-store',
    ativo: loja.ativo !== false,
    principal: Boolean(loja.principal),
    papelNaLoja: loja.papel_na_loja ?? loja.papelNaLoja ?? ''
  };
}

function mesclarLojaPermitida(lojaPermitida, lojasAtivas) {
  const basica = normalizarLojaProduto(lojaPermitida);
  const completa = (lojasAtivas || []).find(loja =>
    Number(loja.id) === Number(basica.id) ||
    (basica.slug && loja.slug === basica.slug)
  );

  return completa
    ? { ...completa, principal: basica.principal, papelNaLoja: basica.papelNaLoja }
    : basica;
}

async function carregarLojasProduto(ctx = null) {
  let lojasAtivas = [];

  if (sb) {
    const { data, error } = await sb
      .from('loterias')
      .select('*')
      .eq('ativo', true)
      .order('nome', { ascending: true });

    if (!error) {
      lojasAtivas = (data || [])
        .map(normalizarLojaProduto)
        .filter(loja => loja.id && loja.slug);
    } else {
      console.warn('[SISLOT] Consulta direta de lojas falhou:', error.message);
    }
  }

  if (!lojasAtivas.length && window.SISLOT_SECURITY?.carregarTodasLojas) {
    try {
      const lista = await window.SISLOT_SECURITY.carregarTodasLojas();
      lojasAtivas = (lista || [])
        .map(normalizarLojaProduto)
        .filter(loja => loja.id && loja.slug);
    } catch (e) {
      console.warn('[SISLOT] Fallback carregarTodasLojas falhou:', e);
    }
  }

  const permitidasBase = ctx?.lojasPermitidas || [];
  let lojasPermitidas = permitidasBase
    .map(loja => mesclarLojaPermitida(loja, lojasAtivas))
    .filter(loja => loja.id && loja.slug);

  // Sem segurança conectada, permite operar com todas as lojas ativas.
  if (!window.SISLOT_SECURITY && !lojasPermitidas.length) {
    lojasPermitidas = [...lojasAtivas];
  }

  state.lojasAtivas = lojasAtivas;
  state.lojasPermitidas = lojasPermitidas;

  const inicialBase = normalizarLojaProduto(ctx?.lojaInicial || {});
  state.lojaAtiva = lojasPermitidas.find(loja =>
    Number(loja.id) === Number(inicialBase.id) ||
    (inicialBase.slug && loja.slug === inicialBase.slug)
  ) || lojasPermitidas.find(loja => loja.principal) || lojasPermitidas[0] || null;

  if (!state.lojaAtiva) {
    throw new Error('Nenhuma loja ativa e permitida para este usuário.');
  }

  window.SISLOT_PRODUTO_DEBUG = {
    getLojaAtiva: () => ({ ...state.lojaAtiva }),
    getLojasPermitidas: () => state.lojasPermitidas.map(loja => ({ ...loja })),
    getLojasAtivas: () => state.lojasAtivas.map(loja => ({ ...loja }))
  };
}

// ── Estado global ────────────────────────────────────
const state = {
  screen:       'cadastro',
  abaCadastro:  null,
  lojaAtiva:    null,
  lojasPermitidas: [],
  lojasAtivas:    [],
  tipoFiltro:   'todos',
  panelItem:    null,
  tipoMov:      'ENTRADA',
  usuario:      null,
  roleUsuario:  'ADMIN',
  movHistorico: [],
  carregando:   false,
  dashboard:    [],
  mestra:       [],
  mestraCarregando: false,
};

// ══════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    let ctx = null;

    if (window.SISLOT_SECURITY) {
      ctx = await window.SISLOT_SECURITY.protegerPagina?.('produto');
      if (!ctx) return;

      state.usuario     = ctx.usuario;
      state.roleUsuario = ctx.usuario?.perfil || ctx.usuario?.role || 'OPERADOR';
    }

    await carregarLojasProduto(ctx);

    bind();
    aplicarTema(state.lojaAtiva);
    renderScreenTabs();
    await carregarDashboard();
    renderCards();
    renderMovSelects();
    renderEstoque();
    prepararFiltroMestraMensal();
    if (['ADMIN','SOCIO'].includes(state.roleUsuario)) {
      await carregarMestraMensal();
    }
    renderMestra();
    preencherData();
  } catch (e) {
    console.error('[SISLOT] Erro ao iniciar:', e);
    alert('Erro ao iniciar: ' + (e.message || e));
  }
}

// ══════════════════════════════════════════════════════
// TEMA POR LOJA
// ══════════════════════════════════════════════════════
function aplicarTema(loja = state.lojaAtiva) {
  if (!loja) return;

  const slug = loja.slug || 'centro';
  const nomeLoja = loja.nome || 'SISLOT';
  const tema = loja.tema || slug;

  document.body.dataset.loja = slug;
  document.body.dataset.theme = tema;
  document.documentElement.dataset.loja = slug;
  document.documentElement.dataset.theme = tema;

  const logo = $('lojaLogo');
  if (logo) {
    logo.onerror = () => {
      logo.onerror = null;
      logo.src = './icons/centro.png';
    };
    logo.src = loja.logo || `./icons/${slug}.png`;
    logo.alt = nomeLoja;
    logo.style.objectPosition = loja.logoPosicao || '50% 50%';
  }

  const nome = $('headerNome');
  if (nome) nome.textContent = nomeLoja;

  const estNome = $('estoqueLojaNome');
  if (estNome) estNome.textContent = nomeLoja;

  const movOrigem = $('movOrigem');
  if (movOrigem) movOrigem.value = String(loja.id);

  const lojaTree = $('lojaTreeWrap');
  if (lojaTree) lojaTree.title = `${nomeLoja} — clique para trocar de loja`;
}

// ══════════════════════════════════════════════════════
// TROCA DE LOJA — CICLO DIRETO SEM MODAL
// Cada clique na árvore avança para a próxima loja.
// Um toast leve confirma qual loja foi ativada.
// ══════════════════════════════════════════════════════
async function alternarLoja() {
  if (state.carregando) return;

  const lojas = state.lojasPermitidas || [];
  if (!lojas.length) return;

  const idxAtual = lojas.findIndex(loja =>
    Number(loja.id) === Number(state.lojaAtiva?.id)
  );
  const proximoIndice = idxAtual >= 0
    ? (idxAtual + 1) % lojas.length
    : 0;

  state.lojaAtiva = lojas[proximoIndice];

  aplicarTema(state.lojaAtiva);
  mostrarToastLoja(state.lojaAtiva);

  await carregarDashboard();
  renderCards();
  renderMovSelects();
  renderEstoque();

  if (['ADMIN','SOCIO'].includes(state.roleUsuario)) {
    await carregarMestraMensal();
  }
  renderMestra();
}

function mostrarToastLoja(loja) {
  const nome = loja?.nome || 'Loja';
  const iconeClasse = loja?.iconeClasse || 'fas fa-store';
  let toast = $('toastLoja');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastLoja';
    Object.assign(toast.style, {
      position:   'fixed',
      bottom:     '80px',
      left:       '50%',
      transform:  'translateX(-50%) translateY(12px)',
      background: 'var(--surface2,#1e2535)',
      color:      'var(--text1,#f1f5f9)',
      padding:    '10px 22px',
      borderRadius: '999px',
      fontSize:   '13px',
      fontWeight: '600',
      boxShadow:  '0 4px 24px rgba(0,0,0,.4)',
      zIndex:     '9999',
      opacity:    '0',
      transition: 'opacity .18s, transform .18s',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<i class="${iconeClasse}" style="margin-right:8px;opacity:.7"></i>${nome}`;
  toast.style.opacity   = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateX(-50%) translateY(12px)';
  }, 1800);
}

// ══════════════════════════════════════════════════════
// DASHBOARD — SUPABASE
// ══════════════════════════════════════════════════════
async function carregarDashboard() {
  if (!sb) {
    console.warn('[SISLOT] Supabase não configurado.');
    mostrarEstadoVazio('Supabase não configurado.');
    return;
  }

  state.carregando = true;
  mostrarLoadingCards();

  try {
    const { data, error } = await sb
      .from('view_produtos_dashboard_loja')
      .select('*')
      .eq('loteria_id', state.lojaAtiva.id)
      .order('produto',   { ascending: true })
      .order('item_nome', { ascending: true });

    if (error) throw error;

    state.dashboard = (data || []).map(item => ({
      // id composto — chave única usada em dataset, findIndex e selects
      id: item.produto === 'RASPADINHA'
            ? `R:${item.raspadinha_id}`
            : `T:${item.telesena_item_id}`,

      produto:              item.produto,
      raspadinha_id:        item.raspadinha_id     ?? null,
      telesena_item_id:     item.telesena_item_id  ?? null,
      campanha_nome:        item.campanha_nome      ?? null,
      item_nome:            item.item_nome,
      saldo_atual:          Number(item.saldo_atual           || 0),
      vendidas_7d:          Number(item.vendidas_7d           || 0),
      media_dia_7d:         Number(item.media_dia_7d          || 0),
      duracao_estoque_dias: Number(item.duracao_estoque_dias  || 0),
      valor_venda:          Number(item.valor_venda           || 0),
      valor_custo:          Number(item.valor_custo           || 0),
    }));

  } catch (e) {
    console.error('[SISLOT] Erro ao carregar dashboard:', e);
    mostrarErroDashboard(e.message || String(e));
    state.dashboard = [];
  } finally {
    state.carregando = false;
  }
}

function mostrarLoadingCards() {
  const html = `
    <div class="empty-state" style="opacity:.5">
      <i class="fas fa-circle-notch fa-spin"></i>
      <span>Carregando produtos…</span>
    </div>`;
  ['cardsCadastro','cardsEstoque'].forEach(id => { const el = $(id); if (el) el.innerHTML = html; });
}

function mostrarEstadoVazio(msg) {
  const html = `
    <div class="empty-state">
      <i class="fas fa-box-open"></i>
      <span>${msg || `Nenhum produto para ${state.lojaAtiva.nome}.`}</span>
    </div>`;
  ['cardsCadastro','cardsEstoque'].forEach(id => { const el = $(id); if (el) el.innerHTML = html; });
}

function mostrarErroDashboard(msg) {
  const html = `
    <div class="empty-state" style="color:var(--error,#f87171)">
      <i class="fas fa-exclamation-triangle"></i>
      <span>Erro ao carregar: ${msg}</span>
    </div>`;
  ['cardsCadastro','cardsEstoque'].forEach(id => { const el = $(id); if (el) el.innerHTML = html; });
}

// ══════════════════════════════════════════════════════
// NAVEGAÇÃO DE TELAS
// ══════════════════════════════════════════════════════
function renderScreenTabs() {
  const podeVerMestra = ['ADMIN','SOCIO'].includes(state.roleUsuario);
  const btnMestra = $('btnMestra');
  if (btnMestra && !podeVerMestra) btnMestra.style.display = 'none';
}

function mudarScreen(screen) {
  if (screen === 'mestra' && !['ADMIN','SOCIO'].includes(state.roleUsuario)) return;
  state.screen = screen;

  document.querySelectorAll('.qmod').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === screen)
  );
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === `screen-${screen}`)
  );

  if (screen === 'estoque') renderEstoque();
  if (screen === 'mestra') atualizarMestraMensal();
}

// ══════════════════════════════════════════════════════
// ABA DE CADASTRO
// ══════════════════════════════════════════════════════
function mudarAba(aba) {
  if (state.abaCadastro === aba) {
    state.abaCadastro = null;
    document.querySelectorAll('.tipo-chip').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.cadastro-pane').forEach(p => p.classList.remove('active'));
    const hint = $('tipoHint');
    if (hint) hint.style.display = '';
    return;
  }

  state.abaCadastro = aba;
  document.querySelectorAll('.tipo-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.aba === aba)
  );
  document.querySelectorAll('.cadastro-pane').forEach(p => p.classList.remove('active'));
  const pane = $(`pane-${aba}`);
  if (pane) pane.classList.add('active');

  const hint = $('tipoHint');
  if (hint) hint.style.display = 'none';

  setTimeout(() => pane?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

// ══════════════════════════════════════════════════════
// CARDS DE ESTOQUE
// ══════════════════════════════════════════════════════
function getFiltrados(filtro) {
  if (!filtro || filtro === 'todos') return state.dashboard;
  if (filtro === 'baixo') return state.dashboard.filter(i => stockLevel(i) === 'critical');
  return state.dashboard.filter(i => i.produto === filtro);
}

function stockLevel(item) {
  const dias = Number(item.duracao_estoque_dias || 0);
  if (dias === 0) return 'critical';
  if (dias < 15)  return 'critical';
  if (dias < 30)  return 'warning';
  return 'ok';
}

function montarCard(item, clickable = false) {
  const nivel = stockLevel(item);
  const dias  = Number(item.duracao_estoque_dias || 0);
  const pct   = Math.min(100, Math.max(0, (dias / 60) * 100));

  const card = document.createElement('div');
  card.className     = 'prod-card';
  card.dataset.level = nivel;
  card.dataset.id    = item.id;

  const campanha  = item.campanha_nome ? `<div class="pcard-campanha">${item.campanha_nome}</div>` : '';
  const tipoLabel = item.produto === 'RASPADINHA' ? 'Raspadinha' : 'Tele Sena';
  const nivelSaldo = item.saldo_atual > 50 ? 'value-good'
                   : item.saldo_atual > 15 ? 'value-warn' : 'value-alert';

  card.innerHTML = `
    <div class="pcard-top">
      <div class="pcard-id">
        <div class="pcard-tipo">${tipoLabel}</div>
        <div class="pcard-nome">${item.item_nome}</div>
        ${campanha}
      </div>
      <div class="pcard-valor">R$ ${fmtBR(item.valor_venda)}</div>
    </div>
    <div class="pcard-stats">
      <div class="pstat">
        <div class="pstat-label">Saldo atual</div>
        <div class="pstat-value ${nivelSaldo}">${item.saldo_atual}</div>
      </div>
      <div class="pstat">
        <div class="pstat-label">Vendidas 7d</div>
        <div class="pstat-value">${item.vendidas_7d}</div>
      </div>
      <div class="pstat">
        <div class="pstat-label">Média / dia</div>
        <div class="pstat-value">${Number(item.media_dia_7d).toFixed(1)}</div>
      </div>
      <div class="pstat">
        <div class="pstat-label">Duração est.</div>
        <div class="pstat-value ${nivel === 'critical' ? 'value-alert' : nivel === 'warning' ? 'value-warn' : ''}">
          ${dias > 0 ? Math.round(dias) + 'd' : '—'}
        </div>
      </div>
    </div>
    <div class="pcard-duration">
      <div class="pcd-label">
        <span class="pcd-label-text">Nível de estoque</span>
        <span class="pcd-label-value">${dias > 0 ? `~${Math.round(dias)} dias` : 'sem dados'}</span>
      </div>
      <div class="pcd-bar-track">
        <div class="pcd-bar-fill" style="width:${pct}%"></div>
      </div>
    </div>
    ${clickable ? `<div class="pcard-click-hint"><i class="fas fa-hand-pointer"></i> Clique para movimentar</div>` : ''}
  `;

  return card;
}

function renderCards() {
  const container = $('cardsCadastro');
  if (!container) return;
  container.innerHTML = '';

  const lista = getFiltrados(state.tipoFiltro);

  if (!lista.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-box-open"></i>
        <span>Nenhum produto para o filtro selecionado.</span>
      </div>`;
  } else {
    lista.forEach(item => {
      const card = montarCard(item, true);
      card.addEventListener('click', () => abrirPanel(item));
      container.appendChild(card);
    });
  }

  atualizarMetricas(lista);
  const badge = $('stockBadge');
  if (badge) badge.textContent = lista.length;
}

function atualizarMetricas(lista) {
  const totalSaldo  = lista.reduce((a, b) => a + Number(b.saldo_atual  || 0), 0);
  const totalVend   = lista.reduce((a, b) => a + Number(b.vendidas_7d  || 0), 0);
  const totalMedia  = lista.reduce((a, b) => a + Number(b.media_dia_7d || 0), 0);
  const duracao     = totalMedia > 0 ? totalSaldo / totalMedia : 0;

  if ($('mSaldoTotal')) $('mSaldoTotal').textContent = totalSaldo;
  if ($('mVendidas7d')) $('mVendidas7d').textContent = totalVend;
  if ($('mMediaDia'))   $('mMediaDia').textContent   = totalMedia.toFixed(1);
  if ($('mDuracao'))    $('mDuracao').textContent     = duracao > 0 ? `~${Math.round(duracao)}d` : '—';
}

// ══════════════════════════════════════════════════════
// PAINEL DESLIZANTE
// ══════════════════════════════════════════════════════
function abrirPanel(item) {
  state.panelItem = item;
  state.tipoMov   = 'ENTRADA';

  const tipoBadge = $('panelTipoBadge');
  if (tipoBadge) tipoBadge.textContent = item.produto === 'RASPADINHA' ? 'Raspadinha' : 'Tele Sena';

  const nome = $('panelNome');
  if (nome) nome.textContent = item.item_nome;

  const sub = $('panelSub');
  if (sub) {
    sub.textContent = item.campanha_nome
      ? `${item.campanha_nome} · R$ ${fmtBR(item.valor_venda)}`
      : `R$ ${fmtBR(item.valor_venda)}`;
  }

  atualizarSaldoPanel(item.saldo_atual, item.saldo_atual);
  setTipoToggle('ENTRADA');

  const inp = $('panelQtd');
  if (inp) { inp.value = ''; inp.focus?.(); }
  const obs = $('panelObs');
  if (obs) obs.value = '';

  esconderStatusPanel();

  document.querySelectorAll('.prod-card').forEach(c =>
    c.classList.toggle('active', c.dataset.id === item.id)
  );

  $('movPanel').classList.add('active');
  $('panelBackdrop').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function fecharPanel() {
  $('movPanel').classList.remove('active');
  $('panelBackdrop').classList.remove('active');
  document.body.style.overflow = '';
  document.querySelectorAll('.prod-card').forEach(c => c.classList.remove('active'));
  state.panelItem = null;
}

function atualizarSaldoPanel(saldoAtual, saldoPrev) {
  if ($('panelSaldoAtual')) $('panelSaldoAtual').textContent = saldoAtual;
  if ($('prevAtual'))       $('prevAtual').textContent       = saldoAtual;

  const prevEl = $('panelSaldoPrev');
  if (prevEl) {
    prevEl.textContent  = saldoPrev;
    prevEl.style.color  = saldoPrev > saldoAtual ? 'var(--t1)'
                        : saldoPrev < saldoAtual ? '#f87171' : '';
  }

  const max = Math.max(saldoAtual, 200);
  const bar = $('panelSaldoBar');
  if (bar) bar.style.width = Math.min(100, Math.max(0, (saldoAtual / max) * 100)) + '%';

  const arrow = $('prevArrowIcon');
  if (arrow) {
    arrow.className = saldoPrev > saldoAtual ? 'fas fa-arrow-up'
                    : saldoPrev < saldoAtual ? 'fas fa-arrow-down' : 'fas fa-arrow-right';
  }
}

function calcularPrevisto() {
  if (!state.panelItem) return;
  const qtd   = Number($('panelQtd')?.value || 0);
  const saldo = Number(state.panelItem.saldo_atual);
  atualizarSaldoPanel(saldo, state.tipoMov === 'ENTRADA' ? saldo + qtd : saldo - qtd);
}

function setTipoToggle(tipo) {
  state.tipoMov = tipo;
  document.querySelectorAll('.tipo-toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tipo === tipo)
  );
}

async function aplicarMovimentacaoRapida() {
  const item = state.panelItem;
  if (!item) return;

  const qtdInput = Number($('panelQtd')?.value || 0);
  if (!qtdInput || qtdInput <= 0) {
    showStatusPanel('Informe uma quantidade válida.', 'err');
    return;
  }

  const saldoAtual = Number(item.saldo_atual || 0);

  if (state.tipoMov === 'REDUCAO' && qtdInput > saldoAtual) {
    showStatusPanel('Quantidade maior que o saldo disponível.', 'err');
    return;
  }

  if (!sb) {
    showStatusPanel('Supabase não disponível.', 'err');
    return;
  }

  const obs = $('panelObs')?.value?.trim() || null;

  // Entrada = positivo | Redução = negativo
  const qtdLancamento = state.tipoMov === 'ENTRADA' ? qtdInput : -qtdInput;
  const novoSaldo = saldoAtual + qtdLancamento;

  const payload = {
    loteria_id:       state.lojaAtiva.id,
    produto:          item.produto,
    raspadinha_id:    item.produto === 'RASPADINHA' ? item.raspadinha_id : null,
    telesena_item_id: item.produto === 'TELESENA' ? item.telesena_item_id : null,
    qtd:              qtdLancamento,
    data_referencia:  new Date().toISOString().slice(0, 10),
    observacao:       obs,
    usuario_id:       state.usuario?.id || null,
  };

  try {
    showStatusPanel('Salvando...', 'info');

    const { error } = await sb
      .from('produtos_entradas')
      .insert(payload);

    if (error) throw error;

    // Histórico local apenas visual
    state.movHistorico.unshift({
      tipo: state.tipoMov,
      nome: item.item_nome,
      qtd: qtdInput,
      novoSaldo,
      obs: obs || '',
      hora: new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      }),
    });

    renderMovHistorico();

    // Recarrega saldo real vindo do servidor/view
    await carregarDashboard();
    renderCards();
    renderEstoque();
    renderMestra();
    renderMovSelects?.();

    // Atualiza painel com o valor recarregado do servidor
    const itemAtualizado = state.dashboard.find(x => x.id === item.id);
    if (itemAtualizado) {
      state.panelItem = itemAtualizado;
      atualizarSaldoPanel(
        Number(itemAtualizado.saldo_atual || 0),
        Number(itemAtualizado.saldo_atual || 0)
      );
    }

    showStatusPanel(
      `✓ ${state.tipoMov === 'ENTRADA' ? 'Entrada' : 'Redução'} registrada com sucesso.`,
      'ok'
    );

    if ($('panelQtd')) $('panelQtd').value = '';
    if ($('panelObs')) $('panelObs').value = '';

    setTimeout(() => {
      fecharPanel();
      esconderStatusPanel();
    }, 1200);

  } catch (err) {
    console.error('[SISLOT] Erro ao registrar movimentação rápida:', err);
    showStatusPanel(
      err?.message || 'Erro ao salvar movimentação.',
      'err'
    );
  }
}

function showStatusPanel(msg, tipo) {
  const st  = $('statusPanel');
  const mel = $('statusPanelMsg');
  if (!st || !mel) return;
  mel.textContent = msg;
  st.className    = `status ${tipo}`;
  st.style.display = 'flex';
}

function esconderStatusPanel() {
  const st = $('statusPanel');
  if (st) st.style.display = 'none';
}

// ══════════════════════════════════════════════════════
// MOVIMENTAÇÃO ENTRE LOJAS (Tela 2)
// ══════════════════════════════════════════════════════
function renderMovSelects() {
  const origem  = $('movOrigem');
  const destino = $('movDestino');
  const produto = $('movProduto');
  if (!origem || !destino || !produto) return;

  origem.innerHTML  = '';
  destino.innerHTML = '';
  produto.innerHTML = '<option value="">Selecione…</option>';

  const lojas = state.lojasAtivas || [];

  lojas.forEach(loja => {
    origem.add(new Option(loja.nome, loja.id));
    destino.add(new Option(loja.nome, loja.id));
  });

  origem.value = String(state.lojaAtiva.id);
  destino.value = String(
    lojas.find(loja => Number(loja.id) !== Number(state.lojaAtiva.id))?.id || ''
  );

  state.dashboard.forEach(item => {
    const label = item.campanha_nome
      ? `${item.campanha_nome} — ${item.item_nome}`
      : item.item_nome;
    produto.add(new Option(label, item.id));
  });

  renderMovRouteVisual();
}

function renderMovRouteVisual() {
  const origemId  = Number($('movOrigem')?.value);
  const destinoId = Number($('movDestino')?.value);

  const lojas = state.lojasAtivas || [];

  if ($('movNomeOrigem')) {
    $('movNomeOrigem').textContent = lojas.find(loja => loja.id === origemId)?.nome || '—';
  }
  if ($('movNomeDestino')) {
    $('movNomeDestino').textContent = lojas.find(loja => loja.id === destinoId)?.nome || '—';
  }

  const qty  = Number($('movQtd')?.value || 0);
  const rQty = $('movRouteQty');
  if (rQty) rQty.textContent = qty > 0 ? `${qty} un.` : '—';
}

function renderMovHistorico() {
  const list = $('movHistoryList');
  if (!list) return;
  list.innerHTML = '';

  if (!state.movHistorico.length) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exchange-alt"></i>
        <span>Nenhuma movimentação registrada ainda.</span>
      </div>`;
    return;
  }

  state.movHistorico.slice(0, 8).forEach(entry => {
    const el = document.createElement('div');
    el.className = 'mov-history-item';
    el.innerHTML = `
      <span class="mhi-badge ${entry.tipo === 'ENTRADA' ? 'entrada' : 'reducao'}">${entry.tipo}</span>
      <div class="mhi-info">
        <div class="mhi-nome">${entry.nome}</div>
        <div class="mhi-rota">${entry.hora}${entry.obs ? ' · ' + entry.obs : ''}</div>
      </div>
      <div class="mhi-qtd">${entry.tipo === 'ENTRADA' ? '+' : '-'}${entry.qtd}</div>
    `;
    list.appendChild(el);
  });
}

async function salvarMovimentacao() {
  try {
    const origemId      = Number($('movOrigem')?.value);
    const destinoId     = Number($('movDestino')?.value);
    const produtoKey    = $('movProduto')?.value || '';
    const qtd           = Number($('movQtd')?.value || 0);
    const custoInf      = Number($('movCusto')?.value || 0);
    const obs           = $('movObs')?.value?.trim() || '';

    if (!origemId || !destinoId || !produtoKey) {
      setStatus('statusMov', 'Preencha todos os campos obrigatórios.', 'err'); return;
    }
    if (origemId === destinoId) {
      setStatus('statusMov', 'Origem e destino não podem ser iguais.', 'err'); return;
    }
    if (qtd <= 0) {
      setStatus('statusMov', 'Informe uma quantidade válida.', 'err'); return;
    }

    const prod = state.dashboard.find(x => x.id === produtoKey);
    if (!prod) { setStatus('statusMov', 'Produto não encontrado.', 'err'); return; }

    const saldoAtual = Number(prod.saldo_atual || 0);
    if (qtd > saldoAtual) {
      setStatus('statusMov', `Saldo insuficiente. Disponível: ${saldoAtual}`, 'err'); return;
    }

    const valorUnit  = custoInf > 0 ? custoInf : Number(prod.valor_custo || 0);
    const valorTotal = Number((qtd * valorUnit).toFixed(2));

    // Atualiza local imediatamente
    const idx = state.dashboard.findIndex(x => x.id === produtoKey);
    if (idx >= 0) state.dashboard[idx].saldo_atual = Math.max(0, saldoAtual - qtd);

    if (!sb) {
      setStatus('statusMov', 'Supabase não disponível — movimentação aplicada localmente.', 'info');
      renderCards(); renderMovSelects(); renderEstoque(); renderMestra();
      return;
    }

    const payload = {
      loteria_origem_id:  origemId,
      loteria_destino_id: destinoId,
      produto:            prod.produto,
      raspadinha_id:      prod.produto === 'RASPADINHA' ? prod.raspadinha_id    : null,
      telesena_item_id:   prod.produto === 'TELESENA'   ? prod.telesena_item_id : null,
      qtd,
      valor_custo_unit:   valorUnit,
      valor_total:        valorTotal,
      data_referencia:    new Date().toISOString().slice(0, 10),
      observacao:         obs || null,
      usuario_id:         state.usuario?.id || null,
    };

    const { error } = await sb.from('produtos_movimentacoes').insert(payload);
    if (error) throw error;

    // Recarrega para refletir saldo real do servidor
    await carregarDashboard();

    setStatus('statusMov', '✓ Movimentação salva com sucesso.', 'ok');
    ['movQtd','movCusto','movObs'].forEach(id => { const el = $(id); if (el) el.value = ''; });

    renderCards(); renderMovSelects(); renderEstoque(); renderMestra();
  } catch (e) {
    console.error('[SISLOT] Erro ao salvar movimentação:', e);
    setStatus('statusMov', `Erro: ${e.message || e}`, 'err');
  }
}

function bindMovProdutoCusto() {
  const sel = $('movProduto');
  if (!sel) return;
  sel.addEventListener('change', () => {
    const prod    = state.dashboard.find(x => x.id === sel.value);
    const inpCusto = $('movCusto');
    if (prod && inpCusto) inpCusto.value = Number(prod.valor_custo || 0).toFixed(2);
  });
}

function setStatusMov(msg, tipo) {
  const el = $('statusMov');
  if (!el) return;
  el.className = `status ${tipo}`;
  el.innerHTML = `<i class="fas fa-${tipo === 'ok' ? 'check-circle' : tipo === 'err' ? 'exclamation-circle' : 'info-circle'}"></i><span>${msg}</span>`;
}

// ══════════════════════════════════════════════════════
// TELA 3 — ESTOQUE
// ══════════════════════════════════════════════════════
function renderEstoque() {
  const container   = $('cardsEstoque');
  const searchVal   = $('estoqueSearch')?.value?.toLowerCase() || '';
  const filtroAtivo = document.querySelector('#screen-estoque .filter-chip.active')?.dataset.filter || 'todos';

  if (!container) return;
  container.innerHTML = '';

  let lista = getFiltrados(filtroAtivo);
  if (searchVal) {
    lista = lista.filter(i =>
      i.item_nome.toLowerCase().includes(searchVal) ||
      (i.campanha_nome || '').toLowerCase().includes(searchVal)
    );
  }

  if (!lista.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-search"></i>
        <span>Nenhum produto encontrado.</span>
      </div>`;
  } else {
    lista.forEach(item => container.appendChild(montarCard(item, false)));
  }

  const criticos = lista.filter(i => stockLevel(i) === 'critical').length;

  if ($('esItens'))    $('esItens').textContent    = lista.length;
  if ($('esSaldo'))    $('esSaldo').textContent    = lista.reduce((a, b) => a + Number(b.saldo_atual || 0), 0);
  if ($('esVendas'))   $('esVendas').textContent   = lista.reduce((a, b) => a + Number(b.vendidas_7d || 0), 0);
  if ($('esCriticos')) $('esCriticos').textContent = criticos;

  const alertItem = $('esAlertItem');
  if (alertItem) alertItem.style.opacity = criticos > 0 ? '1' : '.4';
}

// ══════════════════════════════════════════════════════
// TELA 4 — MESTRA POR MÊS DE REFERÊNCIA
// ══════════════════════════════════════════════════════
const MESES_PT_BR = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function hojeSaoPaulo() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const valor = Object.fromEntries(partes.map(p => [p.type, p.value]));
  return {
    ano: Number(valor.year),
    mes: Number(valor.month),
    dia: Number(valor.day)
  };
}

function competenciaISO(ano, mes) {
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

function prepararFiltroMestraMensal() {
  const select = $('mestraPeriodo');
  if (!select) return;

  const atual = hojeSaoPaulo();
  const inicioAno = 2026;
  const inicioMes = 1;
  const valorAnterior = select.value;

  select.innerHTML = '';

  for (let ano = atual.ano; ano >= inicioAno; ano--) {
    const mesInicial = ano === atual.ano ? atual.mes : 12;
    const mesFinal = ano === inicioAno ? inicioMes : 1;

    for (let mes = mesInicial; mes >= mesFinal; mes--) {
      const valor = competenciaISO(ano, mes);
      select.add(new Option(`${MESES_PT_BR[mes - 1]}/${ano}`, valor));
    }
  }

  const competenciaAtual = competenciaISO(atual.ano, atual.mes);
  select.value = [...select.options].some(op => op.value === valorAnterior)
    ? valorAnterior
    : competenciaAtual;

  const label = select.closest('.field')?.querySelector('label');
  if (label) {
    label.innerHTML = '<i class="fas fa-calendar-alt"></i> Mês de referência';
  }
}

async function carregarMestraMensal() {
  if (!['ADMIN','SOCIO'].includes(state.roleUsuario)) return;
  if (!sb || !state.lojaAtiva?.id) {
    state.mestra = [];
    return;
  }

  const mesReferencia = $('mestraPeriodo')?.value;
  if (!mesReferencia) {
    state.mestra = [];
    return;
  }

  state.mestraCarregando = true;

  try {
    const { data, error } = await sb
      .from('view_produtos_mestra_mensal')
      .select('*')
      .eq('loteria_id', state.lojaAtiva.id)
      .eq('mes_referencia', mesReferencia)
      .order('produto', { ascending: true })
      .order('item_nome', { ascending: true });

    if (error) throw error;

    state.mestra = (data || []).map(item => ({
      loteria_id:          Number(item.loteria_id || 0),
      loja_origem:         item.loja_origem || state.lojaAtiva.nome,
      mes_referencia:      item.mes_referencia,
      produto:             item.produto,
      campanha_nome:       item.campanha_nome || null,
      item_nome:           item.item_nome || 'Produto',
      qtd_vendida:         Number(item.qtd_vendida || 0),
      faturamento_bruto:   Number(item.faturamento_bruto || 0),
      desconto_total:      Number(item.desconto_total || 0),
      faturamento_liquido: Number(item.faturamento_liquido || 0),
      custo_total:         Number(item.custo_total || 0),
      lucro_total:         Number(item.lucro_total || 0),
    }));
  } catch (e) {
    console.error('[SISLOT] Erro ao carregar Mestra mensal:', e);
    state.mestra = [];

    const tbody = $('mestraTbody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;color:var(--error,#f87171);padding:24px">
            Erro ao carregar a Mestra: ${e.message || e}
          </td>
        </tr>`;
    }
  } finally {
    state.mestraCarregando = false;
  }
}

async function atualizarMestraMensal() {
  if (!['ADMIN','SOCIO'].includes(state.roleUsuario)) return;
  await carregarMestraMensal();
  renderMestra();
}

function renderMestra() {
  if (!['ADMIN','SOCIO'].includes(state.roleUsuario)) return;

  const tipo = $('mestraTipo')?.value || '';
  const lista = (state.mestra || []).filter(item => !tipo || item.produto === tipo);

  const totalVend      = lista.reduce((a, b) => a + Number(b.qtd_vendida || 0), 0);
  const totalFatBruto  = lista.reduce((a, b) => a + Number(b.faturamento_bruto || 0), 0);
  const totalDesconto  = lista.reduce((a, b) => a + Number(b.desconto_total || 0), 0);
  const totalFat       = lista.reduce((a, b) => a + Number(b.faturamento_liquido || 0), 0);
  const totalCusto     = lista.reduce((a, b) => a + Number(b.custo_total || 0), 0);
  const totalLucro     = lista.reduce((a, b) => a + Number(b.lucro_total || 0), 0);
  const margem         = totalFat > 0 ? (totalLucro / totalFat * 100) : 0;

  if ($('kpiVendas')) $('kpiVendas').textContent = totalVend;
  if ($('kpiFat')) {
    $('kpiFat').textContent = fmtBRL(totalFat);
    $('kpiFat').title = `Bruto: ${fmtBRL(totalFatBruto)} · Descontos: ${fmtBRL(totalDesconto)}`;
  }
  if ($('kpiCusto'))  $('kpiCusto').textContent  = fmtBRL(totalCusto);
  if ($('kpiLucro'))  $('kpiLucro').textContent  = fmtBRL(totalLucro);
  if ($('kpiMargem')) $('kpiMargem').textContent = margem.toFixed(1) + '%';

  const tbody = $('mestraTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (state.mestraCarregando) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:24px">
          <i class="fas fa-circle-notch fa-spin"></i> Carregando…
        </td>
      </tr>`;
    return;
  }

  if (!lista.length) {
    const mesLabel = $('mestraPeriodo')?.selectedOptions?.[0]?.textContent || 'mês selecionado';
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:24px;color:var(--text2)">
          Nenhuma venda encontrada em ${mesLabel} para ${state.lojaAtiva?.nome || 'a loja'}.
        </td>
      </tr>`;
    return;
  }

  lista.forEach(item => {
    const fat   = Number(item.faturamento_liquido || 0);
    const custo = Number(item.custo_total || 0);
    const lucro = Number(item.lucro_total || 0);
    const marg  = fat > 0 ? (lucro / fat * 100) : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="td-badge ${item.produto === 'RASPADINHA' ? 'rasp' : 'tele'}">
          ${item.produto === 'RASPADINHA' ? 'Rasp.' : 'Tele Sena'}
        </span>
      </td>
      <td class="td-produto">
        ${item.campanha_nome ? `<span style="color:var(--text2);font-size:11px">${item.campanha_nome} · </span>` : ''}
        ${item.item_nome}
      </td>
      <td class="num">${item.qtd_vendida}</td>
      <td class="num" title="Bruto: ${fmtBRL(item.faturamento_bruto)} · Desconto: ${fmtBRL(item.desconto_total)}">${fmtBRL(fat)}</td>
      <td class="num">${fmtBRL(custo)}</td>
      <td class="num ${lucro >= 0 ? 'td-lucro-pos' : 'td-lucro-neg'}">${fmtBRL(lucro)}</td>
      <td class="num">${marg.toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

// ══════════════════════════════════════════════════════
// CADASTRO — RASPADINHA
// ══════════════════════════════════════════════════════
async function salvarRaspadinha() {
  try {
    const nome      = $('raspNome')?.value?.trim();
    const valorVend = Number($('raspValorVenda')?.value || 0);
    const ordem     = Number($('raspOrdem')?.value || 0);

    if (!nome)        { setStatus('statusRasp', 'Informe o nome.',           'err'); $('raspNome')?.focus();      return; }
    if (valorVend <= 0) { setStatus('statusRasp', 'Informe o valor de venda.', 'err'); $('raspValorVenda')?.focus(); return; }

    // Custo automático — Raspadinha lucro 20%
    const valorCusto = calcularCusto('RASPADINHA', valorVend);
    const inpCusto   = $('raspValorCusto');
    if (inpCusto) inpCusto.value = valorCusto.toFixed(2);

    if (!sb) { setStatus('statusRasp', 'Supabase não disponível.', 'err'); return; }

    const { data, error } = await sb
      .from('raspadinhas')
      .insert({ nome, valor_venda: valorVend, valor_custo: valorCusto, margem_percentual: 20, ordem, ativo: true })
      .select().single();

    if (error) throw error;

    setStatus('statusRasp', `✓ Raspadinha "${data.nome}" salva.`, 'ok');
    limparFormRasp();
    await carregarDashboard();
    renderCards(); renderEstoque(); renderMestra();
  } catch (e) {
    setStatus('statusRasp', `Erro: ${e.message || e}`, 'err');
    console.error('[SISLOT] Erro ao salvar raspadinha:', e);
  }
}

function limparFormRasp() {
  ['raspNome','raspValorVenda','raspValorCusto','raspOrdem'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
}

// ══════════════════════════════════════════════════════
// CADASTRO — TELE SENA
// ══════════════════════════════════════════════════════
async function salvarTeleSena() {
  try {
    const campanhaNome = $('teleCampanha')?.value?.trim();
    const itemNome     = $('teleItem')?.value?.trim();
    const dataInicio   = $('teleDataInicio')?.value || null;
    const dataFim      = $('teleDataFim')?.value    || null;
    const valorVenda   = Number($('teleValorVenda')?.value || 0);

    if (!campanhaNome) { setStatus('statusTele', 'Informe a campanha.', 'err'); $('teleCampanha')?.focus(); return; }
    if (!itemNome)     { setStatus('statusTele', 'Informe o item.',     'err'); $('teleItem')?.focus();     return; }
    if (!dataInicio || !dataFim) { setStatus('statusTele', 'Informe as datas.', 'err'); return; }
    if (valorVenda <= 0) { setStatus('statusTele', 'Informe o valor de venda.', 'err'); $('teleValorVenda')?.focus(); return; }

    // Custo automático — Tele Sena lucro 8%
    const valorCusto = calcularCusto('TELESENA', valorVenda);
    const inpCusto   = $('teleValorCusto');
    if (inpCusto) inpCusto.value = valorCusto.toFixed(2);

    if (!sb) { setStatus('statusTele', 'Supabase não disponível.', 'err'); return; }

    // Busca ou cria campanha
    let campanhaId = null;
    const { data: campExist, error: campBuscaErr } = await sb
      .from('telesena_campanhas').select('id').eq('nome', campanhaNome).maybeSingle();
    if (campBuscaErr) throw campBuscaErr;

    if (campExist?.id) {
      campanhaId = campExist.id;
    } else {
      const { data: campNova, error: campInsErr } = await sb
        .from('telesena_campanhas')
        .insert({ nome: campanhaNome, data_inicio: dataInicio, data_fim: dataFim, ativo: true, ordem: 0 })
        .select().single();
      if (campInsErr) throw campInsErr;
      campanhaId = campNova.id;
    }

    const { data: itemNovo, error: itemErr } = await sb
      .from('telesena_itens')
      .insert({ campanha_id: campanhaId, nome: itemNome, valor_venda: valorVenda, valor_custo: valorCusto, ativo: true, ordem: 0 })
      .select().single();
    if (itemErr) throw itemErr;

    setStatus('statusTele', `✓ Item "${itemNovo.nome}" salvo em "${campanhaNome}".`, 'ok');
    limparFormTele();
    await carregarDashboard();
    renderCards(); renderEstoque(); renderMestra();
  } catch (e) {
    setStatus('statusTele', `Erro: ${e.message || e}`, 'err');
    console.error('[SISLOT] Erro ao salvar Tele Sena:', e);
  }
}

function limparFormTele() {
  ['teleCampanha','teleItem','teleDataInicio','teleDataFim','teleValorVenda','teleValorCusto'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  preencherData();
}

// ══════════════════════════════════════════════════════
// INATIVAR
// ══════════════════════════════════════════════════════
async function inativarRaspadinhaSelecionada() {
  try {
    const nome = $('raspNome')?.value?.trim();
    if (!nome) { setStatus('statusRasp', 'Informe o nome para inativar.', 'err'); return; }
    if (!sb)   { setStatus('statusRasp', 'Supabase não disponível.', 'err');      return; }

    const { error } = await sb.from('raspadinhas').update({ ativo: false }).eq('nome', nome);
    if (error) throw error;

    setStatus('statusRasp', `✓ Raspadinha "${nome}" inativada.`, 'ok');
    await carregarDashboard();
    renderCards(); renderEstoque(); renderMestra();
  } catch (e) {
    setStatus('statusRasp', `Erro: ${e.message || e}`, 'err');
    console.error('[SISLOT] Erro ao inativar raspadinha:', e);
  }
}

async function inativarTeleSenaSelecionada() {
  try {
    const campanhaNome = $('teleCampanha')?.value?.trim();
    const itemNome     = $('teleItem')?.value?.trim();

    if (!campanhaNome) { setStatus('statusTele', 'Informe a campanha para inativar.', 'err'); return; }
    if (!sb)           { setStatus('statusTele', 'Supabase não disponível.', 'err');          return; }

    if (itemNome) {
      const { data: camp, error: campErr } = await sb
        .from('telesena_campanhas').select('id').eq('nome', campanhaNome).maybeSingle();
      if (campErr) throw campErr;
      if (!camp?.id) throw new Error('Campanha não encontrada.');

      const { data: itm, error: itmErr } = await sb
        .from('telesena_itens').select('id').eq('campanha_id', camp.id).eq('nome', itemNome).maybeSingle();
      if (itmErr) throw itmErr;
      if (!itm?.id) throw new Error('Item não encontrado.');

      const { error: updErr } = await sb.from('telesena_itens').update({ ativo: false }).eq('id', itm.id);
      if (updErr) throw updErr;
      setStatus('statusTele', `✓ Item "${itemNome}" inativado.`, 'ok');
    } else {
      const { error: updErr } = await sb.from('telesena_campanhas').update({ ativo: false }).eq('nome', campanhaNome);
      if (updErr) throw updErr;
      setStatus('statusTele', `✓ Campanha "${campanhaNome}" inativada.`, 'ok');
    }

    await carregarDashboard();
    renderCards(); renderEstoque(); renderMestra();
  } catch (e) {
    setStatus('statusTele', `Erro: ${e.message || e}`, 'err');
    console.error('[SISLOT] Erro ao inativar Tele Sena:', e);
  }
}

// ══════════════════════════════════════════════════════
// UTILITÁRIOS
// ══════════════════════════════════════════════════════
function setStatus(elId, msg, tipo) {
  const el = $(elId);
  if (!el) return;
  el.className = `status ${tipo}`;
  const icon = tipo === 'ok' ? 'check-circle' : tipo === 'err' ? 'exclamation-circle' : 'info-circle';
  el.innerHTML = `<i class="fas fa-${icon}"></i><span>${msg}</span>`;
}

function preencherData() {
  const agora   = new Date();
  const dataBr  = agora.toLocaleDateString('pt-BR');
  const dataIso = agora.toISOString().slice(0, 10);

  const pill = $('pillData');
  if (pill) pill.textContent = dataBr;

  const ini = $('teleDataInicio');
  const fim = $('teleDataFim');
  if (ini && !ini.value) ini.value = dataIso;
  if (fim && !fim.value) fim.value = dataIso;
}

// ══════════════════════════════════════════════════════
// BIND DE EVENTOS
// ══════════════════════════════════════════════════════
function bind() {
  bindMovProdutoCusto();

  // Quickbar
  document.querySelectorAll('.qmod').forEach(btn =>
    btn.addEventListener('click', () => mudarScreen(btn.dataset.screen))
  );

  // Tipo chips cadastro
  document.querySelectorAll('.tipo-chip').forEach(btn =>
    btn.addEventListener('click', () => mudarAba(btn.dataset.aba))
  );
  document.querySelectorAll('.pane-close').forEach(btn =>
    btn.addEventListener('click', () => mudarAba(btn.dataset.aba))
  );

  // ── Troca de loja por clique direto — SEM MODAL ──
  const lojaTree = $('lojaTreeWrap');
  if (lojaTree) lojaTree.addEventListener('click', alternarLoja);

  // Panel movimentação rápida
  $('btnFecharPanel')?.addEventListener('click', fecharPanel);
  $('panelBackdrop')?.addEventListener('click', fecharPanel);
  $('btnAplicarPanel')?.addEventListener('click', aplicarMovimentacaoRapida);

  document.querySelectorAll('.tipo-toggle-btn').forEach(btn =>
    btn.addEventListener('click', () => { setTipoToggle(btn.dataset.tipo); calcularPrevisto(); })
  );

  $('panelQtdMinus')?.addEventListener('click', () => {
    const inp = $('panelQtd');
    if (inp) { inp.value = Math.max(0, Number(inp.value) - 1); calcularPrevisto(); }
  });
  $('panelQtdPlus')?.addEventListener('click', () => {
    const inp = $('panelQtd');
    if (inp) { inp.value = Number(inp.value) + 1; calcularPrevisto(); }
  });
  $('panelQtd')?.addEventListener('input', calcularPrevisto);

  // Movimentação entre lojas
  $('movQtdMinus')?.addEventListener('click', () => {
    const inp = $('movQtd');
    if (inp) { inp.value = Math.max(0, Number(inp.value) - 1); renderMovRouteVisual(); }
  });
  $('movQtdPlus')?.addEventListener('click', () => {
    const inp = $('movQtd');
    if (inp) { inp.value = Number(inp.value) + 1; renderMovRouteVisual(); }
  });
  $('movQtd')?.addEventListener('input',    renderMovRouteVisual);
  $('movOrigem')?.addEventListener('change', renderMovRouteVisual);
  $('movDestino')?.addEventListener('change', renderMovRouteVisual);

  $('btnSalvarMov')?.addEventListener('click', salvarMovimentacao);
  $('btnLimparMov')?.addEventListener('click', () => {
    ['movQtd','movCusto','movObs'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    renderMovRouteVisual();
    setStatusMov('Campos limpos.', 'muted');
  });

  // Custo automático — Raspadinha (20% lucro)
  $('raspValorVenda')?.addEventListener('input', () => {
    const v = Number($('raspValorVenda').value || 0);
    const c = $('raspValorCusto');
    if (c) c.value = v > 0 ? calcularCusto('RASPADINHA', v).toFixed(2) : '';
  });

  // Custo automático — Tele Sena (8% lucro)
  $('teleValorVenda')?.addEventListener('input', () => {
    const v = Number($('teleValorVenda').value || 0);
    const c = $('teleValorCusto');
    if (c) c.value = v > 0 ? calcularCusto('TELESENA', v).toFixed(2) : '';
  });

  $('btnSalvarRasp')?.addEventListener('click',   salvarRaspadinha);
  $('btnInativarRasp')?.addEventListener('click', inativarRaspadinhaSelecionada);
  $('btnSalvarTele')?.addEventListener('click',   salvarTeleSena);
  $('btnInativarTele')?.addEventListener('click', inativarTeleSenaSelecionada);

  // Filtros tela 1
  document.querySelectorAll('#stockFilterChips .filter-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#stockFilterChips .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.tipoFiltro = btn.dataset.filter;
      renderCards();
    })
  );

  // Filtros tela 3
  document.querySelectorAll('#estoqueFilterChips .filter-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#estoqueFilterChips .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEstoque();
    })
  );

  $('estoqueSearch')?.addEventListener('input', renderEstoque);
  $('mestraPeriodo')?.addEventListener('change', atualizarMestraMensal);
  $('mestraTipo')?.addEventListener('change',    renderMestra);

  $('btnInicio')?.addEventListener('click', () => window.SISLOT_SECURITY?.irParaInicio?.());
  $('btnSair')?.addEventListener('click', async () => await window.SISLOT_SECURITY?.sair?.());
}
})();
