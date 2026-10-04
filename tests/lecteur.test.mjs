/**
 * Tests du lecteur sur les pages d'essai d'Adrien (30/09).
 *
 * Ils figent ce que le lecteur lit aujourd'hui. Un réglage qui change la
 * lecture d'une de ces pages doit être voulu : on met alors le test à jour,
 * dans le même commit, en expliquant pourquoi.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { lireFichier } from "../outils/lire.mjs";

const corps = (abc) => abc.split("\n").filter((l) => !/^[A-Za-z]:|^%%/.test(l)).join("\n");

test("page de piano : main droite liée, main gauche avec soupirs, 4/4 deviné", async () => {
  const r = await lireFichier("tests/pages/2026-09-30-piano-standard.pdf");
  assert.match(r.abc, /^M:4\/4$/m);
  // La barre finale de la main gauche est un seul trait repassé (deux traits à
  // 0,1 interligne) : depuis le 04/10 (audit, L19), c'est « | », plus « || ».
  assert.equal(corps(r.abc), "[V:1] GABc dcAG |\n[V:2] C,2 z2 G,,2 z2 |");
  assert.equal(r.doutes.length, 0);
});

test("page de mélodie : gamme, puis 12/8 en mi bémol avec levée et reprise", async () => {
  const r = await lireFichier("tests/pages/2026-09-30-melodie-standard.pdf");
  assert.equal(
    corps(r.abc),
    [
      "C2 D2 E2 F2 G2 A2 B2 c2",
      "[K:Eb][M:12/8]G |: c2 c2 edc g2 GG G | c2 c edc g2 z GG",
      // Deux ligatures séparées (sol do do | la sol fa), groupées par trois
      // comme en 12/8. Avant le 30/09 au soir, le lecteur les soudait à tort.
      // La barre du milieu est un trait repassé, à 0,1 interligne du premier :
      // une barre simple, plus « || » (audit du 04/10, L19).
      "c2 c agf gcc agf | gcc dedc z z2 G :|",
    ].join("\n"),
  );
  // Deux doutes attendus : un petit trait au bout d'une hampe, et la mesure
  // de 11 croches qui déborde sur la ligne suivante.
  assert.deepEqual(r.doutes.map((d) => d.portee), [1, 1]);
});

test("l'ABC produit se lit sans avertissement", async () => {
  for (const f of ["tests/pages/2026-09-30-piano-standard.pdf", "tests/pages/2026-09-30-melodie-standard.pdf"]) {
    const r = await lireFichier(f);
    const [tune] = abcjs.parseOnly(r.abc);
    assert.equal((tune.warnings || []).length, 0, `${f} : ${tune.warnings}`);
  }
});

test("arrondir les traits au demi-pixel (transport du connecteur) ne change aucune lecture", async () => {
  const { lirePartition } = await import("../lecteur/partition.js");
  for (const f of ["tests/pages/2026-09-30-piano-standard.pdf", "tests/pages/2026-09-30-melodie-standard.pdf"]) {
    const r = await lireFichier(f);
    const arrondis = r.pages.map((p) => p.traits.map((t) => t.map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2])));
    const res = lirePartition(arrondis, r.cal, { titre: "x" });
    assert.equal(corps(res.abc), corps(r.abc), f);
    assert.equal(res.doutes.length, r.doutes.length, f);
  }
});
