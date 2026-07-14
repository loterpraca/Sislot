(() => {
  'use strict';

  const CONFIG = Object.freeze({
    view: 'view_gerente_controle_cotas',
    timezone: 'America/Sao_Paulo',
    perfisPermitidos: ['GERENTE', 'SOCIO', 'ADMIN'],
    canaisFinais: ['WhatsApp', 'Balcão'],
  });

  const CORES_MODALIDADES = Object.freeze({
    'LOTOFÁCIL': '#d86ca5',
    'DUPLA SENA': '#d85b7b',
    'QUINA': '#7676df',
    'MEGA SENA': '#34bba8',
    'MEGA-SENA': '#34bba8',
    'TIMEMANIA': '#d5a34d',
    'DIA DE SORTE': '#dd8b54',
    'SUPERSETE': '#a47be8',
    'SUPER 7': '#a47be8',
    'MILIONÁRIA': '#3fc28a',
    '+MILIONÁRIA': '#3fc28a',
    'LOTECA': '#4da3e6',
  });

  let supabase = null;
  let contexto = null;

  const estado = {
    dataReferencia: '',
    lojaId: '',
    lojas: [],
    registros: [],
    registrosFiltrados: [],
    colunasVenda: [],
    carregando: false,
  };

  const $ = (id) => document.getElementById(id);

  async function bootstrap() {
    iniciarRelogio();
    vincularEventosBasicos();
    definirDataHoje();

    try {
      validarDependencias();
      supabase = window.supabase.createClient(
        window.SISLOT_CONFIG.url,
        window.SISLOT_CONFIG.anonKey,
      );

      contexto = await window.SISLOT_SECURITY.protegerPagina(supabase, {
        perfisPermitidos: CONFIG.perfisPermitidos,
      });

      carregarLojasPermitidas();
      await atualizarDados({ silencioso: true });
    } catch (erro) {
      console.error('[Controle de Cotas] Falha ao iniciar:', erro);
      mostrarErro(normalizarMensagemErro(erro));
    }
  }

  function validarDependencias() {
    if (!window.supabase?.createClient) {
      throw new Error('Biblioteca Supabase não carregada.');
    }
    if (!window.SISLOT_CONFIG?.url || !window.SISLOT_CONFIG?.anonKey) {
      throw new Error('SISLOT_CONFIG não foi carregado corretamente.');
    }
    if (!window.SISLOT_SECURITY?.protegerPagina) {
      throw new Error('sislot-security.js não foi carregado corretamente.');
    }
  }

  function vincularEventosBasicos() {
    $('btnAtualizar')?.addEventListener('click', () => atualizarDados());
    $('btnTentarNovamente')?.addEventListener('click', () => atualizarDados());
    $('btnHoje')?.addEventListener('click', () => {
      definirDataHoje();
      atualizarDados({ silencioso: true });
    });
    $('btnDataAnterior')?.addEventListener('click', () => alterarData(-1));
    $('btnProximaData')?.addEventListener('click', () => alterarData(1));

    $('dataReferencia')?.addEventListener('change', (event) => {
      estado.dataReferencia = event.target.value || dataHojeSaoPaulo();
      atualizarDados({ silencioso: true });
    });

    $('filtroLoja')?.addEventListener('change', (event) => {
      estado.lojaId = event.target.value;
      atualizarCabecalhoLoja();
      atualizarDados({ silencioso: true });
    });

    $('filtroBusca')?.addEventListener('input', aplicarFiltrosLocais);
    $('filtroStatus')?.addEventListener('change', aplicarFiltrosLocais);

    $('btnLogout')?.addEventListener('click', async () => {
      try {
        if (window.SISLOT_SECURITY?.logout) {
          await window.SISLOT_SECURITY.logout(supabase);
          return;
        }
        await supabase?.auth?.signOut();
      } finally {
        window.location.href = './login.html';
      }
    });
  }

  function iniciarRelogio() {
    const atualizar = () => {
      const agora = new Date();
      const texto = new Intl.DateTimeFormat('pt-BR', {
        timeZone: CONFIG.timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(agora);
      if ($('relogio')) $('relogio').textContent = texto;
    };
    atualizar();
    window.setInterval(atualizar, 1000);
  }

  function carregarLojasPermitidas() {
    const lojasContexto = Array.isArray(contexto?.lojasPermitidas)
      ? contexto.lojasPermitidas
      : [];

    estado.lojas = lojasContexto
      .map((loja) => ({
        id: String(loja.loteria_id ?? loja.id ?? ''),
        nome: loja.nome ?? loja.loteria_nome ?? loja.loja_nome ?? 'Loja',
      }))
      .filter((loja) => loja.id);

    if (!estado.lojas.length) {
      throw new Error('O usuário não possui uma loja autorizada para este painel.');
    }

    const select = $('filtroLoja');
    select.innerHTML = '';

    estado.lojas.forEach((loja) => {
      const option = document.createElement('option');
      option.value = loja.id;
      option.textContent = loja.nome;
      select.appendChild(option);
    });

    estado.lojaId = estado.lojas[0].id;
    select.value = estado.lojaId;

    const perfil = String(contexto?.usuario?.perfil || '').toUpperCase();
    const usuarioTemUmaLoja = estado.lojas.length === 1;
    const gerente = perfil === 'GERENTE';

    select.disabled = usuarioTemUmaLoja || (gerente && estado.lojas.length === 1);
    $('grupoLoja')?.classList.toggle('is-locked', select.disabled);
    atualizarCabecalhoLoja();
  }

  function atualizarCabecalhoLoja() {
    const loja = estado.lojas.find((item) => item.id === String(estado.lojaId));
    if ($('headerLoja')) $('headerLoja').textContent = loja?.nome || 'Loja não selecionada';
  }

  function definirDataHoje() {
    estado.dataReferencia = dataHojeSaoPaulo();
    if ($('dataReferencia')) $('dataReferencia').value = estado.dataReferencia;
  }

  function alterarData(dias) {
    const base = parseDataLocal(estado.dataReferencia || dataHojeSaoPaulo());
    base.setDate(base.getDate() + dias);
    estado.dataReferencia = formatarDataISO(base);
    $('dataReferencia').value = estado.dataReferencia;
    atualizarDados({ silencioso: true });
  }

  async function atualizarDados({ silencioso = false } = {}) {
    if (estado.carregando || !supabase || !estado.lojaId || !estado.dataReferencia) return;

    estado.carregando = true;
    definirCarregamento(true);
    mostrarEstado('carregando');

    try {
      const { data, error } = await supabase
        .from(CONFIG.view)
        .select(`
          bolao_id,
          loja_id,
          loja_nome,
          origem_id,
          origem_nome,
          eh_origem,
          dt_inicial,
          dt_concurso,
          modalidade,
          concurso,
          qtd_jogos,
          qtd_dezenas,
          valor_cota,
          status_bolao,
          qtd_fisicas_origem_coletadas,
          qtd_impressas_coletadas,
          qtd_fisica_bruta_origem,
          qtd_movimentada_destinos,
          qtd_recebida_movimentacao,
          qtd_inicial_loja,
          vendas_por_responsavel,
          qtd_total_vendida,
          saldo_loja,
          status_saldo,
          ultima_coleta_sp_texto,
          status_coleta_marketplace
        `)
        .eq('loja_id', estado.lojaId)
        .lte('dt_inicial', estado.dataReferencia)
        .gte('dt_concurso', estado.dataReferencia)
        .order('dt_concurso', { ascending: true })
        .order('modalidade', { ascending: true })
        .order('concurso', { ascending: true });

      if (error) throw error;

      estado.registros = (data || []).map(normalizarRegistro);
      atualizarUltimaAtualizacao();
      aplicarFiltrosLocais();

      if (!silencioso) {
        toast('Informações atualizadas', `${estado.registros.length} bolões vigentes consultados.`, 'success');
      }
    } catch (erro) {
      console.error('[Controle de Cotas] Erro ao consultar:', erro);
      mostrarErro(normalizarMensagemErro(erro));
      if (!silencioso) toast('Falha na atualização', normalizarMensagemErro(erro), 'error');
    } finally {
      estado.carregando = false;
      definirCarregamento(false);
    }
  }

  function normalizarRegistro(row) {
    const vendas = normalizarObjetoVendas(row.vendas_por_responsavel);

    return {
      ...row,
      bolao_id: Number(row.bolao_id || 0),
      loja_id: String(row.loja_id ?? ''),
      origem_id: String(row.origem_id ?? ''),
      eh_origem: Boolean(row.eh_origem),
      qtd_jogos: numero(row.qtd_jogos),
      qtd_dezenas: numero(row.qtd_dezenas),
      valor_cota: numero(row.valor_cota),
      qtd_fisicas_origem_coletadas: numero(row.qtd_fisicas_origem_coletadas),
      qtd_impressas_coletadas: numero(row.qtd_impressas_coletadas),
      qtd_fisica_bruta_origem: numero(row.qtd_fisica_bruta_origem),
      qtd_movimentada_destinos: numero(row.qtd_movimentada_destinos),
      qtd_recebida_movimentacao: numero(row.qtd_recebida_movimentacao),
      qtd_inicial_loja: numero(row.qtd_inicial_loja),
      qtd_total_vendida: numero(row.qtd_total_vendida),
      saldo_loja: numero(row.saldo_loja),
      vendas_por_responsavel: vendas,
      status_saldo: row.status_saldo || calcularStatusSaldo(numero(row.saldo_loja)),
    };
  }

  function aplicarFiltrosLocais() {
    const busca = normalizarTexto($('filtroBusca')?.value || '');
    const status = $('filtroStatus')?.value || '';

    estado.registrosFiltrados = estado.registros.filter((row) => {
      const combinaBusca = !busca || [
        row.origem_nome,
        row.modalidade,
        row.concurso,
        row.bolao_id,
        row.dt_concurso,
      ].some((valor) => normalizarTexto(valor).includes(busca));

      const combinaStatus = !status || row.status_saldo === status;
      return combinaBusca && combinaStatus;
    });

    estado.colunasVenda = descobrirColunasVenda(estado.registrosFiltrados);
    renderizarTudo();
  }

  function descobrirColunasVenda(registros) {
    const nomes = new Set();
    registros.forEach((row) => {
      Object.keys(row.vendas_por_responsavel || {}).forEach((nome) => nomes.add(nome));
    });

    const canais = new Set(CONFIG.canaisFinais);
    const funcionarios = [...nomes]
      .filter((nome) => !canais.has(nome))
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    const colunasCanais = CONFIG.canaisFinais.filter((nome) => nomes.has(nome));
    return [...funcionarios, ...colunasCanais];
  }

  function renderizarTudo() {
    renderizarCabecalhoTabela();
    renderizarLinhas();
    renderizarKpis();
    atualizarTituloTabela();

    const total = estado.registrosFiltrados.length;
    $('contadorLinhas').textContent = `${total} ${total === 1 ? 'bolão exibido' : 'bolões exibidos'}`;
    mostrarEstado(total ? 'dados' : 'vazio');
  }

  function renderizarCabecalhoTabela() {
    const fixasInicio = [
      ['Origem', ''],
      ['Data concurso', ''],
      ['Modalidade', ''],
      ['Concurso', 'gc-col-num'],
      ['Jogos', 'gc-col-num'],
      ['Dezenas', 'gc-col-num'],
      ['Valor', 'gc-col-num'],
      ['Qtd. inicial', 'gc-col-num'],
    ];

    const dinamicas = estado.colunasVenda.map((nome) => [abreviarNomeColuna(nome), 'gc-col-num']);
    const fixasFim = [
      ['Total vendido', 'gc-col-num'],
      ['Saldo', 'gc-col-num'],
    ];

    const celulas = [...fixasInicio, ...dinamicas, ...fixasFim]
      .map(([titulo, classe]) => `<th class="${classe}" title="${escapeHtml(titulo)}">${escapeHtml(titulo)}</th>`)
      .join('');

    $('tabelaHead').innerHTML = `<tr>${celulas}</tr>`;
  }

  function renderizarLinhas() {
    const tbody = $('tabelaBody');

    tbody.innerHTML = estado.registrosFiltrados.map((row) => {
      const classeStatus = row.saldo_loja < 0
        ? 'is-danger'
        : row.saldo_loja === 0
          ? 'is-empty'
          : '';
      const classeOrigem = row.eh_origem ? 'is-origin' : 'is-received';
      const cor = corModalidade(row.modalidade);

      const vendasDinamicas = estado.colunasVenda.map((nome) => {
        const valor = numero(row.vendas_por_responsavel?.[nome]);
        return `
          <td class="gc-col-num" title="${escapeHtml(nome)}">
            <span class="gc-sales-value ${valor ? 'has-sale' : 'no-sale'}">${valor || '—'}</span>
          </td>
        `;
      }).join('');

      const detalheInicial = row.eh_origem
        ? `Físicas ${row.qtd_fisicas_origem_coletadas} · Impressas ${row.qtd_impressas_coletadas} · Saídas ${row.qtd_movimentada_destinos}`
        : `Recebidas ${row.qtd_recebida_movimentacao}`;

      return `
        <tr class="${classeOrigem} ${classeStatus}" data-bolao-id="${row.bolao_id}">
          <td>
            <div class="gc-origin-cell">
              <strong title="${escapeHtml(row.origem_nome || '—')}">${escapeHtml(row.origem_nome || '—')}</strong>
              <span class="gc-badge ${row.eh_origem ? 'gc-badge--origin' : 'gc-badge--received'}">
                ${row.eh_origem ? 'Origem' : 'Recebido'}
              </span>
            </div>
          </td>
          <td class="gc-number">${formatarDataBR(row.dt_concurso)}</td>
          <td>
            <span class="gc-modality" style="--modalidade-cor:${cor}">
              <i class="gc-modality__dot"></i>
              ${escapeHtml(row.modalidade || '—')}
            </span>
          </td>
          <td class="gc-col-num gc-concurso">${escapeHtml(row.concurso || '—')}</td>
          <td class="gc-col-num gc-number">${formatarInteiro(row.qtd_jogos)}</td>
          <td class="gc-col-num gc-number">${formatarInteiro(row.qtd_dezenas)}</td>
          <td class="gc-col-num gc-money">${formatarMoeda(row.valor_cota)}</td>
          <td class="gc-col-num">
            <span class="gc-number">${formatarInteiro(row.qtd_inicial_loja)}</span>
            <small class="gc-details" title="${escapeHtml(detalheInicial)}">${escapeHtml(detalheInicial)}</small>
          </td>
          ${vendasDinamicas}
          <td class="gc-col-num gc-number gc-total-value">${formatarInteiro(row.qtd_total_vendida)}</td>
          <td class="gc-col-num">
            <span class="gc-balance ${classeSaldo(row.saldo_loja)}">${formatarInteiro(row.saldo_loja)}</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderizarKpis() {
    const totais = estado.registrosFiltrados.reduce((acc, row) => {
      acc.inicial += row.qtd_inicial_loja;
      acc.vendidas += row.qtd_total_vendida;
      acc.saldo += row.saldo_loja;
      if (row.saldo_loja < 0) acc.alertas += 1;
      return acc;
    }, { inicial: 0, vendidas: 0, saldo: 0, alertas: 0 });

    $('kpiBoloes').textContent = formatarInteiro(estado.registrosFiltrados.length);
    $('kpiInicial').textContent = formatarInteiro(totais.inicial);
    $('kpiVendidas').textContent = formatarInteiro(totais.vendidas);
    $('kpiSaldo').textContent = formatarInteiro(totais.saldo);
    $('kpiAlertas').textContent = formatarInteiro(totais.alertas);
  }

  function atualizarTituloTabela() {
    const loja = estado.lojas.find((item) => item.id === String(estado.lojaId));
    $('tituloTabela').textContent = `${loja?.nome || 'Loja'} · ${formatarDataBR(estado.dataReferencia)}`;
  }

  function mostrarEstado(tipo) {
    const mapa = {
      carregando: 'estadoCarregando',
      vazio: 'estadoVazio',
      erro: 'estadoErro',
    };

    Object.values(mapa).forEach((id) => $(id)?.classList.add('gc-state--hidden'));
    $('tabelaCotas').style.visibility = tipo === 'dados' ? 'visible' : 'hidden';

    if (tipo !== 'dados' && mapa[tipo]) {
      $(mapa[tipo])?.classList.remove('gc-state--hidden');
    }
  }

  function mostrarErro(mensagem) {
    if ($('mensagemErro')) $('mensagemErro').textContent = mensagem;
    mostrarEstado('erro');
  }

  function definirCarregamento(ativo) {
    const botao = $('btnAtualizar');
    if (!botao) return;
    botao.disabled = ativo;
    botao.classList.toggle('is-loading', ativo);
    botao.querySelector('span').textContent = ativo ? 'Atualizando…' : 'Atualizar';
  }

  function atualizarUltimaAtualizacao() {
    const agora = new Date();
    const texto = new Intl.DateTimeFormat('pt-BR', {
      timeZone: CONFIG.timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(agora);
    $('ultimaAtualizacao').textContent = texto;
  }

  function normalizarObjetoVendas(valor) {
    if (!valor) return {};
    if (typeof valor === 'object' && !Array.isArray(valor)) {
      return Object.fromEntries(Object.entries(valor).map(([chave, qtd]) => [chave, numero(qtd)]));
    }
    try {
      const parsed = JSON.parse(valor);
      return normalizarObjetoVendas(parsed);
    } catch {
      return {};
    }
  }

  function classeSaldo(valor) {
    if (valor < 0) return 'gc-balance--danger';
    if (valor === 0) return 'gc-balance--zero';
    return 'gc-balance--ok';
  }

  function calcularStatusSaldo(valor) {
    if (valor < 0) return 'SALDO_NEGATIVO';
    if (valor === 0) return 'ESGOTADO';
    return 'COM_SALDO';
  }

  function abreviarNomeColuna(nome) {
    if (CONFIG.canaisFinais.includes(nome)) return nome;
    const partes = String(nome).trim().split(/\s+/).filter(Boolean);
    if (partes.length <= 2) return partes.join(' ');
    return `${partes[0]} ${partes[partes.length - 1]}`;
  }

  function corModalidade(modalidade) {
    return CORES_MODALIDADES[String(modalidade || '').toUpperCase()] || '#6fa5d2';
  }

  function dataHojeSaoPaulo() {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: CONFIG.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const mapa = Object.fromEntries(partes.map((item) => [item.type, item.value]));
    return `${mapa.year}-${mapa.month}-${mapa.day}`;
  }

  function parseDataLocal(valor) {
    const [ano, mes, dia] = String(valor).split('-').map(Number);
    return new Date(ano, (mes || 1) - 1, dia || 1, 12, 0, 0, 0);
  }

  function formatarDataISO(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  function formatarDataBR(valor) {
    if (!valor) return '—';
    const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
    if (!ano || !mes || !dia) return String(valor);
    return `${dia}/${mes}/${ano}`;
  }

  function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format(numero(valor));
  }

  function formatarInteiro(valor) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(numero(valor));
  }

  function numero(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizarTexto(valor) {
    return String(valor ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function escapeHtml(valor) {
    return String(valor ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizarMensagemErro(erro) {
    const mensagem = erro?.message || erro?.error_description || String(erro || 'Erro desconhecido.');
    if (mensagem.includes('permission denied')) return 'Seu usuário não possui permissão para consultar esta fonte.';
    if (mensagem.includes('does not exist')) return 'A view view_gerente_controle_cotas ainda não está disponível no banco.';
    return mensagem;
  }

  function toast(titulo, mensagem, tipo = 'info') {
    const stack = $('toastStack');
    if (!stack) return;

    const el = document.createElement('div');
    el.className = `gc-toast gc-toast--${tipo}`;
    el.innerHTML = `
      <i class="gc-toast__dot" aria-hidden="true"></i>
      <div>
        <strong>${escapeHtml(titulo)}</strong>
        <span>${escapeHtml(mensagem)}</span>
      </div>
    `;
    stack.appendChild(el);

    window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      window.setTimeout(() => el.remove(), 220);
    }, 3600);
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
