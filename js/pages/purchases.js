import * as api from '../api.js';
import { modal,toast,loader,friendlyError,confirmBox } from '../ui.js';
import { esc,money,dateOnly,statusBadge,unitLabel,todayISO } from '../utils.js';
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
          <p>اختر المادة، وستظهر فقط وحدات الشراء المرتبطة بها.</p>
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

    root.querySelector('.add')?.addEventListener('click',()=>addItem(root,id,mats,units));
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

function addItem(root,id,mats,units){
  if(!mats.length){
    toast('أضف مادة أولًا من قسم المواد.','error');
    return;
  }

  const m=modal({
    title:'إضافة مادة للفاتورة',
    wide:true,
    body:`
      <div class="purchase-item-row">
        <div class="field">
          <label>المادة</label>
          <select name="material" required>${mats.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>وحدة الشراء</label>
          <div class="select-action-row">
            <select name="unit" required></select>
            <button type="button" class="mini-btn add-purchase-conversion">+ وحدة شراء</button>
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
            <span class="input-suffix" data-price-suffix>SYP / الوحدة</span>
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
        await api.addPurchaseItem({
          invoiceId:id,
          materialId:fd.get('material'),
          purchaseUnitId:fd.get('unit'),
          quantity:fd.get('qty'),
          unitPrice:fd.get('price'),
          discount:fd.get('discount')||0,
        });
        toast('تمت إضافة البند','success');
        await renderPurchaseDetail(root,id);
        return true;
      }catch(e){
        toast(friendlyError(e,'تعذر إضافة البند. تأكد من تحويل وحدة الشراء.'),'error');
        return false;
      }
    },
  });

  const materialSel=m.form.querySelector('[name="material"]');
  const unitSel=m.form.querySelector('[name="unit"]');
  const priceSuffix=m.form.querySelector('[data-price-suffix]');

  const populateUnits=async(preferred=null)=>{
    const material=mats.find(x=>String(x.id)===String(materialSel.value));
    if(!material) return;
    const choices=await materialUnitChoices(material,units,{purchaseOnly:true});
    unitSel.innerHTML=choices.map(x=>`<option value="${esc(x.unitId)}">${esc(x.label)}</option>`).join('');
    if(preferred && choices.some(x=>String(x.unitId)===String(preferred))) unitSel.value=preferred;
    const label=unitSel.options[unitSel.selectedIndex]?.textContent?.trim()||'الوحدة';
    priceSuffix.textContent=`SYP / ${label}`;
  };

  materialSel.addEventListener('change',()=>populateUnits());
  unitSel.addEventListener('change',()=>{
    const label=unitSel.options[unitSel.selectedIndex]?.textContent?.trim()||'الوحدة';
    priceSuffix.textContent=`SYP / ${label}`;
  });
  populateUnits();

  m.form.querySelector('.add-purchase-conversion').onclick=async()=>{
    const material=mats.find(x=>String(x.id)===String(materialSel.value));
    if(!material) return;
    await openConversionDialog({
      material,
      units,
      mode:'purchase',
      referenceUnitId:material.base_unit_id,
      onSaved:async newUnitId=>populateUnits(newUnitId),
    });
  };
}
