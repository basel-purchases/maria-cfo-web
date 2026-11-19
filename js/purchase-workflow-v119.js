// Maria CFO v1.0.19: pure invoice / supplier presentation helpers.
// Amounts stay grouped by currency; stock quantities stay grouped by unit.
export function purchaseLineTotalV119(item){
  const qty=Number(item.quantity_purchase_unit??item.quantity??0);
  const price=Number(item.unit_price_original??item.unit_price??0);
  const discount=Number(item.line_discount_original??item.discount??0);
  return qty*price-discount;
}
export function purchaseTotalsV119(items=[]){
  const subtotal=items.reduce((s,i)=>s+Number(i.quantity_purchase_unit??i.quantity??0)*Number(i.unit_price_original??i.unit_price??0),0);
  const discounts=items.reduce((s,i)=>s+Number(i.line_discount_original??i.discount??0),0);
  return {subtotal,discounts,total:subtotal-discounts};
}
export function revisionLinesV119(items=[]){
  return items.map(i=>({
    material_id:String(i.material_id),
    purchase_unit_id:String(i.purchase_unit_id),
    quantity:Number(i.quantity_purchase_unit??i.quantity),
    unit_price:Number(i.unit_price_original??i.unit_price),
    discount:Number(i.line_discount_original??i.discount??0),
    notes:i.notes||null,
  }));
}
export function supplierSuggestionsV119(suppliers=[],query='',limit=8){
  const norm=s=>String(s||'').trim().toLocaleLowerCase('ar').replace(/[\u064b-\u065f\u0670ـ]/g,'').replace(/[أإآ]/g,'ا').replace(/\s+/g,' ');
  const term=norm(query);
  if(!term)return [];
  return suppliers.filter(s=>s.id&&s.notes!=='SYSTEM_DIRECT_PURCHASE'&&norm(s.name)!=='شراء مباشر')
    .map(s=>({supplier:s,match:norm(s.name)})).filter(x=>x.match.includes(term))
    .sort((a,b)=>Number(b.match.startsWith(term))-Number(a.match.startsWith(term))||a.supplier.name.localeCompare(b.supplier.name,'ar'))
    .slice(0,limit).map(x=>x.supplier);
}
export function supplierPurchaseSummaryV119(activity={}){
  const invoices=activity.invoices||[],items=activity.items||[],allocations=activity.allocations||[],payments=activity.payments||[];
  const live=invoices.filter(i=>i.status==='posted'&&!i.is_voided&&!i.is_ameen_legacy_v029);
  const liveIds=new Set(live.map(i=>String(i.id)));
  const currencies={};
  const group=code=>(currencies[code]??={purchased:0,paidAllocated:0,outstanding:0,invoiceCount:0});
  live.forEach(i=>{const g=group(String(i.currency_code||'SYP'));g.purchased+=Number(i.total_original||0);g.invoiceCount++;});
  const paidIds=new Set(payments.filter(p=>p.status==='posted').map(p=>String(p.id)));
  allocations.forEach(a=>{
    if(!liveIds.has(String(a.invoice_id))||!paidIds.has(String(a.payment_id)))return;
    const inv=live.find(i=>String(i.id)===String(a.invoice_id));
    group(String(inv.currency_code||'SYP')).paidAllocated+=Number(a.amount_invoice_currency||0);
  });
  Object.values(currencies).forEach(g=>g.outstanding=g.purchased-g.paidAllocated);
  const materials=new Map();
  for(const item of items){
    if(!liveIds.has(String(item.invoice_id)))continue;
    const key=[item.material_id,item.purchase_unit_id].join('|');
    if(!materials.has(key))materials.set(key,{
      materialId:item.material_id,materialName:item.material_name||'مادة غير معروفة',
      unitName:item.unit_name||item.unit_code||'—',purchaseUnitId:item.purchase_unit_id,
      quantity:0,amounts:{},invoiceIds:new Set(),lineCount:0,
    });
    const current=materials.get(key);
    const invoice=live.find(i=>String(i.id)===String(item.invoice_id));
    const code=String(invoice.currency_code||'SYP');
    current.quantity+=Number(item.quantity_purchase_unit||0);
    current.amounts[code]=(current.amounts[code]||0)+purchaseLineTotalV119(item);
    current.invoiceIds.add(String(item.invoice_id));current.lineCount++;
  }
  return {
    currencies,
    liveCount:live.length,
    draftCount:invoices.filter(i=>i.status==='draft').length,
    voidedCount:invoices.filter(i=>i.is_voided).length,
    materials:[...materials.values()].map(({invoiceIds,...rest})=>({...rest,invoiceCount:invoiceIds.size}))
      .sort((a,b)=>a.materialName.localeCompare(b.materialName,'ar')),
    movementCount:(activity.movements||[]).length,
  };
}
