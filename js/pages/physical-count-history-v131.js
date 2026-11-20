// Maria CFO v1.0.31: count session history and per-material adjustment detail.
import * as api from '../api.js?v=1.0.31';
import {esc} from '../utils.js?v=1.0';
import {loader,friendlyError} from '../ui.js?v=1.0.30';
const n=v=>Number(v??0).toLocaleString('ar-SY',{maximumFractionDigits:6});
export async function renderPhysicalCountHistoryV131(root){
 root.innerHTML=loader();
 try{
  const sessions=await api.v131CountHistory();
  root.innerHTML=`<div class="page-head"><div><h2>سجل الجرد المعتمد</h2><p>كل تاريخ جرد وحركة تصحيح محفوظان للمراجعة، وإعادة رفع ملف لن تكرر احتساب كمية المادة في تاريخها.</p></div></div>
   <div class="card"><a class="btn secondary" href="#/baseline-imports">استيراد جرد</a></div>
   <div class="table-wrap"><table class="table"><thead><tr><th>تاريخ الجرد</th><th>الملف</th><th>التاريخ الفعلي للرفع</th><th>مواد مسجلة</th><th>موجودة سابقًا</th><th>تفاصيل</th></tr></thead><tbody>
   ${sessions.map(x=>`<tr><td><strong>${esc(x.date)}</strong></td><td>${esc(x.file)}</td><td>${esc(x.submittedAt?new Date(x.submittedAt).toLocaleString('ar-SY'):'')}</td><td>${n(x.posted)}</td><td>${n(x.duplicates)}</td><td><button class="mini-btn v131-count-detail" data-id="${esc(x.id)}">فتح</button></td></tr>`).join('')}</tbody></table></div>
   <div id="v131-count-detail-slot"></div>`;
  root.querySelectorAll('.v131-count-detail').forEach(b=>b.onclick=async()=>{
   const host=root.querySelector('#v131-count-detail-slot');host.innerHTML=loader();
   try{const lines=await api.v131CountDetails(b.dataset.id);
    host.innerHTML=`<div class="card"><h3>تفاصيل الجرد</h3><div class="table-wrap"><table class="table"><thead><tr><th>المادة</th><th>القسم</th><th>الكمية</th><th>الوحدة</th><th>فرق الجرد</th><th>نتيجة الرفع</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${esc(l.name)}</td><td>${esc(l.category||'—')}</td><td>${n(l.quantity)}</td><td>${esc(l.unit)}</td><td>${n(l.difference)}</td><td>${l.state==='recorded'?'مسجّل':'موجود سابقًا'}</td></tr>`).join('')}</tbody></table></div></div>`;
   }catch(e){host.innerHTML=`<div class="notice rose">${esc(friendlyError(e))}</div>`;}
  });
 }catch(e){root.innerHTML=`<div class="notice rose">${esc(friendlyError(e,'تعذّر فتح سجل الجرد؛ طبّق SQL v1.0.31 أولًا.'))}</div>`;}
}
