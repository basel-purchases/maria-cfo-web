import * as api from '../api.js';
import { modal, toast, loader, friendlyError, confirmBox } from '../ui.js';
import { esc, unitDisplay } from '../utils.js';

export async function renderSettings(root) {
  root.innerHTML = loader();
  try {
    const [settingsRows, units] = await Promise.all([
      api.list('app_settings', { limit: 1 }),
      api.units(),
    ]);
    const s = settingsRows[0] || {};
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>الإعدادات</h2>
          <p>الإعدادات العامة والوحدات التي يستخدمها Maria CFO في المواد والفواتير والوصفات.</p>
        </div>
      </div>
      <div class="settings-tabs" role="tablist">
        <button type="button" class="settings-tab active" data-settings-tab="general">عام</button>
        <button type="button" class="settings-tab" data-settings-tab="units">الوحدات</button>
      </div>

      <div data-settings-pane="general">
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
          <p>تسجيل الخروج موجود هنا فقط حتى لا يزعج الاستخدام اليومي.</p>
          <div class="quick-actions"><button class="btn secondary" id="settings-logout">تسجيل الخروج</button></div>
        </div>
      </div>
      </div>

      <div data-settings-pane="units" hidden>
      <div class="card units-settings-card">
        <div class="settings-card-head">
          <div>
            <h3>الوحدات</h3>
            <p>أضف أو عدّل أسماء الوحدات. إذا كانت وحدة مستخدمة في بيانات حالية فلن يسمح النظام بحذفها حمايةً للبيانات.</p>
          </div>
          <button type="button" class="btn add-unit">إضافة وحدة</button>
        </div>
        <div class="list-toolbar compact-toolbar">
          <div class="search-box">
            <span aria-hidden="true">⌕</span>
            <input id="unit-search" type="search" placeholder="ابحث باسم الوحدة أو الكود" autocomplete="off">
          </div>
          <div class="list-count" id="unit-count">${units.length} وحدة</div>
        </div>
        <div id="unit-list"></div>
      </div>
      </div>`;

    const tabs=[...root.querySelectorAll('[data-settings-tab]')];
    const panes=[...root.querySelectorAll('[data-settings-pane]')];
    tabs.forEach(tab=>{
      tab.onclick=()=>{
        const key=tab.dataset.settingsTab;
        tabs.forEach(x=>x.classList.toggle('active',x===tab));
        panes.forEach(p=>p.hidden=p.dataset.settingsPane!==key);
      };
    });

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

    const list=root.querySelector('#unit-list');
    const search=root.querySelector('#unit-search');
    const count=root.querySelector('#unit-count');
    const draw=()=>{
      const q=String(search.value||'').trim().toLowerCase();
      const filtered=units.filter(u=>{
        if(!q) return true;
        return String(u.name||'').toLowerCase().includes(q) || String(u.code||'').toLowerCase().includes(q);
      });
      count.textContent=`${filtered.length} وحدة`;
      list.innerHTML=`
        <div class="table-wrap table-fit">
          <table class="table compact-table units-table">
            <thead><tr><th>اسم الوحدة</th><th>الكود</th><th>إجراء</th></tr></thead>
            <tbody>
              ${filtered.map(u=>`
                <tr>
                  <td><strong>${esc(unitDisplay(u))}</strong></td>
                  <td><span class="code-chip">${esc(u.code||'—')}</span></td>
                  <td>
                    <div class="material-actions">
                      <button type="button" class="mini-btn edit-unit" data-id="${esc(u.id)}">تعديل</button>
                      <button type="button" class="mini-btn danger-lite delete-unit" data-id="${esc(u.id)}">حذف</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      list.querySelectorAll('.edit-unit').forEach(btn=>{
        const u=units.find(x=>String(x.id)===String(btn.dataset.id));
        if(u) btn.onclick=()=>unitEditor(root,u);
      });
      list.querySelectorAll('.delete-unit').forEach(btn=>{
        const u=units.find(x=>String(x.id)===String(btn.dataset.id));
        if(!u) return;
        btn.onclick=async()=>{
          if(!(await confirmBox(`حذف وحدة «${unitDisplay(u)}»؟ لن يتم الحذف إذا كانت مستخدمة في مواد أو تحويلات.`,'حذف'))) return;
          try{
            await api.deleteCustomUnit(u.id);
            toast('تم حذف الوحدة.','success');
            await renderSettings(root);
          }catch(e){
            const msg=String(e?.message||e||'').toLowerCase();
            if(msg.includes('unit_in_use') || msg.includes('foreign key')) toast('لا يمكن حذف هذه الوحدة لأنها مستخدمة حاليًا. يمكنك تعديل اسمها بدلًا من ذلك.','error');
            else toast(friendlyError(e,'تعذر حذف الوحدة.'),'error');
          }
        };
      });
    };
    search.addEventListener('input',draw);
    root.querySelector('.add-unit').onclick=()=>unitEditor(root,null);
    draw();
  } catch (e) {
    root.innerHTML = `<div class="notice">${friendlyError(e)}</div>`;
  }
}

function unitEditor(root,unit){
  modal({
    title:unit?'تعديل الوحدة':'إضافة وحدة',
    subtitle:'يمكن استخدام الوحدة الجديدة مباشرة في تحويلات المواد والوصفات.',
    body:`
      <div class="form-grid">
        <div class="field">
          <label>اسم الوحدة</label>
          <input name="name" value="${esc(unit?.name||'')}" required autocomplete="off" placeholder="مثال: سحارة">
        </div>
        <div class="field">
          <label>الكود <span class="optional-badge">اختياري</span></label>
          <input name="code" value="${esc(unit?.code||'')}" autocomplete="off" placeholder="يُنشأ تلقائيًا إذا تركته فارغًا">
        </div>
      </div>`,
    submitText:unit?'حفظ التعديل':'إضافة الوحدة',
    onSubmit:async fd=>{
      try{
        await api.saveCustomUnit({
          id:unit?.id||null,
          name:fd.get('name'),
          code:fd.get('code'),
        });
        toast(unit?'تم تعديل الوحدة.':'تمت إضافة الوحدة.','success');
        await renderSettings(root);
        return true;
      }catch(e){
        toast(friendlyError(e,'تعذر حفظ الوحدة. قد يكون الاسم أو الكود مستخدمًا مسبقًا.'),'error');
        return false;
      }
    },
  });
}
