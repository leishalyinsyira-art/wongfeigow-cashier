/* Service worker: membuat aplikasi tetap bisa dibuka saat offline bila dilayani lewat http(s).
   Letakkan di folder yang sama dengan index.html. Strategi: jaringan dulu, cadangan dari cache. */
const CACHE = 'wfg-pos-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html'])).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {}); return res; })
      .catch(() => caches.match(r).then(m => m || caches.match('./index.html')))
  );
});
