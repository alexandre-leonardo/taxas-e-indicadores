// test/update.test.ts
import { describe, it, expect } from "vitest";
import { COTA_VIGENTE, decideUpdate, isMcmvPlausible, sha256 } from "../src/update";
import type { ParsedRates, RatesPayload } from "../src/types";

const SOURCE = "https://www.gov.br/cidades/mcmv-fgts";

const parsed: ParsedRates = {
  faixa2: { cotista: { N_NE: 4.75, S_SE_CO: 5 }, naoCotista: { N_NE: 5.25, S_SE_CO: 5.5 } },
  faixa3: { cotista: { N_NE: 7.66, S_SE_CO: 8.16 }, naoCotista: { N_NE: 7.66, S_SE_CO: 8.16 } },
  classeMedia: 10,
  publishedAt: "16/04/2026",
};

function makeOld(over: Partial<RatesPayload> = {}): RatesPayload {
  return {
    faixa2: parsed.faixa2,
    faixa3: parsed.faixa3,
    classeMedia: parsed.classeMedia,
    indexers: { trMonthlyPct: 0.1709, poupancaMonthlyPct: 0.6734 },
    cotaMaxima: COTA_VIGENTE,
    mcmv: {
      tetoImovel: { faixa1e2: { min: 210000, max: 275000 }, faixa3: 400000, classeMedia: 600000 },
      subsidioMaxPorRegiao: { N: 65000, demais: 55000 },
    },
    meta: {
      sourceUrl: SOURCE,
      sourceName: "Ministério das Cidades — MCMV Linha Financiada",
      retrievedAt: "2026-06-01T00:00:00.000Z",
      publishedAt: "16/04/2026",
      contentHash: sha256(JSON.stringify(parsed)),
      rulesStale: false,
    },
    ...over,
  };
}

const now = new Date("2026-06-27T12:00:00.000Z");

describe("decideUpdate", () => {
  it("não muda quando faixas e indexers são iguais", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: 0.1709, poupRaw: 0.6734 }, null, now, SOURCE);
    expect(r.changed).toBe(false);
  });

  it("muda quando as faixas mudam (contentHash novo)", () => {
    const parsedNovo = { ...parsed, classeMedia: 11 };
    const r = decideUpdate(makeOld(), parsedNovo, { trRaw: 0.1709, poupRaw: 0.6734 }, null, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.classeMedia).toBe(11);
    expect(r.payload.meta.contentHash).not.toBe(makeOld().meta.contentHash);
    expect(r.payload.meta.rulesStale).toBe(false);
    expect(r.payload.meta.retrievedAt).toBe(now.toISOString());
  });

  it("muda quando só os indexers mudam (faixas iguais)", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: 0.2, poupRaw: 0.7 }, null, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.indexers.trMonthlyPct).toBe(0.2);
    expect(r.payload.indexers.poupancaMonthlyPct).toBe(0.7);
  });

  it("guarda anti-zero: BCB null preserva indexers antigos e não marca changed", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: null, poupRaw: null }, null, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.indexers.trMonthlyPct).toBe(0.1709);
    expect(r.payload.indexers.poupancaMonthlyPct).toBe(0.6734);
  });

  it("guarda anti-zero: BCB 0 preserva indexers antigos", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: 0, poupRaw: 0 }, null, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.indexers.trMonthlyPct).toBe(0.1709);
  });
});

describe("sha256", () => {
  it("é determinístico e hex de 64 chars", () => {
    const a = sha256("x");
    const b = sha256("x");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("decideUpdate — cota (constante revisada por humano, sem LLM)", () => {
  const same = { trRaw: 0.1709, poupRaw: 0.6734 }; // indexers iguais ao makeOld

  it("cota igual à COTA_VIGENTE não marca changed", () => {
    const r = decideUpdate(makeOld(), parsed, same, null, now, SOURCE);
    expect(r.changed).toBe(false);
  });

  it("cota antiga diferente (ex.: 70/50 alucinado) é substituída pela COTA_VIGENTE", () => {
    const old = makeOld({
      cotaMaxima: { sbpe: { sac: 70, price: 50 }, fonteUrl: "https://www.caixa.gov.br/faq", atualizadoEm: "2026-09-21T00:00:00.000Z" },
    });
    const r = decideUpdate(old, parsed, same, null, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.cotaMaxima).toEqual(COTA_VIGENTE);
  });

  it("seed pré-feature sem cotaMaxima: não quebra e publica a COTA_VIGENTE", () => {
    const oldSemCota = makeOld();
    delete (oldSemCota as { cotaMaxima?: unknown }).cotaMaxima;
    const r = decideUpdate(oldSemCota, parsed, same, null, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.cotaMaxima).toEqual(COTA_VIGENTE);
  });
});

describe("isMcmvPlausible", () => {
  const ok = {
    tetoImovel: { faixa1e2: { min: 210000, max: 275000 }, faixa3: 400000, classeMedia: 600000 },
    subsidioMaxPorRegiao: { N: 65000, demais: 55000 },
  };
  it("aceita limites válidos", () => {
    expect(isMcmvPlausible(ok)).toBe(true);
  });
  it("rejeita null", () => {
    expect(isMcmvPlausible(null)).toBe(false);
  });
  it("rejeita teto fora da faixa", () => {
    expect(isMcmvPlausible({ ...ok, tetoImovel: { ...ok.tetoImovel, classeMedia: 10 } })).toBe(false);
  });
  it("rejeita faixa1e2 com max < min", () => {
    expect(
      isMcmvPlausible({ ...ok, tetoImovel: { ...ok.tetoImovel, faixa1e2: { min: 275000, max: 210000 } } }),
    ).toBe(false);
  });
  it("rejeita subsídio fora da faixa", () => {
    expect(isMcmvPlausible({ ...ok, subsidioMaxPorRegiao: { N: 5_000_000, demais: 55000 } })).toBe(false);
  });
  it("rejeita campo faltando", () => {
    expect(isMcmvPlausible({ tetoImovel: ok.tetoImovel } as never)).toBe(false);
  });
});

describe("decideUpdate — mcmv", () => {
  const same = { trRaw: 0.1709, poupRaw: 0.6734 };
  const okMcmv = {
    tetoImovel: { faixa1e2: { min: 210000, max: 275000 }, faixa3: 400000, classeMedia: 600000 },
    subsidioMaxPorRegiao: { N: 65000, demais: 55000 },
  };

  it("mcmv null mantém old.mcmv e não marca changed", () => {
    const r = decideUpdate(makeOld(), parsed, same, null, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.mcmv).toEqual(makeOld().mcmv);
  });

  it("publica quando o teto muda", () => {
    const novo = { ...okMcmv, tetoImovel: { ...okMcmv.tetoImovel, classeMedia: 650000 } };
    const r = decideUpdate(makeOld(), parsed, same, novo, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.mcmv.tetoImovel.classeMedia).toBe(650000);
  });

  it("mcmv implausível mantém old e não publica", () => {
    const ruim = { ...okMcmv, subsidioMaxPorRegiao: { N: 9_000_000, demais: 55000 } };
    const r = decideUpdate(makeOld(), parsed, same, ruim, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.mcmv).toEqual(makeOld().mcmv);
  });

  it("seed pré-feature sem mcmv: não quebra e publica o mcmv novo", () => {
    const oldSemMcmv = makeOld();
    delete (oldSemMcmv as { mcmv?: unknown }).mcmv;
    const r = decideUpdate(oldSemMcmv, parsed, same, okMcmv, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.mcmv).toEqual(okMcmv);
  });
});
