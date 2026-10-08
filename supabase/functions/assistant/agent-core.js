/** Maria CFO v0.17 -- pure, testable assistant validations. No database access. */
export const KNOWN_CURRENCIES = new Set(['SYP', 'USD']);
export const PAY_COLUMN = Object.freeze({monthly:'monthly_salary_original', daily:'daily_rate_original', hourly:'hourly_rate_original'});
export const ALLOWED_ROUTES = new Set(['dashboard','reports','orders','order','purchases','purchase','employees-list','employees','attendance','payroll','materials','menu','suppliers','cashboxes','expenses','events-list','events','settings','assistant','inventory']);
export const ALLOWED_TYPES = new Set([
  'read_dashboard','read_finances','lookup_records','create_employees','create_event',
  'create_supplier','create_material','create_order_draft','create_purchase_draft',
  'post_order','post_purchase','pay_daily_wage','pay_approved_salary','record_expense',
  'set_attendance','set_payroll_cashbox',
]);
export const CONFIRM_REQUIRED = new Set(['post_order','post_purchase','pay_daily_wage','pay_approved_salary','record_expense','set_payroll_cashbox']);

export function toWesternDigits(value='') {
  const ar='٠١٢٣٤٥٦٧٨٩',fa='۰۱۲۳۴۵۶۷۸۹';
  return String(value).replace(/[٠-٩]/g,x=>String(ar.indexOf(x))).replace(/[۰-۹]/g,x=>String(fa.indexOf(x))).replace(/[٬،]/g,x=>x==='٬'?'':x);
}
export function finitePositive(x){const n=Number(toWesternDigits(x));return Number.isFinite(n)&&n>0?n:null;}
export function parseEmployeeCommand(message) {
  const text=toWesternDigits(message).replace(/[\n;:,،]+/g,' ').replace(/\s+/g,' ').trim();
  if(!/(?:^|\s)(?:أضف|اضف|إضافة|سجل|أنشئ|انشئ|وظّف|وظف)(?:\s|$)/.test(text) || !/(يومي|شهري|بالساعة|ساعي)/.test(text)) return null;
  const re=/([\p{Script=Arabic}][\p{Script=Arabic}\s]{0,48}?)\s+(يومي|شهري|بالساعة|ساعي)\s+(?:(?:براتب|بأجر|راتبه|اجره|أجره|راتب|أجر)\s*)?([0-9]+(?:\.[0-9]+)?)(?:\s*(SYP|USD|ليرة|دولار))?/gu;
  const results=[];
  let match;
  while((match=re.exec(text))!==null){
    let name=match[1].trim();
    for(let i=0;i<6;i++){
      const next=name.replace(/^(?:أضف|اضف|إضافة|إضافه|سجل|أريد|اريد|موظف|موظفين|عامل|عمال|هم|هو|هي|الاسم|اسم|اسمه)(?:\s+|$)/u,'').trim();
      if(next===name)break;name=next;
    }
    if(results.length && /^و[\p{Script=Arabic}]/u.test(name)) return null; // Ambiguous conjunction vs. real name: ask AI instead.
    const payType=match[2]==='شهري'?'monthly':match[2]==='يومي'?'daily':'hourly';
    const wage=finitePositive(match[3]);
    if(name && wage)results.push({name,payType,wage,currency:match[4]==='USD'||match[4]==='دولار'?'USD':'SYP'});
  }
  const mentionedTypes=(text.match(/يومي|شهري|بالساعة|ساعي/g)||[]).length;
  return results.length&&mentionedTypes===results.length?results:null;
}
export function normalizeEmployee(input={}) {
  const name=String(input.name??'').trim().replace(/\s+/g,' ');
  const payType=({'شهري':'monthly','يومي':'daily','ساعي':'hourly','بالساعة':'hourly'})[input.payType||input.pay_type]||input.payType||input.pay_type;
  const wage=finitePositive(input.wage??input.rate??input.salary);
  const currency=String(input.currency||input.wage_currency_code||'SYP').toUpperCase();
  const missing=[];
  if(!name) missing.push('اسم الموظف');
  if(!PAY_COLUMN[payType]) missing.push('نوع الأجر: يومي، ساعي، أو شهري');
  if(wage===null) missing.push('قيمة الأجر (أكبر من صفر)');
  if(!KNOWN_CURRENCIES.has(currency)) missing.push('العملة SYP أو USD');
  return {missing,record: missing.length?null:{name,pay_type:payType,wage_currency_code:currency,
    job_title:String(input.jobTitle??input.job_title??'').trim()||null,
    [PAY_COLUMN[payType]]:wage}};
}
export function normalizeEmployees(items){
  if(!Array.isArray(items)||items.length===0)return {missing:['أسماء الموظفين وأنواع أجورهم وقيمها'],records:[]};
  if(items.length>20)return {missing:['الحد الأقصى 20 موظفًا في الطلب الواحد'],records:[]};
  const result=items.map((item,i)=>({index:i+1,...normalizeEmployee(item)}));
  const missing=result.filter(x=>x.missing.length).map(x=>`الموظف ${x.index}: ${x.missing.join('، ')}`);
  const names=result.map(x=>x.record?.name?.toLocaleLowerCase('ar'));
  if(new Set(names).size!==names.length)missing.push('يوجد اسمان متكرران داخل الطلب؛ صححهما قبل الحفظ');
  return {missing,records:result.map(x=>x.record).filter(Boolean)};
}
export function localDailyDue({payType='daily',status='full',workedHours=0,expectedHours=8,dailyRate=0,hourlyRate=0,approvedOvertime=0,appliedShortage=null,calculatedShortage=null,overtimeMultiplier=1.5,shortageMultiplier=1}) {
  const worked=Number(workedHours)||0, expected=Number(expectedHours)||0;
  if(['absent','unpaid_leave','day_off','holiday'].includes(status))return 0;
  if(status!=='paid_leave'&&worked<=0)return 0;
  if(payType==='hourly')return Math.max(0,Math.round(((status==='paid_leave'?expected:Math.min(worked,expected))*hourlyRate+approvedOvertime*hourlyRate*overtimeMultiplier)*10000)/10000);
  if(payType!=='daily'||expected<=0)return 0;
  const shortage=status==='paid_leave'?0:(appliedShortage??calculatedShortage??Math.max(0,expected-worked));
  return Math.max(0,Math.round((dailyRate-shortage*(dailyRate/expected)*shortageMultiplier+approvedOvertime*(dailyRate/expected)*overtimeMultiplier)*10000)/10000);
}
export function safeLink(raw){
  const s=String(raw||'').trim();
  const m=s.match(/^#\/([a-z-]+)(?:\/([0-9a-f-]{36}))?$/i);
  return m&&ALLOWED_ROUTES.has(m[1])?s:null;
}
export function normalizePlan(value){
  const obj=typeof value==='string'?JSON.parse(value):value;
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('INVALID_ASSISTANT_PLAN');
  const actions=Array.isArray(obj.actions)?obj.actions.slice(0,8).filter(x=>ALLOWED_TYPES.has(x?.type)).map(x=>({type:x.type,args:x.args&&typeof x.args==='object'&&!Array.isArray(x.args)?x.args:{}})):[];
  const links=Array.isArray(obj.links)?obj.links.slice(0,8).map(x=>({label:String(x.label||'فتح القسم').slice(0,70),href:safeLink(x.href)})).filter(x=>x.href):[];
  return {answer:String(obj.answer||'').slice(0,10000),actions,links,question:String(obj.question||'').slice(0,1000)};
}
export function inspectDocument(item){
  const kind=item?.kind==='purchase'?'purchase':item?.kind==='order'?'order':null;
  const rows=Array.isArray(item?.items)?item.items.slice(0,60).map(x=>({name:String(x?.name||'').trim().slice(0,160),quantity:finitePositive(x?.quantity),unit_price:Number(toWesternDigits(x?.unit_price||0)),unit:String(x?.unit||'').trim().slice(0,64),discount_percent:Number(toWesternDigits(x?.discount_percent||0)),confidence:Number(x?.confidence||0)})):[];
  const missing=[];
  if(!kind)missing.push('نوع المستند (فاتورة شراء أم أوردر)');
  if(!rows.length)missing.push('أصناف المستند');
  for(const [i,r] of rows.entries()){
    if(!r.name)missing.push(`اسم الصنف ${i+1}`);
    if(!(r.quantity>0))missing.push(`كمية الصنف ${i+1}`);
    if(!Number.isFinite(r.unit_price)||r.unit_price<=0)missing.push(`سعر وحدة الصنف ${i+1}`);
    if(!Number.isFinite(r.discount_percent)||r.discount_percent<0||r.discount_percent>100)missing.push(`نسبة خصم البند ${i+1} بين 0 و100`);
  }
  return {kind,items:rows,missing,
    document_date:/^\d{4}-\d{2}-\d{2}$/.test(item?.document_date)?item.document_date:null,
    currency:KNOWN_CURRENCIES.has(String(item?.currency||'SYP').toUpperCase())?String(item?.currency||'SYP').toUpperCase():'SYP',
    supplier_name:String(item?.supplier_name||'').trim().slice(0,150),
    document_number:String(item?.document_number||'').trim().slice(0,150),
    cashbox_id:item?.cashbox_id||null};
}
