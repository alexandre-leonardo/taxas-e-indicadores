# Graph Report - .  (2026-07-04)

## Corpus Check
- 31 files · ~50,510 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 132 nodes · 226 edges · 15 communities (11 shown, 4 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.81)
- Token cost: 165,853 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Tipos & Contrato (RatesPayload)|Tipos & Contrato (RatesPayload)]]
- [[_COMMUNITY_Fetch Índices BCB SGS|Fetch Índices BCB SGS]]
- [[_COMMUNITY_Config do Pacote (npm)|Config do Pacote (npm)]]
- [[_COMMUNITY_Scraper & Parser gov.br|Scraper & Parser gov.br]]
- [[_COMMUNITY_Config TypeScript|Config TypeScript]]
- [[_COMMUNITY_Séries BCB & Consumidores|Séries BCB & Consumidores]]
- [[_COMMUNITY_Extração gov.br & Plausibilidade|Extração gov.br & Plausibilidade]]
- [[_COMMUNITY_Arquitetura & Distribuição (CICDN)|Arquitetura & Distribuição (CI/CDN)]]
- [[_COMMUNITY_Decisão de Update & Guardas|Decisão de Update & Guardas]]
- [[_COMMUNITY_Docs Motor de Taxas & Migração|Docs: Motor de Taxas & Migração]]
- [[_COMMUNITY_Cota via LLM & Fontes Descartadas|Cota via LLM & Fontes Descartadas]]
- [[_COMMUNITY_Docs Cota Máxima SBPE|Docs: Cota Máxima SBPE]]
- [[_COMMUNITY_Docs MCMV Teto + Subsídio|Docs: MCMV Teto + Subsídio]]
- [[_COMMUNITY_CLAUDE|CLAUDE.md]]
- [[_COMMUNITY_README|README]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 10 edges
2. `main()` - 9 edges
3. `RatesPayload (contrato público)` - 9 edges
4. `main()` - 7 edges
5. `decideUpdate()` - 7 edges
6. `decideUpdate (decisão pura, escreve só se mudou)` - 7 edges
7. `decideIndices()` - 6 edges
8. `parseMcmvRatesHtml (parser gov.br, porte do engaja)` - 6 edges
9. `parseMcmvRatesHtml()` - 5 edges
10. `fetchSerieMensal()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Git é o banco (arquitetura sem servidor)` --rationale_for--> `GitHub Action: update-rates.yml`  [INFERRED]
  docs/superpowers/specs/2026-06-27-taxas-financiamento-caixa-design.md → .github/workflows/update-rates.yml
- `GitHub Action: update-rates.yml` --references--> `decideUpdate (decisão pura, escreve só se mudou)`  [INFERRED]
  .github/workflows/update-rates.yml → docs/superpowers/specs/2026-06-27-taxas-financiamento-caixa-design.md
- `GitHub Action: update-rates.yml` --references--> `OpenRouter (LLM API OpenAI-compatible + web search)`  [EXTRACTED]
  .github/workflows/update-rates.yml → docs/superpowers/specs/2026-06-29-cota-maxima-financiamento-design.md
- `Fixture HTML gov.br MCMV (~174 KB)` --references--> `parseMcmvRatesHtml (parser gov.br, porte do engaja)`  [INFERRED]
  test/fixtures/mcmv-govbr.html → docs/superpowers/specs/2026-06-27-taxas-financiamento-caixa-design.md
- `jsDelivr CDN (distribuição do JSON)` --conceptually_related_to--> `RatesPayload (contrato público)`  [INFERRED]
  README.md → docs/superpowers/specs/2026-06-27-taxas-financiamento-caixa-design.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Fluxo de decisão das taxas (parse -> guarda -> decideUpdate)** — docs_superpowers_specs_2026_06_27_taxas_financiamento_caixa_design_parsemcmvrateshtml, docs_superpowers_specs_2026_06_27_taxas_financiamento_caixa_design_isplausible, docs_superpowers_specs_2026_06_27_taxas_financiamento_caixa_design_decideupdate, docs_superpowers_specs_2026_06_27_taxas_financiamento_caixa_design_guarda_anti_zero, docs_superpowers_specs_2026_06_27_taxas_financiamento_caixa_design_contenthash [EXTRACTED 0.90]
- **Fluxo de extração da cota SBPE (LLM -> parse -> guarda -> campo)** — docs_superpowers_specs_2026_06_29_cota_maxima_financiamento_design_fetchcotamaxima, docs_superpowers_specs_2026_06_29_cota_maxima_financiamento_design_openrouter, docs_superpowers_specs_2026_06_29_cota_maxima_financiamento_design_parsecotaresponse, docs_superpowers_specs_2026_06_29_cota_maxima_financiamento_design_iscotaplausible, docs_superpowers_specs_2026_06_29_cota_maxima_financiamento_design_cotamaxima [EXTRACTED 0.90]
- **Pipeline do painel de índices (fetch -> normaliza -> guarda -> merge -> decide)** — docs_superpowers_plans_2026_07_03_painel_indices_normalizesgsrows, docs_superpowers_plans_2026_07_03_painel_indices_fetchpoupancamensal, docs_superpowers_specs_2026_07_03_taxas_e_indicadores_design_ispontoplausivel, docs_superpowers_specs_2026_07_03_taxas_e_indicadores_design_mergeserie, docs_superpowers_specs_2026_07_03_taxas_e_indicadores_design_decideindices, docs_superpowers_specs_2026_07_03_taxas_e_indicadores_design_indiceshistorico [EXTRACTED 0.90]

## Communities (15 total, 4 thin omitted)

### Community 0 - "Tipos & Contrato (RatesPayload)"
Cohesion: 0.16
Nodes (23): CotaMaxima, CotaRaw, IndexersRaw, IndicesHistorico, McmvLimits, ParsedRates, PontoSerie, RateByCotistaRegion (+15 more)

### Community 1 - "Fetch Índices BCB SGS"
Cohesion: 0.23
Nodes (14): DATA_PATH, ddmmaaaa(), janelas10(), main(), readCurrent(), SERIES, fetchBcbMonthly(), fetchCotaMaxima() (+6 more)

### Community 2 - "Config do Pacote (npm)"
Cohesion: 0.12
Nodes (15): description, devDependencies, tsx, @types/node, typescript, vitest, license, name (+7 more)

### Community 3 - "Scraper & Parser gov.br"
Cohesion: 0.32
Nodes (10): DATA_PATH, main(), readCurrent(), isPlausible(), parseMcmvLimits(), parseMcmvRatesHtml(), pct(), pctsAfter() (+2 more)

### Community 4 - "Config TypeScript"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, resolveJsonModule, skipLibCheck, strict (+3 more)

### Community 5 - "Séries BCB & Consumidores"
Cohesion: 0.31
Nodes (9): BCB SGS (api.bcb.gov.br, séries temporais), projeto-simuladores (consumidor vivo), fetchPoupancaMensal (janelas <=10a, colapsa a 1 ponto/mês), normalizeSgsRows (parser puro DD/MM/AAAA->YYYY-MM), RatesPayload (contrato público), cotaMaxima (cota SBPE SAC 80 / Price 70), parseCotaResponse (parser puro do JSON do LLM), IndicesHistorico (painel de 10 séries BCB SGS) (+1 more)

### Community 6 - "Extração gov.br & Plausibilidade"
Cohesion: 0.38
Nodes (7): Página gov.br MCMV Linha Financiada (fonte oficial), Decisão: scrape do gov.br (não há API pública confiável), isPlausible (0 < v < 20), parseMcmvRatesHtml (parser gov.br, porte do engaja), parseMcmvLimits (parser determinístico, sem LLM), isPontoPlausivel (plausibilidade por unidade), Fixture HTML gov.br MCMV (~174 KB)

### Community 7 - "Arquitetura & Distribuição (CI/CDN)"
Cohesion: 0.29
Nodes (7): Runbook: rename para taxas-e-indicadores, Plano: painel de índices, Git é o banco (arquitetura sem servidor), Spec: painel de índices + rename, Renome do projeto para taxas-e-indicadores, GitHub Action: update-rates.yml, jsDelivr CDN (distribuição do JSON)

### Community 8 - "Decisão de Update & Guardas"
Cohesion: 0.38
Nodes (7): contentHash (sha256 do parsed, detecção de mudança), decideUpdate (decisão pura, escreve só se mudou), Guarda anti-zero (indexadores BCB), isCotaPlausible (30-100, price<=sac, domínio gov.br), isMcmvPlausible (tetos 50k-5M, subsídios 1k-500k), decideIndices (decisão pura, idempotente via contentHash), mergeSerie (merge anti-corrupção preserva dado bom)

### Community 9 - "Docs: Motor de Taxas & Migração"
Cohesion: 0.40
Nodes (6): Fontes avaliadas (scrape vs API), Migração dos consumidores, engaja-amiz (fonte original / futuro consumidor), Handoff 2026-06-27, Plano: motor de taxas, Spec: motor de taxas compartilhado

### Community 10 - "Cota via LLM & Fontes Descartadas"
Cohesion: 0.40
Nodes (5): API simulador Caixa (anti-bot Azion 403, descartada), Planilha de municípios Caixa (não ingerida, anti-bot), fetchCotaMaxima (extração LLM via OpenRouter + web search), OpenRouter (LLM API OpenAI-compatible + web search), mcmv (teto do imóvel + subsídio máximo por região)

## Knowledge Gaps
- **43 isolated node(s):** `name`, `version`, `private`, `type`, `description` (+38 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RatesPayload (contrato público)` connect `Séries BCB & Consumidores` to `Decisão de Update & Guardas`, `Docs: Motor de Taxas & Migração`, `Cota via LLM & Fontes Descartadas`, `Arquitetura & Distribuição (CI/CDN)`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `engaja-amiz (fonte original / futuro consumidor)` connect `Docs: Motor de Taxas & Migração` to `Séries BCB & Consumidores`, `Extração gov.br & Plausibilidade`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `projeto-simuladores (consumidor vivo)` connect `Séries BCB & Consumidores` to `Docs: Motor de Taxas & Migração`, `Arquitetura & Distribuição (CI/CDN)`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `RatesPayload (contrato público)` (e.g. with `BCB SGS (api.bcb.gov.br, séries temporais)` and `decideUpdate (decisão pura, escreve só se mudou)`) actually correct?**
  _`RatesPayload (contrato público)` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _45 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Config do Pacote (npm)` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._