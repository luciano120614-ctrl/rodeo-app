var CACHE = 'rodeo-v5';

// Archivos esenciales
var ARCHIVOS_ESENCIALES = [
  '/',
  '/index.html'
];

// 🔥 Instalación (forzada)
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ARCHIVOS_ESENCIALES).catch(function(err) {
        console.log('Error cache:', err);
      });
    })
  );
});

// 🔥 Activación (control inmediato)
self.addEventListener('activate', function(e) {
  e.waitUntil(
    self.clients.claim().then(function() {
      return caches.keys().then(function(keys) {
        return Promise.all(
          keys
            .filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
        );
      });
    })
  );
});

// 🔥 Interceptar requests
self.addEventListener('fetch', function(e) {
  var req = e.request;

  if (req.method !== 'GET') return;

  e.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;

      return fetch(req).then(function(resp) {
        if (!resp || resp.status !== 200) return resp;

        var clone = resp.clone();
        caches.open(CACHE).then(function(cache) {
          cache.put(req, clone);
        });

        return resp;
      }).catch(function() {
        return caches.match('/');
      });
    })
  );
});