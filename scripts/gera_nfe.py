#!/usr/bin/env python3
"""Gera XMLs de NF-e simplificados para teste, com chave de acesso valida (DV mod 11)."""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "test-data")
os.makedirs(OUT, exist_ok=True)

def dv_mod11(chave43: str) -> str:
    pesos, soma = [2, 3, 4, 5, 6, 7, 8, 9], 0
    for i, dig in enumerate(reversed(chave43)):
        soma += int(dig) * pesos[i % 8]
    resto = soma % 11
    return "0" if resto in (0, 1) else str(11 - resto)

def chave(cuf, aamm, cnpj, serie, nnf, cnf):
    base = f"{cuf}{aamm}{cnpj}55{serie:0>3}{nnf:0>9}1{cnf:0>8}"
    return base + dv_mod11(base)

def xml_nfe(ch, nnf, cnpj_emit, nome_emit, cfop, ncm, qtd, vunit, vprod, vicms, vipi, vnf, xped, nitemped):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe{ch}" versao="4.00">
      <ide><cUF>31</cUF><natOp>VENDA DE PRODUCAO</natOp><mod>55</mod>
        <serie>1</serie><nNF>{nnf}</nNF><dhEmi>2026-07-01T09:00:00-03:00</dhEmi>
        <tpNF>1</tpNF><idDest>1</idDest><cMunFG>3106200</cMunFG></ide>
      <emit><CNPJ>{cnpj_emit}</CNPJ><xNome>{nome_emit}</xNome>
        <enderEmit><xMun>Belo Horizonte</xMun><UF>MG</UF></enderEmit>
        <IE>0623456789</IE><CRT>3</CRT></emit>
      <dest><CNPJ>11222333000181</CNPJ><xNome>Industria Compradora SA</xNome>
        <enderDest><xMun>Contagem</xMun><UF>MG</UF></enderDest></dest>
      <det nItem="1">
        <prod><cProd>MAT-CHAPA-AC01</cProd><xProd>CHAPA DE ACO 1020 3MM</xProd>
          <NCM>{ncm}</NCM><CFOP>{cfop}</CFOP><uCom>PC</uCom>
          <qCom>{qtd:.4f}</qCom><vUnCom>{vunit:.2f}</vUnCom><vProd>{vprod:.2f}</vProd>
          <xPed>{xped}</xPed><nItemPed>{nitemped}</nItemPed></prod>
        <imposto>
          <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>{vprod:.2f}</vBC>
            <pICMS>18.00</pICMS><vICMS>{vicms:.2f}</vICMS></ICMS00></ICMS>
          <IPI><IPITrib><CST>50</CST><vBC>{vprod:.2f}</vBC>
            <pIPI>5.00</pIPI><vIPI>{vipi:.2f}</vIPI></IPITrib></IPI>
        </imposto>
      </det>
      <total><ICMSTot><vBC>{vprod:.2f}</vBC><vICMS>{vicms:.2f}</vICMS>
        <vIPI>{vipi:.2f}</vIPI><vProd>{vprod:.2f}</vProd><vNF>{vnf:.2f}</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>
"""

CNPJ_OK = "12345678000199"   # = FORN1000 no cadastro do mock

cenarios = [
    # (arquivo, nNF, cnpj, cfop, qtd, vunit, icms_pct_ok, descricao)
    ("nfe_01_ok.xml",               1234, CNPJ_OK,          "5102", 100, 250.00, True,
     "Happy path: tudo bate -> MIGO + MIRO"),
    ("nfe_02_preco_divergente.xml", 1235, CNPJ_OK,          "5102", 100, 275.00, True,
     "Preco unitario 275 vs 250 do pedido -> three-way match falha"),
    ("nfe_03_cfop_invalido.xml",    1236, CNPJ_OK,          "5551", 100, 250.00, True,
     "CFOP 5551 (venda ativo imobilizado) incompativel com entrada p/ industrializacao"),
    ("nfe_04_cnpj_divergente.xml",  1237, "99888777000166", "5102", 100, 250.00, True,
     "CNPJ do emitente nao e o do fornecedor do pedido"),
    ("nfe_05_imposto_errado.xml",   1238, CNPJ_OK,          "5102", 100, 250.00, False,
     "ICMS destacado com aliquota errada (12% em operacao interna MG que deveria ser 18%)"),
]

for arq, nnf, cnpj, cfop, qtd, vunit, icms_ok, desc in cenarios:
    vprod = qtd * vunit
    vicms = vprod * (0.18 if icms_ok else 0.12)
    vipi = vprod * 0.05
    vnf = vprod + vipi
    ch = chave("31", "2607", cnpj, 1, nnf, nnf * 10)
    xml = xml_nfe(ch, nnf, cnpj, "Metalurgica Horizonte Ltda", cfop, "72085100",
                  qtd, vunit, vprod, vicms, vipi, vnf, "4500000101", "10")
    with open(os.path.join(OUT, arq), "w") as f:
        f.write(xml)
    print(f"{arq}: chave={ch}  ({desc})")
