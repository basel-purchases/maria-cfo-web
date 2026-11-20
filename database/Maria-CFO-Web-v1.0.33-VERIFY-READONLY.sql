-- Maria CFO Web v1.0.33: READ ONLY verification; run after migration.
-- Does not insert, update, delete, invoke posting RPCs, or reset data.
SELECT 'menu_items_archive_column' AS component,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='menu_items' AND column_name='is_archived_v133') AS installed
UNION ALL SELECT 'menu_items_merge_link_column',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='menu_items' AND column_name='merged_into_menu_id_v133')
UNION ALL SELECT 'v133_menu_merge_history',to_regclass('public.v133_menu_merge_history') IS NOT NULL
UNION ALL SELECT 'v133_menu_delete_history',to_regclass('public.v133_menu_delete_history') IS NOT NULL
UNION ALL SELECT 'v133_menu_usage',to_regprocedure('public.v133_menu_usage(uuid)') IS NOT NULL
UNION ALL SELECT 'v133_menu_delete_unused',to_regprocedure('public.v133_menu_delete_unused(uuid)') IS NOT NULL
UNION ALL SELECT 'v133_menu_merge',to_regprocedure('public.v133_menu_merge(uuid,uuid)') IS NOT NULL
UNION ALL SELECT 'menu_alias_validate_v104',to_regprocedure('public.menu_alias_validate_v104(uuid,text)') IS NOT NULL
UNION ALL SELECT 'v131_complete_sale_cost',to_regprocedure('public.v131_complete_sale_cost(uuid)') IS NOT NULL
UNION ALL SELECT 'v131_sale_queue_list',to_regprocedure('public.v131_sale_queue_list(integer,integer,boolean)') IS NOT NULL
UNION ALL SELECT 'v132_auto_link_sale_queue',to_regprocedure('public.v132_auto_link_sale_queue()') IS NOT NULL
ORDER BY component;

-- Summary of the current queue (no posting performed).
SELECT state, count(*)::bigint AS items,
       count(*) FILTER (WHERE NOT is_cost_complete)::bigint AS unconfirmed_cost_items
FROM public.v131_sale_cost_queue
GROUP BY state ORDER BY state;

-- Merge/archive audit after any real menu merges (currently may be empty).
SELECT count(*)::bigint AS archived_menu_items FROM public.menu_items WHERE is_archived_v133;
SELECT count(*)::bigint AS merge_events FROM public.v133_menu_merge_history;
SELECT count(*)::bigint AS safe_delete_events FROM public.v133_menu_delete_history;
