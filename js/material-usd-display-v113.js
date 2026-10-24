// v1.0.13 — display and newly entered USD reference prices: always round UP to 0.001 USD.
export function ceilUsdPriceV113(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return null;
  return Math.ceil(n*1000-1e-10)/1000;
}
export function formatUsdPriceV113(value){
  const n=ceilUsdPriceV113(value);
  return n===null?'—':n.toFixed(3)+' $';
}
