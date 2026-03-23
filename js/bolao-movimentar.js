/**
 * SISLOT — Movimentação de Cotas (v3.0)
 * Tema e clock delegados ao SISLOT_THEME.
 * LOJAS e lojaIdPorSlug alimentados via SISLOT_THEME.LOJAS.
 * Toda a lógica de negócio (filtros, cards, panel, modal) preservada.
 */

const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

const utils   = window.SISLOT_UTILS || {};
const $       = utils.$ || (id => document.getElementById(id));
const fmtBRL  = utils.fmtBRL || (v => 'R$ ' + Number(v||0).toFixed(2).replace('.',','));
const isoDate = utils.isoDate || (date => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10);
});

// ── Estado global ──────────────────────────────────────────
let usuario        = null;
let lojaIdPorSlug  = {};   // slug → id (alimentado do Supabase)
let lojaSlugPorId  = {};   // id  → slug
let lojaNomePorId  = {};   // id  → nome
let dataAtual      = new Date();
let bolaoSelecionado = null;
let saldosPorLoja  = {};
let historicoPorLoja = {};

let todosBoloes    = [];
let todasPosicoes  = [];
let todasMovs      = [];

let filtroOrigem     = '';
let filtroConcurso   = '';
let filtroModalidade = '';
let filtroDestino    = '';

// ── Referência às lojas (usa SISLOT_THEME como fonte canônica) ──
// LOJAS é reconstruído após carregar do banco para ter os IDs reais
let LOJAS = [];

// ══════════════════════════════════════════════════════════
// STATUS — usa sl-status-bar do design system
// ══════════════════════════════════════════════════════════
function setStatus(id, msg, tipo = 'ok') {
  const el = $(id); if (!el) return;
  el.textContent = msg;
  el.className   = msg ? `sl-status-bar show ${tipo}` : 'sl-status-bar';
}

// ══════════════════════════════════════════════════════════
// FORMATAÇÃO DE DATA
// ══════════════════════════════════════════════════════════
function formatarData(data) {
  if (!data) return '—';
  try {
    let dia, mes, ano;
    if (data instanceof Date && !isNaN(data.getTime())) {
      dia=data.getDate(); mes=data.getMonth()+1; ano=data.getFullYear();
    } else if (typeof data === 'string') {
      const m = data.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) { dia=+m[3]; mes=+m[2]; ano=+m[1]; }
      else {
        const d = new Date(data);
        if (!isNaN(d.getTime())) { dia=d.getDate(); mes=d.getMonth()+1; ano=d.getFullYear(); }
      }
    }
    if (dia && mes && ano)
      return `${String(dia).padStart(2,'0')}/${String(mes).padStart(2,'0')}/${ano}`;
  } catch {}
  return '—';
}

function atualizarDateDisplay() {
  const el = $('dateDisplayText');
  if (el) el.textContent = formatarData(dataAtual);
  const picker = $('calendarPicker');
  if (picker) picker.value = isoDate(dataAtual);
}

// ══════════════════════════════════════════════════════════
// HEADER — sincroniza com SISLOT_THEME via filtro de origem
// ══════════════════════════════════════════════════════════
function sincronizarTemaComOrigem() {
  if (!filtroOrigem) {
    SISLOT_THEME.aplicarTema('todas');
    return;
  }
  const slug = lojaSlugPorId[filtroOrigem] ||
    Object.keys(lojaIdPorSlug).find(s => String(lojaIdPorSlug[s]) === filtroOrigem);
  if (slug) SISLOT_THEME.aplicarTema(slug);
}

function ciclarLojaTree() {
  const idsPresentes = [...new Set(todosBoloes.map(b => String(b.loteria_id)))];
  const lojasPres = LOJAS.filter(l => idsPresentes.includes(String(lojaIdPorSlug[l.slug]||'')));
  const ciclo = [null, ...lojasPres];

  const idxAtual = ciclo.findIndex(item =>
    item === null ? !filtroOrigem : String(lojaIdPorSlug[item.slug]) === filtroOrigem);
  const proximo = ciclo[(idxAtual + 1) % ciclo.length];

  filtroOrigem = proximo ? String(lojaIdPorSlug[proximo.slug]) : '';

  const fOrigem = $('filterOrigem');
  if (fOrigem) { fOrigem.value = filtroOrigem; marcarSelectAtivo(fOrigem); }

  sincronizarTemaComOrigem();
  renderFiltrosCascata();
  aplicarFiltros();
  fecharPanel();
}

// ══════════════════════════════════════════════════════════
// FILTROS EM CASCATA (lógica intacta)
// ══════════════════════════════════════════════════════════
function renderFiltrosCascata() {
  const fOrigem = $('filterOrigem'); const fConcurso = $('filterConcurso');
  const fModal  = $('filterModalidade'); const fDest = $('filterDestino');
  if (!fOrigem||!fConcurso||!fModal||!fDest) return;

  const paraOrigem = todosBoloes.filter(b => {
    if (filtroConcurso   && String(b.concurso) !== filtroConcurso)     return false;
    if (filtroModalidade && b.modalidade         !== filtroModalidade)  return false;
    if (filtroDestino    && !bolaoTemDestino(b.id,filtroDestino))       return false;
    return true;
  });
  const paraConcurso = todosBoloes.filter(b => {
    if (filtroOrigem     && String(b.loteria_id) !== filtroOrigem)      return false;
    if (filtroModalidade && b.modalidade          !== filtroModalidade) return false;
    if (filtroDestino    && !bolaoTemDestino(b.id,filtroDestino))       return false;
    return true;
  });
  const paraModal = todosBoloes.filter(b => {
    if (filtroOrigem   && String(b.loteria_id) !== filtroOrigem)   return false;
    if (filtroConcurso && String(b.concurso)   !== filtroConcurso) return false;
    if (filtroDestino  && !bolaoTemDestino(b.id,filtroDestino))    return false;
    return true;
  });
  const paraDest = todosBoloes.filter(b => {
    if (filtroOrigem     && String(b.loteria_id) !== filtroOrigem)      return false;
    if (filtroConcurso   && String(b.concurso)   !== filtroConcurso)    return false;
    if (filtroModalidade && b.modalidade          !== filtroModalidade) return false;
    return true;
  });

  const origensMap = new Map();
  paraOrigem.forEach(b => {
    if (!origensMap.has(String(b.loteria_id)))
      origensMap.set(String(b.loteria_id), b.loterias?.nome || String(b.loteria_id));
  });
  populateSelect(fOrigem, [...origensMap.entries()].sort((a,b)=>a[1].localeCompare(b[1])), filtroOrigem);

  const concursosSet = new Set(paraConcurso.map(b => String(b.concurso)));
  populateSelect(fConcurso, [...concursosSet].sort((a,b)=>Number(a)-Number(b)).map(c=>[c,`#${c}`]), filtroConcurso);

  const modalSet = new Set(paraModal.map(b => b.modalidade));
  populateSelect(fModal, [...modalSet].sort().map(m=>[m,m]), filtroModalidade);

  const destMap = new Map();
  const idsBoloesPara = new Set(paraDest.map(b => String(b.id)));
  todasPosicoes.forEach(p => {
    if (!idsBoloesPara.has(String(p.bolao_id))) return;
    if (Number(p.qtd_cotas_posicao||0) <= 0) return;
    const lojaId = String(p.loteria_id);
    if (!destMap.has(lojaId)) destMap.set(lojaId, p.loteria_nome || lojaId);
  });
  populateSelect(fDest, [...destMap.entries()].sort((a,b)=>a[1].localeCompare(b[1])), filtroDestino);

  [fOrigem,fConcurso,fModal,fDest].forEach(marcarSelectAtivo);

  const btnClear = $('btnClearFilters');
  if (btnClear) {
    const temFiltro = filtroOrigem || filtroConcurso || filtroModalidade || filtroDestino;
    btnClear.classList.toggle('active', !!temFiltro);
    btnClear.style.display = '';
  }

  atualizarContador();
}

function populateSelect(sel, entries, valorAtivo) {
  const primeiroTexto = sel.options[0]?.textContent || 'Todos';
  sel.innerHTML = '';
  const optPadrao = document.createElement('option');
  optPadrao.value = ''; optPadrao.textContent = primeiroTexto;
  sel.appendChild(optPadrao);
  entries.forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if (val === valorAtivo) opt.selected = true;
    sel.appendChild(opt);
  });
}

function bolaoTemDestino(bolaoId, lojaId) {
  return todasPosicoes.some(p =>
    String(p.bolao_id) === String(bolaoId) &&
    String(p.loteria_id) === String(lojaId) &&
    Number(p.qtd_cotas_posicao||0) > 0
  );
}

function marcarSelectAtivo(sel) {
  if (!sel) return;
  sel.dataset.active = sel.value ? 'true' : 'false';
}

function atualizarContador() {
  const el = $('boloesCount'); if (!el) return;
  const total = todosBoloes.length;
  const filtrado = getBoloesFiltrados().length;
  if (!total) { el.innerHTML = ''; return; }
  el.innerHTML = filtrado === total
    ? `<span>${total}</span> bolões vigentes`
    : `<span>${filtrado}</span> de ${total} bolões`;
}

function getBoloesFiltrados() {
  return todosBoloes.filter(b => {
    if (filtroOrigem     && String(b.loteria_id) !== filtroOrigem)     return false;
    if (filtroConcurso   && String(b.concurso)   !== filtroConcurso)   return false;
    if (filtroModalidade && b.modalidade          !== filtroModalidade) return false;
    if (filtroDestino    && !bolaoTemDestino(b.id, filtroDestino))     return false;
    return true;
  });
}

function aplicarFiltros() {
  const loadingEl = $('stLoading');
  const vazioEl   = $('stVazio');
  const listaEl   = $('stLista');

  if (loadingEl) loadingEl.style.display = 'none';
  const resultado = getBoloesFiltrados();

  if (!resultado.length) {
    if (vazioEl) {
      const sub = $('stVazioSub');
      const temFiltro = filtroOrigem || filtroConcurso;
      if (sub) sub.textContent = temFiltro
        ? 'Nenhum bolão para os filtros selecionados.'
        : `Nenhum bolão ativo para ${formatarData(dataAtual)}.`;
      vazioEl.style.display = 'flex';
    }
    if (listaEl) listaEl.style.display = 'none';
    atualizarContador();
    return;
  }

  if (vazioEl) vazioEl.style.display = 'none';
  renderBoloes(resultado, todasPosicoes, todasMovs);
  atualizarContador();
}

// ══════════════════════════════════════════════════════════
// BUSCA NO BANCO (só quando muda a DATA)
// ══════════════════════════════════════════════════════════
async function buscarBoloes() {
  const loadingEl = $('stLoading');
  const vazioEl   = $('stVazio');
  const listaEl   = $('stLista');

  if (loadingEl) loadingEl.style.display = 'flex';
  if (vazioEl)   vazioEl.style.display   = 'none';
  if (listaEl)   listaEl.style.display   = 'none';

  const iso = isoDate(dataAtual);

  const { data: boloes, error } = await sb
    .from('boloes')
    .select(`
      id, modalidade, concurso, valor_cota, qtd_jogos, qtd_dezenas,
      qtd_cotas_total, dt_inicial, dt_concurso, status, loteria_id,
      loterias(id, nome, slug)
    `)
    .eq('status', 'ATIVO')
    .lte('dt_inicial', iso)
    .gte('dt_concurso', iso)
    .order('modalidade')
    .order('loteria_id');

  if (loadingEl) loadingEl.style.display = 'none';

  if (error || !boloes?.length) {
    todosBoloes = []; todasPosicoes = []; todasMovs = [];
    sincronizarTemaComOrigem();
    renderFiltrosCascata();
    aplicarFiltros();
    return;
  }

  const ids = boloes.map(b => b.id);

  const [{ data: posicoes }, { data: movs }] = await Promise.all([
    sb.from('view_posicao_bolao_lojas').select('*').in('bolao_id', ids),
    sb.from('movimentacoes_cotas')
      .select('bolao_id, loteria_origem, loteria_destino, qtd_cotas')
      .in('bolao_id', ids)
      .eq('status', 'ATIVO'),
  ]);

  todosBoloes   = boloes;
  todasPosicoes = posicoes || [];
  todasMovs     = movs    || [];

  sincronizarTemaComOrigem();
  renderFiltrosCascata();
  aplicarFiltros();
}

// ══════════════════════════════════════════════════════════
// RENDER DE BOLÕES — classes atualizadas para mov-*
// ══════════════════════════════════════════════════════════
function renderBoloes(boloes, posicoes, movs) {
  const lista = $('stLista'); if (!lista) return;
  lista.innerHTML = '';

  const grupos = {};
  boloes.forEach(b => {
    if (!grupos[b.modalidade]) grupos[b.modalidade] = [];
    grupos[b.modalidade].push(b);
  });

  let totalCards = 0;
  Object.keys(grupos).sort().forEach(mod => {
    const listaMod = grupos[mod].sort((a,b) => {
      const nA = a.loterias?.nome||''; const nB = b.loterias?.nome||'';
      if (nA !== nB) return nA < nB ? -1 : 1;
      return (a.valor_cota||0) - (b.valor_cota||0);
    });

    const sep = document.createElement('div');
    sep.className = 'mov-section-sep';
    sep.style.marginTop = totalCards > 0 ? '18px' : '0';
    sep.innerHTML = `
      <div class="mov-section-sep-label">${mod}</div>
      <div class="mov-section-sep-line"></div>
      <div class="mov-section-sep-count">${listaMod.length}</div>`;
    lista.appendChild(sep);

    const grid = document.createElement('div');
    grid.className = 'mov-boloes-grid';

    listaMod.forEach((b, i) => {
      const pos = posicoes.filter(p => p.bolao_id === b.id);
      let saldoPills = pos
        .filter(p => Number(p.qtd_cotas_posicao||0) > 0)
        .map(p => `<div class="saldo-pill">
          <span class="sp-loja">${p.loteria_nome||'—'}</span>
          <span class="sp-val">${Number(p.qtd_cotas_posicao||0)}</span>
        </div>`).join('');
      if (!saldoPills)
        saldoPills = '<div class="saldo-pill"><span class="sp-loja">Sem distribuição</span></div>';

      const card = document.createElement('div');
      card.className = 'bolao-card';
      card.dataset.id = b.id;
      card.dataset.origem = b.loterias?.slug || '';
      card.style.animationDelay = (i * 0.035) + 's';
      card.innerHTML = `
        <div class="bolao-main">
          <div class="bolao-header">
            <span class="bolao-modal">${b.modalidade}</span>
            <span class="bolao-concurso">#${b.concurso}</span>
            <span class="bolao-origem" data-origem="${b.loterias?.slug||''}">${b.loterias?.nome||'—'}</span>
          </div>
          <div class="bolao-tags">
            <span class="btag">${b.qtd_jogos} jogos</span>
            <span class="btag">${b.qtd_dezenas} dez.</span>
            <span class="btag">${b.qtd_cotas_total} cotas</span>
            <span class="btag">${fmtBRL(b.valor_cota)}/cota</span>
          </div>
          <div class="bolao-saldos">${saldoPills}</div>
        </div>
        <div class="bolao-select-ind">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 6 5 9 10 3"/>
          </svg>
        </div>`;
      card.addEventListener('click', () => selecionarBolao(b, pos, movs));
      grid.appendChild(card);
      totalCards++;
    });

    lista.appendChild(grid);
  });

  lista.style.display = 'block';
}

// ══════════════════════════════════════════════════════════
// PANEL DE MOVIMENTAÇÃO (lógica intacta, classes atualizadas)
// ══════════════════════════════════════════════════════════
function selecionarBolao(b, posicoes, movs) {
  document.querySelectorAll('.bolao-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.bolao-card[data-id="${b.id}"]`);
  if (card) card.classList.add('selected');

  bolaoSelecionado = b;
  saldosPorLoja = {}; historicoPorLoja = {};

  LOJAS.forEach(loja => { saldosPorLoja[lojaIdPorSlug[loja.slug]] = 0; });
  posicoes.forEach(p => { saldosPorLoja[p.loteria_id] = Number(p.qtd_cotas_posicao||0); });

  const movsBolao = movs.filter(m => m.bolao_id === b.id);
  movsBolao.forEach(m => {
    const oId = m.loteria_origem; const dId = m.loteria_destino;
    const qtd = Number(m.qtd_cotas||0);
    if (!historicoPorLoja[dId]) historicoPorLoja[dId] = [];
    if (!historicoPorLoja[oId]) historicoPorLoja[oId] = [];
    historicoPorLoja[dId].push(qtd);
    historicoPorLoja[oId].push(-qtd);
  });

  abrirPanel(b);
}

function abrirPanel(b) {
  setStatus('statusBar','','ok');

  const panelNome = $('panelNome');
  const panelTags = $('panelTags');
  if (panelNome) panelNome.textContent = `${b.modalidade} — Concurso ${b.concurso}`;
  if (panelTags) {
    const slugOrigem = b.loterias?.slug || '';
    panelTags.innerHTML = `
      <span class="rtag rtag-origem" data-origem="${slugOrigem}">${b.loterias?.nome||'—'} (origem)</span>
      <span class="rtag rtag-green">${fmtBRL(b.valor_cota)}/cota</span>
      <span class="rtag">${b.qtd_jogos} jogos · ${b.qtd_dezenas} dez.</span>
      <span class="rtag">${b.qtd_cotas_total} cotas total</span>`;
  }

  const saldoWrap = $('movSaldoAtual');
  if (saldoWrap) {
    saldoWrap.innerHTML = '<div class="mov-saldo-label">Saldo atual por loja</div>';
    LOJAS.forEach(loja => {
      const id  = lojaIdPorSlug[loja.slug];
      const qtd = Number(saldosPorLoja[id]||0);
      if (qtd === 0 && id !== b.loteria_id) return;
      const item = document.createElement('div');
      item.className = 'msa-item' + (id === b.loteria_id ? ' origem' : '');
      item.innerHTML = `<div class="msa-loja">${loja.nome}</div><div class="msa-val">${qtd}</div>`;
      saldoWrap.appendChild(item);
    });
  }

  const grid = $('destinosGrid');
  if (grid) grid.innerHTML = '';

  LOJAS.forEach(loja => {
    const id     = lojaIdPorSlug[loja.slug];
    const ehOrig = id === b.loteria_id;
    const hist   = historicoPorLoja[id] || [];
    const histStr = hist.length ? hist.map(v => v < 0 ? `[${v}]` : String(v)).join(' + ') : '—';

    const field = document.createElement('div');
    field.className = 'destino-field';
    field.innerHTML = `
      <div class="destino-label">
        <img src="./icons/${loja.slug}.png" alt="${loja.nome}"
             onerror="this.style.display='none'"/>
        ${loja.nome}${ehOrig ? ' ★' : ''}
      </div>
      <div class="destino-input-wrap">
        <input type="number" class="destino-input" id="dest-${loja.slug}"
               placeholder="0" min="-999" step="1" ${ehOrig ? 'disabled' : ''}/>
      </div>
      <div class="destino-hist" id="hist-${loja.slug}">${ehOrig ? '(origem)' : histStr}</div>
      <div class="destino-sub" id="sub-${loja.slug}">—</div>`;
    if (grid) grid.appendChild(field);

    const input = $(`dest-${loja.slug}`);
    if (input && !ehOrig) input.addEventListener('input', () => onDestInput(loja.slug));
  });

  calcTotal();
  const panel = $('movPanel');
  if (panel) { panel.classList.add('open'); document.body.classList.add('panel-open'); }
}

function onDestInput(slug) {
  const inp = $(`dest-${slug}`);
  const sub = $(`sub-${slug}`);
  const qtd = parseInt(inp?.value,10) || 0;
  const cota = bolaoSelecionado?.valor_cota || 0;
  if (qtd !== 0) {
    if (sub) { sub.textContent = fmtBRL(Math.abs(qtd)*cota); sub.className = 'destino-sub on'; }
    if (inp) inp.classList.add('filled');
  } else {
    if (sub) { sub.textContent = '—'; sub.className = 'destino-sub'; }
    if (inp) inp.classList.remove('filled');
  }
  calcTotal();
}

function calcTotal() {
  let total = 0;
  LOJAS.forEach(l => {
    const inp = $(`dest-${l.slug}`);
    if (inp && !inp.disabled) total += Math.abs(parseInt(inp.value,10)||0);
  });
  const el = $('movTotal');
  if (el) el.textContent = total + ' cotas';
}

function zerarMov(limparStatus = true) {
  LOJAS.forEach(l => {
    const inp = $(`dest-${l.slug}`);
    if (inp && !inp.disabled) {
      inp.value = ''; inp.classList.remove('filled');
      const sub = $(`sub-${l.slug}`);
      if (sub) { sub.textContent = '—'; sub.className = 'destino-sub'; }
    }
  });
  calcTotal();
  if (limparStatus) setStatus('statusBar','','ok');
}

function fecharPanel() {
  const panel = $('movPanel');
  if (panel) panel.classList.remove('open');
  document.body.classList.remove('panel-open');
  document.querySelectorAll('.bolao-card').forEach(c => c.classList.remove('selected'));
  bolaoSelecionado = null;
}

// ── Modal de confirmação ───────────────────────────────────
function onMovimentar() {
  if (!bolaoSelecionado) return;
  const b = bolaoSelecionado;
  const deltas = {};
  let temDelta = false;

  LOJAS.forEach(l => {
    const inp = $(`dest-${l.slug}`);
    if (!inp || inp.disabled) return;
    const qtd = parseInt(inp.value,10) || 0;
    if (qtd !== 0) { deltas[l.slug] = qtd; temDelta = true; }
  });

  if (!temDelta) { setStatus('statusBar','Informe ao menos um valor de destino.','err'); return; }

  const icones = { boulevard:'🏢', centro:'🏙️', lotobel:'🏛️', 'santa-tereza':'⛪', 'via-brasil':'🛣️' };

  const linhas = [
    `📍 Origem: ${b.loterias?.nome||'—'}`,
    `🎯 ${b.modalidade} — Concurso ${b.concurso}`,
    `💰 Cota: ${fmtBRL(b.valor_cota)}`,
    '', '📊 CONFERÊNCIA:', '(Histórico [Mov] → Final)',
  ];

  LOJAS.forEach(l => {
    const id    = lojaIdPorSlug[l.slug];
    const delta = deltas[l.slug] || 0;
    const hist  = historicoPorLoja[id] || [];
    const saldo = Number(saldosPorLoja[id]||0);
    const final = saldo + delta;
    if (delta === 0 && hist.length === 0) return;
    const histStr  = hist.length ? hist.map(v => v<0?`[${v}]`:String(v)).join(' + ') : '0';
    const deltaStr = delta > 0 ? `[+${delta}]` : delta < 0 ? `[${delta}]` : '';
    linhas.push(delta !== 0
      ? `${icones[l.slug]||'📍'} ${l.nome}: ${histStr} ${deltaStr} → ${final}`
      : `${icones[l.slug]||'📍'} ${l.nome}: ${histStr} → ${saldo} (sem alteração)`);
  });
  linhas.push('', '⚠️ Confirma a movimentação?');

  const confirmBody = $('confirmBody');
  if (confirmBody) confirmBody.textContent = linhas.join('\n');
  const confirmOverlay = $('confirmOverlay');
  if (confirmOverlay) confirmOverlay.classList.add('show');
}

async function doMovimentar(b, deltas) {
  const btn = $('btnMovimentar');
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando…'; }
  setStatus('statusBar','Registrando movimentação…','info');

  try {
    const inserts = [];
    for (const [slug, qtd] of Object.entries(deltas)) {
      if (qtd === 0) continue;
      const destId = lojaIdPorSlug[slug];
      if (!destId) throw new Error(`Loja não encontrada: ${slug}`);
      inserts.push({
        bolao_id:        b.id,
        loteria_origem:  b.loteria_id,
        loteria_destino: destId,
        qtd_cotas:       qtd,
        valor_unitario:  b.valor_cota,
        status:          'ATIVO',
        criado_por:      usuario.id,
      });
    }
    if (!inserts.length) throw new Error('Nenhuma movimentação válida.');

    const { error } = await sb.from('movimentacoes_cotas').insert(inserts);
    if (error) throw new Error(error.message);

    const bolaoIdAtual = bolaoSelecionado?.id;

    if (bolaoSelecionado) {
      const origemId = bolaoSelecionado.loteria_id;
      Object.entries(deltas).forEach(([slug, qtdRaw]) => {
        const qtd    = Number(qtdRaw||0);
        const destId = lojaIdPorSlug[slug];
        if (!destId || qtd === 0) return;
        if (saldosPorLoja[destId]   == null) saldosPorLoja[destId]   = 0;
        saldosPorLoja[destId]   += qtd;
        saldosPorLoja[origemId] -= qtd;
        if (!historicoPorLoja[destId])   historicoPorLoja[destId]   = [];
        if (!historicoPorLoja[origemId]) historicoPorLoja[origemId] = [];
        historicoPorLoja[destId].push(qtd);
        historicoPorLoja[origemId].push(-qtd);
      });
      if (saldosPorLoja[origemId] < 0) saldosPorLoja[origemId] = 0;
      abrirPanel(bolaoSelecionado);
    }

    setStatus('statusBar','✓ Movimentação registrada com sucesso!','ok');
    zerarMov(false);
    await buscarBoloes();

    if (bolaoIdAtual) {
      const card = document.querySelector(`.bolao-card[data-id="${bolaoIdAtual}"]`);
      if (card) card.classList.add('selected');
    }
  } catch (e) {
    setStatus('statusBar', e.message, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px">
          <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
        Movimentar`;
    }
  }
}

// ══════════════════════════════════════════════════════════
// BINDINGS
// ══════════════════════════════════════════════════════════
function bind() {
  // Logout
  $('btnLogout')?.addEventListener('click', () => window.SISLOT_SECURITY.sair());

  // Loja-tree — cicla ao clicar
  $('lojaTreeWrap')?.addEventListener('click', ciclarLojaTree);

  // Data de referência
  $('btnDtPrev')?.addEventListener('click', () => {
    dataAtual.setDate(dataAtual.getDate()-1);
    atualizarDateDisplay(); fecharPanel(); buscarBoloes();
  });
  $('btnDtNext')?.addEventListener('click', () => {
    dataAtual.setDate(dataAtual.getDate()+1);
    atualizarDateDisplay(); fecharPanel(); buscarBoloes();
  });
  $('btnHoje')?.addEventListener('click', () => {
    dataAtual = new Date();
    atualizarDateDisplay(); fecharPanel(); buscarBoloes();
  });

  const dateDisplayBtn = $('dateDisplay');
  const calPicker      = $('calendarPicker');
  if (dateDisplayBtn && calPicker) {
    dateDisplayBtn.addEventListener('click', () => {
      calPicker.value = isoDate(dataAtual);
      calPicker.style.pointerEvents = 'auto';
      try { calPicker.showPicker(); } catch { calPicker.click(); }
    });
    calPicker.addEventListener('change', () => {
      calPicker.style.pointerEvents = 'none';
      if (!calPicker.value) return;
      const [y,m,d] = calPicker.value.split('-').map(Number);
      dataAtual = new Date(y, m-1, d);
      atualizarDateDisplay(); fecharPanel();
      filtroOrigem = ''; filtroConcurso = ''; filtroModalidade = ''; filtroDestino = '';
      sincronizarTemaComOrigem();
      buscarBoloes();
    });
  }

  // Filtros em cascata
  const fOrigem = $('filterOrigem'); const fConcurso = $('filterConcurso');
  const fModal  = $('filterModalidade'); const fDest = $('filterDestino');
  const btnClear = $('btnClearFilters');

  fOrigem?.addEventListener('change', () => {
    filtroOrigem = fOrigem.value;
    marcarSelectAtivo(fOrigem);
    sincronizarTemaComOrigem();
    renderFiltrosCascata(); aplicarFiltros(); fecharPanel();
  });
  fConcurso?.addEventListener('change', () => {
    filtroConcurso = fConcurso.value;
    marcarSelectAtivo(fConcurso);
    renderFiltrosCascata(); aplicarFiltros(); fecharPanel();
  });
  fModal?.addEventListener('change', () => {
    filtroModalidade = fModal.value;
    marcarSelectAtivo(fModal);
    renderFiltrosCascata(); aplicarFiltros(); fecharPanel();
  });
  fDest?.addEventListener('change', () => {
    filtroDestino = fDest.value;
    marcarSelectAtivo(fDest);
    renderFiltrosCascata(); aplicarFiltros(); fecharPanel();
  });
  btnClear?.addEventListener('click', () => {
    filtroOrigem = ''; filtroConcurso = ''; filtroModalidade = ''; filtroDestino = '';
    sincronizarTemaComOrigem();
    [fOrigem,fConcurso,fModal,fDest].forEach(sel=>{if(sel){sel.value='';marcarSelectAtivo(sel);}});
    renderFiltrosCascata(); aplicarFiltros();
  });

  // Panel
  $('btnFecharPanel')?.addEventListener('click', fecharPanel);
  $('btnZerarMov')?.addEventListener('click', () => zerarMov());
  $('btnMovimentar')?.addEventListener('click', onMovimentar);

  // Modal de confirmação
  const confirmOverlay = $('confirmOverlay');
  $('confirmCancel')?.addEventListener('click', () => confirmOverlay?.classList.remove('show'));
  confirmOverlay?.addEventListener('click', e => {
    if (e.target === confirmOverlay) confirmOverlay.classList.remove('show');
  });
  $('confirmOk')?.addEventListener('click', async () => {
    confirmOverlay?.classList.remove('show');
    if (!bolaoSelecionado) return;
    const deltas = {};
    LOJAS.forEach(l => {
      const inp = $(`dest-${l.slug}`);
      if (!inp || inp.disabled) return;
      const qtd = parseInt(inp.value,10) || 0;
      if (qtd !== 0) deltas[l.slug] = qtd;
    });
    await doMovimentar(bolaoSelecionado, deltas);
  });
}

// ══════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ══════════════════════════════════════════════════════════
async function init() {
  // Inicia tema e clock via SISLOT_THEME
  SISLOT_THEME.init();

  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user?.id) { location.href = './login.html'; return; }

  const usr = await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
  if (!usr) { location.href = './login.html'; return; }
  usuario = usr;

  // Carrega lojas do banco e constrói os mapas de lookup
  const { data: lojas } = await sb
    .from('loterias')
    .select('id, nome, slug')
    .eq('ativo', true)
    .order('nome');

  if (lojas) {
    lojas.forEach(l => {
      lojaIdPorSlug[l.slug] = l.id;
      lojaSlugPorId[l.id]   = l.slug;
      lojaNomePorId[l.id]   = l.nome;
    });
    // Reconstrói LOJAS na mesma ordem do banco para os campos de destino
    LOJAS = lojas.map(l => ({ slug: l.slug, nome: l.nome }));
  }

  bind();

  dataAtual = new Date();
  atualizarDateDisplay();
  sincronizarTemaComOrigem();

  await buscarBoloes();
}

init().catch(err => {
  console.error('movimentar init error:', err);
  alert('Erro ao iniciar movimentação: ' + (err.message||err));
});
