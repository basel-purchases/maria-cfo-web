import json, re, posixpath, os, shutil, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('V125_BROWSER_OUTPUT',str(Path(tempfile.gettempdir())/'maria-cfo-v125-browser'))); OUT.mkdir(parents=True,exist_ok=True)
mock=Path(__file__).with_name('v125-api-mock.js').read_text(encoding='utf-8')
IMPORT_RE=re.compile(r'''(?:from\s*|import\s*)(['"])([^'"]+)\1''')
modules={}
def collect(path):
    if path in modules: return
    source=mock if path=='js/api.js' else (ROOT/path).read_text()
    deps={}
    modules[path]={'source':source,'deps':deps}
    for match in IMPORT_RE.finditer(source):
        spec=match.group(2)
        if spec.startswith('.'):
            target=posixpath.normpath(posixpath.join(posixpath.dirname(path),spec.split('?')[0]))
            deps[spec]=target
            collect(target)
collect('js/pages/events-v034.js')
results=[];errors=[]
def record(name): results.append({'test':name,'passed':True})
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="padding:20px;max-width:1500px;margin:auto"></main></body></html>')
    page.add_style_tag(content=(ROOT/'assets/styles.css').read_text())
    page.evaluate('''async (modules) => {
      // Test-only UUID shim for the offline about:blank environment.
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
      const {renderEventDetailV034}=await import(make('js/pages/events-v034.js'));
      window.__renderEvents=()=>renderEventDetailV034(document.querySelector('#root'),'event-test');
      await window.__renderEvents();
      window.__renderDone=true;
    }''',modules)
    page.wait_for_function('window.__renderDone===true')
    expect(page.locator('[data-tab="extras"]')).to_be_visible()
    record('Event loads with the v125 authoritative summary')
    page.locator('[data-tab="extras"]').click()
    expect(page.locator('.event-extra-table-v034 tbody tr')).to_have_count(3)
    expect(page.locator('.event-extra-table-v034')).to_contain_text('ضيافة إضافية مجانية')
    page.locator('.toast-box').evaluate_all('(els)=>els.forEach(el=>el.remove())')
    page.screenshot(path=str(OUT/'orders-desktop.png'),full_page=True)
    record('Orders ledger shows internal, external and complimentary rows')
    page.locator('[data-action="add-extra"]').click()
    form=page.locator('.modal-form')
    expect(form.locator('[name="unitCost"]')).to_have_value('')
    form.locator('[name="menu"]').select_option('menu-good')
    expect(form.locator('[name="description"]')).to_have_value('عصير برتقال')
    form.locator('[name="qty"]').fill('2');form.locator('[name="price"]').fill('50')
    expect(form.locator('[data-internal-preview-v125]')).to_contain_text('40')
    page.locator('.toast-box').evaluate_all('(els)=>els.forEach(el=>el.remove())')
    page.screenshot(path=str(OUT/'internal-form-desktop.png'),full_page=True)
    form.locator('button[type="submit"]').click()
    page.wait_for_function("window.__eventCalls.some(x=>x.name==='eventAddInternalOrderV125')")
    call=page.evaluate("window.__eventCalls.filter(x=>x.name==='eventAddInternalOrderV125').at(-1)")
    assert call['args'][1]['billingMode']=='sale' and call['args'][1]['menuItemId']=='menu-good'
    assert len(call['args'][1]['requestKey'])==36
    expect(page.locator('.modal-backdrop')).to_have_count(0)
    record('Internal recipe order previews correct profit and submits a stable request key')
    page.locator('[data-action="add-extra"]').click();form=page.locator('.modal-form')
    form.locator('[name="billingMode"]').select_option('hospitality')
    form.locator('[name="description"]').fill('ضيافة اختبار')
    form.locator('[name="unitCost"]').fill('30');form.locator('[name="qty"]').fill('2')
    expect(form.locator('[name="price"]')).to_be_hidden()
    expect(form.locator('[data-internal-preview-v125]')).to_contain_text('60')
    expect(form.locator('[data-internal-preview-v125]')).to_contain_text('إيراد إضافي صفر')
    form.locator('button[type="submit"]').click()
    expect(page.locator('.modal-backdrop')).to_have_count(0)
    call=page.evaluate("window.__eventCalls.filter(x=>x.name==='eventAddInternalOrderV125').at(-1)")
    assert call['args'][1]['unitPrice']==0 and call['args'][1]['billingMode']=='hospitality'
    record('Complimentary internal hospitality submits zero sale with explicit cost')
    page.locator('[data-action="add-extra"]').click();form=page.locator('.modal-form')
    form.locator('[name="menu"]').select_option('menu-bad')
    expect(form.locator('[data-internal-preview-v125]')).to_contain_text('غير مكتملة')
    form.locator('[name="price"]').fill('50')
    count=page.evaluate("window.__eventCalls.filter(x=>x.name==='eventAddInternalOrderV125').length")
    form.locator('button[type="submit"]').click()
    expect(page.locator('.modal-backdrop')).to_have_count(1)
    assert page.evaluate("window.__eventCalls.filter(x=>x.name==='eventAddInternalOrderV125').length")==count
    form.locator('.cancel').click()
    record('Incomplete recipe cannot be submitted as zero cost')
    page.locator('[data-tab="external"]').click()
    expect(page.locator('.event-external-purchases-table-v038 tbody tr')).to_have_count(2)
    expect(page.locator('[data-external-price="free-sweets"]')).to_be_visible()
    expect(page.locator('[data-external-use="cake"]')).to_have_count(0)
    page.locator('.toast-box').evaluate_all('(els)=>els.forEach(el=>el.remove())')
    page.screenshot(path=str(OUT/'external-desktop.png'),full_page=True)
    record('Resale purchase is excluded from free hospitality actions')
    page.locator('[data-action="external-new"]').click();form=page.locator('.modal-form')
    form.locator('[name="name"]').fill('قالب كاتو تجريبي')
    form.locator('[name="unit"]').fill('قالب');form.locator('[name="unitCost"]').fill('100')
    form.locator('[name="unitProfit"]').fill('25')
    expect(form.locator('[data-external-preview-v125]')).to_contain_text('125')
    expect(form.locator('[data-external-preview-v125]')).to_contain_text('25')
    page.locator('.toast-box').evaluate_all('(els)=>els.forEach(el=>el.remove())')
    page.screenshot(path=str(OUT/'external-form-desktop.png'),full_page=True)
    form.locator('button[type="submit"]').click()
    expect(page.locator('.modal-backdrop')).to_have_count(0)
    call=page.evaluate("window.__eventCalls.filter(x=>x.name==='eventAddExternalDishV125').at(-1)")
    assert call['args'][1]['unitProfit']=='25' and call['args'][1]['billingMode']=='sale'
    record('External cake order submits explicit per-unit markup and one request key')
    page.locator('[data-action="external-new"]').click();form=page.locator('.modal-form')
    form.locator('[name="billingMode"]').select_option('hospitality')
    form.locator('[name="name"]').fill('حلويات مجانية');form.locator('[name="unitCost"]').fill('40')
    expect(form.locator('[name="unitProfit"]')).to_be_hidden()
    form.locator('button[type="submit"]').click();expect(page.locator('.modal-backdrop')).to_have_count(0)
    call=page.evaluate("window.__eventCalls.filter(x=>x.name==='eventAddExternalDishV125').at(-1)")
    assert call['args'][1]['unitProfit']==0 and call['args'][1]['billingMode']=='hospitality'
    record('External complimentary purchase carries no sales markup')
    page.locator('[data-external-price="free-sweets"]').click();form=page.locator('.modal-form')
    form.locator('[name="profit"]').fill('10')
    expect(form.locator('[data-price-existing-v125]')).to_contain_text('50')
    form.locator('button[type="submit"]').click();expect(page.locator('.modal-backdrop')).to_have_count(0)
    assert page.evaluate("window.__eventCalls.filter(x=>x.name==='eventPriceExternalDishV125').at(-1).args")==['free-sweets','10']
    record('Existing unused purchase can be priced without creating a second purchase')
    page.locator('[data-extra-pay="external-1"]').click();form=page.locator('.modal-form')
    expect(form).to_contain_text('125')
    form.locator('button[type="submit"]').click();expect(page.locator('.modal-backdrop')).to_have_count(0)
    assert page.evaluate("window.__eventCalls.filter(x=>x.name==='eventPayExtraV034').at(-1).args")==['external-1','box-main']
    record('Customer collection uses the linked sales invoice, not the supplier bill')
    page.locator('[data-external-pay="cake"]').click();form=page.locator('.modal-form')
    expect(form).to_contain_text('100')
    form.locator('button[type="submit"]').click();expect(page.locator('.modal-backdrop')).to_have_count(0)
    assert page.evaluate("window.__eventCalls.filter(x=>x.name==='eventPayExternalDishV038').at(-1).args")==['cake','box-main']
    record('Supplier settlement uses only purchase cost')
    page.locator('[data-tab="report"]').click()
    expect(page.locator('.event-report-table-v034')).to_contain_text('الربح أو الخسارة التشغيلية للحفلة')
    expect(page.locator('.event-report-table-v034')).to_contain_text('1,005')
    page.locator('.toast-box').evaluate_all('(els)=>els.forEach(el=>el.remove())')
    page.screenshot(path=str(OUT/'report-desktop.png'),full_page=True)
    record('Report shows cost, sales and profit separately with no markup double-add')
    page.set_viewport_size({'width':390,'height':844})
    page.locator('[data-tab="extras"]').click()
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
    page.locator('.toast-box').evaluate_all('(els)=>els.forEach(el=>el.remove())')
    page.screenshot(path=str(OUT/'orders-mobile.png'),full_page=True)
    page.locator('[data-action="add-extra"]').click()
    form=page.locator('.modal-form')
    form.locator('[name="description"]').fill('طلب اختبار')
    form.locator('[name="unitCost"]').fill('30');form.locator('[name="price"]').fill('50')
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
    page.locator('.toast-box').evaluate_all('(els)=>els.forEach(el=>el.remove())')
    page.screenshot(path=str(OUT/'internal-form-mobile.png'),full_page=False)
    form.locator('.cancel').click()
    record('390px mobile layout contains horizontal table scroll without page overflow')
    # One failed transport attempt must retain the same idempotency key.
    page.locator('[data-action="add-extra"]').click();form=page.locator('.modal-form')
    form.locator('[name="description"]').fill('Retry test order')
    form.locator('[name="unitCost"]').fill('30');form.locator('[name="price"]').fill('50')
    page.evaluate('window.__failNextOrder=true')
    form.locator('button[type="submit"]').click()
    expect(page.locator('.modal-backdrop')).to_have_count(1)
    key=page.evaluate("window.__eventCalls.filter(x=>x.name==='eventAddInternalOrderV125').at(-1).args[1].requestKey")
    form.locator('button[type="submit"]').click()
    expect(page.locator('.modal-backdrop')).to_have_count(0)
    assert key==page.evaluate("window.__eventCalls.filter(x=>x.name==='eventAddInternalOrderV125').at(-1).args[1].requestKey")
    record('Retry after a transport error preserves the original idempotency key')
    page.evaluate("window.__simulateMissingMigration=true")
    page.locator('#event-refresh-v034').click()
    expect(page.locator('#root')).to_contain_text('SQL v1.0.25')
    expect(page.locator('.event-finance-kpis-v125')).to_have_count(0)
    record('Missing migration blocks financial display instead of showing zero')
    assert not errors,errors
    browser.close()
result={'tests':len(results),'passed':len(results),'failed':0,'browser':'Chromium local','backend':'mock API, NOT live Supabase','results':results,'pageErrors':errors}
(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
