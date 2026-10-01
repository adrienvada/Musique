/**
 * Les morceaux : des idées bout à bout, répétées, avec leur accompagnement ;
 * un bloc dont l'idée a disparu est sauté.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assembler, midiDuMorceau, sectionSuivante } from "../app/morceau.js";
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
