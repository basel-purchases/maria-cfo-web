import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const base=process.env.MARIA_AMEEN_SAMPLES_DIR||'/mnt/data/';
const requiredSamples=['جرد المواد6 - Copy.xlsx','حركة الطلبات - Copy.xlsx','كشف حساب زبون.xlsx'];
const hasSamples=requiredSamples.every(name=>fs.existsSync(base+'/'+name));
if(hasSamples){
 globalThis.JSZip=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/pptxgenjs/node_modules/jszip');
 globalThis.DOMParser=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/mathjax-full/node_modules/@xmldom/xmldom').DOMParser;
}
const fixtureRequired={skip:hasSamples?undefined:'Private original Al-Ameen XLSX fixtures not distributed with public release'};
import {readAmeenWorkbook,findReportSheet,parseAmeenRows,classifyFileName,AMEEN_TYPES,sha256Hex,excelTimestamp} from '../js/ameen-import-parser.js';

async function parseFile(name,kind){const b=fs.readFileSync(base+'/'+name);const file={name,size:b.byteLength,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};const book=await readAmeenWorkbook(file);return {book,parsed:parseAmeenRows(kind,findReportSheet(book,kind).rows),buffer:b};}
test('Exact type matching for the three original reports',fixtureRequired,async()=>{
 for(const [name,kind] of [['جرد المواد6 - Copy.xlsx','inventory'],['حركة الطلبات - Copy.xlsx','orders'],['كشف حساب زبون.xlsx','suppliers']]){
  assert.equal(classifyFileName(name),kind);const {book,parsed}=await parseFile(name,kind);
  assert.ok(parsed.records.length>0);assert.equal(findReportSheet(book,kind).name,AMEEN_TYPES[kind]);
  assert.throws(()=>parseAmeenRows(kind==='inventory'?'orders':'inventory',findReportSheet(book,kind).rows),/نوع الملف/);
 }
});
test('Inventory types, categories, warehouse totals, exact kilogram conversions',fixtureRequired,async()=>{
 const {parsed}=await parseFile('جرد المواد6 - Copy.xlsx','inventory');
 const p=parsed.records;
 assert.ok(p.length>700,'expected a substantial inventory');
 assert.ok(p.some(r=>r.kind==='menu'&&r.category==='اختصاصات الشيف'));
 assert.ok(p.some(r=>r.kind==='material'&&r.category==='بهارات'));
 assert.ok(p.some(r=>r.kind==='asset'&&r.category==='تجهيزات مطبخ'));
 assert.equal(parsed.stats.warehouses.length,3);
 const lemon=p.find(r=>r.kind==='material'&&r.name==='ليمون'&&r.quantity===938200);
 assert.ok(lemon);assert.equal(lemon.unit,'غرام');assert.equal(lemon.unit2,'كغ');assert.equal(lemon.quantity2,938.2);
 assert.ok(parsed.warnings.some(w=>w.message.includes('كمية سالبة')));
});
test('Order groups preserve duplicate legitimate item lines and source net vs sum',fixtureRequired,async()=>{
 const {parsed}=await parseFile('حركة الطلبات - Copy.xlsx','orders');
 assert.equal(parsed.records.length,8);
 const r=parsed.records.find(r=>r.number==='4538');
 assert.ok(r);assert.equal(r.netTotal,4088.5);assert.equal(r.grossTotal,3830);
 assert.ok(r.difference>0);assert.ok(r.reviewReasons.length);
 const big=parsed.records.find(r=>r.number==='4536');
 assert.ok(big.items.filter(x=>x.name==='اركيلة بيت الاغا المميزة').length>=2);
 assert.equal(big.reportedSyp,0);
});
test('Supplier debit/credit picks movement columns (not repeated summary)',fixtureRequired,async()=>{
 const {parsed}=await parseFile('كشف حساب زبون.xlsx','suppliers');
 assert.equal(parsed.stats.suppliers,4);assert.equal(parsed.records.length,11);
 const r=parsed.records.find(r=>r.accountCode==='2218'&&r.document==='دفع: 106'&&r.debit===2392);
 assert.ok(r);assert.equal(r.credit,0);assert.equal(r.currentBalance,19448);
 assert.equal(new Set(parsed.records.map(x=>x.key)).size,parsed.records.length);
});
test('xlsx sha256 is stable',fixtureRequired,async()=>{
 const {buffer}=await parseFile('كشف حساب زبون.xlsx','suppliers');
 assert.equal((await sha256Hex(buffer)).length,64);
 assert.equal(await sha256Hex(buffer),await sha256Hex(buffer));
});
test('Excel numeric serial resolves to a valid date',()=>{
 assert.ok(excelTimestamp(46305).startsWith('2026-'));
});
