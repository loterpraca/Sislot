/**
 * SISLOT - Menu Principal
 * Versão refatorada com utils
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

// Importa funções do utils
const utils = window.SISLOT_UTILS || {};
const $ = utils.$ || (id => document.getElementById(id));
const updateClock = utils.updateClock || (() => {
    const el = $('relogio');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR');
});
const startClock = utils.startClock || (() => {
    updateClock();
    setInterval(updateClock, 1000);
});

const PERFIL_LABEL = {
    ADMIN: 'Administrador',
    SOCIO: 'Sócio',
    GERENTE: 'Gerente',
    OPERADOR: 'Operador',
};

init();

function preencherUsuario(usuario) {
    const nome = String(usuario?.nome || 'Usuário').trim();
    const primeiroNome = nome.split(' ')[0] || 'Usuário';
    const iniciais = nome
        .split(' ')
        .filter(Boolean)
        .map((parte) => parte[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || '?';

    const heroNome = $('heroNome');
    const userName = $('userName');
    const userRole = $('userRole');
    const userAvatar = $('userAvatar');

    if (heroNome) heroNome.textContent = primeiroNome;
    if (userName) userName.textContent = nome || 'Usuário';
    if (userRole) userRole.textContent = PERFIL_LABEL[usuario?.perfil] || usuario?.perfil || '—';
    if (userAvatar) userAvatar.textContent = iniciais;
}

function esconder(seletor) {
    document.querySelectorAll(seletor).forEach((el) => {
        el.style.display = 'none';
    });
}

function aplicarPermissoesMenu(perfil) {
    if (perfil === 'GERENTE' || perfil === 'OPERADOR') {
        esconder('.card-cadastro');
        esconder('.card-movimentacao');
        esconder('.card-exibir');
        esconder('.card-federal');
        esconder('.card-produtos');
        esconder('.card-whatsapp');
        esconder('.card-marketplace');
        esconder('.card-caixa');
        esconder('.card-controle');
        esconder('.card-config');
        const adminWrap = $('adminWrap');
        if (adminWrap) adminWrap.style.display = 'none';
        return;
    }

    if (perfil === 'SOCIO') {
        esconder('.card-config');
        const adminWrap = $('adminWrap');
        if (adminWrap) adminWrap.style.display = 'none';
        return;
    }

    if (perfil === 'ADMIN') {
        const adminWrap = $('adminWrap');
        if (adminWrap) adminWrap.style.display = '';
    }
}

function hojeIso() {
    return new Date().toISOString().slice(0, 10);
}

async function carregarIndicadores() {
    const hoje = hojeIso();

    const [
        movsResp,
        wppResp,
        mktResp,
    ] = await Promise.all([
        sb
            .from('movimentacoes_cotas')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', hoje),

        sb
            .from('boloes_vendas')
            .select('*', { count: 'exact', head: true })
            .eq('canal', 'WHATSAPP')
            .gte('created_at', hoje),

        sb
            .from('boloes_vendas')
            .select('*', { count: 'exact', head: true })
            .in('canal', ['MARKETPLACE', 'BALCAO'])
            .gte('created_at', hoje),
    ]);

    const statVendasWpp = $('statVendasWpp');
    const statMarketplace = $('statMarketplace');
    const statMovs = $('statMovs');

    if (statVendasWpp) statVendasWpp.textContent = wppResp.count ?? '—';
    if (statMarketplace) statMarketplace.textContent = mktResp.count ?? '—';
    if (statMovs) statMovs.textContent = movsResp.count ?? '—';
}

function configurarLogout() {
    const btnLogout = $('btnLogout');
    if (btnLogout) {
        btnLogout.onclick = async () => {
            await window.SISLOT_SECURITY.sair();
        };
    }
}

async function carregarUsuarioLogado() {
    const { data: { session }, error } = await sb.auth.getSession();

    if (error) {
        throw new Error(error.message);
    }

    if (!session?.user?.id) {
        location.href = './login.html';
        return null;
    }

    return await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
}

async function init() {
    try {
        startClock();

        const usuario = await carregarUsuarioLogado();
        if (!usuario) return;

        preencherUsuario(usuario);
        aplicarPermissoesMenu(usuario.perfil);
        configurarLogout();
        await carregarIndicadores();
    } catch (err) {
        console.error('Erro ao iniciar menu:', err);
        alert(err.message || 'Erro ao iniciar menu');
    }
}
