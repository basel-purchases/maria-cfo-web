import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {currencyGroupsV034,filterPayrollReadyV034,monthStartV034,payrollReconciliationV034} from '../js/payroll-workbench-v034.js';
import {eventRuleQuantityV034,eventCostQuoteV034,eventActualResultV034} from '../js/event-cost-v034.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('database/Maria-CFO-Web-v0.34-Payroll-Events.sql');
const api=read('js/api.js');
const app=read('js/app.js');
const events=read('js/pages/events-v034.js');
const payroll=read('js/pages/payroll-v034.js');

test('selected payroll period is a validated first-of-month date',()=>{
 assert.equal(monthStartV034(2026,10),'2026-10-01');
 assert.throws(()=>monthStartV034(2026,13));
 assert.throws(()=>monthStartV034(1800,2));
});
test('payroll amounts never silently merge different currencies',()=>{
 assert.deepEqual(currencyGroupsV034([{currency_code:'SYP',net:20000},{currency_code:'USD',net:20},{currency_code:'SYP',net:5000}],'net'),
  [{currency_code:'SYP',amount:25000},{currency_code:'USD',amount:20}]);
});
test('only approved payroll with remaining balance is payable',()=>{
 const raw={employee_name:'أحمد',currency_code:'SYP',base_pay_original:100000,net_due_original:90000,remaining_original:90000,missing_attendance_days:0};
 const draft=filterPayrollReadyV034([{...raw,run_status:'draft'}])[0];
 assert.equal(draft.payable,false);assert.equal(draft.isDraft,true);
 const missing=filterPayrollReadyV034([{...raw,run_status:'approved',missing_attendance_days:1}])[0];
 assert.equal(missing.payable,false);
 const ready=filterPayrollReadyV034([{...raw,run_status:'approved',paid_original:10000,remaining_original:80000}])[0];
 assert.equal(ready.remaining,80000);assert.equal(ready.payable,true);
 assert.deepEqual(payrollReconciliationV034([{...raw,run_status:'approved'},{...raw,run_status:'draft'}]),[{currency_code:'SYP',amount:90000}]);
});
test('payroll search tolerates Arabic hamza and diacritics',()=>{
 const base={run_status:'approved',net_due_original:1,remaining_original:1};
 assert.equal(filterPayrollReadyV034([{...base,employee_name:'أَنس'},{...base,employee_name:'حسام'}],'انس').length,1);
});
test('table-based menu rules never use incorrect global ceil total',()=>{
 assert.equal(eventRuleQuantityV034({rule_type:'per_n_people',quantity_per_rule:1,people_per_rule:4},8,2),2);
 const q=eventCostQuoteV034({guests:8,tables:2,
  menuRules:[{menu_item_id:'tabbouleh',rule_type:'per_n_people',quantity_per_rule:1,people_per_rule:4,required_quantity:3,unit_food_cost_base:15000}],
  wasteReservePercent:0,targetMarginPercent:20,ticketPrice:12500});
 assert.equal(q.food,45000);assert.equal(q.costPerPerson,5625);
 assert.equal(q.breakEvenTicket,5625);assert.equal(q.suggestedTicket,7031.25);
 assert.equal(q.profit,55000);
});
test('per-person, per-table and fixed rules all produce correct quantities',()=>{
 assert.equal(eventRuleQuantityV034({rule_type:'per_person',quantity_per_rule:1},12,3),12);
 assert.equal(eventRuleQuantityV034({rule_type:'per_table',quantity_per_rule:2},12,3),6);
 assert.equal(eventRuleQuantityV034({rule_type:'fixed_event',quantity_per_rule:1},12,3),1);
});
test('recipe without known cost invalidates projected profit',()=>{
 const q=eventCostQuoteV034({guests:10,menuRules:[{menu_item_id:'unknown',required_quantity:10}]});
 assert.equal(q.missing,1);assert.equal(q.reliable,false);
});
test('planned event correctly separates food, music, labor, waste reserve and margin',()=>{
 const q=eventCostQuoteV034({guests:20,tables:5,
  menuRules:[{menu_item_id:'meal',required_quantity:20,unit_food_cost_base:5000}],
  otherCosts:[{planned_amount_base:30000}],laborCosts:[{planned_cost_base:20000}],
  wasteReservePercent:10,targetMarginPercent:25,ticketPrice:11000,exchangeRate:1});
 assert.equal(q.food,100000);assert.equal(q.others,30000);assert.equal(q.labor,20000);
 assert.equal(q.reserve,10000);assert.equal(q.total,160000);assert.equal(q.suggestedTicket,160000/(20*.75));
 assert.equal(q.revenue,220000);assert.equal(q.profit,60000);
});
test('pending extra tab bills accrue revenue/cost but never count as cash received',()=>{
 const actual=eventActualResultV034({historical:{earned_revenue_base:100000,actual_total_cost_historical_base:55000,actual_guest_count:10},
  extras:[{status:'pending',amount_original:100,exchange_rate_to_base:1000,total_cost_base:60000}],
  bookingBalances:[],tables:[]});
 assert.equal(actual.revenue,200000);assert.equal(actual.cost,115000);assert.equal(actual.profit,85000);
 assert.equal(actual.extraCollected,0);assert.equal(actual.extraDue,100);assert.equal(actual.readyToClose,false);
});
test('settled extra gets actual cashbox FX snapshot and contributes its product cost',()=>{
 const actual=eventActualResultV034({historical:{earned_revenue_base:0,actual_total_cost_historical_base:0,actual_guest_count:2},
  extras:[{status:'paid',amount_original:10,exchange_rate_to_base:200,paid_amount_base:2300,total_cost_base:1500}],bookingBalances:[]});
 assert.equal(actual.revenue,2300);assert.equal(actual.extraCollected,2300);
 assert.equal(actual.cost,1500);assert.equal(actual.profit,800);
});
test('cancelled extras vanish from revenue/cost; refunded extras keep consumed cost',()=>{
 const actual=eventActualResultV034({historical:{earned_revenue_base:0,actual_total_cost_historical_base:0},
  extras:[{status:'voided',amount_original:50,total_cost_base:100},{status:'refunded',amount_original:25,total_cost_base:11}]});
 assert.equal(actual.revenue,0);assert.equal(actual.cost,11);
});
test('cash payments are protected RPC calls, never direct writes from browser',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.pay_approved_salary_v034[\s\S]*?FOR UPDATE OF pi/);
 assert.match(sql,/PERFORM public\.ensure_cashbox_session_v013\(p_cashbox_id,now\(\)\)/);
 assert.match(sql,/v_payment:=public\.record_payroll_payment\(/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.pay_event_extra_v034[\s\S]*?FOR UPDATE/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(api,/payApprovedSalaryV034=.*rpc\('pay_approved_salary_v034'/);
 assert.match(api,/eventPayExtraV034=.*rpc\('pay_event_extra_v034'/);
});
test('cash-sensitive event rules prevent unpaid exits, missing recipes and unknown guests',()=>{
 assert.match(sql,/EVENT_HAS_UNPAID_EXTRAS/);
 assert.match(sql,/EVENT_HAS_UNPAID_BOOKINGS/);
 assert.match(sql,/EVENT_FOOD_COST_INCOMPLETE/);
 assert.match(sql,/actual_guest_count IS NULL/);
 assert.match(sql,/public\.complete_event\(p_event_id,v_guests,now\(\)/);
});
test('SQL event extras snapshot food COGS, currency FX, payment and refund',()=>{
 assert.match(sql,/unit_cost_base numeric\(20,4\)/);
 assert.match(sql,/exchange_rate_to_base numeric\(20,8\)/);
 assert.match(sql,/FROM public\.menu_item_costs WHERE id=p_menu_item_id/);
 assert.match(sql,/cashbox_transaction_id=v_tx/);
 assert.match(sql,/refund_transaction_id=v_tx/);
 assert.match(sql,/CREATE POLICY maria_event_extras_owner_v034/);
});
test('user-facing v0.34 routes contain salary desk, event map, activity log, receipt and tab exports',()=>{
 assert.match(app,/case 'payroll': return renderPayrollV034\(root\)/);
 assert.match(app,/case 'event': return renderEventDetailV034\(root,id\)/);
 assert.match(payroll,/registerTableExport\(/);
 assert.match(payroll,/صندوق الدفع/);
 assert.match(payroll,/الرواتب الجاهزة للدفع/);
 assert.match(payroll,/الرواتب المدفوعة/);
 assert.match(events,/event-seat-map-v034/);
 assert.match(events,/tableInvoice\(/);
 assert.match(events,/event-activity-stream-v034/);
 assert.match(events,/registerTableExport\(/);
 assert.match(read('index.html'),/app\.js\?v=0\.(?:34|35)/);
});
test('release preserves all old functionality and omits config from editable project tree',()=>{
 assert.equal(fs.existsSync(path.join(root,'config.js')),false);
 assert.ok(fs.existsSync(path.join(root,'js/pages/employees.js')));
 assert.ok(fs.existsSync(path.join(root,'js/pages/bonuses.js')));
 assert.ok(fs.existsSync(path.join(root,'js/quick-imports-v030.js')));
});
