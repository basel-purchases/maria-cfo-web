# Maria CFO Web v0.1

نسخة ويب أولى مصممة لإعادة ترتيب تجربة Maria CFO قبل الرجوع لتطبيق الهاتف.

## الفكرة
بدل قائمة طويلة من الشاشات، الموقع مقسّم إلى أقسام عامة واضحة:
- الرئيسية
- الإدخالات الأساسية
- التشغيل اليومي
- الموظفون والرواتب
- الحفلات
- الإحصائيات والتقارير
- المساعد الذكي
- الإعدادات

كل قسم يشرح أولًا لماذا يوجد ومتى يستخدم، ثم يعرض الوظائف الموجودة داخله.

## التشغيل
هذا المشروع Static Site ولا يحتاج Node أو Build.

1. افتح `config.js`.
2. ضع `supabaseUrl` و `supabasePublishableKey`.
3. لا تضع أبدًا Service Role أو `GEMINI_API_KEY` في الموقع.
4. افتح الموقع عبر HTTP server أو GitHub Pages.

مثال محلي:

```bash
python3 -m http.server 8080
```

ثم:

```text
http://localhost:8080
```

## النشر على GitHub Pages
أنشئ Repository باسم مثل:

```text
maria-cfo-web
```

ارفع محتويات هذا المجلد إلى جذر الفرع `main`.

ثم:

```text
Repository > Settings > Pages
Source: Deploy from a branch
Branch: main
Folder: /(root)
Save
```

العنوان يصبح عادة:

```text
https://YOUR-USERNAME.github.io/maria-cfo-web/
```

## Supabase
الموقع يستخدم نفس Supabase الخاص بالتطبيق ونفس RLS/RPCs.

## إصلاح المساعد الذكي
الملف:

```text
supabase/functions/assistant/index.ts
```

نسخة محسنة:
- 3 محاولات عند 408/429/5xx ومنها 502.
- Timeout لكل محاولة.
- Backoff بين المحاولات.
- لا تعرض 502 أو رسالة تقنية للمستخدم.
- الخطأ التقني يبقى في Logs.
- الرد النهائي للمستخدم رسالة عربية مفهومة.

انشر هذه النسخة مكان Function `assistant` الحالية في Supabase Dashboard أو CLI.
