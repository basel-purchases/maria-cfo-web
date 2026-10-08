import * as api from '../api.js';
import { modal,toast,loader,friendlyError,confirmBox } from '../ui.js';
import { esc,money,dateOnly,statusBadge,unitLabel,unitDisplay,todayISO } from '../utils.js';
import { materialUnitChoices, openConversionDialog } from '../material-units.js';

function isDirectSupplier(supplier){
  return !supplier || supplier?.notes==='SYSTEM_DIRECT_PURCHASE' || normalizeName(supplier?.name)==='شراء مباشر';
}

function invoiceStatus(invoice){
  return invoice?.is_voided ? statusBadge('voided') : statusBadge(invoice?.status);
}

function supplierNameFor(invoice,supplierMap){
  const supplier=supplierMap[String(invoice?.supplier_id||'')];
  return isDirectSupplier(supplier) ? '—' : (supplier?.name||'—');
}

export async function renderPurchases(root){
  root.innerHTML=loader();
  try{
    const [rows,suppliers]=await Promise.all([api.purchases(),api.suppliers()]);
    const supplierMap=Object.fromEntries(suppliers.map(s=>[String(s.id),s]));
    root.innerHTML=`
      <div class="page-head">
        <div>
          <h2>فواتير الشراء</h2>
          <p>سجّل ما دخل المخزون. المورد اختياري، وإذا كان موجودًا سيظهر هنا لتسهيل المتابعة.</p>
        </div>
        <button class="btn new">فاتورة جديدة</button>
      </div>
      ${rows.length?`
        <div class="table-wrap table-fit">
          <table class="table purchase-list-table">
            <thead><tr><th>التاريخ</th><th>المورد</th><th>رقم الفاتورة</th><th>الحالة</th><th>الإجمالي</th><th>إجراء</th></tr></thead>
            <tbody>${rows.map(r=>`
              <tr class="clickable" data-id="${esc(r.id)}">
                <td>${dateOnly(r.invoice_date||r.occurred_at)}</td>
                <td>${esc(supplierNameFor(r,supplierMap))}</td>
                <td>${esc(r.invoice_number||'—')}</td>
                <td>${invoiceStatus(r)}</td>
                <td>${money(r.is_voided ? (r.voided_original_total||0) : (r.total_original||0),r.currency_code||'SYP')}</td>
                <td class="row-actions">
                  <button type="button" class="mini-action open-invoice" data-open="${esc(r.id)}">فتح</button>
                  ${r.status==='draft'?`<button type="button" class="mini-action danger delete-draft" data-delete="${esc(r.id)}">حذف</button>`:''}
                  ${r.status==='posted'&&!r.is_voided?`<button type="button" class="mini-action danger void-posted" data-void="${esc(r.id)}">إلغاء</button>`:''}
                </td>
              </tr>`).join('')}</tbody>
          </table>
        </div>`:
        `<div class="card empty"><strong>لا توجد فواتير بعد</strong><div>ابدأ بفاتورة جديدة. المورد اختياري.</div><br><button class="btn new">فاتورة جديدة</button></div>`}`;
    root.querySelectorAll('.new').forEach(b=>b.onclick=()=>newPurchase());
    root.querySelectorAll('tr[data-id]').forEach(tr=>tr.onclick=e=>{
      if(e.target.closest('button')) return;
      location.hash='#/purchase/'+tr.dataset.id;
    });
    root.querySelectorAll('[data-open]').forEach(b=>b.onclick=e=>{e.stopPropagation();location.hash='#/purchase/'+b.dataset.open;});
    root.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async e=>{
      e.stopPropagation();
      if(!(await confirmBox('حذف المسودة سيزيلها نهائيًا لأنها لم تُنشر ولم تؤثر على المخزون.','حذف المسودة'))) return;
      try{
        await api.deletePurchaseDraft(b.dataset.delete);
        toast('تم حذف المسودة','success');
        await renderPurchases(root);
      }catch(err){toast(friendlyError(err,'تعذر حذف المسودة.'),'error');}
    });
    root.querySelectorAll('[data-void]').forEach(b=>b.onclick=e=>{e.stopPropagation();openVoidInvoiceDialog(root,b.dataset.void);});
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
    const supplier=allSup.find(s=>String(s.id)===String(invoice.supplier_id));
    const direct=isDirectSupplier(supplier);
    const draft=invoice.status==='draft';
    const posted=invoice.status==='posted' && !invoice.is_voided;

    root.innerHTML=`
      <div class="page-head">
        <div>
          <h2>تفاصيل الفاتورة</h2>
          <p>${direct?'شراء مباشر بدون مورد':`المورد: ${esc(supplier?.name||'—')}`}</p>
        </div>
        <div class="page-head-actions">
          ${draft?'<button class="btn secondary delete-draft-detail">حذف المسودة</button>':''}
          ${posted?'<button class="btn danger-btn void-posted-detail">إلغاء الفاتورة</button>':''}
        </div>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <div class="kv">
            <div class="k">التاريخ</div><div>${dateOnly(invoice.invoice_date||invoice.occurred_at)}</div>
            <div class="k">المورد</div><div>${direct?'بدون مورد':esc(supplier?.name||'—')}</div>
            <div class="k">الحالة</div><div>${invoiceStatus(invoice)}</div>
            <div class="k">العملة</div><div>${esc(invoice.currency_code||'SYP')}</div>
            <div class="k">الإجمالي</div><div><strong>${money(invoice.is_voided?(invoice.voided_original_total||0):(invoice.total_original||0),invoice.currency_code||'SYP')}</strong></div>
          </div>
          ${invoice.is_voided?`<div class="notice rose compact-notice">أُلغيت هذه الفاتورة وتم تسجيل حركة عكسية للمخزون.${invoice.void_reason?` السبب: ${esc(invoice.void_reason)}`:''}</div>`:''}
        </div>
        <div class="card">
          <h3>إدخال الفاتورة</h3>
          <p>أضف بندًا يدويًا، اختر من مواد هذا المورد السابقة، أو حلّل صورة الفاتورة بالذكاء الاصطناعي.</p>
          <div class="quick-actions purchase-actions">
            <button class="btn add" ${!draft?'disabled':''}>إضافة مادة</button>
            <button class="btn secondary reuse" ${!draft||direct?'disabled':''}>مواد هذا المورد</button>
            <button class="btn secondary ocr" ${!draft?'disabled':''}>تحليل صورة الفاتورة</button>
            <input type="file" class="ocr-file" accept="image/*" hidden>
            <button class="btn soft post" ${!draft||!items.length?'disabled':''}>نشر الفاتورة</button>
          </div>
          ${direct?'<small class="action-hint">اقتراحات المورد تظهر فقط عندما تكون الفاتورة مرتبطة بمورد حقيقي.</small>':''}
        </div>
      </div>
      <div style="height:16px"></div>
      <div class="card">
        <h3>البنود</h3>
        ${items.length?`
          <div class="table-wrap table-fit">
            <table class="table purchase-items-table">
              <thead><tr><th>المادة</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th>${draft?'<th>إجراء</th>':''}</tr></thead>
              <tbody>${items.map(x=>`
                <tr>
                  <td>${esc(mm[String(x.material_id)]?.name||x.material_id)}</td>
                  <td>${esc(unitLabel(um[String(x.purchase_unit_id)]?.code||um[String(x.purchase_unit_id)]?.name||'—'))}</td>
                  <td>${esc(x.quantity_purchase_unit??x.quantity_base??'—')}</td>
                  <td>${money(x.unit_price_original||0,invoice.currency_code||'SYP')}</td>
                  <td>${money(x.line_discount_original||0,invoice.currency_code||'SYP')}</td>
                  ${draft?`<td class="row-actions"><button class="mini-action edit-item" data-item="${esc(x.id)}">تعديل</button><button class="mini-action danger delete-item" data-item="${esc(x.id)}">حذف</button></td>`:''}
                </tr>`).join('')}</tbody>
            </table>
          </div>`:
          '<div class="empty"><strong>لا توجد بنود</strong><div>أضف مواد الفاتورة قبل النشر.</div></div>'}
      </div>`;

    root.querySelector('.add')?.addEventListener('click',()=>addItem(root,id,mats,units,invoice.currency_code||'SYP'));
    root.querySelector('.reuse')?.addEventListener('click',()=>openSupplierCatalogDialog(root,{invoice,items,mats,units,supplier}));
    const ocrFile=root.querySelector('.ocr-file');
    root.querySelector('.ocr')?.addEventListener('click',()=>ocrFile?.click());
    ocrFile?.addEventListener('change',async()=>{
      const file=ocrFile.files?.[0];
      if(!file) return;
      try{await openOcrDialog(root,{file,invoice,items,mats,units,supplier});}
      finally{ocrFile.value='';}
    });

    root.querySelectorAll('.edit-item').forEach(b=>b.onclick=()=>{
      const item=items.find(x=>String(x.id)===String(b.dataset.item));
      if(item) editPurchaseItem(root,{invoice,item,mats,units});
    });
    root.querySelectorAll('.delete-item').forEach(b=>b.onclick=async()=>{
      if(!(await confirmBox('حذف هذا البند من المسودة؟','حذف البند'))) return;
      try{await api.deletePurchaseItem(b.dataset.item);toast('تم حذف البند','success');await renderPurchaseDetail(root,id);}
      catch(e){toast(friendlyError(e,'تعذر حذف البند.'),'error');}
    });

    root.querySelector('.post')?.addEventListener('click',async()=>{
      if(!(await confirmBox('نشر الفاتورة سيحدّث المخزون ويجعلها عملية مالية تاريخية.','نشر'))) return;
      try{
        await api.postPurchase(id);
        toast('تم نشر الفاتورة وتحديث المخزون','success');
        await renderPurchaseDetail(root,id);
      }catch(e){toast(friendlyError(e),'error');}
    });

    root.querySelector('.delete-draft-detail')?.addEventListener('click',async()=>{
      if(!(await confirmBox('حذف المسودة سيزيلها نهائيًا لأنها لم تؤثر على المخزون.','حذف المسودة'))) return;
      try{await api.deletePurchaseDraft(id);toast('تم حذف المسودة','success');location.hash='#/purchases';}
      catch(e){toast(friendlyError(e,'تعذر حذف المسودة.'),'error');}
    });
    root.querySelector('.void-posted-detail')?.addEventListener('click',()=>openVoidInvoiceDialog(root,id,true));
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e,'تعذر فتح الفاتورة.')}</div>`;
  }
}

function openVoidInvoiceDialog(root,id,fromDetail=false){
  modal({
    title:'إلغاء فاتورة منشورة',
    subtitle:'لن نحذف السجل التاريخي. سيُسجل عكس المخزون وتُعلّم الفاتورة كملغاة.',
    body:`<div class="field"><label>سبب الإلغاء <span class="optional-badge">اختياري</span></label><textarea name="reason" rows="3" placeholder="مثال: فاتورة مكررة"></textarea></div>`,
    submitText:'إلغاء الفاتورة وعكس المخزون',
    onSubmit:async fd=>{
      try{
        await api.voidPurchase(id,String(fd.get('reason')||'').trim()||null);
        toast('تم إلغاء الفاتورة وعكس أثرها على المخزون','success');
        if(fromDetail) await renderPurchaseDetail(root,id); else await renderPurchases(root);
        return true;
      }catch(e){toast(friendlyError(e,'تعذر إلغاء الفاتورة. إذا كانت عليها دفعة مورد يجب معالجة الدفعة أولًا.'),'error');return false;}
    },
  });
}

async function openSupplierCatalogDialog(root,{invoice,items,mats,units,supplier}){
  if(isDirectSupplier(supplier)){
    toast('هذه الفاتورة بلا مورد؛ اقتراحات المواد تعمل فقط عند وجود اسم مورد.');
    return;
  }
  try{
    const catalog=await api.supplierPurchaseCatalog(invoice.supplier_id);
    if(!catalog.length){toast('لا توجد مواد سابقة مسجلة لهذا المورد بعد.');return;}
    const existing=new Set(items.map(x=>String(x.material_id)));
    const prepared=[];
    for(const row of catalog){
      const material=mats.find(m=>String(m.id)===String(row.material_id));
      if(!material) continue;
      const choices=await materialUnitChoices(material,units);
      prepared.push({...row,material,choices,already:existing.has(String(row.material_id))});
    }
    const m=modal({
      title:`مواد ${supplier.name}`,
      subtitle:'هذه قائمة تراكمية بكل المواد التي اشتريتها من هذا المورد سابقًا. اختر فقط ما يوجد في الفاتورة الحالية وعدّل أرقامه قبل الإضافة.',
      wide:true,
      body:`
        <div class="supplier-catalog-list">
          ${prepared.map((r,i)=>`
            <div class="supplier-catalog-row ${r.already?'already-added':'is-muted'}" data-catalog-row="${i}">
              <label class="catalog-material-check">
                <input type="checkbox" name="pick_${i}" ${r.already?'disabled':''}>
                <span><strong>${esc(r.material.name)}</strong>${r.material.quick_code||r.material.code?`<small>${esc(r.material.quick_code||r.material.code)}</small>`:''}</span>
              </label>
              <div class="field compact"><label>الوحدة</label><select name="unit_${i}" ${r.already?'disabled':''}>${r.choices.map(c=>`<option value="${esc(c.unitId)}" ${String(c.unitId)===String(r.purchase_unit_id)?'selected':''}>${esc(c.label)}</option>`).join('')}</select></div>
              <div class="field compact"><label>الكمية</label><input name="qty_${i}" type="number" step="any" min="0.000001" value="${esc(r.quantity_purchase_unit??1)}" ${r.already?'disabled':''}></div>
              <div class="field compact"><label>السعر</label><input name="price_${i}" type="number" step="any" min="0" value="${esc(r.unit_price_original??0)}" ${r.already?'disabled':''}></div>
              <div class="field compact"><label>الخصم</label><input name="discount_${i}" type="number" step="any" min="0" value="${esc(r.line_discount_original??0)}" ${r.already?'disabled':''}></div>
              ${r.already?'<span class="catalog-note">مضاف حاليًا</span>':''}
            </div>`).join('')}
        </div>`,
      submitText:'إضافة المواد المحددة',
      onSubmit:async(fd)=>{
        const selected=[];
        prepared.forEach((r,i)=>{if(!r.already && fd.get(`pick_${i}`)) selected.push({r,i});});
        if(!selected.length){toast('حدد مادة واحدة على الأقل.');return false;}
        try{
          for(const {r,i} of selected){
            await api.addPurchaseItem({
              invoiceId:invoice.id,
              materialId:r.material_id,
              purchaseUnitId:fd.get(`unit_${i}`),
              quantity:fd.get(`qty_${i}`),
              unitPrice:fd.get(`price_${i}`),
              discount:fd.get(`discount_${i}`)||0,
            });
          }
          toast(`تمت إضافة ${selected.length} مادة من سجل المورد`,'success');
          await renderPurchaseDetail(root,invoice.id);
          return true;
        }catch(e){toast(friendlyError(e,'تعذر إضافة المواد المحددة.'),'error');return false;}
      },
    });
    prepared.forEach((r,i)=>{
      if(r.already) return;
      const row=m.form.querySelector(`[data-catalog-row="${i}"]`);
      const check=row?.querySelector(`[name="pick_${i}"]`);
      const inputs=row?.querySelectorAll('select,input[type="number"]');
      inputs?.forEach(el=>el.disabled=true);
      check?.addEventListener('change',()=>{
        row.classList.toggle('is-muted',!check.checked);
        inputs?.forEach(el=>el.disabled=!check.checked);
      });
    });
  }catch(e){toast(friendlyError(e,'تعذر جلب مواد المورد السابقة.'),'error');}
}

function editPurchaseItem(root,{invoice,item,mats,units}){
  const material=mats.find(m=>String(m.id)===String(item.material_id));
  if(!material) return;
  (async()=>{
    const choices=await materialUnitChoices(material,units);
    modal({
      title:`تعديل ${material.name}`,
      subtitle:'عدّل الوحدة أو الكمية أو السعر أو الخصم قبل نشر الفاتورة.',
      body:`<div class="purchase-item-row purchase-item-fields">
        <div class="field"><label>الوحدة</label><select name="unit">${choices.map(c=>`<option value="${esc(c.unitId)}" ${String(c.unitId)===String(item.purchase_unit_id)?'selected':''}>${esc(c.label)}</option>`).join('')}</select></div>
        <div class="field"><label>الكمية</label><input name="qty" type="number" step="any" min="0.000001" value="${esc(item.quantity_purchase_unit??item.quantity_base??1)}"></div>
        <div class="field"><label>سعر الوحدة</label><input name="price" type="number" step="any" min="0" value="${esc(item.unit_price_original??0)}"></div>
        <div class="field"><label>الخصم</label><input name="discount" type="number" step="any" min="0" value="${esc(item.line_discount_original??0)}"></div>
      </div>`,
      submitText:'حفظ التعديل',
      onSubmit:async fd=>{
        try{
          await api.updatePurchaseItem({
            itemId:item.id,
            purchaseUnitId:fd.get('unit'),
            quantity:fd.get('qty'),
            unitPrice:fd.get('price'),
            discount:fd.get('discount')||0,
          });
          toast('تم تحديث البند','success');
          await renderPurchaseDetail(root,invoice.id);
          return true;
        }catch(e){toast(friendlyError(e,'تعذر تعديل البند.'),'error');return false;}
      },
    });
  })();
}

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||'').split(',').pop()||'');
    reader.onerror=()=>reject(reader.error||new Error('FILE_READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

function bestMaterialMatch(name,mats){
  const n=normalizeName(name);
  return mats.find(m=>normalizeName(m.name)===n) || mats.find(m=>normalizeName(m.name).includes(n)||n.includes(normalizeName(m.name))) || null;
}

async function openOcrDialog(root,{file,invoice,mats,units,supplier}){
  if(file.size>8*1024*1024){toast('حجم الصورة كبير. اختر صورة أقل من 8 MB.','error');return;}
  toast('جاري تحليل صورة الفاتورة...');
  try{
    const base64=await fileToBase64(file);
    const result=await api.analyzePurchaseInvoiceImage({
      imageBase64:base64,
      mimeType:file.type||'image/jpeg',
      supplierName:isDirectSupplier(supplier)?'':supplier?.name||'',
      currency:invoice.currency_code||'SYP',
    });
    const extracted=Array.isArray(result?.items)?result.items:[];
    if(!extracted.length){toast('لم يتم العثور على بنود واضحة في الصورة. جرّب صورة أوضح.','error');return;}

    const rows=[];
    for(const x of extracted){
      const material=bestMaterialMatch(x.name||x.material_name||'',mats);
      const choices=material?await materialUnitChoices(material,units):[];
      let preferred='';
      if(material && x.unit){
        const u=api.findUnitByText(String(x.unit),units);
        if(u && choices.some(c=>String(c.unitId)===String(u.id))) preferred=String(u.id);
      }
      rows.push({raw:x,material,choices,preferred});
    }

    const m=modal({
      title:'مراجعة تحليل الفاتورة',
      subtitle:'راجع البنود قبل إضافتها. أي مادة لم نتعرف عليها بوضوح لن تُضاف تلقائيًا.',
      wide:true,
      body:`
        <div class="ocr-summary">
          ${result.supplier_name?`<span>المورد المقروء: <strong>${esc(result.supplier_name)}</strong></span>`:''}
          ${result.invoice_number?`<span>رقم الفاتورة: <strong>${esc(result.invoice_number)}</strong></span>`:''}
          ${result.invoice_date?`<span>التاريخ: <strong>${esc(result.invoice_date)}</strong></span>`:''}
        </div>
        <div class="ocr-items-list">
          ${rows.map((r,i)=>`
            <div class="ocr-item-row ${r.material?'':'needs-review'}" data-ocr-row="${i}">
              <label class="catalog-material-check"><input type="checkbox" name="pick_${i}" ${r.material?'checked':'disabled'}><span><strong>${esc(r.raw.name||r.raw.material_name||'مادة غير معروفة')}</strong><small>${r.material?`مطابقة: ${esc(r.material.name)}`:'تحتاج ربطًا بمادة موجودة أو إضافتها أولًا'}</small></span></label>
              <div class="field compact"><label>المادة</label><select name="material_${i}"><option value="">اختر</option>${mats.map(mat=>`<option value="${esc(mat.id)}" ${r.material&&String(mat.id)===String(r.material.id)?'selected':''}>${esc(mat.name)}${mat.quick_code||mat.code?` — ${esc(mat.quick_code||mat.code)}`:''}</option>`).join('')}</select></div>
              <div class="field compact"><label>الوحدة</label><select name="unit_${i}">${r.choices.map(c=>`<option value="${esc(c.unitId)}" ${r.preferred&&String(c.unitId)===String(r.preferred)?'selected':''}>${esc(c.label)}</option>`).join('')}</select></div>
              <div class="field compact"><label>الكمية</label><input name="qty_${i}" type="number" step="any" min="0.000001" value="${esc(r.raw.quantity??1)}"></div>
              <div class="field compact"><label>السعر</label><input name="price_${i}" type="number" step="any" min="0" value="${esc(r.raw.unit_price??r.raw.price??0)}"></div>
            </div>`).join('')}
        </div>`,
      submitText:'إضافة البنود المحددة',
      onSubmit:async fd=>{
        const selected=[];
        rows.forEach((r,i)=>{if(fd.get(`pick_${i}`)) selected.push({r,i});});
        if(!selected.length){toast('حدد بندًا واحدًا على الأقل.');return false;}
        try{
          for(const {i} of selected){
            const materialId=String(fd.get(`material_${i}`)||'');
            const unitId=String(fd.get(`unit_${i}`)||'');
            if(!materialId||!unitId) throw new Error('OCR_ITEM_NEEDS_REVIEW');
            await api.addPurchaseItem({
              invoiceId:invoice.id,
              materialId,
              purchaseUnitId:unitId,
              quantity:fd.get(`qty_${i}`),
              unitPrice:fd.get(`price_${i}`),
              discount:0,
            });
          }
          toast(`تمت إضافة ${selected.length} بند بعد المراجعة`,'success');
          await renderPurchaseDetail(root,invoice.id);
          return true;
        }catch(e){toast(friendlyError(e,'تعذر إضافة بعض البنود المستخرجة.'),'error');return false;}
      },
    });

    rows.forEach((r,i)=>{
      const row=m.form.querySelector(`[data-ocr-row="${i}"]`);
      const materialSel=row?.querySelector(`[name="material_${i}"]`);
      const unitSel=row?.querySelector(`[name="unit_${i}"]`);
      const pick=row?.querySelector(`[name="pick_${i}"]`);
      materialSel?.addEventListener('change',async()=>{
        const material=mats.find(x=>String(x.id)===String(materialSel.value));
        if(!material){unitSel.innerHTML='';pick.checked=false;pick.disabled=true;row.classList.add('needs-review');return;}
        const choices=await materialUnitChoices(material,units);
        unitSel.innerHTML=choices.map(c=>`<option value="${esc(c.unitId)}">${esc(c.label)}</option>`).join('');
        pick.disabled=false;pick.checked=true;row.classList.remove('needs-review');
      });
    });
  }catch(e){
    toast(friendlyError(e,'تعذر تحليل صورة الفاتورة. تأكد من نشر Edge Function باسم document-ocr ثم حاول مرة أخرى.'),'error');
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
        toast(friendlyError(e,'تعذر إضافة البند. تأكد من تشغيل تحديث قاعدة البيانات v0.10 ثم حاول مرة أخرى.'),'error');
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

