// test/sources.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCotaResponse, sinalizarFalhaBcb } from "../src/sources";

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

describe("parseCotaResponse", () => {
  it("extrai CotaRaw de JSON válido", () => {
    const c = parseCotaResponse('{"sac":80,"price":70,"fonteUrl":"https://x.gov.br"}');
    expect(c).toEqual({ sac: 80, price: 70, fonteUrl: "https://x.gov.br" });
  });
  it("retorna null para JSON inválido", () => {
    expect(parseCotaResponse("isto não é json")).toBeNull();
  });
  it("retorna null se faltar campo", () => {
    expect(parseCotaResponse('{"sac":80,"price":70}')).toBeNull();
  });
  it("retorna null se sac não for número", () => {
    expect(parseCotaResponse('{"sac":"80","price":70,"fonteUrl":"https://x.gov.br"}')).toBeNull();
  });
});
