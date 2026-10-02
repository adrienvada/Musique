/**
 * PORTÉE HORS LIGNE (site GitHub Pages seulement)
 *
 * L'appli se recharge du réseau quand il est là (une nouvelle version se
 * voit tout de suite) et retombe sur sa copie sinon. Le piano, lourd et
 * immuable, se garde à part et ne se retélécharge jamais. abcjs et les
 * polices viennent de CDN : gardés aussi, pour la gravure hors ligne.
 * Le connecteur reMarkable n'est jamais mis en cache.
 *
 * Juste après une mise en ligne, la page arrivait neuve et ses modules
 * anciens (GitHub Pages les laisse dix minutes dans le cache du navigateur) :
 * l'éditeur plantait sur un bouton disparu et la grille restait vide (02/10).
 * Les modules et les feuilles de style portent maintenant la version dans
 * leur adresse (`?v=…`, voir outils/assembler-appli.mjs) : aucun cache ne
 * peut en rendre un ancien. La page, elle, et les fichiers sans version sont
 * redemandés au serveur, pas au cache du navigateur (`no-cache` : un
 * aller-retour court, rien de retéléchargé s'ils n'ont pas changé).
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
      // Une navigation ne se recopie pas avec des options : on la redemande par
      // son adresse, sans suivre une redirection (c'est au navigateur de le faire).
      const frais = url.searchParams.has("v") ? req
        : req.mode === "navigate" ? new Request(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "manual" })
        : new Request(req, { cache: "no-cache" });
      const r = await fetch(frais);
      if (r.ok) cache.put(req, r.clone());
      return r;
    } catch (erreur) {
      const garde = await cache.match(req, { ignoreSearch: true });
      if (garde) return garde;
      throw erreur;
    }
  })());
});
