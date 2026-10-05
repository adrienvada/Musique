/**
 * L'écoute d'une page lue (M5) : ses notes, telles que le transport les
 * jouera (en pas, sur l'horloge du son), avec leur force, la transposition et
 * les mains coupées ; le tempo en noires même en 12/8 ; et ce qu'il faut
 * surligner à quel instant.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { notesDePage, plagesVoix, evenementA, qpmAbcjs } from "../app/ecoute-page.js";

const PIANO = "X:1\nM:4/4\nL:1/8\nQ:1/4=100\nK:C\nV:1 clef=treble\nV:2 clef=bass\n[V:1] !>!C2 D2 E2 F2|G8|]\n[V:2] C,8|G,,8|]\n";
const tune = (abc) => abcjs.parseOnly(abc)[0];
const notes = (source) => {
  const s = source();
  const sortie = [];
  for (let p = 0; p < s.fin; p++) for (const n of s.notesA(p)) sortie.push({ p, ...n });
  return sortie;
};

test("les notes d'une page : en pas, avec leur force (accents, temps forts) et les deux mains", () => {
  const { source, fin } = notesDePage(tune(PIANO), PIANO, { tempo: 100 });
  const s = source();
  assert.equal(s.tempo, 100);
  assert.equal(s.mesure, 16);
  assert.equal(fin, 32);
  const toutes = notes(source);
  // La main droite : do (accentué), ré, mi, fa, puis sol ; la gauche : do2, sol1.
  assert.deepEqual(toutes.filter((n) => n.h >= 60).map((n) => [n.p, n.h, n.l]), [[0, 60, 4], [4, 62, 4], [8, 64, 4], [12, 65, 4], [16, 67, 16]]);
  assert.deepEqual(toutes.filter((n) => n.h < 60).map((n) => [n.p, n.h]), [[0, 48], [16, 43]]);
  // La force d'abcjs est gardée : l'accent sonne plus fort que les autres temps.
  const forte = toutes.find((n) => n.h === 60).v, autre = toutes.find((n) => n.h === 62).v;
  assert.ok(forte > autre, `${forte} > ${autre}`);
});

test("transposer et couper une main", () => {
  const plages = plagesVoix(PIANO);
  assert.deepEqual(plages.map((p) => p.voix), [1, 2]);
  const sansGauche = notes(notesDePage(tune(PIANO), PIANO, { tempo: 100, voixMuettes: new Set([2]) }).source);
  assert.ok(sansGauche.every((n) => n.h >= 60));
  const transpose = notes(notesDePage(tune(PIANO), PIANO, { tempo: 100, transposition: 2 }).source);
  assert.deepEqual(transpose.filter((n) => n.p === 0).map((n) => n.h).sort(), [50, 62]);
});

test("reprises dépliées", () => {
  const abc = "X:1\nM:2/4\nL:1/8\nK:C\n|:C2 D2:|E4|]\n";
  const t = notes(notesDePage(tune(abc), abc, { tempo: 90 }).source);
  assert.deepEqual(t.map((n) => n.h), [60, 62, 60, 62, 64]);
});

test("12/8 : le tempo reste en noires ; abcjs, lui, compte en noires pointées", () => {
  const abc = "X:1\nM:12/8\nL:1/8\nQ:3/8=60\nK:C\nC3 D3 E3 F3|]\n";
  const { source } = notesDePage(tune(abc), abc, { tempo: 90 });
  const s = source();
  assert.equal(s.mesure, 24);
  assert.equal(s.temps, 6);
  // Une noire pointée = 6 pas ; à 90 noires par minute, 60 noires pointées par minute.
  assert.deepEqual(notes(source).map((n) => n.p), [0, 6, 12, 18]);
  assert.equal(qpmAbcjs(90, tune(abc).getBeatLength()), 60);
  assert.equal(qpmAbcjs(120, 0.25), 120);
});

test("surligner : le dernier événement commencé", () => {
  const evs = [0, 250, 500, 750].map((milliseconds) => ({ milliseconds }));
  assert.equal(evenementA(evs, -10), -1);
  assert.equal(evenementA(evs, 0), 0);
  assert.equal(evenementA(evs, 248), 0); // à une milliseconde près (les arrondis) : 249 allume déjà le suivant
  assert.equal(evenementA(evs, 250), 1);
  assert.equal(evenementA(evs, 10000), 3);
});
