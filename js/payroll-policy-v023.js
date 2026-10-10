export function salaryPeriod(kind,day){
  const d=new Date(String(day)+'T12:00:00Z');
  if(!Number.isFinite(d.getTime())) throw new Error('INVALID_DATE');
  const iso=x=>x.toISOString().slice(0,10);
  if(kind==='year')return {start:`${day.slice(0,4)}-01-01`,end:`${day.slice(0,4)}-12-31`};
  if(kind==='month')return {start:`${day.slice(0,7)}-01`,end:iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)))};
  return {start:String(day),end:String(day)};
}
export function suggestedAdvanceDeduction(advances,employeeId,maximum){
  let available=Math.max(0,Number(maximum)||0);let total=0;
  for(const a of advances.filter(x=>x.employee_id===employeeId && x.status==='open').sort((a,b)=>String(a.occurred_at).localeCompare(String(b.occurred_at)))){
    const remaining=Number(a.remaining_original)||0;
    const wanted=a.repayment_mode==='installments'?Math.min(remaining,Number(a.installment_amount_original)||0):a.repayment_mode==='full_next_payroll'?remaining:0;
    const use=Math.max(0,Math.min(wanted,available));total+=use;available-=use;
  }
  return total;
}
export const requiresAttendance=type=>type!=='fixed';
