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

    renderizarTudo();
  }


  function temaOrigem(row) {
    const texto = normalizarTexto(`${row.origem_nome || ''} ${row.origem_id || ''}`);

    if (texto.includes('boulevard') || row.origem_id === '2') return { slug: 'boulevard', nome: 'Boulevard', cor: '#3b82f6', brilho: 'rgba(59,130,246,.22)' };
    if (texto.includes('centro') || row.origem_id === '1') return { slug: 'centro', nome: 'Centro', cor: '#00b3a4', brilho: 'rgba(0,179,164,.22)' };
    if (texto.includes('lotobel') || row.origem_id === '3') return { slug: 'lotobel', nome: 'Lotobel', cor: '#e11d48', brilho: 'rgba(225,29,72,.22)' };
    if (texto.includes('santa') || texto.includes('tereza') || row.origem_id === '4') return { slug: 'santa-tereza', nome: 'Santa Tereza', cor: '#f59e0b', brilho: 'rgba(245,158,11,.22)' };
    if (texto.includes('via brasil') || texto.includes('viabrasil') || row.origem_id === '5') return { slug: 'via-brasil', nome: 'Via Brasil', cor: '#22c55e', brilho: 'rgba(34,197,94,.22)' };
    if (texto.includes('lotoprime') || row.origem_id === '6') return { slug: 'lotoprime', nome: 'Lotoprime', cor: '#8b5cf6', brilho: 'rgba(139,92,246,.22)' };
    return { slug: 'padrao', nome: row.origem_nome || 'Origem', cor: '#4cb8ff', brilho: 'rgba(76,184,255,.22)' };
  }

  function renderizarCards() {
    const grid = $('cardsGrid');
    if (!grid) return;

    grid.innerHTML = '';

    if (!estado.registrosFiltrados.length) return;

    const grupos = new Map();
    estado.registrosFiltrados.forEach((row) => {
      const chave = row.modalidade || 'Outros';
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(row);
    });

    [...grupos.entries()].forEach(([modalidade, itens]) => {
      const grupo = document.createElement('section');
      grupo.className = 'gc-card-group';
      grupo.innerHTML = `
        <div class="gc-card-group__head">
          <span class="gc-card-group__name">${escapeHtml(modalidade)}</span>
          <span class="gc-card-group__line"></span>
          <span class="gc-card-group__count">${formatarInteiro(itens.length)}</span>
        </div>
        <div class="gc-card-group__grid"></div>
      `;

      const target = grupo.querySelector('.gc-card-group__grid');
      itens.forEach((row) => target.insertAdjacentHTML('beforeend', renderizarCard(row)));
      grid.appendChild(grupo);
    });
  }

  function renderizarCard(row) {
    const cor = corModalidade(row.modalidade);
    const tema = temaOrigem(row);
    const classeSaldo = row.saldo_loja < 0 ? 'is-danger' : row.saldo_loja === 0 ? 'is-empty' : 'is-ok';
    const tituloQuantidade = row.eh_origem ? 'Ficaram na origem' : 'Recebidas';
    const quantidadeDestaque = row.eh_origem ? row.qtd_inicial_loja : row.qtd_recebida_movimentacao;
    const detalheOperacao = row.eh_origem
      ? `Imp. origem ${formatarInteiro(row.qtd_fisicas_origem_coletadas)} · Baixadas imp. ${formatarInteiro(row.qtd_impressas_coletadas)} · Movimentadas ${formatarInteiro(row.qtd_movimentada_destinos)}`
      : `Recebidas da origem ${escapeHtml(row.origem_nome || '—')}`;

    const chipsVenda = montarChipsVenda(row);

    return `
      <article class="gc-bolao-card ${row.eh_origem ? 'is-origin' : 'is-received'} ${classeSaldo}" style="--gc-store:${tema.cor}; --gc-store-glow:${tema.brilho}; --gc-modalidade:${cor};">
        <div class="gc-bolao-card__head">
          <div class="gc-bolao-card__head-left">
            <span class="gc-badge ${row.eh_origem ? 'gc-badge--origin' : 'gc-badge--received'}">${row.eh_origem ? 'Origem' : 'Recebido'}</span>
            <span class="gc-store-chip gc-store-chip--${tema.slug}">${escapeHtml(tema.nome)}</span>
            <span class="gc-date-chip">${formatarDataBR(row.dt_concurso)}</span>
          </div>
          <div class="gc-bolao-card__id">#${escapeHtml(row.concurso || '—')}</div>
        </div>

        <div class="gc-bolao-card__title-wrap">
          <h3 class="gc-bolao-card__title">
            <i class="gc-modality__dot"></i>
            ${escapeHtml(row.modalidade || '—')}
          </h3>
          <div class="gc-bolao-card__meta">
            <span class="gc-mini-chip">${formatarInteiro(row.qtd_jogos)} jogo${row.qtd_jogos === 1 ? '' : 's'}</span>
            <span class="gc-mini-chip">${formatarInteiro(row.qtd_dezenas)} dez.</span>
            <span class="gc-mini-chip gc-mini-chip--money">${formatarMoeda(row.valor_cota)}</span>
          </div>
        </div>

        <div class="gc-metrics-grid">
          <div class="gc-metric-tile gc-metric-tile--featured">
            <span class="gc-metric-tile__label">${tituloQuantidade}</span>
            <strong class="gc-metric-tile__value">${formatarInteiro(quantidadeDestaque)}</strong>
            <small class="gc-metric-tile__hint">${row.eh_origem ? 'Qtd. física que ficou na loja' : 'Qtd. física recebida para venda'}</small>
          </div>

          <div class="gc-metric-tile gc-metric-tile--soft">
            <span class="gc-metric-tile__label">Vendidas</span>
            <strong class="gc-metric-tile__value">${formatarInteiro(row.qtd_total_vendida)}</strong>
          </div>

          <div class="gc-metric-tile gc-metric-tile--saldo ${classeSaldo}">
            <span class="gc-metric-tile__label">Saldo físico</span>
            <strong class="gc-metric-tile__value">${formatarInteiro(row.saldo_loja)}</strong>
          </div>
        </div>

        <div class="gc-bolao-card__detail-row">
          <div class="gc-bolao-card__detail-main">${detalheOperacao}</div>
          <div class="gc-bolao-card__detail-side">Bolão #${formatarInteiro(row.bolao_id)}</div>
        </div>

        ${chipsVenda ? `
          <div class="gc-sales-block">
            <div class="gc-sales-block__label">Vendas registradas</div>
            <div class="gc-sales-chips">${chipsVenda}</div>
          </div>
        ` : ''}
      </article>
    `;
  }

  function montarChipsVenda(row) {
    const entradas = Object.entries(row.vendas_por_responsavel || {})
      .map(([nome, valor]) => [nome, numero(valor)])
      .filter(([, valor]) => valor > 0)
      .sort((a, b) => {
        const aFinal = CONFIG.canaisFinais.includes(a[0]) ? 1 : 0;
        const bFinal = CONFIG.canaisFinais.includes(b[0]) ? 1 : 0;
        if (aFinal !== bFinal) return aFinal - bFinal;
        return a[0].localeCompare(b[0], 'pt-BR', { sensitivity: 'base' });
      });

    if (!entradas.length) return '';

    return entradas.map(([nome, valor]) => `
      <span class="gc-sales-chip" title="${escapeHtml(nome)}">
        <span class="gc-sales-chip__name">${escapeHtml(abreviarNomeColuna(nome))}</span>
        <strong class="gc-sales-chip__value">${formatarInteiro(valor)}</strong>
      </span>
    `).join('');
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
    if ($('cardsGrid')) $('cardsGrid').style.visibility = tipo === 'dados' ? 'visible' : 'hidden';

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
