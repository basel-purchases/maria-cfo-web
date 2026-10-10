import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {salaryPeriod,suggestedAdvanceDeduction,requiresAttendance} from '../js/payroll-policy-v023.js?v=0.23';
import {buildEmployeePayload} from '../js/business-rules.js?v=0.23';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const sql=read('database/Maria_CFO_Web_v0.23_Migration.sql');
const wageSource=read('js/pages/employees.js');
const advanceSource=read('js/pages/advances.js');
const assetSource=read('js/pages/assets.js');
const api=read('js/api.js');
test('flat wage maps to its own database column and never requires attendance',()=>{
  const p=buildEmployeePayload({name:'نادر',payType:'fixed',wage:900,currency:'SYP'});
  assert.equal(p.fixed_pay_original_v023,900);assert.equal(p.pay_type,'fixed');assert.equal(p.hourly_rate_original,undefined);
  assert.equal(requiresAttendance('fixed'),false);
  assert.equal(requiresAttendance('daily'),true);
});
test('salary period year/month/day are exact including leap February',()=>{
  assert.deepEqual(salaryPeriod('day','2026-10-10'),{start:'2026-10-10',end:'2026-10-10'});
  assert.deepEqual(salaryPeriod('month','2024-02-21'),{start:'2024-02-01',end:'2024-02-29'});
  assert.deepEqual(salaryPeriod('year','2026-10-10'),{start:'2026-01-01',end:'2026-12-31'});
});
test('advance installment suggestions respect balance and salary cap',()=>{
  const advances=[{employee_id:'1',status:'open',remaining_original:80,repayment_mode:'installments',installment_amount_original:25,occurred_at:'2026-01-01'},
    {employee_id:'1',status:'open',remaining_original:60,repayment_mode:'full_next_payroll',occurred_at:'2026-01-02'},
    {employee_id:'2',status:'open',remaining_original:1000,repayment_mode:'full_next_payroll',occurred_at:'2026-01-01'}];
  assert.equal(suggestedAdvanceDeduction(advances,'1',40),40);
  assert.equal(suggestedAdvanceDeduction(advances,'1',100),85);
  assert.equal(suggestedAdvanceDeduction(advances,'1',0),0);
});
test('daily payroll migration permits separate employees while preserving per-employee note uniqueness',()=>{
  assert.match(sql,/DROP INDEX IF EXISTS public\.payroll_runs_active_period_unique_idx/);
  assert.match(sql,/note\s+NOT LIKE 'MARIA_DAILY_V014:%'/);
  assert.match(sql,/maria_daily_payroll_note_v023_unique/);
  assert.match(sql,/UNIQUE\(employee_id,work_date\)/);
});
test('staff settings and paid leave status store real payroll policy',()=>{
  assert.match(sql,/paid_leave_days_per_year_v023/);
  assert.match(sql,/default_required_daily_hours=p_daily_hours/);
  assert.match(sql,/default_overtime_multiplier=p_overtime_multiplier/);
  assert.match(sql,/status='paid_leave'/);
  assert.match(wageSource,/name="leave_flag"/);
  assert.match(wageSource,/"pay-daily"|class="btn pay-daily"/);
});
test('fixed payout stays atomic and never writes directly to salary ledger from browser',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public.pay_fixed_employee_v023/);
  assert.match(sql,/record_cashbox_transaction\(p_cashbox_id,'out','salary'/);
  assert.match(sql,/fixed_salary_once_per_employee_day UNIQUE\(employee_id,work_date\)/);
  assert.doesNotMatch(api,/insert\(['"]cashbox_transactions['"]/);
  assert.doesNotMatch(api,/insert\(['"]employee_fixed_payments_v023['"]/);
});
test('fixed wage advances also recorded and displayed',()=>{
  assert.match(sql,/employee_fixed_advance_deductions_v023/);
  assert.match(advanceSource,/api\.fixedAdvanceDeductionsV023/);
  assert.match(advanceSource,/name=installment/);
});
test('salary history is paginated at server with day month and year',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public.get_salary_payment_page_v023/);
  assert.match(sql,/LIMIT p_limit OFFSET p_offset/);
  assert.match(wageSource,/salaryPaymentPage\(bounds.start,bounds.end,page\*25,25\)/);
});
test('catalog and basic assets pages use distinct categories and owner RLS',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public.restaurant_assets_v023/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public.material_categories_v023/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public.asset_categories_v023/);
  assert.match(sql,/ALTER TABLE public.material_categories_v023 ENABLE ROW LEVEL SECURITY/);
  assert.match(assetSource,/api\.restaurantAssetsV023/);
  assert.match(read('js/pages/menu.js'),/menu-category-filter/);
  assert.match(read('js/pages/materials.js'),/material-filter-category/);
});
test('single transaction, dependant functions created after their backing table',()=>{
  assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
  assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
  assert.ok(sql.indexOf('CREATE TABLE IF NOT EXISTS public.employee_fixed_payments_v023')<sql.indexOf('CREATE OR REPLACE FUNCTION public.get_financial_statistics_v023('));
  assert.match(sql,/net_total_base=round\(v_paid\*v_before.exchange_rate_to_base,4\)/);
});
test('old functional routes remain present',()=>{
  const app=read('js/app.js');
  for(const route of ['renderMaterials','renderExpenses','renderOrders','renderOrderDetail','renderImages','renderAssistant','renderAssets','renderAdvances'])assert.match(app,new RegExp(route));
  assert.match(app,/Web v0\.24/);
  assert.ok(existsSync(join(root,'supabase/functions/ocr-space/index.ts')));
  assert.ok(existsSync(join(root,'supabase/functions/assistant/index.ts')));
});
