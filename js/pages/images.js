// Maria CFO Web v1.0.9 — handwritten OCR image enhancement, safe digit reread.
// OCR never posts to accounting; user must review a complete invoice in a dialog.
import * as api from '../api.js?v=1.0.7';
import {esc,unitDisplay,todayISO,money} from '../utils.js?v=1.0';
import {toast,loader,friendlyError,confirmBox,modal} from '../ui.js?v=1.0';
import {newLocalDocument,saveLocalImage,deleteLocalImage,listLocalImages} from '../image-local-store.js?v=1.0.7';
import {recognizeCloudImage,fetchOcrUsage,prepareImageForCloud} from '../image-cloud-ocr.js?v=1.0.9';
import {usageSummary} from '../image-cloud-rules.js?v=1.0';
import {validateImageDocument,localStatus,normalizeArabicNumbers} from '../image-document-rules.js?v=1.0.7';
import {materialKeyV106,materialExactV106,materialSearchTextV106,materialSuggestionsV106} from '../material-search-v106.js?v=1.0.7';
import {receiptHeaderV106,receiptItemsV106,receiptMathV106} from '../purchase-image-v106.js?v=1.0.9';
import {invoiceAmountV107} from '../invoice-amount-v107.js?v=1.0.8';
import {applyDigitAuditV109} from '../ocr-digit-review-v109.js?v=1.0.9';

const MAX_BYTES=12*1024*1024;
const TYPES=new Set(['image/png','image/jpeg','image/webp']);
const REGIONS=[{key:'supplier',name:'اسم المورد',label:'الاسم',symbol:'◉'},{key:'number',name:'رقم الفاتورة',label:'الرقم',symbol:'#'},{key:'items',name:'البنود والإجمالي',label:'البنود والإجمالي',symbol:'▤'},
 {key:'digits',name:'الأرقام',label:'منطقة الأرقام',symbol:'123'}];
const statusColors={'غير معالج':'grey','يحتاج استكمال':'yellow','جاهز للنشر':'green',
 'مسودة داخل البرنامج':'purple','منشور':'green','مراجعة نتيجة العملية':'red'};
const options=(rows,current='',placeholder='— اختر —')=>
 `<option value="">${esc(placeholder)}</option>`+(rows||[]).map(u=>`<option value="${esc(u.id)}" ${String(current)===String(u.id)?'selected':''}>${esc(unitDisplay(u)||u.name||'')}</option>`).join('');
const currencyName=c=>c==='USD'?'USD':'ل.س';
function itemTotal(row){
 const q=invoiceAmountV107(row.quantity),p=invoiceAmountV107(row.unit_price),d=invoiceAmountV107(row.discount??'0');
 return q!==null&&q>0&&p!==null&&p>0&&d!==null&&d>=0?q*p-d:null;
}
function materialChoiceOptions(materials,id='',supplierIds=[]){
 const supplierSet=new Set(supplierIds.map(String));
 const ordered=[...materials].sort((a,b)=>Number(supplierSet.has(String(b.id)))-Number(supplierSet.has(String(a.id)))||String(a.name).localeCompare(String(b.name),'ar'));
 return `<option value="">— اختر مادة —</option>`+ordered.map(m=>`<option value="${esc(m.id)}" data-search="${esc(materialSearchTextV106(m))}" ${String(m.id)===String(id)?'selected':''}>${esc(m.name)}${supplierSet.has(String(m.id))?' · من مشتريات المورد':''}</option>`).join('');
}

export async function renderImages(root){
 root.innerHTML=loader();
 let records=[];let currentId=null,processing=false,cropMode='',usage=null,usageError='';
 const selected=new Set(),urls=[];
 let catalog={materials:[],units:[],materialLinks:[],suppliers:[]};
 let catalogError='',history=[],historySupplierId='',historyLoading=false;
 try{records=await listLocalImages();}catch(e){root.innerHTML=`<div class="notice rose">تعذر فتح مكتبة الصور المحلية: ${esc(e.message||'')}. تحقق من سماح المتصفح بالتخزين.</div>`;return;}
 currentId=records[0]?.id||null;
 const loaded=await Promise.allSettled([api.materials(),api.units(),api.allMaterialUnitLinks(),api.suppliers()]);
 ['materials','units','materialLinks','suppliers'].forEach((key,i)=>{
  if(loaded[i].status==='fulfilled')catalog[key]=loaded[i].value;
  else catalogError=String(loaded[i].reason?.message||'تعذر تحميل '+key);
 });
 const current=()=>records.find(x=>x.id===currentId);
 const legacy=doc=>doc.type!=='purchase';
 const ready=doc=>!legacy(doc)&&!['published','uncertain'].includes(doc.status)&&validateImageDocument(doc,catalog).ready;
 const statusOf=doc=>legacy(doc)?'مستند قديم':localStatus(doc,validateImageDocument(doc,catalog));
 function revoke(){for(const u of urls)URL.revokeObjectURL(u);urls.length=0;}
 function objectUrl(file){const u=URL.createObjectURL(file);urls.push(u);return u;}
 const buttonDisabled=()=>processing?'disabled':'';
 function count(engine=3){const u=usageSummary(usage,engine);return `${u.day??'—'} اليوم / ${u.month??'—'} الشهر / ${u.monthLimit.toLocaleString('en-US')} شهريًا`;}
 function progress(message){const n=root.querySelector('#image-progress');if(n)n.textContent=message;}
 function usageDraw(){root.querySelectorAll('[data-counter="3"]').forEach(n=>n.textContent=count(3));}
 async function loadUsage(){try{usage=await fetchOcrUsage();usageError='';}catch(e){usageError=e.message||String(e);}usageDraw();}
 async function loadSupplierHistory(doc){
  const supplier=catalog.suppliers.find(s=>materialKeyV106(s.name)===materialKeyV106(doc?.supplier));
  if(!supplier){history=[];historySupplierId='';return;}
  if(historySupplierId===String(supplier.id))return;
  historySupplierId=String(supplier.id);history=[];historyLoading=true;
  try{history=await api.supplierPurchaseCatalog(supplier.id)||[];}
  catch(e){history=[];console.warn('Supplier prior purchases unavailable',e);}
  finally{historyLoading=false;}
 }
 const supplierIds=()=>history.map(x=>String(x.material_id));
 function chosenUnitOptions(row){
  const mat=catalog.materials.find(m=>String(m.id)===String(row.catalog_id));
  if(!mat)return options([],null,'—');
  const allowed=new Set([String(mat.base_unit_id),...catalog.materialLinks.filter(x=>String(x.material_id)===String(mat.id)).map(x=>String(x.unit_id))]);
  return options(catalog.units.filter(u=>allowed.has(String(u.id))),row.unit_id??mat.base_unit_id,'— اختر وحدة شراء —');
 }
 const baseUnits=()=>{
  return catalog.units.filter(u=>u.is_material_specific!==true&&u.is_active!==false);
 };
 function detectedUnit(text){
  const name=materialKeyV106(text);
  const forms=/^(?:كغ|كيلو|كيلوغرام|كيلوجرام|kg)$/i.test(name)?['KG','كيلوغرام','كغ']:
    /^(?:غرام|جرام|غ|g)$/i.test(name)?['G','غرام']:
    [text];
  for(const word of forms){const match=api.findUnitByText(word,catalog.units);if(match)return match;}
  return null;
 }
 function findUnit(text,mat){
  if(!text||!mat)return '';
  const unit=detectedUnit(text);
  if(!unit)return '';
  const allowed=new Set([String(mat.base_unit_id),...catalog.materialLinks.filter(l=>String(l.material_id)===String(mat.id)).map(l=>String(l.unit_id))]);
  return allowed.has(String(unit.id))?String(unit.id):'';
 }
 function fillRow(row){
  const match=materialExactV106(row.name,catalog.materials);
  if(match){
   row.catalog_id=String(match.id);row.material_mode='matched';
   const recognized=row.unit_text?findUnit(row.unit_text,match):'';
   row.unit_id=row.ocr_unit_unresolved?'':row.unit_text?(recognized||''):String(match.base_unit_id);
   if(row.unit_text&&!recognized){
    row.review_note=[row.review_note,'وحدة الفاتورة غير مرتبطة بالمادة؛ اختر وحدة الشراء الصحيحة.'].filter(Boolean).join(' ');
    row.ocr_review_required=true;
   }
  }
  else {row.catalog_id='';row.material_mode='unresolved';row.unit_id='';}
  const u=detectedUnit(row.unit_text||'');
  if(u&&baseUnits().some(b=>String(b.id)===String(u.id)))row.new_base_unit_id=String(u.id);
  return row;
 }
 function drawRegions(doc){
  return REGIONS.map(r=>{
   const c=doc.regions?.[r.key];if(!c)return '';
   return `<div class="image-crop-selection image-region-${r.key}" data-region="${r.key}" style="left:${c.x*100}%;top:${c.y*100}%;width:${c.w*100}%;height:${c.h*100}%"><span>${r.name}</span></div>`;
  }).join('');
 }
 function renderItem(row,i,doc){
  row.material_mode ??= row.catalog_id?'matched':'unresolved';
  const matched=!!row.catalog_id&&row.material_mode!=='new';
  const mode=matched?(row.material_mode==='existing'?'existing':'matched'):(row.material_mode||'unresolved');
  const material=catalog.materials.find(m=>String(m.id)===String(row.catalog_id));
  const editName=`<label class="image-edit-name-v108"><span>اسم البند المستخرج <small>قابل للتعديل</small></span><input type="text" data-field="name" value="${esc(row.name||'')}" placeholder="صحح الاسم بحسب الفاتورة" autocomplete="off" aria-label="تصحيح اسم البند ${i+1}"></label>`;
  const manual=mode==='existing'||mode==='matched';
  const materialBox=manual?`
   <div class="image-material-picker-v106">
    <select data-field="material_id" aria-label="اختيار مادة البند ${i+1}" ${processing?'disabled':''}>${materialChoiceOptions(catalog.materials,row.catalog_id,supplierIds())}</select>
    ${mode==='existing'&&row.catalog_id&&row.name&&materialKeyV106(row.name)!==materialKeyV106(material?.name)?`<label class="image-alias-opt-v106"><input type="checkbox" data-field="remember_alias" ${row.remember_alias?'checked':''}> اعتماد اسم الفاتورة كاسم ثانوي لاحقًا</label>`:''}
    ${!row.catalog_id?`<button type="button" class="mini-btn" data-mode="unresolved" data-row="${i}">رجوع</button>`:''}
   </div>`:mode==='new'?`
   <div class="image-new-material-v106">
     <input data-field="new_name" value="${esc(row.new_name??row.name??'')}" placeholder="اسم المادة الجديدة" aria-label="اسم المادة الجديدة">
     <select data-field="new_base_unit_id" aria-label="وحدة المادة الجديدة">${options(baseUnits(),row.new_base_unit_id,'— الوحدة الأساسية —')}</select>
     <button type="button" class="mini-btn" data-mode="unresolved" data-row="${i}">رجوع</button>
   </div>`:`<div class="image-unmatched-v106"><strong>—</strong><small>لم تتم مطابقة المادة بعد؛ صحح الاسم أو اختر مادة.</small>
    <div class="image-match-actions-v106"><button type="button" class="mini-btn" data-mode="new" data-row="${i}">إضافة كجديد</button><button type="button" class="mini-btn" data-mode="existing" data-row="${i}">ربط بمادة موجودة</button></div>
    ${row.name&&materialSuggestionsV106(row.name,catalog.materials,supplierIds(),3).length?`<div class="image-hints-v106">${materialSuggestionsV106(row.name,catalog.materials,supplierIds(),3).map(m=>`<button type="button" class="image-suggest-v106" data-suggest="${esc(m.id)}" data-row="${i}">${esc(m.name)}</button>`).join('')}</div>`:''}
   </div>`;
  const digitCandidates=[...(row.ocr_numeric_candidates||[]),...(row.ocr_digit_candidates||[])];
  const digitChips=digitCandidates.length?`<div class="image-digit-candidates-v109"><small>قراءات أرقام من الصورة — تأكد قبل استخدامها:</small>${digitCandidates.map((c,j)=>`<div class="image-digit-candidate-v109"><span><b dir="ltr">${esc(c.raw)}</b> <em>${esc(c.source||'الأصل')} · ${esc(c.label||'')}</em></span><button type="button" class="mini-btn" data-apply-digit="quantity" data-digit-index="${j}" data-row="${i}">كمية</button><button type="button" class="mini-btn" data-apply-digit="unit_price" data-digit-index="${j}" data-row="${i}">سعر</button></div>`).join('')}</div>`:'';
  const unitBox=mode==='new'?`<span class="image-unit-readonly-v106">${esc(unitDisplay(catalog.units.find(u=>String(u.id)===String(row.new_base_unit_id)))||'—')}</span>`:
   manual&&row.catalog_id?`<select data-field="unit_id" aria-label="وحدة المادة ${i+1}">${chosenUnitOptions(row)}</select>`:'—';
  return `<tr data-image-item="${i}">
   <td data-heading="المادة" class="image-catalog-cell">${editName}${materialBox}${digitChips}${row.review_note?`<small class="image-row-warning-v106">${esc(row.review_note)}</small>`:''}
    ${row.ocr_review_required?`<label class="image-ocr-confirm-v107"><input type="checkbox" data-field="ocr_reviewed" ${row.ocr_reviewed?'checked':''}><span>راجعت الأرقام والوحدة مع الفاتورة</span></label>`:''}</td>
   <td data-heading="الوحدة">${unitBox}</td>
   <td data-heading="الكمية"><input type="text" inputmode="decimal" dir="ltr" data-field="quantity" value="${esc(row.quantity??'')}" aria-label="كمية البند ${i+1}"></td>
   <td data-heading="سعر الوحدة"><input type="text" inputmode="decimal" dir="ltr" data-field="unit_price" value="${esc(row.unit_price??'')}" aria-label="سعر الوحدة للبند ${i+1}"></td>
   <td data-heading="الإجمالي"><strong data-line-total="${i}" class="image-line-total-v106">${itemTotal(row)===null?'—':money(itemTotal(row),doc.currency)}</strong>${row.ocr_line_total?`<small class="image-source-name-v106">بالفاتورة: ${esc(row.ocr_line_total)}</small>`:''}</td>
   <td data-heading="خصم"><input type="text" inputmode="decimal" dir="ltr" data-field="discount" value="${esc(row.discount??'0')}" aria-label="خصم البند ${i+1}"></td>
   <td data-heading="إجراء"><button type="button" class="mini-btn danger-lite" data-remove-item="${i}" aria-label="حذف البند">حذف</button></td>
  </tr>`;
 }
 function renderDocument(doc){
  const locked=doc.status==='published'||doc.status==='draft'||doc.status==='uncertain';
  for(const row of doc.items||[])row.material_mode ??= row.catalog_id?'matched':'unresolved';
  const check=validateImageDocument(doc,catalog),status=statusOf(doc),summary=receiptMathV106(doc);
  if(legacy(doc))return `<div class="card image-detail-card"><div class="section-head-inline"><h3>${esc(doc.file_name)}</h3><button class="btn secondary" type="button" data-delete-image>حذف الصورة</button></div>
     <div class="notice">هذه صورة من التخزين السابق. يمكنك استخدامها كفاتورة شراء جديدة إذا لم تكن مرتبطة بمستند محفوظ، دون المساس بأي مستند سابق.</div>
     ${!doc.server_id&&doc.status!=='published'?'<button class="btn" type="button" data-convert-legacy>تحويلها إلى فاتورة شراء</button>':''}
     <div class="image-preview-frame"><img src="${objectUrl(doc.file)}" alt="صورة محفوظة"></div></div>`;
  return `<div class="card image-detail-card">
    <div class="section-head-inline"><div><h3>${esc(doc.file_name)}</h3><span class="image-status ${statusColors[status]||'grey'}">${esc(status)}</span></div>
      <button type="button" class="btn secondary image-delete-v106" data-delete-image ${processing?'disabled':''}>حذف الصورة</button></div>
    ${doc.status==='uncertain'?`<div class="notice rose">${esc(doc.error||'تعذر التأكد من نتيجة العملية. افتح الفاتورة المسجلة قبل أي محاولة أخرى.')}${doc.server_id?` <a href="#/purchase/${esc(doc.server_id)}">فتح الفاتورة</a>`:''}</div>`:''}
    <div class="image-document-grid">
      <div class="image-preview-pane">
       <div class="image-preview-frame"><div class="image-crop-surface ${cropMode?'is-cropping image-region-'+cropMode:''}" data-crop-surface>
        <img src="${objectUrl(doc.file)}" alt="صورة فاتورة الشراء" draggable="false">${drawRegions(doc)}
        <div class="image-crop-selection image-region-${cropMode||'items'}" data-crop-drawing hidden></div>
       </div></div>
       <div class="image-crop-actions image-region-controls-v106">
        ${REGIONS.map(r=>`<button type="button" class="btn secondary image-region-button-v106 region-${r.key} ${cropMode===r.key?'is-selected':''}" data-region-mode="${r.key}" ${locked||processing?'disabled':''}>${r.symbol} ${r.label}${doc.regions?.[r.key]?' ✓':''}</button>`).join('')}
        <button type="button" class="btn secondary image-digit-preview-btn-v109" data-preview-digits ${processing?'disabled':''} title="معاينة معالجة الأرقام على جهازك دون إرسالها إلى OCR">تكبير الأرقام</button>
        ${Object.keys(doc.regions||{}).length?`<button type="button" class="btn secondary image-reset-regions-v107" data-reset-regions ${locked||processing?'disabled':''} title="إزالة مربعات التحديد فقط دون مسح الصورة أو البنود"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="13" height="13" rx="2" stroke-dasharray="3 2"/><path d="M10 21h9a2 2 0 002-2v-9"/><path d="M7 12l7-7"/></svg><span>مسح التحديدات</span></button>`:''}
       </div>
       <p class="metric-note">${cropMode?'اسحب مستطيلًا على الصورة لتحديد المنطقة. يمكنك استخدام اللمس أو الماوس.':Object.keys(doc.regions||{}).length?'سيُقرأ كل مربع محدد فقط بلونه. أي بيانات لم تحدد لها منطقة يمكن مراجعتها يدويًا.':'حدد مناطق الاسم والرقم والبنود لتقليل أخطاء القراءة. إذا تركتها كلها بلا تحديد سيحاول الاستخراج من الصورة كاملة.'}</p>
      </div>
      <div class="image-editor-pane"><fieldset ${locked||processing?'disabled':''}>
        <div class="form-grid">
         <div class="field"><label>التاريخ</label><input data-doc="date" type="date" value="${esc(doc.date||todayISO())}"></div>
         <div class="field"><label>العملة</label><select data-doc="currency"><option value="SYP" ${doc.currency==='SYP'?'selected':''}>ل.س</option><option value="USD" ${doc.currency==='USD'?'selected':''}>USD</option></select></div>
         <div class="field"><label>رقم الفاتورة</label><input data-doc="number" value="${esc(doc.number||'')}" autocomplete="off"></div>
         <div class="field"><label>اسم المورد</label><input data-doc="supplier" list="image-supplier-list" value="${esc(doc.supplier||'')}" autocomplete="off" placeholder="ابحث عن مورد أو اكتب الاسم"><datalist id="image-supplier-list">${catalog.suppliers.map(s=>`<option value="${esc(s.name)}"></option>`).join('')}</datalist></div>
        </div>
        ${historySupplierId?`<div class="image-supplier-history-v106">${historyLoading?'تحميل مواد المورد...':`<strong>مواد سبق شراؤها من هذا المورد: ${history.length}</strong> · تُقدّم في نتائج المطابقة دون تغيير أسعار الفاتورة.`}</div>`:''}
        <div class="image-ocr-actions image-ocr-reparse-actions-v107"><button class="btn" type="button" data-ocr="3">استخراج <span class="ocr-progress-pill" hidden></span></button>
         ${doc.text?.trim()&&!locked?`<button type="button" class="btn secondary image-digit-audit-btn-v109" data-audit-digits title="قراءة ثانية محسّنة لمحرك 3؛ تُحتسب طلبًا إضافيًا ولا تستبدل القيم تلقائيًا" ${processing?'disabled':''}>تدقيق الأرقام · طلب إضافي</button>`:''}
         ${doc.text?.trim()?`<button type="button" class="btn secondary image-reparse-v107" data-reparse title="استخدم النص المستخرج المحفوظ دون طلب OCR جديد">تحديث البنود من النص المحفوظ</button>`:''}</div>
        <div class="image-raw-toggle-v106"><button class="mini-btn" type="button" data-toggle-raw ${!doc.text?.trim()?'disabled':''}>عرض النص الأصلي المستخرج</button></div>
        <div class="image-raw-panel-v106" data-raw-panel hidden><label>النص الأصلي</label><textarea data-doc="text" rows="7" spellcheck="false" aria-label="النص الأصلي المستخرج">${esc(doc.text||'')}</textarea>${doc.ocr_digit_text?`<label>نص تدقيق الأرقام (قراءة ثانية مستقلة)</label><pre class="image-digit-raw-v109">${esc(doc.ocr_digit_text)}</pre>`:''}</div>
       </fieldset></div>
    </div>
    <div class="image-items-full"><fieldset ${locked||processing?'disabled':''}>
      <div class="image-items-head"><h3>بنود الفاتورة (${(doc.items||[]).length})</h3><div class="image-items-controls-v106">
        <button type="button" class="btn secondary" data-add-item>+ إضافة بند</button>
        <button type="button" class="btn secondary image-danger-action-v106" data-clear-items ${(doc.items||[]).length?'':'disabled'}>حذف جميع البنود</button>
      </div></div>
      <div class="table-wrap image-purchase-wrap-v106"><table class="table image-items-table"><thead><tr><th>المادة</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>الخصم</th><th>إجراء</th></tr></thead>
       <tbody>${doc.items?.length?doc.items.map((row,i)=>renderItem(row,i,doc)).join(''):'<tr><td colspan="7" class="empty">لا توجد بنود. اضغط استخراج أو أضف بندًا.</td></tr>'}</tbody>
      </table></div>
      <div class="image-totals-v106"><span>مجموع البنود بعد الخصم</span><strong data-invoice-total>${summary.valid?money(summary.sum,doc.currency):'أكمل الأرقام'}</strong>
       ${summary.expected!==null?`<span>الإجمالي المقروء: ${money(summary.expected,doc.currency)}</span>`:''}</div>
      ${summary.discrepancy?`<div class="notice rose image-total-warning-v106">الإجمالي المقروء لا يطابق مجموع البنود. راجع الفاتورة والخصومات قبل الحفظ.</div>`:''}
    </fieldset></div>
    <div class="image-publish-panel">
      ${check.ready?'<div class="notice sage">الحقول مكتملة. راجع الإجمالي والبنود قبل الحفظ النهائي.</div>':`<div class="notice image-missing"><strong>للاستكمال:</strong> ${esc(check.problems.slice(0,7).join('، '))}</div>`}
      ${doc.server_id?`<div class="metric-note">الفاتورة المسجلة: <a href="#/purchase/${esc(doc.server_id)}">فتح الفاتورة</a></div>`:''}
      <div class="image-detail-actions">
       <button type="button" class="btn secondary" data-save-local ${locked||processing?'disabled':''}>حفظ العمل مؤقتًا</button>
       <button type="button" class="btn" data-review-invoice ${locked||processing||!check.ready?'disabled':''}>حفظ الفاتورة</button>
      </div>
    </div>
  </div>`;
 }
 function syncEditor(){
  const doc=current();if(!doc||legacy(doc)||['draft','published','uncertain'].includes(doc.status))return;
  const detail=root.querySelector('.image-detail-card');if(!detail)return;
  for(const el of detail.querySelectorAll('[data-doc]'))doc[el.dataset.doc]=el.value;
  doc.items=[...detail.querySelectorAll('[data-image-item]')].map((tr,i)=>{
    const old=doc.items?.[i]||{},val=field=>{
     const e=tr.querySelector(`[data-field="${field}"]`);
     return e?.type==='checkbox'?Boolean(e.checked):e?.value;
    };
    const nextName=String(val('name')??old.name??'').trim();
    const nameChanged=materialKeyV106(nextName)!==materialKeyV106(old.name);
    const updated={...old,name:nextName,quantity:val('quantity')??old.quantity??'',unit_price:val('unit_price')??old.unit_price??'',discount:val('discount')??old.discount??'0'};
    if(val('ocr_reviewed')!==undefined)updated.ocr_reviewed=val('ocr_reviewed');
    if(updated.material_mode==='new'){
      updated.new_name=val('new_name')??old.new_name??old.name;
      if(nameChanged&&(!old.new_name||materialKeyV106(old.new_name)===materialKeyV106(old.name)))updated.new_name=nextName;
      updated.new_base_unit_id=val('new_base_unit_id')??old.new_base_unit_id??'';
      updated.catalog_id='';updated.unit_id=updated.new_base_unit_id;
    }else if(updated.material_mode==='existing'||updated.material_mode==='matched'){
      const next=val('material_id')??old.catalog_id??'';
      updated.catalog_id=next;
      const mat=catalog.materials.find(m=>String(m.id)===String(next));
      updated.unit_id=next?(val('unit_id')!==undefined?val('unit_id'):(old.unit_id??mat?.base_unit_id??'')):'';
      updated.remember_alias=val('remember_alias')??old.remember_alias??false;
    }else {updated.catalog_id='';updated.unit_id='';}
    if(nameChanged){
      updated.remember_alias=false;
      // Automatically matched OCR names can become wrong after manual editing.
      // Re-evaluate exact aliases, or require a fresh manual match. A deliberate
      // "existing" selection stays linked until the user changes it.
      if(updated.material_mode==='matched'||updated.material_mode==='unresolved'){
        const match=materialExactV106(nextName,catalog.materials);
        if(match){updated.catalog_id=String(match.id);updated.unit_id=updated.ocr_unit_unresolved?'':(findUnit(updated.unit_text,match)||String(match.base_unit_id));updated.material_mode='matched';}
        else {updated.catalog_id='';updated.unit_id='';updated.material_mode='unresolved';}
      }
    }
    return updated;
  });
  if(doc.text||doc.items.length)doc.status='review';
 }
 async function saveCurrent(){syncEditor();const doc=current();if(doc)await saveLocalImage(doc);}
 function recomputeTotals(){
   const doc=current();if(!doc)return;
   const trs=[...root.querySelectorAll('[data-image-item]')];
   for(const tr of trs){
    const i=Number(tr.dataset.imageItem);
    const row={quantity:tr.querySelector('[data-field="quantity"]')?.value,
     unit_price:tr.querySelector('[data-field="unit_price"]')?.value,discount:tr.querySelector('[data-field="discount"]')?.value};
    const out=tr.querySelector('[data-line-total]');const total=itemTotal(row);
    if(out)out.textContent=total===null?'—':money(total,doc.currency);
   }
   const sums=trs.map(tr=>itemTotal({quantity:tr.querySelector('[data-field="quantity"]')?.value,
      unit_price:tr.querySelector('[data-field="unit_price"]')?.value,discount:tr.querySelector('[data-field="discount"]')?.value}));
   const all=sums.length&&sums.every(x=>x!==null);
   const el=root.querySelector('[data-invoice-total]');if(el)el.textContent=all?money(sums.reduce((a,b)=>a+b,0),doc.currency):'أكمل الأرقام';
 }
 function refresh(){
  if(!root.isConnected){revoke();return;}revoke();
  const doc=current();
  root.innerHTML=`<div class="notice image-privacy-notice">الصور محفوظة في هذا المتصفح؛ تُرسل نسخة للقراءة إلى خدمة OCR وقت الاستخراج فقط. راجع الأرقام قبل تسجيل الفاتورة.</div>
  ${catalogError?`<div class="notice rose">تعذر تحميل بيانات المواد/الموردين: ${esc(catalogError)}. شغّل SQL الخاص بالإصدار 1.0.6 وتحقق من الاتصال.</div>`:''}
  ${usageError?`<div class="notice">تعذر قراءة عدّاد الاستخراج: ${esc(usageError)}</div>`:''}
  <div class="card image-toolbar"><div class="image-toolbar-buttons">
   <label class="btn" for="images-pick">إضافة صور</label><input id="images-pick" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
   <button type="button" class="btn secondary" data-bulk-ocr="3" ${buttonDisabled()}>استخراج <span class="ocr-progress-pill" hidden></span></button>
   <button type="button" class="btn secondary image-go-purchases-v108" data-go-purchases><span aria-hidden="true">↗</span> فواتير الشراء</button>
  </div><div class="image-usage-cards image-single-usage-v106"><div><strong>Engine 3</strong><span class="ocr-usage-num" data-counter="3">${count(3)}</span></div></div>
  <div class="metric-note">عند تحديد صور تُستخرج المحددة فقط؛ وإلا فتُعالج الصور التي لم تُحفظ في البرنامج.</div><div id="image-progress" role="status" aria-live="polite"></div></div>
  <div class="image-workspace"><aside class="card image-gallery"><div class="section-head-inline"><h3>مكتبة الصور (${records.length})</h3><span class="muted-small">${selected.size} محددة</span></div>
   <div class="image-gallery-strip">${records.map(r=>`<div class="image-queue-item ${r.id===currentId?'is-active':''}" data-open-image="${esc(r.id)}">
    <label class="image-tick" aria-label="تحديد صورة"><input type="checkbox" data-select-image="${esc(r.id)}" ${selected.has(r.id)?'checked':''}></label>
    <img src="${objectUrl(r.file)}" alt="صورة ${esc(r.file_name)}" loading="lazy">
    <div class="image-queue-info"><strong title="${esc(r.file_name)}">${esc(r.file_name)}</strong><small>فاتورة</small><span class="image-status ${statusColors[statusOf(r)]||'grey'}">${esc(statusOf(r))}</span></div>
   </div>`).join('')||'<div class="empty">لا توجد صور</div>'}</div></aside>
   <section class="image-document-area">${doc?renderDocument(doc):'<div class="card empty"><h3>ابدأ بإضافة صورة فاتورة</h3></div>'}</section>
  </div>`;
  wire();
 }
 function updateOcr(progressValue,label){
  const value=Math.max(0,Math.min(100,Math.round(progressValue)));
  root.querySelectorAll('.ocr-progress-pill').forEach(p=>{p.hidden=false;p.textContent=`${value}%`;});
  progress(`${label} — ${value}%`);
 }
 async function extractOne(doc,index,total){
  if(doc.server_id||['draft','published','uncertain'].includes(doc.status)||legacy(doc))return;
  if((doc.items?.length||doc.text?.trim())&&!(await confirmBox(`سيعاد استخراج «${doc.file_name}»، وقد تُستبدل البنود المقروءة الحالية. احفظ مراجعتك أولًا إذا لزم.`, 'متابعة الاستخراج')))return;
  const selectedRegions=REGIONS.filter(r=>r.key!=='digits'&&doc.regions?.[r.key]);
  const extracts=selectedRegions.length?selectedRegions:[{key:'full',name:'الفاتورة كاملة'}];
  const sections={};let step=0;
  for(const region of extracts){
   const result=await recognizeCloudImage(doc.file,{engine:3,crop:doc.regions?.[region.key]||null,
    profile:region.key==='items'?'handwriting':'standard',onProgress:(msg,pct)=>{
    updateOcr((index+(step+pct/100)/extracts.length)*100/total,`${doc.file_name} · ${region.name}`);
   }});
   sections[region.key]=result.text||'';
   if(result.usage){usage=result.usage;usageDraw();}
   step++;
  }
  doc.ocr_region_text=sections;doc.ocr_digit_text='';
  doc.text=Object.entries(sections).map(([k,t])=>`${REGIONS.find(r=>r.key===k)?.name||'النص الكامل'}:\n${t}`).join('\n\n');
  doc.ocr_mode='3';doc.ocr_confidence=null;
  const header=receiptHeaderV106({supplier:sections.supplier,number:sections.number,items:sections.items,full:sections.full},catalog.suppliers);
  if(header.supplier&&!doc.supplier)doc.supplier=header.supplier;
  if(header.number&&!doc.number)doc.number=header.number;
  doc.ocr_total=header.invoiceTotal;
  const itemText=sections.items||sections.full||'';
  const found=receiptItemsV106(itemText,catalog.materials,80,catalog.units).map(fillRow);
  doc.items=found;
  doc.status='review';doc.error=null;
  await saveLocalImage(doc);
  await loadSupplierHistory(doc);
  return found.length;
 }
 async function extractMany(docs){
  if(processing)return;
  const candidates=docs.filter(x=>!legacy(x)&&!x.server_id&&!['draft','published','uncertain'].includes(x.status));
  if(!candidates.length){toast('لا توجد صور غير محفوظة قابلة للاستخراج.','error');return;}
  processing=true;let done=0,failed=0,items=0;
  for(const doc of candidates){
   try{items+=(await extractOne(doc,done,candidates.length))||0;}
   catch(e){failed++;doc.error=e.message||String(e);await saveLocalImage(doc).catch(()=>{});toast(`تعذّر استخراج ${doc.file_name}: ${e.message||e}`,'error');}
   done++;
  }
  processing=false;refresh();
  progress(`انتهى استخراج ${done-failed} صورة، وأُضيف ${items} بندًا للمراجعة. لم تُسجَّل أي حركة مالية.`);
  loadUsage();
 }
 async function resolveNewMaterials(doc){
  const pending=doc.items.filter(r=>r.material_mode==='new');
  if(!pending.length)return;
  const latest=await api.materials();
  for(const row of pending){
   const name=String(row.new_name||row.name||'').trim();
   const existing=materialExactV106(name,latest);
   if(existing){
    if(String(existing.base_unit_id)!==String(row.new_base_unit_id))throw new Error(`المادة «${name}» موجودة بوحدة مختلفة، اربطها بالمادة الموجودة أولًا.`);
    row.catalog_id=String(existing.id);row.unit_id=String(existing.base_unit_id);row.material_mode='matched';
    continue;
   }
   const unit=baseUnits().find(u=>String(u.id)===String(row.new_base_unit_id));
   if(!unit)throw new Error(`حدد الوحدة الأساسية للمادة الجديدة ${name}`);
   const code=await api.nextMaterialCode(latest);
   const created=await api.materialIdentityCreateV106({name,code,baseUnitId:unit.id,aliases:[]});
   row.catalog_id=String(created.id);row.unit_id=String(unit.id);row.material_mode='matched';
   catalog.materials.push({...created,__aliases:[]});latest.push(created);
   await saveLocalImage(doc);
   await api.ensureStandardMaterialUnits(created,catalog.units);
  }
 }
 async function createDraft(doc){
  let check=validateImageDocument(doc,catalog);
  if(!check.ready)throw new Error('اكمل بيانات الفاتورة: '+check.problems.join('، '));
  if(doc.server_id)throw new Error('الفاتورة مرتبطة بسجل سابق؛ افتح السجل للتحقق منه.');
  await resolveNewMaterials(doc);
  check=validateImageDocument(doc,catalog);
  if(!check.ready)throw new Error('تعذر تأكيد مطابقة المواد: '+check.problems.join('، '));
  doc.status='uncertain';doc.error='إنشاء الفاتورة قيد التحقق؛ لا تكرر الإرسال.';
  await saveLocalImage(doc);
  try{
   const result=await api.createPurchase({supplierName:doc.supplier,currency:doc.currency,invoiceNumber:doc.number||null,date:doc.date});
   doc.server_id=typeof result==='string'?result:result?.id||result;
   doc.server_kind='purchase';await saveLocalImage(doc);
   for(const item of check.prepared){
    await api.addPurchaseItem({invoiceId:doc.server_id,materialId:item.catalog_id,
     purchaseUnitId:item.unit_id,quantity:item.quantity,unitPrice:item.unit_price,discount:item.discount});
   }
   doc.status='draft';doc.error=null;await saveLocalImage(doc);
  }catch(e){
   doc.status='uncertain';doc.error='قد تكون المسودة أُنشئت جزئيًا. تحقق من سجل الفاتورة المرتبط قبل أي إعادة محاولة. '+(e.message||e);
   await saveLocalImage(doc);throw e;
  }
 }
 async function publishInvoice(doc){
  if(!doc.server_id)await createDraft(doc);
  if(doc.status!=='draft')throw new Error('المسودة ليست جاهزة للنشر.');
  try{
   await api.postPurchase(doc.server_id);
   const posted=await api.one('purchase_invoices',doc.server_id);
   if(posted?.status!=='posted'||posted?.is_voided)throw new Error('POST_STATUS_NOT_CONFIRMED');
   doc.status='published';doc.error=null;await saveLocalImage(doc);
  }catch(e){
   doc.status='uncertain';doc.error='لا يمكن التأكد من حالة النشر. افتح الفاتورة للتحقق قبل أي إعادة إرسال. '+(e.message||e);
   await saveLocalImage(doc);throw e;
  }
  // Alias learning is OPTIONAL and never makes a successful posted invoice uncertain.
  let aliasesFailed=0;
  for(const row of doc.items){
   if(!row.remember_alias||!row.catalog_id||!row.name)continue;
   const mat=catalog.materials.find(m=>String(m.id)===String(row.catalog_id));
   if(!mat||materialKeyV106(row.name)===materialKeyV106(mat.name))continue;
   try{await api.materialAliasAddV106(mat.id,row.name);}catch(e){aliasesFailed++;console.warn('Optional material alias not saved',e);}
  }
  return aliasesFailed;
 }
 function invoiceReview(doc){
  const check=validateImageDocument(doc,catalog);if(!check.ready){toast('أكمل البنود قبل فتح المراجعة.','error');return;}
  const summary=receiptMathV106(doc);
  const m=modal({title:'مراجعة فاتورة الشراء قبل الحفظ',wide:true,
   subtitle:'لن تُضاف فاتورة ولا تُحدّث كميات المخزون إلا بعد الضغط على زر الحفظ النهائي.',
   body:`<div class="image-review-summary-v106">
      <div><small>المورد</small><strong>${esc(doc.supplier||'شراء مباشر')}</strong></div>
      <div><small>رقم الفاتورة</small><strong>${esc(doc.number||'—')}</strong></div>
      <div><small>التاريخ</small><strong>${esc(doc.date)}</strong></div>
      <div><small>العملة</small><strong>${esc(currencyName(doc.currency))}</strong></div>
    </div>
    <div class="table-wrap"><table class="table image-review-table-v106"><thead><tr><th>المادة</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي بعد الخصم</th></tr></thead>
     <tbody>${check.prepared.map(row=>`<tr><td>${esc(row.name)}${row.new_material?' <span class="badge">جديدة</span>':''}</td>
       <td>${esc(unitDisplay(catalog.units.find(u=>String(u.id)===String(row.unit_id)))||'—')}</td><td>${esc(row.quantity)}</td><td>${money(row.unit_price,doc.currency)}</td><td>${money(row.quantity*row.unit_price-row.discount,doc.currency)}</td></tr>`).join('')}</tbody></table></div>
    <div class="image-review-grand-v106"><span>إجمالي الفاتورة من البنود</span><strong>${money(summary.sum,doc.currency)}</strong>
     ${summary.expected!==null?`<small>الإجمالي المستخرج: ${money(summary.expected,doc.currency)}</small>`:''}</div>
    ${summary.discrepancy?`<div class="notice rose"><strong>تحذير: يوجد اختلاف بين إجمالي الفاتورة المقروء ومجموع البنود.</strong> لا تحفظ قبل فحص الصورة والأرقام.</div>
       <label class="image-review-ack-v106"><input type="checkbox" name="accept_difference" required> راجعت الصورة وتأكدت أن المبالغ المعروضة صحيحة رغم هذا الاختلاف.</label>`:''}
    ${doc.items.some(x=>x.review_note)?'<div class="notice">توجد ملاحظات على بعض الصفوف المستخرجة. تأكد من مطابقتها للصورة الأصلية قبل الحفظ.</div>':''}`,
   submitText:'حفظ ونشر الفاتورة',
   onSubmit:async fd=>{
    if(summary.discrepancy&&!fd.get('accept_difference')){toast('راجع اختلاف الإجمالي قبل الحفظ.','error');return false;}
    if(processing)return false;
    processing=true;
    try{
     await saveLocalImage(doc);
     const aliasErrors=await publishInvoice(doc);
     toast(`حُفظت فاتورة الشراء ونُشرت بعد التحقق.${aliasErrors?' تعذر حفظ بعض الأسماء الثانوية؛ يمكن تعديلها من المواد.':''}`,'success');
     refresh();return true;
    }catch(e){toast(friendlyError(e,e.message||'تعذر حفظ الفاتورة. راجع حالتها قبل المحاولة مرة أخرى.'),'error');refresh();return false;}
    finally{processing=false;}
   },
  });
  return m;
 }
 function wireCrop(){
  const surface=root.querySelector('[data-crop-surface]');if(!surface||!cropMode)return;
  const drawing=surface.querySelector('[data-crop-drawing]');let from=null;
  const coord=e=>{
   const r=surface.querySelector('img').getBoundingClientRect();
   return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};
  };
  surface.addEventListener('pointerdown',e=>{
   if(processing)return;from=coord(e);surface.setPointerCapture(e.pointerId);e.preventDefault();
  });
  surface.addEventListener('pointermove',e=>{
   if(!from)return;const to=coord(e),x=Math.min(from.x,to.x),y=Math.min(from.y,to.y),w=Math.abs(from.x-to.x),h=Math.abs(from.y-to.y);
   drawing.hidden=false;Object.assign(drawing.style,{left:`${x*100}%`,top:`${y*100}%`,width:`${w*100}%`,height:`${h*100}%`});
  });
  const stop=()=>{from=null;};
  surface.addEventListener('pointercancel',stop);
  surface.addEventListener('pointerup',async e=>{
   if(!from)return;const to=coord(e),x=Math.min(from.x,to.x),y=Math.min(from.y,to.y),w=Math.abs(from.x-to.x),h=Math.abs(from.y-to.y);from=null;
   if(w<0.035||h<0.035){toast('اختر منطقة أكبر للقراءة.','error');return;}
   const doc=current();if(!doc)return;
   doc.regions={...(doc.regions||{}),[cropMode]:{x,y,w,h}};cropMode='';
   try{await saveLocalImage(doc);refresh();}catch(error){toast('تعذر حفظ التحديد.','error');}
  });
 }
 function wire(){
  root.querySelector('#images-pick')?.addEventListener('change',async e=>{
   let added=0;
   for(const file of [...(e.target.files||[])]){
    if(!TYPES.has(file.type)||file.size>MAX_BYTES){toast(`تجاوزت ${file.name}: استخدم صورة PNG/JPEG/WEBP أقل من 12 MB.`,'error');continue;}
    const doc=newLocalDocument(file);doc.type='purchase';doc.regions={};
    try{await saveLocalImage(doc);records.unshift(doc);currentId=doc.id;added++;history=[];historySupplierId='';}
    catch(error){toast('فشل حفظ الصورة داخل المتصفح: '+(error.message||error),'error');break;}
   }
   if(added){toast(`حُفظت ${added} صورة.`, 'success');refresh();}
  });
  root.querySelectorAll('[data-open-image]').forEach(el=>el.addEventListener('click',async e=>{
   if(e.target.closest('[data-select-image]'))return;
   try{await saveCurrent();}catch(err){toast('تعذر حفظ تعديلات الصورة الحالية.','error');return;}
   currentId=el.dataset.openImage;cropMode='';history=[];historySupplierId='';refresh();await loadSupplierHistory(current());refresh();
  }));
  root.querySelectorAll('[data-select-image]').forEach(el=>el.addEventListener('change',e=>{
   e.stopPropagation();if(el.checked)selected.add(el.dataset.selectImage);else selected.delete(el.dataset.selectImage);refresh();
  }));
  root.querySelector('[data-bulk-ocr]')?.addEventListener('click',async()=>{
   try{await saveCurrent();await extractMany((selected.size?records.filter(d=>selected.has(d.id)):records));}
   catch(e){toast(friendlyError(e),'error');}
  });
  root.querySelector('[data-go-purchases]')?.addEventListener('click',async()=>{
   try{await saveCurrent();location.hash='#/purchases';}
   catch(e){toast('تعذر حفظ تعديلات الصورة الحالية؛ لم نغادر الصفحة حتى لا تضيع.', 'error');}
  });
  root.querySelector('[data-ocr]')?.addEventListener('click',async()=>{
   try{await saveCurrent();await extractMany(current()?[current()]:[]);}catch(e){toast(friendlyError(e),'error');}
  });
  root.querySelectorAll('[data-region-mode]').forEach(el=>el.addEventListener('click',async()=>{
   await saveCurrent();cropMode=cropMode===el.dataset.regionMode?'':el.dataset.regionMode;refresh();
  }));
  root.querySelector('[data-reset-regions]')?.addEventListener('click',async()=>{
   await saveCurrent();current().regions={};cropMode='';await saveLocalImage(current());refresh();
  });
  wireCrop();
  root.querySelector('[data-toggle-raw]')?.addEventListener('click',e=>{
   const panel=root.querySelector('[data-raw-panel]');panel.hidden=!panel.hidden;
   e.target.textContent=panel.hidden?'عرض النص الأصلي المستخرج':'إخفاء النص الأصلي المستخرج';
  });
  root.querySelector('[data-preview-digits]')?.addEventListener('click',async()=>{
   try{
    const doc=current();if(!doc)return;
    const image=await prepareImageForCloud(doc.file,{crop:doc.regions?.digits||doc.regions?.items||null,profile:'handwriting'});
    modal({title:'تكبير الأرقام المكتوبة',wide:true,hideActions:true,
     body:`<div class="image-digit-preview-v109"><p class="metric-note">المعاينة المعالجة على جهازك فقط؛ لم يتم تشغيل OCR أو احتساب طلب. راجع النقطة (٠)، والخمسة (٥)، وأشكال الاثنين والثلاثة بخط اليد.</p><img class="image-digit-preview-img-v109" src="${image}" alt="تكبير موضع الأرقام بعد توضيح الحبر" /></div>`});
   }catch(e){toast('تعذر عرض التكبير: '+(e.message||e),'error');}
  });
  root.querySelector('[data-audit-digits]')?.addEventListener('click',async()=>{

   if(processing)return;
   try{
    await saveCurrent();const doc=current();if(!doc||!doc.text?.trim())return;
    if(!(await confirmBox('سيُرسل قصّ الأرقام المحدد (أو البنود عند عدم تحديده) إلى المحرك 3 في طلب إضافي يُحتسب ضمن العداد. لن تتغير كميات الفاتورة أو أسعارها آليًا؛ ستظهر نتائج للمقارنة والمراجعة فقط. هل تتابع؟','تدقيق الأرقام')))return;
    processing=true;refresh();progress('تحسين صورة الأرقام وقراءتها بالمحرك 3...');
    const result=await recognizeCloudImage(doc.file,{engine:3,
     crop:doc.regions?.digits||doc.regions?.items||null,profile:'handwriting',
     onProgress:(label,pct)=>progress(`تدقيق الأرقام — ${pct}%`)});
    if(result.usage){usage=result.usage;usageDraw();}
    doc.ocr_digit_text=result.text;
    const audit=applyDigitAuditV109(doc.items,result.text);
    doc.items=audit.rows;
    doc.ocr_digit_audit_aligned=audit.matched;
    doc.status='review';await saveLocalImage(doc);
    refresh();
    toast(audit.matched?'ظهرت قراءات الأرقام الثانية بجانب البنود. راجع الاختلافات، ولم يُغيَّر أي مبلغ تلقائيًا.':`استُخرج نص ثانٍ، لكن عدد أسطره (${audit.rowCount}) مختلف عن البنود (${doc.items.length})؛ افتح النص الخام للمقارنة، دون ربط أرقام بصفوف خاطئة.`,audit.matched?'success':'error');
   }catch(e){toast(friendlyError(e,e.message||'تعذر تدقيق الأرقام.'),'error');}
   finally{processing=false;refresh();loadUsage();}
  });
  root.querySelector('[data-reparse]')?.addEventListener('click',async()=>{

   syncEditor();const doc=current();
   if(doc.items?.length&&!(await confirmBox('سيعاد تحليل نص OCR المحفوظ دون تشغيل الخدمة مجددًا، وستُستبدل البنود الحالية بما فيها تعديلاتك اليدوية. هل تتابع؟','إعادة التحليل')))return;
   const text=String(doc.text||'').replace(/^(?:الاسم|الرقم|البنود والإجمالي|النص الكامل):/gm,'');
   doc.items=receiptItemsV106(text,catalog.materials,80,catalog.units).map(fillRow);
   doc.ocr_digit_text='';doc.ocr_digit_audit_aligned=false;
   const head=receiptHeaderV106({full:text},catalog.suppliers);if(!doc.supplier)doc.supplier=head.supplier;if(!doc.number)doc.number=head.number;
   doc.ocr_total=head.invoiceTotal;doc.status='review';await saveLocalImage(doc);await loadSupplierHistory(doc);refresh();
  });
  root.querySelectorAll('[data-apply-digit]').forEach(btn=>btn.addEventListener('click',async()=>{
   if(processing)return;syncEditor();const doc=current(),row=doc?.items?.[Number(btn.dataset.row)];if(!row)return;
   const candidates=[...(row.ocr_numeric_candidates||[]),...(row.ocr_digit_candidates||[])];
   const candidate=candidates[Number(btn.dataset.digitIndex)];
   const field=btn.dataset.applyDigit;
   if(!candidate||!['quantity','unit_price'].includes(field)||invoiceAmountV107(candidate.raw)===null)return;
   row[field]=String(invoiceAmountV107(candidate.raw));
   row.ocr_review_required=true;row.ocr_reviewed=false;
   await saveLocalImage(doc);refresh();
  }));
  root.querySelectorAll('[data-mode],[data-suggest]').forEach(btn=>btn.addEventListener('click',async()=>{
   syncEditor();const doc=current(),row=doc?.items?.[Number(btn.dataset.row)];if(!row)return;
   if(btn.dataset.suggest){
    const mat=catalog.materials.find(m=>String(m.id)===String(btn.dataset.suggest));
    if(!mat)return;row.material_mode='existing';row.catalog_id=String(mat.id);row.unit_id=findUnit(row.unit_text,mat)||String(mat.base_unit_id);
    if(row.ocr_unit_unresolved)row.unit_id='';
    row.remember_alias=false;
   }else{
    row.material_mode=btn.dataset.mode;
    if(row.material_mode==='new'){row.catalog_id='';row.new_name=row.new_name??row.name;row.unit_id=row.new_base_unit_id||'';}
    else if(row.material_mode==='unresolved'){row.catalog_id='';row.unit_id='';row.remember_alias=false;}
    else if(row.material_mode==='existing'){row.catalog_id='';row.unit_id='';}
   }
   await saveLocalImage(doc);refresh();
  }));
  root.querySelectorAll('[data-field="material_id"]').forEach(el=>el.addEventListener('change',async()=>{
   syncEditor();const doc=current();const idx=Number(el.closest('[data-image-item]')?.dataset.imageItem);const row=doc.items[idx];
   const mat=catalog.materials.find(m=>String(m.id)===String(row.catalog_id));
   row.unit_id=mat&&!row.ocr_unit_unresolved?(findUnit(row.unit_text,mat)||String(mat.base_unit_id)):'';
   row.material_mode='existing';row.remember_alias=false;await saveLocalImage(doc);refresh();
  }));
  root.querySelectorAll('[data-field="quantity"],[data-field="unit_price"],[data-field="discount"]').forEach(el=>el.addEventListener('input',recomputeTotals));
  root.querySelectorAll('[data-doc],[data-field]').forEach(el=>{
   if(el.dataset.field==='material_id'||el.dataset.doc==='text')return;
   el.addEventListener('change',async()=>{
    if(processing)return;try{
     await saveCurrent();const doc=current();
     if(el.dataset.doc==='supplier'){await loadSupplierHistory(doc);}
     refresh();
    }catch(err){toast('تعذر حفظ التعديلات المحلية: '+(err.message||err),'error');}
   });
  });
  root.querySelector('[data-add-item]')?.addEventListener('click',async()=>{
   syncEditor();const doc=current();doc.items.push({id:crypto.randomUUID(),name:'',material_mode:'unresolved',quantity:'',unit_price:'',discount:'0',catalog_id:'',unit_id:''});
   doc.status='review';await saveLocalImage(doc);refresh();
  });
  root.querySelector('[data-clear-items]')?.addEventListener('click',async()=>{
   syncEditor();const doc=current();if(!doc.items.length)return;
   if(!(await confirmBox(`حذف ${doc.items.length} بندًا من هذه الصورة فقط؟ لن تُحذف الصورة أو أي فاتورة منشورة.`, 'حذف البنود')))return;
   doc.items=[];await saveLocalImage(doc);refresh();
  });
  root.querySelectorAll('[data-remove-item]').forEach(btn=>btn.addEventListener('click',async()=>{
   syncEditor();const doc=current();doc.items.splice(Number(btn.dataset.removeItem),1);await saveLocalImage(doc);refresh();
  }));
  root.querySelector('[data-save-local]')?.addEventListener('click',async()=>{
   try{await saveCurrent();refresh();toast('حُفظت التعديلات في هذا المتصفح.','success');}catch(e){toast('تعذر الحفظ المحلي: '+(e.message||e),'error');}
  });
  root.querySelector('[data-review-invoice]')?.addEventListener('click',async()=>{
   try{await saveCurrent();const doc=current();if(!ready(doc)){toast('أكمل ربط البنود وأرقامها قبل الحفظ.','error');refresh();return;}
    invoiceReview(doc);
   }catch(e){toast('تعذر حفظ بيانات الصورة: '+(e.message||e),'error');}
  });
  root.querySelector('[data-convert-legacy]')?.addEventListener('click',async()=>{
   const doc=current();if(!doc||doc.server_id||doc.status==='published')return;
   if(!(await confirmBox('ستُعاد تهيئة ربط البنود فقط كفاتورة شراء؛ لا يُحذف النص ولا الصورة ولن تُنشأ أي حركة مالية.', 'تحويل للفواتير')))return;
   doc.type='purchase';doc.items=(doc.items||[]).map(x=>({...x,material_mode:'unresolved',catalog_id:'',unit_id:''}));
   doc.regions=doc.crop?{items:doc.crop}:{};doc.status='review';
   await saveLocalImage(doc);refresh();
  });
  root.querySelector('[data-delete-image]')?.addEventListener('click',async()=>{
   const doc=current();if(!doc)return;
   if(!(await confirmBox('حذف الصورة من هذا المتصفح فقط، دون حذف أي فاتورة في قاعدة البيانات؟','حذف الصورة')))return;
   try{await deleteLocalImage(doc.id);records=records.filter(r=>r.id!==doc.id);selected.delete(doc.id);currentId=records[0]?.id||null;history=[];historySupplierId='';refresh();toast('حُذفت الصورة فقط.','success');}
   catch(e){toast('تعذر حذف الصورة: '+(e.message||e),'error');}
  });
 }
 refresh();loadUsage();if(current())loadSupplierHistory(current()).then(()=>refresh()).catch(()=>{});
}
