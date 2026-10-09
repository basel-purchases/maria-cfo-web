import * as api from '../api.js?v=0.19';
import { loader, friendlyError } from '../ui.js?v=0.19';
import { money, esc, todayISO } from '../utils.js?v=0.19';
import { financialCard, financialRowTable, qualityMessages, barTrend, finalProfitValue, simpleInfo } from '../finance-ui.js?v=0.19';

function periodStart(kind){
  const today=todayISO();const d=new Date(today+'T12:00:00');
  if(kind==='day')return today;
  if(kind==='week'){d.setDate(d.getDate()-6);return d.toISOString().slice(0,10);}
  if(kind==='year')return `${today.slice(0,4)}-01-01`;
  return `${today.slice(0,7)}-01`;
}
function val(v){return v==null?'—':money(v);}
function num(v){return Number.isFinite(Number(v))?Number(v):0;}
function pct(v){return v==null?'—':`${esc(Number(v).toLocaleString('ar-SY',{maximumFractionDigits:1}))}%`;}
const itemColumns=[
  {key:'name',label:'الصنف'},
  {key:'quantity_sold',label:'الكمية',format:v=>esc(v??'—')},
  {key:'revenue_base',label:'الإيراد',format:v=>val(v)},
];

export async function renderReports(root){
  root.innerHTML=`
  <div class="page-head"><div><h2>مركز التقارير والإحصائيات</h2><p>قراءة مالية وتشغيلية من سجلات Supabase الفعلية، تشمل الاستثناءات وجودة البيانات إلى جانب النتائج.</p></div></div>
  <div class="card report-filter"><div class="quick-actions report-presets">
    <button class="btn soft period-preset" data-period="day">اليوم</button>
    <button class="btn soft period-preset" data-period="week">آخر 7 أيام</button>
    <button class="btn soft period-preset" data-period="month">هذا الشهر</button>
    <button class="btn soft period-preset" data-period="year">هذه السنة</button>
  </div><div class="form-grid"><div class="field"><label>من</label><input id="r-from" type="date" value="${periodStart('month')}"></div><div class="field"><label>إلى</label><input id="r-to" type="date" value="${todayISO()}"></div></div>
  <div class="quick-actions"><button class="btn" id="r-load">تحديث التقرير</button></div></div>
  <div id="report-out" aria-live="polite"></div>`;
  const out=root.querySelector('#report-out'),from=root.querySelector('#r-from'),to=root.querySelector('#r-to');
  const refresh=()=>loadReport(out,from.value,to.value);
  root.querySelector('#r-load').onclick=refresh;
  for(const button of root.querySelectorAll('.period-preset'))button.onclick=()=>{
    from.value=periodStart(button.dataset.period);to.value=todayISO();refresh();
  };
  await refresh();
}

async function loadReport(out,start,end){
  if(!start||!end||end<start){out.innerHTML='<div class="notice">اختر فترة صحيحة: تاريخ النهاية يجب ألا يسبق تاريخ البداية.</div>';return;}
  out.innerHTML=loader();
  const days=Math.floor((new Date(end+'T12:00:00')-new Date(start+'T12:00:00'))/86400000);
  const granularity=days>400?'month':days>50?'month':'day';
  const [dataResult,trendResult]=await Promise.allSettled([api.statistics(start,end),api.statisticsTimeSeries(start,end,granularity)]);
  if(dataResult.status==='rejected'){
    out.innerHTML=`<div class="notice">${esc(friendlyError(dataResult.reason,'تعذر تحميل التقرير من قاعدة البيانات.'))}</div>`;
    return;
  }
  const r=dataResult.value||{};
  const k=r.kpis||{},sales=r.sales||{},events=r.events||{},expenses=r.expenses||{},payroll=r.payroll||{},inventory=r.inventory||{},cashflow=r.cashflow||{},purchases=r.purchases||{},fx=r.exchange_rates||{};
  const warnings=qualityMessages(r);
  const profit=finalProfitValue(r);
  const fcRate=num(k.total_revenue_base)>0?num(k.food_cost_base)/num(k.total_revenue_base)*100:null;
  const trend=trendResult.status==='fulfilled'?trendResult.value?.series:[];
  out.innerHTML=`
  <div class="finance-callout ${k.profit_is_final===false?'finance-caution':''}"><strong>${k.profit_is_final===false?'النتيجة المالية مؤقتة':'نتيجة الفترة المالية'}</strong><span>${k.profit_is_final===false?'توجد تكاليف تاريخية ناقصة؛ لا نعرض صافي الربح المؤقت بوصفه نهائيًا.':'الحسابات المعروضة من قاعدة البيانات وليست تقديرات من الواجهة.'}</span></div>
  <div class="grid cols-4 finance-summary-grid" style="margin-top:16px">
    ${financialCard('إجمالي الإيرادات',k.total_revenue_base,{foot:'مبيعات الأوردرات والحجوزات المستحقة'})}
    ${financialCard(k.profit_is_final===false?'النتيجة المؤقتة':'صافي النتيجة',profit,{foot:k.profit_is_final===false?'غير نهائية بسبب بيانات التكلفة':'بعد التكاليف المحاسبية',tone:k.profit_is_final===false?'metric-warning':''})}
    ${financialCard('تكلفة الطعام',k.food_cost_base,{foot:`نسبة تكلفة الطعام: ${fcRate===null?'غير متاحة':pct(fcRate)}`})}
    ${financialCard('المصروفات التشغيلية',k.operating_expenses_base,{foot:'المشتريات المخزنية ليست مصروفًا مباشرًا'})}
    ${financialCard('تكلفة الرواتب',k.payroll_expense_base,{foot:'من المسيرات المعتمدة فقط'})}
    ${financialCard('التدفق النقدي الصافي',cashflow.net_cashflow_base,{foot:'النقد الداخل − النقد الخارج'})}
    ${financialCard('عدد الأوردرات',k.order_count,{currency:false,foot:`متوسط الأوردر ${money(k.average_ticket_base||0)}`})}
    ${financialCard('قيمة المشتريات',k.purchase_value_base,{foot:'تزيد المخزون، ولا تُخصم مرتين من الربح'})}
  </div>
  <div class="grid cols-2 finance-blocks">
    <section class="card finance-section"><div class="finance-section-head"><h3>اتجاه الإيرادات</h3><span class="metric-note">${granularity==='day'?'حسب اليوم':'حسب الشهر'}</span></div>${trendResult.status==='rejected'?`<div class="notice">${esc(friendlyError(trendResult.reason,'تعذر تحميل الرسم الزمني.'))}</div>`:barTrend(trend)}<p class="metric-note">يعرض حتى آخر 31 فترة من النطاق المحدد. الأرقام من سجل المبيعات المنشورة.</p></section>
    <section class="card finance-section"><h3>استثناءات تحتاج انتباه المدير</h3>
      ${warnings.length?`<div class="finance-alert-list">${warnings.map(([title,desc])=>`<div class="finance-alert"><strong>${esc(title)}</strong><small>${esc(desc)}</small></div>`).join('')}</div>`:'<div class="notice green">لا توجد استثناءات جودة بيانات في هذه الفترة وفق فحوص التقرير.</div>'}
    </section>
  </div>
  <div class="grid cols-2 finance-blocks">
    <section class="card finance-section"><h3>تحليل المبيعات</h3>
      ${simpleInfo('مبيعات الأوردرات',money(k.order_sales_base||0))}
      ${simpleInfo('إيرادات حجوزات الحفلات',money(k.event_booking_revenue_base||0))}
      ${simpleInfo('إجمالي قبل الخصم',money(sales.gross_sales_before_discount_base||0))}
      ${simpleInfo('الخصومات',money(sales.discount_base||0))}
      ${simpleInfo('ضيافة / قيمة اسمية',money(sales.complimentary_nominal_base||0))}
      ${simpleInfo('تكلفة الضيافة المعروفة',money(sales.complimentary_known_cost_base||0))}
      ${simpleInfo('متوسط فاتورة الأوردر',money(sales.average_ticket_base||0))}
    </section>
    <section class="card finance-section"><h3>نظرة على النقد والصناديق</h3>
      ${simpleInfo('النقد الداخل',money(cashflow.cash_in_base||0))}
      ${simpleInfo('النقد الخارج',money(cashflow.cash_out_base||0))}
      ${simpleInfo('صافي حركة النقد',money(cashflow.net_cashflow_base||0))}
      ${simpleInfo('فروقات إغلاق الصناديق',money(cashflow.cashbox_difference_base||0))}
      ${simpleInfo('إغلاقات بفروقات',cashflow.cashbox_mismatch_count||0)}
      <div class="finance-subsection"><h4>تفاصيل الصناديق</h4>${financialRowTable(r.cashboxes,[
        {key:'cashbox_name',label:'الصندوق'},
        {key:'inflow_base',label:'الدخول',format:val},
        {key:'outflow_base',label:'الخروج',format:val},
        {key:'difference_base',label:'الفرق',format:val},
      ])}</div>
    </section>
    <section class="card finance-section"><h3>الرواتب والموظفون</h3>
      ${simpleInfo('تكلفة الرواتب المحاسبية',money(payroll.allocated_payroll_expense_base||0))}
      ${simpleInfo('رواتب خرجت نقدًا',money(payroll.salary_cash_paid_base||0))}
      ${simpleInfo('سلف خرجت نقدًا',money(payroll.employee_advance_cash_paid_base||0))}
      <div class="finance-note">تكلفة الراتب ليست هي نفسها حركة دفعه؛ يتم احتساب التكلفة من المسير المعتمد، والنقد عند الصرف.</div><a class="text-link" href="#/payroll">انتقل إلى الرواتب والمستحقات ←</a>
    </section>
    <section class="card finance-section"><h3>الحفلات والمصروفات</h3>
      ${simpleInfo('الحفلات المكتملة',events.completed_event_count||0)}
      ${simpleInfo('إيراد الحجوزات',money(events.booking_revenue_base||0))}
      ${simpleInfo('تكلفة طعام الحفلات',money(events.included_food_cost_base||0))}
      ${simpleInfo('ربحية الحفلات الإدارية',money(events.management_event_profit_base||0))}
      ${simpleInfo('عدد المصروفات',expenses.expense_count||0)}
      ${simpleInfo('مصروفات الحفلات',money(expenses.event_expenses_base||0))}
      ${simpleInfo('المصروفات خارج الحفلات',money(expenses.non_event_expenses_base||0))}
    </section>
    <section class="card finance-section"><h3>المخزون والمشتريات</h3>
      ${simpleInfo('عدد فواتير الشراء',purchases.invoice_count||0)}
      ${simpleInfo('قيمة شراء المواد',money(purchases.purchase_value_base||0))}
      ${simpleInfo('عمليات الهدر',inventory.waste_count||0)}
      ${simpleInfo('تكلفة الهدر المعروفة',money(inventory.waste_cost_base||0))}
      ${simpleInfo('حركات تعديل المخزون',inventory.adjustment_count||0)}
      ${simpleInfo('صافي أثر التعديلات',val(inventory.adjustment_net_base))}
      ${simpleInfo('تكلفة الهدر غير مكتملة',inventory.waste_cost_incomplete?'نعم':'لا')}
    </section>
    <section class="card finance-section"><h3>العملات وفروقات الصرف</h3>
      ${simpleInfo('فروقات دفعات الموردين',val(fx.supplier_payment_difference_base))}
      ${simpleInfo('فروقات صرف الرواتب',val(fx.payroll_payment_difference_base))}
      ${simpleInfo('فروقات دفعات الحفلات',val(fx.event_booking_difference_base))}
      ${simpleInfo('صافي فروقات الصرف المحققة',val(fx.realized_fx_net_base))}
    </section>
  </div>
  <div class="grid cols-2 finance-blocks">
    <section class="card finance-section"><h3>الأصناف الأكثر مبيعًا</h3>${financialRowTable(r.top_selling_items,itemColumns)}</section>
    <section class="card finance-section"><h3>الأصناف الأقل مبيعًا</h3>${financialRowTable(r.least_selling_items,itemColumns)}</section>
    <section class="card finance-section"><h3>الموردون خلال الفترة</h3>${financialRowTable(r.top_suppliers,[
      {key:'supplier_name',label:'المورد'},
      {key:'invoice_count',label:'الفواتير'},
      {key:'purchase_value_base',label:'المشتريات',format:val},
      {key:'current_outstanding_for_period_invoices_base',label:'المتبقي',format:val},
    ])}</section>
    <section class="card finance-section"><h3>تغير تكاليف المواد</h3>${financialRowTable(r.material_cost_changes,[
      {key:'material_name',label:'المادة'},
      {key:'first_cost_per_base_unit',label:'قبل',format:val},
      {key:'last_cost_per_base_unit',label:'الآن',format:val},
      {key:'percent_change',label:'التغير',format:pct},
    ])}</section>
    <section class="card finance-section"><h3>تغيرات أسعار القائمة</h3>${financialRowTable(r.menu_price_changes,[
      {key:'menu_item_name',label:'الصنف'},
      {key:'old_price',label:'السعر السابق',format:(v,row)=>v==null?'—':money(v,row.old_currency||'SYP')},
      {key:'new_price',label:'السعر الجديد',format:(v,row)=>v==null?'—':money(v,row.new_currency||'SYP')},
    ])}</section>
  </div>`;
}
