// v0.34: pure payroll presentation logic. Financial amounts are snapshots from the server.
export const monthStartV034=(year,month)=>{
 const y=Number(year),m=Number(month);
 if(!Number.isInteger(y)||y<2000||y>2200||!Number.isInteger(m)||m<1||m>12)throw Error('INVALID_MONTH');
 return `${y}-${String(m).padStart(2,'0')}-01`;
};
export const currencyGroupsV034=(rows,valueField)=>{
 const map=new Map();
 for(const row of rows){const code=String(row.currency_code||'SYP'),v=Number(row[valueField]||0);if(!Number.isFinite(v))continue;map.set(code,(map.get(code)||0)+v);}
 return [...map].map(([currency_code,amount])=>({currency_code,amount}));
};
export function normalizedPayrollRowV034(row){
 const base=Number(row.base_pay_original||0),overtime=Number(row.overtime_pay_original||0);
 const bonuses=Number(row.bonus_original||0);
 const shortage=Number(row.shortage_deduction_original||0);
 const deductions=Number(row.manual_deduction_original||0);
 const advances=Number(row.advance_deduction_original||0);
 const net=Number(row.net_due_original||0),paid=Number(row.paid_original||0),remaining=Number(row.remaining_original??(net-paid));
 return {...row,base,overtime,bonuses,shortage,deductions,advances,net,paid,remaining:Math.max(0,remaining),
  payable:['approved','closed'].includes(row.run_status)&&remaining>0.0001&&Number(row.missing_attendance_days||0)===0,
  isDraft:row.run_status==='draft'};
}
export function filterPayrollReadyV034(rows,query=''){
 const q=String(query||'').trim().normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').toLowerCase();
 return rows.map(normalizedPayrollRowV034).filter(r=>{
  if(!(r.isDraft||r.remaining>0.0001))return false;
  const name=String(r.employee_name||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').toLowerCase();
  return !q||name.includes(q);
 });
}
export function payrollReconciliationV034(rows){
 return currencyGroupsV034(rows.map(normalizedPayrollRowV034).filter(r=>r.payable),'remaining');
}
