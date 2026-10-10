import * as api from '../api.js?v=0.23';
import {esc,money,dateOnly,todayISO} from '../utils.js?v=0.23';
import {toast,friendlyError} from '../ui.js?v=0.23';
import {datePeriod,dateInRange} from '../date-range-batch.js?v=0.23';
import {downloadXlsx} from '../xlsx-export.js?v=0.23';
import {filteredManualTransactions} from '../manual-ledger-filter.js?v=0.23';

const Z='\u2014';
const message={
  title:'\u0633\u062c\u0644 \u062d\u0631\u0643\u0627\u062a \u0627\u0644\u0635\u0646\u0627\u062f\u064a\u0642 \u0627\u0644\u064a\u062f\u0648\u064a\u0629',
  date:'\u0627\u0644\u062a\u0627\u0631\u064a\u062e',box:'\u0627\u0644\u0635\u0646\u062f\u0648\u0642',kind:'\u0627\u0644\u0639\u0645\u0644\u064a\u0629',amount:'\u0627\u0644\u0645\u0628\u0644\u063a',note:'\u0645\u0644\u0627\u062d\u0638\u0629',
  day:'\u064a\u0648\u0645\u064a',month:'\u0634\u0647\u0631\u064a',year:'\u0633\u0646\u0648\u064a',all:'\u0627\u0644\u0643\u0644',in:'\u0625\u0636\u0627\u0641\u0629',out:'\u0633\u062d\u0628',
  noRecords:'\u0644\u0627 \u062a\u0648\u062c\u062f \u062d\u0631\u0643\u0627\u062a \u064a\u062f\u0648\u064a\u0629 \u0644\u0644\u0641\u062a\u0631\u0629.',
  refresh:'\u062a\u062d\u062f\u064a\u062b',export:'\u062a\u0635\u062f\u064a\u0631 Excel',totalIn:'\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0625\u062f\u062e\u0627\u0644',totalOut:'\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0633\u062d\u0628',
  filter:'\u0639\u0631\u0636 \u062d\u0633\u0628 \u0627\u0644\u0641\u062a\u0631\u0629',
};
const fmtTotals=entries=>{
  const currencies=['SYP','USD',...Object.keys(entries).filter(c=>!['SYP','USD'].includes(c))];
  return [...new Set(currencies)].map(c=>`${money(entries[c]||0,c)}`).join('  |  ');
};
function txDirection(tx){return tx.direction==='out'?'out':'in';}
function summarize(rows){
  const input={},output={};
  for(const row of rows){
    const key=String(row.currency_code||'SYP').toUpperCase();
    const bucket=txDirection(row)==='out'?output:input;
    bucket[key]=(bucket[key]||0)+Number(row.amount_original||0);
  }
  return {input,output};
}
export async function renderCashboxManualLedger(host,boxes){
  const state={period:'day',anchor:todayISO(),box:'all',direction:'all'};
  let rows=[];
  const boxMap=Object.fromEntries(boxes.map(b=>[String(b.id),b.name]));
  host.innerHTML=`<div class="card cashbox-ledger" style="margin-top:16px">
    <div class="section-head-inline"><div><h3>${message.title}</h3><p>${message.filter}</p></div>
      <button class="btn secondary ledger-export" type="button">${message.export}</button></div>
    <div class="form-grid cashbox-ledger-filters">
      <div class="field"><label>${message.filter}</label><select id="ledger-period"><option value="day">${message.day}</option><option value="month">${message.month}</option><option value="year">${message.year}</option></select></div>
      <div class="field"><label>${message.date}</label><input id="ledger-date" type="date" value="${state.anchor}"></div>
      <div class="field"><label>${message.box}</label><select id="ledger-box"><option value="all">${message.all}</option>${boxes.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></div>
      <div class="field"><label>${message.kind}</label><select id="ledger-direction"><option value="all">${message.all}</option><option value="in">${message.in}</option><option value="out">${message.out}</option></select></div>
    </div>
    <div class="cashbox-ledger-totals" aria-live="polite"></div>
    <div class="cashbox-ledger-table"></div>
  </div>`;
  const $=sel=>host.querySelector(sel);
  const display=()=>{
    const filtered=filteredManualTransactions(rows,state);
    const totals=summarize(filtered);
    $('.cashbox-ledger-totals').innerHTML=`<div class="metric-in"><span>${message.totalIn}</span><strong>${fmtTotals(totals.input)}</strong></div><div class="metric-out"><span>${message.totalOut}</span><strong>${fmtTotals(totals.output)}</strong></div>`;
    $('.cashbox-ledger-table').innerHTML=`<div class="table-wrap table-fit"><table class="table"><thead><tr><th>${message.date}</th><th>${message.box}</th><th>${message.kind}</th><th>${message.amount}</th><th>${message.note}</th></tr></thead>
    <tbody>${filtered.map(tx=>{
      const dir=txDirection(tx);const name=boxMap[String(tx.cashbox_id)]||Z;
      return `<tr><td>${dateOnly(tx.occurred_at)}</td><td>${esc(name)}</td><td><span class="ledger-${dir}">${dir==='in'?message.in:message.out}</span></td><td class="ledger-${dir}">${money(tx.amount_original,tx.currency_code||'SYP')}</td><td>${esc(tx.description||Z)}</td></tr>`;
    }).join('')||`<tr><td colspan="5">${message.noRecords}</td></tr>`}</tbody></table></div>`;
    return filtered;
  };
  const fetchRows=async()=>{
    try{
      const {start,end}=datePeriod(state.period,state.anchor);
      rows=await api.cashboxManualTransactions(start,end);
      display();
    }catch(error){$('.cashbox-ledger-table').textContent=friendlyError(error);}
  };
  $('#ledger-period').addEventListener('change',e=>{state.period=e.target.value;fetchRows();});
  $('#ledger-date').addEventListener('change',e=>{state.anchor=e.target.value;fetchRows();});
  $('#ledger-box').addEventListener('change',e=>{state.box=e.target.value;display();});
  $('#ledger-direction').addEventListener('change',e=>{state.direction=e.target.value;display();});
  $('.ledger-export').addEventListener('click',()=>{
    const shown=display();
    const totals=summarize(shown);
    const record=shown.map(tx=>[String(tx.occurred_at||'').slice(0,19),boxMap[String(tx.cashbox_id)]||'',txDirection(tx)==='in'?message.in:message.out,Number(tx.amount_original||0),tx.currency_code||'SYP',tx.description||'']);
    record.push(['',message.totalIn,'',null,null,fmtTotals(totals.input),'']);
    record.push(['',message.totalOut,'',null,null,fmtTotals(totals.output),'']);
    downloadXlsx(`cashboxes-${datePeriod(state.period,state.anchor).start}.xlsx`,[message.date,message.box,message.kind,message.amount,'\u0627\u0644\u0639\u0645\u0644\u0629',message.note],record,'Cashboxes');
  });
  await fetchRows();
}
