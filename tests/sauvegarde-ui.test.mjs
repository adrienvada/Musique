/**
 * Tests de sauvegarde-ui.js : ce que la restauration a fait, dit en une
 * phrase (combien sont revenues, combien étaient déjà là, lesquelles n'ont
 * pas pu revenir et pourquoi), avec le mot juste pour ce qui est revenu :
 * des idées, des morceaux, des partitions, ou des « éléments » quand on ne
 * sait pas le dire (B12).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bilanRestauration, messageSauvegarde, sortesRevenues } from "../app/sauvegarde-ui.js";

test("le bilan d'une restauration, en une phrase", () => {
  assert.equal(bilanRestauration({}), "Cette sauvegarde est vide.");
  assert.equal(bilanRestauration({ ignorees: 3 }), "Rien à restaurer : tout est déjà dans ta bibliothèque.");
  assert.equal(bilanRestauration({ revenues: 1 }), "1 élément revenu.");
  assert.equal(bilanRestauration({ revenues: 2, ignorees: 1, differentes: 1 }), "2 éléments revenus · 1 déjà là (dont 1 modifié depuis, gardé tel quel).");
  const echecs = [1, 2, 3, 4].map((i) => ({ titre: `P${i}`, raison: "illisible" }));
  assert.equal(bilanRestauration({ echecs }), "4 n'ont pas pu revenir : « P1 » (illisible), « P2 » (illisible), « P3 » (illisible)….");
});

test("ce qui est revenu se dit par sorte : une idée n'est pas une partition (B12)", () => {
  assert.equal(bilanRestauration({ revenues: 2, sortes: { idee: 2 } }), "2 idées revenues.");
  assert.equal(bilanRestauration({ revenues: 3, sortes: { idee: 1, morceau: 1, partition: 1 } }), "1 idée, 1 morceau et 1 partition revenus.");
  assert.equal(bilanRestauration({ revenues: 1, sortes: { partition: 1 } }), "1 partition revenue.");
  // Un compte qui ne tombe pas juste : on ne se trompe pas de sorte.
  assert.equal(bilanRestauration({ revenues: 3, sortes: { idee: 2 } }), "3 éléments revenus.");
});

test("les sortes revenues, d'après la sauvegarde : ni ce qui était là, ni ce qui a échoué", () => {
  const contenu = {
    partitions: [
      { id: "a", donnees: { type: "idee" } },
      { id: "b", donnees: { type: "morceau" } },
      { id: "c", donnees: { statut: "prete" } },
      { id: "d", donnees: { type: "idee" } }, // déjà là
      { id: "e", donnees: { type: "idee" } }, // n'a pas pu revenir
      { id: "a", donnees: { type: "idee" } }, // en double dans le fichier
    ],
  };
  const sortes = sortesRevenues(contenu, new Set(["d"]), { revenues: 3, echecs: [{ id: "e" }] });
  assert.deepEqual(sortes, { idee: 1, morceau: 1, partition: 1 });
  // Le stockage en dit un autre nombre : on ne devine pas.
  assert.equal(sortesRevenues(contenu, new Set(["d"]), { revenues: 2, echecs: [{ id: "e" }] }), null);
  assert.equal(sortesRevenues({}, new Set(), { revenues: 0, echecs: [] }).idee, 0);
});

test("le message de la sauvegarde dit ce qu'elle contient", () => {
  assert.equal(messageSauvegarde([{ type: "idee" }, { type: "idee" }, { statut: "prete" }]), "2 idées et 1 partition sauvegardées.");
  assert.equal(messageSauvegarde([{ type: "morceau" }]), "1 morceau sauvegardé.");
  assert.equal(messageSauvegarde([]), "Sauvegarde faite.");
});
