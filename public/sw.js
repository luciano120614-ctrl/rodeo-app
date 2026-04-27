// public/sw.js - Service Worker para funcionar offline
// Estrategia: cache-first para assets de la app, network-only para Firebase
var CACHE = 'rodeo-v4';

// Archivos esenciales para que la app funcione offline
var ARCHIVOS_ESENCIALES = [
  '/',
  '/index.html'
];

self.addEventListener('install', function(e){
  self.skipWaiting();
  // Pre-cachear archivos esenciales al instalar
  e.waitUntil(
    caches.open(CACHE).then(function(cache){
      return cache.addAll(ARCHIVOS_ESENCIALES).catch(function(err){
        console.log('SW: error al pre-cachear:', err);
      });
    })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
    }).then(function(){return self.clients.claim();})
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;

  var url;
  try{ url = new URL(req.url); }catch(err){ return; }

  // No cachear peticiones a Firebase/Google (ellos manejan offline por su cuenta)
  if(url.hostname.indexOf('firestore') >= 0 ||
     url.hostname.indexOf('firebase') >= 0 ||
     url.hostname.indexOf('identitytoolkit') >= 0 ||
     url.hostname.indexOf('googleapis') >= 0 ||
     url.hostname.indexOf('gstatic') >= 0){
    return; // dejar que el navegador lo maneje
  }

  // Para navegación (HTML): cache-first con fallback a /
  if(req.mode === 'navigate'){
    e.respondWith(
      caches.match(req).then(function(cached){
        if(cached){
          // Devolver de cache y actualizar en background
          fetch(req).then(function(resp){
            if(resp && resp.status === 200){
              var clon = resp.clone();
              caches.open(CACHE).then(function(c){c.put(req, clon);}).catch(function(){});
            }
          }).catch(function(){});
          return cached;
        }
        return fetch(req).then(function(resp){
          if(resp && resp.status === 200){
            var clon = resp.clone();
            caches.open(CACHE).then(function(c){c.put(req, clon);}).catch(function(){});
          }
          return resp;
        }).catch(function(){
          // Sin internet y sin cache: devolver página raíz cacheada
          return caches.match('/').then(function(r){return r || caches.match('/index.html');}).then(function(r){
            return r || new Response('<h1>Sin conexión</h1><p>Abrí la app con internet al menos una vez.</p>', {headers:{'Content-Type':'text/html'}});
          });
        });
      })
    );
    return;
  }

  // Para assets (JS, CSS, imágenes): cache-first con network fallback
  e.respondWith(
    caches.match(req).then(function(cached){
      if(cached){
        // Devolver de cache inmediatamente, actualizar en background
        fetch(req).then(function(resp){
          if(resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')){
            var clon = resp.clone();
            caches.open(CACHE).then(function(c){c.put(req, clon);}).catch(function(){});
          }
        }).catch(function(){});
        return cached;
      }
      // No está en cache, intentar red
      return fetch(req).then(function(resp){
        if(resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')){
          var clon = resp.clone();
          caches.open(CACHE).then(function(c){c.put(req, clon);}).catch(function(){});
        }
        return resp;
      }).catch(function(){
        // Si es un script JS y no lo tenemos, devolvemos un script vacío (no rompe la app)
        if(req.destination === 'script' || url.pathname.indexOf('.js') >= 0){
          return new Response('// offline', {headers:{'Content-Type':'application/javascript'}});
        }
        // Si es CSS, devolvemos vacío
        if(req.destination === 'style' || url.pathname.indexOf('.css') >= 0){
          return new Response('', {headers:{'Content-Type':'text/css'}});
        }
        return new Response('', {status: 408, statusText: 'Offline'});
      });
    })
  );
});