// Daily, repeated import of trusted Al-Ameen cashier reports, WITHOUT reposting cash.
import * as api from '../api.js?v=0.41';
import {esc,money,todayISO} from '../utils.js?v=0.27';
import {toast,loader,friendlyError,confirmBox} from '../ui.js?v=0.33';
import {readAmeenWorkbook,findReportSheet,parseAmeenRows,sha256Hex} from '../ameen-import-parser.js?v=0.41';
import {dailyMetrics,dailyCashboxes,dailyPriceDifferences,summarizeOrderPreview} from '../ameen-daily-v041.js?v=0.41';
import {downloadXlsx,exportDatasetPdf} from '../table-export-v027.js?v=0.27';

const num=x=>Number(x)||0;
const curr=x=>money(Number(x)||0,'SYP');
const text=x=>esc(x??'—');
const fmt=x=>new Intl.NumberFormat('ar-SY',{maximumFractionDigits:2}).format(num(x));
const dayLabel=x=>String(x||'').slice(0,10);
const typeName={recipe:'تكلفة وصفة',estimate:'تكلفة تقديرية',missing:'تكلفة مجهولة'};

export async function renderAmeenDailyV041(root){
 root.innerHTML=loader();
 let days=[],allOrders=[],allLines=[],report=null,shownDate=todayISO(),prepared=null;
 const renderError=e=>`<div class="notice rose">${text(friendlyError(e,'تعذرت قراءة البيانات. تحقق من تطبيق SQL v0.41.'))}</div>`;
 try{days=await api.ameenDailyDaysV041();if(days.length)shownDate=days[0].business_date;}catch(e){root.innerHTML=renderError(e);return;}
 root.innerHTML=`<div class="page-head"><div><h2>أوردرات الأمين اليومية</h2><p>ارفع تقرير الكاشير كل يوم. الأوردر وسعر بيعه موثوقان، ونقص تكلفة الوصفة لا يمنع تسجيله. لا تُنشأ حركة قبض ثانية عند رفع التقرير.</p></div>
  <a class="btn secondary" href="#/menu">الوجبات والوصفات ↗</a></div>
 <section class="card daily-import-card-v041"><div class="section-head-inline"><div><h3>إدخال تقرير اليوم</h3><p>يراجع البرنامج كل أوردر وبنوده، ويعرض فروقات أسعار المنيو قبل الحفظ.</p></div></div>
  <div class="daily-import-controls-v041"><div class="field"><label>ملف حركة الطلبات (Excel)</label><input type="file" id="daily-file-v041" accept=".xlsx"></div>
   <div class="field"><label>صندوق التقرير <span class="optional-badge">اختياري</span></label><select id="daily-box-v041"><option value="">حسب الملف / غير محدد</option></select></div>
   <button type="button" class="btn" id="daily-prepare-v041">معاينة الأوردرات والأسعار</button></div>
  <p class="metric-note">الصندوق هنا للعرض والمطابقة فقط. لا ينشئ التقرير حركة نقدية جديدة في صناديق Maria CFO؛ لتجنّب تسجيل مبيعات الكاشير مرتين.</p>
  <div id="daily-import-preview-v041" aria-live="polite"></div></section>
 <section class="card daily-report-v041"><div class="section-head-inline"><div><h3>تقرير اليوم</h3><p>عدد الأوردرات، قيمتها الأصلية، فروقات أسعارها، تكاليفها، وبيان الصناديق كما وردت.</p></div>
  <div class="daily-date-controls-v041"><label for="daily-day-v041">اليوم</label><input type="date" id="daily-day-v041" value="${esc(shownDate)}"><button class="btn secondary" type="button" id="daily-refresh-v041">تحديث</button></div></div>
  <div id="daily-summary-v041"></div><div id="daily-orders-v041"></div></section>
 <section class="card"><div class="section-head-inline"><div><h3>سجل تعديل أسعار المنيو</h3><p>كل تعديل محفوظ بالسعر القديم والجديد، مع تراجع آمن إن لم يحدث تعديل لاحق على الصنف.</p></div></div><div id="daily-prices-v041"></div></section>
 <section class="card"><h3>سجل استيرادات الأمين</h3><div id="daily-history-v041"></div></section>`;
 const h=x=>root.querySelector(x);
 try{
  const boxes=await api.cashboxes();
  h('#daily-box-v041').innerHTML='<option value="">حسب الملف / غير محدد</option>'+boxes.filter(x=>x.is_active!==false).map(b=>`<option value="${esc(b.id)}">${text(b.name)}</option>`).join('');
 }catch(_){/* Cashbox not provided by source; keep it unidentified. */}

 const renderHistory=async()=>{
  try{const rows=await api.ameenDailyHistoryV041();
   h('#daily-history-v041').innerHTML=rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الملف</th><th>التاريخ</th><th>جديد</th><th>موجود سابقًا</th><th>متعارض</th><th>بنود جديدة</th><th>تعديل سعر</th></tr></thead><tbody>${rows.map(r=>{const s=r.summary||{};return `<tr><td>${text(r.filename)}</td><td>${text(new Date(r.created_at).toLocaleString('ar-SY'))}</td><td>${num(s.created)}</td><td>${num(s.existing)}${s.duplicateFile?' (ملف مكرر)':''}</td><td>${num(s.conflicts)}</td><td>${num(s.lines)}</td><td>${num(s.menuPricesUpdated)}</td></tr>`;}).join('')}</tbody></table></div>`:'<p class="metric-note">لا يوجد استيراد بعد.</p>';
  }catch(e){h('#daily-history-v041').innerHTML=renderError(e);}
 };
 const exportOrders=async()=>({title:`أوردرات الأمين - ${dayLabel(shownDate)}`,
  headers:['اليوم','الأوردر','الصندوق حسب التقرير','المبلغ','فرق صافي الأوردر','عدد الأصناف'],
  rows:allOrders.map(o=>[dayLabel(shownDate),o.number,o.cashbox,num(o.net),num(o.difference),allLines.filter(l=>String(l.orderId)===String(o.id)).length])});
 const exportLines=async()=>({title:`تفاصيل أوردرات الأمين - ${dayLabel(shownDate)}`,
  headers:['الأوردر','الصنف','الكمية','سعر الأمين','سعر المنيو المرجعي','قيمة البند','تكلفة الحصة','مصدر التكلفة'],
  rows:allLines.map(l=>[allOrders.find(o=>String(o.id)===String(l.orderId))?.number||'',l.name,num(l.qty),num(l.unitPrice),l.referencePrice??'',num(l.lineNet),l.cost??'',typeName[l.costKind]||''])});
 const renderPriceHistory=()=>{
  const rows=(report?.priceHistory||[]).slice(0,90);
  h('#daily-prices-v041').innerHTML=rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>التوقيت</th><th>الصنف</th><th>السعر السابق</th><th>السعر الجديد</th><th>المصدر</th><th>إجراء</th></tr></thead><tbody>${rows.map((r,index)=>`<tr><td>${text(new Date(r.at).toLocaleString('ar-SY'))}</td><td>${text(r.item)}</td><td>${r.oldPrice==null?'غير محدد':curr(r.oldPrice)}</td><td>${r.newPrice==null?'غير محدد':curr(r.newPrice)}</td><td>${text(({ameen_import:'ملف الأمين',ameen_new_item:'صنف جديد',manual:'تعديل يدوي',undo:'تراجع'}[r.origin]||r.origin))}</td><td>${r.undone?'تم التراجع':r.origin==='undo'||r.origin==='ameen_new_item'?'—':`<button type="button" class="mini-btn" data-undo-price="${index}">تراجع</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<p class="metric-note">لم يُسجل تعديل أسعار بعد.</p>';
  h('#daily-prices-v041').querySelectorAll('[data-undo-price]').forEach(b=>b.onclick=async()=>{
   const row=rows[Number(b.dataset.undoPrice)];if(!row)return;
   if(!(await confirmBox(`إعادة سعر «${row.item}» من ${curr(row.newPrice)} إلى ${row.oldPrice==null?'سعر غير محدد':curr(row.oldPrice)}؟ لن تتغير قيم أوردرات الأمين السابقة.`, 'تأكيد التراجع')))return;
   b.disabled=true;try{await api.ameenPriceUndoV041(row.id);toast('تم تسجيل التراجع في سجل الأسعار.','success');await refresh();}
   catch(e){toast(friendlyError(e,'لا يمكن التراجع لأن السعر تغيّر بعد هذه العملية.'),'error');b.disabled=false;}
  });
 };
 const renderDaily=()=>{
  const metrics=dailyMetrics(allOrders,allLines),byBox=dailyCashboxes(allOrders),priceDiff=dailyPriceDifferences(allLines);
  h('#daily-summary-v041').innerHTML=`<div class="grid cols-4 daily-kpis-v041">
    <div class="card"><div class="metric-label">الأوردرات</div><div class="metric-value">${metrics.orders}</div><small>${metrics.items} بندًا</small></div>
    <div class="card"><div class="metric-label">إجمالي مبيعات الأمين</div><div class="metric-value">${curr(metrics.revenue)}</div><small>مبلغ التقرير، دون إضافته للصندوق مرة أخرى</small></div>
    <div class="card"><div class="metric-label">تكلفة الأصناف المعروفة</div><div class="metric-value">${curr(metrics.knownCost)}</div><small>${metrics.estimatedLines} بند بتكلفة تقديرية</small></div>
    <div class="card"><div class="metric-label">${metrics.complete?'هامش اليوم المقدر':'هامش البنود المعروفة فقط'}</div><div class="metric-value">${curr(metrics.complete?metrics.projectedMargin:metrics.partialMargin)}</div><small>${metrics.complete?'بناءً على التكاليف المسجلة':`${metrics.unknownLines} بند غير مسعّر التكلفة — ليس ربح اليوم الكامل`}</small></div></div>
   ${metrics.unknownLines?`<div class="notice warning daily-missing-banner-v041"><strong>الربح الكلي غير محسوب بأمان.</strong> ${metrics.unknownLines} بندًا من أوردرات اليوم بلا تكلفة وصفة مكتملة أو تقدير معتمد.
     <a class="btn secondary" href="#/menu/unpriced">فتح الوجبات الناقصة التكلفة ←</a><p>القيمة المعروضة هامش البنود معلومة التكلفة فقط، وليست حدًا أدنى مضمونًا للربح الكامل.</p></div>`:
    `<div class="notice sage">جميع بنود اليوم لها تكلفة ${metrics.estimatedLines?'بعضها تقديرية':'من الوصفات'}. قيمة الربح تقديرية حتى مطابقة المقبوضات ومصروفات اليوم.</div>`}
   <div class="grid cols-3 daily-secondary-stats-v041">
    <div class="card"><div class="metric-label">فروق زيادة سعر البيع عن المرجع</div><strong>${curr(priceDiff.increase)}</strong><small>مضمّنة مسبقًا في إجمالي الأوردرات؛ لا تُضاف مرتين</small></div>
    <div class="card"><div class="metric-label">فروق تخفيض سعر البيع عن المرجع</div><strong>${curr(priceDiff.decrease)}</strong></div>
    <div class="card"><div class="metric-label">فروق صافي التقرير عن البنود</div><strong>${curr(metrics.discounts)}</strong><small>قد تكون خصومات أو تسويات من الأمين، وليست تغيير سعر صنف</small></div>
   </div><div class="card daily-cashboxes-v041"><h3>الصناديق المنسوبة للتقرير</h3>${byBox.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الصندوق / الكاشير</th><th>الأوردرات</th><th>قيمة التقرير</th></tr></thead><tbody>${byBox.map(c=>`<tr><td>${text(c.name)}</td><td>${c.count}</td><td>${curr(c.total)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="metric-note">لا توجد أوردرات في اليوم المختار.</p>'}</div>`;
  const list=h('#daily-orders-v041');
  list.innerHTML=`<div class="section-head-inline"><div><h3>جميع أوردرات اليوم (${allOrders.length})</h3><p>افتح السهم لعرض أصناف كل أوردر وسعره وتكلفته.</p></div>
  <div class="quick-actions"><button type="button" class="mini-btn" id="daily-excel-v041">⇩ Excel</button><button type="button" class="mini-btn" id="daily-pdf-v041">⇩ PDF</button><button type="button" class="mini-btn" id="daily-excel-lines-v041">⇩ تفاصيل Excel</button></div></div>
   ${allOrders.length?`<div class="daily-order-list-v041">${allOrders.map(o=>{
    const lines=allLines.filter(l=>String(l.orderId)===String(o.id)),missing=lines.filter(l=>l.cost==null).length;
    return `<details class="daily-order-v041"><summary><span><strong>أوردر ${text(o.number)}</strong><small>${text(o.cashbox)}</small></span><span>${lines.length} بند${missing?` · <span class="payroll-danger-v034">${missing} بلا تكلفة</span>`:''}</span><strong>${curr(o.net)}</strong><span class="daily-arrow-v041">⌄</span></summary>
     <div class="table-wrap"><table class="table"><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الأمين</th><th>سعر المنيو</th><th>صافي البند</th><th>تكلفة الحصة</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${text(l.name)}</td><td>${fmt(l.qty)}</td><td>${curr(l.unitPrice)}</td><td>${l.referencePrice==null?'—':curr(l.referencePrice)}</td><td>${curr(l.lineNet)}</td><td>${l.cost==null?'<span class="badge warning">ناقصة</span>':`${curr(l.cost)} <small>${text(typeName[l.costKind])}</small>`}</td></tr>`).join('')}</tbody></table></div>
     ${num(o.difference)!==0?`<p class="metric-note">فرق صافي الأمين عن مجموع البنود: ${curr(o.difference)}. يبقى محفوظًا للمراجعة.</p>`:''}</details>`;
    }).join('')}</div>`:'<div class="empty"><strong>لا توجد أوردرات لهذا اليوم</strong><div>اختر تاريخًا آخر أو ارفع ملف حركة الطلبات.</div></div>'}`;
  h('#daily-excel-v041')?.addEventListener('click',async()=>{
   const d=await exportOrders();downloadXlsx(`Maria-CFO-Ameen-${shownDate}.xlsx`,d.headers,d.rows,'Daily Orders');
  });
  h('#daily-excel-lines-v041')?.addEventListener('click',async()=>{
   const d=await exportLines();downloadXlsx(`Maria-CFO-Ameen-Lines-${shownDate}.xlsx`,d.headers,d.rows,'Order Details');
  });
  h('#daily-pdf-v041')?.addEventListener('click',()=>exportDatasetPdf(exportOrders));
 };
 const refresh=async()=>{
  h('#daily-summary-v041').innerHTML=loader();
  try{report=await api.ameenDailyReportV041(shownDate)||{};
   allOrders=report.orders||[];allLines=report.lines||[];
   renderDaily();renderPriceHistory();
  }catch(e){h('#daily-summary-v041').innerHTML=renderError(e);h('#daily-orders-v041').innerHTML='';}
 };
 h('#daily-day-v041').onchange=e=>{shownDate=e.target.value||todayISO();refresh();};
 h('#daily-refresh-v041').onclick=()=>{shownDate=h('#daily-day-v041').value;refresh();renderHistory();};
 h('#daily-file-v041').onchange=()=>{prepared=null;h('#daily-import-preview-v041').innerHTML='';};
 h('#daily-prepare-v041').onclick=async()=>{
  const file=h('#daily-file-v041').files?.[0];if(!file){toast('اختر ملف Excel للأوردرات.','error');return;}
  if(file.size>12*1024*1024){toast('الملف أكبر من 12 MB. قسم التقرير إلى أيام.','error');return;}
  const btn=h('#daily-prepare-v041');btn.disabled=true;h('#daily-import-preview-v041').innerHTML=loader();
  try{
   const book=await readAmeenWorkbook(file),sheet=findReportSheet(book,'orders');
   const parsed=parseAmeenRows('orders',sheet.rows),records=parsed.records;
   const hash=await sha256Hex(book.buffer),prices=await api.ameenPricePreviewV041(records);
   prepared={hash,records,prices,fileName:file.name};
   const sum=summarizeOrderPreview(records);
   h('#daily-import-preview-v041').innerHTML=`<div class="daily-preview-v041"><h3>معاينة التقرير: ${text(file.name)}</h3>
    <div class="grid cols-3"><div class="card"><strong>${sum.orders}</strong><small>أوردرات كاملة</small></div><div class="card"><strong>${sum.lines}</strong><small>بنود أصلية</small></div><div class="card"><strong>${sum.review}</strong><small>تحتاج مراجعة حسابية</small></div></div>
    <p class="metric-note">الأيام في الملف: ${sum.days.map(text).join('، ')}. نقص تكلفة الوجبة لا يمنع تسجيل البيع. كل الأوردرات ظاهرة أدناه، ولا يتم استبعادها بسبب تكلفة الوصفة.</p>
    ${parsed.warnings?.length?`<details><summary>تنبيهات القراءة (${parsed.warnings.length})</summary><div class="daily-scroll-v041">${parsed.warnings.map(x=>`<p>سطر ${x.row}: ${text(x.message)}</p>`).join('')}</div></details>`:''}
    <details open><summary>الأوردرات في الملف (${sum.orders})</summary><div class="table-wrap daily-scroll-v041"><table class="table"><thead><tr><th>اليوم</th><th>رقم الأوردر</th><th>البنود</th><th>الصافي</th><th>مراجعة</th></tr></thead><tbody>${records.map(r=>`<tr><td>${text(r.date)}</td><td>${text(r.number)}</td><td>${r.items.length}</td><td>${curr(r.netTotal)}</td><td>${r.reviewReasons?.length?text(r.reviewReasons.join('؛ ')):'جاهز'}</td></tr>`).join('')}</tbody></table></div></details>
    <h4>مقارنة أسعار الأمين مع المنيو</h4><p class="metric-note">اختر «اعتماد سعر الأمين» لتحديث المنيو وسجل التعديل، أو «الإبقاء على سعر المنيو» مع الاحتفاظ بفرق البيع ضمن تفاصيل الأوردر. الصنف الذي ظهر بأسعار متعددة يحتاج اختيارًا واعيًا.</p>
    <div class="table-wrap daily-scroll-v041"><table class="table"><thead><tr><th>الصنف</th><th>سعر المنيو</th><th>سعر الملف الأخير</th><th>ملاحظة</th><th>القرار</th></tr></thead><tbody>${prices.map((p,i)=>`<tr><td>${text(p.name)}</td><td>${p.menuId==null?'جديد':p.menuPrice==null?'غير محدد':curr(p.menuPrice)}</td><td>${curr(p.filePrice)}</td><td>${num(p.minFilePrice)!==num(p.maxFilePrice)?'<span class="badge warning">أكثر من سعر في التقرير</span>':!p.different?'مطابق':'سعر مختلف'}</td><td>${p.menuId==null?'إنشاء صنف جديد':!p.different?'لا تغيير':`<select class="daily-price-action-v041" data-price-index="${i}"><option value="update" ${num(p.minFilePrice)!==num(p.maxFilePrice)?'':'selected'}>اعتماد سعر الأمين</option><option value="keep" ${num(p.minFilePrice)!==num(p.maxFilePrice)?'selected':''}>الإبقاء على سعر المنيو</option></select>`}</td></tr>`).join('')}</tbody></table></div>
    <div class="notice">استيراد الملف يحفظ أرقام المبيعات، ولا يسجل قبضًا أو يخصم مخزونًا تلقائيًا. الأوردر المكرر لن يُضاف مرة أخرى؛ والمتعارض يُحفظ سبب تعارضه دون استبدال بياناته.</div>
    <button type="button" id="daily-confirm-v041" class="btn">تأكيد استيراد ${sum.orders} أوردر</button></div>`;
   h('#daily-confirm-v041').onclick=async()=>{
    if(!prepared){toast('أعد معاينة الملف.','error');return;}
    const actions=prepared.prices.filter(p=>p.menuId!=null&&p.different).map(p=>({name:p.name,mode:h(`#daily-import-preview-v041 [data-price-index="${prepared.prices.indexOf(p)}"]`)?.value||'keep'}));
    if(!(await confirmBox(`حفظ أوردرات «${prepared.fileName}»؟ ستُوثَّق تعديلات الأسعار المختارة، ولن تُسجَّل حركة نقدية أو مخزون جديدة.`, 'اعتماد تقرير الأمين')))return;
    const b=h('#daily-confirm-v041');b.disabled=true;
    try{const result=await api.ameenImportDailyV041(prepared.fileName,prepared.hash,prepared.records,actions,h('#daily-box-v041').value||null);
      const notices=(result.reviewNotes||[]).map(r=>`${r.date} / ${r.number}: ${r.reason}`).join('؛ ');
      const summary=`جديد: ${num(result.created)} · موجود مسبقًا: ${num(result.existing)} · تعارض: ${num(result.conflicts)} · بنود جديدة: ${num(result.lines)} · أسعار عُدلت: ${num(result.menuPricesUpdated)}`;
      toast('تم اعتماد تقرير الأمين.','success');
      h('#daily-import-preview-v041').innerHTML=`<div class="notice sage"><strong>نتيجة الاستيراد</strong><p>${text(summary)}</p>${result.duplicateFile?'<p>الملف نفسه سبق استيراده.</p>':''}${notices?`<p>التعارضات: ${text(notices)}</p>`:''}</div>`;
      prepared=null;shownDate=records.map(r=>r.date).sort().at(-1)||shownDate;h('#daily-day-v041').value=shownDate;
      await refresh();await renderHistory();
    }catch(e){toast(friendlyError(e,'فشل الاستيراد؛ لم يُحفظ استيراد جزئي. تأكد من SQL v0.41.'),'error');b.disabled=false;}
   };
  }catch(e){prepared=null;h('#daily-import-preview-v041').innerHTML=renderError(e);}
  finally{btn.disabled=false;}
 };
 await Promise.all([refresh(),renderHistory()]);
}
