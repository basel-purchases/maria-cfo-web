import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePhysicalCountV126} from '../js/baseline-parsers-v126.js';
const cols=['اسم المادة','الكمية','الواحدة','التاريخ','ملاحظات'];
const wb={sheets:[{name:'اللحوم',rows:[cols,
 ['صدر دجاج',5,'كغ','20/11/2026',''],
 ['لحم غنم',null,'كغ',null,''],
 ['عرق عنقود',4,null,'20\\11\\2026',''],
 ['ثوم',0,'كغ','2026-11-20','لا يوجد']
 ]}]};
test('5-column count imports dated numeric amounts and explicit zero, not blanks',()=>{
 const p=parsePhysicalCountV126(wb);
 assert.deepEqual([p.stats.sections,p.stats.approved,p.stats.empty,p.stats.review],[1,2,1,1]);
 assert.deepEqual(p.records.map(x=>[x.name,x.quantity,x.date]),[
  ['صدر دجاج',5,'2026-11-20'],['ثوم',0,'2026-11-20']]);
});
test('5-column count rejects duplicate material names across sheets',()=>{
 const x=structuredClone(wb);x.sheets.push({name:'آخر',rows:[cols,['ثوم',3,'كغ','2026-11-19','']]});
 assert.throws(()=>parsePhysicalCountV126(x),/مكررة/);
});
test('5-column count rejects invalid quantity and ignores missing date/unit safely',()=>{
 const x=structuredClone(wb);x.sheets[0].rows[1][1]=-4;
 assert.throws(()=>parsePhysicalCountV126(x),/الكمية/);
});
