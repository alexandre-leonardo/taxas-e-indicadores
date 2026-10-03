// src/parser.ts
// Porte 1:1 de engaja-amiz/supabase/functions/financing-rates-sync/parser.ts.
// Parser sem dependência de DOM — roda igual em Node e Vitest.
//
// Âncora "TAXA DE JUROS NOMINAL" isola a tabela de taxas.
// Faixa 2 — janela 300 chars captura os 4 valores do 1º sub-bracket (`faixa2`, legado); as 3
// subfaixas de renda saem em `faixa2Subfaixas`.
// Faixa 3 — 2 valores; cotista === naoCotista (tabela tem uma linha só).
// publishedAt — "Atualizado em DD/MM/YYYY" no rodapé (busca na página inteira).
import type { Faixa2Subfaixa, McmvLimits, ParsedRates } from "./types";

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

/**
 * Linhas da Faixa 2 ("... a R$ 3.500,00 4,75% 5,00% 5,25% 5,50%"): a taxa sobe com a renda.
 * 4 valores = cotista N/NE, S/SE/CO, não cotista N/NE, S/SE/CO; 2 valores = sem distinção de cotista.
 * Qualquer linha fora do formato, teto fora de ordem ou taxa fora de 0–20% → undefined (sem chute).
 */
function parseFaixa2Subfaixas(tableText: string): Faixa2Subfaixa[] | undefined {
  const m = tableText.match(/Faixa\s*2([\s\S]*?)Faixa\s*3/i);
  if (!m) return undefined;
  const rows = [...m[1].matchAll(/a R\$\s*([\d.]+,\d{2})((?:\s*\d{1,2},\d{2}\s*%)+)/g)];
  const out: Faixa2Subfaixa[] = [];
  for (const [, teto, pcts] of rows) {
    const v = (pcts.match(/\d{1,2},\d{2}/g) ?? []).map(pct);
    if (v.length !== 2 && v.length !== 4) return undefined;
    const [cN, cS, nN, nS] = v.length === 4 ? v : [v[0], v[1], v[0], v[1]];
    out.push({ rendaAte: pct(teto), cotista: { N_NE: cN, S_SE_CO: cS }, naoCotista: { N_NE: nN, S_SE_CO: nS } });
  }
  const ok =
    out.length > 0 &&
    out.every((s, i) => i === 0 || s.rendaAte > out[i - 1].rendaAte) &&
    out.flatMap((s) => [...Object.values(s.cotista), ...Object.values(s.naoCotista)]).every((x) => x > 0 && x < 20);
  return ok ? out : undefined;
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
    faixa2Subfaixas: parseFaixa2Subfaixas(tableText),
    faixa3: {
      cotista: { N_NE: f3[0], S_SE_CO: f3[1] },
      naoCotista: { N_NE: f3[0], S_SE_CO: f3[1] },
    },
    classeMedia: cm[0],
    publishedAt: dt ? dt[1] : null,
  };
}

/**
 * Extrai os limites do MCMV (teto por faixa + subsídio máximo por região) da prosa do gov.br.
 * Determinístico (sem LLM). null se qualquer trecho não casar (layout mudou → preserva old no caller).
 * Formatos: "R$ 210 mil" → ×1000; "R$ 65.000,00" → número BR.
 */
export function parseMcmvLimits(html: string): McmvLimits | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const f12 = text.match(/varia de R\$\s*(\d[\d.]*)\s*mil a R\$\s*(\d[\d.]*)\s*mil/i);
  const f3 = text.match(/\(Faixa\s*3\)[^.]*?R\$\s*(\d[\d.]*)\s*mil/i);
  const cm = text.match(/limitado a R\$\s*(\d[\d.]*)\s*mil/i);
  const sub = text.match(
    /at[ée] R\$\s*(\d[\d.]*,\d{2}),?\s*na Regi[ãa]o Norte,\s*e at[ée] R\$\s*(\d[\d.]*,\d{2}),?\s*nas demais/i,
  );
  if (!f12 || !f3 || !cm || !sub) return null;

  const mil = (s: string) => parseInt(s.replace(/\./g, ""), 10) * 1000; // "210" → 210000
  const brl = (s: string) => Math.round(parseFloat(s.replace(/\./g, "").replace(",", "."))); // "65.000,00" → 65000

  return {
    tetoImovel: {
      faixa1e2: { min: mil(f12[1]), max: mil(f12[2]) },
      faixa3: mil(f3[1]),
      classeMedia: mil(cm[1]),
    },
    subsidioMaxPorRegiao: { N: brl(sub[1]), demais: brl(sub[2]) },
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
