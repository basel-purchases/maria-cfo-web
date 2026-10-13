// v0.34 Event math: planned, actual and paid must never be conflated.
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
export const EVENT_RULE_NAMES_V034={per_person:'لكل شخص',per_n_people:'لكل مجموعة أشخاص',per_table:'لكل طاولة',fixed_event:'مرة للحفلة'};
export function eventRuleQuantityV034(rule,guests,tables){
 const qty=n(rule.quantity_per_rule),persons=n(rule.people_per_rule);
 if(qty<=0)return 0;
 switch(rule.rule_type){
  case 'per_person':return qty*Math.max(0,Math.floor(n(guests)));
  case 'per_n_people':return persons>0?qty*Math.ceil(Math.max(0,Math.floor(n(guests)))/persons):0;
  case 'per_table':return qty*Math.max(0,Math.floor(n(tables)));
  case 'fixed_event':return qty;
  default:return 0;
 }
}
export function eventCostQuoteV034({guests=0,tables=0,menuRules=[],menuCosts=[],otherCosts=[],laborCosts=[],wasteReservePercent=0,targetMarginPercent=25,ticketPrice=0,exchangeRate=1}={}){
 const count=Math.max(0,Math.floor(n(guests))),tableCount=Math.max(0,Math.floor(n(tables)));
 const costs=new Map(menuCosts.map(c=>[String(c.id),c]));
 const items=menuRules.map(rule=>{
  const info=costs.get(String(rule.menu_item_id));
  const quantity=rule.required_quantity!=null?n(rule.required_quantity):eventRuleQuantityV034(rule,count,tableCount);
  const supplied=rule.unit_food_cost_base;
  const hasMissingCost=Boolean(rule.has_missing_cost)||((supplied===null||supplied===undefined)&&(!info||Boolean(info.has_missing_cost)||info.recipe_cost_base===null||info.recipe_cost_base===undefined));
  const unitCost=hasMissingCost?null:n(supplied!=null?supplied:info?.recipe_cost_base);
  return {rule,quantity,unitCost,hasMissingCost,totalCost:unitCost===null?null:quantity*unitCost};
 });
 const missing=items.filter(i=>i.hasMissingCost&&i.quantity>0).length;
 const food=items.reduce((a,i)=>a+n(i.totalCost),0);
 const others=otherCosts.reduce((a,c)=>a+n(c.planned_amount_base??c.planned_amount_original),0);
 const labor=laborCosts.reduce((a,c)=>a+n(c.planned_cost_base??c.planned_amount_base),0);
 const reserve=food*Math.max(0,n(wasteReservePercent))/100;
 const total=food+others+labor+reserve;
 const fx=n(exchangeRate)>0?n(exchangeRate):1;
 const revenue=count*Math.max(0,n(ticketPrice))*fx;
 const margin=Math.min(95,Math.max(0,n(targetMarginPercent)))/100;
 const unitCost=count>0?total/count:null;
 const suggestedTicket=count>0?total/(count*(1-margin)*fx):null;
 const breakEvenTicket=count>0?total/(count*fx):null;
 return {items,missing,count,tableCount,food,others,labor,reserve,total,revenue,profit:revenue-total,
  costPerPerson:unitCost,costPerTable:tableCount>0?total/tableCount:null,
  suggestedTicket,breakEvenTicket,marginPercent:revenue>0?100*(revenue-total)/revenue:null,
  reliable:missing===0};
}
export function eventActualResultV034({historical={},extras=[],waste=[],bookingBalances=[],tables=[]}={}){
 const booked=n(historical.earned_revenue_base),baseCost=n(historical.actual_total_cost_historical_base??historical.estimated_actual_total_cost_with_labor_base);
 // Settled and pending extra orders contribute to operating result. Outstanding cash is shown separately.
 // Once voided, an order is excluded; refunded extra still incurs food/service cost if delivered.
 const extraEarned=extras.filter(e=>['paid','pending'].includes(e.status)).reduce((s,e)=>s+n(e.status==='paid'&&e.paid_amount_base!=null?e.paid_amount_base:n(e.amount_original)*n(e.exchange_rate_to_base||1)),0);
 const extraCollected=extras.filter(e=>e.status==='paid').reduce((s,e)=>s+n(e.paid_amount_base??n(e.amount_original)*n(e.exchange_rate_to_base||1)),0);
 const extraCost=extras.filter(e=>['pending','paid','refunded'].includes(e.status)).reduce((s,e)=>s+n(e.total_cost_base??n(e.quantity)*n(e.unit_cost_base)),0);
 const extraDue=extras.filter(e=>e.status==='pending').reduce((s,e)=>s+n(e.amount_original),0);
 const bookingDue=bookingBalances.filter(b=>!['cancelled','no_show'].includes(b.booking_status)).reduce((s,b)=>s+n(b.balance_original),0);
 const wasteCost=waste.filter(w=>w.status==='active').reduce((s,w)=>s+n(w.total_cost_base??n(w.quantity)*n(w.unit_cost_base)),0);
 const revenue=n(historical.earned_revenue_base)+extraEarned;
 const cost=baseCost+wasteCost+extraCost;
 const guests=n(historical.actual_guest_count)||tables.filter(t=>t.status!=='cancelled').reduce((s,t)=>s+n(t.actual_guest_count),0);
 const incomplete=Boolean(historical.historical_cost_incomplete)||(!('actual_total_cost_historical_base' in historical)&&!('estimated_actual_total_cost_with_labor_base' in historical));
 return {revenue,cost,profit:revenue-cost,costPerPerson:guests>0?cost/guests:null,guests,
  booked,extraEarned,extraCollected,extraCost,extraDue,bookingDue,wasteCost,incomplete,
  readyToClose:extraDue<=.0001&&bookingDue<=.0001&&!incomplete};
}
