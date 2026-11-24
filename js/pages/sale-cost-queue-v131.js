// Maria CFO v1.0.31: auditable cost/stock completion of sales without a new receipt.
import * as api from '../api.js?v=1.0.31';
import {esc,money} from '../utils.js?v=1.0';
import {toast,friendlyError,loader,confirmBox} from '../ui.js?v=1.0.30';

function saleState(row){
 if(row.state==='issued')return {label:'مكتمل — صُرفت المواد',color:'green'};
 if(row.state==='included_in_count')return {label:'مكتمل — مشمول في الجرد',color:'green'};
 if(row.state==='review')return {label:'يحتاج مراجعة: صرف جزئي سابق',color:'yellow'};
 if(!row.menuName||!row.recipeCount)return {label:'بانتظار مكونات الوصفة',color:'yellow'};
 return {label:row.error?'تعذّر الصرف — راجع السبب':'جاهز لمحاولة التسوية',color:'yellow'};
}
const count=n=>Number(n||0).toLocaleString('ar-SY-u-nu-latn');
export async function renderSaleCostQueueV131(root){
 root.innerHTML=loader();
 try{
  const seeded=await api.v131SeedSalesQueue();
  const pageSize=200;let offset=0,showAll=true;
  let [rows,totals]=await Promise.all([api.v131SaleQueue(pageSize,offset,false),api.v131SaleQueueSummary()]);
  const draw=()=>{
   const completed=Number(totals.completed||0);
   const waiting=Number(totals.pending||0);
   const ready=Number(totals.ready||0);
   const displayed=rows;
   root.innerHTML=`<div class="page-head"><div><h2>تسوية تكاليف المبيعات</h2><p>المبيعات تبقى محفوظة حتى عند غياب الوصفة. يمكنك استكمال مكوناتها وصرف مخزونها لاحقًا دون إعادة تسجيل الإيراد أو القبض.</p></div></div>
    <div class="grid cols-3"><div class="card"><small>مبيعات بانتظار التسوية</small><h3>${count(waiting)}</h3></div>
    <div class="card"><small>لها مكونات مضافة</small><h3>${count(ready)}</h3></div>
    <div class="card"><small>تمت تسويتها</small><h3>${count(completed)}</h3></div></div>
    <div class="card"><button class="btn" type="button" id="v131-complete-ready" ${ready===0?'disabled':''}>صرف المكونات الجاهزة</button>
    <button class="btn secondary" id="v131-refresh">تحديث</button>
    <label style="display:inline-flex;align-items:center;gap:6px;margin-inline-start:12px"><input id="v131-only-waiting" type="checkbox" ${showAll?'':'checked'}> عرض المعلّقة فقط</label>
    <p class="metric-note">الأوردر الذي يسبق آخر جرد معتمد أو يقع في يومه لا يُخصم من المخزون مجددًا. السطر الأخضر يعني أن تكلفة البيع تمت تسويتها أو أنه مشمول في الجرد.</p></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>التاريخ</th><th>رقم الأوردر</th><th>الوجبة</th><th>العدد</th><th>التكلفة</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>
    ${displayed.map(r=>{const state=saleState(r);return `<tr class="v131-queue-${state.color}" style="${state.color==='green'?'background:#e8f7eb;':''}"><td>${esc(r.saleDate||'')}</td><td>${esc(r.orderNo||'—')}</td><td><strong>${esc(r.menuName||r.sourceName)}</strong>${r.sourceName!==r.menuName?`<small class="metric-note">في الكاشير: ${esc(r.sourceName)}</small>`:''}</td><td>${count(r.quantity)}</td><td>${r.cost==null?'—':money(r.cost,'SYP')}</td><td><span class="badge ${state.color}">${esc(state.label)}</span>${r.error?`<div class="metric-note" title="${esc(r.error)}">${esc(r.error)}</div>`:''}</td><td>${r.state==='pending'&&r.recipeCount>0?`<button class="mini-btn v131-complete-one" type="button" data-id="${esc(r.id)}">تسوية البيع</button>`:`<a href="#/menu" class="mini-btn">المنيو والوصفات</a>`}</td></tr>`;}).join('')}
    </tbody></table></div>
    <div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center">
      <button type="button" class="btn secondary" id="v131-prev" ${offset===0?'disabled':''}>السابق</button>
      <span>صفحة ${Math.floor(offset/pageSize)+1} · إجمالي ${count(showAll?totals.total:(waiting+Number(totals.review||0)))} بند</span>
      <button type="button" class="btn secondary" id="v131-next" ${rows.length<pageSize?'disabled':''}>التالي</button>
    </div>`;
   root.querySelector('#v131-only-waiting').onchange=async e=>{showAll=!e.target.checked;offset=0;await refresh();};
   root.querySelector('#v131-prev').onclick=async()=>{offset=Math.max(0,offset-pageSize);await refresh();};
   root.querySelector('#v131-next').onclick=async()=>{offset+=pageSize;await refresh();};
   root.querySelector('#v131-refresh').onclick=refresh;
   root.querySelector('#v131-complete-ready').onclick=async()=>{
    if(!(await confirmBox(`سيتم استكمال صرف المكونات للوجبات التي لها وصفات، دون أي تحصيل نقدي جديد. العمليات التي لا تتوفر تكلفتها أو كميتها ستبقى معلّقة. متابعة؟`,'تأكيد التسوية')))return;
    const b=root.querySelector('#v131-complete-ready');b.disabled=true;
    try{const r=await api.v131CompleteReadySales(150);toast(`تسويات مخزون: ${r.issued||0} · شملها الجرد: ${r.countCovered||0} · ما زال معلّقًا: ${r.stillWaiting||0}`,'success');await refresh();}
    catch(e){toast(friendlyError(e),'error');b.disabled=false;}
   };
   root.querySelectorAll('.v131-complete-one').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{const result=await api.v131CompleteReadySales(1,b.dataset.id);if(result.issued||result.countCovered)toast('تمت تسوية البيع','success');else toast('لا يزال البيع بحاجة إلى إكمال الوصفة أو التكلفة أو الرصيد.','error');await refresh();}
    catch(e){toast(friendlyError(e),'error');b.disabled=false;}
   });
  };
  const refresh=async()=>{[rows,totals]=await Promise.all([api.v131SaleQueue(pageSize,offset,!showAll),api.v131SaleQueueSummary()]);draw();document.dispatchEvent(new CustomEvent('maria:cost-queue-changed'));};
  draw();
 }catch(e){root.innerHTML=`<div class="notice rose">${esc(friendlyError(e,'تعذر فتح سجل التسويات؛ تأكد من تطبيق SQL v1.0.31.'))}</div>`;}
}
