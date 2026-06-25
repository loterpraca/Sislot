/**
 * SISLOT — Painel de Atalhos de Bolões
 * CRUD da tabela public.modelos_boloes
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

const $ = (id) => document.getElementById(id);

const PERFIS_EDITOR = ['ADMIN', 'SOCIO', 'GERENTE'];
const MAX_ATALHOS = 15;

const MODALIDADES = [
    'Mega Sena',
    'Lotofácil',
    'Quina',
    'Dia de Sorte',
    'Timemania',
    'Dupla Sena',
    'Supersete',
    'Milionária',
    'Loteca',
    'Páscoa',
    'Independência',
    'Virada',
    'São João'
];

const LOJA_TEMA = {
    boulevard: 'boulevard',
    centro: 'centro',
    lotobel: 'lotobel',
    'santa-tereza': 'santa-tereza',
    'via-brasil': 'via-brasil'
};

const state = {
    usuario: null,
    lojas: [],
    atalhos: [],
    salvando: false,
    copiando: false
};

function setStatus(mensagem, tipo = 'muted', icone = 'info-circle') {
    const el = $('status');
    if (!el) return;

    el.className = `status ${tipo}`;
    el.innerHTML = `<i class="fas fa-${icone}"></i><span>${escapeHtml(mensagem)}</span>`;
}

function setLoading(botao, ativo) {
    if (!botao) return;
    botao.disabled = ativo;
    botao.dataset.originalHtml ||= botao.innerHTML;

    if (ativo) {
        botao.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aguarde';
    } else {
        botao.innerHTML = botao.dataset.originalHtml;
    }
}

function escapeHtml(valor) {
    return String(valor ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function parseDecimalBR(valor) {
    const texto = String(valor ?? '')
        .replace(/[R$\s]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');

    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : 0;
}

function formatarDecimalBR(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatarBRL(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function lojaSelecionada() {
    const id = Number($('filtroLoja')?.value || 0);
    return state.lojas.find(loja => Number(loja.loteria_id) === id) || null;
}

function modalidadeSelecionada() {
    return $('filtroModalidade')?.value || '';
}

function atalhosFiltrados() {
    const lojaId = Number($('filtroLoja')?.value || 0);
    const modalidade = modalidadeSelecionada();

    return state.atalhos
        .filter(item =>
            Number(item.loteria_id) === lojaId &&
            item.modalidade === modalidade
        )
        .sort((a, b) => Number(a.ordem) - Number(b.ordem));
}

function aplicarTemaLoja() {
    const loja = lojaSelecionada();
    const slug = loja?.loteria_slug || 'centro';
    document.body.setAttribute('data-loja', LOJA_TEMA[slug] || 'centro');
}

async function init() {
    try {
        const ctx = await window.SISLOT_SECURITY.protegerPagina('cadastro');
        if (!ctx) return;

        state.usuario = ctx.usuario || null;

        const perfil = String(state.usuario?.perfil || '').toUpperCase();
        if (!PERFIS_EDITOR.includes(perfil)) {
            alert('Seu perfil não possui permissão para editar atalhos.');
            window.SISLOT_SECURITY.irParaInicio();
            return;
        }

        state.lojas = await window.SISLOT_SECURITY.carregarTodasLojas();

        preencherFiltros();
        preencherOrdens();
        bind();

        await carregarAtalhos();

        setStatus('Atalhos carregados.', 'ok', 'check-circle');
    } catch (erro) {
        console.error('Erro na inicialização:', erro);
        setStatus(
            erro?.message || 'Erro ao iniciar o painel de atalhos.',
            'err',
            'exclamation-circle'
        );
    }
}

function preencherFiltros() {
    const filtroLoja = $('filtroLoja');
    const filtroModalidade = $('filtroModalidade');

    filtroLoja.innerHTML = '';
    state.lojas.forEach(loja => {
        const option = document.createElement('option');
        option.value = loja.loteria_id;
        option.textContent = loja.loteria_nome;
        filtroLoja.appendChild(option);
    });

    filtroModalidade.innerHTML = '';
    MODALIDADES.forEach(modalidade => {
        const option = document.createElement('option');
        option.value = modalidade;
        option.textContent = modalidade;
        filtroModalidade.appendChild(option);
    });

    const lojaPreferida = state.lojas.find(loja => loja.loteria_slug === 'centro');
    if (lojaPreferida) {
        filtroLoja.value = String(lojaPreferida.loteria_id);
    }
}

function preencherOrdens() {
    const select = $('atalhoOrdem');
    select.innerHTML = '';

    for (let ordem = 1; ordem <= MAX_ATALHOS; ordem += 1) {
        const option = document.createElement('option');
        option.value = String(ordem);
        option.textContent = `Posição ${ordem}`;
        select.appendChild(option);
    }
}

async function carregarAtalhos() {
    setStatus('Carregando atalhos...', 'muted', 'spinner fa-spin');

    const { data, error } = await sb
        .from('modelos_boloes')
        .select(`
            id,
            loteria_id,
            modalidade,
            nome,
            qtd_jogos,
            qtd_dezenas,
            valor_cota,
            qtd_cotas,
            ordem,
            ativo,
            created_at,
            updated_at
        `)
        .order('loteria_id', { ascending: true })
        .order('modalidade', { ascending: true })
        .order('ordem', { ascending: true });

    if (error) {
        throw new Error(`Erro ao carregar atalhos: ${error.message}`);
    }

    state.atalhos = data || [];
    render();
}

function render() {
    aplicarTemaLoja();
    renderResumo();
    renderSlots();
}

function renderResumo() {
    const lista = atalhosFiltrados();
    const ativos = lista.filter(item => item.ativo).length;
    const ocupadas = new Set(lista.map(item => Number(item.ordem))).size;
    const vagas = Math.max(0, MAX_ATALHOS - ocupadas);

    $('resumoAtivos').textContent =
        `${ativos} ${ativos === 1 ? 'ativo' : 'ativos'}`;

    $('resumoVagas').textContent =
        `${vagas} ${vagas === 1 ? 'vaga disponível' : 'vagas disponíveis'}`;

    const loja = lojaSelecionada();
    $('listaContexto').textContent =
        `${loja?.loteria_nome || '—'} · ${modalidadeSelecionada() || '—'}`;
}

function renderSlots() {
    const grid = $('slotsGrid');
    const lista = atalhosFiltrados();
    const porOrdem = new Map(lista.map(item => [Number(item.ordem), item]));

    grid.innerHTML = '';

    for (let ordem = 1; ordem <= MAX_ATALHOS; ordem += 1) {
        const item = porOrdem.get(ordem);

        if (!item) {
            grid.appendChild(criarSlotVazio(ordem));
        } else {
            grid.appendChild(criarSlotPreenchido(item));
        }
    }
}

function criarSlotVazio(ordem) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'slot-card empty';
    card.innerHTML = `
        <i class="fas fa-plus"></i>
        <strong>Posição ${ordem}</strong>
        <span>Adicionar atalho</span>
    `;

    card.addEventListener('click', () => abrirNovo(ordem));
    return card;
}

function criarSlotPreenchido(item) {
    const card = document.createElement('article');
    card.className = `slot-card${item.ativo ? '' : ' inactive'}`;

    card.innerHTML = `
        <div class="slot-top">
          <div class="slot-order">${Number(item.ordem)}</div>
          <span class="slot-status ${item.ativo ? 'active' : 'off'}">
            ${item.ativo ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        <div class="slot-name" title="${escapeHtml(item.nome)}">
          ${escapeHtml(item.nome)}
        </div>

        <div class="slot-detail">
          <span><i class="fas fa-list-ol"></i>${Number(item.qtd_jogos || 0)} jogos · ${Number(item.qtd_dezenas || 0)} dezenas</span>
          <span><i class="fas fa-money-bill-wave"></i>${formatarBRL(item.valor_cota)}</span>
          <span><i class="fas fa-users"></i>${Number(item.qtd_cotas || 0)} cotas</span>
        </div>

        <div class="slot-actions">
          <button type="button" class="btn-dark btn-editar">
            <i class="fas fa-pen"></i> Editar
          </button>

          <button type="button" class="btn-ghost btn-status">
            <i class="fas fa-${item.ativo ? 'eye-slash' : 'eye'}"></i>
            ${item.ativo ? 'Desativar' : 'Ativar'}
          </button>
        </div>
    `;

    card.querySelector('.btn-editar').addEventListener('click', () => {
        abrirEdicao(item);
    });

    card.querySelector('.btn-status').addEventListener('click', () => {
        alternarStatus(item);
    });

    return card;
}

function proximaOrdemLivre() {
    const usadas = new Set(atalhosFiltrados().map(item => Number(item.ordem)));

    for (let ordem = 1; ordem <= MAX_ATALHOS; ordem += 1) {
        if (!usadas.has(ordem)) return ordem;
    }

    return null;
}

function abrirNovo(ordemSugerida = null) {
    const ordem = ordemSugerida || proximaOrdemLivre();

    if (!ordem) {
        setStatus(
            'As 15 posições já estão ocupadas nessa loja e modalidade.',
            'err',
            'exclamation-circle'
        );
        return;
    }

    $('formAtalho').reset();
    $('atalhoId').value = '';
    $('atalhoOrdem').value = String(ordem);
    $('atalhoAtivo').checked = true;
    $('editorTitle').textContent = 'Novo atalho';
    $('btnExcluir').classList.add('hidden');

    atualizarContextoEditor();
    abrirOverlay('editorOverlay');
    setTimeout(() => $('atalhoNome').focus(), 80);
}

function abrirEdicao(item) {
    $('atalhoId').value = String(item.id);
    $('atalhoNome').value = item.nome || '';
    $('atalhoJogos').value = item.qtd_jogos ?? '';
    $('atalhoDezenas').value = item.qtd_dezenas ?? '';
    $('atalhoValor').value = formatarDecimalBR(item.valor_cota);
    $('atalhoCotas').value = item.qtd_cotas ?? '';
    $('atalhoOrdem').value = String(item.ordem);
    $('atalhoAtivo').checked = Boolean(item.ativo);

    $('editorTitle').textContent = 'Editar atalho';
    $('btnExcluir').classList.remove('hidden');

    atualizarContextoEditor();
    abrirOverlay('editorOverlay');
    setTimeout(() => $('atalhoNome').focus(), 80);
}

function atualizarContextoEditor() {
    const loja = lojaSelecionada();
    $('editorContexto').textContent =
        `${loja?.loteria_nome || '—'} · ${modalidadeSelecionada()}`;
}

function abrirOverlay(id) {
    const overlay = $(id);
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function fecharOverlay(id) {
    const overlay = $(id);
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');

    if (!document.querySelector('.modal-overlay.active')) {
        document.body.style.overflow = '';
    }
}

function validarFormulario() {
    const id = Number($('atalhoId').value || 0);
    const nome = $('atalhoNome').value.trim();
    const qtdJogos = Number.parseInt($('atalhoJogos').value, 10);
    const qtdDezenas = Number.parseInt($('atalhoDezenas').value, 10);
    const valorCota = parseDecimalBR($('atalhoValor').value);
    const qtdCotas = Number.parseInt($('atalhoCotas').value, 10);
    const ordem = Number.parseInt($('atalhoOrdem').value, 10);
    const ativo = $('atalhoAtivo').checked;

    if (!nome) throw new Error('Informe o nome exibido do atalho.');
    if (!Number.isInteger(qtdJogos) || qtdJogos < 0) {
        throw new Error('Quantidade de jogos inválida.');
    }
    if (!Number.isInteger(qtdDezenas) || qtdDezenas < 0) {
        throw new Error('Quantidade de dezenas inválida.');
    }
    if (!Number.isFinite(valorCota) || valorCota <= 0) {
        throw new Error('O valor da cota deve ser maior que zero.');
    }
    if (!Number.isInteger(qtdCotas) || qtdCotas <= 0) {
        throw new Error('Quantidade de cotas inválida.');
    }
    if (!Number.isInteger(ordem) || ordem < 1 || ordem > MAX_ATALHOS) {
        throw new Error(`A posição deve estar entre 1 e ${MAX_ATALHOS}.`);
    }

    const conflito = atalhosFiltrados().find(item =>
        Number(item.ordem) === ordem &&
        Number(item.id) !== id
    );

    if (conflito) {
        throw new Error(
            `A posição ${ordem} já está ocupada por ${conflito.nome}. Escolha uma posição livre.`
        );
    }

    const loja = lojaSelecionada();
    if (!loja) throw new Error('Loja não identificada.');

    return {
        id,
        loteria_id: Number(loja.loteria_id),
        modalidade: modalidadeSelecionada(),
        nome,
        qtd_jogos: qtdJogos,
        qtd_dezenas: qtdDezenas,
        valor_cota: valorCota,
        qtd_cotas: qtdCotas,
        ordem,
        ativo
    };
}

async function salvarAtalho(event) {
    event.preventDefault();

    if (state.salvando) return;

    const btn = $('btnSalvar');

    try {
        const payload = validarFormulario();

        state.salvando = true;
        setLoading(btn, true);

        const dados = {
            loteria_id: payload.loteria_id,
            modalidade: payload.modalidade,
            nome: payload.nome,
            qtd_jogos: payload.qtd_jogos,
            qtd_dezenas: payload.qtd_dezenas,
            valor_cota: payload.valor_cota,
            qtd_cotas: payload.qtd_cotas,
            ordem: payload.ordem,
            ativo: payload.ativo,
            updated_at: new Date().toISOString()
        };

        let error;

        if (payload.id) {
            ({ error } = await sb
                .from('modelos_boloes')
                .update(dados)
                .eq('id', payload.id));
        } else {
            ({ error } = await sb
                .from('modelos_boloes')
                .insert(dados));
        }

        if (error) {
            if (error.code === '23505') {
                throw new Error(
                    'Essa posição acabou de ser ocupada. Atualize a tela e escolha outra posição.'
                );
            }

            throw new Error(error.message);
        }

        fecharOverlay('editorOverlay');
        await carregarAtalhos();

        setStatus(
            payload.id ? 'Atalho atualizado com sucesso.' : 'Atalho criado com sucesso.',
            'ok',
            'check-circle'
        );
    } catch (erro) {
        console.error('Erro ao salvar atalho:', erro);
        setStatus(
            erro?.message || 'Erro ao salvar o atalho.',
            'err',
            'exclamation-circle'
        );
    } finally {
        state.salvando = false;
        setLoading(btn, false);
    }
}

async function alternarStatus(item) {
    const acao = item.ativo ? 'desativar' : 'ativar';

    if (!confirm(`Confirma ${acao} o atalho ${item.nome}?`)) {
        return;
    }

    const { error } = await sb
        .from('modelos_boloes')
        .update({
            ativo: !item.ativo,
            updated_at: new Date().toISOString()
        })
        .eq('id', item.id);

    if (error) {
        setStatus(
            `Erro ao ${acao} o atalho: ${error.message}`,
            'err',
            'exclamation-circle'
        );
        return;
    }

    await carregarAtalhos();
    setStatus(`Atalho ${acao === 'ativar' ? 'ativado' : 'desativado'}.`, 'ok', 'check-circle');
}

async function excluirAtalho() {
    const id = Number($('atalhoId').value || 0);
    const item = state.atalhos.find(registro => Number(registro.id) === id);

    if (!item) return;

    if (!confirm(
        `Excluir definitivamente o atalho ${item.nome}?\n\n` +
        'Essa ação não pode ser desfeita.'
    )) {
        return;
    }

    const btn = $('btnExcluir');
    setLoading(btn, true);

    try {
        const { error } = await sb
            .from('modelos_boloes')
            .delete()
            .eq('id', id);

        if (error) throw new Error(error.message);

        fecharOverlay('editorOverlay');
        await carregarAtalhos();

        setStatus('Atalho excluído.', 'ok', 'check-circle');
    } catch (erro) {
        setStatus(
            erro?.message || 'Erro ao excluir o atalho.',
            'err',
            'exclamation-circle'
        );
    } finally {
        setLoading(btn, false);
    }
}

function abrirCopia() {
    const origem = lojaSelecionada();
    const modalidade = modalidadeSelecionada();
    const modelos = atalhosFiltrados();

    if (!modelos.length) {
        setStatus(
            'Não há atalhos nessa loja e modalidade para copiar.',
            'err',
            'exclamation-circle'
        );
        return;
    }

    $('copyContexto').textContent =
        `${origem?.loteria_nome || '—'} · ${modalidade}`;

    const container = $('copyLojas');
    container.innerHTML = '';

    state.lojas
        .filter(loja => Number(loja.loteria_id) !== Number(origem.loteria_id))
        .forEach(loja => {
            const label = document.createElement('label');
            label.className = 'copy-item';
            label.innerHTML = `
                <input type="checkbox" value="${Number(loja.loteria_id)}"/>
                <span>${escapeHtml(loja.loteria_nome)}</span>
            `;
            container.appendChild(label);
        });

    abrirOverlay('copyOverlay');
}

async function confirmarCopia() {
    if (state.copiando) return;

    const destinoIds = [...$('copyLojas').querySelectorAll('input:checked')]
        .map(input => Number(input.value));

    if (!destinoIds.length) {
        setStatus('Selecione ao menos uma loja de destino.', 'err', 'exclamation-circle');
        return;
    }

    const origem = lojaSelecionada();
    const modalidade = modalidadeSelecionada();
    const modelosOrigem = atalhosFiltrados();

    const nomesDestino = state.lojas
        .filter(loja => destinoIds.includes(Number(loja.loteria_id)))
        .map(loja => loja.loteria_nome)
        .join(', ');

    if (!confirm(
        `Copiar ${modelosOrigem.length} atalhos de ${origem.loteria_nome} / ${modalidade}` +
        ` para: ${nomesDestino}?\n\n` +
        'Os atalhos atuais dessa modalidade nas lojas de destino serão substituídos.'
    )) {
        return;
    }

    const btn = $('btnConfirmarCopy');

    try {
        state.copiando = true;
        setLoading(btn, true);

        for (const destinoId of destinoIds) {
            const { error: deleteError } = await sb
                .from('modelos_boloes')
                .delete()
                .eq('loteria_id', destinoId)
                .eq('modalidade', modalidade);

            if (deleteError) {
                throw new Error(
                    `Falha ao limpar a loja ${destinoId}: ${deleteError.message}`
                );
            }

            const novos = modelosOrigem.map(item => ({
                loteria_id: destinoId,
                modalidade: item.modalidade,
                nome: item.nome,
                qtd_jogos: item.qtd_jogos,
                qtd_dezenas: item.qtd_dezenas,
                valor_cota: item.valor_cota,
                qtd_cotas: item.qtd_cotas,
                ordem: item.ordem,
                ativo: item.ativo
            }));

            const { error: insertError } = await sb
                .from('modelos_boloes')
                .insert(novos);

            if (insertError) {
                throw new Error(
                    `Falha ao copiar para a loja ${destinoId}: ${insertError.message}`
                );
            }
        }

        fecharOverlay('copyOverlay');
        await carregarAtalhos();

        setStatus(
            `Configuração copiada para ${destinoIds.length} loja(s).`,
            'ok',
            'check-circle'
        );
    } catch (erro) {
        console.error('Erro ao copiar atalhos:', erro);
        setStatus(
            erro?.message || 'Erro ao copiar atalhos.',
            'err',
            'exclamation-circle'
        );
    } finally {
        state.copiando = false;
        setLoading(btn, false);
    }
}

function bind() {
    $('filtroLoja').addEventListener('change', render);
    $('filtroModalidade').addEventListener('change', render);

    $('btnNovo').addEventListener('click', () => abrirNovo());
    $('btnAtualizar').addEventListener('click', async () => {
        try {
            await carregarAtalhos();
            setStatus('Lista atualizada.', 'ok', 'check-circle');
        } catch (erro) {
            setStatus(erro.message, 'err', 'exclamation-circle');
        }
    });

    $('btnCopiar').addEventListener('click', abrirCopia);

    $('formAtalho').addEventListener('submit', salvarAtalho);
    $('btnExcluir').addEventListener('click', excluirAtalho);

    $('btnFecharEditor').addEventListener('click', () => fecharOverlay('editorOverlay'));
    $('btnCancelarEditor').addEventListener('click', () => fecharOverlay('editorOverlay'));

    $('btnFecharCopy').addEventListener('click', () => fecharOverlay('copyOverlay'));
    $('btnCancelarCopy').addEventListener('click', () => fecharOverlay('copyOverlay'));
    $('btnConfirmarCopy').addEventListener('click', confirmarCopia);

    $('btnVoltarBoloes').addEventListener('click', () => {
        window.location.href = './boloes.html';
    });

    $('btnInicio').addEventListener('click', () => {
        window.SISLOT_SECURITY.irParaInicio();
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                fecharOverlay(overlay.id);
            }
        });
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;

        document.querySelectorAll('.modal-overlay.active').forEach(overlay => {
            fecharOverlay(overlay.id);
        });
    });
}

init();
