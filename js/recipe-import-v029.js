// Maria CFO Web v0.29 — strict, selective recipe import. No guessing, no zero costs.
import * as api from './api.js?v=0.27';
import {esc,money} from './utils.js?v=0.27';
import {toast,loader,friendlyError} from './ui.js?v=0.27';
import {readAmeenWorkbook,sha256Hex} from './ameen-import-parser.js?v=0.27';
import {parseRecipesV029} from './recipe-import-parser-v029.js?v=0.29';
import {alignRecipeLinesToCatalog,catalogUnitEquivalent} from './recipe-unit-match-v0272.js?v=0.28';
import {positive,catalogKey,liveMaterialCosts,recipeEligibility} from './import-policy-v029.js?v=0.29';

const normalize=v=>String(v??'').trim().toLocaleLowerCase('ar').replace(/\s+/g,' ');
const notice='شغّل تحديث قاعدة البيانات v0.29 FINAL بعد تحديث v0.29 الأساسي في Supabase قبل استيراد الوصفات.';
function blocker(){
 const el=document.createElement('div');el.className='ameen-import-blocker';el.setAttribute('role','alertdialog');
 el.setAttribute('aria-modal','true');el.innerHTML='<div class="ameen-block-card"><div class="loader"></div><h3>جار استيراد الوصفات المؤهلة فقط…</h3></div>';
 document.body.append(el);document.querySelector('#app')?.setAttribute('inert','');
 return ()=>{el.remove();document.querySelector('#app')?.removeAttribute('inert');};
}
const box=(value,label)=>`<div class="card"><strong>${value}</strong><p>${esc(label)}</p></div>`;
async function history(root){
 const area=root.querySelector('#recipe-v029-history');if(!area)return;
 try{const rows=await api.rpc('recipe_import_history_v028');
  area.innerHTML=rows?.length?`<div class="table-wrap"><table class="table"><thead><tr><th>التاريخ</th><th>الوصفات</th><th>البنود</th><th>المكونات المعدلة</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(String(r.imported_at||'').slice(0,16).replace('T',' '))}</td><td>${esc(r.recipe_count)}</td><td>${esc(r.material_line_count)}</td><td>${esc(r.summary?.linesUpdated??'—')}</td></tr>`).join('')}</tbody></table></div>`:'<p>لا توجد عمليات استيراد حديثة.</p>';
 }catch(e){area.innerHTML=`<div class="notice rose">${esc(friendlyError(e))}</div>`;}
}
function calculate(parsed,menus,materials,units,warehouses,chosen=new Map()){
 const byMenu=new Map();for(const m of menus)byMenu.set(normalize(m.name),[...(byMenu.get(normalize(m.name))||[]),m]);
 const byMaterial=liveMaterialCosts(materials),unitById=new Map(units.map(u=>[String(u.id),u]));
 const byKey=new Map(parsed.recipes.map(r=>[r.key,[]]));
 parsed.lines.forEach(l=>byKey.get(l.recipeKey)?.push(l));
 const outcomes=[];
 for(const recipe of parsed.recipes){
  const resolved=chosen.get(recipe.key)||recipe.menuName;
  const menuMatches=byMenu.get(normalize(resolved))||[];
  const menu=menuMatches.length===1?menuMatches[0]:null;
  const lines=byKey.get(recipe.key)||[];
  const issues=[];
  if(menuMatches.length!==1)issues.push('اسم الوجبة غير موجود أو مكرر في قاعدة البيانات');
  const basic=recipeEligibility(recipe,lines,menu,byMaterial,warehouses);
  issues.push(...basic.problems);
  for(const line of lines){
   const mats=byMaterial.get(catalogKey(line.materialName))||[];
   if(mats.length!==1)continue;
   const unit=unitById.get(String(mats[0].base_unit_id));
   if(!catalogUnitEquivalent(unit,line.baseUnit))issues.push(`${line.materialName}: وحدة الملف لا تطابق وحدة المخزون`);
  }
  outcomes.push({recipe:{...recipe,menuName:resolved},lines,menu,issues:[...new Set(issues)]});
 }
 const eligible=outcomes.filter(x=>x.issues.length===0);
 // Reusing a target menu for multiple recipes can overwrite a recipe unexpectedly.
 const seen=new Set();for(const x of eligible){
  if(seen.has(String(x.menu.id))){x.issues.push('الوجبة الهدف مستخدمة لوصفة أخرى');}
  seen.add(String(x.menu.id));
 }
 const allowed=eligible.filter(x=>x.issues.length===0);
 const chosenLines=allowed.flatMap(x=>x.lines);
 const aligned=alignRecipeLinesToCatalog(chosenLines,materials,units);
 return {outcomes,eligible:allowed,canonicalLines:aligned.canonicalLines,
   blocked:outcomes.filter(x=>x.issues.length>0),catalogProblems:[...aligned.unexpected,...aligned.unitMismatch]};
}
export async function renderRecipeImportV029(root){
 root.innerHTML=`<div class="page-head"><div><h2>استيراد الوصفات المكتملة التكلفة — v0.29</h2>
 <p>لن تُضاف إلا وصفة ذات سعر بيع موجب وجميع مكوناتها لها مستودع ورصيد موجب وسعر تكلفة موجب في Supabase.</p></div>
 <a class="btn secondary" href="./templates/Maria-CFO-Recipes-v0.29-Candidates-Live-DB.xlsx" download>تحميل ملف الفحص v0.29</a></div>
 <div class="card"><div class="field"><label for="recipe-v029-file">ملف الوصفات Excel (v0.27 أو v0.29)</label>
 <input id="recipe-v029-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
 <button class="btn" type="button" id="recipe-v029-preview">فحص الأسعار والمستودعات قبل الاستيراد</button>
 <div class="notice">المطبخ يُسعّر من فواتير حركة مادة التاريخية، وليس من أسعار الجرد الصفرية. إذا لم تكن مواد الوصفة مسعّرة في Supabase، تُستبعد الوصفة كاملة دون حذفها من Excel أو تخمين أسعارها.</div></div>
 <div id="recipe-v029-results" aria-live="polite"></div>
 <div class="card"><h3>سجل الاستيراد</h3><div id="recipe-v029-history">${loader()}</div></div>`;
 await history(root);
 const input=root.querySelector('#recipe-v029-file'),button=root.querySelector('#recipe-v029-preview'),host=root.querySelector('#recipe-v029-results');
 button.onclick=async()=>{
  const file=input.files?.[0];if(!file){toast('اختر ملف Excel أولًا','error');return;}
  button.disabled=true;host.innerHTML=loader();
  try{
   const wb=await readAmeenWorkbook(file),parsed=parseRecipesV029(wb),hash=await sha256Hex(wb.buffer);
   const [menus,materials,units,warehouses]=await Promise.all([
    api.catalogRows('menu_items','id,name,manual_price_original'),
    api.catalogRows('materials','id,name,base_unit_id,current_stock_base,last_purchase_unit_cost_base'),
    api.catalogRows('units','id,name,code,is_material_specific'),
    Promise.all([api.allAmeenInventoryV025(),api.rpc('ameen_kitchen_material_status_v029')]).then(([a,b])=>[...a,...b])
   ]);
   const known=new Set(menus.map(x=>normalize(x.name)));
   const usedExact=new Set(parsed.recipes.filter(r=>known.has(normalize(r.menuName))).map(r=>normalize(r.menuName)));
   const alternatives=menus.filter(m=>!usedExact.has(normalize(m.name))&&positive(m.manual_price_original))
     .sort((a,b)=>a.name.localeCompare(b.name,'ar'));
   const unmatched=parsed.recipes.filter(r=>!known.has(normalize(r.menuName)));
   host.innerHTML=`<div class="card"><h3>مطابقة الوجبات والأسعار</h3>
    ${unmatched.length?`<div class="notice"><strong>أسماء غير موجودة في المنيو. اختر اسمًا حقيقيًا من القائمة بعد البحث:</strong>
       ${unmatched.map((r,i)=>`<div class="field"><label>${esc(r.menuName)}</label><select data-recipe-key="${esc(r.key)}" class="recipe-map-v029"><option value="">اختر الوجبة الصحيحة</option>${alternatives.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></div>`).join('')}</div>`:''}
    <div id="recipe-v029-summary"></div></div>`;
   const summary=host.querySelector('#recipe-v029-summary');
   async function rerender(){
    const chosen=new Map();const sels=[...host.querySelectorAll('.recipe-map-v029')];
    const picked=new Set();let collision=false;
    for(const sel of sels){const name=menus.find(x=>String(x.id)===sel.value)?.name;
     if(name){if(picked.has(sel.value))collision=true;picked.add(sel.value);chosen.set(sel.dataset.recipeKey,name);}}
    const checks=calculate(parsed,menus,materials,units,warehouses,chosen);
    const forbidden=checks.catalogProblems.length||collision;
    summary.innerHTML=`<div class="grid cols-3 finance-summary-grid">
      ${box(parsed.recipes.length,'الوصفات في الملف')}${box(checks.eligible.length,'وصفات مؤهلة للاستيراد')}
      ${box(checks.blocked.length,'وصفات مستبعدة')}${box(checks.canonicalLines.length,'بنود مكونات مؤهلة')}
      ${box(materials.filter(x=>positive(x.last_purchase_unit_cost_base)&&positive(x.current_stock_base)).length,'مواد مسعّرة وبرصيد موجب')}
      ${box(warehouses.filter(x=>x.kind==='material'&&positive(x.quantity_base)).length,'سطور مخزون مستودعات موجبة')}
      </div>
      ${checks.blocked.length?`<details open><summary>عرض أسباب استبعاد الوصفات (${checks.blocked.length})</summary><div class="table-wrap"><table class="table"><thead><tr><th>الوجبة</th><th>الأسباب (أول 8)</th></tr></thead><tbody>${checks.blocked.map(x=>`<tr><td>${esc(x.recipe.menuName)}</td><td>${x.issues.slice(0,8).map(esc).join('؛ ')}${x.issues.length>8?`؛ و${x.issues.length-8} سبب آخر`:''}</td></tr>`).join('')}</tbody></table></div></details>`:''}
      ${forbidden?`<div class="notice rose">تعارض في المطابقة: ${esc(checks.catalogProblems.slice(0,7).join('؛ '))}${collision?'؛ تم اختيار الوجبة نفسها أكثر من مرة.':''}</div>`:''}
      ${checks.eligible.length?`<details><summary>عرض الوصفات التي ستُحفظ (${checks.eligible.length})</summary>
          <p>${checks.eligible.map(x=>esc(x.recipe.menuName)).join(' · ')}</p></details>`:
        '<div class="notice rose"><strong>لا توجد وصفة مكتملة الشروط.</strong> لا يمكن تنفيذ الاستيراد. أضف أسعار تكاليف المواد وأرصدة مستودعاتها أولًا ثم أعد الفحص.</div>'}
      <label class="recipe-confirm-check"><input type="checkbox" id="recipe-v029-confirm"> أؤكد استيراد الوصفات المؤهلة فقط وتحديث مكوناتها الموجودة مع حفظ نسخ احتياطية</label>
      <button type="button" class="btn" id="recipe-v029-commit" ${!checks.eligible.length||forbidden?'disabled':''}>استيراد ${checks.eligible.length} وصفة مؤهلة فقط</button>`;
    const commit=summary.querySelector('#recipe-v029-commit');
    commit.onclick=async()=>{
     if(!summary.querySelector('#recipe-v029-confirm').checked){toast('يرجى الموافقة قبل الحفظ','error');return;}
     commit.disabled=true;const unblock=blocker();
     try{
      const payload=checks.eligible.map(x=>x.recipe);
      const lines=checks.canonicalLines.map(l=>({...l,newMaterial:false}));
      const result=await api.rpc('import_menu_recipes_v029',{
       p_sha256:hash,p_recipes:payload,p_lines:lines,p_replace_existing:true});
      host.innerHTML=`<div class="card notice green"><h3>تم استيراد ${esc(result.recipesImported)} وصفة مكتملة الشروط</h3>
       <p>بنود مضافة: ${esc(result.linesInserted)} · بنود معدلة: ${esc(result.linesUpdated)} · لم تتغير: ${esc(result.linesUnchanged)}.</p>
       <p>لم تُنشأ مواد بلا أسعار، ولم تُعدَّل تكلفة أي مادة أو رصيد مالي أو مبيعات تاريخية.</p><a href="#/menu" class="btn secondary">فتح الوجبات</a></div>`;
      toast('تم حفظ الوصفات المؤهلة فقط.','success');await history(root);
     }catch(e){const msg=String(e?.message||'');const missing=/import_menu_recipes_v029|PGRST202|42883|not found|schema cache/i.test(msg);
       toast(missing?notice:friendlyError(e),'error');host.insertAdjacentHTML('beforeend',`<div class="notice rose">${esc(missing?notice:msg)}</div>`);
     }finally{unblock();if(commit.isConnected)commit.disabled=false;}
    };
   }
   host.querySelectorAll('.recipe-map-v029').forEach(sel=>sel.addEventListener('change',rerender));
   await rerender();
  }catch(e){host.innerHTML=`<div class="notice rose">${esc(e?.message||'تعذر قراءة الملف أو فحص الأسعار.')}</div>`;}
  finally{button.disabled=false;}
 };
}
