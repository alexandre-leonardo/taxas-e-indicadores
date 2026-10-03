# taxas-e-indicadores

Fonte pública e única de verdade das **taxas de financiamento imobiliário** (MCMV/SBPE) da
Caixa/gov.br, em JSON estático, atualizada semanalmente e servida via CDN. Custo zero.

## URL pública

```
https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/taxas-financiamento.json
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
  "cotaMaxima": { "sbpe": { "sac": 80, "price": 70 }, "fonteUrl": "https://caixanoticias.caixa.gov.br/...", "atualizadoEm": "2025-10-13T00:00:00.000Z" },
  "sbpeBalcao": { "sfh": { "tetoImovel": 2250000, "efetivaAnualPct": { "semRelacionamento": 11.49, "comRelacionamento": 11.19 }, "semRelacionamentoPorRenda": [{ "rendaAte": 77500, "efetivaAnualPct": 11.49 }, { "rendaAte": null, "efetivaAnualPct": 13.4 }], "fontePorRendaUrl": "https://simuladorhabitacao.caixa.gov.br/calculadora", "indexador": "TR" }, "fonteUrl": "https://...", "verificadoEm": "2026-10-03T00:00:00.000Z" },
  "mcmv": { "tetoImovel": { "faixa1e2": { "min": 210000, "max": 275000 }, "faixa3": 400000, "classeMedia": 600000 }, "subsidioMaxPorRegiao": { "N": 65000, "demais": 55000 } },
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
- `cotaMaxima.sbpe.sac` / `.price`: percentual máximo do valor do imóvel financiável pelo SBPE (SAC e Price), revisado manualmente a partir de fonte oficial; `atualizadoEm` é o início da vigência. Um vigia (LLM) abre issue no repo quando acha notícia de mudança.
- `sbpeBalcao.sfh`: taxa de balcão SBPE da Caixa no SFH (imóvel até `tetoImovel`), **efetiva** anual (%) + TR, sem e com relacionamento. `sfh.semRelacionamentoPorRenda`: degrau por renda mensal da calculadora da Caixa (até R$ 77.500 → 11,49%; acima → 13,40%; `rendaAte: null` = sem teto) — a taxa depende da renda, não do valor do imóvel. Revisada manualmente; `verificadoEm` é a data da conferência. SFI (acima do teto) ainda não é publicado. Campo opcional — trate ausência com fallback. Um vigia (LLM) abre issue quando acha notícia de mudança.
- `mcmv.tetoImovel`: teto do valor do imóvel por faixa MCMV em reais (`faixa1e2` é range por município — `min`/`max` nacionais; `faixa3` e `classeMedia` são valores únicos). `mcmv.subsidioMaxPorRegiao`: teto do subsídio (desconto) por região (`N` = Norte, `demais` = demais regiões) — é o máximo possível, não o valor que cada família recebe. `mcmv.rendaMax`: teto (inclusivo) da renda familiar mensal bruta de cada faixa (`faixa1`, `faixa2`, `faixa3`, `classeMedia`). `mcmv.prazoMaxMeses`: prazo máximo do financiamento.
- `meta.retrievedAt`: quando o dado foi raspado. `meta.publishedAt`: data informada pelo gov.br.
- `meta.rulesStale`: sempre `false` no arquivo; **o cliente recalcula** por idade (ver abaixo).

## Teto do imóvel por município (Faixas 1 e 2)

`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/mcmv-municipios.json`

O teto das Faixas 1 e 2 **não é por população**: a Caixa define por município, cruzando recorte REGIC
(`A`–`D`) × grupo populacional (`1`–`4`), com regra de transição (vale o maior entre a vigência anterior
e a atual). `municipios[]`: `{ ibge, uf, nome, recorte, grupo, tetoFaixa1e2 }`, ordenado por `ibge`.
`meta`: `fonteUrl` (planilha oficial que o gov.br linka), `fonteSha256`, `vigencia`, `geradoEm`.
Faixa 3 e Classe Média são nacionais — use `mcmv.tetoImovel` do JSON de taxas.

Atualização: o scrape semanal detecta quando o gov.br passa a linkar outra planilha e abre issue
`mcmv-municipios`; aí roda-se `python3 scripts/mcmv-municipios.py '<url>'` e faz-se commit.

## Como um app novo consome (fetch + fallback + staleness)

```ts
import type { RatesPayload } from "./types"; // copie o shape de src/types.ts

const RATES_URL =
  "https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/taxas-financiamento.json";
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
