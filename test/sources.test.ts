// test/sources.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { avaliarAlertaCota, avaliarAlertaSbpeBalcao, sinalizarFalhaBcb } from "../src/sources";
import { COTA_VIGENTE, SBPE_BALCAO_VIGENTE } from "../src/update";

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

describe("avaliarAlertaSbpeBalcao", () => {
  // Vigente: 11,49 sem / 11,19 com relacionamento, conferida em 2026-10-03.
  const ok = {
    mudou: true,
    semRelacionamento: 11.99,
    comRelacionamento: 11.69,
    dataPublicacao: "2026-11-10",
    url: "https://valor.globo.com/x",
    trecho: "A Caixa elevou a taxa do SBPE para 11,99% sem relacionamento e 11,69% com relacionamento.",
  };
  const r = (o: object) => avaliarAlertaSbpeBalcao(JSON.stringify(o), SBPE_BALCAO_VIGENTE);

  it("aceita alerta crível", () => {
    expect(r(ok)).toMatchObject({ semRelacionamento: 11.99, comRelacionamento: 11.69, url: ok.url });
  });
  it("notícia que só traz uma taxa (a outra repete a vigente) é aceita se a nova estiver no trecho", () => {
    expect(r({ ...ok, semRelacionamento: 11.49, comRelacionamento: 10.99, trecho: "Taxas a partir de 10,99% a.a. + TR." })).not.toBeNull();
  });
  it("taxas iguais às vigentes (blog repetindo 11,19) → null", () => {
    expect(r({ ...ok, semRelacionamento: 11.49, comRelacionamento: 11.19, trecho: "a partir de 11,19%" })).toBeNull();
  });
  it("taxa nova ausente do trecho → null", () => {
    expect(r({ ...ok, trecho: "A Caixa mudou as taxas do SBPE." })).toBeNull();
  });
  it("notícia não posterior à conferência → null", () => {
    expect(r({ ...ok, dataPublicacao: "2026-05-01" })).toBeNull();
    expect(r({ ...ok, dataPublicacao: "2026-10-03" })).toBeNull();
  });
  it("com relacionamento > sem, taxa fora de 0–30, mudou:false ou JSON quebrado → null", () => {
    expect(r({ ...ok, semRelacionamento: 11.69, comRelacionamento: 11.99 })).toBeNull();
    expect(r({ ...ok, semRelacionamento: 45, trecho: "45,00% e 11,69%" })).toBeNull();
    expect(r({ ...ok, mudou: false })).toBeNull();
    expect(avaliarAlertaSbpeBalcao("{", SBPE_BALCAO_VIGENTE)).toBeNull();
  });
});
