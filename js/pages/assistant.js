import * as api from '../api.js?v=0.17';
import { esc } from '../utils.js?v=0.17';

const LINKS={
  dashboard:'الرئيسية',reports:'التقارير',orders:'الأوردرات',purchases:'المشتريات',
  'employees-list':'الموظفون',attendance:'الدوام',payroll:'الرواتب',
  cashboxes:'الصناديق',expenses:'المصروفات',materials:'المواد',menu:'الوجبات',
  'events-list':'الحفلات',settings:'الإعدادات',suppliers:'الموردون',
};
function safeLink(href){const s=String(href||'');return /^#\/(?:dashboard|reports|orders|purchases|employees-list|attendance|payroll|cashboxes|expenses|materials|menu|events-list|settings|suppliers|order\/[0-9a-f-]{36}|purchase\/[0-9a-f-]{36})$/i.test(s)?s:null;}
const fmt=(value)=>Number.isFinite(Number(value))?new Intl.NumberFormat('ar').format(Number(value)):'—';
function appendText(container,cls,text){const row=document.createElement('div');row.className='msg '+cls;row.textContent=text;container.appendChild(row);container.scrollTop=container.scrollHeight;return row;}

export function renderAssistant(root){
  const history=[];
  let file=null,busy=false;
  root.innerHTML=`
    <div class="page-head"><div><h2>مساعد Maria CFO التشغيلي</h2>
      <p>اطلب قراءة بيانات المطعم أو إضافة موظفين أو تجهيز أوردر وفاتورة. لا يخترع بيانات ناقصة، ويطلب مراجعة المستندات المصوّرة قبل إضافتها.</p></div>
      <button type="button" class="agent-health" id="agent-health" title="اضغط لاختبار استجابة Gemini فعليًا">فحص الاتصال…</button>
    </div>
    <div class="card agent-card">
      <div class="agent-examples" aria-label="أمثلة للطلبات">
        <button type="button" data-example="أضف موظفين: أنس يومي براتب 100، زياد شهري براتب 3000">إضافة موظفين</button>
        <button type="button" data-example="اعرض إحصائيات هذا الشهر مع المشاكل التي تتطلب مراجعة">إحصائيات الشهر</button>
        <button type="button" data-example="ما هي المواد منخفضة المخزون؟">المخزون</button>
        <button type="button" data-example="أريد إنشاء أوردر جديد">إنشاء أوردر</button>
      </div>
      <div class="messages agent-messages" id="agent-messages" aria-live="polite"><div class="msg ai">مرحبًا! أستطيع الاستعلام عن بيانات Maria CFO وتنفيذ العمليات التي يتيحها النظام. أخبرني بما تريد، وسأسألك عن أي حقل إلزامي ناقص.</div></div>
      <div class="agent-attachment" id="agent-attachment" hidden></div>
      <div class="agent-footer">
        <label class="btn secondary agent-attach" for="agent-file" title="إرفاق فاتورة أو أوردر مصوّر"> <span aria-hidden="true">▧</span> إرفاق صورة</label>
        <input id="agent-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
        <textarea id="agent-text" rows="2" placeholder="مثال: أضف أحمد يومي براتب 150، أو كم مبيعات الأمس؟" aria-label="طلب المساعد"></textarea>
        <button class="btn" id="agent-send">إرسال</button>
      </div>
      <p class="metric-note agent-caution">عمليات الدفع والنشر لا تتم قبل موافقة صريحة. الصور تُراجع أولًا، ولا تُنشئ قيودًا مالية بمجرد رفعها. لا تضع مفاتيح API في المحادثة.</p>
    </div>`;
  const box=root.querySelector('#agent-messages'),input=root.querySelector('#agent-text'),sendBtn=root.querySelector('#agent-send'),pick=root.querySelector('#agent-file'),attach=root.querySelector('#agent-attachment'),health=root.querySelector('#agent-health');
  api.assistantHealth().then(res=>{health.textContent=res.ready?'اختبر Gemini الآن':'يلزم فحص إعدادات المساعد';health.className='agent-health '+(res.ready?'is-ready':'is-warning');}).catch(()=>{health.textContent='الاتصال غير متاح';});
  health.onclick=async()=>{
    if(busy)return;
    health.disabled=true;health.textContent='يجري اختبار رد Gemini…';
    const res=await api.assistantProbe();
    health.textContent=res.ok?'تم اختبار Gemini بنجاح':'تعذّر اختبار Gemini · راجع الرسالة';
    health.className='agent-health '+(res.ok?'is-ready':'is-warning');
    appendText(box,'ai',res.answer||'لم تكتمل نتيجة فحص Gemini.');
    health.disabled=false;
  };
  root.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>{input.value=b.dataset.example;input.focus();});
  const setBusy=(yes)=>{busy=yes;sendBtn.disabled=yes;pick.disabled=yes;sendBtn.textContent=yes?'جاري الإجابة…':'إرسال';};
  pick.onchange=()=>{
    const chosen=pick.files?.[0]||null;
    if(!chosen){file=null;attach.hidden=true;return;}
    if(!['image/jpeg','image/png','image/webp'].includes(chosen.type)||chosen.size>3_800_000){appendText(box,'ai','اختر صورة JPEG أو PNG أو WEBP بحجم أقل من 3.8 ميغابايت.');pick.value='';return;}
    const reader=new FileReader();reader.onload=()=>{file={mime_type:chosen.type,data:String(reader.result).split(',')[1],name:chosen.name};attach.hidden=false;attach.innerHTML=`<span>صورة مرفقة: <strong>${esc(chosen.name)}</strong></span> <button type="button" id="remove-agent-file" class="mini-action">إزالة</button>`;attach.querySelector('button').onclick=()=>{file=null;pick.value='';attach.hidden=true;};};reader.readAsDataURL(chosen);
  };
  const clearFile=()=>{file=null;pick.value='';attach.hidden=true;attach.innerHTML='';};
  const addLinks=(parent,links)=>{
    const valid=(links||[]).filter(x=>safeLink(x?.href));if(!valid.length)return;
    const wrap=document.createElement('div');wrap.className='agent-links';
    for(const x of valid){const a=document.createElement('a');a.className='mini-action';a.href=safeLink(x.href);a.textContent=String(x.label||LINKS[x.href.slice(2)]||'فتح القسم');wrap.appendChild(a);}parent.appendChild(wrap);
  };
  const addReview=(parent,review)=>{
    if(!review?.items?.length)return;
    const pane=document.createElement('section');pane.className='agent-review';
    const title=review.kind==='purchase'?'فاتورة شراء':'أوردر';
    pane.innerHTML=`<div class="agent-review-head"><strong>مراجعة ${title}</strong><span>عدّل الحقول غير الدقيقة قبل الحفظ. لن يتم النشر المحاسبي الآن.</span></div>
      <div class="form-grid agent-review-meta"><div class="field"><label>العملة</label><select data-field="currency"><option value="SYP">SYP</option><option value="USD">USD</option></select></div>
      <div class="field"><label>التاريخ</label><input data-field="date" type="date" value="${esc(review.document_date||new Date().toISOString().slice(0,10))}"></div>
      ${review.kind==='purchase'?`<div class="field"><label>المورد (اختياري)</label><input data-field="supplier" value="${esc(review.supplier_name||'')}"></div>`:
      `<div class="field"><label>صندوق الأوردر</label><span class="metric-note">يُختار من تفاصيل المسودة قبل نشرها</span></div>`}
      <div class="field"><label>رقم المستند</label><input data-field="number" value="${esc(review.document_number||'')}"></div></div>
      <div class="table-wrap"><table class="table agent-review-table"><thead><tr><th>الصنف/المادة</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم %</th>${review.kind==='purchase'?'<th>الوحدة</th>':''}<th>دقة القراءة</th></tr></thead><tbody>${review.items.map((x,i)=>`<tr data-row="${i}"><td><input data-col="name" value="${esc(x.name||'')}" required></td><td><input data-col="quantity" type="number" step="any" min="0.001" value="${esc(x.quantity||'')}"></td><td><input data-col="unit_price" type="number" step="any" min="0.001" value="${esc(x.unit_price||'')}"></td><td><input data-col="discount_percent" type="number" step="any" min="0" max="100" value="${esc(x.discount_percent||0)}"></td>${review.kind==='purchase'?`<td><input data-col="unit" value="${esc(x.unit||'')}"></td>`:''}<td class="agent-confidence ${Number(x.confidence||0)<0.75?'agent-low-confidence':''}">${Number(x.confidence||0)>=0.75?'مرجّح':'راجِع'}</td></tr>`).join('')}</tbody></table></div>
      <div class="agent-review-actions"><button type="button" class="btn agent-save-document">اعتماد وإضافة مسودة</button><span class="metric-note">أي مادة/وجبة غير معرفة ستُطلب منك أولًا، ولن نخمن المطابقة.</span></div>`;
    pane.querySelector('[data-field="currency"]').value=review.currency||'SYP';
    pane.querySelector('.agent-save-document').onclick=async()=>{
      if(busy)return;
      const edited={...review,currency:pane.querySelector('[data-field="currency"]').value,document_date:pane.querySelector('[data-field="date"]').value,supplier_name:pane.querySelector('[data-field="supplier"]')?.value||'',document_number:pane.querySelector('[data-field="number"]').value,cashbox_id:null,
        items:[...pane.querySelectorAll('[data-row]')].map(row=>({name:row.querySelector('[data-col="name"]').value,quantity:Number(row.querySelector('[data-col="quantity"]').value),unit_price:Number(row.querySelector('[data-col="unit_price"]').value),discount_percent:Number(row.querySelector('[data-col="discount_percent"]').value),unit:row.querySelector('[data-col="unit"]')?.value||''}))};
      // To avoid ambiguously resolving a cashbox text, require an exact selection in the order screen before posting.
      setBusy(true);const progress=appendText(box,'ai','جاري حفظ المسودة بعد التحقق من الأصناف…');
      const result=await api.reviewAssistantDocument(edited);progress.textContent=result.answer||'تعذر إنشاء المستند.';
      if(result.ok){pane.querySelector('button').disabled=true;addLinks(progress,result.links||[]);}
      setBusy(false);box.scrollTop=box.scrollHeight;
    };
    parent.appendChild(pane);
  };
  const addProposals=(parent,proposals)=>{
    for(const p of proposals||[]){
      const pane=document.createElement('div');pane.className='agent-approval';
      const summary=document.createElement('p');summary.textContent='موافقة مالية مطلوبة: '+p.description;pane.appendChild(summary);
      const button=document.createElement('button');button.className='btn';button.textContent='أوافق — نفّذ العملية';pane.appendChild(button);
      const skip=document.createElement('button');skip.className='btn secondary';skip.textContent='لا تنفذ';pane.appendChild(skip);
      skip.onclick=()=>{button.disabled=true;skip.disabled=true;appendText(box,'ai','لم أنفّذ العملية. ستنتهي صلاحيتها تلقائيًا.');};
      button.onclick=async()=>{
        if(busy)return;
        setBusy(true);button.disabled=true;
        const result=await api.confirmAssistantAction(p.id);
        const message=appendText(box,'ai',result.answer||'لم تكتمل العملية.');addLinks(message,result.links||[]);
        if(!result.ok)button.disabled=true;skip.disabled=true;setBusy(false);
      };
      parent.appendChild(pane);
    }
  };
  async function submit(){
    if(busy)return;const text=input.value.trim(),image=file;
    if(!text&&!image)return;
    input.value='';clearFile();const userText=text||(image?'تحليل صورة مستند':'');
    appendText(box,'user',userText+(image?'\n[صورة مرفقة]':''));
    setBusy(true);const pending=appendText(box,'ai','جاري الإجابة…');
    const res=await api.askAssistant(userText,history,image?{image}:{});
    pending.textContent=res.answer||'لم يصل رد صالح من الخدمة.';
    history.push({role:'user',content:userText});history.push({role:'assistant',content:pending.textContent});
    if(history.length>30)history.splice(0,history.length-30);
    addLinks(pending,res.links||[]);addReview(pending,res.review);addProposals(pending,res.proposals);
    if(res.reason==='edge_unavailable'){health.textContent='يلزم نشر دالة المساعد v0.17';health.className='agent-health is-warning';}
    setBusy(false);box.scrollTop=box.scrollHeight;
  }
  sendBtn.onclick=submit;
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}});
}
