import * as api from '../api.js?v=0.24';
import { modal, toast, loader, friendlyError, confirmBox } from '../ui.js?v=0.24';
import { esc } from '../utils.js?v=0.24';

export async function renderAssets(root){
 root.innerHTML=loader();
 try{
  const [items,categories]=await Promise.all([api.restaurantAssetsV023(),api.assetCategoriesV023()]);
  const names=new Map(categories.map(c=>[String(c.id),c.name]));
  let selected='',query='';
  root.innerHTML=`<div class="page-head"><div><h2>\u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0627\u062a \u0648\u0627\u0644\u0645\u0645\u062a\u0644\u0643\u0627\u062a</h2><p>\u0637\u0627\u0648\u0644\u0627\u062a\u060c \u0643\u0631\u0627\u0633\u064a\u060c \u0635\u062d\u0648\u0646 \u0648\u0643\u0627\u0633\u0627\u062a\u060c \u0628\u0645\u0639\u0632\u0644 \u0639\u0646 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u063a\u0630\u0627\u0626\u064a \u0648\u0627\u0644\u0645\u0634\u062a\u0631\u064a\u0627\u062a.</p></div><button class="btn add-asset">\u0625\u0636\u0627\u0641\u0629 \u0623\u0633\u0627\u0633\u064a\u0627\u062a</button></div>
  <div class="list-toolbar"><div class="search-box"><input type="search" id="asset-query" placeholder="\u0627\u0644\u0628\u062d\u062b \u0639\u0646 \u0645\u0645\u062a\u0644\u0643\u0627\u062a"></div>
  <select id="asset-category-filter"><option value="">\u0643\u0644 \u0627\u0644\u062a\u0635\u0646\u064a\u0641\u0627\u062a</option>${categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
  <div id="asset-results"></div>`;
  const show=()=>{
   const rows=items.filter(x=>(!selected||String(x.category_id)===selected)&&(!query||x.name.toLowerCase().includes(query)));
   const low=rows.filter(x=>Number(x.quantity)<=Number(x.minimum_quantity));
   root.querySelector('#asset-results').innerHTML=`<div class="grid cols-3 finance-summary-grid">
    <div class="card"><strong>${rows.length}</strong><div class="metric-note">\u0639\u0646\u0627\u0635\u0631 \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0627\u062a</div></div>
    <div class="card"><strong>${low.length}</strong><div class="metric-note">\u062a\u062d\u062a \u0627\u0644\u062d\u062f \u0627\u0644\u0623\u062f\u0646\u0649</div></div>
    <div class="card"><strong>${rows.reduce((s,x)=>s+Number(x.quantity||0),0)}</strong><div class="metric-note">\u0639\u062f\u062f \u0627\u0644\u0642\u0637\u0639</div></div></div>
    <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>\u0627\u0644\u0627\u0633\u0645</th><th>\u0627\u0644\u062a\u0635\u0646\u064a\u0641</th><th>\u0627\u0644\u0639\u062f\u062f</th><th>\u062d\u062f \u0627\u0644\u062a\u0646\u0628\u064a\u0647</th><th>\u0627\u0644\u062d\u0627\u0644\u0629</th><th>\u0625\u062c\u0631\u0627\u0621</th></tr></thead><tbody>
    ${rows.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(names.get(String(x.category_id))||'\u2014')}</td><td>${esc(x.quantity)}</td><td>${esc(x.minimum_quantity)}</td><td>${Number(x.quantity)<=Number(x.minimum_quantity)?'<span class="badge warning">\u0645\u0646\u062e\u0641\u0636</span>':'<span class="badge green">\u062c\u064a\u062f</span>'}</td><td><button class="mini-btn asset-edit" data-id="${esc(x.id)}">\u062a\u0639\u062f\u064a\u0644</button> <button class="mini-btn danger-lite asset-delete" data-id="${esc(x.id)}">\u062d\u0630\u0641</button></td></tr>`).join('')||'<tr><td colspan="6">\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u062a\u0627\u0626\u062c.</td></tr>'}</tbody></table></div></div>`;
   root.querySelectorAll('.asset-edit').forEach(b=>b.onclick=()=>assetForm(items.find(x=>String(x.id)===b.dataset.id)));
   root.querySelectorAll('.asset-delete').forEach(b=>b.onclick=async()=>{
    if(!(await confirmBox('\u062d\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0639\u0646\u0635\u0631\u061f','\u062d\u0630\u0641')))return;
    try{await api.deleteRestaurantAssetV023(b.dataset.id);await renderAssets(root);}catch(e){toast(friendlyError(e),'error');}
   });
  };
  const assetForm=row=>modal({
   title:row?'\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0627\u062a':'\u0625\u0636\u0627\u0641\u0629 \u0623\u0633\u0627\u0633\u064a\u0627\u062a',
   body:`<div class="form-grid"><div class="field full"><label>\u0627\u0644\u0627\u0633\u0645</label><input name="name" required maxlength="120" value="${esc(row?.name||'')}"></div>
    <div class="field"><label>\u0627\u0644\u062a\u0635\u0646\u064a\u0641</label><select name="category"><option value="">\u0628\u0644\u0627 \u062a\u0635\u0646\u064a\u0641</option>${categories.map(c=>`<option value="${esc(c.id)}" ${c.id===row?.category_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>\u0627\u0644\u0639\u062f\u062f</label><input name="quantity" type="number" min="0" step="any" required value="${esc(row?.quantity??0)}"></div>
    <div class="field"><label>\u062d\u062f \u0627\u0644\u062a\u0646\u0628\u064a\u0647</label><input name="minimum" type="number" min="0" step="any" required value="${esc(row?.minimum_quantity??0)}"></div>
    <div class="field full"><label>\u0645\u0644\u0627\u062d\u0638\u0629</label><textarea name="notes" rows="2">${esc(row?.notes||'')}</textarea></div></div>`,
   onSubmit:async fd=>{try{
    const quantity=Number(fd.get('quantity')),minimum=Number(fd.get('minimum'));
    if(!Number.isFinite(quantity)||quantity<0||!Number.isFinite(minimum)||minimum<0)throw Error('INVALID_ASSET_QUANTITY');
    const payload={name:String(fd.get('name')).trim(),category_id:fd.get('category')||null,quantity,minimum_quantity:minimum,notes:fd.get('notes')||null};
    if(!payload.name)throw Error('ASSET_NAME_REQUIRED');
    if(row)await api.updateRestaurantAssetV023(row.id,payload);else await api.createRestaurantAssetV023(payload);
    toast('\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0627\u062a','success');await renderAssets(root);return true;
   }catch(e){toast(friendlyError(e),'error');return false;}}
  });
  root.querySelector('.add-asset').onclick=()=>assetForm();
  root.querySelector('#asset-query').oninput=e=>{query=e.target.value.trim().toLowerCase();show();};
  root.querySelector('#asset-category-filter').onchange=e=>{selected=e.target.value;show();};
  show();
 }catch(e){root.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
}
