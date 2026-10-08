import * as api from './api.js?v=0.14.0';
import { modal, toast, friendlyError } from './ui.js?v=0.14.0';
import { esc, unitDisplay, num } from './utils.js?v=0.14.0';

function unitById(units,id){
  return units.find(u=>String(u.id)===String(id));
}

export function labelForUnit(units,id){
  return unitDisplay(unitById(units,id));
}

export async function materialUnitChoices(material,units){
  const rows=await api.materialUnits(material.id);
  const out=[];
  const base=unitById(units,material.base_unit_id);
  if(base){
    out.push({
      unitId:base.id,
      unit:base,
      label:unitDisplay(base),
      quantityInBase:1,
      isBase:true,
      row:null,
    });
  }

  for(const row of rows){
    if(out.some(x=>String(x.unitId)===String(row.unit_id))) continue;
    const u=unitById(units,row.unit_id);
    if(!u) continue;
    out.push({
      unitId:u.id,
      unit:u,
      label:unitDisplay(u),
      quantityInBase:num(row.quantity_in_base,1),
      isBase:false,
      row,
    });
  }
  return out;
}

function datalistOptions(units){
  return units.map(u=>`<option value="${esc(unitDisplay(u))}">${esc(u.code||'')}</option>`).join('');
}

export async function openConversionDialog({
  material,
  units,
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

  const listId=`unit-catalog-${String(material.id).replace(/[^a-z0-9]/gi,'').slice(0,10)}-${Date.now()}`;

  const m=modal({
    title:'إضافة تحويل وحدة',
    subtitle:'اختر وحدة مرجعية، ثم ابحث عن الوحدة الأخرى أو اكتب اسم وحدة جديدة لإضافتها تلقائيًا.',
    submitText:'حفظ التحويل',
    body:`
      <div class="conversion-pair-grid" data-conversion-grid>
        <div class="field reference-unit-field">
          <label>الوحدة المرجعية</label>
          <select name="reference_unit" required>
            ${choices.map(x=>`<option value="${esc(x.unitId)}" ${String(x.unitId)===String(reference)?'selected':''}>${esc(x.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field new-unit-field">
          <label>الوحدة الأخرى</label>
          <input name="new_unit_text" list="${listId}" placeholder="اكتب أو ابحث مثل: ملعقة، سحارة..." required autocomplete="off">
          <datalist id="${listId}">${datalistOptions(units)}</datalist>
        </div>
      </div>

      <label class="inverse-option compact-inverse">
        <input type="checkbox" name="inverse_mode" value="1">
        <span class="inverse-checkmark">✓</span>
        <span>
          <strong>إجراء عكسي</strong>
          <small>بدّل اتجاه العلاقة إذا كان الأسهل أن تكتب مقدار الوحدة المرجعية داخل الوحدة الأخرى.</small>
        </span>
      </label>

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
        const refId=String(fd.get('reference_unit')||'');
        const unitText=String(fd.get('new_unit_text')||'').trim();
        const factor=Number(fd.get('factor'));
        const inverse=fd.get('inverse_mode')==='1';
        if(!(factor>0)){
          toast('اكتب قيمة تحويل أكبر من صفر.','error');
          return false;
        }
        const ref=choices.find(x=>String(x.unitId)===refId);
        if(!ref) throw new Error('REFERENCE_UNIT_NOT_FOUND');

        let newUnit=api.findUnitByText(unitText,units);
        if(!newUnit){
          newUnit=await api.resolveUnit(unitText,units);
          if(newUnit && !units.some(u=>String(u.id)===String(newUnit.id))) units.push(newUnit);
        }
        if(!newUnit?.id) throw new Error('UNIT_REQUIRED');
        if(String(newUnit.id)===String(refId)){
          toast('اختر وحدتين مختلفتين للتحويل.','error');
          return false;
        }

        // Default: 1 reference = factor other units.
        // Inverse: 1 other unit = factor reference units.
        const quantityInBase=inverse
          ? factor * ref.quantityInBase
          : ref.quantityInBase / factor;

        await api.saveMaterialUnit({
          materialId:material.id,
          unitId:newUnit.id,
          quantityInBase,
          isPurchaseUnit:false,
        });
        toast('تم حفظ التحويل.','success');
        if(onSaved) await onSaved(newUnit.id,newUnit);
        return true;
      }catch(e){
        toast(friendlyError(e,'تعذر حفظ التحويل.'),'error');
        return false;
      }
    },
  });

  const newInput=m.form.querySelector('[name="new_unit_text"]');
  const refSel=m.form.querySelector('[name="reference_unit"]');
  const inverse=m.form.querySelector('[name="inverse_mode"]');
  const sentence=m.form.querySelector('[data-conversion-sentence]');
  const input=m.form.querySelector('[name="factor"]');
  const suffix=m.form.querySelector('[data-factor-suffix]');
  const grid=m.form.querySelector('[data-conversion-grid]');

  const refreshSentence=()=>{
    const otherText=String(newInput.value||'').trim() || 'الوحدة الأخرى';
    const refText=refSel.options[refSel.selectedIndex]?.textContent?.trim() || 'الوحدة المرجعية';
    const inverseMode=Boolean(inverse?.checked);
    grid?.classList.toggle('is-inverse',inverseMode);

    if(inverseMode){
      sentence.innerHTML=`1 <strong>${esc(otherText)}</strong> = <strong>؟</strong> ${esc(refText)}`;
      suffix.textContent=refText;
      input.placeholder='مثال: 50';
    }else{
      sentence.innerHTML=`1 <strong>${esc(refText)}</strong> = <strong>؟</strong> ${esc(otherText)}`;
      suffix.textContent=otherText;
      input.placeholder='مثال: 25';
    }
  };

  newInput.addEventListener('input',refreshSentence);
  refSel.addEventListener('change',refreshSentence);
  inverse?.addEventListener('change',refreshSentence);
  refreshSentence();
}
