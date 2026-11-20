// v1.0.31: The operator's actual five-column workbook is the canonical count import.
// It has 'القسم' as its fifth column, not 'ملاحظات'. Never infer a missing count as zero.
import {cleanV126,numV126,excelDateV126,parsePhysicalCountV126} from './baseline-parsers-v126.js?v=1.0.31';
const required=['اسم المادة','الكمية','الواحدة','التاريخ','القسم'];
const normalized=x=>cleanV126(x).normalize('NFKC').replace(/[أإآ]/g,'ا').replace(/[ى]/g,'ي').toLowerCase();
export function parsePhysicalCountV131(workbook){
 let canonical=false;const records=[],issues=[],seen=new Set(),catalogMap=new Map();let sections=new Set(),empty=0,review=0;
 for(const sheet of workbook.sheets||[]){
  const rows=sheet.rows||[];
  const h=rows.findIndex(row=>required.every(k=>(row||[]).some(v=>cleanV126(v)===k)));
  if(h<0)continue;
  canonical=true;
  const cols=Object.fromEntries(rows[h].map((v,i)=>[cleanV126(v),i]));
  for(let i=h+1;i<rows.length;i++){
   const row=rows[i]||[];
   const name=cleanV126(row[cols['اسم المادة']]);if(!name)continue;
   const dep=cleanV126(row[cols['القسم']]);
   if(dep)sections.add(dep);
   const key=normalized(name);
   if(dep&&dep.length<=120){const prior=catalogMap.get(key);
    if(!prior)catalogMap.set(key,{name,department:dep});
    else if(prior.department!==dep){catalogMap.set(key,{name,department:'',conflict:true});issues.push(`«${name}» لها أكثر من قسم؛ تُترك دون تصنيف تلقائي.`);}
   }
   const raw=row[cols['الكمية']];
   if(raw==null||cleanV126(raw)===''){empty++;continue;}
   const qty=numV126(raw),unit=cleanV126(row[cols['الواحدة']]),date=excelDateV126(row[cols['التاريخ']]);
   if(qty==null||qty<0)throw Error(`الجرد ${dep}، السطر ${i+1}: الكمية يجب أن تكون رقمًا غير سالب، ويكتب الصفر 0 صراحة.`);
   if(!unit||!date){review++;issues.push(`${dep}، السطر ${i+1}: الكمية محفوظة للمراجعة؛ الوحدة أو التاريخ غير مكتمل.`);continue;}
   const countKey=normalized(name)+'|'+date;
   if(seen.has(countKey))throw Error(`مادة مكررة في ملف الجرد لنفس التاريخ: «${name}» بتاريخ ${date}.`);
   seen.add(countKey);
   const note=cols['ملاحظات']===undefined?'':cleanV126(row[cols['ملاحظات']]);
   records.push({name,quantity:qty,unit,date,department:dep,note:note.slice(0,400)});
  }
 }
 if(!canonical)return parsePhysicalCountV126(workbook);
 const catalog=[...catalogMap.values()].filter(x=>x.department&&!x.conflict);
 return {records,catalog,issues,stats:{sections:sections.size,approved:records.length,review,empty,categorizedCandidates:catalog.length}};
}
export function consumptionBusinessDateV131(day,lastCountDay){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day||'')))throw Error('تاريخ الأوردر غير صالح');
 return lastCountDay&&day<=lastCountDay?'covered_by_count':'after_count';
}
