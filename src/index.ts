// src/index.ts
// Entrypoint do scraper: lê o JSON atual, raspa as fontes, decide, escreve se mudou.
// Exit 1 em dados implausíveis ou erro fatal (faz a GitHub Action falhar = alerta visível).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isPlausible, parseMcmvLimits, parseMcmvRatesHtml } from "./parser";
import { COTA_VIGENTE, SBPE_BALCAO_VIGENTE, decideUpdate } from "./update";
import { fetchGovBrHtml, fetchIndexers, vigiarCota, vigiarSbpeBalcao, sinalizarFalhaBcb, SOURCE_URL } from "./sources";
import type { AlertaCota, AlertaSbpeBalcao, RatesPayload } from "./types";

// Caminho relativo a src/ — o JSON-banco vive na raiz do repo, em data/.
const DATA_PATH = fileURLToPath(new URL("../data/taxas-financiamento.json", import.meta.url));
// alerta-<label>.md: lidos pelo workflow, que abre/comenta uma issue com essa label. Ignorados pelo git.
const alertaPath = (label: string) => fileURLToPath(new URL(`../alerta-${label}.md`, import.meta.url));

const RODAPE_ALERTA = (constante: string, campoData: string) =>
  `Se confirmar: edite \`${constante}\` em \`src/update.ts\` (${campoData}), push e rode a Action. Se for alarme falso: feche a issue.`;

function gravarAlerta(label: string, titulo: string, linhas: string[], a: { url: string; trecho: string }, rodape: string): void {
  const corpo = [
    `O vigia (LLM + busca web) encontrou uma possível mudança: **${titulo}**. **Nada foi publicado** — confira a fonte.`,
    "",
    ...linhas,
    `- Fonte: ${a.url}`,
    "",
    `> ${a.trecho.replace(/\n/g, " ")}`,
    "",
    rodape,
  ].join("\n");
  writeFileSync(alertaPath(label), corpo + "\n", "utf-8");
  console.warn(`::warning::[vigia:${label}] possível mudança — ${titulo} (${a.url})`);
}

function alertarCota(a: AlertaCota): void {
  const v = COTA_VIGENTE;
  gravarAlerta("cota-sbpe", "cota SBPE da Caixa", [
    `- Vigente no motor: SAC ${v.sbpe.sac}% / Price ${v.sbpe.price}% desde ${v.atualizadoEm.slice(0, 10)}`,
    `- Segundo o vigia: SAC ${a.sac}% / Price ${a.price}% — notícia de ${a.dataPublicacao}`,
  ], a, RODAPE_ALERTA("COTA_VIGENTE", "atualizadoEm = início da vigência"));
}

function alertarSbpeBalcao(a: AlertaSbpeBalcao): void {
  const v = SBPE_BALCAO_VIGENTE;
  const e = v.sfh.efetivaAnualPct;
  gravarAlerta("sbpe-balcao", "taxa de balcão SBPE/SFH da Caixa", [
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
