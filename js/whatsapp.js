const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

// ── CORES disponíveis para bolões ────────────────────────────────
const CORE_BOLAO = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#64748b','#a16207',
  '#dc2626','#16a34a','#0891b2','#7c3aed','#db2777',
];

// ── Estado ────────────────────────────────────────────────────────
let usuario        = null;
let dataAtual      = new Date();
let dataAtualReg   = new Date();
let clientes       = [];
let lojasAtivas    = [];S
let lojasPermitidas = [];
let lojaWhatsappAtiva = null;
let clienteSel     = null;
let clienteEditId  = null;
let bolaoSelReg    = null;
let viewMode       = 'bolao';
let coresBolao     = {};
const $ = id => document.getElementById(id);

function normalizaDataLocal(dt){
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function hojeLocal(){
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), h.getDate());
}
function isoDate(dt){
  const d = normalizaDataLocal(dt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}
function dataFromISO(iso){
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return hojeLocal();
  return new Date(y, m - 1, d);
}
function fmtData(dt){
  const d = normalizaDataLocal(dt);
  return d.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
}
function fmtBRL(v){return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
function parseBRL(v){return parseFloat(String(v).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.'))||0}
function iniciais(n){return(n||'?').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}
function tel2wpp(t){return String(t).replace(/\D/g,'')}

// ── Configuração visual das lojas ────────────────────────────────
const LOJA_CONFIG = {
  'boulevard':    { nome:'Boulevard',    logo:'./icons/boulevard.png',    theme:'boulevard',    logoPos:'50% 50%' },
  'centro':       { nome:'Centro',       logo:'./icons/loterpraca.png',   theme:'centro',       logoPos:'50% 42%' },
  'lotobel':      { nome:'Lotobel',      logo:'./icons/lotobel.png',      theme:'lotobel',      logoPos:'50% 50%' },
  'santa-tereza': { nome:'Santa Tereza', logo:'./icons/santa-tereza.png', theme:'santa-tereza', logoPos:'50% 50%' },
  'via-brasil':   { nome:'Via Brasil',   logo:'./icons/via-brasil.png',   theme:'via-brasil',   logoPos:'50% 50%' },
};

function slugSeguro(slug){
  return String(slug || 'centro').trim().toLowerCase();
}
function setStatusReg(msg,tipo='info'){const e=$('statusBarReg');e.textContent=msg;e.className='status-bar show '+tipo}
function clearStatusReg(){$('statusBarReg').className='status-bar'}
function aplicarTemaWhatsapp(slug){
  const key = slugSeguro(slug);
  const cfg = LOJA_CONFIG[key] || LOJA_CONFIG.centro;

  document.body.setAttribute('data-loja', key);

  const img = $('logoImg');
  if (img) {
    img.src = cfg.logo;
    img.style.objectPosition = cfg.logoPos || '50% 50%';
  }

  const title = $('headerTitle');
  if (title) title.textContent = cfg.nome;

  const sub = $('headerSub');
  if (sub) sub.textContent = 'Vendas WhatsApp';

  const nomeChip = $('wppLojaNome');
  if (nomeChip) nomeChip.textContent = cfg.nome;
}

function atualizarLojaWhatsappUI(){
  const slug = lojaWhatsappAtiva?.loteria_slug || lojaWhatsappAtiva?.slug || 'centro';
  aplicarTemaWhatsapp(slug);
}
function sincronizarFiltroHistoricoComLojaAtiva(){
  const sel = $('filtLoja');
  if (!sel || !lojaWhatsappAtiva?.loteria_id) return;

  sel.value = String(lojaWhatsappAtiva.loteria_id);
}
function getIndiceLojaWhatsappAtual(){
  if (!lojasPermitidas.length || !lojaWhatsappAtiva) return -1;
  return lojasPermitidas.findIndex(l => Number(l.loteria_id) === Number(lojaWhatsappAtiva.loteria_id));
}

async function trocarLojaWhatsappPorOffset(offset){
  if (!lojasPermitidas.length) return;

  let idx = getIndiceLojaWhatsappAtual();
  if (idx < 0) idx = 0;

  let prox = idx + offset;
  if (prox < 0) prox = lojasPermitidas.length - 1;
  if (prox >= lojasPermitidas.length) prox = 0;

  await trocarLojaWhatsapp(lojasPermitidas[prox]);
}

async function trocarLojaWhatsapp(loja){
  if (!loja) return;

  lojaWhatsappAtiva = loja;

  atualizarLojaWhatsappUI();
  sincronizarFiltroHistoricoComLojaAtiva();

  limparBolaoSelecionadoWpp();

  await buscarBoloesReg();
  await carregarVendas();

  if ($('tab-historico')?.classList.contains('active')) {
    await carregarHistorico();
  }
}
async function carregarContextoLojas(){
  const { data: todas } = await sb
    .from('loterias')
    .select('id,nome,slug')
    .eq('ativo', true)
    .order('id');

  lojasAtivas = todas || [];

  const { data: vinculos } = await sb
    .from('usuarios_loterias')
    .select('loteria_id,principal,ativo')
    .eq('usuario_id', usuario.id)
    .eq('ativo', true);

  const idsPermitidos = new Set((vinculos || []).map(v => Number(v.loteria_id)));

  lojasPermitidas = lojasAtivas
    .filter(l => idsPermitidos.has(Number(l.id)))
    .map(l => ({
      loteria_id: l.id,
      loteria_nome: l.nome,
      loteria_slug: l.slug,
      principal: !!(vinculos || []).find(v => Number(v.loteria_id) === Number(l.id) && v.principal)
    }));

  // Fallback para ADMIN/SOCIO se por algum motivo não vier vínculo.
  if (!lojasPermitidas.length && ['ADMIN','SOCIO'].includes(String(usuario.perfil || '').toUpperCase())) {
    lojasPermitidas = lojasAtivas.map(l => ({
      loteria_id: l.id,
      loteria_nome: l.nome,
      loteria_slug: l.slug,
      principal: l.slug === 'centro'
    }));
  }

  lojaWhatsappAtiva =
    lojasPermitidas.find(l => l.principal) ||
    lojasPermitidas[0] ||
    null;

  if (!lojaWhatsappAtiva) {
    throw new Error('Nenhuma loja disponível para este usuário.');
  }

  atualizarLojaWhatsappUI();

  const selHist = $('filtLoja');
  if (selHist) {
    selHist.innerHTML = '<option value="">Todas as lojas</option>';
    lojasAtivas.forEach(l => {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = l.nome;
      selHist.appendChild(o);
    });
  }
  sincronizarFiltroHistoricoComLojaAtiva();
}
// ── Relógio ───────────────────────────────────────────────────────
function updateClock(){
  const now=new Date();
  $('relogio').textContent=now.toLocaleTimeString('pt-BR')+' — '+now.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
}
updateClock();setInterval(updateClock,1000);

// ── Cores bolão (localStorage) ────────────────────────────────────
function loadCoresBolao(){try{coresBolao=JSON.parse(localStorage.getItem('sl_cores_bolao')||'{}')}catch{coresBolao={}}}
function saveCoresBolao(){try{localStorage.setItem('sl_cores_bolao',JSON.stringify(coresBolao))}catch{}}
function getCorBolao(id){return coresBolao[id]||'#3d5a8a'}
function setCorBolao(id,cor){coresBolao[id]=cor;saveCoresBolao()}

// ── TABS ──────────────────────────────────────────────────────────
function switchTab(id){
  document.querySelectorAll('.tab-btn').forEach((b,i)=>{
    b.classList.toggle('active',['vendas','registrar','clientes','historico'][i]===id);
  });

  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  $('tab-'+id).classList.add('active');

  if (id === 'clientes') {
    renderClientes();
  }

  if (id === 'historico') {
    sincronizarFiltroHistoricoComLojaAtiva();
    carregarHistorico();
  }
}

// ── VIEW MODE ─────────────────────────────────────────────────────
function setViewMode(mode){
  viewMode=mode;
  $('toggleBolao').classList.toggle('active',mode==='bolao');
  $('toggleCliente').classList.toggle('active',mode==='cliente');
  carregarVendas();
}

// ── INIT ──────────────────────────────────────────────────────────
async function init(){
  const{data:{session}}=await sb.auth.getSession();
  if(!session){location.href='./login.html';return}
  const{data:usr}=await sb.from('usuarios').select('id,nome,perfil,ativo,pode_logar')
    .eq('auth_user_id',session.user.id).eq('ativo',true).eq('pode_logar',true).maybeSingle();
  if(!usr){location.href='./login.html';return}
  usuario=usr;
  loadCoresBolao();

  await carregarContextoLojas();

  await carregarClientes();
  $('btnLogout').onclick=async()=>{await sb.auth.signOut();location.href='./login.html'};
  
  const lojaTree = $('lojaTreeWrap');
  if (lojaTree) lojaTree.onclick = () => trocarLojaWhatsappPorOffset(1);

  const lojaChip = $('wppLojaChip');
  if (lojaChip) lojaChip.onclick = () => trocarLojaWhatsappPorOffset(1);
  const btnLimparBolaoWpp = $('btnLimparBolaoWpp');
  if (btnLimparBolaoWpp) btnLimparBolaoWpp.onclick = limparBolaoSelecionadoWpp;

  const btnFecharVendaWpp = $('btnFecharVendaWpp');
  if (btnFecharVendaWpp) btnFecharVendaWpp.onclick = fecharPainelVendaWpp;
  
  dataAtual=hojeLocal();dataAtualReg=hojeLocal();
  atualizarDates();
  await carregarVendas();
  await buscarBoloesReg();
}

function atualizarDates(){
  dataAtual = normalizaDataLocal(dataAtual);
  dataAtualReg = normalizaDataLocal(dataAtualReg);

  const isoVendas = isoDate(dataAtual);
  const isoReg = isoDate(dataAtualReg);

  if ($('dateDisplay')) $('dateDisplay').textContent = fmtData(dataAtual);
  if ($('datePicker')) $('datePicker').value = isoVendas;

  if ($('dateDisplayReg')) $('dateDisplayReg').textContent = fmtData(dataAtualReg);
  if ($('datePickerReg')) $('datePickerReg').value = isoReg;
}

function alterarDataVendas(deltaDias){
  const d = normalizaDataLocal(dataAtual);
  d.setDate(d.getDate() + deltaDias);
  dataAtual = d;
  atualizarDates();
  return carregarVendas();
}

function alterarDataRegistro(deltaDias){
  const d = normalizaDataLocal(dataAtualReg);
  d.setDate(d.getDate() + deltaDias);
  dataAtualReg = d;
  atualizarDates();
  return buscarBoloesReg();
}

// ── VENDAS (aba principal) ────────────────────────────────────────
async function carregarVendas(){
  $('vendasContent').innerHTML='<div class="state-box"><div class="spinner"></div><div class="state-title">Buscando…</div></div>';
  const iso=isoDate(dataAtual);

  // Busca vendas da data (bolões vigentes com ao menos 1 venda)
 let query = sb.from('view_vendas_whatsapp')
  .select('*')
  .lte('data_referencia', iso)
  .gte('dt_concurso', iso);

if (lojaWhatsappAtiva?.loteria_id) {
  query = query.eq('loteria_id', lojaWhatsappAtiva.loteria_id);
}

const { data:vendas, error } = await query
  .order('modalidade')
  .order('created_at');

if (error) {
  $('vendasContent').innerHTML = `
    <div class="state-box">
      <div class="state-title">Erro ao buscar vendas</div>
      <div class="state-sub">${error.message}</div>
    </div>`;
  return;
}
  if(!vendas?.length){
    $('vendasContent').innerHTML=`<div class="state-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
      <div class="state-title">Nenhuma venda</div>
     <div class="state-sub">Não há vendas registradas no WhatsApp ${lojaWhatsappAtiva?.loteria_nome || 'da loja'} em ${fmtData(dataAtual)}.</div></div>`;
    return;
  }

  // Monta lista de bolões únicos a partir das vendas
  const boloesMap={};
  vendas.forEach(v=>{
    if(!boloesMap[v.bolao_id]) boloesMap[v.bolao_id]={
      id:v.bolao_id, modalidade:v.modalidade, concurso:v.concurso,
      valor_cota:v.valor_cota, qtd_jogos:v.qtd_jogos, qtd_dezenas:v.qtd_dezenas,
      qtd_cotas_total:null, loteria_id:v.loteria_id,
      loterias:{nome:v.loteria_nome, slug:v.loteria_slug}
    };
  });
  const boloes=Object.values(boloesMap);

  if(viewMode==='bolao') renderVendasPorBolao(boloes,vendas||[]);
  else renderVendasPorCliente(boloes,vendas||[]);
}

// ── RENDER: por bolão ─────────────────────────────────────────────
function renderVendasPorBolao(boloes,vendas){
  const wrap=document.createElement('div');wrap.className='fade-in';
  const grupos={};
  boloes.forEach(b=>{if(!grupos[b.modalidade])grupos[b.modalidade]=[];grupos[b.modalidade].push(b)});
  const mods=Object.keys(grupos).sort();

  mods.forEach((mod,mi)=>{
    const sep=document.createElement('div');sep.className='sec-sep';
    if(mi>0)sep.style.marginTop='28px';
    sep.innerHTML=`<div class="sec-sep-label">${mod}</div><div class="sec-sep-line"></div><div class="sec-sep-count">${grupos[mod].length}</div>`;
    wrap.appendChild(sep);

    grupos[mod].sort((a,b)=>{
      if(a.loterias?.nome!==b.loterias?.nome)return(a.loterias?.nome||'')>(b.loterias?.nome||'')?1:-1;
      return(a.valor_cota||0)-(b.valor_cota||0);
    }).forEach(b=>{
      const vb=vendas.filter(v=>v.bolao_id===b.id);
      const totalCotas=vb.reduce((s,v)=>s+(v.qtd_vendida||0),0);
      const totalVal=vb.reduce((s,v)=>s+(v.qtd_vendida||0)*(v.valor_cota||0),0);
      const pgPend=vb.filter(v=>!v.pago).length;
      const confPend=vb.filter(v=>!v.conferencia_enviada).length;
      const sepPend=vb.filter(v=>!v.cota_separada).length;
      const cor=getCorBolao(b.id);

      const group=document.createElement('div');group.className='bolao-group';group.dataset.id=b.id;
      group.innerHTML=`
        <div class="bolao-group-header" onclick="toggleGroup(this)">
          <div class="color-picker-wrap">
            <div class="bolao-color-dot" id="dot-${b.id}" style="background:${cor}" onclick="e=>e.stopPropagation()" title="Clique para mudar a cor"></div>
            <div class="color-picker-popup" id="cp-${b.id}"></div>
          </div>
          <div class="bolao-info">
            <div class="bolao-titulo">
              ${b.modalidade}
              <span class="bolao-tag">#${b.concurso}</span>
              <span class="bolao-tag bolao-tag-loja">${b.loterias?.nome||'—'}</span>
              <span class="bolao-tag bolao-tag-val">${fmtBRL(b.valor_cota)}/cota</span>
            </div>
            <div class="bolao-stats">
              <span class="bolao-stat"><span>${totalCotas}</span> cotas vendidas</span>
              <span class="bolao-stat">Total: <span>${fmtBRL(totalVal)}</span></span>
              ${pgPend>0?`<span class="bolao-stat" style="color:#f87171">${pgPend} pag. pendente${pgPend>1?'s':''}</span>`:''}
              ${confPend>0?`<span class="bolao-stat" style="color:#7dd3fc">${confPend} conf. pendente${confPend>1?'s':''}</span>`:''}
              ${sepPend>0?`<span class="bolao-stat" style="color:#c4b5fd">${sepPend} não separada${sepPend>1?'s':''}</span>`:''}
              ${vb.length===0?'<span class="bolao-stat" style="color:var(--text3)">Sem vendas nesta data</span>':''}
            </div>
          </div>
          <div class="bolao-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
        </div>
        <div class="bolao-body">
          ${vb.length===0
            ? '<div style="padding:16px 20px;font-size:12px;color:var(--text3)">Nenhuma venda registrada para este bolão nesta data.</div>'
            : `<table class="vendas-table">
              <thead><tr>
                <th>Cliente</th><th>Qtd</th><th>Valor</th>
                <th>Pagamento</th><th>Conferência</th><th>Separação</th><th></th>
              </tr></thead>
              <tbody>${vb.map(v=>{
                const nome=v.cliente_apelido?`${v.cliente_nome}<div class="td-sub">${v.cliente_apelido}</div>`:v.cliente_nome;
                const vt=fmtBRL((v.qtd_vendida||0)*(v.valor_cota||0));
                return`<tr>
                  <td><div class="td-nome">${nome}</div></td>
                  <td class="td-mono">${v.qtd_vendida}</td>
                  <td class="td-green">${vt}</td>
                  <td><button class="badge ${v.pago?'badge-pago':'badge-pendente'}" onclick="togglePago(${v.id},${v.pago})">${v.pago?'✓ Pago':'$ Pendente'}</button></td>
                  <td><button class="badge ${v.conferencia_enviada?'badge-conf-ok':'badge-conf-no'}" onclick="toggleConf(${v.id},${v.conferencia_enviada})">${v.conferencia_enviada?'✓ Enviada':'⏳ Pendente'}</button></td>
                  <td><button class="badge ${v.cota_separada?'badge-sep-ok':'badge-sep-no'}" onclick="toggleSep(${v.id},${v.cota_separada})">${v.cota_separada?'✓ Separada':'◻ Pendente'}</button></td>
                  <td style="display:flex;gap:6px;align-items:center">
                    <button class="btn-wpp" onclick="enviarWpp('${v.cliente_telefone}','${v.cliente_nome}','${v.modalidade}','${v.concurso}',${v.qtd_vendida},${(v.qtd_vendida||0)*(v.valor_cota||0)})"><svg><use href="#wpp-icon"/></svg> WPP</button>
                    <button class="btn-del" onclick="deletarVenda(${v.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
                  </td>
                </tr>`}).join('')}
              </tbody></table>`
          }
        </div>`;

      // monta color picker
      const cp=group.querySelector(`#cp-${b.id}`);
      const dot=group.querySelector(`#dot-${b.id}`);
      CORE_BOLAO.forEach(c=>{
        const sw=document.createElement('div');sw.className='cp-swatch';sw.style.background=c;
        sw.onclick=e=>{e.stopPropagation();setCorBolao(b.id,c);dot.style.background=c;cp.classList.remove('open')};
        cp.appendChild(sw);
      });
      dot.onclick=e=>{e.stopPropagation();document.querySelectorAll('.color-picker-popup').forEach(x=>x!==cp&&x.classList.remove('open'));cp.classList.toggle('open')};
      document.addEventListener('click',()=>cp.classList.remove('open'),{once:false});

      wrap.appendChild(group);
    });
  });

  $('vendasContent').innerHTML='';
  $('vendasContent').appendChild(wrap);
}

// ── RENDER: por cliente ───────────────────────────────────────────
function renderVendasPorCliente(boloes,vendas){
  const wrap=document.createElement('div');wrap.className='fade-in';
  const porCliente={};
  vendas.forEach(v=>{
    const k=v.cliente_id;
    if(!porCliente[k])porCliente[k]={nome:v.cliente_nome,apelido:v.cliente_apelido,tel:v.cliente_telefone,vendas:[]};
    porCliente[k].vendas.push(v);
  });

  if(!Object.keys(porCliente).length){
    wrap.innerHTML=`<div class="state-box"><div class="state-title">Nenhuma venda nesta data</div><div class="state-sub">Registre a primeira venda na aba Registrar Venda.</div></div>`;
    $('vendasContent').innerHTML='';$('vendasContent').appendChild(wrap);return;
  }

  Object.values(porCliente).sort((a,b)=>a.nome.localeCompare(b.nome)).forEach(cli=>{
    const totalCotas=cli.vendas.reduce((s,v)=>s+(v.qtd_vendida||0),0);
    const totalVal=cli.vendas.reduce((s,v)=>s+(v.qtd_vendida||0)*(v.valor_cota||0),0);
    const grp=document.createElement('div');grp.className='cliente-group';
    grp.innerHTML=`
      <div class="cliente-group-header" onclick="this.parentElement.classList.toggle('open');this.nextElementSibling.style.display=this.parentElement.classList.contains('open')?'block':'none'">
        <div class="cli-avatar">${iniciais(cli.nome)}</div>
        <div class="cli-group-info">
          <div class="cli-group-nome">${cli.nome}${cli.apelido?` <span style="font-size:11px;color:var(--text3)">(${cli.apelido})</span>`:''}</div>
          <div class="cli-group-sub">${totalCotas} cotas · ${fmtBRL(totalVal)}</div>
        </div>
        <div class="bolao-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
      </div>
      <div class="bolao-body" style="display:none">
        <table class="vendas-table">
          <thead><tr><th>Bolão</th><th>Loja</th><th>Qtd</th><th>Valor</th><th>Pagamento</th><th>Conferência</th><th>Separação</th><th></th></tr></thead>
          <tbody>${cli.vendas.map(v=>{
            const vt=fmtBRL((v.qtd_vendida||0)*(v.valor_cota||0));
            const cor=getCorBolao(v.bolao_id);
            return`<tr>
              <td><div style="display:flex;align-items:center;gap:7px"><div style="width:10px;height:10px;border-radius:50%;background:${cor};flex-shrink:0"></div><div class="td-nome">${v.modalidade} #${v.concurso}</div></div></td>
              <td>${v.loteria_nome}</td>
              <td class="td-mono">${v.qtd_vendida}</td>
              <td class="td-green">${vt}</td>
              <td><button class="badge ${v.pago?'badge-pago':'badge-pendente'}" onclick="togglePago(${v.id},${v.pago})">${v.pago?'✓ Pago':'$ Pend.'}</button></td>
              <td><button class="badge ${v.conferencia_enviada?'badge-conf-ok':'badge-conf-no'}" onclick="toggleConf(${v.id},${v.conferencia_enviada})">${v.conferencia_enviada?'✓ Env.':'⏳ Pend.'}</button></td>
              <td><button class="badge ${v.cota_separada?'badge-sep-ok':'badge-sep-no'}" onclick="toggleSep(${v.id},${v.cota_separada})">${v.cota_separada?'✓ Sep.':'◻ Pend.'}</button></td>
              <td><button class="btn-wpp" onclick="enviarWpp('${v.cliente_telefone}','${v.cliente_nome}','${v.modalidade}','${v.concurso}',${v.qtd_vendida},${(v.qtd_vendida||0)*(v.valor_cota||0)})"><svg><use href="#wpp-icon"/></svg> WPP</button></td>
            </tr>`}).join('')}
          </tbody>
        </table>
      </div>`;
    wrap.appendChild(grp);
  });
  $('vendasContent').innerHTML='';$('vendasContent').appendChild(wrap);
}

function toggleGroup(header){
  const grp=header.closest('.bolao-group');grp.classList.toggle('open');
}

// ── BOLÕES para registrar ─────────────────────────────────────────

function abrirPainelVendaWpp(b){
  const panel = $('wppSalePanel');
  if (!panel || !b) return;

  const saldo = getSaldoContextoBolao(b);
  const title = $('wppSaleTitle');

  if (title) {
    title.textContent = `${b.modalidade} #${b.concurso} · ${lojaWhatsappAtiva?.loteria_nome || '—'} · ${saldo} saldo`;
  }

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wpp-sale-open');
}

function fecharPainelVendaWpp(){
  const panel = $('wppSalePanel');
  if (!panel) return;

  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('wpp-sale-open');
}
function limparBolaoSelecionadoWpp(){
  bolaoSelReg = null;

  document.querySelectorAll('.bolao-sel-card').forEach(c => c.classList.remove('selected'));

  if ($('inputValor')) $('inputValor').value = '';
  if ($('inputQtd')) $('inputQtd').value = '1';

  const panel = $('wppSelectedPanel');
  if (panel) panel.style.display = 'none';

  fecharPainelVendaWpp();

  calcTotal();
  clearStatusReg();
}

function getSaldoContextoBolao(b){
  const lojaId = Number(lojaWhatsappAtiva?.loteria_id || 0);
  const saldo = (b.saldos_lojas || []).find(s => Number(s.loteria_id) === lojaId);
  return Number(saldo?.saldo_real || 0);
}

function renderResumoBolaoSelecionado(b){
  const panel = $('wppSelectedPanel');
  if (!panel || !b) return;

  const saldoContexto = getSaldoContextoBolao(b);

  $('wppSelectedTitle').textContent = `${b.modalidade} — Concurso ${b.concurso}`;

  $('wppSelectedTags').innerHTML = `
    <span class="wpp-tag amber">Origem: ${b.loteria_origem_nome || '—'}</span>
    <span class="wpp-tag accent">WhatsApp: ${lojaWhatsappAtiva?.loteria_nome || '—'}</span>
    <span class="wpp-tag">${b.qtd_jogos} jogos</span>
    <span class="wpp-tag">${b.qtd_dezenas} dezenas</span>
    <span class="wpp-tag">${fmtBRL(b.valor_cota)}/cota</span>
    <span class="wpp-tag accent">Saldo aqui: ${saldoContexto}</span>
  `;

  const grid = $('wppSaldoGrid');
  grid.innerHTML = '';

  (b.saldos_lojas || []).forEach(s => {
    const saldo = Number(s.saldo_real || 0);
    const ehContexto = Number(s.loteria_id) === Number(lojaWhatsappAtiva?.loteria_id);
    const ehOrigem = Number(s.loteria_id) === Number(b.loteria_origem_id);

    const item = document.createElement('div');
    item.className =
      'wpp-saldo-item' +
      (ehContexto ? ' contexto' : '') +
      (ehOrigem ? ' origem' : '') +
      (saldo <= 0 ? ' zero' : '');

    item.innerHTML = `
      <div class="wpp-saldo-loja">${s.loteria_nome}</div>
      <div class="wpp-saldo-val">${saldo}</div>
    `;

    grid.appendChild(item);
  });

  panel.style.display = '';
}

function normalizarBoloesWpp(rows){
  const mapa = {};

  (rows || []).forEach(r => {
    const id = Number(r.bolao_id);

    if (!mapa[id]) {
      mapa[id] = {
        id,
        bolao_id: id,
        modalidade: r.modalidade,
        concurso: r.concurso,
        dt_inicial: r.dt_inicial,
        dt_concurso: r.dt_concurso,
        valor_cota: Number(r.valor_cota || 0),
        qtd_jogos: Number(r.qtd_jogos || 0),
        qtd_dezenas: Number(r.qtd_dezenas || 0),
        qtd_cotas_total: Number(r.qtd_cotas_total || 0),
        loteria_origem_id: Number(r.loteria_origem_id || 0),
        loteria_origem_nome: r.loteria_origem_nome || '—',
        loteria_origem_slug: r.loteria_origem_slug || '',
        saldos_lojas: []
      };
    }

    mapa[id].saldos_lojas.push({
      loteria_id: Number(r.loteria_id),
      loteria_nome: r.loteria_nome,
      loteria_slug: r.loteria_slug,
      qtd_cotas_posicao: Number(r.qtd_cotas_posicao || 0),
      qtd_vendida_loja: Number(r.qtd_vendida_loja || 0),
      saldo_real: Number(r.saldo_real || 0)
    });
  });

  return Object.values(mapa).filter(b => getSaldoContextoBolao(b) > 0);
}

async function buscarBoloesReg(){
  const lista = $('boloesRegLista');
  if (!lista) return;

  limparBolaoSelecionadoWpp();

  lista.innerHTML = '<div class="state-box" style="padding:24px"><div class="spinner"></div></div>';

  if (!lojaWhatsappAtiva?.loteria_id) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhuma loja selecionada</div>
        <div class="state-sub">Selecione o WhatsApp da loja para carregar os bolões.</div>
      </div>`;
    return;
  }

  const iso = isoDate(dataAtualReg);

  const { data: rows, error } = await sb.rpc('fn_wpp_saldo_boloes_lojas', {
    p_loteria_contexto_id: lojaWhatsappAtiva.loteria_id,
    p_data_ref: iso
  });

  if (error) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Erro ao buscar bolões</div>
        <div class="state-sub">${error.message}</div>
      </div>`;
    return;
  }

  const boloes = normalizarBoloesWpp(rows || []);

  if (!boloes.length) {
    lista.innerHTML = `
      <div class="state-box" style="padding:24px">
        <div class="state-title">Nenhum bolão com saldo</div>
        <div class="state-sub">Não há saldo disponível para o WhatsApp ${lojaWhatsappAtiva.loteria_nome} em ${fmtData(dataAtualReg)}.</div>
      </div>`;
    return;
  }

  renderBoloesReg(boloes);
}

function renderBoloesReg(boloes){
  const wrap = document.createElement('div');
  wrap.className = 'bolao-cards-grid';

  const grupos = {};
  boloes.forEach(b => {
    if (!grupos[b.modalidade]) grupos[b.modalidade] = [];
    grupos[b.modalidade].push(b);
  });

  Object.keys(grupos).sort().forEach(mod => {
    const sep = document.createElement('div');
    sep.className = 'sec-sep';
    sep.style.margin = '8px 0 6px';
    sep.innerHTML = `<div class="sec-sep-label">${mod}</div><div class="sec-sep-line"></div>`;
    wrap.appendChild(sep);

    grupos[mod]
      .sort((a,b) => {
        if ((a.loteria_origem_nome || '') !== (b.loteria_origem_nome || '')) {
          return (a.loteria_origem_nome || '').localeCompare(b.loteria_origem_nome || '');
        }
        return (a.valor_cota || 0) - (b.valor_cota || 0);
      })
      .forEach(b => {
        const saldoContexto = getSaldoContextoBolao(b);

        const saldoPills = (b.saldos_lojas || []).map(s => {
          const saldo = Number(s.saldo_real || 0);
          const ehContexto = Number(s.loteria_id) === Number(lojaWhatsappAtiva?.loteria_id);
          

          return `
            <span class="saldo-pill ${ehContexto ? 'contexto' : ''} ${saldo <= 0 ? 'zero' : ''}">
              <span class="sp-loja">${s.loteria_nome}</span>
              <span class="sp-val">${saldo}</span>
            </span>`;
        }).join('');

        const card = document.createElement('div');
        card.className = 'bolao-sel-card';
        card.dataset.id = b.id;

        card.innerHTML = `
          <div class="bsc-main">
            <div class="bsc-header">
              <span class="bsc-modal">${b.modalidade}</span>
              <span class="bsc-tag" style="color:var(--t1);background:var(--t3);border-color:var(--t4)">#${b.concurso}</span>
              <span class="bsc-tag" style="color:#f5a623;background:rgba(245,166,35,.08);border-color:rgba(245,166,35,.2)">${b.loteria_origem_nome || '—'}</span>
              
            </div>

            <div class="bsc-tags">
              <span class="bsc-tag">${b.qtd_jogos} jogos</span>
              <span class="bsc-tag">${b.qtd_dezenas} dez.</span>
              <span class="bsc-tag">${b.qtd_cotas_total} cotas</span>
              <span class="bsc-tag" style="color:#f5a623">${fmtBRL(b.valor_cota)}/cota</span>
            </div>

            <div class="bsc-saldos">${saldoPills}</div>
          </div>

          <div class="bsc-ind">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="2 6 5 9 10 3"/>
            </svg>
          </div>`;

        card.onclick = () => {
          document.querySelectorAll('.bolao-sel-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');

          bolaoSelReg = b;

          $('inputValor').value = Number(b.valor_cota).toLocaleString('pt-BR', { minimumFractionDigits:2 });
          $('inputQtd').value = '1';

          renderResumoBolaoSelecionado(b);
          abrirPainelVendaWpp(b);
          calcTotal();
          clearStatusReg();
        };

        wrap.appendChild(card);
      });
  });

  $('boloesRegLista').innerHTML = '';
  $('boloesRegLista').appendChild(wrap);
}

async function registrarVenda(){
  if (!bolaoSelReg) {
    setStatusReg('Selecione um bolão.', 'err');
    return;
  }

  if (!lojaWhatsappAtiva?.loteria_id) {
    setStatusReg('Nenhuma loja WhatsApp selecionada.', 'err');
    return;
  }

  if (!clienteSel) {
    setStatusReg('Selecione um cliente.', 'err');
    return;
  }

  const qtd = parseInt($('inputQtd').value) || 0;
  const val = parseBRL($('inputValor').value);

  if (qtd < 1) {
    setStatusReg('Qtd deve ser ≥ 1.', 'err');
    return;
  }

  if (val <= 0) {
    setStatusReg('Valor deve ser > 0.', 'err');
    return;
  }

  const saldoContexto = getSaldoContextoBolao(bolaoSelReg);

  if (saldoContexto < qtd) {
    setStatusReg(
      `Saldo insuficiente no WhatsApp ${lojaWhatsappAtiva.loteria_nome}. Disponível: ${saldoContexto}.`,
      'err'
    );
    return;
  }

  const btn = $('btnRegistrar');
  btn.disabled = true;

  setStatusReg(`Registrando venda no WhatsApp ${lojaWhatsappAtiva.loteria_nome}…`, 'info');

  const { data, error } = await sb.rpc('rpc_registrar_venda_whatsapp', {
    p_bolao_id: bolaoSelReg.id,
    p_loteria_vendedora_id: lojaWhatsappAtiva.loteria_id,
    p_cliente_id: clienteSel.id,
    p_qtd_vendida: qtd,
    p_data_referencia: isoDate(dataAtualReg),
    p_pago: $('chkPago').checked,
    p_obs: null
  });

  btn.disabled = false;

  if (error) {
    setStatusReg(error.message, 'err');
    return;
  }

  setStatusReg(
    `✓ Venda registrada para ${clienteSel.nome}! Saldo restante: ${data?.saldo_depois ?? '—'}.`,
    'ok'
  );

  $('inputCliente').value = '';
  clienteSel = null;
  $('inputQtd').value = '1';
  $('chkPago').checked = false;
  fecharPainelVendaWpp();
  calcTotal();

  await buscarBoloesReg();
  await carregarVendas();
}

async function deletarVenda(id){
  const ok = await confirmar(
    'Remover venda',
    'Tem certeza que deseja remover esta venda WhatsApp? A venda real do bolão também será removida.'
  );

  if (!ok) return;

  const { error } = await sb.rpc('rpc_excluir_venda_whatsapp', {
    p_venda_whatsapp_id: id
  });

  if (error) {
    alert('Erro ao excluir venda: ' + error.message);
    return;
  }

  await carregarVendas();
  await buscarBoloesReg();
}


// ── CLIENTES ──────────────────────────────────────────────────────
async function carregarClientes(){
  const{data}=await sb.from('clientes_whatsapp').select('*').eq('ativo',true).order('nome');
  clientes=data||[];
}

function renderClientes(){
  const busca=($('searchCliente').value||'').toLowerCase();
  const lista=busca?clientes.filter(c=>c.nome.toLowerCase().includes(busca)||(c.apelido||'').toLowerCase().includes(busca)||(c.telefone||'').includes(busca)):clientes;
  const grid=$('clientesGrid');grid.innerHTML='';
  if(!lista.length){
    grid.innerHTML=`<div class="state-box" style="grid-column:1/-1"><div class="state-title">Nenhum cliente</div><div class="state-sub">Cadastre o primeiro cliente.</div></div>`;return;
  }
  lista.forEach(c=>{
    const card=document.createElement('div');card.className='cli-card';
    card.innerHTML=`
      <div class="cli-av">${iniciais(c.nome)}</div>
      <div class="cli-info">
        <div class="cli-nome">${c.nome}</div>
        ${c.apelido?`<div class="cli-apelido">${c.apelido}</div>`:''}
        <div class="cli-tel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6 19.79 19.79 0 0 1 1.62 5.1 2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.6a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 19z"/></svg>${c.telefone}</div>
      </div>
      <div class="cli-actions">
        <button class="btn-cli-wpp" onclick="abrirWpp('${c.telefone}','')" title="WhatsApp"><svg viewBox="0 0 24 24"><use href="#wpp-icon"/></svg></button>
        <button class="btn-cli-act" onclick="abrirModalCliente(${c.id})" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>
      </div>`;
    grid.appendChild(card);
  });
}

function filtrarClientes(){renderClientes()}

function buscarClienteInput(){
  const q=$('inputCliente').value.toLowerCase();const dd=$('cliDropdown');clienteSel=null;
  if(!q||q.length<2){dd.classList.remove('show');return}
  const res=clientes.filter(c=>c.nome.toLowerCase().includes(q)||(c.apelido||'').toLowerCase().includes(q)||(c.telefone||'').includes(q)).slice(0,8);
  dd.innerHTML='';
  res.forEach(c=>{
    const it=document.createElement('div');it.className='cli-opt';
    it.innerHTML=`<span>${c.nome}${c.apelido?` <span style="color:var(--text3);font-size:11px">(${c.apelido})</span>`:''}</span><span class="cli-opt-tel">${c.telefone}</span>`;
    it.onclick=()=>{clienteSel=c;$('inputCliente').value=c.apelido?`${c.nome} (${c.apelido})`:c.nome;dd.classList.remove('show')};
    dd.appendChild(it);
  });
  const add=document.createElement('div');add.className='cli-add';
  add.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Cadastrar novo`;
  add.onclick=()=>{dd.classList.remove('show');abrirModalCliente()};
  dd.appendChild(add);dd.classList.add('show');
}

function abrirModalCliente(id=null){
  clienteEditId=id;$('modalCliTitulo').textContent=id?'Editar Cliente':'Novo Cliente';
  if(id){const c=clientes.find(x=>x.id===id);if(c){$('cliNome').value=c.nome||'';$('cliApelido').value=c.apelido||'';$('cliTelefone').value=c.telefone||'';$('cliObs').value=c.observacoes||''}}
  else{$('cliNome').value=$('cliApelido').value=$('cliTelefone').value=$('cliObs').value=''}
  $('modalCliente').classList.add('show');
}
function fecharModalCliente(){$('modalCliente').classList.remove('show')}
async function salvarCliente(){
  const nome=$('cliNome').value.trim();const tel=$('cliTelefone').value.replace(/\D/g,'');
  if(!nome){alert('Nome é obrigatório.');return}if(!tel){alert('Telefone é obrigatório.');return}
  const payload={nome,telefone:tel,apelido:$('cliApelido').value.trim()||null,observacoes:$('cliObs').value.trim()||null,criado_por:usuario.id};
  let error;
  if(clienteEditId)({error}=await sb.from('clientes_whatsapp').update(payload).eq('id',clienteEditId));
  else({error}=await sb.from('clientes_whatsapp').insert(payload));
  if(error){alert('Erro: '+error.message);return}
  fecharModalCliente();await carregarClientes();renderClientes();
}

// ── CALCULAR TOTAL ────────────────────────────────────────────────
function calcTotal(){
  const qtd=parseInt($('inputQtd').value)||0;const val=parseBRL($('inputValor').value);
  $('totalVenda').textContent=fmtBRL(qtd*val);
}


// ── TOGGLES ───────────────────────────────────────────────────────
async function togglePago(id,atual){
  await sb.from('vendas_whatsapp').update({pago:!atual,dt_pagamento:!atual?isoDate(new Date()):null}).eq('id',id);
  await carregarVendas();
}
async function toggleConf(id,atual){
  await sb.from('vendas_whatsapp').update({conferencia_enviada:!atual,dt_conferencia:!atual?new Date().toISOString():null}).eq('id',id);
  await carregarVendas();
}
async function toggleSep(id,atual){
  await sb.from('vendas_whatsapp').update({cota_separada:!atual}).eq('id',id);
  await carregarVendas();
}

// ── WHATSAPP ──────────────────────────────────────────────────────
function abrirWpp(tel,msg){window.open(`https://wa.me/${tel2wpp(tel)}${msg?'?text='+encodeURIComponent(msg):''}`, '_blank')}
function enviarWpp(tel,nome,modal,concurso,qtd,val){
  const msg=`Olá ${nome}! 😊\n\nSua cota do bolão foi registrada:\n📍 ${modal} — Concurso ${concurso}\n🎫 ${qtd} cota(s) — ${fmtBRL(val)}\n\nQualquer dúvida, é só chamar! 🍀`;
  abrirWpp(tel,msg);
}

// ── HISTÓRICO ─────────────────────────────────────────────────────
async function carregarHistorico(){
  $('histContent').innerHTML='<div class="state-box"><div class="spinner"></div><div class="state-title">Buscando…</div></div>';

  let q = sb
    .from('view_vendas_whatsapp')
    .select('*')
    .order('created_at', { ascending:false })
    .limit(300);

  const de    = $('filtDataVendaDe').value;
  const ate   = $('filtDataVendaAte').value;
  const cDe   = $('filtDataConc').value;
  const cAte  = $('filtDataConcAte').value;
  const modal = $('filtModalidade').value.trim();
  const conc  = $('filtConcurso').value.trim();
  const pago  = $('filtPago').value;
  const conf  = $('filtConf').value;
  const sep   = $('filtSep').value;

  const lojaFiltro =
    $('filtLoja').value ||
    (lojaWhatsappAtiva?.loteria_id ? String(lojaWhatsappAtiva.loteria_id) : '');

  if (de)    q = q.gte('created_at', de);
  if (ate)   q = q.lte('created_at', ate + 'T23:59:59');
  if (cDe)   q = q.gte('dt_concurso', cDe);
  if (cAte)  q = q.lte('dt_concurso', cAte);
  if (modal) q = q.ilike('modalidade', '%' + modal + '%');
  if (conc)  q = q.ilike('concurso', '%' + conc + '%');

  if (pago !== '') q = q.eq('pago', pago === 'true');
  if (conf !== '') q = q.eq('conferencia_enviada', conf === 'true');
  if (sep !== '')  q = q.eq('cota_separada', sep === 'true');

  if (lojaFiltro) q = q.eq('loteria_id', parseInt(lojaFiltro));

  const { data, error } = await q;

  if (error) {
    $('histContent').innerHTML = `
      <div class="state-box">
        <div class="state-title">Erro ao buscar histórico</div>
        <div class="state-sub">${error.message}</div>
      </div>`;
    return;
  }

  renderHistorico(data || []);
}
let historicoTimer = null;

function agendarCarregarHistorico(){
  if (!$('tab-historico')?.classList.contains('active')) return;

  clearTimeout(historicoTimer);

  historicoTimer = setTimeout(() => {
    carregarHistorico();
  }, 300);
}
function renderHistorico(rows){
  if(!rows.length){
    $('histContent').innerHTML='<div class="state-box"><div class="state-title">Nenhum resultado</div><div class="state-sub">Ajuste os filtros acima.</div></div>';return;
  }
  const wrap=document.createElement('div');wrap.className='hist-table-wrap fade-in';
  wrap.innerHTML=`<table class="hist-table">
    <thead><tr>
      <th>Data venda</th><th>Cliente</th><th>Bolão</th><th>Conc.</th><th>Loja</th>
      <th>Qtd</th><th>Valor</th><th>Pagamento</th><th>Conferência</th><th>Separação</th><th>WPP</th>
    </tr></thead>
    <tbody id="histTbody"></tbody>
  </table>`;
  $('histContent').innerHTML='';$('histContent').appendChild(wrap);
  const tb=$('histTbody');
  rows.forEach(v=>{
    const tr=document.createElement('tr');
    const dt=new Date(v.created_at).toLocaleDateString('pt-BR');
    const nomeCli=v.cliente_apelido?`${v.cliente_nome}<br><span style="font-size:10px;color:var(--text3)">${v.cliente_apelido}</span>`:v.cliente_nome;
    const vt=fmtBRL((v.qtd_vendida||0)*(v.valor_cota||0));
    const dtConc=v.dt_concurso?new Date(v.dt_concurso+'T12:00:00').toLocaleDateString('pt-BR'):'—';
    const cor=getCorBolao(v.bolao_id);
    tr.innerHTML=`
      <td class="td-mono">${dt}</td>
      <td class="td-nome">${nomeCli}</td>
      <td><div style="display:flex;align-items:center;gap:6px"><div style="width:9px;height:9px;border-radius:50%;background:${cor};flex-shrink:0"></div>${v.modalidade}</div></td>
      <td class="td-mono">${dtConc}</td>
      <td>${v.loteria_nome}</td>
      <td class="td-mono">${v.qtd_vendida}</td>
      <td class="td-green">${vt}</td>
      <td><button class="btn-toggle-sm ${v.pago?'badge-pago':'badge-pendente'}" onclick="togglePagoHist(${v.id},${v.pago},this)">${v.pago?'✓ Pago':'$ Pend.'}</button></td>
      <td><button class="btn-toggle-sm ${v.conferencia_enviada?'badge-conf-ok':'badge-conf-no'}" onclick="toggleConfHist(${v.id},${v.conferencia_enviada},this)">${v.conferencia_enviada?'✓ Env.':'⏳ Pend.'}</button></td>
      <td><button class="btn-toggle-sm ${v.cota_separada?'badge-sep-ok':'badge-sep-no'}" onclick="toggleSepHist(${v.id},${v.cota_separada},this)">${v.cota_separada?'✓ Sep.':'◻ Pend.'}</button></td>
      <td><button class="btn-wpp" onclick="enviarWpp('${v.cliente_telefone}','${v.cliente_nome}','${v.modalidade}','${v.concurso}',${v.qtd_vendida},${(v.qtd_vendida||0)*(v.valor_cota||0)})"><svg style="width:11px;height:11px"><use href="#wpp-icon"/></svg> WPP</button></td>`;
    tb.appendChild(tr);
  });
}

async function togglePagoHist(id,atual,btn){
  await sb.from('vendas_whatsapp').update({pago:!atual,dt_pagamento:!atual?isoDate(new Date()):null}).eq('id',id);
  const n=!atual;btn.textContent=n?'✓ Pago':'$ Pend.';btn.className=`btn-toggle-sm ${n?'badge-pago':'badge-pendente'}`;
}
async function toggleConfHist(id,atual,btn){
  await sb.from('vendas_whatsapp').update({conferencia_enviada:!atual,dt_conferencia:!atual?new Date().toISOString():null}).eq('id',id);
  const n=!atual;btn.textContent=n?'✓ Env.':'⏳ Pend.';btn.className=`btn-toggle-sm ${n?'badge-conf-ok':'badge-conf-no'}`;
}
async function toggleSepHist(id,atual,btn){
  await sb.from('vendas_whatsapp').update({cota_separada:!atual}).eq('id',id);
  const n=!atual;btn.textContent=n?'✓ Sep.':'◻ Pend.';btn.className=`btn-toggle-sm ${n?'badge-sep-ok':'badge-sep-no'}`;
}

function limparFiltros(){
  ['filtDataVendaDe','filtDataVendaAte','filtDataConc','filtDataConcAte','filtModalidade','filtConcurso']
    .forEach(id => {
      const el = $(id);
      if (el) el.value = '';
    });

  ['filtPago','filtConf','filtSep']
    .forEach(id => {
      const el = $(id);
      if (el) el.selectedIndex = 0;
    });

  sincronizarFiltroHistoricoComLojaAtiva();

  $('histContent').innerHTML = `
    <div class="state-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;opacity:.25">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
      <div class="state-title">Filtros limpos</div>
      <div class="state-sub">Histórico pronto para o WhatsApp ${lojaWhatsappAtiva?.loteria_nome || 'da loja'}.</div>
    </div>`;
}

// ── CONFIRMAR ─────────────────────────────────────────────────────
function confirmar(titulo,corpo){
  return new Promise(res=>{
    $('confirmTitle').textContent=titulo;$('confirmBody').textContent=corpo;
    $('confirmOverlay').classList.add('show');
    $('confirmNo').onclick=()=>{$('confirmOverlay').classList.remove('show');res(false)};
    $('confirmYes').onclick=()=>{$('confirmOverlay').classList.remove('show');res(true)};
  });
}

// ── BINDINGS ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  $('btnDtPrev').onclick = async () => { await alterarDataVendas(-1); };
  $('btnDtNext').onclick = async () => { await alterarDataVendas(1); };
  $('btnHoje').onclick = async () => {
    dataAtual = hojeLocal();
    atualizarDates();
    await carregarVendas();
  };

  $('btnDtPrevReg').onclick = async () => { await alterarDataRegistro(-1); };
  $('btnDtNextReg').onclick = async () => { await alterarDataRegistro(1); };
  $('btnHojeReg').onclick = async () => {
    dataAtualReg = hojeLocal();
    atualizarDates();
    await buscarBoloesReg();
  };

  $('dateDisplay').onclick = () => {
    atualizarDates();
    const picker = $('datePicker');
    if (picker?.showPicker) picker.showPicker();
    else picker?.click();
  };
  $('datePicker').onchange = async () => {
    if (!$('datePicker').value) return;
    dataAtual = dataFromISO($('datePicker').value);
    atualizarDates();
    await carregarVendas();
  };

  $('dateDisplayReg').onclick = () => {
    atualizarDates();
    const picker = $('datePickerReg');
    if (picker?.showPicker) picker.showPicker();
    else picker?.click();
  };
  $('datePickerReg').onchange = async () => {
    if (!$('datePickerReg').value) return;
    dataAtualReg = dataFromISO($('datePickerReg').value);
    atualizarDates();
    await buscarBoloesReg();
  };

  init();
});
