/**
 * Tests d'enregistreur.js : ce qui sera écrit est fixé quand on le planifie
 * (la cible et son contenu), une autre cible fait d'abord partir ce qui
 * attendait, et rien ne reste en attente quand on vide (audit du 04/10,
 * T4 : une correction perdue et une autre partition réécrite ; une idée
 * perdue au rechargement).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { creerEnregistreur, reprendreSecours, viderTout } from "../app/enregistreur.js";

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Un enregistreur dont les écritures sont notées dans `ecrits`. */
function essai(o = {}) {
  const ecrits = [];
  const e = creerEnregistreur({ delai: 20, ...o, ecrire: async (cible, contenu) => { ecrits.push([cible, contenu]); if (o.lent) await attendre(o.lent); } });
  return { e, ecrits };
}

test("un seul enregistrement après une salve de gestes, avec les contenus fondus", async () => {
  const { e, ecrits } = essai();
  e.planifier("A", { abc: "1" });
  e.planifier("A", { abc: "2" });
  e.planifier("A", { tempo: 90 });
  assert.equal(e.occupe, true);
  assert.deepEqual(ecrits, []);
  await attendre(40);
  assert.deepEqual(ecrits, [["A", { abc: "2", tempo: 90 }]]);
  assert.equal(e.occupe, false);
});

test("une autre partition fait d'abord partir ce qui attendait pour la première", async () => {
  const { e, ecrits } = essai();
  e.planifier("A", { abc: "A corrigée" });
  e.planifier("B", { tempo: 120 });
  assert.deepEqual(ecrits, [["A", { abc: "A corrigée" }]]);
  await e.vider();
  assert.deepEqual(ecrits, [["A", { abc: "A corrigée" }], ["B", { tempo: 120 }]]);
});

test("vider écrit tout de suite, dans le même geste quand rien ne s'écrit déjà", async () => {
  const { e, ecrits } = essai({ delai: 10000 });
  e.planifier("A", { abc: "x" });
  const fini = e.vider();
  assert.deepEqual(ecrits, [["A", { abc: "x" }]], "parti avant tout await : la page qui se ferme n'a peut-être pas d'autre tour");
  await fini;
  assert.equal(e.occupe, false);
});

test("les écritures se suivent, jamais deux à la fois ; occupe tant que l'une est en vol", async () => {
  let enCours = 0, auPlus = 0;
  const e = creerEnregistreur({ delai: 0, ecrire: async () => { enCours++; auPlus = Math.max(auPlus, enCours); await attendre(15); enCours--; } });
  e.planifier("A", { n: 1 });
  e.planifier("A", { n: 2 });
  e.planifier("B", { n: 3 });
  assert.equal(e.occupe, true);
  await e.vider();
  assert.equal(auPlus, 1);
  assert.equal(e.occupe, false);
});

test("une écriture qui échoue n'arrête pas les suivantes", async (t) => {
  const ecrits = [];
  t.mock.method(console, "error", () => {}); // l'erreur est gardée dans la console : ici, on la tait
  const e = creerEnregistreur({ delai: 0, ecrire: async (c) => { if (c === "A") throw new Error("plein"); ecrits.push(c); } });
  e.planifier("A", {});
  e.planifier("B", {});
  await e.vider();
  assert.deepEqual(ecrits, ["B"]);
});

test("viderTout vide chaque enregistreur de la page (pagehide) ; oublier abandonne", async () => {
  const a = essai({ delai: 10000 }), b = essai({ delai: 10000 }), c = essai({ delai: 10000 });
  a.e.planifier("A", { x: 1 });
  b.e.planifier("B", { y: 2 });
  c.e.planifier("C", { z: 3 });
  c.e.oublier();
  viderTout();
  assert.deepEqual(a.ecrits, [["A", { x: 1 }]]);
  assert.deepEqual(b.ecrits, [["B", { y: 2 }]]);
  assert.deepEqual(c.ecrits, []);
});

/** Un stockage local du navigateur, le temps d'un essai. */
function avecStockageLocal(t) {
  const cles = new Map();
  globalThis.localStorage = { getItem: (k) => cles.get(k) ?? null, setItem: (k, v) => cles.set(k, String(v)), removeItem: (k) => cles.delete(k) };
  t.after(() => { delete globalThis.localStorage; });
  return cles;
}

/** Une bibliothèque en mémoire, comme celle du stockage (lire, creer, modifier). */
function fausseBibliotheque(fiches = {}) {
  const b = new Map(Object.entries(fiches));
  return {
    b,
    lire: async (id) => (b.has(id) ? { ...b.get(id), id } : null),
    creer: async (id, d) => { b.set(id, d); },
    modifier: async (id, patch) => { b.set(id, { ...b.get(id), ...patch }); },
  };
}

test("la page se ferme avant l'écriture : la copie de secours la remet au démarrage suivant", async (t) => {
  const cles = avecStockageLocal(t);
  // L'écriture ne finit jamais : la page est partie avant (Chromium l'abandonne avec elle).
  const e = creerEnregistreur({
    delai: 10000, ecrire: () => new Promise(() => {}),
    secours: (cible, contenu) => ({ id: cible, creer: cible === "neuve", donnees: { ...contenu, modifieLe: "2026-10-05T10:00:00.000Z" } }),
  });
  e.planifier("neuve", { titre: "Idée du matin" });
  e.planifier("vieille", { abc: "C D" });
  viderTout({ fermeture: true });
  assert.ok(cles.has("portee:secours"), "la copie est écrite d'un coup, sans attendre");
  const bib = fausseBibliotheque({ vieille: { abc: "C", modifieLe: "2026-10-05T09:00:00.000Z" } });
  assert.equal(await reprendreSecours(bib), 2);
  assert.deepEqual(bib.b.get("neuve"), { titre: "Idée du matin", modifieLe: "2026-10-05T10:00:00.000Z" });
  assert.equal(bib.b.get("vieille").abc, "C D");
  assert.equal(cles.has("portee:secours"), false, "la copie s'efface une fois reprise");
  e.oublier();
});

test("la copie de secours ne remplace pas une version plus récente, ni ne fait revenir une partition supprimée", async (t) => {
  const cles = avecStockageLocal(t);
  cles.set("portee:secours", JSON.stringify([
    { id: "a", donnees: { abc: "ancien", modifieLe: "2026-10-05T10:00:00.000Z" } },
    { id: "b", donnees: { abc: "b", modifieLe: "2026-10-05T10:00:00.000Z" } },
    { id: "c", creer: true, donnees: { titre: "neuve", modifieLe: "2026-10-05T10:00:00.000Z" } },
  ]));
  const bib = fausseBibliotheque({ a: { abc: "écrite à temps", modifieLe: "2026-10-05T10:00:00.001Z" } });
  assert.equal(await reprendreSecours(bib), 1);
  assert.equal(bib.b.get("a").abc, "écrite à temps");
  assert.equal(bib.b.has("b"), false, "supprimée depuis : elle ne revient pas");
  assert.equal(bib.b.get("c").titre, "neuve");
});
