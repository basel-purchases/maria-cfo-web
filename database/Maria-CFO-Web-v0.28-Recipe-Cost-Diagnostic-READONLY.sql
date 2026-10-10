-- Maria CFO v0.28: read-only diagnostic. Run in Supabase SQL Editor after import.
-- Shows which MATERIAL catalog prices are currently missing for imported recipes.
-- Does not update any data. No customer/order details are returned.
SELECT
  m.name AS material_name,
  u.name AS base_unit,
  m.last_purchase_unit_cost_base AS price_per_base_unit_syp,
  COUNT(DISTINCT ri.menu_item_id) AS recipes_using_material,
  CASE WHEN m.last_purchase_unit_cost_base IS NULL THEN 'MISSING_PRICE'
       ELSE 'PRICED_FROM_MATERIALS' END AS price_status
FROM public.menu_item_recipe_items ri
JOIN public.materials m ON m.id=ri.material_id
JOIN public.units u ON u.id=m.base_unit_id
GROUP BY m.id,m.name,u.name,m.last_purchase_unit_cost_base
ORDER BY (m.last_purchase_unit_cost_base IS NULL) DESC,
         COUNT(DISTINCT ri.menu_item_id) DESC,m.name;
