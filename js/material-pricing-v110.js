// v1.0.10 - USD anchors and independently adjustable SYP reference prices.
// Never present a conversion as an actual supplier purchase price.
export function materialKnownSypPriceV110(material){
 const values=[material?.price_syp_v110,material?.last_purchase_unit_cost_base];
 for(const v of values){if(v===null||v===undefined||v==='')continue;
  const n=Number(v);if(Number.isFinite(n)&&n>0)return n;
 }return null;
}
export function usdFromSypV110(syp,rate){
 const a=Number(syp),r=Number(rate);
 if(!Number.isFinite(a)||a<=0||!Number.isFinite(r)||r<=0)return null;
 return Number((a/r).toFixed(8));
}
export function sypFromUsdV110(usd,rate){
 const a=Number(usd),r=Number(rate);
 if(!Number.isFinite(a)||a<=0||!Number.isFinite(r)||r<=0)return null;
 return Number((a*r).toFixed(8));
}
export function pricingPreviewV110(materials,rate){
 const priced=(materials||[]).filter(m=>usdFromSypV110(materialKnownSypPriceV110(m),rate)>0);
 return {priced:priced.length,unpriced:(materials||[]).length-priced.length,
   overridden:priced.filter(m=>m.price_usd_v110!=null).length};
}
