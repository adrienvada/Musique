/**
 * Corriger une note au toucher : chaque geste réécrit le bon morceau d'ABC.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  lireJeton, deplacer, changerDuree, basculerPoint, alterer, basculerSilence, dupliquer, supprimer,
  decrire, hauteursMidi, armureA, dureeABC,
} from "../app/edition.js";

const abc = "X:1\nL:1/8\nK:C\nC2 D2 edc g2 GG G | [CEG]2 z2 ^F,3/2 _b/ c' |]";
const a = (texte) => abc.indexOf(texte);

test("lire les jetons : note, groupe lié, accord, silence, altérations et octaves", () => {
  assert.deepEqual(
    [a("C2"), a("edc"), a("[CEG]"), a("z2"), a("^F,"), a("_b/"), a("c'")].map((p) => {
      const j = lireJeton(abc, p);
      return [j.type, j.croches, abc.slice(j.debut, j.fin), decrire(j)];
    }),
    [
      ["note", 2, "C2", "do4, noire"],
      ["note", 1, "e", "mi5, croche"],
      ["accord", 2, "[CEG]2", "accord do4-mi4-sol4, noire"],
      ["silence", 2, "z2", "soupir"],
      ["note", 1.5, "^F,3/2", "fa♯3, croche pointée"],
      ["note", 0.5, "_b/", "si♭5, double croche"],
      ["note", 1, "c'", "do6, croche"],
    ],
  );
  assert.equal(lireJeton(abc, a("|")), null);
});

test("monter, descendre : les octaves se franchissent, l'altération tombe", () => {
  const j = lireJeton(abc, a("^F,"));
  assert.equal(deplacer(abc, j, 1).abc.slice(a("^F,"), a("^F,") + 4), "G,3/"); // 3/ = 3/2, comme le lecteur l'écrit
  const b = lireJeton(abc, a("_b/"));
  assert.equal(deplacer(abc, b, 1).abc.includes("c'/ c'"), true); // si5 → do6
  const c = lireJeton(abc, a("C2"));
  assert.equal(deplacer(abc, c, -1).abc.startsWith("X:1\nL:1/8\nK:C\nB,2 D2"), true); // do4 → si3
  const acc = lireJeton(abc, a("[CEG]"));
  assert.ok(deplacer(abc, acc, 2).abc.includes("[EGB]2"));
});

test("durées, point, altérations, silence", () => {
  const j = lireJeton(abc, a("D2"));
  assert.ok(changerDuree(abc, j, 1).abc.includes("C2 D edc"));
  assert.ok(basculerPoint(abc, j).abc.includes("C2 D3 edc"));
  const p = lireJeton(abc, a("^F,"));
  assert.ok(changerDuree(abc, p, 4).abc.includes("^F,6 ")); // pointée : reste pointée
  assert.ok(basculerPoint(abc, p).abc.includes(" ^F, _b")); // croche pointée → croche
  assert.ok(alterer(abc, j, "_").abc.includes("C2 _D2 edc"));
  assert.ok(alterer(abc, p, "^").abc.includes(" F,3/ ")); // le même dièse l'enlève
  assert.ok(basculerSilence(abc, j).abc.includes("C2 z2 edc"));
  const z = lireJeton(abc, a("z2"));
  assert.ok(basculerSilence(abc, z).abc.includes("[CEG]2 c2 ^F,"));
});

test("dupliquer et supprimer gardent les ligatures et les espaces", () => {
  const e = lireJeton(abc, a("edc"));
  const d = dupliquer(abc, e);
  assert.ok(d.abc.includes("C2 D2 eedc g2"));
  assert.equal(d.abc.slice(d.debut, d.fin), "e");
  const g = lireJeton(abc, a("g2"));
  assert.ok(dupliquer(abc, g).abc.includes("edc g2 g2 GG"));
  assert.ok(supprimer(abc, lireJeton(abc, a("D2"))).abc.includes("C2 edc"));
  assert.ok(supprimer(abc, lireJeton(abc, a("edc") + 1)).abc.includes("D2 ec g2"));
});

test("hauteurs MIDI selon l'armure en vigueur", () => {
  const texte = "K:C\nC B [K:Eb] e =e B";
  assert.deepEqual(armureA(texte, texte.indexOf(" e ")), { B: -1, E: -1, A: -1 });
  assert.deepEqual(hauteursMidi(lireJeton(texte, texte.indexOf(" e ") + 1), armureA(texte, texte.indexOf(" e "))), [75]); // mi♭5
  assert.deepEqual(hauteursMidi(lireJeton(texte, texte.indexOf("=e")), armureA(texte, texte.indexOf("=e"))), [76]);
  assert.deepEqual(hauteursMidi(lireJeton(texte, 4), armureA(texte, 4)), [60]); // do4 = 60
  assert.deepEqual(armureA("K:Am\n", 5), {});
  assert.equal(dureeABC(0.75), "3/4");
});
