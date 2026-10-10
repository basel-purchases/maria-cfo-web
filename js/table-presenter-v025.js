// Stable, pure presentation helpers: no database writes, no hidden changes to imported figures.
export const PAGE_SIZES=Object.freeze({menu:18,orders:25,materials:10,assets:20,suppliers:25,ledger:30});

export function pageInfo(total,page,size){
 const safeTotal=Math.max(0,Number(total)||0), safeSize=Math.max(1,Number(size)||20);
 const pages=Math.max(1,Math.ceil(safeTotal/safeSize));
 const current=Math.min(pages,Math.max(1,Math.trunc(Number(page)||1)));
 return {total:safeTotal,pages,page:current,from:safeTotal?(current-1)*safeSize+1:0,to:Math.min(safeTotal,current*safeSize)};
}
export function paginateArray(items,page,size){
 const meta=pageInfo(items.length,page,size);
 return {rows:items.slice((meta.page-1)*size,meta.page*size),...meta};
}
export function numericValue(v){
 if(v===null||v===undefined||v==='')return null;
 const n=Number(v);return Number.isFinite(n)?n:null;
}
export function sourceIndex(rows,kind){
 const byId=new Map(),byName=new Map();
 for(const row of rows||[]){
  if(row.kind!==kind)continue;
  const id=row.core_entity_id==null?'':String(row.core_entity_id);
  const name=String(row.name||'').trim().toLowerCase();
  if(id){const arr=byId.get(id)||[];arr.push(row);byId.set(id,arr);}
  else if(name){const arr=byName.get(name)||[];arr.push(row);byName.set(name,arr);}
 }
 return {byId,byName};
}
export function importedRowsFor(entity,index){
 return [...(index?.byId.get(String(entity.id))||[]),...(index?.byName.get(String(entity.name||'').trim().toLowerCase())||[])];
}
export function supplierBalanceState(account){
 if(!account)return 'no-import';
 const value=numericValue(account.current_balance);
 if(value===null)return 'unknown';
 if(value>0.0000001)return 'unpaid';
 if(value< -0.0000001)return 'credit';
 return 'settled';
}
export function suppliersFilter(rows,{query='',status='all'}={}){
 const term=String(query).trim().toLocaleLowerCase('ar');
 return rows.filter(r=>{
  const state=supplierBalanceState(r.account);
  if(status!=='all'&&status!==state)return false;
  if(!term)return true;
  return [r.name,r.code,r.phone,r.contact,r.account?.supplier_name]
   .some(x=>String(x||'').toLocaleLowerCase('ar').includes(term));
 });
}
export function mergeSupplierRecords(coreRows=[],accounts=[]){
 const byId=new Map(accounts.filter(a=>a.supplier_id).map(a=>[String(a.supplier_id),a]));
 const byCode=new Map(accounts.map(a=>[String(a.external_account),a]));
 const linked=new Set();
 const rows=coreRows.filter(s=>s.notes!=='SYSTEM_DIRECT_PURCHASE'&&s.name!=='شراء مباشر').map(s=>{
  const a=byId.get(String(s.id))||byCode.get(String(s.ameen_account_code_v024));
  if(a)linked.add(String(a.external_account));
  return {id:s.id,name:s.name,phone:s.phone||'',contact:s.contact_name||'',
    code:a?.external_account||s.ameen_account_code_v024||'',account:a||null};
 });
 for(const a of accounts){
  if(linked.has(String(a.external_account)))continue;
  rows.push({id:null,name:a.supplier_name,phone:'',contact:'',code:a.external_account,account:a});
 }
 return rows.sort((a,b)=>a.name.localeCompare(b.name,'ar'));
}
