// Bump this on every deploy so clients pick up the new service worker.
const CACHE = 'quickcric-v79';
const ASSETS = [
  './',
  'index.html',
  'app.js',
  'players.js',
  'db.js',
  'config.js',
  'style.css',
  'manifest.json',
  'icon.svg'
];

const NETWORK_FIRST = new Set([
  'index.html',
  'app.js',
  'players.js',
  'db.js',
  'config.js',
  'style.css',
]);

function assetName(url) {
  const path = new URL(url).pathname.replace(/^\//, '');
  return path || 'index.html';
}

function isNetworkFirst(request) {
  if (request.mode === 'navigate') return true;
  return NETWORK_FIRST.has(assetName(request.url));
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (isNetworkFirst(e.request)) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r && r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((r) => {
          if (r && r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return r;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
