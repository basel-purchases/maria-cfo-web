// Queue decisions are based on a real menu reference, not the sale's text alone.
export function queueActionV132(item = {}) {
  if (item.state === 'issued' || item.state === 'included_in_count') return 'done';
  if (item.state === 'review') return 'review';
  if (!item.menuItemId) return 'add';
  if (Number(item.recipeCount || 0) <= 0) return 'recipe';
  return 'complete';
}
export function menuFilterLinkV132(name = '') {
  return `#/menu/find/${encodeURIComponent(String(name || '').trim())}`;
}
export function sortQueueNamesV132(items) {
  const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
  return [...items].sort((a, b) => collator.compare(a.menuName || a.sourceName || '', b.menuName || b.sourceName || '') || String(b.saleDate || '').localeCompare(String(a.saleDate || '')));
}
