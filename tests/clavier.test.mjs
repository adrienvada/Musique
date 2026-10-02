/**
 * Le clavier à l'écran : ce qui se calcule sans écran. La gamme d'une
 * tonalité (les pastilles du piano), les huit touches du mode Gamme, la
 * fenêtre de la carte des octaves, le nombre de touches selon la largeur.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gammeDe, touchesDeGamme, fenetreOctaves, combien, LARGEUR_TOUCHE } from "../app/clavier.js";
import { TONALITES } from "../app/sequence.js";

const noms = (t, bas = 60) => touchesDeGamme(t, bas).map((p) => p.nom).join(" ");

test("la gamme de do majeur : les sept touches blanches, tonique do", () => {
  const g = gammeDe("C");
  assert.equal(g.tonique, 0);
  assert.deepEqual([...g.classes].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11]);
});

test("la gamme de la mineur : les mêmes notes, tonique la ; fa♯ mineur : trois dièses", () => {
  const g = gammeDe("Am");
  assert.equal(g.tonique, 9);
  assert.deepEqual([...g.classes].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11]);
  // Fa♯ mineur : fa♯ sol♯ la si do♯ ré mi, soit 6 8 9 11 1 2 4.
  assert.deepEqual([...gammeDe("F#m").classes].sort((a, b) => a - b), [1, 2, 4, 6, 8, 9, 11]);
});

test("chaque tonalité proposée a sept notes, dont sa tonique", () => {
  for (const t of TONALITES) {
    const g = gammeDe(t);
    assert.equal(g.classes.size, 7, t);
    assert.ok(g.classes.has(g.tonique), t);
  }
});

test("les huit touches du mode Gamme : sept degrés et l'octave, de la tonique", () => {
  const p = touchesDeGamme("C", 60);
  assert.deepEqual(p.map((x) => x.h), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual(p.map((x) => x.degre), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(p.map((x) => x.tonique), [true, false, false, false, false, false, false, true]);
  assert.equal(noms("C"), "Do Ré Mi Fa Sol La Si Do");
  assert.deepEqual(p.map((x) => x.octave), [4, 4, 4, 4, 4, 4, 4, 5]);
});

test("les touches de gamme portent le nom de la note dans la tonalité", () => {
  assert.equal(noms("G"), "Sol La Si Do Ré Mi Fa♯ Sol");
  assert.equal(noms("F"), "Fa Sol La Si♭ Do Ré Mi Fa");
  assert.equal(noms("Am"), "La Si Do Ré Mi Fa Sol La");
  assert.equal(noms("Dm"), "Ré Mi Fa Sol La Si♭ Do Ré");
  assert.equal(noms("Db"), "Ré♭ Mi♭ Fa Sol♭ La♭ Si♭ Do Ré♭");
});

test("la gamme commence à la première tonique à partir de l'octave montrée", () => {
  assert.deepEqual(touchesDeGamme("G", 60).map((x) => x.h), [67, 69, 71, 72, 74, 76, 78, 79]);
  assert.deepEqual(touchesDeGamme("Am", 48).map((x) => x.h), [57, 59, 60, 62, 64, 65, 67, 69]);
  // La note de chaque touche reste dans la gamme de l'idée : pas de fausse note.
  for (const t of TONALITES) {
    const classes = gammeDe(t).classes;
    for (const p of touchesDeGamme(t, 60)) assert.ok(classes.has(p.h % 12), `${t} ${p.nom}`);
  }
});

test("la carte des octaves ne bouge que si l'on en sort", () => {
  assert.equal(fenetreOctaves(4, 2), 2); // do2 à do6, l'ordinaire
  assert.equal(fenetreOctaves(2, 2), 2);
  assert.equal(fenetreOctaves(6, 2), 2);
  assert.equal(fenetreOctaves(1, 2), 1); // do1 : la carte descend d'une case
  assert.equal(fenetreOctaves(7, 2), 3); // do7 : elle monte d'une case
  assert.equal(fenetreOctaves(7, 3), 3);
  assert.equal(fenetreOctaves(5, 1), 1); // sans en sortir, elle reste où elle est
});

test("les touches blanches font au moins 44 px au doigt", () => {
  // Un téléphone de 390 px : 366 px de clavier, huit touches (une octave et un do).
  assert.equal(combien(366), 8);
  assert.ok(366 / combien(366) >= LARGEUR_TOUCHE);
  assert.equal(combien(936), 21); // trois octaves sur un ordinateur
  assert.equal(combien(200), 7); // jamais moins d'une octave
  assert.equal(combien(5000), 22);
});
