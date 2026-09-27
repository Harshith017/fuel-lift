// MaxxTempo — automatic Apple Health sync via an iPhone Shortcut.
//
// The Shortcut reads today's steps, active energy and sleep from Apple Health
// (which also holds Garmin data when Garmin Connect shares to Health) and POSTs:
//   {"key": "<sync key>", "date": "2026-09-27", "steps": 8400, "active_kcal": 520, "sleep_min": 430}
// The sync key is created in the app (Settings → Watch & health) and only its
// SHA-256 hash is stored. Values land in the `health` collection (one doc per
// day), which the app lays over that day's own health numbers.
//
// App actions (signed-in, approved user, JSON {action}):
//   create-key   → returns a new key once (replaces any old one)
//   status       → {connected, last_sync_at}
//   revoke       → deletes the key
// Deployed with verify_jwt off, because the Shortcut has no Supabase session;
// the app actions check the session themselves.

import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://harshith017.github.io";
const TIMEZONE = Deno.env.get("APP_TIMEZONE") ?? "Asia/Kolkata";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, code: string, message?: string) => reply(status, { ok: false, code, ...(message ? { message } : {}) });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const newKey = () => "mt_" + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function approvedUser(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token.startsWith("mt_")) return null;
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return null;
  const { data: m } = await admin.from("members").select("status").eq("user_id", user.id).maybeSingle();
  return m?.status === "approved" ? user : null;
}

// Shortcuts hands over numbers in many shapes: "8,400", "8400 steps", "7.5",
// or a list (one value per line) when a Sum step was left out. Lists are summed.
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) { const xs = v.map(num).filter((x): x is number => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; }
  const parts = String(v).split(/[\n;]+/).map((s) => s.replace(/,/g, "").match(/-?\d+(\.\d+)?/)).filter(Boolean).map((m) => Number(m![0]));
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}
// Durations written out with units, e.g. "7 hr 10 min", "7h 10m", "25,800 sec".
// Several lines (one per sleep segment) are added up. Minutes, or null without units.
function durationText(v: unknown): number | null {
  if (typeof v !== "string" || !/\d\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/i.test(v)) return null;
  let total = 0;
  for (const [, n, u] of v.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|mins?|minutes?|s|secs?|seconds?)\b/gi)) {
    const x = Number(n), k = u.toLowerCase()[0];
    total += k === "h" ? x * 60 : k === "m" ? x : x / 60;
  }
  return total;
}
// Sleep may arrive as minutes, hours or seconds; take the named field, else guess by size.
function sleepMinutes(b: Record<string, unknown>): number | null {
  for (const f of ["sleep", "sleep_min", "sleep_minutes", "sleep_hours", "sleep_seconds"]) { const d = durationText(b[f]); if (d != null) return d; }
  const s = num(b.sleep_seconds); if (s != null) return s / 60;
  const m = num(b.sleep_min ?? b.sleep_minutes); if (m != null) return m;
  const h = num(b.sleep_hours); if (h != null) return h * 60;
  const g = num(b.sleep); if (g == null) return null;
  return g <= 24 ? g * 60 : g <= 1440 ? g : g / 60;
}
// What arrived, without any values: content type, field names and their types.
const shape = (b: Record<string, unknown>, ct: string) =>
  `${ct.split(";")[0] || "no content-type"} · ` + Object.entries(b).map(([k, v]) => `${k.slice(0, 20)}:${Array.isArray(v) ? "list" : typeof v}`).join(", ").slice(0, 300);
async function logAttempt(userId: string | null, status: number, code: string, detail: string) {
  try {
    await admin.from("health_attempts").insert({ user_id: userId, status, code, detail });
    const { data } = await admin.from("health_attempts").select("id").order("id", { ascending: false }).range(100, 100);
    if (data?.[0]) await admin.from("health_attempts").delete().lte("id", data[0].id);
  } catch { /* diagnostics only */ }
}
const within = (v: number | null, lo: number, hi: number) => v != null && v >= lo && v <= hi ? Math.round(v) : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") { await logAttempt(null, 405, "method_not_allowed", req.method); return fail(405, "method_not_allowed", "Use POST (in Get Contents of URL, set Method to POST)."); }
  if (Number(req.headers.get("content-length") ?? 0) > 32_000) return fail(413, "too_large");
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    body = text.trim().startsWith("{") ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
  } catch { await logAttempt(null, 400, "bad_request", "unreadable body · " + (req.headers.get("content-type") ?? "")); return fail(400, "bad_request", "Send JSON."); }
  if (!body || typeof body !== "object") return fail(400, "bad_request", "Send JSON.");

  try {
    // ---- From the app ----
    if (typeof body.action === "string") {
      const user = await approvedUser(req);
      if (!user) return fail(401, "not_approved");
      if (body.action === "create-key") {
        const key = newKey();
        const { error } = await admin.from("health_keys").upsert({ user_id: user.id, key_hash: await sha256(key), created_at: new Date().toISOString(), last_sync_at: null });
        if (error) throw error;
        return reply(200, { ok: true, key });
      }
      if (body.action === "status") {
        const { data } = await admin.from("health_keys").select("created_at,last_sync_at").eq("user_id", user.id).maybeSingle();
        return reply(200, { ok: true, connected: !!data, created_at: data?.created_at ?? null, last_sync_at: data?.last_sync_at ?? null });
      }
      if (body.action === "revoke") {
        await admin.from("health_keys").delete().eq("user_id", user.id);
        return reply(200, { ok: true });
      }
      return fail(400, "bad_action");
    }

    // ---- From the Shortcut ----
    const ct = req.headers.get("content-type") ?? "";
    let who: string | null = null;
    const done = async (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => {
      await logAttempt(who, status, code, shape(body, ct));
      return reply(status, { ok: status < 300, code, message, ...extra });
    };
    const key = String(body.key ?? (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")).trim();
    if (!/^mt_[A-Za-z0-9_-]{32}$/.test(key)) return done(401, "bad_key", "The sync key is missing or wrong. Copy it again from MaxxTempo → Profile → Settings → Watch & health apps.");
    const { data: hk } = await admin.from("health_keys").select("user_id,last_sync_at").eq("key_hash", await sha256(key)).maybeSingle();
    if (!hk) return done(401, "bad_key", "This sync key isn't active. Create a new one in MaxxTempo → Profile → Settings → Watch & health apps.");
    who = hk.user_id;
    if (hk.last_sync_at && Date.now() - Date.parse(hk.last_sync_at) < 10_000) return done(429, "too_often", "Synced a moment ago. Try again in a few seconds.");
    const { data: m } = await admin.from("members").select("status").eq("user_id", hk.user_id).maybeSingle();
    if (m?.status !== "approved") return done(403, "not_approved", "Your MaxxTempo account isn't approved.");

    const now = today();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? "")) ? String(body.date) : now;
    if (date > addDays(now, 1) || date < addDays(now, -7)) return done(400, "bad_date", "Date must be within the last 7 days (format 2026-09-27).");

    const vals: Record<string, number> = {};
    const steps = within(num(body.steps), 0, 150_000); if (steps != null) vals.steps = steps;
    const active = within(num(body.active_kcal ?? body.active_energy ?? body.active), 0, 10_000); if (active != null) vals.active_kcal = active;
    const resting = within(num(body.resting_kcal ?? body.resting_energy ?? body.resting), 0, 6_000); if (resting != null) vals.resting_kcal = resting;
    const sleep = within(sleepMinutes(body), 0, 1_200); if (sleep != null && sleep > 0) vals.sleep_min = sleep;
    if (!Object.keys(vals).length) return done(400, "no_values", "Nothing to save. Send steps, active_kcal and/or sleep_min.");

    const { data: cur } = await admin.from("docs").select("data").eq("user_id", hk.user_id).eq("collection", "health").eq("id", date).maybeSingle();
    const data = { ...(cur?.data ?? {}), ...vals, date, synced_at: new Date().toISOString(), source: "shortcut" };
    const { error } = await admin.from("docs").upsert({ user_id: hk.user_id, collection: "health", id: date, data, updated_at: new Date().toISOString() });
    if (error) throw error;
    await admin.from("health_keys").update({ last_sync_at: new Date().toISOString() }).eq("user_id", hk.user_id);
    const said = [vals.steps != null && `${vals.steps} steps`, vals.active_kcal != null && `${vals.active_kcal} active kcal`, vals.sleep_min != null && `${Math.floor(vals.sleep_min / 60)}h ${vals.sleep_min % 60}m sleep`].filter(Boolean).join(", ");
    return done(200, "ok", `MaxxTempo: saved ${said} for ${date}.`, { date, saved: vals });
  } catch (e) {
    console.error("health-sync", e instanceof Error ? e.message : e);
    return fail(500, "server_error", "Couldn't save. Try again later.");
  }
});
