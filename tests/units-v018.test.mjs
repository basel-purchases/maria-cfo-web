import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {unitDisplay} from '../js/utils.js';
import {
  normalizedUnitName,isVagueContextualName,isContextualUnit,isProtectedUnit,
  validateNamedUnitDraft,buildUnitCatalog,formatUnitAmount,
} from '../js/unit-catalog.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sql=readFileSync(resolve(root,'database/Maria_CFO_Web_v0.18_Migration.sql'),'utf8');
const settings=readFileSync(resolve(root,'js/pages/settings.js'),'utf8');
const conversions=readFileSync(resolve(root,'js/material-units.js'),'utf8');
const api=readFileSync(resolve(root,'js/api.js'),'utf8');

const sugar={id:'sugar',name:'سكر',base_unit_id:'g'};
const ghee={id:'ghee',name:'سمنة',base_unit_id:'g'};
const gram={id:'g',code:'G',name:'Gram',is_system:true};
const spoonSugar={id:'ss',code:'U_SS',name:'ملعقة سكر',is_material_specific:true,is_system:false};
const spoonGhee={id:'sg',code:'U_SG',name:'ملعقة سمنة',is_material_specific:true,is_system:false};
const data={
  units:[gram,spoonSugar,spoonGhee],materials:[sugar,ghee],
  materialUnits:[
    {id:'a',unit_id:'ss',material_id:'sugar',quantity_in_base:5},
    {id:'b',unit_id:'sg',material_id:'ghee',quantity_in_base:10},
  ],unitConversions:[],
};
const catalog=buildUnitCatalog(data);

test('sugar and ghee tablespoons appear only once with independent named definitions',()=>{
  assert.equal(catalog.length,3);
  const s=catalog.find(r=>r.unit.id==='ss');
  const g=catalog.find(r=>r.unit.id==='sg');
  assert.equal(s.related.length,1);
  assert.match(s.related[0].text,/ملعقة سكر/);
  assert.match(s.related[0].text,/٥ غرام/);
  assert.match(g.related[0].text,/١٠ غرام/);
  assert.equal(s.status,'dedicated');
  assert.equal(g.status,'dedicated');
  assert.equal(s.canEdit,true);
  assert.equal(g.canDelete,true);
});

test('names are normalized for whitespace, case, diacritics and Arabic alefs',()=>{
  assert.equal(normalizedUnitName(' مِلْعقة   أُرز '),normalizedUnitName('ملعقة ارز'));
  assert.equal(normalizedUnitName('كيس  أرز'),normalizedUnitName(' كيس ارز '));
});

test('duplicate unit name rejected globally, not just within same material',()=>{
  const e=validateNamedUnitDraft({name:'  مِلعقة   سُكر ',materialId:'ghee',amount:12,units:data.units,catalog});
  assert.match(e,/مستخدم/);
  assert.equal(validateNamedUnitDraft({name:'ملعقة سمنة',materialId:'ghee',amount:10,unitId:'sg',units:data.units,catalog}),null);
});

test('generic contextual unit names are refused for new material-specific definitions',()=>{
  assert.equal(isVagueContextualName('ملعقة'),true);
  assert.equal(isVagueContextualName('ملعقة سكر'),false);
  assert.match(validateNamedUnitDraft({name:'ملعقة',materialId:'sugar',amount:5,units:data.units,catalog}),/اسم الوحدة عام/);
});

test('a dedicated spoon cannot be reassigned from sugar to ghee',()=>{
  assert.match(validateNamedUnitDraft({name:'ملعقة سكر',unitId:'ss',materialId:'ghee',amount:5,units:data.units,catalog}),/مادة أخرى/);
});

test('invalid factors, missing relation and missing material are rejected',()=>{
  const input={name:'ملعقة زيت',materialId:'sugar',amount:5,units:data.units,catalog};
  assert.match(validateNamedUnitDraft({...input,materialId:''}),/اختر المادة/);
  for(const amount of ['',0,-3,'NaN',Infinity]) {
    assert.match(validateNamedUnitDraft({...input,amount}),/قيمة صحيحة/);
  }
});

test('legacy shared spoon is shown as ambiguous instead of silently merged or removed',()=>{
  const spoon={id:'sp',name:'ملعقة',code:'SPOON',is_system:false};
  const c=buildUnitCatalog({units:[gram,spoon],materials:[sugar,ghee],materialUnits:[
    {id:'a',unit_id:'sp',material_id:'sugar',quantity_in_base:5},
    {id:'b',unit_id:'sp',material_id:'ghee',quantity_in_base:10},
  ]});
  const r=c.find(x=>x.unit.id==='sp');
  assert.equal(r.status,'ambiguous');
  assert.equal(r.canEdit,false);
  assert.equal(r.canDelete,false);
  assert.equal(r.related.length,2);
});

test('canonical standard units are protected and their global conversion is shown',()=>{
  const kg={id:'kg',code:'KG',name:'Kilogram',is_system:true};
  const c=buildUnitCatalog({units:[gram,kg],unitConversions:[{from_unit_id:'kg',to_unit_id:'g',factor:1000}]});
  const r=c.find(x=>x.unit.id==='kg');
  assert.equal(r.isProtected,true);
  assert.equal(r.canEdit,false);
  assert.equal(r.canDelete,false);
  assert.match(r.general[0],/١٠٠٠ غرام/);
  assert.equal(isProtectedUnit(gram),true);
});

test('a custom legacy name is preferred to a generic SPOON code display',()=>{
  assert.equal(unitDisplay({code:'SPOON',name:'ملعقة سكر',is_system:false}),'ملعقة سكر');
  assert.equal(unitDisplay({code:'SPOON',name:'Spoon',is_system:true}),'ملعقة');
  assert.equal(isContextualUnit({code:'SPOON'}),true);
});

test('units editor and material conversion flow call the new atomic RPC',()=>{
  assert.match(settings,/api\.saveNamedUnit\(/);
  assert.match(settings,/api\.deleteNamedUnit\(/);
  assert.match(settings,/api\.allMaterialUnitLinks\(/);
  assert.match(settings,/api\.unitConversions\(/);
  assert.match(conversions,/api\.saveNamedUnit\(/);
  assert.doesNotMatch(conversions,/api\.resolveUnit\(/);
  assert.match(api,/rpc\('save_named_unit_v018'/);
  assert.match(api,/rpc\('delete_named_unit_v018'/);
});

test('migration enforces name, ownership, authorization and prevents destructive history rewrites',()=>{
  for(const name of ['guard_unit_name_v018','guard_specific_unit_binding_v018','guard_material_base_specific_v018','save_named_unit_v018','delete_named_unit_v018']){
    assert.match(sql,new RegExp('function public\\.'+name));
  }
  assert.match(sql,/public\.is_app_owner\(\)/);
  assert.match(sql,/UNIT_NAME_EXISTS/);
  assert.match(sql,/UNIT_BELONGS_TO_OTHER_MATERIAL/);
  assert.match(sql,/UNIT_IN_USE/);
  assert.match(sql,/on conflict \(material_id, unit_id\)/);
  assert.doesNotMatch(sql,/delete\s+from\s+public\.(?:purchase_invoice_items|order_items|orders|inventory_movements|cashbox_transactions)/i);
});

test('numbers format for relationships preserves small decimal amounts',()=>{
  assert.equal(formatUnitAmount(0.125),'٠٫١٢٥');
  assert.equal(formatUnitAmount(0),'؟');
});
