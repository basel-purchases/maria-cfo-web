// Maria CFO Web v1.0.26 — pure Excel parsing for historical purchases and date-stamped physical counts.
// No guessed USD rates, silent zero balances, or auto-matched ambiguous inventory names.
export const cleanV126=x=>String(x??'').trim().replace(/\s+/g,' ');
export const numV126=x=>x==null||cleanV126(x)===''?null:(Number.isFinite(Number(x))?Number(x):null);
export function excelDateV126(x){
 if(x==null||x==='')return null;
 if(typeof x==='number'&&Number.isFinite(x)){
  const d=new Date(Date.UTC(1899,11,30)+Math.floor(x)*86400000);
  return Number.isNaN(d.valueOf())?null:d.toISOString().slice(0,10);
 }
 if(x instanceof Date&&!isNaN(x.valueOf()))return x.toISOString().slice(0,10);
 const s=cleanV126(x);
 let m=s.match(/^(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
 if(m)return validDate(+m[1],+m[2],+m[3]);
 m=s.match(/^(\d{1,2})[-\/.\\](\d{1,2})[-\/.\\](20\d{2})/);
 return m?validDate(+m[3],+m[2],+m[1]):null;
}
function validDate(y,m,d){
 const dt=new Date(Date.UTC(y,m-1,d));
 return dt.getUTCFullYear()===y&&dt.getUTCMonth()+1===m&&dt.getUTCDate()===d?
  `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}
const rowKeys=r=>r.map(cleanV126);
function headerIndex(rows,required){return rows.findIndex(r=>required.every(v=>rowKeys(r).includes(v)));}
function columns(row){const out={};row.forEach((v,i)=>{const key=cleanV126(v);if(key && !(key in out))out[key]=i;});return out;}
const val=(r,lookup,k)=>r[lookup[k]];
export function parseHistoryInvoicesV126(workbook){
 const sheet=workbook.sheets.find(s=>s.rows?.some(r=>rowKeys(r).includes('الفاتورة')&&rowKeys(r).includes('اسم المادة')&&rowKeys(r).includes('اسم الزبون')));
 if(!sheet)throw Error('ملف الفواتير لا يحتوي عناوين «التاريخ، الفاتورة، اسم الزبون، اسم المادة، الكمية، الوحدة، السعر، صافي القيمة».');
 const required=['التاريخ','الفاتورة','اسم الزبون','اسم المادة','الكمية','الوحدة','السعر','صافي القيمة'];
 const head=headerIndex(sheet.rows,required);if(head<0)throw Error('عناوين ملف حركة الفواتير ناقصة.');
 const cols=columns(sheet.rows[head]);const groups=new Map(),issues=[];
 let totalLines=0,totalNet=0,zeroPrices=0,missingUnits=0;
 for(let i=head+1;i<sheet.rows.length;i++){
  const row=sheet.rows[i]||[];
  if(row.every(x=>x==null||cleanV126(x)===''))continue;
  const date=excelDateV126(val(row,cols,'التاريخ')),number=cleanV126(val(row,cols,'الفاتورة'));
  const supplier=cleanV126(val(row,cols,'اسم الزبون')),name=cleanV126(val(row,cols,'اسم المادة'));
  const qty=numV126(val(row,cols,'الكمية')),price=numV126(val(row,cols,'السعر'));
  const net=numV126(val(row,cols,'صافي القيمة'));
  const origUnit=cleanV126(val(row,cols,'الوحدة'));
  if(!date||!number||!supplier||!name||!(qty>0)||!(price>=0)||!(net>=0)){
   throw Error(`السطر ${i+1}: تاريخ/رقم/مورد/مادة/كمية/سعر غير صالح؛ تم إيقاف الاستيراد دون حذف أي سطر.`);
  }
  if(!number.startsWith('شراء:'))throw Error(`السطر ${i+1}: التقرير ليس فاتورة شراء؛ تم إيقاف استيراد الملف.`);
  const unit=origUnit||'قطعة';
  if(!origUnit){issues.push(`السطر ${i+1}: وحدة ناقصة، وُضعت «قطعة» مؤقتًا — تحقق من المادة «${name}»`);missingUnits++;}
  if(price===0)zeroPrices++;
  const discount=numV126(val(row,cols,'مجموع الحسم'))??0;
  const additions=numV126(val(row,cols,'مجموع الإضافات'))??0;
  const tax=numV126(val(row,cols,'إجمالي الضرائب'))??0;
  const gross=numV126(val(row,cols,'القيمة'))??qty*price;
  if(Math.abs(gross-discount+additions-net)>0.12)throw Error(`السطر ${i+1}: صافي البند لا يطابق القيمة والحسم والإضافات؛ تم إيقاف الملف.`);
  const k=[date,number,supplier].join('|');
  if(!groups.has(k))groups.set(k,{date,number,supplier,lines:[],total:0});
  const doc=groups.get(k);
  doc.lines.push({name,unit,quantity:qty,originalPrice:price,discount,additions,tax,net,sourceRow:i+1,unitWasMissing:!origUnit});
  doc.total+=net;totalNet+=net;totalLines++;
 }
 if(!groups.size)throw Error('لا توجد فواتير شراء مؤهلة للاستيراد.');
 const records=[...groups.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.number.localeCompare(b.number));
 for(const d of records)d.total=Math.round(d.total*10000)/10000;
 return {records,issues,stats:{invoices:records.length,lines:totalLines,suppliers:new Set(records.map(d=>d.supplier)).size,
  materials:new Set(records.flatMap(d=>d.lines.map(l=>l.name))).size,totalNet:Math.round(totalNet*100)/100,zeroPrices,missingUnits,currency:'SYP'}};
}
const detailedCountHeaders=['اسم المادة المعتمد','الكمية المعدودة','وحدة العد','تاريخ الجرد'];
const simpleCountHeaders=['اسم المادة','الكمية','الواحدة','التاريخ'];
export function parsePhysicalCountV126(workbook){
 const records=[],warnings=[],names=new Map();let empty=0,review=0,sections=0;
 for(const sh of workbook.sheets){
  const oldHead=headerIndex(sh.rows,detailedCountHeaders);
  const simple=oldHead<0;
  const h=simple?headerIndex(sh.rows,simpleCountHeaders):oldHead;
  if(h<0)continue;
  sections++;
  const cols=columns(sh.rows[h]);
  const [kName,kQty,kUnit,kDate,kNote]=simple?
   ['اسم المادة','الكمية','الواحدة','التاريخ','ملاحظات']:
   ['اسم المادة المعتمد','الكمية المعدودة','وحدة العد','تاريخ الجرد','ملاحظات الجرد'];
  for(let i=h+1;i<sh.rows.length;i++){
   const r=sh.rows[i]||[];const name=cleanV126(val(r,cols,kName));
   if(!name)continue;
   const raw=val(r,cols,kQty);
   const approved=simple?'معتمد':cleanV126(val(r,cols,'حالة الاعتماد'));
   if(raw==null||cleanV126(raw)===''){
    if(!simple&&approved==='معتمد')throw Error(`الجرد ${sh.name} / السطر ${i+1}: لا يجوز اعتماد سطر دون كمية معدودة؛ الصفر يُكتب 0 صراحة.`);
    empty++;continue;
   }
   if(approved!=='معتمد'){
    review++;warnings.push(`${sh.name} / السطر ${i+1}: كمية محفوظة للمراجعة فقط.`);continue;
   }
   const qty=numV126(raw),unit=cleanV126(val(r,cols,kUnit));
   const date=excelDateV126(val(r,cols,kDate));
   if(qty==null||qty<0)throw Error(`الجرد ${sh.name} / السطر ${i+1}: الكمية يجب أن تكون رقمًا غير سالب.`);
   if(!unit||!date){
    if(!simple)throw Error(`الجرد ${sh.name} / السطر ${i+1}: الوحدة والتاريخ إلزاميان عند الاعتماد.`);
    review++;warnings.push(`${sh.name} / السطر ${i+1}: الكمية محفوظة لكن الوحدة أو التاريخ ناقص/غير صالح، لذلك لن تُرحّل.`);continue;
   }
   const key=name.toLocaleLowerCase('ar');
   if(names.has(key))throw Error(`الجرد: المادة «${name}» مكررة في ${names.get(key)} و${sh.name}، لا يمكن احتسابها مرتين.`);
   names.set(key,sh.name);
   records.push({name,quantity:qty,unit,date,department:sh.name,note:cleanV126(val(r,cols,kNote)).slice(0,400)});
  }
 }
 if(!sections)throw Error('ملف الجرد غير مطابق: يلزم خمسة أعمدة «اسم المادة، الكمية، الواحدة، التاريخ، ملاحظات»، أو النموذج المفصل القديم.');
 return {records,issues:warnings,stats:{sections,approved:records.length,empty,review}};
}
// Server-side conversion works only for known dimensional equivalences. This is a UX hint, not authority.
export function countPresentAtDateV126({count,opening,after}={}){
 const values=[count,opening,after].map(Number);
 if(!values.every(Number.isFinite))throw Error('كميات غير رقمية');
 return {difference:values[0]-values[1],current:values[0]+values[2]};
}
