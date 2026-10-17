// Maria CFO v1.0.5 — cashier totals come from source 'صافي الطلب', never the menu.
// The Al-Ameen spreadsheet may omit explicit tax and discount columns. An optional
// rate here is for EXPLANATION ONLY and never changes cash receipt or menu prices.
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
const round2=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
export function cashierMoneyV105(value){
 const n=Number(value);
 if(!Number.isFinite(n))return '—';
 return new Intl.NumberFormat('en-US',{maximumFractionDigits:4,minimumFractionDigits:0}).format(Object.is(n,-0)?0:n)+' ل.س';
}
export function reconcileCashierV105(records=[],optionalRate=null){
 const perOrder=records.map(order=>{
  const gross=round4((order.items||[]).reduce((sum,x)=>sum+Number(x.lineNet||0),0));
  const net=round4(order.netTotal??gross);
  const difference=round4(net-gross);
  const sypField=order.reportedSyp==null?null:round4(order.reportedSyp);
  return {number:order.number,date:order.date,lines:(order.items||[]).length,
   gross,net,difference,sypField,reportedSypZero:sypField===0 && net>0};
 });
 const sum=key=>round4(perOrder.reduce((a,x)=>a+Number(x[key]||0),0));
 const result={orders:perOrder.length,lines:perOrder.reduce((a,x)=>a+x.lines,0),
  gross:sum('gross'),net:sum('net'),difference:sum('difference'),
  sypZeroOrders:perOrder.filter(x=>x.reportedSypZero).length,
  sypZeroNet:round4(perOrder.filter(x=>x.reportedSypZero).reduce((s,x)=>s+x.net,0)),perOrder,
  taxDirectlyReported:false,assumed:null};
 if(optionalRate!==null&&optionalRate!==''&&Number.isFinite(Number(optionalRate))&&Number(optionalRate)>=0&&Number(optionalRate)<=100){
  const rate=Number(optionalRate)/100;
  // A hypothetical breakdown, not evidence that the cashier charged this tax.
  // This only agrees if implied discounts are nonnegative and within each gross.
  const assumptions=perOrder.map(o=>{
   const base=round2(o.net/(1+rate));
   const discount=round2(o.gross-base);
   const estimatedAddition=round2(o.net-base);
   const coherent=discount>=-0.01&&discount<=o.gross+0.01&&
     Math.abs(round2(base*(1+rate))-o.net)<0.011;
   return {number:o.number,base,discount,estimatedAddition,coherent};
  });
  result.assumed={ratePercent:Number(optionalRate),coherent:assumptions.every(a=>a.coherent),
   discounts:round2(assumptions.reduce((s,a)=>s+a.discount,0)),
   additional:round2(assumptions.reduce((s,a)=>s+a.estimatedAddition,0)),perOrder:assumptions};
 }
 return result;
}
export function detectCashierHeaderDateV105(workbook,days=[]){
 const sheet=workbook?.sheets?.find(s=>/رأسية\s*التقرير/.test(s.name))||null;
 const content=(sheet?.rows||[]).flat().map(String).join(' ');
 const ranges=[...content.matchAll(/(\d{1,2})[-\/]([0-1]?\d)[-\/]((?:19|20)\d{2})/g)]
  .map(m=>`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
 return {headerDates:[...new Set(ranges)],mismatch:ranges.length>0&&days.some(d=>!ranges.includes(d)),
  originalHeading:content.trim().slice(0,220)};
}
export const prioritizeMenuByCashierPriceV105=(choices=[],filePrice=null)=>[...choices]
 .sort((a,b)=>{
  const score=m=>Number(m.menu_price)==Number(filePrice)&&m.menu_price!=null&&filePrice!=null?0:1;
  return score(a)-score(b)||String(a.name||'').localeCompare(String(b.name||''),'ar');
 });
