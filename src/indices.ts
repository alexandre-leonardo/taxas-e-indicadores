// src/indices.ts
// Entrypoint do painel de índices: lê o JSON atual, busca as séries SGS, decide, escreve se mudou.
// Aditivo: não toca nas taxas. Em falha total de rede não escreve (e NÃO exita 1 — não acopla ao commit das taxas).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decideIndices } from "./update";
import { fetchSerieMensal, fetchPoupancaMensal } from "./sources";
import type { IndicesHistorico, PontoSerie, UnidadeIndice } from "./types";

const DATA_PATH = fileURLToPath(new URL("../data/indices-historico.json", import.meta.url));
const DESDE = "2001-01";
const SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

// As 10 séries. Chave estável (contrato); sgs = código BCB SGS; unidade guia guarda e interpretação.
const SERIES: Record<string, { nome: string; sgs: number; unidade: UnidadeIndice }> = {
  tr: { nome: "Taxa Referencial", sgs: 7811, unidade: "pct_am" },
  poupanca: { nome: "Poupança (regra nova)", sgs: 195, unidade: "pct_am" },
  selic: { nome: "Selic acumulada no mês", sgs: 4390, unidade: "pct_am" },
  ipca: { nome: "IPCA", sgs: 433, unidade: "pct_am" },
  igpm: { nome: "IGP-M", sgs: 189, unidade: "pct_am" },
  incc: { nome: "INCC", sgs: 192, unidade: "pct_am" },
  ivgr: { nome: "IVG-R (preço de imóvel residencial)", sgs: 21340, unidade: "indice" },
  jurosHabMercado: { nome: "Juros financ. habitacional (mercado)", sgs: 25497, unidade: "pct_aa" },
  jurosHabSfh: { nome: "Juros financ. habitacional (SFH)", sgs: 20773, unidade: "pct_aa" },
  cdi: { nome: "CDI acumulado no mês", sgs: 4391, unidade: "pct_am" },
};

function readCurrent(): IndicesHistorico {
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf-8")) as IndicesHistorico;
  } catch {
    // Primeira rodada: sem arquivo → começa vazio (o backfill preenche tudo).
    return {
      schemaVersion: 1,
      indices: {},
      meta: { fonte: "", sourceUrl: "", desde: DESDE, atualizadoEm: "", contentHash: "" },
    };
  }
}

function ddmmaaaa(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Janelas de ≤10 anos cobrindo [iniAno/01/01, hoje]. ponytail: só a poupança (série diária) usa. */
function janelas10(iniAno: number, fim: Date): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const fimAno = fim.getUTCFullYear();
  for (let a = iniAno; a <= fimAno; ) {
    const b = Math.min(a + 9, fimAno);
    out.push([`01/01/${a}`, b === fimAno ? ddmmaaaa(fim) : `31/12/${b}`]);
    a = b + 1;
  }
  return out;
}

async function main(): Promise<void> {
  const now = new Date();
  const ini = `01/${DESDE.slice(5)}/${DESDE.slice(0, 4)}`; // "01/01/2001"
  const fim = ddmmaaaa(now);
  const iniAno = Number(DESDE.slice(0, 4));
  const old = readCurrent();

  const fetched: Record<string, PontoSerie[] | null> = {};
  await Promise.all(
    Object.entries(SERIES).map(async ([chave, cfg]) => {
      fetched[chave] =
        cfg.sgs === 195
          ? await fetchPoupancaMensal(janelas10(iniAno, now))
          : await fetchSerieMensal(cfg.sgs, ini, fim);
    }),
  );

  if (Object.values(fetched).every((v) => v == null)) {
    // ponytail: NÃO é erro fatal — evita acoplar a falha do SGS ao commit das taxas (mesmo job).
    // Não escreve; a anti-corrupção preservaria tudo e a rodada semanal seguinte re-puxa.
    console.warn("[indices] todas as séries falharam (rede?) — mantendo o arquivo atual, sem escrever.");
    return;
  }

  const { changed, payload } = decideIndices(old, fetched, SERIES, now, SGS_URL, DESDE);
  if (!changed) {
    console.log("[indices] unchanged — nada a commitar.");
    return;
  }
  writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  const n = Object.values(payload.indices).reduce((s, x) => s + x.serie.length, 0);
  console.log(
    `[indices] atualizado — ${Object.keys(payload.indices).length} séries, ${n} pontos, desde ${payload.meta.desde}.`,
  );
}

main().catch((e) => {
  console.error("[indices] erro fatal:", e);
  process.exit(1);
});
