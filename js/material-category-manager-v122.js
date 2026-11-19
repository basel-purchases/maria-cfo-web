// A material category is only a row from material_categories_v023. Never
// combine it with asset/menu category identifiers, which have different FKs.
export function normalizeMaterialCategoryV122(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');
}
export function cleanMaterialCategoryNameV122(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}
export function findMaterialCategoryV122(categories, input) {
  const needle = normalizeMaterialCategoryV122(input);
  if (!needle) return null;
  return (categories || []).find(c => normalizeMaterialCategoryV122(c?.name) === needle) || null;
}
export function suggestMaterialCategoriesV122(categories, input, limit = 8) {
  const needle = normalizeMaterialCategoryV122(input);
  return (categories || [])
    .filter(c => c?.id && c?.name && (!needle || normalizeMaterialCategoryV122(c.name).includes(needle)))
    .sort((a, b) => {
      const am = normalizeMaterialCategoryV122(a.name), bm = normalizeMaterialCategoryV122(b.name);
      const as = needle && am.startsWith(needle) ? 0 : 1;
      const bs = needle && bm.startsWith(needle) ? 0 : 1;
      return as - bs || String(a.name).localeCompare(String(b.name), 'ar');
    })
    .slice(0, Math.max(0, limit));
}
// Recheck the database immediately before creating anything. A duplicate
// name (including one added from another browser) resolves to the existing ID.
export async function ensureMaterialCategoryV122(value, {categories = [], loadCategories, createCategory} = {}) {
  const name = cleanMaterialCategoryNameV122(value);
  if (!name) return null; // Explicitly clearing a category is supported.
  if (name.length > 120) throw new Error('MATERIAL_CATEGORY_NAME_INVALID');
  const matched = findMaterialCategoryV122(categories, name);
  if (matched?.id) return matched.id;
  if (typeof loadCategories !== 'function' || typeof createCategory !== 'function') {
    throw new Error('MATERIAL_CATEGORY_RESOLVER_UNAVAILABLE');
  }
  const live = await loadCategories();
  const present = findMaterialCategoryV122(live, name);
  if (present?.id) return present.id;
  try {
    const saved = await createCategory(name);
    const id = typeof saved === 'string' ? saved : saved?.id;
    if (!id) throw new Error('MATERIAL_CATEGORY_NOT_SAVED');
    return id;
  } catch (error) {
    const retry = findMaterialCategoryV122(await loadCategories(), name);
    if (retry?.id) return retry.id;
    throw error;
  }
}
