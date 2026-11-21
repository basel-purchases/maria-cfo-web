-- Maria CFO v1.0.36: read-only verification after applying the migration.
-- Run in Supabase SQL Editor; NO modifications or resets.
SELECT 'historic_importer' AS check_name,
 to_regprocedure('public.v126_import_historic_invoices(text,jsonb,boolean)') IS NOT NULL AS ok
UNION ALL SELECT 'v136_import_readiness', to_regprocedure('public.v136_import_readiness()') IS NOT NULL
UNION ALL SELECT 'v136_deferred_cash_overview',to_regprocedure('public.v136_deferred_cash_overview()') IS NOT NULL
UNION ALL SELECT 'v136_retry_deferred_cash',to_regprocedure('public.v136_retry_deferred_cash(boolean,integer)') IS NOT NULL
UNION ALL SELECT 'v136_purchase_cash_trigger',EXISTS(SELECT 1 FROM pg_trigger t
 WHERE t.tgrelid='public.v126_historical_invoices'::regclass AND t.tgname='v136_purchase_archive_cash_trigger' AND t.tgenabled='O')
UNION ALL SELECT 'v136_sales_cash_trigger',EXISTS(SELECT 1 FROM pg_trigger t
 WHERE t.tgrelid='public.v134_sales_archive_documents'::regclass AND t.tgname='v136_sales_archive_cash_trigger' AND t.tgenabled='O');

SELECT 'purchases_saved' AS metric, count(*) AS value FROM public.v126_historical_invoices
UNION ALL SELECT 'sales_saved', count(*) FROM public.v134_sales_archive_documents
UNION ALL SELECT 'purchase_cash_posted', count(*) FROM public.v135_historical_cash_postings WHERE source_kind='purchase'
UNION ALL SELECT 'sales_cash_posted', count(*) FROM public.v135_historical_cash_postings WHERE source_kind='sale'
UNION ALL SELECT 'purchase_cash_deferred', count(*) FROM public.v136_historical_cash_deferred WHERE source_kind='purchase'
UNION ALL SELECT 'sales_cash_deferred', count(*) FROM public.v136_historical_cash_deferred WHERE source_kind='sale';

SELECT source_kind,error_code,count(*) AS affected,
 left(error_message,220) AS example_message
FROM public.v136_historical_cash_deferred
GROUP BY source_kind,error_code,left(error_message,220)
ORDER BY affected DESC,source_kind;
