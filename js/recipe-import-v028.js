// Maria CFO Web v0.28 — re-import approved recipes and link prices from live materials.
// Never import the zero/estimated 'price' from the Excel workbook.
import * as api from './api.js?v=0.27';
import {esc,money} from './utils.js?v=0.27';
import {toast,loader,friendlyError} from './ui.js?v=0.27';
import {readAmeenWorkbook,sha256Hex} from './ameen-import-parser.js?v=0.27';
import {parseRecipesV027} from './recipe-import-parser-v027.js?v=0.27';
import {alignRecipeLinesToCatalog} from './recipe-unit-match-v0272.js?v=0.28';
import {summarizeRecipeMaterialPrices} from './recipe-cost-coverage-v028.js?v=0.28';

const normalize=x=>String(x??'').trim().toLocaleLowerCase('ar').replace(/\s+/g,' ');
const migrationNotice='شغّل ملف database/Maria-CFO-Web-v0.28-Recipe-Resync.sql في Supabase SQL Editor أولًا. لا يكفي رفع ملفات الموقع وحدها.';

async function fetchCatalogAndCoverage(parsed){
 const [menu,materials,units]=await Promise.all([
  api.catalogRows('menu_items','id,name'),
  api.catalogRows('materials','id,name,base_unit_id,last_purchase_unit_cost_base'),
  api.catalogRows('units','id,name,code,is_material_specific'),
 ]);
 const menuNames=new Map(),stockNames=new Map();
 for(const item of menu){const name=normalize(item.name);menuNames.set(name,(menuNames.get(name)||0)+1);}
 for(const item of materials){const name=normalize(item.name);stockNames.set(name,(stockNames.get(name)||0)+1);}
 const missingMenu=parsed.recipes.filter(r=>menuNames.get(normalize(r.menuName))!==1).map(r=>r.menuName);
 const matched=alignRecipeLinesToCatalog(parsed.lines,materials,units);
 const missingStock=[...new Set(parsed.lines.filter(l=>l.newMaterial && !stockNames.has(normalize(l.materialName)))
    .map(l=>l.materialName))];
 const coverage=summarizeRecipeMaterialPrices(parsed.recipes,matched.canonicalLines,materials);
 return {menu,menuNames,materials,units,missingMenu,missingStock,coverage,...matched};
}

function installBlock(){
 const overlay=document.createElement('div');
 overlay.className='ameen-import-blocker';overlay.setAttribute('role','alertdialog');
 overlay.setAttribute('aria-modal','true');
 overlay.innerHTML='<div class="ameen-block-card"><div class="loader"></div><h3>جار تحديث الوصفات ومطابقة الأسعار من المواد الموجودة في قاعدة البيانات...</h3></div>';
 document.body.append(overlay);document.querySelector('#app')?.setAttribute('inert','');
 return ()=>{overlay.remove();document.querySelector('#app')?.removeAttribute('inert');};
}

function showImportResult(result){
 return `<div class="card notice green"><h3>تمت مراجعة الوصفات وربط مكوناتها بمواد قاعدة البيانات.</h3>
  <p>الوجبات: <strong>${esc(result.recipesImported??75)}</strong> · مواد موجودة أو أضيفت: <strong>${esc(result.matchedMaterials??'—')}</strong></p>
  <p>بنود جديدة: <strong>${esc(result.linesInserted??0)}</strong> · بنود معدّلة: <strong>${esc(result.linesUpdated??0)}</strong> · بنود لم تتغير: <strong>${esc(result.linesUnchanged??0)}</strong> · بنود محذوفة حسب الملف: <strong>${esc(result.linesRemoved??0)}</strong></p>
  <p>المواد ذات سعر معروف في الجدول: <strong>${esc(result.pricedMaterials??'—')}</strong> · مواد بلا سعر معروف: <strong>${esc(result.missingPriceMaterials??'—')}</strong> · وصفات مكتملة التكلفة: <strong>${esc(result.recipesFullyPriced??'—')}</strong> من 75</p>
  <p>تُحسب التكلفة الحالية تلقائيًا من <code>materials.last_purchase_unit_cost_base</code>. لم نُغيّر أسعار المواد أو المخزون أو مبيعات الماضي.</p>
  <a class="btn secondary" href="#/menu">افتح الوجبات والوصفات للتحقق من التكلفة</a></div>`;
}

export async function renderRecipeImportV028(root){
 root.innerHTML=`<div class="page-head"><div><h2>استيراد الوصفات ومزامنة تكلفة المواد — v0.28</h2>
 <p>أعد رفع ملف الوصفات حتى لو استُخدم سابقًا: تتطابق المكونات مع مواد Supabase الحالية، وتُحدّث الاختلافات فقط.</p></div>
 <a class="btn secondary" href="./templates/Maria-CFO-75-Recipes-v0.27-Ready.xlsx" download>تنزيل ملف الوصفات المعالج</a></div>
 <div class="card"><div class="field"><label for="recipe-v028-file">ملف Excel للوصفات الـ75</label>
 <input type="file" id="recipe-v028-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
 <div class="quick-actions"><button class="btn" id="recipe-v028-preview" type="button">معاينة وفحص المواد والأسعار</button></div>
 <div class="notice">السعر يُقرأ من <strong>جدول المواد الحالي</strong>، وليس من ملف الوصفات. لا يؤدي إعادة الاستيراد إلى تصفير الأسعار أو تعديل أرصدة المخزون، وأي مادة بلا سعر معروف ستظهر بوضوح.</div></div>
 <div id="recipe-v028-preview-area" aria-live="polite"></div>
 <div class="card"><h3>سجل عمليات استيراد v0.28</h3><div id="recipe-v028-history">${loader()}</div></div>`;
 const input=root.querySelector('#recipe-v028-file'),button=root.querySelector('#recipe-v028-preview');
 const host=root.querySelector('#recipe-v028-preview-area');
 async function refreshHistory(){
  const area=root.querySelector('#recipe-v028-history');
  try{
    const items=await api.rpc('recipe_import_history_v028');
    area.innerHTML=Array.isArray(items)&&items.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>التاريخ</th><th>الوجبات</th><th>بنود مضافة</th><th>بنود معدّلة</th><th>مواد بلا سعر</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(String(item.imported_at||'').slice(0,16).replace('T',' '))}</td><td>${esc(item.recipe_count)}</td><td>${esc(item.summary?.linesInserted??0)}</td><td>${esc(item.summary?.linesUpdated??0)}</td><td>${esc(item.summary?.missingPriceMaterials??'—')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p>لم تسجل عمليات v0.28 بعد.</p>';
  }catch(e){area.innerHTML=`<div class="notice rose">${migrationNotice}</div>`;}
 }
 await refreshHistory();
 button.onclick=async()=>{
  const file=input.files?.[0];if(!file){toast('اختر ملف الوصفات أولًا.','error');return;}
  button.disabled=true;host.innerHTML=loader();
  try{
   const workbook=await readAmeenWorkbook(file);
   const parsed=parseRecipesV027(workbook);
   const check=await fetchCatalogAndCoverage(parsed);
   const hash=await sha256Hex(workbook.buffer);
   const errors=[...check.unexpected.map(x=>'مادة غير موجودة: '+x),...check.unitMismatch];
   const matchedMenu=new Set(parsed.recipes.filter(r=>!check.missingMenu.includes(r.menuName)).map(r=>normalize(r.menuName)));
   const uniqueMenu=check.menu.filter(r=>check.menuNames.get(normalize(r.name))===1 && !matchedMenu.has(normalize(r.name)));
   const mapping=check.missingMenu.length?`<div class="notice"><strong>أسماء الوجبات التالية تختلف عن أسماء القاعدة. اربط كل وصفة بوجبة صحيحة موجودة:</strong>
    ${check.missingMenu.map((name,i)=>`<div class="field"><label for="recipe-v028-map-${i}">${esc(name)}</label>
    <select id="recipe-v028-map-${i}" data-recipe-name="${esc(name)}" class="recipe-v028-menu-map"><option value="">— اختر —</option>${uniqueMenu.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>`).join('')}</div>`:'';
   const coverage=check.coverage;
   const incomplete=coverage.recipes.filter(r=>r.missingLines).sort((a,b)=>b.missingLines-a.missingLines);
   host.innerHTML=`<div class="card"><div class="grid cols-3 finance-summary-grid">
     <div class="card"><strong>${parsed.recipes.length}</strong><p>وصفة ستُراجع وتُحدّث</p></div>
     <div class="card"><strong>${parsed.lines.length}</strong><p>سطر مكوّن من ملف Excel</p></div>
     <div class="card"><strong>${coverage.pricedLines}</strong><p>بنود بسعر معروف من جدول المواد</p></div>
     <div class="card"><strong>${coverage.missingLines}</strong><p>بنود سعرها مجهول حاليًا</p></div>
     <div class="card"><strong>${coverage.fullyPricedRecipes}</strong><p>وصفات مكتملة التكلفة حاليًا</p></div>
     <div class="card"><strong>${check.missingStock.length}</strong><p>مواد غير موجودة ستُنشأ بلا سعر</p></div>
   </div>
   ${mapping}
   ${check.unitAliases.length?`<div class="notice green">تم قبول مسميات وحدات متكافئة، دون تغيير الكميات: ${esc(check.unitAliases.slice(0,12).join(' · '))}</div>`:''}
   ${errors.length?`<div class="notice rose"><strong>هذه الاختلافات تمنع الحفظ:</strong><ul>${errors.slice(0,25).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
   ${coverage.missingNames.length?`<div class="notice"><strong>المواد التالية لا تملك سعرًا معروفًا داخل جدول المواد، لذلك لن تظهر تكلفة كاملة للوصفات التي تستخدمها:</strong>
    <p>${coverage.missingNames.slice(0,25).map(esc).join(' · ')}${coverage.missingNames.length>25?` · و${coverage.missingNames.length-25} مادة أخرى`:''}</p></div>`:''}
   ${incomplete.length?`<details><summary>عرض الوصفات ذات التكلفة غير المكتملة (${incomplete.length})</summary>
      <div class="table-wrap"><table class="table"><thead><tr><th>الوجبة</th><th>مكونات ناقصة السعر</th><th>المجموع المعروف فقط (SYP)</th></tr></thead><tbody>${incomplete.slice(0,75).map(r=>`<tr><td>${esc(r.name)}</td><td>${r.missingLines}</td><td>${money(r.knownSubtotal)}</td></tr>`).join('')}</tbody></table></div></details>`:''}
   <label class="recipe-confirm-check"><input type="checkbox" id="recipe-v028-replace"> أوافق على تحديث مكونات الوصفات الموجودة لتطابق الملف، بعد حفظ نسخة احتياطية لكل عملية. لا تعديل لأسعار المواد.</label>
   <button class="btn" id="recipe-v028-commit" type="button" ${errors.length?'disabled':''}>مطابقة وتحديث الـ75 وصفة من جديد</button>
   <p class="metric-note">يمكن إعادة رفع الملف نفسه. إذا لم تتغير مكونات الوصفة فلن يعيد النظام إنشاء سطورها؛ تتحدث التكلفة تلقائيًا عند تعديل سعر المادة.</p></div>`;
   const commit=host.querySelector('#recipe-v028-commit');
   const selectors=[...host.querySelectorAll('.recipe-v028-menu-map')];
   function validate(){
    const selected=selectors.map(s=>s.value);
    const valid=selected.every(Boolean)&&new Set(selected).size===selected.length;
    commit.disabled=Boolean(errors.length)||!valid;
    return valid;
   }
   selectors.forEach(s=>s.addEventListener('change',validate));validate();
   commit.onclick=async()=>{
    if(!validate()){toast('اختر لكل وصفة وجبتها المطابقة.','error');return;}
    if(!host.querySelector('#recipe-v028-replace').checked){toast('يرجى الموافقة على تحديث المكونات بعد النسخ الاحتياطي.','error');return;}
    const chosen=new Map(selectors.map(s=>[s.dataset.recipeName,uniqueMenu.find(r=>String(r.id)===String(s.value))?.name]));
    if([...chosen.values()].some(x=>!x)){toast('الوجبة المختارة غير موجودة.','error');return;}
    const resolved=parsed.recipes.map(r=>({...r,menuName:chosen.get(r.menuName)||r.menuName}));
    if(new Set(resolved.map(r=>normalize(r.menuName))).size!==resolved.length){toast('لا يمكن ربط وصفتين بالوجبة نفسها.','error');return;}
    commit.disabled=true;const unblock=installBlock();
    try{
      const result=await api.rpc('import_menu_recipes_v028',{
        p_sha256:hash,p_recipes:resolved,p_lines:check.canonicalLines,p_replace_existing:true,
      });
      host.innerHTML=showImportResult(result);
      toast('تم تحديث الوصفات. راجع عدد المواد ذات السعر المعروف في النتيجة.','success');
      await refreshHistory();
    }catch(e){
      const message=String(e?.message||'');
      const missingRpc=/import_menu_recipes_v028|PGRST202|42883|not found|schema cache/i.test(message);
      toast(missingRpc?migrationNotice:friendlyError(e),'error');
      host.insertAdjacentHTML('beforeend',`<div class="notice rose">${esc(missingRpc?migrationNotice:message)}</div>`);
    }finally{unblock();if(document.body.contains(commit))commit.disabled=false;}
   };
  }catch(e){host.innerHTML=`<div class="notice rose">${esc(e?.message||'تعذر قراءة ملف الوصفات.')}</div>`;}
  finally{button.disabled=false;}
 };
}
