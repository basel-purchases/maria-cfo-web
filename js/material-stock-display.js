// Maria CFO v0.20 — presentation only: never change inventory ledgers or snapshots.
import { unitDisplay } from './utils.js?v=0.22';

const METRIC_SMALL={KG:'G',L:'ML'};
const METRIC_LARGE={G:'KG',ML:'L'};
const PACKAGING=new Set(['CARTON','BOX','PACK','BAG','SACK','TRAY','CRATE','SACHET','PCS','PACKET']);

export function stockNumber(value,maxDigits=6){
  const n=Number(value);
  if(!Number.isFinite(n))return '—';
  return new Intl.NumberFormat('ar-SY',{maximumFractionDigits:maxDigits,useGrouping:false}).format(n);
}

function nearIntegerRatio(ratio){
  const n=Math.round(ratio);
  return ratio>1 && n>1 && Math.abs(ratio-n)<=Math.max(0.003,n*0.00002);
}

function availableCandidates(material,units,links){
  const base=units.find(u=>String(u.id)===String(material?.base_unit_id));
  if(!base)return [];
  const candidates=[{unit:base,factor:1,isBase:true}];
  for(const link of links||[]){
    if(String(link.material_id)!==String(material.id))continue;
    const unit=units.find(u=>String(u.id)===String(link.unit_id));
    const factor=Number(link.quantity_in_base);
    if(!unit||!Number.isFinite(factor)||factor<=0||String(unit.id)===String(base.id))continue;
    if(!candidates.some(c=>String(c.unit.id)===String(unit.id)))candidates.push({unit,factor,isBase:false});
  }
  const related=METRIC_SMALL[String(base.code||'').toUpperCase()];
  if(related && !candidates.some(c=>String(c.unit.code||'').toUpperCase()===related)){
    const u=units.find(u=>String(u.code||'').toUpperCase()===related);
    if(u)candidates.push({unit:u,factor:0.001,isBase:false,isStandard:true});
  }
  return candidates;
}

// Prefer a packaging relationship with an integral count (carton/sachet),
// or the metric fractional unit (kilogram/gram). Do not guess pack sizes.
export function chooseStockPair(material,units,links=[]){
  const candidates=availableCandidates(material,units,links);
  const base=candidates.find(c=>c.isBase);
  if(!base)return null;
  const pairs=[];
  for(const large of candidates){
    for(const small of candidates){
      const ratio=large.factor/small.factor;
      if(large===small||!nearIntegerRatio(ratio))continue;
      const baseCode=String(base.unit.code||'').toUpperCase();
      const metric=METRIC_SMALL[baseCode]===String(small.unit.code||'').toUpperCase()
        ||METRIC_LARGE[baseCode]===String(large.unit.code||'').toUpperCase();
      const largeCode=String(large.unit.code||'').toUpperCase();
      const score=(metric?100:0)+(PACKAGING.has(largeCode)?40:0)
        +(large.isBase?30:0)+(small.isBase?20:0)
        +(small.isStandard?10:0)-Math.log10(ratio);
      pairs.push({large,small,ratio,score});
    }
  }
  pairs.sort((a,b)=>b.score-a.score);
  return pairs[0]||null;
}

export function splitStockQuantity(amount,largeFactor,smallFactor){
  const total=Number(amount),large=Number(largeFactor),small=Number(smallFactor);
  if(!Number.isFinite(total)||!(large>small&&small>0))return null;
  const abs=Math.abs(total),epsilon=Math.max(1e-9,abs*1e-10);
  let whole=Math.floor((abs+epsilon)/large);
  let minor=(abs-whole*large)/small;
  if(minor<0&&minor>-1e-5)minor=0;
  const nearest=Math.round(minor);
  if(Math.abs(minor-nearest)<=Math.max(0.002,Math.abs(minor)*0.00005))minor=nearest;
  const ratio=large/small;
  if(minor>=ratio-0.002){whole+=1;minor=0;}
  return {negative:total<0,whole,minor};
}

export function formatSmartStock(material,units=[],links=[],value=0){
  const n=Number(value);
  const base=units.find(u=>String(u.id)===String(material?.base_unit_id));
  const baseText=base?unitDisplay(base):'';
  const original=`${stockNumber(n)} ${baseText}`.trim();
  if(!Number.isFinite(n)||!base)return {text:original,original,converted:false,relationship:''};
  const pair=chooseStockPair(material,units,links);
  if(!pair || Math.abs(n)<1e-9)return {text:original,original,converted:false,relationship:''};
  const split=splitStockQuantity(n,pair.large.factor,pair.small.factor);
  if(!split)return {text:original,original,converted:false,relationship:''};
  const parts=[];
  if(split.whole>0)parts.push(`${stockNumber(split.whole,0)} ${unitDisplay(pair.large.unit)}`);
  if(split.minor>1e-6)parts.push(`${stockNumber(split.minor,4)} ${unitDisplay(pair.small.unit)}`);
  if(!parts.length)return {text:original,original,converted:false,relationship:''};
  const text=(split.negative?'− ':'')+parts.join(' و');
  // Avoid a decomposition that cannot be reconciled back to the source balance.
  const reconstructed=(split.whole*pair.large.factor+split.minor*pair.small.factor)*(split.negative?-1:1);
  if(Math.abs(reconstructed-n)>Math.max(1e-6,Math.abs(n)*0.00005))return {text:original,original,converted:false,relationship:''};
  return {
    text,original,converted:text!==original,
    relationship:`1 ${unitDisplay(pair.large.unit)} ≈ ${stockNumber(pair.ratio,2)} ${unitDisplay(pair.small.unit)}`,
  };
}
