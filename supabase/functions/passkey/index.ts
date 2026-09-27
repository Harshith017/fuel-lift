// MaxxTempo — Face ID / Touch ID sign-in with passkeys (WebAuthn).
//
// Approved people register a passkey once while signed in; after that the
// sign-in screen can sign them in with Face ID. The passkey is verified here,
// approval is re-checked, and a one-time sign-in token is returned for the
// page to exchange for a normal session (no email is sent).
//
// Actions (POST {action, ...}):
//   register-options, register-verify, list, delete   — need a signed-in, approved user
//   login-options, login-verify                        — anyone (anon key)
// Uses the ALLOWED_ORIGIN secret as the expected origin; its host is the passkey's RP ID.

import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://harshith017.github.io";
const RP_ID = new URL(ORIGIN).hostname;
const RP_NAME = "MaxxTempo";
const MAX_OPEN_LOGINS = 100; // unexpired sign-in challenges (each lives 5 minutes)

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, code: string) => reply(status, { ok: false, code });

const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function approvedUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return null;
  const { data: m } = await admin.from("members").select("status").eq("user_id", user.id).maybeSingle();
  return m?.status === "approved" ? user : null;
}
async function newChallenge(challenge: string, kind: "register" | "login", userId: string | null) {
  await admin.from("webauthn_challenges").delete().lt("expires_at", new Date().toISOString());
  const { data, error } = await admin.from("webauthn_challenges").insert({ challenge, kind, user_id: userId }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
// One use only: read and delete in one go.
async function takeChallenge(id: string, kind: "register" | "login") {
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return null;
  const { data } = await admin.from("webauthn_challenges").delete().eq("id", id).eq("kind", kind).select("challenge,user_id,expires_at").maybeSingle();
  if (!data || Date.parse(data.expires_at) < Date.now()) return null;
  return data as { challenge: string; user_id: string | null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method_not_allowed");
  if (Number(req.headers.get("content-length") ?? 0) > 64_000) return fail(413, "too_large");
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return fail(400, "bad_request"); }
  if (!body || typeof body !== "object") return fail(400, "bad_request");

  try {
    switch (body.action) {
      case "register-options": {
        const user = await approvedUser(req);
        if (!user) return fail(401, "not_approved");
        const { data: existing } = await admin.from("passkeys").select("id,transports").eq("user_id", user.id);
        const options = await generateRegistrationOptions({
          rpName: RP_NAME, rpID: RP_ID,
          userName: user.email ?? user.id,
          userDisplayName: (user.user_metadata?.full_name as string) || user.email || "MaxxTempo",
          userID: new TextEncoder().encode(user.id),
          attestationType: "none",
          excludeCredentials: (existing ?? []).map((c) => ({ id: c.id, transports: c.transports ?? undefined })),
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
        });
        return reply(200, { ok: true, options, challengeId: await newChallenge(options.challenge, "register", user.id) });
      }
      case "register-verify": {
        const user = await approvedUser(req);
        if (!user) return fail(401, "not_approved");
        const ch = await takeChallenge(body.challengeId, "register");
        if (!ch || ch.user_id !== user.id) return fail(400, "expired");
        const v = await verifyRegistrationResponse({
          response: body.response, expectedChallenge: ch.challenge,
          expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
        });
        if (!v.verified) return fail(400, "not_verified");
        const c = v.registrationInfo.credential;
        const { error } = await admin.from("passkeys").insert({
          id: c.id, user_id: user.id, public_key: b64url(c.publicKey), counter: c.counter,
          transports: c.transports ?? null, device_name: String(body.device ?? "").slice(0, 40) || null,
        });
        if (error) return fail(409, "already_registered");
        return reply(200, { ok: true });
      }
      case "list": {
        const user = await approvedUser(req);
        if (!user) return fail(401, "not_approved");
        const { data } = await admin.from("passkeys").select("id,device_name,created_at,last_used_at").eq("user_id", user.id).order("created_at");
        return reply(200, { ok: true, passkeys: data ?? [] });
      }
      case "delete": {
        const user = await approvedUser(req);
        if (!user) return fail(401, "not_approved");
        await admin.from("passkeys").delete().eq("user_id", user.id).eq("id", String(body.id ?? ""));
        return reply(200, { ok: true });
      }
      case "login-options": {
        // Anyone can ask for a sign-in challenge, so cap how many can be open at once.
        const { count } = await admin.from("webauthn_challenges").select("id", { count: "exact", head: true })
          .eq("kind", "login").gt("expires_at", new Date().toISOString());
        if ((count ?? 0) >= MAX_OPEN_LOGINS) return fail(429, "busy");
        const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: "required", allowCredentials: [] });
        return reply(200, { ok: true, options, challengeId: await newChallenge(options.challenge, "login", null) });
      }
      case "login-verify": {
        const ch = await takeChallenge(body.challengeId, "login");
        if (!ch) return fail(400, "expired");
        const credId = String(body.response?.id ?? "");
        const { data: pk } = await admin.from("passkeys").select("id,user_id,public_key,counter,transports").eq("id", credId).maybeSingle();
        if (!pk) return fail(404, "unknown_passkey");
        const v = await verifyAuthenticationResponse({
          response: body.response, expectedChallenge: ch.challenge,
          expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
          credential: { id: pk.id, publicKey: fromB64url(pk.public_key), counter: Number(pk.counter), transports: pk.transports ?? undefined },
        });
        if (!v.verified) return fail(401, "not_verified");
        await admin.from("passkeys").update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", pk.id);
        const { data: m } = await admin.from("members").select("status").eq("user_id", pk.user_id).maybeSingle();
        if (m?.status !== "approved") return fail(403, "not_approved");
        const { data: u } = await admin.auth.admin.getUserById(pk.user_id);
        const email = u?.user?.email;
        if (!email) return fail(400, "no_email");
        const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
        if (error || !link?.properties?.hashed_token) return fail(500, "server_error");
        return reply(200, { ok: true, token_hash: link.properties.hashed_token });
      }
      default:
        return fail(400, "bad_action");
    }
  } catch (e) {
    console.error("passkey", body?.action, e instanceof Error ? e.message : e);
    return fail(400, "not_verified");
  }
});
