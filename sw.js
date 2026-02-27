const CACHE_NAME = 'tiqal-visor-v2.1';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/state.js',
    './js/main.js',
    './js/seccion.js',
    './js/planta.js',
    './js/perfil.js',
    './manifest.json'
];

// 1. Install: Cache files
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

// 2. Activate: Clear old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
});

// 3. Fetch: Cache First Strategy
self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(res => res || fetch(e.request))
    );
});
