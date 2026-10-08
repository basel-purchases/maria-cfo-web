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
        toast(friendlyError(e,'تعذر حفظ الوجبة. تأكد من تشغيل تحديث قاعدة البيانات v0.6.'),'error');
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
    const rows=await api.recipeItems(id);
    const mm=Object.fromEntries(mats.map(x=>[String(x.id),x]));
    const um=Object.fromEntries(units.map(x=>[String(x.id),x]));

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
        ${rows.length?`
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
          '<div class="notice">لا توجد مكونات بعد.</div>'}

        <div class="recipe-entry-row">
          <div class="field">
            <label>المادة</label>
            <select name="material" required>
              ${mats.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>الوحدة</label>
            <div class="select-action-row">
              <select name="unit" required></select>
              <button type="button" class="conversion-btn add-conversion"><span aria-hidden="true">⇄</span> تحويل وحدة</button>
            </div>
          </div>
          <div class="field">
            <label>الكمية</label>
            <input name="qty" type="number" step="any" min="0.00000001" required autocomplete="off">
          </div>
        </div>
        <div class="recipe-save-row">
          <span>كل مكوّن يُحفظ فور إضافته.</span>
          <button type="button" class="btn secondary save-recipe-close">حفظ الوصفة وإغلاق</button>
        </div>`,
      onSubmit:async fd=>{
        try{
          const materialId=String(fd.get('material')||'');
          const existing=rows.find(x=>String(x.material_id)===materialId);
          if(existing){
            await api.updateRecipeItem(existing.id,{
              unitId:fd.get('unit'),
              quantity:fd.get('qty'),
            });
            toast('المادة موجودة في الوصفة، تم تحديثها بدل تكرارها.','success');
          }else{
            await api.addRecipeItem({
              menuItemId:id,
              materialId,
              unitId:fd.get('unit'),
              quantity:fd.get('qty'),
            });
            toast('تمت إضافة المكوّن','success');
          }
          m.close();
          await recipeDialog(root,id,name,mats,units);
          return false;
        }catch(e){
          toast(friendlyError(e,'تعذر حفظ المكوّن. شغّل تحديث قاعدة البيانات v0.6 مرة واحدة ثم حاول مجددًا.'),'error');
          return false;
        }
      },
    });

    const materialSel=m.form.querySelector('[name="material"]');
    const unitSel=m.form.querySelector('[name="unit"]');

    const populateUnits=async(preferred=null)=>{
      const material=mm[String(materialSel.value)];
      if(!material) return;
      await api.ensureStandardMaterialUnits(material,units).catch(()=>null);
      const choices=await materialUnitChoices(material,units);
      unitSel.innerHTML=choices.map(x=>`<option value="${esc(x.unitId)}">${esc(x.label)}</option>`).join('');
      if(preferred && choices.some(x=>String(x.unitId)===String(preferred))) unitSel.value=preferred;
    };

    materialSel.addEventListener('change',()=>populateUnits());
    await populateUnits();

    m.form.querySelector('.save-recipe-close').onclick=async()=>{
      toast('تم حفظ الوصفة.','success');
      m.close();
      await renderMenu(root);
    };

    m.form.querySelector('.add-conversion').onclick=async()=>{
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

    m.form.querySelectorAll('.edit-recipe-item').forEach(btn=>{
      const row=rows.find(x=>String(x.id)===String(btn.dataset.id));
      if(row) btn.onclick=()=>editRecipeItem({root,menuId:id,menuName:name,row,material:mm[String(row.material_id)],mats,units,parent:m});
    });

    m.form.querySelectorAll('.delete-recipe-item').forEach(btn=>{
      const row=rows.find(x=>String(x.id)===String(btn.dataset.id));
      if(!row) return;
      btn.onclick=async()=>{
        if(!(await confirmBox('حذف هذا المكوّن من الوصفة؟','حذف'))) return;
        try{
          await api.deleteRecipeItem(row.id);
          toast('تم حذف المكوّن.','success');
          m.close();
          await recipeDialog(root,id,name,mats,units);
        }catch(e){
          toast(friendlyError(e,'تعذر حذف المكوّن.'),'error');
        }
      };
    });
  }catch(e){
    toast(friendlyError(e,'تعذر فتح الوصفة.'),'error');
  }
}

async function editRecipeItem({root,menuId,menuName,row,material,mats,units,parent}){
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
          <input name="qty" type="number" min="0.00000001" step="any" value="${esc(currentQty)}" required>
        </div>
      </div>`,
    submitText:'حفظ التعديل',
    onSubmit:async fd=>{
      try{
        await api.updateRecipeItem(row.id,{unitId:fd.get('unit'),quantity:fd.get('qty')});
        toast('تم تعديل المكوّن.','success');
        m.close();
        parent.close();
        await recipeDialog(root,menuId,menuName,mats,units);
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
