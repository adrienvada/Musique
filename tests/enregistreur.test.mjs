/**
 * Tests d'enregistreur.js : ce qui sera écrit est fixé quand on le planifie
 * (la cible et son contenu), une autre cible fait d'abord partir ce qui
 * attendait, et rien ne reste en attente quand on vide (audit du 04/10,
 * T4 : une correction perdue et une autre partition réécrite ; une idée
 * perdue au rechargement).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { creerEnregistreur, viderTout } from "../app/enregistreur.js";

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
