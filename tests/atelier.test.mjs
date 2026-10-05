/**
 * Les pièces sans page de « Corriger » (atelier.js, lot atelier) : ce
 * qu'abcjs reproche au texte ABC, dit en français.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { avertissementAbc, pourGravure } from "../app/atelier.js";
import { cadreAvis, cadrePage, dessinerPassage } from "../app/manuscrit.js";
import { lireFichier } from "../outils/lire.mjs";

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

test("H1 · le passage d'un doute, pour Claude : sa boîte, toute sa portée et ses lignes supplémentaires, sans sortir de la page", async () => {
  const r = await lireFichier("tests/pages/2026-09-30-melodie-standard.pdf");
  const { cal } = r, il = cal.interligne, page = cadrePage(cal);
  for (const d of r.doutes) {
    const v = cadreAvis(cal, d.boite);
    assert.ok(v.x <= d.boite.x0 && v.x + v.w >= d.boite.x1 && v.y <= d.boite.y0 && v.y + v.h >= d.boite.y1, `${d.type} : la boîte dépasse`);
    const p = cal.systemes.flatMap((s) => s.portees)[d.portee];
    assert.ok(v.y <= p.lignes[0] - 2 * il && v.y + v.h >= p.lignes[4] + 2 * il, `${d.type} : la portée n'est pas entière`);
    assert.ok(v.x >= page.gauche && v.x + v.w <= page.droite && v.y >= 0 && v.y + v.h <= page.hauteur, `${d.type} : hors de la page`);
  }
  // Au bord de la page : le cadre s'arrête au bord.
  const bord = cadreAvis(cal, { x0: page.gauche + 2, y0: 4, x1: page.gauche + 20, y1: 30 });
  assert.deepEqual([bord.x, bord.y], [page.gauche, 0]);
  // Le dessin : du blanc, les lignes, tes traits, un numéro par tête (dans l'ordre donné).
  const appels = [];
  const ctx = new Proxy({}, { get: (_o, nom) => (...args) => appels.push([nom, ...args]), set: (_o, nom, v) => { appels.push([`=${String(nom)}`, v]); return true; } });
  const vue = cadreAvis(cal, r.doutes[0].boite);
  const tetes = r.lues[0].tetes.slice(0, 3);
  dessinerPassage(ctx, cal, r.pages[0].traits, { vue, echelle: 2, tetes });
  assert.deepEqual(appels.slice(0, 2), [["=fillStyle", "#ffffff"], ["fillRect", 0, 0, vue.w * 2, vue.h * 2]]);
  assert.deepEqual(appels.filter(([n]) => n === "fillText").map((x) => x[1]), ["1", "2", "3"]);
  assert.equal(appels.filter(([n]) => n === "stroke").length, cal.systemes.flatMap((s) => s.portees).length * 5 + r.pages[0].traits.filter((t) => t.length >= 2).length);
});
