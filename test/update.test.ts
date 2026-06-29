// test/update.test.ts
import { describe, it, expect } from "vitest";
import { decideUpdate, isCotaPlausible, isMcmvPlausible, sha256 } from "../src/update";
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
    cotaMaxima: {
      sbpe: { sac: 80, price: 70 },
      fonteUrl: "https://caixanoticias.caixa.gov.br/x",
      atualizadoEm: "2026-06-01T00:00:00.000Z",
    },
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
    const r = decideUpdate(makeOld(), parsed, { trRaw: 0.1709, poupRaw: 0.6734 }, null, null, now, SOURCE);
    expect(r.changed).toBe(false);
  });

  it("muda quando as faixas mudam (contentHash novo)", () => {
    const parsedNovo = { ...parsed, classeMedia: 11 };
    const r = decideUpdate(makeOld(), parsedNovo, { trRaw: 0.1709, poupRaw: 0.6734 }, null, null, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.classeMedia).toBe(11);
    expect(r.payload.meta.contentHash).not.toBe(makeOld().meta.contentHash);
    expect(r.payload.meta.rulesStale).toBe(false);
    expect(r.payload.meta.retrievedAt).toBe(now.toISOString());
  });

  it("muda quando só os indexers mudam (faixas iguais)", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: 0.2, poupRaw: 0.7 }, null, null, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.indexers.trMonthlyPct).toBe(0.2);
    expect(r.payload.indexers.poupancaMonthlyPct).toBe(0.7);
  });

  it("guarda anti-zero: BCB null preserva indexers antigos e não marca changed", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: null, poupRaw: null }, null, null, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.indexers.trMonthlyPct).toBe(0.1709);
    expect(r.payload.indexers.poupancaMonthlyPct).toBe(0.6734);
  });

  it("guarda anti-zero: BCB 0 preserva indexers antigos", () => {
    const r = decideUpdate(makeOld(), parsed, { trRaw: 0, poupRaw: 0 }, null, null, now, SOURCE);
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

describe("isCotaPlausible", () => {
  const ok = { sac: 80, price: 70, fonteUrl: "https://caixanoticias.caixa.gov.br/x" };
  it("aceita cota válida de fonte oficial", () => {
    expect(isCotaPlausible(ok)).toBe(true);
  });
  it("aceita subdomínio gov.br", () => {
    expect(isCotaPlausible({ ...ok, fonteUrl: "https://www.gov.br/cidades/x" })).toBe(true);
  });
  it("rejeita null", () => {
    expect(isCotaPlausible(null)).toBe(false);
  });
  it("rejeita price > sac", () => {
    expect(isCotaPlausible({ ...ok, sac: 70, price: 80 })).toBe(false);
  });
  it("rejeita fora da faixa 30–100", () => {
    expect(isCotaPlausible({ ...ok, sac: 120 })).toBe(false);
    expect(isCotaPlausible({ ...ok, price: 10, sac: 10 })).toBe(false);
  });
  it("rejeita domínio não-oficial (blog)", () => {
    expect(isCotaPlausible({ ...ok, fonteUrl: "https://lokatell.com.br/blog" })).toBe(false);
  });
  it("rejeita fonteUrl malformada", () => {
    expect(isCotaPlausible({ ...ok, fonteUrl: "não é url" })).toBe(false);
  });
  it("rejeita valores NaN", () => {
    expect(isCotaPlausible({ ...ok, sac: NaN })).toBe(false);
  });
});

describe("decideUpdate — cota", () => {
  const same = { trRaw: 0.1709, poupRaw: 0.6734 }; // indexers iguais ao makeOld
  const oficial = "https://caixanoticias.caixa.gov.br/y";

  it("cota null mantém old.cotaMaxima e não marca changed", () => {
    const r = decideUpdate(makeOld(), parsed, same, null, null, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.cotaMaxima).toEqual(makeOld().cotaMaxima);
  });

  it("publica quando sac/price mudam (atualizadoEm e fonteUrl novos)", () => {
    const r = decideUpdate(
      makeOld(),
      parsed,
      same,
      { sac: 70, price: 60, fonteUrl: oficial },
      null,
      now,
      SOURCE,
    );
    expect(r.changed).toBe(true);
    expect(r.payload.cotaMaxima.sbpe).toEqual({ sac: 70, price: 60 });
    expect(r.payload.cotaMaxima.fonteUrl).toBe(oficial);
    expect(r.payload.cotaMaxima.atualizadoEm).toBe(now.toISOString());
  });

  it("cota implausível (price>sac) mantém old e não publica", () => {
    const r = decideUpdate(
      makeOld(),
      parsed,
      same,
      { sac: 70, price: 80, fonteUrl: oficial },
      null,
      now,
      SOURCE,
    );
    expect(r.changed).toBe(false);
    expect(r.payload.cotaMaxima).toEqual(makeOld().cotaMaxima);
  });

  it("cota de fonte não-oficial mantém old", () => {
    const r = decideUpdate(
      makeOld(),
      parsed,
      same,
      { sac: 75, price: 65, fonteUrl: "https://blog.com.br/x" },
      null,
      now,
      SOURCE,
    );
    expect(r.changed).toBe(false);
  });

  it("anti-churn: sac/price iguais com fonteUrl diferente NÃO publica", () => {
    const r = decideUpdate(
      makeOld(),
      parsed,
      same,
      { sac: 80, price: 70, fonteUrl: "https://caixanoticias.caixa.gov.br/OUTRA" },
      null,
      now,
      SOURCE,
    );
    expect(r.changed).toBe(false);
    expect(r.payload.cotaMaxima).toEqual(makeOld().cotaMaxima);
  });

  it("seed pré-feature sem cotaMaxima: não quebra e publica a cota nova", () => {
    const oldSemCota = makeOld();
    delete (oldSemCota as { cotaMaxima?: unknown }).cotaMaxima;
    const oficial2 = "https://caixanoticias.caixa.gov.br/z";
    const r = decideUpdate(
      oldSemCota,
      parsed,
      same,
      { sac: 80, price: 70, fonteUrl: oficial2 },
      null,
      now,
      SOURCE,
    );
    expect(r.changed).toBe(true);
    expect(r.payload.cotaMaxima.sbpe).toEqual({ sac: 80, price: 70 });
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
    const r = decideUpdate(makeOld(), parsed, same, null, null, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.mcmv).toEqual(makeOld().mcmv);
  });

  it("publica quando o teto muda", () => {
    const novo = { ...okMcmv, tetoImovel: { ...okMcmv.tetoImovel, classeMedia: 650000 } };
    const r = decideUpdate(makeOld(), parsed, same, null, novo, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.mcmv.tetoImovel.classeMedia).toBe(650000);
  });

  it("mcmv implausível mantém old e não publica", () => {
    const ruim = { ...okMcmv, subsidioMaxPorRegiao: { N: 9_000_000, demais: 55000 } };
    const r = decideUpdate(makeOld(), parsed, same, null, ruim, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.mcmv).toEqual(makeOld().mcmv);
  });

  it("seed pré-feature sem mcmv: não quebra e publica o mcmv novo", () => {
    const oldSemMcmv = makeOld();
    delete (oldSemMcmv as { mcmv?: unknown }).mcmv;
    const r = decideUpdate(oldSemMcmv, parsed, same, null, okMcmv, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.mcmv).toEqual(okMcmv);
  });
});
