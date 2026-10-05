/**
 * PORTÉE HORS LIGNE (site GitHub Pages seulement)
 *
 * Toute l'appli est gardée dès la première visite. À l'installation, le
 * service worker copie la coquille entière (la page, ses modules, ses
 * feuilles de style, abcjs, les polices, les modèles, les pages d'essai,
 * les icônes) ; une fois l'appli ouverte, il copie en tâche de fond ce qui
 * est lourd et ne sert pas au démarrage : pdf.js (pour importer un PDF) et
 * le piano. L'assembleur (outils/assembler-appli.mjs) écrit ici la liste
 * exacte des fichiers de la version, et l'empreinte du piano.
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
 *  - un fichier dont l'adresse porte sa version (`?v=…`) ne change jamais :
 *    il vient de la copie d'abord, et passe d'une version à l'autre sans
 *    être retéléchargé (pdf.js, abcjs, les polices ne changent qu'avec leur
 *    paquet) ;
 *  - le piano a son propre cache, nommé d'après l'empreinte de ses
 *    fichiers : il ne se retélécharge que s'il change, et s'il change,
 *    l'ancien part (avant, il n'était jamais remplacé).
 *
 * La page, elle, et les quelques fichiers sans version (modèles, icônes)
 * sont toujours redemandés au serveur (`no-cache` : un aller-retour court,
 * rien de retéléchargé s'ils n'ont pas changé) : la page est toujours la
 * dernière, et ses modules suivent (décision du 02/10, le mélange de
 * versions après une mise en ligne). Mais on n'attend le serveur que deux
 * secondes et demie : au-delà, ou s'il manque, ou s'il est en panne, c'est
 * la copie. Sur un réseau qui traîne (8 s par réponse), l'appli mettait
 * 40 s à s'ouvrir alors que tout était là.
 *
 * La copie de la page n'est jamais remplacée en route : c'est celle de
 * l'installation, qui va avec les modules copiés en même temps. Une page
 * plus récente servie par le réseau n'y entre pas (ses modules n'y sont
 * pas, elle ne marcherait pas hors ligne) ; elle y entrera avec sa version.
 *
 * Le connecteur reMarkable (Supabase) n'est jamais mis en cache, ni rien
 * d'un autre domaine.
 *
 * Il reçoit aussi un fichier partagé vers l'appli installée (Android,
 * `share_target`) : voir recevoirPartage, plus bas.
 */

// Remplis par l'assembleur : sw.js n'existe que dans le site assemblé.
const VERSION = "__VERSION__";
const COQUILLE = ["__COQUILLE__"];
const EN_FOND = ["__EN_FOND__"];
const PIANO = "__PIANO__";
const PIANO_FICHIERS = ["__PIANO_FICHIERS__"];

const CACHE = `portee-${VERSION}`;
const CACHE_PIANO = `portee-piano-${PIANO}`;
// Un fichier partagé vers Portée, le temps que la page le prenne (import-pdf.js, CACHE_PARTAGE).
const CACHE_PARTAGE = "portee-partage";
const ICI = new URL("./", self.location).href;
const PAGE = ICI;
// Le temps qu'on laisse au serveur avant de servir la copie.
const DELAI = 2500;

const adresse = (f) => new URL(f, ICI).href;
const versionnee = (url) => new URL(url).searchParams.has("v");

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      // Ce qui porte sa version et que la version d'avant gardait déjà
      // passe d'un cache à l'autre sans le réseau ; le reste de la coquille
      // se télécharge (ce qui est en tâche de fond attendra la page).
      const enFond = new Set(EN_FOND.map(adresse));
      const aTelecharger = [];
      for (const url of [...COQUILLE.map(adresse), ...enFond]) {
        const deja = versionnee(url) ? await caches.match(url) : null;
        if (deja) await cache.put(url, deja);
        else if (!enFond.has(url)) aTelecharger.push(url);
      }
      await cache.addAll(aTelecharger.map((u) => new Request(u, { cache: "no-cache" })));
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
    // Un fichier partagé qui attend la page n'est pas d'une version : il reste.
    for (const cle of await caches.keys()) {
      if (cle.startsWith("portee-") && cle !== CACHE && cle !== CACHE_PIANO && cle !== CACHE_PARTAGE) await caches.delete(cle);
    }
    await self.clients.claim();
    // Chaque page ouverte apprend quelle version est là : celle qui n'est
    // pas de cette version propose de recharger.
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      client.postMessage({ type: "portee-version", version: VERSION });
    }
  })());
});

/**
 * En tâche de fond, quand la page le demande (une fois ouverte) : ce qui
 * manque encore de pdf.js et du piano, un fichier après l'autre pour ne pas
 * prendre le réseau à l'appli. Interrompu, ça reprendra à la visite suivante.
 */
async function copierEnFond() {
  for (const [nom, liste] of [[CACHE, EN_FOND], [CACHE_PIANO, PIANO_FICHIERS]]) {
    const cache = await caches.open(nom);
    for (const url of liste.map(adresse)) {
      if (await cache.match(url)) continue;
      const r = await fetch(new Request(url, { cache: "no-cache" })).catch(() => null);
      if (!r || !r.ok) return; // le réseau manque : la prochaine fois
      await cache.put(url, r);
    }
  }
}

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "portee-precharger") e.waitUntil(copierEnFond());
});

/**
 * Le réseau d'abord, mais pas plus de DELAI : au-delà (ou s'il manque, ou
 * si le serveur est en panne), la copie. Sans copie, on attend le réseau.
 */
async function reseauOuCopie(requete, copie) {
  const reseau = fetch(requete);
  reseau.catch(() => {}); // une réponse arrivée trop tard, ou une erreur après la copie : sans suite
  let r = null;
  try {
    r = await Promise.race([reseau, new Promise((ok) => setTimeout(ok, DELAI, null))]);
  } catch { /* le réseau manque */ }
  if (r && r.status < 500) return r;
  const garde = await copie();
  if (garde) return garde;
  return r || reseau;
}

/**
 * Un fichier partagé vers Portée (Android : l'appli reMarkable ou Fichiers →
 * Partager → Portée ; audit du 04/10, I4). Le système l'envoie en POST à
 * `./?partage` (share_target, manifeste) : un site statique ne saurait pas le
 * recevoir. Le service worker le garde dans un cache à part, le temps que la
 * page le prenne, puis la rouvre (303 : la même adresse, en GET) ; la page
 * l'importe comme un PDF choisi (import-pdf.js). Il ne va nulle part ailleurs.
 */
async function recevoirPartage(requete) {
  try {
    const donnees = await requete.formData();
    const cache = await caches.open(CACHE_PARTAGE);
    let n = 0;
    for (const f of donnees.getAll("fichiers")) {
      if (typeof f === "string") continue;
      const entetes = { "content-type": f.type || "application/octet-stream", "x-portee-nom": encodeURIComponent(f.name || "partage.pdf") };
      await cache.put(new Request(`${ICI}partage/${Date.now()}-${n++}`), new Response(f, { headers: entetes }));
    }
  } catch { /* un envoi illisible : la page s'ouvre quand même, et le dit */ }
  return Response.redirect(`${ICI}?partage`, 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method === "POST" && req.url.startsWith(ICI) && new URL(req.url).searchParams.has("partage")) {
    e.respondWith(recevoirPartage(req));
    return;
  }
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!url.href.startsWith(ICI)) return; // le connecteur, un autre site : le réseau, sans copie
  if (url.href.startsWith(ICI + "piano/")) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_PIANO);
      const garde = await cache.match(req);
      if (garde) return garde;
      // Revalidé : un échantillon resté dans le cache du navigateur pourrait
      // être celui d'avant, s'il a changé.
      const r = await fetch(new Request(req, { cache: "no-cache" }));
      if (r.ok) await cache.put(req, r.clone());
      return r;
    })());
  } else if (req.mode === "navigate") {
    // Une navigation ne se recopie pas avec des options : on la redemande par
    // son adresse, sans suivre une redirection (c'est au navigateur de le faire).
    const frais = new Request(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "manual" });
    e.respondWith(reseauOuCopie(frais, () => caches.match(PAGE, { cacheName: CACHE })));
  } else if (versionnee(req.url)) {
    // Une adresse qui porte sa version : la copie d'abord. Pas dans la copie
    // (une autre version que celle-ci) : le réseau.
    e.respondWith((async () => (await caches.match(req, { cacheName: CACHE })) || fetch(req))());
  } else {
    e.respondWith(reseauOuCopie(new Request(req, { cache: "no-cache" }), () => caches.match(req, { cacheName: CACHE })));
  }
});
