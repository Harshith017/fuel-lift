// MaxxTempo — owner tools for members.
//
//   POST {action:"temp-password", user_id}  (signed-in owner only)
//     Sets a random temporary password for that member and returns it once, so the
//     owner can pass it on privately. The member is asked to choose a new password
//     the next time they sign in. This exists because the app sends no email to
//     friends (Supabase's built-in mailer only reaches the project team), so
//     "forgot password" emails can't work for them.

import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://harshith017.github.io";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, code: string) => reply(status, { ok: false, code });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Easy to read aloud or type: no 0/O, 1/l/I.
function tempPassword() {
  const A = "abcdefghjkmnpqrstuvwxyz", N = "23456789", all = A + A.toUpperCase() + N;
  const r = crypto.getRandomValues(new Uint32Array(12));
  const chars = Array.from(r, (x) => all[x % all.length]);
  chars[3] = N[r[3] % N.length]; chars[8] = A.toUpperCase()[r[8] % 23];
  return chars.slice(0, 4).join("") + "-" + chars.slice(4, 8).join("") + "-" + chars.slice(8).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method_not_allowed");
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, "bad_request"); }
  if (!body || typeof body !== "object") return fail(400, "bad_request");
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!user) return fail(401, "session_expired");
    const { data: me } = await admin.from("members").select("status,is_admin").eq("user_id", user.id).maybeSingle();
    if (me?.status !== "approved" || !me?.is_admin) return fail(403, "not_allowed");

    if (body.action === "temp-password") {
      const target = String(body.user_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(target) || target === user.id) return fail(400, "bad_request");
      const { data: m } = await admin.from("members").select("status").eq("user_id", target).maybeSingle();
      if (!m) return fail(404, "not_found");
      const { data: u } = await admin.auth.admin.getUserById(target);
      if (!u?.user) return fail(404, "not_found");
      const password = tempPassword();
      // Also confirms the address: accounts started from an undeliverable sign-in link are left unconfirmed.
      const { error } = await admin.auth.admin.updateUserById(target, { password, email_confirm: true, user_metadata: { ...(u.user.user_metadata ?? {}), must_change_password: true } });
      if (error) { console.error("temp-password", error.message); return fail(500, "server_error"); }
      return reply(200, { ok: true, password, email: u.user.email });
    }
    return fail(400, "bad_action");
  } catch (e) {
    console.error("members", e instanceof Error ? e.message : e);
    return fail(500, "server_error");
  }
});
