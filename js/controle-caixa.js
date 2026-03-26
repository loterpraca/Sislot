/* ════════════════════════════════════════════════════════════
   SISLOT — Conferência de Caixa  |  JavaScript v2.0
   ─────────────────────────────────────────────────────────
   Estrutura:
     1. DADOS MOCK (substitua pelas funções reais do backend)
     2. ESTADO GLOBAL
     3. VIEWER — módulo principal
        3a. Inicialização
        3b. Relógio e período
        3c. Abas de dias
        3d. Carregamento de dados
        3e. Renderização do painel esquerdo
        3f. Renderização do painel direito (tabelas)
        3g. Interações UI
        3h. Utilitários
════════════════════════════════════════════════════════════ */

'use strict';

/* ════════════════════════════════════════════════════════════
   1. DADOS MOCK
   ─────────────────────────────────────────────────────────
   Estes dados simulam o que viria do seu backend.
   Substitua as funções de carregamento por chamadas reais
   ao Supabase ou à sua API.
════════════════════════════════════════════════════════════ */

const MOCK = {

  // Funcionários disponíveis
  funcionarios: [
    { id: 1, nome: 'Ana Costa',     loja_id: 1 },
    { id: 2, nome: 'Bruno Mendes',  loja_id: 1 },
    { id: 3, nome: 'Carla Souza',   loja_id: 2 },
    { id: 4, nome: 'Diego Lima',    loja_id: 2 },
  ],

  // Fechamentos do mês (todos os funcionários)
  // data: 'YYYY-MM-DD'
  fechamentos: [
    {
      id: 101, data: '2026-03-03',
      funcionario_id: 1, funcionario_nome: 'Ana Costa',
      loja_id: 1, loja_nome: 'Centro',
      status: 'fechado', criado_em: '2026-03-03T17:42:11',
      relatorio: 3120.50, deposito: 2900.00,
      troco_ini: 200.00, troco_sob: 180.00,
      pix_cnpj: 480.00, pix_dif: 0.00,
      premio_rasp: 150.00, resgate_tele: 80.00,
      justificativa: '',
    },
    {
      id: 102, data: '2026-03-03',
      funcionario_id: 2, funcionario_nome: 'Bruno Mendes',
      loja_id: 1, loja_nome: 'Centro',
      status: 'fechado', criado_em: '2026-03-03T18:10:04',
      relatorio: 1850.00, deposito: 1600.00,
      troco_ini: 200.00, troco_sob: 210.00,
      pix_cnpj: 280.00, pix_dif: 0.00,
      premio_rasp: 60.00, resgate_tele: 0.00,
      justificativa: '',
    },
    {
      id: 103, data: '2026-03-07',
      funcionario_id: 1, funcionario_nome: 'Ana Costa',
      loja_id: 1, loja_nome: 'Centro',
      status: 'fechado', criado_em: '2026-03-07T17:55:00',
      relatorio: 2780.00, deposito: 2600.00,
      troco_ini: 200.00, troco_sob: 195.00,
      pix_cnpj: 390.00, pix_dif: -15.00,
      premio_rasp: 100.00, resgate_tele: 110.00,
      justificativa: 'Diferença de PIX identificada em extrato bancário, valor em análise.',
    },
    {
      id: 104, data: '2026-03-10',
      funcionario_id: 3, funcionario_nome: 'Carla Souza',
      loja_id: 2, loja_nome: 'Norte',
      status: 'fechado', criado_em: '2026-03-10T18:30:22',
      relatorio: 4200.00, deposito: 4000.00,
      troco_ini: 250.00, troco_sob: 240.00,
      pix_cnpj: 620.00, pix_dif: 0.00,
      premio_rasp: 300.00, resgate_tele: 220.00,
      justificativa: '',
    },
    {
      id: 105, data: '2026-03-14',
      funcionario_id: 2, funcionario_nome: 'Bruno Mendes',
      loja_id: 1, loja_nome: 'Centro',
      status: 'pendente', criado_em: '2026-03-14T17:20:00',
      relatorio: 1950.00, deposito: 1700.00,
      troco_ini: 200.00, troco_sob: 215.00,
      pix_cnpj: 310.00, pix_dif: 0.00,
      premio_rasp: 80.00, resgate_tele: 55.00,
      justificativa: '',
    },
    {
      id: 106, data: '2026-03-17',
      funcionario_id: 1, funcionario_nome: 'Ana Costa',
      loja_id: 1, loja_nome: 'Centro',
      status: 'fechado', criado_em: '2026-03-17T18:05:44',
      relatorio: 3450.00, deposito: 3200.00,
      troco_ini: 200.00, troco_sob: 190.00,
      pix_cnpj: 520.00, pix_dif: 0.00,
      premio_rasp: 200.00, resgate_tele: 165.00,
      justificativa: '',
    },
    {
      id: 107, data: '2026-03-20',
      funcionario_id: 4, funcionario_nome: 'Diego Lima',
      loja_id: 2, loja_nome: 'Norte',
      status: 'fechado', criado_em: '2026-03-20T17:48:33',
      relatorio: 2200.00, deposito: 1980.00,
      troco_ini: 250.00, troco_sob: 248.00,
      pix_cnpj: 350.00, pix_dif: 20.00,
      premio_rasp: 90.00, resgate_tele: 40.00,
      justificativa: '',
    },
    {
      id: 108, data: '2026-03-24',
      funcionario_id: 1, funcionario_nome: 'Ana Costa',
      loja_id: 1, loja_nome: 'Centro',
      status: 'fechado', criado_em: '2026-03-24T18:22:15',
      relatorio: 2900.00, deposito: 2750.00,
      troco_ini: 200.00, troco_sob: 185.00,
      pix_cnpj: 410.00, pix_dif: 0.00,
      premio_rasp: 130.00, resgate_tele: 95.00,
      justificativa: '',
    },
  ],

  // Produtos por fechamento
  produtos: {
    101: [
      { id: 1, nome: 'Raspadinha R$ 5,00',   tipo: 'RASPADINHA', quantidade: 40, valor_unit: 5.00 },
      { id: 2, nome: 'Raspadinha R$ 10,00',  tipo: 'RASPADINHA', quantidade: 22, valor_unit: 10.00 },
      { id: 3, nome: 'Raspadinha R$ 20,00',  tipo: 'RASPADINHA', quantidade: 8,  valor_unit: 20.00 },
      { id: 4, nome: 'Tele Sena Maio',       tipo: 'TELESENA',   quantidade: 6,  valor_unit: 55.00 },
      { id: 5, nome: 'Mega-Sena #2750',      tipo: 'FEDERAL',    quantidade: 12, valor_unit: 4.50 },
      { id: 6, nome: 'Lotofácil #3122',      tipo: 'FEDERAL',    quantidade: 8,  valor_unit: 2.50 },
    ],
    102: [
      { id: 7, nome: 'Raspadinha R$ 5,00',   tipo: 'RASPADINHA', quantidade: 30, valor_unit: 5.00 },
      { id: 8, nome: 'Raspadinha R$ 10,00',  tipo: 'RASPADINHA', quantidade: 12, valor_unit: 10.00 },
      { id: 9, nome: 'Mega-Sena #2750',      tipo: 'FEDERAL',    quantidade: 6,  valor_unit: 4.50 },
    ],
    103: [
      { id: 10, nome: 'Raspadinha R$ 5,00',  tipo: 'RASPADINHA', quantidade: 50, valor_unit: 5.00 },
      { id: 11, nome: 'Raspadinha R$ 20,00', tipo: 'RASPADINHA', quantidade: 10, valor_unit: 20.00 },
      { id: 12, nome: 'Tele Sena Maio',      tipo: 'TELESENA',   quantidade: 4,  valor_unit: 55.00 },
      { id: 13, nome: 'Lotofácil #3125',     tipo: 'FEDERAL',    quantidade: 15, valor_unit: 2.50 },
    ],
    104: [
      { id: 14, nome: 'Raspadinha R$ 5,00',  tipo: 'RASPADINHA', quantidade: 60, valor_unit: 5.00 },
      { id: 15, nome: 'Raspadinha R$ 10,00', tipo: 'RASPADINHA', quantidade: 40, valor_unit: 10.00 },
      { id: 16, nome: 'Raspadinha R$ 25,00', tipo: 'RASPADINHA', quantidade: 15, valor_unit: 25.00 },
      { id: 17, nome: 'Tele Sena Maio',      tipo: 'TELESENA',   quantidade: 8,  valor_unit: 55.00 },
      { id: 18, nome: 'Mega-Sena #2752',     tipo: 'FEDERAL',    quantidade: 20, valor_unit: 4.50 },
    ],
    105: [
      { id: 19, nome: 'Raspadinha R$ 5,00',  tipo: 'RASPADINHA', quantidade: 28, valor_unit: 5.00 },
      { id: 20, nome: 'Raspadinha R$ 10,00', tipo: 'RASPADINHA', quantidade: 15, valor_unit: 10.00 },
      { id: 21, nome: 'Lotofácil #3130',     tipo: 'FEDERAL',    quantidade: 10, valor_unit: 2.50 },
    ],
    106: [
      { id: 22, nome: 'Raspadinha R$ 5,00',  tipo: 'RASPADINHA', quantidade: 45, valor_unit: 5.00 },
      { id: 23, nome: 'Raspadinha R$ 10,00', tipo: 'RASPADINHA', quantidade: 28, valor_unit: 10.00 },
      { id: 24, nome: 'Raspadinha R$ 20,00', tipo: 'RASPADINHA', quantidade: 12, valor_unit: 20.00 },
      { id: 25, nome: 'Tele Sena Junho',     tipo: 'TELESENA',   quantidade: 5,  valor_unit: 55.00 },
      { id: 26, nome: 'Mega-Sena #2758',     tipo: 'FEDERAL',    quantidade: 18, valor_unit: 4.50 },
      { id: 27, nome: 'Quina #6400',         tipo: 'FEDERAL',    quantidade: 14, valor_unit: 2.00 },
    ],
    107: [
      { id: 28, nome: 'Raspadinha R$ 5,00',  tipo: 'RASPADINHA', quantidade: 35, valor_unit: 5.00 },
      { id: 29, nome: 'Raspadinha R$ 10,00', tipo: 'RASPADINHA', quantidade: 20, valor_unit: 10.00 },
      { id: 30, nome: 'Mega-Sena #2760',     tipo: 'FEDERAL',    quantidade: 10, valor_unit: 4.50 },
    ],
    108: [
      { id: 31, nome: 'Raspadinha R$ 5,00',  tipo: 'RASPADINHA', quantidade: 42, valor_unit: 5.00 },
      { id: 32, nome: 'Raspadinha R$ 10,00', tipo: 'RASPADINHA', quantidade: 25, valor_unit: 10.00 },
      { id: 33, nome: 'Raspadinha R$ 20,00', tipo: 'RASPADINHA', quantidade: 6,  valor_unit: 20.00 },
      { id: 34, nome: 'Tele Sena Junho',     tipo: 'TELESENA',   quantidade: 4,  valor_unit: 55.00 },
      { id: 35, nome: 'Lotofácil #3142',     tipo: 'FEDERAL',    quantidade: 12, valor_unit: 2.50 },
    ],
  },

  // Bolões por fechamento
  boloes: {
    101: [
      { id: 1, descricao: 'Mega-Sena 2750 — 6 dezenas',  tipo: 'INTERNO', cotas_vendidas: 8,  valor_cota: 25.00 },
      { id: 2, descricao: 'Lotofácil 3122 — Externo SP', tipo: 'EXTERNO', cotas_vendidas: 5,  valor_cota: 15.00 },
    ],
    103: [
      { id: 3, descricao: 'Mega-Sena 2753 — 7 dezenas',  tipo: 'INTERNO', cotas_vendidas: 10, valor_cota: 30.00 },
    ],
    104: [
      { id: 4, descricao: 'Lotofácil 3128 — Interno',    tipo: 'INTERNO', cotas_vendidas: 12, valor_cota: 20.00 },
      { id: 5, descricao: 'Mega-Sena 2752 — Externo RJ', tipo: 'EXTERNO', cotas_vendidas: 8,  valor_cota: 35.00 },
      { id: 6, descricao: 'Quina 6399 — Interno',        tipo: 'INTERNO', cotas_vendidas: 6,  valor_cota: 18.00 },
    ],
    106: [
      { id: 7, descricao: 'Mega-Sena 2758 — 6 dezenas',  tipo: 'INTERNO', cotas_vendidas: 9,  valor_cota: 28.00 },
    ],
    108: [
      { id: 8, descricao: 'Mega-Sena 2762 — Interno',    tipo: 'INTERNO', cotas_vendidas: 7,  valor_cota: 25.00 },
      { id: 9, descricao: 'Lotofácil 3142 — Externo MG', tipo: 'EXTERNO', cotas_vendidas: 4,  valor_cota: 20.00 },
    ],
  },

  // Dívidas por fechamento
  dividas: {
    101: [
      { id: 1, cliente: 'João da Silva',      valor: 50.00,  obs: 'Bolão pendente' },
      { id: 2, cliente: 'Maria Aparecida',    valor: 25.00,  obs: '' },
    ],
    103: [
      { id: 3, cliente: 'Roberto Ferreira',   valor: 30.00,  obs: 'Raspadinha fiada' },
    ],
    104: [
      { id: 4, cliente: 'Cláudia Moreira',    valor: 80.00,  obs: 'Bolão externo RJ' },
      { id: 5, cliente: 'Paulo Andrade',      valor: 35.00,  obs: '' },
    ],
    107: [
      { id: 6, cliente: 'Fernanda Costa',     valor: 45.00,  obs: 'Telesena pendente' },
    ],
  },
};


/* ════════════════════════════════════════════════════════════
   2. ESTADO GLOBAL
════════════════════════════════════════════════════════════ */

const ESTADO = {
  mes:              new Date().getMonth() + 1,
  ano:              new Date().getFullYear(),
  diaAtivo:         null,
  lojaFiltro:       '',
  funcFiltro:       '',
  // Cache de dados do mês
  fechamentosDoMes: [],
  // Fechamento atualmente exibido
  fechamentoAtual:  null,
  fechamentoIdx:    0,      // índice quando há múltiplos no mesmo dia
  // Dados das tabelas filhas
  produtosAtuais:   [],
  boloesAtuais:     [],
  dividasAtuais:    [],
  // Controle de UI
  secoesAbertas:    { produtos: true, boloes: true, dividas: true, geral: false },
  modoEdicao:       false,
};


/* ════════════════════════════════════════════════════════════
   3. VIEWER — MÓDULO PRINCIPAL
════════════════════════════════════════════════════════════ */

const VIEWER = {

  /* ──────────────────────────────────────────────────────────
     3a. INICIALIZAÇÃO
  ─────────────────────────────────────────────────────────── */

  init() {
    this._initRelogio();
    this._initPeriodo();
    this._initFiltros();
    this._initEventos();
    this._carregarFuncionarios();
    // Carrega dados do mês atual e gera abas
    this.recarregar();
  },

  /* ──────────────────────────────────────────────────────────
     3b. RELÓGIO E PERÍODO
  ─────────────────────────────────────────────────────────── */

  _inicioRelogio: null,

  _initRelogio() {
    const el = document.getElementById('app-clock');
    const tick = () => {
      if (el) el.textContent = new Date().toLocaleTimeString('pt-BR');
    };
    tick();
    setInterval(tick, 1000);
  },

  _initPeriodo() {
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    // Preenche select de meses
    const selMes = document.getElementById('sel-mes');
    MESES.forEach((nome, i) => {
      const op = document.createElement('option');
      op.value = i + 1;
      op.textContent = nome;
      if (i + 1 === ESTADO.mes) op.selected = true;
      selMes.appendChild(op);
    });

    // Preenche select de anos (3 atrás até 1 à frente)
    const selAno = document.getElementById('sel-ano');
    const anoAtual = new Date().getFullYear();
    for (let a = anoAtual - 3; a <= anoAtual + 1; a++) {
      const op = document.createElement('option');
      op.value = a;
      op.textContent = a;
      if (a === ESTADO.ano) op.selected = true;
      selAno.appendChild(op);
    }

    this._atualizarPeriodoLabel();
  },

  _atualizarPeriodoLabel() {
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const el = document.getElementById('periodo-label');
    if (el) el.textContent = `${MESES[ESTADO.mes - 1]} / ${ESTADO.ano}`;
  },

  /* ──────────────────────────────────────────────────────────
     3c. FILTROS E EVENTOS
  ─────────────────────────────────────────────────────────── */

  _initFiltros() {
    document.getElementById('sel-mes').addEventListener('change', e => {
      ESTADO.mes = parseInt(e.target.value);
      ESTADO.diaAtivo = null;
      this._atualizarPeriodoLabel();
      this.recarregar();
    });

    document.getElementById('sel-ano').addEventListener('change', e => {
      ESTADO.ano = parseInt(e.target.value);
      ESTADO.diaAtivo = null;
      this._atualizarPeriodoLabel();
      this.recarregar();
    });

    document.getElementById('sel-loja').addEventListener('change', e => {
      ESTADO.lojaFiltro = e.target.value;
      this.recarregar();
    });

    document.getElementById('sel-func').addEventListener('change', e => {
      ESTADO.funcFiltro = e.target.value;
      this.recarregar();
    });
  },

  _initEventos() {
    document.getElementById('btn-inicio').addEventListener('click', () => {
      this.abrirModal('modal-inicio');
    });
    document.getElementById('btn-sair').addEventListener('click', () => {
      this.abrirModal('modal-sair');
    });

    // Fecha modais clicando no overlay
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.addEventListener('click', e => {
        if (e.target === m) this.fecharModal(m.id);
      });
    });
  },

  _carregarFuncionarios() {
    // ─── PONTO DE INTEGRAÇÃO ───
    // Aqui você buscaria os funcionários do backend.
    // Exemplo: const lista = await supabase.from('funcionarios').select('*')
    const sel = document.getElementById('sel-func');
    // Limpa opções existentes (exceto "Todos")
    while (sel.options.length > 1) sel.remove(1);

    MOCK.funcionarios.forEach(f => {
      const op = document.createElement('option');
      op.value = f.id;
      op.textContent = f.nome;
      sel.appendChild(op);
    });
  },

  /* ──────────────────────────────────────────────────────────
     3d. CARREGAMENTO DE DADOS
  ─────────────────────────────────────────────────────────── */

  /**
   * Recarrega todos os dados do mês selecionado e regenera abas.
   */
  async recarregar() {
    try {
      ESTADO.fechamentosDoMes = await this._buscarFechamentosDoMes(ESTADO.mes, ESTADO.ano);
      this._gerarAbasDias();

      // Se havia um dia selecionado, recarrega
      if (ESTADO.diaAtivo) {
        this._selecionarDia(ESTADO.diaAtivo, true);
      } else {
        this._mostrarEstadoInicial();
      }
    } catch (err) {
      console.error('Erro ao recarregar:', err);
      this.toast('Erro ao carregar dados do mês.', 'erro');
    }
  },

  /**
   * Busca fechamentos do mês/ano com filtros aplicados.
   * ─── PONTO DE INTEGRAÇÃO ───
   * Substitua o corpo desta função pela chamada real ao backend.
   * Exemplo Supabase:
   *   const { data } = await supabase
   *     .from('fechamentos')
   *     .select('*')
   *     .gte('data', `${ano}-${String(mes).padStart(2,'0')}-01`)
   *     .lte('data', `${ano}-${String(mes).padStart(2,'0')}-31`)
   *   return data;
   */
  async _buscarFechamentosDoMes(mes, ano) {
  const mesStr = String(mes).padStart(2, '0');
  const primeiroDia = `${ano}-${mesStr}-01`;
  const ultimoDiaNum = new Date(ano, mes, 0).getDate();
  const ultimoDia = `${ano}-${mesStr}-${String(ultimoDiaNum).padStart(2, '0')}`;

  let query = sb
    .from('fechamentos')
    .select('*')
    .gte('data', primeiroDia)
    .lte('data', ultimoDia)
    .order('data', { ascending: true })
    .order('created_at', { ascending: true });

  if (ESTADO.lojaFiltro) {
    query = query.eq('loteria_id', Number(ESTADO.lojaFiltro));
  }

  if (ESTADO.funcFiltro) {
    query = query.eq('funcionario_id', Number(ESTADO.funcFiltro));
  }

  const { data, error } = await query;

  if (error) {
    console.error('Erro ao buscar fechamentos do mês:', error);
    throw error;
  }

  return (data || []).map(row => ({
    id: row.id,
    data: row.data || row.data_fechamento || '',
    funcionario_id: row.funcionario_id ?? row.usuario_id ?? null,
    funcionario_nome:
      row.funcionario_nome ||
      row.nome_funcionario ||
      row.usuario_nome ||
      row.funcionario ||
      '—',
    loja_id: row.loteria_id ?? row.loja_id ?? null,
    loja_nome:
      row.loja_nome ||
      row.nome_loja ||
      row.loteria ||
      row.loja ||
      '—',
    status: row.status || 'fechado',
    criado_em: row.created_at || row.criado_em || row.carimbo || null,

    relatorio: Number(row.relatorio || 0),
    deposito: Number(row.deposito || 0),
    troco_ini: Number(row.troco_ini || row.troco_inicial || 0),
    troco_sob: Number(row.troco_sob || row.troco_sobra || 0),
    pix_cnpj: Number(row.pix_cnpj || 0),
    pix_dif: Number(row.pix_dif || row.diferenca_pix || 0),
    premio_rasp: Number(row.premio_rasp || row.premio_raspadinha || 0),
    resgate_tele: Number(row.resgate_tele || row.resgate_telesena || 0),
    justificativa: row.justificativa || ''
  }));
},

async _buscarProdutos(fechamentoId) {
  const { data, error } = await sb
    .from('fechamento_produtos')
    .select('*')
    .eq('fechamento_id', fechamentoId)
    .order('id', { ascending: true });

  if (error) {
    console.error('Erro ao buscar produtos:', error);
    throw error;
  }

  return (data || []).map(row => ({
    id: row.id,
    nome:
      row.nome ||
      row.produto_nome ||
      row.descricao ||
      row.modalidade ||
      '—',
    tipo:
      row.tipo ||
      row.categoria ||
      row.grupo ||
      'PRODUTO',
    quantidade: Number(row.quantidade || row.qtd_vendida || row.qtd || 0),
    valor_unit: Number(row.valor_unit || row.valor_unitario || row.valor_cota || 0)
  }));
},

async _buscarBoloes(fechamentoId) {
  const { data, error } = await sb
    .from('fechamento_boloes')
    .select('*')
    .eq('fechamento_id', fechamentoId)
    .order('id', { ascending: true });

  if (error) {
    console.error('Erro ao buscar bolões:', error);
    throw error;
  }

  return (data || []).map(row => ({
    id: row.id,
    descricao:
      row.descricao ||
      row.bolao_nome ||
      row.nome ||
      [
        row.modalidade || 'Bolão',
        row.concurso ? `#${row.concurso}` : ''
      ].filter(Boolean).join(' '),
    tipo:
      row.tipo ||
      row.origem_tipo ||
      row.classificacao ||
      'INTERNO',
    cotas_vendidas: Number(row.cotas_vendidas || row.qtd_vendida || row.qtd_cotas || 0),
    valor_cota: Number(row.valor_cota || row.valor_unitario || 0)
  }));
},

async _buscarDividas(fechamentoId) {
  const { data, error } = await sb
    .from('fechamento_dividas')
    .select('*')
    .eq('fechamento_id', fechamentoId)
    .order('id', { ascending: true });

  if (error) {
    console.error('Erro ao buscar dívidas:', error);
    throw error;
  }

  return (data || []).map(row => ({
    id: row.id,
    cliente: row.cliente || row.nome_cliente || '—',
    valor: Number(row.valor || 0),
    obs: row.obs || row.observacao || ''
  }));
},
  /* ──────────────────────────────────────────────────────────
     3e. ABAS DE DIAS
  ─────────────────────────────────────────────────────────── */

  /**
   * Gera dinamicamente as abas de dias do mês na barra inferior.
   * Ajusta automaticamente para 28, 29, 30 ou 31 dias.
   */
  _gerarAbasDias() {
    const container = document.getElementById('dias-scroll');
    const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    const DIAS_FULL   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

    // Quantos dias tem o mês?
    const totalDias = new Date(ESTADO.ano, ESTADO.mes, 0).getDate();
    const hoje      = new Date();
    const ehMesAtual = hoje.getMonth() + 1 === ESTADO.mes && hoje.getFullYear() === ESTADO.ano;

    // Mapa de dias que têm dados (para exibir o ponto indicador)
    const diasComDados = {};
    ESTADO.fechamentosDoMes.forEach(f => {
      const dia = parseInt(f.data.split('-')[2]);
      if (!diasComDados[dia]) diasComDados[dia] = [];
      diasComDados[dia].push(f);
    });

    container.innerHTML = '';

    for (let d = 1; d <= totalDias; d++) {
      const data   = new Date(ESTADO.ano, ESTADO.mes - 1, d);
      const dow    = data.getDay(); // 0=dom, 6=sáb
      const ehFds  = dow === 0 || dow === 6;
      const ehHoje = ehMesAtual && d === hoje.getDate();

      const temDados   = !!diasComDados[d];
      const temQuebra  = temDados && diasComDados[d].some(f => Math.abs(this._calcularQuebra(f)) > 0.01);
      const ehAtivo    = d === ESTADO.diaAtivo;

      const tab = document.createElement('button');
      tab.className = [
        'dia-tab',
        temDados   ? 'tem-dados' : 'sem-dados',
        temQuebra  ? 'tem-quebra' : '',
        ehFds      ? 'fds' : '',
        ehHoje     ? 'hoje' : '',
        ehAtivo    ? 'ativo' : '',
      ].filter(Boolean).join(' ');

      tab.dataset.dia = d;
      tab.title       = `${String(d).padStart(2,'0')} — ${DIAS_FULL[dow]}${temDados ? ' (tem fechamento)' : ''}`;

      tab.innerHTML = `
        <div class="dia-num-wrap">
          <span class="dia-num">${d}</span>
        </div>
        <span class="dia-dow-label">${DIAS_SEMANA[dow]}</span>
        <span class="dia-dot"></span>
      `;

      tab.addEventListener('click', () => this._selecionarDia(d));
      container.appendChild(tab);
    }

    // Scroll até o dia ativo ou o dia de hoje
    setTimeout(() => {
      const alvo = ESTADO.diaAtivo || (ehMesAtual ? hoje.getDate() : 1);
      this._scrollParaDia(alvo);
    }, 50);
  },

  _scrollParaDia(dia) {
    const tab = document.querySelector(`.dia-tab[data-dia="${dia}"]`);
    if (tab) {
      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  },

  scrollDias(direcao) {
    const container = document.getElementById('dias-scroll');
    container.scrollBy({ left: direcao * 160, behavior: 'smooth' });
  },

  /* ──────────────────────────────────────────────────────────
     3f. SELEÇÃO DE DIA E CARREGAMENTO
  ─────────────────────────────────────────────────────────── */

  async _selecionarDia(dia, silencioso = false) {
    ESTADO.diaAtivo = dia;
    ESTADO.fechamentoIdx = 0;

    // Atualiza destaque das abas
    document.querySelectorAll('.dia-tab').forEach(t => {
      t.classList.toggle('ativo', parseInt(t.dataset.dia) === dia);
    });

    // Busca fechamentos do dia (pode haver mais de um)
    const diaStr    = String(dia).padStart(2, '0');
    const mesStr    = String(ESTADO.mes).padStart(2, '0');
    const dataRef   = `${ESTADO.ano}-${mesStr}-${diaStr}`;
    const lista     = ESTADO.fechamentosDoMes.filter(f => f.data === dataRef);

    if (lista.length === 0) {
      this._mostrarSemDados(dia);
      return;
    }

    // Exibe o estado de loading
    this._mostrarLoading();

    try {
      // Simula delay de rede (remova em produção)
      await new Promise(r => setTimeout(r, 180));

      // Carrega dados do primeiro fechamento (ou do índice atual)
      await this._carregarFechamento(lista, ESTADO.fechamentoIdx);

    } catch (err) {
      console.error('Erro ao carregar fechamento:', err);
      this.toast('Erro ao carregar fechamento.', 'erro');
      this._mostrarSemDados(dia);
    }
  },

  async _carregarFechamento(lista, idx) {
    const fech = lista[idx];
    ESTADO.fechamentoAtual = fech;

    // Busca dados das tabelas filhas em paralelo
    const [produtos, boloes, dividas] = await Promise.all([
      this._buscarProdutos(fech.id),
      this._buscarBoloes(fech.id),
      this._buscarDividas(fech.id),
    ]);

    ESTADO.produtosAtuais = produtos;
    ESTADO.boloesAtuais   = boloes;
    ESTADO.dividasAtuais  = dividas;

    // Renderiza tudo
    this._renderizarPainelEsq(fech, lista);
    this._renderizarPainelDir(fech, produtos, boloes, dividas);
  },

  /* ──────────────────────────────────────────────────────────
     3g. RENDERIZAÇÃO — PAINEL ESQUERDO
  ─────────────────────────────────────────────────────────── */

  _renderizarPainelEsq(fech, lista) {
    const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const DIAS_EXT    = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

    // Oculta estados e exibe dados
    this._setPainelEsqEstado('dados');

    // ── Status ──
    const statusMap = { fechado: 'Fechado', pendente: 'Pendente', revisao: 'Em Revisão' };
    const led = document.getElementById('fech-status-led');
    led.className = 'status-led ' + (fech.status !== 'fechado' ? fech.status : '');
    document.getElementById('fech-status-txt').textContent = statusMap[fech.status] || fech.status;

    // ── Hora ──
    const hora = fech.criado_em ? new Date(fech.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    document.getElementById('fech-hora').textContent = hora;

    // ── Múltiplos fechamentos ──
    const multiFech = document.getElementById('multi-fech');
    if (lista.length > 1) {
      multiFech.style.display = 'block';
      const tabs = document.getElementById('mf-tabs');
      tabs.innerHTML = lista.map((f, i) => {
        const nome = f.funcionario_nome.split(' ')[0];
        return `<button class="mf-tab ${i === ESTADO.fechamentoIdx ? 'ativo' : ''}"
                  onclick="VIEWER._trocarFechamento(${i})">${nome}</button>`;
      }).join('');
    } else {
      multiFech.style.display = 'none';
    }

    // ── Identificação ──
    const inicial = fech.funcionario_nome ? fech.funcionario_nome.charAt(0).toUpperCase() : '?';
    document.getElementById('func-avatar').textContent = inicial;
    document.getElementById('func-nome').textContent   = fech.funcionario_nome || '—';
    document.getElementById('func-loja-txt').textContent = fech.loja_nome || '—';

    // ── Data ──
    const dataObj  = new Date(fech.data + 'T12:00:00');
    const dia      = dataObj.getDate();
    const mesIdx   = dataObj.getMonth();
    const dow      = dataObj.getDay();

    document.getElementById('data-dia').textContent  = String(dia).padStart(2, '0');
    document.getElementById('data-mes').textContent  = MESES_ABREV[mesIdx];
    document.getElementById('data-dow').textContent  = DIAS_EXT[dow];

    // ── Totais ──
    const totProd = this._somarProdutos(ESTADO.produtosAtuais);
    const totBol  = this._somarBoloes(ESTADO.boloesAtuais);
    const totDiv  = this._somarDividas(ESTADO.dividasAtuais);

    document.getElementById('rc-relatorio').textContent = this._moeda(fech.relatorio);
    document.getElementById('rc-deposito').textContent  = this._moeda(fech.deposito);
    document.getElementById('rc-pix').textContent       = this._moeda((fech.pix_cnpj || 0) + (fech.pix_dif || 0));
    document.getElementById('rc-produtos').textContent  = this._moeda(totProd);
    document.getElementById('rc-boloes').textContent    = this._moeda(totBol);
    document.getElementById('rc-dividas').textContent   = this._moeda(totDiv);

    // ── Balanço ──
    const { debitos, creditos } = this._calcularBalanco(fech, totProd, totBol, totDiv);
    document.getElementById('bl-deb').textContent  = this._moeda(debitos);
    document.getElementById('bl-cred').textContent = this._moeda(creditos);

    // ── Quebra ──
    const quebra    = creditos - debitos;
    const quebraEl  = document.getElementById('quebra-card');
    const valorEl   = document.getElementById('qc-valor');
    const descEl    = document.getElementById('qc-desc');

    valorEl.textContent = this._moeda(Math.abs(quebra));
    quebraEl.className  = 'quebra-card';

    if (Math.abs(quebra) < 0.01) {
      descEl.textContent = 'Caixa equilibrado';
      quebraEl.classList.add('');
    } else if (quebra < 0) {
      descEl.textContent = 'Caixa negativo';
      quebraEl.classList.add('negativa');
    } else {
      descEl.textContent = 'Caixa positivo';
      quebraEl.classList.add('positiva');
    }

    // ── Justificativa ──
    const justBox = document.getElementById('justificativa-box');
    if (fech.justificativa && fech.justificativa.trim()) {
      justBox.style.display = 'block';
      document.getElementById('just-content').textContent = fech.justificativa;
    } else {
      justBox.style.display = 'none';
    }

    // ── Campos adicionais ──
    document.getElementById('ca-troco-ini').textContent   = this._moeda(fech.troco_ini);
    document.getElementById('ca-troco-sob').textContent   = this._moeda(fech.troco_sob);
    document.getElementById('ca-pix-dif').textContent     = this._moeda(fech.pix_dif);
    document.getElementById('ca-premio-rasp').textContent = this._moeda(fech.premio_rasp);
    document.getElementById('ca-resgate-tele').textContent= this._moeda(fech.resgate_tele);
  },

  _trocarFechamento(idx) {
    const diaStr  = String(ESTADO.diaAtivo).padStart(2, '0');
    const mesStr  = String(ESTADO.mes).padStart(2, '0');
    const dataRef = `${ESTADO.ano}-${mesStr}-${diaStr}`;
    const lista   = ESTADO.fechamentosDoMes.filter(f => f.data === dataRef);

    ESTADO.fechamentoIdx = idx;
    this._carregarFechamento(lista, idx);
  },

  /* ──────────────────────────────────────────────────────────
     3h. RENDERIZAÇÃO — PAINEL DIREITO (TABELAS)
  ─────────────────────────────────────────────────────────── */

  _renderizarPainelDir(fech, produtos, boloes, dividas) {
    const area = document.getElementById('detalhe-area');
    area.style.display = 'flex';
    area.classList.add('fade-in');

    // Oculta elementos decorativos
    document.getElementById('dir-grid-bg').classList.add('oculto');
    document.getElementById('dir-vazio-center').classList.add('oculto');

    // ── Barra de contexto ──
    const dataObj = new Date(fech.data + 'T12:00:00');
    document.getElementById('ctx-data').textContent  = dataObj.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    document.getElementById('ctx-func').textContent  = fech.funcionario_nome || '—';
    document.getElementById('ctx-loja').textContent  = fech.loja_nome || '—';

    const totProd = this._somarProdutos(produtos);
    const totBol  = this._somarBoloes(boloes);
    const totDiv  = this._somarDividas(dividas);
    const totGeral = totProd + totBol + (fech.deposito || 0) + (fech.pix_cnpj || 0);
    document.getElementById('ctx-total-geral').textContent = this._moeda(totGeral);

    // ── Produtos ──
    this._renderizarTabelaProdutos(produtos);

    // ── Bolões ──
    this._renderizarTabelaBoloes(boloes);

    // ── Dívidas ──
    this._renderizarTabelaDividas(dividas);

    // ── Dados Gerais ──
    this._renderizarDadosGerais(fech, totProd, totBol, totDiv);
  },

  _renderizarTabelaProdutos(produtos) {
    const tbody   = document.getElementById('tbody-produtos');
    const count   = document.getElementById('count-produtos');
    const stotal  = document.getElementById('stotal-produtos');
    const tf      = document.getElementById('tf-produtos');

    const total = this._somarProdutos(produtos);

    count.textContent  = produtos.length + (produtos.length === 1 ? ' item' : ' itens');
    stotal.textContent = this._moeda(total);
    tf.textContent     = this._moeda(total);

    if (produtos.length === 0) {
      tbody.innerHTML = '<tr class="tr-empty"><td colspan="5"><i class="fas fa-inbox"></i> Nenhum produto registrado</td></tr>';
      return;
    }

    tbody.innerHTML = produtos.map(p => {
      const subtotal = (p.quantidade || 0) * (p.valor_unit || 0);
      const chipCls  = this._chipTipo(p.tipo);
      return `
        <tr>
          <td>${this._esc(p.nome)}</td>
          <td><span class="chip-tipo ${chipCls}">${p.tipo}</span></td>
          <td class="col-r">${p.quantidade}</td>
          <td class="col-r">${this._moeda(p.valor_unit)}</td>
          <td class="col-r-accent">${this._moeda(subtotal)}</td>
        </tr>
      `;
    }).join('');
  },

  _renderizarTabelaBoloes(boloes) {
    const tbody      = document.getElementById('tbody-boloes');
    const count      = document.getElementById('count-boloes');
    const stotal     = document.getElementById('stotal-boloes');
    const tf         = document.getElementById('tf-boloes');
    const tfIntInfo  = document.getElementById('tf-bol-int-info');

    const total       = this._somarBoloes(boloes);
    const totalInt    = boloes.filter(b => b.tipo === 'INTERNO').reduce((s, b) => s + b.cotas_vendidas * b.valor_cota, 0);
    const cotasInt    = boloes.filter(b => b.tipo === 'INTERNO').reduce((s, b) => s + (b.cotas_vendidas || 0), 0);

    count.textContent  = boloes.length + (boloes.length === 1 ? ' item' : ' itens');
    stotal.textContent = this._moeda(total);
    tf.textContent     = this._moeda(total);
    tfIntInfo.textContent = `${cotasInt} cotas int.`;

    if (boloes.length === 0) {
      tbody.innerHTML = '<tr class="tr-empty"><td colspan="5"><i class="fas fa-inbox"></i> Nenhum bolão registrado</td></tr>';
      return;
    }

    tbody.innerHTML = boloes.map(b => {
      const subtotal = (b.cotas_vendidas || 0) * (b.valor_cota || 0);
      const chipCls  = b.tipo === 'INTERNO' ? 'chip-int' : 'chip-ext';
      return `
        <tr>
          <td>${this._esc(b.descricao)}</td>
          <td><span class="chip-tipo ${chipCls}">${b.tipo}</span></td>
          <td class="col-r">${b.cotas_vendidas}</td>
          <td class="col-r">${this._moeda(b.valor_cota)}</td>
          <td class="col-r-accent">${this._moeda(subtotal)}</td>
        </tr>
      `;
    }).join('');
  },

  _renderizarTabelaDividas(dividas) {
    const tbody  = document.getElementById('tbody-dividas');
    const count  = document.getElementById('count-dividas');
    const stotal = document.getElementById('stotal-dividas');
    const tf     = document.getElementById('tf-dividas');

    const total = this._somarDividas(dividas);

    count.textContent  = dividas.length + (dividas.length === 1 ? ' cliente' : ' clientes');
    stotal.textContent = this._moeda(total);
    tf.textContent     = this._moeda(total);

    if (dividas.length === 0) {
      tbody.innerHTML = '<tr class="tr-empty"><td colspan="3"><i class="fas fa-inbox"></i> Nenhuma dívida registrada</td></tr>';
      return;
    }

    tbody.innerHTML = dividas.map(d => `
      <tr class="${d.valor > 100 ? 'row-destaque' : ''}">
        <td>${this._esc(d.cliente)}</td>
        <td class="col-r val-neg">${this._moeda(d.valor)}</td>
        <td style="color:var(--text-muted);font-size:11px">${this._esc(d.obs) || '—'}</td>
      </tr>
    `).join('');
  },

  _renderizarDadosGerais(fech, totProd, totBol, totDiv) {
    const tbody = document.getElementById('tbody-geral');

    const { debitos, creditos } = this._calcularBalanco(fech, totProd, totBol, totDiv);
    const quebra = creditos - debitos;

    const linhas = [
      ['Relatório do Dia',     this._moeda(fech.relatorio),   ''],
      ['Depósito Bancário',    this._moeda(fech.deposito),    ''],
      ['Troco Inicial (Fundo)',this._moeda(fech.troco_ini),   ''],
      ['Troco Sobra (Final)',  this._moeda(fech.troco_sob),   ''],
      ['PIX CNPJ Recebido',   this._moeda(fech.pix_cnpj),    'val-pos'],
      ['Diferença de PIX',    this._moeda(fech.pix_dif),     (fech.pix_dif < 0 ? 'val-neg' : '')],
      ['Prêmio Raspadinha',   this._moeda(fech.premio_rasp), 'val-pos'],
      ['Resgate Telesena',    this._moeda(fech.resgate_tele),'val-pos'],
      ['— Total Débitos',     this._moeda(debitos),          'val-neg'],
      ['— Total Créditos',    this._moeda(creditos),         'val-pos'],
      ['— Quebra de Caixa',   this._moeda(quebra),           quebra < 0 ? 'val-neg' : quebra > 0 ? 'val-pos' : 'val-zero'],
      ['ID do Fechamento',    '#' + fech.id,                 ''],
      ['Status',              fech.status,                   ''],
      ['Registrado em',       fech.criado_em ? new Date(fech.criado_em).toLocaleString('pt-BR') : '—', ''],
    ];

    tbody.innerHTML = linhas.map(([label, valor, cls]) => `
      <tr>
        <td>${label}</td>
        <td class="${cls}">${valor}</td>
      </tr>
    `).join('');
  },

  /* ──────────────────────────────────────────────────────────
     3i. ESTADOS DA UI
  ─────────────────────────────────────────────────────────── */

  _setPainelEsqEstado(estado) {
    const ids = ['esq-vazio', 'esq-loading', 'esq-sem-dados', 'esq-dados'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    const alvo = {
      vazio:    'esq-vazio',
      loading:  'esq-loading',
      sem:      'esq-sem-dados',
      dados:    'esq-dados',
    }[estado];

    const el = document.getElementById(alvo);
    if (el) el.style.display = '';
  },

  _mostrarEstadoInicial() {
    this._setPainelEsqEstado('vazio');

    // Painel direito: mostra decoração
    document.getElementById('detalhe-area').style.display = 'none';
    document.getElementById('dir-grid-bg').classList.remove('oculto');
    document.getElementById('dir-vazio-center').classList.remove('oculto');
  },

  _mostrarLoading() {
    this._setPainelEsqEstado('loading');
    document.getElementById('detalhe-area').style.display = 'none';
  },

  _mostrarSemDados(dia) {
    this._setPainelEsqEstado('sem');
    const diaStr  = String(dia).padStart(2, '0');
    const mesStr  = String(ESTADO.mes).padStart(2, '0');
    document.getElementById('esq-sem-dados-txt').textContent =
      `Nenhum fechamento registrado para ${diaStr}/${mesStr}/${ESTADO.ano}.`;

    document.getElementById('detalhe-area').style.display = 'none';
    document.getElementById('dir-grid-bg').classList.remove('oculto');
    document.getElementById('dir-vazio-center').classList.add('oculto');
  },

  /* ──────────────────────────────────────────────────────────
     3j. CONTROLES DAS SEÇÕES (ACCORDION)
  ─────────────────────────────────────────────────────────── */

  toggleSecao(headerEl) {
    const sec     = headerEl.closest('.sec');
    const secName = headerEl.dataset.sec;

    sec.classList.toggle('collapsed');
    ESTADO.secoesAbertas[secName] = !sec.classList.contains('collapsed');
  },

  /* ──────────────────────────────────────────────────────────
     3k. EDIÇÃO
  ─────────────────────────────────────────────────────────── */

  toggleEdicao() {
    ESTADO.modoEdicao = !ESTADO.modoEdicao;
    const btn = document.getElementById('btn-editar');
    if (btn) {
      btn.innerHTML = ESTADO.modoEdicao
        ? '<i class="fas fa-times"></i> Cancelar'
        : '<i class="fas fa-pen"></i> Editar';
    }
    this.toast(ESTADO.modoEdicao ? 'Modo de edição ativado' : 'Edição cancelada', 'info');
    // ─── PONTO DE INTEGRAÇÃO ───
    // Aqui você ativaria os campos editáveis dos cartões do painel esquerdo
  },

  iniciarNovo() {
    this.toast('Redirecionando para o fechamento...', 'ok');
    // ─── PONTO DE INTEGRAÇÃO ───
    // Redirecione para a tela de fechamento de caixa existente
    // Exemplo: window.location.href = './fechamento-caixa.html';
  },

  imprimir() {
    window.print();
  },

  /* ──────────────────────────────────────────────────────────
     3l. MODAIS
  ─────────────────────────────────────────────────────────── */

  abrirModal(id) {
    document.getElementById(id).classList.add('aberto');
  },

  fecharModal(id) {
    document.getElementById(id).classList.remove('aberto');
  },

  irInicio() {
    this.fecharModal('modal-inicio');
    // ─── PONTO DE INTEGRAÇÃO ───
    // window.location.href = './index.html';
    this.toast('Voltando ao menu...', 'ok');
  },

  sair() {
    this.fecharModal('modal-sair');
    // ─── PONTO DE INTEGRAÇÃO ───
    // Chame sua função de logout aqui
    this.toast('Encerrando sessão...', 'info');
  },

  /* ──────────────────────────────────────────────────────────
     3m. TOAST DE NOTIFICAÇÃO
  ─────────────────────────────────────────────────────────── */

  _toastTimer: null,

  toast(msg, tipo = 'ok') {
    const el  = document.getElementById('toast');
    const ico = document.getElementById('toast-ico');
    const txt = document.getElementById('toast-msg');

    const icones = { ok: '✓', erro: '✕', info: 'ℹ', aviso: '⚠' };
    ico.textContent = icones[tipo] || '✓';
    txt.textContent = msg;

    el.style.borderColor = {
      ok:    'rgba(0,200,150,.3)',
      erro:  'rgba(255,79,79,.3)',
      info:  'rgba(77,166,255,.3)',
      aviso: 'rgba(240,167,50,.3)',
    }[tipo] || '';

    el.classList.add('visivel');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('visivel'), 3000);
  },

  /* ──────────────────────────────────────────────────────────
     3n. CÁLCULOS
  ─────────────────────────────────────────────────────────── */

  _calcularBalanco(fech, totProd, totBol, totDiv) {
    // DÉBITOS: o que a lotérica devia ter recebido
    const debitos = (fech.troco_ini   || 0)
                  + totProd
                  + totBol
                  + (fech.relatorio   || 0);

    // CRÉDITOS: o que efetivamente entrou/foi contabilizado
    const creditos = (fech.troco_sob    || 0)
                   + (fech.deposito     || 0)
                   + (fech.pix_cnpj     || 0)
                   + (fech.pix_dif      || 0)
                   + (fech.premio_rasp  || 0)
                   + (fech.resgate_tele || 0)
                   + totDiv;

    return { debitos, creditos };
  },

  _calcularQuebra(fech) {
    // Versão simplificada para indicador nas abas (sem tabelas filhas)
    const creditos = (fech.troco_sob    || 0)
                   + (fech.deposito     || 0)
                   + (fech.pix_cnpj     || 0)
                   + (fech.pix_dif      || 0)
                   + (fech.premio_rasp  || 0)
                   + (fech.resgate_tele || 0);
    const debitos  = (fech.troco_ini   || 0)
                   + (fech.relatorio   || 0);
    return creditos - debitos;
  },

  _somarProdutos(lista) {
    return lista.reduce((s, p) => s + (p.quantidade || 0) * (p.valor_unit || 0), 0);
  },

  _somarBoloes(lista) {
    return lista.reduce((s, b) => s + (b.cotas_vendidas || 0) * (b.valor_cota || 0), 0);
  },

  _somarDividas(lista) {
    return lista.reduce((s, d) => s + (d.valor || 0), 0);
  },

  /* ──────────────────────────────────────────────────────────
     3o. UTILITÁRIOS
  ─────────────────────────────────────────────────────────── */

  /**
   * Formata valor como moeda brasileira.
   * @param {number} val
   * @returns {string}
   */
  _moeda(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },

  /**
   * Escapa HTML para evitar XSS ao inserir dados no DOM.
   */
  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  /**
   * Retorna a classe CSS correta para o chip de tipo.
   */
  _chipTipo(tipo) {
    const mapa = {
      'RASPADINHA': 'chip-rasp',
      'TELESENA':   'chip-tele',
      'FEDERAL':    'chip-fed',
      'INTERNO':    'chip-int',
      'EXTERNO':    'chip-ext',
    };
    return mapa[tipo] || '';
  },

};


/* ════════════════════════════════════════════════════════════
   INICIALIZAÇÃO
════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  VIEWER.init();
});
