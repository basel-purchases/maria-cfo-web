import * as api from '../api.js?v=1.0.32';
import {esc,money,todayISO} from '../utils.js?v=1.0';
import {loader,friendlyError} from '../ui.js?v=1.0.31';

export const ANALYTIC_TABS_V132=[
  {key:'overview',name:'الملخص'},
  {key:'finance',name:'التقرير المالي'},
  {key:'sales',name:'المبيعات'},
  {key:'inventory',name:'المخزون'},
  {key:'employees',name:'الموظفون'},
  {key:'events',name:'الحفلات'},
  {key:'alerts',name:'التنبيهات'},
];
const number=n=>Number(n||0).toLocaleString('ar-SY');
const panelCard=(label,value,foot='')=>`<div class="card"><small>${esc(label)}</small><h3>${value}</h3>${foot?`<p class="metric-note">${esc(foot)}</p>`:''}</div>`;
const pair=(label,value)=>`<div class="finance-info-row"><span>${esc(label)}</span><strong>${value}</strong></div>`;
const now=()=>todayISO();
const month=()=>now().slice(0,7)+'-01';

export async function renderAnalyticsTabV132(host, key) {
  if(key==='finance'){
    const {renderReports}=await import('./reports.js?v=1.0');
    return renderReports(host);
  }
  if(key==='overview'){
    const [dashboardResult,queueResult]=await Promise.allSettled([api.dashboard(),api.v131SaleQueueSummary()]);
    const d=dashboardResult.status==='fulfilled'?dashboardResult.value:{};
    const t=d.today||{},q=queueResult.status==='fulfilled'?queueResult.value:{};
    host.innerHTML=`<div class="grid cols-4">
      ${panelCard('إيراد اليوم',t.revenue_base==null?'—':money(t.revenue_base))}
      ${panelCard('أوردرات اليوم',t.order_count==null?'—':number(t.order_count))}
      ${panelCard('تكلفة الطعام المعروفة',t.food_cost_base==null?'—':money(t.food_cost_base))}
      ${panelCard('مبيعات بانتظار استكمال التكلفة',q.pending==null?'—':number(q.pending))}</div>
      <div class="quick-actions"><a class="btn" href="#/daily-orders">أوردرات اليوم</a><a class="btn secondary" href="#/sale-cost-queue">استكمال تكاليف المبيعات</a><a class="btn soft" href="#/purchases">فاتورة شراء</a><a class="btn soft" href="#/cashboxes">الصناديق</a></div>
      ${dashboardResult.status==='rejected'?`<div class="notice">تعذر جلب مؤشرات اليوم: ${esc(friendlyError(dashboardResult.reason))}</div>`:''}`;
    return;
  }
  if(key==='sales'){
    const result=await api.statistics(month(),now());
    const k=result.kpis||{};
    host.innerHTML=`<div class="grid cols-3">${panelCard('إيرادات الشهر',money(k.total_revenue_base))}${panelCard('عدد الأوردرات',number(k.order_count))}${panelCard('متوسط الأوردر',money(k.average_ticket_base))}</div>
    <div class="card"><h3>الأصناف الأكثر مبيعًا</h3><div class="table-wrap"><table class="table"><thead><tr><th>الصنف</th><th>الكمية</th><th>الإيرادات</th></tr></thead><tbody>
    ${(result.top_selling_items||[]).slice(0,15).map(r=>`<tr><td>${esc(r.name)}</td><td>${number(r.quantity_sold)}</td><td>${money(r.revenue_base)}</td></tr>`).join('')||'<tr><td colspan="3">لا تتوفر مبيعات لهذه الفترة</td></tr>'}</tbody></table></div></div><a class="btn secondary" href="#/daily-orders">تفاصيل الأوردرات</a>`;
    return;
  }
  if(key==='inventory'){
    const [materials,counts]=await Promise.all([api.materials(),api.v131SaleQueueSummary()]);
    const a=materials||[];
    const zero=a.filter(m=>Number(m.current_stock_base??m.stock_quantity??m.current_stock??0)<=0).length;
    host.innerHTML=`<div class="grid cols-3">${panelCard('عدد المواد',number(a.length))}${panelCard('مواد برصيد صفري أو غير موجب',number(zero))}${panelCard('مبيعات معلّقة التكلفة',number(counts.pending))}</div>
    <div class="quick-actions"><a class="btn secondary" href="#/materials">المواد والأسعار</a><a class="btn secondary" href="#/count-history">سجل الجرد</a><a class="btn soft" href="#/sale-cost-queue">تسوية المبيعات</a></div>`;
    return;
  }
  if(key==='employees'){
    const [staff,balances]=await Promise.all([api.employees(),api.approvedSalaryBalances()]);
    host.innerHTML=`<div class="grid cols-2">${panelCard('الموظفون',number(staff.length))}${panelCard('أرصدة رواتب معتمدة غير مصروفة',number(balances.length))}</div>
    <div class="quick-actions"><a class="btn secondary" href="#/employees-list">ملفات الموظفين</a><a class="btn secondary" href="#/payroll">مسيرات الرواتب</a><a class="btn secondary" href="#/advances">السلف</a></div>`;
    return;
  }
  if(key==='events'){
    const events=await api.events();
    const coming=events.filter(x=>String(x.event_date||'')>=now()&&!['completed','cancelled'].includes(x.status));
    host.innerHTML=`<div class="grid cols-2">${panelCard('جميع الحفلات',number(events.length))}${panelCard('حفلات قادمة',number(coming.length))}</div>
    <div class="card"><h3>الحفلات القادمة</h3>${coming.slice(0,20).map(x=>pair(x.name||'حفلة',esc(x.event_date||'—'))).join('')||'<p>لا توجد حفلات قادمة مسجلة.</p>'}</div><a class="btn secondary" href="#/events-list">إدارة الحفلات</a>`;
    return;
  }
  if(key==='alerts'){
    const [notifications,queue]=await Promise.all([api.notifications(),api.v131SaleQueueSummary()]);
    host.innerHTML=`<div class="grid cols-2">${panelCard('مبيعات تنتظر استكمال التكلفة',number(queue.pending))}${panelCard('إشعارات غير مقروءة',number(notifications.filter(n=>!n.read_at&&!n.is_read).length))}</div>
    <div class="card"><h3>التنبيهات المسجلة</h3>${notifications.slice(0,30).map(n=>pair(n.title||'إشعار',esc(n.message||''))).join('')||'<p>لا توجد إشعارات.</p>'}</div><a class="btn secondary" href="#/sale-cost-queue">مراجعة تسويات المبيعات</a>`;
  }
}

export function renderAnalyticsTabsV132(root,{initialTab='overview'}={}){
  const valid=ANALYTIC_TABS_V132.some(t=>t.key===initialTab)?initialTab:'overview';
  root.innerHTML=`<div class="page-head"><div><h2>لوحة المتابعة والإحصائيات</h2><p>يُحمَّل التبويب المفتوح فقط، وتبقى التبويبات الأخرى دون استعلامات حتى فتحها.</p></div></div>
    <div class="v132-analytics-tabs" role="tablist" aria-label="أقسام الإحصائيات">
    ${ANALYTIC_TABS_V132.map(t=>`<button type="button" class="v132-analytics-tab" role="tab" data-analytics-tab="${esc(t.key)}">${esc(t.name)}</button>`).join('')}</div>
    ${ANALYTIC_TABS_V132.map(t=>`<section class="v132-analytics-pane" data-analytics-pane="${esc(t.key)}" role="tabpanel" hidden></section>`).join('')}
    <div class="quick-actions v132-refresh-line"><button class="btn secondary" id="v132-refresh-tab" type="button">تحديث التبويب الحالي</button></div>`;
  const cache=new Set();let active=valid;
  const choose=async (key,force=false)=>{
    active=key;
    root.querySelectorAll('[data-analytics-tab]').forEach(b=>{
      const selected=b.dataset.analyticsTab===key;
      b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));
    });
    root.querySelectorAll('[data-analytics-pane]').forEach(p=>p.hidden=p.dataset.analyticsPane!==key);
    const panel=root.querySelector(`[data-analytics-pane="${key}"]`);
    if(!force&&cache.has(key))return;
    panel.innerHTML=loader();
    try{await renderAnalyticsTabV132(panel,key);cache.add(key);}
    catch(error){panel.innerHTML=`<div class="notice rose">${esc(friendlyError(error,'تعذر تحميل هذا القسم.'))}</div>`;}
  };
  root.querySelectorAll('[data-analytics-tab]').forEach(b=>b.onclick=()=>void choose(b.dataset.analyticsTab));
  root.querySelector('#v132-refresh-tab').onclick=()=>void choose(active,true);
  void choose(valid);
}
