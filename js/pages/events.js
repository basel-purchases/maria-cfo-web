import * as api from '../api.js?v=0.20';
import { modal, toast, loader, friendlyError } from '../ui.js?v=0.20';
import { esc, dateOnly, todayISO } from '../utils.js?v=0.20';

export async function renderEvents(root) {
  root.innerHTML = loader();
  try {
    const rows = await api.events();
    root.innerHTML = `<div class="page-head">
      <div><h2>الحفلات والحجوزات</h2><p>كل حفلة كملف مستقل يجمع الضيوف والحجوزات والطعام والتكاليف والعمالة والنتيجة.</p></div>
      <button type="button" class="btn add">إضافة حفلة</button>
    </div>
    ${rows.length ? `<div class="grid cols-3">${rows.map(e => `<div class="card section-card">
      <span class="tag">${esc(e.event_type || e.type || 'حفلة')}</span>
      <h3>${esc(e.name || e.title || 'حفلة')}</h3>
      <p>${dateOnly(e.event_date)}<br>الحضور المخطط: ${esc(e.planned_guest_count ?? '—')}<br>الحالة: ${esc(e.status || '—')}</p>
    </div>`).join('')}</div>` : '<div class="card empty"><strong>لا توجد حفلات بعد</strong></div>'}`;
    root.querySelector('.add').onclick = () => openEventModal(root);
  } catch (e) {
    root.innerHTML = `<div class="notice">${esc(friendlyError(e))}</div>`;
  }
}

function openEventModal(root) {
  modal({
    title: 'إضافة حفلة',
    body: `<div class="form-grid">
      <div class="field full"><label>اسم الحفلة</label><input name="name" required></div>
      <div class="field"><label>التاريخ</label><input name="date" type="date" value="${todayISO()}" required></div>
      <div class="field"><label>النوع</label><select name="type">
        <option value="private">خاصة</option><option value="public">عامة</option>
      </select></div>
      <div class="field"><label>عدد الضيوف المخطط</label><input name="guests" type="number" min="0" step="1"></div>
      <div class="field"><label>نمط الإيراد</label><select name="mode">
        <option value="bookings">حجوزات</option><option value="orders">أوردرات</option><option value="both">كلاهما</option>
      </select></div>
    </div>`,
    onSubmit: async fd => {
      try {
        await api.createEvent({
          name: fd.get('name'),
          date: fd.get('date'),
          type: fd.get('type'),
          revenueMode: fd.get('mode'),
          guests: fd.get('guests'),
        });
        toast('تمت إضافة الحفلة', 'success');
        await renderEvents(root);
        return true;
      } catch (e) {
        toast(friendlyError(e), 'error');
        return false;
      }
    },
  });
}
