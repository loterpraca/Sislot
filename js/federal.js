/**
 * SISLOT — Federal
 * Versão final completa
 */

const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);
const $ = id => document.getElementById(id);
const fmtMoney = v => 'R$ ' + (Number(v || 0).toFixed(2)).replace('.', ',');
const fmtDate  = v => { if (!v) return '—'; const [y,m,d] = String(v).split('-'); return `${d}/${m}/${y}`; };

// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
const state = {
    usuario:                 null,
    lojaPrincipalId:         null,
    loterias:                [],
    usuarios:                [],
    federais:                [],
    resumo:                  [],
    movimentos:              [],
    vendasFuncionario:       [],
    detalhesFederais:        [],
    controle:                [],
    editingCadastroConcurso: null,
    editingMovId:            null,
    lancFederalId:           null
};

const QTD_PADRAO = {
    qua: { centro: 80, boulevard: 80, lotobel: 60, santa: 0, via: 0 },
    sab: { centro: 80, boulevard: 70, lotobel: 120, santa: 0, via: 0 }
};

const LOJA_LOGOS = {
    'boulevard':    './icons/boulevard.png',
    'centro':       './icons/loterpraca.png',
    'lotobel':      './icons/lotobel.png',
    'santa-tereza': './icons/santa-tereza.png',
    'via-brasil':   './icons/via-brasil.png',
};

// ══════════════════════════════════════════════════════════
// LOJA TREE — tema e ciclagem
// ══════════════════════════════════════════════════════════
function atualizarHeaderLoja() {
    const logoImg    = $('logoImg');
    const svgAll     = $('lojaTreeAll');
    const headerNome = $('headerNome');
    const lojaId     = $('filtro-loja').value;

    if (!lojaId) {
        if (svgAll)     svgAll.style.display  = '';
        if (logoImg)    logoImg.style.display  = 'none';
        if (headerNome) headerNome.textContent = 'Todas as Lojas';
        document.body.setAttribute('data-loja', 'todas');
        return;
    }

    const loteria = state.loterias.find(x => String(x.id) === String(lojaId));
    const slug    = loteria?.slug || '';
    const logo    = LOJA_LOGOS[slug];

    if (svgAll)  svgAll.style.display  = 'none';
    if (logoImg) {
        logoImg.src           = logo || '';
        logoImg.style.display = logo ? '' : 'none';
    }
    if (!logo && svgAll) svgAll.style.display = '';
    if (headerNome) headerNome.textContent = loteria?.nome || 'Loja';
    document.body.setAttribute('data-loja', slug || 'todas');
}

function ciclarLojaTree() {
    const lojaId  = $('filtro-loja').value;
    const options = [...$('filtro-loja').options].map(o => o.value);
    const idx     = options.indexOf(lojaId);
    const proximo = options[(idx + 1) % options.length];
    $('filtro-loja').value = proximo;
    atualizarHeaderLoja();
    renderVisao();
}

// ══════════════════════════════════════════════════════════
// RELÓGIO
// ══════════════════════════════════════════════════════════
function setClock() {
    const el = $('relogio');
    if (el) el.textContent =
        new Date().toLocaleTimeString('pt-BR') + ' — ' +
        new Date().toLocaleDateString('pt-BR');
}
setClock();
setInterval(setClock, 1000);

// ══════════════════════════════════════════════════════════
// STATUS
// ══════════════════════════════════════════════════════════
function showStatus(id, msg, t = 'ok') {
    const el = $(id);
    if (el) { el.textContent = msg; el.className = `status-bar show ${t}`; }
}
function hideStatus(id) {
    const el = $(id);
    if (el) el.className = 'status-bar';
}

// ══════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `panel-${tab}`));
}
document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ══════════════════════════════════════════════════════════
// FILL SELECT HELPER
// ══════════════════════════════════════════════════════════
function fillSelect(selectId, items, placeholder = 'Selecione...', valueKey = 'id', labelFn = x => x.nome) {
    const sel = $(selectId); if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value       = item[valueKey];
        opt.textContent = labelFn(item);
        sel.appendChild(opt);
    });
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

// ══════════════════════════════════════════════════════════
// BOOTSTRAP
// ══════════════════════════════════════════════════════════
async function bootstrap() {
    await loadSession();
    await loadBaseData();
    bindEvents();
    await refreshAll();
}

async function loadSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = './login.html'; return; }

    const { data: user } = await sb
        .from('usuarios')
        .select('id,nome,perfil,ativo')
        .eq('auth_user_id', session.user.id)
        .eq('ativo', true)
        .maybeSingle();
    state.usuario = user;

    if (user) {
        const { data: vinculo } = await sb
            .from('usuarios_loterias')
            .select('loteria_id')
            .eq('usuario_id', user.id)
            .eq('principal', true)
            .maybeSingle();
        state.lojaPrincipalId = vinculo?.loteria_id || null;
    }
}

async function loadBaseData() {
    const [lotRes, usuRes] = await Promise.all([
        sb.from('loterias').select('id,nome,slug,ativo').eq('ativo', true).order('id'),
        sb.from('usuarios').select('id,nome,ativo').eq('ativo', true).order('nome')
    ]);
    state.loterias = lotRes.data || [];
    state.usuarios = usuRes.data || [];
    fillStaticSelects();
}

function fillStaticSelects() {
    const lotLabel = x => `${x.id} • ${x.nome}`;
    ['filtro-loja','mov-loteria-origem',
     'mov-loteria-destino','fec-loteria'].forEach(id =>
        fillSelect(id, state.loterias, 'Selecione...', 'id', lotLabel));
    fillSelect('fec-usuario', state.usuarios, 'Selecione...', 'id', x => x.nome);
    atualizarHeaderLoja();
}

// ══════════════════════════════════════════════════════════
// REFRESH ALL
// ══════════════════════════════════════════════════════════
async function refreshAll() {
    await Promise.all([
        loadFederais(),
        loadResumo(),
        loadMovs(),
        loadVendasFuncionario(),
        loadDetalhesFederais(),
        loadControleFinanceiro()
    ]);
    renderCadastro();
    renderVisao();
    renderMovimentacoes();
    renderFechamentoResumo();
    renderAuditoria();
    renderControle();
    fillFederalSelectors();
}

// ══════════════════════════════════════════════════════════
// LOAD FUNCTIONS
// ══════════════════════════════════════════════════════════
async function loadFederais() {
    const { data } = await sb
        .from('federais')
        .select('*')
        .order('dt_sorteio', { ascending: false })
        .order('concurso',   { ascending: false })
        .order('loteria_id');
    state.federais = data || [];
}

async function loadResumo() {
    const { data, error } = await sb
        .from('view_resumo_federal')
        .select('*')
        .order('dt_sorteio', { ascending: false })
        .order('concurso',   { ascending: false });
    state.resumo = error ? [] : (data || []);
}

async function loadMovs() {
    const { data } = await sb
        .from('federal_movimentacoes')
        .select('*, federais!inner(concurso,dt_sorteio,modalidade), usuarios(nome)')
        .order('created_at', { ascending: false });
    state.movimentos = data || [];
}

async function loadVendasFuncionario() {
    const { data } = await sb
        .from('view_federal_vendas_funcionario')
        .select('*')
        .order('dt_sorteio',      { ascending: false })
        .order('funcionario_nome');
    state.vendasFuncionario = data || [];
}

async function loadDetalhesFederais() {
    const { data } = await sb
        .from('view_detalhe_federal')
        .select('*')
        .order('concurso', { ascending: false });
    state.detalhesFederais = data || [];
}

async function loadControleFinanceiro() {
    const { data } = await sb
        .from('view_saldo_controle')
        .select('*')
        .order('mes_ref', { ascending: false });
    state.controle = data || [];
}

// ══════════════════════════════════════════════════════════
// FILL SELECTORS
// ══════════════════════════════════════════════════════════
function fillFederalSelectors() {
    fillSelect('mov-federal', state.federais,
        'Selecione...', 'id', x => `${x.concurso}`);
    updateFecFederal();
}

function updateFecFederal() {
    const lojaId   = $('fec-loteria').value;
    const filtered = lojaId
        ? state.federais.filter(x => String(x.loteria_id) === String(lojaId))
        : [];
    fillSelect(
        'fec-federal',
        filtered,
        filtered.length ? 'Selecione o concurso...' : 'Selecione a loja primeiro',
        'id',
        x => `${x.concurso} — ${fmtDate(x.dt_sorteio)}`
    );
    $('fec-valor-fracao').value = '';
    $('fec-total').value        = '';
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function lookupLoteriaName(id) {
    return state.loterias.find(x => String(x.id) === String(id))?.nome || '—';
}
function lookupFederal(id) {
    return state.federais.find(x => String(x.id) === String(id));
}

function applyFederalType(tipo) {
    if (tipo === 'ESPECIAL') {
        $('cad-valor-fracao').value = '10.00';
        $('cad-valor-custo').value  = '8.04';
    } else {
        $('cad-valor-fracao').value = '4.00';
        $('cad-valor-custo').value  = '3.21';
    }
}

function nextWedOrSat(base = new Date()) {
    const d = new Date(base); d.setHours(12, 0, 0, 0);
    while (![3,6].includes(d.getDay())) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

function nextQuaSabFrom(baseIso, dir) {
    let d = new Date((baseIso || new Date().toISOString().slice(0,10)) + 'T12:00:00');
    d.setDate(d.getDate() + (dir > 0 ? 1 : -1));
    while (![3,6].includes(d.getDay())) d.setDate(d.getDate() + (dir > 0 ? 1 : -1));
    return d.toISOString().slice(0, 10);
}

function suggestNextConcurso() {
    const nums = state.federais.map(f => parseInt(f.concurso,10)).filter(n => !isNaN(n));
    return nums.length ? String(Math.max(...nums) + 1) : '';
}

function suggestNextSorteio() {
    if (!state.federais.length) return nextWedOrSat();
    const dates = state.federais.map(f => f.dt_sorteio).filter(Boolean).sort().reverse();
    return nextQuaSabFrom(dates[0], 1);
}

function fillQtdPadraoCadastro() {
    const d   = $('cad-dt-sorteio').value
        ? new Date($('cad-dt-sorteio').value + 'T12:00:00')
        : new Date();
    const pad = d.getDay() === 6 ? QTD_PADRAO.sab : QTD_PADRAO.qua;
    $('cad-qtd-centro').value    = pad.centro;
    $('cad-qtd-boulevard').value = pad.boulevard;
    $('cad-qtd-lotobel').value   = pad.lotobel;
    $('cad-qtd-santa').value     = pad.santa;
    $('cad-qtd-via').value       = pad.via;
}

function fmtMesRef(mesIso) {
    if (!mesIso) return '—';
    const [y, m] = mesIso.split('-');
    const nomes  = ['Jan','Fev','Mar','Abr','Mai','Jun',
                    'Jul','Ago','Set','Out','Nov','Dez'];
    return `${nomes[parseInt(m,10)-1]}/${y}`;
}

// ══════════════════════════════════════════════════════════
// RENDER — KPIs
// ══════════════════════════════════════════════════════════
function renderKPIs(rows) {
    const totalInicial  = rows.reduce((a,x) => a + Number(x.qtd_inicial              || 0), 0);
    const totalVendida  = rows.reduce((a,x) => a + Number(x.qtd_vendida_interna_total || 0)
                                                 + Number(x.qtd_venda_externa         || 0), 0);
    const totalDev      = rows.reduce((a,x) => a + Number(x.qtd_devolvida_interna     || 0)
                                                 + Number(x.qtd_dev_caixa_externa      || 0), 0);
    const totalEnc      = rows.reduce((a,x) => a + Number(x.qtd_encalhe              || 0), 0);
    const totalPrem     = rows.reduce((a,x) => a + Number(x.premio_encalhe_total      || 0), 0);
    const totalRes      = rows.reduce((a,x) => a + Number(x.resultado                || 0), 0);

    $('kpis-visao').innerHTML = [
        ['Qtd Inicial', totalInicial,       'Carga base'],
        ['Vendida',     totalVendida,        'Interna + externa'],
        ['Devolvida',   totalDev,            'Interna + terceiros'],
        ['Encalhe',     totalEnc,            'Qtd restante'],
        ['Prêmio',      fmtMoney(totalPrem), 'Total de prêmio'],
        ['Resultado',   fmtMoney(totalRes),  'Apuração geral']
    ].map(([l,v,s]) =>
        `<div class="kpi">
            <div class="kpi-label">${l}</div>
            <div class="kpi-value">${v}</div>
            <div class="kpi-sub">${s}</div>
         </div>`
    ).join('');
}

// ══════════════════════════════════════════════════════════
// RENDER — EXIBIÇÃO (tabela dinâmica)
// ══════════════════════════════════════════════════════════
function renderVisao() {
    let rows   = [...state.resumo];
    const c      = $('filtro-concurso').value.trim();
    const lojaId = $('filtro-loja').value;
    const di     = $('filtro-dt-ini').value;
    const df     = $('filtro-dt-fim').value;

    if (c)      rows = rows.filter(x => String(x.concurso).includes(c));
    if (lojaId) rows = rows.filter(x => String(x.loteria_id) === String(lojaId));
    if (di)     rows = rows.filter(x => x.dt_sorteio >= di);
    if (df)     rows = rows.filter(x => x.dt_sorteio <= df);

    renderKPIs(rows);

    if (lojaId) {
        renderVisaoLoja(rows, lojaId);
    } else {
        renderVisaoTodas(rows);
    }
}

// ── Modo: todas as lojas ──────────────────────────────────
function renderVisaoTodas(rows) {
    const thead = `<tr>
        <th>Loja</th><th>Concurso</th><th>Data</th>
        <th>Ini.</th><th>Total Func</th><th>Canais</th>
        <th>Dev. Int.</th><th>Dev. Ext.</th>
        <th>Venda Ext.</th><th>Retorno</th>
        <th>Estoque</th><th>Resultado</th><th>Ações</th>
    </tr>`;

    const tbody = rows.length ? rows.map(r => {
        const res    = Number(r.resultado || 0);
        const canais = Number(r.qtd_vendida_whatsapp || 0)
                     + Number(r.qtd_vendida_balcao   || 0);
        return `<tr>
            <td>${r.loja_origem}</td>
            <td class="mono">${r.concurso}</td>
            <td class="mono">${fmtDate(r.dt_sorteio)}</td>
            <td class="mono">${r.qtd_inicial}</td>
            <td class="mono">${r.qtd_vendida_funcionarios || '—'}</td>
            <td class="mono">${canais || '—'}</td>
            <td class="mono">${r.qtd_devolvida_interna  || '—'}</td>
            <td class="mono">${r.qtd_dev_caixa_externa  || '—'}</td>
            <td class="mono">${r.qtd_venda_externa      || '—'}</td>
            <td class="mono">${r.qtd_retorno_recebido   || '—'}</td>
            <td class="mono">${r.estoque_atual}</td>
            <td class="money ${res >= 0 ? 'pos' : 'neg'}">${fmtMoney(res)}</td>
            <td><div class="flex" style="gap:6px;flex-wrap:nowrap">
                <button class="btn-amber"
                    style="padding:5px 10px;font-size:11px"
                    onclick="openFederalDetail('${r.federal_id}')">Detalhar</button>
                <button class="btn-secondary"
                    style="padding:5px 10px;font-size:11px"
                    onclick="openLancamento('${r.federal_id}')">Lançamento</button>
            </div></td>
        </tr>`;
    }).join('')
    : `<tr><td colspan="13"><div class="empty">
        <div class="empty-title">Nada encontrado</div>
        <div class="empty-sub">Ajuste os filtros ou cadastre o primeiro concurso.</div>
       </div></td></tr>`;

    $('thead-visao').innerHTML = thead;
    $('tbody-visao').innerHTML = tbody;
}

// ── Modo: loja específica — colunas dinâmicas ─────────────
function renderVisaoLoja(rows, lojaId) {
    const funcMap = {};
    state.vendasFuncionario
        .filter(v => String(v.loteria_id) === String(lojaId)
                  && (v.canal_venda === 'CAIXA' || !v.canal_venda))
        .forEach(v => { funcMap[String(v.usuario_id)] = v.funcionario_nome; });
    const funcs = Object.entries(funcMap).map(([id, nome]) => ({ id, nome }));

    const thFuncs  = funcs.map(f =>
        `<th>${f.nome.split(' ')[0]}</th>`).join('');
    const colSpan  = 8 + funcs.length + 4;

    const thead = `<tr>
        <th>Concurso</th><th>Data</th><th>Ini.</th>
        ${thFuncs}
        <th>WA</th><th>Balcão</th>
        <th>Dev. Int.</th><th>Dev. Ext.</th>
        <th>Venda Ext.</th><th>Retorno</th>
        <th>Estoque</th><th>Resultado</th><th>Ações</th>
    </tr>`;

    const tbody = rows.length ? rows.map(r => {
        const res = Number(r.resultado || 0);

        const tdFuncs = funcs.map(f => {
            const v = state.vendasFuncionario.find(x =>
                String(x.federal_id) === String(r.federal_id) &&
                String(x.usuario_id) === f.id &&
                (x.canal_venda === 'CAIXA' || !x.canal_venda)
            );
            return `<td class="mono">${v?.qtd_vendida || '—'}</td>`;
        }).join('');

        return `<tr>
            <td class="mono">${r.concurso}</td>
            <td class="mono">${fmtDate(r.dt_sorteio)}</td>
            <td class="mono">${r.qtd_inicial}</td>
            ${tdFuncs}
            <td class="mono">${r.qtd_vendida_whatsapp  || '—'}</td>
            <td class="mono">${r.qtd_vendida_balcao    || '—'}</td>
            <td class="mono">${r.qtd_devolvida_interna || '—'}</td>
            <td class="mono">${r.qtd_dev_caixa_externa || '—'}</td>
            <td class="mono">${r.qtd_venda_externa     || '—'}</td>
            <td class="mono">${r.qtd_retorno_recebido  || '—'}</td>
            <td class="mono">${r.estoque_atual}</td>
            <td class="money ${res >= 0 ? 'pos' : 'neg'}">${fmtMoney(res)}</td>
            <td><div class="flex" style="gap:6px;flex-wrap:nowrap">
                <button class="btn-amber"
                    style="padding:5px 10px;font-size:11px"
                    onclick="openFederalDetail('${r.federal_id}')">Detalhar</button>
                <button class="btn-secondary"
                    style="padding:5px 10px;font-size:11px"
                    onclick="openLancamento('${r.federal_id}')">Lançamento</button>
            </div></td>
        </tr>`;
    }).join('')
    : `<tr><td colspan="${colSpan}"><div class="empty">
        <div class="empty-title">Nada encontrado</div>
       </div></td></tr>`;

    $('thead-visao').innerHTML = thead;
    $('tbody-visao').innerHTML = tbody;
}

// ══════════════════════════════════════════════════════════
// RENDER — CADASTRO
// ══════════════════════════════════════════════════════════
function renderCadastro() {
    const grupos = Object.values(
        state.federais.reduce((acc, f) => {
            if (!acc[f.concurso]) acc[f.concurso] = {
                concurso: f.concurso, dt_sorteio: f.dt_sorteio,
                valor_fracao: f.valor_fracao, valor_custo: f.valor_custo,
                qt_fracoes_bilhete: f.qt_fracoes_bilhete, itens: []
            };
            acc[f.concurso].itens.push(f);
            return acc;
        }, {})
    ).sort((a,b) => String(b.concurso).localeCompare(String(a.concurso), undefined, { numeric: true }));

    $('cnt-cadastros').textContent = grupos.length;
    $('tbody-cadastro').innerHTML  = grupos.length ? grupos.map(g => {
        const tipo     = Number(g.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM';
        const totalIni = g.itens.reduce((a,x) => a + Number(x.qtd_recebidas || 0), 0);
        const totalDev = g.itens.reduce((a,x) => a + Number(x.qtd_devolvidas || 0), 0);
        const totalEnc = g.itens.reduce((a,x) => a + Number(x.qtd_encalhe   || 0), 0);
        return `<tr>
            <td>Todos</td>
            <td class="mono">${g.concurso}</td>
            <td class="mono">${fmtDate(g.dt_sorteio)}</td>
            <td><span class="badge ${tipo === 'COMUM' ? 'b-info' : 'b-warn'}">${tipo}</span></td>
            <td class="money">${fmtMoney(g.valor_fracao)}</td>
            <td class="money">${fmtMoney(g.valor_custo)}</td>
            <td class="mono">${totalIni}</td>
            <td class="mono">${totalDev}</td>
            <td class="mono">${totalEnc}</td>
            <td><div class="flex" style="flex-wrap:nowrap;gap:6px">
                <button class="btn-amber"  onclick="editCadastro('${g.concurso}')">Editar</button>
                <button class="btn-danger" onclick="deleteCadastro('${g.concurso}')">Excluir</button>
            </div></td>
        </tr>`;
    }).join('')
    : `<tr><td colspan="10"><div class="empty">
        <div class="empty-title">Nenhum concurso cadastrado</div>
       </div></td></tr>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — MOVIMENTAÇÕES
// ══════════════════════════════════════════════════════════
function renderMovimentacoes() {
    $('tbody-mov').innerHTML = state.movimentos.length
        ? state.movimentos.map(m => {
            const total       = Number(m.valor_total_real || m.valor_total ||
                (Number(m.qtd_fracoes||0) * Number(m.valor_fracao_real||m.valor_fracao||0)));
            const statusClass = m.status_acerto === 'PAGO' ? 'b-ok' : 'b-warn';
            const isTrans     = m.tipo_evento === 'TRANSFERENCIA';

            // Desconto cambista = qtd × (fração normal − valor negociado)
            const desconto = isTrans && m.qtd_venda_cambista > 0 && m.valor_cambista > 0
                ? Number(m.qtd_venda_cambista) *
                  (Number(m.valor_fracao_real || m.valor_fracao || 0) - Number(m.valor_cambista))
                : 0;

            // Helper: célula só relevante em TRANSFERENCIA
            const cel = val => isTrans
                ? `<td class="mono">${Number(val) > 0 ? val : '—'}</td>`
                : `<td class="mono" style="color:var(--dim)">—</td>`;

            return `<tr>
                <td class="mono">${new Date(m.created_at).toLocaleDateString('pt-BR')}</td>
                <td class="mono">${m.federais?.concurso || '—'}</td>
                <td><span class="badge b-info">${m.tipo_evento || m.tipo || '—'}</span></td>
                <td>${lookupLoteriaName(m.loteria_origem)}</td>
                <td>${m.loteria_destino ? lookupLoteriaName(m.loteria_destino) : '—'}</td>
                <td class="mono">${m.qtd_fracoes}</td>
                ${cel(m.qtd_vendida)}
                ${cel(m.qtd_devolucao_caixa)}
                ${cel(m.qtd_venda_cambista)}
                <td class="money ${desconto > 0 ? 'neg' : ''}">${isTrans && desconto > 0 ? fmtMoney(desconto) : '—'}</td>
                ${cel(m.qtd_retorno_origem)}
                <td class="money">${fmtMoney(total)}</td>
                <td><span class="badge ${statusClass}">${m.status_acerto || '—'}</span></td>
                <td><div class="flex" style="gap:6px;flex-wrap:nowrap">
                    <button class="btn-amber"
                        style="padding:5px 10px;font-size:11px"
                        onclick="editMov('${m.id}')">Editar</button>
                    <button class="btn-danger"
                        style="padding:5px 10px;font-size:11px"
                        onclick="deleteMovDirect('${m.id}')">Excluir</button>
                </div></td>
            </tr>`;
        }).join('')
        : `<tr><td colspan="14"><div class="empty">
            <div class="empty-title">Sem movimentações</div>
           </div></td></tr>`;

    applyDestinoFilter();
}

// ══════════════════════════════════════════════════════════
// RENDER — FECHAMENTO RESUMO
// ══════════════════════════════════════════════════════════
function renderFechamentoResumo() {
    const lojaId = $('fec-loteria').value;
    let rows     = [...state.vendasFuncionario];
    if (lojaId) rows = rows.filter(x => String(x.loteria_id) === String(lojaId));

    const nomeLoja = lojaId
        ? (state.loterias.find(x => String(x.id) === String(lojaId))?.nome || '')
        : 'Todas as lojas';

    const titulo = $('titulo-fechamento-resumo');
    if (titulo) titulo.textContent = `Vendas — ${nomeLoja}`;

    $('tbody-fechamento-resumo').innerHTML = rows.length
        ? rows.map(v => `<tr>
            <td>${v.funcionario_nome}</td>
            <td>${lookupLoteriaName(v.loteria_id)}</td>
            <td><span class="badge b-info">${v.canal_venda || 'CAIXA'}</span></td>
            <td class="mono">${v.concurso}</td>
            <td class="mono">${v.qtd_vendida}</td>
            <td class="money">${fmtMoney(v.total_vendido)}</td>
          </tr>`).join('')
        : `<tr><td colspan="6"><div class="empty">
            <div class="empty-title">Sem vendas lançadas</div>
           </div></td></tr>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — AUDITORIA
// ══════════════════════════════════════════════════════════
function renderAuditoria() {
    let rows = [...state.movimentos];
    const t  = $('aud-tipo')?.value;
    const s  = $('aud-status')?.value;
    const c  = $('aud-concurso')?.value.trim();
    const di = $('aud-dt-ini')?.value;
    const df = $('aud-dt-fim')?.value;

    if (t)  rows = rows.filter(x => (x.tipo_evento || x.tipo) === t);
    if (s)  rows = rows.filter(x => (x.status_acerto || '') === s);
    if (c)  rows = rows.filter(x => String(x.federais?.concurso || '').includes(c));
    if (di) rows = rows.filter(x => String(x.data_mov) >= di);
    if (df) rows = rows.filter(x => String(x.data_mov) <= df);

    $('tbody-auditoria').innerHTML = rows.length ? rows.map(m => {
        const total       = Number(m.valor_total_real || m.valor_total ||
            (Number(m.qtd_fracoes||0)*Number(m.valor_fracao_real||m.valor_fracao||0)));
        const statusClass = m.status_acerto === 'PAGO' ? 'b-ok' : 'b-warn';
        return `<tr>
            <td class="mono">${new Date(m.created_at).toLocaleString('pt-BR')}</td>
            <td>${m.federais?.modalidade || 'Federal'}</td>
            <td class="mono">${m.federais?.concurso || '—'}</td>
            <td><span class="badge b-info">${m.tipo_evento || m.tipo || '—'}</span></td>
            <td>${lookupLoteriaName(m.loteria_origem)}</td>
            <td>${m.loteria_destino ? lookupLoteriaName(m.loteria_destino) : '—'}</td>
            <td class="mono">${m.qtd_fracoes}</td>
            <td class="money">${fmtMoney(m.valor_fracao_real || m.valor_fracao)}</td>
            <td class="money">${fmtMoney(total)}</td>
            <td><span class="badge ${statusClass}">${m.status_acerto || '—'}</span></td>
            <td><div class="flex" style="gap:6px;flex-wrap:nowrap">
                <button class="btn-amber"     style="padding:5px 10px;font-size:11px"
                    onclick="editMov('${m.id}')">Editar</button>
                <button class="btn-secondary" style="padding:5px 10px;font-size:11px"
                    onclick="openMovDetail('${m.id}')">Ver</button>
                <button class="btn-danger"    style="padding:5px 10px;font-size:11px"
                    onclick="deleteMovDirect('${m.id}')">Excluir</button>
            </div></td>
        </tr>`;
    }).join('')
    : `<tr><td colspan="11"><div class="empty">
        <div class="empty-title">Sem registros para os filtros</div>
       </div></td></tr>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — CONTROLE (aba Federal — acesso sócio/admin)
// ══════════════════════════════════════════════════════════
function renderControle() {
    const panel = $('panel-controle');
    if (!panel) return;

    const perfil = state.usuario?.perfil;
    if (!['ADMIN','SOCIO'].includes(perfil)) {
        panel.innerHTML = `<div class="empty">
            <div class="empty-title">Acesso restrito</div>
            <div class="empty-sub">Disponível apenas para sócios e administradores.</div>
           </div>`;
        return;
    }

    const meses    = [...new Set(state.controle.map(x => x.mes_ref))].sort().reverse();
    const mesAtual = $('ctrl-mes-ref')?.value || meses[0] || '';
    const linhas   = state.controle.filter(x =>
        (!mesAtual || x.mes_ref === mesAtual));

    // Calcula saldo líquido por par
    const mapaLiquido = {};
    linhas.forEach(r => {
        const [a, b] = [r.loja_devedora_id, r.loja_credora_id].sort((x,y) => x-y);
        const chave  = `${a}_${b}`;
        if (!mapaLiquido[chave]) mapaLiquido[chave] = { a, b, saldo: 0 };
        mapaLiquido[chave].saldo +=
            r.loja_devedora_id === a ? Number(r.saldo_bruto) : -Number(r.saldo_bruto);
    });

    const liquidos = Object.values(mapaLiquido)
        .filter(x => Math.abs(x.saldo) > 0.001)
        .map(x => ({
            pagador:   x.saldo > 0 ? x.a : x.b,
            recebedor: x.saldo > 0 ? x.b : x.a,
            valor:     Math.abs(x.saldo)
        }))
        .sort((a,b) => b.valor - a.valor);

    const opsMes = meses.map(m =>
        `<option value="${m}" ${m === mesAtual ? 'selected' : ''}>${fmtMesRef(m)}</option>`
    ).join('');

    panel.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="flex" style="gap:12px;align-items:center;flex-wrap:wrap">
                <label class="field-label">Mês de referência</label>
                <select id="ctrl-mes-ref" onchange="renderControle()">
                    <option value="">Todos</option>${opsMes}
                </select>
            </div>
        </div>

        <div class="sep">
            <span class="sep-label">Saldo líquido — ${fmtMesRef(mesAtual) || 'todos os meses'}</span>
            <div class="sep-line"></div>
        </div>
        <div class="table-wrap">
            <table class="table">
                <thead><tr>
                    <th>Quem paga</th><th>Quem recebe</th>
                    <th>Saldo líquido</th><th>Ação</th>
                </tr></thead>
                <tbody>
                ${liquidos.length
                    ? liquidos.map(l => `<tr>
                        <td><strong>${lookupLoteriaName(l.pagador)}</strong></td>
                        <td>${lookupLoteriaName(l.recebedor)}</td>
                        <td class="money">${fmtMoney(l.valor)}</td>
                        <td><button class="btn-primary"
                            style="padding:5px 12px;font-size:12px"
                            onclick="quitarAcerto(${l.pagador},${l.recebedor},'${mesAtual}')">
                            Marcar pago
                        </button></td>
                      </tr>`).join('')
                    : `<tr><td colspan="4"><div class="empty">
                        <div class="empty-title">Nenhuma pendência em aberto</div>
                       </div></td></tr>`
                }
                </tbody>
            </table>
        </div>

        <div class="sep" style="margin-top:24px">
            <span class="sep-label">Detalhamento por par de lojas</span>
            <div class="sep-line"></div>
        </div>
        <div class="table-wrap">
            <table class="table">
                <thead><tr>
                    <th>Devedor</th><th>Credor</th>
                    <th>Movimentações</th><th>Total bruto</th><th>Status</th>
                </tr></thead>
                <tbody>
                ${linhas.length
                    ? linhas.map(r => `<tr>
                        <td>${lookupLoteriaName(r.loja_devedora_id)}</td>
                        <td>${lookupLoteriaName(r.loja_credora_id)}</td>
                        <td class="mono">${r.qtd_movimentacoes}</td>
                        <td class="money">${fmtMoney(r.saldo_bruto)}</td>
                        <td><span class="badge ${r.quitado ? 'b-ok' : 'b-warn'}">
                            ${r.quitado ? 'PAGO' : 'PENDENTE'}
                        </span></td>
                      </tr>`).join('')
                    : `<tr><td colspan="5" class="muted">Sem movimentações no período</td></tr>`
                }
                </tbody>
            </table>
        </div>`;
}

window.quitarAcerto = async function(pagadorId, recebedorId, mesRef) {
    const nomePag = lookupLoteriaName(pagadorId);
    const nomeRec = lookupLoteriaName(recebedorId);
    if (!confirm(`Confirma acerto de ${nomePag} com ${nomeRec} em ${fmtMesRef(mesRef)}?`)) return;
    try {
        const { error } = await sb
            .from('controle_financeiro')
            .update({ status: 'PAGO', data_acerto: new Date().toISOString().slice(0,10) })
            .eq('mes_ref', mesRef)
            .eq('produto', 'FEDERAL')
            .or([
                `and(loja_devedora_id.eq.${pagadorId},loja_credora_id.eq.${recebedorId})`,
                `and(loja_devedora_id.eq.${recebedorId},loja_credora_id.eq.${pagadorId})`
            ].join(','));
        if (error) throw error;
        showStatus('st-mov', `Acerto ${nomePag} × ${nomeRec} marcado como pago.`, 'ok');
        await refreshAll();
    } catch(e) { showStatus('st-mov', e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════
// CADASTRO — CRUD
// ══════════════════════════════════════════════════════════
function setCadastroDefaults() {
    state.editingCadastroConcurso = null;
    $('card-form-cadastro').style.display = 'block';
    $('cad-concurso').value               = suggestNextConcurso();
    $('cad-dt-sorteio').value             = suggestNextSorteio();
    $('cad-tipo').value                   = 'COMUM';
    applyFederalType('COMUM');
    $('cad-fracoes-bilhete').value        = '10';
    fillQtdPadraoCadastro();
}

async function saveCadastro() {
    try {
        const concurso         = $('cad-concurso').value.trim();
        const dt_sorteio       = $('cad-dt-sorteio').value;
        const valor_fracao     = Number($('cad-valor-fracao').value    || 0);
        const valor_custo      = Number($('cad-valor-custo').value     || 0);
        const qt_fracoes       = Number($('cad-fracoes-bilhete').value || 10);

        if (!concurso || !dt_sorteio) {
            showStatus('st-cadastro', 'Preencha concurso e data.', 'err'); return;
        }

        const mapa = [
            { id: 1, qtd: Number($('cad-qtd-centro').value    || 0) },
            { id: 2, qtd: Number($('cad-qtd-boulevard').value || 0) },
            { id: 3, qtd: Number($('cad-qtd-lotobel').value   || 0) },
            { id: 4, qtd: Number($('cad-qtd-santa').value     || 0) },
            { id: 5, qtd: Number($('cad-qtd-via').value       || 0) }
        ];

        if (state.editingCadastroConcurso) {
            for (const item of mapa) {
                const { error } = await sb.from('federais').update({
                    concurso, dt_sorteio, valor_fracao, valor_custo,
                    qt_fracoes_bilhete: qt_fracoes,
                    qtd_recebidas: item.qtd, updated_at: new Date().toISOString()
                }).eq('concurso', state.editingCadastroConcurso).eq('loteria_id', item.id);
                if (error) throw error;
            }
            showStatus('st-cadastro', 'Concurso atualizado em todas as loterias.', 'ok');
        } else {
            for (const item of mapa) {
                const { error } = await sb.from('federais').insert({
                    loteria_id: item.id, modalidade: 'Federal',
                    concurso, dt_sorteio, valor_fracao, valor_custo,
                    qt_fracoes_bilhete: qt_fracoes, qtd_recebidas: item.qtd,
                    qtd_devolvidas: 0, qtd_encalhe: 0, ativo: true,
                    criado_por: state.usuario?.id || null,
                    updated_at: new Date().toISOString()
                });
                if (error) throw error;
            }
            showStatus('st-cadastro', 'Federais cadastradas para todas as loterias.', 'ok');
        }
        await refreshAll();
        setCadastroDefaults();
    } catch(e) { showStatus('st-cadastro', e.message, 'err'); }
}

window.editCadastro = function(concurso) {
    const itens = state.federais.filter(x => String(x.concurso) === String(concurso));
    const f     = itens[0]; if (!f) return;
    state.editingCadastroConcurso = String(concurso);
    $('card-form-cadastro').style.display = 'block';
    $('cad-concurso').value        = f.concurso;
    $('cad-dt-sorteio').value      = f.dt_sorteio;
    $('cad-tipo').value            = Number(f.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM';
    $('cad-valor-fracao').value    = f.valor_fracao;
    $('cad-valor-custo').value     = f.valor_custo;
    $('cad-fracoes-bilhete').value = f.qt_fracoes_bilhete;
    $('cad-qtd-centro').value    = itens.find(x => x.loteria_id === 1)?.qtd_recebidas || 0;
    $('cad-qtd-boulevard').value = itens.find(x => x.loteria_id === 2)?.qtd_recebidas || 0;
    $('cad-qtd-lotobel').value   = itens.find(x => x.loteria_id === 3)?.qtd_recebidas || 0;
    $('cad-qtd-santa').value     = itens.find(x => x.loteria_id === 4)?.qtd_recebidas || 0;
    $('cad-qtd-via').value       = itens.find(x => x.loteria_id === 5)?.qtd_recebidas || 0;
    switchTab('cadastro');
};

window.deleteCadastro = async function(concurso) {
    if (!concurso) return;
    if (!confirm(`Apagar o concurso ${concurso} em todas as loterias?`)) return;
    try {
        const idsFederais = state.federais
            .filter(x => String(x.concurso) === String(concurso))
            .map(x => x.id);
        if (idsFederais.length) {
            const { error: e1 } = await sb.from('federal_encalhe_premio').delete().in('federal_id', idsFederais);
            if (e1) throw e1;
            const { error: e2 } = await sb.from('controle_financeiro').delete()
                .in('movimentacao_id',
                    (await sb.from('federal_movimentacoes').select('id').in('federal_id', idsFederais)).data?.map(x=>x.id) || []
                );
            const { error: e3 } = await sb.from('federal_movimentacoes').delete().in('federal_id', idsFederais);
            if (e3) throw e3;
            const { error: e4 } = await sb.from('fechamento_federais').delete().in('federal_id', idsFederais);
            if (e4) throw e4;
        }
        const { error } = await sb.from('federais').delete().eq('concurso', concurso);
        if (error) throw error;
        if (String(state.editingCadastroConcurso || '') === String(concurso)) {
            state.editingCadastroConcurso = null;
            setCadastroDefaults();
        }
        showStatus('st-cadastro', `Concurso ${concurso} excluído.`, 'ok');
        await refreshAll();
    } catch(e) { showStatus('st-cadastro', e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════
// MOVIMENTAÇÃO — CRUD
// ══════════════════════════════════════════════════════════
async function saveMov() {
    try {
        const federal          = lookupFederal($('mov-federal').value);
        const tipoEvento       = $('mov-tipo-evento').value;
        const origemId         = Number($('mov-loteria-origem').value  || 0) || null;
        const destinoId        = Number($('mov-loteria-destino').value || 0) || null;
        const qtdTotal         = Number($('mov-qtd').value             || 0);
        const valor            = Number($('mov-valor').value           || 0);
        const qtdVendida       = Number($('mov-qtd-vendida').value        || 0);
        const qtdDevCaixa      = Number($('mov-qtd-dev-caixa').value      || 0);
        const qtdCambista      = Number($('mov-qtd-cambista').value       || 0);
        const qtdRetornoOrigem = Number($('mov-qtd-retorno-origem').value  || 0);
        const valorCambista    = Number($('mov-valor-cambista').value      || 0);

        if (!$('mov-federal').value || !tipoEvento || !qtdTotal || !origemId) {
            showStatus('st-mov', 'Preencha concurso, origem, evento e quantidade.', 'err');
            return;
        }
        if (tipoEvento === 'TRANSFERENCIA' && !destinoId) {
            showStatus('st-mov', 'Selecione a loja destino.', 'err');
            return;
        }

        if (tipoEvento === 'TRANSFERENCIA') {
            const soma = qtdVendida + qtdDevCaixa + qtdCambista + qtdRetornoOrigem;
            if (soma > 0 && soma !== qtdTotal) {
                showStatus('st-mov', `Distribuição inválida: ${soma} ≠ ${qtdTotal}.`, 'err');
                return;
            }
        }

        const valorTotal = qtdTotal * valor;
        const dataHoje   = new Date().toISOString().slice(0, 10);

        const payload = {
            federal_id:           $('mov-federal').value,
            loteria_origem:       origemId,
            loteria_destino:      destinoId || null,
            tipo:                 tipoEvento === 'TRANSFERENCIA' ? 'ENVIO' : 'DEVOLUCAO_EXTERNA',
            tipo_evento:          tipoEvento,
            qtd_fracoes:          qtdTotal,
            valor_fracao:         valor,
            valor_fracao_ref:     Number(federal?.valor_fracao || 0),
            valor_fracao_real:    valor,
            valor_total:          valorTotal,
            valor_total_real:     valorTotal,
            valor_a_acertar:      0,
            qtd_vendida:          qtdVendida,
            qtd_devolucao_caixa:  qtdDevCaixa,
            qtd_venda_cambista:   qtdCambista,
            qtd_retorno_origem:   qtdRetornoOrigem,
            valor_cambista:       valorCambista,
            status_acerto:        state.editingMovId
                                    ? ($('mov-status-acerto').value || 'PENDENTE')
                                    : 'PENDENTE',
            data_mov:             dataHoje,
            observacao:           $('mov-observacao').value.trim() || null,
            criado_por:           state.usuario?.id || null,
            updated_at:           new Date().toISOString(),
            editado_por:          state.editingMovId ? state.usuario?.id : null,
            editado_em:           state.editingMovId ? new Date().toISOString() : null
        };

        let movId;
        let oldQtdDevCaixa = 0;

        if (state.editingMovId) {
            const { data: antigo } = await sb
                .from('federal_movimentacoes')
                .select('qtd_devolucao_caixa')
                .eq('id', state.editingMovId)
                .single();
            oldQtdDevCaixa = Number(antigo?.qtd_devolucao_caixa || 0);

            const { error } = await sb
                .from('federal_movimentacoes')
                .update(payload)
                .eq('id', state.editingMovId);
            if (error) throw error;
            movId = state.editingMovId;
            showStatus('st-mov', 'Movimentação atualizada.', 'ok');
        } else {
            const { data: mov, error } = await sb
                .from('federal_movimentacoes')
                .insert(payload)
                .select('id')
                .single();
            if (error) throw error;
            movId = mov.id;
            showStatus('st-mov', 'Movimentação registrada.', 'ok');
        }

        // Atualiza qtd_devolvidas da ORIGEM automaticamente
        if (tipoEvento === 'TRANSFERENCIA') {
            const delta = qtdDevCaixa - oldQtdDevCaixa;
            if (delta !== 0) {
                const { data: fedOrig } = await sb
                    .from('federais')
                    .select('id,qtd_devolvidas')
                    .eq('id', $('mov-federal').value)
                    .single();
                if (fedOrig) {
                    await sb.from('federais').update({
                        qtd_devolvidas: Math.max(0, Number(fedOrig.qtd_devolvidas||0) + delta),
                        updated_at: new Date().toISOString()
                    }).eq('id', fedOrig.id);
                }
            }
        }

        // Sincroniza controle_financeiro
        if (tipoEvento === 'TRANSFERENCIA' && destinoId && origemId !== destinoId) {
            await sincronizarControleFinanceiro({
                movId, federal, origemId, destinoId,
                qtdVendida, qtdDevCaixa, qtdCambista,
                valorCambista, dataRef: dataHoje
            });
        }

        state.editingMovId = null;
        clearMov();
        await refreshAll();

    } catch(e) { showStatus('st-mov', e.message, 'err'); }
}

async function sincronizarControleFinanceiro({
    movId, federal, origemId, destinoId,
    qtdVendida, qtdDevCaixa, qtdCambista, valorCambista, dataRef
}) {
    await sb.from('controle_financeiro').delete().eq('movimentacao_id', movId);

    const valorVenda  = qtdVendida  * Number(federal?.valor_fracao || 0);
    const valorDev    = qtdDevCaixa * Number(federal?.valor_custo  || 0);
    const valorCamb   = qtdCambista * (valorCambista || 0);
    const totalDevido = valorVenda + valorDev + valorCamb;

    if (totalDevido <= 0) return;

    const mesRef = dataRef.slice(0,7) + '-01';
    const obs    = [
        qtdVendida  > 0 ? `${qtdVendida}×${fmtMoney(federal?.valor_fracao)} (venda)`    : null,
        qtdDevCaixa > 0 ? `${qtdDevCaixa}×${fmtMoney(federal?.valor_custo)} (dev.caixa)`: null,
        qtdCambista > 0 ? `${qtdCambista}×${fmtMoney(valorCambista)} (cambista)`         : null
    ].filter(Boolean).join(' + ');

    const { error } = await sb.from('controle_financeiro').insert({
        movimentacao_id:  movId,
        produto:          'FEDERAL',
        loja_devedora_id: destinoId,
        loja_credora_id:  origemId,
        valor:            totalDevido,
        mes_ref:          mesRef,
        status:           'PENDENTE',
        observacao:       obs,
        criado_por:       state.usuario?.id || null,
        updated_at:       new Date().toISOString()
    });
    if (error) throw error;
}

function clearMov() {
    state.editingMovId = null;
    ['mov-federal','mov-loteria-origem','mov-loteria-destino',
     'mov-dt-concurso','mov-qtd','mov-valor','mov-total',
     'mov-observacao'].forEach(id => { const el=$(id); if(el) el.value=''; });
    $('mov-modalidade').value         = 'Federal';
    $('mov-tipo-evento').value        = 'TRANSFERENCIA';
    $('mov-status-acerto').value      = 'PENDENTE';
    $('mov-qtd-vendida').value        = 0;
    $('mov-qtd-dev-caixa').value      = 0;
    $('mov-qtd-cambista').value       = 0;
    $('mov-qtd-retorno-origem').value = 0;
    $('mov-valor-cambista').value     = '';
    const status  = $('mov-distribuicao-status');
    if (status)  status.textContent  = '';
    const preview = $('mov-cambista-total');
    if (preview) preview.textContent = '';
    $('btn-excluir-mov').style.display = 'none';
    toggleDistribuicaoFields();
}

window.editMov = function(id) {
    const m = state.movimentos.find(x => String(x.id) === String(id));
    if (!m) return;
    state.editingMovId = id;
    switchTab('movimentacao');

    $('mov-federal').value              = m.federal_id;
    $('mov-modalidade').value           = 'Federal';
    $('mov-loteria-origem').value       = m.loteria_origem  || '';
    $('mov-loteria-destino').value      = m.loteria_destino || '';
    $('mov-dt-concurso').value          = lookupFederal(m.federal_id)?.dt_sorteio || '';
    $('mov-tipo-evento').value          = m.tipo_evento || 'TRANSFERENCIA';
    $('mov-qtd').value                  = m.qtd_fracoes;
    $('mov-valor').value                = m.valor_fracao_real || m.valor_fracao || '';
    $('mov-total').value                = Number(m.valor_total_real||m.valor_total||0).toFixed(2);
    $('mov-status-acerto').value        = m.status_acerto || 'PENDENTE';
    $('mov-observacao').value           = m.observacao || '';
    $('mov-qtd-vendida').value          = m.qtd_vendida         || 0;
    $('mov-qtd-dev-caixa').value        = m.qtd_devolucao_caixa || 0;
    $('mov-qtd-cambista').value         = m.qtd_venda_cambista  || 0;
    $('mov-qtd-retorno-origem').value   = m.qtd_retorno_origem  || 0;
    $('mov-valor-cambista').value       = m.valor_cambista       || '';

    toggleDistribuicaoFields();
    syncMovValorByTipo();
    applyDestinoFilter();
    $('btn-excluir-mov').style.display = 'inline-flex';
};

async function deleteMov() {
    if (!state.editingMovId) return;
    if (!confirm('Apagar esta movimentação?')) return;
    try {
        const { error } = await sb
            .from('federal_movimentacoes')
            .delete().eq('id', state.editingMovId);
        if (error) throw error;
        showStatus('st-mov', 'Movimentação apagada.', 'ok');
        clearMov();
        await refreshAll();
    } catch(e) { showStatus('st-mov', e.message, 'err'); }
}

window.deleteMovDirect = async function(id) {
    if (!id) return;
    if (!confirm('Apagar esta movimentação?')) return;
    try {
        const { error } = await sb
            .from('federal_movimentacoes')
            .delete().eq('id', id);
        if (error) throw error;
        if (String(state.editingMovId||'') === String(id)) clearMov();
        closeDrawer();
        showStatus('st-mov',      'Movimentação apagada.', 'ok');
        showStatus('st-auditoria','Movimentação apagada.', 'ok');
        await refreshAll();
    } catch(e) { showStatus('st-mov', e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════
// FECHAMENTO — CRUD
// ══════════════════════════════════════════════════════════
async function saveFechamento() {
    try {
        const lojaId    = $('fec-loteria').value;
        const usuarioId = $('fec-usuario').value;
        const dataRef   = $('fec-data-ref').value;
        const federalId = $('fec-federal').value;
        const canal     = $('fec-canal').value || 'CAIXA';

        if (!lojaId || !usuarioId || !dataRef || !federalId) {
            showStatus('st-fechamento', 'Preencha loja, funcionário, data e concurso.', 'err');
            return;
        }

        const federal = lookupFederal(federalId);
        if (!federal || String(federal.loteria_id) !== String(lojaId)) {
            showStatus('st-fechamento', 'Concurso não pertence à loja selecionada.', 'err');
            return;
        }

        const qtdVendida  = Number($('fec-qtd-vendida').value  || 0);
        const valorFracao = Number($('fec-valor-fracao').value || 0);
        const totalFed    = Number($('fec-total').value        || 0);

        if (qtdVendida <= 0) {
            showStatus('st-fechamento', 'Informe a quantidade vendida.', 'err');
            return;
        }

        const usuario = state.usuarios.find(x => String(x.id) === String(usuarioId));

        const header = {
            loteria_id:       Number(lojaId),
            usuario_id:       Number(usuarioId),
            funcionario_nome: usuario?.nome || 'Funcionário',
            data_ref:         dataRef,
            canal_venda:      canal,
            total_federais:   totalFed,
            troco_inicial: 0, troco_sobra: 0, relatorio: 0,
            deposito: 0, pix_cnpj: 0, diferenca_pix: 0,
            premio_raspadinha: 0, resgate_telesena: 0,
            total_produtos: 0, total_boloes: 0, total_fiado: 0,
            total_debitos: 0, total_creditos: 0, quebra: 0,
            criado_por:  state.usuario?.id || null,
            updated_at:  new Date().toISOString()
        };

        const { data: fHeader, error: eHeader } = await sb
            .from('fechamentos').insert(header).select('id').single();
        if (eHeader) throw eHeader;

        const { error: eItem } = await sb.from('fechamento_federais').insert({
            fechamento_id: fHeader.id,
            federal_id:    federalId,
            modalidade:    'Federal',
            concurso:      federal.concurso,
            dt_sorteio:    federal.dt_sorteio || null,
            valor_fracao:  valorFracao,
            qtd_vendida:   qtdVendida,
            total:         totalFed
        });
        if (eItem) throw eItem;

        showStatus('st-fechamento',
            `Venda registrada — ${qtdVendida} fração(ões) via ${canal}.`, 'ok');
        $('fec-qtd-vendida').value = '';
        $('fec-total').value       = '';
        await refreshAll();

    } catch(e) { showStatus('st-fechamento', e.message, 'err'); }
}

// ══════════════════════════════════════════════════════════
// LANÇAMENTO (drawer)
// ══════════════════════════════════════════════════════════
window.openLancamento = function(federalId) {
    const f = lookupFederal(federalId); if (!f) return;
    state.lancFederalId          = federalId;
    $('lanc-modalidade').value   = 'Federal';
    $('lanc-concurso').value     = f.concurso;
    $('lanc-data').value         = f.dt_sorteio;
    $('lanc-loja').value         = lookupLoteriaName(f.loteria_id);
    $('lanc-qtd-dev').value      = f.qtd_devolvidas || 0;
    $('lanc-qtd-enc').value      = f.qtd_encalhe    || 0;
    $('lanc-vlr-premio').value   = '';
    $('lanc-obs').value          = '';
    $('overlay-lanc').classList.add('show');
    $('drawer-lanc').classList.add('open');
};

function closeLancamento() {
    $('overlay-lanc').classList.remove('show');
    $('drawer-lanc').classList.remove('open');
    state.lancFederalId = null;
}

async function saveLancamento() {
    try {
        if (!state.lancFederalId) return;
        const qtdDev = Number($('lanc-qtd-dev').value   || 0);
        const qtdEnc = Number($('lanc-qtd-enc').value   || 0);
        const premio = Number($('lanc-vlr-premio').value || 0);
        const obs    = $('lanc-obs').value.trim() || null;

        const { error: e1 } = await sb.from('federais').update({
            qtd_devolvidas: qtdDev,
            qtd_encalhe:    qtdEnc,
            updated_at:     new Date().toISOString()
        }).eq('id', state.lancFederalId);
        if (e1) throw e1;

        if (premio > 0) {
            const { data: premioExistente } = await sb
                .from('federal_encalhe_premio')
                .select('id')
                .eq('federal_id', state.lancFederalId)
                .order('created_at', { ascending: false })
                .limit(1);

            if (premioExistente?.length) {
                const { error: e2 } = await sb.from('federal_encalhe_premio').update({
                    qtd_fracoes_premiadas: qtdEnc || 1,
                    valor_premio:          premio,
                    observacao:            obs,
                    data_registro: new Date().toISOString().slice(0,10)
                }).eq('id', premioExistente[0].id);
                if (e2) throw e2;
            } else {
                const { error: e3 } = await sb.from('federal_encalhe_premio').insert({
                    federal_id:            state.lancFederalId,
                    qtd_fracoes_premiadas: qtdEnc || 1,
                    valor_premio:          premio,
                    observacao:            obs,
                    criado_por:            state.usuario?.id || null
                });
                if (e3) throw e3;
            }
        }

        showStatus('st-visao', 'Lançamento salvo.', 'ok');
        closeLancamento();
        await refreshAll();
    } catch(e) { showStatus('st-visao', e.message, 'err'); }
}

// ══════════════════════════════════════════════════════════
// DRAWER — DETALHAR FEDERAL
// ══════════════════════════════════════════════════════════
window.openFederalDetail = function(federalId) {
    const r = state.resumo.find(x => String(x.federal_id) === String(federalId));
    if (!r) return;

    const detOrigem  = state.detalhesFederais
        .filter(x => String(x.federal_origem_id)  === String(federalId));
    const detDestino = state.detalhesFederais
        .filter(x => String(x.federal_destino_id) === String(federalId));
    const vendas     = state.vendasFuncionario
        .filter(x => String(x.federal_id) === String(federalId));

    const secVendaInterna = vendas.length ? `
        <div class="table-wrap"><table class="table">
            <thead><tr>
                <th>Funcionário</th><th>Canal</th><th>Qtd</th><th>Total</th>
            </tr></thead><tbody>
            ${vendas.map(v => `<tr>
                <td>${v.funcionario_nome}</td>
                <td><span class="badge b-info">${v.canal_venda || 'CAIXA'}</span></td>
                <td class="mono">${v.qtd_vendida}</td>
                <td class="money">${fmtMoney(v.total_vendido)}</td>
            </tr>`).join('')}
            </tbody>
        </table></div>`
    : '<div class="muted" style="padding:8px 0">Sem vendas internas</div>';

    const secVendaExterna = detOrigem.length ? `
        <div class="table-wrap"><table class="table">
            <thead><tr>
                <th>Loja destino</th><th>Enviadas</th><th>Vendidas</th>
                <th>Dev. Caixa</th><th>Cambista</th><th>Retorno</th><th>Valor acerto</th>
            </tr></thead><tbody>
            ${detOrigem.map(d => `<tr>
                <td>${d.loja_destino_nome}</td>
                <td class="mono">${d.qtd_enviada}</td>
                <td class="mono">${d.qtd_vendida         || '—'}</td>
                <td class="mono">${d.qtd_devolucao_caixa || '—'}</td>
                <td class="mono">${d.qtd_venda_cambista  || '—'}
                    ${d.qtd_venda_cambista
                        ? `<span class="muted" style="font-size:11px">
                           ×${fmtMoney(d.valor_cambista)}</span>` : ''}</td>
                <td class="mono">${d.qtd_retorno_origem  || '—'}</td>
                <td class="money">${fmtMoney(d.valor_acerto)}</td>
            </tr>`).join('')}
            </tbody>
        </table></div>`
    : '<div class="muted" style="padding:8px 0">Sem envios para outras lojas</div>';

    const secRecebimentos = detDestino.length ? `
        <div class="table-wrap"><table class="table">
            <thead><tr>
                <th>Loja origem</th><th>Recebidas</th><th>Vendidas</th>
                <th>Dev. Caixa</th><th>Cambista</th><th>Retornadas</th><th>A pagar</th>
            </tr></thead><tbody>
            ${detDestino.map(d => `<tr>
                <td>${d.loja_origem_nome}</td>
                <td class="mono">${d.qtd_enviada}</td>
                <td class="mono">${d.qtd_vendida         || '—'}</td>
                <td class="mono">${d.qtd_devolucao_caixa || '—'}</td>
                <td class="mono">${d.qtd_venda_cambista  || '—'}</td>
                <td class="mono">${d.qtd_retorno_origem  || '—'}</td>
                <td class="money">${fmtMoney(d.valor_acerto)}</td>
            </tr>`).join('')}
            </tbody>
        </table></div>`
    : '<div class="muted" style="padding:8px 0">Sem recebimentos de outras lojas</div>';

    const body = `
        <div class="card" style="margin-bottom:14px">
            <div class="inline-pills">
                <span class="pill">Qtd inicial ${r.qtd_inicial}</span>
                <span class="pill">Func ${r.qtd_vendida_funcionarios}</span>
                <span class="pill">WA ${r.qtd_vendida_whatsapp}</span>
                <span class="pill">Balcão ${r.qtd_vendida_balcao}</span>
                <span class="pill">Dev. int. ${r.qtd_devolvida_interna}</span>
                <span class="pill">Dev. ext. ${r.qtd_dev_caixa_externa}</span>
                <span class="pill">Venda ext. ${r.qtd_venda_externa}</span>
                <span class="pill">Retorno ${r.qtd_retorno_recebido}</span>
                <span class="pill">Encalhe ${r.qtd_encalhe}</span>
                <span class="pill">Estoque ${r.estoque_atual}</span>
                <span class="pill">Rec. terceiros ${fmtMoney(r.receitas_terceiros)}</span>
                <span class="pill">Resultado ${fmtMoney(r.resultado)}</span>
            </div>
        </div>

        <div class="sep"><span class="sep-label">Venda interna — funcionários e canais</span>
            <div class="sep-line"></div></div>
        ${secVendaInterna}

        <div class="sep" style="margin-top:16px">
            <span class="sep-label">Venda externa — enviou para outras lojas</span>
            <div class="sep-line"></div></div>
        ${secVendaExterna}

        <div class="sep" style="margin-top:16px">
            <span class="sep-label">Recebimentos — chegou de outras lojas</span>
            <div class="sep-line"></div></div>
        ${secRecebimentos}`;

    openDrawer(
        `Federal ${r.concurso} — ${r.loja_origem}`,
        `${r.modalidade} • ${fmtDate(r.dt_sorteio)}`,
        body,
        [{ label: 'Fechar', kind: 'secondary', onClick: closeDrawer }]
    );
};

window.openMovDetail = function(id) {
    const m = state.movimentos.find(x => String(x.id) === String(id)); if (!m) return;
    openDrawer(
        `Movimentação ${m.tipo_evento || m.tipo}`,
        `${m.federais?.modalidade || 'Federal'} • Concurso ${m.federais?.concurso || '—'}`,
        `<div class="grid-2">
            <div class="soft-card"><div class="field-label">Origem</div>
                <div>${lookupLoteriaName(m.loteria_origem)}</div></div>
            <div class="soft-card"><div class="field-label">Destino</div>
                <div>${m.loteria_destino ? lookupLoteriaName(m.loteria_destino) : '—'}</div></div>
            <div class="soft-card"><div class="field-label">Quantidade</div>
                <div class="mono">${m.qtd_fracoes}</div></div>
            <div class="soft-card"><div class="field-label">Status</div>
                <div>${m.status_acerto || '—'}</div></div>
            <div class="soft-card"><div class="field-label">Valor fração</div>
                <div class="money">${fmtMoney(m.valor_fracao_real||m.valor_fracao)}</div></div>
            <div class="soft-card"><div class="field-label">Data mov.</div>
                <div class="mono">${fmtDate(m.data_mov)}</div></div>
         </div>
         <div class="card" style="margin-top:14px">
            <div class="field-label">Distribuição</div>
            <div class="inline-pills" style="margin-top:8px">
                ${m.qtd_vendida        >0 ? `<span class="pill">Vendida ${m.qtd_vendida}</span>`       :''}
                ${m.qtd_devolucao_caixa>0 ? `<span class="pill">Dev. caixa ${m.qtd_devolucao_caixa}</span>`:''}
                ${m.qtd_venda_cambista >0 ? `<span class="pill">Cambista ${m.qtd_venda_cambista} × ${fmtMoney(m.valor_cambista)}</span>`:''}
                ${m.qtd_retorno_origem >0 ? `<span class="pill">Retorno origem ${m.qtd_retorno_origem}</span>`:''}
            </div>
         </div>
         <div class="card" style="margin-top:14px">
            <div class="field-label">Observação</div>
            <div style="margin-top:8px">${m.observacao || '—'}</div>
         </div>`,
        [
            { label: 'Editar', kind: 'amber',     onClick: () => { closeDrawer(); editMov(id); } },
            { label: 'Fechar', kind: 'secondary',  onClick: closeDrawer }
        ]
    );
};

// ══════════════════════════════════════════════════════════
// DRAWERS GENÉRICOS
// ══════════════════════════════════════════════════════════
function openDrawer(title, sub, bodyHtml, actions = []) {
    $('drawer-title').textContent = title;
    $('drawer-sub').textContent   = sub;
    $('drawer-body').innerHTML    = bodyHtml;
    $('drawer-foot').innerHTML    = '';
    actions.forEach(a => {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.className   = a.kind === 'primary'    ? 'btn-primary'
                      : a.kind === 'amber'      ? 'btn-amber'
                      : a.kind === 'danger'     ? 'btn-danger'
                      : 'btn-secondary';
        b.onclick     = a.onClick;
        $('drawer-foot').appendChild(b);
    });
    $('overlay').classList.add('show');
    $('drawer').classList.add('open');
}
function closeDrawer() {
    $('overlay').classList.remove('show');
    $('drawer').classList.remove('open');
}
window.closeDrawer = closeDrawer;

// ══════════════════════════════════════════════════════════
// HELPERS DE MOVIMENTAÇÃO
// ══════════════════════════════════════════════════════════
function syncMovValorByTipo() {
    const f    = lookupFederal($('mov-federal').value); if (!f) return;
    const tipo = $('mov-tipo-evento').value;
    if (tipo === 'DEVOLUCAO_CAIXA') {
        $('mov-valor').value = f.valor_custo;
    } else if (tipo === 'VENDA_CAMBISTA') {
        $('mov-valor').value = '';
    } else {
        $('mov-valor').value = f.valor_fracao;
    }
    $('mov-status-acerto').value = 'PENDENTE';
    const qtd   = Number($('mov-qtd').value   || 0);
    const valor = Number($('mov-valor').value || 0);
    $('mov-total').value = qtd && valor ? (qtd*valor).toFixed(2) : '';
}

function applyDestinoFilter() {
    const origem = $('mov-loteria-origem')?.value;
    const sel    = $('mov-loteria-destino');
    if (!sel) return;
    [...sel.options].forEach(opt => {
        if (!opt.value) { opt.hidden = false; return; }
        opt.hidden = !!origem && opt.value === origem;
    });
    if (origem && sel.value === origem) sel.value = '';
}

function toggleDistribuicaoFields() {
    const isTrans = $('mov-tipo-evento').value === 'TRANSFERENCIA';
    const bloco   = $('bloco-distribuicao');
    if (bloco) bloco.style.display = isTrans ? '' : 'none';
}

// ══════════════════════════════════════════════════════════
// BIND EVENTS
// ══════════════════════════════════════════════════════════
function bindEvents() {
    // Drawers
    $('overlay').addEventListener('click', closeDrawer);
    $('btn-close-drawer').addEventListener('click', closeDrawer);
    $('overlay-lanc').addEventListener('click', closeLancamento);
    $('btn-close-lanc').addEventListener('click', closeLancamento);
    $('btn-cancel-lanc').addEventListener('click', closeLancamento);
    $('btn-save-lanc').addEventListener('click', saveLancamento);

    // Loja tree
    const lojaTree = $('lojaTreeWrap');
    if (lojaTree) lojaTree.addEventListener('click', ciclarLojaTree);

    // Exibição
    $('btn-limpar-visao').addEventListener('click', () => {
        ['filtro-concurso','filtro-loja',
         'filtro-dt-ini','filtro-dt-fim'].forEach(id => $(id).value = '');
        atualizarHeaderLoja();
        renderVisao();
    });
    $('btn-recarregar-visao').addEventListener('click', refreshAll);
    $('filtro-loja').addEventListener('change', () => {
        atualizarHeaderLoja();
        renderVisao();
    });

    // Cadastro
    $('btn-cancelar-cadastro').addEventListener('click', setCadastroDefaults);
    $('btn-salvar-cadastro').addEventListener('click', saveCadastro);
    $('cad-tipo').addEventListener('change', e => applyFederalType(e.target.value));
    $('cad-dt-sorteio').addEventListener('change', fillQtdPadraoCadastro);
    $('cad-data-prev').addEventListener('click', () => {
        $('cad-dt-sorteio').value = nextQuaSabFrom(
            $('cad-dt-sorteio').value || suggestNextSorteio(), -1);
        fillQtdPadraoCadastro();
    });
    $('cad-data-next').addEventListener('click', () => {
        $('cad-dt-sorteio').value = nextQuaSabFrom(
            $('cad-dt-sorteio').value || suggestNextSorteio(), 1);
        fillQtdPadraoCadastro();
    });

    // Movimentação
    $('btn-salvar-mov').addEventListener('click', saveMov);
    $('btn-limpar-mov').addEventListener('click', clearMov);
    $('btn-excluir-mov').addEventListener('click', deleteMov);
    $('mov-modalidade').value = 'Federal';
    $('mov-loteria-origem').addEventListener('change', applyDestinoFilter);

    $('mov-federal').addEventListener('change', () => {
        const f = lookupFederal($('mov-federal').value);
        if (!f) {
            $('mov-resumo-selec').innerHTML =
                '<div class="empty-title">Selecione um concurso</div>';
            return;
        }
        $('mov-modalidade').value     = 'Federal';
        $('mov-loteria-origem').value = f.loteria_id;
        $('mov-dt-concurso').value    = f.dt_sorteio;
        applyDestinoFilter();
        syncMovValorByTipo();
        $('mov-resumo-selec').innerHTML = `<div class="inline-pills">
            <span class="pill">Modalidade Federal</span>
            <span class="pill">Origem ${lookupLoteriaName(f.loteria_id)}</span>
            <span class="pill">Concurso ${f.concurso}</span>
            <span class="pill">Data ${fmtDate(f.dt_sorteio)}</span>
            <span class="pill">Fração ${fmtMoney(f.valor_fracao)}</span>
            <span class="pill">Custo ${fmtMoney(f.valor_custo)}</span>
        </div>`;
    });

    $('mov-tipo-evento').addEventListener('change', () => {
        syncMovValorByTipo();
        toggleDistribuicaoFields();
    });

    ['mov-qtd','mov-valor'].forEach(id =>
        $(id).addEventListener('input', () => {
            const qtd   = Number($('mov-qtd').value   || 0);
            const valor = Number($('mov-valor').value || 0);
            $('mov-total').value = qtd && valor ? (qtd*valor).toFixed(2) : '';
        })
    );

    // Distribuição — validação em tempo real
    ['mov-qtd-vendida','mov-qtd-dev-caixa',
     'mov-qtd-cambista','mov-qtd-retorno-origem'].forEach(id => {
        $(id)?.addEventListener('input', () => {
            const total  = Number($('mov-qtd').value || 0);
            const soma   = ['mov-qtd-vendida','mov-qtd-dev-caixa',
                            'mov-qtd-cambista','mov-qtd-retorno-origem']
                .reduce((a,i) => a + Number($(i)?.value || 0), 0);
            const resto  = total - soma;
            const status = $('mov-distribuicao-status');
            if (!status) return;
            if (soma === 0) { status.textContent = ''; return; }
            status.textContent = soma === total
                ? `✓ ${total} distribuídas`
                : resto > 0 ? `Faltam ${resto}` : `Excesso de ${-resto}`;
            status.style.color = soma === total
                ? 'var(--color-text-success)'
                : 'var(--color-text-danger)';
        });
    });

    $('mov-valor-cambista').addEventListener('input', () => {
        const qtd   = Number($('mov-qtd-cambista').value  || 0);
        const valor = Number($('mov-valor-cambista').value || 0);
        const el    = $('mov-cambista-total');
        if (el) el.textContent = qtd && valor ? `= ${fmtMoney(qtd*valor)}` : '';
    });

    // Fechamento
    $('fec-data-ref').value = new Date().toISOString().slice(0, 10);

    $('fec-loteria').addEventListener('change', () => {
        updateFecFederal();
        renderFechamentoResumo();
    });

    $('fec-federal').addEventListener('change', () => {
        const f = lookupFederal($('fec-federal').value);
        $('fec-valor-fracao').value = f ? f.valor_fracao : '';
        $('fec-total').value        = '';
    });

    ['fec-qtd-vendida','fec-valor-fracao'].forEach(id =>
        $(id).addEventListener('input', () => {
            const q = Number($('fec-qtd-vendida').value  || 0);
            const v = Number($('fec-valor-fracao').value || 0);
            $('fec-total').value = q && v ? (q*v).toFixed(2) : '';
        })
    );

    $('btn-salvar-fechamento').addEventListener('click', saveFechamento);
    $('btn-limpar-fechamento').addEventListener('click', () => {
        $('fec-qtd-vendida').value = '';
        $('fec-total').value       = '';
    });

    // Auditoria
    $('btn-filtrar-auditoria').addEventListener('click', renderAuditoria);
    $('btn-recarregar-auditoria').addEventListener('click', refreshAll);
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
bootstrap().then(() => setCadastroDefaults());
