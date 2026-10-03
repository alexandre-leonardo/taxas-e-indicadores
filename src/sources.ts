// src/sources.ts
// I/O de rede isolado. Sem lógica de negócio — só busca e normaliza dados das fontes.
import { appendFileSync } from "node:fs";
import type { AlertaCota, AlertaSbpeBalcao, CotaMaxima, IndexersRaw, PontoSerie, SbpeBalcao } from "./types";

/**
 * Critérios comuns a todo alerta de vigia: mudou:true, URL http(s), notícia datada DEPOIS de
 * `desdeIso` e trecho literal. null se faltar algo. Alucinação nos vigias custa só um alarme falso
 * (vira issue para revisão humana) — nenhum vigia publica número.
 */
function alertaBase(o: Record<string, unknown>, desdeIso: string): { url: string; trecho: string; dataPublicacao: string } | null {
  const { mudou, url, trecho, dataPublicacao } = o;
  if (mudou !== true) return null;
  if (typeof url !== "string" || typeof trecho !== "string" || typeof dataPublicacao !== "string") return null;
  if (!/^https?:\/\//.test(url) || !trecho.trim()) return null;
  const pub = Date.parse(dataPublicacao);
  if (Number.isNaN(pub) || pub <= Date.parse(desdeIso)) return null;
  return { url, trecho, dataPublicacao };
}

/** O trecho cita o número? Aceita "11,49", "11.49" e, para inteiros, "80". */
function citaNumero(trecho: string, n: number): boolean {
  return [String(n), n.toFixed(2), n.toFixed(2).replace(".", ",")].some((f) => trecho.includes(f));
}

/** Resposta do vigia da cota → AlertaCota crível (percentuais novos, 0–100, citados no trecho) ou null. */
export function avaliarAlertaCota(content: string, atual: CotaMaxima): AlertaCota | null {
  try {
    const o = JSON.parse(content) as Record<string, unknown>;
    const base = alertaBase(o, atual.atualizadoEm);
    const { sac, price } = o;
    if (!base || typeof sac !== "number" || typeof price !== "number") return null;
    if (!(sac > 0 && sac <= 100 && price > 0 && price <= 100)) return null;
    if (sac === atual.sbpe.sac && price === atual.sbpe.price) return null;
    if (!citaNumero(base.trecho, sac) || !citaNumero(base.trecho, price)) return null;
    return { sac, price, ...base };
  } catch {
    return null;
  }
}

/**
 * Resposta do vigia da taxa de balcão SFH → alerta crível ou null. Crível = taxas em 0–30% a.a.,
 * com relacionamento ≤ sem, ao menos uma diferente da vigente, e TODA taxa que mudou citada no trecho
 * (notícia que só traz o "a partir de" pode repetir a outra taxa vigente).
 */
export function avaliarAlertaSbpeBalcao(content: string, atual: SbpeBalcao): AlertaSbpeBalcao | null {
  try {
    const o = JSON.parse(content) as Record<string, unknown>;
    const base = alertaBase(o, atual.verificadoEm);
    const { semRelacionamento: sem, comRelacionamento: com } = o;
    if (!base || typeof sem !== "number" || typeof com !== "number") return null;
    if (!(sem > 0 && sem < 30 && com > 0 && com < 30 && com <= sem)) return null;
    const vig = atual.sfh.efetivaAnualPct;
    const mudaram = [sem !== vig.semRelacionamento && sem, com !== vig.comRelacionamento && com].filter(
      (x): x is number => typeof x === "number",
    );
    if (!mudaram.length || !mudaram.every((n) => citaNumero(base.trecho, n))) return null;
    return { semRelacionamento: sem, comRelacionamento: com, ...base };
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

// Os LLMs NÃO informam números (inventavam a cota 70/50 citando um FAQ que só diz "até 90%").
// Eles só vigiam: procuram notícia de mudança posterior à data do valor atual; achou → issue.
const REGRAS_VIGIA =
  "REGRAS:\n" +
  "- Responda mudou=true SOMENTE se encontrou a notícia nesta busca. Nunca responda de memória.\n" +
  "- url = endereço da notícia; dataPublicacao = data da notícia (AAAA-MM-DD); trecho = frase " +
  "LITERAL da notícia contendo os novos números.\n" +
  "- Se não encontrar mudança, responda mudou=false, números 0 e textos vazios.";

const dataBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });

function promptCota(atual: CotaMaxima): string {
  const desde = dataBr(atual.atualizadoEm);
  return (
    "Você é um vigia de mudanças regulatórias. A cota máxima de financiamento imobiliário SBPE da " +
    `Caixa Econômica Federal vigente é SAC ${atual.sbpe.sac}% / Price ${atual.sbpe.price}% desde ${desde}.\n` +
    `Busque na web notícias PUBLICADAS DEPOIS de ${desde} que anunciem ALTERAÇÃO desses percentuais ` +
    "(Caixa, gov.br ou imprensa de grande circulação). sac/price = os novos percentuais.\n" +
    REGRAS_VIGIA
  );
}

function promptSbpeBalcao(atual: SbpeBalcao): string {
  const desde = dataBr(atual.verificadoEm);
  const v = atual.sfh.efetivaAnualPct;
  return (
    "Você é um vigia de mudanças em taxas de juros. A taxa de balcão do financiamento imobiliário da " +
    "Caixa Econômica Federal com recursos da poupança (SBPE), no SFH, conferida em " +
    `${desde}, é ${v.semRelacionamento}% a.a. + TR para cliente SEM relacionamento e ` +
    `${v.comRelacionamento}% a.a. + TR COM relacionamento (taxas efetivas).\n` +
    `Busque na web notícias PUBLICADAS DEPOIS de ${desde} que anunciem ALTERAÇÃO dessas taxas ` +
    "(Caixa, gov.br ou imprensa de grande circulação). semRelacionamento/comRelacionamento = as novas " +
    "taxas efetivas % a.a.; se a notícia só trouxer uma delas, repita a vigente na outra.\n" +
    REGRAS_VIGIA
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
 * Uma chamada de vigia ao OpenRouter (web search, JSON estrito). Devolve o conteúdo cru ou null,
 * deixando no log o motivo de não ter rodado. Nunca lança.
 * `numeros` = campos numéricos específicos do vigia (além de mudou/dataPublicacao/url/trecho).
 */
async function chamarVigia(nome: string, prompt: string, numeros: string[]): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.log(`[vigia:${nome}] sem OPENROUTER_API_KEY — vigia não rodou.`);
    return null;
  }
  const campos = ["mudou", ...numeros, "dataPublicacao", "url", "trecho"];
  const tipo = (c: string) => (c === "mudou" ? "boolean" : numeros.includes(c) ? "number" : "string");
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
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: `vigia_${nome.replace(/-/g, "_")}`,
            strict: true,
            schema: {
              type: "object",
              properties: Object.fromEntries(campos.map((c) => [c, { type: tipo(c) }])),
              required: campos,
              additionalProperties: false,
            },
          },
        },
        temperature: 0,
        max_tokens: 600,
      }),
    });
    if (!res.ok) {
      console.warn(`::warning::[vigia:${nome}] OpenRouter HTTP ${res.status} — vigia não rodou.`);
      return null;
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j?.choices?.[0]?.message?.content;
    if (!content) console.warn(`::warning::[vigia:${nome}] resposta do OpenRouter sem conteúdo — vigia não rodou.`);
    return content ?? null;
  } catch (e) {
    console.warn(`::warning::[vigia:${nome}] erro na chamada ao OpenRouter: ${String(e)} — vigia não rodou.`);
    return null;
  }
}

/** Roda um vigia e filtra a resposta. Loga a resposta descartada (audita alucinação × notícia real). */
async function vigiar<T>(nome: string, prompt: string, numeros: string[], avaliar: (c: string) => T | null): Promise<T | null> {
  const content = await chamarVigia(nome, prompt, numeros);
  if (!content) return null;
  const alerta = avaliar(content);
  if (!alerta) console.log(`[vigia:${nome}] nenhuma mudança crível. Resposta do LLM: ${content}`);
  return alerta;
}

/** Vigia da cota SBPE. Alerta crível ou null. */
export function vigiarCota(atual: CotaMaxima): Promise<AlertaCota | null> {
  return vigiar("cota-sbpe", promptCota(atual), ["sac", "price"], (c) => avaliarAlertaCota(c, atual));
}

/** Vigia da taxa de balcão SFH. Alerta crível ou null. */
export function vigiarSbpeBalcao(atual: SbpeBalcao): Promise<AlertaSbpeBalcao | null> {
  return vigiar("sbpe-balcao", promptSbpeBalcao(atual), ["semRelacionamento", "comRelacionamento"], (c) =>
    avaliarAlertaSbpeBalcao(c, atual),
  );
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
