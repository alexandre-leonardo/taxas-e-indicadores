// src/index.ts
// Entrypoint do scraper: lê o JSON atual, raspa as fontes, decide, escreve se mudou.
// Exit 1 em dados implausíveis ou erro fatal (faz a GitHub Action falhar = alerta visível).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isPlausible, parseMcmvLimits, parseMcmvRatesHtml } from "./parser";
import { COTA_VIGENTE, decideUpdate } from "./update";
import { fetchGovBrHtml, fetchIndexers, vigiarCota, sinalizarFalhaBcb, SOURCE_URL } from "./sources";
import type { AlertaCota, RatesPayload } from "./types";

// Caminho relativo a src/ — o JSON-banco vive na raiz do repo, em data/.
const DATA_PATH = fileURLToPath(new URL("../data/taxas-financiamento.json", import.meta.url));
// Lido pelo workflow (hashFiles) para abrir/comentar a issue do vigia. Ignorado pelo git.
const ALERTA_PATH = fileURLToPath(new URL("../alerta-cota.md", import.meta.url));

function corpoAlerta(a: AlertaCota): string {
  const v = COTA_VIGENTE;
  return [
    "O vigia (LLM + busca web) encontrou uma possível mudança na cota SBPE da Caixa. **Nada foi publicado** — confira a fonte.",
    "",
    `- Vigente no motor: SAC ${v.sbpe.sac}% / Price ${v.sbpe.price}% desde ${v.atualizadoEm.slice(0, 10)}`,
    `- Segundo o vigia: SAC ${a.sac}% / Price ${a.price}% — notícia de ${a.dataPublicacao}`,
    `- Fonte: ${a.url}`,
    "",
    `> ${a.trecho.replace(/\n/g, " ")}`,
    "",
    "Se confirmar: edite `COTA_VIGENTE` em `src/update.ts` (atualizadoEm = início da vigência), push e rode a Action. Se for alarme falso: feche a issue.",
  ].join("\n");
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
  const [raw, alerta] = await Promise.all([fetchIndexers(), vigiarCota(COTA_VIGENTE)]);
  if (alerta) {
    writeFileSync(ALERTA_PATH, corpoAlerta(alerta) + "\n", "utf-8");
    console.warn(`::warning::[vigia] possível mudança na cota SBPE: SAC ${alerta.sac}/Price ${alerta.price} (${alerta.url})`);
  }
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
      `tetoCM=${payload.mcmv?.tetoImovel?.classeMedia ?? "—"}`,
  );
}

main().catch((e) => {
  console.error("[scrape] erro fatal:", e);
  process.exit(1);
});
