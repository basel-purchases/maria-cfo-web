-- Maria CFO Web v1.0.20. READ ONLY. Run after the migration in Supabase SQL Editor.
-- Does not reset, truncate, delete, or modify any public data.
SELECT
  to_regprocedure('public.revise_purchase_invoice_v119(uuid,uuid,text,date,text,jsonb,text)') IS NOT NULL AS v119_revision_present,
  to_regprocedure('public.revise_purchase_invoice_v120(uuid,uuid,text,date,text,jsonb,text,timestamp with time zone)') IS NOT NULL AS v120_revision_present,
  to_regprocedure('public.void_purchase_invoice_v010(uuid,text)') IS NOT NULL AS void_fix_present,
  to_regprocedure('public.material_price_sync_current_fx_v120()') IS NOT NULL AS material_fx_sync_present,
  to_regprocedure('public.material_price_set_new_exchange_v120(numeric)') IS NOT NULL AS set_new_syp_present,
  to_regprocedure('public.supplier_delete_if_unused_v120(uuid)') IS NOT NULL AS safe_supplier_delete_present;

SELECT usd_to_base_rate AS approved_new_syp_per_usd
  FROM public.app_settings WHERE id=1;

SELECT count(*) AS usd_priced_materials,
       count(*) FILTER (WHERE price_syp_v110 IS DISTINCT FROM round(price_usd_v110 *
            (SELECT usd_to_base_rate FROM public.app_settings WHERE id=1),8)
            OR price_fx_rate_v110 IS DISTINCT FROM
            (SELECT usd_to_base_rate FROM public.app_settings WHERE id=1)) AS needs_fx_revaluation
  FROM public.materials WHERE price_usd_v110>0;

SELECT status,coalesce(is_voided,false) AS is_voided,count(*) AS invoice_count
  FROM public.purchase_invoices GROUP BY status,is_voided ORDER BY status,is_voided;

SELECT (SELECT count(*) FROM public.purchase_invoice_revisions_v119) AS revision_events,
       (SELECT count(*) FROM public.material_categories_v023) AS material_categories,
       (SELECT count(*) FROM public.materials WHERE category_id_v023 IS NOT NULL) AS classified_materials;
