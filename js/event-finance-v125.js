// v1.0.25: pure presentation helpers. PostgreSQL is authoritative for money and status.
const finite=(value,label)=>{
 if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))throw Error(label);
 return Number(value);
};
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const round4=value=>Math.round((value+Number.EPSILON)*10000)/10000;
export const isExternalHospitalityV125=d=>d.is_active!==false&&(d.billing_mode_v125||'hospitality')==='hospitality';
export const eventOrderSourceV125=row=>row.status==='complimentary'?'ضيافة إضافية مجانية':
 row.external_dish_id_v125?'طلب خارجي':row.source_v125==='internal'?'طلب داخلي من المطعم':'طلب إضافي سابق';
export function eventOrderRequestKeyV125(){
 if(!globalThis.crypto?.randomUUID)throw Error('V125_SECURE_CONTEXT_REQUIRED');
 return globalThis.crypto.randomUUID();
}
export function eventOrderLineV125(row={}){
 const billed=['pending','paid'].includes(row.status);
 const costed=['pending','paid','refunded','complimentary'].includes(row.status);
 const revenue=billed?round4(n(row.amount_original)*n(row.exchange_rate_to_base)):0;
 const cost=costed?n(row.total_cost_base??n(row.quantity)*n(row.unit_cost_base)):0;
 return {revenue,cost,profit:round4(revenue-cost),source:eventOrderSourceV125(row),
  isHospitality:row.status==='complimentary',isExternal:!!row.external_dish_id_v125};
}
export function eventInternalPreviewV125({quantity,unitCost,unitPrice,exchangeRate,billingMode='sale'}={}){
 const q=finite(quantity,'V125_INTERNAL_ORDER_INVALID'),cost=finite(unitCost,'EVENT_EXTRA_COST_REQUIRED');
 const fx=finite(exchangeRate,'V125_EXCHANGE_RATE_REQUIRED');
 if(q<=0||cost<0||fx<=0||!['sale','hospitality'].includes(billingMode))throw Error('V125_INTERNAL_ORDER_INVALID');
 const price=billingMode==='hospitality'?0:finite(unitPrice,'V125_SALE_PRICE_REQUIRED');
 if(price<0||(billingMode==='sale'&&price<=0))throw Error('V125_SALE_PRICE_REQUIRED');
 const totalOriginal=round4(q*price),totalCost=round4(q*round4(cost)),revenue=round4(totalOriginal*fx);
 return {quantity:q,totalOriginal,totalCost,revenue,profit:round4(revenue-totalCost),unitProfit:round4(price*fx-cost),billingMode};
}
export function eventExternalPreviewV125({quantity,unitCost,unitProfit,exchangeRate,billingMode='sale'}={}){
 const q=finite(quantity,'V125_EXTERNAL_ORDER_INVALID'),cost=finite(unitCost,'EVENT_EXTRA_COST_REQUIRED');
 const markup=billingMode==='hospitality'?0:finite(unitProfit,'V125_MARKUP_INVALID');
 const fx=finite(exchangeRate,'V125_EXCHANGE_RATE_REQUIRED');
 if(q<=0||cost<0||markup<0||fx<=0||!['sale','hospitality'].includes(billingMode))throw Error('V125_EXTERNAL_ORDER_INVALID');
 const totalCost=round4(q*cost),wantedSale=round4(q*(cost+markup));
 const totalOriginal=billingMode==='sale'?Math.ceil(wantedSale/fx*10000-1e-8)/10000:0;
 if(billingMode==='sale'&&totalOriginal<=0)throw Error('V125_SALE_PRICE_REQUIRED');
 const revenue=round4(totalOriginal*fx);
 return {quantity:q,totalCost,totalOriginal,revenue,profit:round4(revenue-totalCost),unitProfit:markup,billingMode};
}
// Never turn a missing migration / truncated legacy summary into a plausible zero result.
export function eventActualResultV125({historical={},bookingBalances=[],tables=[]}={}){
 for(const field of ['revenue_base_v125','cost_base_v125','profit_base_v125','extra_revenue_base_v125',
  'extra_cost_base_v125','extra_due_original_v125','pending_extra_count_v125','hospitality_cost_base_v125',
  'internal_revenue_base_v125','internal_cost_base_v125','external_cost_base_v125','kitchen_hospitality_cost_base_v125']){
  finite(historical[field],'V125_FINANCIAL_SUMMARY_MISSING');
 }
 const h=historical,guests=n(h.actual_guest_count)||tables.filter(t=>t.status!=='cancelled').reduce((s,t)=>s+n(t.actual_guest_count),0);
 const bookingDue=bookingBalances.filter(b=>!['cancelled','no_show'].includes(b.booking_status)).reduce((s,b)=>s+n(b.balance_original),0);
 const incomplete=Boolean(h.cost_incomplete_v125),pendingCount=n(h.pending_extra_count_v125);
 return {revenue:n(h.revenue_base_v125),cost:n(h.cost_base_v125),profit:n(h.profit_base_v125),guests,
  costPerPerson:guests>0?n(h.cost_base_v125)/guests:null,booked:n(h.earned_revenue_base),
  extraEarned:n(h.extra_revenue_base_v125),extraCost:n(h.extra_cost_base_v125),
  extraCollected:n(h.extra_collected_base_v125),extraDue:n(h.extra_due_original_v125),pendingCount,bookingDue,
  wasteCost:n(h.waste_cost_base_v125),externalCost:n(h.external_cost_base_v125),
  internalRevenue:n(h.internal_revenue_base_v125),internalCost:n(h.internal_cost_base_v125),
  internalProfit:n(h.internal_profit_base_v125),externalRevenue:n(h.external_revenue_base_v125),
  externalSaleCost:n(h.external_sale_cost_base_v125),externalProfit:n(h.external_profit_base_v125),
  externalHospitalityCost:n(h.external_hospitality_cost_base_v125),
  kitchenHospitalityCost:n(h.kitchen_hospitality_cost_base_v125),hospitalityCost:n(h.hospitality_cost_base_v125),additionalHospitalityCost:n(h.additional_hospitality_cost_base_v125),
  unpostedHospitalityCost:n(h.unposted_hospitality_cost_base_v125),
  collectionFX:n(h.extra_collection_fx_base_v125),dueCurrencyMismatch:n(h.extra_due_currency_mismatch_v125),
  incomplete,readyToClose:pendingCount===0&&bookingDue<=.0001&&!incomplete};
}
// One row source for the screen and exported event report.
export function eventReportRowsV125(q,a,h={}){
 return [
  {label:'ضيافة مطبخ المطعم',planned:q.food-q.externalFood,actual:a.kitchenHospitalityCost,note:'تكلفة فقط؛ تشمل المقدّم حسب الطلب مرة واحدة. تكلفة الوصفات غير المرحّلة للمخزون تبقى تقديرية.'},
  {label:'ضيافة إضافية مجانية غير مخططة',planned:null,actual:a.additionalHospitalityCost,note:'لا سعر بيع ولا إيراد إضافي؛ تخفض ربح الحفلة بمقدار تكلفتها.'},
  {label:'ضيافة مشتراة من الخارج',planned:q.externalFood,actual:a.externalHospitalityCost,note:'كامل تكلفة الشراء، وليس حركة دفع المورد مرة ثانية.'},
  {label:'تكلفة الطلبات الداخلية المباعة والطلبات السابقة',planned:null,actual:a.internalCost,note:'تكلفة الوصفة المثبتة عند التسجيل أو تكلفة يدوية صريحة؛ تُبقى عند استرداد ثمن الطلب المنفذ.'},
  {label:'تكلفة الطلبات الخارجية المباعة',planned:null,actual:a.externalSaleCost,note:'تُؤخذ من المشتريات فقط؛ لا تكرر تكلفة فاتورة البيع المرتبطة.'},
  {label:'تكلفة أوردرات المطعم المرتبطة بالحفلة',planned:null,actual:n(h.order_food_cost_base),note:'من نظام الأوردرات الأصلي؛ لا تعِد إدخال نفس الطلب هنا.'},
  {label:'المصاريف والفرقة',planned:q.others,actual:n(h.actual_other_expense_base),note:'المصروف الفعلي المسجل للحفلة.'},
  {label:'العمالة',planned:q.labor,actual:n(h.actual_labor_cost_base),note:'الأجور المرتبطة بالحفلة.'},
  {label:'احتياط الهدر / الهدر المسجل',planned:q.reserve,actual:a.wasteCost,note:'هدر إضافي غير محتسب سابقًا فقط.'},
  {label:'التكلفة الإجمالية',planned:q.total,actual:a.cost,total:true,note:a.incomplete?'⚠ توجد تكلفة غير مكتملة؛ لا تعتمد النتيجة نهائيًا.':'مجموع التكاليف دون تكرار.'},
  {label:'إجمالي الإيرادات',planned:q.revenue,actual:a.revenue,total:true,note:'إيراد الحفلة + مبيعات الطلبات الداخلية والخارجية؛ لا يشمل الضيافة المجانية.'},
  {label:'ضمن الإيرادات: الطلبات الداخلية والسابقة',planned:null,actual:a.internalRevenue,note:'تفصيل من الإجمالي، وليس مبلغًا يضاف ثانيةً.'},
  {label:'ضمن الإيرادات: الطلبات الخارجية',planned:null,actual:a.externalRevenue,note:'تكلفة الشراء المستردة من العميل + الربح، وفق سعر الصرف المحفوظ.'},
  {label:'ربح الطلبات الداخلية والسابقة',planned:null,actual:a.internalProfit,note:'تفصيل من نتيجة الحفلة = مبيعاتها − تكلفتها؛ لا يضاف ثانيةً إلى الربح.'},
  {label:'ربح الطلبات الخارجية',planned:null,actual:a.externalProfit,note:'تفصيل من نتيجة الحفلة = المبيعات الخارجية − تكلفة مشترياتها.'},
  {label:'تحصيلات الطلبات المدفوعة غير المستردة',planned:null,actual:a.extraCollected,note:'نقد محصل، وليس إيرادًا جديدًا. لا يشمل الحجوزات.'},
  {label:'فرق تحويل تحصيل الطلبات',planned:null,actual:a.collectionFX,note:'فرق سعر الصرف بين البيع والتحصيل؛ مفصول عن ربح التشغيل المعروض.'},
  {label:'مستحقات الطلبات بعملة الحفلة',planned:null,actual:a.extraDue,currency:'ticket',note:'لم تُقبض بعد؛ ليست رصيدًا في الصندوق.'},
  {label:'الربح أو الخسارة التشغيلية للحفلة',planned:q.profit,actual:a.profit,total:true,note:'الإيرادات − التكاليف. الضيافة تُحمّل تكلفة فقط، والربح ليس مبلغ النقد في الصندوق.'},
 ];
}
