import * as api from '../api.js';
import { modal, toast, loader, friendlyError } from '../ui.js';
import { esc, unitLabel, money, num } from '../utils.js';
import { materialUnitChoices, openConversionDialog } from '../material-units.js';

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

function materialCode(row){
  return row.quick_code || row.code || row.__generatedCode || '—';
}

function unitOptions(units, selected='') {
  return units
    .map((u) => `<option value="${esc(u.id)}" ${String(u.id)===String(selected)?'selected':''}>${esc(unitLabel(u.code || u.name))}</option>`)
    .join('');
}

export async function renderMaterials(root) {
  root.innerHTML = loader();
  try {
    let [rows, units] = await Promise.all([api.materials(), api.units()]);
    rows = await api.ensureMaterialCodes(rows);
    await Promise.all(rows.map(r=>api.ensureStandardMaterialUnits(r,units).catch(()=>null)));

    root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>المواد والكميات والأسعار</h2>
          <p>عرّف المادة مرة واحدة، وحدد وحدة المخزون ووحدات الشراء والاستخدام. بعد ذلك تتولى الفواتير والوصفات الحسابات تلقائيًا.</p>
        </div>
        <button class="btn add">إضافة مادة</button>
      </div>
      ${rows.length ? table(rows, units) : `
        <div class="card empty">
          <strong>ابدأ بأول مادة</strong>
          <div>أضف اسم المادة ووحدة المخزون. يمكنك إدخال الرصيد والسعر إن كانا معروفين الآن.</div>
          <br>
          <button class="btn add">إضافة أول مادة</button>
        </div>`}`;

    root.querySelectorAll('.add').forEach((b) => {
      b.onclick = () => addMaterial(root, units, rows);
    });

    root.querySelectorAll('[data-material-edit]').forEach((b) => {
      const row = rows.find((r) => String(r.id) === b.dataset.materialEdit);
      if (row) b.onclick = () => editMaterial(root, units, row);
    });

    root.querySelectorAll('[data-material-units]').forEach((b) => {
      const row = rows.find((r) => String(r.id) === b.dataset.materialUnits);
      if (row) b.onclick = () => manageMaterialUnits(root, units, row);
    });
  } catch (e) {
    root.innerHTML = `<div class="notice">${friendlyError(e)}</div>`;
  }
}

function table(rows, units) {
  return `
    <div class="table-wrap table-fit">
      <table class="table materials-table">
        <thead>
          <tr>
            <th>المادة</th>
            <th>الوحدة</th>
            <th>الكود</th>
            <th>الرصيد الموجود</th>
            <th>الحد الأدنى قبل التنبيه</th>
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
                <td>${esc(unit || '—')}</td>
                <td><span class="code-chip">${esc(materialCode(r))}</span></td>
                <td><strong>${esc(stockOf(r))} ${esc(unit || '')}</strong></td>
                <td>${target == null ? '—' : `${esc(target)} ${esc(unit || '')}`}</td>
                <td>${price != null ? `${money(price)} / ${esc(unit || 'وحدة')}` : '—'}</td>
                <td>
                  <div class="material-actions">
                    <button class="mini-btn" type="button" data-material-edit="${esc(r.id)}">تعديل المادة</button>
                    <button class="mini-btn" type="button" data-material-units="${esc(r.id)}">الوحدات والتحويل</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function addMaterial(root, units, rows) {
  const m = modal({
    title: 'إضافة مادة',
    subtitle: 'اختر وحدة المخزون، وإذا كانت تُشترى بالجملة أضف وحدة الشراء والتحويل.',
    wide: true,
    body: `
      <div class="form-grid material-form-grid">
        <div class="field">
          <label>اسم المادة</label>
          <input name="material_name" required autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false">
        </div>
        <div class="field">
          <label>الكود <span class="optional-badge">اختياري</span></label>
          <input name="material_code" placeholder="يُنشأ تلقائيًا إذا تركته فارغًا" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false">
        </div>

        <div class="field">
          <label>وحدة المخزون الأساسية</label>
          <select name="base_unit" required>
            <option value="">اختر</option>
            ${unitOptions(units)}
          </select>
        </div>
        <div class="field">
          <label>وحدة الشراء <span class="optional-badge">اختياري</span></label>
          <select name="purchase_unit">
            <option value="">نفس وحدة المخزون</option>
            ${unitOptions(units)}
          </select>
        </div>

        <div class="field full purchase-conversion-field" hidden>
          <label data-purchase-conversion-label>تحويل وحدة الشراء</label>
          <div class="input-with-suffix">
            <input name="purchase_factor" type="number" min="0.00000001" step="any" autocomplete="off">
            <span class="input-suffix" data-purchase-conversion-suffix>من وحدة المخزون</span>
          </div>
        </div>

        <div class="field">
          <label>الرصيد الموجود الآن <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="opening_quantity" type="number" min="0" step="any" autocomplete="off">
            <span class="input-suffix" data-base-unit-label>الوحدة</span>
          </div>
        </div>
        <div class="field">
          <label>الحد الأدنى قبل التنبيه <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="target" type="number" min="0" step="any" autocomplete="off">
            <span class="input-suffix" data-base-unit-label>الوحدة</span>
          </div>
        </div>

        <div class="field full">
          <label>آخر سعر شراء معروف <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="reference_price" type="number" min="0" step="any" autocomplete="off">
            <span class="input-suffix" data-price-unit>SYP / الوحدة</span>
          </div>
        </div>
      </div>`,
    onSubmit: async (fd) => {
      try {
        const name = String(fd.get('material_name') || '').trim();
        const requestedCode = String(fd.get('material_code') || '').trim();
        const code = requestedCode || await api.nextMaterialCode(rows);
        const baseUnitId = String(fd.get('base_unit') || '').trim();
        const purchaseUnitId = String(fd.get('purchase_unit') || '').trim();
        const purchaseFactorRaw = String(fd.get('purchase_factor') || '').trim();
        const targetRaw = String(fd.get('target') || '').trim();
        const qtyRaw = String(fd.get('opening_quantity') || '').trim();
        const priceRaw = String(fd.get('reference_price') || '').trim();

        if (!name) {
          toast('اكتب اسم المادة.', 'error');
          return false;
        }
        if (!baseUnitId) {
          toast('اختر وحدة المخزون الأساسية.', 'error');
          return false;
        }

        const hasDifferentPurchaseUnit = purchaseUnitId && purchaseUnitId !== baseUnitId;
        if (hasDifferentPurchaseUnit && !(Number(purchaseFactorRaw) > 0)) {
          toast('اكتب علاقة التحويل لوحدة الشراء.', 'error');
          return false;
        }

        const basePayloads = [
          {
            name,
            quick_code: code,
            base_unit_id: baseUnitId,
            ...(targetRaw !== '' ? { target_stock_base: Number(targetRaw) } : {}),
          },
          {
            name,
            quick_code: code,
            base_unit_id: baseUnitId,
            ...(targetRaw !== '' ? { target_stock_quantity_base: Number(targetRaw) } : {}),
          },
          {
            name,
            code,
            base_unit_id: baseUnitId,
            ...(targetRaw !== '' ? { target_stock_base: Number(targetRaw) } : {}),
          },
          {name, code, base_unit_id: baseUnitId},
        ];

        const created = await api.insertFirst('materials', basePayloads);

        if (targetRaw !== '' && targetOf(created) == null) {
          await api.setMaterialAlertMinimum(created.id, Number(targetRaw), created);
        }

        let purchaseFactor=1;
        if (hasDifferentPurchaseUnit) {
          purchaseFactor=Number(purchaseFactorRaw);
          await api.saveMaterialUnit({
            materialId:created.id,
            unitId:purchaseUnitId,
            quantityInBase:purchaseFactor,
            isPurchaseUnit:true,
          });
        }

        await api.ensureStandardMaterialUnits(created,units);

        // The price field is entered for the selected purchase unit.
        // Store a normalized price per base unit so the cost engine remains deterministic.
        const normalizedPrice = priceRaw === ''
          ? null
          : Number(priceRaw) / purchaseFactor;

        if (qtyRaw !== '' || normalizedPrice !== null) {
          await api.saveMaterialInitialState({
            materialId: created.id,
            openingQuantity: qtyRaw === '' ? null : Number(qtyRaw),
            referenceUnitCost: normalizedPrice,
          });
        }

        toast(`تمت إضافة المادة بالكود ${code}.`, 'success');
        await renderMaterials(root);
        return true;
      } catch (e) {
        toast(friendlyError(e, 'تعذر حفظ المادة. حاول مرة أخرى.'), 'error');
        return false;
      }
    },
  });

  const baseSel=m.form.querySelector('[name="base_unit"]');
  const purchaseSel=m.form.querySelector('[name="purchase_unit"]');
  const conversionField=m.form.querySelector('.purchase-conversion-field');
  const conversionLabel=m.form.querySelector('[data-purchase-conversion-label]');
  const conversionSuffix=m.form.querySelector('[data-purchase-conversion-suffix]');
  const priceSuffix=m.form.querySelector('[data-price-unit]');
  const baseSuffixes=[...m.form.querySelectorAll('[data-base-unit-label]')];

  const refresh=()=>{
    const baseText=baseSel.value ? baseSel.options[baseSel.selectedIndex]?.textContent?.trim() : 'الوحدة';
    const purchaseText=purchaseSel.value ? purchaseSel.options[purchaseSel.selectedIndex]?.textContent?.trim() : baseText;
    const different=purchaseSel.value && purchaseSel.value!==baseSel.value;

    baseSuffixes.forEach(el=>el.textContent=baseText||'الوحدة');
    priceSuffix.textContent=`SYP / ${purchaseText||'الوحدة'}`;
    conversionField.hidden=!different;
    if(different){
      conversionLabel.textContent=`كل 1 ${purchaseText} يساوي كم ${baseText}؟`;
      conversionSuffix.textContent=baseText;
    }
  };
  baseSel.addEventListener('change',refresh);
  purchaseSel.addEventListener('change',refresh);
  refresh();
}

function editMaterial(root, units, material) {
  const current = stockOf(material);
  const currentTarget = targetOf(material);
  const currentPrice = priceOf(material);
  const unit = materialUnit(material, units) || 'الوحدة';
  const currentCode=materialCode(material)==='—' ? '' : materialCode(material);

  modal({
    title: `تعديل ${material.name || 'المادة'}`,
    wide:true,
    body: `
      <div class="form-grid material-form-grid">
        <div class="field">
          <label>اسم المادة</label>
          <input name="name" value="${esc(material.name||'')}" required autocomplete="off">
        </div>
        <div class="field">
          <label>الكود</label>
          <input name="code" value="${esc(currentCode)}" autocomplete="off">
        </div>
        <div class="field">
          <label>وحدة المخزون</label>
          <input value="${esc(unit)}" disabled>
        </div>
        <div class="field">
          <label>الرصيد الموجود</label>
          <div class="input-with-suffix">
            <input name="desired_stock" type="number" min="0" step="any" value="${esc(current)}" autocomplete="off">
            <span class="input-suffix">${esc(unit)}</span>
          </div>
        </div>
        <div class="field">
          <label>الحد الأدنى قبل التنبيه <span class="optional-badge">اختياري</span></label>
          <div class="input-with-suffix">
            <input name="target" type="number" min="0" step="any" value="${currentTarget == null ? '' : esc(currentTarget)}" autocomplete="off">
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
      </div>`,
    submitText: 'حفظ التعديل',
    onSubmit: async (fd) => {
      try {
        const name=String(fd.get('name')||'').trim();
        let code=String(fd.get('code')||'').trim();
        const desiredRaw = String(fd.get('desired_stock') || '').trim();
        const priceRaw = String(fd.get('reference_price') || '').trim();
        const targetRaw = String(fd.get('target') || '').trim();

        if(!name){
          toast('اسم المادة لا يمكن أن يكون فارغًا.','error');
          return false;
        }
        if(!code) code=await api.nextMaterialCode();

        await api.updateFirst('materials',material.id,[
          {name,quick_code:code},
          {name,code},
        ]);

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

        toast('تم تحديث المادة.', 'success');
        await renderMaterials(root);
        return true;
      } catch (e) {
        toast(friendlyError(e, 'تعذر تحديث المادة الآن.'), 'error');
        return false;
      }
    },
  });
}

async function manageMaterialUnits(root, units, material){
  try{
    const choices=await materialUnitChoices(material,units);
    const base=choices.find(x=>x.isBase);
    const body=()=>`
      <div class="unit-manager-head">
        <button type="button" class="btn soft add-purchase-unit">+ وحدة شراء</button>
        <button type="button" class="btn secondary add-usage-unit">+ وحدة استخدام</button>
      </div>
      <div class="table-wrap table-fit recipe-table-wrap">
        <table class="table compact-table">
          <thead><tr><th>الوحدة</th><th>الاستخدام</th><th>التحويل إلى ${esc(base?.label||'الوحدة الأساسية')}</th></tr></thead>
          <tbody>
            ${choices.map(x=>`
              <tr>
                <td><strong>${esc(x.label)}</strong></td>
                <td>${x.isBase?'أساسية':x.isPurchaseUnit?'شراء':'استخدام / وصفة'}</td>
                <td>${x.isBase?'1':`1 ${esc(x.label)} = ${esc(x.quantityInBase)} ${esc(base?.label||'وحدة')}`}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    const m=modal({
      title:`وحدات ${material.name}`,
      subtitle:'يمكن للمادة أن تُشترى بوحدة جملة وتُستخدم في الوصفة بوحدات أصغر.',
      wide:true,
      submitText:'إغلاق',
      body:body(),
      onSubmit:async()=>true,
    });

    const reload=async()=>{
      m.close();
      await manageMaterialUnits(root,units,material);
      await renderMaterials(root);
    };

    m.form.querySelector('.add-purchase-unit').onclick=()=>openConversionDialog({
      material,
      units,
      mode:'purchase',
      referenceUnitId:material.base_unit_id,
      onSaved:reload,
    });
    m.form.querySelector('.add-usage-unit').onclick=()=>openConversionDialog({
      material,
      units,
      mode:'usage',
      referenceUnitId:material.base_unit_id,
      onSaved:reload,
    });
  }catch(e){
    toast(friendlyError(e,'تعذر فتح وحدات المادة.'),'error');
  }
}
