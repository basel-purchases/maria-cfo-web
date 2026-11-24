// Display only Latin 0-9 across Arabic/localized app screens. Never alter server payloads.
const nonLatinNumerals = /[\u0660-\u0669\u06f0-\u06f9]/g;
const ignoredElements = new Set(['SCRIPT','STYLE','NOSCRIPT']);
export function latinDigitsV139(value) {
  return String(value??'').replace(nonLatinNumerals, ch => String(ch.charCodeAt(0) - (ch.charCodeAt(0)>=0x6f0 ? 0x6f0 : 0x660)));
}
export function installLatinDigitsV139(root=document.body) {
  if (!root || typeof MutationObserver==='undefined') return () => {};
  const attributes=['placeholder','title','aria-label'];
  function normalize(el) {
    if (el.nodeType===3) {
      const current=el.nodeValue, desired=latinDigitsV139(current);
      if(current!==desired)el.nodeValue=desired;
      return;
    }
    if(el.nodeType!==1 || ignoredElements.has(el.tagName))return;
    // We do not rewrite identifiers, data-attributes, hidden fields or IDs.
    for (const name of attributes) {
      const old=el.getAttribute(name);
      if(old!==null){const next=latinDigitsV139(old);if(old!==next)el.setAttribute(name,next);}
    }
    if ((el instanceof HTMLInputElement && !['hidden','password','email','file'].includes(el.type)) || el instanceof HTMLTextAreaElement) {
      const current=el.value;
      if(document.activeElement!==el && current!==latinDigitsV139(current))el.value=latinDigitsV139(current);
    }
    for (const child of el.childNodes)normalize(child);
  }
  normalize(root);
  const observer=new MutationObserver(records=>{
    for(const r of records){
      if(r.type==='characterData')normalize(r.target);
      else if(r.type==='attributes')normalize(r.target);
      else for(const n of r.addedNodes)normalize(n);
    }
  });
  observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:attributes});
  const normalizeInput=(event)=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) ||
      (input instanceof HTMLInputElement && ['password','email','hidden','file'].includes(input.type)))return;
    const previous=input.value, next=latinDigitsV139(previous);
    if(previous===next)return;
    const start=input.selectionStart, end=input.selectionEnd;
    input.value=next;
    try{if(start!==null && end!==null)input.setSelectionRange(start,end);}catch(_){/* numeric/date inputs disallow selection */}
  };
  root.addEventListener('input',normalizeInput,true);
  return ()=>{observer.disconnect();root.removeEventListener('input',normalizeInput,true);};
}
