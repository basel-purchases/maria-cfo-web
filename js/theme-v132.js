// Visual preference is local to this browser; no change to Supabase or financial data.
const KEY = 'maria-cfo-style-v132';
export const THEMES_V132 = Object.freeze([
  {id:'classic',number:1,name:'الكلاسيكي',subtitle:'الألوان الوردية الحالية'},
  {id:'elegant',number:2,name:'راقي وأنيق',subtitle:'كحلي داكن ولمسات ذهبية'},
  {id:'ocean',number:3,name:'أزرق هادئ',subtitle:'أزرق بحري ومساحات مشرقة'},
  {id:'forest',number:4,name:'أخضر طبيعي',subtitle:'أخضر عميق وألوان متزنة'},
  {id:'sand',number:5,name:'رملي دافئ',subtitle:'بيج وألوان ترابية مريحة'},
]);
export function readThemeV132(){
  try {const value = localStorage.getItem(KEY);return THEMES_V132.some(x=>x.id===value)?value:'classic';}
  catch {return 'classic';}
}
export function applyThemeV132(key, save=true){
  const name=THEMES_V132.some(x=>x.id===key)?key:'classic';
  document.documentElement.setAttribute('data-maria-theme',name);
  if (save) try {localStorage.setItem(KEY,name);} catch{}
  return name;
}
