/**
 * PORTÉE HORS LIGNE (site GitHub Pages seulement)
 *
 * L'appli se recharge du réseau quand il est là (une nouvelle version se
 * voit tout de suite) et retombe sur sa copie sinon. Le piano, lourd et
 * immuable, se garde à part et ne se retélécharge jamais. abcjs et les
 * polices viennent de CDN : gardés aussi, pour la gravure hors ligne.
 * Le connecteur reMarkable n'est jamais mis en cache.
 */
const VERSION = "portee-__VERSION__";
const PIANO = "portee-piano-1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const cle of await caches.keys()) if (cle !== VERSION && cle !== PIANO) await caches.delete(cle);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ici = url.origin === self.location.origin;
  const cdn = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname);
  if (!ici && !cdn) return;
  const piano = ici && url.pathname.includes("/piano/");
  e.respondWith((async () => {
    if (piano || cdn) {
      const cache = await caches.open(piano ? PIANO : VERSION);
      const garde = await cache.match(req);
      if (garde) return garde;
      const r = await fetch(req);
      if (r.ok || r.type === "opaque") cache.put(req, r.clone());
      return r;
    }
    const cache = await caches.open(VERSION);
    try {
      const r = await fetch(req);
      if (r.ok) cache.put(req, r.clone());
      return r;
    } catch (erreur) {
      const garde = await cache.match(req, { ignoreSearch: true });
      if (garde) return garde;
      throw erreur;
    }
  })());
});
