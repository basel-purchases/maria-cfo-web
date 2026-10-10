# Maria CFO v0.24 - Al-Ameen import acceptance checklist

1. Back up and clone the Supabase database. Run the v0.24 migration in the clone and verify the tables/RPCs exist. Do not experiment with real financial data.
2. Visit `#/quick-imports`; verify mandatory report type. Choose the wrong type for a sample report and confirm validation rejects it.
3. Preview `Jard al-Mawad` actual report: expect menu, material, essential assets and three warehouses. Inspect negative-stock warning rows, kg/gram conversion and fractional essentials.
4. Commit the inventory report. Check material stock movement deltas, source inventory staging, menu selling prices and essential assets. Ensure that menu quantities never become inventory stock.
5. Re-import the SAME file. Confirm `duplicateFile=true`, no new inventory movements, no duplicate material/asset/menu item.
6. Create another Excel report from the same source with ONE changed material amount; confirm only the difference is posted and every unchanged material is NOT reset after restaurant sales.
7. Preview orders report: expect 8 unique orders and 89 item lines in the sample, with legitimate repeated lines retained. Commit. All orders MUST be drafts; cashbox/stock/financial movement count remains unchanged.
8. Import the orders report again and confirm no duplicates. Modify a posted order's source record in Excel and reimport: only conflict is stored, not rewritten as a posted order.
9. In staging, manually reconcile source net, set cashbox, approve imported draft and deliberately edit a line again. Posting MUST be rejected until approval is repeated. Do not publish an unreconciled example.
10. Preview supplier statement: expect 4 supplier accounts and 11 lines. Commit, inspect supplier balances and detailed account movements; verify NO cashbox or payable payment created. Re-import and confirm no duplicates.
11. In Chrome or Edge on HTTPS, click toolbar Refresh; grant permission to a desktop folder with the sample filenames. Verify preview confirmation lists the files. Cancel; confirm no RPC calls are issued. Approve and verify a full-screen progress overlay blocks interactions, with a separate result for each file.
12. Test opening all pre-existing routes: materials, menu, essentials, expenses, payroll, images/OCR, orders, reports, and suppliers. Confirm no `config.js` or existing secrets were overwritten.
13. Test failure mid-import by introducing a malformed record in the staging test: the individual file RPC must rollback completely. After any ambiguous HTTP failure, inspect the import history rather than retrying repeatedly.
14. If SQL reports missing columns/functions, stop; compare the live database with the exact v0.23 migration before applying any manual workaround.

**Not covered by local tests:** PostgreSQL runtime integration and real-browser Chrome directory permission persistence. Both must be verified on staging before trusting production financial values.
