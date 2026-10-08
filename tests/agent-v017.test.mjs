import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {
 parseEmployeeCommand,normalizeEmployee,normalizeEmployees,localDailyDue,inspectDocument,
 safeLink,normalizePlan,CONFIRM_REQUIRED,toWesternDigits
} from '../supabase/functions/assistant/agent-core.js';
const root=resolve(import.meta.dirname,'..');
const server=readFileSync(resolve(root,'supabase/functions/assistant/index.ts'),'utf8');
const sql=readFileSync(resolve(root,'database/Maria_CFO_Web_v0.17_Migration.sql'),'utf8');
const api=readFileSync(resolve(root,'js/api.js'),'utf8');
const ui=readFileSync(resolve(root,'js/pages/assistant.js'),'utf8');

test('Arabic + Persian numerals converted correctly',()=>{
  assert.equal(toWesternDigits('١٠٠'), '100');
  assert.equal(toWesternDigits('۳۰۰۰'),'3000');
});
test('two clearly requested employees extracted without guessing',()=>{
 const em=parseEmployeeCommand('أضف موظفين هم أنس يومي براتب ١٠٠ زياد شهري براتب ٣٠٠٠');
 assert.deepEqual(em.map(e=>[e.name,e.payType,e.wage]),[['أنس','daily',100],['زياد','monthly',3000]]);
});
test('colon after employees in the UI example is accepted without contaminating names',()=>{
 const x=parseEmployeeCommand('أضف موظفين: أنس يومي براتب 100، زياد شهري براتب 3000');
 assert.deepEqual(x.map(e=>e.name),['أنس','زياد']);
});
test('read-only question must not be interpreted as employee insertion',()=>{
 assert.equal(parseEmployeeCommand('كم راتب الموظف أنس يومي 100'),null);
});
test('incomplete multi-employee command is NOT partially saved by deterministic parser',()=>{
 assert.equal(parseEmployeeCommand('أضف أنس يومي براتب 100 زياد شهري'),null);
});
test('ambiguous joined conjunction prompts Gemini instead of corrupting a name',()=>{
 assert.equal(parseEmployeeCommand('اضف أنس يومي 100 وزياد شهري 3000'),null);
});
test('employee required fields are always validated',()=>{
 assert.ok(normalizeEmployee({name:'أحمد',payType:'daily'}).missing.includes('قيمة الأجر (أكبر من صفر)'));
 assert.ok(normalizeEmployee({name:'',payType:'monthly',wage:3000}).missing.length);
 assert.ok(normalizeEmployee({name:'سلمى',payType:'hourly',wage:-1}).missing.length);
});
test('each pay type is persisted to its actual database wage column',()=>{
 for(const [kind,column] of [['daily','daily_rate_original'],['hourly','hourly_rate_original'],['monthly','monthly_salary_original']]){
  const x=normalizeEmployee({name:'مؤقت',payType:kind,wage:100});
  assert.equal(x.missing.length,0);assert.equal(x.record[column],100);assert.equal(Object.keys(x.record).filter(k=>/(_rate_original|salary_original)$/.test(k)).length,1);
 }
});
test('duplicate requested employee names are rejected before bulk insert',()=>{
 assert.ok(normalizeEmployees([{name:'أحمد',payType:'daily',wage:100},{name:'أحمد',payType:'monthly',wage:500}]).missing.length);
});
test('daily zero worked hours is zero due unless paid_leave explicit',()=>{
 assert.equal(localDailyDue({status:'full',workedHours:0,expectedHours:8,dailyRate:100,appliedShortage:0}),0);
 assert.equal(localDailyDue({status:'absent',workedHours:0,expectedHours:8,dailyRate:100}),0);
 assert.equal(localDailyDue({status:'paid_leave',workedHours:0,expectedHours:8,dailyRate:100}),100);
});
test('part-day daily wage proportional when calculated shortage applies',()=>{
 assert.equal(localDailyDue({workedHours:4,expectedHours:8,dailyRate:100,calculatedShortage:4}),50);
 assert.equal(localDailyDue({workedHours:4,expectedHours:8,dailyRate:100,appliedShortage:0}),100);
});
test('hourly wage counts actual hours and paid leave only',()=>{
 assert.equal(localDailyDue({payType:'hourly',status:'partial',workedHours:3,expectedHours:8,hourlyRate:20}),60);
 assert.equal(localDailyDue({payType:'hourly',status:'unpaid_leave',workedHours:0,expectedHours:8,hourlyRate:20}),0);
 assert.equal(localDailyDue({payType:'hourly',status:'paid_leave',workedHours:0,expectedHours:8,hourlyRate:20}),160);
});
test('images with incomplete prices never proceed directly',()=>{
 const d=inspectDocument({kind:'purchase',items:[{name:'أرز',quantity:2,unit_price:0}]});
 assert.ok(d.missing.some(x=>x.includes('سعر')));
 assert.equal(d.kind,'purchase');
});
test('image review only allows recognized types and positive quantities',()=>{
 const d=inspectDocument({kind:'order',items:[{name:'شاي',quantity:5,unit_price:50}]});
 assert.equal(d.missing.length,0);assert.equal(d.items[0].quantity,5);
 assert.ok(inspectDocument({kind:'unknown',items:[]}).missing.length);
});
test('only allowed local navigation links may pass model output',()=>{
 assert.equal(safeLink('#/employees-list'),'#/employees-list');
 assert.equal(safeLink('#/order/11111111-1111-1111-1111-111111111111'),'#/order/11111111-1111-1111-1111-111111111111');
 assert.equal(safeLink('javascript:alert(1)'),null);
 assert.equal(safeLink('https://host.example/x'),null);
});
test('model-proposed unknown actions are silently dropped, not executed',()=>{
 const p=normalizePlan({answer:'',actions:[{type:'raw_sql',args:{sql:'DELETE FROM payroll_runs'}},{type:'read_dashboard',args:{}}]});
 assert.deepEqual(p.actions.map(x=>x.type),['read_dashboard']);
});
test('payment and posting always require human confirmation',()=>{
 for(const type of ['post_order','post_purchase','pay_daily_wage','pay_approved_salary','record_expense'])assert.ok(CONFIRM_REQUIRED.has(type));
 assert.equal(CONFIRM_REQUIRED.has('create_employees'),false);
});
test('server runs all database calls as logged-in user, not service role',()=>{
 assert.match(server,/db\.auth\.getUser\(/);
 assert.match(server,/rpc\('is_app_owner'\)/);
 assert.doesNotMatch(server,/SERVICE_ROLE_KEY|service_role/);
});
test('financial posting only uses protected RPCs',()=>{
 assert.match(server,/callRpc\(db,'post_order_v013'/);
 assert.match(server,/callRpc\(db,'post_purchase_invoice'/);
 assert.match(server,/callRpc\(db,'pay_daily_wage_v017'/);
 assert.doesNotMatch(server,/from\('cashbox_transactions'\)\.insert/);
});
test('confirmation proposals use one-time pending CAS and expire',()=>{
 assert.match(server,/\.eq\('status','pending'\)\.gt\('expires_at'/);
 assert.match(sql,/expires_at timestamptz NOT NULL/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/user_id = \(SELECT auth\.uid\(\)\)/);
});
test('zero-hour guard checks before legacy payroll RPC',()=>{
 const block=sql.slice(sql.indexOf('FUNCTION public.pay_daily_wage_v017'));
 assert.ok(block.indexOf('NO_DAILY_WAGE_WITHOUT_WORK')<block.indexOf('public.pay_daily_wage_v014'));
 assert.match(sql,/v_att\.worked_hours,0\)<=0/);
 assert.match(sql,/a\.status='paid_leave'/);
});
test('assistant widget includes image review, confirmation and links',()=>{
 for(const phrase of ['agent-file','agent-save-document','confirmAssistantAction','agent-links','جاري الإجابة'])assert.ok(ui.includes(phrase));
});
test('Edge Function deployment is distinct from GitHub Pages static hosting',()=>{
 assert.ok(existsSync(resolve(root,'supabase/functions/assistant/index.ts')));
 assert.ok(existsSync(resolve(root,'database/Maria_CFO_Web_v0.17_Migration.sql')));
 assert.ok(!existsSync(resolve(root,'config.js')));
 assert.ok(!existsSync(resolve(root,'.git')));
});
test('client will not automatically retry writes on 502',()=>{
 const block=api.split('export async function assistantRequest')[1].split('// v0.14:')[0];
 assert.doesNotMatch(block,/for\s*\(/);
 assert.match(block,/functions\.invoke\('assistant'/);
});

test('unjustified attendance zero is never silently recorded',()=>{
 assert.match(server,/أحتاج عدد ساعات العمل الفعلية/);
});
test('OCR discount and low confidence must be visible in preview',()=>{
 assert.match(ui,/data-col="discount_percent"/);
 assert.match(ui,/agent-low-confidence/);
 assert.match(server,/p_line_discount_original:Math\.round/);
 assert.ok(inspectDocument({kind:'purchase',items:[{name:'سكر',quantity:1,unit_price:200,discount_percent:125}]}).missing.some(x=>x.includes('خصم')));
});

test('explicit Gemini probe checks actual model reply and logs 429 without a hidden retry of writes',()=>{
 assert.match(server,/body\?\.action==='probe'/);
 assert.match(ui,/assistantProbe\(\)/);
 assert.match(api,/export async function assistantProbe/);
});
