// Maria CFO v0.27 - filtered table export for dynamically rendered pages and dialogs.
// Provider contract: async () => ({ title, headers: string[], rows: any[][] }).
import {downloadXlsx} from './xlsx-export.js?v=0.27';

const providers=new WeakMap();
const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const actionHeader=h=>/^(?:\u0625\u062c\u0631\u0627\u0621|\u0625\u062c\u0631\u0627\u0621\u0627\u062a|\u062a\u0639\u062f\u064a\u0644|\u062d\u0630\u0641|\u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644|\u0627\u0644\u062d\u0631\u0643\u0627\u062a)$/u.test(clean(h));

export function registerTableExport(table,provider){
  if(!table||typeof provider!=='function')throw Error('TABLE_EXPORT_PROVIDER_REQUIRED');
  providers.set(table,provider);
  ensureTableActions(table);
}

function headersAndIndexes(table){
 const headerRow=table.querySelector('thead tr');
 const headerNodes=[...(headerRow?.children||[])];
 const allHeaders=headerNodes.map(n=>clean(n.textContent));
 const kept=allHeaders.map((s,i)=>({s,i})).filter(x=>x.s&&!actionHeader(x.s));
 return {headers:kept.map(x=>x.s),indexes:kept.map(x=>x.i)};
}

export function visibleTableData(table){
  const {headers,indexes}=headersAndIndexes(table);
  const rows=[...table.querySelectorAll('tbody tr')].filter(tr=>{
    if(tr.hidden||tr.getAttribute('aria-hidden')==='true')return false;
    if(typeof getComputedStyle==='function'&&getComputedStyle(tr).display==='none')return false;
    return true;
  }).filter(tr=>!tr.querySelector('td[colspan]')&&tr.children.length>=headers.length)
    .map(tr=>indexes.map(i=>clean(tr.children[i]?.textContent)));
  return {headers,rows,title:clean(document.querySelector('#top-title')?.textContent||document.title||'Maria CFO')};
}

function checkData(data){
 if(!data||!Array.isArray(data.headers)||!data.headers.length||!Array.isArray(data.rows))throw Error('NO_TABLE_DATA');
 const headers=data.headers.map(clean);
 const rows=data.rows.map(r=>headers.map((_,i)=>r?.[i]??''));
 return {title:clean(data.title)||'Maria CFO',headers,rows};
}

async function resolveData(table){
 const provider=providers.get(table);
 return checkData(provider?await provider():visibleTableData(table));
}

function filename(title,extension){
 const safe=clean(title).replace(/[\\/:*?"<>|]+/g,'-').slice(0,70)||'Maria-CFO';
 return `${safe}-${new Date().toISOString().slice(0,10)}.${extension}`;
}

function printableHtml({title,headers,rows}){
 const heading=headers.map(x=>`<th>${escapeHtml(x)}</th>`).join('');
 const body=rows.map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
 return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
 <style>@page{size:A4 landscape;margin:13mm}*{box-sizing:border-box}body{font:12px/1.6 Tahoma,Arial,sans-serif;color:#26212b;direction:rtl}
 h1{font-size:19px;margin:0 0 6px}.meta{color:#666;margin-bottom:14px}table{width:100%;border-collapse:collapse;table-layout:auto}
 th,td{border:1px solid #ddd;padding:6px 8px;text-align:right;overflow-wrap:anywhere;vertical-align:top}th{background:#ede4ee;font-weight:700}
 tr{break-inside:avoid}thead{display:table-header-group}footer{margin-top:10px;color:#666;font-size:10px}
 @media screen{body{margin:20px}.noprint{margin-bottom:15px}}@media print{.noprint{display:none}}</style></head>
 <body><div class="noprint">استخدم «حفظ بتنسيق PDF» من نافذة الطباعة.</div><h1>${escapeHtml(title)}</h1>
 <div class="meta">Maria CFO · ${escapeHtml(new Date().toLocaleString('ar'))} · ${rows.length} سجل حسب التصفية</div>
 <table><thead><tr>${heading}</tr></thead><tbody>${body}</tbody></table><footer>تصدير حسب التصفية المطبقة في الصفحة</footer></body></html>`;
}

async function exportAsXlsx(table,button){
 button.disabled=true;
 try{
  const data=await resolveData(table);
  if(!data.rows.length)throw Error('NO_MATCHING_ROWS');
  downloadXlsx(filename(data.title,'xlsx'),data.headers,data.rows,data.title.slice(0,31));
 }catch(e){alert(e?.message==='NO_MATCHING_ROWS'?'لا توجد بيانات مطابقة للتصدير.':`تعذر تصدير الجدول: ${e?.message||e}`);}
 finally{button.disabled=false;}
}
async function exportAsPdf(table,button){
 const popup=window.open('','_blank'); // must happen synchronously inside the click handler
 if(!popup){alert('اسمح للموقع بفتح نافذة الطباعة ثم اختر حفظ كـ PDF.');return;}
 popup.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body>جار تجهيز PDF...</body></html>');
 button.disabled=true;
 try{
  const data=await resolveData(table);
  if(!data.rows.length)throw Error('NO_MATCHING_ROWS');
  popup.document.open();popup.document.write(printableHtml(data));popup.document.close();
  // print is a browser-native PDF path preserving Arabic font and RTL tables.
  popup.focus();setTimeout(()=>{if(!popup.closed)popup.print();},420);
 }catch(e){popup.close();alert(e?.message==='NO_MATCHING_ROWS'?'لا توجد بيانات مطابقة للتصدير.':`تعذر تجهيز PDF: ${e?.message||e}`);}
 finally{button.disabled=false;}
}

export function ensureTableActions(table){
 if(!table||!table.isConnected||table.dataset.exportV027Attached==='1')return;
 const wrapper=table.closest('.table-wrap')||table.parentElement;
 if(!wrapper||!wrapper.parentElement)return;
 const bar=document.createElement('div');bar.className='table-export-bar-v027';
 const excel=document.createElement('button');excel.type='button';excel.className='mini-btn';excel.textContent='⇩ Excel';
 excel.title='تصدير البيانات حسب فلتر الصفحة - جميع الصفحات عند دعم الترقيم';
 const pdf=document.createElement('button');pdf.type='button';pdf.className='mini-btn';pdf.textContent='⇩ PDF';
 pdf.title='فتح الطباعة ثم اختيار حفظ إلى PDF - حسب فلتر الصفحة';
 bar.append(excel,pdf);wrapper.parentElement.insertBefore(bar,wrapper);
 excel.addEventListener('click',()=>exportAsXlsx(table,excel));
 pdf.addEventListener('click',()=>exportAsPdf(table,pdf));
 table.dataset.exportV027Attached='1';
}

let observer=null;
export function installTableExportV027(){
 if(observer||!document.body)return;
 const scan=()=>document.querySelectorAll('table').forEach(ensureTableActions);
 observer=new MutationObserver(mutations=>{
  if(!mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&!n.classList?.contains('table-export-bar-v027'))))return;
  scan();
 });
 observer.observe(document.body,{childList:true,subtree:true});
 scan();
}

export {downloadXlsx};
export function exportDatasetPdf(data){
 const popup=window.open('','_blank');if(!popup){alert('اسمح للموقع بفتح نافذة الطباعة.');return;}
 popup.document.write('<html lang="ar" dir="rtl"><meta charset="utf-8"><body>جار تجهيز PDF...</body></html>');
 Promise.resolve(typeof data==='function'?data():data).then(checkData).then(d=>{
  popup.document.open();popup.document.write(printableHtml(d));popup.document.close();popup.focus();
  setTimeout(()=>{if(!popup.closed)popup.print();},420);
 }).catch(e=>{popup.close();alert(`تعذر تجهيز PDF: ${e?.message||e}`);});
}
