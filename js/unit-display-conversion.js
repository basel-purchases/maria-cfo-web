// v0.19: Presentation-only metric conversions. Inventory base units and historic
// quantity_in_base always remain unchanged in PostgreSQL.
import { unitDisplay } from './utils.js?v=0.19';

const METRIC = Object.freeze({
  KG:{code:'G',factor:1000}, G:{code:'KG',factor:0.001},
  L:{code:'ML',factor:1000}, ML:{code:'L',factor:0.001},
});

export function conversionChoices(baseUnit, allUnits=[]){
  if(!baseUnit) return [];
  const current={unit:baseUnit,factor:1,label:unitDisplay(baseUnit)};
  const entry=METRIC[String(baseUnit.code||'').toUpperCase()];
  if(!entry)return [current];
  const alternative=allUnits.find(u=>String(u.code||'').toUpperCase()===entry.code);
  return alternative && alternative.id!==baseUnit.id
    ? [current,{unit:alternative,factor:entry.factor,label:unitDisplay(alternative)}]
    : [current];
}

export function preferredChoice(baseUnit, allUnits=[], quantityInBase=1){
  const choices=conversionChoices(baseUnit,allUnits);
  const code=String(baseUnit?.code||'').toUpperCase();
  const q=Number(quantityInBase);
  if(choices.length>1 && q>0){
    if((code==='KG'||code==='L') && q<1) return choices[1];
    if((code==='G'||code==='ML') && q>=1000) return choices[1];
  }
  return choices[0]||null;
}

export function fromBase(quantityInBase,choice){
  const n=Number(quantityInBase),factor=Number(choice?.factor||0);
  if(!Number.isFinite(n)||!(factor>0)) return NaN;
  return Number((n*factor).toPrecision(13));
}

export function toBase(displayQuantity,choice){
  const n=Number(displayQuantity),factor=Number(choice?.factor||0);
  if(!Number.isFinite(n)||!(factor>0)) return NaN;
  return Number((n/factor).toPrecision(13));
}

export function prettyRelation(unit,baseUnit,amountInBase,allUnits=[],formatAmount=n=>String(n)){
  const choice=preferredChoice(baseUnit,allUnits,amountInBase);
  if(!choice) return null;
  return `1 ${unitDisplay(unit)} = ${formatAmount(fromBase(amountInBase,choice))} ${choice.label}`;
}
