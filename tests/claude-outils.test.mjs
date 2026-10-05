/**
 * « Ce que tu veux », avec les outils de la page (H2, claude-outils.js) :
 * Claude ne réécrit pas l'idée note à note, il appelle les gestes de
 * sequence.js sur une COPIE. Leur forme (celle de sample.d.ts), ce qu'ils
 * font (les mêmes gestes qu'au doigt), ce qu'ils refusent, et la copie qui
 * reste jouable quand un geste l'abîmerait.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as sq from "../app/sequence.js";
import { outilsSurCopie } from "../app/claude-outils.js";

/** Une idée de notes [d, l, h] (piste 0), avec ses accords. */
function idee(notes, { accords = [], ...options } = {}) {
  const seq = sq.nouvelleSequence(options);
  for (const [d, l, h] of notes) sq.poser(seq, 0, { d, l, h });
  seq.accords = accords.map(([d, nom]) => ({ d, nom }));
  return seq;
}
// La mineur, 3/4 : trois mesures, trois accords (comme dans claude-idee.test.mjs).
const VALSE = () => idee([[0, 4, 69], [4, 2, 71], [6, 2, 72], [8, 4, 76], [12, 8, 74], [20, 4, 72], [24, 12, 69]], { tempo: 96, mesure: [3, 4], tonalite: "Am", accords: [[0, "Am"], [12, "Dm"], [24, "E7"]] });
const fige = (x) => JSON.parse(JSON.stringify(x));

test("les outils ont la forme de sample.d.ts, et des descriptions et schémas dans les bornes", () => {
  const { outils, copie } = outilsSurCopie(VALSE());
  // Les plus utiles d'abord : `max` (sample.limits().tools.maxCount) garde les premiers.
  assert.deepEqual(outils.map((o) => o.name), ["transposer_idee", "transposer", "etirer", "poser_accords", "ajouter_notes", "effacer_notes", "recaler", "a_l_envers", "miroir"]);
  for (const o of outils) {
    assert.match(o.name, /^[A-Za-z0-9_-]{1,128}$/);
    assert.ok(o.description.length > 40 && Buffer.byteLength(o.description) <= 1024, o.name);
    assert.equal(o.inputSchema.type, "object", o.name);
    assert.equal(o.inputSchema.additionalProperties, false, o.name);
    assert.ok(!("required" in o.inputSchema) || o.inputSchema.required.length > 0, o.name); // pas de « required » vide
    assert.ok(Buffer.byteLength(JSON.stringify(o.inputSchema)) <= 4096, o.name);
    assert.equal(typeof o.execute, "function");
  }
  assert.equal(typeof copie, "function");
  assert.deepEqual(outilsSurCopie(VALSE(), { max: 3 }).outils.map((o) => o.name), ["transposer_idee", "transposer", "etirer"]);
  assert.equal(outilsSurCopie(VALSE(), { max: 0 }).outils.length, 0);
});

test("les outils travaillent sur une copie, avec les gestes de sequence.js, et rendent peu de chose", () => {
  const seq = VALSE();
  const avant = fige(seq);
  const { outils, copie } = outilsSurCopie(seq);
  const outil = (nom) => outils.find((o) => o.name === nom);
  const r = outil("transposer").execute({ demiTons: 12, debut: 24 }, { signal: new AbortController().signal });
  assert.deepEqual(r, { fait: "1 note montée de 12 demi-tons", notes: 7, mesures: 3, tonalite: "Am" });
  assert.ok(JSON.stringify(r).length < 200);
  // Le même geste que sequence.js, fait à la main sur une autre copie.
  const attendu = sq.cloner(seq);
  sq.transposer(attendu, 0, [attendu.pistes[0].notes[6].id], 12);
  assert.deepEqual(copie(), attendu);
  outil("etirer").execute({ facteur: 2, debut: 0, fin: 12 });
  sq.etirer(attendu, 0, attendu.pistes[0].notes.filter((n) => n.d < 12).map((n) => n.id), 2);
  assert.deepEqual(copie(), attendu);
  outil("a_l_envers").execute({ piste: 1 });
  sq.retrograder(attendu, 0, attendu.pistes[0].notes.map((n) => n.id));
  outil("miroir").execute({});
  sq.renverser(attendu, 0, attendu.pistes[0].notes.map((n) => n.id));
  outil("recaler").execute({ grille: 4 });
  sq.recaler(attendu, 0, attendu.pistes[0].notes.map((n) => n.id), 4);
  assert.deepEqual(copie(), attendu);
  outil("poser_accords").execute({ accords: [{ mesure: 2, temps: 1, nom: "F" }] });
  assert.deepEqual(copie().accords.find((a) => a.d === 12), { d: 12, nom: "F" });
  outil("ajouter_notes").execute({ notes: [{ debut: 80, duree: 4, hauteur: 60 }] });
  assert.ok(copie().pistes[0].notes.some((n) => n.d === 80 && n.h === 60));
  assert.match(outil("effacer_notes").execute({ debut: 80, hauteurs: [60] }).fait, /1 note effacée/);
  // L'idée reçue n'a pas bougé ; copie() rend un état qu'on peut garder (une copie de la copie).
  assert.deepEqual(seq, avant);
  const c = copie();
  c.pistes[0].notes = [];
  assert.ok(copie().pistes[0].notes.length > 0);
});

test("transposer toute l'idée : les notes, les accords et la tonalité, comme la feuille Tempo", () => {
  // « Transpose en ré » : transposer seulement les notes laissait les accords en do.
  const seq = idee([[0, 4, 60], [4, 4, 64], [8, 8, 67]], { accords: [[0, "C"], [8, "G7"]] });
  const { outils, copie } = outilsSurCopie(seq);
  const r = outils.find((o) => o.name === "transposer_idee").execute({ demiTons: 2 });
  assert.equal(r.fait, "toute l'idée montée de 2 demi-tons, en ré majeur");
  assert.equal(r.tonalite, "D");
  assert.deepEqual(copie().pistes[0].notes.map((n) => n.h), [62, 66, 69]);
  assert.deepEqual(copie().accords.map((a) => a.nom), ["D", "A7"]);
  outils.find((o) => o.name === "transposer_idee").execute({ demiTons: -3 });
  assert.equal(copie().tonalite, "B");
  for (const demiTons of [0, 13, -13, 2.5, "2"]) {
    assert.throws(() => outils.find((o) => o.name === "transposer_idee").execute({ demiTons }), /de -12 à 12, sauf 0/, String(demiTons));
  }
});

test("chaque geste réussi se dit à l'écran (surGeste) ; un appel arrêté ne touche plus à rien", () => {
  const seq = VALSE();
  const dits = [];
  const { outils, copie } = outilsSurCopie(seq, { surGeste: (fait) => dits.push(fait) });
  const outil = (nom) => outils.find((o) => o.name === nom);
  outil("transposer").execute({ demiTons: -12 });
  assert.throws(() => outil("transposer").execute({ demiTons: 0 }), /sauf 0/);
  assert.deepEqual(dits, ["7 notes descendues de 12 demi-tons"]); // l'échec ne se dit pas
  // Un écran qui suivrait mal ne fait pas échouer le geste de Claude.
  const fragile = outilsSurCopie(seq, { surGeste: () => { throw new Error("écran parti"); } });
  assert.doesNotThrow(() => fragile.outils.find((o) => o.name === "transposer").execute({ demiTons: 1 }));
  // Adrien a touché « Arrêter » : un geste encore en route ne fait rien.
  const arret = new AbortController();
  arret.abort();
  const avant = copie();
  assert.throws(() => outil("transposer").execute({ demiTons: 2 }, { signal: arret.signal }), /arrêté/);
  assert.deepEqual(copie(), avant);
});

test("poser_accords : mesure après mesure, ce que Claude pose sonne jusqu'à son accord suivant", () => {
  const seq = idee([[0, 16, 60], [16, 16, 62], [32, 16, 64]], { accords: [[0, "C"]] });
  const { outils, copie } = outilsSurCopie(seq);
  // Donnés dans le désordre : le fa de la mesure 1 tient jusqu'au sol 7 du 3ᵉ temps de la mesure 2,
  // puis le do d'avant revient à la mesure 3, qu'on n'a pas demandé de changer.
  outils.find((o) => o.name === "poser_accords").execute({ accords: [{ mesure: 2, temps: 3, nom: "G7" }, { mesure: 1, temps: 1, nom: "F" }] });
  assert.deepEqual(copie().accords, [{ d: 0, nom: "F" }, { d: 24, nom: "G7" }, { d: 32, nom: "C" }]);
  assert.equal(copie().accompagnement, "plaque");
});

test("une entrée invalide lève une erreur en français ; un geste qui abîmerait la copie est défait", () => {
  const seq = VALSE();
  const { outils, copie } = outilsSurCopie(seq);
  const outil = (nom) => outils.find((o) => o.name === nom);
  for (const [nom, entree, motif] of [
    ["transposer", { demiTons: 0 }, /sauf 0/],
    ["transposer", { demiTons: "12" }, /demiTons/],
    ["transposer", {}, /« demiTons » manque/],
    ["transposer", { demiTons: 2, octave: 1 }, /clé inattendue « octave »/],
    ["transposer", { demiTons: 2, piste: 2 }, /piste : de 1 à 1/],
    ["transposer", { demiTons: 2, debut: 40 }, /Aucune note/],
    ["transposer_idee", { demiTons: 2, piste: 1 }, /clé inattendue « piste »/],
    ["etirer", { facteur: 3 }, /2 ou 0.5/],
    ["recaler", { grille: 3 }, /1, 2, 4 ou 8/],
    ["poser_accords", { accords: [{ mesure: 1, temps: 1, nom: "Do" }] }, /ne se lit pas/],
    ["poser_accords", { accords: [{ mesure: 1, temps: 9, nom: "C" }] }, /temps : de 1 à 3/],
    ["poser_accords", { accords: [] }, /de 1 à 64/],
    ["ajouter_notes", { notes: [{ debut: 0, duree: 4, hauteur: 69 }] }, /se chevauchent/],
    ["ajouter_notes", { notes: [{ debut: 0, duree: 0, hauteur: 30 }] }, /durée nulle/],
    ["ajouter_notes", { notes: [{ debut: 0, duree: 4, hauteur: 200 }] }, /hors du clavier/],
    ["ajouter_notes", { notes: [{ debut: 84, duree: 4, hauteur: 60 }] }, /hors de la place/],
    ["effacer_notes", { hauteurs: [61] }, /Aucune note de ces hauteurs/],
    ["transposer", JSON.parse('{"demiTons": 2, "__proto__": {}}'), /clé/],
    ["transposer", "monte", /un objet/],
  ]) {
    assert.throws(() => outil(nom).execute(entree), (e) => e instanceof Error && motif.test(e.message), `${nom} ${JSON.stringify(entree)}`);
  }
  assert.deepEqual(copie(), seq); // rien n'a changé
  // Recaler sur la blanche ferait se chevaucher deux do5 : défait, et dit.
  const deux = idee([[0, 2, 72], [2, 2, 72]]);
  const o = outilsSurCopie(deux);
  assert.throws(() => o.outils.find((x) => x.name === "recaler").execute({ grille: 8 }), /Rien n'est fait : deux notes de même hauteur/);
  assert.deepEqual(o.copie(), deux);
  // Étirer au-delà du double de l'idée : défait aussi.
  const longue = idee([[0, 48, 60]], { mesure: [3, 4] });
  const l = outilsSurCopie(longue);
  l.outils.find((x) => x.name === "etirer").execute({ facteur: 2 });
  assert.throws(() => l.outils.find((x) => x.name === "etirer").execute({ facteur: 2 }), /dépasserait/);
});
