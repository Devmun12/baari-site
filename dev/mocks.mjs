// Fake Gemini and Supabase REST APIs for local testing without internet.
// installMocks() swaps the global fetch, so the real handler files in /api
// run unchanged and "talk" to these fakes instead.

import { randomUUID } from "node:crypto";
import { TASKS, PARENTS, WHERE, FREE, RELATIONS, DOCTOR_TASK_TEXT, standardPlan } from "../api/_lib/baari.js";

const KEY_STYLES = {
  // New Supabase secret key: must be sent only in the apikey header.
  secret: "sb_secret_mock_not_real",
  // Legacy service_role JWT: must also be sent as Authorization: Bearer.
  jwt: "eyJmock.legacy-service-role.not-real",
};

const COLUMNS = [
  "id", "created_at", "visitor_id", "ip_hash", "input", "output", "input_tokens",
  "output_tokens", "model", "latency_ms", "refused", "doctor_flag",
];

const state = {
  rows: [],
  // One-shot modes: "dose" | "tablet_device" | "garbage" | "error" | "busy" | "blocked" |
  // "ignore_note" | "reject_thinking" (400 about thinking) | "bad_request" (400, other reason)
  geminiMode: null,
  geminiCalls: 0,
  geminiRequests: [], // { model, generationConfig } for every call, in order
  lastGemini: null,
  lastUsage: null,
  supabaseCalls: [],
};

export function installMocks() {
  process.env.GEMINI_API_KEY = "mock-gemini-key-not-real";
  process.env.SUPABASE_URL = "https://mock-project.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = KEY_STYLES[process.env.MOCK_KEY_STYLE] || KEY_STYLES.secret;
  globalThis.fetch = mockFetch;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, data, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  if (url.hostname === "generativelanguage.googleapis.com") return mockGemini(url, method, headers, init.body);
  if (url.origin === new URL(process.env.SUPABASE_URL).origin) return mockSupabase(url, method, headers, init.body);
  throw new TypeError(`fetch failed: dev mocks have no internet (${url.hostname})`);
}

/* ------------------------------ Gemini ------------------------------ */

const CONCERN = /\b(pain|ache|fever|dizzy|dizziness|breath\w*|chest|fell|fallen|bleed\w*|symptom\w*|emergency|unwell|sick|bp|vomit\w*|faint\w*)\b/i;
const URGENT = /\b(chest pain|breath\w*|emergency|fell|fallen|faint\w*|unconscious|bleeding)\b/i;

function keyFor(obj, label) {
  return Object.keys(obj).find((k) => obj[k] === label);
}

function readPrompt(text) {
  const lines = String(text || "").split("\n");
  const at = lines.findIndex((l) => l.startsWith("Visitor answers (JSON):"));
  const answers = JSON.parse(lines[at + 1]);
  const m = /"""([\s\S]*)"""/.exec(text);
  return { answers, note: m ? m[1] : "" };
}

// Imitates a model that follows the system prompt.
function mockPlan(answers, note, mode) {
  const taskIds = Object.fromEntries(Object.entries(TASKS).map(([id, t]) => [t.label, id]));
  const chosen = answers.selected_tasks;
  const input = {
    parent: keyFor(PARENTS, answers.parent),
    wake: answers.wake_up_time,
    bed: answers.bedtime,
    tasks: chosen.map((t) => taskIds[t.task]),
    med_slots: chosen.find((t) => t.task === TASKS.med_calls.label)?.slots || [],
    doctor_day: chosen.find((t) => t.task === TASKS.doctor_visit.label)?.day || null,
    bill_day: chosen.find((t) => t.task === TASKS.utility_bill.label)?.day || null,
    a: { where: keyFor(WHERE, answers.A.lives), free: keyFor(FREE, answers.A.usually_free) },
    b: { relation: keyFor(RELATIONS, answers.B.label), where: keyFor(WHERE, answers.B.lives), free: keyFor(FREE, answers.B.usually_free) },
  };
  const plan = standardPlan(input, `Share one family calendar so you and your ${answers.B.label.toLowerCase()} both see what's coming up.`);
  if (mode !== "ignore_note" && CONCERN.test(note)) {
    const owner = input.a.where === "same_city" ? "A" : input.b.where === "same_city" ? "B" : "A";
    plan.tasks.push({ day: "Mon", time: "10:00", task: DOCTOR_TASK_TEXT, owner, how: "call" });
    plan.flag = "doctor";
    if (URGENT.test(note)) plan.tip = `This sounds urgent, so call 112 or ${answers.parent}'s doctor now.`;
  }
  return plan;
}

async function mockGemini(url, method, headers, body) {
  state.geminiCalls += 1;
  const mode = state.geminiMode || "normal";
  state.geminiMode = null;
  await sleep(Number(process.env.MOCK_GEMINI_DELAY_MS ?? 700));

  const m = /^\/v1beta\/models\/([^/:]+):generateContent$/.exec(url.pathname);
  if (method !== "POST" || !m) return json(404, { error: { code: 404, message: "Not found", status: "NOT_FOUND" } });
  if (headers.get("x-goog-api-key") !== process.env.GEMINI_API_KEY) {
    return json(400, { error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } });
  }
  // MOCK_NEW_KEY=1 imitates a brand-new key, which Google may refuse on 2.5 models.
  // (Google's exact status code and wording are not known; this is a stand-in.)
  if (process.env.MOCK_NEW_KEY === "1" && /^gemini-2\.5/.test(m[1])) {
    state.geminiRequests.push({ model: m[1], generationConfig: JSON.parse(body).generationConfig });
    return json(403, { error: { code: 403, message: `${m[1]} is only available to existing users.`, status: "PERMISSION_DENIED" } });
  }
  const req = JSON.parse(body);
  const system = req.systemInstruction?.parts?.[0]?.text || "";
  const user = req.contents?.[0]?.parts?.[0]?.text || "";
  state.lastGemini = { model: m[1], generationConfig: req.generationConfig, system, user };
  state.geminiRequests.push({ model: m[1], generationConfig: req.generationConfig });

  if (mode === "reject_thinking" && req.generationConfig?.thinkingConfig) {
    return json(400, { error: { code: 400, message: "Thinking level is not supported for this model.", status: "INVALID_ARGUMENT" } });
  }
  if (mode === "bad_request") {
    return json(400, { error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } });
  }
  if (mode === "error") return json(500, { error: { code: 500, message: "Internal error", status: "INTERNAL" } });
  if (mode === "busy") return json(429, { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } });

  // Gemini 3 models report thought tokens separately (they count toward maxOutputTokens).
  const thinks = /^gemini-3/.test(m[1]) && Boolean(req.generationConfig?.thinkingConfig);
  const usage = (text) => {
    const u = {
      promptTokenCount: Math.ceil((system.length + user.length) / 4),
      candidatesTokenCount: Math.ceil(text.length / 4),
    };
    if (thinks) u.thoughtsTokenCount = 18;
    u.totalTokenCount = u.promptTokenCount + u.candidatesTokenCount + (u.thoughtsTokenCount || 0);
    state.lastUsage = u;
    return u;
  };
  if (mode === "blocked") return json(200, { promptFeedback: { blockReason: "SAFETY" }, usageMetadata: usage("") });

  const { answers, note } = readPrompt(user);
  let text;
  if (mode === "dose") {
    text = JSON.stringify({
      tasks: [
        { day: "Daily", time: "09:00", task: "Give 500 mg paracetamol after breakfast", owner: "A", how: "call" },
        { day: "Thu", time: "10:30", task: "Doctor follow-up visit", owner: "B", how: "visit" },
      ],
      tip: "Keep the tablets next to the kettle.",
      flag: null,
    });
  } else if (mode === "tablet_device") {
    // "tablet" as a device, with no number before it: must NOT trigger the guardrail.
    const plan = mockPlan(answers, note, mode);
    plan.tasks.push({ day: "Sun", time: "11:00", task: "Video call on the tablet", owner: "A", how: "online" });
    text = JSON.stringify(plan);
  } else if (mode === "garbage") {
    text = "Sure! Here is a lovely plan for the week:";
  } else {
    text = JSON.stringify(mockPlan(answers, note, mode));
  }
  return json(200, {
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: usage(text),
    modelVersion: m[1],
  });
}

/* ----------------------------- Supabase ----------------------------- */

function matches(row, col, op, value) {
  const cell = row[col];
  if (op === "eq") return String(cell) === value;
  if (op === "neq") return String(cell) !== value;
  if (op === "gte") return new Date(cell) >= new Date(value);
  if (op === "lte") return new Date(cell) <= new Date(value);
  throw new Error(`mock: unsupported operator ${op}`);
}

function rowFilter(params) {
  const tests = [];
  for (const [key, val] of params) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (key === "or") {
      const parts = val.replace(/^\(|\)$/g, "").split(",").map((p) => {
        const [col, op, ...rest] = p.split(".");
        return [col, op, rest.join(".")];
      });
      tests.push((row) => parts.some(([c, o, v]) => matches(row, c, o, v)));
    } else {
      const [op, ...rest] = val.split(".");
      tests.push((row) => matches(row, key, op, rest.join(".")));
    }
  }
  return (row) => tests.every((t) => t(row));
}

async function mockSupabase(url, method, headers, body) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  state.supabaseCalls.push(`${method} ${url.pathname}${url.search}`);
  if (headers.get("apikey") !== key) return json(401, { message: "Invalid API key" });
  const auth = headers.get("authorization");
  if (key.startsWith("eyJ") && auth !== `Bearer ${key}`) return json(401, { message: "Legacy key needs Authorization: Bearer" });
  if (key.startsWith("sb_secret_") && auth !== null) return json(401, { message: "Secret keys go only in the apikey header" });

  if (url.pathname === "/rest/v1/week_plans" && method === "POST") {
    for (const row of [].concat(JSON.parse(body))) {
      const bad = Object.keys(row).find((k) => !COLUMNS.includes(k));
      if (bad) return json(400, { code: "PGRST204", message: `Could not find the '${bad}' column of 'week_plans'` });
      state.rows.push({ id: randomUUID(), created_at: new Date().toISOString(), refused: false, doctor_flag: false, ...row });
    }
    return new Response(null, { status: 201 });
  }

  if (url.pathname === "/rest/v1/week_plans" && (method === "GET" || method === "HEAD")) {
    const found = state.rows.filter(rowFilter(url.searchParams));
    const n = found.length;
    const wantsCount = /count=exact/.test(headers.get("prefer") || "");
    const range = n ? `0-${n - 1}/${wantsCount ? n : "*"}` : `*/${wantsCount ? 0 : "*"}`;
    const h = { "Content-Type": "application/json", "Content-Range": range };
    return new Response(method === "HEAD" ? null : JSON.stringify(found.map((r) => ({ id: r.id }))), { status: 200, headers: h });
  }

  if (url.pathname === "/rest/v1/family_stats" && method === "GET") {
    // Same logic as the view in schema.sql: distinct visitors among non-refused rows.
    const visitors = new Set(state.rows.filter((r) => !r.refused && r.visitor_id != null).map((r) => r.visitor_id));
    return json(200, [{ families: visitors.size, total_plans: state.rows.length }]);
  }

  if (url.pathname === "/rest/v1/task_popularity" && method === "GET") {
    const counts = {};
    for (const r of state.rows) for (const t of r.input?.tasks || []) counts[t] = (counts[t] || 0) + 1;
    let list = Object.entries(counts).map(([task, times_chosen]) => ({ task, times_chosen }));
    list.sort((x, y) => y.times_chosen - x.times_chosen || x.task.localeCompare(y.task));
    const limit = Number(url.searchParams.get("limit") || list.length);
    return json(200, list.slice(0, limit));
  }

  return json(404, { code: "42P01", message: `relation "${url.pathname}" does not exist` });
}

/* --------------------- Test controls (/__mock/*) -------------------- */

export async function mockControl(pathname, method, body) {
  if (pathname === "/__mock/reset" && method === "POST") {
    state.rows = [];
    state.geminiMode = null;
    state.geminiCalls = 0;
    state.geminiRequests = [];
    state.lastGemini = null;
    state.lastUsage = null;
    state.supabaseCalls = [];
    return { ok: true };
  }
  if (pathname === "/__mock/seed" && method === "POST") {
    const n = Number(body?.families || 0);
    const tasks = Array.isArray(body?.tasks) ? body.tasks : ["checkin_call", "groceries"];
    for (let i = 0; i < n; i++) {
      state.rows.push({
        id: randomUUID(),
        created_at: new Date(Date.now() - (i % 2 ? 2 : 0) * 86400e3).toISOString(),
        visitor_id: `seed-visitor-${i}`,
        ip_hash: `seed-ip-${i}`,
        input: { tasks, note_present: false },
        output: { tasks: [], tip: "", flag: null, source: "gemini" },
        refused: false,
        doctor_flag: false,
      });
    }
    return { ok: true, rows: state.rows.length };
  }
  if (pathname === "/__mock/gemini" && method === "POST") {
    state.geminiMode = body?.mode || null;
    return { ok: true, mode: state.geminiMode };
  }
  if (pathname === "/__mock/state" && method === "GET") {
    return state;
  }
  return null;
}
