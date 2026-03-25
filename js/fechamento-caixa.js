/**
 * SISLOT - Fechamento de Caixa
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
const setStatus = utils.setStatus || ((id, msg, tipo) => { const el = $(id); if (el) { el.textContent = msg; el.className = `status-chip show ${tipo}`; } });
const hideStatus = utils.hideStatus || (id => { const el = $(id); if (el) el.className = 'status-chip'; });
const updateClock = utils.updateClock || (() => { const el = $('relogio'); if (!el) return; const now = new Date(); el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR'); });
const startClock = utils.startClock || (() => { updateClock(); setInterval(updateClock, 1000); });

// Inicia o relógio
startClock();

const LOJA_CONFIG = {
    'boulevard':    { nome: 'Boulevard',    logo: './icons/boulevard.png',    theme: 'boulevard',    logoPos: '50% 50%' },
    'centro':       { nome: 'Centro',       logo: './icons/loterpraca.png',   theme: 'centro',       logoPos: '50% 42%' },
    'lotobel':      { nome: 'Lotobel',      logo: './icons/lotobel.png',      theme: 'lotobel',      logoPos: '50% 50%' },
    'santa-tereza': { nome: 'Santa Tereza', logo: './icons/santa-tereza.png', theme: 'santa-tereza', logoPos: '50% 50%' },
    'via-brasil':   { nome: 'Via Brasil',   logo: './icons/via-brasil.png',   theme: 'via-brasil',   logoPos: '50% 50%' },
};

let usuario = null;
let loteriaAtiva = null;
let todasLojas = [];
let stepAtual = 1;
let modoAtual = 'novo';
let fechamentoOriginalId = null;

const ESTADO = {
    tela1: {},
    tela2: { produtos: [], federais: [] },
    tela3: { internos: [], externos: [] },
};

let lstInt = [];
let lstExt = [];
let allBoloes = [];
let federais = [];

let produtosLista = [];
let mostrarProdutosSemEstoque = false;

const n = id => parseFloat($(id)?.value) || 0;

function autoFill(el) {
    if (!el) return;
    el.classList.toggle('filled', String(el.value || '').trim() !== '');
}

function blurQ(id) {
    const i = $(id);
    if (i && i.value === '0') i.value = '';
}

function showStatusMsg(id, msg, tipo) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.className = `status-chip show ${tipo}`;
}

function hideStatusMsg(id) {
    const el = $(id);
    if (!el) return;
    el.className = 'status-chip';
}

function aplicarTemaLoja(slug) {
    const cfg = LOJA_CONFIG[slug] || LOJA_CONFIG['centro'];
    document.body.setAttribute('data-loja', slug || 'centro');
    const img = $('logoImg');
    if (img) {
        img.src = cfg.logo;
        img.style.objectPosition = cfg.logoPos || '50% 50%';
    }
    const title = $('headerTitle');
    if (title) title.textContent = cfg.nome;
    const sub = $('headerSub');
    if (sub) sub.textContent = 'Fechamento de Caixa';
}

function bindHeaderActions() {
    $('lojaTreeWrap')?.addEventListener('click', async () => {
        await trocarLoteria();
    });
    $('btnInicio')?.addEventListener('click', () => confirmarInicio());
    $('btnSair')?.addEventListener('click', () => confirmarSair());
}

function bindStepClicks() {
    for (let i = 1; i <= 4; i++) {
        const el = $('s' + i);
        if (!el) continue;
        el.style.cursor = 'pointer';
        el.addEventListener('click', async () => {
            if (i === stepAtual) return;
            if (i < stepAtual) {
                if (i === 4) montarResumo();
                showStep(i);
                return;
            }
            await avancarStep(i);
        });
    }
}

async function init() {
    try {
        const ctx = await window.SISLOT_SECURITY.protegerPagina('fechamento');
        if (!ctx) return;

        usuario = ctx.usuario;

        todasLojas = (ctx.lojasPermitidas || []).map(l => ({
            id: l.loteria_id,
            nome: l.loteria_nome,
            slug: l.loteria_slug,
            codigo: l.loteria_codigo,
            cod_loterico: l.cod_loterico || '',
            principal: !!l.principal,
            papelNaLoja: l.papel_na_loja || ''
        }));

        if (!todasLojas.length) {
            alert('Nenhuma loteria vinculada a este usuário.');
            return;
        }

        const inicial = ctx.lojaInicial
            ? {
                id: ctx.lojaInicial.loteria_id,
                nome: ctx.lojaInicial.loteria_nome,
                slug: ctx.lojaInicial.loteria_slug,
                codigo: ctx.lojaInicial.loteria_codigo,
                cod_loterico: ctx.lojaInicial.cod_loterico || '',
                principal: !!ctx.lojaInicial.principal,
                papelNaLoja: ctx.lojaInicial.papel_na_loja || ''
            }
            : todasLojas[0];

        await definirLoteriaAtiva(inicial);

        $('data-ref').value = new Date().toISOString().slice(0, 10);

        await carregarProdutos();
        buildRaspadinha();

        $('prod-filtro-tipo')?.addEventListener('change', carregarProdutos);
        $('toggle-produtos-todos')?.addEventListener('change', (e) => {
            mostrarProdutosSemEstoque = !!e.target.checked;
            renderProdutos();
        });

        bindHeaderActions();
        bindStepClicks();
        renderDivCount();

        setFS('fs-inicial');
        setB3('b3-inicial');
    } catch (e) {
        console.error(e);
        alert('Erro ao iniciar: ' + (e.message || e));
    }
}

async function definirLoteriaAtiva(loja) {
    loteriaAtiva = loja;
    window.loteriaAtiva = loteriaAtiva;
    aplicarTemaLoja(loja?.slug);
    await carregarFuncionarios();
}

async function trocarLoteria(slugOuId = null) {
    let loja = null;
    if (typeof slugOuId === 'string') {
        loja = todasLojas.find(l => l.slug === slugOuId) || null;
    } else if (typeof slugOuId === 'number') {
        loja = todasLojas.find(l => Number(l.id) === Number(slugOuId)) || null;
    }
    if (!loja) {
        const atual = todasLojas.findIndex(l => Number(l.id) === Number(loteriaAtiva?.id));
        if (atual < 0) return;
        let prox = atual + 1;
        if (prox >= todasLojas.length) prox = 0;
        loja = todasLojas[prox];
    }
    if (!loja) return;
    resetEstado();
    await definirLoteriaAtiva(loja);
    if (stepAtual > 1) showStep(1);
}

async function carregarFuncionarios() {
    const sel = $('funcionario');
    sel.innerHTML = '<option value="">Carregando...</option>';
    try {
        const { data, error } = await sb
            .from('usuarios_loterias')
            .select(`
                usuario_id,
                ativo,
                usuarios(id, nome, perfil, ativo, pode_logar)
            `)
            .eq('loteria_id', loteriaAtiva.id)
            .eq('ativo', true);
        if (error) throw error;
        const listaBruta = (data || []).flatMap(r => {
            if (!r.usuarios) return [];
            return Array.isArray(r.usuarios) ? r.usuarios : [r.usuarios];
        });
        const lista = listaBruta
            .filter(u => u && u.ativo && u.pode_logar)
            .filter((u, i, arr) => arr.findIndex(x => Number(x.id) === Number(u.id)) === i)
            .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
        sel.innerHTML = '<option value="">Selecione...</option>';
        if (FECHAMENTO_RULES.podeSelecionarFuncionario(usuario)) {
            lista.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.nome;
                sel.appendChild(opt);
            });
            sel.disabled = false;
            sel.value = '';
            sel.classList.remove('filled');
            if (!lista.length) {
                showStatusMsg('status-busca', 'Nenhum funcionário ativo encontrado para esta loteria.', 'err');
            } else {
                hideStatusMsg('status-busca');
            }
            return;
        }
        const opt = document.createElement('option');
        opt.value = usuario.id;
        opt.textContent = usuario.nome;
        sel.appendChild(opt);
        sel.value = String(usuario.id);
        sel.disabled = true;
        sel.classList.add('filled');
        hideStatusMsg('status-busca');
    } catch (e) {
        console.error('Erro ao carregar funcionários:', e);
        sel.innerHTML = '<option value="">Erro ao carregar</option>';
        showStatusMsg('status-busca', 'Erro ao carregar funcionários: ' + e.message, 'err');
    }
}

function onFuncChange() {
    const sel = $('funcionario');
    sel.classList.toggle('filled', !!sel.value);
}

function showStep(n) {
    stepAtual = n;
    document.querySelectorAll('.step-content').forEach((el, i) => {
        el.classList.toggle('active', i + 1 === n);
    });
    for (let i = 1; i <= 4; i++) {
        const s = $('s' + i);
        const l = $('l' + i);
        if (i < n) {
            s.className = 'step done';
            s.querySelector('.step-circle').textContent = '✓';
        } else if (i === n) {
            s.className = 'step active';
            s.querySelector('.step-circle').textContent = i;
        } else {
            s.className = 'step wait';
            s.querySelector('.step-circle').textContent = i;
        }
        if (l) l.classList.toggle('done', i < n);
    }
    window.scrollTo(0, 0);
}

async function avancarStep(para) {
    try {
        if (para > stepAtual) {
            if (stepAtual === 1) {
                if (!validarStep1()) return;
                coletarTela1();
            }
            if (stepAtual === 2) coletarTela2();
            if (stepAtual === 3) coletarTela3();
        }
        showStep(para);
        if (para === 2) {
            const dataRef = $('data-ref').value;
            if (dataRef) {
                buscarFederaisSupabase(dataRef);
            }
        }
        if (para === 3) {
            carregarBoloes();
        }
        if (para === 4) {
            montarResumo();
        }
    } catch (e) {
        console.error('Erro ao avançar de tela:', e);
        alert('Erro ao avançar de tela:\n\n' + (e.message || e));
    }
}

function validarStep1() {
    const reqs = [
        'funcionario',
        'data-ref',
        'relatorio',
        'deposito',
        'troco-ini',
        'troco-sob',
        'pix-cnpj',
        'pix-dif',
        'premio-rasp',
        'resgate-tele'
    ];
    let ok = true;
    reqs.forEach(id => {
        const el = $(id);
        if (!String(el?.value || '').trim()) {
            ok = false;
            el?.classList.add('has-error');
        } else {
            el?.classList.remove('has-error');
        }
    });
    if (!ok) {
        document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return ok;
}

let dividaCount = 0;
const MAX_DIV = 9;

function renderDivCount() {
    $('div-counter').textContent = `${dividaCount} / ${MAX_DIV} clientes`;
    $('btn-add-div').disabled = dividaCount >= MAX_DIV;
}

function calcDivTotal() {
    let t = 0;
    document.querySelectorAll('.div-valor').forEach(i => {
        t += parseFloat(i.value) || 0;
    });
    const chip = $('div-total-chip');
    if (dividaCount > 0) {
        chip.textContent = `Total dívidas: R$ ${t.toFixed(2).replace('.', ',')}`;
        chip.style.opacity = '1';
    } else {
        chip.style.opacity = '0';
    }
}

function addDivida(nome = '', valor = '') {
    if (dividaCount >= MAX_DIV) return;
    dividaCount++;
    const list = $('dividas-list');
    const idx = dividaCount;
    const row = document.createElement('div');
    row.className = 'divida-row';
    row.innerHTML = `
        <div>
            <div class="divida-num">CLIENTE ${String(idx).padStart(2, '0')}</div>
            <input type="text" class="div-nome" placeholder="Nome do cliente" value="${nome}" oninput="autoFill(this)">
        </div>
        <div class="pfx-wrap">
            <span class="pfx">R$</span>
            <input type="number" class="div-valor" placeholder="0,00" step="0.01" value="${valor}" oninput="calcDivTotal()" style="padding-left:32px">
        </div>
        <button type="button" class="btn-rm" onclick="remDivida(this)" title="Remover">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
        </button>
    `;
    list.appendChild(row);
    renderDivCount();
    calcDivTotal();
    row.querySelector('.div-nome')?.focus();
}

function remDivida(btn) {
    const row = btn.closest('.divida-row');
    if (!row) return;
    row.style.opacity = '0';
    row.style.transform = 'translateX(10px)';
    row.style.transition = 'all .2s';
    setTimeout(() => {
        row.remove();
        dividaCount--;
        document.querySelectorAll('.divida-num').forEach((el, i) => {
            el.textContent = `CLIENTE ${String(i + 1).padStart(2, '0')}`;
        });
        renderDivCount();
        calcDivTotal();
    }, 200);
}

// ─── PRODUTOS ────────────────────────────────────────────────────────────────

async function carregarProdutos() {
    const tipo = $('prod-filtro-tipo')?.value || '';

    let query = sb
        .from('view_produtos_saldo_loja')
        .select(`
            loteria_id,
            produto,
            campanha_nome,
            item_nome,
            raspadinha_id,
            telesena_item_id,
            valor_venda,
            saldo_atual
        `)
        .eq('loteria_id', loteriaAtiva.id)
        .order('produto')
        .order('item_nome');

    if (tipo) query = query.eq('produto', tipo);

    const { data, error } = await query;

    if (error) {
        console.error('Erro ao carregar produtos:', error);
        produtosLista = [];
        renderProdutos();
        return;
    }

    produtosLista = data || [];
    renderProdutos();
}

function produtosVisiveis() {
    let lista = [...produtosLista];

    if (!mostrarProdutosSemEstoque) {
        lista = lista.filter(p => Number(p.saldo_atual || 0) > 0);
    }

    lista.sort((a, b) => {
        const sa = Number(a.saldo_atual || 0);
        const sb = Number(b.saldo_atual || 0);
        if ((sb > 0) !== (sa > 0)) return (sb > 0) - (sa > 0);
        if (String(a.produto || '') !== String(b.produto || '')) {
            return String(a.produto || '').localeCompare(String(b.produto || ''));
        }
        return String(a.item_nome || '').localeCompare(String(b.item_nome || ''));
    });

    return lista;
}

function buildProdutoCard(item) {
    const saldo = Number(item.saldo_atual || 0);
    const semEstoque = saldo <= 0;
    const estoqueBaixo = saldo > 0 && saldo <= 5;
    const badge = semEstoque ? 'Sem estoque' : estoqueBaixo ? 'Baixo' : 'Disponível';
    const badgeClass = semEstoque ? 'badge-r' : estoqueBaixo ? 'badge-t' : 'badge';

    const idItem = item.raspadinha_id || item.telesena_item_id;
    const nome = item.item_nome || 'Sem nome';
    const tipo = item.produto === 'RASPADINHA' ? 'Raspadinha' : 'Tele Sena';

    return `
        <div class="prod-card ${semEstoque ? 'is-off' : ''}" data-produto="${item.produto}" data-item-id="${idItem}">
            <div class="prod-head">
                <div>
                    <div class="prod-nome">${nome}</div>
                    <div style="font-size:10px;color:var(--muted);margin-top:2px">${tipo}</div>
                </div>
                <span class="badge ${badgeClass}">${badge}</span>
            </div>

            <div class="g2" style="margin-bottom:10px">
                <div>
                    <label style="font-size:10px;color:var(--muted);letter-spacing:.07em;text-transform:uppercase;display:block;margin-bottom:5px">Valor</label>
                    <div style="font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;color:var(--accent)">
                        ${fmtBRL(item.valor_venda || 0)}
                    </div>
                </div>
                <div>
                    <label style="font-size:10px;color:var(--muted);letter-spacing:.07em;text-transform:uppercase;display:block;margin-bottom:5px">Estoque</label>
                    <div style="font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;color:${semEstoque ? 'var(--err)' : 'var(--text)'}">
                        ${saldo}
                    </div>
                </div>
            </div>

            <div class="qtd-wrap">
                <button type="button" class="btn-q" onclick="ajProduto('${item.produto}', '${idItem}', -1)" ${semEstoque ? 'disabled' : ''}>−</button>
                <input
                    type="number"
                    class="inp-qtd"
                    id="prod-qtd-${item.produto}-${idItem}"
                    placeholder="0"
                    min="0"
                    max="${Math.max(0, saldo)}"
                    oninput="recalcProdutos()"
                    onblur="blurQ('prod-qtd-${item.produto}-${idItem}')"
                    ${semEstoque ? 'disabled' : ''}>
                <button type="button" class="btn-q" onclick="ajProduto('${item.produto}', '${idItem}', 1)" ${semEstoque ? 'disabled' : ''}>+</button>
            </div>

            <div class="prod-footer">
                <span class="prod-tot-lbl">Subtotal</span>
                <span class="prod-tot-val" id="prod-sub-${item.produto}-${idItem}">R$ 0,00</span>
            </div>
        </div>
    `;
}

function renderProdutos() {
    const wrap = $('produtos-grid');
    if (!wrap) return;

    const lista = produtosVisiveis();

    if (!lista.length) {
        wrap.innerHTML = `
            <div class="state-box" style="grid-column:1/-1">
                <div class="state-title">Nenhum produto disponível</div>
                <div class="state-sub">Altere o filtro ou marque "Mostrar sem estoque".</div>
            </div>`;
        const totalEl = $('produtos-tot');
        if (totalEl) totalEl.textContent = 'R$ 0,00';
        const t2Rasp = $('t2-rasp');
        if (t2Rasp) t2Rasp.textContent = 'R$ 0,00';
        updT2Geral();
        return;
    }

    wrap.innerHTML = lista.map(buildProdutoCard).join('');
    recalcProdutos();
}

function ajProduto(produto, idItem, delta) {
    const el = $(`prod-qtd-${produto}-${idItem}`);
    if (!el || el.disabled) return;

    const atual = Number(el.value || 0);
    const max = Number(el.max || 999999);
    const novo = Math.max(0, Math.min(max, atual + delta));
    el.value = novo || '';
    recalcProdutos();
    el.focus();
}

function recalcProdutos() {
    let total = 0;

    produtosLista.forEach(item => {
        const idItem = item.raspadinha_id || item.telesena_item_id;
        const elQtd = $(`prod-qtd-${item.produto}-${idItem}`);
        const elSub = $(`prod-sub-${item.produto}-${idItem}`);
        if (!elQtd || !elSub) return;

        const saldo = Number(item.saldo_atual || 0);
        let qtd = Number(elQtd.value || 0);

        if (qtd > saldo) {
            qtd = saldo;
            elQtd.value = saldo || '';
        }

        const subtotal = qtd * Number(item.valor_venda || 0);
        elSub.textContent = fmtBRL(subtotal);
        elSub.classList.toggle('on', subtotal > 0);
        elQtd.classList.toggle('filled', qtd > 0);

        // FIX: ativa destaque visual no card quando há quantidade
        const card = elQtd.closest('.prod-card');
        if (card) card.classList.toggle('has-val', qtd > 0);

        total += subtotal;
    });

    const totalEl = $('produtos-tot');
    if (totalEl) totalEl.textContent = fmtBRL(total);

    const t2Rasp = $('t2-rasp');
    if (t2Rasp) t2Rasp.textContent = fmtBRL(total);

    updT2Geral();
}

function buildRaspadinha() {
    renderProdutos();
}

// Stubs de compatibilidade (modelo antigo removido)
function ajR() {}
function recalcR() {}
function updRaspTot() { recalcProdutos(); }
function ajTele() {}
function recalcTele() { recalcProdutos(); }

function getRaspTot() {
    let t = 0;
    produtosLista.forEach(item => {
        const idItem = item.raspadinha_id || item.telesena_item_id;
        const qtd = Number($(`prod-qtd-${item.produto}-${idItem}`)?.value || 0);
        t += qtd * Number(item.valor_venda || 0);
    });
    return t;
}

function getTeleTot() {
    return 0;
}

function getFedTot() {
    let t = 0;
    federais.forEach((f, i) => {
        t += (parseInt($(`fed-qtd-${i}`)?.value) || 0) * Number(f.valorUnit || 0);
    });
    return t;
}

function updT2Geral() {
    const g = getRaspTot() + getTeleTot() + getFedTot();
    const el = $('t2-geral');
    if (el) el.textContent = fmtBRL(g);
    const fed = $('t2-fed');
    if (fed) fed.textContent = fmtBRL(getFedTot());
}

// ─── BUSCA DE FECHAMENTO EXISTENTE ───────────────────────────────────────────

async function buscarFechamentoExistente() {
    const funcionarioId = parseInt($('funcionario').value, 10);
    const dataRef = $('data-ref').value;
    if (!funcionarioId || !dataRef) {
        toast('Selecione funcionário e data.', false);
        return;
    }

    try {
        setSaveLoading(true, 'Buscando fechamento...');
        const { data: fech, error } = await sb
            .from('fechamentos')
            .select(`
                *,
                fechamento_produtos(*),
                fechamento_boloes(*),
                fechamento_dividas(*)
            `)
            .eq('loteria_id', loteriaAtiva.id)
            .eq('usuario_id', funcionarioId)
            .eq('data_ref', dataRef)
            .maybeSingle();

        if (error) throw error;

        if (!fech) {
            toast('Nenhum fechamento encontrado para este funcionário/data.', false);
            return;
        }

        const federaisCarregados = await carregarFederaisDoFechamento(fech.id);
        console.log('fechamento_dividas carregadas:', fech.fechamento_dividas);

        fechamentoOriginalId = fech.id;

        ESTADO.tela1 = montarTela1DoFechamento(fech);
        ESTADO.tela2 = montarTela2DoFechamento(fech, federaisCarregados);
        ESTADO.tela3 = montarTela3DoFechamento(fech);

        preencherTela1(fech);
        preencherTela2();

        await buscarFederaisSupabase(fech.data_ref);
        restaurarFederais();

        toast('Fechamento carregado com sucesso.', true);
    } catch (e) {
        console.error('Erro ao buscar fechamento:', e);
        toast(e.message || 'Erro ao buscar fechamento.', false);
    } finally {
        setSaveLoading(false);
    }
}

function setSaveLoading(loading, text = '') {
    const btn = document.querySelector('[onclick="buscarFechamentoExistente()"]');
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn.dataset.oldText = btn.textContent;
        btn.textContent = text || 'Carregando...';
    } else {
        btn.disabled = false;
        btn.textContent = btn.dataset.oldText || 'Buscar Fechamento';
    }
}

// ─── MONTAR / PREENCHER TELAS ─────────────────────────────────────────────────

function montarTela1DoFechamento(fech) {
    return {
        funcionario_id: fech.usuario_id || '',
        data_ref: fech.data_ref || '',
        relatorio: Number(fech.relatorio || 0),
        deposito: Number(fech.deposito || 0),
        troco_inicial: Number(fech.troco_inicial || 0),
        troco_sobra: Number(fech.troco_sobra || 0),
        pix_cnpj: Number(fech.pix_cnpj || 0),
        diferenca_pix: Number(fech.diferenca_pix || 0),
        premio_raspadinha: Number(fech.premio_raspadinha || 0),
        resgate_telesena: Number(fech.resgate_telesena || 0),
        dividas: (fech.fechamento_dividas || []).map(d => ({
            id: d.id,
            cliente_nome: d.cliente_nome || '',
            valor: Number(d.valor || 0)
        }))
    };
}

function montarTela2DoFechamento(fech, federaisCarregados = []) {
  const produtos = (fech.fechamento_produtos || []).map(p => ({
    produto_id: p.produto_id || null,
    produto: String(p.tipo || '').toUpperCase(),
    descricao: p.descricao || '',
    preco: Number(p.valor_unitario || 0),
    qtd: Number(p.qtd_vendida || 0),
    sub: Number(p.total || 0)
  }));

  return {
    produtos,
    federais: federaisCarregados
  };

function montarTela3DoFechamento(fech) {
    const internos = [];
    const externos = [];

    (fech.fechamento_boloes || []).forEach(b => {
        const item = {
            bolao_id: b.bolao_id,
            modalidade: b.modalidade,
            concurso: b.concurso,
            valorCota: b.valor_cota,
            qtdVendida: b.qtd_vendida,
            total: b.total || b.subtotal || 0,
            origem: b.origem || null,
            tipo: b.tipo || null
        };
        if (b.tipo === 'EXTERNO' || b.origem) {
            externos.push(item);
        } else {
            internos.push(item);
        }
    });

    return { internos, externos };
}

function preencherTela1(fech) {
    const set = (id, v) => {
        const el = $(id);
        if (!el) return;
        el.value = v !== null && v !== undefined ? Number(v).toFixed(2) : '';
        el.classList.toggle('filled', !!el.value && el.value !== '0.00');
    };
    $('funcionario').value = fech.usuario_id || '';
    $('data-ref').value = fech.data_ref || '';
    autoFill($('funcionario'));
    autoFill($('data-ref'));
    set('relatorio', fech.relatorio);
    set('deposito', fech.deposito);
    set('troco-ini', fech.troco_inicial);
    set('troco-sob', fech.troco_sobra);
    set('pix-cnpj', fech.pix_cnpj);
    set('pix-dif', fech.diferenca_pix);
    set('premio-rasp', fech.premio_raspadinha);
    set('resgate-tele', fech.resgate_telesena);
    $('dividas-list').innerHTML = '';
    dividaCount = 0;
    (fech.fechamento_dividas || []).forEach(d => addDivida(d.cliente_nome, d.valor));
}

function preencherTela2() {
    const t2 = ESTADO.tela2 || {};
    const produtos = t2.produtos || [];

    const mapa = {};
    produtos.forEach(p => {
        const key = `${p.produto}|${p.raspadinha_id || ''}|${p.telesena_item_id || ''}`;
        mapa[key] = Number(p.qtd || 0);
    });

    produtosLista.forEach(item => {
        const key = `${item.produto}|${item.raspadinha_id || ''}|${item.telesena_item_id || ''}`;
        const idItem = item.raspadinha_id || item.telesena_item_id;
        const inpQtd = $(`prod-qtd-${item.produto}-${idItem}`);
        if (inpQtd) {
            inpQtd.value = (mapa[key] || 0) > 0 ? mapa[key] : '';
        }
    });

    recalcProdutos();
    updT2Geral();
}

// ─── COLETA DE DADOS ──────────────────────────────────────────────────────────

function coletarTela1() {
    const dividas = [];
    document.querySelectorAll('.divida-row').forEach(row => {
        const nome = row.querySelector('.div-nome')?.value?.trim();
        const valor = parseFloat(row.querySelector('.div-valor')?.value) || 0;
        if (nome) dividas.push({ nome, valor });
    });
    ESTADO.tela1 = {
        funcionario_id: $('funcionario').value,
        funcionario_nome: $('funcionario').options[$('funcionario').selectedIndex]?.text || '',
        data_ref: $('data-ref').value,
        relatorio: n('relatorio'),
        deposito: n('deposito'),
        troco_inicial: n('troco-ini'),
        troco_sobra: n('troco-sob'),
        pix_cnpj: n('pix-cnpj'),
        diferenca_pix: n('pix-dif'),
        premio_raspadinha: n('premio-rasp'),
        resgate_telesena: n('resgate-tele'),
        dividas
    };
}

function coletarTela2() {
    const produtos = produtosLista.map(item => {
        const idItem = item.raspadinha_id || item.telesena_item_id;
        const qtd = parseInt($(`prod-qtd-${item.produto}-${idItem}`)?.value) || 0;
        return {
            produto_id: null,
            produto: item.produto,
            descricao: item.item_nome || '',
            preco: Number(item.valor_venda || 0),
            qtd,
            sub: qtd * Number(item.valor_venda || 0),
            raspadinha_id: item.raspadinha_id || null,
            telesena_item_id: item.telesena_item_id || null
        };
    });

    const feds = federais.map((f, i) => {
        const qtdVendida = parseInt($(`fed-qtd-${i}`)?.value) || 0;
        return {
            federal_id: f.federal_id,
            modalidade: f.modalidade,
            concurso: f.concurso,
            dtSorteio: f.dtSorteio,
            valorUnit: Number(f.valorUnit || 0),
            valorCusto: Number(f.valorCusto || 0),
            qtdVendida,
            subtotal: qtdVendida * Number(f.valorUnit || 0)
        };
    });

    ESTADO.tela2 = { produtos, federais: feds };
}

function coletarTela3() {
    const coleta = tipo => allBoloes
        .filter(b => b.tipo === tipo)
        .map(({ data, idx }) => ({
            bolao_id: data.bolao_id,
            modalidade: data.modalidade,
            valorCota: Number(data.valorCota || 0),
            qtdVendida: parseInt($(`qtd-${idx}`)?.value) || 0,
            subtotal: (parseInt($(`qtd-${idx}`)?.value) || 0) * Number(data.valorCota || 0)
        }));
    ESTADO.tela3 = {
        internos: coleta('INTERNO'),
        externos: coleta('EXTERNO')
    };
}

// ─── FEDERAIS ─────────────────────────────────────────────────────────────────

async function buscarFederais() {
    const dataRef = $('data-ref').value;
    if (!dataRef) {
        alert('Defina a data do fechamento antes de buscar federais.');
        return;
    }
    await buscarFederaisSupabase(dataRef);
}

async function buscarFederaisSupabase(dataRef) {
    try {
        setFS('fs-loading');
        $('fs-load-sub').textContent = 'Consultando federais disponíveis para esta loja...';

        const { data, error } = await sb
            .from('view_resumo_federal')
            .select(`
                federal_id,
                loteria_id,
                loja_origem,
                modalidade,
                concurso,
                dt_sorteio,
                valor_fracao,
                valor_custo,
                qtd_inicial,
                qtd_vendida_funcionarios,
                qtd_vendida_whatsapp,
                qtd_vendida_caixa,
                qtd_vendida_cambista_interno,
                qtd_venda_interna_total,
                estoque_atual,
                resultado
            `)
            .eq('loteria_id', loteriaAtiva.id)
            .gte('dt_sorteio', dataRef)
            .gt('estoque_atual', 0)
            .order('dt_sorteio', { ascending: true })
            .order('concurso', { ascending: true });

        if (error) throw error;

        if (!data || !data.length) {
            federais = [];
            renderFed();
            setFS('fs-vazio');
            return;
        }

        federais = data.map(f => ({
            federal_id: f.federal_id,
            loteriaId: Number(f.loteria_id),
            lojaOrigem: f.loja_origem,
            modalidade: f.modalidade,
            concurso: f.concurso,
            dtSorteio: f.dt_sorteio,
            valorUnit: Number(f.valor_fracao || 0),
            valorCusto: Number(f.valor_custo || 0),
            qtdInicial: Number(f.qtd_inicial || 0),
            qtdVendidaFuncionarios: Number(f.qtd_vendida_funcionarios || 0),
            qtdVendidaWhatsapp: Number(f.qtd_vendida_whatsapp || 0),
            qtdVendidaCaixa: Number(f.qtd_vendida_caixa || 0),
            qtdVendidaCambista: Number(f.qtd_vendida_cambista_interno || 0),
            qtdVendaInternaTotal: Number(f.qtd_venda_interna_total || 0),
            saldo: Number(f.estoque_atual || 0),
            resultado: Number(f.resultado || 0)
        }));

        renderFed();
        setFS('fs-lista');

        if (ESTADO.tela2?.federais?.length) {
            restaurarFederais();
        }
    } catch (e) {
        console.error('Erro ao buscar federais:', e);
        federais = [];
        setFS('fs-erro');
        $('fs-err-msg').textContent = e.message || 'Erro ao buscar federais.';
    }
}

function renderFed() {
    const tb = $('fed-tbody');
    tb.innerHTML = '';
    $('fed-count').textContent = federais.length;

    federais.forEach((f, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="mono">${f.modalidade}</td>
            <td class="mono" style="color:var(--purple);font-weight:600">${f.concurso}</td>
            <td class="mono" style="color:var(--amber)">${fmtData(f.dtSorteio)}</td>
            <td class="mono" style="color:var(--accent)">R$ ${Number(f.valorUnit).toFixed(2).replace('.', ',')}</td>
            <td class="mono" style="text-align:center;color:var(--sky)">${f.saldo}</td>
            <td>
                <div class="qtd-wrap" style="justify-content:center">
                    <button type="button" class="btn-q" style="border-color:rgba(167,139,250,.3)" onclick="ajFed(${i},-1)">−</button>
                    <input type="number" class="inp-fed" id="fed-qtd-${i}" min="0" max="${f.saldo}" placeholder="0" oninput="onFed(${i})" onblur="blurQ('fed-qtd-${i}')">
                    <button type="button" class="btn-q" style="border-color:rgba(167,139,250,.3)" onclick="ajFed(${i},+1)">+</button>
                </div>
                <div class="fed-sub" id="fed-sub-${i}">—</div>
            </td>
        `;
        tb.appendChild(tr);
    });

    const headers = document.querySelectorAll('.fed-table thead th');
    if (headers[4]) headers[4].textContent = 'Saldo';

    $('fed-tot-lbl').textContent = fmtBRL(getFedTot());
    updT2Geral();
}

function ajFed(i, d) {
    const inp = $(`fed-qtd-${i}`);
    const max = federais[i]?.saldo || 999;
    inp.value = Math.min(max, Math.max(0, (parseInt(inp.value) || 0) + d)) || '';
    onFed(i);
    inp.focus();
}

function onFed(i) {
    const inp = $(`fed-qtd-${i}`);
    const sub = $(`fed-sub-${i}`);
    const qtd = parseInt(inp.value) || 0;
    const f = federais[i];
    if (qtd > 0) {
        sub.textContent = 'R$ ' + (qtd * Number(f.valorUnit || 0)).toFixed(2).replace('.', ',');
        sub.classList.add('on');
        inp.classList.add('filled');
        inp.closest('tr')?.classList.add('hv');
    } else {
        sub.textContent = '—';
        sub.classList.remove('on');
        inp.classList.remove('filled');
        inp.closest('tr')?.classList.remove('hv');
    }
    $('fed-tot-lbl').textContent = fmtBRL(getFedTot());
    updT2Geral();
}

function restaurarFederais() {
    const mapa = {};
    ESTADO.tela2.federais.forEach(f => {
        if (f.qtdVendida > 0) mapa[f.federal_id || f.concurso] = f.qtdVendida;
    });
    federais.forEach((f, i) => {
        const qtd = mapa[f.federal_id || f.concurso];
        if (!qtd) return;
        const inp = $(`fed-qtd-${i}`);
        if (inp) {
            inp.value = qtd;
            onFed(i);
        }
    });
}

async function carregarFederaisDoFechamento(fechId) {
    const { data, error } = await sb
        .from('federal_vendas')
        .select(`
            federal_id,
            qtd_vendida,
            valor_unitario,
            desconto,
            valor_liquido
        `)
        .eq('fechamento_id', fechId)
        .eq('canal', 'FECHAMENTO');

    if (error) throw error;

    return (data || []).map(f => ({
        federal_id: f.federal_id,
        valorUnit: Number(f.valor_unitario || 0),
        qtdVendida: Number(f.qtd_vendida || 0),
        subtotal: Number(f.valor_liquido || 0),
        desconto: Number(f.desconto || 0)
    }));
}

// ─── ESTADO FS / B3 ───────────────────────────────────────────────────────────

function setFS(s) {
    ['fs-inicial', 'fs-loading', 'fs-erro', 'fs-vazio', 'fs-lista'].forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
    });
    const alvo = $(s);
    if (alvo) alvo.style.display = s === 'fs-lista' ? 'block' : 'flex';
}

function setB3(s) {
    ['b3-inicial', 'b3-loading', 'b3-erro', 'b3-vazio', 'b3-lista'].forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
    });
    const alvo = $(s);
    if (alvo) alvo.style.display = s === 'b3-lista' ? 'block' : 'flex';
}

// ─── BOLÕES ───────────────────────────────────────────────────────────────────

async function carregarBoloes() {
    const dataRef = $('data-ref').value;
    if (!dataRef) return;
    setB3('b3-loading');
    try {
        const { data: boloesInt, error: errInt } = await sb
            .from('boloes')
            .select(`
                id,
                modalidade,
                concurso,
                valor_cota,
                qtd_cotas_total,
                qtd_jogos,
                qtd_dezenas,
                dt_inicial,
                dt_concurso,
                status,
                loteria_id
            `)
            .eq('loteria_id', loteriaAtiva.id)
            .eq('status', 'ATIVO')
            .lte('dt_inicial', dataRef)
            .gte('dt_concurso', dataRef);
        if (errInt) throw errInt;

        const { data: movsExt, error: errExt } = await sb
            .from('movimentacoes_cotas')
            .select(`
                bolao_id,
                qtd_cotas,
                status,
                loteria_destino,
                boloes(
                    id,
                    loteria_id,
                    modalidade,
                    concurso,
                    valor_cota,
                    qtd_jogos,
                    qtd_dezenas,
                    dt_inicial,
                    dt_concurso,
                    status,
                    loterias(nome, cod_loterico)
                )
            `)
            .eq('loteria_destino', loteriaAtiva.id)
            .eq('status', 'ATIVO');
        if (errExt) throw errExt;

        const mapaExt = {};
        (movsExt || []).forEach(m => {
            const b = Array.isArray(m.boloes) ? m.boloes[0] : m.boloes;
            if (!b || b.status !== 'ATIVO') return;
            if (b.dt_inicial > dataRef || b.dt_concurso < dataRef) return;
            if (!mapaExt[m.bolao_id]) {
                mapaExt[m.bolao_id] = { bolao: b, qtdCotas: 0 };
            }
            mapaExt[m.bolao_id].qtdCotas += Number(m.qtd_cotas || 0);
        });

        lstInt = (boloesInt || []).map(b => ({
            bolao_id: b.id,
            modalidade: b.modalidade,
            concurso: b.concurso,
            qtdJogos: b.qtd_jogos,
            qtdDezenas: b.qtd_dezenas,
            valorCota: Number(b.valor_cota || 0),
            dtInicial: b.dt_inicial,
            dtConcurso: b.dt_concurso,
            saldoEnviado: null,
            origem: loteriaAtiva.nome,
            tipo: 'INTERNO'
        }));

        lstExt = Object.values(mapaExt).map(({ bolao: b, qtdCotas }) => ({
            bolao_id: b.id,
            modalidade: b.modalidade,
            concurso: b.concurso,
            qtdJogos: b.qtd_jogos,
            qtdDezenas: b.qtd_dezenas,
            valorCota: Number(b.valor_cota || 0),
            dtInicial: b.dt_inicial,
            dtConcurso: b.dt_concurso,
            saldoEnviado: qtdCotas,
            origem: b.loterias?.nome || '',
            origemCodLoterico: b.loterias?.cod_loterico || '',
            tipo: 'EXTERNO'
        }));

        const total = lstInt.length + lstExt.length;
        if (!total) {
            allBoloes = [];
            renderBoloes();
            setB3('b3-vazio');
            return;
        }
        renderBoloes();
        setB3('b3-lista');
        if (ESTADO.tela3.internos?.length || ESTADO.tela3.externos?.length) {
            restaurarBoloes();
        }
    } catch (e) {
        console.error(e);
        $('b3-err-msg').textContent = e.message;
        setB3('b3-erro');
    }
}

function renderBoloes() {
    const wrap = $('boloes-wrap');
    wrap.innerHTML = '';
    allBoloes = [];
    const todos = [
        ...lstInt.map(b => ({ ...b, tipo: 'INTERNO' })),
        ...lstExt.map(b => ({ ...b, tipo: 'EXTERNO' }))
    ];
    const especiais = ordenarBoloesFechamento(
        todos.filter(b => isModalidadeEspecial(b.modalidade))
    );
    const regulares = ordenarBoloesFechamento(
        todos.filter(b => !isModalidadeEspecial(b.modalidade))
    );

    const agruparPorModalidade = lista => {
        const mapa = {};
        lista.forEach(b => {
            const mod = b.modalidade || 'SEM MODALIDADE';
            if (!mapa[mod]) mapa[mod] = [];
            mapa[mod].push(b);
        });
        return mapa;
    };

    const renderGrupoModalidade = (tituloBloco, lista, blocoEspecial = false) => {
        if (!lista.length) return;
        const bloco = document.createElement('div');
        bloco.style.marginBottom = '26px';
        bloco.innerHTML = `
            <div class="bloco-sep ${blocoEspecial ? 'b-ext' : 'b-int'}">
                <div class="bloco-label">${tituloBloco}</div>
                <div class="bloco-line"></div>
                <div class="bloco-tot" id="bloco-tot-${tituloBloco.replace(/\s+/g, '-').toLowerCase()}">R$ 0,00</div>
            </div>
        `;
        wrap.appendChild(bloco);
        const grupos = agruparPorModalidade(lista);
        Object.entries(grupos).forEach(([mod, boloes]) => {
            const grp = document.createElement('div');
            grp.className = 'mod-group';
            const modKey = `${tituloBloco}-${mod}`.replace(/\s/g, '_');
            grp.innerHTML = `
                <div class="mod-header ${blocoEspecial ? 'ec' : 'ic'}">
                    <div class="mod-dot"></div>
                    <div class="mod-nome">${mod}</div>
                    <div class="mod-count">${boloes.length}</div>
                    <div class="mod-subtot" id="mod-tot-${modKey}">R$ 0,00</div>
                </div>
            `;
            boloes.forEach((b, i) => {
                const gi = allBoloes.length;
                allBoloes.push({ tipo: b.tipo, data: b, idx: gi, grupo: tituloBloco, modalidade: mod });
                const metas = [];
                if (b.qtdJogos) metas.push(`<span class="meta-tag">${b.qtdJogos} jogo(s)</span>`);
                if (b.qtdDezenas) metas.push(`<span class="meta-tag">${b.qtdDezenas} dez.</span>`);
                metas.push(`<span class="meta-tag" style="color:var(--accent);border-color:rgba(0,200,150,.2)">R$ ${Number(b.valorCota).toFixed(2).replace('.', ',')} / cota</span>`);
                if (b.tipo === 'EXTERNO') {
                    const origemTxt = [b.origem, b.origemCodLoterico].filter(Boolean).join(' · ');
                    metas.push(`<span class="meta-tag meta-dest">externo${origemTxt ? ' · ' + origemTxt : ''}</span>`);
                } else {
                    metas.push(`<span class="meta-tag">interno</span>`);
                }
                if (b.saldoEnviado !== null && b.saldoEnviado !== undefined) {
                    metas.push(`<span class="meta-tag meta-saldo">${b.saldoEnviado} cotas</span>`);
                }
                const card = document.createElement('div');
                card.className = `bolao-card is-${b.tipo === 'INTERNO' ? 'int' : 'ext'}`;
                card.dataset.idx = gi;
                card.style.animationDelay = (i * .03) + 's';
                card.innerHTML = `
                    <div>
                        <div class="bolao-key">#${b.bolao_id || ''} · ${b.concurso}</div>
                        <div class="bolao-nome">${b.modalidade} — Concurso ${b.concurso}</div>
                        <div class="bolao-metas">${metas.join('')}</div>
                    </div>
                    <div class="qtd-block">
                        <div class="qtd-lbl">Cotas Vendidas</div>
                        <div class="qtd-wrap">
                            <button type="button" class="btn-q" onclick="ajQ(${gi},-1)">−</button>
                            <input type="number" class="inp-qtd" id="qtd-${gi}" min="0" placeholder="0" oninput="onQtd(${gi})" onblur="blurQ('qtd-${gi}')">
                            <button type="button" class="btn-q" onclick="ajQ(${gi},+1)">+</button>
                        </div>
                        <div class="qtd-sub" id="sub-${gi}">—</div>
                    </div>
                `;
                grp.appendChild(card);
            });
            wrap.appendChild(grp);
        });
    };

    renderGrupoModalidade('Tradicionais', regulares, false);
    renderGrupoModalidade('Especiais', especiais, true);
    updBolTotais();
}

function ajQ(idx, d) {
    const inp = $(`qtd-${idx}`);
    inp.value = Math.max(0, (parseInt(inp.value) || 0) + d) || '';
    onQtd(idx);
    inp.focus();
}

function onQtd(idx) {
    const inp = $(`qtd-${idx}`);
    const sub = $(`sub-${idx}`);
    const card = inp.closest('.bolao-card');
    const b = allBoloes[idx].data;
    const qtd = parseInt(inp.value) || 0;
    if (qtd > 0) {
        sub.textContent = fmtBRL(qtd * b.valorCota);
        sub.classList.add('on');
        inp.classList.add('filled');
        card.classList.add('has-val');
    } else {
        sub.textContent = '—';
        sub.classList.remove('on');
        inp.classList.remove('filled');
        card.classList.remove('has-val');
    }
    updBolTotais();
    atualizarListaVendas();
}

function normalizarTexto(txt) {
    return String(txt || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function isModalidadeEspecial(modalidade) {
    const m = normalizarTexto(modalidade);
    return (
        m.includes('PASCOA') ||
        m.includes('VIRADA') ||
        m.includes('INDEPENDENCIA') ||
        m.includes('SAO JOAO')
    );
}

function ordenarBoloesFechamento(lista) {
    return [...lista].sort((a, b) => {
        const modA = String(a.modalidade || '');
        const modB = String(b.modalidade || '');
        const cmpMod = modA.localeCompare(modB, 'pt-BR');
        if (cmpMod !== 0) return cmpMod;
        const valA = Number(a.valorCota || 0);
        const valB = Number(b.valorCota || 0);
        if (valA !== valB) return valA - valB;
        return Number(a.concurso || 0) - Number(b.concurso || 0);
    });
}

function updBolTotais() {
    let tInt = 0;
    let tExt = 0;
    let totalCotas = 0;

    allBoloes.forEach(({ tipo, data, idx }) => {
        const qtd = parseInt($(`qtd-${idx}`)?.value) || 0;
        const subtotal = qtd * Number(data.valorCota || 0);
        if (tipo === 'INTERNO') tInt += subtotal;
        else tExt += subtotal;
        totalCotas += qtd;
    });

    const tot = tInt + tExt;
    $('tot-int').textContent = fmtBRL(tInt);
    $('tot-ext').textContent = fmtBRL(tExt);
    $('tot-bol').textContent = fmtBRL(tot);
    $('tot-bol-geral').textContent = fmtBRL(tot);
    $('tot-cotas').textContent = totalCotas;

    document.querySelectorAll('[id^="mod-tot-"]').forEach(el => {
        el.textContent = 'R$ 0,00';
    });

    const blocoTrad = $('bloco-tot-tradicionais');
    if (blocoTrad) blocoTrad.textContent = 'R$ 0,00';
    const blocoEsp = $('bloco-tot-especiais');
    if (blocoEsp) blocoEsp.textContent = 'R$ 0,00';

    let totTrad = 0;
    let totEsp = 0;
    const modTots = {};

    allBoloes.forEach(({ data, idx, grupo, modalidade }) => {
        const qtd = parseInt($(`qtd-${idx}`)?.value) || 0;
        const subtotal = qtd * Number(data.valorCota || 0);
        const modKey = `${grupo}-${modalidade}`.replace(/\s/g, '_');
        modTots[modKey] = (modTots[modKey] || 0) + subtotal;
        if (grupo === 'Especiais') totEsp += subtotal;
        else totTrad += subtotal;
    });

    Object.entries(modTots).forEach(([k, v]) => {
        const el = $(`mod-tot-${k}`);
        if (el) el.textContent = fmtBRL(v);
    });
    if (blocoTrad) blocoTrad.textContent = fmtBRL(totTrad);
    if (blocoEsp) blocoEsp.textContent = fmtBRL(totEsp);
}

function atualizarListaVendas() {
    const vendidos = allBoloes.filter(({ idx }) => (parseInt($(`qtd-${idx}`)?.value) || 0) > 0);
    const list = $('vendas-registradas');
    const items = $('vendas-items');
    list.classList.toggle('show', vendidos.length > 0);
    items.innerHTML = '';
    vendidos.forEach(({ tipo, data, idx }) => {
        const qtd = parseInt($(`qtd-${idx}`).value) || 0;
        const item = document.createElement('div');
        item.className = 'venda-item';
        item.innerHTML = `
            <span class="vi-nome">${data.modalidade} — Conc. ${data.concurso} <span style="font-size:9px;color:var(--dim)">${tipo}</span></span>
            <span class="vi-qtd">${qtd}x</span>
            <span class="vi-val">${fmtBRL(qtd * data.valorCota)}</span>
        `;
        items.appendChild(item);
    });
}

function restaurarBoloes() {
    const mapa = {};
    [...(ESTADO.tela3.internos || []), ...(ESTADO.tela3.externos || [])].forEach(b => {
        if (b.qtdVendida > 0) mapa[b.bolao_id] = b.qtdVendida;
    });
    allBoloes.forEach(({ data, idx }) => {
        const qtd = mapa[data.bolao_id];
        if (!qtd) return;
        const inp = $(`qtd-${idx}`);
        if (inp) {
            inp.value = qtd;
            onQtd(idx);
        }
    });
}

// ─── RESUMO ───────────────────────────────────────────────────────────────────

function montarResumo() {
    coletarTela1();
    coletarTela2();
    coletarTela3();

    const t1 = ESTADO.tela1;
    const t2 = ESTADO.tela2;
    const t3 = ESTADO.tela3;

    $('r-func').textContent = t1.funcionario_nome || '—';
    $('r-data').textContent = fmtData(t1.data_ref);
    $('r-loteria').textContent = loteriaAtiva?.nome || '—';

    const totalProd = (t2.produtos || []).reduce((a, p) => a + Number(p.sub || 0), 0);
    const totalFed  = (t2.federais || []).reduce((a, f) => a + f.subtotal, 0);
    const totalBol  = [...(t3.internos || []), ...(t3.externos || [])].reduce((a, b) => a + b.subtotal, 0);
    const totalDiv  = (t1.dividas || []).reduce((a, d) => a + d.valor, 0);

    const s = (id, v) => {
        const el = $(id);
        if (!el) return;
        el.textContent = fmtBRL(v);
        el.classList.toggle('zero', v === 0);
    };

    s('r-troco-ini', t1.troco_inicial);
    s('r-produtos', totalProd);
    s('r-federais', totalFed);
    s('r-boloes', totalBol);
    s('r-relatorio', t1.relatorio);

    const totDeb = t1.troco_inicial + totalProd + totalFed + totalBol + t1.relatorio;
    s('r-tot-deb', totDeb);

    s('r-troco-sob', t1.troco_sobra);
    s('r-deposito', t1.deposito);
    s('r-pix', t1.pix_cnpj);
    s('r-pix-dif', t1.diferenca_pix);
    s('r-rasp', t1.premio_raspadinha);
    s('r-tele', t1.resgate_telesena);
    s('r-dividas', totalDiv);

    $('div-badge').textContent = (t1.dividas || []).length;

    const subWrap = $('div-sub-wrap');
    subWrap.innerHTML = '';
    (t1.dividas || []).forEach(d => {
        const l = document.createElement('div');
        l.className = 'linha sub';
        l.innerHTML = `
            <div class="linha-label"><div class="linha-dot"></div>${d.nome}</div>
            <div class="linha-val">R$ ${parseFloat(d.valor).toFixed(2).replace('.', ',')}</div>
        `;
        subWrap.appendChild(l);
    });

    const totCred = t1.troco_sobra + t1.deposito + t1.pix_cnpj + t1.diferenca_pix + t1.premio_raspadinha + t1.resgate_telesena + totalDiv;
    s('r-tot-cred', totCred);

    const quebra = totCred - totDeb;
    renderQuebra(quebra, totCred, totDeb);
    detectarModo();
}

function renderQuebra(quebra, cred, deb) {
    const card = $('quebra-card');
    const icon = $('q-icon');
    const titulo = $('q-titulo');
    const desc = $('q-desc');
    const val = $('q-valor');
    const det = $('q-detalhe');
    const justWrap = $('just-wrap');
    const btn = $('btn-final');

    card.className = 'quebra-card';
    det.textContent = `Créditos (R$ ${Number(cred).toFixed(2).replace('.', ',')}) − Débitos (R$ ${Number(deb).toFixed(2).replace('.', ',')})`;

    const abs = Math.abs(quebra);
    const fmtA = 'R$ ' + abs.toFixed(2).replace('.', ',');

    if (abs < 0.005) {
        card.classList.add('q-eq');
        icon.textContent = '✓';
        titulo.textContent = 'Caixa Equilibrado';
        desc.textContent = 'Créditos e débitos estão balanceados.';
        val.textContent = 'R$ 0,00';
        justWrap.classList.remove('show');
        if (modoAtual !== 'visualizacao') btn.disabled = false;
    } else if (quebra > 0) {
        card.classList.add('q-pos');
        icon.textContent = '↑';
        titulo.textContent = 'Sobra de Caixa';
        desc.textContent = `O caixa apresenta sobra de ${fmtA}.`;
        val.textContent = '+' + fmtA;
        justWrap.classList.add('show');
        btn.disabled = true;
    } else {
        card.classList.add('q-neg');
        icon.textContent = '↓';
        titulo.textContent = 'Falta de Caixa';
        desc.textContent = `O caixa apresenta falta de ${fmtA}.`;
        val.textContent = '−' + fmtA;
        justWrap.classList.add('show');
        btn.disabled = true;
    }

    const ta = $('justificativa');
    const cnt = $('just-cnt');
    ta.oninput = () => {
        cnt.textContent = ta.value.length;
        if (Math.abs(quebra) >= 0.005 && modoAtual !== 'visualizacao') {
            btn.disabled = ta.value.trim().length < 10;
        }
    };
}

function detectarModo() {
    const banner = $('modo-banner');
    banner.className = 'modo-banner';
    if (!fechamentoOriginalId) {
        modoAtual = 'novo';
        banner.innerHTML = '<span>Novo fechamento — será gravado ao finalizar.</span>';
        banner.classList.add('show', 'novo');
        $('btn-final').className = 'btn-finalizar salvar';
        $('btn-final-txt').textContent = 'Finalizar Fechamento';
        $('btn-final').disabled = false;
        return;
    }
    modoAtual = 'edicao';
    banner.innerHTML = '<span>Modo <strong>edição</strong> — ao finalizar o registro existente será sobrescrito.</span>';
    banner.classList.add('show', 'edicao');
    $('btn-final').className = 'btn-finalizar salvar';
    $('btn-final-txt').textContent = 'Salvar Alterações';
    $('btn-final').disabled = false;
}

function toggleDividas() {
    const sub = $('div-sub-wrap');
    const arrow = $('div-arrow');
    const open = sub.style.display === 'block';
    sub.style.display = open ? 'none' : 'block';
    arrow.style.transform = open ? 'rotate(0)' : 'rotate(90deg)';
}

// ─── FINALIZAR / GRAVAR ───────────────────────────────────────────────────────

async function finalizar() {
    if (modoAtual === 'visualizacao') {
        resetEstado();
        showStep(1);
        return;
    }

    coletarTela1();
    coletarTela2();
    coletarTela3();

    const t1 = ESTADO.tela1;
    const t2 = ESTADO.tela2;
    const t3 = ESTADO.tela3;

    const btn = $('btn-final');
    btn.disabled = true;

    try {
        let existeId = fechamentoOriginalId;
        if (!existeId) {
            const { data: existe, error: errExiste } = await sb
                .from('fechamentos')
                .select('id')
                .eq('loteria_id', loteriaAtiva.id)
                .eq('usuario_id', t1.funcionario_id)
                .eq('data_ref', t1.data_ref)
                .maybeSingle();
            if (errExiste) throw errExiste;
            if (existe?.id) existeId = existe.id;
        }

        const permissao = FECHAMENTO_RULES.avaliarPermissaoGravacao({
            usuarioLogado: usuario,
            funcionarioSelecionadoId: t1.funcionario_id,
            existeFechamento: !!existeId
        });
        if (!permissao.permitido) {
            btn.disabled = false;
            alert(permissao.motivo || 'Sem permissão para gravar.');
            return;
        }

        let tokenAutorizado = null;
        if (permissao.exigeToken) {
            tokenAutorizado = await FECHAMENTO_RULES.abrirModalToken();
            if (!tokenAutorizado) {
                btn.disabled = false;
                return;
            }
        }

        const sobrescrever = !!permissao.sobrescrevendo;

        showGravando('Gravando fechamento de ' + t1.funcionario_nome + '...');
        setProgress(10);

        // FIX: totalProd agora usa o novo modelo t2.produtos
        const totalProd = (t2.produtos || []).reduce((a, p) => a + Number(p.sub || 0), 0);
        const totalFed  = (t2.federais || []).reduce((a, f) => a + f.subtotal, 0);
        const totalBol  = [...(t3.internos || []), ...(t3.externos || [])].reduce((a, b) => a + b.subtotal, 0);
        const totalDiv  = (t1.dividas || []).reduce((a, d) => a + d.valor, 0);

        const totDeb  = t1.troco_inicial + totalProd + totalFed + totalBol + t1.relatorio;
        const totCred = t1.troco_sobra + t1.deposito + t1.pix_cnpj + t1.diferenca_pix + t1.premio_raspadinha + t1.resgate_telesena + totalDiv;
        const quebra  = totCred - totDeb;
        const justif  = $('justificativa')?.value?.trim() || '';

        const payload = {
            loteria_id: loteriaAtiva.id,
            usuario_id: t1.funcionario_id,
            funcionario_nome: t1.funcionario_nome,
            data_ref: t1.data_ref,
            troco_inicial: t1.troco_inicial,
            troco_sobra: t1.troco_sobra,
            relatorio: t1.relatorio,
            deposito: t1.deposito,
            pix_cnpj: t1.pix_cnpj,
            diferenca_pix: t1.diferenca_pix,
            premio_raspadinha: t1.premio_raspadinha,
            resgate_telesena: t1.resgate_telesena,
            total_produtos: totalProd,
            total_federais: totalFed,
            total_boloes: totalBol,
            total_fiado: totalDiv,
            total_debitos: totDeb,
            total_creditos: totCred,
            quebra,
            justificativa: justif,
            criado_por: usuario.id,
            sobrescrito_por: tokenAutorizado?.gerado_por || null,
            updated_at: new Date().toISOString()
        };

        setProgress(30);

        let fechId;
        if (sobrescrever && existeId) {
            const { error: delProdErr }    = await sb.from('fechamento_produtos').delete().eq('fechamento_id', existeId);
            if (delProdErr) throw delProdErr;
            const { error: delFedVendasErr } = await sb.from('federal_vendas').delete().eq('fechamento_id', existeId);
            if (delFedVendasErr) throw delFedVendasErr;
            const { error: delBolErr }     = await sb.from('fechamento_boloes').delete().eq('fechamento_id', existeId);
            if (delBolErr) throw delBolErr;
            const { error: delDivErr }     = await sb.from('fechamento_dividas').delete().eq('fechamento_id', existeId);
            if (delDivErr) throw delDivErr;
            const { error: errUpd }        = await sb.from('fechamentos').update(payload).eq('id', existeId);
            if (errUpd) throw errUpd;
            fechId = existeId;
        } else {
            const { data: ins, error: errIns } = await sb.from('fechamentos').insert(payload).select('id').single();
            if (errIns) throw errIns;
            fechId = ins.id;
        }

        setProgress(55);

const prodRows = (t2.produtos || [])
  .filter(p => Number(p.qtd || 0) > 0)
  .map(p => ({
    fechamento_id: fechId,
    produto_id: p.produto_id || null,
    tipo: p.produto,
    descricao: p.descricao || '',
    valor_unitario: Number(p.preco || 0),
    qtd_vendida: Number(p.qtd || 0),
    total: Number(p.sub || 0)
  }));
                raspadinha_id: p.raspadinha_id || null,
                telesena_item_id: p.telesena_item_id || null
            }));

        if (prodRows.length) {
            const { error } = await sb.from('fechamento_produtos').insert(prodRows);
            if (error) throw error;
        }

        setProgress(70);

        const federaisVendidas = (t2.federais || []).filter(f => Number(f.qtdVendida || 0) > 0);
        for (const f of federaisVendidas) {
            const { error } = await sb.rpc('registrar_venda_federal', {
                p_federal_id: f.federal_id,
                p_loteria_vendedora_id: loteriaAtiva.id,
                p_usuario_id: Number(t1.funcionario_id),
                p_canal: 'FECHAMENTO',
                p_qtd_vendida: Number(f.qtdVendida),
                p_data_referencia: t1.data_ref,
                p_desconto: 0,
                p_observacao: 'Lançado no fechamento',
                p_fechamento_id: fechId
            });
            if (error) throw error;
        }

        setProgress(82);

        const bolRows = [
            ...(t3.internos || []).filter(b => b.qtdVendida > 0).map(b => ({
                fechamento_id: fechId,
                bolao_id: b.bolao_id,
                tipo: 'INTERNO',
                modalidade: b.modalidade,
                qtd_vendida: b.qtdVendida,
                valor_cota: b.valorCota,
                subtotal: b.subtotal
            })),
            ...(t3.externos || []).filter(b => b.qtdVendida > 0).map(b => ({
                fechamento_id: fechId,
                bolao_id: b.bolao_id,
                tipo: 'EXTERNO',
                modalidade: b.modalidade,
                qtd_vendida: b.qtdVendida,
                valor_cota: b.valorCota,
                subtotal: b.subtotal
            }))
        ];
        if (bolRows.length) {
            const { error } = await sb.from('fechamento_boloes').insert(bolRows);
            if (error) throw error;
        }

        setProgress(93);

        const divRows = (t1.dividas || [])
            .filter(d => d.nome)
            .map(d => ({
                fechamento_id: fechId,
                cliente_nome: d.nome,
                valor: d.valor
            }));
        if (divRows.length) {
            const { error } = await sb.from('fechamento_dividas').insert(divRows);
            if (error) throw error;
        }

        if (tokenAutorizado?.id) {
            await FECHAMENTO_RULES.consumirTokenSobrescrita({
                tokenId: tokenAutorizado.id,
                usadoPor: usuario.id,
                fechamentoId: fechId
            });
        }

        setProgress(100);
        hideGravando();
        $('btn-final-txt').textContent = '✓ Gravado!';
        $('btn-final').style.background = '#00e8ad';
        setTimeout(() => {
            alert(
                `✅ Fechamento gravado com sucesso!\n\n` +
                `Funcionário: ${t1.funcionario_nome}\n` +
                `Loteria: ${loteriaAtiva.nome}\n` +
                `Data: ${fmtData(t1.data_ref)}\n` +
                `Quebra: ${fmtBRL(quebra)}`
            );
            resetEstado();
            showStep(1);
        }, 500);
    } catch (e) {
        hideGravando();
        btn.disabled = false;
        console.error(e);
        alert('❌ Erro ao gravar:\n\n' + (e.message || 'Erro desconhecido'));
    }
}

// ─── MODAIS / UI ──────────────────────────────────────────────────────────────

function fecharModal(id) {
    $(id).classList.remove('show');
}

function confirmarInicio() {
    $('m-inicio').classList.add('show');
}

function confirmarSair() {
    $('m-sair').classList.add('show');
}

function executarInicio() {
    fecharModal('m-inicio');
    window.SISLOT_SECURITY.irParaInicio();
}

async function executarSair() {
    await window.SISLOT_SECURITY.sair();
}

function showGravando(titulo) {
    $('m-grav-titulo').textContent = titulo;
    $('m-grav-sub').textContent = 'Aguarde';
    $('m-prog').style.width = '0%';
    $('m-gravando').classList.add('show');
}

function hideGravando() {
    $('m-gravando').classList.remove('show');
}

function setProgress(pct) {
    $('m-prog').style.width = pct + '%';
    $('m-grav-sub').textContent = pct + '%';
}

function toast(msg, ok = true) {
    console.log((ok ? '[OK] ' : '[ERRO] ') + msg);
}

// ─── RESET DE ESTADO ──────────────────────────────────────────────────────────

function resetEstado() {
    ESTADO.tela1 = {};
    ESTADO.tela2 = { produtos: [], federais: [] };
    ESTADO.tela3 = { internos: [], externos: [] };
    lstInt = [];
    lstExt = [];
    allBoloes = [];
    federais = [];
    produtosLista = [];
    mostrarProdutosSemEstoque = false;
    fechamentoOriginalId = null;
    modoAtual = 'novo';

    [
        'relatorio', 'deposito', 'troco-ini', 'troco-sob',
        'pix-cnpj', 'pix-dif', 'premio-rasp', 'resgate-tele'
    ].forEach(id => {
        const el = $(id);
        if (el) {
            el.value = '';
            el.classList.remove('filled', 'has-error');
        }
    });

    if (FECHAMENTO_RULES.podeSelecionarFuncionario(usuario)) {
        $('funcionario').value = '';
        $('funcionario').classList.remove('filled');
    }

    $('dividas-list').innerHTML = '';
    dividaCount = 0;
    renderDivCount();
    calcDivTotal();

    // Reseta filtro de produtos e checkbox
    const filtroTipo = $('prod-filtro-tipo');
    if (filtroTipo) filtroTipo.value = '';
    const toggleTodos = $('toggle-produtos-todos');
    if (toggleTodos) toggleTodos.checked = false;

    renderProdutos();

    $('fed-tbody').innerHTML = '';
    $('fed-count').textContent = '0';
    $('fed-tot-lbl').textContent = 'R$ 0,00';
    setFS('fs-inicial');

    $('t2-rasp').textContent = 'R$ 0,00';
    $('t2-tele').textContent = 'R$ 0,00';
    $('t2-fed').textContent  = 'R$ 0,00';
    $('t2-geral').textContent = 'R$ 0,00';
    $('produtos-tot').textContent = 'R$ 0,00';

    $('boloes-wrap').innerHTML = '';
    $('vendas-items').innerHTML = '';
    $('vendas-registradas').classList.remove('show');
    $('tot-int').textContent = 'R$ 0,00';
    $('tot-ext').textContent = 'R$ 0,00';
    $('tot-bol').textContent = 'R$ 0,00';
    $('tot-bol-geral').textContent = 'R$ 0,00';
    $('tot-cotas').textContent = '0';
    setB3('b3-inicial');

    $('modo-banner').className = 'modo-banner';
    $('modo-banner').innerHTML = '';
    $('justificativa').value = '';
    $('just-cnt').textContent = '0';
    $('just-wrap').classList.remove('show');

    $('data-ref').value = new Date().toISOString().slice(0, 10);
    hideStatusMsg('status-busca');
}

// ─── EXPORTS GLOBAIS ──────────────────────────────────────────────────────────

window.autoFill               = autoFill;
window.onFuncChange           = onFuncChange;
window.avancarStep            = avancarStep;
window.addDivida              = addDivida;
window.remDivida              = remDivida;
window.ajR                    = ajR;
window.recalcR                = recalcR;
window.ajTele                 = ajTele;
window.recalcTele             = recalcTele;
window.ajProduto              = ajProduto;
window.recalcProdutos         = recalcProdutos;
window.buscarFechamentoExistente = buscarFechamentoExistente;
window.buscarFederais         = buscarFederais;
window.ajFed                  = ajFed;
window.onFed                  = onFed;
window.carregarBoloes         = carregarBoloes;
window.ajQ                    = ajQ;
window.onQtd                  = onQtd;
window.toggleDividas          = toggleDividas;
window.finalizar              = finalizar;
window.fecharModal            = fecharModal;
window.confirmarInicio        = confirmarInicio;
window.confirmarSair          = confirmarSair;
window.executarInicio         = executarInicio;
window.executarSair           = executarSair;
window.trocarLoteria          = trocarLoteria;
window.blurQ                  = blurQ;
window.loteriaAtiva           = loteriaAtiva;

init();
