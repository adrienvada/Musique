/**
 * Tests de sauvegarde-ui.js : ce que la restauration a fait, dit en une
 * phrase (combien sont revenues, combien étaient déjà là, lesquelles n'ont
 * pas pu revenir et pourquoi).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bilanRestauration } from "../app/sauvegarde-ui.js";

test("le bilan d'une restauration, en une phrase", () => {
  assert.equal(bilanRestauration({}), "Cette sauvegarde est vide.");
  assert.equal(bilanRestauration({ ignorees: 3 }), "Rien à restaurer : tout est déjà dans ta bibliothèque.");
  assert.equal(bilanRestauration({ revenues: 1 }), "1 partition revenue.");
  assert.equal(bilanRestauration({ revenues: 2, ignorees: 1, differentes: 1 }), "2 partitions revenues · 1 déjà là (dont 1 modifiée depuis, gardée telle quelle).");
  const echecs = [1, 2, 3, 4].map((i) => ({ titre: `P${i}`, raison: "illisible" }));
  assert.equal(bilanRestauration({ echecs }), "4 n'ont pas pu revenir : « P1 » (illisible), « P2 » (illisible), « P3 » (illisible)….");
});
