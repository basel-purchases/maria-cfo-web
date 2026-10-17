// Maria CFO v1.0.3 - date-only display of the last known material purchase.
// Imported price dates are stored as midnight UTC. Parsing them in the
// browser's local timezone can incorrectly show the previous calendar day.
export function formatMaterialLastPurchaseDate(value) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(String(value).trim());
  if (!match) return '—';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day) return '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}
