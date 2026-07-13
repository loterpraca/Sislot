(() => {
  'use strict';

  const {
    sb,
    $,
    fmtMoney,
    fmtDate,
    startClock,
    showStatus,
    requireSession,
    loadLoterias,
    loadFederais,
    nextWedOrSat,
    nextQuaSabFrom
  } = FED_BASE;

  const state = {
    usuario: null,
    loterias: [],
    federais: [],
    parametrosRecebimento: [],
    editingCadastroConcurso: null
  };

  function aplicarTipoFederal(tipo) {
    if (tipo === 'ESPECIAL') {
      $('cad-valor-fracao').value = '10.00';
      $('cad-valor-custo').value = '8.04';
    } else {
      $('cad-valor-fracao').value = '4.00';
      $('cad-valor-custo').value = '3.21';
    }
  }

  async function carregarParametrosRecebimento() {
    const { data, error } = await sb
      .from('federal_parametros_recebimento')
      .select('regra, loteria_id, qtd_recebida, ativo')
      .eq('ativo', true);

    if (error) throw error;
    state.parametrosRecebimento = data || [];
  }

  function getRegraRecebimento() {
    const tipo = $('cad-tipo')?.value || 'COMUM';

    if (tipo === 'ESPECIAL') {
      return 'ESPECIAL';
    }

    const rawDate = $('cad-dt-sorteio')?.value;
    const data = rawDate
      ? new Date(`${rawDate}T12:00:00`)
      : new Date();

    return data.getDay() === 6
      ? 'SABADO_COMUM'
      : 'QUARTA_COMUM';
  }

  function getQtdRecebimentoPorLoja(regra, loteriaId) {
    const row = state.parametrosRecebimento.find(item =>
      item.regra === regra &&
      Number(item.loteria_id) === Number(loteriaId)
    );

    return Number(row?.qtd_recebida || 0);
  }

  function getInputQtdId(loteriaId) {
    return `cad-qtd-loja-${Number(loteriaId)}`;
  }

  function localizarOuCriarGradeLojas() {
    let grid = $('cad-qtd-lojas-grid');
    if (grid) return grid;

    // Compatibilidade com o HTML antigo, que possui cinco campos fixos.
    const legacyInput =
      $('cad-qtd-centro') ||
      $('cad-qtd-boulevard') ||
      $('cad-qtd-lotobel') ||
      $('cad-qtd-santa') ||
      $('cad-qtd-via');

    if (legacyInput) {
      grid = legacyInput.closest('.grid-5') || legacyInput.parentElement?.parentElement;
      if (grid) {
        grid.id = 'cad-qtd-lojas-grid';
        return grid;
      }
    }

    // Fallback: cria a grade depois do separador "Qtd inicial por loteria".
    const separador = Array.from(document.querySelectorAll('.sep')).find(el =>
      String(el.textContent || '').toLowerCase().includes('qtd inicial por loteria')
    );

    if (!separador) {
      throw new Error(
        'Não foi possível localizar a área de quantidades por loteria no HTML.'
      );
    }

    grid = document.createElement('div');
    grid.id = 'cad-qtd-lojas-grid';
    grid.className = 'grid-5';
    grid.style.marginTop = '14px';
    separador.insertAdjacentElement('afterend', grid);

    return grid;
  }

  function lerValoresAtuaisDaGrade(grid) {
    const valores = {};

    grid.querySelectorAll('input[data-loteria-id]').forEach(input => {
      valores[String(input.dataset.loteriaId)] = input.value;
    });

    return valores;
  }

  function renderizarCamposLojas(valoresPorLoteria = null) {
    const grid = localizarOuCriarGradeLojas();
    const valoresAtuais = lerValoresAtuaisDaGrade(grid);
    const valores = valoresPorLoteria || valoresAtuais;

    grid.innerHTML = '';

    if (!state.loterias.length) {
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <div class="empty-title">Nenhuma loteria ativa encontrada</div>
        </div>
      `;
      return;
    }

    state.loterias.forEach(loteria => {
      const field = document.createElement('div');
      field.className = 'field';

      const label = document.createElement('label');
      label.className = 'field-label';
      label.textContent = loteria.nome || `Loja ${loteria.id}`;

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.id = getInputQtdId(loteria.id);
      input.dataset.loteriaId = String(loteria.id);
      input.dataset.loteriaSlug = String(loteria.slug || '');

      const valor = valores?.[String(loteria.id)];
      input.value = valor ?? 0;

      field.appendChild(label);
      field.appendChild(input);
      grid.appendChild(field);
    });
  }

  function preencherQtdPadraoCadastro() {
    const regra = getRegraRecebimento();
    const valores = {};

    state.loterias.forEach(loteria => {
      valores[String(loteria.id)] =
        getQtdRecebimentoPorLoja(regra, loteria.id);
    });

    renderizarCamposLojas(valores);
  }

  function coletarQtdPorLoja() {
    return state.loterias.map(loteria => {
      const input = $(getInputQtdId(loteria.id));

      return {
        id: Number(loteria.id),
        nome: loteria.nome || `Loja ${loteria.id}`,
        qtd: Math.max(0, Math.trunc(Number(input?.value || 0)))
      };
    });
  }

  function sugerirProximoConcurso() {
    const nums = state.federais
      .map(f => parseInt(f.concurso, 10))
      .filter(Number.isFinite);

    return nums.length
      ? String(Math.max(...nums) + 1)
      : '';
  }

  function sugerirProximoSorteio() {
    if (!state.federais.length) {
      return nextWedOrSat();
    }

    const dates = state.federais
      .map(f => f.dt_sorteio)
      .filter(Boolean)
      .sort()
      .reverse();

    return nextQuaSabFrom(dates[0], 1);
  }

  function setCadastroDefaults() {
    state.editingCadastroConcurso = null;

    $('cad-concurso').value = sugerirProximoConcurso();
    $('cad-dt-sorteio').value = sugerirProximoSorteio();
    $('cad-tipo').value = 'COMUM';
    aplicarTipoFederal('COMUM');
    $('cad-fracoes-bilhete').value = '10';

    preencherQtdPadraoCadastro();
  }

  function renderCadastro() {
    const grupos = Object.values(
      state.federais.reduce((acc, federal) => {
        if (!acc[federal.concurso]) {
          acc[federal.concurso] = {
            concurso: federal.concurso,
            dt_sorteio: federal.dt_sorteio,
            tipo:
              federal.tipo ||
              (Number(federal.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM'),
            valor_fracao: federal.valor_fracao,
            valor_custo: federal.valor_custo,
            qt_fracoes_bilhete: federal.qt_fracoes_bilhete,
            itens: []
          };
        }

        acc[federal.concurso].itens.push(federal);
        return acc;
      }, {})
    ).sort((a, b) =>
      String(b.concurso).localeCompare(
        String(a.concurso),
        undefined,
        { numeric: true }
      )
    );

    $('cnt-cadastros').textContent = grupos.length;

    $('tbody-cadastro').innerHTML = grupos.length
      ? grupos.map(grupo => {
          const tipo = grupo.tipo || 'COMUM';

          const totalIni = grupo.itens.reduce(
            (acc, item) => acc + Number(item.qtd_recebidas || 0),
            0
          );

          const totalDev = grupo.itens.reduce(
            (acc, item) => acc + Number(item.qtd_devolvidas || 0),
            0
          );

          const totalEnc = grupo.itens.reduce(
            (acc, item) => acc + Number(item.qtd_encalhe || 0),
            0
          );

          const qtdLojas = grupo.itens.length;

          return `
            <tr>
              <td>${qtdLojas} loja${qtdLojas === 1 ? '' : 's'}</td>
              <td class="mono">${grupo.concurso}</td>
              <td class="mono">${fmtDate(grupo.dt_sorteio)}</td>
              <td>
                <span class="badge ${tipo === 'COMUM' ? 'b-info' : 'b-warn'}">
                  ${tipo}
                </span>
              </td>
              <td class="money">${fmtMoney(grupo.valor_fracao)}</td>
              <td class="money">${fmtMoney(grupo.valor_custo)}</td>
              <td class="mono">${totalIni}</td>
              <td class="mono">${totalDev}</td>
              <td class="mono">${totalEnc}</td>
              <td>
                <div class="flex" style="flex-wrap:nowrap;gap:6px">
                  <button
                    class="btn-amber"
                    data-action="editar"
                    data-concurso="${grupo.concurso}"
                  >
                    Editar
                  </button>
                  <button
                    class="btn-danger"
                    data-action="excluir"
                    data-concurso="${grupo.concurso}"
                  >
                    Excluir
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('')
      : `
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

  function montarPayloadBase({
    loteriaId,
    concurso,
    dtSorteio,
    tipo,
    valorFracao,
    valorCusto,
    qtdFracoesBilhete,
    qtdRecebidas
  }) {
    return {
      loteria_id: Number(loteriaId),
      modalidade: 'Federal',
      concurso,
      dt_sorteio: dtSorteio,
      tipo,
      valor_fracao: valorFracao,
      valor_custo: valorCusto,
      qt_fracoes_bilhete: qtdFracoesBilhete,
      qtd_recebidas: qtdRecebidas,
      ativo: true,
      updated_at: new Date().toISOString()
    };
  }

  async function salvarLojaDoConcurso({
    item,
    concurso,
    dtSorteio,
    tipo,
    valorFracao,
    valorCusto,
    qtdFracoesBilhete
  }) {
    const payload = montarPayloadBase({
      loteriaId: item.id,
      concurso,
      dtSorteio,
      tipo,
      valorFracao,
      valorCusto,
      qtdFracoesBilhete,
      qtdRecebidas: item.qtd
    });

    const concursoEditado = state.editingCadastroConcurso;

    const existenteAnterior = concursoEditado
      ? state.federais.find(f =>
          String(f.concurso) === String(concursoEditado) &&
          Number(f.loteria_id) === Number(item.id)
        )
      : null;

    const existenteNovo = state.federais.find(f =>
      String(f.concurso) === String(concurso) &&
      Number(f.loteria_id) === Number(item.id)
    );

    const existente = existenteAnterior || existenteNovo;

    if (existente?.id) {
      const { error } = await sb
        .from('federais')
        .update(payload)
        .eq('id', existente.id);

      if (error) throw error;
      return;
    }

    const { error } = await sb
      .from('federais')
      .insert({
        ...payload,
        qtd_devolvidas: 0,
        qtd_encalhe: 0,
        criado_por: state.usuario?.id || null
      });

    if (error) throw error;
  }

  async function saveCadastro() {
    try {
      const concurso = $('cad-concurso').value.trim();
      const dtSorteio = $('cad-dt-sorteio').value;
      const tipo = $('cad-tipo').value;
      const valorFracao = Number($('cad-valor-fracao').value || 0);
      const valorCusto = Number($('cad-valor-custo').value || 0);
      const qtdFracoesBilhete = Number(
        $('cad-fracoes-bilhete').value || 10
      );

      if (!concurso || !dtSorteio) {
        showStatus(
          'st-cadastro',
          'Preencha concurso e data.',
          'err'
        );
        return;
      }

      if (!state.loterias.length) {
        showStatus(
          'st-cadastro',
          'Nenhuma loteria ativa encontrada.',
          'err'
        );
        return;
      }

      const mapa = coletarQtdPorLoja();

      for (const item of mapa) {
        await salvarLojaDoConcurso({
          item,
          concurso,
          dtSorteio,
          tipo,
          valorFracao,
          valorCusto,
          qtdFracoesBilhete
        });
      }

      showStatus(
        'st-cadastro',
        state.editingCadastroConcurso
          ? 'Concurso atualizado em todas as loterias ativas.'
          : 'Federal cadastrada para todas as loterias ativas.',
        'ok'
      );

      await refreshCadastro();
      setCadastroDefaults();
    } catch (error) {
      showStatus(
        'st-cadastro',
        error?.message || 'Erro ao salvar concurso.',
        'err'
      );
    }
  }

  function editCadastro(concurso) {
    const itens = state.federais.filter(
      item => String(item.concurso) === String(concurso)
    );

    const federal = itens[0];
    if (!federal) return;

    state.editingCadastroConcurso = String(concurso);

    $('cad-concurso').value = federal.concurso;
    $('cad-dt-sorteio').value = federal.dt_sorteio;
    $('cad-tipo').value =
      federal.tipo ||
      (Number(federal.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM');

    $('cad-valor-fracao').value = federal.valor_fracao;
    $('cad-valor-custo').value = federal.valor_custo;
    $('cad-fracoes-bilhete').value =
      federal.qt_fracoes_bilhete;

    const valoresPorLoteria = {};

    state.loterias.forEach(loteria => {
      const item = itens.find(
        row => Number(row.loteria_id) === Number(loteria.id)
      );

      valoresPorLoteria[String(loteria.id)] =
        Number(item?.qtd_recebidas || 0);
    });

    renderizarCamposLojas(valoresPorLoteria);
  }

  async function deleteCadastro(concurso) {
    const concursoTrim = String(concurso || '').trim();
    if (!concursoTrim) return;

    if (
      !confirm(
        `Excluir o concurso ${concursoTrim} em todas as loterias?`
      )
    ) {
      return;
    }

    try {
      const { data, error } = await sb.rpc(
        'rpc_federal_validar_exclusao_concurso',
        { p_concurso: concursoTrim }
      );

      if (error) throw error;

      const info = Array.isArray(data) ? data[0] : data;

      if (!info) {
        showStatus(
          'st-cadastro',
          'Não foi possível validar a exclusão.',
          'err'
        );
        return;
      }

      if (!info.pode_excluir) {
        showStatus(
          'st-cadastro',
          `Exclusão bloqueada: ${info.motivo}`,
          'err'
        );
        return;
      }

      const { error: deleteError } = await sb
        .from('federais')
        .delete()
        .eq('concurso', concursoTrim);

      if (deleteError) throw deleteError;

      if (
        String(state.editingCadastroConcurso || '').trim() ===
        concursoTrim
      ) {
        state.editingCadastroConcurso = null;
        setCadastroDefaults();
      }

      showStatus(
        'st-cadastro',
        `Concurso ${concursoTrim} excluído.`,
        'ok'
      );

      await refreshCadastro();
    } catch (error) {
      showStatus(
        'st-cadastro',
        error?.message || 'Erro ao excluir concurso.',
        'err'
      );
    }
  }

  function bindEvents() {
    $('btn-salvar-cadastro')?.addEventListener(
      'click',
      saveCadastro
    );

    $('btn-limpar-cadastro')?.addEventListener(
      'click',
      setCadastroDefaults
    );

    $('cad-tipo')?.addEventListener('change', event => {
      aplicarTipoFederal(event.target.value);
      preencherQtdPadraoCadastro();
    });

    $('cad-dt-sorteio')?.addEventListener('change', () => {
      preencherQtdPadraoCadastro();
    });

    $('cad-data-prev')?.addEventListener('click', () => {
      $('cad-dt-sorteio').value = nextQuaSabFrom(
        $('cad-dt-sorteio').value || sugerirProximoSorteio(),
        -1
      );

      preencherQtdPadraoCadastro();
    });

    $('cad-data-next')?.addEventListener('click', () => {
      $('cad-dt-sorteio').value = nextQuaSabFrom(
        $('cad-dt-sorteio').value || sugerirProximoSorteio(),
        1
      );

      preencherQtdPadraoCadastro();
    });

    $('tbody-cadastro')?.addEventListener('click', event => {
      const button = event.target.closest(
        'button[data-action]'
      );

      if (!button) return;

      const concurso = button.dataset.concurso;

      if (button.dataset.action === 'editar') {
        editCadastro(concurso);
      }

      if (button.dataset.action === 'excluir') {
        deleteCadastro(concurso);
      }
    });
  }

  async function bootstrap() {
    try {
      startClock('relogio');

      state.usuario = await requireSession();
      if (!state.usuario) return;

      state.loterias = (await loadLoterias())
        .filter(loteria => loteria.ativo !== false);

      renderizarCamposLojas();

      await carregarParametrosRecebimento();
      await refreshCadastro();

      setCadastroDefaults();
      bindEvents();
    } catch (error) {
      showStatus(
        'st-cadastro',
        error?.message ||
          'Erro ao inicializar cadastro federal.',
        'err'
      );
    }
  }

  bootstrap();
})();
