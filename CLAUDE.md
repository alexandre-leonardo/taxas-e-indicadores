# taxas-financiamento-caixa

Fonte única de verdade das taxas de financiamento imobiliário (MCMV/SBPE) da Caixa/gov.br.
Serve um JSON estático versionado, atualizado semanalmente por GitHub Action e distribuído via
jsDelivr. Sem banco, sem servidor — o git é o "banco" (cada commit = uma versão auditável).

## Como funciona

- `src/index.ts` (via `npm run scrape`) raspa gov.br (tabela MCMV) + BCB SGS (TR 7811, poupança 195),
  e reescreve `data/taxas-financiamento.json` **somente quando muda** (`src/update.ts:decideUpdate`).
- A GitHub Action (`.github/workflows/update-rates.yml`) roda toda segunda 08h BRT (e sob demanda
  via `workflow_dispatch`), testa, raspa e commita a mudança; depois faz purge do jsDelivr.
- Consumidores leem o JSON via CDN e caem num seed embutido se o fetch falhar.

## Contrato

`data/taxas-financiamento.json` segue o tipo `RatesPayload` (`src/types.ts`) — **idêntico** ao usado
pelo engaja-amiz. Não alterar o shape sem migrar todos os consumidores.

## URL pública

`https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-financiamento-caixa@main/data/taxas-financiamento.json`

## Comandos

- `npm install` — instala deps.
- `npm test` — roda os testes (parser + decisão).
- `npm run scrape` — roda o scraper localmente (escreve `data/` se mudou).

## Regras

- O parser (`src/parser.ts`) é um porte do engaja — calibrado contra fixture real. Mudou o layout
  do gov.br? Atualize a fixture (`test/fixtures/mcmv-govbr.html`) e recalibre os testes.
- Toda taxa publicada passa por `isPlausible` (0 < v < 20). Implausível → a Action falha, não publica.
- Indexadores do BCB têm guarda anti-zero: falha de rede nunca zera bons valores.
