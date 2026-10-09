// Tesseract.js 6 runs OCR in the browser; images are not uploaded to any API.
// Arabic/English language data and WASM are downloaded on first use and cached.
const SOURCES=[
  'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js',
  'https://unpkg.com/tesseract.js@6.0.1/dist/tesseract.min.js',
];
let libraryPromise=null;
let workerPromise=null;
let activeWorker=null;
export async function loadOcrLibrary(){
  if(globalThis.Tesseract?.createWorker)return globalThis.Tesseract;
  if(libraryPromise)return libraryPromise;
  libraryPromise=(async()=>{
    for(const src of SOURCES){
      try{
        await new Promise((resolve,reject)=>{
          const el=document.createElement('script');el.async=true;el.src=src;
          el.onload=resolve;el.onerror=()=>reject(new Error('OCR_CDN_UNAVAILABLE'));
          document.head.appendChild(el);
        });
        if(globalThis.Tesseract?.createWorker)return globalThis.Tesseract;
      }catch(_){ /* Try backup CDN. */ }
    }
    throw new Error('OCR_CDN_UNAVAILABLE');
  })().catch(error=>{libraryPromise=null;throw error;});
  return libraryPromise;
}
async function getWorker(onProgress){
  if(activeWorker)return activeWorker;
  if(!workerPromise){
    workerPromise=loadOcrLibrary().then(Tesseract=>Tesseract.createWorker(['ara','eng'],1,{
      logger:m=>{if(typeof onProgress==='function'&&m?.status)onProgress(m.status,Math.round(Number(m.progress||0)*100));},
    })).then(w=>(activeWorker=w,w)).catch(error=>{workerPromise=null;throw error;});
  }
  return workerPromise;
}

async function processedImage(blob){
  const url=URL.createObjectURL(blob);
  try{
    const img=new Image();img.decoding='async';img.src=url;await img.decode();
    const scale=Math.min(3,Math.max(1.5,1900/Math.max(img.width,img.height)));
    const width=Math.min(3200,Math.floor(img.width*scale));
    const height=Math.min(3200,Math.floor(img.height*scale));
    const cvs=document.createElement('canvas');cvs.width=width;cvs.height=height;
    const ctx=cvs.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,width,height);
    const pixels=ctx.getImageData(0,0,width,height);
    // Grayscale + autocontrast: useful with faded receipts, not a handwriting model.
    let low=255,high=0;
    for(let i=0;i<pixels.data.length;i+=4){
      const v=Math.round(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114);
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;
      low=Math.min(low,v);high=Math.max(high,v);
    }
    const range=Math.max(40,high-low);
    for(let i=0;i<pixels.data.length;i+=4){
      const v=Math.min(255,Math.max(0,Math.round((pixels.data[i]-low)*255/range)));
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;
    }
    ctx.putImageData(pixels,0,0);
    return cvs;
  }finally{URL.revokeObjectURL(url);}
}
export function recognitionScore(data){
  const text=String(data?.text||'').trim();
  const ar=(text.match(/[\u0621-\u064a]/g)||[]).length;
  const digits=(text.match(/[0-9٠-٩]/g)||[]).length;
  const usable=text.length;
  return Math.max(0,Number(data?.confidence||0))*1.5 + Math.min(40,ar)*.45 + Math.min(12,digits)*.3 + Math.min(80,usable)*.12;
}
export async function recognizeLocalImage(blob,{mode='normal',onProgress}={}){
  const worker=await getWorker(onProgress);
  onProgress?.('قراءة الصورة بالعربية والإنجليزية',0);
  const normal=(await worker.recognize(blob)).data;
  if(mode!=='accurate')return {text:normal.text||'',confidence:normal.confidence||0,mode:'normal'};
  onProgress?.('تحسين الصورة وإعادة القراءة بدقة أعلى',0);
  const highRes=await processedImage(blob);
  const enhanced=(await worker.recognize(highRes,{
    tessedit_pageseg_mode:6,
  })).data;
  const best=recognitionScore(enhanced)>recognitionScore(normal)?enhanced:normal;
  return {text:best.text||'',confidence:best.confidence||0,mode:'accurate'};
}
export async function releaseLocalOcr(){
  if(activeWorker){await activeWorker.terminate();activeWorker=null;workerPromise=null;}
}
