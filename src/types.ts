// src/types.ts
// Contrato público das taxas. Baseado no RatesPayload do engaja-amiz
// (src/lib/financing/finance/rate.ts). `cotaMaxima` é uma ADIÇÃO deste repo (aditiva: consumidores
// que não a conhecem ignoram a chave). Mudanças nos campos existentes precisam migrar consumidores.

export type RateRegion = "N_NE" | "S_SE_CO";

export interface RateByCotistaRegion {
  cotista: Record<RateRegion, number>;
  naoCotista: Record<RateRegion, number>;
}

export interface RatesPayload {
  faixa2: RateByCotistaRegion;
  faixa3: RateByCotistaRegion;
  classeMedia: number;
  indexers: { trMonthlyPct: number; poupancaMonthlyPct: number };
  cotaMaxima: CotaMaxima;
  mcmv: McmvLimits;
  meta: {
    sourceUrl: string;
    sourceName: string;
    retrievedAt: string; // ISO 8601
    publishedAt: string | null; // "DD/MM/YYYY" do gov.br
    contentHash: string; // sha256 do parsed (faixas/classe-média)
    rulesStale: boolean; // sempre false ao escrever; o cliente recalcula por idade
  };
}

// Saída do parser (sem indexers/meta — só o que sai do HTML do gov.br).
export interface ParsedRates {
  faixa2: RateByCotistaRegion;
  faixa3: RateByCotistaRegion;
  classeMedia: number;
  publishedAt: string | null;
}

// Indexadores crus vindos do BCB (null se a chamada falhou).
export interface IndexersRaw {
  trRaw: number | null;
  poupRaw: number | null;
}

// Cota máxima de financiamento SBPE (% do valor do imóvel). Aditivo ao contrato.
export interface CotaMaxima {
  sbpe: { sac: number; price: number };
  fonteUrl: string;
  atualizadoEm: string; // ISO 8601 — quando o pipeline gravou este valor
}

// Saída crua da extração de cota via LLM (null se a chamada/parse falhou).
export interface CotaRaw {
  sac: number;
  price: number;
  fonteUrl: string;
}

// Limites do MCMV (teto do imóvel por faixa + subsídio máximo por região). Aditivo ao contrato.
// Fonte: mesma página gov.br das taxas (datada por meta.publishedAt/retrievedAt).
export interface McmvLimits {
  tetoImovel: { faixa1e2: { min: number; max: number }; faixa3: number; classeMedia: number };
  subsidioMaxPorRegiao: { N: number; demais: number };
}
