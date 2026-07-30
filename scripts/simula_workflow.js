#!/usr/bin/env node
/**
 * Simula o workflow n8n localmente (mesma lógica dos nós Code) contra o mock CAP.
 * Uso: node simula_workflow.js ../test-data/nfe_01_ok.xml
 * Serve para testar a lógica sem subir o n8n — e prova o fluxo de ponta a ponta.
 */
const fs = require('fs');
const BASE = process.env.S4_URL || 'http://localhost:4004/inbound';

// Parse XML minimalista (suficiente para os XMLs de teste)
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : undefined;
}
function attr(xml, tagName, attrName) {
  const m = xml.match(new RegExp(`<${tagName}[^>]*${attrName}="([^"]*)"`));
  return m ? m[1] : undefined;
}

// ===== Nó "Validações Fiscais NF-e" =====
function validacoesFiscais(xml) {
  const chave = String(attr(xml, 'infNFe', 'Id') || '').replace('NFe', '');
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  [...chave.slice(0, 43)].reverse().forEach((d, i) => { soma += Number(d) * pesos[i % 8]; });
  const resto = soma % 11;
  const dv = (resto === 0 || resto === 1) ? '0' : String(11 - resto);

  const erros = [];
  if (chave.length !== 44) erros.push(`Chave com ${chave.length} dígitos (esperado 44)`);
  else if (dv !== chave[43]) erros.push(`DV da chave inválido (calc ${dv}, informado ${chave[43]})`);

  const cfopSaida = tag(xml, 'CFOP');
  // Só o primeiro dígito é derivável do CFOP do fornecedor: ele indica a
  // abrangência geográfica da operação (5=interna, 6=interestadual, 7=exterior).
  // Os três últimos dígitos do CFOP de ENTRADA vêm da destinação que o comprador
  // dá ao material, e não da operação do vendedor.
  const mapa = { 5: '1', 6: '2', 7: '3' };
  const digitoEntrada = mapa[cfopSaida[0]];
  if (!digitoEntrada) erros.push(`CFOP ${cfopSaida} não é de saída (5xxx/6xxx/7xxx)`);

  const emit = tag(xml, 'emit'), icms = tag(xml, 'ICMS00') || '', ipi = tag(xml, 'IPITrib') || '';
  return {
    chave, errosEstruturais: erros,
    cnpjEmitente: tag(emit, 'CNPJ'), nomeEmitente: tag(emit, 'xNome'),
    numeroNF: tag(xml, 'nNF'),
    pedido: tag(xml, 'xPed'), itemPedido: String(tag(xml, 'nItemPed')).padStart(5, '0'),
    ncm: tag(xml, 'NCM'), cfopSaida, digitoEntrada,
    quantidade: Number(tag(xml, 'qCom')), valorUnitario: Number(tag(xml, 'vUnCom')),
    vBC: Number(tag(icms, 'vBC')), pICMS: Number(tag(icms, 'pICMS')), vICMS: Number(tag(icms, 'vICMS')),
    vIPI: Number(tag(ipi, 'vIPI')),
    valorTotalNF: Number(tag(tag(xml, 'ICMSTot'), 'vNF'))
  };
}

// ===== Nó "Conferência NF-e x Pedido" =====
// Confronto documento fiscal x pedido de compra. O three-way match propriamente
// dito (pedido x entrada de mercadoria x fatura) é feito pelo sistema de registro
// no momento da MIRO, quando a entrada já existe.
function confereNfContraPedido(nf, po) {
  const div = [...nf.errosEstruturais];
  const item = (po.Items || []).find(i => Number(i.PurchaseOrderItem) === Number(nf.itemPedido)) ?? po.Items?.[0];
  if (!item) div.push(`Item ${nf.itemPedido} não encontrado no pedido`);
  if (po.Supplier?.TaxNumber1 && po.Supplier.TaxNumber1 !== nf.cnpjEmitente)
    div.push(`CNPJ emitente ${nf.cnpjEmitente} diverge do fornecedor do pedido (${po.Supplier.TaxNumber1})`);
  if (item) {
    if (Math.abs(item.NetPriceAmount - nf.valorUnitario) > item.NetPriceAmount * 0.01)
      div.push(`Preço NF (${nf.valorUnitario}) diverge do pedido (${item.NetPriceAmount})`);
    const aberta = item.OrderQuantity - item.QuantityDelivered;
    if (nf.quantidade > aberta) div.push(`Qtde NF (${nf.quantidade}) excede qtde aberta (${aberta})`);
    if (item.CFOPExpected) {
      // Abrangência geográfica: interna x interestadual x exterior
      if (nf.digitoEntrada && nf.digitoEntrada !== item.CFOPExpected[0])
        div.push(`Abrangência da operação: CFOP ${nf.cfopSaida} do fornecedor não corresponde ao CFOP de entrada ${item.CFOPExpected} do item`);
      // Natureza da operação: o que o fornecedor fez precisa ser compatível
      // com a destinação que o comprador dá ao material
      const compat = { '101': ['101', '102'], '102': ['101', '102'], '551': ['551'], '556': ['556'], '910': ['910'] };
      const permitidos = compat[nf.cfopSaida.slice(1)];
      const destino = item.CFOPExpected.slice(1);
      if (!permitidos) div.push(`CFOP de saída ${nf.cfopSaida} sem natureza mapeada para entrada`);
      else if (!permitidos.includes(destino))
        div.push(`CFOP ${nf.cfopSaida} incompatível com a destinação do material (CFOP de entrada ${item.CFOPExpected})`);
    }
    if (item.NCM && String(item.NCM) !== nf.ncm) div.push(`NCM ${nf.ncm} diverge do cadastro ${item.NCM}`);
  }
  const icmsCalc = nf.vBC * nf.pICMS / 100;
  if (Math.abs(icmsCalc - nf.vICMS) > 0.02)
    div.push(`vICMS destacado (${nf.vICMS}) inconsistente com base x alíquota (${icmsCalc.toFixed(2)})`);
  if (nf.pICMS !== 18)
    div.push(`Alíquota ICMS ${nf.pICMS}% diverge dos 18% esperados p/ operação interna MG`);
  return { aprovado: div.length === 0, divergencias: div, item };
}

// ===== Orquestração (o que o canvas do n8n faz) =====
(async () => {
  const xml = fs.readFileSync(process.argv[2], 'utf8');
  const nf = validacoesFiscais(xml);
  console.log(`\nNF-e ${nf.numeroNF} | chave ${nf.chave}`);

  const rPo = await fetch(`${BASE}/PurchaseOrders('${nf.pedido}')?$expand=Items,Supplier`);
  if (!rPo.ok) { console.log(`BLOQUEADO: pedido ${nf.pedido} não encontrado no S/4`); return; }
  const po = await rPo.json();

  const match = confereNfContraPedido(nf, po);
  if (!match.aprovado) {
    console.log('STATUS: BLOQUEADO (fila de pendências fiscais)');
    match.divergencias.forEach(d => console.log('  - ' + d));
    return;
  }

  const rMigo = await fetch(`${BASE}/MaterialDocuments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ PurchaseOrder: nf.pedido, PurchaseOrderItem: match.item.PurchaseOrderItem,
      QuantityInEntryUnit: nf.quantidade, NFeAccessKey: nf.chave })
  });
  const migo = await rMigo.json();
  if (!rMigo.ok) { console.log('MIGO rejeitada:', migo.error?.message); return; }

  const rMiro = await fetch(`${BASE}/SupplierInvoices`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ PurchaseOrder: nf.pedido, Supplier: po.Supplier.Supplier,
      InvoiceGrossAmount: nf.valorTotalNF, NFeAccessKey: nf.chave, NFeNumber: nf.numeroNF,
      CFOP: nf.cfopSaida, TaxAmountICMS: nf.vICMS, TaxAmountIPI: nf.vIPI })
  });
  const miro = await rMiro.json();
  if (!rMiro.ok) { console.log('MIRO rejeitada:', miro.error?.message); return; }

  console.log(`STATUS: LANÇADO | MIGO ${migo.MaterialDocument} | MIRO ${miro.SupplierInvoice}`);
})();
