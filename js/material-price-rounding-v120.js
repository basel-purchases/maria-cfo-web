// v1.0.20 — Presentation policy for last-known material prices only.
// NEVER use the rounded display value to rewrite a historical purchase price.
export function roundUpKnownMaterialPriceV120(value){
  if(value===null || value===undefined || String(value).trim()==='') return null;
  const n=Number(value);
  if(!Number.isFinite(n) || n<0) return null;
  if(n===0)return 0;
  const rounded=Math.ceil((n - 1e-9) / 10) * 10;
  return rounded===0?0:rounded;
}
export function displayKnownMaterialPriceV120(value){
  const rounded=roundUpKnownMaterialPriceV120(value);
  return rounded===null?'—':String(rounded)+' ل.س';
}
// Round an explicitly edited value, but not untouched data.
export function editedKnownMaterialPriceV120(value){
  return roundUpKnownMaterialPriceV120(value);
}
