import * as api from '../api.js?v=0.22';
import { modal, toast, loader, friendlyError, confirmBox } from '../ui.js?v=0.22';
import { esc, unitDisplay } from '../utils.js?v=0.22';
import { conversionChoices,preferredChoice,fromBase,toBase, invertedRelationIsClear, relationAmountFromBase, relationBaseFromAmount } from '../unit-display-conversion.js?v=0.22';
import {
  buildUnitCatalog,
  formatUnitAmount,
  normalizedUnitName,
  validateNamedUnitDraft,
} from '../unit-catalog.js?v=0.22';

const TYPE_LABELS={
  dedicated:'وحدة خاصة بمادة', material:'تحويل مادة',
  ambiguous:'علاقات متعددة تحتاج مراجعة', duplicate:'اسم متكرر يحتاج مراجعة',
  global:'تحويل عام', shared:'وحدة مشتركة', base:'قياسية / أساسية',
  unassigned:'بلا علاقة محددة',
};

function relationHtml(entry){
  if(entry.isProtected && !entry.ambiguous){
    if(entry.general.length) return `<div class="unit-relations">${entry.general.slice(0,2).map(s=>`<div>${esc(s)}</div>`).join('')}</div>`;
    return `<span class="muted-small">وحدة قياس عامة${entry.related.length?`، مستخدمة في ${entry.related.length} مادة`:''}</span>`;
  }
  if(entry.related.length){
    return `<div class="unit-relations">${entry.related.slice(0,3).map(r=>`<div>${esc(r.text)}</div>`).join('')}${entry.related.length>3?`<small>و${entry.related.length-3} علاقات أخرى</small>`:''}</div>`;
  }
  if(entry.general.length){
    return `<div class="unit-relations">${entry.general.slice(0,2).map(s=>`<div>${esc(s)}</div>`).join('')}${entry.general.length>2?`<small>و${entry.general.length-2} تحويلات أخرى</small>`:''}</div>`;
  }
  if(entry.baseMaterials.length){
    return `<span class="muted-small">1 ${esc(unitDisplay(entry.unit))} = 1 ${esc(unitDisplay(entry.unit))} (وحدة أساسية لدى ${esc(entry.baseMaterials.map(m=>m.name).slice(0,2).join('، '))})</span>`;
  }
  return '<span class="muted-small">لم تُحدّد علاقة لها بعد</span>';
}

export async function renderSettings(root, selectedTab='general') {
  root.innerHTML = loader();
  try {
    const [settingsRows, units, cashboxes, materials, materialUnits, unitConversions] = await Promise.all([
      api.list('app_settings', { limit: 1 }),
      api.units(),
      api.cashboxes(),
      api.catalogMaterials(),
      api.allMaterialUnitLinks(),
      api.unitConversions(),
    ]);
    const s = settingsRows[0] || {};
    const catalog=buildUnitCatalog({units,materials,materialUnits,unitConversions});
    const baseUnits=new Map(units.map(u=>[String(u.id),u]));
    const alerts=catalog.filter(x=>['ambiguous','duplicate'].includes(x.status));

    root.innerHTML = `
      <div class="page-head"><div><h2>الإعدادات</h2>
        <p>الإعدادات العامة والوحدات وتحويلات المواد المستخدمة في الفواتير والوصفات.</p></div></div>
      <div class="settings-tabs" role="tablist">
        <button type="button" class="settings-tab" data-settings-tab="general">عام</button>
        <button type="button" class="settings-tab" data-settings-tab="units">الوحدات وعلاقاتها</button>
        <button type="button" class="settings-tab" data-settings-tab="payroll">الرواتب والصناديق</button>
      </div>

      <div data-settings-pane="general">
        <div class="grid cols-2">
          <div class="card"><h3>إعدادات حالية</h3><div class="kv">
            <div class="k">العملة الأساسية</div><div>${esc(s.base_currency_code || s.base_currency || 'SYP')}</div>
            <div class="k">العملة الثانوية</div><div>${esc(s.secondary_currency_code || s.secondary_currency || 'USD')}</div>
            <div class="k">Food Cost الافتراضي</div><div>${esc(s.default_food_cost_percent ?? '30')}%</div>
            <div class="k">المنطقة الزمنية</div><div>${esc(s.timezone || '—')}</div>
          </div></div>
          <div class="card"><h3>سعر الصرف</h3><p>تغيير السعر اليوم لا يعيد كتابة العمليات التاريخية.</p>
            <div class="form-grid" style="margin-top:12px">
              <div class="field"><label>العملة</label><select id="fx-cur"><option>USD</option></select></div>
              <div class="field"><label>1 USD = كم SYP</label><input id="fx-rate" type="number" step="any"></div>
            </div><div class="quick-actions"><button class="btn" id="fx-save">حفظ السعر</button></div>
          </div>
          <div class="card soft"><h3>جلسة الدخول</h3><p>تسجيل الخروج موجود هنا فقط حتى لا يزعج الاستخدام اليومي.</p>
            <div class="quick-actions"><button class="btn secondary" id="settings-logout">تسجيل الخروج</button></div>
          </div>
        </div>
      </div>

      <div data-settings-pane="payroll" hidden>
        <div class="card settings-payroll-box">
          <h3>صندوق دفع الرواتب</h3>
          <p>اختر صندوقًا نشطًا واحدًا. تُصرف رواتب الموظفين منه عبر حركة مالية موثقة، ولا تُخصم الرواتب من صندوق آخر تلقائيًا.</p>
          <div class="form-grid" style="margin-top:18px"><div class="field"><label>الصندوق الافتراضي للرواتب</label>
            <select id="payroll-cashbox"><option value="">— اختر الصندوق —</option>
            ${cashboxes.filter(b=>b.is_active!==false).map(b=>`<option value="${esc(b.id)}" ${b.id===s.payroll_cashbox_id?'selected':''}>${esc(b.name)}</option>`).join('')}
            </select></div></div>
          <div class="quick-actions"><button class="btn" id="save-payroll-cashbox">حفظ صندوق الرواتب</button><a class="btn secondary" href="#/payroll">عرض المستحقات</a></div>
          <p class="metric-note">لا تغيّر هذه الإعدادات الصندوق المسجّل في الدفعات التاريخية.</p>
        </div>
      </div>

      <div data-settings-pane="units" hidden>
        <div class="card units-settings-card">
          <div class="settings-card-head"><div>
            <h3>دليل الوحدات وقيم التحويل</h3>
            <p>عرض ذكي بين الغرام والكيلوغرام والمل واللتر، دون تغيير وحدات المخزون التاريخية.</p>
          </div><button type="button" class="btn add-unit">إضافة وحدة وعلاقتها</button></div>
          <div class="units-guidance">
            <strong>لمنع الالتباس:</strong> استخدم «ملعقة سكر» و«ملعقة سمنة» بدل تكرار «ملعقة» بقيم مختلفة.
            الوحدات القياسية مثل الغرام والكيلوغرام مشتركة، أما الوحدات الخاصة فترتبط بمادة واحدة.
          </div>
          ${alerts.length?`<div class="notice units-warning"><strong>${alerts.length} وحدة تحتاج مراجعة:</strong> توجد أسماء مكررة أو وحدات قديمة ذات علاقات متعددة. لن ندمجها أو نغيّر كمياتها تلقائيًا.</div>`:''}
          <div class="list-toolbar compact-toolbar"><div class="search-box"><span aria-hidden="true">⌕</span>
            <input id="unit-search" type="search" placeholder="ابحث عن الوحدة أو المادة أو قيمة التحويل" autocomplete="off">
          </div><div class="list-count" id="unit-count">${units.length} وحدة</div></div>
          <div id="unit-list"></div>
          <p class="metric-note">تعديل قيمة التحويل يؤثر في العمليات الجديدة والمسودات التي تستخدمها. السجلات المالية المنشورة لا تُعاد كتابتها. ولا يمكن حذف وحدة ما زالت مستخدمة.</p>
        </div>
      </div>`;

    const tabs=[...root.querySelectorAll('[data-settings-tab]')];
    const panes=[...root.querySelectorAll('[data-settings-pane]')];
    const setTab=key=>{
      tabs.forEach(tab=>{
        const active=tab.dataset.settingsTab===key;
        tab.classList.toggle('active',active);
        tab.setAttribute('aria-selected',String(active));
      });
      panes.forEach(p=>p.hidden=p.dataset.settingsPane!==key);
    };
    tabs.forEach(tab=>{tab.onclick=()=>setTab(tab.dataset.settingsTab);});
    setTab(['general','payroll','units'].includes(selectedTab)?selectedTab:'general');

    root.querySelector('#save-payroll-cashbox').onclick=async()=>{
      const id=root.querySelector('#payroll-cashbox').value;
      if(!id){toast('اختر صندوقًا لدفع الرواتب.','error');return;}
      try{await api.setPayrollCashbox(id);toast('تم حفظ صندوق الرواتب.','success');}
      catch(e){toast(friendlyError(e),'error');}
    };
    root.querySelector('#fx-save').onclick=async()=>{
      try{
        const rate=Number(root.querySelector('#fx-rate').value);
        if(!(rate>0)){toast('أدخل سعر صرف صحيح.','error');return;}
        try{await api.rpc('set_exchange_rate',{
          p_currency_code:'USD',p_rate_to_base:rate,p_effective_at:new Date().toISOString(),
        });}catch(_){await api.rpc('set_exchange_rate',{p_currency_code:'USD',p_rate:rate});}
        toast('تم حفظ سعر الصرف','success');
      }catch(e){toast(friendlyError(e),'error');}
    };
    root.querySelector('#settings-logout').onclick=async()=>{await api.signOut();location.hash='';location.reload();};

    const list=root.querySelector('#unit-list');
    const search=root.querySelector('#unit-search');
    const count=root.querySelector('#unit-count');
    const draw=()=>{
      const q=normalizedUnitName(search.value);
      const filtered=catalog.filter(entry=>{
        if(!q) return true;
        return [unitDisplay(entry.unit),entry.unit.name,entry.unit.code,
          ...entry.related.map(r=>r.text),...entry.general]
          .some(value=>normalizedUnitName(value).includes(q));
      });
      count.textContent=`${filtered.length} وحدة`;
      list.innerHTML=`<div class="table-wrap table-fit"><table class="table compact-table units-table units-conversion-table">
        <thead><tr><th>اسم الوحدة</th><th>قيمتها وعلاقتها</th><th>النوع</th><th>الإجراء</th></tr></thead>
        <tbody>${filtered.map(entry=>`<tr>
          <td><strong>${esc(unitDisplay(entry.unit))}</strong><small class="unit-code">${esc(entry.unit.code||'—')}</small></td>
          <td>${relationHtml(entry)}</td>
          <td><span class="unit-status unit-status-${esc(entry.status)}">${esc(TYPE_LABELS[entry.status]||entry.status)}</span></td>
          <td><div class="material-actions">
            ${entry.canEdit?`<button type="button" class="mini-btn edit-unit" data-id="${esc(entry.unit.id)}">تعديل القيمة والاسم</button>`:''}
            ${entry.canDelete?`<button type="button" class="mini-btn danger-lite delete-unit" data-id="${esc(entry.unit.id)}">حذف</button>`:''}
            ${!entry.canEdit && !entry.canDelete?'<span class="muted-small">محميّة / تحتاج مراجعة</span>':''}
          </div></td></tr>`).join('') || '<tr><td colspan="4" class="empty-table">لا توجد وحدات تطابق البحث.</td></tr>'}
        </tbody></table></div>`;

      list.querySelectorAll('.edit-unit').forEach(btn=>{
        const entry=catalog.find(x=>String(x.unit.id)===String(btn.dataset.id));
        if(entry) btn.onclick=()=>unitEditor(root,entry,{units,materials,catalog,baseUnits});
      });
      list.querySelectorAll('.delete-unit').forEach(btn=>{
        const entry=catalog.find(x=>String(x.unit.id)===String(btn.dataset.id));
        if(!entry) return;
        btn.onclick=async()=>{
          const message=`حذف وحدة «${unitDisplay(entry.unit)}»${entry.related[0]?' وعلاقتها بالمادة':''}؟ لن يُسمح بالحذف إذا كانت مستخدمة في أي سجل مالي أو وصفة.`;
          if(!(await confirmBox(message,'حذف الوحدة'))) return;
          try{
            await api.deleteNamedUnit(entry.unit.id);
            toast('تم حذف الوحدة وعلاقتها غير المستخدمة.','success');
            await renderSettings(root,'units');
          }catch(e){toast(friendlyError(e,'تعذر حذف الوحدة. قد تكون مستخدمة حاليًا.'),'error');}
        };
      });
    };
    search.addEventListener('input',draw);
    root.querySelector('.add-unit').onclick=()=>unitEditor(root,null,{units,materials,catalog,baseUnits});
    draw();
  }catch(e){root.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
}

function unitEditor(root,entry,{units,materials,catalog,baseUnits}){
  const unit=entry?.unit||null;
  const existing=entry?.materialLinks?.[0]||null;
  const linkedMaterial=existing ? materials.find(m=>String(m.id)===String(existing.material_id)) : entry?.baseMaterials?.[0];
  const currentId=String(linkedMaterial?.id||'');
  const unitName=unitDisplay(unit);
  const m=modal({
    title:unit?'تعديل الوحدة وقيمة التحويل':'إضافة وحدة مع علاقتها',
    subtitle:'تُعرّف الوحدة مرة واحدة باسم واضح وبقيمة من وحدة مخزون مادة محددة.',
    body:`<div class="form-grid">
      <div class="field full"><label>اسم الوحدة المميز</label>
        <input name="unit_name" value="${esc(unit?.name||'')}" required maxlength="120" placeholder="مثال: ملعقة سكر أو ملعقة سمنة" autocomplete="off">
        <small>لا تستخدم «ملعقة» وحدها عندما تختلف قيمتها باختلاف المادة.</small>
      </div>
      <div class="field"><label>المادة المرتبطة</label>
        ${existing?`<input type="hidden" name="material_id" value="${esc(currentId)}"><input value="${esc(linkedMaterial?.name||'—')}" disabled>`:
          `<select name="material_id" required><option value="">— اختر المادة —</option>
            ${materials.map(mat=>`<option value="${esc(mat.id)}" ${String(mat.id)===currentId?'selected':''}>${esc(mat.name)}</option>`).join('')}
          </select>`}
      </div>
      <div class="field"><label>قيمة الوحدة</label>
        <div class="input-with-suffix"><input name="amount" type="number" step="any" min="0.00000001" required placeholder="مثل 4">
        </div>
      </div>
      <div class="field"><label>الوحدة المرجعية للعرض والإدخال</label>
        <select name="display_unit" data-display-unit aria-label="وحدة القياس المرجعية"></select>
        <small>يمكنك التبديل بين غرام/كيلوغرام أو مل/لتر؛ سيحوّل الموقع القيمة تلقائيًا إلى وحدة مخزون المادة.</small>
      </div>
      <div class="field full named-unit-inverse-toggle"><label class="named-unit-inverse-label"><input type="checkbox" name="inverted_relation" data-inverse> اعكس العلاقة: أدخل عدد الوحدات الصغيرة في وحدة المخزون (مثل 1 كرتونة = 24 ظرف)</label>
      <small>يغيّر طريقة الإدخال والعرض فقط، ولا يضرب التحويل أو يقلب كميته المخزنة مرتين.</small></div>
      <div class="field full"><div class="named-unit-preview" data-relation-preview></div></div>
      <div class="field full"><p class="metric-note">مثال: «ملعقة سكر» بقيمة 5 ومادة «سكر» وحدتها الأساسية «غرام» تعني أن 1 ملعقة سكر = 5 غرام من السكر. لا تتغير قيود البيع والمشتريات السابقة.</p></div>
    </div>`,
    submitText:unit?'حفظ التعديل':'إضافة الوحدة',
    onSubmit:async fd=>{
      try{
        const payload={
          id:unit?.id||null,
          name:fd.get('unit_name'),
          materialId:fd.get('material_id'),
          quantityInBase:existing && !amountDirty ? Number(existing.quantity_in_base)
            :relationBaseFromAmount(fd.get('amount'),selectedChoice(),inverseEl.checked),
        };
        const error=validateNamedUnitDraft({
          name:payload.name, materialId:payload.materialId,
          amount:payload.quantityInBase,unitId:payload.id,units,catalog,
        });
        if(error){toast(error,'error');return false;}
        await api.saveNamedUnit(payload);
        toast(unit?'تم تحديث اسم الوحدة وقيمة تحويلها.':'تمت إضافة الوحدة وعلاقتها.','success');
        await renderSettings(root,'units');
        return true;
      }catch(e){toast(friendlyError(e,'تعذر حفظ الوحدة وعلاقتها.'),'error');return false;}
    },
  });
  const form=m.form;
  const materialEl=form.querySelector('[name="material_id"]');
  const amountEl=form.querySelector('[name="amount"]');
  const nameEl=form.querySelector('[name="unit_name"]');
  const preview=form.querySelector('[data-relation-preview]');
  const displayEl=form.querySelector('[data-display-unit]');
  const inverseEl=form.querySelector('[data-inverse]');
  let amountDirty=false;
  let activeChoices=[];
  let previousChoice=null;
  const selectedChoice=()=>activeChoices.find(c=>String(c.unit.id)===String(displayEl.value))||activeChoices[0];
  const refreshPreview=()=>{
    const mat=materials.find(x=>String(x.id)===String(materialEl?.value));
    const base=baseUnits.get(String(mat?.base_unit_id));
    const name=String(nameEl.value||'الوحدة').trim();
    const choice=selectedChoice();
    const amount=formatUnitAmount(amountEl.value);
    const stored=choice?relationBaseFromAmount(amountEl.value,choice,inverseEl.checked):NaN;
    preview.textContent=mat
      ? (inverseEl.checked?`1 ${choice?.label||unitDisplay(base)} = ${amount} ${name} من ${mat.name}`
        :`1 ${name} = ${amount} ${choice?.label||unitDisplay(base)} من ${mat.name}`)
        +(Number.isFinite(stored)&&choice?.factor!==1?` (تعادل ${formatUnitAmount(stored)} ${unitDisplay(base)} لكل ${name} في المخزون)`:'')
      : 'اختر المادة لتظهر علاقة الوحدة وقيمتها.';
  };
  const refreshUnits=()=>{
    const mat=materials.find(x=>String(x.id)===String(materialEl?.value));
    const base=baseUnits.get(String(mat?.base_unit_id));
    const inBase=existing && String(existing.material_id)===String(mat?.id)
      ? Number(existing.quantity_in_base):1;
    activeChoices=conversionChoices(base,units);
    const recommended=preferredChoice(base,units,inBase);
    displayEl.innerHTML=activeChoices.map(c=>`<option value="${esc(c.unit.id)}">${esc(c.label)}</option>`).join('');
    displayEl.value=String(recommended?.unit.id||'');
    previousChoice=selectedChoice();
    inverseEl.checked=!!(existing && invertedRelationIsClear(base,existing.quantity_in_base));
    if(existing && String(existing.material_id)===String(mat?.id)){
      amountEl.value=String(relationAmountFromBase(existing.quantity_in_base,previousChoice,inverseEl.checked));
    }
    refreshPreview();
  };
  displayEl.addEventListener('change',()=>{
    const next=selectedChoice();
    if(amountEl.value!=='' && previousChoice && next){
      const baseQty=relationBaseFromAmount(amountEl.value,previousChoice,inverseEl.checked);
      amountEl.value=String(relationAmountFromBase(baseQty,next,inverseEl.checked));
    }
    previousChoice=next;
    refreshPreview();
  });
  inverseEl.addEventListener('change',()=>{
    const choice=selectedChoice();
    if(choice && amountEl.value!==''){
      const baseQty=relationBaseFromAmount(amountEl.value,choice,!inverseEl.checked);
      amountEl.value=String(relationAmountFromBase(baseQty,choice,inverseEl.checked));
    }
    refreshPreview();
  });
  amountEl.addEventListener('input',()=>{amountDirty=true;refreshPreview();});
  nameEl.addEventListener('input',refreshPreview);
  materialEl?.addEventListener('change',refreshUnits);
  refreshUnits();
}
