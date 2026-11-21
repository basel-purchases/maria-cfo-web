// v1.0.35 — A single navigation/entry surface for daily intake.
import {renderAmeenDailyV041} from './ameen-daily-v041.js?v=1.0.35';
import {renderBaselineImportsV126} from './baseline-imports-v126.js?v=1.0.35';
import {renderPurchases} from './purchases.js?v=1.0.35';
import {esc} from '../utils.js?v=1.0';
import {loader} from '../ui.js?v=1.0';
export function renderDailyInputsV135(root){
 const sections=[['orders','إدخال الأوردرات'],['count','إدخال الجرد'],['purchases','إدخال فواتير الشراء']];
 root.innerHTML=`<div class="page-head"><div><h2>الإدخالات اليومية</h2><p>الأوردرات والجرد وفواتير الشراء في صفحة واحدة. البيانات تبقى في جداولها المعتادة دون إنشاء سجل مكرر.</p></div><a class="btn secondary" href="#/historical-cash">ترحيل الفواتير القديمة للصناديق</a></div>
 <div class="v132-analytics-tabs" role="tablist">${sections.map(([id,title],i)=>`<button type="button" class="v132-analytics-tab ${i===0?'active':''}" data-daily-input-tab="${id}">${esc(title)}</button>`).join('')}</div>
 <div id="v135-daily-input-host"></div>`;
 const host=root.querySelector('#v135-daily-input-host');let active=null;
 const choose=async key=>{
  if(key===active)return;active=key;
  root.querySelectorAll('[data-daily-input-tab]').forEach(b=>b.classList.toggle('active',b.dataset.dailyInputTab===key));
  host.innerHTML=loader();
  if(key==='orders')return renderAmeenDailyV041(host);
  if(key==='count')return renderBaselineImportsV126(host,{fixedKind:'count'});
  if(key==='purchases')return renderPurchases(host);
 };
 root.querySelectorAll('[data-daily-input-tab]').forEach(b=>b.onclick=()=>void choose(b.dataset.dailyInputTab));
 void choose('orders');
}
