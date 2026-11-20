-- Maria CFO v1.0.34 — READ ONLY preview of business-data reset.
-- Does not truncate, update or delete any data.
WITH manifest AS (
 SELECT 'KEEP'::text AS action, unnest(ARRAY[
    'ameen_kitchen_catalog_v029','app_settings','app_users','asset_categories_v023','audit_log',
    'cashboxes','currencies','event_planner_settings_v034','expense_categories','ocr_space_usage_v021',
    'sale_adjustment_reasons','unit_conversions','units'
  ]::text[]) AS table_name
 UNION ALL
 SELECT 'CLEAR'::text AS action, unnest(ARRAY[
    'ai_jobs','ameen_daily_cash_postings_v105','ameen_daily_imports_v041','ameen_daily_lines_v041','ameen_daily_orders_v041',
    'ameen_import_runs_v024','ameen_inventory_rows_v024','ameen_kitchen_reconciliation_runs_v029','ameen_material_cost_sources_v029','ameen_order_snapshots_v024',
    'ameen_purchase_documents_v029','ameen_supplier_balances_v024','ameen_supplier_entries_v024','ameen_warehouses_v024','assistant_action_queue_v017',
    'cashbox_closure_lines','cashbox_closures','cashbox_manual_transfers_v023','cashbox_reopen_log','cashbox_session_openings',
    'cashbox_sessions','cashbox_transactions','employee_advances','employee_attendance','employee_fixed_advance_deductions_v023',
    'employee_fixed_payments_v023','employee_payroll_adjustments','employee_schedule_days','employees','event_activity_v034',
    'event_booking_guests_v035','event_booking_payments','event_bookings','event_costs','event_external_dishes_v038',
    'event_external_servings_v038','event_external_unit_conversions_v039','event_extras_v034','event_food_posting_items','event_food_posting_materials',
    'event_food_postings','event_labor_entries','event_main_plates_v036','event_menu_cost_estimates_v039','event_menu_rules',
    'event_on_demand_issues_v040','event_on_demand_v040','event_seat_guests_v113','event_serving_rules_v036','event_tables',
    'event_waste_v034','events','exchange_rates','expenses','inventory_movements',
    'material_aliases_v106','material_categories_v023','material_group_members_v130','material_groups_v130','material_price_history_v110',
    'material_units','materials','menu_categories','menu_item_aliases_v104','menu_item_price_history',
    'menu_item_recipe_items','menu_items','menu_price_audit_v041','menu_serving_conversions_v036','notifications',
    'order_item_materials','order_items','order_payments','orders','payroll_advance_deductions',
    'payroll_items','payroll_payments','payroll_runs','purchase_invoice_items','purchase_invoice_revisions_v119',
    'purchase_invoices','quick_import_changes_v030','quick_import_order_rows_v030','quick_import_recipe_drafts_v030','quick_import_runs_v030',
    'recipe_import_backups_v027','recipe_import_backups_v028','recipe_import_batches_v027','recipe_import_details_v027','recipe_import_runs_v028',
    'restaurant_assets_v023','supplier_materials','supplier_payment_allocations','supplier_payments','suppliers',
    'v126_historical_invoices','v126_menu_only_imports','v126_menu_recipe_reviews','v126_physical_counts','v131_count_batch_lines',
    'v131_count_batches','v131_sale_cost_components','v131_sale_cost_queue','v133_menu_delete_history','v133_menu_merge_history',
    'v134_menu_import_batches','v134_sales_archive_documents','v134_sales_archive_lines'
  ]::text[]) AS table_name
), unknown AS (
 SELECT t.tablename AS table_name,'UNKNOWN — STOP AND REVIEW'::text AS action
 FROM pg_catalog.pg_tables t
 WHERE t.schemaname='public' AND NOT EXISTS(SELECT 1 FROM manifest m WHERE m.table_name=t.tablename)
)
SELECT m.action,m.table_name,coalesce(to_regclass(format('%I.%I','public',m.table_name))::text,'NOT_INSTALLED') AS detected
FROM (SELECT * FROM manifest UNION ALL SELECT * FROM unknown) m
ORDER BY CASE m.action WHEN 'UNKNOWN — STOP AND REVIEW' THEN 0 WHEN 'CLEAR' THEN 1 ELSE 2 END,m.table_name;

-- This summary is read-only. Unknown tables mean do NOT run the reset until reviewed.
SELECT (SELECT count(*) FROM public.app_users) AS app_users_kept,
 (SELECT count(*) FROM public.materials) AS materials_to_reset,
 (SELECT count(*) FROM public.menu_items) AS menu_items_to_reset,
 (SELECT count(*) FROM public.purchase_invoices) AS purchase_invoices_to_reset,
 (SELECT count(*) FROM public.orders) AS orders_to_reset,
 (SELECT count(*) FROM public.inventory_movements) AS movements_to_reset;
