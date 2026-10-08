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

function friendlyReason(status?: number, message?: string) {
  if (status === 429) return "مزود الذكاء الاصطناعي مشغول حاليًا أو تم بلوغ حد الاستخدام المؤقت.";
  if (status && status >= 500) return "مزود الذكاء الاصطناعي لم يستجب بشكل سليم بعد عدة محاولات.";
  if ((message ?? "").toLowerCase().includes("timeout")) return "انتهت مهلة انتظار مزود الذكاء الاصطناعي.";
  return "تعذر الوصول إلى مزود الذكاء الاصطناعي بعد عدة محاولات.";
}

async function callGemini(key: string, payload: unknown) {
  let lastStatus = 0;
  let lastMessage = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const pub = publishableKey();
    const gemini = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!url || !pub || !gemini) {
      console.error("Assistant configuration incomplete");
      return json({ ok: false, answer: "المساعد غير مهيأ على الخادم حاليًا. راجع إعدادات الخدمة.", reason: "server_configuration" }, 200);
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
    const message = String(body.message ?? "").trim();
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    if (!message) return json({ error: "message is required" }, 400);

    const system = [
      "أنت المساعد الذكي داخل Maria CFO.",
      "تحدث بالعربية الواضحة والبسيطة والمريحة.",
      "راحة المستخدم أهم من كثرة الحقول.",
      "اسم المورد اختياري وليس شرطًا لتسجيل فاتورة شراء.",
      "المشتريات تزيد المخزون وليست مصروف تشغيل مباشر.",
      "الحسابات المالية الأساسية حتمية من قاعدة البيانات ولا تخترع أرقامًا.",
      "لا تدّع تنفيذ دفع أو حذف أو ترحيل إذا لم تُنفذ أداة آمنة لذلك.",
      "إذا لم تتوفر بيانات فعلية لسؤال مالي، قل ذلك بوضوح.",
    ].join("\n");

    const contents = history
      .map((x: any) => ({ role: x?.role === "assistant" ? "model" : "user", parts: [{ text: String(x?.content ?? "") }] }))
      .filter((x: any) => x.parts[0].text.trim());
    const last = contents.at(-1);
    if (last?.role !== "user" || last?.parts?.[0]?.text?.trim() !== message) {
      contents.push({ role: "user", parts: [{ text: message }] });
    }

    const result = await callGemini(gemini, {
      system_instruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.25, maxOutputTokens: 900 },
    });

    if (!result.ok) {
      const reason = friendlyReason(result.status, result.message);
      return json({
        ok: false,
        answer: `المساعد غير متاح مؤقتًا الآن. ${reason} حاول مرة أخرى بعد قليل.`,
        reason: "temporary_ai_unavailable",
      }, 200);
    }

    const parts = result.data?.candidates?.[0]?.content?.parts ?? [];
    const answer = parts.map((p: any) => p?.text ?? "").join("").trim();
    if (!answer) {
      return json({ ok: false, answer: "وصل الرد من مزود الذكاء الاصطناعي لكنه لم يحتوِ نصًا صالحًا. حاول مرة أخرى.", reason: "empty_ai_response" }, 200);
    }
    return json({ ok: true, answer, model: MODEL });
  } catch (error) {
    console.error(error);
    return json({ ok: false, answer: "تعذر تشغيل المساعد الآن بسبب مشكلة اتصال داخلية. حاول مرة أخرى بعد قليل.", reason: "assistant_internal_error" }, 200);
  }
});
