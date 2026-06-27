# taxas-financiamento-caixa

Fonte pública e única de verdade das **taxas de financiamento imobiliário** (MCMV/SBPE) da
Caixa/gov.br, em JSON estático, atualizada semanalmente e servida via CDN. Custo zero.

## URL pública

```
https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json
```

> O `@main` tem cache de borda de até ~12h no jsDelivr (a Action faz purge a cada atualização).
> Para travar uma versão imutável, use uma tag: `…@v0.1.0/data/…`.

## Contrato (`RatesPayload`)

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
    "contentHash": "<sha256>",
    "rulesStale": false
  }
}
```

- `faixa2`/`faixa3`: taxa nominal anual (%) por cotista/não-cotista × região (`N_NE`, `S_SE_CO`).
- `classeMedia`: taxa nominal anual (%).
- `indexers`: TR e poupança mensais (%) do BCB.
- `meta.retrievedAt`: quando o dado foi raspado. `meta.publishedAt`: data informada pelo gov.br.
- `meta.rulesStale`: sempre `false` no arquivo; **o cliente recalcula** por idade (ver abaixo).

## Como um app novo consome (fetch + fallback + staleness)

```ts
import type { RatesPayload } from "./types"; // copie o shape de src/types.ts

const RATES_URL =
  "https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json";
const MAX_AGE_DAYS = 21;

// `seed` é um RatesPayload embutido no app (fallback offline).
export async function getFinancingRates(seed: RatesPayload): Promise<RatesPayload> {
  try {
    const res = await fetch(RATES_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return withStaleness((await res.json()) as RatesPayload);
  } catch {
    return withStaleness(seed);
  }
}

function withStaleness(p: RatesPayload): RatesPayload {
  const ageDays = (Date.now() - new Date(p.meta.retrievedAt).getTime()) / 86_400_000;
  return { ...p, meta: { ...p.meta, rulesStale: p.meta.rulesStale || ageDays > MAX_AGE_DAYS } };
}
```

## Desenvolvimento

```bash
npm install
npm test          # parser + lógica de decisão
npm run scrape    # raspa gov.br + BCB; escreve data/ só se mudou
```

## Como atualiza

Uma GitHub Action roda toda segunda 08h BRT (e via *Run workflow* manual). Ela testa, raspa e — se
as taxas ou os indexadores mudaram — commita o novo JSON e faz purge do jsDelivr. Cada atualização
é um commit: o histórico do git é a auditoria das taxas.

## Licença

MIT — as taxas são dado público do gov.br.
