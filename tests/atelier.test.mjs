/**
 * Les pièces sans page de « Corriger » (atelier.js, lot atelier) : ce
 * qu'abcjs reproche au texte ABC, dit en français.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { avertissementAbc, pourGravure } from "../app/atelier.js";

/** Les avertissements d'abcjs pour cet ABC, tel que l'atelier le grave (avec son préfixe). */
const avertissements = (abc) => abcjs.parseOnly(pourGravure(abc))[0].warnings || [];

test("I13 · ce qu'abcjs reproche au texte ABC se dit en français, à la ligne que tu vois", () => {
  const abc = "X:1\nT:Essai\nM:4/4\nL:1/8\nK:C\nC2 D2 E2 F2 | G2 h2 B2 c2 |\nC2 [CE G2 |\n(3(3CDE z4 |]\n";
  const a = avertissements(abc);
  assert.ok(a.length >= 3, a.join("\n"));
  // abcjs compte la ligne de gravure ajoutée en tête : la 6ᵉ ligne du texte est la sienne 7.
  assert.equal(avertissementAbc(a[0], a.length - 1), `Ligne 6, 18ᵉ caractère (« h ») : un caractère que la gravure ne connaît pas, ignoré. Et ${a.length - 1} autres endroits.`);
  const accord = a.find((x) => /chord/.test(x));
  assert.equal(avertissementAbc(accord), "Ligne 7, 11ᵉ caractère (« | ») : un accord qui n'est pas fermé (il manque « ] »).");
  assert.equal(avertissementAbc(a.find((x) => /triplet/.test(x))), "Ligne 8, 3ᵉ caractère (« ( ») : un triolet dans un triolet.");
  // Un reproche inconnu, ou sans place : une phrase quand même, jamais l'anglais.
  assert.equal(avertissementAbc("Something odd happened"), "Quelque part : un passage que la gravure ne comprend pas.");
  assert.equal(avertissementAbc("Music Line:9:2: Weird thing:  a<span>&lt;</span>b", 1), "Ligne 8, 2ᵉ caractère (« < ») : un passage que la gravure ne comprend pas. Et un autre endroit.");
  for (const x of a) assert.doesNotMatch(avertissementAbc(x), /Unknown|Expected|nest|span/);
  // Un ABC juste : rien à dire.
  assert.deepEqual(avertissements("X:1\nM:4/4\nL:1/8\nK:C\nC2 D2 E2 F2 |\n"), []);
});
