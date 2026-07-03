import { describe, it, expect } from "vitest";
import { normalizeSgsRows } from "../src/sources";
import { isPontoPlausivel, mergeSerie, decideIndices } from "../src/update";
import type { IndicesHistorico, PontoSerie, UnidadeIndice } from "../src/types";

describe("normalizeSgsRows", () => {
  it("converte data DD/MM/AAAA→YYYY-MM e valor string(ponto)→number", () => {
    const rows = [
      { data: "01/05/2026", valor: "0.88" },
      { data: "01/06/2026", valor: "-0.50" },
    ];
    expect(normalizeSgsRows(rows)).toEqual([
      { mes: "2026-05", valor: 0.88 },
      { mes: "2026-06", valor: -0.5 },
    ]);
  });
  it("descarta linhas sem data/valor ou NaN", () => {
    const rows = [
      { data: "01/05/2026", valor: "x" },
      { valor: "1" },
      { data: "01/07/2026", valor: "1.2" },
    ];
    expect(normalizeSgsRows(rows as any)).toEqual([{ mes: "2026-07", valor: 1.2 }]);
  });
});

describe("isPontoPlausivel", () => {
  it("pct_am: aceita 0.5 e -0.5, rejeita 15 e -20", () => {
    expect(isPontoPlausivel(0.5, "pct_am")).toBe(true);
    expect(isPontoPlausivel(-0.5, "pct_am")).toBe(true);
    expect(isPontoPlausivel(15, "pct_am")).toBe(false);
    expect(isPontoPlausivel(-20, "pct_am")).toBe(false);
  });
  it("indice: aceita 769, rejeita 10", () => {
    expect(isPontoPlausivel(769, "indice")).toBe(true);
    expect(isPontoPlausivel(10, "indice")).toBe(false);
  });
  it("pct_aa: aceita 9.5, rejeita 60", () => {
    expect(isPontoPlausivel(9.5, "pct_aa")).toBe(true);
    expect(isPontoPlausivel(60, "pct_aa")).toBe(false);
  });
});

describe("mergeSerie", () => {
  const u: UnidadeIndice = "pct_am";
  it("ponto buscado válido sobrescreve o anterior; ordena por mês", () => {
    const old: PontoSerie[] = [{ mes: "2026-01", valor: 0.4 }];
    const fetched: PontoSerie[] = [
      { mes: "2026-02", valor: 0.5 },
      { mes: "2026-01", valor: 0.41 },
    ];
    expect(mergeSerie(old, fetched, u)).toEqual([
      { mes: "2026-01", valor: 0.41 },
      { mes: "2026-02", valor: 0.5 },
    ]);
  });
  it("ponto buscado implausível preserva o anterior", () => {
    const old: PontoSerie[] = [{ mes: "2026-01", valor: 0.4 }];
    const fetched: PontoSerie[] = [{ mes: "2026-01", valor: 999 }];
    expect(mergeSerie(old, fetched, u)).toEqual([{ mes: "2026-01", valor: 0.4 }]);
  });
  it("fetched null preserva toda a série anterior", () => {
    const old: PontoSerie[] = [{ mes: "2026-01", valor: 0.4 }];
    expect(mergeSerie(old, null, u)).toEqual(old);
  });
});

describe("decideIndices", () => {
  const cfg = { ipca: { nome: "IPCA", sgs: 433, unidade: "pct_am" as UnidadeIndice } };
  const vazio: IndicesHistorico = {
    schemaVersion: 1,
    indices: {},
    meta: { fonte: "", sourceUrl: "", desde: "2001-01", atualizadoEm: "", contentHash: "" },
  };
  const now = new Date("2026-07-03T00:00:00Z");
  it("primeira ingestão → changed=true", () => {
    const r = decideIndices(vazio, { ipca: [{ mes: "2026-05", valor: 0.5 }] }, cfg, now, "u", "2001-01");
    expect(r.changed).toBe(true);
    expect(r.payload.indices.ipca.serie).toEqual([{ mes: "2026-05", valor: 0.5 }]);
  });
  it("mesmo input duas vezes → idempotente (changed=false)", () => {
    const r1 = decideIndices(vazio, { ipca: [{ mes: "2026-05", valor: 0.5 }] }, cfg, now, "u", "2001-01");
    const r2 = decideIndices(r1.payload, { ipca: [{ mes: "2026-05", valor: 0.5 }] }, cfg, now, "u", "2001-01");
    expect(r2.changed).toBe(false);
  });
});
