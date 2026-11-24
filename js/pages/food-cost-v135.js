// v1.0.35 — Food Cost monitoring. All ratios are calculated from DB costs,
// and unknown costs are never represented as zero.
import * as api from '../api.js?v=1.0.35';
import {esc,money} from '../utils.js?v=1.0';
import {loader,toast,friendlyError,confirmBox} from '../ui.js?v=1.0.31';

const n=x=>Number(x||0).toLocaleString('ar-SY-u-nu-latn',{maximumFractionDigits:2});
export const foodCostColorV135=(row,low,high)=>row.percent==null?'missing':
  Number(row.percent)<low?'low':Number(row.percent)>high?'high':'ok';
export const foodCostMenuLinkV135=name=>`#/menu/find/${encodeURIComponent(String(name||''))}`;

export async function renderFoodCostV135(root){
 root.innerHTML=loader();
 try{
  const overview=await api.v135FoodCostOverview();
  const alerts=await api.v135FoodCostAlerts(25);
  if(!root.isConnected)return;
  const settings={min:Number(overview.min??25),max:Number(overview.max??40)};
  let sort='desc',filter='all',query='';
  const arr=overview.items||[];
  root.innerHTML=`<div class="page-head"><div><h2>كوست الوجبات</h2><p>نسبة تكلفة المكونات إلى سعر البيع الصافي. المتوسط محسوب للوجبات ذات التكلفة المعروفة فقط.</p></div><a href="#/settings/cost" class="btn secondary">إعداد حدود الكوست</a></div>
  <div class="grid cols-4">
    <div class="card"><small>متوسط الكوست</small><h3>${overview.average==null?'—':n(overview.average)+'%'}</h3></div>
    <div class="card"><small>الحد المسموح</small><h3>${n(settings.min)}% — ${n(settings.max)}%</h3></div>
    <div class="card"><small>وجبات خارج الحد</small><h3>${n(overview.outside)}</h3></div>
    <div class="card"><small>وجبات لم تكتمل تكلفتها</small><h3>${n(overview.unknown)}</h3></div>
  </div>
  <div class="card"><div class="list-toolbar">
    <div class="search-box"><span>⌕</span><input id="v135-cost-search" type="search" placeholder="بحث باسم الوجبة"></div>
    <select id="v135-cost-filter"><option value="all">كل الوجبات</option><option value="outside">خارج الحد</option><option value="missing">تكلفة غير مكتملة</option><option value="within">ضمن الحد</option></select>
    <select id="v135-cost-sort"><option value="desc">الكوست: الأعلى أولًا</option><option value="asc">الكوست: الأقل أولًا</option><option value="price">السعر: الأعلى أولًا</option><option value="name">حسب اسم الوجبة</option></select>
    <span class="list-count" id="v135-cost-count"></span>
  </div><div class="table-wrap"><table class="table"><thead><tr><th>الوجبة</th><th>تكلفة الحصة</th><th>سعر البيع الصافي</th><th>Food Cost</th><th>الحالة</th></tr></thead>
  <tbody id="v135-cost-rows"></tbody></table></div></div>
  <div class="card"><div class="section-head-inline"><h3>إشعارات تجاوز الحدود</h3><button class="mini-btn" id="v135-cost-read-alerts" ${alerts.length?'':'disabled'}>تعليم الإشعارات كمقروءة</button></div>
   <div id="v135-cost-alerts">${alerts.length?alerts.slice(0,25).map(a=>`<div class="finance-info-row"><a href="${esc(foodCostMenuLinkV135(a.menuName))}">${esc(a.menuName||'وجبة')} · ${n(a.percent)}%</a><span>${esc(a.reason||'تغير الكوست')}${a.seen?'':' · جديد'}</span></div>`).join(''):'<p class="metric-note">لا توجد إشعارات كوست حتى الآن.</p>'}</div></div>`;
  const draw=()=>{
   const needle=query.toLocaleLowerCase('ar');
   const rows=arr.filter(x=>{
    const kind=foodCostColorV135(x,settings.min,settings.max);
    return String(x.name||'').toLocaleLowerCase('ar').includes(needle)&&
     (filter==='all'||filter==='outside'&&(kind==='high'||kind==='low')||filter==='missing'&&kind==='missing'||filter==='within'&&kind==='ok');
   }).slice().sort((a,b)=>sort==='name'?String(a.name).localeCompare(String(b.name),'ar'):
     sort==='price'?Number(b.effectivePrice||0)-Number(a.effectivePrice||0):
     (a.percent==null?1:b.percent==null?-1:sort==='asc'?Number(a.percent)-Number(b.percent):Number(b.percent)-Number(a.percent)));
   root.querySelector('#v135-cost-count').textContent=`${n(rows.length)} وجبة`;
   root.querySelector('#v135-cost-rows').innerHTML=rows.map(row=>{
     const cls=foodCostColorV135(row,settings.min,settings.max);
     const label=cls==='high'?'أعلى من الحد':cls==='low'?'أقل من الحد':cls==='missing'?'لم تكتمل التكلفة':'ضمن الحد';
     return `<tr class="v135-foodcost-${cls}"><td><a href="${esc(foodCostMenuLinkV135(row.name))}"><strong>${esc(row.name)}</strong></a></td>
     <td>${row.cost==null?'—':money(row.cost)}</td><td>${row.effectivePrice==null?'—':money(row.effectivePrice)}</td>
     <td><strong>${row.percent==null?'—':n(row.percent)+'%'}</strong></td><td>${label}</td></tr>`;
   }).join('')||'<tr><td colspan="5">لا توجد وجبات مطابقة.</td></tr>';
  };
  root.querySelector('#v135-cost-search').oninput=e=>{query=e.target.value;draw();};
  root.querySelector('#v135-cost-filter').onchange=e=>{filter=e.target.value;draw();};
  root.querySelector('#v135-cost-sort').onchange=e=>{sort=e.target.value;draw();};
  root.querySelector('#v135-cost-read-alerts').onclick=async e=>{
   e.currentTarget.disabled=true;
   try{await api.v135ReadCostAlerts();document.dispatchEvent(new CustomEvent('maria:food-cost-changed'));
      toast('تم تعليم إشعارات الكوست كمقروءة','success');await renderFoodCostV135(root);}
   catch(err){toast(friendlyError(err),'error');e.currentTarget.disabled=false;}
  };
  draw();
 }catch(err){root.innerHTML=`<div class="notice rose">${esc(friendlyError(err,'تعذر جلب الكوست. يجب تشغيل SQL v1.0.35.'))}</div>`;}
}
