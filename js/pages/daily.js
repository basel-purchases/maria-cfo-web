import * as api from '../api.js';
import { modal,toast,loader,friendlyError,confirmBox } from '../ui.js';
import { esc,money,dateOnly,statusBadge,todayISO,num } from '../utils.js';

function inventoryMinimum(r){
  const keys=[
    'target_stock_base','target_stock_quantity_base','minimum_stock_base',
    'min_stock_base','minimum_stock_quantity_base','stock_alert_minimum_base'
  ];
  for(const key of keys){
    if(r?.[key]!==undefined && r?.[key]!==null && r?.[key]!=='') return r[key];
  }
  const dynamic=Object.keys(r||{}).find(key=>
    /(^|_)(target|minimum|min)(_|).*stock|stock.*(target|minimum|min)|alert.*(stock|quantity)/i.test(key)
  );
  return dynamic ? r[dynamic] : null;
}

export async function renderInventory(root){
  root.innerHTML=loader();
  try{
    const rows=await api.materials();
    root.innerHTML=`
      <div class="page-head">
        <div>
          <h2>المخزون والجرد</h2>
          <p>راقب الرصيد النظري لكل مادة والحد الأدنى الذي يبدأ عنده التنبيه.</p>
        </div>
      </div>
      <div class="table-wrap table-fit">
        <table class="table">
          <thead><tr><th>المادة</th><th>الرصيد الحالي</th><th>الحد الأدنى قبل التنبيه</th><th>آخر شراء</th></tr></thead>
          <tbody>${rows.map(r=>`
            <tr>
              <td>${esc(r.name)}</td>
              <td><strong>${esc(r.current_stock_base??r.stock_quantity_base??r.current_stock??0)}</strong></td>
              <td>${inventoryMinimum(r)==null?'—':esc(inventoryMinimum(r))}</td>
              <td>${r.latest_purchase_unit_cost_base!=null?money(r.latest_purchase_unit_cost_base):'—'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;
  }
}

export async function renderCashboxes(root){
  root.innerHTML=loader();
  try{
    const [boxes,sessions]=await Promise.all([api.cashboxes(),api.cashboxSessions()]);
    root.innerHTML=`
      <div class="page-head"><div><h2>الصناديق</h2><p>تعريفات الصناديق تظهر دائمًا. الجلسات والحركة تظهر عندما تبدأ العمليات المالية.</p></div></div>
      <div class="grid cols-3">
        ${boxes.map(b=>`
          <div class="card">
            <div class="metric-label">${b.is_general?'الصندوق العام':'صندوق'}</div>
            <div class="metric-value" style="font-size:19px">${esc(b.name)}</div>
            <div class="metric-note">${b.is_active===false?'غير نشط':'جاهز للاستخدام'}</div>
          </div>`).join('')}
      </div>
      <div style="height:16px"></div>
      <div class="card">
        <h3>جلسات الصندوق</h3>
        ${sessions.length?`
          <div class="table-wrap table-fit">
            <table class="table">
              <thead><tr><th>اليوم</th><th>الصندوق</th><th>الحالة</th><th>الرصيد المتوقع</th></tr></thead>
              <tbody>${sessions.map(s=>`
                <tr>
                  <td>${dateOnly(s.business_date||s.opened_at)}</td>
                  <td>${esc(s.cashbox_name||s.name||'صندوق')}</td>
                  <td>${statusBadge(s.status)}</td>
                  <td>${money(s.expected_balance_base??s.expected_base??s.net_base??0)}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>`:'<div class="empty">لا توجد جلسات بعد.</div>'}
      </div>`;
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;
  }
}

export async function renderExpenses(root){
  root.innerHTML=loader();
  try{
    const [rows,boxes,cats]=await Promise.all([api.expenses(),api.cashboxes(),api.expenseCategories()]);
    root.innerHTML=`
      <div class="page-head">
        <div><h2>المصروفات</h2><p>استخدمها للمصاريف التشغيلية مثل الصيانة والنقل والخدمات، وليس لشراء مواد المخزون.</p></div>
        <button class="btn add">إضافة مصروف</button>
      </div>
      ${rows.length?`
        <div class="table-wrap table-fit"><table class="table">
          <thead><tr><th>التاريخ</th><th>الوصف</th><th>الجهة</th></tr></thead>
          <tbody>${rows.map(r=>`<tr><td>${dateOnly(r.occurred_at)}</td><td>${esc(r.title||r.description||'مصروف')}</td><td>${esc(r.payee||'—')}</td></tr>`).join('')}</tbody>
        </table></div>`:'<div class="card empty"><strong>لا توجد مصروفات بعد</strong></div>'}`;

    root.querySelector('.add').onclick=()=>modal({
      title:'إضافة مصروف',
      body:`
        <div class="form-grid">
          <div class="field full"><label>الوصف</label><input name="title" required></div>
          <div class="field"><label>المبلغ</label><input name="amount" type="number" step="any" required></div>
          <div class="field"><label>العملة</label><select name="currency"><option>SYP</option><option>USD</option></select></div>
          <div class="field"><label>الصندوق</label><select name="box" required>${boxes.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><label>التصنيف</label><select name="cat"><option value="">بدون</option>${cats.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>المستفيد <span class="optional-badge">اختياري</span></label><input name="payee"></div>
          <div class="field"><label>التاريخ</label><input name="date" type="date" value="${todayISO()}"></div>
        </div>`,
      onSubmit:async fd=>{
        try{
          await api.recordExpense({
            cashboxId:fd.get('box'),amount:fd.get('amount'),title:fd.get('title'),
            currency:fd.get('currency'),categoryId:fd.get('cat')||null,
            payee:String(fd.get('payee')||'').trim()||null,date:fd.get('date')
          });
          toast('تم تسجيل المصروف','success');
          await renderExpenses(root);
          return true;
        }catch(e){toast(friendlyError(e),'error');return false;}
      }
    });
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;
  }
}

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||'').split(',').pop()||'');
    reader.onerror=()=>reject(reader.error||new Error('FILE_READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

async function enqueueOrderImages(files){
  const valid=[...files].filter(f=>f.type.startsWith('image/') && f.size<=8*1024*1024);
  if(!valid.length) throw new Error('NO_VALID_ORDER_IMAGES');
  let index=0,queued=0,failed=0;
  const worker=async()=>{
    while(index<valid.length){
      const i=index++;
      const file=valid[i];
      try{
        const base64=await fileToBase64(file);
        await api.enqueueDocumentOcr({
          jobType:'order_ocr',
          imageBase64:base64,
          mimeType:file.type||'image/jpeg',
          fileName:file.name||`order-${i+1}`,
          context:{currency:'SYP'},
        });
        queued++;
      }catch(e){
        failed++;
        console.error('Order image enqueue failed',file.name,e);
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(3,valid.length)},()=>worker()));
  return {queued,failed,total:valid.length};
}

export async function renderOrders(root){
  root.innerHTML=loader();
  try{
    const [rows,boxes,jobs]=await Promise.all([api.orders(),api.cashboxes(),api.aiJobs({limit:100}).catch(()=>[])]);
    const orderJobs=jobs.filter(j=>j.job_type==='order_ocr');
    const pending=orderJobs.filter(j=>['queued','processing'].includes(j.status));
    const review=orderJobs.filter(j=>j.status==='needs_review' && !j.seen_at);
    const ready=orderJobs.filter(j=>j.status==='completed' && !j.seen_at && j.related_entity_id);

    root.innerHTML=`
      <div class="page-head">
        <div><h2>الأوردرات والمبيعات</h2><p>يمكنك تسجيل الأوردر يدويًا أو رفع مجموعة صور وترك Maria CFO يحللها ويُنشئ المسودات في الخلفية.</p></div>
        <div class="page-head-actions">
          <button class="btn secondary batch-orders">رفع صور أوردرات</button>
          <input type="file" class="batch-order-files" accept="image/*" multiple hidden>
          <button class="btn new">أوردر جديد</button>
        </div>
      </div>
      ${(pending.length||review.length||ready.length)?`<div class="ai-order-summary">
        ${pending.length?`<div class="ai-summary-chip processing"><strong>${pending.length}</strong><span>صور قيد التحليل</span></div>`:''}
        ${review.length?`<div class="ai-summary-chip review"><strong>${review.length}</strong><span>نتائج تحتاج مراجعة</span></div>`:''}
        ${ready.length?`<div class="ai-summary-chip ready"><strong>${ready.length}</strong><span>مسودات أُنشئت من الصور</span></div>`:''}
      </div>`:''}
      ${review.length?`<div class="card ai-review-card"><h3>نتائج تحتاج مراجعة</h3><p>لم نسجل بيانات غير مؤكدة. افتح كل نتيجة وصحح المطابقة ثم أنشئ المسودة.</p><div class="ai-review-list">${review.map(j=>`<button type="button" class="ai-review-item" data-review-job="${esc(j.id)}"><span>${esc(j.title||'صورة أوردر')}</span><strong>مراجعة ←</strong></button>`).join('')}</div></div><div style="height:16px"></div>`:''}
      ${ready.length?`<div class="card"><h3>مسودات جاهزة من الصور</h3><p>تم التعرف على الأصناف وحفظ كل صورة كمسودة مستقلة.</p><div class="ai-review-list">${ready.map(j=>`<button type="button" class="ai-review-item" data-ready-job="${esc(j.id)}"><span>${esc(j.title||'أوردر')}</span><strong>فتح المسودة ←</strong></button>`).join('')}</div></div><div style="height:16px"></div>`:''}
      ${rows.length?`
        <div class="table-wrap table-fit"><table class="table">
          <thead><tr><th>التاريخ</th><th>رقم الأوردر</th><th>الحالة</th><th>الإجمالي</th><th></th></tr></thead>
          <tbody>${rows.map(r=>`
            <tr class="clickable" data-id="${esc(r.id)}">
              <td>${dateOnly(r.occurred_at||r.business_date)}</td>
              <td>${esc(r.external_order_number||r.order_number||'—')}</td>
              <td>${statusBadge(r.status)}</td>
              <td>${money(r.net_total_original??r.total_original??0,r.currency_code||'SYP')}</td>
              <td>فتح ←</td>
            </tr>`).join('')}</tbody>
        </table></div>`:'<div class="card empty"><strong>لا توجد مبيعات بعد</strong><div>يمكنك إنشاء أوردر أو رفع صور أوردرات دفعة واحدة.</div></div>'}`;

    root.querySelector('.new')?.addEventListener('click',()=>newOrder(boxes));
    root.querySelectorAll('tr[data-id]').forEach(tr=>tr.onclick=()=>location.hash='#/order/'+tr.dataset.id);

    const fileInput=root.querySelector('.batch-order-files');
    root.querySelector('.batch-orders')?.addEventListener('click',()=>fileInput?.click());
    fileInput?.addEventListener('change',async()=>{
      const files=[...(fileInput.files||[])];
      fileInput.value='';
      if(!files.length) return;
      toast(`جاري إرسال ${files.length} صورة إلى قائمة المعالجة...`);
      try{
        const res=await enqueueOrderImages(files);
        if(res.queued) toast(`تم إرسال ${res.queued} صورة. يمكنك متابعة العمل وسنخبرك عند اكتمال كل أوردر.`,'success');
        if(res.failed) toast(`تعذر إرسال ${res.failed} صورة. يمكنك إعادة رفعها لاحقًا.`,'error');
        await renderOrders(root);
      }catch(e){toast(friendlyError(e,'تعذر إرسال صور الأوردرات.'),'error');}
    });

    root.querySelectorAll('[data-review-job]').forEach(btn=>btn.onclick=()=>{
      const job=review.find(j=>String(j.id)===String(btn.dataset.reviewJob));
      if(job) openOrderOcrReview(root,job,boxes);
    });
    root.querySelectorAll('[data-ready-job]').forEach(btn=>btn.onclick=async()=>{
      const job=ready.find(j=>String(j.id)===String(btn.dataset.readyJob));
      if(!job?.related_entity_id) return;
      await api.markAiJobSeen(job.id).catch(()=>{});
      location.hash='#/order/'+job.related_entity_id;
    });

    const pendingOpen=sessionStorage.getItem('maria_ai_job_to_open');
    if(pendingOpen){
      const job=orderJobs.find(j=>String(j.id)===String(pendingOpen));
      if(job?.job_type==='order_ocr'){
        sessionStorage.removeItem('maria_ai_job_to_open');
        if(job.related_entity_id) location.hash='#/order/'+job.related_entity_id;
        else if(job.result_json) setTimeout(()=>openOrderOcrReview(root,job,boxes),0);
      }
    }
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;
  }
}

function newOrder(boxes){
  const firstBox=boxes.find(b=>b.is_active!==false)?.id||'';
  modal({
    title:'أوردر جديد',
    body:`
      <div class="form-grid">
        <div class="field"><label>رقم الأوردر <span class="optional-badge">اختياري</span></label><input name="number"></div>
        <div class="field"><label>التاريخ</label><input name="date" type="date" value="${todayISO()}"></div>
        <div class="field"><label>الصندوق</label><select name="box"><option value="">اختر لاحقًا</option>${boxes.map(b=>`<option value="${b.id}" ${String(b.id)===String(firstBox)?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
        <div class="field"><label>العملة</label><select name="currency"><option>SYP</option><option>USD</option></select></div>
      </div>`,
    submitText:'إنشاء المسودة',
    onSubmit:async fd=>{
      try{
        const id=await api.createOrder({
          cashboxId:fd.get('box')||null,
          currency:fd.get('currency'),
          number:String(fd.get('number')||'').trim()||null,
          date:fd.get('date')
        });
        location.hash='#/order/'+id;
        return true;
      }catch(e){toast(friendlyError(e),'error');return false;}
    }
  });
}

async function openOrderOcrReview(root,job,boxes){
  const result=job?.result_json||{};
  const items=Array.isArray(result.items)?result.items:[];
  if(!items.length){toast('لا توجد أصناف قابلة للمراجعة في هذه النتيجة.','error');return;}
  const menu=await api.menuItems();
  const firstBox=boxes.find(b=>b.is_active!==false)?.id||'';
  const orderDate=result.order_date||todayISO();
  const currency=['SYP','USD'].includes(String(result.currency||'').toUpperCase())?String(result.currency).toUpperCase():'SYP';

  const m=modal({
    title:'مراجعة صورة الأوردر',
    subtitle:'صحح أي صنف أو رقم غير واضح. لن تُنشأ المسودة حتى تعتمد كل البنود.',
    wide:true,
    body:`
      <div class="form-grid compact-grid">
        <div class="field"><label>رقم الأوردر <span class="optional-badge">اختياري</span></label><input name="number" value="${esc(result.external_order_number||'')}"></div>
        <div class="field"><label>التاريخ</label><input name="date" type="date" value="${esc(orderDate)}"></div>
        <div class="field"><label>الصندوق</label><select name="box"><option value="">اختر لاحقًا</option>${boxes.map(b=>`<option value="${esc(b.id)}" ${String(b.id)===String(firstBox)?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
        <div class="field"><label>العملة</label><select name="currency"><option value="SYP" ${currency==='SYP'?'selected':''}>SYP</option><option value="USD" ${currency==='USD'?'selected':''}>USD</option></select></div>
      </div>
      <div class="order-ocr-items">${items.map((x,i)=>{
        const matched=x.matched_menu_item_id||'';
        let price=Number(x.resolved_unit_price??x.unit_price??0);
        if(!(price>0)&&Number(x.line_total)>0&&Number(x.quantity)>0) price=Number(x.line_total)/Number(x.quantity);
        const total=Number(x.line_total)>0?Number(x.line_total):Number(x.quantity||0)*price;
        return `<div class="order-ocr-row" data-order-ocr="${i}">
          <div class="field compact"><label>الاسم المقروء</label><input name="raw_${i}" value="${esc(x.name||'')}"></div>
          <div class="field compact"><label>الصنف في Maria CFO</label><select name="menu_${i}" required><option value="">اختر</option>${menu.map(mi=>`<option value="${esc(mi.id)}" ${String(mi.id)===String(matched)?'selected':''}>${esc(mi.name)}</option>`).join('')}</select></div>
          <div class="field compact"><label>الكمية</label><input name="qty_${i}" type="number" step="any" min="0.000001" value="${esc(x.quantity||1)}" required></div>
          <div class="field compact"><label>سعر الوحدة</label><input name="price_${i}" type="number" step="any" min="0" value="${esc(price||0)}" required></div>
          <div class="field compact"><label>إجمالي السطر</label><input name="total_${i}" type="number" step="any" min="0" value="${esc(total||0)}"></div>
        </div>`;
      }).join('')}</div>`,
    submitText:'إنشاء مسودة الأوردر',
    onSubmit:async fd=>{
      try{
        for(let i=0;i<items.length;i++){
          if(!fd.get(`menu_${i}`)) {toast(`اختر الصنف للبند رقم ${i+1}.`,'error');return false;}
        }
        const orderId=await api.createOrder({
          cashboxId:fd.get('box')||null,
          currency:fd.get('currency')||'SYP',
          number:String(fd.get('number')||'').trim()||null,
          date:fd.get('date')||todayISO(),
        });
        for(let i=0;i<items.length;i++){
          const qty=Number(fd.get(`qty_${i}`)||0);
          let price=Number(fd.get(`price_${i}`)||0);
          const total=Number(fd.get(`total_${i}`)||0);
          if(!(price>0)&&total>0&&qty>0) price=total/qty;
          await api.addOrderItem({
            orderId,
            menuItemId:fd.get(`menu_${i}`),
            quantity:qty,
            unitPrice:price,
            adjustmentType:Number(items[i].discount_percent||0)>0?'percent':'none',
            adjustmentValue:Number(items[i].discount_percent||0),
          });
        }
        await api.completeAiJob(job.id,'order',orderId).catch(()=>{});
        toast(`تم إنشاء مسودة الأوردر وحفظ ${items.length} أصناف.`,'success');
        location.hash='#/order/'+orderId;
        return true;
      }catch(e){toast(friendlyError(e,'تعذر إنشاء مسودة الأوردر من نتيجة الصورة.'),'error');return false;}
    },
  });

  items.forEach((_,i)=>{
    const row=m.form.querySelector(`[data-order-ocr="${i}"]`);
    const qty=row?.querySelector(`[name="qty_${i}"]`);
    const price=row?.querySelector(`[name="price_${i}"]`);
    const total=row?.querySelector(`[name="total_${i}"]`);
    const calc=()=>{const q=Number(qty?.value||0),p=Number(price?.value||0);if(total&&q>=0&&p>=0) total.value=Number((q*p).toFixed(4));};
    qty?.addEventListener('input',calc);
    price?.addEventListener('input',calc);
    total?.addEventListener('input',()=>{const q=Number(qty?.value||0),t=Number(total.value||0);if(price&&q>0&&t>=0) price.value=Number((t/q).toFixed(6));});
  });
}

function chooseOrderCashbox(boxes){
  return new Promise(resolve=>{
    let settled=false;
    const m=modal({
      title:'اختر الصندوق',
      subtitle:'يجب تحديد الصندوق قبل نشر الأوردر لأن الإيراد سيُسجل عليه.',
      body:`<div class="field"><label>الصندوق</label><select name="box" required>${boxes.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></div>`,
      submitText:'متابعة النشر',
      onSubmit:async fd=>{
        settled=true;
        resolve(String(fd.get('box')||''));
        return true;
      },
      onClose:()=>{if(!settled) resolve(null);},
    });
  });
}

function itemPrice(x){
  return x.manual_price_original ?? x.manual_price ?? x.price ?? x.suggested_price_rounded ?? x.suggested_price ?? 0;
}

export async function renderOrderDetail(root,id){
  root.innerHTML=loader();
  try{
    const [order,items,menu,boxes]=await Promise.all([api.one('orders',id),api.orderItems(id),api.menuItems(),api.cashboxes()]);
    const mm=Object.fromEntries(menu.map(x=>[String(x.id),x]));
    const boxMap=Object.fromEntries(boxes.map(x=>[String(x.id),x]));
    root.innerHTML=`
      <div class="page-head"><div><h2>تفاصيل الأوردر</h2><p>أضف الأصناف ثم انشر العملية.</p></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="kv"><div class="k">الحالة</div><div>${statusBadge(order.status)}</div><div class="k">العملة</div><div>${esc(order.currency_code||'SYP')}</div><div class="k">الصندوق</div><div>${order.cashbox_id?esc(boxMap[String(order.cashbox_id)]?.name||'صندوق'): '<span class="muted">يُحدد عند النشر</span>'}</div></div></div>
        <div class="card"><div class="quick-actions"><button class="btn add" ${order.status!=='draft'?'disabled':''}>إضافة صنف</button><button class="btn soft post" ${order.status!=='draft'||!items.length?'disabled':''}>نشر الأوردر</button></div></div>
      </div>
      <div style="height:16px"></div>
      <div class="card">
        <h3>الأصناف</h3>
        ${items.length?`
          <div class="table-wrap table-fit"><table class="table">
            <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>التعديل</th></tr></thead>
            <tbody>${items.map(x=>`
              <tr>
                <td>${esc(mm[String(x.menu_item_id)]?.name||x.raw_item_name||'صنف')}</td>
                <td>${esc(x.quantity||1)}</td>
                <td>${money(x.unit_price_original||0,order.currency_code||'SYP')}</td>
                <td>${x.adjustment_type==='percent'?`${esc(x.adjustment_value||0)}% خصم`:x.adjustment_type==='complimentary'?'ضيافة':'—'}</td>
              </tr>`).join('')}</tbody>
          </table></div>`:'<div class="empty">لا توجد أصناف بعد.</div>'}
      </div>`;

    root.querySelector('.add')?.addEventListener('click',()=>{
      const m=modal({
        title:'إضافة صنف',
        body:`
          <div class="form-grid">
            <div class="field full"><label>الصنف</label><select name="item">${menu.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
            <div class="field"><label>الكمية</label><input name="qty" type="number" step="any" value="1"></div>
            <div class="field"><label>السعر</label><input name="price" type="number" step="any" min="0" required></div>
            <div class="field"><label>الخصم % <span class="optional-badge">اختياري</span></label><input name="discount" type="number" min="0" max="100" step="any"></div>
          </div>`,
        onSubmit:async fd=>{
          try{
            const discount=num(fd.get('discount'),0);
            await api.addOrderItem({
              orderId:id,
              menuItemId:fd.get('item'),
              quantity:fd.get('qty')||1,
              unitPrice:fd.get('price'),
              adjustmentType:discount>0?'percent':'none',
              adjustmentValue:discount,
            });
            toast('تمت إضافة الصنف','success');
            await renderOrderDetail(root,id);
            return true;
          }catch(e){toast(friendlyError(e),'error');return false;}
        }
      });

      const itemSel=m.form.querySelector('[name="item"]');
      const price=m.form.querySelector('[name="price"]');
      const discount=m.form.querySelector('[name="discount"]');
      const refresh=()=>{
        const item=mm[String(itemSel.value)];
        price.value=itemPrice(item);
        discount.value=num(item?.default_discount_percent,0)||'';
      };
      itemSel.addEventListener('change',refresh);
      refresh();
    });

    root.querySelector('.post')?.addEventListener('click',async()=>{
      let selectedBox=order.cashbox_id||null;
      if(!selectedBox){
        const activeBoxes=boxes.filter(b=>b.is_active!==false);
        if(!activeBoxes.length){toast('لا يوجد صندوق نشط. عرّف صندوقًا أولًا قبل نشر الأوردر.','error');return;}
        const chosen=await chooseOrderCashbox(activeBoxes);
        if(!chosen) return;
        selectedBox=chosen;
        try{
          await api.setOrderCashbox(id,selectedBox);
          order.cashbox_id=selectedBox;
        }catch(e){toast(friendlyError(e,'تعذر ربط الأوردر بالصندوق.'),'error');return;}
      }
      if(!(await confirmBox('سيتم نشر الأوردر وتسجيل الإيراد واستهلاك مكونات الوصفة.','نشر الأوردر'))) return;
      const btn=root.querySelector('.post');
      if(btn){btn.disabled=true;btn.textContent='جاري النشر...';}
      try{
        await api.postOrder(id);
        toast('تم نشر الأوردر وتحديث المخزون والإيراد','success');
        await renderOrderDetail(root,id);
      }catch(e){
        toast(friendlyError(e,'تعذر نشر الأوردر. تحقق من الصندوق ومكونات الوصفات ثم حاول مرة أخرى.'),'error');
        if(btn){btn.disabled=false;btn.textContent='نشر الأوردر';}
      }
    });
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;
  }
}
