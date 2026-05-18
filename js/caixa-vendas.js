const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

// ── Estado ────────────────────────────────────────────────────────
let usuario = null;
let dataCaixa = hojeLocal();
let lojasAtivas = [];
let lojasPermitidas = [];
let lojaCaixaAtiva = null;
let bolaoSelecionadoCaixa = null;

function $(id){ return document.getElementById(id); }

function normalizaDataLocal(dt){
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return hojeLocal();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function hojeLocal(){
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), h.getDate());
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
  return d.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
}

function fmtHora(dt){
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}

function fmtBRL(v){
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function parseBRL(v){
  return parseFloat(String(v || '').replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.')) || 0;
}

// ── Lojas / tema ─────────────────────────────────────────────────
const LOJA_CONFIG = {
  'boulevard':    { nome:'Boulevard',    logo:'./icons/boulevard.png',    theme:'boulevard',    logoPos:'50% 50%' },
  'centro':       { nome:'Centro',       logo:'./icons/loterpraca.png',   theme:'centro',       logoPos:'50% 42%' },
  'lotobel':      { nome:'Lotobel',      logo:'./icons/lotobel.png',      theme:'lotobel',      logoPos:'50% 50%' },
  'santa-tereza': { nome:'Santa Tereza', logo:'./icons/santa-tereza.png', theme:'santa-tereza', logoPos:'50% 50%' },
  'via-brasil':   { nome:'Via',          logo:'./icons/via-brasil.png',   theme:'via-brasil',   logoPos:'50% 50%' },
  'via':          { nome:'Via',          logo:'./icons/via-brasil.png',   theme:'via-brasil',   logoPos:'50% 50%' },
};

function slugSeguro(slug){
  return String(slug || 'centro').trim().toLowerCase();
}

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

  const nome = String(loja?.loteria_nome || loja?.nome || lojaBase?.nome || '').trim();
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

  await buscarBoloesCaixa();

  if ($('tab-consolidado')?.classList.contains('active')) {
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

  const { data: vinculos } = await sb
    .from('usuarios_loterias')
    .select('loteria_id,principal,ativo')
    .eq('usuario_id', usuario.id)
    .eq('ativo', true);

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

  // Fallback para ADMIN/SOCIO se por algum motivo não vier vínculo.
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
    el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR', {
      weekday:'short', day:'2-digit', month:'2-digit', year:'numeric'
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

  if (id === 'consolidado') {
    await carregarConsolidadoCaixa();
  }
}
// ── Data ──────────────────────────────────────────────────────────
function atualizarDatasCaixa(){
  dataCaixa = normalizaDataLocal(dataCaixa);
  const iso = isoDate(dataCaixa);

  ['Caixa','Cons'].forEach(suf => {
    const display = $('dateDisplay' + suf);
    const picker = $('datePicker' + suf);
    if (display) display.textContent = fmtData(dataCaixa);
    if (picker) picker.value = iso;
  });
}

async function alterarDataCaixa(deltaDias){
  const d = normalizaDataLocal(dataCaixa);
  d.setDate(d.getDate() + deltaDias);
  dataCaixa = d;
  atualizarDatasCaixa();
  await buscarBoloesCaixa();
  if ($('tab-consolidado')?.classList.contains('active')) await carregarConsolidadoCaixa();
}

async function setDataCaixaPorISO(iso){
  dataCaixa = dataFromISO(iso);
  atualizarDatasCaixa();
  await buscarBoloesCaixa();
  if ($('tab-consolidado')?.classList.contains('active')) await carregarConsolidadoCaixa();
}

// ── Bolões ────────────────────────────────────────────────────────
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
  lista.innerHTML = '<div class="state-box" style="padding:24px"><div class="spinner"></div></div>';

  if (!lojaCaixaAtiva?.loteria_id) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhuma loja selecionada</div>
        <div class="state-sub">Selecione a loja do caixa para carregar os bolões.</div>
      </div>`;
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
      </div>`;
    return;
  }

  const boloes = normalizarBoloesCaixa(rows || []);

  if (!boloes.length) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhum bolão com saldo</div>
        <div class="state-sub">Não há saldo disponível no caixa ${lojaCaixaAtiva.loteria_nome} em ${fmtData(dataCaixa)}.</div>
      </div>`;
    return;
  }

  renderBoloesCaixa(boloes);
}

function renderBoloesCaixa(boloes){
  const wrap = document.createElement('div');
  wrap.className = 'bolao-cards-grid';

  const grupos = {};
  boloes.forEach(b => {
    if (!grupos[b.modalidade]) grupos[b.modalidade] = [];
    grupos[b.modalidade].push(b);
  });

  Object.keys(grupos).sort().forEach(mod => {
    const sep = document.createElement('div');
    sep.className = 'sec-sep';
    sep.style.margin = '8px 0 6px';
    sep.innerHTML = `<div class="sec-sep-label">${mod}</div><div class="sec-sep-line"></div>`;
    wrap.appendChild(sep);

    grupos[mod]
      .sort((a,b) => {
        if ((a.loteria_origem_nome || '') !== (b.loteria_origem_nome || '')) {
          return (a.loteria_origem_nome || '').localeCompare(b.loteria_origem_nome || '');
        }
        return (a.valor_cota || 0) - (b.valor_cota || 0);
      })
      .forEach(b => {
        const saldoContexto = getSaldoContextoBolao(b);

        const saldoPills = (b.saldos_lojas || []).map(s => {
          const saldo = Number(s.saldo_real || 0);
          const ehContexto = Number(s.loteria_id) === Number(lojaCaixaAtiva?.loteria_id);

          return `
            <span class="saldo-pill ${ehContexto ? 'contexto' : ''} ${saldo <= 0 ? 'zero' : ''}" title="${s.loteria_nome || ''}">
              <span class="sp-loja">${siglaLoja(s)}</span>
              <span class="sp-val">${saldo}</span>
            </span>`;
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
              <span class="bsc-tag tag-canal-venda">Saldo ${siglaLoja({loteria_id: lojaCaixaAtiva.loteria_id})}: ${saldoContexto}</span>
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
          </div>`;

        card.onclick = () => selecionarBolaoCaixa(b, card);
        wrap.appendChild(card);
      });
  });

  $('boloesCaixaLista').innerHTML = '';
  $('boloesCaixaLista').appendChild(wrap);
}

function selecionarBolaoCaixa(b, card){
  document.querySelectorAll('.bolao-sel-card').forEach(c => c.classList.remove('selected'));
  if (card) card.classList.add('selected');

  bolaoSelecionadoCaixa = b;

  const valor = $('inputValorCaixa');
  const qtd = $('inputQtdCaixa');
  if (valor) valor.value = Number(b.valor_cota).toLocaleString('pt-BR', { minimumFractionDigits:2 });
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
      <span class="wpp-tag amber">${fmtBRL(b.valor_cota)}</span>`;
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
        </div>`;
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
      </div>`;
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

  const { data, error } = await sb.rpc('rpc_registrar_venda_balcao_bolao', {
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

  setStatusCaixa(
    `✓ Venda registrada no caixa ${lojaCaixaAtiva.loteria_nome}. Saldo restante: ${data?.saldo_depois ?? '—'}.`,
    'ok'
  );

  if ($('inputQtdCaixa')) $('inputQtdCaixa').value = '1';
  fecharPainelVendaCaixa();
  calcTotalCaixa();

  await buscarBoloesCaixa();
  if ($('tab-consolidado')?.classList.contains('active')) await carregarConsolidadoCaixa();
}

async function deletarVendaBalcaoBolao(id){
  const ok = await confirmar('Remover venda', 'Tem certeza que deseja remover esta venda de balcão?');
  if (!ok) return;

  const { error } = await sb.rpc('rpc_excluir_venda_balcao_bolao', {
    p_bolao_venda_id: id
  });

  if (error) {
    alert('Erro ao excluir venda: ' + error.message);
    return;
  }

  await carregarConsolidadoCaixa();
  await buscarBoloesCaixa();
}

// ── Consolidado ──────────────────────────────────────────────────
async function carregarConsolidadoCaixa(){
  const box = $('consolidadoContent');
  if (!box) return;

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

  const { data, error } = await sb
    .from('view_caixa_consolidado_boloes_dia')
    .select('*')
    .eq('loteria_vendedora_id', lojaCaixaAtiva.loteria_id)
    .eq('data_referencia', isoDate(dataCaixa))
    .order('modalidade')
    .order('concurso');

  if (error) {
    box.innerHTML = `
      <div class="state-box">
        <div class="state-title">Erro ao buscar consolidado</div>
        <div class="state-sub">${error.message}</div>
      </div>
    `;
    return;
  }

  renderConsolidadoCaixa(data || []);
}
function renderConsolidadoCaixa(rows){
  const box = $('consolidadoContent');
  if (!box) return;

  if (!rows.length) {
    box.innerHTML = `
      <div class="state-box">
        <div class="state-title">Nenhuma venda no balcão</div>
        <div class="state-sub">Não há vendas BALCÃO para ${lojaCaixaAtiva?.loteria_nome || 'esta loja'} em ${fmtData(dataCaixa)}.</div>
      </div>
    `;
    return;
  }

  const totalCotas = rows.reduce((s,r) => s + Number(r.cotas_vendidas || 0), 0);
  const totalValor = rows.reduce((s,r) => s + Number(r.valor_total || 0), 0);
  const totalLancamentos = rows.reduce((s,r) => s + Number(r.qtd_lancamentos || 0), 0);

  const linhas = rows.map(r => `
    <div class="cx-cons-row">
      <div class="cx-cons-main">
        <strong>${r.modalidade}</strong>
        <span>#${r.concurso}</span>
        <em>${r.loja_codigo || r.loja_vendedora || ''}</em>
      </div>

      <div class="cx-cons-meta">
        <span>${Number(r.cotas_vendidas || 0)} cota${Number(r.cotas_vendidas || 0) > 1 ? 's' : ''}</span>
        <span>${Number(r.qtd_lancamentos || 0)} lançamento${Number(r.qtd_lancamentos || 0) > 1 ? 's' : ''}</span>
        <span>${fmtBRL(r.valor_cota)}</span>
      </div>

      <div class="cx-cons-total">
        ${fmtBRL(r.valor_total)}
      </div>
    </div>
  `).join('');

  box.innerHTML = `
    <div class="cx-cons-wrap fade-in">

      <div class="cx-cons-head">
        <div>
          <div class="cx-cons-kicker">Consolidado do dia</div>
          <div class="cx-cons-title">${lojaCaixaAtiva?.loteria_nome || 'Loja'} · ${fmtData(dataCaixa)}</div>
        </div>

        <button class="btn-hist-buscar" onclick="carregarConsolidadoCaixa()">
          Atualizar
        </button>
      </div>

      <div class="cx-kpi-grid">
        <div class="cx-kpi-card">
          <span>Vendas</span>
          <strong>${totalLancamentos}</strong>
        </div>

        <div class="cx-kpi-card">
          <span>Cotas</span>
          <strong>${totalCotas}</strong>
        </div>

        <div class="cx-kpi-card destaque">
          <span>Total bolões</span>
          <strong>${fmtBRL(totalValor)}</strong>
        </div>
      </div>

      <div class="sec-sep">
        <div class="sec-sep-label">Bolões vendidos no balcão</div>
        <div class="sec-sep-line"></div>
        <div class="sec-sep-count">${rows.length}</div>
      </div>

      <div class="cx-cons-list">
        ${linhas}
      </div>

    </div>
  `;
}

// ── Confirmação ──────────────────────────────────────────────────
function confirmar(titulo, corpo){
  return new Promise(resolve => {
    const ov = $('confirmOverlay');
    $('confirmTitle').textContent = titulo || 'Confirmar';
    $('confirmBody').textContent = corpo || '';
    ov.classList.add('show');

    const no = $('confirmNo');
    const yes = $('confirmYes');

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

async function carregarConsolidadoCaixa(){
  const box = $('consolidadoContent');
  if (!box) return;

  const lojaId = lojaWhatsappAtiva?.loteria_id;
  const dataRef = isoDate(dataAtualReg || dataAtual || hojeLocal());

  box.innerHTML = `
    <div class="state-box">
      <div class="spinner"></div>
      <div class="state-title">Carregando consolidado…</div>
    </div>
  `;

  if (!lojaId) {
    box.innerHTML = `
      <div class="state-box">
        <div class="state-title">Nenhuma loja selecionada</div>
        <div class="state-sub">Selecione uma loja para carregar o consolidado.</div>
      </div>
    `;
    return;
  }

  const { data, error } = await sb
    .from('view_caixa_consolidado_boloes_dia')
    .select('*')
    .eq('data_referencia', dataRef)
    .eq('loteria_vendedora_id', lojaId)
    .order('modalidade')
    .order('concurso');

  if (error) {
    box.innerHTML = `
      <div class="state-box">
        <div class="state-title">Erro ao carregar consolidado</div>
        <div class="state-sub">${error.message}</div>
      </div>
    `;
    return;
  }

  renderConsolidadoCaixa(data || [], dataRef);
}

function renderConsolidadoCaixa(rows, dataRef){
  const box = $('consolidadoContent');
  if (!box) return;

  const totalCotas = rows.reduce((s, r) => s + Number(r.cotas_vendidas || 0), 0);
  const totalValor = rows.reduce((s, r) => s + Number(r.valor_total || 0), 0);
  const totalLancamentos = rows.reduce((s, r) => s + Number(r.qtd_lancamentos || 0), 0);

  if (!rows.length) {
    box.innerHTML = `
      <div class="state-box">
        <div class="state-title">Nenhuma venda no caixa</div>
        <div class="state-sub">Não há vendas de bolões no balcão para ${fmtData(dataFromISO(dataRef))}.</div>
      </div>
    `;
    return;
  }

  const linhas = rows.map(r => `
    <div class="cx-cons-row">
      <div class="cx-cons-main">
        <strong>${r.modalidade}</strong>
        <span>#${r.concurso}</span>
        <em>${r.loja_codigo || r.loja_vendedora || ''}</em>
      </div>

      <div class="cx-cons-meta">
        <span>${Number(r.cotas_vendidas || 0)} cota${Number(r.cotas_vendidas || 0) > 1 ? 's' : ''}</span>
        <span>${Number(r.qtd_lancamentos || 0)} lançamento${Number(r.qtd_lancamentos || 0) > 1 ? 's' : ''}</span>
        <span>${fmtBRL(r.valor_cota)}</span>
      </div>

      <div class="cx-cons-total">
        ${fmtBRL(r.valor_total)}
      </div>
    </div>
  `).join('');

  box.innerHTML = `
    <div class="cx-cons-wrap fade-in">

      <div class="cx-cons-head">
        <div>
          <div class="cx-cons-kicker">Consolidado do dia</div>
          <div class="cx-cons-title">${lojaWhatsappAtiva?.loteria_nome || 'Loja'} · ${fmtData(dataFromISO(dataRef))}</div>
        </div>

        <button class="btn-hist-buscar" onclick="carregarConsolidadoCaixa()">
          Atualizar
        </button>
      </div>

      <div class="cx-kpi-grid">
        <div class="cx-kpi-card">
          <span>Vendas</span>
          <strong>${totalLancamentos}</strong>
        </div>

        <div class="cx-kpi-card">
          <span>Cotas</span>
          <strong>${totalCotas}</strong>
        </div>

        <div class="cx-kpi-card destaque">
          <span>Total bolões</span>
          <strong>${fmtBRL(totalValor)}</strong>
        </div>
      </div>

      <div class="sec-sep">
        <div class="sec-sep-label">Bolões vendidos no balcão</div>
        <div class="sec-sep-line"></div>
        <div class="sec-sep-count">${rows.length}</div>
      </div>

      <div class="cx-cons-list">
        ${linhas}
      </div>

    </div>
  `;
}

// ── Init ──────────────────────────────────────────────────────────
async function init(){
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

  await carregarContextoLojas();

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

  ['Caixa','Cons'].forEach(suf => {
    const prev = $('btnDtPrev' + suf);
    const next = $('btnDtNext' + suf);
    const hoje = $('btnHoje' + suf);
    const display = $('dateDisplay' + suf);
    const picker = $('datePicker' + suf);

    if (prev) prev.onclick = () => alterarDataCaixa(-1);
    if (next) next.onclick = () => alterarDataCaixa(1);
    if (hoje) hoje.onclick = () => setDataCaixaPorISO(isoDate(hojeLocal()));
    if (display && picker) display.onclick = () => picker.showPicker ? picker.showPicker() : picker.click();
    if (picker) picker.onchange = () => setDataCaixaPorISO(picker.value);
  });

  const btnAtualizarCons = $('btnAtualizarCons');
  if (btnAtualizarCons) btnAtualizarCons.onclick = carregarConsolidadoCaixa;

  dataCaixa = hojeLocal();
  atualizarDatasCaixa();
  await buscarBoloesCaixa();
}

document.addEventListener('DOMContentLoaded', init);
