import * as api from '../api.js?v=0.37';
import {modal,toast,loader,friendlyError,confirmBox} from '../ui.js?v=0.33';
import {esc,money,dateOnly,todayISO} from '../utils.js?v=0.27';
import {registerTableExport} from '../table-export-v027.js?v=0.33';
import {EVENT_RULE_NAMES_V034,eventCostQuoteV034,eventActualResultV034} from '../event-cost-v034.js?v=0.34';
import {proposeEventAllocationV035} from '../event-seating-v035.js?v=0.35';
import {menuEquivalentV036,portionPreviewV036,conversionHintsV036,SERVING_RULE_NAMES_V036} from '../portion-servings-v036.js?v=0.36';
import {validateQuickServingV037,quickServingChoiceV037} from '../event-unit-quick-v037.js?v=0.37';
import {conversionChoices,relationBaseFromAmount} from '../unit-display-conversion.js?v=0.27';
import {hospitalityGroupsV037} from '../event-groups-v037.js?v=0.37';

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
 EVENT_BULK_INVALID:'تأكد من عدد الطاولات والكراسي.',
 EVENT_SERVING_AMOUNT_INVALID:'أدخل عدد الحصص في التقديم وعدد الحصص الناتجة من وجبة المنيو بشكل صحيح.',
 EVENT_PORTION_PRECISION:'هذه الكمية أصغر من دقة النظام (0.0001 وجبة) أو غير قابلة للتمثيل بدقة كافية. غيّر التحويل.',
 EVENT_SERVING_UNIT_INVALID:'وحدة التقديم المختارة غير متاحة. حدّد وحدة أخرى.',
 EVENT_PLATE_COMPONENT_INVALID:'تحقق من مجموعة الضيافة وطريقة تقديم المكون.',
 EVENT_PLATE_NOT_FOUND:'مجموعة الضيافة غير موجودة. حدّث الصفحة.',
 EVENT_PLATE_NAME_INVALID:'اكتب اسمًا واضحًا للصحن الرئيسي.',
 EVENT_GROUP_NAME_INVALID:'اكتب اسمًا للمجموعة من حرفين إلى 100 حرف.',
 EVENT_GROUP_NOT_FOUND:'هذه المجموعة غير موجودة أو لا تتبع الحفلة.',
 EVENT_SERVING_CONVERSION_DUPLICATE:'هذه الحصة معرفة مسبقًا لهذا الصنف؛ اخترها من القائمة.',
 EVENT_SERVING_LABEL_INVALID:'اكتب اسمًا واضحًا للحصة الجديدة.',
 EVENT_MATERIAL_RELATION_INCOMPLETE:'اختر المادة ومقدار التحويل معًا، أو اترك ربط المخزون فارغًا.',
 EVENT_MATERIAL_NOT_IN_RECIPE:'هذه المادة ليست جزءًا من وصفة الصنف المختار.',
 EVENT_GROUP_COUNT_MISMATCH:'عدد المقاعد الموزعة لا يطابق عدد الضيوف.',
 EVENT_GROUP_TABLE_DUPLICATE:'لا يمكن وضع الطاولة نفسها مرتين في حجز واحد.',
 EVENT_GROUP_BOOKING_INVALID:'راجع بيانات الحجز وعدد الأشخاص.',
 EVENT_TABLES_ALREADY_EXIST:'الطاولات جاهزة بالفعل. اختر رقم بداية مختلفًا لإضافة مجموعة.',
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
 if(s.includes('save_event_group_v037')||s.includes('create_event_serving_unit_v037')||s.includes('save_event_group_serving_v037')||s.includes('event_groups_v037'))return 'شغّل SQL v0.37 في Supabase أولًا ثم حدّث الصفحة.';
 if(s.includes('event_serving_rules_v036')||s.includes('event_main_plates_v036')||s.includes('menu_serving_conversions_v036')||s.includes('save_event_serving_v036')||s.includes('save_event_main_plate_v036'))return 'شغّل تحديث SQL v0.36 في Supabase ثم حدّث الصفحة لتفعيل حصص الضيافة والصحن الرئيسي.';
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
    <div class="field"><label>عدد الطاولات</label><input type="number" name="tableCount" min="1" max="200" value="10" required></div><div class="field"><label>كراسي كل طاولة</label><input type="number" name="seatsPerTable" min="1" max="100" value="8" required></div><div class="field full"><label>مصدر الإيراد</label><select name="mode"><option value="bookings">تذاكر وحجوزات</option><option value="both">حجوزات وأوردرات منفصلة</option><option value="orders">أوردرات فقط</option></select></div></div>`,
   onSubmit:async fd=>{try{const result=await api.createEvent({name:fd.get('name'),date:fd.get('date'),type:fd.get('type'),guests:fd.get('guests'),currency:fd.get('currency'),revenueMode:fd.get('mode')});
    try{await api.eventBulkTablesV035(result,fd.get('tableCount'),fd.get('seatsPerTable'));toast('تم إنشاء الحفلة وجميع طاولاتها دفعة واحدة.','success');location.hash=`#/event/${result}`;return true;}catch(setupError){toast('تم إنشاء الحفلة لكن تعذّر تجهيز الطاولات: '+toError(setupError),'error');location.hash=`#/event/${result}`;return true;}
   }catch(e){toast(toError(e),'error');return false;}}
  });
 }catch(e){root.innerHTML=`<div class="notice">${esc(toError(e))}</div>`;}
}

export async function renderEventDetailV034(root,eventId){
 let tab='tables',state=null,busy=false;
 root.innerHTML=loader();
 const reload=async()=>{
  if(busy)return;busy=true;root.innerHTML=loader();
  try{
   const [event,tables,rules,requirements,tableMenu,menuCosts,costs,costCompare,labor,summary,bookings,bookingBalances,extras,waste,boxes,expenses,planner,settings,activity,guests,eventGroups,servingRules,servingConversions,menuSaleUnits]=await Promise.all([
    api.eventV034(eventId),api.eventTablesV034(eventId),api.eventMenuRulesV034(eventId),
    api.eventMenuRequirementsV034(eventId),api.eventTableMenuV034(eventId),api.menuCostsV034(),
    api.eventCostItemsV034(eventId),api.eventCostComparisonV034(eventId),api.eventLaborV034(eventId),
    api.eventSummaryV034(eventId),api.eventBookings(eventId),api.eventBookingBalancesV034(eventId),
    api.eventExtrasV034(eventId),api.eventWasteV034(eventId),api.cashboxes(),
    api.eventExpenseEntriesV034(eventId),api.eventPlannerV034(eventId),api.payrollSettings(),api.eventActivityV034(eventId),api.eventGuestsV035(eventId),
    api.eventGroupsV037(eventId),api.eventServingRulesV036(eventId),api.menuServingConversionsV036(),api.eventMenuSaleUnitsV036(),
   ]);
   if(!event)throw Error('EVENT_NOT_FOUND');
   state={event,tables,rules,requirements,tableMenu,menuCosts,costs,costCompare,labor,summary:summary||{},bookings,bookingBalances,
    extras,waste,boxes,expenses,planner,settings,activity,guests,eventGroups,servingRules,servingConversions,menuSaleUnits};
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
 const tabNames=[['tables','① تجهيز الطاولات'],['menu','② مكونات الضيافة'],['costs','③ التكاليف العامة'],['bookings','④ الحجوزات'],['extras','⑤ فواتير وهدر'],['report','⑥ التقرير المالي'],['activity','سجل الحفلة'],['overview','نظرة عامة']];
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
  if(tab==='bookings')return bookingsHtml();
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
  return `<div class="grid cols-2 event-dashboard-panels-v034"><section class="card"><div class="finance-section-head"><div><h3>تحليل ميزانية الحفلة</h3><p>تفصيل تكلفة الضيافة والفرقة والمصاريف والاحتياط قبل بدء الحفلة.</p></div>${editing()?'<button class="event-ctrl-v036 subtle" data-action="open-plan">⚙ ضبط السعر والهامش</button>':''}</div>
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
  const assigned=active.reduce((sum,t)=>sum+(t.booking_id?num(t.planned_guest_count):0),0);
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>مخطط الطاولات والمقاعد</h3><p>افتح طاولة جديدة أو غيّر عدد ضيوفها، فتتغير كميات الصحون المشتركة وتكلفة الحفلة.</p></div>${!readOnly?'<button class="btn" data-action="add-bulk">+ إنشاء طاولات دفعة واحدة</button><button class="btn secondary" data-action="add-table">+ طاولة منفردة</button>':''}</div>
   <div class="event-table-stats-v034"><span>🪑 الطاقة الكلية: <strong>${activeSeats}</strong> كرسي</span><span>👥 المحجوز: <strong>${assigned}</strong> ضيف</span><span>🍽 تكلفة الطعام لكل شخص: <strong>${q.count?moneyBase(q.food/q.count):'—'}</strong></span></div>
   ${active.length?`<div class="event-seat-map-v034">${active.map(t=>{
    const f=tableFoodCost(t),occupancy=t.booking_id?num(t.planned_guest_count):0,capacity=num(t.capacity),due=state.extras.filter(x=>String(x.table_id)===String(t.id)&&x.status==='pending').reduce((a,x)=>a+num(x.amount_original),0);
    const count=Math.min(18,capacity),seats=Array.from({length:count},(_,i)=>`<span class="${i<occupancy?'filled':'empty-seat'}" title="${i<occupancy?'مقعد مستخدم':'مقعد شاغر'}">●</span>`).join('');
    return `<article class="event-table-card-v034 ${due?'has-due':''}">
     <div class="event-table-card-title-v034"><div><strong>${esc(t.table_label)}</strong><small>${esc(statusLabel[t.status]||t.status||'طاولة')}</small></div><button type="button" class="mini-btn event-action-v035" data-table-edit="${esc(t.id)}" ${readOnly?'disabled':''}>تعديل</button></div>
     <div class="event-table-illustration-v034"><div class="event-table-disc-v034">${esc(occupancy)} / ${esc(capacity)}</div><div class="event-seat-dots-v034">${seats}</div><small>مخطط للضيافة: ${esc(t.planned_guest_count||0)} ضيف</small></div>
     <div class="event-table-numbers-v034"><span>تكلفة طعام الطاولة</span><strong>${moneyBase(f.cost)} ${f.missing?'⚠':''}</strong></div>
     <div class="event-table-numbers-v034"><span>طعام لكل ضيف</span><strong>${occupancy?moneyBase(f.cost/occupancy):'—'}</strong></div>
     <div class="event-table-numbers-v034"><span>فاتورة خارج الباقة</span><strong class="${due?'payroll-danger-v034':''}">${moneyTicket(due)}</strong></div>
     <div class="event-table-actions-v034">${!readOnly?`<button class="mini-btn event-action-v035 primary" data-table-book="${esc(t.id)}" ${t.booking_id?'disabled':''}>${t.booking_id?'محجوزة':'حجز'}</button><button class="mini-btn event-action-v035 accent" data-table-extra="${esc(t.id)}">+ طلب إضافي</button>`:''}<button class="mini-btn event-action-v035" data-table-invoice="${esc(t.id)}">كشف الطاولة ↗</button><button class="mini-btn event-action-v035" data-tab-switch="extras">الفواتير</button></div>
    </article>`;
   }).join('')}</div>`:empty('أضف أول طاولة لتظهر خريطة المقاعد.')}
   <p class="metric-note">تكلفة طعام الطاولة تعتمد على حصصها فقط؛ الفرقة والمصاريف العامة تُوزع عند حساب إجمالي تكلفة الشخص. يظهر تحذير عند فقد وصفة أو سعر مادة.</p></section>`;
 }
 function bookingsHtml(){
  const readOnly=!editing();
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>الحجوزات وتوزيع الأسماء</h3><p>حجز واحد لشخص أو مجموعة، وتوزيعه على طاولة أو طاولتين متجاورتين عند الحاجة.</p></div>${!readOnly?'<button class="btn" data-action="add-booking">+ حجز جديد</button>':''}</div>
<p class="metric-note">الحجز يثبت إيرادًا متوقعًا فقط؛ لا يظهر نقد في الصندوق حتى تضغط «تحصيل».</p>
  ${state.bookings.length?`<div class="table-wrap"><table class="table event-booking-table-v034"><thead><tr><th>الحجز</th><th>عدد الأشخاص</th><th>الطاولة</th><th>القيمة المتفق عليها</th><th>المقبوض</th><th>المتبقي</th><th>الحالة</th><th>تحصيل</th></tr></thead><tbody>
   ${state.bookings.map(b=>{const balance=state.bookingBalances.find(x=>x.booking_id===b.id)||{},assignedTables=state.tables.filter(t=>t.booking_id===b.id),due=num(balance.balance_original);
    return `<tr><td><strong>${esc(b.customer_name)}</strong><small>${esc(b.customer_phone||'—')}</small><small>${esc(state.guests.filter(g=>g.booking_id===b.id).map(g=>g.guest_name).join('، ')||'حجز قديم دون أسماء مفصلة')}</small></td><td>${esc(b.guest_count)}</td><td>${esc(assignedTables.map(t=>t.table_label).join(' + ')||'بدون طاولة')}</td>
    <td>${fmt(b.agreed_amount_original,b.currency_code)}</td><td>${fmt(balance.paid_original||0,b.currency_code)}</td><td><strong class="${due>0?'payroll-danger-v034':''}">${fmt(due,b.currency_code)}</strong></td><td>${esc(b.status||'حجز')}</td><td><button class="mini-btn" data-book-pay="${esc(b.id)}" ${!editing()||due<=0?'disabled':''}>تحصيل</button></td></tr>`;
   }).join('')}</tbody></table></div>`:empty('لا توجد حجوزات مسجلة. يمكن تسجيل حجز لطاولة واحدة أو لمجموعة.')}</section>`;
 }
 function menuHtml(){
  const q=quote();
  const metas=new Map(state.servingRules.map(m=>[String(m.rule_id),m]));
  const grouping=hospitalityGroupsV037({groups:state.eventGroups,servingRules:state.servingRules,
   requirements:state.requirements,guests:state.event.planned_guest_count});
  const rowsForGroup=id=>grouping.groups.find(x=>String(x.group.id)===String(id))?.rows||[];
  const regular=grouping.independent.rows;
  const lineTable=(rows,css,groupId='')=>rows.length?`<div class="table-wrap"><table class="table event-menu-table-v034 ${css}" data-group-id="${esc(groupId)}"><thead><tr>
    <th>الصنف من قائمة المطعم</th><th>طريقة التقديم</th><th>كم نقدّم؟</th><th>إجمالي وجبات المنيو اللازمة</th><th>تكلفة هذا الصنف</th><th>إجراء</th>
   </tr></thead><tbody>${rows.map(r=>{
    const meta=metas.get(String(r.rule_id));
    const method=r.rule_type==='per_n_people'?`كل ${esc(r.people_per_rule)} أشخاص على الطاولة`:(SERVING_RULE_NAMES_V036[r.rule_type]||r.rule_type);
    const serving=meta?`${esc(meta.servings_per_distribution)} ${esc(meta.serving_label)}`:`${esc(r.quantity_per_rule)} من صنف المنيو`;
    const ratio=meta&&Number(meta.servings_per_menu_item)!==1?`<small>كل ${esc(meta.servings_per_menu_item)} ${esc(meta.serving_label)} = وجبة من المنيو</small>`:'';
    const missing=r.has_missing_cost||r.unit_food_cost_base==null;
    return `<tr class="${missing?'event-menu-incomplete-v036':''}"><td><strong>${esc(r.menu_item_name)}</strong>${missing?'<small>⚠ وصفة أو سعر تكلفة ناقص</small>':''}</td>
    <td>${method}</td><td><strong>${serving}</strong>${ratio}</td>
    <td><strong>${esc(r.required_quantity)}</strong><small>بوحدة صنف المنيو الأصلية</small></td>
    <td>${missing?'<span class="event-cost-missing-v036">⚠ غير مكتملة</span>':`<strong>${moneyBase(r.estimated_food_cost_base)}</strong>`}</td>
    <td>${editing()?`<div class="event-row-actions-v036"><button type="button" class="event-ctrl-v036 subtle" data-rule-edit="${esc(r.rule_id)}">✎ تعديل</button><button type="button" class="event-ctrl-v036 danger" data-rule-delete="${esc(r.rule_id)}">حذف</button></div>`:'—'}</td></tr>`;
   }).join('')}</tbody></table></div>`:empty('هذه المجموعة فارغة. أضف أول صنف إليها.');
  const renderGroup=group=>{
   const rows=rowsForGroup(group.id);
   const stats=grouping.groups.find(x=>String(x.group.id)===String(group.id));
   const missing=Boolean(stats?.missing);
   const groupTotal=stats?.cost||0;
   const avgPerGuest=stats?.averagePerGuest??null;
   return `<div class="event-main-plate-v036 event-named-group-v037" data-group-card="${esc(group.id)}"><div class="event-main-plate-head-v036"><div><div class="event-kicker-v036">🍽 مجموعة ضيافة</div><h3>${esc(group.name)}</h3><p>${rows.length} مكوّن · حصص مرنة لكل ضيف أو طاولة أو مجموعة ضيوف. كل التكلفة محسوبة من الأصناف الأصلية.</p></div>
   ${editing()?`<div class="event-main-actions-v036"><button type="button" class="event-ctrl-v036 primary" data-group-add="${esc(group.id)}">＋ إضافة مكوّن</button><button type="button" class="event-ctrl-v036 subtle" data-group-edit="${esc(group.id)}">✎ تعديل الاسم</button><button type="button" class="event-ctrl-v036 danger" data-group-delete="${esc(group.id)}">حذف المجموعة</button></div>`:''}</div>
   ${lineTable(rows,'event-group-lines-v037',group.id)}
   <div class="event-plate-summary-v036"><span>إجمالي تكلفة «${esc(group.name)}» للحفلة</span><strong>${missing?'⚠ تكلفة غير مكتملة':moneyBase(groupTotal)}</strong><span>متوسطها لكل ضيف مخطط</span><strong>${missing||avgPerGuest==null?'—':moneyBase(avgPerGuest)}</strong></div></div>`;
  };
  return `<section class="card finance-section event-host-v036"><div class="finance-section-head event-menu-heading-v036"><div><h3>مجموعات الضيافة ومكوناتها</h3><p>أنشئ مجموعات بالاسم الذي تريده: الصحن الرئيسي، المقبلات، الحلويات، الضيافة الخاصة… ثم أضف أصناف كل مجموعة.</p></div>
   ${editing()?'<div class="event-main-actions-v036"><button type="button" class="event-ctrl-v036 primary" data-action="add-event-group">＋ إنشاء مجموعة</button><button type="button" class="event-ctrl-v036 subtle" data-action="add-rule">＋ صنف مستقل</button></div>':''}</div>
   <div class="event-guide-v036"><div><span class="event-guide-icon-v036">①</span><strong>أنشئ مجموعة</strong><small>مثلاً المقبلات أو الصحن الرئيسي</small></div><div><span class="event-guide-icon-v036">②</span><strong>أضف الأصناف وحصصها</strong><small>قطعة لكل ضيف أو جاط لكل أربعة</small></div><div><span class="event-guide-icon-v036">③</span><strong>اعرف تكلفة كل مجموعة</strong><small>والتكلفة الإجمالية للحفلة</small></div></div>
   ${q.missing?`<div class="notice">⚠ هناك ${q.missing} صنف من دون تكلفة وصفة مكتملة؛ لا تعتمد على الربح حتى تستكمل الوصفات وأسعار المواد.</div>`:''}
   ${state.eventGroups.length?state.eventGroups.map(renderGroup).join(''):`<div class="event-main-plate-v036 event-empty-group-v037"><strong>لا توجد مجموعات ضيافة بعد.</strong><p>ابدأ بمجموعة «الصحن الرئيسي»، «المقبلات» أو أي مجموعة تناسب حفلتك. يمكنك إنشاء العدد الذي تحتاجه.</p>${editing()?'<button type="button" class="event-ctrl-v036 primary" data-action="add-event-group">＋ إنشاء أول مجموعة</button>':''}</div>`}
   <div class="event-regular-menu-v036"><div class="event-menu-subhead-v036"><h3>أصناف مستقلة خارج المجموعات</h3><small>يمكنك ترك بعض الأصناف مستقلة، مثل مشروبات أو جاطات خاصة</small></div>${lineTable(regular,'event-extra-lines-v036')}</div>
   <div class="event-footnote-v034">مثال: «2 سيخ لكل ضيف» مع «10 أسياخ في كيلو المنيو» تعني 0.2 من وجبة الكيلو للشخص. مجموعات الضيافة ليست وصفات مكررة: كل صنف يحسب مرة واحدة وفق قاعدة تقديمه. متوسط تكلفة المجموعة هو إجمالي تكلفتها ÷ عدد الضيوف المتوقع.</div>
   <div class="event-total-line-v034"><span>إجمالي تكلفة الضيافة المخططة (كل المجموعات + الأصناف المستقلة)</span><strong>${q.missing?'⚠ تكلفة غير مكتملة':moneyBase(q.food)}</strong></div></section>`;
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
   <section class="card finance-section"><h3>إحصاءات الحجوزات والمقاعد</h3>
    <div class="grid cols-4 event-final-kpis-v034">
    <div class="card"><div class="metric-label">عدد الحجوزات</div><div class="metric-value">${state.bookings.filter(b=>!['cancelled','no_show'].includes(b.status)).length}</div></div>
    <div class="card"><div class="metric-label">مقاعد محجوزة</div><div class="metric-value">${state.tables.filter(t=>t.booking_id).reduce((v,t)=>v+num(t.planned_guest_count),0)} / ${state.tables.filter(t=>t.status!=='cancelled').reduce((v,t)=>v+num(t.capacity),0)}</div></div>
    <div class="card"><div class="metric-label">محصّل من الحجوزات (${esc(priceCurrency())})</div><div class="metric-value">${moneyTicket(state.bookingBalances.filter(b=>!['cancelled','no_show'].includes(b.booking_status)).reduce((v,b)=>v+num(b.paid_original),0))}</div></div>
    <div class="card"><div class="metric-label">متبقٍ من الحجوزات (${esc(priceCurrency())})</div><div class="metric-value ${a.bookingDue>0?'payroll-danger-v034':''}">${moneyTicket(a.bookingDue)}</div></div></div>
    <p class="metric-note">هذه مبالغ قبض الحجوزات بعملة الحفلة، وليست نفس رقم الإيراد المكتسب بعملة الأساس. الفواتير الإضافية والهدر والمصاريف تظهر أيضًا في أقسامها وفي مقارنة الميزانية.</p>
    <div class="event-today-actions-v034"><button class="btn secondary" data-nav="bookings">الحجوزات والأسماء ←</button><button class="btn secondary" data-nav="extras">الفواتير والهدر ←</button><button class="btn secondary" data-nav="costs">المصاريف والفرقة ←</button></div>
   </section>
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
 function openBulkTables(){
  const active=state.tables.filter(t=>t.status!=='cancelled');
  modal({title:'تجهيز هيكل الحفلة دفعة واحدة',subtitle:'حدّد عدد الطاولات والكراسي لكل طاولة؛ ستظهر جميعها في المخطط فور الحفظ.',submitText:'إنشاء الطاولات',
   body:`<div class="form-grid"><div class="field"><label>عدد الطاولات</label><input name="count" type="number" min="1" max="200" value="10" required></div><div class="field"><label>الكراسي في كل طاولة</label><input name="capacity" type="number" min="1" max="100" value="8" required></div><div class="field"><label>بادئة اسم الطاولة</label><input name="prefix" maxlength="30" value="طاولة" required></div><div class="field"><label>رقم أول طاولة</label><input name="start" type="number" min="1" max="10000" value="${active.length?Math.max(...active.map(t=>Number((t.table_label||'').match(/\d+$/)?.[0])||0))+1:1}" required></div></div><div class="notice green">تُضاف جميع الطاولات في عملية واحدة. لا تُنشأ حجوزات أو فواتير، ويمكن تعديل كل طاولة لاحقًا.</div>`,
   onSubmit:async fd=>{const n=Number(fd.get('count')),cap=Number(fd.get('capacity')),start=Number(fd.get('start'));if(!Number.isInteger(n)||n<1||n>200||!Number.isInteger(cap)||cap<1||cap>100||!Number.isInteger(start)||start<1){toast('راجع عدد الطاولات والكراسي والرقم الأول.','error');return false;}return commit(()=>api.eventBulkTablesV035(eventId,n,cap,fd.get('prefix'),start),'تم تجهيز مخطط الحفلة بالكامل.');}
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
 function openEventGroup(group=null){
  const isNew=!group;
  modal({title:isNew?'إنشاء مجموعة ضيافة':'تعديل اسم المجموعة',
   subtitle:'مثال: الصحن الرئيسي، المقبلات، الحلويات أو أي ترتيب يناسب الحفلة. يمكنك إضافة مجموعات متعددة بحسب حاجتك.',
   submitText:isNew?'إنشاء المجموعة':'حفظ الاسم',
   body:`<div class="field"><label>اسم مجموعة الضيافة</label><input name="name" required maxlength="100" value="${esc(group?.name||'')}" placeholder="مثال: المقبلات"></div>
    <div class="notice green">المجموعة للتنظيم فقط: الأصناف والحصص في داخلها تبقى مرتبطة بوصفات المنيو وتكاليفها، ولن تتكرر محاسبيًا.</div>`,
   onSubmit:async fd=>{
    let savedId=null;
    const ok=await commit(async()=>{savedId=await api.eventSaveGroupV037(eventId,group?.id||null,String(fd.get('name')||'').trim());},
     isNew?'تم إنشاء المجموعة، ويمكن إضافة الأصناف إليها.':'تم تحديث اسم المجموعة.');
    if(ok&&isNew&&savedId)setTimeout(()=>openRule(null,savedId),0);
    return ok;
   }
  });
 }
 async function openRule(row=null,requestedPlateId=null){
  const editingRule=Boolean(row);
  const menu=state.menuCosts.filter(x=>x.is_active);
  if(!menu.length){toast('أضف صنفًا إلى قائمة المطعم أولًا.','error');return;}
  const previous=state.servingRules.find(m=>String(m.rule_id)===String(row?.rule_id||''));
  const plateId=requestedPlateId??previous?.main_plate_id??null;
  const isPlate=Boolean(plateId);
  const currentGroup=state.eventGroups.find(g=>String(g.id)===String(plateId));
  let units=[],conversions=[],recipeLines=[],materials=[],materialLinks=[];
  try{[units,conversions,materials,materialLinks]=await Promise.all([
   api.units(),api.unitConversions(),api.catalogMaterials(),api.allMaterialUnitLinks(),
  ]);}catch(e){toast('تعذّر قراءة وحدات المطعم وتحويلاتها: '+toError(e),'error');return;}
  // Existing named units are listed once; the current menu item's conversion can
  // be saved once and reused for all future events.
  const menuOptions=opts([['','ابحث واختر صنفًا من المنيو'],...menu.map(i=>[i.id,i.name+(i.has_missing_cost?' · ⚠ تكلفة ناقصة':'')])],row?.menu_item_id||'');
  const defaultType=row?.rule_type||'per_person';
  const savedPortions=itemId=>state.servingConversions.filter(x=>String(x.menu_item_id)===String(itemId)&&
   !x.unit_id&&x.serving_label!=='وجبة من المنيو');
  const servingChoices=itemId=>[['','وجبة المنيو كاملة'],...units.filter(u=>u.is_active!==false).map(u=>[u.id,u.name]),
   ...savedPortions(itemId).map(x=>['saved:'+x.serving_label,`${x.serving_label} · محفوظ (${x.servings_per_menu_item} في وجبة المنيو)`]),
   ['custom','＋ تعريف حصة جديدة لهذا الصنف']];
  const savedPrevious=previous?.serving_label&&savedPortions(row?.menu_item_id).some(x=>x.serving_label===previous.serving_label);
  const selectedUnit=previous?.serving_unit_id||(previous&&previous.serving_label!=='وجبة من المنيو'?(savedPrevious?'saved:'+previous.serving_label:'custom'):'');
  const unitOptions=opts(servingChoices(row?.menu_item_id),selectedUnit);
  const dlg=modal({title:isPlate?(editingRule?`تعديل مكوّن «${currentGroup?.name||'المجموعة'}»`:`إضافة مكوّن إلى «${currentGroup?.name||'المجموعة'}»`):(editingRule?'تعديل ضيافة':'إضافة ضيافة من المنيو'),
   subtitle:'أدخل الحصة التي تقدمها فعليًا، والبرنامج يحولها إلى عدد وجبات المنيو وتكلفة الوصفة.',submitText:editingRule?'حفظ المكوّن والتكلفة':'إضافة إلى الضيافة',wide:true,
   body:`<div class="event-portion-form-v036"><div class="field full"><label>الصنف الأصلي من المنيو</label><select name="item" required>${menuOptions}</select></div>
    <div class="field full"><label>مجموعة الضيافة</label><select name="group">${opts([['','صنف مستقل خارج المجموعات'],...state.eventGroups.map(g=>[g.id,g.name])],plateId||'')}</select><small>يمكن نقل المكوّن بين المجموعات دون نسخه أو مضاعفة تكلفته.</small></div>
    <div class="field"><label>طريقة تقديم هذا المكوّن</label><select name="type">${opts(Object.entries(SERVING_RULE_NAMES_V036),defaultType)}</select><small>يمكن لكل مجموعة جمع حصص فردية ومشتركة حسب الحاجة.</small></div>
    <div class="field event-portion-people-v036" ${defaultType==='per_n_people'?'':'hidden'}><label>كل كم شخص يتشاركون الحصة على الطاولة؟</label><input name="people" type="number" min="1" step="1" value="${esc(row?.people_per_rule||4)}"></div>
    <div class="event-portion-grid-v036"><div class="field"><label>ما الحصة التي ستُقدَّم؟</label><select name="servingUnit">${unitOptions}</select><button type="button" class="event-ctrl-v036 subtle event-unit-quick-button-v037" data-add-serving-unit-v037>＋ إضافة وحدة وتحويلها</button><small class="hint">مثال: سيخ كباب، قطعة كبة، جاط، أو وجبة كاملة.</small></div>
    <div class="field"><label class="event-serving-count-label-v036">كم نقدم في كل مرة؟</label><input name="servings" type="number" min="0.0001" step="any" required value="${esc(previous?.servings_per_distribution??row?.quantity_per_rule??1)}"><small class="hint event-servings-hint-v036">مثال: 2 سيخ للشخص الواحد.</small></div></div>
    <div class="field full event-custom-unit-v036" hidden><label>اسم الحصة المخصصة</label><input name="customUnit" maxlength="80" placeholder="مثال: سيخ كباب" value="${esc(previous&&!previous.serving_unit_id&&previous.serving_label!=='وجبة من المنيو'?previous.serving_label:'')}"></div>
    <div class="event-portion-yield-v036" hidden><div class="field"><label class="event-yield-label-v036">كم حصة تخرج من وجبة المنيو الواحدة؟</label><input name="yieldCount" type="number" step="any" min="0.0001" max="100000" placeholder="مثال: 10" value="${esc(previous?.servings_per_menu_item??'')}"></div>
    <div class="event-conversion-note-v036" role="status" aria-live="polite">اختر وحدة ثم أكّد التحويل مرة واحدة؛ سيبقى محفوظًا للاستخدام في حفلات لاحقة.</div></div>
    <div class="event-preview-v036" aria-live="polite"><strong>المعاينة الفورية</strong><p class="event-portion-preview-text-v036">اختر صنفًا ووحدة لتظهر الكمية والتكلفة تلقائيًا.</p></div>
    <div class="event-form-meaning-v036"><strong>ماذا تعني الحقول؟</strong><p>«كم نقدم في كل مرة؟» يعني ما يوضع أمام ضيف واحد أو المجموعة أو الطاولة حسب طريقة التقديم. أما «كم حصة تخرج من وجبة المنيو؟» فهي علاقة تحويل مثل 1 كيلو كباب = 10 أسياخ، وتُحفظ لهذا الصنف.</p></div></div>`,
   onSubmit:async fd=>{
    const item=String(fd.get('item')||''),unitValue=String(fd.get('servingUnit')||'');
    if(!item){toast('اختر صنفًا من قائمة المطعم.','error');return false;}
    const unit=units.find(u=>String(u.id)===unitValue);
    const label=unit?.name||(unitValue==='custom'?String(fd.get('customUnit')||'').trim():
     unitValue.startsWith('saved:')?unitValue.slice('saved:'.length):'وجبة من المنيو');
    const yieldCount=unitValue===''?1:Number(fd.get('yieldCount'));
    const servings=Number(fd.get('servings'));
    let menuQty;
    try{menuQty=menuEquivalentV036(servings,yieldCount);}catch(e){toast(toError(e),'error');return false;}
    if(!label||label.length>80||menuQty<=0){toast('اختر وحدة تقديم وحدّد علاقتها بوجبة المنيو.', 'error');return false;}
    const type=String(fd.get('type')); 
    const people=type==='per_n_people'?Number(fd.get('people')):null;
    if(type==='per_n_people'&&(!Number.isInteger(people)||people<1)){toast('حدد كم شخصًا يشتركون في كل تقديم.', 'error');return false;}
    return commit(()=>api.eventSaveServingV037(eventId,{id:row?.rule_id,menuItemId:item,type,
     servings,people,servingLabel:label,unitId:unit?.id||null,servingsPerMenuItem:yieldCount,plateId:String(fd.get('group')||'')||null}),
     'حُفظت الحصة. أُعيد حساب كمية الضيافة وتكلفتها من وصفة المنيو.');
   }
  });
  const form=dlg.form;
  const field=n=>form.elements.namedItem(n);
  const selectedMenu=()=>menu.find(m=>String(m.id)===String(field('item').value));
  const chosenUnit=()=>units.find(u=>String(u.id)===field('servingUnit').value);
  const hintNode=form.querySelector('.event-conversion-note-v036');
  const resultNode=form.querySelector('.event-portion-preview-text-v036');
  const updatePreview=()=>{
   const item=selectedMenu(),val=String(field('servingUnit').value);
   const label=chosenUnit()?.name||(val==='custom'?String(field('customUnit').value||'').trim():
    val.startsWith('saved:')?val.slice('saved:'.length):'وجبة من المنيو');
   const ratio=val===''?1:Number(field('yieldCount').value);
   const type=field('type').value;
   if(!item||!label||!(ratio>0)){
    resultNode.textContent='اختر الصنف والحصة، وأدخل كم حصة تنتج من وجبة المنيو الواحدة لتظهر التكلفة.';return;
   }
   try{
    const p=portionPreviewV036({servings:field('servings').value,yieldCount:ratio,ruleType:type,
     people:field('people').value,tables:state.tables,guests:state.event.planned_guest_count,
     unitCost:item.has_missing_cost?null:item.recipe_cost_base});
    const base=baseCurrency();
    resultNode.textContent=`${field('servings').value} ${label} ÷ ${ratio} = ${p.menuQuantity} من وجبة المنيو لكل تقديم. ${p.distributions} تقديمًا = ${p.totalMenuUnits} من وجبة المنيو للحفلة. ${p.totalCost==null?'⚠ تكلفة الوصفة ناقصة.':`التكلفة المتوقعة ${fmt(p.totalCost,base)}.`}`;
   }catch(e){resultNode.textContent=e.message==='EVENT_PORTION_PRECISION'?'الحصة أصغر من الدقة التي يسمح بها سجل المنيو؛ عدّل عدد الحصص أو التحويل.':'راجع عدد الحصص والتحويل؛ يجب أن تكون الأعداد موجبة.';}
  };
  let candidateCache=new Map();let choiceToken=0;
  const updateServingOptions=async(keepExisting=false)=>{
   const seq=++choiceToken,item=selectedMenu();
   if(!item)return;
   // Populate previously confirmed custom portions inside the same dropdown.
   // A new event never requires retyping a stored 'skewer per kilogram' conversion.
   const chosen=keepExisting?String(field('servingUnit').value):'';
   field('servingUnit').innerHTML=opts(servingChoices(item.id),chosen);
   const original=state.menuSaleUnits.find(x=>String(x.id)===String(item.id));
   try{
    const lines=await api.recipeItems(item.id);
    if(seq!==choiceToken||!dlg.element.isConnected)return;
    const hintedSaleUnit=original?.ameen_sale_unit_v024||(/^(?:1\s*)?(?:كغ|كيلو|kg)(?:\s|$)/i.test(item.name)?'كيلو':'');
    const hints=conversionHintsV036({saleUnit:hintedSaleUnit,units,
      conversions,recipeLines:lines,materials,materialLinks});
    candidateCache=new Map(hints.map(x=>[String(x.unitId),x]));
   }catch(e){candidateCache=new Map();}
   if(!keepExisting){
    // Switching menu items resets the serving unit; an old menu's ratio must
    // never carry over and silently misprice the new product.
    field('servingUnit').value='';field('servingUnit').dispatchEvent(new Event('change',{bubbles:true}));field('servings').value=1;field('yieldCount').value='';
   }
   syncUnit(keepExisting);
  };
  const syncUnit=(preserve=false)=>{
   const val=String(field('servingUnit').value),chosen=chosenUnit(),item=selectedMenu();
   const custom=val==='custom',whole=val==='';
   form.querySelector('.event-custom-unit-v036').hidden=!custom;
   field('customUnit').required=custom;
   form.querySelector('.event-portion-yield-v036').hidden=whole;
   field('yieldCount').required=!whole;
   const label=chosen?.name||(custom?String(field('customUnit').value||'').trim():
    val.startsWith('saved:')?val.slice('saved:'.length):'وجبة من المنيو');
   form.querySelector('.event-serving-count-label-v036').textContent=`كم ${label||'حصة'} نقدّم في كل مرة؟`;
   form.querySelector('.event-servings-hint-v036').textContent=`مثلًا: 2 ${label||'سيخ'} لكل ضيف، أو 1 لكل طاولة.`;
   form.querySelector('.event-yield-label-v036').textContent=`كم ${label||'حصة'} تنتج من وجبة «${item?.name||'المنيو'}» كاملة؟`;
   if(whole){field('yieldCount').value='1';hintNode.textContent='لا يحتاج هذا الصنف إلى تحويل؛ الكمية تُحسب بالوجبة الكاملة من المنيو.';}
   else {
    const saved=state.servingConversions.find(x=>String(x.menu_item_id)===String(item?.id)&&
      (val==='custom'||val.startsWith('saved:')?x.serving_label===label:String(x.unit_id||'')===val));
    const hint=candidateCache.get(val);
    if(!preserve){field('yieldCount').value=saved?.servings_per_menu_item??hint?.ratio??'';}
    hintNode.textContent=saved?`✓ تحويل محفوظ سابقًا: 1 وجبة من المنيو = ${saved.servings_per_menu_item} ${saved.serving_label}. يمكنك تعديله عند اختلاف الحصة.`:
      hint?`اقتراح من ${hint.source}: ${Number(hint.ratio.toFixed(4))} ${label} في وجبة المنيو. راجع العدد قبل الحفظ؛ قد يختلف وزن الحصة المطبوخة عن المادة الخام.`:
      'أدخل مرة واحدة عدد هذه الحصص في وجبة المنيو؛ سيُحفظ التحويل لهذا الصنف مستقبلًا.';
   }
   updatePreview();
  };
  const syncType=()=>{
   const isGroup=field('type').value==='per_n_people';
   form.querySelector('.event-portion-people-v036').hidden=!isGroup;
   field('people').required=isGroup;updatePreview();
  };
  // Nested modal: preserves the parent form, including pending typed quantities.
  form.querySelector('[data-add-serving-unit-v037]').addEventListener('click',async()=>{
   const menuItem=selectedMenu();
   if(!menuItem){toast('اختر صنف المنيو أولًا، ثم أضف وحدته.', 'error');field('item').focus();return;}
   let recipes=[];
   try{recipes=await api.recipeItems(menuItem.id);}catch(e){toast('تعذّر جلب مواد الوصفة: '+toError(e),'error');return;}
   if(!dlg.element.isConnected)return;
   const recipeMaterials=[...new Map(recipes.filter(x=>x.material_id).map(x=>{
    const mat=materials.find(m=>String(m.id)===String(x.material_id));return [String(x.material_id),mat];
   }).filter(x=>x[1])).values()];
   const baseLabel=material=>units.find(u=>String(u.id)===String(material?.base_unit_id))?.name||'وحدة المخزون';
   let materialChoices=[];
   const quick=modal({title:'إضافة وحدة وتحويلها لهذا الصنف',
    subtitle:`${menuItem.name} · أضف الحصة من هنا وسيختارها البرنامج تلقائيًا بعد الحفظ.`,
    submitText:'حفظ الوحدة واختيارها',
    body:`<div class="event-quick-unit-v037">
     <div class="field"><label>اسم الحصة أو الوحدة</label><input name="name" required maxlength="80" placeholder="مثال: سيخ كباب مشوي" autocomplete="off"></div>
     <div class="field"><label>كم حصة من هذه الوحدة في وجبة المنيو كاملة؟</label><input name="yieldCount" required type="number" min="0.0001" step="0.0001" max="100000" placeholder="مثال: 10"></div>
     <div class="notice green">مثال: 1 كيلو كباب من المنيو = 10 أسياخ. لاحقًا اختر «سيخ كباب» واكتب 2 لكل ضيف؛ يحسب البرنامج 0.2 كيلو تلقائيًا.</div>
     <label class="event-unit-link-toggle-v037"><input type="checkbox" name="linkMaterial" ${recipeMaterials.length?'':'disabled'}> ربط هذه الوحدة بمادة مخزون أيضًا (اختياري)</label>
     <div class="event-unit-material-details-v037" hidden><div class="field"><label>المادة الموجودة في وصفة الصنف</label><select name="material"><option value="">اختر المادة</option>${recipeMaterials.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></div>
     <div class="field"><label>وحدة القياس المرجعية</label><select name="referenceUnit"></select></div>
     <div class="field"><label data-material-qty-label>قيمة التحويل</label><input name="quantityInBase" type="number" step="any" min="0.00000001" placeholder="مثال: 100 أو 10"></div>
     <label class="event-unit-link-toggle-v037"><input type="checkbox" name="inverse"> أعكس العلاقة: كم سيخًا في كيلو واحد؟ (بدل كم غرامًا في السيخ)</label>
     <div class="event-unit-relation-preview-v037" data-quick-relation-preview></div>
     <small>هذا تحويل مستقل للمخزون الخام، وليس بالضرورة تحويل وجبة المنيو الجاهزة. لن نخمن الوزن أو الكمية نيابة عنك.</small></div>
     ${recipeMaterials.length?'':'<small>وصفة هذا الصنف لا تحتوي مواد معرفة، لذلك يمكن حفظ حصة المنيو فقط حاليًا.</small>'}
     </div>`,
    onSubmit:async fd=>{
     const materialId=fd.get('linkMaterial')?String(fd.get('material')||''):null;
     const choice=materialChoices.find(c=>String(c.unit.id)===String(fd.get('referenceUnit')));
     const qty=materialId?relationBaseFromAmount(fd.get('quantityInBase'),choice,Boolean(fd.get('inverse'))):null;
     if(fd.get('linkMaterial')&&!materialId){toast('اختر مادة من الوصفة لربط التحويل بالمخزون.','error');return false;}
     const error=validateQuickServingV037({menuItemId:menuItem.id,name:fd.get('name'),yieldCount:fd.get('yieldCount'),
      materialId,quantityInBase:qty,menuConversions:state.servingConversions,units,
      recipeMaterialIds:recipes.map(x=>x.material_id)});
     if(error){toast(error,'error');return false;}
     try{
      const saved=await api.eventCreateServingUnitV037(menuItem.id,{name:fd.get('name'),yieldCount:fd.get('yieldCount'),materialId,quantityInBase:qty});
      if(String(selectedMenu()?.id)!==String(menuItem.id))throw Error('EVENT_MENU_ITEM_CHANGED');
      state.servingConversions.push({menu_item_id:menuItem.id,serving_label:saved.serving_label,
       unit_id:saved.unit_id||null,servings_per_menu_item:Number(saved.servings_per_menu_item)});
      if(saved.unit_id){const latest=await api.units();units.splice(0,units.length,...latest);}
      const newChoice=quickServingChoiceV037({servingLabel:saved.serving_label,unitId:saved.unit_id});
      field('servingUnit').innerHTML=opts(servingChoices(menuItem.id),newChoice);
      field('servingUnit').value=newChoice;
      syncUnit(false);
      toast('تم حفظ الوحدة وتحويلها واختيارها تلقائيًا. أكمل الحصة واحفظ المكوّن.','success');
      return true;
     }catch(e){toast(toError(e),'error');return false;}
    }
   });
   const qform=quick.form;
   const link=qform.elements.namedItem('linkMaterial');
   const area=qform.querySelector('.event-unit-material-details-v037');
   const mat=qform.elements.namedItem('material');
   const qtyLabel=qform.querySelector('[data-material-qty-label]');
   const ref=qform.elements.namedItem('referenceUnit');
   const inverse=qform.elements.namedItem('inverse');
   const qtyField=qform.elements.namedItem('quantityInBase');
   const preview=qform.querySelector('[data-quick-relation-preview-v037]')||qform.querySelector('[data-quick-relation-preview]');
   const syncPreview=()=>{
    const material=recipeMaterials.find(m=>String(m.id)===String(mat.value));
    const choice=materialChoices.find(c=>String(c.unit.id)===String(ref.value));
    const qty=relationBaseFromAmount(qtyField.value,choice,inverse.checked);
    const label=String(qform.elements.namedItem('name').value||'الوحدة الجديدة').trim();
    preview.textContent=choice&&qty>0&&Number.isFinite(qty)?
     inverse.checked?`1 ${choice.label} = ${qtyField.value} ${label} من ${material?.name||'المادة'} (المخزون: ${qty} ${baseLabel(material)} لكل ${label})`:
     `1 ${label} = ${qtyField.value} ${choice.label} من ${material?.name||'المادة'}`:
     'حدد المادة والكمية لتظهر العلاقة قبل الحفظ.';
   };
   const sync=()=>{
    area.hidden=!link.checked;
    qtyField.required=link.checked;mat.required=link.checked;ref.required=link.checked;
    const chosen=recipeMaterials.find(m=>String(m.id)===String(mat.value));
    const base=units.find(u=>String(u.id)===String(chosen?.base_unit_id));
    materialChoices=conversionChoices(base,units);
    ref.innerHTML=opts(materialChoices.map(c=>[c.unit.id,c.label]),materialChoices[0]?.unit?.id||'');
    ref.value=String(materialChoices[0]?.unit?.id||'');
    qtyLabel.textContent=inverse.checked?'كم وحدة صغيرة داخل وحدة القياس المرجعية؟':'كم تعادل وحدة واحدة من الوحدة المرجعية؟';
    syncPreview();
   };
   link.addEventListener('change',sync);mat.addEventListener('change',sync);
   inverse.addEventListener('change',()=>{qtyLabel.textContent=inverse.checked?'كم حصة في وحدة القياس المرجعية؟':'كم تعادل الحصة من وحدة القياس المرجعية؟';syncPreview();});
   ref.addEventListener('change',syncPreview);qtyField.addEventListener('input',syncPreview);
   qform.elements.namedItem('name').addEventListener('input',syncPreview);
   sync();
  });
  field('item').addEventListener('change',()=>updateServingOptions(false));
  field('servingUnit').addEventListener('change',()=>syncUnit(false));
  field('customUnit').addEventListener('input',()=>syncUnit(false));
  ['servings','yieldCount','people'].forEach(n=>field(n).addEventListener('input',updatePreview));
  field('type').addEventListener('change',syncType);
  syncType();
  updateServingOptions(true);
 }
 function openBooking(table=null){
  const available=state.tables.filter(t=>t.status!=='cancelled'&&!t.booking_id).sort((a,b)=>Number(a.display_order||0)-Number(b.display_order||0)||a.table_label.localeCompare(b.table_label,'ar',{numeric:true}));
  if(!available.length){toast('لا توجد طاولات متاحة. جهّز طاولات جديدة أولًا.','error');return;}
  const initial=table&&available.find(t=>t.id===table.id)||available[0];
  const dlg=modal({title:'حجز طاولة أو مجموعة',subtitle:'ابدأ باسم الضيف وعدد الأشخاص؛ سيقترح النظام توزيعًا على الطاولات المجاورة.',submitText:'تأكيد الحجز وتوزيع الضيوف',
   body:`<div class="form-grid"><div class="field full"><label>صاحب الحجز</label><input name="name" maxlength="150" required placeholder="مثال: زياد"></div><div class="field"><label>الهاتف (اختياري)</label><input name="phone" type="tel" maxlength="40"></div><div class="field"><label>عدد الأشخاص</label><input name="guests" type="number" min="1" max="1000" value="1" required></div><div class="field full"><label>الطاولة الأولى</label><select name="table" required>${opts(available.map(t=>[t.id,`${t.table_label} · متاح ${t.capacity} كراسي`]),initial.id)}</select></div>
   <div class="field full"><label>توزيع المجموعة على الطاولات</label><div class="event-booking-suggestion-v035" data-suggest></div></div>
   <div class="field full"><label>أسماء الأشخاص (اختياري، اسم لكل سطر)</label><textarea name="names" rows="4" placeholder="زياد&#10;محمد&#10;أحمد"></textarea><small class="hint">إذا أدخلت اسم صاحب الحجز فقط، تصبح الأسماء الأخرى: مع زياد 1، مع زياد 2... ويمكنك تعديلها.</small></div>
   <div class="field"><label>القيمة الإجمالية للحجز (${esc(priceCurrency())})</label><input name="amount" type="number" min="0" step="any" value="${num(state.event.default_price_original)}" required></div>
   <div class="field full"><label>ملاحظة</label><textarea name="note" rows="2" maxlength="500"></textarea></div></div><p class="metric-note">الحجز لا يثبت حركة نقدية حتى تضغط تحصيل. لا نسمح بتجاوز سعة الطاولات.</p>`,
   onSubmit:async fd=>{const count=Number(fd.get('guests'));const allocation=pickAllocation(fd.get('table'),count);if(!allocation.ok){toast(allocation.reason,'error');return false;}const name=String(fd.get('name')||'').trim();const names=String(fd.get('names')||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(names.length>count){toast('عدد الأسماء أكبر من عدد الكراسي في الحجز.','error');return false;}if(names[0]!==name)names.unshift(name);if(names.length>count){toast('اكتب أسماء المرافقين فقط، أو اسم صاحب الحجز أولًا، بحيث لا يتجاوز العدد عدد الضيوف.','error');return false;}const result=await commit(()=>api.eventGroupBookingV035(eventId,{name,guests:count,allocations:allocation.rows,names,phone:fd.get('phone'),amount:fd.get('amount'),note:fd.get('note')}),'تم حجز المقاعد وحفظ أسماء الضيوف.');if(result)tab='bookings';return result;}
  });
  const guests=dlg.form.elements.namedItem('guests'),amount=dlg.form.elements.namedItem('amount'),tableField=dlg.form.elements.namedItem('table'),suggest=dlg.form.querySelector('[data-suggest]');
  let edited=false;amount.addEventListener('input',()=>edited=true);
  const sync=()=>{const count=Number(guests.value);const proposal=pickAllocation(tableField.value,count);suggest.innerHTML=proposal.ok?`<strong>✓ ${proposal.rows.map(r=>{const t=available.find(x=>x.id===r.table_id);return esc(t?.table_label||'')+' · '+r.guests+' أشخاص';}).join(' + ')}</strong><p>المقاعد تكفي للمجموعة. ${proposal.rows.length>1?'الاقتراح حسب ترتيب أرقام الطاولات؛ تأكد من تجاورها الفعلي في القاعة.':''}</p>`:`<strong class="payroll-danger-v034">⚠ ${esc(proposal.reason)}</strong>`;if(!edited)amount.value=String(Math.max(0,count)*num(state.event.default_price_original));};
  const pickAllocation=(tableId,count)=>proposeEventAllocationV035(state.tables,tableId,count);
  guests.addEventListener('input',sync);tableField.addEventListener('change',sync);sync();
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
  emit('[data-action="add-bulk"]',openBulkTables);
  emit('[data-table-edit]',el=>openTable(state.tables.find(x=>String(x.id)===el.dataset.tableEdit)));
  emit('[data-table-book]',el=>openBooking(state.tables.find(x=>String(x.id)===el.dataset.tableBook)));
  emit('[data-table-extra]',el=>openExtra(state.tables.find(x=>String(x.id)===el.dataset.tableExtra)));
  emit('[data-table-invoice]',el=>tableInvoice(state.tables.find(x=>String(x.id)===el.dataset.tableInvoice)));
  emit('[data-action="add-activity"]',openActivity);
  emit('[data-action="add-booking"]',()=>openBooking());
  emit('[data-book-pay]',el=>{const x=state.bookings.find(x=>String(x.id)===el.dataset.bookPay);if(x)payBooking(x);});
  emit('[data-action="add-rule"]',()=>openRule());
  emit('[data-action="add-event-group"]',()=>openEventGroup());
  emit('[data-group-add]',el=>openRule(null,el.dataset.groupAdd));
  emit('[data-group-edit]',el=>openEventGroup(state.eventGroups.find(g=>String(g.id)===String(el.dataset.groupEdit))));
  emit('[data-group-delete]',async el=>{const group=state.eventGroups.find(g=>String(g.id)===String(el.dataset.groupDelete));if(group&&await confirmBox(`سيُحذف «${group.name}» وجميع مكوناتها فقط، وسيُعاد احتساب التكلفة. هل تؤكد؟`,'حذف المجموعة'))await commit(()=>api.eventDeleteGroupV037(eventId,group.id),'تم حذف المجموعة ومكوناتها.');});
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
  root.querySelectorAll('.event-menu-table-v034').forEach(menuTable=>{
   const groupId=menuTable.dataset.groupId||null;
   const group=state.eventGroups.find(g=>String(g.id)===String(groupId));
   const metadata=new Map(state.servingRules.map(m=>[String(m.rule_id),m]));
   const validIds=new Set(state.eventGroups.map(g=>String(g.id)));
   const rows=state.requirements.filter(r=>{
    const associated=String(metadata.get(String(r.rule_id))?.main_plate_id||'');
    return groupId?associated===String(groupId):!validIds.has(associated);
   });
   registerTableExport(menuTable,()=>({title:`${group?`مجموعة ${group.name}`:'الأصناف المستقلة'} · ${state.event.name}`,
    headers:['الصنف','طريقة التقديم','ما يقدم في كل مرة','وحدة الحصة','عدد الحصص في وجبة المنيو','الإجمالي المطلوب من المنيو','تكلفة الوجبة الأصلية','تكلفة هذا الصنف'],
    rows:rows.map(r=>{const meta=metadata.get(String(r.rule_id));return [r.menu_item_name,
     SERVING_RULE_NAMES_V036[r.rule_type]||r.rule_type,meta?.servings_per_distribution??r.quantity_per_rule,
     meta?.serving_label||'وجبة من المنيو',meta?.servings_per_menu_item??1,r.required_quantity,
     r.unit_food_cost_base??'غير مكتملة',r.estimated_food_cost_base??'غير مكتملة'];})}));
  });
  const bookingTable=root.querySelector('.event-booking-table-v034');
  if(bookingTable)registerTableExport(bookingTable,()=>({title:`حجوزات ${state.event.name}`,
   headers:['الاسم','الهاتف','عدد الأشخاص','أسماء المقاعد','الطاولات','المتفق عليه','المدفوع','المتبقي','العملة'],
   rows:state.bookings.map(b=>{const ba=state.bookingBalances.find(z=>z.booking_id===b.id)||{};return [b.customer_name,b.customer_phone||'',b.guest_count,state.guests.filter(g=>g.booking_id===b.id).map(g=>g.guest_name).join('، '),state.tables.filter(t=>t.booking_id===b.id).map(t=>t.table_label).join(' + '),b.agreed_amount_original,ba.paid_original||0,ba.balance_original||0,b.currency_code];})}));
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
