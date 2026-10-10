import {todayISO} from './utils.js?v=0.24';

export function datePeriod(mode='day',anchor=todayISO()){
  const text=/^\d{4}-\d{2}-\d{2}$/.test(String(anchor))?anchor:todayISO();
  const year=text.slice(0,4),month=text.slice(0,7);
  if(mode==='year')return {start:`${year}-01-01`,end:`${year}-12-31`};
  if(mode==='month'){
    const last=new Date(Number(year),Number(text.slice(5,7)),0).getDate();
    return {start:`${month}-01`,end:`${month}-${String(last).padStart(2,'0')}`};
  }
  return {start:text,end:text};
}

export function dateInRange(value,start,end){
  if(!value)return false;
  // DB date timestamps are ISO 8601. Keep local calendar date for display/filters.
  const raw=String(value);
  let date=raw.slice(0,10);
  if(raw.includes('T')){
    const d=new Date(raw);
    if(Number.isFinite(d.getTime())){
      date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
  }
  return date>=start&&date<=end;
}

export function selectPeriod(value,mode,anchor=todayISO()){
  return datePeriod(['day','month','year'].includes(mode)?mode:'day',anchor);
}

export function dateRangeValid(start,end){return /^\d{4}-\d{2}-\d{2}$/.test(start)&&/^\d{4}-\d{2}-\d{2}$/.test(end)&&start<=end;}
