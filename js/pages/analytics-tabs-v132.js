import * as api from '../api.js?v=1.0.35';
import {esc,money,todayISO} from '../utils.js?v=1.0';
import {loader,friendlyError} from '../ui.js?v=1.0.31';

export const ANALYTIC_TABS_V132=[
  {key:'overview',name:'الملخص'},
  {key:'finance',name:'التقرير المالي'},
  {key:'sales',name:'المبيعات'},
  {key:'purchases',name:'المشتريات'},
  {key:'cost',name:'الكوست'},
  {key:'inventory',name:'المخزون'},
  {key:'employees',name:'الموظفون'},
  {key:'events',name:'الحفلات'},
  {key:'alerts',name:'التنبيهات'},
];
const number=n=>Number(n||0).toLocaleString('ar-SY-u-nu-latn');
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
    const [dashboardResult,queueResult,historicResult,costResult]=await Promise.allSettled([api.dashboard(),api.v131SaleQueueSummary(),api.v135ArchiveFinance(),api.v135FoodCostOverview()]);
    const d=dashboardResult.status==='fulfilled'?dashboardResult.value:{};
    const t=d.today||{},q=queueResult.status==='fulfilled'?queueResult.value:{};
    const h=historicResult.status==='fulfilled'?historicResult.value:{},c=costResult.status==='fulfilled'?costResult.value:{};
    host.innerHTML=`<div class="grid cols-4">
      ${panelCard('إيراد اليوم',t.revenue_base==null?'—':money(t.revenue_base))}
      ${panelCard('أوردرات اليوم',t.order_count==null?'—':number(t.order_count))}
      ${panelCard('تكلفة الطعام المعروفة',t.food_cost_base==null?'—':money(t.food_cost_base))}
      ${panelCard('مبيعات بانتظار استكمال التكلفة',number(Number(q.pending||0)+Number(h.costPending||0)))}</div>
      <div class="grid cols-3">
       ${panelCard('فواتير مبيع تاريخية',h.salesInvoices==null?'—':number(h.salesInvoices),'إيراد تاريخي مستقل عن أوردرات التشغيل')}
       ${panelCard('قيمة مبيعات تاريخية',h.salesAmount==null?'—':money(h.salesAmount),'لا يُجمع مع إيراد التشغيل تلقائيًا')}
       ${panelCard('متوسط كوست الوجبات',c.average==null?'—':Number(c.average).toFixed(1)+'%',`${number(c.outside)} وجبة خارج الحدود`)}</div>
      <div class="quick-actions"><a class="btn" href="#/daily-orders">أوردرات اليوم</a><a class="btn secondary" href="#/sale-cost-queue">استكمال تكاليف المبيعات</a><a class="btn soft" href="#/purchases">فاتورة شراء</a><a class="btn soft" href="#/cashboxes">الصناديق</a><a class="btn soft" href="#/historical-cash">ترحيل الفواتير القديمة</a></div>
      ${dashboardResult.status==='rejected'?`<div class="notice">تعذر جلب مؤشرات اليوم: ${esc(friendlyError(dashboardResult.reason))}</div>`:''}`;
    return;
  }
  if(key==='sales'){
    const [result,historic]=await Promise.all([api.statistics(month(),now()),api.v135ArchiveFinance().catch(()=>null)]);
    const k=result.kpis||{};
    host.innerHTML=`<div class="grid cols-3">${panelCard('إيرادات الشهر',money(k.total_revenue_base))}${panelCard('عدد الأوردرات',number(k.order_count))}${panelCard('متوسط الأوردر',money(k.average_ticket_base))}</div>
    <div class="grid cols-3">${panelCard('فواتير مبيع تاريخية',historic?.salesInvoices==null?'—':number(historic.salesInvoices))}${panelCard('مبيعات تاريخية محفوظة',historic?.salesAmount==null?'—':money(historic.salesAmount))}${panelCard('تكاليف تاريخية معلقة',historic?.costPending==null?'—':number(historic.costPending))}</div>
    <div class="notice">إيرادات الأوردرات التشغيلية مستقلة عن إيرادات الفواتير المستوردة تجنبًا لاحتسابها مرتين.</div>
    <div class="card"><h3>الأصناف الأكثر مبيعًا</h3><div class="table-wrap"><table class="table"><thead><tr><th>الصنف</th><th>الكمية</th><th>الإيرادات</th></tr></thead><tbody>
    ${(result.top_selling_items||[]).slice(0,15).map(r=>`<tr><td>${esc(r.name)}</td><td>${number(r.quantity_sold)}</td><td>${money(r.revenue_base)}</td></tr>`).join('')||'<tr><td colspan="3">لا تتوفر مبيعات لهذه الفترة</td></tr>'}</tbody></table></div></div><a class="btn secondary" href="#/daily-orders">تفاصيل الأوردرات</a>`;
    return;
  }
  if(key==='purchases'){
    const [items,summary]=await Promise.all([api.purchases(),api.v135HistoricCashPreview().catch(()=>null)]);
    const posted=items.filter(x=>x.status==='posted'&&!x.is_voided);
    const drafts=items.filter(x=>x.status==='draft');
    const sy=posted.filter(x=>!x.currency_code||x.currency_code==='SYP');
    const usd=posted.filter(x=>x.currency_code==='USD');
    const sum=rows=>rows.reduce((acc,x)=>acc+Number(x.total_original||0),0);
    host.innerHTML=`<div class="grid cols-4">
     ${panelCard('فواتير الشراء المسجلة',number(items.length))}
     ${panelCard('فواتير شراء منشورة',number(posted.length))}
     ${panelCard('مسودات غير منشورة',number(drafts.length))}
     ${panelCard('مشتريات منشورة بالليرة',money(sum(sy)),'العملات الأخرى مستقلة')}
    </div><div class="grid cols-3">
     ${panelCard('مشتريات منشورة بالدولار',money(sum(usd),'USD'))}
     ${panelCard('مشتريات تاريخية دون ترحيل صندوق',summary?.purchasesMissing==null?'—':number(summary.purchasesMissing))}
     ${panelCard('مبالغ تاريخية تنتظر الخصم',summary?.purchasesAmount==null?'—':money(summary.purchasesAmount))}
    </div>
    <div class="card"><h3>آخر فواتير الشراء</h3><div class="table-wrap"><table class="table"><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>القيمة</th><th>الحالة</th></tr></thead><tbody>
     ${items.slice(0,20).map(x=>`<tr><td><a href="#/purchase/${esc(x.id)}">${esc(x.invoice_number||x.id)}</a></td><td>${esc(String(x.occurred_at||'').slice(0,10))}</td><td>${money(x.total_original||0,x.currency_code||'SYP')}</td><td>${esc(x.status||'—')}</td></tr>`).join('')||'<tr><td colspan="4">لا توجد فواتير</td></tr>'}
    </tbody></table></div></div><div class="quick-actions"><a href="#/purchases" class="btn secondary">عرض جميع المشتريات</a><a href="#/historical-cash" class="btn secondary">ترحيل الخصم للصندوق العام</a></div>`;
    return;
  }
  if(key==='cost'){
    const {renderFoodCostV135}=await import('./food-cost-v135.js?v=1.0.35');
    return renderFoodCostV135(host);
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
    const [staff,balances,bonuses,leaves]=await Promise.all([api.employees(),api.approvedSalaryBalances(),api.employeeBonusesV032().catch(()=>[]),api.employeeLeaveEventsV123().catch(()=>[])]);
    const active=staff.filter(x=>x.status==='active');
    const payroll=active.reduce((acc,x)=>acc+Number(x.monthly_salary_original||0),0);
    const bonusesActive=bonuses.filter(x=>x.status!=='voided');
    host.innerHTML=`<div class="grid cols-4">${panelCard('الموظفون',number(staff.length))}${panelCard('العاملون الحاليون',number(active.length))}${panelCard('قيمة الرواتب الشهرية المعروفة',money(payroll))}${panelCard('أرصدة رواتب معتمدة غير مصروفة',number(balances.length))}</div>
    <div class="grid cols-3">${panelCard('المكافآت المسجلة',number(bonusesActive.length))}${panelCard('مجموع المكافآت بالليرة',money(bonusesActive.filter(x=>x.currency_code==='SYP').reduce((a,x)=>a+Number(x.amount_original||0),0)))}${panelCard('إجازات وغياب مسجل',number(leaves.length))}</div>
    <div class="quick-actions"><a class="btn secondary" href="#/employees-list">ملفات الموظفين</a><a class="btn secondary" href="#/payroll">مسيرات الرواتب</a><a class="btn secondary" href="#/advances">السلف</a><a class="btn secondary" href="#/bonuses">المكافآت</a><a class="btn secondary" href="#/attendance">الدوام والإجازات</a></div>`;
    return;
  }
  if(key==='events'){
    const events=await api.events();
    const coming=events.filter(x=>String(x.event_date||'')>=now()&&!['completed','cancelled'].includes(x.status));
    const done=events.filter(x=>x.status==='completed'),cancelled=events.filter(x=>x.status==='cancelled');
    host.innerHTML=`<div class="grid cols-4">${panelCard('جميع الحفلات',number(events.length))}${panelCard('حفلات قادمة',number(coming.length))}${panelCard('حفلات مكتملة',number(done.length))}${panelCard('حفلات ملغاة',number(cancelled.length))}</div>
    <div class="card"><h3>الحفلات القادمة</h3>${coming.slice(0,20).map(x=>pair(x.name||'حفلة',esc(x.event_date||'—'))).join('')||'<p>لا توجد حفلات قادمة مسجلة.</p>'}</div><a class="btn secondary" href="#/events-list">إدارة الحفلات</a>`;
    return;
  }
  if(key==='alerts'){
    const [notifications,queue,cost,history]=await Promise.all([api.notifications(),api.v131SaleQueueSummary(),api.v135FoodCostOverview().catch(()=>null),api.v135ArchiveFinance().catch(()=>null)]);
    host.innerHTML=`<div class="grid cols-2">${panelCard('مبيعات تنتظر استكمال التكلفة',number(Number(queue.pending||0)+Number(history?.costPending||0)))}${panelCard('إشعارات غير مقروءة',number(notifications.filter(n=>!n.read_at&&!n.is_read).length))}</div>
    <div class="grid cols-2">${panelCard('وجبات خارج حدود الكوست',cost?.outside==null?'—':number(cost.outside))}${panelCard('إشعارات كوست غير مقروءة',cost?.unreadAlerts==null?'—':number(cost.unreadAlerts))}</div>
    <div class="card"><h3>التنبيهات المسجلة</h3>${notifications.slice(0,30).map(n=>pair(n.title||'إشعار',esc(n.message||''))).join('')||'<p>لا توجد إشعارات.</p>'}</div><a class="btn secondary" href="#/sale-cost-queue">مراجعة تسويات المبيعات</a><a class="btn secondary" href="#/food-cost">عرض إشعارات الكوست</a>`;
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
