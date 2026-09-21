(function () {
  'use strict';

  const CONFIG = window.SISLOT_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const fmtMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const fmtDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const MODALIDADE_CORES = {
    MEGA_SENA: '#15b981', MEGASENA: '#15b981', LOTOFACIL: '#b06ad8', QUINA: '#7777db',
    DUPLA_SENA: '#d95b76', DUPLASENA: '#d95b76', TIMEMANIA: '#36b3a8', DIA_DE_SORTE: '#d8a53c',
    SUPER_7: '#e88950', MAIS_MILIONARIA: '#70b7ef', LOTOMANIA: '#ef8a3f'
  };

  const state = { contexto: null, rows: [], filtered: [], lojaId: '', dataReferencia: '', loading: false };
  let sb = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindUI();
    iniciarRelogio();
    state.dataReferencia = hojeSaoPaulo();
    if ($('dataReferencia')) $('dataReferencia').value = state.dataReferencia;

    if (!window.supabase || !CONFIG.url || !CONFIG.anonKey || !window.SISLOT_SECURITY) {
      mostrarErro('Configuração do SISLOT não encontrada.');
      return;
    }

    sb = window.SISLOT_SB || window.supabase.createClient(CONFIG.url, CONFIG.anonKey);

    try {
      state.contexto = await window.SISLOT_SECURITY.protegerPagina('afericao-tfl');
      if (!state.contexto) return;
      montarLojas();
      await carregar();
    } catch (error) {
      console.error('[Aferição TFL] erro inicial', error);
      mostrarErro(normalizarErro(error));
    }
  }

  function bindUI() {
    $('btnLogout')?.addEventListener('click', () => window.SISLOT_SECURITY?.sair?.());
    $('filtroLoja')?.addEventListener('change', () => { state.lojaId = $('filtroLoja').value; aplicarFiltros(); });
    $('dataReferencia')?.addEventListener('change', () => {
      state.dataReferencia = $('dataReferencia').value || hojeSaoPaulo();
      $('dataReferencia').value = state.dataReferencia;
      carregar();
    });
    document.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-salvar-tfl]');
      if (btn) salvarCard(btn.dataset.salvarTfl, btn);
    });
    document.addEventListener('focusin', (event) => {
      const input = event.target.closest?.('.tfl-input');
      if (input) requestAnimationFrame(() => input.select());
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const input = event.target.closest('.tfl-input');
      if (!input) return;
      const card = input.closest('[data-bolao-id]');
      const btn = card?.querySelector('[data-salvar-tfl]');
      if (btn) { event.preventDefault(); btn.click(); }
    });
  }

  function montarLojas() {
    const select = $('filtroLoja');
    const lojas = state.contexto?.lojasPermitidas || [];
    if (!select) return;
    select.innerHTML = '';

    if (lojas.length > 1) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Todas as minhas lojas';
      select.appendChild(opt);
    }

    lojas.forEach((loja) => {
      const opt = document.createElement('option');
      opt.value = String(loja.loteria_id);
      opt.textContent = loja.loteria_nome;
      select.appendChild(opt);
    });

    const inicial = state.contexto?.lojaInicial?.loteria_id;
    state.lojaId = lojas.length === 1 ? String(lojas[0].loteria_id) : (inicial ? String(inicial) : '');
    select.value = state.lojaId;
    select.disabled = lojas.length <= 1;
    atualizarHeaderLoja();
  }

  async function carregar(silencioso = false) {
    if (state.loading || !sb) return;
    state.loading = true;
    if (!silencioso) mostrarEstado('carregando');
    ocultarErro();

    try {
      const { data, error } = await sb.rpc('rpc_marketplace_tfl_listar_boloes_data', {
        p_data_referencia: state.dataReferencia || hojeSaoPaulo()
      });
      if (error) throw error;
      state.rows = (data || []).map(normalizarRow);
      aplicarFiltros();
    } catch (error) {
      console.error('[Aferição TFL] falha ao listar', error);
      mostrarErro(normalizarErro(error));
      mostrarEstado('vazio');
    } finally {
      state.loading = false;
    }
  }

  function normalizarRow(row) {
    return {
      ...row,
      marketplace_bolao_id: Number(row.marketplace_bolao_id),
      loteria_id: Number(row.loteria_id),
      qtd_apostas: numeroOuNull(row.qtd_apostas),
      qtd_numeros: numeroOuNull(row.qtd_numeros),
      qtd_cota_total: numeroOuNull(row.qtd_cota_total),
      qtd_cota_digital: numeroOuNull(row.qtd_cota_digital),
      qtd_cota_disponivel: numeroOuNull(row.qtd_cota_disponivel),
      fisicas_origem: numeroOuNull(row.fisicas_origem),
      valor_cota: numeroOuNull(row.valor_cota),
      qtd_vendidas_oficial: numeroOuNull(row.qtd_vendidas_oficial),
      qtd_baixadas_oficial: numeroOuNull(row.qtd_baixadas_oficial),
      qtd_impressas_oficial: numeroOuNull(row.qtd_impressas_oficial)
    };
  }

  function aplicarFiltros() {
    state.filtered = state.rows.filter((row) => {
      if (state.lojaId && String(row.loteria_id) !== String(state.lojaId)) return false;
      return true;
    });

    state.filtered.sort((a, b) => {
      const mod = String(a.modalidade || '').localeCompare(String(b.modalidade || ''), 'pt-BR');
      if (mod) return mod;
      const va = Number.isFinite(a.valor_cota) ? a.valor_cota : Number.MAX_SAFE_INTEGER;
      const vb = Number.isFinite(b.valor_cota) ? b.valor_cota : Number.MAX_SAFE_INTEGER;
      return va - vb || String(a.concurso || '').localeCompare(String(b.concurso || ''), 'pt-BR');
    });

    render();
    atualizarHeaderLoja();
  }

  function render() {
    const grid = $('cardsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!state.filtered.length) {
      atualizarResumo();
      mostrarEstado('vazio');
      return;
    }

    const grupos = new Map();
    state.filtered.forEach((row) => {
      const chave = row.modalidade || 'Outros';
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(row);
    });

    for (const [modalidade, itens] of grupos.entries()) {
      const cor = corModalidade(modalidade);
      const section = document.createElement('section');
      section.className = 'tfl-card-group';
      section.style.setProperty('--mod', cor);
      section.innerHTML = `
        <div class="tfl-card-group__head">
          <span class="tfl-card-group__dot"></span>
          <span class="tfl-card-group__name">${escapeHtml(rotuloModalidade(modalidade))}</span>
          <span class="tfl-card-group__line"></span>
          <span class="tfl-card-group__count">${fmtInt.format(itens.length)} bolão(ões)</span>
        </div>
        <div class="tfl-card-group__grid">${itens.map(renderCard).join('')}</div>`;
      grid.appendChild(section);
    }

    atualizarResumo();
    mostrarEstado('dados');
  }

  function renderCard(row) {
    const id = row.marketplace_bolao_id;
    const cor = corModalidade(row.modalidade);
    const hasAfericao = !!row.ultima_afericao_id;
    const ultimaData = hasAfericao ? fmtDate.format(new Date(row.ultima_afericao_em)) : '—';
    const quem = hasAfericao ? (row.ultima_afericao_por || 'Usuário SISLOT') : '';
    const statusAbs = String(row.status_marketplace || '').toUpperCase() === 'AUSENTE';

    return `<article class="tfl-card" data-bolao-id="${id}" style="--mod:${cor}">
      <div class="tfl-card__head">
        <div class="tfl-card__title">
          <strong>${escapeHtml(rotuloModalidade(row.modalidade))}</strong>
          <span class="tfl-contest">#${escapeHtml(row.concurso || '—')}</span>
          ${statusAbs ? '<span class="tfl-status is-absent">AUSENTE</span>' : ''}
        </div>
        <div class="tfl-card__price"><strong>${money(row.valor_cota)}</strong><span>/cota</span></div>
      </div>

      <div class="tfl-meta-row">
        ${meta('Total', inteiro(row.qtd_cota_total))}
        ${meta('Digitais', inteiro(row.qtd_cota_digital))}
        ${meta('Disp.', inteiro(row.qtd_cota_disponivel))}
        ${meta('Fís. origem', inteiro(row.fisicas_origem), true)}
      </div>

      <div class="tfl-afericao-line">
        <span class="tfl-section-label">Última aferição</span>
        <span class="tfl-last-info">${hasAfericao ? `${escapeHtml(ultimaData)}${quem ? ` · ${escapeHtml(quem)}` : ''}` : '—'}</span>
      </div>
      <div class="tfl-last-grid">
        <div class="tfl-last-box tfl-last-box--sold"><span>Vendidas</span><strong>${hasAfericao ? inteiro(row.qtd_vendidas_oficial) : '—'}</strong></div>
        <div class="tfl-last-box tfl-last-box--download"><span>Baixadas</span><strong>${hasAfericao ? inteiro(row.qtd_baixadas_oficial) : '—'}</strong></div>
        <div class="tfl-last-box tfl-last-box--print"><span>Impressas</span><strong>${hasAfericao ? inteiro(row.qtd_impressas_oficial) : '—'}</strong></div>
      </div>

      <div class="tfl-entry">
        ${campo(id, 'vendidas', 'Vendidas', row.qtd_vendidas_oficial)}
        ${campo(id, 'baixadas', 'Baixadas', row.qtd_baixadas_oficial)}
        ${campo(id, 'impressas', 'Impressas', row.qtd_impressas_oficial)}
        <button class="tfl-save" type="button" data-salvar-tfl="${id}">Salvar aferição</button>
      </div>
      <div class="tfl-card__foot"><span>${escapeHtml(row.loteria_nome || '')}</span><span>Totais atuais do TFL</span></div>
    </article>`;
  }

  function campo(id, nome, label, anterior) {
    const valor = anterior == null ? '' : String(anterior);
    return `<div class="tfl-input-wrap"><label for="tfl-${nome}-${id}">${label}</label><input class="tfl-input" id="tfl-${nome}-${id}" data-field="${nome}" type="number" inputmode="numeric" pattern="[0-9]*" min="0" step="1" value="${escapeHtml(valor)}" placeholder="0" autocomplete="off" /></div>`;
  }

  async function salvarCard(id, button) {
    const card = document.querySelector(`[data-bolao-id="${CSS.escape(String(id))}"]`);
    const row = state.rows.find((r) => String(r.marketplace_bolao_id) === String(id));
    if (!card || !row || !sb) return;

    const vendidas = lerInteiro(card.querySelector('[data-field="vendidas"]'));
    const baixadas = lerInteiro(card.querySelector('[data-field="baixadas"]'));
    const impressas = lerInteiro(card.querySelector('[data-field="impressas"]'));

    if ([vendidas, baixadas, impressas].some((v) => v === null)) {
      return toast('Preencha os 3 valores', 'Vendidas, Baixadas e Impressas precisam ser informadas antes de salvar.', 'error');
    }

    const digitais = numeroOuNull(row.qtd_cota_digital);
    const soma = vendidas + baixadas + impressas;
    if (digitais != null && soma > digitais) {
      return toast('Valores incompatíveis', `A soma informada (${soma}) supera as ${digitais} cotas digitais do bolão.`, 'error');
    }

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Salvando...';

    try {
      const { error } = await sb.rpc('rpc_marketplace_tfl_salvar_afericao', {
        p_marketplace_bolao_id: Number(id),
        p_qtd_vendidas: vendidas,
        p_qtd_baixadas: baixadas,
        p_qtd_impressas: impressas
      });
      if (error) throw error;
      toast('Aferição salva', `${rotuloModalidade(row.modalidade)} ${row.concurso}: dados oficiais registrados.`, 'success');
      await carregar(true);
    } catch (error) {
      console.error('[Aferição TFL] falha ao salvar', error);
      toast('Não foi possível salvar', normalizarErro(error), 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function atualizarResumo() {
    const total = state.filtered.length;
    const aferidos = state.filtered.filter((r) => !!r.ultima_afericao_id).length;
    setText('statBoloes', total);
    setText('statComAfericao', aferidos);
    setText('statSemAfericao', total - aferidos);
    setText('statAferidos', aferidos);
    const dataRef = formatarDataReferencia(state.dataReferencia);
    setText('statusResumo', total ? `${total} bolão(ões) · referência ${dataRef}.` : `Nenhum bolão em ${dataRef}.`);
  }

  function atualizarHeaderLoja() {
    const lojas = state.contexto?.lojasPermitidas || [];
    const loja = lojas.find((l) => String(l.loteria_id) === String(state.lojaId));
    setText('headerLoja', loja?.loteria_nome || (state.lojaId ? 'Loja' : 'Minhas lojas'));
    if (loja?.loteria_slug) document.body.dataset.loja = loja.loteria_slug;
    else delete document.body.dataset.loja;
  }

  function mostrarEstado(tipo) {
    const loading = $('estadoCarregando');
    const vazio = $('estadoVazio');
    const grid = $('cardsGrid');
    if (loading) loading.classList.toggle('tfl-state--hidden', tipo !== 'carregando');
    if (vazio) vazio.classList.toggle('tfl-state--hidden', tipo !== 'vazio');
    if (grid) grid.style.display = tipo === 'dados' ? '' : 'none';
  }

  function mostrarErro(msg) { const el = $('tflAviso'); if (el) { el.textContent = msg; el.hidden = false; } }
  function ocultarErro() { const el = $('tflAviso'); if (el) el.hidden = true; }
  function toast(titulo, mensagem, tipo = 'info') {
    const stack = $('toastStack'); if (!stack) return;
    const el = document.createElement('div');
    el.className = `tfl-toast tfl-toast--${tipo}`;
    el.innerHTML = `<i class="tfl-toast__dot"></i><div><strong>${escapeHtml(titulo)}</strong><span>${escapeHtml(mensagem)}</span></div>`;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function iniciarRelogio() {
    const tick = () => setText('relogio', new Date().toLocaleTimeString('pt-BR'));
    tick(); setInterval(tick, 1000);
  }

  function meta(label, value, origin = false) { return `<div class="tfl-meta ${origin ? 'tfl-meta--origin' : ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`; }
  function corModalidade(v) { return MODALIDADE_CORES[String(v || '').toUpperCase()] || '#45b7ff'; }
  function rotuloModalidade(v) { return String(v || 'Outros').replaceAll('_', ' '); }
  function money(v) { return Number.isFinite(Number(v)) ? fmtMoney.format(Number(v)) : '—'; }
  function inteiro(v) { return v == null || !Number.isFinite(Number(v)) ? '—' : fmtInt.format(Number(v)); }
  function numeroOuNull(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
  function lerInteiro(input) { const s = String(input?.value ?? '').trim(); if (!s) return null; const n = Number(s); return Number.isInteger(n) && n >= 0 ? n : null; }
  function setText(id, value) { const el = $(id); if (el) el.textContent = value ?? ''; }
  function hojeSaoPaulo() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const obj = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${obj.year}-${obj.month}-${obj.day}`;
  }
  function formatarDataReferencia(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
  }
  function normalizarTexto(v) { return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function normalizarErro(error) {
    const msg = error?.message || String(error || 'Erro desconhecido.');
    if (/permission denied|sem permissão|acesso/i.test(msg)) return 'Seu usuário não possui permissão para esta loja ou para a Aferição Oficial TFL.';
    return msg;
  }
  function escapeHtml(v) { return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
})();
