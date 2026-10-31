/* Service Worker — بيخلي الموقع يفتح من غير إنترنت.
   لو غيّرت أي ملف من ملفات الواجهة، النسخة الجديدة بتتحمل أوتوماتيك لما النت يكون شغال. */

const CACHE = 'connect-shell-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'offline.js', 'config.js', 'manifest.json', 'logo-icon.webp', 'favicon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* ملف ناقص مش مشكلة */ });
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

function fetchWithTimeout(req, ms) {
  return Promise.race([
    fetch(req),
    new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); })
  ]);
}

// الشبكة الأول (عشان التحديثات توصل)، ولو النت مقطوع أو بطيء جدًا نرجع للنسخة المخزنة
async function networkFirst(req, isNav) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: عشان GitHub Pages ميديناش نسخة قديمة من كاش المتصفح لحد 10 دقايق
    const res = await fetchWithTimeout(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }), 4000);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(req, { ignoreSearch: true })) ||
      (isNav ? ((await cache.match('index.html')) || (await cache.match('./'))) : null);
    return hit || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(function () { return null; });
  return hit || (await net) || new Response('', { status: 504 });
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('googleusercontent.com')) return; // الـ API مبنلمسوش
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, true)); return; }
  if (isFont) { e.respondWith(staleWhileRevalidate(req)); return; }
  e.respondWith(networkFirst(req, false));
});
