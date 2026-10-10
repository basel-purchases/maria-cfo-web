import * as api from '../api.js?v=0.23';
import { modal, toast, loader, friendlyError } from '../ui.js?v=0.23';
import { esc, money, dateOnly, todayISO } from '../utils.js?v=0.23';
import { employeeName } from '../payroll-ui.js?v=0.23';

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
      out.querySelector('#adv-prev').onclick=()=>{state.page--;draw();};
      out.querySelector('#adv-next').onclick=()=>{state.page++;draw();};
    };
    root.querySelector('#advance-staff').onchange=e=>{state.employee=e.target.value;state.page=1;draw();};
    root.querySelector('#advance-status').onchange=e=>{state.status=e.target.value;state.page=1;draw();};
    root.querySelector('.add-advance').onclick=()=>modal({
      title:'\u0625\u0636\u0627\u0641\u0629 \u0633\u0644\u0641\u0629',
      body:`<div class="form-grid"><div class="field"><label>\u0627\u0644\u0645\u0648\u0638\u0641</label><select name="employee" required>${staff.filter(e=>e.status==='active').map(e=>`<option value="${esc(e.id)}">${esc(e.name)} (${esc(e.wage_currency_code||'SYP')})</option>`).join('')}</select></div>
      <div class="field"><label>\u0627\u0644\u0635\u0646\u062f\u0648\u0642</label><select name="cashbox" required>${boxes.filter(x=>x.is_active!==false).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>\u0627\u0644\u0645\u0628\u0644\u063a</label><input name="amount" type="number" min="0.0001" step="any" required></div>
      <div class="field"><label>\u0627\u0644\u062e\u0635\u0645</label><select name="repayment"><option value="installments">\u0623\u0642\u0633\u0627\u0637</option><option value="full_next_payroll">\u0627\u0644\u0631\u0627\u062a\u0628 \u0627\u0644\u0642\u0627\u062f\u0645</option><option value="manual">\u064a\u062f\u0648\u064a</option></select></div>
      <div class="field"><label>\u0645\u0628\u0644\u063a \u0627\u0644\u0642\u0633\u0637</label><input name="installment" type="number" min="0.0001" step="any" required></div>
      <div class="field"><label>\u0627\u0644\u062a\u0627\u0631\u064a\u062e</label><input name="date" type="date" value="${todayISO()}" required></div>
      <div class="field full"><label>\u0645\u0644\u0627\u062d\u0638\u0629</label><input name="note"></div></div>`,
      onSubmit:async fd=>{try{
        const amount=Number(fd.get('amount')), mode=fd.get('repayment'),part=Number(fd.get('installment'));
        if(!(amount>0)||mode==='installments'&&(!(part>0)||part>amount))throw Error('INVALID_ADVANCE_AMOUNT');
        await api.recordEmployeeAdvance({employeeId:fd.get('employee'),cashboxId:fd.get('cashbox'),amount,repaymentMode:mode,installment:mode==='installments'?part:null,date:fd.get('date'),note:fd.get('note')});
        toast('\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0633\u0644\u0641\u0629','success');await renderAdvances(root);return true;
      }catch(e){toast(friendlyError(e),'error');return false;}}
    });
    draw();
    // Installment amount is mandatory ONLY when the selected repayment policy is installments.
    // Avoid blocking a full-next-payroll or manually settled advance with an irrelevant required field.
    const previousAdd=root.querySelector('.add-advance').onclick;
    root.querySelector('.add-advance').onclick=()=>{
      previousAdd();
      const dialog=document.querySelector('.modal-backdrop');
      if(!dialog)return;
      const mode=dialog.querySelector('select[name=repayment]'),value=dialog.querySelector('input[name=installment]');
      if(!mode||!value)return;
      const sync=()=>{value.required=mode.value==='installments';value.disabled=mode.value!=='installments';};
      mode.addEventListener('change',sync);sync();
    };
  }catch(e){root.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
}
