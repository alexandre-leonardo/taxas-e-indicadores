# Cota máxima de financiamento (SBPE) — design

Data: 2026-06-29

## Problema

Consumidores (projeto-simuladores, engaja-amiz) precisam do **percentual máximo de
financiamento** (cota / LTV) — quanto do valor do imóvel a Caixa financia. Hoje o payload
(`data/taxas-financiamento.json`) só tem taxas de juros e indexadores. A cota **não está** na
nossa fonte atual (página MCMV do gov.br, que traz apenas teto do imóvel, prazo e subsídios).

A cota SBPE vigente é **SAC 80% / Price 70%** (vigência 13/10/2025, anunciada pela Caixa). O dado
muda raramente (~1×/ano, por decisão de conselho anunciada em notícia), não vive num endpoint
estruturado estável, e as páginas de condição da Caixa dão redirect-loop sob fetch (anti-bot).

## Decisão

Adicionar `cotaMaxima` ao payload, preenchido por um **passo de extração com LLM no CI via
OpenRouter** (API OpenAI-compatible) com **web search**. O LLM busca a cota em fonte oficial e
devolve JSON estruturado; o pipeline valida e só publica se o dado for plausível e **citar domínio
oficial**.

Escolha feita pelo dono do repo após avaliar: constante curada estática, watcher que avisa, e
auto-extração com LLM. A auto-extração foi escolhida para que o pipeline "re-ache a fonte" em
mudanças futuras, sem depender de URL fixa (que não existe para este dado).

### Por que não as alternativas
- **Scraper de URL fixa**: não há fonte oficial estruturada estável; apontar para uma notícia
  congela o valor (envelhece em silêncio).
- **Constante curada manual**: simples, mas não "re-acha" a fonte sozinha (requisito do dono).

## Validação (teste real, 2026-06-29)

Testados via OpenRouter `…/api/v1/chat/completions` com `plugins:[{id:"web",max_results:10}]` +
`response_format` json_schema, `temperature:0`, `max_tokens:600`:

| Modelo | sac/price | fonte | custo |
|---|---|---|---|
| openai/gpt-4o-mini | 80 / 70 | caixanoticias.caixa.gov.br ✅ | ~$0.0055 |
| google/gemini-2.5-flash-lite | 80 / 70 | caixanoticias.caixa.gov.br ✅ | ~$0.0054 |
| meta-llama/llama-3.3-70b-instruct | 80 / 70 | caixanoticias.caixa.gov.br ✅ | ~$0.0055 |

Aprendizados que moldaram o design:
1. **`sac`/`price` são confiáveis** — os 3 modelos convergiram no valor certo com fonte oficial.
2. **Prompt fraco cita blog** (1ª rodada gpt-4o-mini citou `lokatell.com.br` e errou a data). Por
   isso o prompt **exige domínio oficial** e a guarda **rejeita fonte não-oficial**.
3. **`vigenteDesde` é alucinado** (3 datas diferentes, todas erradas vs 13/10/2025 real) → **fora
   do escopo**. Não publicamos dado não confiável (ethos do projeto).
4. **Custo dominado pelo web search** (~$0.005 Exa), não pelo modelo → "modelo barato" é quase
   indiferente no custo; ~$0.28/ano (1×/semana). Default: `openai/gpt-4o-mini`, configurável.

## Contrato — `cotaMaxima` (aditivo)

```jsonc
"cotaMaxima": {
  "sbpe": { "sac": 80, "price": 70 },
  "fonteUrl": "https://caixanoticias.caixa.gov.br/...",
  "atualizadoEm": "2026-06-29T00:00:00.000Z"  // ISO; quando o pipeline confirmou
}
```

- Campo **novo e aditivo** em `RatesPayload` — consumidores que não o conhecem ignoram a chave.
  (Diverge do shape "idêntico ao engaja"; é intencional — este dado é para os consumidores migrarem.)
- Escopo **SBPE SAC/Price**. MCMV fica de fora (não tem % de cota oficial único; é entrada mínima +
  subsídio caso a caso).

## Componentes

### `src/types.ts`
```ts
export interface CotaMaxima {
  sbpe: { sac: number; price: number };
  fonteUrl: string;
  atualizadoEm: string; // ISO 8601
}
// + cotaMaxima: CotaMaxima em RatesPayload
// + CotaRaw = saída crua do LLM: { sac:number; price:number; fonteUrl:string } | null
```

### `src/sources.ts`
- `parseCotaResponse(content: string): CotaRaw | null` — **puro/testável**. Faz `JSON.parse` do
  conteúdo do LLM, extrai `sac`/`price`/`fonteUrl`; retorna `null` se parse falhar ou faltar campo.
  Split parser/I-O igual ao existente (parser.ts vs sources.ts).
- `fetchCotaMaxima(): Promise<CotaRaw | null>` — **I/O, nunca lança** (igual `fetchBcbMonthly`).
  POST OpenRouter (`OPENROUTER_BASE` configurável, default `https://openrouter.ai/api/v1`),
  modelo `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`), header `Authorization: Bearer
  $OPENROUTER_API_KEY`, plugin web + `response_format` json_schema. Sem `OPENROUTER_API_KEY` →
  retorna `null` (dev local sem chave não quebra). Delega o parse a `parseCotaResponse`.

### `src/update.ts`
- `isCotaPlausible(c: CotaRaw | null): boolean` — `sac`/`price` numéricos, `30 ≤ v ≤ 100`,
  `price ≤ sac`, e `fonteUrl` em host terminando `caixa.gov.br` ou `gov.br` (anti-alucinação).
- `decideUpdate(old, parsed, raw, cotaRaw, now, sourceUrl)` — novo param `cotaRaw`:
  - `null`/implausível → **mantém `old.cotaMaxima`** (rede/LLM ruim nunca estraga bom dado).
  - plausível e **`sac`/`price` diferentes** de `old` → adota o `cotaRaw` inteiro (novo
    `fonteUrl`), `atualizadoEm = now`, e `changed = true`.
  - plausível mas `sac`/`price` **iguais** → **mantém `old.cotaMaxima` intacto** (não compara
    `fonteUrl`). Evita commit semanal espúrio: o modelo cita URLs oficiais diferentes a cada run
    com o mesmo 80/70. `atualizadoEm` = "quando o pipeline gravou este valor", move só na mudança.
  - `contentHash` permanece só faixas/classe-média (semântica inalterada); a cota entra na
    expressão `changed` separadamente, como os indexadores.

### `src/index.ts`
- Chama `fetchCotaMaxima()` junto de `fetchIndexers()` (Promise.all), passa `cotaRaw` ao
  `decideUpdate`. Falha da cota **não** faz `exit 1` (só parser de taxas implausível faz).
- Log inclui a cota quando publica.

### `.github/workflows/update-rates.yml`
- Passo `npm run scrape` ganha `env: OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`.
- (Dono cria o secret `OPENROUTER_API_KEY` no repo.)

### Seed — `data/taxas-financiamento.json`
- Adicionar `cotaMaxima` com `sac 80 / price 70`, `fonteUrl` oficial e `atualizadoEm` atual.

## Fluxo

```
index.main()
 ├─ fetchGovBrHtml → parseMcmvRatesHtml → isPlausible (taxas; exit 1 se falhar)
 ├─ Promise.all(fetchIndexers, fetchCotaMaxima→parseCotaResponse)
 ├─ decideUpdate(old, parsed, raw, cotaRaw, now, url)
 │    ├─ taxas/indexers (como hoje)
 │    └─ cota: isCotaPlausible? diff? → publica : mantém old
 └─ changed? writeFile + (Action) commit + purge jsDelivr
```

## Tratamento de erro / guardas
- `fetchCotaMaxima` nunca lança (try/catch → null). Sem chave → null.
- Cota null/implausível → preserva `old.cotaMaxima`. Nunca zera/quebra.
- Guarda de domínio oficial barra blog/fonte alucinada.
- Plausibilidade de taxas inalterada (exit 1 só para taxas).

## Testes
- `isCotaPlausible`: válido; `price>sac`; fora de faixa (`<30`,`>100`); domínio não-oficial; campo
  faltando/NaN.
- `parseCotaResponse`: JSON válido → CotaRaw; lixo → null; campo faltando → null.
- `decideUpdate` com cota: `null` mantém old; `sac`/`price` diferentes publica (`changed`,
  `atualizadoEm` novo, `fonteUrl` novo); implausível mantém old; **`sac`/`price` iguais com
  `fonteUrl` diferente NÃO publica** (mantém old — anti-churn); cota-só-mudou dispara `changed`
  com taxas iguais.
- (Sem teste de rede para `fetchCotaMaxima` — I/O, igual aos fetchers BCB.)

## Risco residual (aceito)
Número plausível porém mal-lido pode publicar sozinho. Mitigado por: faixa 30–100, `price ≤ sac`,
**domínio oficial obrigatório**, e `temperature:0`. Não eliminado. Hardening futuro possível:
abrir issue em vez de auto-publicar quando o valor muda.

## Fora de escopo
- Cota MCMV (sem % oficial único).
- `vigenteDesde` (LLM alucina).
- Migração dos consumidores (cada um lê a nova chave quando quiser).

## Config / segredos
- `OPENROUTER_API_KEY` (secret no GitHub; local via env). **Nunca commitada.**
- `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`), `OPENROUTER_BASE` (default oficial) —
  opcionais, para trocar modelo sem mexer no código.
