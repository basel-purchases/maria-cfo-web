// Stable user-facing price-review order. Never reorder the payload given to SQL.
const number=x=>Number.isFinite(Number(x))?Number(x):0;
export function isPriceMismatch(p){
  if(p?.menuId==null) return false; // New catalog items are distinct from mismatched existing prices.
  return Boolean(p?.different) ||
    (p?.minFilePrice!=null && p?.maxFilePrice!=null && number(p.minFilePrice)!==number(p.maxFilePrice));
}
export function sortedPriceReviewV100(prices=[]){
  const priority=p=>isPriceMismatch(p)?0:(p.menuId==null?1:2);
  return prices.map((row,originalIndex)=>({...row,originalIndex}))
    .sort((a,b)=>priority(a)-priority(b)||a.originalIndex-b.originalIndex);
}
