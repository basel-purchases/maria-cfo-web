// v0.31: employee workbook ingestion, independent from Ameen report formats.
// Salary is always monthly in SYP; job title never determines the pay type.
import {cleanName} from './ameen-import-parser.js?v=1.0';
const clean=v=>String(v??'').replace(/[\u200b-\u200f\u202a-\u202e]/g,'').trim().replace(/\s+/g,' ');
const headers={
 name:['الاسم','اسم الموظف','الموظف'],
 jobTitle:['الصفة / المهنة','الصفة والمهنة','الصفة','المهنة','الوظيفة','المسمى الوظيفي'],
 residence:['السكن','مكان السكن','العنوان','منطقة السكن'],
 phone:['رقم الموبايل','رقم الهاتف','الموبايل','الهاتف','الجوال','رقم الجوال'],
 monthlySalary:['الراتب','الراتب الشهري','الراتب الشهري ل س','الاجر الشهري','الراتب الشهري syp'],
};
const digits=v=>String(v).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
function normalized(v){return cleanName(v).replace(/[\s\/_\-]+/g,'');}
const headerKeys=Object.fromEntries(Object.entries(headers).map(([key,list])=>[key,new Set(list.map(normalized))]));
function matchHeader(row){
 const found={};for(let i=0;i<row.length;i++){
  const normalizedName=normalized(row[i]);if(!normalizedName)continue;
  for(const [k,set] of Object.entries(headerKeys))if(set.has(normalizedName)&&found[k]==null)found[k]=i;
 }
 return Object.keys(found).length===5?found:null;
}
function positiveSalary(raw,row){
 const s=digits(clean(raw)).replace(/[٬,\s]/g,'').replace(/٫/g,'.');
 if(!/^(?:\d+)(?:\.\d{1,4})?$/.test(s))throw Error(`السطر ${row}: الراتب غير صالح. استخدم مبلغًا رقميًا فقط.`);
 const n=Number(s);
 if(!Number.isFinite(n)||n<=0||n>1e12)throw Error(`السطر ${row}: يجب أن يكون الراتب الشهري موجبًا ومعقولًا.`);
 return n;
}
function phoneText(raw,row){
 if(raw==null||clean(raw)==='')return null;
 const s=digits(clean(raw)).replace(/\s+/g,' ');
 if(!/^[+\d\s().-]+$/.test(s)||s.length>40)throw Error(`السطر ${row}: رقم الموبايل غير صالح.`);
 return s;
}
export function parseEmployeesV031(workbook){
 let sheet,at=-1,cols;
 for(const candidate of workbook?.sheets||[]){
  for(let i=0;i<Math.min(20,candidate.rows.length);i++){
   const matched=matchHeader(candidate.rows[i]||[]);
   if(matched){sheet=candidate;at=i;cols=matched;break;}
  }
  if(sheet)break;
 }
 if(!sheet)throw Error('هذا الملف لا يطابق جدول الموظفين. الأعمدة المطلوبة: الاسم، الصفة / المهنة، السكن، رقم الموبايل، الراتب.');
 const employees=[],seen=new Set(),warnings=[];let ignored=0,missingPhones=0,missingResidences=0;
 for(let i=at+1;i<sheet.rows.length;i++){
  const r=sheet.rows[i]||[],line=i+1;
  const value=k=>r[cols[k]];
  const name=clean(value('name')),jobTitle=clean(value('jobTitle'));
  const residence=clean(value('residence'))||null,rawPhone=value('phone'),rawSalary=value('monthlySalary');
  if(!name){
   if(jobTitle||residence||clean(rawPhone))throw Error(`السطر ${line}: يوجد بيانات موظف دون اسم.`);
   // Ignore empty spreadsheet rows and grand-total salary footer rows.
   ignored++;continue;
  }
  if(name.length>250||jobTitle.length>250||(residence?.length||0)>200)throw Error(`السطر ${line}: أحد الحقول النصية أطول من الحد المسموح.`);
  if(!jobTitle)warnings.push({row:line,message:`«${name}»: الوظيفة غير مذكورة؛ يمكن استكمالها لاحقًا.`});
  const salary=positiveSalary(rawSalary,line),phone=phoneText(rawPhone,line);
  const key=cleanName(name);
  if(seen.has(key))throw Error(`السطر ${line}: اسم الموظف «${name}» مكرر في الملف، يرجى تمييزه قبل الاستيراد.`);
  seen.add(key);
  if(!phone)missingPhones++;
  if(!residence)missingResidences++;
  employees.push({name,jobTitle:jobTitle||null,residence,phone,monthlySalary:salary,sourceRow:line});
 }
 if(!employees.length)throw Error('جدول الموظفين لا يحتوي على أسماء ورواتب قابلة للاستيراد.');
 if(employees.length>5000)throw Error('عدد الموظفين أكبر من الحد المسموح (5000).');
 const ordered=employees.map(e=>e.monthlySalary).sort((a,b)=>a-b);
 const median=ordered[Math.floor(ordered.length/2)];
 for(const e of employees){
  if(e.monthlySalary>=150000&&e.monthlySalary>=median*5)
   warnings.push({row:e.sourceRow,message:`راتب «${e.name}» (${e.monthlySalary.toLocaleString('en-US')} ل.س) مرتفع مقارنة ببقية الملف؛ يرجى مراجعته قبل التأكيد. لن نغيّره تلقائيًا.`});
 }
 return {records:employees,stats:{employees:employees.length,ignored,missingPhones,missingResidences,monthly:employees.length},warnings};
}
