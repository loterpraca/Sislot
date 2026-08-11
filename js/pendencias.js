(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const estado = {
    usuario: null,
    lojas: [],
    loja: null,
    funcionarios: [],
    funcionario: null,
    clientes: [],
    clientesFiltrados: [],
    cliente: null,
    forma: 'DINHEIRO',
    extrato: [],
    operacaoId: null,
    salvando: false
  };

  const fmtBRL = (v) =>
    Number(v || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });

  const fmtData = (iso) => {
    if (!iso) return '—';
    const [y,m,d] = String(iso).slice(0,10).split('-');
    return y && m && d ? `${d}/${m}/${y}` : '—';
  };

  const hojeSP = () => {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(new Date());
    const get = (t) => partes.find(p => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };

  const normalizar = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  function numeroMoeda(valor) {
    let s = String(valor ?? '').trim();
    if (!s) return 0;

    if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    }
    s = s.replace(/[^\d.-]/g, '');

    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  function valorInput(v) {
    return Number(v || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function iniciarRelogio() {
    const tick = () => {
      const el = $('relogio');
      if (!el) return;
      const agora = new Date();
      el.textContent = new Intl.DateTimeFormat('pt-BR', {
        timeZone:'America/Sao_Paulo',
        hour:'2-digit',
        minute:'2-digit',
        second:'2-digit',
        day:'2-digit',
        month:'2-digit',
        year:'numeric'
      }).format(agora);
    };
    tick();
    setInterval(tick, 1000);
  }

  function toast(titulo, detalhe = '', tipo = 'ok') {
    const stack = $('toastStack');
    const el = document.createElement('div');
    el.className = `toast ${tipo}`;
    el.innerHTML = `
      <i class="fas ${tipo === 'ok' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i>
      <div><strong>${escapeHtml(titulo)}</strong><span>${escapeHtml(detalhe)}</span></div>
    `;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }

  function normalizarLoja(loja) {
    const id = Number(loja?.loteria_id ?? loja?.id ?? 0);
    const slug = String(loja?.loteria_slug ?? loja?.slug ?? '').trim();
    return {
      id,
      nome: String(loja?.loteria_nome ?? loja?.nome ?? slug ?? 'Loja'),
      slug,
      principal: !!loja?.principal,
      logo: loja?.logo_url ?? loja?.loteria_logo_url ?? loja?.logo_path ?? '',
      tema: loja?.tema ?? loja?.loteria_tema ?? slug ?? 'centro'
    };
  }

  function aplicarLoja(loja) {
    estado.loja = loja;
    const tema = loja?.tema || loja?.slug || 'centro';
    document.body.dataset.loja = tema;
    document.documentElement.dataset.loja = tema;

    $('headerTitle').textContent = loja?.nome || 'SISLOT';

    const img = $('logoImg');
    if (img) {
      img.onerror = () => {
        img.onerror = null;
        img.src = './icons/centro.png';
      };
      img.src = loja?.logo || (loja?.slug ? `./icons/${loja.slug}.png` : './icons/centro.png');
      img.alt = loja?.nome || 'Loja';
    }
  }

  async function bootstrap() {
    iniciarRelogio();

    try {
      if (!window.SISLOT_SB) {
        throw new Error('SISLOT_SB não inicializado. Confira sislot-security.js.');
      }

      const ctx = await window.SISLOT_SECURITY.protegerPagina('fechamento');
      if (!ctx) return;

      estado.usuario = ctx.usuario;

      if (!['ADMIN','SOCIO'].includes(String(estado.usuario?.perfil || '').toUpperCase())) {
        alert('A área Pendências é restrita a administradores e sócios.');
        window.SISLOT_SECURITY.irParaInicio();
        return;
      }

      $('usuarioAcesso').textContent =
        `${estado.usuario.nome || 'Usuário'} • ${String(estado.usuario.perfil || '').toUpperCase()}`;

      estado.lojas = (ctx.lojasPermitidas || [])
        .map(normalizarLoja)
        .filter(l => l.id);

      if (!estado.lojas.length) {
        throw new Error('Nenhuma loja disponível para este usuário.');
      }

      const inicial =
        estado.lojas.find(l => l.principal) ||
        normalizarLoja(ctx.lojaInicial) ||
        estado.lojas[0];

      montarSelectLojas(inicial);
      aplicarLoja(inicial);
      bindEventos();

      await carregarDashboard();
    } catch (err) {
      console.error('[Pendências] Erro ao iniciar:', err);
      toast('Erro ao iniciar Pendências', err.message || String(err), 'err');
    }
  }

  function bindEventos() {
    $('filtroLoja').addEventListener('change', async (e) => {
      const loja = estado.lojas.find(l => String(l.id) === String(e.target.value));
      if (!loja) return;
      aplicarLoja(loja);
      resetSelecoes();
      await carregarDashboard();
    });

    $('btnAtualizar').addEventListener('click', () => carregarDashboard(true));
    $('btnInicio').addEventListener('click', () => window.SISLOT_SECURITY.irParaInicio());
    $('btnSair').addEventListener('click', () => window.SISLOT_SECURITY.sair());

    $('lojaTreeWrap').addEventListener('click', async () => {
      if (estado.lojas.length <= 1) return;
      const i = estado.lojas.findIndex(l => l.id === estado.loja?.id);
      const prox = estado.lojas[(i + 1) % estado.lojas.length];
      $('filtroLoja').value = String(prox.id);
      aplicarLoja(prox);
      resetSelecoes();
      await carregarDashboard();
    });

    $('buscaCliente').addEventListener('input', aplicarBusca);

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        $('buscaCliente').focus();
      }
      if (e.key === 'Escape') fecharModal();
    });

    document.querySelectorAll('.seg').forEach(btn => {
      btn.addEventListener('click', () => {
        estado.forma = btn.dataset.forma;
        document.querySelectorAll('.seg').forEach(x => x.classList.toggle('active', x === btn));
      });
    });

    $('valorPagamento').addEventListener('input', atualizarPreview);
    $('valorPagamento').addEventListener('blur', () => {
      const v = numeroMoeda($('valorPagamento').value);
      $('valorPagamento').value = v > 0 ? valorInput(v) : '';
      atualizarPreview();
    });

    $('btnQuitarTotal').addEventListener('click', () => {
      if (!estado.cliente) return;
      $('valorPagamento').value = valorInput(estado.cliente.saldo_aberto);
      atualizarPreview();
      $('valorPagamento').focus();
    });

    $('btnRegistrar').addEventListener('click', abrirModalConfirmacao);
    $('btnFecharModal').addEventListener('click', fecharModal);
    $('btnCancelarModal').addEventListener('click', fecharModal);
    $('btnConfirmarModal').addEventListener('click', registrarAbatimento);

    $('modalConfirmacao').addEventListener('click', (e) => {
      if (e.target === $('modalConfirmacao')) fecharModal();
    });
  }

  function montarSelectLojas(inicial) {
    const sel = $('filtroLoja');
    sel.innerHTML = estado.lojas
      .map(l => `<option value="${l.id}">${escapeHtml(l.nome)}</option>`)
      .join('');
    sel.value = String(inicial.id);
  }

  function resetSelecoes() {
    estado.funcionario = null;
    estado.clientes = [];
    estado.clientesFiltrados = [];
    estado.cliente = null;
    estado.extrato = [];
    $('buscaCliente').value = '';
    $('buscaCliente').disabled = true;
    renderClientesVazio('Selecione um funcionário', 'Os clientes com saldo aparecerão aqui.');
    ocultarDetalhe();
  }

  async function carregarDashboard(silencioso = false) {
    if (!estado.loja?.id) return;

    const sb = window.SISLOT_SB;
    const funcAnterior = estado.funcionario?.funcionario_id;

    if (!silencioso) {
      $('funcList').innerHTML = `
        <div class="state"><span class="spinner"></span><strong>Carregando</strong><small>Atualizando pendências...</small></div>`;
    }

    const { data, error } = await sb
      .from('vw_pendencias_funcionarios')
      .select('loteria_id,funcionario_id,funcionario_nome,perfil,clientes_pendentes,saldo_total')
      .eq('loteria_id', Number(estado.loja.id))
      .gt('clientes_pendentes', 0)
      .order('saldo_total', { ascending: false });

    if (error) throw error;

    estado.funcionarios = data || [];
    renderFuncionarios();
    atualizarKPIs();

    if (funcAnterior) {
      const existe = estado.funcionarios.find(f => Number(f.funcionario_id) === Number(funcAnterior));
      if (existe) {
        await selecionarFuncionario(existe, { preservarCliente: true });
      }
    }
  }

  function atualizarKPIs() {
    const funcs = estado.funcionarios || [];
    const total = funcs.reduce((a,f) => a + Number(f.saldo_total || 0), 0);
    const clientes = funcs.reduce((a,f) => a + Number(f.clientes_pendentes || 0), 0);

    $('kpiTotal').textContent = fmtBRL(total);
    $('kpiClientes').textContent = String(clientes);
    $('kpiFuncionarios').textContent = String(funcs.length);
  }

  function renderFuncionarios() {
    const wrap = $('funcList');
    $('funcCount').textContent = String(estado.funcionarios.length);

    if (!estado.funcionarios.length) {
      wrap.innerHTML = `
        <div class="state">
          <i class="fas fa-circle-check"></i>
          <strong>Nenhuma pendência</strong>
          <small>Não existem saldos abertos nesta loja.</small>
        </div>`;
      return;
    }

    wrap.innerHTML = estado.funcionarios.map(f => `
      <button type="button"
              class="func-card ${Number(f.funcionario_id) === Number(estado.funcionario?.funcionario_id) ? 'active' : ''}"
              data-func="${f.funcionario_id}">
        <div class="func-top">
          <span class="func-name">${escapeHtml(f.funcionario_nome)}</span>
          <span class="func-value">${fmtBRL(f.saldo_total)}</span>
        </div>
        <div class="func-meta">
          <span class="func-badge">${Number(f.clientes_pendentes || 0)} cliente${Number(f.clientes_pendentes) === 1 ? '' : 's'}</span>
          <span>${escapeHtml(f.perfil || '')}</span>
        </div>
      </button>
    `).join('');

    wrap.querySelectorAll('[data-func]').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = estado.funcionarios.find(x => String(x.funcionario_id) === btn.dataset.func);
        if (f) selecionarFuncionario(f);
      });
    });
  }

  async function selecionarFuncionario(funcionario, opts = {}) {
    const clienteAnterior = opts.preservarCliente ? estado.cliente?.cliente_id : null;
    estado.funcionario = funcionario;
    estado.cliente = null;
    renderFuncionarios();
    ocultarDetalhe();

    $('buscaCliente').disabled = false;
    $('buscaCliente').value = '';

    const wrap = $('clienteList');
    wrap.innerHTML = `
      <div class="state"><span class="spinner"></span><strong>Carregando</strong><small>Buscando clientes...</small></div>`;

    const { data, error } = await window.SISLOT_SB
      .from('vw_pendencias_clientes')
      .select(`
        cliente_id,loteria_id,funcionario_id,funcionario_nome,
        cliente_nome,telefone,documento,total_debitos,
        total_pagamentos_quitados,saldo_aberto,qtd_debitos,
        qtd_pagamentos_quitados,ultimo_debito_em,ultimo_pagamento_em,
        ultima_movimentacao_em
      `)
      .eq('loteria_id', Number(estado.loja.id))
      .eq('funcionario_id', Number(funcionario.funcionario_id))
      .gt('saldo_aberto', 0)
      .order('saldo_aberto', { ascending: false });

    if (error) {
      renderClientesVazio('Erro ao carregar', error.message);
      throw error;
    }

    estado.clientes = data || [];
    estado.clientesFiltrados = [...estado.clientes];
    renderClientes();

    if (clienteAnterior) {
      const c = estado.clientes.find(x => x.cliente_id === clienteAnterior);
      if (c) await selecionarCliente(c);
    }
  }

  function aplicarBusca() {
    const q = normalizar($('buscaCliente').value);
    estado.clientesFiltrados = !q
      ? [...estado.clientes]
      : estado.clientes.filter(c =>
          normalizar(c.cliente_nome).includes(q) ||
          normalizar(c.telefone).includes(q) ||
          normalizar(c.documento).includes(q)
        );
    renderClientes();
  }

  function renderClientesVazio(titulo, subtitulo) {
    $('clienteCount').textContent = '0';
    $('clienteList').innerHTML = `
      <div class="state">
        <i class="fas fa-user"></i>
        <strong>${escapeHtml(titulo)}</strong>
        <small>${escapeHtml(subtitulo)}</small>
      </div>`;
  }

  function renderClientes() {
    const wrap = $('clienteList');
    $('clienteCount').textContent = String(estado.clientesFiltrados.length);

    if (!estado.clientesFiltrados.length) {
      renderClientesVazio('Nenhum cliente encontrado', 'Ajuste a busca ou selecione outro funcionário.');
      return;
    }

    wrap.innerHTML = estado.clientesFiltrados.map(c => `
      <button type="button"
              class="client-card ${c.cliente_id === estado.cliente?.cliente_id ? 'active' : ''}"
              data-cliente="${c.cliente_id}">
        <div class="client-top">
          <span class="client-name">${escapeHtml(c.cliente_nome)}</span>
          <span class="client-value">${fmtBRL(c.saldo_aberto)}</span>
        </div>
        <div class="client-meta-line">
          <span>${Number(c.qtd_debitos || 0)} débito${Number(c.qtd_debitos) === 1 ? '' : 's'}</span>
          ${Number(c.qtd_pagamentos_quitados || 0) > 0
            ? `<span>• ${Number(c.qtd_pagamentos_quitados)} pagamento(s)</span>`
            : ''}
        </div>
      </button>
    `).join('');

    wrap.querySelectorAll('[data-cliente]').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = estado.clientes.find(x => x.cliente_id === btn.dataset.cliente);
        if (c) selecionarCliente(c);
      });
    });
  }

  async function selecionarCliente(cliente) {
    estado.cliente = cliente;
    renderClientes();
    mostrarDetalhe(cliente);
    await carregarExtrato();
  }

  function mostrarDetalhe(c) {
    $('detalheVazio').hidden = true;
    $('detalheConteudo').hidden = false;

    $('detClienteNome').textContent = c.cliente_nome || 'Cliente';
    $('detFuncionario').textContent = estado.funcionario?.funcionario_nome || c.funcionario_nome || '—';
    $('detTelefone').textContent = c.telefone || 'Sem telefone';
    $('detSaldo').textContent = fmtBRL(c.saldo_aberto);
    $('detDebitos').textContent = fmtBRL(c.total_debitos);
    $('detPagamentos').textContent = fmtBRL(c.total_pagamentos_quitados);
    $('detUltimoDebito').textContent = fmtData(c.ultimo_debito_em);

    limparFormulario();
  }

  function ocultarDetalhe() {
    $('detalheVazio').hidden = false;
    $('detalheConteudo').hidden = true;
  }

  function limparFormulario() {
    $('valorPagamento').value = '';
    $('observacao').value = '';
    estado.forma = 'DINHEIRO';
    document.querySelectorAll('.seg').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.forma === 'DINHEIRO');
    });
    atualizarPreview();
  }

  function atualizarPreview() {
    const saldo = Number(estado.cliente?.saldo_aberto || 0);
    let valor = numeroMoeda($('valorPagamento').value);
    if (valor > saldo) valor = saldo;
    const novo = Math.max(saldo - valor, 0);

    $('novoSaldoPreview').textContent = fmtBRL(novo);

    const valido = !!estado.cliente && valor > 0 && valor <= saldo && !estado.salvando;
    $('btnRegistrar').disabled = !valido;
  }

  async function carregarExtrato() {
    const c = estado.cliente;
    const f = estado.funcionario;
    if (!c || !f) return;

    $('extratoList').innerHTML = `
      <div class="state"><span class="spinner"></span><strong>Carregando extrato</strong></div>`;

    const { data, error } = await window.SISLOT_SB
      .from('vw_pendencias_extrato')
      .select(`
        extrato_id,tipo_movimento,forma_pagamento,status,valor_total,
        data_movimento,observacao,lancado_por_nome,created_at
      `)
      .eq('loteria_id', Number(estado.loja.id))
      .eq('funcionario_id', Number(f.funcionario_id))
      .eq('cliente_id', c.cliente_id)
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) throw error;

    estado.extrato = data || [];
    renderExtrato();
  }

  function renderExtrato() {
    const wrap = $('extratoList');
    $('extratoCount').textContent =
      `${estado.extrato.length} movimento${estado.extrato.length === 1 ? '' : 's'}`;

    if (!estado.extrato.length) {
      wrap.innerHTML = `<div class="state"><strong>Sem movimentos</strong></div>`;
      return;
    }

    wrap.innerHTML = estado.extrato.map(m => {
      const pagamento = m.tipo_movimento === 'PAGAMENTO';
      const forma = pagamento && m.forma_pagamento ? ` • ${m.forma_pagamento}` : '';
      const por = m.lancado_por_nome ? ` • por ${m.lancado_por_nome}` : '';
      return `
        <div class="mov ${pagamento ? 'pagamento' : 'debito'}">
          <div class="mov-icon">
            <i class="fas ${pagamento ? 'fa-arrow-down' : 'fa-arrow-up'}"></i>
          </div>
          <div class="mov-main">
            <strong>${pagamento ? 'Pagamento' : 'Débito'}${escapeHtml(forma)}</strong>
            <span>${fmtData(m.data_movimento)}${escapeHtml(por)}${m.observacao ? ` • ${escapeHtml(m.observacao)}` : ''}</span>
          </div>
          <div class="mov-val">${pagamento ? '−' : '+'} ${fmtBRL(m.valor_total)}</div>
        </div>`;
    }).join('');
  }

  function abrirModalConfirmacao() {
    if (!estado.cliente || !estado.funcionario) return;

    const valor = numeroMoeda($('valorPagamento').value);
    const saldo = Number(estado.cliente.saldo_aberto || 0);

    if (!(valor > 0) || valor > saldo) {
      toast('Valor inválido', 'Informe um valor entre R$ 0,01 e o saldo atual.', 'err');
      return;
    }

    estado.operacaoId =
      (window.crypto?.randomUUID?.() ||
       `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    $('modalCliente').textContent = estado.cliente.cliente_nome;
    $('modalFuncionario').textContent = estado.funcionario.funcionario_nome;
    $('modalForma').textContent = estado.forma;
    $('modalValor').textContent = fmtBRL(valor);
    $('modalNovoSaldo').textContent = fmtBRL(Math.max(saldo - valor, 0));

    $('modalConfirmacao').hidden = false;
    document.body.style.overflow = 'hidden';
    $('btnConfirmarModal').focus();
  }

  function fecharModal() {
    $('modalConfirmacao').hidden = true;
    document.body.style.overflow = '';
  }

  async function registrarAbatimento() {
    if (estado.salvando) return;

    const valor = numeroMoeda($('valorPagamento').value);
    const c = estado.cliente;
    const f = estado.funcionario;

    if (!c || !f || valor <= 0) return;

    estado.salvando = true;
    $('btnConfirmarModal').disabled = true;
    $('btnConfirmarModal').innerHTML =
      '<span class="spinner" style="width:16px;height:16px"></span> Gravando...';
    atualizarPreview();

    try {
      const { data, error } = await window.SISLOT_SB.rpc(
        'fn_pendencias_registrar_abatimento',
        {
          p_cliente_id: String(c.cliente_id),
          p_funcionario_id: Number(f.funcionario_id),
          p_loteria_id: Number(estado.loja.id),
          p_usuario_id: Number(estado.usuario.id),
          p_valor: valor,
          p_forma_pagamento: estado.forma,
          p_observacao: $('observacao').value.trim() || null,
          p_data_movimento: hojeSP(),
          p_operacao_id: estado.operacaoId
        }
      );

      if (error) throw error;
      if (!data?.ok) throw new Error('O banco não confirmou o abatimento.');

      fecharModal();

      toast(
        'Abatimento registrado',
        `${c.cliente_nome}: ${fmtBRL(valor)} • novo saldo ${fmtBRL(data.saldo_depois)}`,
        'ok'
      );

      const clienteId = c.cliente_id;
      await carregarDashboard(true);

      const funcAtual = estado.funcionarios.find(
        x => Number(x.funcionario_id) === Number(f.funcionario_id)
      );

      if (funcAtual) {
        await selecionarFuncionario(funcAtual);
        const clienteAtual = estado.clientes.find(x => x.cliente_id === clienteId);
        if (clienteAtual) {
          await selecionarCliente(clienteAtual);
        } else {
          ocultarDetalhe();
          toast('Dívida quitada', `${c.cliente_nome} não possui mais saldo com ${f.funcionario_nome}.`, 'ok');
        }
      } else {
        resetSelecoes();
      }

    } catch (err) {
      console.error('[Pendências] Erro ao registrar abatimento:', err);
      toast('Não foi possível registrar', err.message || String(err), 'err');
    } finally {
      estado.salvando = false;
      $('btnConfirmarModal').disabled = false;
      $('btnConfirmarModal').innerHTML =
        '<i class="fas fa-check"></i> Confirmar';
      atualizarPreview();
    }
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
