# تفعيل تحليل صورة الفاتورة

في Supabase:
1. Edge Functions -> Create new function.
2. الاسم: `document-ocr`
3. استبدل محتوى `index.ts` بمحتوى:
   `supabase/functions/document-ocr/index.ts`
4. Deploy function.
5. تأكد أن Secret `GEMINI_API_KEY` محفوظ مسبقًا.

لا تضع GEMINI_API_KEY في GitHub أو config.js.
