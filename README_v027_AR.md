# Maria CFO v0.27 - دليل التركيب

## مهم

التحديث مبني على v0.25 مباشرة، ولا يحتاج v0.26.

## خطوات التركيب

1. خذ نسخة احتياطية من Supabase وGitHub.

2. نفّذ ملف SQL v0.27 على قاعدة تجريبية أولًا.

3. انسخ ملفات ZIP واحتفظ بملف config.js وإعدادات Git.

4. افتح «استيراد الوصفات» وارفع ملف Maria-CFO-75-Recipes-v0.27-Ready.xlsx.

5. اختر «فحص ومعاينة» ثم وافق على الاستبدال واضغط «تأكيد» للحفظ.

## تنبيهات محاسبية

الجرد لا يحتوي على كل أسعار شراء المواد، وبعض أوزان العبوات تقديرية.

الوصفات المستوردة لا تعدّل الأوردرات المنشورة سابقًا.

## تصدير Excel وPDF

افتح أي جدول، طبّق الفلتر ثم اضغط Excel أو PDF. للـ PDF اختر «Save as PDF» من نافذة الطباعة.

### Release facts

- **Starting version:** Maria CFO Web v0.25. Do not install the rejected v0.26.
- **Database migration:** `Maria-CFO-v0.27-Recipe-Import-Migration.sql` supplied separately, included in `database/` for documentation.
- **Recipe data:** `templates/Maria-CFO-75-Recipes-v0.27-Ready.xlsx` also provided separately.
- **75 menu items, 729 per-serving material components, 32 controlled new materials.** New materials start with zero available stock and an UNKNOWN latest purchase cost. They are not invented existing stock.
- The workbook's `IMPORT_RECIPES_V027` and `IMPORT_LINES_V027` sheets must not be renamed or have required columns removed.
- Menu items MUST exist in Supabase with precisely matching names. The preview detects missing/duplicate names and incompatible material base units; the server rolls back all changes on any failure.
- Import uses a **single owner-only SQL transaction**, recording a SHA-256 and a first-run recipe backup. Re-importing an identical file does nothing. Changed files can replace earlier recipes only after explicit confirmation.
- Published historical orders and cashbox balances are untouched. Future posted orders use the imported flattened, material-only recipes under existing v0.25 posting rules.
- **32 newly introduced materials have NO prices and zero stock; cost calculations will not be reliable until actual purchase prices and stock are entered.**
- **175 unit/pack conversions are estimates** and 9 original large platters required explicit portion assumptions. Review the relevant workbook tabs for precise kitchen costing.
- The PDF button uses the browser print dialog (select **Save as PDF**); this is deliberate to preserve Arabic typesetting, no internet service required.
- Table exports include current search/status/category filters. For server-paged orders, menu, and supplier ledger, the export fetches the full filtered result across all pages.
- No credentials, Git metadata, or `config.js` is packaged. Keep your existing private `config.js` in place.

### Test limitations

145 automated Node tests pass; Chromium parsed the actual recipe XLSX and an XLSX download containing all filtered rows was opened with openpyxl. **Supabase SQL has not been executed against your live schema, and a deployment with real financial data is not verified. Test on a clone before using on production.**
