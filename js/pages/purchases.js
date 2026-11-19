import {materialExactV106,materialMatchesV106,materialSearchTextV106} from '../material-search-v106.js?v=1.0.10';
import * as api from '../api.js?v=1.0.20';
import {validatePurchaseRevisionLinesV120} from '../purchase-bulk-editor-v120.js?v=1.0.20';
import { isVagueContextualName } from '../unit-catalog.js?v=1.0';
import { modal,toast,loader,friendlyError,confirmBox } from '../ui.js?v=1.0.20';
import {currencyLabel, esc,money,dateOnly,statusBadge,unitLabel,unitDisplay,todayISO } from '../utils.js?v=1.0';
import { materialUnitChoices, openConversionDialog } from '../material-units.js?v=1.0';
import {purchaseLineTotalV119,purchaseTotalsV119,revisionLinesV119} from '../purchase-workflow-v119.js?v=1.0.20';
import {supplierFieldV119,attachSupplierSuggestV119} from '../supplier-suggest-v119.js?v=1.0.20';

function isDirectSupplier(supplier){
  return !supplier || supplier?.code==='AMEEN_LEGACY_UNKNOWN_SOURCE_V029' || supplier?.notes==='SYSTEM_DIRECT_PURCHASE' || normalizeName(supplier?.name)==='شراء مباشر';
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
        <div class="page-head-actions"><button class="btn new">فاتورة جديدة</button><a class="btn secondary purchase-to-images-v108" href="#/images">الإدخال بالصور</a></div>
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
                <td>${r.is_ameen_legacy_v029?'<span class="badge">شراء تاريخي مرجعي</span>':invoiceStatus(r)}</td>
                <td>${money(r.is_voided ? (r.voided_original_total||0) : (r.total_original||0),r.currency_code||'SYP')}</td>
                <td class="row-actions">
                  <button type="button" class="mini-action open-invoice" data-open="${esc(r.id)}">فتح</button>
                  ${['draft','posted'].includes(r.status)&&!r.is_voided&&!r.is_ameen_legacy_v029?`<button type="button" class="mini-action purchase-open-bulk-v120" data-edit-lines="${esc(r.id)}">تعديل البنود</button>`:''}
                  ${r.status==='draft'?`<button type="button" class="mini-action danger delete-draft" data-delete="${esc(r.id)}">حذف</button>`:''}
                  ${r.status==='posted'&&!r.is_voided&&!r.is_ameen_legacy_v029?`<button type="button" class="mini-action danger void-posted" data-void="${esc(r.id)}">إلغاء</button>`:''}
                </td>
              </tr>`).join('')}</tbody>
          </table>
        </div>`:
        `<div class="card empty"><strong>لا توجد فواتير بعد</strong><div>ابدأ بفاتورة جديدة. المورد اختياري.</div><br><button class="btn new">فاتورة جديدة</button></div>`}`;
    root.querySelectorAll('.new').forEach(b=>b.onclick=()=>newPurchase({suppliers}));
    root.querySelectorAll('tr[data-id]').forEach(tr=>tr.onclick=e=>{
      if(e.target.closest('button')) return;
      location.hash='#/purchase/'+tr.dataset.id;
    });
    root.querySelectorAll('[data-open]').forEach(b=>b.onclick=e=>{e.stopPropagation();location.hash='#/purchase/'+b.dataset.open;});
    root.querySelectorAll('[data-edit-lines]').forEach(b=>b.onclick=e=>{
      e.stopPropagation();sessionStorage.setItem('maria_open_invoice_line_editor_v120',String(b.dataset.editLines));
      location.hash='#/purchase/'+b.dataset.editLines;
    });
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

export async function newPurchase({supplier=null,suppliers=null,openCatalog=false}={}){
  let all=suppliers;
  try{if(!all)all=await api.suppliers();}
  catch(e){toast(friendlyError(e,'تعذر تحميل قائمة الموردين.'),'error');return;}
  const dlg=modal({
    title:supplier?`فاتورة جديدة — ${supplier.name}`:'فاتورة شراء جديدة',
    subtitle:supplier?'المورد محدد مسبقًا؛ بعد الإنشاء ستُعرض مواده السابقة لتختار منها مباشرة.':'المورد اختياري، ويمكن البحث بالاسم من أول حرف.',
    body:`<div class="form-grid">
      ${supplier?`<div class="field"><label>المورد المحدد</label><input type="text" value="${esc(supplier.name)}" disabled><input name="supplier" type="hidden" value="${esc(supplier.name)}"><small class="action-hint">يمكن تغييره لاحقًا من تعديل بيانات الفاتورة.</small></div>`:supplierFieldV119({label:'اسم المورد (اختياري)'})}
      <div class="field"><label>رقم الفاتورة (اختياري)</label><input name="number" autocomplete="off"></div>
      <div class="field"><label>التاريخ</label><input name="date" type="date" value="${todayISO()}" required></div>
      <div class="field"><label>العملة</label><select name="currency"><option value="SYP">ل.س</option><option value="USD">USD</option></select></div>
    </div>`,
    submitText:'إنشاء الفاتورة',
    onSubmit:async(fd,form)=>{
      try{
        const name=String(fd.get('supplier')||'').trim();
        const id=await api.createPurchase({supplierId:supplier?.id||null,supplierName:name,currency:fd.get('currency'),
          invoiceNumber:String(fd.get('number')||'').trim()||null,date:fd.get('date')});
        if(openCatalog&&supplier)
          sessionStorage.setItem('maria_open_supplier_catalog_v119',String(id));
        toast('تم إنشاء مسودة الفاتورة','success');
        location.hash='#/purchase/'+id;
        return true;
      }catch(e){toast(friendlyError(e),'error');return false;}
    },
  });
  if(!supplier)attachSupplierSuggestV119(dlg.form,all);
}

// The server owns the revision, its inventory reversal, transfer of existing
// payment allocations, recalculation and audit; never write a posted invoice
// directly from the browser.
async function saveInvoiceRevisionV120(root,invoice,items,patch={},reason='تصحيح فاتورة'){
  const validation=validatePurchaseRevisionLinesV120(items,{posted:invoice.status==='posted'});
  if(!validation.valid)throw new Error(validation.code);
  const nextId=await api.revisePurchaseInvoiceV120({
    invoiceId:invoice.id,
    supplierId:patch.supplierId||invoice.supplier_id,
    invoiceNumber:patch.invoiceNumber!==undefined?patch.invoiceNumber:invoice.invoice_number,
    invoiceDate:patch.invoiceDate||String(invoice.invoice_date||invoice.occurred_at||'').slice(0,10),
    currency:patch.currency||invoice.currency_code||'SYP',
    items:revisionLinesV119(items),reason,updatedAt:invoice.updated_at||null,
  });
  toast(invoice.status==='posted'?'تم تصحيح الفاتورة ونقل أثر المخزون والدفعات بأمان':'تم تحديث الفاتورة والإجمالي','success');
  if(String(nextId)!==String(invoice.id))location.hash='#/purchase/'+nextId;
  else await renderPurchaseDetail(root,invoice.id);
  return nextId;
}

export async function renderPurchaseDetail(root,id){
  root.innerHTML=loader();
  try{
    const [invoice,items,mats,units,allSup,aiJobs]=await Promise.all([
      api.one('purchase_invoices',id),
      api.purchaseItems(id),
      api.materials(),
      api.units(),
      api.suppliers(),
      api.aiJobsForEntity('purchase_invoice',id).catch(()=>[]),
    ]);
    if(!invoice) throw new Error('INVOICE_NOT_FOUND');
    const revisions=await api.purchaseRevisionsV119(id).catch(()=>[]);
    const successor=revisions.find(r=>String(r.previous_invoice_id)===String(id));
    const totals=purchaseTotalsV119(items);
    const editable=['draft','posted'].includes(invoice.status)&&!invoice.is_voided&&!invoice.is_ameen_legacy_v029;
    const mm=Object.fromEntries(mats.map(m=>[String(m.id),m]));
    const um=Object.fromEntries(units.map(u=>[String(u.id),u]));
    const supplier=allSup.find(s=>String(s.id)===String(invoice.supplier_id));
    const direct=isDirectSupplier(supplier);
    const draft=invoice.status==='draft';
    const posted=invoice.status==='posted' && !invoice.is_voided;
    const pendingAi=aiJobs.filter(j=>['queued','processing'].includes(j.status));
    const readyAi=aiJobs.filter(j=>j.status==='completed' && !j.seen_at && j.result_json);
    const latestReadyAi=readyAi[0]||null;

    root.innerHTML=`
      <div class="page-head">
        <div>
          <h2>تفاصيل الفاتورة</h2>${invoice.is_ameen_legacy_v029?'<div class="notice">شراء تاريخي من التقرير المستورد؛ المورد والدفع غير معروفين، فلا يحتسب ضمن ديون الموردين ولا ينشئ حركة صندوق.</div>':''}
          <p>${direct?'شراء مباشر بدون مورد':`المورد: ${esc(supplier?.name||'—')}`}</p>
          ${successor?`<div class="notice green">هذه نسخة سابقة مصححة؛ <a href="#/purchase/${esc(successor.replacement_invoice_id)}">افتح الفاتورة الجديدة</a>.</div>`:''}
        </div>
        <div class="page-head-actions">
          <a class="btn secondary purchase-to-images-v108" href="#/images">الإدخال بالصور</a>
          ${editable?'<button class="btn secondary edit-invoice-v119">تعديل بيانات الفاتورة</button><button class="btn edit-lines-v120" type="button">تعديل بنود الفاتورة</button>':''}
          ${draft?'<button class="btn secondary delete-draft-detail">حذف المسودة</button>':''}
          ${posted&&!invoice.is_ameen_legacy_v029?'<button class="btn danger-btn void-posted-detail">إلغاء الفاتورة</button>':''}
        </div>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <div class="kv">
            <div class="k">التاريخ</div><div>${dateOnly(invoice.invoice_date||invoice.occurred_at)}</div>
            <div class="k">المورد</div><div>${direct?'بدون مورد':esc(supplier?.name||'—')}</div>
            <div class="k">الحالة</div><div>${invoiceStatus(invoice)}</div>
            <div class="k">العملة</div><div>${esc(currencyLabel(invoice.currency_code||'SYP'))}</div>
            <div class="k">مجموع البنود قبل الخصم</div><div>${money(totals.subtotal,invoice.currency_code||'SYP')}</div>
            <div class="k">مجموع الخصومات</div><div>${money(totals.discounts,invoice.currency_code||'SYP')}</div>
            <div class="k">الإجمالي النهائي</div><div><strong>${money(invoice.is_voided?(invoice.voided_original_total||0):(invoice.total_original??totals.total),invoice.currency_code||'SYP')}</strong></div>
          </div>
          ${invoice.is_voided?`<div class="notice rose compact-notice">أُلغيت هذه الفاتورة وتم تسجيل حركة عكسية للمخزون.${invoice.void_reason?` السبب: ${esc(invoice.void_reason)}`:''}</div>`:''}
        </div>
        <div class="card">
          <h3>إدخال الفاتورة</h3>
          <p>أضف بندًا يدويًا، اختر من مواد هذا المورد السابقة، أو حلّل صورة الفاتورة بالذكاء الاصطناعي.</p>
          <div class="quick-actions purchase-actions">
            <a class="btn secondary purchase-to-images-v108" href="#/images">الانتقال إلى الصور</a>
            <button class="btn add" ${!editable?'disabled':''}>إضافة مادة</button>
            <button class="btn secondary reuse" ${!editable||direct?'disabled':''}>مواد هذا المورد</button>
            <button class="btn secondary ocr" ${!draft?'disabled':''}>تحليل صورة الفاتورة</button>
            <input type="file" class="ocr-file" accept="image/*" hidden>
            <button class="btn soft post" ${!draft||!items.length?'disabled':''}>نشر الفاتورة</button>
          </div>
          ${posted?'<small class="action-hint">تعديل فاتورة منشورة ينشئ نسخة مصححة موثقة ويعكس أثر النسخة القديمة؛ وتبقى أي دفعات مسجلة محفوظة إذا سمحت المطابقة المالية بذلك.</small>':''}
          ${direct?'<small class="action-hint">اقتراحات المورد تظهر فقط عندما تكون الفاتورة مرتبطة بمورد حقيقي.</small>':''}
          ${pendingAi.length?`<div class="ai-inline-card processing"><strong>جاري تحليل ${pendingAi.length} صورة</strong><span>يمكنك مغادرة الصفحة ومتابعة العمل. سنحفظ النتيجة وننبهك عند اكتمالها.</span></div>`:''}
          ${latestReadyAi?`<div class="ai-inline-card ready"><strong>نتيجة تحليل جاهزة</strong><span>${esc(latestReadyAi.public_message||'تم تحليل الصورة.')}</span><button type="button" class="mini-action review-ai-result" data-job="${esc(latestReadyAi.id)}">مراجعة النتيجة</button></div>`:''}
        </div>
      </div>
      <div style="height:16px"></div>
      <div class="card">
        <h3>البنود</h3>
        ${items.length?`
          <div class="table-wrap table-fit">
            <table class="table purchase-items-table">
              <thead><tr><th>المادة</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>إجمالي البند</th>${editable?'<th>إجراء</th>':''}</tr></thead>
              <tbody>${items.map(x=>`
                <tr>
                  <td>${esc(mm[String(x.material_id)]?.name||x.material_id)}</td>
                  <td>${esc(unitLabel(um[String(x.purchase_unit_id)]?.code||um[String(x.purchase_unit_id)]?.name||'—'))}</td>
                  <td>${esc(x.quantity_purchase_unit??x.quantity_base??'—')}</td>
                  <td>${money(x.unit_price_original||0,invoice.currency_code||'SYP')}</td>
                  <td>${money(x.line_discount_original||0,invoice.currency_code||'SYP')}</td>
                  <td><strong>${money(purchaseLineTotalV119(x),invoice.currency_code||'SYP')}</strong></td>
                  ${editable?`<td class="row-actions"><button class="mini-action edit-item" data-item="${esc(x.id)}">تعديل</button><button class="mini-action danger delete-item" data-item="${esc(x.id)}">حذف</button></td>`:''}
                </tr>`).join('')}</tbody>
              <tfoot><tr class="purchase-total-row-v119"><td colspan="5">الإجمالي بعد الخصومات</td><td><strong>${money(totals.total,invoice.currency_code||'SYP')}</strong></td>${editable?'<td></td>':''}</tr></tfoot>
            </table>
          </div>`:
          '<div class="empty"><strong>لا توجد بنود</strong><div>أضف مواد الفاتورة قبل النشر.</div></div>'}
      </div>`;

    root.querySelector('.add')?.addEventListener('click',()=>addItem(root,id,mats,units,invoice.currency_code||'SYP',{invoice,items}));
    root.querySelector('.reuse')?.addEventListener('click',()=>openSupplierCatalogDialog(root,{invoice,items,mats,units,supplier}));
    root.querySelector('.edit-invoice-v119')?.addEventListener('click',()=>editInvoiceHeaderV119(root,{invoice,items,allSup}));
    root.querySelector('.edit-lines-v120')?.addEventListener('click',()=>openInvoiceLineEditorV120(root,{invoice,items,mats,units}));
    if(editable&&sessionStorage.getItem('maria_open_invoice_line_editor_v120')===String(id)){
      sessionStorage.removeItem('maria_open_invoice_line_editor_v120');
      setTimeout(()=>openInvoiceLineEditorV120(root,{invoice,items,mats,units}),0);
    }
    if(draft&&!direct&&sessionStorage.getItem('maria_open_supplier_catalog_v119')===String(id)){
      sessionStorage.removeItem('maria_open_supplier_catalog_v119');
      setTimeout(()=>openSupplierCatalogDialog(root,{invoice,items,mats,units,supplier}),0);
    }
    const ocrFile=root.querySelector('.ocr-file');
    root.querySelector('.ocr')?.addEventListener('click',()=>ocrFile?.click());
    ocrFile?.addEventListener('change',async()=>{
      const file=ocrFile.files?.[0];
      if(!file) return;
      try{await queuePurchaseOcr(root,{file,invoice,supplier});}
      finally{ocrFile.value='';}
    });

    root.querySelector('.review-ai-result')?.addEventListener('click',()=>{
      const job=aiJobs.find(j=>String(j.id)===String(root.querySelector('.review-ai-result')?.dataset.job));
      if(job?.result_json) openPurchaseOcrReview(root,{result:job.result_json,job,invoice,mats,units,supplier});
    });

    const pendingOpen=sessionStorage.getItem('maria_ai_job_to_open');
    if(pendingOpen){
      const job=aiJobs.find(j=>String(j.id)===String(pendingOpen));
      if(job?.job_type==='purchase_ocr' && job?.result_json){
        sessionStorage.removeItem('maria_ai_job_to_open');
        setTimeout(()=>openPurchaseOcrReview(root,{result:job.result_json,job,invoice,mats,units,supplier}),0);
      }
    }

    root.querySelectorAll('.edit-item').forEach(b=>b.onclick=()=>{
      const item=items.find(x=>String(x.id)===String(b.dataset.item));
      if(item) editPurchaseItem(root,{invoice,item,items,mats,units});
    });
    root.querySelectorAll('.delete-item').forEach(b=>b.onclick=async()=>{
      if(!(await confirmBox(invoice.status==='posted'?'سيتم إنشاء نسخة مصححة من الفاتورة وعكس أثر البند القديم على المخزون. متابعة؟':'حذف هذا البند من المسودة؟','حذف البند'))) return;
      try{
        if(posted)await saveInvoiceRevisionV120(root,invoice,items.filter(x=>String(x.id)!==String(b.dataset.item)),{},'حذف بند');
        else{await api.deletePurchaseItem(b.dataset.item);toast('تم حذف البند','success');await renderPurchaseDetail(root,id);}
      }
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
    if(!catalog.length){toast('لا توجد مواد سابقة لهذا المورد، اختر مادة جديدة لهذه الفاتورة.');addItem(root,invoice.id,mats,units,invoice.currency_code||'SYP',{invoice,items});return;}
    const existing=new Set(items.map(x=>String(x.material_id)));
    const prepared=[];
    for(const row of catalog){
      const material=mats.find(m=>String(m.id)===String(row.material_id));
      if(!material) continue;
      const choices=await materialUnitChoices(material,units);
      if(!choices.length) continue;
      prepared.push({...row,material,choices,already:existing.has(String(row.material_id))});
    }
    if(!prepared.length){
      toast('مواد هذا المورد السابقة غير متاحة بوحدات شراء صالحة؛ أضف المادة يدويًا.');
      addItem(root,invoice.id,mats,units,invoice.currency_code||'SYP',{invoice,items});
      return;
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
          const pending=[];
          for(const {r,i} of selected){
            pending.push({material_id:r.material_id,purchase_unit_id:fd.get(`unit_${i}`),
              quantity:Number(fd.get(`qty_${i}`)),unit_price:Number(fd.get(`price_${i}`)),
              discount:Number(fd.get(`discount_${i}`)||0)});
          }
          await saveInvoiceRevisionV120(root,invoice,[...revisionLinesV119(items),...pending],{},'إضافة مواد من سجل المورد');
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

// One safe operation for editing all invoice lines, even after posting. Each
// material change loads its correct purchase units; the server publishes one
// corrected invoice and reverses only the previous inventory movements.
async function openInvoiceLineEditorV120(root,{invoice,items,mats,units}){
  const allMaterials=mats.filter(m=>m.is_active!==false);
  const knownMaterials=new Map(mats.map(m=>[String(m.id),m]));
  if(!allMaterials.length){toast('لا توجد مواد متاحة في القائمة.','error');return;}
  const notes=new Map();let seq=0,unitLoads=0;
  const options=selected=>mats.map(m=>`<option value="${esc(m.id)}" ${String(m.id)===String(selected)?'selected':''}>${esc(m.name)}</option>`).join('');
  const newMarkup=(line,key)=>`<div class="purchase-bulk-row-v120" data-line-key="${esc(key)}">
      <div class="field"><label>المادة</label><select data-v120-material required>${options(line.material_id)}</select></div>
      <div class="field"><label>الوحدة</label><select data-v120-unit required></select></div>
      <div class="field"><label>الكمية</label><input data-v120-qty type="number" min="0.000001" step="any" value="${esc(line.quantity??1)}" required></div>
      <div class="field"><label>سعر الوحدة</label><input data-v120-price type="number" min="0" step="any" value="${esc(line.unit_price??0)}" required></div>
      <div class="field"><label>الخصم</label><input data-v120-discount type="number" min="0" step="any" value="${esc(line.discount??0)}"></div>
      <div class="purchase-bulk-row-actions-v120"><strong data-v120-total>—</strong><button type="button" class="mini-action danger" data-v120-remove>حذف</button></div>
    </div>`;
  const existing=revisionLinesV119(items);
  const m=modal({
    title:'تعديل جميع بنود فاتورة الشراء',wide:true,
    subtitle:invoice.status==='posted'?'حتى بعد النشر، احفظ التعديلات مرة واحدة وسيُنشأ تصحيح موثق دون حذف تاريخ المخزون.':'عدّل أي مادة أو وحدة أو كمية أو سعر، وأضف أو احذف بنودًا.',
    body:`<div class="notice">تعديل فاتورة منشورة يحفظ النسخة القديمة للتدقيق، وينقل الدفعات فقط إذا سمحت المطابقة المالية. لا يتم تغيير أي قيمة قبل الضغط على الحفظ.</div>
      <div class="purchase-bulk-list-v120" data-v120-list>${existing.map((x,i)=>{const key='old-'+i;notes.set(key,x.notes);return newMarkup(x,key);}).join('')}</div>
      <div class="quick-actions"><button class="btn secondary" type="button" data-v120-add>+ إضافة مادة للفاتورة</button></div>
      <div class="purchase-bulk-summary-v120"><span>الإجمالي بعد الخصومات</span><strong data-v120-grand-total>—</strong></div>`,
    submitText:'حفظ البنود وتحديث الفاتورة',
    onSubmit:async()=>{
      if(unitLoads){toast('اكتمل تحميل الوحدات أولًا ثم حاول الحفظ.','error');return false;}
      const lines=[...m.form.querySelectorAll('[data-line-key]')].map(row=>({
        material_id:row.querySelector('[data-v120-material]').value,
        purchase_unit_id:row.querySelector('[data-v120-unit]').value,
        quantity:Number(row.querySelector('[data-v120-qty]').value),
        unit_price:Number(row.querySelector('[data-v120-price]').value),
        discount:Number(row.querySelector('[data-v120-discount]').value||0),
        notes:notes.get(row.dataset.lineKey)||null,
      }));
      const check=validatePurchaseRevisionLinesV120(lines,{posted:invoice.status==='posted'});
      if(!check.valid){toast(friendlyError(new Error(check.code),'تأكد من الكميات والأسعار والخصومات ووحدات الشراء.'),'error');return false;}
      try{await saveInvoiceRevisionV120(root,invoice,lines,{},'تصحيح بنود متعدد v1.0.20');return true;}
      catch(error){toast(friendlyError(error,'تعذر حفظ تصحيح البنود. لا تغييرات جزئية عند فشل المعاملة.'),'error');return false;}
    },
  });
  const list=m.form.querySelector('[data-v120-list]');
  const grand=m.form.querySelector('[data-v120-grand-total]');
  const refreshTotals=()=>{
    let sum=0;
    list.querySelectorAll('[data-line-key]').forEach(row=>{
      const q=Number(row.querySelector('[data-v120-qty]').value||0),
        price=Number(row.querySelector('[data-v120-price]').value||0),
        disc=Number(row.querySelector('[data-v120-discount]').value||0);
      const total=q*price-disc;sum+=total;
      row.querySelector('[data-v120-total]').textContent=money(total,invoice.currency_code||'SYP');
    });
    grand.textContent=money(sum,invoice.currency_code||'SYP');
  };
  const fillUnits=async(row,desired=null)=>{
    const select=row.querySelector('[data-v120-unit]');
    const material=knownMaterials.get(String(row.querySelector('[data-v120-material]').value));
    const marker=String((Number(row.dataset.unitVersion)||0)+1);row.dataset.unitVersion=marker;
    select.disabled=true;unitLoads++;
    try{
      const choices=material?await materialUnitChoices(material,units):[];
      if(!m.element.isConnected || row.dataset.unitVersion!==marker)return;
      select.innerHTML=choices.map(c=>`<option value="${esc(c.unitId)}">${esc(c.label)}</option>`).join('');
      if(desired&&choices.some(c=>String(c.unitId)===String(desired)))select.value=String(desired);
      if(!choices.length)toast('المادة المختارة لا تملك وحدة شراء؛ أضف وحدة أو تحويلًا من صفحة المواد.','error');
    }catch(e){toast(friendlyError(e,'تعذر جلب الوحدات لهذه المادة.'),'error');select.replaceChildren();}
    finally{unitLoads--;if(m.element.isConnected&&row.dataset.unitVersion===marker)select.disabled=false;}
  };
  const bindRow=(row,preferred=null)=>{
    row.querySelector('[data-v120-material]').addEventListener('change',()=>fillUnits(row));
    row.querySelectorAll('input').forEach(input=>input.addEventListener('input',refreshTotals));
    row.querySelector('[data-v120-remove]').onclick=()=>{row.remove();refreshTotals();};
    void fillUnits(row,preferred);
  };
  [...list.querySelectorAll('[data-line-key]')].forEach((r,i)=>bindRow(r,existing[i]?.purchase_unit_id));
  m.form.querySelector('[data-v120-add]').onclick=()=>{
    const key='new-'+(++seq),line={material_id:String(allMaterials[0].id),quantity:1,unit_price:0,discount:0};
    list.insertAdjacentHTML('beforeend',newMarkup(line,key));
    bindRow(list.lastElementChild);refreshTotals();
  };
  refreshTotals();
}

async function editPurchaseItem(root,{invoice,item,items,mats,units}){
  const material=mats.find(m=>String(m.id)===String(item.material_id));
  if(!material)return;
  try{
    const allowed=await materialUnitChoices(material,units);
    const m=modal({
      title:`تعديل بند الفاتورة — ${material.name}`,
      subtitle:invoice.status==='posted'?'التعديل متاح بعد النشر. سيُسجّل إصدار مصحح مع عكس مخزون النسخة السابقة.':'يمكن تغيير المادة نفسها أو وحدتها أو الكمية أو السعر أو الخصم.',
      body:`<div class="form-grid">
        <div class="field full"><label>المادة</label><select name="material" required>${mats.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(item.material_id)?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label>الوحدة</label><select name="unit" required>${allowed.map(c=>`<option value="${esc(c.unitId)}" ${String(c.unitId)===String(item.purchase_unit_id)?'selected':''}>${esc(c.label)}</option>`).join('')}</select></div>
        <div class="field"><label>الكمية</label><input name="qty" type="number" step="any" min="0.000001" value="${esc(item.quantity_purchase_unit??item.quantity_base??1)}" required></div>
        <div class="field"><label>سعر الوحدة</label><input name="price" type="number" step="any" min="0" value="${esc(item.unit_price_original??0)}" required></div>
        <div class="field"><label>الخصم</label><input name="discount" type="number" step="any" min="0" value="${esc(item.line_discount_original??0)}"></div>
        <div class="field full"><label>إجمالي البند بعد الخصم</label><strong class="purchase-live-line-total-v119">${money(purchaseLineTotalV119(item),invoice.currency_code||'SYP')}</strong></div>
      </div>`,
      submitText:'حفظ البند والتحديث',
      onSubmit:async fd=>{
        try{
          const changed={...item,material_id:String(fd.get('material')),
            purchase_unit_id:String(fd.get('unit')),quantity_purchase_unit:Number(fd.get('qty')),
            unit_price_original:Number(fd.get('price')),line_discount_original:Number(fd.get('discount')||0)};
          if(!(purchaseLineTotalV119(changed)>=0))throw Error('PURCHASE_REVISION_INVALID_LINE');
          await saveInvoiceRevisionV120(root,invoice,items.map(x=>String(x.id)===String(item.id)?changed:x),{},'تعديل بند');
          return true;
        }catch(e){toast(friendlyError(e,'تعذر تعديل البند.'),'error');return false;}
      },
    });
    const matSel=m.form.querySelector('[name="material"]'),unitSel=m.form.querySelector('[name="unit"]');
    matSel.onchange=async()=>{
      const selected=mats.find(x=>String(x.id)===matSel.value);
      if(!selected)return;
      unitSel.disabled=true;
      try{const choices=await materialUnitChoices(selected,units);
        unitSel.innerHTML=choices.map(x=>`<option value="${esc(x.unitId)}">${esc(x.label)}</option>`).join('');
      }catch(e){toast(friendlyError(e),'error');}finally{unitSel.disabled=false;}
    };
    const refresh=()=>{const qty=Number(m.form.querySelector('[name="qty"]').value||0);
      const price=Number(m.form.querySelector('[name="price"]').value||0);
      const disc=Number(m.form.querySelector('[name="discount"]').value||0);
      m.form.querySelector('.purchase-live-line-total-v119').textContent=money(qty*price-disc,invoice.currency_code||'SYP');
    };
    ['qty','price','discount'].forEach(n=>m.form.querySelector(`[name="${n}"]`).addEventListener('input',refresh));
  }catch(e){toast(friendlyError(e,'تعذر فتح تعديل البند.'),'error');}
}

async function editInvoiceHeaderV119(root,{invoice,items,allSup}){
  const supplier=allSup.find(x=>String(x.id)===String(invoice.supplier_id));
  const m=modal({
    title:'تعديل بيانات فاتورة الشراء',
    subtitle:invoice.status==='posted'?'سيتم استبدال النسخة المنشورة بنسخة صحيحة مرتبطة بسجل تصحيحات؛ لا تُحذف الحركات التاريخية.':'يمكنك تعديل المورد والتاريخ والرقم والعملة الآن.',
    body:`<div class="form-grid">
      ${supplierFieldV119({value:isDirectSupplier(supplier)?'':supplier?.name||'',label:'المورد (اختياري)'})}
      <div class="field"><label>رقم الفاتورة</label><input name="number" value="${esc(invoice.invoice_number||'')}"></div>
      <div class="field"><label>تاريخ الفاتورة</label><input name="date" type="date" required value="${esc(String(invoice.invoice_date||invoice.occurred_at||'').slice(0,10))}"></div>
      <div class="field"><label>العملة</label><select name="currency"><option value="SYP" ${invoice.currency_code==='SYP'?'selected':''}>ل.س</option><option value="USD" ${invoice.currency_code==='USD'?'selected':''}>USD</option></select></div>
      <div class="field full"><label>سبب التعديل (اختياري)</label><input name="reason" placeholder="مثال: تصحيح تاريخ أو اسم المورد"></div>
      <div class="notice field full">الانتقال لعملة أخرى لا يُحوّل أسعار البنود تلقائيًا. راجع أسعار الوحدات أولًا. الفاتورة ذات الدفعات المخصصة لا تسمح بتغيير المورد أو العملة.</div>
    </div>`,
    submitText:'حفظ الفاتورة والتحديث',
    onSubmit:async fd=>{
      try{
        const s=await api.findOrCreateSupplier(String(fd.get('supplier')||''));
        await saveInvoiceRevisionV120(root,invoice,items,{
          supplierId:s.id,invoiceNumber:String(fd.get('number')||''),
          invoiceDate:fd.get('date'),currency:fd.get('currency')},String(fd.get('reason')||'تصحيح بيانات الفاتورة'));
        return true;
      }catch(e){toast(friendlyError(e,'تعذر تعديل بيانات الفاتورة.'),'error');return false;}
    },
  });
  attachSupplierSuggestV119(m.form,allSup);
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
  return materialExactV106(name,mats) || null; // Never fuzzy-link an invoice to the wrong stock item.
}

async function queuePurchaseOcr(root,{file,invoice,supplier}){
  if(file.size>8*1024*1024){toast('حجم الصورة كبير. اختر صورة أقل من 8 MB.','error');return;}
  try{
    const base64=await fileToBase64(file);
    await api.enqueueDocumentOcr({
      jobType:'purchase_ocr',
      imageBase64:base64,
      mimeType:file.type||'image/jpeg',
      fileName:file.name||'',
      relatedEntityId:invoice.id,
      context:{
        supplier_name:isDirectSupplier(supplier)?'':supplier?.name||'',
        currency:invoice.currency_code||'SYP',
      },
    });
    toast('تم إرسال الصورة للتحليل. يمكنك متابعة العمل وسنخبرك عند وصول النتيجة.','success');
    await renderPurchaseDetail(root,invoice.id);
  }catch(e){
    toast(friendlyError(e,'تعذر إرسال الصورة للتحليل الآن.'),'error');
  }
}

async function openPurchaseOcrReview(root,{result,job=null,invoice,mats,units,supplier}){
  try{
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

    const detectedSupplier=String(result.supplier_name||(!isDirectSupplier(supplier)?supplier?.name:'')||'').trim();
    const detectedCurrency=['SYP','USD'].includes(String(result.currency||'').toUpperCase())?String(result.currency).toUpperCase():(invoice.currency_code||'SYP');
    const invoiceTotal=Number(result.invoice_total||0);

    const m=modal({
      title:'مراجعة تحليل الفاتورة',
      subtitle:'كل ما قرأه الذكاء الاصطناعي قابل للتعديل قبل الحفظ.',
      wide:true,
      body:`
        <div class="ocr-edit-summary">
          <div class="field compact"><label>المورد</label><input name="ocr_supplier" autocomplete="off" value="${esc(detectedSupplier)}" placeholder="اختياري"></div>
          <div class="field compact"><label>رقم الفاتورة</label><input name="ocr_number" autocomplete="off" value="${esc(result.invoice_number||invoice.invoice_number||'')}"></div>
          <div class="field compact"><label>التاريخ</label><input name="ocr_date" type="date" value="${esc(result.invoice_date||invoice.invoice_date||'')}"></div>
          <div class="field compact"><label>العملة</label><select name="ocr_currency"><option value="SYP" ${detectedCurrency==='SYP'?'selected':''}>ل.س</option><option value="USD" ${detectedCurrency==='USD'?'selected':''}>USD</option></select></div>
          <div class="field compact"><label>إجمالي الفاتورة المقروء <span class="optional-badge">اختياري</span></label><input name="ocr_invoice_total" type="number" step="any" min="0" value="${invoiceTotal>0?esc(invoiceTotal):''}" placeholder="غير ظاهر"></div>
        </div>
        <div class="ocr-review-note">راجع اسم المادة والأرقام خصوصًا في الفواتير المكتوبة بخط اليد. يمكن تعديل أي قيمة هنا مباشرة.</div>
        <div class="ocr-items-list">
          ${rows.map((r,i)=>{
            const qty=Number(r.raw.quantity||0);
            const price=Number(r.raw.unit_price??r.raw.price??0);
            const total=Number(r.raw.line_total||0) || ((qty>0&&price>=0)?qty*price:0);
            return `
            <div class="ocr-item-row-v11 ${r.material?'':'needs-review'}" data-ocr-row="${i}">
              <div class="ocr-pick-cell">
                <label class="catalog-material-check"><input type="checkbox" name="pick_${i}" ${r.material?'checked':'disabled'}><span><strong>اعتماد البند</strong><small>${r.material?`مطابقة حالية: ${esc(r.material.name)}`:'اختر المادة المرتبطة أولًا'}</small></span></label>
              </div>
              <div class="field compact"><label>اسم المادة المقروء</label><input name="raw_name_${i}" autocomplete="off" value="${esc(r.raw.name||r.raw.material_name||'')}"></div>
              <div class="field compact"><label>المادة في Maria CFO</label><select name="material_${i}"><option value="">اختر</option>${mats.map(mat=>`<option data-search="${esc(materialSearchTextV106(mat))}" value="${esc(mat.id)}" ${r.material&&String(mat.id)===String(r.material.id)?'selected':''}>${esc(mat.name)}${mat.quick_code||mat.code?` — ${esc(mat.quick_code||mat.code)}`:''}</option>`).join('')}</select></div>
              <div class="field compact"><label>الوحدة</label><select name="unit_${i}">${r.choices.map(c=>`<option value="${esc(c.unitId)}" ${r.preferred&&String(c.unitId)===String(r.preferred)?'selected':''}>${esc(c.label)}</option>`).join('')}</select></div>
              <div class="field compact"><label>الكمية</label><input name="qty_${i}" type="number" step="any" min="0.000001" value="${esc(qty||1)}"></div>
              <div class="field compact"><label>سعر الوحدة</label><input name="price_${i}" type="number" step="any" min="0" value="${esc(price||0)}"></div>
              <div class="field compact"><label>إجمالي البند</label><input name="total_${i}" type="number" step="any" min="0" value="${esc(total||0)}"></div>
            </div>`;
          }).join('')}
        </div>
        <div class="ocr-total-check"><span>إجمالي البنود المحددة</span><strong data-ocr-selected-total>0</strong></div>`,
      submitText:'حفظ البيانات وإضافة البنود',
      onSubmit:async fd=>{
        const selected=[];
        rows.forEach((r,i)=>{if(fd.get(`pick_${i}`)) selected.push({r,i});});
        if(!selected.length){toast('حدد بندًا واحدًا على الأقل.');return false;}
        try{
          const date=String(fd.get('ocr_date')||invoice.invoice_date||'').trim();
          await api.updatePurchaseDraftFromOcr({
            invoiceId:invoice.id,
            supplierName:String(fd.get('ocr_supplier')||''),
            invoiceNumber:String(fd.get('ocr_number')||''),
            invoiceDate:date||invoice.invoice_date,
            currency:String(fd.get('ocr_currency')||invoice.currency_code||'SYP'),
          });

          let computedTotal=0;
          for(const {i} of selected){
            const materialId=String(fd.get(`material_${i}`)||'');
            const unitId=String(fd.get(`unit_${i}`)||'');
            const quantity=Number(fd.get(`qty_${i}`)||0);
            let unitPrice=Number(fd.get(`price_${i}`)||0);
            const lineTotal=Number(fd.get(`total_${i}`)||0);
            if(!materialId||!unitId) throw new Error('OCR_ITEM_NEEDS_REVIEW');
            if(!(quantity>0)) throw new Error('OCR_ITEM_NEEDS_REVIEW');
            if(!(unitPrice>0) && lineTotal>0) unitPrice=lineTotal/quantity;
            computedTotal+=quantity*unitPrice;
            await api.addPurchaseItem({
              invoiceId:invoice.id,
              materialId,
              purchaseUnitId:unitId,
              quantity,
              unitPrice,
              discount:0,
            });
          }
          const readTotal=Number(fd.get('ocr_invoice_total')||0);
          if(readTotal>0 && Math.abs(computedTotal-readTotal)>Math.max(1,readTotal*0.01)){
            toast('تمت إضافة البنود. إجمالي البنود لا يطابق تمامًا إجمالي الفاتورة المقروء؛ راجعه قبل النشر.');
          }else{
            toast(`تم حفظ بيانات الفاتورة وإضافة ${selected.length} بند`,'success');
          }
          if(job?.id) await api.markAiJobSeen(job.id).catch(()=>{});
          await renderPurchaseDetail(root,invoice.id);
          return true;
        }catch(e){toast(friendlyError(e,'تعذر حفظ بعض البيانات أو البنود المستخرجة.'),'error');return false;}
      },
    });

    const updateSelectedTotal=()=>{
      let total=0;
      rows.forEach((_,i)=>{
        const row=m.form.querySelector(`[data-ocr-row="${i}"]`);
        const pick=row?.querySelector(`[name="pick_${i}"]`);
        if(!pick?.checked) return;
        const qty=Number(row.querySelector(`[name="qty_${i}"]`)?.value||0);
        const price=Number(row.querySelector(`[name="price_${i}"]`)?.value||0);
        const line=Number(row.querySelector(`[name="total_${i}"]`)?.value||0);
        total+=line>0?line:qty*price;
      });
      const target=m.form.querySelector('[data-ocr-selected-total]');
      if(target) target.textContent=`${Number(total.toFixed(4)).toLocaleString('en-US')} ${currencyLabel(m.form.querySelector('[name="ocr_currency"]')?.value||'SYP')}`;
    };

    rows.forEach((r,i)=>{
      const row=m.form.querySelector(`[data-ocr-row="${i}"]`);
      const nameInput=row?.querySelector(`[name="raw_name_${i}"]`);
      const materialSel=row?.querySelector(`[name="material_${i}"]`);
      const unitSel=row?.querySelector(`[name="unit_${i}"]`);
      const pick=row?.querySelector(`[name="pick_${i}"]`);
      const qty=row?.querySelector(`[name="qty_${i}"]`);
      const price=row?.querySelector(`[name="price_${i}"]`);
      const line=row?.querySelector(`[name="total_${i}"]`);

      const refreshMaterialState=async()=>{
        const material=mats.find(x=>String(x.id)===String(materialSel.value));
        if(!material){
          unitSel.innerHTML='';
          pick.checked=false;pick.disabled=true;row.classList.add('needs-review');
          updateSelectedTotal();
          return;
        }
        const choices=await materialUnitChoices(material,units);
        unitSel.innerHTML=choices.map(c=>`<option value="${esc(c.unitId)}">${esc(c.label)}</option>`).join('');
        pick.disabled=false;pick.checked=true;row.classList.remove('needs-review');
        const rawUnit=String(r.raw.unit||'').trim();
        if(rawUnit){
          const u=api.findUnitByText(rawUnit,units);
          if(u && choices.some(c=>String(c.unitId)===String(u.id))) unitSel.value=String(u.id);
        }
        updateSelectedTotal();
      };

      materialSel?.addEventListener('change',refreshMaterialState);
      nameInput?.addEventListener('change',async()=>{
        const matched=bestMaterialMatch(nameInput.value,mats);
        if(matched){materialSel.value=matched.id;await refreshMaterialState();}
      });
      pick?.addEventListener('change',updateSelectedTotal);
      qty?.addEventListener('input',()=>{
        const q=Number(qty.value||0),p=Number(price.value||0);
        if(q>=0&&p>=0) line.value=Number((q*p).toFixed(4));
        updateSelectedTotal();
      });
      price?.addEventListener('input',()=>{
        const q=Number(qty.value||0),p=Number(price.value||0);
        if(q>=0&&p>=0) line.value=Number((q*p).toFixed(4));
        updateSelectedTotal();
      });
      line?.addEventListener('input',()=>{
        const q=Number(qty.value||0),t=Number(line.value||0);
        if(q>0&&t>=0) price.value=Number((t/q).toFixed(6));
        updateSelectedTotal();
      });
    });
    m.form.querySelector('[name="ocr_currency"]')?.addEventListener('change',updateSelectedTotal);
    updateSelectedTotal();
  }catch(e){
    toast(friendlyError(e,'تعذر فتح نتيجة تحليل الفاتورة.'),'error');
  }
}

function normalizeName(value){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
}

function addItem(root,id,mats,units,currency='SYP',context=null){
  const unitListId=`purchase-material-base-units-${Date.now()}`;
  const materialOptions=()=>mats.length
    ? mats.map(x=>`<option data-search="${esc(materialSearchTextV106(x))}" value="${esc(x.id)}">${esc(x.name)}${x.quick_code||x.code?` — ${esc(x.quick_code||x.code)}`:''}</option>`).join('')
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
            <span class="input-suffix" data-price-suffix>${esc(currencyLabel(currency))} / الوحدة</span>
          </div>
        </div>
        <div class="field">
          <label>خصم السطر</label>
          <input name="discount" type="number" step="any" min="0" value="0" autocomplete="off">
        </div>
        <div class="field full"><label>إجمالي البند بعد الخصم</label>
          <strong class="purchase-live-line-total-v119">${money(0,currency)}</strong>
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
        if(context){
          const newLine={material_id:materialId,purchase_unit_id:unitId,
            quantity:Number(fd.get('qty')),unit_price:Number(fd.get('price')),
            discount:Number(fd.get('discount')||0)};
          await saveInvoiceRevisionV120(root,context.invoice,[...revisionLinesV119(context.items),newLine],{},'إضافة بند');
        }else{
          await api.addPurchaseItem({invoiceId:id,materialId,purchaseUnitId:unitId,
            quantity:fd.get('qty'),unitPrice:fd.get('price'),discount:fd.get('discount')||0});
          toast('تمت إضافة البند','success');await renderPurchaseDetail(root,id);
        }
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
  const refreshAddedLineTotal=()=>{
    const qty=Number(m.form.querySelector('[name="qty"]')?.value||0);
    const price=Number(m.form.querySelector('[name="price"]')?.value||0);
    const discount=Number(m.form.querySelector('[name="discount"]')?.value||0);
    const output=m.form.querySelector('.purchase-live-line-total-v119');
    if(output)output.textContent=money(qty*price-discount,currency);
  };
  ['qty','price','discount'].forEach(name=>m.form.querySelector(`[name="${name}"]`)?.addEventListener('input',refreshAddedLineTotal));
  const panel=m.form.querySelector('[data-new-material-panel]');
  const toggle=m.form.querySelector('.new-material-toggle');
  const nameInput=m.form.querySelector('[name="new_material_name"]');
  const baseUnitInput=m.form.querySelector('[name="new_material_unit"]');
  const warning=m.form.querySelector('[data-duplicate-warning]');
  const createBtn=m.form.querySelector('.create-material-inline');

  const findDuplicate=()=>{
    const wanted=nameInput.value.trim();
    if(!wanted)return null;
    return materialExactV106(wanted,mats);
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
      priceSuffix.textContent=`${currencyLabel(currency)} / الوحدة`;
      return;
    }
    const choices=await materialUnitChoices(material,units);
    unitSel.innerHTML=choices.map(x=>`<option value="${esc(x.unitId)}">${esc(x.label)}</option>`).join('');
    if(preferred && choices.some(x=>String(x.unitId)===String(preferred))) unitSel.value=preferred;
    const label=unitSel.options[unitSel.selectedIndex]?.textContent?.trim()||'الوحدة';
    priceSuffix.textContent=`${currencyLabel(currency)} / ${label}`;
  };

  const selectMaterial=async material=>{
    let option=[...materialSel.options].find(o=>String(o.value)===String(material.id));
    if(!option){
      option=document.createElement('option');
      option.value=material.id;
      option.dataset.search=materialSearchTextV106(material);
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
      if(isVagueContextualName(unitText)){
        toast('اختر وحدة مخزون أساسية مثل غرام أو قطعة، وأضف الملاعق والأكياس الخاصة من تحويلات المادة.','error');
        return;
      }
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
    priceSuffix.textContent=`${currencyLabel(currency)} / ${label}`;
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

