/** Testable calendar math matching the v1.0.27 SQL hourly divisor.
 * The database remains authoritative; this helper never posts payroll values.
 */
export function scheduleMonthV127({year,month,dailyHours=8,weeklySchedule=null}){
 if(!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12)
  throw Error('الشهر أو السنة غير صالحين.');
 const days=new Date(Date.UTC(year,month,0)).getUTCDate();
 const hours=Number(dailyHours);
 if(!Number.isFinite(hours)||hours<=0||hours>24)throw Error('ساعات الدوام غير صالحة.');
 let workdays=0,monthlyHours=0;
 for(let day=1;day<=days;day++){
  const dow=new Date(Date.UTC(year,month-1,day)).getUTCDay();
  if(dow===5)continue; // Friday is always a holiday for hourly adjustment pricing.
  const shift=weeklySchedule ? weeklySchedule[dow] : hours;
  const value=Number(shift??0);
  if(!Number.isFinite(value)||value<0||value>24)throw Error('جدول الدوام غير صالح.');
  if(value>0){workdays++;monthlyHours+=value;}
 }
 return {workdays,monthlyHours};
}
export function hourBasedAdjustmentV127({salary,workHours,hours}){
 const wage=Number(salary),total=Number(workHours),quantity=Number(hours);
 if(!Number.isFinite(wage)||wage<=0||!Number.isFinite(total)||total<=0||
    !Number.isFinite(quantity)||quantity<=0||quantity>744||Math.abs(quantity*100-Math.round(quantity*100))>1e-7)
   throw Error('الراتب أو ساعات الدوام أو ساعات التسوية غير صالحة.');
 return {hourlyRate:wage/total,amount:Math.round((wage/total*quantity+Number.EPSILON)*10000)/10000};
}
