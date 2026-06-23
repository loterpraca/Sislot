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
      enc_fisico,
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
   ENCALHE FÍSICO POR LOJA
   Abertura, listagem de lojas e preview
========================================================= */

const estadoEncalhe = {
  bolaoId: null,
  bolao: null,
  lojas: [],
  lojaSelecionada: null,
  preview: null,
  previewTimer: null,
  previewSequencia: 0
};

function encalheEscape(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function encalheInteiro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : 0;
}

function encalheDataHora(valor) {
  if (!valor) return '—';

  const data = new Date(valor);

  if (Number.isNaN(data.getTime())) {
    return String(valor);
  }

  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function mostrarStatusEncalhe(mensagem, tipo = 'info') {
  const barra = $('encalheStatusBar');
  if (!barra) return;

  if (!mensagem) {
    barra.textContent = '';
    barra.className = 'status-bar';
    return;
  }

  barra.textContent = mensagem;
  barra.className = `status-bar show ${tipo}`;
}

function mostrarAlertaEncalhe(mensagem, tipo = 'info') {
  const alerta = $('encalheAlerta');
  if (!alerta) return;

  if (!mensagem) {
    alerta.textContent = '';
    alerta.className = 'encalhe-alerta';
    return;
  }

  alerta.textContent = mensagem;
  alerta.className = `encalhe-alerta show ${tipo}`;
}

function definirLoadingEncalhe(ativo) {
  const loading = $('encalheLoading');

  if (loading) {
    loading.style.display = ativo ? 'flex' : 'none';
  }
}

function limparEditorEncalhe() {
  estadoEncalhe.lojaSelecionada = null;
  estadoEncalhe.preview = null;

  const vazio = $('encalheEdicaoVazia');
  const conteudo = $('encalheEdicaoConteudo');
  const input = $('inputNovoEncalhe');

  if (vazio) vazio.style.display = 'flex';
  if (conteudo) conteudo.style.display = 'none';
  if (input) input.value = '';

  mostrarAlertaEncalhe('');

  const revisar = $('btnRevisarEncalhe');

  if (revisar) {
    revisar.disabled = true;
  }
}

async function abrirPainelEncalhe() {
  if (!bolaoSel || !bolaoSel.bolao_id) {
    mostrarToast(
      'Selecione um bolão antes de detalhar o encalhe físico.',
      'err'
    );
    return;
  }

  estadoEncalhe.bolaoId = Number(bolaoSel.bolao_id);
  estadoEncalhe.bolao = bolaoSel;
  estadoEncalhe.lojas = [];

  const overlay = $('encalheOverlay');

  if (!overlay) {
    mostrarToast(
      'O painel de encalhe não foi encontrado no HTML.',
      'err'
    );
    return;
  }

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');

  const nome = $('encalhePanelNome');
  const tags = $('encalhePanelTags');

  if (nome) {
    nome.textContent =
      `${bolaoSel.modalidade || 'Bolão'} · Concurso ${bolaoSel.concurso || '—'}`;
  }

  if (tags) {
    tags.innerHTML = `
      <span class="rtag rtag-accent">
        ${fmtBRL(bolaoSel.valor_cota || 0)}
      </span>

      <span class="rtag">
        ${encalheInteiro(bolaoSel.qtd_cotas_total)} cotas
      </span>
    `;
  }

  limparEditorEncalhe();

  mostrarStatusEncalhe(
    'Consultando lojas e saldos do bolão...',
    'info'
  );

  await carregarLojasEncalhe();
}

function fecharPainelEncalhe() {
  const overlay = $('encalheOverlay');

  if (overlay) {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  clearTimeout(estadoEncalhe.previewTimer);

  estadoEncalhe.bolaoId = null;
  estadoEncalhe.bolao = null;
  estadoEncalhe.lojas = [];
  estadoEncalhe.lojaSelecionada = null;
  estadoEncalhe.preview = null;

  mostrarStatusEncalhe('');
  limparEditorEncalhe();
}

async function carregarLojasEncalhe() {
  if (!estadoEncalhe.bolaoId) return;

  definirLoadingEncalhe(true);

  const lista = $('encalheLojasLista');

  if (lista) {
    lista.innerHTML = '';
  }

  try {
    const { data, error } = await sb.rpc(
      'rpc_listar_lojas_encalhe_bolao',
      {
        p_bolao_id: estadoEncalhe.bolaoId
      }
    );

    if (error) throw error;

    const resultado = data || {};

    estadoEncalhe.bolao =
      resultado.bolao || estadoEncalhe.bolao;

    estadoEncalhe.lojas =
      Array.isArray(resultado.lojas)
        ? resultado.lojas
        : [];

    renderizarTopoEncalhe(resultado.bolao || {});
    renderizarLojasEncalhe();

    mostrarStatusEncalhe('');

    if (!estadoEncalhe.lojas.length) {
      mostrarStatusEncalhe(
        'Nenhuma loja relacionada ao bolão foi encontrada.',
        'info'
      );
    }
  } catch (erro) {
    console.error('Erro ao carregar lojas do encalhe:', erro);

    mostrarStatusEncalhe(
      erro?.message ||
        'Não foi possível carregar as lojas do bolão.',
      'err'
    );
  } finally {
    definirLoadingEncalhe(false);
  }
}

function renderizarTopoEncalhe(bolao) {
  const totalCotas = $('encalheTotalCotas');
  const totalEncalhe = $('encalheTotalValor');
  const origem = $('encalheOrigemNome');
  const valorCota = $('encalheValorCota');
  const tags = $('encalhePanelTags');

  if (totalCotas) {
    totalCotas.textContent =
      encalheInteiro(bolao.qtd_cotas_total);
  }

  if (totalEncalhe) {
    totalEncalhe.textContent =
      encalheInteiro(bolao.enc_fisico_total);
  }

  if (origem) {
    origem.textContent = bolao.origem_nome || '—';
  }

  if (valorCota) {
    valorCota.textContent =
      fmtBRL(bolao.valor_cota || 0);
  }

  if (tags) {
    const semDetalhamento =
      encalheInteiro(
        bolao.enc_fisico_sem_detalhamento
      );

    tags.innerHTML = `
      <span class="rtag rtag-accent">
        ${fmtBRL(bolao.valor_cota || 0)}
      </span>

      <span class="rtag">
        ${encalheInteiro(bolao.qtd_cotas_total)} cotas
      </span>

      ${
        semDetalhamento > 0
          ? `
            <span class="rtag rtag-blue">
              ${semDetalhamento} sem detalhamento
            </span>
          `
          : ''
      }
    `;
  }
}

function renderizarLojasEncalhe() {
  const lista = $('encalheLojasLista');

  if (!lista) return;

  if (!estadoEncalhe.lojas.length) {
    lista.innerHTML = `
      <div class="apu-hint">
        Nenhuma loja encontrada.
      </div>
    `;
    return;
  }

  lista.innerHTML = estadoEncalhe.lojas
    .map(loja => {
      const selecionada =
        estadoEncalhe.lojaSelecionada &&
        Number(
          estadoEncalhe.lojaSelecionada.loteria_id
        ) === Number(loja.loteria_id);

      return `
        <button
          type="button"
          class="encalhe-loja-card ${selecionada ? 'selected' : ''}"
          data-loteria-id="${Number(loja.loteria_id)}"
        >
          <div class="encalhe-loja-card-top">
            <div class="encalhe-loja-card-nome">
              ${encalheEscape(loja.loja_nome || 'Loja')}
            </div>

            ${
              loja.eh_origem
                ? `
                  <div class="encalhe-loja-card-origem">
                    Origem
                  </div>
                `
                : ''
            }
          </div>

          <div class="encalhe-loja-card-valores">
            <div class="encalhe-loja-card-valor">
              <span>Saldo</span>
              <strong>${encalheInteiro(loja.saldo_atual)}</strong>
            </div>

            <div class="encalhe-loja-card-valor">
              <span>Encalhe</span>
              <strong>${encalheInteiro(loja.encalhe_atual)}</strong>
            </div>

            <div class="encalhe-loja-card-valor">
              <span>Total</span>
              <strong>${encalheInteiro(loja.total_disponivel)}</strong>
            </div>
          </div>
        </button>
      `;
    })
    .join('');
}

async function selecionarLojaEncalhe(loja) {
  estadoEncalhe.lojaSelecionada = loja;
  estadoEncalhe.preview = null;

  renderizarLojasEncalhe();

  const vazio = $('encalheEdicaoVazia');
  const conteudo = $('encalheEdicaoConteudo');
  const input = $('inputNovoEncalhe');

  if (vazio) vazio.style.display = 'none';
  if (conteudo) conteudo.style.display = 'block';

  if (input) {
    input.value =
      encalheInteiro(loja.encalhe_atual);
  }

  mostrarAlertaEncalhe('');

  await atualizarPreviewEncalhe();
}

function agendarPreviewEncalhe() {
  clearTimeout(estadoEncalhe.previewTimer);

  estadoEncalhe.previewTimer = setTimeout(() => {
    atualizarPreviewEncalhe();
  }, 250);
}

async function atualizarPreviewEncalhe() {
  const loja = estadoEncalhe.lojaSelecionada;
  const input = $('inputNovoEncalhe');

  if (!loja || !estadoEncalhe.bolaoId || !input) {
    return;
  }

  const valorDigitado = input.value.trim();

  if (valorDigitado === '') {
    estadoEncalhe.preview = null;

    mostrarAlertaEncalhe(
      'Informe o novo total exato do encalhe da loja.',
      'info'
    );

    const revisar = $('btnRevisarEncalhe');

    if (revisar) revisar.disabled = true;

    return;
  }

  const novoEncalhe = Number(valorDigitado);

  if (!Number.isInteger(novoEncalhe) || novoEncalhe < 0) {
    mostrarAlertaEncalhe(
      'Informe uma quantidade inteira igual ou maior que zero.',
      'err'
    );

    const revisar = $('btnRevisarEncalhe');

    if (revisar) revisar.disabled = true;

    return;
  }

  const sequencia =
    ++estadoEncalhe.previewSequencia;

  try {
    const { data, error } = await sb.rpc(
      'rpc_preview_encalhe_loja',
      {
        p_bolao_id: estadoEncalhe.bolaoId,
        p_loteria_id: Number(loja.loteria_id),
        p_novo_encalhe: novoEncalhe
      }
    );

    if (error) throw error;

    if (sequencia !== estadoEncalhe.previewSequencia) {
      return;
    }

    estadoEncalhe.preview = data || null;

    renderizarPreviewEncalhe(data || {});
  } catch (erro) {
    console.error(
      'Erro ao consultar preview do encalhe:',
      erro
    );

    estadoEncalhe.preview = null;

    mostrarAlertaEncalhe(
      erro?.message ||
        'Não foi possível calcular o encalhe.',
      'err'
    );

    const revisar = $('btnRevisarEncalhe');

    if (revisar) revisar.disabled = true;
  }
}

function renderizarPreviewEncalhe(resultado) {
  const loja = resultado.loja || {};
  const valores = resultado.valores || {};
  const validacao = resultado.validacao || {};
  const movimentacoes = resultado.movimentacoes || {};
  const encalhes = resultado.encalhes || {};

  if ($('encalheLojaNome')) {
    $('encalheLojaNome').textContent =
      loja.nome || '—';
  }

  if ($('encalheLojaMeta')) {
    $('encalheLojaMeta').textContent = [
      loja.codigo
        ? `Código ${loja.codigo}`
        : null,

      loja.eh_origem
        ? 'Loja de origem'
        : 'Loja destino'
    ]
      .filter(Boolean)
      .join(' • ');
  }

  if ($('encalheLojaOrigemBadge')) {
    $('encalheLojaOrigemBadge').style.display =
      loja.eh_origem ? 'inline-flex' : 'none';
  }

  if ($('encalheSaldoAtualValor')) {
    $('encalheSaldoAtualValor').textContent =
      encalheInteiro(valores.saldo_atual);
  }

  if ($('encalheAtualValor')) {
    $('encalheAtualValor').textContent =
      encalheInteiro(valores.encalhe_atual);
  }

  if ($('encalheDisponivelTotal')) {
    $('encalheDisponivelTotal').textContent =
      encalheInteiro(valores.maximo_encalhe);
  }

  const deltaEncalhe =
    encalheInteiro(valores.delta_encalhe);

  const deltaMovimento =
    encalheInteiro(valores.movimento_delta);

  if ($('movHistoricoResumo')) {
    $('movHistoricoResumo').textContent =
      movimentacoes.resumo || '0';
  }

  if ($('movOperacaoResumo')) {
    $('movOperacaoResumo').textContent =
      deltaMovimento === 0
        ? 'Sem movimentação'
        : deltaMovimento > 0
          ? `+${deltaMovimento}`
          : `[${deltaMovimento}]`;
  }

  if ($('movSaldoProjetado')) {
    $('movSaldoProjetado').textContent =
      encalheInteiro(valores.saldo_projetado);
  }

  if ($('encHistoricoResumo')) {
    $('encHistoricoResumo').textContent =
      encalhes.resumo || '[0]';
  }

  if ($('encAlteracaoResumo')) {
    $('encAlteracaoResumo').textContent =
      `[${encalheInteiro(valores.encalhe_atual)}] → ` +
      `[${encalheInteiro(valores.novo_encalhe)}]`;
  }

  if ($('encNovoTotalResumo')) {
    $('encNovoTotalResumo').textContent =
      encalheInteiro(valores.novo_encalhe);
  }

  renderizarHistoricoMovimentacoes(
    movimentacoes.lista || []
  );

  renderizarHistoricoEncalhes(
    encalhes.lista || []
  );

  const revisar = $('btnRevisarEncalhe');

  const podeRevisar =
    validacao.valido !== false &&
    deltaEncalhe !== 0;

  if (revisar) {
    revisar.disabled = !podeRevisar;
  }

  if (validacao.valido === false) {
    mostrarAlertaEncalhe(
      validacao.mensagem ||
        'A alteração informada não é válida.',
      'err'
    );
    return;
  }

  if (deltaEncalhe === 0) {
    mostrarAlertaEncalhe(
      'O novo encalhe é igual ao encalhe atual da loja.',
      'info'
    );
    return;
  }

  if (deltaMovimento < 0) {
    mostrarAlertaEncalhe(
      'Será criada uma movimentação negativa automática para retornar as cotas à origem.',
      'info'
    );
    return;
  }

  if (deltaMovimento > 0) {
    mostrarAlertaEncalhe(
      'Será criada uma movimentação positiva automática para devolver as cotas à loja.',
      'info'
    );
    return;
  }

  mostrarAlertaEncalhe(
    'A loja de origem será atualizada sem gerar movimentação de cotas.',
    'info'
  );
}

function renderizarHistoricoMovimentacoes(lista) {
  const box = $('movHistoricoLista');

  if (!box) return;

  if (!Array.isArray(lista) || !lista.length) {
    box.textContent = 'Nenhuma movimentação.';
    return;
  }

  box.innerHTML = lista
    .map(item => {
      const efeito =
        encalheInteiro(item.efeito_loja);

      const efeitoTexto =
        efeito < 0
          ? `[${efeito}]`
          : `+${efeito}`;

      return `
        <div class="encalhe-historico-item">
          <strong>${efeitoTexto}</strong>
          ·
          ${encalheEscape(item.origem_nome || 'Origem')}
          →
          ${encalheEscape(item.destino_nome || 'Destino')}

          <br>

          ${encalheDataHora(item.created_at)}
        </div>
      `;
    })
    .join('');
}

function renderizarHistoricoEncalhes(lista) {
  const box = $('encHistoricoLista');

  if (!box) return;

  if (!Array.isArray(lista) || !lista.length) {
    box.textContent =
      'Nenhum encalhe registrado.';
    return;
  }

  box.innerHTML = lista
    .map(item => `
      <div class="encalhe-historico-item">
        <strong>
          [${encalheInteiro(item.qtd_anterior)}]
          →
          [${encalheInteiro(item.qtd_nova)}]
        </strong>

        <br>

        ${encalheDataHora(item.created_at)}
      </div>
    `)
    .join('');
}

function inicializarEncalheFisico() {
  const btnAbrir = $('btnDetalharEncFisico');
  const btnFechar = $('btnFecharEncalhe');
  const btnVoltar = $('btnCancelarEncalhePanel');
  const btnLimpar = $('btnCancelarEdicaoEncalhe');
  const overlay = $('encalheOverlay');
  const lista = $('encalheLojasLista');
  const inputNovo = $('inputNovoEncalhe');
  const btnRevisar = $('btnRevisarEncalhe');

  btnAbrir?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();

    abrirPainelEncalhe();
  });

  btnFechar?.addEventListener(
    'click',
    fecharPainelEncalhe
  );

  btnVoltar?.addEventListener(
    'click',
    fecharPainelEncalhe
  );

  overlay?.addEventListener('click', event => {
    if (event.target === overlay) {
      fecharPainelEncalhe();
    }
  });

  lista?.addEventListener('click', event => {
    const card =
      event.target.closest('.encalhe-loja-card');

    if (!card) return;

    const loteriaId =
      Number(card.dataset.loteriaId);

    const loja =
      estadoEncalhe.lojas.find(
        item =>
          Number(item.loteria_id) === loteriaId
      );

    if (loja) {
      selecionarLojaEncalhe(loja);
    }
  });

  inputNovo?.addEventListener(
    'input',
    agendarPreviewEncalhe
  );

  btnLimpar?.addEventListener('click', () => {
    const loja =
      estadoEncalhe.lojaSelecionada;

    if (!loja || !inputNovo) return;

    inputNovo.value =
      encalheInteiro(loja.encalhe_atual);

    atualizarPreviewEncalhe();
  });

  if (btnRevisar) {
    btnRevisar.disabled = true;
  }

  document.addEventListener('keydown', event => {
    if (
      event.key === 'Escape' &&
      $('encalheOverlay')?.classList.contains('open')
    ) {
      fecharPainelEncalhe();
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

  inicializarEncalheFisico();
  init();
});

