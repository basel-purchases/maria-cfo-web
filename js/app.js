import { supabase, configured, configurationMessage } from './supabase.js?v=1.0';
import * as api from './api.js?v=1.0.17';
import { esc } from './utils.js?v=1.0';
import { toast, friendlyError, modal } from './ui.js?v=1.0';
import { renderDashboard } from './pages/dashboard.js?v=1.0';
import { renderHub } from './pages/hubs.js?v=1.0';
import { renderMaterials } from './pages/materials.js?v=1.0.13';
import { renderSuppliersWithAmeen as renderSuppliers } from './pages/suppliers.js?v=1.0';
import { renderPurchases, renderPurchaseDetail } from './pages/purchases.js?v=1.0.8';
import { renderMenu } from './pages/menu.js?v=1.0.7';
import {
  renderInventory,
  renderCashboxes,
  renderExpenses,
  renderOrders,
  renderOrderDetail,
} from './pages/daily.js?v=1.0.16';
import { renderEmployees, renderAttendance } from './pages/employees.js?v=1.0';
import {renderBonusesV032} from './pages/bonuses.js?v=1.0';
import {renderEventsV034,renderEventDetailV034} from './pages/events-v034.js?v=1.0.13';
import {renderPayrollV034} from './pages/payroll-v034.js?v=1.0.18';
import { renderReports } from './pages/reports.js?v=1.0';
import { renderAssistant } from './pages/assistant.js?v=1.0';
import { renderImages } from './pages/images.js?v=1.0.13';
import { renderSettings } from './pages/settings.js?v=1.0.13';
import { renderAssets } from './pages/assets.js?v=1.0';
import { renderAdvances } from './pages/advances.js?v=1.0';
import {renderQuickImportsV030} from './quick-imports-v030.js?v=1.0.2';
import {renderAmeenDailyV041} from './pages/ameen-daily-v041.js?v=1.0.5';
import {installTableExportV027} from './table-export-v027.js?v=1.0';
import {installSearchableSelectsV033} from './searchable-select-v033.js?v=1.0.8';
import {marketQuoteFreshV114,marketCachedQuoteV114,MARKET_CACHE_MS_V114} from './market-usd-v114.js?v=1.0.14';
import {fetchParallelUsdViaSupabaseV115,marketValueV115,marketProxyErrorTextV115,readMarketDisplayUnitV115,readMarketSideV115,setMarketSideV115} from './market-usd-v115.js?v=1.0.15';
import {materialPricingErrorV111} from './pricing-error-v111.js?v=1.0.12';
import {cashboxQuickEntriesV116,cashboxNumberV116} from './cashbox-summary-v116.js?v=1.0.16';

const app = document.querySelector('#app');
installSearchableSelectsV033();
let currentSession = null;
let aiJobTimer = null;
let aiJobsInitialized = false;
const aiJobState = new Map();

const nav = [
  ['#/dashboard', 'الرئيسية'],
  ['#/basic', 'الإدخالات الأساسية'],
  ['#/daily', 'التشغيل اليومي'],
  ['#/employees', 'الموظفون والرواتب'],
  ['#/events', 'الحفلات'],
  ['#/reports-hub', 'الإحصائيات والتقارير'],
  ['#/assistant', 'المساعد الذكي'],
  ['#/images', 'الصور'],
  ['#/quick-imports', 'الإدخالات السريعة'],
  ['#/daily-orders', 'الأوردرات'],
  ['#/settings', 'الإعدادات'],
];

function login() {
  if(marketStateV115.timer){clearInterval(marketStateV115.timer);marketStateV115.timer=null;}
  if(cashboxQuickStateV116.timer){clearInterval(cashboxQuickStateV116.timer);cashboxQuickStateV116.timer=null;}
  cashboxQuickStateV116.entries=[];cashboxQuickStateV116.lastSuccessAt=0;
  app.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-identity">
          <div class="login-logo" aria-hidden="true">M</div>
          <h1>Maria CFO</h1>
          <p>المدير المالي الذكي. ابدأ من الأقسام العامة ثم انتقل إلى التفاصيل عند الحاجة.</p>
        </div>
        ${!configured ? `<div class="notice">${esc(configurationMessage())}</div>` : ''}
        <form id="login-form" autocomplete="off">
          <div class="field">
            <label>البريد الإلكتروني</label>
            <input name="email" type="email" required ${!configured ? 'disabled' : ''}>
          </div>
          <div class="field">
            <label>كلمة المرور</label>
            <input name="password" type="password" required ${!configured ? 'disabled' : ''}>
          </div>
          <button class="btn" style="width:100%;margin-top:8px" ${!configured ? 'disabled' : ''}>تسجيل الدخول</button>
        </form>
      </div>
    </div>`;

  app.querySelector('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api.signIn(fd.get('email'), fd.get('password'));
      const owner = await api.isOwner();
      if (!owner) {
        await api.signOut();
        throw new Error('Access denied');
      }
      currentSession = await api.session();
      shell();
    } catch (err) {
      toast(friendlyError(err, 'تعذر تسجيل الدخول. تحقق من البيانات.'), 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function shell() {
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-actions"><div class="brand-mark">M</div></div>
          <h1>Maria CFO</h1>
          <p>المدير المالي الذكي</p>
        </div>
        <nav class="nav" aria-label="التنقل الرئيسي">
          ${nav.map(([href, label]) => `
            <a href="${href}" data-route="${href}">
              <span class="nav-dot"></span>${label}
            </a>`).join('')}
        </nav>
        <div class="sidebar-foot">Web v1.0.18</div>
      </aside>

      <main class="main">
        <header class="topbar">
          <div class="topbar-leading">
            <button class="icon-btn mobile-menu" type="button" aria-label="فتح القائمة">☰</button>
            <div class="title" id="top-title">Maria CFO</div>
          </div>
          <nav class="cashbox-strip-v116" id="topbar-cashboxes" aria-label="\u0623\u0631\u0635\u062f\u0629 \u0627\u0644\u0635\u0646\u0627\u062f\u064a\u0642">
            ${['\u0635\u0646\u062f\u0648\u0642 1','\u0635\u0646\u062f\u0648\u0642 2','\u0627\u0644\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u0639\u0627\u0645'].map((name,i)=>`
              <a class="cashbox-quick-v116" href="#/cashboxes" data-cashbox-slot="${i}" title="\u0641\u062a\u062d \u0627\u0644\u0635\u0646\u0627\u062f\u064a\u0642">
                <span class="cashbox-quick-name-v116">${name}</span>
                <strong class="cashbox-quick-balance-v116" dir="ltr">\u2014</strong>
              </a>`).join('')}
          </nav>
          <div class="topbar-actions">
            <button class="ai-notify-btn" id="ai-notify-btn" type="button" aria-label="نتائج المعالجة الخلفية" title="نتائج المعالجة الخلفية">
              <span aria-hidden="true">🔔</span><span class="ai-notify-count" id="ai-notify-count" hidden>0</span>
            </button>
            <div class="market-usd-group-v115" aria-label="سعر الدولار في السوق الموازية">
              <div class="market-usd-chip-v115" id="market-usd-chip" role="group" title="سعر الدولار اليوم">
                <strong id="market-usd-value" role="status" aria-live="polite">—</strong>
                <button class="market-usd-side-v115" id="market-usd-side" type="button" aria-label="التبديل بين سعر الشراء والمبيع" title="التبديل بين شراء ومبيع">⇄</button>
              </div>
              <button class="market-usd-approve-v115" id="market-usd-approve" type="button" aria-label="اعتماد سعر الدولار المعروض" title="اعتماد سعر الدولار" disabled>✓</button>
            </div>
            <button class="back-btn" id="back-btn" type="button" aria-label="رجوع">
              <span aria-hidden="true">←</span>
              <span>رجوع</span>
            </button>
          </div>
        </header>
        <section class="content" id="page"></section>
      </main>
    </div>`;

  app.querySelector('.mobile-menu').onclick = () => {
    app.querySelector('.sidebar').classList.toggle('open');
  };

  installTableExportV027();
  app.querySelector('#ai-notify-btn').onclick = openAiJobsPanel;
  installMarketUsdV115();
  installCashboxQuickV116();

  app.querySelector('#back-btn').onclick = () => {
    const path = (location.hash || '#/dashboard').replace(/^#/, '');
    if (path === '/dashboard' || path === 'dashboard') return;
    if (window.history.length > 1) window.history.back();
    else location.hash = '#/dashboard';
  };

  startAiJobWatcher();
  route();
}


// v1.0.16: persistent quick balances, sourced from the same overview as the cashboxes page.
const CASHBOX_REFRESH_MS_V116=60000;
const cashboxQuickStateV116={entries:[],lastSuccessAt:0,error:null,inFlight:null,timer:null,version:0};
let cashboxQuickListenersV116=false;
function drawCashboxQuickV116(){
  const host=app.querySelector('#topbar-cashboxes');
  if(!host)return;
  const state=cashboxQuickStateV116;
  const defaults=['\u0635\u0646\u062f\u0648\u0642 1','\u0635\u0646\u062f\u0648\u0642 2','\u0627\u0644\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u0639\u0627\u0645'];
  host.querySelectorAll('[data-cashbox-slot]').forEach((link,index)=>{
    const entry=state.entries[index];
    const name=entry?.name||defaults[index];
    const amount=cashboxNumberV116(entry?.balance);
    link.querySelector('.cashbox-quick-name-v116').textContent=name;
    link.querySelector('.cashbox-quick-balance-v116').textContent=amount;
    const status=state.error?'\u062a\u0639\u0630\u0631 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0631\u0635\u064a\u062f\u061b \u0622\u062e\u0631 \u0642\u0631\u0627\u0621\u0629 \u0645\u062a\u0627\u062d\u0629':
      state.lastSuccessAt?'\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0645\u062a\u0648\u0642\u0639 \u0627\u0644\u0622\u0646':'\u062c\u0627\u0631\u064d \u062c\u0644\u0628 \u0627\u0644\u0631\u0635\u064a\u062f';
    const updated=state.lastSuccessAt?` - \u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b ${new Date(state.lastSuccessAt).toLocaleTimeString('ar-SY',{hour:'2-digit',minute:'2-digit'})}`:'';
    link.title=`${name}: ${status}${updated} - ${amount} \u0644.\u0633 - \u0627\u0636\u063a\u0637 \u0644\u0641\u062a\u062d \u0627\u0644\u0635\u0646\u0627\u062f\u064a\u0642`;
    link.setAttribute('aria-label',link.title);
    link.classList.toggle('cashbox-quick-stale-v116',Boolean(state.error));
  });
}
async function refreshCashboxQuickV116({force=false}={}){
  const state=cashboxQuickStateV116;
  if(!currentSession||!app.querySelector('#topbar-cashboxes'))return;
  if(state.inFlight)return state.inFlight;
  if(!force&&state.lastSuccessAt&&Date.now()-state.lastSuccessAt<15000)return;
  const startedVersion=state.version;
  state.inFlight=(async()=>{
    try{
      const overview=await api.cashboxOverview();
      if(state.version!==startedVersion||!currentSession)return;
      if(!Array.isArray(overview)||!overview.some(entry=>entry?.cashbox?.id))throw new Error('CASHBOX_OVERVIEW_EMPTY');
      state.entries=cashboxQuickEntriesV116(overview);
      state.lastSuccessAt=Date.now();
      state.error=null;
    }catch(error){
      if(state.version!==startedVersion||!currentSession)return;
      state.error=error;
      console.warn('Cashbox header refresh failed',error);
    }finally{drawCashboxQuickV116();}
  })();
  try{await state.inFlight;}finally{state.inFlight=null;}
}
function installCashboxQuickV116(){
  const state=cashboxQuickStateV116;
  if(state.timer)clearInterval(state.timer);
  drawCashboxQuickV116();
  if(!cashboxQuickListenersV116){
    // The cashboxes page supplies its already-fetched overview after every balance change.
    document.addEventListener('maria:cashboxes-updated',event=>{
      if(!currentSession||!Array.isArray(event.detail))return;
      state.version++;
      state.entries=cashboxQuickEntriesV116(event.detail);
      state.lastSuccessAt=Date.now();
      state.error=null;
      drawCashboxQuickV116();
    });
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible')void refreshCashboxQuickV116();
    });
    window.addEventListener('focus',()=>void refreshCashboxQuickV116());
    window.addEventListener('hashchange',()=>void refreshCashboxQuickV116());
    cashboxQuickListenersV116=true;
  }
  void refreshCashboxQuickV116({force:true});
  state.timer=setInterval(()=>{
    if(document.visibilityState==='visible')void refreshCashboxQuickV116({force:true});
  },CASHBOX_REFRESH_MS_V116);
}

// v1.0.15: one quiet number, two rate sides, and a server-side quote bridge.
const MARKET_CACHE_KEY_V115='maria_cfo_parallel_usd_v114'; // compatible with saved v1.0.14 quotes
const marketStateV115={quote:null,lastSuccessAt:0,lastAttemptAt:0,inFlight:null,verified:false,error:null,timer:null,
  side:readMarketSideV115(),unit:readMarketDisplayUnitV115()};
function marketDateV115(value){
  try{return new Intl.DateTimeFormat('ar-SY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Damascus'}).format(new Date(value));}
  catch(_){return String(value||'—');}
}
function marketCacheReadV115(){
  try{return marketCachedQuoteV114(JSON.parse(localStorage.getItem(MARKET_CACHE_KEY_V115)||'null'));}
  catch(_){return null;}
}
function marketCacheSaveV115(quote){
  try{localStorage.setItem(MARKET_CACHE_KEY_V115,JSON.stringify({quote,savedAt:new Date().toISOString()}));}catch(_){}
}
function showMarketUsdV115(){
  const chip=app.querySelector('#market-usd-chip');
  const price=app.querySelector('#market-usd-value');
  const approve=app.querySelector('#market-usd-approve');
  const toggle=app.querySelector('#market-usd-side');
  if(!chip||!price||!approve||!toggle)return;
  const state=marketStateV115;
  const q=state.quote,side=state.side,unit=state.unit;
  const usable=marketQuoteFreshV114(q);
  const label=side==='buy'?'شراء':'مبيع';
  const number=marketValueV115(q,side,unit);
  price.textContent=number;
  const isStale=!!q&&(!usable||!!state.error);
  chip.classList.toggle('market-usd-stale-v115',isStale);
  chip.classList.toggle('market-usd-loading-v115',!!state.inFlight);
  const unitText=unit==='old'?'ليرة قديمة':'ليرة جديدة';
  const status=state.error?marketProxyErrorTextV115(state.error):
      !q?'جارٍ جلب سعر السوق...':!usable?'هذه قراءة قديمة، وليست السعر الحالي.':
      !state.verified?'هذه قراءة محفوظة حتى يتم تحديث الاتصال.':'سعر السوق لم يُعتمد تلقائيًا.';
  const tip=q?`سعر الدولار اليوم — السوق الموازية (${label})\n${number} ${unitText}\nشراء: ${marketValueV115(q,'buy',unit)} · مبيع: ${marketValueV115(q,'sell',unit)}\nآخر تحديث: ${marketDateV115(q.updatedAt)}\n${status}`:
      `سعر الدولار اليوم — السوق الموازية\n${status}`;
  chip.title=tip;
  price.setAttribute('aria-label',`سعر الدولار ${label}: ${number} ${unitText}`);
  toggle.title=`عرض سعر ${side==='sell'?'الشراء':'المبيع'}`;
  toggle.setAttribute('aria-label',toggle.title);
  approve.disabled=!usable||!!state.inFlight;
  approve.title=`اعتماد سعر ${label} الظاهر`;
}
async function fetchMarketUsdOnlineV115(){
  // No direct browser request to LiraScope: its response can be HTTP 200 but blocked by CORS.
  // Deploy the included Supabase Edge Function "market-usd" before using live quotes.
  return fetchParallelUsdViaSupabaseV115(supabase);
}
async function refreshMarketUsdV115({force=false}={}){
  if(marketStateV115.inFlight)return marketStateV115.inFlight;
  const now=Date.now();
  if(!force&&marketStateV115.verified&&marketStateV115.quote&&marketQuoteFreshV114(marketStateV115.quote,now)&&
     marketStateV115.lastSuccessAt>0&&now-marketStateV115.lastSuccessAt<MARKET_CACHE_MS_V114)
    return marketStateV115.quote;
  if(!force&&marketStateV115.lastAttemptAt&&now-marketStateV115.lastAttemptAt<5*60*1000)
    return marketStateV115.quote;
  marketStateV115.lastAttemptAt=now;
  marketStateV115.inFlight=fetchMarketUsdOnlineV115();
  showMarketUsdV115();
  try{
    const quote=await marketStateV115.inFlight;
    marketStateV115.quote=quote;
    marketStateV115.lastSuccessAt=Date.now();
    marketStateV115.verified=true;
    marketStateV115.error=null;
    marketCacheSaveV115(quote);
    return quote;
  }catch(error){
    marketStateV115.error=error?.message||'MARKET_PROXY_UNAVAILABLE';
    marketStateV115.verified=false;
    return null;
  }finally{
    marketStateV115.inFlight=null;
    showMarketUsdV115();
  }
}
async function approveMarketUsdV115(){
  const btn=app.querySelector('#market-usd-approve');
  if(!btn||btn.disabled)return;
  btn.disabled=true;
  const q=await refreshMarketUsdV115({force:true});
  if(!marketQuoteFreshV114(q)||marketStateV115.error){
    toast(marketStateV115.error?marketProxyErrorTextV115(marketStateV115.error):
      'لا توجد قراءة حديثة معتمدة من المصدر. لم تتغير الأسعار.','error');
    showMarketUsdV115();return;
  }
  const side=marketStateV115.side;
  const rate=side==='buy'?q.buyOld:q.sellOld;
  let previous=null;
  try{
    const rows=await api.list('app_settings',{limit:1});
    previous=Number(rows?.[0]?.usd_to_base_rate||0);
  }catch(error){
    toast(friendlyError(error,'تعذر قراءة سعر الصرف الحالي؛ لم تتغير الأسعار.'),'error');
    showMarketUsdV115();return;
  }
  let selectedDecision=null,saved=false;
  const m=modal({
    title:'اعتماد سعر الدولار',
    subtitle:`سوق موازية · ${side==='buy'?'شراء':'مبيع'} · ${marketDateV115(q.updatedAt)}`,
    hideActions:true,
    body:`<div class="market-approval-summary-v114">
      <div><small>السعر المقترح (ليرة قديمة)</small><strong>${esc(marketValueV115(q,side,'old'))}</strong></div>
      <div><small>السعر المعتمد حاليًا</small><strong>${previous>0?esc(previous.toLocaleString('en-US')):'—'}</strong></div>
    </div>
    <p class="market-approval-error-v114" data-market-approval-error hidden role="alert"></p>
    <div class="modal-actions market-approval-actions-v114">
      <button type="button" class="btn" data-market-fx-update>حفظ وتحديث أسعار المواد</button>
      <button type="button" class="btn secondary" data-market-fx-only>حفظ السعر فقط</button>
      <button type="button" class="btn secondary" data-market-fx-cancel>إلغاء</button>
    </div>`,
    onSubmit:async()=>{
      if(selectedDecision===null)return false;
      const update=selectedDecision;
      const errorEl=m.form.querySelector('[data-market-approval-error]');
      errorEl.hidden=true;
      if(!marketQuoteFreshV114(q)){
        errorEl.textContent='انتهت صلاحية القراءة. حدّث السعر.';
        errorEl.hidden=false;return false;
      }
      const buttons=m.form.querySelectorAll('button');
      buttons.forEach(b=>b.disabled=true);
      try{
        const result=await api.materialPriceApplyExchangeV110(rate,update);
        if(!result||Math.abs(Number(result.rate)-rate)>0.011||Boolean(result.applied)!==update)
          throw new Error('PRICING_RESULT_NOT_CONFIRMED');
        saved=true;
        toast(update?`تم حفظ السعر وتحديث ${result.updated_materials??0} سعر مادة مرجعي.`:'تم حفظ السعر دون تغيير المواد.','success');
        return true;
      }catch(error){
        errorEl.textContent=materialPricingErrorV111(error);
        errorEl.hidden=false;return false;
      }finally{buttons.forEach(b=>b.disabled=false);}
    },
    onClose:async()=>{
      if(saved&&(location.hash||'').startsWith('#/settings'))await route();
    },
  });
  const decide=update=>{selectedDecision=update;m.form.requestSubmit();};
  m.form.querySelector('[data-market-fx-update]').onclick=()=>decide(true);
  m.form.querySelector('[data-market-fx-only]').onclick=()=>decide(false);
  m.form.querySelector('[data-market-fx-cancel]').onclick=()=>m.close();
  showMarketUsdV115();
}
window.addEventListener('maria-market-display-unit-v115',event=>{
  marketStateV115.unit=event.detail?.unit==='new'?'new':'old';
  showMarketUsdV115();
});
function installMarketUsdV115(){
  if(marketStateV115.timer)clearInterval(marketStateV115.timer);
  marketStateV115.quote=null;
  marketStateV115.error=null;
  marketStateV115.verified=false;
  marketStateV115.lastSuccessAt=0;
  marketStateV115.lastAttemptAt=0;
  marketStateV115.side=readMarketSideV115();
  marketStateV115.unit=readMarketDisplayUnitV115();
  const cached=marketCacheReadV115();
  if(cached){marketStateV115.quote=cached.quote;marketStateV115.lastSuccessAt=cached.savedAt;}
  showMarketUsdV115();
  const approve=app.querySelector('#market-usd-approve');
  if(approve)approve.onclick=approveMarketUsdV115;
  const toggle=app.querySelector('#market-usd-side');
  if(toggle)toggle.onclick=()=>{
    marketStateV115.side=setMarketSideV115(marketStateV115.side==='sell'?'buy':'sell');
    showMarketUsdV115();
  };
  void refreshMarketUsdV115();
  marketStateV115.timer=setInterval(()=>{
    if(document.visibilityState==='visible')void refreshMarketUsdV115();
  },15*60*1000);
}

function aiJobStatusText(job){
  if(job.status==='queued') return 'بانتظار المعالجة';
  if(job.status==='processing') return 'جاري التحليل';
  if(job.status==='completed') return 'جاهز';
  if(job.status==='needs_review') return 'يحتاج مراجعة';
  if(job.status==='failed') return 'تعذر';
  return job.status||'—';
}

function aiJobKindText(job){
  if(job.job_type==='purchase_ocr') return 'فاتورة شراء';
  if(job.job_type==='order_ocr') return 'أوردر';
  return 'مهمة';
}

function aiJobOpenLabel(job){
  if(job.job_type==='purchase_ocr') return 'فتح الفاتورة';
  if(job.job_type==='order_ocr' && job.related_entity_id) return 'فتح الأوردر';
  if(job.job_type==='order_ocr') return 'مراجعة النتيجة';
  return 'فتح';
}

async function openAiJob(job){
  if(!job) return;
  try{
    if(job.job_type==='purchase_ocr' && job.related_entity_id){
      sessionStorage.setItem('maria_ai_job_to_open',String(job.id));
      location.hash='#/purchase/'+job.related_entity_id;
      return;
    }
    if(job.job_type==='order_ocr' && job.related_entity_id){
      await api.markAiJobSeen(job.id).catch(()=>{});
      location.hash='#/order/'+job.related_entity_id;
      return;
    }
    if(job.job_type==='order_ocr'){
      sessionStorage.setItem('maria_ai_job_to_open',String(job.id));
      location.hash='#/orders';
      return;
    }
    await api.markAiJobSeen(job.id).catch(()=>{});
  }catch(e){toast(friendlyError(e),'error');}
}

async function openAiJobsPanel(){
  let jobs=[];
  try{jobs=await api.aiJobs({limit:60});}catch(e){toast(friendlyError(e),'error');return;}
  const m=modal({
    title:'المعالجة الخلفية',
    subtitle:'يمكنك متابعة العمل بينما يحلل Maria CFO الصور. النتائج تبقى محفوظة حتى تعود إليها.',
    wide:true,
    hideActions:true,
    body:jobs.length?`<div class="ai-jobs-list">${jobs.map(job=>`
      <div class="ai-job-row ${job.seen_at?'is-seen':''}">
        <div class="ai-job-main">
          <strong>${esc(job.title||aiJobKindText(job))}</strong>
          <span>${esc(job.public_message||aiJobStatusText(job))}</span>
        </div>
        <div class="ai-job-meta">
          <span class="ai-job-status status-${esc(job.status||'queued')}">${esc(aiJobStatusText(job))}</span>
          ${job.status==='failed'
            ? `<button type="button" class="mini-action" data-dismiss-job="${esc(job.id)}">تم</button>`
            : (job.job_type==='purchase_ocr'&&job.seen_at)
              ? `<button type="button" class="mini-action" disabled>تمت المراجعة</button>`
              : `<button type="button" class="mini-action ai-open-job" data-job="${esc(job.id)}">${esc(aiJobOpenLabel(job))}</button>`}
        </div>
      </div>`).join('')}</div>`:'<div class="empty"><strong>لا توجد مهام معالجة بعد.</strong></div>',
  });
  m.element.querySelectorAll('[data-job]').forEach(btn=>btn.onclick=async()=>{
    const job=jobs.find(x=>String(x.id)===String(btn.dataset.job));
    await m.close();
    await openAiJob(job);
  });
  m.element.querySelectorAll('[data-dismiss-job]').forEach(btn=>btn.onclick=async()=>{
    await api.markAiJobSeen(btn.dataset.dismissJob).catch(()=>{});
    await m.close();
    await refreshAiJobs();
  });
}

async function refreshAiJobs(){
  let jobs=[];
  try{jobs=await api.aiJobs({limit:80});}catch(_){return;}
  const unread=jobs.filter(j=>!j.seen_at && ['completed','needs_review','failed'].includes(j.status));
  const badge=app.querySelector('#ai-notify-count');
  if(badge){
    badge.textContent=String(unread.length);
    badge.hidden=unread.length===0;
  }

  if(!aiJobsInitialized){
    jobs.forEach(j=>aiJobState.set(String(j.id),j.status));
    aiJobsInitialized=true;
    return;
  }

  for(const job of jobs){
    const id=String(job.id);
    const old=aiJobState.get(id);
    aiJobState.set(id,job.status);
    if(old && old!==job.status && ['completed','needs_review','failed'].includes(job.status)){
      if(job.status==='failed') toast(job.public_message||'تعذرت إحدى مهام المعالجة.','error');
      else toast(job.public_message||'اكتملت إحدى مهام المعالجة.','success');

      const path=(location.hash||'').replace(/^#/,'');
      const isPurchase=job.job_type==='purchase_ocr' && job.related_entity_id && path===`/purchase/${job.related_entity_id}`;
      const isOrders=job.job_type==='order_ocr' && (path==='/orders' || path.startsWith('/order/'));
      if(isPurchase || isOrders) route();
    }
  }
}

function startAiJobWatcher(){
  if(aiJobTimer) clearInterval(aiJobTimer);
  refreshAiJobs();
  aiJobTimer=setInterval(()=>{
    if(document.visibilityState==='visible') refreshAiJobs();
  },4000);
}

function active(hash) {
  const key = hash.split('/').filter(Boolean)[0] || 'dashboard';
  const parent = {
    'quick-imports':'quick-imports', 'recipes-import':'quick-imports', assets:'basic', materials: 'basic', suppliers: 'basic', purchases: 'basic', purchase: 'basic', menu: 'basic',
    inventory: 'daily', cashboxes: 'daily', expenses: 'daily', orders: 'daily', order: 'daily',
    'employees-list': 'employees', attendance: 'employees', payroll: 'employees', advances: 'employees', bonuses: 'employees',
    'events-list': 'events', 'event-reservations': 'events', 'event-bookings': 'events', reports: 'reports-hub', images: 'images',
  }[key] || key;
  app.querySelectorAll('.nav a').forEach((a) => {
    const routeKey = a.dataset.route.replace('#/', '');
    a.classList.toggle('active', routeKey === parent);
  });
}

async function route() {
  if (!currentSession) return;
  const raw = location.hash || '#/dashboard';
  const path = raw.replace(/^#/, '');
  active(path);

  const root = app.querySelector('#page');
  app.querySelector('.sidebar')?.classList.remove('open');

  const parts = path.split('/').filter(Boolean);
  const key = parts[0] || 'dashboard';
  const id = parts[1];

  const titles = {
    dashboard: 'الرئيسية',
    basic: 'الإدخالات الأساسية',
    'quick-imports': 'الإدخالات السريعة',
    'ameen-daily': 'الأوردرات',
    'daily-orders': 'الأوردرات',
    daily: 'التشغيل اليومي',
    employees: 'الموظفون والرواتب',
    events: 'الحفلات',
    'reports-hub': 'الإحصائيات والتقارير',
    assistant: 'المساعد الذكي',
    images: 'الصور - إدخال سريع',
    settings: 'الإعدادات',
    materials: 'المواد والكميات والأسعار',
    assets: '\u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0627\u062a',
    advances: '\u0633\u0644\u0641 \u0627\u0644\u0645\u0648\u0638\u0641\u064a\u0646',
    bonuses: 'مكافآت الموظفين',
    suppliers: 'الموردون',
    purchases: 'فواتير الشراء',
    purchase: 'تفاصيل الفاتورة',
    menu: 'الوجبات والوصفات',
    inventory: 'المخزون والجرد',
    cashboxes: 'الصناديق',
    expenses: 'المصروفات',
    orders: 'الأوردرات والمبيعات',
    order: 'تفاصيل الأوردر',
    'employees-list': 'الموظفون',
    attendance: 'الدوام',
    payroll: 'الرواتب',
    'events-list': 'بناء الحفلة وتجهيزها',
    'event-reservations': 'حجوزات الحفلات',
    'event-bookings': 'حجوزات الحفلة',
    event: 'تخطيط وتكاليف الحفلة',
    reports: 'التقرير المالي',
  };

  app.querySelector('#top-title').textContent = titles[key] || 'Maria CFO';
  const back = app.querySelector('#back-btn');
  if (back) back.hidden = key === 'dashboard';

  try {
    switch (key) {
      case 'dashboard': return renderDashboard(root);
      case 'basic': return renderHub(root, 'basic');
      case 'quick-imports': return renderQuickImportsV030(root);
      case 'ameen-daily':
      case 'daily-orders': return renderAmeenDailyV041(root);
      case 'recipes-import': location.hash='#/quick-imports'; return;
      case 'daily': return renderHub(root, 'daily');
      case 'employees': return renderHub(root, 'employees');
      case 'events': return renderHub(root, 'events');
      case 'reports-hub': return renderHub(root, 'reports');
      case 'materials': return renderMaterials(root);
      case 'assets': return renderAssets(root);
      case 'advances': return renderAdvances(root);
      case 'bonuses': return renderBonusesV032(root);
      case 'suppliers': return renderSuppliers(root);
      case 'purchases': return renderPurchases(root);
      case 'purchase': return renderPurchaseDetail(root, id);
      case 'menu': return renderMenu(root,{missingOnly:id==='unpriced'});
      case 'inventory': return renderInventory(root);
      case 'cashboxes': return renderCashboxes(root);
      case 'expenses': return renderExpenses(root);
      case 'orders': return renderOrders(root);
      case 'order': return renderOrderDetail(root, id);
      case 'employees-list': return renderEmployees(root);
      case 'attendance': return renderAttendance(root);
      case 'payroll': return renderPayrollV034(root);
      case 'events-list': return renderEventsV034(root);
      case 'event-reservations': return renderEventsV034(root,'booking');
      case 'event-bookings': return renderEventDetailV034(root,id,'booking');
      case 'event': return renderEventDetailV034(root,id);
      case 'reports': return renderReports(root);
      case 'assistant': return renderAssistant(root);
      case 'images': return renderImages(root);
      case 'settings': return renderSettings(root);
      default:
        location.hash = '#/dashboard';
    }
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="notice">${friendlyError(e)}</div>`;
  }
}

window.addEventListener('hashchange', route);

async function boot() {
  if (!configured) {
    login();
    return;
  }
  try {
    currentSession = await api.session();
    if (currentSession) {
      const owner = await api.isOwner().catch(() => false);
      if (!owner) {
        await api.signOut();
        currentSession = null;
      }
    }
    currentSession ? shell() : login();
  } catch (e) {
    console.error(e);
    login();
  }
}

boot();
