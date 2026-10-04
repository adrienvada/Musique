/**
 * Corriger une note au toucher : chaque geste réécrit le bon morceau d'ABC.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  lireJeton, deplacer, changerDuree, basculerPoint, alterer, basculerSilence, dupliquer, supprimer,
  decrire, hauteursMidi, armureA, dureeABC, changerArmure, cleA,
  alterationsAvant, hauteursMidiA, joindreAccord, faireTriolet, changerChiffrage, ajouterSilence,
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

test("changer l'armure d'une ligne : les autres lignes gardent la leur", () => {
  const abc = "X:1\nT:x\nM:4/4\nL:1/8\nK:C\nC2 D2 E2 F2 |\nG2 A2 B2 c2 |\nc2 B2 A2 G2 |";
  const ligne = (texte) => ({ debut: abc.indexOf(texte), fin: abc.indexOf("\n", abc.indexOf(texte)) === -1 ? abc.length : abc.indexOf("\n", abc.indexOf(texte)) });
  // Au milieu : la ligne reçoit [K:D], la suivante retrouve [K:C].
  const milieu = changerArmure(abc, ligne("G2 A2"), "D");
  assert.equal(milieu.abc, "X:1\nT:x\nM:4/4\nL:1/8\nK:C\nC2 D2 E2 F2 |\n[K:D]G2 A2 B2 c2 |\n[K:C]c2 B2 A2 G2 |");
  assert.equal(milieu.modif.length, 2);
  // La première ligne change l'en-tête plutôt que d'écrire deux armures de suite.
  assert.equal(changerArmure(abc, ligne("C2 D2"), "Eb").abc, "X:1\nT:x\nM:4/4\nL:1/8\nK:Eb\nC2 D2 E2 F2 |\n[K:C]G2 A2 B2 c2 |\nc2 B2 A2 G2 |");
  // Revenir à l'armure de l'en-tête retire le [K:] devenu inutile.
  assert.equal(changerArmure(milieu.abc, { debut: milieu.abc.indexOf("[K:D]"), fin: milieu.abc.indexOf("\n", milieu.abc.indexOf("[K:D]")) }, "C").abc.split("\n")[6], "G2 A2 B2 c2 |");
  assert.equal(changerArmure(abc, ligne("G2 A2"), "Z#"), null);
});

test("une altération vaut jusqu'à la barre : la note suivante se fait entendre altérée", () => {
  const texte = "K:C\n^F2 F2 G2 | F2 =F2 |";
  const j = (p) => lireJeton(texte, p);
  const deuxieme = texte.indexOf("F2", texte.indexOf("^F2") + 3);
  assert.deepEqual(alterationsAvant(texte, deuxieme), { F4: "^" });
  assert.deepEqual(hauteursMidiA(texte, j(deuxieme)), [66]); // fa♯4, comme le premier
  assert.deepEqual(hauteursMidi(j(deuxieme), {}), [65]); // sans la mesure : fa naturel (l'ancien comportement)
  const apresBarre = texte.indexOf("F2", texte.indexOf("|"));
  assert.deepEqual(hauteursMidiA(texte, j(apresBarre)), [65]); // la barre remet à zéro
  const re = "K:D\n=F2 F2 |";
  assert.deepEqual(hauteursMidiA(re, lireJeton(re, re.indexOf(" F2") + 1)), [65]); // le bécarre vaut aussi pour le fa suivant, malgré l'armure
});

test("refaire un accord, écrire un triolet, changer le chiffrage d'une ligne", () => {
  const abc = "X:1\nM:4/4\nL:1/8\nK:C\nB2 E2 G2 A2 |\nc2 d2 e2 f2 |";
  const b = lireJeton(abc, abc.indexOf("B2")), e = lireJeton(abc, abc.indexOf("E2"));
  const accord = joindreAccord(abc, b, e);
  assert.equal(accord.abc.split("\n")[4], "[EB]2 G2 A2 |");
  assert.equal(accord.abc.slice(accord.debut, accord.fin), "[EB]2");
  assert.equal(joindreAccord(abc, e, e), null);
  const groupe = "K:C\nGAB c2 c4 |";
  const t = faireTriolet(groupe, { debut: 4, fin: 7 });
  assert.equal(t.abc, "K:C\n(3GAB c2 c4 |");
  assert.equal(faireTriolet(t.abc, { debut: 6, fin: 9 }), null); // déjà un triolet
  const ligne2 = { debut: abc.indexOf("c2 d2"), fin: abc.length };
  assert.equal(changerChiffrage(abc, ligne2, "3/4").abc.split("\n")[5], "[M:3/4]c2 d2 e2 f2 |");
  assert.match(changerChiffrage(abc, { debut: abc.indexOf("B2"), fin: abc.indexOf("\n", abc.indexOf("B2")) }, "2/4").abc, /^M:2\/4$/m);
  assert.equal(changerChiffrage(abc, ligne2, "trois"), null);
});

test("une note liée garde sa liaison quand on supprime, copie ou complète autour d'elle", () => {
  const abc = "K:C\nc2- c2 c4 |";
  const c = lireJeton(abc, 4);
  assert.equal(c.fin, 6); // le « - » n'est pas dans le jeton
  assert.equal(dupliquer(abc, c).abc, "K:C\nc2- c2 c2 c4 |");
  assert.equal(supprimer(abc, c).abc, "K:C\nc2 c4 |");
  assert.equal(ajouterSilence(abc, c, 2).abc, "K:C\nc2- z2 c2 c4 |");
});

test("le lecteur et l'édition écrivent les durées de la même façon", async () => {
  const { dureeABC: duLecteur } = await import("../lecteur/partition.js");
  for (const d of [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 0.25]) assert.equal(duLecteur(d), dureeABC(d), `durée ${d}`);
});

test("au piano, l'armure change dans les deux voix du système, et chaque voix suit la sienne", () => {
  const piano = "X:1\nT:x\nM:4/4\nL:1/8\nK:Eb\n%%score {1 2}\nV:1 clef=treble\nV:2 clef=bass\n[V:1] C2 D2 |\n[V:2] C,4 |\n[V:1] [K:C]E2 F2 |\n[V:2] [K:C]E,4 |\n[V:1] G2 A2 |\n[V:2] G,4 |";
  const debut = piano.indexOf("[V:1] [K:C]"), fin = piano.indexOf("\n", piano.indexOf("[V:2] [K:C]"));
  assert.equal(cleA(piano, piano.indexOf("E,4")), "C");
  assert.equal(cleA(piano, piano.indexOf("C,4")), "Eb");
  const r = changerArmure(piano, { debut, fin }, "Eb");
  assert.deepEqual(r.abc.split("\n").slice(-4), ["[V:1] E2 F2 |", "[V:2] E,4 |", "[V:1] [K:C]G2 A2 |", "[V:2] [K:C]G,4 |"]);
});
