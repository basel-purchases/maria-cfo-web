import * as api from '../api.js?v=0.34';
import {modal,toast,loader,friendlyError,confirmBox} from '../ui.js?v=0.33';
import {esc,money,dateOnly,todayISO} from '../utils.js?v=0.27';
import {registerTableExport} from '../table-export-v027.js?v=0.33';
import {EVENT_RULE_NAMES_V034,eventCostQuoteV034,eventActualResultV034} from '../event-cost-v034.js?v=0.34';

const fmt=(v,c='SYP')=>money(Number(v)||0,c);
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const yes=(v)=>v===true;
const empty=m=>`<div class="empty"><strong>${esc(m)}</strong></div>`;
const statusLabel={planning:'تخطيط',open:'مفتوحة للحجز',confirmed:'مؤكدة',completed:'مقفلة',cancelled:'ملغاة',
 available:'متاحة',reserved:'محجوزة',seated:'جالسون',cancelled_table:'ملغاة',paid:'مدفوعة',pending:'بانتظار الدفع',refunded:'مسترجعة',voided:'ملغاة'};
const opts=(arr,selected)=>arr.map(([v,t])=>`<option value="${esc(v)}" ${String(v)===String(selected)?'selected':''}>${esc(t)}</option>`).join('');
const toError=e=>{
 const s=String(e?.message||'');
 const errors={
 EVENT_EXTRA_ALREADY_SETTLED:'الفاتورة دُفعت أو ألغيت مسبقًا. حدّث الصفحة قبل تكرار العملية.',
 EVENT_HAS_UNPAID_EXTRAS:'توجد فواتير إضافية غير مدفوعة. يجب تحصيلها أو إلغاؤها قبل إقفال الحفلة.',
 EVENT_HAS_UNPAID_BOOKINGS:'توجد حجوزات لم تسدد بالكامل. راجع المستحقات قبل الإقفال.',
 EVENT_FOOD_COST_INCOMPLETE:'توجد أطباق دون وصفات أو أسعار تكلفة مكتملة. أكمل تكلفة الطعام قبل الإقفال.',
 EVENT_TABLE_DUPLICATE:'يوجد اسم طاولة مماثل؛ أعط الطاولة رقمًا مختلفًا.',
 EVENT_TABLE_NOT_AVAILABLE:'هذه الطاولة مرتبطة بحجز أو لا تتسع للعدد المطلوب.',
 EVENT_RULE_DUPLICATE:'هذه الوجبة وقاعدة تقديمها موجودتان بالفعل.',
 EVENT_RULE_INVALID:'راجع الكمية وعدد الضيوف للطبق؛ القيم يجب أن تكون صحيحة وموجبة.',
 EVENT_EXTRA_FOOD_COST_INCOMPLETE:'الصنف الإضافي بلا وصفة تكلفة مكتملة؛ أكمل تكلفة الصنف أو استخدم تكلفة يدوية موثّقة.',
 EVENT_EXTRA_COST_REQUIRED:'حدد تكلفة الوحدة الإضافية حتى لا يظهر الربح أعلى من الحقيقي.',
 EVENT_NOT_EDITABLE:'هذه الحفلة مقفلة أو ملغاة ولا يمكن تعديل الخطة.',
 EVENT_GUEST_COUNT_REQUIRED:'أدخل العدد الفعلي للضيوف في كل طاولة، حتى لو كان صفرًا، قبل إقفال الحفلة.',
 REASON_REQUIRED:'يرجى كتابة سبب واضح لا يقل عن ثلاثة أحرف.',
 };
 for(const [k,v] of Object.entries(errors))if(s.includes(k))return v;
 if(s.includes('PGRST202')||s.includes('event_extras_v034')||s.includes('event_planner_settings_v034')||s.includes('event_activity_v034'))return 'يلزم تطبيق ملف SQL للإصدار v0.34 على Supabase قبل استخدام إدارة الحفلات.';
 return friendlyError(e,s||'حدث خطأ غير متوقع');
};

export async function renderEventsV034(root){
 root.innerHTML=loader();
 try{
  const events=await api.events();
  root.innerHTML=`<div class="page-head"><div><h2>إدارة الحفلات</h2><p>من تقدير تكلفة المقعد وتسعير التذكرة إلى توزيع الضيوف ومحاسبة الطاولات والربح بعد الحفلة.</p></div>
  <button type="button" class="btn" id="event-new-v034">+ حفلة جديدة</button></div>
  <div class="event-journey-v034"><span>① خطط تكلفة الحفلة</span><span>② وزّع الطاولات</span><span>③ ثبّت قائمة الضيافة</span><span>④ حصّل الحجوزات والإضافات</span><span>⑤ راجع النتيجة</span></div>
  ${events.length?`<div class="grid cols-3 event-list-grid-v034">${events.map(e=>`<a class="card event-list-card-v034" href="#/event/${esc(e.id)}">
    <div class="event-list-card-top-v034"><span class="badge ${e.status==='completed'?'green':e.status==='cancelled'?'red':'yellow'}">${esc(statusLabel[e.status]||e.status||'—')}</span><span class="metric-note">${dateOnly(e.event_date)}</span></div>
    <h3>${esc(e.name)}</h3><div class="event-list-chips-v034"><span>♟ ${esc(e.planned_guest_count??0)} ضيف مخطط</span><span>◈ ${esc(e.event_type==='public'?'عامة':'خاصة')}</span></div>
    <div class="go">فتح لوحة الحفلة ←</div></a>`).join('')}</div>`:empty('لا توجد حفلات حتى الآن. أنشئ الحفلة الأولى ليظهر لك مخططها وحساب التكلفة.')}`;
  root.querySelector('#event-new-v034').onclick=()=>modal({title:'إنشاء حفلة جديدة',subtitle:'بعد الإنشاء ستنتقل إلى لوحة تنظيمها وتسعيرها.',submitText:'إنشاء وفتح الحفلة',
   body:`<div class="form-grid"><div class="field full"><label>اسم الحفلة</label><input name="name" required maxlength="120" placeholder="مثال: سهرة الجمعة - فرقة النغم"></div>
    <div class="field"><label>تاريخ الحفلة</label><input type="date" name="date" value="${todayISO()}" required></div>
    <div class="field"><label>نوع الحفلة</label><select name="type"><option value="public">عامة · تذاكر</option><option value="private">خاصة · حجز</option></select></div>
    <div class="field"><label>عدد الضيوف المتوقع</label><input type="number" name="guests" min="1" max="100000" value="40" required></div>
    <div class="field"><label>عملة الحفلة</label><select name="currency"><option value="SYP">ليرة سورية SYP</option><option value="USD">دولار USD</option></select></div>
    <div class="field full"><label>مصدر الإيراد</label><select name="mode"><option value="bookings">تذاكر وحجوزات</option><option value="both">حجوزات وأوردرات منفصلة</option><option value="orders">أوردرات فقط</option></select></div></div>`,
   onSubmit:async fd=>{try{const result=await api.createEvent({name:fd.get('name'),date:fd.get('date'),type:fd.get('type'),guests:fd.get('guests'),currency:fd.get('currency'),revenueMode:fd.get('mode')});
    toast('تم إنشاء الحفلة. ابدأ بضبط الخطة والطاولات.','success');location.hash=`#/event/${result}`;return true;
   }catch(e){toast(toError(e),'error');return false;}}
  });
 }catch(e){root.innerHTML=`<div class="notice">${esc(toError(e))}</div>`;}
}

export async function renderEventDetailV034(root,eventId){
 let tab='overview',state=null,busy=false;
 root.innerHTML=loader();
 const reload=async()=>{
  if(busy)return;busy=true;root.innerHTML=loader();
  try{
   const [event,tables,rules,requirements,tableMenu,menuCosts,costs,costCompare,labor,summary,bookings,bookingBalances,extras,waste,boxes,expenses,planner,settings,activity]=await Promise.all([
    api.eventV034(eventId),api.eventTablesV034(eventId),api.eventMenuRulesV034(eventId),
    api.eventMenuRequirementsV034(eventId),api.eventTableMenuV034(eventId),api.menuCostsV034(),
    api.eventCostItemsV034(eventId),api.eventCostComparisonV034(eventId),api.eventLaborV034(eventId),
    api.eventSummaryV034(eventId),api.eventBookings(eventId),api.eventBookingBalancesV034(eventId),
    api.eventExtrasV034(eventId),api.eventWasteV034(eventId),api.cashboxes(),
    api.eventExpenseEntriesV034(eventId),api.eventPlannerV034(eventId),api.payrollSettings(),api.eventActivityV034(eventId),
   ]);
   if(!event)throw Error('EVENT_NOT_FOUND');
   state={event,tables,rules,requirements,tableMenu,menuCosts,costs,costCompare,labor,summary:summary||{},bookings,bookingBalances,
    extras,waste,boxes,expenses,planner,settings,activity};
   paint();
  }catch(e){root.innerHTML=`<div class="page-head"><h2>الحفلة</h2><a class="btn secondary" href="#/events-list">رجوع</a></div><div class="notice"><strong>تعذّر تحميل لوحة الحفلة</strong><p>${esc(toError(e))}</p></div>`;}
  finally{busy=false;}
 };
 const priceCurrency=()=>state.event.price_currency_code||'SYP';
 const baseCurrency=()=>state.settings.base_currency_code||'SYP';
 const fx=()=>num(state.event.price_exchange_rate_to_base)||1;
 const box=()=>state.boxes.find(b=>b.is_active&&b.is_general)||state.boxes.find(b=>b.is_active);
 const editing=()=>['planning','open','confirmed'].includes(state.event.status);
 const quote=()=>eventCostQuoteV034({
  guests:state.event.planned_guest_count,tables:state.tables.filter(t=>t.status!=='cancelled').length,
  menuRules:state.requirements,menuCosts:state.menuCosts,
  otherCosts:state.costs.filter(c=>c.is_active!==false),laborCosts:state.labor.filter(l=>l.status==='active'),
  wasteReservePercent:state.planner.waste_reserve_percent,targetMarginPercent:state.planner.target_margin_percent,
  ticketPrice:state.event.default_price_original||0,exchangeRate:fx(),
 });
 const actual=()=>eventActualResultV034({historical:state.summary,extras:state.extras,waste:state.waste,bookingBalances:state.bookingBalances,tables:state.tables});
 const withBox=()=>opts(state.boxes.filter(b=>b.is_active).map(b=>[b.id,b.name+(b.is_general?' · العام':'')]),box()?.id||'');
 const dialogError=e=>{toast(toError(e),'error');return false;};
 const commit=async(fn,msg)=>{try{await fn();toast(msg,'success');await reload();return true;}catch(e){return dialogError(e);}};
 const moneyBase=v=>fmt(v,baseCurrency());
 const moneyTicket=v=>fmt(v,priceCurrency());
 const stage=()=>state.event.status==='completed'?5:state.extras.some(x=>x.status==='pending')?4:state.rules.length&&state.tables.length?3:state.tables.length?2:1;
 const badge=stateName=>`<span class="badge ${stateName==='paid'||stateName==='completed'||stateName==='confirmed'?'green':stateName==='pending'?'red':'yellow'}">${esc(statusLabel[stateName]||stateName||'—')}</span>`;
 const tabNames=[['overview','نظرة عامة'],['tables','الطاولات والحجوزات'],['menu','قائمة الضيافة'],['costs','المصاريف والتجهيز'],['extras','فواتير الطاولات والهدر'],['activity','سجل الحفلة'],['report','التقرير الختامي']];
 function paint(){
  const q=quote(),a=actual(),e=state.event;
  const pendingExtras=state.extras.filter(x=>x.status==='pending');
  const warnings=[];
  if(!state.tables.length)warnings.push('لم تُجهّز الطاولات بعد');
  if(!state.rules.length)warnings.push('لم تُسجّل قائمة ضيافة للحفلة');
  if(q.missing)warnings.push(`${q.missing} صنف لا يملك تكلفة وصفة مكتملة`);
  if(a.extraDue>0)warnings.push(`${pendingExtras.length} فاتورة طاولة تنتظر التحصيل`);
  if(a.bookingDue>0)warnings.push('حجوزات غير مسددة');
  root.innerHTML=`<div class="event-detail-head-v034">
    <div><a class="event-back-v034" href="#/events-list">→ كل الحفلات</a><h2>${esc(e.name)}</h2>
      <p>${dateOnly(e.event_date)} · ${badge(e.status)} · ${esc(e.event_type==='public'?'حفلة عامة':'حفلة خاصة')}</p></div>
    <div class="quick-actions"><button class="btn secondary" id="event-refresh-v034">تحديث ↻</button>
      ${editing()?`<button class="btn secondary" id="event-status-v034">تغيير الحالة</button><button class="btn secondary" id="event-plan-v034">تعديل خطة الحفلة</button>`:''}</div></div>
   <div class="event-stage-line-v034" aria-label="مراحل الحفلة">${['خطة وتسعير','توزيع الطاولات','قائمة الضيافة','تحصيل المستحقات','النتيجة'].map((x,i)=>`<div class="${stage()>i?'done':''}"><span>${i+1}</span>${x}</div>`).join('')}</div>
   <div class="grid cols-4 event-kpis-v034">
    <div class="card"><div class="metric-label">تكلفة الشخص المخططة</div><div class="metric-value">${q.costPerPerson==null?'—':moneyBase(q.costPerPerson)}</div><small>${q.missing?'⚠ هناك أصناف بلا تكلفة':'تشمل الضيافة والمصاريف والاحتياط'}</small></div>
    <div class="card"><div class="metric-label">سعر التذكرة المقترح</div><div class="metric-value">${q.suggestedTicket==null?'—':moneyTicket(q.suggestedTicket)}</div><small>هامش ربح مستهدف ${esc(state.planner.target_margin_percent)}%</small></div>
    <div class="card"><div class="metric-label">الربح المخطط</div><div class="metric-value ${q.profit<0?'payroll-danger-v034':''}">${moneyBase(q.profit)}</div><small>سعر التذكرة المحدد: ${moneyTicket(e.default_price_original||0)}</small></div>
    <div class="card ${pendingExtras.length?'event-kpi-due-v034':''}"><div class="metric-label">فواتير إضافية تنتظر التحصيل</div><div class="metric-value">${pendingExtras.length}</div><small>${moneyTicket(a.extraDue)} · غير مدفوع</small></div>
   </div>
   ${warnings.length?`<div class="event-warning-line-v034">⚠ ${warnings.map(x=>esc(x)).join(' · ')}</div>`:''}
   <div class="event-tabs-v034" role="tablist" aria-label="أقسام الحفلة">${tabNames.map(([key,name])=>`<button type="button" role="tab" class="event-tab-v034 ${tab===key?'active':''}" aria-selected="${tab===key}" data-tab="${key}">${name}${key==='extras'&&pendingExtras.length?` <span class="event-tab-alert-v034">${pendingExtras.length}</span>`:''}</button>`).join('')}</div>
   <div id="event-tab-content-v034">${tabHtml()}</div>`;
  root.querySelector('#event-refresh-v034').onclick=reload;
  root.querySelector('#event-plan-v034')?.addEventListener('click',openPlan);
  root.querySelector('#event-status-v034')?.addEventListener('click',openStatus);
  root.querySelectorAll('[data-tab]').forEach(btn=>btn.onclick=()=>{tab=btn.dataset.tab;paint();});
  attachActions();
 }
 function tabHtml(){
  if(tab==='tables')return tablesHtml();
  if(tab==='menu')return menuHtml();
  if(tab==='costs')return costsHtml();
  if(tab==='extras')return extrasHtml();
  if(tab==='report')return reportHtml();
  if(tab==='activity')return activityHtml();
  return overviewHtml();
 }
 function overviewHtml(){
  const q=quote(),a=actual(),e=state.event;
  const plannedRevenue=q.revenue,plannedCost=q.total;
  const max=Math.max(plannedRevenue,plannedCost,1);
  const difference=state.tables.filter(t=>t.status!=='cancelled').reduce((s,t)=>s+num(t.planned_guest_count),0)-num(e.planned_guest_count);
  return `<div class="grid cols-2 event-dashboard-panels-v034"><section class="card"><div class="finance-section-head"><div><h3>تحليل ميزانية الحفلة</h3><p>تفصيل تكلفة الضيافة والفرقة والمصاريف والاحتياط قبل بدء الحفلة.</p></div>${editing()?'<button class="mini-btn" data-action="open-plan">ضبط السعر والهامش</button>':''}</div>
   <div class="event-budget-row-v034"><span>طعام ومشروبات</span><strong>${moneyBase(q.food)}</strong></div>
   <div class="event-budget-row-v034"><span>مصاريف وتجهيز وفرقة</span><strong>${moneyBase(q.others)}</strong></div>
   <div class="event-budget-row-v034"><span>أجور العمالة</span><strong>${moneyBase(q.labor)}</strong></div>
   <div class="event-budget-row-v034"><span>احتياط الهدر ${esc(state.planner.waste_reserve_percent)}%</span><strong>${moneyBase(q.reserve)}</strong></div>
   <div class="event-budget-row-v034 total"><span>التكلفة المخططة</span><strong>${moneyBase(plannedCost)}</strong></div>
   <div class="event-budget-visual-v034"><div><span style="width:${Math.min(100,plannedRevenue/max*100)}%" class="event-bar-income-v034"></span></div><small>الإيراد المتوقع ${moneyBase(plannedRevenue)}</small>
    <div><span style="width:${Math.min(100,plannedCost/max*100)}%" class="event-bar-cost-v034"></span></div><small>التكلفة ${moneyBase(plannedCost)}</small></div>
   <p class="metric-note">${q.missing?'⚠ التقدير غير مكتمل لأن بعض الأصناف تفتقد تكلفة؛ لا تعتمد على هامش الربح الظاهر.':'تُحتسب تكلفة أصناف الطعام من وصفات المطعم وأسعار المواد الحالية.'}</p></section>
   <section class="card"><h3>الطاقة التشغيلية والحجز</h3>
    <div class="event-occupancy-big-v034"><strong>${esc(e.planned_guest_count||0)}</strong><span>ضيف متوقع</span><strong>${state.tables.filter(t=>t.status!=='cancelled').length}</strong><span>طاولة</span></div>
    <div class="event-seating-progress-v034"><div style="width:${Math.min(100,Math.max(0,state.tables.reduce((a,t)=>a+num(t.planned_guest_count),0)/Math.max(1,num(e.planned_guest_count))*100))}%"></div></div>
    <p class="metric-note">المقاعد الموزعة ${state.tables.filter(t=>t.status!=='cancelled').reduce((a,t)=>a+num(t.planned_guest_count),0)} من ${esc(e.planned_guest_count||0)} · الفرق ${difference>0?'+':''}${difference} ضيف</p>
    ${difference!==0?`<div class="notice">${difference<0?'بعض الضيوف لم تخصص لهم طاولات بعد.':'يوجد ضيوف موزعون أكثر من عدد الخطة. حدّث العدد المتوقع.'}</div>`:''}
    <div class="event-today-actions-v034"><button class="btn secondary" data-nav="tables">مخطط الطاولات ←</button><button class="btn secondary" data-nav="menu">قائمة الأطباق ←</button></div>
    <div class="event-divider-v034"></div><h3>أمور يجب الانتباه لها</h3>
    <div class="event-check-list-v034">${[
     [state.tables.length>0,'تجهيز الطاولات وسعتها'],[state.rules.length>0&&q.missing===0,'تحديد أصناف الضيافة وتكاليفها'],
     [!state.extras.some(x=>x.status==='pending'),'تحصيل فواتير الإضافات'],[a.bookingDue<=0,'تحصيل الحجوزات']
    ].map(([done,label])=>`<div><span class="${done?'ok':'warn'}">${done?'✓':'!'}</span>${label}</div>`).join('')}</div></section></div>
  <div class="notice green event-tip-v034"><strong>كيف تحدد سعر التذكرة؟</strong> أدخل قائمة الضيافة والطاولات والموسيقى وجميع التكاليف، ثم انظر إلى «سعر التذكرة المقترح». الاحتياط يغطي الهدر المتوقع ولا يُعد مصروفًا نقديًا إلا عند تسجيل الهدر الفعلي.</div>`;
 }
 function tableFoodCost(t){
  const catalog=new Map(state.menuCosts.map(c=>[String(c.id),c]));
  let cost=0,missing=0;
  const lines=state.tableMenu.filter(i=>String(i.table_id)===String(t.id));
  for(const l of lines){const c=catalog.get(String(l.menu_item_id));if(!c||c.has_missing_cost||c.recipe_cost_base==null)missing++;else cost+=num(l.required_quantity)*num(c.recipe_cost_base);}
  return {cost,missing,lines};
 }
 function tablesHtml(){
  const e=state.event,readOnly=!editing(),q=quote();
  const active=state.tables.filter(t=>t.status!=='cancelled');
  const activeSeats=active.reduce((sum,t)=>sum+num(t.capacity),0);
  const assigned=active.reduce((sum,t)=>sum+num(t.planned_guest_count),0);
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>مخطط الطاولات والمقاعد</h3><p>افتح طاولة جديدة أو غيّر عدد ضيوفها، فتتغير كميات الصحون المشتركة وتكلفة الحفلة.</p></div>${!readOnly?'<button class="btn" data-action="add-table">+ إضافة طاولة</button>':''}</div>
   <div class="event-table-stats-v034"><span>🪑 الطاقة الكلية: <strong>${activeSeats}</strong> كرسي</span><span>👥 الموزع: <strong>${assigned}</strong> ضيف</span><span>🍽 تكلفة الطعام لكل شخص: <strong>${q.count?moneyBase(q.food/q.count):'—'}</strong></span></div>
   ${active.length?`<div class="event-seat-map-v034">${active.map(t=>{
    const f=tableFoodCost(t),occupancy=num(t.planned_guest_count),capacity=num(t.capacity),due=state.extras.filter(x=>String(x.table_id)===String(t.id)&&x.status==='pending').reduce((a,x)=>a+num(x.amount_original),0);
    const count=Math.min(18,capacity),seats=Array.from({length:count},(_,i)=>`<span class="${i<occupancy?'filled':'empty-seat'}" title="${i<occupancy?'مقعد مستخدم':'مقعد شاغر'}">●</span>`).join('');
    return `<article class="event-table-card-v034 ${due?'has-due':''}">
     <div class="event-table-card-title-v034"><div><strong>${esc(t.table_label)}</strong><small>${esc(statusLabel[t.status]||t.status||'طاولة')}</small></div><button type="button" class="mini-btn" data-table-edit="${esc(t.id)}" ${readOnly?'disabled':''}>تعديل</button></div>
     <div class="event-table-illustration-v034"><div class="event-table-disc-v034">${esc(occupancy)} / ${esc(capacity)}</div><div class="event-seat-dots-v034">${seats}</div></div>
     <div class="event-table-numbers-v034"><span>تكلفة طعام الطاولة</span><strong>${moneyBase(f.cost)} ${f.missing?'⚠':''}</strong></div>
     <div class="event-table-numbers-v034"><span>طعام لكل ضيف</span><strong>${occupancy?moneyBase(f.cost/occupancy):'—'}</strong></div>
     <div class="event-table-numbers-v034"><span>فاتورة خارج الباقة</span><strong class="${due?'payroll-danger-v034':''}">${moneyTicket(due)}</strong></div>
     <div class="event-table-actions-v034">${!readOnly?`<button class="mini-btn" data-table-book="${esc(t.id)}" ${t.booking_id?'disabled':''}>${t.booking_id?'محجوزة':'حجز'}</button><button class="mini-btn" data-table-extra="${esc(t.id)}">+ طلب إضافي</button>`:''}<button class="mini-btn" data-table-invoice="${esc(t.id)}">كشف الطاولة ↗</button><button class="mini-btn" data-tab-switch="extras">الفواتير</button></div>
    </article>`;
   }).join('')}</div>`:empty('أضف أول طاولة لتظهر خريطة المقاعد.')}
   <p class="metric-note">تكلفة طعام الطاولة تعتمد على حصصها فقط؛ الفرقة والمصاريف العامة تُوزع عند حساب إجمالي تكلفة الشخص. يظهر تحذير عند فقد وصفة أو سعر مادة.</p></section>
  <section class="card finance-section"><div class="finance-section-head"><div><h3>حجوزات الضيوف والتحصيل</h3><p>الحجز يثبت إيرادًا متوقعًا؛ لا يظهر نقد في الصندوق حتى تضغط «تحصيل».</p></div>${!readOnly?'<button class="btn secondary" data-action="add-booking">+ حجز</button>':''}</div>
  ${state.bookings.length?`<div class="table-wrap"><table class="table event-booking-table-v034"><thead><tr><th>الحجز</th><th>عدد الأشخاص</th><th>الطاولة</th><th>القيمة المتفق عليها</th><th>المقبوض</th><th>المتبقي</th><th>الحالة</th><th>تحصيل</th></tr></thead><tbody>
   ${state.bookings.map(b=>{const balance=state.bookingBalances.find(x=>x.booking_id===b.id)||{},assignedTable=state.tables.find(t=>t.booking_id===b.id),due=num(balance.balance_original);
    return `<tr><td><strong>${esc(b.customer_name)}</strong><small>${esc(b.customer_phone||'—')}</small></td><td>${esc(b.guest_count)}</td><td>${esc(assignedTable?.table_label||'بدون طاولة')}</td>
    <td>${fmt(b.agreed_amount_original,b.currency_code)}</td><td>${fmt(balance.paid_original||0,b.currency_code)}</td><td><strong class="${due>0?'payroll-danger-v034':''}">${fmt(due,b.currency_code)}</strong></td><td>${esc(b.status||'حجز')}</td><td><button class="mini-btn" data-book-pay="${esc(b.id)}" ${!editing()||due<=0?'disabled':''}>تحصيل</button></td></tr>`;
   }).join('')}</tbody></table></div>`:empty('لا توجد حجوزات مسجلة. يمكن تسجيل حجز لطاولة واحدة أو لمجموعة.')}</section>`;
 }
 function menuHtml(){
  const q=quote();
  const model=new Map(q.items.map(i=>[String(i.rule.id||i.rule.rule_id),i]));
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>قواعد ضيافة الحفلة</h3><p>الوجبة الرئيسية لكل شخص؛ الجاط لكل 4 أشخاص داخل كل طاولة؛ الصحن لكل طاولة؛ أو كمية ثابتة للحفلة.</p></div>${editing()?'<button class="btn" data-action="add-rule">+ صنف من قائمة المطعم</button>':''}</div>
   ${q.missing?`<div class="notice">⚠ يوجد ${q.missing} صنف بلا تكلفة مكتملة. لن نعتبر الربح دقيقًا حتى تضيف وصفته وأسعار مكوناته في قسم «الوجبات والوصفات».</div>`:''}
   ${state.requirements.length?`<div class="table-wrap"><table class="table event-menu-table-v034"><thead><tr><th>الصنف</th><th>التقديم</th><th>الكمية لكل توزيع</th><th>عدد الحصص المطلوب</th><th>تكلفة الحصة</th><th>الإجمالي المخطط</th><th>إجراء</th></tr></thead><tbody>
    ${state.requirements.map(r=>{const item=model.get(String(r.rule_id));return `<tr>
     <td><strong>${esc(r.menu_item_name)}</strong></td><td>${esc(EVENT_RULE_NAMES_V034[r.rule_type]||r.rule_type)} ${r.rule_type==='per_n_people'?`· كل ${esc(r.people_per_rule)} أشخاص`:''}</td>
     <td>${esc(r.quantity_per_rule)}</td><td>${esc(r.required_quantity)}</td><td>${item?.unitCost==null?'⚠ غير معروف':moneyBase(item.unitCost)}</td>
     <td>${item?.totalCost==null?'⚠ غير معروف':moneyBase(item.totalCost)}</td>
     <td>${editing()?`<button class="mini-btn" data-rule-edit="${esc(r.rule_id)}">تعديل</button> <button class="mini-btn danger-lite" data-rule-delete="${esc(r.rule_id)}">حذف</button>`:'—'}</td></tr>`}).join('')}</tbody></table></div>`:empty('حدد أصناف الضيافة وقاعدة تقديم كل طبق ليحسب البرنامج كميات الطاولات تلقائيًا.')}
   <div class="event-footnote-v034">مثال دقيق: 8 ضيوف على طاولتين (3 و5). إذا كان جاط التبولة يكفي 4 أشخاص فإن المطلوب جاط + جاطين = 3، وليس جاطين بناءً على إجمالي الـ8.</div>
   <div class="event-total-line-v034"><span>مجموع تكلفة الضيافة المخططة</span><strong>${moneyBase(q.food)}</strong></div></section>`;
 }
 function costsHtml(){
  const total=state.costs.filter(c=>c.is_active!==false).reduce((a,c)=>a+num(c.planned_amount_base),0);
  const count=state.expenses.filter(x=>x.status==='posted').length;
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>الميزانية الإضافية للحفلة</h3><p>الفرقة الموسيقية، الصوت والإضاءة، الزينة، النقل، التنظيف، العمالة والخدمات وغيرها.</p></div>${editing()?'<button class="btn" data-action="add-cost">+ بند تكلفة مخطط</button>':''}</div>
    <div class="event-summary-mini-v034"><span>المتوقع: <strong>${moneyBase(total)}</strong></span><span>مصروفات نقدية مسجلة: <strong>${count}</strong></span><button class="btn secondary" data-action="add-expense" ${!editing()?'disabled':''}>+ مصروف فعلي من الصندوق</button></div>
    ${state.costs.length?`<div class="table-wrap"><table class="table event-cost-table-v034"><thead><tr><th>البند</th><th>المورد أو الفرقة</th><th>المخطط</th><th>الفعلي المسجل</th><th>الفرق</th><th>إجراء</th></tr></thead><tbody>
    ${state.costs.map(c=>{const compare=state.costCompare.find(x=>x.event_cost_id===c.id),planned=num(c.planned_amount_base),actual=num(compare?.actual_amount_base);return `<tr><td><strong>${esc(c.title)}</strong><small>${esc(c.notes||'')}</small></td><td>${esc(c.payee||'—')}</td>
     <td>${moneyBase(planned)}</td><td>${moneyBase(actual)}</td><td class="${actual>planned?'payroll-danger-v034':''}">${moneyBase(actual-planned)}</td>
     <td><button class="mini-btn" data-expense-for="${esc(c.id)}" ${!editing()?'disabled':''}>تسجيل فعلي</button></td></tr>`;}).join('')}</tbody></table></div>`:empty('لم تُسجّل تكاليف الخدمات والموسيقى والعمالة بعد.')}
   ${state.expenses.filter(x=>x.status==='posted'&&!x.event_cost_id).length?`<div class="notice">يوجد ${state.expenses.filter(x=>x.status==='posted'&&!x.event_cost_id).length} مصروف فعلي غير مربوط ببند مخطط. سيُحتسب في التقرير الفعلي، ويمكن مراجعته في صفحة المصروفات.</div>`:''}
   <div class="event-footnote-v034">المخطط لا يُنقص رصيد الصندوق. اضغط «تسجيل فعلي» فقط عند دفع الأموال، لتسجل حركة نقدية مرتبطة بالحفلة.</div></section>`;
 }
 function extrasHtml(){
  const pending=state.extras.filter(x=>x.status==='pending'),paid=state.extras.filter(x=>x.status==='paid');
  const due=pending.reduce((a,x)=>a+num(x.amount_original),0);
  const waste=state.waste.filter(x=>x.status==='active');
  return `<div class="grid cols-3 event-extra-kpis-v034"><div class="card"><div class="metric-label">فواتير تنتظر الدفع</div><div class="metric-value">${pending.length}</div><small>${moneyTicket(due)}</small></div>
   <div class="card"><div class="metric-label">طلبات إضافية محصّلة</div><div class="metric-value">${paid.length}</div><small>${moneyTicket(paid.reduce((a,x)=>a+num(x.amount_original),0))}</small></div>
   <div class="card"><div class="metric-label">هدر إضافي مسجّل</div><div class="metric-value">${moneyBase(waste.reduce((a,x)=>a+num(x.total_cost_base),0))}</div><small>لا يخرج نقدًا ولا يعدّل المخزون تلقائيًا</small></div></div>
   <section class="card finance-section"><div class="finance-section-head"><div><h3>فواتير الطلبات خارج باقة الحفلة</h3><p>لكل طاولة كشف مستقل. يبقى الطلب مستحقًا حتى يُحصّل من الصندوق، ويمنع إغلاق الحفلة إذا بقي غير مدفوع.</p></div>${editing()?'<button class="btn" data-action="add-extra">+ طلب خارج الباقة</button>':''}</div>
    ${pending.length?`<div class="notice">⚠ يوجد ${pending.length} طلب/فاتورة يجب تحصيله قبل مغادرة الطاولات. القيمة: <strong>${moneyTicket(due)}</strong>.</div>`:''}
    ${state.extras.length?`<div class="table-wrap"><table class="table event-extra-table-v034"><thead><tr><th>الطاولة</th><th>الصنف الإضافي</th><th>العدد</th><th>سعر الوحدة</th><th>المبلغ</th><th>تكلفة الطلب</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${state.extras.map(x=>`<tr>
      <td><strong>${esc(state.tables.find(t=>t.id===x.table_id)?.table_label||'—')}</strong></td><td>${esc(x.description)}<small>${esc(x.notes||'')}</small></td><td>${esc(x.quantity)}</td><td>${moneyTicket(x.unit_price_original)}</td><td><strong>${moneyTicket(x.amount_original)}</strong></td><td>${moneyBase(x.total_cost_base)}</td><td>${badge(x.status)}</td>
      <td>${x.status==='pending'?`<button class="btn" data-extra-pay="${esc(x.id)}">تحصيل</button> <button class="mini-btn danger-lite" data-extra-void="${esc(x.id)}">إلغاء</button>`:x.status==='paid'?`<button class="mini-btn" data-extra-refund="${esc(x.id)}">إرجاع مبلغ</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:empty('لا يوجد أي طلب خارج باقة الحفلة.')}</section>
   <section class="card finance-section"><div class="finance-section-head"><div><h3>سجل الهدر غير المحسوب سابقًا</h3><p>أضف تكلفة الطعام التالف أو الأواني المكسورة أو خسارة غير محمّلة أصلًا في تكلفة الوصفات. لا تسجّل هدر المخزون المدفوع مرتين.</p></div><button class="btn secondary" data-action="add-waste">+ تسجيل هدر</button></div>
    ${state.waste.length?`<div class="table-wrap"><table class="table"><thead><tr><th>البند</th><th>الكمية</th><th>تكلفة الوحدة (عملة الأساس)</th><th>الإجمالي</th><th>السبب</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${state.waste.map(w=>`<tr><td>${esc(w.description)}</td><td>${esc(w.quantity)}</td><td>${moneyBase(w.unit_cost_base)}</td><td>${moneyBase(w.total_cost_base)}</td><td>${esc(w.reason||'—')}</td><td>${esc(w.status==='active'?'محتسب':'ملغى')}</td><td><button class="mini-btn danger-lite" data-waste-void="${esc(w.id)}" ${w.status!=='active'?'disabled':''}>إلغاء</button></td></tr>`).join('')}</tbody></table></div>`:empty('لا يوجد هدر إضافي مسجل.')}
    <p class="metric-note">تسجيل الهدر هنا يؤثر على تقرير ربحية الحفلة فقط. إذا كانت المواد خرجت فعليًا من المخزون، فسجّل حركة المخزون أيضًا، ولا تكرر قيمتها إذا كانت داخلة في تكلفة الطعام المُرحلة.</p></section>`;
 }
 function reportHtml(){
  const q=quote(),a=actual(),e=state.event;
  const final=e.status==='completed'&&!a.incomplete;
  const bookingsDue=state.bookingBalances.filter(b=>!['cancelled','no_show'].includes(b.booking_status)&&num(b.balance_original)>0);
  return `<div class="event-final-status-v034 ${final?'closed':''}"><div><strong>${final?'✓ نتيجة الحفلة المقفلة':'◷ ملخص مبدئي · لم يكتمل الإقفال المحاسبي'}</strong><p>${final?'مبني على كلفة الطعام المرحلة تاريخيًا والمصروفات المدفوعة.':'التكاليف الحالية تقديرية قبل الإقفال؛ لا تُعتبر ربحًا محاسبيًا نهائيًا.'}</p></div>
   ${editing()?'<button class="btn" data-action="finish-event">مراجعة وإقفال الحفلة</button>':''}</div>
   <div class="grid cols-4 event-final-kpis-v034">
    <div class="card"><div class="metric-label">الإيراد المكتسب + فواتير الإضافات المفتوحة والمحصلّة</div><div class="metric-value">${moneyBase(a.revenue)}</div></div>
    <div class="card"><div class="metric-label">التكاليف الفعلية / المقدّرة حاليًا</div><div class="metric-value">${moneyBase(a.cost)}</div></div>
    <div class="card"><div class="metric-label">النتيجة ${final?'النهائية':'المؤقتة'}</div><div class="metric-value ${a.profit<0?'payroll-danger-v034':''}">${moneyBase(a.profit)}</div></div>
    <div class="card"><div class="metric-label">تكلفة الشخص الفعلية / المقدّرة</div><div class="metric-value">${a.costPerPerson==null?'—':moneyBase(a.costPerPerson)}</div><small>حسب عدد الحضور ${a.guests||'غير مسجل'}</small></div>
   </div>
   <section class="card finance-section"><div class="finance-section-head"><div><h3>مقارنة الميزانية بالواقع</h3><p>يمكن تصدير هذا الكشف كاملًا Excel أو PDF لمراجعته بعد كل حفلة.</p></div></div>
    <div class="table-wrap"><table class="table event-report-table-v034"><thead><tr><th>البند</th><th>المخطط (عملة الأساس)</th><th>الفعلي/المسجل</th><th>التفسير</th></tr></thead><tbody>
     <tr><td>تكلفة الطعام</td><td>${moneyBase(q.food)}</td><td>${moneyBase(state.summary.included_food_cost_base??state.summary.estimated_actual_included_food_cost_base)}</td><td>${final?'تكلفة تاريخية مرحلة':'تقدير حسب القائمة حتى الإقفال'}</td></tr>
     <tr><td>المصاريف والفرقة</td><td>${moneyBase(q.others)}</td><td>${moneyBase(state.summary.actual_other_expense_base)}</td><td>يُسجّل الفعلي من حركة الصندوق</td></tr>
     <tr><td>العمالة</td><td>${moneyBase(q.labor)}</td><td>${moneyBase(state.summary.actual_labor_cost_base)}</td><td>أجور مرتبطة بالحفلة</td></tr>
     <tr><td>تكلفة الطلبات خارج الباقة</td><td>—</td><td>${moneyBase(a.extraCost)}</td><td>محسوبة من وصفة الصنف أو تكلفة مدخلة يدويًا</td></tr>
     <tr><td>احتياط الهدر / المسجّل</td><td>${moneyBase(q.reserve)}</td><td>${moneyBase(a.wasteCost)}</td><td>الهدر الإضافي غير المكرر فقط</td></tr>
     <tr class="event-report-total-v034"><td>التكلفة الإجمالية</td><td>${moneyBase(q.total)}</td><td>${moneyBase(a.cost)}</td><td>${a.incomplete?'⚠ لا تزال بعض التكاليف ناقصة':'الفرق بين المخطط والواقع'}</td></tr>
     <tr><td>الإيرادات</td><td>${moneyBase(q.revenue)}</td><td>${moneyBase(a.revenue)}</td><td>الحجوزات/الأوردرات المكتسبة + الطلبات الإضافية المسجلة، بما فيها غير المحصّلة</td></tr>
     <tr><td>مقبوضات إضافية مؤكدة</td><td>—</td><td>${moneyBase(a.extraCollected)}</td><td>إيرادات تم قبضها عبر صندوق فعلي</td></tr>
     <tr><td>مستحقات إضافية بانتظار التحصيل</td><td>—</td><td>${moneyTicket(a.extraDue)}</td><td>بعملة التذكرة — ليست نقدًا بالصندوق</td></tr>
     <tr class="event-report-total-v034"><td>الربح أو الخسارة</td><td>${moneyBase(q.profit)}</td><td>${moneyBase(a.profit)}</td><td>${final?'مؤشر ختامي':'مؤشر مؤقت، لا تعتمد عليه قبل الإقفال'}</td></tr>
    </tbody></table></div></section>
   <section class="card"><h3>قائمة تدقيق قبل خروج آخر ضيف</h3><div class="event-check-list-v034">
    <div><span class="${a.extraDue<=0?'ok':'warn'}">${a.extraDue<=0?'✓':'!'}</span>الطلبات خارج الباقة غير المحصلة: ${moneyTicket(a.extraDue)}</div>
    <div><span class="${bookingsDue.length===0?'ok':'warn'}">${bookingsDue.length===0?'✓':'!'}</span>عدد الحجوزات ذات الرصيد: ${bookingsDue.length}</div>
    <div><span class="${q.missing===0?'ok':'warn'}">${q.missing===0?'✓':'!'}</span>وصفات طعام بلا تكلفة: ${q.missing}</div>
    <div><span class="${a.guests>0?'ok':'warn'}">${a.guests>0?'✓':'!'}</span>تسجيل الحضور الفعلي: ${a.guests} ضيف</div></div>
    ${final?'<div class="notice green">تم إقفال الحفلة. تكلفة الطعام مؤرشفة في النظام. لا تُعدّل سجلات الإقفال إلا عبر إجراء تصحيح محاسبي صريح.</div>':''}</section>`;
 }
 function activityHtml(){
  const labels={note:'ملاحظة',incident:'حادثة',table:'الطاولات',booking:'الحجوزات',extra:'طلب إضافي',payment:'تحصيل',waste:'هدر',closing:'إقفال'};
  const rows=[...state.activity].reverse();
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>اليوميات وسجل القرارات</h3><p>كل تغيير مهم خلال الحفلة يضاف إلى التسلسل الزمني. يمكنك توثيق حالة طارئة أو ملاحظة تشغيلية فور حدوثها.</p></div>${editing()?'<button class="btn" data-action="add-activity">+ ملاحظة أو حادثة</button>':''}</div>
   ${rows.length?`<div class="event-activity-stream-v034">${rows.map(a=>`<article class="event-activity-card-v034"><span class="event-activity-dot-v034"></span><div><small>${esc(labels[a.activity_type]||a.activity_type)} · ${esc(new Date(a.occurred_at).toLocaleString('ar-SY'))}</small><p>${esc(a.description)}</p></div></article>`).join('')}</div>`:empty('لا توجد ملاحظات. أنشئ ملاحظة بعد أول تغيير على الطاولات أو تسجيل حجز.')}</section>`;
 }
 function openStatus(){
  modal({title:'تعديل حالة الحفلة',subtitle:'تؤثر الحالة على قابلية تعديل الضيافة والحجوزات. الإقفال النهائي له عملية مستقلة في التقرير.',submitText:'حفظ الحالة',
   body:`<div class="field"><label>الحالة التشغيلية</label><select name="status">${opts([['planning','مرحلة التخطيط'],['open','مفتوحة للحجوزات'],['confirmed','مؤكدة وجاهزة للحفلة']],state.event.status)}</select></div>`,
   onSubmit:async fd=>commit(()=>api.eventSetStatusV034(eventId,fd.get('status')),'تم تحديث حالة الحفلة.')
  });
 }
 function openActivity(){
  modal({title:'تسجيل ما حدث في الحفلة',subtitle:'مثال: تم فتح طاولة إضافية أو وصل ضيوف غير متوقعين أو تأخرت الفرقة.',submitText:'حفظ في سجل الحفلة',
   body:`<div class="field"><label>نوع الحدث</label><select name="type"><option value="note">ملاحظة تشغيلية</option><option value="incident">حادثة أو مشكلة تحتاج مراجعة</option></select></div><div class="field"><label>ماذا حصل؟</label><textarea name="description" minlength="2" maxlength="1000" rows="4" required placeholder="اكتب ماذا حدث، ولماذا، وما الإجراء المتخذ"></textarea></div>`,
   onSubmit:async fd=>commit(()=>api.eventRecordActivityV034(eventId,fd.get('type'),fd.get('description')),'تم حفظ الملاحظة في سجل الحفلة.')
  });
 }
 function tableInvoice(table){
  if(!table)return;
  const extras=state.extras.filter(x=>String(x.table_id)===String(table.id)&&x.status!=='voided');
  const booking=state.bookings.find(b=>String(b.id)===String(table.booking_id));
  const balance=state.bookingBalances.find(b=>String(b.booking_id)===String(booking?.id));
  const pInvoice=num(balance?.balance_original);
  const extraDue=extras.filter(x=>x.status==='pending').reduce((s,x)=>s+num(x.amount_original),0);
  const invoiceBody=extras.map(x=>`<tr><td>${esc(x.description)}</td><td>${esc(x.quantity)}</td><td>${esc(x.status==='paid'?'مدفوع':x.status==='refunded'?'مسترجع':'لم يدفع')}</td><td>${moneyTicket(x.amount_original)}</td></tr>`).join('')||'<tr><td colspan="4">لا توجد طلبات إضافية</td></tr>';
  const tabWindow=window.open('','_blank');if(!tabWindow){toast('السماح بالنوافذ المنبثقة مطلوب لطباعة فاتورة الطاولة.','error');return;}
  tabWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشف ${esc(table.table_label)} · ${esc(state.event.name)}</title><style>body{font-family:Tahoma,Arial,sans-serif;margin:35px;color:#24212a;line-height:1.65}h1{margin:0;color:#65435f}small{color:#666}table{border-collapse:collapse;width:100%;margin-top:20px}td,th{border-bottom:1px solid #ddd;padding:9px;text-align:right}th{background:#eee8ee}.summary{margin-top:22px;border:1px solid #c8b7c5;padding:15px;border-radius:9px}.due{font-weight:bold;color:#b12d35;font-size:21px}.paid{color:#176c48}.print{margin:18px 0;padding:8px 20px;cursor:pointer}@media print{.print{display:none}} </style></head><body><h1>كشف حساب ${esc(table.table_label)}</h1><small>الحفلة: ${esc(state.event.name)} · ${dateOnly(state.event.event_date)}</small><hr><p>الضيوف: ${esc(table.actual_guest_count??table.planned_guest_count)} · الحجز: ${esc(booking?.customer_name||'دون حجز')}</p><table><thead><tr><th>الصنف</th><th>الكمية</th><th>الحالة</th><th>المبلغ</th></tr></thead><tbody>${invoiceBody}</tbody></table><div class="summary"><div>قيمة الحجز: ${moneyTicket(booking?.agreed_amount_original)}</div><div>المستلم على الحجز: ${moneyTicket(balance?.paid_original)}</div><div>متبقي الحجز: ${moneyTicket(pInvoice)}</div><div>طلبات إضافية غير مدفوعة: ${moneyTicket(extraDue)}</div><hr><div class="${pInvoice+extraDue>0?'due':'paid'}">${pInvoice+extraDue>0?`مطلوب قبل المغادرة: ${moneyTicket(pInvoice+extraDue)}`:'✓ لا توجد مستحقات معلقة على هذه الطاولة'}</div></div><p><small>هذه نسخة مراجعة؛ إثبات القبض يتم من شاشة الحفلة وليس من طباعة هذا الكشف.</small></p><button onclick="window.print()" class="print">طباعة / حفظ PDF</button></body></html>`);
  tabWindow.document.close();tabWindow.focus();
 }
 function openPlan(){
  const e=state.event,p=state.planner;
  modal({title:'خطة الحفلة وتسعير التذكرة',subtitle:'أسعار الحفلة وعملة الأساس تُعامل كل منها مستقلة. عدّل التكاليف الفعلية من الأقسام المخصصة.',submitText:'حفظ الخطة',
   body:`<div class="form-grid">
   <div class="field"><label>عدد الضيوف المستهدف</label><input name="guests" type="number" min="1" max="100000" step="1" value="${esc(e.planned_guest_count||0)}" required></div>
   <div class="field"><label>سعر التذكرة (${esc(priceCurrency())})</label><input name="ticket" type="number" min="0" step="any" value="${esc(e.default_price_original||0)}" required></div>
   <div class="field"><label>هامش الربح المطلوب %</label><input name="margin" type="number" min="0" max="94" step="0.5" value="${esc(p.target_margin_percent??25)}" required></div>
   <div class="field"><label>احتياط الهدر من الطعام %</label><input name="waste" type="number" min="0" max="100" step="0.5" value="${esc(p.waste_reserve_percent??5)}" required></div>
   <div class="field full"><label>ملاحظات الحفلة</label><textarea name="notes" maxlength="2000" rows="3" placeholder="ترتيبات استثنائية، طريقة التقديم، ملاحظات الإدارة...">${esc(e.notes||'')}</textarea></div></div>
   <p class="metric-note">المبلغ الذي تقترحه الشاشة يُعاد حسابه من تكلفة كل طبق وطاولة وفرقة ومصروف. احتياط الهدر جزء تقديري من الميزانية وليس مبلغًا مدفوعًا.</p>`,
   onSubmit:async fd=>{
    const guests=Number(fd.get('guests')),price=Number(fd.get('ticket')),margin=Number(fd.get('margin')),waste=Number(fd.get('waste'));
    if(!Number.isInteger(guests)||guests<1||!Number.isFinite(price)||price<0||margin<0||margin>=95||waste<0||waste>100){toast('راجع عدد الأشخاص وسعر التذكرة والهامش والاحتياط.','error');return false;}
    return commit(async()=>{await api.eventSavePlanV034(eventId,guests,price,fd.get('notes'));await api.eventSavePlannerV034(eventId,margin,waste);},'تم حفظ خطة الحفلة وإعادة حساب التكلفة.');
   }
  });
 }
 function openTable(row=null){
  const editingRow=Boolean(row);
  modal({title:editingRow?`تعديل ${row.table_label}`:'إضافة طاولة إلى المخطط',subtitle:'عدد الضيوف الفعلي يساعدك على معرفة تكلفة الشخص بدقة أثناء الحفلة.',submitText:editingRow?'حفظ الطاولة':'إضافة الطاولة',
   body:`<div class="form-grid"><div class="field full"><label>اسم أو رقم الطاولة</label><input name="label" maxlength="50" value="${esc(row?.table_label||`طاولة ${state.tables.length+1}`)}" required></div>
     <div class="field"><label>سعة الطاولة · عدد الكراسي</label><input name="capacity" type="number" min="1" step="1" max="1000" value="${esc(row?.capacity||4)}" required></div>
     <div class="field"><label>عدد الضيوف المخطط</label><input name="guests" type="number" min="0" step="1" value="${esc(row?.planned_guest_count??4)}" required></div>
     <div class="field full"><label>العدد الفعلي وقت الحفلة (يمكن تركه فارغًا حتى وصول الضيوف)</label><input name="actual" type="number" min="0" step="1" value="${esc(row?.actual_guest_count??'')}" placeholder="أدخل الحضور بعد الوصول"></div></div>
     <div class="notice green">مثال: فتح طاولة إضافية يضيف مباشرة عدد صحون «لكل طاولة» وأطباق «لكل مجموعة أشخاص» المطلوبة لهذه الطاولة.</div>`,
   onSubmit:async fd=>{
    const capacity=Number(fd.get('capacity')),guests=Number(fd.get('guests')),act=fd.get('actual');
    if(!Number.isInteger(capacity)||capacity<1||!Number.isInteger(guests)||guests<0||guests>capacity||act!==''&&(!Number.isInteger(Number(act))||Number(act)>capacity||Number(act)<0)){
     toast('عدد الضيوف الفعلي والمخطط يجب ألا يتجاوز عدد كراسي الطاولة.','error');return false;
    }
    return commit(()=>api.eventSaveTableV034(eventId,{id:row?.id,label:fd.get('label'),capacity,guests,actualGuests:act}),editingRow?'تم تعديل الطاولة وإعادة احتساب حصص الطعام.':'تم فتح طاولة جديدة في الحفلة.');
   }
  });
 }
 function openRule(row=null){
  const existing=Boolean(row),menu=state.menuCosts.filter(x=>x.is_active);
  if(!menu.length){toast('سجّل الأصناف أولًا في قسم الوجبات والوصفات.','error');return;}
  const menuOptions=opts([['','اختر طبقًا من قائمة المطعم'],...menu.map(i=>[i.id,i.name+(i.has_missing_cost?' · ⚠ تكلفة ناقصة':'')])],row?.menu_item_id||'');
  const dlg=modal({title:existing?'تعديل قاعدة تقديم':'إضافة صنف إلى ضيافة الحفلة',subtitle:'استفد من وصفاتك الفعلية بدل كتابة تكلفة الطعام يدويًا.',submitText:existing?'حفظ الصنف':'إضافة الصنف',
   body:`<div class="form-grid"><div class="field full"><label>الصنف</label><select name="item" required>${menuOptions}</select></div>
    <div class="field"><label>طريقة التقديم</label><select name="type">${opts(Object.entries(EVENT_RULE_NAMES_V034),row?.rule_type||'per_person')}</select></div>
    <div class="field"><label>عدد الوحدات لكل تقديم</label><input name="quantity" type="number" step="any" min="0.001" value="${esc(row?.quantity_per_rule||1)}" required></div>
    <div class="field full event-people-field-v034"><label>الصحن الواحد يكفي كم شخصًا داخل الطاولة؟</label><input name="people" type="number" step="1" min="1" value="${esc(row?.people_per_rule||4)}"></div></div>
    <div class="notice green">مثال: «تبولة، كل 4 أشخاص» = جاط واحد لكل مجموعة من أربعة ضيوف في كل طاولة، مع جبر الكسور إلى جاط كامل.</div>`,
   onSubmit:async fd=>{
    if(!fd.get('item')){toast('اختر طبقًا صحيحًا من القائمة.','error');return false;}
    return commit(()=>api.eventSaveRuleV034(eventId,{id:row?.rule_id,menuItemId:fd.get('item'),type:fd.get('type'),quantity:fd.get('quantity'),people:fd.get('people')}),'تم حفظ توزيع الصنف وإعادة حساب كميات الضيافة.');
   }
  });
  const type=dlg.form.elements.namedItem('type'),people=dlg.form.querySelector('.event-people-field-v034');
  const sync=()=>{people.hidden=type.value!=='per_n_people';people.querySelector('input').required=type.value==='per_n_people';};
  type.addEventListener('change',sync);sync();
 }
 function openBooking(table=null){
  const available=state.tables.filter(t=>t.status!=='cancelled'&&!t.booking_id);
  const tableChoices=[['','بدون طاولة حتى الآن'],...available.map(t=>[t.id,`${t.table_label} · ${t.capacity} كراسي`])];
  const dlg=modal({title:'تسجيل حجز حفلة',subtitle:'المبلغ هو إجمالي قيمة الحجز المتفق عليها، وليس سعر التذكرة الواحدة.',submitText:'تثبيت الحجز',
   body:`<div class="form-grid"><div class="field full"><label>اسم صاحب الحجز</label><input name="name" maxlength="150" required></div>
     <div class="field"><label>رقم الهاتف (اختياري)</label><input name="phone" type="tel" maxlength="40"></div>
     <div class="field"><label>الطاولة</label><select name="table">${opts(tableChoices,table?.id||'')}</select></div>
     <div class="field"><label>عدد الأشخاص</label><input name="guests" type="number" min="1" step="1" max="1000" value="${esc(table?.planned_guest_count||1)}" required></div>
     <div class="field"><label>إجمالي قيمة الحجز (${esc(priceCurrency())})</label><input name="amount" type="number" min="0" step="any" value="${esc(num(state.event.default_price_original)*(num(table?.planned_guest_count)||1))}" required></div>
     <div class="field full"><label>ملاحظات الحجز</label><textarea name="note" maxlength="500" rows="2" placeholder="مثال: طاولة قرب المسرح، حساسية غذائية"></textarea></div></div>
     <p class="metric-note">بعد إنشاء الحجز سيظهر رصيده هنا. اضغط تحصيل عندما تستلم المال؛ لا يتم سحب نقد من الصندوق تلقائيًا.</p>`,
   onSubmit:async fd=>commit(()=>api.eventCreateBookingV034(eventId,{tableId:fd.get('table'),name:fd.get('name'),phone:fd.get('phone'),guests:fd.get('guests'),amount:fd.get('amount'),note:fd.get('note')}),'تم حفظ الحجز وإضافته لكشف التحصيل.')
  });
  const guests=dlg.form.elements.namedItem('guests'),amount=dlg.form.elements.namedItem('amount'),tableField=dlg.form.elements.namedItem('table');
  let edited=false;
  amount.addEventListener('input',()=>{edited=true;});
  guests.addEventListener('input',()=>{if(!edited)amount.value=String(num(guests.value)*num(state.event.default_price_original));});
  tableField.addEventListener('change',()=>{const t=state.tables.find(t=>t.id===tableField.value);if(t){guests.value=String(t.planned_guest_count);if(!edited)amount.value=String(num(guests.value)*num(state.event.default_price_original));}});
 }
 function payBooking(booking){
  const r=state.bookingBalances.find(b=>b.booking_id===booking.id),due=num(r?.balance_original),activeBox=box();
  if(!r||due<=0||!activeBox){toast('لا يوجد رصيد مطلوب أو صندوق نشط.','error');return;}
  modal({title:`تحصيل حجز ${booking.customer_name}`,subtitle:'تُسجّل حركة نقدية داخل الصندوق مباشرة عند التأكيد.',submitText:'تأكيد التحصيل',
   body:`<div class="notice rose">المتبقي: <strong>${fmt(due,booking.currency_code)}</strong> · حالة الحجز ${esc(booking.status)}</div>
    <div class="form-grid"><div class="field"><label>المبلغ المطلوب تحصيله (${esc(booking.currency_code)})</label><input name="amount" type="number" min="0.0001" step="any" max="${due}" value="${due}" required></div>
    <div class="field"><label>الصندوق</label><select name="box" required>${withBox()}</select></div></div>`,
   onSubmit:async fd=>{const amt=Number(fd.get('amount'));if(!Number.isFinite(amt)||amt<=0||amt>due+.0001){toast('راجع المبلغ، لا يمكن تحصيل أكثر من المتبقي.','error');return false;}
    return commit(()=>api.eventPayBookingV034(booking.id,fd.get('box'),amt,booking.currency_code),'تم تحصيل الحجز وتسجيل حركة الصندوق.');}
  });
 }
 function openCost(){
  modal({title:'تكلفة متوقعة للحفلة',subtitle:'أنشئ ميزانية للفرقة والتجهيز والنقل وغيرها. لا يتحرك الصندوق الآن.',submitText:'إضافة التكلفة المخططة',
   body:`<div class="form-grid"><div class="field full"><label>البند</label><input name="title" required maxlength="120" placeholder="فرقة موسيقية / معدات صوت / زينة / تنظيف"></div>
    <div class="field"><label>المبلغ المتوقع (${esc(priceCurrency())})</label><input name="amount" type="number" min="0" step="any" required></div>
    <div class="field"><label>اسم الجهة أو المتعهد</label><input name="payee" maxlength="120" placeholder="اختياري"></div>
    <div class="field full"><label>ملاحظات</label><textarea name="note" rows="2" maxlength="500"></textarea></div></div>`,
   onSubmit:async fd=>commit(()=>api.eventAddCostV034(eventId,{title:fd.get('title'),amount:fd.get('amount'),currency:priceCurrency(),payee:fd.get('payee'),note:fd.get('note')}),'تم إدراج التكلفة في الميزانية دون صرف نقدي.')
  });
 }
 function openExpense(cost=null){
  if(!box()){toast('أنشئ صندوقًا نشطًا لتسجيل المصروف الفعلي.','error');return;}
  modal({title:'تسجيل مصروف فعلي للحفلة',subtitle:'سيُخصم المبلغ من الصندوق المختار، ويظهر في التكلفة الفعلية للحفلة.',submitText:'تأكيد الصرف',
   body:`<div class="form-grid"><div class="field full"><label>اسم المصروف</label><input name="title" required maxlength="120" value="${esc(cost?.title||'')}" placeholder="فرقة موسيقية / تجهيزات / تنظيف"></div>
    <div class="field"><label>المبلغ (${esc(priceCurrency())})</label><input name="amount" type="number" min="0.0001" step="any" required></div>
    <div class="field"><label>الصندوق</label><select name="box" required>${withBox()}</select></div>
    <div class="field"><label>الجهة المستلمة</label><input name="payee" maxlength="120" value="${esc(cost?.payee||'')}"></div>
    <div class="field full"><label>ملاحظة / إيصال</label><textarea name="note" maxlength="500" rows="2"></textarea></div></div>
    <div class="notice">تسجيل المصروف هنا يعني أن المال خرج فعليًا. إذا دفعت الفرقة مسبقًا وسجّلتها من صفحة المصروفات، لا تسجّلها مرة ثانية.</div>`,
   onSubmit:async fd=>{if(!(Number(fd.get('amount'))>0)){toast('أدخل مبلغًا موجبًا.','error');return false;}
    return commit(()=>api.eventPayExpenseV034(eventId,{title:fd.get('title'),amount:fd.get('amount'),currency:priceCurrency(),boxId:fd.get('box'),costId:cost?.id,payee:fd.get('payee'),note:fd.get('note')}),'تم تسجيل المصروف في الصندوق والحفلة.');}
  });
 }
 function openExtra(table=null){
  const choices=state.tables.filter(t=>t.status!=='cancelled');if(!choices.length){toast('أضف طاولة أولًا حتى تستطيع إصدار فاتورة عليها.','error');return;}
  const menu=state.menuCosts.filter(m=>m.is_active);
  const dlg=modal({title:'طلب إضافي خارج الباقة',subtitle:'احسب ربح الصنف بدقة: اختر وصفته أو أدخل تكلفة الوحدة يدويًا. الدفعة لا تدخل الصندوق قبل تحصيلها.',submitText:'إضافة إلى حساب الطاولة',
   body:`<div class="form-grid"><div class="field full"><label>الطاولة</label><select name="table" required>${opts(choices.map(t=>[t.id,t.table_label]),table?.id||choices[0].id)}</select></div>
    <div class="field full"><label>الصنف أو الخدمة خارج الباقة</label><input name="description" required maxlength="180" placeholder="مثال: عصير خاص، مشروب إضافي، طلب خارج القائمة"></div>
    <div class="field"><label>الكمية</label><input name="qty" type="number" min="0.001" step="any" value="1" required></div>
    <div class="field"><label>السعر للوحدة (${esc(priceCurrency())})</label><input name="price" type="number" min="0.0001" step="any" required></div>
    <div class="field full"><label>ربط مع وصفة المطعم لحساب التكلفة تلقائيًا (اختياري)</label><select name="menu"><option value="">لا يوجد صنف بالوصفات · تكلفة يدوية</option>${menu.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}${m.has_missing_cost?' · ⚠ تكلفة ناقصة':''}</option>`).join('')}</select></div>
    <div class="field full event-extra-manual-cost-v034"><label>تكلفة الوحدة الفعلية (${esc(baseCurrency())})</label><input name="unitCost" type="number" step="any" min="0" value="0" required><small class="hint">أدخل 0 فقط إذا كان الطلب خدمة بلا تكلفة إضافية؛ لا تترك الطعام بلا تكلفة.</small></div>
    <div class="field full"><label>ملاحظة</label><textarea name="note" rows="2" maxlength="500"></textarea></div></div>
    <div class="notice rose">يظهر الطلب على فاتورة الطاولة «غير مدفوع»، ويُمنع إقفال الحفلة حتى تسديده أو إلغائه.</div>`,
   onSubmit:async fd=>{if(!(Number(fd.get('qty'))>0)||!(Number(fd.get('price'))>0)){toast('أدخل كمية وسعر وحدة موجبين.','error');return false;}
    return commit(()=>api.eventAddExtraV034(eventId,{tableId:fd.get('table'),description:fd.get('description'),quantity:fd.get('qty'),unitPrice:fd.get('price'),menuItemId:fd.get('menu'),unitCost:fd.get('unitCost'),note:fd.get('note')}),'أضيف الطلب إلى فاتورة الطاولة وتكلفة الحفلة، بانتظار التحصيل.');}
  });
  const menuInput=dlg.form.elements.namedItem('menu'),costRow=dlg.form.querySelector('.event-extra-manual-cost-v034');
  const changeMenu=()=>{costRow.hidden=Boolean(menuInput.value);costRow.querySelector('input').required=!menuInput.value;};
  menuInput.addEventListener('change',changeMenu);changeMenu();
 }
 function payExtra(row){
  if(!box()){toast('لا يوجد صندوق نشط للتحصيل.','error');return;}
  modal({title:'تحصيل فاتورة الطاولة',subtitle:'إثبات قبض فعلي للطلب الخارج عن باقة الحفلة.',submitText:'تأكيد القبض النقدي',
   body:`<div class="event-extra-pay-card-v034"><strong>${esc(state.tables.find(t=>t.id===row.table_id)?.table_label||'طاولة')}</strong><span>${esc(row.description)} · ${esc(row.quantity)} × ${moneyTicket(row.unit_price_original)}</span><div class="metric-value">${moneyTicket(row.amount_original)}</div></div>
    <div class="field"><label>صندوق التحصيل</label><select name="box" required>${withBox()}</select></div>
    <p class="metric-note">لا تضغط مجددًا إذا انقطع الاتصال بعد التأكيد؛ حدّث السجل أولًا للتحقق من الحركة.</p>`,
   onSubmit:async fd=>commit(()=>api.eventPayExtraV034(row.id,fd.get('box')),'تم تحصيل الفاتورة وإضافتها إلى حركة الصندوق.')
  });
 }
 function openWaste(){
  modal({title:'تسجيل هدر إضافي',subtitle:'يسجّل التكلفة على الحفلة فقط؛ لا يصرف نقدًا ولا يكرر حركة المخزون.',submitText:'تسجيل الهدر',
   body:`<div class="form-grid"><div class="field full"><label>ما الذي هُدر؟</label><input name="description" required maxlength="180" placeholder="مثال: صحن مكسور، خسارة غير محتسبة"></div>
    <div class="field"><label>الكمية</label><input name="quantity" type="number" min="0.001" step="any" value="1" required></div>
    <div class="field"><label>تكلفة الوحدة (${esc(baseCurrency())})</label><input name="cost" type="number" min="0" step="any" required></div>
    <div class="field full"><label>السبب</label><textarea name="reason" rows="2" maxlength="500" placeholder="مثال: تلف أثناء النقل"></textarea></div></div>
    <div class="notice">إذا أدرجت تكلفة هذا الهدر سابقًا داخل الطعام المستهلك أو المصروفات أو جرد المخزون المحمّل على الحفلة، لا تضف المبلغ مرة أخرى حتى لا تُضاعف الخسارة.</div>`,
   onSubmit:async fd=>commit(()=>api.eventAddWasteV034(eventId,{description:fd.get('description'),quantity:fd.get('quantity'),unitCost:fd.get('cost'),reason:fd.get('reason')}),'تم تسجيل الهدر على تكلفة الحفلة.')
  });
 }
 function reasonModal(title,fn){
  modal({title,submitText:'تأكيد الإجراء',body:`<div class="field"><label>سبب العملية</label><textarea name="reason" rows="3" minlength="3" maxlength="500" required placeholder="اكتب سببًا واضحًا للرجوع إليه لاحقًا"></textarea></div>`,
   onSubmit:async fd=>commit(()=>fn(fd.get('reason')),'تم حفظ الإجراء وسببه في السجل.')
  });
 }
 function finishEvent(){
  const q=quote(),a=actual();
  modal({title:'الإقفال المالي للحفلة',subtitle:'الإقفال يثبت تكلفة الطعام في السجل التاريخي ويُرحّل استهلاكه للمخزون. لا يمكن تنفيذ الإقفال مرتين.',submitText:'تأكيد إقفال الحفلة',
   body:`<div class="event-final-review-v034">
    <div><span>الضيوف</span><strong>${a.guests}</strong></div><div><span>فواتير خارج الباقة غير مدفوعة</span><strong>${moneyTicket(a.extraDue)}</strong></div>
    <div><span>رصيد الحجوزات المطلوب</span><strong>${esc(state.bookingBalances.filter(b=>num(b.balance_original)>0).length)} حجوزات</strong></div>
    <div><span>وصفات ناقصة التكلفة</span><strong>${q.missing}</strong></div></div>
    <div class="notice">قبل الإقفال، سجّل الحضور الفعلي في الطاولات، وأكمل الوصفات وحصّل جميع الفواتير. بعد الإقفال ستكون تكلفة الطعام تاريخية بدل أسعار اليوم المتغيرة.</div>
    <div class="field"><label>ملاحظة ختامية (اختياري)</label><textarea name="note" rows="2" maxlength="500" placeholder="أهم ما جرى خلال الحفلة"></textarea></div>`,
   onSubmit:async fd=>commit(()=>api.eventCompleteV034(eventId,fd.get('note')),'تم إقفال الحفلة وترحيل الطعام. اطلع على التقرير الختامي.')
  });
 }
 const emit=(sel,fn)=>root.querySelectorAll(sel).forEach(el=>el.addEventListener('click',()=>fn(el)));
 function attachActions(){
  emit('[data-nav]',el=>{tab=el.dataset.nav;paint();});
  emit('[data-tab-switch]',el=>{tab=el.dataset.tabSwitch;paint();});
  emit('[data-action="open-plan"]',openPlan);
  emit('[data-action="add-table"]',()=>openTable());
  emit('[data-table-edit]',el=>openTable(state.tables.find(x=>String(x.id)===el.dataset.tableEdit)));
  emit('[data-table-book]',el=>openBooking(state.tables.find(x=>String(x.id)===el.dataset.tableBook)));
  emit('[data-table-extra]',el=>openExtra(state.tables.find(x=>String(x.id)===el.dataset.tableExtra)));
  emit('[data-table-invoice]',el=>tableInvoice(state.tables.find(x=>String(x.id)===el.dataset.tableInvoice)));
  emit('[data-action="add-activity"]',openActivity);
  emit('[data-action="add-booking"]',()=>openBooking());
  emit('[data-book-pay]',el=>{const x=state.bookings.find(x=>String(x.id)===el.dataset.bookPay);if(x)payBooking(x);});
  emit('[data-action="add-rule"]',()=>openRule());
  emit('[data-rule-edit]',el=>openRule(state.requirements.find(x=>String(x.rule_id)===el.dataset.ruleEdit)));
  emit('[data-rule-delete]',async el=>{if(await confirmBox('حذف هذه القاعدة يغيّر تكلفة الطعام وكميات الضيافة على كل الطاولات.','حذف القاعدة'))
    await commit(()=>api.eventDeleteRuleV034(eventId,el.dataset.ruleDelete),'حُذفت قاعدة التقديم وأُعيد احتساب الضيافة.');});
  emit('[data-action="add-cost"]',openCost);
  emit('[data-action="add-expense"]',()=>openExpense());
  emit('[data-expense-for]',el=>openExpense(state.costs.find(x=>String(x.id)===el.dataset.expenseFor)));
  emit('[data-action="add-extra"]',()=>openExtra());
  emit('[data-extra-pay]',el=>{const x=state.extras.find(x=>String(x.id)===el.dataset.extraPay);if(x)payExtra(x);});
  emit('[data-extra-void]',el=>reasonModal('إلغاء طلب غير مدفوع',why=>api.eventVoidExtraV034(el.dataset.extraVoid,why)));
  emit('[data-extra-refund]',el=>reasonModal('إعادة مبلغ إلى ضيف',why=>api.eventRefundExtraV034(el.dataset.extraRefund,why)));
  emit('[data-action="add-waste"]',openWaste);
  emit('[data-waste-void]',el=>reasonModal('إلغاء سجل هدر',why=>api.eventVoidWasteV034(el.dataset.wasteVoid,why)));
  emit('[data-action="finish-event"]',finishEvent);
  const menuTable=root.querySelector('.event-menu-table-v034');
  if(menuTable)registerTableExport(menuTable,()=>({title:`قائمة ضيافة ${state.event.name}`,
   headers:['الصنف','طريقة التقديم','كمية التقديم','المطلوب','تكلفة الحصة (الأساس)','إجمالي الطعام (الأساس)'],
   rows:state.requirements.map(r=>[r.menu_item_name,EVENT_RULE_NAMES_V034[r.rule_type],r.quantity_per_rule,r.required_quantity,r.unit_food_cost_base??'تكلفة غير مكتملة',r.estimated_food_cost_base??'تكلفة غير مكتملة'])}));
  const bookingTable=root.querySelector('.event-booking-table-v034');
  if(bookingTable)registerTableExport(bookingTable,()=>({title:`حجوزات ${state.event.name}`,
   headers:['الاسم','الهاتف','عدد الأشخاص','الطاولة','المتفق عليه','المدفوع','المتبقي','العملة'],
   rows:state.bookings.map(b=>{const ba=state.bookingBalances.find(z=>z.booking_id===b.id)||{};return [b.customer_name,b.customer_phone||'',b.guest_count,state.tables.find(t=>t.booking_id===b.id)?.table_label||'',b.agreed_amount_original,ba.paid_original||0,ba.balance_original||0,b.currency_code];})}));
  const extraTable=root.querySelector('.event-extra-table-v034');
  if(extraTable)registerTableExport(extraTable,()=>({title:`فواتير الطاولات ${state.event.name}`,
   headers:['الطاولة','الوصف','الكمية','سعر الوحدة','الإجمالي','التكلفة الإجمالية (الأساس)','العملة','الحالة','الملاحظات'],
   rows:state.extras.map(x=>[state.tables.find(t=>t.id===x.table_id)?.table_label||'',x.description,x.quantity,x.unit_price_original,x.amount_original,x.total_cost_base,x.currency_code,statusLabel[x.status]||x.status,x.notes||''])}));
  const reportTable=root.querySelector('.event-report-table-v034');
  if(reportTable){const q=quote(),a=actual();registerTableExport(reportTable,()=>({title:`تقرير حفلة ${state.event.name} · ${state.event.status==='completed'?'مقفلة':'مبدئي'}`,
    headers:['البند','المخطط (الأساس)','الفعلي/المسجل (الأساس)','الملاحظات'],
    rows:[['الطعام',q.food,state.summary.included_food_cost_base||state.summary.estimated_actual_included_food_cost_base||0,q.missing?'التكلفة غير مكتملة':''],
    ['المصاريف والموسيقى',q.others,state.summary.actual_other_expense_base||0,''],
    ['العمالة',q.labor,state.summary.actual_labor_cost_base||0,''],
    ['تكلفة إضافات الطاولات',0,a.extraCost,'تُحسب حتى قبل تحصيلها'],
    ['احتياط / هدر',q.reserve,a.wasteCost,'الهدر غير المكرر فقط'],
    ['إجمالي التكاليف',q.total,a.cost,a.incomplete?'تقديري':''],['الإيراد',q.revenue,a.revenue,'حجوزات وأوردرات وإضافات مدفوعة'],
    ['مدفوع من إضافات الطاولات',0,a.extraCollected,'من الصندوق'],['مستحق من إضافات الطاولات',0,a.extraDue,'بعملة التذكرة'],
    ['الربح/الخسارة',q.profit,a.profit,state.event.status==='completed'?'مقفل':'مبدئي']]}));}
 }
 await reload();
}
