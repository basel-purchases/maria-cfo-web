import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyDailyBusinessDateV104} from '../js/daily-order-date-v104.js';
const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');

test('v1.0.4: Excel order day stays unchanged unless owner selects another date',()=>{
 const rows=[{date:'2026-10-12',number:'10',occurredAt:'2026-10-12T15:30:00Z',items:[{name:'مرتديلا'}]}];
 const defaultDay=applyDailyBusinessDateV104(rows,'');
 assert.equal(defaultDay.records,rows);
 assert.equal(defaultDay.overridden,false);
 const chosen=applyDailyBusinessDateV104(rows,'2026-10-11');
 assert.equal(chosen.records[0].date,'2026-10-11');
 assert.equal(chosen.records[0].originalBusinessDate,'2026-10-12');
 assert.equal(chosen.records[0].occurredAt,rows[0].occurredAt);
 assert.equal(rows[0].date,'2026-10-12');
 assert.equal(chosen.overridden,true);
});
test('v1.0.4: reject invalid day and accidental merging of multi-day workbook',()=>{
 assert.throws(()=>applyDailyBusinessDateV104([{date:'2026-10-12'}],'2026-02-29'),/غير صالح/);
 assert.throws(()=>applyDailyBusinessDateV104([{date:'2026-10-12'},{date:'2026-10-13'}],'2026-10-11'),/أكثر من يوم/);
 assert.equal(applyDailyBusinessDateV104([{date:'2026-10-12'},{date:'2026-10-13'}],'').records.length,2);
 assert.equal(applyDailyBusinessDateV104([{date:'2026-10-12'}],'2026-10-12').overridden,false);
});
test('v1.0.4: alias persistence is transactional, unique and owner-guarded in SQL',()=>{
 const sql=read('database/Maria-CFO-Web-v1.0.4-Menu-Aliases-Daily-Orders.sql');
 assert.match(sql,/^BEGIN;$/m);assert.match(sql,/^COMMIT;$/m);
 for(const fn of ['menu_alias_normalize_v104','menu_strip_leading_unit_v104','menu_aliases_set_v104','menu_alias_add_v104','menu_match_v104','menu_save_v104'])
  assert.match(sql,new RegExp('FUNCTION public\\.'+fn+'\\('));
 assert.match(sql,/menu_item_aliases_key_v104 UNIQUE \(alias_key\)/);
 assert.match(sql,/REFERENCES public\.menu_items\(id\) ON DELETE RESTRICT/);
 assert.match(sql,/menu_alias_validate_v104/);
 assert.match(sql,/MENU_ALIAS_USED_BY_ANOTHER_ITEM/);
 assert.match(sql,/MENU_ALIAS_COLLIDES_WITH_MENU_NAME/);
 assert.match(sql,/CREATE POLICY maria_alias_owner_read_v104/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/security_invoker=true/);
 assert.match(sql,/FOR UPDATE/);
 assert.doesNotMatch(sql,/TRUNCATE TABLE|DELETE FROM public\.menu_items|INSERT INTO public\.cashbox_transactions/);
});
test('v1.0.4: preview and import call the same alias/unit resolver; no silent new items',()=>{
 const sql=read('database/Maria-CFO-Web-v1.0.4-Menu-Aliases-Daily-Orders.sql');
 assert.match(sql,/'unit_prefix'/);
 assert.match(sql,/'alias_unit_prefix'/);
 assert.match(sql,/'matchKind',resolved\.match_kind/);
 assert.match(sql,/DAILY_ITEM_NEEDS_EXPLICIT_CREATE_OR_ALIAS/);
 assert.match(sql,/p_actions/);
 assert.match(sql,/PERFORM public\.menu_alias_add_v104\(v_target,v_name\)/);
 assert.match(sql,/VALUES\(v_order,nullif\(v_line->>'sourceRow'/);
 assert.match(sql,/v_menu,v_menu_price,v_line_match/);
 assert.match(sql,/'cost',CASE WHEN li\.match_kind_v104 IN \('unit_prefix','alias_unit_prefix'\) THEN NULL/);
 assert.match(sql,/source_fingerprint/);
 assert.match(sql,/RETURN v_old\.summary\|\|jsonb_build_object\('duplicateFile',true/);
 assert.doesNotMatch(sql,/INSERT INTO public\.inventory_movements|INSERT INTO public\.cashbox_transactions/);
});
test('v1.0.4: UI offers explicit alias/new choice, menu dropdown and date selection',()=>{
 const page=read('js/pages/ameen-daily-v041.js');
 const menu=read('js/pages/menu.js');
 const api=read('js/api.js');
 assert.match(page,/daily-import-date-v104/);
 assert.match(page,/applyDailyBusinessDateV104/);
 assert.match(page,/daily-new-action-v104/);
 assert.match(page,/اسم آخر لوجبة موجودة/);
 assert.match(page,/إنشاء صنف جديد مستقل/);
 assert.match(page,/daily-menu-target-v104/);
 assert.match(page,/data-search=/);
 assert.match(page,/if\(!menuId\)/);
 assert.match(api,/menuAliasChoicesV104/);
 assert.match(api,/menu_item_search_v104/);
 assert.match(api,/menuAliasesForIdsV104/);
 assert.match(menu,/name="aliases"/);
 assert.match(menu,/__aliases/);
 assert.match(menu,/if\(changed\) await onChanged\(\)/);
 assert.doesNotMatch(menu,/onClose:async\(\)=>\{\s*await renderMenu\(/);
});
