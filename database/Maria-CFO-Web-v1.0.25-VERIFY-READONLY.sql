-- Maria CFO Web v1.0.25 - verification only, no business writes.
-- Run AFTER the v1.0.25 migration. A SQL Editor session may have no auth.uid():
-- owner_context=false means financial-view checks are NOT evidence of correctness.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='30s';

SELECT current_setting('server_version') AS postgres_version,
       public.is_app_owner() AS owner_context,
       to_regprocedure('public.cashbox_live_balance_base_v124(uuid,date)') IS NOT NULL AS prior_v124_present,
       to_regclass('public.event_financial_summary_v125') IS NOT NULL AS v125_view_present;

DO $preflight$
BEGIN
 IF to_regclass('public.event_financial_summary_v125') IS NULL
 OR to_regprocedure('public.event_add_internal_order_v125(uuid,text,numeric,numeric,uuid,numeric,text,uuid,text)') IS NULL
 OR to_regprocedure('public.event_add_external_dish_v125(uuid,text,text,numeric,numeric,text,numeric,uuid,text,text)') IS NULL
 OR to_regprocedure('public.event_price_external_dish_v125(uuid,numeric)') IS NULL
 THEN RAISE EXCEPTION 'V125_MIGRATION_MISSING_OR_INCOMPLETE'; END IF;
END;
$preflight$;

SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,p.proconfig,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS signed_in_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN(
 'event_add_internal_order_v125','event_add_external_dish_v125','event_price_external_dish_v125',
 'event_order_bucket_v125','event_lock_extra_v125','event_extra_link_guard_v125','event_external_hospitality_guard_v125',
 'pay_event_extra_v034','refund_event_extra_v034','void_event_extra_v034',
 'event_pay_external_dish_v038','event_void_external_dish_v038')
ORDER BY p.proname;

SELECT c.relname,c.reloptions,
       has_table_privilege('authenticated',c.oid,'SELECT') AS signed_in_can_read,
       has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') AS signed_in_can_mutate_directly,
       has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS anonymous_has_any_of_these_privileges
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN(
 'event_financial_summary_v125','event_extras_v034','event_external_dishes_v038')
ORDER BY c.relname;

SELECT t.tgname,t.tgenabled,c.relname
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE t.tgname IN('event_extra_link_guard_v125','event_external_hospitality_guard_v125','event_demand_hospitality_guard_v125');

-- Each issue_count below must be zero. These are source-table integrity checks.
SELECT 'duplicate_internal_request_keys' AS check_name,count(*) AS issue_count FROM(
 SELECT event_id,request_key_v125 FROM public.event_extras_v034 WHERE request_key_v125 IS NOT NULL
 GROUP BY event_id,request_key_v125 HAVING count(*)>1) q
UNION ALL SELECT 'duplicate_external_request_keys',count(*) FROM(
 SELECT event_id,request_key_v125 FROM public.event_external_dishes_v038 WHERE request_key_v125 IS NOT NULL
 GROUP BY event_id,request_key_v125 HAVING count(*)>1) q
UNION ALL SELECT 'duplicate_external_invoices',count(*) FROM(
 SELECT external_dish_id_v125 FROM public.event_extras_v034 WHERE external_dish_id_v125 IS NOT NULL
 GROUP BY external_dish_id_v125 HAVING count(*)>1) q
UNION ALL SELECT 'active_sale_without_invoice',count(*) FROM public.event_external_dishes_v038 d
 WHERE d.is_active AND d.billing_mode_v125='sale'
 AND NOT EXISTS(SELECT 1 FROM public.event_extras_v034 x WHERE x.external_dish_id_v125=d.id)
UNION ALL SELECT 'invalid_external_link_or_cost',count(*) FROM public.event_extras_v034 x
 LEFT JOIN public.event_external_dishes_v038 d ON d.id=x.external_dish_id_v125
 WHERE x.external_dish_id_v125 IS NOT NULL AND (
 d.id IS NULL OR d.event_id<>x.event_id OR d.billing_mode_v125<>'sale'
 OR x.quantity<>1 OR x.unit_cost_base<>d.total_cost_base OR x.menu_item_id IS NOT NULL
 OR (NOT d.is_active AND x.status<>'voided'))
UNION ALL SELECT 'complimentary_with_sale_or_payment',count(*) FROM public.event_extras_v034 x
 WHERE x.status='complimentary' AND (x.unit_price_original<>0 OR x.cashbox_transaction_id IS NOT NULL OR x.paid_at IS NOT NULL)
UNION ALL SELECT 'resale_in_fixed_hospitality',count(*) FROM public.event_external_servings_v038 s
 JOIN public.event_external_dishes_v038 d ON d.id=s.dish_id WHERE d.billing_mode_v125='sale'
UNION ALL SELECT 'resale_in_on_demand_hospitality',count(*) FROM public.event_on_demand_v040 s
 JOIN public.event_external_dishes_v038 d ON d.id=s.external_dish_id WHERE d.billing_mode_v125='sale';

-- The view intentionally requires an owner session. Zero rows without an owner
-- session is a skipped financial check, NOT a passing production reconciliation.
SELECT public.is_app_owner() AS owner_context,
       NOT public.is_app_owner() AS financial_checks_skipped_without_owner_session,
       count(*) AS visible_events,
       count(*) FILTER (WHERE abs(revenue_base_v125-cost_base_v125-profit_base_v125)>0.0001) AS profit_equation_failures,
       count(*) FILTER (WHERE abs(cost_base_v125-(
         kitchen_hospitality_cost_base_v125+additional_hospitality_cost_base_v125+
         external_hospitality_cost_base_v125+internal_cost_base_v125+external_sale_cost_base_v125+
         coalesce(order_food_cost_base,0)+coalesce(actual_other_expense_base,0)+
         coalesce(actual_labor_cost_base,0)+waste_cost_base_v125))>0.0001) AS cost_breakdown_failures,
       count(*) FILTER (WHERE cost_incomplete_v125) AS events_needing_cost_review,
       count(*) FILTER (WHERE extra_due_currency_mismatch_v125>0) AS events_needing_currency_review
FROM public.event_financial_summary_v125;
ROLLBACK;
