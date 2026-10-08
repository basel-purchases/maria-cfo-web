import { supabase, configured } from './supabase.js';
import { sleep, todayISO } from './utils.js';
function need(){if(!configured||!supabase)throw new Error('SUPABASE_NOT_CONFIGURED');return supabase;}
async function dataOrThrow(p){const {data,error}=await p;if(error)throw error;return data;}
export async function signIn(email,password){return dataOrThrow(need().auth.signInWithPassword({email,password}));}
export async function signOut(){await need().auth.signOut();}
export async function session(){return (await need().auth.getSession()).data.session;}
export function authEvents(cb){return need().auth.onAuthStateChange((_e,s)=>cb(s));}
export async function isOwner(){const {data,error}=await need().rpc('is_app_owner');if(error)throw error;return data===true;}
export async function list(table,{select='*',order=null,ascending=false,eq={},limit=500}={}){let q=need().from(table).select(select);for(const [k,v] of Object.entries(eq))q=q.eq(k,v);if(order)q=q.order(order,{ascending});if(limit)q=q.limit(limit);return dataOrThrow(q);}
export async function one(table,id){const {data,error}=await need().from(table).select('*').eq('id',id).maybeSingle();if(error)throw error;return data;}
export async function insert(table,payload){const {data,error}=await need().from(table).insert(payload).select().single();if(error)throw error;return data;}
export async function insertFirst(table,payloads){let last;for(const payload of payloads){try{return await insert(table,payload);}catch(e){last=e;}}throw last;}
export async function update(table,id,patch){const {data,error}=await need().from(table).update(patch).eq('id',id).select().single();if(error)throw error;return data;}
export async function remove(table,id){const {error}=await need().from(table).delete().eq('id',id);if(error)throw error;}
export async function rpc(name,args={}){const {data,error}=await need().rpc(name,args);if(error)throw error;return data;}
export async function dashboard(){try{return await rpc('get_home_dashboard',{p_date:todayISO()});}catch(_){try{return await rpc('get_home_dashboard',{p_business_date:todayISO()});}catch(__){return await rpc('get_home_dashboard',{});}}}
export async function notifications(){try{return await list('visible_notifications',{order:'created_at',limit:30});}catch(_){return list('notifications',{order:'created_at',limit:30});}}
export const materials=()=>list('materials',{order:'name',ascending:true,limit:1000});
export const units=()=>list('units',{order:'code',ascending:true,limit:100});
export const suppliers=()=>list('suppliers',{order:'name',ascending:true,limit:500});
export const purchases=()=>list('purchase_invoices',{order:'occurred_at',limit:500});
export const purchaseItems=id=>list('purchase_invoice_items',{order:'id',ascending:true,eq:{invoice_id:id},limit:500});
export const menuItems=async()=>{try{return await list('menu_item_costs',{order:'name',ascending:true,limit:500});}catch(_){return list('menu_items',{order:'name',ascending:true,limit:500});}};
export const recipeItems=id=>list('menu_item_recipe_items',{order:'id',ascending:true,eq:{menu_item_id:id},limit:200});
export const cashboxes=()=>list('cashboxes',{order:'display_order',ascending:true,limit:100});
export async function cashboxSessions(){try{return await list('cashbox_session_summary',{order:'business_date',limit:200});}catch(_){return list('cashbox_sessions',{order:'business_date',limit:200});}}
export const expenses=()=>list('expenses',{order:'occurred_at',limit:500});
export const expenseCategories=()=>list('expense_categories',{order:'name',ascending:true,limit:100});
export const orders=()=>list('orders',{order:'occurred_at',limit:500});
export const orderItems=id=>list('order_items',{order:'created_at',ascending:true,eq:{order_id:id},limit:300});
export const employees=()=>list('employees',{order:'name',ascending:true,limit:500});
export const attendance=date=>list('employee_attendance',{order:'created_at',ascending:true,eq:{work_date:date},limit:500});
export const payrollRuns=()=>list('payroll_run_summary',{order:'period_end',limit:100}).catch(()=>list('payroll_runs',{order:'period_end',limit:100}));
export const events=()=>list('events',{order:'event_date',limit:300});
export const eventBookings=id=>list('event_bookings',{order:'created_at',ascending:true,eq:{event_id:id},limit:300});
export async function statistics(start,end){try{return await rpc('get_financial_statistics',{p_start:start,p_end:end});}catch(_){try{return await rpc('get_financial_statistics',{p_from:start,p_to:end});}catch(__){return rpc('get_financial_statistics',{p_start_date:start,p_end_date:end});}}}
function norm(s){return String(s||'').trim().toLowerCase().replace(/\s+/g,' ');}
export async function findOrCreateSupplier(name){const all=await suppliers();if(!name.trim()){let x=all.find(s=>s.notes==='SYSTEM_DIRECT_PURCHASE'||norm(s.name)===norm('شراء مباشر'));if(x)return x;return insertFirst('suppliers',[{name:'شراء مباشر',notes:'SYSTEM_DIRECT_PURCHASE'},{name:'شراء مباشر'}]);}let x=all.find(s=>norm(s.name)===norm(name));if(x)return x;return insertFirst('suppliers',[{name:name.trim()},{name:name.trim(),notes:null}]);}
export async function createPurchase({supplierName='',currency='SYP',invoiceNumber=null,date=todayISO()}){const s=await findOrCreateSupplier(supplierName);const args={p_supplier_id:s.id,p_currency_code:currency,p_invoice_number:invoiceNumber||null,p_invoice_date:date,p_occurred_at:new Date(date+'T12:00:00').toISOString(),p_entry_method:'manual'};return rpc('create_purchase_invoice',args);}
export async function addPurchaseItem({invoiceId,materialId,purchaseUnitId,quantity,unitPrice,discount=0}){return rpc('add_purchase_invoice_item',{p_invoice_id:invoiceId,p_material_id:materialId,p_purchase_unit_id:purchaseUnitId,p_quantity:Number(quantity),p_unit_price_original:Number(unitPrice),p_line_discount_original:Number(discount||0),p_ai_confidence:null,p_notes:null});}
export const postPurchase=id=>rpc('post_purchase_invoice',{p_invoice_id:id});
export async function previousSupplierItems(invoice){if(!invoice?.supplier_id)return[];const all=await purchases();const prev=all.find(x=>x.supplier_id===invoice.supplier_id&&x.id!==invoice.id&&x.status==='posted');return prev?purchaseItems(prev.id):[];}
export async function createOrder({cashboxId,currency='SYP',number=null,date=todayISO()}){return rpc('create_order',{p_external_order_number:number||null,p_cashbox_id:cashboxId||null,p_occurred_at:new Date(date+'T12:00:00').toISOString(),p_currency_code:currency,p_entry_method:'manual'});}
export async function addOrderItem({orderId,menuItemId,quantity,unitPrice}){return rpc('add_order_item',{p_order_id:orderId,p_menu_item_id:menuItemId,p_raw_item_name:null,p_quantity:Number(quantity),p_unit_price_original:Number(unitPrice),p_adjustment_type:'none',p_adjustment_value:0,p_adjustment_reason_id:null});}
export const postOrder=id=>rpc('post_order',{p_order_id:id});
export async function recordExpense({cashboxId,amount,title,currency='SYP',categoryId=null,description=null,payee=null,date=todayISO()}){return rpc('record_expense',{p_cashbox_id:cashboxId,p_amount:Number(amount),p_title:title,p_currency_code:currency,p_category_id:categoryId||null,p_occurred_at:new Date(date+'T12:00:00').toISOString(),p_payee:payee||null,p_description:description||null});}
export async function initializeAttendance(date){return rpc('initialize_daily_attendance',{p_work_date:date});}
export async function setAttendance({employeeId,date,worked,status='full',expected=null,overtime=null,shortage=null,note=null}){return rpc('set_employee_attendance',{p_employee_id:employeeId,p_work_date:date,p_worked_hours:Number(worked||0),p_status:status,p_expected_hours:expected,p_approved_overtime_hours:overtime,p_applied_shortage_hours:shortage,p_note:note});}
export async function createEvent({name,date,type='private',revenueMode='bookings',guests=null,currency='SYP'}){return rpc('create_event',{p_name:name,p_event_type:type,p_event_date:date,p_planned_guest_count:guests?Number(guests):null,p_revenue_mode:revenueMode,p_currency_code:currency,p_default_price_original:null,p_notes:null});}
function statusFromFunctionError(err){const s=Number(err?.context?.status||err?.status||0);return s;}
export async function askAssistant(message,history=[]){let lastErr;for(let attempt=1;attempt<=3;attempt++){try{const {data,error}=await need().functions.invoke('assistant',{body:{message,screen_context:'Maria CFO Web',history}});if(error)throw error;if(data?.answer)return data;throw new Error('EMPTY_AI_RESPONSE');}catch(e){lastErr=e;const status=statusFromFunctionError(e);const retry=!status||status===408||status===429||status>=500;if(!retry||attempt===3)break;await sleep(attempt===1?700:1600);}}console.error(lastErr);return {ok:false,answer:'المساعد غير متاح مؤقتًا الآن. حاول مرة أخرى بعد قليل. إذا استمرت المشكلة فغالبًا مزود الذكاء الاصطناعي مشغول أو لم يستجب في الوقت المحدد.',reason:'temporary_ai_unavailable'};}
