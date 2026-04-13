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
    selectedConcursoKey: null,
    dataRef: hojeISO()
  };

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

  function getFederalSelecionado() {
  const key = $('mov-federal')?.value || state.selectedConcursoKey;
  const origem = $('mov-loteria-origem')?.value;

  if (!key || !origem) return null;

  return state.federais.find(f =>
    concursoKey(f) === key &&
    String(f.loteria_id) === String(origem)
  ) || null;
}
  
  function federaisDisponiveis({ agrupado = false } = {}) {
  const ref = state.dataRef;

  const filtrados = state.federais
    .filter(f => {
      if (!f.dt_sorteio) return true;
      return String(f.dt_sorteio).slice(0, 10) >= ref;
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

      const lotA = lookupLoteriaName(state.loterias, a.loteria_id) || '';
      const lotB = lookupLoteriaName(state.loterias, b.loteria_id) || '';
      return lotA.localeCompare(lotB, 'pt-BR');
    });

  if (!agrupado) {
    return filtrados;
  }

  const map = new Map();

  for (const f of filtrados) {
    const key = concursoKey(f);

    if (!map.has(key)) {
      map.set(key, {
        key,
        concurso: f.concurso,
        dt_sorteio: f.dt_sorteio,
        modalidade: f.modalidade || 'Federal',
        valor_fracao: f.valor_fracao,
        valor_custo: f.valor_custo,
        origens: [f.loteria_id]
      });
    } else {
      const item = map.get(key);
      if (!item.origens.includes(f.loteria_id)) {
        item.origens.push(f.loteria_id);
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    const dtA = String(a.dt_sorteio || '');
    const dtB = String(b.dt_sorteio || '');
    if (dtA !== dtB) return dtA.localeCompare(dtB, 'pt-BR');

    return String(a.concurso || '').localeCompare(
      String(b.concurso || ''),
      'pt-BR',
      { numeric: true }
    );
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
    if ($('date-display-text')) {
      $('date-display-text').textContent = fmtDate(state.dataRef);
    }
    if ($('date-picker')) {
      $('date-picker').value = state.dataRef;
    }
  }

  function openMovCard() {
    const card = $('mov-card');
    if (card) card.style.display = 'block';
  }

  function closeMovCard() {
    const card = $('mov-card');
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
  const key = $('mov-federal')?.value || state.selectedConcursoKey;
  const origem = $('mov-loteria-origem')?.value;
  const federaisConcurso = getFederaisDoConcurso(key, true);
  const f = getFederalSelecionado();

  if (!key || !federaisConcurso.length) {
    $('mov-resumo-selec').innerHTML = `
      <div class="empty-title">Selecione um concurso na lista acima</div>
      <div class="empty-sub">Depois escolha a loja de origem para liberar os detalhes.</div>
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

  function resetFormFromSelectedFederal() {
    const f = getFederalSelecionado();

    state.editingMovId = null;
    $('btn-excluir-mov').style.display = 'none';
    $('mov-modalidade').value = 'Federal';
    $('mov-tipo-evento').value = 'TRANSFERENCIA';
    $('mov-qtd').value = '';
    $('mov-status-acerto').value = 'PENDENTE';
    $('mov-observacao').value = '';

    if (!f) {
      $('mov-federal').value = '';
      fillOrigemSelect('');
      $('mov-loteria-origem').value = '';
      $('mov-loteria-destino').value = '';
      $('mov-dt-concurso').value = '';
      $('mov-valor').value = '';
      $('mov-total').value = '';
      renderResumoSelecao();
      applyDestinoFilter();
      return;
    }

    fillStaticSelects(concursoKey(f), f.loteria_id);
    $('mov-federal').value = concursoKey(f);
    fillOrigemSelect(f.loteria_id);
    $('mov-loteria-origem').value = String(f.loteria_id);
    $('mov-loteria-destino').value = '';
    $('mov-dt-concurso').value = f.dt_sorteio || '';

    syncMovValorByTipo();
    renderResumoSelecao();
    applyDestinoFilter();
  }

  function clearMov() {
  state.editingMovId = null;

  if (state.selectedConcursoKey) {
    fillStaticSelects(state.selectedConcursoKey, '');
    $('mov-federal').value = state.selectedConcursoKey;
  } else {
    fillStaticSelects();
    $('mov-federal').value = '';
  }

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

  renderResumoSelecao();
  applyDestinoFilter();
}

  function renderListaFederais() {
  const lista = $('federal-lista');
  const stLoading = $('st-fed-loading');
  const stEmpty = $('st-fed-empty');
  const count = $('federal-count');

  if (!lista) return;

  const itens = federaisDisponiveis({ agrupado: true });

  if (count) {
    count.textContent = `${itens.length} concurso${itens.length === 1 ? '' : 's'} disponível${itens.length === 1 ? '' : 'eis'} em ${fmtDate(state.dataRef)}.`;
  }

  if (stLoading) stLoading.style.display = 'none';

  if (!itens.length) {
    if (stEmpty) stEmpty.style.display = 'block';
    lista.style.display = 'none';
    lista.innerHTML = '';
    return;
  }

  if (stEmpty) stEmpty.style.display = 'none';
  lista.style.display = 'grid';
  lista.style.gap = '10px';

  lista.innerHTML = itens.map(item => {
    const isSelected = String(state.selectedConcursoKey || '') === String(item.key);

    const style = isSelected
      ? 'border:1px solid var(--accent);background:rgba(0,200,150,.06);'
      : 'border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);';

    const qtdOrigens = item.origens?.length || 0;

    return `
      <button
        type="button"
        class="federal-card"
        data-key="${item.key}"
        style="
          width:100%;
          text-align:left;
          border-radius:10px;
          padding:14px 16px;
          cursor:pointer;
          transition:.2s;
          ${style}
        "
      >
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="badge b-info">Federal</span>
              <span class="mono" style="font-weight:600">Concurso ${item.concurso || '—'}</span>
            </div>

            <div class="inline-pills">
              <span class="pill">Data ${fmtDate(item.dt_sorteio)}</span>
              <span class="pill">Fração ${fmtMoney(item.valor_fracao)}</span>
              <span class="pill">Custo ${fmtMoney(item.valor_custo)}</span>
              <span class="pill">${qtdOrigens} origem${qtdOrigens === 1 ? '' : 'ens'} disponível${qtdOrigens === 1 ? '' : 'eis'}</span>
            </div>
          </div>

          <div>
            <span class="badge ${isSelected ? 'b-ok' : 'b-info'}">
              ${isSelected ? 'Selecionado' : 'Selecionar'}
            </span>
          </div>
        </div>
      </button>
    `;
  }).join('');
}

  function selectConcurso(key, { scroll = true } = {}) {
  if (!key) return;

  state.selectedConcursoKey = key;
  state.editingMovId = null;

  renderListaFederais();
  openMovCard();

  fillStaticSelects(key, '');
  $('mov-federal').value = key;
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

  renderResumoSelecao();
  applyDestinoFilter();

  if (scroll) {
    $('mov-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    // Garante que o item apareça na lista desta etapa.
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
    $('mov-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        state.selectedFederalId = keepFederalId;
        renderListaFederais();
        resetFormFromSelectedFederal();
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
    await loadMovs();

    updateDateUI();
    fillStaticSelects();
    renderListaFederais();
    renderMovimentacoes();

    if (state.selectedFederalId && getFederalById(state.selectedFederalId)) {
      openMovCard();
      resetFormFromSelectedFederal();
    }
  }

  function bindDateEvents() {
    $('btn-dt-prev')?.addEventListener('click', () => {
      state.dataRef = addDays(state.dataRef, -1);
      state.selectedFederalId = null;
      state.editingMovId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    $('btn-dt-next')?.addEventListener('click', () => {
      state.dataRef = addDays(state.dataRef, 1);
      state.selectedFederalId = null;
      state.editingMovId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    $('btn-dt-hoje')?.addEventListener('click', () => {
      state.dataRef = hojeISO();
      state.selectedFederalId = null;
      state.editingMovId = null;
      updateDateUI();
      renderListaFederais();
      closeMovCard();
      clearMov();
    });

    $('btn-date-display')?.addEventListener('click', () => {
      $('date-picker')?.showPicker?.();
      $('date-picker')?.click();
    });

    $('date-picker')?.addEventListener('change', (e) => {
      const value = e.target.value || hojeISO();
      state.dataRef = value;
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
      state.selectedConcursoKey = $('mov-federal').value || null;

      if (!f) {
        renderResumoSelecao();
        renderListaFederais();
        applyDestinoFilter();
        return;
      }

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

   $('federal-lista')?.addEventListener('click', (e) => {
  const card = e.target.closest('[data-key]');
  if (!card) return;
  selectConcurso(card.dataset.key);
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
