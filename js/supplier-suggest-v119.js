import {supplierSuggestionsV119} from './purchase-workflow-v119.js?v=1.0.19';
import {esc} from './utils.js?v=1.0';

// Suggestions are optional: free text still creates a new supplier on submit.
// No amount or invoice is saved merely by choosing a suggestion.
export function attachSupplierSuggestV119(form,suppliers,{inputName='supplier'}={}){
  const input=form.querySelector(`[name="${inputName}"]`);
  if(!input)return;
  const wrap=input.closest('.supplier-suggest-wrap-v119');
  if(!wrap)return;
  const choices=wrap.querySelector('.supplier-suggest-results-v119');
  let shown=[],current=0;
  const hide=()=>{choices.hidden=true;input.setAttribute('aria-expanded','false');};
  const pick=i=>{
    if(!shown[i])return;
    input.value=shown[i].name;
    input.dataset.supplierId=String(shown[i].id);
    hide();input.focus();
  };
  const draw=()=>{
    input.dataset.supplierId='';
    shown=supplierSuggestionsV119(suppliers,input.value);
    current=0;
    choices.replaceChildren();
    if(!shown.length){hide();return;}
    shown.forEach((s,i)=>{
      const btn=document.createElement('button');btn.type='button';btn.className='supplier-suggest-choice-v119';
      btn.textContent=s.name;btn.setAttribute('role','option');
      btn.addEventListener('pointerdown',e=>e.preventDefault());
      btn.addEventListener('click',()=>pick(i));
      choices.append(btn);
    });
    choices.hidden=false;input.setAttribute('aria-expanded','true');
  };
  input.addEventListener('input',draw);
  input.addEventListener('focus',()=>{if(input.value.trim())draw();});
  input.addEventListener('keydown',e=>{
    if(choices.hidden)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();current=(current+(e.key==='ArrowDown'?1:-1)+shown.length)%shown.length;
      [...choices.children].forEach((c,i)=>c.classList.toggle('active',i===current));
    }else if(e.key==='Enter'&&shown.length){e.preventDefault();pick(current);}
    else if(e.key==='Escape'){e.stopPropagation();hide();}
  });
  input.addEventListener('blur',()=>setTimeout(hide,130));
}
export function supplierFieldV119({name='supplier',value='',label='اسم المورد',required=false}={}){
  return `<div class="field supplier-suggest-wrap-v119"><label>${esc(label)}</label>
    <input type="text" name="${esc(name)}" autocomplete="off" value="${esc(value)}"
       placeholder="اكتب أول حرف من اسم المورد" role="combobox" aria-expanded="false" aria-autocomplete="list" ${required?'required':''}>
    <div class="supplier-suggest-results-v119" role="listbox" hidden></div>
    <small class="action-hint">اختر من المقترحات أو اكتب اسم مورد جديد.</small></div>`;
}
