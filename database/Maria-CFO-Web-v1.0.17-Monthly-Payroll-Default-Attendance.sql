-- Maria CFO Web v1.0.17
-- MONTHLY payroll: an unrecorded attendance day is presumed worked.
-- This migration does not create attendance records, modify salary amounts,
-- change posted payments, or change any employee's recorded exceptions.
-- Run ONCE (safe to rerun) in Supabase SQL Editor before uploading the website.
-- Requires the existing v0.14 monthly payroll functions and base payroll schema.

BEGIN;

DO $verify$
BEGIN
 IF to_regprocedure('public.create_monthly_payroll_v014(integer,integer)') IS NULL
    OR to_regprocedure('public.recalculate_monthly_payroll_v014(uuid)') IS NULL
    OR to_regprocedure('public.approve_payroll_run(uuid)') IS NULL THEN
   RAISE EXCEPTION 'V117_REQUIRES_EXISTING_MONTHLY_PAYROLL_FUNCTIONS_V014';
 END IF;
 IF to_regclass('public.payroll_items') IS NULL OR to_regclass('public.payroll_runs') IS NULL THEN
   RAISE EXCEPTION 'V117_MISSING_PAYROLL_TABLES';
 END IF;
END
$verify$;

-- Shared protected step: only the monthly *attendance-completeness marker*
-- is cleared. It does not waive an explicitly recorded shortage, absence,
-- deduction, advance or any previously calculated monetary amount.
CREATE OR REPLACE FUNCTION public.monthly_attendance_default_v117(p_payroll_run_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_run public.payroll_runs%ROWTYPE;
        v_affected integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_run FROM public.payroll_runs
 WHERE id=p_payroll_run_id FOR UPDATE;
 IF NOT FOUND OR v_run.status <> 'draft'
    OR COALESCE(v_run.note,'') NOT LIKE 'MARIA_MONTHLY_V014:%' THEN
   RAISE EXCEPTION 'V117_MONTHLY_DRAFT_REQUIRED';
 END IF;
 IF EXISTS (SELECT 1 FROM public.payroll_items pi
            WHERE pi.payroll_run_id=p_payroll_run_id
              AND pi.pay_type_snapshot<>'monthly') THEN
   RAISE EXCEPTION 'V117_NON_MONTHLY_ITEM_REQUIRES_RECALCULATION';
 END IF;
 UPDATE public.payroll_items pi
 SET missing_attendance_days=0
 WHERE pi.payroll_run_id=p_payroll_run_id
   AND pi.pay_type_snapshot='monthly'
   AND pi.missing_attendance_days IS DISTINCT FROM 0;
 GET DIAGNOSTICS v_affected=ROW_COUNT;
 RETURN v_affected;
END;
$fn$;

-- Only the v0.14 monthly workflow is wrapped. Existing daily/hourly RPCs
-- and the original approval checks remain untouched.
CREATE OR REPLACE FUNCTION public.create_monthly_payroll_v117(p_year integer,p_month integer)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 v_id:=public.create_monthly_payroll_v014(p_year,p_month);
 PERFORM public.monthly_attendance_default_v117(v_id);
 RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.recalculate_monthly_payroll_v117(p_payroll_run_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM public.recalculate_monthly_payroll_v014(p_payroll_run_id);
 PERFORM public.monthly_attendance_default_v117(p_payroll_run_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.approve_monthly_payroll_v117(p_payroll_run_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 -- Do NOT recalculate silently: the approved monetary snapshot must match
 -- what the owner reviewed. Existing advance balance checks still apply.
 PERFORM public.monthly_attendance_default_v117(p_payroll_run_id);
 PERFORM public.approve_payroll_run(p_payroll_run_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.monthly_attendance_default_v117(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_monthly_payroll_v117(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_monthly_payroll_v117(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_monthly_payroll_v117(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.monthly_attendance_default_v117(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_monthly_payroll_v117(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_monthly_payroll_v117(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_monthly_payroll_v117(uuid) TO authenticated;

-- Make already existing monthly drafts immediately consistent with the
-- new policy, without recalculating/approving/paying anything.
UPDATE public.payroll_items pi
SET missing_attendance_days=0
FROM public.payroll_runs pr
WHERE pi.payroll_run_id=pr.id
  AND pr.status='draft'
  AND pr.note LIKE 'MARIA_MONTHLY_V014:%'
  AND pi.pay_type_snapshot='monthly'
  AND pi.missing_attendance_days IS DISTINCT FROM 0;

COMMIT;

-- Verification (READ ONLY): all functions must be present.
SELECT p.proname AS function_name
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('monthly_attendance_default_v117',
    'create_monthly_payroll_v117','recalculate_monthly_payroll_v117',
    'approve_monthly_payroll_v117')
ORDER BY p.proname;
