import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {parseRecipesV027} from '../js/recipe-import-parser-v027.js';
import {catalogUnitEquivalent,alignRecipeLinesToCatalog} from '../js/recipe-unit-match-v0272.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const workbook=JSON.parse(readFileSync(join(root,'tests/fixtures/v027-recipe-rows.json'),'utf8'));

test('Arabic and technical equivalents work, while physical conversions remain forbidden',()=>{
  assert.equal(catalogUnitEquivalent({name:'كيلوغرام',code:'KG'},'كغ'),true);
  assert.equal(catalogUnitEquivalent({name:'مليلتر',code:'ML'},'مل'),true);
  assert.equal(catalogUnitEquivalent({name:'سفط',code:'TRAY'},'صحن'),true);
  assert.equal(catalogUnitEquivalent({name:'غرام',code:'G'},'كغ'),false);
  assert.equal(catalogUnitEquivalent({name:'كيس',code:'BAG'},'كغ'),false);
  assert.equal(catalogUnitEquivalent({name:'كيلوغرام',code:'KG',is_material_specific:true},'كغ'),false);
  assert.equal(catalogUnitEquivalent({name:'كيلوغرام',code:'KG',is_material_specific:true},'كيلوغرام'),true);
  assert.equal(catalogUnitEquivalent({name:'علبة',code:'AM_ABC'},'علبة'),true);
  assert.equal(catalogUnitEquivalent({name:'سحارة',code:'SAHARA'},'صحن'),false);
});

test('specific materials in the real Excel get canonical base units with no quantity edits',()=>{
  const original=parseRecipesV027(workbook);
  const names=[
    ['مبيض للحمص','كغ','كيلوغرام','KG'],
    ['دبس رمان','كغ','كيلوغرام','KG'],
    ['خل ابيض','مل','مليلتر','ML'],
    ['سمن بقري','كغ','كيلوغرام','KG'],
    ['بيض عادي','صحن','سفط','TRAY'],
    ['فيليه سمك','كغ','كيلوغرام','KG'],
  ];
  for(const [name,inputName,dbName,dbCode] of names){
    const line=original.lines.find(x=>x.materialName===name);
    assert.ok(line,`Material missing from workbook: ${name}`);
    assert.equal(line.baseUnit,inputName);
    const check=alignRecipeLinesToCatalog([line],[{id:name,name,base_unit_id:name}],[{id:name,name:dbName,code:dbCode,is_material_specific:false}]);
    assert.deepEqual(check.unitMismatch,[]);
    assert.deepEqual(check.unexpected,[]);
    assert.equal(check.canonicalLines[0].baseUnit,dbName);
    assert.equal(check.canonicalLines[0].quantityBase,line.quantityBase);
    assert.equal(check.canonicalLines[0].materialName,name);
    assert.equal(check.canonicalLines[0].recipeKey,line.recipeKey);
  }
});

test('full 75/729 approved workbook can be matched when catalog uses normal v0.24 unit codes',()=>{
  const {lines,recipes}=parseRecipesV027(workbook);
  const byMaterial=new Map();
  for(const l of lines){
    if(l.newMaterial)continue;
    if(!byMaterial.has(l.materialName))byMaterial.set(l.materialName,l.baseUnit);
    assert.equal(l.baseUnit,byMaterial.get(l.materialName),`multiple stock base units for ${l.materialName}`);
  }
  const remap={
    'كغ':['كيلوغرام','KG'],'غرام':['غرام','G'],'مل':['مليلتر','ML'],
    'صحن':['سفط','TRAY'],'كيس':['كيس','BAG'],'عبوة':['عبوة','PACK'],
    'قطعة':['قطعة','PCS'],
  };
  const materials=[...byMaterial].map(([name],i)=>({id:`m${i}`,name,base_unit_id:`u${i}`}));
  const units=[...byMaterial].map(([,rawUnit],i)=>({
    id:`u${i}`,name:(remap[rawUnit]||[rawUnit,'CUSTOM'])[0],
    code:(remap[rawUnit]||[rawUnit,`AM_${i}`])[1],is_material_specific:false
  }));
  const match=alignRecipeLinesToCatalog(lines,materials,units);
  assert.equal(recipes.length,75);
  assert.equal(lines.length,729);
  assert.deepEqual(match.unexpected,[]);
  assert.deepEqual(match.unitMismatch,[]);
  assert.ok(match.unitAliases.some(x=>x.includes('كيلوغرام')));
  assert.deepEqual(match.canonicalLines.map(l=>l.quantityBase),lines.map(l=>l.quantityBase));
  assert.deepEqual(match.canonicalLines.map(l=>l.materialName),lines.map(l=>l.materialName));
});

test('unknown and ambiguous units still block; existing stock cannot be modified',()=>{
  const bad=[{materialName:'دبس رمان',baseUnit:'غرام',quantityBase:2,recipeKey:'R',newMaterial:false}];
  const stock=[{name:'دبس رمان',base_unit_id:'u1'}];
  const units=[{id:'u1',name:'كيلوغرام',code:'KG'}];
  const result=alignRecipeLinesToCatalog(bad,stock,units);
  assert.equal(result.unitMismatch.length,1);
  assert.equal(result.canonicalLines[0].baseUnit,'غرام');
  assert.equal(result.canonicalLines[0].quantityBase,2);
  assert.deepEqual(alignRecipeLinesToCatalog(bad,[],units).unexpected,['دبس رمان']);
  assert.equal(alignRecipeLinesToCatalog([{...bad[0],newMaterial:true}],[],units).unexpected.length,0);
  assert.equal(alignRecipeLinesToCatalog(bad,[...stock,...stock],units).unitMismatch.length,1);
});

test('browser workflow always sends canonical payload to existing RPC',()=>{
  const importCode=readFileSync(join(root,'js/recipe-import-v027.js'),'utf8');
  const appCode=readFileSync(join(root,'js/app.js'),'utf8');
  const indexCode=readFileSync(join(root,'index.html'),'utf8');
  const migration=readFileSync(join(root,'database/Maria-CFO-v0.27.2-Recipe-Unit-Match-Fix.sql'),'utf8');
  assert.match(importCode,/p_lines:check\.canonicalLines/);
  assert.match(importCode,/api\.catalogRows\('units','id,name,code,is_material_specific'\)/);
  assert.match(importCode,/recipe-unit-match-v0272\.js\?v=0\.27\.2/);
  assert.match(appCode,/recipe-import-v027\.js\?v=0\.27\.2/);
  assert.match(indexCode,/js\/app\.js\?v=0\.27\.2/);
  assert.match(migration,/public\.recipe_unit_matches_v0272/);
  assert.match(migration,/public\.save_menu_recipe_item_v07/);
  assert.doesNotMatch(migration,/UPDATE\s+public\.(materials|inventory_movements|orders)/i);
  assert.doesNotMatch(migration,/DELETE\s+FROM\s+public\.(materials|inventory_movements|orders)/i);
});
