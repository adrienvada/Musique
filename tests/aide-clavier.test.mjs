/**
 * L'AIDE DU CLAVIER DIT LES LETTRES DE TON CLAVIER (audit du 04/10, I12)
 *
 * Les touches jouent par leur place (`code`) : sur l'AZERTY d'Adrien, la
 * place de A porte Q. Sans la carte du navigateur (Safari, Firefox, la page
 * dans claude.ai), la disposition se devine des touches jouées, et seulement
 * quand une seule lui va.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dispositionDe, lettreSelon } from "../app/idee-clavier.js";

test("les lettres d'une place, selon la disposition", () => {
  assert.equal(lettreSelon("qwerty", "KeyA"), "a");
  assert.deepEqual(["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyZ", "KeyX"].map((c) => lettreSelon("azerty", c)), ["q", "z", "s", "e", "d", "w", "x"]);
  assert.deepEqual(["KeyZ", "KeyY"].map((c) => lettreSelon("qwertz", c)), ["y", "z"]);
  // Une place qui n'est pas une lettre ne dit rien (sauf ce qu'on sait d'elle).
  assert.equal(lettreSelon("qwerty", "Semicolon"), null);
  assert.equal(lettreSelon("azerty", "Semicolon"), "m");
});

test("la disposition se devine d'une touche qui la distingue, jamais d'une touche commune", () => {
  // S, E, D sont les mêmes sur les trois : rien n'est décidé.
  assert.equal(dispositionDe(new Map([["KeyS", "s"], ["KeyE", "e"], ["KeyD", "d"]])), null);
  assert.equal(dispositionDe(new Map([["KeyA", "q"]])), "azerty");
  assert.equal(dispositionDe(new Map([["KeyW", "z"]])), "azerty");
  assert.equal(dispositionDe(new Map([["KeyZ", "y"]])), "qwertz");
  // A tapé A : QWERTY ou QWERTZ, encore indécis ; Z tapé Z les départage.
  assert.equal(dispositionDe(new Map([["KeyA", "a"]])), null);
  assert.equal(dispositionDe(new Map([["KeyA", "a"], ["KeyZ", "z"]])), "qwerty");
  // Une disposition qu'on ne connaît pas (Dvorak…) : aucune ne va, rien n'est deviné.
  assert.equal(dispositionDe(new Map([["KeyS", "o"]])), null);
});
