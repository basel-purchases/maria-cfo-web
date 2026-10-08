import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function publishableKey() {
  const modern = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (modern) {
    try {
      const keys = JSON.parse(modern);
      if (keys.default) return keys.default;
      const first = Object.values(keys)[0];
      if (typeof first === "string") return first;
    } catch (_) {}
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

async function callGemini(key: string, payload: unknown) {
  let lastStatus = 0;
  let lastMessage = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);
      const data = await response.json().catch(() => ({}));
      if (response.ok) return { ok: true, data };
      lastStatus = response.status;
      lastMessage = data?.error?.message ?? `HTTP ${response.status}`;
      console.error(`OCR Gemini attempt ${attempt} failed`, { status: lastStatus, message: lastMessage });
      if (!RETRYABLE.has(response.status) || attempt === 3) break;
    } catch (error) {
      clearTimeout(timer);
      lastMessage = error instanceof Error ? error.message : String(error);
      console.error(`OCR Gemini attempt ${attempt} network failure`, lastMessage);
      if (attempt === 3) break;
    }
    await wait(attempt === 1 ? 700 : 1600);
  }
  return { ok: false, status: lastStatus, message: lastMessage };
}

function cleanJsonText(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function normalizeDigits(value: unknown) {
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = normalizeDigits(value)
    .replace(/\u066c/g, "")
    .replace(/,/g, "")
    .replace(/\u066b/g, ".")
    .replace(/\s+/g, "")
    .replace(/[^0-9.+-]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(value: unknown) {
  let s = normalizeDigits(value).trim();
  if (!s) return null;
  s = s.replace(/[./\\]/g, "-").replace(/\s+/g, "");
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const pub = publishableKey();
    const gemini = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!url || !pub || !gemini) {
      return json({ ok: false, message: "خدمة تحليل الفواتير غير مهيأة على الخادم.", reason: "server_configuration" }, 200);
    }

    const db = createClient(url, pub, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await db.auth.getUser();
    if (user.error || !user.data.user) return json({ error: "Invalid session" }, 401);
    const owner = await db.rpc("is_app_owner");
    if (owner.error || owner.data !== true) return json({ error: "Access denied" }, 403);

    const body = await req.json().catch(() => ({}));
    const imageBase64 = String(body.image_base64 ?? "").trim();
    const mimeType = String(body.mime_type ?? "image/jpeg").trim();
    const supplierName = String(body.supplier_name ?? "").trim();
    const currency = String(body.currency ?? "SYP").trim();
    if (!imageBase64) return json({ error: "image_base64 is required" }, 400);
    if (!mimeType.startsWith("image/")) return json({ error: "Only images are supported" }, 400);

    const prompt = [
      "أنت محلل فواتير شراء لمطعم داخل Maria CFO.",
      "اقرأ صورة الفاتورة فقط ولا تخترع بنودًا غير ظاهرة.",
      "الفواتير قد تكون عربية ومكتوبة بخط اليد، وقد تستخدم الأرقام العربية الهندية ٠١٢٣٤٥٦٧٨٩ أو الفارسية ۰۱۲۳۴۵۶۷۸۹ أو الأرقام الغربية 0123456789.",
      "مهم جدًا في الخط العربي اليدوي: الرقم ٢ قد يبدو مثل الرقم 7 الإنكليزي معكوسًا أو كخطاف. إذا كان الشكل هو ٢ أو صورته اليدوية فاقرأه 2 وليس 7. ميّز أيضًا بين ٢ و٣ و٧ بالاعتماد على شكل الرقم وموضعه في العمود والسياق الحسابي.",
      "راجع كل رقم مرتين قبل الإخراج، خصوصًا الكمية والسعر والإجمالي. إذا وُجد إجمالي السطر فاستخدمه للتحقق من أن الكمية × سعر الوحدة منطقية، لكن لا تخترع رقمًا غير ظاهر.",
      `المورد المتوقع إن وجد: ${supplierName || "غير محدد"}.`,
      `العملة المتوقعة: ${currency}.`,
      "أعد JSON صالحًا فقط بدون Markdown.",
      "الشكل المطلوب:",
      JSON.stringify({
        supplier_name: "string|null",
        invoice_number: "string|null",
        invoice_date: "YYYY-MM-DD|null",
        currency: "SYP|USD|null",
        invoice_total: 0,
        items: [
          { name: "string", quantity: 1, unit: "string|null", unit_price: 0, line_total: 0, confidence: 0.0 },
        ],
      }),
      "quantity و unit_price و line_total و invoice_total أرقام وليست نصوصًا.",
      "إذا كان إجمالي السطر ظاهرًا وسعر الوحدة غير ظاهر، ضع line_total بالقيمة المقروءة وunit_price=0.",
      "إذا كان سعر الوحدة ظاهرًا وإجمالي السطر غير ظاهر، ضع unit_price بالقيمة المقروءة وline_total=0.",
      "لا تحسب line_total أو invoice_total إلا إذا كان الرقم نفسه ظاهرًا في الفاتورة؛ التطبيق سيحسب القيم الناقصة لاحقًا.",
      "confidence بين 0 و1.",
    ].join("\n");

    const result = await callGemini(gemini, {
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.02,
        maxOutputTokens: 2200,
        responseMimeType: "application/json",
      },
    });

    if (!result.ok) {
      return json({ ok: false, message: "تعذر تحليل الصورة بعد ثلاث محاولات. حاول بصورة أوضح بعد قليل.", reason: "temporary_ai_unavailable" }, 200);
    }

    const parts = result.data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p: any) => p?.text ?? "").join("").trim();
    if (!text) return json({ ok: false, message: "لم يصل رد صالح من خدمة التحليل.", reason: "empty_response" }, 200);

    let parsed: any;
    try { parsed = JSON.parse(cleanJsonText(text)); }
    catch (error) {
      console.error("OCR JSON parse failed", text);
      return json({ ok: false, message: "تمت قراءة الصورة لكن تعذر تنظيم البنود. جرّب صورة أوضح.", reason: "invalid_json" }, 200);
    }

    const items = Array.isArray(parsed?.items) ? parsed.items
      .map((x: any) => ({
        name: String(x?.name ?? "").trim(),
        quantity: numberValue(x?.quantity),
        unit: x?.unit == null ? null : String(x.unit).trim(),
        unit_price: numberValue(x?.unit_price),
        line_total: numberValue(x?.line_total),
        confidence: Math.max(0, Math.min(1, numberValue(x?.confidence))),
      }))
      .filter((x: any) => x.name && x.quantity > 0) : [];

    return json({
      ok: true,
      supplier_name: parsed?.supplier_name == null ? null : String(parsed.supplier_name).trim(),
      invoice_number: parsed?.invoice_number == null ? null : normalizeDigits(parsed.invoice_number).trim(),
      invoice_date: normalizeDate(parsed?.invoice_date),
      currency: parsed?.currency ?? currency,
      invoice_total: numberValue(parsed?.invoice_total),
      items,
      model: MODEL,
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, message: "تعذر تشغيل تحليل الفاتورة الآن. حاول مرة أخرى بعد قليل.", reason: "ocr_internal_error" }, 200);
  }
});
