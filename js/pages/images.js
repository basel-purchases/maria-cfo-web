import * as api from '../api.js?v=0.19';
import { esc, unitDisplay, todayISO } from '../utils.js?v=0.19';
import { toast, loader, friendlyError, confirmBox } from '../ui.js?v=0.19';
import { newLocalDocument, saveLocalImage, deleteLocalImage, listLocalImages } from '../image-local-store.js?v=0.19';
import { recognizeLocalImage } from '../image-local-ocr.js?v=0.19';
import { parseOcrLines,autofillExactCatalog,validateImageDocument,localStatus } from '../image-document-rules.js?v=0.19';

const VALID_IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp']);
const MAX_IMAGE_BYTES=12*1024*1024;
const statusClass={
  'غير معالج':'grey','يحتاج استكمال':'yellow','جاهز للنشر':'green',
  'مسودة داخل البرنامج':'purple','منشور':'green','مراجعة نتيجة العملية':'red',
};
const catalogOptions=(items,chosen='',emptyLabel='— اختر —')=>
  `<option value="">${esc(emptyLabel)}</option>`+items.map(x=>`<option value="${esc(x.id)}" ${String(chosen)===String(x.id)?'selected':''}>${esc(x.name)}</option>`).join('');

export async function renderImages(root){
  root.innerHTML=loader();
  let records=[];
  let currentId=null;
  let processing=false;
  const selected=new Set();
  let previewUrls=[];
  let catalog={menu:[],materials:[],units:[],materialLinks:[],cashboxes:[]};
  let catalogError='';
  try{records=await listLocalImages();}
  catch(error){root.innerHTML=`<div class="notice rose">تعذر فتح التخزين المحلي للصور: ${esc(error.message||'')} — جرّب المتصفح بوضع عادي والسماح بالتخزين المحلي.</div>`;return;}
  currentId=records[0]?.id||null;
  const results=await Promise.allSettled([
    api.menuItems(),api.materials(),api.units(),api.allMaterialUnitLinks(),api.cashboxes(),
  ]);
  ['menu','materials','units','materialLinks','cashboxes'].forEach((key,i)=>{
    if(results[i].status==='fulfilled')catalog[key]=results[i].value;
    else catalogError='تعذر تحميل بعض قوائم Supabase. يمكنك معالجة الصور محليًا، لكن تأكد من الاتصال قبل إضافة المستندات.';
  });
  const getCurrent=()=>records.find(r=>r.id===currentId);
  const statusOf=doc=>localStatus(doc,validateImageDocument(doc,catalog));
  const isReady=doc=>doc.status!=='published'&&doc.status!=='uncertain'&&validateImageDocument(doc,catalog).ready;
  const targets=()=>{
    const list=selected.size?records.filter(x=>selected.has(x.id)):records;
    return list.filter(doc=>doc.status!=='published'&&doc.status!=='uncertain');
  };
  function revoke(){previewUrls.forEach(url=>URL.revokeObjectURL(url));previewUrls=[];}
  function objectUrl(file){const url=URL.createObjectURL(file);previewUrls.push(url);return url;}
  const refresh=()=>{
    if(!root.isConnected){revoke();return;}
    revoke();
    const current=getCurrent();
    const eligible=targets().filter(isReady).length;
    root.innerHTML=`
      <div class="page-head image-page-head"><div><h2>الصور — إدخال سريع</h2><p>احتفظ بالصور على جهازك، استخرج العربية والإنجليزية محليًا، ثم راجع الحقول قبل إضافتها إلى البرنامج.</p></div></div>
      <div class="notice image-privacy-notice"><strong>الخصوصية:</strong> الصور والنتائج تحفظ في هذا المتصفح فقط (IndexedDB). لا تُرفع الصور إلى Supabase. مسودات الأوردرات والفواتير المعتمدة تُرسل كبيانات عند اختيار «إضافة» أو «نشر». فقدان بيانات المتصفح يحذف صورك المحلية. يحتاج محرك OCR إنترنت لأول تنزيل لملفات اللغة.</div>
      ${catalogError?`<div class="notice rose">${esc(catalogError)}</div>`:''}
      <div class="card image-toolbar">
        <div class="image-toolbar-buttons">
          <label class="btn" for="images-pick">إضافة صور</label><input id="images-pick" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
          <button class="btn secondary" type="button" data-bulk-ocr="normal" ${processing?'disabled':''}>استخراج عادي ${selected.size?'للمحددة':'للجميع'}</button>
          <button class="btn secondary" type="button" data-bulk-ocr="accurate" ${processing?'disabled':''}>استخراج دقيق ${selected.size?'للمحددة':'للجميع'}</button>
          <button class="btn" type="button" data-bulk-post ${processing||!eligible?'disabled':''}>نشر الجاهزة (${eligible})</button>
        </div>
        <div class="metric-note">عند تحديد صور تُطبق الإجراءات عليها فقط، وإلا فتطبق على جميع غير المنشورة. غير المكتملة تبقى هنا للمراجعة.</div>
        <div id="image-progress" role="status" aria-live="polite"></div>
      </div>
      <div class="image-workspace">
        <aside class="card image-gallery">
          <div class="section-head-inline"><h3>الصور (${records.length})</h3><span class="muted-small">${selected.size} محددة</span></div>
          ${records.map(doc=>{
            const status=statusOf(doc);return `<div class="image-queue-item ${doc.id===currentId?'is-active':''}" data-open-image="${esc(doc.id)}">
              <label class="image-tick" title="تحديد للمعالجة"><input type="checkbox" data-select-image="${esc(doc.id)}" ${selected.has(doc.id)?'checked':''} aria-label="تحديد ${esc(doc.file_name)}"></label>
              <img src="${objectUrl(doc.file)}" alt="معاينة ${esc(doc.file_name)}" loading="lazy">
              <div class="image-queue-info"><strong title="${esc(doc.file_name)}">${esc(doc.file_name)}</strong><small>${doc.type==='purchase'?'فاتورة شراء':'أوردر'}</small><span class="image-status ${statusClass[status]||'grey'}">${esc(status)}</span></div>
            </div>`;
          }).join('')||'<div class="empty"><strong>لا توجد صور بعد</strong><p>أضف صورة واحدة أو مجموعة دفعة واحدة.</p></div>'}
        </aside>
        <section class="image-document-area">
          ${current?renderDocument(current):'<div class="card empty"><h3>ابدأ بإضافة الصور</h3><p>يمكنك تعبئة مستند يدويًا بعد رفع صورة، حتى لو لم يُستخرج منها نص.</p></div>'}
        </section>
      </div>`;
    wire();
  };

  function allowedUnits(row){
    const mat=catalog.materials.find(m=>String(m.id)===String(row.catalog_id));
    if(!mat)return [];
    const allow=new Set([String(mat.base_unit_id), ...catalog.materialLinks.filter(rel=>String(rel.material_id)===String(mat.id)).map(rel=>String(rel.unit_id))]);
    return catalog.units.filter(u=>allow.has(String(u.id))).map(u=>({id:u.id,name:unitDisplay(u)}));
  }
  function renderDocument(doc){
    const locked=doc.status==='published'||doc.status==='draft'||doc.status==='uncertain';
    const check=validateImageDocument(doc,catalog);
    const status=statusOf(doc);
    const names=doc.type==='purchase'?catalog.materials:catalog.menu;
    const htmlRows=(doc.items||[]).map((item,i)=>`
      <tr data-image-item="${i}">
        <td><input data-field="name" value="${esc(item.name||'')}" placeholder="الاسم كما في الصورة" aria-label="اسم البند ${i+1}"><small class="muted-small">${esc(item.raw_line||'')}</small></td>
        <td><select data-field="catalog_id" aria-label="ربط البند ${i+1}">${catalogOptions(names,item.catalog_id,doc.type==='purchase'?'— اختر مادة —':'— اختر وجبة —')}</select></td>
        ${doc.type==='purchase'?`<td><select data-field="unit_id" aria-label="وحدة شراء ${i+1}">${catalogOptions(allowedUnits(item),item.unit_id,'— وحدة —')}</select></td>`:''}
        <td><input data-field="quantity" type="number" step="any" min="0.00001" value="${esc(item.quantity??'')}" placeholder="الكمية"></td>
        <td><input data-field="unit_price" type="number" step="any" min="0.00001" value="${esc(item.unit_price??'')}" placeholder="السعر"></td>
        <td><input data-field="discount" type="number" step="any" min="0" ${doc.type==='order'?'max="100"':''} value="${esc(item.discount??'0')}" aria-label="${doc.type==='order'?'خصم نسبة مئوية':'خصم إجمالي السطر'}"></td>
        <td><button type="button" class="mini-btn danger-lite" data-remove-item="${i}" aria-label="حذف السطر">حذف</button></td>
      </tr>`).join('');
    return `<div class="card image-detail-card">
      <div class="section-head-inline"><div><h3>${esc(doc.file_name)}</h3><span class="image-status ${statusClass[status]||'grey'}">${esc(status)}</span></div><button type="button" class="mini-btn danger-lite" data-delete-image ${processing?'disabled':''}>حذف الصورة المحلية</button></div>
      ${doc.status==='uncertain'?`<div class="notice rose">${esc(doc.error||'تعذر التأكد من آخر عملية. راجع المستند في البرنامج قبل تكرار الإنشاء أو النشر.')} ${doc.server_id?`<a href="#/${doc.type==='purchase'?'purchase':'order'}/${esc(doc.server_id)}">افتح المستند الموجود</a>`:''}</div>`:''}
      <div class="image-document-grid">
        <div class="image-preview-pane"><div class="image-preview-frame"><img src="${objectUrl(doc.file)}" alt="صورة المستند الأصلية" draggable="false"></div><p class="metric-note">الصورة على اليمين، ويمكن تكبيرها من المتصفح. احتفظ بالأصل حتى تنتهي من المراجعة.</p></div>
        <div class="image-editor-pane">
          <fieldset ${locked?'disabled':''}>
            <div class="form-grid">
              <div class="field"><label>نوع الصورة</label><select data-doc="type"><option value="order" ${doc.type==='order'?'selected':''}>أوردر (افتراضي)</option><option value="purchase" ${doc.type==='purchase'?'selected':''}>فاتورة شراء</option></select></div>
              <div class="field"><label>التاريخ</label><input data-doc="date" type="date" value="${esc(doc.date||todayISO())}"></div>
              <div class="field"><label>العملة</label><select data-doc="currency"><option value="SYP" ${doc.currency==='SYP'?'selected':''}>SYP</option><option value="USD" ${doc.currency==='USD'?'selected':''}>USD</option></select></div>
              <div class="field"><label>رقم المستند (اختياري)</label><input data-doc="number" value="${esc(doc.number||'')}"></div>
              ${doc.type==='purchase'?`<div class="field full"><label>اسم المورد (اختياري)</label><input data-doc="supplier" value="${esc(doc.supplier||'')}"></div>`:
                `<div class="field full"><label>صندوق الأوردر (إلزامي للنشر)</label><select data-doc="cashbox_id">${catalogOptions(catalog.cashboxes.filter(c=>c.is_active!==false),doc.cashbox_id,'— اختر الصندوق —')}</select></div>`}
            </div>
            <div class="image-ocr-actions"><button type="button" class="btn secondary" data-ocr="normal">استخراج عادي</button><button type="button" class="btn secondary" data-ocr="accurate">استخراج دقيق</button><small>المطبوع أسرع. الدقيق يعيد القراءة بعد تحسين الصورة؛ الخط اليدوي يحتاج تصحيحًا بشريًا.</small></div>
            <div class="field"><label>النص المستخرج — قابل للتعديل</label><textarea data-doc="text" rows="6" placeholder="يمكنك إدخال النص بنفسك إذا تعذرت القراءة">${esc(doc.text||'')}</textarea></div>
            <button class="mini-btn" type="button" data-reparse>استخراج البنود من النص أعلاه</button>
            <div class="image-items-wrap"><h4>الأصناف والحقول</h4><p class="metric-note">اربط كل بند بمادة أو وجبة معروفة، وراجع الكمية والسعر. لا نخمن القيم المفقودة.</p>
              <div class="table-wrap"><table class="table image-items-table"><thead><tr><th>النص</th><th>${doc.type==='purchase'?'مادة':'وجبة'}</th>${doc.type==='purchase'?'<th>الوحدة</th>':''}<th>الكمية</th><th>سعر الوحدة</th><th>${doc.type==='purchase'?'خصم بالسعر':'خصم %'}</th><th>إجراء</th></tr></thead><tbody>${htmlRows||`<tr><td colspan="${doc.type==='purchase'?7:6}">لم تُضف بنودًا بعد.</td></tr>`}</tbody></table></div>
              <button type="button" class="btn secondary" data-add-item>إضافة بند يدوي</button>
            </div>
          </fieldset>
          ${check.ready?'<div class="notice sage">جميع الحقول الإلزامية مكتملة. راجع الصورة قبل النشر.</div>':`<div class="notice image-missing"><strong>للاستكمال:</strong> ${esc(check.problems.slice(0,7).join('، ')||'تحقق من البيانات')}</div>`}
          <div class="image-detail-actions">
            <button type="button" class="btn secondary" data-save-local ${locked||processing?'disabled':''}>حفظ محلي</button>
            <button type="button" class="btn secondary" data-save-draft ${locked||processing||!check.ready?'disabled':''}>إضافة للبرنامج كمسودة</button>
            <button type="button" class="btn" data-publish ${processing||!check.ready||doc.status==='published'||doc.status==='uncertain'?'disabled':''}>نشر في البرنامج</button>
          </div>
          ${doc.server_id?`<p class="metric-note">المستند داخل البرنامج: <a href="#/${doc.type==='purchase'?'purchase':'order'}/${esc(doc.server_id)}">فتح ${doc.type==='purchase'?'الفاتورة':'الأوردر'}</a></p>`:''}
        </div>
      </div>
    </div>`;
  }

  function syncEditor(){
    const doc=getCurrent();if(!doc || ['published','draft','uncertain'].includes(doc.status))return;
    const detail=root.querySelector('.image-detail-card');if(!detail)return;
    for(const input of detail.querySelectorAll('[data-doc]')) doc[input.dataset.doc]=input.value;
    doc.items=[...detail.querySelectorAll('[data-image-item]')].map((tr,i)=>({
      ...(doc.items[i]||{id:crypto.randomUUID()}),
      name:tr.querySelector('[data-field="name"]')?.value||'',
      catalog_id:tr.querySelector('[data-field="catalog_id"]')?.value||'',
      unit_id:tr.querySelector('[data-field="unit_id"]')?.value||'',
      quantity:tr.querySelector('[data-field="quantity"]')?.value||'',
      unit_price:tr.querySelector('[data-field="unit_price"]')?.value||'',
      discount:tr.querySelector('[data-field="discount"]')?.value||'0',
    }));
    if(doc.text||doc.items.length)doc.status='review';
  }
  async function saveCurrent(){syncEditor();const doc=getCurrent();if(doc)await saveLocalImage(doc);}
  const updateProgress=text=>{const el=root.querySelector('#image-progress');if(el)el.textContent=text;};

  async function extractOne(doc,mode){
    if(['draft','published','uncertain'].includes(doc.status))return 'تجاوز مستندًا أُضيف للبرنامج بالفعل.';
    const previous=doc.items?.length||0;
    if(previous && !(await confirmBox(`إعادة الاستخراج ستستبدل ${previous} بندًا مُعدّلًا محليًا في «${doc.file_name}». هل تريد المتابعة؟`,'إعادة الاستخراج')))return 'لم تتغير البيانات.';
    const result=await recognizeLocalImage(doc.file,{mode,onProgress:(step,percent)=>updateProgress(`${doc.file_name}: ${step} ${percent||0}%`)});
    doc.text=result.text;
    const parsed=parseOcrLines(result.text);
    const list=doc.type==='purchase'?catalog.materials:catalog.menu;
    doc.items=autofillExactCatalog(parsed,list).map(row=>({
      ...row, unit_id:doc.type==='purchase'
        ? (catalog.materials.find(m=>String(m.id)===String(row.catalog_id))?.base_unit_id||''):'',
    }));
    doc.ocr_mode=mode;doc.ocr_confidence=result.confidence;
    doc.status='review';doc.error=null;
    await saveLocalImage(doc);
    return parsed.length?`استُخرج ${parsed.length} سطرًا. راجع المطابقة والكميات والأسعار.`:'تمت القراءة، لكن تعذّر تحديد بنود كاملة. عدّل النص أو أضفها يدويًا.';
  }
  async function extractMany(docs,mode){
    if(processing)return;
    processing=true;
    let done=0,failed=0;
    for(const doc of docs){
      try{updateProgress(`معالجة ${++done} من ${docs.length}: ${doc.file_name}`);await extractOne(doc,mode);}
      catch(error){failed++;doc.error=String(error.message||error);await saveLocalImage(doc).catch(()=>{});toast(`تعذّر استخراج ${doc.file_name}: ${error.message||error}`,'error');}
    }
    processing=false;refresh();updateProgress(`انتهت معالجة ${done} صورة؛ تعذّر استخراج ${failed}. راجع النتائج قبل النشر.`);
  }
  async function createDraft(doc){
    const check=validateImageDocument(doc,catalog);
    if(!check.ready)throw new Error('أكمل الحقول أولًا: '+check.problems.join('، '));
    if(doc.server_id)throw new Error('هذه الصورة مرتبطة بمستند موجود. افتحه للتحقق بدل إنشاء نسخة ثانية.');
    doc.status='uncertain';doc.error='جاري إنشاء المسودة. لا تعِد الإرسال حتى تتضح النتيجة.';
    await saveLocalImage(doc);
    try{
      const id=doc.type==='purchase'
        ? await api.createPurchase({supplierName:doc.supplier,currency:doc.currency,invoiceNumber:doc.number||null,date:doc.date})
        : await api.createOrder({cashboxId:doc.cashbox_id,currency:doc.currency,number:doc.number||null,date:doc.date});
      doc.server_id=typeof id==='string'?id:(id?.id||id);
      doc.server_kind=doc.type;
      await saveLocalImage(doc);
      for(const item of check.prepared){
        if(doc.type==='purchase')await api.addPurchaseItem({invoiceId:doc.server_id,materialId:item.catalog_id,purchaseUnitId:item.unit_id,quantity:item.quantity,unitPrice:item.unit_price,discount:item.discount});
        else await api.addOrderItem({orderId:doc.server_id,menuItemId:item.catalog_id,quantity:item.quantity,unitPrice:item.unit_price,adjustmentType:item.discount>0?'percent':'none',adjustmentValue:item.discount,rawItemName:item.name});
      }
      doc.status='draft';doc.error=null;await saveLocalImage(doc);
      return doc.server_id;
    }catch(error){
      doc.error='تعذر التأكد من اكتمال المسودة. افتح المستند المرتبط (إن ظهر) وتحقق من بنوده؛ لا تعِد الإنشاء تلقائيًا. الخطأ: '+String(error.message||error);
      doc.status='uncertain';await saveLocalImage(doc);
      throw error;
    }
  }
  async function publishDoc(doc){
    if(doc.status==='published'||doc.status==='uncertain')return;
    if(!doc.server_id)await createDraft(doc);
    if(doc.status!=='draft')throw new Error('المسودة ليست جاهزة للنشر.');
    try{
      if(doc.type==='purchase')await api.postPurchase(doc.server_id);
      else await api.postOrder(doc.server_id);
      const actual=await api.one(doc.type==='purchase'?'purchase_invoices':'orders',doc.server_id);
      if(actual?.status!=='posted'||actual?.is_voided)throw new Error('POST_STATUS_NOT_CONFIRMED');
      doc.status='published';doc.error=null;await saveLocalImage(doc);
    }catch(error){
      doc.status='uncertain';
      doc.error='لا نعرف إن كان النشر قد اكتمل. افتح المستند في البرنامج للتحقق من حالته قبل أي إعادة محاولة. الخطأ: '+String(error.message||error);
      await saveLocalImage(doc);
      throw error;
    }
  }
  async function runProtected(task){
    if(processing)return;
    processing=true;refresh();
    try{await task();}
    catch(error){toast(friendlyError(error,error?.message||'تعذر تنفيذ العملية'),'error');}
    finally{processing=false;refresh();}
  }
  async function publishChosen(docs){
    const ready=docs.filter(isReady);
    if(!ready.length){toast('لا توجد صور مكتملة الحقول وجاهزة للنشر.','error');return;}
    const skipped=docs.length-ready.length;
    if(!(await confirmBox(`سيتم نشر ${ready.length} مستند مكتمل ماليًا بعد مراجعتك. سيبقى ${skipped} مستند غير مكتمل دون نشر. هل تؤكد؟`,'تأكيد النشر')))return;
    await runProtected(async()=>{
      let done=0;
      for(const doc of ready){
        updateProgress(`نشر ${done+1}/${ready.length}: ${doc.file_name}`);
        try{await publishDoc(doc);done++;}
        catch(error){toast(`توقف نشر ${doc.file_name}. راجع حالته قبل إعادة المحاولة: ${error.message||error}`,'error');break;}
      }
      toast(`تم التحقق من نشر ${done} مستند. بقيت الصور غير المكتملة محليًا.`,'success');
    });
  }

  function wire(){
    root.querySelector('#images-pick')?.addEventListener('change',async e=>{
      const files=[...(e.target.files||[])];let added=0;
      for(const file of files){
        if(!VALID_IMAGE_TYPES.has(file.type)||file.size>MAX_IMAGE_BYTES){toast(`تجاوزت ${file.name}: استخدم JPEG/PNG/WEBP أقل من 12 MB.`,'error');continue;}
        const doc=newLocalDocument(file);
        try{await saveLocalImage(doc);records.unshift(doc);added++;currentId=doc.id;}
        catch(error){toast('فشل حفظ الصورة محليًا. قد تكون مساحة المتصفح ممتلئة. '+(error.message||''),'error');break;}
      }
      if(added){toast(`تم حفظ ${added} صورة محليًا.`, 'success');refresh();}
    });
    root.querySelectorAll('[data-open-image]').forEach(el=>el.addEventListener('click',async e=>{
      if(e.target.closest('[data-select-image]'))return;
      try{await saveCurrent();}catch(error){toast('لم تحفظ تعديلات الصورة الحالية، راجع مساحة التخزين.','error');return;}
      currentId=el.dataset.openImage;refresh();
    }));
    root.querySelectorAll('[data-select-image]').forEach(input=>input.addEventListener('change',e=>{
      e.stopPropagation();if(input.checked)selected.add(input.dataset.selectImage);else selected.delete(input.dataset.selectImage);
      refresh();
    }));
    root.querySelectorAll('[data-bulk-ocr]').forEach(btn=>btn.onclick=async()=>{
      try{await saveCurrent();await extractMany(targets(),btn.dataset.bulkOcr);}
      catch(error){toast(error.message||'تعذر حفظ البيانات','error');}
    });
    root.querySelector('[data-bulk-post]')?.addEventListener('click',async()=>{await saveCurrent();await publishChosen(targets());});
    root.querySelectorAll('[data-ocr]').forEach(btn=>btn.onclick=async()=>{
      try{await saveCurrent();await extractMany(getCurrent()?[getCurrent()]:[],btn.dataset.ocr);}catch(error){toast(error.message||'تعذر استخراج الصورة','error');}
    });
    root.querySelector('[data-doc="type"]')?.addEventListener('change',async e=>{
      syncEditor();const doc=getCurrent();doc.type=e.target.value;
      doc.items=doc.items.map(item=>({...item,catalog_id:'',unit_id:''}));
      await saveLocalImage(doc);refresh();
    });
    root.querySelectorAll('[data-field="catalog_id"]').forEach(el=>el.addEventListener('change',async()=>{
      syncEditor();const doc=getCurrent();
      const index=Number(el.closest('[data-image-item]')?.dataset.imageItem);
      const item=doc.items[index];
      if(doc.type==='purchase'&&item){
        const mat=catalog.materials.find(x=>String(x.id)===String(item.catalog_id));
        item.unit_id=mat?.base_unit_id||'';
      }
      await saveLocalImage(doc);refresh();
    }));
    root.querySelector('[data-reparse]')?.addEventListener('click',async()=>{
      syncEditor();const doc=getCurrent();
      if(doc.items?.length && !(await confirmBox('ستُستبدل البنود الحالية بنتيجة النص المعدّل. هل تتابع؟','استبدال البنود')))return;
      const rows=parseOcrLines(doc.text);
      const list=doc.type==='purchase'?catalog.materials:catalog.menu;
      doc.items=autofillExactCatalog(rows,list).map(row=>({...row,unit_id:doc.type==='purchase'?(catalog.materials.find(m=>String(m.id)===String(row.catalog_id))?.base_unit_id||''):''}));
      doc.status='review';await saveLocalImage(doc);refresh();
    });
    root.querySelector('[data-add-item]')?.addEventListener('click',async()=>{
      syncEditor();const doc=getCurrent();doc.items.push({id:crypto.randomUUID(),name:'',quantity:'',unit_price:'',discount:'0',catalog_id:'',unit_id:''});
      doc.status='review';await saveLocalImage(doc);refresh();
    });
    root.querySelectorAll('[data-remove-item]').forEach(btn=>btn.onclick=async()=>{
      syncEditor();const doc=getCurrent();doc.items.splice(Number(btn.dataset.removeItem),1);
      await saveLocalImage(doc);refresh();
    });
    root.querySelectorAll('[data-doc],[data-field]').forEach(input=>{
      if(input.dataset.doc==='type'||input.dataset.field==='catalog_id')return;
      input.addEventListener('change',async()=>{
        if(processing)return;
        try{await saveCurrent();refresh();}
        catch(error){toast('تعذر حفظ التعديلات محليًا: '+(error.message||error),'error');}
      });
    });
    root.querySelector('[data-save-local]')?.addEventListener('click',async()=>{
      try{await saveCurrent();refresh();toast('حُفظت الصورة والحقول داخل هذا المتصفح.','success');}
      catch(error){toast('تعذر الحفظ المحلي: '+(error.message||error),'error');}
    });
    root.querySelector('[data-save-draft]')?.addEventListener('click',async()=>{
      await saveCurrent();const doc=getCurrent();
      if(!(await confirmBox('ستُضاف البيانات إلى Supabase كمسودة، دون نشر مالي. بعد ذلك تُجرى التعديلات داخل صفحة المستند في البرنامج.','إضافة مسودة')))return;
      await runProtected(async()=>{await createDraft(doc);toast('أُنشئت المسودة داخل البرنامج. يمكنك فتحها ومراجعتها.','success');});
    });
    root.querySelector('[data-publish]')?.addEventListener('click',async()=>{
      try{await saveCurrent();await publishChosen(getCurrent()?[getCurrent()]:[]);}
      catch(error){toast(error.message||'تعذر حفظ الصورة','error');}
    });
    root.querySelector('[data-delete-image]')?.addEventListener('click',async()=>{
      const doc=getCurrent();
      if(!doc)return;
      if(!(await confirmBox('سيتم حذف الصورة ونتيجتها من هذا المتصفح فقط. لن يُحذف أي أوردر أو فاتورة من قاعدة البيانات.','حذف محلي')))return;
      try{await deleteLocalImage(doc.id);records=records.filter(x=>x.id!==doc.id);selected.delete(doc.id);currentId=records[0]?.id||null;refresh();toast('حُذفت الصورة محليًا فقط.','success');}
      catch(error){toast('تعذر حذف الصورة المحلية: '+(error.message||error),'error');}
    });
  }
  refresh();
}
