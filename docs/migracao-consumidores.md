# Migração dos consumidores para o motor de taxas

Este repositório passa a ser a fonte única das taxas. Os apps abaixo devem migrar de suas fontes
atuais para o JSON público. **Editar esses repos é etapa posterior — este doc só descreve o como.**

URL pública:
`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json`

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
