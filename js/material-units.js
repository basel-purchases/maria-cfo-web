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
      : 'عرّف العلاقة بالطريقة الأسهل لك، ثم استخدم الوحدة مباشرة في الوصفة.',
    submitText:'حفظ التحويل',
    body:`
      <div class="conversion-pair-grid">
        <div class="field reference-unit-field">
          <label>الوحدة المرجعية</label>
          <select name="reference_unit" required>
            ${choices.map(x=>`<option value="${esc(x.unitId)}" ${String(x.unitId)===String(reference)?'selected':''}>${esc(x.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field new-unit-field">
          <label>الوحدة الجديدة</label>
          <select name="new_unit" required>
            ${unitOptions(availableNew)}
          </select>
        </div>
      </div>

      ${isPurchase ? '' : `
        <label class="inverse-option">
          <input type="checkbox" name="inverse_mode" value="1">
          <span class="inverse-checkmark">✓</span>
          <span>
            <strong>معكوس</strong>
            <small>فعّله إذا كان الأسهل أن تكتب كم تساوي الوحدة الجديدة من الوحدة المرجعية.</small>
          </span>
        </label>`}

      <div class="conversion-card">
        <div class="conversion-card-title">علاقة التحويل</div>
        <div class="conversion-sentence" data-conversion-sentence></div>
        <div class="conversion-value-row">
          <input name="factor" type="number" min="0.00000001" step="any" required autocomplete="off">
          <span class="conversion-value-suffix" data-factor-suffix></span>
        </div>
      </div>`,
    onSubmit:async fd=>{
      try{
        const newUnitId=String(fd.get('new_unit')||'');
        const refId=String(fd.get('reference_unit')||'');
        const factor=Number(fd.get('factor'));
        const inverse=!isPurchase && fd.get('inverse_mode')==='1';
        if(!(factor>0)){
          toast('اكتب قيمة تحويل أكبر من صفر.','error');
          return false;
        }
        const ref=choices.find(x=>String(x.unitId)===refId);
        if(!ref) throw new Error('REFERENCE_UNIT_NOT_FOUND');

        let quantityInBase;
        if(isPurchase){
          // 1 new purchase unit = factor reference units.
          quantityInBase=factor * ref.quantityInBase;
        }else if(inverse){
          // 1 new usage unit = factor reference units.
          quantityInBase=factor * ref.quantityInBase;
        }else{
          // 1 reference unit = factor new usage units.
          quantityInBase=ref.quantityInBase / factor;
        }

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
  const inverse=m.form.querySelector('[name="inverse_mode"]');
  const sentence=m.form.querySelector('[data-conversion-sentence]');
  const input=m.form.querySelector('[name="factor"]');
  const suffix=m.form.querySelector('[data-factor-suffix]');

  const refreshSentence=()=>{
    const newText=newSel.options[newSel.selectedIndex]?.textContent?.trim() || 'الوحدة الجديدة';
    const refText=refSel.options[refSel.selectedIndex]?.textContent?.trim() || 'الوحدة المرجعية';
    const inverseMode=Boolean(inverse?.checked);

    if(isPurchase){
      sentence.innerHTML=`1 <strong>${esc(newText)}</strong> = <strong>؟</strong> ${esc(refText)}`;
      suffix.textContent=refText;
      input.placeholder='مثال: 24';
      return;
    }

    if(inverseMode){
      sentence.innerHTML=`1 <strong>${esc(newText)}</strong> = <strong>؟</strong> ${esc(refText)}`;
      suffix.textContent=refText;
      input.placeholder='مثال: 50';
    }else{
      sentence.innerHTML=`1 <strong>${esc(refText)}</strong> = <strong>؟</strong> ${esc(newText)}`;
      suffix.textContent=newText;
      input.placeholder='مثال: 25';
    }
  };

  newSel.addEventListener('change',refreshSentence);
  refSel.addEventListener('change',refreshSentence);
  inverse?.addEventListener('change',refreshSentence);
  refreshSentence();
}
