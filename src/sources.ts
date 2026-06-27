// src/sources.ts
// I/O de rede isolado. Sem lógica de negócio — só busca e normaliza dados das fontes.
import type { IndexersRaw } from "./types";

export const SOURCE_URL =
  process.env.GOVBR_URL ??
  "https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/mcmv-fgts";

const BCB_BASE = process.env.BCB_BASE ?? "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

/** Baixa o HTML da página MCMV do gov.br. Lança em status não-2xx. */
export async function fetchGovBrHtml(): Promise<string> {
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AmizSim/1.0)" },
  });
  if (!res.ok) throw new Error(`gov.br HTTP ${res.status}`);
  return res.text();
}

/**
 * Última observação de uma série SGS do BCB (valor mensal %).
 * Séries: 7811 (TR mensal), 195 (poupança mensal %).
 * Retorna null em qualquer erro (rede/parse/campo ausente) — nunca lança.
 */
export async function fetchBcbMonthly(serie: number): Promise<number | null> {
  try {
    const res = await fetch(`${BCB_BASE}.${serie}/dados/ultimos/1?formato=json`, {
      headers: { "User-Agent": "AmizSim/1.0" },
    });
    const j = (await res.json()) as Array<{ valor?: string }>;
    const v = j?.[0]?.valor;
    return v != null ? parseFloat(String(v).replace(",", ".")) : null;
  } catch {
    return null;
  }
}

/** Conveniência: busca os dois indexadores em paralelo. */
export async function fetchIndexers(): Promise<IndexersRaw> {
  const [trRaw, poupRaw] = await Promise.all([fetchBcbMonthly(7811), fetchBcbMonthly(195)]);
  return { trRaw, poupRaw };
}
