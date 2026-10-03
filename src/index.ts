// src/index.ts
// Entrypoint do scraper: lê o JSON atual, raspa as fontes, decide, escreve se mudou.
// Exit 1 em dados implausíveis ou erro fatal (faz a GitHub Action falhar = alerta visível).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isPlausible, linkTabelaMunicipios, parseMcmvLimits, parseMcmvRatesHtml } from "./parser";
import { COTA_VIGENTE, SBPE_BALCAO_VIGENTE, decideUpdate } from "./update";
import { fetchGovBrHtml, fetchIndexers, vigiarCota, vigiarSbpeBalcao, sinalizarFalhaBcb, SOURCE_URL } from "./sources";
import type { AlertaCota, AlertaSbpeBalcao, RatesPayload } from "./types";

// Caminho relativo a src/ — o JSON-banco vive na raiz do repo, em data/.
const DATA_PATH = fileURLToPath(new URL("../data/taxas-financiamento.json", import.meta.url));
const MUNICIPIOS_PATH = fileURLToPath(new URL("../data/mcmv-municipios.json", import.meta.url));

/**
 * Detector determinístico (sem LLM): o gov.br passou a linkar outra tabela de limites por município?
 * → issue "mcmv-municipios" para rodar scripts/mcmv-municipios.py. ponytail: compara só a URL; se a
 * Caixa trocar o conteúdo mantendo o nome do arquivo, não pega (aí comparar fonteSha256 baixando o xlsx).
 */
function detectarTabelaMunicipios(html: string): void {
  const link = linkTabelaMunicipios(html);
  let atual = "";
  try {
    atual = (JSON.parse(readFileSync(MUNICIPIOS_PATH, "utf-8")) as { meta: { fonteUrl: string } }).meta.fonteUrl;
  } catch {
    /* arquivo ausente: trata como diferente */
  }
  if (link === atual) return;
  gravarAlerta(
    "mcmv-municipios",
    link
      ? "O gov.br passou a linkar **outra tabela de limites do MCMV por município**. `data/mcmv-municipios.json` está desatualizado."
      : "O link da **tabela de limites do MCMV por município** sumiu do gov.br (layout mudou?).",
    [`- Publicado hoje: ${atual || "(nenhum)"}`, `- Linkado no gov.br: ${link ?? "(não encontrado)"}`],
    link
      ? `Rode \`python3 scripts/mcmv-municipios.py '${link}'\`, confira o diff, commit e push.`
      : "Ache o novo link na página do gov.br e rode `scripts/mcmv-municipios.py` com ele.",
  );
}

// alerta-<label>.md: lidos pelo workflow, que abre/comenta uma issue com essa label. Ignorados pelo git.
const alertaPath = (label: string) => fileURLToPath(new URL(`../alerta-${label}.md`, import.meta.url));

const RODAPE_ALERTA = (constante: string, campoData: string) =>
  `Se confirmar: edite \`${constante}\` em \`src/update.ts\` (${campoData}), push e rode a Action. Se for alarme falso: feche a issue.`;

function gravarAlerta(label: string, intro: string, linhas: string[], rodape: string): void {
  writeFileSync(alertaPath(label), [intro, "", ...linhas, "", rodape].join("\n") + "\n", "utf-8");
  console.warn(`::warning::[alerta:${label}] ${intro.replace(/\*\*/g, "").slice(0, 140)}`);
}

/** Corpo comum aos vigias de LLM: o que achou + fonte + trecho literal. */
function alertarVigia(label: string, titulo: string, linhas: string[], a: { url: string; trecho: string }, rodape: string): void {
  gravarAlerta(
    label,
    `O vigia (LLM + busca web) encontrou uma possível mudança: **${titulo}**. **Nada foi publicado** — confira a fonte.`,
    [...linhas, `- Fonte: ${a.url}`, "", `> ${a.trecho.replace(/\n/g, " ")}`],
    rodape,
  );
}

function alertarCota(a: AlertaCota): void {
  const v = COTA_VIGENTE;
  alertarVigia("cota-sbpe", "cota SBPE da Caixa", [
    `- Vigente no motor: SAC ${v.sbpe.sac}% / Price ${v.sbpe.price}% desde ${v.atualizadoEm.slice(0, 10)}`,
    `- Segundo o vigia: SAC ${a.sac}% / Price ${a.price}% — notícia de ${a.dataPublicacao}`,
  ], a, RODAPE_ALERTA("COTA_VIGENTE", "atualizadoEm = início da vigência"));
}

function alertarSbpeBalcao(a: AlertaSbpeBalcao): void {
  const v = SBPE_BALCAO_VIGENTE;
  const e = v.sfh.efetivaAnualPct;
  alertarVigia("sbpe-balcao", "taxa de balcão SBPE/SFH da Caixa", [
    `- Vigente no motor: ${e.semRelacionamento}% sem / ${e.comRelacionamento}% com relacionamento (efetiva a.a. + TR), conferida em ${v.verificadoEm.slice(0, 10)}`,
    `- Segundo o vigia: ${a.semRelacionamento}% sem / ${a.comRelacionamento}% com relacionamento — notícia de ${a.dataPublicacao}`,
  ], a, RODAPE_ALERTA("SBPE_BALCAO_VIGENTE", "verificadoEm = data da conferência"));
}

/** Lê o JSON-banco atual. Mensagem dedicada se o seed estiver ausente (não deveria, está commitado). */
function readCurrent(): RatesPayload {
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf-8")) as RatesPayload;
  } catch (e) {
    throw new Error(
      `não foi possível ler o seed ${DATA_PATH} — ele deve estar commitado no repo. Causa: ${String(e)}`,
    );
  }
}

async function main(): Promise<void> {
  const old = readCurrent();

  const html = await fetchGovBrHtml();
  const parsed = parseMcmvRatesHtml(html);

  if (!isPlausible(parsed)) {
    console.error("[scrape] taxas implausíveis — abortando sem escrever:", JSON.stringify(parsed));
    process.exit(1);
  }

  const mcmvRaw = parseMcmvLimits(html);
  detectarTabelaMunicipios(html);
  const [raw, alertaCota, alertaBalcao] = await Promise.all([
    fetchIndexers(),
    vigiarCota(COTA_VIGENTE),
    vigiarSbpeBalcao(SBPE_BALCAO_VIGENTE),
  ]);
  if (alertaCota) alertarCota(alertaCota);
  if (alertaBalcao) alertarSbpeBalcao(alertaBalcao);
  // Mesma régua da guarda anti-zero do decideUpdate: null/≤0 = falhou (e será preservado).
  const valido = (v: number | null) => typeof v === "number" && v > 0;
  const falhos = [!valido(raw.trRaw) && "TR (7811)", !valido(raw.poupRaw) && "poupança (195)"].filter(Boolean);
  if (falhos.length) sinalizarFalhaBcb(`[scrape] BCB sem resposta válida para ${falhos.join(", ")} — valor anterior preservado.`);
  const { changed, payload } = decideUpdate(old, parsed, raw, mcmvRaw, new Date(), SOURCE_URL);

  if (!changed) {
    console.log("[scrape] unchanged — nada a commitar.");
    return;
  }

  writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  console.log(
    `[scrape] atualizado — publishedAt=${payload.meta.publishedAt} ` +
      `retrievedAt=${payload.meta.retrievedAt} ` +
      `tr=${payload.indexers.trMonthlyPct} poup=${payload.indexers.poupancaMonthlyPct} ` +
      `cota=SAC ${payload.cotaMaxima?.sbpe?.sac ?? "—"}%/Price ${payload.cotaMaxima?.sbpe?.price ?? "—"}% ` +
      `balcaoSFH=${payload.sbpeBalcao?.sfh.efetivaAnualPct.semRelacionamento ?? "—"}/${payload.sbpeBalcao?.sfh.efetivaAnualPct.comRelacionamento ?? "—"}% ` +
      `tetoCM=${payload.mcmv?.tetoImovel?.classeMedia ?? "—"}`,
  );
}

main().catch((e) => {
  console.error("[scrape] erro fatal:", e);
  process.exit(1);
});
