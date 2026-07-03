# Design — Painel de índices + renome para `taxas-e-indicadores`

Data: 2026-07-03
Status: aprovado no brainstorming; pendente revisão do spec pelo usuário.

## 1. Motivação

O motor hoje serve só as taxas de financiamento da Caixa/gov.br (MCMV/SBPE). Vamos adicionar
um **painel histórico de índices econômicos** correlacionados com o mercado imobiliário
brasileiro, com histórico longo e atualização mensal automática. Com isso o escopo deixa de ser
"taxas da Caixa" e passa a ser "taxas + indicadores do mercado imobiliário BR" — por isso o
**renome do projeto para `taxas-e-indicadores`** (nome escolhido para acomodar, no futuro, taxas
de outros bancos além da Caixa).

## 2. Escopo

**Dentro:**
- Ingestão de 10 séries do BCB SGS (`api.bcb.gov.br`, a mesma API que o motor já usa).
- Novo arquivo de dados `data/indices-historico.json` (aditivo — **não** altera `RatesPayload`
  nem `data/taxas-financiamento.json`).
- Histórico longo (piso `2001-01`), atualização idempotente pega carona na Action semanal.
- Renome do projeto e atualização do único consumidor vivo (`projeto-simuladores`).

**Fora (futuro):** SELIC-meta headline (432), taxas de outros bancos, IGP-DI/IPA/INPC,
IPCA-Habitação (IBGE SIDRA), FipeZap/IGMI-R/CUB (sem API gratuita). Ver §11.

## 3. Índices e séries (10 séries BCB SGS — todas confirmadas empiricamente em 2026-07-03)

| Chave | Índice | SGS | Unidade | Início real da série |
|---|---|---|---|---|
| `tr` | Taxa Referencial | 7811 | `pct_am` | mar/1991 |
| `poupanca` | Poupança (regra nova) | 195 | `pct_am` | 04/05/2012 |
| `selic` | Selic acumulada no mês | 4390 | `pct_am` | jan/1990 |
| `ipca` | IPCA | 433 | `pct_am` | anos 90 |
| `igpm` | IGP-M | 189 | `pct_am` | anos 90 |
| `incc` | INCC | 192 | `pct_am` | anos 90 |
| `ivgr` | IVG-R (preço de imóvel residencial) | 21340 | `indice` | mar/2001 (base 100) |
| `jurosHabMercado` | Juros financ. habitacional (mercado) | 25497 | `pct_am` | mar/2011 |
| `jurosHabSfh` | Juros financ. habitacional (SFH) | 20773 | `pct_aa` | mar/2011 |
| `cdi` | CDI acumulado no mês | 4391 | `pct_am` | jan/1988 |

Notas de fonte:
- **SELIC = 4390** (acumulada no mês, % a.m.) — comparável às demais séries mensais. A "meta"
  (432, ~14,25% a.a.) fica fora da v1 (ver §11); é série diária e exigiria janelamento.
- **Poupança = 195** (regra nova, correta). É série **diária/aniversário** — ver §6.
- **IVG-R** é **número-índice** (~769), não %. Guarda de plausibilidade própria (§7).

## 4. Janela histórica — piso de data, não cap de 10 anos

Séries **mensais do SGS não têm limite de janela**: um único request devolve todo o histórico
(verificado: 1990–2000 da SELIC num tiro). Logo, em vez de fixar 10 anos, usamos um **piso de
data**:

- Constante `DESDE = "2001-01"` (uma linha, trivial de ajustar).
- Cada série devolve todo o histórico disponível a partir do piso. As macro ganham ~25 anos
  limpos (pós-estabilização); IVG-R vem completo (mar/2001); poupança e juros habitacionais
  começam naturalmente em 2011/2012. O arquivo é "irregular" (ragged) antes de 2012 — honesto e ok.
- **Piso em 2001 é deliberado:** antes de ~1995 os valores são hiperinflacionários (SELIC de
  67%/mês em 1990) — inúteis para comparação imobiliária, e a guarda de plausibilidade (§7) os
  rejeitaria de qualquer modo.

Tamanho estimado do arquivo: ~2.700 pontos ≈ poucas centenas de KB. Confortável para jsDelivr.

## 5. Formato de armazenamento — arquivo novo, aditivo

Novo arquivo `data/indices-historico.json`. **Não toca** em `taxas-financiamento.json` nem no
`RatesPayload` (respeita a regra "não alterar o contrato sem migrar consumidores"). Novo tipo em
`src/types.ts`:

```ts
export type UnidadeIndice = "pct_am" | "pct_aa" | "indice";
export interface PontoSerie { mes: string; valor: number } // mes = "YYYY-MM"
export interface SerieIndice {
  nome: string;
  sgs: number;
  unidade: UnidadeIndice;
  serie: PontoSerie[]; // ordenada por mês asc
}
export interface IndicesHistorico {
  schemaVersion: 1;
  indices: Record<string, SerieIndice>; // chaves: tr, poupanca, selic, ipca, igpm, incc, ivgr, jurosHabMercado, jurosHabSfh, cdi
  meta: {
    fonte: string;      // "BCB SGS (api.bcb.gov.br)"
    sourceUrl: string;  // base da API
    desde: string;      // "2001-01"
    atualizadoEm: string; // ISO 8601
    contentHash: string;  // sha256 do objeto `indices`
  };
}
```

O JSON é auto-descritivo: a tag `unidade` diz ao consumidor como interpretar cada série. O mesmo
arquivo serve os quatro usos declarados: gráfico/comparação usam `pct_am`; correção de valores
compõe os fatores (para `pct_am`/`pct_aa`) ou usa razão de níveis (para `indice`); referência lê
o ponto do mês.

**Um arquivo único** (vs. um por índice): ~10 índices × ~120–300 meses = arquivo pequeno; um
fetch por consumidor, um diff auditável por commit, mesmo padrão "git é o banco". Um-por-índice
só ajudaria se ficassem enormes (não ficam) e atrapalharia o uso principal, que é **comparar**.

## 6. Ingestão — re-puxa tudo, idempotente

Novo entrypoint `src/indices.ts` + script `npm run indices`. **Não** altera `src/index.ts` (taxas).

Fluxo (espelha a filosofia do `decideUpdate` atual):
1. Lê `data/indices-historico.json` atual (seed commitado).
2. Para cada série, `fetchSeriesHistory(sgs, DESDE, hoje)` — **re-puxa o histórico mensal
   completo** (séries mensais = 1 request; sem lógica incremental frágil). É auto-curativo: pega
   revisões do SGS e preenche buracos sozinho.
3. Normaliza: `data` `"DD/MM/AAAA"` → `mes` `"YYYY-MM"`; `valor` string com **ponto** decimal
   → `number` (negativos ocorrem, ex.: IGP-M).
4. Aplica guardas (§7) e decide via `contentHash` (sha256 do objeto `indices`) — reescreve
   **só se mudou**, exatamente como o motor de taxas.

**Poupança (série 195) — a exceção:** é diária/aniversário e tem cap de 10 anos por request.
Tratamento: buscar em janelas de ≤10 anos (a série só existe desde 05/2012, então ≤2 janelas) e
extrair **o ponto mensal representativo** (registro datado do dia `01` de cada mês = rendimento
do 1º aniversário). **Sem retry dedicado** (ponytail): 502 transitório → série preservada pela
anti-corrupção e a rodada semanal seguinte re-puxa; no backfill inicial, basta re-rodar
`npm run indices`. É a única série com caminho especial; todas as outras (mensais) usam o simples.

`fetchSeriesHistory` mora em `src/sources.ts`, nunca lança (retorna `null`/`[]` em erro), como o
`fetchBcbMonthly` existente. A decisão (`decideIndices`) fica em `src/update.ts` (lógica pura,
testável sem I/O).

## 7. Guardas de plausibilidade por unidade + anti-corrupção

Cada série carrega sua faixa (o `isPlausible` atual `0<v<20` barraria IVG-R e valores negativos):

| Unidade | Faixa plausível | Racional |
|---|---|---|
| `pct_am` | `-10 < v < 10` | IGP-M tem meses negativos e picos ~+4% |
| `pct_aa` | `0 < v < 50` | juros habitacional (~8–14% a.a.) |
| `indice` | `50 < v < 5000` | IVG-R ≈ 769 |

**Anti-corrupção** (herda a filosofia anti-zero do motor):
- Ponto do mês implausível/faltante → **preserva o valor já gravado** para aquele mês (se houver);
  não sobrescreve histórico bom com lixo.
- Falha total do fetch de uma série (`null`) → **preserva a série inteira** anterior.
- Falha de rede nunca zera nem apaga dados bons. A guarda também é o mecanismo que barra
  automaticamente eventual ingestão pré-1995 (hiperinflação) caso o piso seja recuado.

## 8. Atualização automática — carona na Action semanal

Estender `.github/workflows/update-rates.yml`:
- Passo novo que roda `npm run indices` (depois do scrape de taxas).
- `git add data/indices-historico.json` + commit se mudou (o commit da Action pega ambos os
  arquivos que mudarem na rodada).
- Purge do jsDelivr para a URL do arquivo novo.

Índices são mensais → na maioria das semanas dá **no-op** (sem commit), como o motor de taxas
já faz. **Sem cron novo** (YAGNI): a rodada semanal pega o valor do mês novo em até 1 semana da
publicação — de sobra para dado mensal.

## 9. Renome do projeto → `taxas-e-indicadores`

Blast radius medido: **`projeto-simuladores` é o único consumidor vivo** (fetch da URL do CDN em
`src/hooks/useFinancingRates.ts` e `scripts/refresh-rates.mjs`, mesma constante `RATES_URL`);
`engaja-amiz` **não** referencia o motor.

Passos (vão para o plano de implementação):
1. **Manter os nomes dos arquivos de dados** (`data/taxas-financiamento.json` e o novo
   `data/indices-historico.json`) — assim o consumidor só troca o segmento do repo na URL.
2. Renomear repo no GitHub → `taxas-e-indicadores` (o GitHub redireciona o nome antigo, mas não
   confiar nisso a longo prazo para o jsDelivr).
3. Renomear a pasta local, atualizar `package.json` (name/description) e o `CLAUDE.md` deste repo.
4. Atualizar `d:\Projetos Claude\CLAUDE.md` (tabela de projetos ativos + URLs).
5. Atualizar `projeto-simuladores`: `RATES_URL` (2 arquivos) para a URL nova + menções em
   `CLAUDE.md`/handoff.
6. Atualizar a memória (`MEMORY.md` + arquivos) com o nome novo.

## 10. Testes (Vitest, como hoje)

- **Fixtures** de resposta real do SGS: uma série mensal (ex.: IPCA), a série diária/aniversário
  (poupança 195) e o número-índice (IVG-R 21340).
- **Unitários:**
  - `parseSgs`: `"DD/MM/AAAA"` → `"YYYY-MM"`, decimal com ponto, valor negativo.
  - Extração mensal da série diária da poupança (pega o registro do dia `01`).
  - Guardas de plausibilidade por unidade (limites de cada faixa).
  - Anti-corrupção: ponto implausível preserva o anterior; fetch `null` preserva a série.
  - `decideIndices` idempotente: mesmo input → `changed=false`.

## 11. Fora de escopo (futuro)

- **SELIC-meta (432)** como número-manchete — fácil de adicionar (série diária, precisa
  janelamento). Só se houver demanda pelo headline além do comparável mensal (4390).
- **Taxas de outros bancos** — o nome `taxas-e-indicadores` acomoda; não agora.
- **IGP-DI (190), IPA (225), INPC (188)** — baixo ganho marginal frente aos já incluídos.
- **IPCA-Habitação** (IBGE SIDRA, tabela 7060) — endpoint diferente; só se quiser granularidade
  do custo de morar.
- **FipeZap, IGMI-R, CUB** — sem API gratuita (scrape frágil / PDF por estado / licenciamento).

## 12. Riscos

- **502 transitórios do SGS** em janelas grandes/diárias (sobretudo poupança 195) → sem retry
  dedicado; a anti-corrupção preserva o dado e a rodada semanal seguinte re-puxa (a re-rodada é
  o retry).
- **Descontinuação/renome de série no SGS** → anti-corrupção preserva o último bom; a série
  simplesmente para de crescer (visível no diff).
- **Cache do jsDelivr após o renome** → purge + atualização do consumidor resolvem.
```
