import * as api from './api.js';
import { modal, toast, friendlyError } from './ui.js';
import { esc, unitLabel, num } from './utils.js';

function unitById(units,id){
  return units.find(u=>String(u.id)===String(id));
}

export function labelForUnit(units,id){
  const u=unitById(units,id);
  return unitLabel(u?.code || u?.name || '—');
}

export async function materialUnitChoices(material,units,{purchaseOnly=false}={}){
  const rows=await api.materialUnits(material.id);
  const out=[];
  const base=unitById(units,material.base_unit_id);
  if(base){
    out.push({
      unitId:base.id,
      unit:base,
      label:unitLabel(base.code||base.name),
      quantityInBase:1,
      isBase:true,
      isPurchaseUnit:true,
    });
  }

  for(const row of rows){
    if(purchaseOnly && row.is_purchase_unit!==true) continue;
    if(out.some(x=>String(x.unitId)===String(row.unit_id))) continue;
    const u=unitById(units,row.unit_id);
    if(!u) continue;
    out.push({
      unitId:u.id,
      unit:u,
      label:unitLabel(u.code||u.name),
      quantityInBase:num(row.quantity_in_base,1),
      isBase:false,
      isPurchaseUnit:row.is_purchase_unit===true,
      row,
    });
  }
  return out;
}

function unitOptions(units,selected='',excludeIds=[]){
  const excluded=new Set(excludeIds.map(String));
  return units
    .filter(u=>!excluded.has(String(u.id)))
    .map(u=>`<option value="${esc(u.id)}" ${String(u.id)===String(selected)?'selected':''}>${esc(unitLabel(u.code||u.name))}</option>`)
    .join('');
}

export async function openConversionDialog({
  material,
  units,
  mode='usage',
  referenceUnitId=null,
  onSaved=null,
}){
  const choices=await materialUnitChoices(material,units);
  if(!choices.length){
    toast('لا توجد وحدة أساسية للمادة.', 'error');
    return;
  }

  const reference=referenceUnitId && choices.some(x=>String(x.unitId)===String(referenceUnitId))
    ? referenceUnitId
    : choices[0].unitId;

  const configuredIds=choices.map(x=>String(x.unitId));
  const availableNew=units.filter(u=>!configuredIds.includes(String(u.id)));
  if(!availableNew.length){
    toast('كل الوحدات المتاحة مضافة لهذه المادة.');
    return;
  }

  const isPurchase=mode==='purchase';
  const m=modal({
    title:isPurchase ? 'إضافة وحدة شراء' : 'إضافة وحدة استخدام',
    subtitle:isPurchase
      ? 'اربط وحدة الشراء بوحدة معروفة للمادة.'
      : 'أضف وحدة أصغر أو بديلة لاستخدامها مباشرة في الوصفة.',
    submitText:'حفظ التحويل',
    body:`
      <div class="form-grid">
        <div class="field">
          <label>الوحدة الجديدة</label>
          <select name="new_unit" required>
            ${unitOptions(availableNew)}
          </select>
        </div>
        <div class="field">
          <label>الوحدة المرجعية</label>
          <select name="reference_unit" required>
            ${choices.map(x=>`<option value="${esc(x.unitId)}" ${String(x.unitId)===String(reference)?'selected':''}>${esc(x.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field full conversion-sentence-field">
          <label>علاقة التحويل</label>
          <div class="conversion-sentence" data-conversion-sentence></div>
          <input name="factor" type="number" min="0.00000001" step="any" required autocomplete="off">
        </div>
      </div>`,
    onSubmit:async fd=>{
      try{
        const newUnitId=String(fd.get('new_unit')||'');
        const refId=String(fd.get('reference_unit')||'');
        const factor=Number(fd.get('factor'));
        if(!(factor>0)){
          toast('اكتب قيمة تحويل أكبر من صفر.','error');
          return false;
        }
        const ref=choices.find(x=>String(x.unitId)===refId);
        if(!ref) throw new Error('REFERENCE_UNIT_NOT_FOUND');

        // Purchase mode: 1 new purchase unit = factor reference units.
        // Usage mode: 1 reference unit = factor new usage units.
        const quantityInBase=isPurchase
          ? factor * ref.quantityInBase
          : ref.quantityInBase / factor;

        await api.saveMaterialUnit({
          materialId:material.id,
          unitId:newUnitId,
          quantityInBase,
          isPurchaseUnit:isPurchase,
        });
        toast('تم حفظ التحويل.','success');
        if(onSaved) await onSaved(newUnitId);
        return true;
      }catch(e){
        toast(friendlyError(e,'تعذر حفظ التحويل.'),'error');
        return false;
      }
    },
  });

  const newSel=m.form.querySelector('[name="new_unit"]');
  const refSel=m.form.querySelector('[name="reference_unit"]');
  const sentence=m.form.querySelector('[data-conversion-sentence]');
  const input=m.form.querySelector('[name="factor"]');

  const refreshSentence=()=>{
    const newText=newSel.options[newSel.selectedIndex]?.textContent?.trim() || 'الوحدة الجديدة';
    const refText=refSel.options[refSel.selectedIndex]?.textContent?.trim() || 'الوحدة المرجعية';
    sentence.innerHTML=isPurchase
      ? `1 <strong>${esc(newText)}</strong> = <span class="conversion-input-slot">القيمة أدناه</span> <strong>${esc(refText)}</strong>`
      : `1 <strong>${esc(refText)}</strong> = <span class="conversion-input-slot">القيمة أدناه</span> <strong>${esc(newText)}</strong>`;
    input.placeholder=isPurchase
      ? `مثال: إذا كانت الكرتونة تحوي 24 ${refText} اكتب 24`
      : `مثال: إذا كان 1 ${refText} يساوي 50 ${newText} اكتب 50`;
  };
  newSel.addEventListener('change',refreshSentence);
  refSel.addEventListener('change',refreshSentence);
  refreshSentence();
}
