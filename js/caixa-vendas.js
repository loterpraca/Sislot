const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

const TZ_SISLOT = 'America/Sao_Paulo';

function partesDataSaoPaulo(dt = new Date()){
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_SISLOT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(dt);

  const obj = {};

  parts.forEach(p => {
    if (p.type !== 'literal') {
      obj[p.type] = p.value;
    }
  });

  return {
    ano: Number(obj.year),
    mes: Number(obj.month),
    dia: Number(obj.day)
  };
}

/* =========================================================
   SISLOT — Vendas no Caixa
   Arquivo limpo: Bolões + Consolidado mensal por setor
========================================================= */

// ── Estado ────────────────────────────────────────────────────────
// ── Estado ────────────────────────────────────────────────────────
let usuario = null;
let dataCaixa = hojeLocal();
let dataConsolidadoCaixa = hojeLocal();
let resumoDiasCaixa = {};
let lojasAtivas = [];
let lojasPermitidas = [];
let lojaCaixaAtiva = null;
let bolaoSelecionadoCaixa = null;
let federalSelecionadaCaixa = null;
let produtoSelecionadoCaixa = null;

const MESES_PT = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

const LOJA_CONFIG = {
  'boulevard':    { nome:'Boulevard',    logo:'./icons/boulevard.png',    theme:'boulevard',    logoPos:'50% 50%' },
  'centro':       { nome:'Centro',       logo:'./icons/loterpraca.png',   theme:'centro',       logoPos:'50% 42%' },
  'lotobel':      { nome:'Lotobel',      logo:'./icons/lotobel.png',      theme:'lotobel',      logoPos:'50% 50%' },
  'santa-tereza': { nome:'Santa Tereza', logo:'./icons/santa-tereza.png', theme:'santa-tereza', logoPos:'50% 50%' },
  'via-brasil':   { nome:'Via',          logo:'./icons/via-brasil.png',   theme:'via-brasil',   logoPos:'50% 50%' },
  'via':          { nome:'Via',          logo:'./icons/via-brasil.png',   theme:'via-brasil',   logoPos:'50% 50%' },
};

// ── Helpers básicos ───────────────────────────────────────────────
function $(id){
  return document.getElementById(id);
}

function normalizaDataLocal(dt){
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return hojeLocal();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function hojeLocal(){
  const p = partesDataSaoPaulo();
  return new Date(p.ano, p.mes - 1, p.dia);
}

function isoDate(dt){
  const d = normalizaDataLocal(dt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

function dataFromISO(iso){
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return hojeLocal();
  return new Date(y, m - 1, d);
}

function fmtData(dt){
  const d = normalizaDataLocal(dt);
  return d.toLocaleDateString('pt-BR', {
    weekday:'short',
    day:'2-digit',
    month:'2-digit',
    year:'numeric'
  });
}

function fmtHora(dt){
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return '—';

  return d.toLocaleTimeString('pt-BR', {
    timeZone: TZ_SISLOT,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function fmtBRL(v){
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits:2,
    maximumFractionDigits:2
  });
}

function parseBRL(v){
  return parseFloat(
    String(v || '')
      .replace(/[R$\s]/g,'')
      .replace(/\./g,'')
      .replace(',','.')
  ) || 0;
}

function slugSeguro(slug){
  return String(slug || 'centro').trim().toLowerCase();
}

// ── Tema / loja ───────────────────────────────────────────────────
function aplicarTemaCaixa(slug){
  const key = slugSeguro(slug);
  const cfg = LOJA_CONFIG[key] || LOJA_CONFIG.centro;

  document.body.setAttribute('data-loja', cfg.theme || key);

  const img = $('logoImg');
  if (img) {
    img.src = cfg.logo;
    img.style.objectPosition = cfg.logoPos || '50% 50%';
  }

  const title = $('headerTitle');
  if (title) title.textContent = cfg.nome;

  const sub = $('headerSub');
  if (sub) sub.textContent = 'Vendas no Caixa';

  const nomeChip = $('caixaLojaNome');
  if (nomeChip) nomeChip.textContent = cfg.nome;

  const nomeFederal = $('federalLojaNome');
  if (nomeFederal) nomeFederal.textContent = cfg.nome;

  const nomeProdutos = $('produtosLojaNome');
  if (nomeProdutos) nomeProdutos.textContent = cfg.nome;
}
async function setDataOperacionalCaixa(novaData){
  dataCaixa = normalizaDataLocal(novaData);
  atualizarDatasCaixa();
}
function atualizarLojaCaixaUI(){
  const slug = lojaCaixaAtiva?.loteria_slug || lojaCaixaAtiva?.slug || 'centro';
  aplicarTemaCaixa(slug);
}

function siglaLoja(loja){
  const id = Number(loja?.loteria_id || loja?.id || 0);
  const lojaBase = lojasAtivas.find(l => Number(l.id) === id);

  const codigo = String(
    loja?.loteria_codigo ||
    loja?.codigo ||
    lojaBase?.codigo ||
    ''
  ).trim();

  if (codigo) return codigo.toUpperCase();

  const nome = String(
    loja?.loteria_nome ||
    loja?.nome ||
    lojaBase?.nome ||
    ''
  ).trim();

  return nome.slice(0, 3).toUpperCase() || '—';
}

function getIndiceLojaCaixaAtual(){
  if (!lojasPermitidas.length || !lojaCaixaAtiva) return -1;
  return lojasPermitidas.findIndex(l => Number(l.loteria_id) === Number(lojaCaixaAtiva.loteria_id));
}

async function trocarLojaCaixaPorOffset(offset){
  if (!lojasPermitidas.length) return;

  let idx = getIndiceLojaCaixaAtual();
  if (idx < 0) idx = 0;

  let prox = idx + offset;
  if (prox < 0) prox = lojasPermitidas.length - 1;
  if (prox >= lojasPermitidas.length) prox = 0;

  await trocarLojaCaixa(lojasPermitidas[prox]);
}

async function trocarLojaCaixa(loja){
  if (!loja) return;

  lojaCaixaAtiva = loja;
  atualizarLojaCaixaUI();
  limparBolaoSelecionadoCaixa();
  federalSelecionadaCaixa = null;
  fecharPainelVendaFederal();

  await buscarBoloesCaixa();
  if ($('tab-federal')?.classList.contains('active')) {
  await buscarFederaisCaixa();
}
produtoSelecionadoCaixa = null;
fecharPainelVendaProduto();

if ($('tab-produtos')?.classList.contains('active')) {
  await buscarProdutosCaixa();
}
  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

async function carregarContextoLojas(){
  const { data: todas, error: erroLojas } = await sb
    .from('loterias')
    .select('id,nome,slug,codigo')
    .eq('ativo', true)
    .order('id');

  if (erroLojas) throw erroLojas;

  lojasAtivas = todas || [];

  const { data: vinculos, error: erroVinculos } = await sb
    .from('usuarios_loterias')
    .select('loteria_id,principal,ativo')
    .eq('usuario_id', usuario.id)
    .eq('ativo', true);

  if (erroVinculos) throw erroVinculos;

  const idsPermitidos = new Set((vinculos || []).map(v => Number(v.loteria_id)));

  lojasPermitidas = lojasAtivas
    .filter(l => idsPermitidos.has(Number(l.id)))
    .map(l => ({
      loteria_id: l.id,
      loteria_nome: l.nome,
      loteria_slug: l.slug,
      loteria_codigo: l.codigo,
      principal: !!(vinculos || []).find(v => Number(v.loteria_id) === Number(l.id) && v.principal)
    }));

  // Fallback para ADMIN/SOCIO quando não houver vínculo explícito.
  if (!lojasPermitidas.length && ['ADMIN','SOCIO'].includes(String(usuario.perfil || '').toUpperCase())) {
    lojasPermitidas = lojasAtivas.map(l => ({
      loteria_id: l.id,
      loteria_nome: l.nome,
      loteria_slug: l.slug,
      loteria_codigo: l.codigo,
      principal: l.slug === 'centro'
    }));
  }

  lojaCaixaAtiva = lojasPermitidas.find(l => l.principal) || lojasPermitidas[0] || null;

  if (!lojaCaixaAtiva) {
    throw new Error('Nenhuma loja disponível para este usuário.');
  }

  atualizarLojaCaixaUI();
}

// ── Relógio ───────────────────────────────────────────────────────
function updateClock(){
  const now = new Date();
  const el = $('relogio');

  if (el) {
    el.textContent =
      now.toLocaleTimeString('pt-BR', {
        timeZone: TZ_SISLOT
      }) +
      ' — ' +
      now.toLocaleDateString('pt-BR', {
        timeZone: TZ_SISLOT,
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
  }
}

updateClock();
setInterval(updateClock, 1000);
// ── Status ────────────────────────────────────────────────────────
function setStatusCaixa(msg, tipo='info'){
  const e = $('statusBarCaixa');
  if (!e) return;

  e.textContent = msg;
  e.className = 'status-bar show ' + tipo;
}

function clearStatusCaixa(){
  const e = $('statusBarCaixa');
  if (!e) return;

  e.textContent = '';
  e.className = 'status-bar';
}

// ── Tabs ──────────────────────────────────────────────────────────
async function switchTab(id){
  const abas = ['boloes', 'federal', 'produtos', 'consolidado'];

  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', abas[i] === id);
  });

  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.remove('active');
  });

  const pane = $('tab-' + id);
  if (pane) pane.classList.add('active');

  if (id === 'boloes') {
    await buscarBoloesCaixa();
  }

  if (id === 'federal') {
  await buscarFederaisCaixa();
}
  if (id === 'produtos') {
  await buscarProdutosCaixa();
}
  if (id === 'consolidado') {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

// Deixa as funções acessíveis para onclick no HTML
window.switchTab = switchTab;

// ── Datas ─────────────────────────────────────────────────────────
function atualizarDatasCaixa(){
  dataCaixa = normalizaDataLocal(dataCaixa);
  const iso = isoDate(dataCaixa);

  const displayCaixa = $('dateDisplayCaixa');
  const pickerCaixa = $('datePickerCaixa');
  const displayFederal = $('dateDisplayFederal');
  const pickerFederal = $('datePickerFederal');
  const displayProdutos = $('dateDisplayProdutos');
  const pickerProdutos = $('datePickerProdutos');

if (displayFederal) displayFederal.textContent = fmtData(dataCaixa);
if (pickerFederal) pickerFederal.value = iso;
  
if (displayProdutos) displayProdutos.textContent = fmtData(dataCaixa);
if (pickerProdutos) pickerProdutos.value = iso;
  
  if (displayCaixa) displayCaixa.textContent = fmtData(dataCaixa);
  if (pickerCaixa) pickerCaixa.value = iso;
}

async function alterarDataCaixa(deltaDias){
  const d = normalizaDataLocal(dataCaixa);
  d.setDate(d.getDate() + deltaDias);
  dataCaixa = d;

  atualizarDatasCaixa();
  await buscarBoloesCaixa();
}

async function setDataCaixaPorISO(iso){
  dataCaixa = dataFromISO(iso);
  atualizarDatasCaixa();
  await buscarBoloesCaixa();
}

function getSaldoFederal(f){
  return Number(f?.estoque_atual || 0);
}

async function buscarFederaisCaixa(){
  const lista = $('federaisCaixaLista');
  if (!lista) return;

  federalSelecionadaCaixa = null;

fecharPainelVendaFederal();

  lista.innerHTML = `
    <div class="state-box" style="padding:24px">
      <div class="spinner"></div>
      <div class="state-title">Buscando Federais…</div>
    </div>
  `;

  if (!lojaCaixaAtiva?.loteria_id) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhuma loja selecionada</div>
        <div class="state-sub">Selecione a loja do caixa para carregar Federal.</div>
      </div>
    `;
    return;
  }

  const { data, error } = await sb
    .from('view_posicao_federal_loja')
    .select('*')
    .eq('loteria_id', lojaCaixaAtiva.loteria_id)
    .gte('dt_sorteio', isoDate(dataCaixa))
    .gt('estoque_atual', 0)
    .order('dt_sorteio')
    .order('concurso');

  if (error) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Erro ao buscar Federal</div>
        <div class="state-sub">${error.message}</div>
      </div>
    `;
    return;
  }

  renderFederaisCaixa(data || []);
}

function renderFederaisCaixa(rows){
  const lista = $('federaisCaixaLista');
  if (!lista) return;

  if (!rows.length) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhuma Federal disponível</div>
        <div class="state-sub">Não há saldo de Federal para ${lojaCaixaAtiva?.loteria_nome || 'esta loja'}.</div>
      </div>
    `;
    return;
  }

  const html = rows.map(f => `
    <div class="bolao-sel-card federal-sel-card" data-id="${f.federal_id}">
      <div class="bsc-main">
        <div class="bsc-header">
          <span class="bsc-modal">${f.modalidade || 'Federal'}</span>
          <span class="bsc-tag tag-concurso">#${f.concurso || '—'}</span>
          <span class="bsc-tag tag-origem-cotas">${f.loja_nome || lojaCaixaAtiva?.loteria_nome || '—'}</span>
        </div>

        <div class="bsc-tags">
          <span class="bsc-tag">${f.dt_sorteio ? fmtData(dataFromISO(f.dt_sorteio)) : 'sem data'}</span>
          <span class="bsc-tag">${fmtBRL(f.valor_fracao || 0)}</span>
          <span class="bsc-tag tag-canal-venda">Saldo ${getSaldoFederal(f)}</span>
        </div>
      </div>

      <div class="bsc-ind">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="2 6 5 9 10 3"/>
        </svg>
      </div>
    </div>
  `).join('');

  lista.innerHTML = `<div class="bolao-cards-grid">${html}</div>`;

  lista.querySelectorAll('.federal-sel-card').forEach(card => {
    card.onclick = () => {
      const fed = rows.find(x => String(x.federal_id) === String(card.dataset.id));
      selecionarFederalCaixa(fed, card);
    };
  });
}

function selecionarFederalCaixa(f, card){
  if (!f) return;

  document.querySelectorAll('.federal-sel-card').forEach(c => c.classList.remove('selected'));
  if (card) card.classList.add('selected');

  federalSelecionadaCaixa = f;

  const title = $('federalSaleTitle');
  if (title) {
    title.innerHTML = `
      <div class="wpp-sale-card-title">
        <span class="wpp-sale-main">${f.modalidade || 'Federal'}</span>
        <span class="wpp-sale-chip wpp-sale-chip-concurso">#${f.concurso || '—'}</span>
        <span class="wpp-sale-chip wpp-sale-chip-origem">${f.loja_nome || lojaCaixaAtiva?.loteria_nome || '—'}</span>
      </div>

      <div class="wpp-sale-card-meta">
        <span class="wpp-sale-chip">Saldo ${getSaldoFederal(f)}</span>
        <span class="wpp-sale-chip">${f.dt_sorteio ? fmtData(dataFromISO(f.dt_sorteio)) : 'sem data'}</span>
        <span class="wpp-sale-chip wpp-sale-chip-valor">${fmtBRL(f.valor_fracao || 0)}</span>
      </div>
    `;
  }

  if ($('inputQtdFederal')) $('inputQtdFederal').value = '1';

  if ($('inputValorFederal')) {
    $('inputValorFederal').value = Number(f.valor_fracao || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  abrirPainelVendaFederal();
  calcTotalFederalCaixa();
}

function abrirPainelVendaFederal(){
  const panel = $('federalVendaPanel');
  if (!panel) return;

  panel.style.display = '';
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wpp-sale-open');
}

function fecharPainelVendaFederal(){
  const panel = $('federalVendaPanel');
  if (!panel) return;

  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('wpp-sale-open');
}

function calcTotalFederalCaixa(){
  const qtd = parseInt($('inputQtdFederal')?.value || '0', 10) || 0;
  const val = parseBRL($('inputValorFederal')?.value || '0');
  const total = qtd * val;

  const el = $('totalVendaFederal');
  if (el) el.textContent = fmtBRL(total);
}

window.calcTotalFederalCaixa = calcTotalFederalCaixa;

async function registrarVendaFederalCaixa(){
  if (!federalSelecionadaCaixa) {
    setStatusCaixa('Selecione uma Federal.', 'err');
    return;
  }

  if (!lojaCaixaAtiva?.loteria_id) {
    setStatusCaixa('Nenhuma loja de caixa selecionada.', 'err');
    return;
  }

  const qtd = parseInt($('inputQtdFederal')?.value || '0', 10) || 0;

  if (qtd < 1) {
    setStatusCaixa('Qtd deve ser maior ou igual a 1.', 'err');
    return;
  }

  if (qtd > getSaldoFederal(federalSelecionadaCaixa)) {
    setStatusCaixa(
      `Saldo insuficiente. Disponível: ${getSaldoFederal(federalSelecionadaCaixa)}.`,
      'err'
    );
    return;
  }

  const btn = $('btnRegistrarFederal');
  if (btn) btn.disabled = true;

  setStatusCaixa(`Registrando Federal no caixa ${lojaCaixaAtiva.loteria_nome}…`, 'info');

  const { error } = await sb.rpc('rpc_registrar_venda_balcao_federal', {
    p_federal_id: federalSelecionadaCaixa.federal_id,
    p_loteria_vendedora_id: lojaCaixaAtiva.loteria_id,
    p_qtd_vendida: qtd,
    p_data_referencia: isoDate(dataCaixa)
  });

  if (btn) btn.disabled = false;

  if (error) {
    setStatusCaixa(error.message, 'err');
    return;
  }

  setStatusCaixa(`✓ Federal registrada no caixa ${lojaCaixaAtiva.loteria_nome}.`, 'ok');

  federalSelecionadaCaixa = null;

  fecharPainelVendaFederal();

  await buscarFederaisCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

window.registrarVendaFederalCaixa = registrarVendaFederalCaixa;

// ── Produtos: busca, seleção e registro ───────────────────────────
function getSaldoProduto(p){
  return Number(p?.saldo_atual || 0);
}

function setStatusProduto(msg, tipo='info'){
  const e = $('statusBarProdutos') || $('statusBarCaixa');
  if (!e) return;

  e.textContent = msg;
  e.className = 'status-bar show ' + tipo;
}

function clearStatusProduto(){
  const e = $('statusBarProdutos');
  if (!e) return;

  e.textContent = '';
  e.className = 'status-bar';
}

async function buscarProdutosCaixa(){
  const lista = $('produtosCaixaLista');
  if (!lista) return;

  produtoSelecionadoCaixa = null;
  fecharPainelVendaProduto();

  lista.innerHTML = `
    <div class="state-box" style="padding:24px">
      <div class="spinner"></div>
      <div class="state-title">Buscando produtos…</div>
    </div>
  `;

  if (!lojaCaixaAtiva?.loteria_id) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhuma loja selecionada</div>
        <div class="state-sub">Selecione a loja do caixa para carregar os produtos.</div>
      </div>
    `;
    return;
  }

  const { data, error } = await sb
    .from('view_produtos_saldo_loja')
    .select('*')
    .eq('loteria_id', lojaCaixaAtiva.loteria_id)
    .gt('saldo_atual', 0)
    .order('produto')
    .order('item_nome');

  if (error) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Erro ao buscar produtos</div>
        <div class="state-sub">${error.message}</div>
      </div>
    `;
    return;
  }

  renderProdutosCaixa(data || []);
}

function renderProdutosCaixa(rows){
  const lista = $('produtosCaixaLista');
  if (!lista) return;

  if (!rows.length) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhum produto com saldo</div>
        <div class="state-sub">Não há Raspadinha ou Telesena com saldo para ${lojaCaixaAtiva?.loteria_nome || 'esta loja'}.</div>
      </div>
    `;
    return;
  }

  const grupos = {};

  rows.forEach(p => {
    const k = p.produto || 'Produto';
    if (!grupos[k]) grupos[k] = [];
    grupos[k].push(p);
  });

  let html = '';

  Object.keys(grupos).sort().forEach(tipo => {
    html += `
      <div class="sec-sep" style="margin:8px 0 6px">
        <div class="sec-sep-label">${tipo}</div>
        <div class="sec-sep-line"></div>
      </div>
    `;

    html += grupos[tipo].map((p, idx) => {
      const key = `${tipo}-${idx}-${p.raspadinha_id || p.telesena_item_id || 0}`;

      return `
        <div class="bolao-sel-card produto-sel-card" data-key="${key}">
          <div class="bsc-main">
            <div class="bsc-header">
              <span class="bsc-modal">${p.item_nome || p.produto || 'Produto'}</span>
              <span class="bsc-tag tag-concurso">${p.produto || '—'}</span>
              <span class="bsc-tag tag-origem-cotas">${p.campanha_nome || '—'}</span>
            </div>

            <div class="bsc-tags">
              <span class="bsc-tag">${fmtBRL(p.valor_venda || 0)}</span>
              <span class="bsc-tag tag-canal-venda">Saldo ${getSaldoProduto(p)}</span>
            </div>
          </div>

          <div class="bsc-ind">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="2 6 5 9 10 3"/>
            </svg>
          </div>
        </div>
      `;
    }).join('');
  });

  lista.innerHTML = `<div class="bolao-cards-grid">${html}</div>`;

  const flatRows = [];
  Object.keys(grupos).sort().forEach(tipo => {
    grupos[tipo].forEach((p, idx) => {
      flatRows.push({
        key: `${tipo}-${idx}-${p.raspadinha_id || p.telesena_item_id || 0}`,
        data: p
      });
    });
  });

  lista.querySelectorAll('.produto-sel-card').forEach(card => {
    card.onclick = () => {
      const item = flatRows.find(x => x.key === card.dataset.key);
      selecionarProdutoCaixa(item?.data, card);
    };
  });
}

function selecionarProdutoCaixa(p, card){
  if (!p) return;

  document.querySelectorAll('.produto-sel-card').forEach(c => c.classList.remove('selected'));
  if (card) card.classList.add('selected');

  produtoSelecionadoCaixa = p;

  const title = $('produtoSaleTitle');
  if (title) {
    title.innerHTML = `
      <div class="wpp-sale-card-title">
        <span class="wpp-sale-main">${p.item_nome || p.produto || 'Produto'}</span>
        <span class="wpp-sale-chip wpp-sale-chip-concurso">${p.produto || '—'}</span>
        <span class="wpp-sale-chip wpp-sale-chip-origem">${p.campanha_nome || '—'}</span>
      </div>

      <div class="wpp-sale-card-meta">
        <span class="wpp-sale-chip">Saldo ${getSaldoProduto(p)}</span>
        <span class="wpp-sale-chip wpp-sale-chip-valor">${fmtBRL(p.valor_venda || 0)}</span>
      </div>
    `;
  }

  if ($('inputQtdProduto')) $('inputQtdProduto').value = '1';

  if ($('inputValorProduto')) {
    $('inputValorProduto').value = Number(p.valor_venda || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  abrirPainelVendaProduto();
  calcTotalProdutoCaixa();
  clearStatusProduto();
}

function abrirPainelVendaProduto(){
  const panel = $('produtoVendaPanel');
  if (!panel) return;

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wpp-sale-open');
}

function fecharPainelVendaProduto(){
  const panel = $('produtoVendaPanel');
  if (!panel) return;

  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('wpp-sale-open');
}

function calcTotalProdutoCaixa(){
  const qtd = parseInt($('inputQtdProduto')?.value || '0', 10) || 0;
  const val = parseBRL($('inputValorProduto')?.value || '0');
  const total = qtd * val;

  const el = $('totalVendaProduto');
  if (el) el.textContent = fmtBRL(total);
}

window.calcTotalProdutoCaixa = calcTotalProdutoCaixa;

async function registrarVendaProdutoCaixa(){
  if (!produtoSelecionadoCaixa) {
    setStatusProduto('Selecione um produto.', 'err');
    return;
  }

  if (!lojaCaixaAtiva?.loteria_id) {
    setStatusProduto('Nenhuma loja de caixa selecionada.', 'err');
    return;
  }

  const qtd = parseInt($('inputQtdProduto')?.value || '0', 10) || 0;

  if (qtd < 1) {
    setStatusProduto('Qtd deve ser maior ou igual a 1.', 'err');
    return;
  }

  if (qtd > getSaldoProduto(produtoSelecionadoCaixa)) {
    setStatusProduto(
      `Saldo insuficiente. Disponível: ${getSaldoProduto(produtoSelecionadoCaixa)}.`,
      'err'
    );
    return;
  }

  const btn = $('btnRegistrarProduto');
  if (btn) btn.disabled = true;

  setStatusProduto(`Registrando produto no caixa ${lojaCaixaAtiva.loteria_nome}…`, 'info');

  const { error } = await sb.rpc('rpc_registrar_venda_balcao_produto', {
    p_produto: produtoSelecionadoCaixa.produto,
    p_raspadinha_id: produtoSelecionadoCaixa.raspadinha_id,
    p_telesena_item_id: produtoSelecionadoCaixa.telesena_item_id,
    p_loteria_vendedora_id: lojaCaixaAtiva.loteria_id,
    p_qtd_vendida: qtd,
    p_data_referencia: isoDate(dataCaixa)
  });

  if (btn) btn.disabled = false;

  if (error) {
    setStatusProduto(error.message, 'err');
    return;
  }

  setStatusProduto(`✓ Produto registrado no caixa ${lojaCaixaAtiva.loteria_nome}.`, 'ok');

  produtoSelecionadoCaixa = null;
  fecharPainelVendaProduto();

  await buscarProdutosCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

window.registrarVendaProdutoCaixa = registrarVendaProdutoCaixa;

// ── Consolidado mensal: mês + dias ────────────────────────────────
function atualizarTituloMesCaixa(){
  const el = $('cxMesTitle');
  if (!el) return;

  const d = normalizaDataLocal(dataConsolidadoCaixa);
  el.textContent = `${MESES_PT[d.getMonth()]} / ${d.getFullYear()}`;
}

async function carregarResumoMensalCaixa(){
  resumoDiasCaixa = {};

  if (!lojaCaixaAtiva?.loteria_id) {
    gerarAbasDiasCaixa();
    return;
  }

  const base = normalizaDataLocal(
    typeof dataConsolidadoCaixa !== 'undefined' ? dataConsolidadoCaixa : dataCaixa
  );

  const ano = base.getFullYear();
  const mes = base.getMonth();

  const dataIni = isoDate(new Date(ano, mes, 1));
  const dataFim = isoDate(new Date(ano, mes + 1, 0));
  const lojaId = lojaCaixaAtiva.loteria_id;

  const [boloesRes, federalRes, produtosRes] = await Promise.all([
    sb
      .from('view_caixa_vendas_boloes_grupo')
      .select('data_referencia,qtd_vendida,valor_total')
      .eq('loteria_vendedora_id', lojaId)
      .gte('data_referencia', dataIni)
      .lte('data_referencia', dataFim),

    sb
      .from('view_caixa_vendas_federal_grupo')
      .select('data_referencia,qtd_vendida,valor_total')
      .eq('loteria_vendedora_id', lojaId)
      .gte('data_referencia', dataIni)
      .lte('data_referencia', dataFim),

    sb
      .from('view_caixa_vendas_produtos_grupo')
      .select('data_referencia,qtd_vendida,valor_total')
      .eq('loteria_vendedora_id', lojaId)
      .gte('data_referencia', dataIni)
      .lte('data_referencia', dataFim)
  ]);

  const error = boloesRes.error || federalRes.error || produtosRes.error;

  if (error) {
    console.warn('Erro ao carregar resumo mensal do caixa:', error.message);
    gerarAbasDiasCaixa();
    return;
  }

  function addResumo(rows, campoValor){
    (rows || []).forEach(r => {
      const dia = parseInt(String(r.data_referencia).split('-')[2], 10);
      if (!dia) return;

      if (!resumoDiasCaixa[dia]) {
        resumoDiasCaixa[dia] = {
          total_boloes: 0,
          total_federal: 0,
          total_produtos: 0
        };
      }

      resumoDiasCaixa[dia][campoValor] += Number(r.valor_total || 0);
    });
  }

  addResumo(boloesRes.data, 'total_boloes');
  addResumo(federalRes.data, 'total_federal');
  addResumo(produtosRes.data, 'total_produtos');

  gerarAbasDiasCaixa();
}

function gerarAbasDiasCaixa(){
  const container = $('cxDiasScroll');
  if (!container) return;

  const DIAS_SEMANA = ['D','S','T','Q','Q','S','S'];

  const base = normalizaDataLocal(dataConsolidadoCaixa);
  const ano = base.getFullYear();
  const mes = base.getMonth();

  const totalDias = new Date(ano, mes + 1, 0).getDate();

  const hoje = hojeLocal();
  const ehMesAtual =
    hoje.getFullYear() === ano &&
    hoje.getMonth() === mes;

  const diaAtivo = base.getDate();

  container.innerHTML = '';

  for (let d = 1; d <= totalDias; d++) {
    const data = new Date(ano, mes, d);
    const dow = data.getDay();

    const resumo = resumoDiasCaixa[d] || null;
    const totalDia =
      Number(resumo?.total_boloes || 0) +
      Number(resumo?.total_federal || 0) +
      Number(resumo?.total_produtos || 0);

    const temDados = totalDia > 0;
    const ehHoje = ehMesAtual && d === hoje.getDate();
    const ehAtivo = d === diaAtivo;
    const ehFds = dow === 0 || dow === 6;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = [
      'cx-dia-tab',
      temDados ? 'tem-dados' : 'sem-dados',
      ehHoje ? 'hoje' : '',
      ehAtivo ? 'ativo' : '',
      ehFds ? 'fds' : ''
    ].filter(Boolean).join(' ');

    btn.dataset.dia = String(d);

    btn.title = temDados
      ? `${String(d).padStart(2,'0')} · ${fmtBRL(totalDia)}`
      : `${String(d).padStart(2,'0')} · sem vendas`;

    btn.innerHTML = `
      <span class="cx-dia-num">${String(d).padStart(2,'0')}</span>
      <span class="cx-dia-dow">${DIAS_SEMANA[dow]}</span>
      <span class="cx-dia-dot"></span>
    `;

    btn.onclick = async () => {
      dataConsolidadoCaixa = new Date(ano, mes, d);

      gerarAbasDiasCaixa();
      await carregarConsolidadoCaixa();

      btn.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest'
      });
    };

    container.appendChild(btn);
  }

  atualizarTituloMesCaixa();

  setTimeout(() => {
    const ativo = container.querySelector('.cx-dia-tab.ativo');
    if (ativo) {
      ativo.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest'
      });
    }
  }, 80);
}

async function alterarMesConsolidadoCaixa(delta){
  const d = normalizaDataLocal(dataConsolidadoCaixa);
  d.setMonth(d.getMonth() + delta);
  d.setDate(1);

  dataConsolidadoCaixa = d;

  atualizarTituloMesCaixa();
  await carregarResumoMensalCaixa();
  await carregarConsolidadoCaixa();
}

async function irHojeConsolidadoCaixa(){
  dataConsolidadoCaixa = hojeLocal();

  atualizarTituloMesCaixa();
  await carregarResumoMensalCaixa();
  await carregarConsolidadoCaixa();
}

// ── Bolões: busca, seleção e registro ─────────────────────────────
function getSaldoContextoBolao(b){
  const lojaId = Number(lojaCaixaAtiva?.loteria_id || 0);
  const saldo = (b?.saldos_lojas || []).find(s => Number(s.loteria_id) === lojaId);
  return Number(saldo?.saldo_real || 0);
}

function normalizarBoloesCaixa(rows){
  const mapa = {};

  (rows || []).forEach(r => {
    const id = Number(r.bolao_id || r.id || 0);
    if (!id) return;

    if (!mapa[id]) {
      mapa[id] = {
        id,
        modalidade: r.modalidade,
        concurso: r.concurso,
        dt_inicial: r.dt_inicial,
        dt_concurso: r.dt_concurso,
        valor_cota: Number(r.valor_cota || 0),
        qtd_jogos: Number(r.qtd_jogos || 0),
        qtd_dezenas: Number(r.qtd_dezenas || 0),
        qtd_cotas_total: Number(r.qtd_cotas_total || 0),
        loteria_origem_id: Number(r.loteria_origem_id || 0),
        loteria_origem_nome: r.loteria_origem_nome || '—',
        loteria_origem_slug: r.loteria_origem_slug || '',
        saldos_lojas: []
      };
    }

    mapa[id].saldos_lojas.push({
      loteria_id: Number(r.loteria_id),
      loteria_nome: r.loteria_nome,
      loteria_slug: r.loteria_slug,
      loteria_codigo: r.loteria_codigo,
      qtd_cotas_posicao: Number(r.qtd_cotas_posicao || 0),
      qtd_vendida_loja: Number(r.qtd_vendida_loja || 0),
      saldo_real: Number(r.saldo_real || 0)
    });
  });

  return Object.values(mapa).filter(b => getSaldoContextoBolao(b) > 0);
}

async function buscarBoloesCaixa(){
  const lista = $('boloesCaixaLista');
  if (!lista) return;

  limparBolaoSelecionadoCaixa();

  lista.innerHTML = `
    <div class="state-box" style="padding:24px">
      <div class="spinner"></div>
      <div class="state-title">Buscando bolões…</div>
    </div>
  `;

  if (!lojaCaixaAtiva?.loteria_id) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhuma loja selecionada</div>
        <div class="state-sub">Selecione a loja do caixa para carregar os bolões.</div>
      </div>
    `;
    return;
  }

  const { data: rows, error } = await sb.rpc('fn_wpp_saldo_boloes_lojas', {
    p_loteria_contexto_id: lojaCaixaAtiva.loteria_id,
    p_data_ref: isoDate(dataCaixa)
  });

  if (error) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Erro ao buscar bolões</div>
        <div class="state-sub">${error.message}</div>
      </div>
    `;
    return;
  }

  const boloes = normalizarBoloesCaixa(rows || []);

  if (!boloes.length) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhum bolão com saldo</div>
        <div class="state-sub">Não há saldo disponível no caixa ${lojaCaixaAtiva.loteria_nome} em ${fmtData(dataCaixa)}.</div>
      </div>
    `;
    return;
  }

  renderBoloesCaixa(boloes);
}

function renderBoloesCaixa(boloes){
  const alvo = $('boloesCaixaLista');
  if (!alvo) return;

  const wrap = document.createElement('div');
  wrap.className = 'bolao-cards-grid';

  const grupos = {};

  boloes.forEach(b => {
    if (!grupos[b.modalidade]) grupos[b.modalidade] = [];
    grupos[b.modalidade].push(b);
  });

  Object.keys(grupos)
  .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'))
  .forEach(mod => {
    const sep = document.createElement('div');
    sep.className = 'sec-sep';
    sep.style.margin = '8px 0 6px';
    sep.innerHTML = `
      <div class="sec-sep-label">${mod}</div>
      <div class="sec-sep-line"></div>
    `;
    wrap.appendChild(sep);

    grupos[mod]
  .sort((a, b) => {
    const precoA = Number(a.valor_cota || 0);
    const precoB = Number(b.valor_cota || 0);

    if (precoA !== precoB) {
      return precoA - precoB;
    }

    const concursoA = Number(a.concurso || 0);
    const concursoB = Number(b.concurso || 0);

    if (concursoA !== concursoB) {
      return concursoA - concursoB;
    }

    return String(a.loteria_origem_nome || '')
      .localeCompare(String(b.loteria_origem_nome || ''), 'pt-BR');
  })
      .forEach(b => {

        const saldoPills = (b.saldos_lojas || []).map(s => {
          const saldo = Number(s.saldo_real || 0);
          const ehContexto = Number(s.loteria_id) === Number(lojaCaixaAtiva?.loteria_id);

          return `
            <span class="saldo-pill ${ehContexto ? 'contexto' : ''} ${saldo <= 0 ? 'zero' : ''}" title="${s.loteria_nome || ''}">
              <span class="sp-loja">${siglaLoja(s)}</span>
              <span class="sp-val">${saldo}</span>
            </span>
          `;
        }).join('');

        const card = document.createElement('div');
        card.className = 'bolao-sel-card';
        card.dataset.id = b.id;

        card.innerHTML = `
          <div class="bsc-main">
            <div class="bsc-header">
              <span class="bsc-modal">${b.modalidade}</span>
              <span class="bsc-tag tag-concurso">#${b.concurso}</span>
              <span class="bsc-tag tag-origem-cotas">${b.loteria_origem_nome || '—'}</span>
            </div>

            <div class="bsc-tags">
              <span class="bsc-tag">${b.qtd_jogos} jogos</span>
              <span class="bsc-tag">${b.qtd_dezenas} dez.</span>
              <span class="bsc-tag">${b.qtd_cotas_total} cotas</span>
              <span class="bsc-tag" style="color:#f5a623">${fmtBRL(b.valor_cota)}</span>
            </div>

            <div class="bsc-saldos">${saldoPills}</div>
          </div>

          <div class="bsc-ind">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="2 6 5 9 10 3"/>
            </svg>
          </div>
        `;

        card.onclick = () => selecionarBolaoCaixa(b, card);
        wrap.appendChild(card);
      });
  });

  alvo.innerHTML = '';
  alvo.appendChild(wrap);
}

function selecionarBolaoCaixa(b, card){
  document.querySelectorAll('.bolao-sel-card').forEach(c => c.classList.remove('selected'));
  if (card) card.classList.add('selected');

  bolaoSelecionadoCaixa = b;

  const valor = $('inputValorCaixa');
  const qtd = $('inputQtdCaixa');

  if (valor) {
    valor.value = Number(b.valor_cota).toLocaleString('pt-BR', {
      minimumFractionDigits:2,
      maximumFractionDigits:2
    });
  }

  if (qtd) qtd.value = '1';

  renderResumoBolaoSelecionadoCaixa(b);
  abrirPainelVendaCaixa(b);
  calcTotalCaixa();
  clearStatusCaixa();
}

function renderResumoBolaoSelecionadoCaixa(b){
  const panel = $('caixaSelectedPanel');
  if (!panel || !b) return;

  const title = $('caixaSelectedTitle');
  if (title) title.textContent = `${b.modalidade} #${b.concurso}`;

  const tags = $('caixaSelectedTags');
  if (tags) {
    tags.innerHTML = `
      <span class="wpp-tag accent">Caixa: ${lojaCaixaAtiva?.loteria_nome || '—'}</span>
      <span class="wpp-tag">Origem: ${b.loteria_origem_nome || '—'}</span>
      <span class="wpp-tag">${b.qtd_jogos} jogos</span>
      <span class="wpp-tag">${b.qtd_dezenas} dezenas</span>
      <span class="wpp-tag">${b.qtd_cotas_total} cotas</span>
      <span class="wpp-tag amber">${fmtBRL(b.valor_cota)}</span>
    `;
  }

  const grid = $('caixaSaldoGrid');
  if (grid) {
    grid.innerHTML = (b.saldos_lojas || []).map(s => {
      const saldo = Number(s.saldo_real || 0);
      const contexto = Number(s.loteria_id) === Number(lojaCaixaAtiva?.loteria_id);

      return `
        <div class="wpp-saldo-item ${contexto ? 'contexto' : ''} ${saldo <= 0 ? 'zero' : ''}">
          <div class="wpp-saldo-loja" title="${s.loteria_nome || ''}">${siglaLoja(s)}</div>
          <div class="wpp-saldo-val">${saldo}</div>
        </div>
      `;
    }).join('');
  }

  panel.style.display = 'block';
}

function abrirPainelVendaCaixa(b){
  const panel = $('caixaSalePanel');
  if (!panel || !b) return;

  const title = $('caixaSaleTitle');
  if (title) {
    title.innerHTML = `
      <div class="wpp-sale-card-title">
        <span class="wpp-sale-main">${b.modalidade}</span>
        <span class="wpp-sale-chip wpp-sale-chip-concurso">#${b.concurso}</span>
        <span class="wpp-sale-chip wpp-sale-chip-origem">${b.loteria_origem_nome || '—'}</span>
      </div>

      <div class="wpp-sale-card-meta">
        <span class="wpp-sale-chip">${b.qtd_jogos} jogos</span>
        <span class="wpp-sale-chip">${b.qtd_dezenas} dez.</span>
        <span class="wpp-sale-chip">${b.qtd_cotas_total} cotas</span>
        <span class="wpp-sale-chip wpp-sale-chip-valor">${fmtBRL(b.valor_cota)}</span>
      </div>
    `;
  }

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wpp-sale-open');
}

function fecharPainelVendaCaixa(){
  const panel = $('caixaSalePanel');
  if (!panel) return;

  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('wpp-sale-open');
}

function limparBolaoSelecionadoCaixa(){
  bolaoSelecionadoCaixa = null;

  document.querySelectorAll('.bolao-sel-card').forEach(c => c.classList.remove('selected'));

  if ($('inputValorCaixa')) $('inputValorCaixa').value = '';
  if ($('inputQtdCaixa')) $('inputQtdCaixa').value = '1';

  const panel = $('caixaSelectedPanel');
  if (panel) panel.style.display = 'none';

  fecharPainelVendaCaixa();
  calcTotalCaixa();
  clearStatusCaixa();
}

function calcTotalCaixa(){
  const qtd = parseInt($('inputQtdCaixa')?.value || '0', 10) || 0;
  const val = parseBRL($('inputValorCaixa')?.value || '0');
  const total = qtd * val;

  const el = $('totalVendaCaixa');
  if (el) el.textContent = fmtBRL(total);
}

window.calcTotalCaixa = calcTotalCaixa;
function capturarScrollBoloesCaixa(){
  const lista = $('boloesCaixaLista');

  return {
    windowY: window.scrollY || 0,
    listaTop: lista ? lista.scrollTop : 0
  };
}

function restaurarScrollBoloesCaixa(pos){
  if (!pos) return;

  requestAnimationFrame(() => {
    window.scrollTo({
      top: pos.windowY || 0,
      left: 0,
      behavior: 'auto'
    });

    const lista = $('boloesCaixaLista');
    if (lista) {
      lista.scrollTop = pos.listaTop || 0;
    }
  });
}
async function registrarVendaBolaoCaixa(){
  if (!bolaoSelecionadoCaixa) {
    setStatusCaixa('Selecione um bolão.', 'err');
    return;
  }

  if (!lojaCaixaAtiva?.loteria_id) {
    setStatusCaixa('Nenhuma loja de caixa selecionada.', 'err');
    return;
  }

  const qtd = parseInt($('inputQtdCaixa')?.value || '0', 10) || 0;
  const val = parseBRL($('inputValorCaixa')?.value || '0');

  if (qtd < 1) {
    setStatusCaixa('Qtd deve ser maior ou igual a 1.', 'err');
    return;
  }

  if (val <= 0) {
    setStatusCaixa('Valor deve ser maior que zero.', 'err');
    return;
  }

  const saldoContexto = getSaldoContextoBolao(bolaoSelecionadoCaixa);

  if (saldoContexto < qtd) {
    setStatusCaixa(
      `Saldo insuficiente no caixa ${lojaCaixaAtiva.loteria_nome}. Disponível: ${saldoContexto}.`,
      'err'
    );
    return;
  }

  const btn = $('btnRegistrarCaixa');
  if (btn) btn.disabled = true;

  setStatusCaixa(`Registrando venda no caixa ${lojaCaixaAtiva.loteria_nome}…`, 'info');

  const { error } = await sb.rpc('rpc_registrar_venda_balcao_bolao', {
    p_bolao_id: bolaoSelecionadoCaixa.id,
    p_loteria_vendedora_id: lojaCaixaAtiva.loteria_id,
    p_qtd_vendida: qtd,
    p_data_referencia: isoDate(dataCaixa)
  });

  if (btn) btn.disabled = false;

  if (error) {
    setStatusCaixa(error.message, 'err');
    return;
  }

const posScroll = capturarScrollBoloesCaixa();

if ($('inputQtdCaixa')) $('inputQtdCaixa').value = '1';

fecharPainelVendaCaixa();
calcTotalCaixa();

await buscarBoloesCaixa();

restaurarScrollBoloesCaixa(posScroll);

if ($('tab-consolidado')?.classList.contains('active')) {
  await carregarResumoMensalCaixa();
  await carregarConsolidadoCaixa();
}

setStatusCaixa(
  `✓ Venda registrada no caixa ${lojaCaixaAtiva.loteria_nome}.`,
  'ok'
);
}

window.registrarVendaBolaoCaixa = registrarVendaBolaoCaixa;

async function deletarVendaBalcaoBolao(id){
  const ok = await confirmar(
    'Remover venda',
    'Tem certeza que deseja remover esta venda de balcão?'
  );

  if (!ok) return;

  const { error } = await sb.rpc('rpc_excluir_venda_balcao_bolao', {
    p_bolao_venda_id: id
  });

  if (error) {
    alert('Erro ao excluir venda: ' + error.message);
    return;
  }

  await buscarBoloesCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

window.deletarVendaBalcaoBolao = deletarVendaBalcaoBolao;

async function salvarQtdGrupoBalcaoBolao(bolaoId){
  const input = $('qtdGrupo-' + bolaoId);
  if (!input) return;

  const novaQtd = parseInt(input.value || '0', 10) || 0;

  if (novaQtd <= 0) {
    alert('A quantidade deve ser maior que zero.');
    return;
  }

  const { error } = await sb.rpc('rpc_editar_qtd_venda_balcao_bolao_grupo', {
    p_bolao_id: bolaoId,
    p_loteria_vendedora_id: lojaCaixaAtiva.loteria_id,
    p_data_referencia: isoDate(typeof dataConsolidadoCaixa !== 'undefined' ? dataConsolidadoCaixa : dataCaixa),
    p_nova_qtd: novaQtd
  });

  if (error) {
    alert(error.message);
    await carregarConsolidadoCaixa();
    return;
  }

  await buscarBoloesCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

window.salvarQtdGrupoBalcaoBolao = salvarQtdGrupoBalcaoBolao;

async function excluirGrupoBalcaoBolao(bolaoId){
  const ok = await confirmar(
    'Excluir bolão do consolidado',
    'Tem certeza que deseja excluir todas as vendas deste bolão neste dia?'
  );

  if (!ok) return;

  const { error } = await sb.rpc('rpc_excluir_venda_balcao_bolao_grupo', {
    p_bolao_id: bolaoId,
    p_loteria_vendedora_id: lojaCaixaAtiva.loteria_id,
    p_data_referencia: isoDate(dataConsolidadoCaixa)
  });

  if (error) {
    alert(error.message);
    return;
  }

  await buscarBoloesCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

window.excluirGrupoBalcaoBolao = excluirGrupoBalcaoBolao;

async function salvarQtdGrupoBalcaoFederal(federalId){
  const input = $('qtdFederal-' + federalId);
  if (!input) return;

  const novaQtd = parseInt(input.value || '0', 10) || 0;

  if (novaQtd <= 0) {
    alert('A quantidade deve ser maior que zero.');
    return;
  }

  if (novaQtd > 999) {
    alert('A quantidade máxima permitida é 999.');
    input.value = '999';
    return;
  }

  const { error } = await sb.rpc('rpc_editar_qtd_venda_balcao_federal_grupo', {
    p_federal_id: federalId,
    p_loteria_vendedora_id: lojaCaixaAtiva.loteria_id,
    p_data_referencia: isoDate(typeof dataConsolidadoCaixa !== 'undefined' ? dataConsolidadoCaixa : dataCaixa),
    p_nova_qtd: novaQtd
  });

  if (error) {
    alert(error.message);
    await carregarConsolidadoCaixa();
    return;
  }

  await buscarFederaisCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

window.salvarQtdGrupoBalcaoFederal = salvarQtdGrupoBalcaoFederal;

async function excluirGrupoBalcaoFederal(federalId){
  const ok = await confirmar(
    'Excluir Federal do consolidado',
    'Tem certeza que deseja excluir todas as vendas desta Federal neste dia?'
  );

  if (!ok) return;

  const { error } = await sb.rpc('rpc_excluir_venda_balcao_federal_grupo', {
    p_federal_id: federalId,
    p_loteria_vendedora_id: lojaCaixaAtiva.loteria_id,
    p_data_referencia: isoDate(typeof dataConsolidadoCaixa !== 'undefined' ? dataConsolidadoCaixa : dataCaixa)
  });

  if (error) {
    alert(error.message);
    return;
  }

  await buscarFederaisCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

window.excluirGrupoBalcaoFederal = excluirGrupoBalcaoFederal;
function inputIdProdutoGrupo(produto, raspadinhaId, telesenaItemId){
  const rid = raspadinhaId === null || raspadinhaId === undefined ? 'null' : raspadinhaId;
  const tid = telesenaItemId === null || telesenaItemId === undefined ? 'null' : telesenaItemId;
  return `qtdProduto-${produto}-${rid}-${tid}`;
}

async function salvarQtdGrupoBalcaoProduto(produto, raspadinhaId, telesenaItemId){
  const input = $(inputIdProdutoGrupo(produto, raspadinhaId, telesenaItemId));
  if (!input) return;

  const novaQtd = parseInt(input.value || '0', 10) || 0;

  if (novaQtd <= 0) {
    alert('A quantidade deve ser maior que zero.');
    return;
  }

  if (novaQtd > 999) {
    alert('A quantidade máxima permitida é 999.');
    input.value = '999';
    return;
  }

  const { error } = await sb.rpc('rpc_editar_qtd_venda_balcao_produto_grupo', {
    p_produto: produto,
    p_raspadinha_id: raspadinhaId,
    p_telesena_item_id: telesenaItemId,
    p_loteria_vendedora_id: lojaCaixaAtiva.loteria_id,
    p_data_referencia: isoDate(typeof dataConsolidadoCaixa !== 'undefined' ? dataConsolidadoCaixa : dataCaixa),
    p_nova_qtd: novaQtd
  });

  if (error) {
    alert(error.message);
    await carregarConsolidadoCaixa();
    return;
  }

  await buscarProdutosCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

window.salvarQtdGrupoBalcaoProduto = salvarQtdGrupoBalcaoProduto;

async function excluirGrupoBalcaoProduto(produto, raspadinhaId, telesenaItemId){
  const ok = await confirmar(
    'Excluir produto do consolidado',
    'Tem certeza que deseja excluir todas as vendas deste produto neste dia?'
  );

  if (!ok) return;

  const { error } = await sb.rpc('rpc_excluir_venda_balcao_produto_grupo', {
    p_produto: produto,
    p_raspadinha_id: raspadinhaId,
    p_telesena_item_id: telesenaItemId,
    p_loteria_vendedora_id: lojaCaixaAtiva.loteria_id,
    p_data_referencia: isoDate(typeof dataConsolidadoCaixa !== 'undefined' ? dataConsolidadoCaixa : dataCaixa)
  });

  if (error) {
    alert(error.message);
    return;
  }

  await buscarProdutosCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
    await carregarResumoMensalCaixa();
    await carregarConsolidadoCaixa();
  }
}

window.excluirGrupoBalcaoProduto = excluirGrupoBalcaoProduto;

// ── Consolidado: renderização por setor ───────────────────────────
async function carregarConsolidadoCaixa(){
  const box = $('consolidadoContent');
  if (!box) return;

  const dataRef = isoDate(
    typeof dataConsolidadoCaixa !== 'undefined' ? dataConsolidadoCaixa : dataCaixa
  );

  box.innerHTML = `
    <div class="state-box">
      <div class="spinner"></div>
      <div class="state-title">Buscando consolidado…</div>
    </div>
  `;

  if (!lojaCaixaAtiva?.loteria_id) {
    box.innerHTML = `
      <div class="state-box">
        <div class="state-title">Nenhuma loja selecionada.</div>
        <div class="state-sub">Selecione a loja do caixa para carregar o consolidado.</div>
      </div>
    `;
    return;
  }

  const lojaId = lojaCaixaAtiva.loteria_id;

  const [boloesRes, federalRes, produtosRes] = await Promise.all([
    sb
      .from('view_caixa_vendas_boloes_grupo')
      .select('*')
      .eq('loteria_vendedora_id', lojaId)
      .eq('data_referencia', dataRef)
      .order('modalidade', { ascending: true })
      .order('valor_cota', { ascending: true })
      .order('concurso', { ascending: true }),

    sb
      .from('view_caixa_vendas_federal_grupo')
      .select('*')
      .eq('loteria_vendedora_id', lojaId)
      .eq('data_referencia', dataRef)
      .order('concurso'),

    sb
      .from('view_caixa_vendas_produtos_grupo')
      .select('*')
      .eq('loteria_vendedora_id', lojaId)
      .eq('data_referencia', dataRef)
      .order('produto')
  ]);

  const error = boloesRes.error || federalRes.error || produtosRes.error;

  if (error) {
    box.innerHTML = `
      <div class="state-box">
        <div class="state-title">Erro ao buscar consolidado</div>
        <div class="state-sub">${error.message}</div>
      </div>
    `;
    return;
  }

  renderConsolidadoCaixa({
    boloes: boloesRes.data || [],
    federais: federalRes.data || [],
    produtos: produtosRes.data || []
  }, dataRef);
}
function renderConsolidadoCaixa(payload, dataRef){
  const box = $('consolidadoContent');
  if (!box) return;

  const boloes = payload?.boloes || [];
  const federais = payload?.federais || [];
  const produtos = payload?.produtos || [];

  const totalBoloesQtd = boloes.reduce((s, r) => s + Number(r.qtd_vendida || 0), 0);
  const totalBoloesValor = boloes.reduce((s, r) => s + Number(r.valor_total || 0), 0);

  const totalFederalQtd = federais.reduce((s, r) => s + Number(r.qtd_vendida || 0), 0);
  const totalFederalValor = federais.reduce((s, r) => s + Number(r.valor_total || 0), 0);

  const totalProdutosQtd = produtos.reduce((s, r) => s + Number(r.qtd_vendida || 0), 0);
  const totalProdutosValor = produtos.reduce((s, r) => s + Number(r.valor_total || 0), 0);

  const totalGeral = totalBoloesValor + totalFederalValor + totalProdutosValor;

  const linhasBoloes = boloes.length
    ? boloes.map(r => `
      <div class="cx-det-row cx-det-row-editavel">
        <div class="cx-det-main">
          <strong>${r.modalidade || '—'}</strong>
          <span>#${r.concurso || '—'}</span>
          <small>${Number(r.qtd_jogos || 0)} jogos</small>
          <small>${Number(r.qtd_dezenas || 0)} dez.</small>
        </div>

        <div class="cx-det-meta">
          <span>Qtd</span>
          <input
            class="cx-qtd-edit"
            id="qtdGrupo-${r.bolao_id}"
            type="number"
            min="1"
            max="999"
            maxlength="3"
            inputmode="numeric"
            value="${Number(r.qtd_vendida || 0)}"
          />
          <span>${fmtBRL(r.valor_cota || 0)}</span>
        </div>

        <div class="cx-det-total">
          ${fmtBRL(r.valor_total || 0)}
        </div>

        <div class="cx-det-actions">
          <button
            type="button"
            class="cx-action-btn cx-action-save"
            onclick="salvarQtdGrupoBalcaoBolao(${r.bolao_id})"
            title="Salvar nova quantidade">
            <i class="fas fa-check"></i>
          </button>

          <button
            type="button"
            class="cx-action-btn cx-action-del"
            onclick="excluirGrupoBalcaoBolao(${r.bolao_id})"
            title="Excluir este bolão do dia">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('')
    : `<div class="cx-det-empty">Sem vendas de bolões no balcão nesta data.</div>`;

 const linhasFederal = federais.length
  ? federais.map(r => `
    <div class="cx-det-row cx-det-row-editavel">
      <div class="cx-det-main">
        <strong>${r.modalidade || 'Federal'}</strong>
        <span>#${r.concurso || '—'}</span>
        <small>${r.dt_sorteio ? fmtData(dataFromISO(r.dt_sorteio)) : '—'}</small>
      </div>

      <div class="cx-det-meta">
        <span>Qtd</span>
        <input
          class="cx-qtd-edit"
          id="qtdFederal-${r.federal_id}"
          type="number"
          min="1"
          max="999"
          maxlength="3"
          inputmode="numeric"
          value="${Number(r.qtd_vendida || 0)}"
        />
        <span>${fmtBRL(r.valor_unitario || r.valor_fracao || 0)}</span>
      </div>

      <div class="cx-det-total">
        ${fmtBRL(r.valor_total || 0)}
      </div>

      <div class="cx-det-actions">
        <button
          type="button"
          class="cx-action-btn cx-action-save"
          onclick="salvarQtdGrupoBalcaoFederal('${r.federal_id}')"
          title="Salvar nova quantidade">
          <i class="fas fa-check"></i>
        </button>

        <button
          type="button"
          class="cx-action-btn cx-action-del"
          onclick="excluirGrupoBalcaoFederal('${r.federal_id}')"
          title="Excluir esta Federal do dia">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('')
  : `<div class="cx-det-empty">Sem vendas de Federal no balcão nesta data.</div>`;

 const linhasProdutos = produtos.length
  ? produtos.map(r => {
    const rid = r.raspadinha_id === null || r.raspadinha_id === undefined ? 'null' : r.raspadinha_id;
    const tid = r.telesena_item_id === null || r.telesena_item_id === undefined ? 'null' : r.telesena_item_id;
    const inputId = `qtdProduto-${r.produto}-${rid}-${tid}`;

    return `
      <div class="cx-det-row cx-det-row-editavel">
        <div class="cx-det-main">
          <strong>${r.item_nome || r.produto || 'Produto'}</strong>
          <span>${r.produto || '—'}</span>
          ${r.campanha_nome ? `<small>${r.campanha_nome}</small>` : ''}
        </div>

        <div class="cx-det-meta">
          <span>Qtd</span>
          <input
            class="cx-qtd-edit"
            id="${inputId}"
            type="number"
            min="1"
            max="999"
            maxlength="3"
            inputmode="numeric"
            value="${Number(r.qtd_vendida || 0)}"
          />
          <span>${fmtBRL(r.valor_unitario || 0)}</span>
        </div>

        <div class="cx-det-total">
          ${fmtBRL(r.valor_total || 0)}
        </div>

        <div class="cx-det-actions">
          <button
            type="button"
            class="cx-action-btn cx-action-save"
            onclick="salvarQtdGrupoBalcaoProduto('${r.produto}', ${rid}, ${tid})"
            title="Salvar nova quantidade">
            <i class="fas fa-check"></i>
          </button>

          <button
            type="button"
            class="cx-action-btn cx-action-del"
            onclick="excluirGrupoBalcaoProduto('${r.produto}', ${rid}, ${tid})"
            title="Excluir este produto do dia">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('')
  : `<div class="cx-det-empty">Sem vendas de produtos no balcão nesta data.</div>`;
  
  box.innerHTML = `
    <div class="cx-fechamento-box fade-in">

      <div class="cx-fech-ident">
        <div>
          <div class="cx-fech-kicker">Consolidado do Caixa</div>
          <div class="cx-fech-title">${lojaCaixaAtiva?.loteria_nome || 'Loja'} · ${fmtData(dataFromISO(dataRef))}</div>
        </div>
      </div>

      <div class="cx-bloco">
        <div class="cx-bloco-titulo">Resumo do dia</div>

        <div class="cx-resumo-grid">
          <div class="cx-rg-card">
            <div class="cx-rg-label">Bolões</div>
            <div class="cx-rg-val cx-rg-green">${fmtBRL(totalBoloesValor)}</div>
            <div class="cx-rg-sub">${totalBoloesQtd} cota${totalBoloesQtd !== 1 ? 's' : ''}</div>
          </div>

          <div class="cx-rg-card">
            <div class="cx-rg-label">Federal</div>
            <div class="cx-rg-val cx-rg-purple">${fmtBRL(totalFederalValor)}</div>
            <div class="cx-rg-sub">${totalFederalQtd} fração${totalFederalQtd !== 1 ? 'ões' : ''}</div>
          </div>

          <div class="cx-rg-card">
            <div class="cx-rg-label">Produtos</div>
            <div class="cx-rg-val cx-rg-blue">${fmtBRL(totalProdutosValor)}</div>
            <div class="cx-rg-sub">${totalProdutosQtd} item${totalProdutosQtd !== 1 ? 's' : ''}</div>
          </div>

          <div class="cx-rg-card cx-rg-card-full cx-rg-total">
            <div class="cx-rg-label">Total Geral do Caixa</div>
            <div class="cx-rg-val cx-rg-main">${fmtBRL(totalGeral)}</div>
          </div>
        </div>
      </div>

      <div class="cx-bloco">
        <div class="cx-bloco-titulo">Detalhamento por setor</div>

        <div class="cx-setor-fech">
          <div class="cx-setor-head">
            <div>
              <span>Setor</span>
              <strong>Bolões</strong>
            </div>
            <em>${boloes.length} bolão${boloes.length !== 1 ? 'ões' : ''}</em>
          </div>

          <div class="cx-det-list">
            ${linhasBoloes}
          </div>

          <div class="cx-setor-total">
            <span>Total Bolões</span>
            <strong>${fmtBRL(totalBoloesValor)}</strong>
          </div>
        </div>

        <div class="cx-setor-fech">
          <div class="cx-setor-head">
            <div>
              <span>Setor</span>
              <strong>Federal</strong>
            </div>
            <em>${federais.length} concurso${federais.length !== 1 ? 's' : ''}</em>
          </div>

          <div class="cx-det-list">
            ${linhasFederal}
          </div>

          <div class="cx-setor-total">
            <span>Total Federal</span>
            <strong>${fmtBRL(totalFederalValor)}</strong>
          </div>
        </div>

        <div class="cx-setor-fech">
          <div class="cx-setor-head">
            <div>
              <span>Setor</span>
              <strong>Produtos</strong>
            </div>
            <em>${produtos.length} produto${produtos.length !== 1 ? 's' : ''}</em>
          </div>

          <div class="cx-det-list">
            ${linhasProdutos}
          </div>

          <div class="cx-setor-total">
            <span>Total Produtos</span>
            <strong>${fmtBRL(totalProdutosValor)}</strong>
          </div>
        </div>

      </div>

    </div>
  `;
}

window.carregarConsolidadoCaixa = carregarConsolidadoCaixa;

// ── Confirmação ──────────────────────────────────────────────────
function confirmar(titulo, corpo){
  const ov = $('confirmOverlay');
  const title = $('confirmTitle');
  const body = $('confirmBody');
  const no = $('confirmNo');
  const yes = $('confirmYes');

  if (!ov || !title || !body || !no || !yes) {
    return Promise.resolve(window.confirm(corpo || titulo || 'Confirmar?'));
  }

  return new Promise(resolve => {
    title.textContent = titulo || 'Confirmar';
    body.textContent = corpo || '';
    ov.classList.add('show');

    const cleanup = val => {
      ov.classList.remove('show');
      no.onclick = null;
      yes.onclick = null;
      resolve(val);
    };

    no.onclick = () => cleanup(false);
    yes.onclick = () => cleanup(true);
  });
}

let atalhosModalidadesCaixaAtivos = false;

const ATALHOS_MODALIDADES_CAIXA = {
  m: ['Mega Sena', 'Mega-Sena'],
  q: ['Quina'],
  l: ['Lotofácil', 'Lotofacil'],
  d: ['Dupla Sena'],
  s: ['Super Sete', 'Supersete'],
  i: ['Dia de Sorte'],
  '+': ['+Milionária', 'Milionária', '+Milionaria', 'Milionaria'],
  t: ['Timemania']
};

function normalizarTextoAtalho(txt){
  return String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[+\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function focoEstaEmCampoDigitavel(){
  const el = document.activeElement;
  if (!el) return false;

  const tag = String(el.tagName || '').toLowerCase();

  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    el.isContentEditable
  );
}

function irParaModalidadeCaixa(nomes){
  const lista = $('boloesCaixaLista');
  if (!lista) return false;

  const alvos = (nomes || []).map(normalizarTextoAtalho);

  const labels = Array.from(lista.querySelectorAll('.sec-sep-label'));

  const label = labels.find(el => {
    const texto = normalizarTextoAtalho(el.textContent);
    return alvos.some(nome => texto === nome || texto.includes(nome));
  });

  if (!label) {
    setStatusCaixa?.(`Modalidade não encontrada nesta lista.`, 'info');
    return false;
  }

  const bloco = label.closest('.sec-sep') || label;

 const offsetTopo = 105; // ajuste conforme altura do cabeçalho

const y = bloco.getBoundingClientRect().top + window.scrollY - offsetTopo;

window.scrollTo({
  top: y,
  left: 0,
  behavior: 'smooth'
});

  bloco.classList.add('atalho-destaque');

  setTimeout(() => {
    bloco.classList.remove('atalho-destaque');
  }, 900);

  return true;
}

function bindAtalhosModalidadesCaixa(){
  if (atalhosModalidadesCaixaAtivos) return;
  atalhosModalidadesCaixaAtivos = true;

  document.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (focoEstaEmCampoDigitavel()) return;

    const tecla = String(ev.key || '').toLowerCase();

    const nomes = ATALHOS_MODALIDADES_CAIXA[tecla];
    if (!nomes) return;

    const abaBoloesAtiva = $('tab-boloes')?.classList.contains('active');
    if (!abaBoloesAtiva) return;

    ev.preventDefault();
    irParaModalidadeCaixa(nomes);
  });
}

// ── Eventos / Init ────────────────────────────────────────────────
function bindEventos(){
  const btnLogout = $('btnLogout');
  if (btnLogout) {
    btnLogout.onclick = async () => {
      await sb.auth.signOut();
      location.href = './login.html';
    };
  }

  const lojaTree = $('lojaTreeWrap');
  if (lojaTree) lojaTree.onclick = () => trocarLojaCaixaPorOffset(1);

  const lojaChip = $('caixaLojaChip');
  if (lojaChip) lojaChip.onclick = () => trocarLojaCaixaPorOffset(1);

  const btnLimpar = $('btnLimparBolaoCaixa');
  if (btnLimpar) btnLimpar.onclick = limparBolaoSelecionadoCaixa;

  const btnFechar = $('btnFecharVendaCaixa');
  if (btnFechar) btnFechar.onclick = fecharPainelVendaCaixa;

  // Data da aba Bolões
  const prevCaixa = $('btnDtPrevCaixa');
  const nextCaixa = $('btnDtNextCaixa');
  const hojeCaixa = $('btnHojeCaixa');
  const displayCaixa = $('dateDisplayCaixa');
  const pickerCaixa = $('datePickerCaixa');

  if (prevCaixa) prevCaixa.onclick = () => alterarDataCaixa(-1);
  if (nextCaixa) nextCaixa.onclick = () => alterarDataCaixa(1);
  if (hojeCaixa) hojeCaixa.onclick = () => setDataCaixaPorISO(isoDate(hojeLocal()));

  if (displayCaixa && pickerCaixa) {
    displayCaixa.onclick = () => pickerCaixa.showPicker ? pickerCaixa.showPicker() : pickerCaixa.click();
  }

  if (pickerCaixa) {
    pickerCaixa.onchange = () => setDataCaixaPorISO(pickerCaixa.value);
  }

// Federal
// Federal
const federalChip = $('federalLojaChip');
if (federalChip) federalChip.onclick = () => trocarLojaCaixaPorOffset(1);

const prevFederal = $('btnDtPrevFederal');
const nextFederal = $('btnDtNextFederal');
const hojeFederal = $('btnHojeFederal');
const displayFederal = $('dateDisplayFederal');
const pickerFederal = $('datePickerFederal');
const btnRegistrarFederal = $('btnRegistrarFederal');
const inputQtdFederal = $('inputQtdFederal');
const btnFecharFederal = $('btnFecharVendaFederal');

if (prevFederal) {
  prevFederal.onclick = async () => {
    const d = normalizaDataLocal(dataCaixa);
    d.setDate(d.getDate() - 1);
    await setDataOperacionalCaixa(d);
    await buscarFederaisCaixa();
  };
}

if (nextFederal) {
  nextFederal.onclick = async () => {
    const d = normalizaDataLocal(dataCaixa);
    d.setDate(d.getDate() + 1);
    await setDataOperacionalCaixa(d);
    await buscarFederaisCaixa();
  };
}

if (hojeFederal) {
  hojeFederal.onclick = async () => {
    await setDataOperacionalCaixa(hojeLocal());
    await buscarFederaisCaixa();
  };
}

if (displayFederal && pickerFederal) {
  displayFederal.onclick = () => pickerFederal.showPicker
    ? pickerFederal.showPicker()
    : pickerFederal.click();
}

if (pickerFederal) {
  pickerFederal.onchange = async () => {
    await setDataOperacionalCaixa(dataFromISO(pickerFederal.value));
    await buscarFederaisCaixa();
  };
}

if (btnRegistrarFederal) {
  btnRegistrarFederal.onclick = registrarVendaFederalCaixa;
}

if (inputQtdFederal) {
  inputQtdFederal.oninput = calcTotalFederalCaixa;
}

if (btnFecharFederal) {
  btnFecharFederal.onclick = fecharPainelVendaFederal;
}
// Produtos
const produtosChip = $('produtosLojaChip');
if (produtosChip) produtosChip.onclick = () => trocarLojaCaixaPorOffset(1);

const prevProdutos = $('btnDtPrevProdutos');
const nextProdutos = $('btnDtNextProdutos');
const hojeProdutos = $('btnHojeProdutos');
const displayProdutos = $('dateDisplayProdutos');
const pickerProdutos = $('datePickerProdutos');
const btnRegistrarProduto = $('btnRegistrarProduto');
const inputQtdProduto = $('inputQtdProduto');
const btnFecharProduto = $('btnFecharVendaProduto');

if (prevProdutos) {
  prevProdutos.onclick = async () => {
    const d = normalizaDataLocal(dataCaixa);
    d.setDate(d.getDate() - 1);
    await setDataOperacionalCaixa(d);
    await buscarProdutosCaixa();
  };
}

if (nextProdutos) {
  nextProdutos.onclick = async () => {
    const d = normalizaDataLocal(dataCaixa);
    d.setDate(d.getDate() + 1);
    await setDataOperacionalCaixa(d);
    await buscarProdutosCaixa();
  };
}

if (hojeProdutos) {
  hojeProdutos.onclick = async () => {
    await setDataOperacionalCaixa(hojeLocal());
    await buscarProdutosCaixa();
  };
}

if (displayProdutos && pickerProdutos) {
  displayProdutos.onclick = () => pickerProdutos.showPicker
    ? pickerProdutos.showPicker()
    : pickerProdutos.click();
}

if (pickerProdutos) {
  pickerProdutos.onchange = async () => {
    await setDataOperacionalCaixa(dataFromISO(pickerProdutos.value));
    await buscarProdutosCaixa();
  };
}

if (btnRegistrarProduto) {
  btnRegistrarProduto.onclick = registrarVendaProdutoCaixa;
}

if (inputQtdProduto) {
  inputQtdProduto.oninput = calcTotalProdutoCaixa;
}

if (btnFecharProduto) {
  btnFecharProduto.onclick = fecharPainelVendaProduto;
}
  
  // Consolidado mensal
  const btnMesPrevCons = $('btnMesPrevCons');
  if (btnMesPrevCons) {
    btnMesPrevCons.onclick = () => alterarMesConsolidadoCaixa(-1);
  }

  const btnMesNextCons = $('btnMesNextCons');
  if (btnMesNextCons) {
    btnMesNextCons.onclick = () => alterarMesConsolidadoCaixa(1);
  }

  const btnHojeCons = $('btnHojeCons');
  if (btnHojeCons) {
    btnHojeCons.onclick = irHojeConsolidadoCaixa;
  }

  const btnAtualizarCons = $('btnAtualizarCons');
  if (btnAtualizarCons) {
    btnAtualizarCons.onclick = async () => {
      await carregarResumoMensalCaixa();
      await carregarConsolidadoCaixa();
    };
  }
  bindAtalhosModalidadesCaixa();
}

async function init(){
  try {
    const { data:{ session } } = await sb.auth.getSession();

    if (!session) {
      location.href = './login.html';
      return;
    }

    const { data: usr, error: erroUsr } = await sb
      .from('usuarios')
      .select('id,nome,perfil,ativo,pode_logar')
      .eq('auth_user_id', session.user.id)
      .eq('ativo', true)
      .eq('pode_logar', true)
      .maybeSingle();

    if (erroUsr || !usr) {
      location.href = './login.html';
      return;
    }

    usuario = usr;

    bindEventos();

    await carregarContextoLojas();

    dataCaixa = hojeLocal();
    dataConsolidadoCaixa = hojeLocal();

    atualizarDatasCaixa();
    atualizarTituloMesCaixa();
    gerarAbasDiasCaixa();

    await buscarBoloesCaixa();

  } catch (err) {
    console.error('[caixa-vendas.init]', err);
    const alvo = $('boloesCaixaLista') || document.body;
    alvo.innerHTML = `
      <div class="state-box" style="margin:20px">
        <div class="state-title">Erro ao inicializar Venda no Caixa</div>
        <div class="state-sub">${err.message || err}</div>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', init);
