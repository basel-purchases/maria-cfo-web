// Maria CFO v0.37 — validate a serving conversion before creating anything.
// Menu-to-serving yield and ingredient-to-stock-unit conversion are independent.
import {normalizedUnitName,isVagueContextualName} from './unit-catalog.js?v=0.27';

const finitePositive=value=>Number.isFinite(Number(value))&&Number(value)>0;
const hasAtMostFourDecimals=value=>Math.abs(Number(value)*10000-Math.round(Number(value)*10000))<0.0000001;

export function validateQuickServingV037({menuItemId,name,yieldCount,materialId=null,quantityInBase=null,
 menuConversions=[],units=[],recipeMaterialIds=[]}={}){
 const label=String(name||'').trim().replace(/\s+/g,' ');
 const normalized=normalizedUnitName(label);
 if(!menuItemId)return 'اختر الصنف من المنيو أولًا.';
 if(!label||label.length>80)return 'اكتب اسم حصة واضحًا لا يتجاوز 80 حرفًا.';
 if(isVagueContextualName(label))return 'استخدم اسمًا واضحًا مثل «سيخ شيش طاووق» بدل اسم عام.';
 if(!finitePositive(yieldCount)||Number(yieldCount)<0.0001||Number(yieldCount)>100000||!hasAtMostFourDecimals(yieldCount))
  return 'أدخل عدد الحصص في وجبة المنيو (أكبر من صفر، حتى 4 منازل عشرية).';
 if(menuConversions.some(x=>String(x.menu_item_id)===String(menuItemId)&&normalizedUnitName(x.serving_label)===normalized))
  return 'هذه الحصة محفوظة مسبقًا لهذا الصنف؛ اخترها من القائمة بدل إضافتها مرة ثانية.';
 if(materialId){
  if(!recipeMaterialIds.map(String).includes(String(materialId)))
   return 'اختر مادةً مستخدمة في وصفة هذا الصنف فقط.';
  if(!finitePositive(quantityInBase)||Number(quantityInBase)<0.00000001||Number(quantityInBase)>99999999999)
   return 'حدّد مقدار الوحدة الجديدة من وحدة مخزون المادة، بقيمة موجبة.';
  if(units.some(u=>normalizedUnitName(u.name)===normalized))
   return 'اسم الوحدة موجود في دليل الوحدات. اختر الموجود من القائمة أو أدخل اسمًا يميز هذه المادة.';
 }
 return null;
}

export function quickServingChoiceV037({servingLabel,unitId}){
 return unitId?String(unitId):`saved:${servingLabel}`;
}
