// Purchase receipt OCR interpretation: suggestions only. Never fabricate quantity/price.
import {normalizeArabicNumbers,reviewedOcrItemCandidates} from './image-document-rules.js?v=1.0.6';
import {materialExactV106,materialKeyV106,materialSuggestionsV106} from './material-search-v106.js?v=1.0.6';
const AR=/[\u0621-\u064a]/;
const NOISE=/^(?:فاتورة|التاريخ|المطلوب|الهاتف|تلفون|موبايل|رقم|رقم الفاتورة|المجموع|الاجمالي|الإجمالي|الصافي|total|invoice|date|عنوان|السعر|العدد|نوع البضاعة|الكمية|الاجور|الملاحظة|البيان)/i;
const FOOTER=/(?:^|\s)(?:المجموع|الاجمالي|الإجمالي|الصافي|المبلغ النهائي|المجموع فقط|total|subtotal)(?:\s|:|$)/i;
const UNIT=/(?:كيلوغرام|كيلوجرام|كيلو|كغ|kg|غرام|جرام|غ|g|ليتر|لتر|ltr|l|مل|ml|كرتون|علبة|باكيت|قطعة|حبة|حبه|ربطة|صندوق|دزينة|دستة|طن|وحدة)/i;
const NUMBER='\\d+(?:[.,]\\d+)?';
function number(s){
 const v=Number(String(s||'').replace(/,/g,''));return Number.isFinite(v)&&v>0&&v<1e12?v:null;
}
const near=(a,b)=>Math.abs(a-b)<=Math.max(0.05,Math.abs(b)*.015);
const numericToken=s=>/^\d+(?:\.\d+)?$/.test(String(s).replace(/,/g,''));
function cleanText(text){return normalizeArabicNumbers(text).replace(/،/g,',').replace(/\u00a0/g,' ').replace(/\u066c/g,',');}
function getLines(text){return cleanText(text).split(/\r?\n/).map(l=>l.replace(/[|\t]/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean);}
export function receiptHeaderV106({supplier='',number:invoiceNumber='',items='',full=''}={},suppliers=[]){
 const lines=getLines(supplier||full).slice(0,supplier?12:14);
 let supplierName='';
 for(const known of suppliers||[]){
  const key=materialKeyV106(known.name);
  if(key.length>=4&&lines.some(line=>materialKeyV106(line).includes(key))){supplierName=known.name;break;}
 }
 if(!supplierName){
  const candidates=lines.filter(l=>AR.test(l)&&l.length>=5&&l.length<=95&&!NOISE.test(l)&&!FOOTER.test(l)
    &&(l.match(/[\u0621-\u064a]/g)||[]).length>=4&&!/\d{5,}/.test(l));
  // Only infer an unknown supplier from a dedicated selection or a strong business heading.
  if(supplier)candidates.length&&(supplierName=candidates[0]);
  else supplierName=candidates.find(l=>/^(?:شركة|مؤسسة|محلات|مؤسسات|مخزن|مستودع|معمل|عبد|مطعم)/.test(l))||'';
 }
 const numberLines=getLines(invoiceNumber||full).slice(0,invoiceNumber?15:25);
 let detectedNumber='';
 for(const line of numberLines){
  const explicit=line.match(/(?:رقم\s*(?:الفاتورة|الطلب|المستند)?|invoice\s*(?:no|number|#)?|no\.?|#)\s*[:#\-]?\s*(\d{2,10})/i);
  if(explicit){detectedNumber=explicit[1];break;}
 }
 if(!detectedNumber&&invoiceNumber){
  const standalone=numberLines.flatMap(l=>l.match(/\b\d{2,8}\b/g)||[])
    .filter(v=>v.length<=8);
  if(standalone.length===1)detectedNumber=standalone[0];
 }
 let invoiceTotal=null;
 const moneyLines=getLines(items||full);
 for(let i=moneyLines.length-1;i>=0;i--){
  const line=moneyLines[i];
  if(!FOOTER.test(line))continue;
  const match=line.match(/(?:\d[\d,.]*)/g);
  if(match?.length){invoiceTotal=number(match.at(-1));break;}
  if(i+1<moneyLines.length){
   const next=moneyLines[i+1].match(/^\s*(\d[\d,.]*)/);
   if(next){invoiceTotal=number(next[1]);break;}
  }
 }
 return {supplier:supplierName,number:detectedNumber,invoiceTotal};
}
function makeRow(name,qty,unitPrice,rawLine,extra={}){
 return {name,quantity:qty==null?'':String(qty),unit_price:unitPrice==null?'':String(unitPrice),
  discount:'0',unit_id:'',catalog_id:'',new_base_unit_id:'',raw_line:rawLine,...extra};
}
function tableRows(text,limit=80){
 const rows=[];
 for(const line of getLines(text)){
  if(rows.length>=limit)break;
  if(line.length>155||FOOTER.test(line)||NOISE.test(line)||!AR.test(line))continue;
  const tokens=line.replace(/[|؛:]/g,' ').split(/\s+/).filter(Boolean);
  const nums=tokens.map((value,index)=>({value:number(value),index})).filter(t=>t.value!==null&&numericToken(tokens[t.index]));
  if(nums.length<2||nums.length>5)continue;
  // Keep the material name as printed; do not treat all numbers as a product name.
  const name=tokens.filter((v,i)=>!nums.some(n=>n.index===i)&&!/^[0-9]+[.)-]$/.test(v)).join(' ').trim();
  if(!AR.test(name)||name.length<2||name.length>90)continue;
  const unit=name.match(UNIT)?.[0]||'';
  let qty=null,unitPrice=null,total=null,review='';
  if(nums.length>=3){
   const lastThree=nums.slice(-3).map(n=>n.value);
   // Prefer a mathematically verified (qty, price, line total) triple.
   const triples=[];
   for(let q=0;q<3;q++)for(let p=0;p<3;p++){
    if(q===p)continue;
    const t=3-q-p;
    if(t<0||t>2||t===q||t===p)continue;
    if(near(lastThree[q]*lastThree[p],lastThree[t]))triples.push({qty:lastThree[q],price:lastThree[p],total:lastThree[t]});
   }
   // Ties when quantity and price are equal: choose realistic smaller quantity first.
   if(triples.length){
    triples.sort((a,b)=>(a.qty<=100?0:1)-(b.qty<=100?0:1)||a.qty-b.qty);
    ({qty,price:unitPrice,total}=triples[0]);
   }else review='الكمية والسعر والإجمالي المستخرج لا تتطابق؛ أدخل الأرقام بعد مراجعة الصورة.';
  }else{
   // Exactly two numbers do NOT establish whether the second is a price or total.
   review='لم نستطع التمييز بثقة بين السعر والإجمالي؛ راجع الصورة وأدخل القيم.';
  }
  rows.push(makeRow(name,qty,unitPrice,line,{unit_text:unit,
   ...(total!==null?{ocr_line_total:String(total)}:{}),...(review?{review_note:review}:{})}));
 }
 return rows;
}
export function receiptItemsV106(text,materials=[],limit=80){
 const raw=String(text||'').trim();if(!raw)return [];
 const columnar=reviewedOcrItemCandidates(raw,materials,limit);
 // Trust the existing tested columnar parser when it found full triples.
 const verified=columnar.filter(x=>x.ocr_source==='column_aligned');
 let rows=verified.length?verified:tableRows(raw,limit);
 if(!rows.length){
  // The existing line parser supplies suggestions when quantity and price are explicit.
  rows=columnar.filter(x=>x.quantity&&x.unit_price).slice(0,limit);
 }
 return rows.map(row=>({...row,
  catalog_id:materialExactV106(row.name,materials)?.id||'',
  id:row.id||crypto.randomUUID(),
  review_note:row.review_note||'',
 }));
}
export function suggestSupplierMaterialsV106(query,materials,historyRows){
 return materialSuggestionsV106(query,materials,(historyRows||[]).map(x=>x.material_id));
}
export function receiptMathV106(doc){
 let sum=0,valid=true;
 for(const item of doc.items||[]){
  const qty=number(cleanText(item.quantity)),price=number(cleanText(item.unit_price));
  const discount=Number(cleanText(item.discount||0));
  if(qty===null||price===null||!Number.isFinite(discount)||discount<0){valid=false;continue;}
  sum+=qty*price-discount;
 }
 const expected=number(cleanText(doc.ocr_total));
 return {sum,valid,expected,discrepancy:expected!=null&&valid&&!near(sum,expected)};
}
