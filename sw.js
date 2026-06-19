// MeteoFoux Service Worker
// Stratégie : cache du "shell" statique, données météo toujours via le réseau.
// Bump CACHE_VERSION à chaque déploiement pour invalider l'ancien cache.

const CACHE_VERSION = 'meteofoux-v3';

// Fichiers du shell mis en cache à l'installation.
// Les versions (?v=) doivent rester alignées avec index.html.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css?v=3.75',
  '/js/core.js?v=2.5',
  '/js/ui.js?v=2.17',
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

  // Shell statique : cache d'abord, réseau en repli (et on met à jour le cache).
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
