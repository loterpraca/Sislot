const sb = window.supabase && window.SISLOT_CONFIG
  ? supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey)
  : null;

const utils = window.SISLOT_UTILS || {};
const $ = utils.$ || (id => document.getElementById(id));

const LOJAS = [
  { id: 1, nome: 'Centro', slug: 'centro', logo: '' },
  { id: 2, nome: 'Boulevard', slug: 'boulevard', logo: '' },
  { id: 3, nome: 'Lotobel', slug: 'lotobel', logo: '' },
  { id: 4, nome: 'Santa Tereza', slug: 'santa-tereza', logo: '' },
  { id: 5, nome: 'Via Brasil', slug: 'via-brasil', logo: '' }
];

const state = {
  lojaAtiva: LOJAS[0],
  abaCadastro: 'raspadinha',
  screen: 'cadastro',
  selecionado: null,
  podeVerMestra: true,
  dashboard: [
    { id: 1, produto: 'RASPADINHA', campanha_nome: 'Jogo da Velha', item_nome: 'Jogo da Velha', saldo_atual: 120, vendidas_7d: 18, media_dia_7d: 2.57, duracao_estoque_dias: 46.7, valor_venda: 2.5 },
    { id: 2, produto: 'RASPADINHA', campanha_nome: 'Trio da Sorte', item_nome: 'Trio da Sorte', saldo_atual: 80, vendidas_7d: 10, media_dia_7d: 1.43, duracao_estoque_dias: 55.9, valor_venda: 2.5 },
    { id: 3, produto: 'TELESENA', campanha_nome: 'Mães 2026', item_nome: 'Completa', saldo_atual: 50, vendidas_7d: 14, media_dia_7d: 2.00, duracao_estoque_dias: 25.0, valor_venda: 12 }
  ]
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  bind();
  renderLoja();
  renderTabs();
  renderCards();
  renderMovSelects();
  renderMestra();
  preencherData();
}

function bind() {
  document.querySelectorAll('.qmod').forEach(btn => {
    btn.addEventListener('click', () => mudarScreen(btn.dataset.screen));
  });

  document.querySelectorAll('.chip-tile').forEach(btn => {
    btn.addEventListener('click', () => mudarAba(btn.dataset.aba));
  });

  $('btnLoja').addEventListener('click', abrirModalLoja);
  $('btnFecharModalLoja').addEventListener('click', fecharModalLoja);
  $('btnFecharPanel').addEventListener('click', fecharPanel);

  $('panelTipoMov').addEventListener('change', atualizarPrevisto);
  $('panelQtd').addEventListener('input', atualizarPrevisto);

  $('btnAplicarPanel').addEventListener('click', aplicarMovimentacaoRapida);

  $('btnSalvarRasp').addEventListener('click', () => alert('Salvar raspadinha'));
  $('btnSalvarTele').addEventListener('click', () => alert('Salvar Tele Sena'));
  $('btnInativarRasp').addEventListener('click', () => alert('Inativar raspadinha'));
  $('btnInativarTele').addEventListener('click', () => alert('Inativar item/campanha'));
  $('btnSalvarMov').addEventListener('click', () => alert('Salvar movimentação entre lojas'));
}

function preencherData() {
  const now = new Date();
  $('pillData').textContent = now.toLocaleDateString('pt-BR');
}

function mudarScreen(screen) {
  if (screen === 'mestra' && !state.podeVerMestra) return;
  state.screen = screen;

  document.querySelectorAll('.qmod').forEach(b => b.classList.toggle('active', b.dataset.screen === screen));
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${screen}`));
}

function mudarAba(aba) {
  state.abaCadastro = aba;
  document.querySelectorAll('.chip-tile').forEach(b => b.classList.toggle('active', b.dataset.aba === aba));
  document.querySelectorAll('.cadastro-pane').forEach(p => p.classList.remove('active'));
  $(`pane-${aba}`).classList.add('active');
}

function renderLoja() {
  document.body.dataset.loja = state.lojaAtiva.slug;
  document.documentElement.dataset.loja = state.lojaAtiva.slug;
  $('headerNome').textContent = state.lojaAtiva.nome;
  $('pillLoja').textContent = state.lojaAtiva.nome;
  $('lojaLogo').src = state.lojaAtiva.logo || '';
}

function abrirModalLoja() {
  const box = $('listaLojasModal');
  box.innerHTML = '';
  LOJAS.forEach(loja => {
    const div = document.createElement('button');
    div.className = 'modal-loja-item';
    div.textContent = loja.nome;
    div.onclick = () => {
      state.lojaAtiva = loja;
      renderLoja();
      fecharModalLoja();
    };
    box.appendChild(div);
  });
  $('modalLoja').classList.add('active');
}

function fecharModalLoja() {
  $('modalLoja').classList.remove('active');
}

function renderTabs() {
  if (!state.podeVerMestra) $('btnMestra').style.display = 'none';
}

function renderCards() {
  const cardsCadastro = $('cardsCadastro');
  const cardsEstoque = $('cardsEstoque');

  cardsCadastro.innerHTML = '';
  cardsEstoque.innerHTML = '';

  const lista = state.dashboard.filter(item =>
    state.abaCadastro === 'raspadinha' ? item.produto === 'RASPADINHA' : item.produto === 'TELESENA'
  );

  const totalVendidas = lista.reduce((a, b) => a + Number(b.vendidas_7d || 0), 0);
  const totalMedia = lista.reduce((a, b) => a + Number(b.media_dia_7d || 0), 0);
  const totalSaldo = lista.reduce((a, b) => a + Number(b.saldo_atual || 0), 0);
  const duracao = totalMedia > 0 ? (totalSaldo / totalMedia).toFixed(1) + ' dias' : '—';

  $('mVendidas7d').textContent = String(totalVendidas);
  $('mMediaDia').textContent = totalMedia.toFixed(2).replace('.', ',');
  $('mDuracao').textContent = duracao;
  $('mCampanha').textContent = lista[0]?.campanha_nome || '—';

  state.dashboard.forEach(item => {
    const card = montarCard(item);
    cardsEstoque.appendChild(card.cloneNode(true));
  });

  lista.forEach(item => {
    const card = montarCard(item);
    card.addEventListener('click', () => abrirPanel(item));
    cardsCadastro.appendChild(card);
  });
}

function montarCard(item) {
  const card = document.createElement('div');
  card.className = 'prod-card';
  card.innerHTML = `
    <div class="top">
      <div>
        <div class="name">${item.item_nome}</div>
        <div class="sub">${item.campanha_nome || '—'} • ${item.produto}</div>
      </div>
      <div class="sub">R$ ${Number(item.valor_venda || 0).toFixed(2).replace('.', ',')}</div>
    </div>
    <div class="meta">
      <div><span>Saldo</span><strong>${item.saldo_atual}</strong></div>
      <div><span>Vendidas 7d</span><strong>${item.vendidas_7d}</strong></div>
      <div><span>Média/dia</span><strong>${Number(item.media_dia_7d || 0).toFixed(2).replace('.', ',')}</strong></div>
      <div><span>Duração</span><strong>${item.duracao_estoque_dias ?? '—'}</strong></div>
    </div>
  `;
  return card;
}

function abrirPanel(item) {
  state.selecionado = item;
  $('panelTitulo').textContent = item.item_nome;
  $('panelSub').textContent = `Saldo atual: ${item.saldo_atual}`;
  $('panelQtd').value = '';
  $('panelObs').value = '';
  $('panelSaldoPrev').value = item.saldo_atual;
  $('movPanel').classList.add('active');
}

function fecharPanel() {
  $('movPanel').classList.remove('active');
  state.selecionado = null;
}

function atualizarPrevisto() {
  if (!state.selecionado) return;
  const tipo = $('panelTipoMov').value;
  const qtd = Number($('panelQtd').value || 0);
  const saldo = Number(state.selecionado.saldo_atual || 0);
  const final = tipo === 'ENTRADA' ? saldo + qtd : saldo - qtd;
  $('panelSaldoPrev').value = final;
}

function aplicarMovimentacaoRapida() {
  if (!state.selecionado) return;
  const tipo = $('panelTipoMov').value;
  const qtd = Number($('panelQtd').value || 0);
  if (!qtd || qtd <= 0) return alert('Informe quantidade válida');

  const idx = state.dashboard.findIndex(x => x.id === state.selecionado.id);
  if (idx < 0) return;

  const saldo = Number(state.dashboard[idx].saldo_atual || 0);
  if (tipo === 'REDUCAO' && qtd > saldo) return alert('Saldo insuficiente');

  state.dashboard[idx].saldo_atual = tipo === 'ENTRADA' ? saldo + qtd : saldo - qtd;
  renderCards();
  fecharPanel();
}

function renderMovSelects() {
  const origem = $('movOrigem');
  const destino = $('movDestino');
  const produto = $('movProduto');
  origem.innerHTML = '';
  destino.innerHTML = '';
  produto.innerHTML = '';

  LOJAS.forEach(loja => {
    origem.add(new Option(loja.nome, loja.id));
    destino.add(new Option(loja.nome, loja.id));
  });
  origem.value = state.lojaAtiva.id;

  state.dashboard.forEach(item => {
    produto.add(new Option(item.item_nome, item.id));
  });
}

function renderMestra() {
  const box = $('cardsMestra');
  box.innerHTML = '';
  if (!state.podeVerMestra) return;

  const totalQtd = state.dashboard.reduce((a, b) => a + Number(b.vendidas_7d || 0), 0);
  const totalFat = state.dashboard.reduce((a, b) => a + Number(b.vendidas_7d || 0) * Number(b.valor_venda || 0), 0);

  [
    { titulo: 'Vendas', valor: totalQtd },
    { titulo: 'Faturamento', valor: `R$ ${totalFat.toFixed(2).replace('.', ',')}` },
    { titulo: 'Itens ativos', valor: state.dashboard.length }
  ].forEach(item => {
    const card = document.createElement('div');
    card.className = 'metric-card';
    card.innerHTML = `<span>${item.titulo}</span><strong>${item.valor}</strong>`;
    box.appendChild(card);
  });
}
