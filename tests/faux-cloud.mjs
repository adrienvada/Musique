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
      points.writeFloatLE(x - 702, 14 * i);   // abscisse centrée, comme la tablette
      points.writeFloatLE(y, 14 * i + 4);
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
 * Démarre le faux cloud. `document` : { id, nom, pdf (octets), pages: [traits] }.
 * @returns {Promise<{url, fermer, requetes}>}
 */
export async function demarrerFauxCloud(document) {
  const blobs = new Map();
  const ajouter = (octets) => { const h = empreinte(octets); blobs.set(h, octets); return h; };
  const docs = [];
  const nouveau = (id, meta, fichiers) => {
    const entrees = [[`${id}.metadata`, Buffer.from(JSON.stringify(meta))], ...fichiers];
    const lignes = entrees.map(([nom, o]) => `${ajouter(o)}:0:${nom}:0:${o.length}`);
    const index = Buffer.from(["3", ...lignes].join("\n") + "\n");
    docs.push(`${ajouter(index)}:80000000:${id}:${entrees.length}:0`);
  };
  nouveau("dossier-partitions", { visibleName: "Partitions", type: "CollectionType", parent: "" }, []);
  nouveau("dans-la-corbeille", { visibleName: "Vieux brouillon", type: "DocumentType", parent: "trash" }, []);
  const idsPages = document.pages.map((_, i) => `page-${i + 1}`);
  const contenu = { fileType: "pdf", cPages: { pages: idsPages.map((p, i) => ({ id: p, idx: { value: "b" + String.fromCharCode(97 + i) }, redir: { value: i } })) } };
  nouveau(document.id, { visibleName: document.nom, type: "DocumentType", parent: "dossier-partitions", lastModified: "1790000000000" }, [
    [`${document.id}.content`, Buffer.from(JSON.stringify(contenu))],
    [`${document.id}.pdf`, document.pdf],
    ...document.pages.map((t, i) => [`${document.id}/${idsPages[i]}.rm`, ecrireRm(t)]),
  ]);
  const racine = ajouter(Buffer.from(["4", `0:.:${docs.length}:0`, ...docs].join("\n") + "\n"));

  const requetes = [];
  const etat = { revoque: false };
  const serveur = http.createServer(async (req, res) => {
    requetes.push(`${req.method} ${req.url}`);
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
    if (m && blobs.has(m[1])) { res.end(blobs.get(m[1])); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${serveur.address().port}`;
  return {
    url, requetes,
    revoquer: () => { etat.revoque = true; },
    fermer: () => new Promise((r) => serveur.close(r)),
  };
}

const lireCorps = (req) => new Promise((ok) => {
  const morceaux = [];
  req.on("data", (m) => morceaux.push(m));
  req.on("end", () => ok(Buffer.concat(morceaux).toString()));
});

/**
 * Un faux stockage Supabase : de quoi créer un compartiment et y ranger ou
 * relire un objet, avec les réponses du vrai (400 « introuvable », 409…).
 */
export async function demarrerFauxStockage(cle = "cle-de-service-de-test") {
  const compartiments = new Map();
  const serveur = http.createServer(async (req, res) => {
    const json = (statut, corps) => { res.writeHead(statut, { "content-type": "application/json" }); res.end(JSON.stringify(corps)); };
    if (req.headers.apikey !== cle || req.headers.authorization !== `Bearer ${cle}`) return json(403, { statusCode: "403", error: "Unauthorized" });
    const corps = await lireCorps(req);
    if (req.method === "POST" && req.url === "/storage/v1/bucket") {
      const { id, public: publique } = JSON.parse(corps);
      if (compartiments.has(id)) return json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      compartiments.set(id, { publique, objets: new Map() });
      return json(200, { name: id });
    }
    const m = req.url.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    const c = m && compartiments.get(m[1]);
    if (!c) return json(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    if (req.method === "POST") {
      if (c.objets.has(m[2]) && req.headers["x-upsert"] !== "true") return json(400, { statusCode: "409", error: "Duplicate" });
      c.objets.set(m[2], corps);
      return json(200, { Key: `${m[1]}/${m[2]}` });
    }
    if (!c.objets.has(m[2])) return json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    res.end(c.objets.get(m[2]));
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${serveur.address().port}`, cle, compartiments,
    fermer: () => new Promise((r) => serveur.close(r)),
  };
}
