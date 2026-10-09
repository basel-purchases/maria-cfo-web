// Maria CFO v0.20 — local browser OCR. No image leaves the user's browser.
// Tesseract is optimized for print, not handwritten Arabic: never auto-post OCR.
const SOURCES=[
  'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js',
  'https://unpkg.com/tesseract.js@6.0.1/dist/tesseract.min.js',
];
let libraryPromise=null;
let workerPromise=null;
let activeWorker=null;
let workerListener=null;

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
      }catch(_){/* Try backup CDN. */}
    }
    throw new Error('تعذر تنزيل مكتبة القراءة. اتصل بالإنترنت مرة واحدة لتحميل محرك OCR.');
  })().catch(error=>{libraryPromise=null;throw error;});
  return libraryPromise;
}
async function getWorker(onProgress){
  workerListener=onProgress;
  if(activeWorker)return activeWorker;
  if(!workerPromise){
    workerPromise=loadOcrLibrary().then(Tesseract=>Tesseract.createWorker(['ara','eng'],1,{
      logger:m=>{if(workerListener&&m?.status)workerListener(m.status,Math.round(Number(m.progress||0)*100));},
    })).then(w=>(activeWorker=w,w)).catch(error=>{workerPromise=null;throw error;});
  }
  return workerPromise;
}

export function normalizedCrop(crop){
  if(!crop)return null;
  const {x,y,w,h}=crop;
  const vals=[x,y,w,h].map(Number);
  if(vals.some(v=>!Number.isFinite(v)))return null;
  if(x<0||y<0||w<0.035||h<0.035||x+w>1.001||y+h>1.001)return null;
  return {x:Math.max(0,x),y:Math.max(0,y),w:Math.min(w,1-x),h:Math.min(h,1-y)};
}

async function decodeImage(blob){
  const url=URL.createObjectURL(blob);
  try{
    const img=new Image();img.decoding='async';img.src=url;await img.decode();
    return img;
  }finally{URL.revokeObjectURL(url);}
}
async function cropImage(blob,crop){
  const area=normalizedCrop(crop);
  if(!area)return blob;
  const img=await decodeImage(blob);
  const x=Math.floor(area.x*img.naturalWidth),y=Math.floor(area.y*img.naturalHeight);
  const w=Math.max(1,Math.round(area.w*img.naturalWidth));
  const h=Math.max(1,Math.round(area.h*img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  canvas.getContext('2d').drawImage(img,x,y,w,h,0,0,w,h);
  return new Promise((resolve,reject)=>canvas.toBlob(out=>out?resolve(out):reject(new Error('تعذر قص منطقة القراءة.')),'image/png'));
}

async function processedImage(blob,{binary=false}={}){
  const img=await decodeImage(blob);
  const scale=Math.min(4.5,Math.max(1.4,2100/Math.max(img.naturalWidth,img.naturalHeight)));
  const width=Math.min(3600,Math.round(img.naturalWidth*scale));
  const height=Math.min(3600,Math.round(img.naturalHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(img,0,0,width,height);
  const frame=ctx.getImageData(0,0,width,height),pixels=frame.data;
  const hist=new Uint32Array(256);
  for(let i=0;i<pixels.length;i+=4){
    const gray=Math.round(pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114);
    pixels[i]=pixels[i+1]=pixels[i+2]=gray;
    hist[gray]++;
  }
  const total=width*height;
  let low=0,high=255,seen=0;
  for(let v=0;v<256;v++){seen+=hist[v];if(seen>=total*.015){low=v;break;}}
  seen=0;for(let v=255;v>=0;v--){seen+=hist[v];if(seen>=total*.015){high=v;break;}}
  const range=Math.max(55,high-low);
  for(let i=0;i<pixels.length;i+=4){
    let val=Math.max(0,Math.min(255,(pixels[i]-low)*255/range));
    // High-contrast processing is one candidate only; handwriting may work better in grayscale.
    if(binary)val=val<145?25:255;
    pixels[i]=pixels[i+1]=pixels[i+2]=val;
  }
  ctx.putImageData(frame,0,0);
  return canvas;
}

export function recognitionScore(data){
  const text=String(data?.text||'').trim();
  if(!text)return 0;
  const ar=(text.match(/[\u0621-\u064A]/g)||[]).length;
  const latin=(text.match(/[A-Za-z]/g)||[]).length;
  const digits=(text.match(/[0-9٠-٩]/g)||[]).length;
  const plausible=(text.split(/\r?\n/).filter(l=>/[\u0621-\u064A]{2,}|[A-Za-z]{3,}/.test(l)).length);
  const confidence=Math.min(100,Math.max(0,Number(data?.confidence)||0));
  // Prefer credible Arabic words and OCR confidence; do not reward lengthy gibberish.
  return confidence*.74+Math.min(22,ar*.15)+Math.min(8,plausible)*1.5
    +Math.min(8,digits)*.3 - (ar>0&&latin>ar*3?8:0) - (text.length>900?7:0);
}

export function recognitionQuality(data){
  const text=String(data?.text||'').trim();
  const ar=(text.match(/[\u0621-\u064A]/g)||[]).length;
  const latin=(text.match(/[A-Za-z]/g)||[]).length;
  const confidence=Math.min(100,Math.max(0,Number(data?.confidence)||0));
  const uncertain=!text||confidence<53||(ar>0&&latin>ar*2.5);
  return {uncertain,confidence,reason:!text?'لم يتم التعرف إلى نص':
    confidence<53?'التعرف الآلي غير واثق من الكلمات، ولا سيما الخط اليدوي':
    latin>ar*2.5&&ar>0?'نسبة الأحرف غير العربية مرتفعة في مستند عربي':''};
}

export async function recognizeLocalImage(blob,{mode='normal',crop=null,onProgress}={}){
  const area=normalizedCrop(crop);
  const push=(label,percent)=>onProgress?.(label,Math.max(0,Math.min(100,Math.round(percent))));
  push('تحميل محرك القراءة',0);
  let phaseBase=0,phaseWeight=16;
  const worker=await getWorker((label,pct)=>push(label,phaseBase+phaseWeight*pct/100));
  push('تجهيز الصورة',16);
  const source=area?await cropImage(blob,area):blob;
  phaseBase=16;phaseWeight=mode==='accurate'?27:84;
  const normal=(await worker.recognize(source)).data;
  let best=normal;
  if(mode==='accurate'){
    phaseBase=43;phaseWeight=27;push('تحسين التباين والخط',43);
    const enhanced=await processedImage(source,{binary:false});
    const soft=(await worker.recognize(enhanced,{tessedit_pageseg_mode:6})).data;
    if(recognitionScore(soft)>recognitionScore(best))best=soft;
    phaseBase=70;phaseWeight=30;push('قراءة إضافية وتقليل الضجيج',70);
    const strong=await processedImage(source,{binary:true});
    const bold=(await worker.recognize(strong,{tessedit_pageseg_mode:11})).data;
    if(recognitionScore(bold)>recognitionScore(best))best=bold;
  }
  push('اكتمل الاستخراج',100);
  const quality=recognitionQuality(best);
  return {text:best.text||'',confidence:best.confidence||0,mode,quality,
    crop:area, sourceWidth:best?.imageSize?.width||null};
}
export async function releaseLocalOcr(){
  if(activeWorker){await activeWorker.terminate();activeWorker=null;workerPromise=null;workerListener=null;}
}
