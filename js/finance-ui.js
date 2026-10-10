import { esc, money, pick } from './utils.js?v=0.27';

const n=(value)=>Number.isFinite(Number(value))?Number(value):0;
export function financialCard(title,value,{currency=true,foot='',tone='',kind=''}={}){
  const display=value==null?'—':currency?money(value):esc(value);
  return `<div class="card finance-metric ${tone}"><div class="metric-label">${esc(title)}</div><div class="metric-value">${display}</div>${foot?`<div class="metric-note">${esc(foot)}</div>`:''}${kind?`<span class="metric-kind">${esc(kind)}</span>`:''}</div>`;
}
export function simpleInfo(label,value){return `<div class="finance-info-row"><span>${esc(label)}</span><strong>${esc(value??'—')}</strong></div>`;}
export function qualityMessages(data){
  const q=data?.data_quality||{};
  const warnings=[];
  if(q.profit_is_final===false) warnings.push(['تنبيه دقة النتائج','صافي الربح مؤقت حتى تكتمل جميع التكاليف التاريخية.']);
  for(const [key,title] of [
    ['incomplete_order_count','أوردرات تكلفتها ناقصة'],
    ['duplicate_order_count','أوردرات يُشتبه بتكرارها'],
    ['incomplete_event_count','حفلات تكلفتها غير مكتملة'],
    ['estimated_event_food_cost_count','حفلات بطعام بتكلفة تقديرية'],
    ['unclosed_cashbox_count','جلسات صناديق لم تُغلق'],
  ]){
    const x=n(q[key]);if(x>0) warnings.push([title,`${x} حالة تحتاج مراجعة`]);
  }
  if(q.waste_cost_incomplete===true) warnings.push(['تكلفة الهدر','بعض حركات الهدر تفتقد التكلفة.']);
  return warnings;
}
export function barTrend(series=[],key='total_revenue_base'){
  if(!Array.isArray(series)||!series.length) return '<div class="empty">لا توجد بيانات زمنية لهذه الفترة.</div>';
  const points=series.slice(-31);
  const highest=Math.max(...points.map(x=>Math.max(0,n(x[key]))),0);
  return `<div class="trend-plot" role="img" aria-label="رسم يوضح الإيراد عبر الفترة">${points.map(x=>{
    const v=Math.max(0,n(x[key]));const height=highest>0?Math.max(2,v/highest*100):2;
    return `<div class="trend-column" title="${esc(x.period_start||'')}: ${money(v)}">
      <div class="trend-bar" style="height:${height}%"></div>
      <span>${esc(String(x.period_start||'').slice(5))}</span>
    </div>`;
  }).join('')}</div>`;
}
export function financialRowTable(rows,columns,empty='لا توجد بيانات لهذه الفترة.'){
  if(!Array.isArray(rows)||!rows.length)return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="table-wrap finance-table-wrap"><table class="table finance-table"><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(row=>`<tr>${columns.map(c=>`<td>${c.format?c.format(row[c.key],row):esc(row[c.key]??'—')}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}
export function finalProfitValue(report){
  const k=report?.kpis||{};
  return k.profit_is_final===false?pick(k,['provisional_net_result_base'],null):pick(k,['net_result_base'],null);
}
