const $ = (id) => document.getElementById(id);

const state = {
  ctx: null,
  loteriasPermitidas: [],
  loteriaAtiva: null,
  screen: 'cadastro',
  cadastroTab: null,
  estoqueRapido: [],
  estoqueLista: [],
  mestraLista: [],
  permissaoMestra: false
};

// MOCK inicial
const mockLoterias = [
  { id: 1, nome: 'Centro', slug: 'centro', principal: true, papel_na_loja: 'ADMIN' },
  { id: 2, nome: 'Boulevard', slug: 'boulevard', principal: false, papel_na_loja: 'ADMIN' },
  { id: 3, nome: 'Lotobel', slug: 'lotobel', principal: false, papel_na_loja: 'ADMIN' },
  { id: 4, nome: 'Santa Tereza', slug: 'santa-tereza', principal: false, papel_na_loja: 'ADMIN' },
  { id: 5, nome: 'Via Brasil', slug: 'via-brasil', principal: false, papel_na_loja: 'ADMIN' }
];

const mockEstoque = [
  { id: 101, familia: 'RASPADINHA', item: 'Raspadinha R$ 2,50', campanha: '', saldo: 120, entradas: 200, mov: 0, vendidas7d: 28, mediaDia: 4, duracao: 30 },
  { id: 102, familia: 'RASPADINHA', item: 'Raspadinha R$ 5,00', campanha: '', saldo: 75, entradas: 100, mov: -5, vendidas7d: 21, mediaDia: 3, duracao: 25 },
  { id: 201, familia: 'TELESENA', item: 'Tele Sena Completa', campanha: 'Mães 2026', saldo: 90, entradas: 120, mov: 10, vendidas7d: 35, mediaDia: 5, duracao: 18 },
  { id: 202, familia: 'TELESENA', item: 'Tele Sena Semanal', campanha: 'Mães 2026', saldo: 40, entradas: 80, mov: 0, vendidas7d: 14, mediaDia: 2, duracao: 20 }
];

const mockMestra = [
  { familia: 'RASPADINHA', item: 'Raspadinha R$ 2,50', campanha: '', vendidas: 280, faturamento: 700.00, custo: 560.00, lucro: 140.00 },
  { familia: 'RASPADINHA', item: 'Raspadinha R$ 5,00', campanha: '', vendidas: 120, faturamento: 600.00, custo: 480.00, lucro: 120.00 },
  { familia: 'TELESENA', item: 'Tele Sena Completa', campanha: 'Mães 2026', vendidas: 150, faturamento: 600.00, custo: 552.00, lucro: 48.00 }
];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  await carregarContexto();
  montarLojaInicial();
  aplicarTema();
  renderTudo();
}

function bindEvents() {
  document.querySelectorAll('.main-tab').forEach(btn => {
    btn.addEventListener('click', () => mudarScreen(btn.dataset.screen));
  });

  document.querySelectorAll('.subtab').forEach(btn => {
    btn.addEventListener('click', () => mudarCadastroTab(btn.dataset.cadastro));
  });

  $('sel-loja').addEventListener('change', onTrocaLoja);
  $('btn-recarregar').addEventListener('click', renderTudo);

  $('btn-cancelar-raspadinha').addEventListener('click', () => mudarCadastroTab(null));
  $('btn-cancelar-telesena').addEventListener('click', () => mudarCadastroTab(null));

  $('tele-valor-venda').addEventListener('input', recalcularCustoTelesena);

  $('btn-salvar-raspadinha').addEventListener('click', salvarRaspadinha);
  $('btn-salvar-telesena').addEventListener('click', salvarTelesena);
  $('btn-salvar-mov').addEventListener('click', salvarMovimentacao);

  $('filtro-familia-cadastro').addEventListener('change', renderMovRapida);
  $('filtro-familia-estoque').addEventListener('change', renderEstoque);
  $('btn-buscar-mestra').addEventListener('click', renderMestra);
}

async function carregarContexto() {
  // aqui você pluga tua segurança real
  state.ctx = {
    usuario: { id: 1, nome: 'Administrador', perfil: 'ADMIN' },
    lojasPermitidas: mockLoterias,
    lojaInicial: mockLoterias.find(l => l.principal) || mockLoterias[0]
  };

  state.loteriasPermitidas = state.ctx.lojasPermitidas || [];
  state.permissaoMestra =
    state.ctx.usuario?.perfil === 'ADMIN' ||
    state.loteriasPermitidas.some(l => l.papel_na_loja === 'SOCIO');
}

function montarLojaInicial() {
  const select = $('sel-loja');
  const movOrigem = $('mov-origem');
  const movDestino = $('mov-destino');

  select.innerHTML = '';
  movOrigem.innerHTML = '';
  movDestino.innerHTML = '';

  state.loteriasPermitidas.forEach(loja => {
    const opt = new Option(loja.nome, loja.id);
    const opt2 = new Option(loja.nome, loja.id);
    const opt3 = new Option(loja.nome, loja.id);
    select.add(opt);
    movOrigem.add(opt2);
    movDestino.add(opt3);
  });

  state.loteriaAtiva = state.ctx.lojaInicial;
  select.value = String(state.loteriaAtiva.id);
  movOrigem.value = String(state.loteriaAtiva.id);

  if (!state.permissaoMestra) {
    $('tab-mestra').style.display = 'none';
    if (state.screen === 'mestra') mudarScreen('cadastro');
  }
}

function aplicarTema() {
  $('app').dataset.theme = state.loteriaAtiva?.slug || 'centro';
  $('subtitulo-topo').textContent = `Gestão operacional • ${state.loteriaAtiva?.nome || ''}`;
}

function mudarScreen(screen) {
  if (screen === 'mestra' && !state.permissaoMestra) return;

  state.screen = screen;

  document.querySelectorAll('.main-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === screen)
  );

  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === `screen-${screen}`)
  );
}

function mudarCadastroTab(tab) {
  state.cadastroTab = tab;

  document.querySelectorAll('.subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.cadastro === tab)
  );

  $('cadastro-empty').classList.toggle('hidden', !!tab);
  $('form-raspadinha').classList.toggle('hidden', tab !== 'raspadinha');
  $('form-telesena').classList.toggle('hidden', tab !== 'telesena');
}

function onTrocaLoja(e) {
  const id = Number(e.target.value);
  state.loteriaAtiva = state.loteriasPermitidas.find(l => l.id === id) || state.loteriaAtiva;
  $('mov-origem').value = String(id);
  aplicarTema();
  renderTudo();
}

function renderTudo() {
  carregarDadosMock();
  renderCards();
  renderMovRapida();
  renderEstoque();
  renderMestra();
  renderItensMovimentacao();
}

function carregarDadosMock() {
  state.estoqueRapido = [...mockEstoque];
  state.estoqueLista = [...mockEstoque];
  state.mestraLista = [...mockMestra];
}

function renderCards() {
  const totalVendidas7d = state.estoqueLista.reduce((a, b) => a + Number(b.vendidas7d || 0), 0);
  const mediaDia = state.estoqueLista.reduce((a, b) => a + Number(b.mediaDia || 0), 0);
  const saldo = state.estoqueLista.reduce((a, b) => a + Number(b.saldo || 0), 0);
  const duracao = mediaDia > 0 ? (saldo / mediaDia).toFixed(1) + ' dias' : 'Sem giro recente';
  const campanhaAtiva = state.estoqueLista.find(i => i.familia === 'TELESENA' && i.campanha)?.campanha || '—';

  $('card-vendidas-7d').textContent = String(totalVendidas7d);
  $('card-media-dia').textContent = mediaDia.toFixed(1).replace('.', ',');
  $('card-duracao').textContent = duracao;
  $('card-campanha').textContent = campanhaAtiva;
}

function renderMovRapida() {
  const familia = $('filtro-familia-cadastro').value;
  const tbody = $('tbody-mov-rapida');
  tbody.innerHTML = '';

  const lista = state.estoqueRapido.filter(item => familia === 'TODOS' || item.familia === familia);

  lista.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.familia}</td>
      <td>${item.item}</td>
      <td>${item.campanha || '—'}</td>
      <td>${item.saldo}</td>
      <td>
        <select data-tipo="${item.id}" class="mov-tipo">
          <option value="ENTRADA">Entrada</option>
          <option value="REDUCAO">Redução</option>
        </select>
      </td>
      <td><input type="number" min="0" value="0" class="mov-qtd" data-qtd="${item.id}" /></td>
      <td><span id="saldo-final-${item.id}">${item.saldo}</span></td>
      <td><button class="btn btn-primary btn-aplicar" data-id="${item.id}">Aplicar</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.mov-qtd, .mov-tipo').forEach(el => {
    el.addEventListener('input', atualizarSaldoPrevisto);
    el.addEventListener('change', atualizarSaldoPrevisto);
  });

  document.querySelectorAll('.btn-aplicar').forEach(btn => {
    btn.addEventListener('click', aplicarMovimentacaoRapida);
  });
}

function atualizarSaldoPrevisto(e) {
  const rowId = Number(e.target.dataset.qtd || e.target.dataset.tipo);
  const item = state.estoqueRapido.find(i => i.id === rowId);
  if (!item) return;

  const tipo = document.querySelector(`select[data-tipo="${rowId}"]`)?.value || 'ENTRADA';
  const qtd = Number(document.querySelector(`input[data-qtd="${rowId}"]`)?.value || 0);

  const saldoFinal = tipo === 'ENTRADA' ? item.saldo + qtd : item.saldo - qtd;
  $(`saldo-final-${rowId}`).textContent = saldoFinal < 0 ? 'Inválido' : String(saldoFinal);
}

function aplicarMovimentacaoRapida(e) {
  const id = Number(e.currentTarget.dataset.id);
  const item = state.estoqueRapido.find(i => i.id === id);
  if (!item) return;

  const tipo = document.querySelector(`select[data-tipo="${id}"]`)?.value || 'ENTRADA';
  const qtd = Number(document.querySelector(`input[data-qtd="${id}"]`)?.value || 0);

  if (!qtd || qtd <= 0) {
    alert('Informe uma quantidade válida.');
    return;
  }

  if (tipo === 'REDUCAO' && qtd > item.saldo) {
    alert('Saldo insuficiente para redução.');
    return;
  }

  item.saldo = tipo === 'ENTRADA' ? item.saldo + qtd : item.saldo - qtd;
  renderMovRapida();
  renderEstoque();
  renderCards();
}

function renderItensMovimentacao() {
  const sel = $('mov-item');
  sel.innerHTML = '';

  mockEstoque.forEach(item => {
    sel.add(new Option(`${item.familia} • ${item.item}`, item.id));
  });
}

function salvarMovimentacao() {
  const qtd = Number($('mov-qtd').value || 0);
  const custo = Number($('mov-custo').value || 0);
  if (!qtd || qtd <= 0) {
    alert('Informe quantidade válida.');
    return;
  }
  alert('Movimentação pronta para integrar no backend.');
}

function renderEstoque() {
  const familia = $('filtro-familia-estoque').value;
  const tbody = $('tbody-estoque');
  tbody.innerHTML = '';

  const lista = state.estoqueLista.filter(item => familia === 'TODOS' || item.familia === familia);

  lista.forEach(item => {
    const badge = item.duracao <= 7 ? 'danger' : item.duracao <= 15 ? 'warn' : 'ok';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.familia}</td>
      <td>${item.item}</td>
      <td>${item.campanha || '—'}</td>
      <td>${item.entradas}</td>
      <td>${item.mov}</td>
      <td>${item.vendidas7d}</td>
      <td>${item.saldo}</td>
      <td><span class="badge ${badge}">${item.duracao} dias</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderMestra() {
  const tbody = $('tbody-mestra');
  tbody.innerHTML = '';

  const familia = $('mestra-familia').value;
  const lista = state.mestraLista.filter(item => familia === 'TODOS' || item.familia === familia);

  let vendas = 0;
  let faturamento = 0;
  let custo = 0;
  let lucro = 0;

  lista.forEach(item => {
    vendas += Number(item.vendidas || 0);
    faturamento += Number(item.faturamento || 0);
    custo += Number(item.custo || 0);
    lucro += Number(item.lucro || 0);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.familia}</td>
      <td>${item.item}</td>
      <td>${item.campanha || '—'}</td>
      <td>${item.vendidas}</td>
      <td>${fmtBRL(item.faturamento)}</td>
      <td>${fmtBRL(item.custo)}</td>
      <td>${fmtBRL(item.lucro)}</td>
    `;
    tbody.appendChild(tr);
  });

  $('mestra-vendas').textContent = String(vendas);
  $('mestra-faturamento').textContent = fmtBRL(faturamento);
  $('mestra-custo').textContent = fmtBRL(custo);
  $('mestra-lucro').textContent = fmtBRL(lucro);
}

function recalcularCustoTelesena() {
  const venda = Number($('tele-valor-venda').value || 0);
  const custo = venda * 0.92;
  $('tele-valor-custo').value = custo ? custo.toFixed(2) : '';
}

function salvarRaspadinha() {
  alert('Cadastro de raspadinha pronto para integrar no backend.');
}

function salvarTelesena() {
  alert('Cadastro de Tele Sena pronto para integrar no backend.');
}

function fmtBRL(v) {
  return Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}
