// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO: ÁREA DO CLIENTE — cliente_fechamento_*
// Substitui a lógica simples de fechamento_dividas
// Encaixa em tela 1 do fechamento-caixa.js
// ═══════════════════════════════════════════════════════════════════════════

// ─── ESTADO DO MÓDULO ────────────────────────────────────────────────────────
// Expande ESTADO.tela1 com:
// ESTADO.tela1.clienteFechamento = {
//   clienteSelecionado: null,
//   lancamentos: [],    // DEBITOs pendentes desta sessão
//   pagamentos: []      // PAGAMENTOs desta sessão
// }

const CF = (() => {
    // Estado interno do módulo
    let _clientes = [];         // lista de clientes da loja
    let _clienteAtivo = null;   // cliente selecionado no modal
    let _carrinhoItens = [];    // itens do carrinho atual
    let _lancamentos = [];      // lançamentos da sessão (extrato)
    let _pagamentos = [];       // pagamentos da sessão

    // Refs de Supabase e loja (injetadas via CF.init)
    let _sb = null;
    let _getLoteriaAtiva = null;
    let _getUsuario = null;
    let _getEstado = null;
    let _fmtBRL = null;
    let _fmtData = null;

    // ── INICIALIZAÇÃO ────────────────────────────────────────────────────
    function init(deps) {
        _sb = deps.sb;
        _getLoteriaAtiva = deps.getLoteriaAtiva;
        _getUsuario = deps.getUsuario;
        _getEstado = deps.getEstado;
        _fmtBRL = deps.fmtBRL;
        _fmtData = deps.fmtData;

        // Garante subestado no ESTADO global
        const estado = _getEstado();
        if (!estado.tela1.clienteFechamento) {
            estado.tela1.clienteFechamento = {
                clienteSelecionado: null,
                lancamentos: [],
                pagamentos: []
            };
        }

        _bindEvents();
    }

    function _bindEvents() {
        document.getElementById('btn-abrir-area-cliente')
            ?.addEventListener('click', openModal);
    }

    // ── SINCRONIZA ESTADO GLOBAL ──────────────────────────────────────────
    function _syncEstado() {
        const estado = _getEstado();
        estado.tela1.clienteFechamento = {
            clienteSelecionado: _clienteAtivo
                ? { id: _clienteAtivo.id, nome: _clienteAtivo.nome }
                : null,
            lancamentos: [..._lancamentos],
            pagamentos: [..._pagamentos]
        };
    }

    // ── ABRIR / FECHAR MODAL ──────────────────────────────────────────────
    async function openModal() {
        _setModalView('cf-view-lista');
        _renderResumoSessao();
        renderListaLancamentos();
        await _carregarClientes();
        document.getElementById('m-area-cliente')?.classList.add('show');
    }

    function closeModal() {
        document.getElementById('m-area-cliente')?.classList.remove('show');
        _syncEstado();
        renderChipResumo();
    }

    function _setModalView(viewId) {
        ['cf-view-lista', 'cf-view-cliente', 'cf-view-carrinho',
         'cf-view-pagamento', 'cf-view-novo-cliente'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = id === viewId ? 'block' : 'none';
        });
    }

    // ── CLIENTES ──────────────────────────────────────────────────────────
    async function _carregarClientes() {
        const loteria = _getLoteriaAtiva();
        if (!loteria) return;

        try {
            const { data, error } = await _sb
                .from('cliente_fechamento_cadastro')
                .select('id, nome, telefone, documento, observacao')
                .eq('loteria_id', loteria.id)
                .eq('ativo', true)
                .order('nome');

            if (error) throw error;
            _clientes = data || [];
            _renderListaClientes();
        } catch (e) {
            console.error('Erro ao carregar clientes:', e);
            _clientes = [];
            _renderListaClientes();
        }
    }

    function _renderListaClientes() {
        const wrap = document.getElementById('cf-clientes-lista');
        if (!wrap) return;

        const busca = (document.getElementById('cf-busca-cliente')?.value || '')
            .toLowerCase().trim();

        const filtrados = busca
            ? _clientes.filter(c =>
                c.nome?.toLowerCase().includes(busca) ||
                c.telefone?.toLowerCase().includes(busca) ||
                c.documento?.toLowerCase().includes(busca)
            )
            : _clientes;

        if (!filtrados.length) {
            wrap.innerHTML = `
                <div class="cf-empty">
                    <div class="cf-empty-icon">👤</div>
                    <div>Nenhum cliente encontrado</div>
                    <button class="cf-btn-link" onclick="CF.iniciarNovoCadastro()">
                        + Cadastrar novo cliente
                    </button>
                </div>`;
            return;
        }

        wrap.innerHTML = filtrados.map(c => {
            const lancDeste = _lancamentos.filter(l => l.cliente_id === c.id);
            const totalDevendo = lancDeste
                .filter(l => l.tipo_movimento === 'DEBITO' && l.status === 'PENDENTE')
                .reduce((a, l) => a + Number(l.valor_total || 0), 0);

            return `
            <div class="cf-cliente-card ${totalDevendo > 0 ? 'tem-divida' : ''}"
                 onclick="CF.selecionarCliente(${c.id})">
                <div class="cf-cli-info">
                    <div class="cf-cli-nome">${c.nome}</div>
                    ${c.telefone ? `<div class="cf-cli-tel">${c.telefone}</div>` : ''}
                </div>
                <div class="cf-cli-saldo">
                    ${totalDevendo > 0
                        ? `<span class="cf-badge-devendo">${_fmtBRL(totalDevendo)}</span>`
                        : `<span class="cf-badge-ok">Sem dívida</span>`
                    }
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </div>
            </div>`;
        }).join('');
    }

    function selecionarCliente(idOuObj) {
        const c = typeof idOuObj === 'object'
            ? idOuObj
            : _clientes.find(x => Number(x.id) === Number(idOuObj));

        if (!c) return;
        _clienteAtivo = c;
        _carrinhoItens = [];

        _renderViewCliente();
        _setModalView('cf-view-cliente');
    }

    function _renderViewCliente() {
        const c = _clienteAtivo;
        if (!c) return;

        // Cabeçalho
        const hdr = document.getElementById('cf-cliente-header');
        if (hdr) hdr.innerHTML = `
            <div class="cf-cli-nome-lg">${c.nome}</div>
            ${c.telefone ? `<div class="cf-cli-tel">${c.telefone}</div>` : ''}
        `;

        // Histórico desta sessão para esse cliente
        _renderExtratoCurrent();

        // Botão de pagamento: só aparece se tem dívida pendente nesta sessão
        const totalPendente = _lancamentos
            .filter(l => l.cliente_id === c.id && l.tipo_movimento === 'DEBITO' && l.status === 'PENDENTE')
            .reduce((a, l) => a + Number(l.valor_total || 0), 0);

        const btnPag = document.getElementById('cf-btn-registrar-pag');
        if (btnPag) btnPag.style.display = totalPendente > 0 ? 'flex' : 'none';

        const saldoEl = document.getElementById('cf-saldo-pendente');
        if (saldoEl) saldoEl.textContent = totalPendente > 0
            ? `Saldo em aberto: ${_fmtBRL(totalPendente)}`
            : 'Nenhuma dívida nesta sessão';
    }

    function _renderExtratoCurrent() {
        const wrap = document.getElementById('cf-extrato-sessao');
        if (!wrap || !_clienteAtivo) return;

        const movs = [
            ..._lancamentos.filter(l => l.cliente_id === _clienteAtivo.id),
            ..._pagamentos.filter(p => p.cliente_id === _clienteAtivo.id)
        ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        if (!movs.length) {
            wrap.innerHTML = `<div class="cf-extrato-vazio">Nenhum movimento nesta sessão</div>`;
            return;
        }

        wrap.innerHTML = movs.map(m => {
            const isDebito = m.tipo_movimento === 'DEBITO';
            const statusClass = {
                PENDENTE: 'cf-status-pendente',
                PROCESSAMENTO: 'cf-status-proc',
                QUITADO: 'cf-status-ok'
            }[m.status] || '';

            const itensHtml = (m.itens || []).map(it => `
                <div class="cf-extrato-item">
                    <span>${it.descricao || it.produto || `${it.modalidade} ${it.concurso}`}</span>
                    <span>${it.qtd_vendida || 1}x ${_fmtBRL(it.valor_unitario || 0)}</span>
                </div>`).join('');

            return `
            <div class="cf-extrato-linha ${isDebito ? 'cf-extrato-deb' : 'cf-extrato-pag'}">
                <div class="cf-extrato-top">
                    <span class="cf-extrato-tipo">${isDebito ? '↓ Débito' : '↑ Pagamento'}</span>
                    <span class="cf-extrato-valor ${isDebito ? 'v-neg' : 'v-pos'}">
                        ${isDebito ? '-' : '+'}${_fmtBRL(m.valor_total || 0)}
                    </span>
                </div>
                ${itensHtml ? `<div class="cf-extrato-itens">${itensHtml}</div>` : ''}
                <div class="cf-extrato-bottom">
                    ${m.forma_pagamento
                        ? `<span class="cf-forma">${m.forma_pagamento}</span>`
                        : ''}
                    <span class="${statusClass}">${m.status}</span>
                    ${m.observacao ? `<span class="cf-obs">${m.observacao}</span>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    // ── NOVO CADASTRO ─────────────────────────────────────────────────────
    function iniciarNovoCadastro() {
        // Limpa campos
        ['cf-novo-nome', 'cf-novo-tel', 'cf-novo-doc', 'cf-novo-obs'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        _setModalView('cf-view-novo-cliente');
    }

    async function salvarNovoCadastro() {
        const nome = document.getElementById('cf-novo-nome')?.value?.trim();
        if (!nome) {
            _showCFError('cf-novo-err', 'Nome obrigatório.');
            return;
        }

        const loteria = _getLoteriaAtiva();
        const btn = document.getElementById('cf-btn-salvar-novo');
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

        try {
            const { data, error } = await _sb
                .from('cliente_fechamento_cadastro')
                .insert({
                    loteria_id: loteria.id,
                    nome,
                    telefone: document.getElementById('cf-novo-tel')?.value?.trim() || null,
                    documento: document.getElementById('cf-novo-doc')?.value?.trim() || null,
                    observacao: document.getElementById('cf-novo-obs')?.value?.trim() || null,
                    ativo: true
                })
                .select()
                .single();

            if (error) throw error;

            _clientes.unshift(data);
            selecionarCliente(data);
        } catch (e) {
            _showCFError('cf-novo-err', e.message || 'Erro ao cadastrar.');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Cadastrar'; }
        }
    }

    // ── CARRINHO DE DÉBITO ────────────────────────────────────────────────
    function abrirCarrinho() {
        _carrinhoItens = [];
        _renderCarrinho();
        _setModalView('cf-view-carrinho');
    }

    function adicionarItemCarrinho(tipo) {
        // tipo: BOLAO | FEDERAL | PRODUTO | CONTA
        const templates = {
            BOLAO: {
                tipo_origem: 'BOLAO', modalidade: '', concurso: '',
                qtd_jogos: 0, qtd_dezenas: 0,
                valor_unitario: 0, qtd_vendida: 1, valor_total: 0,
                data_venda: _hoje(), descricao: ''
            },
            FEDERAL: {
                tipo_origem: 'FEDERAL', modalidade: '', concurso: '',
                valor_unitario: 0, qtd_vendida: 1, valor_total: 0,
                data_venda: _hoje(), descricao: ''
            },
            PRODUTO: {
                tipo_origem: 'PRODUTO', produto: '',
                valor_unitario: 0, qtd_vendida: 1, valor_total: 0,
                data_venda: _hoje(), descricao: ''
            },
            CONTA: {
                tipo_origem: 'CONTA', descricao: '',
                valor_unitario: 0, qtd_vendida: 1, valor_total: 0,
                data_venda: _hoje()
            }
        };
        _carrinhoItens.push({ ...templates[tipo], _id: Date.now() + Math.random() });
        _renderCarrinho();
    }

    function removerItemCarrinho(idx) {
        _carrinhoItens.splice(idx, 1);
        _renderCarrinho();
    }

    function _renderCarrinho() {
        const wrap = document.getElementById('cf-carrinho-itens');
        if (!wrap) return;

        if (!_carrinhoItens.length) {
            wrap.innerHTML = `
                <div class="cf-empty" style="padding:20px">
                    <div style="font-size:12px;color:var(--muted)">
                        Nenhum item adicionado. Use os botões acima.
                    </div>
                </div>`;
            _atualizarTotalCarrinho();
            return;
        }

        wrap.innerHTML = _carrinhoItens.map((item, idx) => {
            const campos = _buildCamposItem(item, idx);
            return `
            <div class="cf-carrinho-item" data-idx="${idx}">
                <div class="cf-item-head">
                    <span class="cf-tipo-badge ${item.tipo_origem.toLowerCase()}">${item.tipo_origem}</span>
                    <button type="button" class="cf-btn-rm-item" onclick="CF.removerItemCarrinho(${idx})">✕</button>
                </div>
                <div class="cf-item-campos">${campos}</div>
                <div class="cf-item-subtotal">
                    Subtotal: <strong id="cf-sub-${idx}">${_fmtBRL(item.valor_total || 0)}</strong>
                </div>
            </div>`;
        }).join('');

        _atualizarTotalCarrinho();
    }

    function _buildCamposItem(item, idx) {
        const tipo = item.tipo_origem;
        let html = '';

        if (tipo === 'BOLAO') {
            html += _field(`Modalidade`, `<input class="cf-inp" type="text" placeholder="Ex: Mega Sena"
                value="${item.modalidade || ''}"
                oninput="CF.updateItem(${idx}, 'modalidade', this.value)">`);
            html += _field(`Concurso`, `<input class="cf-inp" type="text" placeholder="Ex: 2800"
                value="${item.concurso || ''}"
                oninput="CF.updateItem(${idx}, 'concurso', this.value)">`);
            html += _field(`Qtd. Jogos`, `<input class="cf-inp" type="number" min="0" placeholder="0"
                value="${item.qtd_jogos || ''}"
                oninput="CF.updateItem(${idx}, 'qtd_jogos', +this.value)">`);
            html += _field(`Dezenas`, `<input class="cf-inp" type="number" min="0" placeholder="0"
                value="${item.qtd_dezenas || ''}"
                oninput="CF.updateItem(${idx}, 'qtd_dezenas', +this.value)">`);
        } else if (tipo === 'FEDERAL') {
            html += _field(`Modalidade`, `<input class="cf-inp" type="text" placeholder="Ex: Quina"
                value="${item.modalidade || ''}"
                oninput="CF.updateItem(${idx}, 'modalidade', this.value)">`);
            html += _field(`Concurso`, `<input class="cf-inp" type="text" placeholder="Ex: 5000"
                value="${item.concurso || ''}"
                oninput="CF.updateItem(${idx}, 'concurso', this.value)">`);
        } else if (tipo === 'PRODUTO') {
            html += _field(`Produto`, `<input class="cf-inp" type="text" placeholder="Ex: Raspadinha Sorte Grande"
                value="${item.produto || ''}"
                oninput="CF.updateItem(${idx}, 'produto', this.value)">`);
        } else if (tipo === 'CONTA') {
            html += _field(`Descrição`, `<input class="cf-inp" type="text" placeholder="Ex: Ajuste / compra diversa"
                value="${item.descricao || ''}"
                oninput="CF.updateItem(${idx}, 'descricao', this.value)">`);
        }

        html += _field(`Valor Unitário`, `<div class="pfx-wrap">
            <span class="pfx">R$</span>
            <input class="cf-inp" type="number" step="0.01" min="0" placeholder="0,00"
                style="padding-left:32px"
                value="${item.valor_unitario || ''}"
                oninput="CF.updateItem(${idx}, 'valor_unitario', +this.value)">
        </div>`);

        html += _field(`Qtd.`, `<input class="cf-inp" type="number" min="1" placeholder="1"
            value="${item.qtd_vendida || 1}"
            oninput="CF.updateItem(${idx}, 'qtd_vendida', +this.value)">`);

        return html;
    }

    function _field(label, input) {
        return `<div class="cf-campo">
            <label class="cf-campo-label">${label}</label>
            ${input}
        </div>`;
    }

    function updateItem(idx, campo, valor) {
        const item = _carrinhoItens[idx];
        if (!item) return;
        item[campo] = valor;
        item.valor_total = Number(item.valor_unitario || 0) * Number(item.qtd_vendida || 0);

        const subEl = document.getElementById(`cf-sub-${idx}`);
        if (subEl) subEl.textContent = _fmtBRL(item.valor_total);
        _atualizarTotalCarrinho();
    }

    function _atualizarTotalCarrinho() {
        const total = _carrinhoItens.reduce((a, i) => a + Number(i.valor_total || 0), 0);
        const el = document.getElementById('cf-total-carrinho');
        if (el) el.textContent = _fmtBRL(total);
        const btn = document.getElementById('cf-btn-confirmar-debito');
        if (btn) btn.disabled = total <= 0;
    }

    function confirmarDebito() {
        if (!_clienteAtivo || !_carrinhoItens.length) return;

        const totalCarrinho = _carrinhoItens.reduce((a, i) => a + Number(i.valor_total || 0), 0);
        if (totalCarrinho <= 0) return;

        const obs = document.getElementById('cf-obs-debito')?.value?.trim() || '';
        const data = _hoje();

        const lancamento = {
            _sessao_id: Date.now(),
            cliente_id: _clienteAtivo.id,
            cliente_nome: _clienteAtivo.nome,
            tipo_movimento: 'DEBITO',
            status: 'PENDENTE',
            valor_total: totalCarrinho,
            gera_credito_fechamento: true,
            gera_abatimento_divida: false,
            gera_pix_quitacao: false,
            data_movimento: data,
            observacao: obs,
            itens: _carrinhoItens.map(i => ({ ...i })),
            created_at: new Date().toISOString()
        };

        _lancamentos.push(lancamento);
        _carrinhoItens = [];
        _syncEstado();

        _renderViewCliente();
        _setModalView('cf-view-cliente');
        _renderResumoSessao();
    }

    // ── PAGAMENTO ──────────────────────────────────────────────────────────
    function abrirPagamento() {
        if (!_clienteAtivo) return;

        const totalPend = _lancamentos
            .filter(l => l.cliente_id === _clienteAtivo.id && l.tipo_movimento === 'DEBITO' && l.status === 'PENDENTE')
            .reduce((a, l) => a + Number(l.valor_total || 0), 0);

        const elSaldo = document.getElementById('cf-pag-saldo');
        if (elSaldo) elSaldo.textContent = _fmtBRL(totalPend);

        const inpVal = document.getElementById('cf-pag-valor');
        if (inpVal) inpVal.value = totalPend > 0 ? totalPend.toFixed(2) : '';

        // Reseta radio para dinheiro
        const rdDin = document.getElementById('cf-pag-dinheiro');
        if (rdDin) rdDin.checked = true;

        document.getElementById('cf-pag-err')?.style
            && (document.getElementById('cf-pag-err').style.display = 'none');

        _setModalView('cf-view-pagamento');
    }

    function confirmarPagamento() {
        if (!_clienteAtivo) return;

        const forma = document.querySelector('input[name="cf-forma-pag"]:checked')?.value;
        const valor = parseFloat(document.getElementById('cf-pag-valor')?.value || '0');
        const obs = document.getElementById('cf-pag-obs')?.value?.trim() || '';

        if (!forma || valor <= 0) {
            _showCFError('cf-pag-err', 'Selecione a forma e informe um valor válido.');
            return;
        }

        // Regras de negócio
        const isPixPag = forma === 'PIX';
        const pagamento = {
            _sessao_id: Date.now(),
            cliente_id: _clienteAtivo.id,
            cliente_nome: _clienteAtivo.nome,
            tipo_movimento: 'PAGAMENTO',
            forma_pagamento: forma,
            // Dinheiro → QUITADO direto; PIX → PROCESSAMENTO (aguarda admin)
            status: isPixPag ? 'PROCESSAMENTO' : 'QUITADO',
            valor_total: valor,
            gera_credito_fechamento: false,
            // Dinheiro quitado = abate dívida; PIX = só abate após validação admin
            gera_abatimento_divida: !isPixPag,
            gera_pix_quitacao: false, // só true após confirmação admin
            data_movimento: _hoje(),
            observacao: obs,
            itens: [],
            created_at: new Date().toISOString()
        };

        _pagamentos.push(pagamento);
        _syncEstado();

        _renderViewCliente();
        _setModalView('cf-view-cliente');
        _renderResumoSessao();
    }

    // ── RESUMO DA SESSÃO (dentro do modal e no chip externo) ──────────────
    function _renderResumoSessao() {
        const wrap = document.getElementById('cf-resumo-sessao');
        if (!wrap) return;

        const totDebito = _lancamentos
            .filter(l => l.tipo_movimento === 'DEBITO')
            .reduce((a, l) => a + Number(l.valor_total || 0), 0);

        const totAbatimento = _pagamentos
            .filter(p => p.gera_abatimento_divida)
            .reduce((a, p) => a + Number(p.valor_total || 0), 0);

        const totPix = _pagamentos
            .filter(p => p.forma_pagamento === 'PIX' && p.status === 'PROCESSAMENTO')
            .reduce((a, p) => a + Number(p.valor_total || 0), 0);

        wrap.innerHTML = `
            <div class="cf-resumo-linha">
                <span>Crédito p/ fechamento (débitos)</span>
                <span class="cf-val-pos">${_fmtBRL(totDebito)}</span>
            </div>
            <div class="cf-resumo-linha">
                <span>Abatimento dívida</span>
                <span class="cf-val-neg">${_fmtBRL(totAbatimento)}</span>
            </div>
            ${totPix > 0 ? `<div class="cf-resumo-linha">
                <span>PIX em processamento</span>
                <span class="cf-val-pix">${_fmtBRL(totPix)}</span>
            </div>` : ''}
        `;

        renderListaLancamentos();
    }

    function renderListaLancamentos() {
        const wrap = document.getElementById('cf-lista-lancamentos');
        if (!wrap) return;

        const todos = [
            ..._lancamentos.map(l => ({ ...l, _tipo: 'lancamento' })),
            ..._pagamentos.map(p => ({ ...p, _tipo: 'pagamento' }))
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (!todos.length) {
            wrap.innerHTML = `<div class="cf-empty-small">Nenhum lançamento nesta sessão</div>`;
            return;
        }

        wrap.innerHTML = todos.map(m => {
            const isDebito = m.tipo_movimento === 'DEBITO';
            const statusClass = {
                PENDENTE: 'cf-s-pend',
                PROCESSAMENTO: 'cf-s-proc',
                QUITADO: 'cf-s-ok'
            }[m.status] || '';

            return `
            <div class="cf-lanc-row">
                <div class="cf-lanc-esq">
                    <span class="cf-lanc-cli">${m.cliente_nome}</span>
                    <span class="${statusClass}">${m.status}</span>
                    ${m.forma_pagamento ? `<span class="cf-lanc-forma">${m.forma_pagamento}</span>` : ''}
                </div>
                <div class="cf-lanc-dir">
                    <span class="${isDebito ? 'v-neg' : 'v-pos'}">
                        ${isDebito ? '-' : '+'}${_fmtBRL(m.valor_total || 0)}
                    </span>
                </div>
            </div>`;
        }).join('');
    }

    // ── CHIP EXTERNO (botão na tela 1) ────────────────────────────────────
    function renderChipResumo() {
        const btn = document.getElementById('btn-abrir-area-cliente');
        if (!btn) return;

        const totDebito = _lancamentos
            .filter(l => l.tipo_movimento === 'DEBITO')
            .reduce((a, l) => a + Number(l.valor_total || 0), 0);

        const countClientes = new Set([
            ..._lancamentos.map(l => l.cliente_id),
            ..._pagamentos.map(p => p.cliente_id)
        ]).size;

        if (countClientes > 0) {
            btn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round">
                    <circle cx="12" cy="8" r="4"/>
                    <path d="M6 20v-2a6 6 0 0 1 12 0v2"/>
                </svg>
                Área do Cliente
                <span class="cf-btn-badge">${countClientes}</span>
                <span style="font-size:10px;color:var(--amber);margin-left:4px">${_fmtBRL(totDebito)}</span>`;
        } else {
            btn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round">
                    <circle cx="12" cy="8" r="4"/>
                    <path d="M6 20v-2a6 6 0 0 1 12 0v2"/>
                </svg>
                Área do Cliente`;
        }
    }

    // ── ACUMULADORES PARA O RESUMO DO FECHAMENTO ──────────────────────────
    function getTotalCredito() {
        // Débitos pendentes → viram crédito no fechamento
        return _lancamentos
            .filter(l => l.tipo_movimento === 'DEBITO' && l.gera_credito_fechamento)
            .reduce((a, l) => a + Number(l.valor_total || 0), 0);
    }

    function getTotalAbatimento() {
        // Pagamentos em dinheiro → abatimento da dívida (débito no fechamento)
        return _pagamentos
            .filter(p => p.gera_abatimento_divida && !p.gera_pix_quitacao)
            .reduce((a, p) => a + Number(p.valor_total || 0), 0);
    }

    function getTotalPixQuitacao() {
        // Pagamentos PIX validados → gera_pix_quitacao (quando admin confirmar)
        return _pagamentos
            .filter(p => p.gera_pix_quitacao)
            .reduce((a, p) => a + Number(p.valor_total || 0), 0);
    }

    // ── GRAVAÇÃO NO SUPABASE ───────────────────────────────────────────────
    async function gravarNoSupabase(fechamentoId, t1) {
        // Grava os lançamentos de débito
        for (const lanc of _lancamentos) {
            const { data: extrato, error: errExt } = await _sb
                .from('cliente_fechamento_extrato')
                .insert({
                    cliente_id: lanc.cliente_id,
                    loteria_id: _getLoteriaAtiva().id,
                    tipo_movimento: 'DEBITO',
                    status: 'PENDENTE',
                    valor_total: lanc.valor_total,
                    gera_credito_fechamento: true,
                    gera_abatimento_divida: false,
                    gera_pix_quitacao: false,
                    data_movimento: lanc.data_movimento,
                    fechamento_id: fechamentoId,
                    usuario_id: Number(t1.funcionario_id),
                    observacao: lanc.observacao || null
                })
                .select('id')
                .single();

            if (errExt) throw errExt;

            // Grava os itens
            if (lanc.itens?.length) {
                const itenRows = lanc.itens.map(it => ({
                    extrato_id: extrato.id,
                    tipo_origem: it.tipo_origem,
                    origem_id: it.origem_id || null,
                    data_venda: it.data_venda || lanc.data_movimento,
                    descricao: it.descricao || null,
                    modalidade: it.modalidade || null,
                    concurso: it.concurso ? String(it.concurso) : null,
                    produto: it.produto || null,
                    qtd_jogos: it.qtd_jogos || null,
                    qtd_dezenas: it.qtd_dezenas || null,
                    valor_unitario: Number(it.valor_unitario || 0),
                    qtd_vendida: Number(it.qtd_vendida || 1),
                    valor_total: Number(it.valor_total || 0)
                }));

                const { error: errIt } = await _sb
                    .from('cliente_fechamento_itens')
                    .insert(itenRows);

                if (errIt) throw errIt;
            }
        }

        // Grava os pagamentos
        for (const pag of _pagamentos) {
            const { error: errPag } = await _sb
                .from('cliente_fechamento_extrato')
                .insert({
                    cliente_id: pag.cliente_id,
                    loteria_id: _getLoteriaAtiva().id,
                    tipo_movimento: 'PAGAMENTO',
                    forma_pagamento: pag.forma_pagamento,
                    status: pag.status,
                    valor_total: pag.valor_total,
                    gera_credito_fechamento: false,
                    gera_abatimento_divida: pag.gera_abatimento_divida,
                    gera_pix_quitacao: pag.gera_pix_quitacao,
                    data_movimento: pag.data_movimento,
                    fechamento_id: fechamentoId,
                    usuario_id: Number(t1.funcionario_id),
                    observacao: pag.observacao || null
                });

            if (errPag) throw errPag;
        }
    }

    async function estornarDoFechamento(fechamentoId) {
        if (!fechamentoId) return;
        const { error } = await _sb
            .from('cliente_fechamento_extrato')
            .delete()
            .eq('fechamento_id', fechamentoId);
        if (error) throw error;
    }

    // ── RESET ──────────────────────────────────────────────────────────────
    function reset() {
        _clientes = [];
        _clienteAtivo = null;
        _carrinhoItens = [];
        _lancamentos = [];
        _pagamentos = [];
        renderChipResumo();

        const estado = _getEstado();
        if (estado.tela1) {
            estado.tela1.clienteFechamento = {
                clienteSelecionado: null,
                lancamentos: [],
                pagamentos: []
            };
        }
    }

    // ── HELPERS INTERNOS ──────────────────────────────────────────────────
    function _hoje() {
        return new Date().toISOString().slice(0, 10);
    }

    function _showCFError(id, msg) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
        }
    }

    // ── API PÚBLICA ───────────────────────────────────────────────────────
    return {
        init,
        openModal,
        closeModal,
        selecionarCliente,
        iniciarNovoCadastro,
        salvarNovoCadastro,
        abrirCarrinho,
        adicionarItemCarrinho,
        removerItemCarrinho,
        updateItem,
        confirmarDebito,
        abrirPagamento,
        confirmarPagamento,
        renderChipResumo,
        renderListaLancamentos,
        getTotalCredito,
        getTotalAbatimento,
        getTotalPixQuitacao,
        gravarNoSupabase,
        estornarDoFechamento,
        reset,
        // Para buscas reativas
        filtrarClientes: () => {
            _renderListaClientes();
        }
    };
})();

// Expõe globalmente
window.CF = CF;
