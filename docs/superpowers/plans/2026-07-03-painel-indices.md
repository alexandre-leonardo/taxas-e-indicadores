# Painel de Índices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um painel histórico de 10 índices do BCB SGS (mercado imobiliário BR) num arquivo aditivo `data/indices-historico.json`, atualizado mensalmente pela Action semanal — sem tocar no contrato de taxas existente.

**Architecture:** Espelha o motor de taxas atual. I/O de rede em `src/sources.ts` (funções puras de parse já convivem lá, ex.: `parseCotaResponse`); decisão pura e testável em `src/update.ts`; entrypoint fino `src/indices.ts` (lê JSON → busca séries → decide → escreve se mudou). Re-puxa o histórico inteiro a cada rodada (idempotente via `contentHash`), sem lógica incremental. Anti-corrupção preserva dado bom quando o fetch falha.

**Tech Stack:** TypeScript + tsx + Vitest. API pública BCB SGS (`api.bcb.gov.br/dados/serie/bcdata.sgs.{código}`), sem auth.

**Ponytail:** re-puxa tudo (zero merge incremental); poupança (série diária 195) é a única exceção; sem retry dedicado (a rodada semanal é o retry); guardas e anti-corrupção mantidos (validação/perda-de-dado não se corta).

---

## File Structure

- `src/types.ts` (modify) — novos tipos `UnidadeIndice`, `PontoSerie`, `SerieIndice`, `IndicesHistorico`.
- `src/sources.ts` (modify) — `normalizeSgsRows` (pura), `fetchSerieMensal`, `fetchPoupancaMensal`.
- `src/update.ts` (modify) — `isPontoPlausivel`, `mergeSerie`, `decideIndices` (puras).
- `src/indices.ts` (create) — entrypoint: config das 10 séries, lê/busca/decide/escreve.
- `package.json` (modify) — script `"indices"`.
- `data/indices-historico.json` (create) — seed gerado pelo backfill real.
- `test/indices.test.ts` (create) — testes das funções puras.
- `.github/workflows/update-rates.yml` (modify) — passo `npm run indices` + commit/purge do arquivo novo.
- `CLAUDE.md` (modify) — documenta o arquivo novo e a URL pública.

Renome do projeto → `taxas-e-indicadores` é tratado à parte (runbook), fora deste plano.

---

## Task 1: Tipos do painel de índices

**Files:**
- Modify: `src/types.ts` (append)

- [ ] **Step 1: Adicionar os tipos ao final de `src/types.ts`**

```ts
// ── Painel de índices (BCB SGS) — aditivo, arquivo próprio data/indices-historico.json ──
export type UnidadeIndice = "pct_am" | "pct_aa" | "indice";

export interface PontoSerie {
  mes: string; // "YYYY-MM"
  valor: number;
}

export interface SerieIndice {
  nome: string;
  sgs: number;
  unidade: UnidadeIndice;
  serie: PontoSerie[]; // ordenada por mês asc
}

export interface IndicesHistorico {
  schemaVersion: 1;
  indices: Record<string, SerieIndice>;
  meta: {
    fonte: string;
    sourceUrl: string;
    desde: string; // "YYYY-MM"
    atualizadoEm: string; // ISO 8601
    contentHash: string; // sha256 do objeto `indices`
  };
}
```

- [ ] **Step 2: Checar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(indices): tipos do painel de índices (IndicesHistorico)"
```

---

## Task 2: Normalização + fetch das séries SGS

**Files:**
- Modify: `src/sources.ts`
- Test: `test/indices.test.ts` (parte 1)

- [ ] **Step 1: Escrever o teste de `normalizeSgsRows` (falha)**

Criar `test/indices.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeSgsRows } from "../src/sources";

describe("normalizeSgsRows", () => {
  it("converte data DD/MM/AAAA→YYYY-MM e valor string(ponto)→number", () => {
    const rows = [{ data: "01/05/2026", valor: "0.88" }, { data: "01/06/2026", valor: "-0.50" }];
    expect(normalizeSgsRows(rows)).toEqual([
      { mes: "2026-05", valor: 0.88 },
      { mes: "2026-06", valor: -0.5 },
    ]);
  });
  it("descarta linhas sem data/valor ou NaN", () => {
    const rows = [{ data: "01/05/2026", valor: "x" }, { valor: "1" }, { data: "01/07/2026", valor: "1.2" }];
    expect(normalizeSgsRows(rows as any)).toEqual([{ mes: "2026-07", valor: 1.2 }]);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `npx vitest run test/indices.test.ts`
Expected: FAIL (`normalizeSgsRows` não existe).

- [ ] **Step 3: Implementar em `src/sources.ts`**

**Substituir** a linha de import de tipo existente por (adiciona `PontoSerie`, sem duplicar):
```ts
import type { CotaRaw, IndexersRaw, PontoSerie } from "./types";
```

Adicionar ao final do arquivo:
```ts
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
```

- [ ] **Step 4: Rodar — deve passar**

Run: `npx vitest run test/indices.test.ts`
Expected: PASS (3 testes de `normalizeSgsRows`).

- [ ] **Step 5: Commit**

```bash
git add src/sources.ts test/indices.test.ts
git commit -m "feat(indices): normalizeSgsRows + fetch de séries SGS (mensal e poupança)"
```

---

## Task 3: Decisão pura (plausibilidade, merge anti-corrupção, decideIndices)

**Files:**
- Modify: `src/update.ts`
- Test: `test/indices.test.ts` (parte 2)

- [ ] **Step 1: Escrever os testes (falham)**

Acrescentar estes imports ao **topo** de `test/indices.test.ts` (junto aos existentes) e os `describe` ao final:

```ts
import { isPontoPlausivel, mergeSerie, decideIndices } from "../src/update";
import type { IndicesHistorico, PontoSerie, UnidadeIndice } from "../src/types";

describe("isPontoPlausivel", () => {
  it("pct_am: aceita 0.5 e -0.5, rejeita 15 e -20", () => {
    expect(isPontoPlausivel(0.5, "pct_am")).toBe(true);
    expect(isPontoPlausivel(-0.5, "pct_am")).toBe(true);
    expect(isPontoPlausivel(15, "pct_am")).toBe(false);
    expect(isPontoPlausivel(-20, "pct_am")).toBe(false);
  });
  it("indice: aceita 769, rejeita 10", () => {
    expect(isPontoPlausivel(769, "indice")).toBe(true);
    expect(isPontoPlausivel(10, "indice")).toBe(false);
  });
  it("pct_aa: aceita 9.5, rejeita 60", () => {
    expect(isPontoPlausivel(9.5, "pct_aa")).toBe(true);
    expect(isPontoPlausivel(60, "pct_aa")).toBe(false);
  });
});

describe("mergeSerie", () => {
  const u: UnidadeIndice = "pct_am";
  it("ponto buscado válido sobrescreve o anterior; ordena por mês", () => {
    const old: PontoSerie[] = [{ mes: "2026-01", valor: 0.4 }];
    const fetched: PontoSerie[] = [{ mes: "2026-02", valor: 0.5 }, { mes: "2026-01", valor: 0.41 }];
    expect(mergeSerie(old, fetched, u)).toEqual([
      { mes: "2026-01", valor: 0.41 },
      { mes: "2026-02", valor: 0.5 },
    ]);
  });
  it("ponto buscado implausível preserva o anterior", () => {
    const old: PontoSerie[] = [{ mes: "2026-01", valor: 0.4 }];
    const fetched: PontoSerie[] = [{ mes: "2026-01", valor: 999 }];
    expect(mergeSerie(old, fetched, u)).toEqual([{ mes: "2026-01", valor: 0.4 }]);
  });
  it("fetched null preserva toda a série anterior", () => {
    const old: PontoSerie[] = [{ mes: "2026-01", valor: 0.4 }];
    expect(mergeSerie(old, null, u)).toEqual(old);
  });
});

describe("decideIndices", () => {
  const cfg = { ipca: { nome: "IPCA", sgs: 433, unidade: "pct_am" as UnidadeIndice } };
  const vazio: IndicesHistorico = {
    schemaVersion: 1, indices: {},
    meta: { fonte: "", sourceUrl: "", desde: "2001-01", atualizadoEm: "", contentHash: "" },
  };
  const now = new Date("2026-07-03T00:00:00Z");
  it("primeira ingestão → changed=true", () => {
    const r = decideIndices(vazio, { ipca: [{ mes: "2026-05", valor: 0.5 }] }, cfg, now, "u", "2001-01");
    expect(r.changed).toBe(true);
    expect(r.payload.indices.ipca.serie).toEqual([{ mes: "2026-05", valor: 0.5 }]);
  });
  it("mesmo input duas vezes → idempotente (changed=false)", () => {
    const r1 = decideIndices(vazio, { ipca: [{ mes: "2026-05", valor: 0.5 }] }, cfg, now, "u", "2001-01");
    const r2 = decideIndices(r1.payload, { ipca: [{ mes: "2026-05", valor: 0.5 }] }, cfg, now, "u", "2001-01");
    expect(r2.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `npx vitest run test/indices.test.ts`
Expected: FAIL (funções não existem).

- [ ] **Step 3: Implementar em `src/update.ts`**

Estender o import de tipos no topo:
```ts
import type {
  CotaRaw, IndexersRaw, McmvLimits, ParsedRates, RatesPayload,
  IndicesHistorico, PontoSerie, SerieIndice, UnidadeIndice,
} from "./types";
```

Adicionar ao final do arquivo:
```ts
/** Faixas de plausibilidade por unidade (aberto-aberto). Barra hiperinflação/lixo e o número-índice fora de faixa. */
const PLAUS_INDICE: Record<UnidadeIndice, [number, number]> = {
  pct_am: [-10, 10], // IGP-M tem meses negativos e picos ~+4%
  pct_aa: [0, 50], // juros habitacional (~8–14% a.a.)
  indice: [50, 5000], // IVG-R ≈ 769
};

export function isPontoPlausivel(valor: number, unidade: UnidadeIndice): boolean {
  if (typeof valor !== "number" || Number.isNaN(valor)) return false;
  const [lo, hi] = PLAUS_INDICE[unidade];
  return valor > lo && valor < hi;
}

/**
 * Merge anti-corrupção: base = série anterior; cada ponto buscado PLAUSÍVEL sobrescreve o mês.
 * Ponto buscado implausível ou fetched null → preserva o valor anterior (rede nunca destrói dado bom).
 * Retorna ordenada por mês asc.
 */
export function mergeSerie(
  old: PontoSerie[],
  fetched: PontoSerie[] | null,
  unidade: UnidadeIndice,
): PontoSerie[] {
  const map = new Map<string, number>();
  for (const p of old) map.set(p.mes, p.valor);
  if (fetched) {
    for (const p of fetched) if (isPontoPlausivel(p.valor, unidade)) map.set(p.mes, p.valor);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, valor]) => ({ mes, valor }));
}

/**
 * Decide se o histórico mudou. contentHash = sha256(objeto `indices`). Reescreve só se mudou.
 * `fetched` mapeia chave→pontos (ou null se o fetch daquela série falhou).
 */
export function decideIndices(
  old: IndicesHistorico,
  fetched: Record<string, PontoSerie[] | null>,
  config: Record<string, { nome: string; sgs: number; unidade: UnidadeIndice }>,
  now: Date,
  sourceUrl: string,
  desde: string,
): { changed: boolean; payload: IndicesHistorico } {
  const indices: Record<string, SerieIndice> = {};
  for (const [chave, cfg] of Object.entries(config)) {
    const oldSerie = old.indices?.[chave]?.serie ?? [];
    const serie = mergeSerie(oldSerie, fetched[chave] ?? null, cfg.unidade);
    indices[chave] = { nome: cfg.nome, sgs: cfg.sgs, unidade: cfg.unidade, serie };
  }
  const contentHash = sha256(JSON.stringify(indices));
  if (old.meta?.contentHash === contentHash) return { changed: false, payload: old };
  return {
    changed: true,
    payload: {
      schemaVersion: 1,
      indices,
      meta: {
        fonte: "BCB SGS (api.bcb.gov.br)",
        sourceUrl,
        desde,
        atualizadoEm: now.toISOString(),
        contentHash,
      },
    },
  };
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `npx vitest run test/indices.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/update.ts test/indices.test.ts
git commit -m "feat(indices): plausibilidade por unidade + merge anti-corrupção + decideIndices"
```

---

## Task 4: Entrypoint `src/indices.ts` + script npm

**Files:**
- Create: `src/indices.ts`
- Modify: `package.json`

- [ ] **Step 1: Criar `src/indices.ts`**

```ts
// src/indices.ts
// Entrypoint do painel de índices: lê o JSON atual, busca as séries SGS, decide, escreve se mudou.
// Exit 1 só se TODAS as séries falharem (rede fora) — faz a Action alertar. Aditivo: não toca nas taxas.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decideIndices } from "./update";
import { fetchSerieMensal, fetchPoupancaMensal } from "./sources";
import type { IndicesHistorico, PontoSerie, UnidadeIndice } from "./types";

const DATA_PATH = fileURLToPath(new URL("../data/indices-historico.json", import.meta.url));
const DESDE = "2001-01";
const SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

// As 10 séries. Chave estável (contrato); sgs = código BCB SGS; unidade guia guarda e interpretação.
const SERIES: Record<string, { nome: string; sgs: number; unidade: UnidadeIndice }> = {
  tr: { nome: "Taxa Referencial", sgs: 7811, unidade: "pct_am" },
  poupanca: { nome: "Poupança (regra nova)", sgs: 195, unidade: "pct_am" },
  selic: { nome: "Selic acumulada no mês", sgs: 4390, unidade: "pct_am" },
  ipca: { nome: "IPCA", sgs: 433, unidade: "pct_am" },
  igpm: { nome: "IGP-M", sgs: 189, unidade: "pct_am" },
  incc: { nome: "INCC", sgs: 192, unidade: "pct_am" },
  ivgr: { nome: "IVG-R (preço de imóvel residencial)", sgs: 21340, unidade: "indice" },
  // 25497 é % a.m.; 20773 é % a.a. — como o BCB publica (unidades diferentes; a tag `unidade` documenta).
  jurosHabMercado: { nome: "Juros financ. habitacional (mercado, % a.m.)", sgs: 25497, unidade: "pct_am" },
  jurosHabSfh: { nome: "Juros financ. habitacional (SFH, % a.a.)", sgs: 20773, unidade: "pct_aa" },
  cdi: { nome: "CDI acumulado no mês", sgs: 4391, unidade: "pct_am" },
};

function readCurrent(): IndicesHistorico {
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf-8")) as IndicesHistorico;
  } catch {
    // Primeira rodada: sem arquivo → começa vazio (o backfill preenche tudo).
    return { schemaVersion: 1, indices: {}, meta: { fonte: "", sourceUrl: "", desde: DESDE, atualizadoEm: "", contentHash: "" } };
  }
}

function ddmmaaaa(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Janelas de ≤10 anos cobrindo [iniAno/01/01, hoje]. ponytail: só a poupança (série diária) usa. */
function janelas10(iniAno: number, fim: Date): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const fimAno = fim.getUTCFullYear();
  for (let a = iniAno; a <= fimAno; ) {
    const b = Math.min(a + 9, fimAno);
    out.push([`01/01/${a}`, b === fimAno ? ddmmaaaa(fim) : `31/12/${b}`]);
    a = b + 1;
  }
  return out;
}

async function main(): Promise<void> {
  const now = new Date();
  const ini = `01/${DESDE.slice(5)}/${DESDE.slice(0, 4)}`; // "01/01/2001"
  const fim = ddmmaaaa(now);
  const iniAno = Number(DESDE.slice(0, 4));
  const old = readCurrent();

  const fetched: Record<string, PontoSerie[] | null> = {};
  await Promise.all(
    Object.entries(SERIES).map(async ([chave, cfg]) => {
      fetched[chave] =
        cfg.sgs === 195
          ? await fetchPoupancaMensal(janelas10(iniAno, now))
          : await fetchSerieMensal(cfg.sgs, ini, fim);
    }),
  );

  if (Object.values(fetched).every((v) => v == null)) {
    // ponytail: NÃO é erro fatal — evita acoplar a falha do SGS ao commit das taxas (mesmo job).
    // Não escreve; a anti-corrupção preservaria tudo e a rodada semanal seguinte re-puxa.
    console.warn("[indices] todas as séries falharam (rede?) — mantendo o arquivo atual, sem escrever.");
    return;
  }

  const { changed, payload } = decideIndices(old, fetched, SERIES, now, SGS_URL, DESDE);
  if (!changed) {
    console.log("[indices] unchanged — nada a commitar.");
    return;
  }
  writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  const n = Object.values(payload.indices).reduce((s, x) => s + x.serie.length, 0);
  console.log(`[indices] atualizado — ${Object.keys(payload.indices).length} séries, ${n} pontos, desde ${payload.meta.desde}.`);
}

main().catch((e) => {
  console.error("[indices] erro fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Adicionar o script em `package.json`**

Na seção `scripts`, após `"scrape"`:
```json
    "scrape": "tsx src/index.ts",
    "indices": "tsx src/indices.ts",
    "test": "vitest run"
```

- [ ] **Step 3: Checar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/indices.ts package.json
git commit -m "feat(indices): entrypoint src/indices.ts + script npm run indices"
```

---

## Task 5: Backfill real + seed do arquivo

**Files:**
- Create: `data/indices-historico.json` (gerado)

- [ ] **Step 1: Rodar o backfill (busca real na API BCB SGS)**

Run: `npm run indices`
Expected: `[indices] atualizado — 10 séries, N pontos, desde 2001-01.` e criação de `data/indices-historico.json`. Se der 502 (poupança), rodar de novo.

- [ ] **Step 2: Sanidade do arquivo gerado**

Run (ESM, pois o projeto é `"type":"module"`):
```bash
node --input-type=module -e "import fs from 'node:fs';const d=JSON.parse(fs.readFileSync('./data/indices-historico.json','utf8'));for(const k of Object.keys(d.indices)){const a=d.indices[k].serie;console.log(k.padEnd(16),String(a.length).padStart(4),'pts',a[0]?.mes,'→',a[a.length-1]?.mes,'| últ',a[a.length-1]?.valor)}"
```
Expected (ordens de grandeza): macro (ipca/igpm/incc/selic/cdi/tr) ~250–300 pts começando 2001-01; ivgr ~300 pts começando 2001-03; poupanca ~170 pts começando 2012-05; jurosHab* ~180 pts começando 2011-03. Nenhuma série vazia; último valor plausível.

- [ ] **Step 3: Idempotência — segunda rodada não muda nada**

Run: `npm run indices`
Expected: `[indices] unchanged — nada a commitar.` (sem diff em `data/`).

- [ ] **Step 4: Commit do seed**

```bash
git add data/indices-historico.json
git commit -m "data(indices): backfill inicial das 10 séries (desde 2001)"
```

---

## Task 6: Atualização automática (workflow) + docs

**Files:**
- Modify: `.github/workflows/update-rates.yml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Adicionar passo de índices no workflow**

Após o passo `Raspar fontes e atualizar JSON se mudou` (antes do commit), inserir:
```yaml
      - name: Atualizar painel de índices (BCB SGS)
        run: npm run indices
```

- [ ] **Step 2: Estender o passo de commit para os dois arquivos**

Substituir o corpo do passo `Commit + push + purge jsDelivr (se mudou)` por:
```yaml
      - name: Commit + push + purge jsDelivr (se mudou)
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/taxas-financiamento.json data/indices-historico.json
          if git diff --staged --quiet; then
            echo "Sem mudanças (taxas nem índices)."
          else
            PUB=$(jq -r '.meta.publishedAt' data/taxas-financiamento.json)
            RET=$(jq -r '.meta.retrievedAt' data/taxas-financiamento.json)
            git commit -m "chore(data): atualiza taxas/índices (publishedAt $PUB / retrievedAt $RET)"
            git push
            curl -sf "https://purge.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json" || true
            curl -sf "https://purge.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/indices-historico.json" || true
          fi
```

- [ ] **Step 3: Documentar no `CLAUDE.md`**

Na seção "URL pública", acrescentar a segunda URL:
```
`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/indices-historico.json`
```
E um bullet na seção "Como funciona":
```
- O painel de índices (`data/indices-historico.json`, via `npm run indices` → `src/indices.ts`) puxa
  10 séries do BCB SGS (TR, poupança, SELIC, IPCA, IGP-M, INCC, IVG-R, juros habitacional mercado+SFH,
  CDI) desde 2001, re-puxando o histórico inteiro a cada rodada. Guarda por unidade (`isPontoPlausivel`)
  e merge anti-corrupção (`mergeSerie`) preservam dado bom quando o fetch falha.
```

- [ ] **Step 4: Rodar a suíte inteira (nada quebrou)**

Run: `npm test`
Expected: PASS (parser + update + sources + indices).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/update-rates.yml CLAUDE.md
git commit -m "ci+docs(indices): passo no workflow semanal + documenta o painel"
```

---

## Notas de execução

- **URLs do jsDelivr no workflow/docs** usam o nome atual `taxas-financiamento-caixa`. Serão trocadas no runbook de renome (passo separado), não aqui.
- **Ordem determinística das chaves** em `SERIES` garante `contentHash` estável (idempotência). Não reordenar sem querer churn.
- **Anti-corrupção** é o mecanismo que também barra ingestão pré-1995 (hiperinflação) caso `DESDE` recue.
