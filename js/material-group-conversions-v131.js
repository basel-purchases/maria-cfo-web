// Pure helpers. Only the server-side planner is authorized to debit real inventory.
export function validGroupFactorV131(factor) {
  const n=Number(factor);
  return factor!=='' && factor!==null && factor!==undefined &&
    Number.isFinite(n) && n>=0.000001 && n<=1000000;
}

export function groupPriceReviewV131(rows=[],referenceUnitId,ratios={}){
  const items=rows.filter(Boolean);
  const unitId=String(referenceUnitId||'');
  const factorFor=(r)=>ratios instanceof Map?ratios.get(String(r.id)):ratios[String(r.id)];
  const referenceIncluded=items.some(r=>String(r.base_unit_id||'')===unitId);
  let invalidFactors=false;
  const values=items.map(row=>{
    const same=String(row.base_unit_id||'')===unitId;
    const factor=same?1:Number(factorFor(row));
    if(!same && !validGroupFactorV131(factorFor(row))) invalidFactors=true;
    if(same && factorFor(row)!=null && Number(factorFor(row))!==1)invalidFactors=true;
    const cost=Number(row.last_purchase_unit_cost_base);
    const dollar=Number(row.price_usd_v110);
    return {factor,
      base: row.last_purchase_unit_cost_base!=null&&cost>0?cost/factor:null,
      usd: row.price_usd_v110!=null&&dollar>0?dollar/factor:null};
  });
  const known=values.map(x=>x.base).filter(x=>x!=null&&Number.isFinite(x));
  const dollars=values.map(x=>x.usd).filter(x=>x!=null&&Number.isFinite(x));
  const missing=known.length!==items.length;
  const different=known.length>1 && Math.max(...known)-Math.min(...known)>0.0001;
  const differentUsd=dollars.length===items.length&&items.length>1&&Math.max(...dollars)-Math.min(...dollars)>0.0001;
  return {referenceIncluded,invalidFactors:invalidFactors||!referenceIncluded,
    missing,different,differentUsd,needsConfirmation:missing||different||differentUsd};
}

// Quantities returned use ACTUAL SKU base units; never add unrelated units.
export function planMaterialConsumptionV131(requestedId,quantity,rows=[]){
  const requested=rows.find(x=>String(x.id)===String(requestedId));
  const q=Number(quantity);
  if(!(q>0)||!Number.isFinite(q))throw new Error('GROUP_INVALID_CONSUMPTION_QUANTITY');
  if(!requested||!validGroupFactorV131(requested.group_units_per_base_v131))
    throw new Error('GROUP_CONVERSION_NOT_CONFIGURED');
  let left=q*Number(requested.group_units_per_base_v131);
  const ordered=[...rows].sort((a,b)=>
    String(a.id)===String(requestedId)?-1:String(b.id)===String(requestedId)?1:
    Number(a.priority||0)-Number(b.priority||0));
  const result=[];
  let tolerance=1e-12;
  for(const row of ordered){
    const factor=row.group_units_per_base_v131;
    if(!validGroupFactorV131(factor))throw new Error('GROUP_CONVERSION_NOT_CONFIGURED');
    const stock=Math.max(0,Number(row.current_stock_base||0));
    if(!Number.isFinite(stock))throw new Error('GROUP_INVALID_STOCK');
    const take=Math.min(stock,Math.round((left/Number(factor))*1e6)/1e6);
    if(take===0 && stock>0 && left>tolerance)throw new Error('GROUP_CONVERSION_BELOW_STOCK_PRECISION');
    if(take>0){
      result.push({materialId:row.id,quantity:take});
      left=Math.max(0,left-take*Number(factor));
      tolerance=Math.max(tolerance,Number(factor)*0.0000005);
    }
    if(left<=tolerance)break;
  }
  if(left>tolerance)throw new Error('GROUP_STOCK_INSUFFICIENT');
  return result;
}
