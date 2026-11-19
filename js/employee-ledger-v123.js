// Pure employee profile projections. Keep all monetary amounts in the salary currency.
export const generalCashboxV123 = boxes =>
  (Array.isArray(boxes)?boxes:[]).find(box=>box.is_general===true&&box.is_active!==false)||null;

export const visibleEmployeesV123 = employees =>
  (Array.isArray(employees)?employees:[]).filter(employee=>employee.archived_v123!==true);

export function adjustmentKindV123(row){
  if(row.adjustment_type==='deduction')return 'deduction';
  if(String(row.reason||'').startsWith('ADDITION_V123:'))return 'addition';
  return 'bonus';
}
export function adjustmentLabelV123(row){
  return adjustmentKindV123(row)==='deduction'?'\u062e\u0635\u0645':
    adjustmentKindV123(row)==='addition'?'\u0625\u0636\u0627\u0641\u0629':'\u0645\u0643\u0627\u0641\u0623\u0629';
}
export function adjustmentReasonV123(row){
  return String(row.reason||'').replace(/^(?:ADDITION_V123: |DEDUCTION_V123: )/,'');
}
export function employeeTotalsV123(adjustments,employeeId,month){
  const result={additions:0,deductions:0,bonuses:0};
  for(const row of (adjustments||[])){
    if(String(row.employee_id)!==String(employeeId)||row.status==='voided'||
        !String(row.effective_date||'').startsWith(month))continue;
    const amount=Number(row.amount_original||0);
    if(!Number.isFinite(amount)||amount<=0)continue;
    const kind=adjustmentKindV123(row);
    if(kind==='deduction')result.deductions+=amount;
    else if(kind==='addition')result.additions+=amount;
    else result.bonuses+=amount;
  }
  return result;
}
export function employeeLeaveCountV123(leaves,employeeId,year){
  return (leaves||[]).filter(row=>String(row.employee_id)===String(employeeId)
    &&String(row.work_date||'').startsWith(year)
    &&['paid_leave','unpaid_leave'].includes(row.status)).length;
}
export function employeeLeaveNameV123(status){
  const labels={paid_leave:'\u0625\u062c\u0627\u0632\u0629 \u0645\u062f\u0641\u0648\u0639\u0629',unpaid_leave:'\u0625\u062c\u0627\u0632\u0629 \u063a\u064a\u0631 \u0645\u062f\u0641\u0648\u0639\u0629',absent:'\u063a\u064a\u0627\u0628'};
  return labels[status]||status||'';
}
