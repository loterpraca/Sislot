(() => {
  const { sb, $, fmtMoney, fmtDate, startClock, showStatus, requireSession, loadFederais, nextWedOrSat, nextQuaSabFrom } = FED_BASE;

  const state = {
    usuario: null,
    federais: [],
    editingCadastroConcurso: null
  };

  const QTD_PADRAO = {
    qua: { centro: 80, boulevard: 80, lotobel: 60, santa: 0, via: 0 },
    sab: { centro: 80, boulevard: 70, lotobel: 120, santa: 0, via: 0 }
  };

  function applyFederalType(tipo) {
    if (tipo === 'ESPECIAL') {
      $('cad-valor-fracao').value = '10.00';
      $('cad-valor-custo').value = '8.04';
    } else {
      $('cad-valor-fracao').value = '4.00';
      $('cad-valor-custo').value = '3.21';
    }
  }

  function suggestNextConcurso() {
    const nums = state.federais.map(f => parseInt(f.concurso, 10)).filter(n => !isNaN(n));
    return nums.length ? String(Math.max(...nums) + 1) : '';
  }

  function suggestNextSorteio() {
    if (!state.federais.length) return nextWedOrSat();
    const dates = state.federais.map(f => f.dt_sorteio).filter(Boolean).sort().reverse();
    return nextQuaSabFrom(dates[0], 1);
  }

  function fillQtdPadraoCadastro() {
    const d = $('cad-dt-sorteio').value ? new Date($('cad-dt-sorteio').value + 'T12:00:00') : new Date();
    const pad = d.getDay() === 6 ? QTD_PADRAO.sab : QTD_PADRAO.qua;
    $('cad-qtd-centro').value = pad.centro;
    $('cad-qtd-boulevard').value = pad.boulevard;
    $('cad-qtd-lotobel').value = pad.lotobel;
    $('cad-qtd-santa').value = pad.santa;
    $('cad-qtd-via').value = pad.via;
  }

  function setCadastroDefaults() {
    state.editingCadastroConcurso = null;
    $('cad-concurso').value = suggestNextConcurso();
    $('cad-dt-sorteio').value = suggestNextSorteio();
    $('cad-tipo').value = 'COMUM';
    applyFederalType('COMUM');
    $('cad-fracoes-bilhete').value = '10';
    fillQtdPadraoCadastro();
  }

  function renderCadastro() {
    const grupos = Object.values(
      state.federais.reduce((acc, f) => {
        if (!acc[f.concurso]) {
          acc[f.concurso] = {
            concurso: f.concurso,
            dt_sorteio: f.dt_sorteio,
            valor_fracao: f.valor_fracao,
            valor_custo: f.valor_custo,
            qt_fracoes_bilhete: f.qt_fracoes_bilhete,
            itens: []
          };
        }
        acc[f.concurso].itens.push(f);
        return acc;
      }, {})
    ).sort((a, b) => String(b.concurso).localeCompare(String(a.concurso), undefined, { numeric: true }));

    $('cnt-cadastros').textContent = grupos.length;

    $('tbody-cadastro').innerHTML = grupos.length ? grupos.map(g => {
      const tipo = Number(g.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM';
      const totalIni = g.itens.reduce((a, x) => a + Number(x.qtd_recebidas || 0), 0);
      const totalDev = g.itens.reduce((a, x) => a + Number(x.qtd_devolvidas || 0), 0);
      const totalEnc = g.itens.reduce((a, x) => a + Number(x.qtd_encalhe || 0), 0);

      return `
        <tr>
          <td>Todos</td>
          <td class="mono">${g.concurso}</td>
          <td class="mono">${fmtDate(g.dt_sorteio)}</td>
          <td><span class="badge ${tipo === 'COMUM' ? 'b-info' : 'b-warn'}">${tipo}</span></td>
          <td class="money">${fmtMoney(g.valor_fracao)}</td>
          <td class="money">${fmtMoney(g.valor_custo)}</td>
          <td class="mono">${totalIni}</td>
          <td class="mono">${totalDev}</td>
          <td class="mono">${totalEnc}</td>
          <td>
            <div class="flex" style="flex-wrap:nowrap;gap:6px">
              <button class="btn-amber" data-action="editar" data-concurso="${g.concurso}">Editar</button>
              <button class="btn-danger" data-action="excluir" data-concurso="${g.concurso}">Excluir</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="10">
          <div class="empty">
            <div class="empty-title">Nenhum concurso cadastrado</div>
          </div>
        </td>
      </tr>
    `;
  }

  async function refreshCadastro() {
    state.federais = await loadFederais();
    renderCadastro();
  }

  async function saveCadastro() {
    try {
      const concurso = $('cad-concurso').value.trim();
      const dt_sorteio = $('cad-dt-sorteio').value;
      const valor_fracao = Number($('cad-valor-fracao').value || 0);
      const valor_custo = Number($('cad-valor-custo').value || 0);
      const qt_fracoes_bilhete = Number($('cad-fracoes-bilhete').value || 10);

      if (!concurso || !dt_sorteio) {
        showStatus('st-cadastro', 'Preencha concurso e data.', 'err');
        return;
      }

      const mapa = [
        { id: 1, qtd: Number($('cad-qtd-centro').value || 0) },
        { id: 2, qtd: Number($('cad-qtd-boulevard').value || 0) },
        { id: 3, qtd: Number($('cad-qtd-lotobel').value || 0) },
        { id: 4, qtd: Number($('cad-qtd-santa').value || 0) },
        { id: 5, qtd: Number($('cad-qtd-via').value || 0) }
      ];

      if (state.editingCadastroConcurso) {
        for (const item of mapa) {
          const { error } = await sb
            .from('federais')
            .update({
              concurso,
              dt_sorteio,
              valor_fracao,
              valor_custo,
              qt_fracoes_bilhete,
              qtd_recebidas: item.qtd,
              updated_at: new Date().toISOString()
            })
            .eq('concurso', state.editingCadastroConcurso)
            .eq('loteria_id', item.id);

          if (error) throw error;
        }

        showStatus('st-cadastro', 'Concurso atualizado em todas as loterias.', 'ok');
      } else {
        for (const item of mapa) {
          const { error } = await sb.from('federais').insert({
            loteria_id: item.id,
            modalidade: 'Federal',
            concurso,
            dt_sorteio,
            valor_fracao,
            valor_custo,
            qt_fracoes_bilhete,
            qtd_recebidas: item.qtd,
            qtd_devolvidas: 0,
            qtd_encalhe: 0,
            ativo: true,
            criado_por: state.usuario?.id || null,
            updated_at: new Date().toISOString()
          });

          if (error) throw error;
        }

        showStatus('st-cadastro', 'Federais cadastradas para todas as loterias.', 'ok');
      }

      await refreshCadastro();
      setCadastroDefaults();
    } catch (e) {
      showStatus('st-cadastro', e.message, 'err');
    }
  }

  function editCadastro(concurso) {
    const itens = state.federais.filter(x => String(x.concurso) === String(concurso));
    const f = itens[0];
    if (!f) return;

    state.editingCadastroConcurso = String(concurso);

    $('cad-concurso').value = f.concurso;
    $('cad-dt-sorteio').value = f.dt_sorteio;
    $('cad-tipo').value = Number(f.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM';
    $('cad-valor-fracao').value = f.valor_fracao;
    $('cad-valor-custo').value = f.valor_custo;
    $('cad-fracoes-bilhete').value = f.qt_fracoes_bilhete;
    $('cad-qtd-centro').value = itens.find(x => x.loteria_id === 1)?.qtd_recebidas || 0;
    $('cad-qtd-boulevard').value = itens.find(x => x.loteria_id === 2)?.qtd_recebidas || 0;
    $('cad-qtd-lotobel').value = itens.find(x => x.loteria_id === 3)?.qtd_recebidas || 0;
    $('cad-qtd-santa').value = itens.find(x => x.loteria_id === 4)?.qtd_recebidas || 0;
    $('cad-qtd-via').value = itens.find(x => x.loteria_id === 5)?.qtd_recebidas || 0;
  }

  async function deleteCadastro(concurso) {
    if (!confirm(`Apagar o concurso ${concurso} em todas as loterias?`)) return;

    try {
      const idsFederais = state.federais
        .filter(x => String(x.concurso) === String(concurso))
        .map(x => x.id);

      if (idsFederais.length) {
        let r;

        r = await sb.from('federal_encalhe_premio').delete().in('federal_id', idsFederais);
        if (r.error) throw r.error;

        r = await sb.from('federal_movimentacoes').delete().in('federal_id', idsFederais);
        if (r.error) throw r.error;

        r = await sb.from('fechamento_federais').delete().in('federal_id', idsFederais);
        if (r.error) throw r.error;
      }

      const { error } = await sb.from('federais').delete().eq('concurso', concurso);
      if (error) throw error;

      if (String(state.editingCadastroConcurso || '') === String(concurso)) {
        state.editingCadastroConcurso = null;
        setCadastroDefaults();
      }

      showStatus('st-cadastro', `Concurso ${concurso} excluído.`, 'ok');
      await refreshCadastro();
    } catch (e) {
      showStatus('st-cadastro', e.message, 'err');
    }
  }

  function bindEvents() {
    $('btn-salvar-cadastro').addEventListener('click', saveCadastro);
    $('btn-limpar-cadastro').addEventListener('click', setCadastroDefaults);
    $('cad-tipo').addEventListener('change', e => applyFederalType(e.target.value));
    $('cad-dt-sorteio').addEventListener('change', fillQtdPadraoCadastro);

    $('cad-data-prev').addEventListener('click', () => {
      $('cad-dt-sorteio').value = nextQuaSabFrom($('cad-dt-sorteio').value || suggestNextSorteio(), -1);
      fillQtdPadraoCadastro();
    });

    $('cad-data-next').addEventListener('click', () => {
      $('cad-dt-sorteio').value = nextQuaSabFrom($('cad-dt-sorteio').value || suggestNextSorteio(), 1);
      fillQtdPadraoCadastro();
    });

    $('tbody-cadastro').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const concurso = btn.dataset.concurso;
      if (btn.dataset.action === 'editar') editCadastro(concurso);
      if (btn.dataset.action === 'excluir') deleteCadastro(concurso);
    });
  }

  async function bootstrap() {
    startClock('relogio');
    state.usuario = await requireSession();
    if (!state.usuario) return;

    await refreshCadastro();
    setCadastroDefaults();
    bindEvents();
  }

  bootstrap();
})();
