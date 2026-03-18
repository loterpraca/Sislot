(function () {
  const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
  );

  function perfilNorm(usuario) {
    return String(usuario?.perfil || '').trim().toUpperCase();
  }

  function isAdmin(usuario) {
    return perfilNorm(usuario) === 'ADMIN';
  }

  function isSocio(usuario) {
    return perfilNorm(usuario) === 'SOCIO';
  }

  function isGerente(usuario) {
    return perfilNorm(usuario) === 'GERENTE';
  }

  function isOperador(usuario) {
    return perfilNorm(usuario) === 'OPERADOR';
  }

  function podeSelecionarFuncionario(usuario) {
    return isAdmin(usuario) || isSocio(usuario) || isGerente(usuario);
  }

  function podeGravarFechamento({ usuarioLogado, funcionarioSelecionadoId }) {
    if (isAdmin(usuarioLogado) || isSocio(usuarioLogado) || isGerente(usuarioLogado)) {
      return true;
    }

    if (isOperador(usuarioLogado)) {
      return Number(usuarioLogado?.id) === Number(funcionarioSelecionadoId);
    }

    return false;
  }

  function exigeTokenParaSobrescrever({ usuarioLogado }) {
    if (isAdmin(usuarioLogado) || isSocio(usuarioLogado)) return false;
    if (isGerente(usuarioLogado) || isOperador(usuarioLogado)) return true;
    return true;
  }

  function gerarCodigoToken(tamanho = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < tamanho; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  async function gerarTokenSobrescrita({ loteriaId, geradoPor, minutos = 10, observacao = '' }) {
    const token = gerarCodigoToken(6);
    const expiraEm = new Date(Date.now() + minutos * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from('autorizacoes_tokens')
      .insert({
        token,
        tipo: 'SOBRESCREVER_FECHAMENTO',
        loteria_id: loteriaId,
        gerado_por: geradoPor,
        expira_em: expiraEm,
        observacao
      })
      .select('id, token, expira_em')
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async function validarTokenSobrescrita({ token, loteriaId }) {
    const codigo = String(token || '').trim().toUpperCase();

    if (!codigo) {
      throw new Error('Informe o token.');
    }

    const { data, error } = await sb
      .from('autorizacoes_tokens')
      .select('*')
      .eq('token', codigo)
      .eq('tipo', 'SOBRESCREVER_FECHAMENTO')
      .eq('ativo', true)
      .is('usado_em', null)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('Token inválido.');

    if (Number(data.loteria_id) !== Number(loteriaId)) {
      throw new Error('Token não autorizado para esta loteria.');
    }

    const agora = new Date();
    const expira = new Date(data.expira_em);
    if (expira <= agora) {
      throw new Error('Token expirado.');
    }

    return data;
  }

  async function consumirTokenSobrescrita({ tokenId, usadoPor, fechamentoId = null }) {
    const { error } = await sb
      .from('autorizacoes_tokens')
      .update({
        usado_por: usadoPor,
        fechamento_id: fechamentoId,
        usado_em: new Date().toISOString(),
        ativo: false
      })
      .eq('id', tokenId);

    if (error) throw new Error(error.message);
  }

  async function abrirModalToken() {
    return new Promise(resolve => {
      const modal = document.getElementById('m-token');
      const input = document.getElementById('token-autorizacao');
      const erro  = document.getElementById('token-err');

      if (!modal || !input || !erro) {
        resolve(null);
        return;
      }

      window.__fechamentoTokenResolver = resolve;

      input.value = '';
      erro.style.display = 'none';
      modal.classList.add('show');
      input.focus();
    });
  }

  function fecharModalToken() {
    const modal = document.getElementById('m-token');
    if (modal) modal.classList.remove('show');
  }

  async function confirmarToken({ loteriaId }) {
    const input = document.getElementById('token-autorizacao');
    const erro  = document.getElementById('token-err');

    if (!input || !erro) return;

    const codigo = input.value.trim().toUpperCase();
    if (!codigo) {
      erro.textContent = 'Informe o token.';
      erro.style.display = 'block';
      return;
    }

    try {
      const tokenValido = await validarTokenSobrescrita({
        token: codigo,
        loteriaId
      });

      fecharModalToken();

      if (window.__fechamentoTokenResolver) {
        window.__fechamentoTokenResolver(tokenValido);
        window.__fechamentoTokenResolver = null;
      }
    } catch (e) {
      erro.textContent = e.message || 'Token inválido.';
      erro.style.display = 'block';
    }
  }

  function cancelarToken() {
    fecharModalToken();
    if (window.__fechamentoTokenResolver) {
      window.__fechamentoTokenResolver(null);
      window.__fechamentoTokenResolver = null;
    }
  }

  window.FECHAMENTO_RULES = {
    perfilNorm,
    isAdmin,
    isSocio,
    isGerente,
    isOperador,
    podeSelecionarFuncionario,
    podeGravarFechamento,
    exigeTokenParaSobrescrever,
    gerarCodigoToken,
    gerarTokenSobrescrita,
    validarTokenSobrescrita,
    consumirTokenSobrescrita,
    abrirModalToken,
    confirmarToken,
    cancelarToken
  };
})();
