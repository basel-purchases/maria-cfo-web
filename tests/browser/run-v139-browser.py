"""Local Chromium check with synthetic API, never connects to Supabase."""
import os, re, posixpath, shutil, json, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('V139_BROWSER_OUTPUT',str(Path(tempfile.gettempdir())/'maria-v139-browser')))
OUT.mkdir(parents=True,exist_ok=True)
mock=Path(__file__).with_name('v125-api-mock.js').read_text(encoding='utf-8')
extra='''
 if(name==='eventBookings')return copy(data.bookings||[]);
 if(name==='eventBookingBalancesV034')return copy(data.balances||[]);
 if(name==='eventBookingInstallmentOpsV139')return copy(data.ticketOps||[]);
 if(name==='eventBookSeatsV139') {
   const e=args[1],id='booking-'+(data.bookings||[]).length;
   data.bookings??=[];data.balances??=[];data.ticketOps??=[];
   data.bookings.push({id,event_id:'event-test',customer_name:e.name,customer_phone:e.phone,guest_count:e.guests,agreed_amount_original:e.amount,currency_code:'SYP',status:'reserved',installment_next_due_date_v139:e.nextDueDate||null,installment_note_v139:e.installmentNote||null});
   data.balances.push({booking_id:id,paid_original:e.initialPayment,balance_original:e.amount-e.initialPayment});
   data.ticketOps.push({request_key:e.requestKey,booking_id:id,event_id:'event-test',operation:'booking',amount_original:e.initialPayment,currency_code:'SYP',created_at:'2026-11-24T12:00:00Z'});
   return id;
 }
 if(name==='eventCollectBookingInstallmentV139') {
   const bookingId=args[0],e=args[1],b=data.bookings.find(x=>x.id===bookingId),bal=data.balances.find(x=>x.booking_id===bookingId);
   if(e.amount>bal.balance_original)throw Error('overpayment');
   bal.paid_original+=e.amount;bal.balance_original-=e.amount;
   b.installment_next_due_date_v139=bal.balance_original>0?(e.nextDueDate||b.installment_next_due_date_v139):null;
   data.ticketOps.push({request_key:e.requestKey,booking_id:bookingId,event_id:'event-test',operation:'payment',amount_original:e.amount,currency_code:'SYP',note:e.note,created_at:'2026-11-24T13:00:00Z'});
   return e.requestKey;
 }
 if(name==='eventSetBookingInstallmentPlanV139') {
   const b=data.bookings.find(x=>x.id===args[0]);b.installment_next_due_date_v139=args[1]||null;b.installment_note_v139=args[2]||null;return null;
 }
'''
mock=mock.replace(" if(name==='eventV034')",extra+" if(name==='eventV034')",1)
mock+='\nexport const eventBookSeatsV139=(...args)=>call("eventBookSeatsV139",args);'
mock+='\nexport const eventCollectBookingInstallmentV139=(...args)=>call("eventCollectBookingInstallmentV139",args);'
mock+='\nexport const eventSetBookingInstallmentPlanV139=(...args)=>call("eventSetBookingInstallmentPlanV139",args);'
mock+='\nexport const eventBookingInstallmentOpsV139=(...args)=>call("eventBookingInstallmentOpsV139",args);'
IMPORT_RE=re.compile(r'''(?:from\s*|import\s*)(['"])([^'"]+)\1''')
modules={}
def collect(path):
    if path in modules:return
    source=mock if path=='js/api.js' else (ROOT/path).read_text(encoding='utf-8')
    deps={}
    modules[path]={'source':source,'deps':deps}
    for match in IMPORT_RE.finditer(source):
        spec=match.group(2)
        if spec.startswith('.'):
            target=posixpath.normpath(posixpath.join(posixpath.dirname(path),spec.split('?')[0]))
            deps[spec]=target
            collect(target)
collect('js/pages/events-v034.js')
collect('js/latin-digits-v139.js')
steps=[];errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1020},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body><main id="root" style="padding:14px"></main></body></html>')
    page.add_style_tag(content=(ROOT/'assets/styles.css').read_text(encoding='utf-8'))
    page.evaluate('''async (modules) => {
      if(!crypto.randomUUID) crypto.randomUUID=()=>'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
      const urls={};
      const make=(key)=>{
        if(urls[key]) return urls[key];
        let src=modules[key].source;
        for(const [spec,target] of Object.entries(modules[key].deps)){
          const url=make(target);
          src=src.split("'"+spec+"'").join(JSON.stringify(url));
          src=src.split('"'+spec+'"').join(JSON.stringify(url));
        }
        return urls[key]=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
      };
      const {installLatinDigitsV139}=await import(make('js/latin-digits-v139.js'));
      window.__installLatinDigitsV139=()=>installLatinDigitsV139(document.body);
      const {renderEventDetailV034}=await import(make('js/pages/events-v034.js'));
      window.__renderEvents=()=>renderEventDetailV034(document.querySelector('#root'),'event-test','booking');
      await window.__renderEvents();window.__renderDone=true;
    }''',modules)
    page.wait_for_function('window.__renderDone===true')
    page.locator('[data-action="add-booking"]').click()
    form=page.locator('.modal-form')
    form.locator('[name="name"]').fill('عميل تجربة')
    form.locator('[name="guests"]').fill('2')
    form.locator('[name="paymentMode"]').select_option('installment')
    form.locator('[name="firstPayment"]').fill('250')
    form.locator('[name="nextDue"]').fill('2026-12-01')
    expect(form.locator('[data-payment-preview-v139]')).to_contain_text('المتبقي: 750')
    page.screenshot(path=str(OUT/'ticket-first-installment.png'),full_page=True)
    form.locator('button[type="submit"]').click()
    expect(page.locator('.modal-backdrop')).to_have_count(0)
    expect(page.locator('.event-booking-table-v034')).to_contain_text('عميل تجربة')
    expect(page.locator('.event-booking-table-v034')).to_contain_text('750')
    expect(page.locator('.event-booking-table-v034')).to_contain_text('تقسيط')
    first=page.evaluate("window.__eventCalls.filter(x=>x.name==='eventBookSeatsV139').at(-1).args[1]")
    assert first['initialPayment']==250 and first['amount']==1000 and first['cashboxId']=='box-main', first
    assert len(first['requestKey'])==36
    steps.append('First partial payment 250 of 1000 shows 750 due')
    page.screenshot(path=str(OUT/'ticket-balance-table.png'),full_page=True)
    page.locator('[data-book-pay]').click()
    form=page.locator('.modal-form')
    assert form.locator('[data-future-v139]').is_hidden()
    form.locator('[name="amount"]').fill('200')
    expect(form.locator('[data-preview-v139]')).to_contain_text('المتبقي 550')
    assert form.locator('[data-future-v139]').is_visible()
    form.locator('[name="nextDue"]').fill('2026-12-15')
    form.locator('[name="note"]').fill('قسط ثان')
    page.screenshot(path=str(OUT/'ticket-second-installment.png'),full_page=True)
    form.locator('button[type="submit"]').click()
    expect(page.locator('.modal-backdrop')).to_have_count(0)
    expect(page.locator('.event-booking-table-v034')).to_contain_text('550')
    receipt=page.evaluate("window.__eventCalls.filter(x=>x.name==='eventCollectBookingInstallmentV139').at(-1).args[1]")
    assert receipt['amount']==200 and receipt['note']=='قسط ثان',receipt
    steps.append('Second payment 200 leaves 550 due and only 200 recorded to cashbox')
    page.locator('[data-book-plan]').click()
    form=page.locator('.modal-form')
    expect(form.locator('[name="nextDue"]')).to_have_value('2026-12-15')
    form.locator('[name="nextDue"]').fill('2026-12-25')
    form.locator('button[type="submit"]').click()
    expect(page.locator('.modal-backdrop')).to_have_count(0)
    assert page.evaluate("window.__eventCalls.filter(x=>x.name==='eventSetBookingInstallmentPlanV139').length")==1
    steps.append('Updating installment due date does not create a receipt')
    page.locator('[data-book-pay]').click()
    form=page.locator('.modal-form')
    assert form.locator('.event-installment-history-v139').count()==1
    form.locator('[name="amount"]').fill('550')
    form.locator('button[type="submit"]').click()
    expect(page.locator('.modal-backdrop')).to_have_count(0)
    expect(page.locator('.event-booking-table-v034')).to_contain_text('مدفوع بالكامل')
    assert len(page.evaluate('window.__eventTestData.ticketOps'))==3
    steps.append('Final payment zeroes due and marks booking paid once')
    # Exercise the real shipped Latin-digits module on a dynamically inserted node.
    page.evaluate("""() => {
      window.__installLatinDigitsV139();
      const el=document.createElement('div');el.id='latin-check';
      el.textContent='\u0627\u0644\u062f\u0641\u0639 \u0661\u0662\u0663 \u0648 \u06f4\u06f5\u06f6';
      document.body.appendChild(el);
    }""")
    page.wait_for_function("document.getElementById('latin-check').textContent.includes('123') && document.getElementById('latin-check').textContent.includes('456')")
    page.evaluate("""() => {
      const el=document.createElement('input');el.type='tel';el.id='latin-input-check';
      document.body.appendChild(el);el.value='\u0660\u0669\u0661';
      el.dispatchEvent(new Event('input',{bubbles:true}));
    }""")
    page.wait_for_function("document.getElementById('latin-input-check').value==='091'")
    steps.append('Shipped digit formatter normalizes localized labels and typed inputs to 0-9')
    assert not errors,errors
    browser.close()
result={'passed':len(steps),'steps':steps,'errors':errors,'backend':'synthetic browser API only; no Supabase/PostgreSQL test'}
(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
