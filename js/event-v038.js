// v0.38: deterministic UI math. The server remains authoritative for funds and seating.
const n=x=>{const y=Number(x);return Number.isFinite(y)?y:0;};
export const roundHundredUpV038=x=>Math.ceil(Math.max(0,n(x))/100-1e-10)*100;
export const roundMoneyUpV038=(x,currency='SYP')=>currency==='SYP'?Math.ceil(n(x)-1e-9):Math.ceil(n(x)*100-1e-8)/100;
export const normalizeTicketV038=(x,currency='SYP')=>roundMoneyUpV038(x,currency);
export function eventMoneyV038(x,currency='SYP'){
 const value=roundMoneyUpV038(x,currency);
 return new Intl.NumberFormat('en-US',{maximumFractionDigits:currency==='SYP'?0:2,minimumFractionDigits:0}).format(value===0?0:value)+' '+(currency==='SYP'?'ل.س':currency);
}
export function bookingPriceV038(guests,unitPrice){
 const count=Number(guests),price=Number(unitPrice);
 if(!Number.isInteger(count)||count<1||count>1000||!Number.isFinite(price)||price<0)throw Error('EVENT_BOOKING_PRICE_INVALID');
 return Math.round(price*count*10000)/10000;
}
export function ticketFromMarginV038(totalBase,guests,margin,fx=1,currency='SYP'){
 const cost=Number(totalBase),people=Number(guests),m=Number(margin),rate=Number(fx);
 if(!(cost>=0)||!(people>0)||!(rate>0)||!(m>=0&&m<95))return null;
 const raw=cost/people/(1-m/100)/rate;
 return currency==='SYP'?roundHundredUpV038(raw):Math.ceil(raw*100-1e-8)/100;
}
export function marginFromTicketV038(totalBase,guests,ticket,fx=1){
 const revenue=n(guests)*n(ticket)*n(fx);
 return revenue>0?(revenue-n(totalBase))*100/revenue:null;
}
export function eventGuestSummaryV038(primary,guestNames=[],count=0){
 const main=String(primary||'').trim(),all=guestNames.map(x=>String(x||'').trim()).filter(Boolean);
 const unique=all.filter(x=>x!==main&&!new RegExp('^مع\\s+'+main.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\s+[0-9٠-٩]+)?$','u').test(x));
 const others=Math.max(0,Number(count||all.length)-1-unique.length);
 return [main,unique.length?unique.join('، '):'',others?`${others} ${others===1?'شخص':others===2?'مرافقان':'أشخاص'} مع ${main}`:''].filter(Boolean).join(' · ');
}
export function normalizeTableSearchV038(v){
 return String(v??'').toLowerCase().trim().replace(/[٠-٩]/g,x=>String(x.charCodeAt(0)-1632))
 .replace(/[۰-۹]/g,x=>String(x.charCodeAt(0)-1776)).replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي')
 .replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ');
}
export function validateTableDistributionV038(tables,allocations,guests){
 const expected=Number(guests);
 if(!Number.isInteger(expected)||expected<1||expected>1000)return {ok:false,reason:'حدد عدد ضيوف صحيحًا.'};
 if(!Array.isArray(allocations)||!allocations.length)return {ok:false,reason:'اختر طاولة واحدة على الأقل.'};
 const seen=new Set();let sum=0;
 for(const r of allocations){
  const t=tables.find(x=>String(x.id)===String(r.table_id)),count=Number(r.guests);
  if(!t||t.booking_id||['cancelled','completed'].includes(t.status))return {ok:false,reason:'إحدى الطاولات لم تعد متاحة.'};
  if(seen.has(String(r.table_id)))return {ok:false,reason:'لا يمكن اختيار الطاولة نفسها مرتين.'};
  seen.add(String(r.table_id));
  if(!Number.isInteger(count)||count<1||count>Number(t.capacity))return {ok:false,reason:`عدد المقاعد غير صحيح في ${t.table_label}. سعتها ${t.capacity}.`};
  sum+=count;
 }
 if(sum!==expected)return {ok:false,reason:`وُزّع ${sum} من أصل ${expected} ضيوف؛ المتبقي ${expected-sum}.`};
 return {ok:true,assigned:sum};
}
export const EVENT_BOOKING_STATUS_AR_V038={reserved:'محجوز',confirmed:'مؤكد',checked_in:'حضر',seated:'جالسون',completed:'مكتمل',cancelled:'ملغى',no_show:'لم يحضر',paid:'مدفوع',pending:'قيد الانتظار',partially_paid:'دفع جزئي'};
