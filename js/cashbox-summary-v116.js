// v1.0.16: the top navigation and cashboxes page share the same displayed balance.
// An absent balance must never be presented as a real zero.
const BALANCE_FIELDS_V116 = [
  'expected_balance_base', 'expected_base', 'expected_closing_base',
  'expected_closing_balance_base', 'current_balance_base', 'balance_base',
  'net_base', 'expected_balance', 'balance', '_computed_balance_base',
];

export function expectedCashboxBalanceV116(summary) {
  for (const key of BALANCE_FIELDS_V116) {
    const value = summary?.[key];
    if (value === undefined || value === null || value === '') continue;
    const amount = Number(value);
    if (Number.isFinite(amount)) return Object.is(amount, -0) ? 0 : amount;
  }
  return null;
}

export function cashboxQuickEntriesV116(overview, count = 3) {
  if (!Array.isArray(overview)) return [];
  return overview
    .filter((entry) => entry?.cashbox?.id)
    .map((entry, index) => ({ ...entry, originalIndex: index }))
    .sort((a, b) => {
      const aOrder = Number(a.cashbox.display_order);
      const bOrder = Number(b.cashbox.display_order);
      const aValid = a.cashbox.display_order != null && Number.isFinite(aOrder);
      const bValid = b.cashbox.display_order != null && Number.isFinite(bOrder);
      if (aValid && bValid && aOrder !== bOrder) return aOrder - bOrder;
      if (aValid !== bValid) return aValid ? -1 : 1;
      return a.originalIndex - b.originalIndex;
    })
    .slice(0, count)
    .map(({ cashbox, summary }) => ({
      id: String(cashbox.id),
      name: String(cashbox.name || '\u0635\u0646\u062f\u0648\u0642'),
      balance: expectedCashboxBalanceV116(summary),
    }));
}

export function cashboxNumberV116(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '\u2014';
  const amount = Number(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
    .format(Object.is(amount, -0) ? 0 : amount);
}
