import { supabase, configured } from './supabase.js';
import { sleep, todayISO, unitLabel } from './utils.js';

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
  try{return await rpc('get_home_dashboard',{p_date:todayISO()});}
  catch(_){
    try{return await rpc('get_home_dashboard',{p_business_date:todayISO()});}
    catch(__){return await rpc('get_home_dashboard',{});}
  }
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

export async function units(){
  const rows=await list('units',{order:'code',ascending:true,limit:300});
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

export async function createMenuItem({name,price=null,foodCost=null,discount=null}){
  const payload={
    name:String(name||'').trim(),
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

export async function updateMenuItem(id,{name,price=null,foodCost=null,discount=null}){
  const patch={
    name:String(name||'').trim(),
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
  let firstError;
  try{return await rpc('save_menu_recipe_item_v06',args);}catch(e){firstError=e;}
  try{return await rpc('save_menu_recipe_item',args);}catch(_){ }
  try{
    const rows=await recipeItems(menuItemId);
    const existing=rows.find(r=>String(r.material_id)===String(materialId));
    return await saveRecipeItemFallback({
      menuItemId,materialId,unitId,quantity:q,recipeItemId:existing?.id||null,
    });
  }catch(e){
    console.error('Recipe fallback failed',e,'Primary error:',firstError);
    throw firstError || e;
  }
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
  try{return await rpc('save_menu_recipe_item_v06',args);}catch(_){ }
  try{return await rpc('save_menu_recipe_item',args);}catch(__){ }
  return saveRecipeItemFallback({
    menuItemId:row.menu_item_id,
    materialId:row.material_id,
    unitId,
    quantity:q,
    recipeItemId:id,
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
export const expenses=()=>list('expenses',{order:'occurred_at',limit:500});
export const expenseCategories=()=>list('expense_categories',{order:'name',ascending:true,limit:100});
export const orders=()=>list('orders',{order:'occurred_at',limit:500});
export const orderItems=id=>list('order_items',{order:'created_at',ascending:true,eq:{order_id:id},limit:300});
export const employees=()=>list('employees',{order:'name',ascending:true,limit:500});
export const attendance=date=>list('employee_attendance',{order:'created_at',ascending:true,eq:{work_date:date},limit:500});
export const payrollRuns=()=>list('payroll_run_summary',{order:'period_end',limit:100}).catch(()=>list('payroll_runs',{order:'period_end',limit:100}));
export const events=()=>list('events',{order:'event_date',limit:300});
export const eventBookings=id=>list('event_bookings',{order:'created_at',ascending:true,eq:{event_id:id},limit:300});

export async function statistics(start,end){
  try{return await rpc('get_financial_statistics',{p_start:start,p_end:end});}
  catch(_){
    try{return await rpc('get_financial_statistics',{p_from:start,p_to:end});}
    catch(__){return rpc('get_financial_statistics',{p_start_date:start,p_end_date:end});}
  }
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

export async function previousSupplierItems(invoice){
  if(!invoice?.supplier_id) return [];
  const all=await purchases();
  const prev=all.find(x=>x.supplier_id===invoice.supplier_id && x.id!==invoice.id && x.status==='posted');
  return prev ? purchaseItems(prev.id) : [];
}

export async function createOrder({cashboxId,currency='SYP',number=null,date=todayISO()}){
  return rpc('create_order',{
    p_external_order_number:number||null,
    p_cashbox_id:cashboxId||null,
    p_occurred_at:new Date(date+'T12:00:00').toISOString(),
    p_currency_code:currency,
    p_entry_method:'manual',
  });
}

export async function addOrderItem({orderId,menuItemId,quantity,unitPrice,adjustmentType='none',adjustmentValue=0}){
  return rpc('add_order_item',{
    p_order_id:orderId,
    p_menu_item_id:menuItemId,
    p_raw_item_name:null,
    p_quantity:Number(quantity),
    p_unit_price_original:Number(unitPrice),
    p_adjustment_type:adjustmentType,
    p_adjustment_value:Number(adjustmentValue||0),
    p_adjustment_reason_id:null,
  });
}

export const postOrder=id=>rpc('post_order',{p_order_id:id});

export async function recordExpense({cashboxId,amount,title,currency='SYP',categoryId=null,description=null,payee=null,date=todayISO()}){
  return rpc('record_expense',{
    p_cashbox_id:cashboxId,
    p_amount:Number(amount),
    p_title:title,
    p_currency_code:currency,
    p_category_id:categoryId||null,
    p_occurred_at:new Date(date+'T12:00:00').toISOString(),
    p_payee:payee||null,
    p_description:description||null,
  });
}

export async function initializeAttendance(date){return rpc('initialize_daily_attendance',{p_work_date:date});}

export async function setAttendance({employeeId,date,worked,status='full',expected=null,overtime=null,shortage=null,note=null}){
  return rpc('set_employee_attendance',{
    p_employee_id:employeeId,
    p_work_date:date,
    p_worked_hours:Number(worked||0),
    p_status:status,
    p_expected_hours:expected,
    p_approved_overtime_hours:overtime,
    p_applied_shortage_hours:shortage,
    p_note:note,
  });
}

export async function createEvent({name,date,type='private',revenueMode='bookings',guests=null,currency='SYP'}){
  return rpc('create_event',{
    p_name:name,
    p_event_type:type,
    p_event_date:date,
    p_planned_guest_count:guests?Number(guests):null,
    p_revenue_mode:revenueMode,
    p_currency_code:currency,
    p_default_price_original:null,
    p_notes:null,
  });
}

function statusFromFunctionError(err){
  return Number(err?.context?.status || err?.status || 0);
}

export async function askAssistant(message,history=[]){
  let lastErr;
  let lastStatus=0;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const {data,error}=await need().functions.invoke('assistant',{
        body:{message,screen_context:'Maria CFO Web',history},
      });
      if(error) throw error;
      if(data?.answer) return data;
      throw new Error('EMPTY_AI_RESPONSE');
    }catch(e){
      lastErr=e;
      lastStatus=statusFromFunctionError(e);
      const retry=!lastStatus || lastStatus===408 || lastStatus===429 || lastStatus>=500;
      if(!retry || attempt===3) break;
      await sleep(attempt===1?700:1600);
    }
  }
  console.error(lastErr);
  let reason='تعذر الاتصال بخدمة المساعد بعد ثلاث محاولات.';
  if(lastStatus===429) reason='تم بلوغ حد الاستخدام المؤقت لمزود الذكاء الاصطناعي بعد ثلاث محاولات.';
  else if(lastStatus>=500) reason='خدمة الذكاء الاصطناعي لم تستجب بشكل سليم من الخادم بعد ثلاث محاولات.';
  else if(!lastStatus) reason='تعذر الوصول إلى خدمة المساعد بسبب مشكلة اتصال بعد ثلاث محاولات.';
  return {
    ok:false,
    answer:`المساعد غير متاح مؤقتًا الآن. ${reason} حاول مرة أخرى بعد قليل.`,
    reason:'temporary_ai_unavailable',
  };
}
