// Cache dei file del gioco: dopo il primo caricamento parte anche con internet lento.
// (L'online richiede comunque la connessione.)
const CACHE = 'stickcalcio-v1';
const FILES = [
  './', 'index.html', 'css/style.css',
  'js/lib/peerjs.min.js', 'js/config.js', 'js/util.js', 'js/input.js', 'js/ball.js', 'js/player.js',
  'js/ai.js', 'js/match.js', 'js/render.js', 'js/audio.js', 'js/net.js', 'js/main.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Prima la rete (cosi' gli aggiornamenti arrivano subito), poi la cache se offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
