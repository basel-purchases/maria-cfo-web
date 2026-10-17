// The Excel calendar date remains authoritative unless the owner explicitly
// overrides a one-day file. Preserve the source timestamp for audit purposes.
const validISODate=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return false;
  const ms=Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;
};
export function applyDailyBusinessDateV104(records=[],override=''){
  const originalDays=[...new Set(records.map(x=>x.date))].sort();
  const selected=String(override||'').trim();
  if(!selected)return {records,originalDays,overridden:false};
  if(!validISODate(selected))throw new Error('تاريخ استيراد الأوردرات غير صالح.');
  if(originalDays.some(x=>!validISODate(x)))throw new Error('يوجد تاريخ غير صالح داخل تقرير Excel.');
  if(originalDays.length>1)throw new Error('ملف الأوردرات يحتوي أكثر من يوم. لا يمكن تغيير كل التواريخ إلى يوم واحد؛ قسّم الملف حسب الأيام أو اترك تاريخ الملف.');
  if(originalDays.length===1&&originalDays[0]===selected)
    return {records,originalDays,overridden:false};
  return {records:records.map(r=>({ ...r, originalBusinessDate:r.date, date:selected })),originalDays,overridden:true};
}
