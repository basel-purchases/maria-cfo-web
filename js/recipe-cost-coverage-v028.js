// Maria CFO Web v0.28 — pure, read-only quote of a recipe based exclusively on
// the matching row in public.materials. Prices from Excel must never override it.

function key(v){return String(v??'').trim().toLocaleLowerCase('ar').replace(/\s+/g,' ');}
export function liveBaseUnitPrice(material){
  if(!material)return null;
  const raw=material.last_purchase_unit_cost_base;
  if(raw===null || raw===undefined || raw==='')return null;
  const value=Number(raw);
  return Number.isFinite(value)&&value>=0?value:null;
}
export function summarizeRecipeMaterialPrices(recipes,lines,materials){
  const byName=new Map();
  for(const m of materials){
    const k=key(m.name);
    byName.set(k,[...(byName.get(k)||[]),m]);
  }
  const grouped=new Map(recipes.map(r=>[r.key,{key:r.key,name:r.menuName,pricedLines:0,missingLines:0,knownSubtotal:0}]));
  const missing=new Map(), pricedIds=new Set(),missingIds=new Set();
  let pricedLines=0,missingLines=0;
  for(const line of lines){
    const matches=byName.get(key(line.materialName))||[];
    const material=matches.length===1?matches[0]:null;
    const unitPrice=liveBaseUnitPrice(material);
    const recipe=grouped.get(line.recipeKey);
    const quantity=Number(line.quantityBase);
    const priced=unitPrice!==null && Number.isFinite(quantity)&&quantity>0;
    if(priced){
      pricedLines++;
      if(material?.id)pricedIds.add(String(material.id));
      if(recipe){recipe.pricedLines++;recipe.knownSubtotal+=quantity*unitPrice;}
    }else{
      missingLines++;
      if(material?.id)missingIds.add(String(material.id));
      if(recipe)recipe.missingLines++;
      missing.set(key(line.materialName),String(line.materialName));
    }
  }
  const summaries=[...grouped.values()].map(r=>({...r,complete:r.missingLines===0}));
  return {
    totalLines:lines.length,pricedLines,missingLines,
    pricedMaterials:pricedIds.size,missingMaterials:missingIds.size,
    missingNames:[...missing.values()].sort((a,b)=>a.localeCompare(b,'ar')),
    fullyPricedRecipes:summaries.filter(x=>x.complete).length,
    recipes:summaries,
  };
}
