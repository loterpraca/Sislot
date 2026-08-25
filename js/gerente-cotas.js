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
    'INDEPENDÊNCIA': '#d86ca5',
    'VIRADA': '#34bba8',
    'SÃO JOÃO': '#7676df',
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
    vincularEventos();
    definirDataHoje();

    try {
      validarDependencias();
      supabase = obterClienteSupabase();
      contexto = await window.SISLOT_SECURITY.protegerPagina(supabase, {
        perfisPermitidos: CONFIG.perfisPermitidos,
      });
      if (!contexto) return;
      carregarLojasPermitidas();
      await atualizarDados({ silencioso: true });
    } catch (erro) {
      console.error('[Controle de Cotas] Falha ao iniciar:', erro);
      mostrarErro(normalizarMensagemErro(erro));
    }
  }

  function obterClienteSupabase() {
    if (window.SISLOT_SUPABASE) return window.SISLOT_SUPABASE;
    if (window.sislotSupabase) return window.sislotSupabase;
    const client = window.supabase.createClient(
      window.SISLOT_CONFIG.url,
      window.SISLOT_CONFIG.anonKey,
    );
    window.sislotSupabase = client;
    return client;
  }

  function validarDependencias() {
    if (!window.supabase?.createClient) throw new Error('Biblioteca Supabase não carregada.');
    if (!window.SISLOT_CONFIG?.url || !window.SISLOT_CONFIG?.anonKey) throw new Error('SISLOT_CONFIG não carregado.');
    if (!window.SISLOT_SECURITY?.protegerPagina) throw new Error('sislot-security.js não carregado.');
  }

  function vincularEventos() {
    $('btnAtualizar')?.addEventListener('click', () => atualizarDados());
    $('btnTentarNovamente')?.addEventListener('click', () => atualizarDados());
    $('btnHoje')?.addEventListener('click', () => { definirDataHoje(); atualizarDados({ silencioso: true }); });
    $('btnDataAnterior')?.addEventListener('click', () => alterarData(-1));
    $('btnProximaData')?.addEventListener('click', () => alterarData(1));
    $('dataReferencia')?.addEventListener('change', (e) => { estado.dataReferencia = e.target.value || dataHojeSaoPaulo(); atualizarDados({ silencioso: true }); });
    $('filtroLoja')?.addEventListener('change', (e) => { estado.lojaId = e.target.value; atualizarCabecalhoLoja(); atualizarDados({ silencioso: true }); });
    $('filtroBusca')?.addEventListener('input', aplicarFiltrosLocais);
    $('filtroStatus')?.addEventListener('change', aplicarFiltrosLocais);
    $('btnLogout')?.addEventListener('click', async () => {
      try {
        if (window.SISLOT_SECURITY?.logout) await window.SISLOT_SECURITY.logout(supabase);
        else await supabase?.auth?.signOut();
      } finally { window.location.href = './login.html'; }
    });
  }

  function iniciarRelogio() {
    const atualizar = () => {
      if (!$('relogio')) return;
      $('relogio').textContent = new Intl.DateTimeFormat('pt-BR', {
        timeZone: CONFIG.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date());
    };
    atualizar();
    window.setInterval(atualizar, 1000);
  }

  function carregarLojasPermitidas() {
    const lojasContexto = Array.isArray(contexto?.lojasPermitidas) ? contexto.lojasPermitidas : [];
    estado.lojas = lojasContexto.map((loja) => ({
      id: String(loja.loteria_id ?? loja.id ?? ''),
      nome: loja.nome ?? loja.loteria_nome ?? loja.loja_nome ?? 'Loja',
    })).filter((loja) => loja.id);
    if (!estado.lojas.length) throw new Error('O usuário não possui loja autorizada para este painel.');

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
    select.disabled = estado.lojas.length === 1 && perfil === 'GERENTE';
    $('grupoLoja')?.classList.toggle('is-locked', select.disabled);
    atualizarCabecalhoLoja();
  }

  function atualizarCabecalhoLoja() {
    const loja = estado.lojas.find((item) => item.id === String(estado.lojaId));
    if ($('headerLoja')) $('headerLoja').textContent = loja?.nome || '—';
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
          bolao_id, loja_id, loja_nome, origem_id, origem_nome, eh_origem,
          dt_inicial, dt_concurso, modalidade, concurso, qtd_jogos, qtd_dezenas,
          valor_cota, status_bolao, qtd_fisicas_origem_coletadas, qtd_impressas_coletadas,
          qtd_fisica_bruta_origem, qtd_movimentada_destinos, qtd_recebida_movimentacao,
          qtd_inicial_loja, vendas_por_responsavel, qtd_total_vendida, saldo_loja, status_saldo
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
      if (!silencioso) toast('Atualizado', `${estado.registros.length} bolões consultados.`, 'success');
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
    return {
      ...row,
      bolao_id: numero(row.bolao_id),
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
      vendas_por_responsavel: normalizarObjetoVendas(row.vendas_por_responsavel),
      status_saldo: row.status_saldo || calcularStatusSaldo(numero(row.saldo_loja)),
    };
  }

  function aplicarFiltrosLocais() {
    const busca = normalizarTexto($('filtroBusca')?.value || '');
    const status = $('filtroStatus')?.value || '';
    estado.registrosFiltrados = estado.registros.filter((row) => {
      const combinaBusca = !busca || [row.origem_nome, row.modalidade, row.concurso, row.bolao_id, row.dt_concurso]
        .some((valor) => normalizarTexto(valor).includes(busca));
      return combinaBusca && (!status || row.status_saldo === status);
    });
    renderizarTudo();
  }

  function renderizarTudo() {
    renderizarCards();
    renderizarResumo();
    atualizarTitulo();
    mostrarEstado(estado.registrosFiltrados.length ? 'dados' : 'vazio');
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
        <div class="gc-card-group__grid"></div>`;
      const target = grupo.querySelector('.gc-card-group__grid');
      itens.forEach((row) => target.insertAdjacentHTML('beforeend', renderizarCard(row)));
      grid.appendChild(grupo);
    });
  }

  function renderizarCard(row) {
    const tema = temaOrigem(row);
    const corMod = corModalidade(row.modalidade);
    const saldoClasse = row.saldo_loja < 0 ? 'is-danger' : row.saldo_loja === 0 ? 'is-empty' : 'is-ok';
    const principalTitulo = row.eh_origem ? 'Ficaram na origem' : 'Recebidas';
    const principalValor = row.eh_origem ? row.qtd_inicial_loja : row.qtd_recebida_movimentacao;

    const blocoFisico = row.eh_origem
      ? `<div class="gc-physical-row">
           <div class="gc-physical-mini"><span>Imp. origem</span><strong>${formatarInteiro(row.qtd_fisicas_origem_coletadas)}</strong></div>
           <div class="gc-physical-mini"><span>Baixadas imp.</span><strong>${formatarInteiro(row.qtd_impressas_coletadas)}</strong></div>
           <div class="gc-physical-mini"><span>Movimentadas</span><strong>${formatarInteiro(row.qtd_movimentada_destinos)}</strong></div>
         </div>`
      : `<div class="gc-origin-line">Recebidas da origem <strong>${escapeHtml(row.origem_nome || '—')}</strong></div>`;

    const vendas = montarChipsVenda(row);

    return `<article class="gc-bolao-card ${saldoClasse}" style="--store:${tema.cor};--store-soft:${tema.soft};--mod:${corMod}">
      <div class="gc-card-top">
        <div class="gc-card-tags">
          <span class="gc-tag ${row.eh_origem ? 'gc-tag--origin' : 'gc-tag--received'}">${row.eh_origem ? 'Origem' : 'Recebido'}</span>
          <span class="gc-tag gc-tag--store">${escapeHtml(tema.nome)}</span>
          <span class="gc-tag">${formatarDataBR(row.dt_concurso)}</span>
        </div>
        <div class="gc-card-contest">#${escapeHtml(row.concurso || '—')}</div>
      </div>

      <h3 class="gc-card-title"><i class="gc-mod-dot"></i>${escapeHtml(row.modalidade || '—')}</h3>
      <div class="gc-card-meta">
        <span class="gc-meta-chip">${formatarInteiro(row.qtd_jogos)} jogo${row.qtd_jogos === 1 ? '' : 's'}</span>
        <span class="gc-meta-chip">${formatarInteiro(row.qtd_dezenas)} dezenas</span>
        <span class="gc-meta-chip">${formatarMoeda(row.valor_cota)}</span>
      </div>

      <div class="gc-main-metrics">
        <div class="gc-box gc-box--primary">
          <span class="gc-box-label">${principalTitulo}</span>
          <strong class="gc-box-value">${formatarInteiro(principalValor)}</strong>
          <small class="gc-box-hint">${row.eh_origem ? 'Quantidade física que permaneceu na loja' : 'Quantidade física recebida para venda'}</small>
        </div>
        <div class="gc-box">
          <span class="gc-box-label">Vendidas</span>
          <strong class="gc-box-value">${formatarInteiro(row.qtd_total_vendida)}</strong>
        </div>
        <div class="gc-box gc-box--saldo ${saldoClasse}">
          <span class="gc-box-label">Saldo físico</span>
          <strong class="gc-box-value">${formatarInteiro(row.saldo_loja)}</strong>
        </div>
      </div>

      ${blocoFisico}
      ${vendas ? `<div class="gc-sales-row"><span class="gc-sales-label">Vendas</span>${vendas}</div>` : ''}
      <div class="gc-card-foot"><span>Bolão #${formatarInteiro(row.bolao_id)}</span><span>${escapeHtml(row.loja_nome || '')}</span></div>
    </article>`;
  }

  function montarChipsVenda(row) {
    return Object.entries(row.vendas_por_responsavel || {})
      .map(([nome, valor]) => [nome, numero(valor)])
      .filter(([, valor]) => valor > 0)
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { sensitivity: 'base' }))
      .map(([nome, valor]) => `<span class="gc-sale-chip" title="${escapeHtml(nome)}">${escapeHtml(abreviarNome(nome))}<strong>${formatarInteiro(valor)}</strong></span>`)
      .join('');
  }

  function renderizarResumo() {
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
    const pill = $('alertaPill');
    if (pill) pill.hidden = totais.alertas === 0;
  }

  function atualizarTitulo() {
    const loja = estado.lojas.find((item) => item.id === String(estado.lojaId));
    if ($('tituloCards')) $('tituloCards').textContent = `${loja?.nome || 'Loja'} · ${formatarDataBR(estado.dataReferencia)}`;
  }

  function temaOrigem(row) {
    const texto = normalizarTexto(`${row.origem_nome || ''}`);
    if (texto.includes('boulevard') || row.origem_id === '2') return { nome:'Boulevard', cor:'#3b82f6', soft:'rgba(59,130,246,.10)' };
    if (texto.includes('centro') || row.origem_id === '1') return { nome:'Centro', cor:'#00b3a4', soft:'rgba(0,179,164,.10)' };
    if (texto.includes('lotobel') || row.origem_id === '3') return { nome:'Lotobel', cor:'#e11d48', soft:'rgba(225,29,72,.10)' };
    if (texto.includes('santa') || row.origem_id === '4') return { nome:'Santa Tereza', cor:'#f59e0b', soft:'rgba(245,158,11,.10)' };
    if (texto.includes('via brasil') || row.origem_id === '5') return { nome:'Via Brasil', cor:'#22c55e', soft:'rgba(34,197,94,.10)' };
    if (texto.includes('lotoprime') || row.origem_id === '6') return { nome:'Lotoprime', cor:'#8b5cf6', soft:'rgba(139,92,246,.10)' };
    return { nome:row.origem_nome || 'Origem', cor:'#45b7ff', soft:'rgba(69,183,255,.10)' };
  }

  function mostrarEstado(tipo) {
    ['estadoCarregando','estadoVazio','estadoErro'].forEach((id) => $(id)?.classList.add('gc-state--hidden'));
    if ($('cardsGrid')) $('cardsGrid').style.visibility = tipo === 'dados' ? 'visible' : 'hidden';
    const mapa = { carregando:'estadoCarregando', vazio:'estadoVazio', erro:'estadoErro' };
    if (tipo !== 'dados' && mapa[tipo]) $(mapa[tipo])?.classList.remove('gc-state--hidden');
  }

  function mostrarErro(mensagem) {
    if ($('mensagemErro')) $('mensagemErro').textContent = mensagem;
    mostrarEstado('erro');
  }

  function definirCarregamento(ativo) {
    const btn = $('btnAtualizar');
    if (!btn) return;
    btn.disabled = ativo;
    btn.classList.toggle('is-loading', ativo);
    const label = btn.querySelector('span');
    if (label) label.textContent = ativo ? 'Atualizando…' : 'Atualizar';
  }

  function atualizarUltimaAtualizacao() {
    if (!$('ultimaAtualizacao')) return;
    $('ultimaAtualizacao').textContent = new Intl.DateTimeFormat('pt-BR', {
      timeZone: CONFIG.timezone, day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false,
    }).format(new Date());
  }

  function normalizarObjetoVendas(valor) {
    if (!valor) return {};
    if (typeof valor === 'object' && !Array.isArray(valor)) return Object.fromEntries(Object.entries(valor).map(([k,v]) => [k, numero(v)]));
    try { return normalizarObjetoVendas(JSON.parse(valor)); } catch { return {}; }
  }
  function classeSaldo(valor) { return valor < 0 ? 'danger' : valor === 0 ? 'zero' : 'ok'; }
  function calcularStatusSaldo(valor) { return valor < 0 ? 'SALDO_NEGATIVO' : valor === 0 ? 'ESGOTADO' : 'COM_SALDO'; }
  function abreviarNome(nome) {
    if (CONFIG.canaisFinais.includes(nome)) return nome;
    const partes = String(nome).trim().split(/\s+/).filter(Boolean);
    if (partes.length <= 2) return partes.join(' ');
    return `${partes[0]} ${partes.at(-1)}`;
  }
  function corModalidade(modalidade) { return CORES_MODALIDADES[String(modalidade || '').toUpperCase()] || '#6fa5d2'; }
  function dataHojeSaoPaulo() {
    const partes = new Intl.DateTimeFormat('en-US', { timeZone:CONFIG.timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
    const mapa = Object.fromEntries(partes.map((p) => [p.type,p.value]));
    return `${mapa.year}-${mapa.month}-${mapa.day}`;
  }
  function parseDataLocal(valor) { const [a,m,d] = String(valor).split('-').map(Number); return new Date(a,(m||1)-1,d||1,12,0,0,0); }
  function formatarDataISO(data) { return `${data.getFullYear()}-${String(data.getMonth()+1).padStart(2,'0')}-${String(data.getDate()).padStart(2,'0')}`; }
  function formatarDataBR(valor) { if (!valor) return '—'; const [a,m,d] = String(valor).slice(0,10).split('-'); return a&&m&&d ? `${d}/${m}/${a}` : String(valor); }
  function formatarMoeda(valor) { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2}).format(numero(valor)); }
  function formatarInteiro(valor) { return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(numero(valor)); }
  function numero(valor) { const n = Number(valor); return Number.isFinite(n) ? n : 0; }
  function normalizarTexto(valor) { return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  function escapeHtml(valor) { return String(valor ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
  function normalizarMensagemErro(erro) {
    const m = erro?.message || erro?.error_description || String(erro || 'Erro desconhecido.');
    if (m.includes('permission denied')) return 'Seu usuário não possui permissão para consultar esta fonte.';
    if (m.includes('does not exist')) return 'A view de Controle de Cotas não está disponível no banco.';
    return m;
  }
  function toast(titulo,mensagem,tipo='info') {
    const stack = $('toastStack'); if (!stack) return;
    const el = document.createElement('div'); el.className = `gc-toast gc-toast--${tipo}`;
    el.innerHTML = `<i class="gc-toast__dot"></i><div><strong>${escapeHtml(titulo)}</strong><span>${escapeHtml(mensagem)}</span></div>`;
    stack.appendChild(el); window.setTimeout(() => el.remove(), 3400);
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
