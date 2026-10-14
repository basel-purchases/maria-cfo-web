-- Maria CFO Web v0.35: event tables in bulk, multi-table bookings, named guests.
-- Requires successful v0.34 SQL. Safe to rerun; does not alter existing bookings.
BEGIN;

CREATE TABLE IF NOT EXISTS public.event_booking_guests_v035(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
 booking_id uuid NOT NULL REFERENCES public.event_bookings(id) ON DELETE RESTRICT,
 table_id uuid NOT NULL REFERENCES public.event_tables(id) ON DELETE RESTRICT,
 seat_number integer NOT NULL CHECK(seat_number > 0),
 guest_name text NOT NULL CHECK(length(btrim(guest_name)) BETWEEN 1 AND 150),
 is_primary boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(table_id,seat_number)
);
CREATE INDEX IF NOT EXISTS event_booking_guests_v035_booking_idx ON public.event_booking_guests_v035(booking_id);
CREATE INDEX IF NOT EXISTS event_booking_guests_v035_event_idx ON public.event_booking_guests_v035(event_id);
ALTER TABLE public.event_booking_guests_v035 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_booking_guests_owner_v035 ON public.event_booking_guests_v035;
CREATE POLICY event_booking_guests_owner_v035 ON public.event_booking_guests_v035 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_booking_guests_v035 TO authenticated;

CREATE OR REPLACE FUNCTION public.event_bulk_tables_v035(
 p_event_id uuid, p_count integer, p_capacity integer, p_prefix text DEFAULT 'طاولة', p_start integer DEFAULT 1)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_event public.events%ROWTYPE; v_i integer; v_label text;v_planned integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_count IS NULL OR p_count<1 OR p_count>200 OR p_capacity IS NULL OR p_capacity<1 OR p_capacity>100
 OR p_start IS NULL OR p_start<1 OR p_start>10000 OR length(btrim(coalesce(p_prefix,''))) NOT BETWEEN 1 AND 30
 THEN RAISE EXCEPTION 'EVENT_BULK_INVALID'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.status NOT IN('planning','open','confirmed') THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF EXISTS (SELECT 1 FROM public.event_tables WHERE event_id=p_event_id AND status<>'cancelled') AND p_start=1
 THEN RAISE EXCEPTION 'EVENT_TABLES_ALREADY_EXIST'; END IF;
 FOR v_i IN p_start..(p_start+p_count-1) LOOP
  v_label:=btrim(p_prefix)||' '||v_i;
  IF EXISTS(SELECT 1 FROM public.event_tables WHERE event_id=p_event_id AND lower(btrim(table_label))=lower(v_label) AND status<>'cancelled')
  THEN RAISE EXCEPTION 'EVENT_TABLE_DUPLICATE: %',v_label; END IF;
  v_planned:=least(p_capacity,greatest(0,coalesce(v_event.planned_guest_count,0)-(v_i-p_start)*p_capacity));
  INSERT INTO public.event_tables(event_id,table_label,capacity,planned_guest_count,status)
  VALUES(p_event_id,v_label,p_capacity,v_planned,'available');
 END LOOP;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'table','إنشاء جماعي: '||p_count||' طاولة، سعة '||p_capacity||' كراسٍ لكل طاولة');
 RETURN p_count;
END;$$;

CREATE OR REPLACE FUNCTION public.event_group_booking_v035(
 p_event_id uuid, p_customer_name text, p_guest_count integer, p_amount numeric,
 p_allocations jsonb, p_guest_names jsonb DEFAULT '[]'::jsonb,
 p_phone text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_event public.events%ROWTYPE;v_booking uuid;v_row record;v_table public.event_tables%ROWTYPE;
 v_total integer:=0;v_index integer:=0;v_seat integer;v_guest_name text;v_is_primary boolean;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.status NOT IN('planning','open','confirmed') THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF length(btrim(coalesce(p_customer_name,''))) NOT BETWEEN 2 AND 150
 OR p_guest_count IS NULL OR p_guest_count<1 OR p_guest_count>1000 OR p_amount IS NULL OR p_amount<0
 OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_allocations)<1
 OR jsonb_array_length(p_allocations)>100 OR jsonb_typeof(p_guest_names) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'EVENT_GROUP_BOOKING_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations) x
   WHERE jsonb_typeof(x->'table_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(x->'guests') IS DISTINCT FROM 'number'
   OR (x->>'guests') !~ '^[0-9]+$'
   OR (x->>'guests')::integer<1) THEN RAISE EXCEPTION 'EVENT_GROUP_BOOKING_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM (SELECT x->>'table_id' AS id,count(*) AS c FROM jsonb_array_elements(p_allocations) x GROUP BY 1) a WHERE a.c>1)
 THEN RAISE EXCEPTION 'EVENT_GROUP_TABLE_DUPLICATE'; END IF;
 FOR v_row IN SELECT (x->>'table_id')::uuid AS id,(x->>'guests')::integer AS guests
 FROM jsonb_array_elements(p_allocations) x LOOP
  SELECT * INTO v_table FROM public.event_tables WHERE id=v_row.id AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_table.status IN('cancelled','completed') OR v_table.booking_id IS NOT NULL
   OR v_row.guests>v_table.capacity THEN RAISE EXCEPTION 'EVENT_TABLE_NOT_AVAILABLE'; END IF;
  v_total:=v_total+v_row.guests;
 END LOOP;
 IF v_total<>p_guest_count THEN RAISE EXCEPTION 'EVENT_GROUP_COUNT_MISMATCH'; END IF;
 v_booking:=public.create_event_booking(p_event_id,btrim(p_customer_name),p_guest_count,p_phone,
    'fixed',p_amount,v_event.price_currency_code,NULL,p_note);
 FOR v_row IN SELECT (x->>'table_id')::uuid AS id,(x->>'guests')::integer AS guests
 FROM jsonb_array_elements(p_allocations) x LOOP
  UPDATE public.event_tables SET booking_id=v_booking,status='reserved',planned_guest_count=v_row.guests
  WHERE id=v_row.id AND event_id=p_event_id;
  FOR v_seat IN 1..v_row.guests LOOP
   v_index:=v_index+1;
   v_guest_name:=NULLIF(btrim(coalesce(p_guest_names->>(v_index-1),'')),'');
   IF v_guest_name IS NULL THEN
    IF v_index=1 THEN v_guest_name:=btrim(p_customer_name);
    ELSE v_guest_name:='مع '||btrim(p_customer_name)||' '||(v_index-1); END IF;
   END IF;
   v_is_primary:=(v_index=1);
   INSERT INTO public.event_booking_guests_v035(event_id,booking_id,table_id,seat_number,guest_name,is_primary)
   VALUES(p_event_id,v_booking,v_row.id,v_seat,left(v_guest_name,150),v_is_primary);
  END LOOP;
 END LOOP;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'booking','حجز جماعي: '||btrim(p_customer_name)||' · '||p_guest_count||' ضيوف · '||jsonb_array_length(p_allocations)||' طاولة');
 RETURN v_booking;
END;$$;

REVOKE ALL ON FUNCTION public.event_bulk_tables_v035(uuid,integer,integer,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_group_booking_v035(uuid,text,integer,numeric,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_bulk_tables_v035(uuid,integer,integer,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_group_booking_v035(uuid,text,integer,numeric,jsonb,jsonb,text,text) TO authenticated;
COMMIT;
