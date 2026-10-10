import * as api from './api.js?v=0.24';
import {esc} from './utils.js?v=0.24';
import {modal,toast,friendlyError,loader} from './ui.js?v=0.24';
import {AMEEN_TYPES,parseAmeenRows,readAmeenWorkbook,findReportSheet,sha256Hex,classifyFileName} from './ameen-import-parser.js?v=0.24';

const browserSupport=()=>typeof window.showDirectoryPicker==='function';
const DB='maria-ameen-folder-v024',STORE='settings',KEY='import-folder';
let busy=false;
function localDb(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function savedHandle(){if(!globalThis.indexedDB)return null;const db=await localDb();return new Promise((resolve,reject)=>{
 const tr=db.transaction(STORE,'readonly');const r=tr.objectStore(STORE).get(KEY);
 r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);
 tr.oncomplete=()=>db.close();});}
async function saveHandle(handle){if(!globalThis.indexedDB)return;const db=await localDb();return new Promise((resolve,reject)=>{
 const tr=db.transaction(STORE,'readwrite');tr.objectStore(STORE).put(handle,KEY);
 tr.oncomplete=()=>{db.close();resolve();};tr.onerror=()=>reject(tr.error);});}
async function chooseDirectory(){
 if(!browserSupport())throw new Error('قراءة مجلد سطح المكتب تحتاج Chrome أو Edge على رابط HTTPS. استخدم الرفع اليدوي على هذا المتصفح.');
 let handle=await savedHandle().catch(()=>null);
 if(handle){
  let status=await handle.queryPermission({mode:'read'});
  if(status!=='granted')status=await handle.requestPermission({mode:'read'});
  if(status==='granted')return handle;
 }
 handle=await window.showDirectoryPicker({mode:'read',id:'maria-cfo-ameen-imports'});
 if((await handle.queryPermission({mode:'read'}))!=='granted'&&
    (await handle.requestPermission({mode:'read'}))!=='granted')throw new Error('لم يتم منح إذن قراءة المجلد.');
 await saveHandle(handle).catch(e=>console.warn('Unable to remember directory handle',e));
 return handle;
}
async function scanFiles(){
 const dir=await chooseDirectory();const candidates={};const ignored=[];
 for await(const entry of dir.values()){
  if(entry.kind!=='file'||!/\.xlsx$/i.test(entry.name))continue;
  const type=classifyFileName(entry.name);
  if(!type){ignored.push(entry.name);continue;}
  const file=await entry.getFile();
  if(!candidates[type]||file.lastModified>candidates[type].lastModified){
    if(candidates[type])ignored.push(candidates[type].name);
    candidates[type]=file;
  }else ignored.push(file.name);
 }
 return {files:Object.entries(candidates).map(([kind,file])=>({kind,file})),ignored,folder:dir.name};
}
function askFiles(files,ignored=[]){return new Promise(resolve=>{
 const m=modal({
  title:'تحديث ملفات الأمين',wide:true,submitText:'تأكيد وبدء الاستيراد',
  subtitle:'راجع الملفات التي وجدها النظام قبل البدء. ستُعالج كل منها مرة واحدة بأمان.',
  body:`<div class="ameen-found-list">${files.map(({kind,file})=>`<div class="ameen-found-row"><strong>${esc(AMEEN_TYPES[kind])}</strong><span>${esc(file.name)}</span><small>${(file.size/1024).toFixed(1)} KB</small></div>`).join('')}</div>
  ${ignored.length?`<p class="metric-note">تم تجاهل ${ignored.length} ملفات غير مطابقة أو نسخ أقدم في المجلد.</p>`:''}
  <div class="notice">سيُحفظ تعريف المنيو فقط، ويُراجع اختلاف صافي الأوردر قبل نشره. عمليات الموردين المستوردة لا تنشئ سحبًا أو دفعًا نقديًا.</div>`,
  onSubmit:async()=>{resolve(true);return true;},
  onClose:()=>resolve(false),
 });
 });}
function overlay(){
 const el=document.createElement('div');el.className='ameen-import-blocker';el.setAttribute('role','alertdialog');el.setAttribute('aria-modal','true');
 el.innerHTML=`<div class="ameen-block-card"><div class="loader"></div><h3>جاري معالجة ملفات الأمين</h3><p id="ameen-stage">قراءة الملفات والتحقق من البيانات…</p><progress id="ameen-progress" max="100" value="0"></progress><small>لا تغلق الصفحة أو تحدّثها أثناء الاستيراد. قد تستغرق معالجة الجرد بعض الوقت.</small></div>`;
 document.body.append(el);document.querySelector('#app')?.setAttribute('inert','');
 return {update(value,label){el.querySelector('#ameen-stage').textContent=label;el.querySelector('progress').value=value;},close(){document.querySelector('#app')?.removeAttribute('inert');el.remove();}};
}
async function prepare({file,kind}){
 const workbook=await readAmeenWorkbook(file);
 const sheet=findReportSheet(workbook,kind);
 const parsed=parseAmeenRows(kind,sheet.rows);
 const hash=await sha256Hex(workbook.buffer);
 return {kind,file,parsed,hash,sheet:sheet.name};
}
export async function runAmeenFiles(files){
 if(busy)throw new Error('عملية استيراد أخرى جارية.');
 if(!Array.isArray(files)||!files.length)throw new Error('لم تحدد أي ملفات.');
 busy=true;const block=overlay();const outputs=[];
 try{
  for(let i=0;i<files.length;i++){
   const {file,kind}=files[i];
   block.update(Math.round(i/files.length*100),`الملف ${i+1}/${files.length}: قراءة «${file.name}»`);
   const prepared=await prepare({file,kind});
   block.update(Math.round((i+.2)/files.length*100),`تسجيل ${prepared.parsed.records.length} سجلًا من «${file.name}» في Supabase…`);
   // Never automatically repeat a potentially committed RPC after a lost HTTP response.
   const result=await api.importAmeenV024({kind,fileName:file.name,sha256:prepared.hash,records:prepared.parsed.records});
   outputs.push({name:file.name,kind,result,localWarnings:prepared.parsed.warningCount});
   block.update(Math.round((i+1)/files.length*100),`اكتمل الملف ${i+1} من ${files.length}`);
  }
  return outputs;
 }catch(error){error.completedFiles=outputs;throw error;}
 finally{busy=false;block.close();}
}
export async function desktopRefresh(){
 if(busy)return;
 try{
  const {files,ignored}=await scanFiles();
  if(!files.length){toast('لم أجد ملفات xlsx تبدأ بأسماء: جرد المواد، حركة الطلبات، كشف حساب زبون.','error');return;}
  if(!(await askFiles(files,ignored)))return;
  const results=await runAmeenFiles(files);
  const changed=results.filter(r=>!r.result.duplicateFile).length;
  toast(`اكتملت مزامنة ${results.length} ملفات. الجديد أو المحدّث: ${changed} ملفات. افتح الإدخالات السريعة للتفاصيل.`,'success');
  window.dispatchEvent(new CustomEvent('maria:ameen-import-completed',{detail:results}));
 }catch(e){if(e?.name==='AbortError')return;
   toast(`فشل التحديث: ${friendlyError(e)}${e?.completedFiles?.length?` (${e.completedFiles.length} ملف اكتمل قبل الفشل)` :''}`,'error');}
}
function reportLine(x){const r=x.result;return `<div class="ameen-summary"><strong>${esc(x.name)}</strong><span>${r.duplicateFile?'هذا الملف سبق استيراده دون تغيير':`جديد: ${r.created??0}، تحديث: ${r.updated??0}، مراجعة: ${r.review??0}، تسويات مواد: ${r.stockAdjustments??0}`}</span></div>`;}
function compactSample(kind,parsed){
 const rows=parsed.records.slice(0,7);
 const headers=kind==='inventory'?['الصنف','النوع','المستودع','الكمية','الوحدة']:kind==='orders'?['رقم الأوردر','التاريخ','الأصناف','الصافي','الفارق']:['المورد','السند','مدين','دائن','التاريخ'];
 const values=r=>kind==='inventory'?[r.name,({menu:'منيو',material:'مواد',asset:'أساسيات'}[r.kind]),r.warehouse||'—',r.quantity,r.unit]:kind==='orders'?[r.number,r.date,r.items.length,r.netTotal,r.difference]:[r.name,r.document,r.debit,r.credit,r.occurredAt.slice(0,10)];
 return `<div class="table-wrap"><table class="table ameen-preview-table"><thead><tr>${headers.map(v=>`<th>${esc(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${values(r).map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export async function renderQuickImports(root){
 root.innerHTML=`<div class="page-head"><div><h2>الإدخالات السريعة من برنامج الأمين</h2><p>رفع Excel ومراجعة بيانات الجرد والأوردرات وكشف الموردين. يمنع البرنامج التكرار تلقائيًا.</p></div><button class="btn secondary" id="ameen-refresh-in-page">↻ تحديث من المجلد</button></div>
  <div class="card ameen-upload-card"><h3>استيراد ملف يدويًا</h3><div class="form-grid"><div class="field"><label>نوع الإدخال <strong>*</strong></label><select id="ameen-kind" required><option value="">— اختر النوع —</option>${Object.entries(AMEEN_TYPES).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></div><div class="field"><label>ملف Excel بصيغة .xlsx</label><input id="ameen-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div></div><div class="quick-actions"><button class="btn" type="button" id="ameen-preview-button">معاينة الملف</button></div><p class="metric-note">لا يُرفع الملف إلى Supabase قبل معاينته وتأكيد الاستيراد. تُقرأ البيانات محليًا داخل المتصفح أولًا.</p></div>
  <div id="ameen-preview" hidden></div><div id="ameen-last-result"></div><div id="ameen-history">${loader()}</div>
  <div class="card"><div class="quick-actions"><button class="btn secondary" type="button" id="ameen-show-warehouses">عرض الجرد بحسب المستودع</button><button class="btn secondary" type="button" id="ameen-show-orders">عرض الأوردرات المستوردة</button></div><div id="ameen-imported-details"></div></div>
  <div class="notice">تُنشأ الأوردرات كمسودات فقط دون مقبوض أو حركة مخزون. وكشف الموردين مرجعي ولا ينشئ سندات دفع. لا تُحوّل كميات قسم المنيو إلى أرصدة مخزون.</div>`;
 const preview=root.querySelector('#ameen-preview');
 root.querySelector('#ameen-refresh-in-page').onclick=desktopRefresh;
 root.querySelector('#ameen-preview-button').onclick=async()=>{
  const kind=root.querySelector('#ameen-kind').value;
  const file=root.querySelector('#ameen-file').files?.[0];
  if(!kind){toast('اختر نوع الإدخال أولًا.','error');root.querySelector('#ameen-kind').focus();return;}
  if(!file){toast('اختر ملف Excel أولًا.','error');return;}
  const button=root.querySelector('#ameen-preview-button');button.disabled=true;button.textContent='جار قراءة الملف…';
  try{
   const prepared=await prepare({kind,file});
   preview.hidden=false;
   preview.innerHTML=`<div class="card ameen-preview-card"><div class="page-head"><div><h3>معاينة: ${esc(file.name)}</h3><p>${esc(AMEEN_TYPES[kind])} — الورقة «${esc(prepared.sheet)}» — ${prepared.parsed.records.length} سجل</p></div><button class="btn" id="ameen-commit">تأكيد الاستيراد</button></div>
    <div class="grid cols-3"><div class="card"><strong>${prepared.parsed.records.length}</strong><span>سجل قابل للمعالجة</span></div><div class="card"><strong>${prepared.parsed.warningCount}</strong><span>تنبيهات للمراجعة</span></div><div class="card"><strong>${kind==='inventory'?prepared.parsed.stats.warehouses.length:kind==='orders'?prepared.parsed.stats.sourceRows:prepared.parsed.stats.suppliers}</strong><span>${kind==='inventory'?'مستودعات':'عناصر مرتبطة'}</span></div></div>
    ${compactSample(kind,prepared.parsed)}${prepared.parsed.warnings.length?`<details class="ameen-warnings"><summary>عرض التنبيهات (${prepared.parsed.warningCount})</summary><ul>${prepared.parsed.warnings.slice(0,60).map(w=>`<li>السطر ${w.row}: ${esc(w.message)}</li>`).join('')}</ul></details>`:''}
    <p class="metric-note">تعتمد المطابقة على أسماء الأصناف وأرقام الطلبات وحسابات الموردين. لن يُنشر أي أوردر ماليًا عند الاستيراد.</p></div>`;
   preview.querySelector('#ameen-commit').onclick=async()=>{
    if(!(await askFiles([{file,kind}])))return;
    try{
     const results=await runAmeenFiles([{file,kind}]);
     root.querySelector('#ameen-last-result').innerHTML=results.map(reportLine).join('');
     toast('اكتمل استيراد الملف بنجاح.','success');await history();
    }catch(e){toast(`تعذر الاستيراد: ${friendlyError(e)}`,'error');}
   };
  }catch(e){preview.hidden=false;preview.innerHTML=`<div class="notice">${esc(e.message||'تعذر قراءة الملف.')}</div>`;toast(friendlyError(e),'error');}
  finally{button.disabled=false;button.textContent='معاينة الملف';}
 };
 async function history(){
  const area=root.querySelector('#ameen-history');if(!area)return;
  try{
   const rows=await api.ameenImportHistoryV024();
   area.innerHTML=`<div class="card"><h3>سجل الإدخالات السابقة</h3>${rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الوقت</th><th>نوع التقرير</th><th>الملف</th><th>سجلات</th><th>حالة المراجعة</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(new Date(r.created_at).toLocaleString('ar-SY'))}</td><td>${esc(AMEEN_TYPES[r.kind]||r.kind)}</td><td>${esc(r.filename)}</td><td>${esc(r.record_count)}</td><td>${esc(r.result?.review??0)}</td></tr>`).join('')}</tbody></table></div>`:'<p>لم تُستورد ملفات بعد.</p>'}</div>`;
  }catch(e){area.innerHTML='<div class="notice">سجل الاستيراد غير متاح. تأكد من تنفيذ SQL v0.24 أولًا.</div>';}
 }
 await history();
 const details=root.querySelector('#ameen-imported-details');
 root.querySelector('#ameen-show-warehouses').onclick=async()=>{
  details.innerHTML=loader();
  try{
   const [rows,warehouses]=await Promise.all([api.ameenInventoryV024(),api.ameenWarehousesV024()]);
   let chosen='',query='';
   details.innerHTML=`<div class="list-toolbar"><select id="ameen-filter-warehouse"><option value="">كل المستودعات</option>${warehouses.map(w=>`<option value="${esc(w.name)}">${esc(w.name)}</option>`).join('')}</select><select id="ameen-filter-kind"><option value="">كل الأنواع</option><option value="menu">المنيو</option><option value="material">المواد</option><option value="asset">الأساسيات</option></select><input id="ameen-filter-name" type="search" placeholder="ابحث باسم الصنف"></div><div id="ameen-imported-table"></div>`;
   const table=()=>{
    const kind=details.querySelector('#ameen-filter-kind').value;
    const filtered=rows.filter(r=>(!chosen||r.warehouse===chosen)&&(!kind||r.kind===kind)&&(!query||r.name.toLocaleLowerCase('ar').includes(query)));
    details.querySelector('#ameen-imported-table').innerHTML=`<p class="metric-note">${filtered.length} سجل في العرض</p><div class="table-wrap"><table class="table"><thead><tr><th>الصنف</th><th>القسم</th><th>التصنيف</th><th>المستودع</th><th>الكمية</th><th>الوحدة</th><th>المراجعة</th></tr></thead><tbody>${filtered.slice(0,500).map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(({menu:'منيو',material:'مواد',asset:'أساسيات'}[r.kind]))}</td><td>${esc(r.category||'—')}</td><td>${esc(r.warehouse||'—')}</td><td>${esc(r.quantity_original)}</td><td>${esc(r.unit_name||'—')}</td><td>${esc(r.review_reason||'—')}</td></tr>`).join('')}</tbody></table></div>${filtered.length>500?'<p class="notice">يعرض أول 500 سجل فقط؛ استخدم الفلاتر لتضييق النتائج.</p>':''}`;
   };
   details.querySelector('#ameen-filter-warehouse').onchange=e=>{chosen=e.target.value;table();};
   details.querySelector('#ameen-filter-kind').onchange=table;
   details.querySelector('#ameen-filter-name').oninput=e=>{query=e.target.value.trim().toLocaleLowerCase('ar');table();};
   table();
  }catch(e){details.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
 };
 root.querySelector('#ameen-show-orders').onclick=async()=>{
  details.innerHTML=loader();
  try{
   const rows=await api.ameenOrderImportsV024();
   details.innerHTML=`<div class="table-wrap"><table class="table"><thead><tr><th>الرقم</th><th>التاريخ</th><th>بنود</th><th>صافي الأمين</th><th>حالة الاستيراد</th><th>الأوردر</th><th>اعتماد المراجعة</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.external_number)}</td><td>${esc(r.business_date)}</td><td>${esc(r.line_payload?.length||0)}</td><td>${esc(r.source_net)}</td><td>${r.review_status==='conflict'?'<span class="badge warning">تعارض — مراجعة</span>':r.review_status==='approved'?'<span class="badge success">اعتمدت المطابقة</span>':'<span class="badge">مسودة — تحتاج مراجعة</span>'}</td><td>${r.linked_order_id?`<a href="#/order/${esc(r.linked_order_id)}">فتح المسودة</a>`:'غير مربوطة'}</td><td>${r.linked_order_id&&r.review_status==='needs_review'?`<button type="button" class="mini-btn ameen-approve" data-id="${esc(r.linked_order_id)}">اعتماد بعد المطابقة</button>`:r.review_status==='approved'?'معتمد':'—'}</td></tr>`).join('')}</tbody></table></div>`;
   details.querySelectorAll('.ameen-approve').forEach(btn=>btn.onclick=async()=>{
     const approved=await new Promise(resolve=>{
       modal({title:'اعتماد أوردر مستورد',
         body:'<div class="notice">يجب أن يكون صندوق الأوردر محددًا وأن يطابق المبلغ النهائي صافي ملف الأمين. الاعتماد لا ينشر الأوردر؛ النشر يتم لاحقًا بأمر منفصل.</div>',
         submitText:'التحقق والاعتماد',onSubmit:async()=>{resolve(true);return true;},onClose:()=>resolve(false)});
     });
     if(!approved)return;
     try{await api.approveAmeenOrderV024(btn.dataset.id);toast('تم اعتماد مطابقة الأوردر؛ يمكنك متابعة نشره من التفاصيل بعد التحقق.','success');root.querySelector('#ameen-show-orders').click();}
     catch(e){toast(friendlyError(e),'error');}
   });
  }catch(e){details.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
 };
 const onComplete=async e=>{
  if(!root.isConnected){window.removeEventListener('maria:ameen-import-completed',onComplete);return;}
  root.querySelector('#ameen-last-result').innerHTML=(e.detail||[]).map(reportLine).join('');
  await history();
 };
 window.addEventListener('maria:ameen-import-completed',onComplete);
}
