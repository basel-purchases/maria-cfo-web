# Maria CFO Web v0.24 - Al-Ameen XLSX quick imports

## Install in this order
1. Back up both Supabase PostgreSQL and the website repository. Keep an export you can restore.
2. You MUST already have Maria CFO v0.23 database migration installed. On a **disposable copy** of the database, run `database/Maria_CFO_Web_v0.24_Migration.sql` in Supabase SQL Editor. Check that it finishes with no errors. Then verify the three sample imports and existing financial workflows.
3. Only after a successful staging test, run the same SQL on your production database (take a fresh production backup first).
4. Replace the website files with the CONTENTS of the full ZIP in your existing GitHub Pages repository. Keep your existing `config.js`, `.git`, `.github` and deployment settings. Do not delete the repository first.
5. Hard-refresh the browser, and verify `Web v0.24` in the sidebar.
6. Do NOT re-deploy `assistant` or `ocr-space`. This release only adds a database migration and static frontend files.

## Quick imports
- Open the new `Quick Imports` page in the sidebar or the Basic Inputs hub. Choose a report type and an `.xlsx` file, inspect the preview, and confirm.
- Supported Al-Ameen report headers: inventory (`Jard al-Mawad`), daily order movement (`Harakat al-Talabat`), supplier statement (export is labeled `Kashf Hisab Zabon` even though it carries supplier account data).
- The toolbar `Refresh` button next to the Maria CFO brand lets you select a desktop folder via Chrome/Edge File System Access API. The website CANNOT scan the desktop silently. The first use and subsequent sessions may require permissions again. A manual file upload always remains available.
- The folder may contain the three reports with filename extensions like `6 - Copy.xlsx`. The app discovers the most recently modified candidate of each report type and displays each filename before submission.
- Each **file** is committed by ONE owner-checked database RPC transaction. A failure rolls that file back. If three files are processed in sequence and the second fails, the first remains committed. The visible progress dialog and result report make this explicit.
- A SHA256 hash prevents importing the same file unchanged; stable item/order/document keys prevent duplicate records from later file exports. The app never blindly retries a write after an ambiguous network failure.
- Source tables remain read-only to the browser. The Supabase RPC verifies owner access.

## What goes where
- Inventory report: creates/updates menu master items and menu categories (NEVER treats menu quantities as available stock); creates/updates materials, base units and categories; creates/updates essential assets; stores stock snapshots per original Al-Ameen warehouse. Only **valid nonnegative material stock changes** produce audited ledger `adjustment_in/out` through the existing protected inventory RPC. Negative or unconvertible quantities are staged for review and not applied. Existing last purchase prices are NOT overwritten with zero-valued source cells.
- Order movement report: creates/editable **draft orders only** and matches lines to menu items. Its net value is saved as a source reference; differences between line subtotals and source net are NOT auto-guessed as taxes. No order is automatically posted and no cashbox money is inserted. To approve before posting, choose a cashbox, reconcile the displayed final order net against Al-Ameen, review the items, and use `Approve after matching` in Quick Imports. Any material change to line items after approval requires re-approval.
- Supplier statement: creates/matches suppliers by source account number and stores source balance/statement lines separately. Never creates cashbox payments, payables settlements, or supplier ledger postings based only on this report.

## Preserving established data
- Re-importing the same Excel bytes is a no-op.
- Re-importing a changed snapshot updates source references rather than inserting duplicates. Already posted orders and manually edited drafts are not overwritten; they are flagged as conflicts for inspection.
- Stock imports are SOURCE SNAPSHOTS, not purchases. With new or changed source stock quantities, the difference between current database stock and the imported snapshot becomes an inventory adjustment. DO NOT import outdated inventory snapshots into a working production database unless you want an adjustment back to that date's balance.
- Imported warehouses are tracked separately as source locations. The existing global stock and recipe consumption engine is not retrofitted into a warehouse-specific transaction ledger in v0.24. Warehouse per-location balances displayed in Quick Imports reflect the last imported snapshot; they do not automatically decrement on later live restaurant sales until the separate warehouse-ledger work is done.
- Missing rows in a newer report are not automatically deleted. Use the preview and comparison with source exports.
- Legacy reset SQL from v0.23 is NOT compatible with new v0.24 tables; do not use it after this upgrade without an updated reset migration.

## Browser / infrastructure
- Hosting stays on GitHub Pages; no backend server or additional secret is required for parsing Excel.
- Vendored JSZip library and its license are included. XLSX is parsed in the browser, and the structured data is submitted to Supabase only when you confirm.
- HTTPS and a supported Chromium browser are needed for directory picking. Other browsers can upload files manually.
- This ZIP deliberately contains no `config.js`, `.git` or `.github` files.

## Test limits
- The real three example XLSX exports were successfully parsed locally in automated tests.
- JavaScript source checks and automated Node tests passed. The database SQL was reviewed statically but NOT executed against your Supabase schema; the live integration (Supabase RPC, trigger posting, larger data loads) MUST be tested with a disposable database before production use.
- Browser-level Chromium smoke testing was not available in the execution environment. Do not claim production acceptance without real staging tests.
