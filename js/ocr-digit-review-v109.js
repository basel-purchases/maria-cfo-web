// Maria CFO v1.0.9: safe digit-review helpers for handwritten receipts.
// OCR guesses are never a substitute for verifying a financial number in the photo.
import {invoiceAmountV107} from './invoice-amount-v107.js?v=1.0.10';
import {readHandwrittenAmountV110} from './ocr-numeric-v110.js?v=1.0.10';

const FOOTER=/المجموع|الاجمالي|الإجمالي|الصافي|رصيد|رصيد سابق|دفع|total|subtotal|balance|المطلوب/i;
const LABEL=/اسم العميل|اسم المورد|اسم المادة|الوصف|رقم الفاتورة|التاريخ|المورد/i;
const HAS_AR=/[\u0621-\u064A]/;
const isNumber=(v)=>readHandwrittenAmountV110(v).value!==null;
function parts(line){
 if(!line.includes('|'))return null;
 const result=line.split('|').map(v=>v.trim());
 if(!result[0])result.shift();
 if(!result.at(-1))result.pop();
 return result;
}
function stripName(value){return String(value||'').replace(/^[\s:;.,\-]+|[\s:;.,\-]+$/g,'').trim();}
function separator(cells){return cells.every(v=>/^:?-{2,}:?$/.test(v)||v==='');}
function candidate(label,raw,source='الأصل'){
 const text=String(raw??'').trim();
 const parsed=readHandwrittenAmountV110(text);
 return parsed.value!==null?{label,raw:text,value:parsed.value,source,
  ...(parsed.corrected?{note:parsed.note,zero_dot_suspected:true}:{} )}:null;
}

// An OCR.space Engine3 table may lack headings altogether: | amount | name | amount |.
// The amounts are visible, but their roles are NOT known. Do not guess a qty/price.
export function parseUnlabelledReceiptTableV109(text,limit=80){
 const lines=String(text||'').split(/\r?\n/);
 const rows=[];let wasTable=false;
 for(const line of lines){
  const cells=parts(line);if(!cells||cells.length<3)continue;
  if(separator(cells)){wasTable=true;continue;}
  const names=cells.map((c,i)=>({s:stripName(c),i})).filter(({s})=>HAS_AR.test(s)&&s.length>=2&&!FOOTER.test(s)&&!LABEL.test(s));
  if(names.length!==1)continue;
  const {s:name,i:nameIndex}=names[0];
  if(nameIndex===0||nameIndex===cells.length-1)continue;
  const amounts=cells.map((c,i)=>({i,c})).filter(({i,c})=>i!==nameIndex&&isNumber(c));
  // There must be at least one numeric column on each side of the name.
  if(!amounts.some(x=>x.i<nameIndex)||!amounts.some(x=>x.i>nameIndex))continue;
  if(amounts.length>4||name.length>140)continue;
  const numeric=amounts.map(x=>candidate(x.i<nameIndex?'العمود الأيسر':'العمود الأيمن',x.c)).filter(Boolean);
  rows.push({name,quantity:'',unit_price:'',discount:'0',unit_id:'',catalog_id:'',new_base_unit_id:'',
   raw_line:line,ocr_source:'unlabelled_columns',ocr_numeric_candidates:numeric,
   ocr_review_required:true,ocr_reviewed:false,
   review_note:''});
  if(rows.length>=limit)break;
 }
 return wasTable||rows.length?rows:[];
}

// Numeric-only re-reading may contain Markdown tables or simple lines. A row is
// aligned only when the provider yields exactly the same number of item lines.
export function parseDigitAuditRowsV109(text,limit=80){
 const rows=[];
 for(const raw of String(text||'').split(/\r?\n/)){
  const line=raw.trim();if(!line||FOOTER.test(line)||LABEL.test(line)||/^[-\s|:]+$/.test(line))continue;
  const cells=parts(line);
  if(cells){
   if(separator(cells))continue;
   const values=cells.map((c,i)=>candidate(`خانة ${i+1}`,c,'التدقيق')).filter(Boolean);
   if(values.length&&(values.length>=2||cells.length===1||cells.some(c=>HAS_AR.test(c))))rows.push({raw:line,candidates:values});
  }else{
   const tokens=line.replace(/[؛|]/g,' ').split(/\s+/).filter(Boolean);
   // Skip a line of a supplier name with digits (phone numbers/addresses).
   const values=tokens.map((t,i)=>candidate(`رقم ${i+1}`,t,'التدقيق')).filter(Boolean);
   if(values.length>=1&&values.length<=5&&(tokens.length===values.length||HAS_AR.test(line)))rows.push({raw:line,candidates:values});
  }
  if(rows.length>=limit)break;
 }
 return rows;
}
export function applyDigitAuditV109(items,auditText){
 const lines=parseDigitAuditRowsV109(auditText,100);
 const source=Array.isArray(items)?items:[];
 const aligned=!!source.length&&lines.length===source.length;
 if(!aligned)return {rows:source,rowCount:lines.length,matched:false};
 const rows=source.map((row,i)=>{
  const candidates=lines[i].candidates;
  const original=new Set([row.quantity,row.unit_price,row.ocr_line_total,...(row.ocr_numeric_candidates||[]).map(x=>x.raw)]
   .map(invoiceAmountV107).filter(x=>x!==null));
  const conflicting=candidates.some(x=>!original.has(x.value));
  const note=conflicting?'اختلف رقم أو أكثر بين القراءة الأولى وقراءة التدقيق؛ راجع الأشكال المكتوبة قبل الاختيار.':'نتيجة التدقيق لا تضمن صحة الرقم حتى عند تطابق القراءتين؛ راجع الصورة.';
  // Remove prior audit note to keep repeated audit operations idempotent.
  const oldNote=String(row.review_note||'').replace(/(?:اختلف رقم أو أكثر بين القراءة الأولى وقراءة التدقيق[^.]*\.|نتيجة التدقيق لا تضمن صحة الرقم[^.]*\.)/g,'').trim();
  return {...row,ocr_digit_candidates:candidates,ocr_digit_audit_raw:lines[i].raw,
   ocr_review_required:true,ocr_reviewed:false,
   review_note:[oldNote,note].filter(Boolean).join(' ')};
 });
 return {rows,rowCount:lines.length,matched:true};
}

// Keep stroke thickness and tiny Arabic-Indic zero (٠) dots. No thresholding,
// erosion or shape-based glyph substitution: ٢,٣,٥ are handwritten variably.
export function enhanceHandwritingPixelsV109(input,width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||input.length!==width*height*4)
  throw new Error('INVALID_HANDWRITING_IMAGE');
 const pixels=new Uint8ClampedArray(input.length);
 const gray=new Float32Array(width*height),sum=new Float64Array((width+1)*(height+1));
 for(let y=0;y<height;y++){
  let row=0;
  for(let x=0;x<width;x++){
   const i=y*width+x,k=i*4;
   const v=input[k]*.299+input[k+1]*.587+input[k+2]*.114;
   gray[i]=v;row+=v;
   sum[(y+1)*(width+1)+x+1]=sum[y*(width+1)+x+1]+row;
  }
 }
 const radius=Math.max(9,Math.min(34,Math.round(Math.min(width,height)/25)));
 for(let y=0;y<height;y++){
  const top=Math.max(0,y-radius),bottom=Math.min(height,y+radius+1);
  for(let x=0;x<width;x++){
   const left=Math.max(0,x-radius),right=Math.min(width,x+radius+1);
   const base=(sum[bottom*(width+1)+right]-sum[top*(width+1)+right]-sum[bottom*(width+1)+left]+sum[top*(width+1)+left])/((right-left)*(bottom-top));
   const i=y*width+x,k=i*4;
   const blue=Math.max(0,input[k+2]-(input[k]+input[k+1])*.5);
   const darker=Math.max(0,base-gray[i]);
   // Gentle local illumination removal, with a modest preference for blue ink.
   const ink=Math.min(215,Math.max(0,(darker-7)*2.35+blue*.62));
   const out=Math.round(252-ink);
   pixels[k]=out;pixels[k+1]=out;pixels[k+2]=out;pixels[k+3]=255;
  }
 }
 return pixels;
}
