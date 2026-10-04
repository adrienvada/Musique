/**
 * La lecture de la tablette, durcie (C3) : nouveaux essais sur 429 et 5xx,
 * six requêtes à la fois, documents et pages illisibles signalés à part,
 * hôte de synchro réglable avec repli, sujet du PDF lu sans tout le PDF,
 * document par pages.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { attenteAvant, CloudRemarkable, ESSAIS, hoteDeSynchro, SYNC_SECOURS } from "../supabase/functions/portee-remarkable/remarkable.js";
import { coffreMemoire } from "../supabase/functions/portee-remarkable/coffre.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { demarrerFauxCloud } from "./faux-cloud.mjs";

const MODELE = fs.readFileSync("modeles/melodie-standard.pdf");
const page = (n) => [[[100 + n, 200], [110 + n, 210], [120 + n, 230]], [[300, 400 + n], [305, 450 + n]]];
const doc = (pages, extra = {}) => ({ id: "doc", nom: "Essai", pdf: MODELE, pages, ...extra });

/** Un client du faux cloud qui n'attend pas pour de vrai (il note les attentes). */
function client(faux, hotes = {}) {
  const attentes = [];
  const c = new CloudRemarkable(coffreMemoire("jeton-appareil-de-test"), { auth: faux.url, sync: faux.url, ...hotes }, { attendre: async (ms) => { attentes.push(ms); }, alea: () => 0 });
  return { c, attentes };
}
const outil = (c, name, args = {}) => traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c).then((r) => r.result);
const compter = (faux, motif) => faux.requetes.filter((r) => motif.test(r)).length;

test("l'attente avant un nouvel essai double, avec du hasard, ou suit Retry-After", () => {
  // Sans Retry-After : entre la moitié et le tout de 500 ms, 1 s, 2 s…, plafonné à 8 s.
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => attenteAvant(n, null, () => 0)), [250, 500, 1000, 2000, 4000, 4000]);
  assert.deepEqual([1, 2, 3].map((n) => attenteAvant(n, null, () => 1)), [500, 1000, 2000]);
  // Retry-After en secondes, ou en date ; plafonné à 30 s (claude.ai coupe un appel à 240 s).
  assert.equal(attenteAvant(1, "2"), 2000);
  assert.equal(attenteAvant(1, "3600"), 30000);
  assert.equal(attenteAvant(1, new Date(Date.now() - 60000).toUTCString()), 0);
  const plusTard = attenteAvant(1, new Date(Date.now() + 5000).toUTCString());
  assert.ok(plusTard > 3000 && plusTard <= 5000, String(plusTard));
  assert.equal(attenteAvant(1, "n'importe quoi", () => 0), 250);
});

test("un 429 ou un 5xx se retente, quatre essais au plus", async () => {
  const faux = await demarrerFauxCloud(doc([page(1)]));
  try {
    // 429 avec Retry-After sur la racine : deux attentes de 2 s, puis la réponse.
    let { c, attentes } = client(faux);
    faux.panne(/^\/sync\/v4\/root$/, 429, { fois: 2, entetes: { "retry-after": "2" } });
    assert.deepEqual((await c.arborescence()).noeuds.map((n) => n.nom).sort(), ["Essai", "Partitions"]);
    assert.deepEqual(attentes, [2000, 2000]);
    // 503 sans Retry-After sur un blob : des attentes qui doublent.
    ({ c, attentes } = client(faux));
    faux.panne(/^\/sync\/v3\/files\//, 503, { fois: 3 });
    assert.equal((await c.document("doc")).pages.length, 1);
    assert.deepEqual(attentes, [250, 500, 1000]);
    // Le jeton d'utilisateur aussi.
    ({ c, attentes } = client(faux));
    faux.panne(/^\/token\/json\/2\/user\/new$/, 502, { fois: 1 });
    assert.equal((await c.arborescence()).noeuds.length, 2);
    assert.deepEqual(attentes, [250]);
    // Toujours 429 : quatre essais, pas un de plus, puis une erreur lisible.
    ({ c, attentes } = client(faux));
    const avant = compter(faux, /\/sync\/v4\/root/);
    faux.panne(/^\/sync\/v4\/root$/, 429, { fois: 10 });
    await assert.rejects(c.arborescence(), /HTTP 429/);
    assert.equal(compter(faux, /\/sync\/v4\/root/) - avant, ESSAIS);
    assert.equal(attentes.length, ESSAIS - 1);
  } finally {
    await faux.fermer();
  }
});

test("six requêtes à la fois au plus", async () => {
  const autres = Array.from({ length: 20 }, (_, i) => ({ id: `doc-${i}`, nom: `Page ${i}`, pdf: null, pages: [page(i)] }));
  const faux = await demarrerFauxCloud(doc([page(1)]), { autres, lenteur: 15 });
  try {
    const { c } = client(faux);
    assert.equal((await c.arborescence()).noeuds.length, 22);
    assert.ok(faux.maxEnCours() <= 6, `au plus 6, vu ${faux.maxEnCours()}`);
    assert.ok(faux.maxEnCours() >= 2, "toujours en parallèle");
  } finally {
    await faux.fermer();
  }
});

test("un document illisible ne fait plus tomber l'arborescence", async () => {
  const faux = await demarrerFauxCloud(doc([page(1)]), { illisibles: true });
  try {
    const { c } = client(faux);
    const r = await outil(c, "arborescence");
    assert.equal(r.isError, undefined);
    assert.equal(r.structuredContent.connectee, true);
    assert.deepEqual(r.structuredContent.noeuds.map((n) => n.nom).sort(), ["Essai", "Partitions"]);
    const illisibles = r.structuredContent.illisibles.sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(illisibles.map((x) => x.id), ["doc-fiche-abimee", "doc-sans-index"]);
    assert.match(illisibles[1].raison, /HTTP 404/);
    // Un document lu une fois reste en mémoire ; l'illisible est retenté la fois suivante.
    const avant = faux.requetes.length;
    await c.arborescence();
    assert.ok(faux.requetes.slice(avant).some((x) => x.includes("f".repeat(64))));
  } finally {
    await faux.fermer();
  }
});

test("une page illisible n'empêche pas les autres", async () => {
  const faux = await demarrerFauxCloud(doc([page(1), page(2), page(3)]), { pageCassee: 2 });
  try {
    const { c } = client(faux);
    const r = await outil(c, "document", { id: "doc" });
    assert.equal(r.isError, undefined);
    assert.deepEqual(r.structuredContent.pages.map((p) => p.numero), [1, 3]);
    assert.equal(r.structuredContent.pagesIllisibles.length, 1);
    assert.equal(r.structuredContent.pagesIllisibles[0].numero, 2);
    assert.match(r.structuredContent.pagesIllisibles[0].raison, /\.rm v6/);
    assert.match(r.content[0].text, /illisibles : 2/);
  } finally {
    await faux.fermer();
  }
});

test("document : toutes les pages sans paramètre, ou celles qu'on demande", async () => {
  // Cinq pages, dont la troisième blanche (pas de .rm).
  const faux = await demarrerFauxCloud(doc([page(1), page(2), null, page(4), page(5)]));
  try {
    const { c } = client(faux);
    const tout = (await outil(c, "document", { id: "doc" })).structuredContent;
    assert.deepEqual(tout.pages.map((p) => p.numero), [1, 2, 4, 5]); // l'appli en dépend
    assert.equal(tout.nombrePages, 5);
    assert.deepEqual(tout.pagesEcrites, [1, 2, 4, 5]);
    assert.deepEqual(tout.pagesRestantes, []);
    assert.equal(tout.modele, "melodie-standard");
    assert.deepEqual((await outil(c, "document", { id: "doc", pages: [4, 2] })).structuredContent.pages.map((p) => p.numero), [2, 4]);
    assert.deepEqual((await outil(c, "document", { id: "doc", pages: { de: 2, a: 4 } })).structuredContent.pages.map((p) => p.numero), [2, 4]);
    assert.deepEqual((await outil(c, "document", { id: "doc", pages: { de: 5 } })).structuredContent.pages.map((p) => p.numero), [5]);
    // Des pages mal dites : une erreur que Claude peut corriger.
    for (const pages of [[0], [1.5], [], { de: 3, a: 2 }, { de: 1, jusqua: 2 }, "1-3"]) {
      const r = await outil(c, "document", { id: "doc", pages });
      assert.equal(r.isError, true, JSON.stringify(pages));
      assert.match(r.content[0].text, /pages/);
    }
    const loin = await outil(c, "document", { id: "doc", pages: { de: 9 } });
    assert.equal(loin.isError, true);
    assert.match(loin.content[0].text, /que 5 pages/);
  } finally {
    await faux.fermer();
  }
});

test("document par pages : la réponse reste sous 150 000 caractères", async () => {
  // Quatre pages denses (environ 60 000 caractères chacune une fois compactées).
  const dense = (n) => Array.from({ length: 120 }, (_, i) => Array.from({ length: 50 }, (_, k) => [100 + ((i * 7 + k * 13 + n) % 1200), 150 + ((i * 11 + k * 3) % 1700)]));
  const faux = await demarrerFauxCloud(doc([dense(1), dense(2), dense(3), dense(4)]));
  try {
    const { c } = client(faux);
    const r = await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "document", arguments: { id: "doc", pages: [1, 2, 3, 4] } } }, c);
    const d = r.result.structuredContent;
    assert.ok(JSON.stringify(r).length < 150000, `${JSON.stringify(r).length} caractères`);
    assert.ok(d.pages.length >= 1 && d.pages.length < 4);
    assert.deepEqual([...d.pages.map((p) => p.numero), ...d.pagesRestantes], [1, 2, 3, 4]);
    assert.match(r.result.content[0].text, /à demander ensuite/);
    // La suite, demandée ensuite.
    const suite = (await outil(c, "document", { id: "doc", pages: d.pagesRestantes })).structuredContent;
    assert.equal(suite.pages[0].numero, d.pagesRestantes[0]);
    // Sans paramètre : tout, comme l'appli l'attend.
    assert.equal((await outil(c, "document", { id: "doc" })).structuredContent.pages.length, 4);
  } finally {
    await faux.fermer();
  }
});

test("le sujet du PDF se lit sans télécharger tout le PDF", async () => {
  // Trois Mo de remplissage, avec le sujet au début, à la fin, ou nulle part.
  const remplissage = Buffer.alloc(3 * 1024 * 1024, 0x20);
  const sujet = Buffer.from("<< /Subject (portee:piano-large:v1) >>");
  const grand = (ou) => Buffer.concat(ou === "debut" ? [Buffer.from("%PDF-1.4\n"), sujet, remplissage] : ou === "fin" ? [Buffer.from("%PDF-1.4\n"), remplissage, sujet] : [Buffer.from("%PDF-1.4\n"), remplissage]);
  const autres = [
    { id: "grand-debut", nom: "Livre 1", pdf: grand("debut"), pages: [page(1)] },
    { id: "grand-fin", nom: "Livre 2", pdf: grand("fin"), pages: [page(1)] },
    { id: "grand-sans", nom: "Livre 3", pdf: grand("aucun"), pages: [page(1)] },
  ];
  for (const sansRange of [false, true]) {
    const faux = await demarrerFauxCloud(doc([page(1)]), { autres, sansRange });
    const vers = (nom) => new RegExp(`/files/${faux.empreinteDe(nom)}`);
    try {
      const { c } = client(faux);
      // Le modèle Portée (25 Ko) : une requête, et plus aucune la fois suivante.
      assert.equal((await c.document("doc")).modele, "melodie-standard");
      assert.equal(compter(faux, vers("doc.pdf")), 1);
      await c.document("doc");
      assert.equal(compter(faux, vers("doc.pdf")), 1);
      // Sujet en tête d'un gros PDF : la tête suffit, même sans Range.
      assert.equal((await c.document("grand-debut")).modele, "piano-large");
      assert.equal(compter(faux, vers("grand-debut.pdf")), 1);
      // Sujet à la fin : la fin seule, si le cloud sait la servir.
      assert.equal((await c.document("grand-fin")).modele, sansRange ? null : "piano-large");
      assert.equal((await c.document("grand-sans")).modele, null);
      if (!sansRange) {
        assert.deepEqual(faux.requetes.filter((r) => vers("grand-fin.pdf").test(r)).map((r) => r.replace(/^.*\[/, "[")), ["[bytes=0-32767]", "[bytes=-32768]"]);
      }
      assert.equal(compter(faux, vers("grand-sans.pdf")), 2);
    } finally {
      await faux.fermer();
    }
  }
});

test("l'hôte de synchro se règle, et se replie sur le secours s'il ne répond plus", async () => {
  assert.equal(hoteDeSynchro("https://eu.tectonic.remarkable.com/"), "https://eu.tectonic.remarkable.com");
  for (const v of [undefined, "", "http://internal.cloud.remarkable.com", "javascript:alert(1)", "https://x.example/chemin"]) assert.equal(hoteDeSynchro(v), null, String(v));
  // Le secours par défaut ne vaut que pour un vrai hôte (jamais depuis un faux cloud de test).
  assert.equal(new CloudRemarkable(coffreMemoire(null)).secours, SYNC_SECOURS);
  assert.equal(new CloudRemarkable(coffreMemoire(null), { sync: "https://autre.remarkable.com" }).secours, SYNC_SECOURS);
  assert.equal(new CloudRemarkable(coffreMemoire(null), { sync: "http://127.0.0.1:9" }).secours, null);

  const faux = await demarrerFauxCloud(doc([page(1)]));
  // Un hôte qui répond 502 à tout, et un qui refuse la racine (403).
  const enPanne = http.createServer((req, res) => { res.writeHead(502); res.end(); });
  const refuse = http.createServer((req, res) => { res.writeHead(403); res.end(); });
  await Promise.all([enPanne, refuse].map((s) => new Promise((ok) => s.listen(0, "127.0.0.1", ok))));
  const adresse = (s) => `http://127.0.0.1:${s.address().port}`;
  try {
    // Connexion refusée sur l'hôte habituel : trois nouveaux essais, puis le secours.
    let { c, attentes } = client(faux, { sync: "http://127.0.0.1:9", secours: faux.url });
    assert.equal((await c.arborescence()).noeuds.length, 2);
    assert.equal(c.syncActif, faux.url);
    assert.equal(attentes.length, ESSAIS - 1);
    // Et la fois suivante, droit au secours.
    assert.equal((await c.document("doc")).pages.length, 1);
    assert.equal(attentes.length, ESSAIS - 1);
    // 502 jusqu'au bout : le secours aussi.
    ({ c } = client(faux, { sync: adresse(enPanne), secours: faux.url }));
    assert.equal((await c.arborescence()).noeuds.length, 2);
    // Une vraie réponse (403) : changer d'hôte n'y ferait rien.
    ({ c } = client(faux, { sync: adresse(refuse), secours: faux.url }));
    await assert.rejects(c.arborescence(), /HTTP 403/);
  } finally {
    await faux.fermer();
    await Promise.all([enPanne, refuse].map((s) => new Promise((ok) => s.close(ok))));
  }
});
