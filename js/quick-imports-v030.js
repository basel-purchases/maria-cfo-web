import * as api from './api.js?v=1.0.6';
import {esc} from './utils.js?v=1.0';
import {toast,friendlyError,modal,loader,confirmBox} from './ui.js?v=1.0';
import {readAmeenWorkbook,findReportSheet,parseAmeenRows,sha256Hex} from './ameen-import-parser.js?v=1.0';
import {parseMasterV030,QUICK_TYPES_V030 as TYPES} from './quick-import-parser-v030.js?v=1.0.1';
import {parseEmployeesV031} from './employee-import-parser-v031.js?v=1.0';

let importing=false;
function confirmQuickImport({filename,kind,count}){
 return new Promise(resolve=>{
  let accepted=false;
  modal({title:'تأكيد استيراد الملف',
   subtitle:'راجع الملخص قبل حفظ الملف. لن يتم صرف أي مبلغ مالي تلقائيًا.',
   submitText:'نعم، استيراد الملف',
   body:`<div class="quick-confirm-overview"><div><span>نوع الإدخال</span><strong>${esc(kind)}</strong></div><div><span>اسم الملف</span><strong dir="ltr">${esc(filename)}</strong></div><div><span>السجلات</span><strong>${esc(count)} سجل</strong></div></div>
    <div class="notice rose">ستُحفظ العملية في سجل الإدخالات، ويمكنك التراجع خلال 24 ساعة وفق شروط السلامة. اختر «إلغاء» للعودة إلى المعاينة دون أي تغيير.</div>`,
   onSubmit:async()=>{accepted=true;return true;},onClose:()=>resolve(accepted),
  });
 });
}

const show=x=>esc(String(x??'—'));
const clock=x=>{try{return new Date(x).toLocaleString('ar-SY');}catch{return String(x||'');}};
function errorMessage(err){
 const message=String(err?.message||err||'');
 if(/quick_import_employees_v031|quick_import_employees_undo_v031/i.test(message))
  return 'يجب تشغيل ترحيل قاعدة بيانات v0.31 الخاص بالموظفين في Supabase أولًا، ثم تحديث الصفحة.';
 if(/57014|statement timeout|canceling statement|AbortError|aborted|timeout/i.test(message))
  return 'تجاوز الاستيراد المدة المتوقعة أو انتهت مهلة قاعدة البيانات. تحقق من سجل الإدخالات قبل إعادة المحاولة؛ قد تكون العملية اكتملت على الخادم.';
 if(/quick_import_v030|quick_import_history_v030|PGRST202|42883|schema cache|not found/i.test(message))
  return 'تحقق من تشغيل ترحيل SQL v0.30 ثم ترحيل v0.31 في Supabase، وحدّث الصفحة.';
 if(/EXISTING_EMPLOYEE_PAY_TYPE_OR_CURRENCY_CONFLICT/.test(message))
  return 'هناك موظف بنفس الاسم محفوظ بنوع أجر غير شهري أو بعملة مختلفة. راجع بياناته الحالية قبل الاستيراد؛ لم يتغير أي سجل.';
 if(/EMPLOYEE_NAME_AMBIGUOUS_IN_DATABASE/.test(message))
  return 'يوجد أكثر من موظف بالاسم نفسه في قاعدة البيانات. ميّز الأسماء أولًا؛ لم يُستورد أي صف.';
 if(/UNDO_EMPLOYEE_USED_AFTER_IMPORT|UNDO_EMPLOYEE_CHANGED_AFTER_IMPORT/.test(message))
  return 'لا يمكن التراجع: عُدّلت بيانات الموظف أو استُخدمت في الدوام أو الرواتب أو السلف بعد الاستيراد.';
 return friendlyError(err);
}
function parseWorkbook(kind,workbook){
 if(kind==='master')return parseMasterV030(workbook);
 if(kind==='employees')return parseEmployeesV031(workbook);
 const oldKind=kind==='assets'?'inventory':kind;
 const sheet=findReportSheet(workbook,oldKind);
 const parsed=parseAmeenRows(oldKind,sheet.rows);
 if(kind==='assets'){
  const assets=parsed.records.filter(r=>r.kind==='asset'&&r.warehouse&&Number(r.quantity)>0);
  const ignored=parsed.records.length-assets.length;
  if(!assets.length)throw Error('لا توجد أساسيات مؤهلة. لن يُدخل المنيو أو المواد من هذا الملف.');
  return {records:assets,stats:{assets:assets.length,ignored},warnings:parsed.warnings};
 }
 return {records:parsed.records,stats:parsed.stats,warnings:parsed.warnings};
}
export async function renderQuickImportsV030(root){
 root.innerHTML=`
  <div class="quick-page-v102">
  <div class="page-head"><div><h2>الإدخالات السريعة</h2><p>استيراد مركزي للملفات الخمسة، مع معاينة وسجل وتراجع خلال 24 ساعة.</p></div></div>
  <div class="card quick-upload-card-v102">
    <div class="form-grid">
      <div class="field"><label for="quick-kind-v030">نوع الإدخال</label><select id="quick-kind-v030"><option value="">اختر الملف</option>${Object.entries(TYPES).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('')}</select></div>
      <div class="field"><label for="quick-file-v030">ملف Excel</label><input id="quick-file-v030" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
    </div>
    <button type="button" class="btn" id="quick-preview-v030">معاينة الملف</button>
    <p class="metric-note">الاستيراد لا ينشئ مدفوعات للموردين أو الموظفين، ولا ينشر الأوردرات أو يسجّل مقبوضات. جميع الموظفين المرفوعين من الجدول الخامس رواتبهم شهرية بالليرة السورية (ل.س).</p>
  </div>
  <div id="quick-result-v030" aria-live="polite"></div>
  <div class="card quick-history-card-v102"><h3>سجل الإدخالات والتراجع خلال 24 ساعة</h3><div id="quick-history-v030">${loader()}</div></div>
  </div>`;
 const preview=root.querySelector('#quick-result-v030');
 // A preview is bound to the selected type/file; never confirm a stale selection.
 for(const id of ['quick-kind-v030','quick-file-v030']){
   root.querySelector('#'+id).addEventListener('change',()=>{if(!importing)preview.innerHTML='';});
 }
 async function history(){
  const host=root.querySelector('#quick-history-v030');if(!host)return;
  try{
   const rows=await api.rpc('quick_import_history_v030');
   if(!root.isConnected)return;
   const newestActive=rows?.find(r=>!r.undone_at)?.id;
   host.innerHTML=rows?.length?`<div class="table-wrap"><table class="table"><thead><tr><th>التاريخ</th><th>نوع الملف</th><th>اسم الملف</th><th>النتيجة</th><th>الحالة / التراجع</th></tr></thead><tbody>${rows.map(r=>{
    const sum=r.summary||{};
    const expired=new Date(r.expires_at).getTime()<=Date.now();
    return `<tr><td>${show(clock(r.created_at))}</td><td>${show(TYPES[r.kind]||r.kind)}</td><td>${show(r.filename)}</td><td>${show(`جديد: ${sum.created||0} · تحديث: ${sum.updated||0} · يحتاج مراجعة: ${sum.review||0} · مستبعد: ${sum.skipped||0}`)}</td>
      <td>${r.undone_at?'تم التراجع':expired?'انتهت المهلة':r.id!==newestActive?'تراجع عن الملفات الأحدث أولًا':`<button class="mini-btn danger-lite" data-undo-run="${esc(r.id)}">تراجع</button><small> حتى ${show(clock(r.expires_at))}</small>`}</td></tr>`;
   }).join('')}</tbody></table></div>`:'<p>لا يوجد سجل استيراد بعد.</p>';
   host.querySelectorAll('[data-undo-run]').forEach(btn=>btn.addEventListener('click',async()=>{
    const id=btn.dataset.undoRun;const confirmed=await confirmBox('تراجع نهائي عن بيانات هذا الملف خلال 24 ساعة؟ لا يُسمح بالتراجع إذا استُخدمت البيانات أو تغيرت بعد الاستيراد.', 'تأكيد التراجع');
    if(!confirmed)return;
    btn.disabled=true;
    try{const result=await api.rpc(rows.find(r=>r.id===id)?.kind==='employees'?'quick_import_employees_undo_v031':'quick_import_undo_v030',{p_run_id:id});
     toast(result?.message||'تم التراجع عن الاستيراد.', 'success');await history();
    }catch(e){toast(`لم يُنفذ التراجع: ${errorMessage(e)}`,'error');btn.disabled=false;}
   }));
  }catch(e){host.innerHTML=`<div class="notice">${show(errorMessage(e))}</div>`;}
 }
 root.querySelector('#quick-preview-v030').onclick=async()=>{
  const kind=root.querySelector('#quick-kind-v030').value;
  const file=root.querySelector('#quick-file-v030').files?.[0];
  if(!kind){toast('اختر نوع الإدخال.','error');return;}
  if(!file){toast('اختر ملف Excel.','error');return;}
  const button=root.querySelector('#quick-preview-v030');button.disabled=true;
  preview.innerHTML=loader();
  try{
   const workbook=await readAmeenWorkbook(file);
   const parsed=parseWorkbook(kind,workbook);
   const hash=await sha256Hex(workbook.buffer);
   const payload=kind==='master'?{materials:parsed.materials,dishes:parsed.dishes}:parsed.records;
   const stats=kind==='master'?[['مواد',parsed.stats.materials],['وجبات',parsed.stats.menu],['وصفات مكتملة البيانات',parsed.stats.readyRecipes],['وصفات بحاجة إلى استكمال',parsed.stats.pendingRecipes]]:
     kind==='assets'?[['أساسيات مؤهلة',parsed.records.length],['صفوف أخرى متجاهلة',parsed.stats.ignored]]:
     kind==='employees'?[['موظفون براتب شهري',parsed.stats.employees],['بدون رقم موبايل',parsed.stats.missingPhones],['بدون عنوان سكن',parsed.stats.missingResidences]]:
     kind==='orders'?[['أوردرات',parsed.records.length],['بنود الأوردرات',parsed.stats.sourceRows],['تحتاج مراجعة',parsed.stats.needsReview]]:
     [['حركات الموردين',parsed.records.length],['الموردون',parsed.stats.suppliers]];
   preview.innerHTML=`<div class="card quick-preview-card-v102"><h3>معاينة: ${show(file.name)}</h3>
    <div class="quick-metrics-v102">${stats.map(([l,n])=>`<div class="card"><strong>${show(n)}</strong><div class="metric-note">${show(l)}</div></div>`).join('')}</div>
    ${kind==='master'?'<div class="notice">المنيو يُضاف بسعر البيع ولو لم تكتمل وصفته. تُحفظ المكونات الناقصة للمراجعة، ولا تُنشر كتكلفة جزئية.</div>':''}
    ${kind==='assets'?'<div class="notice">سيستورد البرنامج الأساسيات فقط؛ يُتجاهل أي قسم منيو أو مواد في الملف.</div>':''}
    ${kind==='orders'?'<div class="notice">سيُنشئ أوردرات مسودات، وقد ينشئ أسماء أصناف مبيعات ناقصة في المنيو مع علامة مراجعة. لن تُنشر أي مبيعات.</div>':''}
    ${kind==='employees'?'<div class="notice">كل الموظفين من هذا الملف يتقاضون راتبًا شهريًا بالليرة السورية بغض النظر عن المهنة. سيتم تحديث الموظف الشهري الموجود بالاسم نفسه بدل تكراره، مع الحفاظ على البيانات الناقصة في Excel إن كانت موجودة مسبقًا. الموظف الموجود بنوع أجر مختلف سيوقف الاستيراد دون تغيير البيانات.</div>':''}
    ${kind==='employees'?`<details open><summary>معاينة أسماء ورواتب الموظفين (${parsed.records.length})</summary><div class="table-wrap" style="max-height:360px;overflow:auto"><table class="table"><thead><tr><th>الاسم</th><th>الوظيفة</th><th>السكن</th><th>الموبايل</th><th>الراتب الشهري (ل.س)</th></tr></thead><tbody>${parsed.records.map(r=>`<tr><td>${show(r.name)}</td><td>${show(r.jobTitle)}</td><td>${show(r.residence)}</td><td>${show(r.phone)}</td><td>${show(r.monthlySalary.toLocaleString('en-US'))}</td></tr>`).join('')}</tbody></table></div></details>`:''}
    ${kind==='orders'&&parsed.records.some(r=>r.reviewReasons?.length)?`<details><summary>أوردرات تحتاج مراجعة (${parsed.records.filter(r=>r.reviewReasons?.length).length})</summary><div style="max-height:240px;overflow:auto">${parsed.records.filter(r=>r.reviewReasons?.length).map(r=>`<p><strong>أوردر ${show(r.number)}:</strong> ${show(r.reviewReasons.join('؛ '))}</p>`).join('')}</div></details>`:''}
    ${parsed.warnings?.length?`<details ${kind==='employees'?'open':''}><summary>تنبيهات الملف (${parsed.warnings.length})</summary><div style="max-height:220px;overflow:auto">${parsed.warnings.slice(0,30).map(w=>`<div>${show(w.row)}: ${show(w.message)}</div>`).join('')}</div></details>`:''}
    <button type="button" class="btn" id="quick-confirm-v030">تأكيد استيراد ${show(String(TYPES[kind]||kind).replace(/^\d{2}\s*·\s*/,''))}</button>
    <p class="metric-note">كل ملف عملية واحدة في Supabase. تراجع 24 ساعة من وقت الاستيراد، وقد يُرفض لحماية بيانات أُجري عليها تعديل لاحق.</p></div>`;
   // The master workbook has materials[] and dishes[], NOT records[].
   // Reading parsed.records.length previously threw BEFORE opening the confirmation dialog,
   // leaving the button disabled forever and never calling Supabase.
   const importRecordCount=kind==='master' ? parsed.materials.length+parsed.dishes.length : parsed.records.length;
   async function commitImport(){
    if(importing)return;
    const submit=preview.querySelector('#quick-confirm-v030, #quick-retry-v102');
    if(root.querySelector('#quick-kind-v030').value!==kind || root.querySelector('#quick-file-v030').files?.[0]!==file){
      toast('تغيّر الملف أو نوعه، يرجى إجراء معاينة جديدة.','error');preview.innerHTML='';return;
    }
    if(submit)submit.disabled=true;
    let confirmed=false;
    try{confirmed=await confirmQuickImport({filename:file.name,kind:TYPES[kind],count:importRecordCount});}
    catch(e){
      const message=errorMessage(e);
      preview.insertAdjacentHTML('afterbegin',`<div class="notice quick-error-v102" role="alert">تعذر فتح نافذة التأكيد: ${show(message)}</div>`);
      toast(message,'error');
      if(submit)submit.disabled=false;
      return;
    }
    if(!confirmed){if(submit)submit.disabled=false;return;}
    if(importing || root.querySelector('#quick-kind-v030').value!==kind || root.querySelector('#quick-file-v030').files?.[0]!==file){
      if(submit)submit.disabled=false;
      toast('تغيّر الملف خلال التأكيد. أعد المعاينة ثم حاول مجددًا.','error');return;
    }
    importing=true;
    const kindSelect=root.querySelector('#quick-kind-v030');
    const fileInput=root.querySelector('#quick-file-v030');
    const previewButton=root.querySelector('#quick-preview-v030');
    [kindSelect,fileInput,previewButton].forEach(element=>{if(element)element.disabled=true;});
    const started=Date.now();
    const abort=new AbortController();
    let hardLimitReached=false;
    const timeout=setTimeout(()=>{hardLimitReached=true;abort.abort();},120000);
    const statusMarkup=`<div class="card quick-progress-card-v102" role="status" aria-live="polite">
      <div class="quick-progress-heading-v102"><span class="quick-progress-spinner-v102" aria-hidden="true"></span><div><h3>جاري استيراد ${show(TYPES[kind])}</h3><p>يُرسَل الملف إلى قاعدة البيانات في عملية واحدة. انتظر ردّ الخادم ولا تعِد الضغط على الزر.</p></div></div>
      <div class="quick-progress-foot-v102"><span id="quick-elapsed-v102">الوقت المنقضي: 0 ثانية</span><span>${show(importRecordCount)} سجل قيد المعالجة</span></div>
      <p class="quick-progress-hint-v102" id="quick-long-wait-v102">يمكن أن يستغرق حفظ المواد والوصفات بعض الوقت. ستظهر النتيجة هنا، أو رسالة واضحة عند وجود خطأ.</p>
    </div>`;
    preview.innerHTML=statusMarkup;
    const tick=()=>{
      const seconds=Math.floor((Date.now()-started)/1000);
      const label=preview.querySelector('#quick-elapsed-v102');
      if(label)label.textContent=`الوقت المنقضي: ${seconds} ثانية`;
      const hint=preview.querySelector('#quick-long-wait-v102');
      if(hint&&seconds>=30)hint.textContent='الاستيراد يستغرق وقتًا أطول من المعتاد. لا تعِد إرسال الملف؛ ننتظر نتيجة الخادم أو فحص السجل.';
    };
    const ticker=setInterval(tick,1000);
    try{
      const result=kind==='employees'
       ?await api.rpc('quick_import_employees_v031',{p_filename:file.name,p_sha256:hash,p_payload:payload},{signal:abort.signal})
       :await api.rpc('quick_import_v030',{p_kind:kind,p_filename:file.name,p_sha256:hash,p_payload:payload},{signal:abort.signal});
      if(root.isConnected){
       preview.innerHTML=`<div class="card quick-result-card-v102"><h3>${result?.duplicateFile?'الملف مستورد سابقًا':'اكتمل الاستيراد بنجاح'}</h3>
        <p>جديد: ${show(result?.created||0)} · تحديث: ${show(result?.updated||0)} · بحاجة مراجعة: ${show(result?.review||0)} · مستبعد: ${show(result?.skipped||0)}</p>
        ${result?.recipesPublished!=null?`<p>وصفات أُدرجت بالتكلفة: ${show(result.recipesPublished)} · وصفات غير مكتملة: ${show(result.recipesPending||0)}</p>`:''}
        ${result?.ordersDraft!=null?`<p>أوردرات مسودة: ${show(result.ordersDraft)}، ولا توجد حركة نقدية منشورة.</p>`:''}
        ${kind==='employees'?'<p>الأجر: شهري · العملة: ل.س · لم تُنشأ رواتب مدفوعة أو حركات صندوق.</p><a class="btn secondary" href="#/employees-list">عرض قائمة الموظفين</a>':''}
        </div>`;
      }
      toast(result?.duplicateFile?'الملف موجود في سجل الاستيراد.':'اكتمل الاستيراد وسُجلت العملية.','success');
    }catch(e){
      const detail=hardLimitReached?'لم يصل ردّ خلال دقيقتين. قد يكون الخادم ما زال يعالج الملف.':errorMessage(e);
      console.error('Quick import failed',e);
      if(root.isConnected){
       preview.innerHTML=`<div class="card quick-result-card-v102"><h3>لم نتلقَّ تأكيد نجاح الاستيراد</h3>
         <div class="notice quick-error-v102" role="alert">${show(detail)}${e?.code?` <small>رمز الخطأ: ${show(e.code)}</small>`:''}</div>
         <p class="quick-result-help-v102">تحقق من سجل الإدخالات بالأسفل أولًا. إذا لم يظهر الملف، يمكنك إعادة المحاولة باستخدام <strong>الملف نفسه</strong>؛ تتحقق قاعدة البيانات من بصمته لمنع تكرار الاستيراد.</p>
         <button class="btn secondary" type="button" id="quick-retry-v102">إعادة المحاولة بالملف نفسه</button>
       </div>`;
       preview.querySelector('#quick-retry-v102')?.addEventListener('click',commitImport);
      }
      toast(detail,'error');
    }finally{
      clearInterval(ticker);clearTimeout(timeout);importing=false;
      [kindSelect,fileInput,previewButton].forEach(element=>{if(element&&element.isConnected)element.disabled=false;});
      await history();
    }
   }
   preview.querySelector('#quick-confirm-v030').onclick=commitImport;
  }catch(e){preview.innerHTML=`<div class="notice">${show(errorMessage(e))}</div>`;toast(errorMessage(e),'error');}
  finally{button.disabled=false;}
 };
 await history();
}
