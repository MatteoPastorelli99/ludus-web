// Ludus si e' spostata su ludus-app.github.io: qui il service worker non serve piu'.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        for (const n of await caches.keys()) await caches.delete(n);
        await self.registration.unregister();
    })());
});
