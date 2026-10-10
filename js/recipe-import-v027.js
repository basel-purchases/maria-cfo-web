// Maria CFO v0.27: deterministic, one-time, fully validated recipe import for existing menu items.
import * as api from './api.js?v=0.27';
import {esc} from './utils.js?v=0.27';
import {toast,loader,friendlyError} from './ui.js?v=0.27';
import {readAmeenWorkbook,sha256Hex} from './ameen-import-parser.js?v=0.27';
import {parseRecipesV027} from './recipe-import-parser-v027.js?v=0.27';
import {alignRecipeLinesToCatalog} from './recipe-unit-match-v0272.js?v=0.27.2';
export {parseRecipesV027};

const TXT={
 title:'\u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0648\u0635\u0641\u0627\u062a \u0627\u0644\u0645\u0646\u064a\u0648 (75 \u0648\u062c\u0628\u0629)',
 sub:'\u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0645\u0631\u0629 \u0648\u0627\u062d\u062f\u0629 \u0625\u0644\u0649 \u0627\u0644\u0648\u062c\u0628\u0627\u062a \u0627\u0644\u0645\u0648\u062c\u0648\u062f\u0629. \u0644\u0627 \u062a\u062a\u063a\u064a\u0631 \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0629 \u0623\u0648 \u0623\u0631\u0635\u062f\u0629 \u0627\u0644\u0645\u062e\u0632\u0648\u0646.',
 dl:'\u062a\u0646\u0632\u064a\u0644 \u0645\u0644\u0641 \u0627\u0644\u0648\u0635\u0641\u0627\u062a \u0627\u0644\u0645\u0639\u0627\u0644\u062c',
 choose:'\u0627\u062e\u062a\u0631 \u0645\u0644\u0641 \u0648\u0635\u0641\u0627\u062a Maria CFO \u0628\u0635\u064a\u063a\u0629 Excel',
 preview:'\u0645\u0639\u0627\u064a\u0646\u0629 \u0648\u0641\u062d\u0635 \u0627\u0644\u0645\u0644\u0641',
 import:'\u062a\u0623\u0643\u064a\u062f \u0648\u062d\u0641\u0638 \u0627\u0644\u0645\u0643\u0648\u0646\u0627\u062a \u0641\u064a \u0627\u0644\u0648\u062c\u0628\u0627\u062a',
 total:'\u0639\u062f\u062f \u0648\u0635\u0641\u0627\u062a \u0627\u0644\u0645\u0646\u064a\u0648',
 rows:'\u0628\u0646\u0648\u062f \u0645\u0648\u0627\u062f \u0627\u0644\u0648\u0635\u0641\u0627\u062a',
 created:'\u0645\u0648\u0627\u062f \u062c\u062f\u064a\u062f\u0629 \u0628\u0633\u0639\u0631 \u0634\u0631\u0627\u0621 \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641',
 assumed:'\u0627\u0641\u062a\u0631\u0627\u0636\u0627\u062a \u062a\u062d\u0648\u064a\u0644 \u062a\u062d\u062a\u0627\u062c \u062a\u062f\u0642\u064a\u0642\u064b\u0627',
 errors:'\u0648\u062c\u0628\u0627\u062a \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f\u0629 \u0628\u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a',
 replaced:'\u0623\u0648\u0627\u0641\u0642 \u0639\u0644\u0649 \u0627\u0633\u062a\u0628\u062f\u0627\u0644 \u0627\u0644\u0645\u0643\u0648\u0646\u0627\u062a \u0627\u0644\u0642\u062f\u064a\u0645\u0629 \u0644\u0647\u0630\u0647 \u0627\u0644\u0648\u062c\u0628\u0627\u062a \u0628\u0639\u062f \u062d\u0641\u0638 \u0646\u0633\u062e\u0629 \u0627\u062d\u062a\u064a\u0627\u0637\u064a\u0629.',
 warn:'\u0627\u0644\u0645\u0648\u0627\u062f \u0627\u0644\u062c\u062f\u064a\u062f\u0629 \u0633\u062a\u064f\u0646\u0634\u0623 \u0628\u0631\u0635\u064a\u062f \u0635\u0641\u0631 \u0648\u062f\u0648\u0646 \u0633\u0639\u0631 \u0634\u0631\u0627\u0621. \u0623\u0648\u0632\u0627\u0646 \u0627\u0644\u0639\u0628\u0648\u0627\u062a \u0627\u0644\u062a\u0642\u062f\u064a\u0631\u064a\u0629 \u0644\u064a\u0633\u062a \u0623\u0648\u0632\u0627\u0646\u064b\u0627 \u0645\u0624\u0643\u062f\u0629.',
 blocked:'\u0628\u0639\u0636 \u0627\u0644\u0648\u062c\u0628\u0627\u062a \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f\u0629. \u0644\u0645 \u0646\u0646\u0641\u0630 \u0623\u064a \u0627\u0633\u062a\u064a\u0631\u0627\u062f.',
 done:'\u0627\u0643\u062a\u0645\u0644 \u0631\u0628\u0637 \u0627\u0644\u0648\u0635\u0641\u0627\u062a \u0628\u0627\u0644\u0645\u0646\u064a\u0648 \u062f\u0648\u0646 \u062a\u062d\u0631\u064a\u0643 \u0623\u0631\u0635\u062f\u0629 \u0627\u0644\u0645\u062e\u0632\u0648\u0646.',
 invalid:'\u0627\u0644\u0645\u0644\u0641 \u0644\u0627 \u064a\u0637\u0627\u0628\u0642 \u0628\u0646\u064a\u0629 \u0648\u0635\u0641\u0627\u062a v0.27. \u0627\u0633\u062a\u062e\u062f\u0645 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0639\u0627\u0644\u062c.',
 sql:'\u0646\u0641\u0630 \u062a\u0631\u062d\u064a\u0644 SQL v0.27 \u0627\u0644\u0645\u0646\u0641\u0635\u0644 \u0641\u064a Supabase \u0623\u0648\u0644\u064b\u0627.',
 history:'\u0639\u0645\u0644\u064a\u0627\u062a \u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0627\u0644\u0648\u0635\u0641\u0627\u062a',
 already:'\u0633\u0628\u0642 \u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u062f\u0648\u0646 \u062a\u063a\u064a\u064a\u0631\u061b \u0644\u0645 \u0646\u0643\u0631\u0631 \u0627\u0644\u0645\u0643\u0648\u0646\u0627\u062a.',
 progress:'\u062c\u0627\u0631 \u0627\u0644\u062d\u0641\u0638 \u062f\u0627\u062e\u0644 \u0645\u0639\u0627\u0645\u0644\u0629 \u0648\u0627\u062d\u062f\u0629. \u0644\u0627 \u062a\u063a\u0644\u0642 \u0627\u0644\u0635\u0641\u062d\u0629.',
};
async function verifyMenuCatalog(parsed){
  const [menu,materials,units]=await Promise.all([
    api.catalogRows('menu_items','id,name'),
    api.catalogRows('materials','id,name,base_unit_id'),
    api.catalogRows('units','id,name,code,is_material_specific'),
  ]);
  // Must agree with SQL v0.27: trim/whitespace/case only, no approximate Arabic aliases.
  const exact=safeText=>String(safeText??'').trim().toLocaleLowerCase('ar').replace(/\s+/g,' ');
  const menuNames=new Map();for(const r of menu){const k=exact(r.name);menuNames.set(k,(menuNames.get(k)||0)+1);}
  const stockNames=new Map();for(const r of materials){const k=exact(r.name);if(!stockNames.has(k))stockNames.set(k,[]);stockNames.get(k).push(r);}
  const missingMenu=parsed.recipes.filter(r=>menuNames.get(exact(r.menuName))!==1).map(r=>r.menuName);
  const matched=alignRecipeLinesToCatalog(parsed.lines,materials,units);
  const missingStock=parsed.newMaterials.filter(n=>!stockNames.has(exact(n)));
  return {missingMenu,missingStock,menu,menuNames,...matched};
}

function blockScreen(){
  const overlay=document.createElement('div');overlay.className='ameen-import-blocker';
  overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-modal','true');
  overlay.innerHTML=`<div class="ameen-block-card"><div class="loader"></div><h3>${TXT.progress}</h3></div>`;
  document.body.append(overlay);
  document.querySelector('#app')?.setAttribute('inert','');
  return ()=>{overlay.remove();document.querySelector('#app')?.removeAttribute('inert');};
}

export async function renderRecipeImportV027(root){
 root.innerHTML=`<div class="page-head"><div><h2>${TXT.title}</h2><p>${TXT.sub}</p></div>
  <a class="btn secondary" href="./templates/Maria-CFO-75-Recipes-v0.27-Ready.xlsx" download>${TXT.dl}</a></div>
  <div class="card"><div class="field"><label for="recipe-v027-file">${TXT.choose}</label>
   <input type="file" id="recipe-v027-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></div>
   <div class="quick-actions"><button class="btn" id="recipe-v027-preview" type="button">${TXT.preview}</button></div>
   <div class="notice">${TXT.warn}</div></div>
  <div id="recipe-v027-preview-area" aria-live="polite"></div>
  <div class="card"><h3>${TXT.history}</h3><div id="recipe-v027-history">${loader()}</div></div>`;
 const fileInput=root.querySelector('#recipe-v027-file'),previewButton=root.querySelector('#recipe-v027-preview');
 const previewHost=root.querySelector('#recipe-v027-preview-area');
 async function history(){const el=root.querySelector('#recipe-v027-history');
   try{
    const list=await api.rpc('recipe_import_history_v027');
    el.innerHTML=Array.isArray(list)&&list.length?`<div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>${TXT.total}</th><th>${TXT.rows}</th><th>${TXT.created}</th></tr></thead><tbody>${list.map(x=>`<tr><td>${esc(String(x.imported_at||'').slice(0,16))}</td><td>${esc(x.recipe_count)}</td><td>${esc(x.material_line_count)}</td><td>${esc(x.created_materials)}</td></tr>`).join('')}</tbody></table></div>`:'<p>\u0644\u0645 \u064a\u064f\u0633\u062c\u0651\u0644 \u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0633\u0627\u0628\u0642.</p>';
   }catch(e){el.innerHTML=`<div class="notice">${TXT.sql}</div>`;}
 }
 await history();
 previewButton.onclick=async()=>{
  const file=fileInput.files?.[0];if(!file){toast(TXT.choose,'error');return;}
  previewButton.disabled=true;
  previewHost.innerHTML=loader();
  try{
   const workbook=await readAmeenWorkbook(file);
   const parsed=parseRecipesV027(workbook);
   const check=await verifyMenuCatalog(parsed);
   const hash=await sha256Hex(workbook.buffer);
   // An absent menu label is not an absent ingredient. Let the owner explicitly
   // associate the Excel recipe with an EXISTING menu item without changing DB names.
   const issues=[...check.unexpected.map(x=>'مادة غير موجودة: '+x),...check.unitMismatch];
   const menuOptions=check.menu.filter(r=>check.menuNames.get(String(r.name??'').trim().toLocaleLowerCase('ar').replace(/\s+/g,' '))===1);
   const missingSet=new Set(check.missingMenu);
   const usedExact=new Set(parsed.recipes.filter(r=>!missingSet.has(r.menuName)).map(r=>String(r.menuName).trim().toLocaleLowerCase('ar').replace(/\s+/g,' ')));
   const remainingMenu=menuOptions.filter(r=>!usedExact.has(String(r.name).trim().toLocaleLowerCase('ar').replace(/\s+/g,' ')));
   const mappingMarkup=check.missingMenu.length?`<div class="notice"><strong>الوجبات التالية لم تتطابق أسماؤها مع قاعدة البيانات. اختر لكل وصفة الوجبة الموجودة المقصودة (لا ننشئ وجبات جديدة):</strong>
     ${check.missingMenu.map((name,i)=>`<div class="field"><label for="recipe-map-${i}">${esc(name)}</label>
       <select id="recipe-map-${i}" data-recipe-name="${esc(name)}" class="recipe-menu-map"><option value="">— اختر الوجبة الموجودة —</option>
       ${remainingMenu.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>`).join('')}</div>`:'';
   previewHost.innerHTML=`<div class="card"><div class="grid cols-3 finance-summary-grid">
    <div class="card"><strong>${parsed.recipes.length}</strong><p>${TXT.total}</p></div>
    <div class="card"><strong>${parsed.lines.length}</strong><p>${TXT.rows}</p></div>
    <div class="card"><strong>${check.missingStock.length}</strong><p>${TXT.created}</p></div></div>
    <p class="metric-note">${TXT.assumed}: ${parsed.estimates}</p>
    ${mappingMarkup}
    ${check.unitAliases.length?`<div class="notice green"><strong>تم التعرف على مسميات وحدات متكافئة دون تحويل أو تعديل أي كمية.</strong><p>${check.unitAliases.map(x=>esc(x)).join(' · ')}</p></div>`:''}
    ${issues.length?`<div class="notice rose"><strong>توجد أخطاء مواد أو وحدات يجب تصحيحها قبل الاستيراد.</strong><ul>${issues.slice(0,20).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:
    `${check.missingMenu.length?'':'<div class="notice green">جميع أسماء الوجبات متطابقة مع القاعدة.</div>'}`}
    <label class="recipe-confirm-check"><input type="checkbox" id="recipe-v027-replace"> ${TXT.replaced}</label>
    <button class="btn" id="recipe-v027-commit" type="button" ${issues.length?'disabled':''}>${TXT.import}</button>
    <p class="metric-note">${TXT.warn}</p>
   </div>`;
   const submit=previewHost.querySelector('#recipe-v027-commit');
   if(!submit)return;
   const selectors=[...previewHost.querySelectorAll('.recipe-menu-map')];
   function validateMappings(){
     const values=selectors.map(el=>el.value);
     const distinct=new Set(values.filter(Boolean));
     const valid=values.every(Boolean)&&distinct.size===values.length;
     submit.disabled=issues.length>0||!valid;
     return valid;
   }
   selectors.forEach(el=>el.addEventListener('change',validateMappings));
   validateMappings();
   submit.onclick=async()=>{
    if(!validateMappings()){toast('يرجى ربط كل وصفة بوجبة مختلفة موجودة في القائمة.','error');return;}
    const map=new Map(selectors.map(el=>[el.dataset.recipeName,remainingMenu.find(r=>String(r.id)===el.value)?.name]));
    if([...map.values()].some(x=>!x)){toast('الوجبة المختارة غير موجودة. أعد المعاينة.','error');return;}
    const resolvedRecipes=parsed.recipes.map(r=>({...r,menuName:map.get(r.menuName)||r.menuName}));
    const names=resolvedRecipes.map(r=>String(r.menuName).trim().toLocaleLowerCase('ar').replace(/\s+/g,' '));
    if(new Set(names).size!==names.length){toast('لا يمكن ربط وصفتين بالوجبة نفسها.','error');return;}

    if(!previewHost.querySelector('#recipe-v027-replace').checked){toast(TXT.replaced,'error');return;}
    submit.disabled=true;const release=blockScreen();
    try{
     const result=await api.rpc('import_menu_recipes_v027',{
      p_sha256:hash,p_recipes:resolvedRecipes,p_lines:check.canonicalLines,p_replace_existing:true
     });
     previewHost.innerHTML=`<div class="card notice green"><h3>${result.duplicateFile?TXT.already:TXT.done}</h3>
      <p>${TXT.total}: ${esc(result.recipesImported||75)} | ${TXT.created}: ${esc(result.materialsCreated??0)}</p></div>`;
     toast(result.duplicateFile?TXT.already:TXT.done,'success');
     await history();
    }catch(e){toast(friendlyError(e), 'error');
     previewHost.insertAdjacentHTML('beforeend',`<div class="notice rose">${esc(e?.message||TXT.sql)}</div>`);
    }finally{release();submit.disabled=false;}
   };
  }catch(e){previewHost.innerHTML=`<div class="notice rose">${esc(e?.message||TXT.invalid)}</div>`;}
  finally{previewButton.disabled=false;}
 };
}
