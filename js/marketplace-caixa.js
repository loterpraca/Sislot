(function () {
  'use strict';

  const CONFIG = window.SISLOT_CONFIG || {};
  if (!window.supabase || !CONFIG.url || !CONFIG.anonKey) {
    document.addEventListener('DOMContentLoaded', () => mostrarAviso('Configuração do Supabase não encontrada. Confira se o arquivo sislot-config.js está carregando window.SISLOT_CONFIG.'));
    return;
  }

  const sb = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);

  const state = {
    boloes: [],
    coletas: [],
    movimentos: []
  };

  const $ = (id) => document.getElementById(id);
  const int = (v) => Number(v || 0);

  function fmtInt(v) {
    return int(v).toLocaleString('pt-BR');
  }

  function fmtBRL(v) {
    if (v === null || v === undefined || v === '') return '—';
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtDataHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  function fmtHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function normalizarModalidade(mod) {
    return String(mod || '—').replaceAll('_', ' ');
  }

  function descricaoBolao(b) {
    const mod = String(b.modalidade || '').toUpperCase();
    if (mod === 'MAIS_MILIONARIA') {
      const trevos = b.qtd_trevos ? ` e ${b.qtd_trevos} trevos` : '';
      return `${fmtInt(b.qtd_apostas)} jogo(s) de ${fmtInt(b.qtd_numeros)} números${trevos}`;
    }
    if (mod === 'LOTECA') {
      const simples = int(b.qtd_simples_loteca);
      const duplos = int(b.qtd_duplos_loteca);
      const triplos = int(b.qtd_triplos_loteca);
      const partes = [];
      if (simples) partes.push(`${simples} simples`);
      if (duplos) partes.push(`${duplos} duplos`);
      if (triplos) partes.push(`${triplos} triplos`);
      return partes.length ? `Loteca com ${partes.join(', ')}` : `${fmtInt(b.qtd_apostas)} jogo(s) Loteca`;
    }
    return `${fmtInt(b.qtd_apostas)} jogo(s) de ${fmtInt(b.qtd_numeros)} dezenas`;
  }

  function descricaoMovimento(m) {
    const mod = String(m.modalidade || '').toUpperCase();
    if (mod === 'MAIS_MILIONARIA') {
      const trevos = m.qtd_trevos ? ` + ${m.qtd_trevos} trevos` : '';
      return `${fmtInt(m.qtd_apostas)}x ${fmtInt(m.qtd_numeros)} números${trevos}`;
    }
    if (mod === 'LOTECA') return `${fmtInt(m.qtd_apostas)} jogo(s) · Loteca ${fmtInt(m.qtd_numeros)} prognósticos`;
    return `${fmtInt(m.qtd_apostas)}x ${fmtInt(m.qtd_numeros)} dezenas`;
  }



  function paginaOrigemBolao(b) {
    const payload = b?.payload_caixa || {};
    const candidatos = [
      b?.pagina_origem,
      b?.paginaOrigem,
      payload?.paginaOrigem,
      payload?.pagina_origem,
      payload?.pagina,
      payload?.paginaAtual
    ];
    for (const v of candidatos) {
      if (v === null || v === undefined || v === '') continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return String(n);
      return String(v);
    }
    return '—';
  }

  function calcular(b) {
    const total = int(b.qtd_cota_total);
    const digital = int(b.qtd_cota_digital);
    const disp = int(b.qtd_cota_disponivel);
    const indisponivel = Math.max(digital - disp, 0);
    const foraDigital = Math.max(total - digital, 0);
    const percDisp = digital > 0 ? (disp / digital) * 100 : 0;
    return { total, digital, disp, indisponivel, foraDigital, percDisp };
  }

  function mostrarAviso(msg) {
    const aviso = $('mpAviso');
    if (!aviso) return;
    aviso.textContent = msg;
    aviso.hidden = !msg;
  }

  async function validarSessaoMarketplace() {
    const { data: { session }, error } = await sb.auth.getSession();

    if (error) throw new Error(error.message || 'Erro ao verificar sessão do SISLOT.');

    if (!session?.user?.id) {
      mostrarAviso('Sessão do SISLOT não encontrada. Redirecionando para login...');
      setTimeout(() => { location.href = './login.html'; }, 700);
      throw new Error('Sessão do SISLOT não encontrada.');
    }

    if (window.SISLOT_SECURITY?.validarUsuarioLogavel) {
      await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
    }

    console.info('[Marketplace CAIXA] sessão autenticada', { userId: session.user.id });
    return session;
  }

  async function buscarBoloes() {
    const { data, error } = await sb
      .from('marketplace_caixa_boloes')
      .select('codigo_bolao_caixa,codigo_loterica,nome_loteria,modalidade,concurso,qtd_apostas,qtd_numeros,qtd_trevos,qtd_simples_loteca,qtd_duplos_loteca,qtd_triplos_loteca,qtd_cota_total,qtd_cota_digital,qtd_cota_disponivel,valor_cota,valor_cota_sem_tarifa,tarifa_servico,valor_ultima_cota,tarifa_ultima_cota,contem_residuo,premio_estimado,dt_sorteio,hora_sorteio,status_marketplace,ultima_coleta_em,payload_caixa')
      .eq('status_marketplace', 'ATIVO')
      .order('codigo_loterica', { ascending: true })
      .order('modalidade', { ascending: true })
      .order('concurso', { ascending: true })
      .limit(2000);

    if (error) throw error;
    return data || [];
  }

  async function buscarColetas() {
    const { data, error } = await sb
      .from('marketplace_caixa_coletas')
      .select('id,origem,status,iniciado_em,finalizado_em,paginas_esperadas,paginas_capturadas,registros_informados,registros_capturados,registros_unicos,versao_caixa,versao_extensao,mensagem_erro,escopo')
      .order('iniciado_em', { ascending: false })
      .limit(24);

    if (error) throw error;
    return data || [];
  }

  async function buscarMovimentos() {
    const { data, error } = await sb
      .from('vw_marketplace_caixa_movimentos_bolao')
      .select('hora_brasilia,codigo_loterica,nome_loteria,codigo_bolao_caixa,modalidade,concurso,qtd_apostas,qtd_numeros,qtd_trevos,qtd_cota_total,qtd_cota_digital,valor_cota,coleta_anterior,coletado_em,minutos_desde_anterior,disponivel_anterior,disponivel_atual,delta_disponivel,cotas_que_sairam,cotas_que_entraram,classificacao_movimento,valor_saida_estimado,valor_entrada_estimado,valor_liquido_saida_estimado')
      .neq('delta_disponivel', 0)
      .order('coletado_em', { ascending: false })
      .limit(2000);

    if (error) {
      console.warn('[Marketplace CAIXA] view de movimentos indisponível', error);
      mostrarAviso('A view vw_marketplace_caixa_movimentos_bolao ainda não está disponível ou sem permissão. Rode o SQL 05_views_movimentacao_disponibilidade.sql para habilitar a aba de evolução por bolão.');
      return [];
    }
    return data || [];
  }

  function montarFiltros() {
    const lojas = new Map();
    const modalidades = new Set();

    for (const b of state.boloes) {
      lojas.set(String(b.codigo_loterica), `${b.codigo_loterica} — ${b.nome_loteria || ''}`.trim());
      if (b.modalidade) modalidades.add(b.modalidade);
    }

    preencherSelect($('filtroLoja'), [...lojas.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')));
    preencherSelect($('filtroModalidade'), [...modalidades].sort().map(m => [m, normalizarModalidade(m)]));
    preencherSelect($('movFiltroLoja'), [...lojas.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')));
    preencherSelect($('movFiltroModalidade'), [...modalidades].sort().map(m => [m, normalizarModalidade(m)]));
  }

  function preencherSelect(select, entries) {
    if (!select) return;
    const atual = select.value;
    const primeira = select.querySelector('option')?.outerHTML || '<option value="">Todas</option>';
    select.innerHTML = primeira + entries.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
    select.value = atual;
  }

  function aplicarFiltros() {
    const loja = $('filtroLoja')?.value || '';
    const modalidade = $('filtroModalidade')?.value || '';
    const concurso = $('filtroConcurso')?.value || '';
    const disponibilidade = $('filtroDisponibilidade')?.value || '';

    return state.boloes.filter(b => {
      if (loja && String(b.codigo_loterica) !== loja) return false;
      if (modalidade && String(b.modalidade) !== modalidade) return false;
      if (concurso && String(b.concurso) !== concurso) return false;

      const c = calcular(b);
      if (disponibilidade === 'disponivel' && c.disp <= 0) return false;
      if (disponibilidade === 'esgotado' && c.disp > 0) return false;
      if (disponibilidade === 'baixo' && !(c.digital > 0 && c.disp > 0 && c.percDisp <= 20)) return false;

      return true;
    });
  }

  function aplicarFiltrosMovimentos() {
    const loja = $('movFiltroLoja')?.value || '';
    const modalidade = $('movFiltroModalidade')?.value || '';
    const concurso = $('movFiltroConcurso')?.value || '';
    const periodoHoras = Number($('movFiltroPeriodo')?.value || 24);
    const tipo = $('movFiltroTipo')?.value || '';
    const limite = Date.now() - periodoHoras * 60 * 60 * 1000;

    return state.movimentos.filter(m => {
      if (loja && String(m.codigo_loterica) !== loja) return false;
      if (modalidade && String(m.modalidade) !== modalidade) return false;
      if (concurso && String(m.concurso) !== concurso) return false;
      const t = new Date(m.coletado_em || m.hora_brasilia).getTime();
      if (!Number.isNaN(t) && t < limite) return false;
      const delta = Number(m.delta_disponivel || 0);
      const saldo = -delta;
      if (tipo === 'saida' && delta >= 0) return false;
      if (tipo === 'entrada' && delta <= 0) return false;
      if (tipo === 'saldo_pos' && saldo <= 0) return false;
      if (tipo === 'saldo_neg' && saldo >= 0) return false;
      return true;
    });
  }

  function renderResumo() {
    const lojas = new Set();
    let disp = 0;
    let indisponivel = 0;
    let ultima = null;

    for (const b of state.boloes) {
      lojas.add(String(b.codigo_loterica));
      const c = calcular(b);
      disp += c.disp;
      indisponivel += c.indisponivel;
      if (b.ultima_coleta_em && (!ultima || new Date(b.ultima_coleta_em) > new Date(ultima))) ultima = b.ultima_coleta_em;
    }

    const movimentos24 = movimentosPorHoras(24);
    const saidas = movimentos24.reduce((acc, m) => acc + int(m.cotas_que_sairam), 0);
    const entradas = movimentos24.reduce((acc, m) => acc + int(m.cotas_que_entraram), 0);
    const saldo = saidas - entradas;

    setText('statBoloes', fmtInt(state.boloes.length));
    setText('statLojas', fmtInt(lojas.size));
    setText('statDisponiveis', fmtInt(disp));
    setText('statIndisponiveis', fmtInt(indisponivel));
    setText('statUltimaColeta', fmtDataHora(ultima));
    setText('statSaidas24h', fmtInt(saidas));
    setText('statEntradas24h', fmtInt(entradas));
    setText('statSaldo24h', `${saldo >= 0 ? '+' : ''}${fmtInt(saldo)}`);

    const liveTitulo = ultima ? 'Coletas ativas no SISLOT' : 'Aguardando primeira coleta';
    const liveSub = ultima ? `Última atualização: ${fmtDataHora(ultima)}` : 'Inicie o coletor Playwright para popular o marketplace.';
    setText('liveStatusTitulo', liveTitulo);
    setText('liveStatusSub', liveSub);
  }

  function movimentosPorHoras(horas) {
    const limite = Date.now() - horas * 60 * 60 * 1000;
    return state.movimentos.filter(m => {
      const t = new Date(m.coletado_em || m.hora_brasilia).getTime();
      return Number.isNaN(t) ? true : t >= limite;
    });
  }

  function renderColetas() {
    renderColetasNo('listaColetas', 6, 'statusColetor');
    renderColetasNo('listaColetasCompleta', 24, 'statusColetorColetas');
  }

  function renderColetasNo(id, limite, statusId) {
    const wrap = $(id);
    if (!wrap) return;

    const status = $(statusId);
    if (!state.coletas.length) {
      wrap.innerHTML = '<div class="mp-empty">Nenhuma coleta registrada ainda.</div>';
      if (status) {
        status.textContent = 'Sem coletas';
        status.className = 'mp-pill warn';
      }
      return;
    }

    const ultima = state.coletas[0];
    const ok = ultima.status === 'CONCLUIDA';
    if (status) {
      status.textContent = ok ? 'Última concluída' : `Última: ${ultima.status || '—'}`;
      status.className = `mp-pill ${ok ? 'ok' : 'warn'}`;
    }

    wrap.innerHTML = state.coletas.slice(0, limite).map(c => {
      const escopo = c.escopo || {};
      const loja = escopo.codigoLoterica ? `Lotérica ${escopo.codigoLoterica}` : (escopo.tipo || 'Escopo não informado');
      const cls = c.status === 'CONCLUIDA' ? 'ok' : (c.status === 'ERRO' ? 'err' : 'warn');
      return `
        <article class="mp-coleta-item">
          <strong>${escapeHtml(loja)} <span class="mp-pill ${cls}">${escapeHtml(c.status || '—')}</span></strong>
          <span>Páginas: ${fmtInt(c.paginas_capturadas)} / ${fmtInt(c.paginas_esperadas)}</span>
          <span>Registros: ${fmtInt(c.registros_unicos || c.registros_capturados)} únicos</span>
          <span>CAIXA: ${escapeHtml(c.versao_caixa || '—')} · Coletor: ${escapeHtml(c.versao_extensao || '—')}</span>
          <span>${fmtDataHora(c.finalizado_em || c.iniciado_em)}</span>
          ${c.mensagem_erro ? `<span>Erro: ${escapeHtml(c.mensagem_erro)}</span>` : ''}
        </article>`;
    }).join('');
  }

  function renderTopMovimentos() {
    const wrap = $('topMovimentos');
    if (!wrap) return;

    const top = movimentosPorHoras(24)
      .filter(m => int(m.cotas_que_sairam) || int(m.cotas_que_entraram))
      .sort((a, b) => {
        const va = Math.max(Math.abs(Number(a.valor_liquido_saida_estimado || 0)), Number(a.valor_saida_estimado || 0), Number(a.valor_entrada_estimado || 0));
        const vb = Math.max(Math.abs(Number(b.valor_liquido_saida_estimado || 0)), Number(b.valor_saida_estimado || 0), Number(b.valor_entrada_estimado || 0));
        return vb - va;
      })
      .slice(0, 8);

    if (!top.length) {
      wrap.innerHTML = '<div class="mp-empty">Ainda não há movimentos recentes suficientes. Rode pelo menos duas coletas do mesmo bolão.</div>';
      return;
    }

    wrap.innerHTML = top.map(m => {
      const delta = Number(m.delta_disponivel || 0);
      const saida = int(m.cotas_que_sairam);
      const entrada = int(m.cotas_que_entraram);
      const cls = delta < 0 ? 'saida' : 'entrada';
      const titulo = delta < 0 ? 'Queda de disponíveis' : 'Liberação/retorno';
      const qtd = delta < 0 ? saida : entrada;
      const valor = delta < 0 ? m.valor_saida_estimado : m.valor_entrada_estimado;
      return `
        <article class="mp-mov-card ${cls}">
          <div class="mp-mov-card-head">
            <span class="mp-mov-badge">${escapeHtml(titulo)}</span>
            <strong>${fmtInt(qtd)} cota(s)</strong>
          </div>
          <h3>${escapeHtml(normalizarModalidade(m.modalidade))} · Conc. ${escapeHtml(m.concurso || '—')}</h3>
          <p>${escapeHtml(m.codigo_loterica)} · ${escapeHtml(m.nome_loteria || '—')}</p>
          <div class="mp-mov-flow">
            <span>${fmtInt(m.disponivel_anterior)}</span>
            <i>→</i>
            <span>${fmtInt(m.disponivel_atual)}</span>
          </div>
          <div class="mp-mov-card-foot">
            <span>${escapeHtml(descricaoMovimento(m))}</span>
            <strong>${fmtBRL(valor)}</strong>
          </div>
          <small>${fmtDataHora(m.coletado_em)}</small>
        </article>`;
    }).join('');
  }

  function renderMovimentosTabela() {
    const tbody = $('movimentosTabela');
    const resumo = $('movResumo');
    if (!tbody) return;

    const lista = aplicarFiltrosMovimentos();
    const saidas = lista.reduce((acc, m) => acc + int(m.cotas_que_sairam), 0);
    const entradas = lista.reduce((acc, m) => acc + int(m.cotas_que_entraram), 0);
    const saldo = saidas - entradas;
    if (resumo) resumo.textContent = `${fmtInt(lista.length)} movimento(s) · ${fmtInt(saidas)} queda(s) · ${fmtInt(entradas)} liberação(ões) · saldo ${saldo >= 0 ? '+' : ''}${fmtInt(saldo)}.`;

    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="mp-table-empty">Nenhum movimento encontrado com os filtros selecionados.</td></tr>';
      return;
    }

    tbody.innerHTML = lista.slice(0, 300).map(m => {
      const delta = Number(m.delta_disponivel || 0);
      const cls = delta < 0 ? 'saida' : 'entrada';
      const label = delta < 0 ? 'Queda' : 'Liberação';
      const qtd = delta < 0 ? int(m.cotas_que_sairam) : int(m.cotas_que_entraram);
      const valor = delta < 0 ? Number(m.valor_saida_estimado || 0) : Number(m.valor_entrada_estimado || 0);
      const codigo = m.codigo_bolao_caixa ? String(m.codigo_bolao_caixa).slice(0, 10) + '…' : '—';
      return `
        <tr>
          <td><strong>${fmtHora(m.coletado_em)}</strong><small>${escapeHtml(String(m.minutos_desde_anterior || '—'))} min</small></td>
          <td><strong>${escapeHtml(m.codigo_loterica || '—')}</strong><small>${escapeHtml(m.nome_loteria || '—')}</small></td>
          <td><strong>${escapeHtml(normalizarModalidade(m.modalidade))}</strong><small>Conc. ${escapeHtml(m.concurso || '—')} · ${escapeHtml(codigo)}</small></td>
          <td>${escapeHtml(descricaoMovimento(m))}</td>
          <td><span class="mp-flow-inline">${fmtInt(m.disponivel_anterior)} <i>→</i> ${fmtInt(m.disponivel_atual)}</span></td>
          <td><span class="mp-mov-label ${cls}">${escapeHtml(label)} ${fmtInt(qtd)}</span></td>
          <td><strong>${fmtBRL(valor)}</strong></td>
          <td><small>${escapeHtml(classificacaoAmigavel(m.classificacao_movimento))}</small></td>
        </tr>`;
    }).join('');
  }

  function classificacaoAmigavel(v) {
    const s = String(v || '');
    if (s.includes('QUEDA_GRANDE')) return 'queda forte: venda, reserva, baixa ou retirada';
    if (s.includes('QUEDA')) return 'queda: venda, reserva, baixa ou retirada';
    if (s.includes('RETORNO_RAPIDO')) return 'retorno rápido: reserva expirada ou liberação';
    if (s.includes('ENTRADA')) return 'entrada: liberação manual ou retorno';
    return s.replaceAll('_', ' ').toLowerCase() || '—';
  }

  function renderBoloes() {
    const lista = aplicarFiltros();
    const grid = $('gridBoloes');
    const resumo = $('resultadoResumo');

    if (resumo) resumo.textContent = `${fmtInt(lista.length)} bolão(ões) exibido(s) de ${fmtInt(state.boloes.length)} ativo(s).`;

    if (!grid) return;
    if (!lista.length) {
      grid.innerHTML = '<div class="mp-empty">Nenhum bolão encontrado com os filtros selecionados.</div>';
      return;
    }

    grid.innerHTML = lista.map(b => {
      const c = calcular(b);
      const perc = Math.max(0, Math.min(100, c.percDisp));
      const codigo = b.codigo_bolao_caixa ? String(b.codigo_bolao_caixa).slice(0, 14) + '…' : '—';
      const pagina = paginaOrigemBolao(b);
      return `
        <article class="mp-bolao-card">
          <div class="mp-bolao-top">
            <div>
              <div class="mp-loja">${escapeHtml(b.codigo_loterica)} · ${escapeHtml(b.nome_loteria || '—')}</div>
              <div class="mp-modalidade">${escapeHtml(normalizarModalidade(b.modalidade))}</div>
            </div>
            <div class="mp-top-badges">
              <div class="mp-concurso">Conc. ${escapeHtml(b.concurso || '—')}</div>
              <div class="mp-page-badge" title="Página em que o bolão apareceu na listagem capturada da CAIXA">Pág. ${escapeHtml(pagina)}</div>
            </div>
          </div>

          <div class="mp-desc">${escapeHtml(descricaoBolao(b))}</div>

          <div class="mp-metrics">
            <div class="mp-metric"><span>Total</span><strong>${fmtInt(c.total)}</strong></div>
            <div class="mp-metric"><span>Digital</span><strong>${fmtInt(c.digital)}</strong></div>
            <div class="mp-metric"><span>Disponível</span><strong>${fmtInt(c.disp)}</strong></div>
          </div>

          <div class="mp-progress" title="${perc.toFixed(1)}% disponível no digital"><i style="width:${perc}%"></i></div>
          <div class="mp-foot">
            <div>
              <div>Indisponível digital: ${fmtInt(c.indisponivel)}</div>
              <div>Fora do digital: ${fmtInt(c.foraDigital)}</div>
              <div>Cód. bolão: ${escapeHtml(codigo)}</div>
              <div>Página CAIXA: ${escapeHtml(pagina)}</div>
              <div>Atualizado: ${fmtDataHora(b.ultima_coleta_em)}</div>
            </div>
            <div class="mp-price">${fmtBRL(b.valor_cota)}</div>
          </div>
        </article>`;
    }).join('');
  }

  async function carregarTudo() {
    try {
      mostrarAviso('');
      if ($('btnAtualizar')) {
        $('btnAtualizar').disabled = true;
        $('btnAtualizar').textContent = 'Atualizando...';
      }
      const [boloes, coletas, movimentos] = await Promise.all([buscarBoloes(), buscarColetas(), buscarMovimentos()]);
      state.boloes = boloes;
      state.coletas = coletas;
      state.movimentos = movimentos;
      console.info('[Marketplace CAIXA] dados carregados', { boloes: boloes.length, coletas: coletas.length, movimentos: movimentos.length, atualizadoEm: new Date().toISOString() });
      montarFiltros();
      renderResumo();
      renderColetas();
      renderTopMovimentos();
      renderMovimentosTabela();
      renderBoloes();
    } catch (err) {
      console.error(err);
      mostrarAviso(err?.message || 'Erro ao carregar dados do marketplace.');
    } finally {
      if ($('btnAtualizar')) {
        $('btnAtualizar').disabled = false;
        $('btnAtualizar').textContent = 'Atualizar dados';
      }
    }
  }

  function abrirComandoColetor() {
    const lojas = [...new Set(state.boloes.map(b => String(b.codigo_loterica)).filter(Boolean))].sort((a,b) => Number(a)-Number(b));
    const env = [
      `CODIGOS_LOTERICAS=${lojas.join(',') || '518'}`,
      'HEADLESS=false',
      'INTERVALO_SEGUNDOS=300',
      '',
      '# Depois execute no computador do coletor:',
      'iniciar-coletor.bat'
    ].join('\n');
    $('comandoColetor').textContent = env;
    $('modalComando').showModal();
  }

  async function copiarEnv() {
    const txt = $('comandoColetor').textContent || '';
    await navigator.clipboard.writeText(txt);
    $('btnCopiarEnv').textContent = 'Copiado!';
    setTimeout(() => $('btnCopiarEnv').textContent = 'Copiar configuração', 1500);
  }

  function exportarCsv() {
    const lista = aplicarFiltros();
    const cols = ['codigo_loterica','nome_loteria','codigo_bolao_caixa','pagina_caixa','modalidade','concurso','qtd_apostas','qtd_numeros','qtd_trevos','qtd_cota_total','qtd_cota_digital','qtd_cota_disponivel','qtd_cota_indisponivel','valor_cota','premio_estimado','ultima_coleta_em'];
    const linhas = [cols.join(';')];
    for (const b of lista) {
      const c = calcular(b);
      const row = cols.map(col => {
        if (col === 'qtd_cota_indisponivel') return csvCell(c.indisponivel);
        if (col === 'pagina_caixa') return csvCell(paginaOrigemBolao(b));
        return csvCell(b[col]);
      });
      linhas.push(row.join(';'));
    }
    baixarCsv(`marketplace-caixa-boloes-${new Date().toISOString().slice(0,10)}.csv`, linhas);
  }

  function exportarMovCsv() {
    const lista = aplicarFiltrosMovimentos();
    const cols = ['hora_brasilia','codigo_loterica','nome_loteria','codigo_bolao_caixa','modalidade','concurso','qtd_apostas','qtd_numeros','valor_cota','disponivel_anterior','disponivel_atual','delta_disponivel','cotas_que_sairam','cotas_que_entraram','classificacao_movimento','valor_saida_estimado','valor_entrada_estimado','coletado_em'];
    const linhas = [cols.join(';')];
    for (const m of lista) linhas.push(cols.map(col => csvCell(m[col])).join(';'));
    baixarCsv(`marketplace-caixa-movimentos-${new Date().toISOString().slice(0,10)}.csv`, linhas);
  }

  function baixarCsv(nome, linhas) {
    const blob = new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(v) {
    const s = String(v ?? '').replaceAll('"', '""');
    return `"${s}"`;
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function ativarTabs() {
    document.querySelectorAll('.mp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.mp-tab').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.mp-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
      });
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await validarSessaoMarketplace();
      ativarTabs();

      $('btnAtualizar')?.addEventListener('click', carregarTudo);
      $('btnComandoColetor')?.addEventListener('click', abrirComandoColetor);
      $('btnCopiarEnv')?.addEventListener('click', copiarEnv);
      $('btnExportarCsv')?.addEventListener('click', exportarCsv);
      $('btnExportarMovCsv')?.addEventListener('click', exportarMovCsv);

      ['filtroLoja', 'filtroModalidade', 'filtroConcurso', 'filtroDisponibilidade'].forEach(id => {
        $(id)?.addEventListener('input', renderBoloes);
        $(id)?.addEventListener('change', renderBoloes);
      });

      ['movFiltroLoja', 'movFiltroModalidade', 'movFiltroConcurso', 'movFiltroPeriodo', 'movFiltroTipo'].forEach(id => {
        $(id)?.addEventListener('input', renderMovimentosTabela);
        $(id)?.addEventListener('change', renderMovimentosTabela);
      });

      await carregarTudo();
      setInterval(carregarTudo, 60000);
    } catch (err) {
      console.error('[Marketplace CAIXA] erro ao iniciar tela', err);
      mostrarAviso(err?.message || 'Erro ao iniciar a tela Marketplace CAIXA.');
    }
  });
})();
