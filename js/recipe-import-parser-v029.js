// Supports the original complete v0.27 workbook, and a filtered v0.29 workbook.
import {parseRecipesV027} from './recipe-import-parser-v027.js?v=0.27';
const s=v=>String(v??'').trim();
const rowObjects=(sheet,keys)=>{
 if(!sheet?.rows?.length)throw Error('RECIPE_V029_INVALID_FORMAT');
 const header=sheet.rows[0].map(s),indices=keys.map(x=>header.indexOf(x));
 if(indices.some(i=>i<0))throw Error('RECIPE_V029_INVALID_FORMAT');
 return sheet.rows.slice(1).filter(r=>r.some(c=>s(c))).map(r=>Object.fromEntries(keys.map((k,i)=>[k,r[indices[i]]])));
};
export function parseRecipesV029(workbook){
 const hasV029=workbook.sheets.some(s=>s.name==='IMPORT_RECIPES_V029');
 if(!hasV029)return parseRecipesV027(workbook);
 const rec=rowObjects(workbook.sheets.find(s=>s.name==='IMPORT_RECIPES_V029'),
  ['recipe_key','menu_name','source_name','source_row','recipe_servings','portions_basis']);
 const lin=rowObjects(workbook.sheets.find(s=>s.name==='IMPORT_LINES_V029'),
  ['recipe_key','menu_name','material_name','quantity_base','base_unit','new_material','source_rows','origin','assumption']);
 const recipes=rec.map(r=>({key:s(r.recipe_key),menuName:s(r.menu_name),sourceName:s(r.source_name),sourceRow:Number(r.source_row)}));
 const lines=lin.map(r=>({recipeKey:s(r.recipe_key),menuName:s(r.menu_name),materialName:s(r.material_name),
  quantityBase:Number(r.quantity_base),baseUnit:s(r.base_unit),newMaterial:false,
  sourceRows:s(r.source_rows),origin:s(r.origin),assumption:s(r.assumption)}));
 const keys=new Set(recipes.map(r=>r.key));
 if(recipes.length>75 || keys.size!==recipes.length ||
    new Set(recipes.map(r=>r.menuName)).size!==recipes.length ||
    recipes.some(r=>!r.key||!r.menuName)||
    lines.some(l=>!keys.has(l.recipeKey)||!l.materialName||!l.baseUnit||
    !Number.isFinite(l.quantityBase)||l.quantityBase<=0||l.quantityBase>1e7)||
    recipes.some(r=>!lines.some(l=>l.recipeKey===r.key))){
  throw Error('RECIPE_V029_INVALID_FORMAT');
 }
 return {recipes,lines,newMaterials:[],estimates:lines.filter(l=>l.assumption).length};
}
