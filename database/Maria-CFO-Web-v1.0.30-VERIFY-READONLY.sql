-- Maria CFO v1.0.30 post-deployment verification; READ ONLY.
-- Run AFTER applying v1.0.30. No user or stock data is modified.
SELECT 'groups' AS measure, count(*) AS total FROM public.material_groups_v130
UNION ALL SELECT 'group_members',count(*) FROM public.material_group_members_v130;

-- Compare prices per base unit. Values are only comparable within the same unit/currency.
SELECT g.name AS group_name,
 count(*) AS material_count,
 count(DISTINCT m.base_unit_id) AS unit_count,
 sum(greatest(coalesce(m.current_stock_base,0),0)) AS available_stock_base,
 min(m.last_purchase_unit_cost_base) FILTER(WHERE m.last_purchase_unit_cost_base>0) AS lowest_known_price_syp_base,
 max(m.last_purchase_unit_cost_base) FILTER(WHERE m.last_purchase_unit_cost_base>0) AS highest_known_price_syp_base,
 count(*) FILTER(WHERE m.last_purchase_unit_cost_base IS NULL OR m.last_purchase_unit_cost_base<=0) AS unknown_price_count
FROM public.material_groups_v130 g
JOIN public.material_group_members_v130 gm ON gm.group_id=g.id
JOIN public.materials m ON m.id=gm.material_id
GROUP BY g.id,g.name ORDER BY g.name;

-- Confirm that newly issued order and event snapshots record their requested vs actual SKU.
SELECT 'restaurant_orders' AS source,count(*) AS allocations,
 count(*) FILTER(WHERE requested_material_id_v130<>material_id) AS substituted_count
FROM public.order_item_materials WHERE requested_material_id_v130 IS NOT NULL
UNION ALL
SELECT 'event_food',count(*),count(*) FILTER(WHERE requested_material_id_v130<>material_id)
FROM public.event_food_posting_materials WHERE requested_material_id_v130 IS NOT NULL;

-- The ledger and stored stock must remain reconciled; investigate any returned rows.
SELECT m.id,m.name,m.current_stock_base,
 coalesce(sum(im.quantity_delta_base),0) AS ledger_stock_base
FROM public.materials m LEFT JOIN public.inventory_movements im ON im.material_id=m.id
GROUP BY m.id,m.name,m.current_stock_base
HAVING abs(m.current_stock_base-coalesce(sum(im.quantity_delta_base),0))>0.00001
ORDER BY m.name LIMIT 100;
