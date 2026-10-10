import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(join(root,p),'utf8');
const sql=read('database/Maria_CFO_Web_v0.24_Migration.sql');
const ui=read('js/ameen-quick-imports.js');
const parser=read('js/ameen-import-parser.js');
const index=read('index.html');

test('V024 database migration is a single owner-guarded transaction',()=>{
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
 assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.import_ameen_v024/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/UNIQUE\(kind,sha256\)/);
});
test('Imported files are auditable and cannot directly write staging tables from browser',()=>{
 for(const table of ['ameen_import_runs_v024','ameen_warehouses_v024','ameen_inventory_rows_v024','ameen_order_snapshots_v024','ameen_supplier_balances_v024','ameen_supplier_entries_v024']){
  assert.ok(sql.includes('public.'+table));
 }
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/GRANT SELECT ON public\.%I TO authenticated/);
 assert.match(sql,/REVOKE ALL ON public\.%I FROM PUBLIC, anon, authenticated/);
});
test('Menu quantities never turn into inventory transactions, supplier statements never turn into payments',()=>{
 const inventory=sql.slice(sql.indexOf("IF p_kind='inventory' THEN"),sql.indexOf("ELSIF p_kind='orders' THEN"));
 assert.match(inventory,/IF v_kind='menu' THEN/);
 assert.match(inventory,/ELSIF v_kind='material' THEN/);
 assert.match(inventory,/record_inventory_movement/);
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.cashbox_transactions/i);
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.order_payments/i);
});
test('No imported order can post without total match, selected cashbox, approved item fingerprint',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.approve_ameen_order_v024/);
 assert.match(sql,/AMEEN_ORDER_CASHBOX_REQUIRED/);
 assert.match(sql,/AMEEN_ORDER_TOTAL_MISMATCH/);
 assert.match(sql,/AMEEN_ORDER_ITEMS_CHANGED_REAPPROVAL_REQUIRED/);
 assert.match(sql,/approval_items_hash/);
 assert.match(sql,/CREATE TRIGGER guard_ameen_order_post_v024_trg/);
});
test('Folder sync obtains permission explicitly and manual import requires a type',()=>{
 assert.match(ui,/showDirectoryPicker/);
 assert.match(ui,/requestPermission/);
 assert.match(ui,/id="ameen-kind" required/);
 assert.match(ui,/if\(!kind\)/);
 assert.match(ui,/runAmeenFiles/);
 assert.match(ui,/className='ameen-import-blocker'/);
 assert.match(ui,/setAttribute\('inert',''\)/);
});
test('Filename selection is exact-report-header validated, not blindly trusted',()=>{
 assert.match(parser,/matchReportType/);
 assert.match(parser,/findReportSheet/);
 assert.match(parser,/MAX_IMPORT_BYTES/);
 assert.match(parser,/SHA-256/);
 assert.match(parser,/XML|Excel/);
});
test('ZIP application uses local vendored JSZip and retains old routes',()=>{
 assert.ok(existsSync(join(root,'vendor/jszip.min.js')));
 assert.ok(existsSync(join(root,'vendor/JSZIP_LICENSE.md')));
 assert.match(index,/\.\/vendor\/jszip\.min\.js/);
 assert.match(read('js/app.js'),/renderQuickImports/);
 assert.match(read('js/app.js'),/renderDashboard/);
 assert.match(read('js/app.js'),/renderImages/);
 assert.match(read('js/app.js'),/renderAttendance/);
 assert.match(read('js/app.js'),/Web v0\.25/);
});
