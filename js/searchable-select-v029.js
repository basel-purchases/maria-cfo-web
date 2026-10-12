// Progressive enhancement: every long native SELECT remains the only submitted value.
// Search NEVER accepts arbitrary free text as a selected option. Works with RTL + keyboards.
const THRESHOLD=8;
const normalize=v=>String(v??'').normalize('NFKC').replace(/[\u064b-\u065f\u0670\u0640]/g,'')
 .replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').toLocaleLowerCase('ar').trim();
const sorter=new Intl.Collator('ar',{numeric:true,sensitivity:'base'});
const cache=new WeakMap();
const groups=select=>[...select.children].some(x=>x.tagName==='OPTGROUP');
function sortSelect(select){
 if(groups(select))return;
 const options=[...select.options];
 const fixed=options.filter(o=>!o.value||o.disabled||o.dataset.noSort==='true');
 const remaining=options.filter(o=>!fixed.includes(o)).sort((a,b)=>sorter.compare(a.textContent,b.textContent));
 const ordered=[...fixed,...remaining];
 if(ordered.every((o,i)=>o===options[i]))return;
 const value=select.value;
 select.replaceChildren(...ordered);
 select.value=value;
}
function enhance(select){
 if(!(select instanceof HTMLSelectElement)||select.multiple||select.size>1||select.closest('[data-no-searchable-select]'))return;
 if(select.options.length<THRESHOLD || select.dataset.searchableV029==='on')return;
 if(select.closest('.maria-searchable-select-v029'))return;
 const wrap=document.createElement('div');wrap.className='maria-searchable-select-v029';
 const input=document.createElement('input');input.type='search';input.autocomplete='off';
 input.className='maria-select-search-v029';input.placeholder='⌕ ابحث عن الاسم ثم اختر من القائمة';
 input.setAttribute('aria-label','بحث ضمن خيارات القائمة');input.setAttribute('dir','rtl');
 select.parentNode.insertBefore(wrap,select);wrap.append(input,select);
 select.dataset.searchableV029='on';
 const state={originalDisabled:new WeakMap()};cache.set(select,state);
 const remember=()=>[...select.options].forEach(o=>{
   if(!state.originalDisabled.has(o))state.originalDisabled.set(o,o.disabled);
 });
 function filter(){
  remember();const query=normalize(input.value);
  for(const option of select.options){
   const selected=option.value===select.value;
   const keep=!query || !option.value || selected || normalize(option.textContent).includes(query);
   option.hidden=!keep; option.disabled=state.originalDisabled.get(option)||!keep;
  }
  wrap.classList.toggle('maria-searching-v029',Boolean(query));
 }
 sortSelect(select);remember();
 input.addEventListener('input',filter);
 input.addEventListener('keydown',event=>{
  if(event.key==='Escape') { input.value='';filter();input.blur(); }
  if(event.key==='ArrowDown'){event.preventDefault();select.focus();}
  if(event.key==='Enter'){event.preventDefault();select.focus();}
 });
 select.addEventListener('change',()=>{if(input.value)filter();});
 wrap.addEventListener('focusout',e=>{
  if(!wrap.contains(e.relatedTarget)){input.value='';filter();}
 });
 filter();
}
export function installSearchableSelectsV029(root=document){
 const scan=()=>{
  root.querySelectorAll('select').forEach(s=>{
    if(s.dataset.searchableV029==='on'){
      // Allows a renderer to replace options while keeping the same select node.
      const state=cache.get(s);
      if(state && [...s.options].some(o=>!state.originalDisabled.has(o))){
        sortSelect(s);for(const o of s.options)if(!state.originalDisabled.has(o))state.originalDisabled.set(o,o.disabled);
      }
    }else enhance(s);
  });
 };
 scan();
 let queued=false;
 const observer=new MutationObserver(mutations=>{
  if(!mutations.some(m=>m.addedNodes.length||m.removedNodes.length))return;
  if(queued)return;queued=true;
  queueMicrotask(()=>{queued=false;scan();});
 });
 observer.observe(document.body,{subtree:true,childList:true});
 return ()=>observer.disconnect();
}
