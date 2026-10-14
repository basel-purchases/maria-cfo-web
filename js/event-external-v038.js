// Outside-purchased hospitality is kept separate from kitchen recipes and stock.
const n=x=>Number.isFinite(Number(x))?Number(x):0;
export function externalRequiredV038(rule,tables=[]){
 const qty=n(rule.quantity_per_distribution),people=n(rule.people_per_rule);
 if(qty<=0)return 0;
 const active=tables.filter(t=>t.status!=='cancelled');
 switch(rule.rule_type){
  case 'per_person':return qty*active.reduce((s,t)=>s+n(t.planned_guest_count),0);
  case 'per_n_people':return people>0?qty*active.reduce((s,t)=>s+Math.ceil(n(t.planned_guest_count)/people),0):0;
  case 'per_table':return qty*active.length;
  case 'fixed_event':return qty;
  default:return 0;
 }
}
export function externalBudgetV038(items=[],rules=[],tables=[]){
 const byId=new Map(items.filter(i=>i.is_active!==false).map(i=>[String(i.id),i]));
 const lines=rules.filter(r=>r.is_active!==false).map(rule=>{
  const item=byId.get(String(rule.dish_id));
  const required=externalRequiredV038(rule,tables);
  return {rule,item,required,cost:item?required*n(item.unit_cost_base):0,missing:!item};
 });
 const allocated=new Map();for(const l of lines)allocated.set(String(l.rule.dish_id),(allocated.get(String(l.rule.dish_id))||0)+l.required);
 const shortages=[...byId.values()].map(item=>({item,needed:allocated.get(String(item.id))||0})).filter(x=>x.needed>n(x.item.purchased_quantity)+1e-7);
 return {lines,shortages,plannedCost:lines.reduce((s,l)=>s+l.cost,0),purchasedCost:[...byId.values()].reduce((s,x)=>s+n(x.purchased_quantity)*n(x.unit_cost_base),0),missing:lines.filter(l=>l.missing).length};
}
export function augmentEventQuoteV038(base,externalCost,wastePercent=0){
 const extra=Math.max(0,n(externalCost)),reserve=extra*Math.max(0,n(wastePercent))/100;
 const total=base.total+extra+reserve,food=base.food+extra;
 const profit=base.revenue-total;
 return {...base,food,reserve:base.reserve+reserve,total,profit,
 costPerPerson:base.count>0?total/base.count:null,
 costPerTable:base.tableCount>0?total/base.tableCount:null,
 suggestedTicket:null,breakEvenTicket:null,
 marginPercent:base.revenue>0?profit*100/base.revenue:null,externalFood:extra};
}
