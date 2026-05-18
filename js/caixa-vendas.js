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
let usuario = null;
let dataCaixa = hojeLocal();
let dataConsolidadoCaixa = hojeLocal();
let resumoDiasCaixa = {};
let lojasAtivas = [];
let lojasPermitidas = [];
let lojaCaixaAtiva = null;
let bolaoSelecionadoCaixa = null;

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

  await buscarBoloesCaixa();

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

  const base = normalizaDataLocal(dataConsolidadoCaixa);
  const ano = base.getFullYear();
  const mes = base.getMonth();

  const dataIni = isoDate(new Date(ano, mes, 1));
  const dataFim = isoDate(new Date(ano, mes + 1, 0));

  const { data, error } = await sb
    .from('view_caixa_vendas_boloes_grupo')
    .select('*')
    .eq('loteria_vendedora_id', lojaCaixaAtiva.loteria_id)
    .gte('data_referencia', dataIni)
    .lte('data_referencia', dataFim);

  if (error) {
    console.warn('Erro ao carregar resumo mensal do caixa:', error.message);
    gerarAbasDiasCaixa();
    return;
  }

  (data || []).forEach(r => {
    const dia = parseInt(String(r.data_referencia).split('-')[2], 10);
    if (!dia) return;

    if (!resumoDiasCaixa[dia]) {
      resumoDiasCaixa[dia] = {
        total_boloes: 0,
        cotas_boloes: 0,
        lancamentos_boloes: 0,
        total_federal: 0,
        total_produtos: 0
      };
    }

    resumoDiasCaixa[dia].total_boloes += Number(r.valor_total || 0);
    resumoDiasCaixa[dia].cotas_boloes += Number(r.qtd_vendida || r.cotas_vendidas || 0);
    resumoDiasCaixa[dia].lancamentos_boloes += Number(r.qtd_lancamentos || 0);
  });

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

  Object.keys(grupos).sort().forEach(mod => {
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
        if ((a.loteria_origem_nome || '') !== (b.loteria_origem_nome || '')) {
          return (a.loteria_origem_nome || '').localeCompare(b.loteria_origem_nome || '');
        }
        return (a.valor_cota || 0) - (b.valor_cota || 0);
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

  if ($('inputQtdCaixa')) $('inputQtdCaixa').value = '1';

  fecharPainelVendaCaixa();
  calcTotalCaixa();

  await buscarBoloesCaixa();

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


// ── Consolidado: renderização por setor ───────────────────────────
async function carregarConsolidadoCaixa(){
  const box = $('consolidadoContent');
  if (!box) return;

  const dataRef = isoDate(dataConsolidadoCaixa);

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
    .from('view_caixa_vendas_boloes_grupo')
    .select('*')
    .eq('loteria_vendedora_id', lojaCaixaAtiva.loteria_id)
    .eq('data_referencia', dataRef)
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

  renderConsolidadoCaixa(data || [], dataRef);
}

function renderConsolidadoCaixa(rows, dataRef){
  const box = $('consolidadoContent');
  if (!box) return;

  const totalBoloesQtd = rows.reduce((s, r) => s + Number(r.qtd_vendida || 0), 0);
  const totalBoloesValor = rows.reduce((s, r) => s + Number(r.valor_total || 0), 0);
  const totalGrupos = rows.length;

  const totalFederalQtd = 0;
  const totalFederalValor = 0;
  const totalProdutosQtd = 0;
  const totalProdutosValor = 0;

  const totalGeral = totalBoloesValor + totalFederalValor + totalProdutosValor;

  const linhasBoloes = rows.length
    ? rows.map(r => `
      <div class="cx-det-row cx-det-row-editavel">
    <div class="cx-det-main">
  <strong>${r.modalidade || '—'}</strong>
  <span>#${r.concurso || '—'}</span>
  <small>${Number(r.qtd_jogos || 0)} jogos</small>
  <small>${Number(r.qtd_dezenas || 0)} dez.</small>

  <div class="cx-det-actions cx-det-actions-inline">
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
      </div>
    `).join('')
    : `<div class="cx-det-empty">Sem vendas de bolões no balcão nesta data.</div>`;

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
            <div class="cx-rg-sub">${totalFederalQtd} frações</div>
          </div>

          <div class="cx-rg-card">
            <div class="cx-rg-label">Produtos</div>
            <div class="cx-rg-val cx-rg-blue">${fmtBRL(totalProdutosValor)}</div>
            <div class="cx-rg-sub">${totalProdutosQtd} itens</div>
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
            <em>${totalGrupos} bolão${totalGrupos !== 1 ? 'ões' : ''}</em>
          </div>

          <div class="cx-det-list">
            ${linhasBoloes}
          </div>

          <div class="cx-setor-total">
            <span>Total Bolões</span>
            <strong>${fmtBRL(totalBoloesValor)}</strong>
          </div>
        </div>

        <div class="cx-setor-fech muted">
          <div class="cx-setor-head">
            <div>
              <span>Setor</span>
              <strong>Federal</strong>
            </div>
            <em>Em breve</em>
          </div>
          <div class="cx-det-empty">As vendas de Federal serão somadas aqui quando ligarmos a aba Federal.</div>
        </div>

        <div class="cx-setor-fech muted">
          <div class="cx-setor-head">
            <div>
              <span>Setor</span>
              <strong>Produtos</strong>
            </div>
            <em>Em breve</em>
          </div>
          <div class="cx-det-empty">As vendas de produtos serão somadas aqui quando ligarmos o carrinho de produtos.</div>
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
