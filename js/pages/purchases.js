import * as api from '../api.js';
import { modal,toast,loader,friendlyError,confirmBox } from '../ui.js';
import { esc,money,dateOnly,statusBadge,unitLabel,unitDisplay,todayISO } from '../utils.js';
import { materialUnitChoices, openConversionDialog } from '../material-units.js';

export async function renderPurchases(root){
  root.innerHTML=loader();
  try{
    const rows=await api.purchases();
    root.innerHTML=`
      <div class="page-head">
        <div>
          <h2>فواتير الشراء</h2>
          <p>سجّل ما دخل المخزون. اسم المورد اختياري؛ المادة والكمية والسعر هي الأساس.</p>
        </div>
        <button class="btn new">فاتورة جديدة</button>
      </div>
      ${rows.length?`
        <div class="table-wrap table-fit">
          <table class="table">
            <thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>الحالة</th><th>الإجمالي</th><th></th></tr></thead>
            <tbody>${rows.map(r=>`
              <tr class="clickable" data-id="${esc(r.id)}">
                <td>${dateOnly(r.invoice_date||r.occurred_at)}</td>
                <td>${esc(r.invoice_number||'—')}</td>
                <td>${statusBadge(r.status)}</td>
                <td>${money(r.total_original||0,r.currency_code||'SYP')}</td>
                <td>فتح ←</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>`:
        `<div class="card empty"><strong>لا توجد فواتير بعد</strong><div>ابدأ بفاتورة جديدة. المورد اختياري.</div><br><button class="btn new">فاتورة جديدة</button></div>`}`;
    root.querySelectorAll('.new').forEach(b=>b.onclick=()=>newPurchase());
    root.querySelectorAll('tr[data-id]').forEach(tr=>tr.onclick=()=>location.hash='#/purchase/'+tr.dataset.id);
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;
  }
}

function newPurchase(){
  modal({
    title:'فاتورة شراء جديدة',
    subtitle:'المورد اختياري تمامًا.',
    body:`
      <div class="form-grid">
        <div class="field"><label>اسم المورد <span class="optional-badge">اختياري</span></label><input name="supplier" autocomplete="off"></div>
        <div class="field"><label>رقم الفاتورة <span class="optional-badge">اختياري</span></label><input name="number" autocomplete="off"></div>
        <div class="field"><label>التاريخ</label><input name="date" type="date" value="${todayISO()}" required></div>
        <div class="field"><label>العملة</label><select name="currency"><option>SYP</option><option>USD</option></select></div>
      </div>`,
    submitText:'إنشاء الفاتورة',
    onSubmit:async fd=>{
      try{
        const id=await api.createPurchase({
          supplierName:String(fd.get('supplier')||''),
          currency:fd.get('currency'),
          invoiceNumber:String(fd.get('number')||'').trim()||null,
          date:fd.get('date'),
        });
        toast('تم إنشاء المسودة','success');
        location.hash='#/purchase/'+id;
        return true;
      }catch(e){
        toast(friendlyError(e),'error');
        return false;
      }
    },
  });
}

export async function renderPurchaseDetail(root,id){
  root.innerHTML=loader();
  try{
    const [invoice,items,mats,units,allSup]=await Promise.all([
      api.one('purchase_invoices',id),
      api.purchaseItems(id),
      api.materials(),
      api.units(),
      api.suppliers(),
    ]);
    if(!invoice) throw new Error('INVOICE_NOT_FOUND');
    const mm=Object.fromEntries(mats.map(m=>[String(m.id),m]));
    const um=Object.fromEntries(units.map(u=>[String(u.id),u]));
    const supplier=allSup.find(s=>s.id===invoice.supplier_id);

    root.innerHTML=`
      <div class="page-head">
        <div>
          <h2>تفاصيل الفاتورة</h2>
          <p>${supplier?.notes==='SYSTEM_DIRECT_PURCHASE'||supplier?.name==='شراء مباشر'?'شراء مباشر بدون مورد':`المورد: ${esc(supplier?.name||'—')}`}</p>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <div class="kv">
            <div class="k">التاريخ</div><div>${dateOnly(invoice.invoice_date||invoice.occurred_at)}</div>
            <div class="k">الحالة</div><div>${statusBadge(invoice.status)}</div>
            <div class="k">العملة</div><div>${esc(invoice.currency_code||'SYP')}</div>
            <div class="k">الإجمالي</div><div><strong>${money(invoice.total_original||0,invoice.currency_code||'SYP')}</strong></div>
          </div>
        </div>
        <div class="card">
          <h3>إدخال الفاتورة</h3>
          <p>اختر المادة والوحدة التي اشتريتها بها. إذا لم تكن المادة موجودة يمكنك إضافتها من نفس الفاتورة.</p>
          <div class="quick-actions">
            <button class="btn add" ${invoice.status!=='draft'?'disabled':''}>إضافة مادة</button>
            <button class="btn secondary reuse" ${invoice.status!=='draft'?'disabled':''}>جلب آخر بنود المورد</button>
            <button class="btn soft post" ${invoice.status!=='draft'||!items.length?'disabled':''}>نشر الفاتورة</button>
          </div>
        </div>
      </div>
      <div style="height:16px"></div>
      <div class="card">
        <h3>البنود</h3>
        ${items.length?`
          <div class="table-wrap table-fit">
            <table class="table">
              <thead><tr><th>المادة</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th></tr></thead>
              <tbody>${items.map(x=>`
                <tr>
                  <td>${esc(mm[String(x.material_id)]?.name||x.material_id)}</td>
                  <td>${esc(unitLabel(um[String(x.purchase_unit_id)]?.code||um[String(x.purchase_unit_id)]?.name||'—'))}</td>
                  <td>${esc(x.quantity_purchase_unit??x.quantity_base??'—')}</td>
                  <td>${money(x.unit_price_original||0,invoice.currency_code||'SYP')}</td>
                  <td>${money(x.line_discount_original||0,invoice.currency_code||'SYP')}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>`:
          '<div class="empty"><strong>لا توجد بنود</strong><div>أضف مواد الفاتورة قبل النشر.</div></div>'}
      </div>`;

    root.querySelector('.add')?.addEventListener('click',()=>addItem(root,id,mats,units,invoice.currency_code||'SYP'));
    root.querySelector('.reuse')?.addEventListener('click',async()=>{
      try{
        const prev=await api.previousSupplierItems(invoice);
        if(!prev.length){toast('لا توجد فاتورة سابقة لهذا المورد.');return;}
        if(!(await confirmBox(`وجدنا ${prev.length} بندًا. هل تريد نسخها إلى هذه المسودة؟`,'نسخ البنود'))) return;
        for(const x of prev){
          await api.addPurchaseItem({
            invoiceId:id,
            materialId:x.material_id,
            purchaseUnitId:x.purchase_unit_id,
            quantity:x.quantity_purchase_unit||x.quantity_base||1,
            unitPrice:x.unit_price_original||0,
            discount:x.line_discount_original||0,
          });
        }
        toast('تم جلب البنود ويمكنك إضافة أو تغيير ما تحتاجه.','success');
        await renderPurchaseDetail(root,id);
      }catch(e){
        toast(friendlyError(e),'error');
      }
    });
    root.querySelector('.post')?.addEventListener('click',async()=>{
      if(!(await confirmBox('نشر الفاتورة سيحدّث المخزون ويجعلها عملية مالية تاريخية.','نشر'))) return;
      try{
        await api.postPurchase(id);
        toast('تم نشر الفاتورة وتحديث المخزون','success');
        await renderPurchaseDetail(root,id);
      }catch(e){
        toast(friendlyError(e),'error');
      }
    });
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e,'تعذر فتح الفاتورة.')}</div>`;
  }
}

function normalizeName(value){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
}

function addItem(root,id,mats,units,currency='SYP'){
  const unitListId=`purchase-material-base-units-${Date.now()}`;
  const materialOptions=()=>mats.length
    ? mats.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}${x.quick_code||x.code?` — ${esc(x.quick_code||x.code)}`:''}</option>`).join('')
    : '<option value="">أضف مادة جديدة أولًا</option>';

  const m=modal({
    title:'إضافة مادة للفاتورة',
    subtitle:'اختر مادة موجودة أو أضف مادة جديدة من نفس الفاتورة.',
    wide:true,
    body:`
      <datalist id="${unitListId}">${units.map(u=>`<option value="${esc(unitDisplay(u))}">${esc(u.code||'')}</option>`).join('')}</datalist>

      <div class="purchase-material-picker">
        <div class="field">
          <label>المادة</label>
          <div class="select-action-row">
            <select name="material" ${mats.length?'required':''}>${materialOptions()}</select>
            <button type="button" class="conversion-btn new-material-toggle"><span>＋</span> مادة جديدة</button>
          </div>
        </div>

        <div class="inline-new-material ${mats.length?'is-hidden':''}" data-new-material-panel>
          <div class="inline-new-material-head">
            <strong>إضافة مادة جديدة</strong>
            <span>سنضيفها ونختارها مباشرة لهذه الفاتورة.</span>
          </div>
          <div class="form-grid compact-grid">
            <div class="field">
              <label>اسم المادة</label>
              <input name="new_material_name" autocomplete="off" placeholder="مثال: سكر بني">
              <small class="field-message" data-duplicate-warning></small>
            </div>
            <div class="field">
              <label>وحدة المخزون</label>
              <input name="new_material_unit" list="${unitListId}" autocomplete="off" placeholder="كيلوغرام، قطعة، لتر...">
            </div>
          </div>
          <div class="inline-new-material-actions">
            <button type="button" class="btn soft create-material-inline">إضافة واستخدام</button>
            ${mats.length?'<button type="button" class="btn secondary cancel-new-material">إخفاء</button>':''}
          </div>
        </div>
      </div>

      <div class="purchase-item-row purchase-item-fields">
        <div class="field">
          <label>الوحدة</label>
          <div class="select-action-row">
            <select name="unit" required></select>
            <button type="button" class="conversion-btn add-purchase-conversion"><span>⇄</span> تحويل وحدة</button>
          </div>
        </div>
        <div class="field">
          <label>الكمية</label>
          <input name="qty" type="number" step="any" min="0.000001" required autocomplete="off">
        </div>
        <div class="field">
          <label>سعر الوحدة</label>
          <div class="input-with-suffix">
            <input name="price" type="number" step="any" min="0" required autocomplete="off">
            <span class="input-suffix" data-price-suffix>${esc(currency)} / الوحدة</span>
          </div>
        </div>
        <div class="field">
          <label>خصم السطر</label>
          <input name="discount" type="number" step="any" min="0" value="0" autocomplete="off">
        </div>
      </div>`,
    submitText:'إضافة البند',
    onSubmit:async fd=>{
      try{
        const materialId=String(fd.get('material')||'');
        if(!materialId){
          toast('اختر مادة أو أضف مادة جديدة أولًا.','error');
          return false;
        }
        const unitId=String(fd.get('unit')||'');
        if(!unitId){
          toast('اختر وحدة الشراء أو أضف تحويلًا لها.','error');
          return false;
        }
        await api.addPurchaseItem({
          invoiceId:id,
          materialId,
          purchaseUnitId:unitId,
          quantity:fd.get('qty'),
          unitPrice:fd.get('price'),
          discount:fd.get('discount')||0,
        });
        toast('تمت إضافة البند','success');
        await renderPurchaseDetail(root,id);
        return true;
      }catch(e){
        toast(friendlyError(e,'تعذر إضافة البند. تأكد من تشغيل تحديث قاعدة البيانات v0.9 ثم حاول مرة أخرى.'),'error');
        return false;
      }
    },
  });

  const materialSel=m.form.querySelector('[name="material"]');
  const unitSel=m.form.querySelector('[name="unit"]');
  const priceSuffix=m.form.querySelector('[data-price-suffix]');
  const panel=m.form.querySelector('[data-new-material-panel]');
  const toggle=m.form.querySelector('.new-material-toggle');
  const nameInput=m.form.querySelector('[name="new_material_name"]');
  const baseUnitInput=m.form.querySelector('[name="new_material_unit"]');
  const warning=m.form.querySelector('[data-duplicate-warning]');
  const createBtn=m.form.querySelector('.create-material-inline');

  const findDuplicate=()=>{
    const wanted=normalizeName(nameInput.value);
    if(!wanted) return null;
    return mats.find(x=>normalizeName(x.name)===wanted)||null;
  };

  const refreshDuplicate=()=>{
    const duplicate=findDuplicate();
    if(duplicate){
      warning.textContent=`هذه المادة موجودة بالفعل (${duplicate.quick_code||duplicate.code||'بدون كود'}). لن ننشئ نسخة مكررة.`;
      warning.classList.add('error-text');
    }else{
      warning.textContent='';
      warning.classList.remove('error-text');
    }
    return duplicate;
  };

  const populateUnits=async(preferred=null)=>{
    const material=mats.find(x=>String(x.id)===String(materialSel.value));
    if(!material){
      unitSel.innerHTML='<option value="">—</option>';
      priceSuffix.textContent=`${currency} / الوحدة`;
      return;
    }
    const choices=await materialUnitChoices(material,units);
    unitSel.innerHTML=choices.map(x=>`<option value="${esc(x.unitId)}">${esc(x.label)}</option>`).join('');
    if(preferred && choices.some(x=>String(x.unitId)===String(preferred))) unitSel.value=preferred;
    const label=unitSel.options[unitSel.selectedIndex]?.textContent?.trim()||'الوحدة';
    priceSuffix.textContent=`${currency} / ${label}`;
  };

  const selectMaterial=async material=>{
    let option=[...materialSel.options].find(o=>String(o.value)===String(material.id));
    if(!option){
      option=document.createElement('option');
      option.value=material.id;
      option.textContent=`${material.name}${material.quick_code||material.code?` — ${material.quick_code||material.code}`:''}`;
      materialSel.appendChild(option);
    }
    materialSel.value=material.id;
    await populateUnits();
  };

  const hideNewMaterial=()=>{
    panel.classList.add('is-hidden');
    toggle.classList.remove('active');
  };
  const showNewMaterial=()=>{
    panel.classList.remove('is-hidden');
    toggle.classList.add('active');
    setTimeout(()=>nameInput.focus(),0);
  };

  toggle.addEventListener('click',()=>{
    if(panel.classList.contains('is-hidden')) showNewMaterial();
    else hideNewMaterial();
  });
  m.form.querySelector('.cancel-new-material')?.addEventListener('click',hideNewMaterial);
  nameInput.addEventListener('input',refreshDuplicate);

  createBtn.addEventListener('click',async()=>{
    const name=String(nameInput.value||'').trim();
    const unitText=String(baseUnitInput.value||'').trim();
    if(!name){toast('اكتب اسم المادة.','error');nameInput.focus();return;}
    if(!unitText){toast('اختر أو اكتب وحدة المخزون.','error');baseUnitInput.focus();return;}

    const duplicate=refreshDuplicate();
    if(duplicate){
      await selectMaterial(duplicate);
      hideNewMaterial();
      toast('المادة موجودة بالفعل؛ تم اختيارها بدل إنشاء نسخة مكررة.','success');
      return;
    }

    createBtn.disabled=true;
    try{
      let baseUnit=api.findUnitByText(unitText,units);
      if(!baseUnit){
        baseUnit=await api.resolveUnit(unitText,units);
        if(baseUnit && !units.some(u=>String(u.id)===String(baseUnit.id))) units.push(baseUnit);
      }
      if(!baseUnit?.id) throw new Error('UNIT_REQUIRED');

      const code=await api.nextMaterialCode(mats);
      const created=await api.insertFirst('materials',[
        {name,quick_code:code,base_unit_id:baseUnit.id},
        {name,code,base_unit_id:baseUnit.id},
      ]);
      await api.ensureStandardMaterialUnits(created,units).catch(()=>null);
      mats.push(created);
      await selectMaterial(created);
      nameInput.value='';
      baseUnitInput.value='';
      warning.textContent='';
      hideNewMaterial();
      toast(`تمت إضافة ${name} بالكود ${code} وأصبحت جاهزة للفاتورة.`,'success');
    }catch(e){
      toast(friendlyError(e,'تعذر إضافة المادة الجديدة.'),'error');
    }finally{
      createBtn.disabled=false;
    }
  });

  materialSel.addEventListener('change',()=>populateUnits());
  unitSel.addEventListener('change',()=>{
    const label=unitSel.options[unitSel.selectedIndex]?.textContent?.trim()||'الوحدة';
    priceSuffix.textContent=`${currency} / ${label}`;
  });
  populateUnits();

  m.form.querySelector('.add-purchase-conversion').onclick=async()=>{
    const material=mats.find(x=>String(x.id)===String(materialSel.value));
    if(!material){
      toast('اختر مادة أو أضف مادة جديدة أولًا.','error');
      return;
    }
    await openConversionDialog({
      material,
      units,
      referenceUnitId:material.base_unit_id,
      onSaved:async newUnitId=>populateUnits(newUnitId),
    });
  };
}

