import * as api from '../api.js';
import { modal, toast, loader, friendlyError, confirmBox } from '../ui.js';
import { esc, money, unitDisplay, num } from '../utils.js';
import { materialUnitChoices, openConversionDialog } from '../material-units.js';

function menuPrice(row){
  return row.manual_price_original ?? row.manual_price ?? row.price ?? row.suggested_price_rounded ?? row.suggested_price ?? null;
}

function menuFoodCost(row){
  return row.target_food_cost_percent ?? row.food_cost_target_percent ?? null;
}

function menuDiscount(row){
  return num(row.default_discount_percent,0);
}

export async function renderMenu(root){
  root.innerHTML=loader();
  try{
    const [rows,mats,units]=await Promise.all([api.menuItems(),api.materials(),api.units()]);
    root.innerHTML=`
      <div class="page-head">
        <div>
          <h2>الوجبات والوصفات</h2>
          <p>أضف الوجبة وحدد سعرها ووصفاتها. تكلفة الطعام تُحسب من مكونات الوصفة وأسعار المواد.</p>
        </div>
        <button class="btn add">إضافة وجبة</button>
      </div>
      ${rows.length?`
        <div class="grid cols-3">
          ${rows.map(r=>`
            <div class="card section-card menu-card">
              <span class="tag">${r.has_missing_cost?'تكلفة ناقصة':'وجبة'}</span>
              <h3>${esc(r.name)}</h3>
              <div class="menu-summary">
                <div><span>سعر البيع</span><strong>${menuPrice(r)!=null?money(menuPrice(r)):'—'}</strong></div>
                <div><span>تكلفة الوصفة</span><strong>${r.recipe_cost_base!=null?money(r.recipe_cost_base):'—'}</strong></div>
                <div><span>Food Cost</span><strong>${r.actual_food_cost_percent??r.food_cost_percent??'—'}${(r.actual_food_cost_percent??r.food_cost_percent)!=null?'%':''}</strong></div>
                <div><span>خصم افتراضي</span><strong>${menuDiscount(r)>0?`${menuDiscount(r)}%`:'—'}</strong></div>
              </div>
              <div class="menu-card-actions">
                <button class="btn secondary recipe" data-id="${esc(r.id)}" data-name="${esc(r.name)}">إدارة الوصفة</button>
                <button class="btn soft edit-menu" data-id="${esc(r.id)}">تعديل الوجبة</button>
              </div>
            </div>`).join('')}
        </div>`:
        `<div class="card empty">
          <strong>أضف أول وجبة</strong>
          <div>بعد إضافة المواد، أنشئ الوجبة وحدد مكوناتها.</div>
          <br><button class="btn add">إضافة وجبة</button>
        </div>`}`;

    root.querySelectorAll('.add').forEach(b=>b.onclick=()=>addMenu(root));
    root.querySelectorAll('.recipe').forEach(b=>b.onclick=()=>recipeDialog(root,b.dataset.id,b.dataset.name,mats,units));
    root.querySelectorAll('.edit-menu').forEach(b=>{
      const row=rows.find(x=>String(x.id)===String(b.dataset.id));
      if(row) b.onclick=()=>editMenu(root,row);
    });
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;
  }
}

function menuFormBody(row={}){
  return `
    <div class="form-grid">
      <div class="field full">
        <label>اسم الوجبة</label>
        <input name="name" value="${esc(row.name||'')}" required autocomplete="off">
      </div>
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

function addMenu(root){
  modal({
    title:'إضافة وجبة',
    body:menuFormBody(),
    onSubmit:async fd=>{
      try{
        const name=String(fd.get('name')||'').trim();
        if(!name){toast('اكتب اسم الوجبة.','error');return false;}
        await api.createMenuItem({
          name,
          price:String(fd.get('price')||'').trim()||null,
          foodCost:String(fd.get('fc')||'').trim()||null,
          discount:String(fd.get('discount')||'').trim()||0,
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

function editMenu(root,row){
  modal({
    title:`تعديل ${row.name||'الوجبة'}`,
    body:menuFormBody(row),
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

    const m=modal({
      title:`وصفة: ${name}`,
      subtitle:'أضف كمية كل مادة المستخدمة في وجبة واحدة.',
      wide:true,
      submitText:'إضافة مكوّن',
      body:`
        <div class="recipe-items-host"></div>

        <div class="recipe-entry-row">
          <div class="field">
            <label>المادة</label>
            <select name="material" required>
              <option value="">اختر مادة جديدة</option>
            </select>
          </div>
          <div class="field">
            <label>الوحدة</label>
            <div class="select-action-row">
              <select name="unit" required disabled>
                <option value="">اختر المادة أولًا</option>
              </select>
              <button type="button" class="conversion-btn add-conversion" disabled><span aria-hidden="true">⇄</span> تحويل وحدة</button>
            </div>
          </div>
          <div class="field">
            <label>الكمية</label>
            <input name="qty" type="number" step="any" min="0.00000001" required autocomplete="off" disabled>
          </div>
        </div>
        <div class="recipe-save-row">
          <span>كل مكوّن جديد يظهر في الجدول فور حفظه.</span>
          <button type="button" class="btn secondary save-recipe-close">حفظ الوصفة وإغلاق</button>
        </div>`,
      onSubmit:async fd=>{
        try{
          const materialId=String(fd.get('material')||'').trim();
          const unitId=String(fd.get('unit')||'').trim();
          const quantity=Number(fd.get('qty'));
          if(!materialId){toast('اختر مادة لإضافتها.','error');return false;}
          if(!unitId){toast('اختر الوحدة.','error');return false;}
          if(!(quantity>0)){toast('اكتب كمية أكبر من صفر.','error');return false;}

          await api.addRecipeItem({
            menuItemId:id,
            materialId,
            unitId,
            quantity,
          });

          toast('تمت إضافة المكوّن إلى الوصفة.','success');
          await refreshRecipe();
          return false;
        }catch(e){
          toast(friendlyError(e,'تعذر حفظ المكوّن. شغّل تحديث قاعدة البيانات v0.7 مرة واحدة ثم حاول مجددًا.'),'error');
          return false;
        }
      },
    });

    const host=m.form.querySelector('.recipe-items-host');
    const materialSel=m.form.querySelector('[name="material"]');
    const unitSel=m.form.querySelector('[name="unit"]');
    const qtyInput=m.form.querySelector('[name="qty"]');
    const conversionBtn=m.form.querySelector('.add-conversion');
    const submitBtn=m.form.querySelector('[type="submit"]');

    const setEntryEnabled=(enabled)=>{
      unitSel.disabled=!enabled;
      qtyInput.disabled=!enabled;
      conversionBtn.disabled=!enabled;
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
      submitBtn.disabled=available.length===0;
      if(available.length===0){
        materialSel.innerHTML='<option value="">كل المواد المتاحة موجودة في الوصفة</option>';
      }
      setEntryEnabled(false);
    };

    const renderRows=()=>{
      host.innerHTML=rows.length?`
        <div class="table-wrap table-fit recipe-table-wrap">
          <table class="table compact-table recipe-table">
            <thead><tr><th>المادة</th><th>الكمية</th><th>الوحدة</th><th>إجراء</th></tr></thead>
            <tbody>
              ${rows.map(x=>`
                <tr>
                  <td><strong>${esc(mm[String(x.material_id)]?.name||'مادة')}</strong></td>
                  <td>${esc(x.input_quantity??x.quantity_original??x.quantity??x.quantity_base??'—')}</td>
                  <td>${esc(rowUnitLabel(x))}</td>
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
        '<div class="notice">لا توجد مكونات بعد. اختر مادة من الأسفل وأضفها.</div>';

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
      rows=await api.recipeItems(id);
      renderRows();
      populateMaterials();
      qtyInput.value='';
    }

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

    m.form.querySelector('.save-recipe-close').onclick=async()=>{
      m.close();
      await renderMenu(root);
    };

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
