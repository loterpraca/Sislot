/**
 * SISLOT — Controle Financeiro
 * Acertos entre lojas por produto e mês
 */

const sb  = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);
const $   = id => document.getElementById(id);
const fmtMoney = v => 'R$ ' + (Number(v || 0).toFixed(2)).replace('.', ',');
const fmtDate  = v => { if (!v) return '—'; const [y,m,d] = String(v).split('-'); return `${d}/${m}/${y}`; };
const fmtMesRef = mesIso => {
    if (!mesIso) return '—';
    const [y, m] = mesIso.split('-');
    const nomes  = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${nomes[parseInt(m,10)-1]}/${y}`;
};

// Cores por produto
const PRODUTO_COR = {
    FEDERAL:    '#38bdf8',
    BOLAO:      '#a78bfa',
    RASPADINHA: '#fb7185',
    TELESENA:   '#f5a623',
};

const state = {
    usuario:  null,
    loterias: [],
    controle: [],  // view_saldo_controle
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
}
document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ══════════════════════════════════════════════════════════
// BOOTSTRAP
// ══════════════════════════════════════════════════════════
async function bootstrap() {
    // Verifica sessão
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = './login.html'; return; }

    const { data: user } = await sb
        .from('usuarios')
        .select('id,nome,perfil,ativo')
        .eq('auth_user_id', session.user.id)
        .eq('ativo', true)
        .maybeSingle();

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

    // Carrega loterias
    const { data: lojas } = await sb
        .from('loterias')
        .select('id,nome,slug')
        .eq('ativo', true)
        .order('nome');
    state.loterias = lojas || [];

    // Preenche selects de loja no histórico
    fillSelect('hist-loja', state.loterias, 'Todas as lojas');

    await refreshAll();
}

function fillSelect(id, items, placeholder = 'Selecione...') {
    const sel = $(id); if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value       = item.id;
        opt.textContent = item.nome;
        sel.appendChild(opt);
    });
}

// ══════════════════════════════════════════════════════════
// LOAD
// ══════════════════════════════════════════════════════════
async function refreshAll() {
    const { data, error } = await sb
        .from('view_saldo_controle')
        .select('*')
        .order('mes_ref', { ascending: false });
    state.controle = error ? [] : (data || []);

    preencherSelectsMes();
    renderGeral();
    renderModalidade('FEDERAL');
    renderHistorico();
}

function preencherSelectsMes() {
    const meses = [...new Set(state.controle.map(x => x.mes_ref))].sort().reverse();
    const sels  = ['geral-mes','fed-mes','bol-mes','prod-mes'];
    sels.forEach(id => {
        const sel = $(id); if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = `<option value="">Todos os meses</option>`;
        meses.forEach(m => {
            const opt = document.createElement('option');
            opt.value       = m;
            opt.textContent = fmtMesRef(m);
            if (m === cur || (!cur && m === meses[0])) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

function lookupLoja(id) {
    return state.loterias.find(x => String(x.id) === String(id))?.nome || `Loja ${id}`;
}

// ══════════════════════════════════════════════════════════
// HELPER: agrupa linhas em pares com saldo líquido
// ══════════════════════════════════════════════════════════
function calcularPares(linhas) {
    const pares = {};

    linhas.forEach(r => {
        const [a, b] = [r.loja_devedora_id, r.loja_credora_id].sort((x,y) => x - y);
        const chave  = `${a}_${b}_${r.produto}`;

        if (!pares[chave]) pares[chave] = {
            a, b,
            produto:     r.produto,
            saldo:       0,
            movs:        0,
            temPendente: false,
            temPago:     false,
            mes_ref:     r.mes_ref,
        };

        pares[chave].saldo += r.loja_devedora_id === a
            ? Number(r.saldo_bruto)
            : -Number(r.saldo_bruto);
        pares[chave].movs        += Number(r.qtd_movimentacoes || 0);
        if (!r.quitado) pares[chave].temPendente = true;
        else            pares[chave].temPago     = true;
    });

    return Object.values(pares)
        .filter(p => Math.abs(p.saldo) > 0.001 || p.temPago)
        .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
}

// ══════════════════════════════════════════════════════════
// HELPER: monta um card de relacionamento
// ══════════════════════════════════════════════════════════
function buildRelCard(p, mesRef, breakdown = null) {
    const pagador   = p.saldo > 0 ? p.a : p.b;
    const recebedor = p.saldo > 0 ? p.b : p.a;
    const valor     = Math.abs(p.saldo);
    const quitado   = !p.temPendente && p.temPago;
    const parcial   = p.temPendente && p.temPago;

    const statusBadge = quitado
        ? `<span class="badge b-ok">PAGO</span>`
        : parcial
            ? `<span class="badge b-info">PARCIAL</span>`
            : `<span class="badge b-warn">PENDENTE</span>`;

    const btnAction = !quitado
        ? `<button class="btn-primary"
                onclick="quitarPar(${pagador},${recebedor},'${mesRef || p.mes_ref}',
                                   '${p.produto || ''}')">
               Marcar como pago
           </button>`
        : `<button class="btn-secondary" disabled>Quitado ✓</button>`;

    // Breakdown por produto (só no resumo geral)
    const breakdownHtml = breakdown && breakdown.length > 1 ? `
        <div class="rel-card-breakdown">
            ${breakdown.map(b => `
                <div class="rel-breakdown-row">
                    <span class="rel-breakdown-label">
                        <span class="produto-dot"
                              style="background:${PRODUTO_COR[b.produto]||'var(--muted)'}"></span>
                        ${b.produto}
                    </span>
                    <span class="rel-breakdown-valor" style="color:${PRODUTO_COR[b.produto]||'var(--muted)'}">
                        ${fmtMoney(Math.abs(b.saldo))}
                    </span>
                </div>
            `).join('')}
        </div>` : '';

    const corCard = quitado ? 'var(--accent)' : parcial ? 'var(--sky)' : 'var(--amber)';

    return `
    <div class="rel-card ${quitado ? 'pago' : parcial ? 'parcial' : 'pendente'}"
         style="--card-color:${corCard}">

        <div class="rel-card-head">
            <div>
                <div class="rel-card-lojas">
                    ${lookupLoja(pagador)}
                    <span class="seta">→</span>
                    ${lookupLoja(recebedor)}
                </div>
                <div class="rel-card-meta">
                    ${p.movs} movimentação(ões)
                    ${mesRef ? '· ' + fmtMesRef(mesRef) : ''}
                    ${p.produto ? `· <span style="color:${PRODUTO_COR[p.produto]||'var(--muted)'}">${p.produto}</span>` : ''}
                </div>
            </div>
            ${statusBadge}
        </div>

        <div class="rel-card-valor">
            <div>
                <div class="rel-card-valor-label">
                    ${lookupLoja(pagador)} paga ${lookupLoja(recebedor)}
                </div>
                <div class="rel-card-valor-num"
                     style="color:${quitado ? 'var(--accent)' : 'var(--amber)'}">
                    ${fmtMoney(valor)}
                </div>
            </div>
        </div>

        ${breakdownHtml}

        <div class="rel-card-foot">
            ${btnAction}
        </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — RESUMO GERAL
// agrupa todos os produtos por par de lojas no mês
// ══════════════════════════════════════════════════════════
function renderGeral() {
    const mesAtual = $('geral-mes')?.value || '';
    const linhas   = state.controle.filter(x => !mesAtual || x.mes_ref === mesAtual);

    // Agrupa por par de lojas ignorando produto (soma tudo)
    const paresGeral = {};
    linhas.forEach(r => {
        const [a, b] = [r.loja_devedora_id, r.loja_credora_id].sort((x,y) => x - y);
        const chave  = `${a}_${b}`;

        if (!paresGeral[chave]) paresGeral[chave] = {
            a, b, saldo: 0, movs: 0,
            temPendente: false, temPago: false,
            produtos: [], mes_ref: r.mes_ref,
        };

        const saldoDir = r.loja_devedora_id === a
            ? Number(r.saldo_bruto)
            : -Number(r.saldo_bruto);

        paresGeral[chave].saldo += saldoDir;
        paresGeral[chave].movs  += Number(r.qtd_movimentacoes || 0);
        if (!r.quitado) paresGeral[chave].temPendente = true;
        else            paresGeral[chave].temPago     = true;

        // Guarda breakdown por produto
        const existing = paresGeral[chave].produtos.find(p => p.produto === r.produto);
        if (existing) {
            existing.saldo += saldoDir;
        } else {
            paresGeral[chave].produtos.push({ produto: r.produto, saldo: saldoDir });
        }
    });

    const cards = Object.values(paresGeral)
        .filter(p => Math.abs(p.saldo) > 0.001 || p.temPago)
        .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));

    // KPIs
    const totalPendente = cards
        .filter(p => p.temPendente)
        .reduce((a, p) => a + Math.abs(p.saldo), 0);
    const totalPago = linhas
        .filter(r => r.quitado)
        .reduce((a, r) => a + Number(r.saldo_bruto || 0), 0);
    const qtdPendente = cards.filter(p => p.temPendente).length;
    const qtdQuitado  = cards.filter(p => !p.temPendente && p.temPago).length;

    $('kpis-geral').innerHTML = [
        { l: 'Pendente',    v: fmtMoney(totalPendente), s: `${qtdPendente} relação(ões)`,      cor: 'var(--amber)' },
        { l: 'Quitado',     v: fmtMoney(totalPago),     s: `${qtdQuitado} relação(ões)`,       cor: 'var(--accent)' },
        { l: 'Pares ativos',v: cards.length,             s: 'lojas com movimentação',           cor: 'var(--sky)' },
        { l: 'Mês ref.',    v: fmtMesRef(mesAtual) || 'Todos', s: 'período selecionado',        cor: 'var(--purple)' },
    ].map(({ l, v, s, cor }) => `
        <div class="kpi" style="--kpi-color:${cor}">
            <div class="kpi-label">${l}</div>
            <div class="kpi-value">${v}</div>
            <div class="kpi-sub">${s}</div>
        </div>`
    ).join('');

    // Info pill
    const pendentes = cards.filter(p => p.temPendente).length;
    $('geral-resumo-pill').innerHTML = pendentes > 0
        ? `<span>${pendentes} par(es) com pendência</span>
           <span style="color:var(--amber);font-weight:600">${fmtMoney(totalPendente)} a acertar</span>`
        : `<span style="color:var(--accent)">Todas as pendências quitadas ✓</span>`;

    // Cards
    $('cards-geral').innerHTML = cards.length
        ? cards.map(p => buildRelCard(p, mesAtual, p.produtos)).join('')
        : `<div class="empty-produto">
            <div class="empty-title">Nenhuma pendência encontrada</div>
            <div class="empty-sub">Não há movimentações entre lojas no período selecionado.</div>
           </div>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — POR MODALIDADE (Federal, Bolão, etc.)
// ══════════════════════════════════════════════════════════
function renderModalidade(produto) {
    const mesSelId = produto === 'FEDERAL'    ? 'fed-mes'
                   : produto === 'BOLAO'      ? 'bol-mes'
                   : 'prod-mes';
    const cardsId  = `cards-${produto === 'FEDERAL' ? 'federal' : produto === 'BOLAO' ? 'boloes' : 'produtos'}`;
    const emptyId  = produto === 'BOLAO'      ? 'boloes-empty'
                   : produto !== 'FEDERAL'    ? 'produtos-empty'
                   : null;
    const tbodyId  = produto === 'FEDERAL'    ? 'tbody-federal' : null;

    const mesAtual = $(mesSelId)?.value || '';
    const linhas   = state.controle.filter(x =>
        x.produto === produto &&
        (!mesAtual || x.mes_ref === mesAtual)
    );

    const pares = calcularPares(linhas);

    // Controle de empty state para módulos futuros
    if (emptyId) {
        const emptyEl  = $(emptyId);
        const cardsEl  = $(cardsId);
        if (emptyEl && cardsEl) {
            emptyEl.style.display  = pares.length ? 'none' : '';
            cardsEl.style.display  = pares.length ? '' : 'none';
        }
    }

    const cardsEl = $(cardsId);
    if (cardsEl) {
        cardsEl.innerHTML = pares.length
            ? pares.map(p => buildRelCard(p, mesAtual)).join('')
            : '';
    }

    // Tabela detalhada (só Federal por enquanto)
    if (tbodyId) {
        const tbody = $(tbodyId);
        if (tbody) {
            tbody.innerHTML = linhas.length
                ? linhas.map(r => `<tr>
                    <td class="mono">${fmtMesRef(r.mes_ref)}</td>
                    <td>${lookupLoja(r.loja_devedora_id)}</td>
                    <td>${lookupLoja(r.loja_credora_id)}</td>
                    <td class="mono">${r.qtd_movimentacoes}</td>
                    <td class="money">${fmtMoney(r.saldo_bruto)}</td>
                    <td><span class="badge ${r.quitado ? 'b-ok' : 'b-warn'}">
                        ${r.quitado ? 'PAGO' : 'PENDENTE'}
                    </span></td>
                  </tr>`).join('')
                : `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--dim)">
                    Sem movimentações no período
                   </td></tr>`;
        }
    }
}

// ══════════════════════════════════════════════════════════
// RENDER — HISTÓRICO
// ══════════════════════════════════════════════════════════
function renderHistorico() {
    const lojaId  = $('hist-loja')?.value;
    const produto = $('hist-produto')?.value;
    const status  = $('hist-status')?.value;

    let rows = [...state.controle];
    if (produto) rows = rows.filter(x => x.produto === produto);
    if (status === 'PAGO')     rows = rows.filter(x => x.quitado);
    if (status === 'PENDENTE') rows = rows.filter(x => !x.quitado);
    if (lojaId)  rows = rows.filter(x =>
        String(x.loja_devedora_id) === String(lojaId) ||
        String(x.loja_credora_id)  === String(lojaId)
    );

    const tbody = $('tbody-historico');
    if (!tbody) return;

    tbody.innerHTML = rows.length
        ? rows.map(r => `<tr>
            <td class="mono">${fmtMesRef(r.mes_ref)}</td>
            <td>
                <span class="badge b-dim"
                      style="border-color:${PRODUTO_COR[r.produto]||'var(--border)'};
                             color:${PRODUTO_COR[r.produto]||'var(--muted)'}">
                    ${r.produto}
                </span>
            </td>
            <td>${lookupLoja(r.loja_devedora_id)}</td>
            <td>${lookupLoja(r.loja_credora_id)}</td>
            <td class="mono">${r.qtd_movimentacoes}</td>
            <td class="money">${fmtMoney(r.saldo_bruto)}</td>
            <td><span class="badge ${r.quitado ? 'b-ok' : 'b-warn'}">
                ${r.quitado ? 'PAGO' : 'PENDENTE'}
            </span></td>
            <td class="mono">${r.data_acerto ? fmtDate(r.data_acerto) : '—'}</td>
          </tr>`).join('')
        : `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--dim)">
            Nenhum registro encontrado para os filtros selecionados.
           </td></tr>`;
}

// ══════════════════════════════════════════════════════════
// AÇÕES — Quitar par específico
// ══════════════════════════════════════════════════════════
window.quitarPar = async function(pagadorId, recebedorId, mesRef, produto) {
    const nomePag = lookupLoja(pagadorId);
    const nomeRec = lookupLoja(recebedorId);
    const msg     = produto
        ? `Confirma pagamento de ${nomePag} para ${nomeRec}?\n\nProduto: ${produto}\nMês: ${fmtMesRef(mesRef)}\n\nTodas as pendências deste par serão marcadas como PAGAS.`
        : `Confirma pagamento de ${nomePag} para ${nomeRec} em ${fmtMesRef(mesRef)}?\n\nTodos os produtos pendentes deste par serão quitados.`;

    if (!confirm(msg)) return;

    try {
        let query = sb
            .from('controle_financeiro')
            .update({ status: 'PAGO', data_acerto: new Date().toISOString().slice(0,10) })
            .eq('mes_ref', mesRef)
            .or([
                `and(loja_devedora_id.eq.${pagadorId},loja_credora_id.eq.${recebedorId})`,
                `and(loja_devedora_id.eq.${recebedorId},loja_credora_id.eq.${pagadorId})`
            ].join(','));

        if (produto) query = query.eq('produto', produto);

        const { error } = await query;
        if (error) throw error;

        mostrarStatus('st-controle', `Acerto ${nomePag} × ${nomeRec} quitado com sucesso.`, 'ok');
        await refreshAll();
    } catch(e) {
        mostrarStatus('st-controle', e.message, 'err');
    }
};

// ══════════════════════════════════════════════════════════
// AÇÕES — Pagar tudo do mês (resumo geral)
// ══════════════════════════════════════════════════════════
window.pagarTudoMes = async function() {
    const mesAtual = $('geral-mes')?.value;
    if (!mesAtual) {
        alert('Selecione um mês específico antes de quitar tudo.');
        return;
    }

    const pendentes = state.controle.filter(x =>
        x.mes_ref === mesAtual && !x.quitado
    );

    if (!pendentes.length) {
        mostrarStatus('st-controle', 'Não há pendências no mês selecionado.', 'ok');
        return;
    }

    const totalPendente = pendentes.reduce((a, r) => a + Number(r.saldo_bruto || 0), 0);

    if (!confirm(
        `Confirma quitação de TODAS as pendências de ${fmtMesRef(mesAtual)}?\n\n` +
        `${pendentes.length} registro(s) · ${fmtMoney(totalPendente)} total\n\n` +
        `Esta ação não pode ser desfeita.`
    )) return;

    try {
        const { error } = await sb
            .from('controle_financeiro')
            .update({ status: 'PAGO', data_acerto: new Date().toISOString().slice(0,10) })
            .eq('mes_ref', mesAtual)
            .eq('status', 'PENDENTE');

        if (error) throw error;
        mostrarStatus('st-controle', `Todas as pendências de ${fmtMesRef(mesAtual)} foram quitadas.`, 'ok');
        await refreshAll();
    } catch(e) {
        mostrarStatus('st-controle', e.message, 'err');
    }
};

// ══════════════════════════════════════════════════════════
// AÇÕES — Pagar tudo por produto
// ══════════════════════════════════════════════════════════
window.pagarTudoProduto = async function(produto) {
    const mesSelId = produto === 'FEDERAL' ? 'fed-mes'
                   : produto === 'BOLAO'   ? 'bol-mes'
                   : 'prod-mes';
    const mesAtual = $(mesSelId)?.value;

    if (!mesAtual) {
        alert('Selecione um mês específico antes de quitar tudo.');
        return;
    }

    const pendentes = state.controle.filter(x =>
        x.produto === produto && x.mes_ref === mesAtual && !x.quitado
    );

    if (!pendentes.length) {
        alert('Não há pendências de ' + produto + ' no mês selecionado.');
        return;
    }

    const total = pendentes.reduce((a, r) => a + Number(r.saldo_bruto || 0), 0);

    if (!confirm(
        `Confirma quitação de todas as pendências de ${produto} em ${fmtMesRef(mesAtual)}?\n\n` +
        `${pendentes.length} registro(s) · ${fmtMoney(total)} total`
    )) return;

    try {
        const { error } = await sb
            .from('controle_financeiro')
            .update({ status: 'PAGO', data_acerto: new Date().toISOString().slice(0,10) })
            .eq('mes_ref', mesAtual)
            .eq('produto', produto)
            .eq('status', 'PENDENTE');

        if (error) throw error;

        const stId = produto === 'FEDERAL' ? 'st-federal'
                   : produto === 'BOLAO'   ? 'st-boloes'
                   : 'st-produtos';
        mostrarStatus(stId, `Todas as pendências de ${produto} em ${fmtMesRef(mesAtual)} foram quitadas.`, 'ok');
        await refreshAll();
    } catch(e) {
        mostrarStatus('st-controle', e.message, 'err');
    }
};

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
