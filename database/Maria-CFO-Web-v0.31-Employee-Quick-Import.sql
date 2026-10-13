-- Maria CFO Web v0.31 — fifth central importer: monthly salaried employees from XLSX.
-- Prerequisite: run v0.30 Central Quick Imports migration FIRST.
-- Preserves all existing data. Owner-only, atomic, SHA-256 dedup, guarded 24-hour undo.
BEGIN;

ALTER TABLE public.employees
 ADD COLUMN IF NOT EXISTS residence_v031 text,
 ADD COLUMN IF NOT EXISTS mobile_phone_v031 text;

-- Extend the existing central import audit ledger without changing the four v0.30 importers.
ALTER TABLE public.quick_import_runs_v030 DROP CONSTRAINT IF EXISTS quick_import_runs_v030_kind_check;
ALTER TABLE public.quick_import_runs_v030 ADD CONSTRAINT quick_import_runs_v030_kind_check
 CHECK (kind IN ('master','assets','suppliers','orders','employees'));

CREATE OR REPLACE FUNCTION public.quick_import_employees_v031(
 p_filename text,p_sha256 text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_run uuid;v_previous uuid;v_summary jsonb;v_rec jsonb;
 v_id uuid;v_old jsonb;v_new jsonb;v_created int:=0;v_updated int:=0;
 v_name text;v_job text;v_phone text;v_home text;v_salary numeric;
 v_matches int;v_type text;v_currency text;v_size int;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(coalesce(p_filename,'')) NOT BETWEEN 1 AND 255 OR
    p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_IMPORT_FILE'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'array' OR pg_column_size(p_payload)>10000000 THEN
    RAISE EXCEPTION 'INVALID_EMPLOYEES_PAYLOAD'; END IF;
 v_size:=jsonb_array_length(p_payload);
 IF v_size NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_COUNT'; END IF;
 -- Same advisory lock and shared undo ordering as the four v0.30 importers.
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v030-central-import',0));
 SELECT id,summary INTO v_previous,v_summary FROM public.quick_import_runs_v030
  WHERE kind='employees' AND sha256=p_sha256 AND undone_at IS NULL LIMIT 1;
 IF v_previous IS NOT NULL THEN
  RETURN v_summary||jsonb_build_object('duplicateFile',true,'runId',v_previous);
 END IF;
 -- Validate all rows before creating any employee; SQL transaction also rolls back errors.
 FOR v_rec IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
  v_name:=btrim(coalesce(v_rec->>'name',''));
  v_job:=nullif(btrim(coalesce(v_rec->>'jobTitle','')),'');
  v_phone:=nullif(btrim(coalesce(v_rec->>'phone','')),'');
  v_home:=nullif(btrim(coalesce(v_rec->>'residence','')),'');
  IF length(v_name) NOT BETWEEN 1 AND 250 OR length(coalesce(v_job,''))>250 OR
     length(coalesce(v_phone,''))>40 OR length(coalesce(v_home,''))>200 OR
     (v_phone IS NOT NULL AND v_phone !~ '^[+0-9() .-]+$') OR
     coalesce(v_rec->>'monthlySalary','') !~ '^[0-9]+(\.[0-9]{1,4})?$'
  THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROW: %',v_name;END IF;
  v_salary:=(v_rec->>'monthlySalary')::numeric;
  IF v_salary<=0 OR v_salary>1000000000000 THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_MONTHLY_SALARY: %',v_name;END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_payload) x
        WHERE public.recipe_key_normalize_v027(x->>'name')=public.recipe_key_normalize_v027(v_name))>1
  THEN RAISE EXCEPTION 'DUPLICATE_EMPLOYEE_NAME_IN_FILE: %',v_name;END IF;
  SELECT count(*) INTO v_matches FROM public.employees
   WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name);
  IF v_matches>1 THEN RAISE EXCEPTION 'EMPLOYEE_NAME_AMBIGUOUS_IN_DATABASE: %',v_name;END IF;
  IF v_matches=1 THEN
   SELECT pay_type,wage_currency_code INTO v_type,v_currency FROM public.employees WHERE id=v_id;
   IF v_type<>'monthly' OR v_currency<>'SYP' THEN
    RAISE EXCEPTION 'EXISTING_EMPLOYEE_PAY_TYPE_OR_CURRENCY_CONFLICT: %',v_name;
   END IF;
  END IF;
 END LOOP;

 INSERT INTO public.quick_import_runs_v030(kind,filename,sha256)
 VALUES('employees',p_filename,p_sha256) RETURNING id INTO v_run;
 FOR v_rec IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
  v_name:=btrim(v_rec->>'name');v_job:=nullif(btrim(coalesce(v_rec->>'jobTitle','')),'');
  v_phone:=nullif(btrim(coalesce(v_rec->>'phone','')),'');
  v_home:=nullif(btrim(coalesce(v_rec->>'residence','')),'');
  v_salary:=(v_rec->>'monthlySalary')::numeric;
  v_id:=NULL;v_old:=NULL;
  SELECT id INTO v_id FROM public.employees
   WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name)
   LIMIT 1 FOR UPDATE;
  IF v_id IS NULL THEN
   INSERT INTO public.employees(name,job_title,pay_type,wage_currency_code,monthly_salary_original,
                                 residence_v031,mobile_phone_v031)
   VALUES(v_name,v_job,'monthly','SYP',v_salary,v_home,v_phone) RETURNING id INTO v_id;
   v_created:=v_created+1;
  ELSE
   SELECT to_jsonb(e) INTO v_old FROM public.employees e WHERE id=v_id;
   UPDATE public.employees SET
    job_title=coalesce(v_job,job_title),
    monthly_salary_original=v_salary,
    residence_v031=coalesce(v_home,residence_v031),
    mobile_phone_v031=coalesce(v_phone,mobile_phone_v031)
   WHERE id=v_id;
   v_updated:=v_updated+1;
  END IF;
  SELECT to_jsonb(e) INTO v_new FROM public.employees e WHERE id=v_id;
  PERFORM public.quick_import_log_v030(v_run,'employee',v_id::text,v_old,v_new);
 END LOOP;
 v_summary:=jsonb_build_object('created',v_created,'updated',v_updated,'review',0,'skipped',0,
  'employeesMonthly',v_created+v_updated,'duplicateFile',false,'runId',v_run,
  'undoUntil',(SELECT expires_at FROM public.quick_import_runs_v030 WHERE id=v_run),
  'note','All employees are monthly in SYP. No payroll runs or cash transactions created.');
 UPDATE public.quick_import_runs_v030 SET summary=v_summary WHERE id=v_run;
 RETURN v_summary;
END;$$;
REVOKE ALL ON FUNCTION public.quick_import_employees_v031(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.quick_import_employees_v031(text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.quick_import_employees_undo_v031(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_run public.quick_import_runs_v030%rowtype;
 v_change record;v_live jsonb;v_old jsonb;v_count int:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v030-central-import',0));
 SELECT * INTO v_run FROM public.quick_import_runs_v030 WHERE id=p_run_id FOR UPDATE;
 IF v_run.id IS NULL OR v_run.kind<>'employees' THEN RAISE EXCEPTION 'EMPLOYEE_IMPORT_NOT_FOUND';END IF;
 IF v_run.undone_at IS NOT NULL THEN RAISE EXCEPTION 'IMPORT_ALREADY_UNDONE';END IF;
 IF clock_timestamp()>=v_run.expires_at THEN RAISE EXCEPTION 'UNDO_24_HOUR_WINDOW_EXPIRED';END IF;
 IF EXISTS(SELECT 1 FROM public.quick_import_runs_v030 r
    WHERE r.undone_at IS NULL AND (r.created_at,r.id)>(v_run.created_at,v_run.id))
 THEN RAISE EXCEPTION 'UNDO_NEWER_IMPORT_FIRST';END IF;

 -- Never restore/delete an employee whose row or payroll-dependent activity has changed.
 FOR v_change IN SELECT * FROM public.quick_import_changes_v030 WHERE run_id=v_run.id ORDER BY seq LOOP
  IF v_change.entity_type<>'employee' THEN RAISE EXCEPTION 'UNDO_UNKNOWN_CHANGE_TYPE';END IF;
  SELECT to_jsonb(e) INTO v_live FROM public.employees e WHERE id=v_change.entity_key::uuid;
  IF v_live IS DISTINCT FROM v_change.after_state THEN
   RAISE EXCEPTION 'UNDO_EMPLOYEE_CHANGED_AFTER_IMPORT: %',v_change.entity_key; END IF;
  IF EXISTS(SELECT 1 FROM public.employee_attendance a
            WHERE a.employee_id=v_change.entity_key::uuid AND a.created_at>=v_run.created_at)
     OR EXISTS(SELECT 1 FROM public.payroll_items pi JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
            WHERE pi.employee_id=v_change.entity_key::uuid AND pr.created_at>=v_run.created_at)
     OR EXISTS(SELECT 1 FROM public.employee_advances a
            WHERE a.employee_id=v_change.entity_key::uuid AND a.created_at>=v_run.created_at)
  THEN RAISE EXCEPTION 'UNDO_EMPLOYEE_USED_AFTER_IMPORT: %',v_change.entity_key;END IF;
 END LOOP;
 FOR v_change IN SELECT * FROM public.quick_import_changes_v030 WHERE run_id=v_run.id ORDER BY seq DESC LOOP
  v_old:=v_change.before_state;
  IF v_old IS NULL THEN
   -- FK constraints reject deletion if the new employee has been used in another workflow.
   DELETE FROM public.employees WHERE id=v_change.entity_key::uuid;
  ELSE
   UPDATE public.employees SET
    job_title=v_old->>'job_title',
    monthly_salary_original=(v_old->>'monthly_salary_original')::numeric,
    residence_v031=v_old->>'residence_v031',
    mobile_phone_v031=v_old->>'mobile_phone_v031'
   WHERE id=v_change.entity_key::uuid;
  END IF;
  v_count:=v_count+1;
 END LOOP;
 UPDATE public.quick_import_runs_v030 SET undone_at=now() WHERE id=v_run.id;
 RETURN jsonb_build_object('undone',true,'runId',v_run.id,'restoredChanges',v_count,
   'message','تم التراجع عن استيراد الموظفين مع الحفاظ على سجل العملية.');
END;$$;
REVOKE ALL ON FUNCTION public.quick_import_employees_undo_v031(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.quick_import_employees_undo_v031(uuid) TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
