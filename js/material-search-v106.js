// Shared, deterministic material matching across catalog, purchases, recipes and OCR.
// Never guess a material ID on a fuzzy match: an exact match must be UNIQUE.
export function materialKeyV106(value){
 return String(value??'').normalize('NFKC')
  .replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)>=0x6f0?0x6f0:0x660)))
  .replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي')
  .replace(/\s+/g,' ').trim().toLocaleLowerCase('ar');
}
export function materialNamesV106(material){
 return [material?.name,...(Array.isArray(material?.__aliases)?material.__aliases:[])].filter(Boolean);
}
export const materialSearchTextV106=mat=>[...materialNamesV106(mat),mat?.quick_code,mat?.code].filter(Boolean).join(' ');
export function materialMatchesV106(mat,query){
 const q=materialKeyV106(query);
 return !q||materialKeyV106(materialSearchTextV106(mat)).includes(q) || materialNamesV106(mat).some(x=>materialKeyV106(x).includes(q));
}
export function materialExactV106(query,materials){
 const key=materialKeyV106(query);if(!key)return null;
 const hits=(materials||[]).filter(m=>materialNamesV106(m).some(n=>materialKeyV106(n)===key));
 return hits.length===1?hits[0]:null;
}
export function materialSuggestionsV106(query,materials,supplierMaterialIds=[],max=12){
 const q=materialKeyV106(query),supplier=new Set([...supplierMaterialIds].map(String));
 if(!q)return (materials||[]).filter(m=>supplier.has(String(m.id))).slice(0,max);
 return (materials||[]).map(m=>{
  const names=materialNamesV106(m).map(materialKeyV106);
  const exact=names.some(n=>n===q),starts=names.some(n=>n.startsWith(q)),includes=names.some(n=>n.includes(q)||q.includes(n)&&n.length>2);
  const code=[m.quick_code,m.code].some(v=>v&&materialKeyV106(v)===q);
  const score=exact?100:code?90:starts?55:includes?20:-1;
  return {material:m,score:score>=0?score+(supplier.has(String(m.id))?12:0):-1};
 }).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score||String(a.material.name).localeCompare(String(b.material.name),'ar'))
  .slice(0,max).map(x=>x.material);
}
