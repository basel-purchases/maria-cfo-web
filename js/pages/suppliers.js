import * as api from '../api.js?v=1.0.22';
import {modal,toast,loader,friendlyError,confirmBox} from '../ui.js?v=1.0.22';
import {esc,money,dateOnly,unitLabel} from '../utils.js?v=1.0';
import {startSupplierInvoiceV121} from './purchases.js?v=1.0.22';
import {purchaseLineTotalV119,supplierPurchaseSummaryV119} from '../purchase-workflow-v119.js?v=1.0.22';
import {registerTableExport} from '../table-export-v027.js?v=1.0';
import {PAGE_SIZES,paginateArray,mergeSupplierRecords,supplierBalanceState,suppliersFilter,numericValue,pageInfo} from '../table-presenter-v025.js?v=1.0';

const amount=value=>value===null||value===undefined?'—':money(value,'SYP');
const reportValue=value=>esc(amount(value));

function statusBadge(account){
 switch(supplierBalanceState(account)){
  case 'unpaid':return '<span class="badge red">دين غير مسدد بحسب التقرير</span>';
  case 'settled':return '<span class="badge green">الرصيد صفر</span>';
  case 'credit':return '<span class="badge yellow">رصيد دائن / سالب</span>';
  case 'unknown':return '<span class="badge yellow">الرصيد غير معروف</span>';
  default:return '<span class="badge">لم يستورد كشف حساب</span>';
 }
}

function addSupplier(root){
 modal({title:'إضافة مورد',body:`<div class="form-grid">
  <div class="field"><label>اسم المورد</label><input name="name" required></div>
  <div class="field"><label>الهاتف</label><input name="phone"></div>
  <div class="field"><label>جهة الاتصال</label><input name="contact"></div>
  </div>`,onSubmit:async fd=>{
   try{
    const name=String(fd.get('name')||'').trim();
    if(!name){toast('اكتب اسم المورد','error');return false;}
    await api.insertFirst('suppliers',[
     {name,phone:String(fd.get('phone')||'').trim()||null,contact_name:String(fd.get('contact')||'').trim()||null},
     {name},
    ]);
    toast('تمت إضافة المورد','success');await renderSuppliersWithAmeen(root);return true;
   }catch(e){toast(friendlyError(e),'error');return false;}
  }
 });
}

// v1.0.20: Native supplier edit/delete actions are adjacent to one-click new invoice.
// Foreign keys prevent deleting a supplier who already has invoices or payments.
function editSupplierV120(root,supplier){
 if(!supplier?.id)return;
 modal({
  title:`تعديل المورد: ${supplier.name}`,
  body:`<div class="form-grid">
    <div class="field"><label>اسم المورد</label><input name="name" required maxlength="200" value="${esc(supplier.name||'')}"></div>
    <div class="field"><label>الهاتف</label><input name="phone" value="${esc(supplier.phone||'')}"></div>
    <div class="field"><label>جهة الاتصال</label><input name="contact" value="${esc(supplier.contact||supplier.contact_name||'')}"></div>
  </div>`,
  onSubmit:async fd=>{
   const name=String(fd.get('name')||'').trim();
   if(!name){toast('اسم المورد مطلوب','error');return false;}
   try{
    await api.update('suppliers',supplier.id,{name,
      phone:String(fd.get('phone')||'').trim()||null,
      contact_name:String(fd.get('contact')||'').trim()||null});
    toast('تم حفظ بيانات المورد','success');
    await renderSuppliersWithAmeen(root);return true;
   }catch(e){toast(friendlyError(e),'error');return false;}
  },
 });
}

async function deleteSupplierV120(root,supplier){
 if(!supplier?.id)return;
 if(!(await confirmBox(`حذف المورد «${supplier.name}» نهائيًا؟ لن تُحذف أي فاتورة أو دفعة مرتبطة به. إذا كانت له حركات مالية فسيمنع النظام الحذف.`, 'حذف المورد')))return;
 try{
  await api.supplierDeleteIfUnusedV120(supplier.id);
  toast('تم حذف المورد غير المرتبط بحركات','success');
  await renderSuppliersWithAmeen(root);
 }catch(e){toast('لا يمكن حذف مورد مرتبط بفواتير أو دفعات أو مواد أو كشف حساب محفوظ. '+friendlyError(e),'error');}
}

async function showLedger(account){
 const m=modal({title:`كشف مورد: ${account.supplier_name}`,wide:true,hideActions:true,
  subtitle:`رقم الحساب المرجعي ${account.external_account}. البيانات هنا مرجعية ولا تسدد تلقائيًا من الصندوق.`,
  body:`<div class="supplier-statement-summary">
    <div><span>الرصيد السابق</span><strong>${reportValue(account.previous_balance)}</strong></div>
    <div><span>إجمالي المدين بالتقرير</span><strong>${reportValue(account.total_debit)}</strong></div>
    <div><span>إجمالي الدائن بالتقرير</span><strong>${reportValue(account.total_credit)}</strong></div>
    <div><span>أوراق تجارية غير محصلة</span><strong>${reportValue(account.uncollected_papers_v025)}</strong></div>
    <div><span>الرصيد الحالي</span><strong>${reportValue(account.current_balance)}</strong></div>
  </div><div class="notice ${supplierBalanceState(account)==='unpaid'?'rose':'green'}">${supplierBalanceState(account)==='unpaid'?'يوجد رصيد موجب غير مسدد بحسب الكشف المستورد. تحقق من السندات والتسويات قبل اعتماده دينًا نهائيًا.':'لا توجد إشارة إلى رصيد موجب مستحق وفق آخر كشف مستورد.'}</div>
  <div class="supplier-ledger-host" aria-live="polite">${loader()}</div>`});
 const host=m.form.querySelector('.supplier-ledger-host');
 let page=1,sequence=0;
 const draw=async()=>{
  const seq=++sequence;
  host.innerHTML=loader();
  try{
   const result=await api.ameenSupplierEntriesPageV025(account.external_account,page,PAGE_SIZES.ledger);
   if(seq!==sequence||!m.element.isConnected)return;
   const info=pageInfo(result.total,page,PAGE_SIZES.ledger);
   host.innerHTML=`<div class="table-wrap"><table class="table supplier-ledger-table"><thead>
    <tr><th>تاريخ الحركة</th><th>أصل السند</th><th>مدين الحركة</th><th>دائن الحركة</th><th>البيان</th></tr>
    </thead><tbody>${result.rows.map(r=>`<tr>
    <td>${esc(String(r.occurred_at||'').slice(0,10)||'—')}</td>
    <td>${esc(r.source_document||'—')}</td>
    <td>${reportValue(r.debit)}</td><td>${reportValue(r.credit)}</td>
    <td>${esc(r.description||'—')}</td></tr>`).join('')||'<tr><td colspan="5">لا توجد حركات محفوظة لهذا الحساب.</td></tr>'}
    </tbody></table></div>
    ${info.pages>1?`<div class="pagination-bar">
     <button class="mini-btn ledger-prev" ${info.page<=1?'disabled':''}>السابق</button>
     <span>${info.from}–${info.to} من ${info.total} · صفحة ${info.page} من ${info.pages}</span>
     <button class="mini-btn ledger-next" ${info.page>=info.pages?'disabled':''}>التالي</button>
    </div>`:''}`;
   registerTableExport(host.querySelector('.supplier-ledger-table'),async()=>{
    let all=[],pageIndex=1,more=true;const size=100;
    while(more){const res=await api.ameenSupplierEntriesPageV025(account.external_account,pageIndex,size);
      all.push(...res.rows);more=all.length<res.total&&res.rows.length>0;pageIndex++;
      if(pageIndex>3000)throw Error('SUPPLIER_LEDGER_EXPORT_LIMIT');
    }
    return {title:`كشف مورد ${account.supplier_name}`,
      headers:['التاريخ','أصل السند','مدين','دائن','البيان'],
      rows:all.map(x=>[String(x.occurred_at||'').slice(0,10),x.source_document||'',x.debit??'',x.credit??'',x.description||''])};
   });
   host.querySelector('.ledger-prev')?.addEventListener('click',()=>{page=Math.max(1,page-1);draw();});
   host.querySelector('.ledger-next')?.addEventListener('click',()=>{page=Math.min(info.pages,page+1);draw();});
  }catch(e){if(seq===sequence&&m.element.isConnected)host.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
 };
 draw();
}

// Kept the old route export for compatibility with integrations referring to it.
export async function renderSuppliers(root){return renderSuppliersWithAmeen(root);}
export async function renderAmeenSupplierStatements(root){return renderSuppliersWithAmeen(root);}

export async function renderSuppliersWithAmeen(root){
 root.innerHTML=loader();
 try{
  const [native,accounts]=await Promise.all([api.suppliers(),api.ameenSupplierBalancesV024()]);
  const all=mergeSupplierRecords(native,accounts);
  const state={query:'',status:'all',page:1};
  const unpaid=all.filter(s=>supplierBalanceState(s.account)==='unpaid');
  const outstanding=unpaid.reduce((total,s)=>total+Number(s.account?.current_balance||0),0);
  root.innerHTML=`<div class="page-head">
    <div><h2>الموردون وكشوف الحساب</h2>
      <p>اختر «الملف والإحصائيات» لمراجعة فواتير المورد وبنودها ومدفوعاتها وحركة مخزون مواده. الأرصدة المستوردة مرجعية منفصلة.</p></div>
    <div class="page-head-actions"><a class="btn secondary" href="#/quick-imports">رفع كشف حساب</a><button class="btn add">إضافة مورد</button></div>
  </div>
  <div class="grid cols-3 finance-summary-grid">
    <div class="card"><strong>${all.length}</strong><div class="metric-note">عدد الموردين</div></div>
    <div class="card"><strong>${unpaid.length}</strong><div class="metric-note">موردون لديهم رصيد موجب</div></div>
    <div class="card"><strong>${esc(amount(outstanding))}</strong><div class="metric-note">إجمالي الأرصدة الموجبة من الكشف المستورد</div></div>
  </div>
  <div class="notice">الأرصدة المرجعية من الملف المستورد، ولا تعني وجود دفعات مسجلة داخل Maria CFO. تحقق من توقيت آخر كشف وأي تسويات حدثت بعده.</div>
  <div class="list-toolbar">
    <div class="search-box"><span aria-hidden="true">⌕</span><input id="supplier-search" type="search" autocomplete="off" placeholder="ابحث باسم المورد أو رقم الحساب أو الهاتف"></div>
    <select id="supplier-status-filter" aria-label="حالة الدين">
     <option value="all">كل الموردين</option><option value="unpaid">ديون غير مسددة</option>
     <option value="settled">رصيد صفر</option><option value="credit">رصيد سالب</option>
     <option value="no-import">بدون كشف مستورد</option>
    </select>
    <span class="list-count" id="supplier-count"></span>
  </div>
  <div id="supplier-results"></div>`;
  root.querySelector('.add').onclick=()=>addSupplier(root);
  const draw=()=>{
   const filtered=suppliersFilter(all,state);
   const info=paginateArray(filtered,state.page,PAGE_SIZES.suppliers);
   state.page=info.page;
   root.querySelector('#supplier-count').textContent=`${filtered.length} مورد`;
   root.querySelector('#supplier-results').innerHTML=`<div class="table-wrap supplier-table-scroll"><table class="table supplier-full-table">
    <thead><tr><th>المورد</th><th>رقم الحساب المرجعي</th><th>الهاتف</th><th>جهة الاتصال</th>
      <th>الرصيد السابق</th><th>مدين إجمالي</th><th>دائن إجمالي</th>
      <th>الأوراق التجارية غير المحصلة</th><th>الرصيد الحالي</th><th>الحالة</th><th>الحركات</th><th>الإجراءات</th></tr></thead>
    <tbody>${info.rows.map((s,i)=>{
     const a=s.account;
     return `<tr class="${supplierBalanceState(a)==='unpaid'?'supplier-unpaid-row':''}">
       <td><strong>${esc(s.name)}</strong></td>
       <td><span class="code-chip">${esc(s.code||'—')}</span></td>
       <td>${esc(s.phone||'—')}</td><td>${esc(s.contact||'—')}</td>
       <td>${reportValue(a?.previous_balance)}</td>
       <td>${reportValue(a?.total_debit)}</td><td>${reportValue(a?.total_credit)}</td>
       <td>${reportValue(a?.uncollected_papers_v025)}</td>
       <td class="supplier-balance">${reportValue(a?.current_balance)}</td>
       <td>${statusBadge(a)}</td>
       <td>${a?`<button class="mini-btn view-supplier-ledger" data-code="${esc(a.external_account)}">عرض الحركات المستوردة</button>`:'—'}</td>
       <td class="row-actions supplier-actions-v119">
         ${s.id?`<button type="button" class="mini-action supplier-edit-v120" data-supplier-index="${(info.page-1)*PAGE_SIZES.suppliers+i}">تعديل</button>
         <button type="button" class="mini-action danger supplier-delete-v120" data-supplier-index="${(info.page-1)*PAGE_SIZES.suppliers+i}">حذف</button>`:''}
         <button type="button" class="mini-action supplier-new-invoice-v119" data-supplier-index="${(info.page-1)*PAGE_SIZES.suppliers+i}">+ إضافة فاتورة</button>
         ${s.id?`<a class="mini-action" href="#/supplier/${esc(s.id)}">الملف والإحصائيات</a>`:''}
       </td>
     </tr>`;
    }).join('')||'<tr><td colspan="12">لا توجد نتائج مطابقة.</td></tr>'}</tbody></table></div>
    ${info.pages>1?`<div class="pagination-bar">
      <button class="mini-btn suppliers-prev" ${info.page<=1?'disabled':''}>السابق</button>
      <span>${info.from}–${info.to} من ${info.total} · صفحة ${info.page} من ${info.pages}</span>
      <button class="mini-btn suppliers-next" ${info.page>=info.pages?'disabled':''}>التالي</button>
    </div>`:''}`;
   registerTableExport(root.querySelector('.supplier-full-table'),()=>({
     title:'الموردون - حسب البحث والفلتر',
     headers:['المورد','رقم الحساب المرجعي','الهاتف','جهة الاتصال','الرصيد السابق','مدين إجمالي','دائن إجمالي','أوراق تجارية','الرصيد الحالي','الحالة'],
     rows:filtered.map(s=>{const a=s.account;return [s.name,s.code||'',s.phone||'',s.contact||'',a?.previous_balance??'',a?.total_debit??'',a?.total_credit??'',a?.uncollected_papers_v025??'',a?.current_balance??'',supplierBalanceState(a)];})
   }));
   root.querySelectorAll('.supplier-edit-v120').forEach(b=>b.onclick=()=>{
     const supplier=filtered[Number(b.dataset.supplierIndex)];
     if(supplier?.id)editSupplierV120(root,supplier);
   });
   root.querySelectorAll('.supplier-delete-v120').forEach(b=>b.onclick=()=>{
     const supplier=filtered[Number(b.dataset.supplierIndex)];
     if(supplier?.id)deleteSupplierV120(root,supplier);
   });
   root.querySelectorAll('.supplier-new-invoice-v119').forEach(b=>b.onclick=()=>{
     const entry=filtered[Number(b.dataset.supplierIndex)];
     if(entry)void startSupplierInvoiceV121({supplier:entry});
   });
   root.querySelectorAll('.view-supplier-ledger').forEach(b=>b.onclick=()=>{
    const a=accounts.find(x=>String(x.external_account)===b.dataset.code);
    if(a)showLedger(a);
   });
   root.querySelector('.suppliers-prev')?.addEventListener('click',()=>{state.page--;draw();});
   root.querySelector('.suppliers-next')?.addEventListener('click',()=>{state.page++;draw();});
  };
  root.querySelector('#supplier-search').oninput=e=>{state.query=e.target.value;state.page=1;draw();};
  root.querySelector('#supplier-status-filter').onchange=e=>{state.status=e.target.value;state.page=1;draw();};
  draw();
 }catch(e){root.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
}


// v1.0.19: Dedicated supplier tabs. Every figure is read from Supabase;
// imported Ameen balances remain explicitly separate from live purchases.
export async function renderSupplierDetail(root,id){
 root.innerHTML=loader();
 try{
  const [supplier,activity,accounts]=await Promise.all([
   api.one('suppliers',id),api.supplierActivityV119(id),api.ameenSupplierBalancesV024(),
  ]);
  if(!supplier)throw Error('SUPPLIER_NOT_FOUND');
  const summary=supplierPurchaseSummaryV119(activity);
  const invoices=(activity.invoices||[]).filter(inv=>!inv.archived_at_v122);
  const items=activity.items||[];
  const payments=activity.payments||[];
  const allocations=activity.allocations||[];
  const movements=activity.movements||[];
  const invMap=new Map(invoices.map(x=>[String(x.id),x]));
  const paidPaymentIds=new Set(payments.filter(p=>p.status==='posted').map(p=>String(p.id)));
  const paidByInvoice=new Map();
  allocations.filter(a=>paidPaymentIds.has(String(a.payment_id))).forEach(a=>{
   const key=String(a.invoice_id);
   paidByInvoice.set(key,(paidByInvoice.get(key)||0)+Number(a.amount_invoice_currency||0));
  });
  const account=accounts.find(a=>String(a.supplier_id||'')===String(id)||
    String(a.external_account||'')===String(supplier.ameen_account_code_v024||'-'));
  const moneyByCurrency=o=>Object.entries(o||{}).map(([currency,value])=>money(value,currency)).join(' / ')||'—';
  const grouped=Object.entries(summary.currencies);
  root.innerHTML=`
   <div class="page-head"><div><h2>ملف المورد: ${esc(supplier.name)}</h2>
     <p>${esc(supplier.phone||'لا يوجد هاتف')} ${supplier.contact_name?`· ${esc(supplier.contact_name)}`:''}</p>
     </div><div class="page-head-actions">
       <a class="btn secondary" href="#/suppliers">جميع الموردين</a>
       <button type="button" class="btn supplier-create-purchase-v119">+ فاتورة لهذا المورد</button>
     </div></div>
   <div class="grid cols-3 supplier-kpis-v119">
     <div class="card"><strong>${summary.liveCount}</strong><div class="metric-note">فواتير مشتريات منشورة وسارية</div></div>
     <div class="card"><strong>${summary.materials.length}</strong><div class="metric-note">مادة/وحدة اشتريت من المورد</div></div>
     <div class="card"><strong>${summary.draftCount}</strong><div class="metric-note">مسودات · ${summary.voidedCount} نسخة ملغاة/مصححة</div></div>
   </div>
   <div class="grid cols-2 supplier-money-kpis-v119">
     ${grouped.map(([code,v])=>`<div class="card"><h3>${esc(code==='SYP'?'ل.س':code)}</h3>
       <div class="kv"><div class="k">مشتريات منشورة</div><div>${money(v.purchased,code)}</div>
       <div class="k">الدفعات المخصصة</div><div>${money(v.paidAllocated,code)}</div>
       <div class="k">الرصيد المتبقي</div><div><strong>${money(v.outstanding,code)}</strong></div></div></div>`).join('')||'<div class="card"><p>لا توجد فواتير منشورة لهذا المورد.</p></div>'}
   </div>
   ${account?`<div class="notice">كشف الحساب المستورد منفصل عن الفواتير الفعلية: الرصيد المرجعي ${reportValue(account.current_balance)}. <button type="button" class="mini-btn supplier-imported-ledger-v119">الحركات المرجعية</button></div>`:''}
   <div class="notice">حركة مخزون مواد المورد تشمل أيضًا الاستهلاك والتسويات ومشتريات الموردين الآخرين لتلك المواد؛ لا تُنسب كلها لهذا المورد. تجمع الإحصائيات المالية كل عملة على حدة، ولا تحتسب المسودات أو الفواتير الملغاة أو الفواتير التاريخية المرجعية ضمن قيمة الشراء.</div>
   <div class="supplier-tabs-v119" role="tablist" aria-label="تفاصيل المورد">
     <button type="button" class="active" data-supplier-tab="invoices">الفواتير والبنود</button>
     <button type="button" data-supplier-tab="materials">إحصائيات المواد</button>
     <button type="button" data-supplier-tab="movements">حركة مخزون المواد</button>
     <button type="button" data-supplier-tab="payments">الدفعات والتخصيصات</button>
   </div>
   <div class="card"><div class="list-toolbar"><div class="search-box"><span aria-hidden="true">⌕</span>
       <input type="search" class="supplier-detail-search-v119" placeholder="ابحث داخل التبويب حسب المادة أو رقم الفاتورة أو التاريخ"></div>
       <span class="list-count supplier-detail-count-v119"></span></div>
     <div class="supplier-tab-content-v119"></div></div>`;
  root.querySelector('.supplier-create-purchase-v119').onclick=()=>{void startSupplierInvoiceV121({supplier});};
  root.querySelector('.supplier-imported-ledger-v119')?.addEventListener('click',()=>showLedger(account));
  let selected='invoices',query='';
  const host=root.querySelector('.supplier-tab-content-v119');
  const fits=(...values)=>!query||values.some(v=>String(v||'').toLocaleLowerCase('ar').includes(query));
  const materialNamesForInvoice=invoiceId=>items.filter(x=>String(x.invoice_id)===String(invoiceId)).map(x=>x.material_name);
  const rowItems=invoiceId=>items.filter(x=>String(x.invoice_id)===String(invoiceId));
  const invoiceName=inv=>inv.invoice_number||String(inv.id).slice(0,8);
  const showTab=()=>{
   let count=0;
   if(selected==='invoices'){
    const subset=invoices.filter(inv=>fits(inv.invoice_number,inv.invoice_date,inv.status,...materialNamesForInvoice(inv.id)));
    count=subset.length;
    host.innerHTML=`<div class="supplier-invoice-list-v119">${subset.map(inv=>{
      const list=rowItems(inv.id),paid=paidByInvoice.get(String(inv.id))||0;
      const status=inv.is_voided?'ملغاة/مصححة':inv.status==='posted'?'منشورة':'مسودة';
      return `<details class="supplier-invoice-card-v119">
       <summary><span><strong>${esc(invoiceName(inv))}</strong> · ${dateOnly(inv.invoice_date||inv.occurred_at)}
        <small>${esc(status)} · ${list.length} بند</small></span>
        <span><strong>${money(inv.is_voided?(inv.voided_original_total||0):(inv.total_original||0),inv.currency_code||'SYP')}</strong>
          <small>مدفوع مخصص: ${money(paid,inv.currency_code||'SYP')}</small></span></summary>
       <div class="table-wrap"><table class="table"><thead><tr><th>المادة</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>خصم</th><th>إجمالي البند</th></tr></thead>
       <tbody>${list.map(x=>`<tr><td>${esc(x.material_name||'—')}</td>
        <td>${esc(x.quantity_purchase_unit)}</td><td>${esc(unitLabel(x.unit_code||x.unit_name||'—'))}</td>
        <td>${money(x.unit_price_original,inv.currency_code||'SYP')}</td>
        <td>${money(x.line_discount_original||0,inv.currency_code||'SYP')}</td>
        <td><strong>${money(purchaseLineTotalV119(x),inv.currency_code||'SYP')}</strong></td></tr>`).join('')||'<tr><td colspan="6">لا توجد بنود</td></tr>'}</tbody></table></div>
       <div class="supplier-invoice-actions-v119"><a class="btn secondary" href="#/purchase/${esc(inv.id)}">فتح الفاتورة وتفاصيل تعديلها</a></div></details>`;
    }).join('')||'<div class="empty">لا توجد فواتير مطابقة.</div>'}</div>`;
   }else if(selected==='materials'){
    const subset=summary.materials.filter(x=>fits(x.materialName,x.unitName));count=subset.length;
    host.innerHTML=`<div class="table-wrap"><table class="table supplier-material-stats-v119">
      <thead><tr><th>المادة</th><th>وحدة الشراء</th><th>الكمية المشتراة</th><th>عدد الفواتير</th><th>عدد البنود</th><th>قيمة البنود حسب العملة</th></tr></thead>
      <tbody>${subset.map(x=>`<tr><td>${esc(x.materialName)}</td><td>${esc(unitLabel(x.unitName))}</td>
        <td>${esc(x.quantity)}</td><td>${x.invoiceCount}</td><td>${x.lineCount}</td>
        <td>${esc(moneyByCurrency(x.amounts))}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد مواد مطابقة</td></tr>'}</tbody></table></div>`;
    registerTableExport(host.querySelector('table'),()=>({title:`مواد المورد ${supplier.name}`,
      headers:['المادة','وحدة الشراء','الكمية','عدد الفواتير','عدد البنود','القيمة حسب العملة'],
      rows:subset.map(x=>[x.materialName,x.unitName,x.quantity,x.invoiceCount,x.lineCount,moneyByCurrency(x.amounts)])}));
   }else if(selected==='movements'){
    const subset=movements.filter(x=>fits(x.material_name,x.occurred_at,x.movement_type,x.reference_type,x.note));count=subset.length;
    host.innerHTML=`<div class="table-wrap"><table class="table supplier-movement-table-v119">
      <thead><tr><th>التاريخ</th><th>المادة</th><th>نوع الحركة</th><th>الكمية بوحدة المخزون</th><th>سعر التكلفة للوحدة الأساسية</th><th>مصدر الحركة</th><th>البيان</th></tr></thead>
      <tbody>${subset.map(x=>`<tr><td>${dateOnly(x.occurred_at)}</td><td>${esc(x.material_name||'—')}</td>
       <td>${esc(x.movement_type||'—')}</td><td>${esc(x.quantity_delta_base??'—')}</td>
       <td>${x.unit_cost_base_per_base_unit==null?'غير معروف':money(x.unit_cost_base_per_base_unit,'SYP')}</td>
       <td>${esc(x.reference_type||'—')}${invMap.has(String(x.reference_id))?` · <a href="#/purchase/${esc(x.reference_id)}">فتح الفاتورة</a>`:''}</td>
       <td>${esc(x.notes||x.note||'—')}</td></tr>`).join('')||'<tr><td colspan="7">لا توجد حركات مطابقة</td></tr>'}</tbody></table></div>`;
    registerTableExport(host.querySelector('table'),()=>({title:`حركة مواد المورد ${supplier.name}`,
      headers:['التاريخ','المادة','الحركة','الكمية الأساسية','تكلفة الوحدة','المصدر','البيان'],
      rows:subset.map(x=>[x.occurred_at,x.material_name,x.movement_type,x.quantity_delta_base,x.unit_cost_base_per_base_unit??'',x.reference_type,x.notes||x.note||''])}));
   }else{
    const subset=payments.filter(x=>fits(x.occurred_at,x.payment_date,x.status,x.reference_number,x.notes));count=subset.length;
    host.innerHTML=`<div class="table-wrap"><table class="table supplier-payments-table-v119"><thead>
      <tr><th>التاريخ</th><th>الحالة</th><th>القيمة</th><th>رقم/مرجع</th><th>الفواتير المخصصة</th></tr></thead>
      <tbody>${subset.map(x=>{
       const linked=allocations.filter(a=>String(a.payment_id)===String(x.id));
       return `<tr><td>${dateOnly(x.payment_date||x.occurred_at||x.created_at)}</td><td>${esc(x.status||'—')}</td>
        <td>${x.amount_original==null?'—':money(x.amount_original,x.currency_code||'SYP')}</td>
        <td>${esc(x.reference_number||x.notes||x.id)}</td>
        <td>${linked.map(a=>`<div><a href="#/purchase/${esc(a.invoice_id)}">${esc(invoiceName(invMap.get(String(a.invoice_id))||{}))}</a> — ${money(a.amount_invoice_currency||0,invMap.get(String(a.invoice_id))?.currency_code||x.currency_code||'SYP')}</div>`).join('')||'غير مخصص'}</td></tr>`;
      }).join('')||'<tr><td colspan="5">لا توجد دفعات مسجلة للمورد</td></tr>'}</tbody></table></div>`;
    registerTableExport(host.querySelector('table'),()=>({title:`دفعات المورد ${supplier.name}`,
      headers:['التاريخ','الحالة','القيمة','العملة','المرجع','عدد التخصيصات'],
      rows:subset.map(x=>[x.payment_date||x.occurred_at||x.created_at,x.status,x.amount_original,x.currency_code,x.reference_number||x.id,allocations.filter(a=>String(a.payment_id)===String(x.id)).length])}));
   }
   root.querySelector('.supplier-detail-count-v119').textContent=`${count} سجل`;
  };
  root.querySelectorAll('[data-supplier-tab]').forEach(btn=>btn.onclick=()=>{
   root.querySelectorAll('[data-supplier-tab]').forEach(b=>b.classList.toggle('active',b===btn));
   selected=btn.dataset.supplierTab;query='';root.querySelector('.supplier-detail-search-v119').value='';showTab();
  });
  root.querySelector('.supplier-detail-search-v119').oninput=e=>{query=e.target.value.trim().toLocaleLowerCase('ar');showTab();};
  showTab();
 }catch(e){root.innerHTML=`<div class="notice rose">${esc(friendlyError(e,'تعذر تحميل ملف المورد. تأكد من تنفيذ تحديث SQL v1.0.19 أولًا.'))}</div>`;}
}
