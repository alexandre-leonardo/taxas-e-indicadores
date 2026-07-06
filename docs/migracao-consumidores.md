# Migração dos consumidores para o motor de taxas

Este repositório passa a ser a fonte única das taxas. Os apps abaixo devem migrar de suas fontes
atuais para o JSON público. **Editar esses repos é etapa posterior — este doc só descreve o como.**

## Os dois arquivos (leia antes de procurar um dado)

O motor publica **dois JSONs independentes**. Procurar o dado no arquivo errado é o engano nº 1
(ex.: buscar o INCC no de taxas — ele mora no de índices). Mapa:

| Arquivo | URL pública (jsDelivr `@main`) | O que tem |
|---|---|---|
| **taxas** | `.../data/taxas-financiamento.json` | taxas de financiamento MCMV/SBPE, TR, poupança, `cotaMaxima`, `mcmv` — tipo `RatesPayload` |
| **índices** | `.../data/indices-historico.json` | histórico mensal de 10 séries do BCB SGS desde 2001 (TR, poupança, SELIC, IPCA, IGP-M, **INCC**, IVG-R, juros habitacional, CDI) |

Base das URLs: `https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main`

URL pública (taxas):
`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/taxas-financiamento.json`

## cotaMaxima — cota máxima de financiamento (novo)

Desde 2026-06-29 o payload traz o **percentual máximo de financiamento SBPE** (cota/LTV) — sem
endpoint novo, é só mais uma chave no mesmo JSON. Quem já faz o `fetch` recebe no próximo refresh.

```jsonc
"cotaMaxima": {
  "sbpe": { "sac": 80, "price": 70 }, // % do valor do imóvel
  "fonteUrl": "https://caixanoticias.caixa.gov.br/...",
  "atualizadoEm": "2026-06-29T00:00:00.000Z"
}
```

Tipo no consumidor (campo **opcional** de propósito — ver fallback abaixo):

```ts
export interface CotaMaxima {
  sbpe: { sac: number; price: number };
  fonteUrl: string;
  atualizadoEm: string; // ISO
}
// em RatesPayload:
cotaMaxima?: CotaMaxima;
```

Uso (`sac`/`price` são percentuais):

```ts
const COTA_FALLBACK = { sac: 80, price: 70 };
const cota = rates.cotaMaxima?.sbpe ?? COTA_FALLBACK;
const financiavel   = valorImovel * (cota.sac / 100); // SAC (Price: cota.price)
const entradaMinima = valorImovel - financiavel;
```

Cuidados:
- **Consumir defensivo:** o campo é aditivo. Um payload antigo em cache do jsDelivr ou o
  `RATES_BOOTSTRAP` de fallback podem não tê-lo → usar `cotaMaxima?` + `?? COTA_FALLBACK` e
  acrescentar `cotaMaxima` ao próprio `RATES_BOOTSTRAP`.
- **Freshness:** `atualizadoEm` só muda quando `sac`/`price` mudam (anti-churn). Pode ser bem mais
  antigo que `meta.retrievedAt` sem ser dado velho (a cota muda ~1×/ano). **Não** aplicar o
  `withStaleness` das taxas à cota.
- **Escopo:** é SBPE (SAC/Price). MCMV não tem cota no payload — lá o limite é entrada mínima +
  subsídio, não este campo.

## mcmv — teto do imóvel + subsídio (novo)

Mesmo JSON, chave nova. `mcmv.tetoImovel` (em reais) e `mcmv.subsidioMaxPorRegiao` (teto por região):

```ts
const teto = rates.mcmv?.tetoImovel.classeMedia;       // 600000
const subsidioMax = rates.mcmv?.subsidioMaxPorRegiao.N; // 65000 (Norte)
```

Ressalvas: `tetoImovel.faixa1e2` é um range nacional (`min`/`max`) — o valor exato por município
vive na **planilha oficial da Caixa** (não ingerida): `TABELA_MUNICIPIOS_VIGENCIA_*.xlsx` em
`https://www.caixa.gov.br/Downloads/fgts-tabela-municipios/` (chave `CO_IBGE`; ~5.572 municípios).
Decidido não raspar por ora (anti-bot exige navegador headless e o dado roda ~1×/ano) — reabrir se
um consumidor precisar de precisão por município. `subsidioMaxPorRegiao` é o **teto** do desconto,
não o valor que cada família recebe (depende de renda/região/valor). Tipar `mcmv?` opcional e ter
fallback, como a `cotaMaxima`.

## indices-historico.json — painel de índices (10 séries BCB)

Arquivo **separado** do de taxas, aditivo e independente do `RatesPayload`. URL:
`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/indices-historico.json`

Shape (`schemaVersion: 1`):

```ts
interface PontoSerie { mes: string; valor: number }          // mes = "YYYY-MM"
interface Indice { nome: string; sgs: number; unidade: string; serie: PontoSerie[] }
interface IndicesPayload {
  schemaVersion: number;
  indices: Record<string, Indice>;   // OBJETO com chave = slug (NÃO é array)
  meta: { fonte: string; sourceUrl: string; desde: string; atualizadoEm: string; contentHash: string };
}
```

Séries disponíveis (a chave é o slug; a série está em `.serie`):

| slug | nome | unidade | SGS |
|---|---|---|---|
| `tr` | Taxa Referencial | `pct_am` | 7811 |
| `poupanca` | Poupança (regra nova) | `pct_am` | 195 |
| `selic` | Selic acumulada no mês | `pct_am` | 4390 |
| `ipca` | IPCA | `pct_am` | 433 |
| `igpm` | IGP-M | `pct_am` | 189 |
| `incc` | INCC | `pct_am` | 192 |
| `ivgr` | IVG-R (preço de imóvel residencial) | `indice` | 21340 |
| `jurosHabMercado` | Juros financ. habitacional (mercado) | `pct_am` | 25497 |
| `jurosHabSfh` | Juros financ. habitacional (SFH) | `pct_aa` | 20773 |
| `cdi` | CDI acumulado no mês | `pct_am` | 4391 |

**Unidades — não confunda:** `pct_am` = % ao mês · `pct_aa` = % ao ano (só `jurosHabSfh`) ·
`indice` = número-índice (nível, ex. IVG-R ~769), **não** percentual. Ler `unidade` antes de formatar.

Consumo:

```ts
const res  = await fetch(INDICES_URL, { cache: "no-store" });
const data = await res.json() as IndicesPayload;
const incc = data.indices.incc.serie;   // [{ mes:"2001-01", valor:0.58 }, … ]
const ultimo = incc.at(-1);             // ponto mais recente
```

Cuidados:
- **Chave é slug num objeto, campo dos pontos é `serie`** — não é array de topo, não é `pontos`.
  Iterar séries: `Object.entries(data.indices)`.
- **Defasagem de publicação é normal.** O BCB divulga IPCA/INCC/IGP-M com ~1–2 meses de atraso; TR,
  SELIC, poupança e CDI chegam no mês corrente. Logo o último `mes` varia por série. **Não** meça
  "desatualizado" exigindo o mês atual — meça pela idade do `fetch` (ou por `meta.atualizadoEm`),
  igual ao `withStaleness` das taxas.
- **Aditivo:** este arquivo nunca altera o `taxas-financiamento.json`. Consumir um não obriga a
  consumir o outro.
- **Fallback opcional:** se o índice for só exibição (gráfico/tabela), um fetch que falha pode
  render vazio — não precisa de snapshot embutido. Só commite um snapshot se o índice virar input de
  cálculo (ex.: correção de parcela por INCC).

## projeto-simuladores

Arquivo: `src/hooks/useFinancingRates.ts` (hoje retorna `RATES_BOOTSTRAP` fixo).

Trocar o `queryFn` por um `fetch` na URL acima, mantendo `RATES_BOOTSTRAP` como fallback e o mesmo
shape de retorno (`{ data, isLoading }`). Aplicar `withStaleness` (ver README) para recalcular
`rulesStale` por idade no cliente. Exemplo:

```ts
queryFn: async () => {
  try {
    const res = await fetch(RATES_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return withStaleness(await res.json());
  } catch {
    return withStaleness(RATES_BOOTSTRAP);
  }
}
```

## engaja-amiz

Hoje é a **fonte** (Edge Functions `financing-rates-sync` + `get-financing-rates` + tabela
`financing_rate_versions`). Deve passar a **consumir** o mesmo JSON público, deixando de manter o
scraper próprio. Migração posterior; sem prazo definido aqui.

## Endpoint legado (referência)

`https://api.engaja.amiz.imb.br/functions/v1/get-financing-rates` permanece no ar como referência
até ser decomissionado após a migração dos consumidores.
