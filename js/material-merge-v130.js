// Pure display/preview helpers; the PostgreSQL RPC remains the authoritative allocator.
export function groupPriceReviewV130(materials=[]){
  const rows=materials.filter(Boolean);
  const unitIds=new Set(rows.map(r=>String(r.base_unit_id||'')));
  const prices=rows.map(r=>{
    const n=Number(r.last_purchase_unit_cost_base);
    return r.last_purchase_unit_cost_base==null||!(n>0)?null:n;
  });
  const dollars=rows.map(r=>{
    const n=Number(r.price_usd_v110);
    return r.price_usd_v110==null||!(n>0)?null:n;
  });
  const known=prices.filter(p=>p!=null);
  const usdKnown=dollars.filter(p=>p!=null);
  const different=known.length>1 && Math.max(...known)-Math.min(...known)>0.0001;
  const differentUsd=usdKnown.length===rows.length && rows.length>1 && Math.max(...usdKnown)-Math.min(...usdKnown)>0.0001;
  const missing=known.length!==rows.length;
  const unitMismatch=unitIds.size>1||unitIds.has('');
  return {missing,different,differentUsd,unitMismatch,needsConfirmation:missing||different||differentUsd};
}

// Simulates priority depletion for the accountant's preview and regression tests.
// When a group is empty, never invent negative source stock.
export function planMaterialConsumptionV130(requestedId,quantity,rows=[]){
  const q=Number(quantity);
  if(!(q>0)||!Number.isFinite(q))throw new Error('GROUP_INVALID_CONSUMPTION_QUANTITY');
  const sorted=[...rows].sort((a,b)=>String(a.id)===String(requestedId)?-1:String(b.id)===String(requestedId)?1:Number(a.priority||0)-Number(b.priority||0));
  let left=q;
  const results=[];
  for(const row of sorted){
    const stock=Math.max(0,Number(row.current_stock_base||0));
    if(!Number.isFinite(stock))throw new Error('GROUP_INVALID_STOCK');
    const take=Math.min(left,stock);
    if(take>0){results.push({materialId:row.id,quantity:take});left=Math.max(0,left-take);}
    if(left<=1e-8)break;
  }
  if(left>1e-8)throw new Error('GROUP_STOCK_INSUFFICIENT');
  return results;
}
