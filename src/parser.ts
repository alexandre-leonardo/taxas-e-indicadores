// src/parser.ts
// Porte 1:1 de engaja-amiz/supabase/functions/financing-rates-sync/parser.ts.
// Parser sem dependência de DOM — roda igual em Node e Vitest.
//
// Âncora "TAXA DE JUROS NOMINAL" isola a tabela de taxas.
// Faixa 2 — janela 300 chars captura os 4 valores do 1º sub-bracket.
// Faixa 3 — 2 valores; cotista === naoCotista (tabela tem uma linha só).
// publishedAt — "Atualizado em DD/MM/YYYY" no rodapé (busca na página inteira).
import type { ParsedRates } from "./types";

/** "4,75%" → 4.75 */
function pct(raw: string): number {
  return parseFloat(raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
}

/** Acha `label` em `text` e extrai os primeiros `count` tokens de % na janela seguinte. */
function pctsAfter(text: string, label: RegExp, count: number, windowSize = 600): number[] {
  const idx = text.search(label);
  if (idx < 0) return [];
  const slice = text.slice(idx, idx + windowSize);
  const matches = slice.match(/\d{1,2},\d{2}\s*%/g) || [];
  return matches.slice(0, count).map(pct);
}

export function parseMcmvRatesHtml(html: string): ParsedRates {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const tableStart = text.search(/TAXA DE JUROS\s+NOMINAL/i);
  const tableText = tableStart >= 0 ? text.slice(tableStart, tableStart + 1200) : text;

  // Faixa 2 — [cotista N_NE, cotista S_SE_CO, naoCotista N_NE, naoCotista S_SE_CO]
  const f2 = pctsAfter(tableText, /Faixa\s*2/i, 4, 300);
  // Faixa 3 — [N_NE, S_SE_CO]; cotista === naoCotista
  const f3 = pctsAfter(tableText, /Faixa\s*3/i, 2);
  // Classe Média — taxa única
  const cm = pctsAfter(tableText, /Classe\s*M[eé]dia/i, 1);

  const dt = text.match(/atualizad[oa][^\/\d]{0,20}(\d{2}\/\d{2}\/\d{4})/i);

  return {
    faixa2: {
      cotista: { N_NE: f2[0], S_SE_CO: f2[1] },
      naoCotista: { N_NE: f2[2], S_SE_CO: f2[3] },
    },
    faixa3: {
      cotista: { N_NE: f3[0], S_SE_CO: f3[1] },
      naoCotista: { N_NE: f3[0], S_SE_CO: f3[1] },
    },
    classeMedia: cm[0],
    publishedAt: dt ? dt[1] : null,
  };
}

export function isPlausible(r: ParsedRates): boolean {
  if (!r?.faixa2 || !r?.faixa3) return false;
  const vals = [
    r.faixa2?.cotista?.N_NE,
    r.faixa2?.cotista?.S_SE_CO,
    r.faixa2?.naoCotista?.N_NE,
    r.faixa2?.naoCotista?.S_SE_CO,
    r.faixa3?.cotista?.N_NE,
    r.faixa3?.cotista?.S_SE_CO,
    r.classeMedia,
  ];
  if (vals.some((v) => typeof v !== "number" || Number.isNaN(v))) return false;
  return vals.every((v) => v > 0 && v < 20);
}
