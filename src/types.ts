// src/types.ts
// Contrato público das taxas. Baseado no RatesPayload do engaja-amiz
// (src/lib/financing/finance/rate.ts). `cotaMaxima` é uma ADIÇÃO deste repo (aditiva: consumidores
// que não a conhecem ignoram a chave). Mudanças nos campos existentes precisam migrar consumidores.

export type RateRegion = "N_NE" | "S_SE_CO";

export interface RateByCotistaRegion {
  cotista: Record<RateRegion, number>;
  naoCotista: Record<RateRegion, number>;
}

// Uma linha da Faixa 2 no gov.br: a taxa sobe com a renda (3 subfaixas). Aditivo ao contrato:
// `faixa2` continua sendo só a 1ª subfaixa. Linha com 2 valores na tabela → cotista = naoCotista.
export interface Faixa2Subfaixa extends RateByCotistaRegion {
  rendaAte: number; // teto da subfaixa (R$ mensal bruto); o piso é o teto da anterior
}

export interface RatesPayload {
  faixa2: RateByCotistaRegion;
  faixa2Subfaixas?: Faixa2Subfaixa[]; // ordenadas por rendaAte; ausente se o layout não casou
  faixa3: RateByCotistaRegion;
  classeMedia: number;
  indexers: { trMonthlyPct: number; poupancaMonthlyPct: number };
  cotaMaxima: CotaMaxima;
  sbpeBalcao?: SbpeBalcao; // aditivo (10/2026); ausente só em seeds antigos
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
  faixa2Subfaixas?: Faixa2Subfaixa[];
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
  atualizadoEm: string; // ISO 8601 — início da vigência (valor revisado por humano em update.ts:COTA_VIGENTE)
}

// Taxa de balcão SBPE da Caixa — revisada por HUMANO (update.ts:SBPE_BALCAO_VIGENTE), nunca por LLM.
// Taxa EFETIVA anual (% a.a.) + indexador. SFI (imóvel acima de tetoImovel) ainda não publicado: não conferido.
export interface SbpeBalcao {
  sfh: {
    tetoImovel: number; // R$ — acima disso é SFI
    efetivaAnualPct: { semRelacionamento: number; comRelacionamento: number };
    indexador: "TR";
  };
  fonteUrl: string;
  verificadoEm: string; // ISO 8601 — quando um humano conferiu o valor (não é início de vigência)
}

// Alerta do vigia da taxa de balcão SFH. Nunca é publicado.
export interface AlertaSbpeBalcao {
  semRelacionamento: number;
  comRelacionamento: number;
  url: string;
  trecho: string;
  dataPublicacao: string;
}

// Alerta do vigia da cota SBPE (LLM): possível mudança a revisar por humano. Nunca é publicado.
export interface AlertaCota {
  sac: number;
  price: number;
  url: string;
  trecho: string;
  dataPublicacao: string; // AAAA-MM-DD, como o LLM informou
}

// Limites do MCMV (teto do imóvel por faixa + subsídio máximo por região). Aditivo ao contrato.
// Fonte: mesma página gov.br das taxas (datada por meta.publishedAt/retrievedAt).
export interface McmvLimits {
  tetoImovel: { faixa1e2: { min: number; max: number }; faixa3: number; classeMedia: number };
  subsidioMaxPorRegiao: { N: number; demais: number };
}

// ── Painel de índices (BCB SGS) — aditivo, arquivo próprio data/indices-historico.json ──
export type UnidadeIndice = "pct_am" | "pct_aa" | "indice";

export interface PontoSerie {
  mes: string; // "YYYY-MM"
  valor: number;
}

export interface SerieIndice {
  nome: string;
  sgs: number;
  unidade: UnidadeIndice;
  serie: PontoSerie[]; // ordenada por mês asc
}

export interface IndicesHistorico {
  schemaVersion: 1;
  indices: Record<string, SerieIndice>;
  meta: {
    fonte: string;
    sourceUrl: string;
    desde: string; // "YYYY-MM"
    atualizadoEm: string; // ISO 8601
    contentHash: string; // sha256 do objeto `indices`
  };
}
