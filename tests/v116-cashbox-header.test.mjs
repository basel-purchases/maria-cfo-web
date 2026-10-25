import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expectedCashboxBalanceV116,cashboxQuickEntriesV116,cashboxNumberV116} from '../js/cashbox-summary-v116.js';
const base=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(base,p),'utf8');
const overview=[
  {cashbox:{id:'general',name:'General',display_order:3},summary:{expected_balance_base:'900000',_computed_balance_base:1}},
  {cashbox:{id:'two',name:'Box 2',display_order:2},summary:{expected_balance_base:0,_computed_balance_base:1500}},
  {cashbox:{id:'one',name:'Box 1',display_order:1},summary:{expected_balance_base:'14200.1'}},
];

test('header uses the same actual expected cashbox balance as the cashboxes page',()=>{
  const entries=cashboxQuickEntriesV116(overview);
  assert.deepEqual(entries.map(e=>e.id),['one','two','general']);
  assert.deepEqual(entries.map(e=>e.balance),[14200.1,0,900000]);
  assert.equal(expectedCashboxBalanceV116({expected_balance_base:0,_computed_balance_base:999}),0);
  assert.equal(expectedCashboxBalanceV116({expected_balance_base:null,_computed_balance_base:3500}),3500);
  assert.equal(expectedCashboxBalanceV116({}),null);
  assert.equal(cashboxQuickEntriesV116(overview,2).length,2);
  assert.deepEqual(cashboxQuickEntriesV116(null),[]);
  assert.deepEqual(cashboxQuickEntriesV116([{cashbox:{}},...overview]).map(e=>e.id),['one','two','general']);
});

test('numbers show grouping and zeros but never invent zero for missing balances',()=>{
  assert.equal(cashboxNumberV116(900000),'900,000');
  assert.equal(cashboxNumberV116(0),'0');
  assert.equal(cashboxNumberV116(-0),'0');
  assert.equal(cashboxNumberV116(-1250),'-1,250');
  assert.equal(cashboxNumberV116(null),'\u2014');
  assert.equal(cashboxNumberV116(undefined),'\u2014');
  assert.equal(cashboxNumberV116('not-available'),'\u2014');
});

test('three clickable cashboxes remain in the middle of the header on all app routes',()=>{
  const app=read('js/app.js');
  const header=app.split('<header class="topbar">')[1].split('</header>')[0];
  const left=header.indexOf('id="top-title"');
  const middle=header.indexOf('id="topbar-cashboxes"');
  const right=header.indexOf('id="ai-notify-btn"');
  assert.ok(left>=0&&middle>left&&right>middle);
  assert.match(header,/cashbox-quick-v116/);
  assert.match(header,/href="#\/cashboxes"/);
  assert.match(header,/data-cashbox-slot="\$\{i\}"/);
  assert.match(header,/\['\\u0635\\u0646\\u062f\\u0648\\u0642 1'/);
  assert.match(app,/api\.cashboxOverview\(\)/);
  assert.match(app,/CASHBOX_REFRESH_MS_V116=60000/);
  assert.match(app,/visibilitychange/);
  assert.match(app,/cashboxQuickStateV116\.timer/);
  assert.match(app,/maria:cashboxes-updated/);
  assert.match(read('js/pages/daily.js'),/document\.dispatchEvent\(new CustomEvent\('maria:cashboxes-updated'/);
  assert.match(read('js/pages/daily.js'),/expectedCashboxBalanceV116\(summary\)/);
});

test('mobile shows all three balances without horizontal scroll; full zip excludes secrets',()=>{
  const css=read('assets/styles.css');
  assert.match(css,/\.cashbox-strip-v116\{grid-column:2;grid-row:1/);
  assert.match(css,/@media\(max-width:1250px\)/);
  assert.match(css,/\.cashbox-strip-v116\{grid-column:1\/-1;grid-row:2/);
  assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:430px\)/);
  assert.equal(read('VERSION').trim(),'1.0.17');
  assert.match(read('index.html'),/v=1\.0\.17/);
  assert.match(read('js/app.js'),/Web v1\.0\.17/);
  assert.equal(existsSync(resolve(base,'config.js')),false);
});
