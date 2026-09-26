#!/usr/bin/env node
// MaxxTempo — one-shot setup of an existing Supabase project.
//
//   SUPABASE_ACCESS_TOKEN=... ANTHROPIC_API_KEY=... node supabase/deploy.mjs [project-ref-or-name]
//
// Does, in order: finds the project, runs schema.sql, deploys the `claude`
// edge function, stores its secrets, sets up email-code sign-in and the app's
// address, and writes the project URL + anon key into config.js.
// Safe to run again: every step overwrites rather than duplicates.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const API = 'https://api.supabase.com/v1';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const APP_URL = process.env.APP_URL || 'https://harshith017.github.io/maxxtempo/';
const WANT = process.argv[2] || process.env.SUPABASE_PROJECT || 'fuel-lift';

if (!TOKEN) { console.error('Set SUPABASE_ACCESS_TOKEN (Supabase → Account → Access Tokens).'); process.exit(1); }

async function api(method, p, body, headers = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(API + p, {
    method, headers: { Authorization: `Bearer ${TOKEN}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

// 1. Project
step(1, 'Finding your Supabase project');
const projects = await api('GET', '/projects');
const proj = projects.find(p => p.id === WANT || p.ref === WANT || (p.name || '').toLowerCase() === WANT.toLowerCase())
  || (projects.length === 1 ? projects[0] : null);
if (!proj) { console.error(`No project called "${WANT}". Projects: ${projects.map(p => `${p.name} (${p.id})`).join(', ') || 'none'}`); process.exit(1); }
const ref = proj.id || proj.ref;
console.log(`    ${proj.name} (${ref}), ${proj.region}, ${proj.status}`);
for (let i = 0; proj.status !== 'ACTIVE_HEALTHY' && i < 40; i++) {
  await new Promise(r => setTimeout(r, 15000));
  proj.status = (await api('GET', `/projects/${ref}`)).status; console.log(`    waiting for the project to start: ${proj.status}`);
}

// 2. Database
step(2, 'Creating tables, security rules and the usage counter');
await api('POST', `/projects/${ref}/database/query`, { query: await readFile(path.join(HERE, 'schema.sql'), 'utf8') });
console.log('    done');

// 3. Edge function
step(3, 'Deploying the claude function');
const fn = await readFile(path.join(HERE, 'functions/claude/index.ts'), 'utf8');
const form = new FormData();
form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: 'claude', verify_jwt: true }));
form.append('file', new Blob([fn], { type: 'application/typescript' }), 'index.ts');
await api('POST', `/projects/${ref}/functions/deploy?slug=claude`, form);
console.log('    deployed');

// 4. Secrets
step(4, 'Storing the function secrets');
const secrets = [['ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY], ['GEMINI_API_KEY', process.env.GEMINI_API_KEY], ['ALLOWED_ORIGIN', new URL(APP_URL).origin],
  ['DAILY_CAP', process.env.DAILY_CAP], ['APP_TIMEZONE', process.env.APP_TIMEZONE]].filter(([, v]) => v);
await api('POST', `/projects/${ref}/secrets`, secrets.map(([name, value]) => ({ name, value })));
console.log(`    ${secrets.map(s => s[0]).join(', ')}`);
if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) console.log('    No ANTHROPIC_API_KEY or GEMINI_API_KEY: the app works, AI features wait until one is added.');

// 5. Sign-in
step(5, 'Setting up email-code sign-in');
await api('PATCH', `/projects/${ref}/config/auth`, {
  site_url: APP_URL,
  uri_allow_list: [APP_URL, 'https://harshith017.github.io/fuel-lift/', 'http://localhost:8765/'].join(','), // old address kept for links sent before the rename
});
console.log(`    site ${APP_URL}`);
// Free-tier projects on Supabase's built-in mailer can't change email templates;
// sign-in links still work, but the code needs custom SMTP (SETUP.md step 1.4).
try {
  await api('PATCH', `/projects/${ref}/config/auth`, {
    mailer_subjects_magic_link: 'Your MaxxTempo sign-in code',
    mailer_templates_magic_link_content:
      '<h2>MaxxTempo</h2><p>Your sign-in code:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>' +
      '<p>Type it in the app, or <a href="{{ .ConfirmationURL }}">tap here</a> on the device you’re signing in on.</p>',
  });
  console.log('    sign-in email shows a code');
} catch (e) {
  if (!/template modification is not available/i.test(e.message)) throw e;
  console.log('    email template not changed: free-tier projects need custom SMTP first (SETUP.md step 1.4).\n' +
    '    Sign-in links work; the code for the iPhone home-screen app waits until then.');
}

// 6. App config
step(6, 'Writing config.js');
const keys = await api('GET', `/projects/${ref}/api-keys?reveal=true`);
const anon = (keys.find(k => k.name === 'anon') || keys.find(k => k.type === 'publishable') || {}).api_key;
if (!anon) throw new Error('Could not find the anon key: ' + JSON.stringify(keys.map(k => k.name)));
const cfgPath = path.join(ROOT, 'config.js');
let cfg = await readFile(cfgPath, 'utf8');
cfg = cfg.replace(/SUPABASE_URL: '[^']*'/, `SUPABASE_URL: 'https://${ref}.supabase.co'`).replace(/SUPABASE_ANON_KEY: '[^']*'/, `SUPABASE_ANON_KEY: '${anon}'`);
await writeFile(cfgPath, cfg);
console.log(`    https://${ref}.supabase.co`);

console.log('\nAll set. Commit config.js and open ' + APP_URL);
