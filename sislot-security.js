(function () {
  const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
  );

  function rotaInicioPorPerfil(perfil) {
  if (['ADMIN', 'SOCIO', 'GERENTE', 'OPERADOR'].includes(perfil)) {
    return './menu.html';
  }
  return './login.html';
}

  async function buscarUsuarioPorAuthId(authUserId) {
    const { data: usr, error } = await sb
      .from('usuarios')
      .select('id, auth_user_id, nome, email, perfil, ativo, pode_logar')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return usr || null;
  }

  async function validarUsuarioLogavel(authUserId) {
    const usr = await buscarUsuarioPorAuthId(authUserId);

    if (!usr || !usr.ativo || !usr.pode_logar) {
      await sb.auth.signOut();
      throw new Error('Usuário sem permissão de acesso.');
    }

    return usr;
  }

  async function redirecionarAposLogin(authUserId) {
    const usr = await validarUsuarioLogavel(authUserId);
    const destino = rotaInicioPorPerfil(usr.perfil);
    window.location.href = destino;
  }

  async function redirecionarSeJaLogado() {
    const { data: { session }, error } = await sb.auth.getSession();

    if (error) throw new Error(error.message);
    if (!session?.user?.id) return;

    try {
      await redirecionarAposLogin(session.user.id);
    } catch (err) {
      await sb.auth.signOut();
      throw err;
    }
  }

  async function sair() {
    await sb.auth.signOut();
    window.location.href = './login.html';
  }

  window.SISLOT_SECURITY = {
    rotaInicioPorPerfil,
    buscarUsuarioPorAuthId,
    validarUsuarioLogavel,
    redirecionarAposLogin,
    redirecionarSeJaLogado,
    sair
  };
})();
