export const q = (s, root=document) => root.querySelector(s);
export const qa = (s, root=document) => [...root.querySelectorAll(s)];
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function esc(value='') { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
export function num(value, fallback=0){ const n=Number(value); return Number.isFinite(n)?n:fallback; }
export function money(value, currency='SYP') { return new Intl.NumberFormat('ar-SY',{maximumFractionDigits:currency==='SYP'?0:2}).format(num(value))+' '+currency; }
export function dateOnly(value){ if(!value)return '—'; const d=new Date(value); return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('ar-SY',{year:'numeric',month:'2-digit',day:'2-digit'}).format(d); }
export function todayISO(){ const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); }
export function pick(obj, keys, fallback=null){ for(const key of keys){ const parts=key.split('.'); let v=obj; for(const p of parts){ if(v==null){v=undefined;break;} v=v[p]; } if(v!==undefined&&v!==null&&v!=='')return v; } return fallback; }
export const unitLabel = value => ({PCS:'قطعة',PC:'قطعة',UNIT:'وحدة',KG:'كيلوغرام',G:'غرام',L:'لتر',ML:'مل',PACK:'عبوة',TRAY:'سفط',BOX:'صندوق',CARTON:'كرتون',BAG:'كيس',BTL:'زجاجة',BOTTLE:'زجاجة',CAN:'علبة',DOZ:'دزينة',DOZEN:'دزينة'})[String(value??'').toUpperCase()] || value || '—';
export function statusBadge(status='') { const map={draft:['مسودة','yellow'],posted:['منشورة','green'],open:['مفتوح','green'],closed:['مغلق',''],approved:['معتمد','green'],voided:['ملغي','red'],active:['نشط','green']}; const x=map[status]||[status||'—','']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; }
