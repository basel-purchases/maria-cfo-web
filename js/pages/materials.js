import * as api from '../api.js';
import { modal, toast, loader, friendlyError } from '../ui.js';
import { esc, unitLabel, money, num } from '../utils.js';

const stockOf = (r) => num(r.current_stock_base ?? r.stock_quantity_base ?? r.current_stock ?? r.current_quantity_base, 0);
const targetOf = (r) => r.target_stock_base ?? r.target_stock_quantity_base ?? null;
const priceOf = (r) => r.latest_purchase_unit_cost_base ?? r.last_purchase_unit_cost_base ?? r.current_unit_cost_base ?? null;

export async function renderMaterials(root) {
  root.innerHTML = loader();
  try {
    const [rows, units] = await Promise.all([api.materials(), api.units()]);
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>المواد والوحدات</h2>
          <p>هذه هي الخطوة الأساسية الأولى. عند البداية يمكنك تعريف المادة مع الرصيد الموجود فعليًا وآخر سعر تعرفه، وبعدها تتولى فواتير الشراء تحديث البيانات.</p>
        </div>
        <button class="btn add">إضافة مادة</button>
      </div>
      <div class="notice green material-setup-note">
        <strong>مهم:</strong> المستوى المستهدف للمخزون ليس هو الرصيد الحالي. هو قيمة مرجعية للتنبيه والتخطيط فقط.
      </div>
      ${rows.length ? table(rows, units) : `
        <div class="card empty">
          <strong>ابدأ بأول مادة</strong>
          <div>مثال: سكر — كيلوغرام. ويمكنك إدخال الرصيد الموجود الآن وآخر سعر تعرفه، وكل هذه القيم اختيارية ما عدا اسم المادة والوحدة.</div>
          <br>
          <button class="btn add">إضافة أول مادة</button>
        </div>`}`;

    root.querySelectorAll('.add').forEach((b) => {
      b.onclick = () => addMaterial(root, units);
    });
    root.querySelectorAll('[data-material-setup]').forEach((b) => {
      const row = rows.find((r) => String(r.id) === b.dataset.materialSetup);
      if (row) b.onclick = () => editMaterialSetup(root, units, row);
    });
  } catch (e) {
    root.innerHTML = `<div class="notice">${friendlyError(e)}</div>`;
  }
}

function table(rows, units) {
  const um = Object.fromEntries(units.map((u) => [u.id, unitLabel(u.code || u.name)]));
  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>المادة</th>
            <th>الكود</th>
            <th>الوحدة</th>
            <th>المخزون الحالي</th>
            <th>المستوى المستهدف</th>
            <th>آخر سعر معروف</th>
            <th>إجراء</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><strong>${esc(r.name)}</strong></td>
              <td>${esc(r.quick_code || r.code || '—')}</td>
              <td>${esc(um[r.base_unit_id] || unitLabel(r.base_unit_code) || '—')}</td>
              <td><strong>${esc(stockOf(r))}</strong></td>
              <td>${targetOf(r) == null ? '—' : esc(targetOf(r))}</td>
              <td>${priceOf(r) != null ? money(priceOf(r)) : '—'}</td>
              <td>
                <div class="material-actions">
                  <button class="mini-btn" type="button" data-material-setup="${esc(r.id)}">تعديل الرصيد / السعر</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function unitOptions(units) {
  return units.map((u) => `<option value="${esc(u.id)}">${esc(unitLabel(u.code || u.name))}</option>`).join('');
}

function addMaterial(root, units) {
  modal({
    title: 'إضافة مادة',
    subtitle: 'أدخل ما تعرفه الآن فقط. الرصيد والسعر والمستوى المستهدف اختيارية.',
    body: `
      <div class="form-grid" autocomplete="off">
        <div class="field">
          <label>اسم المادة</label>
          <input name="material_name" required autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false">
        </div>
        <div class="field">
          <label>كود اختياري</label>
          <input name="material_code" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false">
        </div>
        <div class="field">
          <label>الوحدة الأساسية</label>
          <select name="unit" required autocomplete="off">
            <option value="">اختر</option>
            ${unitOptions(units)}
          </select>
          <div class="hint">إذا كنت تحفظ البيض بالسفط اختر «سفط».</div>
        </div>
        <div class="field">
          <label>المستوى المستهدف للمخزون <span class="optional-badge">اختياري</span></label>
          <input name="target" type="number" min="0" step="any" autocomplete="off">
          <div class="hint">يستخدم للتنبيه والتخطيط فقط، ولا يغير الرصيد الحالي.</div>
        </div>
        <div class="field">
          <label>الرصيد الموجود الآن <span class="optional-badge">اختياري</span></label>
          <input name="opening_quantity" type="number" min="0" step="any" autocomplete="off">
          <div class="hint">هذا هو المخزون الفعلي الموجود عند بداية استخدام Maria CFO.</div>
        </div>
        <div class="field">
          <label>آخر سعر معروف للوحدة <span class="optional-badge">اختياري</span></label>
          <input name="reference_price" type="number" min="0" step="any" autocomplete="off">
          <div class="hint">يمكن إدخاله حتى لو لم تدخل كمية. الفواتير المستقبلية ستصبح المرجع الأساسي للأسعار.</div>
        </div>
      </div>`,
    onSubmit: async (fd) => {
      try {
        const name = String(fd.get('material_name') || '').trim();
        const code = String(fd.get('material_code') || '').trim();
        const targetRaw = String(fd.get('target') || '').trim();
        const qtyRaw = String(fd.get('opening_quantity') || '').trim();
        const priceRaw = String(fd.get('reference_price') || '').trim();
        if (!name) {
          toast('اكتب اسم المادة.', 'error');
          return false;
        }

        const created = await api.insertFirst('materials', [
          {
            name,
            quick_code: code || null,
            base_unit_id: fd.get('unit'),
            target_stock_base: targetRaw === '' ? null : Number(targetRaw),
          },
          {
            name,
            code: code || null,
            base_unit_id: fd.get('unit'),
            target_stock_quantity_base: targetRaw === '' ? null : Number(targetRaw),
          },
          {
            name,
            code: code || null,
            base_unit_id: fd.get('unit'),
          },
        ]);

        if (qtyRaw !== '' || priceRaw !== '') {
          await api.saveMaterialInitialState({
            materialId: created.id,
            openingQuantity: qtyRaw === '' ? null : Number(qtyRaw),
            referenceUnitCost: priceRaw === '' ? null : Number(priceRaw),
          });
        }

        toast('تمت إضافة المادة وحفظ بيانات البداية.', 'success');
        await renderMaterials(root);
        return true;
      } catch (e) {
        toast(friendlyError(e, 'تم تعذر حفظ المادة أو بيانات البداية. حاول مرة أخرى.'), 'error');
        return false;
      }
    },
  });
}

function editMaterialSetup(root, units, material) {
  const current = stockOf(material);
  const currentTarget = targetOf(material);
  const currentPrice = priceOf(material);
  const unitName = units.find((u) => String(u.id) === String(material.base_unit_id));

  modal({
    title: `تعديل بداية ${material.name || 'المادة'}`,
    subtitle: 'اكتب الرصيد الذي تريد أن يصبح موجودًا الآن، أو حدّث السعر المرجعي فقط.',
    body: `
      <div class="notice green">
        الرصيد الحالي: <strong>${esc(current)}</strong> ${esc(unitLabel(unitName?.code || unitName?.name || material.base_unit_code || ''))}
      </div>
      <div class="form-grid">
        <div class="field">
          <label>الرصيد المطلوب الآن <span class="optional-badge">اختياري</span></label>
          <input name="desired_stock" type="number" min="0" step="any" value="${esc(current)}" autocomplete="off">
          <div class="hint">سنحفظ الفرق كحركة مخزون، ولن نغير الرصيد بطريقة مباشرة غير قابلة للتتبع.</div>
        </div>
        <div class="field">
          <label>آخر سعر معروف للوحدة <span class="optional-badge">اختياري</span></label>
          <input name="reference_price" type="number" min="0" step="any" value="${currentPrice == null ? '' : esc(currentPrice)}" autocomplete="off">
        </div>
        <div class="field">
          <label>المستوى المستهدف <span class="optional-badge">اختياري</span></label>
          <input name="target" type="number" min="0" step="any" value="${currentTarget == null ? '' : esc(currentTarget)}" autocomplete="off">
          <div class="hint">للتنبيه فقط، وليس كمية المخزون.</div>
        </div>
      </div>`,
    submitText: 'حفظ التعديل',
    onSubmit: async (fd) => {
      try {
        const desiredRaw = String(fd.get('desired_stock') || '').trim();
        const priceRaw = String(fd.get('reference_price') || '').trim();
        const targetRaw = String(fd.get('target') || '').trim();

        if (targetRaw !== '') {
          await api.updateFirst('materials', material.id, [
            { target_stock_base: Number(targetRaw) },
            { target_stock_quantity_base: Number(targetRaw) },
          ]);
        }

        if (desiredRaw !== '') {
          const desired = Number(desiredRaw);
          const delta = desired - current;
          if (Math.abs(delta) > 0.0000001) {
            const movementType = current === 0 && delta > 0
              ? 'opening'
              : delta > 0 ? 'adjustment_in' : 'adjustment_out';
            await api.recordInventoryMovement({
              materialId: material.id,
              quantityDelta: delta,
              movementType,
              unitCost: delta > 0 && priceRaw !== '' ? Number(priceRaw) : null,
              note: current === 0 ? 'رصيد افتتاحي من صفحة المواد' : 'تسوية رصيد من صفحة المواد',
            });
          }
        }

        if (priceRaw !== '') {
          await api.setMaterialReferencePrice(material.id, Number(priceRaw));
        }

        toast('تم تحديث الرصيد / السعر المرجعي.', 'success');
        await renderMaterials(root);
        return true;
      } catch (e) {
        toast(friendlyError(e, 'تعذر تحديث بيانات المادة الآن.'), 'error');
        return false;
      }
    },
  });
}
