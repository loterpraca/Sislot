/**
 * SISLOT - Movimentação de Cotas
 * Versão corrigida - IDs do datePicker e dateDisplay ajustados
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

const utils = window.SISLOT_UTILS || {};

const $ = utils.$ || (id => document.getElementById(id));
const fmtBRL = utils.fmtBRL || (v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','));
const fmtData = utils.fmtData || (s => {
    if (!s) return '—';
    try {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        }
    } catch(e) {}
    return '—';
});
const isoDate = utils.isoDate || (date => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
});
const setStatus = utils.setStatus || ((id, msg, tipo) => {
    const el = $(id);
    if (el) {
        el.textContent = msg;
        el.className = `status-bar show ${tipo || 'ok'}`;
    }
});
const updateClock = utils.updateClock || (() => {
    const el = $('relogio');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR');
});
const startClock = utils.startClock || (() => { updateClock(); setInterval(updateClock, 1000); });

startClock();

const LOJAS = [
    { slug: 'boulevard',    nome: 'Boulevard',    logo: './icons/boulevard.png'    },
    { slug: 'centro',       nome: 'Centro',       logo: './icons/loterpraca.png'   },
    { slug: 'lotobel',      nome: 'Lotobel',      logo: './icons/lotobel.png'      },
    { slug: 'santa-tereza', nome: 'Santa Tereza', logo: './icons/santa-tereza.png' },
    { slug: 'via-brasil',   nome: 'Via Brasil',   logo: './icons/via-brasil.png'   },
];

let usuario = null;
let lojaIdPorSlug = {};
let lojaSlugPorId = {};
let lojaNomePorId = {};
let dataAtual = new Date();
let bolaoSelecionado = null;
let saldosPorLoja = {};
let historicoPorLoja = {};
let origemFiltro = '';
let modalidadeFiltro = '';
let concursoFiltro = null;
let usarDataReferencia = true;
let filtroAtivoTimer = null;

// =====================================================
// FORMATAÇÃO DE DATA
// =====================================================

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
                dia = parseInt(matchISO[3]);
                mes = parseInt(matchISO[2]);
                ano = parseInt(matchISO[1]);
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
        return '—';
    } catch (e) {
        console.error('Erro formatar data:', e);
        return '—';
    }
}

function dataAtualISO() {
    const d = dataAtual instanceof Date ? dataAtual : new Date(dataAtual);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dia}`;
}

// FIX: usava $('dateDisplayText') e $('calendarPicker') — IDs inexistentes.
// Correto: $('dateDisplay') e $('datePicker').
function atualizarDateDisplay() {
    const btn    = $('dateDisplay'); // botão visível com a data
    const picker = $('datePicker');  // input[type=date] oculto

    const iso = dataAtualISO();
    if (!iso) return;

    const [y, m, d] = iso.split('-');

    if (btn) btn.textContent = `${d}/${m}/${y}`;
    if (picker) picker.value = iso;
}

async function aplicarDataReferencia(novaData) {
    dataAtual = new Date(
        novaData.getFullYear(),
        novaData.getMonth(),
        novaData.getDate()
    );

    atualizarDateDisplay();
    atualizarEstadoFiltroData();
    fecharPanel();

    await carregarOrigens();
    await carregarModalidades();
    await buscarBoloes();
}

async function moverDataReferencia(deltaDias) {
    const d = new Date(
        dataAtual.getFullYear(),
        dataAtual.getMonth(),
        dataAtual.getDate()
    );

    d.setDate(d.getDate() + deltaDias);

    await aplicarDataReferencia(d);
}

// =====================================================
// FUNÇÕES ASSÍNCRONAS
// =====================================================
function intOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;

    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

function lerFiltrosAvancados() {
    origemFiltro = $('selOrigem')?.value || '';
    modalidadeFiltro = $('selModalidade')?.value || '';
    concursoFiltro = intOrNull($('inputConcurso')?.value);
    usarDataReferencia = $('chkUsarData') ? $('chkUsarData').checked : true;
}



function aplicarFiltrosBase(q, opts = {}) {
    const {
        usarFiltroData = true,
        usarFiltroOrigem = true,
        usarFiltroModalidade = true,
        usarFiltroConcurso = true
    } = opts;

    const iso = dataAtualISO();

    if (usarFiltroData && usarDataReferencia) {
        q = q
            .lte('dt_inicial', iso)
            .gte('dt_concurso', iso);
    }

    // Na Movimentação, origem do bolão = loteria_id
    if (usarFiltroOrigem && origemFiltro) {
        q = q.eq('loteria_id', Number(origemFiltro));
    }

    if (usarFiltroModalidade && modalidadeFiltro) {
        q = q.eq('modalidade', modalidadeFiltro);
    }
  if (usarFiltroConcurso && concursoFiltro !== null) {
    q = q.eq('concurso', concursoFiltro);
}
    return q;
}

function atualizarEstadoFiltroData() {
    const usandoData = $('chkUsarData') ? $('chkUsarData').checked : true;

    const btnDtPrev = $('btnDtPrev');
    const btnDtNext = $('btnDtNext');
    const btnHoje = $('btnHoje');
    const dateDisplay = $('dateDisplay');

    if (btnDtPrev) btnDtPrev.disabled = !usandoData;
    if (btnDtNext) btnDtNext.disabled = !usandoData;
    if (btnHoje) btnHoje.disabled = !usandoData;
    if (dateDisplay) dateDisplay.style.opacity = usandoData ? '1' : '.45';
}

function agendarFiltroAtivo(delay = 450) {
    clearTimeout(filtroAtivoTimer);

    filtroAtivoTimer = setTimeout(async () => {
        lerFiltrosAvancados();

        fecharPanel();

        await carregarOrigens();
        await carregarModalidades();
        await buscarBoloes();
    }, delay);
}
async function carregarOrigens() {
    lerFiltrosAvancados();

    let q = sb
        .from('boloes')
        .select(`
            loteria_id,
            loterias(id, nome, slug)
        `)
        .eq('status', 'ATIVO');

    q = aplicarFiltrosBase(q, {
        usarFiltroData: true,
        usarFiltroOrigem: true,
        usarFiltroModalidade: true,
        usarFiltroConcurso: true
    });

    const { data, error } = await q;
    if (error) return;

    const mapa = new Map();

    (data || []).forEach(r => {
        if (!r.loteria_id) return;

        if (!mapa.has(String(r.loteria_id))) {
            mapa.set(String(r.loteria_id), {
                id: r.loteria_id,
                nome: r.loterias?.nome || lojaNomePorId[r.loteria_id] || '—'
            });
        }
    });

    const sel = $('selOrigem');
    if (!sel) return;

    const atual = origemFiltro;

    sel.innerHTML = '<option value="">Origens</option>';

    [...mapa.values()]
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'))
        .forEach(r => {
            const op = document.createElement('option');
            op.value = r.id;
            op.textContent = r.nome;

            if (String(r.id) === String(atual)) {
                op.selected = true;
            }

            sel.appendChild(op);
        });
}

async function carregarModalidades() {
    lerFiltrosAvancados();

    let q = sb
        .from('boloes')
        .select('modalidade')
        .eq('status', 'ATIVO');

    q = aplicarFiltrosBase(q, {
        usarFiltroData: true,
        usarFiltroOrigem: true,
        usarFiltroModalidade: false,
        usarFiltroConcurso: false
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

    sel.innerHTML = '<option value="">Modalidades</option>';

    modalidades.forEach(mod => {
        const op = document.createElement('option');
        op.value = mod;
        op.textContent = mod;

        if (mod === atual) {
            op.selected = true;
        }

        sel.appendChild(op);
    });
}
async function buscarBoloes() {
    lerFiltrosAvancados();

    const loadingEl = $('stLoading');
    const vazioEl   = $('stVazio');
    const listaEl   = $('stLista');
    const countEl   = $('boloesCount');
    
    if (loadingEl) loadingEl.style.display = 'flex';
    if (vazioEl)   vazioEl.style.display   = 'none';
    if (listaEl)   listaEl.style.display   = 'none';
    if (countEl)   countEl.innerHTML       = '';

    let q = sb
        .from('boloes')
        .select(`
            id, modalidade, concurso, valor_cota, qtd_jogos, qtd_dezenas,
            qtd_cotas_total, dt_inicial, dt_concurso, status,
            loteria_id,
            loterias(id, nome, slug)
        `)
        .eq('status', 'ATIVO')
        .order('modalidade', { ascending: true })
        .order('concurso', { ascending: true })
        .order('valor_cota', { ascending: true })
        .order('loteria_id', { ascending: true });

    q = aplicarFiltrosBase(q);

    const { data: boloes, error } = await q;

    if (loadingEl) loadingEl.style.display = 'none';

    if (error || !boloes || !boloes.length) {
        if (vazioEl) {
            const vazioSub = $('stVazioSub');
            const textoData = usarDataReferencia
                ? ` para ${formatarDataSegura(dataAtual)}.`
                : '.';

            if (vazioSub) {
                vazioSub.textContent = `Nenhum bolão encontrado${textoData}`;
            }

            vazioEl.style.display = 'flex';
        }

        if (countEl) countEl.innerHTML = '';
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
    const lista   = $('stLista');
    const countEl = $('boloesCount');
    if (!lista) return;

    lista.innerHTML = '';

    const boloesBaseOrdenacao = (boloes || []).map(b => ({
    ...b,
    loteria_origem_nome: b.loterias?.nome || ''
}));

let grupos = {};
let gruposOrdenados = [];

if (utils.agruparOrdenarPorCampos) {
    const ordenado = utils.agruparOrdenarPorCampos(boloesBaseOrdenacao, {
        campoGrupo: 'modalidade',
        campoPreco: 'valor_cota',
        campoConcurso: 'concurso',
        campoOrigem: 'loteria_origem_nome'
    });

    grupos = ordenado.grupos;
    gruposOrdenados = ordenado.gruposOrdenados;
} else {
    // Fallback caso o sislot-utils.js ainda não tenha sido atualizado
    boloesBaseOrdenacao.forEach(b => {
        if (!grupos[b.modalidade]) grupos[b.modalidade] = [];
        grupos[b.modalidade].push(b);
    });

    gruposOrdenados = Object.keys(grupos).sort((a, b) =>
        String(a || '').localeCompare(String(b || ''), 'pt-BR')
    );

    gruposOrdenados.forEach(mod => {
        grupos[mod].sort((a, b) => {
            const precoA = Number(a.valor_cota || 0);
            const precoB = Number(b.valor_cota || 0);

            if (precoA !== precoB) return precoA - precoB;

            const concursoA = Number(a.concurso || 0);
            const concursoB = Number(b.concurso || 0);

            if (concursoA !== concursoB) return concursoA - concursoB;

            return String(a.loteria_origem_nome || '')
                .localeCompare(String(b.loteria_origem_nome || ''), 'pt-BR');
        });
    });
}

let totalCards = 0;

gruposOrdenados.forEach(mod => {
    const listaMod = grupos[mod] || [];

        const sep = document.createElement('div');
        sep.className = 'section-sep';
        sep.style.marginTop = totalCards > 0 ? '20px' : '0';
        sep.innerHTML = `
            <div class="section-sep-label">${mod}</div>
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
                            <span class="sp-loja">${p.loteria_nome || '—'}</span>
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
                        <span class="bolao-modal">${b.modalidade}</span>
                        <span class="bolao-concurso">#${b.concurso}</span>
                        <span class="bolao-origem">${b.loterias?.nome || '—'}</span>
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

    // Atualiza contador no cabeçalho
    if (countEl) {
        countEl.innerHTML = `<span>${totalCards}</span> bolões vigentes`;
    }
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
        const destId   = m.loteria_destino;
        const qtd      = Number(m.qtd_cotas || 0);

        if (!historicoPorLoja[destId])   historicoPorLoja[destId]   = [];
        historicoPorLoja[destId].push(qtd);

        if (!historicoPorLoja[origemId]) historicoPorLoja[origemId] = [];
        historicoPorLoja[origemId].push(-qtd);
    });

    abrirPanel(b);
}

function abrirPanel(b) {
    setStatus('statusBar', '', 'ok');

    const panelNome = $('panelNome');
    const panelTags = $('panelTags');
    if (panelNome) panelNome.textContent = `${b.modalidade} — Concurso ${b.concurso}`;
    if (panelTags) {
        panelTags.innerHTML = `
            <span class="rtag-amber rtag">${b.loterias?.nome || '—'} (origem)</span>
            <span class="rtag rtag-green">${fmtBRL(b.valor_cota)}/cota</span>
            <span class="rtag">${b.qtd_jogos} jogos · ${b.qtd_dezenas} dez.</span>
            <span class="rtag">${b.qtd_cotas_total} cotas total</span>
        `;
    }

    const saldoWrap = $('movSaldoAtual');
    if (saldoWrap) {
        saldoWrap.innerHTML = '<div class="msa-label">Saldo atual por loja</div>';
    }

    LOJAS.forEach(loja => {
        const id  = lojaIdPorSlug[loja.slug];
        const qtd = Number(saldosPorLoja[id] || 0);
        if (qtd === 0 && id !== b.loteria_id) return;

        const item = document.createElement('div');
        item.className = 'msa-item' + (id === b.loteria_id ? ' origem' : '');
        item.innerHTML = `<div class="msa-loja">${loja.nome}</div><div class="msa-val">${qtd}</div>`;
        if (saldoWrap) saldoWrap.appendChild(item);
    });

    const grid = $('destinosGrid');
    if (grid) grid.innerHTML = '';

    LOJAS.forEach(loja => {
        const id       = lojaIdPorSlug[loja.slug];
        const ehOrigem = id === b.loteria_id;
        const hist     = historicoPorLoja[id] || [];
        const histStr  = hist.length ? hist.map(v => v < 0 ? `[${v}]` : String(v)).join(' + ') : '—';

        const field = document.createElement('div');
        field.className = 'destino-field';
        field.innerHTML = `
            <div class="destino-label">
                <img src="${loja.logo}" alt="${loja.nome}"/>
                ${loja.nome}${ehOrigem ? ' ★' : ''}
            </div>
            <div class="destino-input-wrap">
               <input
                    inputmode="numeric"
                    class="destino-input"
                    id="dest-${loja.slug}"
                    placeholder="0"
                    autocomplete="off"
                    ${ehOrigem ? 'disabled' : ''}
                />
            </div>
            <div class="destino-hist" id="hist-${loja.slug}" title="Histórico">${ehOrigem ? '(origem)' : histStr}</div>
            <div class="destino-sub" id="sub-${loja.slug}">—</div>
        `;
        if (grid) grid.appendChild(field);

        const input = $(`dest-${loja.slug}`);
        if (input && !ehOrigem) {
            input.addEventListener('input', () => onDestInput(loja.slug));
        }
    });

    calcTotal();

    const panel = $('movPanel');
    if (panel) {
        panel.classList.add('open');
        document.body.classList.add('panel-open');
    }
}

function parseDeltaCotas(value) {
    const s = String(value || '').trim().replace(/\s+/g, '');
    if (!s) return 0;
    if (!/^-?\d+$/.test(s)) return 0;
    return parseInt(s, 10) || 0;
}

function onDestInput(slug) {
    const inp  = $(`dest-${slug}`);
    const sub  = $(`sub-${slug}`);
    const qtd  = parseDeltaCotas(inp?.value);
    const cota = bolaoSelecionado?.valor_cota || 0;

    if (qtd !== 0) {
        if (sub) { sub.textContent = fmtBRL(Math.abs(qtd) * cota); sub.className = 'destino-sub on'; }
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
        if (inp && !inp.disabled) total += Math.abs(parseDeltaCotas(inp.value));
    });
    const totalEl = $('movTotal');
    if (totalEl) totalEl.textContent = total + ' cotas';
}

function zerarMov(limparStatus = true) {
    LOJAS.forEach(l => {
        const inp = $(`dest-${l.slug}`);
        if (inp && !inp.disabled) {
            inp.value = '';
            inp.classList.remove('filled');
            const sub = $(`sub-${l.slug}`);
            if (sub) { sub.textContent = '—'; sub.className = 'destino-sub'; }
        }
    });
    calcTotal();
    if (limparStatus) setStatus('statusBar', '', 'ok');
}

function fecharPanel() {
    const panel = $('movPanel');
    if (panel) panel.classList.remove('open');
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
        const qtd = parseDeltaCotas(inp.value);
        if (qtd !== 0) { deltas[l.slug] = qtd; temDelta = true; }
    });

    if (!temDelta) {
        setStatus('statusBar', 'Informe ao menos um valor de destino.', 'err');
        return;
    }

    const linhas = [
        `📍 Origem: ${b.loterias?.nome || '—'}`,
        `🎯 ${b.modalidade} — Concurso ${b.concurso}`,
        `💰 Cota: ${fmtBRL(b.valor_cota)}`,
        '',
        '📊 CONFERÊNCIA DE MOVIMENTAÇÃO:',
        '(Histórico [Mov] → Final)',
    ];

    const icones = {
        'boulevard':    '🏢',
        'centro':       '🏙️',
        'lotobel':      '🏛️',
        'santa-tereza': '⛪',
        'via-brasil':   '🛣️',
    };

    LOJAS.forEach(l => {
        const id    = lojaIdPorSlug[l.slug];
        const delta = deltas[l.slug] || 0;
        const hist  = historicoPorLoja[id] || [];
        const saldo = Number(saldosPorLoja[id] || 0);
        const final = saldo + delta;
        if (delta === 0 && hist.length === 0) return;
        const histStr  = hist.length ? hist.map(v => v < 0 ? `[${v}]` : String(v)).join(' + ') : '0';
        const deltaStr = delta > 0 ? `[+${delta}]` : delta < 0 ? `[${delta}]` : '';
        if (delta !== 0) {
            linhas.push(`${icones[l.slug] || '📍'} ${l.nome}: ${histStr} ${deltaStr} → ${final}`);
        } else {
            linhas.push(`${icones[l.slug] || '📍'} ${l.nome}: ${histStr} → ${saldo} (sem alteração)`);
        }
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
    setStatus('statusBar', 'Registrando movimentação…', 'info');

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
                const qtd    = Number(qtdRaw || 0);
                const destId = lojaIdPorSlug[slug];
                if (!destId || qtd === 0) return;
                if (saldosPorLoja[destId] == null) saldosPorLoja[destId] = 0;
                saldosPorLoja[destId]  += qtd;
                saldosPorLoja[origemId] -= qtd;
                if (!historicoPorLoja[destId])   historicoPorLoja[destId]   = [];
                historicoPorLoja[destId].push(qtd);
                if (!historicoPorLoja[origemId]) historicoPorLoja[origemId] = [];
                historicoPorLoja[origemId].push(-qtd);
            });
            if (saldosPorLoja[origemId] < 0) saldosPorLoja[origemId] = 0;
            abrirPanel(bolaoSelecionado);
        }

        setStatus('statusBar', '✓ Movimentação registrada com sucesso!', 'ok');
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">
                    <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                    <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
                Movimentar`;
        }
    }
}

function bind() {
    const btnMenu        = $('btnMenu');
    const btnLogout      = $('btnLogout');
    const btnDtPrev      = $('btnDtPrev');
    const btnDtNext      = $('btnDtNext');
    const btnHoje        = $('btnHoje');
    const dateDisplay    = $('dateDisplay');   // botão visível
    const datePicker     = $('datePicker');    // FIX: era 'calendarPicker' (ID inexistente)
    const btnFecharPanel = $('btnFecharPanel');
    const btnZerarMov    = $('btnZerarMov');
    const btnMovimentar  = $('btnMovimentar');
    const confirmCancel  = $('confirmCancel');
    const confirmOverlay = $('confirmOverlay');
    const confirmOk      = $('confirmOk');

    if (btnMenu)   btnMenu.addEventListener('click', () => window.SISLOT_SECURITY.irParaInicio());
    if (btnLogout) btnLogout.addEventListener('click', async () => await window.SISLOT_SECURITY.sair());

    if (btnDtPrev) btnDtPrev.onclick = () => moverDataReferencia(-1);
    if (btnDtNext) btnDtNext.onclick = () => moverDataReferencia(1);

    if (btnHoje) {
        btnHoje.onclick = () => {
            const hoje = new Date();
            aplicarDataReferencia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
        };
    }

    // Clique no botão da data abre o picker nativo
    if (dateDisplay && datePicker) {
        dateDisplay.onclick = () => {
            atualizarDateDisplay();
            if (typeof datePicker.showPicker === 'function') {
                datePicker.showPicker();
            } else {
                datePicker.click();
            }
        };
    }

    // Mudança no picker aplica nova data
    if (datePicker) {
        datePicker.onchange = () => {
            if (!datePicker.value) return;
            const [y, m, d] = datePicker.value.split('-').map(Number);
            aplicarDataReferencia(new Date(y, m - 1, d));
        };
    }

    if (btnFecharPanel) btnFecharPanel.addEventListener('click', fecharPanel);
    if (btnZerarMov)    btnZerarMov.addEventListener('click', () => zerarMov());
    if (btnMovimentar)  btnMovimentar.addEventListener('click', onMovimentar);

    if (confirmCancel) confirmCancel.addEventListener('click', () => {
        if (confirmOverlay) confirmOverlay.classList.remove('show');
    });
    if (confirmOverlay) confirmOverlay.addEventListener('click', (e) => {
        if (e.target === confirmOverlay) confirmOverlay.classList.remove('show');
    });
    if (confirmOk) confirmOk.addEventListener('click', async () => {
        if (confirmOverlay) confirmOverlay.classList.remove('show');
        if (!bolaoSelecionado) return;
        const deltas = {};
        LOJAS.forEach(l => {
            const inp = $(`dest-${l.slug}`);
            if (!inp || inp.disabled) return;
            const qtd = parseDeltaCotas(inp.value);
            if (qtd !== 0) deltas[l.slug] = qtd;
        });
        await doMovimentar(bolaoSelecionado, deltas);
    });
    const selOrigem = $('selOrigem');
const selModalidade = $('selModalidade');
const chkUsarData = $('chkUsarData');
const inputConcurso = $('inputConcurso');

if (selOrigem) {
    selOrigem.addEventListener('change', async e => {
        origemFiltro = e.target.value || '';

        fecharPanel();

        await carregarModalidades();
        await buscarBoloes();
    });
}

if (selModalidade) {
    selModalidade.addEventListener('change', async e => {
        modalidadeFiltro = e.target.value || '';

        fecharPanel();

        await carregarOrigens();
        await buscarBoloes();
    });
}

if (chkUsarData) {
    chkUsarData.addEventListener('change', async e => {
        usarDataReferencia = e.target.checked;

        atualizarEstadoFiltroData();
        fecharPanel();

        await carregarOrigens();
        await carregarModalidades();
        await buscarBoloes();
    });
}
if (inputConcurso) {
    inputConcurso.addEventListener('input', () => {
        agendarFiltroAtivo(450);
    });
}

    if (utils.bindAtalhosPorSecao) {
    utils.bindAtalhosPorSecao({
        namespace: 'movimentacao-cotas-boloes',
        listaId: 'stLista',
        offsetTopo: 105,
        labelSelector: '.section-sep-label',
        blocoSelector: '.section-sep',
        ativoQuando: () => true,
        onNaoEncontrou: () => setStatus('statusBar', 'Modalidade não encontrada nesta lista.', 'info')
    });
}
}

// =====================================================
// INICIALIZAÇÃO
// =====================================================

async function init() {
    console.log('movimentar.js - init rodando!');

    updateClock();
    setInterval(updateClock, 1000);

    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user?.id) { location.href = './login.html'; return; }

    const usr = await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
    if (!usr) { location.href = './login.html'; return; }
    usuario = usr;

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
    }
    
    bind();

dataAtual = new Date();
atualizarDateDisplay();
atualizarEstadoFiltroData();

await carregarOrigens();
await carregarModalidades();
await buscarBoloes();
}

init();
