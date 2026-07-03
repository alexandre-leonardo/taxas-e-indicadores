// src/sources.ts
// I/O de rede isolado. Sem lógica de negócio — só busca e normaliza dados das fontes.
import type { CotaRaw, IndexersRaw, PontoSerie } from "./types";

/** Parser puro do conteúdo do LLM (JSON) → CotaRaw. null se inválido/incompleto. */
export function parseCotaResponse(content: string): CotaRaw | null {
  try {
    const o = JSON.parse(content) as Record<string, unknown>;
    if (typeof o.sac !== "number" || typeof o.price !== "number" || typeof o.fonteUrl !== "string")
      return null;
    return { sac: o.sac, price: o.price, fonteUrl: o.fonteUrl };
  } catch {
    return null;
  }
}

export const SOURCE_URL =
  process.env.GOVBR_URL ??
  "https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/mcmv-fgts";

const BCB_BASE = process.env.BCB_BASE ?? "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

const OPENROUTER_BASE = process.env.OPENROUTER_BASE ?? "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

const COTA_PROMPT =
  "Você é um verificador de dados oficiais. Descubra a cota máxima de financiamento imobiliário " +
  "SBPE da Caixa Econômica Federal ATUALMENTE VIGENTE, para os sistemas SAC e Price (Tabela Price) " +
  "— o percentual máximo do valor do imóvel que pode ser financiado.\n" +
  "REGRAS:\n" +
  "- Confirme o valor em FONTE OFICIAL: domínio caixa.gov.br (inclui caixanoticias.caixa.gov.br) " +
  "ou gov.br. NÃO aceite blogs, imobiliárias ou portais comerciais como fonte.\n" +
  "- fonteUrl DEVE ser a URL oficial onde o número aparece. Se não conseguir confirmar em fonte " +
  "oficial, retorne sac/price com os valores mais prováveis e fonteUrl como string vazia.\n" +
  "Busque na web quantas vezes precisar para achar a fonte oficial.";

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

/**
 * Extrai a cota máxima SBPE (SAC/Price) via OpenRouter com web search.
 * Nunca lança: sem OPENROUTER_API_KEY, erro de rede, status não-2xx ou parse inválido → null.
 */
export async function fetchCotaMaxima(): Promise<CotaRaw | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/alexandre-leonardo/taxas-financiamento-caixa",
        "X-Title": "taxas-financiamento-caixa",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        plugins: [{ id: "web", max_results: 10 }],
        messages: [{ role: "user", content: COTA_PROMPT }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "cota_maxima",
            strict: true,
            schema: {
              type: "object",
              properties: {
                sac: { type: "number" },
                price: { type: "number" },
                fonteUrl: { type: "string" },
              },
              required: ["sac", "price", "fonteUrl"],
              additionalProperties: false,
            },
          },
        },
        temperature: 0,
        max_tokens: 600,
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j?.choices?.[0]?.message?.content;
    return content ? parseCotaResponse(content) : null;
  } catch {
    return null;
  }
}

/**
 * Normaliza linhas cruas do SGS → pontos mensais. Pura (testável isolada, como parseCotaResponse).
 * data "DD/MM/AAAA" → mes "YYYY-MM"; valor string com ponto decimal → number (negativos ocorrem).
 */
export function normalizeSgsRows(rows: Array<{ data?: string; valor?: string }>): PontoSerie[] {
  const out: PontoSerie[] = [];
  for (const r of rows ?? []) {
    if (!r?.data || r.valor == null) continue;
    const [dd, mm, yyyy] = r.data.split("/");
    if (!dd || !mm || !yyyy) continue;
    const valor = parseFloat(String(r.valor).replace(",", "."));
    if (Number.isNaN(valor)) continue;
    out.push({ mes: `${yyyy}-${mm}`, valor });
  }
  return out;
}

/** Busca cru de um intervalo de série SGS. null em erro. Datas "DD/MM/AAAA". */
async function fetchSgsRange(
  sgs: number,
  ini: string,
  fim: string,
): Promise<Array<{ data?: string; valor?: string }> | null> {
  try {
    const url = `${BCB_BASE}.${sgs}/dados?formato=json&dataInicial=${ini}&dataFinal=${fim}`;
    const res = await fetch(url, { headers: { "User-Agent": "AmizSim/1.0" } });
    if (!res.ok) return null;
    return (await res.json()) as Array<{ data?: string; valor?: string }>;
  } catch {
    return null;
  }
}

/** Histórico de uma série MENSAL do SGS (um request — mensais não têm cap de janela). null em erro. */
export async function fetchSerieMensal(sgs: number, ini: string, fim: string): Promise<PontoSerie[] | null> {
  const rows = await fetchSgsRange(sgs, ini, fim);
  return rows ? normalizeSgsRows(rows) : null;
}

/**
 * Poupança (série 195): diária/aniversário, com cap de 10 anos por request.
 * ponytail: única série que precisa de janelamento; busca em janelas ≤10a e colapsa para
 * 1 ponto/mês (o PRIMEIRO registro de cada mês — a série vem em ordem cronológica). Robusto:
 * não assume que exista registro no dia 01. Retorna null só se TODAS as janelas falharem.
 */
export async function fetchPoupancaMensal(janelas: Array<[string, string]>): Promise<PontoSerie[] | null> {
  const partes = await Promise.all(janelas.map(([i, f]) => fetchSgsRange(195, i, f)));
  if (partes.every((p) => p == null)) return null;
  const pontos = normalizeSgsRows(partes.flatMap((p) => p ?? []));
  const porMes = new Map<string, number>();
  for (const p of pontos) if (!porMes.has(p.mes)) porMes.set(p.mes, p.valor); // primeiro do mês vence
  return [...porMes.entries()].map(([mes, valor]) => ({ mes, valor }));
}
