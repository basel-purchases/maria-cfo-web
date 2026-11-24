// Event ticket installments. The server is authoritative for balances and cash posting.
const value = x => Number(x);
export function installmentCheckV139(total, paid, incoming) {
  const t=value(total), p=value(paid), n=value(incoming);
  if (![t,p,n].every(Number.isFinite) || t < 0 || p < 0 || n < 0 || p > t + 0.00005)
    return {ok:false, reason:'قيمة التذكرة أو المقبوض غير صحيحة.'};
  if (n > t-p+0.00005) return {ok:false, reason:'القسط أكبر من الرصيد المتبقي.'};
  if (n !== Math.round(n*10000)/10000) return {ok:false,reason:'أقصى دقة للمبلغ أربع خانات عشرية.'};
  return {ok:true, remaining:Math.max(0, Math.round((t-p-n)*10000)/10000), paid:Math.round((p+n)*10000)/10000};
}
export function bookingInstallmentStatusV139(total, paid, due, nextDate=null, today='') {
  const t=Math.max(0,value(total)||0), p=Math.max(0,value(paid)||0), d=Math.max(0,value(due)||0);
  if (t===0) return 'بلا سعر';
  if (d <= .00005) return 'مدفوع بالكامل';
  if (nextDate && today && String(nextDate)<String(today)) return 'قسط متأخر';
  if (p > .00005) return 'تقسيط · دفع جزئي';
  return 'بانتظار الدفعة الأولى';
}
export const outstandingTicketAmountV139 = (balance) => Math.max(0, value(balance?.balance_original)||0);
