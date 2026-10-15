// Maria CFO v0.30: exact two-sheet catalog/recipe workbook. No guessed costs or recipe quantities.
import {cleanName} from './ameen-import-parser.js?v=1.0';
const txt=x=>String(x??'').trim().replace(/\s+/g,' ');
const number=x=>x==null||txt(x)===''?null:(Number.isFinite(Number(x))?Number(x):null);
const badMessage=x=>`الملف غير صالح: ${x}`;
const normalizeDate=x=>{
  if(x==null||txt(x)==='')return null;
  if(typeof x==='number'&&Number.isFinite(x)){
    const date=new Date((Math.floor(x)-25569)*86400000);
    return Number.isNaN(date.valueOf())?null:date.toISOString().slice(0,10);
  }
  const a=txt(x).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return a?`${a[1]}-${a[2].padStart(2,'0')}-${a[3].padStart(2,'0')}`:null;
};
export function parseMasterV030(workbook){
  const ms=workbook.sheets.find(s=>cleanName(s.name)==='المواد');
  const ds=workbook.sheets.find(s=>cleanName(s.name)==='المنيو والوصفات');
  if(!ms||!ds)throw Error(badMessage('يجب وجود شيت «المواد» وشيت «المنيو والوصفات».'));
  const mh=ms.rows.findIndex(r=>cleanName(r[0])===cleanName('المادة')&&cleanName(r[1])===cleanName('الوحدة'));
  const dh=ds.rows.findIndex(r=>cleanName(r[0])===cleanName('اسم الوجبة')&&cleanName(r[1])==='سعر البيع');
  if(mh<0||dh<0)throw Error(badMessage('عناوين أعمدة المواد أو المنيو غير مطابقة.'));
  const materials=[];const known=new Map(),byCode=new Map();const warnings=[];
  for(let i=mh+1;i<ms.rows.length;i++){
    const r=ms.rows[i]||[];const name=txt(r[0]),unit=txt(r[1]),stock=number(r[2]),price=number(r[3]);
    if(!name||name==='لا توجد مادة بهذا البحث')continue;
    if(!unit||stock==null||stock<0||price==null||price<0||(price===0&&stock>0))throw Error(`المواد، السطر ${i+1}: الوحدة والكمية غير السالبة والسعر غير السالب مطلوب (يمكن تركه صفرًا فقط عندما يكون الرصيد صفرًا) للمادة «${name}».`);
    if(stock>1e12||price>1e12)throw Error(`المواد، السطر ${i+1}: كمية أو سعر غير منطقي.`);
    const key=cleanName(name);
    if(known.has(key))throw Error(`المواد: الاسم «${name}» مكرر. يرجى توحيد الأسماء أولًا.`);
    const code=txt(r[5]);
    if(code&&byCode.has(code))throw Error(`المواد: الكود ${code} مكرر.`);
    const mat={name,unit,quantity:stock,lastPrice:price,priceDate:normalizeDate(r[4]),code};
    materials.push(mat);known.set(key,mat);if(code)byCode.set(code,mat);
  }
  if(!materials.length)throw Error(badMessage('شيت المواد فارغ.'));
  const dishes=[];let current=null;const seenDishes=new Set();let filled=0,allRows=0,recipesReady=0;
  for(let i=dh+1;i<ds.rows.length;i++){
    const r=ds.rows[i]||[];const name=txt(r[0]);
    if(name){
      const key=cleanName(name);if(seenDishes.has(key))throw Error(`المنيو: الوجبة «${name}» مكررة.`);
      const rawPrice=number(r[1]);
      if(rawPrice!=null&&rawPrice<0)throw Error(`المنيو، السطر ${i+1}: سعر بيع «${name}» سالب.`);
      const salePrice=rawPrice>0?rawPrice:null;
      if(salePrice==null)warnings.push({row:i+1,message:`سعر بيع «${name}» ناقص؛ سيُحفظ بدون تكلفة وFood Cost حتى يكتمل.`});
      current={name,salePrice,status:txt(r[2])||'بحاجة لإضافة مواد',lines:[]};
      dishes.push(current);seenDishes.add(key);
    }
    if(!current)continue;
    // E may be a cached formula; N is the internal source material code.
    const rawMaterial=txt(r[4]),code=txt(r[13]);
    const resolved=byCode.get(code);
    const materialName=rawMaterial||resolved?.name||'';
    const quantity=number(r[5]);
    const note=txt(r[10]);
    if(!materialName&&quantity==null&&!note&&!txt(r[3]))continue;
    const material=known.get(cleanName(materialName));
    if(!materialName&&(!note||note==='أضف المكونات'||note==='حدّد الكميات')){
      if(note==='أضف المكونات')continue;
      // An unspecified recipe line is a deliberate review placeholder.
    }
    const unknownPrice=!!material&&!(material.lastPrice>0);
    const line={materialName,quantity,unit:material?.unit||txt(r[6]),note,
      needsReview:!material||!(quantity>0)||unknownPrice||Boolean(note.startsWith('اختر مادة:'))};
    if(unknownPrice)warnings.push({row:i+1,message:`المادة «${material.name}» مسجلة برصيد صفر دون سعر شراء؛ تكلفة الوصفة معلقة حتى التسعير.`});
    if(materialName&&!material)warnings.push({row:i+1,message:`المادة «${materialName}» غير موجودة في شيت المواد.`});
    current.lines.push(line);allRows++;
    if(material&&quantity>0&&!line.needsReview)filled++;
  }
  if(!dishes.length)throw Error(badMessage('شيت المنيو فارغ.'));
  for(const dish of dishes){
    dish.complete=dish.salePrice>0&&dish.status==='منتهي'&&dish.lines.length>0&&dish.lines.every(l=>!l.needsReview);
    if(dish.complete)recipesReady++;
  }
  return {materials,dishes,warnings,stats:{materials:materials.length,menu:dishes.length,
    lines:allRows,pricedLines:filled,readyRecipes:recipesReady,pendingRecipes:dishes.length-recipesReady}};
}

export const QUICK_TYPES_V030=Object.freeze({
  master:'01 · المواد والمنيو والوصفات',
  assets:'02 · الأساسيات',
  suppliers:'03 · حسابات الموردين',
  orders:'04 · الأوردرات',
  employees:'05 · إضافة الموظفين (رواتب شهرية)'
});
