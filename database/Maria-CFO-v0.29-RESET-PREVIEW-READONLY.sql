-- Maria CFO v0.29 READ ONLY: inspect a reset BEFORE deciding to delete anything.
-- The reset script will refuse to execute if unknown public tables exist.
WITH classification AS (
 SELECT c.relname::text AS table_name,
 CASE WHEN c.relname=ANY(ARRAY['app_users','app_settings','currencies','units','unit_conversions','cashboxes','expense_categories','sale_adjustment_reasons','ameen_kitchen_catalog_v029']) THEN 'PRESERVED'
 WHEN c.relname=ANY(ARRAY['ameen_import_runs_v024','ameen_inventory_rows_v024','ameen_order_snapshots_v024','ameen_supplier_balances_v024','ameen_supplier_entries_v024','ameen_warehouses_v024','recipe_import_backups_v027','recipe_import_batches_v027','recipe_import_details_v027','recipe_import_runs_v028','recipe_import_backups_v028','ameen_material_cost_sources_v029','ameen_purchase_documents_v029','ameen_kitchen_reconciliation_runs_v029','ai_jobs','assistant_action_queue_v017','asset_categories_v023','audit_log','cashbox_closure_lines','cashbox_closures','cashbox_manual_transfers_v023','cashbox_reopen_log','cashbox_session_openings','cashbox_sessions','cashbox_transactions','employee_advances','employee_attendance','employee_fixed_advance_deductions_v023','employee_fixed_payments_v023','employee_payroll_adjustments','employee_schedule_days','employees','event_booking_payments','event_bookings','event_costs','event_food_posting_items','event_food_posting_materials','event_food_postings','event_labor_entries','event_menu_rules','event_tables','events','exchange_rates','expenses','inventory_movements','material_categories_v023','material_units','materials','menu_categories','menu_item_price_history','menu_item_recipe_items','menu_items','notifications','ocr_space_usage_v021','order_item_materials','order_items','order_payments','orders','payroll_advance_deductions','payroll_items','payroll_payments','payroll_runs','purchase_invoice_items','purchase_invoices','restaurant_assets_v023','supplier_materials','supplier_payment_allocations','supplier_payments','suppliers']) THEN 'WIPED'
 ELSE 'UNKNOWN - RESET WILL ABORT' END AS action,
 coalesce(s.n_live_tup,0) AS approximate_rows
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
)
SELECT table_name,action,approximate_rows FROM classification
ORDER BY CASE action WHEN 'UNKNOWN - RESET WILL ABORT' THEN 0 WHEN 'PRESERVED' THEN 1 ELSE 2 END,table_name;

-- Account safety: the reset requires EXACTLY ONE allowlisted owner.
SELECT role, count(*) AS count_users FROM public.app_users GROUP BY role;

-- This shows actual ledger counts before any destructive action.
SELECT 'materials' as table_name,count(*) AS actual_count FROM public.materials
UNION ALL SELECT 'menu_items',count(*) FROM public.menu_items
UNION ALL SELECT 'menu_item_recipe_items',count(*) FROM public.menu_item_recipe_items
UNION ALL SELECT 'orders',count(*) FROM public.orders
UNION ALL SELECT 'cashbox_transactions',count(*) FROM public.cashbox_transactions
UNION ALL SELECT 'inventory_movements',count(*) FROM public.inventory_movements
UNION ALL SELECT 'ameen_import_runs_v024',count(*) FROM public.ameen_import_runs_v024
UNION ALL SELECT 'recipe_import_runs_v028',count(*) FROM public.recipe_import_runs_v028;
