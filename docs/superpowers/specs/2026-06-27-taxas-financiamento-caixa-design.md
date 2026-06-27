# Spec — `taxas-financiamento-caixa` (motor de taxas compartilhado)

- **Data:** 2026-06-27
- **Autor:** Alexandre Leonardo (Amiz) + Claude
- **Status:** Aprovado para implementação
- **Repo alvo:** `github.com/alexandre-leonardo/taxas-financiamento-caixa` (público)

---

## 1. Problema e objetivo

Hoje a lógica que descobre as taxas de financiamento imobiliário (MCMV/SBPE) mora dentro do
`engaja-amiz` (Edge Functions Deno + tabela Supabase). Vários apps da Amiz precisam dessas
taxas, mas só o engaja sabe buscá-las.

**Objetivo:** extrair essa lógica para um serviço **neutro, público e de custo zero** que seja a
**fonte única de verdade** das taxas. Qualquer app consome um JSON estável via CDN, sem depender
do engaja nem de banco de dados.

### Não-objetivos (fora de escopo desta entrega)

- Editar os repos consumidores (`projeto-simuladores`, `engaja-amiz`) — apenas **documentar** a
  migração. A edição é etapa posterior.
- Decomissionar o endpoint Supabase atual (`get-financing-rates`) — fica no ar como referência.
- Qualquer UI nova. Este projeto é só dados + automação.

---

## 2. Decisões de arquitetura (fechadas)

| Tema | Decisão |
|------|---------|
| Hospedagem do dado | JSON versionado no git + servido via **jsDelivr CDN**. Sem Cloudflare/Supabase/DB. |
| Atualização | **GitHub Action** agendada (semanal) + `workflow_dispatch`. Commita só quando muda. |
| "Banco" | O arquivo `data/taxas-financiamento.json` versionado. Cada commit = uma versão auditável. |
| Resiliência | Consumidores caem em **seed embutido** se o `fetch` falhar. |
| Contrato | **Idêntico** ao que o engaja usa hoje (`RatesPayload`). Não muda nada para os consumidores. |
| Custo | **R$ 0** (repo público → Actions grátis; jsDelivr grátis). |
| Indexadores BCB | Atualizar **mensalmente** (entram no gatilho de mudança), com **guarda anti-zero**. |
| Stack | **TypeScript + tsx + Vitest**. Sem etapa de build (tsx roda o `.ts` direto). |
| `rulesStale` por idade | **Cliente calcula** (helper no README). O serviço serve o JSON cru. |
| Licença | **MIT** (dado público do gov.br). |

---

## 3. Arquitetura

```
GitHub Action (cron seg 08h BRT + workflow_dispatch manual)
   └─ tsx src/index.ts
        ├─ fetch gov.br ──────► parser.ts ──► ParsedRates
        ├─ fetch BCB 7811/195 ─► indexers (com guarda anti-zero)
        ├─ decideUpdate(old, parsed, indexers, now) ──► { changed, payload }
        └─ se changed: escreve data/taxas-financiamento.json
   └─ git add data/ && git diff --staged --quiet || (commit + push + purge jsDelivr)
                              │
        consumidores ◄── fetch CDN jsDelivr ── (fallback: seed embutido)
```

### Fonte de dados (replicar o que o engaja faz)

- **gov.br MCMV** (tabela de taxas):
  `https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/mcmv-fgts`
- **BCB SGS** (indexadores mensais):
  - série **7811** — Taxa Referencial (TR) mensal
  - série **195** — Remuneração básica da poupança (mensal, %)
  - `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados/ultimos/1?formato=json`

---

## 4. Estrutura do repositório

```
taxas-financiamento-caixa/
├─ .github/workflows/update-rates.yml   # cron + workflow_dispatch + commit condicional + purge
├─ data/taxas-financiamento.json        # o "banco" (servido via jsDelivr) — semeado no v0.1.0
├─ src/
│  ├─ types.ts        # RatesPayload, ParsedRates, Indexers (contrato — idêntico ao engaja)
│  ├─ parser.ts       # porte 1:1 do parser do engaja (puro, sem DOM)
│  ├─ sources.ts      # I/O de rede: fetchGovBrHtml(), fetchBcbMonthly(serie)
│  ├─ update.ts       # PURO: sha256, decideUpdate(), buildPayload() — guarda anti-zero
│  └─ index.ts        # orquestra: lê arquivo → sources → decideUpdate → escreve → exit code
├─ test/
│  ├─ parser.test.ts  # porte do teste do engaja + layout quebrado/implausível
│  ├─ update.test.ts  # decideUpdate: sem old / faixas mudaram / só indexers / nada / BCB=0
│  └─ fixtures/mcmv-govbr.html   # fixture real (~174 KB) copiada do engaja (somente leitura)
├─ package.json
├─ tsconfig.json
├─ .env.example       # documenta: SEM segredos. Overrides opcionais p/ teste (GOVBR_URL, BCB_BASE)
├─ .claude/settings.json
├─ CLAUDE.md
├─ README.md
└─ LICENSE            # MIT
```

---

## 5. Módulos e responsabilidades (isolamento)

Cada unidade tem um propósito, interface clara e dependências explícitas.

### `src/types.ts`
Define o contrato. **Idêntico** ao `RatesPayload` do engaja (`src/lib/financing/finance/rate.ts`).

```ts
export type RateRegion = "N_NE" | "S_SE_CO";
export interface RateByCotistaRegion {
  cotista: Record<RateRegion, number>;
  naoCotista: Record<RateRegion, number>;
}
export interface RatesPayload {
  faixa2: RateByCotistaRegion;
  faixa3: RateByCotistaRegion;
  classeMedia: number;
  indexers: { trMonthlyPct: number; poupancaMonthlyPct: number };
  meta: {
    sourceUrl: string;
    sourceName: string;
    retrievedAt: string;     // ISO
    publishedAt: string | null;
    contentHash: string;     // sha256 do parsed (faixas/classe-média)
    rulesStale: boolean;     // sempre false ao escrever; cliente recalcula por idade
  };
}
export interface ParsedRates {
  faixa2: RateByCotistaRegion;
  faixa3: RateByCotistaRegion;
  classeMedia: number;
  publishedAt: string | null;
}
```

### `src/parser.ts` — puro, sem DOM
Porte **1:1** de `engaja-amiz/supabase/functions/financing-rates-sync/parser.ts`.
- `parseMcmvRatesHtml(html): ParsedRates` — ancora em `TAXA DE JUROS NOMINAL`, extrai Faixa 2
  (4 valores, janela 300 chars), Faixa 3 (2 valores; `cotista === naoCotista`), Classe Média e
  `publishedAt` (`Atualizado em DD/MM/YYYY`).
- `isPlausible(r): boolean` — toda taxa é número e `0 < v < 20`; rejeita faixa faltando.

### `src/sources.ts` — efeitos de rede isolados
- `fetchGovBrHtml(): Promise<string>` — GET do gov.br com `User-Agent` de navegador.
- `fetchBcbMonthly(serie): Promise<number | null>` — última observação da série SGS; `null` em
  qualquer erro (rede/parse/campo ausente). Não lança.
- URLs lidas de env com default fixo (`GOVBR_URL`, `BCB_BASE`) para permitir override em teste.

### `src/update.ts` — lógica pura, sem I/O (núcleo testável)
- `sha256(s: string): string` — hex SHA-256 (via `node:crypto`).
- `decideUpdate(old, parsed, indexersRaw, now): { changed: boolean; payload: RatesPayload }`
  — ver algoritmo na §6.
- `buildPayload(...)` — monta o `RatesPayload` final (`rulesStale: false`).

### `src/index.ts` — orquestração e exit codes
1. Lê `data/taxas-financiamento.json` (`old`). Deve existir (semeado no v0.1.0).
2. `html = await fetchGovBrHtml()`; `parsed = parseMcmvRatesHtml(html)`.
3. Se `!isPlausible(parsed)` → loga motivo + **`process.exit(1)`** (Action falha = alerta). Não escreve.
4. `[trRaw, poupRaw] = await Promise.all([fetchBcbMonthly(7811), fetchBcbMonthly(195)])`.
5. `{ changed, payload } = decideUpdate(old, parsed, { trRaw, poupRaw }, new Date())`.
6. Se `!changed` → loga `unchanged`, **não reescreve** o arquivo, `exit 0`.
7. Se `changed` → escreve o arquivo (JSON 2-spaces + `\n` final), loga resumo, `exit 0`.

---

## 6. Algoritmo de atualização (`decideUpdate`)

```
Entrada: old (RatesPayload existente), parsed (ParsedRates), { trRaw, poupRaw }, now

1. contentHash = sha256(JSON.stringify(parsed))        # só faixas/classe-média (mesmo sentido do engaja)

2. GUARDA ANTI-ZERO nos indexadores:
     tr   = (typeof trRaw   === "number" && trRaw   > 0) ? trRaw   : old.indexers.trMonthlyPct
     poup = (typeof poupRaw === "number" && poupRaw > 0) ? poupRaw : old.indexers.poupancaMonthlyPct
   # BCB fora do ar nunca zera bons indexadores: preserva o valor anterior.

3. changed =
        old.meta.contentHash               !== contentHash   # tabela gov.br mudou
     || old.indexers.trMonthlyPct          !== tr            # TR mudou (mensal)
     || old.indexers.poupancaMonthlyPct    !== poup          # poupança mudou (mensal)

4. Se !changed → retorna { changed: false, payload: old }

5. Se changed → payload = {
        faixa2: parsed.faixa2, faixa3: parsed.faixa3, classeMedia: parsed.classeMedia,
        indexers: { trMonthlyPct: tr, poupancaMonthlyPct: poup },
        meta: {
          sourceUrl, sourceName: "Ministério das Cidades — MCMV Linha Financiada",
          retrievedAt: now.toISOString(), publishedAt: parsed.publishedAt,
          contentHash, rulesStale: false,
        },
     }
     retorna { changed: true, payload }
```

**Propriedades garantidas:**
- O JSON só muda quando há mudança real → sem commits de ruído por timestamp.
- Indexadores ficam frescos mensalmente (TR/poupança mudam todo mês).
- Falha do BCB nunca zera bons indexadores.
- Layout quebrado/implausível **falha a Action** (exit 1) em vez de publicar lixo.
- `contentHash` mantém o mesmo significado do engaja (hash do `parsed`), preservando o contrato.

---

## 7. GitHub Action (`.github/workflows/update-rates.yml`)

- **Gatilhos:**
  - `schedule: '0 11 * * 1'` → 11h UTC = **08h BRT, segunda-feira**.
  - `workflow_dispatch` → acionamento manual.
- **`permissions: contents: write`** (commit pelo `github-actions[bot]`).
- **Passos:**
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` (node 24) + `npm ci`
  3. `npm test` — guarda: se o parser estiver quebrado, falha **antes** de publicar.
  4. `npm run scrape` — roda `tsx src/index.ts`; escreve `data/` só se mudou. Exit 1 em implausível
     **falha o job** (alerta visível na aba Actions).
  5. `git add data/taxas-financiamento.json`
     `git diff --staged --quiet || git commit -m "chore(rates): atualiza taxas (publishedAt … / retrievedAt …)"`
     `git push`
  6. **Purge jsDelivr** (best-effort, `|| true`):
     `curl -sf https://purge.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json`

---

## 8. Contrato JSON e consumo

### Arquivo publicado (exemplo real — seed do v0.1.0)

```json
{
  "faixa2": { "cotista": {"N_NE":4.75,"S_SE_CO":5}, "naoCotista": {"N_NE":5.25,"S_SE_CO":5.5} },
  "faixa3": { "cotista": {"N_NE":7.66,"S_SE_CO":8.16}, "naoCotista": {"N_NE":7.66,"S_SE_CO":8.16} },
  "classeMedia": 10,
  "indexers": { "trMonthlyPct": 0.1709, "poupancaMonthlyPct": 0.6734 },
  "meta": {
    "sourceUrl": "https://www.gov.br/cidades/...",
    "sourceName": "Ministério das Cidades — MCMV Linha Financiada",
    "retrievedAt": "2026-06-12T20:39:07.081Z",
    "publishedAt": "16/04/2026",
    "contentHash": "seed",
    "rulesStale": false
  }
}
```

### URL pública

```
https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json
```

> jsDelivr com `@main` tem cache de borda de até ~12h; o purge da Action acelera a propagação.
> Para travar uma versão imutável, usar `@v0.1.0`.

> **Seed do v0.1.0:** o arquivo é semeado com os valores reais acima, porém com
> `meta.contentHash: "seed"` (sentinela). Como `"seed"` nunca bate com o `sha256(parsed)` real, o
> **primeiro run** da Action sempre detecta `changed` e publica dados frescos do gov.br/BCB —
> sem depender de o seed já estar "correto". A partir daí o hash real passa a valer.

### Snippet de consumo (README) — fetch + fallback + staleness no cliente

```ts
const RATES_URL =
  "https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json";
const MAX_AGE_DAYS = 21;

export async function getFinancingRates(seed /* RatesPayload embutido */) {
  try {
    const res = await fetch(RATES_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const payload = await res.json();
    return withStaleness(payload);
  } catch {
    return withStaleness(seed); // resiliência offline
  }
}

function withStaleness(p) {
  const ageDays = (Date.now() - new Date(p.meta.retrievedAt).getTime()) / 86_400_000;
  return { ...p, meta: { ...p.meta, rulesStale: p.meta.rulesStale || ageDays > MAX_AGE_DAYS } };
}
```

---

## 9. Testes (Vitest)

### `test/parser.test.ts` (porte do engaja + caso novo)
- Extrai taxas conhecidas da fixture: `faixa3.cotista` = `{7.66, 8.16}`, `classeMedia ≈ 10`, `publishedAt` contém `2026`.
- Faixa 2 com 4 valores plausíveis: `{4.75, 5.00, 5.25, 5.50}`.
- Faixa 3 `naoCotista === cotista`.
- `isPlausible`: aceita payload da fixture; rejeita taxa fora de 0–20; rejeita faixa faltando.
- **Novo:** *layout quebrado* — HTML sem a âncora `TAXA DE JUROS NOMINAL` → valores `NaN` → `isPlausible === false`.

### `test/update.test.ts` (lógica de decisão)
- **sem mudança:** `old` == parsed/indexers → `changed === false`.
- **faixas mudaram:** parsed diferente → `changed === true`, `contentHash` novo.
- **só indexers mudaram:** TR/poupança diferentes, faixas iguais → `changed === true`.
- **BCB falhou (raw = null/0):** preserva `old.indexers`; se faixas iguais → `changed === false`.
- **implausível:** garante que `index.ts` não escreveria (teste no nível de `isPlausible`/contrato).

**Critério:** `npm test` 100% verde antes de qualquer commit funcional (CLAUDE.md global).

---

## 10. Arquivos de convenção do workspace

- **`CLAUDE.md`** — descreve o projeto, contrato, URL pública, como rodar/testar, como atualizar.
- **`.claude/settings.json`** — permissões (baseado no template do workspace).
- **`.env.example`** — documenta que **não há segredos** (gov.br e BCB são públicos). Variáveis
  opcionais só para override em teste: `GOVBR_URL`, `BCB_BASE`.
- **`LICENSE`** — MIT.
- **Tag `v0.1.0`** no primeiro commit funcional.

---

## 11. Plano de migração dos consumidores (documentar — `docs/migracao-consumidores.md`)

- **projeto-simuladores** (`src/hooks/useFinancingRates.ts`): trocar o retorno fixo de
  `RATES_BOOTSTRAP` por `fetch` na URL jsDelivr, mantendo `RATES_BOOTSTRAP` como fallback e o
  mesmo shape de retorno (`{ data, isLoading }`). Aplicar `withStaleness` no cliente.
- **engaja-amiz**: passa a consumir o mesmo JSON em vez de ser a fonte. Depois.
- Endpoint atual ainda no ar (referência/decomissionar depois):
  `https://api.engaja.amiz.imb.br/functions/v1/get-financing-rates`.

---

## 12. Critérios de aceitação

1. `npm install && npm test` → 100% verde (parser + update).
2. `npm run scrape` localmente: busca gov.br + BCB, e ou (a) loga `unchanged` sem alterar o
   arquivo, ou (b) escreve um `data/taxas-financiamento.json` válido (passa por `isPlausible`).
3. `data/taxas-financiamento.json` existe no repo, com o shape `RatesPayload` exato, e é servível
   pela URL jsDelivr.
4. A Action roda via `workflow_dispatch` e via cron; commita só quando muda; falha visivelmente se
   o parser quebrar.
5. README documenta contrato, URL pública e snippet de consumo (fetch + fallback + staleness).
6. Repo público `alexandre-leonardo/taxas-financiamento-caixa` criado, com `main` + tag `v0.1.0`
   pushados.
7. `docs/migracao-consumidores.md` presente.
