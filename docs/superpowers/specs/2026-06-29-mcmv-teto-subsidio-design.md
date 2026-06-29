# MCMV: teto do imóvel + subsídio máximo no payload — design

Data: 2026-06-29

## Problema

Os consumidores precisam, além das taxas e da cota SBPE, dos **limites do MCMV**: o **teto do valor
do imóvel** por faixa e o **subsídio máximo** por região. Esses dados são oficiais e **já estão na
página do gov.br que raspamos** (mesma fonte das taxas), mas hoje não entram no payload.

## Decisão

Adicionar o bloco **`mcmv`** ao payload, extraído por **parser determinístico** do mesmo HTML do
gov.br já buscado em `fetchGovBrHtml()` — **sem LLM** (diferente da cota SBPE, cuja fonte não é
estruturada). Guarda de plausibilidade preserva o valor anterior se o parse falhar (mesmo ethos do
anti-zero/cota: layout do gov.br mudou → não publica lixo, mantém o que tinha).

### Por que determinístico (e não LLM como a cota)
A cota SBPE não está na nossa fonte e exigiu LLM+web search. O teto/subsídio **estão no HTML que já
baixamos**, em prosa estável → regex calibrado na fixture é mais robusto, sem custo e sem alucinação.

## Dados (confirmados ao vivo 2026-06-29, idênticos à fixture)

| Campo | Valor |
|---|---|
| teto Faixas 1 e 2 | R$ 210 mil – R$ 275 mil (varia por município) |
| teto Faixa 3 | R$ 400 mil |
| teto Classe Média | R$ 600 mil |
| subsídio Norte | até R$ 65.000 |
| subsídio demais regiões | até R$ 55.000 |

Fonte: `https://www.gov.br/.../mcmv-fgts` (a mesma de `meta.sourceUrl`). Prosa de origem:
- *"...varia de R$ 210 mil a R$ 275 mil, para famílias ... (Faixas 1 e 2) ... (Faixa 3) podem
  adquirir imóveis de até R$ 400 mil ..."*
- *"...valor limitado a R$ 600 mil ... programa Classe Média."*
- *"...descontos (subsídios), que podem chegar até R$ 65.000,00, na Região Norte, e até R$
  55.000,00, nas demais regiões..."*

### Ressalvas de forma (documentar, não resolver)
- **Teto Faixas 1–2 é uma faixa** (min–max), resolvida por município numa planilha da Caixa
  (`TABELA_MUNICIPIOS`) que **não** raspamos. Publicamos só o range nacional.
- **Subsídio é um teto** (máximo), não o valor que cada família recebe.

## Contrato — `mcmv` (aditivo)

```jsonc
"mcmv": {
  "tetoImovel": {
    "faixa1e2": { "min": 210000, "max": 275000 },
    "faixa3": 400000,
    "classeMedia": 600000
  },
  "subsidioMaxPorRegiao": { "N": 65000, "demais": 55000 }
}
```

- Campo **novo e aditivo** em `RatesPayload` (consumidores que não o conhecem ignoram a chave).
- **Sem `fonteUrl`/`atualizadoEm` próprios** — a fonte é a mesma de `meta` (gov.br); `meta.publishedAt`
  / `meta.retrievedAt` já datam a atualização (diferente da cota, que vem de outra fonte).

## Componentes

### `src/types.ts`
```ts
export interface McmvLimits {
  tetoImovel: { faixa1e2: { min: number; max: number }; faixa3: number; classeMedia: number };
  subsidioMaxPorRegiao: { N: number; demais: number };
}
// + mcmv: McmvLimits em RatesPayload
```
O parser devolve `McmvLimits | null` (não há shape "raw" separado — o parse é completo ou null).

### `src/parser.ts`
- `parseMcmvLimits(html: string): McmvLimits | null` — strip de tags + collapse (igual a
  `parseMcmvRatesHtml`), depois 4 regex (teto f1e2, f3, classeMédia, subsídio). `"R$ 210 mil"` →
  ×1000; `"R$ 65.000,00"` → formato BR. Qualquer regex sem match → `null`.

### `src/update.ts`
- `isMcmvPlausible(m: McmvLimits | null): m is McmvLimits` — todos os valores numéricos; teto em
  `50_000–5_000_000`, `faixa1e2.max ≥ min`; subsídio em `1_000–500_000`. (Não assume ordenação
  entre faixas nem N≥demais — política pode mudar.)
- `decideUpdate(old, parsed, raw, cotaRaw, mcmvRaw, now, sourceUrl)` — novo param `mcmvRaw`
  (após `cotaRaw`, espelhando o padrão da cota):
  - `null`/implausível → **mantém `old.mcmv`**.
  - plausível e diferente de `old.mcmv` (compara via `JSON.stringify`) → entra no payload,
    `changed = true`. Sem risco de churn: parse determinístico → estável.
  - `JSON.stringify(undefined)` é `undefined`, então seed pré-feature (sem `mcmv`) não quebra:
    conta como "mudou" e publica.
  - 7 params posicionais — consistente com a cota (6). `// ponytail:` se virar um 4º source, agrupar.

### `src/index.ts`
- `parseMcmvLimits(html)` ao lado de `parseMcmvRatesHtml(html)` (mesmo HTML). Passa `mcmvRaw` ao
  `decideUpdate`. Parse de mcmv falho **não** faz `exit 1` (só taxas implausíveis fazem) — preserva old.

### Seed — `data/taxas-financiamento.json`
- Adicionar o bloco `mcmv` com os valores confirmados.

## Fluxo

```
index.main()
 ├─ html = fetchGovBrHtml()
 ├─ parsed = parseMcmvRatesHtml(html); isPlausible(parsed)? (taxas; exit 1 se não)
 ├─ mcmvRaw = parseMcmvLimits(html)               // mesmo HTML, determinístico
 ├─ [raw, cotaRaw] = await Promise.all([fetchIndexers(), fetchCotaMaxima()])
 ├─ decideUpdate(old, parsed, raw, cotaRaw, mcmvRaw, now, url)
 │    └─ mcmv: isMcmvPlausible? diff? → publica : mantém old
 └─ changed? writeFile + (Action) commit + purge
```

## Testes
- `parseMcmvLimits` (contra a fixture): extrai exatamente `{210000,275000,400000,600000}` +
  `{N:65000,demais:55000}`; HTML sem os trechos → `null`.
- `isMcmvPlausible`: válido; teto fora de faixa; `max<min`; subsídio fora de faixa; null; campo faltando.
- `decideUpdate` com mcmv: `null` mantém old; plausível-diferente publica (`changed`); implausível
  mantém old; mcmv-só-mudou dispara `changed` com taxas iguais; seed sem `mcmv` publica sem quebrar.

## Fora de escopo
- Teto por município (planilha da Caixa).
- Valor real do subsídio (depende de renda/região/valor).
- Cota MCMV como % (não existe número oficial único).

## Risco
Baixo: parse determinístico de fonte que já consumimos; guarda preserva old se o layout mudar.
Se o gov.br reescrever a prosa, o regex falha → mantém o último valor bom (não publica lixo). Nesse
caso, recalibrar regex + fixture (mesma regra do parser de taxas).
