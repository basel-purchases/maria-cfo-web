// Maria CFO v0.17 -- STANDALONE / COPY-PASTE INTO SUPABASE EDGE FUNCTION EDITOR
// Name: assistant. Do NOT embed Gemini keys here. Use Supabase Secrets: GEMINI_API_KEY.
// This generated single-file contains the same logic as index.ts + 2 local modules.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/** Maria CFO v0.17 -- pure, testable assistant validations. No database access. */
const KNOWN_CURRENCIES = new Set(['SYP', 'USD']);
const PAY_COLUMN = Object.freeze({monthly:'monthly_salary_original', daily:'daily_rate_original', hourly:'hourly_rate_original'});
const ALLOWED_ROUTES = new Set(['dashboard','reports','orders','order','purchases','purchase','employees-list','employees','attendance','payroll','materials','menu','suppliers','cashboxes','expenses','events-list','events','settings','assistant','inventory']);
const ALLOWED_TYPES = new Set([
  'read_dashboard','read_finances','lookup_records','create_employees','create_event',
  'create_supplier','create_material','create_order_draft','create_purchase_draft',
  'post_order','post_purchase','pay_daily_wage','pay_approved_salary','record_expense',
  'set_attendance','set_payroll_cashbox',
]);
const CONFIRM_REQUIRED = new Set(['post_order','post_purchase','pay_daily_wage','pay_approved_salary','record_expense','set_payroll_cashbox']);

function toWesternDigits(value='') {
  const ar='٠١٢٣٤٥٦٧٨٩',fa='۰۱۲۳۴۵۶۷۸۹';
  return String(value).replace(/[٠-٩]/g,x=>String(ar.indexOf(x))).replace(/[۰-۹]/g,x=>String(fa.indexOf(x))).replace(/[٬،]/g,x=>x==='٬'?'':x);
}
function finitePositive(x){const n=Number(toWesternDigits(x));return Number.isFinite(n)&&n>0?n:null;}
function parseEmployeeCommand(message) {
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
function normalizeEmployee(input={}) {
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
function normalizeEmployees(items){
  if(!Array.isArray(items)||items.length===0)return {missing:['أسماء الموظفين وأنواع أجورهم وقيمها'],records:[]};
  if(items.length>20)return {missing:['الحد الأقصى 20 موظفًا في الطلب الواحد'],records:[]};
  const result=items.map((item,i)=>({index:i+1,...normalizeEmployee(item)}));
  const missing=result.filter(x=>x.missing.length).map(x=>`الموظف ${x.index}: ${x.missing.join('، ')}`);
  const names=result.map(x=>x.record?.name?.toLocaleLowerCase('ar'));
  if(new Set(names).size!==names.length)missing.push('يوجد اسمان متكرران داخل الطلب؛ صححهما قبل الحفظ');
  return {missing,records:result.map(x=>x.record).filter(Boolean)};
}
function localDailyDue({payType='daily',status='full',workedHours=0,expectedHours=8,dailyRate=0,hourlyRate=0,approvedOvertime=0,appliedShortage=null,calculatedShortage=null,overtimeMultiplier=1.5,shortageMultiplier=1}) {
  const worked=Number(workedHours)||0, expected=Number(expectedHours)||0;
  if(['absent','unpaid_leave','day_off','holiday'].includes(status))return 0;
  if(status!=='paid_leave'&&worked<=0)return 0;
  if(payType==='hourly')return Math.max(0,Math.round(((status==='paid_leave'?expected:Math.min(worked,expected))*hourlyRate+approvedOvertime*hourlyRate*overtimeMultiplier)*10000)/10000);
  if(payType!=='daily'||expected<=0)return 0;
  const shortage=status==='paid_leave'?0:(appliedShortage??calculatedShortage??Math.max(0,expected-worked));
  return Math.max(0,Math.round((dailyRate-shortage*(dailyRate/expected)*shortageMultiplier+approvedOvertime*(dailyRate/expected)*overtimeMultiplier)*10000)/10000);
}
function safeLink(raw){
  const s=String(raw||'').trim();
  const m=s.match(/^#\/([a-z-]+)(?:\/([0-9a-f-]{36}))?$/i);
  return m&&ALLOWED_ROUTES.has(m[1])?s:null;
}
function normalizePlan(value){
  const obj=typeof value==='string'?JSON.parse(value):value;
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('INVALID_ASSISTANT_PLAN');
  const actions=Array.isArray(obj.actions)?obj.actions.slice(0,8).filter(x=>ALLOWED_TYPES.has(x?.type)).map(x=>({type:x.type,args:x.args&&typeof x.args==='object'&&!Array.isArray(x.args)?x.args:{}})):[];
  const links=Array.isArray(obj.links)?obj.links.slice(0,8).map(x=>({label:String(x.label||'فتح القسم').slice(0,70),href:safeLink(x.href)})).filter(x=>x.href):[];
  return {answer:String(obj.answer||'').slice(0,10000),actions,links,question:String(obj.question||'').slice(0,1000)};
}
function inspectDocument(item){
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


/** User-approved Maria CFO core policy, not a substitute for live DB results. */
const PROJECT_KNOWLEDGE_AR = `
المشروع: Maria CFO، المدير المالي الذكي للمطعم، واجهة ويب عربية RTL ونظام PostgreSQL/Auth/RLS/Edge Functions على Supabase، والمالك وحده مصرح له الآن. التطبيق السابق Flutter غير مستخدم حاليًا. الهدف: أقل إدخال يدوي وأعلى سلامة مالية.
الأقسام: المواد، وحدات الشراء والتحويلات، الموردون، المشتريات، المخزون والجرد، الوجبات والوصفات، الأوردرات، الصناديق، المصروفات، الحفلات والحجوزات، الموظفون والدوام والسلف والرواتب، الإحصائيات والتنبيهات، المساعد الذكي.
العملة الأساسية ليرة سورية SYP، والثانوية USD. كل عملية مالية متعددة العملات تحفظ مبلغ العملة الأصلية وسعر الصرف التاريخي والمبلغ الأساسي؛ لا يُعاد حساب الماضي بسعر صرف اليوم.
المشتريات تزيد المخزون وليست مصروف تشغيل مباشر. تكاليف الوصفات والبيع والحفلات تحفظ لقطة وقت النشر؛ لا تغير أسعار اليوم التقارير التاريخية. يمكن قبول المخزون السالب مؤقتًا مع تنبيه دون تزوير الرصيد. تكلفة غير مكتملة تعني نتائج مالية مؤقتة وليست أرباحًا نهائية.
الصناديق الافتراضية: صندوق 1، صندوق 2، الصندوق العام. الصندوق النقدي يفتح جلسة كل يوم عمل، وكل حركة صندوق حساسة تمر عبر RPC محمية، والإغلاق التاريخي لا يُعدّل دون إعادة فتح مبررة.
المورد اختياري للمستخدم؛ حين يترك فارغًا تستخدم الواجهة مورّدًا داخليًا باسم «شراء مباشر». يمكن استرجاع بنود آخر فاتورة لمورد معروف وتعديلها، والنشر ينشئ حركات مخزون تاريخية.
الأوردر: يُنشأ كمسودة، تُضاف له وجبات بكميات وأسعار وتعديلات، عند النشر تُنشأ حركة صندوق ومخزون ولقطة تكلفة تاريخية، والتكرارات تُراجع. الصور لا تنشر من دون مراجعة.
الموظف: أجر شهري أو يومي أو بالساعة، حقول الأجر monthly_salary_original أو daily_rate_original أو hourly_rate_original حسب نوع الأجر، والعملة wage_currency_code. الدوام يستخدم work_date، expected_hours وworked_hours، وapproved_overtime_hours وapplied_shortage_hours. الأجر اليومي بلا ساعات فعلية لا يُستحق تلقائيًا إلا إذا سُجلت حالة paid_leave صراحةً؛ لا تعتبر عدم تطبيق النقص إذنًا بصرف يوم لم يُعمل. الراتب الشهري لا يُخصم نقصه تلقائيًا. الرواتب والسلف والدفعات تحفظ في مسيرات واعتمادات ودفعات، ودفع الراتب يخصم من صندوق الرواتب المحدد دون حذف التاريخ.
الحفلات عامة/خاصة، الإيراد بحسب bookings أو orders أو both. عند both فإن أوردرات الحفلة تمثل مبيعات إضافية فقط، والطعام المضمن يدخل في استهلاك الحفلة؛ لا حساب مزدوج. العمالة الموزعة على حفلة ليست دفعة صندوق ثانية إذا كانت جزءًا من راتب.
التقارير تعرض الإيرادات والمبيعات وFood Cost وتكلفة المخزون والمصروفات والرواتب والصناديق والحفلات والتنبيهات وفروق العملات وحالات اكتمال البيانات؛ المصدر الوحيد للأرقام الحالية هو القراءة الموثوقة من RPCs/Views، لا هذا النص التعريفي.
مبادئ الأمان: لا كتابة مباشرة إلى cashbox_transactions أو inventory_movements، ولا تعديل أوردر أو مشتريات منشورة، ولا حذف سجل مالي تاريخي؛ التصحيح عبر void/reopen/revisions/audit. تنفيذ المدفوعات والاعتمادات المالية يتطلب مراجعة المدير.
OCR للمشتريات والأوردرات: يستخرج بنود الصورة فقط دون تخمين. يعرض المادة/الوجبة والكمية والسعر والثقة، ويطلب مراجعة قبل إنشاء مسودة. الوحدات تظهر بالعربية في الواجهة مع بقاء الأكواد في قاعدة البيانات.
التنقل: الرئيسية #/dashboard، المواد #/materials، الموردون #/suppliers، المشتريات #/purchases، الوجبات #/menu، الأوردرات #/orders، المخزون #/inventory، الصناديق #/cashboxes، المصروفات #/expenses، الموظفون #/employees-list، الدوام #/attendance، الرواتب #/payroll، الحفلات #/events-list، التقارير #/reports، الإعدادات #/settings.
هذا سياق بنية المشروع وليس بيانات مالية حية ولا إذنًا بتنفيذ أوامر غير مدعومة.
`;



// Maria CFO v0.17: owner-authenticated, server-side action agent.
// The LLM suggests actions; ONLY the explicit whitelist below can access Supabase.
// All PostgREST calls run as the authenticated owner with the database's RLS and RPC rules.
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const PLAN_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite';
const MODELS = [...new Set([PLAN_MODEL,'gemini-3.5-flash-lite','gemini-3.8-flash'])].filter(Boolean).slice(0,3);
const RETRYABLE = new Set([408,429,500,502,503,504]);
const wait = (ms:number) => new Promise(r=>setTimeout(r,ms));
const respond=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const short=(value:unknown,n=200)=>String(value??'').trim().slice(0,n);
const dateToday=()=>new Date().toISOString().slice(0,10);
const dateOK=(s:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''));
const norm=(s:unknown)=>String(s||'').trim().toLocaleLowerCase('ar').replace(/[أإآ]/g,'ا').replace(/[ًٌٍَُِّْـ]/g,'').replace(/ى/g,'ي').replace(/\s+/g,' ');
const errText=(e:any)=>short(e?.message||e?.details||e?.code||e,320);

function supabasePublicKey(){
  const raw=Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if(raw){try{const x=JSON.parse(raw);return x?.default||Object.values(x)[0]||'';}catch(_){}}
  return Deno.env.get('SUPABASE_ANON_KEY')||'';
}
function systemPrompt(){return `${PROJECT_KNOWLEDGE_AR}\nتاريخ الخادم اليوم ${dateToday()} بتوقيت UTC (تحقق من تاريخ يوم العمل في قاعدة البيانات عند الحاجة). أنت وكيل Maria CFO التشغيلي، تتحدث العربية بلطف ووضوح. أنت مساعد فعلي يستطيع تنفيذ الأدوات المصادق عليها.
قواعد أساسية: راحة المستخدم، صحة الحسابات وسلامة البيانات، صفر تخمين للأرقام، لا SQL مطلقًا ولا تعديل مباشر للدفاتر.
العملات SYP و USD. المشتريات تزيد المخزون ولا تعتبر مصروف تشغيل؛ الرواتب تُدفع عبر RPCات محمية.
نوع أجر الموظف monthly/daily/hourly، قيمة الأجر > 0، والعملة SYP تلقائيًا إن لم يحدد المستخدم عملة؛ المسمى الوظيفي اختياري.
يمكن إضافة موظفين دفعة واحدة فور الطلب (دون تأكيد، لأن المستخدم طلب الإدخال). املأ الحقول التي حددها المستخدم فقط. مثال: اضف موظفين هم انس يومي براتب 100، زياد شهري براتب 3000 -> create_employees {employees:[{name:'انس',payType:'daily',wage:100},{name:'زياد',payType:'monthly',wage:3000}]}.
عندما لا تتوفر حقول إلزامية لا تختلقها. اسأل عن الحقول الناقصة صراحة ثم أكمل من المحادثة.
للإحصائيات أو الأرصدة لا تخترع أي مبلغ؛ اطلب read_dashboard أو read_finances أو lookup_records. إرجاع النتائج يحتاج شرحها بعد القراءة.
لإنشاء أوردر: create_order_draft، يتطلب أسماء أصناف موجودة في قائمة الطعام وكميات وأسعار معروفة؛ لا تنشر دون موافقة.
للفواتير create_purchase_draft ويستلزم مطابقة المواد ووحدة الشراء. المورد اختياري. لا تنشر دون موافقة.
صرف راتب أو ترحيل فاتورة/أوردر أو تسجيل مصروف نقدي يتطلب تأكيدًا صريحًا ويُعرض ملخص للعملية قبل تنفيذها.
الصور لا تنتج قيودًا مباشرة، بل تعرض أولًا أصنافها وكمياتها وأسعارها للمراجعة والتأكيد.
إذا كان الطلب غير مدعوم بأداة حالية، أخبر المستخدم بوضوح مع رابط القسم ليكمل منه، ولا تدع أنك فعلته.
روابط صفحات الموقع: #/dashboard #/materials #/suppliers #/purchases #/menu #/orders #/cashboxes #/expenses #/employees-list #/attendance #/payroll #/events-list #/reports #/settings #/assistant.
أنواع الإجراءات المسموح أن تختارها: read_dashboard,read_finances,lookup_records,create_employees,create_event,create_supplier,create_material,create_order_draft,create_purchase_draft,post_order,post_purchase,pay_daily_wage,pay_approved_salary,record_expense,set_attendance,set_payroll_cashbox.
أعد JSON فقط بالصيغة {"answer":"جواب موجز","actions":[{"type":"...","args":{}}],"links":[{"label":"...","href":"#/..."}],"question":"..."}. لا تُنفذ عبر نصوص أو أوامر SQL.
اربط context طلبات المتابعة بأسئلة وبيانات الرسائل السابقة، ولا تكرر التنفيذ المنجز سابقًا.`;}

class ProviderError extends Error {
  status:number; model:string;
  constructor(status:number,model:string,message:string){super(message);this.status=status;this.model=model;}
}
async function gemini(key:string,contents:any[],jsonMode=true,extra:any={}){
  let last:ProviderError=new ProviderError(0,'','Gemini unavailable');
  for(const model of MODELS){
    const tries=model===MODELS[0]?2:1;
    for(let i=0;i<tries;i++){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),i===0?16000:13000);
      try{
        const body:any={contents,
          generationConfig:{temperature:0.12,maxOutputTokens:5500},
          ...extra};
        if(jsonMode)body.generationConfig.responseMimeType='application/json';
        const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
          method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body),signal:controller.signal});
        const data=await res.json().catch(()=>({}));
        if(!res.ok){
          const msg=short(data?.error?.message||`Gemini HTTP ${res.status}`,220);
          last=new ProviderError(res.status,model,msg);
          console.warn('Gemini provider error',{model,status:res.status,kind:data?.error?.status||'HTTP'});
          if(res.status===400||res.status===401||res.status===403)break;
          if(!RETRYABLE.has(res.status)&&res.status!==404)break;
        }else{
          const text=(data?.candidates?.[0]?.content?.parts||[]).map((x:any)=>x?.text||'').join('').trim();
          if(text)return {text,model};
          last=new ProviderError(422,model,'Gemini returned no text');
        }
      }catch(e:any){
        last=new ProviderError(0,model,e?.name==='AbortError'?'provider_timeout':short(e?.message,180));
        console.warn('Gemini request unavailable',{model,kind:last.message});
      }finally{clearTimeout(timer);}
      if(i+1<tries)await wait(400);
    }
  }
  throw last;
}
function decodeJson(text:string){
  const stripped=text.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
  try{return JSON.parse(stripped);}catch(_){
    const first=stripped.indexOf('{'),last=stripped.lastIndexOf('}');
    if(first>=0&&last>first)return JSON.parse(stripped.slice(first,last+1));
    throw new Error('AI_JSON_PARSE_FAILED');
  }
}
function historyParts(history:any[],message:string){
  const contents=(Array.isArray(history)?history.slice(-14):[]).map(x=>({role:x?.role==='assistant'?'model':'user',parts:[{text:short(x?.content,3600)}]})).filter(x=>x.parts[0].text);
  if(contents.at(-1)?.role!=='user'||contents.at(-1)?.parts[0].text!==message)contents.push({role:'user',parts:[{text:message}]});
  return contents;
}
async function rowList(db:any,table:string,limit=60){const {data,error}=await db.from(table).select('*').limit(Math.max(1,Math.min(500,limit)));if(error)throw error;return data||[];}
async function callRpc(db:any,name:string,args:any={}){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
async function matching(db:any,table:string,name:string){
  const rows=await rowList(db,table,100);
  return rows.find((x:any)=>norm(x.name)===norm(name))||null;
}
function assertValidDate(value:any,label:string){if(!dateOK(value)||Number.isNaN(Date.parse(String(value)+'T12:00:00Z')))throw new Error(`يلزم تحديد ${label} بصيغة YYYY-MM-DD.`);return String(value);}
function link(label:string,href:string){return {label,href};}
function navFor(type:string,id?:string){
  const base:Record<string,string>={create_employees:'#/employees-list',create_event:'#/events-list',create_supplier:'#/suppliers',create_material:'#/materials',create_order_draft:'#/orders',post_order:'#/orders',create_purchase_draft:'#/purchases',post_purchase:'#/purchases',pay_daily_wage:'#/payroll',pay_approved_salary:'#/payroll',record_expense:'#/expenses',set_attendance:'#/attendance',set_payroll_cashbox:'#/settings'};
  if(type==='create_order_draft'||type==='post_order')return link('فتح الأوردر',id?'#/order/'+id:'#/orders');
  if(type==='create_purchase_draft'||type==='post_purchase')return link('فتح الفاتورة',id?'#/purchase/'+id:'#/purchases');
  return link('الانتقال إلى القسم',base[type]||'#/dashboard');
}
async function executeAction(db:any,type:string,args:any){
  // All writes rely on Supabase permissions and existing accounting RPCs.
  if(type==='read_dashboard'){
    const date=dateOK(args?.date)?args.date:dateToday();
    return {message:`بيانات لوحة المدير لتاريخ ${date}`,data:await callRpc(db,'get_home_dashboard',{p_business_date:date}),links:[link('لوحة المدير','#/dashboard')]};
  }
  if(type==='read_finances'){
    const current=dateToday(),start=dateOK(args?.start)?args.start:current.slice(0,7)+'-01',end=dateOK(args?.end)?args.end:current;
    if(start>end)throw new Error('بداية الفترة يجب أن تسبق نهايتها.');
    return {message:`نتائج المالية للفترة ${start} إلى ${end}`,data:await callRpc(db,'get_financial_statistics',{p_start_date:start,p_end_date:end}),links:[link('التقارير','#/reports')]};
  }
  if(type==='lookup_records'){
    const allowed:any={employees:['name','job_title','pay_type','wage_currency_code','monthly_salary_original','daily_rate_original','hourly_rate_original','id'],
      materials:['id','name','current_stock_base','base_unit_id','latest_purchase_unit_cost_base'],
      suppliers:['id','name'],menu_items:['id','name','manual_price_original'],
      cashboxes:['id','name','is_active'],events:['id','name','event_date','status','revenue_mode'],
      orders:['id','status','occurred_at','currency_code','net_original'],
      purchase_invoices:['id','status','invoice_date','currency_code'],
      employee_attendance:['employee_id','work_date','status','worked_hours','expected_hours','applied_shortage_hours']};
    const table=String(args?.table||'');if(!allowed[table])throw new Error('نوع السجلات غير متاح للمساعد.');
    let q=db.from(table).select(allowed[table].join(',')).limit(60);
    if(table==='employee_attendance'&&dateOK(args?.date))q=q.eq('work_date',args.date);
    const {data,error}=await q;if(error)throw error;
    let rows=data||[];if(args?.search)rows=rows.filter((x:any)=>norm(Object.values(x).join(' ')).includes(norm(args.search)));
    return {message:`تمت قراءة ${rows.length} سجلات من ${table}.`,data:rows.slice(0,50),links:[link('فتح القسم',({employees:'#/employees-list',materials:'#/materials',suppliers:'#/suppliers',menu_items:'#/menu',cashboxes:'#/cashboxes',events:'#/events-list',orders:'#/orders',purchase_invoices:'#/purchases',employee_attendance:'#/attendance'} as any)[table])]};
  }
  if(type==='create_employees'){
    const employees=Array.isArray(args?.employees)?args.employees:[args];
    const {missing,records}=normalizeEmployees(employees);
    if(missing.length)throw new Error('الحقول الإلزامية غير مكتملة: '+missing.join('؛ '));
    const current=await rowList(db,'employees',500);
    const duplicates=records.filter((r:any)=>current.some((e:any)=>norm(e.name)===norm(r.name))).map((r:any)=>r.name);
    if(duplicates.length)throw new Error('موظفون بالاسم نفسه موجودون مسبقًا: '+duplicates.join('، ')+'. لن أكرر إضافتهم دون توضيح.');
    const {data,error}=await db.from('employees').insert(records).select('id,name,pay_type');
    if(error)throw error;
    return {message:`تمت إضافة ${(data||[]).length} موظفين: ${(data||[]).map((e:any)=>e.name).join('، ')}`,data,links:[navFor(type)]};
  }
  if(type==='create_event'){
    const name=short(args?.name,160);if(!name)throw new Error('اسم الحفلة مطلوب.');
    const date=assertValidDate(args?.date,'تاريخ الحفلة');
    const eventType=args?.event_type||args?.type||'private';
    const revenueMode=args?.revenue_mode||args?.revenueMode||'bookings';
    if(!['public','private'].includes(eventType)||!['bookings','orders','both'].includes(revenueMode))throw new Error('نوع الحفلة أو نمط الإيراد غير صحيح.');
    const guestCount=args?.guests==null?null:Number(toWesternDigits(args.guests));
    if(guestCount!=null&&(!Number.isSafeInteger(guestCount)||guestCount<0))throw new Error('عدد الضيوف غير صحيح.');
    const data=await callRpc(db,'create_event',{p_name:name,p_event_type:eventType,p_event_date:date,p_capacity:null,p_planned_guest_count:guestCount,p_default_pricing_mode:'per_person',p_default_price:null,p_currency_code:args?.currency||'SYP',p_revenue_mode:revenueMode,p_start_at:null,p_end_at:null,p_notes:short(args?.notes,2000)||null});
    return {message:`تم إنشاء حفلة «${name}» بتاريخ ${date}.`,data:{id:data},links:[navFor(type)]};
  }
  if(type==='create_supplier'){
    const name=short(args?.name,160);if(!name)throw new Error('اسم المورد مطلوب.');
    const exists=await matching(db,'suppliers',name);
    if(exists)return {message:`المورد «${name}» موجود بالفعل، ولم أكرر إضافته.`,data:{id:exists.id},links:[navFor(type)]};
    const {data,error}=await db.from('suppliers').insert({name}).select('id,name').single();if(error)throw error;
    return {message:`تم إنشاء المورد «${name}».`,data,links:[navFor(type)]};
  }
  if(type==='create_material'){
    const name=short(args?.name,180);if(!name)throw new Error('اسم المادة مطلوب.');
    const unitCode=short(args?.unit_code||args?.unit,32).toUpperCase();if(!unitCode)throw new Error('ما وحدة المخزون الأساسية للمادة؟ مثل KG أو PCS أو L.');
    const units=await rowList(db,'units',200);
    const unit=units.find((x:any)=>norm(x.code)===norm(unitCode)||norm(x.name)===norm(unitCode));
    if(!unit)throw new Error('الوحدة غير موجودة؛ اختر وحدة معرفة في الإعدادات: '+units.slice(0,15).map((u:any)=>u.code).join('، '));
    const exists=await matching(db,'materials',name);
    if(exists)return {message:`المادة «${name}» موجودة بالفعل.`,data:{id:exists.id},links:[navFor(type)]};
    const {data,error}=await db.from('materials').insert({name,base_unit_id:unit.id}).select('id,name').single();if(error)throw error;
    return {message:`تم إنشاء المادة «${name}» بوحدة ${unit.code}.`,data,links:[navFor(type)]};
  }
  if(type==='create_order_draft'||type==='create_purchase_draft')return await createDocumentDraft(db,type,args);
  if(type==='post_order'){
    const id=short(args?.id||args?.order_id,64);if(!id)throw new Error('معرف الأوردر مطلوب.');
    await callRpc(db,'post_order_v013',{p_order_id:id});
    return {message:'تم نشر الأوردر عبر دالة القاعدة المحمية وتسجيل أثره المحاسبي.',links:[navFor(type,id)]};
  }
  if(type==='post_purchase'){
    const id=short(args?.id||args?.invoice_id,64);if(!id)throw new Error('معرف الفاتورة مطلوب.');
    await callRpc(db,'post_purchase_invoice',{p_invoice_id:id});
    return {message:'تم نشر فاتورة الشراء عبر دالة القاعدة المحمية.',links:[navFor(type,id)]};
  }
  if(type==='pay_daily_wage'){
    const day=assertValidDate(args?.date,'تاريخ الأجر');
    const employee=await employeeByIdOrName(db,args?.employee_id,args?.employee||args?.employee_name);
    if(!employee)throw new Error('أحتاج اسم الموظف الموجود في النظام أو معرّفه، ثم تاريخ الأجر المراد صرفه.');
    const data=await callRpc(db,'pay_daily_wage_v017',{p_employee_id:employee.id,p_work_date:day});
    return {message:`تم صرف أجر يوم ${day} وتوثيق الدفعة بالصندوق.`,data:{payment_id:data},links:[navFor(type)]};
  }
  if(type==='pay_approved_salary'){
    const payrollItemId=short(args?.payroll_item_id,64);
    if(!payrollItemId)throw new Error('معرف بند الراتب المعتمد مطلوب.');
    const amount=args?.amount==null?null:finitePositive(args.amount);
    if(args?.amount!=null&&!amount)throw new Error('المبلغ يجب أن يكون موجبًا.');
    const data=await callRpc(db,'pay_approved_salary_v014',{p_payroll_item_id:payrollItemId,p_amount:amount});
    return {message:'تم صرف دفعة الراتب وحفظها في الصندوق والسجلات.',data:{payment_id:data},links:[navFor(type)]};
  }
  if(type==='record_expense'){
    const cashbox=await cashboxByIdOrName(db,args?.cashbox_id,args?.cashbox);
    if(!cashbox)throw new Error('حدد اسم الصندوق الذي سيُخصم منه المصروف.');
    const amount=finitePositive(args?.amount);if(!amount)throw new Error('قيمة المصروف يجب أن تكون أكبر من صفر.');
    const title=short(args?.title,180);if(!title)throw new Error('وصف المصروف مطلوب.');
    const date=dateOK(args?.date)?args.date:dateToday();
    await callRpc(db,'ensure_cashbox_session_v013',{p_cashbox_id:cashbox.id,p_at:date+'T12:00:00Z'});
    const data=await callRpc(db,'record_expense',{p_cashbox_id:cashbox.id,p_amount:amount,p_title:title,p_currency_code:args?.currency||'SYP',p_category_id:null,p_occurred_at:date+'T12:00:00Z',p_payee:null,p_description:short(args?.description,800)||null});
    return {message:`تم تسجيل مصروف «${title}» بقيمة ${amount} من ${cashbox.name}.`,data:{id:data},links:[navFor(type)]};
  }
  if(type==='set_attendance'){
    const employee=await employeeByIdOrName(db,args?.employee_id,args?.employee);
    if(!employee)throw new Error('أحتاج اسم الموظف الموجود في النظام أو معرّفه لتسجيل الدوام.');
    const date=assertValidDate(args?.date,'تاريخ الدوام');
    const status=args?.status||'full';if(!['full','partial','absent','paid_leave','unpaid_leave','holiday','day_off'].includes(status))throw new Error('حالة الدوام غير صحيحة.');
    if(args?.worked_hours==null && args?.worked==null && !['absent','unpaid_leave','paid_leave','day_off','holiday'].includes(status))throw new Error('أحتاج عدد ساعات العمل الفعلية لتسجيل الدوام. لا يجوز اعتباره صفرًا دون توضيح.');
    const worked=Number(toWesternDigits(args?.worked_hours??args?.worked??0));
    if(!Number.isFinite(worked)||worked<0)throw new Error('عدد ساعات العمل الفعلية غير صحيح.');
    const shortage=args?.applied_shortage_hours==null?null:Number(toWesternDigits(args.applied_shortage_hours));
    const data=await callRpc(db,'set_employee_attendance',{p_employee_id:employee.id,p_work_date:date,p_worked_hours:worked,p_status:status,p_expected_hours:null,p_approved_overtime_hours:null,p_applied_shortage_hours:shortage,p_note:short(args?.note,500)||null});
    return {message:`تم حفظ دوام ${employee.name} ليوم ${date}: ${worked} ساعات، الحالة ${status}.`,data,links:[navFor(type)]};
  }
  if(type==='set_payroll_cashbox'){
    const box=await cashboxByIdOrName(db,args?.cashbox_id,args?.cashbox);
    if(!box)throw new Error('الصندوق غير موجود أو غير نشط. حدد الصندوق المطلوب.');
    await callRpc(db,'set_payroll_cashbox_v014',{p_cashbox_id:box.id});
    return {message:`تم اختيار ${box.name} لصرف الرواتب.`,links:[navFor(type)]};
  }
  throw new Error('هذه العملية ليست من الأدوات المفعّلة حاليًا.');
}
async function cashboxByIdOrName(db:any,id:any,name:any){
  const boxes=await rowList(db,'cashboxes',100);return boxes.find((x:any)=>x.is_active!==false&&(id?x.id===id:norm(x.name)===norm(name)))||null;
}
async function employeeByIdOrName(db:any,id:any,name:any){
  const rows=await rowList(db,'employees',500);return rows.find((x:any)=>id?x.id===id:norm(x.name)===norm(name))||null;
}
async function createDocumentDraft(db:any,type:string,args:any){
  const purchase=type==='create_purchase_draft';
  const items=Array.isArray(args?.items)?args.items:[];
  if(!items.length)throw new Error(purchase?'أحتاج اسم المادة والكمية والسعر لكل بند قبل إنشاء الفاتورة.':'أحتاج اسم الصنف والكمية قبل إنشاء الأوردر.');
  if(items.length>60)throw new Error('الحد الأعلى 60 بندًا في العملية الواحدة.');
  const catalog=await rowList(db,purchase?'materials':'menu_items',500);
  const allUnits=purchase?await rowList(db,'units',200):[];
  const resolved=[];
  const missing=[];
  for(const [i,item] of items.entries()){
    const name=short(item.name||item.item_name||item.material_name,180);
    const row=catalog.find((x:any)=>norm(x.name)===norm(name));
    if(!row){missing.push(`البند ${i+1}: «${name||'بلا اسم'}» غير موجود في ${purchase?'المواد':'قائمة الطعام'}.`);continue;}
    const qty=finitePositive(item.quantity??1);
    const priceInput=item.unit_price??item.price;
    const price=priceInput==null&&!purchase?finitePositive(row.manual_price_original??row.selling_price_original):finitePositive(priceInput);
    if(!qty)missing.push(`البند ${i+1}: الكمية غير صحيحة.`);
    if(!price)missing.push(`البند ${i+1}: لا يوجد سعر وحدة صالح؛ حدده صراحة.`);
    let unit=null;
    if(purchase){
      unit=allUnits.find((u:any)=>u.id===item.unit_id||norm(u.code)===norm(item.unit)||norm(u.name)===norm(item.unit));
      if(!unit)unit=allUnits.find((u:any)=>u.id===row.base_unit_id);
      if(!unit)missing.push(`البند ${i+1}: وحدة شراء «${name}» غير معروفة.`);
    }
    const discount=Number(toWesternDigits(item.discount_percent??0));
    if(!Number.isFinite(discount)||discount<0||discount>100)missing.push(`البند ${i+1}: الخصم يجب أن يكون نسبة من 0 إلى 100.`);
    resolved.push({id:row.id,name,qty,price,unit_id:unit?.id||null,discount});
  }
  if(missing.length)throw new Error('لن أنشئ مستندًا ناقصًا؛ يرجى استكمال: '+missing.join(' '));
  const date=dateOK(args?.date)?args.date:dateToday(),currency=short(args?.currency||'SYP',3).toUpperCase();
  if(!['SYP','USD'].includes(currency))throw new Error('العملة يجب أن تكون SYP أو USD.');
  if(purchase){
    const supplierName=short(args?.supplier_name,160)||'شراء مباشر';
    let supplier=await matching(db,'suppliers',supplierName);
    if(!supplier){const {data,error}=await db.from('suppliers').insert({name:supplierName,notes:supplierName==='شراء مباشر'?'SYSTEM_DIRECT_PURCHASE':null}).select('id,name').single();if(error)throw error;supplier=data;}
    const invoiceId=await callRpc(db,'create_purchase_invoice',{p_supplier_id:supplier.id,p_currency_code:currency,p_invoice_number:short(args?.document_number,80)||null,p_invoice_date:date,p_occurred_at:date+'T12:00:00Z',p_entry_method:'manual'});
    let added=0;
    try{
      for(const row of resolved){await callRpc(db,'add_purchase_invoice_item',{p_invoice_id:invoiceId,p_material_id:row.id,p_purchase_unit_id:row.unit_id,p_quantity:row.qty,p_unit_price_original:row.price,p_line_discount_original:Math.round(row.qty*row.price*row.discount/100*10000)/10000,p_ai_confidence:null,p_notes:null});added++;}
    }catch(e:any){throw new Error(`أُنشئت مسودة فاتورة ${invoiceId} وبها ${added} بنود قبل حدوث مشكلة: ${errText(e)}. افتح المسودة لإكمالها ولا تُعد إنشاءها.`);}
    return {message:`تم إنشاء مسودة فاتورة شراء تضم ${added} بنود. راجعها ثم انشرها بنفسك أو اطلب مني نشرها مع موافقتك.`,data:{id:invoiceId,item_count:added,status:'draft'},links:[navFor(type,String(invoiceId))]};
  }
  const cashbox=await cashboxByIdOrName(db,args?.cashbox_id,args?.cashbox);
  // Draft may have no cashbox; this must be selected before publishing.
  const orderId=await callRpc(db,'create_order',{p_external_order_number:short(args?.document_number,80)||null,p_cashbox_id:cashbox?.id||null,p_occurred_at:date+'T12:00:00Z',p_currency_code:currency,p_entry_method:'manual'});
  let added=0;
  try{
    for(const row of resolved){await callRpc(db,'add_order_item_v013',{p_order_id:orderId,p_menu_item_id:row.id,p_quantity:row.qty,p_unit_price_original:row.price,p_discount_percent:row.discount,p_raw_item_name:row.name});added++;}
  }catch(e:any){throw new Error(`أُنشئت مسودة أوردر ${orderId} وبها ${added} بنود قبل حدوث مشكلة: ${errText(e)}. افتحها لإكمالها دون إنشاء نسخة مكررة.`);}
  return {message:`تم إنشاء مسودة أوردر تضم ${added} أصناف. ${cashbox?'':'يلزم تحديد الصندوق قبل النشر.'} لم أقم بنشرها ماليًا.`,data:{id:orderId,item_count:added,status:'draft'},links:[navFor(type,String(orderId))]};
}

function approvalSummary(type:string,args:any){
  if(type==='post_order')return `تأكيد نشر الأوردر ${short(args?.id||args?.order_id||'(لم يُحدد رقم الأوردر)',48)}. سيُنشأ أثر المبيعات والمخزون والصندوق.`;
  if(type==='post_purchase')return `تأكيد نشر فاتورة الشراء ${short(args?.id||args?.invoice_id||'(لم تُحدد الفاتورة)',48)}. سيُحدَّث المخزون.`;
  if(type==='pay_daily_wage')return `تأكيد صرف أجر ${short(args?.employee||args?.employee_name||args?.employee_id||'(يلزم اسم الموظف)',90)} ليوم ${short(args?.date||'(يلزم التاريخ)',30)} من صندوق الرواتب المحدد، مع حفظ دفعة مالية.`;
  if(type==='pay_approved_salary')return `تأكيد صرف ${args?.amount?short(args.amount,30)+' '+short(args.currency||'',5):'كامل الرصيد المعتمد'} من بند راتب ${short(args?.payroll_item_id||'(يلزم معرّف البند)',50)}.`;
  if(type==='record_expense')return `تأكيد تسجيل مصروف «${short(args?.title||'(يلزم الوصف)',110)}» بمبلغ ${short(args?.amount||'(يلزم المبلغ)',30)} ${short(args?.currency||'SYP',5)} من صندوق ${short(args?.cashbox||args?.cashbox_id||'(يلزم الصندوق)',90)}.`;
  if(type==='set_payroll_cashbox')return `تأكيد اختيار ${short(args?.cashbox||args?.cashbox_id||'(يلزم الصندوق)',90)} ليكون صندوق صرف الرواتب.`;
  return type;
}
async function fallbackRead(db:any,message:string){
  const text=norm(message);
  let type='',args:any={};
  if(/(?:مبيعات|ارباح|ربح|احصائ|الاحصائ|تقرير|ايرادات|مصروفات|تدفق نقدي)/.test(text)){
    type=/اليوم|الان|حاليا/.test(text)?'read_dashboard':'read_finances';
  }else if(/مخزون|مواد خام|المواد|موادنا/.test(text)){
    type='lookup_records';args={table:'materials'};
  }else if(/موظف|الموظفين|العمال|الرواتب/.test(text)){
    type='lookup_records';args={table:'employees'};
  }else if(/الصناديق|صندوق/.test(text)){
    type='lookup_records';args={table:'cashboxes'};
  }
  if(!type)return null;
  const result=await executeAction(db,type,args);
  const data=result.data;
  if(type==='read_dashboard'){
    const x=data?.today||{},lines=[];
    for(const [k,name] of [['revenue_base','مبيعات اليوم'],['order_count','عدد الأوردرات'],['food_cost_base','تكلفة الطعام'],['net_result_base','نتيجة اليوم'],['provisional_net_result_base','النتيجة المؤقتة']]){
      if(x[k]!==undefined&&x[k]!==null)lines.push(`${name}: ${x[k]}`);
    }
    return {answer:`${result.message}:\n${lines.join('\n')||'لا توجد قيم قابلة للعرض في الاستجابة.'}\n(نتيجة مباشرة من قاعدة البيانات؛ Gemini غير متاح حاليًا.)`,links:result.links};
  }
  if(type==='read_finances'){
    const k=data?.kpis||{},lines=[];
    for(const [key,label] of [['total_revenue_base','إجمالي الإيرادات'],['food_cost_base','تكلفة الطعام'],['operating_expenses_base','المصروفات'],['payroll_expense_base','الرواتب'],['net_result_base','صافي النتيجة'],['provisional_net_result_base','النتيجة المؤقتة']]){
      if(k[key]!==null&&k[key]!==undefined)lines.push(`${label}: ${k[key]}`);
    }
    if(k.profit_is_final===false)lines.push('تنبيه: النتيجة المالية مؤقتة بسبب بيانات تكلفة ناقصة.');
    return {answer:`${result.message}\n${lines.join('\n')||'بيانات التفصيل متاحة من صفحة التقارير.'}\n(نتيجة مؤكدة من قاعدة البيانات؛ التحليل الذكي غير متاح الآن.)`,links:result.links};
  }
  const rows=Array.isArray(data)?data:[];
  const concise=rows.slice(0,12).map((r:any)=>{
    const fields=type==='lookup_records'&&args.table==='employees'?['name','pay_type','daily_rate_original','hourly_rate_original','monthly_salary_original','wage_currency_code']:
      args.table==='materials'?['name','current_stock_base']:
      args.table==='cashboxes'?['name','is_active']:['name'];
    return fields.filter(k=>r[k]!==null&&r[k]!==undefined).map(k=>`${k}: ${r[k]}`).join('، ');
  });
  return {answer:`قرأت ${rows.length} سجلًا من قاعدة البيانات.\n${concise.join('\n')||'لا توجد سجلات مطابقة.'}${rows.length>12?'\n(تظهر أول 12 فقط)':''}\nGemini غير متاح حاليًا، لكن القراءة المباشرة تعمل.`,links:result.links};
}
async function queueAction(db:any,userId:string,type:string,args:any,description:string){
  const {data,error}=await db.from('assistant_action_queue_v017').insert({user_id:userId,action_type:type,action_args:args,description:short(description,500),expires_at:new Date(Date.now()+15*60000).toISOString()}).select('id,description,expires_at').single();
  if(error)throw new Error('نفذ Migration v0.17 الخاص بالمساعد أولًا: '+errText(error));
  return {id:data.id,type,description:data.description,expires_at:data.expires_at};
}
async function confirmAction(db:any,userId:string,id:string){
  const {data,error}=await db.from('assistant_action_queue_v017').update({status:'processing'}).eq('id',id).eq('user_id',userId).eq('status','pending').gt('expires_at',new Date().toISOString()).select().maybeSingle();
  if(error)throw error;
  if(!data)return {ok:false,answer:'هذه العملية انتهت صلاحيتها أو سبق تنفيذها. اطلب تنفيذها مجددًا إذا لزم.',reason:'expired_or_used'};
  if(!CONFIRM_REQUIRED.has(data.action_type))throw new Error('نوع العملية غير مدعوم للتأكيد.');
  try{
    const result=await executeAction(db,data.action_type,data.action_args);
    await db.from('assistant_action_queue_v017').update({status:'completed',result:{message:result.message,data:result.data||null},completed_at:new Date().toISOString()}).eq('id',id).eq('status','processing');
    return {ok:true,answer:result.message,results:[result],links:result.links||[]};
  }catch(e:any){
    await db.from('assistant_action_queue_v017').update({status:'failed',failure_message:errText(e),completed_at:new Date().toISOString()}).eq('id',id).eq('status','processing');
    return {ok:false,answer:'لم يتم تنفيذ العملية. '+errText(e),reason:'action_failed',links:[navFor(data.action_type)]};
  }
}
async function summarize(key:string,message:string,results:any[]){
  const bounded=JSON.stringify(results.map(r=>({message:r.message,data:r.data}))).slice(0,15500);
  try{
    const ret=await gemini(key,[{role:'user',parts:[{text:`سؤال المدير: ${message}\nنتائج مؤكدة من قاعدة البيانات فقط: ${bounded}\nاكتب ملخصًا عربيًا مهنيًا مفيدًا؛ لا تخترع أرقامًا أو تستنتج يقينًا من بيانات ناقصة. إذا ظهر خلل أو نقص تكلفة وضحه. الرد نص طبيعي وليس JSON.`}]}],false,{system_instruction:{parts:[{text:'أنت محلل مالي لمطعم Maria CFO. لا تختلق بيانات وتستند فقط إلى النتائج المرسلة.'}]}});
    return ret.text;
  }catch(_){return results.map(r=>r.message+'\n'+JSON.stringify(r.data??{}).slice(0,2500)).join('\n\n');}
}
async function inspectImage(key:string,image:any,text:string){
  const mime=String(image?.mime_type||'');
  if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('يمكن إرسال صور JPG أو PNG أو WEBP فقط.');
  const base64=String(image?.data||'').replace(/^data:[^,]+,/,'');
  if(!/^[A-Za-z0-9+/=]+$/.test(base64)||base64.length>5_200_000||base64.length<100)throw new Error('الصورة غير صالحة أو أكبر من الحد المسموح (نحو 3.8 MB).');
  const instructions=`حلل صورة فاتورة شراء أو أوردر مطعم لـ Maria CFO. اقرأ فقط ما يظهر ولا تخترع قيما. استخرج النصوص والأرقام العربية كما هي وحولها إلى أرقام لاتينية.
أعد JSON فقط: {"kind":"purchase|order","document_date":"YYYY-MM-DD|null","currency":"SYP|USD","supplier_name":"","document_number":"","items":[{"name":"","quantity":1,"unit_price":0,"unit":"KG","discount_percent":0,"confidence":0.0}]}. إذا سعر الوحدة غير موجود اتركه 0 ويُطلب من المدير استكماله. الطلب المرافق: ${short(text,500)}`;
  const r=await gemini(key,[{role:'user',parts:[{text:instructions},{inline_data:{mime_type:mime,data:base64}}]}],true);
  return inspectDocument(decodeJson(r.text));
}
function providerMessage(e:any){
  if(e instanceof ProviderError){
    if(e.status===429)return 'بلغ Gemini حد الاستخدام الحالي. المساعد المباشر محدود مؤقتًا؛ يمكنني تنفيذ بعض أوامر الموظفين الواضحة دون النموذج. راجع حصة المزود أو انتظر إعادة ضبطها.';
    if(e.status===401||e.status===403)return 'تعذر استخدام مفتاح Gemini على الخادم. راجع صلاحية GEMINI_API_KEY في Supabase Edge Function Secrets.';
    if(e.status===404)return 'لم يتوفر نموذج Gemini المحدد لهذا المفتاح. راجع GEMINI_MODEL أو توفر نماذج Gemini في مشروعك.';
    if(e.status>=500||e.status===0)return 'تعذر الوصول إلى Gemini الآن. جرّبت النماذج البديلة المتاحة؛ تحقق من Logs في Supabase ووصول المشروع إلى Gemini.';
    return 'رفض Gemini الطلب. راجع إعدادات النموذج وحصته في Supabase.';
  }
  return 'حدث خطأ في فهم الرد. جرّب إعادة صياغة الطلب.';
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return respond({error:'Method not allowed'},405);
  try{
    const auth=req.headers.get('authorization')||'';
    const url=Deno.env.get('SUPABASE_URL')||'',pub=supabasePublicKey(),key=Deno.env.get('GEMINI_API_KEY')||'';
    if(!auth.startsWith('Bearer ')||!url||!pub)return respond({ok:false,answer:'إعدادات الاتصال بالخادم غير مكتملة.',reason:'server_configuration'},200);
    const db=createClient(url,String(pub),{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:identity,error:identityError}=await db.auth.getUser(auth.slice(7));
    if(identityError||!identity?.user)return respond({ok:false,answer:'انتهت جلسة الدخول. أعد تسجيل الدخول.',reason:'not_authenticated'},401);
    const owner=await db.rpc('is_app_owner');
    if(owner.error||owner.data!==true)return respond({ok:false,answer:'المساعد مخصص لمالك التطبيق المصرح له.',reason:'access_denied'},403);
    const userId=identity.user.id;
    const body=await req.json().catch(()=>({}));
    if(body?.action==='health')return respond({ok:true,ready:Boolean(key),model:PLAN_MODEL,functions:['create_employees','read_finances','create_order_draft','create_purchase_draft'],answer:key?'اتصال Supabase جاهز؛ اختبر رسالة للتأكد من استجابة Gemini.':'مفتاح GEMINI_API_KEY غير موجود في Supabase Secrets.'});
    if(body?.action==='probe'){
      if(!key)return respond({ok:false,answer:'تعذر اختبار Gemini: مفتاح GEMINI_API_KEY غير موجود في Supabase Secrets.',reason:'missing_gemini_secret'});
      try{const check=await gemini(key,[{role:'user',parts:[{text:'أجب بكلمة جاهز فقط'}]}],false);return respond({ok:true,answer:'نجح اختبار رد Gemini الحقيقي. النموذج المستجيب: '+check.model,model:check.model});}
      catch(e:any){return respond({ok:false,answer:providerMessage(e),reason:'gemini_unavailable',diagnostic:e instanceof ProviderError?{model:e.model,status:e.status}:null});}
    }
    if(body?.action==='confirm'){
      if(!/^[a-f0-9-]{36}$/i.test(String(body.proposal_id||'')))return respond({ok:false,answer:'رقم العملية غير صالح.'});
      return respond(await confirmAction(db,userId,String(body.proposal_id)));
    }
    if(body?.action==='review_document'){
      const doc=inspectDocument(body.document||{});
      if(doc.missing.length)return respond({ok:false,answer:'قبل الإضافة أكمل الحقول الناقصة: '+doc.missing.join('؛ '),review:doc,reason:'missing_fields'});
      try{
        const result=await executeAction(db,doc.kind==='purchase'?'create_purchase_draft':'create_order_draft',{items:doc.items,date:doc.document_date||dateToday(),currency:doc.currency,supplier_name:doc.supplier_name,document_number:doc.document_number,cashbox_id:body?.cashbox_id||doc.cashbox_id});
        return respond({ok:true,answer:result.message,results:[result],links:result.links});
      }catch(e:any){return respond({ok:false,answer:errText(e),review:doc,reason:'missing_fields'});}
    }
    const message=short(body?.message,5500);
    if(!message&&!body?.image)return respond({ok:false,answer:'اكتب طلبًا أو أرسل صورة مستند.'});
    if(!key){
      if(body?.image)return respond({ok:false,answer:'قراءة الصورة تتطلب Gemini. خادم Supabase متصل لكن GEMINI_API_KEY غير مهيأ.',reason:'missing_gemini_secret'});
      const direct=parseEmployeeCommand(message);
      if(direct){try{const result=await executeAction(db,'create_employees',{employees:direct});return respond({ok:true,answer:result.message+' (تم التنفيذ دون الحاجة إلى Gemini)',results:[result],links:result.links});}catch(e:any){return respond({ok:false,answer:errText(e),reason:'validation'});}}
      try{const directRead=await fallbackRead(db,message);if(directRead)return respond({ok:true,...directRead,reason:'read_only_fallback'});}catch(e:any){return respond({ok:false,answer:errText(e),reason:'database_read_failed'});}
      return respond({ok:false,answer:'المساعد متصل بقاعدة البيانات لكن مفتاح Gemini غير موجود في Supabase Secrets. اكتب أمر إضافة موظفين واضحًا أو سؤالًا عن بيانات مالية، أو اضبط GEMINI_API_KEY لتفعيل بقية المهام.',reason:'missing_gemini_secret'});
    }
    if(body?.image){
      try{
        const review=await inspectImage(key,body.image,message);
        return respond({ok:true,answer:'استخرجت بيانات المستند للمراجعة. تحقق من الأسماء والكميات والأسعار، ثم اضغط «اعتماد وإضافة مسودة». لن أنشر المستند ماليًا دون موافقتك.',review,links:[link('المشتريات','#/purchases'),link('الأوردرات','#/orders')]});
      }catch(e:any){return respond({ok:false,answer:e instanceof ProviderError?providerMessage(e):errText(e),reason:'document_extraction_failed'});}
    }
    const direct=parseEmployeeCommand(message);
    // Direct deterministic execution for clearly specified employees. No AI call or dependency on provider uptime.
    if(direct&&direct.length<=20){try{const result=await executeAction(db,'create_employees',{employees:direct});return respond({ok:true,answer:result.message,results:[result],links:result.links});}catch(e:any){return respond({ok:false,answer:errText(e),reason:'validation',links:[link('الموظفون','#/employees-list')]});}}
    try{
      const history=historyParts(body?.history||[],message);
      // Include system context in a separate role, never parse model output as SQL.
      const generated=await gemini(key,history,true,{system_instruction:{parts:[{text:systemPrompt()}]}});
      const plan=normalizePlan(decodeJson(generated.text));
      const results=[],proposals=[];const errors=[];const allLinks=[...plan.links];
      const prior=(Array.isArray(body?.history)?body.history.slice(-5):[]);
      const lastAssistant=prior.filter((x:any)=>x?.role==='assistant').at(-1)?.content||'';
      const previousUser=prior.filter((x:any)=>x?.role==='user').at(-1)?.content||'';
      const explicitWrite=/(أضف|اضف|إضافة|أنشئ|انشئ|سجل|سجّل|جهز|جهّز|غيّر|غير|حدّث|حدث|عدّل|عدل|انشر|ادفع|اصرف|صرف|أنجز|نفذ|نفّذ|اعتمد|اختر|عيّن|عين)/.test(message);
      const missingFollowup=/(الحقول|الناقص|المطلوب|حدد|يلزم|أحتاج|ما هو|ما هي)/.test(lastAssistant)&&/(أضف|اضف|انشئ|أنشئ|سجل|جهز|حدّث|عدل|اعتمد|انشر|ادفع)/.test(previousUser);
      for(const action of plan.actions){
        if(!['read_dashboard','read_finances','lookup_records'].includes(action.type)&&!explicitWrite&&!missingFollowup){
          errors.push('لم تنفذ عملية كتابة لأنها غير مطلوبة صراحةً في المحادثة.');
          continue;
        }
        if(CONFIRM_REQUIRED.has(action.type)){
          try{const proposal=await queueAction(db,userId,action.type,action.args,approvalSummary(action.type,action.args));proposals.push(proposal);}
          catch(e:any){errors.push(errText(e));}
        }else{
          try{const result=await executeAction(db,action.type,action.args);results.push(result);allLinks.push(...(result.links||[]));}
          catch(e:any){errors.push(`${action.type}: ${errText(e)}`);}
        }
      }
      const readResults=results.filter((r:any)=>r.data!==undefined);
      const didWrites=results.length&&plan.actions.some(a=>!['read_dashboard','read_finances','lookup_records'].includes(a.type));
      let answer=results.length?results.map((r:any)=>r.message).join('\n'):plan.answer;
      if(readResults.length&&!didWrites)answer=await summarize(key,message,readResults);
      if(errors.length)answer+=(answer?'\n\n':'')+'لم تكتمل بعض الإجراءات: '+errors.join('؛ ');
      if(proposals.length)answer+=(answer?'\n\n':'')+'توجد عملية مالية تنتظر موافقتك. راجع تفاصيلها قبل التأكيد.';
      if(plan.question)answer+=(answer?'\n\n':'')+plan.question;
      if(!answer)answer='لم أنفّذ أي عملية بعد. حدد المطلوب والبيانات اللازمة، أو اختر القسم أدناه.';
      return respond({ok:errors.length===0,answer,results,proposals,links:allLinks.filter(x=>safeLink(x.href)),model:generated.model,reason:errors.length?'partial_error':null});
    }catch(e:any){
      try{const directRead=await fallbackRead(db,message);if(directRead)return respond({ok:true,...directRead,reason:'read_only_fallback'});}catch(readError:any){console.warn('AI fallback read failed',{kind:errText(readError)});}
      return respond({ok:false,answer:providerMessage(e),reason:'gemini_unavailable',diagnostic:e instanceof ProviderError?{model:e.model,status:e.status}:null,
        links:[link('الموظفون','#/employees-list'),link('التقارير','#/reports'),link('الأوردرات','#/orders')]});
    }
  }catch(e:any){
    console.error('Maria assistant request failed',{kind:e?.name||'Error',message:errText(e)});
    return respond({ok:false,answer:'تعذر إكمال الطلب: '+errText(e),reason:'assistant_internal_error'});
  }
});
