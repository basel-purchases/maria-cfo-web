-- Maria CFO v0.29 - read-only live pricing and warehouse eligibility.
-- Export the results to CSV BEFORE any optional reset. No changes are made.
-- Material price values can be much more complete in live Supabase than in the
-- source Al-Ameen workbook; a full reset will DELETE these values.
WITH warehouse_status AS (
  SELECT core_entity_id AS material_id,
         count(*) FILTER (WHERE kind='material'
                           AND NULLIF(BTRIM(warehouse),'') IS NOT NULL
                           AND quantity_base>0
                           AND review_reason IS NULL) AS valid_warehouse_rows
    FROM public.ameen_inventory_rows_v024
   GROUP BY core_entity_id
)
SELECT m.id AS material_id,m.name AS material_name,
       m.last_purchase_unit_cost_base AS price_per_base_unit,
       m.current_stock_base AS current_quantity_base,
       u.code AS base_unit_code,u.name AS base_unit_name,
       coalesce(w.valid_warehouse_rows,0) AS valid_imported_warehouses,
       (m.last_purchase_unit_cost_base>0 AND m.current_stock_base>0
        AND coalesce(w.valid_warehouse_rows,0)>0) AS eligible_for_priced_recipe
FROM public.materials m
LEFT JOIN public.units u ON u.id=m.base_unit_id
LEFT JOIN warehouse_status w ON w.material_id=m.id
ORDER BY m.name,m.id;
