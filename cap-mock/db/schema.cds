namespace mm.inbound;

/**
 * Modelo espelhado nas entidades reais do S/4HANA Cloud:
 * - API_PURCHASE_ORDER_SRV        -> PurchaseOrders / PurchaseOrderItems
 * - API_MATERIAL_DOCUMENT_SRV    -> MaterialDocuments (MIGO / mov. 101)
 * - API_SUPPLIERINVOICE_PROCESS_SRV -> SupplierInvoices (MIRO)
 * Campos fiscais BR inspirados na localização (J1B*): CFOP, NCM, chave NF-e.
 */

entity Suppliers {
  key Supplier     : String(10);   // LIFNR
      SupplierName : String(80);
      TaxNumber1   : String(14);   // CNPJ (STCD1)
      Country      : String(2) default 'BR';
}

entity PurchaseOrders {
  key PurchaseOrder     : String(10);          // EBELN
      CompanyCode       : String(4);
      PurchasingOrg     : String(4);
      Supplier          : Association to Suppliers;
      DocumentCurrency  : String(3) default 'BRL';
      PurchaseOrderDate : Date;
      Status            : String(20) default 'Released'; // liberação (ME29N)
      Items             : Composition of many PurchaseOrderItems
                            on Items.Parent = $self;
}

entity PurchaseOrderItems {
  key Parent            : Association to PurchaseOrders;
  key PurchaseOrderItem : String(5);           // EBELP
      Material          : String(18);          // MATNR
      MaterialText      : String(60);
      Plant             : String(4);           // WERKS
      OrderQuantity     : Decimal(13, 3);      // MENGE
      QuantityDelivered : Decimal(13, 3) default 0; // qtde já recebida (EKET)
      PurchaseOrderQuantityUnit : String(3);   // MEINS
      NetPriceAmount    : Decimal(11, 2);      // NETPR
      TaxCode           : String(2);           // MWSKZ (ex.: I1, C1 - J1BTAX)
      NCM               : String(8);           // classificação fiscal
      CFOPExpected      : String(4);           // CFOP de ENTRADA esperado (ex.: 1102)
}

entity MaterialDocuments {
  key MaterialDocument     : String(10);       // MBLNR (gerado: 50000000xx)
  key MaterialDocumentYear : String(4);        // MJAHR
      PurchaseOrder        : String(10);
      PurchaseOrderItem    : String(5);
      GoodsMovementType    : String(3) default '101'; // BWART
      QuantityInEntryUnit  : Decimal(13, 3);
      PostingDate          : Date;
      NFeAccessKey         : String(44);       // chave da NF-e vinculada
      CreatedAt            : Timestamp @cds.on.insert : $now;
}

entity SupplierInvoices {
  key SupplierInvoice       : String(10);      // BELNR (gerado: 51056000xx)
  key FiscalYear            : String(4);
      PurchaseOrder         : String(10);
      Supplier              : String(10);
      InvoiceGrossAmount    : Decimal(13, 2);
      DocumentCurrency      : String(3) default 'BRL';
      NFeAccessKey          : String(44);      // vínculo com o docto fiscal (docnum)
      NFeNumber             : String(9);
      CFOP                  : String(4);
      TaxAmountICMS         : Decimal(13, 2);
      TaxAmountIPI          : Decimal(13, 2);
      Status                : String(20) default 'Posted';
      CreatedAt             : Timestamp @cds.on.insert : $now;
}
