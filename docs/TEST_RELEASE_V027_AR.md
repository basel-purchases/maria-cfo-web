# v0.27 release and deployment checks

1. Restore v0.25 in a test/staging environment with a backed-up Supabase database. Do not install v0.26.
2. Run the separate SQL v0.27 migration as the database owner; reload the Supabase/PostgREST schema cache if the new RPC has not yet appeared.
3. Confirm 75 target menu item names exist, and verify all material base-unit names match the workbook values using import preview.
4. Import the processed workbook once; verify summary 75 recipes and 729 line items, preserving audit batch and first-run original recipe backups.
5. Upload the same workbook again: no duplicate recipe components. Test a corrected workbook separately: requires confirmation.
6. Inspect a few recipes against actual kitchen measures and verify costs. Do not post live orders before resolving zero-stock new materials and unknown prices.
7. Set filters in Materials, Assets, Suppliers, Employee Advances, and Menu; navigate to page 2 and export Excel; ensure all matching filtered rows are present, including other pages.
8. For PDF, use the PDF button and choose Save as PDF in print dialog; verify Arabic RTL glyphs and filtered rows.
9. Inspect orders, imported supplier ledgers, dashboard and legacy menus; no cashbox or stock movement should be caused by recipe import.
10. Confirm no bundled config.js or Git files. Redeploy without modifying existing configuration or OCR integrations.

Automated: 145 Node tests passing. Browser Chromium validated Excel parser reading actual 75/729, and a filtered 3-row Excel export despite only 1 visible DOM row. No live Supabase deployment testing.
