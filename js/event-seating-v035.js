// Pure event seating logic. Neighbourhood is inferred ONLY from the full ordered table list;
// venue staff must confirm actual physical adjacency in their seating plan.
export function proposeEventAllocationV035(allTables,firstId,count){
 const size=Number(count);
 if(!Number.isInteger(size)||size<1||size>1000)return {ok:false,reason:'أدخل عدد أشخاص صحيحًا.'};
 const all=[...allTables].filter(t=>t.status!=='cancelled').sort((a,b)=>
  Number(a.display_order||0)-Number(b.display_order||0)||String(a.table_label).localeCompare(String(b.table_label),'ar',{numeric:true}));
 const start=all.findIndex(t=>String(t.id)===String(firstId));
 if(start<0||all[start].booking_id)return {ok:false,reason:'اختر طاولة متاحة وغير محجوزة.'};
 const selected=[all[start]];
 // Walk first right, then left without passing any booked/blocked table.
 for(const direction of [1,-1]){
  for(let i=start+direction;i>=0&&i<all.length;i+=direction){
   if(all[i].booking_id||all[i].status==='completed')break;
   selected.push(all[i]);
  }
 }
 let remaining=size;
 const rows=[];
 for(const t of selected){if(remaining<=0)break;const seats=Number(t.capacity)||0;
  const take=Math.min(remaining,seats);
  if(take>0){rows.push({table_id:t.id,guests:take});remaining-=take;}
 }
 if(remaining>0)return {ok:false,reason:`الطاولات المتجاورة المتاحة لا تكفي: يوجد ${size-remaining} مقعدًا من ${size}. غيّر الطاولة أو أضف طاولات.`};
 return {ok:true,rows};
}
export function bookingDisplayNamesV035(primary,count,provided=[]){
 const name=String(primary||'').trim();
 if(!name||!Number.isInteger(count)||count<1||count>1000)throw new Error('Invalid booking');
 return Array.from({length:count},(_,i)=>String(provided[i]||'').trim()||(i===0?name:`مع ${name} ${i}`));
}
