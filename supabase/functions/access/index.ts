// MaxxTempo — joining without email.
//
//   POST {action:"request", email}
//     A new person types only their email. The account is created here (no
//     password, no email sent) and waits for the owner's approval. The phone that
//     asked gets a private claim key, shown to no one; only its SHA-256 is stored.
//     An email that already has a password or Face ID gets {state:"has_account"}.
//
//   POST {action:"status", email, key}
//     That phone checks back. Once the owner approves, it gets a one-time sign-in
//     token (the same kind Face ID sign-in uses) and the claim is deleted. The
//     person then fills in their details and must choose a password before using
//     the app (user_metadata.needs_password).
//
// Why: Supabase's built-in mailer only reaches the project team, so email links,
// confirmation emails and "forgot password" emails never reach friends.

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

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const CLAIM_DAYS = 30;
const PER_HOUR = 20; // new requests across everyone, to stop a flood of fake accounts

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const newKey = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
type State = { user_id: string | null; has_password: boolean; has_passkey: boolean; status: string | null; is_admin: boolean };
async function accountState(email: string): Promise<State> {
  const { data, error } = await admin.rpc("access_account_state", { p_email: email });
  if (error) throw new Error("state: " + error.message);
  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  return { user_id: r.user_id ?? null, has_password: !!r.has_password, has_passkey: !!r.has_passkey, status: r.status ?? null, is_admin: !!r.is_admin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method_not_allowed");
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, "bad_request"); }
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return fail(400, "bad_email");
  try {
    if (body.action === "request") {
      const st = await accountState(email);
      if (st.has_password || st.has_passkey || st.is_admin) return reply(200, { ok: true, state: "has_account" });
      if (st.status === "declined") return reply(200, { ok: true, state: "declined" });
      const since = new Date(Date.now() - 3600e3).toISOString();
      const { count } = await admin.from("access_claims").select("user_id", { count: "exact", head: true }).gte("created_at", since);
      if ((count ?? 0) >= PER_HOUR) return fail(429, "rate_limited");
      let userId = st.user_id;
      if (!userId) {
        const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { needs_password: true } });
        if (error || !data?.user) { console.error("createUser", error?.message); return fail(500, "server_error"); }
        userId = data.user.id;
      } else {
        // An older account with no password and no Face ID (made from an email link that
        // never arrived): a new request goes back to the owner for approval.
        const { data: u } = await admin.auth.admin.getUserById(userId);
        await admin.auth.admin.updateUserById(userId, { email_confirm: true, user_metadata: { ...(u?.user?.user_metadata ?? {}), needs_password: true } });
        await admin.from("members").update({ status: "pending", decided_at: null, requested_at: new Date().toISOString() }).eq("user_id", userId).neq("is_admin", true);
      }
      const key = newKey();
      const { error } = await admin.from("access_claims").upsert({ user_id: userId, key_hash: await sha256(key), created_at: new Date().toISOString() });
      if (error) { console.error("claim", error.message); return fail(500, "server_error"); }
      const { data: m } = await admin.from("members").select("status").eq("user_id", userId).maybeSingle();
      return reply(200, { ok: true, state: m?.status === "approved" ? "approved" : "pending", key });
    }

    if (body.action === "status") {
      const key = String(body.key ?? "");
      if (!/^[0-9a-f]{64}$/.test(key)) return fail(400, "bad_request");
      const st = await accountState(email);
      if (!st.user_id) return reply(200, { ok: true, state: "expired" });
      const { data: c } = await admin.from("access_claims").select("key_hash,created_at").eq("user_id", st.user_id).maybeSingle();
      if (!c || !same(c.key_hash, await sha256(key))) return reply(200, { ok: true, state: "expired" });
      if (Date.now() - Date.parse(c.created_at) > CLAIM_DAYS * 864e5) {
        await admin.from("access_claims").delete().eq("user_id", st.user_id);
        return reply(200, { ok: true, state: "expired" });
      }
      if (st.status === "declined") return reply(200, { ok: true, state: "declined" });
      if (st.status !== "approved") return reply(200, { ok: true, state: "pending" });
      const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (error || !link?.properties?.hashed_token) { console.error("generateLink", error?.message); return fail(500, "server_error"); }
      await admin.from("access_claims").delete().eq("user_id", st.user_id);
      return reply(200, { ok: true, state: "approved", token_hash: link.properties.hashed_token });
    }
    return fail(400, "bad_action");
  } catch (e) {
    console.error("access", e instanceof Error ? e.message : e);
    return fail(500, "server_error");
  }
});
