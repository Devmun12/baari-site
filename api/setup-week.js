// POST /api/setup-week
// Turns the visitor's fixed answers into a 7-day care plan with Gemini,
// stores the request and response in Supabase, and returns the plan.
// The Gemini and Supabase keys stay here on the server.

import {
  HttpError,
  send,
  readJson,
  validateInput,
  screenNote,
  supabaseConfig,
  countPlansFor,
  sbInsert,
  clientIp,
  hashIp,
  geminiModel,
  callGemini,
  SYSTEM_PROMPT,
  buildUserPrompt,
  MEDICINE_WORDS_RE,
  parsePlan,
  standardPlan,
  applyDoctorRule,
  labelsFor,
  PARENTS,
  PLAN_CAP,
  CAP_MESSAGE,
} from "./_lib/baari.js";

const NOTICE_REFUSED =
  "Baari swapped the AI's answer for a standard plan because it mentioned medicines or doses. Baari never gives medicine advice.";
const NOTICE_STANDARD = "Baari's planner had a hiccup, so this is Baari's standard plan for the tasks you picked.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { error: "Please use the form to set up a week." }, { Allow: "POST" });
  }
  res.setHeader("Cache-Control", "no-store");

  try {
    const apiKey = (process.env.GEMINI_API_KEY || "").trim();
    const sb = supabaseConfig();
    if (!apiKey || !sb) throw new HttpError(503, "The demo isn't switched on yet. Please try again later.");

    // 1. Validate every field. The note is kept apart because it is never stored.
    const body = await readJson(req);
    const { input, note, visitorId } = validateInput(body);
    const ipHash = hashIp(clientIp(req));

    // 2. Per-visitor cap: rows matching this visitor id OR this IP hash.
    let used;
    try {
      used = await countPlansFor(sb, visitorId, ipHash);
    } catch (err) {
      console.error(err.message);
      throw new HttpError(503, "We couldn't reach Baari's database. Please try again in a minute.");
    }
    if (used >= PLAN_CAP) throw new HttpError(429, CAP_MESSAGE);

    // 3. Ask Gemini for the plan.
    const model = geminiModel();
    const gemini = await callGemini({
      apiKey,
      model,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input, note),
    });

    // 4. Check the answer. Medicine or dose words, or a safety block, mean a refusal.
    let plan = null;
    let refused = false;
    let source = "gemini";
    let reason = null;
    if (gemini.blocked) {
      refused = true;
      reason = "blocked";
    } else if (MEDICINE_WORDS_RE.test(gemini.text)) {
      refused = true;
      reason = "medicine_words";
    } else {
      plan = parsePlan(gemini.text, input);
      if (!plan) {
        console.error("Gemini reply could not be used. finishReason:", gemini.finishReason);
        source = "standard";
        reason = "unreadable";
      }
    }
    if (refused) source = "safe_fallback";
    if (!plan) plan = standardPlan(input);

    // 5. The doctor rule is enforced here too, whatever the model did.
    plan = applyDoctorRule(plan, input, screenNote(note));

    // 6. Store the request and response. The note text is never stored.
    try {
      await sbInsert(sb, "week_plans", {
        visitor_id: visitorId,
        ip_hash: ipHash,
        input: { ...input, note_present: Boolean(note) },
        output: { ...plan, source, reason },
        input_tokens: gemini.inputTokens,
        output_tokens: gemini.outputTokens,
        model,
        latency_ms: gemini.latencyMs,
        refused,
        doctor_flag: plan.flag === "doctor",
      });
    } catch (err) {
      console.error(err.message); // The visitor still gets the plan.
    }

    return send(res, 200, {
      plan,
      labels: labelsFor(input),
      parent: PARENTS[input.parent],
      refused,
      notice: refused ? NOTICE_REFUSED : source === "standard" ? NOTICE_STANDARD : null,
    });
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    return send(res, 500, { error: "Something went wrong on our side. Please try again." });
  }
}
