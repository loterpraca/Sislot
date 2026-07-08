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
    filtrosMontados: false
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
      .limit(12);

    if (error) throw error;
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

    $('statBoloes').textContent = fmtInt(state.boloes.length);
    $('statLojas').textContent = fmtInt(lojas.size);
    $('statDisponiveis').textContent = fmtInt(disp);
    $('statIndisponiveis').textContent = fmtInt(indisponivel);
    $('statUltimaColeta').textContent = fmtDataHora(ultima);
  }

  function renderColetas() {
    const wrap = $('listaColetas');
    if (!wrap) return;

    if (!state.coletas.length) {
      wrap.innerHTML = '<div class="mp-empty">Nenhuma coleta registrada ainda.</div>';
      $('statusColetor').textContent = 'Sem coletas';
      $('statusColetor').className = 'mp-pill warn';
      return;
    }

    const ultima = state.coletas[0];
    const ok = ultima.status === 'CONCLUIDA';
    $('statusColetor').textContent = ok ? 'Última concluída' : `Última: ${ultima.status || '—'}`;
    $('statusColetor').className = `mp-pill ${ok ? 'ok' : 'warn'}`;

    wrap.innerHTML = state.coletas.slice(0, 6).map(c => {
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
      return `
        <article class="mp-bolao-card">
          <div class="mp-bolao-top">
            <div>
              <div class="mp-loja">${escapeHtml(b.codigo_loterica)} · ${escapeHtml(b.nome_loteria || '—')}</div>
              <div class="mp-modalidade">${escapeHtml(normalizarModalidade(b.modalidade))}</div>
            </div>
            <div class="mp-concurso">Conc. ${escapeHtml(b.concurso || '—')}</div>
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
      $('btnAtualizar').disabled = true;
      $('btnAtualizar').textContent = 'Atualizando...';
      const [boloes, coletas] = await Promise.all([buscarBoloes(), buscarColetas()]);
      state.boloes = boloes;
      state.coletas = coletas;
      console.info('[Marketplace CAIXA] dados carregados', { boloes: boloes.length, coletas: coletas.length, atualizadoEm: new Date().toISOString() });
      montarFiltros();
      renderResumo();
      renderColetas();
      renderBoloes();
    } catch (err) {
      console.error(err);
      mostrarAviso(err?.message || 'Erro ao carregar dados do marketplace.');
    } finally {
      $('btnAtualizar').disabled = false;
      $('btnAtualizar').textContent = 'Atualizar dados';
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
    const cols = ['codigo_loterica','nome_loteria','codigo_bolao_caixa','modalidade','concurso','qtd_apostas','qtd_numeros','qtd_trevos','qtd_cota_total','qtd_cota_digital','qtd_cota_disponivel','qtd_cota_indisponivel','valor_cota','premio_estimado','ultima_coleta_em'];
    const linhas = [cols.join(';')];
    for (const b of lista) {
      const c = calcular(b);
      const row = cols.map(col => {
        const v = col === 'qtd_cota_indisponivel' ? c.indisponivel : b[col];
        return csvCell(v);
      });
      linhas.push(row.join(';'));
    }
    const blob = new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marketplace-caixa-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(v) {
    const s = String(v ?? '').replaceAll('"', '""');
    return `"${s}"`;
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btnAtualizar')?.addEventListener('click', carregarTudo);
    $('btnComandoColetor')?.addEventListener('click', abrirComandoColetor);
    $('btnCopiarEnv')?.addEventListener('click', copiarEnv);
    $('btnExportarCsv')?.addEventListener('click', exportarCsv);

    ['filtroLoja', 'filtroModalidade', 'filtroConcurso', 'filtroDisponibilidade'].forEach(id => {
      $(id)?.addEventListener('input', renderBoloes);
      $(id)?.addEventListener('change', renderBoloes);
    });

    carregarTudo();
    setInterval(carregarTudo, 60000);
  });
})();
