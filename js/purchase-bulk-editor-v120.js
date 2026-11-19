import {purchaseTotalsV119} from './purchase-workflow-v119.js?v=1.0.21';
// Keep validation independent of the UI and of the server transaction.
export function validatePurchaseRevisionLinesV120(lines,{posted=false}={}){
  if(!Array.isArray(lines)||lines.length>500)return {valid:false,code:'PURCHASE_REVISION_BAD_ITEMS'};
  if(posted&&!lines.length)return {valid:false,code:'PURCHASE_REVISION_EMPTY_POSTED'};
  for(const line of lines){
    const qty=Number(line.quantity_purchase_unit??line.quantity);
    const price=Number(line.unit_price_original??line.unit_price);
    const discount=Number(line.line_discount_original??line.discount??0);
    if(!line.material_id||!line.purchase_unit_id||!Number.isFinite(qty)||qty<=0||
       !Number.isFinite(price)||price<0||!Number.isFinite(discount)||discount<0||
       discount>qty*price)return {valid:false,code:'PURCHASE_REVISION_INVALID_LINE'};
  }
  return {valid:true,total:purchaseTotalsV119(lines).total};
}
