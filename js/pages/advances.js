import * as api from '../api.js?v=1.0.28';
import { modal, toast, loader, friendlyError } from '../ui.js?v=1.0.23';
import {currencyLabel, esc, money, dateOnly, todayISO } from '../utils.js?v=1.0';
import { employeeName } from '../payroll-ui.js?v=1.0';
import {registerTableExport} from '../table-export-v027.js?v=1.0';
import {generalCashboxV123} from '../employee-ledger-v123.js?v=1.0.23';
import {dateInEmployeeServiceV128} from '../employee-service-v128.js?v=1.0.28';

const SIZE=15;
export async function renderAdvances(root){
  root.innerHTML=loader();
  try{
    const [staff, advances, boxes, deductions, fixedDeductions]=await Promise.all([
      api.employees(),api.employeeAdvances(),api.cashboxes(),api.advanceDeductions(),api.fixedAdvanceDeductionsV023()
    ]);
    const em=new Map(staff.map(x=>[String(x.id),x]));
    const bm=new Map(boxes.map(x=>[String(x.id),x.name]));
    const deductionByAdvance=new Map();
    for(const row of deductions){
      if(row.status!=='applied')continue;
      const key=String(row.advance_id);
      deductionByAdvance.set(key,(deductionByAdvance.get(key)||0)+Number(row.amount_original||0));
    }
    for(const row of fixedDeductions){const key=String(row.advance_id);deductionByAdvance.set(key,(deductionByAdvance.get(key)||0)+Number(row.amount_original||0));}
    const state={employee:'',status:'all',page:1};
    root.innerHTML=`<div class="page-head"><div><h2>\u0633\u0644\u0641 \u0627\u0644\u0645\u0648\u0638\u0641\u064a\u0646</h2>
      <p>\u0627\u0644\u0633\u0644\u0641\u0629 \u062d\u0631\u0643\u0629 \u0646\u0642\u062f\u064a\u0629 \u0645\u0646 \u0627\u0644\u0635\u0646\u062f\u0648\u0642\u060c \u0648\u0627\u0644\u0627\u0642\u062a\u0637\u0627\u0639 \u064a\u064f\u0639\u062a\u0645\u062f \u0641\u064a \u0645\u0633\u064a\u0631 \u0627\u0644\u0631\u0648\u0627\u062a\u0628.</p></div>
      <button class="btn add-advance">\u0633\u0644\u0641\u0629 \u062c\u062f\u064a\u062f\u0629</button></div>
      <div class="card"><div class="form-grid"><div class="field"><label>\u0627\u0644\u0645\u0648\u0638\u0641</label><select id="advance-staff">
      <option value="">\u0627\u0644\u062c\u0645\u064a\u0639</option>${staff.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></div>
      <div class="field"><label>\u0627\u0644\u062d\u0627\u0644\u0629</label><select id="advance-status"><option value="all">\u0627\u0644\u062c\u0645\u064a\u0639</option><option value="open">\u0633\u0644\u0641 \u0645\u0641\u062a\u0648\u062d\u0629</option><option value="settled">\u0645\u0633\u062f\u062f\u0629</option></select></div></div></div>
      <div class="card"><div id="advance-table"></div></div>`;
    const out=root.querySelector('#advance-table');
    const draw=()=>{
      const items=advances.filter(r=>(!state.employee||r.employee_id===state.employee)&&(state.status==='all'||r.status===state.status));
      const pageCount=Math.max(1,Math.ceil(items.length/SIZE));state.page=Math.min(state.page,pageCount);
      const show=items.slice((state.page-1)*SIZE,state.page*SIZE);
      const groups=new Map();for(const x of items){const code=x.currency_code||'SYP';const v=Number(x.remaining_original)||0;groups.set(code,(groups.get(code)||0)+v);}
      out.innerHTML=`<div class="finance-section-head"><h3>\u0631\u0635\u064a\u062f \u0627\u0644\u0633\u0644\u0641 \u0627\u0644\u0645\u062a\u0628\u0642\u064a</h3>
      <div>${[...groups].map(([code,val])=>`<strong class="pay-total-chip">${money(val,code)}</strong>`).join(' ')||'\u0644\u0627 \u064a\u0648\u062c\u062f'}</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>\u0627\u0644\u0645\u0648\u0638\u0641</th><th>\u0627\u0644\u062a\u0627\u0631\u064a\u062e</th><th>\u0627\u0644\u0633\u0644\u0641\u0629</th><th>\u062e\u0635\u0645 \u0645\u0646 \u0627\u0644\u0631\u0627\u062a\u0628</th><th>\u0627\u0644\u0645\u0637\u0628\u0642</th><th>\u0627\u0644\u0628\u0627\u0642\u064a</th><th>\u0627\u0644\u0635\u0646\u062f\u0648\u0642</th></tr></thead><tbody>
      ${show.map(r=>{const e=em.get(String(r.employee_id));return `<tr><td>${employeeName(e?.name||'?',e?.pay_type)}</td><td>${dateOnly(r.occurred_at)}</td><td>${money(r.principal_original,r.currency_code)}</td><td>${r.repayment_mode==='installments'?money(r.installment_amount_original,r.currency_code):r.repayment_mode==='manual'?'\u064a\u062f\u0648\u064a':'\u0627\u0644\u062f\u0641\u0639\u0629 \u0627\u0644\u0642\u0627\u062f\u0645\u0629'}</td><td>${money(deductionByAdvance.get(String(r.id))||0,r.currency_code)}</td><td><strong>${money(r.remaining_original,r.currency_code)}</strong></td><td>${esc(bm.get(String(r.cashbox_id))||'\u2014')}</td></tr>`;}).join('')||'<tr><td colspan="7">\u0644\u0627 \u062a\u0648\u062c\u062f \u0633\u0644\u0641</td></tr>'}</tbody></table></div>
      <div class="pagination-bar"><button class="mini-btn" id="adv-prev" ${state.page<=1?'disabled':''}>\u0627\u0644\u0633\u0627\u0628\u0642</button><span>${state.page} / ${pageCount} \u2014 ${items.length}</span><button class="mini-btn" id="adv-next" ${state.page>=pageCount?'disabled':''}>\u0627\u0644\u062a\u0627\u0644\u064a</button></div>`;
      registerTableExport(out.querySelector('table'),()=>({
        title:'سلف الموظفين - حسب الفلتر',
        headers:['الموظف','التاريخ','السلفة','الخصم من الراتب','المطبق','الباقي','الصندوق'],
        rows:items.map(r=>{const e=em.get(String(r.employee_id));return [employeeName(e?.name||'?',e?.pay_type),dateOnly(r.occurred_at),Number(r.principal_original||0),r.repayment_mode==='installments'?Number(r.installment_amount_original||0):r.repayment_mode==='manual'?'يدوي':'الراتب القادم',Number(deductionByAdvance.get(String(r.id))||0),Number(r.remaining_original||0),bm.get(String(r.cashbox_id))||''];})
      }));
      out.querySelector('#adv-prev').onclick=()=>{state.page--;draw();};
      out.querySelector('#adv-next').onclick=()=>{state.page++;draw();};
    };
    root.querySelector('#advance-staff').onchange=e=>{state.employee=e.target.value;state.page=1;draw();};
    root.querySelector('#advance-status').onchange=e=>{state.status=e.target.value;state.page=1;draw();};
    root.querySelector('.add-advance').onclick=()=>openEmployeeAdvanceModalV123({staff,boxes,onSaved:()=>renderAdvances(root)});
    draw();
  }catch(e){root.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
}

// Shared by the advances section and the selected employee's profile.
export function openEmployeeAdvanceModalV123({staff=[],boxes=[],employeeId='',onSaved=()=>{}}={}){
  const active=staff.filter(e=>e.status==='active'&&e.archived_v123!==true);
  const available=boxes.filter(b=>b.is_active!==false);
  if(!active.length||!available.length){toast('\u064a\u062c\u0628 \u0648\u062c\u0648\u062f \u0645\u0648\u0638\u0641 \u0648\u0635\u0646\u062f\u0648\u0642 \u0646\u0634\u0637.','error');return null;}
  const general=generalCashboxV123(available);
  const m=modal({title:'\u0625\u0636\u0627\u0641\u0629 \u0633\u0644\u0641\u0629',
    subtitle:'\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u062f\u0641\u0639 \u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a \u0647\u0648 \u0627\u0644\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u0639\u0627\u0645. \u062a\u0633\u062c\u0644 \u0627\u0644\u0633\u0644\u0641\u0629 \u062d\u0631\u0643\u0629 \u0646\u0642\u062f\u064a\u0629 \u0641\u0648\u0631\u064a\u0629.',
    body:`<div class="form-grid">
      <div class="field"><label>\u0627\u0644\u0645\u0648\u0638\u0641</label><select name="employee" required>${active.map(e=>`<option value="${esc(e.id)}">${esc(e.name)} (${esc(currencyLabel(e.wage_currency_code||'SYP'))})</option>`).join('')}</select></div>
      <div class="field"><label>\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u062f\u0641\u0639</label><select name="cashbox" required>${available.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}${b.is_general?' · \u0627\u0644\u0639\u0627\u0645':''}</option>`).join('')}</select></div>
      <div class="field"><label>\u0645\u0628\u0644\u063a \u0627\u0644\u0633\u0644\u0641\u0629</label><input name="amount" type="number" min="0.0001" step="any" required></div>
      <div class="field"><label>\u0627\u0644\u062a\u0633\u062f\u064a\u062f</label><select name="repayment"><option value="full_next_payroll">\u062e\u0635\u0645\u0647\u0627 \u0645\u0646 \u0627\u0644\u0631\u0627\u062a\u0628 \u0627\u0644\u0642\u0627\u062f\u0645</option><option value="installments">\u0623\u0642\u0633\u0627\u0637</option><option value="manual">\u064a\u062f\u0648\u064a</option></select></div>
      <div class="field"><label>\u0645\u0628\u0644\u063a \u0627\u0644\u0642\u0633\u0637</label><input name="installment" type="number" min="0.0001" step="any"></div>
      <div class="field"><label>\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0633\u0644\u0641\u0629</label><input name="date" type="date" required></div>
      <div class="field full"><label>\u0645\u0644\u0627\u062d\u0638\u0629</label><textarea name="note" rows="2" maxlength="300"></textarea></div></div>
      ${general?'':'<div class="notice rose">\u0644\u0627 \u064a\u0648\u062c\u062f \u0635\u0646\u062f\u0648\u0642 \u0639\u0627\u0645 \u0646\u0634\u0637. \u0627\u062e\u062a\u0631 \u0635\u0646\u062f\u0648\u0642\u0627\u064b \u064a\u062f\u0648\u064a\u0627\u064b.</div>'}`,
    submitText:'\u062d\u0641\u0638 \u0627\u0644\u0633\u0644\u0641\u0629',
    onSubmit:async fd=>{
      try{
        const amount=Number(fd.get('amount')),mode=fd.get('repayment'),part=Number(fd.get('installment'));
        if(!Number.isFinite(amount)||amount<=0||mode==='installments'&&(!Number.isFinite(part)||part<=0||part>amount))
          throw Error('INVALID_ADVANCE_AMOUNT');
        const person=active.find(e=>String(e.id)===String(fd.get('employee')));
        if(!dateInEmployeeServiceV128(person,String(fd.get('date')||'')))throw Error('تاريخ السلفة خارج فترة عمل الموظف (التعيين حتى الانتهاء).');
        await api.recordEmployeeAdvanceV128({employeeId:fd.get('employee'),cashboxId:fd.get('cashbox'),amount,
          repaymentMode:mode,installment:mode==='installments'?part:null,date:fd.get('date'),note:fd.get('note')});
        toast('\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u0633\u0644\u0641\u0629 \u0648\u062e\u0635\u0645\u0647\u0627 \u0645\u0646 \u0627\u0644\u0635\u0646\u062f\u0648\u0642.','success');
        await onSaved();return true;
      }catch(e){toast(/V128_ADVANCE_OUTSIDE_EMPLOYMENT/.test(String(e?.message||''))?'السلفة خارج فترة خدمة الموظف.':
       /record_employee_advance_v128|PGRST202/i.test(String(e?.message||''))?'يلزم تطبيق SQL v1.0.28 قبل تسجيل السلف.':friendlyError(e),'error');return false;}
    }
  });
  const employeeSelect=m.form.elements.namedItem('employee');
  const dateInput=m.form.elements.namedItem('date');
  if(employeeId&&active.some(e=>String(e.id)===String(employeeId)))employeeSelect.value=String(employeeId);
  const syncServiceDate=()=>{
   const person=active.find(e=>String(e.id)===String(employeeSelect.value));
   if(!person)return;
   if(person.hire_date)dateInput.min=person.hire_date;else dateInput.removeAttribute('min');
   if(person.termination_date)dateInput.max=person.termination_date;else dateInput.removeAttribute('max');
   if(!dateInEmployeeServiceV128(person,dateInput.value))dateInput.value=dateInEmployeeServiceV128(person,todayISO())?todayISO():'';
  };
  employeeSelect.addEventListener('change',syncServiceDate);syncServiceDate();
  if(general)m.form.elements.namedItem('cashbox').value=String(general.id);
  const mode=m.form.elements.namedItem('repayment');const installment=m.form.elements.namedItem('installment');
  const sync=()=>{installment.required=mode.value==='installments';installment.disabled=!installment.required;};
  mode.addEventListener('change',sync);sync();
  return m;
}
