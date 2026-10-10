// Monetary arithmetic preview only; PostgreSQL is the accounting authority.
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
const number=value=>Number.isFinite(Number(value))?Number(value):0;
export function calculateOrderTotals(items=[],rates={}){
  let gross=0,perItemDiscount=0,complimentary=0,subtotal=0;
  for(const item of items){
    const qty=number(item.quantity),price=number(item.unit_price_original);
    const raw=number(item.line_gross_original??qty*price);
    const type=String(item.adjustment_type||'none');
    let discount=number(item.discount_original);
    let free=number(item.complimentary_value_original);
    if(type==='complimentary'){free=raw;discount=0;}
    else if(item.discount_original==null&&(type==='percent'||type==='discount_percent')){
      discount=round4(raw*number(item.adjustment_value)/100);
    }else if(item.discount_original==null&&type==='discount_amount'){
      discount=number(item.adjustment_value);
    }
    const net=type==='complimentary'?0:number(item.line_net_original??Math.max(0,raw-discount));
    gross+=raw;perItemDiscount+=discount;complimentary+=free;subtotal+=net;
  }
  gross=round4(gross);perItemDiscount=round4(perItemDiscount);complimentary=round4(complimentary);subtotal=round4(subtotal);
  const discountRate=number(rates.discountPercent),expenditureRate=number(rates.expenditurePercent),localRate=number(rates.localPercent);
  if([discountRate,expenditureRate,localRate].some(v=>v<0||v>100))throw Error('INVALID_ORDER_RATE');
  const orderDiscount=round4(subtotal*discountRate/100);
  const discounted=round4(subtotal-orderDiscount);
  const expenditureTax=round4(discounted*expenditureRate/100);
  const localTax=round4(expenditureTax*localRate/100);
  return {
    gross,perItemDiscount,complimentary,subtotal,
    discountRate,orderDiscount,discounted,expenditureRate,expenditureTax,localRate,localTax,
    totalTax:round4(expenditureTax+localTax),collected:round4(discounted+expenditureTax+localTax),
  };
}
