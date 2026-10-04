/**
 * PORTÉE HORS LIGNE (site GitHub Pages seulement)
 *
 * Toute l'appli est gardée dès la première visite : à l'installation, le
 * service worker copie la coquille entière (la page, ses modules, ses
 * feuilles de style, abcjs, pdf.js, les polices, les modèles, les pages
 * d'essai, les icônes), puis le piano. L'assembleur
 * (outils/assembler-appli.mjs) écrit ici la liste exacte des fichiers de
 * la version, et l'empreinte du piano.
 *
 * Avant (audit du 04/10, I5), rien n'était gardé d'avance : on n'avait
 * hors ligne que ce qu'on avait déjà ouvert, et chaque mise en ligne vidait
 * tout (le nouveau service worker effaçait l'ancien cache dès son
 * arrivée, avant d'avoir rien copié). Maintenant :
 *  - l'ancien cache ne part qu'une fois le nouveau complet : `addAll` copie
 *    tout ou rien, et une installation ratée laisse l'ancienne version en
 *    place, qui retentera plus tard ;
 *  - seules les réponses `ok` sont gardées : un portail Wi-Fi ou une panne
 *    passagère ne restent plus servis toute une version (une réponse
 *    « opaque » de CDN y restait, abcjs absent jusqu'à la version suivante) ;
 *  - le piano a son propre cache, nommé d'après l'empreinte de ses
 *    fichiers : lourd, il ne se retélécharge que s'il change, et s'il
 *    change, l'ancien part (avant, il n'était jamais remplacé).
 *
 * La page, elle, et les fichiers sans version sont toujours redemandés au
 * serveur (`no-cache` : un aller-retour court, rien de retéléchargé s'ils
 * n'ont pas changé), et la copie ne sert que si le réseau manque : la page
 * est toujours la dernière, et ses modules suivent (décision du 02/10, le
 * mélange de versions après une mise en ligne). Les modules et les
 * feuilles de style portent la version dans leur adresse (`?v=…`) : ceux
 * de cette version viennent directement de la copie.
 *
 * La copie de la page n'est jamais remplacée en route : c'est celle de
 * l'installation, qui va avec les modules copiés en même temps. Une page
 * plus récente servie par le réseau n'y entre pas (ses modules n'y sont
 * pas, elle ne marcherait pas hors ligne) ; elle y entrera avec sa version.
 *
 * Le connecteur reMarkable (Supabase) n'est jamais mis en cache, ni rien
 * d'un autre domaine.
 */

// Remplis par l'assembleur : sw.js n'existe que dans le site assemblé.
const VERSION = "__VERSION__";
const COQUILLE = ["__COQUILLE__"];
const PIANO = "__PIANO__";
const PIANO_FICHIERS = ["__PIANO_FICHIERS__"];

const CACHE = `portee-${VERSION}`;
const CACHE_PIANO = `portee-piano-${PIANO}`;
const ICI = new URL("./", self.location).href;
const PAGE = ICI;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(COQUILLE.map((f) => new Request(new URL(f, ICI), { cache: "no-cache" })));
      // Si le site a été remis en ligne pendant la copie, la page copiée n'est
      // plus de cette version (le serveur rend toujours la dernière, quelle
      // que soit l'adresse) : on n'installe pas un mélange. Le service worker
      // de la nouvelle version fera la copie.
      const page = await cache.match(PAGE);
      if (!page || !(await page.text()).includes(`?v=${VERSION}`)) throw new Error("Le site a changé pendant la copie.");
    } catch (erreur) {
      // Installation abandonnée : la version d'avant reste en place, entière,
      // et le navigateur retentera à la prochaine visite.
      await caches.delete(CACHE);
      throw erreur;
    }
    // Le piano : ce qui manque seulement (rien, s'il n'a pas changé). S'il
    // ne se copie pas maintenant, il se copiera à la première écoute.
    try {
      const piano = await caches.open(CACHE_PIANO);
      const deja = new Set((await piano.keys()).map((r) => r.url));
      const manquants = PIANO_FICHIERS.map((f) => new URL(f, ICI).href).filter((u) => !deja.has(u));
      if (manquants.length) await piano.addAll(manquants.map((u) => new Request(u, { cache: "no-cache" })));
    } catch { /* hors ligne au mauvais moment : à la première écoute */ }
    // La nouvelle version prend la main tout de suite : la page ouverte
    // propose alors de recharger (app.js), elle ne se recharge pas seule.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Le nouveau cache est complet (sinon on n'en serait pas là) : les
    // anciens peuvent partir. Seulement ceux de Portée : le domaine
    // (adrienvada.fr) sert d'autres sites, qui ont peut-être les leurs.
    for (const cle of await caches.keys()) {
      if (cle.startsWith("portee-") && cle !== CACHE && cle !== CACHE_PIANO) await caches.delete(cle);
    }
    await self.clients.claim();
    // Chaque page ouverte apprend quelle version est là : celle qui n'est
    // pas de cette version propose de recharger.
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      client.postMessage({ type: "portee-version", version: VERSION });
    }
  })());
});

/** Une réponse du réseau, ou la copie quand il manque (ou que le serveur est en panne). */
async function reseauPuisCopie(requete, copie) {
  try {
    const r = await fetch(requete);
    if (r.status < 500) return r;
    return (await copie()) || r;
  } catch (erreur) {
    const garde = await copie();
    if (garde) return garde;
    throw erreur;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!url.href.startsWith(ICI)) return; // le connecteur, un autre site : le réseau, sans copie
  const versionne = url.searchParams.has("v");
  if (url.href.startsWith(ICI + "piano/")) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_PIANO);
      const garde = await cache.match(req);
      if (garde) return garde;
      const r = await fetch(req);
      if (r.ok) await cache.put(req, r.clone());
      return r;
    })());
  } else if (req.mode === "navigate") {
    // Une navigation ne se recopie pas avec des options : on la redemande par
    // son adresse, sans suivre une redirection (c'est au navigateur de le faire).
    const frais = new Request(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "manual" });
    e.respondWith(reseauPuisCopie(frais, () => caches.match(PAGE, { cacheName: CACHE })));
  } else if (versionne) {
    // Un fichier de cette version : la copie. D'une autre version : le réseau.
    e.respondWith((async () => (await caches.match(req, { cacheName: CACHE })) || fetch(req))());
  } else {
    e.respondWith(reseauPuisCopie(new Request(req, { cache: "no-cache" }), () => caches.match(req, { cacheName: CACHE })));
  }
});
