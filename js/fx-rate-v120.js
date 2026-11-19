// v1.0.20 — The system's existing database stores NEW Syrian pounds per USD
// (as observed in the user's live diagnostic export). Market quotes can also
// include old-denomination values for historical presentation, never for writes.
export function marketNewSypPerUsdV120(quote,side='sell'){
  const n=Number(side==='buy'?quote?.buyNew:quote?.sellNew);
  if(!Number.isFinite(n)||n<=0||n>1000)return null;
  return n;
}
export function validateNewSypRateV120(rate){
  const n=Number(rate);
  return Number.isFinite(n)&&n>0&&n<=1000;
}
export function rateApprovalStateV120(rate,currentRate){
  const incoming=Number(rate),current=Number(currentRate);
  if(!validateNewSypRateV120(incoming))return {valid:false,reason:'INVALID_NEW_SYP_RATE'};
  if(Number.isFinite(current)&&current>1000)return {valid:false,reason:'OLD_SYP_RATE_REVIEW_REQUIRED'};
  return {valid:true,changed:!Number.isFinite(current)||Math.abs(current-incoming)>0.000001};
}
