// A cashbox is a persistent money balance; a new date is not a cash movement.
// Refuse incomplete server results instead of displaying a misleading zero.
export function validateCashboxOverviewV124(overview){
  if(!Array.isArray(overview))throw new Error('V124_CASHBOX_OVERVIEW_NOT_ARRAY');
  for(const entry of overview){
    if(!entry?.cashbox?.id)throw new Error('V124_CASHBOX_MISSING_ID');
    const balance=entry?.summary?.live_balance_base_v124;
    if(balance===null||balance===undefined||balance===''||!Number.isFinite(Number(balance)))
      throw new Error('V124_CASHBOX_BALANCE_MISSING');
  }
  return overview;
}
