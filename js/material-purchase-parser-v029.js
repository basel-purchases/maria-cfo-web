// Deterministic Ameen kitchen purchasing import. The 44K-row movement ledger is
// NEVER blindly posted: only official 'شراء:' rows, kitchen allowlisted materials,
// positive quantities/prices, and provable conversions are candidates.
import {kitchenCatalogV029} from './kitchen-catalog-v029.js?v=1.0';
const catalog = new Map(kitchenCatalogV029.map(x=>[String(x.code),x]));
const normalize=v=>String(v??'').trim().replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/\s+/g,' ').toLocaleLowerCase('ar');
function datePart(v){
 if(typeof v==='number' && Number.isFinite(v)){
   const d=new Date(Math.round((v-25569)*86400000));
   return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
 }
 const s=String(v??'');const m=s.match(/^(20\d\d)-(\d\d)-(\d\d)/);
 return m?m[0]:'';
}
function rowCheck(line){
 if(!line.name || normalize(line.name)!==normalize(line.catalog.name)) return 'رمز المادة لا يطابق الاسم في جرد المطبخ';
 if(line.catalog.requiresReview) return 'وحدة هذه المادة غير مؤكدة في ملفات المصدر';
 const unit=normalize(line.sourceUnit),base=normalize(line.catalog.baseUnit);
 if(unit!==base && !(unit==='كغ'&&base==='غرام') && !(unit==='غرام'&&base==='كغ'))
   return 'تحويل وحدة غير مؤكّد';
 if(!Number.isFinite(line.quantity)||line.quantity<=0) return 'كمية شراء غير صالحة';
 if(!Number.isFinite(line.unitPrice)||line.unitPrice<=0) return 'سعر الشراء صفر أو غير صالح';
 return '';
}
export function parseMaterialPurchasesV029(workbook){
 const sheet=workbook?.sheets?.find(s=>s.name==='حركة مادة') ?? workbook?.sheets?.find(s=>s.rows?.[1]?.[0]==='المادة'&&s.rows[1]?.[7]==='فاتورة');
 if(!sheet||!sheet.rows?.length||sheet.rows[1]?.[0]!=='المادة'||sheet.rows[1]?.[7]!=='فاتورة')
   throw new Error('ملف حركة مادة ليس بتنسيق التقرير المتوقع؛ لن نخمن الأعمدة.');
 const groups=new Map(),alerts=[];let purchaseRows=0,ignoredMovements=0,ignoredOther=0;
 for(let i=2;i<sheet.rows.length;i++){
   const r=sheet.rows[i]||[];
   const document=String(r[7]??'').trim();
   if(!/^شراء:\s*\d+$/.test(document)){ignoredMovements++;continue;}
   const codeAndName=String(r[0]??'').trim().match(/^(\d+)\s*-\s*(.+)$/);
   if(!codeAndName || !codeAndName[1].startsWith('2')){ignoredOther++;continue;}
   purchaseRows++;
   const code=codeAndName[1],name=codeAndName[2].trim(),ref=catalog.get(code);
   if(!ref)throw new Error(`رمز مادة غير معروف في مستودع المطبخ: ${code} (السطر ${i+1})`);
   const date=datePart(r[6]);
   if(!date)throw new Error(`تاريخ فاتورة غير صالح في السطر ${i+1}`);
   const sourceUnit=String(r[5]??'').trim(),quantity=Number(r[9]),unitPrice=Number(r[10]);
   const line={code,name,sourceUnit,quantity,unitPrice,sourceRow:i+1,catalog:ref};
   const reason=rowCheck(line);
   const key=`${document}|${date}`;
   if(!groups.has(key))groups.set(key,{document,date,lines:[],problems:[]});
   const group=groups.get(key);
   group.lines.push({code,name:ref.name,sourceUnit,quantity,unitPrice,sourceRow:i+1});
   if(reason)group.problems.push(`${name}: ${reason}`);
 }
 const documents=[...groups.values()].sort((a,b)=>a.date.localeCompare(b.date)||
   Number(a.document.split(':')[1])-Number(b.document.split(':')[1]));
 const eligible=documents.filter(d=>!d.problems.length);
 const blocked=documents.filter(d=>d.problems.length);
 if(!documents.length)throw new Error('لم نجد حركات شراء صالحة تخص مواد مستودع المطبخ.');
 return {documents,eligible,blocked,stats:{sourceRows:sheet.rows.length,purchaseRows,
  invoiceCount:documents.length,readyInvoiceCount:eligible.length,blockedInvoiceCount:blocked.length,
  readyLines:eligible.reduce((a,x)=>a+x.lines.length,0),ignoredMovements,ignoredOther,materials:catalog.size}};
}
export function purchaseChunksV029(documents,maxDocs=6,maxLines=130){
 const batches=[],current=[];let count=0;
 for(const document of documents){
  if(document.lines.length>250)throw new Error('فاتورة تتجاوز الحد المدعوم');
  if(current.length&&(current.length>=maxDocs||count+document.lines.length>maxLines)){
    batches.push([...current]);current.length=0;count=0;
  }
  current.push(document);count+=document.lines.length;
 }
 if(current.length)batches.push([...current]);
 return batches;
}
