import * as api from './api.js?v=1.0.30';
import {modal,toast,friendlyError,confirmBox} from './ui.js?v=1.0.30';
import {esc} from './utils.js?v=1.0';
import {groupPriceReviewV130} from './material-merge-v130.js?v=1.0.30';

function readablePrice(row){
  const cost=Number(row?.last_purchase_unit_cost_base);
  return row?.last_purchase_unit_cost_base!=null&&cost>0?`${cost.toLocaleString('ar')} ل.س`:'غير معروف';
}
function unitLabel(material,units){
  return units.find(u=>String(u.id)===String(material?.base_unit_id))?.name||material?.base_unit_code||'—';
}

export async function openMaterialGroupsV130({materials,units,onChanged}){
  const data=await api.materialGroupsV130();
  const materialMap=new Map(materials.map(m=>[String(m.id),m]));
  const groups=data.groups||[], groupMembers=data.members||[];
  const groupForMaterial=new Map(groupMembers.map(x=>[String(x.material_id),String(x.group_id)]));
  let groupId='';let members=[];
  const body=`<div class="form-grid">
    <div class="field full"><label>المجموعة</label><select name="group_selector" data-group-v130 data-no-searchable-select>
      <option value="">+ مجموعة جديدة</option>
      ${groups.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select></div>
    <div class="field full"><label>اسم المجموعة</label><input name="group_name" required maxlength="120" placeholder="مثال: مشروبات غازية"></div>
    <div class="field full"><label>ابحث عن مادة لإضافتها</label><input type="search" data-filter-v130 placeholder="اسم المادة أو رمزها"></div>
    <div class="field full"><label>اختر المادة</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
       <select data-select-v130 data-no-searchable-select style="flex:1;min-width:210px"></select><button class="btn secondary" type="button" data-add-v130>+ إضافة</button>
    </div></div>
    <div class="field full"><label>المواد بالترتيب (استخدم الأسهم لتغيير أولوية الصرف)</label><div data-members-v130></div></div>
    <div class="field full"><div data-warning-v130></div></div>
    <div class="field full"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="price_accept" value="yes" style="width:auto"> أؤكد بصفتي المحاسب اعتماد هذه المجموعة مع التنبيهات السعرية الظاهرة</label></div>
    <div class="field full"><button type="button" class="btn secondary" data-delete-v130 hidden>حذف المجموعة</button></div>
  </div>`;
  const m=modal({title:'دمج مواد للصرف من المخزون',wide:true,
    subtitle:'تظل المواد والفواتير والأسعار مستقلة. يُصرف من المادة المطلوبة أولًا، ثم بالترتيب المحدد عند نفاد رصيدها.',body,
    submitText:'اعتماد مجموعة الدمج',onSubmit:async(fd)=>{
      const name=String(fd.get('group_name')||'').trim();
      if(name.length<2){toast('اكتب اسم المجموعة.','error');return false;}
      if(members.length<2){toast('اختر مادتين على الأقل.','error');return false;}
      const rows=members.map(id=>materialMap.get(id));
      const review=groupPriceReviewV130(rows);
      if(review.unitMismatch){toast('لا يمكن دمج مواد بوحدات مخزون أساسية مختلفة. عدّل الوحدات أولًا.','error');return false;}
      if(review.needsConfirmation&&!m.form.elements.price_accept.checked){toast('تحقق من تنبيه الأسعار، ثم أكد قبول الدمج.','error');return false;}
      try{
        await api.materialGroupSaveV130({id:groupId||null,name,members,accepted:review.needsConfirmation&&m.form.elements.price_accept.checked});
        toast('تم حفظ المجموعة وترتيب الصرف.');
        try{await onChanged?.();}catch(e){console.warn('Group saved, page refresh failed',e);}return true;
      }catch(e){toast(friendlyError(e),'error');return false;}
    }});
  const form=m.form,selector=form.querySelector('[data-select-v130]'),filter=form.querySelector('[data-filter-v130]');
  const groupSelector=form.querySelector('[data-group-v130]');
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
  function draw(){
    const rows=members.map(id=>materialMap.get(id)).filter(Boolean);
    chosen.innerHTML=rows.length?rows.map((r,index)=>`<div style="display:flex;gap:7px;align-items:center;padding:7px 0;border-bottom:1px solid #dedede;flex-wrap:wrap">
      <strong style="flex:1;min-width:155px">${index+1}. ${esc(r.name)}</strong>
      <small>رصيد: ${Number(r.current_stock_base||0).toLocaleString('ar')} ${esc(unitLabel(r,units))} · آخر سعر: ${esc(readablePrice(r))}</small>
      <button type="button" class="mini-btn" data-move-v130="${index}" data-delta="-1" ${index===0?'disabled':''}>↑</button>
      <button type="button" class="mini-btn" data-move-v130="${index}" data-delta="1" ${index===rows.length-1?'disabled':''}>↓</button>
      <button type="button" class="mini-btn" data-remove-v130="${index}">إزالة</button></div>`).join(''):'<small>أضف مادتين أو أكثر.</small>';
    const r=groupPriceReviewV130(rows);
    const notes=[];
    if(r.unitMismatch)notes.push('وحدات المخزون مختلفة؛ لا يمكن اعتماد الدمج قبل توحيدها.');
    if(r.missing)notes.push('سعر شراء مادة أو أكثر غير معروف.');
    if(r.different)notes.push('تختلف أسعار الشراء بالليرة بين المواد.');
    if(r.differentUsd)notes.push('تختلف الأسعار المرجعية بالدولار بين المواد.');
    warn.innerHTML=notes.length?`<div class="notice">${notes.map(esc).join(' ')} راجع الأسعار قبل التأكيد.</div>`:'<small>الأسعار المعروفة متوافقة. عند الصرف تُحسب تكلفة كل مادة من سعرها الفعلي.</small>';
    form.elements.price_accept.closest('label').hidden=!r.needsConfirmation;
    if(!r.needsConfirmation)form.elements.price_accept.checked=false;
    deleteButton.hidden=!groupId;
    options();
  }
  groupSelector.onchange=()=>{
    groupId=String(groupSelector.value||'');
    const g=groups.find(g=>String(g.id)===groupId);
    form.elements.group_name.value=g?.name||'';
    members=groupMembers.filter(x=>String(x.group_id)===groupId).sort((a,b)=>Number(a.priority)-Number(b.priority)).map(x=>String(x.material_id));
    filter.value='';draw();
  };
  filter.oninput=options;
  form.querySelector('[data-add-v130]').onclick=()=>{
    const id=String(selector.value||'');if(!id)return;
    if(!members.includes(id))members.push(id);
    draw();
  };
  chosen.onclick=e=>{
    const move=e.target.closest('[data-move-v130]');
    if(move){const i=Number(move.dataset.moveV130),j=i+Number(move.dataset.delta);
      if(j>=0&&j<members.length)[members[i],members[j]]=[members[j],members[i]];draw();return;}
    const rem=e.target.closest('[data-remove-v130]');
    if(rem){members.splice(Number(rem.dataset.removeV130),1);draw();}
  };
  deleteButton.onclick=async()=>{
    if(!groupId)return;
    if(!await confirmBox('حذف هذه المجموعة سيوقف التحويل بين موادها للأوردرات الجديدة فقط. السجلات القديمة تبقى كما هي.','حذف المجموعة'))return;
    try{await api.materialGroupDeleteV130(groupId);toast('تم حذف المجموعة.');await m.close();await onChanged?.();}
    catch(e){toast(friendlyError(e),'error');}
  };
  draw();
}
