# Fontes avaliadas — por que scrape (e não API)

Registro da investigação de 2026-06-29: procuramos uma **API pública** que servisse os dados que
hoje raspamos, para evitar reabrir essa questão no futuro. **Conclusão: não existe API pública e
confiável.** Scrape do gov.br + LLM para a cota + BCB para indexadores é a melhor abordagem.

## De onde vem cada dado hoje

| Dado | Fonte atual | É API? |
|---|---|---|
| Indexadores (TR, poupança) | BCB SGS (`api.bcb.gov.br` séries 7811, 195) | ✅ Sim |
| Taxas MCMV (faixa/cotista/região) | scrape HTML do gov.br (MCMV Linha Financiada) | ❌ HTML |
| Teto do imóvel + subsídio | scrape HTML do gov.br (mesma página) | ❌ HTML |
| Cota SBPE (SAC 80% / Price 70%) | LLM via OpenRouter (web search) | ❌ LLM |
| Teto por município | não ingerido (ver `migracao-consumidores.md`) | — |

## Fontes avaliadas e descartadas

| Fonte | Resultado |
|---|---|
| **dados.gov.br** (CKAN) | 401 na API; nenhum dataset com nossos números. |
| **Base dos Dados** | Sem dataset; só warehouse de pesquisa. |
| **BCB — séries de taxa habitacional** (SGS 7824/7825) | Congeladas desde 2019. |
| **BCB — Olinda `TaxasJurosMensalPorMes` / SGS 20773-76** | Médias de mercado por instituição (SFH+FGTS+MCMV borrados); sem quebra por faixa/cotista/região. Serve só como *benchmark de mercado*, não substitui a tabela de política. |
| **gov.br Plone REST** (`Accept: application/json`, `++api++`) | 401 (auth) / 404. Não público. |
| **DOU / Imprensa Nacional (in.gov.br)** | Busca devolve HTML/anti-bot; INLABS é XML em massa com cadastro. O ato-fonte é a **Portaria MCID nº 470 (PDF)** — parsear tabela em PDF jurídico é *pior* que o scrape. A página do gov.br é o digesto oficial pensado pra consumo. |
| **Caixa — portal de API** (`developers/api.caixa.gov.br`…) | Não existe (DNS inexistente / 500). |
| **Open Finance Brasil** | Só estatística agregada de mercado; sem termos de produto da Caixa. |
| **Caixa — API do simulador** (`app.novosimulador.caixa.gov.br`) | Devolve cota (SAC 80 / Price 70) e juros **sem auth** via 2 POSTs — mas **cai em anti-bot Azion (403)** sob acesso automatizado (mesmo muro da planilha de municípios). Inviável por `fetch` puro; exigiria navegador headless no CI. **Descartada.** |
| **Planilha de municípios (XLSX)** | Oficial, mas anti-bot Azion (só navegador headless baixa). |

## Por quê

Os três valores "de política" (taxa MCMV, cota SBPE, teto/subsídio) são definidos por
**Portaria/Resolução** e publicados como **prosa (HTML/PDF)**, não como dado estruturado. Os
endpoints estruturados que existem ou estão atrás de auth/anti-bot, ou servem agregados de mercado
que não são a mesma coisa. Por isso:

- **Taxas e teto/subsídio:** scrape do gov.br — é o digesto oficial, estável, pensado pra consumo.
- **Cota SBPE:** LLM com web search — resiliente a mudanças de layout e a única forma de "achar a
  fonte" quando ela muda (a cota não é série temporal nem tem endpoint).
- **Indexadores:** BCB SGS — esses sim têm API pública e estável.

Detalhes da sondagem do simulador da Caixa (payload, anti-bot Azion) estão na memória do projeto.
