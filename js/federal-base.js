window.FED_BASE = (() => {
  const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

  const $ = (id) => document.getElementById(id);

  function fmtMoney(v) {
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  }

  function fmtDate(v) {
    if (!v) return '—';
    const [y, m, d] = String(v).split('-');
    return `${d}/${m}/${y}`;
  }

  function startClock(id = 'relogio') {
    const el = $(id);
    if (!el) return;
    const tick = () => {
      el.textContent =
        new Date().toLocaleTimeString('pt-BR') +
        ' — ' +
        new Date().toLocaleDateString('pt-BR');
    };
    tick();
    setInterval(tick, 1000);
  }

  function showStatus(id, msg, type = 'ok') {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.className = `status-bar show ${type}`;
  }

  function fillSelect(selectId, items, placeholder = 'Selecione...', valueKey = 'id', labelFn = (x) => x.nome) {
    const sel = $(selectId);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    (items || []).forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item[valueKey];
      opt.textContent = labelFn(item);
      sel.appendChild(opt);
    });
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  }

  async function requireSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      location.href = './login.html';
      return null;
    }

    const { data: user } = await sb
      .from('usuarios')
      .select('id,nome,perfil,ativo')
      .eq('auth_user_id', session.user.id)
      .eq('ativo', true)
      .maybeSingle();

    return user || null;
  }

  async function loadLoterias() {
    const { data } = await sb
      .from('loterias')
      .select('id,nome,slug,ativo')
      .eq('ativo', true)
      .order('id');

    return data || [];
  }

  async function loadUsuarios() {
    const { data } = await sb
      .from('usuarios')
      .select('id,nome,ativo')
      .eq('ativo', true)
      .order('nome');

    return data || [];
  }

  async function loadFederais() {
    const { data } = await sb
      .from('federais')
      .select('*')
      .order('dt_sorteio', { ascending: false })
      .order('concurso', { ascending: false })
      .order('loteria_id');

    return data || [];
  }

  function lookupLoteriaName(list, id) {
    return list.find((x) => String(x.id) === String(id))?.nome || '—';
  }

  function lookupFederal(list, id) {
    return list.find((x) => String(x.id) === String(id));
  }

  function nextWedOrSat(base = new Date()) {
    const d = new Date(base);
    d.setHours(12, 0, 0, 0);
    while (![3, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function nextQuaSabFrom(baseIso, dir) {
    let d = new Date((baseIso || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
    d.setDate(d.getDate() + (dir > 0 ? 1 : -1));
    while (![3, 6].includes(d.getDay())) d.setDate(d.getDate() + (dir > 0 ? 1 : -1));
    return d.toISOString().slice(0, 10);
  }

  return {
    sb,
    $,
    fmtMoney,
    fmtDate,
    startClock,
    showStatus,
    fillSelect,
    requireSession,
    loadLoterias,
    loadUsuarios,
    loadFederais,
    lookupLoteriaName,
    lookupFederal,
    nextWedOrSat,
    nextQuaSabFrom
  };
})();
