import { esc, money, dateOnly } from './utils.js?v=0.25';

export const PAY_LABELS = Object.freeze({monthly:'شهري', daily:'يومي', hourly:'ساعي', fixed:'مقطوع'});
export function payTypeBadge(type) {
  const className = ['monthly','daily','hourly','fixed'].includes(type) ? type : 'unknown';
  return `<span class="pay-type-badge pay-${className}">${esc(PAY_LABELS[type] || type || '—')}</span>`;
}
export function employeeName(name,type){
  return `<span class="employee-identity"><strong>${esc(name||'موظف')}</strong>${payTypeBadge(type)}</span>`;
}
export function currenciesSummary(items,amountKey='estimated_due_original',currencyKey='currency_code') {
  const sums = new Map();
  for (const item of items) {
    const amount=Number(item[amountKey]);
    if(!Number.isFinite(amount)||amount<=0) continue;
    const currency=item[currencyKey]||'SYP';
    sums.set(currency,(sums.get(currency)||0)+amount);
  }
  return [...sums].map(([currency,amount])=>`<span class="pay-total-chip">${money(amount,currency)}</span>`).join(' ')||'لا يوجد مبلغ مستحق';
}
export function payrollDate(value){return dateOnly(value);}
