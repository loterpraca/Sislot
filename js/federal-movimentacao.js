(() => {
  const {
    sb, $, fmtMoney, fmtDate, startClock, showStatus, fillSelect,
    requireSession, loadLoterias, loadFederais, lookupLoteriaName
  } = FED_BASE;

const state = {
  usuario: null,
  loterias: [],
  federais: [],
  resumoFederal: [],
  movimentacoes: [],
  selectedFederalId: null,
  dataRef: hojeISO(),
  mostrarTodosConcursos: false
};

  function firstEl(...ids) {
    for (const id of ids) {
      const el = $(id);
      if (el) return el;
    }
    return null;
  }

  function hojeISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseISODate(value) {
    if (!value) return null;

    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }

    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function toISODate(value) {
    const d = value instanceof Date ? value : parseISODate(value);
    if (!d) return '';

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(iso, delta) {
    const d = parseISODate(iso) || new Date();
    d.setDate(d.getDate() + delta);
    return toISODate(d);
  }

  function concursoKey(f) {
    return `${f.concurso}__${f.dt_sorteio || ''}`;
  }
function fmtSaldo(v) {
  return String(Number(v || 0));
}
  function nomeLoteriaExibicao(loteriaId) {
    return lookupLoteriaName(state.loterias, loteriaId) || '—';
  }

  
  function getEstoqueInicialFederal(f) {
  return Number(
    f.qtd_fracoes ??
    f.qtd_disponivel ??
    f.qtd_fracoes_disponiveis ??
    f.qtd_disponivel_loja ??
    f.saldo ??
    f.saldo_atual ??
    0
  ) || 0;
}

  function getFederalById(id) {
    if (!id) return null;
    return state.federais.find(f => String(f.id) === String(id)) || null;
  }

  function getFederalSelecionado() {
    const key = $('mov-federal')?.value;
    const origem = $('mov-loteria-origem')?.value;

    if (!key || !origem) return null;

    return state.federais.find(f =>
      concursoKey(f) === key &&
      String(f.loteria_id) === String(origem)
    ) || null;
  }
 
  function getConcursosUnicos(disponiveisOnly = false) {
    const base = disponiveisOnly ? federaisDisponiveis() : state.federais;
    const map = new Map();

    for (const f of base) {
      const key = concursoKey(f);
      if (!map.has(key)) {
        map.set(key, {
          key,
          concurso: f.concurso,
          dt_sorteio: f.dt_sorteio,
          label: `${f.concurso}${f.dt_sorteio ? ' • ' + fmtDate(f.dt_sorteio) : ''}`
        });
      }
    }

    return [...map.values()];
  }

  function getFederaisDoConcurso(key, disponiveisOnly = false) {
    if (!key) return [];
    const base = disponiveisOnly ? federaisDisponiveis() : state.federais;
    return base.filter(f => concursoKey(f) === key);
  }

  function updateDateUI() {
    const dateText = firstEl('date-display-text', 'dateDisplayText');
    const datePicker = firstEl('date-picker', 'calendarPicker');
    const chkTodos = firstEl('chk-mostrar-todos-concursos', 'chkMostrarTodosConcursos');

    if (dateText) {
      dateText.textContent = fmtDate(state.dataRef);
    }

    if (datePicker) {
      datePicker.value = state.dataRef;
    }

    if (chkTodos) {
      chkTodos.checked = !!state.mostrarTodosConcursos;
    }
  }

  function openMovCard() {
    const card = firstEl('mov-card', 'movCard');
    if (card) card.style.display = 'block';
  }

  function closeMovCard() {
    const card = firstEl('mov-card', 'movCard');
    if (card) card.style.display = 'none';
  }

  function hideDeleteButton() {
    const btn = $('btn-excluir-mov');
    if (btn) btn.style.display = 'none';
  }

  function fillConcursoSelect(selectedKey = '') {
    const concursos = getConcursosUnicos(true);
    fillSelect('mov-federal', concursos, 'Selecione...', 'key', x => x.label);

    if (selectedKey) {
      $('mov-federal').value = selectedKey;
    }
  }

  function fillOrigemSelect(selectedOrigem = '') {
    const key = $('mov-federal')?.value;
    const federais = getFederaisDoConcurso(key, true);

    const lojasOrigem = federais
      .map(f => state.loterias.find(l => String(l.id) === String(f.loteria_id)))
      .filter(Boolean);

    const lojasUnicas = [];
    const seen = new Set();

    for (const l of lojasOrigem) {
      if (seen.has(String(l.id))) continue;
      seen.add(String(l.id));
      lojasUnicas.push(l);
    }

    fillSelect(
      'mov-loteria-origem',
      lojasUnicas,
      key ? 'Selecione...' : 'Selecione o concurso primeiro...',
      'id',
      x => `${x.id} • ${x.nome}`
    );

    if (selectedOrigem) {
      $('mov-loteria-origem').value = String(selectedOrigem);
    }
  }

  function fillDestinoSelect() {
    fillSelect(
      'mov-loteria-destino',
      state.loterias,
      'Selecione...',
      'id',
      x => `${x.id} • ${x.nome}`
    );
  }

  function fillStaticSelects(selectedConcursoKey = '', selectedOrigem = '') {
    fillConcursoSelect(selectedConcursoKey);
    fillOrigemSelect(selectedOrigem);
    fillDestinoSelect();
  }

  function applyDestinoFilter() {
    const origem = $('mov-loteria-origem')?.value;
    const sel = $('mov-loteria-destino');
    if (!sel) return;

    [...sel.options].forEach(opt => {
      if (!opt.value) {
        opt.hidden = false;
        return;
      }
      opt.hidden = !!origem && opt.value === origem;
    });

    if (origem && sel.value === origem) {
      sel.value = '';
    }
  }

  function syncTotal() {
    const qtd = Number($('mov-qtd')?.value || 0);
    const valor = Number($('mov-valor')?.value || 0);
    if ($('mov-total')) {
      $('mov-total').value = qtd && valor ? (qtd * valor).toFixed(2) : '';
    }
  }

  function syncMovValorByTipo() {
    const f = getFederalSelecionado();
    if (!f) return;

    const tipo = $('mov-tipo-evento')?.value;

    if (tipo === 'DEVOLUCAO_CAIXA') {
      $('mov-valor').value = f.valor_custo ?? '';
    } else if (tipo === 'VENDA_CAMBISTA') {
      $('mov-valor').value = '';
    } else {
      $('mov-valor').value = f.valor_fracao ?? '';
    }

    syncTotal();
  }

  function renderResumoSelecao() {
    const resumo = $('mov-resumo-selec');
    if (!resumo) return;

    const key = $('mov-federal')?.value;
    const origem = $('mov-loteria-origem')?.value;
    const federaisConcurso = getFederaisDoConcurso(key, true);
    const f = getFederalSelecionado();

    if (!key || !federaisConcurso.length) {
      resumo.innerHTML = `
        <div class="empty-title">Selecione concurso e loja origem</div>
        <div class="empty-sub">Resumo rápido da origem escolhida.</div>
      `;
      return;
    }

    const base = federaisConcurso[0];

    if (!origem || !f) {
      resumo.innerHTML = `
        <div class="inline-pills">
          <span class="pill">Modalidade Federal</span>
          <span class="pill">Concurso ${base.concurso}</span>
          <span class="pill">Data ${fmtDate(base.dt_sorteio)}</span>
          <span class="pill">Origens ${federaisConcurso.length}</span>
        </div>
        <div class="empty-sub" style="margin-top:10px">Selecione agora a loja de origem.</div>
      `;
      return;
    }

    resumo.innerHTML = `
      <div class="inline-pills">
        <span class="pill">Modalidade Federal</span>
        <span class="pill">Origem ${lookupLoteriaName(state.loterias, f.loteria_id)}</span>
        <span class="pill">Concurso ${f.concurso}</span>
        <span class="pill">Data ${fmtDate(f.dt_sorteio)}</span>
        <span class="pill">Fração ${fmtMoney(f.valor_fracao)}</span>
        <span class="pill">Custo ${fmtMoney(f.valor_custo)}</span>
      </div>
    `;
  }
async function loadResumoFederal() {
  const { data, error } = await sb
    .from('view_resumo_federal')
    .select('*')
    .order('dt_sorteio', { ascending: true })
    .order('concurso', { ascending: true });

  if (error) {
    showStatus('st-mov', error.message, 'err');
    state.resumoFederal = [];
    return;
  }

  state.resumoFederal = data || [];
}

async function loadDetalheFederal() {
  const { data, error } = await sb
    .from('view_detalhe_federal')
    .select('*');

  if (error) {
    showStatus('st-mov', error.message, 'err');
    state.detalheFederal = [];
    return;
  }

  state.detalheFederal = data || [];
}
  async function loadMovimentacoesResumo() {
  const { data, error } = await sb
    .from('federal_movimentacoes')
    .select('federal_id,loteria_origem,loteria_destino,qtd_fracoes,tipo_evento,status_acerto')
    .eq('tipo_evento', 'TRANSFERENCIA')
    .not('loteria_destino', 'is', null);

  if (error) {
    showStatus('st-mov', error.message, 'err');
    state.movimentacoes = [];
    return;
  }

  state.movimentacoes = data || [];
}
function buildFederalPosicoes() {
  const estoquePorLoja = new Map();
  const enviadoPorDestino = new Map();

  // base inicial por concurso + loja
  for (const f of state.federais) {
    const key = `${concursoKey(f)}::${String(f.loteria_id)}`;
    estoquePorLoja.set(key, getEstoqueInicialFederal(f));
  }

  // aplica movimentações
  for (const m of state.movimentacoes) {
    if (String(m.status_acerto || '').toUpperCase() === 'CANCELADO') continue;

    const federalOrigem = getFederalById(m.federal_id);
    if (!federalOrigem) continue;

    const qtd = Number(m.qtd_fracoes || 0);
    if (!qtd) continue;

    const concKey = concursoKey(federalOrigem);
    const origemId = String(m.loteria_origem || federalOrigem.loteria_id || '');
    const destinoId = String(m.loteria_destino || '');

    const origemKey = `${concKey}::${origemId}`;
    estoquePorLoja.set(origemKey, Number(estoquePorLoja.get(origemKey) || 0) - qtd);

    if (destinoId) {
      const destinoKey = `${concKey}::${destinoId}`;
      estoquePorLoja.set(destinoKey, Number(estoquePorLoja.get(destinoKey) || 0) + qtd);

      const distKey = `${concKey}::${origemId}`;
      const atual = enviadoPorDestino.get(distKey) || {};
      atual[destinoId] = Number(atual[destinoId] || 0) + qtd;
      enviadoPorDestino.set(distKey, atual);
    }
  }

  return { estoquePorLoja, enviadoPorDestino };
}
  function clearMov() {
    state.selectedFederalId = null;

    if ($('mov-federal')) $('mov-federal').value = '';
    fillOrigemSelect('');

    if ($('mov-modalidade')) $('mov-modalidade').value = 'Federal';
    if ($('mov-loteria-origem')) $('mov-loteria-origem').value = '';
    if ($('mov-loteria-destino')) $('mov-loteria-destino').value = '';
    if ($('mov-dt-concurso')) $('mov-dt-concurso').value = '';
    if ($('mov-tipo-evento')) $('mov-tipo-evento').value = 'TRANSFERENCIA';
    if ($('mov-qtd')) $('mov-qtd').value = '';
    if ($('mov-valor')) $('mov-valor').value = '';
    if ($('mov-total')) $('mov-total').value = '';
    if ($('mov-status-acerto')) $('mov-status-acerto').value = 'PENDENTE';
    if ($('mov-observacao')) $('mov-observacao').value = '';

    hideDeleteButton();
    renderResumoSelecao();
    applyDestinoFilter();
    renderListaFederais();
  }

  function renderListaFederais() {
  const lista = firstEl('federal-lista', 'federalLista');
  const stLoading = firstEl('st-fed-loading', 'stFedLoading');
  const stEmpty = firstEl('st-fed-empty', 'stFedEmpty');
  const count = firstEl('federal-count', 'federalCount');

  if (!lista) return;

  const itens = resumoFederalVisivel();

  if (stLoading) stLoading.style.display = 'none';

  if (count) {
    if (!state.mostrarTodosConcursos) {
      const key = getResumoConcursoAtivoKey();
      const primeiro = itens[0];
      count.textContent = key && primeiro
        ? `${primeiro.concurso} • ${itens.length} loja(s)`
        : '0';
    } else {
      count.textContent = `${itens.length} registro(s)`;
    }
  }

  if (!itens.length) {
    if (stEmpty) stEmpty.style.display = 'block';
    lista.style.display = 'none';
    lista.innerHTML = '';
    return;
  }

  if (stEmpty) stEmpty.style.display = 'none';
  lista.style.display = 'flex';
  lista.className = 'federal-lista';

  lista.innerHTML = itens.map(r => {
    const isSelected = String(state.selectedFederalId || '') === String(r.federal_id);
    const origemNome = r.loja_origem || nomeLoteriaExibicao(r.loteria_id);
    const estoqueAtual = fmtSaldo(r.estoque_atual || 0);

    const destinos = getDistribuicaoDestinosByFederal(r);
    const destinosHtml = destinos.map(d => `
      <div class="fed-saldo-pill" title="${d.loja_destino_nome}">
        <span class="fed-saldo-loja">${d.loja_destino_nome}</span>
        <span class="fed-saldo-val">${fmtSaldo(d.qtd_enviada)}</span>
      </div>
    `).join('');

    return `
      <button
        type="button"
        class="fed-card ${isSelected ? 'is-selected' : ''}"
        data-id="${r.federal_id}"
      >
        <div class="fed-card-main">
          <div class="fed-card-head">
            <span class="fed-modalidade">Federal</span>
            <span class="fed-concurso-chip">${r.concurso || '—'}</span>
            <span class="fed-data-chip">${fmtDate(r.dt_sorteio)}</span>
          </div>

          <div class="fed-card-tags">
            <span class="fed-tag">${origemNome}</span>
            <span class="fed-tag">Fração ${fmtMoney(r.valor_fracao)}</span>
            <span class="fed-tag">Custo ${fmtMoney(r.valor_custo)}</span>
          </div>

          <div class="fed-card-saldos">
            <div class="fed-saldo-pill" title="${origemNome}">
              <span class="fed-saldo-loja">${origemNome}</span>
              <span class="fed-saldo-val">${estoqueAtual}</span>
            </div>
            ${destinosHtml}
          </div>
        </div>

        <div class="fed-card-ind">
          <span class="badge ${isSelected ? 'b-ok' : 'b-info'}">
            ${isSelected ? 'Selecionado' : 'Selecionar'}
          </span>
        </div>
      </button>
    `;
  }).join('');
}

  function selectFederalCard(id, { scroll = true } = {}) {
    const f = getFederalById(id);
    if (!f) return;

    state.selectedFederalId = f.id;

    renderListaFederais();
    openMovCard();

    fillStaticSelects(concursoKey(f), f.loteria_id);

    $('mov-federal').value = concursoKey(f);
    fillOrigemSelect(f.loteria_id);
    $('mov-loteria-origem').value = String(f.loteria_id);

    if ($('mov-modalidade')) $('mov-modalidade').value = 'Federal';
    if ($('mov-loteria-destino')) $('mov-loteria-destino').value = '';
    if ($('mov-dt-concurso')) $('mov-dt-concurso').value = f.dt_sorteio || '';
    if ($('mov-tipo-evento')) $('mov-tipo-evento').value = 'TRANSFERENCIA';
    if ($('mov-qtd')) $('mov-qtd').value = '';
    if ($('mov-status-acerto')) $('mov-status-acerto').value = 'PENDENTE';
    if ($('mov-observacao')) $('mov-observacao').value = '';

    hideDeleteButton();
    syncMovValorByTipo();
    renderResumoSelecao();
    applyDestinoFilter();

    if (scroll) {
      firstEl('mov-card', 'movCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function saveMov() {
    try {
      const federal = getFederalSelecionado();
      const valor = Number($('mov-valor')?.value || 0);
      const qtd = Number($('mov-qtd')?.value || 0);
      const tipoEvento = $('mov-tipo-evento')?.value;

      const payload = {
        federal_id: federal?.id || null,
        loteria_origem: Number($('mov-loteria-origem')?.value || 0) || null,
        loteria_destino: Number($('mov-loteria-destino')?.value || 0) || null,
        tipo: tipoEvento === 'TRANSFERENCIA' ? 'ENVIO' : 'DEVOLUCAO_EXTERNA',
        tipo_evento: tipoEvento,
        qtd_fracoes: qtd,
        valor_fracao: valor,
        valor_fracao_ref: Number(federal?.valor_fracao || 0),
        valor_fracao_real: valor,
        valor_a_acertar: 0,
        status_acerto: 'PENDENTE',
        data_mov: state.dataRef,
        observacao: $('mov-observacao')?.value.trim() || null,
        criado_por: state.usuario?.id || null,
        updated_at: new Date().toISOString()
      };

      if (!payload.federal_id || !payload.tipo_evento || !payload.qtd_fracoes || !payload.loteria_origem) {
        showStatus('st-mov', 'Preencha concurso, loja origem, evento e quantidade.', 'err');
        return;
      }

      if (payload.tipo_evento === 'TRANSFERENCIA' && !payload.loteria_destino) {
        showStatus('st-mov', 'Selecione a loja destino.', 'err');
        return;
      }

      const { error } = await sb
        .from('federal_movimentacoes')
        .insert(payload);

      if (error) throw error;

      showStatus('st-mov', 'Movimentação registrada.', 'ok');

      const keepFederalId = state.selectedFederalId;
      await refresh();

      if (keepFederalId && getFederalById(keepFederalId)) {
        selectFederalCard(keepFederalId, { scroll: false });
      } else {
        clearMov();
        closeMovCard();
      }
    } catch (e) {
      showStatus('st-mov', e.message, 'err');
    }
  }

async function refresh() {
  state.federais = await loadFederais();
  await loadResumoFederal();
  await loadMovimentacoesResumo();

  updateDateUI();
  fillStaticSelects();
  renderListaFederais();

  if (state.selectedFederalId && getFederalById(state.selectedFederalId)) {
    selectFederalCard(state.selectedFederalId, { scroll: false });
  }
}
  function bindDateEvents() {
    const btnPrev = firstEl('btn-dt-prev', 'btnDtPrev');
    const btnNext = firstEl('btn-dt-next', 'btnDtNext');
    const btnHoje = firstEl('btn-dt-hoje', 'btnHoje');
    const btnDate = firstEl('btn-date-display', 'dateDisplay');
    const datePicker = firstEl('date-picker', 'calendarPicker');
    const chkTodos = firstEl('chk-mostrar-todos-concursos', 'chkMostrarTodosConcursos');

    btnPrev?.addEventListener('click', () => {
      state.dataRef = addDays(state.dataRef, -1);
      state.selectedFederalId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    btnNext?.addEventListener('click', () => {
      state.dataRef = addDays(state.dataRef, 1);
      state.selectedFederalId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    btnHoje?.addEventListener('click', () => {
      state.dataRef = hojeISO();
      state.selectedFederalId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    btnDate?.addEventListener('click', () => {
      datePicker?.showPicker?.();
      datePicker?.click();
    });

    datePicker?.addEventListener('change', (e) => {
      state.dataRef = e.target.value || hojeISO();
      state.selectedFederalId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    chkTodos?.addEventListener('change', (e) => {
      state.mostrarTodosConcursos = !!e.target.checked;
      state.selectedFederalId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });
  }

  function bindEvents() {
    bindDateEvents();

    $('mov-federal')?.addEventListener('change', () => {
      state.selectedFederalId = null;
      fillOrigemSelect('');
      if ($('mov-loteria-origem')) $('mov-loteria-origem').value = '';
      if ($('mov-dt-concurso')) $('mov-dt-concurso').value = '';
      if ($('mov-valor')) $('mov-valor').value = '';
      if ($('mov-total')) $('mov-total').value = '';
      renderResumoSelecao();
      renderListaFederais();
      applyDestinoFilter();
    });

    $('mov-loteria-origem')?.addEventListener('change', () => {
      const f = getFederalSelecionado();

      if (!f) {
        renderResumoSelecao();
        renderListaFederais();
        applyDestinoFilter();
        return;
      }

      state.selectedFederalId = f.id;
      if ($('mov-modalidade')) $('mov-modalidade').value = 'Federal';
      if ($('mov-dt-concurso')) $('mov-dt-concurso').value = f.dt_sorteio || '';
      syncMovValorByTipo();
      renderResumoSelecao();
      renderListaFederais();
      applyDestinoFilter();
    });

    $('mov-tipo-evento')?.addEventListener('change', syncMovValorByTipo);

    ['mov-qtd', 'mov-valor'].forEach(id => {
      $(id)?.addEventListener('input', syncTotal);
    });

    $('btn-salvar-mov')?.addEventListener('click', saveMov);
    $('btn-limpar-mov')?.addEventListener('click', clearMov);

    firstEl('federal-lista', 'federalLista')?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-id]');
      if (!card) return;
      selectFederalCard(card.dataset.id);
    });
  }
function resumoFederalDisponivel() {
  return state.resumoFederal
    .filter(r => {
      if (!r.dt_sorteio) return true;
      return String(r.dt_sorteio).slice(0, 10) >= state.dataRef;
    })
    .sort((a, b) => {
      const dtA = String(a.dt_sorteio || '');
      const dtB = String(b.dt_sorteio || '');
      if (dtA !== dtB) return dtA.localeCompare(dtB, 'pt-BR');

      const concA = String(a.concurso || '');
      const concB = String(b.concurso || '');
      if (concA !== concB) {
        return concA.localeCompare(concB, 'pt-BR', { numeric: true });
      }

      return String(a.loja_origem || '').localeCompare(String(b.loja_origem || ''), 'pt-BR');
    });
}

  function getConcursosUnicos(disponiveisOnly = false) {
  const base = disponiveisOnly ? federaisDisponiveis() : state.federais;
  const map = new Map();

  for (const f of base) {
    const key = concursoKey(f);
    if (!map.has(key)) {
      map.set(key, {
        key,
        concurso: f.concurso,
        dt_sorteio: f.dt_sorteio,
        label: `${f.concurso}${f.dt_sorteio ? ' • ' + fmtDate(f.dt_sorteio) : ''}`
      });
    }
  }

  return [...map.values()];
}

function getFederaisDoConcurso(key, disponiveisOnly = false) {
  if (!key) return [];
  const base = disponiveisOnly ? federaisDisponiveis() : state.federais;
  return base.filter(f => concursoKey(f) === key);
}
function federaisDisponiveis() {
  return state.federais
    .filter(f => {
      if (!f.dt_sorteio) return true;
      return String(f.dt_sorteio).slice(0, 10) >= state.dataRef;
    })
    .sort((a, b) => {
      const dtA = String(a.dt_sorteio || '');
      const dtB = String(b.dt_sorteio || '');
      if (dtA !== dtB) return dtA.localeCompare(dtB, 'pt-BR');

      const concA = String(a.concurso || '');
      const concB = String(b.concurso || '');
      if (concA !== concB) {
        return concA.localeCompare(concB, 'pt-BR', { numeric: true });
      }

      const lotA = nomeLoteriaExibicao(a.loteria_id);
      const lotB = nomeLoteriaExibicao(b.loteria_id);
      return lotA.localeCompare(lotB, 'pt-BR');
    });
}
function getResumoConcursoAtivoKey() {
  const itens = resumoFederalDisponivel();
  return itens.length ? `${itens[0].concurso}__${itens[0].dt_sorteio || ''}` : '';
}

function resumoFederalVisivel() {
  const base = resumoFederalDisponivel();

  if (state.mostrarTodosConcursos) {
    return base;
  }

  const key = getResumoConcursoAtivoKey();
  return key
    ? base.filter(r => `${r.concurso}__${r.dt_sorteio || ''}` === key)
    : [];
}


function getDistribuicaoDestinosByFederal(resumoRow) {
  const origemId = String(resumoRow.loteria_id);
  const federalId = String(resumoRow.federal_id);

  // começa com TODAS as lojas destino possíveis, zeradas
  const map = new Map();

  (state.loterias || []).forEach(l => {
    const lotId = String(l.id);
    if (lotId === origemId) return; // não repete a própria origem

    map.set(lotId, {
      loteria_destino: l.id,
      loja_destino_nome: l.nome,
      qtd_enviada: 0
    });
  });

  // soma o que essa origem realmente enviou
  (state.movimentacoes || []).forEach(m => {
    if (String(m.federal_id) !== federalId) return;
    if (String(m.loteria_origem || '') !== origemId) return;
    if (String(m.tipo_evento || '') !== 'TRANSFERENCIA') return;
    if (String(m.status_acerto || '').toUpperCase() === 'CANCELADO') return;
    if (!m.loteria_destino) return;

    const destId = String(m.loteria_destino);
    const item = map.get(destId);
    if (!item) return;

    item.qtd_enviada += Number(m.qtd_fracoes || 0);
  });

  return [...map.values()].sort((a, b) =>
    String(a.loja_destino_nome || '').localeCompare(String(b.loja_destino_nome || ''), 'pt-BR')
  );
}
  async function bootstrap() {
    startClock('relogio');
    state.usuario = await requireSession();
    if (!state.usuario) return;

    state.loterias = await loadLoterias();

    updateDateUI();
    bindEvents();
    await refresh();
    closeMovCard();
    clearMov();
  }

  bootstrap();
})();
