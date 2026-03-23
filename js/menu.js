/**
 * SISLOT — Menu Principal (v3.0)
 * Usa SISLOT_THEME para tema/lojas e SISLOT_UTILS para helpers.
 */

const sb = supabase.createClient(
  window.SISLOT_CONFIG.url,
  window.SISLOT_CONFIG.anonKey
);

const { $, fmtBRL, showToast } = window.SISLOT_UTILS;

const PERFIL_LABEL = {
  ADMIN:      'Administrador',
  SOCIO:      'Sócio',
  GERENTE:    'Gerente',
  GERENTE_ADMINISTRATIVO: 'Ger. Administrativo',
  GERENTE_OPERACIONAL:    'Ger. Operacional',
  OPERADOR:   'Operador',
};

// Mapa de permissões: quais cards ficam visíveis por perfil
const VISIBILIDADE = {
  ADMIN: ['gestao', 'vendas', 'admin'],
  SOCIO: ['gestao', 'vendas'],
  GERENTE_ADMINISTRATIVO: ['vendas'],
  GERENTE_OPERACIONAL: ['gestao', 'vendas'],
  OPERADOR: ['vendas'],
  GERENTE: ['vendas'],
};

init();

/* ── Inicialização ──────────────────────────────────────── */
async function init() {
  try {
    // Tema e clock via SISLOT_THEME
    SISLOT_THEME.init();

    const usuario = await carregarUsuario();
    if (!usuario) return;

    preencherUsuario(usuario);
    aplicarPermissoes(usuario.perfil);
    renderizarLojas();
    configurarLogout();

    await carregarIndicadores();
  } catch (err) {
    console.error('Erro ao iniciar menu:', err);
    showToast('Erro ao carregar o menu: ' + (err.message || err), 'error');
  }
}

/* ── Usuário ────────────────────────────────────────────── */
async function carregarUsuario() {
  const { data: { session }, error } = await sb.auth.getSession();
  if (error) throw new Error(error.message);
  if (!session?.user?.id) {
    location.href = './login.html';
    return null;
  }
  return await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
}

function preencherUsuario(usuario) {
  const nome = String(usuario?.nome || 'Usuário').trim();
  const primeiroNome = nome.split(' ')[0] || 'Usuário';
  const iniciais = nome.split(' ').filter(Boolean)
    .map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';

  const heroNome  = $('heroNome');
  const userName  = $('userName');
  const userRole  = $('userRole');
  const userAvatar = $('userAvatar');

  if (heroNome)   heroNome.textContent  = primeiroNome;
  if (userName)   userName.textContent  = nome;
  if (userRole)   userRole.textContent  = PERFIL_LABEL[usuario?.perfil] || usuario?.perfil || '—';
  if (userAvatar) userAvatar.textContent = iniciais;
}

/* ── Permissões ─────────────────────────────────────────── */
function aplicarPermissoes(perfil) {
  const visivel = VISIBILIDADE[perfil] || [];

  // Gestão
  const wrapGestao = $('funcWrapGestao');
  if (wrapGestao) wrapGestao.classList.toggle('is-hidden', !visivel.includes('gestao'));

  // Vendas
  const wrapVendas = $('funcWrapVendas');
  if (wrapVendas) wrapVendas.classList.toggle('is-hidden', !visivel.includes('vendas'));

  // Admin
  const adminWrap = $('adminWrap');
  if (adminWrap) adminWrap.classList.toggle('is-hidden', !visivel.includes('admin'));
}

/* ── Lojas (renderiza via SISLOT_THEME) ─────────────────── */
function renderizarLojas() {
  const container = $('lojasRow');
  if (!container) return;

  const lojas = SISLOT_THEME.listLojas();

  container.innerHTML = lojas.map(loja => `
    <div class="loja-chip">
      <div class="loja-logo">
        <img
          src="./icons/${loja.slug}.png"
          alt="${loja.nome}"
          onerror="this.style.display='none'"
        />
      </div>
      ${loja.nome}
    </div>
  `).join('');
}

/* ── Indicadores ────────────────────────────────────────── */
async function carregarIndicadores() {
  const hoje = new Date().toISOString().slice(0, 10);

  const [movsResp, wppResp, mktResp] = await Promise.all([
    sb.from('movimentacoes_cotas')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', hoje),

    sb.from('boloes_vendas')
      .select('*', { count: 'exact', head: true })
      .eq('canal', 'WHATSAPP')
      .gte('created_at', hoje),

    sb.from('boloes_vendas')
      .select('*', { count: 'exact', head: true })
      .in('canal', ['MARKETPLACE', 'BALCAO'])
      .gte('created_at', hoje),
  ]);

  const statVendasWpp  = $('statVendasWpp');
  const statMarketplace = $('statMarketplace');
  const statMovs       = $('statMovs');

  if (statVendasWpp)   statVendasWpp.textContent   = wppResp.count  ?? '—';
  if (statMarketplace) statMarketplace.textContent  = mktResp.count  ?? '—';
  if (statMovs)        statMovs.textContent         = movsResp.count ?? '—';
}

/* ── Logout ─────────────────────────────────────────────── */
function configurarLogout() {
  const btn = $('btnLogout');
  if (btn) btn.onclick = () => window.SISLOT_SECURITY.sair();
}
