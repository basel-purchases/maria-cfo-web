// Maria CFO v1.0.26 — controlled historical purchases, menu-only and dated count imports.
import * as api from '../api.js?v=1.0.26';
import {esc} from '../utils.js?v=1.0';
import {toast,friendlyError,confirmBox,loader} from '../ui.js?v=1.0.25';
import {readAmeenWorkbook,sha256Hex} from '../ameen-import-parser.js?v=1.0.26';
import {parseMasterV030} from '../quick-import-parser-v030.js?v=1.0.1';
import {parseHistoryInvoicesV126,parsePhysicalCountV126} from '../baseline-parsers-v126.js?v=1.0.26';

const kinds={history:'أرشيف فواتير الشراء الشامل (الأمين)',menu:'المنيو والوصفات فقط — بلا أي تعديل للكميات',count:'الجرد الفعلي بتاريخ العد'};
const num=n=>Number(n||0).toLocaleString('ar-SY',{maximumFractionDigits:4});
let inFlight=false;
function chunks(arr,n){const list=[];for(let i=0;i<arr.length;i+=n)list.push(arr.slice(i,i+n));return list;}
function summarize(kind,p){
 if(kind==='history')return [['الفواتير',p.stats.invoices],['بنود شراء',p.stats.lines],['الموردون',p.stats.suppliers],['مواد متنوعة',p.stats.materials],['القيمة ل.س',num(p.stats.totalNet)],['صفوف بلا وحدة',p.stats.missingUnits]];
 if(kind==='menu')return [['المواد في الملف',p.stats.materials],['أصناف المنيو',p.stats.menu],['وصفات مكتملة في المصدر',p.stats.readyRecipes],['تحتاج إكمال',p.stats.pendingRecipes]];
 return [['أقسام',p.stats.sections],['كميات معتمدة',p.stats.approved],['أسطر غير مكتملة أو للمراجعة',p.stats.review],['مواد لم تُجرد',p.stats.empty]];
}
const asMessage=e=>friendlyError(e,'تعذر الاستيراد. افحص الترحيل والإصدار ووحدات المواد.');
export async function renderBaselineImportsV126(root){
 root.innerHTML=`<div class="quick-page-v102"><div class="page-head"><div><h2>استيراد تأسيس البيانات والجرد</h2>
 <p>مرحلة التأسيس: فواتير الموردين التاريخية ← منيو دون كميات ← جرد بتاريخ العد ← أوردرات الأمين في صفحتها الخاصة.</p></div></div>
 <div class="notice">هذه الواجهة <strong>لا تصفّر قاعدة البيانات</strong>. قبل التأسيس احفظ Backup قابلًا للاستعادة، وطبّق ترحيل SQL v1.0.26. فواتير الأمين المرفقة بالليرة السورية فقط وتُحفظ كفواتير تاريخية <strong>مصفاة خارج النظام بحسب إفادتك</strong> بلا دين جديد أو صرف نقدي، ولا يُخترَع سعر دولار.</div>
 <div class="card"><h3>اختر العملية وملف Excel</h3><div class="form-grid">
 <div class="field"><label>نوع الاستيراد</label><select id="v126-kind">${Object.entries(kinds).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
 <div class="field"><label>ملف Excel</label><input id="v126-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
 </div><div class="notice">في الجرد المبسط تُستخدم الأعمدة الخمسة: اسم المادة، الكمية، الواحدة، التاريخ، ملاحظات. تُستورد الكميات التي لها وحدة وتاريخ صالحان فقط، وتُترك الخانات الفارغة دون تغيير. ويبقى النموذج المفصل القديم مدعومًا.</div>
 <button class="btn" id="v126-review">تحليل الملف ومعاينة البيانات</button></div>
 <div id="v126-result" aria-live="polite"></div>
 <div class="card"><h3>المعاملات اللاحقة</h3><p>استخدم <a href="#/daily-orders">استيراد الأوردرات</a> بعد التأسيس. استيراد لقطات أوردرات الأمين لا يعني تلقائيًا أنها خصمت مواد وصفاتها؛ الاعتماد والنشر والخصم يتبع مسار الأوردرات القائم. أي ملف أوردرات ثالث غير مرفق يحتاج اختبارًا منفصلًا.</p>
 <p class="metric-note">لا تُغيّر أسماء المواد أو وحدات العبوة على أساس تشابه الاسم فقط. الجرد المتأخر يستخدم أرصدة التاريخ وحركات المخزون اللاحقة، ولا يعتمد على خانة كمية يوم الرفع.</p></div></div>`;
 const kindInput=root.querySelector('#v126-kind'),fileInput=root.querySelector('#v126-file'),result=root.querySelector('#v126-result'),review=root.querySelector('#v126-review');
 let selection=0;const changed=()=>{selection++;result.innerHTML='';};kindInput.onchange=changed;fileInput.onchange=changed;
 review.onclick=async()=>{
  if(inFlight)return;
  const file=fileInput.files?.[0],kind=kindInput.value;
  if(!file){toast('اختر ملف Excel أولًا','error');return;}
  const token=selection;review.disabled=true;result.innerHTML=loader();
  try{
   const workbook=await readAmeenWorkbook(file);
   const sha=await sha256Hex(workbook.buffer);
   const parsed=kind==='history'?parseHistoryInvoicesV126(workbook):kind==='menu'?parseMasterV030(workbook):parsePhysicalCountV126(workbook);
   if(token!==selection)return;
   const issues=parsed.issues||parsed.warnings||[];
   const metrics=summarize(kind,parsed);
   const count=kind==='history'?parsed.records.length:kind==='menu'?parsed.dishes.length:parsed.records.length;
   result.innerHTML=`<div class="card"><h3>المعاينة: ${esc(file.name)}</h3>
    <div class="quick-metrics-v102">${metrics.map(([label,v])=>`<div class="card"><strong>${esc(String(v))}</strong><div class="metric-note">${esc(label)}</div></div>`).join('')}</div>
    ${kind==='history'?`<div class="notice">القيمة محفوظة بعملة SYP كما في تقرير الأمين، ولا يضاف دولار ولا يولد قبض أو سحب بالصندوق. حفظ التاريخ والسعر والكمية وفق سطور الفاتورة؛ الفواتير التاريخية مؤشرة «مصفاة خارج البرنامج بحسب الإدارة». ${parsed.stats.missingUnits?'توجد ${parsed.stats.missingUnits} وحدات شراء ناقصة: يجب اعتمادها يدويًا أو قبول استخدام «قطعة» مؤقتًا بوضوح.':''}</div>
      ${parsed.stats.missingUnits?'<label><input id="v126-missing-unit" type="checkbox"> أوافق صراحة على استيراد الوحدات الناقصة كـ«قطعة» مؤقتًا وأتحمل مراجعتها وتصحيح عبواتها</label>':''}`:''}
    ${kind==='menu'?'<div class="notice">هذا المسار يستورد كتالوج المواد والمنيو والوصفات المناسبة فقط، دون أي تعديل لأرصدة المخزون أو حركة الفواتير التاريخية. الوصفات الناقصة لا تُنشر بتكلفة صفر.</div>':''}
    ${kind==='count'?`<div class="notice">سيُستخدم الجرد المعتمد في نهاية تاريخ كل سطر: الرصيد الحالي = الكمية المعدودة + صافي الحركات بعد ذلك التاريخ. ${parsed.stats.review} صفًا غير مكتمل أو للمراجعة و${parsed.stats.empty} دون كمية؛ لن تُعدّل كمياتها.</div>`:''}
    ${issues.length?`<details><summary>ملاحظات المصدر (${issues.length})</summary><div style="max-height:220px;overflow:auto">${issues.slice(0,35).map(i=>`<p>${esc(typeof i==='string'?i:(i.message||JSON.stringify(i)))}</p>`).join('')}</div></details>`:''}
    ${kind==='count'?'<label><input type="checkbox" id="v126-create-missing"> أسمح بإنشاء مادة جديدة من سطر جرد «معتمد» لا يوجد اسمها في الفواتير والمنيو (دون افتراض سعر شراء)</label>':''}
    <button class="btn" id="v126-commit" ${!count?'disabled':''}>اعتماد وبدء الاستيراد (${count} ${kind==='history'?'فاتورة':kind==='menu'?'صنف':'كمية'})</button>
    <p class="metric-note">الاستيراد مجزّأ إلى معاملات آمنة، وإعادة رفع الملف لا تكرر الفواتير أو قيود الجرد نفسها. لا تغادر الصفحة أثناء التنفيذ.</p>
    <div id="v126-progress" role="status" aria-live="polite"></div></div>`;
   const submit=result.querySelector('#v126-commit'),progress=result.querySelector('#v126-progress');
   submit.onclick=async()=>{
    if(inFlight)return;
    if(token!==selection||kind!==kindInput.value||file!==fileInput.files?.[0]){toast('تغيّر اختيار الملف، أعد المعاينة','error');return;}
    if(kind==='history'&&parsed.stats.missingUnits&&!result.querySelector('#v126-missing-unit')?.checked){toast('أكد مراجعة الوحدات الثلاث الناقصة قبل الاستيراد.','error');return;}
    const accepted=await confirmBox(kind==='history'?`استيراد ${parsed.stats.invoices} فاتورة تاريخية بعملة SYP، واعتبارها مصفاة خارج النظام دون دفع نقدي أو ديون جديدة؟`:
      kind==='menu'?`اعتماد ${parsed.dishes.length} صنف منيو دون استيراد أي رصيد افتتاحي أو تعديل أرصدة المخزون الحالية؟`:
      `اعتماد ${parsed.records.length} سطر جرد، مع تصحيح مخزون التاريخ وإعادة احتساب الحركات اللاحقة؟ استخدم نسخة احتياطية قبل الإجراء.`,
      'تأكيد الحفظ المالي');
    if(!accepted)return;
    if(token!==selection)return;
    inFlight=true;submit.disabled=true;review.disabled=true;kindInput.disabled=true;fileInput.disabled=true;
    let done=0,total=0;
    try{
     const blocks=kind==='history'?chunks(parsed.records,12):kind==='menu'?[parsed]:chunks(parsed.records.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name)),85);
     for(let i=0;i<blocks.length;i++){
      progress.innerHTML=`<div class="notice">جاري اعتماد المعاملة ${i+1} من ${blocks.length} · تم ${done} سجل. في حالة انقطاع الاتصال، أعد رفع الملف ذاته ليستكمل دون تكرار السجلات السابقة.</div>`;
      const payload=kind==='history'?{p_sha256:sha,p_documents:blocks[i],p_accept_missing_units:Boolean(result.querySelector('#v126-missing-unit')?.checked)}:
        kind==='menu'?{p_sha256:sha,p_filename:file.name,p_payload:{materials:parsed.materials,dishes:parsed.dishes}}:
        {p_sha256:sha,p_records:blocks[i],p_create_missing:Boolean(result.querySelector('#v126-create-missing')?.checked)};
      const fn=kind==='history'?'v126_import_historic_invoices':kind==='menu'?'v126_import_menu_only':'v126_import_physical_counts';
      const saved=await api.rpc(fn,payload);
      done+=kind==='history'?saved.invoicesCreated||0:kind==='menu'?saved.menuItems||0:saved.approved||0;
      total+=kind==='history'?saved.invoicesAlreadyPresent||0:kind==='count'?saved.alreadyApproved||0:0;
      if(token!==selection)break;
     }
     progress.innerHTML=`<div class="notice">اكتمل الاستيراد بنجاح. عدد السجلات المعالجة: ${done}${total?`، موجودة سابقًا ولم تتكرر: ${total}`:''}. راجع تقارير المخزون بعد الاستيراد.</div>`;
     toast('اكتمل حفظ البيانات المعتمدة','success');
    }catch(e){progress.innerHTML=`<div class="notice rose">توقف الاستيراد عند ${done} سجل جديد. العمليات السابقة التي أكّدها الخادم محفوظة؛ أعد رفع الملف نفسه بعد معالجة السبب، ولا تعدّل الملف لإنشاء نسخة جديدة قبل المراجعة. التفاصيل: ${esc(asMessage(e))}</div>`;toast(asMessage(e),'error');}
    finally{inFlight=false;review.disabled=false;kindInput.disabled=false;fileInput.disabled=false;submit.disabled=false;}
   };
  }catch(e){result.innerHTML=`<div class="notice rose">${esc(asMessage(e))}</div>`;toast(asMessage(e),'error');}
  finally{review.disabled=false;}
 };
}
