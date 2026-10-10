import * as api from '../api.js?v=0.27';
import { modal, toast, loader, friendlyError, confirmBox } from '../ui.js?v=0.27';
import { esc, money, unitDisplay, num } from '../utils.js?v=0.27';
import { materialUnitChoices, openConversionDialog } from '../material-units.js?v=0.27';
import {PAGE_SIZES,pageInfo} from '../table-presenter-v025.js?v=0.27';
import {downloadXlsx,exportDatasetPdf} from '../table-export-v027.js?v=0.27';

function menuPrice(row){
  return row.manual_price_original ?? row.manual_price ?? row.price ?? row.suggested_price_rounded ?? row.suggested_price ?? null;
}

function menuFoodCost(row){
  return row.target_food_cost_percent ?? row.food_cost_target_percent ?? null;
}

function menuDiscount(row){
  return num(row.default_discount_percent,0);
}

function effectiveSalePrice(row){
  const price=Number(menuPrice(row));
  if(!Number.isFinite(price)) return null;
  const discount=Math.max(0,Math.min(100,menuDiscount(row)));
  return price*(1-discount/100);
}

function displayedFoodCost(row){
  // Number(null) === 0 must NEVER turn an unknown recipe cost into "0.0%".
  if(row.recipe_cost_base==null || row.recipe_cost_base===''
      || Number(row.missing_cost_count)>0 || row.has_missing_cost===true)return null;
  const recipe=Number(row.recipe_cost_base);
  const effective=effectiveSalePrice(row);
  if(Number.isFinite(recipe) && Number.isFinite(effective) && effective>0){
    return recipe/effective*100;
  }
  const raw=row.actual_food_cost_percent??row.food_cost_percent;
  if(raw==null || raw==='')return null;
  const fallback=Number(raw);
  return Number.isFinite(fallback)?fallback:null;
}

function materialBaseCost(row){
  const value=row?.latest_purchase_unit_cost_base ??
    row?.last_purchase_unit_cost_base ??
    row?.current_unit_cost_base ?? null;
  if(value===null || value===undefined || value==='') return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}

export async function renderMenu(root){
 root.innerHTML=loader();
 try{
  const categories=await api.menuCategoriesV023();
  const categoryMap=new Map(categories.map(c=>[String(c.id),c.name]));
  const state={page:1,categoryId:'',query:'',sequence:0};
  root.innerHTML=`
    <div class="page-head"><div>
      <h2>الوجبات والوصفات</h2>
      <p>استعرض الوجبات صفحة بصفحة، وابحث عنها بالاسم أو التصنيف؛ تكلفة الطعام تُحسب من الوصفة.</p>
    </div><div class="page-head-actions"><a class="btn secondary" href="#/recipes-import">استيراد الوصفات</a><button class="btn add">إضافة وجبة</button></div></div>
    <div class="list-toolbar">
      <div class="search-box"><span aria-hidden="true">⌕</span><input type="search" id="menu-search" placeholder="ابحث عن وجبة" autocomplete="off"></div>
      <select id="menu-category-filter"><option value="">كل التصنيفات</option>${categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
      <span class="list-count" id="menu-count"></span>
      <button class="mini-btn" type="button" id="menu-export-excel">⇩ Excel</button>
      <button class="mini-btn" type="button" id="menu-export-pdf">⇩ PDF</button>
    </div>
    <div id="menu-results" aria-live="polite"></div>`;
  root.querySelector('.add').onclick=()=>addMenu(root,categories);
  const host=root.querySelector('#menu-results');
  const draw=async()=>{
   const call=++state.sequence;
   host.innerHTML=loader();
   try{
    let response=await api.menuItemsPageV025({page:state.page,pageSize:PAGE_SIZES.menu,
      categoryId:state.categoryId,query:state.query});
    if(call!==state.sequence)return;
    let meta=pageInfo(response.total,state.page,PAGE_SIZES.menu);
    if(state.page!==meta.page){
      state.page=meta.page;
      response=await api.menuItemsPageV025({page:state.page,pageSize:PAGE_SIZES.menu,
        categoryId:state.categoryId,query:state.query});
      if(call!==state.sequence)return;
      meta=pageInfo(response.total,state.page,PAGE_SIZES.menu);
    }
    const rows=response.rows;
    root.querySelector('#menu-count').textContent=`${meta.total} وجبة`;
    host.innerHTML=`${rows.length?`<div id="menu-listing" class="grid cols-3">
       ${rows.map(r=>`<div class="card section-card menu-card">
        <span class="tag menu-category-name">${esc(categoryMap.get(String(r.category_id))|| (r.has_missing_cost?'تكلفة ناقصة':'وجبة'))}</span>
        <h3>${esc(r.name)}</h3>
        <div class="menu-summary">
          <div><span>${menuDiscount(r)>0?'سعر البيع قبل الخصم':'سعر البيع'}</span><strong>${menuPrice(r)!=null?money(menuPrice(r)):'—'}</strong></div>
          ${menuDiscount(r)>0?`<div class="menu-net-price"><span>سعر البيع بعد الخصم</span><strong>${money(effectiveSalePrice(r))}</strong></div>`:''}
          <div><span>تكلفة الوصفة</span><strong>${r.recipe_cost_base!=null && Number(r.missing_cost_count||0)===0?money(r.recipe_cost_base):'غير محسوبة'}</strong></div>
          <div><span>Food Cost</span><strong>${displayedFoodCost(r)!=null?`${displayedFoodCost(r).toFixed(1)}%`:'—'}</strong></div>
          <div><span>خصم افتراضي</span><strong>${menuDiscount(r)>0?`${menuDiscount(r)}%`:'—'}</strong></div>
          <div><span>وحدة البيع من الأمين</span><strong>${esc(r.ameen_sale_unit_v024||'—')}</strong></div>
        </div>
        <div class="menu-card-actions">
          <button class="btn secondary recipe" data-id="${esc(r.id)}">إدارة الوصفة</button>
          <button class="btn soft edit-menu" data-id="${esc(r.id)}">تعديل الوجبة</button>
        </div>
       </div>`).join('')}</div>`:
       '<div class="card empty"><strong>لا توجد وجبات مطابقة</strong><div>غيّر البحث أو التصنيف، أو أضف وجبة.</div></div>'}
       ${meta.pages>1?`<div class="pagination-bar">
        <button class="mini-btn page-prev" ${meta.page<=1?'disabled':''}>السابق</button>
        <span>${meta.from}–${meta.to} من ${meta.total} · صفحة ${meta.page} من ${meta.pages}</span>
        <button class="mini-btn page-next" ${meta.page>=meta.pages?'disabled':''}>التالي</button>
       </div>`:''}`;
    host.querySelectorAll('.recipe').forEach(b=>b.onclick=async()=>{
      const r=rows.find(x=>String(x.id)===b.dataset.id);
      if(!r)return;
      try{
       b.disabled=true;
       const [mats,units]=await Promise.all([api.materials(),api.units()]);
       await recipeDialog(root,r.id,r.name,mats,units);
      }catch(e){toast(friendlyError(e),'error');}
      finally{b.disabled=false;}
    });
    host.querySelectorAll('.edit-menu').forEach(b=>{
      const r=rows.find(x=>String(x.id)===b.dataset.id);
      if(r)b.onclick=()=>editMenu(root,r,categories);
    });
    host.querySelector('.page-prev')?.addEventListener('click',()=>{state.page=Math.max(1,state.page-1);draw();});
    host.querySelector('.page-next')?.addEventListener('click',()=>{state.page=Math.min(meta.pages,state.page+1);draw();});
   }catch(e){if(call===state.sequence)host.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
  };
  let delay;
  root.querySelector('#menu-search').addEventListener('input',e=>{
    state.query=e.target.value.trim();state.page=1;clearTimeout(delay);delay=setTimeout(draw,240);
  });
  root.querySelector('#menu-category-filter').onchange=e=>{state.categoryId=e.target.value;state.page=1;draw();};
  const filteredMenuDataset=async()=>{
    const all=[];let page=1,total=Infinity;
    const snapshot={categoryId:state.categoryId,query:state.query};
    while(all.length<total){
      const result=await api.menuItemsPageV025({page,pageSize:100,...snapshot});
      total=result.total;all.push(...result.rows);
      if(!result.rows.length)break;page++;
      if(page>10000)throw Error('MENU_EXPORT_LIMIT');
    }
    return {title:'الوجبات - حسب البحث والتصنيف',
      headers:['اسم الوجبة','التصنيف','سعر البيع','تكلفة الوصفة','Food Cost %','الخصم الافتراضي %','وحدة البيع'],
      rows:all.map(r=>[r.name,categoryMap.get(String(r.category_id))||'',menuPrice(r)??'',r.recipe_cost_base??'',displayedFoodCost(r)??'',menuDiscount(r),r.ameen_sale_unit_v024||''])};
  };
  root.querySelector('#menu-export-excel').onclick=async e=>{
    const btn=e.currentTarget;btn.disabled=true;
    try{const dataset=await filteredMenuDataset();downloadXlsx('Maria-CFO-Menu-Filtered-v027.xlsx',dataset.headers,dataset.rows,'Menu');}
    catch(err){toast(friendlyError(err),'error');}finally{btn.disabled=false;}
  };
  root.querySelector('#menu-export-pdf').onclick=()=>exportDatasetPdf(filteredMenuDataset);
  await draw();
 }catch(e){root.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
}

function menuFormBody(row={},categories=[]){
  return `
    <div class="form-grid">
      <div class="field full">
        <label>اسم الوجبة</label>
        <input name="name" value="${esc(row.name||'')}" required autocomplete="off">
      </div>
      <div class="field"><label>التصنيف</label><select name="category"><option value="">بلا تصنيف</option>${categories.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(row.category_id||'')?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field">
        <label>سعر البيع <span class="optional-badge">اختياري</span></label>
        <input name="price" type="number" min="0" step="any" value="${menuPrice(row)==null?'':esc(menuPrice(row))}" autocomplete="off">
      </div>
      <div class="field">
        <label>Food Cost خاص % <span class="optional-badge">اختياري</span></label>
        <input name="fc" type="number" min="0" max="100" step="any" value="${menuFoodCost(row)==null?'':esc(menuFoodCost(row))}" autocomplete="off">
      </div>
      <div class="field">
        <label>خصم افتراضي عند البيع % <span class="optional-badge">اختياري</span></label>
        <input name="discount" type="number" min="0" max="100" step="any" value="${menuDiscount(row)||''}" autocomplete="off">
      </div>
    </div>`;
}

function addMenu(root,categories=[]){
  modal({
    title:'إضافة وجبة',
    body:menuFormBody({},categories),
    onSubmit:async fd=>{
      try{
        const name=String(fd.get('name')||'').trim();
        if(!name){toast('اكتب اسم الوجبة.','error');return false;}
        await api.createMenuItem({
          name,
          price:String(fd.get('price')||'').trim()||null,
          foodCost:String(fd.get('fc')||'').trim()||null,
          discount:String(fd.get('discount')||'').trim()||0,
          categoryId:fd.get('category')||null,
        });
        toast('تمت إضافة الوجبة','success');
        await renderMenu(root);
        return true;
      }catch(e){
        toast(friendlyError(e,'تعذر حفظ الوجبة. تأكد من تشغيل تحديث قاعدة البيانات v0.7.'),'error');
        return false;
      }
    },
  });
}

function editMenu(root,row,categories=[]){
  modal({
    title:`تعديل ${row.name||'الوجبة'}`,
    body:menuFormBody(row,categories),
    submitText:'حفظ التعديل',
    onSubmit:async fd=>{
      try{
        const name=String(fd.get('name')||'').trim();
        if(!name){toast('اسم الوجبة لا يمكن أن يكون فارغًا.','error');return false;}
        await api.updateMenuItem(row.id,{
          name,
          price:String(fd.get('price')||'').trim()||null,
          foodCost:String(fd.get('fc')||'').trim()||null,
          discount:String(fd.get('discount')||'').trim()||0,
          categoryId:fd.get('category')||null,
        });
        toast('تم تحديث الوجبة.','success');
        await renderMenu(root);
        return true;
      }catch(e){
        toast(friendlyError(e,'تعذر تعديل الوجبة.'),'error');
        return false;
      }
    },
  });
}

async function recipeDialog(root,id,name,mats,units){
  try{
    const mm=Object.fromEntries(mats.map(x=>[String(x.id),x]));
    const um=Object.fromEntries(units.map(x=>[String(x.id),x]));
    let rows=[];

    const rowUnitLabel=(x)=>{
      const material=mm[String(x.material_id)];
      const unit=um[String(x.input_unit_id||x.unit_id)];
      if(unit) return unitDisplay(unit);
      const base=um[String(material?.base_unit_id)];
      return unitDisplay(base) || material?.base_unit_code || '—';
    };

    const enrichRows=async(source)=>Promise.all(source.map(async x=>{
      const material=mm[String(x.material_id)];
      if(!material) return {...x,__unitCost:null,__lineCost:null};
      const inputUnitId=String(x.input_unit_id||x.unit_id||material.base_unit_id||'');
      const inputQty=Number(x.input_quantity??x.quantity_original??x.quantity??x.quantity_base??0);
      let factor=String(inputUnitId)===String(material.base_unit_id)?1:NaN;
      if(!Number.isFinite(factor)){
        try{
          const choices=await materialUnitChoices(material,units);
          const choice=choices.find(c=>String(c.unitId)===inputUnitId);
          if(choice && Number(choice.quantityInBase)>0) factor=Number(choice.quantityInBase);
        }catch(_){ /* Unknown conversion must not be treated as factor=1. */ }
      }
      // Use the saved base-unit quantity to price ingredients. It is the same
      // source of truth as the database's menu_item_costs view.
      const storedBase=Number(x.quantity_base);
      const baseQty=x.quantity_base!=null && Number.isFinite(storedBase)&&storedBase>0
        ? storedBase : (Number.isFinite(factor)&&inputQty>0?factor*inputQty:null);
      if(!Number.isFinite(factor)&&baseQty!=null&&inputQty>0)factor=baseQty/inputQty;
      const baseCost=materialBaseCost(material);
      const unitCost=baseCost!=null && Number.isFinite(factor)?baseCost*factor:null;
      const lineCost=baseCost!=null && baseQty!=null?baseCost*baseQty:null;
      return {...x,__unitCost:unitCost,__lineCost:lineCost,__factor:factor};
    }));

    const m=modal({
      title:`وصفة: ${name}`,
      subtitle:'أضف كمية كل مادة المستخدمة في وجبة واحدة.',
      wide:true,
      hideActions:true,
      onClose:async()=>{
        await renderMenu(root);
      },
      body:`
        <div class="recipe-topbar">
          <button type="button" class="btn open-recipe-entry">＋ إضافة مكوّن</button>
          <span>المكونات المحفوظة تظهر أدناه، وتُحسب تكلفتها من أسعار المواد والتحويلات.</span>
        </div>

        <div class="recipe-entry-panel" hidden>
          <div class="recipe-entry-row">
            <div class="field">
              <label>المادة</label>
              <select name="material">
                <option value="">اختر مادة جديدة</option>
              </select>
            </div>
            <div class="field">
              <label>الوحدة</label>
              <div class="select-action-row">
                <select name="unit" disabled>
                  <option value="">اختر المادة أولًا</option>
                </select>
                <button type="button" class="conversion-btn add-conversion" disabled><span aria-hidden="true">⇄</span> تحويل وحدة</button>
              </div>
            </div>
            <div class="field">
              <label>الكمية</label>
              <input name="qty" type="number" step="any" min="0.00000001" autocomplete="off" disabled>
            </div>
          </div>
          <div class="recipe-entry-actions">
            <button type="button" class="btn add-component-now">إضافة المكوّن</button>
            <button type="button" class="btn secondary cancel-component">إلغاء</button>
          </div>
        </div>

        <div class="recipe-items-host"></div>

        <div class="recipe-dialog-footer">
          <div class="recipe-total" data-recipe-total></div>
          <button type="button" class="btn save-recipe-close">حفظ الوصفة وإغلاق</button>
        </div>`,
    });

    const host=m.form.querySelector('.recipe-items-host');
    const entryPanel=m.form.querySelector('.recipe-entry-panel');
    const openEntryBtn=m.form.querySelector('.open-recipe-entry');
    const materialSel=m.form.querySelector('[name="material"]');
    const unitSel=m.form.querySelector('[name="unit"]');
    const qtyInput=m.form.querySelector('[name="qty"]');
    const conversionBtn=m.form.querySelector('.add-conversion');
    const addComponentBtn=m.form.querySelector('.add-component-now');
    const cancelComponentBtn=m.form.querySelector('.cancel-component');
    const totalBox=m.form.querySelector('[data-recipe-total]');

    const setEntryEnabled=(enabled)=>{
      unitSel.disabled=!enabled;
      qtyInput.disabled=!enabled;
      conversionBtn.disabled=!enabled;
      addComponentBtn.disabled=!enabled;
      if(!enabled){
        unitSel.innerHTML='<option value="">اختر المادة أولًا</option>';
        qtyInput.value='';
      }
    };

    const populateUnits=async(preferred=null)=>{
      const material=mm[String(materialSel.value)];
      if(!material){
        setEntryEnabled(false);
        return;
      }
      setEntryEnabled(true);
      await api.ensureStandardMaterialUnits(material,units).catch(()=>null);
      const choices=await materialUnitChoices(material,units);
      unitSel.innerHTML=choices.length
        ? choices.map(x=>`<option value="${esc(x.unitId)}">${esc(x.label)}</option>`).join('')
        : '<option value="">لا توجد وحدة مرتبطة</option>';
      if(preferred && choices.some(x=>String(x.unitId)===String(preferred))) unitSel.value=preferred;
    };

    const populateMaterials=()=>{
      const used=new Set(rows.map(x=>String(x.material_id)));
      const available=mats.filter(x=>!used.has(String(x.id)));
      materialSel.innerHTML=`<option value="">اختر مادة جديدة</option>${available.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}`;
      materialSel.disabled=available.length===0;
      openEntryBtn.disabled=available.length===0;
      if(available.length===0){
        materialSel.innerHTML='<option value="">كل المواد المتاحة موجودة في الوصفة</option>';
        entryPanel.hidden=true;
      }
      setEntryEnabled(false);
    };

    const renderRows=()=>{
      const knownCost=rows.reduce((sum,x)=>sum+(Number.isFinite(Number(x.__lineCost))?Number(x.__lineCost):0),0);
      const missingCost=rows.some(x=>x.__lineCost==null || !Number.isFinite(Number(x.__lineCost)));
      totalBox.innerHTML=rows.length
        ? `<strong>${missingCost?'المجموع المعروف فقط':'تكلفة الوصفة الحالية'}: ${money(knownCost)}</strong>${missingCost?'<span> • التكلفة الكاملة غير محسوبة لوجود مادة بلا سعر معروف</span>':''}`
        : '<span>لم تُضف مكونات بعد.</span>';

      host.innerHTML=rows.length?`
        <div class="table-wrap table-fit recipe-table-wrap">
          <table class="table compact-table recipe-table">
            <thead><tr><th>المادة</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>تكلفة المكوّن</th><th>إجراء</th></tr></thead>
            <tbody>
              ${rows.map(x=>`
                <tr>
                  <td><strong>${esc(mm[String(x.material_id)]?.name||'مادة')}</strong></td>
                  <td>${esc(x.input_quantity??x.quantity_original??x.quantity??x.quantity_base??'—')}</td>
                  <td>${esc(rowUnitLabel(x))}</td>
                  <td>${x.__unitCost!=null?`${money(x.__unitCost)} / ${esc(rowUnitLabel(x))}`:'—'}</td>
                  <td><strong>${x.__lineCost!=null?money(x.__lineCost):'—'}</strong></td>
                  <td>
                    <div class="material-actions">
                      <button type="button" class="mini-btn edit-recipe-item" data-id="${esc(x.id)}">تعديل</button>
                      <button type="button" class="mini-btn danger-lite delete-recipe-item" data-id="${esc(x.id)}">حذف</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`:
        '<div class="notice">لا توجد مكونات بعد. اضغط «إضافة مكوّن» من الأعلى.</div>';

      host.querySelectorAll('.edit-recipe-item').forEach(btn=>{
        const row=rows.find(x=>String(x.id)===String(btn.dataset.id));
        if(row) btn.onclick=()=>editRecipeItem({
          row,
          material:mm[String(row.material_id)],
          units,
          onSaved:refreshRecipe,
        });
      });

      host.querySelectorAll('.delete-recipe-item').forEach(btn=>{
        const row=rows.find(x=>String(x.id)===String(btn.dataset.id));
        if(!row) return;
        btn.onclick=async()=>{
          if(!(await confirmBox('حذف هذا المكوّن من الوصفة؟','حذف'))) return;
          try{
            await api.deleteRecipeItem(row.id);
            toast('تم حذف المكوّن.','success');
            await refreshRecipe();
          }catch(e){
            toast(friendlyError(e,'تعذر حذف المكوّن.'),'error');
          }
        };
      });
    };

    async function refreshRecipe(){
      const fresh=await api.recipeItems(id);
      rows=await enrichRows(fresh);
      renderRows();
      populateMaterials();
      qtyInput.value='';
    }

    const closeEntry=()=>{
      entryPanel.hidden=true;
      materialSel.value='';
      setEntryEnabled(false);
    };

    openEntryBtn.onclick=()=>{
      populateMaterials();
      entryPanel.hidden=false;
      materialSel.focus();
    };
    cancelComponentBtn.onclick=closeEntry;
    materialSel.addEventListener('change',()=>populateUnits());

    conversionBtn.onclick=async()=>{
      const material=mm[String(materialSel.value)];
      if(!material) return;
      await openConversionDialog({
        material,
        units,
        referenceUnitId:unitSel.value || material.base_unit_id,
        onSaved:async newUnitId=>{
          await populateUnits(newUnitId);
        },
      });
    };

    addComponentBtn.onclick=async()=>{
      try{
        const materialId=String(materialSel.value||'').trim();
        const unitId=String(unitSel.value||'').trim();
        const quantity=Number(qtyInput.value);
        if(!materialId){toast('اختر مادة لإضافتها.','error');return;}
        if(!unitId){toast('اختر الوحدة.','error');return;}
        if(!(quantity>0)){toast('اكتب كمية أكبر من صفر.','error');return;}
        addComponentBtn.disabled=true;
        await api.addRecipeItem({menuItemId:id,materialId,unitId,quantity});
        toast('تمت إضافة المكوّن إلى الوصفة.','success');
        await refreshRecipe();
        closeEntry();
      }catch(e){
        toast(friendlyError(e,'تعذر حفظ المكوّن.'),'error');
      }finally{
        if(document.body.contains(addComponentBtn)) addComponentBtn.disabled=false;
      }
    };

    m.form.querySelector('.save-recipe-close').onclick=()=>m.close();
    await refreshRecipe();
  }catch(e){
    toast(friendlyError(e,'تعذر فتح الوصفة.'),'error');
  }
}

async function editRecipeItem({row,material,units,onSaved}){
  if(!material) return;
  await api.ensureStandardMaterialUnits(material,units).catch(()=>null);
  const choices=await materialUnitChoices(material,units);
  const currentUnit=String(row.input_unit_id||row.unit_id||material.base_unit_id||'');
  const currentQty=row.input_quantity??row.quantity_original??row.quantity??row.quantity_base??'';

  const m=modal({
    title:`تعديل ${material.name}`,
    body:`
      <div class="form-grid">
        <div class="field">
          <label>الوحدة</label>
          <div class="select-action-row">
            <select name="unit" required>
              ${choices.map(x=>`<option value="${esc(x.unitId)}" ${String(x.unitId)===currentUnit?'selected':''}>${esc(x.label)}</option>`).join('')}
            </select>
            <button type="button" class="conversion-btn add-conversion"><span aria-hidden="true">⇄</span> تحويل وحدة</button>
          </div>
        </div>
        <div class="field">
          <label>الكمية</label>
          <input name="qty" type="number" min="0.00000001" step="any" value="${esc(currentQty)}" required autocomplete="off">
        </div>
      </div>`,
    submitText:'حفظ التعديل',
    onSubmit:async fd=>{
      try{
        await api.updateRecipeItem(row.id,{unitId:fd.get('unit'),quantity:fd.get('qty')});
        toast('تم تعديل المكوّن.','success');
        m.close();
        await onSaved();
        return false;
      }catch(e){
        toast(friendlyError(e,'تعذر تعديل المكوّن.'),'error');
        return false;
      }
    },
  });

  const unitSel=m.form.querySelector('[name="unit"]');
  m.form.querySelector('.add-conversion').onclick=()=>openConversionDialog({
    material,
    units,
    referenceUnitId:unitSel.value || material.base_unit_id,
    onSaved:async newUnitId=>{
      const updated=await materialUnitChoices(material,units);
      unitSel.innerHTML=updated.map(x=>`<option value="${esc(x.unitId)}">${esc(x.label)}</option>`).join('');
      unitSel.value=newUnitId;
    },
  });
}
