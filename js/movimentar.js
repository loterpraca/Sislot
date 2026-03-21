/**
 * SISLOT - Movimentação de Cotas
 * Versão refatorada com utils
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

// Importa funções do utils com fallbacks
const utils = window.SISLOT_UTILS || {};

const $ = utils.$ || (id => document.getElementById(id));
const fmtBRL = utils.fmtBRL || (v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','));
const fmtData = utils.fmtData || (s => { if (!s) return '—'; const [y, m, d] = String(s).split('-'); return `${d}/${m}/${y}`; });
const isoDate = utils.isoDate || (date => date ? date.toISOString().slice(0, 10) : '');
const setStatus = utils.setStatus || ((id, msg, tipo) => { const el = $(id); if (el) { el.textContent = msg; el.className = `status-bar show ${tipo}`; } });
const updateClock = utils.updateClock || (() => { const el = $('relogio'); if (!el) return; const now = new Date(); el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR'); });
const startClock = utils.startClock || (() => { updateClock(); setInterval(updateClock, 1000); });

// Inicia o relógio
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

async function init() {
        // Diagnóstico
    console.log('=== DIAGNÓSTICO MOVIMENTACAO ===');
    console.log('utils disponível:', !!window.SISLOT_UTILS);
    if (window.SISLOT_UTILS) {
        console.log('fmtData disponível:', typeof window.SISLOT_UTILS.fmtData);
        console.log('isoDate disponível:', typeof window.SISLOT_UTILS.isoDate);
        
        // Teste de formatação
        const testDate = new Date();
        console.log('Teste fmtData com Date:', window.SISLOT_UTILS.fmtData(testDate));
        console.log('Teste fmtData com string ISO:', window.SISLOT_UTILS.fmtData('2026-03-21'));
        console.log('Teste isoDate:', window.SISLOT_UTILS.isoDate(testDate));
    }
    updateClock();
    setInterval(updateClock, 1000);

    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user?.id) {
        location.href = './login.html';
        return;
    }

    const usr = await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
    if (!usr) {
        location.href = './login.html';
        return;
    }
    usuario = usr;

    const { data: lojas } = await sb
        .from('loterias')
        .select('id, nome, slug')
        .eq('ativo', true)
        .order('nome');

    if (lojas) {
        lojas.forEach(l => {
            lojaIdPorSlug[l.slug] = l.id;
            lojaSlugPorId[l.id] = l.slug;
            lojaNomePorId[l.id] = l.nome;
        });
    }

    bind();
    dataAtual = new Date();
    atualizarDateDisplay();
    await buscarBoloes();
}

function bind() {
    const btnMenu = $('btnMenu');
    const btnLogout = $('btnLogout');
    const btnDtPrev = $('btnDtPrev');
    const btnDtNext = $('btnDtNext');
    const btnHoje = $('btnHoje');
    const btnFecharPanel = $('btnFecharPanel');
    const btnZerarMov = $('btnZerarMov');
    const btnMovimentar = $('btnMovimentar');
    const confirmCancel = $('confirmCancel');
    const confirmOverlay = $('confirmOverlay');
    const confirmOk = $('confirmOk');

    if (btnMenu) btnMenu.addEventListener('click', () => window.SISLOT_SECURITY.irParaInicio());
    if (btnLogout) btnLogout.addEventListener('click', async () => await window.SISLOT_SECURITY.sair());
    if (btnDtPrev) btnDtPrev.addEventListener('click', () => mudarData(-1));
    if (btnDtNext) btnDtNext.addEventListener('click', () => mudarData(1));
    if (btnHoje) btnHoje.addEventListener('click', async () => {
        dataAtual = new Date();
        atualizarDateDisplay();
        fecharPanel();
        await buscarBoloes();
    });
    if (btnFecharPanel) btnFecharPanel.addEventListener('click', fecharPanel);
    if (btnZerarMov) btnZerarMov.addEventListener('click', () => zerarMov());
    if (btnMovimentar) btnMovimentar.addEventListener('click', onMovimentar);
    if (confirmCancel) confirmCancel.addEventListener('click', () => {
        if (confirmOverlay) confirmOverlay.classList.remove('show');
    });
    if (confirmOverlay) confirmOverlay.addEventListener('click', (e) => {
        if (e.target === confirmOverlay) {
            confirmOverlay.classList.remove('show');
        }
    });
    if (confirmOk) confirmOk.addEventListener('click', async () => {
        if (confirmOverlay) confirmOverlay.classList.remove('show');
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

function atualizarDateDisplay() {
    const displayEl = $('dateDisplay');
    if (displayEl) {
        // Força a conversão para string ISO antes de formatar
        const dataISO = isoDate(dataAtual);
        displayEl.textContent = fmtData(dataISO);
    }
}

async function mudarData(delta) {
    dataAtual.setDate(dataAtual.getDate() + delta);
    atualizarDateDisplay();
    fecharPanel();
    await buscarBoloes();
}

async function buscarBoloes() {
    $('stLoading').style.display = 'flex';
    $('stVazio').style.display = 'none';
    $('stLista').style.display = 'none';
    $('boloesCount').innerHTML = '';

    // Garante que a data seja string ISO
    const iso = isoDate(dataAtual);
    
    // Resto do código...
}
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

    $('stLoading').style.display = 'none';

    if (error || !boloes || !boloes.length) {
        $('stVazioSub').textContent = `Nenhum bolão ativo para ${fmtData(dataAtual)}.`;
        $('stVazio').style.display = 'flex';
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

    $('stLista').style.display = 'block';
    $('boloesCount').innerHTML = `<span>${totalCards}</span> bolões vigentes`;
}

function selecionarBolao(b, posicoes, movs) {
    document.querySelectorAll('.bolao-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.bolao-card[data-id="${b.id}"]`)?.classList.add('selected');

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
    setStatus('statusBar', '', 'ok'); // limpa status

    $('panelNome').textContent = `${b.modalidade} — Concurso ${b.concurso}`;
    $('panelTags').innerHTML = `
        <span class="rtag-amber rtag">${b.loterias?.nome || '—'} (origem)</span>
        <span class="rtag rtag-green">${fmtBRL(b.valor_cota)}/cota</span>
        <span class="rtag">${b.qtd_jogos} jogos · ${b.qtd_dezenas} dez.</span>
        <span class="rtag">${b.qtd_cotas_total} cotas total</span>
    `;

    const saldoWrap = $('movSaldoAtual');
    saldoWrap.innerHTML = '<div class="msa-label">Saldo atual por loja</div>';

    LOJAS.forEach(loja => {
        const id = lojaIdPorSlug[loja.slug];
        const qtd = Number(saldosPorLoja[id] || 0);
        if (qtd === 0 && id !== b.loteria_id) return;

        const item = document.createElement('div');
        item.className = 'msa-item' + (id === b.loteria_id ? ' origem' : '');
        item.innerHTML = `<div class="msa-loja">${loja.nome}</div><div class="msa-val">${qtd}</div>`;
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
                <img src="${loja.logo}" alt="${loja.nome}"/>
                ${loja.nome}${ehOrigem ? ' ★' : ''}
            </div>
            <div class="destino-input-wrap">
                <input type="number" class="destino-input" id="dest-${loja.slug}"
                    placeholder="0" min="-999" step="1" ${ehOrigem ? 'disabled' : ''}/>
            </div>
            <div class="destino-hist" id="hist-${loja.slug}" title="Histórico">${ehOrigem ? '(origem)' : histStr}</div>
            <div class="destino-sub" id="sub-${loja.slug}">—</div>
        `;
        grid.appendChild(field);

        const input = $(`dest-${loja.slug}`);
        if (input && !ehOrigem) {
            input.addEventListener('input', () => onDestInput(loja.slug));
        }
    });

    calcTotal();

    $('movPanel').classList.add('open');
    document.body.classList.add('panel-open');
}

function refreshPanelSelecionado() {
    if (!bolaoSelecionado) return;
    abrirPanel(bolaoSelecionado);
}

function fecharPanel() {
    $('movPanel').classList.remove('open');
    document.body.classList.remove('panel-open');
    document.querySelectorAll('.bolao-card').forEach(c => c.classList.remove('selected'));
    bolaoSelecionado = null;
}

function onDestInput(slug) {
    const inp = $(`dest-${slug}`);
    const sub = $(`sub-${slug}`);
    const qtd = parseInt(inp.value, 10) || 0;
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
            $(`sub-${l.slug}`).textContent = '—';
            $(`sub-${l.slug}`).className = 'destino-sub';
        }
    });
    calcTotal();
    if (limparStatus) setStatus('statusBar', '', 'ok');
}

function atualizarSaldosLocaisAposMovimentacao(deltas) {
    if (!bolaoSelecionado) return;
    const origemId = bolaoSelecionado.loteria_id;
    if (saldosPorLoja[origemId] == null) {
        saldosPorLoja[origemId] = 0;
    }
    Object.entries(deltas).forEach(([slug, qtdRaw]) => {
        const qtd = Number(qtdRaw || 0);
        const destId = lojaIdPorSlug[slug];
        if (!destId || qtd === 0) return;
        if (saldosPorLoja[destId] == null) {
            saldosPorLoja[destId] = 0;
        }
        saldosPorLoja[destId] += qtd;
        saldosPorLoja[origemId] -= qtd;
        if (!historicoPorLoja[destId]) historicoPorLoja[destId] = [];
        historicoPorLoja[destId].push(qtd);
        if (!historicoPorLoja[origemId]) historicoPorLoja[origemId] = [];
        historicoPorLoja[origemId].push(-qtd);
    });
    if (saldosPorLoja[origemId] < 0) {
        saldosPorLoja[origemId] = 0;
    }
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
        `📍 Origem: ${b.loterias?.nome || '—'}`,
        `🎯 ${b.modalidade} — Concurso ${b.concurso}`,
        `💰 Cota: ${fmtBRL(b.valor_cota)}`,
        '',
        '📊 CONFERÊNCIA DE MOVIMENTAÇÃO:',
        '(Histórico [Mov] → Final)',
    ];
    const icones = {
        'boulevard': '🏢',
        'centro': '🏙️',
        'lotobel': '🏛️',
        'santa-tereza': '⛪',
        'via-brasil': '🛣️',
    };
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
            linhas.push(`${icones[l.slug] || '📍'} ${l.nome}: ${histStr} ${deltaStr} → ${final}`);
        } else {
            linhas.push(`${icones[l.slug] || '📍'} ${l.nome}: ${histStr} → ${saldo} (sem alteração)`);
        }
    });
    linhas.push('', '⚠️ Confirma a movimentação?');
    $('confirmBody').textContent = linhas.join('\n');
    $('confirmOverlay').classList.add('show');
}

async function doMovimentar(b, deltas) {
    const btn = $('btnMovimentar');
    btn.disabled = true;
    btn.textContent = 'Registrando…';
    setStatus('statusBar', 'Registrando movimentação…', 'info');
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
                criado_por: usuario.id,
            });
        }
        if (!inserts.length) throw new Error('Nenhuma movimentação válida.');
        const { error } = await sb.from('movimentacoes_cotas').insert(inserts);
        if (error) throw new Error(error.message);
        const bolaoIdAtual = bolaoSelecionado?.id;
        atualizarSaldosLocaisAposMovimentacao(deltas);
        refreshPanelSelecionado();
        setStatus('statusBar', '✓ Movimentação registrada com sucesso!', 'ok');
        zerarMov(false);
        await buscarBoloes();
        if (bolaoIdAtual) {
            document.querySelector(`.bolao-card[data-id="${bolaoIdAtual}"]`)?.classList.add('selected');
        }
    } catch (e) {
        setStatus('statusBar', e.message, 'err');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">
                <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
            Movimentar`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init().catch(async (err) => {
        console.error(err);
        try {
            await window.SISLOT_SECURITY.sair();
        } catch (_) {
            location.href = './login.html';
        }
    });
});
