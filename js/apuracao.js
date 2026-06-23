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

  btnFecharPanel?.addEventListener('click', fecharPanel);

  init();
});
/* =========================================================
ENCALHE FÍSICO POR LOJA - PAINEL EXPANDIDO
Etapa 1: abrir, listar lojas e simular alteração
========================================================= */

const encalheState = {
aberto: false,
carregando: false,
bolaoId: null,
bolao: null,
lojas: [],
lojaSelecionada: null,
previewAtual: null
};

function encEl(id) {
return document.getElementById(id);
}

function encInt(v) {
const n = Number(v);
return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function encFmtQtd(v) {
return String(encInt(v));
}

function encFmtMoney(v) {
if (typeof fmtMoney === 'function') {
return fmtMoney(v || 0);
}

if (typeof fmtBRL === 'function') {
return fmtBRL(v || 0);
}

return Number(v || 0).toLocaleString('pt-BR', {
style: 'currency',
currency: 'BRL'
});
}

function encFmtDataHora(v) {
if (!v) return '—';

try {
const d = new Date(v);

```
if (Number.isNaN(d.getTime())) {
  return String(v);
}

return d.toLocaleString('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});
```

} catch (_) {
return String(v);
}
}

function encGetBolaoSelecionado() {
if (typeof bolaoSel !== 'undefined' && bolaoSel) {
return bolaoSel;
}

if (window.bolaoSel) {
return window.bolaoSel;
}

return null;
}

function encGetBolaoId() {
const b = encGetBolaoSelecionado();

if (!b) return null;

return b.bolao_id || b.id || null;
}

function encGetDataReferencia() {
const input = encEl('inputDataReferencia');

if (input && input.value) {
return input.value;
}

const hoje = new Date();
const yyyy = hoje.getFullYear();
const mm = String(hoje.getMonth() + 1).padStart(2, '0');
const dd = String(hoje.getDate()).padStart(2, '0');

return `${yyyy}-${mm}-${dd}`;
}

function encShowStatus(msg, tipo = 'info') {
const bar = encEl('encalheStatusBar');

if (!bar) return;

bar.className = `status-bar show ${tipo}`;
bar.textContent = msg || '';
}

function encClearStatus() {
const bar = encEl('encalheStatusBar');

if (!bar) return;

bar.className = 'status-bar';
bar.textContent = '';
}

function encShowAlerta(msg, tipo = 'info') {
const box = encEl('encalheAlerta');

if (!box) return;

if (!msg) {
box.className = 'encalhe-alerta';
box.textContent = '';
return;
}

box.className = `encalhe-alerta show ${tipo}`;
box.textContent = msg;
}

function encSetLoading(ativo) {
encalheState.carregando = !!ativo;

const loading = encEl('encalheLoading');

if (loading) {
loading.style.display = ativo ? 'flex' : 'none';
}
}

function encResetEditor() {
encalheState.lojaSelecionada = null;
encalheState.previewAtual = null;

const vazia = encEl('encalheEdicaoVazia');
const conteudo = encEl('encalheEdicaoConteudo');

if (vazia) vazia.style.display = 'flex';
if (conteudo) conteudo.style.display = 'none';

const input = encEl('inputNovoEncalhe');
if (input) input.value = '';

encShowAlerta('', 'info');
}

function encAbrirPainel() {
const bolao = encGetBolaoSelecionado();
const bolaoId = encGetBolaoId();

if (!bolao || !bolaoId) {
if (typeof showToast === 'function') {
showToast('Selecione um bolão antes de detalhar o encalhe físico.', 'err');
} else {
alert('Selecione um bolão antes de detalhar o encalhe físico.');
}

```
return;
```

}

encalheState.aberto = true;
encalheState.bolaoId = bolaoId;
encalheState.bolao = bolao;

const overlay = encEl('encalheOverlay');

if (overlay) {
overlay.classList.add('open');
overlay.setAttribute('aria-hidden', 'false');
}

encClearStatus();
encResetEditor();

encEl('encalhePanelNome').textContent =
`${bolao.modalidade || 'Bolão'} ${bolao.concurso ? '• Concurso ' + bolao.concurso : ''}`;

encEl('encalhePanelTags').innerHTML = `     <span class="rtag rtag-accent">${encFmtMoney(bolao.valor_cota || 0)}</span>     <span class="rtag">${encFmtQtd(bolao.qtd_cotas_total || 0)} cotas</span>
  `;

encCarregarLojas();
}

function encFecharPainel() {
const overlay = encEl('encalheOverlay');

if (overlay) {
overlay.classList.remove('open');
overlay.setAttribute('aria-hidden', 'true');
}

encalheState.aberto = false;
encalheState.bolaoId = null;
encalheState.bolao = null;
encalheState.lojas = [];
encResetEditor();
encClearStatus();
}

async function encCarregarLojas() {
const bolaoId = encalheState.bolaoId;

if (!bolaoId) return;

encSetLoading(true);
encShowStatus('Consultando lojas e saldos do bolão...', 'info');

const lista = encEl('encalheLojasLista');

if (lista) {
lista.innerHTML = '';
}

try {
const { data, error } = await sb.rpc(
'rpc_listar_lojas_encalhe_bolao',
{
p_bolao_id: bolaoId
}
);

```
if (error) throw error;

const payload = data || {};

encalheState.bolao = payload.bolao || encalheState.bolao;
encalheState.lojas = Array.isArray(payload.lojas)
  ? payload.lojas
  : [];

encRenderResumoTopo(payload);
encRenderLojas();

encClearStatus();

if (!encalheState.lojas.length) {
  encShowStatus('Nenhuma loja encontrada para este bolão.', 'info');
}
```

} catch (err) {
console.error('Erro ao carregar lojas do encalhe:', err);

```
encShowStatus(
  err?.message || 'Erro ao carregar lojas do encalhe.',
  'err'
);
```

} finally {
encSetLoading(false);
}
}

function encRenderResumoTopo(payload) {
const bolao = payload?.bolao || encalheState.bolao || {};

const totalCotas = encEl('encalheTotalCotas');
const totalValor = encEl('encalheTotalValor');
const origemNome = encEl('encalheOrigemNome');
const valorCota = encEl('encalheValorCota');

if (totalCotas) {
totalCotas.textContent = encFmtQtd(bolao.qtd_cotas_total || 0);
}

if (totalValor) {
totalValor.textContent = encFmtQtd(bolao.enc_fisico_total || 0);
}

if (origemNome) {
origemNome.textContent = bolao.origem_nome || '—';
}

if (valorCota) {
valorCota.textContent = encFmtMoney(bolao.valor_cota || 0);
}

const tags = encEl('encalhePanelTags');

if (tags) {
const semDetalhe = encInt(bolao.enc_fisico_sem_detalhamento || 0);

```
tags.innerHTML = `
  <span class="rtag rtag-accent">${encFmtMoney(bolao.valor_cota || 0)}</span>
  <span class="rtag">${encFmtQtd(bolao.qtd_cotas_total || 0)} cotas</span>
  ${
    semDetalhe > 0
      ? `<span class="rtag rtag-blue">${semDetalhe} sem detalhar</span>`
      : ''
  }
`;
```

}
}

function encRenderLojas() {
const lista = encEl('encalheLojasLista');

if (!lista) return;

if (!encalheState.lojas.length) {
lista.innerHTML = `       <div class="apu-hint">
        Nenhuma loja encontrada para este bolão.       </div>
    `;
return;
}

lista.innerHTML = encalheState.lojas.map(loja => {
const selected =
encalheState.lojaSelecionada &&
Number(encalheState.lojaSelecionada.loteria_id) === Number(loja.loteria_id);

```
return `
  <button
    type="button"
    class="encalhe-loja-card ${selected ? 'selected' : ''}"
    data-loteria-id="${loja.loteria_id}"
  >
    <div class="encalhe-loja-card-top">
      <div class="encalhe-loja-card-nome">
        ${loja.loja_nome || 'Loja'}
      </div>

      ${
        loja.eh_origem
          ? '<div class="encalhe-loja-card-origem">Origem</div>'
          : ''
      }
    </div>

    <div class="encalhe-loja-card-valores">
      <div class="encalhe-loja-card-valor">
        <span>Saldo</span>
        <strong>${encFmtQtd(loja.saldo_atual || 0)}</strong>
      </div>

      <div class="encalhe-loja-card-valor">
        <span>Encalhe</span>
        <strong>${encFmtQtd(loja.encalhe_atual || 0)}</strong>
      </div>

      <div class="encalhe-loja-card-valor">
        <span>Total</span>
        <strong>${encFmtQtd(loja.total_disponivel || 0)}</strong>
      </div>
    </div>
  </button>
`;
```

}).join('');

lista.querySelectorAll('.encalhe-loja-card').forEach(btn => {
btn.addEventListener('click', () => {
const id = Number(btn.dataset.loteriaId);
const loja = encalheState.lojas.find(
item => Number(item.loteria_id) === id
);

```
  if (loja) {
    encSelecionarLoja(loja);
  }
});
```

});
}

async function encSelecionarLoja(loja) {
encalheState.lojaSelecionada = loja;
encRenderLojas();

const vazia = encEl('encalheEdicaoVazia');
const conteudo = encEl('encalheEdicaoConteudo');

if (vazia) vazia.style.display = 'none';
if (conteudo) conteudo.style.display = 'block';

const input = encEl('inputNovoEncalhe');
if (input) {
input.value = encInt(loja.encalhe_atual || 0);
}

await encAtualizarPreview();
}

async function encAtualizarPreview() {
const loja = encalheState.lojaSelecionada;

if (!loja || !encalheState.bolaoId) return;

const input = encEl('inputNovoEncalhe');
const novo = encInt(input ? input.value : loja.encalhe_atual);

encShowAlerta('', 'info');

try {
const { data, error } = await sb.rpc(
'rpc_preview_encalhe_loja',
{
p_bolao_id: encalheState.bolaoId,
p_loteria_id: loja.loteria_id,
p_novo_encalhe: novo
}
);

```
if (error) throw error;

encalheState.previewAtual = data || null;

encRenderPreview(data);
```

} catch (err) {
console.error('Erro no preview do encalhe:', err);

```
encShowAlerta(
  err?.message || 'Erro ao simular encalhe.',
  'err'
);
```

}
}

function encRenderPreview(payload) {
if (!payload) return;

const loja = payload.loja || {};
const valores = payload.valores || {};
const validacao = payload.validacao || {};
const movimentacoes = payload.movimentacoes || {};
const encalhes = payload.encalhes || {};

encEl('encalheLojaNome').textContent =
loja.nome || '—';

encEl('encalheLojaMeta').textContent =
[
loja.codigo ? `Código ${loja.codigo}` : null,
loja.eh_origem ? 'Loja de origem' : 'Loja destino'
].filter(Boolean).join(' • ');

const origemBadge = encEl('encalheLojaOrigemBadge');

if (origemBadge) {
origemBadge.style.display = loja.eh_origem ? 'inline-flex' : 'none';
}

encEl('encalheSaldoAtualValor').textContent =
encFmtQtd(valores.saldo_atual || 0);

encEl('encalheAtualValor').textContent =
encFmtQtd(valores.encalhe_atual || 0);

encEl('encalheDisponivelTotal').textContent =
encFmtQtd(valores.maximo_encalhe || 0);

const deltaEnc = encInt(valores.delta_encalhe || 0);
const movDelta = encInt(valores.movimento_delta || 0);

encEl('movHistoricoResumo').textContent =
movimentacoes.resumo || '0';

encEl('movOperacaoResumo').textContent =
movDelta === 0
? 'Sem movimentação'
: movDelta > 0
? `+${movDelta}`
: `[${movDelta}]`;

encEl('movSaldoProjetado').textContent =
encFmtQtd(valores.saldo_projetado || 0);

encEl('encHistoricoResumo').textContent =
encalhes.resumo || '[0]';

encEl('encAlteracaoResumo').textContent =
`[${encFmtQtd(valores.encalhe_atual || 0)}] → [${encFmtQtd(valores.novo_encalhe || 0)}]`;

encEl('encNovoTotalResumo').textContent =
encFmtQtd(valores.novo_encalhe || 0);

encRenderMovHistorico(movimentacoes.lista || []);
encRenderEncHistorico(encalhes.lista || []);

if (!validacao.valido) {
encShowAlerta(
validacao.mensagem || 'Alteração inválida.',
'err'
);
} else if (deltaEnc === 0) {
encShowAlerta(
'Informe um novo total diferente do encalhe atual para revisar.',
'info'
);
} else if (movDelta < 0) {
encShowAlerta(
'Esta alteração criará uma movimentação negativa automática para retornar cotas à origem.',
'info'
);
} else if (movDelta > 0) {
encShowAlerta(
'Esta alteração criará uma movimentação positiva automática para devolver cotas à loja.',
'info'
);
} else {
encShowAlerta(
'Esta alteração atualiza apenas o encalhe da loja de origem, sem movimentar cotas.',
'info'
);
}
}

function encRenderMovHistorico(lista) {
const box = encEl('movHistoricoLista');

if (!box) return;

if (!lista.length) {
box.textContent = 'Nenhuma movimentação.';
return;
}

box.innerHTML = lista.map(item => {
const efeito = encInt(item.efeito_loja || 0);
const efeitoTxt =
efeito < 0 ? `[${efeito}]` : `+${efeito}`;

```
return `
  <div class="encalhe-historico-item">
    <strong>${efeitoTxt}</strong>
    • ${item.origem_nome || 'Origem'} → ${item.destino_nome || 'Destino'}
    <br>
    ${encFmtDataHora(item.created_at)}
  </div>
`;
```

}).join('');
}

function encRenderEncHistorico(lista) {
const box = encEl('encHistoricoLista');

if (!box) return;

if (!lista.length) {
box.textContent = 'Nenhum encalhe registrado.';
return;
}

box.innerHTML = lista.map(item => {
return `       <div class="encalhe-historico-item">         <strong>[${encFmtQtd(item.qtd_anterior)}] → [${encFmtQtd(item.qtd_nova)}]</strong>         <br>
        ${encFmtDataHora(item.created_at)}       </div>
    `;
}).join('');
}

function encInitEventos() {
const btnAbrir = encEl('btnDetalharEncFisico');

if (btnAbrir) {
btnAbrir.addEventListener('click', encAbrirPainel);
}

[
'btnFecharEncalhe',
'btnCancelarEncalhePanel'
].forEach(id => {
const btn = encEl(id);

```
if (btn) {
  btn.addEventListener('click', encFecharPainel);
}
```

});

const input = encEl('inputNovoEncalhe');

if (input) {
input.addEventListener('input', () => {
encAtualizarPreview();
});
}

const btnLimpar = encEl('btnCancelarEdicaoEncalhe');

if (btnLimpar) {
btnLimpar.addEventListener('click', () => {
if (!encalheState.lojaSelecionada) return;

```
  const inputNovo = encEl('inputNovoEncalhe');

  if (inputNovo) {
    inputNovo.value = encInt(
      encalheState.lojaSelecionada.encalhe_atual || 0
    );
  }

  encAtualizarPreview();
});
```

}
}

document.addEventListener('DOMContentLoaded', encInitEventos);
