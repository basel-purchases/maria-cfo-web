// v1.0.21: Reuse the categories already configured under Settings > Input categories.
// Material and asset categories have separate tables/foreign keys in Supabase.
// Asset category names are offered as existing choices, but never stored as
// invalid asset UUIDs on materials. The corresponding material category is
// created *only when the user assigns it*, using the same existing name.
export function normalizeCategoryNameV121(value){
  return String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ar');
}

export function materialCategoryChoicesV121(materialCategories=[],assetCategories=[]){
  const choices=[],seen=new Set();
  for(const item of materialCategories||[]){
    const name=String(item?.name||'').trim();
    const id=String(item?.id||'').trim();
    const key=normalizeCategoryNameV121(name);
    if(!name||!id||seen.has(key))continue;
    choices.push({id,name,source:'material'});
    seen.add(key);
  }
  for(const item of assetCategories||[]){
    const name=String(item?.name||'').trim();
    const id=String(item?.id||'').trim();
    const key=normalizeCategoryNameV121(name);
    if(!name||!id||seen.has(key))continue;
    choices.push({id:`asset:${id}`,name,source:'asset'});
    seen.add(key);
  }
  return choices.sort((a,b)=>a.name.localeCompare(b.name,'ar'));
}

export async function resolveMaterialCategoryChoiceV121(value,choices,{loadMaterialCategories,createMaterialCategory}){
  const selected=String(value??'').trim();
  if(!selected)return null;
  const choice=(choices||[]).find(c=>String(c.id)===selected);
  if(!choice)throw new Error('MATERIAL_CATEGORY_INVALID_SELECTION');
  if(choice.source==='material')return choice.id;
  if(choice.source!=='asset')throw new Error('MATERIAL_CATEGORY_INVALID_SELECTION');
  if(typeof loadMaterialCategories!=='function'||typeof createMaterialCategory!=='function'){
    throw new Error('MATERIAL_CATEGORY_RESOLVER_UNAVAILABLE');
  }
  const existingName=normalizeCategoryNameV121(choice.name);
  const findExisting=async()=>{
    const current=await loadMaterialCategories();
    return (current||[]).find(c=>normalizeCategoryNameV121(c.name)===existingName);
  };
  const found=await findExisting();
  if(found?.id)return found.id;
  try{
    const saved=await createMaterialCategory(choice.name);
    if(!saved?.id)throw new Error('MATERIAL_CATEGORY_NOT_SAVED');
    return saved.id;
  }catch(error){
    // Concurrent users can select the same name. The unique index may reject
    // the second INSERT, in which case reuse the category that won the race.
    const concurrent=await findExisting();
    if(concurrent?.id)return concurrent.id;
    throw error;
  }
}
