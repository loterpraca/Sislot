(() => {
  const {
    sb, $, fmtMoney, fmtDate, startClock, showStatus, fillSelect,
    requireSession, loadLoterias, loadFederais, lookupLoteriaName
  } = FED_BASE;

  const state = {
    usuario: null,
    loterias: [],
    federais: [],
    resumo: [],
    movimentos: [],
    vendasFuncionario: [],
    lancFederalId: null
  };

  async function loadResumo() {
    const { data, error } = await sb
      .from('view_resumo_federal')
      .select('*')
      .order('dt_sorteio', { ascending: false })
      .order('concurso', { ascending: false });

    state.resumo = error ? [] : (data || []);
  }

  async function loadMovs() {
    const { data } = await sb
      .from('federal_movimentacoes')
      .select('*, federais!inner(concurso,dt_sorteio,modalidade), usuarios(nome)')
      .order('created_at', { ascending: false });

    state.movimentos = data || [];
  }

  async function loadVendasFuncionario() {
    const { data } = await sb
      .from('view_federal_vendas_funcionario')
      .select('*')
      .order('dt_sorteio', { ascending: false })
      .order('funcionario_nome');

    state.vendasFuncionario = data || [];
  }

  function renderKPIs(rows) {
    const totalInicial = rows.reduce((a, x) => a + Number(x.qtd_inicial || 0), 0);
    const totalVendida = rows.reduce((a, x) => a + Number(x.qtd_vendida_total || 0), 0);
    const totalDev = rows.reduce((a, x) => a + Number(x.qtd_devolvida_origem || 0) + Number(x.qtd_devolvida_terceiros || 0), 0);
    const totalEnc = rows.reduce((a, x) => a + Number(x.qtd_encalhe || 0), 0);
    const totalPrem = rows.reduce((a, x) => a + Number(x.premio_encalhe_total || 0), 0);
    const totalRes = rows.reduce((a, x) => a + Number(x.resultado || 0), 0);

    $('kpis-visao').innerHTML = [
      ['Qtd Inicial', totalInicial, 'Carga base'],
      ['Vendida', totalVendida, 'Funcionários + externa'],
      ['Devolvida', totalDev, 'Origem + terceiros'],
      ['Encalhe', totalEnc, 'Qtd restante sem venda'],
      ['Prêmio', fmtMoney(totalPrem), 'Total de prêmio'],
      ['Resultado', fmtMoney(totalRes), 'Apuração geral']
    ].map(([l, v, s]) => `
      <div class="kpi">
        <div class="kpi-label">${l}</div>
        <div class="kpi-value">${v}</div>
        <div class="kpi-sub">${s}</div>
      </div>
    `).join('');
  }

  function renderVisao() {
    let rows = [...state.resumo];

    const c = $('filtro-concurso').value.trim();
    const loja = $('filtro-loja').value;
    const di = $('filtro-dt-ini').value;
    const df = $('filtro-dt-fim').value;

    if (c) rows = rows.filter(x => String(x.concurso).includes(c));
    if (loja) rows = rows.filter(x => String(x.loteria_id) === String(loja));
    if (di) rows = rows.filter(x => x.dt_sorteio >= di);
    if (df) rows = rows.filter(x => x.dt_sorteio <= df);

    renderKPIs(rows);

    $('tbody-visao').innerHTML = rows.length ? rows.map(r => {
      const res = Number(r.resultado || 0);

      return `
        <tr>
          <td>${r.modalidade || 'Federal'}</td>
          <td>${r.loja_origem}</td>
          <td class="mono">${r.concurso}</td>
          <td class="mono">${fmtDate(r.dt_sorteio)}</td>
          <td class="mono">${r.qtd_inicial}</td>
          <td class="mono">${r.qtd_vendida_funcionarios}</td>
          <td class="mono">${r.qtd_vendida_externa}</td>
          <td class="mono">${r.qtd_devolvida_origem}</td>
          <td class="mono">${r.qtd_devolvida_terceiros}</td>
          <td class="mono">${r.qtd_encalhe}</td>
          <td class="money">${fmtMoney(r.premio_encalhe_total)}</td>
          <td class="mono">${r.estoque_atual}</td>
          <td class="money ${res >= 0 ? 'pos' : 'neg'}">${fmtMoney(res)}</td>
          <td>
            <div class="flex" style="flex-wrap:nowrap;gap:6px">
              <button class="btn-amber" data-action="detalhar" data-id="${r.federal_id}">Detalhar</button>
              <button class="btn-secondary" data-action="lancar" data-id="${r.federal_id}">Lançamento</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="14">
          <div class="empty">
            <div class="empty-title">Nada encontrado</div>
            <div class="empty-sub">Ajuste os filtros.</div>
          </div>
        </td>
      </tr>
    `;
  }

  function openDrawer(title, sub, bodyHtml, actions = []) {
    $('drawer-title').textContent = title;
    $('drawer-sub').textContent = sub;
    $('drawer-body').innerHTML = bodyHtml;
    $('drawer-foot').innerHTML = '';

    actions.forEach(a => {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.className = a.kind === 'amber' ? 'btn-amber' : 'btn-secondary';
      b.onclick = a.onClick;
      $('drawer-foot').appendChild(b);
    });

    $('overlay').classList.add('show');
    $('drawer').classList.add('open');
  }

  function closeDrawer() {
    $('overlay').classList.remove('show');
    $('drawer').classList.remove('open');
  }

  function openLancamento(federalId) {
    const f = state.federais.find(x => String(x.id) === String(federalId));
    if (!f) return;

    state.lancFederalId = federalId;
    $('lanc-modalidade').value = 'Federal';
    $('lanc-concurso').value = f.concurso;
    $('lanc-data').value = f.dt_sorteio;
    $('lanc-loja').value = lookupLoteriaName(state.loterias, f.loteria_id);
    $('lanc-qtd-dev').value = f.qtd_devolvidas || 0;
    $('lanc-qtd-enc').value = f.qtd_encalhe || 0;
    $('lanc-vlr-premio').value = '';
    $('lanc-obs').value = '';

    $('overlay-lanc').classList.add('show');
    $('drawer-lanc').classList.add('open');
  }

  function closeLancamento() {
    $('overlay-lanc').classList.remove('show');
    $('drawer-lanc').classList.remove('open');
    state.lancFederalId = null;
  }

  async function saveLancamento() {
    try {
      if (!state.lancFederalId) return;

      const qtdDev = Number($('lanc-qtd-dev').value || 0);
      const qtdEnc = Number($('lanc-qtd-enc').value || 0);
      const premio = Number($('lanc-vlr-premio').value || 0);
      const obs = $('lanc-obs').value.trim() || null;

      let r = await sb.from('federais').update({
        qtd_devolvidas: qtdDev,
        qtd_encalhe: qtdEnc,
        updated_at: new Date().toISOString()
      }).eq('id', state.lancFederalId);

      if (r.error) throw r.error;

      if (premio > 0) {
        const busca = await sb
          .from('federal_encalhe_premio')
          .select('id')
          .eq('federal_id', state.lancFederalId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (busca.error) throw busca.error;

        if (busca.data && busca.data.length) {
          r = await sb.from('federal_encalhe_premio').update({
            qtd_fracoes_premiadas: qtdEnc || 1,
            valor_premio: premio,
            observacao: obs,
            data_registro: new Date().toISOString().slice(0, 10)
          }).eq('id', busca.data[0].id);

          if (r.error) throw r.error;
        } else {
          r = await sb.from('federal_encalhe_premio').insert({
            federal_id: state.lancFederalId,
            qtd_fracoes_premiadas: qtdEnc || 1,
            valor_premio: premio,
            observacao: obs,
            criado_por: state.usuario?.id || null
          });

          if (r.error) throw r.error;
        }
      }

      showStatus('st-visao', 'Lançamento salvo.', 'ok');
      closeLancamento();
      await refresh();
    } catch (e) {
      showStatus('st-visao', e.message, 'err');
    }
  }

  function openFederalDetail(federalId) {
    const resumo = state.resumo.find(x => String(x.federal_id) === String(federalId));
    const vendas = state.vendasFuncionario.filter(x => String(x.federal_id) === String(federalId));
    const movs = state.movimentos.filter(x => String(x.federal_id) === String(federalId));

    openDrawer(
      `Federal ${resumo?.concurso || ''}`,
      `${resumo?.loja_origem || ''} • ${fmtDate(resumo?.dt_sorteio)}`,
      `
        <div class="card" style="margin-bottom:14px">
          <div class="inline-pills">
            <span class="pill">Qtd inicial ${resumo?.qtd_inicial ?? 0}</span>
            <span class="pill">Vend. func ${resumo?.qtd_vendida_funcionarios ?? 0}</span>
            <span class="pill">Vend. externa ${resumo?.qtd_vendida_externa ?? 0}</span>
            <span class="pill">Dev. origem ${resumo?.qtd_devolvida_origem ?? 0}</span>
            <span class="pill">Dev. terceiros ${resumo?.qtd_devolvida_terceiros ?? 0}</span>
            <span class="pill">Encalhe ${resumo?.qtd_encalhe ?? 0}</span>
            <span class="pill">Resultado ${fmtMoney(resumo?.resultado || 0)}</span>
          </div>
        </div>

        <div class="sep"><span class="sep-label">Vendas por funcionário</span><div class="sep-line"></div></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Funcionário</th><th>Qtd</th><th>Total</th></tr></thead>
            <tbody>
              ${vendas.length ? vendas.map(v => `
                <tr>
                  <td>${v.funcionario_nome}</td>
                  <td class="mono">${v.qtd_vendida}</td>
                  <td class="money">${fmtMoney(v.total_vendido)}</td>
                </tr>
              `).join('') : `<tr><td colspan="3" class="muted">Sem vendas lançadas</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="sep"><span class="sep-label">Eventos</span><div class="sep-line"></div></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Evento</th><th>Origem</th><th>Destino</th><th>Qtd</th><th>Total</th></tr></thead>
            <tbody>
              ${movs.length ? movs.map(m => `
                <tr>
                  <td>${m.tipo_evento || m.tipo}</td>
                  <td>${lookupLoteriaName(state.loterias, m.loteria_origem)}</td>
                  <td>${m.loteria_destino ? lookupLoteriaName(state.loterias, m.loteria_destino) : '—'}</td>
                  <td class="mono">${m.qtd_fracoes}</td>
                  <td class="money">${fmtMoney(m.valor_total_real || m.valor_total || (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0)))}</td>
                </tr>
              `).join('') : `<tr><td colspan="5" class="muted">Sem eventos</td></tr>`}
            </tbody>
          </table>
        </div>
      `,
      [{ label: 'Fechar', kind: 'secondary', onClick: closeDrawer }]
    );
  }

  async function refresh() {
    state.federais = await loadFederais();
    await Promise.all([loadResumo(), loadMovs(), loadVendasFuncionario()]);
    fillSelect('filtro-loja', state.loterias, 'Todas / selecione...', 'id', x => `${x.id} • ${x.nome}`);
    renderVisao();
  }

  function bindEvents() {
    $('btn-filtrar-visao').addEventListener('click', renderVisao);

    $('btn-limpar-visao').addEventListener('click', () => {
      ['filtro-concurso', 'filtro-loja', 'filtro-dt-ini', 'filtro-dt-fim'].forEach(id => $(id).value = '');
      renderVisao();
    });

    $('btn-recarregar-visao').addEventListener('click', refresh);

    $('tbody-visao').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const id = btn.dataset.id;
      if (btn.dataset.action === 'detalhar') openFederalDetail(id);
      if (btn.dataset.action === 'lancar') openLancamento(id);
    });

    $('overlay').addEventListener('click', closeDrawer);
    $('btn-close-drawer').addEventListener('click', closeDrawer);

    $('overlay-lanc').addEventListener('click', closeLancamento);
    $('btn-close-lanc').addEventListener('click', closeLancamento);
    $('btn-cancel-lanc').addEventListener('click', closeLancamento);
    $('btn-save-lanc').addEventListener('click', saveLancamento);
  }

  async function bootstrap() {
    startClock('relogio');
    state.usuario = await requireSession();
    if (!state.usuario) return;

    state.loterias = await loadLoterias();
    await refresh();
    bindEvents();
  }

  bootstrap();
})();
