// A selected crop is not necessarily more accurate than reading the entire
// invoice. Choose the interpretation with more legitimate, numeric item rows.
function quality(rows){
 if(!rows?.length)return -1;
 const valid=rows.filter(r=>String(r.name||'').trim().length>=2);
 const prices=valid.filter(r=>r.unit_price!==''&&r.unit_price!=null);
 const quantities=valid.filter(r=>r.quantity!==''&&r.quantity!=null);
 const sources=valid.filter(r=>r.ocr_source==='markdown_columns'||r.ocr_source==='column_aligned');
 return valid.length*2 + prices.length*3 + quantities.length*3 + sources.length;
}
export function chooseBestOcrRowsV110(fullRows,croppedRows){
 const whole=Array.isArray(fullRows)?fullRows:[],cropped=Array.isArray(croppedRows)?croppedRows:[];
 if(!cropped.length)return {rows:whole,source:'full'};
 if(!whole.length)return {rows:cropped,source:'selected_items'};
 return quality(cropped)>quality(whole)?{rows:cropped,source:'selected_items'}:{rows:whole,source:'full'};
}
