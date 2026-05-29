const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALERTA_COTAS_LIMITE = Number(process.env.ALERTA_COTAS_LIMITE || 2);

const WHATSAPP_WEBHOOK_URL = process.env.WHATSAPP_WEBHOOK_URL || "";
const WHATSAPP_WEBHOOK_TOKEN = process.env.WHATSAPP_WEBHOOK_TOKEN || "";

const LOJAS = JSON.parse(
  process.env.MARKETPLACE_LOJAS_JSON ||
    '[{"nome":"Centro","codigo":"518","loteria_id":1}]'
);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarNumero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  return Number(valor);
}

function converterDataBR(dataBR) {
  if (!dataBR || typeof dataBR !== "string") return null;

  const partes = dataBR.split("/");
  if (partes.length !== 3) return null;

  const [dia, mes, ano] = partes;
  return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

function nomeModalidade(cota) {
  const modalidade = String(cota.modalidade || "").toUpperCase();
  const tipoConcurso = Number(cota.tipoConcurso || 0);

  if (modalidade === "QUINA" && tipoConcurso === 2) return "Quina de São João";
  if (modalidade === "MAIS_MILIONARIA") return "+Milionária";
  if (modalidade === "LOTOFACIL") return "Lotofácil";
  if (modalidade === "MEGA_SENA") return "Mega-Sena";
  if (modalidade === "DUPLA_SENA") return "Dupla Sena";
  if (modalidade === "DIA_DE_SORTE") return "Dia de Sorte";
  if (modalidade === "SUPER_7") return "Super Sete";
  if (modalidade === "TIMEMANIA") return "Timemania";
  if (modalidade === "LOTECA") return "Loteca";
  if (modalidade === "QUINA") return "Quina";

  return modalidade || "Não identificada";
}

function montarDescricaoBolao(cota) {
  const modalidade = nomeModalidade(cota);
  const concurso = cota.concurso || "-";
  const jogos = Number(cota.qtdApostas || 0);
  const dezenas = Number(cota.qtdNumeros || 0);
  const trevos = Number(cota.qtdTrevos || 0);
  const valor = Number(cota.vrCotaComTarifa || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const cotasDisp = Number(cota.qtdCotaDisponivel || 0);
  const cotasTotal = Number(cota.qtdCotaTotal || 0);

  let linhaTrevos = "";
  if (trevos > 0) linhaTrevos = ` + ${trevos} trevos`;

  return `*${modalidade}* — Concurso ${concurso}
${jogos} jogo(s) | ${dezenas} dezenas${linhaTrevos} | ${valor}
➡️ *${cotasDisp} cota(s) disponível(is) de ${cotasTotal}*`;
}

function montarMensagemAlerta(cota, loja) {
  return `🚨 *Alerta Marketplace Caixa*

🏪 *${loja.nome}* — código ${loja.codigo}

Bolão com menos de ${ALERTA_COTAS_LIMITE} cotas disponíveis:

${montarDescricaoBolao(cota)}

⚠️ Avaliar se vale criar outro bolão parecido.`;
}

function montarMensagemResumo(loja, cotas) {
  const agora = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const ordenados = [...cotas].sort((a, b) => {
    const da = Number(a.qtdCotaDisponivel || 0);
    const db = Number(b.qtdCotaDisponivel || 0);
    if (da !== db) return da - db;
    return String(nomeModalidade(a)).localeCompare(String(nomeModalidade(b)));
  });

  const linhas = ordenados.map((cota, index) => {
    const numero = String(index + 1).padStart(2, "0");
    const modalidade = nomeModalidade(cota);
    const concurso = cota.concurso || "-";
    const jogos = Number(cota.qtdApostas || 0);
    const dezenas = Number(cota.qtdNumeros || 0);
    const trevos = Number(cota.qtdTrevos || 0);
    const disp = Number(cota.qtdCotaDisponivel || 0);
    const total = Number(cota.qtdCotaTotal || 0);
    const valor = Number(cota.vrCotaComTarifa || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

    const parteTrevo = trevos > 0 ? ` + ${trevos}T` : "";

    return `${numero}. ${modalidade} ${concurso}
${jogos} jogo(s) | ${dezenas} dez.${parteTrevo} | ${valor}
➡️ ${disp}/${total} cotas`;
  });

  const criticos = ordenados.filter(
    (cota) => Number(cota.qtdCotaDisponivel || 0) < ALERTA_COTAS_LIMITE
  );

  return `📊 *Resumo Marketplace Caixa*

🏪 *${loja.nome}* — código ${loja.codigo}
🕒 ${agora}

📌 Total de bolões listados: *${cotas.length}*
🚨 Com menos de ${ALERTA_COTAS_LIMITE} cotas: *${criticos.length}*

${linhas.join("\n\n")}`;
}

async function enviarWhatsapp(mensagem) {
  if (!WHATSAPP_WEBHOOK_URL) {
    console.log("\n=== MENSAGEM GERADA ===\n");
    console.log(mensagem);
    console.log("\n=== FIM DA MENSAGEM ===\n");
    return { enviado: false, erro: "WHATSAPP_WEBHOOK_URL não configurado" };
  }

  try {
    const headers = {
      "Content-Type": "application/json",
    };

    if (WHATSAPP_WEBHOOK_TOKEN) {
      headers.Authorization = `Bearer ${WHATSAPP_WEBHOOK_TOKEN}`;
    }

    const resp = await fetch(WHATSAPP_WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mensagem,
        texto: mensagem,
        origem: "SISLOT_MARKETPLACE_CAIXA",
      }),
    });

    if (!resp.ok) {
      const texto = await resp.text();
      return { enviado: false, erro: `HTTP ${resp.status}: ${texto}` };
    }

    return { enviado: true, erro: null };
  } catch (erro) {
    return { enviado: false, erro: erro.message };
  }
}

async function clicarSeExistir(page, texto) {
  try {
    const item = page.getByText(texto, { exact: true }).first();
    await item.waitFor({ timeout: 5000 });
    await item.click();
    await sleep(1500);
    return true;
  } catch {
    return false;
  }
}

async function coletarCotasLoja(browser, loja) {
  const url = `https://www.loteriasonline.caixa.gov.br/silce-web/#/bolao-caixa/${loja.codigo}`;

  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });

  const payloadsComCotas = [];

  page.on("response", async (response) => {
    const contentType = response.headers()["content-type"] || "";

    if (!contentType.includes("application/json")) return;

    try {
      const json = await response.json();

      if (
        json &&
        json.payload &&
        Array.isArray(json.payload.cotas) &&
        json.payload.cotas.length > 0
      ) {
        payloadsComCotas.push({
          url: response.url(),
          status: response.status(),
          payload: json.payload,
        });
      }
    } catch {
      // ignora respostas que não viram JSON
    }
  });

  console.log(`Abrindo Marketplace Caixa: ${loja.nome} (${loja.codigo})`);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  await sleep(4000);

  await clicarSeExistir(page, "Sim");
  await clicarSeExistir(page, "Aceitar");

  await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 90000,
  });

  await sleep(5000);

  await clicarSeExistir(page, "Sim");
  await clicarSeExistir(page, "Aceitar");

  for (let i = 0; i < 20; i++) {
    if (payloadsComCotas.length > 0) break;
    await sleep(1500);
  }

  const texto = await page.locator("body").innerText().catch(() => "");

  await page.screenshot({
    path: `print-marketplace-${loja.codigo}.png`,
    fullPage: true,
  });

  await page.close();

  if (payloadsComCotas.length === 0) {
    console.log("Nenhum payload com cotas foi capturado.");
    console.log(texto.slice(0, 1000));
    return [];
  }

  const ultimoPayload = payloadsComCotas[payloadsComCotas.length - 1].payload;
  const cotas = ultimoPayload.cotas || [];

  console.log(`Bolões encontrados em ${loja.nome}: ${cotas.length}`);

  return cotas;
}

async function salvarBolaoAtual(cota, loja) {
  const modalidadeTratada = nomeModalidade(cota);

  const registro = {
    codigo_bolao_caixa: String(cota.codigoBolao),

    loteria_id: loja.loteria_id || null,
    codigo_loterica: String(cota.loterica || loja.codigo),
    nome_loteria: cota.nomeFantasia || loja.nome,
    razao_social: cota.nomeRazaoSocial || null,
    municipio: cota.municipio?.nome || null,
    uf: cota.uf?.sigla || null,

    modalidade: modalidadeTratada,
    modalidade_original: cota.modalidade || null,
    concurso: String(cota.concurso || ""),
    tipo_concurso: normalizarNumero(cota.tipoConcurso),

    dt_sorteio: converterDataBR(cota.dataSorteio),
    hora_sorteio: cota.horaSorteio || null,
    dia_sorteio: cota.diaSorteio || null,

    qtd_apostas: normalizarNumero(cota.qtdApostas),
    qtd_numeros: normalizarNumero(cota.qtdNumeros),
    qtd_trevos: normalizarNumero(cota.qtdTrevos) || 0,

    qtd_cota_total: normalizarNumero(cota.qtdCotaTotal) || 0,
    qtd_cota_disponivel: normalizarNumero(cota.qtdCotaDisponivel) || 0,
    qtd_cota_digital: normalizarNumero(cota.qtdCotaDigital) || 0,

    valor_cota: normalizarNumero(cota.vrCotaComTarifa),
    valor_cota_sem_tarifa: normalizarNumero(cota.vrCotaSemTarifa),
    tarifa_servico: normalizarNumero(cota.valorTarifaServico),
    valor_ultima_cota: normalizarNumero(cota.vrUltimaCotaComTarifa),
    premio_estimado: normalizarNumero(cota.vrPremioEstimado),

    contem_residuo: Boolean(cota.contemResiduo),

    status_marketplace: "ATIVO",
    payload_caixa: cota,

    ultima_coleta_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("marketplace_caixa_boloes")
    .upsert(registro, {
      onConflict: "codigo_bolao_caixa",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Erro ao salvar bolão atual: ${error.message}`);
  }

  return data;
}

async function salvarSnapshot(cota, loja) {
  const qtdTotal = normalizarNumero(cota.qtdCotaTotal) || 0;
  const qtdDisp = normalizarNumero(cota.qtdCotaDisponivel) || 0;

  const snapshot = {
    codigo_bolao_caixa: String(cota.codigoBolao),
    codigo_loterica: String(cota.loterica || loja.codigo),

    modalidade: nomeModalidade(cota),
    concurso: String(cota.concurso || ""),

    qtd_cota_total: qtdTotal,
    qtd_cota_disponivel: qtdDisp,
    qtd_cota_vendida: Math.max(qtdTotal - qtdDisp, 0),

    valor_cota: normalizarNumero(cota.vrCotaComTarifa),
    payload_caixa: cota,
  };

  const { error } = await supabase
    .from("marketplace_caixa_snapshots")
    .insert(snapshot);

  if (error) {
    throw new Error(`Erro ao salvar snapshot: ${error.message}`);
  }
}

async function registrarAlerta({
  tipoAlerta,
  chaveAlerta,
  cota,
  loja,
  mensagem,
}) {
  const registro = {
    tipo_alerta: tipoAlerta,
    chave_alerta: chaveAlerta,

    codigo_bolao_caixa: cota?.codigoBolao ? String(cota.codigoBolao) : null,
    codigo_loterica: cota?.loterica ? String(cota.loterica) : String(loja.codigo),

    modalidade: cota ? nomeModalidade(cota) : null,
    concurso: cota?.concurso ? String(cota.concurso) : null,

    qtd_cota_disponivel: cota?.qtdCotaDisponivel ?? null,
    qtd_cota_total: cota?.qtdCotaTotal ?? null,

    mensagem,
  };

  const { error } = await supabase
    .from("marketplace_caixa_alertas")
    .insert(registro);

  if (error) {
    if (error.code === "23505") {
      console.log(`Alerta já registrado: ${chaveAlerta}`);
      return { novo: false, id: null };
    }

    throw new Error(`Erro ao registrar alerta: ${error.message}`);
  }

  return { novo: true };
}

async function marcarAlertaEnviado(chaveAlerta, resultadoEnvio) {
  const { error } = await supabase
    .from("marketplace_caixa_alertas")
    .update({
      enviado_whatsapp: Boolean(resultadoEnvio.enviado),
      erro_envio: resultadoEnvio.erro || null,
    })
    .eq("chave_alerta", chaveAlerta);

  if (error) {
    console.log("Erro ao atualizar status do alerta:", error.message);
  }
}

function chaveHoraAtual(loja) {
  const agora = new Date();

  const formatado = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  })
    .format(agora)
    .replace(" ", "T");

  return `RESUMO_HORA|${loja.codigo}|${formatado}`;
}

async function processarLoja(browser, loja) {
  const cotas = await coletarCotasLoja(browser, loja);

  if (cotas.length === 0) {
    const mensagem = `⚠️ SISLOT Marketplace: nenhuma cota capturada para ${loja.nome} (${loja.codigo}).`;
    console.log(mensagem);
    return;
  }

  for (const cota of cotas) {
    await salvarBolaoAtual(cota, loja);
    await salvarSnapshot(cota, loja);

    const qtdDisponivel = Number(cota.qtdCotaDisponivel || 0);

    if (qtdDisponivel < ALERTA_COTAS_LIMITE) {
      const chaveAlerta = `BAIXA_COTA|${cota.codigoBolao}|${qtdDisponivel}`;
      const mensagem = montarMensagemAlerta(cota, loja);

      const alerta = await registrarAlerta({
        tipoAlerta: "BAIXA_COTA",
        chaveAlerta,
        cota,
        loja,
        mensagem,
      });

      if (alerta.novo) {
        const resultadoEnvio = await enviarWhatsapp(mensagem);
        await marcarAlertaEnviado(chaveAlerta, resultadoEnvio);
      }
    }
  }

  const chaveResumo = chaveHoraAtual(loja);
  const mensagemResumo = montarMensagemResumo(loja, cotas);

  const alertaResumo = await registrarAlerta({
    tipoAlerta: "RESUMO_HORA",
    chaveAlerta: chaveResumo,
    cota: null,
    loja,
    mensagem: mensagemResumo,
  });

  if (alertaResumo.novo) {
    const resultadoEnvio = await enviarWhatsapp(mensagemResumo);
    await marcarAlertaEnviado(chaveResumo, resultadoEnvio);
  }
}

async function main() {
  console.log("Iniciando monitor Marketplace Caixa...");

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    for (const loja of LOJAS) {
      await processarLoja(browser, loja);
    }
  } finally {
    await browser.close();
  }

  console.log("Monitor finalizado.");
}

main().catch((erro) => {
  console.error("Erro geral:", erro);
  process.exit(1);
});
