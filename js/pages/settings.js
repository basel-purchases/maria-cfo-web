import * as api from '../api.js';
import { toast, loader, friendlyError } from '../ui.js';
import { esc } from '../utils.js';

export async function renderSettings(root) {
  root.innerHTML = loader();
  try {
    const rows = await api.list('app_settings', { limit: 1 });
    const s = rows[0] || {};
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>الإعدادات</h2>
          <p>القيم العامة التي لا تحتاج تغييرًا يوميًا. Food Cost العام يبقى إعدادًا هنا وليس مؤشرًا في الرئيسية.</p>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <h3>إعدادات حالية</h3>
          <div class="kv">
            <div class="k">العملة الأساسية</div><div>${esc(s.base_currency_code || s.base_currency || 'SYP')}</div>
            <div class="k">العملة الثانوية</div><div>${esc(s.secondary_currency_code || s.secondary_currency || 'USD')}</div>
            <div class="k">Food Cost الافتراضي</div><div>${esc(s.default_food_cost_percent ?? '30')}%</div>
            <div class="k">المنطقة الزمنية</div><div>${esc(s.timezone || '—')}</div>
          </div>
        </div>
        <div class="card">
          <h3>سعر الصرف</h3>
          <p>تغيير السعر اليوم لا يعيد كتابة العمليات التاريخية.</p>
          <div class="form-grid" style="margin-top:12px">
            <div class="field"><label>العملة</label><select id="fx-cur"><option>USD</option></select></div>
            <div class="field"><label>1 USD = كم SYP</label><input id="fx-rate" type="number" step="any"></div>
          </div>
          <div class="quick-actions"><button class="btn" id="fx-save">حفظ السعر</button></div>
        </div>
        <div class="card soft">
          <h3>جلسة الدخول</h3>
          <p>لن يظهر البريد الإلكتروني أو زر الخروج في الصفحات اليومية. إذا احتجت للخروج من الحساب ستجده هنا فقط.</p>
          <div class="quick-actions"><button class="btn secondary" id="settings-logout">تسجيل الخروج</button></div>
        </div>
      </div>`;

    root.querySelector('#fx-save').onclick = async () => {
      try {
        const rate = Number(root.querySelector('#fx-rate').value);
        if (!(rate > 0)) {
          toast('أدخل سعر صرف صحيح.', 'error');
          return;
        }
        try {
          await api.rpc('set_exchange_rate', {
            p_currency_code: 'USD',
            p_rate_to_base: rate,
            p_effective_at: new Date().toISOString(),
          });
        } catch (_) {
          await api.rpc('set_exchange_rate', { p_currency_code: 'USD', p_rate: rate });
        }
        toast('تم حفظ سعر الصرف', 'success');
      } catch (e) {
        toast(friendlyError(e), 'error');
      }
    };

    root.querySelector('#settings-logout').onclick = async () => {
      await api.signOut();
      location.hash = '';
      location.reload();
    };
  } catch (e) {
    root.innerHTML = `<div class="notice">${friendlyError(e)}</div>`;
  }
}
