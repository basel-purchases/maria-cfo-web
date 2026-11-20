// Maria CFO v1.0.33: every sale has a clear, stage-specific next action.
import * as api from '../api.js?v=1.0.33';
import { esc, money } from '../utils.js?v=1.0';
import { toast, friendlyError, loader, confirmBox, modal } from '../ui.js?v=1.0.31';
import { queueActionV132, menuFilterLinkV132, sortQueueNamesV132 } from '../sale-queue-actions-v132.js?v=1.0.33';

const count = n => Number(n || 0).toLocaleString('ar-SY');
const norm = x => String(x || '').trim().replace(/[أإآٱ]/g, 'ا').replace(/ى/g,'ي').replace(/\s+/g,' ').toLowerCase();
function readableSaleErrorV132(error) {
  const e=String(error||'');
  if(e.includes('V131_COST_MISSING_AT_SALE_DATE'))return 'التكلفة التاريخية غير معروفة؛ استكمال صرف المخزون لا يتوقف بسببها.';
  if(e.includes('V133_COST_UNCONFIRMED_STOCK_ISSUED'))return 'صُرف المخزون، وتكلفة المادة التاريخية تحتاج مراجعة منفصلة.';
  if(e.includes('V131_SALE_MENU_NOT_ASSIGNED'))return 'اسم البيع غير مربوط بوجبة في المنيو.';
  if(e.includes('V131_SALE_RECIPE_NOT_DEFINED'))return 'مكونات الوصفة غير معرفة بعد.';
  if(e.includes('GROUP_STOCK_INSUFFICIENT')||e.includes('STOCK_INSUFFICIENT'))return 'الرصيد غير كافٍ؛ راجع مخزون المواد أو بدائل الدمج.';
  if(e.includes('V131_MANUAL_ORDER_PARTIALLY_ISSUED_REVIEW_REQUIRED'))return 'يحتاج هذا الأوردر مراجعة صرف جزئي سابق، وليس صرفًا تلقائيًا.';
  return e;
}

function statusText(row) {
  if (row.state === 'issued') return row.costComplete === false ? ['صُرفت المواد · تكلفة قيد المراجعة', 'yellow'] : ['مكتمل · صُرفت المواد', 'green'];
  if (row.state === 'included_in_count') return row.costComplete === false ? ['ضمن الجرد · تكلفة غير مؤكدة', 'yellow'] : ['مكتمل · ضمن الجرد', 'green'];
  if (row.state === 'review') return ['مراجعة صرف سابق', 'yellow'];
  const action = queueActionV132(row);
  if (action === 'add') return ['غير موجود بالمنيو', 'yellow'];
  if (action === 'recipe') return ['بانتظار مكونات الوجبة', 'yellow'];
  if (row.error) return ['مكونات جاهزة · راجع الرصيد', 'yellow'];
  return ['مكونات مضافة · قابلة للاستكمال', 'yellow'];
}

async function newMenuOrAliasV132(row, onChanged) {
  const choices = await api.menuAliasChoicesV104();
  const source = String(row.sourceName || '').trim();
  const same = choices.find(m => norm(m.name) === norm(source) || String(m.aliases_text || '').split(/[،,\n]/).some(a => norm(a) === norm(source)));
  const chooser = modal({
    title: `ربط الوجبة: ${source}`,
    subtitle: 'البيع مُسجّل بالفعل. هذا الإجراء يضيف الاسم إلى المنيو أو يربطه بوجبة موجودة، ولا يكرر القبض أو الخصم.',
    body: `<div class="field"><label>طريقة الربط</label><select name="mode" id="v132-menu-mode">
      <option value="create" ${same ? '' : 'selected'}>إضافة وجبة جديدة إلى المنيو</option>
      <option value="alias" ${same ? 'selected' : ''}>اعتبار الاسم ثانويًا لوجبة موجودة</option>
    </select></div>
    <div class="field" data-mode-pane="create"><label>اسم الوجبة الجديدة</label>
      <input name="newName" maxlength="250" value="${esc(source)}" autocomplete="off"></div>
    <div class="field" data-mode-pane="alias"><label>الوجبة الرئيسية المقصودة</label>
      <select name="menuId" id="v132-menu-target" data-searchable-select>
      <option value="">اختر الوجبة بعد البحث عنها</option>${choices.map(m => `<option value="${esc(m.id)}" ${same && m.id === same.id ? 'selected' : ''} data-search="${esc(m.aliases_text || '')}">${esc(m.name)}</option>`).join('')}</select></div>
    <p class="metric-note">سيُربط كل سطر بيع معلّق يحمل الاسم نفسه بهذه الوجبة، مع الاحتفاظ بالأوردرات والأسعار القديمة.</p>`,
    submitText: 'اعتماد الربط',
    onSubmit: async form => {
      try {
        const mode = String(form.get('mode'));
        let id, targetName = source;
        if (mode === 'create') {
          const name = String(form.get('newName') || '').trim();
          if (!name) { toast('أدخل اسم الوجبة.', 'error'); return false; }
          id = await api.menuSaveV104({name, aliases:[], price:null});
          targetName = name;
          if (norm(name) !== norm(source)) await api.v132AddMenuAlias(id, source);
        } else {
          id = String(form.get('menuId') || '');
          if (!id) { toast('اختر الوجبة الموجودة أولًا.', 'error'); return false; }
          targetName = choices.find(x => String(x.id) === id)?.name || source;
          if (norm(targetName) !== norm(source)) await api.v132AddMenuAlias(id, source);
        }
        const result = await api.v132LinkSaleQueueMenu(source, id);
        toast(`تم ربط ${count(result?.linked)} بند بيع بالوجبة «${targetName}».`, 'success');
        document.dispatchEvent(new CustomEvent('maria:cost-queue-changed'));
        await onChanged();
        location.hash = menuFilterLinkV132(targetName);
        return true;
      } catch (error) {
        toast(friendlyError(error, 'تعذر ربط البيع بالمنيو؛ تأكد من تثبيت تحديث SQL v1.0.33.'), 'error');
        return false;
      }
    },
  });
  const modeEl = chooser.element.querySelector('#v132-menu-mode');
  const updateMode = () => chooser.element.querySelectorAll('[data-mode-pane]').forEach(p => { p.hidden = p.dataset.modePane !== modeEl.value; });
  modeEl.addEventListener('change', updateMode);
  updateMode();
}

export async function renderSaleCostQueueV132(root, {pendingOnly = false} = {}) {
  root.innerHTML = loader();
  let pageSize = 200, offset = 0, showAll = !pendingOnly, query = '';
  let rows = [], totals = {};
  const reload = async () => {
    await api.v132AutoLinkSaleQueue();
    [rows, totals] = await Promise.all([api.v131SaleQueue(pageSize, offset, !showAll), api.v131SaleQueueSummary()]);
    draw();
    document.dispatchEvent(new CustomEvent('maria:cost-queue-changed'));
  };
  const complete = async (id = null) => {
    try {
      const result = await api.v131CompleteReadySales(id ? 1 : 150, id);
      toast(`صُرفت: ${count(result.issued)} · شملها الجرد: ${count(result.countCovered)} · بقيت معلّقة: ${count(result.stillWaiting)}`,
        (result.issued || result.countCovered) ? 'success' : 'error');
    } catch(error) {
      toast(friendlyError(error, 'تعذر صرف مكونات هذا البيع؛ تحقق من اكتمال الوصفة ورصيد المخزون.'), 'error');
    }
    await reload();
  };
  function draw() {
    const completed = Number(totals.completed || 0), waiting = Number(totals.pending || 0), ready = Number(totals.ready || 0);
    const visible = sortQueueNamesV132(rows).filter(row => !query || norm(`${row.menuName || ''} ${row.sourceName || ''}`).includes(norm(query)));
    root.innerHTML = `<div class="page-head"><div><h2>تسوية تكاليف المبيعات</h2>
      <p>مرتبة حسب اسم الوجبة. يُستكمل صرف المواد حتى لو لم يتوفر سعر شراء تاريخي؛ تُراجع التكلفة بصورة منفصلة دون إعادة تسجيل البيع.</p></div></div>
      <div class="grid cols-3"><div class="card"><small>بانتظار الاستكمال</small><h3>${count(waiting)}</h3></div>
      <div class="card"><small>لها مكونات</small><h3>${count(ready)}</h3></div>
      <div class="card"><small>تسويات مكتملة</small><h3>${count(completed)}</h3></div></div>
      <div class="card v132-queue-tools"><button class="btn" type="button" id="v132-complete-all" ${ready===0?'disabled':''}>استكمال الجاهزة</button>
      <button class="btn secondary" type="button" id="v132-refresh">تحديث</button>
      <label class="v132-check"><input id="v132-only-pending" type="checkbox" ${showAll?'':'checked'}> المعلّقة فقط</label>
      <div class="search-box"><span>⌕</span><input id="v132-sale-search" type="search" value="${esc(query)}" placeholder="بحث باسم الوجبة في الصفحة"></div>
      <p class="metric-note">يظهر «إضافة إلى المنيو» فقط إذا لم يُربط البيع بأي وجبة. الأخضر يعني اكتمال التسوية. لا تعاد حركة قبض أو تُخصم مادة سبق أن شملها جرد معتمد.</p></div>
      <div class="table-wrap" id="v132-sale-list"><table class="table"><thead><tr>
      <th>الوجبة</th><th>العدد</th><th>التاريخ</th><th>رقم الأوردر</th><th>التكلفة</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
      ${visible.map(row => { const [label, color] = statusText(row); const action = queueActionV132(row);
        const menuHref = menuFilterLinkV132(row.menuName || row.sourceName);
        const actionHtml = action === 'add'
          ? `<button class="mini-btn v132-queue-add" type="button" data-id="${esc(row.id)}">إضافة إلى المنيو</button>`
          : action === 'recipe'
            ? `<a class="mini-btn" href="${esc(menuHref)}">إكمال الوصفة</a>`
            : action === 'complete'
              ? `<button class="mini-btn v132-queue-complete" type="button" data-id="${esc(row.id)}">استكمال الصرف</button>`
              : action === 'review'
                ? `<a class="mini-btn" href="${esc(menuHref)}">المنيو والوصفة</a>`
                : `<span class="metric-note">مكتمل</span>`;
        return `<tr class="v132-queue-${color}"><td><strong>${esc(row.menuName || row.sourceName)}</strong>
          ${row.menuItemId && norm(row.sourceName) !== norm(row.menuName) ? `<small class="metric-note">اسم الكاشير: ${esc(row.sourceName)}</small>` : ''}</td>
          <td>${count(row.quantity)}</td><td>${esc(row.saleDate || '')}</td><td>${esc(row.orderNo || '—')}</td>
          <td>${row.cost == null ? '—' : money(row.cost)}</td><td><span class="badge ${color}">${esc(label)}</span>
          ${row.error ? `<div class="metric-note" title="${esc(readableSaleErrorV132(row.error))}">${esc(readableSaleErrorV132(row.error))}</div>` : ''}</td>
          <td>${actionHtml}</td></tr>`; }).join('') || '<tr><td colspan="7">لا توجد بنود مطابقة</td></tr>'}
      </tbody></table></div>
      <div class="card v132-pager"><button class="btn secondary" id="v132-prev" ${offset===0?'disabled':''}>السابق</button>
      <span>صفحة ${Math.floor(offset/pageSize)+1} · ${count(showAll?totals.total:waiting+Number(totals.review||0))} بند</span>
      <button class="btn secondary" id="v132-next" ${rows.length<pageSize?'disabled':''}>التالي</button></div>`;
    root.querySelector('#v132-only-pending').onchange = async e => { showAll = !e.target.checked; offset = 0; await reload(); };
    root.querySelector('#v132-prev').onclick = async () => { offset = Math.max(0,offset-pageSize); await reload(); };
    root.querySelector('#v132-next').onclick = async () => { offset += pageSize; await reload(); };
    root.querySelector('#v132-refresh').onclick = reload;
    root.querySelector('#v132-sale-search').oninput = e => {
      query = e.target.value;
      // A local search does not hit the database or redraw the input while typing.
      root.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = !norm(tr.cells?.[0]?.textContent).includes(norm(query)); });
    };
    root.querySelector('#v132-complete-all').onclick = async e => {
      if (!await confirmBox('سيتم استكمال صرف الوجبات ذات الوصفات المسجلة فقط. البنود الأخرى تبقى معلّقة، دون تسجيل قبض نقدي جديد. متابعة؟','تأكيد الاستكمال')) return;
      e.currentTarget.disabled = true;
      await complete();
    };
    root.querySelectorAll('.v132-queue-complete').forEach(button => button.onclick = async () => { button.disabled = true; await complete(button.dataset.id); });
    root.querySelectorAll('.v132-queue-add').forEach(button => button.onclick = async () => {
      const row = rows.find(x => String(x.id) === button.dataset.id);
      if (!row) return;
      button.disabled = true;
      try { await newMenuOrAliasV132(row, reload); } catch(error) { toast(friendlyError(error),'error'); }
      finally { if (button.isConnected) button.disabled = false; }
    });
  }
  try {
    await api.v131SeedSalesQueue();
    await reload();
    const handler = () => { if (root.isConnected) void reload(); else document.removeEventListener('maria:sale-queue-refresh',handler); };
    document.addEventListener('maria:sale-queue-refresh',handler);
  } catch(error) {
    root.innerHTML = `<div class="notice rose">${esc(friendlyError(error,'تعذر فتح تسوية المبيعات. يجب تثبيت SQL v1.0.33 أولًا.'))}</div>`;
  }
}
