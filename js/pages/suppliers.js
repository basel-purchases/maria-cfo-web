import * as api from '../api.js?v=0.24';import { modal,toast,loader,friendlyError } from '../ui.js?v=0.24';import { esc } from '../utils.js?v=0.24';
export async function renderSuppliers(root){root.innerHTML=loader();try{const rows=(await api.suppliers()).filter(s=>s.notes!=='SYSTEM_DIRECT_PURCHASE'&&s.name!=='شراء مباشر');root.innerHTML=`<div class="page-head"><div><h2>الموردون</h2><p>اختياري. لا تحتاج إلى إنشاء مورد قبل فاتورة الشراء. استخدم هذا القسم فقط إذا أردت تذكر بنوده السابقة أو مقارنة أسعاره.</p></div><button class="btn add">إضافة مورد</button></div><div class="notice green">يمكن ترك المورد فارغًا في فاتورة الشراء ولن يتوقف العمل.</div>${rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الاسم</th><th>الهاتف</th><th>جهة الاتصال</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.phone||'—')}</td><td>${esc(r.contact_name||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty"><strong>لا يوجد موردون وهذا طبيعي</strong><div>أضف موردًا فقط إذا كان ذلك سيسهّل عملك.</div></div>'}`;root.querySelector('.add').onclick=()=>modal({title:'إضافة مورد - اختياري',body:`<div class="form-grid"><div class="field"><label>الاسم</label><input name="name" required></div><div class="field"><label>الهاتف</label><input name="phone"></div><div class="field"><label>جهة الاتصال</label><input name="contact"></div></div>`,onSubmit:async fd=>{try{await api.insertFirst('suppliers',[{name:fd.get('name').trim(),phone:fd.get('phone').trim()||null,contact_name:fd.get('contact').trim()||null},{name:fd.get('name').trim()}]);toast('تمت إضافة المورد','success');await renderSuppliers(root);return true;}catch(e){toast(friendlyError(e),'error');return false;}}});}catch(e){root.innerHTML=`<div class="notice">${friendlyError(e)}</div>`;}}

// v0.24: Al-Ameen statement is an external reference snapshot, not a supplier payment.
const renderSuppliersBaseV023=renderSuppliers;
export {renderSuppliersBaseV023};
export async function renderAmeenSupplierStatements(root){
  let accounts=[];
  try{accounts=await api.ameenSupplierBalancesV024();}catch(_){return;}
  const section=document.createElement('section');section.className='card ameen-supplier-box';
  section.innerHTML=`<div class="page-head"><div><h3>كشوف حساب الموردين المستوردة من الأمين</h3><p>الأرصدة والحركات المرجعية. لا تُنشئ هذه الكشوف سند صرف أو قيد صندوق تلقائيًا.</p></div><a class="btn secondary" href="#/quick-imports">استيراد كشف جديد</a></div>
   ${accounts.length?`<div class="table-wrap"><table class="table"><thead><tr><th>رقم الحساب</th><th>المورد</th><th>مدين إجمالي</th><th>دائن إجمالي</th><th>الرصيد الحالي</th><th>التفاصيل</th></tr></thead><tbody>${accounts.map(a=>`<tr><td>${esc(a.external_account)}</td><td>${esc(a.supplier_name)}</td><td>${esc(a.total_debit)}</td><td>${esc(a.total_credit)}</td><td><strong>${esc(a.current_balance)}</strong></td><td><button class="mini-btn ameen-statement" data-code="${esc(a.external_account)}">عرض الحركات</button></td></tr>`).join('')}</tbody></table></div>`:'<p>لم يُستورد كشف موردين من الأمين بعد.</p>'}`;
  root.append(section);
  section.querySelectorAll('.ameen-statement').forEach(button=>button.onclick=async()=>{
    try{
      const account=accounts.find(a=>a.external_account===button.dataset.code);
      const lines=await api.ameenSupplierEntriesV024(button.dataset.code);
      modal({title:`حركات: ${account?.supplier_name||'مورد'}`,wide:true,hideActions:true,
       body:`<div class="notice">هذه قيود تقرير الأمين المرجعية فقط؛ لا يُخصم أي مبلغ من صناديق Maria CFO.</div>
       <div class="table-wrap"><table class="table"><thead><tr><th>التاريخ</th><th>المستند</th><th>مدين</th><th>دائن</th><th>البيان</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${esc(l.occurred_at?.slice(0,10)||'')}</td><td>${esc(l.source_document||'—')}</td><td>${esc(l.debit)}</td><td>${esc(l.credit)}</td><td>${esc(l.description||'—')}</td></tr>`).join('')}</tbody></table></div>`});
    }catch(e){toast(friendlyError(e),'error');}
  });
}
// Preserve original supplier create/list form and append only the imported statement.
const previousRenderSuppliers=renderSuppliersBaseV023;
export async function renderSuppliersWithAmeen(root){
 await previousRenderSuppliers(root);
 await renderAmeenSupplierStatements(root);
}
