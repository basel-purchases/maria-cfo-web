// Purchase receipt OCR interpretation: suggestions only. Never fabricate quantity/price.
import {normalizeArabicNumbers,reviewedOcrItemCandidates} from './image-document-rules.js?v=1.0.7';
import {materialExactV106,materialKeyV106,materialSuggestionsV106} from './material-search-v106.js?v=1.0.10';
import {invoiceAmountV107,amountNearV107,invoiceDigitWarningV108} from './invoice-amount-v107.js?v=1.0.10';
import {parseUnlabelledReceiptTableV109} from './ocr-digit-review-v109.js?v=1.0.10';
import {readHandwrittenAmountV110} from './ocr-numeric-v110.js?v=1.0.10';
const AR=/[\u0621-\u064a]/;
const NOISE=/^(?:فاتورة|التاريخ|المطلوب|الهاتف|تلفون|موبايل|رقم|رقم الفاتورة|المجموع|الاجمالي|الإجمالي|الصافي|total|invoice|date|عنوان|السعر|العدد|نوع البضاعة|الكمية|الاجور|الملاحظة|البيان)/i;
const FOOTER=/(?:^|\s)(?:المجموع|مجموع\s*الكمية|الاجمالي|الإجمالي|الصافي|الرصيد\s*السابق|الصافي\s*للدفع|المبلغ النهائي|المجموع فقط|total|subtotal|balance)(?:\s|:|$)/i;
const UNIT=/(?:كيلوغرام|كيلوجرام|كيلو|كغ|kg|غرام|جرام|غ|g|ليتر|لتر|ltr|l|مل|ml|كرتون|علبة|باكيت|قطعة|حبة|حبه|ربطة|صندوق|دزينة|دستة|طن|وحدة)/i;
function number(s){const v=readHandwrittenAmountV110(s).value;return v!==null&&v>0?v:null;}
const near=amountNearV107;
const numericToken=s=>invoiceAmountV107(s)!==null;
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
    &&!/^(?:اسم\s*(?:المورد|العميل|الزبون)|العميل|زبون|اسم\s*المشتري)(?:\s|:|$)/.test(l)
    &&(l.match(/[\u0621-\u064a]/g)||[]).length>=4&&!/\d{5,}/.test(l));
  // Only infer an unknown supplier from a dedicated selection or a strong business heading.
  if(supplier)candidates.length&&(supplierName=candidates[0]);
  else supplierName=candidates.find(l=>/^(?:شركة|مؤسسة|محلات|مؤسسات|مخزن|مستودع|معمل|عبد|مطعم)/.test(l))||'';
 }
 const numberLines=getLines(invoiceNumber||full).slice(0,invoiceNumber?15:25);
 let detectedNumber='';
 for(let i=0;i<numberLines.length;i++){
  const line=numberLines[i];
  const heading=line.match(/(?:رقم\s*(?:الفاتورة|الطلب|المستند)?|invoice\s*(?:no|number|#)?|no\.?|#)\s*[:#-]?\s*/i);
  if(!heading)continue;
  const sameLine=line.slice(heading.index+heading[0].length).match(/\d{1,10}(?:[_/-]\d{1,10})*/);
  const nextLine=numberLines[i+1]?.match(/^\s*[.#-]?\s*(\d{1,10}(?:[_/-]\d{1,10})*)\s*$/);
  if(sameLine||nextLine){detectedNumber=sameLine?.[0]||nextLine[1];break;}
 }
 if(!detectedNumber&&invoiceNumber){
  const standalone=numberLines.flatMap(l=>l.match(/\d{1,10}(?:[_/-]\d{1,10})*/g)||[])
    .filter(v=>v.length>=2);
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
// OCR.space Engine 3 can return a real Markdown table. Keep column boundaries:
// dropping pipes made the v1.0.6 parser confuse row numbers, quantities, and prices.
const TABLE_WEIGHT=/كيلو|كيلوغ|كغ|وزن|صافي|kg|gram|غرام|جرام|^غ$/i;
const TABLE_PIECES=/عدد|حبات|قطع|كمية|quantity|pieces|qty|count/i;
function tableHeaderLabel(s){
 return materialKeyV106(s).replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
}
function tableCells(line){
 if(!line.includes('|'))return null;
 const cells=line.split('|').map(v=>v.trim());
 if(!cells[0])cells.shift();
 if(!cells.at(-1))cells.pop();
 return cells;
}
function markdownHeader(cells){
 if(!cells||cells.length<3)return null;
 const labels=cells.map(tableHeaderLabel);
 const lookup=regex=>labels.findIndex(s=>regex.test(s));
 const name=lookup(/نوع\s*البضاع|اسم\s*(?:الماد|الصنف|المنتج)|الماد|الصنف|البيان|الوجبة|المنتج|الوصف|description|item|product/);
 const price=lookup(/سعر\s*(?:الوحد|الماد)?|price/);
 const total=lookup(/اجمال|قيم|مبلغ|total|amount/);
 const count=lookup(/^(?:العدد|عدد|الكميه|كمية|الكمية|quantity|qty|count|حبات|قطع)/);
 const weight=lookup(/كيلو|كغ|صافي|وزن|weight|net/);
 // Some POS receipts print an item description inside the column headed
 // "الكمية". Permit that layout only with explicit price AND total headings;
 // later rows still require an actual product description.
 if(name<0&&(count<0||price<0||total<0))return null;
 if(name>=0&&price<0)return null;
 if(name>=0&&count<0&&weight<0&&total<0)return null;
 // Do not interpret a loose, unlabelled series of numbers as a purchase row.
 return {name,price,total,count,weight,labels};
}
function weightUnit(header){
 if(header.includes('غرام')||header.includes('جرام'))return 'غرام';
 return 'كغ';
}
function baseIsWeight(material,units){
 if(!material)return null;
 const base=(units||[]).find(u=>String(u.id)===String(material.base_unit_id));
 if(!base)return null;
 return TABLE_WEIGHT.test(String(base.name||'')+' '+String(base.code||''));
}
function markdownTableRows(text,materials,limit,units){
 // Preserve the original Unicode digit glyphs for OCR ambiguity warnings.
 // invoiceAmountV107 converts Arabic-Indic, Persian and Western digits safely.
 const lines=String(text??'').split(/\r?\n/);
 const rows=[];let header=null,seenTable=false;
 for(const rawLine of lines){
  if(rows.length>=limit)break;
  const cells=tableCells(rawLine);
  if(!cells){if(header&&rawLine.trim())header=null;continue;}
  if(cells.every(x=>/^:?-{2,}:?$/.test(x)))continue;
  const detected=markdownHeader(cells);
  if(detected){header=detected;seenTable=true;continue;}
  if(!header)continue;
  if(cells.length<=header.price||header.name>=0&&cells.length<=header.name)continue;
  // Never read a packaging count such as "48 قطعة" inside an item description
  // as the purchased quantity. Preserve it in the editable product name.
  const descriptiveCount=header.name<0&&header.count>=0&&AR.test(String(cells[header.count]||''));
  const nameIndex=header.name>=0?header.name:descriptiveCount?header.count:-1;
  if(nameIndex<0)continue;
  const name=String(cells[nameIndex]||'').replace(/^[\s:;.,-]+|[\s:;.,-]+$/g,'').trim();
  if(!AR.test(name)||name.length<2||name.length>120||FOOTER.test(name))continue;
  if(/^(?:اسم\s*العميل|زبون|الرصيد\s*السابق|القيمة|الكمية|السعر)(?:\s|$)/.test(name))continue;
  const qtyCount=header.count<0||descriptiveCount?null:number(cells[header.count]);
  const qtyWeight=header.weight<0?null:number(cells[header.weight]);
  const price=number(cells[header.price]);
  const total=header.total<0?null:number(cells[header.total]);
  if(qtyCount===null&&qtyWeight===null&&price===null&&total===null)continue;
  const material=materialExactV106(name,materials);
  const weighted=baseIsWeight(material,units);
  const candidates=[
   ...(qtyWeight!==null?[{qty:qtyWeight,source:'weight',unit:weightUnit(header.labels[header.weight])}]:[]),
   ...(qtyCount!==null?[{qty:qtyCount,source:'count',unit:''}]:[]),
  ];
  let chosen=null;
  if(price!==null&&total!==null){
   const verified=candidates.filter(c=>near(c.qty*price,total));
   if(verified.length===1)chosen=verified[0];
   else if(verified.length>1)chosen=weighted===false?verified.find(x=>x.source==='count')||verified[0]:verified.find(x=>x.source==='weight')||verified[0];
  }
  if(!chosen){
   if(weighted===false)chosen=candidates.find(c=>c.source==='count')||candidates[0];
   else chosen=candidates.find(c=>c.source==='weight')||candidates[0];
  }
  let qty=chosen?.qty??null;
  let inferred=false;
  if(qty===null&&price!==null&&total!==null&&price>0&&total>0){
   const ratio=total/price;
   // A mathematical proposal, not an OCR reading. The user MUST confirm it
   // against the photo before any invoice posting.
   if(Number.isFinite(ratio)&&ratio>0&&ratio<=100000&&near(ratio*price,total)){
    qty=Number(ratio.toPrecision(10));inferred=true;
   }
  }
  const mathOK=qty!==null&&price!==null&&total!==null&&near(qty*price,total);
  const isPackDescription=inferred&&/\d+\s*(?:قطعة|قطع|حبة|حبات|علبة|علب|كرتون|عبوة|pack|pieces|pcs)/i.test(name);
  const missingWeight=header.weight>=0&&weighted!==false&&qtyWeight===null&&chosen?.source==='count';
  const unitUnresolved=missingWeight||isPackDescription;
  const notes=[];
  for(const token of [cells[header.price],header.count>=0?cells[header.count]:null,header.weight>=0?cells[header.weight]:null,header.total>=0?cells[header.total]:null]){
   const r=readHandwrittenAmountV110(token);if(r.corrected)notes.push(r.note);
  }
  if(!price)notes.push('سعر الوحدة غير واضح؛ راجعه في الصورة.');
  if(qty===null)notes.push('الكمية غير واضحة؛ راجع الصورة.');
  if(qtyCount!==null&&qtyWeight!==null&&qtyCount!==qtyWeight&&!mathOK)
   notes.push(`ورد العدد ${qtyCount} والوزن ${qtyWeight}؛ تم اقتراح ${chosen?.source==='weight'?'الوزن الصافي':'العدد'} ككمية، تحقق من الوحدة.`);
  if(total!==null&&qty!==null&&price!==null&&!mathOK)
   notes.push(`إجمالي البند المقروء (${total}) لا يساوي الكمية × السعر (${Number((qty*price).toFixed(6))}). راجع الصورة.`);
  if(total===null)notes.push('إجمالي البند غير واضح؛ راجع الصورة.');
  const digitWarning=invoiceDigitWarningV108(cells.join(' '));
  if(digitWarning)notes.push(digitWarning);
  if(missingWeight)notes.push('لم يُقرأ وزن صافٍ صالح؛ استُخدم العدد مؤقتًا ويجب تحديد وحدة الشراء يدويًا.');
  const reviewRequired=notes.length>0;
  rows.push(makeRow(name,qty,price,rawLine,{
   unit_text:chosen?.unit||'',
   ...(total!==null?{ocr_line_total:String(total)}:{}),
   ocr_source:'markdown_columns',
   ocr_quantity_inferred:inferred,
   ocr_review_required:reviewRequired,
   ocr_reviewed:false,
   ocr_unit_unresolved:unitUnresolved,
   ...(notes.length?{review_note:notes.join(' ')}:{}),
  }));
 }
 return seenTable?rows:[];
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
export function receiptItemsV106(text,materials=[],limit=80,units=[]){
 const raw=String(text||'').trim();if(!raw)return [];
 const markdown=markdownTableRows(raw,materials,limit,units);
 const unlabeled=markdown.length?[]:parseUnlabelledReceiptTableV109(raw,limit);
 const columnar=markdown.length||unlabeled.length?[]:reviewedOcrItemCandidates(raw,materials,limit);
 // Read explicitly labelled Markdown cells first, otherwise preserve the v1.0.6 fallbacks.
 const verified=columnar.filter(x=>x.ocr_source==='column_aligned');
 let rows=markdown.length?markdown:unlabeled.length?unlabeled:verified.length?verified:tableRows(raw,limit);
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
  const qty=number(item.quantity),price=number(item.unit_price);
  const discount=invoiceAmountV107(item.discount??'0');
  if(qty===null||price===null||!Number.isFinite(discount)||discount<0){valid=false;continue;}
  sum+=qty*price-discount;
 }
 const expected=number(doc.ocr_total);
 return {sum,valid,expected,discrepancy:expected!=null&&valid&&!near(sum,expected)};
}
