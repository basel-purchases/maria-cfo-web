import * as api from '../api.js?v=0.27';
import {modal,toast,loader,friendlyError,confirmBox} from '../ui.js?v=0.27';
import {esc,money} from '../utils.js?v=0.27';
import {registerTableExport} from '../table-export-v027.js?v=0.27';
import {PAGE_SIZES,paginateArray,sourceIndex,importedRowsFor} from '../table-presenter-v025.js?v=0.27';
import {importedStockSummary,importedPrice,importedRowHasWarning,showImportedSourceDialog} from '../imported-source-ui-v025.js?v=0.27';

export async function renderAssets(root){
 root.innerHTML=loader();
 try{
  const [items,categories,imported]=await Promise.all([
   api.restaurantAssetsV023(),api.assetCategoriesV023(),
   api.allAmeenInventoryV025().catch(e=>{console.warn('Imported asset reference unavailable',e);return [];})
  ]);
  const names=new Map(categories.map(c=>[String(c.id),c.name]));
  const source=sourceIndex(imported,'asset');
  const state={category:'',query:'',page:1};
  root.innerHTML=`
   <div class="page-head"><div><h2>الأساسيات والممتلكات</h2>
    <p>جرد التجهيزات والأواني، مع عددها الحالي ومواقعها وكمياتها ووحداتها كما جاءت في كشف الأمين.</p>
   </div><button class="btn add-asset">إضافة أساسيات</button></div>
   <div class="list-toolbar">
     <div class="search-box"><span aria-hidden="true">⌕</span><input type="search" id="asset-query" placeholder="ابحث باسم الأساسيات"></div>
     <select id="asset-category-filter"><option value="">كل التصنيفات</option>${categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
     <span class="list-count" id="asset-count"></span>
   </div>
   <div id="asset-results"></div>`;

  const assetForm=row=>modal({
   title:row?'تعديل الأساسيات':'إضافة أساسيات',
   body:`<div class="form-grid">
    <div class="field full"><label>الاسم</label><input name="name" required maxlength="120" value="${esc(row?.name||'')}"></div>
    <div class="field"><label>التصنيف</label><select name="category"><option value="">بلا تصنيف</option>${categories.map(c=>`<option value="${esc(c.id)}" ${c.id===row?.category_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>العدد</label><input name="quantity" type="number" min="0" step="any" required value="${esc(row?.quantity??0)}"></div>
    <div class="field"><label>حد التنبيه</label><input name="minimum" type="number" min="0" step="any" required value="${esc(row?.minimum_quantity??0)}"></div>
    <div class="field full"><label>ملاحظة</label><textarea name="notes" rows="2">${esc(row?.notes||'')}</textarea></div></div>`,
   onSubmit:async fd=>{
    try{
     const quantity=Number(fd.get('quantity')),minimum=Number(fd.get('minimum'));
     if(!Number.isFinite(quantity)||quantity<0||!Number.isFinite(minimum)||minimum<0)throw Error('INVALID_ASSET_QUANTITY');
     const payload={name:String(fd.get('name')).trim(),category_id:fd.get('category')||null,quantity,minimum_quantity:minimum,notes:fd.get('notes')||null};
     if(!payload.name)throw Error('ASSET_NAME_REQUIRED');
     if(row)await api.updateRestaurantAssetV023(row.id,payload);
     else await api.createRestaurantAssetV023(payload);
     toast('تم حفظ الأساسيات','success');await renderAssets(root);return true;
    }catch(e){toast(friendlyError(e),'error');return false;}
   }
  });

  const draw=()=>{
   const filtered=items.filter(x=>(!state.category||String(x.category_id||'')===state.category)&&
     (!state.query||String(x.name||'').toLocaleLowerCase('ar').includes(state.query)));
   const low=filtered.filter(x=>Number(x.quantity)<=Number(x.minimum_quantity));
   const info=paginateArray(filtered,state.page,PAGE_SIZES.assets);
   state.page=info.page;
   root.querySelector('#asset-count').textContent=`${filtered.length} عنصر`;
   root.querySelector('#asset-results').innerHTML=`
     <div class="grid cols-3 finance-summary-grid">
      <div class="card"><strong>${filtered.length}</strong><div class="metric-note">العناصر المطابقة</div></div>
      <div class="card"><strong>${low.length}</strong><div class="metric-note">عند حد التنبيه أو دونه</div></div>
      <div class="card"><strong>${filtered.reduce((s,x)=>s+Number(x.quantity||0),0)}</strong><div class="metric-note">العدد الحالي الإجمالي</div></div>
     </div>
     <div class="card"><div class="table-wrap assets-table-scroll"><table class="table asset-details-table">
      <thead><tr><th>الأساسيات</th><th>التصنيف</th><th>الوحدة</th><th>العدد الحالي</th><th>حد التنبيه</th>
      <th>المستودع وكمية الأمين</th><th>سعر الأمين</th><th>الحالة</th><th>الملاحظات</th><th>إجراء</th></tr></thead>
      <tbody>${info.rows.map(x=>{
       const sourceRows=importedRowsFor(x,source),price=importedPrice(sourceRows);
       return `<tr>
        <td><strong>${esc(x.name)}</strong></td>
        <td>${esc(names.get(String(x.category_id))||'—')}</td>
        <td>${esc(x.ameen_unit_v024||sourceRows[0]?.unit_name||'قطعة')}</td>
        <td><strong>${esc(x.quantity)}</strong></td><td>${esc(x.minimum_quantity)}</td>
        <td><span class="source-stock-summary">${esc(importedStockSummary(sourceRows))}</span></td>
        <td>${price==null?'—':esc(money(price,'SYP'))}</td>
        <td>${Number(x.quantity)<=Number(x.minimum_quantity)?'<span class="badge yellow">منخفض</span>':'<span class="badge green">جيد</span>'}${importedRowHasWarning(sourceRows)?'<span class="badge yellow">مراجعة المصدر</span>':''}</td>
        <td>${esc(x.notes||'—')}</td>
        <td><div class="material-actions">
         <button class="mini-btn asset-edit" data-id="${esc(x.id)}">تعديل</button>
         ${sourceRows.length?`<button class="mini-btn asset-source" data-id="${esc(x.id)}">تفاصيل الجرد</button>`:''}
         <button class="mini-btn danger-lite asset-delete" data-id="${esc(x.id)}">حذف</button>
        </div></td>
       </tr>`;
      }).join('')||'<tr><td colspan="10">لا توجد نتائج.</td></tr>'}</tbody>
     </table></div>
     ${info.pages>1?`<div class="pagination-bar">
      <button class="mini-btn page-prev" ${info.page<=1?'disabled':''}>السابق</button>
      <span>${info.from}–${info.to} من ${info.total} · صفحة ${info.page} من ${info.pages}</span>
      <button class="mini-btn page-next" ${info.page>=info.pages?'disabled':''}>التالي</button>
     </div>`:''}</div>`;
   registerTableExport(root.querySelector('.asset-details-table'),()=>({
    title:'الأساسيات - حسب التصفية',
    headers:['الاسم','التصنيف','الوحدة','العدد الحالي','حد التنبيه','كمية جرد الأمين','سعر الأمين','ملاحظات'],
    rows:filtered.map(x=>{const sr=importedRowsFor(x,source);const pr=importedPrice(sr);return [x.name,names.get(String(x.category_id))||'',x.ameen_unit_v024||sr[0]?.unit_name||'',x.quantity,x.minimum_quantity,importedStockSummary(sr),pr==null?'':pr,x.notes||''];})
   }));
   root.querySelectorAll('.asset-edit').forEach(b=>b.onclick=()=>assetForm(items.find(x=>String(x.id)===b.dataset.id)));
   root.querySelectorAll('.asset-source').forEach(b=>b.onclick=()=>{
    const x=items.find(x=>String(x.id)===b.dataset.id);if(x)showImportedSourceDialog(x.name,importedRowsFor(x,source));
   });
   root.querySelectorAll('.asset-delete').forEach(b=>b.onclick=async()=>{
    if(!(await confirmBox('حذف هذا العنصر؟','حذف')))return;
    try{await api.deleteRestaurantAssetV023(b.dataset.id);await renderAssets(root);}
    catch(e){toast(friendlyError(e),'error');}
   });
   root.querySelector('.page-prev')?.addEventListener('click',()=>{state.page--;draw();});
   root.querySelector('.page-next')?.addEventListener('click',()=>{state.page++;draw();});
  };
  root.querySelector('.add-asset').onclick=()=>assetForm();
  root.querySelector('#asset-query').oninput=e=>{state.query=e.target.value.trim().toLocaleLowerCase('ar');state.page=1;draw();};
  root.querySelector('#asset-category-filter').onchange=e=>{state.category=e.target.value;state.page=1;draw();};
  draw();
 }catch(e){root.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
}
