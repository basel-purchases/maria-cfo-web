// v1.0.29: presentation helpers; all amounts and allocations originate from SQL.
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const dateLabel = d => validDate(d) ? String(d).split('-').reverse().join('/') : String(d || '');

export function readablePayrollNoteV129(value) {
 return String(value ?? '').split(/\s*\|\s*/).map(part => {
  const s = part.trim();
  let m = s.match(/^FINAL_MONTH_AUTO_V123:(\d{4}-\d{2}-\d{2})$/);
  if (m) return `راتب شهر انتهاء الخدمة محسوب تلقائيًا حتى ${dateLabel(m[1])}`;
  m = s.match(/^FINAL_MONTH_V123:(\d{4}-\d{2}-\d{2}):(\d+)\/(\d+)$/);
  if (m) return `راتب شهر انتهاء الخدمة حتى ${dateLabel(m[1])} · الأيام المستحقة ${m[2]} من ${m[3]}`;
  return s;
 }).filter(Boolean).join(' | ');
}

export function recentFirstMonthsV129(names) {
 return names.map((name,i)=>({month:i+1,name})).reverse();
}

export function eligibleBulkPayrollV129(rows, excluded = []) {
 const exceptions = new Set([...excluded].map(String));
 const seen = new Set();
 const eligible = [];
 for (const row of rows) {
  const id = String(row.payroll_item_id || '');
  if (!row.payable || !id || seen.has(id)) continue;
  seen.add(id);
  if (!exceptions.has(id)) eligible.push(row);
 }
 return eligible;
}

export function bulkTotalsV129(rows) {
 const byCurrency = new Map();
 for (const row of rows) {
  const currency = String(row.currency_code || 'SYP');
  const amount = Number(row.remaining);
  if (!Number.isFinite(amount) || amount <= 0) continue;
  byCurrency.set(currency, (byCurrency.get(currency) || 0) + amount);
 }
 return [...byCurrency].map(([currency_code,amount])=>({currency_code,amount}));
}

function detailText(item,kind) {
 const date = dateLabel(item?.date);
 const amount = Number(item?.amount);
 const amountText = Number.isFinite(amount) ? String(amount) : '';
 const reason = String(item?.reason||'').trim().replace(/^ADDITION_V123:\s*/,'إضافة: ');
 const note = String(item?.note||'').trim();
 const components = [kind === 'advance' ? 'سلفة' : 'مكافأة'];
 if (date) components.push(date);
 if (amountText) components.push(amountText);
 const explanation = [reason,note].filter(Boolean).join(' — ');
 return `${components.join(' · ')}${explanation ? '\n'+explanation : ''}`;
}

// Displays source transaction notes (not an inferred accounting explanation).
export function payrollDetailTooltipV129(row, data, kind) {
 const key = kind === 'advance' ? 'advance_details' : 'bonus_details';
 const entries = Array.isArray(data?.[key]) ? data[key] : [];
 const value = Number(kind === 'advance' ? row.advances ?? row.advance_deduction_original : row.bonuses ?? row.bonus_original);
 if (!entries.length && !(value > 0)) return '';
 const name = String(row.employee_name||data?.employee_name||'الموظف');
 if (!entries.length) return `${name}: لا توجد ملاحظات تفصيلية مرتبطة بهذا المسير.`;
 return `${name}\n${entries.map(e=>detailText(e,kind)).join('\n────────\n')}`;
}

export function payrollSummaryTooltipV129(rows, byItem, kind) {
 const lines = rows.filter(r=>Number(kind==='advance'?r.advances:r.bonuses)>0)
  .map(r=>payrollDetailTooltipV129(r,byItem.get(String(r.payroll_item_id)),kind)).filter(Boolean);
 return lines.length>30?lines.slice(0,30).join('\n────────\n')+`\n… و${lines.length-30} موظف آخر` :lines.join('\n────────\n');
}
