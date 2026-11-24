// v1.0.35 — Historical Al-Ameen sales in the cost-settlement section.
// Costing is a historical analytical snapshot; it never posts a second stock issue.
import * as api from '../api.js?v=1.0.35';
import {esc,money} from '../utils.js?v=1.0';
import {loader,friendlyError,toast} from '../ui.js?v=1.0.31';
import {renderSaleCostQueueV132} from './sale-cost-queue-v132.js?v=1.0.34.1';
const fmt=x=>Number(x||0).toLocaleString('ar-SY-u-nu-latn',{maximumFractionDigits:2});
const menuLink=name=>`#/menu/find/${encodeURIComponent(String(name||''))}`;

export function renderUnifiedCostQueueV135(root,{pendingOnly=false,archiveOnly=false}={}){
 root.innerHTML=`<div class="page-head"><div><h2>تسوية تكاليف المبيعات</h2><p>المبيعات التشغيلية والمبيعات التاريخية في مكان واحد، مع منع إعادة قبض الصناديق أو صرف المخزون.</p></div></div>
 <div class="v132-analytics-tabs" role="tablist">
 <button class="v132-analytics-tab ${archiveOnly?'':'active'}" data-v135-cost-tab="daily">مبيعات التشغيل</button>
 <button class="v132-analytics-tab ${archiveOnly?'active':''}" data-v135-cost-tab="archive">المبيعات التاريخية المؤجلة</button></div>
 <section id="v135-queue-area"></section>`;
 const pane=root.querySelector('#v135-queue-area');
 const choose=(kind)=>{
  root.querySelectorAll('[data-v135-cost-tab]').forEach(b=>b.classList.toggle('active',b.dataset.v135CostTab===kind));
  if(kind==='archive')return renderHistoricalCostQueueV135(pane,{pendingOnly});
  return renderSaleCostQueueV132(pane,{pendingOnly});
 };
 root.querySelectorAll('[data-v135-cost-tab]').forEach(b=>b.onclick=()=>void choose(b.dataset.v135CostTab));
 void choose(archiveOnly?'archive':'daily');
}

export async function renderHistoricalCostQueueV135(root,{pendingOnly=false}={}){
 let offset=0,onlyPending=pendingOnly,search='',working=false;const pageSize=100;
 root.innerHTML=`<div id="v135-archive-queue">${loader()}</div>`;
 const host=root.querySelector('#v135-archive-queue');
 const load=async()=>{
  host.innerHTML=loader();
  try{
   const result=await api.v135ArchiveCostReport(pageSize,offset,onlyPending,search);
   if(!root.isConnected)return;
   const rows=result.rows||[],total=Number(result.total||0);
   host.innerHTML=`<div class="grid cols-4">
     <div class="card"><small>بانتظار المكونات أو السعر</small><h3>${fmt(result.pending)}</h3></div>
     <div class="card"><small>تكلفة تقديرية</small><h3>${fmt(result.estimated)}</h3></div>
     <div class="card"><small>تكلفة بتاريخ البيع</small><h3>${fmt(result.settled)}</h3></div>
     <div class="card"><small>بنود البيع التاريخي</small><h3>${fmt(total)}</h3></div></div>
     <div class="notice">فواتير المبيع التاريخية مسجلة ببياناتها الأصلية. حساب التكلفة هنا لا يخصم المخزون مرة ثانية. «تقديرية» تعني الاعتماد على سعر المواد الحالي عندما لا تتوفر تكلفة تاريخية مؤكدة.</div>
     <div class="card"><div class="list-toolbar"><button class="btn" id="v135-reconcile">مزامنة التكلفة مع آخر تحديث للمنيو</button>
       <label><input type="checkbox" id="v135-pending-only" ${onlyPending?'checked':''}> غير المكتملة فقط</label>
       <input type="search" id="v135-archive-search" placeholder="ابحث باسم الوجبة" value="${esc(search)}">
       <button class="btn secondary" id="v135-archive-search-go">بحث</button></div></div>
     <div class="table-wrap"><table class="table"><thead><tr><th>الصنف</th><th>الكمية</th><th>الفاتورة</th><th>التاريخ</th><th>التكلفة</th><th>الحالة</th><th>المنيو</th></tr></thead><tbody>
     ${rows.map(x=>`<tr class="${x.state==='pending'?'v132-queue-yellow':''}"><td><strong>${esc(x.name)}</strong>${x.sourceName!==x.name?`<small>${esc(x.sourceName)}</small>`:''}</td>
      <td>${fmt(x.qty)}</td><td>${esc(x.invoice)}</td><td>${esc(String(x.date).slice(0,10))}</td>
      <td>${x.cost==null?'—':money(x.cost)}</td>
      <td>${x.state==='settled'?'<span class="badge green">تكلفة بتاريخ البيع</span>':x.state==='estimated'?'<span class="badge yellow">تقديرية</span>':`<span class="badge yellow">${x.basis==='menu_unmatched'?'بانتظار مطابقة الاسم':x.basis==='recipe_missing'?'بانتظار المكونات':'بانتظار تكلفة المواد'}</span>`}</td>
      <td><a class="mini-btn" href="${esc(menuLink(x.name))}">فتح الوجبة</a></td></tr>`).join('')||'<tr><td colspan="7">لا توجد بنود هنا</td></tr>'}
     </tbody></table></div>
     <div class="quick-actions"><button class="btn secondary" id="v135-archive-prev" ${offset===0?'disabled':''}>السابق</button>
       <span>${fmt(offset+1)}–${fmt(offset+rows.length)}</span>
       <button class="btn secondary" id="v135-archive-next" ${rows.length<pageSize?'disabled':''}>التالي</button></div>`;
   host.querySelector('#v135-pending-only').onchange=e=>{onlyPending=e.target.checked;offset=0;void load();};
   host.querySelector('#v135-archive-prev').onclick=()=>{offset=Math.max(0,offset-pageSize);void load();};
   host.querySelector('#v135-archive-next').onclick=()=>{offset+=pageSize;void load();};
   host.querySelector('#v135-archive-search-go').onclick=()=>{search=host.querySelector('#v135-archive-search').value.trim();offset=0;void load();};
   host.querySelector('#v135-archive-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();host.querySelector('#v135-archive-search-go').click();}};
   host.querySelector('#v135-reconcile').onclick=async b=>{
     if(working)return;working=true;b.currentTarget.disabled=true;
     try{let processed=0;
       // Process stable pages so missing recipes early in history never hide later ready lines.
       for(let page=0;page<100;page++){
        const data=await api.v135ReconcileArchiveCosts(500,page*500);
        processed+=Number(data.processed||0);
        if(Number(data.processed||0)<500)break;
       }
       toast(`تم فحص ${fmt(processed)} سطر بيع محفوظ، دون خصم مخزون أو قبض نقدي.`, 'success');
       document.dispatchEvent(new CustomEvent('maria:cost-queue-changed'));
       await load();
     }catch(e){toast(friendlyError(e,'فشلت مراجعة التكلفة التاريخية.'),'error');b.currentTarget.disabled=false;}
     finally{working=false;}
   };
  }catch(e){host.innerHTML=`<div class="notice rose">${esc(friendlyError(e,'تعذر عرض المبيعات المؤجلة؛ ثبّت SQL v1.0.35.'))}</div>`;}
 };
 await load();
 // Recipe changes immediately restart the pending historical review. No stock or cash is posted.
 const refresh=()=>{if(!root.isConnected){document.removeEventListener('maria:recipe-saved',refresh);return;}
   host.querySelector('#v135-reconcile')?.click();};
 document.addEventListener('maria:recipe-saved',refresh);
}
