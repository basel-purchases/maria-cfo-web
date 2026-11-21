// v1.0.35 — explicitly reconcile OLD imported documents once; imports made after
// migration are posted automatically. Never guess allocation between cashiers.
import * as api from '../api.js?v=1.0.35';
import {esc,money} from '../utils.js?v=1.0';
import {loader,toast,friendlyError,confirmBox} from '../ui.js?v=1.0.31';
const count=x=>Number(x||0).toLocaleString('ar-SY');
export async function renderHistoricalCashV135(root){
 root.innerHTML=`<div class="page-head"><div><h2>ترحيل المبيعات والمشتريات التاريخية إلى الصناديق</h2>
 <p>العمليات التي جرى استيرادها قبل الإصلاح لم تُرحّل تلقائيًا. راجع المعاينة ثم اعتمد الترحيل مرة واحدة فقط.</p></div>
 <a class="btn secondary" href="#/cashboxes">فتح الصناديق</a></div><div id="v135-cash-reconcile">${loader()}</div>`;
 const host=root.querySelector('#v135-cash-reconcile');let busy=false;
 const load=async()=>{
  host.innerHTML=loader();
  try{
   const p=await api.v135HistoricCashPreview();if(!root.isConnected)return;
   const toProcess=Number(p.salesMissing||0)+Number(p.purchasesMissing||0);
   host.innerHTML=`<div class="grid cols-4">
    <div class="card"><small>مبيعات تحتاج ترحيل قبض</small><h3>${count(p.salesMissing)}</h3><strong>${money(p.salesAmount||0)}</strong></div>
    <div class="card"><small>مشتريات تحتاج ترحيل دفع</small><h3>${count(p.purchasesMissing)}</h3><strong>${money(p.purchasesAmount||0)}</strong></div>
    <div class="card"><small>مبيعات رُحّلت</small><h3>${count(p.salesPosted)}</h3></div>
    <div class="card"><small>مشتريات رُحّلت</small><h3>${count(p.purchasesPosted)}</h3></div></div>
    <div class="notice">المبيعات بدون اسم الصندوق تُقبض في الصندوق التشغيلي الأول. المشتريات تُصرف من الصندوق العام. لا تتغير فواتير الشراء أو أرصدة المخزون.</div>
    <div class="notice rose"><strong>تحقق قبل الاعتماد:</strong> إذا سبق تسجيل أي مبالغ من هذه الفواتير يدويًا في الصناديق، فلا تعتمد ترحيلها مرة ثانية قبل مطابقتها. كشف المصدر لا يذكر صندوق البيع ولا إثبات الدفع الفعلي.</div>
    <div class="card"><label><input type="checkbox" id="v135-cash-confirm" ${toProcess?'':'disabled'}> تحققت أن هذه الفواتير غير مسجلة كحركات نقدية سابقة وأوافق على ترحيلها</label>
      <div class="quick-actions"><button class="btn" id="v135-post-cash" disabled>ترحيل الحركات غير المسجلة مرة واحدة</button>
       <button class="btn secondary" id="v135-cash-refresh">تحديث المعاينة</button></div>
       <div id="v135-cash-progress" role="status"></div></div>`;
   const confirm=host.querySelector('#v135-cash-confirm');const action=host.querySelector('#v135-post-cash');
   confirm.onchange=()=>{action.disabled=!confirm.checked||!toProcess;};
   host.querySelector('#v135-cash-refresh').onclick=()=>void load();
   action.onclick=async()=>{
    if(busy||!confirm.checked)return;
    if(!await confirmBox(`سيُرحّل ${count(p.salesMissing)} قبض مبيعات و${count(p.purchasesMissing)} دفع مشتريات إلى الصناديق. تأكد أنها لم تُسجل يدويًا. متابعة؟`,'اعتماد الترحيل المالي'))return;
    busy=true;action.disabled=true;const status=host.querySelector('#v135-cash-progress');
    try{
     let posted=0,skipped=0;
     // Bounded batches; when no suitable cashbox is present the SQL skips those
     // entries, so do not retry in a loop that cannot make progress.
     for(let i=0;i<200;i++){
      const data=await api.v135BackfillHistoricCash(100);
      posted+=Number(data.posted||0);skipped+=Number(data.deferredWithoutCashbox||0);
      status.textContent=`تم ترحيل ${count(posted)} عملية. ${skipped?`${count(skipped)} دون صندوق متاح.`:''}`;
      if(Number(data.posted||0)<100)break;
     }
     document.dispatchEvent(new CustomEvent('maria:cash-records-changed'));
     document.dispatchEvent(new CustomEvent('maria:cashboxes-updated'));
     toast(`تم ترحيل ${count(posted)} عملية مالية دون تكرار السجل.`, 'success');
     await load();
    }catch(e){status.textContent=esc(friendlyError(e,'تعذر ترحيل بعض الحركات. السجلات التي تم ترحيلها لن تتكرر.'));
     toast(friendlyError(e),'error');action.disabled=false;}
    finally{busy=false;}
   };
  }catch(e){host.innerHTML=`<div class="notice rose">${esc(friendlyError(e,'تعذر عرض الترحيل؛ شغّل SQL v1.0.35 أولًا.'))}</div>`;}
 };
 await load();
}
