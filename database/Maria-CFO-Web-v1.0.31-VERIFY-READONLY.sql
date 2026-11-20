-- Maria CFO v1.0.31 - READ ONLY VERIFICATION. Safe after applying the migration.
SELECT 'object_check' AS section, obj,
       to_regclass('public.'||obj) IS NOT NULL AS exists_now
FROM (VALUES ('v131_sale_cost_queue'),('v131_sale_cost_components'),
 ('v131_count_batches'),('v131_count_batch_lines')) objects(obj);

SELECT 'sale_queue' AS section, state,COUNT(*) AS lines,
       COUNT(*) FILTER(WHERE is_cost_complete) AS cost_complete
FROM public.v131_sale_cost_queue GROUP BY state ORDER BY state;

SELECT 'count_history' AS section, count_date, count(*) AS imported_files
FROM public.v131_count_batches GROUP BY count_date ORDER BY count_date DESC LIMIT 30;

SELECT 'duplicate_count_guard' AS section,material_id,count_date,count(*) AS n
FROM public.v126_physical_counts
GROUP BY material_id,count_date HAVING count(*)>1 LIMIT 30;

SELECT 'completed_debits' AS section, q.source_kind, q.state,
 COUNT(*) AS sale_lines,
 SUM((SELECT COUNT(*) FROM public.v131_sale_cost_components c WHERE c.queue_id=q.id AND c.inventory_movement_id IS NOT NULL)) AS inventory_movements
FROM public.v131_sale_cost_queue q
WHERE q.state IN ('issued','included_in_count')
GROUP BY q.source_kind,q.state ORDER BY 1,2;

SELECT 'categories' AS section,
 (SELECT COUNT(*) FROM public.materials WHERE category_id_v023 IS NOT NULL) AS classified_materials,
 (SELECT COUNT(*) FROM public.materials WHERE category_id_v023 IS NULL) AS without_category,
 (SELECT COUNT(*) FROM public.material_categories_v023) AS category_names;

-- Converted groups: price comparison is per reference unit, not raw SKU unit.
SELECT 'group_unit_conversion' AS section,g.name AS group_name,
  uref.name AS reference_unit,m.name AS material,
  um.name AS stock_unit,gm.priority,gm.group_units_per_base_v131 AS reference_units_per_stock_unit,
  m.last_purchase_unit_cost_base AS original_unit_cost_base,
  CASE WHEN m.last_purchase_unit_cost_base>0 AND gm.group_units_per_base_v131>0
     THEN round(m.last_purchase_unit_cost_base/gm.group_units_per_base_v131,6)
     ELSE NULL END AS normalized_cost_per_reference_unit,
  (gm.group_units_per_base_v131 NOT BETWEEN 0.000001 AND 1000000
   OR (m.base_unit_id=g.reference_unit_id_v131 AND gm.group_units_per_base_v131<>1)) AS invalid_conversion
FROM public.material_groups_v130 g
JOIN public.material_group_members_v130 gm ON gm.group_id=g.id
JOIN public.materials m ON m.id=gm.material_id
JOIN public.units uref ON uref.id=g.reference_unit_id_v131
JOIN public.units um ON um.id=m.base_unit_id
ORDER BY g.name,gm.priority;
