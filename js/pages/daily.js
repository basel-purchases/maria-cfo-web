import * as api from '../api.js?v=0.18';
import { modal,toast,loader,friendlyError,confirmBox } from '../ui.js?v=0.18';
import { esc,money,dateOnly,statusBadge,todayISO,num } from '../utils.js?v=0.18';

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

function firstNumeric(obj,keys){
  for(const key of keys){
    const v=obj?.[key];
    if(v!==undefined && v!==null && v!=='' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function expectedCashboxBalance(summary){
  return firstNumeric(summary,[
    'expected_balance_base','expected_base','expected_closing_base','expected_closing_balance_base',
    'current_balance_base','balance_base','net_base','expected_balance','balance','_computed_balance_base'
  ]);
}

export async function renderCashboxes(root){
  root.innerHTML=loader();
  try{
    const overview=await api.cashboxOverview(todayISO());
    const boxes=overview.map(x=>x.cashbox).filter(Boolean);
    root.innerHTML=`
      <div class="page-head">
        <div>
          <h2>الصناديق</h2>
          <p>كل صندوق يمثل النقد الفعلي الموجود فيه. المبيعات تزيده تلقائيًا، والمصروفات والدفعات تخفضه تلقائيًا.</p>
        </div>
      </div>
      <div class="notice sage cashbox-help">
        <strong>كيف أبدأ؟</strong>
        إذا كان داخل الصندوق مبلغ موجود فعليًا الآن، اضغط «إضافة / سحب رصيد» وسجله مرة واحدة. بعد ذلك تتولى العمليات المالية تحديث الرصيد تلقائيًا.
      </div>
      <div class="grid cols-3 cashbox-grid">
        ${overview.map(entry=>{
          const b=entry.cashbox||{};
          const session=entry.session||null;
          const summary=entry.summary||{};
          const bal=expectedCashboxBalance(summary);
          return `
            <div class="card cashbox-card" data-box="${esc(b.id)}">
              <div class="cashbox-card-top">
                <div>
                  <div class="metric-label">${b.is_general?'الصندوق العام':'صندوق'}</div>
                  <div class="metric-value cashbox-title">${esc(b.name||'صندوق')}</div>
                </div>
                ${session?statusBadge(session.status||'open'):'<span class="badge">اليوم جاهز</span>'}
              </div>
              <div class="cashbox-balance-label">الرصيد المتوقع الآن</div>
              <div class="cashbox-balance">${bal===null?'—':money(bal,'SYP')}</div>
              <div class="metric-note">${session?`جلسة ${dateOnly(session.business_date||todayISO())}`:'سيتم فتح جلسة اليوم تلقائيًا'}</div>
              <div class="cashbox-actions"><button class="btn secondary adjust-box" data-id="${esc(b.id)}" data-name="${esc(b.name||'صندوق')}">إضافة / سحب رصيد</button></div>
            </div>`;
        }).join('')}
      </div>
      <div style="height:16px"></div>
      <div class="card">
        <div class="section-head-inline"><div><h3>جلسات اليوم</h3><p>الجلسة هي سجل يومي للصندوق، وليست مبلغًا منفصلًا.</p></div></div>
        <div class="table-wrap table-fit">
          <table class="table">
            <thead><tr><th>الصندوق</th><th>اليوم</th><th>الحالة</th><th>الرصيد المتوقع</th></tr></thead>
            <tbody>${overview.map(entry=>{
              const b=entry.cashbox||{}; const se=entry.session||{}; const bal=expectedCashboxBalance(entry.summary||{});
              return `<tr><td><strong>${esc(b.name||'صندوق')}</strong></td><td>${dateOnly(se.business_date||todayISO())}</td><td>${statusBadge(se.status||'open')}</td><td>${bal===null?'—':money(bal,'SYP')}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;

    root.querySelectorAll('.adjust-box').forEach(btn=>btn.addEventListener('click',()=>{
      const boxId=btn.dataset.id;
      const boxName=btn.dataset.name||'الصندوق';
      modal({
        title:`ضبط رصيد ${boxName}`,
        subtitle:'استخدمه عند بداية النظام أو عند وجود حركة نقدية يدوية حقيقية. لا تستخدمه بدل تسجيل المبيعات أو المصروفات.',
        body:`
          <div class="form-grid">
            <div class="field"><label>العملية</label><select name="direction"><option value="in">إضافة مبلغ للصندوق</option><option value="out">سحب مبلغ من الصندوق</option></select></div>
            <div class="field"><label>المبلغ</label><input name="amount" type="number" min="0.000001" step="any" required></div>
            <div class="field"><label>العملة</label><select name="currency"><option value="SYP">SYP</option><option value="USD">USD</option></select></div>
            <div class="field"><label>التاريخ</label><input name="date" type="date" value="${todayISO()}" required></div>
            <div class="field full"><label>ملاحظة <span class="optional-badge">اختياري</span></label><input name="note" placeholder="مثال: رصيد افتتاحي عند بدء استخدام النظام"></div>
          </div>`,
        submitText:'تسجيل الحركة',
        onSubmit:async fd=>{
          try{
            await api.recordCashboxAdjustment({
              cashboxId:boxId,
              direction:fd.get('direction'),
              amount:fd.get('amount'),
              currency:fd.get('currency'),
              note:fd.get('note'),
              date:fd.get('date'),
            });
            toast('تم تحديث حركة الصندوق','success');
            await renderCashboxes(root);
            return true;
          }catch(e){toast(friendlyError(e,'تعذر تسجيل حركة الصندوق.'),'error');return false;}
        }
      });
    }));
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;
  }
}

export async function renderExpenses(root){
  root.innerHTML=loader();
  try{
    const [rows,boxes,cats]=await Promise.all([api.expenseDetails(),api.cashboxes(),api.expenseCategories()]);
    const active=rows.filter(r=>!r.transaction_is_void);
    const totals={SYP:0,USD:0};
    active.forEach(r=>{const c=String(r.currency_code||'SYP').toUpperCase();if(c in totals) totals[c]+=Number(r.amount_original||0);});
    root.innerHTML=`
      <div class="page-head">
        <div><h2>المصروفات</h2><p>كل مصروف هنا هو خروج نقدي فعلي من صندوق: صيانة، نقل، خدمات، أدوات، مرافق وغيرها. شراء مواد المخزون يبقى في فواتير الشراء.</p></div>
        <button class="btn add">إضافة مصروف</button>
      </div>
      <div class="expense-summary">
        <div class="card"><div class="metric-label">إجمالي المصروفات SYP</div><div class="metric-value">${money(totals.SYP,'SYP')}</div></div>
        <div class="card"><div class="metric-label">إجمالي المصروفات USD</div><div class="metric-value">${money(totals.USD,'USD')}</div></div>
        <div class="card"><div class="metric-label">عدد العمليات</div><div class="metric-value">${active.length}</div></div>
      </div>
      <div style="height:16px"></div>
      ${rows.length?`
        <div class="table-wrap table-fit"><table class="table expense-table">
          <thead><tr><th>التاريخ</th><th>المصروف</th><th>التصنيف</th><th>المبلغ</th><th>الصندوق</th><th>الجهة</th><th>تفاصيل</th></tr></thead>
          <tbody>${rows.map(r=>`<tr class="${r.transaction_is_void?'is-void':''}">
            <td>${dateOnly(r.occurred_at)}</td>
            <td><strong>${esc(r.title||'مصروف')}</strong>${r.description?`<small>${esc(r.description)}</small>`:''}</td>
            <td>${esc(r.category_name||'أخرى')}</td>
            <td><strong>${r.amount_original==null?'—':money(r.amount_original,r.currency_code||'SYP')}</strong></td>
            <td>${esc(r.cashbox_name||'—')}</td>
            <td>${esc(r.payee||'—')}</td>
            <td><button class="mini-action expense-details" data-id="${esc(r.id)}">عرض</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`:'<div class="card empty"><strong>لا توجد مصروفات بعد</strong><div>أضف أول مصروف ليتم تسجيله على الصندوق المختار.</div></div>'}`;

    root.querySelector('.add').onclick=()=>modal({
      title:'إضافة مصروف',
      subtitle:'المبلغ سيُخصم من الصندوق المحدد فور تسجيل العملية.',
      body:`
        <div class="form-grid">
          <div class="field full"><label>اسم المصروف</label><input name="title" placeholder="مثال: صيانة البراد" required></div>
          <div class="field"><label>المبلغ</label><input name="amount" type="number" min="0.000001" step="any" required></div>
          <div class="field"><label>العملة</label><select name="currency"><option>SYP</option><option>USD</option></select></div>
          <div class="field"><label>الصندوق</label><select name="box" required>${boxes.filter(b=>b.is_active!==false).map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><label>التصنيف</label><select name="cat"><option value="">أخرى</option>${cats.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>المدفوع له <span class="optional-badge">اختياري</span></label><input name="payee" placeholder="شركة / شخص"></div>
          <div class="field"><label>التاريخ</label><input name="date" type="date" value="${todayISO()}" required></div>
          <div class="field full"><label>تفاصيل إضافية <span class="optional-badge">اختياري</span></label><textarea name="description" rows="3" placeholder="سبب المصروف أو رقم الإيصال أو أي ملاحظة مفيدة"></textarea></div>
        </div>`,
      onSubmit:async fd=>{
        try{
          await api.recordExpense({
            cashboxId:fd.get('box'),amount:fd.get('amount'),title:fd.get('title'),
            currency:fd.get('currency'),categoryId:fd.get('cat')||null,
            payee:String(fd.get('payee')||'').trim()||null,
            description:String(fd.get('description')||'').trim()||null,
            date:fd.get('date')
          });
          toast('تم تسجيل المصروف وخصمه من الصندوق','success');
          await renderExpenses(root);
          return true;
        }catch(e){toast(friendlyError(e),'error');return false;}
      }
    });

    root.querySelectorAll('.expense-details').forEach(btn=>btn.addEventListener('click',()=>{
      const r=rows.find(x=>String(x.id)===String(btn.dataset.id));
      if(!r) return;
      modal({
        title:r.title||'تفاصيل المصروف',
        body:`<div class="kv expense-detail-kv">
          <div class="k">التاريخ</div><div>${dateOnly(r.occurred_at)}</div>
          <div class="k">المبلغ</div><div><strong>${r.amount_original==null?'—':money(r.amount_original,r.currency_code||'SYP')}</strong></div>
          <div class="k">التصنيف</div><div>${esc(r.category_name||'أخرى')}</div>
          <div class="k">الصندوق</div><div>${esc(r.cashbox_name||'—')}</div>
          <div class="k">المدفوع له</div><div>${esc(r.payee||'—')}</div>
          <div class="k">الوصف</div><div>${esc(r.description||'—')}</div>
          <div class="k">الحالة</div><div>${r.transaction_is_void?'<span class="badge danger">ملغى</span>':'<span class="badge ok">مسجل</span>'}</div>
        </div>`,
        submitText:'إغلاق',
        onSubmit:async()=>true,
      });
    }));
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
