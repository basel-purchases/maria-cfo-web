import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMasterV030} from '../js/quick-import-parser-v030.js';
const load=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('master workbook has separate materials and dishes and confirmation uses their combined count',()=>{
 const wb={sheets:[
  {name:'المواد',rows:[['المادة','الوحدة'],['سكر','غرام',0,0,'','0001']]},
  {name:'المنيو والوصفات',rows:[['اسم الوجبة','سعر البيع'],['صنف 1',100,'بحاجة لإضافة مواد'],['صنف 2',200,'بحاجة لإضافة مواد']]}
 ]};
 const parsed=parseMasterV030(wb);
 assert.equal(parsed.records,undefined);
 assert.equal(parsed.materials.length+parsed.dishes.length,3);
 const src=load('js/quick-imports-v030.js');
 assert.match(src,/kind==='master'\s*\?\s*parsed\.materials\.length\+parsed\.dishes\.length\s*:\s*parsed\.records\.length/);
 assert.match(src,/count:importRecordCount/);
 assert.doesNotMatch(src,/count:parsed\.records\.length/);
});
test('confirmation uses guarded exception path before starting the Supabase write',()=>{
 const src=load('js/quick-imports-v030.js');
 assert.match(src,/try\{confirmed=await confirmQuickImport/);
 assert.match(src,/if\(!confirmed\)\{if\(submit\)submit\.disabled=false;return;\}/);
 assert.match(src,/quick-progress-card-v102/);
 assert.match(src,/quick-retry-v102/);
 assert.match(src,/finally\{[\s\S]*?clearInterval\(ticker\);clearTimeout\(timeout\);importing=false;/);
});
test('consistent import page width and 4-up stats at desktop, 2-up stats at tablet',()=>{
 const css=load('assets/styles.css');
 assert.match(css,/\.quick-page-v102\{width:100%;max-width:1120px;margin:0 auto/);
 assert.match(css,/\.quick-metrics-v102\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:940px\)\{\.quick-metrics-v102\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
test('SQL original importer remains atomic and hash idempotent; no data migration required',()=>{
 const sql=load('database/Maria-CFO-v1.0.1-Unknown-Material-Cost-PATCH.sql');
 assert.match(sql,/BEGIN;[\s\S]*?COMMIT;/);
 assert.match(sql,/IF v_old_run IS NOT NULL THEN RETURN v_old_summary/);
 assert.match(sql,/pg_advisory_xact_lock/);
 const ui=load('js/quick-imports-v030.js');
 assert.match(ui,/api\.rpc\('quick_import_v030'/);
 assert.doesNotMatch(ui,/chunk|batchImport|quick_import_batch_v102/i);
});
