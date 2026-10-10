import * as api from '../api.js?v=0.24';
import { modal,toast,loader,friendlyError,confirmBox } from '../ui.js?v=0.24';
import { esc,money,dateOnly,statusBadge,todayISO,num,unitDisplay } from '../utils.js?v=0.24';
import { chooseStockPair, splitStockQuantity, stockNumber } from '../material-stock-display.js?v=0.24';
import { datePeriod, dateInRange, dateRangeValid } from '../date-range-batch.js?v=0.24';
import { downloadXlsx } from '../xlsx-export.js?v=0.24';
import { renderCashboxManualLedger } from './cashbox-ledger.js?v=0.24';
import { renderFilteredExpenses } from './expenses-batch.js?v=0.24';
import { calculateOrderTotals } from '../order-totals.js?v=0.24';

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

function stockSeparated(material,units,links){
  const base=units.find(u=>String(u.id)===String(material.base_unit_id));
  const baseLabel=unitDisplay(base)||material.base_unit_code||'';
  const total=Number(material.current_stock_base??material.stock_quantity_base??material.current_stock??0);
  if(!Number.isFinite(total))return {major:'\u2014',minor:'\u2014'};
  const pair=chooseStockPair(material,units,links);
  if(pair){
    const split=splitStockQuantity(total,pair.large.factor,pair.small.factor);
    if(split){
      const sign=split.negative?'\u2212 ':'';
      return {
        major:`${sign}${stockNumber(split.whole,0)} ${unitDisplay(pair.large.unit)}`,
        minor:`${sign}${stockNumber(split.minor,5)} ${unitDisplay(pair.small.unit)}`,
        original:`${stockNumber(total)} ${baseLabel}`,
      };
    }
  }
  const major=Math.trunc(Math.abs(total));
  const minor=Math.abs(total)-major;
  const sign=total<0?'\u2212 ':'';
  return {major:`${sign}${stockNumber(major,0)} ${baseLabel}`,minor:`${sign}${stockNumber(minor,5)} ${baseLabel}`,original:`${stockNumber(total)} ${baseLabel}`};
}

function lastPurchaseCost(row,purchasePrices){
  const ledgerCost=purchasePrices?.get(String(row.id));
  if(ledgerCost!=null)return ledgerCost;
  for(const key of ['latest_purchase_unit_cost_base','last_purchase_unit_cost_base','latest_purchase_cost_base_per_base_unit','latest_purchase_unit_cost_base_per_base_unit']){
    const v=row[key];if(v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v)))return Number(v);
  }
  return null;
}

export async function renderInventory(root){
  root.innerHTML=loader();
  try{
    const [rows,units,links,purchasePrices]=await Promise.all([
      api.materials(),api.units(),api.allMaterialUnitLinks().catch(()=>[]),
      api.latestMaterialPurchasePrices().catch(()=>new Map()),
    ]);
    const baseLabels=Object.fromEntries(units.map(u=>[String(u.id),unitDisplay(u)]));
    root.innerHTML=`
      <div class="page-head"><div>
        <h2>\u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0648\u0627\u0644\u062c\u0631\u062f</h2>
        <p>\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0643\u0627\u0645\u0644 \u0648\u0627\u0644\u062c\u0632\u0621 \u0627\u0644\u0645\u062a\u0628\u0642\u064a \u062d\u0633\u0628 \u0648\u062d\u062f\u0627\u062a \u0627\u0644\u0645\u0627\u062f\u0629 \u0648\u062a\u062d\u0648\u064a\u0644\u0627\u062a\u0647\u0627.</p>
      </div></div>
      <div class="table-wrap table-fit"><table class="table inventory-parts-table">
      <thead><tr><th>\u0627\u0644\u0645\u0627\u062f\u0629</th><th>\u0627\u0644\u0643\u0645\u064a\u0629 \u0628\u0627\u0644\u062c\u0645\u0644\u0629</th><th>\u0627\u0644\u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u062a\u0628\u0642\u064a\u0629</th><th>\u062d\u062f \u0627\u0644\u062a\u0646\u0628\u064a\u0647</th><th>\u0622\u062e\u0631 \u0633\u0639\u0631 \u0634\u0631\u0627\u0621</th></tr></thead>
      <tbody>${rows.map(r=>{
        const stock=stockSeparated(r,units,links);
        const cost=lastPurchaseCost(r,purchasePrices);
        const base=baseLabels[String(r.base_unit_id)]||r.base_unit_code||'';
        return `<tr><td><strong>${esc(r.name)}</strong></td>
          <td title="${esc(stock.original)}"><strong>${esc(stock.major)}</strong></td>
          <td><span class="inventory-minor">${esc(stock.minor)}</span></td>
          <td>${inventoryMinimum(r)==null?'\u2014':`${esc(stockNumber(inventoryMinimum(r)))} ${esc(base)}`}</td>
          <td>${cost==null?'\u2014':`${money(cost,'SYP')} / ${esc(base)}`}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }catch(e){root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;}
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
              <div class="cashbox-actions"><button class="btn secondary adjust-box" data-id="${esc(b.id)}" data-name="${esc(b.name||'صندوق')}">إضافة / سحب</button>${b.is_general?'':`<button type="button" class="btn secondary zero-box" data-id="${esc(b.id)}">\u062a\u0635\u0641\u064a\u0631</button>`}</div>
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
      </div>
      <div id="cashbox-ledger-host"></div>`;

    root.querySelectorAll('.adjust-box').forEach(btn=>btn.addEventListener('click',()=>{
      const boxId=btn.dataset.id;
      const boxName=btn.dataset.name||'الصندوق';
      modal({
        title:`\u0625\u0636\u0627\u0641\u0629 / \u0633\u062d\u0628 \u2014 ${boxName}`,
        subtitle:'',
        body:`
          <div class="form-grid">
            <div class="field"><label>العملية</label><select name="direction"><option value="in">إضافة</option><option value="out">سحب</option></select></div>
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
    root.querySelectorAll('.zero-box').forEach(btn=>btn.addEventListener('click',async()=>{
      const boxId=btn.dataset.id;
      if(!(await confirmBox('\u0633\u062a\u0646\u062a\u0642\u0644 \u062c\u0645\u064a\u0639 \u0627\u0644\u0623\u0631\u0635\u062f\u0629 \u0627\u0644\u0645\u062a\u0627\u062d\u0629 \u0625\u0644\u0649 \u0627\u0644\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u0639\u0627\u0645\u060c \u0648\u0633\u062a\u0628\u0642\u0649 \u0627\u0644\u062d\u0631\u0643\u0627\u062a \u0645\u062d\u0641\u0648\u0638\u0629.', '\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u062a\u062d\u0648\u064a\u0644')))return;
      btn.disabled=true;
      try{
        await api.zeroCashboxToGeneral(boxId);
        toast('\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062a\u062d\u0648\u064a\u0644 \u0625\u0644\u0649 \u0627\u0644\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u0639\u0627\u0645.', 'success');
        await renderCashboxes(root);
      }catch(error){toast(friendlyError(error,'\u062a\u0639\u0630\u0631 \u062a\u0635\u0641\u064a\u0631 \u0627\u0644\u0635\u0646\u062f\u0648\u0642.'),'error');btn.disabled=false;}
    }));
    await renderCashboxManualLedger(root.querySelector('#cashbox-ledger-host'),boxes);
  }catch(e){
    root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;
  }
}

export async function renderExpenses(root){
  return renderFilteredExpenses(root);
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
    const [order,items,menu,boxes]=await Promise.all([
      api.one('orders',id),api.orderItems(id),api.menuItems(),api.cashboxes(),
    ]);
    if(!order)throw Error('ORDER_NOT_FOUND');
    const mm=Object.fromEntries(menu.map(x=>[String(x.id),x]));
    const boxMap=Object.fromEntries(boxes.map(x=>[String(x.id),x]));
    const rates={
      discountPercent:Number(order.order_discount_percent_v023||0),
      expenditurePercent:Number(order.expenditure_tax_percent_v023||0),
      localPercent:Number(order.local_administration_tax_percent_v023||0),
    };
    const calculated=calculateOrderTotals(items,rates);
    const show=key=>{
      if(order.status==='posted'){
        const keys={orderDiscount:'order_discount_amount_original_v023',expenditureTax:'expenditure_tax_amount_original_v023',localTax:'local_administration_tax_amount_original_v023',collected:'net_total_original'};
        const actual=order[keys[key]];
        if(actual!=null)return Number(actual);
      }
      return calculated[key];
    };
    const readonly=order.status!=='draft';
    const moneyFor=value=>money(value,order.currency_code||'SYP');
    const label={
      header:'\u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0623\u0648\u0631\u062f\u0631',
      summary:'\u0645\u0644\u062e\u0635 \u0627\u0644\u0623\u0648\u0631\u062f\u0631',
      gross:'\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a \u0642\u0628\u0644 \u0627\u0644\u062e\u0635\u0645',
      itemDiscount:'\u062e\u0635\u0648\u0645 \u0627\u0644\u0628\u0646\u0648\u062f',orderDiscount:'\u062e\u0635\u0645 \u0627\u0644\u0623\u0648\u0631\u062f\u0631',
      expenditure:'\u0631\u0633\u0645 \u0627\u0644\u0625\u0646\u0641\u0627\u0642',local:'\u0631\u0633\u0645 \u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0645\u062d\u0644\u064a\u0629',
      final:'\u0627\u0644\u0645\u0642\u0628\u0648\u0636',hospitality:'\u0636\u064a\u0627\u0641\u0629',
      save:'\u062d\u0641\u0638 \u0627\u0644\u062e\u0635\u0645',undo:'\u0633\u062d\u0628 \u0627\u0644\u0646\u0634\u0631 \u0648\u062a\u0639\u062f\u064a\u0644',
    };
    root.innerHTML=`
      <div class="page-head"><div><h2>${label.header}</h2><p>${statusBadge(order.status)} \u2014 ${esc(order.external_order_number||'')}</p></div></div>
      <div class="order-detail-toolbar">
        <section class="card order-finance-card" aria-label="${label.summary}">
          <div class="section-head-inline"><h3>${label.summary}</h3><strong class="order-collected" data-order-total>${moneyFor(show('collected'))}</strong></div>
          <div class="order-finance-grid">
            <div><small>${label.gross}</small><strong>${moneyFor(calculated.gross)}</strong></div>
            <div><small>${label.itemDiscount}</small><strong>${moneyFor(calculated.perItemDiscount)}</strong></div>
            <div><small>${label.orderDiscount}</small><strong data-order-discount-money>${moneyFor(show('orderDiscount'))}</strong></div>
            <div><small>${label.expenditure} (${rates.expenditurePercent}%)</small><strong data-order-expenditure>${moneyFor(show('expenditureTax'))}</strong></div>
            <div><small>${label.local} (${rates.localPercent}% \u0645\u0646 \u0627\u0644\u0631\u0633\u0645)</small><strong data-order-local>${moneyFor(show('localTax'))}</strong></div>
            <div class="order-final"><small>${label.final}</small><strong data-order-collected>${moneyFor(show('collected'))}</strong></div>
          </div>
          ${!readonly?`<div class="order-discount-control"><label>${label.orderDiscount} %</label><input class="order-discount-input" type="number" min="0" max="100" step="any" value="${rates.discountPercent}"><button class="btn secondary save-order-rate" type="button">${label.save}</button></div>`:''}
        </section>
        <section class="card order-controls-card">
          <div class="kv"><div class="k">\u0627\u0644\u062d\u0627\u0644\u0629</div><div>${statusBadge(order.status)}</div>
            <div class="k">\u0627\u0644\u0639\u0645\u0644\u0629</div><div>${esc(order.currency_code||'SYP')}</div>
            <div class="k">\u0627\u0644\u0635\u0646\u062f\u0648\u0642</div><div>${order.cashbox_id?esc(boxMap[String(order.cashbox_id)]?.name||''):'\u0639\u0646\u062f \u0627\u0644\u0646\u0634\u0631'}</div>
          </div>
          <div class="quick-actions order-action-buttons">
            ${!readonly?`<button type="button" class="btn add">\u0625\u0636\u0627\u0641\u0629 \u0635\u0646\u0641</button><button type="button" class="btn secondary hospitality">\u0625\u0636\u0627\u0641\u0629 \u0636\u064a\u0627\u0641\u0629</button><button type="button" class="btn soft post" ${!items.length?'disabled':''}>\u0646\u0634\u0631 \u0627\u0644\u0623\u0648\u0631\u062f\u0631</button>`:''}
            ${order.status==='posted'?`<button type="button" class="btn secondary reopen-order">${label.undo}</button>`:''}
          </div>
        </section>
      </div>
      <div class="card" style="margin-top:16px"><h3>\u0627\u0644\u0623\u0635\u0646\u0627\u0641</h3>
        ${items.length?`<div class="table-wrap table-fit"><table class="table"><thead><tr><th>\u0627\u0644\u0635\u0646\u0641</th><th>\u0627\u0644\u0643\u0645\u064a\u0629</th><th>\u0633\u0639\u0631 \u0627\u0644\u0648\u062d\u062f\u0629</th><th>\u0627\u0644\u062a\u0639\u062f\u064a\u0644</th><th>\u0627\u0644\u0635\u0627\u0641\u064a</th></tr></thead>
        <tbody>${items.map(x=>`<tr><td>${esc(mm[String(x.menu_item_id)]?.name||x.raw_item_name||'')}</td><td>${esc(x.quantity||1)}</td><td>${moneyFor(x.unit_price_original||0)}</td>
        <td>${x.adjustment_type==='complimentary'?`<span class="badge ok">${label.hospitality}</span>`:(['percent','discount_percent'].includes(x.adjustment_type)?`${esc(x.adjustment_value||0)}%`:'' )}</td>
        <td>${moneyFor(x.adjustment_type==='complimentary'?0:(x.line_net_original??Number(x.unit_price_original||0)*Number(x.quantity||1)))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0635\u0646\u0627\u0641.</div>'}
      </div>`;

    const openAddItem=complimentary=>{
      const m=modal({title:complimentary?'\u0625\u0636\u0627\u0641\u0629 \u0636\u064a\u0627\u0641\u0629':'\u0625\u0636\u0627\u0641\u0629 \u0635\u0646\u0641',body:`<div class="form-grid">
        <div class="field full"><label>\u0627\u0644\u0635\u0646\u0641</label><select name="item" required>${menu.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label>\u0627\u0644\u0643\u0645\u064a\u0629</label><input name="qty" type="number" min="0.0001" step="any" value="1" required></div>
        <div class="field"><label>\u0627\u0644\u0633\u0639\u0631</label><input name="price" type="number" step="any" min="0" required></div>
        ${complimentary?'':`<div class="field"><label>\u062e\u0635\u0645 \u0627\u0644\u0628\u0646\u062f %</label><input name="discount" type="number" min="0" max="100" step="any"></div>`}</div>`,
      onSubmit:async fd=>{
        try{
          const input={orderId:id,menuItemId:fd.get('item'),quantity:Number(fd.get('qty')),unitPrice:Number(fd.get('price'))};
          if(!(input.quantity>0)||!(input.unitPrice>=0))return false;
          if(complimentary)await api.addComplimentaryOrderItem(input);
          else await api.addOrderItem({...input,adjustmentType:Number(fd.get('discount')||0)>0?'percent':'none',adjustmentValue:Number(fd.get('discount')||0)});
          toast('\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0635\u0646\u0641.','success');
          await renderOrderDetail(root,id);return true;
        }catch(e){toast(friendlyError(e),'error');return false;}
      }});
      const itemSel=m.form.querySelector('[name="item"]'),price=m.form.querySelector('[name="price"]'),discount=m.form.querySelector('[name="discount"]');
      const refresh=()=>{const item=mm[String(itemSel.value)];price.value=itemPrice(item);if(discount)discount.value=Number(item?.default_discount_percent||0)||'';};
      itemSel?.addEventListener('change',refresh);refresh();
    };
    root.querySelector('.add')?.addEventListener('click',()=>openAddItem(false));
    root.querySelector('.hospitality')?.addEventListener('click',()=>openAddItem(true));
    const discountInput=root.querySelector('.order-discount-input');
    const preview=()=>{
      const n=Number(discountInput.value);
      if(!Number.isFinite(n)||n<0||n>100)return;
      const calc=calculateOrderTotals(items,{...rates,discountPercent:n});
      root.querySelector('[data-order-total]').textContent=moneyFor(calc.collected);
      root.querySelector('[data-order-collected]').textContent=moneyFor(calc.collected);
      root.querySelector('[data-order-discount-money]').textContent=moneyFor(calc.orderDiscount);
      root.querySelector('[data-order-expenditure]').textContent=moneyFor(calc.expenditureTax);
      root.querySelector('[data-order-local]').textContent=moneyFor(calc.localTax);
    };
    discountInput?.addEventListener('input',preview);
    root.querySelector('.save-order-rate')?.addEventListener('click',async()=>{
      const value=Number(discountInput.value);
      if(!Number.isFinite(value)||value<0||value>100){toast('\u0646\u0633\u0628\u0629 \u0627\u0644\u062e\u0635\u0645 \u0645\u0646 0 \u0625\u0644\u0649 100.','error');return;}
      try{await api.setOrderRates(id,value,rates.expenditurePercent,rates.localPercent);toast('\u062a\u0645 \u062d\u0641\u0638 \u062e\u0635\u0645 \u0627\u0644\u0623\u0648\u0631\u062f\u0631.','success');await renderOrderDetail(root,id);}
      catch(e){toast(friendlyError(e),'error');}
    });
    root.querySelector('.post')?.addEventListener('click',async()=>{
      if(discountInput&&Math.abs(Number(discountInput.value)-rates.discountPercent)>0.000001){toast('\u0627\u062d\u0641\u0638 \u0646\u0633\u0628\u0629 \u0627\u0644\u062e\u0635\u0645 \u0623\u0648\u0644\u064b\u0627.','error');return;}
      let selectedBox=order.cashbox_id;
      if(!selectedBox){
        const active=boxes.filter(x=>x.is_active!==false);
        if(!active.length){toast('\u0644\u0627 \u064a\u0648\u062c\u062f \u0635\u0646\u062f\u0648\u0642 \u0646\u0634\u0637.','error');return;}
        selectedBox=await chooseOrderCashbox(active);
        if(!selectedBox)return;
        try{await api.setOrderCashbox(id,selectedBox);}catch(e){toast(friendlyError(e),'error');return;}
      }
      if(!(await confirmBox(`\u0627\u0644\u0645\u0628\u0644\u063a \u0627\u0644\u0645\u0642\u0628\u0648\u0636: ${moneyFor(calculated.collected)}. \u0633\u064a\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0646\u0642\u062f \u0648\u0627\u0633\u062a\u0647\u0644\u0627\u0643 \u0627\u0644\u0645\u062e\u0632\u0648\u0646.`, '\u0646\u0634\u0631')))return;
      const btn=root.querySelector('.post');if(btn)btn.disabled=true;
      try{await api.postOrder(id);toast('\u062a\u0645 \u0646\u0634\u0631 \u0627\u0644\u0623\u0648\u0631\u062f\u0631.','success');await renderOrderDetail(root,id);}
      catch(error){toast(friendlyError(error,'\u062a\u0639\u0630\u0631 \u0627\u0644\u0646\u0634\u0631. \u062a\u062d\u0642\u0642 \u0645\u0646 \u062d\u0627\u0644\u0629 \u0627\u0644\u0623\u0648\u0631\u062f\u0631 \u0642\u0628\u0644 \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629.'),'error');if(btn)btn.disabled=false;}
    });
    root.querySelector('.reopen-order')?.addEventListener('click',()=>{
      modal({title:label.undo,subtitle:'\u062a\u0648\u062b\u064a\u0642 \u0627\u0644\u0633\u0628\u0628 \u0625\u0644\u0632\u0627\u0645\u064a. \u0633\u064a\u064f\u0631\u062f \u0627\u0644\u0645\u0628\u0644\u063a \u0648\u062a\u064f\u0633\u062a\u0639\u0627\u062f \u0627\u0644\u0645\u0648\u0627\u062f \u062b\u0645 \u062a\u064f\u0646\u0634\u0623 \u0645\u0633\u0648\u062f\u0629 \u062c\u062f\u064a\u062f\u0629.',
        body:'<div class="field"><label>\u0633\u0628\u0628 \u0627\u0644\u062a\u0635\u062d\u064a\u062d</label><textarea name="reason" rows="3" minlength="5" required></textarea></div>',
        submitText:label.undo,
        onSubmit:async fd=>{
          try{
            const newId=await api.reopenPostedOrder(id,String(fd.get('reason')||'').trim());
            if(!newId)throw Error('ORDER_REVERSAL_NOT_CONFIRMED');
            toast('\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0625\u0631\u062c\u0627\u0639 \u0648\u0641\u062a\u062d \u0645\u0633\u0648\u062f\u0629 \u062c\u062f\u064a\u062f\u0629.','success');
            location.hash='#/order/'+newId;return true;
          }catch(e){toast(friendlyError(e),'error');return false;}
        },
      });
    });
  }catch(e){root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;}
}
