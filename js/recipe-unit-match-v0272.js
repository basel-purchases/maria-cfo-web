// Maria CFO Web v0.27.2 - Strict, NON-CONVERTING base-unit alias resolution.
// These are the exact legacy aliases accepted by public.ameen_unit_v024.
// Do not add a physical unit conversion (KG<>G etc.) here: quantities in the
// approved Excel file are already expressed in the material's base unit.
export function normalizeRecipeUnitName(value){
  return String(value??'').trim()
    .replace(/[\u064b-\u065f\u0670\u0640]/g,'')
    .replace(/[\u0623\u0625\u0622]/g,'\u0627').replace(/\u0649/g,'\u064a')
    .toLocaleLowerCase('ar').replace(/\s+/g,' ');
}
const CODE_BY_ALIAS=new Map([
  [['غرام','غ','جرام','G'],'G'],
  [['كغ','كيلو','كيلوغرام','KG'],'KG'],
  [['لتر','L'],'L'],
  [['مل','مليلتر','ML'],'ML'],
  [['قطعه','قطعة','حبه','حبة','PCS'],'PCS'],
  [['صندوق','BOX'],'BOX'],
  [['كرتون','كرتونه','كرتونة','CARTON'],'CARTON'],
  [['كيس','BAG'],'BAG'],
  [['دزينه','دزينة','DOZ'],'DOZ'],
  [['كاسه','كاسة','كاس','GLASS'],'GLASS'],
  [['كوب','CUP'],'CUP'],
  [['صحن','TRAY'],'TRAY'],
  [['طرد','عبوة','PACK'],'PACK'],
].flatMap(([labels,code])=>labels.map(label=>[normalizeRecipeUnitName(label),code])));

export function catalogUnitEquivalent(unit,excelUnit){
  if(!unit)return false;
  const supplied=normalizeRecipeUnitName(excelUnit);
  if(!supplied)return false;
  // Literal catalog name takes precedence, including material-specific units.
  if(normalizeRecipeUnitName(unit.name)===supplied)return true;
  // A material-specific/custom unit is never assumed interchangeable with a
  // built-in unit solely on its code.
  if(unit.is_material_specific===true)return false;
  const code=CODE_BY_ALIAS.get(supplied);
  return Boolean(code&&String(unit.code??'').trim().toUpperCase()===code);
}

// No writing to Supabase; no quantities, stock levels or source names change.
export function alignRecipeLinesToCatalog(lines,materials,units){
  const normName=value=>String(value??'').trim().toLocaleLowerCase('ar').replace(/\s+/g,' ');
  const byName=new Map();
  for(const row of materials){const key=normName(row.name);byName.set(key,[...(byName.get(key)||[]),row]);}
  const unitsById=new Map(units.map(u=>[String(u.id),u]));
  const unexpected=new Set(),unitMismatch=new Set(),unitAliases=new Set();
  const canonicalLines=lines.map(line=>{
    const matches=byName.get(normName(line.materialName))||[];
    if(!matches.length){if(!line.newMaterial)unexpected.add(line.materialName);return {...line};}
    if(matches.length!==1){unitMismatch.add(`${line.materialName}: الاسم مكرر في جرد المواد؛ يلزم تحديد المادة الصحيحة.`);return {...line};}
    const unit=unitsById.get(String(matches[0].base_unit_id));
    if(!unit){unitMismatch.add(`${line.materialName}: وحدة المخزون غير معروفة.`);return {...line};}
    if(!catalogUnitEquivalent(unit,line.baseUnit)){
      unitMismatch.add(`${line.materialName}: وحدة الملف «${line.baseUnit}» لا تطابق وحدة المخزون «${unit.name}» (${unit.code||'—'}).`);
      return {...line};
    }
    if(normalizeRecipeUnitName(line.baseUnit)!==normalizeRecipeUnitName(unit.name)){
      unitAliases.add(`${line.baseUnit} → ${unit.name} (${unit.code||'—'})`);
    }
    // SQL v0.27 compares the catalog unit's name literally. Send that exact
    // catalog name ONLY after strict alias validation. This works with the
    // existing production RPC, even before installing the optional SQL patch.
    return {...line,baseUnit:String(unit.name)};
  });
  return {
    canonicalLines,
    unexpected:[...unexpected],
    unitMismatch:[...unitMismatch],
    unitAliases:[...unitAliases],
  };
}
