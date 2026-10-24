import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {currencyLabel,money} from '../js/utils.js';
import {eventMoneyV038} from '../js/event-v038.js';
import {sortedPriceReviewV100,isPriceMismatch} from '../js/price-review-v100.js';
const base=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(join(base,f),'utf8');
test('v1.0: display Syrian currency after amount without changing persisted currency codes',()=>{
 assert.equal(currencyLabel('SYP'),'ل.س');
 assert.equal(currencyLabel('syp'),'ل.س');
 assert.equal(currencyLabel('USD'),'USD');
 assert.equal(money(12500,'SYP'),'12,500 ل.س');
 assert.equal(money(0,'SYP'),'0 ل.س');
 assert.equal(eventMoneyV038(12500.4,'SYP'),'12,501 ل.س');
 assert.equal(money(12.50,'USD'),'12.5 USD');
 assert.match(read('js/business-rules.js'),/\['SYP', 'USD'\]/);
 assert.match(read('database/Maria-CFO-Web-v0.41-Daily-Ameen-Orders.sql'),/unit_price numeric\(20,4\)/);
});
test('v1.0: inconsistent prices sort before new items, and exact matches last, with stable RPC indices',()=>{
 const rows=[
  {name:'مطابق أ',menuId:'a',different:false,minFilePrice:500,maxFilePrice:500},
  {name:'مختلف ب',menuId:'b',different:true,minFilePrice:600,maxFilePrice:600},
  {name:'جديد ج',menuId:null,different:true,minFilePrice:800,maxFilePrice:800},
  {name:'متعدد د',menuId:'d',different:false,minFilePrice:300,maxFilePrice:400},
  {name:'مطابق هـ',menuId:'e',different:false,minFilePrice:200,maxFilePrice:200},
 ];
 const sorted=sortedPriceReviewV100(rows);
 assert.deepEqual(sorted.map(x=>x.originalIndex),[1,3,2,0,4]);
 assert.deepEqual(sorted.map(x=>x.name),['مختلف ب','متعدد د','جديد ج','مطابق أ','مطابق هـ']);
 assert.equal(isPriceMismatch(rows[3]),true);
 assert.equal(isPriceMismatch(rows[0]),false);
 assert.deepEqual(rows.map(x=>x.name),['مطابق أ','مختلف ب','جديد ج','متعدد د','مطابق هـ']);
});
test('v1.0: sidebar, page heading, import action and report use neutral product names',()=>{
 const app=read('js/app.js'),daily=read('js/pages/ameen-daily-v041.js'),hub=read('js/pages/hubs.js');
 assert.match(app,/\['#\/daily-orders', 'الأوردرات'\]/);
 assert.match(app,/case 'daily-orders'/);
 assert.match(app,/case 'ameen-daily'/); // old bookmarks remain compatible
 assert.match(daily,/<h2>الأوردرات<\/h2>/);
 assert.match(daily,/<h3>إدخال الأوردرات<\/h3>/);
 assert.match(daily,/إجمالي المبيعات/);
 assert.match(daily,/sortedPriceReviewV100\(prices\)/);
 assert.match(daily,/data-price-index="\$\{p.originalIndex\}"/);
 assert.match(hub,/#\/daily-orders/);
 assert.match(read('index.html'),/app\.js\?v=1\.0/);
 assert.equal(read('VERSION').trim(),'1.0.13');
 for(const dir of ['js','js/pages'])for(const name of readdirSync(join(base,dir)).filter(n=>n.endsWith('.js'))){
  const src=read(join(dir,name));
  assert.doesNotMatch(src,/الأمين|الامين/,`${dir}/${name}: no external product branding in UI`);
 }
});
test('v1.0: review states are readable and color coded without changing the backend price decision',()=>{
 const page=read('js/pages/ameen-daily-v041.js'),css=read('assets/styles.css');
 assert.match(page,/badgeClass=.*red/);
 assert.match(page,/badgeClass=.*green/);
 assert.match(page,/badgeClass=.*yellow/);
 assert.match(page,/const badge=.*تنبيه سعر مختلف/);
 assert.match(page,/const badge=.*مطابق/);
 assert.match(page,/prepared\.prices\.indexOf\(p\)/);
 assert.match(css,/\.daily-price-review-v100/);
 assert.match(css,/\.daily-preview-v041 > \.grid > \.card strong/);
});
