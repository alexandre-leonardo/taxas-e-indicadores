// test/parser.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMcmvRatesHtml, isPlausible, parseMcmvLimits } from "../src/parser";

const html = readFileSync(
  fileURLToPath(new URL("./fixtures/mcmv-govbr.html", import.meta.url)),
  "utf-8",
);

describe("parseMcmvRatesHtml", () => {
  it("extrai taxas conhecidas da fixture", () => {
    const r = parseMcmvRatesHtml(html);
    expect(r.faixa3.cotista.N_NE).toBeCloseTo(7.66, 2);
    expect(r.faixa3.cotista.S_SE_CO).toBeCloseTo(8.16, 2);
    expect(r.classeMedia).toBeCloseTo(10.0, 2);
    expect(r.publishedAt).toMatch(/2026/);
  });

  it("extrai Faixa 2 com 4 valores plausíveis", () => {
    const r = parseMcmvRatesHtml(html);
    expect(r.faixa2.cotista.N_NE).toBeCloseTo(4.75, 2);
    expect(r.faixa2.cotista.S_SE_CO).toBeCloseTo(5.0, 2);
    expect(r.faixa2.naoCotista.N_NE).toBeCloseTo(5.25, 2);
    expect(r.faixa2.naoCotista.S_SE_CO).toBeCloseTo(5.5, 2);
  });

  it("Faixa 3 naoCotista = cotista (tabela sem distinção)", () => {
    const r = parseMcmvRatesHtml(html);
    expect(r.faixa3.naoCotista.N_NE).toBeCloseTo(7.66, 2);
    expect(r.faixa3.naoCotista.S_SE_CO).toBeCloseTo(8.16, 2);
  });
});

describe("isPlausible", () => {
  it("aceita payload completo e plausível", () => {
    expect(isPlausible(parseMcmvRatesHtml(html))).toBe(true);
  });
  it("rejeita taxa fora de 0–20%", () => {
    const bad = parseMcmvRatesHtml(html);
    bad.classeMedia = 99;
    expect(isPlausible(bad)).toBe(false);
  });
  it("rejeita faixa faltando", () => {
    const bad: any = parseMcmvRatesHtml(html);
    delete bad.faixa3;
    expect(isPlausible(bad)).toBe(false);
  });
  it("layout quebrado (sem âncora) → implausível", () => {
    const r = parseMcmvRatesHtml("<html><body>página sem tabela de taxas</body></html>");
    expect(isPlausible(r)).toBe(false);
  });
});

describe("parseMcmvLimits", () => {
  it("extrai teto e subsídio da fixture real", () => {
    const m = parseMcmvLimits(html);
    expect(m).toEqual({
      tetoImovel: { faixa1e2: { min: 210000, max: 275000 }, faixa3: 400000, classeMedia: 600000 },
      subsidioMaxPorRegiao: { N: 65000, demais: 55000 },
    });
  });
  it("retorna null se a prosa não estiver presente", () => {
    expect(parseMcmvLimits("<p>página sem os limites</p>")).toBeNull();
  });
});
