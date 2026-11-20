"""Offline Chromium acceptance test of v1.0.27.1 hourly & monetary employee adjustments.
No live Supabase is accessed. The API module is replaced by deterministic mocks.
"""
import os, re, posixpath, shutil, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/mnt/data/v127-browser-results');OUT.mkdir(exist_ok=True)
MOCK=r'''const staff={id:'staff-001',name:'عامل الاختبار',job_title:'شيف',department:'المطبخ',status:'active',
 pay_type:'monthly',wage_currency_code:'SYP',monthly_salary_original:208000,required_daily_hours:8,
 hire_date:'2025-01-01',termination_date:null,archived_v123:false};
export const employees=async()=>[staff];
export const employeeAdjustmentsV123=async()=>[];
export const employeeLeaveEventsV123=async()=>[];
export const payrollSettings=async()=>({default_required_daily_hours:8});
export const employeeAdvances=async()=>[];
export const cashboxes=async()=>[{id:'box1',name:'الصندوق العام',is_general:true,is_active:true}];
export const employeeHourRateV127=async(id,date)=>{window.__rateCalls.push([id,date]);return {
 pay_type:'monthly',currency_code:'SYP',salary_basis:208000,hourly_rate:1000,
 monthly_hours:208,working_days:26,daily_hours:8};};
export const recordEmployeeAdjustmentV127=async(value)=>{window.__adj.push(value);return 'adjust-1';};
export const updateEmployeeFinalV123=async()=>{},updateEmployeeHoursV127=async()=>{},createEmployee=async()=>{};
export const prepareScheduledWorkdaysV123=async()=>0;
export const payrollReadyV034=async()=>[],payrollPaidV034=async()=>[],dailyWageDues=async()=>[];
export const list=async()=>[];
'''
IMPORT_RE=re.compile(r'''(?:from\s*|import\s*)(['"])([^'"]+)\1''')
modules={}
def collect(path):
 if path in modules:return
 source=MOCK if path=='js/api.js' else (ROOT/path).read_text(encoding='utf-8')
 dependencies={}
 modules[path]={'source':source,'deps':dependencies}
 for found in IMPORT_RE.finditer(source):
  ref=found.group(2)
  if ref.startswith('.'):
   target=posixpath.normpath(posixpath.join(posixpath.dirname(path),ref.split('?')[0]))
   dependencies[ref]=target
   collect(target)
collect('js/pages/employees.js')
collect('js/pages/payroll-v034.js')
results=[];errors=[]
def record(t):results.append({'scenario':t,'passed':True})
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1080,'height':900})
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body><main id="root"></main></body></html>')
 page.add_style_tag(content=(ROOT/'assets/styles.css').read_text())
 page.evaluate('''async modules=>{
  window.__adj=[];window.__rateCalls=[];
  const urls={};const make=(key)=>{
   if(urls[key])return urls[key];let source=modules[key].source;
   for(const [spec,target] of Object.entries(modules[key].deps)){
    const url=make(target);
    source=source.split("'"+spec+"'").join(JSON.stringify(url));
    source=source.split('"'+spec+'"').join(JSON.stringify(url));
   }
   return urls[key]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  };
  const employee=await import(make('js/pages/employees.js'));
  const payroll=await import(make('js/pages/payroll-v034.js'));
  window.__employee=employee;window.__payroll=payroll;
  await employee.renderEmployees(document.querySelector('#root'));
  window.__ready=true;
 }''',modules)
 page.wait_for_function('window.__ready===true')
 expect(page.locator('.employee-clickable')).to_have_count(1)
 page.locator('.employee-clickable').click()
 expect(page.locator('.staff-v123-addition')).to_be_visible()
 record('Employee profile offers additions and deductions')
 page.locator('.staff-v123-addition').click()
 dialog=page.locator('.modal-backdrop').last
 dialog.locator('[name="value_kind"]').select_option('hours')
 dialog.locator('[name="date"]').fill('2026-11-20')
 dialog.locator('[name="hours"]').fill('3')
 expect(dialog.locator('[data-hour-preview]')).to_contain_text('3,000')
 expect(dialog.locator('[name="amount"]')).to_be_disabled()
 dialog.locator('[name="reason"]').fill('عمل إضافي')
 dialog.locator('[type="submit"]').click()
 page.wait_for_function('window.__adj.length===1')
 posted=page.evaluate('window.__adj[0]')
 assert posted['kind']=='addition' and posted['valueKind']=='hours' and posted['value']=='3'
 record('Employee three-hour addition shows SQL-based price and submits hours, not money')
 page.locator('.staff-v123-deduction').click()
 dialog=page.locator('.modal-backdrop').last
 expect(dialog.locator('[name="value_kind"]')).to_have_value('money')
 dialog.locator('[name="amount"]').fill('15000')
 dialog.locator('[name="reason"]').fill('خصم إداري')
 dialog.locator('[type="submit"]').click()
 page.wait_for_function('window.__adj.length===2')
 posted=page.evaluate('window.__adj[1]')
 assert posted['kind']=='deduction' and posted['valueKind']=='money' and posted['value']=='15000'
 record('Employee money deduction uses the same ledger without hourly conversion')
 page.locator('.staff-employee-modal .x-btn').click()
 page.evaluate("async()=>{document.querySelector('#root').innerHTML='';await window.__payroll.renderPayrollV034(document.querySelector('#root'));}")
 expect(page.locator('[data-salary-adjust="addition"]')).to_be_visible()
 page.locator('[data-salary-adjust="addition"]').click()
 dialog=page.locator('.modal-backdrop').last
 expect(dialog.locator('[name="employee"]')).to_have_value('staff-001')
 dialog.locator('[type="submit"]').click()
 dialog=page.locator('.modal-backdrop').last
 expect(dialog.locator('[name="value_kind"]')).to_be_visible()
 dialog.locator('[name="value_kind"]').select_option('hours')
 dialog.locator('[name="hours"]').fill('2')
 expect(dialog.locator('[data-hour-preview]')).to_contain_text('2,000')
 dialog.locator('[name="reason"]').fill('ساعات إضافية من المسير')
 dialog.locator('[type="submit"]').click()
 page.wait_for_function('window.__adj.length===3')
 posted=page.evaluate('window.__adj[2]')
 assert posted['kind']=='addition' and posted['valueKind']=='hours' and posted['value']=='2'
 record('Payroll page opens same hours modal for a selected employee')
 assert not errors,errors
 page.screenshot(path=str(OUT/'payroll-hour-actions.png'),full_page=True)
 browser.close()
(OUT/'results.json').write_text(json.dumps({'passed':len(results),'results':results,'page_errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':len(results),'results':results,'page_errors':errors},ensure_ascii=False,indent=2))
