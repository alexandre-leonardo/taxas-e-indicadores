// src/update.ts
// Núcleo de decisão — lógica PURA, sem I/O (rede ou disco). Testável em isolamento.
import { createHash } from "node:crypto";
import type {
  CotaMaxima,
  SbpeBalcao,
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

/**
 * Cota máxima SBPE vigente — revisada por HUMANO, não por LLM (o LLM inventava 70/50).
 * Mudou a cota? Edite aqui (atualizadoEm = início da vigência), push e rode a Action:
 * o scrape publica e faz purge do jsDelivr. O vigia (sources.ts:vigiarCota) abre issue quando
 * acha notícia de mudança posterior a atualizadoEm.
 * Histórico: 80/70 → 70/50 em 01/11/2024 → 80/70 de volta em 13/10/2025.
 */
export const COTA_VIGENTE: CotaMaxima = {
  sbpe: { sac: 80, price: 70 },
  fonteUrl:
    "https://caixanoticias.caixa.gov.br/Paginas/Not%C3%ADcias/2025/10-OUTUBRO/CAIXA-e-Governo-Federal-fortalecem-politica-habitacional-com-novas-medidas-para-o-credito-imobiliario.aspx",
  atualizadoEm: "2025-10-13T00:00:00.000Z",
};

/**
 * Taxa de balcão SBPE/SFH da Caixa (efetiva a.a. + TR) — revisada por HUMANO, mesmo modelo da cota.
 * Conferida em 03/10/2026 contra blogs de imobiliárias (a Caixa bloqueia robô e não há página
 * oficial acessível); bate com a calibração do simulador da Caixa feita pelo engaja em 06/2026
 * (10,9259% nominal ↔ 11,49% efetiva) e com a calculadora oficial (degrau por renda, abaixo).
 * SFI fica de fora até alguém conferir.
 * Mudou? Edite aqui (verificadoEm = data da conferência), push e rode a Action. O vigia
 * (sources.ts:vigiarSbpeBalcao) abre issue com label sbpe-balcao quando acha notícia posterior.
 */
export const SBPE_BALCAO_VIGENTE: SbpeBalcao = {
  sfh: {
    tetoImovel: 2_250_000,
    efetivaAnualPct: { semRelacionamento: 11.49, comRelacionamento: 11.19 },
    // Medido na calculadora da Caixa em 03/10/2026 (busca binária: renda 77.500 → 11,49; 77.501 → 13,40).
    // Imóveis de R$ 700 mil a R$ 10 mi: mesma taxa (sem degrau no teto do SFH). 13,40 NÃO é a taxa do SFI.
    semRelacionamentoPorRenda: [
      { rendaAte: 77_500, efetivaAnualPct: 11.49 },
      { rendaAte: null, efetivaAnualPct: 13.4 },
    ],
    fontePorRendaUrl: "https://simuladorhabitacao.caixa.gov.br/calculadora",
    indexador: "TR",
  },
  fonteUrl: "https://larya.com.br/blog/taxas-de-juros-financiamento-imobiliario-2026/",
  verificadoEm: "2026-10-03T00:00:00.000Z",
};

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
  mcmvRaw: McmvLimits | null,
  now: Date,
  sourceUrl: string,
): { changed: boolean; payload: RatesPayload } {
  // Subfaixas da Faixa 2: layout não casou (undefined) → preserva as anteriores, ANTES do hash
  // (senão o hash muda toda rodada e o campo some do JSON). Mesma regra do mcmv/indexadores.
  const faixa2Subfaixas = parsed.faixa2Subfaixas ?? old.faixa2Subfaixas;
  const contentHash = sha256(JSON.stringify({ ...parsed, faixa2Subfaixas }));

  const tr =
    typeof raw.trRaw === "number" && raw.trRaw > 0 ? raw.trRaw : old.indexers.trMonthlyPct;
  const poup =
    typeof raw.poupRaw === "number" && raw.poupRaw > 0
      ? raw.poupRaw
      : old.indexers.poupancaMonthlyPct;

  // Cota: constante revisada por humano. Mudou a constante → publica na próxima rodada.
  const cotaMaxima = COTA_VIGENTE;
  const cotaChanged = JSON.stringify(old.cotaMaxima) !== JSON.stringify(COTA_VIGENTE);
  // Taxa de balcão SBPE: idem (constante revisada por humano).
  const sbpeBalcao = SBPE_BALCAO_VIGENTE;
  const sbpeBalcaoChanged = JSON.stringify(old.sbpeBalcao) !== JSON.stringify(SBPE_BALCAO_VIGENTE);

  // MCMV: parse determinístico do gov.br. Estável (sem churn); preserva old se implausível.
  // ponytail: 6 params posicionais — se entrar um 4º source, agrupar num objeto `sources`.
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
    sbpeBalcaoChanged ||
    mcmvChanged;

  if (!changed) return { changed: false, payload: old };

  const payload: RatesPayload = {
    faixa2: parsed.faixa2,
    faixa2Subfaixas,
    faixa3: parsed.faixa3,
    classeMedia: parsed.classeMedia,
    indexers: { trMonthlyPct: tr, poupancaMonthlyPct: poup },
    cotaMaxima,
    sbpeBalcao,
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
    if (serie.length === 0) continue; // não persiste série vazia (ex.: série nova cujo 1º fetch falhou)
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
