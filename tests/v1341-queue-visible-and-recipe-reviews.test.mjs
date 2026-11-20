import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../js/api.js',import.meta.url),'utf8');
const menu=fs.readFileSync(new URL('../js/pages/menu.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('unfinished sales counter remains accessible when no ready recipe exists',()=>{
 assert.match(app,/id="sales-cost-notify-v131"/);
 assert.doesNotMatch(app,/id="sales-cost-notify-v131"[^>]* hidden>/);
 assert.match(app,/api\.v131SaleQueueSummary\(\)/);
 assert.match(app,/summary\?\.pending\|\|0\)\+Number\(summary\?\.review\|\|0/);
 assert.match(app,/button\.hidden=false;/);
 assert.doesNotMatch(app,/button\.hidden=count<=0/);
 assert.match(app,/counter\.textContent='؟'/);
 assert.match(app,/href="#\/sales-archive"/);
 assert.match(app,/location\.hash='#\/sale-cost-queue\/pending'/);
});

test('source recipe rows remain visible even when held for missing unit conversions',()=>{
 assert.match(api,/export async function v134RecipeImportReview\(menuId\)/);
 assert.match(api,/v126_menu_recipe_reviews/);
 assert.match(menu,/مكونات محفوظة من ملف المنيو/);
 assert.match(menu,/pendingLines\.map/);
 assert.match(menu,/esc\(line\.materialName/);
 assert.match(menu,/api\.v134RecipeImportReview\(id\)/);
});

test('cache bust and release marker load only new modules',()=>{
 assert.match(index,/\.\/js\/app\.js\?v=1\.0\.34\.1/);
 assert.match(app,/Web v1\.0\.34\.1/);
 assert.match(app,/\.\/pages\/menu\.js\?v=1\.0\.34\.1/);
 assert.match(app,/\.\/api\.js\?v=1\.0\.34\.1/);
});
