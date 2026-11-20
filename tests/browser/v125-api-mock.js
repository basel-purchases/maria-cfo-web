
const data={"event": {"id": "event-test", "name": "حفلة اختبار الإصدار 1.0.25", "status": "open", "event_date": "2026-11-20", "event_type": "private", "planned_guest_count": 40, "actual_guest_count": 20, "default_price_original": 500, "price_currency_code": "SYP", "price_exchange_rate_to_base": 1, "seat_only_v113": true}, "menu": [{"id": "menu-good", "name": "عصير برتقال", "is_active": true, "recipe_cost_base": 30, "has_missing_cost": false}, {"id": "menu-bad", "name": "صنف بوصفة ناقصة", "is_active": true, "recipe_cost_base": null, "has_missing_cost": true}], "external": [{"id": "cake", "event_id": "event-test", "name": "قالب كاتو", "vendor": "مورد تجريبي", "unit_label": "قالب", "purchased_quantity": 1, "unit_cost_base": 100, "total_cost_base": 100, "is_active": true, "billing_mode_v125": "sale", "unit_profit_base_v125": 25}, {"id": "free-sweets", "event_id": "event-test", "name": "حلويات ضيافة", "unit_label": "علبة", "purchased_quantity": 1, "unit_cost_base": 40, "total_cost_base": 40, "is_active": true, "billing_mode_v125": "hospitality", "unit_profit_base_v125": 0}], "extras": [{"id": "internal-1", "event_id": "event-test", "source_v125": "internal", "description": "طلب عصير إضافي", "quantity": 2, "unit_price_original": 50, "amount_original": 100, "unit_cost_base": 30, "total_cost_base": 60, "currency_code": "SYP", "exchange_rate_to_base": 1, "status": "pending"}, {"id": "external-1", "event_id": "event-test", "source_v125": "external", "external_dish_id_v125": "cake", "description": "طلب خارجي: قالب كاتو", "quantity": 1, "unit_price_original": 125, "amount_original": 125, "unit_cost_base": 100, "total_cost_base": 100, "currency_code": "SYP", "exchange_rate_to_base": 1, "status": "pending"}, {"id": "free-1", "event_id": "event-test", "source_v125": "internal", "description": "ضيافة إضافية مجانية", "quantity": 1, "unit_price_original": 0, "amount_original": 0, "unit_cost_base": 20, "total_cost_base": 20, "currency_code": "SYP", "exchange_rate_to_base": 1, "status": "complimentary"}], "summary": {"actual_guest_count": 20, "earned_revenue_base": 2000, "included_food_cost_base": 800, "actual_other_expense_base": 100, "actual_labor_cost_base": 100, "order_food_cost_base": 0, "revenue_base_v125": 2225, "cost_base_v125": 1220, "profit_base_v125": 1005, "extra_revenue_base_v125": 225, "extra_cost_base_v125": 80, "extra_due_original_v125": 225, "pending_extra_count_v125": 2, "hospitality_cost_base_v125": 860, "internal_revenue_base_v125": 100, "internal_cost_base_v125": 60, "internal_profit_base_v125": 40, "external_cost_base_v125": 140, "external_revenue_base_v125": 125, "external_sale_cost_base_v125": 100, "external_profit_base_v125": 25, "external_hospitality_cost_base_v125": 40, "additional_hospitality_cost_base_v125": 20, "unposted_hospitality_cost_base_v125": 0, "kitchen_hospitality_cost_base_v125": 800, "waste_cost_base_v125": 0, "extra_collected_base_v125": 0, "extra_collection_fx_base_v125": 0, "extra_due_currency_mismatch_v125": 0, "cost_incomplete_v125": false}};
window.__eventTestData=data;window.__eventCalls=[];
function copy(value){return JSON.parse(JSON.stringify(value));}
async function call(name,args){
 window.__eventCalls.push({name,args:copy(args)});
 if(name==='eventAddInternalOrderV125'&&window.__failNextOrder){window.__failNextOrder=false;throw Error('simulated failed to fetch');}
 if(name==='eventV034')return copy(data.event);
 if(name==='eventSummaryV125'){
  if(window.__simulateMissingMigration)throw Error('relation event_financial_summary_v125 does not exist');
  const h=copy(data.summary);
  h.pending_extra_count_v125=data.extras.filter(x=>x.status==='pending').length;
  h.extra_due_original_v125=data.extras.filter(x=>x.status==='pending').reduce((s,x)=>s+x.amount_original,0);
  h.extra_collected_base_v125=data.extras.filter(x=>x.status==='paid').reduce((s,x)=>s+(x.paid_amount_base||0),0);
  return h;
 }
 if(name==='eventLedgerRowsV125')return copy(args[0]==='event_extras_v034'?data.extras:args[0]==='event_external_dishes_v038'?data.external:[]);
 if(name==='menuCostsV034')return copy(data.menu);
 if(name==='eventTablesV034')return [{id:'bucket',event_id:'event-test',table_label:'__SEAT_SERVICE_V113__',status:'available',capacity:40,planned_guest_count:40}];
 if(name==='eventPlannerV034')return {target_margin_percent:25,waste_reserve_percent:5};
 if(name==='payrollSettings')return {base_currency_code:'SYP'};
 if(name==='cashboxes')return [{id:'box-main',name:'الصندوق العام التجريبي',is_active:true,is_general:true}];
 if(name==='eventAddInternalOrderV125'||name==='eventAddExternalDishV125'||name==='eventPriceExternalDishV125')return 'new-test-row';
 if(name==='eventPayExtraV034'){
  const row=data.extras.find(x=>x.id===args[0]);row.status='paid';row.paid_amount_base=row.amount_original;row.paid_at='2026-11-20T12:00:00Z';
  return 'test-payment';
 }
 if(name==='eventPayExternalDishV038'){data.external.find(x=>x.id===args[0]).paid_at='2026-11-20T12:00:00Z';return 'test-supplier-payment';}
 if(name==='eventRefundExtraV034'){data.extras.find(x=>x.id===args[0]).status='refunded';return 'test-refund';}
 if(name==='eventVoidExtraV034'){data.extras.find(x=>x.id===args[0]).status='voided';return null;}
 return [];
}

export const allMaterialUnitLinks=(...args)=>call("allMaterialUnitLinks",args);
export const cashboxes=(...args)=>call("cashboxes",args);
export const catalogMaterials=(...args)=>call("catalogMaterials",args);
export const eventActivityV034=(...args)=>call("eventActivityV034",args);
export const eventAddCostV034=(...args)=>call("eventAddCostV034",args);
export const eventAddExternalDishV125=(...args)=>call("eventAddExternalDishV125",args);
export const eventAddExternalUnitV039=(...args)=>call("eventAddExternalUnitV039",args);
export const eventAddInternalOrderV125=(...args)=>call("eventAddInternalOrderV125",args);
export const eventAddWasteV034=(...args)=>call("eventAddWasteV034",args);
export const eventAllExternalUnitsV039=(...args)=>call("eventAllExternalUnitsV039",args);
export const eventBookSeatsV113=(...args)=>call("eventBookSeatsV113",args);
export const eventBookingBalancesV034=(...args)=>call("eventBookingBalancesV034",args);
export const eventBookings=(...args)=>call("eventBookings",args);
export const eventCompleteSeatsV113=(...args)=>call("eventCompleteSeatsV113",args);
export const eventCostComparisonV034=(...args)=>call("eventCostComparisonV034",args);
export const eventCostItemsV034=(...args)=>call("eventCostItemsV034",args);
export const eventCreateSeatsV113=(...args)=>call("eventCreateSeatsV113",args);
export const eventCreateServingUnitV037=(...args)=>call("eventCreateServingUnitV037",args);
export const eventDeleteExternalServingV038=(...args)=>call("eventDeleteExternalServingV038",args);
export const eventDeleteGroupV037=(...args)=>call("eventDeleteGroupV037",args);
export const eventDeleteRuleV034=(...args)=>call("eventDeleteRuleV034",args);
export const eventExpenseEntriesV034=(...args)=>call("eventExpenseEntriesV034",args);
export const eventExternalServingsV038=(...args)=>call("eventExternalServingsV038",args);
export const eventExternalUnitsV039=(...args)=>call("eventExternalUnitsV039",args);
export const eventGroupsV037=(...args)=>call("eventGroupsV037",args);
export const eventGuestsV035=(...args)=>call("eventGuestsV035",args);
export const eventIssueOnDemandV040=(...args)=>call("eventIssueOnDemandV040",args);
export const eventLaborV034=(...args)=>call("eventLaborV034",args);
export const eventLedgerRowsV125=(...args)=>call("eventLedgerRowsV125",args);
export const eventMenuCostEstimatesV039=(...args)=>call("eventMenuCostEstimatesV039",args);
export const eventMenuRequirementsV034=(...args)=>call("eventMenuRequirementsV034",args);
export const eventMenuRulesV034=(...args)=>call("eventMenuRulesV034",args);
export const eventMenuSaleUnitsV036=(...args)=>call("eventMenuSaleUnitsV036",args);
export const eventOnDemandV040=(...args)=>call("eventOnDemandV040",args);
export const eventPayBookingV034=(...args)=>call("eventPayBookingV034",args);
export const eventPayExpenseV034=(...args)=>call("eventPayExpenseV034",args);
export const eventPayExternalDishV038=(...args)=>call("eventPayExternalDishV038",args);
export const eventPayExtraV034=(...args)=>call("eventPayExtraV034",args);
export const eventPlannerV034=(...args)=>call("eventPlannerV034",args);
export const eventPriceExternalDishV125=(...args)=>call("eventPriceExternalDishV125",args);
export const eventRecordActivityV034=(...args)=>call("eventRecordActivityV034",args);
export const eventRefundExtraV034=(...args)=>call("eventRefundExtraV034",args);
export const eventSaveExternalServingV039=(...args)=>call("eventSaveExternalServingV039",args);
export const eventSaveGroupV037=(...args)=>call("eventSaveGroupV037",args);
export const eventSaveOnDemandV040=(...args)=>call("eventSaveOnDemandV040",args);
export const eventSavePlannerV034=(...args)=>call("eventSavePlannerV034",args);
export const eventSaveSeatsV113=(...args)=>call("eventSaveSeatsV113",args);
export const eventSaveServingWithEstimateV039=(...args)=>call("eventSaveServingWithEstimateV039",args);
export const eventSeatGuestsV113=(...args)=>call("eventSeatGuestsV113",args);
export const eventServiceBucketV113=(...args)=>call("eventServiceBucketV113",args);
export const eventServingRulesV036=(...args)=>call("eventServingRulesV036",args);
export const eventSetBookingAmountV038=(...args)=>call("eventSetBookingAmountV038",args);
export const eventSetStatusV034=(...args)=>call("eventSetStatusV034",args);
export const eventSummaryV125=(...args)=>call("eventSummaryV125",args);
export const eventTableMenuV034=(...args)=>call("eventTableMenuV034",args);
export const eventTablesV034=(...args)=>call("eventTablesV034",args);
export const eventV034=(...args)=>call("eventV034",args);
export const eventVoidExternalDishV038=(...args)=>call("eventVoidExternalDishV038",args);
export const eventVoidExtraV034=(...args)=>call("eventVoidExtraV034",args);
export const eventVoidOnDemandIssueV040=(...args)=>call("eventVoidOnDemandIssueV040",args);
export const eventVoidWasteV034=(...args)=>call("eventVoidWasteV034",args);
export const eventWasteV034=(...args)=>call("eventWasteV034",args);
export const events=(...args)=>call("events",args);
export const js=(...args)=>call("js",args);
export const menuCostsV034=(...args)=>call("menuCostsV034",args);
export const menuServingConversionsV036=(...args)=>call("menuServingConversionsV036",args);
export const payrollSettings=(...args)=>call("payrollSettings",args);
export const recipeItems=(...args)=>call("recipeItems",args);
export const unitConversions=(...args)=>call("unitConversions",args);
export const units=(...args)=>call("units",args);
