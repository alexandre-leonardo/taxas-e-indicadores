# MCMV teto + subsídio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o bloco `mcmv` (teto do imóvel por faixa + subsídio máximo por região) ao payload, extraído por parser determinístico do HTML do gov.br já buscado, com guarda que preserva o valor anterior se o parse falhar.

**Architecture:** Espelha o pipeline atual. Parser puro (`parseMcmvLimits`) sobre o mesmo HTML de `fetchGovBrHtml()` (sem rede nova, sem LLM). Decisão pura (`isMcmvPlausible` + `decideUpdate`) com preserva-old, igual ao padrão da cota SBPE.

**Tech Stack:** TypeScript (ESM), Node 24, Vitest. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-06-29-mcmv-teto-subsidio-design.md`

**Ambiente:** Windows. O `npm` do Bash tool está quebrado (`@npm.cmd: command not found`) — rodar `npm test` só via **PowerShell**. Usar Read/Edit/Write para arquivos.

---

### Task 1: Tipos + seed + helper de teste

**Files:**
- Modify: `src/types.ts`
- Modify: `data/taxas-financiamento.json`
- Modify: `test/update.test.ts` (helper `makeOld`)

- [ ] **Step 1: Adicionar `McmvLimits` em `src/types.ts`**

Dentro de `RatesPayload`, adicionar `mcmv: McmvLimits;` logo após `cotaMaxima: CotaMaxima;` e antes de `meta`. No fim do arquivo, adicionar:

```ts
// Limites do MCMV (teto do imóvel por faixa + subsídio máximo por região). Aditivo ao contrato.
// Fonte: mesma página gov.br das taxas (datada por meta.publishedAt/retrievedAt).
export interface McmvLimits {
  tetoImovel: { faixa1e2: { min: number; max: number }; faixa3: number; classeMedia: number };
  subsidioMaxPorRegiao: { N: number; demais: number };
}
```

- [ ] **Step 2: Adicionar `mcmv` ao seed `data/taxas-financiamento.json`**

Inserir entre o bloco `"cotaMaxima"` e `"meta"` (formato multi-linha = saída canônica do writer):

```jsonc
  "mcmv": {
    "tetoImovel": {
      "faixa1e2": {
        "min": 210000,
        "max": 275000
      },
      "faixa3": 400000,
      "classeMedia": 600000
    },
    "subsidioMaxPorRegiao": {
      "N": 65000,
      "demais": 55000
    }
  },
```

- [ ] **Step 3: Atualizar `makeOld` em `test/update.test.ts`**

No objeto retornado por `makeOld`, após o bloco `cotaMaxima:` e antes de `meta:`:

```ts
    mcmv: {
      tetoImovel: { faixa1e2: { min: 210000, max: 275000 }, faixa3: 400000, classeMedia: 600000 },
      subsidioMaxPorRegiao: { N: 65000, demais: 55000 },
    },
```

- [ ] **Step 4: Rodar testes (devem continuar passando)**

Run (PowerShell): `npm test`
Expected: PASS (31 testes; nada de novo ainda).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts data/taxas-financiamento.json test/update.test.ts
git commit -m "feat(types): bloco mcmv (teto + subsidio) no contrato + seed"
```

---

### Task 2: `parseMcmvLimits`

**Files:**
- Modify: `src/parser.ts`
- Test: `test/parser.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

Em `test/parser.test.ts`, adicionar ao import `parseMcmvLimits` e, ao fim do arquivo, um bloco. (O arquivo já carrega a fixture `mcmv-govbr.html` — reutilizar a mesma variável de HTML que os testes existentes usam; se ela se chamar `html`, usá-la.)

```ts
describe("parseMcmvLimits", () => {
  it("extrai teto e subsídio da fixture real", () => {
    const m = parseMcmvLimits(html);
    expect(m).toEqual({
      tetoImovel: { faixa1e2: { min: 210000, max: 275000 }, faixa3: 400000, classeMedia: 600000 },
      subsidioMaxPorRegiao: { N: 65000, demais: 55000 },
    });
  });
  it("retorna null se a prosa não estiver presente", () => {
    expect(parseMcmvLimits("<p>página sem os limites</p>")).toBeNull();
  });
});
```

Se o teste de parser existente carrega a fixture de outro jeito (ex.: `readFileSync` numa const com outro nome), usar o mesmo mecanismo/variável já presente no arquivo em vez de reabrir o arquivo.

- [ ] **Step 2: Rodar para confirmar que falha**

Run (PowerShell): `npm test`
Expected: FAIL — `parseMcmvLimits` não exportado.

- [ ] **Step 3: Implementar `parseMcmvLimits` em `src/parser.ts`**

Adicionar ao fim do arquivo:

```ts
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
```

E garantir o import do tipo no topo de `src/parser.ts`: a linha `import type { ParsedRates } from "./types";` vira `import type { McmvLimits, ParsedRates } from "./types";`.

- [ ] **Step 4: Rodar para confirmar que passa**

Run (PowerShell): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts test/parser.test.ts
git commit -m "feat(parser): parseMcmvLimits (teto + subsidio determinístico do gov.br)"
```

---

### Task 3: `isMcmvPlausible`

**Files:**
- Modify: `src/update.ts`
- Test: `test/update.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

No import de `test/update.test.ts`, adicionar `isMcmvPlausible`. Ao fim do arquivo:

```ts
describe("isMcmvPlausible", () => {
  const ok = {
    tetoImovel: { faixa1e2: { min: 210000, max: 275000 }, faixa3: 400000, classeMedia: 600000 },
    subsidioMaxPorRegiao: { N: 65000, demais: 55000 },
  };
  it("aceita limites válidos", () => {
    expect(isMcmvPlausible(ok)).toBe(true);
  });
  it("rejeita null", () => {
    expect(isMcmvPlausible(null)).toBe(false);
  });
  it("rejeita teto fora da faixa", () => {
    expect(isMcmvPlausible({ ...ok, tetoImovel: { ...ok.tetoImovel, classeMedia: 10 } })).toBe(false);
  });
  it("rejeita faixa1e2 com max < min", () => {
    expect(
      isMcmvPlausible({ ...ok, tetoImovel: { ...ok.tetoImovel, faixa1e2: { min: 275000, max: 210000 } } }),
    ).toBe(false);
  });
  it("rejeita subsídio fora da faixa", () => {
    expect(isMcmvPlausible({ ...ok, subsidioMaxPorRegiao: { N: 5_000_000, demais: 55000 } })).toBe(false);
  });
  it("rejeita campo faltando", () => {
    expect(isMcmvPlausible({ tetoImovel: ok.tetoImovel } as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run (PowerShell): `npm test`
Expected: FAIL — `isMcmvPlausible` não exportado.

- [ ] **Step 3: Implementar em `src/update.ts`**

Atualizar o import de tipos para incluir `McmvLimits` e adicionar a função (após `isCotaPlausible`):

```ts
import type { CotaRaw, IndexersRaw, McmvLimits, ParsedRates, RatesPayload } from "./types";

/** Limites MCMV plausíveis: tetos em 50k–5M (max≥min), subsídios em 1k–500k. */
export function isMcmvPlausible(m: McmvLimits | null): m is McmvLimits {
  if (!m || !m.tetoImovel || !m.subsidioMaxPorRegiao) return false;
  const t = m.tetoImovel;
  const inRange = (v: unknown, lo: number, hi: number): boolean =>
    typeof v === "number" && !Number.isNaN(v) && v >= lo && v <= hi;
  const tetos = [t.faixa1e2?.min, t.faixa1e2?.max, t.faixa3, t.classeMedia];
  if (!tetos.every((v) => inRange(v, 50_000, 5_000_000))) return false;
  if (t.faixa1e2.max < t.faixa1e2.min) return false;
  const subs = [m.subsidioMaxPorRegiao.N, m.subsidioMaxPorRegiao.demais];
  return subs.every((v) => inRange(v, 1_000, 500_000));
}
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run (PowerShell): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/update.ts test/update.test.ts
git commit -m "feat(update): isMcmvPlausible (faixas de teto e subsidio)"
```

---

### Task 4: Integrar mcmv no `decideUpdate` + wiring no `index.ts`

**Files:**
- Modify: `src/update.ts`
- Modify: `src/index.ts`
- Test: `test/update.test.ts`

- [ ] **Step 1: Atualizar testes (falhando)**

(a) Em **todas** as chamadas existentes de `decideUpdate(...)` em `test/update.test.ts`, inserir `null` como **5º argumento** (o slot `mcmvRaw`), imediatamente **depois** do argumento `cotaRaw` e **antes** de `now`. Ex.:

```ts
// antes: decideUpdate(makeOld(), parsed, same, null, now, SOURCE)
// depois:
decideUpdate(makeOld(), parsed, same, null, null, now, SOURCE)
```

(b) Adicionar o bloco novo ao fim do arquivo:

```ts
describe("decideUpdate — mcmv", () => {
  const same = { trRaw: 0.1709, poupRaw: 0.6734 };
  const okMcmv = {
    tetoImovel: { faixa1e2: { min: 210000, max: 275000 }, faixa3: 400000, classeMedia: 600000 },
    subsidioMaxPorRegiao: { N: 65000, demais: 55000 },
  };

  it("mcmv null mantém old.mcmv e não marca changed", () => {
    const r = decideUpdate(makeOld(), parsed, same, null, null, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.mcmv).toEqual(makeOld().mcmv);
  });

  it("publica quando o teto muda", () => {
    const novo = { ...okMcmv, tetoImovel: { ...okMcmv.tetoImovel, classeMedia: 650000 } };
    const r = decideUpdate(makeOld(), parsed, same, null, novo, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.mcmv.tetoImovel.classeMedia).toBe(650000);
  });

  it("mcmv implausível mantém old e não publica", () => {
    const ruim = { ...okMcmv, subsidioMaxPorRegiao: { N: 9_000_000, demais: 55000 } };
    const r = decideUpdate(makeOld(), parsed, same, null, ruim, now, SOURCE);
    expect(r.changed).toBe(false);
    expect(r.payload.mcmv).toEqual(makeOld().mcmv);
  });

  it("seed pré-feature sem mcmv: não quebra e publica o mcmv novo", () => {
    const oldSemMcmv = makeOld();
    delete (oldSemMcmv as { mcmv?: unknown }).mcmv;
    const r = decideUpdate(oldSemMcmv, parsed, same, null, okMcmv, now, SOURCE);
    expect(r.changed).toBe(true);
    expect(r.payload.mcmv).toEqual(okMcmv);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run (PowerShell): `npm test`
Expected: FAIL — aridade de `decideUpdate` (6 vs 7 args) e bloco novo falhando.

- [ ] **Step 3: Implementar em `src/update.ts`**

Adicionar `mcmvRaw` à assinatura (após `cotaRaw`) e a lógica (após o bloco da cota, antes de montar `changed`):

```ts
export function decideUpdate(
  old: RatesPayload,
  parsed: ParsedRates,
  raw: IndexersRaw,
  cotaRaw: CotaRaw | null,
  mcmvRaw: McmvLimits | null,
  now: Date,
  sourceUrl: string,
): { changed: boolean; payload: RatesPayload } {
```

Após o bloco `if (isCotaPlausible(cotaRaw) ...) { ... }`, adicionar:

```ts
  // MCMV: parse determinístico do gov.br. Estável (sem churn); preserva old se implausível.
  // ponytail: 7 params posicionais — se entrar um 4º source, agrupar num objeto `sources`.
  let mcmv = old.mcmv;
  let mcmvChanged = false;
  if (isMcmvPlausible(mcmvRaw) && JSON.stringify(mcmvRaw) !== JSON.stringify(old.mcmv)) {
    mcmvChanged = true;
    mcmv = mcmvRaw;
  }
```

Incluir `mcmvChanged` na expressão `changed`:

```ts
  const changed =
    old.meta.contentHash !== contentHash ||
    old.indexers.trMonthlyPct !== tr ||
    old.indexers.poupancaMonthlyPct !== poup ||
    cotaChanged ||
    mcmvChanged;
```

E incluir `mcmv` no objeto `payload` (após `cotaMaxima,`):

```ts
    cotaMaxima,
    mcmv,
    meta: {
```

- [ ] **Step 4: Conectar no `src/index.ts`**

Atualizar o import e o corpo de `main`:

```ts
// import:
import { isPlausible, parseMcmvLimits, parseMcmvRatesHtml } from "./parser";

// em main(), após `const parsed = parseMcmvRatesHtml(html);` e a guarda isPlausible:
  const mcmvRaw = parseMcmvLimits(html);

// na chamada do decideUpdate, inserir mcmvRaw após cotaRaw:
  const { changed, payload } = decideUpdate(old, parsed, raw, cotaRaw, mcmvRaw, new Date(), SOURCE_URL);

// no log de sucesso, acrescentar (opcional) o teto Classe Média:
  console.log(
    `[scrape] atualizado — publishedAt=${payload.meta.publishedAt} ` +
      `retrievedAt=${payload.meta.retrievedAt} ` +
      `tr=${payload.indexers.trMonthlyPct} poup=${payload.indexers.poupancaMonthlyPct} ` +
      `cota=SAC ${payload.cotaMaxima.sbpe.sac}%/Price ${payload.cotaMaxima.sbpe.price}% ` +
      `tetoCM=${payload.mcmv.tetoImovel.classeMedia}`,
  );
```

- [ ] **Step 5: Rodar para confirmar que passa**

Run (PowerShell): `npm test`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add src/update.ts src/index.ts test/update.test.ts
git commit -m "feat(update): integra mcmv no decideUpdate + wiring no index"
```

---

### Task 5: Docs

(A verificação do scrape real fica com o controller — não rodar `npm run scrape` aqui.)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/migracao-consumidores.md`

- [ ] **Step 1: `CLAUDE.md` — seção "Como funciona"**

Acrescentar bullet:

```markdown
- Os limites do MCMV (`mcmv`: teto do imóvel por faixa + subsídio máximo por região) saem por parser
  determinístico do MESMO HTML do gov.br (`src/parser.ts:parseMcmvLimits`), sem LLM. Guarda
  `src/update.ts:isMcmvPlausible` preserva o valor anterior se o layout mudar.
```

- [ ] **Step 2: `README.md`**

Acrescentar `mcmv` à descrição do payload (uma linha: teto por faixa em reais + subsídio máximo N/demais; ressalva de que teto Faixas 1–2 é range por município e subsídio é teto).

- [ ] **Step 3: `docs/migracao-consumidores.md`**

Após a seção "cotaMaxima", adicionar seção "## mcmv — teto do imóvel + subsídio (novo)":

```markdown
## mcmv — teto do imóvel + subsídio (novo)

Mesmo JSON, chave nova. `mcmv.tetoImovel` (em reais) e `mcmv.subsidioMaxPorRegiao` (teto por região):

```ts
const teto = rates.mcmv?.tetoImovel.classeMedia;       // 600000
const subsidioMax = rates.mcmv?.subsidioMaxPorRegiao.N; // 65000 (Norte)
```

Ressalvas: `tetoImovel.faixa1e2` é um range nacional (`min`/`max`) — o valor exato por município
vive na planilha da Caixa (não raspada). `subsidioMaxPorRegiao` é o **teto** do desconto, não o
valor que cada família recebe (depende de renda/região/valor). Tipar `mcmv?` opcional e ter fallback,
como a `cotaMaxima`.
```
```

- [ ] **Step 4: Rodar testes finais**

Run (PowerShell): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/migracao-consumidores.md
git commit -m "docs: bloco mcmv no contrato e no guia de consumo"
```

---

## Notas de execução
- **Ordem:** Task 1 mantém a árvore verde antes da mudança de assinatura (Task 4).
- **Sem rede nova:** `parseMcmvLimits` usa o HTML que `fetchGovBrHtml()` já baixa.
- **Não rodar `npm run scrape`** — a verificação end-to-end é do controller.
