#!/usr/bin/env python3
"""Gera XMLs de NF-e simplificados para teste, com chave de acesso e CNPJ validos.

Nota: os XMLs sao uma versao reduzida do leiaute 4.00 (sem protNFe, sem assinatura
digital e sem os grupos de PIS/COFINS). O objetivo e exercitar as regras de
validacao do processo, nao validar o leiaute completo da SEFAZ.
"""
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


def xml_nfe(ch, nnf, cnpj_emit, nome_emit, natop, cfop, ncm, qtd, vunit,
            vprod, picms, vicms, vipi, vnf):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe{ch}" versao="4.00">
      <ide><cUF>31</cUF><natOp>{natop}</natOp><mod>55</mod>
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
          <xPed>4500000101</xPed><nItemPed>10</nItemPed></prod>
        <imposto>
          <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>{vprod:.2f}</vBC>
            <pICMS>{picms:.2f}</pICMS><vICMS>{vicms:.2f}</vICMS></ICMS00></ICMS>
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


CNPJ_OK = "12345678000195"      # = FORN1000 no cadastro do mock
CNPJ_TERCEIRO = "99888777000100"
NCM_OK = "72085300"             # chapa laminada a quente, espessura de 3 a 4,75 mm
VENDA_PRODUCAO = "VENDA DE PRODUCAO DO ESTABELECIMENTO"
VENDA_ATIVO = "VENDA DE BEM DO ATIVO IMOBILIZADO"

# (arquivo, nNF, cnpj, natOp, cfop, ncm, vunit, pICMS, icms_consistente, descricao)
cenarios = [
    ("nfe_01_ok.xml", 1234, CNPJ_OK, VENDA_PRODUCAO, "5101", NCM_OK, 250.00, 18.0, True,
     "Happy path: tudo bate -> MIGO + MIRO"),
    ("nfe_02_preco_divergente.xml", 1235, CNPJ_OK, VENDA_PRODUCAO, "5101", NCM_OK, 275.00, 18.0, True,
     "Preco unitario 275 vs 250 do pedido -> three-way match falha"),
    ("nfe_03_cfop_incompativel.xml", 1236, CNPJ_OK, VENDA_ATIVO, "5551", NCM_OK, 250.00, 18.0, True,
     "CFOP 5551 (venda de ativo) incompativel com compra para industrializacao"),
    ("nfe_04_cnpj_divergente.xml", 1237, CNPJ_TERCEIRO, VENDA_PRODUCAO, "5101", NCM_OK, 250.00, 18.0, True,
     "CNPJ do emitente nao e o do fornecedor do pedido"),
    ("nfe_05_destaque_inconsistente.xml", 1238, CNPJ_OK, VENDA_PRODUCAO, "5101", NCM_OK, 250.00, 18.0, False,
     "vICMS destacado nao corresponde a base x aliquota informada"),
    ("nfe_06_aliquota_errada.xml", 1239, CNPJ_OK, VENDA_PRODUCAO, "5101", NCM_OK, 250.00, 12.0, True,
     "Aliquota de 12% em operacao interna MG, onde a regra geral e 18%"),
    ("nfe_07_ncm_divergente.xml", 1240, CNPJ_OK, VENDA_PRODUCAO, "5101", "72085100", 250.00, 18.0, True,
     "NCM 72085100 (espessura >10mm) diverge do cadastro do material (72085300)"),
]

for arq, nnf, cnpj, natop, cfop, ncm, vunit, picms, consistente, desc in cenarios:
    qtd = 100
    vprod = qtd * vunit
    vicms = vprod * (picms / 100) if consistente else vprod * 0.12
    vipi = vprod * 0.05
    vnf = vprod + vipi
    ch = chave("31", "2607", cnpj, 1, nnf, nnf * 10)
    xml = xml_nfe(ch, nnf, cnpj, "Metalurgica Horizonte Ltda", natop, cfop, ncm,
                  qtd, vunit, vprod, picms, vicms, vipi, vnf)
    with open(os.path.join(OUT, arq), "w") as f:
        f.write(xml)
    print(f"{arq}\n  chave={ch}\n  {desc}")
