/**
 * SISLOT — Produto
 * Cadastro · Movimentação · Estoque · Mestra
 * Segue o padrão de bolao-cadastro.js e movimentar.js
 */

const sb = window.supabase && window.SISLOT_CONFIG
  ? supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey)
  : null;

const utils = window.SISLOT_UTILS || {};
const $     = utils.$     || (id => document.getElementById(id));
const fmtBR = utils.fmtBR || (v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
const fmtBRL= utils.fmtBRL|| (v => parseFloat(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

// ── Lojas do sistema ─────────────────────────────────
const LOJAS = [
  { id: 1, nome: 'Centro',       slug: 'centro',       logo: './icons/loterpraca.png',   icon: 'fas fa-city'    },
  { id: 2, nome: 'Boulevard',    slug: 'boulevard',    logo: './icons/boulevard.png',    icon: 'fas fa-building'},
  { id: 3, nome: 'Lotobel',      slug: 'lotobel',      logo: './icons/lotobel.png',      icon: 'fas fa-landmark'},
  { id: 4, nome: 'Santa Tereza', slug: 'santa-tereza', logo: './icons/santa-tereza.png', icon: 'fas fa-church'  },
  { id: 5, nome: 'Via Brasil',   slug: 'via-brasil',   logo: './icons/via-brasil.png',   icon: 'fas fa-road'    },
];

const LOJA_CONFIG = {
  'centro':       { nome: 'Centro',       logo: './icons/loterpraca.png'   },
  'boulevard':    { nome: 'Boulevard',    logo: './icons/boulevard.png'    },
  'lotobel':      { nome: 'Lotobel',      logo: './icons/lotobel.png'      },
  'santa-tereza': { nome: 'Santa Tereza', logo: './icons/santa-tereza.png' },
  'via-brasil':   { nome: 'Via Brasil',   logo: './icons/via-brasil.png'   },
};

// ── Estado global ────────────────────────────────────
const state = {
  screen:       'cadastro',
  abaCadastro:  null,         // null = somente cards; 'raspadinha' | 'telesena'
  lojaAtiva:    LOJAS[0],
  tipoFiltro:   'todos',
  panelItem:    null,
  tipoMov:      'ENTRADA',
  usuario:      null,
  roleUsuario:  'ADMIN',      // será sobrescrito por sislot-security
  movHistorico: [],

  // Dados mock — substituir por queries Supabase
  dashboard: [
    { id:1, produto:'RASPADINHA', item_nome:'Jogo da Velha',       campanha_nome:null,         saldo_atual:120, vendidas_7d:18, media_dia_7d:2.57, duracao_estoque_dias:46.7, valor_venda:2.50 },
    { id:2, produto:'RASPADINHA', item_nome:'Trio da Sorte',        campanha_nome:null,         saldo_atual:80,  vendidas_7d:10, media_dia_7d:1.43, duracao_estoque_dias:55.9, valor_venda:2.50 },
    { id:3, produto:'RASPADINHA', item_nome:'Roda da Sorte',        campanha_nome:null,         saldo_atual:12,  vendidas_7d:8,  media_dia_7d:1.14, duracao_estoque_dias:10.5, valor_venda:5.00 },
    { id:4, produto:'RASPADINHA', item_nome:'Horóscopo da Sorte',   campanha_nome:null,         saldo_atual:3,   vendidas_7d:5,  media_dia_7d:0.71, duracao_estoque_dias:4.2,  valor_venda:10.00},
    { id:5, produto:'RASPADINHA', item_nome:'Chute Certo',          campanha_nome:null,         saldo_atual:50,  vendidas_7d:4,  media_dia_7d:0.57, duracao_estoque_dias:87.7, valor_venda:20.00},
    { id:6, produto:'TELESENA',   item_nome:'Completa',            campanha_nome:'Mães 2026',  saldo_atual:50,  vendidas_7d:14, media_dia_7d:2.00, duracao_estoque_dias:25.0, valor_venda:12.00},
    { id:7, produto:'TELESENA',   item_nome:'Meia',                campanha_nome:'Mães 2026',  saldo_atual:30,  vendidas_7d:8,  media_dia_7d:1.14, duracao_estoque_dias:26.3, valor_venda:6.00 },
  ]
};

// ══════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    if (window.SISLOT_SECURITY) {
      const ctx = await window.SISLOT_SECURITY.protegerPagina?.('produto');
      if (ctx) {
        state.usuario = ctx.usuario;
        state.roleUsuario = ctx.usuario?.perfil || ctx.usuario?.role || 'OPERADOR';

        const principal = ctx.lojaInicial || null;
        if (principal) {
          const loja = LOJAS.find(l => l.slug === principal.loteria_slug);
          if (loja) state.lojaAtiva = loja;
        }
      }
    }

    bind();
    await carregarDashboard();
    aplicarTema(state.lojaAtiva.slug);
    renderScreenTabs();
    renderCards();
    renderMovSelects();
    renderEstoque();
    renderMestra();
    preencherData();
  } catch (e) {
    console.error('Erro ao iniciar produto:', e);
    alert('Erro ao iniciar: ' + (e.message || e));
  }
}
// ══════════════════════════════════════════════════════
// TEMA POR LOJA
// ══════════════════════════════════════════════════════
function aplicarTema(slug) {
  document.body.dataset.loja = slug;
  document.documentElement.dataset.loja = slug;

  const cfg  = LOJA_CONFIG[slug] || LOJA_CONFIG['centro'];
  const logo = $('lojaLogo');
  if (logo) { logo.src = cfg.logo || ''; logo.alt = cfg.nome; }

  const nome = $('headerNome');
  if (nome) nome.textContent = cfg.nome;

  // Reflete no estoque e pill
  const estNome = $('estoqueLojaNome');
  if (estNome) estNome.textContent = cfg.nome;

  const movNome = $('movNomeOrigem');
  if (movNome) movNome.textContent = cfg.nome;

  // Atualiza select de origem
  const movOrigem = $('movOrigem');
  if (movOrigem) movOrigem.value = state.lojaAtiva.id;
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
  const podeVerMestra = ['ADMIN','SOCIO'].includes(state.roleUsuario);
  if (screen === 'mestra' && !podeVerMestra) return;

  state.screen = screen;

  document.querySelectorAll('.qmod').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === screen)
  );
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === `screen-${screen}`)
  );

  if (screen === 'estoque')  renderEstoque();
  if (screen === 'mestra')   renderMestra();
}

// ══════════════════════════════════════════════════════
// ABA DE CADASTRO
// ══════════════════════════════════════════════════════
function mudarAba(aba) {
  // Toggle: se já está aberta, fecha
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

  // Rola suavemente até o formulário
  setTimeout(() => pane?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

// ══════════════════════════════════════════════════════
// CARDS DE ESTOQUE (Tela 1 + Tela 3)
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
  card.className = 'prod-card';
  card.dataset.level = nivel;
  card.dataset.id    = item.id;
  card.style.animationDelay = `${(item.id % 9) * 0.04}s`;

  const valorStr  = `R$ ${fmtBR(item.valor_venda)}`;
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
      <div class="pcard-valor">${valorStr}</div>
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

  lista.forEach((item, i) => {
    const card = montarCard(item, true);
    card.addEventListener('click', () => abrirPanel(item));
    container.appendChild(card);
  });

  atualizarMetricas(lista);
  $('stockBadge').textContent = lista.length;
}

function atualizarMetricas(lista) {
  const totalSaldo   = lista.reduce((a, b) => a + Number(b.saldo_atual  || 0), 0);
  const totalVend    = lista.reduce((a, b) => a + Number(b.vendidas_7d  || 0), 0);
  const totalMedia   = lista.reduce((a, b) => a + Number(b.media_dia_7d || 0), 0);
  const duracaoMedia = totalMedia > 0 ? (totalSaldo / totalMedia) : 0;

  if ($('mSaldoTotal')) $('mSaldoTotal').textContent = totalSaldo;
  if ($('mVendidas7d')) $('mVendidas7d').textContent = totalVend;
  if ($('mMediaDia'))   $('mMediaDia').textContent   = totalMedia.toFixed(1);
  if ($('mDuracao'))    $('mDuracao').textContent     = duracaoMedia > 0 ? `~${Math.round(duracaoMedia)}d` : '—';
}

// ══════════════════════════════════════════════════════
// PAINEL DESLIZANTE
// ══════════════════════════════════════════════════════
function abrirPanel(item) {
  state.panelItem = item;
  state.tipoMov   = 'ENTRADA';

  // Popula header
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

  // Saldo
  atualizarSaldoPanel(item.saldo_atual, item.saldo_atual);

  // Toggle
  setTipoToggle('ENTRADA');

  // Limpa campos
  const inp = $('panelQtd');
  if (inp) { inp.value = ''; inp.focus?.(); }
  const obs = $('panelObs');
  if (obs) obs.value = '';

  esconderStatusPanel();

  // Atualiza cards ativos
  document.querySelectorAll('.prod-card').forEach(c =>
    c.classList.toggle('active', Number(c.dataset.id) === item.id)
  );

  // Abre
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
  const saldoEl = $('panelSaldoAtual');
  if (saldoEl) saldoEl.textContent = saldoAtual;

  const prevAtual = $('prevAtual');
  if (prevAtual) prevAtual.textContent = saldoAtual;

  const prevEl = $('panelSaldoPrev');
  if (prevEl) prevEl.textContent = saldoPrev;

  // Barra de nível
  const max = Math.max(saldoAtual, 200);
  const pct = Math.min(100, Math.max(0, (saldoAtual / max) * 100));
  const bar = $('panelSaldoBar');
  if (bar) bar.style.width = pct + '%';

  // Cor do preview
  if (prevEl) {
    prevEl.style.color = saldoPrev > saldoAtual ? 'var(--t1)'
                       : saldoPrev < saldoAtual ? '#f87171' : '';
  }

  // Ícone da seta
  const arrow = $('prevArrowIcon');
  if (arrow) {
    arrow.className = saldoPrev > saldoAtual ? 'fas fa-arrow-up'
                    : saldoPrev < saldoAtual ? 'fas fa-arrow-down' : 'fas fa-arrow-right';
  }
}

function calcularPrevisto() {
  if (!state.panelItem) return;
  const qtd    = Number($('panelQtd')?.value || 0);
  const saldo  = Number(state.panelItem.saldo_atual);
  const final  = state.tipoMov === 'ENTRADA' ? saldo + qtd : saldo - qtd;
  atualizarSaldoPanel(saldo, final);
}

function setTipoToggle(tipo) {
  state.tipoMov = tipo;
  document.querySelectorAll('.tipo-toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tipo === tipo)
  );
}

function aplicarMovimentacaoRapida() {
  const item = state.panelItem;
  if (!item) return;

  const qtd = Number($('panelQtd')?.value || 0);
  if (!qtd || qtd <= 0) {
    showStatusPanel('Informe uma quantidade válida.', 'err');
    return;
  }

  const saldo = Number(item.saldo_atual);

  if (state.tipoMov === 'REDUCAO' && qtd > saldo) {
    showStatusPanel('Quantidade maior que o saldo disponível.', 'err');
    return;
  }

  // Aplica no estado local
  const idx = state.dashboard.findIndex(x => x.id === item.id);
  if (idx < 0) return;

  const novoSaldo = state.tipoMov === 'ENTRADA' ? saldo + qtd : saldo - qtd;
  state.dashboard[idx].saldo_atual = novoSaldo;
  state.panelItem.saldo_atual      = novoSaldo;

  // Registra no histórico
  const obs   = $('panelObs')?.value || '';
  const entry = {
    tipo:    state.tipoMov,
    nome:    item.item_nome,
    qtd,
    novoSaldo,
    obs,
    hora:    new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  };
  state.movHistorico.unshift(entry);
  renderMovHistorico();

  // Re-renderiza cards sem fechar o painel
  renderCards();
  renderEstoque();

  // Feedback visual
  atualizarSaldoPanel(novoSaldo, novoSaldo);
  showStatusPanel(`✓ ${state.tipoMov === 'ENTRADA' ? 'Entrada' : 'Redução'} de ${qtd} un. aplicada. Novo saldo: ${novoSaldo}`, 'ok');

  $('panelQtd').value = '';
  $('panelObs').value = '';

  // Fecha após 1.5s
  setTimeout(() => {
    fecharPanel();
    esconderStatusPanel();
  }, 1500);
}

function showStatusPanel(msg, tipo) {
  const st  = $('statusPanel');
  const msg_el = $('statusPanelMsg');
  if (!st || !msg_el) return;
  msg_el.textContent = msg;
  st.className = `status ${tipo}`;
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

  origem.innerHTML = destino.innerHTML = '';

  LOJAS.forEach(loja => {
    origem.add(new Option(loja.nome, loja.id));
    destino.add(new Option(loja.nome, loja.id));
  });

  origem.value  = state.lojaAtiva.id;
  destino.value = LOJAS.find(l => l.id !== state.lojaAtiva.id)?.id || '';

  renderMovRouteVisual();

  // Produto
  produto.innerHTML = '<option value="">Selecione…</option>';
  state.dashboard.forEach(item => {
    const label = item.campanha_nome
      ? `${item.campanha_nome} — ${item.item_nome}`
      : item.item_nome;
    produto.add(new Option(label, item.id));
  });
}

function renderMovRouteVisual() {
  const origemId  = Number($('movOrigem')?.value);
  const destinoId = Number($('movDestino')?.value);
  const origemL   = LOJAS.find(l => l.id === origemId);
  const destinoL  = LOJAS.find(l => l.id === destinoId);

  const nOrig = $('movNomeOrigem');
  const nDest = $('movNomeDestino');
  if (nOrig) nOrig.textContent = origemL?.nome || '—';
  if (nDest) nDest.textContent = destinoL?.nome || '—';

  const qty = Number($('movQtd')?.value || 0);
  const rQty = $('movRouteQty');
  if (rQty) rQty.textContent = qty > 0 ? `${qty} un.` : '—';
}

function renderMovHistorico() {
  const list = $('movHistoryList');
  if (!list) return;
  list.innerHTML = '';

  if (!state.movHistorico.length) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exchange-alt"></i><span>Nenhuma movimentação registrada ainda.</span></div>`;
    return;
  }

  state.movHistorico.slice(0, 8).forEach(entry => {
    const item = document.createElement('div');
    item.className = 'mov-history-item';
    item.innerHTML = `
      <span class="mhi-badge ${entry.tipo === 'ENTRADA' ? 'entrada' : 'reducao'}">
        ${entry.tipo}
      </span>
      <div class="mhi-info">
        <div class="mhi-nome">${entry.nome}</div>
        <div class="mhi-rota">${entry.hora}${entry.obs ? ' · ' + entry.obs : ''}</div>
      </div>
      <div class="mhi-qtd">${entry.tipo === 'ENTRADA' ? '+' : '-'}${entry.qtd}</div>
    `;
    list.appendChild(item);
  });
}

function salvarMovimentacao() {
  const origemId  = Number($('movOrigem')?.value);
  const destinoId = Number($('movDestino')?.value);
  const produtoId = Number($('movProduto')?.value);
  const qtd       = Number($('movQtd')?.value || 0);
  const custo     = Number($('movCusto')?.value || 0);
  const obs       = $('movObs')?.value?.trim() || '';

  if (!origemId || !destinoId || !produtoId) {
    setStatusMov('Preencha todos os campos obrigatórios.', 'err'); return;
  }
  if (origemId === destinoId) {
    setStatusMov('Origem e destino não podem ser iguais.', 'err'); return;
  }
  if (qtd <= 0) {
    setStatusMov('Informe uma quantidade válida.', 'err'); return;
  }

  const originL = LOJAS.find(l => l.id === origemId);
  const destL   = LOJAS.find(l => l.id === destinoId);
  const prod    = state.dashboard.find(x => x.id === produtoId);

  if (!prod) { setStatusMov('Produto não encontrado.', 'err'); return; }

  // Registra no histórico
  state.movHistorico.unshift({
    tipo: 'ENTRADA',
    nome: `${prod.item_nome} · ${originL?.nome} → ${destL?.nome}`,
    qtd, obs,
    hora: new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
  });
  renderMovHistorico();

  setStatusMov(`✓ Movimentação de ${qtd} un. de ${prod.item_nome} registrada.`, 'ok');

  $('movQtd').value  = '';
  $('movCusto').value= '';
  $('movObs').value  = '';
  renderMovRouteVisual();
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
  const container  = $('cardsEstoque');
  const searchVal  = $('estoqueSearch')?.value?.toLowerCase() || '';
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

  lista.forEach(item => {
    const card = montarCard(item, false);
    container.appendChild(card);
  });

  // Atualiza summary
  const totalItens    = lista.length;
  const totalSaldo    = lista.reduce((a,b) => a + Number(b.saldo_atual  || 0), 0);
  const totalVendas   = lista.reduce((a,b) => a + Number(b.vendidas_7d  || 0), 0);
  const criticos      = lista.filter(i => stockLevel(i) === 'critical').length;

  if ($('esItens'))   $('esItens').textContent   = totalItens;
  if ($('esSaldo'))   $('esSaldo').textContent   = totalSaldo;
  if ($('esVendas'))  $('esVendas').textContent  = totalVendas;
  if ($('esCriticos'))$('esCriticos').textContent= criticos;

  const alertItem = $('esAlertItem');
  if (alertItem) alertItem.style.opacity = criticos > 0 ? '1' : '.4';
}

// ══════════════════════════════════════════════════════
// TELA 4 — MESTRA
// ══════════════════════════════════════════════════════
function renderMestra() {
  const podeVer = ['ADMIN','SOCIO'].includes(state.roleUsuario);
  if (!podeVer) return;

  const lista = state.dashboard;

  // KPIs
  const totalVend  = lista.reduce((a,b) => a + Number(b.vendidas_7d   || 0), 0);
  const totalFat   = lista.reduce((a,b) => a + Number(b.vendidas_7d   || 0) * Number(b.valor_venda || 0), 0);
  const totalCusto = lista.reduce((a,b) => a + Number(b.vendidas_7d   || 0) * Number(b.valor_venda || 0) * .8, 0);
  const totalLucro = totalFat - totalCusto;
  const margem     = totalFat > 0 ? (totalLucro / totalFat * 100) : 0;

  if ($('kpiVendas'))  $('kpiVendas').textContent  = totalVend;
  if ($('kpiFat'))     $('kpiFat').textContent     = fmtBRL(totalFat);
  if ($('kpiCusto'))   $('kpiCusto').textContent   = fmtBRL(totalCusto);
  if ($('kpiLucro'))   $('kpiLucro').textContent   = fmtBRL(totalLucro);
  if ($('kpiMargem'))  $('kpiMargem').textContent  = margem.toFixed(1) + '%';

  // Tabela
  const tbody = $('mestraTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  lista.forEach(item => {
    const fat   = Number(item.vendidas_7d || 0) * Number(item.valor_venda || 0);
    const custo = fat * 0.8;
    const lucro = fat - custo;
    const marg  = fat > 0 ? (lucro / fat * 100) : 0;
    const tipoLabel = item.produto === 'RASPADINHA' ? 'rasp' : 'tele';
    const tipoBadge = item.produto === 'RASPADINHA' ? 'Rasp.' : 'Tele Sena';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="td-badge ${tipoLabel}">${tipoBadge}</span>
      </td>
      <td class="td-produto">
        ${item.campanha_nome ? `<span style="color:var(--text2);font-size:11px">${item.campanha_nome} · </span>` : ''}
        ${item.item_nome}
      </td>
      <td class="num">${item.vendidas_7d}</td>
      <td class="num">${fmtBRL(fat)}</td>
      <td class="num">${fmtBRL(custo)}</td>
      <td class="num ${lucro >= 0 ? 'td-lucro-pos' : 'td-lucro-neg'}">${fmtBRL(lucro)}</td>
      <td class="num">${marg.toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

// ══════════════════════════════════════════════════════
// MODAL DE LOJA
// ══════════════════════════════════════════════════════
function abrirModalLoja() {
  const box = $('listaLojasModal');
  if (!box) return;

  const wrap = document.createElement('div');
  wrap.className = 'loja-list';

  LOJAS.forEach(loja => {
    const btn = document.createElement('button');
    btn.className = `modal-loja-item${loja.slug === state.lojaAtiva.slug ? ' active' : ''}`;
    btn.innerHTML = `
      <i class="${loja.icon}"></i>
      ${loja.nome}
      <div class="modal-loja-dot"></div>
    `;
    btn.addEventListener('click', () => {
      state.lojaAtiva = loja;
      aplicarTema(loja.slug);
      renderMovSelects();
      renderCards();
      renderEstoque();
      fecharModalLoja();
    });
    wrap.appendChild(btn);
  });

  box.innerHTML = '';
  box.appendChild(wrap);
  $('modalLoja').classList.add('active');
}

function fecharModalLoja() {
  $('modalLoja').classList.remove('active');
}

// ══════════════════════════════════════════════════════
// CADASTRO — RASPADINHA
// ══════════════════════════════════════════════════════
async function salvarRaspadinha() {
  try {
    const nome = $('raspNome')?.value?.trim();
    const valorVend = Number($('raspValorVenda')?.value || 0);
    const ordem = Number($('raspOrdem')?.value || 0);

    if (!nome) {
      setStatusCadastro('raspNome', 'Informe o nome.', 'err');
      return;
    }

    if (valorVend <= 0) {
      setStatusCadastro('raspValorVenda', 'Informe o valor de venda.', 'err');
      return;
    }

    const valorCusto = Number((valorVend * 0.8).toFixed(2));
    const inp = $('raspValorCusto');
    if (inp) inp.value = valorCusto.toFixed(2);

    if (!sb) throw new Error('Supabase não inicializado.');

    const payload = {
      nome,
      valor_venda: valorVend,
      valor_custo: valorCusto,
      margem_percentual: 20,
      ordem,
      ativo: true
    };

    const { data, error } = await sb
      .from('raspadinhas')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    setStatus('statusRasp', `✓ Raspadinha "${data.nome}" salva.`, 'ok');

    $('raspNome').value = '';
    $('raspValorVenda').value = '';
    $('raspValorCusto').value = '';
    $('raspOrdem').value = '';

    await carregarDashboard();
    renderCards();
  } catch (e) {
    setStatus('statusRasp', `Erro: ${e.message || e}`, 'err');
    console.error('Erro ao salvar raspadinha:', e);
  }
}
async function carregarDashboard() {
  try {
    if (!sb) throw new Error('Supabase não inicializado.');
    if (!state.lojaAtiva?.id) return;

    const { data, error } = await sb
      .from('view_produtos_dashboard_loja')
      .select('*')
      .eq('loteria_id', state.lojaAtiva.id)
      .order('produto', { ascending: true });

    if (error) throw error;

    state.dashboard = data || [];
  } catch (e) {
    console.error('Erro ao carregar dashboard:', e);
    setStatus('statusGeral', `Erro ao carregar dashboard: ${e.message || e}`, 'err');
  }
}

async function salvarTeleSena() {
  try {
    const campanhaNome = $('teleCampanha')?.value?.trim();
    const itemNome = $('teleItem')?.value?.trim();
    const dataInicio = $('teleDataInicio')?.value || null;
    const dataFim = $('teleDataFim')?.value || null;
    const valorVenda = Number($('teleValorVenda')?.value || 0);
    const valorCusto = Number($('teleValorCusto')?.value || 0);

    if (!campanhaNome) {
      setStatus('statusTele', 'Informe a campanha.', 'err');
      $('teleCampanha')?.focus();
      return;
    }

    if (!itemNome) {
      setStatus('statusTele', 'Informe o item da campanha.', 'err');
      $('teleItem')?.focus();
      return;
    }

    if (!dataInicio || !dataFim) {
      setStatus('statusTele', 'Informe data inicial e final.', 'err');
      return;
    }

    if (valorVenda <= 0) {
      setStatus('statusTele', 'Informe o valor de venda.', 'err');
      $('teleValorVenda')?.focus();
      return;
    }

    if (valorCusto < 0) {
      setStatus('statusTele', 'Informe o valor de custo.', 'err');
      $('teleValorCusto')?.focus();
      return;
    }

    if (!sb) throw new Error('Supabase não inicializado.');

    // 1) busca campanha existente
    let campanhaId = null;

    const { data: campanhaExistente, error: campanhaBuscaErr } = await sb
      .from('telesena_campanhas')
      .select('id, nome')
      .eq('nome', campanhaNome)
      .maybeSingle();

    if (campanhaBuscaErr) throw campanhaBuscaErr;

    if (campanhaExistente?.id) {
      campanhaId = campanhaExistente.id;
    } else {
      const { data: campanhaNova, error: campanhaInsertErr } = await sb
        .from('telesena_campanhas')
        .insert({
          nome: campanhaNome,
          data_inicio: dataInicio,
          data_fim: dataFim,
          ativo: true,
          ordem: 0
        })
        .select()
        .single();

      if (campanhaInsertErr) throw campanhaInsertErr;
      campanhaId = campanhaNova.id;
    }

    // 2) cria item da campanha
    const { data: itemNovo, error: itemErr } = await sb
      .from('telesena_itens')
      .insert({
        campanha_id: campanhaId,
        nome: itemNome,
        valor_venda: valorVenda,
        valor_custo: valorCusto,
        ativo: true,
        ordem: 0
      })
      .select()
      .single();

    if (itemErr) throw itemErr;

    setStatus('statusTele', `✓ Item "${itemNovo.nome}" salvo na campanha "${campanhaNome}".`, 'ok');

    $('teleCampanha').value = '';
    $('teleItem').value = '';
    $('teleDataInicio').value = '';
    $('teleDataFim').value = '';
    $('teleValorVenda').value = '';
    $('teleValorCusto').value = '';

    await carregarDashboard();
    renderCards();
  } catch (e) {
    setStatus('statusTele', `Erro: ${e.message || e}`, 'err');
    console.error('Erro ao salvar Tele Sena:', e);
  }
}

function setStatus(elId, msg, tipo) {
  const el = $(elId);
  if (!el) return;
  el.className = `status ${tipo}`;
  const icon = tipo === 'ok' ? 'check-circle' : tipo === 'err' ? 'exclamation-circle' : 'info-circle';
  el.innerHTML = `<i class="fas fa-${icon}"></i><span>${msg}</span>`;
}

function setStatusCadastro(inputId, msg, tipo) {
  const inp = $(inputId);
  if (inp) { inp.focus(); inp.style.borderColor = tipo === 'err' ? 'var(--error)' : ''; }
  setStatus('statusRasp', msg, tipo);
}
function preencherData() {
  const agora = new Date();
  const dataBr = agora.toLocaleDateString('pt-BR');
  const dataIso = agora.toISOString().slice(0, 10);

  const pillData = $('pillData');
  if (pillData) pillData.textContent = dataBr;

  const teleDataInicio = $('teleDataInicio');
  const teleDataFim = $('teleDataFim');

  if (teleDataInicio && !teleDataInicio.value) teleDataInicio.value = dataIso;
  if (teleDataFim && !teleDataFim.value) teleDataFim.value = dataIso;
}

async function inativarTeleSenaSelecionada() {
  try {
    const campanhaNome = $('teleCampanha')?.value?.trim();
    const itemNome = $('teleItem')?.value?.trim();

    if (!campanhaNome) {
      setStatus('statusTele', 'Informe a campanha para inativar.', 'err');
      return;
    }

    if (!sb) throw new Error('Supabase não inicializado.');

    // tenta item primeiro
    if (itemNome) {
      const { data: campanha, error: campanhaErr } = await sb
        .from('telesena_campanhas')
        .select('id')
        .eq('nome', campanhaNome)
        .maybeSingle();

      if (campanhaErr) throw campanhaErr;
      if (!campanha?.id) throw new Error('Campanha não encontrada.');

      const { data: item, error: itemBuscaErr } = await sb
        .from('telesena_itens')
        .select('id')
        .eq('campanha_id', campanha.id)
        .eq('nome', itemNome)
        .maybeSingle();

      if (itemBuscaErr) throw itemBuscaErr;
      if (!item?.id) throw new Error('Item não encontrado.');

      const { error: updErr } = await sb
        .from('telesena_itens')
        .update({ ativo: false })
        .eq('id', item.id);

      if (updErr) throw updErr;

      setStatus('statusTele', `✓ Item "${itemNome}" inativado.`, 'ok');
    } else {
      const { error: updCampErr } = await sb
        .from('telesena_campanhas')
        .update({ ativo: false })
        .eq('nome', campanhaNome);

      if (updCampErr) throw updCampErr;

      setStatus('statusTele', `✓ Campanha "${campanhaNome}" inativada.`, 'ok');
    }

    await carregarDashboard();
    renderCards();
    renderEstoque();
    renderMestra();
  } catch (e) {
    console.error('Erro ao inativar Tele Sena:', e);
    setStatus('statusTele', `Erro: ${e.message || e}`, 'err');
  }
}
// ══════════════════════════════════════════════════════
// BIND DE EVENTOS
// ══════════════════════════════════════════════════════
function bind() {

  // Quickbar
  document.querySelectorAll('.qmod').forEach(btn =>
    btn.addEventListener('click', () => mudarScreen(btn.dataset.screen))
  );

  // Tipo chips (Raspadinha / Tele Sena)
  document.querySelectorAll('.tipo-chip').forEach(btn =>
    btn.addEventListener('click', () => mudarAba(btn.dataset.aba))
  );

  // Fechar pane pelo ×
  document.querySelectorAll('.pane-close').forEach(btn =>
    btn.addEventListener('click', () => mudarAba(btn.dataset.aba))
  );

  // Trocar loja
  const lojaTree = $('lojaTreeWrap');
  if (lojaTree) lojaTree.addEventListener('click', abrirModalLoja);

  const btnFechModal = $('btnFecharModalLoja');
  if (btnFechModal) btnFechModal.addEventListener('click', fecharModalLoja);

  // Panel
  $('btnFecharPanel')?.addEventListener('click', fecharPanel);
  $('panelBackdrop')?.addEventListener('click', fecharPanel);
  $('btnAplicarPanel')?.addEventListener('click', aplicarMovimentacaoRapida);

  // Toggle entrada / redução
  document.querySelectorAll('.tipo-toggle-btn').forEach(btn =>
    btn.addEventListener('click', () => { setTipoToggle(btn.dataset.tipo); calcularPrevisto(); })
  );

  // Stepper quantidade panel
  $('panelQtdMinus')?.addEventListener('click', () => {
    const inp = $('panelQtd');
    if (inp) { inp.value = Math.max(0, Number(inp.value) - 1); calcularPrevisto(); }
  });
  $('panelQtdPlus')?.addEventListener('click', () => {
    const inp = $('panelQtd');
    if (inp) { inp.value = Number(inp.value) + 1; calcularPrevisto(); }
  });
  $('panelQtd')?.addEventListener('input', calcularPrevisto);

  // Stepper movimentação entre lojas
  $('movQtdMinus')?.addEventListener('click', () => {
    const inp = $('movQtd');
    if (inp) { inp.value = Math.max(0, Number(inp.value) - 1); renderMovRouteVisual(); }
  });
  $('movQtdPlus')?.addEventListener('click', () => {
    const inp = $('movQtd');
    if (inp) { inp.value = Number(inp.value) + 1; renderMovRouteVisual(); }
  });
  $('movQtd')?.addEventListener('input', renderMovRouteVisual);

  // Selects de movimentação
  $('movOrigem')?.addEventListener('change', renderMovRouteVisual);
  $('movDestino')?.addEventListener('change', renderMovRouteVisual);

  // Salvar movimentação entre lojas
  $('btnSalvarMov')?.addEventListener('click', salvarMovimentacao);
  $('btnLimparMov')?.addEventListener('click', () => {
    ['movQtd','movCusto','movObs'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    renderMovRouteVisual();
    setStatusMov('Campos limpos.', 'muted');
  });

  // Cadastro raspadinha — custo automático
  $('raspValorVenda')?.addEventListener('input', () => {
    const v = Number($('raspValorVenda').value || 0);
    const c = $('raspValorCusto');
    if (c) c.value = v > 0 ? (v * 0.8).toFixed(2) : '';
  });

  $('btnSalvarRasp')?.addEventListener('click', salvarRaspadinha);
  $('btnInativarRasp')?.addEventListener('click', () => setStatus('statusRasp', 'Raspadinha inativada.', 'ok'));
  $('btnSalvarTele')?.addEventListener('click', salvarTeleSena);
$('btnInativarTele')?.addEventListener('click', inativarTeleSenaSelecionada);
  // Filtros estoque rápido (Tela 1)
  document.querySelectorAll('#stockFilterChips .filter-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#stockFilterChips .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.tipoFiltro = btn.dataset.filter;
      renderCards();
    })
  );

  // Filtros estoque (Tela 3)
  document.querySelectorAll('#estoqueFilterChips .filter-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#estoqueFilterChips .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEstoque();
    })
  );

  $('estoqueSearch')?.addEventListener('input', renderEstoque);

  // Mestra — filtros
  $('mestraPeriodo')?.addEventListener('change', renderMestra);
  $('mestraTipo')?.addEventListener('change', renderMestra);

  // Navegação (início / sair)
  $('btnInicio')?.addEventListener('click', () => window.SISLOT_SECURITY?.irParaInicio?.());
  $('btnSair')?.addEventListener('click', async () => await window.SISLOT_SECURITY?.sair?.());

  // Fecha modal pelo overlay
  $('modalLoja')?.addEventListener('click', e => {
    if (e.target === $('modalLoja')) fecharModalLoja();
  });
}
