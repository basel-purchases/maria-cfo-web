"""Chromium offline UI checks for v1.0.28. All API calls are mocked (no real DB)."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import shutil, re, posixpath, json
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/mnt/data/v128-browser-results');OUT.mkdir(exist_ok=True)
MOCK='''const emp1={id:'emp-1',name:'موظف شهري',status:'active',archived_v123:false,pay_type:'monthly',
 wage_currency_code:'SYP',monthly_salary_original:2000000,required_daily_hours:8,hire_date:'2025-01-01',termination_date:null};
const emp2={id:'emp-2',name:'موظف انتهى عمله',status:'active',archived_v123:false,pay_type:'monthly',
 wage_currency_code:'SYP',monthly_salary_original:1500000,required_daily_hours:8,hire_date:'2026-11-01',termination_date:'2026-11-15'};
export const employees=async()=>[emp1,emp2];
export const employeeAdvanceOutstandingV128=async()=>[{employee_id:'emp-1',currency_code:'SYP',remaining_original:3500000,open_count:1}];
export const payrollReadyV034=async()=>[{payroll_item_id:'item1',employee_id:'emp-1',payroll_run_id:'run1',employee_name:'موظف شهري',pay_type:'monthly',run_status:'draft',currency_code:'SYP',base_pay_original:2000000,advance_deduction_original:2000000,net_due_original:0,paid_original:0,remaining_original:0,period_start:'2026-11-01',period_end:'2026-11-30'}];
export const payrollPaidV034=async()=>[];
export const cashboxes=async()=>[{id:'box1',name:'الصندوق العام',is_active:true,is_general:true}];
export const prepareScheduledWorkdaysV123=async()=>0;
export const dailyWageDues=async()=>[];
export const list=async(name)=>name==='payroll_runs'?[{id:'run1',status:'draft',note:'MARIA_MONTHLY_V014:2026-11',period_start:'2026-11-01',period_end:'2026-11-30'}]:[];
export const createMonthlyPayrollV128=async date=>{window.__created.push(date);return 'run1'};
export const recalculateMonthlyPayrollV128=async id=>{window.__recalculated.push(id)};
export const approveMonthlyPayrollV128=async id=>{window.__approved.push(id)};
export const employeeAdjustmentsV123=async()=>[];
export const employeeLeaveEventsV123=async()=>[];
export const employeeAdvances=async()=>[{id:'loan1',employee_id:'emp-1',currency_code:'SYP',remaining_original:3500000,principal_original:3500000,status:'open',occurred_at:'2026-11-02T12:00:00Z',repayment_mode:'full_next_payroll',cashbox_id:'box1'}];
export const fixedAdvanceDeductionsV023=async()=>[];
export const advanceDeductions=async()=>[];
export const payrollSettings=async()=>({default_required_daily_hours:8});
export const recordEmployeeAdvanceV128=async data=>{window.__advances.push(data);return 'advance-id';};
export const recordEmployeeLeaveV123=async data=>{window.__leaves.push(data);return 'leave-id';};
export const employeeHourRateV127=async()=>({pay_type:'monthly',currency_code:'SYP',hourly_rate:1000,monthly_hours:208,working_days:26,daily_hours:8});
export const recordEmployeeAdjustmentV127=async()=>({id:'a1'});
export const updateEmployeeFinalV123=async()=>{},updateEmployeeHoursV127=async()=>{},createEmployee=async()=>{};
'''
IMPORT_RE=re.compile(r'''(?:from\s*|import\s*)(['"])([^'"]+)\1''')
mods={}
def collect(path):
 if path in mods:return
 source=MOCK if path=='js/api.js' else (ROOT/path).read_text(encoding='utf-8')
 deps={};mods[path]={'source':source,'deps':deps}
 for match in IMPORT_RE.finditer(source):
  spec=match.group(2)
  if spec.startswith('.'):
   target=posixpath.normpath(posixpath.join(posixpath.dirname(path),spec.split('?')[0]));deps[spec]=target;collect(target)
for f in ['js/pages/payroll-v034.js','js/pages/employees.js','js/pages/advances.js']:collect(f)
results=[];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1150,'height':900})
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body><main id="root"></main></body></html>')
 page.add_style_tag(content=(ROOT/'assets/styles.css').read_text(encoding='utf-8'))
 page.evaluate('''async modules=>{
  window.__created=[];window.__recalculated=[];window.__approved=[];window.__advances=[];window.__leaves=[];
  const urls={};const make=key=>{
   if(urls[key])return urls[key];let text=modules[key].source;
   for(const [spec,target] of Object.entries(modules[key].deps)){
    const u=make(target);text=text.split("'"+spec+"'").join(JSON.stringify(u));text=text.split('"'+spec+'"').join(JSON.stringify(u));
   }
   return urls[key]=URL.createObjectURL(new Blob([text],{type:'text/javascript'}));
  };
  window.__payroll=await import(make('js/pages/payroll-v034.js'));
  window.__employees=await import(make('js/pages/employees.js'));
  window.__advancesPage=await import(make('js/pages/advances.js'));
  await window.__payroll.renderPayrollV034(document.querySelector('#root'));
 }''',mods)
 expect(page.locator('#new-month-run-v034')).to_be_visible();results.append('Payroll form opens')
 expect(page.locator('.payroll-statement-table-v034')).to_contain_text('بعد اعتماد المسودة: 1,500,000')
 results.append('Advance residual shown, projected only for draft')
 page.locator('#new-month-run-v034').click()
 dialog=page.locator('.modal-backdrop').last
 expect(dialog.locator('[name="period_date"]')).to_have_value('')
 dialog.locator('[name="period_date"]').fill('2019-11-16')
 dialog.locator('[type="submit"]').click()
 page.wait_for_function('window.__created.length===1')
 assert page.evaluate('window.__created[0]')=='2019-11-16'
 expect(page.locator('#payroll-year-v034')).to_have_value('2019')
 expect(page.locator('#payroll-month-v034')).to_have_value('11')
 results.append('Manager picks a historical entitlement month, period selector updates (not auto-current)')
 page.evaluate("async()=>{document.querySelector('#root').innerHTML='';await window.__advancesPage.renderAdvances(document.querySelector('#root'));}")
 page.locator('.add-advance').click()
 dialog=page.locator('.modal-backdrop').last
 dialog.locator('[name="employee"]').select_option('emp-2')
 date=dialog.locator('[name="date"]')
 expect(date).to_have_attribute('min','2026-11-01')
 expect(date).to_have_attribute('max','2026-11-15')
 date.fill('2026-11-16')
 assert date.evaluate('(e)=>e.checkValidity()') is False
 date.fill('2026-11-12')
 dialog.locator('[name="amount"]').fill('50000')
 dialog.locator('[type="submit"]').click()
 page.wait_for_function('window.__advances.length===1')
 assert page.evaluate('window.__advances[0].date')=='2026-11-12'
 results.append('Advance dialog rejects outside employment dates and sends valid date')
 page.evaluate("async()=>{document.querySelector('#root').innerHTML='';await window.__employees.renderEmployees(document.querySelector('#root'));}")
 expect(page.locator('.employee-clickable')).to_have_count(2)
 page.locator('.employee-clickable[data-employee="emp-1"]').click()
 expect(page.locator('[data-employee-insights]')).to_contain_text('3,500,000')
 results.append('Employee profile shows outstanding advance amount')
 # close employee window
 page.locator('.staff-employee-modal .x-btn').click()
 page.locator('.employee-clickable[data-employee="emp-2"]').click()
 page.locator('.staff-v123-leave').click()
 leave=page.locator('.modal-backdrop').last
 expect(leave.locator('[name="date"]')).to_have_attribute('min','2026-11-01')
 expect(leave.locator('[name="date"]')).to_have_attribute('max','2026-11-15')
 leave.locator('[name="date"]').fill('2026-11-16')
 assert leave.locator('[name="date"]').evaluate('(e)=>e.checkValidity()') is False
 leave.locator('[name="date"]').fill('2026-11-12')
 leave.locator('[type="submit"]').click()
 page.wait_for_function('window.__leaves.length===1')
 results.append('Leave dialog constrains service dates')
 assert not errors,errors
 page.screenshot(path=str(OUT/'employee-service-and-payroll-v128.png'),full_page=True)
 browser.close()
(OUT/'results.json').write_text(json.dumps({'scenarios_passed':len(results),'results':results,'page_errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'scenarios_passed':len(results),'results':results,'page_errors':errors},ensure_ascii=False))
