import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {bookingPriceV038,roundHundredUpV038,eventMoneyV038,ticketFromMarginV038,marginFromTicketV038,eventGuestSummaryV038,normalizeTableSearchV038,validateTableDistributionV038} from '../js/event-v038.js';
import {externalRequiredV038,externalBudgetV038,augmentEventQuoteV038} from '../js/event-external-v038.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const tables=[
 {id:'1',table_label:'طاولة 1',capacity:4,planned_guest_count:4,status:'available',booking_id:null},
 {id:'2',table_label:'طاولة 2',capacity:6,planned_guest_count:3,status:'available',booking_id:null},
 {id:'3',table_label:'طاولة 3',capacity:8,planned_guest_count:5,status:'available',booking_id:null}
];
test('v0.38 rounds planned ticket UP to the next 100 SYP and displays costs without long fractions',()=>{
 assert.equal(roundHundredUpV038(10852.4977),10900);
 assert.equal(roundHundredUpV038(10000),10000);
 assert.equal(eventMoneyV038(10852.4977,'SYP'),'10,853 SYP');
 assert.equal(eventMoneyV038(1073.411,'USD'),'1,073.42 USD');
 assert.equal(ticketFromMarginV038(750000,10,25,1,'SYP'),100000);
 assert.equal(marginFromTicketV038(750000,10,100000),25);
});
test('v0.38 booking guest price is multiplied exactly once',()=>{
 assert.equal(bookingPriceV038(5,25000),125000);
 assert.equal(bookingPriceV038(1,25000),25000);
 assert.throws(()=>bookingPriceV038(0,20000));
 assert.throws(()=>bookingPriceV038(5,-1));
});
test('v0.38 groups unnamed guests into one readable label without erasing their actual seat entries',()=>{
 assert.equal(eventGuestSummaryV038('باسل',['باسل','مع باسل 1','مع باسل 2','مع باسل 3','مع باسل 4'],5),'باسل · 4 أشخاص مع باسل');
 assert.match(eventGuestSummaryV038('باسل',['باسل','محمد','أحمد','مع باسل 3','مع باسل 4'],5),/محمد، أحمد/);
});
test('v0.38 table selection supports Arabic-Indic numerals and any free table, without overfilling',()=>{
 assert.equal(normalizeTableSearchV038('طاولة ١'),normalizeTableSearchV038('طاوله 1'));
 assert.equal(validateTableDistributionV038(tables,[{table_id:'3',guests:5}],5).ok,true);
 assert.equal(validateTableDistributionV038(tables,[{table_id:'1',guests:4},{table_id:'3',guests:1}],5).ok,true);
 assert.match(validateTableDistributionV038(tables,[{table_id:'1',guests:5}],5).reason,/سعتها/);
 assert.match(validateTableDistributionV038(tables,[{table_id:'1',guests:4},{table_id:'3',guests:2}],5).reason,/وُزّع/);
 assert.equal(validateTableDistributionV038(tables,[{table_id:'2',guests:2},{table_id:'2',guests:3}],5).ok,false);
 assert.equal(validateTableDistributionV038([{...tables[0],booking_id:'reserved'}],[{table_id:'1',guests:1}],1).ok,false);
});
test('v0.38 externally purchased dishes are counted per table for group portions',()=>{
 assert.equal(externalRequiredV038({rule_type:'per_person',quantity_per_distribution:2},tables),24);
 assert.equal(externalRequiredV038({rule_type:'per_n_people',quantity_per_distribution:1,people_per_rule:4},tables),4);
 assert.equal(externalRequiredV038({rule_type:'per_table',quantity_per_distribution:1},tables),3);
 assert.equal(externalRequiredV038({rule_type:'fixed_event',quantity_per_distribution:1},tables),1);
});
test('v0.38 planned external servings differ from actual external purchase cost, without double charging for payment',()=>{
 const items=[{id:'sweet',purchased_quantity:20,unit_cost_base:25,is_active:true},{id:'drink',purchased_quantity:10,unit_cost_base:50,is_active:true}];
 const rules=[{dish_id:'sweet',rule_type:'per_person',quantity_per_distribution:1},{dish_id:'drink',rule_type:'per_table',quantity_per_distribution:1}];
 const out=externalBudgetV038(items,rules,tables);
 assert.equal(out.plannedCost,450); // 12 sweets + 3 drinks
 assert.equal(out.purchasedCost,1000); // all quantities bought
 assert.equal(out.shortages.length,0);
 assert.equal(externalBudgetV038(items,[{dish_id:'drink',rule_type:'per_person',quantity_per_distribution:2}],tables).shortages.length,1);
 const quote=augmentEventQuoteV038({food:100,others:200,labor:0,reserve:5,total:305,revenue:1000,count:10,tableCount:2,profit:695,marginPercent:69.5},out.plannedCost,5);
 assert.equal(quote.food,550);
 assert.equal(quote.total,777.5);
 assert.equal(quote.profit,222.5);
 assert.equal(quote.costPerPerson,77.75);
});
test('v0.38 database migration protects all payments, keeps paid bookings immutable, and uses owner-only RPC',()=>{
 const sql=read('database/Maria-CFO-Web-v0.38-Bookings-External-Catering.sql');
 assert.match(sql,/^BEGIN;$/m);assert.match(sql,/^COMMIT;$/m);
 for(const key of ['event_set_booking_amount_v038','event_add_external_dish_v038','event_save_external_serving_v038','event_pay_external_dish_v038','event_void_external_dish_v038'])assert.match(sql,new RegExp(key));
 assert.match(sql,/EVENT_BOOKING_HAS_PAYMENTS/);assert.match(sql,/FOR UPDATE/);assert.match(sql,/public\.is_app_owner\(\)/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);assert.match(sql,/GRANT SELECT/);assert.match(sql,/REVOKE ALL ON FUNCTION/);
 assert.match(sql,/public\.record_cashbox_transaction/);assert.match(sql,/cashbox_transaction_id uuid UNIQUE/);
 assert.doesNotMatch(sql,/INSERT INTO public\.menu_item_recipe_items/);
});
test('v0.38 new UI has integrated table selection, both booking prices, external purchases and Arabic booking states',()=>{
 const js=read('js/pages/events-v034.js'),api=read('js/api.js'),html=read('index.html');
 assert.match(js,/data-picker="start"/);assert.match(js,/data-picker="additional"/);
 assert.match(js,/validateTableDistributionV038/);assert.match(js,/data-alloc-count/);
 assert.match(js,/name="unitPrice"/);assert.match(js,/name="amount"/);
 assert.match(js,/EVENT_BOOKING_STATUS_AR_V038/);assert.match(js,/data-book-amount/);
 assert.match(js,/eventExternalDishesV038/);assert.match(js,/eventSaveExternalServingV038/);assert.match(js,/eventPayExternalDishV038/);
 assert.match(js,/ticketFromMarginV038/);assert.match(js,/eventGuestSummaryV038/);
 assert.match(api,/eventSetBookingAmountV038/);
 assert.match(html,/app\.js\?v=0\.38/);
});
