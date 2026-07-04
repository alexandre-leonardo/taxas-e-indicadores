# Runbook — renomear `taxas-financiamento-caixa` → `taxas-e-indicadores`

> **Gate de produção:** os passos **2** e **5** (rename no GitHub + cutover do consumidor)
> mudam a URL pública que o **projeto-simuladores (live em simuladores.amiz.imb.br)** consome.
> O app tem *fallback* offline (seed embutido), então uma janela curta com a URL antiga quebrada
> **não derruba** o simulador — ele serve o snapshot embutido até o cutover. Ainda assim, executar
> só com decisão consciente de janela. Os demais passos são locais e reversíveis.

Nomes de arquivo de dados **não mudam** (`data/taxas-financiamento.json`, `data/indices-historico.json`)
— o consumidor troca só o segmento do repo na URL.

URLs novas (pós-rename):
- Taxas: `https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/taxas-financiamento.json`
- Índices: `https://cdn.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/indices-historico.json`

## Estado atual (2026-07-04 — LER PRIMEIRO)

**Passos 1–4 EXECUTADOS em 2026-07-04.** O repo já se chama `alexandre-leonardo/taxas-e-indicadores`
(rename no GitHub OK; remote local atualizado pelo próprio `gh`; refs internas commitadas em `a1fbd68`
e pushadas). As duas URLs NOVAS do jsDelivr servem 200 (taxas com cota+mcmv; índices com 10 séries).
A URL ANTIGA ainda serve 200 (cache do jsDelivr + redirect do GitHub) — mas não confiar a longo prazo.

**FALTA SÓ O PASSO 5** (cutover do `projeto-simuladores`) — ADIADO a pedido do usuário porque o repo
do simuladores estava mid-feature (branch `feature/salvar-simulacoes`, árvore suja). Sem urgência: o app
segue recebendo dado vivo pela URL antiga enquanto o cache/redirect durar e, quando isso expirar, cai no
snapshot embutido (fresco, janela de 60 dias) — zero downtime. Executar o passo 5 quando o simuladores
estiver num `main` limpo.

## Pré-condição

- [x] Feature do painel mergeada em `main` e no ar. ✔
- [x] `gh auth status` OK (conta `alexandre-leonardo`). ✔
- [ ] OK explícito do usuário para o cutover do `projeto-simuladores` (o rename toca+redeploya um app
  live; o usuário condicionou "renomear se não interferir" — e interfere só nesse projeto). Confirmar antes.

## Passos

**1. Refs internas deste repo** (local, reversível) — commitar em `main`: ✅ FEITO (`a1fbd68`)
- [x] `package.json`: `name` → `taxas-e-indicadores`; `description` → incluir "e índices do mercado imobiliário".
- [x] `CLAUDE.md`: título `# taxas-e-indicadores`; as 2 URLs públicas → `@taxas-e-indicadores`.
- [x] `.github/workflows/update-rates.yml`: as 2 URLs de `purge.jsdelivr.net` → `.../gh/alexandre-leonardo/taxas-e-indicadores@main/...`.
- [x] `docs/migracao-consumidores.md`: URL pública canônica → nome novo.
- [ ] (opcional, NÃO feito) `docs/superpowers/specs|plans/*`: URLs de exemplo (docs históricos datados — deixados como estão).

**2. [GATE] Rename no GitHub:** ✅ FEITO 2026-07-04
- [x] `gh repo rename taxas-e-indicadores --yes`. O GitHub mantém redirect do nome antigo (não confiar nele a longo prazo).
- [x] `git remote set-url origin ...` — o `gh repo rename` já atualizou o remote automaticamente.
- [ ] (opcional, PENDENTE) renomear a pasta local `d:\Projetos Claude\taxas-financiamento-caixa` → `taxas-e-indicadores` (fazer FORA de uma sessão ativa — muda o cwd).

**3. Push das refs internas** (passo 1) para `main` do repo já renomeado. ✅ FEITO (`f97dec8..a1fbd68`).

**4. jsDelivr** — forçar o CDN a ver o novo caminho: ✅ FEITO 2026-07-04
- [x] purge `.../taxas-e-indicadores@main/data/taxas-financiamento.json` (HTTP 200).
- [x] purge `.../taxas-e-indicadores@main/data/indices-historico.json` (HTTP 200).
- [x] Verificado: taxas 200 (publishedAt 28/06/2026, cota.sac=80, mcmv presente); índices 200 (10 séries, arrays `.serie`).

**5. [GATE] Cutover do consumidor `projeto-simuladores`** — ⏸ ADIADO 2026-07-04 (simuladores em `feature/salvar-simulacoes`, árvore suja). Executar num `main` limpo. Trocar a URL e redeployar:
- [ ] `src/hooks/useFinancingRates.ts`: `RATES_URL` → URL de taxas nova.
- [ ] `scripts/refresh-rates.mjs`: `RATES_URL` → URL de taxas nova.
- [ ] (se o simulador for consumir índices) adicionar a URL de índices onde fizer sentido.
- [ ] Menções em `CLAUDE.md` e `docs/handoff-2026-06-29.md` → nome novo.
- [ ] Commit + push → deploy automático (webhook GitHub→Coolify). Confirmar que `simuladores.amiz.imb.br` carrega taxas ao vivo (não o fallback).

**6. Workspace + memória** (local): ✅ FEITO 2026-07-04
- [x] `d:\Projetos Claude\CLAUDE.md`: N/A — o motor não consta da tabela "Projetos ativos" (nada a mudar; grep vazio).
- [x] `...\memory\MEMORY.md` + arquivos: nome/URLs atualizados. (A PASTA de memória mantém o nome — é derivada do caminho local, que não foi renomeado.)

## Rollback

Reverter o rename no GitHub (Settings → renomear de volta) restaura o nome antigo; o redirect do GitHub
cobre ambos os sentidos por um tempo. Reverter o commit de `RATES_URL` no simuladores volta à URL antiga.

## Verificação final

- [ ] `curl` das 2 URLs novas → 200 + JSON.
- [ ] Simuladores carregando dado ao vivo.
- [ ] Nenhuma referência ao nome antigo em `projeto-simuladores` (grep) fora de histórico/handoff.
