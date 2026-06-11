// Service worker: cache dos arquivos estáticos para abrir rápido/offline.
// As rotas /api/ e chamadas externas (OpenRouter) nunca são cacheadas.
const CACHE = 'compras-v4';
const ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/store.js',
  '/llm.js',
  '/assistant.js',
  '/quotes.js',
  '/manifest.webmanifest',
  '/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
