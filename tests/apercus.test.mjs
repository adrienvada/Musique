/**
 * Tests d'apercus.js : ce que la vignette d'une page lue garde de ses
 * traits à l'import (le haut de la page, allégé).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { apercuTraits } from "../app/apercus.js";

test("la vignette d'une page garde ses neuf premiers interlignes, un point sur trois, arrondis", () => {
  const cal = { interligne: 10 };
  const haut = [[0.4, 0.2], [1, 1], [2, 2], [3.6, 3.4], [4, 4]];
  const bas = [[0, 200], [5, 205]]; // sous les neuf interlignes : la vignette ne le montre pas
  assert.deepEqual(apercuTraits([haut, bas], cal), [[[0, 0], [4, 3], [4, 4]]]);
});

test("une page très chargée ne garde que 400 traits", () => {
  const traits = Array.from({ length: 500 }, (_, i) => [[i, 0], [i, 1]]);
  assert.equal(apercuTraits(traits, { interligne: 10 }).length, 400);
});
