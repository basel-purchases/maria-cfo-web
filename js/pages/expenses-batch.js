import * as api from '../api.js?v=0.23';
import {toast,loader,friendlyError,modal} from '../ui.js?v=0.23';
import {esc,money,dateOnly,todayISO} from '../utils.js?v=0.23';
import {datePeriod,dateInRange} from '../date-range-batch.js?v=0.23';
import {downloadXlsx} from '../xlsx-export.js?v=0.23';

const L={
 title:'\u0627\u0644\u0645\u0635\u0631\u0648\u0641\u0627\u062a',newExpense:'\u0625\u0636\u0627\u0641\u0629 \u0645\u0635\u0631\u0648\u0641',
 day:'\u064a\u0648\u0645\u064a',month:'\u0634\u0647\u0631\u064a',year:'\u0633\u0646\u0648\u064a',date:'\u0627\u0644\u062a\u0627\u0631\u064a\u062e',filter:'\u0627\u0644\u0641\u062a\u0631\u0629',
 name:'\u0627\u0633\u0645 \u0627\u0644\u0645\u0635\u0631\u0648\u0641',category:'\u0627\u0644\u062a\u0635\u0646\u064a\u0641',amount:'\u0627\u0644\u0645\u0628\u0644\u063a',currency:'\u0627\u0644\u0639\u0645\u0644\u0629',box:'\u0627\u0644\u0635\u0646\u062f\u0648\u0642',
 recipient:'\u0627\u0644\u0645\u062f\u0641\u0648\u0639 \u0644\u0647',details:'\u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644',extra:'\u062a\u0641\u0627\u0635\u064a\u0644 \u0625\u0636\u0627\u0641\u064a\u0629',
 total:'\u0627\u0644\u0645\u062c\u0645\u0648\u0639 \u062d\u0633\u0628 \u0627\u0644\u0639\u0645\u0644\u0629',count:'\u0639\u062f\u062f \u0627\u0644\u0639\u0645\u0644\u064a\u0627\u062a',
 export:'\u062a\u0635\u062f\u064a\u0631 Excel',empty:'\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0635\u0631\u0648\u0641\u0627\u062a \u0641\u064a \u0627\u0644\u0641\u062a\u0631\u0629 \u0627\u0644\u0645\u062d\u062f\u062f\u0629.',
 view:'\u0639\u0631\u0636',other:'\u0623\u062e\u0631\u0649',save:'\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0645\u0635\u0631\u0648\u0641',saved:'\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0645\u0635\u0631\u0648\u0641.',
};
const defaults={period:'day',anchor:todayISO()};
function summary(rows){
  const totals={},active=rows.filter(r=>!r.transaction_is_void);
  for(const r of active){
    const currency=r.currency_code||'SYP';
    totals[currency]=(totals[currency]||0)+Number(r.amount_original||0);
  }
  return {totals,count:active.length};
}
export async function renderFilteredExpenses(root,options=defaults){
  const state={...defaults,...options};
  let boxes=[],categories=[],rows=[],appSettings={};
  root.innerHTML=`<div class="page-head"><div><h2>${L.title}</h2><p>${L.total}</p></div><button class="btn new-expense">${L.newExpense}</button></div>
    <div class="card expense-filters"><div class="form-grid">
    <div class="field"><label>${L.filter}</label><select id="expense-period"><option value="day">${L.day}</option><option value="month">${L.month}</option><option value="year">${L.year}</option></select></div>
    <div class="field"><label>${L.date}</label><input type="date" id="expense-date" value="${state.anchor}"></div></div>
    <div class="quick-actions"><button class="btn secondary export-expenses">${L.export}</button></div></div>
    <div id="expense-summary" class="expense-summary"></div><div id="expense-table"></div>`;
  const $=q=>root.querySelector(q);
  $('#expense-period').value=state.period;
  const draw=()=>{
    const filtered=rows.filter(r=>dateInRange(r.occurred_at,datePeriod(state.period,state.anchor).start,datePeriod(state.period,state.anchor).end));
    const {totals,count}=summary(filtered);
    $('#expense-summary').innerHTML=`${Object.entries({SYP:totals.SYP||0,USD:totals.USD||0}).map(([c,v])=>`<div class="card"><div class="metric-label">${L.total} ${c}</div><div class="metric-value">${money(v,c)}</div></div>`).join('')}<div class="card"><div class="metric-label">${L.count}</div><div class="metric-value">${count}</div></div>`;
    $('#expense-table').innerHTML=filtered.length?`<div class="table-wrap table-fit"><table class="table expense-table"><thead><tr><th>${L.date}</th><th>${L.name}</th><th>${L.category}</th><th>${L.amount}</th><th>${L.box}</th><th>${L.recipient}</th><th>${L.details}</th></tr></thead><tbody>${filtered.map(r=>`<tr class="${r.transaction_is_void?'is-void':''}"><td>${dateOnly(r.occurred_at)}</td><td>${esc(r.title||'')}</td><td>${esc(r.category_name||L.other)}</td><td>${r.amount_original==null?'\u2014':money(r.amount_original,r.currency_code||'SYP')}</td><td>${esc(r.cashbox_name||'\u2014')}</td><td>${esc(r.payee||'\u2014')}</td><td><button class="mini-action expense-details" data-id="${esc(r.id)}" type="button">${L.view}</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="card empty">${L.empty}</div>`;
    root.querySelectorAll('.expense-details').forEach(button=>button.addEventListener('click',()=>{
      const row=filtered.find(r=>String(r.id)===String(button.dataset.id));
      if(!row)return;
      modal({title:row.title||L.details,body:`<div class="kv expense-detail-kv"><div class="k">${L.date}</div><div>${dateOnly(row.occurred_at)}</div><div class="k">${L.amount}</div><div>${money(row.amount_original,row.currency_code||'SYP')}</div><div class="k">${L.category}</div><div>${esc(row.category_name||L.other)}</div><div class="k">${L.box}</div><div>${esc(row.cashbox_name||'\u2014')}</div><div class="k">${L.recipient}</div><div>${esc(row.payee||'\u2014')}</div><div class="k">${L.extra}</div><div>${esc(row.description||'\u2014')}</div></div>`,submitText:'\u0625\u063a\u0644\u0627\u0642',onSubmit:async()=>true});
    }));
    return filtered;
  };
  const reload=async()=>{
    $('#expense-table').innerHTML=loader();
    try{
      const {start,end}=datePeriod(state.period,state.anchor);
      const res=await Promise.all([api.expenseDetailsForPeriod(start,end),api.cashboxes(),api.expenseCategories(),api.list('app_settings',{limit:1})]);
      [rows,boxes,categories]=res;appSettings=res[3]?.[0]||{};
      draw();
    }catch(e){$('#expense-table').textContent=friendlyError(e);}
  };
  $('#expense-period').onchange=e=>{state.period=e.target.value;reload();};
  $('#expense-date').onchange=e=>{state.anchor=e.target.value;reload();};
  $('.export-expenses').onclick=()=>{
    const shown=draw();const {totals,count}=summary(shown);
    const data=shown.map(r=>[String(r.occurred_at||'').slice(0,10),r.title||'',r.category_name||L.other,Number(r.amount_original||0),r.currency_code||'SYP',r.cashbox_name||'',r.payee||'',r.description||'']);
    data.push(['',L.total,...[],Number(totals.SYP||0),'SYP','','','']);
    data.push(['',L.total,...[],Number(totals.USD||0),'USD','','','']);
    data.push(['',L.count,count,'','','','','']);
    downloadXlsx(`expenses-${datePeriod(state.period,state.anchor).start}.xlsx`,[L.date,L.name,L.category,L.amount,L.currency,L.box,L.recipient,L.extra],data,'Expenses');
  };
  $('.new-expense').onclick=()=>{
    const general=boxes.find(b=>b.is_active!==false&&String(b.id)===String(appSettings.default_expense_cashbox_id||''))||boxes.find(b=>b.is_general&&b.is_active!==false)||boxes.find(b=>b.is_active!==false);
    modal({title:L.newExpense,body:`<div class="form-grid">
    <div class="field full"><label>${L.name}</label><input name="title" required></div>
    <div class="field"><label>${L.amount}</label><input name="amount" type="number" min="0.000001" step="any" required></div>
    <div class="field"><label>${L.currency}</label><select name="currency"><option>SYP</option><option>USD</option></select></div>
    <div class="field"><label>${L.box}</label><select name="box" required>${boxes.filter(b=>b.is_active!==false).map(b=>`<option value="${esc(b.id)}" ${b.id===general?.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
    <div class="field"><label>${L.category}</label><select name="cat"><option value="">${L.other}</option>${categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>${L.recipient}</label><input name="payee"></div>
    <div class="field"><label>${L.date}</label><input type="date" name="date" value="${todayISO()}" required></div>
    <div class="field full"><label>${L.extra}</label><textarea name="description" rows="2"></textarea></div></div>`,submitText:L.save,
    onSubmit:async fd=>{
      try{
        await api.recordExpense({cashboxId:fd.get('box'),amount:fd.get('amount'),title:fd.get('title'),currency:fd.get('currency'),categoryId:fd.get('cat')||null,payee:String(fd.get('payee')||'').trim()||null,description:String(fd.get('description')||'').trim()||null,date:fd.get('date')});
        toast(L.saved,'success');await reload();return true;
      }catch(error){toast(friendlyError(error),'error');return false;}
    }});
  };
  await reload();
}
