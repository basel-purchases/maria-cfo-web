// Maria CFO Web v0.33 - pure helpers for fast, predictable Arabic staff search
// and auditable attendance display. Never interpret an attendance shortfall as
// an automatic salary deduction for a monthly employee.
export function normalizeStaffQueryV033(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u064b-\u065f\u0670\u0640]/g,'')
    .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
    .replace(/[ؤ]/g,'و').replace(/[ئ]/g,'ي')
    .replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x660))
    .replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-0x6f0))
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .toLocaleLowerCase('ar').trim().replace(/\s+/g,' ');
}
export function staffSearchScoreV033(text, query) {
  const candidate=normalizeStaffQueryV033(text);
  const needle=normalizeStaffQueryV033(query);
  if(!needle)return 1;
  if(!candidate)return -1;
  const tokens=needle.split(' ');
  const words=candidate.split(' ');
  let score=0;
  for(const token of tokens){
    if(!token)continue;
    if(words.includes(token))score+=80;
    else if(words.some(w=>w.startsWith(token)))score+=60;
    else if(candidate.includes(token))score+=22;
    else return -1; // Every search word must match, even across fields.
  }
  if(candidate===needle)score+=160;
  else if(candidate.startsWith(needle))score+=70;
  else if(candidate.includes(needle))score+=25;
  return score;
}
export function employeeDirectoryScoreV033(employee,query){
  const name=String(employee?.name||'');
  const elsewhere=[employee?.job_title,employee?.department,employee?.residence_v031,
    employee?.mobile_phone_v031,employee?.wage_currency_code].filter(Boolean).join(' ');
  const all=`${name} ${elsewhere}`;
  const match=staffSearchScoreV033(all,query);
  if(match<0)return -1;
  const nameMatch=staffSearchScoreV033(name,query);
  return match+(nameMatch>0?nameMatch+200:0);
}
const numeric=(v,fallback=0)=>{const num=v==null||v===''?fallback:Number(v);return Number.isFinite(num)?num:fallback;};
const rounded=v=>Math.round(Math.max(0,v)*100)/100;
const isExcused=status=>['paid_leave','holiday','day_off'].includes(status);
export function attendanceSummaryV033(row){
  const expected=rounded(numeric(row?.expected_hours));
  const worked=rounded(numeric(row?.worked_hours));
  const status=String(row?.status||'full');
  const excused=isExcused(status);
  const actualDiff=excused?0:Math.round((worked-expected)*100)/100;
  const shortageComputed=excused?0:rounded(numeric(row?.calculated_shortage_hours,
    ['absent','unpaid_leave'].includes(status)?expected:Math.max(0,expected-worked)));
  const overtimeCalculated=excused?0:rounded(numeric(row?.calculated_overtime_hours,Math.max(0,worked-expected)));
  // SQL payroll uses COALESCE(approved, calculated, 0) and
  // COALESCE(applied, calculated, 0). Mirror that, never assume a null means 0.
  const overtimeEffective=excused?0:rounded(numeric(row?.approved_overtime_hours,overtimeCalculated));
  const shortageEffective=excused?0:rounded(numeric(row?.applied_shortage_hours,shortageComputed));
  const flaggedShortage=shortageComputed>0||shortageEffective>0;
  const flaggedExtra=overtimeCalculated>0||overtimeEffective>0;
  const otherIssue=['absent','unpaid_leave','partial'].includes(status);
  const needsAttention=flaggedShortage||flaggedExtra||otherIssue;
  return {expected,worked,actualDiff,status,excused,shortageComputed,shortageEffective,
    overtimeCalculated,overtimeEffective,flaggedShortage,flaggedExtra,needsAttention,
    shortageWaived:shortageComputed>0&&shortageEffective===0,
    overtimeUnapproved:overtimeCalculated>0&&overtimeEffective===0};
}
export function filterAttendanceV033(rows,filter='all'){
  const allowed=new Set(['all','issues','shortage','overtime']);
  const choice=allowed.has(filter)?filter:'all';
  return rows.filter(row=>{
    const model=row.summary||attendanceSummaryV033(row);
    if(choice==='issues')return model.needsAttention;
    if(choice==='shortage')return model.flaggedShortage;
    if(choice==='overtime')return model.flaggedExtra;
    return true;
  });
}
