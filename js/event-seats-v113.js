// v1.0.13: target people are the seat limit, independent of physical tables.
const n=v=>Number.isFinite(Number(v))?Number(v):0;
export function seatReservationDashboardV113(event={},bookings=[],balances=[]){
  const capacity=Math.max(0,Math.floor(n(event.planned_guest_count)));
  const active=bookings.filter(b=>!['cancelled','no_show'].includes(b.status));
  const reserved=active.reduce((sum,b)=>sum+Math.max(0,Math.floor(n(b.guest_count))),0);
  const ids=new Set(active.map(b=>String(b.id)));
  const received=balances.filter(b=>ids.has(String(b.booking_id))).reduce((sum,b)=>sum+n(b.paid_original),0);
  const due=balances.filter(b=>ids.has(String(b.booking_id))).reduce((sum,b)=>sum+n(b.balance_original),0);
  const expected=active.reduce((sum,b)=>sum+n(b.agreed_amount_original),0);
  return {target:capacity,capacity,reserved,available:Math.max(0,capacity-reserved),
    openCapacity:Math.max(0,capacity-reserved),remainingTarget:Math.max(0,capacity-reserved),
    physicallyEmpty:Math.max(0,capacity-reserved),bookedTableVacancies:0,
    bookings:active.length,expected,received,due};
}
export function seatPlanV113(people){
  const target=Math.max(0,Math.floor(n(people)));
  // A single group for old per_n_people food cost formulas, NOT a table.
  return {target,capacity:target,assigned:target,unseated:0,
    tables:target?[{planned_guest_count:target,capacity:target,status:'available'}]:[]};
}
export function seatBookingCheckV113(guestCount,available){
  const count=Number(guestCount);
  if(!Number.isInteger(count)||count<1||count>1000)return {ok:false,reason:'حدد عدد أشخاص صحيحًا (1 إلى 1000).'};
  if(count>available)return {ok:false,reason:`المقاعد المتاحة ${available} فقط؛ لا يمكن حجز ${count} مقاعد.`};
  return {ok:true};
}
