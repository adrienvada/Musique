/**
 * UN SERVEUR QUI SERT COMME GITHUB PAGES
 *
 * Il sert un dossier sous /Musique/, avec ce que Pages fait et qui compte
 * pour Portée : `Cache-Control: max-age=600` sur tout (la cause du mélange
 * de versions du 02/10), une empreinte (ETag) et le 304 qui va avec (ce que
 * le service worker obtient quand il redemande un fichier qui n'a pas
 * changé), la redirection de /Musique vers /Musique/, et l'adresse qui
 * ignore ce qui suit le « ? » (app.js?v=… rend le app.js du moment).
 *
 * Pour les essais, on peut changer de dossier en cours de route (une mise en
 * ligne), couper le serveur (hors ligne : chaque connexion tombe, comme
 * quand le réseau manque), le ralentir (un réseau qui traîne) ou faire
 * répondre une erreur à une adresse (un portail Wi-Fi, une panne passagère).
 * C'est au serveur qu'on coupe ou ralentit le réseau : ni
 * `context.setOffline` ni le bridage de Chromium ne touchent les requêtes
 * du service worker.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".mp3": "audio/mpeg", ".pdf": "application/pdf", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * @param {{ dossier: string, prefixe?: string, habiller?: (html: string) => string }} options
 *   `habiller` réécrit la page avant de l'envoyer (la version claude.ai
 *   l'enveloppe dans un document, comme le fait claude.ai).
 */
export async function servir({ dossier, prefixe = "/Musique/", habiller = null }) {
  const etat = {
    dossier,
    horsLigne: false,
    /** ms d'attente avant chaque réponse (0 : tout de suite) */
    lenteur: 0,
    /** chemin (sans le préfixe) → statut à répondre à la place du fichier */
    pannes: new Map(),
    /** les adresses demandées, pour vérifier ce qui passe par le réseau */
    demandes: [],
  };
  const connexions = new Set();
  const serveur = http.createServer((req, res) => {
    if (etat.horsLigne) { req.socket.destroy(); return; }
    // Un réseau qui traîne (« lie-fi ») : chaque réponse attend `lenteur` ms.
    if (etat.lenteur) { setTimeout(() => repondre(req, res), etat.lenteur); return; }
    repondre(req, res);
  });
  function repondre(req, res) {
    if (etat.horsLigne) { req.socket.destroy(); return; }
    const u = new URL(req.url, "http://portee.test");
    etat.demandes.push(u.pathname + u.search);
    if (u.pathname === prefixe.slice(0, -1)) { res.writeHead(301, { location: prefixe }); res.end(); return; }
    if (!u.pathname.startsWith(prefixe)) { res.writeHead(404); res.end(); return; }
    const relatif = decodeURIComponent(u.pathname.slice(prefixe.length)) || "index.html";
    const panne = etat.pannes.get(relatif);
    if (panne) { res.writeHead(panne, { "content-type": "text/html; charset=utf-8" }); res.end("<h1>Portail Wi-Fi ou panne passagère</h1>"); return; }
    const base = path.resolve(etat.dossier);
    let f = path.resolve(base, relatif);
    if (!f.startsWith(base + path.sep)) { res.writeHead(404); res.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) { res.writeHead(404, { "content-type": "text/html; charset=utf-8" }); res.end("<h1>404</h1>"); return; }
    let corps = fs.readFileSync(f);
    if (habiller && f.endsWith(".html")) corps = Buffer.from(habiller(corps.toString("utf8")));
    const etag = `"${crypto.createHash("sha1").update(corps).digest("hex")}"`;
    const entetes = { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "max-age=600", etag };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, entetes); res.end(); return; }
    res.writeHead(200, { ...entetes, "content-length": corps.length });
    res.end(req.method === "HEAD" ? undefined : corps);
  }
  serveur.on("connection", (s) => { connexions.add(s); s.on("close", () => connexions.delete(s)); });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const origine = `http://127.0.0.1:${serveur.address().port}`;
  return {
    etat,
    origine,
    url: origine + prefixe,
    /** Coupe ou rétablit le « réseau » : les connexions ouvertes tombent aussi. */
    reseau(present) {
      etat.horsLigne = !present;
      if (!present) for (const s of connexions) s.destroy();
    },
    /** Une mise en ligne : le site servi devient celui de `dossier`. */
    mettreEnLigne(dossier) { etat.dossier = dossier; },
    /** Chaque réponse attendra `ms` millisecondes (0 : plus d'attente). */
    ralentir(ms) { etat.lenteur = ms; },
    fermer: () => new Promise((ok) => { for (const s of connexions) s.destroy(); serveur.close(() => ok()); }),
  };
}
