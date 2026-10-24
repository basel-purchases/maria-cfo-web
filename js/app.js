import { supabase, configured, configurationMessage } from './supabase.js?v=1.0';
import * as api from './api.js?v=1.0.13';
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
} from './pages/daily.js?v=1.0.7';
import { renderEmployees, renderAttendance } from './pages/employees.js?v=1.0';
import {renderBonusesV032} from './pages/bonuses.js?v=1.0';
import {renderEventsV034,renderEventDetailV034} from './pages/events-v034.js?v=1.0.13';
import {renderPayrollV034} from './pages/payroll-v034.js?v=1.0.5';
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
import {parseParallelUsdV114,fetchParallelUsdV114,marketQuoteFreshV114,marketCachedQuoteV114,MARKET_CACHE_MS_V114} from './market-usd-v114.js?v=1.0.14';
import {materialPricingErrorV111} from './pricing-error-v111.js?v=1.0.12';

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
  if(marketStateV114.timer){clearInterval(marketStateV114.timer);marketStateV114.timer=null;}
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
        <div class="sidebar-foot">Web v1.0.14</div>
      </aside>

      <main class="main">
        <header class="topbar">
          <div class="topbar-leading">
            <button class="icon-btn mobile-menu" type="button" aria-label="فتح القائمة">☰</button>
            <div class="title" id="top-title">Maria CFO</div>
          </div>
          <div class="topbar-actions">
            <button class="ai-notify-btn" id="ai-notify-btn" type="button" aria-label="نتائج المعالجة الخلفية" title="نتائج المعالجة الخلفية">
              <span aria-hidden="true">🔔</span><span class="ai-notify-count" id="ai-notify-count" hidden>0</span>
            </button>
            <div class="market-usd-group-v114" aria-label="سعر الدولار بالسوق الموازية">
              <div class="market-usd-chip-v114" id="market-usd-chip" role="status" aria-live="polite" title="سعر الدولار في السوق الموازية من LiraScope، وليس السعر الرسمي">
                <span class="market-usd-caption-v114">دولار السوق · مبيع</span>
                <strong id="market-usd-value">جارٍ التحديث...</strong>
                <small id="market-usd-label">ل.س قديمة</small>
              </div>
              <button class="market-usd-approve-v114" id="market-usd-approve" type="button" aria-label="اعتماد سعر الدولار المعروض" title="اعتماد سعر السوق في الإعدادات" disabled>✓</button>
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
  installMarketUsdV114();

  app.querySelector('#back-btn').onclick = () => {
    const path = (location.hash || '#/dashboard').replace(/^#/, '');
    if (path === '/dashboard' || path === 'dashboard') return;
    if (window.history.length > 1) window.history.back();
    else location.hash = '#/dashboard';
  };

  startAiJobWatcher();
  route();
}


// v1.0.14 — market display is read-only until the owner explicitly approves a fresh quote.
const MARKET_CACHE_KEY_V114='maria_cfo_parallel_usd_v114';
const marketStateV114={quote:null,lastSuccessAt:0,lastAttemptAt:0,inFlight:null,verified:false,error:null,timer:null};
const formatOldSypV114=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
function marketDateV114(value){
  try{return new Intl.DateTimeFormat('ar-SY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Damascus'}).format(new Date(value));}
  catch(_){return String(value||'—');}
}
function marketCacheReadV114(){
  try{return marketCachedQuoteV114(JSON.parse(localStorage.getItem(MARKET_CACHE_KEY_V114)||'null'));}
  catch(_){return null;}
}
function marketCacheSaveV114(quote){
  try{localStorage.setItem(MARKET_CACHE_KEY_V114,JSON.stringify({quote,savedAt:new Date().toISOString()}));}catch(_){}
}
function showMarketUsdV114(){
  const chip=app.querySelector('#market-usd-chip');
  const price=app.querySelector('#market-usd-value');
  const label=app.querySelector('#market-usd-label');
  const approve=app.querySelector('#market-usd-approve');
  if(!chip||!price||!label||!approve)return;
  const q=marketStateV114.quote;
  const usable=marketQuoteFreshV114(q);
  chip.classList.toggle('market-usd-stale-v114',!!q&&!usable);
  chip.classList.toggle('market-usd-offline-v114',!!marketStateV114.error);
  if(q){
    price.textContent=`${formatOldSypV114(q.sellOld)} ل.س`;
    label.textContent=usable?(marketStateV114.error?'آخر قراءة · غير متصل':marketStateV114.verified?'موازية · قديمة':'قراءة محفوظة'):'قراءة قديمة';
    chip.title=`LiraScope — السوق الموازية (سعر المبيع)\nآخر تحديث: ${marketDateV114(q.updatedAt)}\nشراء: ${formatOldSypV114(q.buyOld)} ل.س قديمة\nمبيع: ${formatOldSypV114(q.sellOld)} ل.س قديمة\n${marketStateV114.error?'تعذّر تحديث المصدر؛ لم تُغيَّر الأسعار المعتمدة.':'السعر المعروض لم يُعتمد تلقائيًا.'}`;
  }else{
    price.textContent=marketStateV114.error?'السوق غير متاح':'جارٍ التحديث...';
    label.textContent='سوق موازية · ل.س قديمة';
    chip.title='لم يتوفر سعر سوق موازية موثوق. أسعار المواد المعتمدة لم تتغير.';
  }
  // If cached, the action refreshes the rate online BEFORE opening the approval dialog.
  approve.disabled=!usable||!!marketStateV114.inFlight;
}
async function fetchMarketUsdOnlineV114(){
  try{return await fetchParallelUsdV114();}
  catch(primary){
    // CORS/browser restrictions: optionally proxy through the authenticated Supabase Edge Function.
    // No rate is taken from the CBS, er-api, or other official/reference feeds.
    if(String(primary?.message||'').includes('MARKET_PRICE_INVALID')||
       String(primary?.message||'').includes('MARKET_DENOMINATION_UNEXPECTED')||
       String(primary?.message||'').includes('MARKET_RATE_LIMIT')||
       String(primary?.message||'').includes('MARKET_TIMESTAMP_INVALID'))throw primary;
    if(!supabase)throw primary;
    try{
      const {data,error}=await supabase.functions.invoke('market-usd',{body:{action:'latest'}});
      if(error)throw error;
      return parseParallelUsdV114(data);
    }catch(_){throw primary;}
  }
}
async function refreshMarketUsdV114({force=false}={}){
  if(marketStateV114.inFlight)return marketStateV114.inFlight;
  const now=Date.now();
  if(!force&&marketStateV114.quote&&
     marketQuoteFreshV114(marketStateV114.quote,now)&&
     marketStateV114.lastSuccessAt>0&&now-marketStateV114.lastSuccessAt<MARKET_CACHE_MS_V114)
    return marketStateV114.quote;
  if(!force&&marketStateV114.lastAttemptAt&&now-marketStateV114.lastAttemptAt<30*60*1000)
    return marketStateV114.quote;
  marketStateV114.lastAttemptAt=now;
  marketStateV114.inFlight=fetchMarketUsdOnlineV114();
  showMarketUsdV114();
  try{
    const quote=await marketStateV114.inFlight;
    marketStateV114.quote=quote;
    marketStateV114.lastSuccessAt=Date.now();
    marketStateV114.verified=true;
    marketStateV114.error=null;
    marketCacheSaveV114(quote);
    return quote;
  }catch(error){
    marketStateV114.error=error?.message||'MARKET_UNAVAILABLE';
    marketStateV114.verified=false;
    return null;
  }finally{
    marketStateV114.inFlight=null;
    showMarketUsdV114();
  }
}
async function approveMarketUsdV114(){
  const btn=app.querySelector('#market-usd-approve');
  if(!btn||btn.disabled)return;
  btn.disabled=true;
  // Always fetch anew on user intent: never approve a cached/offline/old quote.
  const q=await refreshMarketUsdV114({force:true});
  if(!marketQuoteFreshV114(q)){
    toast('تعذّر التحقق من سعر السوق الموازية الآن. لم يتغير سعر الصرف أو أي سعر مادة.','error');
    showMarketUsdV114();return;
  }
  let previouslyApproved=null;
  try{
    const rows=await api.list('app_settings',{limit:1});
    previouslyApproved=Number(rows?.[0]?.usd_to_base_rate||0);
  }catch(error){
    toast(friendlyError(error,'تعذر قراءة سعر الصرف الحالي. لم ننفّذ أي تغيير.'),'error');
    showMarketUsdV114();return;
  }
  const rate=q.sellOld;
  let selectedDecision=null;
  let saved=false;
  const m=modal({
    title:'اعتماد سعر الدولار — السوق الموازية',
    subtitle:`LiraScope · سعر المبيع · آخر تحديث ${marketDateV114(q.updatedAt)}`,
    hideActions:true,
    body:`<div class="market-approval-summary-v114">
      <div><small>سعر السوق المقترح (ليرة سورية قديمة)</small><strong>1 USD = ${esc(formatOldSypV114(rate))} ل.س</strong></div>
      <div><small>السعر المعتمد حاليًا</small><strong>${previouslyApproved>0?`${esc(formatOldSypV114(previouslyApproved))} ل.س`:'غير محدد'}</strong></div>
    </div>
    <div class="market-approval-note-v114">السعر المقترح من <b>السوق الموازية</b> وليس المصرف المركزي. تحوّل الخدمة الليرة الجديدة إلى القديمة ×100 قبل الاعتماد. حفظ السعر وحده لا يغيّر أسعار المواد أو المشتريات السابقة.</div>
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
        errorEl.textContent='انتهت صلاحية قراءة السوق. أغلق النافذة وحدّث السعر.';
        errorEl.hidden=false;
        return false;
      }
      const buttons=m.form.querySelectorAll('button');
      buttons.forEach(b=>b.disabled=true);
      try{
        const result=await api.materialPriceApplyExchangeV110(rate,update);
        if(!result||Math.abs(Number(result.rate)-rate)>0.011||Boolean(result.applied)!==update)
          throw new Error('PRICING_RESULT_NOT_CONFIRMED');
        saved=true;
        toast(update?`تم اعتماد سعر السوق وتحديث ${result.updated_materials??0} سعر مادة مرجعي.`:'تم اعتماد سعر السوق دون تعديل أسعار المواد.','success');
        return true;
      }catch(error){
        errorEl.textContent=materialPricingErrorV111(error);
        errorEl.hidden=false;
        return false;
      }finally{
        buttons.forEach(b=>b.disabled=false);
      }
    },
    onClose:async()=>{
      if(saved&&(location.hash||'').startsWith('#/settings'))await route();
    },
  });
  const decide=update=>{selectedDecision=update;m.form.requestSubmit();};
  m.form.querySelector('[data-market-fx-update]').onclick=()=>decide(true);
  m.form.querySelector('[data-market-fx-only]').onclick=()=>decide(false);
  m.form.querySelector('[data-market-fx-cancel]').onclick=()=>m.close();
  showMarketUsdV114();
}
function installMarketUsdV114(){
  if(marketStateV114.timer)clearInterval(marketStateV114.timer);
  marketStateV114.quote=null;
  marketStateV114.error=null;
  marketStateV114.verified=false;
  marketStateV114.lastSuccessAt=0;
  const cached=marketCacheReadV114();
  if(cached){marketStateV114.quote=cached.quote;marketStateV114.lastSuccessAt=cached.savedAt;}
  showMarketUsdV114();
  const approve=app.querySelector('#market-usd-approve');
  if(approve)approve.onclick=approveMarketUsdV114;
  void refreshMarketUsdV114();
  marketStateV114.timer=setInterval(()=>{
    if(document.visibilityState==='visible')void refreshMarketUsdV114();
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
