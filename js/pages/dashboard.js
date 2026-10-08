import * as api from '../api.js';
import { loader, friendlyError } from '../ui.js';
import { money, pick, esc, dateOnly } from '../utils.js';
export async function renderDashboard(root){root.innerHTML=loader();try{const [d,notes,mats,menu,emps,boxes,evts]=await Promise.all([api.dashboard().catch(()=>({})),api.notifications().catch(()=>[]),api.materials().catch(()=>[]),api.menuItems().catch(()=>[]),api.employees().catch(()=>[]),api.cashboxes().catch(()=>[]),api.events().catch(()=>[])]);const sales=pick(d,['sales_today_base','today_sales_base','revenue_today_base','revenue_base','sales_base'],0);const result=pick(d,['net_result_today_base','today_net_result_base','net_result_base','net_base','result_base'],0);const exp=pick(d,['expenses_today_base','today_expenses_base','expenses_base'],0);const orders=pick(d,['orders_today','today_order_count','order_count','orders_count'],0);const unread=notes.filter(n=>!n.read_at&&!n.is_read&&n.status!=='read').length;const upcoming=evts.filter(e=>new Date(e.event_date)>=new Date(new Date().toDateString())).sort((a,b)=>String(a.event_date).localeCompare(String(b.event_date)))[0];root.innerHTML=`
<div class="page-head"><div><h2>صباح العمل</h2><p>هذه الصفحة تعرض ما تحتاج معرفته بسرعة فقط. التفاصيل في أقسامها، ولن نضع Food Cost العام هنا.</p></div></div>
<div class="quick-actions"><a class="btn" href="#/purchases">فاتورة شراء</a><a class="btn secondary" href="#/expenses">مصروف</a><a class="btn secondary" href="#/orders">أوردر</a><a class="btn soft" href="#/assistant">اسأل المساعد</a></div>
<div class="grid cols-4">
<div class="card"><div class="metric-label">مبيعات اليوم</div><div class="metric-value">${money(sales)}</div><div class="metric-note">من العمليات المنشورة</div></div>
<div class="card"><div class="metric-label">النتيجة اليوم</div><div class="metric-value">${money(result)}</div><div class="metric-note">قد تكون مؤقتة إذا كانت هناك تكاليف ناقصة</div></div>
<div class="card"><div class="metric-label">مصروفات اليوم</div><div class="metric-value">${money(exp)}</div><div class="metric-note">المصروفات التشغيلية</div></div>
<div class="card"><div class="metric-label">أوردرات اليوم</div><div class="metric-value">${esc(orders)}</div><div class="metric-note">عدد العمليات</div></div>
</div>
<div style="height:16px"></div>
<div class="grid cols-2">
<div class="card"><h3>ابدأ من هنا</h3><p style="margin-bottom:10px">يظهر هذا الدليل حتى يكون تسلسل الاستخدام واضحًا.</p><div class="setup-list">
${step('المواد','تعريف المواد والكميات والأسعار',mats.length>0,'#/materials')}
${step('الوجبات والوصفات','تعريف الأصناف ومكوناتها',menu.length>0,'#/menu')}
${step('الصناديق','التعريفات الافتراضية جاهزة',boxes.length>=3,'#/cashboxes')}
${step('الموظفون','اختياري للدوام والرواتب',emps.length>0,'#/employees-list',true)}
</div><div class="notice rose" style="margin-top:14px">المورد اختياري. تستطيع تسجيل فاتورة شراء بدون إنشاء مورد مسبقًا.</div></div>
<div class="card"><h3>ما يحتاج انتباهك</h3>${unread?`<div class="metric-value">${unread}</div><p>إشعار غير مقروء. <a href="#/reports" style="color:var(--plum);font-weight:700">راجع التقارير والتنبيهات</a></p>`:'<div class="notice green">لا توجد تنبيهات غير مقروءة الآن.</div>'}${upcoming?`<div style="margin-top:14px"><div class="metric-label">الحفلة القادمة</div><strong>${esc(upcoming.name||upcoming.title||'حفلة')}</strong><div class="metric-note">${dateOnly(upcoming.event_date)}</div></div>`:''}</div>
</div>`;}catch(e){root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;}}
function step(title,desc,ready,href,optional=false){return `<a class="setup-row ${ready?'ready':''}" href="${href}"><div class="setup-status">${ready?'✓':'!'}</div><div><strong>${title}${optional?' — اختياري':''}</strong><small>${desc}</small></div></a>`;}
