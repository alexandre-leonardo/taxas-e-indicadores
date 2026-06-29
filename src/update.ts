// src/update.ts
// Núcleo de decisão — lógica PURA, sem I/O (rede ou disco). Testável em isolamento.
import { createHash } from "node:crypto";
import type { CotaRaw, IndexersRaw, ParsedRates, RatesPayload } from "./types";

export const SOURCE_NAME = "Ministério das Cidades — MCMV Linha Financiada";

/** SHA-256 hex de uma string. */
export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Cota plausível: SAC/Price em 30–100, price ≤ sac, e fonteUrl em domínio oficial gov.br. */
export function isCotaPlausible(c: CotaRaw | null): c is CotaRaw {
  if (!c) return false;
  const { sac, price, fonteUrl } = c;
  if (typeof sac !== "number" || typeof price !== "number" || Number.isNaN(sac) || Number.isNaN(price))
    return false;
  if (sac < 30 || sac > 100 || price < 30 || price > 100) return false;
  if (price > sac) return false;
  if (typeof fonteUrl !== "string") return false;
  let host: string;
  try {
    host = new URL(fonteUrl).hostname;
  } catch {
    return false;
  }
  return host === "gov.br" || host.endsWith(".gov.br");
}

/**
 * Decide se o JSON deve ser reescrito.
 *
 * Regras:
 *  - contentHash = sha256(parsed) — só faixas/classe-média (mesmo sentido do engaja).
 *  - Guarda anti-zero: indexador inválido (null/≤0) preserva o valor anterior (BCB fora do ar
 *    nunca zera bons indexadores).
 *  - changed se a tabela mudou OU se TR/poupança (válidos) mudaram.
 *  - Se nada mudou, retorna o `old` intacto (o chamador não reescreve o arquivo).
 */
export function decideUpdate(
  old: RatesPayload,
  parsed: ParsedRates,
  raw: IndexersRaw,
  now: Date,
  sourceUrl: string,
): { changed: boolean; payload: RatesPayload } {
  const contentHash = sha256(JSON.stringify(parsed));

  const tr =
    typeof raw.trRaw === "number" && raw.trRaw > 0 ? raw.trRaw : old.indexers.trMonthlyPct;
  const poup =
    typeof raw.poupRaw === "number" && raw.poupRaw > 0
      ? raw.poupRaw
      : old.indexers.poupancaMonthlyPct;

  const changed =
    old.meta.contentHash !== contentHash ||
    old.indexers.trMonthlyPct !== tr ||
    old.indexers.poupancaMonthlyPct !== poup;

  if (!changed) return { changed: false, payload: old };

  const payload: RatesPayload = {
    faixa2: parsed.faixa2,
    faixa3: parsed.faixa3,
    classeMedia: parsed.classeMedia,
    indexers: { trMonthlyPct: tr, poupancaMonthlyPct: poup },
    meta: {
      sourceUrl,
      sourceName: SOURCE_NAME,
      retrievedAt: now.toISOString(),
      publishedAt: parsed.publishedAt,
      contentHash,
      rulesStale: false,
    },
  };
  return { changed: true, payload };
}
