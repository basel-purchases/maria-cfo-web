// Supplier purchase-price history: compare matching material + purchase unit
// + currency only. Exclude drafts, reversed invoices, reference imports.
// A change is measured on the net unit amount AFTER a line discount.
import {purchaseLineTotalV119} from './purchase-workflow-v119.js?v=1.0.24';

export function supplierPriceTrendsV124(activity={}){
  const valid=new Map((activity.invoices||[])
    .filter(i=>i.status==='posted'&&!i.is_voided&&!i.archived_at_v122&&!i.is_ameen_legacy_v029)
    .map(i=>[String(i.id),i]));
  const groups=new Map();
  for(const line of activity.items||[]){
    const invoice=valid.get(String(line.invoice_id));
    if(!invoice)continue;
    const material=String(line.material_id||''),unit=String(line.purchase_unit_id||'');
    const currency=String(invoice.currency_code||'SYP');
    const qty=Number(line.quantity_purchase_unit??line.quantity),net=purchaseLineTotalV119(line);
    if(!material||!unit||!Number.isFinite(qty)||qty<=0||!Number.isFinite(net)||net<0)continue;
    const key=JSON.stringify([material,unit,currency]);
    if(!groups.has(key))groups.set(key,{
      materialId:material,materialName:String(line.material_name||'مادة غير معروفة'),
      unitName:String(line.unit_name||line.unit_code||'—'),currency,byInvoice:new Map(),
    });
    const group=groups.get(key),invoiceId=String(invoice.id);
    if(!group.byInvoice.has(invoiceId))group.byInvoice.set(invoiceId,{
      totalNet:0,totalQty:0,date:String(invoice.invoice_date||invoice.occurred_at||'').slice(0,10),
      invoiceId,invoiceNumber:String(invoice.invoice_number||invoice.id),
      createdAt:String(invoice.created_at||''),
    });
    const observation=group.byInvoice.get(invoiceId);
    observation.totalNet+=net;
    observation.totalQty+=qty;
  }
  const trends=[];
  for(const g of groups.values()){
    // Several lines in ONE invoice count as ONE purchase using weighted net price.
    const observations=[...g.byInvoice.values()].map(x=>({...x,price:x.totalNet/x.totalQty}));
    observations.sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt)
      ||a.invoiceId.localeCompare(b.invoiceId));
    const recent=observations.at(-1),previous=observations.length>1?observations.at(-2):null;
    const percent=previous&&previous.price>0?(recent.price-previous.price)/previous.price*100:null;
    trends.push({materialId:g.materialId,materialName:g.materialName,unitName:g.unitName,
      currency:g.currency,firstPrice:observations[0].price,lastPrice:recent.price,
      previousPrice:previous?.price??null,percentChange:percent,
      sampleCount:observations.length,lastDate:recent.date,
      lastInvoiceNumber:recent.invoiceNumber});
  }
  return trends.sort((a,b)=>a.materialName.localeCompare(b.materialName,'ar')||a.unitName.localeCompare(b.unitName,'ar')||a.currency.localeCompare(b.currency));
}
