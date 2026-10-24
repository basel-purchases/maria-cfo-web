// Supplier-aware suggestions only. Never associate an uncertain OCR name
// with a material ID automatically: owner confirmation remains mandatory.
import {materialKeyV106,materialNamesV106} from './material-search-v106.js?v=1.0.10';
function grams(text){
 const s=materialKeyV106(text).replace(/[^\p{L}\p{N}]/gu,'');
 if(s.length<3)return new Set(s?[s]:[]);
 return new Set([...s.slice(0,-1)].map((_,i)=>s.slice(i,i+2)));
}
function similarity(a,b){
 const A=grams(a),B=grams(b);
 if(!A.size||!B.size)return 0;
 let common=0;for(const k of A)if(B.has(k))common++;
 return 2*common/(A.size+B.size);
}
export function supplierOcrSuggestionsV110(name,materials,historyRows=[],max=4){
 const q=materialKeyV106(name);
 if(!q)return [];
 const history=new Set(historyRows.map(r=>String(r.material_id||r.id||'')));
 const picks=(materials||[]).map(m=>{
  const names=materialNamesV106(m);
  const closeness=Math.max(0,...names.map(n=>similarity(q,n)));
  const direct=names.some(n=>materialKeyV106(n)===q);
  const isSupplier=history.has(String(m.id));
  const score=(direct?100:closeness*65)+(isSupplier?25:0);
  return {material:m,score,supplier:isSupplier,confidence:closeness};
 }).filter(p=>p.score>=30 && (p.supplier||p.confidence>=.57));
 return picks.sort((a,b)=>b.score-a.score||String(a.material.name).localeCompare(String(b.material.name),'ar'))
  .slice(0,max);
}
export function annotateSupplierOcrV110(items,materials,historyRows=[]){
 return (items||[]).map(row=>{
  if(row.catalog_id)return row;
  const suggestions=supplierOcrSuggestionsV110(row.name,materials,historyRows);
  if(!suggestions.length)return row;
  const names=suggestions.slice(0,3).map(s=>s.material.name);
  const note=`اقتراحات من ${suggestions.some(s=>s.supplier)?'مشتريات المورد وسجل المواد':'سجل المواد'}: ${names.join('، ')}. اختر المادة المناسبة بعد مراجعة الصورة.`;
  const old=String(row.review_note||'');
  return {...row,supplier_ocr_suggestions:suggestions.map(s=>String(s.material.id)),
   ocr_review_required:true,ocr_reviewed:false,
   review_note:old.includes('اقتراحات من مشتريات المورد')?old:[old,note].filter(Boolean).join(' ')};
 });
}
