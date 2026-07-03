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

## Pré-condição

- [ ] Feature `feature/painel-indices` mergeada em `main` (o painel de índices já vive em `main`).
- [ ] `gh auth status` OK (ou fazer o rename pela UI do GitHub).

## Passos

**1. Refs internas deste repo** (local, reversível) — commitar em `main`:
- [ ] `package.json`: `name` → `taxas-e-indicadores`; `description` → incluir "e índices do mercado imobiliário".
- [ ] `CLAUDE.md`: título `# taxas-e-indicadores`; as 2 URLs públicas → `@taxas-e-indicadores`.
- [ ] `.github/workflows/update-rates.yml`: as 2 URLs de `purge.jsdelivr.net` → `.../gh/alexandre-leonardo/taxas-e-indicadores@main/...`.
- [ ] (opcional) `docs/superpowers/specs|plans/*`: URLs de exemplo.

**2. [GATE] Rename no GitHub:**
- [ ] `gh repo rename taxas-e-indicadores` (ou Settings → Repository name). O GitHub mantém redirect do nome antigo (não confiar nele a longo prazo).
- [ ] `git remote set-url origin https://github.com/alexandre-leonardo/taxas-e-indicadores.git`
- [ ] (opcional) renomear a pasta local `d:\Projetos Claude\taxas-financiamento-caixa` → `taxas-e-indicadores` (fazer FORA de uma sessão ativa — muda o cwd).

**3. Push das refs internas** (passo 1) para `main` do repo já renomeado.

**4. jsDelivr** — forçar o CDN a ver o novo caminho:
- [ ] `curl -sf https://purge.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/taxas-financiamento.json`
- [ ] `curl -sf https://purge.jsdelivr.net/gh/alexandre-leonardo/taxas-e-indicadores@main/data/indices-historico.json`
- [ ] Verificar que ambas as URLs novas servem 200 com JSON válido.

**5. [GATE] Cutover do consumidor `projeto-simuladores`** — trocar a URL e redeployar:
- [ ] `src/hooks/useFinancingRates.ts`: `RATES_URL` → URL de taxas nova.
- [ ] `scripts/refresh-rates.mjs`: `RATES_URL` → URL de taxas nova.
- [ ] (se o simulador for consumir índices) adicionar a URL de índices onde fizer sentido.
- [ ] Menções em `CLAUDE.md` e `docs/handoff-2026-06-29.md` → nome novo.
- [ ] Commit + push → deploy automático (webhook GitHub→Coolify). Confirmar que `simuladores.amiz.imb.br` carrega taxas ao vivo (não o fallback).

**6. Workspace + memória** (local):
- [ ] `d:\Projetos Claude\CLAUDE.md`: tabela "Projetos ativos" + URLs → nome novo.
- [ ] `C:\Users\alese\.claude\projects\...\memory\MEMORY.md` + arquivos: substituir o nome antigo.

## Rollback

Reverter o rename no GitHub (Settings → renomear de volta) restaura o nome antigo; o redirect do GitHub
cobre ambos os sentidos por um tempo. Reverter o commit de `RATES_URL` no simuladores volta à URL antiga.

## Verificação final

- [ ] `curl` das 2 URLs novas → 200 + JSON.
- [ ] Simuladores carregando dado ao vivo.
- [ ] Nenhuma referência ao nome antigo em `projeto-simuladores` (grep) fora de histórico/handoff.
