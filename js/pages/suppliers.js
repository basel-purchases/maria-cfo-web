import * as api from '../api.js?v=0.25';
import {modal,toast,loader,friendlyError} from '../ui.js?v=0.25';
import {esc,money} from '../utils.js?v=0.25';
import {PAGE_SIZES,paginateArray,mergeSupplierRecords,supplierBalanceState,suppliersFilter,numericValue,pageInfo} from '../table-presenter-v025.js?v=0.25';

const amount=value=>value===null||value===undefined?'—':money(value,'SYP');
const reportValue=value=>esc(amount(value));

function statusBadge(account){
 switch(supplierBalanceState(account)){
  case 'unpaid':return '<span class="badge red">دين غير مسدد بحسب الأمين</span>';
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

async function showLedger(account){
 const m=modal({title:`كشف مورد: ${account.supplier_name}`,wide:true,hideActions:true,
  subtitle:`حساب الأمين ${account.external_account}. البيانات هنا مرجعية ولا تسدد تلقائيًا من الصندوق.`,
  body:`<div class="supplier-statement-summary">
    <div><span>الرصيد السابق</span><strong>${reportValue(account.previous_balance)}</strong></div>
    <div><span>إجمالي المدين بالتقرير</span><strong>${reportValue(account.total_debit)}</strong></div>
    <div><span>إجمالي الدائن بالتقرير</span><strong>${reportValue(account.total_credit)}</strong></div>
    <div><span>أوراق تجارية غير محصلة</span><strong>${reportValue(account.uncollected_papers_v025)}</strong></div>
    <div><span>الرصيد الحالي</span><strong>${reportValue(account.current_balance)}</strong></div>
  </div><div class="notice ${supplierBalanceState(account)==='unpaid'?'rose':'green'}">${supplierBalanceState(account)==='unpaid'?'يوجد رصيد موجب غير مسدد بحسب كشف الأمين. تحقق من السندات والتسويات قبل اعتماده دينًا نهائيًا.':'لا توجد إشارة إلى رصيد موجب مستحق وفق آخر كشف مستورد.'}</div>
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
      <p>جميع الحقول المستوردة من تقرير الأمين؛ والرصيد الموجب يُبرز لمراجعته دون تسجيل دفع مالي تلقائي.</p></div>
    <div class="page-head-actions"><a class="btn secondary" href="#/quick-imports">رفع كشف حساب</a><button class="btn add">إضافة مورد</button></div>
  </div>
  <div class="grid cols-3 finance-summary-grid">
    <div class="card"><strong>${all.length}</strong><div class="metric-note">عدد الموردين</div></div>
    <div class="card"><strong>${unpaid.length}</strong><div class="metric-note">موردون لديهم رصيد موجب</div></div>
    <div class="card"><strong>${esc(amount(outstanding))}</strong><div class="metric-note">إجمالي الأرصدة الموجبة من كشف الأمين</div></div>
  </div>
  <div class="notice">الأرصدة المرجعية من برنامج الأمين، ولا تعني وجود دفعات مسجلة داخل Maria CFO. تحقق من توقيت آخر كشف وأي تسويات حدثت بعده.</div>
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
    <thead><tr><th>المورد</th><th>رقم حساب الأمين</th><th>الهاتف</th><th>جهة الاتصال</th>
      <th>الرصيد السابق</th><th>مدين إجمالي</th><th>دائن إجمالي</th>
      <th>الأوراق التجارية غير المحصلة</th><th>الرصيد الحالي</th><th>الحالة</th><th>الحركات</th></tr></thead>
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
       <td>${a?`<button class="mini-btn view-supplier-ledger" data-code="${esc(a.external_account)}">عرض حركات الأمين</button>`:'—'}</td>
     </tr>`;
    }).join('')||'<tr><td colspan="11">لا توجد نتائج مطابقة.</td></tr>'}</tbody></table></div>
    ${info.pages>1?`<div class="pagination-bar">
      <button class="mini-btn suppliers-prev" ${info.page<=1?'disabled':''}>السابق</button>
      <span>${info.from}–${info.to} من ${info.total} · صفحة ${info.page} من ${info.pages}</span>
      <button class="mini-btn suppliers-next" ${info.page>=info.pages?'disabled':''}>التالي</button>
    </div>`:''}`;
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
