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
  latenceRetenue, latenceDesTapes, nonGardees, nouvellePrise, noterDebut, noterFin, noterPedale, fermerPrise, enCoursDe, brutesDeCapture, REGLAGE,
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
});

test("les icônes du jeu en direct et de la capture existent", () => {
  for (const nom of ["rec", "stop", "ok", "annuler", "fermer", "onde", "taper"]) assert.ok(ICONES[nom], `icône ${nom}`);
});

// --- La latence, la pédale, la levée, la capture (audit du 04/10 : M6, M9, M11, M13) -------

test("la latence retenue : 0 tant qu'on ne l'a pas réglée, bornée sinon", () => {
  assert.equal(latenceRetenue(null), 0);
  assert.equal(latenceRetenue(""), 0);
  assert.equal(latenceRetenue("abc"), 0);
  assert.equal(latenceRetenue("42"), 42);
  assert.equal(latenceRetenue("-30"), -30);
  assert.equal(latenceRetenue("5000"), 400);
  assert.equal(latenceRetenue("-900"), -150);
});

test("régler la latence : la médiane des écarts au clic, sans les tapes égarées", () => {
  const intervalle = 60 / REGLAGE.tempo; // 0,6 s
  const clics = Array.from({ length: REGLAGE.clics }, (_, i) => 10 + i * intervalle);
  // Sept tapes, une quarantaine de millisecondes après le clic ; une huitième égarée entre deux clics.
  const ecarts = [0.035, 0.042, 0.038, 0.05, 0.041, 0.039, 0.044];
  const tapes = ecarts.map((x, i) => clics[i + 2] + x);
  tapes.push(clics[9] + intervalle / 2);
  const r = latenceDesTapes(tapes, clics);
  assert.equal(r.gardees, 7);
  assert.equal(r.latence, 41);
  // On anticipe le clic (habituel au doigt) : la latence est négative.
  assert.equal(latenceDesTapes(clics.slice(2, 10).map((c) => c - 0.02), clics).latence, -20);
  // Trop peu de tapes avec le clic : pas de réglage.
  assert.equal(latenceDesTapes([clics[3] + 0.04, clics[4] + 0.04], clics), null);
  assert.equal(latenceDesTapes([], [1]), null);
});

test("la pédale de maintien : une note relâchée dure jusqu'au lever de la pédale, ou jusqu'à la même note rejouée", () => {
  const p = nouvellePrise();
  noterDebut(p, 60, 90, 0);
  noterPedale(p, true, 1);
  noterFin(p, 60, 2);           // relâchée sous la pédale : elle tient
  noterDebut(p, 64, 80, 3);
  noterFin(p, 64, 4);
  noterDebut(p, 60, 70, 5);     // le do rejoué : l'ancien s'arrête là
  assert.deepEqual(p.notes, [{ h: 60, debut: 0, fin: 5, v: 90 }]);
  assert.deepEqual(enCoursDe(p).map((x) => x.h).sort(), [60, 64]);
  noterPedale(p, false, 8);     // la pédale se relève : le mi finit là ; le do, encore enfoncé, continue
  assert.deepEqual(p.notes.map((n) => [n.h, n.debut, n.fin]), [[60, 0, 5], [64, 3, 8]]);
  noterFin(p, 60, 9);
  assert.deepEqual(p.notes.at(-1), { h: 60, debut: 5, fin: 9, v: 70 });
  // Sans pédale, rien ne change : la note finit au relâchement.
  const q = nouvellePrise();
  noterDebut(q, 62, 90, 0);
  noterFin(q, 62, 1.5);
  assert.deepEqual(q.notes, [{ h: 62, debut: 0, fin: 1.5, v: 90 }]);
  // L'arrêt ferme ce qui sonnait encore, touches et pédale.
  const r = nouvellePrise();
  noterPedale(r, true, 0);
  noterDebut(r, 60, 90, 0); noterFin(r, 60, 1);
  noterDebut(r, 67, 90, 2);
  fermerPrise(r, 6);
  assert.deepEqual(r.notes.map((n) => [n.h, n.fin]).sort((a, b) => a[0] - b[0]), [[60, 6], [67, 6]]);
});

test("la levée jouée pendant le décompte : on dit combien de notes ne sont pas gardées (le comportement ne change pas)", () => {
  // Une prise à partir de la mesure 2 (pas 16) : deux croches avant le premier temps, puis la phrase.
  const brutes = [
    { h: 67, debut: 12, fin: 13.8 },
    { h: 69, debut: 14, fin: 15.8 },
    { h: 72, debut: 16.1, fin: 19.8 },
  ];
  assert.equal(nonGardees(brutes, 2, 16), 2);
  assert.deepEqual(arrondir(brutes, 2, 16).map((n) => n.h), [72]);
  // Une note commencée pendant le décompte mais tenue au-delà du premier temps est gardée (raccourcie).
  assert.equal(nonGardees([{ h: 60, debut: 15, fin: 19 }], 2, 16), 0);
  assert.equal(nonGardees([{ h: 60, debut: 16.2, fin: 19 }], 2, 16), 0);
});

test("la capture : la dernière phrase, calée sur le tempo à partir de la première note, ou dans la boucle qui tourne", () => {
  // À 120 : un pas (une double croche) dure 125 ms.
  const jouees = [
    { h: 60, v: 90, debut: 10000, fin: 10230 },
    { h: 62, v: 80, debut: 10260, fin: 10490 },
    { h: 64, v: 85, debut: 10500, fin: 10990 },
  ];
  const libres = brutesDeCapture(jouees, { depart: 8, tempo: 120 });
  assert.deepEqual(libres.map((n) => Math.round(n.debut * 100) / 100), [8, 10.08, 12]);
  assert.deepEqual(arrondir(libres, 2, 8).map((n) => [n.d, n.l, n.h]), [[8, 2, 60], [10, 2, 62], [12, 4, 64]]);
  // Par-dessus une boucle de deux mesures (0 à 32) : la phrase commencée au pas 30 retombe au début.
  const dansBoucle = brutesDeCapture(jouees, { depart: 30, tempo: 120, boucle: [0, 32] });
  assert.deepEqual(dansBoucle.map((n) => Math.round(n.debut * 100) / 100), [30, 0.08, 2]);
  assert.ok(Math.abs(dansBoucle[2].fin - dansBoucle[2].debut - 490 / 125) < 1e-9, "la durée ne se replie pas");
  assert.deepEqual(brutesDeCapture([], { depart: 0, tempo: 90 }), []);
});
