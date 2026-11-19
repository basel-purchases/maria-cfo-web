-- Maria CFO v1.0.22: READ ONLY; verifies the migration and displays actual counts.
-- Run AFTER the new migration on the correct Supabase project.
SELECT
  now() AS checked_at,
  to_regprocedure('public.archive_voided_purchase_invoice_v122(uuid,boolean)') IS NOT NULL AS archive_function_ready,
  to_regprocedure('public.manage_material_category_v122(text,uuid,text)') IS NOT NULL AS category_function_ready,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_invoices'
      AND column_name='archived_at_v122'
  ) AS invoice_archive_column_ready,
  (SELECT count(*) FROM public.material_categories_v023) AS material_category_count,
  (SELECT count(*) FROM public.materials WHERE category_id_v023 IS NOT NULL) AS classified_material_count,
  (SELECT count(*) FROM public.materials WHERE category_id_v023 IS NULL) AS unclassified_material_count,
  (SELECT count(*) FROM public.purchase_invoices) AS total_invoice_count,
  (SELECT count(*) FROM public.purchase_invoices
     WHERE (status='voided' OR coalesce(is_voided,false))
       AND archived_at_v122 IS NULL) AS visible_voided_invoice_count,
  (SELECT count(*) FROM public.purchase_invoices
     WHERE archived_at_v122 IS NOT NULL) AS archived_voided_invoice_count;
