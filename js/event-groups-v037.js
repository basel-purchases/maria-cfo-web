// Maria CFO v0.37 — grouping is presentation only. Never rewrite recipe quantities.
const n=x=>Number.isFinite(Number(x))?Number(x):0;
export function hospitalityGroupsV037({groups=[],servingRules=[],requirements=[],guests=0}={}){
 const groupLookup=new Map(groups.map(g=>[String(g.id),{group:g,rows:[],cost:0,missing:0,averagePerGuest:null}]));
 const meta=new Map(servingRules.map(m=>[String(m.rule_id),m]));
 const independent={group:null,rows:[],cost:0,missing:0,averagePerGuest:null};
 for(const r of requirements){
  const ref=String(meta.get(String(r.rule_id))?.main_plate_id||'');
  const target=groupLookup.get(ref)||independent;
  target.rows.push(r);
  if(r.has_missing_cost||r.unit_food_cost_base==null||r.estimated_food_cost_base==null)target.missing++;
  else target.cost+=n(r.estimated_food_cost_base);
 }
 const people=n(guests);
 for(const x of [...groupLookup.values(),independent])x.averagePerGuest=people>0?x.cost/people:null;
 return {groups:[...groupLookup.values()],independent,grandTotal:requirements.reduce((sum,r)=>sum+(
  r.has_missing_cost||r.unit_food_cost_base==null||r.estimated_food_cost_base==null?0:n(r.estimated_food_cost_base)),0),
  missing:requirements.filter(r=>r.has_missing_cost||r.unit_food_cost_base==null||r.estimated_food_cost_base==null).length};
}
