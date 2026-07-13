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
 * CADASTRAR
 ************************************************************/
async function onCadastrar() {
    const btn = $('btnCadastrar');
    if (!btn) return;

    try {
        const b = validarBase(true);
        if (!loteriaAtiva) throw new Error('Nenhuma loja selecionada.');

        const corpo = [
            '🧾 CONFIRMAÇÃO DE CADASTRO', '',
            `📍 Origem: ${loteriaAtiva.loteria_nome}`,
            `🎯 ${b.modalidade} | Concurso: ${b.concurso}`,
            `🗓️ ${fmtData(b.dataInicial)} → ${fmtData(b.dataConcurso)}`,
            `🎮 ${b.qtdJogos} jogos de ${b.qtdDezenas} dezenas`,
            `💰 Cota: ${fmtBRL(b.valorCota)} | ${b.cotas} cotas`,
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
    } catch (e) {
        setStatus('status', e.message, 'err', 'exclamation-circle');
    }
}

async function doCadastrar(b, somarCotas = false) {
    const loteriaId = loteriaAtiva.loteria_id;

    const { data: existe } = await sb
        .from('boloes')
        .select('id, qtd_cotas_total')
        .eq('loteria_id', loteriaId)
        .eq('modalidade', b.modalidade)
        .eq('concurso', b.concurso)
        .eq('valor_cota', b.valorCota)
        .eq('qtd_jogos', b.qtdJogos)
        .eq('qtd_dezenas', b.qtdDezenas)
        .neq('status', 'CANCELADO')
        .maybeSingle();

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
