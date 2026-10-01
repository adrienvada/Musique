/**
 * Les accords : lire un nom, en proposer d'après la mélodie, harmoniser,
 * accompagner, transposer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../app/harmonie.js";
import { nouvelleSequence, poser, ecrireAbc } from "../app/sequence.js";

function idee(notes, options = {}) {
  const seq = nouvelleSequence(options);
  for (const [d, l, ht] of notes) poser(seq, 0, { d, l, h: ht });
  return seq;
}

test("lire un nom d'accord", () => {
  assert.deepEqual(h.lireAccord("F#m7/E"), { racine: 6, qualite: "m7", intervalles: [0, 3, 7, 10], basse: 4 });
  assert.deepEqual(h.lireAccord("Bb").intervalles, [0, 4, 7]);
  assert.equal(h.lireAccord("Cmaj").qualite, "");
  assert.equal(h.lireAccord("Cmaj7").qualite, "maj7");
  assert.equal(h.lireAccord("H7"), null);
  assert.equal(h.transposerAccord("Am/C", 2, "D"), "Bm/D");
  assert.equal(h.transposerAccord("G7", -2, "F"), "F7");
  assert.equal(h.transposerAccord("C", 3, "Eb"), "Eb");
});

test("les accords de la tonalité, et ceux qui vont avec la mélodie", () => {
  assert.deepEqual(h.accordsDeLaTonalite("C").map((a) => a.nom), ["C", "G", "F", "Am", "Dm", "Em", "Bdim", "G7"]);
  assert.deepEqual(h.accordsDeLaTonalite("Am").slice(0, 4).map((a) => a.nom), ["Am", "Dm", "E", "Em"]);
  // do-mi-sol en blanches : do majeur d'abord ; si-ré-fa : sol (ou sol 7).
  assert.equal(h.suggerer(idee([[0, 4, 60], [4, 4, 64], [8, 8, 67]]), 0, 16)[0], "C");
  assert.ok(["G", "G7"].includes(h.suggerer(idee([[0, 4, 71], [4, 4, 74], [8, 8, 77]]), 0, 16)[0]));
  // Une mélodie de quatre mesures : I … V … I.
  const seq = idee([[0, 8, 60], [8, 8, 64], [16, 8, 65], [24, 8, 69], [32, 8, 67], [40, 8, 71], [48, 16, 72]]);
  assert.deepEqual(h.harmoniser(seq).map((a) => [a.d, a.nom]), [[0, "C"], [16, "F"], [32, "G"], [48, "C"]]);
});

test("l'accompagnement : une voix de plus, dans la mesure, gravée en clé de fa", () => {
  const seq = idee([[0, 16, 72], [16, 16, 71]]);
  seq.accords = [{ d: 0, nom: "C" }, { d: 16, nom: "G/B" }];
  seq.accompagnement = "plaque";
  // Sol avec si à la basse : le si en dessous, l'accord au-dessus.
  assert.deepEqual(h.accompagnement(seq).map((n) => [n.d, n.l, n.h]), [[0, 16, 36], [0, 16, 48], [0, 16, 52], [0, 16, 55], [16, 16, 47], [16, 16, 55], [16, 16, 59], [16, 16, 62]]);
  seq.accompagnement = "basse";
  const basse = h.accompagnement(seq);
  assert.deepEqual(basse.filter((n) => n.d % 16 === 0).map((n) => n.h), [36, 47]);
  assert.equal(basse.filter((n) => n.d === 4).length, 2); // tierce et quinte sur le 2e temps
  seq.accompagnement = "arpege";
  const arpege = h.accompagnement(seq);
  assert.equal(arpege.length, 16);
  assert.ok(arpege.every((n) => n.l === 2));
  const voix = h.voixCompletes(seq);
  assert.equal(voix.length, 2);
  assert.match(ecrireAbc(seq, { voix }).abc, /V:2 clef=bass/);
  seq.accompagnement = "aucun";
  assert.equal(h.voixCompletes(seq).length, 1);
});

test("transposer toute l'idée : notes, accords et tonalité suivent", () => {
  const seq = idee([[0, 4, 69], [4, 4, 72]], { tonalite: "Am" });
  seq.accords = [{ d: 0, nom: "Am" }, { d: 4, nom: "E7" }];
  h.transposerIdee(seq, 3);
  assert.equal(seq.tonalite, "Cm");
  assert.deepEqual(seq.pistes[0].notes.map((n) => n.h), [72, 75]);
  assert.deepEqual(seq.accords.map((a) => a.nom), ["Cm", "G7"]);
});
