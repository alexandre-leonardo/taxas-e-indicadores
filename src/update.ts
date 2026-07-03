// src/update.ts
// Núcleo de decisão — lógica PURA, sem I/O (rede ou disco). Testável em isolamento.
import { createHash } from "node:crypto";
import type {
  CotaRaw,
  IndexersRaw,
  McmvLimits,
  ParsedRates,
  RatesPayload,
  IndicesHistorico,
  PontoSerie,
  SerieIndice,
  UnidadeIndice,
} from "./types";

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

/** Limites MCMV plausíveis: tetos em 50k–5M (max≥min), subsídios em 1k–500k. */
export function isMcmvPlausible(m: McmvLimits | null): m is McmvLimits {
  if (!m || !m.tetoImovel || !m.subsidioMaxPorRegiao) return false;
  const t = m.tetoImovel;
  const inRange = (v: unknown, lo: number, hi: number): boolean =>
    typeof v === "number" && !Number.isNaN(v) && v >= lo && v <= hi;
  const tetos = [t.faixa1e2?.min, t.faixa1e2?.max, t.faixa3, t.classeMedia];
  if (!tetos.every((v) => inRange(v, 50_000, 5_000_000))) return false;
  if (t.faixa1e2.max < t.faixa1e2.min) return false;
  const subs = [m.subsidioMaxPorRegiao.N, m.subsidioMaxPorRegiao.demais];
  return subs.every((v) => inRange(v, 1_000, 500_000));
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
  cotaRaw: CotaRaw | null,
  mcmvRaw: McmvLimits | null,
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

  // Cota: só publica se plausível E o número (sac/price) mudou. fonteUrl varia entre runs
  // com o mesmo valor — comparar fonteUrl geraria commit semanal espúrio.
  let cotaMaxima = old.cotaMaxima;
  let cotaChanged = false;
  if (
    isCotaPlausible(cotaRaw) &&
    (cotaRaw.sac !== old.cotaMaxima?.sbpe?.sac || cotaRaw.price !== old.cotaMaxima?.sbpe?.price)
  ) {
    cotaChanged = true;
    cotaMaxima = {
      sbpe: { sac: cotaRaw.sac, price: cotaRaw.price },
      fonteUrl: cotaRaw.fonteUrl,
      atualizadoEm: now.toISOString(),
    };
  }

  // MCMV: parse determinístico do gov.br. Estável (sem churn); preserva old se implausível.
  // ponytail: 7 params posicionais — se entrar um 4º source, agrupar num objeto `sources`.
  let mcmv = old.mcmv;
  let mcmvChanged = false;
  if (isMcmvPlausible(mcmvRaw) && JSON.stringify(mcmvRaw) !== JSON.stringify(old.mcmv)) {
    mcmvChanged = true;
    mcmv = mcmvRaw;
  }

  const changed =
    old.meta.contentHash !== contentHash ||
    old.indexers.trMonthlyPct !== tr ||
    old.indexers.poupancaMonthlyPct !== poup ||
    cotaChanged ||
    mcmvChanged;

  if (!changed) return { changed: false, payload: old };

  const payload: RatesPayload = {
    faixa2: parsed.faixa2,
    faixa3: parsed.faixa3,
    classeMedia: parsed.classeMedia,
    indexers: { trMonthlyPct: tr, poupancaMonthlyPct: poup },
    cotaMaxima,
    mcmv,
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

// ── Painel de índices (BCB SGS) — lógica pura, aditiva ao motor de taxas ──

/** Faixas de plausibilidade por unidade (aberto-aberto). Barra hiperinflação/lixo e número-índice fora de faixa. */
const PLAUS_INDICE: Record<UnidadeIndice, [number, number]> = {
  pct_am: [-10, 10], // IGP-M tem meses negativos e picos ~+4%
  pct_aa: [0, 50], // juros habitacional (~8–14% a.a.)
  indice: [50, 5000], // IVG-R ≈ 769
};

export function isPontoPlausivel(valor: number, unidade: UnidadeIndice): boolean {
  if (typeof valor !== "number" || Number.isNaN(valor)) return false;
  const [lo, hi] = PLAUS_INDICE[unidade];
  return valor > lo && valor < hi;
}

/**
 * Merge anti-corrupção: base = série anterior; cada ponto buscado PLAUSÍVEL sobrescreve o mês.
 * Ponto buscado implausível ou fetched null → preserva o valor anterior (rede nunca destrói dado bom).
 * Retorna ordenada por mês asc.
 */
export function mergeSerie(
  old: PontoSerie[],
  fetched: PontoSerie[] | null,
  unidade: UnidadeIndice,
): PontoSerie[] {
  const map = new Map<string, number>();
  for (const p of old) map.set(p.mes, p.valor);
  if (fetched) {
    for (const p of fetched) if (isPontoPlausivel(p.valor, unidade)) map.set(p.mes, p.valor);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, valor]) => ({ mes, valor }));
}

/**
 * Decide se o histórico mudou. contentHash = sha256(objeto `indices`). Reescreve só se mudou.
 * `fetched` mapeia chave→pontos (ou null se o fetch daquela série falhou).
 */
export function decideIndices(
  old: IndicesHistorico,
  fetched: Record<string, PontoSerie[] | null>,
  config: Record<string, { nome: string; sgs: number; unidade: UnidadeIndice }>,
  now: Date,
  sourceUrl: string,
  desde: string,
): { changed: boolean; payload: IndicesHistorico } {
  const indices: Record<string, SerieIndice> = {};
  for (const [chave, cfg] of Object.entries(config)) {
    const oldSerie = old.indices?.[chave]?.serie ?? [];
    const serie = mergeSerie(oldSerie, fetched[chave] ?? null, cfg.unidade);
    indices[chave] = { nome: cfg.nome, sgs: cfg.sgs, unidade: cfg.unidade, serie };
  }
  const contentHash = sha256(JSON.stringify(indices));
  if (old.meta?.contentHash === contentHash) return { changed: false, payload: old };
  return {
    changed: true,
    payload: {
      schemaVersion: 1,
      indices,
      meta: {
        fonte: "BCB SGS (api.bcb.gov.br)",
        sourceUrl,
        desde,
        atualizadoEm: now.toISOString(),
        contentHash,
      },
    },
  };
}
