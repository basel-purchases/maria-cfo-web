// v1.0.21: One-click creation is a NEW draft and must not modify the old invoice.
// All I/O is injected so the same behavior can be verified without Supabase.
export function supplierInvoiceDraftPayloadV121(supplier,currency=''){
  const supplierName=String(supplier?.name||'').trim();
  if(!supplierName)throw new Error('SUPPLIER_NOT_FOUND');
  if(supplier.is_active===false)throw new Error('SUPPLIER_NOT_ACTIVE');
  const preferred=String(currency||supplier.default_currency_code||'SYP').toUpperCase();
  return {
    supplierId:supplier?.id||null,
    supplierName,
    currency:['SYP','USD'].includes(preferred)?preferred:'SYP',
    invoiceNumber:null,
  };
}

export async function createSupplierInvoiceDraftV121({supplier,currency='',date,createPurchase,prepareCatalog,navigate}){
  if(typeof createPurchase!=='function'||typeof navigate!=='function'){
    throw new Error('PURCHASE_SHORTCUT_NOT_CONFIGURED');
  }
  const payload=supplierInvoiceDraftPayloadV121(supplier,currency);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))throw new Error('PURCHASE_DATE_INVALID');
  const id=await createPurchase({...payload,date});
  if(!id)throw new Error('PURCHASE_DRAFT_NOT_CREATED');
  if(typeof prepareCatalog==='function')prepareCatalog(String(id));
  navigate('#/purchase/'+id);
  return id;
}
