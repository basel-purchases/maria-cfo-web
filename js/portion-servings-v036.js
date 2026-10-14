// Maria CFO v0.36 — restaurant event servings and recipe-preserving conversion.
// A menu item recipe is priced per FULL menu item. A serving is a defined fraction
// of that item, never a guessed weight or a free-floating inventory movement.
export const SERVING_RULE_NAMES_V036 = Object.freeze({
 per_person:'لكل ضيف',per_n_people:'لكل مجموعة على الطاولة',
 per_table:'لكل طاولة',fixed_event:'مرة واحدة للحفلة'
});
const number=v=>{const n=Number(v);return Number.isFinite(n)?n:NaN;};
export function menuEquivalentV036(servings, servingsPerMenuItem){
 const qty=number(servings),yieldCount=number(servingsPerMenuItem);
 if(!(qty>0)||!(yieldCount>0)||qty>100000||yieldCount>100000)throw Error('EVENT_SERVING_AMOUNT_INVALID');
 const raw=qty/yieldCount;
 // event_menu_rules.quantity_per_rule is numeric(20,4); do not silently post zero
 // or an excessively rounded quantity to the accounting/inventory system.
 const result=Math.round(raw*10000)/10000;
 if(!(result>=0.0001)||Math.abs(result-raw)/raw>0.001)throw Error('EVENT_PORTION_PRECISION');
 return result;
}
export function plannedDistributionsV036({ruleType,people=1,tables=[],guestCount=0}={}){
 const active=tables.filter(t=>t.status!=='cancelled');
 const total=Math.max(0,Math.floor(Number(guestCount)||0));
 switch(ruleType){
  case 'per_person':return total;
  case 'per_table':return active.length;
  case 'fixed_event':return 1;
  case 'per_n_people':{
   const n=Number(people);
   if(!(n>=1&&Number.isInteger(n)))return 0;
   return active.length?active.reduce((sum,t)=>sum+Math.ceil(Math.max(0,Number(t.planned_guest_count)||0)/n),0):Math.ceil(total/n);
  }
  default:return 0;
 }
}
export function portionPreviewV036({servings=1,yieldCount=1,ruleType='per_person',people=1,tables=[],guests=0,unitCost=null}={}){
 const menuQuantity=menuEquivalentV036(servings,yieldCount);
 const distributions=plannedDistributionsV036({ruleType,people,tables,guestCount:guests});
 const totalMenuUnits=Number((menuQuantity*distributions).toFixed(4));
 const price=unitCost==null?null:Number(unitCost);
 return {menuQuantity,distributions,totalMenuUnits,
  unitCost:price!=null&&Number.isFinite(price)?price*menuQuantity:null,
  totalCost:price!=null&&Number.isFinite(price)?price*totalMenuUnits:null};
}
const norm=s=>String(s||'').trim().replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').toLowerCase();
const saleCode=s=>{
 const v=norm(s);
 if(['كيلو','كيلو غرام','كيلوغرام','كغ','kg','kgs'].includes(v))return 'KG';
 if(['غرام','غ','g','gram','جرام'].includes(v))return 'G';
 if(['لتر','l','liter'].includes(v))return 'L';
 if(['مل','مليلتر','ml'].includes(v))return 'ML';
 return null;
};
export function conversionHintsV036({saleUnit='',units=[],conversions=[],recipeLines=[],materials=[],materialLinks=[]}={}){
 const sale=saleCode(saleUnit);
 if(!sale)return [];
 const saleUnits=units.filter(u=>String(u.code).toUpperCase()===sale);
 if(saleUnits.length!==1)return [];
 const base=saleUnits[0];
 const hints=[];
 for(const rel of conversions){
  const from=String(rel.from_unit_id)===String(base.id),to=String(rel.to_unit_id)===String(base.id);
  if(!from&&!to)continue;
  const unit=units.find(u=>String(u.id)===String(from?rel.to_unit_id:rel.from_unit_id));
  const f=Number(rel.factor);
  const ratio=from?f:1/f;
  if(unit&&ratio>0&&Number.isFinite(ratio))hints.push({unitId:unit.id,ratio,source:'تحويل وحدات معرّف',rank:1});
 }
 const materialById=new Map(materials.map(m=>[String(m.id),m]));
 const included=new Set(recipeLines.map(r=>String(r.material_id)));
 for(const link of materialLinks){
  if(!included.has(String(link.material_id)))continue;
  const mat=materialById.get(String(link.material_id));
  if(!mat||String(mat.base_unit_id)!==String(base.id))continue;
  const unit=units.find(u=>String(u.id)===String(link.unit_id));
  const factor=Number(link.quantity_in_base);
  if(unit&&factor>0&&Number.isFinite(factor))hints.push({unitId:unit.id,ratio:1/factor,
    source:`تحويل مادة «${mat.name}» — راجع ملاءمته للوجبة`,rank:2});
 }
 // A disagreement between possible materials cannot silently choose a conversion.
 const grouped=new Map();
 for(const h of hints){const key=String(h.unitId);grouped.set(key,[...(grouped.get(key)||[]),h]);}
 return [...grouped].flatMap(([id,rows])=>{
  const primary=rows.sort((a,b)=>a.rank-b.rank)[0];
  if(rows.some(r=>Math.abs(r.ratio-primary.ratio)>1e-6))return [];
  return [{...primary,unitId:id}];
 });
}
export function platePerGuestV036(items,menuCosts=[]){
 const map=new Map(menuCosts.map(x=>[String(x.id),x]));
 let total=0,missing=0;
 for(const item of items){
  const cost=map.get(String(item.menu_item_id));
  if(!cost||cost.recipe_cost_base==null||cost.has_missing_cost){missing++;continue;}
  total+=(Number(item.quantity_per_rule)||0)*Number(cost.recipe_cost_base);
 }
 return {total,missing};
}
