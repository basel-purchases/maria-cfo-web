// Maria CFO v1.0.26 — controlled historical purchases, menu-only and dated count imports.
import * as api from '../api.js?v=1.0.31';
import {esc} from '../utils.js?v=1.0';
import {toast,friendlyError,confirmBox,loader} from '../ui.js?v=1.0.25';
import {readAmeenWorkbook,sha256Hex} from '../ameen-import-parser.js?v=1.0.26';
import {parseMenuOnlyV134,parseSalesArchiveV134,parseOriginalCountV134} from '../foundation-import-v134.js?v=1.0.34';
import {parseHistoryInvoicesV126} from '../baseline-parsers-v126.js?v=1.0.26';
import {parsePhysicalCountV131} from '../physical-count-standard-v131.js?v=1.0.31';

const kinds={history:'أرشيف فواتير الشراء الشامل (الأمين)',menu:'المنيو والوصفات مع كتالوج المواد (دون أسعار شراء)',count:'الجرد الفعلي بتاريخ العد',salesArchive:'فواتير المبيع التاريخية — تسوية تكلفة وقبض صندوق'};
const num=n=>Number(n||0).toLocaleString('ar-SY-u-nu-latn',{maximumFractionDigits:4});
let inFlight=false;
function chunks(arr,n){const list=[];for(let i=0;i<arr.length;i+=n)list.push(arr.slice(i,i+n));return list;}
// Keep a large invoice whole, but do not send 200+ lines plus eleven additional
// invoices in one PostgREST transaction. All rows of ONE invoice stay atomic.
export function v136PurchaseChunks(records,maxInvoices=6,maxLines=85){
 const blocks=[];let block=[],lines=0;
 for(const invoice of records){
  const count=invoice.lines?.length||0;
  if(block.length && (block.length>=maxInvoices || lines+count>maxLines)){
   blocks.push(block);block=[];lines=0;
  }
  block.push(invoice);lines+=count;
  if(count>maxLines){blocks.push(block);block=[];lines=0;}
 }
 if(block.length)blocks.push(block);
 return blocks;
}

function summarize(kind,p){
 if(kind==='history')return [['الفواتير',p.stats.invoices],['بنود شراء',p.stats.lines],['الموردون',p.stats.suppliers],['مواد متنوعة',p.stats.materials],['القيمة ل.س',num(p.stats.totalNet)],['صفوف بلا وحدة',p.stats.missingUnits]];
 if(kind==='menu')return [['أصناف المنيو',p.stats.menu],['أسطر المكونات',p.stats.lines],['مواد في الكتالوج',p.stats.materialsFromWorkbook],['مواد جديدة برصيد صفر',p.stats.catalogOnlyCreatedOnImport],['تحتاج اعتماد وصفة',p.stats.pendingRecipes],['أسعار شراء من المنيو',0]];
 if(kind==='salesArchive')return [['فواتير المبيع',p.stats.invoices],['الأسطر',p.stats.lines],['أسماء مربوطة بملف المطابقة',p.stats.approvedNameMappings||0],['بنود مبيعات مرتبطة مسبقًا',p.stats.mappedLinesInSource||0],['أسماء بلا مطابقة في الملف',p.stats.unresolvedNameMappings||0],['حركات مخزون مسجلة',0]];
 return [['شيتات الجرد',p.stats.sections],['كميات معتمدة',p.stats.approved],['مواد يمكن تصنيفها',p.stats.categorizedCandidates||0],['مواد لم تُجرد',p.stats.empty]];
}
// Show actual Supabase information (error code/message/detail/hint) instead of
// swallowing it behind a generic notice. Escape only on DOM insertion.
export function v136ImportError(e){
 const raw=String(e?.message||e||'');
 const code=String(e?.code||'').trim();
 const detail=String(e?.details||'').trim();
 const hint=String(e?.hint||'').trim();
 if(/PGRST202|could not find the function|v136_import_readiness/i.test(raw))
   return `لم يُنفّذ تحديث قاعدة البيانات v1.0.36 أو لم تُحدَّث ذاكرة واجهة Supabase. نفّذ SQL الجديد ثم أعد تحميل الموقع. ${code?`[${code}]`:''} ${raw.slice(0,500)}`;
 const friendly=friendlyError(e,raw||'خطأ غير محدد من قاعدة البيانات');
 // Preserve the DB error even if a generic friendlyError rule matched.
 const parts=[friendly];
 if(raw && friendly!==raw)parts.push(raw);
 if(code)parts.push('SQLSTATE/رمز الخطأ: '+code);
 if(detail)parts.push('التفاصيل: '+detail);
 if(hint)parts.push('اقتراح الخادم: '+hint);
 return parts.join(' | ').slice(0,1100);
}
const asMessage=v136ImportError;
export async function renderBaselineImportsV126(root,options={}){
 const fixedKind=['history','menu','count','salesArchive'].includes(options.fixedKind)?options.fixedKind:null;
 root.innerHTML=`<div class="quick-page-v102"><div class="page-head"><div><h2>${fixedKind?kinds[fixedKind]:'استيراد تأسيس البيانات والجرد'}</h2>
 <p>ترتيب تأسيس آمن: فواتير الشراء التاريخية ← ملف المنيو والمواد الموحّد ← فواتير المبيع التاريخية ← جرد الكميات الفعلية بتاريخ العد. ملف المواد المنفرد مكرر لشيت المواد داخل ملف المنيو الموحّد، فلا ترفعه مرتين.</p></div></div>
 <div class="notice">هذه الواجهة <strong>لا تصفّر قاعدة البيانات</strong>. قبل التأسيس احفظ Backup قابلًا للاستعادة، وطبّق ترحيل SQL v1.0.36 فوق ترحيلات v1.0.35 السابقة. فواتير الأمين بالليرة السورية. بعد تفعيل SQL v1.0.35 تُحفظ الفواتير التاريخية وتُسجَّل حركة الصندوق المرتبطة بها مرة واحدة: الشراء من العام والمبيعات في الصندوق التشغيلي الأول عند غياب اسم الصندوق. لا يُخترَع سعر دولار.</div>
 <div class="card"><h3>اختر العملية وملف Excel</h3><div class="form-grid">
 <div class="field" ${fixedKind?'hidden':''}><label>نوع الاستيراد</label><select id="v126-kind">${Object.entries(kinds).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
 <div class="field"><label>ملف Excel</label><input id="v126-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
 </div><div class="notice">ملف الجرد الرسمي: اسم المادة، الكمية، الواحدة، التاريخ، القسم. سيُستخدم «القسم» لتصنيف المادة غير المصنّفة، حتى لو كانت خانة الكمية فارغة. لا يتغيّر أي تصنيف موجود، ولا تُستورد الكميات الفارغة.</div>
 <button class="btn" id="v126-review">تحليل الملف ومعاينة البيانات</button></div>
 <div id="v126-result" aria-live="polite"></div>
 <div class="card"><a href="#/count-history" class="btn secondary">سجل الجرد وتفاصيله</a> <a href="#/sale-cost-queue" class="btn secondary">تسوية تكاليف المبيعات</a></div>
 <div class="card"><h3>المعاملات اللاحقة</h3><p>ملف «حركة تفاصيل الفواتير مبيع» يُستورد عبر «فواتير المبيع التاريخية». تُحفظ منه حركة قبض تاريخية واحدة لكل فاتورة مرتبطة بالصندوق الأول إذا لم يذكر الملف الصندوق. استخدم <a href="#/daily-orders">استيراد الأوردرات</a> فقط لملف الأوردرات ذي العناوين «رقم الطلب، صافي الطلب، صافي القلم».</p>
 <p class="metric-note">لا تُغيّر أسماء المواد أو وحدات العبوة على أساس تشابه الاسم فقط. الجرد المتأخر يستخدم أرصدة التاريخ وحركات المخزون اللاحقة، ولا يعتمد على خانة كمية يوم الرفع.</p></div></div>`;
 const kindInput=root.querySelector('#v126-kind'),fileInput=root.querySelector('#v126-file'),result=root.querySelector('#v126-result'),review=root.querySelector('#v126-review');
 if(fixedKind)kindInput.value=fixedKind;
 let selection=0;const changed=()=>{selection++;result.innerHTML='';};kindInput.onchange=changed;fileInput.onchange=changed;
 review.onclick=async()=>{
  if(inFlight)return;
  const file=fileInput.files?.[0],kind=kindInput.value;
  if(!file){toast('اختر ملف Excel أولًا','error');return;}
  const token=selection;review.disabled=true;result.innerHTML=loader();
  try{
   const workbook=await readAmeenWorkbook(file);
   const sha=await sha256Hex(workbook.buffer);
   const parsed=kind==='history'?parseHistoryInvoicesV126(workbook):kind==='menu'?parseMenuOnlyV134(workbook):kind==='salesArchive'?parseSalesArchiveV134(workbook):(parseOriginalCountV134(workbook)||parsePhysicalCountV131(workbook));
   if(token!==selection)return;
   const issues=parsed.issues||parsed.warnings||[];
   const metrics=summarize(kind,parsed);
   const count=kind==='menu'?parsed.dishes.length:parsed.records.length;
   const canCategorize=kind==='count'&&Boolean(parsed.catalog?.length);
   result.innerHTML=`<div class="card"><h3>المعاينة: ${esc(file.name)}</h3>
    <div class="quick-metrics-v102">${metrics.map(([label,v])=>`<div class="card"><strong>${esc(String(v))}</strong><div class="metric-note">${esc(label)}</div></div>`).join('')}</div>
    ${kind==='history'?`<div class="notice">القيمة محفوظة بعملة SYP كما في تقرير الأمين، ولا يُخترع سعر دولار. بعد ترحيل SQL v1.0.36 يُخصم إجمالي الفاتورة من الصندوق العام مرة واحدة؛ احتفظ بالتاريخ والسعر والكمية كما وردت. ${parsed.stats.missingUnits?'توجد ${parsed.stats.missingUnits} وحدات شراء ناقصة: يجب اعتمادها يدويًا أو قبول استخدام «قطعة» مؤقتًا بوضوح.':''}</div>
      ${parsed.stats.missingUnits?'<label><input id="v126-missing-unit" type="checkbox"> أوافق صراحة على استيراد الوحدات الناقصة كـ«قطعة» مؤقتًا وأتحمل مراجعتها وتصحيح عبواتها</label>':''}`:''}
    ${kind==='menu'?'<div class="notice">يستورد المنيو وكميات الوصفات كاملة، وينشئ المواد غير الموجودة في الشراء برصيد صفر وتكلفة غير معروفة من شيت «المواد» فقط. لا يغيّر مطلقًا أرصدة وأسعار المواد المشتراة. الوصفات التقديرية محفوظة للمراجعة دون حذف مكوناتها.</div>':''}
    ${kind==='salesArchive'?'<div class="notice">أرشيف تاريخي مستقل: يحتفظ بفواتير المبيع وتفاصيلها وأرقامها وتواريخها، ويربط البنود بالمنيو من ورقة «مطابقة المبيعات» والأسماء الثانوية المعتمدة. يُسجّل قبضًا تاريخيًا في صندوق البيع الأول عند غياب صندوق محدد، ويسجل البنود التي تنتظر وصفة في تسوية المبيعات دون خصم المخزون مجددًا.</div>':''}
    ${kind==='count'?`<div class="notice">سيُستخدم الجرد المعتمد في نهاية تاريخ كل سطر: الرصيد الحالي = الكمية المعدودة + صافي الحركات بعد ذلك التاريخ. عند إعادة رفع المادة بنفس تاريخ الجرد تُترك كميتها القديمة دون تكرار، وتُضاف المواد غير المسجلة سابقًا فقط. وستُستعمل الأقسام لتصنيف المواد غير المصنّفة.</div>`:''}
    ${issues.length?`<details><summary>ملاحظات المصدر (${issues.length})</summary><div style="max-height:220px;overflow:auto">${issues.slice(0,35).map(i=>`<p>${esc(typeof i==='string'?i:(i.message||JSON.stringify(i)))}</p>`).join('')}</div></details>`:''}
    ${kind==='count'?'<div class="notice">تأسيس الشراء أولًا: لا تنشئ مواد من الجرد. تأكد أن كل اسم في ملف العد يطابق مادة من فواتير الشراء، وأن العبوات المكررة روجعت قبل الاستيراد.</div>':''}
    ${kind==='count'&&parsed.stats.requiresNameApproval?'<div class="notice rose">الرفع غير متاح الآن: توجد صفوف جرد مكررة أو ناقصة الوحدة/التاريخ. صححها في Excel قبل اعتماد الكميات؛ التفاصيل ظاهرة في ملاحظات المصدر.</div>':''}
    <button class="btn" id="v126-commit" ${(kind==='count'&&parsed.stats.requiresNameApproval)||(!count&&!canCategorize)?'disabled':''}>اعتماد وبدء الاستيراد (${count} ${kind==='history'||kind==='salesArchive'?'فاتورة':kind==='menu'?'صنف':'كمية'})</button>
    <p class="metric-note">الاستيراد مجزّأ إلى معاملات آمنة، وإعادة رفع الملف لا تكرر الفواتير أو قيود الجرد نفسها. لا تغادر الصفحة أثناء التنفيذ.</p>
    <div id="v126-progress" role="status" aria-live="polite"></div></div>`;
   const submit=result.querySelector('#v126-commit'),progress=result.querySelector('#v126-progress');
   submit.onclick=async()=>{
    if(inFlight)return;
    if(token!==selection||kind!==kindInput.value||file!==fileInput.files?.[0]){toast('تغيّر اختيار الملف، أعد المعاينة','error');return;}
    if(kind==='history'&&parsed.stats.missingUnits&&!result.querySelector('#v126-missing-unit')?.checked){toast(`أكد مراجعة الوحدات ${parsed.stats.missingUnits} الناقصة قبل الاستيراد.`,'error');return;}
    const accepted=await confirmBox(kind==='history'?`استيراد ${parsed.stats.invoices} فاتورة تاريخية بعملة SYP، وترحيل دفعها مرة واحدة من الصندوق العام وفق تاريخ الفواتير، دون إنشاء حركة صرف مخزون مكررة؟`:
      kind==='menu'?`اعتماد ${parsed.dishes.length} وجبة و${parsed.stats.lines} مكونًا، وإضافة ${parsed.newMaterials.length} مادة ناقصة برصيد صفر وتكلفة مجهولة، دون تغيير أرصدة وأسعار المشتريات؟`:
      kind==='salesArchive'?`أرشفة ${parsed.records.length} فاتورة مبيع مع حفظ الإشارات الأصلية؛ وترحيل قبضها مرة واحدة إلى صندوق البيع الأول وإنشاء تسوية تكلفة منفصلة دون صرف مخزون مكرر؟`:
      `اعتماد ${parsed.records.length} سطر جرد وتصنيف ${parsed.catalog?.length||0} مادة غير مصنّفة من عمود القسم، مع تجاهل أي مادة سبق اعتماد جردها بتاريخها؟`,
      'تأكيد الحفظ المالي');
    if(!accepted)return;
    if(token!==selection)return;
    inFlight=true;submit.disabled=true;review.disabled=true;kindInput.disabled=true;fileInput.disabled=true;
    let done=0,total=0,addedAliases=0,heldAliases=0,linkedSales=0,createdMaterials=0;let currentBlock=null;let readied=null;
    try{
     if(kind==='history'){
      readied=await api.rpc('v136_import_readiness');
      if(!readied?.ready)throw Error(`استيراد شراء الأمين يحتاج عملة أساسية SYP؛ إعدادات قاعدة البيانات الحالية: ${readied?.baseCurrency||'غير محددة'}. لم تُرسل أي فاتورة.`);
      if(!readied?.historicalImportFunctionExists)throw Error('دالة الاستيراد التاريخي غير مثبتة في قاعدة البيانات.');
     }
     if(kind==='menu'&&parsed.newMaterials?.length){
      // Run before recipe chunks; upsert skips existing invoice-derived materials.
      for(const records of chunks(parsed.newMaterials,75)){
       const r=await api.rpc('v134_create_recipe_catalog_materials',{p_materials:records});
       createdMaterials+=Number(r?.materialsCreated||0);
      }
     }
     if(kind==='salesArchive'&&parsed.approvalAliases?.length){
      for(const aliases of chunks(parsed.approvalAliases,60)){
       const r=await api.rpc('v134_register_sales_aliases',{p_pairs:aliases});
       addedAliases+=Number(r?.aliasesAdded||0);heldAliases+=Number(r?.heldForReview||0);
      }
     }
     const blocks=kind==='history'?v136PurchaseChunks(parsed.records):kind==='menu'?chunks(parsed.dishes,24):kind==='salesArchive'?chunks(parsed.records,15):chunks(parsed.records.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name)),85);
     for(let i=0;i<blocks.length;i++){
      currentBlock=blocks[i];
      progress.innerHTML=`<div class="notice">جاري اعتماد المعاملة ${i+1} من ${blocks.length} · تم ${done} سجل. في حالة انقطاع الاتصال، أعد رفع الملف ذاته ليستكمل دون تكرار السجلات السابقة.</div>`;
      const payload=kind==='history'?{p_sha256:sha,p_documents:blocks[i],p_accept_missing_units:Boolean(result.querySelector('#v126-missing-unit')?.checked)}:
        kind==='menu'?{p_sha256:sha,p_batch_index:i,p_filename:file.name,p_dishes:blocks[i]}:
        kind==='salesArchive'?{p_sha256:sha,p_documents:blocks[i]}:
        {p_sha256:sha,p_filename:file.name,p_records:blocks[i],p_create_missing:false};
      const fn=kind==='history'?'v126_import_historic_invoices':kind==='menu'?'v134_import_menu_purchase_first':kind==='salesArchive'?'v134_import_sales_archive':'v131_import_physical_counts';
      const saved=await api.rpc(fn,payload);
      done+=kind==='history'?saved.invoicesCreated||0:kind==='menu'?saved.menuItems||0:kind==='salesArchive'?saved.documentsCreated||0:saved.approved||0;
      total+=kind==='history'?saved.invoicesAlreadyPresent||0:kind==='salesArchive'?saved.documentsAlreadyPresent||0:kind==='count'?saved.alreadyApproved||0:0;
      if(kind==='salesArchive')linkedSales+=Number(saved.matchedLines||0);
      if(token!==selection)break;
     }
     let categorized=0,alreadyClassified=0;
     if(kind==='count' && parsed.catalog?.length){
       for(const entries of chunks(parsed.catalog,120)){
        const classification=await api.v131ClassifyCountCatalog(entries);
        categorized+=Number(classification.classified||0);
        alreadyClassified+=Number(classification.alreadyClassified||0);
       }
     }
     let cashWarning='';
     if(kind==='history'||kind==='salesArchive'){
      try{
       const cash=await api.rpc('v136_deferred_cash_overview');
       const n=Number(cash?.purchasesDeferred||0)+Number(cash?.salesDeferred||0);
       if(n)cashWarning=`<div class="notice rose">حُفظت الفواتير بنجاح، لكن هناك ${n} عمليات صندوق لم تترحّل بعد. افتح «ترحيل الفواتير القديمة» لمراجعة السبب وإعادة المحاولة بعد إصلاح الصندوق. لا تعِد استيرادها لفرض القبض أو الدفع.</div>`;
      }catch(e){console.warn('تعذر التحقق من وضع الصناديق، لا تُلغى الفواتير المحفوظة',e);}
     }
     progress.innerHTML=cashWarning+`<div class="notice">اكتمل الاستيراد بنجاح. عدد السجلات المعالجة: ${done}${total?`، جرى تجاهلها لأنها مجرودة من قبل في التاريخ نفسه: ${total}`:''}${kind==='menu'?`، مواد وصفات إضافية أُنشئت برصيد صفر: ${createdMaterials}`:''}${kind==='count'?`، مواد صُنِّفت من عمود القسم: ${categorized}، احتُفظ بتصنيف ${alreadyClassified} مادة`:''}${kind==='salesArchive'?`، أسطر مبيعات مرتبطة بالمنيو: ${linkedSales}، أسماء ثانوية أُضيفت: ${addedAliases}، تحتاج مراجعة: ${heldAliases}`:''}. ${kind==='salesArchive'?'<a href="#/sale-cost-queue/archive">عرض تسوية المبيعات المؤجلة</a>':kind==='history'?'<a href="#/cashboxes">عرض الصندوق العام</a>':''}</div>`;
     if(kind==='menu')document.dispatchEvent(new CustomEvent('maria:recipe-saved'));
     if(kind==='salesArchive')document.dispatchEvent(new CustomEvent('maria:archive-imported'));
     if(kind==='history'||kind==='salesArchive')document.dispatchEvent(new CustomEvent('maria:cash-records-changed'));
     toast('اكتمل حفظ البيانات المعتمدة','success');
    }catch(e){const docs=(currentBlock||[]).map(d=>d.number).join('، ');progress.innerHTML=`<div class="notice rose">توقف الاستيراد عند ${done} سجل جديد. ${docs?`مجموعة الفواتير عند الفشل: ${esc(docs)}.`:''} العمليات السابقة التي أكّدها الخادم محفوظة؛ أعد رفع الملف نفسه بعد معالجة السبب، ولا تعدّل الملف لإنشاء نسخة جديدة قبل المراجعة. التفاصيل: ${esc(asMessage(e))}</div>`;toast(asMessage(e),'error');}
    finally{inFlight=false;review.disabled=false;kindInput.disabled=false;fileInput.disabled=false;submit.disabled=false;}
   };
  }catch(e){result.innerHTML=`<div class="notice rose">${esc(asMessage(e))}</div>`;toast(asMessage(e),'error');}
  finally{review.disabled=false;}
 };
}
