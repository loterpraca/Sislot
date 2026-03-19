(function () {
  const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
  );

  const PERFIL_LABEL = {
    ADMIN: 'Administrador',
    SOCIO: 'Sócio',
    GERENTE: 'Gerente',
    OPERADOR: 'Operador',
  };

  init();

  function $(id) {
    return document.getElementById(id);
  }

  function updateClock() {
    const now = new Date();

    $('relogio').textContent =
      now.toLocaleTimeString('pt-BR') +
      ' — ' +
      now.toLocaleDateString('pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
  }

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

    $('heroNome').textContent = primeiroNome;
    $('userName').textContent = nome || 'Usuário';
    $('userRole').textContent = PERFIL_LABEL[usuario?.perfil] || usuario?.perfil || '—';
    $('userAvatar').textContent = iniciais;
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
      esconder('.card-config');
      $('adminWrap').style.display = 'none';
      return;
    }

    if (perfil === 'SOCIO') {
      esconder('.card-config');
      $('adminWrap').style.display = 'none';
      return;
    }

    if (perfil === 'ADMIN') {
      $('adminWrap').style.display = '';
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

    $('statVendasWpp').textContent = wppResp.count ?? '—';
    $('statMarketplace').textContent = mktResp.count ?? '—';
    $('statMovs').textContent = movsResp.count ?? '—';
  }

  function configurarLogout() {
    $('btnLogout').onclick = async () => {
      await window.SISLOT_SECURITY.sair();
    };
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
      updateClock();
      setInterval(updateClock, 1000);

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
})();
