import * as api from './api.js?v=0.29-final';
import {esc} from './utils.js?v=0.27';
import {toast,friendlyError} from './ui.js?v=0.27';
import {readAmeenWorkbook,sha256Hex} from './ameen-import-parser.js?v=0.27';
import {parseMaterialPurchasesV029,purchaseChunksV029} from './material-purchase-parser-v029.js?v=0.29-final';
let importing=false;
export function installMaterialPurchaseImportV029(root){
 const button=root.querySelector('#ameen-purchase-preview');
 if(!button)return;
 button.onclick=async()=>{
  if(importing)return;
  const file=root.querySelector('#ameen-purchase-file')?.files?.[0];
  if(!file){toast('اختر ملف حركة مادة1.xlsx أولًا.','error');return;}
  const host=root.querySelector('#ameen-purchase-results');
  button.disabled=true;host.textContent='جار قراءة وتحليل التقرير…';
  try{
   const wb=await readAmeenWorkbook(file),checked=parseMaterialPurchasesV029(wb);
   const hash=await sha256Hex(wb.buffer),chunks=purchaseChunksV029(checked.eligible);
   const st=checked.stats;
   host.innerHTML=`<div class="notice">تم العثور على <strong>${st.invoiceCount} فاتورة مصدر</strong>، منها
    <strong>${st.readyInvoiceCount} مؤهلة</strong> (${st.readyLines} بندًا) و<strong>${st.blockedInvoiceCount} معلقة</strong>.
    تجاهلنا ${st.ignoredMovements} حركة ليست شراءً و${st.ignoredOther} سطر شراء من خارج مواد المطبخ.</div>
    ${checked.blocked.length?`<details><summary>الفواتير المعلقة للمراجعة (${checked.blocked.length})</summary><div class="table-wrap"><table class="table"><thead><tr><th>المصدر</th><th>التاريخ</th><th>السبب</th></tr></thead><tbody>${checked.blocked.map(d=>`<tr><td>${esc(d.document)}</td><td>${esc(d.date)}</td><td>${esc(d.problems.join('؛ '))}</td></tr>`).join('')}</tbody></table></div></details>`:''}
    <div class="notice">هذه فواتير مرجعية تاريخية بسعر شراء حقيقي؛ لن تُنشئ حركة صندوق أو دين مورد. <strong>مهم:</strong> بعد الاستيراد يجب تنفيذ مطابقة رصيد المطبخ مع الجرد الفعلي حتى لا يُحتسب مجموع المشتريات التاريخية كمخزون متاح.</div>
    <label class="recipe-confirm-check"><input type="checkbox" id="ameen-purchase-confirm"> أفهم أن استيراد الفواتير المؤهلة سيُنشئ حركات مخزون تاريخية، ولن يعيد إنشاء المبيعات أو يسدد الموردين</label>
    <div class="quick-actions"><button type="button" class="btn" id="ameen-purchase-commit" ${chunks.length?'':'disabled'}>إضافة ${st.readyInvoiceCount} فاتورة شراء تاريخية</button></div>
    <div id="ameen-purchase-progress" aria-live="polite"></div>`;
   const commit=host.querySelector('#ameen-purchase-commit');
   commit.onclick=async()=>{
    if(!host.querySelector('#ameen-purchase-confirm')?.checked){toast('أكد موافقتك بعد مراجعة الملاحظات','error');return;}
    if(importing)return;
    importing=true;commit.disabled=true;button.disabled=true;
    const status=host.querySelector('#ameen-purchase-progress');
    let done=0,inserted=0,already=0,materials=0;
    try{
     for(const batch of chunks){
       status.textContent=`تسجيل الدفعة ${done+1} من ${chunks.length}… لا تغلق الصفحة.`;
       // Idempotent on (invoice date, source number). After interrupted requests,
       // rerun the SAME file; server skips identical already-posted invoices.
       const result=await api.rpc('import_ameen_material_purchases_v029',
          {p_sha256:hash,p_documents:batch.map(d=>({document:d.document,date:d.date,lines:d.lines}))});
       inserted+=Number(result.createdInvoices||0);
       already+=Number(result.duplicateInvoices||0);
       materials+=Number(result.materialsCreated||0);
       done++;
       status.textContent=`تم فحص ${done}/${chunks.length} دفعة. فواتير جديدة ${inserted} · موجودة مسبقًا ${already}.`;
     }
     status.innerHTML=`<div class="notice green"><strong>اكتمل استيراد فواتير الشراء التاريخية.</strong>
        جديدة: ${inserted} · موجودة ولم تُكرر: ${already} · مواد أُنشئت: ${materials}.
        <a href="#/purchases">افتح فواتير الشراء</a></div>
        <div class="notice rose"><strong>الخطوة المحاسبية التالية ضرورية:</strong> إجمالي المشتريات التاريخية ليس رصيد المخزون الحالي.
        لتجنّب تضخيم مخزون المطبخ، طابقه مع كميات الجرد الفعلية بعد مراجعة المعاينة.
        ستُسجَّل الفروق كتسويات واضحة، وليس كمبيعات تاريخية أو هدر.</div>
        <label class="recipe-confirm-check"><input type="checkbox" id="ameen-kitchen-reconcile-confirm">
          أوافق على تسوية أرصدة مواد المطبخ المؤهلة بحسب جرد المواد6، وأفهم أنها عملية مالية لها سجل تدقيق</label>
        <button type="button" class="btn secondary" id="ameen-kitchen-reconcile-btn">مطابقة رصيد المطبخ مع الجرد الفعلي</button>
        <div id="ameen-kitchen-reconcile-status" aria-live="polite"></div>`;
     const reconcile=status.querySelector('#ameen-kitchen-reconcile-btn');
     reconcile.onclick=async()=>{
       if(!status.querySelector('#ameen-kitchen-reconcile-confirm')?.checked){toast('راجع الفروق ووافق على تسوية المخزون أولًا','error');return;}
       reconcile.disabled=true;
       const rstatus=status.querySelector('#ameen-kitchen-reconcile-status');
       rstatus.textContent='جار مطابقة المخزون، يرجى عدم إغلاق الصفحة…';
       try{
         const r=await api.rpc('reconcile_ameen_kitchen_stock_v029',
           {p_confirmation:'RECONCILE_MARIA_KITCHEN_V029_NOW'});
         rstatus.innerHTML=`<div class="notice green">تمت التسوية. مواد مطابقة ومسعّرة: ${esc(r.matchedPricedMaterials)}،
           مواد تغير رصيدها: ${esc(r.adjustedMaterials)}، مواد تحتاج مراجعة: ${esc(r.unresolvedMaterials)}.</div>`;
         toast('اكتملت تسوية مخزون المطبخ','success');
       }catch(err){rstatus.innerHTML=`<div class="notice rose">${esc(friendlyError(err))}</div>`;reconcile.disabled=false;}
     };
     toast('اكتملت الفواتير؛ يلزم الآن مطابقة رصيد المطبخ','success');
    }catch(error){
     status.innerHTML=`<div class="notice rose">توقف الاستيراد بعد ${done} دفعات ناجحة من ${chunks.length}.
      ${esc(friendlyError(error))}. أعد رفع الملف نفسه بعد معالجة الخطأ؛ لن تُكرر الفواتير المكتملة.</div>`;
    }finally{importing=false;commit.disabled=false;button.disabled=false;}
   };
  }catch(e){host.innerHTML=`<div class="notice rose">${esc(friendlyError(e))}</div>`;}
  finally{button.disabled=false;}
 };
}
