// Maria CFO v1.0.34 — purchase-first menu and signed Al-Ameen sales invoice archive.
// Pure parsing: the material price comes from supplier invoices, never from the menu workbook.
import {cleanName,excelTimestamp} from './ameen-import-parser.js?v=1.0.34';
const txt=v=>String(v??'').trim().replace(/\s+/g,' ');
const value=v=>v==null||txt(v)===''?null:(Number.isFinite(Number(v))?Number(v):null);
const headerMap=row=>new Map((row||[]).map((v,i)=>[cleanName(v),i]).filter(([k])=>k));
const col=(row,idx,key)=>row[idx.get(cleanName(key))];

export function parseMenuOnlyV134(workbook){
 const sheet=(workbook.sheets||[]).find(s=>cleanName(s.name)==='المنيو والوصفات');
 if(!sheet)throw Error('الملف يجب أن يحتوي على شيت «المنيو والوصفات».');
 // The original materials tab is retained as a complete catalog; purchase material
 // rows are informational and MUST NOT overwrite prior invoice quantities/prices.
 const catalogSheet=(workbook.sheets||[]).find(s=>cleanName(s.name)==='المواد');
 const materials=[],newMaterials=[],seenMaterials=new Set(),materialWarnings=[];
 if(catalogSheet){
  const mHead=catalogSheet.rows.findIndex(r=>{const h=headerMap(r);return h.has(cleanName('المادة'))&&h.has(cleanName('الوحدة'));});
  if(mHead<0)throw Error('شيت المواد: عناوين المادة والوحدة غير موجودة.');
  const mc=headerMap(catalogSheet.rows[mHead]);
  for(let i=mHead+1;i<catalogSheet.rows.length;i++){
   const row=catalogSheet.rows[i]||[],name=txt(col(row,mc,'المادة'));
   if(!name)continue;
   const k=cleanName(name);if(seenMaterials.has(k))throw Error(`شيت المواد: اسم مكرر في السطر ${i+1} (${name}).`);
   seenMaterials.add(k);
   const unit=txt(col(row,mc,'الوحدة'));
   const source=txt(col(row,mc,'مصدر المادة'))||'فواتير الشراء';
   const stockRaw=col(row,mc,'الرصيد الموجود');
   const purchasePrice=col(row,mc,'آخر سعر شراء للوحدة');
   if(purchasePrice!=null&&txt(purchasePrice)!=='')throw Error(`شيت المواد: لا تضع أسعار شراء (${name})؛ الأسعار تأتي من الفواتير.`);
   const record={name,unit,source,stock:stockRaw==null||txt(stockRaw)===''?null:value(stockRaw)};
   if(source!=='فواتير الشراء'){
    if(!unit||record.stock!==0)throw Error(`شيت المواد: المادة الجديدة «${name}» تحتاج وحدة ورصيدًا صفرًا.`);
    newMaterials.push({name,unit,source,stock:0});
   }else if(!unit)materialWarnings.push(`اسم الشراء «${name}» دون وحدة في فواتير الأمين؛ راجع وحدة الفاتورة الأصلية.`);
   materials.push(record);
  }
 }
 const h=sheet.rows.findIndex(r=>{const a=headerMap(r);return a.has(cleanName('اسم الوجبة'))&&a.has(cleanName('سعر البيع'));});
 if(h<0)throw Error('عناوين المنيو المطلوبة: اسم الوجبة، سعر البيع.');
 const cols=headerMap(sheet.rows[h]);
 const simple=cols.has(cleanName('اسم المادة'));
 const matCol=simple?cols.get(cleanName('اسم المادة')):cols.get(cleanName('اختر المادة ▼'));
 const qtyCol=cols.get(cleanName('الكمية'));
 const unitCol=cols.get(cleanName('الوحدة'));
 const stCol=simple?cols.get(cleanName('حالة الوصفة')):cols.get(cleanName('الحالة'));
 const noteCol=simple?cols.get(cleanName('ملاحظات المصدر')):cols.get(cleanName('ملاحظة'));
 const srcCol=cols.get(cleanName('مصدر الوصفة'));
 const typeCol=cols.get(cleanName('نوع البيانات'));
 const codeCol=cols.get(cleanName('كود المادة'));
 if(matCol==null||qtyCol==null||unitCol==null)throw Error('المنيو: أعمدة اسم المادة والكمية والوحدة مطلوبة.');
 const dishes=[],warnings=[...materialWarnings],seen=new Set();let current=null,estimated=0,ingredientLines=0,unknown=0;
 for(let i=h+1;i<sheet.rows.length;i++){
  const r=sheet.rows[i]||[];
  const name=txt(col(r,cols,'اسم الوجبة'));
  if(name){
   const k=cleanName(name);if(seen.has(k))throw Error(`المنيو السطر ${i+1}: وجبة مكررة «${name}».`);
   seen.add(k);
   const price=value(col(r,cols,'سعر البيع'));
   if(price!=null&&price<0)throw Error(`المنيو السطر ${i+1}: سعر بيع سالب.`);
   current={name,salePrice:price>0?price:null,status:txt(r[stCol])||'بانتظار اعتماد الوصفة',lines:[]};
   dishes.push(current);
   if(current.salePrice==null)warnings.push(`الوجبة «${name}» دون سعر بيع؛ يمكن إكمال الوصفة لكن Food Cost يبقى غير معروف.`);
  }
  if(!current)continue;
  const mat=txt(r[matCol]);const rawQty=r[qtyCol];const unit=txt(r[unitCol]);const note=txt(r[noteCol]);
  if(!mat&&!unit&&(rawQty==null||txt(rawQty)===''))continue;
  const qty=value(rawQty);
  if(!mat||!(qty>0)||!unit){
   current.status='بانتظار اعتماد الوصفة';unknown++;
   warnings.push(`سطر ${i+1} (${current.name}): اسم/كمية/وحدة مكوّن ناقصة.`);
   continue;
  }
  if(catalogSheet&&!seenMaterials.has(cleanName(mat)))throw Error(`المكون «${mat}» غير موجود في شيت المواد؛ لا يمكن إسقاطه أو تخمين البديل.`);
  current.lines.push({materialName:mat,quantity:qty,unit,note,
   source:srcCol==null?'':txt(r[srcCol]),sourceType:typeCol==null?'':txt(r[typeCol]),
   sourceMaterialCode:codeCol==null?'':txt(r[codeCol])});ingredientLines++;
  if(/تقديري|افتراض/.test(note)){estimated++;current.status='بانتظار اعتماد الوصفة';}
 }
 if(!dishes.length)throw Error('لم يتم العثور على وجبات في ملف المنيو.');
 const pending=dishes.filter(d=>d.status!=='منتهي'||!d.lines.length).length;
 return {dishes,materials,newMaterials,warnings,stats:{menu:dishes.length,lines:ingredientLines,estimatedLines:estimated,malformedLines:unknown,
  readyRecipes:dishes.length-pending,pendingRecipes:pending,materialsFromWorkbook:materials.length,
  catalogOnlyCreatedOnImport:newMaterials.length,materialPricesFromWorkbook:0,
  skippedOtherSheets:workbook.sheets.length-(catalogSheet?2:1)}};
}

export function parseSalesArchiveV134(workbook){
 const required=['التاريخ','الفاتورة','اسم المادة','الكمية','الوحدة','السعر','صافي القيمة'];
 let sh=null,head=-1,cols;
 for(const s of workbook.sheets||[]){
  const i=s.rows.findIndex(r=>{const m=headerMap(r);return required.every(c=>m.has(cleanName(c)));});
  if(i>=0){sh=s;head=i;cols=headerMap(s.rows[i]);break;}
 }
 if(!sh)throw Error('ملف المبيع ليس تقرير تفاصيل فواتير الأمين: الأعمدة المطلوبة غير موجودة.');
 // Optional approved mapping sheet made from the original Al-Ameen sale names.
 // Unapproved suggestions NEVER bind a sale line to a meal automatically.
 const mapping=new Map(),approvalAliases=[];
 for(const sheet of workbook.sheets||[]){
  const ix=sheet.rows.findIndex(r=>{const h=headerMap(r);return h.has(cleanName('اسم المبيع في الأمين'))&&h.has(cleanName('اسم الوجبة في المنيو'))&&h.has(cleanName('حالة المطابقة'));});
  if(ix<0)continue;
  const headers=headerMap(sheet.rows[ix]);
  for(const r of sheet.rows.slice(ix+1)){
   const sourceName=txt(col(r,headers,'اسم المبيع في الأمين'));
   const menuName=txt(col(r,headers,'اسم الوجبة في المنيو'));
   const status=txt(col(r,headers,'حالة المطابقة'));
   if(!sourceName||status!=='معتمد'||!menuName)continue;
   const k=cleanName(sourceName);
   if(mapping.has(k)&&mapping.get(k).menuName!==menuName)throw Error(`اسم مبيع له أكثر من مطابقة معتمدة: ${sourceName}`);
   const aliasApproved=txt(col(r,headers,'إضافة كاسم ثانوي'))==='نعم';
   mapping.set(k,{sourceName,menuName,aliasApproved});
  }
 }
 for(const item of mapping.values())if(item.aliasApproved)approvalAliases.push({sourceName:item.sourceName,menuName:item.menuName});
 const docs=new Map();const warnings=[];let rows=0,negative=0,zeros=0,positive=0,matchedLines=0;
 for(let i=head+1;i<sh.rows.length;i++){
  const r=sh.rows[i]||[];
  const name=txt(col(r,cols,'اسم المادة'));if(!name)continue;
  const number=txt(col(r,cols,'الفاتورة'));
  if(!/^مبيع/.test(number))throw Error(`السطر ${i+1}: الفاتورة ليست مبيعًا (${number})`);
  const occurredAt=excelTimestamp(col(r,cols,'التاريخ'));
  const quantity=value(col(r,cols,'الكمية'));
  const unitPrice=value(col(r,cols,'السعر'));
  const net=value(col(r,cols,'صافي القيمة'));
  if(!occurredAt||quantity==null||!(unitPrice>=0)||net==null)throw Error(`سطر المبيع ${i+1}: تاريخ/كمية/سعر/صافي غير صالح.`);
  const k=number+'|'+occurredAt;
  if(!docs.has(k))docs.set(k,{number,occurredAt,customer:txt(col(r,cols,'اسم الزبون')),lines:[]});
  const link=mapping.get(cleanName(name));if(link)matchedLines++;
  docs.get(k).lines.push({name,unit:txt(col(r,cols,'الوحدة')),quantity,unitPrice,net,
   menuName:link?.menuName||'',
   discount:value(col(r,cols,'مجموع الحسم'))??0,additions:value(col(r,cols,'مجموع الإضافات'))??0,sourceRow:i+1});
  rows++;if(quantity<0)negative++;else if(quantity===0)zeros++;else positive++;
 }
 if(!docs.size)throw Error('تقرير المبيع لا يحتوي فواتير صالحة.');
 const records=[...docs.values()].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.number.localeCompare(b.number));
 if(records.some(d=>d.lines.length>1000))throw Error('فاتورة مبيع واحدة تحتوي أكثر من 1000 بند؛ يلزم تقسيمها ومراجعتها.');
 if(positive)warnings.push(`${positive} أسطر بكمية موجبة: لا يتم عكس الإشارة تلقائيًا؛ تحفظ كما وردت.`);
 if(zeros)warnings.push(`${zeros} أسطر بكمية صفرية، تُحفظ للأرشيف دون استهلاك.`);
 const mappedNames=new Set([...mapping.values()].map(x=>cleanName(x.sourceName)));
 const allNames=new Set(records.flatMap(d=>d.lines.map(l=>cleanName(l.name))));
 return {records,warnings,approvalAliases,stats:{invoices:records.length,lines:rows,negativeQty:negative,zeroQty:zeros,
  approvedNameMappings:mappedNames.size,unresolvedNameMappings:[...allNames].filter(k=>!mappedNames.has(k)).length,
  mappedLinesInSource:matchedLines,
  positiveQty:positive,currency:'SYP',cashboxPaymentsCreated:0,stockMovementsCreated:0}};
}

// The operator's original inventory count has the five headings:
// «المادة، الكمية، الواحدة، ملاحظات، التاريخ» (not the newer section-based template).
// Duplicate same-name/day rows are excluded from posting until the accountant defines
// whether the packages differ, to avoid creating false material balances.
export function parseOriginalCountV134(workbook){
 const required=['المادة','الكمية','الواحدة','التاريخ'];
 let sheet=null,head=-1,cols;
 for(const sh of workbook.sheets||[]){
  const ix=sh.rows.findIndex(r=>{const m=headerMap(r);return required.every(x=>m.has(cleanName(x)));});
  if(ix>=0){sheet=sh;head=ix;cols=headerMap(sh.rows[ix]);break;}
 }
 if(!sheet)return null;
 const source=[],issues=[];
 for(let i=head+1;i<sheet.rows.length;i++){
  const r=sheet.rows[i]||[];const name=txt(col(r,cols,'المادة'));if(!name)continue;
  const quantity=value(col(r,cols,'الكمية'));const unit=txt(col(r,cols,'الواحدة'));
  const rawDate=txt(col(r,cols,'التاريخ'));
  let date=null;
  let m=rawDate.match(/^(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if(m)date=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  else{
   m=rawDate.match(/^(\d{1,2})[-\\\/.](\d{1,2})[-\\\/.](20\d{2})/);
   if(m)date=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  if(!date&&typeof col(r,cols,'التاريخ')==='number'){
   const n=col(r,cols,'التاريخ');date=new Date((Math.floor(n)-25569)*86400000).toISOString().slice(0,10);
  }
  const notes=txt(col(r,cols,'ملاحظات'));
  source.push({name,quantity,unit,date,note:notes,department:'',sourceRow:i+1});
 }
 const same=new Map();for(const c of source){const k=cleanName(c.name)+'|'+c.date;same.set(k,(same.get(k)||0)+1);}
 const records=[];let missing=0,duplicates=0;
 for(const r of source){
  if(same.get(cleanName(r.name)+'|'+r.date)>1){duplicates++;issues.push(`الجرد، السطر ${r.sourceRow}: «${r.name}» مكرر بالتاريخ نفسه؛ لا يُرحّل قبل مراجعة الوحدة.`);continue;}
  if(!(r.quantity>=0)&&r.quantity!=null){missing++;issues.push(`الجرد، السطر ${r.sourceRow}: كمية سالبة غير صالحة.`);continue;}
  if(r.quantity==null||!r.unit||!r.date){missing++;issues.push(`الجرد، السطر ${r.sourceRow}: كمية/وحدة/تاريخ غير مكتمل؛ لن يُرحّل.`);continue;}
  records.push({name:r.name,quantity:r.quantity,unit:r.unit,date:r.date,department:'',note:r.note});
 }
 return {records,catalog:[],issues,stats:{sections:1,approved:records.length,empty:missing,review:duplicates,
  categorizedCandidates:0,sourceRows:source.length,requiresNameApproval:Boolean(missing||duplicates)}};
}
