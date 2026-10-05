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
  // Deux doutes depuis le 30/09 : un petit trait au bout d'une hampe, et la
  // mesure de 11 croches qui déborde sur la ligne suivante. Depuis le 04/10
  // (audit, L2), les décisions prises au ras d'un seuil sont aussi des
  // questions, sans que l'ABC change : deux ligatures qui s'arrêtent à 0,47
  // interligne d'une hampe (le 2ᵉ sol de « GG », le do de « dedc » :
  // croche liée ou noire ?), et deux têtes de la 3ᵉ ligne à plus de 0,4
  // demi-interligne de leur place (la5 et sol5). Dans l'ordre de la page.
  assert.deepEqual(r.doutes.map((d) => [d.type, d.portee]), [["crochet", 1], ["ligature", 1], ["mesure", 1], ["hauteur", 2], ["hauteur", 2], ["ligature", 2]]);
  assert.deepEqual(r.doutes.filter((d) => d.type === "ligature").map((d) => [r.abc.slice(d.cible.debut, d.cible.fin), d.ecart, d.alternative.croches]), [["G", 0.47, 2], ["c", 0.47, 2]]);
});

test("l'ABC produit se lit sans avertissement", async () => {
  for (const f of ["tests/pages/2026-09-30-piano-standard.pdf", "tests/pages/2026-09-30-melodie-standard.pdf"]) {
    const r = await lireFichier(f);
    const [tune] = abcjs.parseOnly(r.abc);
    assert.equal((tune.warnings || []).length, 0, `${f} : ${tune.warnings}`);
  }
});

// Les doutes de marge (L2) existent justement au ras d'un seuil : un arrondi
// peut en faire apparaître ou disparaître un sans que la lecture change.
const MARGE = new Set(["hauteur", "ligature", "tete", "point"]);
const lecture = (r) => `${r.abc}\n${r.doutes.filter((d) => !MARGE.has(d.type)).map((d) => d.type).join(",")}`;

test("arrondir au demi-pixel, quelle que soit la phase, ne change pas la lecture (L14, L18)", async () => {
  // Avant le 04/10, c'était vrai pour une phase nulle seulement : avec une autre,
  // la mélodie se relisait autrement 42 fois sur 100 (une tête de 0,353 interligne
  // de large passait sous le seuil de 0,35).
  const { lirePartition } = await import("../lecteur/partition.js");
  for (const f of ["tests/pages/2026-09-30-piano-standard.pdf", "tests/pages/2026-09-30-melodie-standard.pdf"]) {
    const r = await lireFichier(f);
    const base = lecture(r);
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 6; k++) {
        const [px, py] = [i * 0.09, k * 0.09];
        const arrondis = r.pages.map((p) => p.traits.map((t) => t.map(([x, y]) => [Math.round((x + px) * 2) / 2 - px, Math.round((y + py) * 2) / 2 - py])));
        assert.equal(lecture(lirePartition(arrondis, r.cal, { titre: r.abc.match(/^T:(.*)$/m)[1] })), base, `${f}, phase (${px.toFixed(2)}, ${py.toFixed(2)})`);
      }
    }
  }
});

test("déplacer toute la page de ±0,1 px ne change rien, doutes compris (L18)", async () => {
  const { lirePartition } = await import("../lecteur/partition.js");
  for (const f of ["tests/pages/2026-09-30-piano-standard.pdf", "tests/pages/2026-09-30-melodie-standard.pdf"]) {
    const r = await lireFichier(f);
    const titre = r.abc.match(/^T:(.*)$/m)[1];
    const tout = (res) => `${res.abc}\n${res.doutes.map((d) => `${d.type}@${d.cible ? d.cible.debut : "-"}`).join(",")}`;
    const base = tout(r);
    for (const dx of [-0.1, 0, 0.1]) for (const dy of [-0.1, 0, 0.1]) {
      const decales = r.pages.map((p) => p.traits.map((t) => t.map(([x, y]) => [x + dx, y + dy])));
      assert.equal(tout(lirePartition(decales, r.cal, { titre })), base, `${f}, (${dx}, ${dy})`);
    }
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
