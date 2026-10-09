import * as api from '../api.js?v=0.21';
import { esc, unitDisplay, todayISO } from '../utils.js?v=0.21';
import { toast, loader, friendlyError, confirmBox, modal } from '../ui.js?v=0.21';
import { newLocalDocument, saveLocalImage, deleteLocalImage, listLocalImages } from '../image-local-store.js?v=0.21';
import { recognizeCloudImage, fetchOcrUsage } from '../image-cloud-ocr.js?v=0.21';
import {usageSummary} from '../image-cloud-rules.js?v=0.21';
import { reviewedOcrItemCandidates,autofillExactCatalog,validateImageDocument,localStatus,exactCatalogId,normalizedName } from '../image-document-rules.js?v=0.21';

const T={
  fast:'\u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0633\u0631\u064a\u0639 - Engine 1',
  strong:'\u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0642\u0648\u064a - Engine 3',
  day:'\u0627\u0644\u064a\u0648\u0645',month:'\u0627\u0644\u0634\u0647\u0631',
  count:'\u0627\u0644\u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0627\u0644\u0645\u0633\u062c\u0651\u0644 \u0641\u064a Maria CFO (\u0644\u064a\u0633 \u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0631\u0633\u0645\u064a)',
  counted:'\u0627\u0644\u0639\u062f\u0627\u062f \u064a\u062d\u0633\u0628 \u0637\u0644\u0628\u0627\u062a \u0647\u0630\u0627 \u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0645\u0646\u0630 \u062a\u062b\u0628\u064a\u062a \u0627\u0644\u062a\u062d\u062f\u064a\u062b \u0641\u0642\u0637. \u062d\u062f 500 \u0637\u0644\u0628 \u064a\u0648\u0645\u064a \u0645\u0634\u062a\u0631\u0643 \u0644\u0643\u0644 IP.',
  cloud:'\u062a\u0628\u0642\u0649 \u0627\u0644\u0635\u0648\u0631 \u0645\u062d\u0641\u0648\u0638\u0629 \u0641\u064a \u0627\u0644\u0645\u062a\u0635\u0641\u062d. \u0639\u0646\u062f \u0627\u0644\u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0641\u0642\u0637 \u0646\u0631\u0633\u0644 \u0646\u0633\u062e\u0629 \u0645\u0646\u0647\u0627 \u0625\u0644\u0649 OCR.space.',
  search:'\u0627\u0628\u062d\u062b \u0639\u0646 \u0645\u0627\u062f\u0629 \u0623\u0648 \u0648\u062c\u0628\u0629',
  newUnit:'\u0648\u062d\u062f\u0629 \u0627\u0644\u0645\u0627\u062f\u0629 \u0627\u0644\u062c\u062f\u064a\u062f\u0629',
  newHint:'\u0645\u0627\u062f\u0629 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f\u0629: \u0627\u062e\u062a\u0631 \u0648\u062d\u062f\u062a\u0647\u0627 \u0648\u0633\u062a\u064f\u0646\u0634\u0623 \u0628\u0639\u062f \u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0645\u0633\u0648\u062f\u0629.',
  newDish:'\u0625\u0636\u0627\u0641\u0629 \u0648\u062c\u0628\u0629 \u062c\u062f\u064a\u062f\u0629',
  dishName:'\u0627\u0633\u0645 \u0627\u0644\u0648\u062c\u0628\u0629',
  dishPrice:'\u0633\u0639\u0631 \u0628\u064a\u0639 \u0627\u0644\u0648\u062c\u0628\u0629',
  recipeTitle:'\u0645\u0643\u0648\u0646\u0627\u062a \u0627\u0644\u0648\u062c\u0628\u0629',
  addIngredient:'\u0625\u0636\u0627\u0641\u0629 \u0645\u0643\u0648\u0651\u0646',
  saveDish:'\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0648\u062c\u0628\u0629 \u0648\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0644\u0628\u0646\u062f',
  recipeWarning:'\u0625\u0630\u0627 \u062a\u0631\u0643\u062a \u0627\u0644\u0648\u0635\u0641\u0629 \u0641\u0627\u0631\u063a\u0629 \u0633\u062a\u0628\u0642\u0649 \u062a\u0643\u0644\u0641\u0629 \u0627\u0644\u0637\u0639\u0627\u0645 \u0646\u0627\u0642\u0635\u0629.',
  newConfirm:'\u0633\u064a\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u0645\u0648\u0627\u062f \u062c\u062f\u064a\u062f\u0629 \u0628\u0648\u062d\u062f\u0627\u062a\u0647\u0627:',
  publish:'\u062e\u064a\u0627\u0631\u0627\u062a \u0627\u0644\u062d\u0641\u0638 \u0648\u0627\u0644\u0646\u0634\u0631',
  cashbox:'\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u0623\u0648\u0631\u062f\u0631 (\u0625\u0644\u0632\u0627\u0645\u064a)',
  items:'\u0628\u0646\u0648\u062f \u0627\u0644\u0645\u0633\u062a\u0646\u062f - \u0639\u0631\u0636 \u0643\u0627\u0645\u0644',
  gallery:'\u0645\u0643\u062a\u0628\u0629 \u0627\u0644\u0635\u0648\u0631',
  ingredient:'\u0645\u0627\u062f\u0629 \u0627\u0644\u0648\u0635\u0641\u0629',
  qty:'\u0627\u0644\u0643\u0645\u064a\u0629',
  unit:'\u0627\u0644\u0648\u062d\u062f\u0629',
  warned:'\u0627\u0644\u0645\u062d\u0631\u0643 1 \u0642\u062f\u064a\u0645 \u0648\u0645\u0639\u0631\u0636 \u0644\u0644\u0625\u064a\u0642\u0627\u0641. \u0627\u0644\u0645\u062d\u0631\u0643 3 \u064a\u062f\u0639\u0645 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0648\u0627\u0644\u062e\u0637 \u0627\u0644\u064a\u062f\u0648\u064a.'
};
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
  let cropMode=false;
  const selected=new Set();
  let previewUrls=[];
  let catalog={menu:[],materials:[],units:[],materialLinks:[],cashboxes:[]};
  let catalogError='';
  let usage=null;
  let usageError='';
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
  const displayCount=(engine)=>{
    const u=usageSummary(usage,engine);
    return `<span class="ocr-usage-num" data-counter="${engine}">${u.day===null?'--':u.day} ${T.day} / ${u.month===null?'--':u.month} ${T.month} / ${u.monthLimit.toLocaleString('en-US')} ${T.month}</span>`;
  };
  function updateUsageDisplays(){
    for(const engineId of [1,3]){
      const n=usageSummary(usage,engineId);
      root.querySelectorAll(`[data-counter="${engineId}"]`).forEach(node=>{
        node.textContent=`${n.day===null?'--':n.day} ${T.day} / ${n.month===null?'--':n.month} ${T.month} / ${n.monthLimit.toLocaleString('en-US')} ${T.month}`;
      });
    }
  }
  async function loadUsage(){
    try{usage=await fetchOcrUsage();usageError='';}
    catch(e){usage=null;usageError=String(e.message||e);}
    // Never rerender the editor while a user may be typing.
    updateUsageDisplays();
    if(usageError)updateProgress(T.count+': '+usageError);
  }
  const refresh=()=>{
    if(!root.isConnected){revoke();return;}
    revoke();
    const current=getCurrent();
    const eligible=targets().filter(isReady).length;
    const buttonsDisabled=processing?'disabled':'';
    root.innerHTML=`
      <div class="page-head image-page-head"><div><h2>الصور - إدخال سريع</h2><p>${T.cloud}</p></div></div>
      <div class="notice image-privacy-notice"><strong>الخصوصية:</strong> ${T.cloud} ${T.warned}</div>
      ${catalogError?`<div class="notice rose">${esc(catalogError)}</div>`:''}
      ${usageError?`<div class="notice rose">${T.count}: ${esc(usageError)}. ${T.counted}</div>`:''}
      <div class="card image-toolbar">
        <div class="image-toolbar-buttons">
          <label class="btn" for="images-pick">إضافة صور</label><input id="images-pick" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
          <button class="btn secondary" type="button" data-bulk-ocr="1" ${buttonsDisabled}>${T.fast} <small class="ocr-button-meter">${displayCount(1)}</small> <span class="ocr-progress-pill" hidden></span></button>
          <button class="btn secondary" type="button" data-bulk-ocr="3" ${buttonsDisabled}>${T.strong} <small class="ocr-button-meter">${displayCount(3)}</small> <span class="ocr-progress-pill" hidden></span></button>
          <button class="btn" type="button" data-bulk-post ${processing||!eligible?'disabled':''}>نشر الجاهزة (${eligible})</button>
        </div>
        <div class="image-usage-cards" aria-label="${T.count}"><div><strong>Engine 1</strong>${displayCount(1)}</div><div><strong>Engine 3</strong>${displayCount(3)}</div><small>${T.counted}</small></div>
        <div class="metric-note">عند تحديد صور تطبق الإجراءات عليها فقط، وإلا فتعالج الصور غير المنشورة جميعها.</div>
        <div id="image-progress" role="status" aria-live="polite"></div>
      </div>
      <div class="image-workspace">
        <aside class="card image-gallery">
          <div class="section-head-inline"><h3>${T.gallery} (${records.length})</h3><span class="muted-small">${selected.size} محددة</span></div>
          <div class="image-gallery-strip">${records.map(doc=>{
            const status=statusOf(doc);return `<div class="image-queue-item ${doc.id===currentId?'is-active':''}" data-open-image="${esc(doc.id)}">
              <label class="image-tick" title="تحديد للمعالجة"><input type="checkbox" data-select-image="${esc(doc.id)}" ${selected.has(doc.id)?'checked':''} aria-label="تحديد ${esc(doc.file_name)}"></label>
              <img src="${objectUrl(doc.file)}" alt="معاينة ${esc(doc.file_name)}" loading="lazy">
              <div class="image-queue-info"><strong title="${esc(doc.file_name)}">${esc(doc.file_name)}</strong><small>${doc.type==='purchase'?'فاتورة شراء':'أوردر'}</small><span class="image-status ${statusClass[status]||'grey'}">${esc(status)}</span></div>
            </div>`;}).join('')||'<div class="empty"><strong>لا توجد صور بعد</strong></div>'}</div>
        </aside>
        <section class="image-document-area">${current?renderDocument(current):'<div class="card empty"><h3>ابدأ بإضافة الصور</h3><p>يمكنك تعبئة مستند يدويًا بعد رفع صورة.</p></div>'}</section>
      </div>`;
    wire();
  };

  function allowedUnits(row){
    const mat=catalog.materials.find(m=>String(m.id)===String(row.catalog_id));
    if(!mat)return [];
    const allow=new Set([String(mat.base_unit_id), ...catalog.materialLinks.filter(rel=>String(rel.material_id)===String(mat.id)).map(rel=>String(rel.unit_id))]);
    return catalog.units.filter(u=>allow.has(String(u.id))).map(u=>({id:u.id,name:unitDisplay(u)}));
  }
  function baseUnits(){
    const standards=new Set(['G','KG','L','ML','PCS','BOX','CARTON','BAG','PACK','TRAY']);
    return catalog.units.filter(u=>standards.has(String(u.code||'').toUpperCase()));
  }
  function newMaterialsFor(doc){
    if(doc.type!=='purchase')return [];
    const rows=doc.items||[];
    return rows.filter(item=>!exactCatalogId(item.catalog_query||item.name,catalog.materials)&&!item.catalog_id&&String(item.catalog_query||item.name||'').trim());
  }
  function renderDocument(doc){
    const locked=doc.status==='published'||doc.status==='draft'||doc.status==='uncertain';
    const check=validateImageDocument(doc,catalog);
    const status=statusOf(doc);
    const names=doc.type==='purchase'?catalog.materials:catalog.menu;
    const htmlRows=(doc.items||[]).map((item,i)=>`
      <tr data-image-item="${i}" aria-label="${esc(item.catalog_query||item.name||'')}">
        <td><input data-field="name" value="${esc(item.name||'')}" placeholder="الاسم كما في الصورة" aria-label="اسم البند ${i+1}"><small class="muted-small">${esc(item.raw_line||'')}</small></td>
        <td class="image-catalog-cell">
          <input type="search" data-field="catalog_query" list="image-catalog-${doc.type}" autocomplete="off" value="${esc(item.catalog_query??(names.find(n=>String(n.id)===String(item.catalog_id))?.name||item.name||''))}" placeholder="${T.search}" aria-label="${T.search}">
          <input type="hidden" data-field="catalog_id" value="${esc(item.catalog_id||'')}">
          ${doc.type==='purchase'?`<div class="image-new-unit" ${item.catalog_id?'hidden':''}><small>${T.newHint}</small><label>${T.newUnit}<select data-field="new_base_unit_id">${catalogOptions(baseUnits(),item.new_base_unit_id,'--')}</select></label></div>`:
            `<button type="button" class="mini-btn image-new-menu" data-create-menu="${i}">${T.newDish}</button>`}
        </td>
        ${doc.type==='purchase'?`<td><select data-field="unit_id" aria-label="وحدة شراء ${i+1}">${catalogOptions(allowedUnits(item),item.unit_id,'— وحدة —')}</select></td>`:''}
        <td><input data-field="quantity" type="number" step="any" min="0.00001" value="${esc(item.quantity??'')}" placeholder="الكمية"></td>
        <td><input data-field="unit_price" type="number" step="any" min="0.00001" value="${esc(item.unit_price??'')}" placeholder="السعر"></td>
        <td><input data-field="discount" type="number" step="any" min="0" ${doc.type==='order'?'max="100"':''} value="${esc(item.discount??'0')}" aria-label="${doc.type==='order'?'خصم نسبة مئوية':'خصم إجمالي السطر'}"></td>
        <td><button type="button" class="mini-btn danger-lite" data-remove-item="${i}" aria-label="حذف السطر">حذف البند</button></td>
      </tr>`).join('');
    return `<div class="card image-detail-card">
      <div class="section-head-inline"><div><h3>${esc(doc.file_name)}</h3><span class="image-status ${statusClass[status]||'grey'}">${esc(status)}</span></div><button type="button" class="mini-btn danger-lite" data-delete-image ${processing?'disabled':''}>حذف الصورة المحلية</button></div>
      ${doc.status==='uncertain'?`<div class="notice rose">${esc(doc.error||'تعذر التأكد من آخر عملية. راجع المستند في البرنامج قبل تكرار الإنشاء أو النشر.')} ${doc.server_id?`<a href="#/${doc.type==='purchase'?'purchase':'order'}/${esc(doc.server_id)}">افتح المستند الموجود</a>`:''}</div>`:''}
      <div class="image-document-grid">
        <div class="image-preview-pane"><div class="image-preview-frame"><div class="image-crop-surface ${cropMode?'is-cropping':''}" data-crop-surface><img src="${objectUrl(doc.file)}" alt="صورة المستند الأصلية" draggable="false"><div class="image-crop-selection" data-crop-selection ${doc.crop?`style="left:${doc.crop.x*100}%;top:${doc.crop.y*100}%;width:${doc.crop.w*100}%;height:${doc.crop.h*100}%"`: 'hidden'}></div></div></div>
          <div class="image-crop-actions"><button type="button" class="mini-btn" data-toggle-crop ${locked?'disabled':''}>${cropMode?'اسحب مستطيلًا على الصورة':'تحديد منطقة القراءة'}</button>
          ${doc.crop?`<button type="button" class="mini-btn" data-reset-crop ${locked?'disabled':''}>إلغاء الاقتصاص</button>`:''}</div>
          <p class="metric-note">${doc.crop?'يُستخرج النص من المنطقة المحددة فقط؛ الصورة الأصلية محفوظة دون تغيير.':'للفواتير ذات الفراغات والخطوط الكثيرة: حدّد المنطقة المكتوبة بالماوس أو اللمس قبل الاستخراج.'}</p></div>
        <div class="image-editor-pane">
          <fieldset ${locked||processing?'disabled':''}>
            <div class="form-grid">
              <div class="field"><label>نوع الصورة</label><select data-doc="type"><option value="order" ${doc.type==='order'?'selected':''}>أوردر (افتراضي)</option><option value="purchase" ${doc.type==='purchase'?'selected':''}>فاتورة شراء</option></select></div>
              <div class="field"><label>التاريخ</label><input data-doc="date" type="date" value="${esc(doc.date||todayISO())}"></div>
              <div class="field"><label>العملة</label><select data-doc="currency"><option value="SYP" ${doc.currency==='SYP'?'selected':''}>SYP</option><option value="USD" ${doc.currency==='USD'?'selected':''}>USD</option></select></div>
              <div class="field"><label>رقم المستند (اختياري)</label><input data-doc="number" value="${esc(doc.number||'')}"></div>
              ${doc.type==='purchase'?`<div class="field full"><label>اسم المورد (اختياري)</label><input data-doc="supplier" value="${esc(doc.supplier||'')}"></div>`:''}
            </div>
            <datalist id="image-catalog-${doc.type}">${names.map(n=>`<option value="${esc(n.name)}"></option>`).join('')}</datalist>
            <div class="image-ocr-actions"><button type="button" class="btn secondary" data-ocr="1">${T.fast} <small class="ocr-button-meter">${displayCount(1)}</small> <span class="ocr-progress-pill" hidden></span></button><button type="button" class="btn secondary" data-ocr="3">${T.strong} <small class="ocr-button-meter">${displayCount(3)}</small> <span class="ocr-progress-pill" hidden></span></button><small>هذان الزران يستخرجان النص فقط، ولا ينشئان بنودًا. ${T.cloud} (النسبة تخص مراحل التحضير والاستلام، لا تقدم مزوّد الخدمة)</small></div>
            ${doc.ocr_confidence!==null&&doc.ocr_confidence!==undefined?`<div class="image-ocr-confidence ${Number(doc.ocr_confidence)<53?'is-uncertain':''}">مؤشر تعرف المحرك: ${esc(Math.round(Number(doc.ocr_confidence)||0))}% (ليس ضمان دقة النص). ${Number(doc.ocr_confidence)<53?'النص ضعيف الثقة: راجعه حرفيًا، ولا تعتمد عليه في القيم المالية.':''}</div>`:''}
            <div class="field"><label>النص المستخرج — قابل للتعديل</label><textarea data-doc="text" rows="6" placeholder="يمكنك إدخال النص بنفسك إذا تعذرت القراءة">${esc(doc.text||'')}</textarea></div>
            <button class="mini-btn" type="button" data-reparse>تحويل النص المراجع إلى بنود (باختياري)</button>

          </fieldset>
          ${doc.server_id?`<p class="metric-note">المستند داخل البرنامج: <a href="#/${doc.type==='purchase'?'purchase':'order'}/${esc(doc.server_id)}">فتح ${doc.type==='purchase'?'الفاتورة':'الأوردر'}</a></p>`:''}
        </div>
      </div>
      <div class="image-items-full"><fieldset ${locked||processing?'disabled':''}><h3>${T.items}</h3>
            <div class="image-items-wrap"><div class="image-items-head"><h4>الأصناف والحقول (${(doc.items||[]).length})</h4><button class="mini-btn danger-lite" type="button" data-clear-items ${(doc.items||[]).length?'':'disabled'}>حذف جميع البنود</button></div><p class="metric-note">لا تُضاف البنود بالاستخراج تلقائيًا. حوّل النص إلى بنود فقط بعد تصحيحه، أو أضف بندًا يدويًا. يمكن حذف أي بند.</p>
              <div class="table-wrap"><table class="table image-items-table"><thead><tr><th>النص</th><th>${doc.type==='purchase'?'مادة':'وجبة'}</th>${doc.type==='purchase'?'<th>الوحدة</th>':''}<th>الكمية</th><th>سعر الوحدة</th><th>${doc.type==='purchase'?'خصم بالسعر':'خصم %'}</th><th>إجراء</th></tr></thead><tbody>${htmlRows||`<tr><td colspan="${doc.type==='purchase'?7:6}">لم تُضف بنودًا بعد.</td></tr>`}</tbody></table></div>
              <button type="button" class="btn secondary" data-add-item>إضافة بند يدوي</button>
            </div>
      </fieldset></div>
      <div class="image-publish-panel"><h3>${T.publish}</h3>
        ${doc.type==='order'?`<div class="field image-publish-cashbox"><label>${T.cashbox}</label><select data-doc="cashbox_id" ${locked||processing?'disabled':''}>${catalogOptions(catalog.cashboxes.filter(c=>c.is_active!==false),doc.cashbox_id,'--')}</select></div>`:''}
          ${check.ready?'<div class="notice sage">جميع الحقول الإلزامية مكتملة. راجع الصورة قبل النشر.</div>':`<div class="notice image-missing"><strong>للاستكمال:</strong> ${esc(check.problems.slice(0,7).join('، ')||'تحقق من البيانات')}</div>`}
          <div class="image-detail-actions">
            <button type="button" class="btn secondary" data-save-local ${locked||processing?'disabled':''}>حفظ محلي</button>
            <button type="button" class="btn secondary" data-save-draft ${locked||processing||!check.ready?'disabled':''}>إضافة للبرنامج كمسودة</button>
            <button type="button" class="btn" data-publish ${processing||!check.ready||doc.status==='published'||doc.status==='uncertain'?'disabled':''}>نشر في البرنامج</button>
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
      catalog_query:tr.querySelector('[data-field="catalog_query"]')?.value||'',
      catalog_id:exactCatalogId(tr.querySelector('[data-field="catalog_query"]')?.value||'',doc.type==='purchase'?catalog.materials:catalog.menu),
      new_base_unit_id:tr.querySelector('[data-field="new_base_unit_id"]')?.value||'',
      unit_id:tr.querySelector('[data-field="unit_id"]')?.value||'',
      quantity:tr.querySelector('[data-field="quantity"]')?.value||'',
      unit_price:tr.querySelector('[data-field="unit_price"]')?.value||'',
      discount:tr.querySelector('[data-field="discount"]')?.value||'0',
    }));
    if(doc.text||doc.items.length)doc.status='review';
  }
  async function saveCurrent(){syncEditor();const doc=getCurrent();if(doc)await saveLocalImage(doc);}
  const updateProgress=text=>{const el=root.querySelector('#image-progress');if(el)el.textContent=text;};
  function updateOcrPercentage(mode,pct,label){
    const number=Math.max(0,Math.min(100,Math.round(Number(pct)||0)));
    root.querySelectorAll('[data-ocr],[data-bulk-ocr]').forEach(btn=>{
      const pill=btn.querySelector('.ocr-progress-pill');if(!pill)return;
      const matches=(btn.dataset.ocr||btn.dataset.bulkOcr)===mode;
      pill.hidden=!matches;
      if(matches)pill.textContent=`${number}%`;
      btn.disabled=processing;
    });
    updateProgress(`${label} — ${number}%`);
  }


  async function extractOne(doc,mode,index=0,count=1){
    if(['draft','published','uncertain'].includes(doc.status))return 'تجاوز مستندًا أُضيف للبرنامج بالفعل.';
    if(doc.text?.trim() && !(await confirmBox(`سوف يُستبدل النص المستخرج سابقًا من «${doc.file_name}». البنود المعدّلة لن تُمس. هل تتابع؟`,'استبدال النص فقط')))return 'لم يتغير النص.';
    const result=await recognizeCloudImage(doc.file,{engine:Number(mode),crop:doc.crop,onProgress:(step,percent)=>{
      const overall=(index*100+percent)/count;
      updateOcrPercentage(mode,overall,`${doc.file_name}: ${step}`);
    }});
    // CRITICAL: OCR only writes text. No implicit parse or item creation.
    doc.text=result.text||'';
    doc.ocr_mode=mode;doc.ocr_confidence=result.confidence;
    if(result.usage){usage=result.usage;updateUsageDisplays();}
    doc.status='review';doc.error=result.quality?.uncertain?'نتيجة استخراج غير موثوقة: راجع النص الأصلي قبل إنشاء البنود.':null;
    await saveLocalImage(doc);
    return result.quality?.uncertain?'استُخرج النص فقط، لكنه منخفض الثقة؛ راجعه ثم أضف البنود يدويًا.':'استُخرج النص فقط. راجعه ثم اضغط تحويل النص إلى بنود إن رغبت.';
  }
  async function extractMany(docs,mode){
    if(processing)return;
    if(!docs.length){toast('أضف صورة أولًا أو اختر صورًا للمعالجة.','error');return;}
    processing=true;
    let done=0,failed=0;
    updateOcrPercentage(mode,0,`تجهيز ${docs.length} صورة`);
    for(const doc of docs){
      try{await extractOne(doc,mode,done,docs.length);}
      catch(error){failed++;doc.error=String(error.message||error);await saveLocalImage(doc).catch(()=>{});toast(`تعذّر استخراج ${doc.file_name}: ${error.message||error}`,'error');}
      done++;
      updateOcrPercentage(mode,done*100/docs.length,`عولجت ${done} من ${docs.length} صور`);
    }
    processing=false;
    try{usage=await fetchOcrUsage();usageError='';}catch(e){usageError=String(e.message||e);}
    refresh();updateProgress(`انتهت قراءة ${done} صورة؛ تعذّر استخراج ${failed}. لم تُنشأ أي بنود تلقائيًا.`);
  }
  async function resolveNewMaterials(doc){
    if(doc.type!=='purchase')return;
    const pending=newMaterialsFor(doc);
    if(!pending.length)return;
    let latest=await api.materials();
    for(const item of pending){
      const name=String(item.catalog_query||item.name||'').trim();
      const matches=latest.filter(m=>normalizedName(m.name)===normalizedName(name));
      if(matches.length>1)throw new Error('Multiple materials share the same name: '+name);
      const existing=matches[0];
      if(existing){
        if(String(existing.base_unit_id)!==String(item.new_base_unit_id))throw new Error('Existing material unit conflict: '+name);
        item.catalog_id=String(existing.id);item.unit_id=String(existing.base_unit_id);
        if(!catalog.materials.some(m=>String(m.id)===String(existing.id)))catalog.materials.push(existing);
      }else{
        const unit=catalog.units.find(u=>String(u.id)===String(item.new_base_unit_id));
        if(!unit||!baseUnits().some(u=>String(u.id)===String(unit.id)))throw new Error('Choose a standard base unit for: '+name);
        const code=await api.nextMaterialCode(latest);
        // A safe, minimal new material: no invented opening stock or cost.
        const created=await api.insertFirst('materials',[
          {name,quick_code:code,base_unit_id:unit.id},
          {name,code,base_unit_id:unit.id},
        ]);
        item.catalog_id=String(created.id);item.unit_id=String(unit.id);
        catalog.materials.push(created);latest.push(created);
        await api.ensureStandardMaterialUnits(created,catalog.units);
      }
      await saveLocalImage(doc);
    }
  }
  function namesOfNew(doc){return newMaterialsFor(doc).map(item=>`${item.catalog_query||item.name} (${unitDisplay(catalog.units.find(u=>String(u.id)===String(item.new_base_unit_id)))})`);}
  async function createDraft(doc){
    let check=validateImageDocument(doc,catalog);
    if(!check.ready)throw new Error('أكمل الحقول أولًا: '+check.problems.join('، '));
    if(doc.server_id)throw new Error('هذه الصورة مرتبطة بمستند موجود. افتحه للتحقق بدل إنشاء نسخة ثانية.');
    await resolveNewMaterials(doc);
    check=validateImageDocument(doc,catalog);
    if(!check.ready)throw new Error('Material resolution failed: '+check.problems.join(', '));
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
  async function createDishDialog(index){
    const doc=getCurrent();if(!doc||doc.type!=='order')return;
    const item=doc.items[index];if(!item)return;
    const options=(rows,selected='',placeholder='--')=>catalogOptions(rows,selected,placeholder);
    const makeIngredient=(selectedId='',quantity='')=>{
      const id='r-'+Math.random().toString(36).slice(2);
      const material=catalog.materials.find(m=>String(m.id)===String(selectedId));
      const related=material?allowedUnits({catalog_id:material.id}):[];
      return `<div class="image-recipe-row" data-recipe-row><label>${T.ingredient}<select data-recipe="material">${options(catalog.materials,selectedId)}</select></label><label>${T.qty}<input type="number" min="0.000001" step="any" data-recipe="quantity" value="${esc(quantity)}"></label><label>${T.unit}<select data-recipe="unit">${options(related,material?.base_unit_id||'')}</select></label><button class="mini-btn danger-lite" data-recipe-remove type="button">×</button></div>`;
    };
    const entered=String(item.catalog_query||item.name||'').trim();
    const m=modal({
      title:T.newDish,subtitle:T.recipeWarning,wide:true,submitText:T.saveDish,
      body:`<div class="form-grid"><div class="field"><label>${T.dishName}</label><input name="dish-name" required value="${esc(entered)}"></div><div class="field"><label>${T.dishPrice}</label><input name="dish-price" type="number" min="0.00001" step="any" value="${esc(item.unit_price||'')}" required></div></div>
        <h4>${T.recipeTitle}</h4><p class="metric-note">${T.recipeWarning}</p><div data-recipe-list></div><button type="button" class="mini-btn" data-recipe-add>${T.addIngredient}</button>`,
      onSubmit:async(fd,form)=>{
        try{
          const name=String(fd.get('dish-name')||'').trim();
          const price=Number(fd.get('dish-price'));
          if(!name||!Number.isFinite(price)||price<=0)throw new Error('A valid name and price are required');
          const same=catalog.menu.find(p=>normalizedName(p.name)===normalizedName(name));
          if(same)throw new Error('This menu item already exists. Select it from search results.');
          const components=[...form.querySelectorAll('[data-recipe-row]')].map(tr=>({materialId:tr.querySelector('[data-recipe="material"]').value,unitId:tr.querySelector('[data-recipe="unit"]').value,quantity:Number(tr.querySelector('[data-recipe="quantity"]').value)})).filter(c=>c.materialId||c.unitId||c.quantity>0);
          for(const c of components){
            if(!catalog.materials.some(x=>String(x.id)===c.materialId)||!c.unitId||!Number.isFinite(c.quantity)||c.quantity<=0)throw new Error('Complete every recipe material, unit and quantity');
          }
          // Create once. On partial recipe failure keep created item linked, never duplicate on retry.
          const created=await api.createMenuItem({name,price});
          catalog.menu.push(created);
          item.catalog_id=String(created.id);item.catalog_query=name;item.name=name;item.unit_price=String(price);
          await saveLocalImage(doc);
          let recipeComplete=true;
          for(const c of components){
            try{await api.addRecipeItem({menuItemId:created.id,materialId:c.materialId,unitId:c.unitId,quantity:c.quantity});}
            catch(error){recipeComplete=false;toast('Recipe not fully saved. Open the item recipe to complete it: '+(error.message||error),'error');break;}
          }
          if(recipeComplete)toast(T.saveDish,'success');
          refresh();return true;
        }catch(error){toast(error.message||'Could not create menu item','error');return false;}
      }
    });
    const list=m.form.querySelector('[data-recipe-list]');
    const setUnits=tr=>{
      const mat=catalog.materials.find(x=>String(x.id)===String(tr.querySelector('[data-recipe="material"]').value));
      const related=mat?allowedUnits({catalog_id:mat.id}):[];
      tr.querySelector('[data-recipe="unit"]').innerHTML=options(related,mat?.base_unit_id||'');
    };
    m.form.querySelector('[data-recipe-add]').onclick=()=>{list.insertAdjacentHTML('beforeend',makeIngredient());};
    list.addEventListener('change',e=>{if(e.target.matches('[data-recipe="material"]'))setUnits(e.target.closest('[data-recipe-row]'));});
    list.addEventListener('click',e=>{const b=e.target.closest('[data-recipe-remove]');if(b)b.closest('[data-recipe-row]').remove();});
    list.insertAdjacentHTML('beforeend',makeIngredient());
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
    const extras=ready.flatMap(namesOfNew);
    if(!(await confirmBox(`سيتم نشر ${ready.length} مستند مكتمل ماليًا بعد مراجعتك. سيبقى ${skipped} مستند غير مكتمل دون نشر. ${extras.length?T.newConfirm+' '+extras.join('، '):''} هل تؤكد؟`,'تأكيد النشر')))return;
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
      currentId=el.dataset.openImage;cropMode=false;refresh();
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
    root.querySelector('[data-toggle-crop]')?.addEventListener('click',async()=>{
      try{await saveCurrent();cropMode=!cropMode;refresh();}
      catch(error){toast('تعذر حفظ التعديلات قبل تحديد المنطقة.','error');}
    });
    root.querySelector('[data-reset-crop]')?.addEventListener('click',async()=>{
      await saveCurrent();const doc=getCurrent();if(!doc)return;doc.crop=null;cropMode=false;
      await saveLocalImage(doc);refresh();
    });
    const cropSurface=root.querySelector('[data-crop-surface]');
    if(cropSurface && cropMode){
      let start=null;
      const selection=cropSurface.querySelector('[data-crop-selection]');
      const coords=e=>{
        const r=cropSurface.querySelector('img').getBoundingClientRect();
        return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};
      };
      cropSurface.addEventListener('pointerdown',e=>{
        if(processing)return;
        start=coords(e);cropSurface.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      cropSurface.addEventListener('pointermove',e=>{
        if(!start)return;
        const now=coords(e);
        const x=Math.min(start.x,now.x),y=Math.min(start.y,now.y);
        const w=Math.abs(now.x-start.x),h=Math.abs(now.y-start.y);
        selection.hidden=false;
        Object.assign(selection.style,{left:`${x*100}%`,top:`${y*100}%`,width:`${w*100}%`,height:`${h*100}%`});
      });
      cropSurface.addEventListener('pointerup',async e=>{
        if(!start)return;
        const now=coords(e),x=Math.min(start.x,now.x),y=Math.min(start.y,now.y);
        const w=Math.abs(now.x-start.x),h=Math.abs(now.y-start.y);start=null;
        if(w<0.035||h<0.035){toast('حدد منطقة أكبر حتى يمكن قراءتها.','error');return;}
        const doc=getCurrent();if(!doc)return;doc.crop={x,y,w,h};cropMode=false;
        try{await saveLocalImage(doc);refresh();}
        catch(error){toast('تعذر حفظ منطقة القراءة محليًا.','error');}
      });
    }
    root.querySelectorAll('[data-ocr]').forEach(btn=>btn.onclick=async()=>{
      try{await saveCurrent();await extractMany(getCurrent()?[getCurrent()]:[],btn.dataset.ocr);}catch(error){toast(error.message||'تعذر استخراج الصورة','error');}
    });
    root.querySelector('[data-doc="type"]')?.addEventListener('change',async e=>{
      syncEditor();const doc=getCurrent();doc.type=e.target.value;
      doc.items=doc.items.map(item=>({...item,catalog_id:'',unit_id:''}));
      await saveLocalImage(doc);refresh();
    });
    root.querySelectorAll('[data-field="catalog_query"]').forEach(input=>{
      input.addEventListener('input',()=>{
        const tr=input.closest('[data-image-item]');
        const chosen=exactCatalogId(input.value,getCurrent()?.type==='purchase'?catalog.materials:catalog.menu);
        const id=tr.querySelector('[data-field="catalog_id"]');if(id)id.value=chosen;
        const addUnit=tr.querySelector('.image-new-unit');if(addUnit)addUnit.hidden=!!chosen;
      });
      input.addEventListener('change',async()=>{
        syncEditor();const doc=getCurrent();const i=Number(input.closest('[data-image-item]')?.dataset.imageItem);const item=doc.items[i];
        if(doc.type==='purchase'&&item?.catalog_id){
          const mat=catalog.materials.find(m=>String(m.id)===String(item.catalog_id));
          item.unit_id=mat?.base_unit_id||'';
        }
        await saveLocalImage(doc);refresh();
      });
    });
    root.querySelectorAll('[data-create-menu]').forEach(btn=>btn.onclick=async()=>{
      try{await saveCurrent();await createDishDialog(Number(btn.dataset.createMenu));}
      catch(error){toast(error.message||'Unable to open recipe dialog','error');}
    });
    root.querySelector('[data-reparse]')?.addEventListener('click',async()=>{
      syncEditor();const doc=getCurrent();
      if(doc.items?.length && !(await confirmBox('ستُستبدل البنود الحالية بنتيجة النص المعدّل. هل تتابع؟','استبدال البنود')))return;
      const list=doc.type==='purchase'?catalog.materials:catalog.menu;
      const rows=reviewedOcrItemCandidates(doc.text,list);
      doc.items=autofillExactCatalog(rows,list).map(row=>({...row,unit_id:doc.type==='purchase'?(catalog.materials.find(m=>String(m.id)===String(row.catalog_id))?.base_unit_id||''):''}));
      doc.status='review';await saveLocalImage(doc);refresh();
      if(!rows.length)toast('لم أجد بنودًا واضحة أو متطابقة. صحح النص أولًا أو أضفها يدويًا؛ لن أحوّل النص المشوش إلى فواتير.','error');
    });
    root.querySelector('[data-add-item]')?.addEventListener('click',async()=>{
      syncEditor();const doc=getCurrent();doc.items.push({id:crypto.randomUUID(),name:'',quantity:'',unit_price:'',discount:'0',catalog_id:'',unit_id:''});
      doc.status='review';await saveLocalImage(doc);refresh();
    });
    root.querySelector('[data-clear-items]')?.addEventListener('click',async()=>{
      syncEditor();const doc=getCurrent();if(!doc?.items?.length)return;
      if(!(await confirmBox(`سيتم حذف ${doc.items.length} بندًا محليًا من الصورة الحالية فقط. النص والصورة سيبقيان محفوظين. هل توافق؟`,'حذف جميع البنود')))return;
      doc.items=[];doc.status='review';await saveLocalImage(doc);refresh();
    });
    root.querySelectorAll('[data-remove-item]').forEach(btn=>btn.onclick=async()=>{
      syncEditor();const doc=getCurrent();doc.items.splice(Number(btn.dataset.removeItem),1);
      await saveLocalImage(doc);refresh();
    });
    root.querySelectorAll('[data-doc],[data-field]').forEach(input=>{
      if(input.dataset.doc==='type'||input.dataset.field==='catalog_id'||input.dataset.field==='catalog_query')return;
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
      const extras=namesOfNew(doc);
      if(!(await confirmBox('ستُضاف البيانات إلى Supabase كمسودة، دون نشر مالي. '+(extras.length?T.newConfirm+' '+extras.join('، '):'')+' بعد ذلك تُجرى التعديلات داخل صفحة المستند في البرنامج.','إضافة مسودة')))return;
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
  loadUsage();
}
