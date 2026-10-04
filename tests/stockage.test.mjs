/**
 * Le stockage de l'appli (app/stockage.js) : la base IndexedDB et sa
 * migration, la restauration d'une sauvegarde, la base de claude.ai (le mémo
 * en morceaux), l'état du stockage du navigateur.
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { etatStockage, ouvrirStockage, restaurer, sauvegarde, stockageClaude, stockageIndexe } from "../app/stockage.js";

const pages = [[[[100, 200], [110, 210]]]];
const seq = (notes) => ({ version: 1, tempo: 100, mesure: [4, 4], tonalite: "C", pistes: [{ nom: "Mélodie", notes }], accords: [], accompagnement: "aucun", suivant: 9 });
const idee = (titre, modifieLe, extra = {}) => ({ type: "idee", titre, sequence: seq([{ id: 1, d: 0, l: 4, h: 60 }]), abc: "X:1", statut: "idee", nbPages: 0, modele: null, etiquettes: [], favori: false, note: "", memo: null, creeLe: modifieLe, modifieLe, ...extra });
const partition = (titre, modifieLe) => ({ titre, modele: "melodie-standard", abc: "X:1\nK:C\nC2|", doutes: [], statut: "a-relire", nbPages: 1, creeLe: modifieLe, modifieLe });
const liste = (local) => new Promise((ok) => local.ecouter(ok));
let n = 0;
const nom = () => `stockage-${n++}`;

/** Une base IndexedDB telle que la laissait une version précédente de l'appli. */
function baseAncienne(nomBase, version, remplir) {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(nomBase, version);
    r.onupgradeneeded = () => remplir(r.result, r.transaction);
    r.onsuccess = () => { r.result.close(); ok(); };
    r.onerror = () => ko(r.error);
  });
}
test("migration v2 → v3 : tout est gardé, et chaque fiche déjà synchronisée devient sa propre base", async () => {
  const b = nom();
  await baseAncienne(b, 2, (db) => {
    for (const m of ["partitions", "pages", "envois", "meta"]) db.createObjectStore(m);
  });
  // Remplie comme par la version 2 : une partition reçue (synchronisée), une modifiée pas encore partie.
  await new Promise((ok) => {
    const r = indexedDB.open(b, 2);
    r.onsuccess = () => {
      const t = r.result.transaction(["partitions", "pages", "envois", "meta"], "readwrite");
      t.objectStore("partitions").put({ ...partition("Reçue", "2026-10-01T10:00:00.000Z"), pagesLe: "2026-10-01T10:00:00.000Z" }, "recue");
      t.objectStore("partitions").put(partition("Modifiée", "2026-10-01T11:00:00.000Z"), "modifiee");
      t.objectStore("pages").put(pages.map((p) => p.map((tr) => tr.flatMap(([x, y]) => [x * 2, y * 2]))), "recue");
      t.objectStore("envois").put({ modifieLe: "2026-10-01T11:00:00.000Z", pages: false, supprime: false }, "modifiee");
      t.objectStore("meta").put("2026-10-01T10:00:05.000Z", "curseur");
      t.objectStore("meta").put(true, "rejoint");
      t.oncomplete = () => { r.result.close(); ok(); };
    };
  });
  const local = await stockageIndexe(b);
  try {
    assert.deepEqual((await liste(local)).map((p) => p.titre), ["Modifiée", "Reçue"]);
    assert.deepEqual(await local.pages("recue"), pages);
    assert.equal(await local.lireMeta("curseur"), "2026-10-01T10:00:05.000Z");
    const [e] = await local.enAttente();
    assert.equal(e.id, "modifiee", "l'envoi en attente est gardé");
    const etat = await local.etatSynchro("recue");
    assert.equal(etat.base.modifieLe, "2026-10-01T10:00:00.000Z");
    assert.equal(etat.base.pagesLe, "2026-10-01T10:00:00.000Z");
    assert.equal(etat.base.donnees.titre, "Reçue");
    assert.equal((await local.etatSynchro("modifiee")).base, null, "une fiche qui attend son envoi n'a pas de base sûre");
  } finally { local.fermer(); }
});

test("migration v1 → v3, et v2 jamais synchronisée : aucune base inventée", async () => {
  const b1 = nom();
  await baseAncienne(b1, 1, (db) => { db.createObjectStore("partitions").put(partition("De la v1", "2026-09-30T10:00:00.000Z"), "v1"); db.createObjectStore("pages"); });
  const l1 = await stockageIndexe(b1);
  try {
    assert.equal((await l1.lire("v1")).titre, "De la v1");
    assert.equal((await l1.etatSynchro("v1")).base, null);
  } finally { l1.fermer(); }
  const b2 = nom();
  await baseAncienne(b2, 2, (db) => { db.createObjectStore("partitions").put(partition("Jamais partie", "2026-09-30T10:00:00.000Z"), "p"); for (const m of ["pages", "envois", "meta"]) db.createObjectStore(m); });
  const l2 = await stockageIndexe(b2);
  try { assert.equal((await l2.etatSynchro("p")).base, null); } finally { l2.fermer(); }
});

test("une version plus récente a déjà ouvert la base : une erreur claire, pas une bibliothèque vide", async () => {
  const b = nom();
  await baseAncienne(b, 7, (db) => db.createObjectStore("partitions"));
  await assert.rejects(stockageIndexe(b), (e) => e.code === "version_plus_recente" && /recharge la page/.test(e.message));
});

test("ouvrirStockage ne se replie plus en silence sur localStorage quand la base est bloquée", async () => {
  const ancien = await new Promise((ok) => { const r = indexedDB.open("portee", 1); r.onupgradeneeded = () => r.result.createObjectStore("partitions"); r.onsuccess = () => ok(r.result); });
  try {
    await assert.rejects(ouvrirStockage(), (e) => e.code === "base_bloquee");
  } finally { ancien.close(); }
  const local = await ouvrirStockage();
  assert.equal(local.mode, "local");
  assert.equal(local.synchronisable, true, "c'est bien IndexedDB");
  local.fermer();
});

test("chaque changement note un envoi neuf ; la synchro n'efface que celui qu'elle a fait partir (D3)", async () => {
  const local = await stockageIndexe(nom());
  try {
    await local.creer("p", partition("Pièce", "2026-10-01T10:00:00.000Z"), pages);
    const [e1] = await local.enAttente();
    assert.equal(e1.pages, true);
    await local.modifier("p", { titre: "Pièce bis" });
    const [e2] = await local.enAttente();
    assert.notEqual(e2.numero, e1.numero);
    assert.equal(e2.pages, true, "les pages restent à envoyer tant qu'elles ne sont pas parties");
    await local.envoye("p", e1.numero, { id: "p", donnees: partition("Pièce", "2026-10-01T10:00:00.000Z"), modifieLe: "2026-10-01T10:00:00.000Z", supprime: false, pagesLe: "2026-10-01T10:00:00.000Z" });
    assert.equal((await local.enAttente()).length, 1, "un envoi d'avant ne fait pas partir le suivant");
    assert.equal((await local.etatSynchro("p")).base.modifieLe, "2026-10-01T10:00:00.000Z");
    await local.envoye("p", e2.numero, null);
    assert.deepEqual(await local.enAttente(), []);
  } finally { local.fermer(); }
});

test("modifier : jamais une date plus ancienne que la version d'avant ; supprimer : la pierre tombale passe après", async () => {
  const local = await stockageIndexe(nom());
  try {
    const futur = new Date(Date.now() + 3600000).toISOString();
    await local.creer("p", partition("Écrite par un appareil en avance", futur), pages);
    await local.modifier("p", { titre: "Corrigée ici", modifieLe: new Date().toISOString() });
    const f = await local.lire("p");
    assert.ok(f.modifieLe > futur);
    await local.supprimer("p");
    const [e] = await local.enAttente();
    assert.equal(e.supprime, true);
    assert.ok(e.modifieLe > f.modifieLe, "datée après la version d'ici, malgré l'horloge");
    assert.equal(await local.lire("p"), null);
    assert.deepEqual(await local.pages("p"), []);
  } finally { local.fermer(); }
});

test("ecrireMemo : la fiche dit qu'il y a un mémo, sa date avance, le son part (S6, S14)", async () => {
  const local = await stockageIndexe(nom());
  try {
    await local.creer("i", idee("Idée", "2026-10-01T10:00:00.000Z"), []);
    const avant = await local.lire("i");
    await local.ecrireMemo("i", { type: "audio/mp4", base64: "AAAA", duree: 3 });
    const apres = await local.lire("i");
    assert.deepEqual(apres.memo, { duree: 3, type: "audio/mp4" });
    assert.ok(apres.modifieLe > avant.modifieLe);
    const [e] = await local.enAttente();
    assert.equal(e.pages, true);
    assert.equal(e.modifieLe, apres.modifieLe);
    assert.deepEqual(await local.lireMemo("i"), { type: "audio/mp4", base64: "AAAA", duree: 3 });
    // Une idée pas encore enregistrée : le son est gardé, rien n'est envoyé seul.
    await local.ecrireMemo("neuve", { type: "audio/mp4", base64: "BBBB", duree: 1 });
    assert.deepEqual((await local.enAttente()).map((x) => x.id), ["i"]);
  } finally { local.fermer(); }
});

test("S6 · une sauvegarde empoisonnée (des étiquettes qui ne sont pas une liste) ne vide plus le carnet", async () => {
  const local = await stockageIndexe(nom());
  try {
    const base = (id, titre, extra = {}) => ({ id, pages: [], donnees: idee(titre, "2026-10-04T10:00:00.000Z", extra) });
    const r = await restaurer(local, { format: "portee-sauvegarde", version: 1, partitions: [base("pbon", "Une bonne idée"), base("pmal", "Idée cassée", { etiquettes: 5, note: 3, memo: { duree: "<img src=x onerror=alert(1)>" } })] }, new Set());
    assert.equal(r.revenues, 2);
    const l = await liste(local);
    assert.deepEqual(l.map((p) => p.titre).sort(), ["Idée cassée", "Une bonne idée"]);
    // Ce que fait le carnet (app.js, toutesEtiquettes ; accueil.js, la recherche) ne casse plus.
    const etiquettes = new Set(l.flatMap((p) => p.etiquettes));
    assert.deepEqual([...etiquettes], []);
    for (const p of l) assert.equal(typeof [p.titre, ...p.etiquettes, p.note].join(" ").toLowerCase(), "string");
    assert.equal((await local.lire("pmal")).memo.duree, 0);
  } finally { local.fermer(); }
});

test("D5 · restaurer : les absentes reviennent datées d'aujourd'hui dans l'ordre, les présentes restent, une erreur n'arrête pas les autres", async () => {
  const source = await stockageIndexe(nom());
  const cible = await stockageIndexe(nom());
  try {
    await source.creer("a", partition("Ancienne", "2026-09-01T10:00:00.000Z"), pages);
    // Créée avec son mémo d'un coup (comme une restauration) : sa date reste celle d'origine.
    await source.creer("b", idee("Récente", "2026-09-20T10:00:00.000Z", { memo: { duree: 2, type: "audio/mp4" } }), [], { memo: { type: "audio/mp4", base64: "AAAA", duree: 2 } });
    await source.creer("c", partition("Déjà là", "2026-09-10T10:00:00.000Z"), pages);
    await source.creer("d", partition("Déjà là, changée", "2026-09-11T10:00:00.000Z"), pages);
    await source.creer("e", partition("Refusée", "2026-09-12T10:00:00.000Z"), pages);
    await source.creer("m", { type: "morceau", titre: "Chanson", blocs: [{ id: "b1", idee: "ma idée", nom: "Intro", fois: 1 }], tempo: null, statut: "morceau", nbPages: 0, modele: null, modifieLe: "2026-09-25T10:00:00.000Z" }, []);
    const fichier = JSON.parse(JSON.stringify(await sauvegarde(source, await liste(source))));
    // Une idée au nom refusé par la bibliothèque commune, que cite le morceau.
    fichier.partitions.push({ id: "ma idée", donnees: idee("Au nom bricolé", "2026-09-05T10:00:00.000Z"), pages: [] }, { id: "x", donnees: "pas une fiche", pages: [] });
    await cible.creer("c", partition("Déjà là", "2026-09-10T10:00:00.000Z"), pages);
    await cible.creer("d", partition("Déjà là, et modifiée ici", "2026-09-11T10:00:00.000Z"), pages);
    const creer = cible.creer;
    cible.creer = (id, ...reste) => (id === "e" ? Promise.reject(new Error("le stockage est plein")) : creer(id, ...reste));
    const avant = new Date().toISOString();
    const r = await restaurer(cible, fichier, new Set(["c", "d"]));
    cible.creer = creer;
    assert.equal(r.revenues, 4); // a, b, m, et l'idée au nom bricolé
    assert.equal(r.ajoutees, 4);
    assert.equal(r.ignorees, 2);
    assert.equal(r.differentes, 1);
    assert.deepEqual(r.echecs.map((x) => [x.titre, x.raison]), [["Sans titre", "fiche illisible"], ["Refusée", "le stockage est plein"]].sort((x, _y) => (x[0] === "Refusée" ? 1 : -1)));
    const l = await liste(cible);
    assert.equal((await cible.lire("d")).titre, "Déjà là, et modifiée ici", "une partition présente n'est pas écrasée");
    const revenues = l.filter((p) => p.modifieLe >= avant).sort((x, y) => x.modifieLe.localeCompare(y.modifieLe)).map((p) => p.titre);
    assert.deepEqual(revenues, ["Ancienne", "Au nom bricolé", "Récente", "Chanson"], "dans l'ordre d'origine");
    assert.deepEqual(await cible.pages("a"), pages);
    assert.deepEqual(await cible.lireMemo("b"), { type: "audio/mp4", base64: "AAAA", duree: 2 });
    const bricolee = l.find((p) => p.titre === "Au nom bricolé");
    assert.match(bricolee.id, /^[A-Za-z0-9_-]+$/, "un identifiant neuf, valable");
    assert.equal((await cible.lire("m")).blocs[0].idee, bricolee.id, "le morceau suit");
  } finally { source.fermer(); cible.fermer(); }
});

test("restaurer refuse ce qui n'est pas une sauvegarde de Portée", async () => {
  const local = await stockageIndexe(nom());
  try {
    await assert.rejects(restaurer(local, { format: "autre" }), /pas une sauvegarde/);
    await assert.rejects(restaurer(local, null), /pas une sauvegarde/);
  } finally { local.fermer(); }
});

/** Une fausse base de claude.ai : documents et collections, et sa limite de 256 Kio par document. */
function fausseBaseClaude() {
  const docs = new Map();
  const abonnes = new Set();
  const prevenir = () => { const snap = { docs: [...docs].filter(([c]) => /^partitions\/[^/]+$/.test(c)).map(([c, v]) => ({ id: c.split("/")[1], data: () => structuredClone(v) })) }; abonnes.forEach((f) => f(snap)); };
  const doc = (chemin) => ({
    async get() { return { exists: docs.has(chemin), data: () => structuredClone(docs.get(chemin)) }; },
    async set(v) {
      if (JSON.stringify(v).length > 256 * 1024) throw Object.assign(new Error("invalid_argument: document trop gros"), { code: "invalid_argument" });
      docs.set(chemin, structuredClone(v)); prevenir();
    },
    async update(v) { if (!docs.has(chemin)) throw new Error("not_found"); docs.set(chemin, { ...docs.get(chemin), ...structuredClone(v) }); prevenir(); },
    async delete() { docs.delete(chemin); prevenir(); },
  });
  return {
    docs,
    doc,
    collection: (nomCol) => ({
      doc: (id) => doc(`${nomCol}/${id}`),
      orderBy: () => ({ onSnapshot: (f) => { abonnes.add(f); prevenir(); return () => abonnes.delete(f); } }),
    }),
  };
}

test("D8 · claude.ai : un mémo de plus de 256 Kio se range en morceaux, se relit, et revient d'une sauvegarde", async () => {
  const db = fausseBaseClaude();
  const local = stockageClaude(db, null);
  const son = "Q".repeat(700 * 1024); // un mémo d'une minute enregistré par Safari, en base64
  await local.creer("i", idee("Mémo long", "2026-10-01T10:00:00.000Z", { memo: { duree: 60, type: "audio/mp4" } }), []);
  await local.ecrireMemo("i", { type: "audio/mp4", base64: son, duree: 60 });
  const morceaux = [...db.docs.keys()].filter((c) => c.startsWith("partitions/i/memo/audio-"));
  assert.equal(morceaux.length, 4);
  assert.ok([...db.docs.values()].every((v) => JSON.stringify(v).length < 200 * 1024), "chaque document sous 200 Ko");
  assert.deepEqual(await local.lireMemo("i"), { type: "audio/mp4", duree: 60, base64: son });
  // Un mémo plus court : les morceaux en trop partent.
  await local.ecrireMemo("i", { type: "audio/mp4", base64: "AAAA", duree: 1 });
  assert.equal([...db.docs.keys()].filter((c) => c.startsWith("partitions/i/memo/audio-")).length, 1);
  assert.equal((await local.lireMemo("i")).base64, "AAAA");
  // L'ancien format (un seul document) se lit toujours.
  await db.doc("partitions/j/memo/audio").set({ type: "audio/webm", base64: "VIEUX", duree: 2 });
  assert.deepEqual(await local.lireMemo("j"), { type: "audio/webm", base64: "VIEUX", duree: 2 });
  // Sauvegarde puis restauration dans une autre base claude.ai : le long mémo revient.
  await local.ecrireMemo("i", { type: "audio/mp4", base64: son, duree: 60 });
  const l = await new Promise((ok) => local.ecouter(ok));
  const fichier = JSON.parse(JSON.stringify(await sauvegarde(local, l)));
  const ailleurs = stockageClaude(fausseBaseClaude(), null);
  const r = await restaurer(ailleurs, fichier, new Set());
  assert.deepEqual([r.revenues, r.echecs.length], [1, 0]);
  assert.equal((await ailleurs.lireMemo("i")).base64.length, son.length);
  // Supprimer la partition supprime ses morceaux.
  await local.supprimer("i", 0);
  assert.deepEqual([...db.docs.keys()].filter((c) => c.startsWith("partitions/i")), []);
});

test("S6 · claude.ai : ce qui se lit et s'écrit dans la base de la page est remis en forme", async () => {
  const db = fausseBaseClaude();
  const local = stockageClaude(db, null);
  await db.doc("partitions/p").set({ titre: "Abîmée", etiquettes: 5, modifieLe: "2026-10-01T10:00:00.000Z" });
  assert.deepEqual((await local.lire("p")).etiquettes, []);
  const l = await new Promise((ok) => local.ecouter(ok));
  assert.deepEqual(l.map((p) => [p.id, p.titre]), [["p", "Abîmée"]]);
  await local.modifier("p", { favori: "true", etiquettes: "Jazz" });
  assert.deepEqual([db.docs.get("partitions/p").favori, db.docs.get("partitions/p").etiquettes], [true, ["jazz"]]);
});

test("D9 · etatStockage : protégé ou non, la place prise, appli installée, le risque de Safari", async () => {
  const avant = { navigator: globalThis.navigator, matchMedia: globalThis.matchMedia };
  const poser = (nav, installee) => {
    Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
    globalThis.matchMedia = (q) => ({ matches: installee && q === "(display-mode: standalone)" });
  };
  try {
    poser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", storage: { persisted: async () => false, estimate: async () => ({ usage: 1234, quota: 5e9 }) } }, false);
    assert.deepEqual(await etatStockage(), { protege: false, utilise: 1234, quota: 5e9, installee: false, ios: true, safari: true, risque: true });
    poser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", standalone: true, storage: { persisted: async () => true, estimate: async () => ({ usage: 1, quota: 2 }) } }, false);
    const installe = await etatStockage();
    assert.equal(installe.installee, true);
    assert.equal(installe.risque, false, "une appli de l'écran d'accueil n'est pas effacée au bout de 7 jours");
    poser({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36", storage: { persisted: async () => true } }, true);
    assert.deepEqual(await etatStockage(), { protege: true, utilise: null, quota: null, installee: true, ios: false, safari: false, risque: false });
    poser({}, false);
    assert.deepEqual(await etatStockage(), { protege: null, utilise: null, quota: null, installee: false, ios: false, safari: false, risque: false });
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: avant.navigator, configurable: true });
    if (avant.matchMedia) globalThis.matchMedia = avant.matchMedia; else delete globalThis.matchMedia;
  }
});
