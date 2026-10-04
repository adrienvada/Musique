/**
 * Le jeu en direct : ce qui se calcule sans écran. Où en est la scène (le
 * chiffre du décompte, la mesure, le temps courant), le chrono, la page du
 * ruban et ses barres, et l'arrondi après coup avec chaque grille.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  GRILLES, DECOMPTES, decompteRetenu, grilleRetenue, etatScene, chrono, pageRuban,
  fenetreHauteurs, barresRuban, htmlBarres, htmlLignes, arrondir,
} from "../app/idee-direct.js";
import { ICONES } from "../app/icones.js";

const quatreQuatre = { mesure: 16, temps: 4 };

test("le décompte et la grille retenus : 1 mesure et la croche tant qu'on n'a rien choisi", () => {
  assert.equal(decompteRetenu(null), 1);
  assert.equal(decompteRetenu(""), 1);
  assert.equal(decompteRetenu("0"), 0);
  assert.equal(decompteRetenu("2"), 2);
  assert.equal(decompteRetenu("7"), 1);
  assert.equal(grilleRetenue(null), 2);
  assert.equal(grilleRetenue("4"), 4);
  assert.equal(grilleRetenue("1"), 1);
  assert.equal(grilleRetenue("3"), 2);
  assert.deepEqual(GRILLES.map((g) => g.pas), [4, 2, 1]);
  assert.deepEqual(DECOMPTES.map((d) => d.n), [0, 1, 2]);
});

test("le décompte dit 4, 3, 2, 1 au rythme des temps, puis la scène passe au jeu", () => {
  // La prise commence à la mesure 2 (pas 16) : le décompte occupe les pas 0 à 16.
  const s = (pas) => etatScene(pas, { depuis: 16, decompte: 1, ...quatreQuatre });
  assert.deepEqual([0, 3.9, 4, 8, 12, 15.9].map((p) => s(p).chiffre), [4, 4, 3, 2, 1, 1]);
  assert.deepEqual([0, 4, 8, 12].map((p) => s(p).temps), [0, 1, 2, 3]);
  assert.equal(s(0).phase, "decompte");
  assert.equal(s(0).nTemps, 4);
  const jeu = s(16);
  assert.deepEqual([jeu.phase, jeu.mesure, jeu.temps], ["jeu", 2, 0]);
  assert.deepEqual([21, 31.9].map((p) => s(p).temps), [1, 3]);
  assert.deepEqual([s(31.9).mesure, s(32).mesure, s(32).temps], [2, 3, 0]);
});

test("deux mesures de décompte : le chiffre repart de 4 à chaque mesure, la scène dit laquelle", () => {
  const s = (pas) => etatScene(pas, { depuis: 0, decompte: 2, ...quatreQuatre });
  assert.deepEqual([s(-32).chiffre, s(-32).tour, s(-32).tours], [4, 1, 2]);
  assert.deepEqual([s(-17).chiffre, s(-17).tour], [1, 1]);
  assert.deepEqual([s(-16).chiffre, s(-16).tour], [4, 2]);
  assert.deepEqual([s(-4).chiffre, s(-4).tour], [1, 2]);
  assert.equal(s(0).phase, "jeu");
});

test("sans décompte, on est tout de suite dans le jeu", () => {
  assert.deepEqual(etatScene(0, { depuis: 0, decompte: 0, ...quatreQuatre }), { phase: "jeu", mesure: 1, temps: 0, nTemps: 4 });
});

test("les temps suivent la mesure : 3 à la noire en 3/4, 2 à la noire pointée en 6/8", () => {
  const trois = { depuis: 0, decompte: 1, mesure: 12, temps: 4 };
  assert.deepEqual([-12, -8, -4].map((p) => etatScene(p, trois).chiffre), [3, 2, 1]);
  const six = { depuis: 0, decompte: 1, mesure: 12, temps: 6 };
  assert.deepEqual([-12, -6].map((p) => etatScene(p, six).chiffre), [2, 1]);
  assert.equal(etatScene(7, six).temps, 1);
  assert.equal(etatScene(7, six).nTemps, 2);
});

test("le chrono compte depuis le début du jeu, pas depuis le décompte", () => {
  // Tempo 120 : 8 pas par seconde.
  assert.equal(chrono(16, 16, 120), "0:00");
  assert.equal(chrono(8, 16, 120), "0:00"); // encore dans le décompte
  assert.equal(chrono(16 + 8, 16, 120), "0:01");
  assert.equal(chrono(16 + 8 * 61, 16, 120), "1:01");
  // Tempo 90 : une noire fait deux tiers de seconde.
  assert.equal(chrono(6 * 4, 0, 90), "0:04");
});

test("le ruban en direct montre deux mesures à la fois, et passe à la page suivante", () => {
  assert.deepEqual(pageRuban(0, 0, 16), { de: 0, a: 32 });
  assert.deepEqual(pageRuban(31.9, 0, 16), { de: 0, a: 32 });
  assert.deepEqual(pageRuban(32, 0, 16), { de: 32, a: 64 });
  // Une prise qui commence mesure 2 : la page part de là.
  assert.deepEqual(pageRuban(20, 16, 16), { de: 16, a: 48 });
  assert.deepEqual(pageRuban(5, 16, 16), { de: 16, a: 48 }); // le décompte : la première page
  // Mesures courtes : quatre ; longues : une.
  assert.equal(pageRuban(0, 0, 8).a, 32);
  assert.equal(pageRuban(0, 0, 24).a, 24);
});

test("les hauteurs du ruban : assez de demi-tons, et la fenêtre ne fait que grandir", () => {
  const f = fenetreHauteurs([64, 67]);
  assert.ok(f.haut - f.bas + 1 >= 12);
  assert.ok(f.bas <= 63 && f.haut >= 68);
  // En direct : on part d'une base ; une note plus haute l'agrandit, sans la ramener.
  const base = { bas: 55, haut: 77 };
  assert.deepEqual(fenetreHauteurs([], { rangsMin: 20, base }), base);
  assert.deepEqual(fenetreHauteurs([60], { rangsMin: 20, base }), base);
  const haut = fenetreHauteurs([84], { rangsMin: 20, base });
  assert.equal(haut.bas, 55);
  assert.equal(haut.haut, 85);
  // Sans note ni base : une fenêtre autour du do central.
  const vide = fenetreHauteurs([], { rangsMin: 10 });
  assert.ok(vide.bas <= 60 && vide.haut >= 72);
});

test("les barres d'un ruban : place en pour-cent, coupées au bord de la page", () => {
  const fen = { de: 0, a: 32, bas: 59, haut: 70 }; // 12 rangs
  const [a, b, c] = barresRuban([
    { d: 8, f: 16, h: 70 },   // le plus haut : tout en haut
    { d: 30, f: 40, h: 59 },  // déborde de la page
    { d: -4, f: 4, h: 64 },   // commence avant la page
    { d: 40, f: 44, h: 60 },  // hors de la page : rien
    { d: 4, f: 8, h: 80 },    // hors de la fenêtre des hauteurs : rien
  ], fen);
  assert.equal(a.x, 25);
  assert.equal(a.w, 25);
  assert.ok(Math.abs(a.y - 100 / 24) < 1e-9); // le milieu du premier rang sur douze
  assert.ok(Math.abs(a.hauteur - 100 / 12) < 1e-9);
  assert.equal(b.finCoupee, true);
  assert.equal(b.x + b.w, 100);
  assert.equal(c.debutCoupe, true);
  assert.equal(c.x, 0);
  assert.equal(barresRuban([{ d: 40, f: 44, h: 60 }], fen).length, 0);
  assert.equal(barresRuban([{ d: 4, f: 8, h: 80 }], fen).length, 0);
});

test("le HTML d'un ruban : une barre par note, un trait par temps, le numéro des mesures", () => {
  const html = htmlBarres(barresRuban([{ d: 0, f: 2, h: 64 }, { d: 4, f: 8, h: 67 }], { de: 0, a: 16, bas: 60, haut: 71 }), "fantome");
  assert.equal((html.match(/class="dir-note fantome/g) || []).length, 2);
  const lignes = htmlLignes({ de: 16, a: 48, mesure: 16, temps: 4, numeros: true });
  assert.equal((lignes.match(/dir-temps-ligne/g) || []).length, 8); // 2 mesures de 4 temps
  assert.equal((lignes.match(/dir-temps-ligne barre/g) || []).length, 2);
  assert.deepEqual([...lignes.matchAll(/dir-numero[^>]*>(\d+)</g)].map((m) => m[1]), ["2", "3"]);
  assert.equal((htmlLignes({ de: 0, a: 16, mesure: 16, temps: 4, grille: 2 }).match(/dir-pas/g) || []).length, 8);
});

test("arrondir : la même prise, trois grilles", () => {
  // Une phrase jouée un peu à côté du temps, à partir de la mesure 2 (pas 16).
  const brutes = [
    { h: 60, debut: 16.3, fin: 19.6 },
    { h: 62, debut: 19.8, fin: 23.2 },
    { h: 64, debut: 24.4, fin: 27.1 },
    { h: 65, debut: 27.7, fin: 31.9 },
  ];
  const croche = arrondir(brutes, 2, 16).map((n) => [n.d, n.l, n.h]);
  assert.deepEqual(croche, [[16, 4, 60], [20, 4, 62], [24, 4, 64], [28, 4, 65]]);
  // À la noire, tout tombe sur les temps ; à la double croche, on garde le détail.
  assert.deepEqual(arrondir(brutes, 4, 16).map((n) => n.d), [16, 20, 24, 28]);
  assert.deepEqual(arrondir(brutes, 1, 16).map((n) => n.d), [16, 20, 24, 28]);
  const fine = [{ h: 60, debut: 16.3, fin: 18.4 }, { h: 62, debut: 18.9, fin: 21.2 }];
  // Jeu lié : la première note, relâchée un pas avant la suivante, tient jusqu'à elle.
  assert.deepEqual(arrondir(fine, 1, 16).map((n) => [n.d, n.l]), [[16, 3], [19, 2]]);
  assert.deepEqual(arrondir(fine, 2, 16).map((n) => [n.d, n.l]), [[16, 2], [18, 4]]);
  assert.deepEqual(arrondir(fine, 4, 16).map((n) => [n.d, n.l]), [[16, 4], [20, 4]]);
  // Ce qui a été joué avant le premier temps (pendant le décompte) ne s'écrit pas.
  assert.deepEqual(arrondir([{ h: 60, debut: 10, fin: 11 }], 2, 16), []);
  // Des noires un peu détachées restent des noires, la dernière de la prise comprise.
  const detachees = [16, 20, 24, 28].map((d, i) => ({ h: 60 + i, debut: d + 0.2, fin: d + 2.6 }));
  assert.deepEqual(arrondir(detachees, 2, 16).map((n) => [n.d, n.l]), [[16, 4], [20, 4], [24, 4], [28, 4]]);
  // Deux attaques de la même note dans le même pas de grille n'en font qu'une : « 2 notes gardées », pas 3.
  assert.equal(arrondir([{ h: 60, debut: 16, fin: 16.6 }, { h: 60, debut: 16.8, fin: 17.6 }, { h: 60, debut: 18, fin: 19 }], 2, 16).length, 2);
});

test("les icônes du jeu en direct existent", () => {
  for (const nom of ["rec", "stop", "ok", "annuler", "fermer"]) assert.ok(ICONES[nom], `icône ${nom}`);
});
