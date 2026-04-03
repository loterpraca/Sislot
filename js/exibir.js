const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

const $ = id => document.getElementById(id);

const VIEW_BOLAO = 'view_boloes_exibicao_operacional';
const VIEW_VENDAS = 'view_boloes_exibicao_operacional_vendas';
const VIEW_LOJAS = 'view_boloes_exibicao_operacional_lojas';

const VIEW_USUARIO_CONTEXTO = 'vw_usuario_contexto';
const VIEW_USUARIOS_LOTERIAS_ATIVAS = 'vw_usuarios_loterias_ativas';

let usuario = null;
let usuarios = [];
let lojas = [];

const slugsLojas = ['boulevard', 'centro', 'lotobel', 'santa-tereza', 'via-brasil'];
const slugLabel = {
  boulevard: 'BLD',
  centro: 'CTR',
  lotobel: 'LTB',
  'santa-tereza': 'STZ',
  'via-brasil': 'VIA'
};

let filtroTimer = null;
let boloesCache = [];
let bolaoSelecionadoModal = null;
let cancelandoBolao = false;
let editandoBolao = false;

function fmtBRL(v) {
  return v == null || v === '' ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtN(v) {
  return v == null ? '—' : Number(v).toLocaleString('pt-BR');
}

function fmtDate(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateInput(s) {
  return s ? String(s).slice(0, 10) : '';
}

function fmtPair(a, b) {
  const aa = a == null ? '—' : Number(a).toLocaleString('pt-BR');
  const bb = b == null ? '—' : Number(b).toLocaleString('pt-BR');
  return `${aa}/${bb}`;
}

function hojeISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function updateClock() {
  const n = new Date();
  $('relogio').textContent =
    n.toLocaleTimeString('pt-BR') + ' — ' +
    n.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
}

function agendarExibicao() {
  clearTimeout(filtroTimer);
  filtroTimer = setTimeout(() => {
    exibir();
  }, 250);
}

function limparSelecaoBoloes() {
  document.querySelectorAll('.bolao-check').forEach(chk => {
    chk.checked = false;
  });
}

function setCancelamentoBusyState(busy) {
  cancelandoBolao = busy;

  const btnConfirmar = $('bmConfirmar');
  const btnFechar = $('bmFechar');
  const btnCancelar = $('bmCancelar');
  const btnEditar = $('bmEditar');

  if (btnConfirmar) {
    btnConfirmar.disabled = busy;
    btnConfirmar.dataset.originalText = btnConfirmar.dataset.originalText || btnConfirmar.textContent || 'Cancelar bolão';
    btnConfirmar.textContent = busy ? 'Cancelando...' : btnConfirmar.dataset.originalText;
  }

  if (btnFechar) btnFechar.disabled = busy;
  if (btnCancelar) btnCancelar.disabled = busy;
  if (btnEditar) btnEditar.disabled = busy;
}

function setEdicaoBusyState(busy) {
  editandoBolao = busy;

  const btnSalvar = $('beSalvar');
  const btnFechar = $('beFechar');
  const btnCancelar = $('beCancelar');

  if (btnSalvar) {
    btnSalvar.disabled = busy || btnSalvar.dataset.locked === '1';
    btnSalvar.dataset.originalText = btnSalvar.dataset.originalText || btnSalvar.textContent || 'Salvar alterações';
    btnSalvar.textContent = busy ? 'Salvando...' : btnSalvar.dataset.originalText;
  }

  if (btnFechar) btnFechar.disabled = busy;
  if (btnCancelar) btnCancelar.disabled = busy;
}

function mostrarAvisoEdicao(msg) {
  const el = $('beAviso');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}

function mostrarSucessoEdicao(msg) {
  const el = $('beSucesso');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}

function normalizarErroCancelamento(err) {
  const raw =
    err?.message ||
    err?.details ||
    err?.hint ||
    'Não foi possível cancelar o bolão.';

  const msg = String(raw);

  if (/vendas lançadas/i.test(msg) || /já possui venda/i.test(msg)) {
    return 'Este bolão já possui venda registrada e não pode ser cancelado.';
  }

  if (/fechamento lançado/i.test(msg) || /possui fechamento/i.test(msg)) {
    return 'Este bolão já possui lançamento em fechamento e não pode ser cancelado.';
  }

  if (/PAGO/i.test(msg) || /já acertada/i.test(msg) || /já quitada/i.test(msg)) {
    return 'Este bolão possui movimentação financeira já quitada e não pode ser cancelado.';
  }

  if (/não encontrado/i.test(msg)) {
    return 'Bolão não encontrado.';
  }

  if (/permission/i.test(msg) || /not allowed/i.test(msg) || /rls/i.test(msg)) {
    return 'Seu usuário não possui permissão para cancelar este bolão.';
  }

  return msg;
}

function normalizarErroEdicao(err) {
  const raw =
    err?.message ||
    err?.details ||
    err?.hint ||
    'Não foi possível salvar as alterações do bolão.';

  const msg = String(raw);

  if (/venda registrada/i.test(msg) || /vendas lançadas/i.test(msg)) {
    return 'Este bolão já possui venda registrada e não pode mais ser alterado.';
  }

  if (/movimentação paga/i.test(msg) || /acerto financeiro pago/i.test(msg) || /quitad/i.test(msg)) {
    return 'Há movimentação paga. Valor da cota e quantidade de cotas não podem ser alterados.';
  }

  if (/quantidade total de cotas não pode ser menor/i.test(msg)) {
    return msg;
  }

  if (/data inicial/i.test(msg) || /data do concurso/i.test(msg)) {
    return msg;
  }

  if (/não encontrado/i.test(msg)) {
    return 'Bolão não encontrado.';
  }

  return msg;
}

function getMotivoCancelamento(bolao) {
  const campoMotivo = $('bmMotivo');
  const motivoDigitado = campoMotivo?.value?.trim();

  if (motivoDigitado) return motivoDigitado;

  const nomeUsuario = usuario?.nome || 'usuário';
  return `Cancelamento solicitado na tela operacional por ${nomeUsuario} — ${bolao.modalidade || 'Bolão'} concurso ${bolao.concurso || '—'}`;
}

function atualizarEstadoAcaoModal(bolao) {
  const btnConfirmar = $('bmConfirmar');
  const btnEditar = $('bmEditar');
  if (!btnConfirmar) return;

  const status = String(bolao?.status || '').toUpperCase();

  btnConfirmar.dataset.originalText = 'Cancelar bolão';

  if (status === 'CANCELADO') {
    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Bolão já cancelado';
    if (btnEditar) btnEditar.disabled = true;
    return;
  }

  btnConfirmar.disabled = false;
  btnConfirmar.textContent = 'Cancelar bolão';
  if (btnEditar) btnEditar.disabled = false;
}

function abrirModalBolao(bolao) {
  bolaoSelecionadoModal = bolao;

  $('bmTitulo').textContent = `${bolao.modalidade || 'Bolão'} — Concurso ${bolao.concurso || '—'}`;
  $('bmModalidade').textContent = bolao.modalidade || '—';
  $('bmConcurso').textContent = bolao.concurso || '—';
  $('bmOrigem').textContent = bolao.origem_nome || '—';
  $('bmValorCota').textContent = fmtBRL(bolao.valor_cota);
  $('bmQtdCotas').textContent = fmtN(bolao.qtd_cotas_total);
  $('bmStatus').textContent = bolao.status || '—';
  $('bmDtInicial').textContent = fmtDate(bolao.dt_inicial);
  $('bmDtConcurso').textContent = fmtDate(bolao.dt_concurso);
  $('bmQtdJogos').textContent = fmtN(bolao.qtd_jogos);
  $('bmQtdDezenas').textContent = fmtN(bolao.qtd_dezenas);
  $('bmCodigoLoterico').textContent = bolao.codigo_loterico || '—';
  $('bmObservacao').textContent = bolao.observacao || '—';

  const campoMotivo = $('bmMotivo');
  if (campoMotivo) campoMotivo.value = '';

  atualizarEstadoAcaoModal(bolao);
  $('bolaoModalOverlay').classList.add('show');
  document.body.classList.add('modal-open');
}

function fecharModalBolao() {
  if (cancelandoBolao || editandoBolao) return;

  $('bolaoModalOverlay').classList.remove('show');
  document.body.classList.remove('modal-open');
  bolaoSelecionadoModal = null;
  limparSelecaoBoloes();
}

function abrirModalEdicao() {
  $('bolaoEditModalOverlay')?.classList.add('show');
  document.body.classList.add('modal-open');
}

function fecharModalEdicaoBolao() {
  if (editandoBolao) return;
  $('bolaoEditModalOverlay')?.classList.remove('show');
  mostrarAvisoEdicao('');
  mostrarSucessoEdicao('');
}

function preencherModalEdicaoBolao(bolao) {
  $('beTitulo').textContent = `${bolao.modalidade || 'Bolão'} — Concurso ${bolao.concurso || '—'}`;
  $('beOrigem').textContent = bolao.origem_nome || '—';
  $('beStatus').textContent = bolao.status || '—';
  $('beCodigoLoterico').textContent = bolao.codigo_loterico || '—';
  $('beQtdJogos').textContent = fmtN(bolao.qtd_jogos);
  $('beQtdDezenas').textContent = fmtN(bolao.qtd_dezenas);

  $('beModalidade').value = bolao.modalidade || '';
  $('beConcurso').value = bolao.concurso || '';
  $('beDtInicial').value = fmtDateInput(bolao.dt_inicial);
  $('beDtConcurso').value = fmtDateInput(bolao.dt_concurso);
  $('beValorCota').value = bolao.valor_cota == null ? '' : Number(bolao.valor_cota).toFixed(2);
  $('beQtdCotas').value = bolao.qtd_cotas_total ?? '';

  mostrarAvisoEdicao('');
  mostrarSucessoEdicao('');
}

function aplicarPermissoesEdicao(permissao) {
  const podeBasico = !!permissao?.pode_editar_basico;
  const podeValor = !!permissao?.pode_editar_valor;

  $('beModalidade').disabled = !podeBasico;
  $('beConcurso').disabled = !podeBasico;
  $('beDtInicial').disabled = !podeBasico;
  $('beDtConcurso').disabled = !podeBasico;
  $('beValorCota').disabled = !podeValor;
  $('beQtdCotas').disabled = !podeValor;

  const btnSalvar = $('beSalvar');
  if (btnSalvar) {
    btnSalvar.dataset.locked = podeBasico ? '0' : '1';
    btnSalvar.disabled = !podeBasico;
  }

  if (!podeBasico) {
    mostrarAvisoEdicao(permissao?.motivo || 'Este bolão não pode ser alterado.');
  }
}

async function abrirModalEdicaoBolao() {
  if (!bolaoSelecionadoModal || editandoBolao) return;

  const bolao = bolaoSelecionadoModal;
  preencherModalEdicaoBolao(bolao);
  abrirModalEdicao();

  try {
    const { data, error } = await sb.rpc('rpc_validar_edicao_bolao', {
      p_bolao_id: Number(bolao.bolao_id)
    });

    if (error) throw error;

    aplicarPermissoesEdicao(data || {});
  } catch (err) {
    console.error('Erro ao validar edição do bolão:', err);
    aplicarPermissoesEdicao({ pode_editar_basico: false, pode_editar_valor: false, motivo: normalizarErroEdicao(err) });
  }
}

function bindSelecaoBoloes() {
  document.querySelectorAll('.bolao-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.id);

      document.querySelectorAll('.bolao-check').forEach(outro => {
        if (outro !== e.target) outro.checked = false;
      });

      if (!e.target.checked) {
        fecharModalEdicaoBolao();
        fecharModalBolao();
        return;
      }

      const bolao = boloesCache.find(b => Number(b.bolao_id) === id);
      if (bolao) abrirModalBolao(bolao);
    });
  });
}

async function cancelarBolaoSelecionado() {
  if (!bolaoSelecionadoModal || cancelandoBolao) return;

  const bolao = bolaoSelecionadoModal;
  const status = String(bolao.status || '').toUpperCase();

  if (status === 'CANCELADO') {
    alert('Este bolão já está cancelado.');
    return;
  }

  const ok = window.confirm(
    [
      `Confirma o cancelamento do bolão ${bolao.modalidade || 'Bolão'} — Concurso ${bolao.concurso || '—'}?`,
      '',
      'Essa ação tentará:',
      '• cancelar o bolão',
      '• cancelar movimentações ativas vinculadas',
      '• cancelar pendências financeiras pendentes vinculadas',
      '',
      'O banco irá bloquear se já houver venda, fechamento ou acerto financeiro pago.'
    ].join('\n')
  );

  if (!ok) return;

  try {
    setCancelamentoBusyState(true);

    const { data, error } = await sb.rpc('rpc_cancelar_bolao_seguro', {
      p_bolao_id: Number(bolao.bolao_id),
      p_usuario_id: usuario?.id ?? null,
      p_motivo: getMotivoCancelamento(bolao)
    });

    if (error) throw error;

    if (!data?.ok) {
      throw new Error(data?.message || 'Não foi possível cancelar o bolão.');
    }

    alert(
      [
        'Bolão cancelado com sucesso.',
        '',
        `Movimentações canceladas: ${fmtN(data.movimentacoes_canceladas || 0)}`,
        `Financeiros cancelados: ${fmtN(data.financeiros_cancelados || 0)}`
      ].join('\n')
    );

    fecharModalEdicaoBolao();
    fecharModalBolao();
    await exibir();
  } catch (err) {
    console.error('Erro ao cancelar bolão:', err);
    alert(normalizarErroCancelamento(err));
  } finally {
    setCancelamentoBusyState(false);
  }
}

async function salvarEdicaoBolao() {
  if (!bolaoSelecionadoModal || editandoBolao) return;

  const payload = {
    p_bolao_id: Number(bolaoSelecionadoModal.bolao_id),
    p_modalidade: $('beModalidade').value.trim(),
    p_concurso: $('beConcurso').value.trim(),
    p_dt_inicial: $('beDtInicial').value,
    p_dt_concurso: $('beDtConcurso').value,
    p_valor_cota: Number($('beValorCota').value),
    p_qtd_cotas_total: Number($('beQtdCotas').value)
  };

  try {
    setEdicaoBusyState(true);
    mostrarAvisoEdicao('');
    mostrarSucessoEdicao('');

    const { data, error } = await sb.rpc('rpc_editar_bolao', payload);

    if (error) throw error;

    if (!data?.ok) {
      throw new Error(data?.motivo || 'Não foi possível salvar as alterações.');
    }

    mostrarSucessoEdicao('Bolão atualizado com sucesso.');

    const id = Number(bolaoSelecionadoModal.bolao_id);
    const idx = boloesCache.findIndex(b => Number(b.bolao_id) === id);
    if (idx >= 0) {
      boloesCache[idx] = {
        ...boloesCache[idx],
        modalidade: payload.p_modalidade,
        concurso: payload.p_concurso,
        dt_inicial: payload.p_dt_inicial,
        dt_concurso: payload.p_dt_concurso,
        valor_cota: payload.p_valor_cota,
        qtd_cotas_total: payload.p_qtd_cotas_total
      };
      bolaoSelecionadoModal = boloesCache[idx];
    }

    setTimeout(async () => {
      fecharModalEdicaoBolao();
      fecharModalBolao();
      await exibir();
    }, 500);
  } catch (err) {
    console.error('Erro ao salvar edição do bolão:', err);
    mostrarAvisoEdicao(normalizarErroEdicao(err));
  } finally {
    setEdicaoBusyState(false);
  }
}

async function carregarContextoUsuario(authUserId) {
  if (!authUserId) return null;

  const { data, error } = await sb
    .from(VIEW_USUARIO_CONTEXTO)
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function carregarLoteriasPermitidas(authUserId) {
  if (!authUserId) return [];

  const { data, error } = await sb
    .from(VIEW_USUARIOS_LOTERIAS_ATIVAS)
    .select('loteria_id,loteria_nome,loteria_slug,principal,perfil')
    .eq('auth_user_id', authUserId)
    .order('principal', { ascending: false })
    .order('loteria_nome', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function init() {
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    location.href = './login.html';
    return;
  }

  const usr = await carregarContextoUsuario(session.user.id);

  if (!usr || !usr.ativo || !usr.pode_logar) {
    location.href = './login.html';
    return;
  }

  usuario = {
    id: usr.usuario_id,
    nome: usr.nome,
    email: usr.email,
    perfil: usr.perfil,
    ativo: usr.ativo,
    pode_logar: usr.pode_logar,
    loteria_principal_id: usr.loteria_principal_id,
    loteria_principal_nome: usr.loteria_principal_nome,
    loteria_principal_slug: usr.loteria_principal_slug
  };

  $('btnLogout').onclick = async () => {
    await sb.auth.signOut();
    location.href = './login.html';
  };

  const [loteriasPermitidasResp, usuariosResp] = await Promise.all([
    carregarLoteriasPermitidas(session.user.id),
    sb.from('usuarios').select('id,nome').eq('ativo', true).order('nome')
  ]);

  const loteriasPermitidas = loteriasPermitidasResp || [];
  usuarios = usuariosResp.data || [];

  lojas = loteriasPermitidas.map(l => ({
    id: l.loteria_id,
    nome: l.loteria_nome,
    slug: l.loteria_slug,
    principal: l.principal
  }));

  const sel = $('fLoja');
  sel.innerHTML = '<option value="">Todas</option>';

  lojas.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.nome;
    sel.appendChild(o);
  });

  $('fDataRef').value = hojeISO();
  $('fStatus').value = 'ATIVO';

  if (usuario?.loteria_principal_id) {
    $('fLoja').value = String(usuario.loteria_principal_id);
  }

  ['fDataRef', 'fDtConcDe', 'fDtConcAte', 'fModal', 'fLoja', 'fStatus'].forEach(id => {
    $(id).addEventListener('change', agendarExibicao);
  });

  $('fConc').addEventListener('input', agendarExibicao);

  $('bmFechar')?.addEventListener('click', fecharModalBolao);
  $('bmCancelar')?.addEventListener('click', fecharModalBolao);
  $('bmConfirmar')?.addEventListener('click', cancelarBolaoSelecionado);
  $('bmEditar')?.addEventListener('click', abrirModalEdicaoBolao);

  $('beFechar')?.addEventListener('click', fecharModalEdicaoBolao);
  $('beCancelar')?.addEventListener('click', fecharModalEdicaoBolao);
  $('beSalvar')?.addEventListener('click', salvarEdicaoBolao);

  $('bolaoModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'bolaoModalOverlay') fecharModalBolao();
  });

  $('bolaoEditModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'bolaoEditModalOverlay') fecharModalEdicaoBolao();
  });

  await exibir();
}

function limpar() {
  $('fDataRef').value = hojeISO();
  ['fDtConcDe', 'fDtConcAte', 'fConc'].forEach(id => $(id).value = '');
  $('fModal').selectedIndex = 0;
  $('fStatus').value = 'ATIVO';
  $('fLoja').value = usuario?.loteria_principal_id ? String(usuario.loteria_principal_id) : '';
  exibir();
}

async function exibir() {
  const dataRef = $('fDataRef').value || hojeISO();
  $('statsRow').style.display = 'none';
  $('tableArea').innerHTML = '<div class="state-box"><div class="spinner"></div><div class="state-title">Carregando…</div></div>';

  let q = sb.from(VIEW_BOLAO)
    .select('*')
    .lte('dt_inicial', dataRef)
    .gte('dt_concurso', dataRef)
    .order('modalidade')
    .order('dt_concurso')
    .order('valor_cota');

  if ($('fDtConcDe').value) q = q.gte('dt_concurso', $('fDtConcDe').value);
  if ($('fDtConcAte').value) q = q.lte('dt_concurso', $('fDtConcAte').value);
  if ($('fModal').value) q = q.eq('modalidade', $('fModal').value);
  if ($('fConc').value) q = q.ilike('concurso', '%' + $('fConc').value + '%');
  if ($('fLoja').value) q = q.eq('origem_loteria_id', parseInt($('fLoja').value, 10));
  if ($('fStatus').value) q = q.eq('status', $('fStatus').value);

  const { data: boloes, error } = await q;

  if (error || !boloes?.length) {
    boloesCache = [];
    $('tableArea').innerHTML = '<div class="state-box"><div class="state-title">Nenhum resultado</div><div class="state-sub">Tente ajustar os filtros.</div></div>';
    return;
  }

  boloesCache = boloes || [];

  const ids = boloes.map(b => b.bolao_id);

  const [{ data: vendas }, { data: lojasBolao }] = await Promise.all([
    sb.from(VIEW_VENDAS).select('*').in('bolao_id', ids),
    sb.from(VIEW_LOJAS).select('*').in('bolao_id', ids)
  ]);

  const canalMap = {};
  const funcMap = {};

  (boloes || []).forEach(b => {
    canalMap[b.bolao_id] = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0 };
    funcMap[b.bolao_id] = {};
  });

  (vendas || []).forEach(v => {
    if (!canalMap[v.bolao_id]) {
      canalMap[v.bolao_id] = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0 };
    }

    canalMap[v.bolao_id][v.canal] = (canalMap[v.bolao_id][v.canal] || 0) + (v.qtd_vendida || 0);

    if (v.usuario_id) {
      if (!funcMap[v.bolao_id]) funcMap[v.bolao_id] = {};
      funcMap[v.bolao_id][v.usuario_id] = (funcMap[v.bolao_id][v.usuario_id] || 0) + (v.qtd_vendida || 0);
    }
  });

  const lojaMap = {};
  (lojasBolao || []).forEach(r => {
    if (!lojaMap[r.bolao_id]) lojaMap[r.bolao_id] = {};
    lojaMap[r.bolao_id][r.loja_slug] = {
      bruto: r.estoque_bruto_loja,
      vend: r.qtd_vendida_loja,
      bruto_venda: r.bruto_venda
    };
  });

  const funcIds = [...new Set((vendas || []).map(v => v.usuario_id).filter(Boolean))];
  const funcNomes = {};
  usuarios.forEach(u => {
    if (funcIds.includes(u.id)) funcNomes[u.id] = u.nome.split(' ')[0];
  });

  const totVendaReal = boloes.reduce((s, b) => s + Number(b.venda_real_total || 0), 0);
  const totEncalhe = boloes.reduce((s, b) => s + Number(b.encalhe_total || 0), 0);
  const totLiquido = boloes.reduce((s, b) => s + Number(b.estoque_liquido_total || 0), 0);
  const totVCont = boloes.reduce((s, b) => s + Number(b.venda_contabil_total || 0), 0);

  $('statsRow').style.display = 'grid';
  $('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-label">Bolões</div><div class="stat-value">${boloes.length}</div></div>
    <div class="stat-card"><div class="stat-label">Venda Real Total</div><div class="stat-value green">${fmtN(totVendaReal)}</div></div>
    <div class="stat-card"><div class="stat-label">Encalhe Total</div><div class="stat-value amber">${fmtN(totEncalhe)}</div></div>
    <div class="stat-card"><div class="stat-label">Estoque Líquido</div><div class="stat-value blue">${fmtN(totLiquido)}</div></div>
    <div class="stat-card"><div class="stat-label">Venda Contábil</div><div class="stat-value green">${fmtN(totVCont)}</div></div>
  `;

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap fade-in';

  const nFunc = funcIds.length;
  const nSlug = slugsLojas.length;

  const grpRow = `<tr class="grp-row">
    <th colspan="10" class="grp-bolao sep-col">Bolão</th>
    <th colspan="3" class="grp-canal sep-col">Canal de Venda</th>
    ${nFunc > 0 ? `<th colspan="${nFunc}" class="grp-func sep-col">Venda por Funcionário</th>` : ''}
    <th colspan="${nSlug}" class="grp-loja sep-col">Qtd Mov. / Vend. por Loja</th>
    <th colspan="2" class="grp-enc sep-col">Encalhe na Origem</th>
    <th colspan="4" class="grp-sint">Síntese Geral</th>
  </tr>`;

  const funcCols = funcIds.map(id => `<th>${funcNomes[id] || 'Func.'}</th>`).join('');
  const lojaCols = slugsLojas.map(s => `<th>${slugLabel[s]}</th>`).join('');

  const colRow = `<tr class="col-row">
    <th>Sel.</th>
    <th class="left">Origem</th>
    <th>Dt Ini</th>
    <th>Dt Conc</th>
    <th class="left">Modalidade</th>
    <th>Conc.</th>
    <th>Jogos</th>
    <th>Dez.</th>
    <th>V.Cota</th>
    <th class="sep-col">Qtd Cotas</th>

    <th>Balcão</th>
    <th>WPP</th>
    <th class="sep-col">MKP</th>

    ${nFunc > 0 ? funcCols : ''}

    ${lojaCols}

    <th>Enc.Físico</th>
    <th class="sep-col">Enc.Virtual</th>

    <th>Total Cotas / Venda Real</th>
    <th>Encalhe Total</th>
    <th>Est. Líquido</th>
    <th>V.Contábil</th>
  </tr>`;

  const rows = boloes.map(b => {
    const cm = canalMap[b.bolao_id] || {};
    const lm = lojaMap[b.bolao_id] || {};
    const fm = funcMap[b.bolao_id] || {};

    const funcTds = funcIds.map(id => `<td class="purple">${fmtN(fm[id] || 0)}</td>`).join('');
    const lojaTds = slugsLojas.map(s => {
      const cell = lm[s];
      return `<td class="cyan">${cell?.bruto_venda || fmtPair(null, null)}</td>`;
    }).join('');

    return `<tr>
      <td>
        <label class="bolao-check-wrap">
          <input type="checkbox" class="bolao-check" data-id="${b.bolao_id}">
        </label>
      </td>
      <td class="left">${b.origem_nome || '—'}</td>
      <td class="mono dim">${fmtDate(b.dt_inicial)}</td>
      <td class="mono dim">${fmtDate(b.dt_concurso)}</td>
      <td class="left bold">${b.modalidade}</td>
      <td class="mono">#${b.concurso}</td>
      <td class="mono">${fmtN(b.qtd_jogos)}</td>
      <td class="mono">${fmtN(b.qtd_dezenas)}</td>
      <td class="amber">${fmtBRL(b.valor_cota)}</td>
      <td class="mono sep-col">${fmtN(b.qtd_cotas_total)}</td>

      <td class="blue">${fmtN(cm.BALCAO || 0)}</td>
      <td class="blue">${fmtN(cm.WHATSAPP || 0)}</td>
      <td class="blue sep-col">${fmtN(cm.MARKETPLACE || 0)}</td>

      ${nFunc > 0 ? funcTds : ''}

      ${lojaTds}

      <td class="amber">${fmtN(b.enc_fisico)}</td>
      <td class="amber sep-col">${fmtN(b.enc_virtual)}</td>

      <td class="green">${b.total_cotas_venda_real || fmtPair(b.qtd_cotas_total, b.venda_real_total)}</td>
      <td class="amber">${fmtN(b.encalhe_total)}</td>
      <td class="blue">${fmtN(b.estoque_liquido_total)}</td>
      <td class="green">${fmtN(b.venda_contabil_total)}</td>
    </tr>`;
  }).join('');

  const totCanal = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0 };
  Object.values(canalMap).forEach(cm => {
    ['BALCAO', 'WHATSAPP', 'MARKETPLACE'].forEach(c => {
      totCanal[c] += (cm[c] || 0);
    });
  });

  const totFuncTds = funcIds.map(id => {
    const t = Object.values(funcMap).reduce((s, fm) => s + (fm[id] || 0), 0);
    return `<td class="purple bold">${fmtN(t)}</td>`;
  }).join('');

  const totLojaTds = slugsLojas.map(s => {
    const bruto = (lojasBolao || [])
      .filter(r => r.loja_slug === s)
      .reduce((sum, r) => sum + Number(r.estoque_bruto_loja || 0), 0);

    const venda = (lojasBolao || [])
      .filter(r => r.loja_slug === s)
      .reduce((sum, r) => sum + Number(r.qtd_vendida_loja || 0), 0);

    return `<td class="cyan bold">${fmtPair(bruto, venda)}</td>`;
  }).join('');

  const totEncFis = boloes.reduce((s, b) => s + Number(b.enc_fisico || 0), 0);
  const totEncVirt = boloes.reduce((s, b) => s + Number(b.enc_virtual || 0), 0);
  const totCotas = boloes.reduce((s, b) => s + Number(b.qtd_cotas_total || 0), 0);

  const totalRow = `<tr style="background:rgba(0,200,150,0.04);border-top:1px solid var(--border2)">
    <td class="left bold" style="color:var(--accent);font-family:var(--mono);font-size:10px;letter-spacing:.1em">TOTAL</td>
    <td colspan="9" class="sep-col"></td>

    <td class="blue bold">${fmtN(totCanal.BALCAO)}</td>
    <td class="blue bold">${fmtN(totCanal.WHATSAPP)}</td>
    <td class="blue bold sep-col">${fmtN(totCanal.MARKETPLACE)}</td>

    ${nFunc > 0 ? totFuncTds : ''}

    ${totLojaTds}

    <td class="amber bold">${fmtN(totEncFis)}</td>
    <td class="amber bold sep-col">${fmtN(totEncVirt)}</td>

    <td class="green bold">${fmtPair(totCotas, totVendaReal)}</td>
    <td class="amber bold">${fmtN(totEncalhe)}</td>
    <td class="blue bold">${fmtN(totLiquido)}</td>
    <td class="green bold">${fmtN(totVCont)}</td>
  </tr>`;

  wrap.innerHTML = `<table class="data-table">
    <thead>${grpRow}${colRow}</thead>
    <tbody>${rows}${totalRow}</tbody>
  </table>`;

  $('tableArea').innerHTML = '';
  $('tableArea').appendChild(wrap);

  bindSelecaoBoloes();
}

updateClock();
setInterval(updateClock, 1000);

document.addEventListener('DOMContentLoaded', init);
