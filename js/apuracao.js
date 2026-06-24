const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

let usuario = null;
let dataAtual = hojeSaoPauloDate();
let bolaoSel = null;
let todosBoloes = [];
let origemFiltro = '';
let pendenciaFiltro = 'TODOS';
let modalidadeFiltro = '';
let concursoFiltro = null;
let usarDataReferencia = true;
let filtroAtivoTimer = null;

const $ = id => document.getElementById(id);

function fmtData(dt) {
  return dt.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
}

function hojeSaoPauloDate() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const get = tipo => partes.find(p => p.type === tipo)?.value;

  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));

  return new Date(y, m - 1, d);
}

function isoDate(dt) {
  if (!dt) return '';

  if (typeof dt === 'string') {
    const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }

  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '';

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${y}-${m}-${day}`;
}

function fmtBRL(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function intOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function lerFiltrosAvancados() {
  modalidadeFiltro = $('selModalidade')?.value || '';
  concursoFiltro = intOrNull($('inputConcurso')?.value);
  usarDataReferencia = $('chkUsarData') ? $('chkUsarData').checked : true;
}

function validarRangeConcurso() {
  return true;
}

function aplicarFiltrosBase(q, opts = {}) {
  const {
    usarFiltroData = true,
    usarFiltroOrigem = true,
    usarFiltroModalidade = true,
    usarFiltroConcurso = true,
    usarFiltroPendencia = true
  } = opts;

  const iso = isoDate(dataAtual);

  if (usarFiltroData && usarDataReferencia) {
    q = q
      .lte('dt_inicial', iso)
      .gte('dt_concurso', iso);
  }

  if (usarFiltroOrigem && origemFiltro) {
    q = q.eq('origem_loteria_id', Number(origemFiltro));
  }

  if (usarFiltroModalidade && modalidadeFiltro) {
    q = q.eq('modalidade', modalidadeFiltro);
  }

  if (usarFiltroConcurso && concursoFiltro !== null) {
  q = q.eq('concurso', concursoFiltro);
}

  if (usarFiltroPendencia) {
    if (pendenciaFiltro === 'SIM') q = q.eq('pendencia_apuracao', true);
    if (pendenciaFiltro === 'NAO') q = q.eq('pendencia_apuracao', false);
  }

  return q;
}

function atualizarEstadoFiltroData() {
  const usandoData = $('chkUsarData')
    ? $('chkUsarData').checked
    : true;

  const btnPrev = $('btnDtPrev');
  const btnNext = $('btnDtNext');
  const btnHoje = $('btnHoje');
  const inputData = $('inputDataReferencia');
  const dateDisplay = $('dateDisplay');

  if (btnPrev) {
    btnPrev.disabled = !usandoData;
  }

  if (btnNext) {
    btnNext.disabled = !usandoData;
  }

  if (btnHoje) {
    btnHoje.disabled = !usandoData;
  }

  if (inputData) {
    inputData.disabled = !usandoData;
  }

  if (dateDisplay) {
    dateDisplay.style.opacity = usandoData ? '1' : '.45';
  }
}

function agendarFiltroAtivo(delay = 450) {
  clearTimeout(filtroAtivoTimer);

  filtroAtivoTimer = setTimeout(async () => {
    lerFiltrosAvancados();

    if (!validarRangeConcurso()) return;

    fecharPanel();
    await carregarOrigens();
    await carregarModalidades();
    await buscarBoloes();
  }, delay);
}
let toastTimer = null;

function mostrarToast(mensagem, tipo = 'ok', duracao = 4500) {
  const toast = $('toastGlobal');
  if (!toast) return;

  clearTimeout(toastTimer);

  toast.textContent = mensagem;
  toast.className = `toast-global ${tipo} show`;

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duracao);
}
function setStatus(msg, tipo='info') {
  const el = $('statusBar');
  el.textContent = msg;
  el.className = 'status-bar show ' + tipo;
}
function clearStatus() {
  $('statusBar').className = 'status-bar';
}

function updateClock() {
  const now = new Date();
  $('relogio').textContent = now.toLocaleTimeString('pt-BR') + ' — ' +
    now.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

async function init() {
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    location.href = './login.html';
    return;
  }

  const { data: usr } = await sb
    .from('usuarios')
    .select('id, nome, perfil, ativo, pode_logar')
    .eq('auth_user_id', session.user.id)
    .eq('ativo', true)
    .eq('pode_logar', true)
    .maybeSingle();

  if (!usr) {
    location.href = './login.html';
    return;
  }

  usuario = usr;

  $('btnLogout').onclick = async () => {
    await sb.auth.signOut();
    location.href = './login.html';
  };

  $('selOrigem').addEventListener('change', async e => {
    origemFiltro = e.target.value || '';

    fecharPanel();

    await carregarModalidades();
    await buscarBoloes();
  });

  $('selPendencia').addEventListener('change', async e => {
    pendenciaFiltro = e.target.value;

    fecharPanel();

    await buscarBoloes();
  });

  if ($('selModalidade')) {
    $('selModalidade').addEventListener('change', async e => {
      modalidadeFiltro = e.target.value || '';

      fecharPanel();

      await carregarOrigens();
      await buscarBoloes();
    });
  }

  if ($('chkUsarData')) {
    $('chkUsarData').addEventListener('change', async e => {
      usarDataReferencia = e.target.checked;

      atualizarEstadoFiltroData();
      fecharPanel();

      await carregarOrigens();
      await carregarModalidades();
      await buscarBoloes();
    });
  }

  if ($('inputConcurso')) {
  $('inputConcurso').addEventListener('input', () => {
    agendarFiltroAtivo(450);
  });
}

  dataAtual = hojeSaoPauloDate();

  atualizarDateDisplay();
  atualizarEstadoFiltroData();

  await carregarOrigens();
  await carregarModalidades();
  await buscarBoloes();
}

async function mudarData(deltaDias) {
  lerFiltrosAvancados();

  if (!usarDataReferencia) return;

  const base = dataAtual instanceof Date ? dataAtual : hojeSaoPauloDate();
  const novaData = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + Number(deltaDias || 0)
  );

  if (Number.isNaN(novaData.getTime())) return;

  dataAtual = novaData;

  atualizarDateDisplay();
  atualizarEstadoFiltroData();
  fecharPanel();

  await carregarOrigens();
  await carregarModalidades();
  await buscarBoloes();
}

function atualizarDateDisplay() {
  const display = $('dateDisplay');
  const inputData = $('inputDataReferencia');

  if (display) {
    display.textContent = fmtData(dataAtual);
  }

  if (inputData) {
    inputData.value = isoDate(dataAtual);
  }
}
async function selecionarDataReferencia(valor) {
  if (!valor) return;

  const partes = valor.split('-').map(Number);

  if (
    partes.length !== 3 ||
    !partes[0] ||
    !partes[1] ||
    !partes[2]
  ) {
    return;
  }

  const [ano, mes, dia] = partes;

  /*
    Criar a data dessa maneira evita o erro de UTC
    que pode fazer a data voltar um dia.
  */
  const novaData = new Date(ano, mes - 1, dia);

  if (Number.isNaN(novaData.getTime())) return;

  dataAtual = novaData;

  atualizarDateDisplay();
  atualizarEstadoFiltroData();
  fecharPanel();

  await carregarOrigens();
  await carregarModalidades();
  await buscarBoloes();
}
async function carregarOrigens() {
  lerFiltrosAvancados();

  let q = sb
    .from('view_boloes_apuracao_marketplace')
    .select('origem_loteria_id, origem_nome, origem_cod_loterico')
    .eq('status', 'ATIVO');

  q = aplicarFiltrosBase(q, {
    usarFiltroData: true,
    usarFiltroOrigem: false,
    usarFiltroModalidade: true,
    usarFiltroConcurso: true,
    usarFiltroPendencia: false
  });

  const { data, error } = await q;
  if (error) return;

  const mapa = new Map();
  (data || []).forEach(r => {
    if (!mapa.has(String(r.origem_loteria_id))) mapa.set(String(r.origem_loteria_id), r);
  });

  const sel = $('selOrigem');
  const atual = origemFiltro;
  sel.innerHTML = '<option value="">Todas as origens</option>';

  [...mapa.values()]
    .sort((a, b) => String(a.origem_nome || '').localeCompare(String(b.origem_nome || ''), 'pt-BR'))
    .forEach(r => {
      const op = document.createElement('option');
      op.value = r.origem_loteria_id;
      op.textContent = `${r.origem_nome || '—'}${r.origem_cod_loterico ? ' · ' + r.origem_cod_loterico : ''}`;
      if (String(r.origem_loteria_id) === String(atual)) op.selected = true;
      sel.appendChild(op);
    });
}
async function buscarBoloes() {
  lerFiltrosAvancados();

  if (!validarRangeConcurso()) {
    $('stLoading').style.display = 'none';
    $('stVazio').style.display = 'flex';
    $('stLista').style.display = 'none';
    $('boloesCount').innerHTML = '';
    todosBoloes = [];
    return;
  }

  $('stLoading').style.display = 'flex';
  $('stVazio').style.display = 'none';
  $('stLista').style.display = 'none';
  $('boloesCount').innerHTML = '';

 let q = sb.from('view_boloes_apuracao_marketplace')
  .select('*')
  .eq('status', 'ATIVO')
  .order('modalidade', { ascending: true })
  .order('concurso', { ascending: true })
  .order('valor_cota', { ascending: true })
  .order('origem_nome', { ascending: true });
  q = aplicarFiltrosBase(q);

  const { data: boloes, error } = await q;

  $('stLoading').style.display = 'none';

  if (error || !boloes?.length) {
    const textoData = usarDataReferencia ? ` para ${fmtData(dataAtual)}.` : '.';
    $('stVazioSub').textContent = `Nenhum bolão encontrado${textoData}`;
    $('stVazio').style.display = 'flex';
    todosBoloes = [];
    return;
  }

  todosBoloes = boloes;
  renderBoloes(boloes);
}

async function carregarModalidades() {
  lerFiltrosAvancados();

  let q = sb
    .from('view_boloes_apuracao_marketplace')
    .select('modalidade')
    .eq('status', 'ATIVO');

  q = aplicarFiltrosBase(q, {
    usarFiltroData: true,
    usarFiltroOrigem: true,
    usarFiltroModalidade: false,
    usarFiltroConcurso: false,
    usarFiltroPendencia: false
  });

  const { data, error } = await q;
  if (error) return;

  const modalidades = [...new Set((data || [])
    .map(r => r.modalidade)
    .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const sel = $('selModalidade');
  if (!sel) return;

  const atual = modalidadeFiltro;

  sel.innerHTML = '<option value="">Todas as modalidades</option>';

  modalidades.forEach(mod => {
    const op = document.createElement('option');
    op.value = mod;
    op.textContent = mod;
    if (mod === atual) op.selected = true;
    sel.appendChild(op);
  });
}
function pendBadge(b) {
  return b.pendencia_apuracao
    ? '<span class="pend-badge pend">?</span>'
    : '<span class="pend-badge ok">✓</span>';
}

function valorInfo(v) {
  return v === null || v === undefined ? '—' : v;
}
function resumoBolaoHTML(b, expandido = false) {
  return `
    <div class="bolao-main ${expandido ? 'bolao-main-expandido' : ''}">
      <div class="bolao-header">
        ${expandido ? '' : pendBadge(b)}
        <span class="bolao-modal">${b.modalidade}</span>
        <span class="bolao-concurso">#${b.concurso}</span>
        <span class="bolao-origem">${b.origem_nome || '—'}</span>
      </div>

      <div class="bolao-tags">
        <span class="btag">${b.qtd_jogos} jogos</span>
        <span class="btag">${b.qtd_dezenas} dez.</span>
        <span class="btag">${b.qtd_cotas_total} cotas</span>
        <span class="btag">${fmtBRL(b.valor_cota)}/cota</span>
      </div>

      <div class="bolao-tags bolao-tags-apu">
        <span class="btag btag-apu">Marketplace: ${valorInfo(b.qtd_marketplace)}</span>
        <span class="btag btag-apu">Encalhe Físico: ${valorInfo(b.enc_fisico)}</span>
        <span class="btag btag-apu">Encalhe Virtual: ${valorInfo(b.enc_virtual)}</span>
        <span class="btag btag-apu">Prêmio_Cota: ${b.vlr_premio == null ? '—' : fmtBRL(b.vlr_premio)}</span>
      </div>
    </div>
  `;
}
function renderBoloes(boloes) {
  const lista = $('stLista');
  lista.innerHTML = '';

  const grupos = {};
  boloes.forEach(b => {
    if (!grupos[b.modalidade]) grupos[b.modalidade] = [];
    grupos[b.modalidade].push(b);
  });

  const mods = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  let total = 0;

  mods.forEach(mod => {
    const lst = grupos[mod].sort((a, b) => {
  const cA = Number(a.concurso || 0);
  const cB = Number(b.concurso || 0);

  if (cA !== cB) return cA - cB;

  const nA = a.origem_nome || '';
  const nB = b.origem_nome || '';

  if (nA !== nB) return nA.localeCompare(nB, 'pt-BR');

  return Number(a.valor_cota || 0) - Number(b.valor_cota || 0);
});
    const sep = document.createElement('div');
    sep.className = 'section-sep';
    sep.style.marginTop = total > 0 ? '20px' : '0';
    sep.innerHTML = `<div class="section-sep-label">${mod}</div><div class="section-sep-line"></div><div class="section-sep-count">${lst.length}</div>`;
    lista.appendChild(sep);

    const grid = document.createElement('div');
    grid.className = 'boloes-grid';

    lst.forEach((b, i) => {
      const card = document.createElement('div');
      card.className = 'bolao-card';
      card.dataset.id = b.bolao_id;
      card.style.animationDelay = (i * 0.04) + 's';

      card.innerHTML = `
        ${resumoBolaoHTML(b)}
        <div class="bolao-select-ind">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 6 5 9 10 3"/>
          </svg>
        </div>`;

      card.addEventListener('click', () => selecionarBolao(b));
      grid.appendChild(card);
      total++;
    });

    lista.appendChild(grid);
  });

  $('stLista').style.display = 'block';
  $('boloesCount').innerHTML = `<span>${total}</span> bolões encontrados`;
}
async function selecionarBolao(b) {
  document.querySelectorAll('.bolao-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.bolao-card[data-id="${b.bolao_id}"]`)?.classList.add('selected');

  bolaoSel = b;
  clearStatus();

  $('panelNome').innerHTML = resumoBolaoHTML(b, true);
  $('panelTags').innerHTML = '';

  $('inputMarketplace').value = b.qtd_marketplace ?? '';
  $('inputEncFisico').value = b.enc_fisico ?? '';
  $('inputEncVirtual').value = b.enc_virtual ?? '';
  $('inputPremio').value = b.vlr_premio ?? '';

  renderResumoApuracao();

  $('vendaPanel').classList.add('open');
  document.body.classList.add('panel-open');
  $('inputMarketplace').focus();
}

function renderResumoApuracao() {
  if (!bolaoSel) return;

  const mp = intOrNull($('inputMarketplace').value);
  const ef = intOrNull($('inputEncFisico').value);
  const ev = intOrNull($('inputEncVirtual').value);
  const premio = numOrNull($('inputPremio').value);

  const totalCotas =
    Number(bolaoSel.qtd_cotas_total || 0);

  const vendidoOperacional =
    Number(bolaoSel.qtd_vendida_operacional_total || 0);

  /*
   * Apuração geral do bolão:
   *
   * total de cotas
   * - vendas operacionais de todas as lojas
   * - marketplace
   * - encalhe físico
   * - encalhe virtual
   *
   * Movimentações entre lojas não entram aqui,
   * pois não alteram o total geral do bolão.
   */
  const saldoFinal =
    totalCotas
    - vendidoOperacional
    - Number(mp || 0)
    - Number(ef || 0)
    - Number(ev || 0);

  const pendente =
    [mp, ef, ev, premio].some(valor => valor === null);

  if ($('apuBaseOrigem')) {
    $('apuBaseOrigem').textContent =
      String(bolaoSel.saldo_base_origem ?? 0);
  }

  if ($('apuVendidoOperacional')) {
    $('apuVendidoOperacional').textContent =
      String(vendidoOperacional);
  }

  if ($('apuSaldoFinal')) {
    $('apuSaldoFinal').textContent =
      String(saldoFinal);
  }

  const situacao = $('apuSituacao');

  if (situacao) {
    if (pendente) {
      situacao.textContent = 'Pendente';
      situacao.className = 'apu-card-val warn';

    } else if (saldoFinal === 0) {
      situacao.textContent = 'Fechado';
      situacao.className = 'apu-card-val ok';

    } else if (saldoFinal > 0) {
      situacao.textContent = 'Diferença';
      situacao.className = 'apu-card-val warn';

    } else {
      situacao.textContent = 'Excedido';
      situacao.className = 'apu-card-val err';
    }
  }

  let mensagemSaldo = '';

  if (saldoFinal === 0) {
    mensagemSaldo = 'Apuração fechada corretamente.';
  } else if (saldoFinal > 0) {
    mensagemSaldo =
      `Ainda restam ${saldoFinal} cota(s) sem classificação.`;
  } else {
    mensagemSaldo =
      `A apuração excedeu o disponível em ${Math.abs(saldoFinal)} cota(s).`;
  }

  $('apuracaoResumo').innerHTML = `
    <strong>Total de cotas:</strong> ${totalCotas} ·
    <strong>Vendas operacionais:</strong> ${vendidoOperacional}<br>

    <strong>Marketplace:</strong>
    ${mp === null ? 'não lançado' : mp} ·

    <strong>Encalhe físico:</strong>
    ${ef === null ? 'não lançado' : ef} ·

    <strong>Encalhe virtual:</strong>
    ${ev === null ? 'não lançado' : ev} ·

    <strong>Prêmio/cota:</strong>
    ${premio === null ? 'não lançado' : fmtBRL(premio)}<br>

    <strong>Saldo final:</strong> ${saldoFinal} cota(s).
    ${mensagemSaldo}
  `;
}

function fecharPanel(limparStatus = true) {
  const panel = $('vendaPanel');

  if ($('encalheBoxOverlay')?.classList.contains('show')) {
    fecharEncalheBox();
  }

  if (panel) {
    panel.classList.remove('open');
  }

  document.body.classList.remove('panel-open');

  document.querySelectorAll('.bolao-card').forEach(card => {
    card.classList.remove('selected');
  });

  bolaoSel = null;

  if (limparStatus) {
    clearStatus();
  }
}

async function salvarApuracao() {
  if (!bolaoSel) return;

  const qtd_marketplace = intOrNull($('inputMarketplace').value);
  const enc_fisico = intOrNull($('inputEncFisico').value);
  const enc_virtual = intOrNull($('inputEncVirtual').value);
  const vlr_premio = numOrNull($('inputPremio').value);

  const negativos = [qtd_marketplace, enc_fisico, enc_virtual, vlr_premio].filter(v => v !== null && v < 0);
  if (negativos.length) {
    setStatus('Os valores não podem ser negativos.', 'err');
    return;
  }
const totalCotas =
  Number(bolaoSel.qtd_cotas_total || 0);

const vendidoOperacional =
  Number(bolaoSel.qtd_vendida_operacional_total || 0);

const saldoFinal =
  totalCotas
  - vendidoOperacional
  - Number(qtd_marketplace || 0)
  - Number(enc_fisico || 0)
  - Number(enc_virtual || 0);

if (saldoFinal < 0) {
  setStatus(
    `A apuração excede o saldo disponível em ${Math.abs(saldoFinal)} cota(s). Revise marketplace e encalhes.`,
    'err'
  );

  renderResumoApuracao();
  return;
}
  const btn = $('btnRegistrar');
  btn.disabled = true;
  setStatus('Salvando apuração…', 'info');

  const { error } = await sb.from('boloes')
    .update({
      qtd_marketplace,
      enc_virtual,
      vlr_premio
    })
    .eq('id', bolaoSel.bolao_id);

  btn.disabled = false;

if (error) {
  setStatus(error.message, 'err');
  return;
}

fecharPanel();
await buscarBoloes();

mostrarToast('Apuração salva com sucesso.', 'ok');
}

/* =========================================================
   CAIXA COMPACTA DE ENCALHE FÍSICO POR LOJA
========================================================= */

const estadoEncalheBox = {
  bolaoId: null,
  bolao: null,
  lojas: [],
  salvando: false,
  bloqueadoPorMigracao: false,
  diferencaMigracao: 0
};

function encalheBoxEscape(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function encalheBoxInteiro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : 0;
}

function mostrarStatusEncalheBox(mensagem, tipo = 'info') {
  const barra = $('encalheBoxStatus');
  if (!barra) return;

  if (!mensagem) {
    barra.textContent = '';
    barra.className = 'status-bar';
    return;
  }

  barra.textContent = mensagem;
  barra.className = `status-bar show ${tipo}`;
}

function abrirOverlayEncalheBox() {
  const overlay = $('encalheBoxOverlay');
  if (!overlay) return false;

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('encalhe-box-open');

  return true;
}

function resetarEstadoEncalheBox() {
  estadoEncalheBox.bolaoId = null;
  estadoEncalheBox.bolao = null;
  estadoEncalheBox.lojas = [];
  estadoEncalheBox.salvando = false;
  estadoEncalheBox.bloqueadoPorMigracao = false;
  estadoEncalheBox.diferencaMigracao = 0;
}

function fecharEncalheBox() {
  const overlay = $('encalheBoxOverlay');

  if (overlay) {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  document.body.classList.remove('encalhe-box-open');
  resetarEstadoEncalheBox();
  mostrarStatusEncalheBox('');
}

async function abrirEncalheBox() {
  if (!bolaoSel || !bolaoSel.bolao_id) {
    mostrarToast(
      'Selecione um bolão antes de lançar o encalhe físico.',
      'err'
    );
    return;
  }

  if (!abrirOverlayEncalheBox()) {
    mostrarToast(
      'A caixa compacta de encalhe não foi encontrada no HTML.',
      'err'
    );
    return;
  }

  resetarEstadoEncalheBox();
  estadoEncalheBox.bolaoId = Number(bolaoSel.bolao_id);
  estadoEncalheBox.bolao = bolaoSel;

  const nome = $('encalheBoxNome');
  const tags = $('encalheBoxTags');
  const saldos = $('encalheSaldosGrid');
  const inputs = $('encalheInputsGrid');
  const total = $('encalheBoxTotal');
  const salvar = $('btnSalvarEncalheBox');

  if (nome) {
    nome.textContent =
      `${bolaoSel.modalidade || 'Bolão'} — Concurso ${bolaoSel.concurso || '—'}`;
  }

  if (tags) {
    tags.innerHTML = `
      <span class="btag">
        ${encalheBoxEscape(bolaoSel.origem_nome || 'Origem')}
      </span>
      <span class="btag">${fmtBRL(bolaoSel.valor_cota || 0)}/cota</span>
      <span class="btag">${encalheBoxInteiro(bolaoSel.qtd_jogos)} jogos</span>
      <span class="btag">${encalheBoxInteiro(bolaoSel.qtd_dezenas)} dez.</span>
      <span class="btag">${encalheBoxInteiro(bolaoSel.qtd_cotas_total)} cotas total</span>
    `;
  }

  if (saldos) {
    saldos.innerHTML = '<div class="apu-hint">Carregando saldos...</div>';
  }

  if (inputs) inputs.innerHTML = '';
  if (total) total.textContent = '0';
  if (salvar) salvar.disabled = true;

  mostrarStatusEncalheBox(
    'Consultando o saldo atual das lojas...',
    'info'
  );

  await carregarEncalheBox();
}

function calcularTotalDetalhado(lojas = estadoEncalheBox.lojas) {
  return (lojas || []).reduce(
    (soma, loja) => soma + encalheBoxInteiro(loja.encalhe_atual),
    0
  );
}

async function carregarEncalheBox() {
  if (!estadoEncalheBox.bolaoId) return;

  try {
    const { data, error } = await sb.rpc(
      'rpc_listar_lojas_encalhe_bolao',
      { p_bolao_id: estadoEncalheBox.bolaoId }
    );

    if (error) throw error;

    const resultado = data || {};
    const bolao = resultado.bolao || {};
    const lojas = Array.isArray(resultado.lojas)
      ? resultado.lojas
      : [];

    estadoEncalheBox.bolao = bolao;
    estadoEncalheBox.lojas = lojas;

    const totalGlobal = encalheBoxInteiro(bolao.enc_fisico_total);
    const totalDetalhado = bolao.enc_fisico_detalhado == null
      ? calcularTotalDetalhado(lojas)
      : encalheBoxInteiro(bolao.enc_fisico_detalhado);

    estadoEncalheBox.diferencaMigracao = totalGlobal - totalDetalhado;
    estadoEncalheBox.bloqueadoPorMigracao =
      estadoEncalheBox.diferencaMigracao !== 0;

    renderizarEncalheBox();

    if (estadoEncalheBox.bloqueadoPorMigracao) {
      mostrarStatusEncalheBox(
        `Este bolão possui ${Math.abs(estadoEncalheBox.diferencaMigracao)} ` +
        'cota(s) de encalhe físico ainda não vinculadas corretamente às lojas. ' +
        'Migre o encalhe atual para a origem antes de editar.',
        'err'
      );
    } else {
      mostrarStatusEncalheBox('');
    }
  } catch (erro) {
    console.error('Erro ao carregar a caixa de encalhe:', erro);

    mostrarStatusEncalheBox(
      erro?.message || 'Não foi possível carregar os saldos das lojas.',
      'err'
    );
  }
}

function renderizarEncalheBox() {
  const bolao = estadoEncalheBox.bolao || {};
  const lojas = estadoEncalheBox.lojas || [];
  const saldos = $('encalheSaldosGrid');
  const inputs = $('encalheInputsGrid');
  const tags = $('encalheBoxTags');

  if (tags) {
    tags.innerHTML = `
      <span class="btag">
        ${encalheBoxEscape(bolao.origem_nome || 'Origem')}
      </span>
      <span class="btag">${fmtBRL(bolao.valor_cota || 0)}/cota</span>
      <span class="btag">${encalheBoxInteiro(bolao.qtd_jogos)} jogos</span>
      <span class="btag">${encalheBoxInteiro(bolao.qtd_dezenas)} dez.</span>
      <span class="btag">${encalheBoxInteiro(bolao.qtd_cotas_total)} cotas total</span>
      ${
        estadoEncalheBox.bloqueadoPorMigracao
          ? '<span class="btag btag-warning">Migração necessária</span>'
          : ''
      }
    `;
  }

  if (!lojas.length) {
    if (saldos) {
      saldos.innerHTML = `
        <div class="apu-hint">
          Nenhuma loja relacionada ao bolão foi encontrada.
        </div>
      `;
    }

    if (inputs) inputs.innerHTML = '';
    atualizarTotalEncalheBox();
    return;
  }

  if (saldos) {
    saldos.innerHTML = lojas
      .map(loja => `
        <div class="encalhe-saldo-card ${loja.eh_origem ? 'origem' : ''}">
          <div class="encalhe-card-top">
            <div class="encalhe-card-loja">
              ${encalheBoxEscape(loja.loja_nome || 'Loja')}
            </div>
            ${
              loja.eh_origem
                ? '<span class="encalhe-card-badge">Origem</span>'
                : ''
            }
          </div>

          <div class="encalhe-card-valor">
            ${encalheBoxInteiro(loja.saldo_atual)}
          </div>

          <div class="encalhe-card-sub">
            Encalhe atual: ${encalheBoxInteiro(loja.encalhe_atual)}
            · Máximo absoluto: ${encalheBoxInteiro(loja.total_disponivel)}
          </div>
        </div>
      `)
      .join('');
  }

  if (inputs) {
    inputs.innerHTML = lojas
      .map(loja => {
        const loteriaId = Number(loja.loteria_id);
        const atual = encalheBoxInteiro(loja.encalhe_atual);
        const maximo = encalheBoxInteiro(loja.total_disponivel);

        return `
          <div class="encalhe-input-card" data-card-loteria-id="${loteriaId}">
            <label for="encalheLoja_${loteriaId}">
              ${encalheBoxEscape(loja.loja_nome || 'Loja')}
              ${loja.eh_origem ? ' · origem' : ''}
            </label>

            <input
              type="number"
              id="encalheLoja_${loteriaId}"
              class="encalhe-loja-input"
              min="0"
              max="${maximo}"
              step="1"
              inputmode="numeric"
              value="${atual}"
              data-loteria-id="${loteriaId}"
              data-atual="${atual}"
              data-maximo="${maximo}"
              ${estadoEncalheBox.bloqueadoPorMigracao ? 'disabled' : ''}
              aria-label="Encalhe físico de ${encalheBoxEscape(loja.loja_nome || 'Loja')}"
            />

            <div class="encalhe-card-sub">
              Atual: ${atual} · Máximo: ${maximo}
            </div>
          </div>
        `;
      })
      .join('');

    inputs
      .querySelectorAll('.encalhe-loja-input')
      .forEach(input => {
        input.addEventListener('input', atualizarTotalEncalheBox);
      });
  }

  atualizarTotalEncalheBox();
}

function analisarEncalheBox() {
  const inputs = [
    ...document.querySelectorAll(
      '#encalheInputsGrid .encalhe-loja-input'
    )
  ];

  const alteracoes = [];
  let total = 0;

  if (estadoEncalheBox.bloqueadoPorMigracao) {
    return {
      valido: false,
      erro:
        'O encalhe físico atual precisa ser migrado para a origem antes de qualquer edição por loja.',
      alteracoes: [],
      total: calcularTotalDetalhado()
    };
  }

  for (const input of inputs) {
    const loteriaId = Number(input.dataset.loteriaId);
    const atual = encalheBoxInteiro(input.dataset.atual);
    const maximo = encalheBoxInteiro(input.dataset.maximo);
    const texto = input.value.trim();

    if (texto === '') {
      return {
        valido: false,
        erro: 'Preencha o encalhe de todas as lojas.',
        alteracoes: [],
        total: 0
      };
    }

    const novo = Number(texto);

    if (!Number.isInteger(novo) || novo < 0) {
      return {
        valido: false,
        erro: 'Os encalhes devem ser números inteiros iguais ou maiores que zero.',
        alteracoes: [],
        total: 0
      };
    }

    if (novo > maximo) {
      const loja = estadoEncalheBox.lojas.find(
        item => Number(item.loteria_id) === loteriaId
      );

      return {
        valido: false,
        erro:
          `${loja?.loja_nome || 'A loja'} possui no máximo ` +
          `${maximo} cota(s) disponíveis para encalhe.`,
        alteracoes: [],
        total: 0
      };
    }

    total += novo;

    if (novo !== atual) {
      const loja = estadoEncalheBox.lojas.find(
        item => Number(item.loteria_id) === loteriaId
      );

      alteracoes.push({
        loteriaId,
        lojaNome: loja?.loja_nome || 'Loja',
        ehOrigem: Boolean(loja?.eh_origem),
        atual,
        novo,
        delta: novo - atual
      });
    }
  }

  const totalCotas = encalheBoxInteiro(
    estadoEncalheBox.bolao?.qtd_cotas_total
  );

  if (total > totalCotas) {
    return {
      valido: false,
      erro: `O encalhe total excede as ${totalCotas} cotas do bolão.`,
      alteracoes: [],
      total
    };
  }

  if (alteracoes.length > 1) {
    return {
      valido: false,
      erro: 'Altere somente uma loja por vez e salve antes de editar outra.',
      alteracoes,
      total
    };
  }

  return {
    valido: true,
    erro: '',
    alteracoes,
    total
  };
}

function destacarAlteracoesEncalheBox() {
  document
    .querySelectorAll('#encalheInputsGrid .encalhe-loja-input')
    .forEach(input => {
      const atual = encalheBoxInteiro(input.dataset.atual);
      const novo = encalheBoxInteiro(input.value);
      const card = input.closest('.encalhe-input-card');

      card?.classList.toggle('alterado', novo !== atual);
    });
}

function atualizarTotalEncalheBox() {
  destacarAlteracoesEncalheBox();

  const analise = analisarEncalheBox();
  const total = $('encalheBoxTotal');
  const salvar = $('btnSalvarEncalheBox');

  if (total) {
    total.textContent = String(encalheBoxInteiro(analise.total));
  }

  if (salvar) {
    salvar.disabled =
      estadoEncalheBox.salvando ||
      !analise.valido ||
      analise.alteracoes.length !== 1;
  }

  if (!analise.valido) {
    mostrarStatusEncalheBox(analise.erro, 'err');
    return analise;
  }

  if (analise.alteracoes.length === 1) {
    const alteracao = analise.alteracoes[0];
    const deltaMovimentacao = alteracao.ehOrigem
      ? 0
      : -alteracao.delta;

    let efeito = 'sem movimentação de cotas';

    if (deltaMovimentacao < 0) {
      efeito = `movimentação ${deltaMovimentacao} para retornar cota(s) à origem`;
    } else if (deltaMovimentacao > 0) {
      efeito = `movimentação +${deltaMovimentacao} para devolver cota(s) à loja`;
    }

    mostrarStatusEncalheBox(
      `${alteracao.lojaNome}: ${alteracao.atual} → ${alteracao.novo}; ${efeito}.`,
      'info'
    );
  } else {
    mostrarStatusEncalheBox('');
  }

  return analise;
}

function limparAlteracoesEncalheBox() {
  document
    .querySelectorAll('#encalheInputsGrid .encalhe-loja-input')
    .forEach(input => {
      input.value = String(encalheBoxInteiro(input.dataset.atual));
    });

  atualizarTotalEncalheBox();
}

function atualizarBolaoNaTelaAposEncalhe(totalAtualizado) {
  if ($('inputEncFisico')) {
    $('inputEncFisico').value = String(totalAtualizado);
  }

  if (bolaoSel) {
    bolaoSel.enc_fisico = totalAtualizado;
  }

  const registroLista = todosBoloes.find(
    item => Number(item.bolao_id) === Number(estadoEncalheBox.bolaoId)
  );

  if (registroLista) {
    registroLista.enc_fisico = totalAtualizado;
  }

  if ($('panelNome') && bolaoSel) {
    $('panelNome').innerHTML = resumoBolaoHTML(bolaoSel, true);
  }

  const card = document.querySelector(
    `.bolao-card[data-id="${estadoEncalheBox.bolaoId}"]`
  );

  if (card && registroLista) {
    card.innerHTML = `
      ${resumoBolaoHTML(registroLista)}
      <div class="bolao-select-ind">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="2 6 5 9 10 3"/>
        </svg>
      </div>
    `;
    card.classList.add('selected');
  }

  renderResumoApuracao();
}

function resolverDataReferenciaEncalhe() {
  const dataSelecionada = isoDate(dataAtual);
  const dataInicial = isoDate(bolaoSel?.dt_inicial);
  const dataConcurso = isoDate(bolaoSel?.dt_concurso);

  if (!dataInicial || !dataConcurso) {
    return dataSelecionada;
  }

  if (!dataSelecionada || dataSelecionada < dataInicial) {
    return dataInicial;
  }

  if (dataSelecionada > dataConcurso) {
    return dataConcurso;
  }

  return dataSelecionada;
}

async function salvarEncalheBox() {
  if (estadoEncalheBox.salvando || !estadoEncalheBox.bolaoId) {
    return;
  }

  const analise = atualizarTotalEncalheBox();

  if (!analise.valido) return;

  if (analise.alteracoes.length !== 1) {
    mostrarStatusEncalheBox(
      analise.alteracoes.length
        ? 'Altere somente uma loja por vez.'
        : 'Nenhuma alteração de encalhe foi informada.',
      analise.alteracoes.length ? 'err' : 'info'
    );
    return;
  }

  const alteracao = analise.alteracoes[0];
  const botao = $('btnSalvarEncalheBox');
  estadoEncalheBox.salvando = true;

  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Salvando...';
  }

  mostrarStatusEncalheBox(
    `Salvando o encalhe de ${alteracao.lojaNome}...`,
    'info'
  );

  try {
    const { error: erroConfirmacao } = await sb.rpc(
      'rpc_confirmar_encalhe_loja',
      {
        p_bolao_id: estadoEncalheBox.bolaoId,
        p_loteria_id: alteracao.loteriaId,
        p_novo_encalhe: alteracao.novo,
        p_data_referencia: resolverDataReferenciaEncalhe(),
        p_observacao: 'Lançamento de encalhe físico pela apuração'
      }
    );

    if (erroConfirmacao) throw erroConfirmacao;

    const { data, error: erroRecarga } = await sb.rpc(
      'rpc_listar_lojas_encalhe_bolao',
      { p_bolao_id: estadoEncalheBox.bolaoId }
    );

    if (erroRecarga) throw erroRecarga;

    const totalAtualizado = encalheBoxInteiro(
      data?.bolao?.enc_fisico_total
    );

    atualizarBolaoNaTelaAposEncalhe(totalAtualizado);
    fecharEncalheBox();

    mostrarToast(
      `Encalhe de ${alteracao.lojaNome} salvo com sucesso.`,
      'ok'
    );
  } catch (erro) {
    console.error('Erro ao salvar encalhe físico:', {
      bolao_id: estadoEncalheBox.bolaoId,
      loja_id: alteracao.loteriaId,
      encalhe_anterior: alteracao.atual,
      encalhe_novo: alteracao.novo,
      data_referencia: resolverDataReferenciaEncalhe(),
      message: erro?.message || String(erro),
      details: erro?.details || null,
      hint: erro?.hint || null,
      code: erro?.code || null
    });

    const mensagemErro = [
      erro?.message,
      erro?.details,
      erro?.hint
    ].filter(Boolean).join(' — ');

    mostrarStatusEncalheBox(
      mensagemErro || 'Não foi possível salvar o encalhe físico.',
      'err'
    );
  } finally {
    estadoEncalheBox.salvando = false;

    if (botao) {
      botao.textContent = 'Salvar Encalhe';
    }

    if ($('encalheBoxOverlay')?.classList.contains('show')) {
      atualizarTotalEncalheBox();
    }
  }
}

function inicializarCaixaEncalhe() {
  const btnAbrir = $('btnDetalharEncFisico');
  const btnFechar = $('btnFecharEncalheBox');
  const btnLimpar = $('btnLimparEncalheBox');
  const btnSalvar = $('btnSalvarEncalheBox');
  const overlay = $('encalheBoxOverlay');

  btnAbrir?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    abrirEncalheBox();
  });

  btnFechar?.addEventListener('click', fecharEncalheBox);
  btnLimpar?.addEventListener('click', limparAlteracoesEncalheBox);
  btnSalvar?.addEventListener('click', salvarEncalheBox);

  overlay?.addEventListener('click', event => {
    if (event.target === overlay) fecharEncalheBox();
  });

  document.addEventListener('keydown', event => {
    if (
      event.key === 'Escape' &&
      overlay?.classList.contains('show')
    ) {
      fecharEncalheBox();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const btnPrev = $('btnDtPrev');
  const btnNext = $('btnDtNext');
  const btnHoje = $('btnHoje');
  const inputData = $('inputDataReferencia');
  const btnFecharPanel = $('btnFecharPanel');

  btnPrev?.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();

    await mudarData(-1);
  });

  btnNext?.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();

    await mudarData(1);
  });

  btnHoje?.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();

    dataAtual = hojeSaoPauloDate();
    await mudarData(0);
  });

  inputData?.addEventListener('change', async event => {
    const valorSelecionado = event.target.value;

    await selecionarDataReferencia(valorSelecionado);
  });

  btnFecharPanel?.addEventListener(
    'click',
    fecharPanel
  );

  inicializarCaixaEncalhe();
  init();
});
