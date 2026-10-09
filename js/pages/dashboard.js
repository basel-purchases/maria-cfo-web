import * as api from '../api.js?v=0.20';
import { loader, friendlyError } from '../ui.js?v=0.20';
import { money, pick, esc, dateOnly, todayISO } from '../utils.js?v=0.20';
import { financialCard, qualityMessages, financialRowTable, finalProfitValue } from '../finance-ui.js?v=0.20';

const ok=(r,fallback)=>r.status==='fulfilled'?r.value:fallback;
function setupStep(title,subtitle,ready,href,optional=false){return `<a class="setup-row ${ready?'ready':''}" href="${href}"><div class="setup-status">${ready?'✓':'!'}</div><div><strong>${esc(title)}${optional?' — اختياري':''}</strong><small>${esc(subtitle)}</small></div></a>`;}
export async function renderDashboard(root){
  root.innerHTML=loader();
  const monthStart=`${todayISO().slice(0,7)}-01`;
  const [dashResult,monthResult,notesResult,matsResult,menuResult,employeesResult,boxesResult,eventsResult,duesResult,balancesResult]=await Promise.allSettled([
    api.dashboard(),api.statistics(monthStart,todayISO()),api.notifications(),api.materials(),api.menuItems(),api.employees(),api.cashboxes(),api.events(),api.dailyWageDues(),api.approvedSalaryBalances(),
  ]);
  if(dashResult.status==='rejected'&&monthResult.status==='rejected'){
    root.innerHTML=`<div class="notice">تعذّر تحميل البيانات المالية من قاعدة البيانات: ${esc(friendlyError(dashResult.reason))}</div>`;
    return;
  }
  const dash=ok(dashResult,{}),month=ok(monthResult,{}),m=month.kpis||{};
  const today=dash.today||{},notes=ok(notesResult,[]),mats=ok(matsResult,[]),menu=ok(menuResult,[]),emps=ok(employeesResult,[]),boxes=ok(boxesResult,[]),evts=ok(eventsResult,[]);
  const dailyDues=ok(duesResult,[]).filter(x=>Number(x.estimated_due_original)>0.001),approvedBalances=ok(balancesResult,[]);
  const noticeSummary=dash.notifications||{};
  const unread=Number(noticeSummary.unread_count??notes.filter(n=>!n.read_at&&!n.is_read).length);
  const significant=notes.filter(n=>!n.read_at&&!n.is_read).slice(0,5);
  const upcoming=evts.filter(x=>!['completed','cancelled'].includes(x.status)&&String(x.event_date)>=todayISO()).sort((a,b)=>String(a.event_date).localeCompare(String(b.event_date))).slice(0,4);
  const alerts=qualityMessages(month);
  const resultValue=today.profit_is_final===false?today.provisional_net_result_base:today.net_result_base;
  const monthlyProfit=finalProfitValue(month);
  root.innerHTML=`
    <div class="page-head"><div><h2>لوحة المدير</h2><p>حالة Maria CFO المالية والتشغيلية في مكان واحد · اليوم ${dateOnly(dash.business_date||todayISO())}</p></div><a href="#/reports" class="btn secondary">التقرير المالي الكامل</a></div>
    <div class="quick-actions dashboard-actions"><a class="btn" href="#/orders">أوردر جديد</a><a class="btn secondary" href="#/purchases">فاتورة شراء</a><a class="btn secondary" href="#/expenses">مصروف</a><a class="btn soft" href="#/attendance">تسجيل الدوام</a><a class="btn soft" href="#/assistant">اسأل المساعد</a></div>
    ${dashResult.status==='rejected'?`<div class="notice">تعذر عرض أرقام اليوم: ${esc(friendlyError(dashResult.reason))}</div>`:''}
    ${monthResult.status==='rejected'?`<div class="notice">تعذر عرض مقارنة الشهر: ${esc(friendlyError(monthResult.reason))}</div>`:''}
    <div class="finance-label">مؤشرات اليوم</div>
    <div class="grid cols-4 finance-summary-grid">
      ${financialCard('مبيعات اليوم',dashResult.status==='fulfilled'?today.revenue_base:null,{foot:'من المبيعات المنشورة'})}
      ${financialCard('عدد أوردرات اليوم',dashResult.status==='fulfilled'?today.order_count:null,{currency:false,foot:'العمليات المنشورة'})}
      ${financialCard(today.profit_is_final===false?'نتيجة اليوم المؤقتة':'نتيجة اليوم',dashResult.status==='fulfilled'?resultValue:null,{tone:today.profit_is_final===false?'metric-warning':'',foot:today.profit_is_final===false?'تكاليف غير مكتملة؛ ليست ربحًا نهائيًا':'من قاعدة البيانات'})}
      ${financialCard('تكلفة طعام اليوم',dashResult.status==='fulfilled'?today.food_cost_base:null,{foot:today.food_cost_percent!=null?`Food Cost ${today.food_cost_percent}%`:'لا تتوفر نسبة مؤكدة'})}
    </div>
    <div class="finance-label">من بداية الشهر</div>
    <div class="grid cols-4 finance-summary-grid">
      ${financialCard('إيرادات الشهر',monthResult.status==='fulfilled'?m.total_revenue_base:null)}
      ${financialCard('المصروفات التشغيلية',monthResult.status==='fulfilled'?m.operating_expenses_base:null)}
      ${financialCard('تكلفة الرواتب المعتمدة',monthResult.status==='fulfilled'?m.payroll_expense_base:null)}
      ${financialCard(m.profit_is_final===false?'النتيجة المؤقتة للشهر':'نتيجة الشهر',monthResult.status==='fulfilled'?monthlyProfit:null,{foot:m.profit_is_final===false?'النتيجة غير نهائية':'بعد التكاليف'})}
    </div>
    <div class="grid cols-2 finance-blocks">
      <section class="card finance-section"><div class="finance-section-head"><h3>المستحقات والدوام</h3><a href="#/payroll" class="text-link">الرواتب ←</a></div>
        ${duesResult.status==='rejected'?'<p class="metric-note">تفعيل عرض الأجور اليومية يتطلب تحديث قاعدة البيانات v0.14.</p>':`<div class="finance-info-row"><span>أيام أجور يومية وساعية بانتظار الدفع</span><strong>${dailyDues.length}</strong></div>`}
        ${balancesResult.status==='fulfilled'?`<div class="finance-info-row"><span>أرصدة رواتب معتمدة لم تُدفع بالكامل</span><strong>${approvedBalances.length}</strong></div>`:''}
        <div class="finance-info-row"><span>عدد الموظفين</span><strong>${emps.length}</strong></div>
        <div class="finance-info-row"><span>عدد الرواتب التي خرجت نقدًا خلال الشهر</span><strong>${monthResult.status==='fulfilled'?money(month.payroll?.salary_cash_paid_base||0):'—'}</strong></div>
        <p class="metric-note">الأجور اليومية غير المعتمدة تقديرية، ولا تدخل في ربح الشهر قبل إنشاء مسيرها المحاسبي.</p>
      </section>
      <section class="card finance-section"><div class="finance-section-head"><h3>تنبيهات وحالات خاصة</h3><a href="#/reports" class="text-link">جميع التحليلات ←</a></div>
        <div class="finance-info-row"><span>إشعارات غير مقروءة</span><strong>${unread}</strong></div>
        ${alerts.length?`<div class="finance-alert-list">${alerts.slice(0,5).map(([title,detail])=>`<div class="finance-alert"><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>`).join('')}</div>`:''}
        ${significant.length?`<div class="finance-subsection"><h4>إشعارات نشطة</h4>${significant.map(n=>`<div class="finance-info-row"><span>${esc(n.title||n.message||'إشعار')}</span><strong>${esc(n.severity||'')}</strong></div>`).join('')}</div>`:''}
        ${notesResult.status==='rejected'?'<div class="notice">تعذّر تحميل الإشعارات. راجع مركز التنبيهات بدل افتراض عدم وجودها.</div>':''}
        ${!alerts.length&&!significant.length&&notesResult.status==='fulfilled'?'<div class="notice green">لا توجد تنبيهات ظاهرة وفق بيانات التقارير والإشعارات المحمّلة.</div>':''}
      </section>
      <section class="card finance-section"><div class="finance-section-head"><h3>الصناديق والنقد</h3><a href="#/cashboxes" class="text-link">عرض الصناديق ←</a></div>
        <div class="finance-info-row"><span>عدد الصناديق المعرفة</span><strong>${boxes.length}</strong></div>
        ${monthResult.status==='fulfilled'?`<div class="finance-info-row"><span>نقد داخل هذا الشهر</span><strong>${money(month.cashflow?.cash_in_base||0)}</strong></div><div class="finance-info-row"><span>نقد خارج هذا الشهر</span><strong>${money(month.cashflow?.cash_out_base||0)}</strong></div>`:''}
        ${Array.isArray(dash.cashboxes)&&dash.cashboxes.length?financialRowTable(dash.cashboxes,[
          {key:'cashbox_name',label:'الصندوق'},
          {key:'status',label:'الحالة',format:x=>esc(x==='open'?'مفتوح':x==='closed'?'مغلق':x)},
          {key:'expected_balance_base',label:'النظري',format:x=>x==null?'—':money(x)},
        ]):'<div class="metric-note">لا توجد جلسات صندوق لليوم بعد.</div>'}
      </section>
      <section class="card finance-section"><div class="finance-section-head"><h3>الحفلات القادمة</h3><a href="#/events" class="text-link">كل الحفلات ←</a></div>
        <div class="finance-info-row"><span>عدد الحفلات القادمة خلال أسبوع</span><strong>${dash.upcoming_event_count??'—'}</strong></div>
        ${upcoming.length?upcoming.map(e=>`<div class="finance-info-row"><span>${esc(e.name||'حفلة')}</span><strong>${dateOnly(e.event_date)}</strong></div>`).join(''):'<div class="metric-note">لا توجد حفلات قادمة مسجلة.</div>'}
      </section>
      <section class="card finance-section"><div class="finance-section-head"><h3>أهم الأصناف مبيعًا هذا الشهر</h3><a href="#/reports" class="text-link">تحليل الأصناف ←</a></div>
        ${financialRowTable((month.top_selling_items||[]).slice(0,5),[
          {key:'name',label:'الصنف'},
          {key:'quantity_sold',label:'الكمية'},
          {key:'revenue_base',label:'الإيرادات',format:x=>money(x||0)},
        ])}
      </section>
      <section class="card finance-section"><h3>حالة الإعداد</h3><div class="setup-list">
        ${setupStep('المواد','قاعدة المخزون',mats.length>0,'#/materials')}
        ${setupStep('الأصناف والوصفات','تحديد التكلفة والسعر',menu.length>0,'#/menu')}
        ${setupStep('الصناديق','تعريف الصناديق',boxes.length>0,'#/cashboxes')}
        ${setupStep('الموظفون','لمن يريد الدوام والرواتب',emps.length>0,'#/employees-list',true)}
      </div></section>
    </div>
    <div class="finance-note">المصدر: PostgreSQL عبر Supabase. النتائج غير المكتملة لا تُقدَّم كأرباح نهائية. المشتريات والرواتب النقدية لا تُحتسب مرتين في النتيجة المحاسبية.</div>`;
}
