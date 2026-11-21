import * as api from '../api.js?v=1.0.34';
import {esc} from '../utils.js?v=1.0';
import {renderBaselineImportsV126} from './baseline-imports-v126.js?v=1.0.35';
import {renderQuickImportsV030} from '../quick-imports-v030.js?v=1.0.34';

const stages=[
 {id:'history',name:'فواتير الشراء',desc:'الموردون والمواد وآخر أسعار الشراء، مع خصم الفاتورة من الصندوق العام مرة واحدة',counter:'purchaseInvoices'},
 {id:'menu',name:'المنيو والمكونات',desc:'199 وجبة و861 مكونًا؛ شيت المواد يضيف غير المشترى برصيد صفر، والأسعار من الشراء فقط',counter:'menuItems'},
 {id:'count',name:'الجرد الفعلي',desc:'اعتماد أسماء المواد المطابقة ووحداتها بعد انتهاء يوم العد؛ غير المحسوم يبقى للمراجعة',counter:'countedMaterials'},
 {id:'salesArchive',name:'فواتير المبيع',desc:'مبيعات تاريخية تُضاف إلى تسوية التكاليف والصندوق الأول، دون خصم مخزون مكرر',counter:'salesInvoices'},
 {id:'employees',name:'جدول الموظفين',desc:'استيراد الموظفين بصيغته الحالية دون تعديل الحسابات أو الراتب السابق',counter:'employees'}
];
export const INITIAL_SETUP_STAGES_V134=stages.map(({id,name})=>({id,name}));

export async function renderInitialSetupV134(root){
 const hashStage=decodeURIComponent((location.hash||'').split('/')[3]||'history');
 const stage=stages.find(x=>x.id===hashStage)||stages[0];
 root.innerHTML=`<div class="page-head"><div><h2>الإعدادات · الإدخال الأول</h2><p>التأسيس لمرة واحدة، بالترتيب. تبقى فواتير التشغيل والأوردرات والجرد اليومي في «التشغيل اليومي».</p></div>
 <a class="btn secondary" href="#/settings">العودة للإعدادات</a></div>
 <div class="notice">خذ نسخة احتياطية قابلة للاستعادة قبل أي تصفير أو استيراد تأسيسي. الأسعار والكميات التاريخية تحفظ بأصلها؛ الفواتير الشرائية هي المرجع الوحيد لتكلفة المواد. تُرحّل فاتورة الشراء أو المبيع مرة واحدة فقط؛ لا يُضاعف إعادة رفع الملف الحركة المالية.</div>
 <div class="v134-setup-steps" role="navigation" aria-label="مراحل تأسيس البيانات">
 ${stages.map((s,i)=>`<a class="v134-step ${stage.id===s.id?'current':''}" href="#/settings/first-setup/${s.id}"><span class="v134-step-number">${i+1}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.desc)}</small><small data-setup-count="${s.counter}"></small></span></a>`).join('')}</div>
 <div id="v134-setup-content"></div>
 ${stage.id==='salesArchive'?'<div class="card"><a class="btn secondary" href="#/sales-archive">عرض سجل المبيعات التاريخية</a> <a class="btn secondary" href="#/sale-cost-queue/archive">تسوية المبيعات التاريخية</a> <a class="btn secondary" href="#/historical-cash">ترحيل الفواتير السابقة للإصلاح</a></div>':''}
 ${stage.id==='menu'?'<div class="notice">ارفع ملف المنيو الموحد ذي الشيتين «المواد» و«المنيو والوصفات». تُضاف مواد الوصفات غير المشتراة برصيد صفر وتكلفة مجهولة؛ لا يُعاد ضبط رصيد أو سعر أي مادة سبق إنشاؤها من الفواتير.</div>':''}
 ${stage.id==='count'?'<div class="notice">ملف «جرد.xlsx» الأصلي فيه أسماء وعبوات غير متطابقة؛ استخدم «PHYSICAL-COUNT-READY-EXACT.xlsx» للأرصدة المدققة فقط، والباقي من ملف «PHYSICAL-COUNT-NEEDS-REVIEW.xlsx» بعد اعتماد الأسماء والتحويلات. لا تعتمد جرد اليوم قبل نهايته بتوقيت المطعم.</div>':''}
 ${stage.id==='employees'?'<div class="notice">هذا هو مستورد جدول الموظفين الحالي نفسه، ولم نغيّر صيغته أو طريقة احتساب رواتبه.</div>':''}`;
 const host=root.querySelector('#v134-setup-content');
 if(stage.id==='employees')await renderQuickImportsV030(host,{fixedKind:'employees'});
 else await renderBaselineImportsV126(host,{fixedKind:stage.id});
 // A number indicates records present, not that all source files were imported.
 try{
  const stats=await api.rpc('v134_initial_setup_progress');
  if(!root.isConnected)return;
  for(const s of stages){const el=root.querySelector(`[data-setup-count="${s.counter}"]`);
   if(el)el.textContent=`سجلات موجودة في النظام: ${Number(stats?.[s.counter]||0).toLocaleString('ar-SY')}`;}
 }catch(_){for(const el of root.querySelectorAll('[data-setup-count]'))el.textContent='تحتاج ترحيل SQL v1.0.34';}
}
