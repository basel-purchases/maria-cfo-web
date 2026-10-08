import { supabase, configured, configurationMessage } from './supabase.js';
import * as api from './api.js';
import { esc } from './utils.js';
import { toast, friendlyError } from './ui.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderHub } from './pages/hubs.js';
import { renderMaterials } from './pages/materials.js';
import { renderSuppliers } from './pages/suppliers.js';
import { renderPurchases, renderPurchaseDetail } from './pages/purchases.js';
import { renderMenu } from './pages/menu.js';
import {
  renderInventory,
  renderCashboxes,
  renderExpenses,
  renderOrders,
  renderOrderDetail,
} from './pages/daily.js';
import { renderEmployees, renderAttendance, renderPayroll } from './pages/employees.js';
import { renderEvents } from './pages/events.js';
import { renderReports } from './pages/reports.js';
import { renderAssistant } from './pages/assistant.js';
import { renderSettings } from './pages/settings.js';

const app = document.querySelector('#app');
let currentSession = null;

const nav = [
  ['#/dashboard', 'الرئيسية'],
  ['#/basic', 'الإدخالات الأساسية'],
  ['#/daily', 'التشغيل اليومي'],
  ['#/employees', 'الموظفون والرواتب'],
  ['#/events', 'الحفلات'],
  ['#/reports-hub', 'الإحصائيات والتقارير'],
  ['#/assistant', 'المساعد الذكي'],
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
        <div class="sidebar-foot">Web v0.7</div>
      </aside>

      <main class="main">
        <header class="topbar">
          <div class="topbar-leading">
            <button class="icon-btn mobile-menu" type="button" aria-label="فتح القائمة">☰</button>
            <div class="title" id="top-title">Maria CFO</div>
          </div>
          <div class="topbar-actions">
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

  app.querySelector('#back-btn').onclick = () => {
    const path = (location.hash || '#/dashboard').replace(/^#/, '');
    if (path === '/dashboard' || path === 'dashboard') return;
    if (window.history.length > 1) window.history.back();
    else location.hash = '#/dashboard';
  };

  route();
}

function active(hash) {
  const key = hash.split('/').filter(Boolean)[0] || 'dashboard';
  const parent = {
    materials: 'basic', suppliers: 'basic', purchases: 'basic', purchase: 'basic', menu: 'basic',
    inventory: 'daily', cashboxes: 'daily', expenses: 'daily', orders: 'daily', order: 'daily',
    'employees-list': 'employees', attendance: 'employees', payroll: 'employees',
    'events-list': 'events', reports: 'reports-hub',
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
