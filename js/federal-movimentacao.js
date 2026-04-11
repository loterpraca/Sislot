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
    editingMovId: null
  };

  async function loadMovs() {
    const { data } = await sb
      .from('federal_movimentacoes')
      .select('*, federais!inner(concurso,dt_sorteio,modalidade), usuarios(nome)')
      .order('created_at', { ascending: false });

    state.movimentos = data || [];
  }

  function fillStaticSelects() {
    const lotLabel = x => `${x.id} • ${x.nome}`;
    fillSelect('mov-loteria-origem', state.loterias, 'Selecione...', 'id', lotLabel);
    fillSelect('mov-loteria-destino', state.loterias, 'Selecione...', 'id', lotLabel);
    fillSelect('mov-federal', state.federais, 'Selecione...', 'id', x => x.concurso);
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
    const f = lookupFederal(state.federais, $('mov-federal').value);
    if (!f) return;

    const tipo = $('mov-tipo-evento').value;
    if (tipo === 'DEVOLUCAO_CAIXA') {
      $('mov-valor').value = f.valor_custo;
    } else if (tipo === 'VENDA_CAMBISTA') {
      $('mov-valor').value = '';
    } else {
      $('mov-valor').value = f.valor_fracao;
    }

    const qtd = Number($('mov-qtd').value || 0);
    const valor = Number($('mov-valor').value || 0);
    $('mov-total').value = qtd && valor ? (qtd * valor).toFixed(2) : '';
  }

  function clearMov() {
    state.editingMovId = null;
    $('mov-federal').value = '';
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
    $('mov-resumo-selec').innerHTML = `<div class="empty-title">Selecione um concurso</div><div class="empty-sub">Resumo rápido da origem escolhida.</div>`;
    applyDestinoFilter();
  }

  function renderResumoSelecao() {
    const f = lookupFederal(state.federais, $('mov-federal').value);
    if (!f) {
      $('mov-resumo-selec').innerHTML = `<div class="empty-title">Selecione um concurso</div><div class="empty-sub">Resumo rápido da origem escolhida.</div>`;
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

  function renderMovimentacoes() {
    $('tbody-mov').innerHTML = state.movimentos.length ? state.movimentos.map(m => {
      const total = Number(m.valor_total_real || m.valor_total || (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0)));
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

    state.editingMovId = id;
    $('mov-federal').value = m.federal_id;
    $('mov-modalidade').value = 'Federal';
    $('mov-loteria-origem').value = m.loteria_origem || '';
    $('mov-loteria-destino').value = m.loteria_destino || '';
    $('mov-dt-concurso').value = lookupFederal(state.federais, m.federal_id)?.dt_sorteio || '';
    $('mov-tipo-evento').value = m.tipo_evento || 'TRANSFERENCIA';
    $('mov-qtd').value = m.qtd_fracoes;
    $('mov-valor').value = m.valor_fracao_real || m.valor_fracao || '';
    $('mov-total').value = Number(m.valor_total_real || m.valor_total || (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0))).toFixed(2);
    $('mov-status-acerto').value = m.status_acerto || 'PENDENTE';
    $('mov-observacao').value = m.observacao || '';
    $('btn-excluir-mov').style.display = 'inline-flex';

    renderResumoSelecao();
    applyDestinoFilter();
  }

  async function deleteMov(id = state.editingMovId) {
    if (!id) return;
    if (!confirm('Apagar esta linha de movimentação?')) return;

    try {
      const { error } = await sb.from('federal_movimentacoes').delete().eq('id', id);
      if (error) throw error;

      showStatus('st-mov', 'Movimentação apagada.', 'ok');
      clearMov();
      await refresh();
    } catch (e) {
      showStatus('st-mov', e.message, 'err');
    }
  }

  async function saveMov() {
    try {
      const federal = lookupFederal(state.federais, $('mov-federal').value);
      const valor = Number($('mov-valor').value || 0);
      const qtd = Number($('mov-qtd').value || 0);
      const tipoEvento = $('mov-tipo-evento').value;

      const payload = {
        federal_id: $('mov-federal').value,
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
        data_mov: new Date().toISOString().slice(0, 10),
        observacao: $('mov-observacao').value.trim() || null,
        criado_por: state.usuario?.id || null,
        updated_at: new Date().toISOString(),
        editado_por: state.editingMovId ? state.usuario?.id : null,
        editado_em: state.editingMovId ? new Date().toISOString() : null
      };

      if (!payload.federal_id || !payload.tipo_evento || !payload.qtd_fracoes || !payload.loteria_origem) {
        showStatus('st-mov', 'Preencha concurso, origem, evento e quantidade.', 'err');
        return;
      }

      if (payload.tipo_evento === 'TRANSFERENCIA' && !payload.loteria_destino) {
        showStatus('st-mov', 'Selecione a loja destino.', 'err');
        return;
      }

      if (state.editingMovId) {
        const { error } = await sb.from('federal_movimentacoes').update(payload).eq('id', state.editingMovId);
        if (error) throw error;
        showStatus('st-mov', 'Movimentação atualizada.', 'ok');
      } else {
        const { error } = await sb.from('federal_movimentacoes').insert(payload);
        if (error) throw error;
        showStatus('st-mov', 'Movimentação registrada.', 'ok');
      }

      clearMov();
      await refresh();
    } catch (e) {
      showStatus('st-mov', e.message, 'err');
    }
  }

  async function refresh() {
    state.federais = await loadFederais();
    await loadMovs();
    fillStaticSelects();
    renderMovimentacoes();
  }

  function bindEvents() {
    $('mov-federal').addEventListener('change', () => {
      const f = lookupFederal(state.federais, $('mov-federal').value);
      if (!f) return;

      $('mov-modalidade').value = 'Federal';
      $('mov-loteria-origem').value = f.loteria_id;
      $('mov-dt-concurso').value = f.dt_sorteio;
      applyDestinoFilter();
      syncMovValorByTipo();
      renderResumoSelecao();
    });

    $('mov-loteria-origem').addEventListener('change', applyDestinoFilter);
    $('mov-tipo-evento').addEventListener('change', syncMovValorByTipo);

    ['mov-qtd', 'mov-valor'].forEach(id => {
      $(id).addEventListener('input', () => {
        const qtd = Number($('mov-qtd').value || 0);
        const valor = Number($('mov-valor').value || 0);
        $('mov-total').value = qtd && valor ? (qtd * valor).toFixed(2) : '';
      });
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
  }

  async function bootstrap() {
    startClock('relogio');
    state.usuario = await requireSession();
    if (!state.usuario) return;

    state.loterias = await loadLoterias();
    await refresh();
    clearMov();
    bindEvents();
  }

  bootstrap();
})();
