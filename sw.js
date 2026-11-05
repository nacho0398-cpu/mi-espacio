/* Mi Espacio — service worker: la app abre al instante y sin conexión, y avisa cuando hay versión nueva.
   Para publicar una versión basta con subir index.html: al abrir la app se detecta y aparece ACTUALIZAR.
   Cambia CACHE solo si cambian chart.umd.min.js o los iconos. */
const CACHE = 'mi-espacio-v5';
const SHELL = ['./', './index.html', './manifest.webmanifest', './chart.umd.min.js', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const MARK = './__update';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('mi-espacio-') && !k.startsWith(CACHE)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function digest(res) {
  const h = await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer());
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
// Descarga index.html; si ha cambiado lo guarda, deja una marca y avisa a la app abierta.
async function checkUpdate() {
  try {
    const cache = await caches.open(CACHE);
    const cached = await cache.match('./index.html');
    const res = await fetch('./index.html', { cache: 'no-cache' });
    if (!res.ok) return;
    const changed = !cached || (await digest(res)) !== (await digest(cached));
    if (!changed) return;
    await cache.put('./index.html', res.clone());
    if (cached) {
      await cache.put(MARK, new Response(String(Date.now())));
      (await self.clients.matchAll({ type: 'window' })).forEach(c => c.postMessage({ type: 'update-ready' }));
    }
  } catch { /* sin conexión: se intentará la próxima vez */ }
}
async function serveApp(event) {
  const cache = await caches.open(CACHE);
  await cache.delete(MARK);                       // esta apertura ya carga la última versión guardada
  const cached = await cache.match('./index.html');
  const check = checkUpdate();
  event.waitUntil(check);
  if (cached) return cached;
  await check;
  return (await cache.match('./index.html')) || fetch(event.request).catch(() => new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
}

self.addEventListener('message', event => { if (event.data && event.data.type === 'check-update') event.waitUntil(checkUpdate()); });
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === location.origin) { event.respondWith(serveApp(event)); return; }
  if (url.origin === location.origin) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Tipografía de Google: se guarda para usarla sin conexión.
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    event.respondWith(caches.open(CACHE + '-fonts').then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit || Response.error());
      return hit || net;
    }));
  }
  // Todo lo demás (búsquedas de carátulas, imágenes remotas) va directo a la red.
});
