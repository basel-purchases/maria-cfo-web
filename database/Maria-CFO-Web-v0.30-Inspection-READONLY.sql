-- Maria CFO v0.30: quick readonly verification after migration / imports.
-- One row with table counts; no business data is changed.
SELECT jsonb_build_object(
  'migrationReady',
    to_regclass('public.quick_import_runs_v030') IS NOT NULL,
  'materials', (SELECT count(*) FROM public.materials),
  'menuItems', (SELECT count(*) FROM public.menu_items),
  'menuItemsWithRecipe', (SELECT count(DISTINCT menu_item_id) FROM public.menu_item_recipe_items),
  'menuItemsWithKnownCost', (SELECT count(*) FROM public.menu_item_costs WHERE recipe_cost_base IS NOT NULL),
  'recipeDraftsV030', (SELECT count(*) FROM public.quick_import_recipe_drafts_v030),
  'restaurantAssets', (SELECT count(*) FROM public.restaurant_assets_v023),
  'suppliers', (SELECT count(*) FROM public.suppliers),
  'supplierLedgerEntries', (SELECT count(*) FROM public.ameen_supplier_entries_v024),
  'ordersDraft', (SELECT count(*) FROM public.orders WHERE status='draft'),
  'importHistory', (SELECT count(*) FROM public.quick_import_runs_v030),
  'undoAvailable', (SELECT count(*) FROM public.quick_import_runs_v030
                   WHERE undone_at IS NULL AND expires_at>now())
) AS summary;
