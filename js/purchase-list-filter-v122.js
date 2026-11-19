export function isVoidedPurchaseV122(invoice) {
  return invoice?.status === 'voided' || invoice?.is_voided === true;
}
export function filterPurchaseInvoicesV122(rows = [], suppliers = {}, {status='all',supplier='',query=''} = {}) {
  const text = String(query || '').trim().toLocaleLowerCase('ar');
  return rows.filter(invoice => {
    const archived = Boolean(invoice.archived_at_v122);
    if (status === 'archived' ? !archived : archived) return false;
    if (status === 'draft' && (invoice.status !== 'draft' || isVoidedPurchaseV122(invoice))) return false;
    if (status === 'posted' && (invoice.status !== 'posted' || isVoidedPurchaseV122(invoice))) return false;
    if (status === 'voided' && !isVoidedPurchaseV122(invoice)) return false;
    if (supplier && String(invoice.supplier_id || '') !== String(supplier)) return false;
    if (!text) return true;
    const name = suppliers[String(invoice.supplier_id || '')]?.name || '';
    return [name, invoice.invoice_number, invoice.notes, invoice.invoice_date]
      .some(value => String(value || '').toLocaleLowerCase('ar').includes(text));
  });
}
