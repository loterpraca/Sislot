const sb = supabase.createClient(
  window.SISLOT_CONFIG.url,
  window.SISLOT_CONFIG.anonKey
);

const { $, showToast } = window.SISLOT_UTILS;

const state = {
  loterias: [],
  usuario: null,
  activeTab: 'visao',
  embedsLoaded: {},
};

const TAB_ROUTES = {
  cadastro: './bolao-cadastro.html',
  movimentacao: './bolao-movimentar.html',
};

const MODALIDADES = [
  'Mega Sena', 'Lotofácil', 'Quina', 'Dupla Sena', 'Dia de Sorte', 'Super Sete',
  '+Milionária', 'Timemania', 'Lotomania', 'Loteca', 'Federal', 'Páscoa', 'São João',
  'Independência', 'Virada'
];

init();

async function init() {
  try {
    SISLOT_THEME.init();
    bindTabs();
    restoreTabFromHash();
    bindActions();
    preencherModalidades();
    await carregarUsuario();
    await carregarLoterias();
    aplicarFiltroLojaPeloTema();
    await carregarBoloes();
    switchTab(state.activeTab);

    document.addEventListener('sislot:tema', async () => {
      aplicarFiltroLojaPeloTema();
      await carregarBoloes();
    });
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Erro ao carregar módulo.', 'err');
  }
}

async function carregarUsuario() {
  const { data: { session }, error } = await sb.auth.getSession();
  if (error) throw new Error(error.message);
  if (!session?.user?.id) {
    location.href = './login.html';
    return;
  }
  state.usuario = await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
}

function bindTabs() {
  document.querySelectorAll('.boloes-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function bindActions() {
  $('btnFiltrar')?.addEventListener('click', carregarBoloes);
  $('btnLimparFiltros')?.addEventListener('click', () => {
    ['fDtConcDe','fDtConcAte','fModal','fConc','fStatus'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    aplicarFiltroLojaPeloTema();
    carregarBoloes();
  });
}

function switchTab(tab) {
  state.activeTab = tab;
  updateHash(tab);
  document.querySelectorAll('.boloes-tab').forEach(btn => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.boloes-panel').forEach(panel => {
    panel.classList.toggle('is-active', panel.dataset.panel === tab);
  });
  ensureEmbeddedTab(tab);
}

function restoreTabFromHash() {
  const raw = String(location.hash || '').replace('#', '').trim();
  const allowed = ['visao','cadastro','movimentacao','mestra','auditoria'];
  if (allowed.includes(raw)) state.activeTab = raw;
}

function updateHash(tab) {
  const newHash = `#${tab}`;
  if (location.hash !== newHash) history.replaceState(null, '', newHash);
}

function ensureEmbeddedTab(tab) {
  const src = TAB_ROUTES[tab];
  if (!src) return;

  const wrapId = tab === 'cadastro' ? 'embedCadastroWrap' : 'embedMovimentacaoWrap';
  const wrap = $(wrapId);
  if (!wrap) return;

  if (state.embedsLoaded[tab]) return;

  wrap.innerHTML = `<div class="boloes-embed-loading">Carregando ${tab === 'cadastro' ? 'cadastro' : 'movimentação'}…</div>`;

  const frame = document.createElement('iframe');
  frame.className = 'boloes-embed-frame';
  frame.src = src;
  frame.loading = 'lazy';
  frame.title = tab === 'cadastro' ? 'Cadastro de bolão' : 'Movimentação de bolão';
  frame.addEventListener('load', () => {
    wrap.innerHTML = '';
    wrap.appendChild(frame);
    state.embedsLoaded[tab] = true;
  }, { once: true });
}

function preencherModalidades() {
  const sel = $('fModal');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas</option>' +
    MODALIDADES.map(m => `<option value="${m}">${m}</option>`).join('');
}

async function carregarLoterias() {
  const { data, error } = await sb
    .from('loterias')
    .select('id,nome,slug')
    .order('nome');

  if (error) throw new Error(error.message);
  state.loterias = data || [];

  const sel = $('fLoja');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas</option>' +
    state.loterias.map(l => `<option value="${l.id}">${l.nome}</option>`).join('');
}

function aplicarFiltroLojaPeloTema() {
  const temaSlug = SISLOT_THEME.lojaSlug();
  const sel = $('fLoja');
  if (!sel) return;
  if (!temaSlug || temaSlug === 'todas') {
    sel.value = '';
    return;
  }
  const lot = state.loterias.find(x => x.slug === temaSlug);
  sel.value = lot ? String(lot.id) : '';
}

async function carregarBoloes() {
  try {
    setStatus('Carregando bolões…', 'muted');
    renderLoading();

    let q = sb.from('view_resultado_bolao')
      .select('*')
      .order('modalidade')
      .order('dt_concurso')
      .order('valor_cota');

    if ($('fDtConcDe')?.value)  q = q.gte('dt_concurso', $('fDtConcDe').value);
    if ($('fDtConcAte')?.value) q = q.lte('dt_concurso', $('fDtConcAte').value);
    if ($('fModal')?.value)     q = q.eq('modalidade', $('fModal').value);
    if ($('fConc')?.value)      q = q.ilike('concurso', `%${$('fConc').value.trim()}%`);
    if ($('fLoja')?.value)      q = q.eq('loteria_id', Number($('fLoja').value));
    if ($('fStatus')?.value)    q = q.eq('status', $('fStatus').value);

    const { data: boloes, error } = await q;
    if (error) throw new Error(error.message);

    if (!boloes?.length) {
      renderEmpty('Nenhum bolão encontrado', 'Ajuste os filtros e tente novamente.');
      preencherKpis([]);
      setStatus('Nenhum resultado para os filtros.', 'muted');
      return;
    }

    const ids = boloes.map(b => b.bolao_id);

    const [{ data: vendasCanal }, { data: destinos }] = await Promise.all([
      sb.from('boloes_vendas')
        .select('bolao_id,canal,usuario_id,qtd_vendida,loteria_id')
        .in('bolao_id', ids),
      sb.from('view_posicao_destinos')
        .select('bolao_id,loteria_id,loteria_nome,loteria_slug,qtd_encalhe,qtd_cotas_liquidas,qtd_vendida_apurada')
        .in('bolao_id', ids),
    ]);

    const canalMap = {};
    const destinoMap = {};

    (vendasCanal || []).forEach(v => {
      if (!canalMap[v.bolao_id]) canalMap[v.bolao_id] = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0, CAIXA: 0, EXTERNA: 0 };
      const canal = (v.canal || 'CAIXA').toUpperCase();
      canalMap[v.bolao_id][canal] = (canalMap[v.bolao_id][canal] || 0) + Number(v.qtd_vendida || 0);
    });

    (destinos || []).forEach(d => {
      if (!destinoMap[d.bolao_id]) destinoMap[d.bolao_id] = [];
      destinoMap[d.bolao_id].push(d);
    });

    renderTabela(boloes, canalMap, destinoMap);
    preencherKpis(boloes, canalMap, destinoMap);
    setStatus(`${boloes.length} bolão(ões) carregado(s).`, 'ok');
  } catch (err) {
    console.error(err);
    renderEmpty('Erro ao carregar', err.message || 'Falha na consulta.');
    preencherKpis([]);
    setStatus(err.message || 'Erro ao carregar bolões.', 'err');
  }
}

function preencherKpis(boloes = [], canalMap = {}, destinoMap = {}) {
  $('kpiBoloes').textContent = String(boloes.length || 0);

  let totalVendidas = 0;
  let totalMov = 0;
  let totalEncalhe = 0;

  boloes.forEach(b => {
    const canais = canalMap[b.bolao_id] || {};
    totalVendidas += Object.values(canais).reduce((a, n) => a + Number(n || 0), 0);

    const destinos = destinoMap[b.bolao_id] || [];
    const externos = destinos.filter(d => String(d.loteria_id) !== String(b.loteria_id));
    totalMov += externos.reduce((a, d) => a + Math.max(Number(d.qtd_cotas_liquidas || 0), 0), 0);
    totalEncalhe += destinos.reduce((a, d) => a + Number(d.qtd_encalhe || 0), 0);
  });

  $('kpiVendidas').textContent = String(totalVendidas);
  $('kpiMovExterna').textContent = String(totalMov);
  $('kpiEncalhe').textContent = String(totalEncalhe);
}

function renderTabela(boloes, canalMap, destinoMap) {
  const tbody = $('tbodyBoloes');
  tbody.innerHTML = boloes.map(b => {
    const canais = canalMap[b.bolao_id] || {};
    const destinos = destinoMap[b.bolao_id] || [];
    const externos = destinos.filter(d => String(d.loteria_id) !== String(b.loteria_id));

    const vendaWhatsapp = Number(canais.WHATSAPP || 0);
    const vendaMarketplace = Number(canais.MARKETPLACE || 0);
    const vendaInterna = Number(canais.CAIXA || 0) + Number(canais.BALCAO || 0);
    const vendaExterna = externos.reduce((a, d) => a + Number(d.qtd_vendida_apurada || 0), 0);
    const qtdVenda = vendaInterna + vendaExterna + vendaWhatsapp + vendaMarketplace;
    const movExterna = externos.reduce((a, d) => a + Math.max(Number(d.qtd_cotas_liquidas || 0), 0), 0);
    const encFisico = Number(b.enc_fisico || 0);
    const encVirtual = Number(b.enc_virtual || 0);

    return `
      <tr>
        <td>${escapeHtml(b.modalidade || '—')}</td>
        <td class="boloes-cell-mono">${escapeHtml(String(b.concurso || '—'))}</td>
        <td>${escapeHtml(b.loteria_nome || lookupLoteriaName(b.loteria_id))}</td>
        <td class="boloes-cell-mono">${fmtDate(b.dt_concurso)}</td>
        <td class="boloes-cell-money">${fmtMoney(b.valor_cota)}</td>
        <td class="boloes-cell-center boloes-cell-mono">${num(b.qtd_cotas_total)}</td>
        <td class="boloes-cell-center boloes-cell-mono">${num(vendaInterna)}</td>
        <td class="boloes-cell-center boloes-cell-mono">${num(vendaExterna)}</td>
        <td class="boloes-cell-center boloes-cell-mono">${num(vendaWhatsapp)}</td>
        <td class="boloes-cell-center boloes-cell-mono">${num(vendaMarketplace)}</td>
        <td class="boloes-cell-center boloes-cell-mono">${num(qtdVenda)}</td>
        <td class="boloes-cell-center boloes-cell-mono">${num(movExterna)}</td>
        <td class="boloes-cell-center boloes-cell-mono">${num(encFisico)}</td>
        <td class="boloes-cell-center boloes-cell-mono">${num(encVirtual)}</td>
        <td>${statusBadge(b.status)}</td>
      </tr>`;
  }).join('');
}

function renderLoading() {
  $('tbodyBoloes').innerHTML = `
    <tr><td colspan="15"><div class="boloes-empty"><div class="boloes-empty-title">Carregando bolões…</div></div></td></tr>`;
}

function renderEmpty(title, sub) {
  $('tbodyBoloes').innerHTML = `
    <tr><td colspan="15"><div class="boloes-empty"><div class="boloes-empty-title">${escapeHtml(title)}</div><div class="boloes-empty-sub">${escapeHtml(sub)}</div></div></td></tr>`;
}

function statusBadge(status) {
  const txt = String(status || '—').toUpperCase();
  let cls = 'boloes-badge--muted';
  if (txt === 'ATIVO') cls = 'boloes-badge--ok';
  else if (txt === 'ENCERRADO') cls = 'boloes-badge--warn';
  else if (txt === 'CANCELADO') cls = 'boloes-badge--err';
  return `<span class="boloes-badge ${cls}">${escapeHtml(txt)}</span>`;
}

function lookupLoteriaName(id) {
  return state.loterias.find(x => String(x.id) === String(id))?.nome || '—';
}

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(v) {
  if (!v) return '—';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(v);
}

function num(v) {
  return Number(v || 0).toLocaleString('pt-BR');
}

function setStatus(msg, kind = 'muted') {
  const bar = $('statusBar');
  if (!bar) return;
  bar.textContent = msg || '';
  bar.className = 'sl-status-bar';
  if (msg) {
    bar.classList.add('is-visible');
    if (kind === 'ok') bar.classList.add('is-ok');
    else if (kind === 'err') bar.classList.add('is-err');
    else bar.classList.add('is-muted');
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
