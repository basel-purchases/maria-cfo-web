-- Maria CFO v1.0.34 - RESET OPERATIONAL DATA, KEEP CORE SETTINGS AND APP ACCOUNTS.
-- DANGER: Deletes all historical invoices, purchases, sales, employees/payroll, inventory,
-- menus, counts, and operational ledgers. NEVER run on production without a verified backup.
-- This SQL is intentionally INERT until v_confirmation is edited manually below.
-- All changes are inside one transaction; no DROP TABLE and no CASCADE.
-- Run preview first and review UNKNOWN table names. A newer unknown table ABORTS.
-- Tables preserved: ameen_kitchen_catalog_v029, app_settings, app_users, asset_categories_v023, audit_log, cashboxes, currencies, event_planner_settings_v034, expense_categories, ocr_space_usage_v021, sale_adjustment_reasons, unit_conversions, units.
-- cashbox definitions remain, their opening balances reset to zero, actual transactions deleted.
BEGIN;
SET LOCAL lock_timeout='12s';
SET LOCAL statement_timeout='120s';
DO $v134_reset$
DECLARE
 v_confirmation text := 'DO_NOT_RUN';
 v_wipe text[] := ARRAY[
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
  ]::text[];
 v_keep text[] := ARRAY[
    'ameen_kitchen_catalog_v029','app_settings','app_users','asset_categories_v023','audit_log',
    'cashboxes','currencies','event_planner_settings_v034','expense_categories','ocr_space_usage_v021',
    'sale_adjustment_reasons','unit_conversions','units'
  ]::text[];
 v_unknown text;
 v_targets text;
 v_t text;
 v_count bigint;
BEGIN
 IF v_confirmation <> 'RESET_MARIA_OPERATIONS_V134' THEN
  RAISE EXCEPTION 'SAFE_STOP_CONFIRMATION_REQUIRED: edit v_confirmation ONLY AFTER backup + preview';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE role='owner') THEN
  RAISE EXCEPTION 'SAFE_STOP_OWNER_NOT_FOUND';
 END IF;
 -- Include all known operational tables and reject any new unknown table to avoid partial reset.
 SELECT string_agg(tablename,', ' ORDER BY tablename) INTO v_unknown
 FROM pg_catalog.pg_tables
 WHERE schemaname='public' AND NOT (tablename=ANY(v_wipe) OR tablename=ANY(v_keep));
 IF v_unknown IS NOT NULL THEN RAISE EXCEPTION 'SAFE_STOP_UNKNOWN_PUBLIC_TABLES: %',v_unknown; END IF;
 -- This single SQL statement covers all present operational tables. RESTRICT protects references
 -- from preserved tables, so PostgreSQL aborts instead of cascading to essential data.
 SELECT string_agg(format('%I.%I','public',n),', ' ORDER BY n) INTO v_targets
 FROM unnest(v_wipe) x(n)
 WHERE to_regclass(format('%I.%I','public',n)) IS NOT NULL;
 IF v_targets IS NULL THEN RAISE EXCEPTION 'SAFE_STOP_NO_TABLES_TO_RESET'; END IF;
 EXECUTE 'TRUNCATE TABLE '||v_targets||' RESTART IDENTITY RESTRICT';
 -- Cashbox definitions are basic configuration, but old opening balances cannot carry over.
 UPDATE public.cashboxes SET default_opening_balance=0;
 -- No fictitious exchange rate is inserted; current FX must be re-established explicitly.
 FOREACH v_t IN ARRAY v_wipe LOOP
  IF to_regclass(format('%I.%I','public',v_t)) IS NULL THEN CONTINUE; END IF;
  EXECUTE format('SELECT count(*) FROM %I.%I','public',v_t) INTO v_count;
  IF v_count<>0 THEN RAISE EXCEPTION 'SAFE_STOP_NONEMPTY_TABLE: %, %',v_t,v_count; END IF;
 END LOOP;
 RAISE NOTICE 'Maria CFO v1.0.34 operational reset: successful. Core tables retained, imported rows empty.';
END;
$v134_reset$;
COMMIT;
