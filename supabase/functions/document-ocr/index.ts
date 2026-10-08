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
      `المورد المتوقع إن وجد: ${supplierName || "غير محدد"}.`,
      `العملة المتوقعة: ${currency}.`,
      "أعد JSON صالحًا فقط بدون Markdown.",
      "الشكل المطلوب:",
      JSON.stringify({
        supplier_name: "string|null",
        invoice_number: "string|null",
        invoice_date: "YYYY-MM-DD|null",
        currency: "SYP|USD|null",
        items: [
          { name: "string", quantity: 1, unit: "string|null", unit_price: 0, line_total: 0, confidence: 0.0 },
        ],
      }),
      "quantity و unit_price أرقام وليسا نصًا.",
      "إذا كان السعر الظاهر إجمالي السطر فقط ولا يمكن استنتاج سعر الوحدة بثقة، ضع unit_price=0 واترك line_total بالقيمة المقروءة.",
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
        temperature: 0.05,
        maxOutputTokens: 1800,
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
        quantity: Number(x?.quantity ?? 0),
        unit: x?.unit == null ? null : String(x.unit).trim(),
        unit_price: Number(x?.unit_price ?? 0),
        line_total: Number(x?.line_total ?? 0),
        confidence: Number(x?.confidence ?? 0),
      }))
      .filter((x: any) => x.name && x.quantity > 0) : [];

    return json({
      ok: true,
      supplier_name: parsed?.supplier_name ?? null,
      invoice_number: parsed?.invoice_number ?? null,
      invoice_date: parsed?.invoice_date ?? null,
      currency: parsed?.currency ?? currency,
      items,
      model: MODEL,
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, message: "تعذر تشغيل تحليل الفاتورة الآن. حاول مرة أخرى بعد قليل.", reason: "ocr_internal_error" }, 200);
  }
});
