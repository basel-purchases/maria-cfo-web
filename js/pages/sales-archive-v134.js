import * as api from '../api.js?v=1.0.34';
import {esc} from '../utils.js?v=1.0';
import {loader,friendlyError} from '../ui.js?v=1.0.33';
const fmt=x=>Number(x||0).toLocaleString('ar-SY-u-nu-latn',{maximumFractionDigits:2});
const date=x=>String(x||'').replace('T',' ').slice(0,16);
export async function renderSalesArchiveV134(root){
 let offset=0;
 root.innerHTML=`<div class="page-head"><div><h2>سجل المبيعات التاريخية</h2><p>أرشيف فواتير المبيع السابقة منذ بداية التشغيل. تُسجل حركة قبض تاريخية مرة واحدة لكل فاتورة، وتُتابع تكاليف المكونات غير المكتملة في صفحة التسوية دون صرف مخزون إضافي.</p></div><div class="quick-actions"><a class="btn secondary" href="#/settings/first-setup/salesArchive">استيراد المبيعات</a><a class="btn secondary" href="#/sale-cost-queue/archive">التكاليف المؤجلة</a><a class="btn secondary" href="#/historical-cash">ترحيل الصناديق القديمة</a></div></div><div id="v134-sales-area">${loader()}</div>`;
 const host=root.querySelector('#v134-sales-area');
 async function load(){host.innerHTML=loader();try{
  const data=await api.rpc('v134_sales_archive_list',{p_limit:50,p_offset:offset});
  if(!root.isConnected)return;
  const total=Number(data?.totalInvoices||0),lines=Number(data?.totalLines||0),linked=Number(data?.linkedLines||0);
  const invoices=data?.invoices||[];
  host.innerHTML=`<div class="grid cols-3"><div class="card"><strong>${fmt(total)}</strong><small>فاتورة مبيع تاريخية</small></div><div class="card"><strong>${fmt(lines)}</strong><small>بند محفوظ بالأرشيف</small></div><div class="card"><strong>${fmt(linked)}</strong><small>بند مربوط بالمنيو</small></div></div>
  <div class="notice">المبالغ أدناه محفوظة كما وردت من تقرير المبيعات التاريخي بالليرة السورية، وتُربط بقبض تاريخي في الصندوق الأول بعد تطبيق الترحيل، دون تكرار الدفع إذا أُعيد رفع الملف. الأصناف غير المطابقة تبقى بأسمائها الأصلية للمراجعة.</div>
  <div class="table-wrap"><table class="table"><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>قيمة المبيع (ل.س)</th><th>البنود</th><th>مرتبط بالمنيو</th><th>التفاصيل</th></tr></thead><tbody>
  ${invoices.map(v=>`<tr><td>${esc(v.number)}</td><td>${esc(date(v.date))}</td><td>${fmt(v.amount)}</td><td>${fmt(v.lines)}</td><td>${fmt(v.linked)}</td><td><button class="mini-btn" data-invoice="${esc(v.id)}">عرض</button></td></tr>`).join('')||'<tr><td colspan="6">لا توجد فواتير مستوردة</td></tr>'}</tbody></table></div>
  <div class="quick-actions"><button class="btn secondary" id="v134-prev" ${offset===0?'disabled':''}>السابق</button><span class="metric-note">${total?fmt(offset+1)+'–'+fmt(Math.min(total,offset+50)):'0'} من ${fmt(total)}</span><button class="btn secondary" id="v134-next" ${offset+50>=total?'disabled':''}>التالي</button></div><div id="v134-document-details"></div>`;
  host.querySelector('#v134-prev').onclick=()=>{offset=Math.max(0,offset-50);load();};
  host.querySelector('#v134-next').onclick=()=>{offset+=50;load();};
  host.querySelectorAll('[data-invoice]').forEach(b=>{b.onclick=async()=>{
   const detail=host.querySelector('#v134-document-details');detail.innerHTML=loader();
   try{const rec=await api.rpc('v134_sales_archive_invoice',{p_id:b.dataset.invoice});
    detail.innerHTML=`<div class="card"><h3>${esc(rec.number)} · ${esc(date(rec.date))}</h3><div class="table-wrap"><table class="table"><thead><tr><th>اسم الصنف كما ورد</th><th>الكمية الأصلية</th><th>صافي السطر (ل.س)</th><th>الوجبة المطابقة</th></tr></thead><tbody>${(rec.lines||[]).map(l=>`<tr><td>${esc(l.name)}</td><td>${fmt(l.quantity)}</td><td>${fmt(l.net)}</td><td>${l.matched?esc(l.menu):'بانتظار مطابقة'}</td></tr>`).join('')}</tbody></table></div></div>`;
   }catch(e){detail.innerHTML=`<div class="notice rose">${esc(friendlyError(e))}</div>`;}
  };});
 }catch(e){host.innerHTML=`<div class="notice rose">${esc(friendlyError(e))}</div>`;}}
 await load();
}
