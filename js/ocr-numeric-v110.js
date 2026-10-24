// OCR numeric cells: a small handwritten Arabic-Indic zero (٠) is often
// transcribed as a trailing punctuation dot/comma by OCR engines.
// This repair is deliberately restricted to *numeric table cells*, never
// free text, invoice numbers, Western digits or actual decimal separators.
import {invoiceAmountV107} from './invoice-amount-v107.js?v=1.0.10';

const ARABIC_DIGIT=/[٠-٩۰-۹]/;
const ARABIC_DIGIT_RUN=/^[٠-٩۰-۹]+$/;
export function readHandwrittenAmountV110(value,{numericCell=true}={}){
 const raw=String(value??'').trim();
 if(!raw)return {value:null,raw,corrected:false,review:false,note:''};
 let processed=raw,corrected=false,note='';
 if(numericCell){
  // A trailing comma/period after a run of Arabic-Indic digits can be an
  // OCR rendering of the dot-shaped Arabic zero. Do not mistake "٠,٨"
  // (0.8) for "٠٠٨" or change Western punctuation.
  const trailing=raw.match(/^([٠-٩۰-۹]+)([.,،۔·•])$/u);
  if(trailing&&ARABIC_DIGIT_RUN.test(trailing[1])){
   processed=trailing[1]+'٠';corrected=true;
   note='النقطة الأخيرة قُرئت كصفر عربي محتمل (٠)؛ تأكد من الرقم في الصورة.';
  }else if(/^[.·•۔]$/u.test(raw)){
   // A solitary dot may be handwritten zero OR punctuation; always flag.
   processed='٠';corrected=true;
   note='نقطة منفردة: اقتراح صفر عربي (٠) يحتاج تأكيدًا بصريًا.';
  }
 }
 const amount=invoiceAmountV107(processed);
 return {value:amount,raw,normalized:processed,corrected,review:corrected,
  note:corrected?note:'', ambiguous:amount===null&&ARABIC_DIGIT.test(raw)};
}

// Identify punctuation that would be unsafe to interpret as zero outside a
// strictly numeric OCR table cell.
export function isOcrDotZeroCandidateV110(s){return readHandwrittenAmountV110(s).corrected;}
