import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizedCrop,OCR_ENGINES,usageSummary} from '../js/image-cloud-rules.js';
import {validateImageDocument,exactCatalogId} from '../js/image-document-rules.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const images=readFileSync(join(root,'js/pages/images.js'),'utf8');
const edge=readFileSync(join(root,'supabase/functions/ocr-space/index.ts'),'utf8');
const sql=readFileSync(join(root,'database/Maria_CFO_Web_v0.21_Migration.sql'),'utf8');
const css=readFileSync(join(root,'assets/styles.css'),'utf8');

test('OCR engines have correct free monthly announced limits, not fake live balances',()=>{
  assert.equal(OCR_ENGINES[1].monthlyLimit,25000);
  assert.equal(OCR_ENGINES[3].monthlyLimit,1000);
  assert.deepEqual(usageSummary({'1':{day:2,month:9}},1),{day:2,month:9,monthLimit:25000});
  assert.equal(usageSummary(null,3).day,null);
});
test('engine 1 uses Arabic and engine 3 uses automatic language, no engine 2 for Arabic',()=>{
  assert.match(edge,/engine===3\?'auto':'ara'/);
  assert.match(edge,/engine!==1&&engine!==3/);
  assert.match(edge,/OCR_SPACE_API_KEY/);
  assert.doesNotMatch(images,/recognizeLocalImage\(/);
});
test('images never go directly from client to OCR.space; server checks owner',()=>{
  const cloud=readFileSync(join(root,'js/image-cloud-ocr.js'),'utf8');
  assert.doesNotMatch(cloud,/https:\/\/api\.ocr\.space/);
  assert.match(cloud,/\.functions\.invoke\('ocr-space'/);
  assert.match(edge,/rpc\('is_app_owner'\)/);
  assert.match(edge,/auth\.getUser\(token\)/);
  assert.match(edge,/https:\/\/api\.ocr\.space\/parse\/image/);
  assert.doesNotMatch(cloud,/OCR_SPACE_API_KEY/);
});
test('app-wide usage counters are not displayed as official OCR.space quota',()=>{
  assert.match(sql,/ocr_space_usage_v021/);
  assert.match(sql,/row level security/);
  assert.match(sql,/get_ocr_space_usage_v021/);
  assert.match(edge,/action==='usage'/);
  assert.match(images,/data-counter/);
  assert.match(images,/usageSummary/);
});
test('normal crop never crops invalid area',()=>{
  assert.deepEqual(normalizedCrop({x:.05,y:.04,w:.7,h:.6}),{x:.05,y:.04,w:.7,h:.6});
  assert.equal(normalizedCrop({x:-1,y:0,w:1,h:1}),null);
  assert.equal(normalizedCrop({x:0,y:0,w:0,h:1}),null);
});
test('new purchase material requires a selected valid base unit, not an invented default',()=>{
  const item={name:'New Sugar',catalog_query:'New Sugar',quantity:'3',unit_price:'1200',new_base_unit_id:'',discount:'0'};
  const doc={type:'purchase',date:'2026-10-09',currency:'SYP',items:[item]};
  const options={materials:[],units:[{id:'kg',code:'KG',name:'kg'}],menu:[],cashboxes:[]};
  assert.equal(validateImageDocument(doc,options).ready,false);
  const ok=validateImageDocument({...doc,items:[{...item,new_base_unit_id:'kg'}]},options);
  assert.equal(ok.ready,true);
  assert.equal(ok.prepared[0].new_material,true);
  assert.equal(ok.prepared[0].unit_id,'kg');
});
test('new order menu cannot be auto-created during OCR text extraction',()=>{
  const order={type:'order',date:'2026-10-09',currency:'SYP',cashbox_id:'cash',items:[{name:'New food',catalog_query:'New food',quantity:'1',unit_price:'50'}]};
  assert.equal(validateImageDocument(order,{menu:[],cashboxes:[{id:'cash',is_active:true}]}).ready,false);
  const segment=images.split('async function extractOne(')[1].split('async function extractMany(')[0];
  assert.doesNotMatch(segment,/doc\.items\s*=/);
  assert.doesNotMatch(segment,/api\.createMenuItem|api\.insertFirst|api\.createOrder/);
  assert.match(images,/data-create-menu/);
  assert.match(images,/api\.addRecipeItem/);
});
test('document detail is full width, gallery is horizontal and cashbox belongs in publish panel',()=>{
  assert.match(images,/image-gallery-strip/);
  assert.match(images,/image-items-full/);
  assert.match(images,/image-publish-panel/);
  assert.match(css,/\.image-workspace\{display:flex;flex-direction:column/);
  assert.match(css,/\.image-items-table\{table-layout:fixed;min-width:0;width:100%/);
});
test('financial transactions remain on existing validated RPC and confirmation paths',()=>{
  assert.match(images,/await confirmBox/);
  assert.match(images,/api\.createPurchase/);
  assert.match(images,/api\.createOrder/);
  assert.match(images,/api\.postOrder/);
  assert.match(images,/api\.postPurchase/);
  assert.doesNotMatch(sql,/DROP CONSTRAINT|DISABLE TRIGGER|DELETE FROM public\.cashbox_transactions/i);
});
