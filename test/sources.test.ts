// test/sources.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { avaliarAlertaCota, sinalizarFalhaBcb } from "../src/sources";
import { COTA_VIGENTE } from "../src/update";

describe("sinalizarFalhaBcb", () => {
  it("anexa BCB_FALHOU=1 ao arquivo do GITHUB_ENV (o step final do workflow depende disso)", () => {
    const env = join(mkdtempSync(join(tmpdir(), "gh-env-")), "env");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    sinalizarFalhaBcb("x", env);
    sinalizarFalhaBcb("y", env);
    expect(readFileSync(env, "utf-8")).toBe("BCB_FALHOU=1\nBCB_FALHOU=1\n");
    expect(err).toHaveBeenCalledWith("::error::x");
    err.mockRestore();
  });
});

describe("avaliarAlertaCota", () => {
  const ok = {
    mudou: true,
    sac: 70,
    price: 50,
    dataPublicacao: "2026-11-05",
    url: "https://g1.globo.com/x",
    trecho: "A Caixa reduziu a cota para 70% no SAC e 50% na Price.",
  };
  const r = (o: object) => avaliarAlertaCota(JSON.stringify(o), COTA_VIGENTE);

  it("aceita alerta crível", () => {
    expect(r(ok)).toEqual({ sac: 70, price: 50, url: ok.url, trecho: ok.trecho, dataPublicacao: "2026-11-05" });
  });
  it("mudou:false → null", () => {
    expect(r({ ...ok, mudou: false })).toBeNull();
  });
  it("notícia anterior ou igual à vigência atual → null (o caso 70/50 de 2024)", () => {
    expect(r({ ...ok, dataPublicacao: "2024-11-01" })).toBeNull();
    expect(r({ ...ok, dataPublicacao: COTA_VIGENTE.atualizadoEm.slice(0, 10) })).toBeNull();
  });
  it("mesmos percentuais da vigente → null", () => {
    expect(r({ ...ok, sac: 80, price: 70, trecho: "80% e 70%" })).toBeNull();
  });
  it("trecho sem os números → null", () => {
    expect(r({ ...ok, trecho: "A Caixa mudou as regras." })).toBeNull();
  });
  it("URL inválida, data inválida, percentual fora de 0–100 ou JSON quebrado → null", () => {
    expect(r({ ...ok, url: "" })).toBeNull();
    expect(r({ ...ok, dataPublicacao: "ontem" })).toBeNull();
    expect(r({ ...ok, sac: 120, trecho: "120% e 50%" })).toBeNull();
    expect(avaliarAlertaCota("isto não é json", COTA_VIGENTE)).toBeNull();
  });
});
