/**
 * SISLOT — Controle Financeiro
 * Lê direto de federal_movimentacoes e movimentacoes_cotas
 * sem tabela intermediária — status_acerto em cada tabela
 */

const sb  = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);
const $   = id => document.getElementById(id);
const fmtMoney = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
const fmtDate  = v => {
    if (!v) return '—';
    const [y,m,d] = String(v).split('-');
    return `${d}/${m}/${y}`;
};
const fmtMes = mesIso => {
    if (!mesIso) return '—';
    const [y, m] = mesIso.split('-');
    const n = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${n[parseInt(m,10)-1]}/${y}`;
};
const mesDeData = iso => iso ? iso.slice(0,7) + '-01' : '';

// ── Lojas ────────────────────────────────────────────────
const LOJAS = [
    { slug:'boulevard',    nome:'Boulevard',    logo:'./icons/boulevard.png'    },
    { slug:'centro',       nome:'Centro',       logo:'./icons/loterpraca.png'   },
    { slug:'lotobel',      nome:'Lotobel',      logo:'./icons/lotobel.png'      },
    { slug:'santa-tereza', nome:'Santa Tereza', logo:'./icons/santa-tereza.png' },
    { slug:'via-brasil',   nome:'Via Brasil',   logo:'./icons/via-brasil.png'   },
];

const PRODUTO_COR = { FEDERAL:'#38bdf8', BOLAO:'#a78bfa' };

// ── Estado ───────────────────────────────────────────────
const state = {
    usuario:       null,
    loterias:      [],
    fedMovs:       [],   // federal_movimentacoes (TRANSFERENCIA entre lojas)
    bolaoMovs:     [],   // movimentacoes_cotas (ATIVO)
    lojaFiltro:    '',   // id da loja filtrada pela loja-tree
};

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
// TABS
// ══════════════════════════════════════════════════════════
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `panel-${tab}`));
    if (tab === 'movimentacoes') renderMovimentacoes();
}
document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ══════════════════════════════════════════════════════════
// LOJA-TREE — ciclagem e tema
// ══════════════════════════════════════════════════════════
function atualizarHeaderLoja() {
    const logoImg    = $('logoImg');
    const svgAll     = $('lojaTreeAll');
    const headerNome = $('headerNome');
    const lojaId     = state.lojaFiltro;

    if (!lojaId) {
        if (svgAll)     svgAll.style.display  = '';
        if (logoImg)    logoImg.style.display  = 'none';
        if (headerNome) headerNome.textContent = 'Todas as Lojas';
        document.body.setAttribute('data-loja', 'todas');
        return;
    }

    const loteria  = state.loterias.find(x => String(x.id) === String(lojaId));
    const slug     = loteria?.slug || '';
    const lojaInfo = LOJAS.find(l => l.slug === slug);

    if (lojaInfo) {
        if (svgAll)  svgAll.style.display  = 'none';
        if (logoImg) { logoImg.src = lojaInfo.logo; logoImg.style.display = ''; }
        if (headerNome) headerNome.textContent = lojaInfo.nome;
        document.body.setAttribute('data-loja', slug);
    }
}

function ciclarLojaTree() {
    // Lojas presentes nas movimentações
    const idsPresentes = new Set([
        ...state.fedMovs.map(m => String(m.loteria_origem)),
        ...state.fedMovs.map(m => String(m.loteria_destino)).filter(Boolean),
        ...state.bolaoMovs.map(m => String(m.loteria_origem)),
        ...state.bolaoMovs.map(m => String(m.loteria_destino)).filter(Boolean),
    ]);
    const lojasPres = state.loterias.filter(l => idsPresentes.has(String(l.id)));
    const ciclo     = [null, ...lojasPres];
    const idxAtual  = ciclo.findIndex(l =>
        l === null ? !state.lojaFiltro : String(l.id) === state.lojaFiltro
    );
    const proximo    = ciclo[(idxAtual + 1) % ciclo.length];
    state.lojaFiltro = proximo ? String(proximo.id) : '';

    atualizarHeaderLoja();
    renderSaldo();
    renderMovimentacoes();
}

// ══════════════════════════════════════════════════════════
// BOOTSTRAP
// ══════════════════════════════════════════════════════════
async function bootstrap() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = './login.html'; return; }

    const { data: user } = await sb
        .from('usuarios').select('id,nome,perfil,ativo')
        .eq('auth_user_id', session.user.id).eq('ativo', true).maybeSingle();

    if (!user || !['ADMIN','SOCIO'].includes(user.perfil)) {
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;
                        height:100vh;flex-direction:column;gap:12px;color:#8fa3c8">
                <div style="font-size:18px;font-weight:600">Acesso restrito</div>
                <div style="font-size:13px;opacity:.6">Disponível apenas para sócios e administradores.</div>
                <button onclick="location.href='./menu.html'"
                    style="margin-top:8px;padding:8px 16px;border-radius:8px;
                           background:#132952;border:1px solid #1e3a6e;
                           color:#8fa3c8;cursor:pointer;font-size:12px">
                    Voltar ao menu
                </button>
            </div>`;
        return;
    }
    state.usuario = user;

    const { data: lojas } = await sb
        .from('loterias').select('id,nome,slug').eq('ativo',true).order('nome');
    state.loterias = lojas || [];

    // Loja-tree
    const lojaTree = $('lojaTreeWrap');
    if (lojaTree) lojaTree.addEventListener('click', ciclarLojaTree);

    // Filtros da aba Saldo
    ['saldo-periodo','saldo-mes','saldo-produto','saldo-status'].forEach(id => {
        $(id)?.addEventListener('change', () => {
            if (id === 'saldo-periodo') {
                const wrap = $('wrap-saldo-mes');
                if (wrap) wrap.style.display = $(id).value === 'total' ? 'none' : '';
            }
            renderSaldo();
        });
    });

    // Botão pagar tudo
    $('btn-pagar-tudo')?.addEventListener('click', pagarTudo);

    // Filtros da aba Movimentações
    ['mov-produto','mov-origem','mov-destino','mov-mes','mov-status'].forEach(id => {
        $(id)?.addEventListener('change', renderMovimentacoes);
    });
    $('btn-limpar-mov')?.addEventListener('click', () => {
        ['mov-produto','mov-origem','mov-destino','mov-mes','mov-status']
            .forEach(id => { const el=$(id); if(el) el.value=''; });
        renderMovimentacoes();
    });

    await refreshAll();
}

// ══════════════════════════════════════════════════════════
// LOAD
// ══════════════════════════════════════════════════════════
async function refreshAll() {
    await Promise.all([loadFederal(), loadBolao()]);
    preencherSelectsMes();
    preencherSelectsLojas();
    renderSaldo();
    renderMovimentacoes();
}

async function loadFederal() {
    // Só TRANSFERENCIA entre lojas distintas gera acerto financeiro
    const { data } = await sb
        .from('federal_movimentacoes')
        .select(`
            id, tipo_evento, loteria_origem, loteria_destino,
            qtd_fracoes, valor_fracao, valor_fracao_ref, valor_custo,
            qtd_vendida, qtd_devolucao_caixa, qtd_venda_cambista,
            valor_cambista, qtd_retorno_origem,
            status_acerto, data_acerto, data_mov, created_at,
            federais!inner(concurso, dt_sorteio, valor_fracao, valor_custo)
        `)
        .eq('tipo_evento', 'TRANSFERENCIA')
        .not('loteria_destino', 'is', null)
        .order('created_at', { ascending: false });

    state.fedMovs = (data || []).map(m => ({
        ...m,
        produto:      'FEDERAL',
        // Valor real do acerto = distribuição × valores corretos
        valor_acerto: calcValorAcertoFederal(m),
        mes_ref:      mesDeData(m.data_mov || m.created_at?.slice(0,10)),
        ref_label:    `Concurso ${m.federais?.concurso || '—'}`,
    }));
}

function calcValorAcertoFederal(m) {
    const fracao = Number(m.federais?.valor_fracao || m.valor_fracao || 0);
    const custo  = Number(m.federais?.valor_custo  || m.valor_custo  || 0);
    return (Number(m.qtd_vendida         || 0) * fracao)
         + (Number(m.qtd_devolucao_caixa || 0) * custo)
         + (Number(m.qtd_venda_cambista  || 0) * Number(m.valor_cambista || 0));
}

async function loadBolao() {
    const { data } = await sb
        .from('movimentacoes_cotas')
        .select(`
            id, bolao_id, loteria_origem, loteria_destino,
            qtd_cotas, valor_unitario,
            status_acerto, data_acerto, created_at,
            boloes(modalidade, concurso)
        `)
        .eq('status', 'ATIVO')
        .not('loteria_destino', 'is', null)
        .order('created_at', { ascending: false });

    state.bolaoMovs = (data || []).map(m => ({
        ...m,
        produto:      'BOLAO',
        valor_acerto: Number(m.qtd_cotas) * Number(m.valor_unitario || 0),
        mes_ref:      mesDeData(m.created_at?.slice(0,10)),
        ref_label:    `${m.boloes?.modalidade || 'Bolão'} #${m.boloes?.concurso || '—'}`,
    }));
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function lookupLoja(id) {
    return state.loterias.find(x => String(x.id) === String(id))?.nome || `Loja ${id}`;
}

function todasMovs() {
    return [...state.fedMovs, ...state.bolaoMovs];
}

function preencherSelectsMes() {
    const meses = [...new Set(todasMovs().map(m => m.mes_ref).filter(Boolean))].sort().reverse();
    const sels  = ['saldo-mes','mov-mes'];
    sels.forEach(id => {
        const sel = $(id); if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = `<option value="">${id === 'saldo-mes' ? 'Todos os meses' : 'Todos'}</option>`;
        meses.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = fmtMes(m);
            if (m === cur || (!cur && m === meses[0] && id === 'saldo-mes')) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

function preencherSelectsLojas() {
    const ids = new Set(todasMovs().flatMap(m =>
        [String(m.loteria_origem), String(m.loteria_destino)].filter(Boolean)
    ));
    const lojas = state.loterias.filter(l => ids.has(String(l.id)));
    ['mov-origem','mov-destino'].forEach(id => {
        const sel = $(id); if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = `<option value="">Todas</option>`;
        lojas.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id; opt.textContent = l.nome;
            if (String(l.id) === cur) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

// ══════════════════════════════════════════════════════════
// RENDER — ABA SALDO
// ══════════════════════════════════════════════════════════
function renderSaldo() {
    const periodo = $('saldo-periodo')?.value || 'mes';
    const mesRef  = $('saldo-mes')?.value     || '';
    const produto = $('saldo-produto')?.value || '';
    const status  = $('saldo-status')?.value  || 'PENDENTE';

    // Filtra movimentações
    let movs = todasMovs().filter(m => {
        if (produto && m.produto !== produto) return false;
        if (status  && m.status_acerto !== status) return false;
        if (mesRef  && m.mes_ref !== mesRef) return false;
        // Filtro de loja-tree — aparece se é origem ou destino da loja selecionada
        if (state.lojaFiltro) {
            const id = String(state.lojaFiltro);
            if (String(m.loteria_origem) !== id && String(m.loteria_destino) !== id) return false;
        }
        return true;
    });

    // Agrupa por par de lojas (+ mês se modo "por mês", + produto)
    const pares = {};
    movs.forEach(m => {
        if (m.valor_acerto === 0) return;

        const [a, b] = [m.loteria_origem, m.loteria_destino].map(Number).sort((x,y) => x-y);
        const mes    = periodo === 'mes' ? m.mes_ref : 'total';
        const chave  = `${a}_${b}_${mes}_${m.produto}`;

        if (!pares[chave]) pares[chave] = {
            a, b, mes, produto: m.produto,
            saldo:       0,
            qtdMovs:     0,
            temPendente: false,
            temPago:     false,
        };

        // Se origem === a: a enviou para b → b deve para a → saldo positivo
        pares[chave].saldo   += m.loteria_origem === a ? m.valor_acerto : -m.valor_acerto;
        pares[chave].qtdMovs += 1;
        if (m.status_acerto === 'PENDENTE') pares[chave].temPendente = true;
        else                                pares[chave].temPago     = true;
    });

    const cards = Object.values(pares)
        .filter(p => Math.abs(p.saldo) > 0.001)
        .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));

    // KPIs
    const totalPendente = movs
        .filter(m => m.status_acerto === 'PENDENTE' && m.valor_acerto > 0)
        .reduce((a, m) => a + m.valor_acerto, 0);
    const totalPago = movs
        .filter(m => m.status_acerto === 'PAGO' && m.valor_acerto > 0)
        .reduce((a, m) => a + m.valor_acerto, 0);
    const qtdPendente = cards.filter(p => p.temPendente).length;
    const qtdQuitado  = cards.filter(p => !p.temPendente && p.temPago).length;

    $('kpis-saldo').innerHTML = [
        { l:'Total pendente', v:fmtMoney(totalPendente), s:`${qtdPendente} relação(ões)`,    cor:'var(--amber)' },
        { l:'Total quitado',  v:fmtMoney(totalPago),     s:`${qtdQuitado} relação(ões)`,     cor:'var(--accent)' },
        { l:'Pares',          v:cards.length,             s:'com movimentação',               cor:'var(--sky)' },
        { l:'Referência',     v:mesRef ? fmtMes(mesRef) : periodo === 'total' ? 'Acumulado' : 'Todos', s:'período', cor:'var(--purple)' },
    ].map(({ l, v, s, cor }) => `
        <div class="kpi" style="--kpi-color:${cor}">
            <div class="kpi-label">${l}</div>
            <div class="kpi-value">${v}</div>
            <div class="kpi-sub">${s}</div>
        </div>`
    ).join('');

    // Label do sep
    const sepLabel = $('sep-label-saldo');
    if (sepLabel) {
        sepLabel.textContent = periodo === 'total'
            ? 'Saldo total acumulado por par de lojas'
            : mesRef
                ? `Saldo de ${fmtMes(mesRef)} por par de lojas`
                : 'Saldo por par de lojas — todos os meses';
    }
    const sepCount = $('saldo-count');
    if (sepCount) sepCount.textContent = cards.length;

    // Cards
    $('cards-saldo').innerHTML = cards.length
        ? cards.map(p => buildCard(p, mesRef)).join('')
        : `<div class="empty">
            <div class="empty-title">Nenhum registro encontrado</div>
            <div class="empty-sub">Ajuste os filtros ou aguarde novas movimentações.</div>
           </div>`;
}

function buildCard(p, mesRef) {
    const pagador   = p.saldo > 0 ? p.b : p.a;   // quem deve pagar (devedor)
    const recebedor = p.saldo > 0 ? p.a : p.b;   // quem vai receber (credor)
    const valor     = Math.abs(p.saldo);
    const quitado   = !p.temPendente && p.temPago;
    const parcial   = p.temPendente && p.temPago;

    const statusBadge = quitado
        ? `<span class="badge b-ok">PAGO</span>`
        : parcial
            ? `<span class="badge b-info">PARCIAL</span>`
            : `<span class="badge b-warn">PENDENTE</span>`;

    const corCard = quitado ? 'var(--accent)' : parcial ? 'var(--sky)' : 'var(--amber)';

    const corProduto = PRODUTO_COR[p.produto] || 'var(--muted)';
    const produtoBadge = `<div class="rel-card-produto"
        style="background:${corProduto}18;color:${corProduto};border:1px solid ${corProduto}40">
        ${p.produto}
    </div>`;

    const mesLabel = p.mes !== 'total' ? `· ${fmtMes(p.mes)}` : '· Acumulado';

    const btnAction = !quitado
        ? `<button class="btn-primary"
               onclick="pagarPar(${pagador},${recebedor},'${p.mes}','${p.produto}')">
               Marcar como pago
           </button>`
        : `<button class="btn-secondary" disabled>Quitado ✓</button>`;

    return `
    <div class="rel-card" style="--card-color:${corCard}">
        <div class="rel-card-head">
            <div>
                <div class="rel-card-lojas">
                    ${lookupLoja(pagador)}
                    <span class="rel-card-seta">→</span>
                    ${lookupLoja(recebedor)}
                </div>
                <div class="rel-card-meta">${p.qtdMovs} movimentação(ões) ${mesLabel}</div>
                ${produtoBadge}
            </div>
            ${statusBadge}
        </div>

        <div class="rel-card-valor">
            <div>
                <div class="rel-card-valor-label">
                    ${lookupLoja(pagador)} paga ${lookupLoja(recebedor)}
                </div>
                <div class="rel-card-valor-num" style="color:${quitado ? 'var(--accent)' : 'var(--amber)'}">
                    ${fmtMoney(valor)}
                </div>
            </div>
            <div class="rel-card-foot">${btnAction}</div>
        </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — ABA MOVIMENTAÇÕES
// ══════════════════════════════════════════════════════════
function renderMovimentacoes() {
    const produto  = $('mov-produto')?.value  || '';
    const origemId = $('mov-origem')?.value   || '';
    const destId   = $('mov-destino')?.value  || '';
    const mesRef   = $('mov-mes')?.value      || '';
    const status   = $('mov-status')?.value   || '';

    let movs = todasMovs().filter(m => {
        if (produto  && m.produto         !== produto)          return false;
        if (origemId && String(m.loteria_origem) !== String(origemId)) return false;
        if (destId   && String(m.loteria_destino) !== String(destId))  return false;
        if (mesRef   && m.mes_ref         !== mesRef)           return false;
        if (status   && m.status_acerto   !== status)           return false;
        if (state.lojaFiltro) {
            const id = String(state.lojaFiltro);
            if (String(m.loteria_origem) !== id && String(m.loteria_destino) !== id) return false;
        }
        return true;
    });

    const totalPendente = movs.filter(m => m.status_acerto === 'PENDENTE')
        .reduce((a, m) => a + m.valor_acerto, 0);
    const totalPago     = movs.filter(m => m.status_acerto === 'PAGO')
        .reduce((a, m) => a + m.valor_acerto, 0);

    const tbody = $('tbody-movimentacoes');
    if (!tbody) return;

    tbody.innerHTML = movs.length ? movs.map(m => {
        const statusClass = m.status_acerto === 'PAGO' ? 'b-ok' : 'b-warn';
        const corProd     = PRODUTO_COR[m.produto] || 'var(--muted)';

        // Qtd e valor unit variam por produto
        const qtd   = m.produto === 'FEDERAL'
            ? (m.qtd_vendida || 0) + (m.qtd_devolucao_caixa || 0) + (m.qtd_venda_cambista || 0)
            : m.qtd_cotas || 0;
        const unit  = m.produto === 'FEDERAL'
            ? `${m.federais?.valor_fracao || m.valor_fracao || '—'}`
            : `${m.valor_unitario || '—'}`;

        return `<tr>
            <td class="mono">${fmtDate(m.data_mov || m.created_at?.slice(0,10))}</td>
            <td>
                <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;
                             background:${corProd}18;color:${corProd};border:1px solid ${corProd}40">
                    ${m.produto}
                </span>
            </td>
            <td class="mono" style="font-size:11px">${m.ref_label}</td>
            <td>${lookupLoja(m.loteria_origem)}</td>
            <td>${lookupLoja(m.loteria_destino)}</td>
            <td class="mono">${qtd || '—'}</td>
            <td class="money">${fmtMoney(unit)}</td>
            <td class="money ${m.valor_acerto < 0 ? 'neg' : ''}">
                ${fmtMoney(Math.abs(m.valor_acerto))}
                ${m.valor_acerto < 0 ? '<span style="font-size:10px;color:var(--accent);margin-left:4px">crédito</span>' : ''}
            </td>
            <td><span class="badge ${statusClass}">${m.status_acerto}</span></td>
            <td class="mono">${fmtDate(m.data_acerto)}</td>
        </tr>`;
    }).join('')
    : `<tr><td colspan="10" style="padding:32px;text-align:center;color:var(--dim)">
        Nenhum registro para os filtros selecionados.
       </td></tr>`;

    // Totalizador
    const totais = $('mov-totais');
    if (totais) {
        totais.innerHTML = `
            <span>${movs.length} movimentação(ões)</span>
            <span>Pendente: <strong style="color:var(--amber)">${fmtMoney(totalPendente)}</strong></span>
            <span>Pago: <strong style="color:var(--accent)">${fmtMoney(totalPago)}</strong></span>
            <span>Total: <strong>${fmtMoney(totalPendente + totalPago)}</strong></span>`;
    }
}

// ══════════════════════════════════════════════════════════
// AÇÕES — Pagar par específico
// ══════════════════════════════════════════════════════════
window.pagarPar = async function(pagadorId, recebedorId, mes, produto) {
    const nomePag = lookupLoja(pagadorId);
    const nomeRec = lookupLoja(recebedorId);
    const mesLabel = mes !== 'total' ? fmtMes(mes) : 'todo o período';

    if (!confirm(
        `Confirma pagamento de ${nomePag} para ${nomeRec}?\n\n` +
        `Produto: ${produto}\nPeríodo: ${mesLabel}\n\n` +
        `Todas as movimentações PENDENTES deste par serão marcadas como PAGAS.`
    )) return;

    try {
        await quitarMovimentacoes([pagadorId, recebedorId], mes, produto);
        mostrarStatus('st-saldo', `Acerto ${nomePag} × ${nomeRec} quitado.`, 'ok');
        await refreshAll();
    } catch(e) {
        mostrarStatus('st-saldo', e.message, 'err');
    }
};

// ══════════════════════════════════════════════════════════
// AÇÕES — Pagar tudo (filtro atual)
// ══════════════════════════════════════════════════════════
async function pagarTudo() {
    const mesRef  = $('saldo-mes')?.value    || '';
    const produto = $('saldo-produto')?.value || '';

    if (!mesRef) {
        alert('Selecione um mês específico para quitar tudo de uma vez.');
        return;
    }

    const pendentes = todasMovs().filter(m =>
        m.status_acerto === 'PENDENTE' &&
        m.valor_acerto  > 0 &&
        (!mesRef  || m.mes_ref  === mesRef) &&
        (!produto || m.produto  === produto)
    );

    if (!pendentes.length) {
        mostrarStatus('st-saldo', 'Não há pendências para os filtros selecionados.', 'ok');
        return;
    }

    const totalPendente = pendentes.reduce((a, m) => a + m.valor_acerto, 0);

    if (!confirm(
        `Confirma quitação de TODAS as pendências?\n\n` +
        `Mês: ${fmtMes(mesRef)}\n` +
        `${produto ? 'Produto: ' + produto + '\n' : ''}` +
        `${pendentes.length} movimentação(ões) · ${fmtMoney(totalPendente)}\n\n` +
        `Esta ação não pode ser desfeita.`
    )) return;

    try {
        const dataHoje = new Date().toISOString().slice(0,10);

        // Separa federal de bolão
        const fedPendentes   = pendentes.filter(m => m.produto === 'FEDERAL').map(m => m.id);
        const bolaoPendentes = pendentes.filter(m => m.produto === 'BOLAO').map(m => m.id);

        if (fedPendentes.length) {
            const { error } = await sb.from('federal_movimentacoes')
                .update({ status_acerto:'PAGO', data_acerto:dataHoje })
                .in('id', fedPendentes);
            if (error) throw error;
        }
        if (bolaoPendentes.length) {
            const { error } = await sb.from('movimentacoes_cotas')
                .update({ status_acerto:'PAGO', data_acerto:dataHoje })
                .in('id', bolaoPendentes);
            if (error) throw error;
        }

        mostrarStatus('st-saldo', `${pendentes.length} movimentação(ões) quitadas.`, 'ok');
        await refreshAll();
    } catch(e) {
        mostrarStatus('st-saldo', e.message, 'err');
    }
}

// ── Helper: quita movimentações de um par específico ──────
async function quitarMovimentacoes(lojas, mes, produto) {
    const dataHoje = new Date().toISOString().slice(0,10);

    // IDs das movimentações PENDENTES do par
    const movsPar = todasMovs().filter(m => {
        if (m.status_acerto !== 'PENDENTE') return false;
        if (m.produto        !== produto)   return false;
        if (mes !== 'total'  && m.mes_ref  !== mes) return false;
        // Par: origem e destino devem ser as duas lojas (qualquer ordem)
        const lojasM = [String(m.loteria_origem), String(m.loteria_destino)];
        return lojas.every(id => lojasM.includes(String(id)));
    }).map(m => m.id);

    if (!movsPar.length) return;

    if (produto === 'FEDERAL') {
        const { error } = await sb.from('federal_movimentacoes')
            .update({ status_acerto:'PAGO', data_acerto:dataHoje })
            .in('id', movsPar);
        if (error) throw error;
    } else {
        const { error } = await sb.from('movimentacoes_cotas')
            .update({ status_acerto:'PAGO', data_acerto:dataHoje })
            .in('id', movsPar);
        if (error) throw error;
    }
}

// ══════════════════════════════════════════════════════════
// HELPER STATUS
// ══════════════════════════════════════════════════════════
function mostrarStatus(id, msg, tipo = 'ok') {
    const el = $(id); if (!el) return;
    el.textContent = msg;
    el.className   = `status-bar show ${tipo}`;
    setTimeout(() => { el.className = 'status-bar'; }, 4000);
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
bootstrap();
