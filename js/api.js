import { supabase, configured } from './supabase.js?v=0.24';
import { sleep, todayISO, unitLabel } from './utils.js?v=0.24';
import { isVagueContextualName } from './unit-catalog.js?v=0.24';
import { buildEmployeePayload, buildAttendanceArgs, buildEventArgs } from './business-rules.js?v=0.24';

function need(){
  if(!configured || !supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
}

async function dataOrThrow(p){
  const {data,error}=await p;
  if(error) throw error;
  return data;
}

export async function signIn(email,password){
  return dataOrThrow(need().auth.signInWithPassword({email,password}));
}

export async function signOut(){ await need().auth.signOut(); }
export async function session(){ return (await need().auth.getSession()).data.session; }
export function authEvents(cb){ return need().auth.onAuthStateChange((_e,s)=>cb(s)); }
export async function isOwner(){
  const {data,error}=await need().rpc('is_app_owner');
  if(error) throw error;
  return data===true;
}

export async function list(table,{select='*',order=null,ascending=false,eq={},limit=500}={}){
  let q=need().from(table).select(select);
  for(const [k,v] of Object.entries(eq)) q=q.eq(k,v);
  if(order) q=q.order(order,{ascending});
  if(limit) q=q.limit(limit);
  return dataOrThrow(q);
}

export async function one(table,id){
  const {data,error}=await need().from(table).select('*').eq('id',id).maybeSingle();
  if(error) throw error;
  return data;
}

export async function insert(table,payload){
  const {data,error}=await need().from(table).insert(payload).select().single();
  if(error) throw error;
  return data;
}

export async function insertFirst(table,payloads){
  let last;
  for(const payload of payloads){
    try{return await insert(table,payload);}catch(e){last=e;}
  }
  throw last;
}

export async function update(table,id,patch){
  const {data,error}=await need().from(table).update(patch).eq('id',id).select().single();
  if(error) throw error;
  return data;
}

export async function updateFirst(table,id,patches){
  let last;
  for(const patch of patches){
    try{return await update(table,id,patch);}catch(e){last=e;}
  }
  throw last;
}

export async function remove(table,id){
  const {error}=await need().from(table).delete().eq('id',id);
  if(error) throw error;
}

export async function rpc(name,args={}){
  const {data,error}=await need().rpc(name,args);
  if(error) throw error;
  return data;
}

export async function dashboard(){
  return rpc('get_home_dashboard',{p_business_date:todayISO()});
}

export async function notifications(){
  try{return await list('visible_notifications',{order:'created_at',limit:30});}
  catch(_){return list('notifications',{order:'created_at',limit:30});}
}

export async function materials(){
  try{return await list('materials',{order:'created_at',ascending:true,limit:1000});}
  catch(_){
    try{return await list('materials',{order:'id',ascending:true,limit:1000});}
    catch(__){return list('materials',{order:'name',ascending:true,limit:1000});}
  }
}

// Actual latest purchase movement by occurred_at, not the latest row insertion time.
export async function latestMaterialPurchasePrices(){
  const results=new Map();
  // Use verified read-only SQL after migration; old deployments have a bounded fallback.
  try{
    const rows=await rpc('get_latest_material_purchase_prices_v023');
    if(Array.isArray(rows)){
      for(const r of rows){
        if(r.material_id!=null && r.price_per_base!=null) results.set(String(r.material_id),Number(r.price_per_base));
      }
      return results;
    }
  }catch(e){console.info('latest price RPC fallback',e?.code||e?.message);}

  const page=750;
  for(let offset=0;offset<15000;offset+=page){
    const q=need().from('inventory_movements')
      .select('material_id,movement_type,quantity_delta_base,unit_cost_base_per_base_unit,occurred_at')
      .eq('movement_type','purchase').order('occurred_at',{ascending:false})
      .range(offset,offset+page-1);
    const rows=await dataOrThrow(q);
    for(const r of rows){
      const id=String(r.material_id||'');
      const price=Number(r.unit_cost_base_per_base_unit);
      if(id&&!results.has(id)&&Number(r.quantity_delta_base)>0&&Number.isFinite(price))results.set(id,price);
    }
    if(rows.length<page)break;
  }
  return results;
}

export async function recordInventoryMovement({materialId,quantityDelta,movementType='opening',unitCost=null,note=null}){
  const occurredAt=new Date().toISOString();
  const qty=Number(quantityDelta);
  const cost=unitCost===null || unitCost==='' ? null : Number(unitCost);
  const variants=[
    {
      p_material_id:materialId,
      p_movement_type:movementType,
      p_quantity_delta_base:qty,
      p_unit_cost_base_per_base_unit:cost,
      p_occurred_at:occurredAt,
      p_source_type:'manual_adjustment',
      p_source_id:null,
      p_source_line_id:null,
      p_note:note,
    },
    {
      p_material_id:materialId,
      p_movement_type:movementType,
      p_quantity_delta_base:qty,
      p_unit_cost_base:cost,
      p_note:note,
    },
  ];
  let last;
  for(const args of variants){
    try{return await rpc('record_inventory_movement',args);}catch(e){last=e;}
  }
  throw last;
}

export async function setMaterialReferencePrice(materialId,unitCost){
  const cost=Number(unitCost);
  if(!(cost>=0)) throw new Error('INVALID_REFERENCE_PRICE');
  return updateFirst('materials',materialId,[
    {latest_purchase_unit_cost_base:cost},
    {last_purchase_unit_cost_base:cost},
    {current_unit_cost_base:cost},
  ]);
}

export async function setMaterialAlertMinimum(materialId,value,row=null){
  const amount=Number(value);
  if(!(amount>=0)) throw new Error('INVALID_STOCK_ALERT_MINIMUM');

  const known=[
    'target_stock_base',
    'target_stock_quantity_base',
    'minimum_stock_base',
    'min_stock_base',
    'minimum_stock_quantity_base',
    'stock_alert_minimum_base',
  ];

  const keys=Object.keys(row||{});
  const existing=known.find(k=>keys.includes(k)) || keys.find(k=>
    /(^|_)(target|minimum|min)(_|).*stock|stock.*(target|minimum|min)|alert.*(stock|quantity)/i.test(k)
  );
  if(existing){
    try{return await update('materials',materialId,{[existing]:amount});}catch(_){}
  }

  return updateFirst('materials',materialId,known.map(k=>({[k]:amount})));
}

export async function saveMaterialInitialState({materialId,openingQuantity=null,referenceUnitCost=null}){
  const hasQty=openingQuantity!==null && openingQuantity!=='' && Number(openingQuantity)!==0;
  const hasCost=referenceUnitCost!==null && referenceUnitCost!=='';
  if(hasQty){
    await recordInventoryMovement({
      materialId,
      quantityDelta:Number(openingQuantity),
      movementType:'opening',
      unitCost:hasCost ? Number(referenceUnitCost) : null,
      note:'رصيد افتتاحي من إعداد المادة',
    });
  }
  if(hasCost){
    try{await setMaterialReferencePrice(materialId,Number(referenceUnitCost));}
    catch(e){console.warn('Reference price snapshot was not updated; opening movement remains authoritative when available.',e);}
  }
}

// A paged catalog read prevents silent truncation by PostgREST's max-rows.
export async function catalogRows(table,select='*'){
  const out=[];
  const pageSize=500;
  for(let start=0;start<100000;start+=pageSize){
    const rows=await dataOrThrow(need().from(table).select(select)
      .order('id',{ascending:true}).range(start,start+pageSize-1));
    out.push(...rows);
    if(rows.length<pageSize) return out;
  }
  throw new Error('UNIT_CATALOG_TOO_LARGE');
}

export async function units(){
  const rows=await catalogRows('units');
  const preferred=[
    'PCS','TRAY','SAHARA','CAN','CARTON','BOX','PACK','PACKET','SACK','BAG',
    'KG','G','L','ML','SACHET','SPOON','TBSP','TSP','SCOOP','CUP','GLASS',
    'BOTTLE','BTL','JAR','PAIL','BUCKET','CRATE','BOWL','SLICE','PORTION',
    'SERVING','BUNCH','BUNDLE','ROLL','SHEET','LOAF','DOZ','DOZEN','UNIT'
  ];
  const rank=new Map(preferred.map((code,i)=>[code,i]));
  return rows.slice().sort((a,b)=>{
    const ac=String(a.code||'').toUpperCase();
    const bc=String(b.code||'').toUpperCase();
    const ar=rank.has(ac)?rank.get(ac):999;
    const br=rank.has(bc)?rank.get(bc):999;
    return ar-br || ac.localeCompare(bc);
  });
}

export async function allMaterialUnitLinks(){
  return catalogRows('material_units','id,material_id,unit_id,quantity_in_base,is_purchase_unit');
}

export async function unitConversions(){
  return catalogRows('unit_conversions');
}

export async function saveNamedUnit({id=null,name,materialId,quantityInBase}){
  return rpc('save_named_unit_v018',{
    p_unit_id:id || null,
    p_name:String(name||'').trim(),
    p_code:null,
    p_material_id:materialId,
    p_quantity_in_base:Number(quantityInBase),
  });
}

export async function deleteNamedUnit(id){
  return rpc('delete_named_unit_v018',{p_unit_id:id});
}

export async function catalogMaterials(){
  return catalogRows('materials','id,name,base_unit_id');
}

export async function materialUnits(materialId){
  try{return await list('material_units',{order:'created_at',ascending:true,eq:{material_id:materialId},limit:300});}
  catch(_){return list('material_units',{order:'id',ascending:true,eq:{material_id:materialId},limit:300});}
}

export async function saveMaterialUnit({materialId,unitId,quantityInBase,isPurchaseUnit=false}){
  const factor=Number(quantityInBase);
  if(!materialId || !unitId || !(factor>0)) throw new Error('INVALID_MATERIAL_UNIT_CONVERSION');

  const rows=await materialUnits(materialId);
  const existing=rows.find(r=>String(r.unit_id)===String(unitId));
  const patches=[
    {quantity_in_base:factor,is_purchase_unit:Boolean(isPurchaseUnit)},
    {quantity_in_base:factor,is_purchase_unit:Boolean(isPurchaseUnit),is_active:true},
  ];
  if(existing) return updateFirst('material_units',existing.id,patches);

  return insertFirst('material_units',[
    {material_id:materialId,unit_id:unitId,quantity_in_base:factor,is_purchase_unit:Boolean(isPurchaseUnit)},
    {material_id:materialId,unit_id:unitId,quantity_in_base:factor,is_purchase_unit:Boolean(isPurchaseUnit),is_active:true},
  ]);
}

export async function ensureStandardMaterialUnits(material,allUnits=null){
  if(!material?.id || !material?.base_unit_id) return;
  const unitsList=allUnits || await units();
  const base=unitsList.find(u=>String(u.id)===String(material.base_unit_id));
  const code=String(base?.code||'').toUpperCase();
  const standard={
    KG:{code:'G',factor:0.001},
    G:{code:'KG',factor:1000},
    L:{code:'ML',factor:0.001},
    ML:{code:'L',factor:1000},
  }[code];
  if(!standard) return;
  const other=unitsList.find(u=>String(u.code||'').toUpperCase()===standard.code);
  if(!other) return;
  const rows=await materialUnits(material.id);
  if(rows.some(r=>String(r.unit_id)===String(other.id))) return;
  try{
    await saveMaterialUnit({
      materialId:material.id,
      unitId:other.id,
      quantityInBase:standard.factor,
      isPurchaseUnit:false,
    });
  }catch(e){
    console.warn('Could not add standard material unit conversion',e);
  }
}

export async function nextMaterialCode(rows=null){
  const all=rows || await materials();
  const used=new Set(all.map(r=>String(r.quick_code||r.code||'').trim()).filter(Boolean));
  let max=0;
  for(const code of used){
    const m=code.match(/^M-?(\d+)$/i);
    if(m) max=Math.max(max,Number(m[1]));
  }
  let n=max+1;
  let candidate;
  do{
    candidate=`M-${String(n).padStart(4,'0')}`;
    n++;
  }while(used.has(candidate));
  return candidate;
}

export async function ensureMaterialCodes(rows){
  const out=rows.map(r=>({...r}));
  const used=new Set(out.map(r=>String(r.quick_code||r.code||'').trim()).filter(Boolean));
  let max=0;
  for(const code of used){
    const m=code.match(/^M-?(\d+)$/i);
    if(m) max=Math.max(max,Number(m[1]));
  }
  for(const row of out){
    if(String(row.quick_code||row.code||'').trim()) continue;
    let code;
    do{
      max++;
      code=`M-${String(max).padStart(4,'0')}`;
    }while(used.has(code));
    try{
      const updated=await updateFirst('materials',row.id,[{quick_code:code},{code}]);
      Object.assign(row,updated||{}, {quick_code:updated?.quick_code||row.quick_code||code});
      used.add(code);
    }catch(e){
      console.warn('Could not backfill material code',row.id,e);
      row.__generatedCode=code;
      used.add(code);
    }
  }
  return out;
}

export const suppliers=()=>list('suppliers',{order:'name',ascending:true,limit:500});
export const purchases=()=>list('purchase_invoices',{order:'occurred_at',limit:500});
export const purchaseItems=id=>list('purchase_invoice_items',{order:'id',ascending:true,eq:{invoice_id:id},limit:500});

export async function menuItems(){
  let master=[];
  try{master=await list('menu_items',{order:'name',ascending:true,limit:500});}catch(_){}
  let costs=[];
  try{costs=await list('menu_item_costs',{order:'name',ascending:true,limit:500});}catch(_){}
  if(!master.length) return costs;
  const costMap=Object.fromEntries(costs.map(x=>[String(x.id),x]));
  return master.map(m=>({...m,...(costMap[String(m.id)]||{}),...m}));
}

export async function createMenuItem({name,price=null,foodCost=null,discount=null,categoryId=null}){
  const payload={
    name:String(name||'').trim(),
    category_id:categoryId||null,
    manual_price_original:price===''||price===null ? null : Number(price),
    target_food_cost_percent:foodCost===''||foodCost===null ? null : Number(foodCost),
    default_discount_percent:discount===''||discount===null ? 0 : Number(discount),
  };
  return insertFirst('menu_items',[
    payload,
    {...payload,manual_price:payload.manual_price_original},
  ]);
}

export async function setMenuPrice(menuItemId,price){
  if(price==='' || price===null || price===undefined){
    return updateFirst('menu_items',menuItemId,[
      {manual_price_original:null},
      {manual_price:null},
      {price:null},
    ]);
  }
  const value=Number(price);
  try{
    return await rpc('set_menu_item_manual_price',{p_menu_item_id:menuItemId,p_price_original:value});
  }catch(_){
    try{return await rpc('set_menu_item_manual_price',{p_menu_item_id:menuItemId,p_price:value});}
    catch(__){return updateFirst('menu_items',menuItemId,[{manual_price_original:value},{manual_price:value},{price:value}]);}
  }
}

export async function updateMenuItem(id,{name,price=null,foodCost=null,discount=null,categoryId=null}){
  const patch={
    name:String(name||'').trim(),
    category_id:categoryId||null,
    target_food_cost_percent:foodCost===''||foodCost===null ? null : Number(foodCost),
    default_discount_percent:discount===''||discount===null ? 0 : Number(discount),
  };
  const updated=await updateFirst('menu_items',id,[patch]);
  await setMenuPrice(id,price);
  return updated;
}

export const recipeItems=id=>list('menu_item_recipe_items',{order:'id',ascending:true,eq:{menu_item_id:id},limit:200});

async function recipeQuantityBase(materialId,unitId,quantity){
  const material=await one('materials',materialId);
  if(!material) throw new Error('MATERIAL_NOT_FOUND');
  const q=Number(quantity);
  if(!(q>0)) throw new Error('INVALID_RECIPE_QUANTITY');
  if(String(unitId)===String(material.base_unit_id)) return q;
  const rows=await materialUnits(materialId);
  const rel=rows.find(r=>String(r.unit_id)===String(unitId));
  const factor=Number(rel?.quantity_in_base);
  if(!(factor>0)) throw new Error('RECIPE_UNIT_NOT_CONFIGURED');
  return q*factor;
}

async function saveRecipeItemFallback({menuItemId,materialId,unitId,quantity,recipeItemId=null}){
  const q=Number(quantity);
  const qBase=await recipeQuantityBase(materialId,unitId,q);
  const shared={
    material_id:materialId,
    input_unit_id:unitId,
    input_quantity:q,
  };
  const patches=[
    {...shared,unit_id:unitId,quantity_original:q,quantity_base:qBase},
    {...shared,unit_id:unitId,quantity:q,quantity_base:qBase},
    {...shared,unit_id:unitId,quantity_original:q},
    {...shared,unit_id:unitId,quantity:q},
    {material_id:materialId,unit_id:unitId,quantity:q},
    {material_id:materialId,unit_id:unitId,quantity_original:q},
  ];
  if(recipeItemId) return updateFirst('menu_item_recipe_items',recipeItemId,patches);
  return insertFirst('menu_item_recipe_items',patches.map(x=>({menu_item_id:menuItemId,...x})));
}

async function verifyRecipeSave({menuItemId,materialId,unitId,quantity}){
  const rows=await recipeItems(menuItemId);
  const row=rows.find(r=>String(r.material_id)===String(materialId));
  if(!row) throw new Error('RECIPE_SAVE_VERIFY_FAILED');

  const savedUnit=String(row.input_unit_id||row.unit_id||'');
  const savedQty=Number(row.input_quantity??row.quantity_original??row.quantity??NaN);
  const expectedQty=Number(quantity);

  if(String(unitId)!==savedUnit || !Number.isFinite(savedQty) || Math.abs(savedQty-expectedQty)>1e-9){
    throw new Error('RECIPE_SAVE_VERIFY_FAILED');
  }
  return row;
}

export async function addRecipeItem({menuItemId,materialId,unitId,quantity}){
  const q=Number(quantity);
  if(!(q>0)) throw new Error('INVALID_RECIPE_QUANTITY');
  const args={
    p_menu_item_id:menuItemId,
    p_material_id:materialId,
    p_input_unit_id:unitId,
    p_input_quantity:q,
    p_recipe_item_id:null,
  };
  await rpc('save_menu_recipe_item_v07',args);
  return verifyRecipeSave({menuItemId,materialId,unitId,quantity:q});
}

export async function updateRecipeItem(id,{unitId,quantity}){
  const q=Number(quantity);
  if(!(q>0)) throw new Error('INVALID_RECIPE_QUANTITY');
  const row=await one('menu_item_recipe_items',id);
  if(!row) throw new Error('RECIPE_ITEM_NOT_FOUND');
  const args={
    p_menu_item_id:row.menu_item_id,
    p_material_id:row.material_id,
    p_input_unit_id:unitId,
    p_input_quantity:q,
    p_recipe_item_id:id,
  };
  await rpc('save_menu_recipe_item_v07',args);
  return verifyRecipeSave({
    menuItemId:row.menu_item_id,
    materialId:row.material_id,
    unitId,
    quantity:q,
  });
}

export async function deleteRecipeItem(id){
  try{return await rpc('delete_menu_recipe_item',{p_recipe_item_id:id});}
  catch(_){return remove('menu_item_recipe_items',id);}
}

function normalizeUnitText(value){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
}

export function findUnitByText(value,allUnits=[]){
  const q=normalizeUnitText(value);
  if(!q) return null;
  return allUnits.find(u=>{
    const name=normalizeUnitText(u.name);
    const code=normalizeUnitText(u.code);
    const label=normalizeUnitText(unitLabel(u.code));
    return q===name || q===code || q===label;
  }) || null;
}

export async function saveCustomUnit({id=null,name,code=null}){
  const cleanName=String(name||'').trim();
  const cleanCode=String(code||'').trim();
  if(!cleanName) throw new Error('UNIT_NAME_REQUIRED');
  return rpc('save_custom_unit_v06',{
    p_unit_id:id || null,
    p_name:cleanName,
    p_code:cleanCode || null,
  });
}

export async function resolveUnit(value,allUnits=[]){
  const clean=String(value||'').trim();
  if(!clean) throw new Error('UNIT_REQUIRED');
  if(isVagueContextualName(clean)) throw new Error('UNIT_NAME_TOO_GENERIC');
  const found=findUnitByText(clean,allUnits);
  if(found) return found;
  const id=await saveCustomUnit({name:clean});
  const rows=await units();
  return rows.find(u=>String(u.id)===String(id)) || findUnitByText(clean,rows) || {id,name:clean,code:clean};
}

export async function deleteCustomUnit(id){
  return rpc('delete_custom_unit_v06',{p_unit_id:id});
}

export const cashboxes=()=>list('cashboxes',{order:'display_order',ascending:true,limit:100});
export async function cashboxSessions(){
  try{return await list('cashbox_session_summary',{order:'business_date',limit:200});}
  catch(_){return list('cashbox_sessions',{order:'business_date',limit:200});}
}

async function enrichCashboxOverview(entries){
  const ids=entries.map(x=>x?.session?.id).filter(Boolean);
  if(!ids.length) return entries;
  let txs=[]; let openings=[];
  try{
    const {data,error}=await need().from('cashbox_transactions').select('*').in('session_id',ids).limit(2500);
    if(!error) txs=data||[];
  }catch(_){}
  try{
    const {data,error}=await need().from('cashbox_session_openings').select('*').in('session_id',ids).limit(500);
    if(!error) openings=data||[];
  }catch(_){}
  const txNet={};
  for(const tx of txs){
    if(tx.is_void===true) continue;
    const sid=String(tx.session_id||'');
    const base=Number(tx.amount_base??0);
    txNet[sid]=(txNet[sid]||0)+(tx.direction==='out'?-base:base);
  }
  const openingBase={};
  for(const op of openings){
    const sid=String(op.session_id||'');
    const val=Number(op.opening_balance_base??op.opening_amount_base??op.amount_base??op.balance_base??0);
    openingBase[sid]=(openingBase[sid]||0)+(Number.isFinite(val)?val:0);
  }
  return entries.map(entry=>{
    const sid=String(entry?.session?.id||'');
    const computed=(openingBase[sid]||0)+(txNet[sid]||0);
    return {...entry,summary:{...(entry.summary||{}),_computed_balance_base:computed}};
  });
}

export async function cashboxOverview(date=todayISO()){
  try{
    await rpc('ensure_cashbox_day_v013',{p_business_date:date});
    const data=await rpc('get_cashbox_overview_v013',{p_business_date:date});
    return enrichCashboxOverview(Array.isArray(data)?data:[]);
  }catch(e){
    console.warn('v0.13 cashbox overview fallback',e);
    const [boxes,sessions]=await Promise.all([cashboxes(),cashboxSessions()]);
    const entries=boxes.map(box=>{
      const session=sessions.find(x=>String(x.cashbox_id||'')===String(box.id) && String(x.business_date||'').slice(0,10)===String(date));
      return {cashbox:box,session:session||null,summary:session||{}};
    });
    return enrichCashboxOverview(entries);
  }
}

// Manual ledger only: purchases, sales, salaries and expenses are deliberately excluded.
export async function cashboxManualTransactions(start,end){
  const result=[];
  const startIso=new Date(start+'T00:00:00').toISOString();
  const afterEnd=new Date(new Date(end+'T00:00:00').getTime()+86400000).toISOString();
  const page=500;
  for(let offset=0;offset<25000;offset+=page){
    const rows=await dataOrThrow(need().from('cashbox_transactions').select('*')
      .gte('occurred_at',startIso).lt('occurred_at',afterEnd)
      .order('occurred_at',{ascending:false}).range(offset,offset+page-1));
    result.push(...rows);
    if(rows.length<page)break;
  }
  return result;
}

export const zeroCashboxToGeneral=cashboxId=>rpc('zero_cashbox_to_general_v023',{p_source_cashbox_id:cashboxId});

export async function recordCashboxAdjustment({cashboxId,direction,amount,currency='SYP',note=null,date=todayISO()}){
  return rpc('record_cashbox_adjustment_v013',{
    p_cashbox_id:cashboxId,
    p_direction:direction,
    p_amount:Number(amount),
    p_currency_code:currency,
    p_note:String(note||'').trim()||null,
    p_occurred_at:new Date(date+'T12:00:00').toISOString(),
  });
}

export const expenses=()=>list('expenses',{order:'occurred_at',limit:500});
export const expenseCategories=()=>list('expense_categories',{order:'name',ascending:true,limit:100});

export async function expenseDetails(){
  const [rows,cats,boxes,sessions,transactions]=await Promise.all([
    expenses(),expenseCategories(),cashboxes(),
    list('cashbox_sessions',{order:'business_date',limit:1000}).catch(()=>[]),
    list('cashbox_transactions',{order:'occurred_at',limit:1500}).catch(()=>[]),
  ]);
  const catMap=Object.fromEntries(cats.map(x=>[String(x.id),x]));
  const boxMap=Object.fromEntries(boxes.map(x=>[String(x.id),x]));
  const sessionMap=Object.fromEntries(sessions.map(x=>[String(x.id),x]));
  const txMap=Object.fromEntries(transactions.map(x=>[String(x.id),x]));
  return rows.map(row=>{
    const tx=txMap[String(row.cashbox_transaction_id)]||null;
    const session=tx?sessionMap[String(tx.session_id||tx.cashbox_session_id||'')]:null;
    const cashboxId=tx?.cashbox_id||session?.cashbox_id||null;
    return {
      ...row,
      category_name:catMap[String(row.category_id)]?.name||null,
      cashbox_id:cashboxId,
      cashbox_name:boxMap[String(cashboxId)]?.name||null,
      amount_original:tx?.amount_original??null,
      currency_code:tx?.currency_code||null,
      amount_base:tx?.amount_base??null,
      transaction_type:tx?.transaction_type||null,
      transaction_description:tx?.description||null,
      transaction_is_void:tx?.is_void===true,
    };
  });
}
// Read all expenses for the selected period, and only their linked cashbox entries.
// Pagination prevents silent truncation at 500 rows.
export async function expenseDetailsForPeriod(start,end){
  const startIso=new Date(start+'T00:00:00').toISOString();
  const endIso=new Date(new Date(end+'T00:00:00').getTime()+86400000).toISOString();
  const rows=[];const page=500;
  for(let offset=0;offset<25000;offset+=page){
    const chunk=await dataOrThrow(need().from('expenses').select('*')
      .gte('occurred_at',startIso).lt('occurred_at',endIso)
      .order('occurred_at',{ascending:false}).range(offset,offset+page-1));
    rows.push(...chunk);if(chunk.length<page)break;
  }
  const [cats,boxes]=await Promise.all([expenseCategories(),cashboxes()]);
  const catMap=Object.fromEntries(cats.map(c=>[String(c.id),c]));
  const boxMap=Object.fromEntries(boxes.map(b=>[String(b.id),b]));
  const txIds=[...new Set(rows.map(r=>r.cashbox_transaction_id).filter(Boolean))];
  const txMap=new Map();
  for(let i=0;i<txIds.length;i+=100){
    const chunk=await dataOrThrow(need().from('cashbox_transactions').select('*').in('id',txIds.slice(i,i+100)));
    for(const tx of chunk)txMap.set(String(tx.id),tx);
  }
  return rows.map(row=>{
    const tx=txMap.get(String(row.cashbox_transaction_id))||null;
    return {...row,category_name:catMap[String(row.category_id)]?.name||null,
      cashbox_id:tx?.cashbox_id||null,
      cashbox_name:boxMap[String(tx?.cashbox_id)]?.name||null,
      amount_original:tx?.amount_original??null,
      currency_code:tx?.currency_code||null,
      transaction_is_void:tx?.is_void===true};
  });
}
export const manageExpenseCategory=(action,id=null,name=null)=>rpc('manage_expense_category_v023',{
  p_action:action,p_category_id:id,p_name:name,
});
export const saveOrderSettings=(discount,monthlyTax,localTax,expenseCashboxId)=>rpc('save_order_settings_v023',{
  p_discount_percent:Number(discount),p_monthly_tax_percent:Number(monthlyTax),
  p_local_tax_percent:Number(localTax),p_expense_cashbox_id:expenseCashboxId||null,
});
export const setOrderRates=(orderId,discount,monthlyTax,localTax)=>rpc('set_order_rates_v023',{
  p_order_id:orderId,p_discount_percent:Number(discount),
  p_expenditure_tax_percent:Number(monthlyTax),p_local_tax_percent:Number(localTax),
});

export const orders=()=>list('orders',{order:'occurred_at',limit:500});
export const orderItems=id=>list('order_items',{order:'created_at',ascending:true,eq:{order_id:id},limit:300});
export const employees=()=>list('employees',{order:'name',ascending:true,limit:500});

export async function createEmployee(input){
  // Never retry with an incomplete employee record: DB requires a rate for pay_type.
  return insert('employees', buildEmployeePayload(input));
}
export const attendance=date=>list('employee_attendance',{order:'created_at',ascending:true,eq:{work_date:date},limit:500});
export const payrollRuns=()=>list('payroll_run_summary',{order:'period_end',limit:100}).catch(()=>list('payroll_runs',{order:'period_end',limit:100}));
export const events=()=>list('events',{order:'event_date',limit:300});
export const eventBookings=id=>list('event_bookings',{order:'created_at',ascending:true,eq:{event_id:id},limit:300});

export async function statistics(start,end){
  return rpc('get_financial_statistics_v023',{p_start_date:start,p_end_date:end});
}

function norm(s){return String(s||'').trim().toLowerCase().replace(/\s+/g,' ');}

export async function findOrCreateSupplier(name){
  const all=await suppliers();
  if(!name.trim()){
    let x=all.find(s=>s.notes==='SYSTEM_DIRECT_PURCHASE'||norm(s.name)===norm('شراء مباشر'));
    if(x) return x;
    return insertFirst('suppliers',[{name:'شراء مباشر',notes:'SYSTEM_DIRECT_PURCHASE'},{name:'شراء مباشر'}]);
  }
  let x=all.find(s=>norm(s.name)===norm(name));
  if(x) return x;
  return insertFirst('suppliers',[{name:name.trim()},{name:name.trim(),notes:null}]);
}

export async function createPurchase({supplierName='',currency='SYP',invoiceNumber=null,date=todayISO()}){
  const s=await findOrCreateSupplier(supplierName);
  const args={
    p_supplier_id:s.id,
    p_currency_code:currency,
    p_invoice_number:invoiceNumber||null,
    p_invoice_date:date,
    p_occurred_at:new Date(date+'T12:00:00').toISOString(),
    p_entry_method:'manual',
  };
  return rpc('create_purchase_invoice',args);
}

export async function updatePurchaseDraftFromOcr({invoiceId,supplierName='',invoiceNumber=null,invoiceDate=null,currency='SYP'}){
  const supplier=await findOrCreateSupplier(String(supplierName||'').trim());
  const date=invoiceDate||todayISO();
  const patch={
    supplier_id:supplier.id,
    invoice_number:String(invoiceNumber||'').trim()||null,
    invoice_date:date,
    occurred_at:new Date(date+'T12:00:00').toISOString(),
    currency_code:currency||'SYP',
  };
  return update('purchase_invoices',invoiceId,patch);
}

export async function addPurchaseItem({invoiceId,materialId,purchaseUnitId,quantity,unitPrice,discount=0}){
  return rpc('add_purchase_invoice_item',{
    p_invoice_id:invoiceId,
    p_material_id:materialId,
    p_purchase_unit_id:purchaseUnitId,
    p_quantity:Number(quantity),
    p_unit_price_original:Number(unitPrice),
    p_line_discount_original:Number(discount||0),
    p_ai_confidence:null,
    p_notes:null,
  });
}

export const postPurchase=id=>rpc('post_purchase_invoice',{p_invoice_id:id});

export async function supplierPurchaseCatalog(supplierId){
  if(!supplierId) return [];
  return rpc('get_supplier_purchase_catalog_v010',{p_supplier_id:supplierId});
}

export async function updatePurchaseItem({itemId,purchaseUnitId,quantity,unitPrice,discount=0}){
  return rpc('update_purchase_invoice_item_v010',{
    p_item_id:itemId,
    p_purchase_unit_id:purchaseUnitId,
    p_quantity:Number(quantity),
    p_unit_price_original:Number(unitPrice),
    p_line_discount_original:Number(discount||0),
  });
}

export const deletePurchaseItem=itemId=>rpc('delete_purchase_invoice_item_v010',{p_item_id:itemId});
export const deletePurchaseDraft=id=>rpc('delete_purchase_invoice_draft_v010',{p_invoice_id:id});
export const voidPurchase=(id,reason=null)=>rpc('void_purchase_invoice_v010',{p_invoice_id:id,p_reason:reason});

export async function enqueueDocumentOcr({jobType='purchase_ocr',imageBase64,mimeType='image/jpeg',fileName='',relatedEntityId=null,context={}}){
  let lastErr;
  let lastStatus=0;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const {data,error}=await need().functions.invoke('document-ocr',{
        body:{
          job_type:jobType,
          image_base64:imageBase64,
          mime_type:mimeType,
          file_name:fileName||'',
          related_entity_id:relatedEntityId||null,
          context:context||{},
        },
      });
      if(error) throw error;
      if(data?.ok===false) throw new Error(data?.message||data?.reason||'OCR_QUEUE_FAILED');
      if(data?.job_id) return data;
      throw new Error('OCR_QUEUE_EMPTY_RESPONSE');
    }catch(e){
      lastErr=e;
      lastStatus=statusFromFunctionError(e);
      const retry=!lastStatus || lastStatus===408 || lastStatus===429 || lastStatus>=500;
      if(!retry || attempt===3) break;
      await sleep(attempt===1?500:1100);
    }
  }
  console.error(lastErr);
  if(lastStatus===404) throw new Error('DOCUMENT_OCR_NOT_DEPLOYED');
  throw lastErr||new Error('OCR_QUEUE_FAILED');
}

export async function aiJobs({limit=80}={}){
  try{return await list('ai_jobs',{order:'created_at',limit});}
  catch(e){
    const msg=String(e?.message||e||'').toLowerCase();
    if(msg.includes('ai_jobs')||msg.includes('relation')||msg.includes('does not exist')) return [];
    throw e;
  }
}

export async function aiJobsForEntity(type,id,{limit=30}={}){
  if(!type||!id) return [];
  try{
    const {data,error}=await need().from('ai_jobs')
      .select('*')
      .eq('related_entity_type',type)
      .eq('related_entity_id',id)
      .order('created_at',{ascending:false})
      .limit(limit);
    if(error) throw error;
    return data||[];
  }catch(e){
    const msg=String(e?.message||e||'').toLowerCase();
    if(msg.includes('ai_jobs')||msg.includes('relation')||msg.includes('does not exist')) return [];
    throw e;
  }
}

export const markAiJobSeen=id=>rpc('mark_ai_job_seen_v012',{p_job_id:id});
export const completeAiJob=(id,type,relatedId)=>rpc('complete_ai_job_v012',{
  p_job_id:id,
  p_related_entity_type:type,
  p_related_entity_id:relatedId,
});

export async function createOrder({cashboxId,currency='SYP',number=null,date=todayISO()}){
  return rpc('create_order',{
    p_external_order_number:number||null,
    p_cashbox_id:cashboxId||null,
    p_occurred_at:new Date(date+'T12:00:00').toISOString(),
    p_currency_code:currency,
    p_entry_method:'manual',
  });
}

export async function addOrderItem({orderId,menuItemId,quantity,unitPrice,adjustmentType='none',adjustmentValue=0,rawItemName=null}){
  const discount=adjustmentType==='percent'?Number(adjustmentValue||0):0;
  return rpc('add_order_item_v013',{
    p_order_id:orderId,
    p_menu_item_id:menuItemId,
    p_quantity:Number(quantity),
    p_unit_price_original:Number(unitPrice),
    p_discount_percent:discount,
    p_raw_item_name:rawItemName||null,
  });
}

export async function setOrderCashbox(orderId,cashboxId){
  let last;
  for(const args of [
    {p_order_id:orderId,p_cashbox_id:cashboxId},
    {p_id:orderId,p_cashbox_id:cashboxId},
  ]){
    try{return await rpc('set_order_cashbox',args);}catch(e){last=e;}
  }
  throw last;
}

export const addComplimentaryOrderItem=({orderId,menuItemId,quantity,unitPrice})=>rpc('add_complimentary_order_item_v023',{p_order_id:orderId,p_menu_item_id:menuItemId,p_quantity:Number(quantity),p_unit_price_original:Number(unitPrice)});
export const reopenPostedOrder=(orderId,reason)=>rpc('reopen_posted_order_v023',{p_order_id:orderId,p_reason:reason});

// Posting money must never automatically retry after an ambiguous network failure.
export async function postOrder(id){return rpc('post_order_v023',{p_order_id:id});}

export async function recordExpense({cashboxId,amount,title,currency='SYP',categoryId=null,description=null,payee=null,date=todayISO()}){
  const occurredAt=new Date(date+'T12:00:00').toISOString();
  try{await rpc('ensure_cashbox_session_v013',{p_cashbox_id:cashboxId,p_at:occurredAt});}catch(e){console.warn('Could not pre-open cashbox session for expense',e);}
  return rpc('record_expense',{
    p_cashbox_id:cashboxId,
    p_amount:Number(amount),
    p_title:title,
    p_currency_code:currency,
    p_category_id:categoryId||null,
    p_occurred_at:occurredAt,
    p_payee:payee||null,
    p_description:description||null,
  });
}

export async function initializeAttendance(date){return rpc('initialize_daily_attendance',{p_work_date:date});}

export async function setAttendance(input){
  return rpc('set_employee_attendance', buildAttendanceArgs(input));
}

export async function createEvent(input){
  return rpc('create_event', buildEventArgs(input));
}

// v0.17 -- one authenticated request per user action. Do not blindly retry a write:
// the server might have committed it before a lost HTTP response.
export async function assistantRequest(payload={}){
  try{
    const {data,error}=await need().functions.invoke('assistant',{body:payload});
    if(error){
      let details='';
      const status=Number(error?.context?.status||error?.status||0);
      try{const response=error.context;if(typeof response?.json==='function'){
        const body=await response.json(); details=String(body?.answer||body?.error||'');
      }}catch(_){}
      if(details) return {ok:false,answer:details,reason:'edge_function_error',diagnostic:{status}};
      return {ok:false,
        answer: status===401?'انتهت جلسة الدخول؛ أعد تسجيل الدخول.':
          status===404?'دالة assistant غير منشورة في Supabase. انشر محتوى supabase/functions/assistant.':
          status===502||status===503||status===504?'تعذر تشغيل Edge Function حاليًا. راجع Logs للدالة assistant في Supabase وتأكد من إعداد الأسرار ونشر الإصدار v0.17.':
          'تعذر الاتصال بدالة assistant في Supabase. راجع حالة الدالة وإعدادات الاتصال.',
        reason:'edge_unavailable',diagnostic:{status:status||null}};
    }
    return data&&typeof data==='object'?data:{ok:false,answer:'أعادت خدمة المساعد استجابة غير متوقعة.',reason:'invalid_response'};
  }catch(e){
    return {ok:false,answer:'فقد الاتصال بالخادم. تحقق من الشبكة وحالة Supabase ثم أعد المحاولة؛ لا تكرر عملية كتابة ربما نجحت قبل انقطاع الاتصال.',reason:'network_unavailable'};
  }
}
export async function askAssistant(message,history=[],extra={}){
  return assistantRequest({message,history,...extra});
}
export async function assistantHealth(){return assistantRequest({action:'health'});}
export async function assistantProbe(){return assistantRequest({action:'probe'});}
export async function confirmAssistantAction(id){return assistantRequest({action:'confirm',proposal_id:id});}
export async function reviewAssistantDocument(document,cashboxId=null){return assistantRequest({action:'review_document',document,cashbox_id:cashboxId});}

// v0.14: all salary outflows go through approved payroll + its protected RPC.
export async function payrollSettings(){
  const values=await list('app_settings',{limit:1});
  return values[0]||{};
}
export async function setPayrollCashbox(cashboxId){
  return rpc('set_payroll_cashbox_v014',{p_cashbox_id:cashboxId});
}
export async function dailyWageDues(){
  return rpc('get_daily_wage_dues_v017',{});
}
export async function payDailyWage(employeeId,workDate){
  return rpc('pay_daily_wage_v017',{p_employee_id:employeeId,p_work_date:workDate});
}
export async function approvedSalaryBalances(){
  const [balances,runs,items]=await Promise.all([
    list('payroll_item_balances',{limit:1000}),
    list('payroll_runs',{order:'period_end',limit:500}),
    list('payroll_items',{limit:1000}),
  ]);
  const runMap=new Map(runs.map(r=>[r.id,r]));
  const itemMap=new Map(items.map(i=>[i.id,i]));
  return balances.map(b=>({...b,run:runMap.get(b.payroll_run_id)||null,
    pay_type:itemMap.get(b.payroll_item_id)?.pay_type_snapshot||null,
    advance_deduction_original:itemMap.get(b.payroll_item_id)?.advance_deduction_original||0}))
    .filter(b=>b.run&&['approved','closed'].includes(b.run.status)&&Number(b.remaining_original)>0.001);
}
export async function payApprovedSalary(payrollItemId,amount=null){
  return rpc('pay_approved_salary_v014',{p_payroll_item_id:payrollItemId,p_amount:amount});
}
export async function payrollPaymentHistory(){
  return list('payroll_payments',{order:'occurred_at',limit:300});
}
export async function createMonthlyPayroll(year,month){
  return rpc('create_monthly_payroll_v014',{p_year:Number(year),p_month:Number(month)});
}
export async function recalculateMonthlyPayroll(runId){
  return rpc('recalculate_monthly_payroll_v014',{p_payroll_run_id:runId});
}
export async function approveMonthlyPayroll(runId){
  return rpc('approve_payroll_run',{p_payroll_run_id:runId});
}
export async function statisticsTimeSeries(start,end,granularity='day'){
  return rpc('get_statistics_time_series',{
    p_start_date:start,p_end_date:end,p_granularity:granularity,
  });
}

// v0.23 staff, advances and non-financial inventories.
export const employeeAdvances=()=>list('employee_advances',{order:'occurred_at',limit:1000});
export const advanceDeductions=()=>list('payroll_advance_deductions',{limit:2000});
export const fixedAdvanceDeductionsV023=()=>list('employee_fixed_advance_deductions_v023',{limit:2000});
export async function recordEmployeeAdvance({employeeId,cashboxId,amount,repaymentMode='installments',installment=null,date=todayISO(),note=null}){
  return rpc('record_employee_advance',{
    p_employee_id:employeeId,p_cashbox_id:cashboxId,p_amount:Number(amount),
    p_repayment_mode:repaymentMode,p_installment_amount:installment===null?null:Number(installment),
    p_occurred_at:new Date(`${date}T12:00:00`).toISOString(),p_note:String(note||'').trim()||null,
  });
}
export const saveStaffPolicy=(hours,multiplier,leaveDays)=>rpc('save_staff_policy_v023',{
  p_daily_hours:Number(hours),p_overtime_multiplier:Number(multiplier),p_paid_leave_days:Number(leaveDays),
});
export const paidLeaveUsed=async(year)=>{
  const start=`${year}-01-01`,end=`${year}-12-31`,all=[];
  for(let offset=0;offset<20000;offset+=500){
    const rows=await dataOrThrow(need().from('employee_attendance').select('employee_id,work_date')
      .eq('status','paid_leave').gte('work_date',start).lte('work_date',end)
      .order('work_date',{ascending:true}).range(offset,offset+499));
    all.push(...rows);if(rows.length<500)break;
  }
  return all;
};
export const payFixedEmployee=(employeeId,cashboxId,date,note=null)=>rpc('pay_fixed_employee_v023',{
  p_employee_id:employeeId,p_cashbox_id:cashboxId,p_work_date:date,p_note:note,
});
export const fixedPaymentHistory=()=>list('employee_fixed_payments_v023',{order:'occurred_at',limit:1000});
export const salaryPaymentPage=(start,end,offset=0,limit=25)=>rpc('get_salary_payment_page_v023',{
  p_start_date:start,p_end_date:end,p_offset:offset,p_limit:limit,
});
export const materialCategoriesV023=()=>list('material_categories_v023',{order:'name',ascending:true,limit:500});
export const assetCategoriesV023=()=>list('asset_categories_v023',{order:'name',ascending:true,limit:500});
export const menuCategoriesV023=()=>list('menu_categories',{order:'name',ascending:true,limit:500});
export const restaurantAssetsV023=()=>list('restaurant_assets_v023',{order:'name',ascending:true,limit:1000});
export async function createRestaurantAssetV023(row){return insert('restaurant_assets_v023',row);}
export async function updateRestaurantAssetV023(id,row){return update('restaurant_assets_v023',id,row);}
export async function deleteRestaurantAssetV023(id){return remove('restaurant_assets_v023',id);}
export async function createCatalogCategoryV023(kind,name){
  const table={material:'material_categories_v023',asset:'asset_categories_v023',menu:'menu_categories'}[kind];
  if(!table)throw new Error('CATEGORY_KIND_INVALID');
  return insert(table,{name:String(name).trim()});
}
export async function renameCatalogCategoryV023(kind,id,name){
  const table={material:'material_categories_v023',asset:'asset_categories_v023',menu:'menu_categories'}[kind];
  if(!table)throw new Error('CATEGORY_KIND_INVALID');
  return update(table,id,{name:String(name).trim()});
}
export async function deleteCatalogCategoryV023(kind,id){
  const table={material:'material_categories_v023',asset:'asset_categories_v023',menu:'menu_categories'}[kind];
  if(!table)throw new Error('CATEGORY_KIND_INVALID');
  return remove(table,id);
}
export const payrollStatisticsV023=(start,end)=>rpc('get_payroll_statistics_v023',{p_start_date:start,p_end_date:end});

// v0.24: one authenticated and atomic RPC per Al-Ameen report.
export const importAmeenV024=({kind,fileName,sha256,records})=>rpc('import_ameen_v024',{
  p_kind:kind,p_filename:fileName,p_sha256:sha256,p_records:records,
});
export const ameenImportHistoryV024=()=>list('ameen_import_runs_v024',{order:'created_at',limit:70});
export const ameenWarehousesV024=()=>list('ameen_warehouses_v024',{order:'name',ascending:true,limit:80});
export const ameenInventoryV024=()=>list('ameen_inventory_rows_v024',{order:'name',ascending:true,limit:1500});
export const ameenSupplierBalancesV024=()=>list('ameen_supplier_balances_v024',{order:'supplier_name',ascending:true,limit:1000});
export const ameenSupplierEntriesV024=(account)=>list('ameen_supplier_entries_v024',{order:'occurred_at',eq:{external_account:account},limit:1000});
export const ameenOrderImportsV024=()=>list('ameen_order_snapshots_v024',{order:'occurred_at',limit:1000});
export const approveAmeenOrderV024=(orderId)=>rpc('approve_ameen_order_v024',{p_order_id:orderId});
