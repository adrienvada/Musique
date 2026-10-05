/**
 * Les bornes du connecteur (S4). Côté HTTP, la porte (clé, origine, taille)
 * avant le protocole MCP ; côté stockage, la taille maximale du compartiment.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { memeCle, origineAdmise, repondreHttp, TAILLE_MAX } from "../supabase/functions/portee-remarkable/http.js";
import { CloudRemarkable } from "../supabase/functions/portee-remarkable/remarkable.js";
import { coffreMemoire, coffreSupabase } from "../supabase/functions/portee-remarkable/coffre.js";
import { objetsSupabase, REGLAGES_COMPARTIMENT } from "../supabase/functions/portee-remarkable/objets.js";
import { demarrerFauxStockage } from "./faux-cloud.mjs";

const CLE = "k".repeat(32);
const ADRESSE = `https://x.supabase.co/functions/v1/portee-remarkable/${CLE}`;
const cloud = () => new CloudRemarkable(coffreMemoire(null));
const outil = (name) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } });

function appeler({ adresse = ADRESSE, methode = "POST", entetes = {}, corps, options = {} } = {}) {
  const corpsTexte = corps === undefined ? undefined : typeof corps === "string" ? corps : JSON.stringify(corps);
  return repondreHttp(new Request(adresse, {
    method: methode,
    headers: { "content-type": "application/json", ...entetes },
    body: corpsTexte,
  }), { cle: CLE, cloud, ...options });
}

test("la clé se compare en entier, à temps constant", async () => {
  assert.equal(await memeCle(CLE, CLE), true);
  assert.equal(await memeCle("k".repeat(31) + "x", CLE), false);
  assert.equal(await memeCle("k".repeat(33), CLE), false);
  assert.equal(await memeCle("", CLE), false);
  // Une clé presque juste n'ouvre pas plus qu'une clé fausse : 404.
  assert.equal((await appeler({ adresse: ADRESSE.slice(0, -1) + "x", corps: outil("arborescence") })).status, 404);
  assert.equal((await appeler({ adresse: ADRESSE + "k", corps: outil("arborescence") })).status, 404);
  // Une clé trop courte côté fonction verrouille tout.
  assert.equal((await repondreHttp(new Request("https://x.supabase.co/functions/v1/portee-remarkable/court", { method: "POST", body: "{}" }), { cle: "court", cloud })).status, 404);
});

test("Origin : le site et Claude passent, une autre origine reçoit 403", async () => {
  // Les appels de claude.ai partent de ses serveurs : sans Origin.
  assert.equal(origineAdmise(null), true);
  for (const o of ["https://adrienvada.fr", "https://claude.ai", "https://www.claude.ai", "https://a.b.claude.ai", "https://claude.com", "https://app.claude.com", "https://api.anthropic.com"]) {
    assert.equal(origineAdmise(o), true, o);
  }
  for (const o of ["https://ailleurs.example", "http://claude.ai", "https://claude.ai.ailleurs.example", "https://faux-claude.ai", "https://anthropic.com.example", "null"]) {
    assert.equal(origineAdmise(o), false, o);
  }
  // Une origine étrangère, même avec la bonne clé et un corps « simple »
  // (text/plain, sans préflight) : rien n'est fait.
  let appele = false;
  const espion = () => ({ arborescence: async () => { appele = true; return { noeuds: [], illisibles: [] }; } });
  const r = await appeler({ entetes: { origin: "https://ailleurs.example", "content-type": "text/plain" }, corps: outil("arborescence"), options: { cloud: espion } });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  const corps = await r.json();
  assert.equal(corps.error.code, -32600);
  assert.equal("id" in corps, false);
  assert.equal(appele, false);
  // Le site : réponse et CORS ; claude.ai avec une origine : réponse, sans CORS.
  const site = await appeler({ entetes: { origin: "https://adrienvada.fr" }, corps: outil("arborescence") });
  assert.equal(site.status, 200);
  assert.equal(site.headers.get("access-control-allow-origin"), "https://adrienvada.fr");
  const claude = await appeler({ entetes: { origin: "https://claude.ai" }, corps: outil("arborescence") });
  assert.equal(claude.status, 200);
  assert.equal(claude.headers.get("access-control-allow-origin"), null);
  // Une origine ajoutée par PORTEE_ORIGINES passe, avec CORS.
  const enPlus = await appeler({ entetes: { origin: "http://localhost:8000" }, corps: outil("arborescence"), options: { origines: ["https://adrienvada.fr", "http://localhost:8000"] } });
  assert.equal(enPlus.status, 200);
  assert.equal(enPlus.headers.get("access-control-allow-origin"), "http://localhost:8000");
});

test("un corps de plus de 6 Mo reçoit 413, annoncé ou non", async () => {
  const gros = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "bibliotheque_ecrire", arguments: { id: "x", modifieLe: "2026-10-04T00:00:00.000Z", donnees: { abc: "a".repeat(TAILLE_MAX) } } } });
  const annonce = await appeler({ corps: gros, entetes: { origin: "https://adrienvada.fr" } });
  assert.equal(annonce.status, 413);
  assert.equal(annonce.headers.get("access-control-allow-origin"), "https://adrienvada.fr"); // le site peut le dire
  // Sans longueur annoncée (envoi par morceaux) : compté en lisant.
  const morceau = new TextEncoder().encode("x".repeat(1024 * 1024));
  let envoyes = 0;
  const flux = new ReadableStream({
    pull(c) {
      if (envoyes++ < 8) c.enqueue(morceau);
      else c.close();
    },
  });
  const sansLongueur = await repondreHttp(new Request(ADRESSE, { method: "POST", headers: { "content-type": "application/json" }, body: flux, duplex: "half" }), { cle: CLE, cloud });
  assert.equal(sansLongueur.status, 413);
  assert.ok(envoyes <= 8, "la lecture s'arrête au-delà de la borne");
  // Juste sous la borne : lu normalement (ici, un JSON illisible).
  assert.equal((await appeler({ corps: "x".repeat(1024) })).status, 400);
});

test("préflight et méthodes : 204 quelle que soit la clé, GET et DELETE refusés", async () => {
  const pre = await appeler({ adresse: ADRESSE + "-faux", methode: "OPTIONS", entetes: { origin: "https://adrienvada.fr" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://adrienvada.fr");
  for (const methode of ["GET", "DELETE", "PUT"]) {
    const r = await appeler({ methode });
    assert.equal(r.status, 405, methode);
    assert.match(r.headers.get("allow"), /POST/);
  }
});

// --- Côté stockage : la taille maximale du compartiment ----------------------

const BUCKET = "portee-remarkable";
const SIX_MO = 6291456;
const CREATION = "POST /storage/v1/bucket", REGLAGE = `PUT /storage/v1/bucket/${BUCKET}`;
const reglages = (stockage) => {
  const c = stockage.compartiments.get(BUCKET);
  return { publique: c.publique, limite: c.limite, types: c.types };
};
const compter = (stockage, requete) => stockage.requetes.filter((r) => r === requete).length;

test("le compartiment naît avec sa taille maximale : le stockage refuse plus gros, même si le code l'oublie", async () => {
  const stockage = await demarrerFauxStockage();
  try {
    const objets = objetsSupabase(stockage.url, stockage.cle);
    await objets.ecrire("bibliotheque/essai.json", { titre: "Essai" });
    // Privé, 6 Mo, et aucun type imposé.
    assert.deepEqual(reglages(stockage), { publique: false, limite: SIX_MO, types: null });
    assert.equal(compter(stockage, REGLAGE), 0, "créé avec ses réglages : rien à lui redire");
    // Rien de plus gros n'entre par la porte : la borne du stockage suit la sienne.
    assert.equal(REGLAGES_COMPARTIMENT.file_size_limit, TAILLE_MAX);
    // Une borne oubliée dans le code : le stockage refuse quand même.
    await assert.rejects(objets.ecrire("pages/enorme.json", ["x".repeat(SIX_MO)]), /HTTP 400/);
    assert.equal(stockage.objet(BUCKET, "pages/enorme.json"), undefined);
    // Le coffre range toujours son jeton en text/plain.
    const coffre = coffreSupabase(stockage.url, stockage.cle);
    await coffre.ecrire("jeton-appareil-de-test");
    assert.equal(await coffre.lire(), "jeton-appareil-de-test");
  } finally {
    await stockage.fermer();
  }
  // La tablette reliée avant toute synchro : c'est le coffre qui crée le compartiment, avec les mêmes réglages.
  const autre = await demarrerFauxStockage();
  try {
    await coffreSupabase(autre.url, autre.cle).ecrire("jeton-appareil-de-test");
    assert.deepEqual(reglages(autre), { publique: false, limite: SIX_MO, types: null });
  } finally {
    await autre.fermer();
  }
});

test("un compartiment d'avant la borne la reçoit une fois par démarrage, et un échec ne bloque rien", async () => {
  const stockage = await demarrerFauxStockage();
  try {
    // Le compartiment d'une fonction déployée avant la borne.
    stockage.compartiments.set(BUCKET, { publique: false, limite: null, types: null, objets: new Map() });
    // Un client par démarrage de la fonction (index.ts).
    const demarrer = () => objetsSupabase(stockage.url, stockage.cle);
    const a = demarrer();
    // Lire ne touche pas au compartiment.
    assert.equal(await a.lire("bibliotheque/rien.json"), null);
    assert.deepEqual([compter(stockage, CREATION), compter(stockage, REGLAGE)], [0, 0]);
    // « Il existe déjà » : ses réglages lui sont redits, une fois, même pour des écritures simultanées.
    await Promise.all([a.ecrire("bibliotheque/un.json", { n: 1 }), a.ecrire("bibliotheque/deux.json", { n: 2 }), a.creer("verrous/un.json", { le: "maintenant" })]);
    await a.ecrire("bibliotheque/trois.json", { n: 3 });
    assert.deepEqual(reglages(stockage), { publique: false, limite: SIX_MO, types: null });
    assert.deepEqual([compter(stockage, CREATION), compter(stockage, REGLAGE)], [1, 1]);

    // Le réglage échoue (une panne, une coupure) : on lit et on écrit quand même, et le démarrage suivant réessaie.
    for (const panne of [500, "coupure"]) {
      stockage.compartiments.get(BUCKET).limite = null;
      stockage.panne(/^PUT \/storage\/v1\/bucket\//, panne);
      const b = demarrer();
      const avant = compter(stockage, REGLAGE);
      await b.ecrire("bibliotheque/quatre.json", { n: 4 });
      await b.ecrire("bibliotheque/cinq.json", { n: 5 });
      assert.deepEqual(await b.lire("bibliotheque/quatre.json"), { n: 4 }, String(panne));
      assert.equal(compter(stockage, REGLAGE), avant + 1, "pas d'autre essai avant le prochain démarrage");
      assert.equal(reglages(stockage).limite, null);
      await demarrer().ecrire("bibliotheque/six.json", { n: 6 });
      assert.equal(reglages(stockage).limite, SIX_MO, String(panne));
    }

    // « Il existe déjà » dit en HTTP 409 (les stockages récents) : le même réglage.
    stockage.compartiments.get(BUCKET).limite = null;
    stockage.panne(/^POST \/storage\/v1\/bucket$/, 409);
    await demarrer().ecrire("bibliotheque/sept.json", { n: 7 });
    assert.equal(reglages(stockage).limite, SIX_MO);
    // Un autre refus (403) : rien à lui redire ; l'écriture dira le sien, s'il y en a un.
    const reglagesAvant = compter(stockage, REGLAGE);
    stockage.panne(/^POST \/storage\/v1\/bucket$/, 403);
    await demarrer().ecrire("bibliotheque/huit.json", { n: 8 });
    assert.equal(compter(stockage, REGLAGE), reglagesAvant);
    // Une coupure à la création : cette écriture échoue, la suivante refait la préparation.
    stockage.panne(/^POST \/storage\/v1\/bucket$/, "coupure");
    const c = demarrer();
    await assert.rejects(c.ecrire("bibliotheque/neuf.json", { n: 9 }));
    await c.ecrire("bibliotheque/neuf.json", { n: 9 });
    assert.equal(stockage.objet(BUCKET, "bibliotheque/neuf.json"), JSON.stringify({ n: 9 }));
  } finally {
    await stockage.fermer();
  }
});
