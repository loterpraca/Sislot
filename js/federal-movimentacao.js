(() => {
  const {
    sb, $, fmtMoney, fmtDate, startClock, showStatus, fillSelect,
    requireSession, loadLoterias, loadFederais, lookupLoteriaName, lookupFederal
  } = FED_BASE;

  const state = {
    usuario: null,
    loterias: [],
    federais: [],
    movimentos: [],
    editingMovId: null,
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

  function getFederalById(id) {
    if (!id) return null;
    return state.federais.find(f => String(f.id) === String(id)) || null;
  }

  function nomeLoteriaExibicao(loteriaId) {
    return lookupLoteriaName(state.loterias, loteriaId) || '—';
  }

  function fmtSaldo(v) {
    return String(Number(v || 0));
  }

  function getSaldoFederal(f) {
    return Number(
      f.saldo ??
      f.saldo_atual ??
      f.qtd_disponivel ??
      f.qtd_fracoes_disponiveis ??
      f.qtd_disponivel_loja ??
      f.qtd_fracoes ??
      0
    ) || 0;
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

  function getConcursoAtivoKey() {
    const itens = federaisDisponiveis();
    return itens.length ? concursoKey(itens[0]) : '';
  }

  function federaisVisiveis() {
    const base = federaisDisponiveis();

    if (state.mostrarTodosConcursos) {
      return base;
    }

    const key = getConcursoAtivoKey();
    return key ? base.filter(f => concursoKey(f) === key) : [];
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

  async function loadMovs() {
    const { data, error } = await sb
      .from('federal_movimentacoes')
      .select('*, federais!inner(concurso,dt_sorteio,modalidade)')
      .order('created_at', { ascending: false });

    if (error) {
      showStatus('st-mov', error.message, 'err');
      state.movimentos = [];
      return;
    }

    state.movimentos = data || [];
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

  function fillConcursoSelect(selectedKey = '') {
    const concursos = getConcursosUnicos(true);
    fillSelect('mov-federal', concursos, 'Selecione...', 'key', x => x.label);

    if (selectedKey) {
      $('mov-federal').value = selectedKey;
    }
  }

  function fillOrigemSelect(selectedOrigem = '') {
    const key = $('mov-federal').value;
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

    if (origem && sel.value === origem) sel.value = '';
  }

  function syncMovValorByTipo() {
    const f = getFederalSelecionado();
    if (!f) return;

    const tipo = $('mov-tipo-evento').value;

    if (tipo === 'DEVOLUCAO_CAIXA') {
      $('mov-valor').value = f.valor_custo ?? '';
    } else if (tipo === 'VENDA_CAMBISTA') {
      $('mov-valor').value = '';
    } else {
      $('mov-valor').value = f.valor_fracao ?? '';
    }

    syncTotal();
  }

  function syncTotal() {
    const qtd = Number($('mov-qtd').value || 0);
    const valor = Number($('mov-valor').value || 0);
    $('mov-total').value = qtd && valor ? (qtd * valor).toFixed(2) : '';
  }

  function renderResumoSelecao() {
    const key = $('mov-federal')?.value;
    const origem = $('mov-loteria-origem')?.value;
    const federaisConcurso = getFederaisDoConcurso(key, true);
    const f = getFederalSelecionado();

    if (!key || !federaisConcurso.length) {
      $('mov-resumo-selec').innerHTML = `
        <div class="empty-title">Selecione concurso e loja origem</div>
        <div class="empty-sub">Resumo rápido da origem escolhida.</div>
      `;
      return;
    }

    const base = federaisConcurso[0];

    if (!origem || !f) {
      $('mov-resumo-selec').innerHTML = `
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

    $('mov-resumo-selec').innerHTML = `
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

  function clearMov() {
    state.editingMovId = null;
    state.selectedFederalId = null;

    $('mov-federal').value = '';
    fillOrigemSelect('');

    $('mov-modalidade').value = 'Federal';
    $('mov-loteria-origem').value = '';
    $('mov-loteria-destino').value = '';
    $('mov-dt-concurso').value = '';
    $('mov-tipo-evento').value = 'TRANSFERENCIA';
    $('mov-qtd').value = '';
    $('mov-valor').value = '';
    $('mov-total').value = '';
    $('mov-status-acerto').value = 'PENDENTE';
    $('mov-observacao').value = '';
    $('btn-excluir-mov').style.display = 'none';

    $('mov-resumo-selec').innerHTML = `
      <div class="empty-title">Selecione concurso e loja origem</div>
      <div class="empty-sub">Resumo rápido da origem escolhida.</div>
    `;

    applyDestinoFilter();
    renderListaFederais();
  }

  function renderListaFederais() {
    const lista = firstEl('federal-lista', 'federalLista');
    const stLoading = firstEl('st-fed-loading', 'stFedLoading');
    const stEmpty = firstEl('st-fed-empty', 'stFedEmpty');
    const count = firstEl('federal-count', 'federalCount');

    if (!lista) return;

    const itens = federaisVisiveis();

    if (stLoading) stLoading.style.display = 'none';

    if (count) {
      if (!state.mostrarTodosConcursos) {
        const key = getConcursoAtivoKey();
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

    lista.innerHTML = itens.map(f => {
      const isSelected = String(state.selectedFederalId || '') === String(f.id);
      const origemNome = nomeLoteriaExibicao(f.loteria_id);
      const saldo = fmtSaldo(getSaldoFederal(f));

      return `
        <button
          type="button"
          class="fed-card ${isSelected ? 'is-selected' : ''}"
          data-id="${f.id}"
        >
          <div class="fed-card-main">
            <div class="fed-card-head">
              <span class="fed-modalidade">Federal</span>
              <span class="fed-concurso-chip">${f.concurso || '—'}</span>
              <span class="fed-data-chip">${fmtDate(f.dt_sorteio)}</span>
            </div>

            <div class="fed-card-tags">
              <span class="fed-tag">${origemNome}</span>
              <span class="fed-tag">Fração ${fmtMoney(f.valor_fracao)}</span>
              <span class="fed-tag">Custo ${fmtMoney(f.valor_custo)}</span>
            </div>

            <div class="fed-card-saldos">
              <div class="fed-saldo-pill" title="${origemNome}">
                <span class="fed-saldo-loja">${origemNome}</span>
                <span class="fed-saldo-val">${saldo}</span>
              </div>
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
    state.editingMovId = null;

    renderListaFederais();
    openMovCard();

    fillStaticSelects(concursoKey(f), f.loteria_id);

    $('mov-federal').value = concursoKey(f);
    fillOrigemSelect(f.loteria_id);
    $('mov-loteria-origem').value = String(f.loteria_id);

    $('mov-modalidade').value = 'Federal';
    $('mov-loteria-destino').value = '';
    $('mov-dt-concurso').value = f.dt_sorteio || '';
    $('mov-tipo-evento').value = 'TRANSFERENCIA';
    $('mov-qtd').value = '';
    $('mov-status-acerto').value = 'PENDENTE';
    $('mov-observacao').value = '';
    $('btn-excluir-mov').style.display = 'none';

    syncMovValorByTipo();
    renderResumoSelecao();
    applyDestinoFilter();

    if (scroll) {
      firstEl('mov-card', 'movCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderMovimentacoes() {
    $('tbody-mov').innerHTML = state.movimentos.length ? state.movimentos.map(m => {
      const total = Number(
        m.valor_total_real ||
        m.valor_total ||
        (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0))
      );

      const statusClass = m.status_acerto === 'PAGO' ? 'b-ok' : 'b-warn';

      return `
        <tr>
          <td class="mono">${new Date(m.created_at).toLocaleString('pt-BR')}</td>
          <td>${m.federais?.modalidade || 'Federal'}</td>
          <td class="mono">${m.federais?.concurso || '—'}</td>
          <td><span class="badge b-info">${m.tipo_evento || m.tipo || '—'}</span></td>
          <td>${lookupLoteriaName(state.loterias, m.loteria_origem)}</td>
          <td>${m.loteria_destino ? lookupLoteriaName(state.loterias, m.loteria_destino) : '—'}</td>
          <td class="mono">${m.qtd_fracoes}</td>
          <td class="money">${fmtMoney(m.valor_fracao_real || m.valor_fracao)}</td>
          <td class="money">${fmtMoney(total)}</td>
          <td><span class="badge ${statusClass}">${m.status_acerto || '—'}</span></td>
          <td>
            <div class="flex" style="flex-wrap:nowrap;gap:6px">
              <button class="btn-amber" data-action="editar" data-id="${m.id}">Editar</button>
              <button class="btn-danger" data-action="excluir" data-id="${m.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="11">
          <div class="empty">
            <div class="empty-title">Sem movimentações</div>
          </div>
        </td>
      </tr>
    `;

    applyDestinoFilter();
  }

  function editMov(id) {
    const m = state.movimentos.find(x => String(x.id) === String(id));
    if (!m) return;

    const f = lookupFederal(state.federais, m.federal_id);
    if (!f) {
      showStatus('st-mov', 'Federal da movimentação não encontrado.', 'err');
      return;
    }

    if (f.dt_sorteio && String(f.dt_sorteio).slice(0, 10) < state.dataRef) {
      state.dataRef = String(f.dt_sorteio).slice(0, 10);
      updateDateUI();
    }

    state.selectedFederalId = f.id;
    state.editingMovId = id;

    renderListaFederais();
    openMovCard();

    fillStaticSelects(concursoKey(f), m.loteria_origem || f.loteria_id);

    $('mov-federal').value = concursoKey(f);
    fillOrigemSelect(m.loteria_origem || f.loteria_id);
    $('mov-loteria-origem').value = String(m.loteria_origem || f.loteria_id);

    $('mov-modalidade').value = 'Federal';
    $('mov-loteria-destino').value = m.loteria_destino || '';
    $('mov-dt-concurso').value = f.dt_sorteio || '';
    $('mov-tipo-evento').value = m.tipo_evento || 'TRANSFERENCIA';
    $('mov-qtd').value = m.qtd_fracoes ?? '';
    $('mov-valor').value = m.valor_fracao_real || m.valor_fracao || '';
    $('mov-total').value = Number(
      m.valor_total_real ||
      m.valor_total ||
      (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0))
    ).toFixed(2);
    $('mov-status-acerto').value = m.status_acerto || 'PENDENTE';
    $('mov-observacao').value = m.observacao || '';
    $('btn-excluir-mov').style.display = 'inline-flex';

    renderResumoSelecao();
    applyDestinoFilter();
    firstEl('mov-card', 'movCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deleteMov(id = state.editingMovId) {
    if (!id) return;
    if (!confirm('Apagar esta linha de movimentação?')) return;

    try {
      const { error } = await sb.from('federal_movimentacoes').delete().eq('id', id);
      if (error) throw error;

      showStatus('st-mov', 'Movimentação apagada.', 'ok');
      state.editingMovId = null;
      clearMov();
      await refresh();
    } catch (e) {
      showStatus('st-mov', e.message, 'err');
    }
  }

  async function saveMov() {
    try {
      const federal = getFederalSelecionado();
      const valor = Number($('mov-valor').value || 0);
      const qtd = Number($('mov-qtd').value || 0);
      const tipoEvento = $('mov-tipo-evento').value;

      const payload = {
        federal_id: federal?.id || null,
        loteria_origem: Number($('mov-loteria-origem').value || 0) || null,
        loteria_destino: Number($('mov-loteria-destino').value || 0) || null,
        tipo: tipoEvento === 'TRANSFERENCIA' ? 'ENVIO' : 'DEVOLUCAO_EXTERNA',
        tipo_evento: tipoEvento,
        qtd_fracoes: qtd,
        valor_fracao: valor,
        valor_fracao_ref: Number(federal?.valor_fracao || 0),
        valor_fracao_real: valor,
        valor_a_acertar: 0,
        status_acerto: state.editingMovId ? ($('mov-status-acerto').value || 'PENDENTE') : 'PENDENTE',
        data_mov: state.dataRef,
        observacao: $('mov-observacao').value.trim() || null,
        criado_por: state.usuario?.id || null,
        updated_at: new Date().toISOString(),
        editado_por: state.editingMovId ? state.usuario?.id : null,
        editado_em: state.editingMovId ? new Date().toISOString() : null
      };

      if (!payload.federal_id || !payload.tipo_evento || !payload.qtd_fracoes || !payload.loteria_origem) {
        showStatus('st-mov', 'Preencha concurso, loja origem, evento e quantidade.', 'err');
        return;
      }

      if (payload.tipo_evento === 'TRANSFERENCIA' && !payload.loteria_destino) {
        showStatus('st-mov', 'Selecione a loja destino.', 'err');
        return;
      }

      if (state.editingMovId) {
        const { error } = await sb
          .from('federal_movimentacoes')
          .update(payload)
          .eq('id', state.editingMovId);

        if (error) throw error;
        showStatus('st-mov', 'Movimentação atualizada.', 'ok');
      } else {
        const { error } = await sb
          .from('federal_movimentacoes')
          .insert(payload);

        if (error) throw error;
        showStatus('st-mov', 'Movimentação registrada.', 'ok');
      }

      const keepFederalId = state.selectedFederalId;
      state.editingMovId = null;
      await refresh();

      if (keepFederalId && getFederalById(keepFederalId)) {
        selectFederalCard(keepFederalId, { scroll: false });
      } else {
        state.selectedFederalId = null;
        clearMov();
        closeMovCard();
      }
    } catch (e) {
      showStatus('st-mov', e.message, 'err');
    }
  }

 async function refresh() {
  state.federais = await loadFederais();

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
      state.editingMovId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    btnNext?.addEventListener('click', () => {
      state.dataRef = addDays(state.dataRef, 1);
      state.selectedFederalId = null;
      state.editingMovId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    btnHoje?.addEventListener('click', () => {
      state.dataRef = hojeISO();
      state.selectedFederalId = null;
      state.editingMovId = null;
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
      state.editingMovId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    chkTodos?.addEventListener('change', (e) => {
      state.mostrarTodosConcursos = !!e.target.checked;
      state.selectedFederalId = null;
      state.editingMovId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });
  }

  function bindEvents() {
    bindDateEvents();

    $('mov-federal').addEventListener('change', () => {
      state.selectedFederalId = null;
      fillOrigemSelect('');
      $('mov-loteria-origem').value = '';
      $('mov-dt-concurso').value = '';
      $('mov-valor').value = '';
      $('mov-total').value = '';
      renderResumoSelecao();
      renderListaFederais();
      applyDestinoFilter();
    });

    $('mov-loteria-origem').addEventListener('change', () => {
      const f = getFederalSelecionado();

      if (!f) {
        renderResumoSelecao();
        renderListaFederais();
        applyDestinoFilter();
        return;
      }

      state.selectedFederalId = f.id;
      $('mov-modalidade').value = 'Federal';
      $('mov-dt-concurso').value = f.dt_sorteio || '';
      syncMovValorByTipo();
      renderResumoSelecao();
      renderListaFederais();
      applyDestinoFilter();
    });

    $('mov-tipo-evento').addEventListener('change', syncMovValorByTipo);

    ['mov-qtd', 'mov-valor'].forEach(id => {
      $(id).addEventListener('input', syncTotal);
    });

    $('btn-salvar-mov').addEventListener('click', saveMov);
    $('btn-limpar-mov').addEventListener('click', clearMov);
    $('btn-excluir-mov').addEventListener('click', () => deleteMov());

    $('tbody-mov').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const id = btn.dataset.id;
      if (btn.dataset.action === 'editar') editMov(id);
      if (btn.dataset.action === 'excluir') deleteMov(id);
    });

    firstEl('federal-lista', 'federalLista')?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-id]');
      if (!card) return;
      selectFederalCard(card.dataset.id);
    });
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
