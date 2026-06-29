// src/index.ts
// Entrypoint do scraper: lê o JSON atual, raspa as fontes, decide, escreve se mudou.
// Exit 1 em dados implausíveis ou erro fatal (faz a GitHub Action falhar = alerta visível).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isPlausible, parseMcmvLimits, parseMcmvRatesHtml } from "./parser";
import { decideUpdate } from "./update";
import { fetchGovBrHtml, fetchIndexers, fetchCotaMaxima, SOURCE_URL } from "./sources";
import type { RatesPayload } from "./types";

// Caminho relativo a src/ — o JSON-banco vive na raiz do repo, em data/.
const DATA_PATH = fileURLToPath(new URL("../data/taxas-financiamento.json", import.meta.url));

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
  const [raw, cotaRaw] = await Promise.all([fetchIndexers(), fetchCotaMaxima()]);
  const { changed, payload } = decideUpdate(old, parsed, raw, cotaRaw, mcmvRaw, new Date(), SOURCE_URL);

  if (!changed) {
    console.log("[scrape] unchanged — nada a commitar.");
    return;
  }

  writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  console.log(
    `[scrape] atualizado — publishedAt=${payload.meta.publishedAt} ` +
      `retrievedAt=${payload.meta.retrievedAt} ` +
      `tr=${payload.indexers.trMonthlyPct} poup=${payload.indexers.poupancaMonthlyPct} ` +
      `cota=SAC ${payload.cotaMaxima.sbpe.sac}%/Price ${payload.cotaMaxima.sbpe.price}% ` +
      `tetoCM=${payload.mcmv.tetoImovel.classeMedia}`,
  );
}

main().catch((e) => {
  console.error("[scrape] erro fatal:", e);
  process.exit(1);
});
