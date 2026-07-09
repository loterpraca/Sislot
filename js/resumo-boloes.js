const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

const $ = (id) => document.getElementById(id);
const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const fmtData = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).length === 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
};

let usuario = null;
let dadosResumo = [];
let chartFuncionarios = null;
let chartDiario = null;

function setStatus(msg = '', tipo = '') {
  const el = $('statusResumo');
  if (!el) return;
  if (!msg) {
    el.className = 'status-bar';
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.className = `status-bar show ${tipo || 'ok'}`;
}

function updateClock() {
  const el = $('relogio');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR');
}

function getCompetenciaAtual() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

function getRangeCompetencia(competencia) {
  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) return null;

  const [ano, mes] = competencia.split('-').map(Number);
  const inicio = new Date(ano, mes - 1, 1);
  const fim = new Date(ano, mes, 0);

  const fmtISO = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  return {
    ano,
    mes,
    inicio: fmtISO(inicio),
    fim: fmtISO(fim)
  };
}

function getFiltros() {
  return {
    competencia: $('filtroCompetencia')?.value || getCompetenciaAtual(),
    loja: $('filtroLoja')?.value || '',
    funcionario: $('filtroFuncionario')?.value || '',
    modalidade: $('filtroModalidade')?.value || '',
    concurso: $('filtroConcurso')?.value || ''
  };
}

async function protegerPagina() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.href = './login.html';
    return false;
  }

  const { data: usr, error } = await sb
    .from('usuarios')
    .select('id, nome, perfil, ativo, pode_logar')
    .eq('auth_user_id', session.user.id)
    .eq('ativo', true)
    .eq('pode_logar', true)
    .maybeSingle();

  if (error || !usr) {
    location.href = './login.html';
    return false;
  }

  usuario = usr;
  return true;
}

async function carregarLojas() {
  const { data, error } = await sb
    .from('loterias')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome');

  if (error) throw error;

  const sel = $('filtroLoja');
  if (!sel) return;

  (data || []).forEach((l) => {
    const op = document.createElement('option');
    op.value = l.id;
    op.textContent = l.nome;
    sel.appendChild(op);
  });
}

async function carregarFuncionarios() {
  const { data, error } = await sb
    .from('usuarios')
    .select('id, nome')
    .eq('ativo', true)
    .eq('pode_logar', true)
    .order('nome');

  if (error) throw error;

  const sel = $('filtroFuncionario');
  if (!sel) return;

  (data || []).forEach((u) => {
    const op = document.createElement('option');
    op.value = u.id;
    op.textContent = u.nome;
    sel.appendChild(op);
  });
}

async function carregarModalidades() {
  const { data, error } = await sb
    .from('boloes')
    .select('modalidade')
    .eq('status', 'ATIVO');

  if (error) throw error;

  const modalidades = [...new Set((data || []).map(r => r.modalidade).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const sel = $('filtroModalidade');
  if (!sel) return;

  modalidades.forEach((m) => {
    const op = document.createElement('option');
    op.value = m;
    op.textContent = m;
    sel.appendChild(op);
  });
}

function linhaResumo(row) {
  const valorCota = Number(row.valor_cota || 0);
  const qtdVendida = Number(row.qtd_vendida || 0);
  const totalVenda = Number(row.valor_total_venda || 0);

  const valorComissao = Number(
    row.valor_comissao ??
    ((totalVenda - (totalVenda / 1.35)) * 0.15)
  );

  const perc = Number(
    row.percentual_comissao ??
    ((((1 - (1 / 1.35)) * 0.15) * 100))
  );

  return {
    data_referencia: row.data_referencia,
    competencia: row.competencia,
    ano_ref: Number(row.ano_ref || 0),
    mes_ref: Number(row.mes_ref || 0),
    loteria_vendedora_id: row.loteria_vendedora_id,
    loja_nome: row.loja_nome || '—',
    usuario_id: row.usuario_id,
    funcionario_nome: row.funcionario_nome || '—',
    bolao_id: row.bolao_id,
    modalidade: row.modalidade || '—',
    concurso: row.concurso || '—',
    qtd_jogos: Number(row.qtd_jogos || 0),
    qtd_dezenas: Number(row.qtd_dezenas || 0),
    valor_cota: valorCota,
    qtd_vendida: qtdVendida,
    valor_total_venda: totalVenda,
    percentual_comissao: perc,
    valor_comissao: Number(valorComissao.toFixed(2))
  };
}

async function buscarDados() {
  const filtros = getFiltros();
  const range = getRangeCompetencia(filtros.competencia);

  if (!range) {
    setStatus('Competência inválida.', 'err');
    return;
  }

  setStatus(`Buscando resumo de ${String(range.mes).padStart(2, '0')}/${range.ano}...`, 'ok');

  const pageSize = 1000;
  let from = 0;
  let allRows = [];
  let finished = false;

  while (!finished) {
    let q = sb
      .from('view_resumo_boloes_vendas')
      .select('*')
      .gte('data_referencia', range.inicio)
      .lte('data_referencia', range.fim)
      .order('data_referencia', { ascending: true })
      .order('funcionario_nome', { ascending: true })
      .range(from, from + pageSize - 1);

    if (filtros.loja) q = q.eq('loteria_vendedora_id', Number(filtros.loja));
    if (filtros.funcionario) q = q.eq('usuario_id', Number(filtros.funcionario));
    if (filtros.modalidade) q = q.eq('modalidade', filtros.modalidade);
    if (filtros.concurso) q = q.eq('concurso', String(filtros.concurso));

    const { data, error } = await q;
    if (error) throw error;

    const chunk = data || [];
    allRows = allRows.concat(chunk);

    if (chunk.length < pageSize) {
      finished = true;
    } else {
      from += pageSize;
    }
  }

  dadosResumo = allRows.map(linhaResumo);
  renderTudo();
  setStatus(`${dadosResumo.length} registro(s) carregado(s).`, 'ok');
}
function renderKPIs() {
  const totalVendido = dadosResumo.reduce((s, r) => s + Number(r.valor_total_venda || 0), 0);
  const totalCotas = dadosResumo.reduce((s, r) => s + Number(r.qtd_vendida || 0), 0);
  const totalComissao = dadosResumo.reduce((s, r) => s + Number(r.valor_comissao || 0), 0);

  const porFuncionario = {};
  dadosResumo.forEach(r => {
    const nome = r.funcionario_nome || '—';
    porFuncionario[nome] = (porFuncionario[nome] || 0) + Number(r.valor_comissao || 0);
  });

  const destaque = Object.entries(porFuncionario).sort((a, b) => b[1] - a[1])[0] || null;

  $('kpiTotalVendido').textContent = fmtBRL(totalVendido);
  $('kpiQtdCotas').textContent = String(totalCotas);
  $('kpiComissao').textContent = fmtBRL(totalComissao);
  $('kpiDestaque').textContent = destaque ? destaque[0] : '—';
  $('kpiDestaqueSub').textContent = destaque ? fmtBRL(destaque[1]) : 'Sem dados';
}

function agruparPorDia(linhas) {
  const mapa = {};

  linhas.forEach(r => {
    const dia = r.data_referencia;
    if (!mapa[dia]) {
      mapa[dia] = {
        data_referencia: dia,
        qtd_vendida: 0,
        valor_total_venda: 0,
        valor_comissao: 0,
        registros: []
      };
    }

    mapa[dia].qtd_vendida += Number(r.qtd_vendida || 0);
    mapa[dia].valor_total_venda += Number(r.valor_total_venda || 0);
    mapa[dia].valor_comissao += Number(r.valor_comissao || 0);
    mapa[dia].registros.push(r);
  });

  return Object.values(mapa).sort((a, b) =>
    String(a.data_referencia).localeCompare(String(b.data_referencia))
  );
}

function renderDetalheDia(dataRef) {
  const tbody = $('tbodyDetalheDia');
  const titulo = $('detalheDiaTitulo');

  const itens = dadosResumo
    .filter(r => r.data_referencia === dataRef)
    .sort((a, b) => {
      const mod = String(a.modalidade || '').localeCompare(String(b.modalidade || ''), 'pt-BR');
      if (mod !== 0) return mod;
      return String(a.concurso || '').localeCompare(String(b.concurso || ''), 'pt-BR');
    });

  titulo.textContent = dataRef ? `Bolões vendidos em ${fmtData(dataRef)}` : 'Selecione uma data na tabela';

  if (!itens.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum bolão encontrado para esta data.</td></tr>';
    return;
  }

  tbody.innerHTML = itens.map(r => `
    <tr>
      <td>${r.modalidade}</td>
      <td>${r.concurso}</td>
      <td>${r.qtd_jogos}</td>
      <td>${r.qtd_dezenas}</td>
      <td>${fmtBRL(r.valor_cota)}</td>
      <td>${r.qtd_vendida}</td>
      <td>${fmtBRL(r.valor_total_venda)}</td>
      <td>${fmtBRL(r.valor_comissao)}</td>
    </tr>
  `).join('');
}

function renderTabela() {
  const tbody = $('tbodyResumo');
  const agrupado = agruparPorDia(dadosResumo);

  $('tableCount').textContent = `${agrupado.length} dia(s) com venda`;

  if (!agrupado.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-row">Nenhum dado encontrado.</td></tr>';
    renderDetalheDia(null);
    return;
  }

  const totalMesCotas = agrupado.reduce((s, r) => s + Number(r.qtd_vendida || 0), 0);
  const totalMesVenda = agrupado.reduce((s, r) => s + Number(r.valor_total_venda || 0), 0);
  const totalMesComissao = agrupado.reduce((s, r) => s + Number(r.valor_comissao || 0), 0);

  tbody.innerHTML = agrupado.map(r => `
    <tr class="row-dia" data-dia="${r.data_referencia}" style="cursor:pointer">
      <td>${fmtData(r.data_referencia)}</td>
      <td colspan="2"><strong>Total do dia</strong></td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>${r.qtd_vendida}</td>
      <td>${fmtBRL(r.valor_total_venda)}</td>
      <td>—</td>
      <td>${fmtBRL(r.valor_comissao)}</td>
    </tr>
  `).join('') + `
    <tr class="table-total-row">
      <td><strong>Total do mês</strong></td>
      <td colspan="7">Competência consolidada</td>
      <td><strong>${totalMesCotas}</strong></td>
      <td><strong>${fmtBRL(totalMesVenda)}</strong></td>
      <td>—</td>
      <td><strong>${fmtBRL(totalMesComissao)}</strong></td>
    </tr>
  `;

  tbody.querySelectorAll('.row-dia').forEach(tr => {
    tr.addEventListener('click', () => {
      const dia = tr.dataset.dia;
      renderDetalheDia(dia);

      tbody.querySelectorAll('.row-dia').forEach(x => x.classList.remove('active-day'));
      tr.classList.add('active-day');
    });
  });

  renderDetalheDia(agrupado[0].data_referencia);
  tbody.querySelector('.row-dia')?.classList.add('active-day');
}

function destruirGraficos() {
  if (chartFuncionarios) { chartFuncionarios.destroy(); chartFuncionarios = null; }
  if (chartDiario) { chartDiario.destroy(); chartDiario = null; }
}

function renderGraficos() {
  destruirGraficos();

  const aggFunc = {};
  const aggDia = {};

  dadosResumo.forEach(r => {
    aggFunc[r.funcionario_nome] = (aggFunc[r.funcionario_nome] || 0) + Number(r.valor_comissao || 0);

    if (!aggDia[r.data_referencia]) {
      aggDia[r.data_referencia] = {
        venda: 0,
        comissao: 0
      };
    }

    aggDia[r.data_referencia].venda += Number(r.valor_total_venda || 0);
    aggDia[r.data_referencia].comissao += Number(r.valor_comissao || 0);
  });

  const funcLabels = Object.keys(aggFunc);
  const funcVals = funcLabels.map(k => aggFunc[k]);

  const diaLabels = Object.keys(aggDia).sort();
  const diaVendaVals = diaLabels.map(k => aggDia[k].venda);
  const diaComVals = diaLabels.map(k => aggDia[k].comissao);

  chartFuncionarios = new Chart($('graficoFuncionarios'), {
    type: 'bar',
    data: {
      labels: funcLabels,
      datasets: [{ label: 'Comissão', data: funcVals }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });

  chartDiario = new Chart($('graficoDiario'), {
    type: 'line',
    data: {
      labels: diaLabels.map(fmtData),
      datasets: [
        { label: 'Venda diária', data: diaVendaVals, tension: 0.25 },
        { label: 'Comissão diária', data: diaComVals, tension: 0.25 }
      ]
    },
    options: {
      responsive: true
    }
  });
}
function renderTudo() {
  renderKPIs();
  renderTabela();
  renderGraficos();
}

function limparFiltros() {
  $('filtroCompetencia').value = getCompetenciaAtual();
  $('filtroLoja').value = '';
  $('filtroFuncionario').value = '';
  $('filtroModalidade').value = '';
  $('filtroConcurso').value = '';
}

function bindView() {
  const btnTabela = $('btnViewTabela');
  const btnGrafico = $('btnViewGrafico');
  const secTabela = $('secTabela');
  const secGrafico = $('secGrafico');

  btnTabela.addEventListener('click', () => {
    btnTabela.classList.add('active');
    btnGrafico.classList.remove('active');
    secTabela.classList.remove('hidden');
    secGrafico.classList.add('hidden');
  });

  btnGrafico.addEventListener('click', () => {
    btnGrafico.classList.add('active');
    btnTabela.classList.remove('active');
    secGrafico.classList.remove('hidden');
    secTabela.classList.add('hidden');
  });
}

async function init() {
  if (!(await protegerPagina())) return;

  updateClock();
  setInterval(updateClock, 1000);

  bindView();
  limparFiltros();

  $('btnBuscarResumo').addEventListener('click', buscarDados);
  $('btnLimparResumo').addEventListener('click', () => {
    limparFiltros();
    setStatus('Filtros limpos.', 'ok');
  });

  await Promise.all([
    carregarLojas(),
    carregarFuncionarios(),
    carregarModalidades()
  ]);

  await buscarDados();
}

document.addEventListener('DOMContentLoaded', init);
