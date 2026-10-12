-- MARIA CFO v0.29 - BUSINESS DATA RESET (ONE-OWNER INSTALLATION)
-- DANGER: PERMANENTLY DESTROYS all operational, imported, and accounting data. NEVER USE CASUALLY.
-- Run ONLY in Supabase SQL Editor as project administrator after a verified backup.
-- Keeps: auth.users, public.app_users, public.app_settings, currencies,
--        system units/conversions, system expense categories and adjustment reasons.
-- Re-creates three EMPTY cashbox definitions. Does not change schema/RPCs/RLS.
-- Storage files and Auth users are NOT cleared.
-- v0.29: includes inventory import v0.24, recipe v0.27/v0.28 and v0.29 provenance.
-- First execute the READ-ONLY preview script supplied separately.
-- IMPORTANT: This script ABORTS WITHOUT CHANGES while v_confirmation is NOT_CONFIRMED.
-- Never run it on production unless you are deliberately discarding ALL business data
-- and you have a verified, restorable backup of the full database.
-- All changes are wrapped in one transaction. There is NO CASCADE.

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

DO $maria_reset$
DECLARE
    -- SAFE DEFAULT. Change ONLY after checking a verified backup and the preview.
    -- Explicit execution phrase: RESET_MARIA_CFO_V029_NOW
    v_confirmation text := 'NOT_CONFIRMED';

    v_keep text[] := ARRAY[
        'app_users', 'app_settings', 'currencies', 'units',
        'unit_conversions', 'cashboxes', 'expense_categories',
        'sale_adjustment_reasons',
        'ameen_kitchen_catalog_v029'
    ];
    v_wipe text[] := ARRAY[
        'ameen_import_runs_v024',
        'ameen_inventory_rows_v024',
        'ameen_order_snapshots_v024',
        'ameen_supplier_balances_v024',
        'ameen_supplier_entries_v024',
        'ameen_warehouses_v024',
        'recipe_import_backups_v027',
        'recipe_import_batches_v027',
        'recipe_import_details_v027',
        'recipe_import_runs_v028',
        'recipe_import_backups_v028',
        'ameen_material_cost_sources_v029',
        'ameen_purchase_documents_v029',
        'ameen_kitchen_reconciliation_runs_v029',
        'ai_jobs',
        'assistant_action_queue_v017',
        'asset_categories_v023',
        'audit_log',
        'cashbox_closure_lines',
        'cashbox_closures',
        'cashbox_manual_transfers_v023',
        'cashbox_reopen_log',
        'cashbox_session_openings',
        'cashbox_sessions',
        'cashbox_transactions',
        'employee_advances',
        'employee_attendance',
        'employee_fixed_advance_deductions_v023',
        'employee_fixed_payments_v023',
        'employee_payroll_adjustments',
        'employee_schedule_days',
        'employees',
        'event_booking_payments',
        'event_bookings',
        'event_costs',
        'event_food_posting_items',
        'event_food_posting_materials',
        'event_food_postings',
        'event_labor_entries',
        'event_menu_rules',
        'event_tables',
        'events',
        'exchange_rates',
        'expenses',
        'inventory_movements',
        'material_categories_v023',
        'material_units',
        'materials',
        'menu_categories',
        'menu_item_price_history',
        'menu_item_recipe_items',
        'menu_items',
        'notifications',
        'ocr_space_usage_v021',
        'order_item_materials',
        'order_items',
        'order_payments',
        'orders',
        'payroll_advance_deductions',
        'payroll_items',
        'payroll_payments',
        'payroll_runs',
        'purchase_invoice_items',
        'purchase_invoices',
        'restaurant_assets_v023',
        'supplier_materials',
        'supplier_payment_allocations',
        'supplier_payments',
        'suppliers'
    ];
    v_unknown text;
    v_missing text;
    v_sql text;
    v_owner_count integer;
    v_user_count integer;
    v_general_cashbox_id uuid;
    v_count bigint;
    v_table text;
BEGIN
    IF v_confirmation <> 'RESET_MARIA_CFO_V029_NOW' THEN
        RAISE EXCEPTION 'SAFE STOP: NOT_CONFIRMED. Only after full backup replace it with RESET_MARIA_CFO_V029_NOW';
    END IF;

    -- Only one allowed owner is expected. Never touch auth.users or app_users.
    SELECT count(*), count(*) FILTER (WHERE role = 'owner')
      INTO v_user_count, v_owner_count
      FROM public.app_users;
    IF v_user_count <> 1 OR v_owner_count <> 1 THEN
        RAISE EXCEPTION 'STOPPED: expected exactly one owner and no other app_users; found % users, % owners',
            v_user_count, v_owner_count;
    END IF;

    -- Require expected base tables to exist.
    SELECT string_agg(name, ', ' ORDER BY name) INTO v_missing
    FROM unnest(ARRAY[
        'app_users','app_settings','cashboxes','currencies','units',
        'cashbox_transactions','cashbox_sessions','materials','menu_items',
        'orders','purchase_invoices','employees','payroll_runs'
    ]) AS expected(name)
    WHERE to_regclass(format('%I.%I','public',name)) IS NULL;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'STOPPED: missing expected tables: %', v_missing;
    END IF;

    -- Fail closed if a later version added unknown tables. Never silently wipe them.
    SELECT string_agg(tablename, ', ' ORDER BY tablename) INTO v_unknown
      FROM pg_catalog.pg_tables
     WHERE schemaname = 'public'
       AND NOT (tablename = ANY(v_keep))
       AND NOT (tablename = ANY(v_wipe));
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'STOPPED: review new public tables before reset: %', v_unknown;
    END IF;

    -- Remove settings pointers to old cashboxes before deleting their definitions.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='app_settings'
           AND column_name='payroll_cashbox_id'
    ) THEN
        UPDATE public.app_settings SET payroll_cashbox_id = NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='app_settings'
           AND column_name='default_expense_cashbox_id'
    ) THEN
        UPDATE public.app_settings SET default_expense_cashbox_id = NULL;
    END IF;

    SELECT string_agg(format('%I.%I', 'public', name), ', ' ORDER BY name)
      INTO v_sql
      FROM unnest(v_wipe) AS x(name)
     WHERE to_regclass(format('%I.%I', 'public', name)) IS NOT NULL;

    IF v_sql IS NULL THEN
        RAISE EXCEPTION 'STOPPED: no business tables to reset';
    END IF;

    -- RESTRICT, NOT CASCADE. If a table not selected above references these data,
    -- PostgreSQL ABORTS the entire transaction rather than wiping it too.
    EXECUTE 'TRUNCATE TABLE ' || v_sql || ' RESTART IDENTITY RESTRICT';

    -- Clean out user-created units and conversions; keep system unit definitions.
    DELETE FROM public.unit_conversions WHERE is_system IS NOT TRUE;
    DELETE FROM public.units WHERE is_system IS NOT TRUE;

    -- Keep starter expense categories, clear those added through v0.23 UI.
    DELETE FROM public.expense_categories WHERE code LIKE 'CUSTOM_%';

    -- Remove any test cashbox definitions and seed the three default ones.
    DELETE FROM public.cashboxes;
    INSERT INTO public.cashboxes
      (name,code,is_general,is_active,default_opening_balance,display_order)
    VALUES
      ('صندوق 1','BOX_1',false,true,0,1),
      ('صندوق 2','BOX_2',false,true,0,2),
      ('الصندوق العام','GENERAL',true,true,0,3);

    SELECT id INTO v_general_cashbox_id
    FROM public.cashboxes WHERE is_general IS TRUE LIMIT 1;
    IF v_general_cashbox_id IS NULL THEN
        RAISE EXCEPTION 'STOPPED: general cashbox was not recreated';
    END IF;

    -- New installations should default salaries and expenses to general cashbox.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='app_settings'
           AND column_name='payroll_cashbox_id'
    ) THEN
        UPDATE public.app_settings SET payroll_cashbox_id = v_general_cashbox_id;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='app_settings'
           AND column_name='default_expense_cashbox_id'
    ) THEN
        UPDATE public.app_settings SET default_expense_cashbox_id = v_general_cashbox_id;
    END IF;

    -- A new current FX rate allows USD transactions immediately after reset.
    -- Review this rate in Settings before any real multi-currency operations.
    INSERT INTO public.exchange_rates
       (currency_code,base_currency_code,rate_to_base,effective_at,source,note)
    SELECT upper(s.secondary_currency_code), upper(s.base_currency_code),
           s.usd_to_base_rate, now(), 'manual', 'Opening FX at production reset'
      FROM public.app_settings s
     WHERE upper(s.secondary_currency_code) = 'USD'
       AND upper(s.base_currency_code) <> 'USD'
       AND s.usd_to_base_rate IS NOT NULL
       AND s.usd_to_base_rate > 0;

    -- Updates to app_settings may have created audit rows; wipe test audit history.
    TRUNCATE TABLE public.audit_log RESTRICT;

    -- Verify complete reset of all operational tables except the newly seeded FX rate.
    FOREACH v_table IN ARRAY v_wipe LOOP
        IF v_table = 'exchange_rates' OR to_regclass(format('%I.%I','public',v_table)) IS NULL THEN
            CONTINUE;
        END IF;
        EXECUTE format('SELECT count(*) FROM %I.%I','public',v_table) INTO v_count;
        IF v_count <> 0 THEN
            RAISE EXCEPTION 'STOPPED: table % still has % rows', v_table, v_count;
        END IF;
    END LOOP;
    RAISE NOTICE 'Maria CFO v0.29 reset successful: business tables empty, one owner preserved, 3 cashboxes recreated';
END;
$maria_reset$;

COMMIT;

-- Optional read-only check after success:
SELECT
  (SELECT count(*) FROM public.app_users) AS app_user_count,
  (SELECT count(*) FROM public.cashboxes) AS cashbox_count,
  (SELECT count(*) FROM public.materials) AS materials_count,
  (SELECT count(*) FROM public.menu_items) AS menu_items_count,
  (SELECT count(*) FROM public.orders) AS orders_count,
  (SELECT count(*) FROM public.cashbox_transactions) AS cashbox_transactions_count,
  (SELECT count(*) FROM public.employees) AS employees_count;
