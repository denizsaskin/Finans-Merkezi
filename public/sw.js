// public/sw.js
// Minimal service worker — sadece PWA "kurulabilirlik" kriterini karşılamak için var.
// Bu olmadan bazı tarayıcılar (özellikle Samsung Internet) siteyi tam bir PWA olarak
// tanımıyor ve "Ana ekrana ekle" sırasında manifest.json'daki ikonu değil, jenerik bir
// ikon kullanıyor.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

// Basit "pass-through" fetch — hiçbir şeyi önbelleklemiyor, sadece normal ağ isteğini geçiriyor.
// Kurulabilirlik kriteri için bir fetch handler'ın var olması yeterli.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
