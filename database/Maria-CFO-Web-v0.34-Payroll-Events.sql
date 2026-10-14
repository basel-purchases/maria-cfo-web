-- Maria CFO Web v0.34 | Unified payroll payment + restaurant event operations.
-- Prerequisites: the existing base schema and v0.14/v0.23/v0.31/v0.32 migrations.
-- No existing payroll, booking, cashbox or event data is deleted or rewritten.
BEGIN;

-- An auditable, read-only snapshot of salary preparation. No browser-side salary math.
CREATE OR REPLACE FUNCTION public.payroll_ready_v034(p_month date)
RETURNS TABLE(
 payroll_item_id uuid, payroll_run_id uuid, employee_id uuid, employee_name text,
 period_start date, period_end date, run_status text, pay_type text, currency_code text,
 base_pay_original numeric, overtime_pay_original numeric, bonus_original numeric,
 shortage_deduction_original numeric, manual_deduction_original numeric,
 advance_deduction_original numeric, net_due_original numeric, paid_original numeric,
 remaining_original numeric, missing_attendance_days integer, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT pi.id, pr.id, pi.employee_id, pi.employee_name_snapshot,
 pr.period_start,pr.period_end,pr.status,pi.pay_type_snapshot,pi.currency_code,
 pi.base_pay_original,pi.overtime_pay_original,pi.bonus_original,
 pi.shortage_deduction_original,pi.manual_deduction_original,
 pi.advance_deduction_original,pi.net_due_original,
 COALESCE(pb.paid_original,0),COALESCE(pb.remaining_original,pi.net_due_original),
 pi.missing_attendance_days,pi.note
 FROM public.payroll_items pi
 JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
 LEFT JOIN public.payroll_item_balances pb ON pb.payroll_item_id=pi.id
 WHERE public.is_app_owner() AND p_month IS NOT NULL AND
   pr.period_start >= date_trunc('month',p_month)::date AND
   pr.period_start < (date_trunc('month',p_month)+interval '1 month')::date
   AND pr.status IN ('draft','approved','closed')
 ORDER BY pi.employee_name_snapshot,pr.period_start,pi.id;
$$;

CREATE OR REPLACE FUNCTION public.payroll_paid_v034(p_month date)
RETURNS TABLE(payment_id uuid,employee_id uuid,employee_name text,paid_at timestamptz,
 period_start date,period_end date,payment_kind text,currency_code text,
 amount_original numeric,bonus_original numeric,manual_deduction_original numeric,
 advance_deduction_original numeric,cashbox_id uuid,note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT pp.id AS payment_id,pp.employee_id,pi.employee_name_snapshot AS employee_name,
 pp.occurred_at AS paid_at,pr.period_start,pr.period_end,
 CASE WHEN pr.note LIKE 'MARIA_DAILY_V014:%' THEN 'daily' ELSE pi.pay_type_snapshot END,
 pp.currency_code,pp.amount_original,pi.bonus_original,pi.manual_deduction_original,
 pi.advance_deduction_original,pp.cashbox_id,pp.note
 FROM public.payroll_payments pp
 JOIN public.payroll_items pi ON pi.id=pp.payroll_item_id
 JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
 CROSS JOIN public.app_settings s
 WHERE public.is_app_owner() AND pp.status='posted' AND p_month IS NOT NULL
 AND (pp.occurred_at AT TIME ZONE s.timezone)::date>=date_trunc('month',p_month)::date
 AND (pp.occurred_at AT TIME ZONE s.timezone)::date<(date_trunc('month',p_month)+interval '1 month')::date
 UNION ALL
 SELECT fp.id,fp.employee_id,e.name,fp.occurred_at,fp.work_date,fp.work_date,
 'fixed'::text,fp.currency_code,fp.paid_original,0::numeric,0::numeric,
 fp.advance_deducted_original,fp.cashbox_id,fp.note
 FROM public.employee_fixed_payments_v023 fp
 JOIN public.employees e ON e.id=fp.employee_id
 CROSS JOIN public.app_settings s
 WHERE public.is_app_owner() AND p_month IS NOT NULL
 AND (fp.occurred_at AT TIME ZONE s.timezone)::date>=date_trunc('month',p_month)::date
 AND (fp.occurred_at AT TIME ZONE s.timezone)::date<(date_trunc('month',p_month)+interval '1 month')::date
 ORDER BY paid_at DESC,payment_id;
$$;

-- One click = one atomic cash transaction. Selected box does not silently overwrite app settings.
CREATE OR REPLACE FUNCTION public.pay_approved_salary_v034(
 p_payroll_item_id uuid,p_amount numeric,p_cashbox_id uuid,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_item record;v_remaining numeric;v_payment uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_cashbox_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.cashboxes
    WHERE id=p_cashbox_id AND is_active) THEN RAISE EXCEPTION 'PAYROLL_CASHBOX_INVALID'; END IF;
 SELECT pi.id,pi.currency_code,pr.status INTO v_item FROM public.payroll_items pi
 JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
 WHERE pi.id=p_payroll_item_id FOR UPDATE OF pi;
 IF NOT FOUND OR v_item.status NOT IN('approved','closed') THEN
   RAISE EXCEPTION 'PAYROLL_NOT_APPROVED'; END IF;
 SELECT remaining_original INTO v_remaining FROM public.payroll_item_balances
 WHERE payroll_item_id=p_payroll_item_id;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount>COALESCE(v_remaining,0)+0.0001 THEN
  RAISE EXCEPTION 'INVALID_SALARY_PAYMENT_AMOUNT'; END IF;
 PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
 v_payment:=public.record_payroll_payment(p_payroll_item_id,p_cashbox_id,p_amount,
    v_item.currency_code,now(),p_amount,
    'صرف راتب v0.34'||CASE WHEN NULLIF(btrim(p_note),'') IS NULL THEN '' ELSE ' | '||left(btrim(p_note),300) END);
 RETURN v_payment;
END;
$$;

-- Daily wages already have a protected settlement function. Keep selection transactional
-- by using the same logic without editing the shared payroll_cashbox_id setting.
CREATE OR REPLACE FUNCTION public.pay_daily_wage_v034(
 p_employee_id uuid,p_work_date date,p_cashbox_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_emp public.employees%ROWTYPE;v_att public.employee_attendance%ROWTYPE;
 v_run uuid;v_item public.payroll_items%ROWTYPE;v_note text;v_today date;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_cashbox_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.cashboxes
   WHERE id=p_cashbox_id AND is_active) THEN RAISE EXCEPTION 'PAYROLL_CASHBOX_INVALID'; END IF;
 SELECT (now() AT TIME ZONE timezone)::date INTO v_today FROM public.app_settings WHERE id=1;
 IF p_work_date IS NULL OR p_work_date>v_today THEN RAISE EXCEPTION 'INVALID_WAGE_WORK_DATE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('maria_daily_v014:'||p_employee_id::text||':'||p_work_date::text));
 SELECT * INTO v_emp FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND OR v_emp.pay_type NOT IN('daily','hourly') THEN RAISE EXCEPTION 'DAILY_PAYROLL_REQUIRES_DAILY_OR_HOURLY'; END IF;
 SELECT * INTO v_att FROM public.employee_attendance
  WHERE employee_id=p_employee_id AND work_date=p_work_date FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ATTENDANCE_MUST_BE_RECORDED'; END IF;
 IF (v_emp.hire_date IS NOT NULL AND p_work_date<v_emp.hire_date) OR
    (v_emp.termination_date IS NOT NULL AND p_work_date>v_emp.termination_date) THEN
  RAISE EXCEPTION 'WORK_DATE_OUTSIDE_EMPLOYMENT'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_items pi JOIN public.payroll_runs pr
   ON pr.id=pi.payroll_run_id WHERE pi.employee_id=p_employee_id AND
   p_work_date BETWEEN pr.period_start AND pr.period_end AND pr.status IN('approved','closed'))
 THEN RAISE EXCEPTION 'DAILY_WAGE_ALREADY_SETTLED'; END IF;
 v_note:='MARIA_DAILY_V014:'||p_employee_id::text||':'||p_work_date::text;
 IF EXISTS(SELECT 1 FROM public.payroll_runs WHERE note=v_note) THEN
  RAISE EXCEPTION 'DAILY_WAGE_ALREADY_PREPARED'; END IF;
 INSERT INTO public.payroll_runs(period_start,period_end,note)
 VALUES(p_work_date,p_work_date,v_note) RETURNING id INTO v_run;
 PERFORM public.recalculate_payroll_run(v_run);
 UPDATE public.employee_payroll_adjustments a SET payroll_item_id=NULL
 WHERE a.status='pending' AND a.payroll_item_id IN (
   SELECT id FROM public.payroll_items WHERE payroll_run_id=v_run AND employee_id<>p_employee_id);
 DELETE FROM public.payroll_items WHERE payroll_run_id=v_run AND employee_id<>p_employee_id;
 SELECT * INTO v_item FROM public.payroll_items WHERE payroll_run_id=v_run AND employee_id=p_employee_id;
 IF NOT FOUND OR v_item.missing_attendance_days>0 THEN RAISE EXCEPTION 'DAILY_PAYROLL_NO_VALID_ATTENDANCE'; END IF;
 IF v_item.net_due_original<=0 THEN RAISE EXCEPTION 'DAILY_PAYROLL_NO_AMOUNT_DUE'; END IF;
 PERFORM public.approve_payroll_run(v_run);
 PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
 RETURN public.record_payroll_payment(v_item.id,p_cashbox_id,v_item.net_due_original,
  v_item.currency_code,now(),v_item.net_due_original,'صرف أجر يوم '||p_work_date::text);
END;
$$;

-- Safe event extras: separate bill for items NOT INCLUDED in the party package.
CREATE TABLE IF NOT EXISTS public.event_activity_v034(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 activity_type text NOT NULL CHECK(activity_type IN('note','incident','table','booking','extra','payment','waste','closing')),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 2 AND 1000),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_activity_v034_idx ON public.event_activity_v034(event_id,occurred_at DESC);
ALTER TABLE public.event_activity_v034 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maria_event_activity_owner_v034 ON public.event_activity_v034;
CREATE POLICY maria_event_activity_owner_v034 ON public.event_activity_v034 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_activity_v034 TO authenticated;

CREATE OR REPLACE FUNCTION public.record_event_activity_v034(
 p_event_id uuid,p_activity_type text,p_description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id) THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
 IF p_activity_type NOT IN('note','incident') OR length(btrim(coalesce(p_description,''))) NOT BETWEEN 2 AND 1000 THEN
  RAISE EXCEPTION 'EVENT_ACTIVITY_INVALID'; END IF;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,p_activity_type,btrim(p_description)) RETURNING id INTO v_id;
 RETURN v_id;
END;
$$;

CREATE TABLE IF NOT EXISTS public.event_extras_v034(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
 table_id uuid NOT NULL REFERENCES public.event_tables(id) ON DELETE RESTRICT,
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 2 AND 180),
 quantity numeric(14,3) NOT NULL CHECK(quantity>0),
 unit_price_original numeric(20,4) NOT NULL CHECK(unit_price_original>=0),
 menu_item_id uuid REFERENCES public.menu_items(id),
 unit_cost_base numeric(20,4) NOT NULL DEFAULT 0 CHECK(unit_cost_base>=0),
 total_cost_base numeric(20,4) GENERATED ALWAYS AS (round(quantity*unit_cost_base,4)) STORED,
 amount_original numeric(20,4) GENERATED ALWAYS AS (round(quantity*unit_price_original,4)) STORED,
 currency_code text NOT NULL REFERENCES public.currencies(code),
 exchange_rate_to_base numeric(20,8) NOT NULL CHECK(exchange_rate_to_base>0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','paid','refunded','voided')),
 cashbox_transaction_id uuid UNIQUE REFERENCES public.cashbox_transactions(id) ON DELETE RESTRICT,
 refund_transaction_id uuid UNIQUE REFERENCES public.cashbox_transactions(id) ON DELETE RESTRICT,
 paid_amount_base numeric(20,4),
 paid_at timestamptz, void_reason text, voided_at timestamptz,
 notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_extras_v034_event_idx ON public.event_extras_v034(event_id,status,table_id);
CREATE TABLE IF NOT EXISTS public.event_planner_settings_v034(
 event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
 target_margin_percent numeric(5,2) NOT NULL DEFAULT 25 CHECK(target_margin_percent>=0 AND target_margin_percent<95),
 waste_reserve_percent numeric(5,2) NOT NULL DEFAULT 5 CHECK(waste_reserve_percent>=0 AND waste_reserve_percent<=100),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_planner_settings_v034 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maria_event_planner_owner_v034 ON public.event_planner_settings_v034;
CREATE POLICY maria_event_planner_owner_v034 ON public.event_planner_settings_v034 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_planner_settings_v034 TO authenticated;

CREATE OR REPLACE FUNCTION public.save_event_planner_v034(p_event_id uuid,p_margin numeric,p_waste numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed'))
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF p_margin IS NULL OR p_margin<0 OR p_margin>=95 OR
   p_waste IS NULL OR p_waste<0 OR p_waste>100 THEN RAISE EXCEPTION 'EVENT_PLANNER_INVALID'; END IF;
 INSERT INTO public.event_planner_settings_v034(event_id,target_margin_percent,waste_reserve_percent)
 VALUES(p_event_id,p_margin,p_waste)
 ON CONFLICT(event_id) DO UPDATE SET target_margin_percent=excluded.target_margin_percent,
 waste_reserve_percent=excluded.waste_reserve_percent,updated_at=now();
END;
$$;

CREATE TABLE IF NOT EXISTS public.event_waste_v034(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 2 AND 180),
 quantity numeric(14,3) NOT NULL CHECK(quantity>0),
 unit_cost_base numeric(20,4) NOT NULL CHECK(unit_cost_base>=0),
 total_cost_base numeric(20,4) GENERATED ALWAYS AS(round(quantity*unit_cost_base,4)) STORED,
 reason text, status text NOT NULL DEFAULT 'active' CHECK(status IN('active','voided')),
 void_reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_waste_v034_event_idx ON public.event_waste_v034(event_id,status);
ALTER TABLE public.event_extras_v034 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_waste_v034 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maria_event_extras_owner_v034 ON public.event_extras_v034;
CREATE POLICY maria_event_extras_owner_v034 ON public.event_extras_v034 FOR SELECT TO authenticated USING(public.is_app_owner());
DROP POLICY IF EXISTS maria_event_waste_owner_v034 ON public.event_waste_v034;
CREATE POLICY maria_event_waste_owner_v034 ON public.event_waste_v034 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_extras_v034,public.event_waste_v034 TO authenticated;

CREATE OR REPLACE FUNCTION public.save_event_plan_v034(
 p_event_id uuid,p_guests integer,p_ticket_price numeric,p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_guests IS NULL OR p_guests<0 OR p_guests>100000 OR
    p_ticket_price IS NULL OR p_ticket_price<0 THEN RAISE EXCEPTION 'EVENT_PLAN_INVALID'; END IF;
 UPDATE public.events SET planned_guest_count=p_guests,default_price_original=p_ticket_price,
   notes=left(coalesce(p_notes,''),2000)
 WHERE id=p_event_id AND status IN('planning','open','confirmed');
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_event_status_v034(p_event_id uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_status NOT IN('planning','open','confirmed') THEN RAISE EXCEPTION 'EVENT_STATUS_INVALID'; END IF;
 UPDATE public.events SET status=p_status WHERE id=p_event_id AND status IN('planning','open','confirmed');
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_event_table_v034(
 p_event_id uuid,p_table_id uuid,p_label text,p_capacity integer,
 p_guests integer,p_actual_guests integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;v_event public.events%ROWTYPE;v_old_guests integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.status NOT IN('planning','open','confirmed') THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF length(btrim(coalesce(p_label,''))) NOT BETWEEN 1 AND 50 OR
    p_capacity IS NULL OR p_capacity<1 OR p_capacity>1000 OR
    p_guests IS NULL OR p_guests<0 OR p_guests>p_capacity OR
    (p_actual_guests IS NOT NULL AND (p_actual_guests<0 OR p_actual_guests>p_capacity)) THEN
  RAISE EXCEPTION 'EVENT_TABLE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_tables WHERE event_id=p_event_id AND
    lower(btrim(table_label))=lower(btrim(p_label)) AND status<>'cancelled' AND
    (p_table_id IS NULL OR id<>p_table_id)) THEN RAISE EXCEPTION 'EVENT_TABLE_DUPLICATE'; END IF;
 IF p_table_id IS NULL THEN
  INSERT INTO public.event_tables(event_id,table_label,capacity,planned_guest_count,actual_guest_count,status)
  VALUES(p_event_id,btrim(p_label),p_capacity,p_guests,p_actual_guests,'available') RETURNING id INTO v_id;
  INSERT INTO public.event_activity_v034(event_id,activity_type,description)
   VALUES(p_event_id,'table','فتح طاولة جديدة: '||btrim(p_label)||' · الضيوف '||p_guests);
 ELSE
  SELECT planned_guest_count INTO v_old_guests FROM public.event_tables WHERE id=p_table_id AND event_id=p_event_id FOR UPDATE;
  UPDATE public.event_tables SET table_label=btrim(p_label),capacity=p_capacity,
   planned_guest_count=p_guests,actual_guest_count=p_actual_guests
  WHERE id=p_table_id AND event_id=p_event_id AND status<>'cancelled' RETURNING id INTO v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_TABLE_NOT_FOUND'; END IF;
  IF v_old_guests IS DISTINCT FROM p_guests THEN
   INSERT INTO public.event_activity_v034(event_id,activity_type,description)
   VALUES(p_event_id,'table','تعديل توزيع '||btrim(p_label)||' من '||coalesce(v_old_guests,0)||' إلى '||p_guests||' ضيوف');
  END IF;
 END IF;
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_event_rule_v034(
 p_event_id uuid,p_rule_id uuid,p_menu_item_id uuid,p_rule_type text,
 p_qty numeric,p_people numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed')) THEN
  RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.menu_items WHERE id=p_menu_item_id AND is_active) THEN
  RAISE EXCEPTION 'EVENT_MENU_ITEM_INVALID'; END IF;
 IF p_rule_type NOT IN('per_person','per_n_people','per_table','fixed_event') OR
   p_qty IS NULL OR p_qty<=0 OR p_qty>10000 OR
   (p_rule_type='per_n_people' AND (p_people IS NULL OR p_people<1 OR p_people<>trunc(p_people))) THEN
   RAISE EXCEPTION 'EVENT_RULE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_menu_rules WHERE event_id=p_event_id AND menu_item_id=p_menu_item_id
   AND rule_type=p_rule_type AND (p_rule_id IS NULL OR id<>p_rule_id)) THEN RAISE EXCEPTION 'EVENT_RULE_DUPLICATE'; END IF;
 IF p_rule_id IS NULL THEN
  INSERT INTO public.event_menu_rules(event_id,menu_item_id,rule_type,quantity_per_rule,people_per_rule)
  VALUES(p_event_id,p_menu_item_id,p_rule_type,p_qty,CASE WHEN p_rule_type='per_n_people' THEN p_people ELSE NULL END)
  RETURNING id INTO v_id;
 ELSE
  UPDATE public.event_menu_rules SET menu_item_id=p_menu_item_id,rule_type=p_rule_type,
   quantity_per_rule=p_qty,people_per_rule=CASE WHEN p_rule_type='per_n_people' THEN p_people ELSE NULL END
  WHERE id=p_rule_id AND event_id=p_event_id RETURNING id INTO v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_RULE_NOT_FOUND'; END IF;
 END IF;
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_event_rule_v034(p_event_id uuid,p_rule_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed')) THEN
  RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 DELETE FROM public.event_menu_rules WHERE id=p_rule_id AND event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_RULE_NOT_FOUND'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_event_table_booking_v034(
 p_event_id uuid,p_table_id uuid,p_customer_name text,p_guests integer,
 p_amount numeric,p_phone text DEFAULT NULL,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_table public.event_tables%ROWTYPE;v_event public.events%ROWTYPE;v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.status NOT IN('planning','open','confirmed') THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF p_guests IS NULL OR p_guests<=0 OR p_amount IS NULL OR p_amount<0 OR
   length(btrim(coalesce(p_customer_name,'')))<2 THEN RAISE EXCEPTION 'EVENT_BOOKING_INVALID'; END IF;
 IF p_table_id IS NOT NULL THEN
  SELECT * INTO v_table FROM public.event_tables WHERE id=p_table_id AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_table.booking_id IS NOT NULL OR v_table.status IN('cancelled','completed') OR
     (v_table.capacity IS NOT NULL AND p_guests>v_table.capacity) THEN
     RAISE EXCEPTION 'EVENT_TABLE_NOT_AVAILABLE'; END IF;
 END IF;
 v_id:=public.create_event_booking(p_event_id,btrim(p_customer_name),p_guests,p_phone,
    'fixed',p_amount,v_event.price_currency_code,NULL,p_note);
 IF p_table_id IS NOT NULL THEN
  UPDATE public.event_tables SET booking_id=v_id,status='reserved',planned_guest_count=p_guests WHERE id=p_table_id;
 END IF;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'booking','تسجيل حجز '||btrim(p_customer_name)||' · '||p_guests||' ضيوف');
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_event_extra_v034(
 p_event_id uuid,p_table_id uuid,p_description text,p_quantity numeric,
 p_unit_price numeric,p_note text DEFAULT NULL,
 p_menu_item_id uuid DEFAULT NULL,p_unit_cost_base numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_currency text;v_rate numeric;v_id uuid;v_recipe_cost numeric;v_missing boolean;v_cost numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT price_currency_code,price_exchange_rate_to_base INTO v_currency,v_rate FROM public.events
 WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_tables WHERE id=p_table_id AND event_id=p_event_id
   AND status<>'cancelled') THEN RAISE EXCEPTION 'EVENT_TABLE_NOT_FOUND'; END IF;
 IF length(btrim(coalesce(p_description,''))) NOT BETWEEN 2 AND 180 OR
  p_quantity IS NULL OR p_quantity<=0 OR p_quantity>100000 OR
  p_unit_price IS NULL OR p_unit_price<=0 OR (p_unit_cost_base IS NOT NULL AND p_unit_cost_base<0)
 THEN RAISE EXCEPTION 'EVENT_EXTRA_INVALID'; END IF;
 IF p_menu_item_id IS NOT NULL THEN
  SELECT recipe_cost_base,has_missing_cost INTO v_recipe_cost,v_missing
  FROM public.menu_item_costs WHERE id=p_menu_item_id;
  IF NOT FOUND OR v_missing OR v_recipe_cost IS NULL THEN RAISE EXCEPTION 'EVENT_EXTRA_FOOD_COST_INCOMPLETE'; END IF;
  v_cost:=v_recipe_cost;
 ELSE
  IF p_unit_cost_base IS NULL THEN RAISE EXCEPTION 'EVENT_EXTRA_COST_REQUIRED'; END IF;
  v_cost:=p_unit_cost_base;
 END IF;
 INSERT INTO public.event_extras_v034(event_id,table_id,description,quantity,unit_price_original,currency_code,exchange_rate_to_base,notes,menu_item_id,unit_cost_base)
 VALUES(p_event_id,p_table_id,btrim(p_description),p_quantity,p_unit_price,v_currency,v_rate,left(p_note,500),p_menu_item_id,v_cost)
 RETURNING id INTO v_id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'extra','طلب إضافي: '||btrim(p_description)||' · الكمية '||p_quantity);
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_event_extra_v034(p_extra_id uuid,p_cashbox_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_extra public.event_extras_v034%ROWTYPE;v_tx uuid;v_amount_base numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_extra FROM public.event_extras_v034 WHERE id=p_extra_id FOR UPDATE;
 IF NOT FOUND OR v_extra.status<>'pending' THEN RAISE EXCEPTION 'EVENT_EXTRA_ALREADY_SETTLED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active) THEN
  RAISE EXCEPTION 'PAYROLL_CASHBOX_INVALID'; END IF;
 PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
 v_tx:=public.record_cashbox_transaction(p_cashbox_id,'in','event',v_extra.amount_original,
   v_extra.currency_code,now(),'فاتورة إضافية للطاولة: '||v_extra.description,
   'event_extra_v034',v_extra.id);
 SELECT amount_base INTO v_amount_base FROM public.cashbox_transactions WHERE id=v_tx;
 UPDATE public.event_extras_v034 SET status='paid',cashbox_transaction_id=v_tx,
  paid_amount_base=v_amount_base,paid_at=now() WHERE id=v_extra.id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(v_extra.event_id,'payment','تحصيل طلب إضافي: '||v_extra.description||' · '||v_extra.amount_original||' '||v_extra.currency_code);
 RETURN v_tx;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_event_extra_v034(p_extra_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 UPDATE public.event_extras_v034 SET status='voided',void_reason=left(btrim(p_reason),500),voided_at=now()
 WHERE id=p_extra_id AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_EXTRA_ALREADY_SETTLED'; END IF;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 SELECT event_id,'extra','إلغاء طلب إضافي: '||description FROM public.event_extras_v034 WHERE id=p_extra_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_event_extra_v034(p_extra_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_extra public.event_extras_v034%ROWTYPE;v_cashbox uuid;v_tx uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 SELECT * INTO v_extra FROM public.event_extras_v034 WHERE id=p_extra_id FOR UPDATE;
 IF NOT FOUND OR v_extra.status<>'paid' THEN RAISE EXCEPTION 'EVENT_EXTRA_NOT_PAID'; END IF;
 SELECT cashbox_id INTO v_cashbox FROM public.cashbox_transactions WHERE id=v_extra.cashbox_transaction_id;
 PERFORM public.ensure_cashbox_session_v013(v_cashbox,now());
 v_tx:=public.record_cashbox_transaction(v_cashbox,'out','refund',v_extra.amount_original,
  v_extra.currency_code,now(),'إعادة مبلغ إضافي: '||left(btrim(p_reason),300),'event_extra_refund_v034',v_extra.id);
 UPDATE public.event_extras_v034 SET status='refunded',refund_transaction_id=v_tx,
   void_reason=left(btrim(p_reason),500),voided_at=now() WHERE id=v_extra.id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description) VALUES(v_extra.event_id,'payment','إرجاع مبلغ: '||v_extra.description||' · '||v_extra.amount_original||' '||v_extra.currency_code);
 RETURN v_tx;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_event_waste_v034(
 p_event_id uuid,p_description text,p_qty numeric,p_unit_cost_base numeric,p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND status<>'cancelled') THEN
   RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
 IF length(btrim(coalesce(p_description,''))) NOT BETWEEN 2 AND 180 OR
  p_qty IS NULL OR p_qty<=0 OR p_unit_cost_base IS NULL OR p_unit_cost_base<0 THEN
   RAISE EXCEPTION 'EVENT_WASTE_INVALID'; END IF;
 INSERT INTO public.event_waste_v034(event_id,description,quantity,unit_cost_base,reason)
 VALUES(p_event_id,btrim(p_description),p_qty,p_unit_cost_base,left(p_reason,500)) RETURNING id INTO v_id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'waste','تسجيل هدر إضافي: '||btrim(p_description)||' · '||p_qty);
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_event_waste_v034(p_waste_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 UPDATE public.event_waste_v034 SET status='voided',void_reason=left(btrim(p_reason),500)
 WHERE id=p_waste_id AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_WASTE_ALREADY_VOIDED'; END IF;
END;
$$;

-- Event cannot close while a guest/table owes money or while menu recipe costs are missing.
-- The canonical complete_event RPC still owns inventory posting and finalization.
CREATE OR REPLACE FUNCTION public.complete_event_safe_v034(p_event_id uuid,p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_guests integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE)
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_extras_v034 WHERE event_id=p_event_id AND status='pending') THEN
  RAISE EXCEPTION 'EVENT_HAS_UNPAID_EXTRAS'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_booking_balances WHERE event_id=p_event_id AND
   booking_status NOT IN('cancelled','no_show') AND balance_original>0.0001) THEN
  RAISE EXCEPTION 'EVENT_HAS_UNPAID_BOOKINGS'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_menu_requirements WHERE event_id=p_event_id
     AND has_missing_cost AND required_quantity>0) THEN RAISE EXCEPTION 'EVENT_FOOD_COST_INCOMPLETE'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_tables WHERE event_id=p_event_id AND status<>'cancelled'
     AND actual_guest_count IS NULL) THEN RAISE EXCEPTION 'EVENT_GUEST_COUNT_REQUIRED'; END IF;
 SELECT COALESCE(SUM(actual_guest_count),0)::integer
 INTO v_guests FROM public.event_tables WHERE event_id=p_event_id AND status<>'cancelled';
 IF v_guests IS NULL OR v_guests<1 THEN RAISE EXCEPTION 'EVENT_GUEST_COUNT_REQUIRED'; END IF;
 PERFORM public.complete_event(p_event_id,v_guests,now(),left(p_notes,500));
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'closing','إقفال الحفلة بعدد حضور '||v_guests||' ضيف');
END;
$$;

-- All changes require the owner. Authenticated clients have EXECUTE only on controlled RPCs.
REVOKE ALL ON FUNCTION public.payroll_ready_v034(date),public.payroll_paid_v034(date),
 public.pay_approved_salary_v034(uuid,numeric,uuid,text),public.pay_daily_wage_v034(uuid,date,uuid),
 public.save_event_plan_v034(uuid,integer,numeric,text),public.set_event_status_v034(uuid,text),
 public.save_event_table_v034(uuid,uuid,text,integer,integer,integer),
 public.save_event_rule_v034(uuid,uuid,uuid,text,numeric,numeric),
 public.delete_event_rule_v034(uuid,uuid),
 public.create_event_table_booking_v034(uuid,uuid,text,integer,numeric,text,text),
 public.add_event_extra_v034(uuid,uuid,text,numeric,numeric,text,uuid,numeric),
 public.pay_event_extra_v034(uuid,uuid),public.void_event_extra_v034(uuid,text),
 public.refund_event_extra_v034(uuid,text),public.add_event_waste_v034(uuid,text,numeric,numeric,text),
 public.void_event_waste_v034(uuid,text),public.complete_event_safe_v034(uuid,text),public.save_event_planner_v034(uuid,numeric,numeric),
 public.record_event_activity_v034(uuid,text,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_ready_v034(date),public.payroll_paid_v034(date),
 public.pay_approved_salary_v034(uuid,numeric,uuid,text),public.pay_daily_wage_v034(uuid,date,uuid),
 public.save_event_plan_v034(uuid,integer,numeric,text),public.set_event_status_v034(uuid,text),
 public.save_event_table_v034(uuid,uuid,text,integer,integer,integer),
 public.save_event_rule_v034(uuid,uuid,uuid,text,numeric,numeric),
 public.delete_event_rule_v034(uuid,uuid),
 public.create_event_table_booking_v034(uuid,uuid,text,integer,numeric,text,text),
 public.add_event_extra_v034(uuid,uuid,text,numeric,numeric,text,uuid,numeric),
 public.pay_event_extra_v034(uuid,uuid),public.void_event_extra_v034(uuid,text),
 public.refund_event_extra_v034(uuid,text),public.add_event_waste_v034(uuid,text,numeric,numeric,text),
 public.void_event_waste_v034(uuid,text),public.complete_event_safe_v034(uuid,text),public.save_event_planner_v034(uuid,numeric,numeric),
 public.record_event_activity_v034(uuid,text,text)
 TO authenticated;
COMMIT;
