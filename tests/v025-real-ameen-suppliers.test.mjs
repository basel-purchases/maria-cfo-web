import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {readAmeenWorkbook,findReportSheet,parseAmeenRows} from '../js/ameen-import-parser.js';
import {supplierBalanceState} from '../js/table-presenter-v025.js';
const require=createRequire(import.meta.url);
const path='/mnt/data/كشف حساب زبون.xlsx';
const available=fs.existsSync(path);
if(available){
 globalThis.JSZip=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/pptxgenjs/node_modules/jszip');
 globalThis.DOMParser=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/mathjax-full/node_modules/@xmldom/xmldom').DOMParser;
}
test('v0.25 real Al-Ameen supplier report captures all statement columns and flags only positive balances',{
 skip:available?undefined:'Original private report not distributed with public release'
},async()=>{
 const b=fs.readFileSync(path);
 const file={name:'كشف حساب زبون.xlsx',size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
 const workbook=await readAmeenWorkbook(file);
 const parsed=parseAmeenRows('suppliers',findReportSheet(workbook,'suppliers').rows);
 assert.equal(parsed.records.length,11);
 assert.ok(parsed.records.every(x=>Object.hasOwn(x,'uncollectedPapers')));
 assert.ok(parsed.records.every(x=>x.uncollectedPapers===0));
 const byAccount=new Map(parsed.records.map(x=>[x.accountCode,x]));
 assert.equal(byAccount.size,4);
 const owed=[...byAccount.values()].filter(x=>supplierBalanceState({current_balance:x.currentBalance})==='unpaid');
 assert.deepEqual(owed.map(x=>x.accountCode).sort(),['2218','2238']);
 assert.equal(owed.reduce((t,x)=>t+x.currentBalance,0),21448);
 assert.equal(byAccount.get('2218').previousBalance,0);
 assert.equal(byAccount.get('2218').summaryDebit,62513);
 assert.equal(byAccount.get('2218').summaryCredit,43065);
 assert.equal(byAccount.get('2218').currentBalance,19448);
 assert.equal(byAccount.get('2217').currentBalance,0);
});
