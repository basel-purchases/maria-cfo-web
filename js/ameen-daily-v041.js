// v0.41: pure daily Al-Ameen calculations. Source sales are NEVER cashbox postings.
export const roundAmount=(x,p=4)=>Math.round((Number(x)+Number.EPSILON)*10**p)/10**p;
export function dailyMetrics(orders=[],lines=[]){
  const orderIds=new Set(orders.map(x=>String(x.id)));
  const relevant=lines.filter(x=>orderIds.has(String(x.orderId)));
  const revenue=roundAmount(orders.reduce((a,x)=>a+Number(x.net||0),0));
  const lineRevenue=roundAmount(relevant.reduce((a,x)=>a+Number(x.lineNet||0),0));
  let knownCost=0,knownLineRevenue=0,unknownRevenue=0,unknownLines=0,estimatedLines=0,knownLines=0;
  for(const row of relevant){
    const cost=row.cost==null||row.cost===''?null:Number(row.cost);
    const amount=Number(row.lineNet)||0;
    if(cost===null||!Number.isFinite(cost)){
      unknownLines++;unknownRevenue+=amount;
    }else{
      knownLines++;knownCost+=Number(row.qty||0)*cost;knownLineRevenue+=amount;
      if(row.costKind==='estimate')estimatedLines++;
    }
  }
  const discounts=roundAmount(revenue-lineRevenue);
  const complete=unknownLines===0;
  const partialMargin=roundAmount(knownLineRevenue-knownCost);
  const projectedMargin=complete?roundAmount(revenue-knownCost):null;
  return {orders:orders.length,items:relevant.length,revenue,lineRevenue,discounts,
    knownCost:roundAmount(knownCost),knownLineRevenue:roundAmount(knownLineRevenue),
    unknownRevenue:roundAmount(unknownRevenue),unknownLines,estimatedLines,knownLines,
    complete,partialMargin,projectedMargin};
}
export function dailyCashboxes(orders=[]){
 const map=new Map();
 for(const order of orders){const key=String(order.cashbox||'غير محدد في التقرير');
  const old=map.get(key)||{name:key,count:0,total:0};
  old.count++;old.total+=Number(order.net||0);map.set(key,old);
 }
 return [...map.values()].map(x=>({...x,total:roundAmount(x.total)}));
}
export function dailyPriceDifferences(lines=[]){
 let increase=0,decrease=0,changed=0;
 for(const line of lines){
  if(line.referencePrice===null||line.referencePrice===undefined)continue;
  const delta=(Number(line.unitPrice)-Number(line.referencePrice))*Number(line.qty);
  if(Math.abs(delta)<=0.0001)continue;
  changed++;
  if(delta>0)increase+=delta;else decrease+=-delta;
 }
 return {increase:roundAmount(increase),decrease:roundAmount(decrease),changed};
}
export function normalizeMenuQuery(name=''){
 return String(name).normalize('NFKC').replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').trim().replace(/\s+/g,' ').toLocaleLowerCase('ar');
}
export function summarizeOrderPreview(records=[]){
 return {orders:records.length,lines:records.reduce((n,r)=>n+(r.items?.length||0),0),
  review:records.filter(r=>r.reviewReasons?.length).length,
  days:[...new Set(records.map(r=>r.date))].sort()};
}
