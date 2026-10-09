import { supabase, configured, configurationMessage } from './supabase.js?v=0.19';
import * as api from './api.js?v=0.19';
import { esc } from './utils.js?v=0.19';
import { toast, friendlyError, modal } from './ui.js?v=0.19';
import { renderDashboard } from './pages/dashboard.js?v=0.19';
import { renderHub } from './pages/hubs.js?v=0.19';
import { renderMaterials } from './pages/materials.js?v=0.19';
import { renderSuppliers } from './pages/suppliers.js?v=0.19';
import { renderPurchases, renderPurchaseDetail } from './pages/purchases.js?v=0.19';
import { renderMenu } from './pages/menu.js?v=0.19';
import {
  renderInventory,
  renderCashboxes,
  renderExpenses,
  renderOrders,
  renderOrderDetail,
} from './pages/daily.js?v=0.19';
import { renderEmployees, renderAttendance, renderPayroll } from './pages/employees.js?v=0.19';
import { renderEvents } from './pages/events.js?v=0.19';
import { renderReports } from './pages/reports.js?v=0.19';
import { renderAssistant } from './pages/assistant.js?v=0.19';
import { renderImages } from './pages/images.js?v=0.19';
import { renderSettings } from './pages/settings.js?v=0.19';

const app = document.querySelector('#app');
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
  ['#/settings', 'الإعدادات'],
];

function login() {
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
          <div class="brand-mark">M</div>
          <h1>Maria CFO</h1>
          <p>المدير المالي الذكي</p>
        </div>
        <nav class="nav" aria-label="التنقل الرئيسي">
          ${nav.map(([href, label]) => `
            <a href="${href}" data-route="${href}">
              <span class="nav-dot"></span>${label}
            </a>`).join('')}
        </nav>
        <div class="sidebar-foot">Web v0.19</div>
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

  app.querySelector('#ai-notify-btn').onclick = openAiJobsPanel;

  app.querySelector('#back-btn').onclick = () => {
    const path = (location.hash || '#/dashboard').replace(/^#/, '');
    if (path === '/dashboard' || path === 'dashboard') return;
    if (window.history.length > 1) window.history.back();
    else location.hash = '#/dashboard';
  };

  startAiJobWatcher();
  route();
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
    materials: 'basic', suppliers: 'basic', purchases: 'basic', purchase: 'basic', menu: 'basic',
    inventory: 'daily', cashboxes: 'daily', expenses: 'daily', orders: 'daily', order: 'daily',
    'employees-list': 'employees', attendance: 'employees', payroll: 'employees',
    'events-list': 'events', reports: 'reports-hub', images: 'images',
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
    daily: 'التشغيل اليومي',
    employees: 'الموظفون والرواتب',
    events: 'الحفلات',
    'reports-hub': 'الإحصائيات والتقارير',
    assistant: 'المساعد الذكي',
    images: 'الصور والمعالجة المحلية',
    settings: 'الإعدادات',
    materials: 'المواد والكميات والأسعار',
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
    'events-list': 'الحفلات والحجوزات',
    reports: 'التقرير المالي',
  };

  app.querySelector('#top-title').textContent = titles[key] || 'Maria CFO';
  const back = app.querySelector('#back-btn');
  if (back) back.hidden = key === 'dashboard';

  try {
    switch (key) {
      case 'dashboard': return renderDashboard(root);
      case 'basic': return renderHub(root, 'basic');
      case 'daily': return renderHub(root, 'daily');
      case 'employees': return renderHub(root, 'employees');
      case 'events': return renderHub(root, 'events');
      case 'reports-hub': return renderHub(root, 'reports');
      case 'materials': return renderMaterials(root);
      case 'suppliers': return renderSuppliers(root);
      case 'purchases': return renderPurchases(root);
      case 'purchase': return renderPurchaseDetail(root, id);
      case 'menu': return renderMenu(root);
      case 'inventory': return renderInventory(root);
      case 'cashboxes': return renderCashboxes(root);
      case 'expenses': return renderExpenses(root);
      case 'orders': return renderOrders(root);
      case 'order': return renderOrderDetail(root, id);
      case 'employees-list': return renderEmployees(root);
      case 'attendance': return renderAttendance(root);
      case 'payroll': return renderPayroll(root);
      case 'events-list': return renderEvents(root);
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
