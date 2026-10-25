import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {
  monthStartV034,filterPayrollReadyV034,currencyGroupsV034,normalizedPayrollRowV034,
} from '../js/payroll-workbench-v034.js';

const base=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pageCode=readFileSync(resolve(base,'js/pages/payroll-v034.js'),'utf8');
const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
})[char]);

function fakeControl(initial=''){
  return {
    value:initial,innerHTML:'',listeners:{},dataset:{},disabled:false,
    addEventListener(event,callback){this.listeners[event]=callback;},
    focus(){},setSelectionRange(){},
  };
}
function makeScreen(){
  const box=fakeControl(),month=fakeControl('10'),year=fakeControl('2026');
  const totals={innerHTML:''};
  const refresh=fakeControl();
  const tabs=['ready','paid'].map(t=>({
    dataset:{payTab:t},classList:{toggle(){}},setAttribute(){},onclick:null,
  }));
  const panel={
    innerHTML:'',payButtons:[],
    querySelector(selector){
      if(selector==='.payroll-statement-table-v034')return this.innerHTML.includes('payroll-statement-table-v034')?{}:null;
      if(selector==='.payroll-paid-table-v034')return this.innerHTML.includes('payroll-paid-table-v034')?{}:null;
      return null;
    },
    querySelectorAll(selector){
      if(selector==='.pay-salary-v034'){
        this.payButtons=[...this.innerHTML.matchAll(/<button class="btn pay-salary-v034" data-id="([^"]+)"([^>]*)>/g)]
          .map(m=>({dataset:{id:m[1]},disabled:/\bdisabled\b/.test(m[2]),onclick:null}));
        return this.payButtons;
      }
      return [];
    },
  };
  const root={
    innerHTML:'',
    querySelector(selector){return {
      '#payroll-data-v034':panel,'#payroll-box-v034':box,'#payroll-month-v034':month,
      '#payroll-year-v034':year,'#payroll-total-v105':totals,'#payroll-refresh-v034':refresh,
    }[selector]??null;},
    querySelectorAll(selector){return selector==='[data-pay-tab]'?tabs:[];},
  };
  return {root,panel,totals,tabs,box};
}

function buildScreen(apiOverrides={}){
  const screen=makeScreen();
  const api={
    payrollReadyV034:async()=>[
      {payroll_item_id:'approved-employee',employee_name:'أحمد',pay_type:'monthly',run_status:'approved',
       currency_code:'SYP',base_pay_original:25000,bonus_original:1000,advance_deduction_original:200,
       net_due_original:25800,paid_original:0,remaining_original:25800,missing_attendance_days:29},
      {payroll_item_id:'draft-employee',employee_name:'أنس',pay_type:'monthly',run_status:'draft',
       currency_code:'SYP',base_pay_original:35000,bonus_original:500,advance_deduction_original:300,
       net_due_original:35200,paid_original:0,remaining_original:35200,missing_attendance_days:29},
    ],
    payrollPaidV034:async()=>[{
      employee_name:'موظف مدفوع',paid_at:'2026-10-12',period_start:'2026-10-01',period_end:'2026-10-31',
      payment_kind:'monthly',amount_original:100,currency_code:'SYP',bonus_original:0,
    }],
    employees:async()=>[{id:'e1',name:'أحمد',status:'active',pay_type:'monthly'}],
    cashboxes:async()=>[{id:'general',name:'الصندوق العام',is_active:true,is_general:true}],
    list:async()=>[{id:'r1',status:'draft',note:'MARIA_MONTHLY_V014:2026-10',period_start:'2026-10-01',period_end:'2026-10-31'}],
    ...apiOverrides,
  };
  const dialogs=[];
  const sandbox={
    api,modal:args=>dialogs.push(args),toast(){},loader:()=>'<p>تحميل...</p>',
    friendlyError:error=>String(error?.message||error),confirmBox:async()=>true,
    currencyLabel:code=>code,esc:htmlEscape,money:(value,code)=>`${Number(value)} ${code}`,
    dateOnly:value=>String(value??'').slice(0,10),todayISO:()=> '2026-10-25',
    registerTableExport(){},monthStartV034,filterPayrollReadyV034,currencyGroupsV034,normalizedPayrollRowV034,
  };
  // Execute the real rendering function with isolated API/DOM dependencies, rather than
  // checking for text tokens that might still reference out-of-scope variables.
  const runnable=pageCode.replace(/^import .*;\s*$/gm,'')
    .replace('export async function renderPayrollV034(', 'async function renderPayrollV034(')
    +'\nglobalThis.renderPayrollForTest=renderPayrollV034;';
  runInNewContext(runnable,sandbox,{filename:'payroll-v034.js'});
  return {...screen,dialogs,render:()=>sandbox.renderPayrollForTest(screen.root)};
}

test('monthly ready screen renders bonuses/advances and employee table without ReferenceError',async()=>{
  const ui=buildScreen();
  await ui.render();
  assert.match(ui.panel.innerHTML,/كشف الموظفين والمستحقات/);
  assert.match(ui.panel.innerHTML,/مجموع المكافآت[\s\S]*?1500 SYP/);
  assert.match(ui.panel.innerHTML,/مجموع السلف المخصومة[\s\S]*?500 SYP/);
  assert.match(ui.panel.innerHTML,/أحمد/);
  assert.match(ui.panel.innerHTML,/أنس/);
  assert.doesNotMatch(ui.panel.innerHTML,/monthlyMonth is not defined|تعذر تحميل كشف الرواتب/);
  assert.match(ui.totals.innerHTML,/61000 SYP/);
  const approved=ui.panel.payButtons.find(b=>b.dataset.id==='approved-employee');
  const draft=ui.panel.payButtons.find(b=>b.dataset.id==='draft-employee');
  assert.equal(approved?.disabled,false,'monthly approved salary should be payable despite missing punches');
  assert.equal(draft?.disabled,true,'draft salary may not be paid before approval');
  approved.onclick();
  assert.equal(ui.dialogs[0]?.title,'تأكيد دفع راتب');
  ui.tabs[1].onclick();
  assert.match(ui.panel.innerHTML,/الرواتب المدفوعة/);
  assert.match(ui.panel.innerHTML,/موظف مدفوع/);
  ui.tabs[0].onclick();
  assert.match(ui.panel.innerHTML,/مجموع المكافآت/);
});

test('empty monthly payroll still displays its totals without crashing',async()=>{
  const ui=buildScreen({payrollReadyV034:async()=>[],payrollPaidV034:async()=>[],employees:async()=>[],
    list:async()=>[],cashboxes:async()=>[]});
  await ui.render();
  assert.match(ui.panel.innerHTML,/كشف الموظفين والمستحقات/);
  assert.match(ui.panel.innerHTML,/مجموع المكافآت/);
  assert.match(ui.panel.innerHTML,/لا توجد مسيرات أو مستحقات مطابقة/);
  assert.doesNotMatch(ui.panel.innerHTML,/تعذر تحميل كشف الرواتب/);
});
