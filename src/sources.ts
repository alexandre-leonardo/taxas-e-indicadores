// src/sources.ts
// I/O de rede isolado. Sem lógica de negócio — só busca e normaliza dados das fontes.
import { appendFileSync } from "node:fs";
import type { AlertaCota, CotaMaxima, IndexersRaw, PontoSerie } from "./types";

/**
 * Parser puro da resposta do vigia (JSON do LLM) → AlertaCota, ou null se não for um alerta crível.
 * Crível = mudou:true, URL http(s), notícia publicada DEPOIS da vigência atual, percentuais novos
 * (≠ atuais, 0–100) e trecho que contém os dois números. Alucinação aqui custa só um alarme falso
 * (vira issue para revisão humana) — nunca publica número.
 */
export function avaliarAlertaCota(content: string, atual: CotaMaxima): AlertaCota | null {
  try {
    const o = JSON.parse(content) as Record<string, unknown>;
    if (o.mudou !== true) return null;
    const { sac, price, url, trecho, dataPublicacao } = o;
    if (typeof sac !== "number" || typeof price !== "number") return null;
    if (typeof url !== "string" || typeof trecho !== "string" || typeof dataPublicacao !== "string") return null;
    if (!/^https?:\/\//.test(url)) return null;
    if (!(sac > 0 && sac <= 100 && price > 0 && price <= 100)) return null;
    if (sac === atual.sbpe.sac && price === atual.sbpe.price) return null;
    const pub = Date.parse(dataPublicacao);
    if (Number.isNaN(pub) || pub <= Date.parse(atual.atualizadoEm)) return null;
    if (!trecho.includes(String(sac)) || !trecho.includes(String(price))) return null;
    return { sac, price, url, trecho, dataPublicacao };
  } catch {
    return null;
  }
}

/**
 * Sinaliza falha do BCB sem abortar (o valor anterior é preservado e o commit segue).
 * Na Action: anotação ::error:: + BCB_FALHOU=1 em $GITHUB_ENV — o último step do workflow
 * lê a marca e deixa a run vermelha DEPOIS do commit. Fora da Action: só loga.
 */
export function sinalizarFalhaBcb(msg: string, githubEnv = process.env.GITHUB_ENV): void {
  console.error(`::error::${msg}`);
  if (githubEnv) appendFileSync(githubEnv, "BCB_FALHOU=1\n");
}

export const SOURCE_URL =
  process.env.GOVBR_URL ??
  "https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/mcmv-fgts";

const BCB_BASE = process.env.BCB_BASE ?? "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

const OPENROUTER_BASE = process.env.OPENROUTER_BASE ?? "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

// O LLM NÃO informa a cota (inventava 70/50 citando um FAQ que só diz "até 90%"). Ele só vigia:
// procura notícia de mudança posterior à vigência atual; achou → issue para revisão humana.
function vigiaPrompt(atual: CotaMaxima): string {
  const desde = new Date(atual.atualizadoEm).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return (
    "Você é um vigia de mudanças regulatórias. A cota máxima de financiamento imobiliário SBPE da " +
    `Caixa Econômica Federal vigente é SAC ${atual.sbpe.sac}% / Price ${atual.sbpe.price}% desde ${desde}.\n` +
    `Busque na web notícias PUBLICADAS DEPOIS de ${desde} que anunciem ALTERAÇÃO desses percentuais ` +
    "(Caixa, gov.br ou imprensa de grande circulação).\n" +
    "REGRAS:\n" +
    "- Responda mudou=true SOMENTE se encontrou a notícia nesta busca. Nunca responda de memória.\n" +
    "- url = endereço da notícia; dataPublicacao = data da notícia (AAAA-MM-DD); trecho = frase " +
    "LITERAL da notícia contendo os novos percentuais; sac/price = os novos percentuais.\n" +
    "- Se não encontrar mudança, responda mudou=false, sac=0, price=0 e os textos vazios."
  );
}

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
 * Vigia da cota SBPE via OpenRouter com web search. Retorna um alerta crível ou null.
 * Nunca lança: sem OPENROUTER_API_KEY, erro de rede, status não-2xx ou resposta não crível → null.
 */
export async function vigiarCota(atual: CotaMaxima): Promise<AlertaCota | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/alexandre-leonardo/taxas-e-indicadores",
        "X-Title": "taxas-e-indicadores",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        plugins: [{ id: "web", max_results: 10 }],
        messages: [{ role: "user", content: vigiaPrompt(atual) }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "vigia_cota",
            strict: true,
            schema: {
              type: "object",
              properties: {
                mudou: { type: "boolean" },
                sac: { type: "number" },
                price: { type: "number" },
                dataPublicacao: { type: "string" },
                url: { type: "string" },
                trecho: { type: "string" },
              },
              required: ["mudou", "sac", "price", "dataPublicacao", "url", "trecho"],
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
    return content ? avaliarAlertaCota(content, atual) : null;
  } catch {
    return null;
  }
}

/**
 * Normaliza linhas cruas do SGS → pontos mensais. Pura (testável isolada, como avaliarAlertaCota).
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
