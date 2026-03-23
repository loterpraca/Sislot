const sb = supabase.createClient(
  window.SISLOT_CONFIG.url,
  window.SISLOT_CONFIG.anonKey
);

const utils = window.SISLOT_UTILS || {};
const $ = utils.$ || (id => document.getElementById(id));
const fmtBRL = utils.fmtBRL || (v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','));
const isoDate = utils.isoDate || (date => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
});

function setStatus(id, msg = '', tipo = 'ok') {
  const el = $(id);
  if (!el) return;
  if (!msg) {
    el.textContent = '';
    el.className = 'sl-status-bar';
    return;
  }
  const map = { info: 'warn', muted: 'warn' };
  const finalTipo = map[tipo] || tipo || 'ok';
  el.textContent = msg;
  el.className = `sl-status-bar show ${finalTipo}`;
}

function formatarDataSegura(data) {
  if (!data) return '—';
  try {
    let dia, mes, ano;
    if (data instanceof Date && !isNaN(data.getTime())) {
      dia = data.getDate();
      mes = data.getMonth() + 1;
      ano = data.getFullYear();
    } else if (typeof data === 'string') {
      const matchISO = data.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (matchISO) {
        dia = parseInt(matchISO[3], 10);
        mes = parseInt(matchISO[2], 10);
        ano = parseInt(matchISO[1], 10);
      } else {
        const d = new Date(data);
        if (!isNaN(d.getTime())) {
          dia = d.getDate();
          mes = d.getMonth() + 1;
          ano = d.getFullYear();
        }
      }
    }
    if (dia && mes && ano) {
      return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
    }
  } catch (e) {
    console.error('Erro formatar data:', e);
  }
  return '—';
}

const LOJAS = [
  { slug: 'boulevard',    nome: 'Boulevard',    logo: './icons/boulevard.png'    },
  { slug: 'centro',       nome: 'Centro',       logo: './icons/loterpraca.png'   },
  { slug: 'lotobel',      nome: 'Lotobel',      logo: './icons/lotobel.png'      },
  { slug: 'santa-tereza', nome: 'Santa Tereza', logo: './icons/santa-tereza.png' },
  { slug: 'via-brasil',   nome: 'Via Brasil',   logo: './icons/via-brasil.png'   },
];

let usuario = null;
let lojaIdPorSlug = {};
let dataAtual = new Date();
let bolaoSelecionado = null;
let saldosPorLoja = {};
let historicoPorLoja = {};

init();

async function init() {
  try {
    if (window.SISLOT_THEME?.init) window.SISLOT_THEME.init();
    await validarSessao();
    await carregarLoterias();
    bind();
    atualizarDateDisplay();
    await buscarBoloes();

    document.addEventListener('sislot:tema', async () => {
      await buscarBoloes();
    });
  } catch (e) {
    console.error(e);
    setStatus('statusBar', e.message || 'Erro ao carregar o módulo.', 'err');
  }
}

async function validarSessao() {
  const { data: { session }, error } = await sb.auth.getSession();
  if (error) throw new Error(error.message);
  if (!session?.user?.id) {
    location.href = './login.html';
    return;
  }

  if (window.SISLOT_SECURITY?.validarUsuarioLogavel) {
    const usr = await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
    if (!usr) {
      location.href = './login.html';
      return;
    }
    usuario = usr;
    return;
  }

  usuario = { id: session.user.id };
}

async function carregarLoterias() {
  const { data: lojas, error } = await sb
    .from('loterias')
    .select('id, nome, slug')
    .eq('ativo', true)
    .order('nome');

  if (error) throw new Error(error.message);

  lojaIdPorSlug = {};
  (lojas || []).forEach(l => {
    lojaIdPorSlug[l.slug] = l.id;
  });
}

function atualizarDateDisplay() {
  const displayEl = $('dateDisplay');
  if (displayEl) displayEl.textContent = formatarDataSegura(dataAtual);
}

async function buscarBoloes() {
  const loadingEl = $('stLoading');
  const vazioEl = $('stVazio');
  const listaEl = $('stLista');
  const countEl = $('boloesCount');

  if (loadingEl) loadingEl.style.display = 'flex';
  if (vazioEl) vazioEl.style.display = 'none';
  if (listaEl) listaEl.style.display = 'none';
  if (countEl) countEl.innerHTML = '';

  const iso = isoDate(dataAtual);

  const { data: boloes, error } = await sb
    .from('boloes')
    .select(`
      id, modalidade, concurso, valor_cota, qtd_jogos, qtd_dezenas,
      qtd_cotas_total, dt_inicial, dt_concurso, status,
      loteria_id,
      loterias(id, nome, slug)
    `)
    .eq('status', 'ATIVO')
    .lte('dt_inicial', iso)
    .gte('dt_concurso', iso)
    .order('modalidade')
    .order('loteria_id');

  if (loadingEl) loadingEl.style.display = 'none';

  if (error || !boloes || !boloes.length) {
    if (vazioEl) {
      const vazioSub = $('stVazioSub');
      if (vazioSub) vazioSub.textContent = `Nenhum bolão ativo para ${formatarDataSegura(dataAtual)}.`;
      vazioEl.style.display = 'flex';
    }
    return;
  }

  const ids = boloes.map(b => b.id);

  const { data: posicoes } = await sb
    .from('view_posicao_bolao_lojas')
    .select('*')
    .in('bolao_id', ids);

  const { data: movs } = await sb
    .from('movimentacoes_cotas')
    .select('bolao_id, loteria_origem, loteria_destino, qtd_cotas')
    .in('bolao_id', ids)
    .eq('status', 'ATIVO');

  renderBoloes(boloes, posicoes || [], movs || []);
}

function renderBoloes(boloes, posicoes, movs) {
  const lista = $('stLista');
  if (!lista) return;

  lista.innerHTML = '';
  const grupos = {};
  boloes.forEach(b => {
    if (!grupos[b.modalidade]) grupos[b.modalidade] = [];
    grupos[b.modalidade].push(b);
  });

  const mods = Object.keys(grupos).sort();
  let totalCards = 0;

  mods.forEach(mod => {
    const listaMod = grupos[mod].sort((a, b) => {
      const nA = a.loterias?.nome || '';
      const nB = b.loterias?.nome || '';
      if (nA !== nB) return nA < nB ? -1 : 1;
      return (a.valor_cota || 0) - (b.valor_cota || 0);
    });

    const sep = document.createElement('div');
    sep.className = 'section-sep';
    sep.style.marginTop = totalCards > 0 ? '20px' : '0';
    sep.innerHTML = `
      <div class="section-sep-label">${escapeHtml(mod)}</div>
      <div class="section-sep-line"></div>
      <div class="section-sep-count">${listaMod.length}</div>
    `;
    lista.appendChild(sep);

    const grid = document.createElement('div');
    grid.className = 'boloes-grid';

    listaMod.forEach((b, i) => {
      const pos = posicoes.filter(p => p.bolao_id === b.id);
      let saldoPills = '';

      if (pos.length) {
        pos.forEach(p => {
          const qtd = Number(p.qtd_cotas_posicao || 0);
          if (qtd > 0) {
            saldoPills += `<div class="saldo-pill">
              <span class="sp-loja">${escapeHtml(p.loteria_nome || '—')}</span>
              <span class="sp-val">${qtd}</span>
            </div>`;
          }
        });
      }

      if (!saldoPills) {
        saldoPills = '<div class="saldo-pill"><span class="sp-loja">Sem distribuição</span></div>';
      }

      const card = document.createElement('div');
      card.className = 'bolao-card';
      card.dataset.id = b.id;
      card.style.animationDelay = (i * 0.04) + 's';
      card.innerHTML = `
        <div class="bolao-main">
          <div class="bolao-header">
            <span class="bolao-modal">${escapeHtml(b.modalidade)}</span>
            <span class="bolao-concurso">#${escapeHtml(String(b.concurso || '—'))}</span>
            <span class="bolao-origem">${escapeHtml(b.loterias?.nome || '—')}</span>
          </div>
          <div class="bolao-tags">
            <span class="btag">${Number(b.qtd_jogos || 0)} jogos</span>
            <span class="btag">${Number(b.qtd_dezenas || 0)} dez.</span>
            <span class="btag">${Number(b.qtd_cotas_total || 0)} cotas</span>
            <span class="btag">${fmtBRL(b.valor_cota)}/cota</span>
          </div>
          <div class="bolao-saldos">${saldoPills}</div>
        </div>
        <div class="bolao-select-ind">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 6 5 9 10 3"/>
          </svg>
        </div>
      `;
      card.addEventListener('click', () => selecionarBolao(b, pos, movs));
      grid.appendChild(card);
      totalCards++;
    });

    lista.appendChild(grid);
  });

  lista.style.display = 'block';
  const countEl = $('boloesCount');
  if (countEl) countEl.innerHTML = `<span>${totalCards}</span> bolões vigentes`;
}

function selecionarBolao(b, posicoes, movs) {
  document.querySelectorAll('.bolao-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.bolao-card[data-id="${b.id}"]`);
  if (card) card.classList.add('selected');

  bolaoSelecionado = b;
  saldosPorLoja = {};
  historicoPorLoja = {};

  LOJAS.forEach(loja => {
    const lojaId = lojaIdPorSlug[loja.slug];
    saldosPorLoja[lojaId] = 0;
  });

  posicoes.forEach(p => {
    saldosPorLoja[p.loteria_id] = Number(p.qtd_cotas_posicao || 0);
  });

  const movsBolao = movs.filter(m => m.bolao_id === b.id);
  movsBolao.forEach(m => {
    const origemId = m.loteria_origem;
    const destId = m.loteria_destino;
    const qtd = Number(m.qtd_cotas || 0);

    if (!historicoPorLoja[destId]) historicoPorLoja[destId] = [];
    historicoPorLoja[destId].push(qtd);

    if (!historicoPorLoja[origemId]) historicoPorLoja[origemId] = [];
    historicoPorLoja[origemId].push(-qtd);
  });

  abrirPanel(b);
}

function abrirPanel(b) {
  setStatus('statusBar', '', 'ok');
  $('panelNome').textContent = `${b.modalidade} — Concurso ${b.concurso}`;
  $('panelTags').innerHTML = `
    <span class="rtag rtag-amber">${escapeHtml(b.loterias?.nome || '—')} (origem)</span>
    <span class="rtag rtag-green">${fmtBRL(b.valor_cota)}/cota</span>
    <span class="rtag">${Number(b.qtd_jogos || 0)} jogos · ${Number(b.qtd_dezenas || 0)} dez.</span>
    <span class="rtag">${Number(b.qtd_cotas_total || 0)} cotas total</span>
  `;

  const saldoWrap = $('movSaldoAtual');
  saldoWrap.innerHTML = '<div class="msa-label">Saldo atual por loja</div>';

  LOJAS.forEach(loja => {
    const id = lojaIdPorSlug[loja.slug];
    const qtd = Number(saldosPorLoja[id] || 0);
    if (qtd === 0 && id !== b.loteria_id) return;
    const item = document.createElement('div');
    item.className = 'msa-item' + (id === b.loteria_id ? ' origem' : '');
    item.innerHTML = `<div class="msa-loja">${escapeHtml(loja.nome)}</div><div class="msa-val">${qtd}</div>`;
    saldoWrap.appendChild(item);
  });

  const grid = $('destinosGrid');
  grid.innerHTML = '';

  LOJAS.forEach(loja => {
    const id = lojaIdPorSlug[loja.slug];
    const ehOrigem = id === b.loteria_id;
    const hist = historicoPorLoja[id] || [];
    const histStr = hist.length ? hist.map(v => v < 0 ? `[${v}]` : String(v)).join(' + ') : '—';

    const field = document.createElement('div');
    field.className = 'destino-field';
    field.innerHTML = `
      <div class="destino-label">
        <img src="${loja.logo}" alt="${escapeHtml(loja.nome)}"/>
        ${escapeHtml(loja.nome)}${ehOrigem ? ' ★' : ''}
      </div>
      <div class="destino-input-wrap">
        <input type="number" class="destino-input" id="dest-${loja.slug}" placeholder="0" min="-999" step="1" ${ehOrigem ? 'disabled' : ''}/>
      </div>
      <div class="destino-hist" id="hist-${loja.slug}" title="Histórico">${ehOrigem ? '(origem)' : histStr}</div>
      <div class="destino-sub" id="sub-${loja.slug}">—</div>
    `;
    grid.appendChild(field);

    const input = $(`dest-${loja.slug}`);
    if (input && !ehOrigem) input.addEventListener('input', () => onDestInput(loja.slug));
  });

  calcTotal();
  $('movPanel').classList.add('open');
  document.body.classList.add('panel-open');
}

function onDestInput(slug) {
  const inp = $(`dest-${slug}`);
  const sub = $(`sub-${slug}`);
  const qtd = parseInt(inp?.value, 10) || 0;
  const cota = bolaoSelecionado?.valor_cota || 0;

  if (qtd !== 0) {
    sub.textContent = fmtBRL(Math.abs(qtd) * cota);
    sub.className = 'destino-sub on';
    inp.classList.add('filled');
  } else {
    sub.textContent = '—';
    sub.className = 'destino-sub';
    inp.classList.remove('filled');
  }
  calcTotal();
}

function calcTotal() {
  let total = 0;
  LOJAS.forEach(l => {
    const inp = $(`dest-${l.slug}`);
    if (inp && !inp.disabled) total += Math.abs(parseInt(inp.value, 10) || 0);
  });
  $('movTotal').textContent = total + ' cotas';
}

function zerarMov(limparStatus = true) {
  LOJAS.forEach(l => {
    const inp = $(`dest-${l.slug}`);
    if (inp && !inp.disabled) {
      inp.value = '';
      inp.classList.remove('filled');
      const sub = $(`sub-${l.slug}`);
      if (sub) {
        sub.textContent = '—';
        sub.className = 'destino-sub';
      }
    }
  });
  calcTotal();
  if (limparStatus) setStatus('statusBar', '', 'ok');
}

function fecharPanel() {
  $('movPanel').classList.remove('open');
  document.body.classList.remove('panel-open');
  document.querySelectorAll('.bolao-card').forEach(c => c.classList.remove('selected'));
  bolaoSelecionado = null;
}

function onMovimentar() {
  if (!bolaoSelecionado) return;

  const b = bolaoSelecionado;
  const deltas = {};
  let temDelta = false;

  LOJAS.forEach(l => {
    const inp = $(`dest-${l.slug}`);
    if (!inp || inp.disabled) return;
    const qtd = parseInt(inp.value, 10) || 0;
    if (qtd !== 0) {
      deltas[l.slug] = qtd;
      temDelta = true;
    }
  });

  if (!temDelta) {
    setStatus('statusBar', 'Informe ao menos um valor de destino.', 'err');
    return;
  }

  const linhas = [
    `Origem: ${b.loterias?.nome || '—'}`,
    `${b.modalidade} — Concurso ${b.concurso}`,
    `Cota: ${fmtBRL(b.valor_cota)}`,
    '',
    'CONFERÊNCIA DE MOVIMENTAÇÃO',
    '(Histórico [Mov] → Final)',
  ];

  LOJAS.forEach(l => {
    const id = lojaIdPorSlug[l.slug];
    const delta = deltas[l.slug] || 0;
    const hist = historicoPorLoja[id] || [];
    const saldo = Number(saldosPorLoja[id] || 0);
    const final = saldo + delta;
    if (delta === 0 && hist.length === 0) return;
    const histStr = hist.length ? hist.map(v => v < 0 ? `[${v}]` : String(v)).join(' + ') : '0';
    const deltaStr = delta > 0 ? `[+${delta}]` : delta < 0 ? `[${delta}]` : '';
    if (delta !== 0) {
      linhas.push(`${l.nome}: ${histStr} ${deltaStr} → ${final}`);
    } else {
      linhas.push(`${l.nome}: ${histStr} → ${saldo} (sem alteração)`);
    }
  });

  linhas.push('', 'Confirma a movimentação?');
  $('confirmBody').textContent = linhas.join('\\n');
  $('confirmOverlay').style.display = 'flex';
}

async function doMovimentar(b, deltas) {
  const btn = $('btnMovimentar');
  btn.disabled = true;
  btn.classList.add('loading');
  setStatus('statusBar', 'Registrando movimentação…', 'warn');

  try {
    const inserts = [];

    for (const [slug, qtd] of Object.entries(deltas)) {
      if (qtd === 0) continue;
      const destId = lojaIdPorSlug[slug];
      if (!destId) throw new Error(`Loja não encontrada: ${slug}`);

      inserts.push({
        bolao_id: b.id,
        loteria_origem: b.loteria_id,
        loteria_destino: destId,
        qtd_cotas: qtd,
        valor_unitario: b.valor_cota,
        status: 'ATIVO',
        criado_por: usuario?.id || null,
      });
    }

    if (!inserts.length) throw new Error('Nenhuma movimentação válida.');
    const { error } = await sb.from('movimentacoes_cotas').insert(inserts);
    if (error) throw new Error(error.message);

    setStatus('statusBar', 'Movimentação registrada com sucesso.', 'ok');
    zerarMov(false);
    await buscarBoloes();
  } catch (e) {
    console.error(e);
    setStatus('statusBar', e.message || 'Erro ao registrar movimentação.', 'err');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

function bind() {
  $('btnLogout')?.addEventListener('click', async () => {
    if (window.SISLOT_SECURITY?.sair) {
      await window.SISLOT_SECURITY.sair();
    } else {
      location.href = './login.html';
    }
  });

  $('btnDtPrev')?.addEventListener('click', async () => {
    dataAtual.setDate(dataAtual.getDate() - 1);
    atualizarDateDisplay();
    fecharPanel();
    await buscarBoloes();
  });

  $('btnDtNext')?.addEventListener('click', async () => {
    dataAtual.setDate(dataAtual.getDate() + 1);
    atualizarDateDisplay();
    fecharPanel();
    await buscarBoloes();
  });

  $('btnHoje')?.addEventListener('click', async () => {
    dataAtual = new Date();
    atualizarDateDisplay();
    fecharPanel();
    await buscarBoloes();
  });

  $('btnFecharPanel')?.addEventListener('click', fecharPanel);
  $('btnZerarMov')?.addEventListener('click', () => zerarMov());
  $('btnMovimentar')?.addEventListener('click', onMovimentar);

  $('confirmCancel')?.addEventListener('click', () => {
    $('confirmOverlay').style.display = 'none';
  });

  $('confirmOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('confirmOverlay')) $('confirmOverlay').style.display = 'none';
  });

  $('confirmOk')?.addEventListener('click', async () => {
    $('confirmOverlay').style.display = 'none';
    if (!bolaoSelecionado) return;

    const deltas = {};
    LOJAS.forEach(l => {
      const inp = $(`dest-${l.slug}`);
      if (!inp || inp.disabled) return;
      const qtd = parseInt(inp.value, 10) || 0;
      if (qtd !== 0) deltas[l.slug] = qtd;
    });

    await doMovimentar(bolaoSelecionado, deltas);
  });
}

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
