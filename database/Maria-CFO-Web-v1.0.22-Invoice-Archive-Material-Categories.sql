-- Maria CFO Web v1.0.22
-- Apply ONLY after all previous migrations through v1.0.20 on a tested database.
-- Non-destructive: no invoice, stock movement, supplier payment, or category is
-- removed or updated by merely applying this migration.
-- "Delete cancelled invoice" is a reversible archive of its LISTING only.
-- Never hard-delete a posted and reversed financial document.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
BEGIN
  IF to_regclass('public.purchase_invoices') IS NULL OR
     to_regclass('public.material_categories_v023') IS NULL OR
     to_regclass('public.materials') IS NULL OR
     to_regprocedure('public.is_app_owner()') IS NULL THEN
    RAISE EXCEPTION 'V122_REQUIRED_TABLE_OR_OWNER_FUNCTION_MISSING';
  END IF;
END;
$preflight$;

ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS archived_at_v122 timestamptz;
COMMENT ON COLUMN public.purchase_invoices.archived_at_v122 IS
  'Hide a cancelled invoice from ordinary lists; never delete financial or inventory audit history.';
CREATE INDEX IF NOT EXISTS purchase_invoices_archived_at_v122_idx
  ON public.purchase_invoices (archived_at_v122)
  WHERE archived_at_v122 IS NOT NULL;

CREATE OR REPLACE FUNCTION public.archive_voided_purchase_invoice_v122(
  p_invoice_id uuid, p_restore boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_invoice public.purchase_invoices%ROWTYPE;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_invoice_id IS NULL OR p_restore IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_ARCHIVE_BAD_REQUEST';
  END IF;
  SELECT * INTO v_invoice FROM public.purchase_invoices
   WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PURCHASE_INVOICE_NOT_FOUND'; END IF;
  IF v_invoice.status <> 'voided' AND NOT coalesce(v_invoice.is_voided,false) THEN
    RAISE EXCEPTION 'PURCHASE_ARCHIVE_REQUIRES_VOIDED';
  END IF;
  UPDATE public.purchase_invoices
    SET archived_at_v122=CASE WHEN p_restore THEN NULL ELSE coalesce(archived_at_v122,now()) END
    WHERE id=p_invoice_id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.archive_voided_purchase_invoice_v122(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_voided_purchase_invoice_v122(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_material_category_v122(
  p_action text, p_category_id uuid DEFAULT NULL, p_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_name text := regexp_replace(btrim(coalesce(p_name,'')), '[[:space:]]+', ' ', 'g');
  v_id uuid;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_action NOT IN ('add','rename','delete') OR p_action IS NULL THEN
    RAISE EXCEPTION 'MATERIAL_CATEGORY_ACTION_INVALID';
  END IF;
  IF p_action IN ('add','rename') THEN
    IF length(v_name) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'MATERIAL_CATEGORY_NAME_INVALID';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('maria-mcategory:'||lower(v_name),0));
    SELECT id INTO v_id FROM public.material_categories_v023
      WHERE lower(btrim(name))=lower(v_name)
      LIMIT 1;
    IF p_action='add' THEN
      IF v_id IS NOT NULL THEN RETURN v_id; END IF;
      INSERT INTO public.material_categories_v023(name)
        VALUES(v_name) RETURNING id INTO v_id;
      RETURN v_id;
    END IF;
    IF p_category_id IS NULL THEN RAISE EXCEPTION 'MATERIAL_CATEGORY_NOT_FOUND'; END IF;
    IF v_id IS NOT NULL AND v_id<>p_category_id THEN
      RAISE EXCEPTION 'MATERIAL_CATEGORY_EXISTS';
    END IF;
    UPDATE public.material_categories_v023 SET name=v_name
      WHERE id=p_category_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'MATERIAL_CATEGORY_NOT_FOUND'; END IF;
    RETURN v_id;
  END IF;
  IF p_category_id IS NULL THEN RAISE EXCEPTION 'MATERIAL_CATEGORY_NOT_FOUND'; END IF;
  -- Avoid ON DELETE SET NULL on materials: a category with materials may not be deleted.
  SELECT id INTO v_id FROM public.material_categories_v023
    WHERE id=p_category_id FOR UPDATE;
  IF v_id IS NULL THEN RAISE EXCEPTION 'MATERIAL_CATEGORY_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.materials WHERE category_id_v023=p_category_id) THEN
    RAISE EXCEPTION 'MATERIAL_CATEGORY_IN_USE';
  END IF;
  DELETE FROM public.material_categories_v023 WHERE id=p_category_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.manage_material_category_v122(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_material_category_v122(text,uuid,text) TO authenticated;

COMMIT;
