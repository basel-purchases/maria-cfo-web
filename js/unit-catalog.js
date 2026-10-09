// Maria CFO v0.19: one descriptive label for each material-specific quantity.
// Data is read from the original units, material_units and unit_conversions.
import { unitDisplay } from './utils.js?v=0.22';
import { prettyRelation } from './unit-display-conversion.js?v=0.22';

const GENERAL_CODES = new Set(['KG','G','L','ML','PCS','PC','UNIT','DOZ','DOZEN']);
export const CONTEXTUAL_UNIT_CODES = new Set([
  'SPOON','TBSP','TSP','SCOOP','CUP','GLASS','BOX','CARTON','BAG','SACK',
  'PACK','PACKET','SAHARA','TRAY','BOTTLE','BTL','JAR','PAIL','BUCKET',
  'CRATE','BOWL','SLICE','PORTION','SERVING','BUNCH','BUNDLE','ROLL','LOAF'
]);
const VAGUE_CONTEXTUAL_NAMES=new Set([
  'ملعقة','ملعقة كبيرة','ملعقة صغيرة','كيس','صندوق','سحارة','كرتونة',
  'كوب','كاس','عبوة','باكيت','ظرف','زجاجة','علبة','مكيال',
  'شوال','سطل','سفط','صينية','حزمة','ربطة','قارورة'
]);

export function isVagueContextualName(value){
  return VAGUE_CONTEXTUAL_NAMES.has(normalizedUnitName(value));
}


export function normalizedUnitName(value){
  return String(value || '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g,'')
    .replace(/[أإآ]/g,'ا').replace(/ى/g,'ي')
    .replace(/\s+/g,' ').trim().toLocaleLowerCase();
}

export function isProtectedUnit(unit){
  return Boolean(unit?.is_system) || GENERAL_CODES.has(String(unit?.code||'').toUpperCase());
}

export function isContextualUnit(unit){
  return CONTEXTUAL_UNIT_CODES.has(String(unit?.code||'').toUpperCase());
}

export function formatUnitAmount(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0) return '؟';
  return new Intl.NumberFormat('ar-SY',{maximumFractionDigits:8,useGrouping:false}).format(n);
}

export function validateNamedUnitDraft({name, materialId, amount, unitId=null, units=[], catalog=[]}){
  const cleanName=String(name||'').trim().replace(/\s+/g,' ');
  const key=normalizedUnitName(cleanName);
  if(!key) return 'اكتب اسمًا واضحًا للوحدة، مثل «ملعقة سكر».';
  if(cleanName.length>120) return 'اسم الوحدة طويل جدًا.';
  const unchangedLegacyName=Boolean(unitId) && units.some(u=>String(u.id)===String(unitId) && normalizedUnitName(unitDisplay(u))===key);
  if(isVagueContextualName(cleanName) && !unchangedLegacyName) return 'اسم الوحدة عام وقد يسبب التباسًا. اكتب اسم المادة معه مثل «ملعقة سكر» أو «ملعقة سمنة».';
  if(!materialId) return 'اختر المادة التي تنتمي إليها الوحدة.';
  if(!(Number(amount)>=0.00000001) || !Number.isFinite(Number(amount))) return 'اكتب قيمة صحيحة أكبر من صفر للوحدة.';
  if(units.some(u=>String(u.id)!==String(unitId||'') &&
      (normalizedUnitName(u.name)===key || normalizedUnitName(unitDisplay(u))===key))) {
    return 'اسم الوحدة مستخدم بالفعل. اكتب اسمًا يميز المادة، مثل «ملعقة سمنة».';
  }
  const row=catalog.find(r=>String(r.unit.id)===String(unitId||''));
  if(row && !row.canEdit) return 'لا يمكن تعديل هذه الوحدة لأنها عامة أو مرتبطة بعلاقات متعددة. أنشئ وحدة خاصة باسم واضح.';
  if(row && row.materialLinks.length && String(row.materialLinks[0].material_id)!==String(materialId)) {
    return 'الوحدة مرتبطة بمادة أخرى، ولا يمكن تغيير مادتها بعد تعريفها. أنشئ وحدة جديدة باسم مختلف.';
  }
  return null;
}

export function buildUnitCatalog({units=[],materials=[],materialUnits=[],unitConversions=[]}={}){
  const unitMap=new Map(units.map(u=>[String(u.id),u]));
  const materialMap=new Map(materials.map(m=>[String(m.id),m]));
  const unitLinks=new Map();
  const baseLinks=new Map();
  const globalLinks=new Map();
  for(const rel of materialUnits){
    const key=String(rel.unit_id);
    if(!unitLinks.has(key)) unitLinks.set(key,[]);
    unitLinks.get(key).push(rel);
  }
  for(const mat of materials){
    const key=String(mat.base_unit_id);
    if(!baseLinks.has(key)) baseLinks.set(key,[]);
    baseLinks.get(key).push(mat);
  }
  for(const rel of unitConversions){
    for(const key of [rel.from_unit_id,rel.to_unit_id].map(String)){
      if(!globalLinks.has(key)) globalLinks.set(key,[]);
      globalLinks.get(key).push(rel);
    }
  }
  const counts=new Map();
  for(const unit of units){
    const key=normalizedUnitName(unitDisplay(unit));
    counts.set(key,(counts.get(key)||0)+1);
  }

  return units.map(unit=>{
    const id=String(unit.id);
    const materialLinks=(unitLinks.get(id)||[]).slice();
    const baseMaterials=(baseLinks.get(id)||[]).slice();
    const generalRelations=(globalLinks.get(id)||[]).slice();
    const isProtected=isProtectedUnit(unit);
    const isDuplicate=(counts.get(normalizedUnitName(unitDisplay(unit)))||0)>1;
    const dedicated=Boolean(unit.is_material_specific);
    const ambiguous=materialLinks.length>1 && (!isProtected || isContextualUnit(unit));
    const global=generalRelations.length>0;
    const related=materialLinks.map(link=>{
      const mat=materialMap.get(String(link.material_id));
      const base=unitMap.get(String(mat?.base_unit_id));
      return {
        material:mat,
        factor:Number(link.quantity_in_base),
        text:`${prettyRelation(unit,base,link.quantity_in_base,units,formatUnitAmount)||`1 ${unitDisplay(unit)} = ${formatUnitAmount(link.quantity_in_base)} ${unitDisplay(base)}`} (${mat?.name||'مادة غير معروفة'})`,
      };
    });
    const general=generalRelations.map(rel=>{
      const isFrom=String(rel.from_unit_id)===id;
      const other=unitMap.get(String(isFrom?rel.to_unit_id:rel.from_unit_id));
      const factor=isFrom ? Number(rel.factor) : 1/Number(rel.factor);
      return `1 ${unitDisplay(unit)} = ${formatUnitAmount(factor)} ${unitDisplay(other)}`;
    });
    let status='unassigned';
    if(isDuplicate) status='duplicate';
    else if(ambiguous) status='ambiguous';
    else if(dedicated && materialLinks.length===1) status='dedicated';
    else if(global) status='global';
    else if(materialLinks.length===1) status='material';
    else if(materialLinks.length>1) status='shared';
    else if(isProtected||baseMaterials.length) status='base';

    return {
      unit,
      materialLinks,
      baseMaterials,
      generalRelations,
      related,
      general,
      status,
      isDuplicate,
      ambiguous,
      canEdit:!isProtected && !ambiguous && !global && baseMaterials.length<=1,
      canDelete:!isProtected && !ambiguous && !global,
      isProtected,
    };
  });
}
