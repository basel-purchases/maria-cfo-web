// v0.33: ONE control only: type/search inside the dropdown combobox.
// The original native <select> remains the source of truth for forms, change
// listeners and Supabase RPCs. Suggestions never submit free text or guess IDs.
import {staffSearchScoreV033,normalizeStaffQueryV033} from './staff-ux-v033.js?v=0.33';
const THRESHOLD=8;
const cache=new WeakMap();
const instances=new Set();
const collator=new Intl.Collator('ar',{numeric:true,sensitivity:'base'});
let listenerAdded=false;
let nextId=0;
function entries(select){
  return [...select.options].map((option,i)=>({option,index:i,value:option.value,
    label:(option.textContent||'').replace(/\s+/g,' ').trim(),
    search:option.dataset.search||'', disabled:option.disabled||Boolean(option.closest('optgroup')?.disabled)}));
}
function enhance(select){
 if(!(select instanceof HTMLSelectElement)||select.multiple||select.size>1||select.options.length<THRESHOLD||
   select.closest('[data-no-searchable-select],[data-no-combobox-v033],.maria-combo-v033'))return;
 const id=`maria-combo-options-v033-${++nextId}`;
 const wrap=document.createElement('div');wrap.className='maria-combo-v033';
 const shell=document.createElement('div');shell.className='maria-combo-shell-v033';
 const input=document.createElement('input');input.type='search';input.autocomplete='off';
 input.className='maria-combo-input-v033';input.placeholder='اكتب الاسم أو اضغط للاختيار';
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');
 input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-expanded','false');
 input.setAttribute('aria-controls',id);input.setAttribute('dir','rtl');
 input.setAttribute('aria-label',select.getAttribute('aria-label')||'بحث واختيار من القائمة');
 if(select.required)input.setAttribute('aria-required','true');
 const toggle=document.createElement('button');toggle.className='maria-combo-toggle-v033';
 toggle.type='button';toggle.textContent='⌄';toggle.setAttribute('aria-label','عرض الخيارات');
 const menu=document.createElement('div');menu.id=id;menu.className='maria-combo-menu-v033';menu.setAttribute('role','listbox');menu.hidden=true;
 select.parentNode.insertBefore(wrap,select);
 // Clicking an existing <label for=...> must focus the visible combobox.
 if(select.id){
  input.id=`${select.id}-combo-v033`;
  const label=select.closest('.field')?.querySelector('label');
  if(label?.htmlFor===select.id)label.htmlFor=input.id;
 }
 shell.append(input,toggle);wrap.append(shell,menu,select);
 select.classList.add('maria-combo-native-v033');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
 // Keep the native control in the DOM so existing required/name/value logic is intact.
 let opened=false,typing=false,active=0,shown=[];
 const originalSelectValue=()=>String(select.value||'');
 const chosenLabel=()=>[...select.options].find(o=>o.value===originalSelectValue())?.textContent?.trim()||'';
 const display=()=>{if(!typing)input.value=chosenLabel();};
 function close(reset=true){
  opened=false;menu.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
  if(reset){typing=false;display();}
  wrap.classList.remove('open');
 }
 const available=()=>entries(select).filter(e=>!e.disabled);
 function renderOptions(){
  const query=typing?input.value:'';
  shown=available().map(e=>({...e,score:staffSearchScoreV033(`${e.label} ${e.search}`,query)}))
   .filter(e=>e.score>=0).sort((a,b)=>b.score-a.score||collator.compare(a.label,b.label))
   .slice(0,70);
  active=Math.min(Math.max(0,active),Math.max(shown.length-1,0));
  menu.replaceChildren();
  if(!shown.length){const msg=document.createElement('div');msg.className='maria-combo-empty-v033';msg.textContent='لا توجد نتيجة. جرّب كلمة أخرى.';menu.append(msg);return;}
  shown.forEach((entry,i)=>{
   const item=document.createElement('button');item.type='button';item.className='maria-combo-option-v033';
   item.id=`${id}-item-${i}`;item.setAttribute('role','option');item.setAttribute('aria-selected',String(entry.value===originalSelectValue()));
   item.dataset.index=String(i);item.textContent=entry.label;
   if(i===active)item.classList.add('active');
   item.addEventListener('pointerdown',e=>e.preventDefault());
   item.addEventListener('click',()=>choose(i));
   menu.append(item);
  });
  input.setAttribute('aria-activedescendant',`${id}-item-${active}`);
 }
 function open(resetQuery=false){
  if(select.disabled)return;
  if(resetQuery){typing=false;display();}
  opened=true;menu.hidden=false;wrap.classList.add('open');input.setAttribute('aria-expanded','true');active=0;renderOptions();
 }
 function choose(index){
  const entry=shown[index];if(!entry||entry.disabled)return;
  const changed=originalSelectValue()!==entry.value;
  select.value=entry.value;
  close();
  if(changed)select.dispatchEvent(new Event('change',{bubbles:true}));
  input.focus();
 }
 input.addEventListener('focus',()=>{if(!opened)open();input.select();});
 input.addEventListener('click',()=>{if(!opened)open();});
 wrap.addEventListener('focusout',()=>{setTimeout(()=>{if(!wrap.contains(document.activeElement))close();},0);});
 // Typing is not a selection. Clear the native value until the user picks
 // a result, so a bonus can never be filed under a previously selected name.
 input.addEventListener('input',()=>{
  typing=true;select.value='';
  select.dispatchEvent(new Event('change',{bubbles:true}));
  typing=true;active=0;open();
 });
 toggle.addEventListener('click',()=>{if(opened){close();input.blur();}else{input.focus();open(true);}});
 input.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(opened){e.preventDefault();e.stopPropagation();close();}else input.blur();return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();if(!opened)open();else{
    active=shown.length?(active+(e.key==='ArrowDown'?1:-1)+shown.length)%shown.length:0;
    renderOptions();menu.querySelector('.active')?.scrollIntoView({block:'nearest'});
   }return;
  }
  if(e.key==='Enter'&&opened){e.preventDefault();e.stopPropagation();if(shown.length)choose(active);return;}
  if(e.key==='Tab')close();
 });
 select.addEventListener('change',()=>{if(typing)return;display();close();});
 select.addEventListener('invalid',()=>{input.setCustomValidity('');input.focus();});
 // Not a second visible input: the native select is accessible via its sibling.
 display();
 const instance={select,wrap,close,sync:()=>{if(!typing)display();if(opened)renderOptions();}};
 cache.set(select,instance);instances.add(instance);
}
export function installSearchableSelectsV033(root=document){
 const scan=()=>{
  for(const instance of instances)if(!instance.wrap.isConnected)instances.delete(instance);
  root.querySelectorAll('select').forEach(select=>{
   const instance=cache.get(select);
   if(instance){if(instance.wrap.isConnected)instance.sync();}else enhance(select);
  });
 };
 scan();
 if(!listenerAdded){
  document.addEventListener('pointerdown',event=>{
   for(const instance of instances)if(instance.wrap.isConnected&&!instance.wrap.contains(event.target))instance.close();
  },true);
  listenerAdded=true;
 }
 let queued=false;
 const observer=new MutationObserver(mutations=>{
  if(!mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&
   (n.matches?.('select')||n.querySelector?.('select')))))return;
  if(queued)return;queued=true;
  queueMicrotask(()=>{queued=false;scan();});
 });
 observer.observe(document.body,{subtree:true,childList:true});
 return ()=>observer.disconnect();
}
