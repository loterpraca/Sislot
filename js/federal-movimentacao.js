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
    mostrarTodosConcursos: false,
    movDraft: {},
    desfechoDraft: {},
    expandedDestinoId: null
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

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function int(value, fallback = 0) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function money(value) {
    return fmtMoney(num(value || 0));
  }

  function fmtSaldo(v) {
    return String(num(v || 0));
  }

  function concursoKey(f) {
    return `${f.concurso}__${f.dt_sorteio || ''}`;
  }

  function nomeLoteriaExibicao(loteriaId) {
    return lookupLoteriaName(state.loterias, loteriaId) || '—';
  }

  function getResumoByFederalId(federalId) {
    return state.resumoFederal.find(r => String(r.federal_id) === String(federalId)) || null;
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

  function getDefaultTransferValue(federal) {
    return num(federal?.valor_fracao || 0);
  }

  function getDefaultVendaValue(federal) {
    return num(federal?.valor_fracao || 0);
  }

  function getDefaultDevolucaoValue(federal) {
    return num(federal?.valor_custo || 0);
  }

  function getDefaultCambistaValue(row, federal) {
    const saved = num(row?.valor_cambista || 0);
    if (saved > 0) return saved;
    return num(federal?.valor_fracao || 0);
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

  function updateDateUI() {
    const dateText = firstEl('date-display-text', 'dateDisplayText');
    const datePicker = firstEl('date-picker', 'calendarPicker');
    const chkTodos = firstEl('chk-mostrar-todos-concursos', 'chkMostrarTodosConcursos');

    if (dateText) dateText.textContent = fmtDate(state.dataRef);
    if (datePicker) datePicker.value = state.dataRef;
    if (chkTodos) chkTodos.checked = !!state.mostrarTodosConcursos;
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

  function fillStaticSelects(selectedConcursoKey = '', selectedOrigem = '') {
    fillConcursoSelect(selectedConcursoKey);
    fillOrigemSelect(selectedOrigem);
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

  async function loadMovimentacoesResumo() {
    const { data, error } = await sb
      .from('federal_movimentacoes')
      .select([
        'id',
        'federal_id',
        'loteria_origem',
        'loteria_destino',
        'qtd_fracoes',
        'qtd_vendida',
        'qtd_devolucao_caixa',
        'qtd_venda_cambista',
        'valor_cambista',
        'qtd_retorno_origem',
        'tipo_evento',
        'status_acerto',
        'created_at',
        'updated_at',
        'data_mov',
        'observacao'
      ].join(','))
      .eq('tipo_evento', 'TRANSFERENCIA')
      .not('loteria_destino', 'is', null)
      .order('id', { ascending: false });

    if (error) {
      showStatus('st-mov', error.message, 'err');
      state.movimentacoes = [];
      return;
    }

    state.movimentacoes = data || [];
  }

  function getHistoricoDestino(resumoRow, destinoId) {
    const federalId = String(resumoRow.federal_id);
    const origemId = String(resumoRow.loteria_id);
    const destId = String(destinoId);

    const rows = (state.movimentacoes || []).filter(m => {
      if (String(m.federal_id) !== federalId) return false;
      if (String(m.status_acerto || '').toUpperCase() === 'CANCELADO') return false;
      return String(m.loteria_origem || '') === origemId && String(m.loteria_destino || '') === destId;
    });

    const totalTransferido = rows.reduce((acc, row) => acc + num(row.qtd_fracoes), 0);
    const totalVenda = rows.reduce((acc, row) => acc + num(row.qtd_vendida), 0);
    const totalDevolucao = rows.reduce((acc, row) => acc + num(row.qtd_devolucao_caixa), 0);
    const totalCambista = rows.reduce((acc, row) => acc + num(row.qtd_venda_cambista), 0);
    const totalRetorno = rows.reduce((acc, row) => acc + num(row.qtd_retorno_origem), 0);
    const saldo = totalTransferido - totalVenda - totalDevolucao - totalCambista - totalRetorno;

    return {
      expr: `T ${totalTransferido} • V ${totalVenda} • CX ${totalDevolucao} • CB ${totalCambista} • RT ${totalRetorno}`,
      saldo,
      totalTransferido,
      totalVenda,
      totalDevolucao,
      totalCambista,
      totalRetorno,
      rows
    };
  }

  function getActiveTransfer(resumoRow, destinoId) {
    const hist = getHistoricoDestino(resumoRow, destinoId);

    const ordered = [...hist.rows].sort((a, b) => {
      const idA = num(a.id);
      const idB = num(b.id);
      return idB - idA;
    });

    const withSaldo = ordered.find(row => {
      const saldoRow = num(row.qtd_fracoes) - num(row.qtd_vendida) - num(row.qtd_devolucao_caixa) - num(row.qtd_venda_cambista) - num(row.qtd_retorno_origem);
      return saldoRow > 0;
    });

    return withSaldo || ordered[0] || null;
  }

  function getDraftByDestino(destinoId) {
    const key = String(destinoId);
    if (!state.movDraft[key]) {
      state.movDraft[key] = { qtd: '' };
    }
    return state.movDraft[key];
  }

  function clearMov() {
    state.selectedFederalId = null;
    state.movDraft = {};
    state.desfechoDraft = {};
    state.expandedDestinoId = null;

    if ($('mov-federal')) $('mov-federal').value = '';
    fillOrigemSelect('');
    if ($('mov-loteria-origem')) $('mov-loteria-origem').value = '';

    renderResumoSelecao();
    renderMovDestinosGrid();
    renderListaFederais();
  }

  function ensureDesfechoDraft(row, federal) {
    if (!row) return null;

    const key = String(row.id);
    if (!state.desfechoDraft[key]) {
      state.desfechoDraft[key] = {
        qtd_vendida: String(int(row.qtd_vendida || 0)),
        qtd_devolucao_caixa: String(int(row.qtd_devolucao_caixa || 0)),
        valor_devolucao_caixa: String(getDefaultDevolucaoValue(federal).toFixed(2)),
        qtd_venda_cambista: String(int(row.qtd_venda_cambista || 0)),
        valor_cambista: String(getDefaultCambistaValue(row, federal).toFixed(2)),
        qtd_retorno_origem: String(int(row.qtd_retorno_origem || 0))
      };
    }

    return state.desfechoDraft[key];
  }

  function getDesfechoCalc(row, federal) {
    const draft = ensureDesfechoDraft(row, federal);
    if (!row || !draft) return null;

    const qtdTransferida = int(row.qtd_fracoes || 0);
    const qtdVendida = int(draft.qtd_vendida || 0);
    const qtdDevolucao = int(draft.qtd_devolucao_caixa || 0);
    const qtdCambista = int(draft.qtd_venda_cambista || 0);
    const qtdRetorno = int(draft.qtd_retorno_origem || 0);

    const valorVenda = getDefaultVendaValue(federal);
    const valorDevolucao = num(draft.valor_devolucao_caixa || getDefaultDevolucaoValue(federal));
    const valorCambista = num(draft.valor_cambista || getDefaultCambistaValue(row, federal));

    const totalQtd = qtdVendida + qtdDevolucao + qtdCambista + qtdRetorno;
    const saldoRestante = qtdTransferida - totalQtd;
    const totalFinanceiro =
      (qtdVendida * valorVenda) +
      (qtdDevolucao * valorDevolucao) +
      (qtdCambista * valorCambista);

    return {
      qtdTransferida,
      qtdVendida,
      qtdDevolucao,
      qtdCambista,
      qtdRetorno,
      totalQtd,
      saldoRestante,
      valorVenda,
      valorDevolucao,
      valorCambista,
      totalFinanceiro,
      hasError: totalQtd > qtdTransferida
    };
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
        <div class="mov-bilhete-head">
          <span class="fed-modalidade-chip">Federal</span>
          <span class="fed-concurso-chip">#${base.concurso || '—'}</span>
          <span class="fed-data-chip">${fmtDate(base.dt_sorteio)}</span>
        </div>
        <div class="empty-sub" style="margin-top:10px">Selecione agora a loja de origem.</div>
      `;
      return;
    }

    const resumoRow = getResumoByFederalId(f.id) || {};
    const lojas = getResumoMovimentacaoPorLoja(resumoRow);
    const origemNome = lookupLoteriaName(state.loterias, f.loteria_id);

    resumo.innerHTML = `
      <div class="mov-bilhete-head">
        <span class="fed-modalidade-chip">Federal</span>
        <span class="fed-concurso-chip">#${f.concurso || '—'}</span>
        <span class="fed-data-chip">${fmtDate(f.dt_sorteio)}</span>
        <span class="fed-fracao-chip">${money(f.valor_fracao)}</span>
        <span class="fed-origem-chip">${origemNome}</span>
      </div>

      <div class="mov-lojas-wrap">
        <div class="mov-lojas-title">Movimentação por Loja</div>
        <div class="mov-lojas-strip">
          ${lojas.map(item => `
            <div class="mov-loja-chip ${item.destaque || ''}">
              <span>${item.nome}</span>
              <strong>${item.valor}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    `;
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
            <div class="fed-card-line1">
              <span class="fed-modalidade-chip">Federal</span>
              <span class="fed-concurso-chip">${r.concurso || '—'}</span>
              <span class="fed-data-chip">${fmtDate(r.dt_sorteio)}</span>
              <span class="fed-fracao-chip">Fração ${money(r.valor_fracao)}</span>
              <span class="fed-origem-chip">${origemNome}</span>
            </div>

            <div class="fed-card-line2">
              <div class="fed-saldo-pill fed-saldo-pill-main" title="${origemNome}">
                <span class="fed-saldo-loja">${origemNome}</span>
                <span class="fed-saldo-val">${estoqueAtual}</span>
              </div>
              ${destinosHtml}
            </div>
          </div>

          <div class="fed-card-ind">
            <span class="btn-topbar ${isSelected ? 'is-selected-btn' : ''}">
              ${isSelected ? 'Selecionado' : 'Selecionar'}
            </span>
          </div>
        </button>
      `;
    }).join('');
  }

  function getDistribuicaoDestinosByFederal(resumoRow) {
    const origemId = String(resumoRow.loteria_id);
    const federalId = String(resumoRow.federal_id);

    const map = new Map();

    (state.loterias || []).forEach(l => {
      const lotId = String(l.id);
      if (lotId === origemId) return;

      map.set(lotId, {
        loteria_destino: l.id,
        loja_destino_nome: l.nome,
        qtd_enviada: 0
      });
    });

    (state.movimentacoes || []).forEach(m => {
      if (String(m.federal_id) !== federalId) return;
      if (String(m.loteria_origem || '') !== origemId) return;
      if (String(m.tipo_evento || '') !== 'TRANSFERENCIA') return;
      if (String(m.status_acerto || '').toUpperCase() === 'CANCELADO') return;
      if (!m.loteria_destino) return;

      const destId = String(m.loteria_destino);
      const item = map.get(destId);
      if (!item) return;

      item.qtd_enviada += num(m.qtd_fracoes || 0);
    });

    return [...map.values()].sort((a, b) =>
      String(a.loja_destino_nome || '').localeCompare(String(b.loja_destino_nome || ''), 'pt-BR')
    );
  }

  function getResumoMovimentacaoPorLoja(resumoRow) {
    const origemNome = resumoRow.loja_origem || nomeLoteriaExibicao(resumoRow.loteria_id);
    const itens = [{
      nome: origemNome,
      valor: fmtSaldo(resumoRow.estoque_atual || 0),
      destaque: 'is-origin'
    }];

    getDistribuicaoDestinosByFederal(resumoRow).forEach(item => {
      itens.push({
        nome: item.loja_destino_nome,
        valor: fmtSaldo(item.qtd_enviada || 0),
        destaque: item.qtd_enviada > 0 ? 'is-active' : ''
      });
    });

    return itens;
  }

  function renderMovDestinosGrid() {
    const box = $('mov-destinos-grid');
    const federal = getFederalSelecionado();
    const resumo = federal ? getResumoByFederalId(federal.id) : null;

    if (!box) return;

    if (!federal || !resumo) {
      box.innerHTML = '';
      return;
    }

    const origemId = String(resumo.loteria_id);

    const destinos = (state.loterias || [])
      .filter(l => String(l.id) !== origemId)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    box.innerHTML = destinos.map(l => {
      const hist = getHistoricoDestino(resumo, l.id);
      const transfer = getActiveTransfer(resumo, l.id);
      const draft = getDraftByDestino(l.id);
      const isExpanded = String(state.expandedDestinoId || '') === String(l.id);
      const calc = transfer ? getDesfechoCalc(transfer, federal) : null;

      const statusHtml = calc
        ? `
          <div class="mov-status-inline">
            <span class="mov-status-pill ${calc.hasError ? 'is-warn' : 'is-ok'}">
              ${calc.hasError ? 'Excedeu a remessa' : 'Desfecho disponível'}
            </span>
          </div>
        `
        : `
          <div class="mov-status-inline">
            <span class="mov-status-pill">Sem desfecho</span>
          </div>
        `;

      return `
        <div class="mov-dest-card ${isExpanded ? 'is-expanded' : ''}" data-dest-card data-dest-id="${l.id}">
          <div class="mov-dest-toggle">
            <div class="mov-dest-head">
              <div class="mov-dest-name">${l.nome}</div>
              <button type="button" class="mov-dest-action" data-toggle-desfecho data-dest-id="${l.id}">
                Desfecho
              </button>
            </div>

            <div class="mov-mini-grid mov-mini-grid-single">
              <div class="mov-balance-box">
                <span>Saldo líquido</span>
                <strong>${fmtSaldo(hist.saldo)}</strong>
              </div>
            </div>

            ${statusHtml}
          </div>

          <div class="mov-input-zone">
            <div class="field">
              <label class="field-label">Qtd frações</label>
              <input
                type="number"
                step="1"
                min="0"
                class="mov-dest-input"
                data-dest-input
                data-dest-id="${l.id}"
                value="${draft.qtd ?? ''}"
                placeholder="0"
              >
            </div>
          </div>

          <div class="mov-card-footer">
            <div class="mov-dest-hist">${hist.expr}</div>
          </div>

          <div class="mov-expand">
            ${renderExpandContent({ federal, destino: l, transfer, calc })}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderExpandContent({ federal, destino, transfer, calc }) {
    if (!transfer || !calc) {
      return `
        <div class="mov-empty-expand">
          Salve uma transferência para ${destino.nome} antes de preencher o desfecho.
        </div>
      `;
    }

    const draft = state.desfechoDraft[String(transfer.id)] || {};

    return `
      <div class="mov-expand-grid">
        <div class="mov-mini-grid">
          <div class="mov-mini-box">
            <span>Qtd transferida</span>
            <strong>${fmtSaldo(calc.qtdTransferida)}</strong>
          </div>
          <div class="mov-fin-box">
            <span>Total financeiro</span>
            <strong>${money(calc.totalFinanceiro)}</strong>
          </div>
        </div>

        <div class="mov-expand-row">
          <div class="mov-expand-top">
            <span class="mov-expand-label is-sale">Venda</span>
            <span class="mov-expand-meta">Preço fixo ${money(calc.valorVenda)}</span>
          </div>
          <div class="mov-expand-controls">
            <div class="field">
              <label class="field-label">Qtd vendida</label>
              <input type="number" min="0" step="1" data-mov-id="${transfer.id}" data-field="qtd_vendida" value="${draft.qtd_vendida ?? '0'}">
            </div>
            <div class="field">
              <label class="field-label">Valor</label>
              <div class="mov-inline-readonly">${money(calc.valorVenda)}</div>
            </div>
          </div>
        </div>

        <div class="mov-expand-row">
          <div class="mov-expand-top">
            <span class="mov-expand-label is-blue">Devolução Caixa</span>
            <span class="mov-expand-meta">Preço default ${money(getDefaultDevolucaoValue(federal))}</span>
          </div>
          <div class="mov-expand-controls">
            <div class="field">
              <label class="field-label">Qtd devolução</label>
              <input type="number" min="0" step="1" data-mov-id="${transfer.id}" data-field="qtd_devolucao_caixa" value="${draft.qtd_devolucao_caixa ?? '0'}">
            </div>
            <div class="field">
              <label class="field-label">Preço devolução</label>
              <input type="number" min="0" step="0.01" data-mov-id="${transfer.id}" data-field="valor_devolucao_caixa" value="${draft.valor_devolucao_caixa ?? getDefaultDevolucaoValue(federal).toFixed(2)}">
            </div>
          </div>
        </div>

        <div class="mov-expand-row">
          <div class="mov-expand-top">
            <span class="mov-expand-label is-gray">Venda Cambista</span>
            <span class="mov-expand-meta">Preço editável</span>
          </div>
          <div class="mov-expand-controls">
            <div class="field">
              <label class="field-label">Qtd cambista</label>
              <input type="number" min="0" step="1" data-mov-id="${transfer.id}" data-field="qtd_venda_cambista" value="${draft.qtd_venda_cambista ?? '0'}">
            </div>
            <div class="field">
              <label class="field-label">Valor cambista</label>
              <input type="number" min="0" step="0.01" data-mov-id="${transfer.id}" data-field="valor_cambista" value="${draft.valor_cambista ?? getDefaultCambistaValue(transfer, federal).toFixed(2)}">
            </div>
          </div>
        </div>

        <div class="mov-expand-row">
          <div class="mov-expand-top">
            <span class="mov-expand-label is-return">Retorno origem</span>
            <span class="mov-expand-meta">Sem financeiro</span>
          </div>
          <div class="mov-expand-controls single">
            <div class="field">
              <label class="field-label">Qtd retorno</label>
              <input type="number" min="0" step="1" data-mov-id="${transfer.id}" data-field="qtd_retorno_origem" value="${draft.qtd_retorno_origem ?? '0'}">
            </div>
          </div>
        </div>

        <div class="mov-mini-grid">
          <div class="mov-balance-box">
            <span>Saldo restante</span>
            <strong>${fmtSaldo(calc.saldoRestante)}</strong>
          </div>
          <div class="mov-mini-box">
            <span>Total itens do desfecho</span>
            <strong>${fmtSaldo(calc.totalQtd)}</strong>
          </div>
        </div>

        <div class="mov-expand-actions">
          <div class="mov-desfecho-note">
            O preço de devolução entra no cálculo visual do card. Com o banco atual, só o valor cambista é persistido como valor variável.
          </div>
          <button type="button" class="btn-primary" data-save-desfecho data-mov-id="${transfer.id}" ${calc.hasError ? 'disabled' : ''}>
            Salvar desfecho
          </button>
        </div>
      </div>
    `;
  }

  function selectFederalCard(id, { scroll = true } = {}) {
    const f = getFederalById(id);
    if (!f) return;

    state.selectedFederalId = f.id;
    state.movDraft = {};
    state.desfechoDraft = {};
    state.expandedDestinoId = null;

    renderListaFederais();
    openMovCard();

    fillStaticSelects(concursoKey(f), f.loteria_id);

    $('mov-federal').value = concursoKey(f);
    fillOrigemSelect(f.loteria_id);
    $('mov-loteria-origem').value = String(f.loteria_id);


    renderResumoSelecao();
    renderMovDestinosGrid();

    if (scroll) {
      firstEl('mov-card', 'movCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function saveMov() {
    try {
      const federal = getFederalSelecionado();
      const resumo = federal ? getResumoByFederalId(federal.id) : null;

      if (!federal || !resumo) {
        showStatus('st-mov', 'Selecione a Federal antes de movimentar.', 'err');
        return;
      }

      const origemId = num(resumo.loteria_id);
      const obs = null;
      const valorDefault = getDefaultTransferValue(federal);

      const payloads = Object.entries(state.movDraft || {})
        .map(([destId, data]) => ({
          destId: num(destId),
          qtd: int(data?.qtd || 0)
        }))
        .filter(x => x.qtd > 0)
        .map(x => ({
          federal_id: federal.id,
          loteria_origem: origemId,
          loteria_destino: x.destId,
          tipo: 'ENVIO',
          tipo_evento: 'TRANSFERENCIA',
          qtd_fracoes: x.qtd,
          qtd_vendida: 0,
          qtd_devolucao_caixa: 0,
          qtd_venda_cambista: 0,
          valor_cambista: null,
          qtd_retorno_origem: 0,
          valor_fracao: valorDefault,
          valor_fracao_ref: num(federal.valor_fracao || 0),
          valor_fracao_real: valorDefault,
          valor_a_acertar: 0,
          status_acerto: 'PENDENTE',
          data_mov: state.dataRef,
          observacao: obs,
          criado_por: state.usuario?.id || null,
          updated_at: new Date().toISOString()
        }));

      if (!payloads.length) {
        showStatus('st-mov', 'Preencha ao menos uma loja com quantidade.', 'err');
        return;
      }

      const { error } = await sb
        .from('federal_movimentacoes')
        .insert(payloads);

      if (error) throw error;

      showStatus('st-mov', 'Transferências registradas.', 'ok');

      const keepFederalId = state.selectedFederalId;
      state.movDraft = {};
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

  async function saveDesfecho(movId) {
    try {
      const federal = getFederalSelecionado();
      const row = (state.movimentacoes || []).find(m => String(m.id) === String(movId));
      if (!row || !federal) {
        showStatus('st-mov', 'Remessa não encontrada para salvar o desfecho.', 'err');
        return;
      }

      const calc = getDesfechoCalc(row, federal);
      const draft = state.desfechoDraft[String(movId)] || {};
      if (!calc) {
        showStatus('st-mov', 'Não foi possível montar o cálculo do desfecho.', 'err');
        return;
      }

      if (calc.hasError) {
        showStatus('st-mov', 'O desfecho ultrapassou a quantidade transferida.', 'err');
        return;
      }

      const payload = {
        qtd_vendida: calc.qtdVendida,
        qtd_devolucao_caixa: calc.qtdDevolucao,
        qtd_venda_cambista: calc.qtdCambista,
        valor_cambista: calc.qtdCambista > 0 ? calc.valorCambista : null,
        qtd_retorno_origem: calc.qtdRetorno,
        updated_at: new Date().toISOString()
      };

      const { error } = await sb
        .from('federal_movimentacoes')
        .update(payload)
        .eq('id', movId);

      if (error) throw error;

      const defaultDevolucao = getDefaultDevolucaoValue(federal);
      const visualDevolucao = num(draft.valor_devolucao_caixa || defaultDevolucao);

      await refresh();

      if (state.selectedFederalId && getFederalById(state.selectedFederalId)) {
        selectFederalCard(state.selectedFederalId, { scroll: false });
        state.expandedDestinoId = String(row.loteria_destino || '');
        renderMovDestinosGrid();
      }

      if (Math.abs(visualDevolucao - defaultDevolucao) > 0.0001) {
        showStatus('st-mov', 'Desfecho salvo. O valor de devolução ficou apenas no cálculo visual do card; o banco continua usando o valor padrão.', 'warn');
      } else {
        showStatus('st-mov', 'Desfecho salvo.', 'ok');
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
      state.movDraft = {};
      state.desfechoDraft = {};
      state.expandedDestinoId = null;

      fillOrigemSelect('');

      if ($('mov-loteria-origem')) $('mov-loteria-origem').value = '';
      if ($('mov-dt-concurso')) $('mov-dt-concurso').value = '';

      renderResumoSelecao();
      renderMovDestinosGrid();
      renderListaFederais();
    });

    $('mov-loteria-origem')?.addEventListener('change', () => {
      const f = getFederalSelecionado();

      if (!f) {
        state.movDraft = {};
        state.desfechoDraft = {};
        state.expandedDestinoId = null;
        renderResumoSelecao();
        renderMovDestinosGrid();
        renderListaFederais();
        return;
      }

      state.selectedFederalId = f.id;

      if ($('mov-modalidade')) $('mov-modalidade').value = 'Federal';
      if ($('mov-dt-concurso')) $('mov-dt-concurso').value = f.dt_sorteio || '';

      renderResumoSelecao();
      renderMovDestinosGrid();
      renderListaFederais();
    });

    $('mov-destinos-grid')?.addEventListener('click', (e) => {
      const saveBtn = e.target.closest('[data-save-desfecho]');
      if (saveBtn) {
        saveDesfecho(saveBtn.dataset.movId);
        return;
      }

      const toggleBtn = e.target.closest('[data-toggle-desfecho]');
      if (!toggleBtn) return;

      const destId = String(toggleBtn.dataset.destId || '');
      state.expandedDestinoId = state.expandedDestinoId === destId ? null : destId;
      renderMovDestinosGrid();
    });

    $('mov-destinos-grid')?.addEventListener('input', (e) => {
      const qtyInput = e.target.closest('[data-dest-input]');
      if (qtyInput) {
        const destId = String(qtyInput.dataset.destId || '');
        if (!destId) return;
        getDraftByDestino(destId).qtd = qtyInput.value;
        return;
      }

      const desfechoInput = e.target.closest('[data-mov-id][data-field]');
      if (desfechoInput) {
        const movId = String(desfechoInput.dataset.movId || '');
        const field = String(desfechoInput.dataset.field || '');
        if (!movId || !field) return;
        if (!state.desfechoDraft[movId]) state.desfechoDraft[movId] = {};
        state.desfechoDraft[movId][field] = desfechoInput.value;
        renderMovDestinosGrid();
      }
    });

    $('btn-salvar-mov')?.addEventListener('click', saveMov);
    $('btn-limpar-mov')?.addEventListener('click', clearMov);

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
