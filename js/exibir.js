const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

const $ = id => document.getElementById(id);

const VIEW_BOLAO = 'view_boloes_exibicao_operacional';
const VIEW_VENDAS = 'view_boloes_exibicao_operacional_vendas';
const VIEW_LOJAS = 'view_boloes_exibicao_operacional_lojas';

const VIEW_USUARIO_CONTEXTO = 'vw_usuario_contexto';
const VIEW_USUARIOS_LOTERIAS_ATIVAS = 'vw_usuarios_loterias_ativas';

let usuario = null;
let usuarios = [];
let lojas = [];

const slugsLojas = ['boulevard', 'centro', 'lotobel', 'santa-tereza', 'via-brasil'];
const slugLabel = {
  boulevard: 'BLD',
  centro: 'CTR',
  lotobel: 'LTB',
  'santa-tereza': 'STZ',
  'via-brasil': 'VIA'
};

let filtroTimer = null;
let boloesCache = [];
let bolaoSelecionadoModal = null;
let modalBusy = false;
/* ============================================================
   ORDENAÇÃO RESPONSIVA
   - Cabeçalho: ordenação simples
   - Botão Ordenar: múltiplos níveis
   - Padrão: bolões mais recentes no topo
============================================================ */

const SORT_OPTIONS = [
  {
    key: 'created_at',
    label: 'Criação',
    type: 'date',
    defaultDir: 'desc',
    fallback: 'bolao_id',
    ascLabel: 'Mais antiga primeiro',
    descLabel: 'Mais recente primeiro',
    shortAsc: '↑',
    shortDesc: '↓'
  },
  {
    key: 'dt_inicial',
    label: 'Data inicial',
    type: 'date',
    defaultDir: 'asc',
    ascLabel: 'Mais antiga primeiro',
    descLabel: 'Mais recente primeiro',
    shortAsc: '↑',
    shortDesc: '↓'
  },
  {
    key: 'dt_concurso',
    label: 'Data do concurso',
    type: 'date',
    defaultDir: 'asc',
    ascLabel: 'Mais antiga primeiro',
    descLabel: 'Mais recente primeiro',
    shortAsc: '↑',
    shortDesc: '↓'
  },
  {
    key: 'concurso',
    label: 'Concurso',
    type: 'numberText',
    defaultDir: 'desc',
    ascLabel: 'Menor primeiro',
    descLabel: 'Maior primeiro',
    shortAsc: '↑',
    shortDesc: '↓'
  },
  {
    key: 'modalidade',
    label: 'Modalidade',
    type: 'text',
    defaultDir: 'asc',
    ascLabel: 'A → Z',
    descLabel: 'Z → A',
    shortAsc: 'A-Z',
    shortDesc: 'Z-A'
  },
  {
    key: 'origem_nome',
    label: 'Loja origem',
    type: 'text',
    defaultDir: 'asc',
    ascLabel: 'A → Z',
    descLabel: 'Z → A',
    shortAsc: 'A-Z',
    shortDesc: 'Z-A'
  },
  {
    key: 'valor_cota',
    label: 'Valor da cota',
    type: 'number',
    defaultDir: 'asc',
    ascLabel: 'Menor primeiro',
    descLabel: 'Maior primeiro',
    shortAsc: '↑',
    shortDesc: '↓'
  },
  {
    key: 'qtd_cotas_total',
    label: 'Qtd. cotas',
    type: 'number',
    defaultDir: 'desc',
    ascLabel: 'Menor primeiro',
    descLabel: 'Maior primeiro',
    shortAsc: '↑',
    shortDesc: '↓'
  },
  {
    key: 'qtd_jogos',
    label: 'Jogos',
    type: 'number',
    defaultDir: 'desc',
    ascLabel: 'Menor primeiro',
    descLabel: 'Maior primeiro',
    shortAsc: '↑',
    shortDesc: '↓'
  },
  {
    key: 'qtd_dezenas',
    label: 'Dezenas',
    type: 'number',
    defaultDir: 'desc',
    ascLabel: 'Menor primeiro',
    descLabel: 'Maior primeiro',
    shortAsc: '↑',
    shortDesc: '↓'
  }
];

const SORT_MAP = Object.fromEntries(SORT_OPTIONS.map(o => [o.key, o]));

let ordenacoes = [
  { key: 'created_at', dir: 'desc' }
];

let ordenacoesDraft = [];

function getSortDef(key) {
  return SORT_MAP[key] || SORT_OPTIONS[0];
}

function getDirLabel(key, dir) {
  const def = getSortDef(key);
  return dir === 'asc' ? def.ascLabel : def.descLabel;
}

function getShortDir(key, dir) {
  const def = getSortDef(key);
  return dir === 'asc' ? def.shortAsc : def.shortDesc;
}

function normalizarTexto(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function valorOrdenacao(row, key) {
  const def = getSortDef(key);
  let v = row?.[key];

  if ((v === null || v === undefined || v === '') && def.fallback) {
    v = row?.[def.fallback];
  }

  if (v === null || v === undefined || v === '') return null;

  if (def.type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  if (def.type === 'numberText') {
    const n = Number(String(v).replace(/\D/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  if (def.type === 'date') {
    const s = String(v).slice(0, 10);
    const t = new Date(`${s}T00:00:00`).getTime();

    if (Number.isFinite(t)) return t;

    return Number(row?.bolao_id || 0);
  }

  return normalizarTexto(v);
}

function compararValores(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  return String(a).localeCompare(String(b), 'pt-BR', {
    numeric: true,
    sensitivity: 'base'
  });
}

function ordenarBoloes(lista) {
  return [...(lista || [])].sort((a, b) => {
    for (const ord of ordenacoes) {
      const va = valorOrdenacao(a, ord.key);
      const vb = valorOrdenacao(b, ord.key);
      const cmp = compararValores(va, vb);

      if (cmp !== 0) {
        return ord.dir === 'asc' ? cmp : -cmp;
      }
    }

    return Number(b?.bolao_id || 0) - Number(a?.bolao_id || 0);
  });
}

function sortAtivo(key) {
  return ordenacoes.find(o => o.key === key) || null;
}

function ordenarPorCabecalho(key) {
  const def = getSortDef(key);
  const ativo = ordenacoes.length === 1 && ordenacoes[0].key === key;

  if (ativo) {
    ordenacoes[0].dir = ordenacoes[0].dir === 'asc' ? 'desc' : 'asc';
  } else {
    ordenacoes = [{ key, dir: def.defaultDir || 'asc' }];
  }

  exibir();
}

function sortTh(key, label, extraClass = '', labelHtml = label) {
  const ativo = sortAtivo(key);
  const seta = ativo ? getShortDir(key, ativo.dir) : '';

  return `
    <th
      class="${extraClass} sortable-th ${ativo ? 'active' : ''}"
      data-sort="${key}"
      title="Clique para ordenar por ${label}"
    >
      <span class="sort-label">${labelHtml}</span>
      ${ativo ? `<span class="sort-arrow">${seta}</span>` : ''}
    </th>
  `;
}

function bindOrdenacaoCabecalho() {
  document.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      ordenarPorCabecalho(th.dataset.sort);
    });
  });
}

function renderResumoOrdenacao() {
  const textoCurto = ordenacoes
    .map((o, idx) => {
      const def = getSortDef(o.key);
      return `${idx + 1}º ${def.label} ${getShortDir(o.key, o.dir)}`;
    })
    .join(' · ');

  const btn = $('sortResumoBtn');
  if (btn) btn.textContent = textoCurto || 'Criação ↓';

  const linha = $('sortResumoLinha');
  if (!linha) return;

  linha.innerHTML = `
    <span class="sort-summary-label">Ordenação:</span>
    ${ordenacoes.map((o, idx) => {
      const def = getSortDef(o.key);
      return `
        <span class="sort-chip">
          ${idx + 1}º ${def.label} ${getShortDir(o.key, o.dir)}
        </span>
      `;
    }).join('')}
  `;
}

function abrirPainelOrdenacao() {
  ordenacoesDraft = ordenacoes.map(o => ({ ...o }));
  renderPainelOrdenacao();

  $('sortOverlay')?.classList.add('show');
  $('sortOverlay')?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function fecharPainelOrdenacao() {
  $('sortOverlay')?.classList.remove('show');
  $('sortOverlay')?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function optionsCamposSort(selectedKey) {
  return SORT_OPTIONS.map(opt => {
    const selected = opt.key === selectedKey ? 'selected' : '';
    return `<option value="${opt.key}" ${selected}>${opt.label}</option>`;
  }).join('');
}

function optionsDirecaoSort(key, selectedDir) {
  const ascSelected = selectedDir === 'asc' ? 'selected' : '';
  const descSelected = selectedDir === 'desc' ? 'selected' : '';

  return `
    <option value="asc" ${ascSelected}>${getDirLabel(key, 'asc')}</option>
    <option value="desc" ${descSelected}>${getDirLabel(key, 'desc')}</option>
  `;
}

function renderPainelOrdenacao() {
  const box = $('sortNiveis');
  if (!box) return;

  box.innerHTML = ordenacoesDraft.map((ord, idx) => {
    return `
      <div class="sort-level-row" data-idx="${idx}">
        <div class="sort-level-number">${idx + 1}º</div>

        <div class="sort-level-field">
          <label>Campo</label>
          <select class="sort-field" data-idx="${idx}">
            ${optionsCamposSort(ord.key)}
          </select>
        </div>

        <div class="sort-level-dir">
          <label>Direção</label>
          <select class="sort-dir" data-idx="${idx}">
            ${optionsDirecaoSort(ord.key, ord.dir)}
          </select>
        </div>

        <button class="sort-remove" data-idx="${idx}" type="button" ${ordenacoesDraft.length === 1 ? 'disabled' : ''}>
          Remover
        </button>
      </div>
    `;
  }).join('');
}

function removerDuplicatasOrdenacaoDraft() {
  const usados = new Set();

  ordenacoesDraft = ordenacoesDraft.filter(o => {
    if (usados.has(o.key)) return false;
    usados.add(o.key);
    return true;
  });

  if (!ordenacoesDraft.length) {
    ordenacoesDraft = [{ key: 'created_at', dir: 'desc' }];
  }
}

function adicionarNivelOrdenacao() {
  const usados = new Set(ordenacoesDraft.map(o => o.key));
  const proximo = SORT_OPTIONS.find(o => !usados.has(o.key));

  if (!proximo) return;

  ordenacoesDraft.push({
    key: proximo.key,
    dir: proximo.defaultDir || 'asc'
  });

  renderPainelOrdenacao();
}

function restaurarOrdenacaoPadrao() {
  ordenacoesDraft = [{ key: 'created_at', dir: 'desc' }];
  renderPainelOrdenacao();
}

function aplicarOrdenacaoPainel() {
  removerDuplicatasOrdenacaoDraft();
  ordenacoes = ordenacoesDraft.map(o => ({ ...o }));
  fecharPainelOrdenacao();
  exibir();
}

function bindPainelOrdenacao() {
  $('btnOrdenar')?.addEventListener('click', abrirPainelOrdenacao);
  $('sortFechar')?.addEventListener('click', fecharPainelOrdenacao);
  $('sortAdicionar')?.addEventListener('click', adicionarNivelOrdenacao);
  $('sortPadrao')?.addEventListener('click', restaurarOrdenacaoPadrao);
  $('sortAplicar')?.addEventListener('click', aplicarOrdenacaoPainel);

  $('sortOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'sortOverlay') fecharPainelOrdenacao();
  });

  $('sortNiveis')?.addEventListener('change', (e) => {
    const idx = Number(e.target.dataset.idx);
    if (!Number.isInteger(idx) || !ordenacoesDraft[idx]) return;

    if (e.target.classList.contains('sort-field')) {
      const key = e.target.value;
      const def = getSortDef(key);

      ordenacoesDraft[idx] = {
        key,
        dir: def.defaultDir || 'asc'
      };

      removerDuplicatasOrdenacaoDraft();
      renderPainelOrdenacao();
      return;
    }

    if (e.target.classList.contains('sort-dir')) {
      ordenacoesDraft[idx].dir = e.target.value;
      renderPainelOrdenacao();
    }
  });

  $('sortNiveis')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-remove');
    if (!btn) return;

    const idx = Number(btn.dataset.idx);
    if (!Number.isInteger(idx)) return;

    ordenacoesDraft.splice(idx, 1);
    removerDuplicatasOrdenacaoDraft();
    renderPainelOrdenacao();
  });
}
function fmtBRL(v) {
  return v == null || v === '' ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtN(v) {
  return v == null ? '—' : Number(v).toLocaleString('pt-BR');
}

function fmtDate(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateInput(s) {
  return s ? String(s).slice(0, 10) : '';
}

function fmtPair(a, b) {
  const aa = a == null ? '—' : Number(a).toLocaleString('pt-BR');
  const bb = b == null ? '—' : Number(b).toLocaleString('pt-BR');
  return `${aa}/${bb}`;
}

function hojeISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function updateClock() {
  const n = new Date();
  $('relogio').textContent =
    n.toLocaleTimeString('pt-BR') + ' — ' +
    n.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
}

function agendarExibicao() {
  clearTimeout(filtroTimer);
  filtroTimer = setTimeout(() => {
    exibir();
  }, 250);
}

function limparSelecaoBoloes() {
  document.querySelectorAll('.bolao-check').forEach(chk => {
    chk.checked = false;
  });
}

function setModalBusyState(busy, mode = '') {
  modalBusy = busy;

  const btnSalvar = $('bmConfirmar');
  const btnFechar = $('bmFechar');
  const btnCancelar = $('bmCancelar');
  const btnDeletar = $('bmDeletar');

  if (btnSalvar) {
    btnSalvar.disabled = busy || btnSalvar.dataset.locked === '1';
    btnSalvar.dataset.originalText = btnSalvar.dataset.originalText || 'Salvar alterações';
    btnSalvar.textContent = busy && mode === 'save' ? 'Salvando...' : btnSalvar.dataset.originalText;
  }

  if (btnDeletar) {
    btnDeletar.disabled = busy || btnDeletar.dataset.locked === '1';
    btnDeletar.dataset.originalText = btnDeletar.dataset.originalText || 'Deletar bolão';
    btnDeletar.textContent = busy && mode === 'delete' ? 'Deletando...' : btnDeletar.dataset.originalText;
  }

  if (btnFechar) btnFechar.disabled = busy;
  if (btnCancelar) btnCancelar.disabled = busy;
}

function mostrarAvisoModal(msg) {
  const el = $('bmAviso');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}

function mostrarSucessoModal(msg) {
  const el = $('bmSucesso');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}

function normalizarErroCancelamento(err) {
  const raw = err?.message || err?.details || err?.hint || 'Não foi possível deletar o bolão.';
  const msg = String(raw);

  if (/vendas lançadas/i.test(msg) || /já possui venda/i.test(msg)) {
    return 'Este bolão já possui venda registrada e não pode ser deletado.';
  }
  if (/fechamento lançado/i.test(msg) || /possui fechamento/i.test(msg)) {
    return 'Este bolão já possui lançamento em fechamento e não pode ser deletado.';
  }
  if (/PAGO/i.test(msg) || /já acertada/i.test(msg) || /já quitada/i.test(msg)) {
    return 'Este bolão possui movimentação financeira já quitada e não pode ser deletado.';
  }
  if (/não encontrado/i.test(msg)) {
    return 'Bolão não encontrado.';
  }
  if (/permission/i.test(msg) || /not allowed/i.test(msg) || /rls/i.test(msg)) {
    return 'Seu usuário não possui permissão para deletar este bolão.';
  }

  return msg;
}

function normalizarErroEdicao(err) {
  const raw = err?.message || err?.details || err?.hint || 'Não foi possível salvar as alterações do bolão.';
  const msg = String(raw);

  if (/venda registrada/i.test(msg) || /vendas lançadas/i.test(msg)) {
    return 'Este bolão já possui venda registrada e não pode mais ser alterado.';
  }
  if (/movimentação paga/i.test(msg) || /acerto financeiro pago/i.test(msg) || /quitad/i.test(msg)) {
    return 'Há movimentação paga. Valor da cota e quantidade de cotas não podem ser alterados.';
  }
  if (/quantidade total de cotas não pode ser menor/i.test(msg)) {
    return msg;
  }
  if (/data inicial/i.test(msg) || /data do concurso/i.test(msg) || /obrigatória/i.test(msg)) {
    return msg;
  }
  if (/não encontrado/i.test(msg)) {
    return 'Bolão não encontrado.';
  }

  return msg;
}

function getMotivoCancelamento(bolao) {
  const nomeUsuario = usuario?.nome || 'usuário';
  return `Deleção lógica solicitada na tela operacional por ${nomeUsuario} — ${bolao.modalidade || 'Bolão'} concurso ${bolao.concurso || '—'}`;
}

function abrirModalBolao() {
  $('bolaoModalOverlay').classList.add('show');
  document.body.classList.add('modal-open');
}

function fecharModalBolao() {
  if (modalBusy) return;
  $('bolaoModalOverlay').classList.remove('show');
  document.body.classList.remove('modal-open');
  bolaoSelecionadoModal = null;
  limparSelecaoBoloes();
  mostrarAvisoModal('');
  mostrarSucessoModal('');
}
function popularOrigemModal(bolao) {
  const sel = $('bmOrigemInput');
  if (!sel) return;

  const origemAtualId = Number(
    bolao.origem_loteria_id ||
    bolao.loteria_id ||
    bolao.loteria_origem_id ||
    0
  );

  sel.innerHTML = '';

  let origemExisteNaLista = false;

  lojas.forEach(l => {
    const opt = document.createElement('option');
    opt.value = String(l.id);
    opt.textContent = l.nome;

    if (Number(l.id) === origemAtualId) {
      origemExisteNaLista = true;
    }

    sel.appendChild(opt);
  });

  // Segurança: se a origem atual não estiver nas lojas permitidas,
  // mantém ela visível para não salvar vazio.
  if (origemAtualId && !origemExisteNaLista) {
    const opt = document.createElement('option');
    opt.value = String(origemAtualId);
    opt.textContent = bolao.origem_nome || `Loja ${origemAtualId}`;
    sel.prepend(opt);
  }

  sel.value = origemAtualId ? String(origemAtualId) : '';
}
function preencherModalBolao(bolao) {
  bolaoSelecionadoModal = bolao;

  $('bmTitulo').textContent = `${bolao.modalidade || 'Bolão'} — Concurso ${bolao.concurso || '—'}`;

  popularOrigemModal(bolao);

  $('bmCodigoLoterico').textContent = bolao.codigo_loterico || '—';

  $('bmModalidadeInput').value = bolao.modalidade || '';
  $('bmConcursoInput').value = bolao.concurso || '';
  $('bmDtInicialInput').value = fmtDateInput(bolao.dt_inicial);
  $('bmDtConcursoInput').value = fmtDateInput(bolao.dt_concurso);

  $('bmQtdJogosInput').value = bolao.qtd_jogos ?? 0;
  $('bmQtdDezenasInput').value = bolao.qtd_dezenas ?? 0;

  $('bmValorCotaInput').value =
    bolao.valor_cota == null ? '' : Number(bolao.valor_cota).toFixed(2);

  $('bmQtdCotasInput').value = bolao.qtd_cotas_total ?? '';

  mostrarAvisoModal('');
  mostrarSucessoModal('');

  aplicarEstadoModal({
    pode_editar_basico: true,
    pode_editar_valor: true,
    pode_editar_qtd_cotas: true,
    pode_editar_origem: true,
    cancelado: String(bolao.status || '').toUpperCase() === 'CANCELADO'
  });
}
function aplicarEstadoModal(permissao) {
  const podeBasico = !!permissao?.pode_editar_basico;
  const podeValor = !!permissao?.pode_editar_valor;
  const podeQtdCotas = permissao?.pode_editar_qtd_cotas !== false && podeBasico;
  const podeOrigem = !!permissao?.pode_editar_origem;
  const cancelado = !!permissao?.cancelado;

  $('bmOrigemInput').disabled = !podeOrigem;

  $('bmModalidadeInput').disabled = !podeBasico;
  $('bmConcursoInput').disabled = !podeBasico;
  $('bmDtInicialInput').disabled = !podeBasico;
  $('bmDtConcursoInput').disabled = !podeBasico;
  $('bmQtdJogosInput').disabled = !podeBasico;
  $('bmQtdDezenasInput').disabled = !podeBasico;

  $('bmValorCotaInput').disabled = !podeValor;
  $('bmQtdCotasInput').disabled = !podeQtdCotas;

  const btnSalvar = $('bmConfirmar');
  const btnDeletar = $('bmDeletar');

  if (btnSalvar) {
    btnSalvar.dataset.locked = podeBasico ? '0' : '1';
    btnSalvar.disabled = !podeBasico;
  }

  if (btnDeletar) {
    btnDeletar.dataset.locked = cancelado ? '1' : '0';
    btnDeletar.disabled = cancelado;
    btnDeletar.textContent = cancelado ? 'Bolão já cancelado' : 'Deletar bolão';
  }

  const avisos = [];

  if (permissao?.qtd_minima_cotas) {
    avisos.push(`Qtd. mínima permitida: ${permissao.qtd_minima_cotas} cotas.`);
  }

  if (!podeOrigem && !cancelado) {
    avisos.push('Origem bloqueada quando já existe venda, movimentação ou fechamento.');
  }

  if (!podeValor && !cancelado) {
    avisos.push('Valor da cota bloqueado quando há acerto financeiro pago.');
  }

  if (!podeBasico) {
    avisos.push(permissao?.motivo || 'Este bolão não pode ser alterado.');
  }

  mostrarAvisoModal(avisos.join(' '));
}
async function validarBolaoSelecionado() {
  if (!bolaoSelecionadoModal) return;

  try {
    const { data, error } = await sb.rpc('rpc_validar_edicao_bolao', {
      p_bolao_id: Number(bolaoSelecionadoModal.bolao_id)
    });

    if (error) throw error;
    aplicarEstadoModal(data || {});
  } catch (err) {
    console.error('Erro ao validar edição do bolão:', err);
    aplicarEstadoModal({ pode_editar_basico: false, pode_editar_valor: false, motivo: normalizarErroEdicao(err) });
  }
}

function bindSelecaoBoloes() {
  document.querySelectorAll('.bolao-check').forEach(chk => {
    chk.addEventListener('change', async (e) => {
      const id = Number(e.target.dataset.id);

      document.querySelectorAll('.bolao-check').forEach(outro => {
        if (outro !== e.target) outro.checked = false;
      });

      if (!e.target.checked) {
        fecharModalBolao();
        return;
      }

      const bolao = boloesCache.find(b => Number(b.bolao_id) === id);
      if (!bolao) return;

      preencherModalBolao(bolao);
      abrirModalBolao();
      await validarBolaoSelecionado();
    });
  });
}

async function salvarBolaoSelecionado() {
  if (!bolaoSelecionadoModal || modalBusy) return;

  try {
    setModalBusyState(true, 'save');
    mostrarAvisoModal('');
    mostrarSucessoModal('');

    const payload = {
      p_bolao_id: Number(bolaoSelecionadoModal.bolao_id),

      p_loteria_id: Number($('bmOrigemInput').value),

      p_modalidade: $('bmModalidadeInput').value.trim(),
      p_concurso: $('bmConcursoInput').value.trim(),
      p_dt_inicial: $('bmDtInicialInput').value,
      p_dt_concurso: $('bmDtConcursoInput').value,

      p_qtd_jogos: Number($('bmQtdJogosInput').value),
      p_qtd_dezenas: Number($('bmQtdDezenasInput').value),

      p_valor_cota: Number($('bmValorCotaInput').value),
      p_qtd_cotas_total: Number($('bmQtdCotasInput').value)
    };

    const { data, error } = await sb.rpc('rpc_editar_bolao', payload);

    if (error) throw error;
    if (!data?.ok) throw new Error(data?.motivo || 'Não foi possível salvar as alterações.');

    mostrarSucessoModal('Bolão atualizado com sucesso.');

    await exibir();

    const bolaoAtualizado = boloesCache.find(
      b => Number(b.bolao_id) === Number(payload.p_bolao_id)
    );

    if (bolaoAtualizado) {
      preencherModalBolao(bolaoAtualizado);
      await validarBolaoSelecionado();

      const chk = document.querySelector(`.bolao-check[data-id="${payload.p_bolao_id}"]`);
      if (chk) chk.checked = true;
    }
  } catch (err) {
    console.error('Erro ao salvar bolão:', err);
    mostrarAvisoModal(normalizarErroEdicao(err));
  } finally {
    setModalBusyState(false);
  }
}
async function deletarBolaoSelecionado() {
  if (!bolaoSelecionadoModal || modalBusy) return;

  const bolao = bolaoSelecionadoModal;
  const status = String(bolao.status || '').toUpperCase();

  if (status === 'CANCELADO') {
    mostrarAvisoModal('Este bolão já está cancelado.');
    return;
  }

  const ok = window.confirm(
    [
      `Confirma a deleção lógica do bolão ${bolao.modalidade || 'Bolão'} — Concurso ${bolao.concurso || '—'}?`,
      '',
      'Essa ação tentará:',
      '• cancelar o bolão',
      '• cancelar movimentações ativas vinculadas',
      '• cancelar pendências financeiras pendentes vinculadas',
      '',
      'O banco irá bloquear se já houver venda, fechamento ou acerto financeiro pago.'
    ].join('\n')
  );

  if (!ok) return;

  try {
    setModalBusyState(true, 'delete');
    mostrarAvisoModal('');
    mostrarSucessoModal('');

    const { data, error } = await sb.rpc('rpc_cancelar_bolao_seguro', {
      p_bolao_id: Number(bolao.bolao_id),
      p_usuario_id: usuario?.id ?? null,
      p_motivo: getMotivoCancelamento(bolao)
    });

    if (error) throw error;
    if (!data?.ok) throw new Error(data?.message || 'Não foi possível deletar o bolão.');

    mostrarSucessoModal(`Bolão deletado com sucesso. Movimentações canceladas: ${fmtN(data.movimentacoes_canceladas || 0)} · Financeiros cancelados: ${fmtN(data.financeiros_cancelados || 0)}`);
    await exibir();

    const bolaoAtualizado = boloesCache.find(b => Number(b.bolao_id) === Number(bolao.bolao_id));
    if (bolaoAtualizado) {
      preencherModalBolao(bolaoAtualizado);
      aplicarEstadoModal({ pode_editar_basico: false, pode_editar_valor: false, cancelado: true, motivo: 'Bolão cancelado.' });
      const chk = document.querySelector(`.bolao-check[data-id="${bolao.bolao_id}"]`);
      if (chk) chk.checked = true;
    } else {
      setTimeout(fecharModalBolao, 700);
    }
  } catch (err) {
    console.error('Erro ao deletar bolão:', err);
    mostrarAvisoModal(normalizarErroCancelamento(err));
  } finally {
    setModalBusyState(false);
  }
}

async function carregarContextoUsuario(authUserId) {
  if (!authUserId) return null;

  const { data, error } = await sb
    .from(VIEW_USUARIO_CONTEXTO)
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function carregarLoteriasPermitidas(authUserId) {
  if (!authUserId) return [];

  const { data, error } = await sb
    .from(VIEW_USUARIOS_LOTERIAS_ATIVAS)
    .select('loteria_id,loteria_nome,loteria_slug,principal,perfil')
    .eq('auth_user_id', authUserId)
    .order('principal', { ascending: false })
    .order('loteria_nome', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function init() {
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    location.href = './login.html';
    return;
  }

  const usr = await carregarContextoUsuario(session.user.id);

  if (!usr || !usr.ativo || !usr.pode_logar) {
    location.href = './login.html';
    return;
  }

  usuario = {
    id: usr.usuario_id,
    nome: usr.nome,
    email: usr.email,
    perfil: usr.perfil,
    ativo: usr.ativo,
    pode_logar: usr.pode_logar,
    loteria_principal_id: usr.loteria_principal_id,
    loteria_principal_nome: usr.loteria_principal_nome,
    loteria_principal_slug: usr.loteria_principal_slug
  };

  $('btnLogout').onclick = async () => {
    await sb.auth.signOut();
    location.href = './login.html';
  };

  const [loteriasPermitidasResp, usuariosResp] = await Promise.all([
    carregarLoteriasPermitidas(session.user.id),
    sb.from('usuarios').select('id,nome').eq('ativo', true).order('nome')
  ]);

  const loteriasPermitidas = loteriasPermitidasResp || [];
  usuarios = usuariosResp.data || [];

  lojas = loteriasPermitidas.map(l => ({
    id: l.loteria_id,
    nome: l.loteria_nome,
    slug: l.loteria_slug,
    principal: l.principal
  }));

  const sel = $('fLoja');
  sel.innerHTML = '<option value="">Todas</option>';

  lojas.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.nome;
    sel.appendChild(o);
  });

  // Padrão novo: carrega todos os bolões permitidos ao usuário.
// Os filtros só entram quando forem preenchidos.
$('fDataRef').value = '';
$('fStatus').value = '';
$('fLoja').value = '';

  ['fDataRef', 'fDtConcDe', 'fDtConcAte', 'fModal', 'fLoja', 'fStatus'].forEach(id => {
    $(id).addEventListener('change', agendarExibicao);
  });

  $('fConc').addEventListener('input', agendarExibicao);

  $('bmFechar')?.addEventListener('click', fecharModalBolao);
  $('bmCancelar')?.addEventListener('click', fecharModalBolao);
  $('bmConfirmar')?.addEventListener('click', salvarBolaoSelecionado);
  $('bmDeletar')?.addEventListener('click', deletarBolaoSelecionado);

  $('bolaoModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'bolaoModalOverlay') fecharModalBolao();
  });

  bindPainelOrdenacao();
  renderResumoOrdenacao();
  await exibir();
}

function limpar() {
  ['fDataRef', 'fDtConcDe', 'fDtConcAte', 'fConc'].forEach(id => {
    $(id).value = '';
  });

  $('fModal').selectedIndex = 0;
  $('fStatus').value = '';
  $('fLoja').value = '';

  ordenacoes = [{ key: 'created_at', dir: 'desc' }];

  exibir();
}
function montarQueryBoloes() {
  const dataRef = $('fDataRef').value;

  let q = sb.from(VIEW_BOLAO).select('*');

  // Data Referência agora é opcional.
  // Quando preenchida, mostra bolões vigentes naquela data.
  if (dataRef) {
    q = q
      .lte('dt_inicial', dataRef)
      .gte('dt_concurso', dataRef);
  }

  if ($('fDtConcDe').value) q = q.gte('dt_concurso', $('fDtConcDe').value);
  if ($('fDtConcAte').value) q = q.lte('dt_concurso', $('fDtConcAte').value);
  if ($('fModal').value) q = q.eq('modalidade', $('fModal').value);
  if ($('fConc').value) q = q.ilike('concurso', '%' + $('fConc').value + '%');
  if ($('fLoja').value) q = q.eq('origem_loteria_id', parseInt($('fLoja').value, 10));
  if ($('fStatus').value) q = q.eq('status', $('fStatus').value);

  return q;
}

async function carregarBoloesFiltrados() {
  const pageSize = 1000;
  let from = 0;
  let todos = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await montarQueryBoloes().range(from, to);

    if (error) throw error;

    const lote = data || [];
    todos = todos.concat(lote);

    if (lote.length < pageSize) break;

    from += pageSize;
  }

  return todos;
}
async function exibir() {

$('tableArea').innerHTML = '<div class="state-box"><div class="spinner"></div><div class="state-title">Carregando…</div></div>';

let boloesRaw = [];

try {
  boloesRaw = await carregarBoloesFiltrados();
} catch (error) {
  console.error('Erro ao carregar bolões:', error);
  boloesCache = [];
  $('tableArea').innerHTML = '<div class="state-box"><div class="state-title">Erro ao carregar</div><div class="state-sub">Verifique o console para detalhes.</div></div>';
  return;
}

if (!boloesRaw?.length) {
  boloesCache = [];
  $('tableArea').innerHTML = '<div class="state-box"><div class="state-title">Nenhum resultado</div><div class="state-sub">Tente ajustar os filtros.</div></div>';
  return;
}

const boloes = ordenarBoloes(boloesRaw);
boloesCache = boloes;
renderResumoOrdenacao();

  const ids = boloes.map(b => b.bolao_id);

  const [{ data: vendas }, { data: lojasBolao }] = await Promise.all([
    sb.from(VIEW_VENDAS).select('*').in('bolao_id', ids),
    sb.from(VIEW_LOJAS).select('*').in('bolao_id', ids)
  ]);

  const canalMap = {};
  const funcMap = {};

  (boloes || []).forEach(b => {
    canalMap[b.bolao_id] = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0 };
    funcMap[b.bolao_id] = {};
  });

  (vendas || []).forEach(v => {
    if (!canalMap[v.bolao_id]) {
      canalMap[v.bolao_id] = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0 };
    }

    canalMap[v.bolao_id][v.canal] = (canalMap[v.bolao_id][v.canal] || 0) + (v.qtd_vendida || 0);

    if (v.usuario_id) {
      if (!funcMap[v.bolao_id]) funcMap[v.bolao_id] = {};
      funcMap[v.bolao_id][v.usuario_id] = (funcMap[v.bolao_id][v.usuario_id] || 0) + (v.qtd_vendida || 0);
    }
  });

  const lojaMap = {};
  (lojasBolao || []).forEach(r => {
    if (!lojaMap[r.bolao_id]) lojaMap[r.bolao_id] = {};
    lojaMap[r.bolao_id][r.loja_slug] = {
      bruto: r.estoque_bruto_loja,
      vend: r.qtd_vendida_loja,
      bruto_venda: r.bruto_venda
    };
  });

  const funcIds = [...new Set((vendas || []).map(v => v.usuario_id).filter(Boolean))];
  const funcNomes = {};
  usuarios.forEach(u => {
    if (funcIds.includes(u.id)) funcNomes[u.id] = u.nome.split(' ')[0];
  });

  const totVendaReal = boloes.reduce((s, b) => s + Number(b.venda_real_total || 0), 0);
  const totEncalhe = boloes.reduce((s, b) => s + Number(b.encalhe_total || 0), 0);
  const totLiquido = boloes.reduce((s, b) => s + Number(b.estoque_liquido_total || 0), 0);
  const totVCont = boloes.reduce((s, b) => s + Number(b.venda_contabil_total || 0), 0);
  
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap fade-in';

  const nFunc = funcIds.length;
  const nSlug = slugsLojas.length;

  const grpRow = `<tr class="grp-row">
    <th colspan="10" class="grp-bolao sep-col">Bolão</th>
    <th colspan="3" class="grp-canal sep-col">Canal de Venda</th>
    ${nFunc > 0 ? `<th colspan="${nFunc}" class="grp-func sep-col">Venda por Funcionário</th>` : ''}
    <th colspan="${nSlug}" class="grp-loja sep-col">Qtd Mov. / Vend. por Loja</th>
    <th colspan="2" class="grp-enc sep-col">Encalhe na Origem</th>
    <th colspan="4" class="grp-sint">Síntese Geral</th>
  </tr>`;

 const funcCols = funcIds.map(id => `
  <th class="col-func">
    ${funcNomes[id] || 'Func.'}
  </th>
`).join('');

const lojaCols = slugsLojas.map(s => `
  <th class="col-loja">
    ${slugLabel[s]}
  </th>
`).join('');

const colRow = `<tr class="col-row">
  <th class="col-sel">Sel.</th>

  ${sortTh(
    'origem_nome',
    'Origem',
    'left col-origem'
  )}

  ${sortTh(
    'dt_inicial',
    'Data inicial',
    'col-data',
    'Data<br>Inicial'
  )}

  ${sortTh(
    'dt_concurso',
    'Data do concurso',
    'col-data',
    'Data<br>Sorteio'
  )}

  ${sortTh(
    'modalidade',
    'Modalidade',
    'left col-modalidade',
    'Modalidade'
  )}

  ${sortTh(
    'concurso',
    'Concurso',
    'col-concurso',
    'Concurso'
  )}

  ${sortTh(
    'qtd_jogos',
    'Quantidade de jogos',
    'col-quantidade',
    'Qtd.<br>Jogos'
  )}

  ${sortTh(
    'qtd_dezenas',
    'Quantidade de dezenas',
    'col-quantidade',
    'Qtd.<br>Dezenas'
  )}

  ${sortTh(
    'valor_cota',
    'Valor da cota',
    'col-valor',
    'Valor<br>Cota'
  )}

  ${sortTh(
    'qtd_cotas_total',
    'Quantidade de cotas',
    'col-quantidade sep-col',
    'Qtd.<br>Cotas'
  )}

  <th class="col-numero">Balcão</th>
  <th class="col-numero">WPP</th>
  <th class="col-numero sep-col">MKP</th>

  ${nFunc > 0 ? funcCols : ''}

  ${lojaCols}

  <th class="col-numero">
    Enc.<br>Físico
  </th>

  <th class="col-numero sep-col">
    Enc.<br>Virtual
  </th>

  <th class="col-sintese">
    Cotas /<br>Venda Real
  </th>

  <th class="col-sintese">
    Encalhe<br>Total
  </th>

  <th class="col-sintese">
    Estoque<br>Líquido
  </th>

  <th class="col-sintese">
    Venda<br>Contábil
  </th>
</tr>`;

  const rows = boloes.map(b => {
    const cm = canalMap[b.bolao_id] || {};
    const lm = lojaMap[b.bolao_id] || {};
    const fm = funcMap[b.bolao_id] || {};

    const funcTds = funcIds.map(id => `
  <td class="purple col-func cell-numero">
    ${fmtN(fm[id] || 0)}
  </td>
`).join('');
    
    const lojaTds = slugsLojas.map(s => {
  const cell = lm[s];

  return `
    <td class="cyan col-loja cell-numero">
      ${cell?.bruto_venda || fmtPair(null, null)}
    </td>
  `;
}).join('');
    
return `<tr>
  <td class="col-sel">
    <label class="bolao-check-wrap">
      <input
        type="checkbox"
        class="bolao-check"
        data-id="${b.bolao_id}"
      >
    </label>
  </td>

  <td class="left col-origem">
    ${b.origem_nome || '—'}
  </td>

  <td class="mono dim col-data cell-numero">
    ${fmtDate(b.dt_inicial)}
  </td>

  <td class="mono dim col-data cell-numero">
    ${fmtDate(b.dt_concurso)}
  </td>

  <td class="left bold col-modalidade">
    ${b.modalidade}
  </td>

  <td class="mono col-concurso cell-numero">
    #${b.concurso}
  </td>

  <td class="mono col-quantidade cell-numero">
    ${fmtN(b.qtd_jogos)}
  </td>

  <td class="mono col-quantidade cell-numero">
    ${fmtN(b.qtd_dezenas)}
  </td>

  <td class="amber col-valor cell-numero">
    ${fmtBRL(b.valor_cota)}
  </td>

  <td class="mono col-quantidade cell-numero sep-col">
    ${fmtN(b.qtd_cotas_total)}
  </td>

  <td class="blue col-numero cell-numero">
    ${fmtN(cm.BALCAO || 0)}
  </td>

  <td class="blue col-numero cell-numero">
    ${fmtN(cm.WHATSAPP || 0)}
  </td>

  <td class="blue col-numero cell-numero sep-col">
    ${fmtN(cm.MARKETPLACE || 0)}
  </td>

  ${nFunc > 0 ? funcTds : ''}

  ${lojaTds}

  <td class="amber col-numero cell-numero">
    ${fmtN(b.enc_fisico)}
  </td>

  <td class="amber col-numero cell-numero sep-col">
    ${fmtN(b.enc_virtual)}
  </td>

  <td class="green col-sintese cell-numero">
    ${b.total_cotas_venda_real ||
      fmtPair(b.qtd_cotas_total, b.venda_real_total)}
  </td>

  <td class="amber col-sintese cell-numero">
    ${fmtN(b.encalhe_total)}
  </td>

  <td class="blue col-sintese cell-numero">
    ${fmtN(b.estoque_liquido_total)}
  </td>

  <td class="green col-sintese cell-numero">
    ${fmtN(b.venda_contabil_total)}
  </td>
</tr>`;
  }).join('');

  const totCanal = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0 };
  Object.values(canalMap).forEach(cm => {
    ['BALCAO', 'WHATSAPP', 'MARKETPLACE'].forEach(c => {
      totCanal[c] += (cm[c] || 0);
    });
  });

  const totFuncTds = funcIds.map(id => {
    const t = Object.values(funcMap).reduce((s, fm) => s + (fm[id] || 0), 0);
    return `
  <td class="purple bold col-func cell-numero">
    ${fmtN(t)}
  </td>
`;
  }).join('');

  const totLojaTds = slugsLojas.map(s => {
    const bruto = (lojasBolao || [])
      .filter(r => r.loja_slug === s)
      .reduce((sum, r) => sum + Number(r.estoque_bruto_loja || 0), 0);

    const venda = (lojasBolao || [])
      .filter(r => r.loja_slug === s)
      .reduce((sum, r) => sum + Number(r.qtd_vendida_loja || 0), 0);

    return `
  <td class="cyan bold col-loja cell-numero">
    ${fmtPair(bruto, venda)}
  </td>
`;
  }).join('');

  const totEncFis = boloes.reduce((s, b) => s + Number(b.enc_fisico || 0), 0);
  const totEncVirt = boloes.reduce((s, b) => s + Number(b.enc_virtual || 0), 0);
  const totCotas = boloes.reduce((s, b) => s + Number(b.qtd_cotas_total || 0), 0);

  const totalRow = `
<tr class="total-row">
  <td class="left bold total-label">
    TOTAL
  </td>

  <td colspan="9" class="sep-col"></td>

  <td class="blue bold col-numero cell-numero">
    ${fmtN(totCanal.BALCAO)}
  </td>

  <td class="blue bold col-numero cell-numero">
    ${fmtN(totCanal.WHATSAPP)}
  </td>

  <td class="blue bold col-numero cell-numero sep-col">
    ${fmtN(totCanal.MARKETPLACE)}
  </td>

  ${nFunc > 0 ? totFuncTds : ''}

  ${totLojaTds}

  <td class="amber bold col-numero cell-numero">
    ${fmtN(totEncFis)}
  </td>

  <td class="amber bold col-numero cell-numero sep-col">
    ${fmtN(totEncVirt)}
  </td>

  <td class="green bold col-sintese cell-numero">
    ${fmtPair(totCotas, totVendaReal)}
  </td>

  <td class="amber bold col-sintese cell-numero">
    ${fmtN(totEncalhe)}
  </td>

  <td class="blue bold col-sintese cell-numero">
    ${fmtN(totLiquido)}
  </td>

  <td class="green bold col-sintese cell-numero">
    ${fmtN(totVCont)}
  </td>
</tr>`;
  

  wrap.innerHTML = `<table class="data-table">
    <thead>${grpRow}${colRow}</thead>
    <tbody>${rows}${totalRow}</tbody>
  </table>`;

  $('tableArea').innerHTML = '';
  $('tableArea').appendChild(wrap);

  bindSelecaoBoloes();
bindOrdenacaoCabecalho();
renderResumoOrdenacao();
}

updateClock();
setInterval(updateClock, 1000);
document.addEventListener('DOMContentLoaded', init);
