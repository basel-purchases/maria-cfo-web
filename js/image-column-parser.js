// Conservative OCR parsing for documents where the provider emits one column at a time.
// Source values are suggestions only and never create financial entries on their own.
const AR=/[\u0621-\u064A]/u;
const RE_ITEM=/^(?:\u0627\u0644\u0635\u0646\u0641|\u0627\u0644\u0623\u0635\u0646\u0627\u0641|\u0627\u0644\u0627\u0635\u0646\u0627\u0641|\u0627\u0633\u0645\s+\u0627\u0644\u0635\u0646\u0641|\u0627\u0644\u0645\u0627\u062f\u0629|\u0627\u0633\u0645\s+\u0627\u0644\u0645\u0627\u062f\u0629|\u0646\u0648\u0639\s+\u0627\u0644\u0628\u0636\u0627\u0639\u0629|item|item\s+name|description)$/iu;
const RE_HEADER=/^(?:\u0627\u0644\u0648\u062d\u062f\u0629(?:\s+\u0627\u0644\u0643\u0645\u064a\u0629)?|\u0627\u0644\u0643\u0645\u064a\u0629|\u0627\u0644\u0633\u0639\u0631|\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a|\u0627\u0644\u0627\u062c\u0645\u0627\u0644\u064a|unit|quantity|price|total|unit\s+price|value)$/iu;
const RE_FOOTER=/^(?:\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a|\u0627\u0644\u0627\u062c\u0645\u0627\u0644\u064a|\u0627\u0644\u0635\u0627\u0641\u064a|\u0627\u0644\u0645\u062f\u0641\u0648\u0639|\u0627\u0644\u0645\u062a\u0628\u0642\u0649|\u0627\u0644\u0645\u062a\u0628\u0642\u064a|\u0627\u0644\u0645\u062c\u0645\u0648\u0639|subtotal|total|paid|due)$/iu;
const RE_UNIT=/^(?:unit|unt|pcs|piece|pieces|\u0642\u0637\u0639\u0629|\u0648\u062d\u062f\u0629|\u0639\u062f\u062f)$/iu;
const RE_NUM=/^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/u;
const RE_UNKNOWN=/^#{3,}$/;

export function normalizeDigits(text){
  return String(text??'').replace(/[\u0660-\u0669\u06F0-\u06F9]/g,d=>{
    const value=d.charCodeAt(0);return String(value>=0x06F0?value-0x06F0:value-0x0660);
  }).replace(/\u066B/g,'.').replace(/\u066C/g,',');
}
function numberFromToken(token){
  const s=String(token||'').replace(/\u00a0/g,'').trim();
  if(!RE_NUM.test(s))return null;
  // Commas are digit-group separators for provider currency output.
  const numeric=Number(s.replace(/,/g,''));
  return Number.isFinite(numeric)?numeric:null;
}
function validPositive(number){return Number.isFinite(number)&&number>0&&number<1e12;}
function numericText(number){return Number(number.toFixed(6)).toString();}

export function parseColumnarOcrItems(text,limit=50){
  const lines=normalizeDigits(text).split(/\r?\n/).map(v=>v.replace(/\u00a0/g,' ').trim()).filter(Boolean);
  const start=lines.findIndex(line=>RE_ITEM.test(line));
  if(start<0)return {rows:[],reason:'NO_ITEM_COLUMN'};
  let cursor=start+1;
  while(cursor<lines.length&&RE_HEADER.test(lines[cursor]))cursor++;
  const names=[];
  while(cursor<lines.length&&names.length<limit){
    const line=lines[cursor++];
    if(RE_FOOTER.test(line))break;
    if(RE_HEADER.test(line))continue;
    if(line.length>125 || !AR.test(line))return {rows:[],reason:'UNSAFE_ITEM_COLUMN'};
    names.push(line);
  }
  if(!names.length||names.length>limit||cursor===lines.length&&!RE_FOOTER.test(lines.at(-1)))return {rows:[],reason:'NO_ITEM_NAMES'};
  // The amount/price/quantity triples appear after the total/paid column labels.
  // A token such as 'unit' terminates the numeric values of each item row.
  const groups=[];
  let pending=[];
  for(;cursor<lines.length&&groups.length<names.length;cursor++){
    const line=lines[cursor];
    if(RE_FOOTER.test(line))continue;
    for(const token of line.split(/\s+/)){
      if(RE_UNIT.test(token)){
        if(pending.length>=2)groups.push(pending);
        pending=[];
        if(groups.length===names.length)break;
      }else if(RE_NUM.test(token)||RE_UNKNOWN.test(token))pending.push(token);
      else {
        // Unexpected text means alignment is uncertain; do not guess correspondence.
        if(pending.length)return {rows:[],reason:'UNALIGNED_COLUMNS'};
        return {rows:[],reason:'UNALIGNED_COLUMNS'};
      }
      if(pending.length>5)return {rows:[],reason:'UNALIGNED_COLUMNS'};
    }
  }
  if(groups.length!==names.length)return {rows:[],reason:'COLUMN_COUNT_MISMATCH',itemCount:names.length,amountGroups:groups.length};
  const parsed=[];
  for(let index=0;index<names.length;index++){
    const group=groups[index];
    const total=numberFromToken(group[0]);
    const qty=numberFromToken(group.at(-1));
    const price=group.length>=3?numberFromToken(group[1]):null;
    if(!validPositive(total)||!validPositive(qty))return {rows:[],reason:'INVALID_AMOUNTS'};
    let unitPrice=price;
    let reviewNote='';
    if(!validPositive(unitPrice)){
      unitPrice=total/qty;
      if(!validPositive(unitPrice))return {rows:[],reason:'INVALID_AMOUNTS'};
      reviewNote='\u0627\u0644\u0633\u0639\u0631 \u0645\u062d\u0633\u0648\u0628 \u0645\u0646 \u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0633\u0637\u0631 \u0648\u0627\u0644\u0643\u0645\u064a\u0629\u061b \u0631\u0627\u062c\u0639\u0647 \u0641\u064a \u0627\u0644\u0635\u0648\u0631\u0629 \u0627\u0644\u0623\u0635\u0644\u064a\u0629.';
    }else if(Math.abs(unitPrice*qty-total)>Math.max(0.01,total*.015)){
      reviewNote='\u0633\u0639\u0631 \u0627\u0644\u0648\u062d\u062f\u0629 \u0648\u0627\u0644\u0643\u0645\u064a\u0629 \u0644\u0627 \u064a\u0637\u0627\u0628\u0642\u0627\u0646 \u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0633\u0637\u0631\u061b \u0631\u0627\u062c\u0639 \u0627\u0644\u0623\u0631\u0642\u0627\u0645.';
    }
    parsed.push({
      name:names[index],quantity:numericText(qty),unit_price:numericText(unitPrice),
      discount:'0',unit_id:'',catalog_id:'',raw_line:`OCR line total: ${numericText(total)}`,
      ocr_line_total:numericText(total),review_note:reviewNote,
      ocr_source:'column_aligned',
    });
  }
  // Match the first clear footer total if present; never silently fix OCR values.
  let footerTotal=null;
  for(const line of lines.slice(cursor)){
    const candidate=numberFromToken(line);
    if(candidate!==null){footerTotal=candidate;break;}
    if(!RE_FOOTER.test(line))break;
  }
  const computed=parsed.reduce((sum,row)=>sum+Number(row.ocr_line_total),0);
  const totalMatches=footerTotal===null?null:Math.abs(computed-footerTotal)<=Math.max(.01,footerTotal*.001);
  if(totalMatches===false){
    for(const row of parsed){row.review_note=[row.review_note,'\u0645\u062c\u0645\u0648\u0639 \u0627\u0644\u0628\u0646\u0648\u062f \u0644\u0627 \u064a\u0637\u0627\u0628\u0642 \u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0645\u0633\u062a\u0646\u062f\u061b \u0631\u0627\u062c\u0639 \u0627\u0644\u0623\u0631\u0642\u0627\u0645.'].filter(Boolean).join(' ');}
  }
  return {rows:parsed,reason:'MATCHED_COLUMNS',itemCount:names.length,footerTotal,computedTotal:computed,totalMatches};
}
