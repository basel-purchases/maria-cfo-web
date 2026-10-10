// Pure validated parser for the two recipe import sheets.
import {cleanName} from './ameen-import-parser.js?v=0.27';
const normal=x=>cleanName(x);
const safe=v=>String(v??'').trim();
const number=v=>v===null||v===undefined||safe(v)===''?NaN:Number(v);
const normalizeHeader=(sheet,needed)=>{
  if(!sheet||!sheet.rows?.length)throw Error('RECIPE_V027_INVALID_FORMAT');
  const row=sheet.rows[0].map(safe);
  const indices=needed.map(h=>row.indexOf(h));
  if(indices.some(i=>i<0))throw Error('RECIPE_V027_INVALID_FORMAT');
  return sheet.rows.slice(1).filter(r=>r?.some(x=>x!=null&&safe(x))).map(r=>Object.fromEntries(needed.map((h,j)=>[h,r[indices[j]]])));
};

export function parseRecipesV027(workbook){
  const recipes=normalizeHeader(workbook.sheets.find(x=>x.name==='IMPORT_RECIPES_V027'),
    ['recipe_key','menu_name','source_name','source_row','recipe_servings','portions_basis']).map(x=>({
      key:safe(x.recipe_key),menuName:safe(x.menu_name),sourceName:safe(x.source_name),sourceRow:number(x.source_row)
    }));
  const lines=normalizeHeader(workbook.sheets.find(x=>x.name==='IMPORT_LINES_V027'),
    ['recipe_key','menu_name','material_name','quantity_base','base_unit','new_material','source_rows','origin','assumption']).map(x=>({
      recipeKey:safe(x.recipe_key),menuName:safe(x.menu_name),materialName:safe(x.material_name),
      quantityBase:number(x.quantity_base),baseUnit:safe(x.base_unit),
      newMaterial:[true,1,'1','true','TRUE','Yes'].includes(x.new_material),
      sourceRows:safe(x.source_rows),origin:safe(x.origin),assumption:safe(x.assumption)
    }));
  const keys=new Set(recipes.map(x=>x.key));
  if(recipes.length!==75||keys.size!==75||lines.length<75||lines.length>10000||
     recipes.some(x=>!x.key||!x.menuName)||
     new Set(recipes.map(x=>normal(x.menuName))).size!==75||
     lines.some(x=>!keys.has(x.recipeKey)||!x.materialName||!x.baseUnit||!(x.quantityBase>0)||x.quantityBase>1e7)||
     recipes.some(x=>!lines.some(l=>l.recipeKey===x.key)))throw Error('RECIPE_V027_INVALID_FORMAT');
  const newMaterials=new Set(lines.filter(x=>x.newMaterial).map(x=>x.materialName));
  const estimated=lines.filter(x=>x.assumption).length;
  return {recipes,lines,newMaterials:[...newMaterials],estimates:estimated};
}

