// Maria CFO v1.0.5: cashier imports post source-net cash exactly once per new order.
import * as api from '../api.js?v=1.0.6';
import {esc,money,todayISO} from '../utils.js?v=1.0';
import {toast,loader,friendlyError,confirmBox} from '../ui.js?v=1.0';
import {readAmeenWorkbook,findReportSheet,parseAmeenRows,sha256Hex} from '../ameen-import-parser.js?v=1.0';
import {dailyMetrics,dailyCashboxes,dailyPriceDifferences,summarizeOrderPreview} from '../ameen-daily-v041.js?v=1.0';
import {isPriceMismatch,sortedPriceReviewV100} from '../price-review-v100.js?v=1.0';
import {downloadXlsx,exportDatasetPdf} from '../table-export-v027.js?v=1.0';
import {applyDailyBusinessDateV104} from '../daily-order-date-v104.js?v=1.0.4';
import {cashierMoneyV105,reconcileCashierV105,detectCashierHeaderDateV105,prioritizeMenuByCashierPriceV105} from '../cashier-reconciliation-v105.js?v=1.0.5';

const num=x=>Number(x)||0;
const curr=x=>cashierMoneyV105(x);
const text=x=>esc(x??'—');
const fmt=x=>new Intl.NumberFormat('ar-SY',{maximumFractionDigits:2}).format(num(x));
const dayLabel=x=>String(x||'').slice(0,10);
const typeName={recipe:'تكلفة وصفة',estimate:'تكلفة تقديرية',missing:'تكلفة مجهولة'};
export async function renderAmeenDailyV041(root){
 root.innerHTML=loader();
 let days=[],allOrders=[],allLines=[],report=null,receipts=null,shownDate=todayISO(),prepared=null;
 const renderError=e=>`<div class="notice rose">${text(friendlyError(e,'تعذرت قراءة البيانات. تحقق من تطبيق SQL v1.0.5 بعد v1.0.4.'))}</div>`;
 try{days=await api.ameenDailyDaysV041();if(days.length)shownDate=days[0].business_date;}catch(e){root.innerHTML=renderError(e);return;}
 root.innerHTML=`<div class="page-head"><div><h2>الأوردرات</h2><p>ارفع تقرير الكاشير كل يوم. الأوردر وسعر بيعه موثوقان، ونقص تكلفة الوصفة لا يمنع تسجيله. يُرحّل صافي كل أوردر جديد إلى صندوق الكاشير مرة واحدة فقط؛ تكرار الملف لا يكرر القبض.</p></div>
  <a class="btn secondary" href="#/menu">الوجبات والوصفات ↗</a></div>
 <section class="card daily-import-card-v041"><div class="section-head-inline"><div><h3>إدخال الأوردرات</h3><p>يراجع البرنامج كل أوردر وبنوده، ويعرض فروقات أسعار المنيو كتنبيه فقط دون تغيير سعر الأوردر.</p></div></div>
  <div class="daily-import-controls-v041"><div class="field"><label>ملف حركة الطلبات (Excel)</label><input type="file" id="daily-file-v041" accept=".xlsx"></div>
   <div class="field"><label for="daily-import-date-v104">تاريخ الأوردرات <span class="optional-badge">اختياري</span></label>
     <input id="daily-import-date-v104" type="date" aria-describedby="daily-import-date-hint-v104">
   </div>
   <div class="field"><label for="daily-box-v041">صندوق قبض الكاشير <strong>(إلزامي)</strong></label><select id="daily-box-v041" required><option value="">اختر صندوق الكاشير الذي استلم المقبوض...</option></select></div>
   <button type="button" class="btn" id="daily-prepare-v041">معاينة الأوردرات والأسعار</button></div>
  <p class="metric-note" id="daily-import-date-hint-v104">اترك التاريخ فارغًا لاعتماد يوم كل أوردر كما هو في Excel. إذا اخترت يومًا مختلفًا، سيطبّق على كل الأوردرات في ملف اليوم الواحد فقط، مع الاحتفاظ بتوقيت الملف الأصلي للمراجعة.</p>
  <p class="metric-note">سيضاف صافي كل أوردر جديد إلى الصندوق المختار كحركة قبض فعلية واحدة محمية من التكرار. يمكن تسليم الرصيد لاحقًا من صفحة <a href="#/cashboxes">الصناديق</a>؛ التسليم حركة منفصلة وليس إعادة قبض.</p>
  <div class="field daily-tax-analyst-v105"><label for="daily-assumed-tax-v105">نسبة الإضافة/الضريبة للمقارنة فقط <span class="optional-badge">اختيارية وليست مثبتة بالملف</span></label><input type="number" id="daily-assumed-tax-v105" min="0" max="100" step="0.01" inputmode="decimal" placeholder="مثال: 10.5"><small>لن تغيّر قيمة الأوردر أو القبض. إن لم يذكر Excel الضريبة صراحةً، أي تفصيل هنا افتراضي فقط.</small></div>
  <div id="daily-import-preview-v041" aria-live="polite"></div></section>
 <section class="card daily-report-v041"><div class="section-head-inline"><div><h3>تقرير اليوم</h3><p>عدد الأوردرات، قيمتها الأصلية، فروقات أسعارها، تكاليفها، وبيان الصناديق كما وردت.</p></div>
  <div class="daily-date-controls-v041"><label for="daily-day-v041">اليوم</label><input type="date" id="daily-day-v041" value="${esc(shownDate)}"><button class="btn secondary" type="button" id="daily-refresh-v041">تحديث</button></div></div>
  <div id="daily-summary-v041"></div><div id="daily-orders-v041"></div></section>
 <section class="card"><div class="section-head-inline"><div><h3>سجل تعديل أسعار المنيو</h3><p>كل تعديل محفوظ بالسعر القديم والجديد، مع تراجع آمن إن لم يحدث تعديل لاحق على الصنف.</p></div></div><div id="daily-prices-v041"></div></section>
 <section class="card"><h3>سجل الاستيرادات اليومية</h3><div id="daily-history-v041"></div></section>`;
 const h=x=>root.querySelector(x);
 try{
  const boxes=await api.cashboxes();
  h('#daily-box-v041').innerHTML='<option value="">اختر صندوق الكاشير...</option>'+boxes.filter(x=>x.is_active!==false).map(b=>`<option value="${esc(b.id)}">${text(b.name)}</option>`).join('');
 }catch(_){h('#daily-box-v041').innerHTML='<option value="">تعذر جلب الصناديق؛ حدّث الصفحة</option>';}

 const renderHistory=async()=>{
  try{const rows=await api.ameenDailyHistoryV041();
   h('#daily-history-v041').innerHTML=rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الملف</th><th>التاريخ</th><th>جديد</th><th>موجود سابقًا</th><th>متعارض</th><th>بنود جديدة</th><th>قبض جديد رحّل للصندوق</th></tr></thead><tbody>${rows.map(r=>{const s=r.summary||{};return `<tr><td>${text(r.filename)}</td><td>${text(new Date(r.created_at).toLocaleString('ar-SY'))}</td><td>${num(s.created)}</td><td>${num(s.existing)}${s.duplicateFile?' (ملف مكرر)':''}</td><td>${num(s.conflicts)}</td><td>${num(s.lines)}</td><td>${s.cashPostedSyp==null?'سابق للتحديث / لم يرحل':curr(s.cashPostedSyp)}</td></tr>`;}).join('')}</tbody></table></div>`:'<p class="metric-note">لا يوجد استيراد بعد.</p>';
  }catch(e){h('#daily-history-v041').innerHTML=renderError(e);}
 };
 const exportOrders=async()=>({title:`الأوردرات - ${dayLabel(shownDate)}`,
  headers:['اليوم','الأوردر','الصندوق','المبلغ المقبوض','فرق صافي الأوردر','عدد الأصناف','حركة الصندوق'],
  rows:allOrders.map(o=>[dayLabel(shownDate),o.number,o.cashbox,num(o.net),num(o.difference),allLines.filter(l=>String(l.orderId)===String(o.id)).length,receipts?.details?.find(p=>String(p.orderId)===String(o.id))?.posted?'مرحل':'غير مرحل'])});
 const exportLines=async()=>({title:`تفاصيل الأوردرات - ${dayLabel(shownDate)}`,
  headers:['الأوردر','الصنف','الكمية','سعر التقرير','سعر المنيو المرجعي','قيمة البند','تكلفة الحصة','مصدر التكلفة'],
  rows:allLines.map(l=>[allOrders.find(o=>String(o.id)===String(l.orderId))?.number||'',l.name,num(l.qty),num(l.unitPrice),l.referencePrice??'',num(l.lineNet),l.cost??'',(l.matchKind==='unit_prefix'||l.matchKind==='alias_unit_prefix'?'حصة/وحدة تحتاج مراجعة':typeName[l.costKind]||'')])});
 const renderPriceHistory=()=>{
  const rows=(report?.priceHistory||[]).slice(0,90);
  h('#daily-prices-v041').innerHTML=rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>التوقيت</th><th>الصنف</th><th>السعر السابق</th><th>السعر الجديد</th><th>المصدر</th><th>إجراء</th></tr></thead><tbody>${rows.map((r,index)=>`<tr><td>${text(new Date(r.at).toLocaleString('ar-SY'))}</td><td>${text(r.item)}</td><td>${r.oldPrice==null?'غير محدد':curr(r.oldPrice)}</td><td>${r.newPrice==null?'غير محدد':curr(r.newPrice)}</td><td>${text(({ameen_import:'الملف المستورد',ameen_new_item:'صنف جديد',manual:'تعديل يدوي',undo:'تراجع'}[r.origin]||r.origin))}</td><td>${r.undone?'تم التراجع':r.origin==='undo'||r.origin==='ameen_new_item'?'—':`<button type="button" class="mini-btn" data-undo-price="${index}">تراجع</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<p class="metric-note">لم يُسجل تعديل أسعار بعد.</p>';
  h('#daily-prices-v041').querySelectorAll('[data-undo-price]').forEach(b=>b.onclick=async()=>{
   const row=rows[Number(b.dataset.undoPrice)];if(!row)return;
   if(!(await confirmBox(`إعادة سعر «${row.item}» من ${curr(row.newPrice)} إلى ${row.oldPrice==null?'سعر غير محدد':curr(row.oldPrice)}؟ لن تتغير قيم الأوردرات السابقة.`, 'تأكيد التراجع')))return;
   b.disabled=true;try{await api.ameenPriceUndoV041(row.id);toast('تم تسجيل التراجع في سجل الأسعار.','success');await refresh();}
   catch(e){toast(friendlyError(e,'لا يمكن التراجع لأن السعر تغيّر بعد هذه العملية.'),'error');b.disabled=false;}
  });
 };
 const renderDaily=()=>{
  const metrics=dailyMetrics(allOrders,allLines),byBox=dailyCashboxes(allOrders),priceDiff=dailyPriceDifferences(allLines);
  const cashPosted=num(receipts?.postedSyp),cashPending=num(receipts?.unpostedSyp);
  const cashierStatus=receipts==null?'لم نتحقق من القيود النقدية بعد':cashPending>0?'توجد أوردرات غير مُرحّلة إلى الصندوق (خصوصًا استيرادات ما قبل v1.0.5)':'جميع الأوردرات الموجبة في هذا اليوم لها حركة قبض مرتبطة';
  h('#daily-summary-v041').innerHTML=`<div class="grid cols-4 daily-kpis-v041">
    <div class="card"><div class="metric-label">الأوردرات</div><div class="metric-value">${metrics.orders}</div><small>${metrics.items} بندًا</small></div>
    <div class="card"><div class="metric-label">إجمالي المبيعات</div><div class="metric-value">${curr(metrics.revenue)}</div><small>صافي الكاشير كما ورد في التقرير، وليس مجموع بنود الأسعار</small></div>
    <div class="card"><div class="metric-label">تكلفة الأصناف المعروفة</div><div class="metric-value">${curr(metrics.knownCost)}</div><small>${metrics.estimatedLines} بند بتكلفة تقديرية</small></div>
    <div class="card"><div class="metric-label">${metrics.complete?'هامش اليوم المقدر':'هامش البنود المعروفة فقط'}</div><div class="metric-value">${curr(metrics.complete?metrics.projectedMargin:metrics.partialMargin)}</div><small>${metrics.complete?'بناءً على التكاليف المسجلة':`${metrics.unknownLines} بند غير مسعّر التكلفة — ليس ربح اليوم الكامل`}</small></div></div>
   <div class="grid cols-3 daily-money-summary-v105"><div class="card"><small>إجمالي بنود البيع قبل التسويات</small><strong>${curr(metrics.lineRevenue)}</strong></div>
    <div class="card"><small>فرق الصافي (ضرائب/حسميات/رسوم غير مصنفة)</small><strong>${curr(metrics.discounts)}</strong></div>
    <div class="card"><small>صافي المقبوض حسب تقارير الأوردرات</small><strong>${curr(metrics.revenue)}</strong></div></div>
   ${Math.abs(metrics.discounts)>.0001?'<div class="notice warning">تنبيه محاسبي: فرق الصافي عن البنود ليس ربحًا محققًا بالضرورة؛ قد يشمل ضرائب أو رسومًا أو حسميات غير مفصّلة. لا يُعتبر هامش اليوم ربحًا ضريبيًا نهائيًا.</div>':''}
   ${metrics.unknownLines?`<div class="notice warning daily-missing-banner-v041"><strong>الربح الكلي غير محسوب بأمان.</strong> ${metrics.unknownLines} بندًا من أوردرات اليوم بلا تكلفة وصفة مكتملة أو تقدير معتمد.
     <a class="btn secondary" href="#/menu/unpriced">فتح الوجبات الناقصة التكلفة ←</a><p>القيمة المعروضة هامش البنود معلومة التكلفة فقط، وليست حدًا أدنى مضمونًا للربح الكامل.</p></div>`:
    `<div class="notice sage">جميع بنود اليوم لها تكلفة ${metrics.estimatedLines?'بعضها تقديرية':'من الوصفات'}. قيمة الربح تقديرية حتى مطابقة المقبوضات ومصروفات اليوم.</div>`}
   <div class="grid cols-3 daily-secondary-stats-v041">
    <div class="card"><div class="metric-label">قيمة الأوردرات المرحّلة للصندوق</div><strong>${curr(cashPosted)}</strong><small>${cashierStatus}</small></div>
    <div class="card"><div class="metric-label">صافي مبيعات لم يُرحّل</div><strong>${curr(cashPending)}</strong><small>لا يُرحّل استيراد قديم تلقائيًا لمنع الازدواج</small></div>
   </div><div class="grid cols-3 daily-secondary-stats-v041">
    <div class="card"><div class="metric-label">فروق زيادة سعر البيع عن المرجع</div><strong>${curr(priceDiff.increase)}</strong><small>مضمّنة مسبقًا في إجمالي الأوردرات؛ لا تُضاف مرتين</small></div>
    <div class="card"><div class="metric-label">فروق تخفيض سعر البيع عن المرجع</div><strong>${curr(priceDiff.decrease)}</strong><small>${priceDiff.unitVariations?`${priceDiff.unitVariations} بند بوحدة مختلفة مستبعد من المقارنة المباشرة حتى اعتماد تحويل الحصة`:"لا توجد وحدات بيع ملتبسة"}</small></div>
    <div class="card"><div class="metric-label">فرق الصافي عن مجموع البنود (ضرائب/تسويات غير مفصّلة)</div><strong>${curr(metrics.discounts)}</strong><small>الملف لا يفصل الضرائب والحسميات؛ هذا الفرق لا يُضاف ثانية إلى الصندوق</small></div>
   </div><div class="card daily-cashboxes-v041"><h3>الصناديق المسجلة في تقرير الكاشير (والمطابقة النقدية أعلاه)</h3>${byBox.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الصندوق / الكاشير</th><th>الأوردرات</th><th>قيمة التقرير</th></tr></thead><tbody>${byBox.map(c=>`<tr><td>${text(c.name)}</td><td>${c.count}</td><td>${curr(c.total)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="metric-note">لا توجد أوردرات في اليوم المختار.</p>'}</div>`;
  const list=h('#daily-orders-v041');
  list.innerHTML=`<div class="section-head-inline"><div><h3>جميع أوردرات اليوم (${allOrders.length})</h3><p>افتح السهم لعرض أصناف كل أوردر وسعره وتكلفته.</p></div>
  <div class="quick-actions"><button type="button" class="mini-btn" id="daily-excel-v041">⇩ Excel</button><button type="button" class="mini-btn" id="daily-pdf-v041">⇩ PDF</button><button type="button" class="mini-btn" id="daily-excel-lines-v041">⇩ تفاصيل Excel</button></div></div>
   ${allOrders.length?`<div class="daily-order-list-v041">${allOrders.map(o=>{
    const lines=allLines.filter(l=>String(l.orderId)===String(o.id)),missing=lines.filter(l=>l.cost==null).length;
    return `<details class="daily-order-v041"><summary><span><strong>أوردر ${text(o.number)}</strong><small>${text(o.cashbox)}</small></span><span>${lines.length} بند${missing?` · <span class="payroll-danger-v034">${missing} بلا تكلفة</span>`:''}</span><strong>${curr(o.net)}</strong><span class="daily-arrow-v041">⌄</span></summary>
     <div class="table-wrap"><table class="table"><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر التقرير</th><th>سعر المنيو</th><th>صافي البند</th><th>تكلفة الحصة</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${text(l.name)}</td><td>${fmt(l.qty)}</td><td>${curr(l.unitPrice)}</td><td>${l.referencePrice==null?'—':curr(l.referencePrice)}</td><td>${curr(l.lineNet)}</td><td>${l.cost==null?`<span class="badge warning">ناقصة</span>${l.matchKind==='unit_prefix'||l.matchKind==='alias_unit_prefix'?'<small class="daily-link-warning-v104">تحقق من تحويل وزن/حصة الصنف قبل حساب التكلفة</small>':''}`:`${curr(l.cost)} <small>${text(typeName[l.costKind])}</small>`}</td></tr>`).join('')}</tbody></table></div>
     ${num(o.difference)!==0?`<p class="metric-note">فرق صافي التقرير عن مجموع البنود: ${curr(o.difference)}. يبقى محفوظًا للمراجعة.</p>`:''}</details>`;
    }).join('')}</div>`:'<div class="empty"><strong>لا توجد أوردرات لهذا اليوم</strong><div>اختر تاريخًا آخر أو ارفع ملف حركة الطلبات.</div></div>'}`;
  h('#daily-excel-v041')?.addEventListener('click',async()=>{
   const d=await exportOrders();downloadXlsx(`Maria-CFO-Orders-${shownDate}.xlsx`,d.headers,d.rows,'الأوردرات');
  });
  h('#daily-excel-lines-v041')?.addEventListener('click',async()=>{
   const d=await exportLines();downloadXlsx(`Maria-CFO-Orders-Lines-${shownDate}.xlsx`,d.headers,d.rows,'تفاصيل الأوردرات');
  });
  h('#daily-pdf-v041')?.addEventListener('click',()=>exportDatasetPdf(exportOrders));
 };
 const refresh=async()=>{
  h('#daily-summary-v041').innerHTML=loader();
  try{const [dayReport,cashReport]=await Promise.all([api.ameenDailyReportV041(shownDate),api.ameenCashboxReconciliationV105(shownDate)]);
   report=dayReport||{};receipts=cashReport||{};
   allOrders=report.orders||[];allLines=report.lines||[];
   renderDaily();renderPriceHistory();
  }catch(e){h('#daily-summary-v041').innerHTML=renderError(e);h('#daily-orders-v041').innerHTML='';}
 };
 h('#daily-day-v041').onchange=e=>{shownDate=e.target.value||todayISO();refresh();};
 h('#daily-refresh-v041').onclick=()=>{shownDate=h('#daily-day-v041').value;refresh();renderHistory();};
 const invalidatePreview=()=>{prepared=null;h('#daily-import-preview-v041').innerHTML='';};
 h('#daily-file-v041').onchange=invalidatePreview;
 h('#daily-import-date-v104').onchange=invalidatePreview;
 h('#daily-assumed-tax-v105').onchange=invalidatePreview;
 h('#daily-box-v041').onchange=invalidatePreview;
 h('#daily-prepare-v041').onclick=async()=>{
  const file=h('#daily-file-v041').files?.[0];if(!file){toast('اختر ملف Excel للأوردرات.','error');return;}
  if(!h('#daily-box-v041').value){toast('اختر صندوق الكاشير المستلم فعليًا أولًا.','error');h('#daily-box-v041').focus();return;}
  if(file.size>12*1024*1024){toast('الملف أكبر من 12 MB. قسم التقرير إلى أيام.','error');return;}
  const btn=h('#daily-prepare-v041');btn.disabled=true;h('#daily-import-preview-v041').innerHTML=loader();
  try{
   const book=await readAmeenWorkbook(file),sheet=findReportSheet(book,'orders');
   const parsed=parseAmeenRows('orders',sheet.rows);
   const dateChoice=applyDailyBusinessDateV104(parsed.records,h('#daily-import-date-v104').value);
   const records=dateChoice.records;
   const audit=reconcileCashierV105(records,h('#daily-assumed-tax-v105').value);
   const sourceHead=detectCashierHeaderDateV105(book,dateChoice.originalDays);
   const hash=await sha256Hex(book.buffer);
   const [prices,menuChoices]=await Promise.all([
     api.ameenPricePreviewV041(records),api.menuAliasChoicesV104(),
   ]);
   prepared={hash,records,prices,menuChoices,dateChoice,audit,sourceHead,fileName:file.name,cashboxId:h('#daily-box-v041').value};
   const sum=summarizeOrderPreview(records);
   const indexed=sortedPriceReviewV100(prices);
   const menuOptions=price=>prioritizeMenuByCashierPriceV105(menuChoices,price).map(m=>{const same=m.menu_price!=null&&Number(m.menu_price)===Number(price);return `<option value="${text(m.id)}" data-search="${text(m.aliases_text||'')}">${text(m.name)} · ${m.menu_price==null?'بلا سعر':curr(m.menu_price)}${same?' · مطابق للسعر ✓':''}</option>`;}).join('');
   const matchNote=p=>({canonical:'مطابق للاسم الرئيسي',alias:'مطابق لاسم بديل',unit_prefix:'بعد حذف كمية/وحدة من البداية',alias_unit_prefix:'اسم بديل بعد حذف كمية/وحدة',ambiguous:'مطابقة ملتبسة؛ تحتاج مراجعة'}[p.matchKind]||'');
   const reviewRow=p=>{
     const unknown=p.menuId==null;
     const unitNeedsReview=['unit_prefix','alias_unit_prefix'].includes(p.matchKind);
     const badge=unknown?(p.matchKind==='ambiguous'?'اسم ملتبس':'صنف غير معروف'):(unitNeedsReview?'وحدة بيع مختلفة':isPriceMismatch(p)?'تنبيه سعر مختلف':'مطابق');
     const badgeClass=unknown?(p.matchKind==='ambiguous'?'red':'yellow'):(unitNeedsReview?'yellow':isPriceMismatch(p)?'yellow':'green');
     const needsReview=isPriceMismatch(p)&&!unitNeedsReview;
     const inferred=p.matchKind==='unit_prefix'||p.matchKind==='alias_unit_prefix';
     return `<tr class="daily-price-row-v100 ${unknown?'is-new':needsReview?'is-mismatch':'is-match'}">
      <td><strong>${text(p.name)}</strong>${!unknown&&p.menuName&&p.menuName!==p.name?`<small class="daily-link-note-v104">الوجبة: ${text(p.menuName)}</small>`:''}</td>
      <td>${unknown?'جديد':p.menuPrice==null?'غير محدد':curr(p.menuPrice)}</td>
      <td>${curr(p.filePrice)}</td>
      <td><span class="badge ${badgeClass}">${badge}</span>
        ${matchNote(p)?`<small class="daily-link-note-v104">${text(matchNote(p))}</small>`:''}
        ${num(p.minFilePrice)!==num(p.maxFilePrice)?'<small class="daily-price-reason-v100">أسعار متعددة في التقرير</small>':''}
        ${inferred?'<small class="daily-link-warning-v104">تحقق من وحدة البيع: لن نغيّر سعر المنيو تلقائيًا.</small>':''}
      </td>
      <td>${unknown?`<div class="daily-new-choice-v104">
          <select class="daily-new-action-v104 daily-price-action-v041" data-price-index="${p.originalIndex}" data-no-searchable-select>
            <option value="">اختر القرار...</option>
            <option value="alias">اسم آخر لوجبة موجودة</option>
            <option value="create">إنشاء صنف جديد مستقل</option>
          </select>
          <div class="daily-alias-slot-v104" data-alias-for="${p.originalIndex}" hidden></div>
        </div>`:'سعر الملف محفوظ دائمًا · سعر المنيو لا يتغير'}</td></tr>`;
   };
   h('#daily-import-preview-v041').innerHTML=`<div class="daily-preview-v041"><h3>معاينة التقرير: ${text(file.name)}</h3>
    <div class="grid cols-3"><div class="card"><strong>${sum.orders}</strong><small>أوردرات كاملة</small></div><div class="card"><strong>${sum.lines}</strong><small>بنود أصلية</small></div><div class="card"><strong>${sum.review}</strong><small>تحتاج مراجعة حسابية</small></div></div>
    <div class="grid cols-3 daily-money-summary-v105">
     <div class="card"><small>مجموع صافي البنود</small><strong>${curr(audit.gross)}</strong></div>
     <div class="card"><small>فرق الصافي عن البنود</small><strong>${curr(audit.difference)}</strong></div>
     <div class="card"><small>صافي ملف الكاشير (مرجع المطابقة، ويُودع الجديد فقط)</small><strong>${curr(audit.net)}</strong></div>
    </div>
    <div class="notice daily-money-note-v105">لا يوجد في ملف Excel عمود ضريبة أو خصم صريح؛ لذلك <strong>لن نصنّف الفرق ضريبة مؤكّدة</strong>.
     ${audit.assumed?(audit.assumed.coherent?`إذا كانت نسبة الكاشير ${text(audit.assumed.ratePercent)}%، فقد يكون المجموع: إضافات ${curr(audit.assumed.additional)} وحسميات ${curr(audit.assumed.discounts)} (افتراض للمراجعة فقط).`:'النسبة المدخلة لا تفسّر جميع الأوردرات دون فروق إضافية؛ راجع تفاصيل الملف.'):'يمكنك إدخال نسبة مفترضة للمراجعة فقط، دون تغيير القبض.'}</div>
    ${audit.sypZeroOrders?`<div class="notice warning">عمود «ليرة سورية» في Excel يساوي صفرًا في ${audit.sypZeroOrders} أوردرات مجموع صافيها ${curr(audit.sypZeroNet)}. بناءً على تأكيدك أن جميع الأوردرات مدفوعة سنعتمد «صافي الطلب» لا هذا العمود؛ تأكد أن هذه المبالغ موجودة فعليًا في صندوق الكاشير.</div>`:''}
    ${sourceHead.mismatch?`<div class="notice warning">تنبيه تاريخ: رأسية التقرير تشير إلى ${sourceHead.headerDates.map(text).join('، ')} لكن تاريخ سطور الأوردرات ${dateChoice.originalDays.map(text).join('، ')}. تحقق من تاريخ التشغيل المحدد قبل اعتماد القبض.</div>`:''}
    <p class="metric-note">${dateChoice.overridden?`<strong>التاريخ المحدد للاستيراد: ${text(sum.days[0])} (كان في الملف ${dateChoice.originalDays.map(text).join('، ')})</strong>؛ محفوظ كتاريخ تشغيل، ويبقى توقيت الملف الأصلي للمراجعة.`:`الأيام المعتمدة من الملف: ${sum.days.map(text).join('، ')}.`} نقص تكلفة الوجبة لا يمنع تسجيل البيع. كل الأوردرات ظاهرة أدناه، ولا يتم استبعادها بسبب تكلفة الوصفة.</p>
    ${parsed.warnings?.length?`<details><summary>تنبيهات القراءة (${parsed.warnings.length})</summary><div class="daily-scroll-v041">${parsed.warnings.map(x=>`<p>سطر ${x.row}: ${text(x.message)}</p>`).join('')}</div></details>`:''}
    <details open><summary>الأوردرات في الملف (${sum.orders})</summary><div class="table-wrap daily-scroll-v041"><table class="table"><thead><tr><th>اليوم</th><th>رقم الأوردر</th><th>البنود</th><th>مجموع البنود</th><th>فرق الصافي</th><th>الصافي المقبوض</th><th>مراجعة</th></tr></thead><tbody>${records.map(r=>`<tr><td>${text(r.date)}</td><td>${text(r.number)}</td><td>${r.items.length}</td><td>${curr(r.grossTotal)}</td><td>${curr(r.netTotal-r.grossTotal)}</td><td><strong>${curr(r.netTotal)}</strong></td><td>${r.reviewReasons?.length?text(r.reviewReasons.join('؛ ')):'جاهز'}</td></tr>`).join('')}</tbody></table></div></details>
    <h4>تنبيهات اختلاف أسعار المنيو (للمعلومة فقط)</h4><p class="metric-note">سعر الكاشير في الملف هو مبلغ البيع الفعلي وسيُحفظ كما هو دائمًا. اختلافه عن سعر المنيو لا يغيّره ولا يحتاج منك اختيار سعر. اختر فقط ما إذا كان الاسم غير المعروف اسمًا بديلًا أو صنفًا جديدًا.</p>
    <div class="table-wrap daily-scroll-v041"><table class="table daily-price-review-v100"><thead><tr><th>الصنف</th><th>سعر المنيو</th><th>سعر الملف الأخير</th><th>المطابقة</th><th>القرار</th></tr></thead><tbody>${indexed.map(reviewRow).join('')}</tbody></table></div>
    <div class="notice sage">اعتماد الاستيراد سيضيف صافي الأوردرات <strong>الجديدة فقط</strong> إلى صندوق الكاشير المختار كقبض واحد لكل أوردر. الملف أو الأوردر المكرر لن يضيف قبضًا جديدًا؛ الاستيرادات القديمة تحتاج مطابقة مالية مستقلة. لا يخصم المخزون تلقائيًا.</div>
    <button type="button" id="daily-confirm-v041" class="btn">تأكيد استيراد ${sum.orders} أوردر</button></div>`;
   const previewHost=h('#daily-import-preview-v041');
   previewHost.querySelectorAll('.daily-new-action-v104').forEach(select=>{
     select.onchange=()=>{
       const slot=previewHost.querySelector(`[data-alias-for="${select.dataset.priceIndex}"]`);
       if(!slot)return;
       if(select.value!=='alias'){slot.hidden=true;slot.innerHTML='';return;}
       slot.hidden=false;
       slot.innerHTML=`<label>ابحث عن الوجبة المقصودة واخترها</label>
        <select class="daily-menu-target-v104" required aria-label="اختيار الوجبة المقصودة">
          <option value="">ابحث عن اسم الوجبة أو اسمها البديل...</option>${menuOptions(prepared.prices[Number(select.dataset.priceIndex)]?.filePrice)}
        </select>`;
     };
   });
   h('#daily-confirm-v041').onclick=async()=>{
    if(!prepared){toast('أعد معاينة الملف.','error');return;}
    const actions=[];
    for(const p of prepared.prices){
      const select=previewHost.querySelector(`[data-price-index="${prepared.prices.indexOf(p)}"]`);
      if(p.menuId==null){
        const mode=select?.value||'';
        if(mode!=='alias'&&mode!=='create'){
          toast(`اختر: إنشاء صنف جديد أم اسم بديل للصنف «${p.name}».`,'error');
          select?.focus();return;
        }
        if(mode==='alias'){
          const menuId=previewHost.querySelector(`[data-alias-for="${prepared.prices.indexOf(p)}"] .daily-menu-target-v104`)?.value||'';
          if(!menuId){toast(`اختر الوجبة المقصودة للاسم «${p.name}».`,'error');return;}
          actions.push({name:p.name,mode:'alias',menuId,priceMode:'keep'});
        }else actions.push({name:p.name,mode:'create'});
      }
    }
    const aliasesCount=actions.filter(x=>x.mode==='alias').length;
    const newCount=actions.filter(x=>x.mode==='create').length;
    const chosenDays=[...new Set(prepared.records.map(r=>r.date))].join('، ');
    const boxLabel=h('#daily-box-v041').selectedOptions[0]?.textContent?.trim()||'الصندوق المختار';
    if(!(await confirmBox(`تأكيد أوردرات «${prepared.fileName}» بتاريخ ${chosenDays}؟ مجموع صافي الملف ${curr(prepared.audit.net)}. سيُرحّل صافي الأوردرات الجديدة فقط إلى «${boxLabel}» مع منع التكرار، وستبقى أسعار الملف كما هي. ${aliasesCount} اسم بديل و${newCount} صنف جديد. إذا سبق تسجيل المقبوض يدويًا فلا تؤكّد قبل المطابقة.`, 'تأكيد قبض الكاشير واستيراد الأوردرات')))return;
    const b=h('#daily-confirm-v041');b.disabled=true;
    try{const result=await api.ameenImportDailyV041(prepared.fileName,prepared.hash,prepared.records,actions,prepared.cashboxId);
      const notices=(result.reviewNotes||[]).map(r=>`${r.date} / ${r.number}: ${r.reason}`).join('؛ ');
      const summary=`جديد: ${num(result.created)} · موجود مسبقًا: ${num(result.existing)} · تعارض: ${num(result.conflicts)} · بنود جديدة: ${num(result.lines)} · قبض مُرحّل الآن: ${num(result.cashPostedOrders)} أوردر بقيمة ${curr(result.cashPostedSyp)} · أسماء بديلة: ${num(result.aliasesAdded)} · أصناف جديدة: ${num(result.menuItemsAdded)}`;
      toast('تم اعتماد الأوردرات.','success');
      h('#daily-import-preview-v041').innerHTML=`<div class="notice sage"><strong>نتيجة الاستيراد</strong><p>${text(summary)}</p>${result.duplicateFile?'<p>الملف نفسه سبق استيراده؛ لم تنشأ حركة قبض ثانية. إذا كان من الإصدار القديم فراجعه ماليًا قبل الترحيل اليدوي.</p>':''}${notices?`<p>التعارضات: ${text(notices)}</p>`:''}</div>`;
      shownDate=prepared.records.map(r=>r.date).sort().at(-1)||shownDate;
      prepared=null;h('#daily-day-v041').value=shownDate;
      await refresh();await renderHistory();
    }catch(e){toast(friendlyError(e,'فشل الاستيراد؛ لم يُحفظ استيراد جزئي. تأكد من SQL v1.0.5.'),'error');b.disabled=false;}
   };
  }catch(e){prepared=null;h('#daily-import-preview-v041').innerHTML=renderError(e);}
  finally{btn.disabled=false;}
 };
 await Promise.all([refresh(),renderHistory()]);
}
