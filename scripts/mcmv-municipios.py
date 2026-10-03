#!/usr/bin/env python3
"""Gera data/mcmv-municipios.json a partir da tabela oficial da Caixa (Agente Operador do FGTS).

Uso (rodar à mão quando o detector do scrape abrir issue "mcmv-municipios"):
    python3 scripts/mcmv-municipios.py <URL do .xlsx que o gov.br linka>

Só biblioteca padrão: o .xlsx é um zip de XML. A Caixa bloqueia robô com redirect em loop sem
cookie — por isso o download usa um CookieJar.

Publica SÓ o teto de valor do imóvel das Faixas 1 e 2 por município (coluna
VLR_LIMITE_HAB_POPULAR_ATE_4700). As colunas de Faixa 3 (350 mil) e Classe Média (500 mil) e os
cortes de renda 4.700/8.600 da planilha estão defasados em relação ao gov.br (Portaria MCID 333,
abr/2026: 400 mil / 600 mil, renda 5.000 / 9.600) — esses vêm do gov.br, em taxas-financiamento.json.
"""
import hashlib
import http.cookiejar
import io
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
COL_TETO = "VLR_LIMITE_HAB_POPULAR_ATE_4700"  # prefixo: o cabeçalho real tem "(a partir de ...)"
OUT = Path(__file__).resolve().parent.parent / "data" / "mcmv-municipios.json"


def baixar(url: str) -> bytes:
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.addheaders = [("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36")]
    with opener.open(url, timeout=60) as r:
        return r.read()


def linhas(z: zipfile.ZipFile, sheet: str, ss: list[str]):
    """Linhas como {letra_da_coluna: valor} — células vazias são omitidas no XML, então nunca por posição."""
    for row in ET.fromstring(z.read(sheet)).iter(M + "row"):
        d = {}
        for c in row.findall(M + "c"):
            v = c.find(M + "v")
            val = None if v is None else v.text
            if c.get("t") == "s" and val is not None:
                val = ss[int(val)]
            d[re.match(r"[A-Z]+", c.get("r")).group()] = val
        yield d


def gerar(xlsx: bytes, url: str) -> dict:
    z = zipfile.ZipFile(io.BytesIO(xlsx))
    ss = ["".join(t.text or "" for t in si.iter(M + "t"))
          for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si")]
    rs = list(linhas(z, "xl/worksheets/sheet1.xml", ss))  # 1ª aba: TABELA MUNICÍPIOS
    col = {}
    for letra, nome in rs[0].items():
        col[nome.split(" (")[0].strip() if nome else nome] = letra
    req = ["CO_PERIODO", "SG_UF", "CO_IBGE", "NO_MUNICIPIO", "CO_RECORTE", "CO_GRUPO_REGIONAL", COL_TETO]
    falta = [c for c in req if c not in col]
    if falta:
        sys.exit(f"layout mudou: colunas ausentes {falta} — recalibre o gerador")

    dados = [r for r in rs[1:] if (r.get(col["CO_PERIODO"]) or "").isdigit()]
    municipios = []
    for r in dados:
        teto = int(r[col[COL_TETO]])
        if not 50_000 <= teto <= 1_000_000:
            sys.exit(f"teto implausível {teto} em {r[col['NO_MUNICIPIO']]}/{r[col['SG_UF']]}")
        municipios.append({
            "ibge": int(r[col["CO_IBGE"]]),
            "uf": r[col["SG_UF"]],
            "nome": r[col["NO_MUNICIPIO"]],
            "recorte": r[col["CO_RECORTE"]],
            "grupo": int(r[col["CO_GRUPO_REGIONAL"]]),
            "tetoFaixa1e2": teto,
        })
    municipios.sort(key=lambda m: m["ibge"])
    if len(municipios) < 5500 or len({m["ibge"] for m in municipios}) != len(municipios):
        sys.exit(f"esperava ~5.570 municípios únicos, veio {len(municipios)}")

    periodo = {r[col["CO_PERIODO"]] for r in dados}
    if len(periodo) != 1:
        sys.exit(f"mais de um CO_PERIODO na planilha: {periodo}")
    p = periodo.pop()
    return {
        "schemaVersion": 1,
        "meta": {
            "fonteUrl": url,
            "fonteSha256": hashlib.sha256(xlsx).hexdigest(),
            "vigencia": f"{p[:4]}-{p[4:6]}-{p[6:]}",
            "geradoEm": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "aplicaA": "Faixas 1 e 2 do MCMV (renda familiar até o teto da Faixa 2 publicado pelo gov.br)",
            "regra": "Teto por recorte REGIC (A–D) × grupo populacional (1–4) da Caixa; municípios em "
                     "transição mantêm o maior valor entre a vigência anterior e a atual "
                     "(Res. CCFGTS 1.132/2025 e 1.138/2025).",
        },
        "municipios": municipios,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    url = sys.argv[1]
    out = gerar(baixar(url), url)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT}: {len(out['municipios'])} municípios, vigência {out['meta']['vigencia']}")
