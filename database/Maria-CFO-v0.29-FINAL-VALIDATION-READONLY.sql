-- Maria CFO v0.29 FINAL — read-only validation AFTER historical purchases and stock reconciliation.
-- Run only after the FINAL Kitchen Purchases schema migration was applied.
SELECT 'historical_posted_invoices' AS metric,count(*)::text AS value
FROM public.purchase_invoices
WHERE is_ameen_legacy_v029 IS TRUE AND status='posted' AND is_voided IS NOT TRUE
UNION ALL
SELECT 'source_invoice_keys',count(*)::text FROM public.ameen_purchase_documents_v029
UNION ALL
SELECT 'historical_invoice_lines',count(*)::text FROM public.purchase_invoice_items pii
JOIN public.purchase_invoices pi ON pi.id=pii.invoice_id WHERE pi.is_ameen_legacy_v029 IS TRUE
UNION ALL
SELECT 'priced_kitchen_materials',count(*)::text FROM public.materials m
JOIN public.ameen_kitchen_catalog_v029 c ON m.code='AM-SRC-'||c.source_code
WHERE m.last_purchase_unit_cost_base>0
UNION ALL
SELECT 'kitchen_reconciliation_runs',count(*)::text FROM public.ameen_kitchen_reconciliation_runs_v029;

SELECT c.source_code,c.material_name,c.base_unit_name AS inventory_unit,
       c.reference_quantity AS on_hand_per_original_inventory,
       m.name AS matched_database_material, u.name AS current_unit,
       m.current_stock_base,m.last_purchase_unit_cost_base,m.last_purchase_at,
       CASE WHEN c.requires_review OR c.source_code='2015011' THEN 'REVIEW_UNIT'
            WHEN m.id IS NULL THEN 'NO_PURCHASE_OR_MATERIAL'
            WHEN m.last_purchase_unit_cost_base IS NULL OR m.last_purchase_unit_cost_base<=0 THEN 'NO_COST'
            WHEN abs(c.reference_quantity-m.current_stock_base)>0.000001 THEN 'BALANCE_DIFF'
            ELSE 'MATCHED' END AS inspection_status
FROM public.ameen_kitchen_catalog_v029 c
LEFT JOIN public.materials m ON m.code='AM-SRC-'||c.source_code
LEFT JOIN public.units u ON u.id=m.base_unit_id
ORDER BY inspection_status,c.material_name;

SELECT source_document,invoice_date,line_count,invoice_id,imported_at
FROM public.ameen_purchase_documents_v029
ORDER BY invoice_date DESC,source_document LIMIT 30;
