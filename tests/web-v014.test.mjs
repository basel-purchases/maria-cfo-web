import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PAY_LABELS,payTypeBadge,currenciesSummary} from '../js/payroll-ui.js';
import {finalProfitValue,qualityMessages,financialCard,barTrend} from '../js/finance-ui.js';
const base=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sql=readFileSync(join(base,'database/Maria_CFO_Web_v0.14_Migration.sql'),'utf8');
const api=readFileSync(join(base,'js/api.js'),'utf8');
const index=readFileSync(join(base,'index.html'),'utf8');

test('pay type badges use distinct and consistent labels',()=>{
  assert.equal(PAY_LABELS.monthly,'شهري');
  assert.match(payTypeBadge('monthly'),/pay-monthly/);
  assert.match(payTypeBadge('daily'),/pay-daily/);
  assert.match(payTypeBadge('hourly'),/pay-hourly/);
  assert.notEqual(payTypeBadge('daily'),payTypeBadge('hourly'));
});
test('currency due amounts are NOT summed across currencies',()=>{
  const x=currenciesSummary([
    {estimated_due_original:10,currency_code:'USD'},
    {estimated_due_original:1000,currency_code:'SYP'},
    {estimated_due_original:20,currency_code:'USD'},
  ]);
  assert.match(x,/٣٠ USD/);
  assert.match(x,/SYP/);
});
test('profit remains provisional if cost data is incomplete',()=>{
  assert.equal(finalProfitValue({kpis:{profit_is_final:false,net_result_base:null,provisional_net_result_base:345}}),345);
  assert.equal(finalProfitValue({kpis:{profit_is_final:true,net_result_base:300,provisional_net_result_base:345}}),300);
  assert.equal(finalProfitValue({}),null);
});
test('quality warnings expose duplicate and incomplete orders',()=>{
  const warnings=qualityMessages({data_quality:{profit_is_final:false,incomplete_order_count:2,duplicate_order_count:1}});
  assert.ok(warnings.length>=3);
});
test('chart markup escapes server-provided labels',()=>{
  const x=barTrend([{period_start:'<bad>',total_revenue_base:100}]);
  assert.ok(!x.includes('<bad>'));
  assert.ok(x.includes('&lt;bad&gt;'));
});
test('statistical KPI values use numeric value or explicit missing mark',()=>{
  assert.match(financialCard('إيراد',0),/٠ SYP/);
  assert.match(financialCard('إيراد',null),/—/);
});
test('financial RPC uses exact verified parameter names',()=>{
  assert.match(api,/get_financial_statistics',\{p_start_date:start,p_end_date:end\}/);
  assert.match(api,/get_home_dashboard',\{p_business_date:todayISO\(\)\}/);
  assert.match(api,/get_statistics_time_series'/);
});
test('all new payroll handlers use protected RPCs',()=>{
  for(const name of ['pay_approved_salary_v014','set_payroll_cashbox_v014']){
    assert.match(api,new RegExp(name));
    assert.match(sql,new RegExp('FUNCTION public\\.'+name));
  }
  const migration17=readFileSync(join(base,'database/Maria_CFO_Web_v0.17_Migration.sql'),'utf8');
  for(const name of ['get_daily_wage_dues_v017','pay_daily_wage_v017']){
    assert.match(api,new RegExp(name));
    assert.match(migration17,new RegExp('FUNCTION public\\.'+name));
  }
  assert.match(sql,/public\.record_payroll_payment\(/);
  assert.match(sql,/PAYROLL_PERIOD_ALREADY_SETTLED/);
  assert.match(sql,/ATTENDANCE_PAYROLL_LOCKED/);
});
test('no direct cashbox ledger writes in migration',()=>{
  assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.cashbox_transactions/i);
  assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.payroll_payments/i);
});
test('all relative JS imports exist and are versioned',()=>{
  const root=join(base,'js');
  function check(dir){
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      const abs=join(dir,entry.name);
      if(entry.isDirectory())check(abs);
      else if(entry.name.endsWith('.js')){
        const text=readFileSync(abs,'utf8');
        const rx=/(?:from\s*|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
        for(const m of text.matchAll(rx)){
          const relative=m[1].split('?')[0];
          assert.ok(existsSync(resolve(dir,relative)),`${abs} missing ${relative}`);
          assert.match(m[1],/\?v=0\.21$/);
        }
      }
    }
  }
  check(root);
  assert.match(index,/v=0\.21/);
});
test('project ZIP contents do not need Git or config changes',()=>{
  assert.equal(existsSync(join(base,'config.js')),false);
  assert.equal(existsSync(join(base,'.github')),false);
  assert.equal(existsSync(join(base,'.git')),false);
});
