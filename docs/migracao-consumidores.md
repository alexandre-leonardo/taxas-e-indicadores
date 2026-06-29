# Migração dos consumidores para o motor de taxas

Este repositório passa a ser a fonte única das taxas. Os apps abaixo devem migrar de suas fontes
atuais para o JSON público. **Editar esses repos é etapa posterior — este doc só descreve o como.**

URL pública:
`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json`

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
