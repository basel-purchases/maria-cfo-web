// v0.39: reservations are NOT the number of people a party is budgeted for.
const n=v=>Number.isFinite(Number(v))?Number(v):0;
export const portionDisplayV039=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n(v));
export function planningTablesV039(tables=[],targetGuests=0){
 const active=tables.filter(t=>t.status!=='cancelled').map(t=>({...t,planned_guest_count:0}));
 const target=Math.max(0,Math.floor(n(targetGuests)));
 let remaining=target;
 // Ensure booked places stay included, then fill the unused capacity as a plan.
 for(const t of active){
  const held=t.booking_id?Math.max(0,Math.floor(n(t.planned_guest_count_saved??tables.find(o=>String(o.id)===String(t.id))?.planned_guest_count))):0;
  const assigned=Math.min(Math.max(0,Math.floor(n(t.capacity))),held,remaining);
  t.planned_guest_count=assigned;remaining-=assigned;
 }
 for(const t of active){
  const room=Math.max(0,Math.floor(n(t.capacity))-n(t.planned_guest_count));
  const fill=Math.min(remaining,room);
  t.planned_guest_count+=fill;remaining-=fill;
 }
 return {tables:active,target,assigned:target-remaining,unseated:remaining,capacity:active.reduce((s,t)=>s+n(t.capacity),0)};
}
export function plannedRuleQuantityV039(rule,plan){
 const qty=n(rule.quantity_per_rule),people=n(rule.people_per_rule);
 if(!(qty>0))return 0;
 switch(rule.rule_type){
  case 'per_person':return qty*plan.target;
  case 'per_table':return qty*plan.tables.length;
  case 'fixed_event':return qty;
  case 'per_n_people':return people>0?qty*plan.tables.reduce((s,t)=>s+Math.ceil(n(t.planned_guest_count)/people),0):0;
  default:return 0;
 }
}
export function plannedMenuRequirementsV039(requirements=[],plan,estimates=[]){
 const stored=new Map(estimates.map(e=>[String(e.menu_item_id),e]));
 return requirements.map(r=>{
  const required=plannedRuleQuantityV039(r,plan);
  const incomplete=r.has_missing_cost||r.unit_food_cost_base==null;
  const estimate=stored.get(String(r.menu_item_id));
  const estimateCost=estimate?.estimated_unit_cost_base;
  const hasEstimate=incomplete&&estimateCost!=null&&Number.isFinite(Number(estimateCost))&&Number(estimateCost)>=0;
  const cost=incomplete?(hasEstimate?Number(estimateCost):null):n(r.unit_food_cost_base);
  return {...r,required_quantity:required,has_missing_cost:cost===null,
   unit_food_cost_base:cost,estimated_food_cost_base:cost===null?null:required*cost,
   v039_cost_is_estimate:hasEstimate,v039_original_cost_incomplete:incomplete};
 });
}
export function externalPreviewV039(dish,rule,plan,conversion=null){
 if(!dish) return {servings:0,neededUnits:0,cost:0,shortage:0};
 const qty=n(rule.servings_per_distribution??rule.quantity_per_distribution),people=n(rule.people_per_rule);
 const count=rule.rule_type==='per_person'?plan.target:rule.rule_type==='per_table'?plan.tables.length:
  rule.rule_type==='fixed_event'?1:rule.rule_type==='per_n_people'&&people>0?
  plan.tables.reduce((s,t)=>s+Math.ceil(n(t.planned_guest_count)/people),0):0;
 const servings=count*qty,yieldCount=conversion?n(conversion.servings_per_purchase_unit):1;
 if(!(yieldCount>0))throw Error('EVENT_EXTERNAL_CONVERSION_INVALID');
 const neededUnits=servings/yieldCount,available=n(dish.purchased_quantity);
 return {servings,neededUnits,cost:neededUnits*n(dish.unit_cost_base),shortage:Math.max(0,neededUnits-available),count,
  label:conversion?.serving_label||dish.unit_label};
}
export function externalBudgetV039(dishes=[],rules=[],plan,conversions=[]){
 const byId=new Map(dishes.filter(d=>d.is_active!==false).map(d=>[String(d.id),d]));
 const byConversion=new Map(conversions.map(c=>[String(c.id),c]));
 const lines=rules.filter(r=>r.is_active!==false).map(rule=>{
  const item=byId.get(String(rule.dish_id)),conversion=byConversion.get(String(rule.serving_conversion_id||''));
  const preview=externalPreviewV039(item,rule,plan,conversion);
  return {item,rule,conversion,required:preview.neededUnits,servings:preview.servings,cost:preview.cost,label:preview.label,missing:!item};
 });
 const allocated=new Map();for(const line of lines)allocated.set(String(line.rule.dish_id),(allocated.get(String(line.rule.dish_id))||0)+line.required);
 const shortages=[...byId.values()].map(item=>({item,needed:allocated.get(String(item.id))||0})).filter(x=>x.needed>n(x.item.purchased_quantity)+1e-7);
 return {lines,shortages,plannedCost:lines.reduce((s,l)=>s+l.cost,0),purchasedCost:[...byId.values()].reduce((s,x)=>s+n(x.total_cost_base??n(x.purchased_quantity)*n(x.unit_cost_base)),0),missing:lines.filter(l=>l.missing).length};
}
export function tableExtraGroupsV039(extras=[],tables=[]){
 const map=new Map();
 for(const x of extras){
  const id=String(x.table_id);
  if(!map.has(id))map.set(id,{tableId:id,label:tables.find(t=>String(t.id)===id)?.table_label||'طاولة غير معروفة',items:[],pending:[],due:0,paid:0,refunded:0});
  const group=map.get(id);group.items.push(x);
  if(x.status==='pending'){group.pending.push(x);group.due+=n(x.amount_original);}
  if(x.status==='paid')group.paid+=n(x.amount_original);
  if(x.status==='refunded')group.refunded+=n(x.amount_original);
 }
 return [...map.values()].sort((a,b)=>a.label.localeCompare(b.label,'ar',{numeric:true}));
}
