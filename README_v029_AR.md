# Maria CFO Web v0.29 - Deployment and data safety

v0.29 is a complete static site release (except for config.js, deliberately absent).
It adds a searchable and alphabetically sorted interface for long native selects.
The selected value must still be one of the native select options.

## Important findings from the provided worksheets

- Source inventory: 451 raw-material rows; only ONE has a warehouse, positive
  balance, and a positive source price (source prices cannot be fabricated).
- Original recipes: 75 menu recipes with 729 ingredient lines.
- 64 of 75 menu recipes have a positive selling price in the source inventory.
- ZERO recipes have all ingredients with positive cost in the provided inventory.
  This is different from the live Supabase database, which may have more prices.
- The price-positive menu item is NOT automatically a cost-complete recipe.

## Order of installation

1. Make a full RESTORABLE backup (database and current site, including config.js).
2. Run database/Maria-CFO-v0.29-LIVE-PRICE-READONLY.sql and export the resulting
   CSV BEFORE any reset. A reset wipes all your existing material prices.
3. If a reset is truly necessary, first run
   database/Maria-CFO-v0.29-RESET-PREVIEW-READONLY.sql, check the output,
   then OPEN and REVIEW the DANGER reset file. The reset is DISARMED until
   its confirmation variable is manually set to RESET_MARIA_CFO_V029_NOW.
   A reset deletes ALL historical financial, operational, and imported rows.
   Do not use the legacy v0.23 reset script on the current v0.29 database.
4. Apply v0.28 Recipe-Resync.sql first if not installed already; then apply
   database/Maria-CFO-Web-v0.29-Strict-Imports.sql.
5. Upload all site release files, preserving your existing config.js.
6. Reload the site with Ctrl+F5 and check that the sidebar says Web v0.29.
7. Import inventory from the original source workbook with the preview, or use
   templates/Maria-CFO-Inventory-v0.29-Filtered-From-Source.xlsx after a reset.
8. For recipes, use templates/Maria-CFO-Recipes-v0.29-Candidates-Live-DB.xlsx,
   preview eligibility against LIVE material prices and warehouse inventory,
   and confirm only eligible complete-cost recipes. If no recipes qualify,
   first supply legitimate raw-material costs and valid stocks.

## Exported workbooks

- Maria-CFO-Inventory-v0.29-Filtered-From-Source.xlsx: source-driven candidates
  (menu: positive selling price; raw materials: warehouse + positive quantity
  + positive source price; assets: warehouse + positive quantity).
- Maria-CFO-Recipes-v0.29-Candidates-Live-DB.xlsx: 64 selling-price-positive
  recipes; NOT guaranteed to have complete ingredient costs. Live preflight
  rejects incomplete recipes.
- Maria-CFO-Recipes-v0.29-STRICT-Eligible-Only.xlsx: 0 recipes with complete
  ingredients under the CURRENT SOURCE workbook. Contains a full audit of
  rejected recipes and missing material prices.

## Data/accounting rules

- Do not invent material prices, balances, warehouse locations or unit conversions.
- The website should never accept a free typed name as a substitute for a
  selected database item.
- A zero price is unknown; it is never a valid reference cost.
- The database RPC is the ultimate validator; users cannot bypass the filters
  by directly calling an endpoint without the same checks.
- Any price imported from the Al-Ameen report is an opening/reference unit
  cost; verify its currency and meaning before importing. It is NOT a
  historical purchase invoice.
- On a full reset, all transactions and existing material prices are lost;
  owner, general settings, system units and base reference data are retained.

## Validation status

Automated Node tests pass; dropdown searching and sorting verified in a small
headless Chromium DOM harness. Supabase database migrations and the complete
website were NOT executed against your live production Supabase instance.
Always test a migration and import on a restored staging database first.
