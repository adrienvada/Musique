/**
 * Les morceaux : des idées bout à bout, répétées, avec leur accompagnement ;
 * un bloc dont l'idée a disparu est sauté.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assembler, midiDuMorceau, sectionSuivante, couleursDesIdees, structure, dureeEnTexte, NB_COULEURS } from "../app/morceau.js";
import { nouvelleSequence, poser } from "../app/sequence.js";

function idee(id, notes, options = {}, accords = []) {
  const sequence = nouvelleSequence(options);
  for (const [d, l, h] of notes) poser(sequence, 0, { d, l, h });
  sequence.accords = accords;
  if (accords.length) sequence.accompagnement = "plaque";
  return { id, type: "idee", titre: id, sequence };
}

test("assembler : les blocs se suivent, mesure entière par mesure entière", () => {
  const idees = new Map([
    ["intro", idee("intro", [[0, 4, 60], [4, 4, 64]])],                   // une mesure (incomplète)
    ["refrain", idee("refrain", [[0, 16, 67], [16, 8, 69]], {}, [{ d: 0, nom: "C" }])], // deux mesures
  ]);
  const a = assembler({ blocs: [
    { id: "a", idee: "intro", nom: "Intro", fois: 1 },
    { id: "b", idee: "refrain", nom: "Refrain", fois: 2 },
    { id: "c", idee: "disparue", nom: "Pont", fois: 1 },
  ] }, idees);
  assert.deepEqual(a.passages.map((p) => [p.bloc, p.debut, p.fin]), [["a", 0, 16], ["b", 16, 48], ["b", 48, 80]]);
  assert.equal(a.fin, 80);
  const melodie = a.voix.find((v) => v.nom === "Mélodie").notes.map((n) => [n.d, n.h]);
  assert.deepEqual(melodie, [[0, 60], [4, 64], [16, 67], [32, 69], [48, 67], [64, 69]]);
  const accords = a.voix.find((v) => v.nom === "Accords").notes;
  assert.deepEqual([...new Set(accords.map((n) => n.d))], [16, 32, 48, 64]); // plaqués, rejoués à chaque mesure
  assert.equal(a.tempo, 90);
  // Le tempo du morceau l'emporte ; le MIDI a une piste par voix.
  const midi = midiDuMorceau({ titre: "Chanson", tempo: 120, blocs: [{ id: "b", idee: "refrain", nom: "Refrain", fois: 1 }] }, idees);
  assert.equal(new TextDecoder("latin1").decode(midi).match(/MTrk/g).length, 3);
});

test("le nom de la section suivante", () => {
  assert.equal(sectionSuivante([]), "Intro");
  assert.equal(sectionSuivante([{ nom: "Intro" }]), "Couplet");
  assert.equal(sectionSuivante([{ nom: "Intro" }, { nom: "Couplet" }]), "Refrain");
});

test("couleursDesIdees : une couleur par idée, qui ne bouge pas quand on réordonne ou répète", () => {
  const blocs = [
    { id: "a", idee: "pk3x9", nom: "Intro", fois: 1 },
    { id: "b", idee: "pa1b2", nom: "Couplet", fois: 2 },
    { id: "c", idee: "pz7q4", nom: "Refrain", fois: 1 },
    { id: "d", idee: "pa1b2", nom: "Couplet", fois: 1 },
  ];
  const c = couleursDesIdees(blocs);
  assert.equal(c.size, 3); // une entrée par idée, pas par bloc
  for (const v of c.values()) assert.ok(v >= 1 && v <= NB_COULEURS);
  assert.equal(new Set(c.values()).size, 3); // trois idées, trois couleurs
  // L'ordre des blocs et leur nombre de fois n'y changent rien.
  const autre = couleursDesIdees([blocs[3], blocs[2], { ...blocs[1], fois: 5 }, blocs[0]]);
  assert.deepEqual([...autre].sort(), [...c].sort());
  // Jusqu'à six idées, aucune couleur n'est partagée, même quand les empreintes se heurtent.
  const six = couleursDesIdees(Array.from({ length: NB_COULEURS }, (_, i) => ({ id: "b" + i, idee: "idee-" + i })));
  assert.equal(new Set(six.values()).size, NB_COULEURS);
  // Au-delà, on partage plutôt que de planter.
  assert.equal(couleursDesIdees(Array.from({ length: 9 }, (_, i) => ({ id: "b" + i, idee: "idee-" + i }))).size, 9);
  assert.equal(couleursDesIdees([]).size, 0);
});

test("structure : un segment par bloc, aussi long que ses passages ; une idée disparue est muette", () => {
  const idees = new Map([
    ["intro", idee("intro", [[0, 4, 60], [4, 4, 64]])],                  // une mesure
    ["refrain", idee("refrain", [[0, 16, 67], [16, 8, 69]])],            // deux mesures
  ]);
  const s = structure({ tempo: 120, blocs: [
    { id: "a", idee: "intro", nom: "Intro", fois: 1 },
    { id: "b", idee: "refrain", nom: "Refrain", fois: 2 },
    { id: "c", idee: "disparue", nom: "Pont", fois: 1 },
  ] }, idees);
  assert.deepEqual(s.segments.map((x) => [x.bloc, x.mesures, x.fois, x.pas, x.debut, x.fin, x.manque]), [
    ["a", 1, 1, 16, 0, 16, false],
    ["b", 4, 2, 64, 16, 80, false],
    ["c", 0, 1, 0, 0, 0, true],
  ]);
  assert.equal(s.mesures, 5);
  assert.equal(s.pas, 80);
  // 80 pas = 20 temps, à 120 par minute : dix secondes.
  assert.equal(s.secondes, 10);
  assert.equal(s.tempo, 120);
  assert.equal(s.segments[0].couleur !== s.segments[1].couleur, true);
  assert.equal(s.segments[2].couleur, 0);
  assert.equal(structure({ blocs: [] }, idees).segments.length, 0);
});

test("dureeEnTexte : minutes et secondes", () => {
  assert.equal(dureeEnTexte(117), "1:57");
  assert.equal(dureeEnTexte(0), "0:00");
  assert.equal(dureeEnTexte(61.6), "1:02");
  assert.equal(dureeEnTexte(-3), "0:00");
});
