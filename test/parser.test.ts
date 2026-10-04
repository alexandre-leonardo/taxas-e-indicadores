// test/parser.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMcmvRatesHtml, isPlausible, parseMcmvLimits, linkTabelaMunicipios } from "../src/parser";

const html = readFileSync(
  fileURLToPath(new URL("./fixtures/mcmv-govbr.html", import.meta.url)),
  "utf-8",
);

describe("parseMcmvRatesHtml", () => {
  it("extrai taxas conhecidas da fixture", () => {
    const r = parseMcmvRatesHtml(html);
    expect(r.faixa3.cotista.N_NE).toBeCloseTo(7.66, 2);
    expect(r.faixa3.cotista.S_SE_CO).toBeCloseTo(7.66, 2);
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

  // Linha de 2 valores = cotista | não cotista, mesma taxa nas duas regiões. Conferido no simulador
  // da Caixa em 03/10/2026: Goiânia (CO), cotista, renda 5.000 → 6,50% (não 7,00%).
  it("extrai as 3 subfaixas de renda da Faixa 2 (linha de 2 valores = cotista | não cotista)", () => {
    const r = parseMcmvRatesHtml(html);
    expect(r.faixa2Subfaixas).toEqual([
      { rendaAte: 3500, cotista: { N_NE: 4.75, S_SE_CO: 5 }, naoCotista: { N_NE: 5.25, S_SE_CO: 5.5 } },
      { rendaAte: 4000, cotista: { N_NE: 5.5, S_SE_CO: 5.5 }, naoCotista: { N_NE: 6, S_SE_CO: 6 } },
      { rendaAte: 5000, cotista: { N_NE: 6.5, S_SE_CO: 6.5 }, naoCotista: { N_NE: 7, S_SE_CO: 7 } },
    ]);
  });

  it("subfaixas ausentes quando o layout não casa (consumidor cai no fallback)", () => {
    expect(parseMcmvRatesHtml("<html><body>sem tabela</body></html>").faixa2Subfaixas).toBeUndefined();
  });

  // Conferido no simulador da Caixa em 03/10/2026: Goiânia (CO), cotista, Faixa 3 → 7,66%.
  it("Faixa 3: cotista 7,66 e não cotista 8,16, iguais nas duas regiões", () => {
    const r = parseMcmvRatesHtml(html);
    expect(r.faixa3.naoCotista.N_NE).toBeCloseTo(8.16, 2);
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
      rendaMax: { faixa1: 3200, faixa2: 5000, faixa3: 9600, classeMedia: 13000 },
      prazoMaxMeses: 420,
    });
  });
  it("retorna null se a prosa não estiver presente", () => {
    expect(parseMcmvLimits("<p>página sem os limites</p>")).toBeNull();
  });
});

describe("linkTabelaMunicipios", () => {
  it("acha o .xlsx da Caixa na fixture real (e bate com data/mcmv-municipios.json)", () => {
    const link = linkTabelaMunicipios(html);
    expect(link).toBe("https://www.caixa.gov.br/Downloads/fgts-tabela-municipios/TABELA_MUNICIPIOS_VIGENCIA_01JAN2026.xlsx");
    const pub = JSON.parse(readFileSync(fileURLToPath(new URL("../data/mcmv-municipios.json", import.meta.url)), "utf-8"));
    expect(pub.meta.fonteUrl).toBe(link);
  });
  it("null quando o link some", () => {
    expect(linkTabelaMunicipios("<a href='/outra'>x</a>")).toBeNull();
  });
});

describe("data/mcmv-municipios.json (gerado por scripts/mcmv-municipios.py)", () => {
  const pub = JSON.parse(readFileSync(fileURLToPath(new URL("../data/mcmv-municipios.json", import.meta.url)), "utf-8"));
  it("5.570+ municípios únicos, tetos entre 210 mil e 275 mil, ordenados por IBGE", () => {
    const m = pub.municipios as Array<{ ibge: number; tetoFaixa1e2: number }>;
    expect(m.length).toBeGreaterThan(5500);
    expect(new Set(m.map((x) => x.ibge)).size).toBe(m.length);
    expect(m.every((x, i) => i === 0 || x.ibge > m[i - 1].ibge)).toBe(true);
    expect(m.every((x) => x.tetoFaixa1e2 >= 210_000 && x.tetoFaixa1e2 <= 275_000)).toBe(true);
  });
  it("Goiânia 270 mil (B1) e Aparecida 255 mil (B2) — o porte por população daria 275/270", () => {
    const byIbge = new Map(pub.municipios.map((x: { ibge: number }) => [x.ibge, x]));
    expect(byIbge.get(5208707)).toMatchObject({ nome: "Goiânia", recorte: "B", grupo: 1, tetoFaixa1e2: 270000 });
    expect(byIbge.get(5201405)).toMatchObject({ recorte: "B", grupo: 2, tetoFaixa1e2: 255000 });
  });
});
