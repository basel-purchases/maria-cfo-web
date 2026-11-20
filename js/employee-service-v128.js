// Maria CFO v1.0.28: pure policy helpers. Service dates are inclusive.
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function validServiceDateV128(date){
 if(!ISO_DATE.test(String(date||'')))return false;
 const test=new Date(`${date}T12:00:00Z`);
 return Number.isFinite(test.getTime())&&test.toISOString().slice(0,10)===date;
}
export function periodFromPayrollDateV128(value){
 const date=String(value||'');
 if(!validServiceDateV128(date))throw Error('اختر تاريخًا صحيحًا لشهر المسير.');
 const year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
 if(year<2000||year>2200)throw Error('اختر تاريخًا بين عامي 2000 و2200.');
 return {year,month,start:`${date.slice(0,7)}-01`};
}
export function dateInEmployeeServiceV128(employee,date){
 if(!validServiceDateV128(date))return false;
 const start=employee?.hire_date||null,end=employee?.termination_date||null;
 return (!start||date>=start)&&(!end||date<=end);
}
export function employeeServiceDateInputV128(employee){
 const min=validServiceDateV128(employee?.hire_date)?` min="${employee.hire_date}"`:'';
 const max=validServiceDateV128(employee?.termination_date)?` max="${employee.termination_date}"`:'';
 return min+max;
}
export function outstandingAdvancesByEmployeeV128(rows){
 const result=new Map();
 for(const row of rows||[]){
  const employeeId=String(row.employee_id||''),currency=String(row.currency_code||'SYP');
  const remaining=Number(row.remaining_original);
  if(!employeeId||!Number.isFinite(remaining)||remaining<=0)continue;
  if(!result.has(employeeId))result.set(employeeId,new Map());
  const wallet=result.get(employeeId);wallet.set(currency,(wallet.get(currency)||0)+remaining);
 }
 return result;
}
// Draft allocations are only planned; approved deductions are already reflected
// in employee_advances.remaining_original and must never be subtracted again.
export function advanceRemainingAfterPayrollV128(currentOutstanding,plannedDeduction,runStatus){
 const current=Math.max(0,Number(currentOutstanding)||0);
 if(runStatus!=='draft')return current;
 return Math.max(0,current-Math.max(0,Number(plannedDeduction)||0));
}
