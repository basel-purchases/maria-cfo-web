import * as api from './api.js?v=1.0.31';
import {modal,toast,friendlyError,confirmBox} from './ui.js?v=1.0.31';
import {esc} from './utils.js?v=1.0';
import {groupPriceReviewV131,validGroupFactorV131} from './material-group-conversions-v131.js?v=1.0.31';

function readablePrice(row){
  const cost=Number(row?.last_purchase_unit_cost_base);
  return row?.last_purchase_unit_cost_base!=null&&cost>0?`${cost.toLocaleString('ar-u-nu-latn')} ل.س`:'غير معروف';
}
function unitLabel(material,units){
  return units.find(u=>String(u.id)===String(material?.base_unit_id))?.name||material?.base_unit_code||'—';
}

export async function openMaterialGroupsV130({materials,units,onChanged}){
  const data=await api.materialGroupsV130();
  const materialMap=new Map(materials.map(m=>[String(m.id),m]));
  const groups=data.groups||[], groupMembers=data.members||[];
  const groupForMaterial=new Map(groupMembers.map(x=>[String(x.material_id),String(x.group_id)]));
  let groupId='';let members=[];let referenceUnitId='';const ratios=new Map();
  const body=`<div class="form-grid">
    <div class="field full"><label>المجموعة</label><select name="group_selector" data-group-v130 data-no-searchable-select>
      <option value="">+ مجموعة جديدة</option>
      ${groups.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select></div>
    <div class="field full"><label>اسم المجموعة</label><input name="group_name" required maxlength="120" placeholder="مثال: مشروبات غازية"></div>
    <div class="field full"><label>ابحث عن مادة لإضافتها</label><input type="search" data-filter-v130 placeholder="اسم المادة أو رمزها"></div>
    <div class="field full"><label>اختر المادة</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
       <select data-select-v130 data-no-searchable-select style="flex:1;min-width:210px"></select><button class="btn secondary" type="button" data-add-v130>+ إضافة</button>
    </div></div>
    <div class="field full"><label>\u0627\u0644\u0648\u062d\u062f\u0629 \u0627\u0644\u0645\u0631\u062c\u0639\u064a\u0629</label><select data-ref-v131 data-no-searchable-select></select></div>
    <div class="field full"><label>المواد بالترتيب (استخدم الأسهم لتغيير أولوية الصرف)</label><div data-members-v130></div></div>
    <div class="field full"><div data-warning-v130></div></div>
    <div class="field full"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="price_accept" value="yes" style="width:auto"> أؤكد بصفتي المحاسب اعتماد هذه المجموعة مع التنبيهات السعرية الظاهرة</label></div>
    <div class="field full"><button type="button" class="btn secondary" data-delete-v130 hidden>حذف المجموعة</button></div>
  </div>`;
  const m=modal({title:'دمج مواد للصرف من المخزون',wide:true,
    subtitle:'تظل المواد والفواتير والأسعار مستقلة. حدد علاقة التحويل لكل مادة تختلف وحدتها عن وحدة المجموعة، ثم ترتيب الصرف.',body,
    submitText:'اعتماد مجموعة الدمج',onSubmit:async(fd)=>{
      const name=String(fd.get('group_name')||'').trim();
      if(name.length<2){toast('اكتب اسم المجموعة.','error');return false;}
      if(members.length<2){toast('اختر مادتين على الأقل.','error');return false;}
      const rows=members.map(id=>materialMap.get(id));
      const review=groupPriceReviewV131(rows,referenceUnitId,ratios);
      if(review.invalidFactors){toast('\u0623\u062f\u062e\u0644 \u0639\u0644\u0627\u0642\u0629 \u0627\u0644\u062a\u062d\u0648\u064a\u0644 \u0644\u0643\u0644 \u0645\u0627\u062f\u0629.','error');return false;}
      if(review.needsConfirmation&&!m.form.elements.price_accept.checked){toast('تحقق من تنبيه الأسعار بعد تحويل الوحدات، ثم أكد قبول الدمج.','error');return false;}
      const factors=rows.map(row=>String(row.base_unit_id)===String(referenceUnitId)?1:Number(ratios.get(String(row.id))));
      try{
        await api.materialGroupSaveV131({id:groupId||null,name,referenceUnitId,members,factors,accepted:review.needsConfirmation&&m.form.elements.price_accept.checked});
        toast('تم حفظ المجموعة وترتيب الصرف.');
        try{await onChanged?.();}catch(e){console.warn('Group saved, page refresh failed',e);}return true;
      }catch(e){toast(friendlyError(e),'error');return false;}
    }});
  const form=m.form,selector=form.querySelector('[data-select-v130]'),filter=form.querySelector('[data-filter-v130]');
  const groupSelector=form.querySelector('[data-group-v130]'),referenceSelect=form.querySelector('[data-ref-v131]');
  const chosen=form.querySelector('[data-members-v130]'),warn=form.querySelector('[data-warning-v130]');
  const deleteButton=form.querySelector('[data-delete-v130]');
  function options(){
    const q=filter.value.trim().toLowerCase();
    const allowed=materials.filter(x=>{
      if(members.includes(String(x.id)))return false;
      const belongs=groupForMaterial.get(String(x.id));
      return (!belongs||belongs===groupId)&&(!q||String(x.name||'').toLowerCase().includes(q)||String(x.code||x.quick_code||'').toLowerCase().includes(q));
    });
    selector.innerHTML=`<option value="">${allowed.length?'اختر المادة':'لا توجد مواد مطابقة'}</option>`+
      allowed.slice(0,350).map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(unitLabel(x,units))}</option>`).join('');
  }
  function renderReference(){
    const availableUnits=[...new Set(members.map(id=>String(materialMap.get(id)?.base_unit_id||'')).filter(Boolean))];
    if(referenceUnitId && !availableUnits.includes(referenceUnitId)){ referenceUnitId='';ratios.clear(); }
    if(!referenceUnitId) referenceUnitId=availableUnits[0]||'';
    referenceSelect.innerHTML=availableUnits.length?availableUnits.map(id=>
      `<option value="${esc(id)}" ${referenceUnitId===id?'selected':''}>${esc(unitLabel({base_unit_id:id},units))}</option>`).join(''):
      '<option value="">--</option>';
    referenceSelect.disabled=availableUnits.length<2;
  }
  function renderWarnings(){
    const rows=members.map(id=>materialMap.get(id)).filter(Boolean);
    const r=groupPriceReviewV131(rows,referenceUnitId,ratios);
    const notes=[];
    if(r.invalidFactors)notes.push('\u0623\u062f\u062e\u0644 \u0639\u0644\u0627\u0642\u0629 \u0627\u0644\u062a\u062d\u0648\u064a\u0644 \u0644\u0643\u0644 \u0645\u0627\u062f\u0629 \u0645\u062e\u062a\u0644\u0641\u0629 \u0627\u0644\u0648\u062d\u062f\u0629.');
    if(r.missing)notes.push('سعر شراء مادة أو أكثر غير معروف.');
    if(r.different)notes.push('تختلف أسعار الشراء بالليرة بعد تحويل الوحدات.');
    if(r.differentUsd)notes.push('تختلف الأسعار بالدولار بعد تحويل الوحدات.');
    warn.innerHTML=notes.length?`<div class="notice">${notes.map(esc).join(' ')} راجع العلاقة والأسعار قبل التأكيد.</div>`:
      '<small>الأسعار المعروفة متوافقة بعد التحويل. تكلفة كل مادة تُحسب من سعر وحدتها الفعلية.</small>';
    form.elements.price_accept.closest('label').hidden=!r.needsConfirmation;
    if(!r.needsConfirmation)form.elements.price_accept.checked=false;
  }
  function draw(){
    renderReference();
    const refName=unitLabel({base_unit_id:referenceUnitId},units);
    const rows=members.map(id=>materialMap.get(id)).filter(Boolean);
    for(const row of rows){
      const id=String(row.id);
      if(String(row.base_unit_id)===String(referenceUnitId))ratios.set(id,1);
    }
    chosen.innerHTML=rows.length?rows.map((r,index)=>{
      const same=String(r.base_unit_id)===String(referenceUnitId);
      const factor=ratios.get(String(r.id));
      const price=Number(r.last_purchase_unit_cost_base);
      const normalized=price>0 && (same||validGroupFactorV131(factor))
        ? `${(price/(same?1:Number(factor))).toLocaleString('ar-u-nu-latn',{maximumFractionDigits:4})} / ${esc(refName)}`:'--';
      const conversion=same?`<small>1 ${esc(refName)} = 1 ${esc(refName)}</small>`:
        `<label style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">1 ${esc(unitLabel(r,units))} =
        <input data-factor-v131="${esc(r.id)}" type="number" min="0.000001" max="1000000" step="any"
        value="${validGroupFactorV131(factor)?esc(String(factor)):''}" placeholder="?" required style="width:120px;max-width:120px" />
        ${esc(refName)}</label>`;
      return `<div style="display:flex;gap:7px;align-items:center;padding:7px 0;border-bottom:1px solid #dedede;flex-wrap:wrap">
      <strong style="flex:1;min-width:155px">${index+1}. ${esc(r.name)}</strong>
      <small>رصيد: ${Number(r.current_stock_base||0).toLocaleString('ar-u-nu-latn')} ${esc(unitLabel(r,units))} · آخر سعر: ${esc(readablePrice(r))}</small>
      ${conversion}
      <small data-normalized-v131="${esc(r.id)}">${normalized}</small>
      <button type="button" class="mini-btn" data-move-v130="${index}" data-delta="-1" ${index===0?'disabled':''}>↑</button>
      <button type="button" class="mini-btn" data-move-v130="${index}" data-delta="1" ${index===rows.length-1?'disabled':''}>↓</button>
      <button type="button" class="mini-btn" data-remove-v130="${index}">إزالة</button></div>`;
    }).join(''):'<small>أضف مادتين أو أكثر.</small>';
    renderWarnings();
    deleteButton.hidden=!groupId;
    options();
  }
  groupSelector.onchange=()=>{
    groupId=String(groupSelector.value||'');
    const g=groups.find(g=>String(g.id)===groupId);
    form.elements.group_name.value=g?.name||'';
    const selected=groupMembers.filter(x=>String(x.group_id)===groupId).sort((a,b)=>Number(a.priority)-Number(b.priority));
    members=selected.map(x=>String(x.material_id));
    referenceUnitId=String(g?.reference_unit_id_v131||'');
    ratios.clear();
    for(const x of selected)ratios.set(String(x.material_id),Number(x.group_units_per_base_v131||1));
    filter.value='';draw();
  };
  filter.oninput=options;
  referenceSelect.onchange=()=>{
    referenceUnitId=String(referenceSelect.value||'');ratios.clear();draw();
  };
  form.querySelector('[data-add-v130]').onclick=()=>{
    const id=String(selector.value||'');if(!id)return;
    if(!members.includes(id)){
      members.push(id);
      const row=materialMap.get(id);
      if(!referenceUnitId)referenceUnitId=String(row?.base_unit_id||'');
      if(String(row?.base_unit_id)===referenceUnitId)ratios.set(id,1);
    }
    draw();
  };
  chosen.addEventListener('input',e=>{
    const input=e.target.closest('[data-factor-v131]');if(!input)return;
    const id=String(input.dataset.factorV131);
    const factor=input.value.trim()?Number(input.value):null;
    ratios.set(id,factor);
    const normalized=chosen.querySelector(`[data-normalized-v131="${id}"]`);
    const price=Number(materialMap.get(id)?.last_purchase_unit_cost_base);
    if(normalized) normalized.textContent=price>0&&validGroupFactorV131(factor)
      ? `${(price/factor).toLocaleString('ar-u-nu-latn',{maximumFractionDigits:4})} / ${unitLabel({base_unit_id:referenceUnitId},units)}`:'--';
    renderWarnings();
  });
  chosen.onclick=e=>{
    const move=e.target.closest('[data-move-v130]');
    if(move){const i=Number(move.dataset.moveV130),j=i+Number(move.dataset.delta);
      if(j>=0&&j<members.length)[members[i],members[j]]=[members[j],members[i]];draw();return;}
    const rem=e.target.closest('[data-remove-v130]');
    if(rem){const [id]=members.splice(Number(rem.dataset.removeV130),1);ratios.delete(id);draw();}
  };
  deleteButton.onclick=async()=>{
    if(!groupId)return;
    if(!await confirmBox('حذف هذه المجموعة سيوقف التحويل بين موادها للأوردرات الجديدة فقط. السجلات القديمة تبقى كما هي.','حذف المجموعة'))return;
    try{await api.materialGroupDeleteV130(groupId);toast('تم حذف المجموعة.');await m.close();await onChanged?.();}
    catch(e){toast(friendlyError(e),'error');}
  };
  draw();
}
