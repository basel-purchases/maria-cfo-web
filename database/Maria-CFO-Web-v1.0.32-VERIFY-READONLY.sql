-- Safe read-only compatibility check after installing v1.0.32.
SELECT
 to_regclass('public.v131_sale_cost_queue') IS NOT NULL AS has_sale_queue,
 to_regclass('public.menu_item_aliases_v104') IS NOT NULL AS has_menu_aliases,
 to_regprocedure('public.menu_save_v104(uuid,text,uuid,numeric,numeric,numeric,numeric,text[])') IS NOT NULL AS has_menu_creation,
 to_regprocedure('public.v132_auto_link_sale_queue()') IS NOT NULL AS has_automatic_menu_link,
 to_regprocedure('public.v132_link_sale_queue_menu(text,uuid)') IS NOT NULL AS has_manual_menu_link,
 to_regprocedure('public.v131_sale_queue_list(integer,integer,boolean)') IS NOT NULL AS has_name_sorted_queue;
