// OCR and invoice editors accept Western (0-9), Arabic-Indic (٠-٩), and
// Eastern Arabic/Persian (۰-۹) digits. Never infer a missing financial value.
export function invoiceAmountV107(value){
 const raw=String(value??'').trim();
 if(!raw)return null;
 let s=raw.normalize('NFKC').replace(/[٠-٩۰-۹]/g,d=>{
  const code=d.charCodeAt(0);return String(code>=0x6f0?code-0x6f0:code-0x660);
 }).replace(/[\u200e\u200f\u061c\u00a0\u202f\s]/g,'').replace(/٫/g,'.').replace(/٬/g,',').replace(/،/g,',');
 if(!/^[+]?\d[\d.,]*$/.test(s))return null;
 s=s.replace(/^\+/,'');
 // 1,234.50 and 1.234,50 are both supported when two separators occur.
 if(s.includes('.')&&s.includes(',')){
  const decimalSeparator=s.lastIndexOf('.')>s.lastIndexOf(',')?'.':',';
  const grouping=decimalSeparator==='.'?',':'.';
  const parts=s.split(decimalSeparator);
  if(parts.length!==2||!parts[1]||!/^\d+$/.test(parts[1]))return null;
  const group=parts[0].split(grouping);
  if(group.length>1&&!/^[1-9]\d{0,2}$/.test(group[0]))return null;
  if(group.slice(1).some(part=>!/^\d{3}$/.test(part)))return null;
  s=group.join('')+'.'+parts[1];
 }else if(s.includes(',')){
  if(/^\d{1,3}(,\d{3})+$/.test(s))s=s.replace(/,/g,'');
  else if(/^\d+,\d{1,6}$/.test(s))s=s.replace(',','.');
  else return null;
 }else if((s.match(/\./g)||[]).length>1){
  if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  else return null;
 }
 if(!/^\d+(?:\.\d+)?$/.test(s))return null;
 const n=Number(s);
 return Number.isFinite(n)&&n>=0&&n<1e12?n:null;
}

export function amountNearV107(a,b){
 return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(.05,Math.abs(b)*.015);
}
