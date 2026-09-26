/* Fuel & Lift service worker: the app opens offline after the first visit.
   Bump VERSION when shipping changes. */
const VERSION = 'fuel-lift-v2';
const SHELL = ['./', 'index.html', 'config.js', 'calc.js', 'foods.js', 'backend.js', 'app.js', 'manifest.json', 'icon-192.png', 'icon-180.png', 'icon-512.png'];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL).then(() => c.add(LIB).catch(() => {}))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Never cache the database, sign-in or Claude.
  if (/supabase\.co$/.test(url.hostname) || url.pathname.includes('/functions/')) return;
  const own = url.origin === self.location.origin;
  const cdn = /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (!own && !cdn) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    // The app's own files: network first, so updates (and config.js) apply on
    // the next open; the cache is the offline fallback.
    if (own) {
      try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
      catch { return (await cache.match(req, { ignoreSearch: true })) || Response.error(); }
    }
    // Pinned libraries and fonts never change: cache first.
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }));
});
