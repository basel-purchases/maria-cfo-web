// Maria CFO v0.29 - deterministic catalogue entry policy. Pure functions.
import {cleanName} from './ameen-import-parser.js?v=1.0';
const n = v => Number(v);
export const positive = v => v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(n(v)) && n(v)>0;
export const hasWarehouse = v => String(v??'').trim().length>0;
export const catalogKey = v => String(v??'').trim().toLocaleLowerCase('ar');
export function liveMaterialCosts(materials=[]){
 const byName=new Map();
 for(const m of materials){
  const key=catalogKey(m.name);
  byName.set(key,[...(byName.get(key)||[]),m]);
 }
 return byName;
}
export function inventoryDecision(row,materialIndex=new Map()){
 const wh=hasWarehouse(row?.warehouse), stock=positive(row?.quantity), source=positive(row?.price);
 const kind=String(row?.kind||'');
 if(kind==='material'){
  if(String(row?.warehouse??'').trim()==='مستودع المطبخ')return {ok:false,reason:'مستودع المطبخ مصدره فواتير حركة مادة؛ يمنع استيراده مرتين'};
  if(!wh)return {ok:false,reason:'لا يوجد مستودع'};
  if(!stock)return {ok:false,reason:'الرصيد صفر أو غير موجب'};
  const matches=materialIndex.get(catalogKey(row.name))||[];
  if(matches.length>1)return {ok:false,reason:'اسم مادة مكرر في القاعدة ويحتاج مراجعة'};
  const stored=matches.length===1&&positive(matches[0]?.last_purchase_unit_cost_base);
  if(!source&&!stored)return {ok:false,reason:'لا يوجد سعر موجب في الملف ولا في جدول المواد'};
  return {ok:true,priceSource:source?'excel':'database'};
 }
 if(kind==='menu')return source?{ok:true,priceSource:'excel'}:{ok:false,reason:'الوجبة بلا سعر بيع موجب'};
 if(kind==='asset')return wh&&stock?{ok:true}:{ok:false,reason:!wh?'لا يوجد مستودع':'الرصيد صفر أو غير موجب'};
 return {ok:false,reason:'نوع صنف غير معروف'};
}
export function filterInventoryV029(records,materials=[]){
 const byName=liveMaterialCosts(materials),accepted=[],rejected=[];
 for(const row of records){
  const choice=inventoryDecision(row,byName);
  if(choice.ok)accepted.push(row);else rejected.push({...row,skipReason:choice.reason});
 }
 const count=kind=>accepted.filter(r=>r.kind===kind).length;
 return {records:accepted,rejected,counts:{accepted:accepted.length,rejected:rejected.length,
  menu:count('menu'),material:count('material'),asset:count('asset')}};
}
// Require a positive balance IN AN IMPORTED WAREHOUSE, not merely a detached material label.
export function hasPositiveWarehouseInventory(materialId,warehouseRows=[]){
 return warehouseRows.some(row => String(row?.core_entity_id)===String(materialId) &&
    row.kind==='material' && hasWarehouse(row.warehouse) && positive(row.quantity_base) && !row.review_reason);
}
export function recipeEligibility(recipe,lines,menu,materialByName,warehouseRows=[]){
 const problems=[];
 if(!menu||!positive(menu.manual_price_original))problems.push('الوجبة بلا سعر بيع موجب معتمد');
 for(const line of lines){
  const matches=materialByName.get(catalogKey(line.materialName))||[];
  const m=matches.length===1?matches[0]:null;
  if(!m){problems.push(`${line.materialName}: المادة غير موجودة أو اسمها مكرر`);continue;}
  if(!positive(m.last_purchase_unit_cost_base))problems.push(`${line.materialName}: تكلفة المادة غير معروفة أو صفر`);
  if(!positive(m.current_stock_base))problems.push(`${line.materialName}: رصيد المادة غير موجب`);
  if(!hasPositiveWarehouseInventory(m.id,warehouseRows))problems.push(`${line.materialName}: لا يوجد رصيد صالح في مستودع مستورد`);
 }
 return {eligible:problems.length===0,problems};
}
