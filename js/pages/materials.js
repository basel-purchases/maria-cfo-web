import * as api from '../api.js';
import { modal, toast, loader, friendlyError } from '../ui.js';
import { esc, unitLabel, money, num } from '../utils.js';

const stockOf = (r) => num(
  r.current_stock_base ??
  r.stock_quantity_base ??
  r.current_stock ??
  r.current_quantity_base,
  0,
);

function targetOf(r) {
  const direct = [
    'target_stock_base',
    'target_stock_quantity_base',
    'minimum_stock_base',
    'min_stock_base',
    'minimum_stock_quantity_base',
    'stock_alert_minimum_base',
  ];
  for (const key of direct) {
    if (r?.[key] !== undefined && r?.[key] !== null && r?.[key] !== '') return r[key];
  }
  const dynamic = Object.keys(r || {}).find((key) =>
    /(^|_)(target|minimum|min)(_|).*stock|stock.*(target|minimum|min)|alert.*(stock|quantity)/i.test(key),
  );
  return dynamic ? r[dynamic] : null;
}

const priceOf = (r) =>
  r.latest_purchase_unit_cost_base ??
  r.last_purchase_unit_cost_base ??
  r.current_unit_cost_base ??
  null;

function materialUnit(row, units) {
  const unit = units.find((u) => String(u.id) === String(row.base_unit_id));
  return unitLabel(unit?.code || unit?.name || row.base_unit_code || '');
}

export async function renderMaterials(root) {
  root.innerHTML = loader();
  try {
    const [rows, units] = await Promise.all([api.materials(), api.units()]);
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>المواد والكميات والأسعار</h2>
          <p>عرّف المواد التي تستخدمها، وسجّل الرصيد الموجود وآخر سعر معروف عند الحاجة. بعد ذلك تتولى فواتير الشراء تحديث الكميات والأسعار.</p>
        </div>
        <button class="btn add">إضافة مادة</button>
      </div>
      ${rows.length ? table(rows, units) : `
        <div class="card empty">
          <strong>ابدأ بأول مادة</strong>
          <div>أضف اسم المادة ووحدتها، ثم أدخل أي كمية أو سعر متوفر لديك الآن.</div>
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
  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>المادة</th>
            <th>الكود</th>
            <th>الوحدة</th>
            <th>الرصيد الموجود</th>
            <th>الحد الأدنى للرصيد قبل التنبيه</th>
            <th>آخر سعر معروف</th>
            <th>إجراء</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => {
            const unit = materialUnit(r, units);
            const target = targetOf(r);
            const price = priceOf(r);
            return `
              <tr>
                <td><strong>${esc(r.name)}</strong></td>
                <td>${esc(r.quick_code || r.code || '—')}</td>
                <td>${esc(unit || '—')}</td>
                <td><strong>${esc(stockOf(r))} ${esc(unit || '')}</strong></td>
                <td>${target == null ? '—' : `${esc(target)} ${esc(unit || '')}`}</td>
                <td>${price != null ? `${money(price)} / ${esc(unit || 'وحدة')}` : '—'}</td>
                <td>
                  <div class="material-actions">
                    <button class="mini-btn" type="button" data-material-setup="${esc(r.id)}">تعديل البيانات</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function unitOptions(units) {
  return units
    .map((u) => `<option value="${esc(u.id)}">${esc(unitLabel(u.code || u.name))}</option>`)
    .join('');
}

function wireUnitSuffixes(modalRef) {
  const unitSelect = modalRef.form.querySelector('[name="unit"]');
  if (!unitSelect) return;

  const refresh = () => {
    const selected = unitSelect.options[unitSelect.selectedIndex];
    const label = unitSelect.value ? (selected?.textContent?.trim() || 'الوحدة') : 'الوحدة';
    modalRef.form.querySelectorAll('[data-quantity-unit]').forEach((el) => {
      el.textContent = label;
    });
    modalRef.form.querySelectorAll('[data-price-unit]').forEach((el) => {
      el.textContent = unitSelect.value ? `SYP / ${label}` : 'SYP / الوحدة';
    });
  };

  unitSelect.addEventListener('change', refresh);
  refresh();
}

function addMaterial(root, units) {
  const m = modal({
    title: 'إضافة مادة',
    subtitle: 'أدخل المعلومات المتوفرة الآن. كل حقل يحمل علامة «اختياري» يمكن تركه فارغًا.',
    body: `
      <div class="form-grid" autocomplete="off">
        <div class="field">
          <label>اسم المادة</label>
          <input name="material_name" required autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false">
        </div>
        <div class="field">
          <label>الكود <span class="optional-badge">اختياري</span></label>
          <input name="material_code" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false">
        </div>
        <div class="field">
          <label>الوحدة</label>
          <select name="unit" required autocomplete="off">
            <option value="">اختر</option>
            ${unitOptions(units)}
          </select>
        </div>
        <div class="field">
          <label>الحد الأدنى للرصيد قبل التنبيه <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="target" type="number" min="0" step="any" autocomplete="off">
            <span class="input-suffix" data-quantity-unit>الوحدة</span>
          </div>
        </div>
        <div class="field">
          <label>الرصيد الموجود الآن <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="opening_quantity" type="number" min="0" step="any" autocomplete="off">
            <span class="input-suffix" data-quantity-unit>الوحدة</span>
          </div>
        </div>
        <div class="field">
          <label>آخر سعر معروف للوحدة <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="reference_price" type="number" min="0" step="any" autocomplete="off">
            <span class="input-suffix" data-price-unit>SYP / الوحدة</span>
          </div>
        </div>
      </div>`,
    onSubmit: async (fd) => {
      try {
        const name = String(fd.get('material_name') || '').trim();
        const code = String(fd.get('material_code') || '').trim();
        const unitId = String(fd.get('unit') || '').trim();
        const targetRaw = String(fd.get('target') || '').trim();
        const qtyRaw = String(fd.get('opening_quantity') || '').trim();
        const priceRaw = String(fd.get('reference_price') || '').trim();

        if (!name) {
          toast('اكتب اسم المادة.', 'error');
          return false;
        }
        if (!unitId) {
          toast('اختر وحدة المادة.', 'error');
          return false;
        }

        const basePayloads = [
          {
            name,
            ...(code ? { quick_code: code } : {}),
            base_unit_id: unitId,
            ...(targetRaw !== '' ? { target_stock_base: Number(targetRaw) } : {}),
          },
          {
            name,
            ...(code ? { quick_code: code } : {}),
            base_unit_id: unitId,
            ...(targetRaw !== '' ? { target_stock_quantity_base: Number(targetRaw) } : {}),
          },
          {
            name,
            ...(code ? { code } : {}),
            base_unit_id: unitId,
            ...(targetRaw !== '' ? { target_stock_base: Number(targetRaw) } : {}),
          },
          {
            name,
            ...(code ? { code } : {}),
            base_unit_id: unitId,
          },
        ];

        const created = await api.insertFirst('materials', basePayloads);

        if (targetRaw !== '' && targetOf(created) == null) {
          await api.setMaterialAlertMinimum(created.id, Number(targetRaw), created);
        }

        if (qtyRaw !== '' || priceRaw !== '') {
          await api.saveMaterialInitialState({
            materialId: created.id,
            openingQuantity: qtyRaw === '' ? null : Number(qtyRaw),
            referenceUnitCost: priceRaw === '' ? null : Number(priceRaw),
          });
        }

        toast('تمت إضافة المادة.', 'success');
        await renderMaterials(root);
        return true;
      } catch (e) {
        toast(friendlyError(e, 'تعذر حفظ المادة. حاول مرة أخرى.'), 'error');
        return false;
      }
    },
  });

  wireUnitSuffixes(m);
}

function editMaterialSetup(root, units, material) {
  const current = stockOf(material);
  const currentTarget = targetOf(material);
  const currentPrice = priceOf(material);
  const unit = materialUnit(material, units) || 'الوحدة';

  modal({
    title: `تعديل بيانات ${material.name || 'المادة'}`,
    body: `
      <div class="form-grid">
        <div class="field">
          <label>الرصيد الموجود <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="desired_stock" type="number" min="0" step="any" value="${esc(current)}" autocomplete="off">
            <span class="input-suffix">${esc(unit)}</span>
          </div>
        </div>
        <div class="field">
          <label>آخر سعر معروف للوحدة <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="reference_price" type="number" min="0" step="any" value="${currentPrice == null ? '' : esc(currentPrice)}" autocomplete="off">
            <span class="input-suffix">SYP / ${esc(unit)}</span>
          </div>
        </div>
        <div class="field">
          <label>الحد الأدنى للرصيد قبل التنبيه <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="target" type="number" min="0" step="any" value="${currentTarget == null ? '' : esc(currentTarget)}" autocomplete="off">
            <span class="input-suffix">${esc(unit)}</span>
          </div>
        </div>
      </div>`,
    submitText: 'حفظ التعديل',
    onSubmit: async (fd) => {
      try {
        const desiredRaw = String(fd.get('desired_stock') || '').trim();
        const priceRaw = String(fd.get('reference_price') || '').trim();
        const targetRaw = String(fd.get('target') || '').trim();

        if (targetRaw !== '') {
          await api.setMaterialAlertMinimum(material.id, Number(targetRaw), material);
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

        toast('تم تحديث بيانات المادة.', 'success');
        await renderMaterials(root);
        return true;
      } catch (e) {
        toast(friendlyError(e, 'تعذر تحديث بيانات المادة الآن.'), 'error');
        return false;
      }
    },
  });
}
