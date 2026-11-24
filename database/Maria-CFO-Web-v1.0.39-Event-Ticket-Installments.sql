-- Maria CFO v1.0.39: partial event ticket receipts, installments and optional next due dates.
-- Non-destructive migration; assumes v1.0.13 seat bookings and booking-payment RPC are installed.
-- Cash is posted by the existing record_event_booking_payment exactly once per successful receipt.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.event_bookings
 ADD COLUMN IF NOT EXISTS installment_next_due_date_v139 date,
 ADD COLUMN IF NOT EXISTS installment_note_v139 text;

-- Audit/idempotency log only, NOT a second accounting ledger.
CREATE TABLE IF NOT EXISTS public.event_booking_installment_ops_v139 (
 request_key uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
 booking_id uuid NOT NULL REFERENCES public.event_bookings(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK (operation IN ('booking','payment')),
 amount_original numeric(20,4) NOT NULL CHECK (amount_original >= 0),
 booking_total_original numeric(20,4),
 currency_code text NOT NULL,
 cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE RESTRICT,
 note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT v139_payment_has_cashbox CHECK (amount_original=0 OR cashbox_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS event_installment_ops_event_v139 ON public.event_booking_installment_ops_v139(event_id,created_at);
CREATE INDEX IF NOT EXISTS event_installment_ops_booking_v139 ON public.event_booking_installment_ops_v139(booking_id,created_at);
ALTER TABLE public.event_booking_installment_ops_v139 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_booking_installment_ops_v139 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_booking_installment_ops_v139 TO authenticated;
DROP POLICY IF EXISTS v139_owner_read ON public.event_booking_installment_ops_v139;
CREATE POLICY v139_owner_read ON public.event_booking_installment_ops_v139
 FOR SELECT TO authenticated USING (public.is_app_owner());

-- Same reservations/seat constraints as v1.0.13. The upfront receipt may be zero,
-- any positive amount up to the total, or the full amount, all in ONE transaction.
CREATE OR REPLACE FUNCTION public.event_book_and_collect_installment_v139(
 p_event_id uuid, p_customer_name text, p_guest_count integer, p_amount numeric,
 p_guest_names jsonb DEFAULT '[]'::jsonb, p_phone text DEFAULT NULL,
 p_note text DEFAULT NULL, p_seat_note text DEFAULT NULL,
 p_initial_payment numeric DEFAULT 0, p_cashbox_id uuid DEFAULT NULL,
 p_next_due_date date DEFAULT NULL, p_installment_note text DEFAULT NULL,
 p_request_key uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_event public.events%ROWTYPE;v_id uuid;v_reserved integer;v_seat_base integer;
 v_i integer;v_name text;v_names jsonb;v_prior record;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'EVENT_INSTALLMENT_REQUEST_KEY_REQUIRED'; END IF;
 SELECT * INTO v_prior FROM public.event_booking_installment_ops_v139 WHERE request_key=p_request_key;
 IF FOUND THEN
   IF v_prior.operation<>'booking' OR v_prior.event_id<>p_event_id
      OR v_prior.amount_original IS DISTINCT FROM round(p_initial_payment,4)
      OR v_prior.booking_total_original IS DISTINCT FROM round(p_amount,4)
      OR v_prior.cashbox_id IS DISTINCT FROM p_cashbox_id
      OR NOT EXISTS (SELECT 1 FROM public.event_bookings b
           WHERE b.id=v_prior.booking_id AND b.customer_name=btrim(p_customer_name)
           AND b.guest_count=p_guest_count)
   THEN RAISE EXCEPTION 'EVENT_INSTALLMENT_REQUEST_CONFLICT'; END IF;
   RETURN v_prior.booking_id;
 END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT v_event.seat_only_v113 OR v_event.status NOT IN ('planning','open','confirmed')
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF length(btrim(coalesce(p_customer_name,''))) NOT BETWEEN 2 AND 150
   OR p_guest_count IS NULL OR p_guest_count<1 OR p_guest_count>1000
   OR p_amount IS NULL OR p_amount<0 OR p_amount>1000000000000
   OR p_amount<>round(p_amount,4)
   OR p_initial_payment IS NULL OR p_initial_payment<0 OR p_initial_payment>p_amount
   OR p_initial_payment<>round(p_initial_payment,4)
   OR length(coalesce(p_seat_note,''))>200
   OR length(coalesce(p_installment_note,''))>500
   OR jsonb_typeof(p_guest_names) IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_guest_names)>p_guest_count
 THEN RAISE EXCEPTION 'EVENT_INSTALLMENT_BOOKING_INVALID'; END IF;
 IF p_initial_payment>0 AND (p_cashbox_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active))
 THEN RAISE EXCEPTION 'EVENT_CASHBOX_INVALID'; END IF;
 IF p_initial_payment=0 AND p_cashbox_id IS NOT NULL
 THEN RAISE EXCEPTION 'EVENT_INSTALLMENT_NO_CASH_WITH_ZERO'; END IF;
 SELECT coalesce(sum(guest_count),0)::integer INTO v_reserved FROM public.event_bookings
 WHERE event_id=p_event_id AND status NOT IN ('cancelled','no_show');
 IF v_reserved+p_guest_count>coalesce(v_event.planned_guest_count,0)
 THEN RAISE EXCEPTION 'EVENT_SEATS_FULL'; END IF;
 v_names:=p_guest_names;
 v_id:=public.create_event_booking(p_event_id,btrim(p_customer_name),p_guest_count,
   nullif(btrim(p_phone),''),'fixed',p_amount,v_event.price_currency_code,NULL,p_note);
 UPDATE public.event_bookings SET
   seat_note_v113=nullif(btrim(coalesce(p_seat_note,'')),''),
   installment_next_due_date_v139=CASE WHEN p_initial_payment<p_amount THEN p_next_due_date ELSE NULL END,
   installment_note_v139=nullif(btrim(coalesce(p_installment_note,'')),'')
 WHERE id=v_id;
 SELECT coalesce(max(seat_index),0) INTO v_seat_base
 FROM public.event_seat_guests_v113 WHERE event_id=p_event_id;
 FOR v_i IN 1..p_guest_count LOOP
   v_name:=nullif(btrim(coalesce(v_names->>(v_i-1),'')),'');
   IF v_name IS NULL THEN
     IF v_i=1 THEN v_name:=btrim(p_customer_name);
     ELSE v_name:='مرافق '||(v_i-1)||' لـ '||btrim(p_customer_name); END IF;
   END IF;
   INSERT INTO public.event_seat_guests_v113(event_id,booking_id,seat_index,guest_name,is_primary)
   VALUES(p_event_id,v_id,v_seat_base+v_i,left(v_name,150),v_i=1);
 END LOOP;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'booking','حجز مقاعد: '||btrim(p_customer_name)||' · '||p_guest_count||' شخص');
 IF p_initial_payment>0 THEN
   PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
   PERFORM public.record_event_booking_payment(v_id,p_cashbox_id,p_initial_payment,
     v_event.price_currency_code,'payment',now(),p_initial_payment,'دفعة أولى من تذاكر الحفلة v1.0.39');
   INSERT INTO public.event_activity_v034(event_id,activity_type,description)
   VALUES(p_event_id,'payment','دفعة أولى: '||left(p_customer_name,120)||' · '||p_initial_payment||' '||v_event.price_currency_code);
 END IF;
 INSERT INTO public.event_booking_installment_ops_v139(request_key,event_id,booking_id,
   operation,amount_original,booking_total_original,currency_code,cashbox_id,note)
 VALUES(p_request_key,p_event_id,v_id,'booking',p_initial_payment,p_amount,
   v_event.price_currency_code,p_cashbox_id,left(coalesce(p_installment_note,''),500));
 RETURN v_id;
END;$fn$;

-- Later installments cannot exceed the balance. The same request key is safe to retry.
CREATE OR REPLACE FUNCTION public.event_collect_booking_installment_v139(
 p_booking_id uuid,p_cashbox_id uuid,p_amount numeric,
 p_next_due_date date DEFAULT NULL,p_note text DEFAULT NULL,p_request_key uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_booking public.event_bookings%ROWTYPE;v_event public.events%ROWTYPE;
 v_due numeric;v_prior record;v_paid numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'EVENT_INSTALLMENT_REQUEST_KEY_REQUIRED'; END IF;
 SELECT * INTO v_prior FROM public.event_booking_installment_ops_v139 WHERE request_key=p_request_key;
 IF FOUND THEN
   IF v_prior.operation<>'payment' OR v_prior.booking_id<>p_booking_id
     OR v_prior.cashbox_id IS DISTINCT FROM p_cashbox_id
     OR v_prior.amount_original IS DISTINCT FROM round(p_amount,4)
   THEN RAISE EXCEPTION 'EVENT_INSTALLMENT_REQUEST_CONFLICT'; END IF;
   RETURN p_request_key;
 END IF;
 SELECT * INTO v_booking FROM public.event_bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_BOOKING_NOT_FOUND'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=v_booking.event_id;
 IF NOT FOUND OR v_event.status NOT IN('planning','open','confirmed')
    OR v_booking.status IN('cancelled','no_show')
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,4)
   OR length(coalesce(p_note,''))>500 OR p_cashbox_id IS NULL
 THEN RAISE EXCEPTION 'EVENT_INSTALLMENT_AMOUNT_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active)
 THEN RAISE EXCEPTION 'EVENT_CASHBOX_INVALID'; END IF;
 SELECT balance_original,paid_original INTO v_due,v_paid FROM public.event_booking_balances
 WHERE booking_id=p_booking_id;
 IF v_due IS NULL OR v_due<=0 OR p_amount>v_due+0.00001
 THEN RAISE EXCEPTION 'EVENT_INSTALLMENT_EXCEEDS_DUE'; END IF;
 PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
 PERFORM public.record_event_booking_payment(p_booking_id,p_cashbox_id,p_amount,
   v_booking.currency_code,'payment',now(),p_amount,
   'قسط تذكرة حفلة v1.0.39'||CASE WHEN nullif(btrim(coalesce(p_note,'')),'') IS NULL
     THEN '' ELSE ': '||left(btrim(p_note),400) END);
 UPDATE public.event_bookings SET
   installment_next_due_date_v139 = CASE WHEN v_due-p_amount<=0.00001 THEN NULL
     ELSE coalesce(p_next_due_date,installment_next_due_date_v139) END
 WHERE id=p_booking_id;
 INSERT INTO public.event_booking_installment_ops_v139(request_key,event_id,booking_id,
   operation,amount_original,booking_total_original,currency_code,cashbox_id,note)
 VALUES(p_request_key,v_booking.event_id,p_booking_id,'payment',p_amount,
   v_booking.agreed_amount_original,v_booking.currency_code,p_cashbox_id,
   left(coalesce(p_note,''),500));
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(v_booking.event_id,'payment','قسط تذكرة: '||left(v_booking.customer_name,120)||
   ' · '||p_amount||' '||v_booking.currency_code);
 RETURN p_request_key;
END;$fn$;

CREATE OR REPLACE FUNCTION public.event_set_booking_installment_plan_v139(
 p_booking_id uuid,p_next_due_date date DEFAULT NULL,p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_booking public.event_bookings%ROWTYPE;v_due numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_booking FROM public.event_bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR v_booking.status IN('cancelled','no_show') OR NOT EXISTS(
   SELECT 1 FROM public.events WHERE id=v_booking.event_id AND status IN ('planning','open','confirmed'))
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'EVENT_INSTALLMENT_NOTE_TOO_LONG'; END IF;
 SELECT balance_original INTO v_due FROM public.event_booking_balances WHERE booking_id=p_booking_id;
 UPDATE public.event_bookings SET
   installment_next_due_date_v139=CASE WHEN coalesce(v_due,0)>0 THEN p_next_due_date ELSE NULL END,
   installment_note_v139=nullif(btrim(coalesce(p_note,'')),'')
 WHERE id=p_booking_id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(v_booking.event_id,'note','تعديل موعد/ملاحظة الأقساط: '||left(v_booking.customer_name,120));
END;$fn$;

REVOKE ALL ON FUNCTION public.event_book_and_collect_installment_v139(uuid,text,integer,numeric,jsonb,text,text,text,numeric,uuid,date,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_collect_booking_installment_v139(uuid,uuid,numeric,date,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_set_booking_installment_plan_v139(uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_book_and_collect_installment_v139(uuid,text,integer,numeric,jsonb,text,text,text,numeric,uuid,date,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_collect_booking_installment_v139(uuid,uuid,numeric,date,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_set_booking_installment_plan_v139(uuid,date,text) TO authenticated;
COMMIT;
