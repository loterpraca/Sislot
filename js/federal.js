/**
 * SISLOT — Federal
 */

const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);
const $ = id => document.getElementById(id);
const fmtMoney = v => 'R$ ' + (Number(v || 0).toFixed(2)).replace('.', ',');
const fmtDate = v => { if (!v) return '—'; const [y, m, d] = String(v).split('-'); return `${d}/${m}/${y}`; };

const state = {
    usuario: null,
    loterias: [],
    usuarios: [],
    federais: [],
    resumo: [],
    movimentos: [],
    vendasFuncionario: [],
    editingCadastroConcurso: null,
    editingMovId: null,
    lancFederalId: null
};

const QTD_PADRAO = {
    qua: { centro: 80, boulevard: 80, lotobel: 60, santa: 0, via: 0 },
    sab: { centro: 80, boulevard: 70, lotobel: 120, santa: 0, via: 0 }
};

// ── Mapeamento slug → logo (mesmos slugs do banco) ─────────
const LOJA_LOGOS = {
    'boulevard':    './icons/boulevard.png',
    'centro':       './icons/loterpraca.png',
    'lotobel':      './icons/lotobel.png',
    'santa-tereza': './icons/santa-tereza.png',
    'via-brasil':   './icons/via-brasil.png',
};

// ══════════════════════════════════════════════════════════
// LOJA-TREE — ciclagem e tema
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

    if (svgAll)     svgAll.style.display  = 'none';
    if (logoImg) {
        logoImg.src           = logo || '';
        logoImg.style.display = logo ? '' : 'none';
    }
    if (!logo && svgAll) svgAll.style.display = ''; // fallback se não tiver logo
    if (headerNome) headerNome.textContent = loteria?.nome || 'Loja';
    document.body.setAttribute('data-loja', slug || 'todas');
}

function ciclarLojaTree() {
    const lojaId  = $('filtro-loja').value;
    const options = [...$('filtro-loja').options].map(o => o.value); // ['', '1', '2', ...]
    const idx     = options.indexOf(lojaId);
    const proximo = options[(idx + 1) % options.length];

    $('filtro-loja').value = proximo;
    atualizarHeaderLoja();
    renderVisao();
}

// ── Relógio ────────────────────────────────────────────────
function setClock() {
    const el = $('relogio');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR') + ' — ' + new Date().toLocaleDateString('pt-BR');
}
setClock();
setInterval(setClock, 1000);

// ── Status ─────────────────────────────────────────────────
function showStatus(id, msg, t = 'ok') {
    const el = $(id);
    if (el) { el.textContent = msg; el.className = `status-bar show ${t}`; }
}
function hideStatus(id) {
    const el = $(id);
    if (el) el.className = 'status-bar';
}

// ── Tabs ───────────────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
}
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ── fillSelect ─────────────────────────────────────────────
function fillSelect(selectId, items, placeholder = 'Selecione...', valueKey = 'id', labelFn = x => x.nome) {
    const sel = $(selectId); if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item[valueKey];
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
    const { data: user } = await sb.from('usuarios').select('id,nome,perfil,ativo').eq('auth_user_id', session.user.id).eq('ativo', true).maybeSingle();
    state.usuario = user;
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
    ['filtro-loja', 'mov-loteria-origem', 'mov-loteria-destino', 'fec-loteria'].forEach(id => fillSelect(id, state.loterias, 'Todas / selecione...', 'id', lotLabel));
    fillSelect('fec-usuario', state.usuarios, 'Selecione...', 'id', x => x.nome);
    atualizarHeaderLoja(); // sincroniza tema após lojas carregadas
}

async function refreshAll() {
    await Promise.all([
        loadFederais(),
        loadResumo(),
        loadMovs(),
        loadVendasFuncionario()
    ]);
    renderCadastro();
    renderVisao();
    renderMovimentacoes();
    renderFechamentoResumo();
    renderAuditoria();
    fillFederalSelectors();
}

// ══════════════════════════════════════════════════════════
// CARREGAMENTO DE DADOS
// ══════════════════════════════════════════════════════════
async function loadFederais() {
    const { data } = await sb.from('federais').select('*').order('dt_sorteio', { ascending: false }).order('concurso', { ascending: false }).order('loteria_id');
    state.federais = data || [];
}

async function loadResumo() {
    const { data, error } = await sb.from('view_resumo_federal').select('*').order('dt_sorteio', { ascending: false }).order('concurso', { ascending: false });
    state.resumo = error ? [] : (data || []);
}

async function loadMovs() {
    const { data } = await sb.from('federal_movimentacoes').select('*, federais!inner(concurso,dt_sorteio,modalidade), usuarios(nome)').order('created_at', { ascending: false });
    state.movimentos = data || [];
}

async function loadVendasFuncionario() {
    const { data } = await sb.from('view_federal_vendas_funcionario').select('*').order('dt_sorteio', { ascending: false }).order('funcionario_nome');
    state.vendasFuncionario = data || [];
}

function fillFederalSelectors() {
    ['mov-federal', 'fec-federal'].forEach(id => fillSelect(id, state.federais, 'Selecione...', 'id', x => `${x.concurso}`));
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function lookupLoteriaName(id) { return state.loterias.find(x => String(x.id) === String(id))?.nome || '—'; }
function lookupFederal(id) { return state.federais.find(x => String(x.id) === String(id)); }

function applyFederalType(tipo) {
    if (tipo === 'ESPECIAL') {
        $('cad-valor-fracao').value = '10.00';
        $('cad-valor-custo').value = '8.04';
    } else {
        $('cad-valor-fracao').value = '4.00';
        $('cad-valor-custo').value = '3.21';
    }
}

function nextWedOrSat(base = new Date()) {
    const d = new Date(base); d.setHours(12, 0, 0, 0);
    while (![3, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

function nextQuaSabFrom(baseIso, dir) {
    let d = new Date((baseIso || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
    d.setDate(d.getDate() + (dir > 0 ? 1 : -1));
    while (![3, 6].includes(d.getDay())) d.setDate(d.getDate() + (dir > 0 ? 1 : -1));
    return d.toISOString().slice(0, 10);
}

function suggestNextConcurso() {
    const nums = state.federais.map(f => parseInt(f.concurso, 10)).filter(n => !isNaN(n));
    return nums.length ? String(Math.max(...nums) + 1) : '';
}

function suggestNextSorteio() {
    if (!state.federais.length) return nextWedOrSat();
    const dates = state.federais.map(f => f.dt_sorteio).filter(Boolean).sort().reverse();
    return nextQuaSabFrom(dates[0], 1);
}

function fillQtdPadraoCadastro() {
    const d = $('cad-dt-sorteio').value ? new Date($('cad-dt-sorteio').value + 'T12:00:00') : new Date();
    const pad = d.getDay() === 6 ? QTD_PADRAO.sab : QTD_PADRAO.qua;
    $('cad-qtd-centro').value = pad.centro;
    $('cad-qtd-boulevard').value = pad.boulevard;
    $('cad-qtd-lotobel').value = pad.lotobel;
    $('cad-qtd-santa').value = pad.santa;
    $('cad-qtd-via').value = pad.via;
}

// ══════════════════════════════════════════════════════════
// RENDER — EXIBIÇÃO
// ══════════════════════════════════════════════════════════
function renderKPIs(rows) {
    const totalInicial = rows.reduce((a, x) => a + Number(x.qtd_inicial || 0), 0);
    const totalVendida = rows.reduce((a, x) => a + Number(x.qtd_vendida_total || 0), 0);
    const totalDev = rows.reduce((a, x) => a + Number(x.qtd_devolvida_origem || 0) + Number(x.qtd_devolvida_terceiros || 0), 0);
    const totalEnc = rows.reduce((a, x) => a + Number(x.qtd_encalhe || 0), 0);
    const totalPrem = rows.reduce((a, x) => a + Number(x.premio_encalhe_total || 0), 0);
    const totalRes = rows.reduce((a, x) => a + Number(x.resultado || 0), 0);
    $('kpis-visao').innerHTML = [
        ['Qtd Inicial', totalInicial, 'Carga base'],
        ['Vendida', totalVendida, 'Funcionários + externa'],
        ['Devolvida', totalDev, 'Origem + terceiros'],
        ['Encalhe', totalEnc, 'Qtd restante sem venda'],
        ['Prêmio', fmtMoney(totalPrem), 'Total de prêmio'],
        ['Resultado', fmtMoney(totalRes), 'Apuração geral']
    ].map(([l, v, s]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-sub">${s}</div></div>`).join('');
}

function renderVisao() {
    let rows = [...state.resumo];
    const c = $('filtro-concurso').value.trim();
    const loja = $('filtro-loja').value;
    const di = $('filtro-dt-ini').value;
    const df = $('filtro-dt-fim').value;
    if (c) rows = rows.filter(x => String(x.concurso).includes(c));
    if (loja) rows = rows.filter(x => String(x.loteria_id) === String(loja));
    if (di) rows = rows.filter(x => x.dt_sorteio >= di);
    if (df) rows = rows.filter(x => x.dt_sorteio <= df);
    renderKPIs(rows);
    $('tbody-visao').innerHTML = rows.length ? rows.map(r => {
        const res = Number(r.resultado || 0);
        return `<tr>
            <td>${r.modalidade || 'Federal'}</td>
            <td>${r.loja_origem}</td>
            <td class="mono">${r.concurso}</td>
            <td class="mono">${fmtDate(r.dt_sorteio)}</td>
            <td class="mono">${r.qtd_inicial}</td>
            <td class="mono">${r.qtd_vendida_funcionarios}</td>
            <td class="mono">${r.qtd_vendida_externa}</td>
            <td class="mono">${r.qtd_devolvida_origem}</td>
            <td class="mono">${r.qtd_devolvida_terceiros}</td>
            <td class="mono">${r.qtd_encalhe}</td>
            <td class="money">${fmtMoney(r.premio_encalhe_total)}</td>
            <td class="mono">${r.estoque_atual}</td>
            <td class="money ${res >= 0 ? 'pos' : 'neg'}">${fmtMoney(res)}</td>
            <td><div class="flex" style="flex-wrap:nowrap;gap:6px">
                <button class="btn-amber" style="padding:6px 10px;font-size:11px" onclick="openFederalDetail('${r.federal_id}')">Detalhar</button>
                <button class="btn-secondary" style="padding:6px 10px;font-size:11px" onclick="openLancamento('${r.federal_id}')">Lançamento</button>
            </div></td>
        </tr>`;
    }).join('') : `<tr><td colspan="14"><div class="empty"><div class="empty-title">Nada encontrado</div><div class="empty-sub">Ajuste os filtros ou cadastre o primeiro concurso.</div></div></td></tr>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — CADASTRO
// ══════════════════════════════════════════════════════════
function renderCadastro() {
    const grupos = Object.values(state.federais.reduce((acc, f) => {
        if (!acc[f.concurso]) acc[f.concurso] = { concurso: f.concurso, dt_sorteio: f.dt_sorteio, valor_fracao: f.valor_fracao, valor_custo: f.valor_custo, qt_fracoes_bilhete: f.qt_fracoes_bilhete, itens: [] };
        acc[f.concurso].itens.push(f);
        return acc;
    }, {})).sort((a, b) => String(b.concurso).localeCompare(String(a.concurso), undefined, { numeric: true }));

    $('cnt-cadastros').textContent = grupos.length;
    $('tbody-cadastro').innerHTML = grupos.length ? grupos.map(g => {
        const tipo = Number(g.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM';
        const totalIni = g.itens.reduce((a, x) => a + Number(x.qtd_recebidas || 0), 0);
        const totalDev = g.itens.reduce((a, x) => a + Number(x.qtd_devolvidas || 0), 0);
        const totalEnc = g.itens.reduce((a, x) => a + Number(x.qtd_encalhe || 0), 0);
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
            <td>
                <div class="flex" style="flex-wrap:nowrap;gap:6px">
                    <button class="btn-amber" onclick="editCadastro('${g.concurso}')">Editar</button>
                    <button class="btn-danger" onclick="deleteCadastro('${g.concurso}')">Excluir</button>
                </div>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="10"><div class="empty"><div class="empty-title">Nenhum concurso cadastrado</div></div></td></tr>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — MOVIMENTAÇÕES
// ══════════════════════════════════════════════════════════
function renderMovimentacoes() {
    $('tbody-mov').innerHTML = state.movimentos.length ? state.movimentos.map(m => {
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
            <td class="money">${fmtMoney(m.valor_total_real || m.valor_total || (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0)))}</td>
            <td><span class="badge ${statusClass}">${m.status_acerto || '—'}</span></td>
            <td>
                <div class="flex" style="flex-wrap:nowrap;gap:6px">
                    <button class="btn-amber" onclick="editMov('${m.id}')">Editar</button>
                    <button class="btn-danger" onclick="deleteMovDirect('${m.id}')">Excluir</button>
                </div>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="11"><div class="empty"><div class="empty-title">Sem movimentações</div></div></td></tr>`;
    applyDestinoFilter();
}

// ══════════════════════════════════════════════════════════
// RENDER — FECHAMENTO
// ══════════════════════════════════════════════════════════
function renderFechamentoResumo() {
    $('tbody-fechamento-resumo').innerHTML = state.vendasFuncionario.length
        ? state.vendasFuncionario.map(v => `<tr>
            <td>${v.funcionario_nome}</td>
            <td class="mono">${v.concurso}</td>
            <td class="mono">${v.qtd_vendida}</td>
            <td class="money">${fmtMoney(v.total_vendido)}</td>
          </tr>`).join('')
        : `<tr><td colspan="4"><div class="empty"><div class="empty-title">Sem vendas lançadas</div></div></td></tr>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — AUDITORIA
// ══════════════════════════════════════════════════════════
function renderAuditoria() {
    let rows = [...state.movimentos];
    const t = $('aud-tipo').value, s = $('aud-status').value, c = $('aud-concurso').value.trim(), di = $('aud-dt-ini').value, df = $('aud-dt-fim').value;
    if (t) rows = rows.filter(x => (x.tipo_evento || x.tipo) === t);
    if (s) rows = rows.filter(x => (x.status_acerto || '') === s);
    if (c) rows = rows.filter(x => String(x.federais?.concurso || '').includes(c));
    if (di) rows = rows.filter(x => String(x.data_mov) >= di);
    if (df) rows = rows.filter(x => String(x.data_mov) <= df);
    $('tbody-auditoria').innerHTML = rows.length ? rows.map(m => {
        const total = Number(m.valor_total_real || m.valor_total || (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0)));
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
            <td>
                <div class="flex" style="flex-wrap:nowrap;gap:6px">
                    <button class="btn-amber" onclick="editMov('${m.id}')">Editar</button>
                    <button class="btn-secondary" onclick="openMovDetail('${m.id}')">Ver</button>
                    <button class="btn-danger" onclick="deleteMovDirect('${m.id}')">Excluir</button>
                </div>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="11"><div class="empty"><div class="empty-title">Sem registros para os filtros</div></div></td></tr>`;
}

// ══════════════════════════════════════════════════════════
// CADASTRO — CRUD
// ══════════════════════════════════════════════════════════
function setCadastroDefaults() {
    state.editingCadastroConcurso = null;
    $('card-form-cadastro').style.display = 'block';
    $('cad-concurso').value = suggestNextConcurso();
    $('cad-dt-sorteio').value = suggestNextSorteio();
    $('cad-tipo').value = 'COMUM';
    applyFederalType('COMUM');
    $('cad-fracoes-bilhete').value = '10';
    fillQtdPadraoCadastro();
}

async function saveCadastro() {
    try {
        const concurso = $('cad-concurso').value.trim();
        const dt_sorteio = $('cad-dt-sorteio').value;
        const valor_fracao = Number($('cad-valor-fracao').value || 0);
        const valor_custo = Number($('cad-valor-custo').value || 0);
        const qt_fracoes_bilhete = Number($('cad-fracoes-bilhete').value || 10);
        if (!concurso || !dt_sorteio) { showStatus('st-cadastro', 'Preencha concurso e data.', 'err'); return; }
        const mapa = [
            { id: 1, qtd: Number($('cad-qtd-centro').value || 0) },
            { id: 2, qtd: Number($('cad-qtd-boulevard').value || 0) },
            { id: 3, qtd: Number($('cad-qtd-lotobel').value || 0) },
            { id: 4, qtd: Number($('cad-qtd-santa').value || 0) },
            { id: 5, qtd: Number($('cad-qtd-via').value || 0) }
        ];

        if (state.editingCadastroConcurso) {
            for (const item of mapa) {
                const { error } = await sb.from('federais').update({
                    concurso, dt_sorteio, valor_fracao, valor_custo, qt_fracoes_bilhete,
                    qtd_recebidas: item.qtd, updated_at: new Date().toISOString()
                }).eq('concurso', state.editingCadastroConcurso).eq('loteria_id', item.id);
                if (error) throw error;
            }
            showStatus('st-cadastro', 'Concurso atualizado em todas as loterias.', 'ok');
        } else {
            for (const item of mapa) {
                const { error } = await sb.from('federais').insert({
                    loteria_id: item.id, modalidade: 'Federal', concurso, dt_sorteio,
                    valor_fracao, valor_custo, qt_fracoes_bilhete, qtd_recebidas: item.qtd,
                    qtd_devolvidas: 0, qtd_encalhe: 0, ativo: true,
                    criado_por: state.usuario?.id || null, updated_at: new Date().toISOString()
                });
                if (error) throw error;
            }
            showStatus('st-cadastro', 'Federais cadastradas para todas as loterias.', 'ok');
        }
        await refreshAll();
        setCadastroDefaults();
    } catch (e) { showStatus('st-cadastro', e.message, 'err'); }
}

window.editCadastro = function (concurso) {
    const itens = state.federais.filter(x => String(x.concurso) === String(concurso));
    const f = itens[0]; if (!f) return;
    state.editingCadastroConcurso = String(concurso);
    $('card-form-cadastro').style.display = 'block';
    $('cad-concurso').value = f.concurso;
    $('cad-dt-sorteio').value = f.dt_sorteio;
    $('cad-tipo').value = Number(f.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM';
    $('cad-valor-fracao').value = f.valor_fracao;
    $('cad-valor-custo').value = f.valor_custo;
    $('cad-fracoes-bilhete').value = f.qt_fracoes_bilhete;
    $('cad-qtd-centro').value = itens.find(x => x.loteria_id === 1)?.qtd_recebidas || 0;
    $('cad-qtd-boulevard').value = itens.find(x => x.loteria_id === 2)?.qtd_recebidas || 0;
    $('cad-qtd-lotobel').value = itens.find(x => x.loteria_id === 3)?.qtd_recebidas || 0;
    $('cad-qtd-santa').value = itens.find(x => x.loteria_id === 4)?.qtd_recebidas || 0;
    $('cad-qtd-via').value = itens.find(x => x.loteria_id === 5)?.qtd_recebidas || 0;
    switchTab('cadastro');
};

window.deleteCadastro = async function (concurso) {
    if (!concurso) return;
    if (!confirm(`Apagar o concurso ${concurso} em todas as loterias?`)) return;
    try {
        const idsFederais = state.federais.filter(x => String(x.concurso) === String(concurso)).map(x => x.id);
        if (idsFederais.length) {
            const { error: ePremio } = await sb.from('federal_encalhe_premio').delete().in('federal_id', idsFederais);
            if (ePremio) throw ePremio;
            const { error: eMov } = await sb.from('federal_movimentacoes').delete().in('federal_id', idsFederais);
            if (eMov) throw eMov;
            const { error: eItensFech } = await sb.from('fechamento_federais').delete().in('federal_id', idsFederais);
            if (eItensFech) throw eItensFech;
        }
        const { error } = await sb.from('federais').delete().eq('concurso', concurso);
        if (error) throw error;
        if (String(state.editingCadastroConcurso || '') === String(concurso)) {
            state.editingCadastroConcurso = null;
            setCadastroDefaults();
        }
        showStatus('st-cadastro', `Concurso ${concurso} excluído.`, 'ok');
        await refreshAll();
    } catch (e) { showStatus('st-cadastro', e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════
// MOVIMENTAÇÃO — CRUD
// ══════════════════════════════════════════════════════════
async function saveMov() {
    try {
        const federal = lookupFederal($('mov-federal').value);
        const valor = Number($('mov-valor').value || 0);
        const qtd = Number($('mov-qtd').value || 0);
        const tipoEvento = $('mov-tipo-evento').value;
        const payload = {
            federal_id: $('mov-federal').value,
            loteria_origem: Number($('mov-loteria-origem').value || 0) || null,
            loteria_destino: Number($('mov-loteria-destino').value || 0) || null,
            tipo: tipoEvento === 'TRANSFERENCIA' ? 'ENVIO' : 'DEVOLUCAO_EXTERNA',
            tipo_evento: tipoEvento,
            qtd_fracoes: qtd,
            valor_fracao: valor,
            valor_fracao_ref: Number(federal?.valor_fracao || 0),
            valor_fracao_real: valor,
            valor_a_acertar: 0,
            status_acerto: state.editingMovId ? ($('mov-status-acerto').value || 'PENDENTE') : 'PENDENTE',
            data_mov: new Date().toISOString().slice(0, 10),
            observacao: $('mov-observacao').value.trim() || null,
            criado_por: state.usuario?.id || null,
            updated_at: new Date().toISOString(),
            editado_por: state.editingMovId ? state.usuario?.id : null,
            editado_em: state.editingMovId ? new Date().toISOString() : null
        };
        if (!payload.federal_id || !payload.tipo_evento || !payload.qtd_fracoes || !payload.loteria_origem) {
            showStatus('st-mov', 'Preencha concurso, origem, evento e quantidade.', 'err'); return;
        }
        if (payload.tipo_evento === 'TRANSFERENCIA' && !payload.loteria_destino) {
            showStatus('st-mov', 'Selecione a loja destino.', 'err'); return;
        }
        if (state.editingMovId) {
            const { error } = await sb.from('federal_movimentacoes').update(payload).eq('id', state.editingMovId);
            if (error) throw error;
            showStatus('st-mov', 'Movimentação atualizada.', 'ok');
        } else {
            const { error } = await sb.from('federal_movimentacoes').insert(payload);
            if (error) throw error;
            showStatus('st-mov', 'Movimentação registrada.', 'ok');
        }
        state.editingMovId = null;
        clearMov();
        await refreshAll();
    } catch (e) { showStatus('st-mov', e.message, 'err'); }
}

function clearMov() {
    state.editingMovId = null;
    $('mov-federal').value = '';
    $('mov-modalidade').value = 'Federal';
    $('mov-loteria-origem').value = '';
    $('mov-loteria-destino').value = '';
    $('mov-dt-concurso').value = '';
    $('mov-tipo-evento').value = 'TRANSFERENCIA';
    $('mov-qtd').value = '';
    $('mov-valor').value = '';
    $('mov-total').value = '';
    $('mov-status-acerto').value = 'PENDENTE';
    $('mov-observacao').value = '';
    $('btn-excluir-mov').style.display = 'none';
}

window.editMov = function (id) {
    const m = state.movimentos.find(x => String(x.id) === String(id)); if (!m) return;
    state.editingMovId = id;
    switchTab('movimentacao');
    $('mov-federal').value = m.federal_id;
    $('mov-modalidade').value = 'Federal';
    $('mov-loteria-origem').value = m.loteria_origem || '';
    $('mov-loteria-destino').value = m.loteria_destino || '';
    $('mov-dt-concurso').value = lookupFederal(m.federal_id)?.dt_sorteio || '';
    $('mov-tipo-evento').value = m.tipo_evento || 'TRANSFERENCIA';
    $('mov-qtd').value = m.qtd_fracoes;
    $('mov-valor').value = m.valor_fracao_real || m.valor_fracao || '';
    const total = m.valor_total_real || m.valor_total || (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0));
    $('mov-total').value = Number(total).toFixed(2);
    $('mov-status-acerto').value = m.status_acerto || 'PENDENTE';
    $('mov-observacao').value = m.observacao || '';
    $('btn-excluir-mov').style.display = 'inline-flex';
};

async function deleteMov() {
    if (!state.editingMovId) return;
    if (!confirm('Apagar esta linha de movimentação?')) return;
    try {
        const { error } = await sb.from('federal_movimentacoes').delete().eq('id', state.editingMovId);
        if (error) throw error;
        showStatus('st-mov', 'Movimentação apagada.', 'ok');
        clearMov();
        await refreshAll();
    } catch (e) { showStatus('st-mov', e.message, 'err'); }
}

window.deleteMovDirect = async function (id) {
    if (!id) return;
    if (!confirm('Apagar esta linha de movimentação?')) return;
    try {
        const { error } = await sb.from('federal_movimentacoes').delete().eq('id', id);
        if (error) throw error;
        if (String(state.editingMovId || '') === String(id)) clearMov();
        closeDrawer();
        showStatus('st-mov', 'Movimentação apagada.', 'ok');
        showStatus('st-auditoria', 'Movimentação apagada.', 'ok');
        await refreshAll();
    } catch (e) { showStatus('st-mov', e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════
// FECHAMENTO — CRUD
// ══════════════════════════════════════════════════════════
async function saveFechamento() {
    try {
        const usuario = state.usuarios.find(x => String(x.id) === String($('fec-usuario').value));
        if (!$('fec-loteria').value || !$('fec-usuario').value || !$('fec-data-ref').value || !$('fec-federal').value) {
            showStatus('st-fechamento', 'Preencha loja, funcionário, data e concurso.', 'err'); return;
        }
        const totalFed = Number($('fec-total').value || 0);
        const header = {
            loteria_id: Number($('fec-loteria').value),
            usuario_id: Number($('fec-usuario').value),
            funcionario_nome: usuario?.nome || 'Funcionário',
            data_ref: $('fec-data-ref').value,
            troco_inicial: 0, troco_sobra: 0, relatorio: 0, deposito: 0, pix_cnpj: 0,
            diferenca_pix: 0, premio_raspadinha: 0, resgate_telesena: 0, total_produtos: 0,
            total_federais: totalFed, total_boloes: 0, total_fiado: 0, total_debitos: 0,
            total_creditos: 0, quebra: 0,
            criado_por: state.usuario?.id || null,
            updated_at: new Date().toISOString()
        };
        const { data: fHeader, error: eHeader } = await sb.from('fechamentos').insert(header).select('id').single();
        if (eHeader) throw eHeader;
        const federal = lookupFederal($('fec-federal').value);
        const { error: eItem } = await sb.from('fechamento_federais').insert({
            fechamento_id: fHeader.id,
            federal_id: $('fec-federal').value,
            modalidade: 'Federal',
            concurso: federal?.concurso || '',
            dt_sorteio: federal?.dt_sorteio || null,
            valor_fracao: Number($('fec-valor-fracao').value || 0),
            qtd_vendida: Number($('fec-qtd-vendida').value || 0),
            total: Number($('fec-total').value || 0)
        });
        if (eItem) throw eItem;
        showStatus('st-fechamento', 'Venda do funcionário registrada.', 'ok');
        $('fec-qtd-vendida').value = '';
        $('fec-total').value = '';
        await refreshAll();
    } catch (e) { showStatus('st-fechamento', e.message, 'err'); }
}

// ══════════════════════════════════════════════════════════
// LANÇAMENTO (drawer)
// ══════════════════════════════════════════════════════════
window.openLancamento = function (federalId) {
    const f = lookupFederal(federalId); if (!f) return;
    state.lancFederalId = federalId;
    $('lanc-modalidade').value = 'Federal';
    $('lanc-concurso').value = f.concurso;
    $('lanc-data').value = f.dt_sorteio;
    $('lanc-loja').value = lookupLoteriaName(f.loteria_id);
    $('lanc-qtd-dev').value = f.qtd_devolvidas || 0;
    $('lanc-qtd-enc').value = f.qtd_encalhe || 0;
    $('lanc-vlr-premio').value = '';
    $('lanc-obs').value = '';
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
        const qtdDev = Number($('lanc-qtd-dev').value || 0);
        const qtdEnc = Number($('lanc-qtd-enc').value || 0);
        const premio = Number($('lanc-vlr-premio').value || 0);
        const obs = $('lanc-obs').value.trim() || null;

        const { error: e1 } = await sb.from('federais').update({
            qtd_devolvidas: qtdDev,
            qtd_encalhe: qtdEnc,
            updated_at: new Date().toISOString()
        }).eq('id', state.lancFederalId);
        if (e1) throw e1;

        if (premio > 0) {
            const { data: premioExistente, error: eBusca } = await sb
                .from('federal_encalhe_premio')
                .select('id')
                .eq('federal_id', state.lancFederalId)
                .order('created_at', { ascending: false })
                .limit(1);
            if (eBusca) throw eBusca;

            if (premioExistente && premioExistente.length) {
                const { error: e2 } = await sb.from('federal_encalhe_premio').update({
                    qtd_fracoes_premiadas: qtdEnc || 1,
                    valor_premio: premio,
                    observacao: obs,
                    data_registro: new Date().toISOString().slice(0, 10)
                }).eq('id', premioExistente[0].id);
                if (e2) throw e2;
            } else {
                const { error: e3 } = await sb.from('federal_encalhe_premio').insert({
                    federal_id: state.lancFederalId,
                    qtd_fracoes_premiadas: qtdEnc || 1,
                    valor_premio: premio,
                    observacao: obs,
                    criado_por: state.usuario?.id || null
                });
                if (e3) throw e3;
            }
        }
        showStatus('st-visao', 'Lançamento salvo.', 'ok');
        closeLancamento();
        await refreshAll();
    } catch (e) { showStatus('st-visao', e.message, 'err'); }
}

// ══════════════════════════════════════════════════════════
// DRAWERS — DETALHE
// ══════════════════════════════════════════════════════════
window.openFederalDetail = function (federalId) {
    const resumo = state.resumo.find(x => String(x.federal_id) === String(federalId));
    const vendas = state.vendasFuncionario.filter(x => String(x.federal_id) === String(federalId));
    const movs = state.movimentos.filter(x => String(x.federal_id) === String(federalId));
    openDrawer(
        `Federal ${resumo?.concurso || ''}`,
        `${resumo?.loja_origem || ''} • ${fmtDate(resumo?.dt_sorteio)}`,
        `<div class="card" style="margin-bottom:14px">
            <div class="inline-pills">
                <span class="pill">Modalidade ${resumo?.modalidade || 'Federal'}</span>
                <span class="pill">Qtd inicial ${resumo?.qtd_inicial ?? 0}</span>
                <span class="pill">Vend. func ${resumo?.qtd_vendida_funcionarios ?? 0}</span>
                <span class="pill">Vend. externa ${resumo?.qtd_vendida_externa ?? 0}</span>
                <span class="pill">Dev. origem ${resumo?.qtd_devolvida_origem ?? 0}</span>
                <span class="pill">Dev. terceiros ${resumo?.qtd_devolvida_terceiros ?? 0}</span>
                <span class="pill">Encalhe ${resumo?.qtd_encalhe ?? 0}</span>
                <span class="pill">Resultado ${fmtMoney(resumo?.resultado || 0)}</span>
            </div>
        </div>
        <div class="sep"><span class="sep-label">Vendas por funcionário</span><div class="sep-line"></div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Funcionário</th><th>Qtd</th><th>Total</th></tr></thead><tbody>
            ${vendas.length ? vendas.map(v => `<tr><td>${v.funcionario_nome}</td><td class="mono">${v.qtd_vendida}</td><td class="money">${fmtMoney(v.total_vendido)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">Sem vendas lançadas</td></tr>'}
        </tbody></table></div>
        <div class="sep"><span class="sep-label">Eventos</span><div class="sep-line"></div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Evento</th><th>Origem</th><th>Destino</th><th>Qtd</th><th>Total</th></tr></thead><tbody>
            ${movs.length ? movs.map(m => `<tr><td>${m.tipo_evento || m.tipo}</td><td>${lookupLoteriaName(m.loteria_origem)}</td><td>${m.loteria_destino ? lookupLoteriaName(m.loteria_destino) : '—'}</td><td class="mono">${m.qtd_fracoes}</td><td class="money">${fmtMoney(m.valor_total_real || m.valor_total || (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0)))}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">Sem eventos</td></tr>'}
        </tbody></table></div>`,
        [{ label: 'Fechar', kind: 'secondary', onClick: closeDrawer }]
    );
};

window.openMovDetail = function (id) {
    const m = state.movimentos.find(x => String(x.id) === String(id)); if (!m) return;
    openDrawer(
        `Movimentação ${m.tipo_evento || m.tipo}`,
        `${m.federais?.modalidade || 'Federal'} • Concurso ${m.federais?.concurso || '—'}`,
        `<div class="grid-2">
            <div class="soft-card"><div class="field-label">Origem</div><div>${lookupLoteriaName(m.loteria_origem)}</div></div>
            <div class="soft-card"><div class="field-label">Destino</div><div>${m.loteria_destino ? lookupLoteriaName(m.loteria_destino) : '—'}</div></div>
            <div class="soft-card"><div class="field-label">Quantidade</div><div class="mono">${m.qtd_fracoes}</div></div>
            <div class="soft-card"><div class="field-label">Status</div><div>${m.status_acerto || '—'}</div></div>
            <div class="soft-card"><div class="field-label">Valor fração</div><div class="money">${fmtMoney(m.valor_fracao_real || m.valor_fracao)}</div></div>
            <div class="soft-card"><div class="field-label">Valor total</div><div class="money">${fmtMoney(m.valor_total_real || m.valor_total || (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0)))}</div></div>
            <div class="soft-card"><div class="field-label">Data do concurso</div><div class="mono">${fmtDate(lookupFederal(m.federal_id)?.dt_sorteio)}</div></div>
            <div class="soft-card"><div class="field-label">Carimbo</div><div class="mono">${new Date(m.created_at).toLocaleString('pt-BR')}</div></div>
        </div>
        <div class="card" style="margin-top:14px"><div class="field-label">Observação</div><div style="margin-top:8px">${m.observacao || '—'}</div></div>`,
        [
            { label: 'Editar', kind: 'amber', onClick: () => { closeDrawer(); editMov(id); } },
            { label: 'Fechar', kind: 'secondary', onClick: closeDrawer }
        ]
    );
};

function openDrawer(title, sub, bodyHtml, actions = []) {
    $('drawer-title').textContent = title;
    $('drawer-sub').textContent = sub;
    $('drawer-body').innerHTML = bodyHtml;
    $('drawer-foot').innerHTML = '';
    actions.forEach(a => {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.className = a.kind === 'primary' ? 'btn-primary' : a.kind === 'amber' ? 'btn-amber' : a.kind === 'danger' ? 'btn-danger' : 'btn-secondary';
        b.onclick = a.onClick;
        $('drawer-foot').appendChild(b);
    });
    $('overlay').classList.add('show');
    $('drawer').classList.add('open');
}
function closeDrawer() { $('overlay').classList.remove('show'); $('drawer').classList.remove('open'); }
window.closeDrawer = closeDrawer;

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

    // Loja-tree — cicla e troca tema
    const lojaTree = $('lojaTreeWrap');
    if (lojaTree) lojaTree.addEventListener('click', ciclarLojaTree);

    // Exibição — filtros
    $('btn-limpar-visao').addEventListener('click', () => {
        ['filtro-concurso', 'filtro-loja', 'filtro-dt-ini', 'filtro-dt-fim'].forEach(id => $(id).value = '');
        atualizarHeaderLoja();
        renderVisao();
    });
    $('btn-recarregar-visao').addEventListener('click', refreshAll);

    // Sincroniza tema quando filtro-loja muda manualmente pelo select
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
        $('cad-dt-sorteio').value = nextQuaSabFrom($('cad-dt-sorteio').value || suggestNextSorteio(), -1);
        fillQtdPadraoCadastro();
    });
    $('cad-data-next').addEventListener('click', () => {
        $('cad-dt-sorteio').value = nextQuaSabFrom($('cad-dt-sorteio').value || suggestNextSorteio(), 1);
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
        if (!f) { $('mov-resumo-selec').innerHTML = '<div class="empty-title">Selecione um concurso</div>'; return; }
        $('mov-modalidade').value = 'Federal';
        $('mov-loteria-origem').value = f.loteria_id;
        applyDestinoFilter();
        $('mov-dt-concurso').value = f.dt_sorteio;
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
    ['mov-qtd', 'mov-valor'].forEach(id => $(id).addEventListener('input', () => {
        const qtd = Number($('mov-qtd').value || 0), valor = Number($('mov-valor').value || 0);
        $('mov-total').value = qtd && valor ? (qtd * valor).toFixed(2) : '';
    }));
    $('mov-tipo-evento').addEventListener('change', syncMovValorByTipo);

    // Fechamento
    $('fec-data-ref').value = new Date().toISOString().slice(0, 10);
    $('fec-federal').addEventListener('change', () => {
        const f = lookupFederal($('fec-federal').value);
        if (f) $('fec-valor-fracao').value = f.valor_fracao;
    });
    ['fec-qtd-vendida', 'fec-valor-fracao'].forEach(id => $(id).addEventListener('input', () => {
        const q = Number($('fec-qtd-vendida').value || 0), v = Number($('fec-valor-fracao').value || 0);
        $('fec-total').value = q && v ? (q * v).toFixed(2) : '';
    }));
    $('btn-salvar-fechamento').addEventListener('click', saveFechamento);
    $('btn-limpar-fechamento').addEventListener('click', () => {
        $('fec-qtd-vendida').value = '';
        $('fec-total').value = '';
    });

    // Auditoria
    $('btn-filtrar-auditoria').addEventListener('click', renderAuditoria);
    $('btn-recarregar-auditoria').addEventListener('click', refreshAll);
}

// ══════════════════════════════════════════════════════════
// HELPERS DE MOVIMENTAÇÃO
// ══════════════════════════════════════════════════════════
function syncMovValorByTipo() {
    const f = lookupFederal($('mov-federal').value); if (!f) return;
    const tipo = $('mov-tipo-evento').value;
    if (tipo === 'DEVOLUCAO_CAIXA') {
        $('mov-valor').value = f.valor_custo;
    } else if (tipo === 'VENDA_CAMBISTA') {
        $('mov-valor').value = '';
    } else {
        $('mov-valor').value = f.valor_fracao;
    }
    $('mov-status-acerto').value = 'PENDENTE';
    const qtd = Number($('mov-qtd').value || 0), valor = Number($('mov-valor').value || 0);
    $('mov-total').value = qtd && valor ? (qtd * valor).toFixed(2) : '';
}

function applyDestinoFilter() {
    const origem = $('mov-loteria-origem')?.value;
    const sel = $('mov-loteria-destino');
    if (!sel) return;
    [...sel.options].forEach(opt => {
        if (!opt.value) { opt.hidden = false; return; }
        opt.hidden = !!origem && opt.value === origem;
    });
    if (origem && sel.value === origem) sel.value = '';
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
bootstrap().then(() => setCadastroDefaults());
