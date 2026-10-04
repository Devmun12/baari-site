// GET /api/stats
// Reads the demo numbers back from Supabase:
//   families    - distinct visitors with at least one plan that was not refused
//   total_plans - every plan stored, refused or not
//   top_task    - the care task picked most often
//   plans_today - plans made since midnight India time
// Cached for 30 seconds. "?fresh=1" skips the cache (the page uses it right
// after a visitor's own plan, so they see the number go up).

import { send, supabaseConfig, getStats } from "./_lib/baari.js";

const CACHE_MS = 30_000;
const CACHED = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" };
const NO_STORE = { "Cache-Control": "no-store" };
let memo = null;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, { error: "Use GET." }, { Allow: "GET" });
  }
  const sb = supabaseConfig();
  if (!sb) return send(res, 503, { error: "Stats aren't switched on yet." }, NO_STORE);

  const fresh = new URL(req.url || "/", "http://localhost").searchParams.has("fresh");
  if (!fresh && memo && Date.now() - memo.at < CACHE_MS) return send(res, 200, memo.data, CACHED);

  try {
    const data = await getStats(sb);
    memo = { at: Date.now(), data };
    return send(res, 200, data, fresh ? NO_STORE : CACHED);
  } catch (err) {
    console.error(err.message);
    return send(res, 503, { error: "Stats aren't available right now." }, NO_STORE);
  }
}
