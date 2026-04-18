// public/sw.js - Service Worker para funcionar offline
var CACHE = 'rodeo-v2';

self.addEventListener('install', function(e){
  self.skipWaiting();
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
  var url = new URL(req.url);
  // No cachear peticiones a Firebase (manejan offline por su cuenta)
  if(url.hostname.indexOf('firestore') >= 0 || url.hostname.indexOf('firebase') >= 0 || url.hostname.indexOf('identitytoolkit') >= 0 || url.hostname.indexOf('googleapis') >= 0) return;
  e.respondWith(
    fetch(req).then(function(resp){
      if(resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')){
        var clon = resp.clone();
        caches.open(CACHE).then(function(c){c.put(req, clon);}).catch(function(){});
      }
      return resp;
    }).catch(function(){
      return caches.match(req).then(function(cached){
        if(cached) return cached;
        if(req.mode === 'navigate') return caches.match('/');
        return new Response('', {status: 408, statusText: 'Offline'});
      });
    })
  );
});
