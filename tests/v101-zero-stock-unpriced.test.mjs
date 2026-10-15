import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMasterV030} from '../js/quick-import-parser-v030.js';
const source=readFileSync(new URL('../database/Maria-CFO-v1.0.1-Unknown-Material-Cost-PATCH.sql',import.meta.url),'utf8');
function wb(stock,price){return {sheets:[
 {name:'المواد',rows:[['المادة','الوحدة'],['فطر', 'غرام',stock,price,null,'NEW0001']]},
 {name:'المنيو والوصفات',rows:[['اسم الوجبة','سعر البيع'],['صنف',100,'منتهي',null,'فطر',20,'غرام']]}
]};}
test('unknown last purchase price allowed ONLY for zero-opening-stock materials',()=>{
 const result=parseMasterV030(wb(0,0));
 assert.equal(result.materials.length,1);
 assert.equal(result.materials[0].quantity,0);
 assert.equal(result.materials[0].lastPrice,0);
 assert.equal(result.stats.readyRecipes,0);
 assert.equal(result.stats.pendingRecipes,1);
 assert.equal(result.dishes[0].lines[0].needsReview,true);
 assert.match(result.warnings[0].message,/دون سعر شراء/);
 assert.throws(()=>parseMasterV030(wb(20,0)),/السعر/);
 assert.throws(()=>parseMasterV030(wb(0,-1)),/السعر/);
});
test('setting a real purchase cost makes a complete recipe publishable',()=>{
 const result=parseMasterV030(wb(0,4));
 assert.equal(result.stats.readyRecipes,1);
 assert.equal(result.dishes[0].lines[0].needsReview,false);
});
test('central SQL import does not treat unknown purchase cost as a free component',()=>{
 assert.match(source,/v_price=0 AND v_qty>0/);
 assert.match(source,/last_purchase_unit_cost_base=CASE WHEN v_price>0/);
 assert.match(source,/last_purchase_unit_cost_base>0/);
 assert.match(source,/v_complete:=false;v_reason:='سعر شراء مادة غير معروف'/);
 assert.doesNotMatch(source,/TRUNCATE\s+TABLE/i);
});
