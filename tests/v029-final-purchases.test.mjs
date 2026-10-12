import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseMaterialPurchasesV029,purchaseChunksV029} from '../js/material-purchase-parser-v029.js';
const wb=JSON.parse(fs.readFileSync('/mnt/data/ameen_source_test_fixture.json','utf8'));
test('source movements are parsed without importing sales as purchases',()=>{
 const x=parseMaterialPurchasesV029(wb);
 assert.equal(x.stats.invoiceCount,552);
 assert.equal(x.stats.readyInvoiceCount,538);
 assert.equal(x.stats.blockedInvoiceCount,14);
 assert.equal(x.stats.readyLines,2482);
 assert.equal(x.stats.purchaseRows,2589);
 assert.equal(x.eligible.reduce((n,r)=>n+r.lines.length,0),2482);
 assert.equal(x.blocked.length,14);
 const chunks=purchaseChunksV029(x.eligible);
 assert.equal(chunks.flat().length,538);
 for(const c of chunks){assert.ok(c.length<=6);assert.ok(c.reduce((n,d)=>n+d.lines.length,0)<=130);}
});
test('does not silently permit unknown material codes',()=>{
 const mock={sheets:[{name:'حركة مادة',rows:[[],['المادة','','','','','','','فاتورة'],['29999999-خدعة','','','','','كغ','2026-10-10','شراء: 999','',20,2]]}]};
 assert.throws(()=>parseMaterialPurchasesV029(mock),/غير معروف/);
});
