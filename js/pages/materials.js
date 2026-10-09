import * as api from '../api.js?v=0.19';
import { modal, toast, loader, friendlyError } from '../ui.js?v=0.19';
import { esc, unitDisplay, money, num } from '../utils.js?v=0.19';
import { materialUnitChoices, openConversionDialog } from '../material-units.js?v=0.19';
import { isVagueContextualName } from '../unit-catalog.js?v=0.19';

const PAGE_SIZE=10;

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
  return unitDisplay(unit) || row.base_unit_code || '';
}

function materialCode(row){
  return row.quick_code || row.code || row.__generatedCode || '—';
}

function unitListHtml(units,id){
  return `<datalist id="${id}">${units.map(u=>`<option value="${esc(unitDisplay(u))}">${esc(u.code||'')}</option>`).join('')}</datalist>`;
}

function filterRows(rows,query){
  const q=String(query||'').trim().toLowerCase();
  if(!q) return rows;
  return rows.filter(r=>{
    const name=String(r.name||'').toLowerCase();
    const code=String(materialCode(r)||'').toLowerCase();
    return name.includes(q) || code.includes(q);
  });
}

export async function renderMaterials(root) {
  root.innerHTML = loader();
  try {
    let [rows, units] = await Promise.all([api.materials(), api.units()]);
    rows = await api.ensureMaterialCodes(rows);
    await Promise.all(rows.map(r=>api.ensureStandardMaterialUnits(r,units).catch(()=>null)));

    const state={query:'',page:1};
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h2>المواد والكميات والأسعار</h2>
          <p>عرّف المادة مرة واحدة، وحدد وحدة المخزون. أضف التحويلات فقط عندما تحتاجها في الشراء أو الوصفات.</p>
        </div>
        <button class="btn add">إضافة مادة</button>
      </div>
      ${rows.length ? `
        <div class="list-toolbar">
          <div class="search-box">
            <span aria-hidden="true">⌕</span>
            <input id="material-search" type="search" placeholder="ابحث باسم المادة أو الكود" autocomplete="off">
          </div>
          <div class="list-count" id="material-count"></div>
        </div>
        <div id="materials-list"></div>` : `
        <div class="card empty">
          <strong>ابدأ بأول مادة</strong>
          <div>أضف اسم المادة ووحدة المخزون. يمكنك إدخال الرصيد والسعر إن كانا معروفين الآن.</div>
          <br>
          <button class="btn add">إضافة أول مادة</button>
        </div>`}`;

    root.querySelectorAll('.add').forEach((b) => {
      b.onclick = () => addMaterial(root, units, rows);
    });

    if(!rows.length) return;

    const list=root.querySelector('#materials-list');
    const count=root.querySelector('#material-count');
    const search=root.querySelector('#material-search');

    const draw=()=>{
      const filtered=filterRows(rows,state.query);
      const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
      state.page=Math.min(state.page,pages);
      const start=(state.page-1)*PAGE_SIZE;
      const shown=filtered.slice(start,start+PAGE_SIZE);
      count.textContent=`${filtered.length} مادة`;
      list.innerHTML=`
        ${shown.length ? table(shown, units) : '<div class="card empty"><strong>لا توجد نتائج</strong><div>جرّب اسمًا أو كودًا آخر.</div></div>'}
        ${filtered.length>PAGE_SIZE ? pagination(state.page,pages) : ''}`;

      list.querySelectorAll('[data-material-edit]').forEach((b) => {
        const row = rows.find((r) => String(r.id) === b.dataset.materialEdit);
        if (row) b.onclick = () => editMaterial(root, units, row);
      });
      list.querySelectorAll('[data-material-units]').forEach((b) => {
        const row = rows.find((r) => String(r.id) === b.dataset.materialUnits);
        if (row) b.onclick = () => manageMaterialUnits(root, units, row);
      });
      list.querySelector('[data-page-prev]')?.addEventListener('click',()=>{state.page=Math.max(1,state.page-1);draw();});
      list.querySelector('[data-page-next]')?.addEventListener('click',()=>{state.page=Math.min(pages,state.page+1);draw();});
    };

    search.addEventListener('input',()=>{
      state.query=search.value;
      state.page=1;
      draw();
    });
    draw();
  } catch (e) {
    root.innerHTML = `<div class="notice">${friendlyError(e)}</div>`;
  }
}

function pagination(page,pages){
  return `
    <div class="pagination-bar">
      <button type="button" class="mini-btn" data-page-prev ${page<=1?'disabled':''}>السابق</button>
      <span>صفحة ${page} من ${pages}</span>
      <button type="button" class="mini-btn" data-page-next ${page>=pages?'disabled':''}>التالي</button>
    </div>`;
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
  const listId=`material-base-units-${Date.now()}`;
  const m = modal({
    title: 'إضافة مادة',
    subtitle: 'أدخل المادة ووحدة المخزون. يمكنك إضافة أي تحويلات لاحقًا من زر «الوحدات والتحويل».',
    wide: true,
    body: `
      ${unitListHtml(units,listId)}
      <div class="form-grid material-form-grid">
        <div class="field">
          <label>اسم المادة</label>
          <input name="material_name" required autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false">
        </div>
        <div class="field">
          <label>الكود <span class="optional-badge">اختياري</span></label>
          <input name="material_code" placeholder="يُنشأ تلقائيًا إذا تركته فارغًا" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false">
        </div>

        <div class="field full">
          <label>وحدة المخزون الأساسية</label>
          <input name="base_unit_text" list="${listId}" placeholder="ابحث أو اكتب وحدة جديدة" required autocomplete="off">
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
        const unitText=String(fd.get('base_unit_text')||'').trim();
        const targetRaw = String(fd.get('target') || '').trim();
        const qtyRaw = String(fd.get('opening_quantity') || '').trim();
        const priceRaw = String(fd.get('reference_price') || '').trim();

        if (!name) {
          toast('اكتب اسم المادة.', 'error');
          return false;
        }
        if (!unitText) {
          toast('اختر أو اكتب وحدة المخزون الأساسية.', 'error');
          return false;
        }

        if(isVagueContextualName(unitText)){
          toast('استخدم وحدة مخزون أساسية مثل غرام أو كيلوغرام، ثم أضف وحدة خاصة بالتحويلات باسم المادة.','error');
          return false;
        }
        let baseUnit=api.findUnitByText(unitText,units);
        if(!baseUnit){
          baseUnit=await api.resolveUnit(unitText,units);
          if(baseUnit && !units.some(u=>String(u.id)===String(baseUnit.id))) units.push(baseUnit);
        }
        const baseUnitId=String(baseUnit?.id||'');
        if(!baseUnitId) throw new Error('UNIT_REQUIRED');

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

        await api.ensureStandardMaterialUnits(created,units);

        if (qtyRaw !== '' || priceRaw !== '') {
          await api.saveMaterialInitialState({
            materialId: created.id,
            openingQuantity: qtyRaw === '' ? null : Number(qtyRaw),
            referenceUnitCost: priceRaw === '' ? null : Number(priceRaw),
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

  const unitInput=m.form.querySelector('[name="base_unit_text"]');
  const priceSuffix=m.form.querySelector('[data-price-unit]');
  const baseSuffixes=[...m.form.querySelectorAll('[data-base-unit-label]')];
  const refresh=()=>{
    const text=String(unitInput.value||'').trim() || 'الوحدة';
    baseSuffixes.forEach(el=>el.textContent=text);
    priceSuffix.textContent=`SYP / ${text}`;
  };
  unitInput.addEventListener('input',refresh);
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
    const m=modal({
      title:`وحدات ${material.name}`,
      subtitle:'أضف وحدة باسم واضح مثل «ملعقة سكر» أو «كرتونة ماء»، وحدد قيمتها بالوحدة الأساسية؛ نفس التحويل يعمل في الشراء والوصفات.',
      wide:true,
      submitText:'إغلاق',
      body:`
        <div class="unit-manager-head single-action">
          <button type="button" class="btn soft add-conversion">+ إضافة تحويل</button>
        </div>
        <div class="table-wrap table-fit recipe-table-wrap">
          <table class="table compact-table">
            <thead><tr><th>الوحدة</th><th>العلاقة مع ${esc(base?.label||'الوحدة الأساسية')}</th></tr></thead>
            <tbody>
              ${choices.map(x=>`
                <tr>
                  <td><strong>${esc(x.label)}</strong>${x.isBase?' <span class="tag">أساسية</span>':''}</td>
                  <td>${x.isBase?'1':`1 ${esc(x.label)} = ${esc(x.quantityInBase)} ${esc(base?.label||'وحدة')}`}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`,
      onSubmit:async()=>true,
    });

    const reload=async()=>{
      m.close();
      const refreshedUnits=await api.units();
      await manageMaterialUnits(root,refreshedUnits,material);
      await renderMaterials(root);
    };

    m.form.querySelector('.add-conversion').onclick=()=>openConversionDialog({
      material,
      units,
      referenceUnitId:material.base_unit_id,
      onSaved:reload,
    });
  }catch(e){
    toast(friendlyError(e,'تعذر فتح وحدات المادة.'),'error');
  }
}
