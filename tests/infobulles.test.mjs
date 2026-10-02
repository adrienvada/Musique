/**
 * Les infobulles de l'appui long : ce qu'elles disent (sans les raccourcis
 * clavier, inutiles au doigt) et où elles se posent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { texteInfobulle, placerInfobulle } from "../app/infobulles.js";

test("la bulle dit le titre ou l'étiquette, le plus long, sans raccourci clavier", () => {
  assert.equal(texteInfobulle("Envoyer le MIDI (AirDrop, Fichiers, mail…) ou le télécharger", "Envoyer le MIDI"), "Envoyer le MIDI (AirDrop, Fichiers, mail…) ou le télécharger");
  assert.equal(texteInfobulle("Un demi-ton plus haut (↑)", "Un demi-ton plus haut"), "Un demi-ton plus haut");
  assert.equal(texteInfobulle("Une octave plus haut (Maj + ↑)", null), "Une octave plus haut");
  assert.equal(texteInfobulle("Refaire (Ctrl+Maj+Z)", "Refaire"), "Refaire");
  assert.equal(texteInfobulle("Effacer (Retour arrière)", ""), "Effacer");
  assert.equal(texteInfobulle("Pointée (.)", "Pointée"), "Pointée");
  assert.equal(texteInfobulle("Croche (2)", null), "Croche");
  // Une parenthèse qui n'est pas un raccourci reste.
  assert.equal(texteInfobulle("La grille (piano roll)", "Grille"), "La grille (piano roll)");
  assert.equal(texteInfobulle(null, "Mon idée (ouvrir les réglages)"), "Mon idée (ouvrir les réglages)");
  // Ni titre ni étiquette : le texte du bouton, ses espaces resserrés.
  assert.equal(texteInfobulle(null, null, "\n  Une piste   de basse \n"), "Une piste de basse");
  assert.equal(texteInfobulle(null, null, ""), "");
});

const fenetre = { largeur: 390, hauteur: 844, haut: 0 };

test("la bulle se pose au-dessus de l'icône, centrée, la pointe vers elle", () => {
  const p = placerInfobulle({ cible: { left: 175, right: 215, top: 500, bottom: 540 }, largeur: 120, hauteur: 36, fenetre });
  assert.deepEqual(p, { left: 135, top: 454, dessous: false, fleche: 60 });
});

test("au bord de l'écran, la bulle rentre et sa pointe reste sur l'icône", () => {
  const p = placerInfobulle({ cible: { left: 340, right: 384, top: 500, bottom: 544 }, largeur: 200, hauteur: 36, fenetre });
  assert.equal(p.left, 390 - 200 - 8);
  assert.equal(p.fleche, 362 - 182);
  const g = placerInfobulle({ cible: { left: 2, right: 46, top: 500, bottom: 544 }, largeur: 200, hauteur: 36, fenetre });
  assert.equal(g.left, 8);
  assert.equal(g.fleche, 16);
});

test("une icône de la barre du haut : la bulle passe dessous (et sous l'encoche)", () => {
  const p = placerInfobulle({ cible: { left: 300, right: 344, top: 6, bottom: 50 }, largeur: 160, hauteur: 36, fenetre });
  assert.equal(p.dessous, true);
  assert.equal(p.top, 60);
  // Avec une encoche de 47 px, une icône à 60 px du haut n'a pas la place au-dessus non plus.
  const q = placerInfobulle({ cible: { left: 300, right: 344, top: 60, bottom: 104 }, largeur: 160, hauteur: 36, fenetre: { ...fenetre, haut: 47 } });
  assert.equal(q.dessous, true);
});
