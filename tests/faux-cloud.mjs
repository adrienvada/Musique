/**
 * UN FAUX CLOUD REMARKABLE, POUR LES TESTS
 *
 * Il sert, avec le vrai protocole (racine, index, blobs repérés par leur
 * empreinte), un dossier « Partitions » qui contient un document écrit sur
 * un modèle Portée. Les traits du document sont ceux d'une vraie page
 * d'essai d'Adrien (tests/pages/), réencodés au format .rm v6 : on vérifie
 * ainsi toute la chaîne du connecteur, du cloud jusqu'à l'ABC.
 */
import crypto from "node:crypto";
import http from "node:http";
import { estJwt } from "../supabase/functions/portee-remarkable/supabase.js";

/** Écrit une page .rm v6 minimale : un bloc « ligne » par trait. */
export function ecrireRm(traits, outil = 4) {
  const morceaux = [Buffer.from("reMarkable .lines file, version=6          ", "latin1")];
  const varuint = (n) => {
    const o = [];
    do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n);
    return Buffer.from(o);
  };
  const tag = (index, type) => varuint((index << 4) | type);
  const id = (index, a, b) => Buffer.concat([tag(index, 0xf), Buffer.from([a]), varuint(b)]);
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  traits.forEach((pts, k) => {
    const points = Buffer.alloc(14 * pts.length);
    pts.forEach(([x, y], i) => {
      // Abscisse centrée et 227 unités par pouce, comme la tablette (voir rm.js).
      points.writeFloatLE((x - 702) * 227 / 226, 14 * i);
      points.writeFloatLE(y * 227 / 226, 14 * i + 4);
    });
    const ligne = Buffer.concat([
      tag(1, 0x4), u32(outil), tag(2, 0x4), u32(0),
      tag(3, 0x8), (() => { const b = Buffer.alloc(8); b.writeDoubleLE(1); return b; })(),
      tag(4, 0x4), (() => { const b = Buffer.alloc(4); b.writeFloatLE(0); return b; })(),
      tag(5, 0xc), u32(points.length), points,
    ]);
    const valeur = Buffer.concat([Buffer.from([3]), ligne]);
    const corps = Buffer.concat([
      id(1, 0, 11), id(2, 1, k + 100), id(3, 0, 0), id(4, 0, 0), tag(5, 0x4), u32(0),
      tag(6, 0xc), u32(valeur.length), valeur,
    ]);
    morceaux.push(u32(corps.length), Buffer.from([0, 2, 2, 0x05]), corps);
  });
  return Buffer.concat(morceaux);
}

const empreinte = (b) => crypto.createHash("sha256").update(b).digest("hex");

/**
 * Démarre le faux cloud. `document` : { id, nom, pdf (octets), pages: [traits] }
 * (une page `null` n'a pas de fichier .rm : elle est blanche).
 *
 * `options` (tests du durcissement) :
 *   - autres : d'autres documents, de la même forme ;
 *   - illisibles : ajoute deux documents que le cloud rend mal (index
 *     introuvable, fiche qui n'est pas du JSON) ;
 *   - pageCassee : le numéro (à partir de 1) d'une page dont le .rm est abîmé ;
 *   - sansRange : le cloud ignore l'en-tête Range (il envoie tout le blob) ;
 *   - lenteur : millisecondes d'attente avant chaque blob (pour compter les
 *     requêtes simultanées, `maxEnCours()`).
 * Et, sur l'objet rendu, `panne(motif, statut, { fois, entetes })` : les
 * `fois` prochaines requêtes dont l'adresse correspond reçoivent `statut`
 * (« coupure » : la connexion est coupée sans réponse).
 * @returns {Promise<{url, fermer, requetes, panne, revoquer, empreinteDe, maxEnCours}>}
 */
export async function demarrerFauxCloud(document, options = {}) {
  const { autres = [], illisibles = false, pageCassee = null, sansRange = false, lenteur = 0 } = options;
  let enCours = 0, maxEnCours = 0;
  const blobs = new Map();
  const noms = new Map(); // nom de fichier → empreinte
  const ajouter = (octets, nom = null) => { const h = empreinte(octets); blobs.set(h, octets); if (nom) noms.set(nom, h); return h; };
  const docs = [];
  const nouveau = (id, meta, fichiers) => {
    const fiche = Buffer.isBuffer(meta) ? meta : Buffer.from(JSON.stringify(meta));
    const entrees = [[`${id}.metadata`, fiche], ...fichiers];
    const lignes = entrees.map(([nom, o]) => `${ajouter(o, nom)}:0:${nom}:0:${o.length}`);
    const index = Buffer.from(["3", ...lignes].join("\n") + "\n");
    docs.push(`${ajouter(index)}:80000000:${id}:${entrees.length}:0`);
  };
  nouveau("dossier-partitions", { visibleName: "Partitions", type: "CollectionType", parent: "" }, []);
  nouveau("dans-la-corbeille", { visibleName: "Vieux brouillon", type: "DocumentType", parent: "trash" }, []);
  for (const doc of [document, ...autres]) {
    const idsPages = doc.pages.map((_, i) => `page-${i + 1}`);
    const contenu = { fileType: "pdf", cPages: { pages: idsPages.map((p, i) => ({ id: p, idx: { value: "b" + String.fromCharCode(97 + i) }, redir: { value: i } })) } };
    nouveau(doc.id, { visibleName: doc.nom, type: "DocumentType", parent: "dossier-partitions", lastModified: "1790000000000" }, [
      [`${doc.id}.content`, Buffer.from(JSON.stringify(contenu))],
      ...(doc.pdf ? [[`${doc.id}.pdf`, doc.pdf]] : []),
      ...doc.pages
        .map((t, i) => [`${doc.id}/${idsPages[i]}.rm`, doc === document && pageCassee === i + 1 ? Buffer.from("pas une page .rm") : t && ecrireRm(t)])
        .filter(([, o]) => o),
    ]);
  }
  if (illisibles) {
    docs.push(`${"f".repeat(64)}:80000000:doc-sans-index:2:0`); // index absent : le cloud répond 404
    nouveau("doc-fiche-abimee", Buffer.from("{pas du json"), []);
  }
  const racine = ajouter(Buffer.from(["4", `0:.:${docs.length}:0`, ...docs].join("\n") + "\n"));

  const requetes = [];
  const pannes = [];
  const etat = { revoque: false };
  const serveur = http.createServer(async (req, res) => {
    res.on("error", () => {}); // un client qui coupe en route (lecture partielle) n'est pas une erreur
    requetes.push(`${req.method} ${req.url}${req.headers.range ? ` [${req.headers.range}]` : ""}`);
    const panne = pannes.find((p) => p.fois > 0 && p.motif.test(req.url));
    if (panne) {
      panne.fois--;
      if (panne.statut === "coupure") { req.socket.destroy(); return; }
      res.writeHead(panne.statut, panne.entetes); res.end(); return;
    }
    const auth = req.headers.authorization || "";
    if (req.url === "/token/json/2/device/new") {
      const { code } = JSON.parse(await lireCorps(req));
      if (code !== "abcdefgh") { res.writeHead(400); res.end(); return; }
      etat.revoque = false;
      res.end("jeton-appareil-de-test"); return;
    }
    if (req.url === "/token/json/2/user/new") {
      if (auth !== "Bearer jeton-appareil-de-test" || etat.revoque) { res.writeHead(401); res.end(); return; }
      res.end("jeton-utilisateur-de-test"); return;
    }
    if (auth !== "Bearer jeton-utilisateur-de-test") { res.writeHead(401); res.end(); return; }
    if (req.url === "/sync/v4/root") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ hash: racine, generation: 1, schemaVersion: 4 })); return; }
    const m = req.url.match(/^\/sync\/v3\/files\/([0-9a-f]{64})$/);
    if (m && blobs.has(m[1])) {
      enCours++;
      maxEnCours = Math.max(maxEnCours, enCours);
      if (lenteur) await new Promise((ok) => setTimeout(ok, lenteur));
      enCours--;
      const octets = blobs.get(m[1]);
      const r = !sansRange && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (r) {
        // bytes=a-b, bytes=a- ou bytes=-n (les n derniers), comme un vrai serveur.
        const debut = r[1] === "" ? Math.max(0, octets.length - Number(r[2])) : Number(r[1]);
        const fin = r[1] === "" || r[2] === "" ? octets.length - 1 : Math.min(Number(r[2]), octets.length - 1);
        if (debut >= octets.length) { res.writeHead(416, { "content-range": `bytes */${octets.length}` }); res.end(); return; }
        res.writeHead(206, { "content-range": `bytes ${debut}-${fin}/${octets.length}`, "content-length": fin - debut + 1 });
        res.end(octets.subarray(debut, fin + 1));
        return;
      }
      res.end(octets);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${serveur.address().port}`;
  return {
    url, requetes,
    revoquer: () => { etat.revoque = true; },
    panne: (motif, statut, { fois = 1, entetes = {} } = {}) => { pannes.push({ motif, statut, fois, entetes }); },
    /** L'empreinte d'un fichier du cloud, par son nom (« doc.pdf »). */
    empreinteDe: (nom) => noms.get(nom),
    maxEnCours: () => maxEnCours,
    fermer: () => new Promise((r) => { serveur.closeAllConnections?.(); serveur.close(r); }),
  };
}

const lireCorps = (req) => new Promise((ok) => {
  const morceaux = [];
  req.on("data", (m) => morceaux.push(m));
  req.on("end", () => ok(Buffer.concat(morceaux).toString()));
});

/**
 * Un faux stockage Supabase : créer un compartiment, y ranger, relire,
 * supprimer et lister des objets, avec les réponses du vrai (400
 * « introuvable », 409…) et une date d'écriture par objet (updated_at).
 *
 * Un compartiment a ses réglages, comme le vrai : sa taille maximale par
 * objet (`file_size_limit`, `limite` ici) et ses types permis
 * (`allowed_mime_types`, `types`), posés à sa création ou redits par
 * `PUT /storage/v1/bucket/<id>`. Un objet qui les dépasse est refusé, avec
 * les réponses du vrai (« Payload too large », « invalid_mime_type »).
 *
 * Il contrôle la clé comme la plateforme : toujours dans `apikey` ; une clé
 * secrète (`sb_secret_…`, pas un JWT) glissée dans `Authorization: Bearer`
 * reçoit « Invalid JWT » ; l'ancienne clé (un JWT) doit voyager dans les
 * deux en-têtes, comme le connecteur l'a toujours envoyée.
 *
 * `requetes` : « MÉTHODE /chemin » de chaque requête (sans la clé, qui
 * voyage en en-tête). `panne(motif, statut, { fois })` : les `fois`
 * prochaines requêtes dont « MÉTHODE /chemin » correspond reçoivent
 * `statut` (« coupure » : la connexion est coupée sans réponse).
 */
export async function demarrerFauxStockage(cle = "cle-de-service-de-test") {
  const compartiments = new Map();
  const requetes = [];
  const pannes = [];
  let derniere = 0;
  const maintenant = () => { derniere = Math.max(Date.now(), derniere + 1); return new Date(derniere).toISOString(); };
  const refus = (req) => {
    if (req.headers.apikey !== cle) return [403, { statusCode: "403", error: "Unauthorized" }];
    const auth = req.headers.authorization;
    if (auth === undefined) return estJwt(cle) ? [403, { statusCode: "403", error: "Unauthorized" }] : null;
    const jeton = auth.replace(/^Bearer\s+/i, "");
    if (!estJwt(jeton)) return [401, { message: "Invalid JWT" }];
    return jeton === cle ? null : [403, { statusCode: "403", error: "Unauthorized" }];
  };
  const serveur = http.createServer(async (req, res) => {
    const json = (statut, corps) => { res.writeHead(statut, { "content-type": "application/json" }); res.end(JSON.stringify(corps)); };
    requetes.push(`${req.method} ${req.url}`);
    const panne = pannes.find((p) => p.fois > 0 && p.motif.test(`${req.method} ${req.url}`));
    if (panne) {
      panne.fois--;
      if (panne.statut === "coupure") { req.socket.destroy(); return; }
      return json(panne.statut, { statusCode: String(panne.statut), error: "Panne de test" });
    }
    const refuse = refus(req);
    if (refuse) return json(...refuse);
    const corps = await lireCorps(req);
    if (req.method === "POST" && req.url === "/storage/v1/bucket") {
      const { id, public: publique, file_size_limit: limite = null, allowed_mime_types: types = null } = JSON.parse(corps);
      if (compartiments.has(id)) return json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      compartiments.set(id, { publique, limite, types, objets: new Map() });
      return json(200, { name: id });
    }
    const reglage = req.url.match(/^\/storage\/v1\/bucket\/([^/]+)$/);
    if (reglage && req.method === "PUT") {
      const c = compartiments.get(reglage[1]);
      if (!c) return json(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
      // Comme le vrai : un réglage absent du corps reste tel quel.
      const r = JSON.parse(corps);
      if ("public" in r) c.publique = r.public;
      if ("file_size_limit" in r) c.limite = r.file_size_limit;
      if ("allowed_mime_types" in r) c.types = r.allowed_mime_types;
      return json(200, { message: "Successfully updated" });
    }
    const liste = req.url.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);
    if (liste && req.method === "POST") {
      const c = compartiments.get(liste[1]);
      if (!c) return json(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
      const { prefix = "", limit = 100, offset = 0 } = JSON.parse(corps);
      const dossier = prefix ? prefix.replace(/\/$/, "") + "/" : "";
      const vus = new Map();
      for (const [chemin, o] of c.objets) {
        if (!chemin.startsWith(dossier)) continue;
        const reste = chemin.slice(dossier.length);
        const i = reste.indexOf("/");
        if (i >= 0) vus.set(reste.slice(0, i), { name: reste.slice(0, i), id: null, updated_at: null, metadata: null });
        else vus.set(reste, { name: reste, id: `id-${chemin}`, updated_at: o.maj, created_at: o.cree, metadata: { size: o.corps.length } });
      }
      return json(200, [...vus.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit));
    }
    const m = req.url.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    const c = m && compartiments.get(m[1]);
    if (!c) return json(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    if (req.method === "POST") {
      if (c.limite !== null && Buffer.byteLength(corps) > c.limite) return json(400, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
      const type = String(req.headers["content-type"] || "").split(";")[0].trim();
      if (c.types && !c.types.includes(type)) return json(400, { statusCode: "415", error: "invalid_mime_type", message: `mime type ${type} is not supported` });
      if (c.objets.has(m[2]) && req.headers["x-upsert"] !== "true") return json(400, { statusCode: "409", error: "Duplicate" });
      const avant = c.objets.get(m[2]);
      c.objets.set(m[2], { corps, maj: maintenant(), cree: avant ? avant.cree : new Date(derniere).toISOString() });
      return json(200, { Key: `${m[1]}/${m[2]}` });
    }
    if (req.method === "DELETE") {
      if (!c.objets.delete(m[2])) return json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      return json(200, { message: "Successfully deleted" });
    }
    if (!c.objets.has(m[2])) return json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    res.end(c.objets.get(m[2]).corps);
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${serveur.address().port}`, cle, compartiments, requetes,
    // Pour les tests : le contenu brut d'un objet (texte), ou undefined.
    objet: (compartiment, chemin) => compartiments.get(compartiment)?.objets.get(chemin)?.corps,
    panne: (motif, statut, { fois = 1 } = {}) => { pannes.push({ motif, statut, fois }); },
    fermer: () => new Promise((r) => serveur.close(r)),
  };
}
