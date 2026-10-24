import {materialSearchTextV106} from '../material-search-v106.js?v=1.0.10';
import * as api from '../api.js?v=1.0.10';
import {modal,toast,loader,friendlyError,confirmBox} from '../ui.js?v=1.0';
import {currencyLabel,esc,money,dateOnly,todayISO} from '../utils.js?v=1.0';
import {registerTableExport} from '../table-export-v027.js?v=1.0';
import {EVENT_RULE_NAMES_V034,eventCostQuoteV034,eventActualResultV034} from '../event-cost-v034.js?v=1.0';
import {proposeEventAllocationV035} from '../event-seating-v035.js?v=1.0';
import {menuEquivalentV036,portionPreviewV036,conversionHintsV036,SERVING_RULE_NAMES_V036} from '../portion-servings-v036.js?v=1.0';
import {validateQuickServingV037,quickServingChoiceV037} from '../event-unit-quick-v037.js?v=1.0';
import {conversionChoices,relationBaseFromAmount} from '../unit-display-conversion.js?v=1.0';
import {hospitalityGroupsV037} from '../event-groups-v037.js?v=1.0';
import {eventMoneyV038,normalizeTicketV038,bookingPriceV038,ticketFromMarginV038,marginFromTicketV038,eventGuestSummaryV038,validateTableDistributionV038,normalizeTableSearchV038,EVENT_BOOKING_STATUS_AR_V038} from '../event-v038.js?v=1.0';
import {augmentEventQuoteV038} from '../event-external-v038.js?v=1.0';
import {planningTablesV039,plannedMenuRequirementsV039,externalBudgetV039,externalPreviewV039,tableExtraGroupsV039,portionDisplayV039} from '../event-planning-v039.js?v=1.0';
import {onDemandRowsV040,onDemandTotalsV040,reservationDashboardV040} from '../event-on-demand-v040.js?v=1.0';

const fmt=(v,c='SYP')=>eventMoneyV038(Math.abs(Number(v)||0)<1e-8?0:Number(v)||0,c);
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
 EVENT_BOOKING_HAS_PAYMENTS:'هذا الحجز لديه دفعات فعلية؛ لا يمكن تعديل قيمته بهذا الإجراء.',
 EVENT_BOOKING_PRICE_INVALID:'حدد سعر حجز موجبًا قبل التحصيل.',
 EVENT_EXTERNAL_DISH_INVALID:'راجع بيانات الوجبة الخارجية والعدد والتكلفة.',
 EVENT_EXTERNAL_DISH_IN_USE:'هذه الوجبة مستخدمة في خطة الضيافة. احذف قاعدة تقديمها أولًا.',
 EVENT_EXTERNAL_DISH_NOT_FOUND:'الوجبة الخارجية غير موجودة أو أُلغيت.',
 EVENT_EXTERNAL_ALREADY_PAID:'تم دفع ثمن هذه الوجبة مسبقًا ولا يمكن تكرار الحركة.',
 EVENT_EXTERNAL_RULE_INVALID:'راجع طريقة التقديم وعدد الحصص للوجبة الخارجية.',
 EVENT_EXTERNAL_ZERO_COST:'لا يمكن تسجيل حركة صفرية في الصندوق. عدّل بيانات الشراء.',
 EVENT_EXTERNAL_CONVERSION_INVALID:'تحقق من اسم وحدة التقديم وعدد الحصص التي تنتج من وحدة الشراء.',
 EVENT_EXTERNAL_CONVERSION_PRECISION:'الكمية الناتجة أصغر من دقة سجل النظام؛ غيّر مقدار التحويل.',
 EVENT_EXTERNAL_UNIT_IN_USE:'هذه الوحدة مستخدمة في ضيافة الحفلة. لا يمكن تغيير عدد حصصها بعد الاستخدام؛ أنشئ اسم وحدة جديدًا للتحويل المختلف.',
 EVENT_ESTIMATE_INVALID:'تكلفة الصنف التقديرية يجب أن تكون رقمًا موجبًا أو صفرًا وبعملة الأساس.',
 EVENT_ON_DEMAND_INVALID:'حدّد مصدر الضيافة والحد الأقصى للحصص بشكل صحيح.',
 EVENT_ON_DEMAND_UNIT_INVALID:'اختر وحدة تقديم محفوظة لهذا الصنف.',
 EVENT_ON_DEMAND_DUPLICATE_PLAN:'هذا الصنف موجود مسبقًا في الضيافة الثابتة. انقله إلى حسب الطلب حتى لا يُحسب مرتين.',
 EVENT_ON_DEMAND_UNIT_IN_USE:'لا يمكن تغيير وحدة التقديم بعد تسجيل حصص؛ ألغِ التقديمات أولًا.',
 EVENT_ON_DEMAND_BELOW_ISSUED:'الحد الجديد أقل من الكمية التي قُدّمت فعليًا.',
 EVENT_ON_DEMAND_EXCEEDS_LIMIT:'الكمية المطلوبة أكثر من الرصيد المتاح للضيافة حسب الطلب.',
 EVENT_ON_DEMAND_EXCEEDS_PURCHASE:'لا تكفي الكمية المشتراة من الخارج لتقديم هذا العدد.',
 EVENT_ON_DEMAND_PRECISION:'تحويل الحصص ينتج كمية أصغر من دقة نظام المخزون؛ عدّل التحويل.',
 EVENT_ON_DEMAND_ISSUE_NOT_FOUND:'سجل التقديم غير موجود أو أُلغي مسبقًا.',
 EVENT_TABLE_NO_UNPAID_EXTRAS:'لا توجد طلبات معلقة على هذه الطاولة؛ حدّث الشاشة قبل التحصيل.',
 EVENT_CASHBOX_INVALID:'اختر صندوقًا نشطًا لتسجيل الدفع.',
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
 if(s.includes('event_on_demand_v040')||s.includes('event_book_and_collect_v040')||s.includes('event_issue_on_demand_v040'))return 'شغّل تحديث SQL v0.40 على Supabase أولًا ثم حدّث الصفحة.';
 if(s.includes('event_menu_cost_estimates_v039')||s.includes('event_external_unit_conversions_v039')||s.includes('pay_event_table_extras_v039')||s.includes('event_save_external_serving_v039'))return 'يلزم تشغيل SQL v0.39 في Supabase قبل استخدام هذا التحديث.';
 if(s.includes('event_external_dishes_v038')||s.includes('event_external_servings_v038')||s.includes('event_set_booking_amount_v038'))return 'يلزم تشغيل SQL v0.38 على Supabase قبل استخدام هذه الميزة.';
 if(s.includes('save_event_group_v037')||s.includes('create_event_serving_unit_v037')||s.includes('save_event_group_serving_v037')||s.includes('event_groups_v037'))return 'شغّل SQL v0.37 في Supabase أولًا ثم حدّث الصفحة.';
 if(s.includes('event_serving_rules_v036')||s.includes('event_main_plates_v036')||s.includes('menu_serving_conversions_v036')||s.includes('save_event_serving_v036')||s.includes('save_event_main_plate_v036'))return 'شغّل تحديث SQL v0.36 في Supabase ثم حدّث الصفحة لتفعيل حصص الضيافة والصحن الرئيسي.';
 if(s.includes('PGRST202')||s.includes('event_extras_v034')||s.includes('event_planner_settings_v034')||s.includes('event_activity_v034'))return 'يلزم تطبيق ملف SQL للإصدار v0.34 على Supabase قبل استخدام إدارة الحفلات.';
 return friendlyError(e,s||'حدث خطأ غير متوقع');
};

export async function renderEventsV034(root,mode='planning'){
 root.innerHTML=loader();
 try{
  const events=await api.events();
  root.innerHTML=`<div class="page-head"><div><h2>${mode==='booking'?'حجوزات الحفلات':'بناء الحفلة والتخطيط'}</h2><p>${mode==='booking'?'اختر الحفلة لتسجيل الحجوزات وقبض مبالغها ومتابعة الطاولات والمقاعد.':'ابدأ بتجهيز الحفلة والطاولات والضيافة والتكاليف والتسعير، ثم افتح الحجوزات من قسمها المستقل.'}</p></div>
  ${mode==='booking'?'<a class="btn secondary" href="#/events-list">الانتقال إلى تجهيز الحفلات</a>':'<button type="button" class="btn" id="event-new-v034">+ حفلة جديدة</button>'}</div>
  <div class="event-journey-v034">${mode==='booking'?'<span>① اختر الحفلة</span><span>② افتح خريطة الطاولات</span><span>③ احجز واقبض فورًا عند الحاجة</span><span>④ راقب المتبقي</span>':'<span>① تجهيز الطاولات</span><span>② خطط الضيافة حسب طريقة التقديم</span><span>③ سجّل المصاريف والتسعير</span><span>④ راقب النتيجة</span>'}</div>
  ${events.length?`<div class="grid cols-3 event-list-grid-v034">${events.map(e=>`<a class="card event-list-card-v034" href="#/${mode==='booking'?'event-bookings':'event'}/${esc(e.id)}">
    <div class="event-list-card-top-v034"><span class="badge ${e.status==='completed'?'green':e.status==='cancelled'?'red':'yellow'}">${esc(statusLabel[e.status]||e.status||'—')}</span><span class="metric-note">${dateOnly(e.event_date)}</span></div>
    <h3>${esc(e.name)}</h3><div class="event-list-chips-v034"><span>♟ ${esc(e.planned_guest_count??0)} ضيف مخطط</span><span>◈ ${esc(e.event_type==='public'?'عامة':'خاصة')}</span></div>
    <div class="go">${mode==='booking'?'فتح الحجوزات والمقاعد ←':'فتح التخطيط والميزانية ←'}</div></a>`).join('')}</div>`:empty('لا توجد حفلات حتى الآن. أنشئ الحفلة الأولى ليظهر لك مخططها وحساب التكلفة.')}`;
  if(mode==='booking')return;
  root.querySelector('#event-new-v034').onclick=()=>modal({title:'إنشاء حفلة جديدة',subtitle:'بعد الإنشاء ستنتقل إلى لوحة تنظيمها وتسعيرها.',submitText:'إنشاء وفتح الحفلة',
   body:`<div class="form-grid"><div class="field full"><label>اسم الحفلة</label><input name="name" required maxlength="120" placeholder="مثال: سهرة الجمعة - فرقة النغم"></div>
    <div class="field"><label>تاريخ الحفلة</label><input type="date" name="date" value="${todayISO()}" required></div>
    <div class="field"><label>نوع الحفلة</label><select name="type"><option value="public">عامة · تذاكر</option><option value="private">خاصة · حجز</option></select></div>
    <div class="field"><label>عدد الضيوف المتوقع</label><input type="number" name="guests" min="1" max="100000" value="40" required></div>
    <div class="field"><label>عملة الحفلة</label><select name="currency"><option value="SYP">ليرة سورية · ل.س</option><option value="USD">دولار · USD</option></select></div>
    <div class="field"><label>عدد الطاولات</label><input type="number" name="tableCount" min="1" max="200" value="10" required></div><div class="field"><label>كراسي كل طاولة</label><input type="number" name="seatsPerTable" min="1" max="100" value="8" required></div><div class="field full"><label>مصدر الإيراد</label><select name="mode"><option value="bookings">تذاكر وحجوزات</option><option value="both">حجوزات وأوردرات منفصلة</option><option value="orders">أوردرات فقط</option></select></div></div>`,
   onSubmit:async fd=>{try{const result=await api.createEvent({name:fd.get('name'),date:fd.get('date'),type:fd.get('type'),guests:fd.get('guests'),currency:fd.get('currency'),revenueMode:fd.get('mode')});
    try{await api.eventBulkTablesV035(result,fd.get('tableCount'),fd.get('seatsPerTable'));toast('تم إنشاء الحفلة وجميع طاولاتها دفعة واحدة.','success');location.hash=`#/event/${result}`;return true;}catch(setupError){toast('تم إنشاء الحفلة لكن تعذّر تجهيز الطاولات: '+toError(setupError),'error');location.hash=`#/event/${result}`;return true;}
   }catch(e){toast(toError(e),'error');return false;}}
  });
 }catch(e){root.innerHTML=`<div class="notice">${esc(toError(e))}</div>`;}
}

export async function renderEventDetailV034(root,eventId,view='planning'){
 let tab=view==='booking'?'bookings':'tables',state=null,busy=false;
 root.innerHTML=loader();
 const reload=async()=>{
  if(busy)return;busy=true;root.innerHTML=loader();
  try{
   const [event,tables,rules,requirements,tableMenu,menuCosts,costs,costCompare,labor,summary,bookings,bookingBalances,extras,waste,boxes,expenses,planner,settings,activity,guests,eventGroups,servingRules,servingConversions,menuSaleUnits,externalDishes,externalRules,menuEstimates,externalConversions,onDemandItems,onDemandIssues]=await Promise.all([
    api.eventV034(eventId),api.eventTablesV034(eventId),api.eventMenuRulesV034(eventId),
    api.eventMenuRequirementsV034(eventId),api.eventTableMenuV034(eventId),api.menuCostsV034(),
    api.eventCostItemsV034(eventId),api.eventCostComparisonV034(eventId),api.eventLaborV034(eventId),
    api.eventSummaryV034(eventId),api.eventBookings(eventId),api.eventBookingBalancesV034(eventId),
    api.eventExtrasV034(eventId),api.eventWasteV034(eventId),api.cashboxes(),
    api.eventExpenseEntriesV034(eventId),api.eventPlannerV034(eventId),api.payrollSettings(),api.eventActivityV034(eventId),api.eventGuestsV035(eventId),
    api.eventGroupsV037(eventId),api.eventServingRulesV036(eventId),api.menuServingConversionsV036(),api.eventMenuSaleUnitsV036(),
    api.eventExternalDishesV038(eventId),api.eventExternalServingsV038(eventId),
    api.eventMenuCostEstimatesV039(),api.eventAllExternalUnitsV039(),
    api.eventOnDemandV040(eventId),api.eventOnDemandIssuesV040(eventId),
   ]);
   if(!event)throw Error('EVENT_NOT_FOUND');
   state={event,tables,rules,requirements,tableMenu,menuCosts,costs,costCompare,labor,summary:summary||{},bookings,bookingBalances,
    extras,waste,boxes,expenses,planner,settings,activity,guests,eventGroups,servingRules,servingConversions,menuSaleUnits,externalDishes,externalRules,menuEstimates,externalConversions,onDemandItems,onDemandIssues};
   paint();
  }catch(e){root.innerHTML=`<div class="page-head"><h2>الحفلة</h2><a class="btn secondary" href="#/${view==='booking'?'event-reservations':'events-list'}">رجوع</a></div><div class="notice"><strong>تعذّر تحميل لوحة الحفلة</strong><p>${esc(toError(e))}</p></div>`;}
  finally{busy=false;}
 };
 const priceCurrency=()=>state.event.price_currency_code||'SYP';
 const baseCurrency=()=>state.settings.base_currency_code||'SYP';
 const fx=()=>num(state.event.price_exchange_rate_to_base)||1;
 const box=()=>state.boxes.find(b=>b.is_active&&b.is_general)||state.boxes.find(b=>b.is_active);
 const editing=()=>['planning','open','confirmed'].includes(state.event.status);
 const seating=()=>planningTablesV039(state.tables,num(state.event.planned_guest_count));
 const planRequirements=()=>plannedMenuRequirementsV039(state.requirements,seating(),state.menuEstimates);
 const estimatedRows=()=>planRequirements().filter(r=>r.v039_cost_is_estimate&&num(r.required_quantity)>0);
 const external=()=>externalBudgetV039(state.externalDishes,state.externalRules,seating(),state.externalConversions);
 const demand=()=>onDemandRowsV040(state.onDemandItems,state.onDemandIssues,state.menuCosts,state.menuEstimates,state.externalDishes);
 const demandTotal=()=>onDemandTotalsV040(demand());
 const bookingStats=()=>reservationDashboardV040(state.event,state.tables,state.bookings,state.bookingBalances);
 const quote=()=>{
  const planned=augmentEventQuoteV038(eventCostQuoteV034({
   guests:state.event.planned_guest_count,tables:state.tables.filter(t=>t.status!=='cancelled').length,
   menuRules:planRequirements(),menuCosts:state.menuCosts,
   otherCosts:state.costs.filter(c=>c.is_active!==false),laborCosts:state.labor.filter(l=>l.status==='active'),
   wasteReservePercent:state.planner.waste_reserve_percent,targetMarginPercent:state.planner.target_margin_percent,
   ticketPrice:state.event.default_price_original||0,exchangeRate:fx(),
  }),external().plannedCost,state.planner.waste_reserve_percent);
  const reserveLimit=demandTotal().planned;
  const extraWaste=reserveLimit*Math.max(0,num(state.planner.waste_reserve_percent))/100;
  const total=planned.total+reserveLimit+extraWaste;
  const estimatedUncosted=demandTotal().unknown;
  const outsideDemand=demand().filter(row=>row.isOutside).reduce((sum,row)=>sum+num(row.reservedCost),0);
  return {...planned,food:planned.food+reserveLimit,total,reserve:planned.reserve+extraWaste,
    profit:planned.revenue-total,marginPercent:planned.revenue>0?(planned.revenue-total)/planned.revenue*100:null,
    costPerPerson:planned.count>0?total/planned.count:null,
    costPerTable:planned.tableCount>0?total/planned.tableCount:null,
    externalFood:planned.externalFood+outsideDemand,
    missing:planned.missing+estimatedUncosted,reliable:planned.missing+estimatedUncosted===0,
    onDemandBudget:reserveLimit,onDemandOutsideBudget:outsideDemand};
 };
 const actual=()=>{const a=eventActualResultV034({historical:state.summary,extras:state.extras,waste:state.waste,bookingBalances:state.bookingBalances,tables:state.tables});
  const purchased=external().purchasedCost,cost=a.cost+purchased;return {...a,cost,profit:a.profit-purchased,externalCost:purchased,costPerPerson:a.guests>0?cost/a.guests:null};};
 const withBox=()=>opts(state.boxes.filter(b=>b.is_active).map(b=>[b.id,b.name+(b.is_general?' · العام':'')]),box()?.id||'');
 const dialogError=e=>{toast(toError(e),'error');return false;};
 const commit=async(fn,msg)=>{try{await fn();toast(msg,'success');await reload();return true;}catch(e){return dialogError(e);}};
 const moneyBase=v=>fmt(v,baseCurrency());
 const moneyTicket=v=>fmt(v,priceCurrency());
 const exportAmount=(v,c=baseCurrency())=>c==='SYP'?Math.ceil(num(v)-1e-9):Math.ceil(num(v)*100-1e-8)/100;
 const stage=()=>state.event.status==='completed'?5:state.extras.some(x=>x.status==='pending')?4:state.rules.length&&state.tables.length?3:state.tables.length?2:1;
 const badge=stateName=>`<span class="badge ${stateName==='paid'||stateName==='completed'||stateName==='confirmed'?'green':stateName==='pending'?'red':'yellow'}">${esc(statusLabel[stateName]||stateName||'—')}</span>`;
 const tabNames=view==='booking'?[['bookings','الحجوزات والتحصيل'],['seat-map','مخطط الطاولات والمقاعد'],['demand-service','الضيافة حسب الطلب']]:[['tables','تجهيز الطاولات'],['menu','مكونات الضيافة'],['external','مشتريات خارجية'],['demand','ضيافة حسب الطلب'],['costs','التكاليف العامة'],['extras','فواتير وهدر'],['report','تقرير التكلفة والربح'],['activity','سجل الحفلة'],['overview','نظرة عامة']];
 function paint(){
  const q=quote(),a=actual(),e=state.event;
  const pendingExtras=state.extras.filter(x=>x.status==='pending');
  const warnings=[];
  if(!state.tables.length)warnings.push('لم تُجهّز الطاولات بعد');
  if(!state.rules.length)warnings.push('لم تُسجّل قائمة ضيافة للحفلة');
  if(q.missing)warnings.push(`${q.missing} صنف بلا تكلفة معروفة أو تقديرية`);
  if(state.onDemandItems.length&&demand().some(x=>x.isOutside&&x.maximum_servings>x.purchasedServings+.00001))warnings.push('ضيافة حسب الطلب تتجاوز المشتريات الخارجية المسجلة');
  if(estimatedRows().length)warnings.push(`${estimatedRows().length} صنف حُسب بتكلفة تقديرية للتخطيط فقط، لا تمثل تقييم المخزون`);
  if(seating().unseated)warnings.push(`السعة المتوفرة أقل من الهدف بمقدار ${seating().unseated} مقعد؛ أضف طاولات`);
  if(external().shortages.length)warnings.push(`⚠ كمية الوجبات الخارجية المتاحة أقل من المخطط: ${external().shortages.map(x=>x.item.name).join('، ')}`);
  if(a.extraDue>0)warnings.push(`${pendingExtras.length} فاتورة طاولة تنتظر التحصيل`);
  if(a.bookingDue>0)warnings.push('حجوزات غير مسددة');
  root.innerHTML=`<div class="event-detail-head-v034">
    <div><a class="event-back-v034" href="#/${view==='booking'?'event-reservations':'events-list'}">→ ${view==='booking'?'قائمة الحجوزات':'قائمة الحفلات'}</a><h2>${esc(e.name)}</h2><p class="event-context-title-v040">${view==='booking'?'الحجوزات والتحصيل وتوزيع المقاعد':'تجهيز الحفلة والتكلفة والتسعير'}</p>
      <p>${dateOnly(e.event_date)} · ${badge(e.status)} · ${esc(e.event_type==='public'?'حفلة عامة':'حفلة خاصة')}</p></div>
    <div class="quick-actions"><button class="btn secondary" id="event-refresh-v034">تحديث ↻</button>
      ${view==='planning'&&editing()?`<button class="btn secondary" id="event-status-v034">تغيير الحالة</button><button class="btn secondary" id="event-plan-v034">خطة الحفلة والتسعير</button>`:''}<a class="btn ${view==='booking'?'secondary':''}" href="#/${view==='booking'?'event':'event-bookings'}/${esc(eventId)}">${view==='booking'?'فتح خطة الحفلة':'الانتقال إلى الحجوزات ←'}</a></div></div>
   ${view==='planning'?`<div class="event-plan-steps-v040"><span>1 · تجهيز القاعة</span><span>2 · خطة الضيافة</span><span>3 · التكاليف والتسعير</span><span>4 · الربح المتوقع والنتيجة</span></div>
   <div class="grid cols-4 event-kpis-v034 event-planning-kpis-v040">
    <div class="card"><div class="metric-label">تكلفة الضيف المخططة</div><div class="metric-value">${q.costPerPerson==null?'—':moneyBase(q.costPerPerson)}</div><small>${q.missing?'⚠ هناك أصناف بلا تكلفة':estimatedRows().length?'⚠ تشمل تكاليف تقديرية':'تشمل الضيافة والمصاريف والاحتياط'}</small></div>
    <div class="card"><div class="metric-label">سعر التذكرة المعتمد للشخص</div><div class="metric-value">${num(e.default_price_original)>0?moneyTicket(e.default_price_original):'غير محدد'}</div><small>${q.reliable&&num(e.default_price_original)>0&&q.marginPercent!=null?'هامش الربح حسب السعر الحالي '+q.marginPercent.toFixed(1)+'%':'حدد السعر بعد إدخال التكاليف'}</small></div>
    <div class="card"><div class="metric-label">الربح المتوقع عند بيع جميع التذاكر</div><div class="metric-value ${q.profit<0?'payroll-danger-v034':''}">${moneyBase(q.profit)}</div><small>سعر التذكرة المحدد: ${moneyTicket(e.default_price_original||0)}</small></div>
    <div class="card ${pendingExtras.length?'event-kpi-due-v034':''}"><div class="metric-label">فواتير إضافية تنتظر التحصيل</div><div class="metric-value">${pendingExtras.length}</div><small>${moneyTicket(a.extraDue)} · غير مدفوع</small></div>
   </div>
   <p class="event-plan-disclaimer-v040">الربح المخطط يفترض بيع جميع التذاكر المستهدفة، ولا يعني أنه تم قبض المبلغ أو تحقيق الربح حتى الآن.</p>`:
   `<div class="grid cols-4 event-booking-kpis-v040">
    <div class="card"><span class="metric-label">سعر التذكرة المحفوظ</span><strong>${moneyTicket(e.default_price_original)}</strong><small>يُحدد مرة واحدة ضمن إعداد خطة الحفلة</small></div>
    <div class="card"><span class="metric-label">المقاعد المحجوزة</span><strong>${bookingStats().reserved} / ${bookingStats().capacity}</strong><small>${bookingStats().openCapacity} كرسيًا متاحًا للحجز على طاولات غير محجوزة</small></div>
    <div class="card"><span class="metric-label">المقبوض من الحجوزات</span><strong>${moneyTicket(bookingStats().received)}</strong><small>أموال قبضت فعليًا من الصندوق</small></div>
    <div class="card"><span class="metric-label">المتبقي على الحجوزات</span><strong>${moneyTicket(bookingStats().due)}</strong><small>مستحق لم يُقبض بعد</small></div>
   </div><div class="event-guest-plan-strip-v039"><div><small>العدد المخطط</small><strong>${bookingStats().target}</strong></div><div><small>المحجوز</small><strong>${bookingStats().reserved}</strong></div><div><small>قابل للحجز الآن</small><strong>${Math.min(bookingStats().remainingTarget,bookingStats().openCapacity)}</strong></div><p>العدد المخطط لا يتغير بالحجز. توجد ${bookingStats().bookedTableVacancies} مقاعد غير مستخدمة على طاولات محجوزة، وهي غير متاحة لحجز مستقل لحماية مجموعات الضيوف.</p></div>`}
   ${view==='planning'&&warnings.length?`<div class="event-warning-line-v034">⚠ ${warnings.map(x=>esc(x)).join(' · ')}</div>`:''}
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
  if(tab==='seat-map')return bookingSeatMapHtml();
  if(tab==='demand')return demandHtml();
  if(tab==='demand-service')return demandServiceHtml();
  if(tab==='bookings')return bookingsHtml();
  if(tab==='menu')return menuHtml();
  if(tab==='external')return externalHtml();
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
  const difference=seating().capacity-num(e.planned_guest_count);
  return `<div class="grid cols-2 event-dashboard-panels-v034"><section class="card"><div class="finance-section-head"><div><h3>تحليل ميزانية الحفلة</h3><p>تفصيل تكلفة الضيافة والفرقة والمصاريف والاحتياط قبل بدء الحفلة.</p></div>${editing()?'<button class="event-ctrl-v036 subtle" data-action="open-plan">⚙ ضبط السعر والهامش</button>':''}</div>
   <div class="event-budget-row-v034"><span>طعام ومشروبات</span><strong>${moneyBase(q.food)}</strong></div>
   <div class="event-budget-row-v034"><span>ضيافة مشتراة خارجياً ضمن تكلفة الطعام</span><strong>${moneyBase(q.externalFood)}</strong></div>
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
  <div class="notice green event-tip-v034"><strong>تسعير واضح:</strong> أدخل التكاليف ثم افتح «تعديل خطة الحفلة». أدخل نسبة الربح ليحسب السعر لأعلى مئة ليرة، أو أدخل السعر ليعرض هامش الربح. لا يعتمد الحساب على تكاليف أصناف ناقصة.</div>`;
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
     <div class="event-table-actions-v034">${!readOnly?`<button class="mini-btn event-action-v035 accent" data-table-extra="${esc(t.id)}">+ طلب إضافي</button>`:''}<button class="mini-btn event-action-v035" data-table-invoice="${esc(t.id)}">كشف الطاولة ↗</button><button class="mini-btn event-action-v035" data-tab-switch="extras">الفواتير</button></div>
    </article>`;
   }).join('')}</div>`:empty('أضف أول طاولة لتظهر خريطة المقاعد.')}
   <p class="metric-note">تُعرض هنا كميات الضيافة الثابتة لكل طاولة. سجلات التقديم حسب الطلب تُحسب فقط عند تقديمها فعليًا، ولا تُخصم الكميات غير المقدّمة.</p></section>`;
 }
 function bookingSeatMapHtml(){
  const active=state.tables.filter(t=>t.status!=='cancelled'),locked=!editing();
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>خريطة حجوزات الطاولات</h3><p>الطاولات المحجوزة ملوّنة، والعدد الحر يظهر مباشرة. اضغط «حجز» داخل الطاولة الشاغرة لفتح نموذجها.</p></div><button type="button" class="btn secondary" data-action="add-booking" ${locked?'disabled':''}>＋ حجز جديد</button></div>
  <div class="event-seat-map-v034 event-booking-seat-map-v040">${active.map(t=>{
   const used=t.booking_id?num(t.planned_guest_count):0,free=Math.max(0,num(t.capacity)-used);
   const current=state.bookings.find(b=>String(b.id)===String(t.booking_id));
   const dots=Array.from({length:Math.min(20,num(t.capacity))},(_,i)=>`<span class="${i<used?'filled':'empty-seat'}">●</span>`).join('');
   return `<article class="event-table-card-v034 event-booking-map-card-v040 ${used?'is-booked':''}"><div class="event-table-card-title-v034"><div><strong>${esc(t.table_label)}</strong><small>${used?'محجوزة':'متاحة للحجز'}</small></div><span class="badge ${used?'yellow':'green'}">${used?'محجوز':'متاح'}</span></div>
    <div class="event-table-illustration-v034"><div class="event-table-disc-v034">${used} / ${esc(t.capacity)}</div><div class="event-seat-dots-v034">${dots}</div></div>
    <div class="event-table-numbers-v034"><span>المقاعد ${used?'غير المستخدمة في هذا الحجز':'المتاحة للحجز'}</span><strong>${free}</strong></div>
    ${current?`<div class="event-table-numbers-v034"><span>صاحب الحجز</span><strong>${esc(current.customer_name)}</strong></div>`:''}
    <div class="event-table-actions-v034">${used?'<span class="event-seat-map-note-v040">محجوزة بالكامل لهذه المجموعة · المقاعد الباقية ليست متاحة لحجز مستقل</span>':`<button type="button" class="event-ctrl-v036 primary" data-table-book="${esc(t.id)}" ${locked?'disabled':''}>حجز هذه الطاولة</button>`}
    <button type="button" class="event-ctrl-v036 subtle" data-demand-for-table="${esc(t.id)}" ${state.onDemandItems.length&&editing()?'':'disabled'}>تسجيل تقديم ضيافة</button></div></article>`;
  }).join('')}</div></section>`;
 }
 function demandHtml(){
  const rows=demand(),tot=demandTotal();
  return `<div class="event-demand-intro-v040"><strong>ضيافة حسب الطلب · لا تُحسب الكمية المتاحة مستهلكة</strong><p>خصص حدًا أعلى للصنف، ثم سجّل ما قُدّم فعلًا لكل طاولة أثناء الحفلة. الكمية التي لم تُقدّم تبقى متاحة، ولا نُسجلها هدرًا تلقائيًا.</p></div>
   <div class="grid cols-3 event-demand-kpis-v040"><div class="card"><div class="metric-label">ميزانية الحد الأقصى للتقديم</div><div class="metric-value">${moneyBase(tot.planned)}</div><small>تقدير للسقف المخطط، لا استهلاك فعلي</small></div>
    <div class="card"><div class="metric-label">تكلفة الحصص المقدمة</div><div class="metric-value">${moneyBase(tot.delivered)}</div><small>تكلفة تقديرية لما تم تقديمه فقط</small></div>
    <div class="card"><div class="metric-label">أصناف ناقصة التكلفة</div><div class="metric-value">${tot.unknown}</div><small>يمكن حفظ تكلفة تقديرية لها من إعداد الصنف</small></div></div>
   <section class="card finance-section"><div class="finance-section-head"><div><h3>الأصناف المتاحة عند الطلب</h3><p>لا تختلط بالضيافة الثابتة. يُمنع اختيار الصنف نفسه في المسارين كي لا تتضاعف التكلفة.</p></div>${editing()?'<button type="button" class="btn" data-action="add-demand">＋ تخصيص صنف حسب الطلب</button>':''}</div>
   ${rows.length?`<div class="table-wrap"><table class="table event-demand-table-v040"><thead><tr><th>الصنف</th><th>الحد المتاح</th><th>قُدّم فعليًا</th><th>المتبقي</th><th>تكلفة تقديم ما استُهلك</th><th>إجراء</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.name)}</strong><small>${x.isOutside?'شراء خارجي':'صنف من مطبخ المطعم'}${x.actualCostIsEstimate?' · تكلفة تقديرية':''}</small></td>
    <td>${portionDisplayV039(x.maximum_servings)} ${esc(x.unit_label)}</td><td>${portionDisplayV039(x.used)} ${esc(x.unit_label)}</td><td><strong>${portionDisplayV039(x.remaining)} ${esc(x.unit_label)}</strong></td><td>${x.consumedCost==null?'تكلفة غير محددة':moneyBase(x.consumedCost)}</td><td>${editing()?`<div class="event-row-actions-v036"><button type="button" class="event-ctrl-v036 subtle" data-demand-edit="${esc(x.id)}">تعديل الحد</button><button type="button" class="event-ctrl-v036 primary" data-demand-issue="${esc(x.id)}">تسجيل تقديم</button></div>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:empty('لم يُخصص أي صنف حسب الطلب. ابدأ بتحديد نوع الصنف والكمية المتاحة.')}
    <div class="event-footnote-v034">الحد الأعلى احتياط تخطيطي وليس مبلغًا مصروفًا ولا خروجًا من المخزون. عند إقفال الحفلة تُرحّل وصفات المطعم للكميات المقدّمة فعليًا فقط. الوجبات الخارجية تُحاسَب من قيمة الشراء كاملة، وما تبقّى ليس هدرًا تلقائيًا.</div></section>`;
 }
 function demandServiceHtml(){
  const rows=demand(),recent=state.onDemandIssues.slice().reverse();
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>تقديم الضيافة عند طلب الطاولات</h3><p>اختر الصنف والطاولة والعدد المقدّم. الحصص التي لم تطلبها الطاولات لا تُسجل كمستهلكة.</p></div>${rows.length&&editing()?'<button class="btn" data-action="issue-demand">＋ تسجيل تقديم</button>':''}</div>
   ${rows.length?`<div class="event-demand-available-v040">${rows.map(x=>`<div><strong>${esc(x.name)}</strong><span>${portionDisplayV039(x.remaining)} ${esc(x.unit_label)} متبقية من ${portionDisplayV039(x.maximum_servings)}</span><button type="button" class="event-ctrl-v036 primary" data-demand-issue="${esc(x.id)}" ${x.remaining<=0||!editing()?'disabled':''}>تقديم للطاولة</button></div>`).join('')}</div>`:empty('لا توجد أصناف حسب الطلب. أضفها أولًا من «بناء الحفلة ← ضيافة حسب الطلب».')}
   ${recent.length?`<h4>سجل التقديمات</h4><div class="table-wrap"><table class="table"><thead><tr><th>التاريخ</th><th>الصنف</th><th>الطاولة</th><th>الكمية</th><th>الحالة</th><th></th></tr></thead><tbody>${recent.map(i=>{const row=rows.find(x=>String(x.id)===String(i.on_demand_id));return `<tr><td>${esc(new Date(i.created_at).toLocaleString('ar-SY'))}</td><td>${esc(row?.name||'—')}</td><td>${esc(state.tables.find(t=>String(t.id)===String(i.table_id))?.table_label||'—')}</td><td>${esc(portionDisplayV039(i.servings))} ${esc(row?.unit_label||'')}</td><td>${i.voided_at?'ملغى':'قُدّم'}</td><td>${!i.voided_at&&editing()?`<button type="button" class="event-ctrl-v036 danger" data-demand-void="${esc(i.id)}">إلغاء التسجيل</button>`:''}</td></tr>`;}).join('')}</tbody></table></div>`:''}</section>`;
 }
 function openDemandPlan(original=null){
  const isEdit=!!original,items=[...state.menuCosts.filter(x=>x.is_active).map(x=>({id:'menu:'+x.id,name:x.name,kind:'menu'})),...state.externalDishes.filter(x=>x.is_active!==false).map(x=>({id:'external:'+x.id,name:x.name,kind:'external'}))];
  if(!items.length){toast('أضف صنفًا إلى المنيو أو سجّل شراءً خارجيًا أولًا.','error');return;}
  const defaultSource=original?(original.menu_item_id?'menu:'+original.menu_item_id:'external:'+original.external_dish_id):items[0].id;
  const dlg=modal({title:isEdit?'تعديل حد الضيافة حسب الطلب':'صنف متاح حسب الطلب',subtitle:'حدد كمية يمكن تقديمها عند الطلب. لا تُحتسب كلها مصروفًا لمجرد وجودها.',submitText:'حفظ حد الضيافة',
   body:`<div class="form-grid"><div class="field full"><label>مصدر الصنف</label><select name="source" ${isEdit?'disabled':''}>${opts(items.map(x=>[x.id,x.name+' · '+(x.kind==='menu'?'المنيو':'شراء خارجي')]),defaultSource)}</select></div>
    <div class="field full"><label>وحدة الحصة</label><select name="conversion"></select><button type="button" class="event-ctrl-v036 subtle" data-add-demand-unit style="margin-top:9px">＋ إضافة وحدة وتحويلها هنا</button><small>التحويل يربط وحدة الصنف الأصلية بعدد الحصص الصغيرة الناتجة منها، ولا تحتاج للخروج من النموذج.</small></div>
    <div class="field"><label>أقصى عدد حصص متاحة للتقديم</label><input name="limit" type="number" min="0.0001" max="1000000" step="0.0001" value="${esc(original?.maximum_servings??100)}" required></div>
    <div class="field full"><label>ملاحظة تشغيلية (اختياري)</label><textarea name="note" maxlength="500" rows="2">${esc(original?.note||'')}</textarea></div></div>
    <div class="notice green">هذا العدد يمثل الحد المتاح. ما يُقدَّم فعليًا يُسجل للطاولة، والمتبقي لا يُستهلك تلقائيًا.</div>`,
   onSubmit:async fd=>{
    const source=String(fd.get('source')||defaultSource),kind=source.startsWith('external:')?'external':'menu',id=source.slice(kind==='external'?9:5);
    const maximum=Number(fd.get('limit'));if(!(maximum>0)||maximum>1000000){toast('أدخل حدًا موجبًا للحصص المتاحة.','error');return false;}
    return commit(()=>api.eventSaveOnDemandV040(eventId,{menuItemId:kind==='menu'?id:null,externalDishId:kind==='external'?id:null,conversionId:fd.get('conversion')||null,limit:maximum,note:fd.get('note')}),'حُفظت الكمية المتاحة للتقديم عند الطلب.');
   }});
  const source=dlg.form.elements.namedItem('source'),conversion=dlg.form.elements.namedItem('conversion');
  const updateOptions=()=>{
   const id=String(source.value),kind=id.startsWith('external:')?'external':'menu',raw=id.slice(kind==='external'?9:5);
   const rows=kind==='external'?state.externalConversions.filter(x=>String(x.dish_id)===raw).map(x=>[x.id,x.serving_label+' · '+portionDisplayV039(x.servings_per_purchase_unit)+' لكل وحدة شراء']):state.servingConversions.filter(x=>String(x.menu_item_id)===raw).map(x=>[x.id,x.serving_label+' · '+portionDisplayV039(x.servings_per_menu_item)+' لكل وجبة من المنيو']);
   conversion.innerHTML=opts([['','الوحدة الكاملة للصنف'],...rows],'');
   if(isEdit){const matching=rows.find(([id])=>{
    const row=kind==='external'?state.externalConversions.find(z=>String(z.id)===id):state.servingConversions.find(z=>String(z.id)===id);
    return row&&(row.serving_label===original.unit_label);
   });if(matching)conversion.value=matching[0];}
  };
  source.addEventListener('change',updateOptions);updateOptions();
  dlg.form.querySelector('[data-add-demand-unit]').onclick=()=>{
   const src=String(source.value),outside=src.startsWith('external:'),id=src.slice(outside?9:5);
   const label=items.find(x=>x.id===src)?.name||'الصنف';
   modal({title:'وحدة تقديم جديدة',subtitle:label+' · حفظ التحويل يجعلها متاحة مباشرة لهذه الحفلة وما يليها لهذا الصنف.',submitText:'حفظ واختيار الوحدة',
    body:`<div class="form-grid"><div class="field full"><label>اسم وحدة التقديم</label><input name="unit" maxlength="60" required placeholder="قطعة، كوب، حصة أو أي وحدة أخرى"></div><div class="field full"><label>كم حصة تنتج من وحدة ${outside?'الشراء':'المنيو'} الواحدة؟</label><input type="number" name="yieldCount" min="0.0001" step="0.0001" max="100000" required placeholder="أدخل العدد الصحيح بحسب هذا الصنف"></div></div><div class="notice green">مثال حساب عام: إذا كانت وحدة الشراء الواحدة تُنتج 20 حصة، فخمس حصص تعادل ربع وحدة شراء.</div>`,
    onSubmit:async fd=>{try{
     const name=String(fd.get('unit')||'').trim(),yieldCount=Number(fd.get('yieldCount'));
     if(!name||!(yieldCount>0)||yieldCount>100000)throw Error('EVENT_ON_DEMAND_UNIT_INVALID');
     const savedId=outside?await api.eventAddExternalUnitV039(id,name,yieldCount):await api.eventCreateServingUnitV037(id,{name,yieldCount});
     if(outside){const rows=await api.eventExternalUnitsV039(id);state.externalConversions=state.externalConversions.filter(x=>String(x.dish_id)!==id).concat(rows);}
     else state.servingConversions=await api.menuServingConversionsV036();
     if(dlg.element.isConnected){updateOptions();conversion.value=String(savedId);}
     toast('حُفظ تحويل الحصة واختير مباشرة.','success');return true;
    }catch(e){toast(toError(e),'error');return false;}}
   });
  };
 }
 function openDemandIssue(itemId=null,tableId=null){
  const rows=demand().filter(x=>x.remaining>0);
  if(!rows.length){toast('لا توجد حصص متاحة حسب الطلب.','error');return;}
  const item=rows.find(x=>String(x.id)===String(itemId))||rows[0];
  const activeTables=state.tables.filter(t=>t.status!=='cancelled');
  const dlg=modal({title:'تسجيل تقديم ضيافة للطاولة',subtitle:'يسجّل فقط ما قُدّم للضيف، وليس كامل الحد المتاح.',submitText:'تأكيد تقديم الحصص',
   body:`<div class="form-grid"><div class="field full"><label>الصنف المتاح</label><select name="item">${opts(rows.map(x=>[x.id,x.name+' · متبقٍ '+portionDisplayV039(x.remaining)+' '+x.unit_label]),item.id)}</select></div>
    <div class="field"><label>الطاولة</label><select name="table" required>${opts(activeTables.map(t=>[t.id,t.table_label]),tableId||activeTables[0]?.id)}</select></div>
    <div class="field"><label>عدد الحصص المقدمة</label><input name="quantity" type="number" required min="0.0001" max="${esc(item.remaining)}" step="0.0001" value="1"></div>
    <div class="field full"><label>ملاحظة (اختياري)</label><textarea name="note" rows="2" maxlength="500"></textarea></div></div><div class="event-booking-price-preview-v038" data-demand-preview-v040></div>`,
   onSubmit:async fd=>{const chosen=rows.find(x=>x.id===fd.get('item')),q=Number(fd.get('quantity'));
    if(!chosen||!Number.isFinite(q)||q<=0||q>chosen.remaining+.00001){toast('الكمية أكبر من الرصيد أو غير صحيحة.','error');return false;}
    return commit(()=>api.eventIssueOnDemandV040(chosen.id,fd.get('table'),q,fd.get('note')),'تم تسجيل الحصص التي قُدّمت فعليًا للطاولة.');}
  });
  const f=dlg.form,itemSelect=f.elements.namedItem('item'),qty=f.elements.namedItem('quantity'),preview=f.querySelector('[data-demand-preview-v040]');
  const refresh=()=>{const row=rows.find(x=>String(x.id)===String(itemSelect.value));if(!row)return;qty.max=row.remaining;
   preview.innerHTML=`<strong>${portionDisplayV039(row.remaining)} ${esc(row.unit_label)} متاحة</strong><small>التكلفة المقدرة للحصص التي سيسجل تقديمها: ${row.unitCost===null?'تكلفة غير محددة':moneyBase(num(qty.value)/num(row.servings_per_source_unit)*row.unitCost)}</small>`;};
  itemSelect.addEventListener('change',refresh);qty.addEventListener('input',refresh);refresh();
 }
 function bookingSummary(b){
  return eventGuestSummaryV038(b.customer_name,state.guests.filter(g=>g.booking_id===b.id).map(g=>g.guest_name),b.guest_count);
 }
 function bookingsHtml(){
  const readOnly=!editing();
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>الحجوزات والتحصيل</h3><p>حدد الطاولة بالبحث، وزّع المجموعة بين الطاولات بحرية، ثم راجع السعر الإجمالي قبل قبض المال.</p></div>${!readOnly?'<button class="btn" data-action="add-booking">＋ حجز جديد</button>':''}</div>
  <p class="metric-note">عند الحجز يمكن تحديد «المبلغ مقبوض» ليُسجّل الحجز وحركة الصندوق دفعة واحدة. أو اتركه غير مقبوض ليظهر في المستحقات.</p>
  ${state.bookings.length?`<div class="table-wrap"><table class="table event-booking-table-v034"><thead><tr><th>صاحب الحجز والمرافقون</th><th>الأشخاص</th><th>الطاولات</th><th>سعر الشخص</th><th>إجمالي الحجز</th><th>المقبوض</th><th>المتبقي</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>
   ${state.bookings.map(b=>{const balance=state.bookingBalances.find(x=>x.booking_id===b.id)||{},assignedTables=state.tables.filter(t=>t.booking_id===b.id),due=num(balance.balance_original),paid=num(balance.paid_original),total=num(b.agreed_amount_original),zero=total<=0;
    return `<tr><td><strong>${esc(b.customer_name)}</strong><small>${esc(b.customer_phone||'—')}</small><small class="event-guest-summary-v038">${esc(bookingSummary(b))}</small></td><td>${esc(b.guest_count)}</td><td>${esc(assignedTables.map(t=>t.table_label).join(' + ')||'بدون طاولة')}</td>
    <td>${moneyTicket(num(b.guest_count)?total/num(b.guest_count):0)}</td><td><strong>${moneyTicket(total)}</strong></td><td>${moneyTicket(paid)}</td><td><strong class="${due>0?'payroll-danger-v034':''}">${moneyTicket(due)}</strong></td>
    <td>${esc(EVENT_BOOKING_STATUS_AR_V038[b.status]||statusLabel[b.status]||b.status||'حجز')}</td>
    <td><div class="event-booking-actions-v038">${editing()&&paid<=0?`<button type="button" class="event-ctrl-v036 subtle" data-book-amount="${esc(b.id)}">${zero?'تحديد القيمة':'تعديل القيمة'}</button>`:''}
    ${zero?'<span class="badge yellow">بلا سعر محدد</span><small>حدد قيمة الحجز أولًا</small>':due>0?`<button type="button" class="event-ctrl-v036 primary" data-book-pay="${esc(b.id)}" ${!editing()?'disabled':''}>تحصيل المتبقي</button>`:'<span class="badge green">مقبوض بالكامل</span>'}</div></td></tr>`;
   }).join('')}</tbody></table></div>`:empty('لا توجد حجوزات بعد. أضف حجزًا واختر أي طاولة متاحة.')}</section>`;
 }
 function externalRuleRows(groupId=null){
  const detail=external(),visible=detail.lines.filter(l=>String(l.rule.group_id||'')===String(groupId||''));
  if(!visible.length)return '';
  return `<div class="event-external-lines-v038"><div class="event-external-subtitle-v038">🥡 وجبات مشتراة خارجياً ضمن هذه الضيافة</div><div class="table-wrap"><table class="table event-external-rule-table-v038"><thead><tr><th>الوجبة</th><th>التقديم</th><th>المطلوب للحفلة</th><th>تكلفة التقديم</th><th>إجراء</th></tr></thead><tbody>${visible.map(l=>{
   const rule=l.rule,item=l.item;
   const method=rule.rule_type==='per_n_people'?`لكل ${esc(rule.people_per_rule)} أشخاص على طاولة`:(EVENT_RULE_NAMES_V034[rule.rule_type]||rule.rule_type);
   return `<tr><td><strong>${esc(item?.name||'صنف محذوف')}</strong><small>${esc(item?.vendor||'شراء خارجي')} · ${esc(item?.unit_label||'حصة')}</small></td><td>${method} · ${esc(portionDisplayV039(rule.servings_per_distribution??rule.quantity_per_distribution))} ${esc(l.label||'حصة')}</td>
     <td>${esc(portionDisplayV039(l.servings))} ${esc(l.label||'حصة')} <small>يعادل ${esc(portionDisplayV039(l.required))} ${esc(item?.unit_label||'وحدة شراء')}</small></td><td>${moneyBase(l.cost)}</td><td>${editing()?`<button type="button" class="event-ctrl-v036 subtle" data-external-rule-edit="${esc(rule.id)}">تعديل</button> <button type="button" class="event-ctrl-v036 danger" data-external-rule-delete="${esc(rule.id)}">حذف</button>`:'—'}</td></tr>`;
  }).join('')}</tbody></table></div></div>`;
 }
 function menuHtml(){
  const q=quote();
  const metas=new Map(state.servingRules.map(m=>[String(m.rule_id),m]));
  const grouping=hospitalityGroupsV037({groups:state.eventGroups,servingRules:state.servingRules,
   requirements:planRequirements(),guests:state.event.planned_guest_count});
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
    const estimated=Boolean(r.v039_cost_is_estimate);
    return `<tr class="${missing?'event-menu-incomplete-v036':''}"><td><strong>${esc(r.menu_item_name)}</strong>${missing?'<small>⚠ وصفة أو سعر تكلفة ناقص</small>':estimated?'<small class="event-estimate-label-v039">تقدير مخطط · ليس تكلفة فعلية</small>':''}</td>
    <td>${method}</td><td><strong>${serving}</strong>${ratio}</td>
    <td><strong>${esc(r.required_quantity)}</strong><small>بوحدة صنف المنيو الأصلية</small></td>
    <td>${missing?'<span class="event-cost-missing-v036">⚠ غير مكتملة</span>':`<strong>${moneyBase(r.estimated_food_cost_base)}</strong>${estimated?'<small>تقديري</small>':''}`}</td>
    <td>${editing()?`<div class="event-row-actions-v036"><button type="button" class="event-ctrl-v036 subtle" data-rule-edit="${esc(r.rule_id)}">✎ تعديل</button><button type="button" class="event-ctrl-v036 danger" data-rule-delete="${esc(r.rule_id)}">حذف</button></div>`:'—'}</td></tr>`;
   }).join('')}</tbody></table></div>`:empty('هذه المجموعة فارغة. أضف أول صنف إليها.');
  const renderGroup=group=>{
   const rows=rowsForGroup(group.id);
   const outsideRows=external().lines.filter(l=>String(l.rule.group_id||'')===String(group.id));
   const stats=grouping.groups.find(x=>String(x.group.id)===String(group.id));
   const missing=Boolean(stats?.missing);
   const groupTotal=(stats?.cost||0)+external().lines.filter(l=>String(l.rule.group_id||'')===String(group.id)).reduce((sum,l)=>sum+l.cost,0);
   const avgPerGuest=num(state.event.planned_guest_count)>0?groupTotal/num(state.event.planned_guest_count):null;
   return `<div class="event-main-plate-v036 event-named-group-v037" data-group-card="${esc(group.id)}"><div class="event-main-plate-head-v036"><div><div class="event-kicker-v036">🍽 مجموعة ضيافة</div><h3>${esc(group.name)}</h3><p>${rows.length+outsideRows.length} مكوّن · حصص مرنة لكل ضيف أو طاولة أو مجموعة ضيوف. كل التكلفة محسوبة من الأصناف الأصلية.</p></div>
   ${editing()?`<div class="event-main-actions-v036"><button type="button" class="event-ctrl-v036 primary" data-group-add="${esc(group.id)}">＋ إضافة مكوّن</button><button type="button" class="event-ctrl-v036 subtle" data-group-edit="${esc(group.id)}">✎ تعديل الاسم</button><button type="button" class="event-ctrl-v036 danger" data-group-delete="${esc(group.id)}">حذف المجموعة</button></div>`:''}</div>
   ${rows.length?lineTable(rows,'event-group-lines-v037',group.id):outsideRows.length?'':empty('أضف أول صنف إلى هذه المجموعة.')}${externalRuleRows(group.id)}
   <div class="event-plate-summary-v036"><span>إجمالي تكلفة «${esc(group.name)}» للحفلة</span><strong>${missing?'⚠ تكلفة غير مكتملة':moneyBase(groupTotal)}</strong><span>متوسطها لكل ضيف مخطط</span><strong>${missing||avgPerGuest==null?'—':moneyBase(avgPerGuest)}</strong></div></div>`;
  };
  return `<section class="card finance-section event-host-v036"><div class="finance-section-head event-menu-heading-v036"><div><h3>مجموعات الضيافة ومكوناتها</h3><p>أنشئ مجموعات بالاسم الذي تريده: الصحن الرئيسي، المقبلات، الحلويات، الضيافة الخاصة… ثم أضف أصناف كل مجموعة.</p></div>
   ${editing()?'<div class="event-main-actions-v036"><button type="button" class="event-ctrl-v036 primary" data-action="add-event-group">＋ إنشاء مجموعة</button><button type="button" class="event-ctrl-v036 subtle" data-action="add-rule">＋ صنف مستقل</button></div>':''}</div>
   <div class="event-guide-v036"><div><span class="event-guide-icon-v036">①</span><strong>أنشئ مجموعة</strong><small>مثلاً المقبلات أو الصحن الرئيسي</small></div><div><span class="event-guide-icon-v036">②</span><strong>أضف الأصناف وحصصها</strong><small>قطعة لكل ضيف أو جاط لكل أربعة</small></div><div><span class="event-guide-icon-v036">③</span><strong>اعرف تكلفة كل مجموعة</strong><small>والتكلفة الإجمالية للحفلة</small></div></div>
   ${q.missing?`<div class="notice">⚠ هناك ${q.missing} صنف بلا تكلفة، ويمكن إضافة تكلفة تقديرية من نافذة الصنف لتخطيط الحفلة.</div>`:''}${estimatedRows().length?`<div class="notice">⚠ استخدمنا تقديرات محفوظة لـ ${estimatedRows().length} صنف. هذه أرقام للتخطيط ولا تُغني عن تكاليف الوصفات والمخزون الفعلية عند الإقفال.</div>`:''}
   ${state.eventGroups.length?state.eventGroups.map(renderGroup).join(''):`<div class="event-main-plate-v036 event-empty-group-v037"><strong>لا توجد مجموعات ضيافة بعد.</strong><p>ابدأ بمجموعة «الصحن الرئيسي»، «المقبلات» أو أي مجموعة تناسب حفلتك. يمكنك إنشاء العدد الذي تحتاجه.</p>${editing()?'<button type="button" class="event-ctrl-v036 primary" data-action="add-event-group">＋ إنشاء أول مجموعة</button>':''}</div>`}
   <div class="event-regular-menu-v036"><div class="event-menu-subhead-v036"><h3>أصناف مستقلة خارج المجموعات</h3><small>يمكنك ترك بعض الأصناف مستقلة، مثل مشروبات أو جاطات خاصة</small></div>${lineTable(regular,'event-extra-lines-v036')}${externalRuleRows(null)}</div>
   <div class="event-footnote-v034">يُحسب مقدار التقديم على أساس الوحدة وتحويلها المحفوظين للصنف، وتُعرض التكلفة النهائية تلقائيًا. مجموعات الضيافة ليست وصفات مكررة: كل صنف يحسب مرة واحدة وفق قاعدة تقديمه. متوسط تكلفة المجموعة هو إجمالي تكلفتها ÷ عدد الضيوف المتوقع.</div>
   <div class="event-total-line-v034"><span>إجمالي تكلفة الضيافة المخططة (كل المجموعات + الأصناف المستقلة)</span><strong>${q.missing?'⚠ تكلفة غير مكتملة':moneyBase(q.food)}</strong></div></section>`;
 }
 function externalHtml(){
  const d=external(),items=state.externalDishes.filter(x=>x.is_active!==false),paid=items.filter(x=>x.paid_at).length;
  return `<section class="card finance-section event-external-section-v038">
   <div class="finance-section-head"><div><h3>شراء وجبات من خارج المطعم</h3><p>سجل الوجبة والكمية المشتراة وسعر الشراء. تصبح جاهزة فورًا للاستخدام في مجموعات الضيافة أو أصناف مستقلة، من دون إنشاء وصفة أو حركة مخزون.</p></div>
   ${editing()?'<button type="button" class="event-ctrl-v036 primary" data-action="external-new">＋ تسجيل وجبة خارجية</button>':''}</div>
   <div class="event-external-kpis-v038"><div><span>قيمة المشتريات المسجلة</span><strong>${moneyBase(d.purchasedCost)}</strong></div><div><span>تكلفة المقدّم حسب الخطة</span><strong>${moneyBase(d.plannedCost)}</strong></div><div><span>مشتريات دُفعت من الصندوق</span><strong>${paid} من ${items.length}</strong></div></div>
   ${d.shortages.length?`<div class="notice">⚠ الكميات المخطط تقديمها تتجاوز ما تم تسجيل شرائه: ${esc(d.shortages.map(x=>x.item.name+' · المطلوب '+portionDisplayV039(x.needed)+' '+x.item.unit_label+'، المشترى '+x.item.purchased_quantity).join(' | '))}. أضف شراءً آخر أو عدّل التقديم.</div>`:''}
   ${items.length?`<div class="table-wrap"><table class="table event-external-purchases-table-v038"><thead><tr><th>الوجبة والمورد</th><th>الكمية المشتراة</th><th>تكلفة الحصة</th><th>إجمالي الشراء</th><th>السداد</th><th>الإجراء</th></tr></thead><tbody>${items.map(x=>`<tr><td class="event-vendor-name-v040"><strong>${esc(x.name)}</strong><small>${esc(x.vendor||'المورد غير محدد')}</small></td><td>${esc(portionDisplayV039(x.purchased_quantity))} ${esc(x.unit_label)}</td><td>${moneyBase(x.unit_cost_base)}</td><td><strong>${moneyBase(x.total_cost_base)}</strong></td><td>${x.paid_at?'<span class="badge green">مدفوع من الصندوق</span>':num(x.total_cost_base)<=0?'<span class="badge">بلا تكلفة نقدية</span>':'<span class="badge yellow">غير مدفوع</span>'}</td><td><div class="event-row-actions-v036">${editing()?`<button type="button" class="event-ctrl-v036 primary" data-external-use="${esc(x.id)}">＋ أضف للضيافة</button>${!x.paid_at&&num(x.total_cost_base)>0?`<button type="button" class="event-ctrl-v036 subtle" data-external-pay="${esc(x.id)}">دفع الشراء</button>`:''}${!x.paid_at?`<button type="button" class="event-ctrl-v036 danger" data-external-void="${esc(x.id)}">إلغاء</button>`:''}`:'—'}</div></td></tr>`).join('')}</tbody></table></div>`:empty('لم تُسجّل وجبات مشتراة من الخارج. سجّل وجبة لتصبح متاحة لتخطيط محتوى الطاولات.')}
   <div class="event-footnote-v034">يظهر المخطط بناءً على الحصص المقررة للطاولات، بينما تُحمَّل التكلفة الفعلية للشراء كله على الحفلة (بما فيه الكمية غير المقدمة). دفع المورد حركة نقدية منفصلة، ولا يضيف تكلفة ثانية. لا يُخصم مخزون مواد المطعم للوجبات الخارجية.</div>
   <div class="event-external-rule-head-v038"><h3>أين ستُقدّم هذه الوجبات؟</h3>${editing()&&items.length?'<button type="button" class="event-ctrl-v036 subtle" data-action="external-rule-new">＋ تحديد تقديم خارجي</button>':''}</div>
   ${d.lines.length?`<div class="table-wrap"><table class="table event-external-plans-table-v038"><thead><tr><th>الصنف</th><th>المجموعة</th><th>الكمية المخططة</th><th>تكلفتها</th><th>إجراء</th></tr></thead><tbody>${d.lines.map(l=>`<tr><td>${esc(l.item?.name||'—')}</td><td>${esc(state.eventGroups.find(g=>g.id===l.rule.group_id)?.name||'صنف مستقل')}</td><td>${esc(portionDisplayV039(l.servings))} ${esc(l.label)} <small>= ${esc(portionDisplayV039(l.required))} ${esc(l.item?.unit_label||'')}</small></td><td>${moneyBase(l.cost)}</td><td>${editing()?`<button type="button" class="event-ctrl-v036 subtle" data-external-rule-edit="${esc(l.rule.id)}">تعديل</button> <button type="button" class="event-ctrl-v036 danger" data-external-rule-delete="${esc(l.rule.id)}">حذف</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:empty('سجّل قاعدة تقديم لتظهر الكميات والتكلفة على الطاولات ومجموعات الضيافة.')}</section>`;
 }
 function costsHtml(){
  const total=state.costs.filter(c=>c.is_active!==false).reduce((a,c)=>a+num(c.planned_amount_base),0);
  const count=state.expenses.filter(x=>x.status==='posted').length;
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>الميزانية الإضافية للحفلة</h3><p>الفرقة الموسيقية، الصوت والإضاءة، الزينة، النقل، التنظيف، العمالة والخدمات وغيرها.</p></div>${editing()?'<button class="btn" data-action="add-cost">+ بند تكلفة مخطط</button>':''}</div>
    <div class="event-summary-mini-v034"><span>المتوقع: <strong>${moneyBase(total)}</strong></span><span>دفعات فعلية من الصندوق: <strong>${count}</strong></span><button class="btn secondary" data-action="add-expense" ${!editing()?'disabled':''}>+ تسجيل مصروف مدفوع من الصندوق</button></div>
    ${state.costs.length?`<div class="table-wrap"><table class="table event-cost-table-v034"><thead><tr><th>البند</th><th>المورد أو الفرقة</th><th>المخطط</th><th>المبلغ المدفوع فعليًا</th><th>فرق التكلفة</th><th>إجراء</th></tr></thead><tbody>
    ${state.costs.map(c=>{const compare=state.costCompare.find(x=>x.event_cost_id===c.id),planned=num(c.planned_amount_base),actual=num(compare?.actual_amount_base);return `<tr><td><strong>${esc(c.title)}</strong><small>${esc(c.notes||'')}</small></td><td>${esc(c.payee||'—')}</td>
     <td>${moneyBase(planned)}</td><td>${moneyBase(actual)}</td><td class="${actual>planned?'payroll-danger-v034':''}">${actual>planned?'زيادة مصروف ':actual<planned?'أقل من المخطط ':'مطابق '}${moneyBase(Math.abs(actual-planned))}</td>
     <td><button class="mini-btn" data-expense-for="${esc(c.id)}" ${!editing()?'disabled':''}>تسجيل دفع</button></td></tr>`;}).join('')}</tbody></table></div>`:empty('لم تُسجّل تكاليف الخدمات والموسيقى والعمالة بعد.')}
   ${state.expenses.filter(x=>x.status==='posted'&&!x.event_cost_id).length?`<div class="notice">يوجد ${state.expenses.filter(x=>x.status==='posted'&&!x.event_cost_id).length} مصروف فعلي غير مربوط ببند مخطط. سيُحتسب في التقرير الفعلي، ويمكن مراجعته في صفحة المصروفات.</div>`:''}
   <div class="event-footnote-v034">المخطط تقدير ولا يغيّر الصندوق أو سعر التذكرة. «تسجيل دفع» يسجل مبلغًا دُفع فعليًا للمورد أو الفرقة ويخصمه من الصندوق، ويكشف تجاوز الميزانية أو التوفير.</div></section>`;
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
    ${state.extras.length?`<div class="event-table-group-list-v039">${tableExtraGroupsV039(state.extras,state.tables).map(g=>`<div class="event-table-group-v039">
       <details class="event-table-detail-v039"><summary><span class="event-table-arrow-v039" aria-hidden="true">⌄</span><strong>${esc(g.label)}</strong><span>${g.items.length} طلب · منها ${g.pending.length} بانتظار الدفع</span><span class="event-table-due-v039">${g.pending.length?`المطلوب ${moneyTicket(g.due)}`:'✓ لا توجد مستحقات'}</span></summary>
       <div class="table-wrap"><table class="table event-extra-table-v034"><thead><tr><th>الصنف الإضافي</th><th>الكمية</th><th>سعر الوحدة</th><th>المبلغ</th><th>تكلفة الطلب</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${g.items.map(x=>`<tr>
         <td><strong>${esc(x.description)}</strong><small>${esc(x.notes||'')}</small></td><td>${esc(x.quantity)}</td><td>${moneyTicket(x.unit_price_original)}</td><td><strong>${moneyTicket(x.amount_original)}</strong></td><td>${moneyBase(x.total_cost_base)}</td><td>${badge(x.status)}</td>
         <td>${x.status==='pending'?`<button class="event-ctrl-v036 danger" data-extra-void="${esc(x.id)}">إلغاء الطلب</button>`:x.status==='paid'?`<button class="event-ctrl-v036 subtle" data-extra-refund="${esc(x.id)}">إرجاع مبلغ</button>`:'—'}</td></tr>`).join('')}</tbody></table></div></details>
       <div class="event-table-group-action-v039">${g.pending.length?`<button type="button" class="event-ctrl-v036 primary" data-extra-table-pay="${esc(g.tableId)}">تحصيل جميع طلبات الطاولة · ${moneyTicket(g.due)}</button>`:'<span class="badge green">لا توجد فواتير معلّقة</span>'}</div>
      </div>`).join('')}</div>`:empty('لا يوجد أي طلب خارج باقة الحفلة.')}</section>
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
   <section class="card finance-section"><h3>إحصاءات الحجوزات والمقاعد</h3><p class="metric-note">خطة الضيافة تعتمد على ${esc(state.event.planned_guest_count)} ضيف مستهدف، ولا تنقص عند تسجيل أي حجز.</p>
    <div class="grid cols-4 event-final-kpis-v034">
    <div class="card"><div class="metric-label">عدد الحجوزات</div><div class="metric-value">${state.bookings.filter(b=>!['cancelled','no_show'].includes(b.status)).length}</div></div>
    <div class="card"><div class="metric-label">مقاعد محجوزة</div><div class="metric-value">${state.tables.filter(t=>t.booking_id).reduce((v,t)=>v+num(t.planned_guest_count),0)} / ${state.tables.filter(t=>t.status!=='cancelled').reduce((v,t)=>v+num(t.capacity),0)}</div></div>
    <div class="card"><div class="metric-label">محصّل من الحجوزات (${esc(priceCurrency())})</div><div class="metric-value">${moneyTicket(state.bookingBalances.filter(b=>!['cancelled','no_show'].includes(b.booking_status)).reduce((v,b)=>v+num(b.paid_original),0))}</div></div>
    <div class="card"><div class="metric-label">متبقٍ من الحجوزات (${esc(priceCurrency())})</div><div class="metric-value ${a.bookingDue>0?'payroll-danger-v034':''}">${moneyTicket(a.bookingDue)}</div></div></div>
    <p class="metric-note">هذه مبالغ قبض الحجوزات بعملة الحفلة، وليست نفس رقم الإيراد المكتسب بعملة الأساس. الفواتير الإضافية والهدر والمصاريف تظهر أيضًا في أقسامها وفي مقارنة الميزانية.</p>
    <div class="event-today-actions-v034"><button class="btn secondary" data-nav="external">المشتريات الخارجية ←</button><a class="btn secondary" href="#/event-bookings/${esc(eventId)}">الحجوزات والأسماء ←</a><button class="btn secondary" data-nav="extras">الفواتير والهدر ←</button><button class="btn secondary" data-nav="costs">المصاريف والفرقة ←</button></div>
   </section>
   <section class="card finance-section"><div class="finance-section-head"><div><h3>مقارنة الميزانية بالواقع</h3><p>يمكن تصدير هذا الكشف كاملًا Excel أو PDF لمراجعته بعد كل حفلة.</p></div></div>
    <div class="table-wrap"><table class="table event-report-table-v034"><thead><tr><th>البند</th><th>المخطط (عملة الأساس)</th><th>الفعلي/المسجل</th><th>التفسير</th></tr></thead><tbody>
     <tr><td>طعام المطعم والوصفات</td><td>${moneyBase(q.food-q.externalFood)}</td><td>${moneyBase(state.summary.included_food_cost_base??state.summary.estimated_actual_included_food_cost_base)}</td><td>${final?'تكلفة تاريخية مرحلة':'تقدير حسب القائمة حتى الإقفال'}</td></tr>
     <tr><td>الوجبات المشتراة خارجياً</td><td>${moneyBase(q.externalFood)}</td><td>${moneyBase(a.externalCost)}</td><td>تكلفة الخطة حسب الحصص؛ والفعلي يشمل كامل الكمية المشتراة. دفع المورد لا يزيد التكلفة مرة أخرى.</td></tr>
     <tr><td>المصاريف والفرقة</td><td>${moneyBase(q.others)}</td><td>${moneyBase(state.summary.actual_other_expense_base)}</td><td>يُسجّل الفعلي من حركة الصندوق</td></tr>
     <tr><td>تفصيل ضمن الطعام: ضيافة حسب الطلب (غير مُضاف ثانية)</td><td>${moneyBase(q.onDemandBudget)}</td><td>${moneyBase(demandTotal().delivered)}</td><td>العدد المخطط سقف تقديري؛ المستهلك هو الحصص المقدمة فقط. بعد الإقفال تُرحّل أصناف المطبخ المستهلكة وفق وصفاتها.</td></tr>
     <tr><td>العمالة</td><td>${moneyBase(q.labor)}</td><td>${moneyBase(state.summary.actual_labor_cost_base)}</td><td>أجور مرتبطة بالحفلة</td></tr>
     <tr><td>تكلفة الطلبات خارج الباقة</td><td>—</td><td>${moneyBase(a.extraCost)}</td><td>محسوبة من وصفة الصنف أو تكلفة مدخلة يدويًا</td></tr>
     <tr><td>احتياط الهدر / المسجّل</td><td>${moneyBase(q.reserve)}</td><td>${moneyBase(a.wasteCost)}</td><td>الهدر الإضافي غير المكرر فقط</td></tr>
     <tr class="event-report-total-v034"><td>التكلفة الإجمالية</td><td>${moneyBase(q.total)}</td><td>${moneyBase(a.cost)}</td><td>${a.incomplete?'⚠ لا تزال بعض التكاليف ناقصة':estimatedRows().length?'بعض تكاليف الخطة تقديرية؛ لا تُعد تاريخية':'الفرق بين المخطط والواقع'}</td></tr>
     <tr><td>الإيرادات</td><td>${moneyBase(q.revenue)}</td><td>${moneyBase(a.revenue)}</td><td>الحجوزات/الأوردرات المكتسبة + الطلبات الإضافية المسجلة، بما فيها غير المحصّلة</td></tr>
     <tr><td>مقبوضات إضافية مؤكدة</td><td>—</td><td>${moneyBase(a.extraCollected)}</td><td>إيرادات تم قبضها عبر صندوق فعلي</td></tr>
     <tr><td>مستحقات إضافية بانتظار التحصيل</td><td>—</td><td>${moneyTicket(a.extraDue)}</td><td>بعملة التذكرة — ليست نقدًا بالصندوق</td></tr>
     <tr class="event-report-total-v034"><td>الربح أو الخسارة</td><td>${moneyBase(q.profit)}</td><td>${moneyBase(a.profit)}</td><td>${final?'مؤشر ختامي':'مؤشر مؤقت، لا تعتمد عليه قبل الإقفال'}</td></tr>
    </tbody></table></div></section>
   <section class="card"><h3>قائمة تدقيق قبل خروج آخر ضيف</h3><div class="event-check-list-v034">
    <div><span class="${a.extraDue<=0?'ok':'warn'}">${a.extraDue<=0?'✓':'!'}</span>الطلبات خارج الباقة غير المحصلة: ${moneyTicket(a.extraDue)}</div>
    <div><span class="${bookingsDue.length===0?'ok':'warn'}">${bookingsDue.length===0?'✓':'!'}</span>عدد الحجوزات ذات الرصيد: ${bookingsDue.length}</div>
    <div><span class="${external().shortages.length===0?'ok':'warn'}">${external().shortages.length===0?'✓':'!'}</span>نقص كمية الضيافة الخارجية: ${external().shortages.length}</div>
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
  modal({title:'تسجيل ما حدث في الحفلة',subtitle:'سجّل أي تغيير أو ملاحظة أثناء الحفلة كي تظهر في سجل العمليات.',submitText:'حفظ في سجل الحفلة',
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
  const sharedTables=booking?state.tables.filter(t=>String(t.booking_id)===String(booking.id)):[];
  const groupNotice=sharedTables.length>1?`<p><small>تنبيه: الحجز جماعي على ${sharedTables.length} طاولات (${esc(sharedTables.map(t=>t.table_label).join(' + '))}). المبلغ أدناه للحجز كاملًا ولا يُحصَّل مرة عن كل طاولة.</small></p>`:'';
  const extraDue=extras.filter(x=>x.status==='pending').reduce((s,x)=>s+num(x.amount_original),0);
  const invoiceBody=extras.map(x=>`<tr><td>${esc(x.description)}</td><td>${esc(x.quantity)}</td><td>${esc(x.status==='paid'?'مدفوع':x.status==='refunded'?'مسترجع':'لم يدفع')}</td><td>${moneyTicket(x.amount_original)}</td></tr>`).join('')||'<tr><td colspan="4">لا توجد طلبات إضافية</td></tr>';
  const tabWindow=window.open('','_blank');if(!tabWindow){toast('السماح بالنوافذ المنبثقة مطلوب لطباعة فاتورة الطاولة.','error');return;}
  tabWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشف ${esc(table.table_label)} · ${esc(state.event.name)}</title><style>body{font-family:Tahoma,Arial,sans-serif;margin:35px;color:#24212a;line-height:1.65}h1{margin:0;color:#65435f}small{color:#666}table{border-collapse:collapse;width:100%;margin-top:20px}td,th{border-bottom:1px solid #ddd;padding:9px;text-align:right}th{background:#eee8ee}.summary{margin-top:22px;border:1px solid #c8b7c5;padding:15px;border-radius:9px}.due{font-weight:bold;color:#b12d35;font-size:21px}.paid{color:#176c48}.print{margin:18px 0;padding:8px 20px;cursor:pointer}@media print{.print{display:none}} </style></head><body><h1>كشف حساب ${esc(table.table_label)}</h1><small>الحفلة: ${esc(state.event.name)} · ${dateOnly(state.event.event_date)}</small><hr><p>الضيوف: ${esc(table.actual_guest_count??table.planned_guest_count)} · الحجز: ${esc(booking?.customer_name||'دون حجز')}</p><table><thead><tr><th>الصنف</th><th>الكمية</th><th>الحالة</th><th>المبلغ</th></tr></thead><tbody>${invoiceBody}</tbody></table>${groupNotice}<div class="summary"><div>قيمة الحجز: ${moneyTicket(booking?.agreed_amount_original)}</div><div>المستلم على الحجز: ${moneyTicket(balance?.paid_original)}</div><div>متبقي الحجز: ${moneyTicket(pInvoice)}</div><div>طلبات إضافية غير مدفوعة: ${moneyTicket(extraDue)}</div><hr><div class="${pInvoice+extraDue>0?'due':'paid'}">${pInvoice+extraDue>0?`مطلوب قبل المغادرة: ${moneyTicket(pInvoice+extraDue)}`:'✓ لا توجد مستحقات معلقة على هذه الطاولة'}</div></div><p><small>هذه نسخة مراجعة؛ إثبات القبض يتم من شاشة الحفلة وليس من طباعة هذا الكشف.</small></p><button onclick="window.print()" class="print">طباعة / حفظ PDF</button></body></html>`);
  tabWindow.document.close();tabWindow.focus();
 }
 function openPlan(){
  const e=state.event,p=state.planner,q=quote();
  const dlg=modal({title:'تحديد سعر التذكرة وربحية الحفلة',subtitle:'اختر إحدى الطريقتين: نسبة الربح تحسب سعرًا مقربًا لأعلى 100 ليرة، أو أدخل سعرًا لترى هامش الربح الفعلي.',submitText:'حفظ التسعير',
   body:`<div class="form-grid">
   <div class="field"><label>عدد الضيوف المستهدف</label><input name="guests" type="number" min="1" max="100000" step="1" value="${esc(e.planned_guest_count||0)}" required></div>
   <div class="field"><label>احتياط الهدر من تكلفة الطعام %</label><input name="waste" type="number" min="0" max="100" step="0.5" value="${esc(p.waste_reserve_percent??5)}" required></div>
   <div class="field"><label>نسبة الربح المطلوبة %</label><input name="margin" type="number" min="0" max="94" step="0.1" value="${esc(p.target_margin_percent??25)}" required></div>
   <div class="field"><label>سعر التذكرة للشخص (${esc(priceCurrency())})</label><input name="ticket" type="number" min="0" step="any" value="${esc(e.default_price_original||0)}" required></div>
   <div class="field full"><div class="event-price-live-v038" data-price-live></div></div>
   <div class="field full"><label>ملاحظات الحفلة</label><textarea name="notes" maxlength="2000" rows="3">${esc(e.notes||'')}</textarea></div></div>`,
   onSubmit:async fd=>{
    const guests=Number(fd.get('guests')),price=Number(fd.get('ticket')),margin=Number(fd.get('margin')),waste=Number(fd.get('waste'));
    if(!Number.isInteger(guests)||guests<1||!Number.isFinite(price)||price<0||margin<0||margin>=95||waste<0||waste>100){toast('راجع عدد الأشخاص وسعر التذكرة والهامش واحتياط الهدر.','error');return false;}
    return commit(async()=>{await api.eventSavePlanV034(eventId,guests,normalizeTicketV038(price,priceCurrency()),fd.get('notes'));await api.eventSavePlannerV034(eventId,margin,waste);},'حُفظ سعر التذكرة ونسبة الربح المطلوبة.');
   }
  });
  const f=dlg.form,margin=f.elements.namedItem('margin'),ticket=f.elements.namedItem('ticket'),guests=f.elements.namedItem('guests'),waste=f.elements.namedItem('waste'),live=f.querySelector('[data-price-live]');
  // Recalculate the estimated budget for changing headcount/waste without modifying the saved plan.
  const budget=()=>{
   const people=Number(guests.value),draftSeats=planningTablesV039(state.tables,people);
   const extraFood=externalBudgetV039(state.externalDishes,state.externalRules,draftSeats,state.externalConversions).plannedCost;
   const base=eventCostQuoteV034({guests:people,tables:state.tables.filter(t=>t.status!=='cancelled').length,
    menuRules:plannedMenuRequirementsV039(state.requirements,draftSeats,state.menuEstimates),menuCosts:state.menuCosts,otherCosts:state.costs.filter(c=>c.is_active!==false),
    laborCosts:state.labor.filter(l=>l.status==='active'),wasteReservePercent:Number(waste.value),targetMarginPercent:Number(margin.value),ticketPrice:Number(ticket.value),exchangeRate:fx()});
   return base.total+(extraFood+demandTotal().planned)*(1+Number(waste.value)/100);
  };
  const render=()=>{
   const cost=budget(),people=Number(guests.value),price=Number(ticket.value),m=marginFromTicketV038(cost,people,price,fx());
   const known=q.missing===0&&external().missing===0;
   live.innerHTML=`<div><span>التكلفة المخططة للحفلة</span><strong>${known?moneyBase(cost):'⚠ غير مكتملة'}</strong></div><div><span>تكلفة الضيف المخططة</span><strong>${known&&people>0?moneyBase(cost/people):'—'}</strong></div><div><span>هامش الربح عند سعر التذكرة المدخل</span><strong class="${m!=null&&m<0?'payroll-danger-v034':''}">${known&&m!=null?m.toFixed(2)+'%':'—'}</strong></div>${!known?'<small>أكمل أسعار وصفات المنيو أولًا حتى يكون حساب نسبة الربح موثوقًا. يمكنك تحديد سعر التذكرة يدويًا الآن.</small>':'<small>عند إدخال نسبة الربح سيحسب النظام السعر لأعلى مئة ليرة سورية، أو لأعلى جزء من السنت للعملات الأخرى.</small>'}`;
  };
  margin.addEventListener('input',()=>{if(q.missing===0&&external().missing===0){const price=ticketFromMarginV038(budget(),Number(guests.value),Number(margin.value),fx(),priceCurrency());if(price!=null)ticket.value=price;}render();});
  ticket.addEventListener('input',render);guests.addEventListener('input',render);waste.addEventListener('input',render);render();
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
     <div class="notice green">إضافة طاولة جديدة تعدّل كميات الأصناف المرتبطة بالطاولات وفق قواعد التقديم المحفوظة.</div>`,
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
  const storedEstimates=new Map(state.menuEstimates.map(e=>[String(e.menu_item_id),e]));
  const isIncomplete=m=>Boolean(m.has_missing_cost)||m.recipe_cost_base==null;
  const menuOptions=opts([['','اختر صنفًا محسوب التكلفة'],...menu.filter(m=>!isIncomplete(m)||String(m.id)===String(row?.menu_item_id)).map(i=>[i.id,i.name+(isIncomplete(i)?' · تكلفة ناقصة':'')])],row?.menu_item_id||'');
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
   body:`<div class="event-portion-form-v036"><div class="field full"><label>الصنف الأصلي من المنيو</label><select name="item" required>${menuOptions}</select>
     <label class="event-estimate-toggle-v039"><input type="checkbox" name="showIncomplete" ${row&&isIncomplete(menu.find(m=>String(m.id)===String(row.menu_item_id)))?'checked':''}> إظهار الأصناف التي لا تملك تكلفة وصفة مكتملة</label><small>الأصناف المحسوبة تظهر أولًا. يمكنك اختيار ناقص التكلفة وإضافة تقدير اختياري له.</small></div>
    <div class="field full event-estimate-field-v039" hidden><label>تكلفة وجبة المنيو التقديرية (${esc(baseCurrency())}) · اختيارية</label><input name="estimateCost" type="number" min="0" step="0.0001" placeholder="اتركها فارغة إذا كنت لا تعرف التكلفة"><small>تُحفظ لهذا الصنف في جميع الحفلات. رقم تقديري للتخطيط فقط؛ لا يغيّر وصفات المطعم أو المخزون.</small></div>
    <div class="field full"><label>مجموعة الضيافة</label><select name="group">${opts([['','صنف مستقل خارج المجموعات'],...state.eventGroups.map(g=>[g.id,g.name])],plateId||'')}</select><small>يمكن نقل المكوّن بين المجموعات دون نسخه أو مضاعفة تكلفته.</small></div>
    <div class="field"><label>طريقة تقديم هذا المكوّن</label><select name="type">${opts(Object.entries(SERVING_RULE_NAMES_V036),defaultType)}</select><small>يمكن لكل مجموعة جمع حصص فردية ومشتركة حسب الحاجة.</small></div>
    <div class="field event-portion-people-v036" ${defaultType==='per_n_people'?'':'hidden'}><label>كل كم شخص يتشاركون الحصة على الطاولة؟</label><input name="people" type="number" min="1" step="1" value="${esc(row?.people_per_rule||4)}"></div>
    <div class="event-portion-grid-v036"><div class="field"><label>ما الحصة التي ستُقدَّم؟</label><select name="servingUnit">${unitOptions}</select><button type="button" class="event-ctrl-v036 subtle event-unit-quick-button-v037" data-add-serving-unit-v037>＋ إضافة وحدة وتحويلها</button><small class="hint">اختر وحدة الحصة المناسبة لهذا الصنف أو أضف وحدة جديدة.</small></div>
    <div class="field"><label class="event-serving-count-label-v036">كم نقدم في كل مرة؟</label><input name="servings" type="number" min="0.0001" step="any" required value="${esc(previous?.servings_per_distribution??row?.quantity_per_rule??1)}"><small class="hint event-servings-hint-v036">مثال: 2 سيخ للشخص الواحد.</small></div></div>
    <div class="field full event-custom-unit-v036" hidden><label>اسم الحصة المخصصة</label><input name="customUnit" maxlength="80" placeholder="اسم وحدة التقديم" value="${esc(previous&&!previous.serving_unit_id&&previous.serving_label!=='وجبة من المنيو'?previous.serving_label:'')}"></div>
    <div class="event-portion-yield-v036" hidden><div class="field"><label class="event-yield-label-v036">كم حصة تخرج من وجبة المنيو الواحدة؟</label><input name="yieldCount" type="number" step="any" min="0.0001" max="100000" placeholder="عدد الحصص في الوحدة الأصلية" value="${esc(previous?.servings_per_menu_item??'')}"></div>
    <div class="event-conversion-note-v036" role="status" aria-live="polite">اختر وحدة ثم أكّد التحويل مرة واحدة؛ سيبقى محفوظًا للاستخدام في حفلات لاحقة.</div></div>
    <div class="event-preview-v036" aria-live="polite"><strong>المعاينة الفورية</strong><p class="event-portion-preview-text-v036">اختر صنفًا ووحدة لتظهر الكمية والتكلفة تلقائيًا.</p></div>
    <div class="event-form-meaning-v036"><strong>ماذا تعني الحقول؟</strong><p>«كم نقدم في كل مرة؟» يعني ما يوضع أمام ضيف واحد أو المجموعة أو الطاولة حسب طريقة التقديم. أما «كم حصة تخرج من وجبة المنيو؟» فهي علاقة تحويل الوحدة الأصلية إلى وحدة التقديم، وتُحفظ لهذا الصنف.</p></div></div>`,
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
    const chosen=menu.find(m=>String(m.id)===item);
    const estimateRaw=String(fd.get('estimateCost')??'').trim();
    if(chosen&&isIncomplete(chosen)&&estimateRaw!==''&&(!(Number(estimateRaw)>=0)||!Number.isFinite(Number(estimateRaw)))){toast('اكتب تكلفة تقديرية صالحة أو اتركها فارغة.','error');return false;}
    return commit(()=>api.eventSaveServingWithEstimateV039(eventId,{id:row?.rule_id,menuItemId:item,type,
     servings,people,servingLabel:label,unitId:unit?.id||null,servingsPerMenuItem:yieldCount,plateId:String(fd.get('group')||'')||null},
     chosen&&isIncomplete(chosen)&&estimateRaw!==''?estimateRaw:null),
     'حُفظت الحصة والتكلفة المتاحة (فعلية أو تقديرية) في خطة الحفلة.');
   }
  });
  const form=dlg.form;
  const field=n=>form.elements.namedItem(n);
  const selectedMenu=()=>menu.find(m=>String(m.id)===String(field('item').value));
  const incompleteToggle=field('showIncomplete');
  const refreshItemChoices=()=>{
   const keep=String(field('item').value);
   const eligible=menu.filter(m=>!isIncomplete(m)||incompleteToggle.checked||String(m.id)===String(row?.menu_item_id));
   field('item').innerHTML=opts([['','اختر صنفًا محسوب التكلفة'],...eligible.map(m=>[m.id,m.name+(isIncomplete(m)?(storedEstimates.has(String(m.id))?' · تقدير محفوظ':' · تكلفة ناقصة'):'')])],keep);
   if(keep&&!eligible.some(m=>String(m.id)===keep)){field('item').value='';field('item').dispatchEvent(new Event('change',{bubbles:true}));}
  };
  const syncEstimate=()=>{
   const selected=selectedMenu(),node=form.querySelector('.event-estimate-field-v039'),incomplete=selected&&isIncomplete(selected);
   node.hidden=!incomplete;
   const input=field('estimateCost');input.disabled=!incomplete;
   if(incomplete)input.value=storedEstimates.get(String(selected.id))?.estimated_unit_cost_base??'';
   updatePreview();
  };
  incompleteToggle.addEventListener('change',refreshItemChoices);
  field('item').addEventListener('change',syncEstimate);
  refreshItemChoices();
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
     people:field('people').value,tables:seating().tables,guests:state.event.planned_guest_count,
     unitCost:isIncomplete(item)?(field('estimateCost').value===''?null:Number(field('estimateCost').value)):item.recipe_cost_base});
    const base=baseCurrency();
    resultNode.textContent=`${field('servings').value} ${label} ÷ ${ratio} = ${p.menuQuantity} من وجبة المنيو لكل تقديم. ${p.distributions} تقديمًا = ${p.totalMenuUnits} من وجبة المنيو للحفلة. ${p.totalCost==null?'⚠ تكلفة الوصفة ناقصة؛ يمكنك إدخال تقدير اختياري.':`التكلفة المتوقعة ${fmt(p.totalCost,base)}${isIncomplete(item)?' (تقديرية)':''}.`}`;
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
   form.querySelector('.event-servings-hint-v036').textContent=`مثلًا: 2 ${label||'حصص'} لكل ضيف، أو 1 لكل طاولة.`;
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
     <div class="field"><label>اسم الحصة أو الوحدة</label><input name="name" required maxlength="80" placeholder="اسم وحدة التقديم" autocomplete="off"></div>
     <div class="field"><label>كم حصة من هذه الوحدة في وجبة المنيو كاملة؟</label><input name="yieldCount" required type="number" min="0.0001" step="0.0001" max="100000" placeholder="مثال: 10"></div>
     <div class="notice green">عرّف عدد الحصص التي تنتج من وحدة الصنف الأصلية. سيحسب البرنامج ما يعادل حصص الضيوف من الصنف عند التخطيط.</div>
     <label class="event-unit-link-toggle-v037"><input type="checkbox" name="linkMaterial" ${recipeMaterials.length?'':'disabled'}> ربط هذه الوحدة بمادة مخزون أيضًا (اختياري)</label>
     <div class="event-unit-material-details-v037" hidden><div class="field"><label>المادة الموجودة في وصفة الصنف</label><select name="material"><option value="">اختر المادة</option>${recipeMaterials.map(m=>`<option data-search="${esc(materialSearchTextV106(m))}" value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></div>
     <div class="field"><label>وحدة القياس المرجعية</label><select name="referenceUnit"></select></div>
     <div class="field"><label data-material-qty-label>قيمة التحويل</label><input name="quantityInBase" type="number" step="any" min="0.00000001" placeholder="مثال: 100 أو 10"></div>
     <label class="event-unit-link-toggle-v037"><input type="checkbox" name="inverse"> أعكس علاقة التحويل إلى وحدة المادة الأصلية</label>
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
  field('estimateCost').addEventListener('input',updatePreview);
  field('servingUnit').addEventListener('change',()=>syncUnit(false));
  field('customUnit').addEventListener('input',()=>syncUnit(false));
  ['servings','yieldCount','people'].forEach(n=>field(n).addEventListener('input',updatePreview));
  field('type').addEventListener('change',syncType);
  syncType();
  syncEstimate();
  updateServingOptions(true);
 }
 function openBooking(table=null){
  const available=state.tables.filter(t=>t.status!=='cancelled'&&!t.booking_id).sort((a,b)=>Number(a.display_order||0)-Number(b.display_order||0)||a.table_label.localeCompare(b.table_label,'ar',{numeric:true}));
  if(!available.length){toast('لا توجد طاولات متاحة. جهّز طاولات جديدة أولًا.','error');return;}
  const initial=table&&available.find(t=>t.id===table.id)||available[0];
  const defaultTicket=num(state.event.default_price_original);
  let rows=[],firstId=initial.id;
  const dlg=modal({title:'حجز مرن للمجموعة',subtitle:'ابحث عن رقم الطاولة، ثم حدد من يجلس عليها. يمكنك إضافة طاولات أخرى حتى يكتمل العدد.',submitText:'تأكيد الحجز والمقاعد',
   body:`<div class="form-grid event-booking-form-v038">
    <div class="field full"><label>صاحب الحجز</label><input name="name" maxlength="150" required placeholder="مثال: باسل"></div>
    <div class="field"><label>رقم الهاتف (اختياري)</label><input name="phone" type="tel" maxlength="40"></div>
    <div class="field"><label>عدد الأشخاص في الحجز</label><input name="guests" type="number" min="1" max="1000" value="1" required></div>
    <div class="field full"><label>الطاولة الأولى · بحث واختيار في حقل واحد</label>
      <div class="event-table-combo-v038" data-picker="start"><input name="firstLookup" type="search" role="combobox" aria-expanded="false" autocomplete="off" placeholder="ابحث برقم الطاولة أو الاسم" value="${esc(initial.table_label)}"><div data-options class="event-table-results-v038" hidden></div></div><input name="table" type="hidden" value="${esc(initial.id)}"></div>
    <div class="field full"><label>توزيع الحجز على الطاولات</label><div class="event-allocation-editor-v038" data-allocations></div></div>
    <div class="field full"><label>إذا لم تكفِ المقاعد، أضف طاولة ثانية أو ثالثة</label><div class="event-booking-add-table-v038"><div class="event-table-combo-v038" data-picker="additional"><input name="extraLookup" type="search" role="combobox" aria-expanded="false" autocomplete="off" placeholder="اختر طاولة أخرى بالبحث"><div data-options class="event-table-results-v038" hidden></div></div><button type="button" class="event-ctrl-v036 subtle" data-add-table>＋ إضافة طاولة</button></div><small class="hint">يسمح البرنامج باختيار أي طاولة متاحة، مع تنبيه إن كانت بعيدة عن طاولات المجموعة.</small></div>
    <div class="field full"><label>أسماء المرافقين (اختياري، اسم لكل سطر)</label><textarea name="names" rows="3" placeholder="محمد&#10;أحمد"></textarea><small class="hint">من دون أسماء، يظهر الملخص: باسل · 4 أشخاص مع باسل، مع الاحتفاظ بمقعد مستقل لكل ضيف في السجل.</small></div>
    <div class="field"><label>سعر التذكرة للشخص (${esc(priceCurrency())})</label><input name="unitPrice" type="number" min="0" step="any" value="${defaultTicket}" required></div>
    <div class="field"><label>الإجمالي المطلوب للحجز (${esc(priceCurrency())})</label><input name="amount" type="number" min="0" step="any" value="${defaultTicket}" required></div>
    <div class="field full"><div class="event-booking-price-preview-v038" data-booking-price-note></div></div>
    <div class="field full"><label>ملاحظة</label><textarea name="note" rows="2" maxlength="500"></textarea></div></div>
    <div class="event-collect-inline-v040"><label class="event-book-collect-checkbox-v040"><input type="checkbox" name="collected" data-collected-v040> <span><strong>المبلغ مقبوض الآن</strong><small>عند التفعيل يُحفظ الحجز وتُسجّل حركة القبض في خطوة واحدة. اتركه فارغًا إذا سيدفع لاحقًا.</small></span></label><div class="field" data-collected-box-v040 hidden><label>صندوق التحصيل</label><select name="cashbox">${withBox()}</select></div></div>`,
   onSubmit:async fd=>{
    const count=Number(fd.get('guests'));
    if(!picker.getId()||picker.getId()!==firstId){toast('اختر رقم الطاولة من نتائج البحث، لا تكتفِ بكتابة الرقم.','error');return false;}
    const valid=validateTableDistributionV038(state.tables,rows,count);
    if(!valid.ok){toast(valid.reason,'error');return false;}
    const price=Number(fd.get('unitPrice')),amount=Number(fd.get('amount'));
    if(!Number.isFinite(price)||price<=0||!Number.isFinite(amount)||amount<=0){toast('حدّد سعر التذكرة أو السعر الإجمالي أولًا؛ لا يمكن تحصيل حجز قيمته صفر.','error');return false;}
    const finalUnit=normalizeTicketV038(price,priceCurrency()),finalAmount=bookingPriceV038(count,finalUnit);
    const name=String(fd.get('name')||'').trim();
    const names=String(fd.get('names')||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(names.length>count){toast('عدد الأسماء أكبر من عدد الضيوف في الحجز.','error');return false;}
    if(names[0]!==name)names.unshift(name);
    if(names.length>count){toast('اكتب أسماء المرافقين فقط أو اسم صاحب الحجز أولًا.','error');return false;}
    const collected=fd.get('collected')==='on',chosenBox=String(fd.get('cashbox')||'');
    if(collected&&!chosenBox){toast('اختر صندوق التحصيل قبل حفظ حجز مقبوض.','error');return false;}
    const result=await commit(async()=>{await api.eventBookAndCollectV040(eventId,{name,guests:count,allocations:rows.map(x=>({...x})),names,phone:fd.get('phone'),amount:finalAmount,note:fd.get('note'),collected,cashboxId:chosenBox});tab='bookings';},collected?'تم الحجز وقبض المبلغ في العملية نفسها.':'تم تسجيل الحجز بدون قبض، ويظهر ضمن المستحقات.');
    return result;
   }
  });
  const form=dlg.form,guests=form.elements.namedItem('guests'),amount=form.elements.namedItem('amount'),unit=form.elements.namedItem('unitPrice');
  const tableById=id=>available.find(x=>String(x.id)===String(id));
  let additionalId=null;
  function configurePicker(kind,onSelect,selected=null){
   const wrap=form.querySelector(`[data-picker="${kind}"]`),field=wrap.querySelector('input'),results=wrap.querySelector('[data-options]');
   let id=selected;
   const hide=()=>{results.hidden=true;field.setAttribute('aria-expanded','false');};
   const refresh=()=>{
    const query=normalizeTableSearchV038(field.value),matches=available.filter(t=>normalizeTableSearchV038(t.table_label).includes(query));
    results.innerHTML=matches.length?matches.slice(0,45).map(t=>`<button type="button" data-select="${esc(t.id)}"><strong>${esc(t.table_label)}</strong><span>${esc(t.capacity)} كراسٍ ${rows.some(r=>String(r.table_id)===String(t.id))?' · ضمن التوزيع':''}</span></button>`).join(''):'<div class="event-table-no-match-v038">لا توجد طاولة مطابقة.</div>';
    results.hidden=false;field.setAttribute('aria-expanded','true');
    results.querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>{const t=tableById(b.dataset.select);if(!t)return;id=t.id;field.value=t.table_label;hide();onSelect(t);});
   };
   field.addEventListener('focus',refresh);
   field.addEventListener('input',()=>{id=null;refresh();if(kind==='additional')additionalId=null;else form.elements.namedItem('table').value='';});
   field.addEventListener('keydown',e=>{if(e.key==='Escape')hide();if(e.key==='Enter'&&!results.hidden){const first=results.querySelector('[data-select]');if(first){e.preventDefault();first.click();}}});
   field.addEventListener('blur',()=>{setTimeout(hide,180);});
   return {getId:()=>id,clear:()=>{id=null;field.value='';hide();}};
  }
  const picker=configurePicker('start',t=>{firstId=t.id;form.elements.namedItem('table').value=t.id;autoSplit();},initial.id);
  const addPicker=configurePicker('additional',t=>{additionalId=t.id;});
  function updateValidity(){
   const validity=validateTableDistributionV038(state.tables,rows,Number(guests.value));
   const summary=form.querySelector('[data-alloc-summary]');if(!summary)return;
   const order=available.map(x=>String(x.id));
   const distant=rows.length>1&&rows.some((r,i)=>i>0&&Math.abs(order.indexOf(String(r.table_id))-order.indexOf(String(rows[i-1].table_id)))>1);
   summary.innerHTML=`<span class="${validity.ok?'event-alloc-good-v038':'payroll-danger-v034'}">${validity.ok?'✓ التوزيع مكتمل والمقاعد متاحة':'⚠ '+esc(validity.reason)}</span>${distant?'<small>تنبيه: بعض الطاولات غير متجاورة وفق ترتيب القاعة؛ تأكد من توزيعها الفعلي.</small>':''}`;
  }
  function renderAllocations(){
   form.querySelector('[data-allocations]').innerHTML=`<div class="event-allocation-rows-v038">${rows.map((r,i)=>{const t=tableById(r.table_id);return `<div class="event-allocation-row-v038"><strong>${esc(t?.table_label||'طاولة')}</strong><label>عدد المقاعد (حتى ${esc(t?.capacity||0)})<input type="number" data-alloc-count="${i}" min="1" max="${esc(t?.capacity||1)}" step="1" value="${esc(r.guests)}"></label><button type="button" class="event-ctrl-v036 danger" data-alloc-delete="${i}" title="إزالة من الحجز">إزالة</button></div>`;}).join('')}</div><div class="event-booking-suggestion-v035" data-alloc-summary></div>`;
   form.querySelectorAll('[data-alloc-count]').forEach(el=>el.addEventListener('input',()=>{rows[Number(el.dataset.allocCount)].guests=Number(el.value);updateValidity();}));
   form.querySelectorAll('[data-alloc-delete]').forEach(el=>el.onclick=()=>{rows.splice(Number(el.dataset.allocDelete),1);renderAllocations();});
   updateValidity();
  }
  function autoSplit(){
   const count=Number(guests.value),proposal=proposeEventAllocationV035(state.tables,firstId,count);
   rows=proposal.ok?proposal.rows.map(r=>({...r})):[{table_id:firstId,guests:Math.min(Math.max(1,count||1),Number(tableById(firstId)?.capacity)||1)}];
   renderAllocations();
  }
  form.querySelector('[data-add-table]').onclick=()=>{
   if(!additionalId){toast('اختر رقم الطاولة من نتائج البحث أولًا.','error');return;}
   const t=tableById(additionalId);if(!t||rows.some(r=>String(r.table_id)===String(t.id))){toast('الطاولة مضافة بالفعل أو غير متاحة.','error');return;}
   const used=rows.reduce((sum,r)=>sum+Number(r.guests||0),0);
   let remaining=Number(guests.value)-used;
   if(remaining<=0){const donor=[...rows].reverse().find(r=>r.guests>1);if(!donor){toast('كل طاولة في التوزيع الحالي تحتوي شخصًا واحدًا. أزل طاولة أولًا قبل إعادة التوزيع.','error');return;}donor.guests-=1;remaining=1;}
   rows.push({table_id:t.id,guests:Math.min(Number(t.capacity),remaining)});addPicker.clear();additionalId=null;renderAllocations();
  };
  guests.addEventListener('input',()=>{autoSplit();syncFromUnit();});
  const note=form.querySelector('[data-booking-price-note]');
  function summaryPrice(){const count=Number(guests.value),val=Number(amount.value);note.innerHTML=count>0&&val>0?`<strong>المطلوب عند التحصيل: ${moneyTicket(val)}</strong><small>${count} أشخاص · ${moneyTicket(Number(unit.value))} للفرد</small>`:'<strong class="payroll-danger-v034">حدد سعرًا موجبًا للحجز كي يصبح قابلًا للتحصيل.</strong>';}
  function syncFromUnit(){const count=Number(guests.value),price=Number(unit.value);if(Number.isInteger(count)&&count>0&&Number.isFinite(price)&&price>=0)amount.value=bookingPriceV038(count,normalizeTicketV038(price,priceCurrency()));summaryPrice();}
  unit.addEventListener('input',syncFromUnit);
  unit.addEventListener('blur',()=>{if(Number(unit.value)>=0){unit.value=normalizeTicketV038(unit.value,priceCurrency());syncFromUnit();}});
  amount.addEventListener('input',()=>{const count=Number(guests.value);if(count>0)unit.value=Number((Number(amount.value)/count).toFixed(4));summaryPrice();});
  amount.addEventListener('blur',()=>{const count=Number(guests.value);if(count>0&&Number(amount.value)>0){unit.value=normalizeTicketV038(Number(amount.value)/count,priceCurrency());syncFromUnit();}});
  const paidToggle=form.querySelector('[data-collected-v040]'),paidBox=form.querySelector('[data-collected-box-v040]');
  paidToggle.addEventListener('change',()=>{paidBox.hidden=!paidToggle.checked;});
  autoSplit();syncFromUnit();
 }
 function editBookingAmount(booking){
  const paid=num(state.bookingBalances.find(x=>x.booking_id===booking.id)?.paid_original);
  if(paid>0){toast('لا يمكن تغيير قيمة حجز له دفعات مسجلة.','error');return;}
  const dlg=modal({title:'تحديد قيمة الحجز',subtitle:'يُستخدم لتصحيح حجز قديم بقيمة صفر أو تعديل قيمته قبل أول قبض. لا تُسجَّل حركة صندوق الآن.',submitText:'حفظ القيمة الجديدة',
   body:`<div class="form-grid"><div class="field"><label>عدد الأشخاص</label><input type="number" value="${esc(booking.guest_count)}" disabled></div><div class="field"><label>سعر الشخص (${esc(currencyLabel(booking.currency_code))})</label><input name="unit" type="number" step="any" min="0.0001" value="${num(booking.agreed_amount_original)/Math.max(1,num(booking.guest_count))}" required></div><div class="field full"><label>إجمالي الحجز</label><input name="total" type="number" step="any" min="0.0001" value="${num(booking.agreed_amount_original)}" required></div></div>`,
   onSubmit:async fd=>{const value=Number(fd.get('total'));if(!(value>0)){toast('سعر الحجز يجب أن يكون موجبًا.','error');return false;}return commit(()=>api.eventSetBookingAmountV038(booking.id,bookingPriceV038(num(booking.guest_count),normalizeTicketV038(value/num(booking.guest_count),booking.currency_code))),'تم تصحيح قيمة الحجز ويمكنك تحصيله.');}
  });
  const unit=dlg.form.elements.namedItem('unit'),total=dlg.form.elements.namedItem('total'),count=num(booking.guest_count);
  unit.addEventListener('input',()=>total.value=bookingPriceV038(count,normalizeTicketV038(Math.max(0,Number(unit.value)),booking.currency_code)));
  total.addEventListener('input',()=>unit.value=Number((Number(total.value)/count).toFixed(4)));
  total.addEventListener('blur',()=>{if(Number(total.value)>0){unit.value=normalizeTicketV038(Number(total.value)/count,booking.currency_code);total.value=bookingPriceV038(count,Number(unit.value));}});
 }
 function payBooking(booking){
  const r=state.bookingBalances.find(b=>b.booking_id===booking.id),due=num(r?.balance_original),activeBox=box();
  if(!r||due<=0||!activeBox){toast('لا يوجد رصيد مطلوب أو صندوق نشط.','error');return;}
  modal({title:`تحصيل حجز ${booking.customer_name}`,subtitle:'تُسجّل حركة نقدية داخل الصندوق مباشرة عند التأكيد.',submitText:'تأكيد التحصيل',
   body:`<div class="notice rose">المتبقي: <strong>${fmt(due,booking.currency_code)}</strong> · حالة الحجز ${esc(EVENT_BOOKING_STATUS_AR_V038[booking.status]||statusLabel[booking.status]||booking.status)}</div>
    <div class="form-grid"><div class="field"><label>المبلغ المطلوب تحصيله (${esc(currencyLabel(booking.currency_code))})</label><input name="amount" type="number" min="0.0001" step="any" max="${due}" value="${due}" required></div>
    <div class="field"><label>الصندوق</label><select name="box" required>${withBox()}</select></div></div>`,
   onSubmit:async fd=>{const amt=Number(fd.get('amount'));if(!Number.isFinite(amt)||amt<=0||amt>due+.0001){toast('راجع المبلغ، لا يمكن تحصيل أكثر من المتبقي.','error');return false;}
    return commit(()=>api.eventPayBookingV034(booking.id,fd.get('box'),amt,booking.currency_code),'تم تحصيل الحجز وتسجيل حركة الصندوق.');}
  });
 }
 function openExternalDish(){
  modal({title:'تسجيل شراء ضيافة خارجية',subtitle:'اشترِ صنفاً من مورد خارجي، مثل معمول أو كعك أو علبة عصير، ليصبح متاحًا في خطة طاولات هذه الحفلة.',submitText:'حفظ الوجبة المشتراة',
   body:`<div class="form-grid"><div class="field full"><label>اسم الوجبة</label><input name="name" maxlength="150" required placeholder="مثال: علبة حلوى من محل خارجي"></div>
    <div class="field"><label>وحدة التقديم</label><input name="unit" maxlength="60" value="حصة" required placeholder="علبة / قطعة / صحن"></div>
    <div class="field"><label>الكمية المشتراة</label><input name="quantity" type="number" min="0.0001" step="any" value="10" required></div>
    <div class="field"><label>تكلفة الوحدة (${esc(baseCurrency())})</label><input name="unitCost" type="number" min="0" step="any" required></div>
    <div class="field"><label>المورّد</label><input name="vendor" maxlength="150" placeholder="اسم المطعم أو المحل"></div>
    <div class="field full"><label>ملاحظات أو رقم فاتورة الشراء</label><textarea name="note" rows="2" maxlength="500"></textarea></div></div>
    <div class="notice green">إضافة الوجبة تحفظ تكلفة الشراء ضمن ميزانية الحفلة ولا تسحب المال الآن. اضغط «دفع الشراء» في الجدول عند دفع المورد بالفعل.</div>`,
   onSubmit:async fd=>commit(()=>api.eventAddExternalDishV038(eventId,{name:fd.get('name'),unit:fd.get('unit'),quantity:fd.get('quantity'),unitCost:fd.get('unitCost'),vendor:fd.get('vendor'),note:fd.get('note')}),'أُضيفت الوجبة الخارجية وأصبحت جاهزة لتخطيط الضيافة.')
  });
 }
 function openExternalServing(existing=null,dishId=null){
  const items=state.externalDishes.filter(x=>x.is_active!==false);
  if(!items.length){toast('سجّل وجبة مشتراة خارجيًا أولًا.','error');return;}
  const original=existing||{};
  const savedDish=items.find(x=>String(x.id)===String(original.dish_id||dishId))||items[0];
  const units=dish=>state.externalConversions.filter(c=>String(c.dish_id)===String(dish?.id));
  const servingOptions=dish=>opts([['',`وحدة الشراء كاملة · ${dish?.unit_label||'وحدة'}`],...units(dish).map(c=>[c.id,`${c.serving_label} · ${c.servings_per_purchase_unit} لكل ${dish.unit_label}`])],
   String(original.serving_conversion_id||''));
  const dlg=modal({title:'تحديد تقديم الوجبة الخارجية',
   subtitle:'اختر حصة التقديم (قطعة أو شريحة أو كأس)، ثم حدّد عدد الحصص لكل شخص أو طاولة. الحساب مربوط بوحدة الشراء.',
   submitText:existing?'حفظ تعديلات التقديم':'إضافة إلى خطة الضيافة',
   body:`<div class="form-grid event-external-serving-v039"><div class="field full"><label>الوجبة المشتراة</label><select name="dish" required>${opts(items.map(x=>[x.id,x.name+' · '+x.unit_label]),savedDish.id)}</select></div>
    <div class="field full"><label>مجموعة الضيافة</label><select name="group"><option value="">صنف مستقل خارج المجموعات</option>${opts(state.eventGroups.map(g=>[g.id,g.name]),original.group_id||'')}</select></div>
    <div class="field"><label>طريقة التقديم</label><select name="type">${opts(Object.entries(EVENT_RULE_NAMES_V034),original.rule_type||'per_person')}</select></div>
    <div class="field" data-people-row><label>عدد الأشخاص في المجموعة على الطاولة</label><input name="people" type="number" min="1" step="1" value="${esc(original.people_per_rule||4)}"></div>
    <div class="field full"><label>وحدة التقديم</label><select name="conversion">${servingOptions(savedDish)}</select>
      <button type="button" class="event-ctrl-v036 subtle event-unit-quick-button-v037" data-external-unit-v039>＋ إضافة وحدة وتحويلها</button>
      <small>عرّف وحدة التقديم وعدد الحصص الناتجة من وحدة الشراء. التكلفة تحتسب من عدد وحدات الشراء المكافئ للحصص المطلوبة، لا من عدد الضيوف مضروبًا في سعر الوحدة الكاملة.</small></div>
    <div class="field full"><label>كم حصة تُقدّم في كل مرة؟</label><input name="servings" type="number" min="0.000001" step="any" value="${esc(original.servings_per_distribution??original.quantity_per_distribution??1)}" required></div>
    <div class="field full"><div class="event-price-live-v038" data-external-preview></div></div></div>`,
   onSubmit:async fd=>{
    const dish=items.find(x=>String(x.id)===String(fd.get('dish')));
    const ratio=units(dish).find(c=>String(c.id)===String(fd.get('conversion')));
    const servings=Number(fd.get('servings'));
    if(!dish||!(servings>0)||servings>1000000||servings/(num(ratio?.servings_per_purchase_unit)||1)<0.0000000001){toast('راجع عدد الحصص وعلاقة التحويل بوحدة الشراء.','error');return false;}
    return commit(()=>api.eventSaveExternalServingV039(eventId,{id:existing?.id,dishId:dish.id,groupId:fd.get('group'),
     type:fd.get('type'),servings,people:fd.get('people'),conversionId:ratio?.id||null}),
     'تم حفظ التقديم بوحدة الحصة، واحتُسبت تكلفة الشراء الصحيحة للحفلة.');
   }
  });
  const form=dlg.form,field=name=>form.elements.namedItem(name);
  const dish=()=>items.find(x=>String(x.id)===String(field('dish').value));
  const preview=form.querySelector('[data-external-preview]');
  const row=form.querySelector('[data-people-row]');
  const refresh=()=>{
   const current=dish(),conversion=units(current).find(x=>String(x.id)===String(field('conversion').value));
   row.hidden=field('type').value!=='per_n_people';
   field('people').required=!row.hidden;
   const rule={rule_type:field('type').value,servings_per_distribution:Number(field('servings').value),people_per_rule:Number(field('people').value)};
   const info=externalPreviewV039(current,rule,seating(),conversion);
   preview.innerHTML=`<div><span>عدد الحصص المخطط</span><strong>${esc(portionDisplayV039(info.servings))} ${esc(info.label||'حصة')}</strong></div>
     <div><span>ما يعادله من وحدة الشراء</span><strong>${esc(portionDisplayV039(info.neededUnits))} ${esc(current?.unit_label||'')}</strong></div>
     <div><span>تكلفة الحصص المخططة</span><strong>${moneyBase(info.cost)}</strong></div>
     <div><span>المشتَرى فعليًا</span><strong>${esc(portionDisplayV039(current?.purchased_quantity))} ${esc(current?.unit_label||'')}</strong></div>
     ${info.shortage>0?`<small class="payroll-danger-v034">⚠ النقص ${esc(portionDisplayV039(info.shortage))} ${esc(current?.unit_label||'')}. أضف شراءً أو قلّل الحصص.</small>`:''}`;
  };
  field('dish').addEventListener('change',()=>{field('conversion').innerHTML=servingOptions(dish());field('conversion').value='';refresh();});
  ['group','type','people','servings','conversion'].forEach(key=>field(key).addEventListener('input',refresh));
  form.querySelector('[data-external-unit-v039]').addEventListener('click',()=>{
   const current=dish();if(!current){toast('اختر الوجبة الخارجية أولًا.','error');return;}
   modal({title:'إضافة وحدة تحويل للوجبة الخارجية',
    subtitle:`${current.name} · ترتبط الوحدة بالوجبة المشتراة مباشرة، ويمكن استخدامها في أكثر من قاعدة تقديم داخل الحفلة.`,
    submitText:'حفظ الوحدة واختيارها',
    body:`<div class="field"><label>اسم وحدة التقديم</label><input name="label" required maxlength="60" placeholder="قطعة / سيخ / شريحة / كأس"></div>
     <div class="field"><label>كم حصة تنتج من 1 ${esc(current.unit_label)}؟</label><input name="yieldCount" type="number" required min="0.000001" max="1000000" step="any" placeholder="مثال: 200"></div>
     <div class="notice green">تحويل الوحدات يعتمد على الصنف المختار: أدخل اسم الوحدة الأصغر، ثم عددها الناتج من وحدة الشراء الواحدة. سيُستخدم التحويل تلقائيًا في حساب الكمية والتكلفة.</div>`,
    onSubmit:async fd=>{
     const name=String(fd.get('label')||'').trim(),per=Number(fd.get('yieldCount'));
     if(!name||!(per>0)||per>1000000){toast('حدد اسمًا وعدد حصص موجبًا.','error');return false;}
     try{
      const id=await api.eventAddExternalUnitV039(current.id,name,per);
      const rows=await api.eventExternalUnitsV039(current.id);
      state.externalConversions=state.externalConversions.filter(c=>String(c.dish_id)!==String(current.id)).concat(rows);
      if(!dlg.element.isConnected)return true;
      field('conversion').innerHTML=servingOptions(current);field('conversion').value=String(id);
      refresh();toast('حُفظ التحويل واختير تلقائيًا دون فقدان بيانات النموذج.','success');return true;
     }catch(e){toast(toError(e),'error');return false;}
    }
   });
  });
  refresh();
 }
 function payExternalDish(item){
  if(!state.boxes.some(x=>x.is_active)){toast('فعّل صندوقًا أولًا قبل دفع المورد.','error');return;}
  modal({title:'دفع فاتورة الوجبة الخارجية',subtitle:'تسجيل مصروف نقدي حقيقي من الصندوق. التكلفة موجودة مسبقًا في الحفلة، ولن تُحتسب ثانيةً.',submitText:'تأكيد دفع المورد',
   body:`<div class="event-booking-pay-summary-v038"><div><span>الوجبة</span><strong>${esc(item.name)}</strong></div><div><span>المورد</span><strong>${esc(item.vendor||'غير محدد')}</strong></div><div><span>المبلغ المطلوب</span><strong>${moneyBase(item.total_cost_base)}</strong></div></div><div class="field"><label>الصندوق</label><select name="box" required>${withBox()}</select></div>`,
   onSubmit:async fd=>commit(()=>api.eventPayExternalDishV038(item.id,fd.get('box')),'تم دفع المورد وتسجيل الخروج النقدي مرة واحدة.')
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
 function payTableExtras(table){
  if(!table||!box()){toast('اختر طاولة وصندوقًا نشطًا للتحصيل.','error');return;}
  const pending=state.extras.filter(x=>String(x.table_id)===String(table.id)&&x.status==='pending');
  const total=pending.reduce((s,x)=>s+num(x.amount_original),0);
  if(!pending.length){toast('لا توجد مستحقات معلقة على هذه الطاولة.','error');return;}
  modal({title:`تحصيل موحّد · ${table.table_label}`,
   subtitle:'ضغطة واحدة لتحصيل جميع الطلبات غير المدفوعة لهذه الطاولة، مع الاحتفاظ بتفاصيل كل صنف وحركته النقدية.',
   submitText:`تحصيل ${moneyTicket(total)}`,
   body:`<div class="event-booking-pay-summary-v038"><div><span>عدد الطلبات</span><strong>${pending.length}</strong></div>
     <div><span>الإجمالي المطلوب</span><strong>${moneyTicket(total)}</strong></div></div>
     <div class="event-bulk-pay-lines-v039">${pending.map(x=>`<div><span>${esc(x.description)} × ${esc(x.quantity)}</span><strong>${moneyTicket(x.amount_original)}</strong></div>`).join('')}</div>
     <div class="field"><label>صندوق التحصيل</label><select name="box" required>${withBox()}</select></div>
     <p class="metric-note">العملية ذرّية: إما تنجح كل حركات الطلبات أو تتراجع كلها. كل صنف يحتفظ بإمكانية الإرجاع المنفرد.</p>`,
   onSubmit:async fd=>commit(()=>api.eventPayTableExtrasV039(eventId,table.id,fd.get('box')),
     `تم تحصيل ${pending.length} طلب للطاولة ${table.table_label} بنجاح.`)
  });
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
    <div><span>وصفات غير مكتملة فعليًا</span><strong>${planRequirements().filter(r=>r.v039_original_cost_incomplete).length}</strong></div></div>
    <div class="notice">التكلفة التقديرية مفيدة للتخطيط ولا تُغني عن التكاليف الحقيقية في المخزون. قبل الإقفال، أكمل الوصفات الفعلية وسجّل الحضور الحقيقي وحصّل المستحقات.</div>
    <div class="field"><label>ملاحظة ختامية (اختياري)</label><textarea name="note" rows="2" maxlength="500" placeholder="أهم ما جرى خلال الحفلة"></textarea></div>`,
   onSubmit:async fd=>commit(()=>api.eventCompleteWithDemandV040(eventId,fd.get('note')),'تم إقفال الحفلة وترحيل الطعام. اطلع على التقرير الختامي.')
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
  emit('[data-action="add-demand"]',()=>openDemandPlan());
  emit('[data-demand-edit]',el=>openDemandPlan(state.onDemandItems.find(x=>String(x.id)===String(el.dataset.demandEdit))));
  emit('[data-action="issue-demand"]',()=>openDemandIssue());
  emit('[data-demand-issue]',el=>openDemandIssue(el.dataset.demandIssue));
  emit('[data-demand-for-table]',el=>openDemandIssue(null,el.dataset.demandForTable));
  emit('[data-demand-void]',el=>reasonModal('إلغاء تقديم مسجّل',why=>api.eventVoidOnDemandIssueV040(el.dataset.demandVoid,why)));
  emit('[data-book-pay]',el=>{const x=state.bookings.find(x=>String(x.id)===el.dataset.bookPay);if(x)payBooking(x);});
  emit('[data-book-amount]',el=>{const x=state.bookings.find(x=>String(x.id)===el.dataset.bookAmount);if(x)editBookingAmount(x);});
  emit('[data-action="add-rule"]',()=>openRule());
  emit('[data-action="add-event-group"]',()=>openEventGroup());
  emit('[data-group-add]',el=>openRule(null,el.dataset.groupAdd));
  emit('[data-group-edit]',el=>openEventGroup(state.eventGroups.find(g=>String(g.id)===String(el.dataset.groupEdit))));
  emit('[data-group-delete]',async el=>{const group=state.eventGroups.find(g=>String(g.id)===String(el.dataset.groupDelete));if(group&&await confirmBox(`سيُحذف «${group.name}» وجميع مكوناتها فقط، وسيُعاد احتساب التكلفة. هل تؤكد؟`,'حذف المجموعة'))await commit(()=>api.eventDeleteGroupV037(eventId,group.id),'تم حذف المجموعة ومكوناتها.');});
  emit('[data-rule-edit]',el=>openRule(state.requirements.find(x=>String(x.rule_id)===el.dataset.ruleEdit)));
  emit('[data-rule-delete]',async el=>{if(await confirmBox('حذف هذه القاعدة يغيّر تكلفة الطعام وكميات الضيافة على كل الطاولات.','حذف القاعدة'))
    await commit(()=>api.eventDeleteRuleV034(eventId,el.dataset.ruleDelete),'حُذفت قاعدة التقديم وأُعيد احتساب الضيافة.');});
  emit('[data-action="external-new"]',openExternalDish);
  emit('[data-action="external-rule-new"]',()=>openExternalServing());
  emit('[data-external-use]',el=>openExternalServing(null,el.dataset.externalUse));
  emit('[data-external-rule-edit]',el=>openExternalServing(state.externalRules.find(x=>String(x.id)===el.dataset.externalRuleEdit)));
  emit('[data-external-rule-delete]',async el=>{if(await confirmBox('حذف قاعدة تقديم الوجبة الخارجية من الحفلة؟ الشراء نفسه سيبقى محفوظًا.','حذف قاعدة التقديم'))await commit(()=>api.eventDeleteExternalServingV038(eventId,el.dataset.externalRuleDelete),'حُذفت قاعدة التقديم.');});
  emit('[data-external-pay]',el=>{const x=state.externalDishes.find(d=>String(d.id)===el.dataset.externalPay);if(x)payExternalDish(x);});
  emit('[data-external-void]',el=>reasonModal('إلغاء شراء غير مدفوع',reason=>api.eventVoidExternalDishV038(el.dataset.externalVoid,reason)));
  emit('[data-action="add-cost"]',openCost);
  emit('[data-action="add-expense"]',()=>openExpense());
  emit('[data-expense-for]',el=>openExpense(state.costs.find(x=>String(x.id)===el.dataset.expenseFor)));
  emit('[data-action="add-extra"]',()=>openExtra());
  emit('[data-extra-table-pay]',el=>{const t=state.tables.find(t=>String(t.id)===el.dataset.extraTablePay);if(t)payTableExtras(t);});
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
   const rows=planRequirements().filter(r=>{
    const associated=String(metadata.get(String(r.rule_id))?.main_plate_id||'');
    return groupId?associated===String(groupId):!validIds.has(associated);
   });
   registerTableExport(menuTable,()=>({title:`${group?`مجموعة ${group.name}`:'الأصناف المستقلة'} · ${state.event.name}`,
    headers:['الصنف','طريقة التقديم','عدد الحصص','وحدة الحصة','الحصص لكل وجبة من المنيو','كمية المنيو المطلوبة','تكلفة وجبة المنيو','تكلفة هذا الصنف'],
    rows:rows.map(r=>{const meta=metadata.get(String(r.rule_id));return [r.menu_item_name,
     SERVING_RULE_NAMES_V036[r.rule_type]||r.rule_type,meta?.servings_per_distribution??r.quantity_per_rule,
     meta?.serving_label||'وجبة من المنيو',meta?.servings_per_menu_item??1,Number(num(r.required_quantity).toFixed(4)),
     r.unit_food_cost_base==null?'غير مكتملة':exportAmount(r.unit_food_cost_base),r.estimated_food_cost_base==null?'غير مكتملة':exportAmount(r.estimated_food_cost_base)];})}));
  });
  const demandTable=root.querySelector('.event-demand-table-v040');
  if(demandTable)registerTableExport(demandTable,()=>({title:`ضيافة حسب الطلب · ${state.event.name}`,headers:['الصنف','الحد','المقدم','المتبقي','التكلفة المخططة عند استخدام كامل الحد','تكلفة ما قدم فعلاً'],rows:demand().map(x=>[x.name,x.maximum_servings,x.used,x.remaining,x.reservedCost==null?'غير معروفة':exportAmount(x.reservedCost),x.consumedCost==null?'غير معروفة':exportAmount(x.consumedCost)])}));
  const bookingTable=root.querySelector('.event-booking-table-v034');
  if(bookingTable)registerTableExport(bookingTable,()=>({title:`حجوزات ${state.event.name}`,
   headers:['الاسم','الهاتف','عدد الأشخاص','أسماء المجموعة','الطاولات','سعر الشخص','قيمة الحجز','المقبوض','المتبقي','الحالة'],
   rows:state.bookings.map(b=>{const ba=state.bookingBalances.find(z=>z.booking_id===b.id)||{};return [b.customer_name,b.customer_phone||'',b.guest_count,bookingSummary(b),state.tables.filter(t=>t.booking_id===b.id).map(t=>t.table_label).join(' + '),exportAmount(num(b.agreed_amount_original)/Math.max(1,num(b.guest_count)),b.currency_code),exportAmount(b.agreed_amount_original,b.currency_code),exportAmount(ba.paid_original||0,b.currency_code),exportAmount(ba.balance_original||0,b.currency_code),EVENT_BOOKING_STATUS_AR_V038[b.status]||statusLabel[b.status]||b.status];})}));
  const externalTable=root.querySelector('.event-external-purchases-table-v038');
  if(externalTable)registerTableExport(externalTable,()=>({title:`شراء ضيافة خارجية · ${state.event.name}`,
   headers:['الصنف','المورد','الكمية','الوحدة','تكلفة الحصة','إجمالي الشراء','حالة السداد'],
   rows:state.externalDishes.filter(x=>x.is_active!==false).map(x=>[x.name,x.vendor||'',x.purchased_quantity,x.unit_label,exportAmount(x.unit_cost_base),exportAmount(x.total_cost_base),x.paid_at?'مدفوع':'غير مدفوع'])}));
  const externalPlanTable=root.querySelector('.event-external-plans-table-v038');
  if(externalPlanTable)registerTableExport(externalPlanTable,()=>({title:`تخطيط الوجبات الخارجية · ${state.event.name}`,
   headers:['الصنف','مجموعة الضيافة','العدد المخطط','الوحدة','تكلفة التقديم'],
   rows:external().lines.map(l=>[l.item?.name||'',state.eventGroups.find(g=>g.id===l.rule.group_id)?.name||'مستقل',Number(l.required.toFixed(4)),l.item?.unit_label||'',exportAmount(l.cost)])}));
  const extraTable=root.querySelector('.event-extra-table-v034');
  if(extraTable)registerTableExport(extraTable,()=>({title:`فواتير الطاولات ${state.event.name}`,
   headers:['الطاولة','الوصف','الكمية','سعر الوحدة','الإجمالي','التكلفة الإجمالية (الأساس)','العملة','الحالة','الملاحظات'],
   rows:state.extras.map(x=>[state.tables.find(t=>t.id===x.table_id)?.table_label||'',x.description,x.quantity,exportAmount(x.unit_price_original,x.currency_code),exportAmount(x.amount_original,x.currency_code),exportAmount(x.total_cost_base),x.currency_code,statusLabel[x.status]||x.status,x.notes||''])}));
  const reportTable=root.querySelector('.event-report-table-v034');
  if(reportTable){const q=quote(),a=actual();registerTableExport(reportTable,()=>({title:`تقرير حفلة ${state.event.name} · ${state.event.status==='completed'?'مقفلة':'مبدئي'}`,
    headers:['البند','المخطط (الأساس)','الفعلي/المسجل (الأساس)','الملاحظات'],
    rows:[['الطعام من مطبخ المطعم',exportAmount(q.food-q.externalFood),exportAmount(state.summary.included_food_cost_base??state.summary.estimated_actual_included_food_cost_base),q.missing?'التكلفة غير مكتملة':''],
    ['وجبات مشتراة من الخارج',exportAmount(q.externalFood),exportAmount(a.externalCost),'المخطط يشمل الحد المتوقع حسب الطلب؛ الفعلي يعتمد على كميات الشراء'],
    ['المصاريف والموسيقى',exportAmount(q.others),exportAmount(state.summary.actual_other_expense_base),''],
    ['العمالة',exportAmount(q.labor),exportAmount(state.summary.actual_labor_cost_base),''],
    ['تكلفة إضافات الطاولات',exportAmount(0),exportAmount(a.extraCost),'تُحسب حتى قبل تحصيلها'],
    ['احتياط / هدر',exportAmount(q.reserve),exportAmount(a.wasteCost),'الهدر غير المكرر فقط'],
    ['إجمالي التكاليف',exportAmount(q.total),exportAmount(a.cost),a.incomplete?'تقديري':''],
    ['الإيراد',exportAmount(q.revenue),exportAmount(a.revenue),'الحجوزات وأوردرات الحفلة وإضافاتها'],
    ['مدفوع من إضافات الطاولات',exportAmount(0),exportAmount(a.extraCollected),'من الصندوق'],
    ['مستحق من إضافات الطاولات',exportAmount(0,priceCurrency()),exportAmount(a.extraDue,priceCurrency()),'بعملة التذكرة'],
    ['الربح/الخسارة',exportAmount(q.profit),exportAmount(a.profit),state.event.status==='completed'?'مقفل':'مبدئي']]}));}

 }
 await reload();
}
