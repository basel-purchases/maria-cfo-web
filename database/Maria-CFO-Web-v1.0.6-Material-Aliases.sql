-- Maria CFO Web v1.0.6 | Material alternate names
-- Run once in Supabase SQL Editor as postgres BEFORE uploading Web 1.0.6.
-- Additive migration; does not touch stock, purchase amounts, or existing names.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.material_alias_normalize_v106(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT btrim(regexp_replace(
   translate(translate(lower(btrim(coalesce(p_name,''))), 'ًٌٍَُِّْـ', ''),
     'أإآٱى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ااااي01234567890123456789'),
   '[[:space:]]+', ' ', 'g'));
$$;

CREATE TABLE IF NOT EXISTS public.material_aliases_v106 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
 alias_name text NOT NULL CHECK(length(btrim(alias_name)) BETWEEN 1 AND 180),
 alias_key text GENERATED ALWAYS AS (public.material_alias_normalize_v106(alias_name)) STORED,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT material_aliases_key_unique_v106 UNIQUE(alias_key),
 CONSTRAINT material_aliases_nonempty_v106 CHECK(alias_key <> '')
);
CREATE INDEX IF NOT EXISTS material_aliases_material_v106 ON public.material_aliases_v106(material_id);
ALTER TABLE public.material_aliases_v106 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.material_aliases_v106 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.material_aliases_v106 TO authenticated;
DROP POLICY IF EXISTS maria_material_alias_owner_read_v106 ON public.material_aliases_v106;
CREATE POLICY maria_material_alias_owner_read_v106 ON public.material_aliases_v106
 FOR SELECT TO authenticated USING(public.is_app_owner());

-- A normalized alias may never point to another material's primary name or alias.
CREATE OR REPLACE FUNCTION public.material_alias_validate_v106(p_material_id uuid,p_name text)
RETURNS text LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_key text;
BEGIN
 v_key:=public.material_alias_normalize_v106(p_name);
 IF NOT EXISTS(SELECT 1 FROM public.materials WHERE id=p_material_id)
 THEN RAISE EXCEPTION 'MATERIAL_ALIAS_TARGET_NOT_FOUND'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 180 OR v_key=''
 THEN RAISE EXCEPTION 'MATERIAL_ALIAS_INVALID_NAME'; END IF;
 IF EXISTS(SELECT 1 FROM public.materials m WHERE m.id<>p_material_id
    AND public.material_alias_normalize_v106(m.name)=v_key)
 THEN RAISE EXCEPTION 'MATERIAL_ALIAS_COLLIDES_WITH_MATERIAL_NAME'; END IF;
 IF EXISTS(SELECT 1 FROM public.material_aliases_v106 a
    WHERE a.alias_key=v_key AND a.material_id<>p_material_id)
 THEN RAISE EXCEPTION 'MATERIAL_ALIAS_USED_BY_ANOTHER_MATERIAL'; END IF;
 RETURN v_key;
END;$$;

CREATE OR REPLACE FUNCTION public.material_aliases_set_v106(p_material_id uuid,p_names text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record;v_own_key text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF cardinality(coalesce(p_names,ARRAY[]::text[]))>40
 THEN RAISE EXCEPTION 'MATERIAL_TOO_MANY_ALIASES'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-alias-v106',0));
 SELECT public.material_alias_normalize_v106(m.name) INTO v_own_key
 FROM public.materials m WHERE m.id=p_material_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATERIAL_NOT_FOUND'; END IF;
 FOR r IN SELECT DISTINCT ON (public.material_alias_normalize_v106(btrim(a.name)))
   btrim(a.name) AS name,public.material_alias_normalize_v106(btrim(a.name)) AS norm
   FROM unnest(coalesce(p_names,ARRAY[]::text[])) a(name)
   WHERE btrim(coalesce(a.name,''))<>''
   ORDER BY public.material_alias_normalize_v106(btrim(a.name)),btrim(a.name)
 LOOP
   IF r.norm<>v_own_key THEN PERFORM public.material_alias_validate_v106(p_material_id,r.name); END IF;
 END LOOP;
 DELETE FROM public.material_aliases_v106 WHERE material_id=p_material_id;
 FOR r IN SELECT DISTINCT ON (public.material_alias_normalize_v106(btrim(a.name)))
   btrim(a.name) AS name,public.material_alias_normalize_v106(btrim(a.name)) AS norm
   FROM unnest(coalesce(p_names,ARRAY[]::text[])) a(name)
   WHERE btrim(coalesce(a.name,''))<>''
   ORDER BY public.material_alias_normalize_v106(btrim(a.name)),btrim(a.name)
 LOOP
  IF r.norm<>v_own_key THEN
    INSERT INTO public.material_aliases_v106(material_id,alias_name) VALUES(p_material_id,r.name);
  END IF;
 END LOOP;
END;$$;

CREATE OR REPLACE FUNCTION public.material_alias_add_v106(p_material_id uuid,p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_key text;v_own_key text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-alias-v106',0));
 v_key:=public.material_alias_validate_v106(p_material_id,p_name);
 SELECT public.material_alias_normalize_v106(name) INTO v_own_key
 FROM public.materials WHERE id=p_material_id;
 IF v_key=v_own_key THEN RETURN; END IF;
 INSERT INTO public.material_aliases_v106(material_id,alias_name)
 VALUES(p_material_id,btrim(p_name)) ON CONFLICT(alias_key) DO NOTHING;
END;$$;

-- Name + alias sets are saved as one DB transaction (no half-created material).
CREATE OR REPLACE FUNCTION public.material_identity_create_v106(
 p_name text,p_code text,p_base_unit_id uuid,p_category_id uuid,p_target numeric,p_aliases text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-alias-v106',0));
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 250
 THEN RAISE EXCEPTION 'MATERIAL_NAME_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM public.materials m
   WHERE public.material_alias_normalize_v106(m.name)=public.material_alias_normalize_v106(p_name))
 THEN RAISE EXCEPTION 'MATERIAL_NAME_ALREADY_EXISTS'; END IF;
 IF EXISTS(SELECT 1 FROM public.material_aliases_v106 a
   WHERE a.alias_key=public.material_alias_normalize_v106(p_name))
 THEN RAISE EXCEPTION 'MATERIAL_NAME_COLLIDES_WITH_ALIAS'; END IF;
 INSERT INTO public.materials(name,code,base_unit_id,category_id_v023,target_stock_base)
 VALUES(btrim(p_name),p_code,p_base_unit_id,p_category_id,p_target) RETURNING id INTO v_id;
 PERFORM public.material_aliases_set_v106(v_id,p_aliases);
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.material_identity_update_v106(
 p_material_id uuid,p_name text,p_code text,p_category_id uuid,p_aliases text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-alias-v106',0));
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 250
 THEN RAISE EXCEPTION 'MATERIAL_NAME_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM public.materials m WHERE m.id<>p_material_id
   AND public.material_alias_normalize_v106(m.name)=public.material_alias_normalize_v106(p_name))
 THEN RAISE EXCEPTION 'MATERIAL_NAME_ALREADY_EXISTS'; END IF;
 IF EXISTS(SELECT 1 FROM public.material_aliases_v106 a WHERE a.material_id<>p_material_id
   AND a.alias_key=public.material_alias_normalize_v106(p_name))
 THEN RAISE EXCEPTION 'MATERIAL_NAME_COLLIDES_WITH_ALIAS'; END IF;
 UPDATE public.materials SET name=btrim(p_name),code=p_code,category_id_v023=p_category_id
 WHERE id=p_material_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATERIAL_NOT_FOUND'; END IF;
 PERFORM public.material_aliases_set_v106(p_material_id,p_aliases);
END;$$;

-- Protect later renames/additions of a primary material name (including from older UI).
CREATE OR REPLACE FUNCTION public.material_name_alias_guard_v106()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.material_aliases_v106 a
   WHERE a.alias_key=public.material_alias_normalize_v106(NEW.name)
     AND a.material_id<>NEW.id)
 THEN RAISE EXCEPTION 'MATERIAL_NAME_COLLIDES_WITH_ALIAS'; END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS material_name_alias_guard_v106 ON public.materials;
CREATE TRIGGER material_name_alias_guard_v106
 BEFORE INSERT OR UPDATE OF name ON public.materials
 FOR EACH ROW EXECUTE FUNCTION public.material_name_alias_guard_v106();

REVOKE ALL ON FUNCTION public.material_alias_normalize_v106(text),
 public.material_alias_validate_v106(uuid,text),public.material_name_alias_guard_v106(),
 public.material_aliases_set_v106(uuid,text[]),public.material_alias_add_v106(uuid,text),
 public.material_identity_create_v106(text,text,uuid,uuid,numeric,text[]),
 public.material_identity_update_v106(uuid,text,text,uuid,text[])
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.material_aliases_set_v106(uuid,text[]),
 public.material_alias_add_v106(uuid,text),
 public.material_identity_create_v106(text,text,uuid,uuid,numeric,text[]),
 public.material_identity_update_v106(uuid,text,text,uuid,text[]) TO authenticated;
COMMIT;
