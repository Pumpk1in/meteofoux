// MeteoFoux Service Worker
// Stratégie : cache du "shell" statique, données météo toujours via le réseau.
//
// Les js/css ne sont PAS listés ici : index.php leur ajoute un ?v=<filemtime>,
// donc chaque nouvelle version porte une URL différente et le cache runtime
// (handler fetch ci-dessous) s'en occupe tout seul. Rien à bumper à la main.
// CACHE_VERSION ne change que si la stratégie de ce fichier change.

const CACHE_VERSION = 'meteofoux-v5';

// Précaché à l'installation : uniquement ce qui n'est pas versionné par URL.
const SHELL_ASSETS = [
  '/',
  '/favicon.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ne gère que les GET de même origine.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Données météo : toujours réseau (jamais de météo périmée affichée).
  if (url.pathname.endsWith('meteo-proxy.php')) {
    return;
  }

  // Document HTML : réseau d'abord, cache en repli hors-ligne.
  // Indispensable : c'est index.php qui porte les ?v= des assets. Le servir
  // depuis le cache figerait les anciennes versions de js/css.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          // Stocké sous '/' pour couvrir aussi le start_url '/?source=pwa'.
          caches.open(CACHE_VERSION).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Assets versionnés : cache d'abord, réseau en repli (et on met à jour le cache).
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
