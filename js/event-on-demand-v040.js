// v0.40: availability is NOT consumption. Show budget ceiling and actual delivered separately.
const n=value=>Number.isFinite(Number(value))?Number(value):0;
export function onDemandRowsV040(items=[],issues=[],menuCosts=[],costEstimates=[],externalDishes=[]){
 const menu=new Map(menuCosts.map(c=>[String(c.id),c]));
 const estimates=new Map(costEstimates.map(c=>[String(c.menu_item_id),c]));
 const external=new Map(externalDishes.map(d=>[String(d.id),d]));
 return items.map(item=>{
  const related=issues.filter(issue=>String(issue.on_demand_id)===String(item.id)&&!issue.voided_at);
  const used=related.reduce((s,issue)=>s+n(issue.servings),0);
  const limit=Math.max(0,n(item.maximum_servings));
  const yieldCount=n(item.servings_per_source_unit)>0?n(item.servings_per_source_unit):1;
  const menuCost=menu.get(String(item.menu_item_id)),estimate=estimates.get(String(item.menu_item_id));
  const externalDish=external.get(String(item.external_dish_id));
  const isOutside=!!item.external_dish_id;
  const complete=menuCost&&!menuCost.has_missing_cost&&menuCost.recipe_cost_base!=null;
  const provisional=menuCost&&!complete&&estimate?.estimated_unit_cost_base!=null;
  const price=isOutside?(externalDish? n(externalDish.unit_cost_base):null):complete?n(menuCost.recipe_cost_base):provisional?n(estimate.estimated_unit_cost_base):null;
  const possiblePurchaseUnits=externalDish?n(externalDish.purchased_quantity):null;
  return {...item,used,remaining:Math.max(0,limit-used),usedUnits:used/yieldCount,
    limitUnits:limit/yieldCount,unitCost:price,
    reservedCost:price===null?null:limit/yieldCount*price,
    consumedCost:price===null?null:used/yieldCount*price,
    actualCostIsEstimate:!!provisional,
    purchaseUnits:possiblePurchaseUnits,
    purchasedServings:possiblePurchaseUnits===null?null:possiblePurchaseUnits*yieldCount,
    isOutside};
 });
}
export function onDemandTotalsV040(rows=[]){
 return {planned:rows.reduce((s,r)=>s+n(r.reservedCost),0),
  delivered:rows.reduce((s,r)=>s+n(r.consumedCost),0),
  unknown:rows.filter(r=>r.reservedCost===null).length,
  deliveries:rows.reduce((s,r)=>s+n(r.used),0),
  available:rows.reduce((s,r)=>s+n(r.remaining),0)};
}
export function reservationDashboardV040(event={},tables=[],bookings=[],balances=[]){
 const active=tables.filter(t=>t.status!=='cancelled');
 const capacity=active.reduce((s,t)=>s+n(t.capacity),0);
 const reserved=active.filter(t=>t.booking_id).reduce((s,t)=>s+n(t.planned_guest_count),0);
 const target=n(event.planned_guest_count);
 const applicable=bookings.filter(b=>!['cancelled','no_show'].includes(b.status));
 const activeIds=new Set(applicable.map(b=>String(b.id)));
 const availableToBook=active.filter(t=>!t.booking_id).reduce((s,t)=>s+n(t.capacity),0);
 const bookedTableVacancies=active.filter(t=>t.booking_id).reduce((s,t)=>s+Math.max(0,n(t.capacity)-n(t.planned_guest_count)),0);
 const expected=applicable.reduce((s,b)=>s+n(b.agreed_amount_original),0);
 const received=balances.filter(b=>activeIds.has(String(b.booking_id))).reduce((s,b)=>s+n(b.paid_original),0);
 const due=balances.filter(b=>activeIds.has(String(b.booking_id))).reduce((s,b)=>s+n(b.balance_original),0);
 return {target,reserved,capacity,openCapacity:availableToBook,bookedTableVacancies,physicallyEmpty:Math.max(0,capacity-reserved),
  remainingTarget:Math.max(0,target-reserved),bookings:applicable.length,expected,received,due};
}
