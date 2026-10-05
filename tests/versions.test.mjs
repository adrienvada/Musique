/**
 * Tests de versions.js : ce qu'une version d'une partition a changé, dit en
 * une ligne quand c'est simple (D6), et ce qui reste avant que la corbeille
 * oublie une partition.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { accordeSorte, joursRestants, nomDeSorte, resteDansLaCorbeille, resumeChangement } from "../app/versions.js";

const seq = (notes, extra = {}) => ({ version: 1, tempo: 90, mesure: [4, 4], tonalite: "C", accords: [], pistes: [{ nom: "Mélodie", notes }], ...extra });
const n = (id, d, h = 60) => ({ id, d, l: 4, h });
const idee = (extra = {}) => ({ type: "idee", titre: "Pluie", etiquettes: [], note: "", favori: false, memo: null, sequence: seq([n(1, 0), n(2, 4)]), ...extra });
const page = (extra = {}) => ({ titre: "Valse", abc: "X:1\nK:C\nC2 D2|", statut: "a-relire", doutes: [{ leve: false }, { leve: false }], etiquettes: [], note: "", ...extra });

test("une idée : les notes, les accords, le tempo, le titre", () => {
  assert.equal(resumeChangement(idee(), idee({ sequence: seq([n(1, 0), n(2, 4), n(3, 8), n(4, 12)]) })), "2 notes de plus");
  assert.equal(resumeChangement(idee(), idee({ sequence: seq([n(1, 0)]) })), "1 note de moins");
  assert.equal(resumeChangement(idee(), idee({ sequence: seq([n(1, 0), n(2, 4, 64)]) })), "notes changées");
  // Deux appareils ont pu renuméroter : les mêmes notes ne sont pas un changement.
  assert.equal(resumeChangement(idee(), idee({ sequence: seq([n(7, 0), n(8, 4)]) })), "");
  assert.equal(resumeChangement(idee(), idee({ sequence: seq([n(1, 0), n(2, 4)], { accords: [{ d: 0, nom: "Am" }, { d: 16, nom: "F" }] }) })), "2 accords posés");
  const avecAccords = idee({ sequence: seq([n(1, 0), n(2, 4)], { accords: [{ d: 0, nom: "Am" }] }) });
  assert.equal(resumeChangement(avecAccords, idee()), "accords retirés");
  assert.equal(resumeChangement(avecAccords, idee({ sequence: seq([n(1, 0), n(2, 4)], { accords: [{ d: 0, nom: "C" }] }) })), "accords changés");
  assert.equal(resumeChangement(idee(), idee({ sequence: seq([n(1, 0), n(2, 4)], { tempo: 120 }) })), "tempo 120");
  assert.equal(resumeChangement(idee(), idee({ titre: "Pluie d'automne" })), "titre « Pluie d'automne »");
  // Deux changements au plus : au-delà, on ne détaille pas.
  assert.equal(resumeChangement(idee(), idee({ titre: "Neige", favori: true })), "titre « Neige » · en favori");
  assert.equal(resumeChangement(idee(), idee({ titre: "Neige", favori: true, note: "Lent." })), "titre « Neige » · note changée et d'autres changements");
});

test("une page lue : corrigée, des doutes réglés, prête", () => {
  assert.equal(resumeChangement(page(), page({ abc: "X:1\nK:C\nE2 D2|" })), "partition corrigée");
  assert.equal(resumeChangement(page(), page({ doutes: [{ leve: true }, { leve: false }] })), "1 doute réglé");
  assert.equal(resumeChangement(page(), page({ doutes: [{ leve: true }, { leve: true }], statut: "prete" })), "2 doutes réglés · marquée prête");
  assert.equal(resumeChangement(page({ statut: "prete" }), page()), "de nouveau à relire");
  assert.equal(resumeChangement(page(), page({ transposition: 2 })), "transposée");
});

test("un morceau, et ce que toutes les fiches ont : étiquettes, note, favori, mémo", () => {
  const morceau = (blocs) => ({ type: "morceau", titre: "Chanson", blocs, tempo: 90 });
  assert.equal(resumeChangement(morceau([{ id: "b1" }]), morceau([{ id: "b1" }, { id: "b2" }])), "1 partie de plus");
  assert.equal(resumeChangement(morceau([{ id: "b1" }, { id: "b2" }]), morceau([{ id: "b2" }, { id: "b1" }])), "parties changées");
  assert.equal(resumeChangement(idee({ etiquettes: ["nuit"] }), idee({ etiquettes: ["pluie"] })), "étiquettes +pluie −nuit");
  assert.equal(resumeChangement(idee({ note: "Lent." }), idee()), "note effacée");
  assert.equal(resumeChangement(idee({ favori: true }), idee()), "plus en favori");
  assert.equal(resumeChangement(idee(), idee({ memo: { duree: 3, type: "audio/webm" } })), "mémo ajouté");
  // Rien à dire, ou rien à quoi comparer : vide.
  assert.equal(resumeChangement(idee(), idee()), "");
  assert.equal(resumeChangement(null, idee()), "");
  assert.equal(resumeChangement(idee(), "abîmée"), "");
});

test("la corbeille : les jours qui restent, la sorte et son accord", () => {
  const maintenant = Date.parse("2026-10-05T12:00:00Z");
  assert.equal(joursRestants("2026-11-01T12:00:00Z", maintenant), 27);
  assert.equal(resteDansLaCorbeille("2026-11-01T12:00:00Z", maintenant), "encore 27 jours");
  assert.equal(resteDansLaCorbeille("2026-10-06T08:00:00Z", maintenant), "dernier jour");
  assert.equal(joursRestants("2026-10-01T00:00:00Z", maintenant), 0);
  assert.equal(joursRestants("zzz", maintenant), 0);
  assert.equal(nomDeSorte("idee"), "Idée");
  assert.equal(nomDeSorte("morceau"), "Morceau");
  assert.equal(nomDeSorte(null), "Partition");
  assert.equal(accordeSorte("idee", "revenu"), "revenue");
  assert.equal(accordeSorte("morceau", "revenu"), "revenu");
});
