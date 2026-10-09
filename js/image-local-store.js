// Images and extracted results remain in this browser's IndexedDB, never in Supabase.
const DB_NAME='maria-cfo-local-images-v019';
const STORE='documents';
let databasePromise=null;

export function openLocalImages(){
  if(databasePromise)return databasePromise;
  databasePromise=new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('LOCAL_STORAGE_UNAVAILABLE'));return;}
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
    };
    request.onerror=()=>reject(request.error||new Error('LOCAL_STORAGE_UNAVAILABLE'));
    request.onblocked=()=>reject(new Error('LOCAL_STORAGE_BLOCKED'));
    request.onsuccess=()=>resolve(request.result);
  }).catch(error=>{databasePromise=null;throw error;});
  return databasePromise;
}

function transaction(mode,executor){
  return openLocalImages().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode);
    const store=tx.objectStore(STORE);
    let result;
    try{
      const r=executor(store);
      r.onsuccess=()=>{result=r.result;};
      r.onerror=()=>reject(r.error||new Error('LOCAL_STORAGE_FAILED'));
    }catch(error){tx.abort();reject(error);return;}
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error||new Error('LOCAL_STORAGE_FAILED'));
    tx.onabort=()=>reject(tx.error||new Error('LOCAL_STORAGE_FAILED'));
  }));
}
export const getLocalImage=id=>transaction('readonly',store=>store.get(id));
export const saveLocalImage=image=>transaction('readwrite',store=>store.put({...image,updated_at:new Date().toISOString()}));
export const deleteLocalImage=id=>transaction('readwrite',store=>store.delete(id));
export async function listLocalImages(){
  const rows=await transaction('readonly',store=>store.getAll());
  return rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
}

export function newLocalDocument(file){
  const now=new Date();
  return {
    id:crypto.randomUUID(),file,file_name:file.name||'صورة',mime_type:file.type,
    created_at:now.toISOString(),updated_at:now.toISOString(),
    type:'order',date:[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-'),
    currency:'SYP',number:'',supplier:'',cashbox_id:'',
    text:'',items:[],ocr_mode:'',ocr_confidence:null,status:'unprocessed',
    server_id:null,server_kind:null,error:null,
  };
}
