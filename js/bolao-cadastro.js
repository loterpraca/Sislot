/**
 * SISLOT — Bolões (Cadastro + Movimentação)
 * Versão dinâmica: lojas, logos e ícones vindos do banco
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

// Importa funções do utils com fallbacks
const utils = window.SISLOT_UTILS || {};

const $ = utils.$ || (id => document.getElementById(id));
const parseCota = utils.parseCota || (v => { if (!v) return 0; const s = String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'); return parseFloat(s) || 0; });
const fmtBR = utils.fmtBR || (v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtBRL = utils.fmtBRL || (v => parseFloat(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtData = utils.fmtData || (s => { if (!s) return '—'; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; } return s; });
const addDias = utils.addDias || ((inputId, delta) => { const el = $(inputId); if (!el) return; const v = el.value; let y, m, d; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { [y, m, d] = v.split('-').map(Number); } else { const n = new Date(); y = n.getFullYear(); m = n.getMonth() + 1; d = n.getDate(); } const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + delta); el.value = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); el.dispatchEvent(new Event('change', { bubbles: true })); });
const setStatus = utils.setStatus || ((elOrId, msg, tipo, icone) => { const el = typeof elOrId === 'string' ? $(elOrId) : elOrId; if (!el) return; el.className = 'status ' + (tipo || 'muted'); el.innerHTML = `<i class="fas fa-${icone || 'info-circle'}"></i><span>${msg}</span>`; });
const setBtnLoading = utils.setBtnLoading || ((btnOrId, on) => { const btn = typeof btnOrId === 'string' ? $(btnOrId) : btnOrId; if (!btn) return; if (on) { btn.classList.add('btn-loading'); btn.disabled = true; } else { btn.classList.remove('btn-loading'); btn.disabled = false; } });
const showModal = utils.showModal || (({ title, body, onConfirm, onCancel }) => { const result = confirm(`${title}\n\n${body}`); if (result && onConfirm) onConfirm(); if (!result && onCancel) onCancel(); });

// ── Lojas dinâmicas ──────────────────────────────────────
// Nenhuma loja é escrita manualmente neste arquivo.
// Nome, slug, logo, tema, emoji e ícone vêm da tabela loterias.

function normalizarLoja(loja = {}) {
    const id = Number(loja.loteria_id ?? loja.id ?? 0);
    const slug = String(loja.loteria_slug ?? loja.slug ?? '').trim();
    const nome = String(loja.loteria_nome ?? loja.nome ?? slug ?? 'Loja').trim();

    return {
        ...loja,
        loteria_id: id,
        loteria_nome: nome,
        loteria_slug: slug,
        loteria_codigo: loja.loteria_codigo ?? loja.codigo ?? '',
        cod_loterico: loja.cod_loterico ?? '',
        logo_url: loja.logo_url ?? loja.loteria_logo_url ?? loja.logo_path ?? '',
        logo_posicao: loja.logo_posicao ?? loja.logo_pos ?? '50% 50%',
        tema: loja.tema ?? slug ?? '',
        icone_emoji: loja.icone_emoji ?? '📍',
        icone_classe: loja.icone_classe ?? 'fas fa-map-marker-alt',
        ordem_exibicao: Number(loja.ordem_exibicao ?? 100)
    };
}

function resolverLogoLoja(loja) {
    const valor = String(loja?.logo_url || '').trim();
    if (valor) {
        if (/^(https?:)?\/\//i.test(valor) || valor.startsWith('.') || valor.startsWith('/')) {
            return valor;
        }
        return `./${valor.replace(/^\/+/, '')}`;
    }

    const slug = String(loja?.loteria_slug || '').trim();
    return slug ? `./icons/${slug}.png` : './icons/centro.png';
}

function getEmojiLoja(loja) {
    return String(loja?.icone_emoji || '📍').trim() || '📍';
}

function getIconeClasseLoja(loja) {
    const classe = String(loja?.icone_classe || 'fas fa-map-marker-alt')
        .replace(/[^a-zA-Z0-9_\-\s]/g, '')
        .trim();

    return classe || 'fas fa-map-marker-alt';
}

function escaparHtml(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function idCampoMov(loja) {
    return `mov-dest-${Number(loja?.loteria_id || 0)}`;
}

function getCampoMov(loja) {
    return $(idCampoMov(loja));
}

async function carregarLojasAtivasComIdentidade() {
    const { data, error } = await sb
        .from('loterias')
        .select('*')
        .eq('ativo', true)
        .order('nome', { ascending: true });

    if (!error && Array.isArray(data)) {
        return data
            .map(normalizarLoja)
            .filter(loja => loja.loteria_id && loja.loteria_slug);
    }

    console.warn('Falha ao carregar identidade completa das lojas. Usando fallback do módulo de segurança.', error);

    const fallback = await window.SISLOT_SECURITY.carregarTodasLojas();
    return (fallback || [])
        .map(normalizarLoja)
        .filter(loja => loja.loteria_id && loja.loteria_slug);
}

function mesclarIdentidadeLoja(loja, identidades) {
    const base = normalizarLoja(loja);
    const identidade = identidades.find(item =>
        Number(item.loteria_id) === Number(base.loteria_id) ||
        item.loteria_slug === base.loteria_slug
    );

    return normalizarLoja({
        ...(identidade || {}),
        ...base,
        logo_url: identidade?.logo_url || base.logo_url,
        logo_posicao: identidade?.logo_posicao || base.logo_posicao,
        tema: identidade?.tema || base.tema,
        icone_emoji: identidade?.icone_emoji || base.icone_emoji,
        icone_classe: identidade?.icone_classe || base.icone_classe,
        ordem_exibicao: identidade?.ordem_exibicao ?? base.ordem_exibicao
    });
}

function capturarMapaCamposLegadosDoDOM() {
    const mapa = {};

    document.querySelectorAll('#movGrid .mov-item[data-slug]').forEach(field => {
        const slug = String(field.dataset.slug || '').trim();
        const input = field.querySelector('input[id]');
        if (slug && input?.id) mapa[slug] = input.id;
    });

    return mapa;
}

function renderizarCamposMovimentacao() {
    const grid = $('movGrid');
    if (!grid) return;

    grid.innerHTML = lojasMovimentacao.map(loja => {
        const ehOrigem = Number(loja.loteria_id) === Number(loteriaAtiva?.loteria_id);
        const nome = escaparHtml(loja.loteria_nome);
        const slug = escaparHtml(loja.loteria_slug);
        const classeIcone = escaparHtml(getIconeClasseLoja(loja));

        return `
            <div class="field mov-item ${ehOrigem ? 'mov-origem' : ''}"
                 data-slug="${slug}"
                 data-loteria-id="${loja.loteria_id}">
                <label>
                    <i class="${classeIcone}"></i>
                    ${nome}${ehOrigem ? ' ★' : ''}
                </label>
                <input
                    id="${idCampoMov(loja)}"
                    data-loteria-id="${loja.loteria_id}"
                    data-slug="${slug}"
                    inputmode="numeric"
                    placeholder="0"
                    autocomplete="off"
                    ${ehOrigem ? 'disabled' : ''}
                />
            </div>`;
    }).join('');

    lojasMovimentacao.forEach(loja => {
        const input = getCampoMov(loja);
        if (!input || input.disabled) return;
        input.addEventListener('input', saveDraft);
        input.addEventListener('change', saveDraft);
    });
}

function coletarMapaDeltas() {
    const mapa = {};

    lojasMovimentacao.forEach(loja => {
        const input = getCampoMov(loja);
        if (!input || input.disabled) return;

        const valor = parseInt(input.value, 10) || 0;
        if (valor !== 0) mapa[String(loja.loteria_id)] = valor;
    });

    return mapa;
}

const MODS = [
    { key: 'Mega Sena',     icon: './icons/mega-sena.png'     },
    { key: 'Lotofácil',     icon: './icons/lotofacil.png'     },
    { key: 'Quina',         icon: './icons/quina.png'         },
    { key: 'Dia de Sorte',  icon: './icons/dia-de-sorte.png'  },
    { key: 'Timemania',     icon: './icons/timemania.png'     },
    { key: 'Dupla Sena',    icon: './icons/dupla.png'         },
    { key: 'Supersete',     icon: './icons/super-sete.png'    },
    { key: 'Milionária',    icon: './icons/milionaria.png'    },
    { key: 'Loteca',        icon: './icons/loteca.png'        },
    { key: 'Páscoa',        icon: './icons/pascoa.png'        },
    { key: 'Independência', icon: './icons/independencia.png' },
    { key: 'Virada',        icon: './icons/virada.png'        },
    { key: 'São João',      icon: './icons/saojoao.png'       },
];

// ── Estado da tela ─────────────────────────────────────────
let usuario = null;
let loteriaAtiva = null;
let todasLojas = [];
let lojasMovimentacao = [];
let lojaIdPorSlug = {};
let mapaCamposMovLegado = {};
let SHORTCUTS = {};
let ESPECIAIS = {};
let SUGESTOES_COLETADAS = [];
let abaCadastroAtiva = 'CADASTRO';
let carregandoSugestoesColetadas = false;
// Impede abertura de mais de uma confirmação
let confirmacaoMovimentacaoAberta = false;
// Impede mais de uma gravação simultânea
let movimentacaoEmAndamento = false;

const CAMPOS_FORM = ['modalidade', 'concurso', 'dataInicial', 'dataConcurso', 'qtdJogos', 'qtdDezenas', 'valorCota', 'cotas'];

// ── Relógio ────────────────────────────────────────────────
function updateClock() {
    const el = $('relogio');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR');
}
updateClock();
setInterval(updateClock, 1000);

/************************************************************
 * INICIALIZAÇÃO
 ************************************************************/

async function init() {
    const ctx = await window.SISLOT_SECURITY.protegerPagina('cadastro');
    if (!ctx) return;

    usuario = ctx.usuario;

    // Captura a estrutura antiga do HTML antes de substituí-la.
    // Isso permite migrar rascunhos antigos sem manter um mapa fixo de lojas.
    mapaCamposMovLegado = capturarMapaCamposLegadosDoDOM();

    const identidades = await carregarLojasAtivasComIdentidade();
    lojasMovimentacao = identidades;

    todasLojas = (ctx.lojasPermitidas || [])
        .map(loja => mesclarIdentidadeLoja(loja, identidades));

    loteriaAtiva = ctx.lojaInicial
        ? mesclarIdentidadeLoja(ctx.lojaInicial, identidades)
        : todasLojas[0] || null;

    lojaIdPorSlug = {};
    lojasMovimentacao.forEach(loja => {
        lojaIdPorSlug[loja.loteria_slug] = loja.loteria_id;
    });

    if (!todasLojas.length || !loteriaAtiva) {
        alert('Nenhuma loja disponível para este usuário.');
        window.SISLOT_SECURITY.irParaInicio();
        return;
    }

    renderizarCamposMovimentacao();
    garantirUiSugestaoColetada();

    await carregarModelos();
    await carregarEspeciais();

    aplicarTema(loteriaAtiva);
    atualizarOrigemUI();
    atualizarCamposMov();
    renderQuickbar();
    loadDraft();

    const modAtual = $('modalidade')?.value || '';
    if (modAtual) {
        aplicarModeloEspecial(modAtual, false);
    }

    applyFederalUI();
    bind();

    window.SISLOT_CADASTRO_DEBUG = {
        getLojasPermitidas: () => [...todasLojas],
        getLojasMovimentacao: () => [...lojasMovimentacao],
        getLojaAtiva: () => loteriaAtiva
    };
}

async function buscarUltimoConcurso(modalidade) {
    if (!modalidade || !loteriaAtiva?.loteria_id) return null;

    const { data, error } = await sb
        .from('boloes')
        .select('concurso')
        .eq('loteria_id', loteriaAtiva.loteria_id)
        .eq('modalidade', modalidade)
        .neq('status', 'CANCELADO');

    if (error) throw new Error(error.message);
    if (!data || !data.length) return null;

    const numeros = data
        .map(r => parseInt(r.concurso, 10))
        .filter(n => Number.isFinite(n));

    if (!numeros.length) return null;

    return Math.max(...numeros);
}

async function ajustarConcurso(delta) {
    const modalidade = $('modalidade')?.value?.trim();
    const concursoEl = $('concurso');

    if (!concursoEl) return;
    if (!modalidade) {
        setStatus('status', 'Selecione a modalidade antes de ajustar o concurso.', 'err', 'exclamation-circle');
        return;
    }

    const atual = parseInt(concursoEl.value, 10);

    if (Number.isFinite(atual)) {
        const novo = atual + delta;
        concursoEl.value = String(novo > 0 ? novo : 1);
        concursoEl.dispatchEvent(new Event('input', { bubbles: true }));
        concursoEl.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    try {
        setStatus('status', 'Buscando último concurso...', 'muted', 'spinner fa-spin');

        const ultimo = await buscarUltimoConcurso(modalidade);

        if (!Number.isFinite(ultimo)) {
            setStatus('status', 'Nenhum concurso anterior encontrado para essa modalidade.', 'err', 'exclamation-circle');
            return;
        }

        const novo = ultimo + delta;
        concursoEl.value = String(novo > 0 ? novo : 1);
        concursoEl.dispatchEvent(new Event('input', { bubbles: true }));
        concursoEl.dispatchEvent(new Event('change', { bubbles: true }));

        setStatus('status', `Concurso ajustado para ${concursoEl.value}.`, 'ok', 'check-circle');
    } catch (e) {
        setStatus('status', e.message || 'Erro ao buscar concurso.', 'err', 'exclamation-circle');
    }
}
async function carregarEspeciais() {
    const { data, error } = await sb
        .from('modelos_boloes_especiais')
        .select('modalidade, concurso, dt_inicial, dt_concurso, ativo')
        .eq('ativo', true);

    if (error) {
        console.error('ERRO carregarEspeciais:', error);
        setStatus('status', 'Erro ao carregar concursos especiais. Verifique RLS/permissão da tabela modelos_boloes_especiais.', 'err', 'exclamation-circle');
        ESPECIAIS = {};
        return;
    }

    ESPECIAIS = {};

    (data || []).forEach(e => {
        const modalidade = String(e.modalidade || '').trim();

        ESPECIAIS[modalidade] = {
            concurso: e.concurso,
            dataInicial: e.dt_inicial,
            dataConcurso: e.dt_concurso,
        };
    });

    console.log('ESPECIAIS carregados:', ESPECIAIS);
}

function aplicarModeloEspecial(modalidade, force = false) {
    const chave = String(modalidade || '').trim();
    const cfg = ESPECIAIS[chave];

    console.log('Aplicando modelo especial:', {
        modalidade: chave,
        force,
        cfg,
        ESPECIAIS
    });

    if (!cfg) return false;

    const preencher = (id, valor) => {
        const el = $(id);
        if (!el) return;

        if (force || !el.value) {
            el.value = valor || '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    preencher('concurso', cfg.concurso);
    preencher('dataInicial', cfg.dataInicial);
    preencher('dataConcurso', cfg.dataConcurso);

    return true;
}

async function carregarModelos() {
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
            ativo
        `)
        .eq('ativo', true)
        .order('loteria_id', { ascending: true })
        .order('modalidade', { ascending: true })
        .order('ordem', { ascending: true });

    if (error) {
        console.error('ERRO carregarModelos:', error);

        SHORTCUTS = {};

        setStatus(
            'status',
            `Erro ao carregar atalhos: ${error.message}`,
            'err',
            'exclamation-circle'
        );

        return;
    }

    SHORTCUTS = {};

    const idParaSlug = {};

    Object.entries(lojaIdPorSlug).forEach(([slug, id]) => {
        idParaSlug[Number(id)] = slug;
    });

    (data || []).forEach(modelo => {
        const slug = idParaSlug[Number(modelo.loteria_id)];

        if (!slug) return;

        if (!SHORTCUTS[slug]) {
            SHORTCUTS[slug] = {};
        }

        if (!SHORTCUTS[slug][modelo.modalidade]) {
            SHORTCUTS[slug][modelo.modalidade] = [];
        }

        SHORTCUTS[slug][modelo.modalidade].push(modelo);
    });
}
/************************************************************
 * TEMA / VISUAL
 ************************************************************/
function aplicarTema(loja) {
    if (!loja) return;

    const slug = loja.loteria_slug || 'centro';
    const nome = loja.loteria_nome || 'SISLOT';
    const tema = loja.tema || slug || 'centro';

    document.body.setAttribute('data-theme', tema);
    document.body.setAttribute('data-loja', slug);

    const img = $('logoImg');
    if (img) {
        img.onerror = () => {
            img.onerror = null;
            img.src = './icons/loterpraca.png';
        };
        img.src = resolverLogoLoja(loja);
        img.style.objectPosition = loja.logo_posicao || '50% 50%';
    }

    const title = $('headerTitle');
    if (title) title.textContent = nome;

    const sub = $('headerSub');
    if (sub) sub.textContent = 'Cadastro e movimentação';
}

function atualizarOrigemUI() {
    const nome = loteriaAtiva?.loteria_nome || '—';
    const origemNome = $('origemNome');
    const movOrigemNome = $('movOrigemNome');
    if (origemNome) origemNome.textContent = nome;
    if (movOrigemNome) movOrigemNome.textContent = nome;
}

function atualizarCamposMov() {
    lojasMovimentacao.forEach(loja => {
        const el = getCampoMov(loja);
        if (!el) return;

        const field = el.closest('.mov-item');
        const ehOrigem = Number(loja.loteria_id) === Number(loteriaAtiva?.loteria_id);

        el.disabled = ehOrigem;
        if (ehOrigem) el.value = '';

        if (field) {
            field.classList.toggle('mov-origem', ehOrigem);
            const label = field.querySelector('label');
            if (label) {
                label.innerHTML = `<i class="${escaparHtml(getIconeClasseLoja(loja))}"></i> ${escaparHtml(loja.loteria_nome)}${ehOrigem ? ' ★' : ''}`;
            }
        }
    });
}

/************************************************************
 * TROCA DE LOJA/************************************************************
 * TROCA DE LOJA
 ************************************************************/
function trocarLoja(slug) {
    const loja = todasLojas.find(l => l.loteria_slug === slug);
    if (!loja) return;

    loteriaAtiva = loja;
    aplicarTema(loja);
    atualizarOrigemUI();
    atualizarCamposMov();
    renderChips(localStorage.getItem('sl_active_mod') || '');
    saveDraft();

    if (abaCadastroAtiva === 'SUGESTAO') {
        carregarSugestoesColetadas(true);
    }
}

function getIndiceLojaAtual() {
    return todasLojas.findIndex(l => l.loteria_slug === loteriaAtiva?.loteria_slug);
}

function trocarLojaPorOffset(offset) {
    if (!todasLojas.length || !loteriaAtiva) return;

    const atual = getIndiceLojaAtual();
    if (atual < 0) return;

    let prox = atual + offset;

    if (prox < 0) prox = todasLojas.length - 1;
    if (prox >= todasLojas.length) prox = 0;

    trocarLoja(todasLojas[prox].loteria_slug);
}

/************************************************************
 * QUICKBAR
 ************************************************************/
function renderQuickbar() {
    const grid = $('modGrid');
    if (!grid) return;
    grid.innerHTML = '';

    MODS.forEach(mod => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qmod';
        btn.dataset.mod = mod.key;
        btn.title = mod.key;

        const img = document.createElement('img');
        img.src = mod.icon;
        img.alt = mod.key;
        img.loading = 'lazy';

        btn.appendChild(img);
        btn.onclick = () => selecionarMod(mod.key);
        grid.appendChild(btn);
    });

    const ativo = localStorage.getItem('sl_active_mod') || '';
    if (ativo) {
        setActiveModBtn(ativo);
        renderChips(ativo);
        const modalidadeEl = $('modalidade');
        if (modalidadeEl) modalidadeEl.value = ativo;
        applyFederalUI();
    }
}

function selecionarMod(modKey) {
    const modalidadeEl = $('modalidade');
    const modAtual = modalidadeEl?.value || '';

    const mudouModalidade = modAtual && modAtual !== modKey;

    if (mudouModalidade) {
        limparFormCompletoMantendoModalidade(modKey);

        if (aplicarModeloEspecial(modKey, true)) {
            setStatus('status', `${modKey} selecionado: concurso e datas preenchidos automaticamente.`, 'ok', 'calendar-check');
        } else {
            setStatus('status', 'Modalidade alterada. Dados anteriores foram limpos.', 'muted', 'broom');
        }

        saveDraft();
        return;
    }

    if (modalidadeEl) modalidadeEl.value = modKey;

    localStorage.setItem('sl_active_mod', modKey);
    setActiveModBtn(modKey);
    renderChips(modKey);
    applyFederalUI();

    if (aplicarModeloEspecial(modKey, true)) {
        setStatus('status', `${modKey} selecionado: concurso e datas preenchidos automaticamente.`, 'ok', 'calendar-check');
    }

    saveDraft();
}
function setActiveModBtn(modKey) {
    document.querySelectorAll('.qmod').forEach(b =>
        b.classList.toggle('active', b.dataset.mod === modKey)
    );
}

function renderChips(modKey) {
    const slug = loteriaAtiva?.loteria_slug || '';
    const chips = (SHORTCUTS[slug] || {})[modKey] || [];
    const wrap = $('chipsWrap');
    const row = $('chipsRow');

    if (!wrap || !row) return;

    row.innerHTML = '';
    row.scrollLeft = 0;
    if (!chips.length) {
        wrap.classList.remove('active');
        return;
    }

    const modObj = MODS.find(m => m.key === modKey);
    const icon = modObj ? modObj.icon : '';

    chips.forEach(sc => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip-tile';
        b.title = `${modKey} ${sc.nome}`;

        if (icon) {
            const img = document.createElement('img');
            img.src = icon;
            img.alt = modKey;
            b.appendChild(img);
        }

        const badge = document.createElement('span');
        badge.className = 'chip-badge';
        badge.textContent = sc.nome;
        b.appendChild(badge);

        b.onclick = () => aplicarShortcut(modKey, sc);
        row.appendChild(b);
    });

    wrap.classList.add('active');
}

function aplicarShortcut(modKey, sc) {
    const modalidadeEl = $('modalidade');
    const qtdJogosEl = $('qtdJogos');
    const qtdDezenasEl = $('qtdDezenas');
    const valorCotaEl = $('valorCota');
    const cotasEl = $('cotas');

    if (modalidadeEl) modalidadeEl.value = modKey;
    if (qtdJogosEl) qtdJogosEl.value = sc.qtd_jogos ?? '';
    if (qtdDezenasEl) qtdDezenasEl.value = sc.qtd_dezenas ?? '';
    if (valorCotaEl) valorCotaEl.value = fmtBR(sc.valor_cota);
    if (cotasEl) cotasEl.value = sc.qtd_cotas ?? '';
    applyFederalUI();
    aplicarModeloEspecial(modKey, false);
    setStatus('status', 'Atalho aplicado: ' + sc.nome, 'ok', 'check-circle');
    saveDraft();
}


/************************************************************
 * SUGESTÃO COLETADA
 ************************************************************/

function injetarCssSugestaoColetada() {
    // A partir da v3, os estilos ficam em cadastro.css.
}

function localizarBlocoCadastro() {
    const explicito = $('cadastroCard');
    if (explicito) return explicito;

    const campo = $('modalidade');
    if (!campo) return null;

    return campo.closest('.card, .panel, .box, section, form') ||
           campo.parentElement?.parentElement ||
           campo.parentElement;
}

function garantirUiSugestaoColetada() {
    if (!$('modalidade')) return;

    injetarCssSugestaoColetada();

    const blocoCadastro = localizarBlocoCadastro();
    if (!blocoCadastro?.parentElement) return;

    blocoCadastro.dataset.scCadastroOriginal = '1';

    // Preferência: HTML estático da v3.
    // Fallback: cria apenas a estrutura caso o fragmento ainda não tenha sido inserido.
    if (!$('scTabs') || !$('scPanel')) {
        const tabs = document.createElement('div');
        tabs.id = 'scTabs';
        tabs.className = 'cadastro-tabs';
        tabs.innerHTML = `
            <button type="button" id="scTabCadastro" class="cadastro-tab active">
                <i class="fas fa-pen-to-square"></i> Cadastro
            </button>
            <button type="button" id="scTabSugestao" class="cadastro-tab">
                <i class="fas fa-wand-magic-sparkles"></i> Sugestão Coletada
                <span class="cadastro-tab-count" id="scTabCount"></span>
            </button>
        `;

        const panel = document.createElement('section');
        panel.id = 'scPanel';
        panel.className = 'sc-panel';
        panel.innerHTML = `
            <div class="sc-card">
                <div class="sc-head">
                    <div class="sc-head-main">
                        <div class="sc-title">
                            <i class="fas fa-wand-magic-sparkles"></i>
                            Sugestão Coletada — <span id="scLojaNome">—</span>
                        </div>
                        <div class="sc-sub" id="scFreshness">
                            Consultando última coleta…
                        </div>
                    </div>
                    <div class="sc-actions">
                        <button type="button" id="scAtualizar" class="sc-btn-refresh">
                            <i class="fas fa-rotate"></i> Atualizar
                        </button>
                        <button type="button" id="scCadastrarSelecionados" class="sc-btn-primary" disabled>
                            <i class="fas fa-link"></i> Cadastrar e vincular selecionados
                        </button>
                    </div>
                </div>

                <div class="sc-summary">
                    <label class="sc-select-all">
                        <input type="checkbox" id="scSelecionarTodos" class="sc-check">
                        Selecionar disponíveis
                    </label>
                    <span id="scResumo">0 sugestões</span>
                    <span id="scResumoSelecionados">0 selecionadas</span>
                </div>

                <div class="sc-list-wrap">
                    <div class="sc-list" id="scBody"></div>
                    <div id="scEmpty" class="sc-empty" style="display:none"></div>
                </div>
            </div>
        `;

        blocoCadastro.parentElement.insertBefore(tabs, blocoCadastro);
        blocoCadastro.parentElement.insertBefore(panel, blocoCadastro.nextSibling);
    }

    if ($('scTabs')?.dataset.bound === '1') return;
    if ($('scTabs')) $('scTabs').dataset.bound = '1';

    $('scTabCadastro')?.addEventListener('click', () => trocarAbaCadastro('CADASTRO'));
    $('scTabSugestao')?.addEventListener('click', () => trocarAbaCadastro('SUGESTAO'));
    $('scAtualizar')?.addEventListener('click', () => carregarSugestoesColetadas(true));
    $('scCadastrarSelecionados')?.addEventListener('click', onCadastrarSugestoesColetadas);

    $('scSelecionarTodos')?.addEventListener('change', e => {
        const marcar = !!e.target.checked;
        document.querySelectorAll('#scBody .sc-check[data-assinatura]:not(:disabled)')
            .forEach(el => el.checked = marcar);
        atualizarResumoSelecaoSugestoes();
    });

    $('scBody')?.addEventListener('change', e => {
        if (e.target.matches('.sc-check[data-assinatura]')) {
            atualizarResumoSelecaoSugestoes();
        }
    });
}

function trocarAbaCadastro(aba) {
    abaCadastroAtiva = aba === 'SUGESTAO' ? 'SUGESTAO' : 'CADASTRO';

    const blocoCadastro = localizarBlocoCadastro();
    const panel = $('scPanel');
    const movimentacaoCard = $('movimentacaoCard');

    const emCadastro = abaCadastroAtiva === 'CADASTRO';
    const emSugestao = abaCadastroAtiva === 'SUGESTAO';

    $('scTabCadastro')?.classList.toggle('active', emCadastro);
    $('scTabSugestao')?.classList.toggle('active', emSugestao);

    if (blocoCadastro) {
        blocoCadastro.style.display = emCadastro ? '' : 'none';
    }

    if (movimentacaoCard) {
        movimentacaoCard.style.display = emCadastro ? '' : 'none';
    }

    panel?.classList.toggle('active', emSugestao);

    if (emSugestao) {
        carregarSugestoesColetadas();
    }
}

function normalizarDataIsoCurta(v) {
    return v ? String(v).slice(0, 10) : '';
}

function idadeColetaMinutos(dataIso) {
    if (!dataIso) return null;
    const dt = new Date(dataIso);
    if (Number.isNaN(dt.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - dt.getTime()) / 60000));
}

function motivoBloqueioSugestao(item) {
    if (item?.tipo_sugestao === 'PROVAVEL_CONCURSO_INCORRETO') {
        return `Provável concurso incorreto: SISLOT #${item.concurso_sislot_suspeito || '—'} → Marketplace #${item.concurso || '—'}`;
    }

    if (item?.tipo_sugestao === 'POSSIVEL_CADASTRO_INCORRETO') {
        return `Revisar cadastro: SISLOT #${item.concurso_sislot_suspeito || '—'} → Marketplace #${item.concurso || '—'}`;
    }

    const mapa = {
        ESPECIAL_NAO_CONFIGURADO: 'Especial sem calendário SISLOT',
        DATA_ESPECIAL_DIVERGENTE_MARKETPLACE: 'Data especial divergente',
        SEM_DATA_INICIAL_CALCULADA: 'Sem data inicial',
        SEM_DATA_CONCURSO: 'Sem data do concurso',
        MODALIDADE_NAO_MAPEADA: 'Modalidade não mapeada'
    };

    return mapa[item?.motivo_bloqueio] || item?.motivo_bloqueio || 'Revisar';
}

function renderFreshnessSugestao() {
    const el = $('scFreshness');
    if (!el) return;

    const datas = SUGESTOES_COLETADAS
        .map(item => item.ultima_coleta_em)
        .filter(Boolean)
        .sort();

    const ultima = datas.length ? datas[datas.length - 1] : null;
    const mins = idadeColetaMinutos(ultima);

    if (mins === null) {
        el.innerHTML = '<span class="sc-fresh err">Sem informação de coleta recente.</span>';
        return;
    }

    const cls = mins <= 5 ? 'ok' : (mins <= 15 ? 'warn' : 'err');
    const texto = mins === 0 ? 'agora' : `há ${mins} min`;

    el.innerHTML = `
        <span class="sc-fresh ${cls}">
            Marketplace atualizado ${texto}
        </span>
        ${ultima ? ` · ${new Date(ultima).toLocaleString('pt-BR')}` : ''}
    `;
}


function scClasseModalidade(modalidade) {
    return String(modalidade || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function scPlural(qtd, singular, plural) {
    return `${Number(qtd || 0)} ${Number(qtd || 0) === 1 ? singular : plural}`;
}

function scChip(texto, classe = '') {
    return `<span class="sc-meta-chip ${classe}">${escaparHtml(texto)}</span>`;
}

function scStatusCard(item) {
    const suspeitaConcurso = item.tipo_sugestao === 'PROVAVEL_CONCURSO_INCORRETO';
    const suspeitaCadastro = item.tipo_sugestao === 'POSSIVEL_CADASTRO_INCORRETO';

    if (suspeitaConcurso) {
        return `
            <div class="sc-card-status err">
                <i class="fas fa-triangle-exclamation"></i>
                <span>Provável concurso incorreto</span>
                <span class="sc-card-status-detail">
                    SISLOT #${escaparHtml(item.concurso_sislot_suspeito || '—')}
                    → Marketplace #${escaparHtml(item.concurso || '—')}
                </span>
            </div>
        `;
    }

    if (suspeitaCadastro) {
        return `
            <div class="sc-card-status warn">
                <i class="fas fa-magnifying-glass"></i>
                <span>Possível cadastro incorreto</span>
                <span class="sc-card-status-detail">${escaparHtml(item.alerta_inteligencia || motivoBloqueioSugestao(item))}</span>
            </div>
        `;
    }

    if (item.selecionavel) {
        return `
            <div class="sc-card-status ok">
                <i class="fas fa-circle-check"></i>
                <span>Pronto para cadastrar e vincular</span>
            </div>
        `;
    }

    return `
        <div class="sc-card-status err">
            <i class="fas fa-circle-exclamation"></i>
            <span>${escaparHtml(motivoBloqueioSugestao(item))}</span>
        </div>
    `;
}

function scCriarCardSugestao(item) {
    const selecionavel = !!item.selecionavel;
    const suspeitaConcurso = item.tipo_sugestao === 'PROVAVEL_CONCURSO_INCORRETO';
    const suspeitaCadastro = item.tipo_sugestao === 'POSSIVEL_CADASTRO_INCORRETO';
    const revisar = suspeitaConcurso || suspeitaCadastro;

    const card = document.createElement('article');
    card.className = `sc-bolao-card${revisar ? ' sc-bolao-card-alert' : ''}${selecionavel ? ' sc-bolao-card-selectable' : ''}`;
    card.dataset.assinatura = item.assinatura_sugestao || '';

    if (item.alerta_inteligencia) {
        card.title = item.alerta_inteligencia;
    }

    const modalidade = item.modalidade_sislot || item.modalidade_marketplace || '—';
    const origem = item.loterica_nome || loteriaAtiva?.loteria_nome || '—';

    const valorMarketplaceDifere =
        item.valor_cota_modelo != null &&
        Math.abs(Number(item.valor_cota_modelo) - Number(item.valor_cota_marketplace)) > 0.0001;

    const periodoInicial = normalizarDataIsoCurta(item.dt_inicial_sugerida);
    const periodoFinal = normalizarDataIsoCurta(item.dt_concurso_sugerida);

    card.innerHTML = `
        <div class="sc-bolao-main">
            <div class="sc-bolao-top">
                <div class="sc-bolao-ident">
                    <strong class="sc-bolao-modalidade">${escaparHtml(modalidade)}</strong>

                    <span class="sc-concurso-badge ${revisar ? 'alert' : ''}">
                        #${escaparHtml(item.concurso)}
                    </span>

                    <span class="sc-origem-badge">${escaparHtml(origem)}</span>

                    ${item.eh_especial ? '<span class="sc-special-badge">Especial</span>' : ''}
                </div>

                <label class="sc-card-check-wrap" title="${selecionavel ? 'Selecionar para cadastrar' : motivoBloqueioSugestao(item)}">
                    <input
                        type="checkbox"
                        class="sc-check sc-card-check"
                        data-assinatura="${escaparHtml(item.assinatura_sugestao)}"
                        ${selecionavel ? '' : 'disabled'}
                        aria-label="${selecionavel ? 'Selecionar sugestão' : 'Sugestão bloqueada para revisão'}"
                    >
                    <span class="sc-check-visual"></span>
                </label>
            </div>

            <div class="sc-meta-row">
                ${scChip(scPlural(item.qtd_jogos, 'jogo', 'jogos'))}
                ${scChip(`${Number(item.qtd_dezenas || 0)} dez.`)}
                ${scChip(`${Number(item.qtd_cotas_total || 0)} cotas`)}
                ${scChip(`${fmtBRL(item.valor_cota_sugerido)}/cota`, 'price')}
            </div>

            <div class="sc-meta-row sc-meta-row-secondary">
                ${scChip(scPlural(item.qtd_codigos_caixa, 'código Caixa', 'códigos Caixa'), 'secondary')}
                ${periodoFinal ? scChip(`Sorteio ${fmtData(periodoFinal)}`, 'secondary') : ''}
                ${
                    periodoInicial && periodoFinal && periodoInicial !== periodoFinal
                        ? scChip(`Início ${fmtData(periodoInicial)}`, 'secondary')
                        : ''
                }
                ${
                    valorMarketplaceDifere
                        ? scChip(`MKP ${fmtBRL(item.valor_cota_marketplace)}`, 'secondary')
                        : ''
                }
            </div>

            ${
                revisar
                    ? `
                        <div class="sc-compare-row">
                            <span class="sc-compare-chip mkp">
                                Marketplace <b>#${escaparHtml(item.concurso)}</b>
                            </span>
                            <i class="fas fa-arrows-left-right"></i>
                            <span class="sc-compare-chip sislot">
                                SISLOT <b>#${escaparHtml(item.concurso_sislot_suspeito || '—')}</b>
                            </span>
                        </div>
                    `
                    : ''
            }

            ${scStatusCard(item)}
        </div>
    `;

    if (selecionavel) {
        card.addEventListener('click', e => {
            if (e.target.closest('input, label, button, a')) return;
            const check = card.querySelector('.sc-card-check');
            if (!check || check.disabled) return;
            check.checked = !check.checked;
            check.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    return card;
}

function renderSugestoesColetadas() {
    const body = $('scBody');
    const empty = $('scEmpty');
    if (!body || !empty) return;

    $('scLojaNome').textContent = loteriaAtiva?.loteria_nome || '—';
    body.innerHTML = '';

    if (!SUGESTOES_COLETADAS.length) {
        empty.style.display = 'block';
        empty.innerHTML = `
            <i class="fas fa-circle-check"></i><br>
            Nenhum bolão corrente coletado aguardando cadastro ou revisão nesta origem.
        `;
        $('scTabCount').textContent = '';
        atualizarResumoSelecaoSugestoes();
        renderFreshnessSugestao();
        return;
    }

    empty.style.display = 'none';

    const grupos = new Map();

    SUGESTOES_COLETADAS.forEach(item => {
        const nome = item.modalidade_sislot || item.modalidade_marketplace || 'Outros';
        if (!grupos.has(nome)) grupos.set(nome, []);
        grupos.get(nome).push(item);
    });

    [...grupos.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
        .forEach(([modalidade, itens]) => {
            const section = document.createElement('section');
            section.className = `sc-group sc-group-${scClasseModalidade(modalidade)}`;

            const qtdDisponiveis = itens.filter(i => i.selecionavel).length;
            const qtdRevisao = itens.filter(i =>
                i.tipo_sugestao === 'PROVAVEL_CONCURSO_INCORRETO' ||
                i.tipo_sugestao === 'POSSIVEL_CADASTRO_INCORRETO'
            ).length;

            section.innerHTML = `
                <div class="sc-group-head">
                    <span class="sc-group-name">${escaparHtml(modalidade)}</span>
                    <span class="sc-group-line"></span>
                    <span class="sc-group-count">${itens.length}</span>
                    ${
                        qtdRevisao
                            ? `<span class="sc-group-review">${qtdRevisao} revisão</span>`
                            : (qtdDisponiveis
                                ? `<span class="sc-group-ready">${qtdDisponiveis} disponível${qtdDisponiveis > 1 ? 'is' : ''}</span>`
                                : '')
                    }
                </div>

                <div class="sc-group-cards"></div>
            `;

            const cards = section.querySelector('.sc-group-cards');

            itens
                .sort((a, b) =>
                    String(a.concurso).localeCompare(String(b.concurso), 'pt-BR', { numeric: true }) ||
                    Number(a.qtd_jogos || 0) - Number(b.qtd_jogos || 0) ||
                    Number(a.qtd_dezenas || 0) - Number(b.qtd_dezenas || 0)
                )
                .forEach(item => cards.appendChild(scCriarCardSugestao(item)));

            body.appendChild(section);
        });

    const selecionaveis = SUGESTOES_COLETADAS.filter(i => i.selecionavel).length;
    const revisoes = SUGESTOES_COLETADAS.filter(i =>
        i.tipo_sugestao === 'PROVAVEL_CONCURSO_INCORRETO' ||
        i.tipo_sugestao === 'POSSIVEL_CADASTRO_INCORRETO'
    ).length;
    const totalPendencias = selecionaveis + revisoes;

    $('scTabCount').textContent = totalPendencias ? ` (${totalPendencias})` : '';

    renderFreshnessSugestao();
    atualizarResumoSelecaoSugestoes();
}

async function carregarSugestoesColetadas(forcar = false) {
    if (carregandoSugestoesColetadas || !loteriaAtiva?.loteria_id) return;
    if (!forcar && abaCadastroAtiva !== 'SUGESTAO') return;

    carregandoSugestoesColetadas = true;

    const btn = $('scAtualizar');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando';
    }

    const empty = $('scEmpty');
    if (empty) {
        empty.style.display = 'block';
        empty.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando sugestões coletadas…';
    }

    try {
        const { data, error } = await sb.rpc(
            'fn_listar_sugestoes_coletadas',
            { p_loteria_id: Number(loteriaAtiva.loteria_id) }
        );

        if (error) throw new Error(error.message);

        SUGESTOES_COLETADAS = Array.isArray(data) ? data : [];
        renderSugestoesColetadas();

    } catch (e) {
        SUGESTOES_COLETADAS = [];
        if (empty) {
            empty.style.display = 'block';
            empty.textContent = e.message || 'Erro ao carregar Sugestão Coletada.';
        }
        setStatus('status', e.message || 'Erro ao carregar Sugestão Coletada.', 'err', 'exclamation-circle');

    } finally {
        carregandoSugestoesColetadas = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rotate"></i> Atualizar';
        }
    }
}

function sugestoesSelecionadas() {
    const assinaturas = new Set(
        [...document.querySelectorAll('#scBody .sc-check[data-assinatura]:checked')]
            .map(el => el.dataset.assinatura)
            .filter(Boolean)
    );

    return SUGESTOES_COLETADAS.filter(item =>
        item.selecionavel &&
        assinaturas.has(item.assinatura_sugestao)
    );
}

function atualizarResumoSelecaoSugestoes() {
    const total = SUGESTOES_COLETADAS.length;
    const selecionaveis = SUGESTOES_COLETADAS.filter(i => i.selecionavel).length;
    const revisoes = SUGESTOES_COLETADAS.filter(i =>
        i.tipo_sugestao === 'PROVAVEL_CONCURSO_INCORRETO' ||
        i.tipo_sugestao === 'POSSIVEL_CADASTRO_INCORRETO'
    ).length;
    const selecionadas = sugestoesSelecionadas();
    const cotas = selecionadas.reduce((s, i) => s + Number(i.qtd_cotas_total || 0), 0);
    const codigos = selecionadas.reduce((s, i) => s + Number(i.qtd_codigos_caixa || 0), 0);

    if ($('scResumo')) {
        $('scResumo').textContent =
            `${total} ocorrências · ${selecionaveis} disponíveis · ${revisoes} para revisão`;
    }

    if ($('scResumoSelecionados')) {
        $('scResumoSelecionados').textContent =
            `${selecionadas.length} selecionadas · ${codigos} códigos · ${cotas} cotas`;
    }

    const btn = $('scCadastrarSelecionados');
    if (btn) {
        btn.disabled = selecionadas.length === 0;
        btn.innerHTML = selecionadas.length
            ? `<i class="fas fa-link"></i> Cadastrar e vincular ${selecionadas.length}`
            : '<i class="fas fa-link"></i> Cadastrar e vincular selecionados';
    }

    const all = $('scSelecionarTodos');
    if (all) {
        const marcadas = document.querySelectorAll(
            '#scBody .sc-check[data-assinatura]:checked'
        ).length;
        all.checked = selecionaveis > 0 && marcadas === selecionaveis;
        all.indeterminate = marcadas > 0 && marcadas < selecionaveis;
    }
}

async function onCadastrarSugestoesColetadas() {
    const selecionadas = sugestoesSelecionadas();
    if (!selecionadas.length) return;

    const totalCotas = selecionadas.reduce((s, i) => s + Number(i.qtd_cotas_total || 0), 0);
    const totalCodigos = selecionadas.reduce((s, i) => s + Number(i.qtd_codigos_caixa || 0), 0);

    const linhas = [
        '✨ SUGESTÃO COLETADA', '',
        `📍 Origem: ${loteriaAtiva?.loteria_nome || '—'}`,
        `📦 ${selecionadas.length} bolão(ões)`,
        `🔗 ${totalCodigos} código(s) Caixa`,
        `🎫 ${totalCotas} cotas`, '',
        ...selecionadas.slice(0, 12).map(item =>
            `• ${item.modalidade_sislot} ${item.concurso} · ` +
            `${item.qtd_jogos}x${item.qtd_dezenas} · ` +
            `${fmtBRL(item.valor_cota_sugerido)} · ${item.qtd_cotas_total} cotas`
        ),
        selecionadas.length > 12 ? `• … e mais ${selecionadas.length - 12}` : '',
        '',
        'Os bolões serão cadastrados, vinculados aos códigos Caixa e terão coleta detalhada solicitada.',
        '',
        'Confirma?'
    ].filter(Boolean);

    showModal({
        title: 'Cadastrar Sugestões Coletadas',
        body: linhas.join('\n'),
        onConfirm: async () => {
            const btn = $('scCadastrarSelecionados');

            try {
                setBtnLoading(btn, true);
                setStatus(
                    'status',
                    'Cadastrando e vinculando sugestões…',
                    'muted',
                    'spinner fa-spin'
                );

                const { data, error } = await sb.rpc(
                    'fn_cadastrar_sugestoes_coletadas',
                    {
                        p_assinaturas: selecionadas.map(i => i.assinatura_sugestao)
                    }
                );

                if (error) throw new Error(error.message);

                const criados = Number(data?.criados || 0);
                const vinculos = Number(data?.vinculos_criados || 0);
                const detalhes = Number(data?.detalhes_solicitados || 0);
                const ignorados = Number(data?.ignorados || 0);
                const erros = Array.isArray(data?.erros) ? data.erros : [];

                if (erros.length) {
                    const mensagem = erros
                        .slice(0, 3)
                        .map(e => e.erro)
                        .join(' | ');

                    setStatus(
                        'status',
                        `Concluído com ressalvas: ${criados} cadastrados, ${erros.length} erro(s). ${mensagem}`,
                        'err',
                        'triangle-exclamation'
                    );
                } else {
                    setStatus(
                        'status',
                        `✓ ${criados} bolão(ões) cadastrados · ${vinculos} vínculos · ${detalhes} coletas detalhadas solicitadas${ignorados ? ` · ${ignorados} ignorados` : ''}`,
                        'ok',
                        'check-double'
                    );
                }

                await carregarSugestoesColetadas(true);

            } catch (e) {
                setStatus(
                    'status',
                    e.message || 'Erro ao cadastrar sugestões coletadas.',
                    'err',
                    'exclamation-circle'
                );
            } finally {
                setBtnLoading(btn, false);
                atualizarResumoSelecaoSugestoes();
            }
        }
    });
}


/************************************************************
 * FEDERAL
 ************************************************************/
function applyFederalUI() {
    const modal = $('modalidade')?.value;
    const isFed = modal === 'Federal';
    const j = $('qtdJogos');
    const d = $('qtdDezenas');

    if (j) j.disabled = isFed;
    if (d) d.disabled = isFed;

    if (isFed) {
        if (j) j.value = '0';
        if (d) d.value = '0';
    } else {
        if (j && j.value === '0') j.value = '';
        if (d && d.value === '0') d.value = '';
    }
}

/************************************************************
 * DRAFT
 ************************************************************/
function saveDraft() {
    const d = {};
    CAMPOS_FORM.forEach(id => d[id] = $(id)?.value ?? '');

    d._movimentacoes = {};
    lojasMovimentacao.forEach(loja => {
        const input = getCampoMov(loja);
        if (input) d._movimentacoes[String(loja.loteria_id)] = input.value ?? '';
    });

    d._mod = localStorage.getItem('sl_active_mod') || '';
    d._slug = loteriaAtiva?.loteria_slug || '';

    try {
        localStorage.setItem('sl_draft', JSON.stringify(d));
    } catch {}
}

function loadDraft() {
    try {
        const raw = localStorage.getItem('sl_draft');
        if (!raw) return;

        const d = JSON.parse(raw);

        CAMPOS_FORM.forEach(id => {
            const el = $(id);
            if (el && d[id] !== undefined) el.value = d[id];
        });

        if (d._mod) {
            localStorage.setItem('sl_active_mod', d._mod);
            const modalidadeEl = $('modalidade');
            if (modalidadeEl) modalidadeEl.value = d._mod;
            setActiveModBtn(d._mod);
            renderChips(d._mod);
        }

        atualizarCamposMov();

        lojasMovimentacao.forEach(loja => {
            const el = getCampoMov(loja);
            if (!el || el.disabled) return;

            const novoFormato = d._movimentacoes || {};
            let valor = novoFormato[String(loja.loteria_id)];

            if (valor === undefined) {
                valor = novoFormato[loja.loteria_slug];
            }

            // Migração genérica: usa os IDs encontrados no HTML antigo,
            // sem manter um mapa fixo de slugs no JavaScript.
            if (valor === undefined) {
                const idLegado = mapaCamposMovLegado[loja.loteria_slug];
                if (idLegado && d[idLegado] !== undefined) valor = d[idLegado];
            }

            if (valor !== undefined) el.value = valor;
        });
    } catch (erro) {
        console.warn('Não foi possível restaurar o rascunho:', erro);
    }
}

function limparCamposMovimentacao() {
    lojasMovimentacao.forEach(loja => {
        const el = getCampoMov(loja);
        if (el && !el.disabled) el.value = '';
    });
}

function limparFormCompletoMantendoModalidade(modKey) {
    CAMPOS_FORM.forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });

    limparCamposMovimentacao();

    const modalidadeEl = $('modalidade');
    if (modalidadeEl) modalidadeEl.value = modKey;

    const dataInicialEl = $('dataInicial');
    if (dataInicialEl) dataInicialEl.value = '';

    const dataConcursoEl = $('dataConcurso');
    if (dataConcursoEl) dataConcursoEl.value = '';

    localStorage.removeItem('sl_draft');

    if (modKey) {
        localStorage.setItem('sl_active_mod', modKey);
    } else {
        localStorage.removeItem('sl_active_mod');
    }

    setActiveModBtn(modKey);
    renderChips(modKey);
    applyFederalUI();
    saveDraft();
}

function limparFormSemLoja() {
    CAMPOS_FORM.forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });

    limparCamposMovimentacao();

    localStorage.removeItem('sl_draft');
    localStorage.removeItem('sl_active_mod');

    setActiveModBtn('');
    renderChips('');
    applyFederalUI();
}

function limparMov() {
    limparCamposMovimentacao();
    saveDraft();
}

/************************************************************
 * VALIDAÇÃO/************************************************************
 * VALIDAÇÃO
 ************************************************************/
function validarBase(exigirCotas = true) {
    const modalidade = $('modalidade')?.value?.trim() || '';
    const concurso = $('concurso')?.value?.trim() || '';
    const dataInicial = $('dataInicial')?.value || '';
    const dataConcurso = $('dataConcurso')?.value || '';
    const qtdJogos = parseInt($('qtdJogos')?.value) || 0;
    const qtdDezenas = parseInt($('qtdDezenas')?.value) || 0;
    const valorCota = parseCota($('valorCota')?.value);
    const cotas = parseInt($('cotas')?.value) || 0;

    if (!modalidade) throw new Error('Modalidade é obrigatória.');
    if (!concurso) throw new Error('Número do concurso é obrigatório.');
    if (!dataInicial) throw new Error('Data inicial é obrigatória.');
    if (!dataConcurso) throw new Error('Data do concurso é obrigatória.');
    if (!valorCota || valorCota <= 0) throw new Error('Valor da cota deve ser > 0.');
    if (exigirCotas && cotas === 0) throw new Error('Qtd de cotas é obrigatória.');

    return { modalidade, concurso, dataInicial, dataConcurso, qtdJogos, qtdDezenas, valorCota, cotas };
}


/************************************************************
 * VALIDAÇÃO INTELIGENTE DE CONCURSO E DATAS
 ************************************************************/

function chaveModalidadeComparacao(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

function dataISOAdicionarDias(valor, dias) {
    if (!valor) return '';
    const [ano, mes, dia] = String(valor).slice(0, 10).split('-').map(Number);
    if (!ano || !mes || !dia) return '';

    const dt = new Date(ano, mes - 1, dia, 12, 0, 0, 0);
    dt.setDate(dt.getDate() + Number(dias || 0));

    return [
        dt.getFullYear(),
        String(dt.getMonth() + 1).padStart(2, '0'),
        String(dt.getDate()).padStart(2, '0')
    ].join('-');
}

function proximoDiaOperacional(valor) {
    let data = dataISOAdicionarDias(valor, 1);
    if (!data) return '';

    const [ano, mes, dia] = data.split('-').map(Number);
    const dt = new Date(ano, mes - 1, dia, 12, 0, 0, 0);

    // Regra operacional observada no SISLOT: domingo pula para segunda.
    if (dt.getDay() === 0) {
        data = dataISOAdicionarDias(data, 1);
    }

    return data;
}

function modaDatas(registros, campo) {
    const contagem = new Map();

    (registros || []).forEach(item => {
        const valor = item?.[campo];
        if (!valor) return;
        const data = String(valor).slice(0, 10);
        contagem.set(data, (contagem.get(data) || 0) + 1);
    });

    const ordenadas = [...contagem.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    if (!ordenadas.length) {
        return { data: '', ocorrencias: 0, alternativas: [] };
    }

    return {
        data: ordenadas[0][0],
        ocorrencias: ordenadas[0][1],
        alternativas: ordenadas.map(([data, ocorrencias]) => ({ data, ocorrencias }))
    };
}

async function buscarDataConcursoMarketplace(modalidade, concurso) {
    if (!modalidade || !concurso) {
        return { data: '', fonte: '', alternativas: [] };
    }

    const { data, error } = await sb
        .from('marketplace_caixa_boloes')
        .select('modalidade, concurso, dt_sorteio, tipo_concurso')
        .eq('concurso', String(concurso))
        .not('dt_sorteio', 'is', null)
        .limit(1000);

    if (error) {
        console.warn('Falha ao validar data no Marketplace:', error);
        return { data: '', fonte: '', alternativas: [] };
    }

    const chave = chaveModalidadeComparacao(modalidade);
    const compativeis = (data || []).filter(item =>
        chaveModalidadeComparacao(item.modalidade) === chave
    );

    const moda = modaDatas(compativeis, 'dt_sorteio');

    return {
        data: moda.data,
        fonte: moda.data ? 'MARKETPLACE' : '',
        alternativas: moda.alternativas
    };
}

async function buscarReferenciaSislotMesmoConcurso(modalidade, concurso) {
    const { data, error } = await sb
        .from('boloes')
        .select('dt_inicial, dt_concurso, loteria_id')
        .eq('modalidade', modalidade)
        .eq('concurso', String(concurso))
        .neq('status', 'CANCELADO')
        .limit(1000);

    if (error) {
        console.warn('Falha ao consultar referência SISLOT:', error);
        return {
            dtInicial: '',
            dtConcurso: '',
            qtdRegistros: 0,
            alternativasInicial: [],
            alternativasConcurso: []
        };
    }

    const modaInicial = modaDatas(data || [], 'dt_inicial');
    const modaConcurso = modaDatas(data || [], 'dt_concurso');

    return {
        dtInicial: modaInicial.data,
        dtConcurso: modaConcurso.data,
        qtdRegistros: (data || []).length,
        alternativasInicial: modaInicial.alternativas,
        alternativasConcurso: modaConcurso.alternativas
    };
}

async function buscarConcursoAnteriorMesmaModalidade(modalidade, dataConcursoAtual) {
    if (!modalidade || !dataConcursoAtual) return null;

    const { data, error } = await sb
        .from('boloes')
        .select('concurso, dt_concurso')
        .eq('modalidade', modalidade)
        .neq('status', 'CANCELADO')
        .lt('dt_concurso', dataConcursoAtual)
        .order('dt_concurso', { ascending: false })
        .limit(200);

    if (error) {
        console.warn('Falha ao buscar concurso anterior:', error);
        return null;
    }

    if (!data?.length) return null;

    const dataMaisRecente = String(data[0].dt_concurso).slice(0, 10);
    const grupo = data.filter(item =>
        String(item.dt_concurso).slice(0, 10) === dataMaisRecente
    );

    const concursos = new Map();
    grupo.forEach(item => {
        const chave = String(item.concurso || '');
        concursos.set(chave, (concursos.get(chave) || 0) + 1);
    });

    const concursoAnterior = [...concursos.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] || String(grupo[0].concurso || '');

    return {
        concurso: concursoAnterior,
        dtConcurso: dataMaisRecente
    };
}

async function buscarSobreposicoesPeriodo(modalidade, concurso, dataInicial, dataConcurso) {
    if (!modalidade || !dataInicial || !dataConcurso) return [];

    const { data, error } = await sb
        .from('boloes')
        .select('id, concurso, dt_inicial, dt_concurso, loteria_id')
        .eq('modalidade', modalidade)
        .neq('status', 'CANCELADO')
        .neq('concurso', String(concurso))
        .lte('dt_inicial', dataConcurso)
        .gte('dt_concurso', dataInicial)
        .limit(50);

    if (error) {
        console.warn('Falha ao verificar sobreposição de concursos:', error);
        return [];
    }

    return data || [];
}

async function validarInteligenciaCadastro(b) {
    const avisos = [];
    const infos = [];

    // 1) Concurso especial: a tabela de especiais é a autoridade.
    const especial = ESPECIAIS[String(b.modalidade || '').trim()];

    if (especial) {
        if (String(b.concurso) !== String(especial.concurso)) {
            avisos.push(
                `Concurso informado ${b.concurso}; o especial ${b.modalidade} está padronizado como concurso ${especial.concurso}.`
            );
        }

        if (b.dataInicial !== especial.dataInicial) {
            avisos.push(
                `Data inicial informada ${fmtData(b.dataInicial)}; o padrão do especial é ${fmtData(especial.dataInicial)}.`
            );
        }

        if (b.dataConcurso !== especial.dataConcurso) {
            avisos.push(
                `Data do concurso informada ${fmtData(b.dataConcurso)}; o padrão do especial é ${fmtData(especial.dataConcurso)}.`
            );
        }

        if (!avisos.length) {
            infos.push('Concurso especial validado pelo calendário SISLOT.');
        }

        return {
            tipo: 'ESPECIAL',
            avisos,
            infos,
            dataConcursoEsperada: especial.dataConcurso || '',
            dataInicialEsperada: especial.dataInicial || '',
            fonteDataConcurso: 'ESPECIAIS_SISLOT'
        };
    }

    // 2) Concurso regular: Marketplace é a primeira referência para o sorteio.
    const refMarketplace = await buscarDataConcursoMarketplace(
        b.modalidade,
        b.concurso
    );

    // 3) Se o Marketplace ainda não tiver referência, usamos o consenso do SISLOT.
    const refSislot = await buscarReferenciaSislotMesmoConcurso(
        b.modalidade,
        b.concurso
    );

    let dataConcursoEsperada = refMarketplace.data || refSislot.dtConcurso || '';
    let fonteDataConcurso = refMarketplace.data
        ? 'MARKETPLACE'
        : (refSislot.dtConcurso ? 'SISLOT' : '');

    if (dataConcursoEsperada) {
        if (b.dataConcurso !== dataConcursoEsperada) {
            avisos.push(
                `Data do concurso informada ${fmtData(b.dataConcurso)}; referência ${fmtData(dataConcursoEsperada)} (${fonteDataConcurso}).`
            );
        } else {
            infos.push(
                `Data do concurso validada por ${fonteDataConcurso === 'MARKETPLACE' ? 'Marketplace' : 'cadastros SISLOT'}.`
            );
        }
    } else {
        infos.push('Ainda não há referência externa suficiente para validar a data do sorteio.');
    }

    // 4) A data inicial é o primeiro dia operacional posterior ao concurso anterior
    // da mesma modalidade.
    const baseDataAtual = dataConcursoEsperada || b.dataConcurso;
    const anterior = await buscarConcursoAnteriorMesmaModalidade(
        b.modalidade,
        baseDataAtual
    );

    let dataInicialEsperada = '';

    if (anterior?.dtConcurso) {
        dataInicialEsperada = proximoDiaOperacional(anterior.dtConcurso);

        if (b.dataInicial !== dataInicialEsperada) {
            avisos.push(
                `Data inicial informada ${fmtData(b.dataInicial)}; pelo concurso anterior ${anterior.concurso} (${fmtData(anterior.dtConcurso)}), o padrão esperado é ${fmtData(dataInicialEsperada)}.`
            );
        } else {
            infos.push(
                `Data inicial compatível com o encerramento do concurso ${anterior.concurso}.`
            );
        }
    } else if (refSislot.dtInicial) {
        dataInicialEsperada = refSislot.dtInicial;

        if (b.dataInicial !== dataInicialEsperada) {
            avisos.push(
                `Data inicial informada ${fmtData(b.dataInicial)}; cadastros existentes deste concurso usam ${fmtData(dataInicialEsperada)}.`
            );
        }
    }

    // 5) Regras básicas de coerência.
    if (b.dataInicial > b.dataConcurso) {
        avisos.push('A data inicial não pode ser posterior à data do concurso.');
    }

    // 6) Não deve existir sobreposição entre concursos regulares da mesma modalidade.
    const sobreposicoes = await buscarSobreposicoesPeriodo(
        b.modalidade,
        b.concurso,
        b.dataInicial,
        b.dataConcurso
    );

    if (sobreposicoes.length) {
        const concursos = [...new Set(sobreposicoes.map(item => item.concurso))]
            .slice(0, 5)
            .join(', ');

        avisos.push(
            `O período informado se sobrepõe a outro concurso da mesma modalidade (${concursos}).`
        );
    }

    return {
        tipo: 'REGULAR',
        avisos,
        infos,
        dataConcursoEsperada,
        dataInicialEsperada,
        fonteDataConcurso
    };
}

function montarResumoValidacaoCadastro(resultado) {
    const linhas = [];

    if (resultado?.avisos?.length) {
        linhas.push('⚠️ ATENÇÃO ANTES DE CADASTRAR', '');

        resultado.avisos.forEach(aviso => {
            linhas.push(`• ${aviso}`);
        });

        linhas.push(
            '',
            'Revise os dados. Se estiverem intencionalmente corretos, você ainda poderá confirmar o cadastro.'
        );
    } else {
        linhas.push('✓ Validação de concurso e datas concluída.');

        (resultado?.infos || []).forEach(info => {
            linhas.push(`• ${info}`);
        });
    }

    return linhas.join('\n');
}


/************************************************************
 * CADASTRAR
 ************************************************************/
async function onCadastrar() {
    const btn = $('btnCadastrar');
    if (!btn) return;

    try {
        const b = validarBase(true);
        if (!loteriaAtiva) throw new Error('Nenhuma loja selecionada.');

        setBtnLoading(btn, true);
        setStatus(
            'status',
            'Validando concurso e datas…',
            'muted',
            'spinner fa-spin'
        );

        let validacao;
        try {
            validacao = await validarInteligenciaCadastro(b);
        } finally {
            setBtnLoading(btn, false);
        }

        const abrirConfirmacaoFinal = () => {
            const corpo = [
                '🧾 CONFIRMAÇÃO DE CADASTRO', '',
                `📍 Origem: ${loteriaAtiva.loteria_nome}`,
                `🎯 ${b.modalidade} | Concurso: ${b.concurso}`,
                `🗓️ ${fmtData(b.dataInicial)} → ${fmtData(b.dataConcurso)}`,
                `🎮 ${b.qtdJogos} jogos de ${b.qtdDezenas} dezenas`,
                `💰 Cota: ${fmtBRL(b.valorCota)} | ${b.cotas} cotas`,
                '',
                validacao?.avisos?.length
                    ? '⚠️ Cadastro possui alerta de validação.'
                    : '✓ Concurso e datas validados.',
                '',
                'Confirma o cadastro?'
            ].join('\n');

            showModal({
                title: 'Confirmar cadastro',
                body: corpo,
                onConfirm: async () => {
                    setBtnLoading(btn, true);
                    setStatus('status', 'Salvando bolão…', 'muted', 'spinner fa-spin');

                    try {
                        await doCadastrar(b);
                    } catch (e) {
                        setStatus('status', e.message, 'err', 'exclamation-circle');
                    } finally {
                        setBtnLoading(btn, false);
                    }
                }
            });
        };

        if (validacao?.avisos?.length) {
            setStatus(
                'status',
                `${validacao.avisos.length} alerta(s) encontrado(s). Revise antes de confirmar.`,
                'err',
                'triangle-exclamation'
            );

            showModal({
                title: 'Revisão especial do cadastro',
                body: montarResumoValidacaoCadastro(validacao),
                onConfirm: abrirConfirmacaoFinal,
                onCancel: () => {
                    setStatus(
                        'status',
                        'Cadastro não confirmado. Revise os campos destacados pela validação.',
                        'muted',
                        'pen-to-square'
                    );
                }
            });

            return;
        }

        setStatus(
            'status',
            validacao?.tipo === 'ESPECIAL'
                ? '✓ Concurso especial e datas validados.'
                : '✓ Concurso e datas validados.',
            'ok',
            'calendar-check'
        );

        abrirConfirmacaoFinal();

    } catch (e) {
        setBtnLoading(btn, false);
        setStatus('status', e.message, 'err', 'exclamation-circle');
    }
}

async function doCadastrar(b, somarCotas = false) {
    const loteriaId = loteriaAtiva.loteria_id;

    const { data: existe } = await sb
        .from('boloes')
        .select('id, qtd_cotas_total, dt_inicial, dt_concurso')
        .eq('loteria_id', loteriaId)
        .eq('modalidade', b.modalidade)
        .eq('concurso', b.concurso)
        .eq('valor_cota', b.valorCota)
        .eq('qtd_jogos', b.qtdJogos)
        .eq('qtd_dezenas', b.qtdDezenas)
        .neq('status', 'CANCELADO')
        .maybeSingle();

    if (
        existe &&
        (
            String(existe.dt_inicial || '').slice(0, 10) !== String(b.dataInicial || '').slice(0, 10) ||
            String(existe.dt_concurso || '').slice(0, 10) !== String(b.dataConcurso || '').slice(0, 10)
        )
    ) {
        throw new Error(
            `Existe um bolão com a mesma estrutura, mas com datas diferentes. ` +
            `Cadastro existente: ${fmtData(existe.dt_inicial)} → ${fmtData(existe.dt_concurso)}. ` +
            `Novo cadastro: ${fmtData(b.dataInicial)} → ${fmtData(b.dataConcurso)}. ` +
            `Revise/corrija o cadastro existente antes de somar novas cotas.`
        );
    }

    if (existe && !somarCotas) {
        const corpo = [
            '⚠️ Este bolão já existe!', '',
            `${b.modalidade} — Concurso ${b.concurso}`,
            `${b.qtdJogos} jogos de ${b.qtdDezenas} dezenas`,
            `Cota: ${fmtBRL(b.valorCota)}`,
            `Cotas atuais: ${existe.qtd_cotas_total}`,
            `Adicionar mais ${b.cotas}? Novo total: ${existe.qtd_cotas_total + b.cotas}`
        ].join('\n');

        showModal({
            title: 'Bolão já existe',
            body: corpo,
            onConfirm: async () => {
                try {
                    await doCadastrar(b, true);
                } catch (e) {
                    setStatus('status', e.message, 'err', 'exclamation-circle');
                }
            }
        });

        setStatus('status', 'Aguardando confirmação…', 'muted', 'clock');
        return;
    }

    if (existe && somarCotas) {
        const novoTotal = existe.qtd_cotas_total + b.cotas;
        const { error } = await sb
            .from('boloes')
            .update({ qtd_cotas_total: novoTotal, updated_at: new Date().toISOString() })
            .eq('id', existe.id);

        if (error) throw new Error(error.message);

        setStatus('status', `✓ Cotas somadas! Novo total: ${novoTotal}`, 'ok', 'check-circle');
        return;
    }

    const { error } = await sb.from('boloes').insert({
        loteria_id:      loteriaId,
        criado_por:      usuario.id,
        modalidade:      b.modalidade,
        concurso:        b.concurso,
        codigo_loterico: loteriaAtiva.cod_loterico || loteriaAtiva.loteria_codigo || '',
        dt_inicial:      b.dataInicial,
        dt_concurso:     b.dataConcurso,
        qtd_jogos:       b.qtdJogos,
        qtd_dezenas:     b.qtdDezenas,
        valor_cota:      b.valorCota,
        qtd_cotas_total: b.cotas,
        status:          'ATIVO',
    });

    if (error) throw new Error(error.message);
    setStatus('status', '✓ Bolão cadastrado com sucesso!', 'ok', 'check-double');
}

/************************************************************
 * CANCELAR
 ************************************************************/
async function onDeletar() {
    const btn = $('btnDeletar');
    if (!btn) return;

    try {
        const b = validarBase(false);
        if (!loteriaAtiva) throw new Error('Nenhuma loja selecionada.');

        const { data: bolao } = await sb
            .from('boloes')
            .select('id, qtd_cotas_total')
            .eq('loteria_id', loteriaAtiva.loteria_id)
            .eq('modalidade', b.modalidade)
            .eq('concurso', b.concurso)
            .eq('valor_cota', b.valorCota)
            .eq('qtd_jogos', b.qtdJogos)
            .eq('qtd_dezenas', b.qtdDezenas)
            .neq('status', 'CANCELADO')
            .maybeSingle();

        if (!bolao) {
            setStatus('status', 'Bolão não encontrado.', 'err', 'exclamation-circle');
            return;
        }

        const corpo = [
            '🗑️ CONFIRMAÇÃO DE CANCELAMENTO', '',
            `📍 ${loteriaAtiva.loteria_nome}`,
            `🎯 ${b.modalidade} — Concurso ${b.concurso}`,
            `🎮 ${b.qtdJogos} jogos de ${b.qtdDezenas} dezenas`,
            `💰 Cota: ${fmtBRL(b.valorCota)} | ${bolao.qtd_cotas_total} cotas`, '',
            '⚠️ O bolão será marcado como CANCELADO. Confirma?'
        ].join('\n');

        showModal({
            title: 'Confirmar cancelamento',
            body: corpo,
            onConfirm: async () => {
                setBtnLoading(btn, true);
                try {
                    const { error } = await sb
                        .from('boloes')
                        .update({ status: 'CANCELADO', updated_at: new Date().toISOString() })
                        .eq('id', bolao.id);

                    if (error) throw new Error(error.message);
                    setStatus('status', '✓ Bolão cancelado.', 'ok', 'check-circle');
                } catch (e) {
                    setStatus('status', e.message, 'err', 'exclamation-circle');
                } finally {
                    setBtnLoading(btn, false);
                }
            }
        });
    } catch (e) {
        setStatus('status', e.message, 'err', 'exclamation-circle');
    }
}

/************************************************************
 * BUSCAR POSIÇÃO ATUAL
 ************************************************************/
async function onBuscar() {
    const btn = $('btnBuscar');
    if (!btn) return;

    try {
        const modal = $('modalidade')?.value?.trim() || '';
        const concurso = $('concurso')?.value?.trim() || '';
        const cota = parseCota($('valorCota')?.value);
        const jogos = parseInt($('qtdJogos')?.value) || 0;
        const dezenas = parseInt($('qtdDezenas')?.value) || 0;

        if (!modal || !concurso || !cota) {
            setStatus('status', 'Preencha modalidade, concurso e valor da cota para buscar.', 'err', 'exclamation-circle');
            return;
        }

        setBtnLoading(btn, true);
        setStatus('status', 'Buscando saldos…', 'muted', 'spinner fa-spin');

        let query = sb
            .from('boloes')
            .select('id, valor_cota, qtd_cotas_total, enc_fisico, enc_virtual, custo_jogo, status')
            .eq('loteria_id', loteriaAtiva.loteria_id)
            .eq('modalidade', modal)
            .eq('concurso', concurso)
            .eq('valor_cota', cota)
            .neq('status', 'CANCELADO');

        if (jogos > 0) query = query.eq('qtd_jogos', jogos);
        if (dezenas > 0) query = query.eq('qtd_dezenas', dezenas);

        const { data: bolao } = await query.maybeSingle();

        if (!bolao) {
            showModal({
                title: 'Não encontrado',
                body: [
                    '❌ Bolão não encontrado', '',
                    `Modalidade: ${modal}`,
                    `Concurso: ${concurso}`,
                    `Cota: ${fmtBRL(cota)}`, '',
                    'Verifique os dados ou cadastre primeiro.'
                ].join('\n')
            });

            setStatus('status', 'Bolão não localizado.', 'muted', 'info-circle');
            return;
        }

        const { data: destinos } = await sb
            .from('view_posicao_destinos')
            .select('*')
            .eq('bolao_id', bolao.id);

        const linhas = [
            `📍 ${loteriaAtiva.loteria_nome}`,
            `🎯 ${modal} — Concurso ${concurso}`,
            `💰 Cota: ${fmtBRL(cota)}`,
            `📦 Total: ${bolao.qtd_cotas_total} cotas`,
            `🏷️ Custo do jogo: ${fmtBRL(bolao.custo_jogo)}`,
            `📭 Encalhe origem: ${(bolao.enc_fisico || 0) + (bolao.enc_virtual || 0)}`, '',
            '📊 Distribuição por loja:'
        ];

        if (destinos && destinos.length) {
            destinos.forEach(d => {
                linhas.push(`  ${d.loteria_nome}: ${d.qtd_cotas_liquidas} cotas | encalhe ${d.qtd_encalhe} | vendido ~${d.qtd_vendida_apurada}`);
            });
        } else {
            linhas.push('  (nenhuma distribuição registrada)');
        }

        showModal({
            title: '🔍 Posição atual',
            body: linhas.join('\n')
        });

        setStatus('status', 'Busca concluída.', 'ok', 'check');
    } catch (e) {
        setStatus('status', e.message, 'err', 'exclamation-circle');
    } finally {
        setBtnLoading(btn, false);
    }
}

/************************************************************
 * MOVIMENTAR
 ************************************************************/
async function onMovimentar() {
    const btn = $('btnMovimentar');
    if (!btn) return;

    /*
     * Primeira proteção:
     * impede duplo clique enquanto consulta o bolão,
     * monta a confirmação ou registra no banco.
     */
    if (
        confirmacaoMovimentacaoAberta ||
        movimentacaoEmAndamento
    ) {
        setStatus(
            'status',
            'Uma movimentação já está sendo conferida ou registrada.',
            'muted',
            'clock'
        );
        return;
    }

    confirmacaoMovimentacaoAberta = true;
    setBtnLoading(btn, true);

    const liberarConfirmacao = () => {
        confirmacaoMovimentacaoAberta = false;

        if (!movimentacaoEmAndamento) {
            setBtnLoading(btn, false);
        }
    };

    try {
        const modal = $('modalidade')?.value?.trim() || '';
        const concurso = $('concurso')?.value?.trim() || '';
        const cota = parseCota($('valorCota')?.value);

        if (!loteriaAtiva?.loteria_id) {
            throw new Error('Nenhuma loja de origem selecionada.');
        }

        if (!modal || !concurso || !cota) {
            throw new Error(
                'Preencha modalidade, concurso e valor da cota.'
            );
        }
        const mapaDeltas = coletarMapaDeltas();

        const temDelta = Object.entries(mapaDeltas).some(
            ([destinoId, valor]) =>
                Number(destinoId) !== Number(loteriaAtiva.loteria_id) &&
                Number(valor) !== 0
        );

        if (!temDelta) {
            throw new Error(
                'Informe ao menos um valor de destino.'
            );
        }

        const { data: bolao, error: bolaoError } = await sb
            .from('boloes')
            .select('id, valor_cota, qtd_cotas_total')
            .eq('loteria_id', loteriaAtiva.loteria_id)
            .eq('modalidade', modal)
            .eq('concurso', concurso)
            .eq('valor_cota', cota)
            .neq('status', 'CANCELADO')
            .maybeSingle();

        if (bolaoError) {
            throw new Error(
                `Erro ao localizar o bolão: ${bolaoError.message}`
            );
        }

        if (!bolao) {
            throw new Error(
                'Bolão não encontrado. Cadastre antes de movimentar.'
            );
        }

        const { data: movs, error: movsError } = await sb
            .from('movimentacoes_cotas')
            .select(
                'loteria_destino, loteria_origem, qtd_cotas'
            )
            .eq('bolao_id', bolao.id)
            .eq('status', 'ATIVO');

        if (movsError) {
            throw new Error(
                `Erro ao carregar movimentações: ${movsError.message}`
            );
        }

        const saldoPorId = {};
        const historicoDetalhePorId = {};

        (movs || []).forEach(m => {
            const destId = Number(m.loteria_destino);
            const origemId = Number(m.loteria_origem);
            const qtd = Number(m.qtd_cotas || 0);

            if (origemId === Number(loteriaAtiva.loteria_id)) {
                saldoPorId[destId] =
                    Number(saldoPorId[destId] || 0) + qtd;

                if (!historicoDetalhePorId[destId]) {
                    historicoDetalhePorId[destId] = [];
                }

                historicoDetalhePorId[destId].push(qtd);
            }

            if (destId === Number(loteriaAtiva.loteria_id)) {
                saldoPorId[origemId] =
                    Number(saldoPorId[origemId] || 0) - qtd;

                if (!historicoDetalhePorId[origemId]) {
                    historicoDetalhePorId[origemId] = [];
                }

                historicoDetalhePorId[origemId].push(-qtd);
            }
        });

        const linhas = [
            `📍 Origem: ${loteriaAtiva.loteria_nome}`,
            `🎯 ${modal} — Concurso ${concurso}`,
            `🎫 Cota: ${fmtBRL(cota)}`,
            '',
            '📊 CONFERÊNCIA DE MOVIMENTAÇÃO:',
            '(Histórico [Mov] → Final)',
        ];

        lojasMovimentacao.forEach(loja => {
            const destId = Number(loja.loteria_id);
            const delta = Number(mapaDeltas[String(destId)] || 0);
            const nome = loja.loteria_nome || loja.loteria_slug || `Loja ${destId}`;
            const icone = getEmojiLoja(loja);
            const hist = historicoDetalhePorId[destId] || [];
            const saldo = Number(saldoPorId[destId] || 0);
            const final = saldo + delta;

            if (destId === Number(loteriaAtiva.loteria_id)) {
                return;
            }

            if (delta === 0 && hist.length === 0) {
                linhas.push(`${icone} ${nome}: 0 (sem alteração)`);
                return;
            }

            const histStr = hist.length
                ? hist.map(v => v < 0 ? `[${v}]` : String(v)).join(' + ')
                : '0';

            if (delta === 0) {
                linhas.push(`${icone} ${nome}: ${histStr} → ${saldo} (sem alteração)`);
                return;
            }

            const deltaStr = delta > 0 ? `[+${delta}]` : `[${delta}]`;
            linhas.push(`${icone} ${nome}: ${histStr} ${deltaStr} → ${final}`);
        });

        linhas.push(
            '',
            '⚠️ Confirma a atualização desses valores?'
        );

        /*
         * Segunda proteção:
         * cada confirmação só pode ser consumida uma vez.
         */
        let confirmacaoConsumida = false;

        showModal({
            title: 'Confirmar Movimentação',
            body: linhas.join('\n'),

            onConfirm: async () => {
                if (
                    confirmacaoConsumida ||
                    movimentacaoEmAndamento
                ) {
                    return;
                }

                confirmacaoConsumida = true;

                setStatus(
                    'status',
                    'Registrando movimentação…',
                    'muted',
                    'spinner fa-spin'
                );

                try {
                    await doMovimentar(
                        bolao,
                        mapaDeltas
                    );

                    setStatus(
                        'status',
                        '✓ Movimentação registrada!',
                        'ok',
                        'check-double'
                    );

                    limparMov();

                } catch (e) {
                    setStatus(
                        'status',
                        e?.message ||
                            'Erro ao registrar movimentação.',
                        'err',
                        'exclamation-circle'
                    );

                } finally {
                    confirmacaoMovimentacaoAberta = false;
                    setBtnLoading(btn, false);
                }
            },

            onCancel: () => {
                if (confirmacaoConsumida) {
                    return;
                }

                confirmacaoConsumida = true;
                liberarConfirmacao();

                setStatus(
                    'status',
                    'Movimentação cancelada.',
                    'muted',
                    'ban'
                );
            }
        });

    } catch (e) {
        liberarConfirmacao();

        setStatus(
            'status',
            e?.message ||
                'Erro ao preparar movimentação.',
            'err',
            'exclamation-circle'
        );
    }
}

async function doMovimentar(bolao, mapaDeltas) {
    /*
     * Terceira proteção:
     * mesmo que o callback seja disparado novamente,
     * uma segunda gravação não começa.
     */
    if (movimentacaoEmAndamento) {
        throw new Error(
            'A movimentação já está sendo registrada.'
        );
    }

    movimentacaoEmAndamento = true;

    try {
        if (!bolao?.id) {
            throw new Error(
                'Bolão inválido para movimentação.'
            );
        }

        if (!loteriaAtiva?.loteria_id) {
            throw new Error(
                'Loja de origem não identificada.'
            );
        }

        if (!usuario?.id) {
            throw new Error(
                'Usuário não identificado.'
            );
        }

        const inserts = [];
        for (const [destinoIdRaw, qtdRaw] of Object.entries(mapaDeltas || {})) {
            const qtd = Number(qtdRaw || 0);
            const destId = Number(destinoIdRaw || 0);

            if (qtd === 0 || !destId) {
                continue;
            }

            if (destId === Number(loteriaAtiva.loteria_id)) {
                continue;
            }

            const lojaDestino = lojasMovimentacao.find(
                loja => Number(loja.loteria_id) === destId
            );

            if (!lojaDestino) {
                throw new Error(`Loja destino não encontrada: ${destId}`);
            }

            inserts.push({
                bolao_id: bolao.id,
                loteria_origem: loteriaAtiva.loteria_id,
                loteria_destino: destId,
                qtd_cotas: qtd,
                valor_unitario: bolao.valor_cota,
                status: 'ATIVO',
                criado_por: usuario.id,
            });
        }

        if (!inserts.length) {
            throw new Error(
                'Nenhuma movimentação válida.'
            );
        }

        const { error } = await sb
            .from('movimentacoes_cotas')
            .insert(inserts);

        if (error) {
            throw new Error(error.message);
        }

    } finally {
        /*
         * A trava sempre é liberada, inclusive em caso de erro.
         */
        movimentacaoEmAndamento = false;
    }
}

/************************************************************
 * BINDINGS
 ************************************************************/
function bind() {
    const btnDiPrev = $('btnDiPrev');
    const btnDiNext = $('btnDiNext');
    const btnDcPrev = $('btnDcPrev');
    const btnDcNext = $('btnDcNext');
    const btnConcursoPrev = $('btnConcursoPrev');
    const btnConcursoNext = $('btnConcursoNext');
    const btnCadastrar = $('btnCadastrar');
    const btnDeletar = $('btnDeletar');
    const btnMovimentar = $('btnMovimentar');
    const btnBuscar = $('btnBuscar');
    const btnLimpar = $('btnLimpar');
    const btnZerarMov = $('btnZerarMov');
    const modalidade = $('modalidade');
    const lojaTreeWrap = $('lojaTreeWrap');
    const origemChip = $('origemChip');
    const movOrigemChip = $('movOrigemChip');
    const btnInicio = $('btnInicio');
    const btnSair = $('btnSair');

    if (btnDiPrev) btnDiPrev.onclick = () => addDias('dataInicial', -1);
    if (btnDiNext) btnDiNext.onclick = () => addDias('dataInicial', +1);
    if (btnDcPrev) btnDcPrev.onclick = () => addDias('dataConcurso', -1);
    if (btnDcNext) btnDcNext.onclick = () => addDias('dataConcurso', +1);

    if (btnConcursoPrev) btnConcursoPrev.addEventListener('click', async () => { await ajustarConcurso(-1); });
    if (btnConcursoNext) btnConcursoNext.addEventListener('click', async () => { await ajustarConcurso(1); });

    if (btnCadastrar) btnCadastrar.addEventListener('click', onCadastrar);
    if (btnDeletar) btnDeletar.addEventListener('click', onDeletar);
    if (btnMovimentar) btnMovimentar.addEventListener('click', onMovimentar);
    if (btnBuscar) btnBuscar.addEventListener('click', onBuscar);

    if (btnLimpar) btnLimpar.addEventListener('click', () => {
        limparFormSemLoja();
        setStatus('status', 'Campos limpos.', 'muted', 'broom');
    });

    if (btnZerarMov) btnZerarMov.addEventListener('click', () => {
        limparMov();
        setStatus('status', 'Movimentação limpa.', 'muted', 'broom');
    });

   if (modalidade) modalidade.addEventListener('change', () => {
    const m = modalidade.value;

    limparFormCompletoMantendoModalidade(m);

    if (aplicarModeloEspecial(m, true)) {
        setStatus('status', `${m} selecionado: concurso e datas preenchidos automaticamente.`, 'ok', 'calendar-check');
    } else if (m) {
        setStatus('status', 'Modalidade alterada. Dados anteriores foram limpos.', 'muted', 'broom');
    }

    saveDraft();
});

    CAMPOS_FORM.forEach(id => {
        const el = $(id);
        if (el) {
            el.addEventListener('input', saveDraft);
            el.addEventListener('change', saveDraft);
        }
    });

    if (lojaTreeWrap) {
        lojaTreeWrap.addEventListener('click', () => trocarLojaPorOffset(1));
        lojaTreeWrap.setAttribute('title', 'Trocar loja');
    }

    if (origemChip) origemChip.addEventListener('click', () => trocarLojaPorOffset(1));
    if (movOrigemChip) movOrigemChip.addEventListener('click', () => trocarLojaPorOffset(1));

    if (btnInicio) btnInicio.addEventListener('click', () => {
    localStorage.removeItem('sl_draft');
    localStorage.removeItem('sl_active_mod');
    window.SISLOT_SECURITY.irParaInicio();
});

if (btnSair) btnSair.addEventListener('click', async () => {
    localStorage.removeItem('sl_draft');
    localStorage.removeItem('sl_active_mod');
    await window.SISLOT_SECURITY.sair();
});
const modGrid = $('modGrid');

if (modGrid) {
    modGrid.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            modGrid.scrollLeft += e.deltaY;
        }
    }, { passive: false });
}

const chipsRow = $('chipsRow');

if (chipsRow) {
    chipsRow.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            chipsRow.scrollLeft += e.deltaY;
        }
    }, { passive: false });
}
    
}
// Inicialização
init();
