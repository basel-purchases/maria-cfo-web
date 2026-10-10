// Manual cashbox ledger only: never include sales, purchases, salaries or expenses.
import {datePeriod,dateInRange} from './date-range-batch.js?v=0.25';
import {todayISO} from './utils.js?v=0.25';
export function isManualCashTransaction(tx){
  const kind=String(tx.transaction_type||'').toLowerCase();
  const ref=String(tx.reference_type||'').toLowerCase();
  return ['adjustment_in','adjustment_out','transfer_in','transfer_out','adjustment','transfer'].includes(kind)
     ||['cashbox_adjustment','cashbox_transfer'].includes(ref);
}
export function filteredManualTransactions(rows,{period='day',anchor=todayISO(),box='all',direction='all'}={}){
  const {start,end}=datePeriod(period,anchor);
  return rows.filter(tx=>isManualCashTransaction(tx)&&tx.is_void!==true&&dateInRange(tx.occurred_at,start,end)
    &&(box==='all'||String(tx.cashbox_id)===String(box))
    &&(direction==='all'||String(tx.direction)===direction));
}
