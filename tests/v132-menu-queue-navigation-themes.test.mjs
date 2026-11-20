import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {queueActionV132,menuFilterLinkV132,sortQueueNamesV132} from '../js/sale-queue-actions-v132.js';
import {THEMES_V132} from '../js/theme-v132.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('v132: every queue state has exactly the expected next action',()=>{
 assert.equal(queueActionV132({state:'pending',menuItemId:null,recipeCount:0}),'add');
 assert.equal(queueActionV132({state:'pending',menuItemId:'m1',recipeCount:0}),'recipe');
 assert.equal(queueActionV132({state:'pending',menuItemId:'m1',recipeCount:3}),'complete');
 assert.equal(queueActionV132({state:'included_in_count',menuItemId:'m1',recipeCount:3}),'done');
 assert.equal(queueActionV132({state:'issued',menuItemId:'m1',recipeCount:3}),'done');
 assert.equal(queueActionV132({state:'review',menuItemId:'m1',recipeCount:3}),'review');
});

test('v132: Arabic dish names sort before order metadata; menu URL is percent encoded',()=>{
 const list=[{menuName:'بيبسي',orderNo:1},{menuName:'قهوة',orderNo:9},{menuName:'برتقال',orderNo:11}];
 const sorted=sortQueueNamesV132(list);
 assert.deepEqual(sorted.map(x=>x.menuName),['برتقال','بيبسي','قهوة']);
 assert.equal(menuFilterLinkV132('قهوة'),'#/menu/find/%D9%82%D9%87%D9%88%D8%A9');
 assert.deepEqual(list.map(x=>x.orderNo),[1,9,11]);
});

test('v132: SQL menu link batches same pending source name and never edits posted sales or stock',()=>{
 const sql=read('database/Maria-CFO-Web-v1.0.32-Sale-Queue-Menu-Link-FIX.sql');
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.v132_link_sale_queue_menu\(p_cashier_name text,p_menu_id uuid\)/);
 assert.match(sql,/public\.menu_alias_normalize_v104\(q\.source_name\)=public\.menu_alias_normalize_v104\(p_cashier_name\)/);
 assert.match(sql,/q\.state='pending' AND q\.menu_item_id IS NULL/);
 assert.match(sql,/HAVING count\(DISTINCT menu_id\)=1/); // ambiguous matches are not auto-selected
 assert.match(sql,/FROM \(\s*SELECT scq\.\*,coalesce\(m\.name,scq\.source_name\) AS display_name/);
 assert.match(sql,/ORDER BY lower\(coalesce\(m\.name,scq\.source_name\)\),scq\.sale_date DESC,scq\.id\s+LIMIT/);
 for(const banned of ['UPDATE public.orders','UPDATE public.order_items','UPDATE public.cashbox_transactions','UPDATE public.materials','INSERT INTO public.inventory_movements'])assert.equal(sql.includes(banned),false,banned);
 assert.match(sql,/BEGIN;[\s\S]+COMMIT;/);
});

test('v132: new menu flow calls real menu creation or alias and maps all waiting cashier lines',()=>{
 const page=read('js/pages/sale-cost-queue-v132.js');
 assert.match(page,/await api\.menuSaveV104\(/);
 assert.match(page,/await api\.v132AddMenuAlias\(id, source\)/);
 assert.match(page,/await api\.v132LinkSaleQueueMenu\(source, id\)/);
 assert.match(page,/location\.hash = menuFilterLinkV132\(targetName\)/);
 assert.match(page,/await api\.v132AutoLinkSaleQueue\(\)/);
 assert.match(page,/إضافة إلى المنيو/);
 assert.match(page,/إكمال الوصفة/);
 assert.match(page,/استكمال الصرف/);
 const menu=read('js/pages/menu.js');
 assert.match(menu,/state=\{page:1,categoryId:'',query:String\(search\|\|''\)\.trim\(\)/);
 assert.match(menu,/value="\$\{esc\(state\.query\)\}"/);
});

test('v132: nine main navigation sections; stocktaking in basic, images under more',()=>{
 const app=read('js/app.js');
 const expected=['الصفحة الرئيسية','الإدخالات الأساسية','التشغيل اليومي','الموظفون والرواتب','الحفلات','المساعد الذكي','الإحصائيات','أخرى','الإعدادات'];
 const block=app.match(/const nav = \[([\s\S]*?)\];/)[1];
 const actual=[...block.matchAll(/\['#\/[^']+', '([^']+)'\]/g)].map(x=>x[1]);
 assert.deepEqual(actual,expected);
 const hub=read('js/pages/hubs.js');
 const basic=hub.slice(hub.indexOf('basic:{'),hub.indexOf('daily:{'));
 const daily=hub.slice(hub.indexOf('daily:{'),hub.indexOf('employees:{'));
 const more=hub.slice(hub.indexOf('more:{'));
 for(const route of ['#/inventory','#/count-history','#/baseline-imports'])assert.ok(basic.includes(route),route);
 assert.ok(!daily.includes('#/count-history'));
 assert.ok(!daily.includes('#/inventory'));
 assert.ok(more.includes('#/images'));
 assert.match(app,/sidebar-foot">Web v1\.0\.32/);
 assert.match(app,/v132-version-chip/);
});

test('v132: analytics is loaded only for activated tab, not all at dashboard startup',()=>{
 const tabs=read('js/pages/analytics-tabs-v132.js');
 assert.match(tabs,/if\(!force&&cache\.has\(key\)\)return/);
 assert.match(tabs,/void choose\(valid\)/);
 assert.match(tabs,/await renderAnalyticsTabV132\(panel,key\)/);
 assert.match(tabs,/if\(key==='finance'\)\{\s*const \{renderReports\}=await import/);
 const app=read('js/app.js');
 assert.match(app,/case 'dashboard': return renderAnalyticsTabsV132/);
 assert.match(app,/case 'statistics': return renderAnalyticsTabsV132/);
});

test('v132: five visual styles and accountant credits in settings',()=>{
 assert.deepEqual(THEMES_V132.map(x=>x.number),[1,2,3,4,5]);
 assert.ok(THEMES_V132.some(x=>x.name==='راقي وأنيق'));
 const settings=read('js/pages/settings.js');
 for(const s of ['باسل صليبي','0996202134','basel.slaby@gmail.com','data-settings-tab="about"','data-settings-tab="categories"','data-category-tab="material-categories"'])assert.ok(settings.includes(s),s);
});
