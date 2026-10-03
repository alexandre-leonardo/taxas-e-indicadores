# taxas-e-indicadores

Fonte única de verdade das taxas de financiamento imobiliário (MCMV/SBPE) da Caixa/gov.br.
Serve um JSON estático versionado, atualizado semanalmente por GitHub Action e distribuído via
jsDelivr. Sem banco, sem servidor — o git é o "banco" (cada commit = uma versão auditável).

## Como funciona

- `src/index.ts` (via `npm run scrape`) raspa gov.br (tabela MCMV) + BCB SGS (TR 7811, poupança 195),
  e reescreve `data/taxas-financiamento.json` **somente quando muda** (`src/update.ts:decideUpdate`).
- A cota máxima SBPE (`cotaMaxima`, SAC/Price) é uma constante revisada por humano
  (`src/update.ts:COTA_VIGENTE`, `atualizadoEm` = início da vigência). O LLM NÃO publica número —
  até 10/2026 ele publicava e inventava 70/50 citando um FAQ que só diz "até 90%". Hoje o LLM
  (OpenRouter + web search, `src/sources.ts:vigiarCota`) só vigia: procura notícia de mudança
  posterior à vigência e, se o filtro `avaliarAlertaCota` achar crível, o workflow abre/comenta uma
  issue com label `cota-sbpe`. Confirmou? Edite `COTA_VIGENTE`, push e rode a Action (publica + purge).
  Sem `OPENROUTER_API_KEY` o vigia só não roda.
- Os limites do MCMV (`mcmv`: teto do imóvel por faixa + subsídio máximo por região) saem por parser
  determinístico do MESMO HTML do gov.br (`src/parser.ts:parseMcmvLimits`), sem LLM. Guarda
  `src/update.ts:isMcmvPlausible` preserva o valor anterior se o layout mudar.
- O painel de índices (`data/indices-historico.json`, via `npm run indices` → `src/indices.ts`) puxa
  10 séries do BCB SGS (TR, poupança, SELIC, IPCA, IGP-M, INCC, IVG-R, juros habitacional mercado+SFH,
  CDI) desde 2001, re-puxando o histórico inteiro a cada rodada (idempotente via `contentHash`). Guarda
  por unidade (`src/update.ts:isPontoPlausivel`) e merge anti-corrupção (`mergeSerie`) preservam dado
  bom quando o fetch falha. Aditivo — não toca no `RatesPayload`. (Poupança/série 195 é diária: puxada
  em janelas ≤10a e colapsada a 1 ponto/mês.)
- A GitHub Action (`.github/workflows/update-rates.yml`) roda toda segunda 08h BRT (e sob demanda
  via `workflow_dispatch`), testa, raspa e commita a mudança; depois faz purge do jsDelivr.
- Consumidores leem o JSON via CDN e caem num seed embutido se o fetch falhar.

## Contrato

`data/taxas-financiamento.json` segue o tipo `RatesPayload` (`src/types.ts`) — **idêntico** ao usado
pelo engaja-amiz. Não alterar o shape sem migrar todos os consumidores.

## URL pública

Taxas:
`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/taxas-financiamento.json`

Índices (histórico):
`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/indices-historico.json`

## Comandos

- `npm install` — instala deps.
- `npm test` — roda os testes (parser + decisão + índices).
- `npm run scrape` — roda o scraper de taxas localmente (escreve `data/` se mudou).
- `npm run indices` — puxa/atualiza o painel de índices (escreve `data/indices-historico.json` se mudou).

## Regras

- O parser (`src/parser.ts`) é um porte do engaja — calibrado contra fixture real. Mudou o layout
  do gov.br? Atualize a fixture (`test/fixtures/mcmv-govbr.html`) e recalibre os testes.
- Toda taxa publicada passa por `isPlausible` (0 < v < 20). Implausível → a Action falha, não publica.
- Indexadores do BCB têm guarda anti-zero: falha de rede nunca zera bons valores.
- A cota SBPE nunca vem de LLM: só muda editando `COTA_VIGENTE`. O vigia apenas abre issue.
