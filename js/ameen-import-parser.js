// Maria CFO v0.24: deterministic, client-only parser for the exact Al-Ameen report headers.
// Does not publish financial entries. Each parsed document is reviewed before a server-side atomic RPC.
export const AMEEN_TYPES=Object.freeze({inventory:'جرد المواد',orders:'حركة الطلبات',suppliers:'كشف حساب زبون'});
export const MAX_IMPORT_BYTES=12*1024*1024;
const headers={
 inventory:['اسم المادة','الوحدة الأولى','الكمية','السعر','المستودع'],
 orders:['رقم الطلب','التاريخ','صافي الطلب','اسم المادة','الكمية','السعر','صافي القلم'],
 suppliers:['الحساب','الرصيد السابق','الرصيد الحالي','اسم الزبون','التاريخ','أصل السند','البيان'],
};
const text=v=>String(v??'').replace(/[\u200c-\u200f\u202a-\u202e]/g,'').trim().replace(/\s+/g,' ');
export function cleanName(v){return text(v).replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').toLocaleLowerCase('ar');}
const num=(value,fallback=null)=>{
 if(value===null||value===undefined||text(value)==='')return fallback;
 if(typeof value==='number')return Number.isFinite(value)?value:fallback;
 const n=Number(String(value).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٬,\s]/g,'').replace(/٫/g,'.'));
 return Number.isFinite(n)?n:fallback;
};
const round=(v,p=6)=>Math.round((v+Number.EPSILON)*10**p)/10**p;
const safeText=(v,size=250)=>text(v).slice(0,size);
export function excelTimestamp(value){
 if(value===null||value===undefined||value==='')return null;
 if(value instanceof Date)return value.toISOString();
 if(typeof value==='number'&&Number.isFinite(value)){
   // Excel day zero is 1899-12-30; naive local timestamp in Syria, fixed UTC+3.
   const milliseconds=Math.round((value-25569)*86400000)-3*3600000;
   const d=new Date(milliseconds);return Number.isNaN(d.valueOf())?null:d.toISOString();
 }
 const source=text(value);
 const match=source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/);
 if(match){
   const iso=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}T${(match[4]||'12').padStart(2,'0')}:${match[5]||'00'}:${match[6]||'00'}+03:00`;
   const d=new Date(iso);return Number.isNaN(d.valueOf())?null:d.toISOString();
 }
 const d=new Date(source);return Number.isNaN(d.valueOf())?null:d.toISOString();
}
export function matchReportType(headersRow=[]){
 const names=new Set(headersRow.map(cleanName));
 for(const [kind,required] of Object.entries(headers)){
  if(required.every(x=>names.has(cleanName(x))))return kind;
 }
 return null;
}
function indexRow(row){const m=new Map();row.forEach((v,i)=>{const s=cleanName(v);if(s&&!m.has(s))m.set(s,i);});return m;}
function from(row,header,name){const i=header.get(cleanName(name));return i==null?null:row[i];}
const ROOTS=new Map([['المنيو جديد','menu'],['المواد الأولية','material'],['مواد تجهيزات','asset']].map(([k,v])=>[cleanName(k),v]));
function warning(arr,line,message){arr.push({row:line,message});}
function parseInventory(rows,at,errors){
 let kind=null,category='',seen=0;const map=new Map();let groups=0,ignored=0;
 for(let i=at+1;i<rows.length;i++){
  const r=rows[i],name=safeText(from(r,rows.__header,'اسم المادة'));
  if(!name)continue;
  const section=ROOTS.get(cleanName(name));
  if(section){kind=section;category='';groups++;continue;}
  const unit=safeText(from(r,rows.__header,'الوحدة الأولى'),90);
  const warehouse=safeText(from(r,rows.__header,'المستودع'),130);
  const q=num(from(r,rows.__header,'الكمية'),0),price=num(from(r,rows.__header,'السعر'));
  const grouped=!unit&&!warehouse; // aggregate section rows have no unit or warehouse
  if(grouped){category=name;groups++;continue;}
  if(!kind){warning(errors,i+1,`لم نحدد قسم الصنف «${name}»`);ignored++;continue;}
  if(q==null||!Number.isFinite(q)){warning(errors,i+1,'كمية غير صالحة');ignored++;continue;}
  const qty2=num(from(r,rows.__header,'كمية 2'));
  const u2=safeText(from(r,rows.__header,'الوحدة الثانية'),90);
  const id=[kind,cleanName(name),cleanName(warehouse),cleanName(unit)].join('|');
  if(map.has(id)){
   const old=map.get(id);
   old.quantity=round(old.quantity+q,7);
   old.sourceRows.push(i+1);
   if(price!=null&&price>0&&old.price!=null&&old.price>0&&Math.abs(old.price-price)>0.001)warning(errors,i+1,`السعر مختلف لنفس الصنف «${name}»؛ يرجى المراجعة`);
   if(price!=null&&price>0)old.price=round(price,4);
   seen++;continue;
  }
  const record={key:id,kind,name,category,warehouse,unit:unit||'قطعة',quantity:round(q,7),unit2:u2||null,quantity2:qty2,price:price!=null?round(price,4):null,serial:safeText(from(r,rows.__header,'الرقم التسلسلي'),90),sourceRows:[i+1]};
  if(!unit)warning(errors,i+1,`وحدة غير مذكورة للصنف «${name}»؛ استُخدمت قطعة مبدئيًا وتحتاج مراجعة`);
  if(q<0)warning(errors,i+1,`كمية سالبة للصنف «${name}»: لن تُرحّل إلى المخزون المالي تلقائيًا`);
  if(kind==='asset'&&q%1!==0)warning(errors,i+1,`كمية أساسية كسرية «${name}»؛ سيُحتفظ بها كعدد عشري`);
  map.set(id,record);seen++;
 }
 const records=[...map.values()];
 if(!records.length)throw new Error('لا توجد أصناف صالحة في تقرير الجرد.');
 return {records,stats:{records:records.length,sourceRows:seen,merged:seen-records.length,sections:groups,ignored,warehouses:[...new Set(records.map(r=>r.warehouse).filter(Boolean))],kinds:Object.fromEntries(['menu','material','asset'].map(k=>[k,records.filter(r=>r.kind===k).length]))}};
}
function parseOrders(rows,at,errors){
 const output=new Map(),orderNumbers=new Map();
 for(let i=at+1;i<rows.length;i++){
  const r=rows[i],rawNum=safeText(from(r,rows.__header,'رقم الطلب'),80),name=safeText(from(r,rows.__header,'اسم المادة'));
  if(!rawNum&&!name)continue;
  const ts=excelTimestamp(from(r,rows.__header,'التاريخ'));
  if(!rawNum||!ts||!name){warning(errors,i+1,'سطر أوردر غير مكتمل (رقم أو تاريخ أو صنف)');continue;}
  const date=ts.slice(0,10); // business date must use Syria wall date, not UTC date
  let localDate=date;
  const original=from(r,rows.__header,'التاريخ');
  if(typeof original==='number')localDate=new Date(Math.round((original-25569)*86400000)).toISOString().slice(0,10);
  else if(typeof original==='string'&&/^\d{4}-\d{2}-\d{2}/.test(original))localDate=original.slice(0,10);
  else localDate=new Date(new Date(ts).getTime()+3*3600000).toISOString().slice(0,10);
  const key=`${localDate}|${rawNum}`;
  if(orderNumbers.has(rawNum)&&orderNumbers.get(rawNum)!==localDate)warning(errors,i+1,`رقم الأوردر ${rawNum} ظهر في تاريخ آخر؛ سيُحفظ حسب التاريخ`);
  orderNumbers.set(rawNum,localDate);
  const quantity=num(from(r,rows.__header,'الكمية')),
        price=num(from(r,rows.__header,'السعر')),
        lineNet=num(from(r,rows.__header,'صافي القلم'));
  if(!(quantity>0)||!(price>=0)||!(lineNet>=0)){
   warning(errors,i+1,`كمية أو سعر غير صالح للأوردر ${rawNum}`);continue;
  }
  const sourceNet=num(from(r,rows.__header,'صافي الطلب')),
        syp=num(from(r,rows.__header,'ليرة سورية'));
  if(!output.has(key))output.set(key,{key,date:localDate,number:rawNum,occurredAt:ts,netTotal:sourceNet,reportedSyp:syp,items:[],grossTotal:0,reviewReasons:[]});
  const order=output.get(key);
  if(sourceNet!=null&&order.netTotal!=null&&Math.abs(sourceNet-order.netTotal)>0.005)warning(errors,i+1,`صافي الأوردر ${rawNum} غير متطابق بين صفوفه`);
  if(syp!=null&&order.reportedSyp!=null&&Math.abs(syp-order.reportedSyp)>0.005)warning(errors,i+1,`عمود الليرة للأوردر ${rawNum} غير متطابق`);
  order.items.push({name,unit:safeText(from(r,rows.__header,'الوحدة'),70),quantity:round(quantity,6),unitPrice:round(price,4),lineNet:round(lineNet,4),note:safeText(from(r,rows.__header,'بيان القلم'),300),sourceRow:i+1});
  order.grossTotal=round(order.grossTotal+lineNet,4);
  if(Math.abs(lineNet-quantity*price)>0.02)order.reviewReasons.push(`صافي القلم لا يطابق السعر × الكمية عند السطر ${i+1}`);
 }
 const records=[...output.values()];
 if(!records.length)throw new Error('لا توجد أوردرات صالحة في الملف.');
 for(const order of records){
  order.grossTotal=round(order.grossTotal,4);
  order.netTotal=round(order.netTotal??order.grossTotal,4);
  order.difference=round(order.netTotal-order.grossTotal,4);
  if(Math.abs(order.difference)>0.02)order.reviewReasons.push('صافي الأمين يختلف عن مجموع البنود: احتفظنا بالفرق للمراجعة، دون فرض رسوم إضافية.');
  if(order.reportedSyp===0&&order.netTotal>0)order.reviewReasons.push('عمود الليرة صفر مع صافي موجب: لا نفترض دفعًا نقديًا.');
 }
 return {records,stats:{records:records.length,sourceRows:records.reduce((n,r)=>n+r.items.length,0),needsReview:records.filter(r=>r.reviewReasons.length>0).length}};
}
function parseSuppliers(rows,at,errors){
 const records=[],seen=new Map(),suppliers=new Set();
 for(let i=at+1;i<rows.length;i++){
  const r=rows[i],account=safeText(from(r,rows.__header,'الحساب'),250),name=safeText(from(r,rows.__header,'اسم الزبون'),250);
  if(!account&&!name)continue;
  const parsed=account.match(/^\s*([^\-]+)\s*-\s*(.+)$/);
  const accountCode=parsed?safeText(parsed[1],70):account;
  if(!accountCode||!name){warning(errors,i+1,'حساب مورد غير معروف');continue;}
  const ts=excelTimestamp(from(r,rows.__header,'التاريخ')),
    source=safeText(from(r,rows.__header,'أصل السند'),200),
    debit=num(from(r,rows.__header,'مدين'),0), credit=num(from(r,rows.__header,'دائن'),0);
  // Duplicate heading مدين/دائن: use position of LAST match, not first summary column.
  const rawHeaders=rows.__headerRaw||[];
  const columns=name=>rawHeaders.map((h,i)=>cleanName(h)===cleanName(name)?i:-1).filter(i=>i>=0);
  const di=columns('مدين').at(-1),cr=columns('دائن').at(-1);
  const entryDebit=di==null?0:num(r[di],0),entryCredit=cr==null?0:num(r[cr],0);
  if(!ts||entryDebit<0||entryCredit<0){warning(errors,i+1,`سند غير صالح للمورد ${name}`);continue;}
  const note=safeText(from(r,rows.__header,'البيان'),450);
  const identity=[accountCode,ts.slice(0,10),source,entryDebit,entryCredit,note].join('|');
  const occurrence=(seen.get(identity)||0)+1;seen.set(identity,occurrence);
  const key=`${identity}|${occurrence}`;
  const summaryDebit=columns('مدين')[0]!=null?num(r[columns('مدين')[0]],0):0;
  const summaryCredit=columns('دائن')[0]!=null?num(r[columns('دائن')[0]],0):0;
  suppliers.add(accountCode);
  records.push({key,accountCode,name,previousBalance:num(from(r,rows.__header,'الرصيد السابق'),0),summaryDebit,summaryCredit,
    uncollectedPapers:num(from(r,rows.__header,'رصيد الأوراق التجارية غير المحصلة'),0),
    currentBalance:num(from(r,rows.__header,'الرصيد الحالي'),0),occurredAt:ts,document:source,debit:entryDebit,credit:entryCredit,note,sourceRow:i+1});
 }
 if(!records.length)throw new Error('لا توجد حركات موردين صالحة في الكشف.');
 return {records,stats:{records:records.length,suppliers:suppliers.size}};
}
export function parseAmeenRows(kind,sourceRows){
 if(!AMEEN_TYPES[kind])throw new Error('اختر نوع الإدخال أولًا.');
 if(!Array.isArray(sourceRows)||!sourceRows.length)throw new Error('الملف فارغ.');
 const at=sourceRows.findIndex(row=>matchReportType(row)===kind);
 const detected=sourceRows.map(row=>matchReportType(row)).find(Boolean);
 if(at<0)throw new Error(detected?`نوع الملف هو «${AMEEN_TYPES[detected]}» وليس «${AMEEN_TYPES[kind]}».`:'عناوين الأعمدة لا تطابق تقرير الأمين المختار.');
 const rows=sourceRows;rows.__header=indexRow(rows[at]);rows.__headerRaw=rows[at];
 const errors=[];
 const parsed=(kind==='inventory'?parseInventory:kind==='orders'?parseOrders:parseSuppliers)(rows,at,errors);
 return {...parsed,kind,headerRow:at+1,warnings:errors.slice(0,400),warningCount:errors.length};
}
const children=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
const first=(node,name)=>children(node,name)[0];
const inner=node=>node?.textContent||'';
function xmlParser(xml){const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw new Error('تعذر قراءة صيغة Excel.');return doc;}
function colIndex(cellRef){const letters=String(cellRef||'').match(/^[A-Z]+/)?.[0]||'A';let n=0;for(const c of letters)n=n*26+c.charCodeAt(0)-64;return n-1;}
export async function readAmeenWorkbook(file){
 if(!file||!/\.xlsx$/i.test(file.name||''))throw new Error('اختر ملفًا بصيغة xlsx.');
 if(file.size>MAX_IMPORT_BYTES)throw new Error('حجم ملف Excel أكبر من 12 ميغابايت.');
 if(typeof globalThis.JSZip?.loadAsync!=='function')throw new Error('مكتبة قراءة Excel لم تُحمّل. حدّث الصفحة.');
 const buffer=await file.arrayBuffer();
 const archive=await globalThis.JSZip.loadAsync(buffer,{checkCRC32:true});
 const workbookPath='xl/workbook.xml';
 if(!archive.file(workbookPath))throw new Error('ملف Excel تالف: تعذر العثور على workbook.xml.');
 const workbook=xmlParser(await archive.file(workbookPath).async('string'));
 const sheets=children(workbook,'sheet');
 const relationshipsFile=archive.file('xl/_rels/workbook.xml.rels');
 const rels=relationshipsFile?xmlParser(await relationshipsFile.async('string')):null;
 const relations=new Map(rels?[...children(rels,'Relationship')].map(n=>[n.getAttribute('Id'),n.getAttribute('Target')]):[]);
 let strings=[];
 if(archive.file('xl/sharedStrings.xml')){
  const ss=xmlParser(await archive.file('xl/sharedStrings.xml').async('string'));
  strings=children(ss,'si').map(n=>children(n,'t').map(inner).join(''));
 }
 const tables=[];
 for(const sheet of sheets.slice(0,8)){
  const relId=sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
  const target=relations.get(relId)||'worksheets/sheet1.xml';
  const path=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:`xl/${target.replace(/^\.\//,'')}`;
  const x=archive.file(path);if(!x)continue;
  const doc=xmlParser(await x.async('string'));
  const all=[];
  for(const row of children(doc,'row')){
   const index=Number(row.getAttribute('r'))-1;
   if(index<0||index>100000)throw new Error('ملف Excel يحتوي صفوفًا غير صالحة.');
   const cells=[];
   for(const cell of children(row,'c')){
    const idx=colIndex(cell.getAttribute('r'));
    if(idx>150)continue;
    const type=cell.getAttribute('t');let value;
    if(type==='inlineStr')value=children(cell,'t').map(inner).join('');
    else{
     const raw=inner(first(cell,'v'));
     if(type==='s')value=strings[Number(raw)]??'';
     else if(type==='str'||type==='e')value=raw;
     else if(type==='b')value=raw==='1';
     else value=raw!==''?Number(raw):null;
    }
    if(value!=null)cells[idx]=value;
   }
   all[index]=cells;
  }
  tables.push({name:sheet.getAttribute('name'),rows:all.map(x=>x||[])});
 }
 if(!tables.length)throw new Error('لم نعثر على أوراق عمل قابلة للقراءة.');
 return {fileName:file.name,sheets:tables,size:file.size,buffer};
}
export function findReportSheet(workbook,kind){
 if(!AMEEN_TYPES[kind])throw new Error('اختر نوع الإدخال أولًا.');
 const sheet=workbook.sheets.find(s=>s.rows.some(r=>matchReportType(r)===kind));
 if(!sheet){const found=workbook.sheets.flatMap(s=>s.rows.slice(0,10).map(matchReportType)).find(Boolean);throw new Error(found?`الملف يحتوي «${AMEEN_TYPES[found]}» وليس «${AMEEN_TYPES[kind]}».`:'هذا الملف لا يطابق رؤوس أعمدة تقارير الأمين المدعومة.');}
 return sheet;
}
export async function sha256Hex(buffer){
 if(!globalThis.crypto?.subtle?.digest)throw new Error('المتصفح لا يدعم بصمة الملفات الآمنة على هذا الرابط.');
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer));
 return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function classifyFileName(filename){
 const n=cleanName(filename).replace(/\.(xlsx|xls)$/i,'').replace(/\s*[-_]?\s*copy\s*\d*$/i,'').replace(/[\s_\-]+/g,'');
 if(n.startsWith(cleanName('جرد المواد').replace(/\s/g,'')))return 'inventory';
 if(n.startsWith(cleanName('حركة الطلبات').replace(/\s/g,'')))return 'orders';
 if(n.startsWith(cleanName('كشف حساب زبون').replace(/\s/g,'')))return 'suppliers';
 return null;
}
