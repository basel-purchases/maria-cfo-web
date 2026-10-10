import {modal} from './ui.js?v=0.25';
import {esc,money} from './utils.js?v=0.25';
import {numericValue} from './table-presenter-v025.js?v=0.25';

export function importedStockSummary(rows=[]){
 if(!rows.length)return '—';
 const items=rows.map(r=>`${r.warehouse||'غير محدد'}: ${r.quantity_original??'—'} ${r.unit_name||''}`);
 return items.slice(0,2).join(' / ')+(items.length>2?` (+${items.length-2})`:'');
}
export function importedPrice(rows=[]){
 const readable=rows.filter(x=>numericValue(x.source_price)!=null);
 const positive=readable.filter(x=>numericValue(x.source_price)>0);
 return positive.length?positive.at(-1).source_price:(readable.length?readable.at(-1).source_price:null);
}
export function importedRowHasWarning(rows=[]){return rows.some(r=>String(r.review_reason||'').trim());}
export function showImportedSourceDialog(name,rows=[]){
 modal({title:`بيانات الأمين: ${name}`,wide:true,hideActions:true,
  subtitle:'هذه لقطة البيانات القادمة من التقرير وليست بالضرورة الرصيد اللحظي بعد مبيعات المطعم.',
  body:rows.length?`<div class="table-wrap import-snapshot-scroll"><table class="table imported-source-table"><thead><tr>
    <th>المستودع</th><th>القسم</th><th>تصنيف الأمين</th><th>الكمية الأصلية</th><th>وحدة الجرد</th>
    <th>الكمية البديلة</th><th>الوحدة البديلة</th><th>سعر التقرير</th><th>الكمية الأساسية</th><th>ملاحظة الاستيراد</th><th>آخر تحديث</th>
  </tr></thead><tbody>${rows.map(r=>`<tr>
    <td>${esc(r.warehouse||'—')}</td><td>${esc(r.kind||'—')}</td><td>${esc(r.category||'—')}</td>
    <td>${esc(r.quantity_original??'—')}</td><td>${esc(r.unit_name||'—')}</td>
    <td>${esc(r.secondary_quantity??'—')}</td><td>${esc(r.secondary_unit||'—')}</td>
    <td>${r.source_price==null?'—':esc(money(r.source_price,'SYP'))}</td>
    <td>${esc(r.quantity_base??'—')}</td>
    <td>${r.review_reason?`<span class="badge yellow">${esc(r.review_reason)}</span>`:'—'}</td>
    <td>${esc(String(r.last_seen_at||'').slice(0,16).replace('T',' ')||'—')}</td>
  </tr>`).join('')}</tbody></table></div>`:
  '<div class="empty">لا يوجد سجل جرد مستورد لهذا الصنف.</div>'});
}
