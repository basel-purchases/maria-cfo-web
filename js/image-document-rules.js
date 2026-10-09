// Deterministic extraction hints and validation; AI does not invent required values.
const LETTERS=/[\p{L}]/u;
export function normalizeArabicNumbers(value){
  return String(value??'').replace(/[٠-٩۰-۹]/g,c=>{
    const n=c.charCodeAt(0);return String(n>=0x06f0?n-0x06f0:n-0x0660);
  }).replace(/٫/g,'.').replace(/٬/g,'').replace(/،/g,',');
}
export function normalizedName(value){
  return normalizeArabicNumbers(value).normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g,'')
    .replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
    .replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase('ar');
}
export function exactCatalogId(name,catalog){
  const wanted=normalizedName(name);
  if(!wanted)return '';
  const hits=catalog.filter(x=>normalizedName(x.name)===wanted);
  return hits.length===1?String(hits[0].id):'';
}
export function parseOcrLines(text,limit=80){
  const result=[];
  for(const raw of normalizeArabicNumbers(text).split(/\r?\n/)){
    const line=raw.replace(/[|\t]/g,' ').replace(/\s+/g,' ').trim();
    if(!line || !LETTERS.test(line) || line.length>155)continue;
    if(/^(مجموع|المجموع|الاجمالي|الإجمالي|التاريخ|الوقت|الرقم|الصافي|الضريبة|فاتورة|رقم الفاتورة|total|date|invoice|المبلغ|شكرا)(?:\s|$|\d)/i.test(line))continue;
    const tokens=line.split(' ');
    const numeric=token=>/^\d+(?:\.\d+)?$/.test(token);
    let quantity='',unit_price='',name=line;
    // 2 شاي 1500; شاي 2 1500; لا نستنتج سعرًا أو كمية مفقودة.
    if(tokens.length>=3 && numeric(tokens[0]) && numeric(tokens.at(-1))){
      quantity=tokens[0];unit_price=tokens.at(-1);name=tokens.slice(1,-1).join(' ');
    }else if(tokens.length>=3 && numeric(tokens.at(-2)) && numeric(tokens.at(-1))){
      quantity=tokens.at(-2);unit_price=tokens.at(-1);name=tokens.slice(0,-2).join(' ');
    }else if(tokens.length>=2 && numeric(tokens.at(-1))){
      unit_price=tokens.at(-1);name=tokens.slice(0,-1).join(' ');
    }
    if(!LETTERS.test(name)||name.length<2)continue;
    result.push({id:crypto.randomUUID(),name,quantity,unit_price,discount:'0',unit_id:'',catalog_id:'',raw_line:line});
    if(result.length>=limit)break;
  }
  return result;
}
export function autofillExactCatalog(rows,catalog){
  return rows.map(row=>({...row,catalog_id:exactCatalogId(row.name,catalog)}));
}
export function validateImageDocument(doc,{menu=[],materials=[],units=[],materialLinks=[],cashboxes=[]}={}){
  const problems=[];
  const purchase=doc.type==='purchase';
  if(!['order','purchase'].includes(doc.type))problems.push('نوع المستند غير محدد');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(doc.date||''))||Number.isNaN(new Date(doc.date+'T12:00:00').getTime())) problems.push('تاريخ صحيح');
  if(!['SYP','USD'].includes(doc.currency))problems.push('عملة صحيحة');
  if(!purchase && !cashboxes.some(b=>String(b.id)===String(doc.cashbox_id)&&b.is_active!==false))problems.push('صندوق نشط للأوردر');
  if(!Array.isArray(doc.items)||!doc.items.length)problems.push('بند واحد على الأقل');
  const allowed=purchase?materials:menu;
  const prepared=[];
  for(const [index,row] of (doc.items||[]).entries()){
    const rowNo=index+1;
    const known=allowed.find(item=>String(item.id)===String(row.catalog_id));
    if(!known){problems.push(`البند ${rowNo}: اختر ${purchase?'مادة':'صنفًا'} من القائمة`);continue;}
    const qty=Number(normalizeArabicNumbers(row.quantity));
    const price=Number(normalizeArabicNumbers(row.unit_price));
    const discount=Number(normalizeArabicNumbers(row.discount||0));
    if(!Number.isFinite(qty)||qty<=0)problems.push(`البند ${rowNo}: الكمية أكبر من صفر`);
    if(!Number.isFinite(price)||price<=0)problems.push(`البند ${rowNo}: سعر الوحدة أكبر من صفر`);
    if(!Number.isFinite(discount)||discount<0||discount>(purchase?qty*price:100))problems.push(`البند ${rowNo}: خصم صالح`);
    const rowData={catalog_id:known.id,name:known.name,quantity:qty,unit_price:price,discount};
    if(purchase){
      const unit=units.find(u=>String(u.id)===String(row.unit_id));
      const validUnit=Boolean(unit) && (String(known.base_unit_id)===String(row.unit_id)||materialLinks.some(rel=>String(rel.material_id)===String(known.id)&&String(rel.unit_id)===String(row.unit_id)));
      if(!validUnit)problems.push(`البند ${rowNo}: اختر وحدة شراء مرتبطة بالمادة`);
      rowData.unit_id=unit?.id||null;
    }
    prepared.push(rowData);
  }
  return {ready:problems.length===0,problems,prepared};
}
export function localStatus(doc,validation){
  if(doc.status==='published')return 'منشور';
  if(doc.status==='draft')return 'مسودة داخل البرنامج';
  if(doc.status==='uncertain')return 'مراجعة نتيجة العملية';
  if(!doc.text&&!doc.items?.length)return 'غير معالج';
  return validation?.ready?'جاهز للنشر':'يحتاج استكمال';
}
