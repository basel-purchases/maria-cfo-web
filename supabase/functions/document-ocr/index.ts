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
      console.error(`Gemini attempt ${attempt} failed`, { status: lastStatus, message: lastMessage });
      if (!RETRYABLE.has(response.status) || attempt === 3) break;
    } catch (error) {
      clearTimeout(timer);
      lastMessage = error instanceof Error ? error.message : String(error);
      console.error(`Gemini attempt ${attempt} network failure`, lastMessage);
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

function normalizeName(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[()\[\]{}.,،:;؛/_\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function commonPromptLines() {
  return [
    "اقرأ الصورة فقط ولا تخترع بيانات غير ظاهرة.",
    "قد تكون الكتابة عربية ومكتوبة بخط اليد، وقد تستخدم الأرقام العربية الهندية ٠١٢٣٤٥٦٧٨٩ أو الفارسية ۰۱۲۳۴۵۶۷۸۹ أو الغربية 0123456789.",
    "مهم جدًا: الرقم العربي اليدوي ٢ قد يبدو مثل 7 إنكليزية معكوسة. إذا كان الشكل ٢ فاقرأه 2 وليس 7. راجع ٢ و٣ و٧ مرتين.",
    "استخدم العلاقات الحسابية فقط للتحقق من القراءة، ولا تخترع رقمًا غير ظاهر.",
    "أعد JSON صالحًا فقط بدون Markdown.",
  ];
}

function purchasePrompt(supplierName: string, currency: string) {
  return [
    "أنت محلل فواتير شراء لمطعم داخل Maria CFO.",
    ...commonPromptLines(),
    `المورد المتوقع إن وجد: ${supplierName || "غير محدد"}.`,
    `العملة المتوقعة: ${currency}.`,
    "استخرج اسم المورد، رقم الفاتورة، التاريخ، العملة، إجمالي الفاتورة، وكل بند.",
    "لكل بند نحتاج: الاسم، الكمية، الوحدة، سعر الوحدة، وإجمالي السطر إن كان ظاهرًا.",
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
    "confidence بين 0 و1.",
  ].join("\n");
}

function orderPrompt(currency: string) {
  return [
    "أنت محلل صور أوردرات مطعم داخل Maria CFO.",
    ...commonPromptLines(),
    `العملة المتوقعة: ${currency}.`,
    "استخرج رقم الأوردر إن ظهر، التاريخ إن ظهر، العملة، الإجمالي، وكل صنف مباع.",
    "لكل صنف نحتاج: الاسم كما هو، الكمية، سعر الوحدة، إجمالي السطر إن ظهر، ونسبة الخصم إن ظهرت.",
    "الشكل المطلوب:",
    JSON.stringify({
      external_order_number: "string|null",
      order_date: "YYYY-MM-DD|null",
      currency: "SYP|USD|null",
      order_total: 0,
      items: [
        { name: "string", quantity: 1, unit_price: 0, line_total: 0, discount_percent: 0, confidence: 0.0 },
      ],
    }),
    "إذا ظهر إجمالي السطر ولم يظهر سعر الوحدة، اترك unit_price=0 واكتب line_total.",
    "إذا ظهر سعر الوحدة ولم يظهر إجمالي السطر، اكتب unit_price واترك line_total=0.",
    "confidence بين 0 و1.",
  ].join("\n");
}

function parsePurchase(parsed: any, fallbackCurrency: string) {
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

  return {
    supplier_name: parsed?.supplier_name == null ? null : String(parsed.supplier_name).trim(),
    invoice_number: parsed?.invoice_number == null ? null : normalizeDigits(parsed.invoice_number).trim(),
    invoice_date: normalizeDate(parsed?.invoice_date),
    currency: parsed?.currency ?? fallbackCurrency,
    invoice_total: numberValue(parsed?.invoice_total),
    items,
    model: MODEL,
  };
}

function parseOrder(parsed: any, fallbackCurrency: string) {
  const items = Array.isArray(parsed?.items) ? parsed.items
    .map((x: any) => ({
      name: String(x?.name ?? "").trim(),
      quantity: Math.max(0, numberValue(x?.quantity)),
      unit_price: Math.max(0, numberValue(x?.unit_price)),
      line_total: Math.max(0, numberValue(x?.line_total)),
      discount_percent: Math.max(0, Math.min(100, numberValue(x?.discount_percent))),
      confidence: Math.max(0, Math.min(1, numberValue(x?.confidence))),
    }))
    .filter((x: any) => x.name && x.quantity > 0) : [];

  return {
    external_order_number: parsed?.external_order_number == null ? null : normalizeDigits(parsed.external_order_number).trim(),
    order_date: normalizeDate(parsed?.order_date),
    currency: parsed?.currency ?? fallbackCurrency,
    order_total: numberValue(parsed?.order_total),
    items,
    model: MODEL,
  };
}

function menuPrice(item: any) {
  return numberValue(
    item?.manual_price_original ??
    item?.manual_price ??
    item?.price ??
    item?.suggested_price_rounded ??
    item?.suggested_price ??
    0,
  );
}

function bestMenuMatch(name: string, menu: any[]) {
  const target = normalizeName(name);
  if (!target) return null;
  const exact = menu.find((m) => normalizeName(m.name) === target);
  if (exact) return exact;
  if (target.length < 3) return null;
  const fuzzy = menu.filter((m) => {
    const n = normalizeName(m.name);
    return n.length >= 3 && (n.includes(target) || target.includes(n));
  });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

async function autoCreateOrderDraft(userDb: any, parsed: any, context: any) {
  const menuRes = await userDb.from("menu_items").select("*").limit(1000);
  if (menuRes.error) throw menuRes.error;
  const menu = (menuRes.data ?? []).filter((x: any) => x.is_active !== false);

  const mapped = parsed.items.map((raw: any) => {
    const match = bestMenuMatch(raw.name, menu);
    let price = raw.unit_price;
    if (!(price > 0) && raw.line_total > 0 && raw.quantity > 0) price = raw.line_total / raw.quantity;
    if (!(price > 0) && match) price = menuPrice(match);
    return {
      ...raw,
      matched_menu_item_id: match?.id ?? null,
      matched_menu_item_name: match?.name ?? null,
      resolved_unit_price: price,
    };
  });

  const unresolved = mapped.filter((x: any) => !x.matched_menu_item_id || !(x.resolved_unit_price >= 0));
  const enriched = { ...parsed, items: mapped, auto_created: false, order_id: null };
  if (unresolved.length) {
    return { status: "needs_review", result: enriched, message: `تحتاج ${unresolved.length} بنود إلى مراجعة قبل إنشاء الأوردر.` };
  }

  const orderDate = parsed.order_date || new Date().toISOString().slice(0, 10);
  const currency = ["SYP", "USD"].includes(String(parsed.currency || "").toUpperCase())
    ? String(parsed.currency).toUpperCase()
    : String(context?.currency || "SYP");

  const createArgs = {
    p_external_order_number: parsed.external_order_number || null,
    p_cashbox_id: context?.cashbox_id || null,
    p_occurred_at: new Date(`${orderDate}T12:00:00Z`).toISOString(),
    p_currency_code: currency,
    p_entry_method: "manual",
  };
  const created = await userDb.rpc("create_order", createArgs);
  if (created.error) throw created.error;
  const orderId = typeof created.data === "string" ? created.data : created.data?.id ?? created.data;
  if (!orderId) throw new Error("ORDER_CREATE_EMPTY_RESULT");

  let saved = 0;
  for (const item of mapped) {
    const add = await userDb.rpc("add_order_item", {
      p_order_id: orderId,
      p_menu_item_id: item.matched_menu_item_id,
      p_raw_item_name: item.name,
      p_quantity: Number(item.quantity),
      p_unit_price_original: Number(item.resolved_unit_price || 0),
      p_adjustment_type: item.discount_percent > 0 ? "percent" : "none",
      p_adjustment_value: Number(item.discount_percent || 0),
      p_adjustment_reason_id: null,
    });
    if (add.error) {
      return {
        status: "needs_review",
        result: { ...enriched, partial_order_id: orderId, saved_items: saved },
        message: `تم إنشاء مسودة الأوردر لكن تم حفظ ${saved} من ${mapped.length} بنود فقط. تحتاج المراجعة.`,
      };
    }
    saved++;
  }

  const verify = await userDb.from("order_items").select("id", { count: "exact", head: false }).eq("order_id", orderId);
  const verifiedCount = verify.error ? saved : (verify.data?.length ?? saved);
  if (verifiedCount < mapped.length) {
    return {
      status: "needs_review",
      result: { ...enriched, partial_order_id: orderId, saved_items: verifiedCount },
      message: "تم إنشاء مسودة الأوردر لكن لم يتم تأكيد حفظ كل البنود. تحتاج المراجعة.",
    };
  }

  return {
    status: "completed",
    result: { ...enriched, auto_created: true, order_id: orderId, saved_items: saved },
    message: `تم إنشاء مسودة أوردر تلقائيًا وحفظ ${saved} بنود.`,
    orderId,
  };
}

async function processJob({
  serviceDb,
  userDb,
  jobId,
  jobType,
  imageBase64,
  mimeType,
  context,
  gemini,
}: any) {
  try {
    await serviceDb.from("ai_jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", jobId);

    const prompt = jobType === "order_ocr"
      ? orderPrompt(String(context?.currency || "SYP"))
      : purchasePrompt(String(context?.supplier_name || ""), String(context?.currency || "SYP"));

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
        maxOutputTokens: jobType === "order_ocr" ? 2600 : 2400,
        responseMimeType: "application/json",
      },
    });

    if (!result.ok) {
      await serviceDb.from("ai_jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        public_message: "تعذر تحليل الصورة بعد ثلاث محاولات. يمكنك إعادة رفعها لاحقًا.",
        error_code: result.status ? `GEMINI_${result.status}` : "GEMINI_UNAVAILABLE",
      }).eq("id", jobId);
      return;
    }

    const parts = result.data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p: any) => p?.text ?? "").join("").trim();
    if (!text) throw new Error("AI_EMPTY_RESPONSE");

    let raw: any;
    try { raw = JSON.parse(cleanJsonText(text)); }
    catch (_) { throw new Error("AI_INVALID_JSON"); }

    if (jobType === "order_ocr") {
      const parsed = parseOrder(raw, String(context?.currency || "SYP"));
      if (!parsed.items.length) throw new Error("ORDER_NO_ITEMS");
      const auto = await autoCreateOrderDraft(userDb, parsed, context);
      await serviceDb.from("ai_jobs").update({
        status: auto.status,
        related_entity_type: auto.orderId ? "order" : null,
        related_entity_id: auto.orderId ?? null,
        result_json: auto.result,
        public_message: auto.message,
        completed_at: new Date().toISOString(),
        error_code: null,
      }).eq("id", jobId);
      return;
    }

    const parsed = parsePurchase(raw, String(context?.currency || "SYP"));
    if (!parsed.items.length) throw new Error("PURCHASE_NO_ITEMS");
    await serviceDb.from("ai_jobs").update({
      status: "completed",
      result_json: parsed,
      public_message: `اكتمل تحليل الفاتورة وتم استخراج ${parsed.items.length} بنود.`,
      completed_at: new Date().toISOString(),
      error_code: null,
    }).eq("id", jobId);
  } catch (error) {
    console.error("Background OCR job failed", jobId, error);
    const code = error instanceof Error ? error.message : String(error);
    const publicMessage = code === "PURCHASE_NO_ITEMS"
      ? "اكتمل التحليل لكن لم تظهر بنود واضحة. جرّب صورة أوضح."
      : code === "ORDER_NO_ITEMS"
      ? "اكتمل التحليل لكن لم تظهر أصناف واضحة في صورة الأوردر."
      : "تعذر إكمال التحليل الآن. لم يتم تسجيل بيانات غير مؤكدة.";
    await serviceDb.from("ai_jobs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      public_message: publicMessage,
      error_code: code.slice(0, 120),
    }).eq("id", jobId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const pub = publishableKey();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const gemini = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!url || !pub || !serviceKey || !gemini) {
      return json({ ok: false, message: "خدمة التحليل غير مهيأة على الخادم.", reason: "server_configuration" }, 200);
    }

    const userDb = createClient(url, pub, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await userDb.auth.getUser();
    if (user.error || !user.data.user) return json({ error: "Invalid session" }, 401);
    const owner = await userDb.rpc("is_app_owner");
    if (owner.error || owner.data !== true) return json({ error: "Access denied" }, 403);

    const serviceDb = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const imageBase64 = String(body.image_base64 ?? "").trim();
    const mimeType = String(body.mime_type ?? "image/jpeg").trim();
    const jobType = String(body.job_type ?? "purchase_ocr").trim();
    const relatedId = body.related_entity_id ? String(body.related_entity_id) : null;
    const fileName = String(body.file_name ?? "").trim();
    const context = body.context && typeof body.context === "object" ? body.context : {};

    if (!imageBase64) return json({ error: "image_base64 is required" }, 400);
    if (!mimeType.startsWith("image/")) return json({ error: "Only images are supported" }, 400);
    if (!["purchase_ocr", "order_ocr"].includes(jobType)) return json({ error: "Unsupported job_type" }, 400);

    const relatedType = jobType === "purchase_ocr" ? "purchase_invoice" : null;
    const title = jobType === "purchase_ocr"
      ? `تحليل فاتورة شراء${fileName ? ` - ${fileName}` : ""}`
      : `تحليل صورة أوردر${fileName ? ` - ${fileName}` : ""}`;

    const inserted = await serviceDb.from("ai_jobs").insert({
      user_id: user.data.user.id,
      job_type: jobType,
      status: "queued",
      title,
      related_entity_type: relatedType,
      related_entity_id: relatedType ? relatedId : null,
      input_meta: {
        file_name: fileName || null,
        mime_type: mimeType,
        currency: context?.currency || "SYP",
        supplier_name: context?.supplier_name || null,
      },
      public_message: "تم استلام الصورة وهي الآن في قائمة التحليل.",
    }).select("id").single();

    if (inserted.error || !inserted.data?.id) {
      console.error(inserted.error);
      return json({ ok: false, message: "تعذر إنشاء مهمة التحليل. شغّل تحديث قاعدة البيانات v0.12 أولًا.", reason: "ai_jobs_unavailable" }, 200);
    }

    const jobId = inserted.data.id;
    EdgeRuntime.waitUntil(processJob({
      serviceDb,
      userDb,
      jobId,
      jobType,
      imageBase64,
      mimeType,
      context,
      gemini,
    }));

    return json({
      ok: true,
      queued: true,
      job_id: jobId,
      message: "تم إرسال الصورة للتحليل. يمكنك متابعة العمل وسنظهر النتيجة عند اكتمالها.",
    }, 202);
  } catch (error) {
    console.error(error);
    return json({ ok: false, message: "تعذر بدء مهمة التحليل الآن. حاول مرة أخرى.", reason: "enqueue_error" }, 200);
  }
});
