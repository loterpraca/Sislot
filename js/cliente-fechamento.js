(function (window) {
  'use strict';

  const CF = {
    ctx: null,
    state: {
      clientes: [],
      clienteSelecionado: null,
      extratoSalvo: [],
      pesquisa: '',
      loadingClientes: false,
      loadingExtrato: false,
      salvando: false,
      view: 'lista',
      draftDebito: { itens: [], observacao: '' },
      draftPagamento: { forma_pagamento: 'DINHEIRO', valor_total: '', observacao: '' },
    },

    async init(ctx) {
      if (!ctx || !ctx.sb) throw new Error('CF.init: sb é obrigatório');
      if (!ctx.ESTADO) throw new Error('CF.init: ESTADO é obrigatório');

      this.ctx = {
        fmtBRL: typeof ctx.fmtBRL === 'function' ? ctx.fmtBRL : this._fmtBRL,
        fmtData: typeof ctx.fmtData === 'function' ? ctx.fmtData : this._fmtData,
        rootSelector: ctx.rootSelector || '#cf-root',
        openerSelector: ctx.openerSelector || '#cf-open-wrap',
        sb: ctx.sb,
        usuario: ctx.usuario || {},
        ESTADO: ctx.ESTADO,
        loteriaAtiva: this._resolveLoteriaId(ctx.loteriaAtiva, ctx.usuario, ctx.ESTADO),
      };

      if (!this.ctx.loteriaAtiva) {
        throw new Error('CF.init: não foi possível resolver loteriaAtiva');
      }

      this._ensureEstado();
      this._renderShell();
      this._bindShellEvents();
      await this.carregarClientes();
      this._renderAll();
      return this;
    },

    reset() {
      this._ensureEstado(true);
      this.state.clienteSelecionado = null;
      this.state.extratoSalvo = [];
      this.state.pesquisa = '';
      this.state.view = 'lista';
      this.state.draftDebito = { itens: [], observacao: '' };
      this.state.draftPagamento = { forma_pagamento: 'DINHEIRO', valor_total: '', observacao: '' };
      this._renderAll();
    },

    getResumoSessao() {
      const sessao = this._sessao();
      const resumo = {
        total_cliente_credito: 0,
        total_cliente_abatimento_divida: 0,
        total_cliente_pix_quitacao: 0,
      };

      for (const row of sessao) {
        const valor = this._num(row.valor_total);
        if (!valor) continue;
        if (row.gera_credito_fechamento) resumo.total_cliente_credito += valor;
        if (row.gera_abatimento_divida) resumo.total_cliente_abatimento_divida += valor;
        if (row.gera_pix_quitacao) resumo.total_cliente_pix_quitacao += valor;
      }

      return resumo;
    },

    async gravarNoSupabase(fechamentoId) {
      this._assertReady();
      const sessao = [...this._sessao()];
      if (!sessao.length) return { ok: true, gravados: 0 };

      const sb = this.ctx.sb;
      const usuarioId = this._resolveUsuarioId(this.ctx.usuario, this.ctx.ESTADO);
      let gravados = 0;
      this.state.salvando = true;
      this._renderFooter();

      try {
        for (const lanc of sessao) {
          const payloadExtrato = {
            cliente_id: lanc.cliente_id,
            loteria_id: this.ctx.loteriaAtiva,
            tipo_movimento: lanc.tipo_movimento,
            forma_pagamento: lanc.forma_pagamento || null,
            status: lanc.status,
            valor_total: this._num(lanc.valor_total),
            gera_credito_fechamento: !!lanc.gera_credito_fechamento,
            gera_abatimento_divida: !!lanc.gera_abatimento_divida,
            gera_pix_quitacao: !!lanc.gera_pix_quitacao,
            data_movimento: lanc.data_movimento || this._todayISO(),
            fechamento_id: fechamentoId || null,
            usuario_id: usuarioId,
            observacao: lanc.observacao || null,
          };

          const { data: extratoInserido, error: errorExtrato } = await sb
            .from('cliente_fechamento_extrato')
            .insert(payloadExtrato)
            .select('id')
            .single();

          if (errorExtrato) throw errorExtrato;

          const extratoId = extratoInserido.id;
          const itens = Array.isArray(lanc.itens) ? lanc.itens : [];

          if (lanc.tipo_movimento === 'DEBITO' && itens.length) {
            const payloadItens = itens.map(item => ({
              extrato_id: extratoId,
              tipo_origem: item.tipo_origem,
              origem_id: this._nullableInt(item.origem_id),
              data_venda: item.data_venda || this._todayISO(),
              descricao: item.descricao || null,
              modalidade: item.modalidade || null,
              concurso: item.concurso || null,
              produto: item.produto || null,
              qtd_jogos: this._nullableInt(item.qtd_jogos),
              qtd_dezenas: this._nullableInt(item.qtd_dezenas),
              valor_unitario: this._num(item.valor_unitario),
              qtd_vendida: this._nullableInt(item.qtd_vendida) || 1,
              valor_total: this._num(item.valor_total),
            }));

            const { error: errorItens } = await sb
              .from('cliente_fechamento_itens')
              .insert(payloadItens);

            if (errorItens) {
              await sb.from('cliente_fechamento_extrato').delete().eq('id', extratoId);
              throw errorItens;
            }
          }

          gravados += 1;
        }

        this._ensureEstado(true);
        this.state.clienteSelecionado = null;
        this.state.extratoSalvo = [];
        this.state.view = 'lista';
        this.state.draftDebito = { itens: [], observacao: '' };
        this.state.draftPagamento = { forma_pagamento: 'DINHEIRO', valor_total: '', observacao: '' };
        await this.carregarClientes();
        this._renderAll();
        return { ok: true, gravados };
      } finally {
        this.state.salvando = false;
        this._renderFooter();
      }
    },

    async carregarClientes() {
      this._assertReady();
      this.state.loadingClientes = true;
      this._renderLista();

      const { data, error } = await this.ctx.sb
        .from('vw_cliente_fechamento_saldos')
        .select('*')
        .eq('loteria_id', this.ctx.loteriaAtiva)
        .order('nome', { ascending: true });

      this.state.loadingClientes = false;
      if (error) throw error;
      this.state.clientes = Array.isArray(data) ? data : [];
      this._renderLista();
      this._renderFooter();
      this._renderOpener();
    },

    async selecionarCliente(clienteId) {
      const cliente = this.state.clientes.find(c => String(c.cliente_id) === String(clienteId));
      if (!cliente) throw new Error('Cliente não encontrado');
      this.state.clienteSelecionado = cliente;
      this.state.view = 'cliente';
      this.state.loadingExtrato = true;
      this._renderCliente();

      const { data, error } = await this.ctx.sb
        .from('vw_cliente_fechamento_extrato')
        .select('*')
        .eq('loteria_id', this.ctx.loteriaAtiva)
        .eq('cliente_id', cliente.cliente_id)
        .order('data_movimento', { ascending: false })
        .order('created_at', { ascending: false });

      this.state.loadingExtrato = false;
      if (error) throw error;
      this.state.extratoSalvo = this._normalizarExtratoView(data || []);
      this._renderCliente();
      this._renderFooter();
    },

    async criarCliente(payload) {
      this._assertReady();
      const nome = String(payload?.nome || '').trim();
      if (!nome) throw new Error('Nome do cliente é obrigatório');

      const insertPayload = {
        loteria_id: this.ctx.loteriaAtiva,
        nome,
        telefone: this._cleanNullable(payload.telefone),
        documento: this._cleanNullable(payload.documento),
        observacao: this._cleanNullable(payload.observacao),
        ativo: true,
      };

      const { data, error } = await this.ctx.sb
        .from('cliente_fechamento_cadastro')
        .insert(insertPayload)
        .select('*')
        .single();

      if (error) throw error;
      await this.carregarClientes();
      await this.selecionarCliente(data.id);
      return data;
    },

    abrir() {
      const modal = this._el('cf-modal');
      if (!modal) return;
      modal.classList.add('show');
      document.body.style.overflow = 'hidden';
    },

    fechar() {
      const modal = this._el('cf-modal');
      if (!modal) return;
      modal.classList.remove('show');
      document.body.style.overflow = '';
      this.state.view = this.state.clienteSelecionado ? 'cliente' : 'lista';
      this._renderBody();
    },

    async refreshClienteAtual() {
      const clienteId = this.state.clienteSelecionado?.cliente_id;
      if (!clienteId) return;
      await this.carregarClientes();
      await this.selecionarCliente(clienteId);
    },

    salvarDebitoDaTela() {
      const cliente = this.state.clienteSelecionado;
      if (!cliente) throw new Error('Selecione um cliente');
      const draft = this.state.draftDebito;
      if (!Array.isArray(draft.itens) || !draft.itens.length) {
        throw new Error('Adicione pelo menos um item ao débito');
      }

      const itens = draft.itens
        .map(item => this._sanitizeItem(item))
        .filter(item => this._num(item.valor_total) > 0);

      if (!itens.length) throw new Error('Os itens do débito precisam ter valor');

      const valorTotal = this._round2(itens.reduce((acc, item) => acc + this._num(item.valor_total), 0));
      const registro = {
        local_id: this._uid(),
        cliente_id: cliente.cliente_id,
        cliente_nome: cliente.nome,
        tipo_movimento: 'DEBITO',
        forma_pagamento: null,
        status: 'PENDENTE',
        valor_total: valorTotal,
        observacao: this._cleanNullable(draft.observacao),
        data_movimento: this._todayISO(),
        gera_credito_fechamento: true,
        gera_abatimento_divida: false,
        gera_pix_quitacao: false,
        itens,
      };

      this._sessao().push(registro);
      this.state.draftDebito = { itens: [], observacao: '' };
      this.state.view = 'cliente';
      this._renderAll();
      return registro;
    },

    salvarPagamentoDaTela() {
      const cliente = this.state.clienteSelecionado;
      if (!cliente) throw new Error('Selecione um cliente');
      const draft = this.state.draftPagamento;
      const valorTotal = this._round2(this._num(draft.valor_total));
      if (!valorTotal || valorTotal <= 0) throw new Error('Informe um valor válido');

      const forma = draft.forma_pagamento === 'PIX' ? 'PIX' : 'DINHEIRO';
      const quitado = forma === 'DINHEIRO';

      const registro = {
        local_id: this._uid(),
        cliente_id: cliente.cliente_id,
        cliente_nome: cliente.nome,
        tipo_movimento: 'PAGAMENTO',
        forma_pagamento: forma,
        status: quitado ? 'QUITADO' : 'PROCESSAMENTO',
        valor_total: valorTotal,
        observacao: this._cleanNullable(draft.observacao),
        data_movimento: this._todayISO(),
        gera_credito_fechamento: false,
        gera_abatimento_divida: quitado,
        gera_pix_quitacao: false,
        itens: [],
      };

      this._sessao().push(registro);
      this.state.draftPagamento = { forma_pagamento: 'DINHEIRO', valor_total: '', observacao: '' };
      this.state.view = 'cliente';
      this._renderAll();
      return registro;
    },

    abrirNovoDebito() {
      this.state.draftDebito = { itens: [this._novoItem('CONTA')], observacao: '' };
      this.state.view = 'debito';
      this._renderBody();
      this._renderFooter();
    },

    abrirNovoPagamento() {
      this.state.draftPagamento = { forma_pagamento: 'DINHEIRO', valor_total: '', observacao: '' };
      this.state.view = 'pagamento';
      this._renderBody();
      this._renderFooter();
    },

    addItem(tipo) {
      this.state.draftDebito.itens.push(this._novoItem(tipo));
      this._renderBody();
    },

    removeItem(idx) {
      this.state.draftDebito.itens.splice(idx, 1);
      this._renderBody();
    },

    _renderAll() {
      this._renderOpener();
      this._renderBody();
      this._renderFooter();
    },

    _renderShell() {
      const openerWrap = document.querySelector(this.ctx.rootSelector) ? null : null;
      const openerTarget = document.querySelector(this.ctx.openerSelector);
      if (openerTarget && !this._el('cf-open-btn')) {
        openerTarget.innerHTML = '<button type="button" id="cf-open-btn" class="btn-area-cliente">Área do Cliente <span class="cf-btn-badge" id="cf-open-badge">0</span></button>';
      }

      let root = document.querySelector(this.ctx.rootSelector);
      if (!root) {
        root = document.createElement('div');
        root.id = String(this.ctx.rootSelector).replace(/^#/, '') || 'cf-root';
        document.body.appendChild(root);
      }

      root.innerHTML = `
        <div id="cf-modal" class="modal-cf" aria-hidden="true">
          <div class="modal-cf-box">
            <div class="modal-cf-header">
              <div class="modal-cf-title">Área do Cliente</div>
              <button type="button" class="modal-cf-close" id="cf-close-btn">×</button>
            </div>
            <div class="modal-cf-body" id="cf-body"></div>
            <div class="modal-cf-footer" id="cf-footer"></div>
          </div>
        </div>
      `;
    },

    _bindShellEvents() {
      const openBtn = this._el('cf-open-btn');
      if (openBtn && !openBtn.dataset.bound) {
        openBtn.dataset.bound = '1';
        openBtn.addEventListener('click', () => this.abrir());
      }

      const closeBtn = this._el('cf-close-btn');
      if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = '1';
        closeBtn.addEventListener('click', () => this.fechar());
      }

      const modal = this._el('cf-modal');
      if (modal && !modal.dataset.bound) {
        modal.dataset.bound = '1';
        modal.addEventListener('click', (ev) => {
          if (ev.target === modal) this.fechar();
        });
      }
    },

    _renderOpener() {
      const badge = this._el('cf-open-badge');
      if (badge) badge.textContent = String(this._sessao().length);
    },

    _renderBody() {
      if (this.state.view === 'cliente') return this._renderCliente();
      if (this.state.view === 'debito') return this._renderDebito();
      if (this.state.view === 'pagamento') return this._renderPagamento();
      return this._renderLista();
    },

    _renderLista() {
      const body = this._el('cf-body');
      if (!body) return;
      const pesquisa = String(this.state.pesquisa || '').trim().toLowerCase();
      const filtrados = this.state.clientes.filter(cli => {
        if (!pesquisa) return true;
        return [cli.nome, cli.telefone, cli.documento]
          .map(v => String(v || '').toLowerCase())
          .some(v => v.includes(pesquisa));
      });

      body.innerHTML = `
        <div class="cf-search-wrap">
          <input id="cf-search" type="text" placeholder="Buscar cliente por nome, telefone ou documento" value="${this._escAttr(this.state.pesquisa)}">
          <button type="button" id="cf-btn-novo-cliente" class="cf-btn-novo">Novo cliente</button>
        </div>
        <div class="cf-clientes-lista" id="cf-clientes-lista">
          ${this.state.loadingClientes ? '<div class="cf-empty"><div class="cf-empty-icon">⏳</div><div>Carregando clientes...</div></div>' : ''}
          ${!this.state.loadingClientes && !filtrados.length ? '<div class="cf-empty"><div class="cf-empty-icon">👤</div><div>Nenhum cliente encontrado.</div></div>' : ''}
          ${filtrados.map(cli => this._tplClienteCard(cli)).join('')}
        </div>
      `;

      const search = this._el('cf-search');
      if (search) {
        search.addEventListener('input', (ev) => {
          this.state.pesquisa = ev.target.value || '';
          this._renderLista();
        });
      }

      body.querySelectorAll('[data-cf-cliente-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await this.selecionarCliente(btn.dataset.cfClienteId);
          } catch (err) {
            this._toastError(err);
          }
        });
      });

      const novo = this._el('cf-btn-novo-cliente');
      if (novo) {
        novo.addEventListener('click', async () => {
          try {
            const nome = window.prompt('Nome do cliente:');
            if (!nome) return;
            const telefone = window.prompt('Telefone do cliente (opcional):') || '';
            const documento = window.prompt('Documento do cliente (opcional):') || '';
            const observacao = window.prompt('Observação (opcional):') || '';
            await this.criarCliente({ nome, telefone, documento, observacao });
          } catch (err) {
            this._toastError(err);
          }
        });
      }
    },

    _renderCliente() {
      const body = this._el('cf-body');
      const cli = this.state.clienteSelecionado;
      if (!body || !cli) return this._renderLista();

      const saldoTela = this._saldoTela(cli);
      const extratoSessao = this._extratoSessaoCliente(cli.cliente_id);

      body.innerHTML = `
        <button type="button" class="cf-btn-back" id="cf-back-lista">← Voltar</button>
        <div class="cf-cliente-header-box">
          <div class="cf-cli-nome-lg">${this._esc(cli.nome)}</div>
          <div class="cf-cli-tel">${this._esc(cli.telefone || 'sem telefone')}</div>
          <div class="cf-saldo-info">Saldo aberto: ${this.ctx.fmtBRL(saldoTela.saldo_aberto)} · Em processamento: ${this.ctx.fmtBRL(saldoTela.total_pagamentos_processamento)}</div>
        </div>
        <div class="cf-acoes">
          <button type="button" class="cf-btn-acao debito" id="cf-acao-debito">Lançar débito</button>
          <button type="button" class="cf-btn-acao pagamento" id="cf-acao-pagamento">Lançar pagamento</button>
        </div>
        <div class="cf-extrato-sessao" id="cf-extrato-combinado">
          ${this.state.loadingExtrato ? '<div class="cf-extrato-vazio">Carregando extrato...</div>' : ''}
          ${!this.state.loadingExtrato && !extratoSessao.length && !this.state.extratoSalvo.length ? '<div class="cf-extrato-vazio">Nenhum movimento para este cliente.</div>' : ''}
          ${extratoSessao.map(row => this._tplExtratoSessao(row)).join('')}
          ${this._tplExtratoSalvoAgrupado(this.state.extratoSalvo)}
        </div>
      `;

      this._el('cf-back-lista')?.addEventListener('click', () => {
        this.state.view = 'lista';
        this._renderBody();
        this._renderFooter();
      });

      this._el('cf-acao-debito')?.addEventListener('click', () => this.abrirNovoDebito());
      this._el('cf-acao-pagamento')?.addEventListener('click', () => this.abrirNovoPagamento());
    },

    _renderDebito() {
      const body = this._el('cf-body');
      const cli = this.state.clienteSelecionado;
      if (!body || !cli) return this._renderLista();
      const draft = this.state.draftDebito;
      const total = this._round2((draft.itens || []).reduce((acc, item) => acc + this._num(item.valor_total), 0));

      body.innerHTML = `
        <button type="button" class="cf-btn-back" id="cf-back-cliente">← Voltar</button>
        <div class="cf-cliente-header-box">
          <div class="cf-cli-nome-lg">Novo débito · ${this._esc(cli.nome)}</div>
        </div>
        <div class="cf-tipos-wrap">
          <button type="button" class="cf-btn-tipo" data-cf-add-tipo="BOLAO">Bolão</button>
          <button type="button" class="cf-btn-tipo" data-cf-add-tipo="FEDERAL">Federal</button>
          <button type="button" class="cf-btn-tipo" data-cf-add-tipo="PRODUTO">Produto</button>
          <button type="button" class="cf-btn-tipo" data-cf-add-tipo="CONTA">Conta</button>
        </div>
        <div class="cf-carrinho-itens">
          ${draft.itens.length ? draft.itens.map((item, idx) => this._tplItemDebito(item, idx)).join('') : '<div class="cf-empty"><div class="cf-empty-icon">🧾</div><div>Adicione itens ao débito.</div></div>'}
        </div>
        <div class="cf-total-bar">
          <div class="cf-total-label">Total do débito</div>
          <div class="cf-total-val">${this.ctx.fmtBRL(total)}</div>
        </div>
        <div class="cf-obs-field">
          <textarea id="cf-deb-obs" placeholder="Observação do débito">${this._esc(draft.observacao || '')}</textarea>
        </div>
      `;

      this._el('cf-back-cliente')?.addEventListener('click', () => {
        this.state.view = 'cliente';
        this._renderBody();
        this._renderFooter();
      });

      body.querySelectorAll('[data-cf-add-tipo]').forEach(btn => {
        btn.addEventListener('click', () => this.addItem(btn.dataset.cfAddTipo));
      });

      body.querySelectorAll('[data-cf-rm-item]').forEach(btn => {
        btn.addEventListener('click', () => this.removeItem(Number(btn.dataset.cfRmItem)));
      });

      body.querySelectorAll('[data-cf-item-idx]').forEach(inp => {
        inp.addEventListener('input', (ev) => {
          const idx = Number(ev.target.dataset.cfItemIdx);
          const field = ev.target.dataset.cfField;
          const value = ev.target.value;
          if (!this.state.draftDebito.itens[idx]) return;
          this.state.draftDebito.itens[idx][field] = value;
          this._recalcItem(this.state.draftDebito.itens[idx]);
          this._renderDebito();
          this._renderFooter();
        });
      });

      this._el('cf-deb-obs')?.addEventListener('input', (ev) => {
        this.state.draftDebito.observacao = ev.target.value || '';
      });
    },

    _renderPagamento() {
      const body = this._el('cf-body');
      const cli = this.state.clienteSelecionado;
      if (!body || !cli) return this._renderLista();

      const draft = this.state.draftPagamento;
      const saldoTela = this._saldoTela(cli);
      const avisoPix = draft.forma_pagamento === 'PIX'
        ? '<div class="cf-pag-aviso-pix">Pagamento em PIX entra como PROCESSAMENTO. A quitação real e os flags contábeis de PIX só serão ativados depois da confirmação do administrador.</div>'
        : '';

      body.innerHTML = `
        <button type="button" class="cf-btn-back" id="cf-back-cliente">← Voltar</button>
        <div class="cf-cliente-header-box">
          <div class="cf-cli-nome-lg">Novo pagamento · ${this._esc(cli.nome)}</div>
        </div>
        <div class="cf-pag-saldo-box">
          <div class="cf-pag-saldo-lbl">Saldo aberto atual</div>
          <div class="cf-pag-saldo-val">${this.ctx.fmtBRL(saldoTela.saldo_aberto)}</div>
        </div>
        <div class="cf-radio-group">
          <label class="cf-radio-label"><input type="radio" name="cf-pag-forma" value="DINHEIRO" ${draft.forma_pagamento === 'DINHEIRO' ? 'checked' : ''}> Dinheiro</label>
          <label class="cf-radio-label"><input type="radio" name="cf-pag-forma" value="PIX" ${draft.forma_pagamento === 'PIX' ? 'checked' : ''}> PIX</label>
        </div>
        ${avisoPix}
        <div class="cf-pag-valor-field">
          <label>Valor</label>
          <input id="cf-pag-valor" class="cf-inp" type="number" min="0" step="0.01" value="${this._escAttr(draft.valor_total)}" placeholder="0,00">
        </div>
        <div class="cf-obs-field">
          <textarea id="cf-pag-obs" placeholder="Observação do pagamento">${this._esc(draft.observacao || '')}</textarea>
        </div>
      `;

      this._el('cf-back-cliente')?.addEventListener('click', () => {
        this.state.view = 'cliente';
        this._renderBody();
        this._renderFooter();
      });

      body.querySelectorAll('input[name="cf-pag-forma"]').forEach(inp => {
        inp.addEventListener('change', (ev) => {
          this.state.draftPagamento.forma_pagamento = ev.target.value;
          this._renderPagamento();
          this._renderFooter();
        });
      });

      this._el('cf-pag-valor')?.addEventListener('input', (ev) => {
        this.state.draftPagamento.valor_total = ev.target.value || '';
      });
      this._el('cf-pag-obs')?.addEventListener('input', (ev) => {
        this.state.draftPagamento.observacao = ev.target.value || '';
      });
    },

    _renderFooter() {
      const footer = this._el('cf-footer');
      if (!footer) return;

      const resumo = this.getResumoSessao();
      const salvarLabel = this.state.salvando ? 'Gravando...' : 'Fechar';
      let acaoHtml = '<button type="button" class="cf-btn-secondary" id="cf-footer-fechar">Fechar</button>';

      if (this.state.view === 'debito') {
        acaoHtml += '<button type="button" class="cf-btn-primary" id="cf-footer-salvar-debito">Salvar débito na sessão</button>';
      } else if (this.state.view === 'pagamento') {
        acaoHtml += '<button type="button" class="cf-btn-primary" id="cf-footer-salvar-pagamento">Salvar pagamento na sessão</button>';
      }

      footer.innerHTML = `
        <div class="cf-resumo-bloco">
          <div class="cf-resumo-row"><span>Crédito por débito lançado</span><span class="cf-rval">${this.ctx.fmtBRL(resumo.total_cliente_credito)}</span></div>
          <div class="cf-resumo-row"><span>Abatimento de dívida</span><span class="cf-rval">${this.ctx.fmtBRL(resumo.total_cliente_abatimento_divida)}</span></div>
          <div class="cf-resumo-row"><span>PIX quitação</span><span class="cf-rval">${this.ctx.fmtBRL(resumo.total_cliente_pix_quitacao)}</span></div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-left:auto;">
          ${acaoHtml}
        </div>
      `;

      this._el('cf-footer-fechar')?.addEventListener('click', () => this.fechar());
      this._el('cf-footer-salvar-debito')?.addEventListener('click', () => {
        try {
          this.salvarDebitoDaTela();
        } catch (err) {
          this._toastError(err);
        }
      });
      this._el('cf-footer-salvar-pagamento')?.addEventListener('click', () => {
        try {
          this.salvarPagamentoDaTela();
        } catch (err) {
          this._toastError(err);
        }
      });
    },

    _tplClienteCard(cli) {
      const saldo = this._num(cli.saldo_aberto);
      const proc = this._num(cli.total_pagamentos_processamento);
      return `
        <div class="cf-cliente-card ${saldo > 0 ? 'tem-divida' : ''}" data-cf-cliente-id="${this._escAttr(cli.cliente_id)}">
          <div class="cf-cli-info">
            <div class="cf-cli-nome">${this._esc(cli.nome)}</div>
            <div class="cf-cli-tel">${this._esc(cli.telefone || 'sem telefone')}</div>
          </div>
          <div class="cf-cli-saldo">
            ${saldo > 0 ? `<span class="cf-badge-devendo">${this.ctx.fmtBRL(saldo)}</span>` : '<span class="cf-badge-ok">sem saldo</span>'}
            ${proc > 0 ? `<span class="cf-badge-ok">PIX proc. ${this.ctx.fmtBRL(proc)}</span>` : ''}
          </div>
        </div>
      `;
    },

    _tplExtratoSessao(row) {
      const label = row.tipo_movimento === 'DEBITO' ? 'Sessão · débito' : `Sessão · pagamento ${row.forma_pagamento || ''}`;
      const itens = Array.isArray(row.itens) ? row.itens : [];
      return `
        <div class="cf-extrato-linha ${row.tipo_movimento === 'DEBITO' ? 'cf-extrato-deb' : 'cf-extrato-pag'}">
          <div class="cf-extrato-top">
            <div class="cf-extrato-tipo">${this._esc(label)} · ${this._esc(row.status)}</div>
            <div>${this.ctx.fmtBRL(row.valor_total)}</div>
          </div>
          ${itens.length ? `<div class="cf-extrato-itens">${itens.map(item => `<div class="cf-extrato-item"><span>${this._esc(item.tipo_origem)} · ${this._esc(item.descricao || item.produto || item.modalidade || 'item')}</span><span>${this.ctx.fmtBRL(item.valor_total)}</span></div>`).join('')}</div>` : ''}
          <div class="cf-extrato-bottom">
            <span>${this.ctx.fmtData(row.data_movimento)}</span>
            ${row.observacao ? `<span>· ${this._esc(row.observacao)}</span>` : ''}
          </div>
        </div>
      `;
    },

    _tplExtratoSalvoAgrupado(rows) {
      if (!Array.isArray(rows) || !rows.length) return '';
      return rows.map(row => {
        const itens = Array.isArray(row.itens) ? row.itens : [];
        const label = row.tipo_movimento === 'DEBITO' ? 'Banco · débito' : `Banco · pagamento ${row.forma_pagamento || ''}`;
        return `
          <div class="cf-extrato-linha ${row.tipo_movimento === 'DEBITO' ? 'cf-extrato-deb' : 'cf-extrato-pag'}">
            <div class="cf-extrato-top">
              <div class="cf-extrato-tipo">${this._esc(label)} · ${this._esc(row.status)}</div>
              <div>${this.ctx.fmtBRL(row.valor_movimento)}</div>
            </div>
            ${itens.length ? `<div class="cf-extrato-itens">${itens.map(item => `<div class="cf-extrato-item"><span>${this._esc(item.tipo_origem)} · ${this._esc(item.descricao || item.produto || item.modalidade || 'item')}</span><span>${this.ctx.fmtBRL(item.valor_item)}</span></div>`).join('')}</div>` : ''}
            <div class="cf-extrato-bottom">
              <span>${this.ctx.fmtData(row.data_movimento)}</span>
              ${row.observacao ? `<span>· ${this._esc(row.observacao)}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    },

    _tplItemDebito(item, idx) {
      const tipo = item.tipo_origem;
      const badgeClass = String(tipo || '').toLowerCase();
      const subtotal = this._num(item.valor_total);
      return `
        <div class="cf-carrinho-item">
          <div class="cf-item-head">
            <span class="cf-tipo-badge ${badgeClass}">${this._esc(tipo)}</span>
            <button type="button" class="cf-btn-rm-item" data-cf-rm-item="${idx}">×</button>
          </div>
          <div class="cf-item-campos">
            ${this._field(idx, 'data_venda', 'Data', item.data_venda || this._todayISO(), 'date')}
            ${tipo === 'PRODUTO' ? this._field(idx, 'produto', 'Produto', item.produto || '') : this._field(idx, 'descricao', 'Descrição', item.descricao || '')}
            ${(tipo === 'BOLAO' || tipo === 'FEDERAL') ? this._field(idx, 'modalidade', 'Modalidade', item.modalidade || '') : ''}
            ${(tipo === 'BOLAO' || tipo === 'FEDERAL') ? this._field(idx, 'concurso', 'Concurso', item.concurso || '') : ''}
            ${tipo === 'BOLAO' ? this._field(idx, 'qtd_jogos', 'Qtd jogos', item.qtd_jogos || '', 'number') : ''}
            ${tipo === 'BOLAO' ? this._field(idx, 'qtd_dezenas', 'Qtd dezenas', item.qtd_dezenas || '', 'number') : ''}
            ${this._field(idx, 'valor_unitario', 'Valor unitário', item.valor_unitario || '', 'number', '0.01')}
            ${this._field(idx, 'qtd_vendida', 'Quantidade', item.qtd_vendida || 1, 'number', '1')}
          </div>
          <div class="cf-item-subtotal">Subtotal: <strong>${this.ctx.fmtBRL(subtotal)}</strong></div>
        </div>
      `;
    },

    _field(idx, field, label, value, type = 'text', step = null) {
      return `
        <label class="cf-campo">
          <span class="cf-campo-label">${this._esc(label)}</span>
          <input class="cf-inp" type="${type}" ${step ? `step="${step}"` : ''} value="${this._escAttr(value)}" data-cf-item-idx="${idx}" data-cf-field="${field}">
        </label>
      `;
    },

    _normalizarExtratoView(rows) {
      const mapa = new Map();
      for (const row of rows) {
        const id = row.extrato_id;
        if (!mapa.has(id)) {
          mapa.set(id, {
            extrato_id: row.extrato_id,
            cliente_id: row.cliente_id,
            loteria_id: row.loteria_id,
            tipo_movimento: row.tipo_movimento,
            forma_pagamento: row.forma_pagamento,
            status: row.status,
            valor_movimento: this._num(row.valor_movimento),
            data_movimento: row.data_movimento,
            fechamento_id: row.fechamento_id,
            usuario_id: row.usuario_id,
            observacao: row.observacao,
            confirmado_por: row.confirmado_por,
            confirmado_em: row.confirmado_em,
            created_at: row.created_at,
            itens: [],
          });
        }
        if (row.item_id) {
          mapa.get(id).itens.push({
            item_id: row.item_id,
            tipo_origem: row.tipo_origem,
            origem_id: row.origem_id,
            data_venda: row.data_venda,
            descricao: row.descricao,
            modalidade: row.modalidade,
            concurso: row.concurso,
            produto: row.produto,
            qtd_jogos: row.qtd_jogos,
            qtd_dezenas: row.qtd_dezenas,
            valor_unitario: this._num(row.valor_unitario),
            qtd_vendida: row.qtd_vendida,
            valor_item: this._num(row.valor_item),
          });
        }
      }
      return [...mapa.values()];
    },

    _saldoTela(cli) {
      const sessaoCli = this._extratoSessaoCliente(cli.cliente_id);
      let debitosSessao = 0;
      let quitadosSessao = 0;
      let procSessao = 0;
      for (const row of sessaoCli) {
        const valor = this._num(row.valor_total);
        if (row.tipo_movimento === 'DEBITO') debitosSessao += valor;
        if (row.tipo_movimento === 'PAGAMENTO' && row.status === 'QUITADO') quitadosSessao += valor;
        if (row.tipo_movimento === 'PAGAMENTO' && row.status === 'PROCESSAMENTO') procSessao += valor;
      }
      return {
        saldo_aberto: this._round2(this._num(cli.saldo_aberto) + debitosSessao - quitadosSessao),
        total_pagamentos_processamento: this._round2(this._num(cli.total_pagamentos_processamento) + procSessao),
      };
    },

    _extratoSessaoCliente(clienteId) {
      return this._sessao().filter(row => String(row.cliente_id) === String(clienteId));
    },

    _sanitizeItem(item) {
      const out = {
        tipo_origem: item.tipo_origem || 'CONTA',
        origem_id: item.origem_id || null,
        data_venda: item.data_venda || this._todayISO(),
        descricao: this._cleanNullable(item.descricao),
        modalidade: this._cleanNullable(item.modalidade),
        concurso: this._cleanNullable(item.concurso),
        produto: this._cleanNullable(item.produto),
        qtd_jogos: this._nullableInt(item.qtd_jogos),
        qtd_dezenas: this._nullableInt(item.qtd_dezenas),
        valor_unitario: this._num(item.valor_unitario),
        qtd_vendida: this._nullableInt(item.qtd_vendida) || 1,
        valor_total: this._num(item.valor_total),
      };
      if (!out.descricao && !out.produto && !out.modalidade) {
        out.descricao = 'Lançamento manual';
      }
      return out;
    },

    _recalcItem(item) {
      item.qtd_vendida = this._nullableInt(item.qtd_vendida) || 1;
      item.valor_unitario = this._num(item.valor_unitario);
      item.valor_total = this._round2(item.valor_unitario * item.qtd_vendida);
    },

    _novoItem(tipo) {
      return {
        tipo_origem: tipo || 'CONTA',
        origem_id: null,
        data_venda: this._todayISO(),
        descricao: '',
        modalidade: '',
        concurso: '',
        produto: '',
        qtd_jogos: '',
        qtd_dezenas: '',
        valor_unitario: '',
        qtd_vendida: 1,
        valor_total: 0,
      };
    },

    _sessao() {
      this._ensureEstado();
      return this.ctx.ESTADO.areaCliente.lancamentosSessao;
    },

    _ensureEstado(reset = false) {
      if (!this.ctx) {
        this.ctx = { ESTADO: { areaCliente: { lancamentosSessao: [] } } };
      }
      if (!this.ctx.ESTADO.areaCliente || reset) {
        this.ctx.ESTADO.areaCliente = {
          lancamentosSessao: [],
        };
      }
    },

    _resolveLoteriaId(loteriaAtiva, usuario, ESTADO) {
      return loteriaAtiva
        || usuario?.loteria_id
        || usuario?.loteriaId
        || ESTADO?.loteriaAtiva
        || ESTADO?.usuarioLogado?.loteria_id
        || ESTADO?.usuario?.loteria_id
        || null;
    },

    _resolveUsuarioId(usuario, ESTADO) {
      return usuario?.usuario_id
        || usuario?.id
        || usuario?.user_id
        || ESTADO?.usuarioLogado?.usuario_id
        || ESTADO?.usuarioLogado?.id
        || ESTADO?.usuario?.usuario_id
        || ESTADO?.usuario?.id
        || null;
    },

    _assertReady() {
      if (!this.ctx || !this.ctx.sb) throw new Error('CF não inicializado');
    },

    _toastError(err) {
      const msg = err?.message || String(err) || 'Erro inesperado';
      window.alert(msg);
    },

    _fmtBRL(v) {
      return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },

    _fmtData(v) {
      if (!v) return '-';
      const d = new Date(String(v).length <= 10 ? `${v}T12:00:00` : v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString('pt-BR');
    },

    _uid() {
      return `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    },

    _todayISO() {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },

    _round2(v) {
      return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
    },

    _num(v) {
      if (v === null || v === undefined || v === '') return 0;
      if (typeof v === 'number') return this._round2(v);
      const s = String(v).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
      const n = Number(s);
      return Number.isFinite(n) ? this._round2(n) : 0;
    },

    _nullableInt(v) {
      if (v === null || v === undefined || v === '') return null;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    },

    _cleanNullable(v) {
      const s = String(v ?? '').trim();
      return s || null;
    },

    _esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    _escAttr(s) {
      return this._esc(s).replace(/`/g, '&#96;');
    },

    _el(id) {
      return document.getElementById(id);
    },
  };

  window.CF = CF;
})(window);
