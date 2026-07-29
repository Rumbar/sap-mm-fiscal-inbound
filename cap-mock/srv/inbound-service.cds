using mm.inbound as db from '../db/schema';

/**
 * Serviço OData v4 que expõe o "S/4HANA fake".
 * Endpoint base: /odata/v4/inbound
 */
service InboundService @(path: '/inbound') {
  entity Suppliers          as projection on db.Suppliers;
  entity PurchaseOrders     as projection on db.PurchaseOrders;
  entity PurchaseOrderItems as projection on db.PurchaseOrderItems;
  entity MaterialDocuments  as projection on db.MaterialDocuments;
  entity SupplierInvoices   as projection on db.SupplierInvoices;
}
