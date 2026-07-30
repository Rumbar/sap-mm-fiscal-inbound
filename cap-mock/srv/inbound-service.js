const cds = require('@sap/cds');

/**
 * Regras de negócio que imitam o comportamento do S/4HANA:
 *
 * MIGO (MaterialDocuments):
 *  - PO precisa existir e estar liberada (Released)
 *  - Quantidade recebida não pode exceder a qtde aberta do item
 *    (equivale à msg M7 do SAP quando estoura a tolerância)
 *  - Gera MBLNR sequencial 50000000xx e atualiza QuantityDelivered
 *
 * MIRO (SupplierInvoices):
 *  - Three-way match: PO x Entrada de mercadoria x Fatura
 *  - Valor bruto deve bater com (qtde recebida x preço líquido) + IPI,
 *    com tolerância de 1% (equivale à chave PP da OMR6; no SAP o bloqueio
 *    automático grava MRM_ZLSPR='A' em RBKP_BLOCKED e se libera pela MRBR)
 *  - Precisa existir entrada de mercadoria (GR-based IV)
 *  - Gera BELNR sequencial 51056000xx
 */
module.exports = class InboundService extends cds.ApplicationService {
  async init() {
    const { PurchaseOrders, PurchaseOrderItems, MaterialDocuments, SupplierInvoices } = this.entities;

    let nextMblnr = 5000000001;
    let nextBelnr = 5105600001;

    // ---------- MIGO ----------
    this.before('CREATE', MaterialDocuments, async (req) => {
      const d = req.data;
      const po = await SELECT.one.from(PurchaseOrders).where({ PurchaseOrder: d.PurchaseOrder });
      if (!po) return req.reject(404, `Pedido ${d.PurchaseOrder} não existe (ME23N)`);
      if (po.Status !== 'Released')
        return req.reject(409, `Pedido ${d.PurchaseOrder} não está liberado (ME29N)`);

      const item = await SELECT.one.from(PurchaseOrderItems)
        .where({ Parent_PurchaseOrder: d.PurchaseOrder, PurchaseOrderItem: d.PurchaseOrderItem });
      if (!item) return req.reject(404, `Item ${d.PurchaseOrderItem} não existe no pedido`);

      const open = Number(item.OrderQuantity) - Number(item.QuantityDelivered);
      if (Number(d.QuantityInEntryUnit) > open)
        return req.reject(409,
          `Qtde ${d.QuantityInEntryUnit} excede qtde aberta ${open} do item (msg M7 022)`);

      d.MaterialDocument = String(nextMblnr++);
      d.MaterialDocumentYear = String(new Date().getFullYear());
      d.GoodsMovementType = d.GoodsMovementType || '101';
      d.PostingDate = d.PostingDate || new Date().toISOString().slice(0, 10);

      await UPDATE(PurchaseOrderItems)
        .set({ QuantityDelivered: Number(item.QuantityDelivered) + Number(d.QuantityInEntryUnit) })
        .where({ Parent_PurchaseOrder: d.PurchaseOrder, PurchaseOrderItem: d.PurchaseOrderItem });
    });

    // ---------- MIRO ----------
    this.before('CREATE', SupplierInvoices, async (req) => {
      const d = req.data;
      const po = await SELECT.one.from(PurchaseOrders).where({ PurchaseOrder: d.PurchaseOrder });
      if (!po) return req.reject(404, `Pedido ${d.PurchaseOrder} não existe`);
      if (po.Supplier_Supplier && d.Supplier && po.Supplier_Supplier !== d.Supplier)
        return req.reject(409,
          `Fornecedor ${d.Supplier} diverge do fornecedor do pedido ${po.Supplier_Supplier}`);

      // GR-based IV: precisa haver entrada de mercadoria
      const grs = await SELECT.from(MaterialDocuments).where({ PurchaseOrder: d.PurchaseOrder });
      if (!grs.length)
        return req.reject(409, `Sem entrada de mercadoria (MIGO) para o pedido ${d.PurchaseOrder} - GR-based IV`);

      // Three-way match de valor
      const items = await SELECT.from(PurchaseOrderItems)
        .where({ Parent_PurchaseOrder: d.PurchaseOrder });
      const grQty = grs.reduce((s, g) => s + Number(g.QuantityInEntryUnit), 0);
      const price = Number(items[0].NetPriceAmount);
      const expected = grQty * price + Number(d.TaxAmountIPI || 0);
      const diff = Math.abs(Number(d.InvoiceGrossAmount) - expected);
      const tolerance = expected * 0.01; // 1% (OMR6)
      if (diff > tolerance)
        return req.reject(409,
          `Fatura bloqueada para pagamento - variação de preço (chave PP), liberação via MRBR: valor ${d.InvoiceGrossAmount} diverge do esperado ${expected.toFixed(2)} (tolerância 1%)`);

      // Duplicidade de NF-e (chave já lançada)
      if (d.NFeAccessKey) {
        const dup = await SELECT.one.from(SupplierInvoices).where({ NFeAccessKey: d.NFeAccessKey });
        if (dup) return req.reject(409, `NF-e ${d.NFeAccessKey} já lançada (fatura ${dup.SupplierInvoice}) - duplicidade`);
      }

      d.SupplierInvoice = String(nextBelnr++);
      d.FiscalYear = String(new Date().getFullYear());
      d.Status = 'Posted';
    });

    return super.init();
  }
};
