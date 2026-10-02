/**
 * L'éditeur d'idée : ce qui se calcule sans écran. Où se pose la pilule de
 * la sélection, ce que dit la rangée de sélection, les six accords du mode
 * Accords, ce que dit l'aiguille de l'accordeur.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { placerPilule, nomDuChoix, GESTES } from "../app/idee-selection.js";
import { accordsDuPupitre } from "../app/idee-accords.js";
import { justesse } from "../app/idee-chant.js";
import { TOUCHES_ORDI } from "../app/idee-clavier.js";
import { nomNote } from "../app/sequence.js";
import { ICONES } from "../app/icones.js";

const zone = { left: 44, right: 390, top: 90, bottom: 500 };
const cadre = { left: 0, right: 390 };

test("la pilule se pose au-dessus des notes choisies, centrée", () => {
  const p = placerPilule({ boite: { left: 180, right: 220, top: 300, bottom: 320 }, zone, cadre, largeur: 280, hauteur: 52 });
  assert.equal(p.dessous, false);
  assert.equal(p.y, 300 - 10 - 52);
  assert.equal(p.x, 200 - 140);
});

test("sans place au-dessus, la pilule passe dessous", () => {
  const p = placerPilule({ boite: { left: 180, right: 220, top: 100, bottom: 120 }, zone, cadre, largeur: 280, hauteur: 52 });
  assert.equal(p.dessous, true);
  assert.equal(p.y, 130);
});

test("la pilule ne sort jamais de l'écran", () => {
  // Une note tout à droite : la pilule s'arrête au bord.
  let p = placerPilule({ boite: { left: 370, right: 389, top: 300, bottom: 320 }, zone, cadre, largeur: 280, hauteur: 52 });
  assert.equal(p.x + 280, 390 - 8);
  // Une note tout à gauche.
  p = placerPilule({ boite: { left: 46, right: 60, top: 300, bottom: 320 }, zone, cadre, largeur: 280, hauteur: 52 });
  assert.equal(p.x, 8);
  // Des notes sorties de la vue (défilée) : la pilule reste au bord de la zone.
  p = placerPilule({ boite: { left: 100, right: 140, top: 900, bottom: 920 }, zone, cadre, largeur: 280, hauteur: 52 });
  assert.equal(p.y, 500 - 8 - 52);
  p = placerPilule({ boite: { left: 100, right: 140, top: -400, bottom: -380 }, zone, cadre, largeur: 280, hauteur: 52 });
  assert.equal(p.y, 90 + 8);
});

test("la rangée de sélection dit la note et sa durée", () => {
  assert.equal(nomDuChoix([{ d: 0, l: 2, h: 71 }], "C", nomNote), "si4 · croche");
  assert.equal(nomDuChoix([{ d: 0, l: 6, h: 60 }], "C", nomNote), "do4 · noire pointée");
  assert.equal(nomDuChoix([{ d: 4, l: 4, h: 60 }, { d: 4, l: 4, h: 64 }], "C", nomNote), "accord do4-mi4 · noire");
  assert.equal(nomDuChoix([{ d: 0, l: 4, h: 60 }, { d: 4, l: 4, h: 62 }, { d: 8, l: 4, h: 64 }], "C", nomNote), "3 notes");
  assert.equal(nomDuChoix([], "C", nomNote), "");
});

test("les six accords du pupitre suivent la tonalité", () => {
  assert.deepEqual(accordsDuPupitre("C").map((a) => `${a.degre} ${a.nom}`), ["I C", "ii Dm", "iii Em", "IV F", "V G", "vi Am"]);
  assert.deepEqual(accordsDuPupitre("G").map((a) => a.nom), ["G", "Am", "Bm", "C", "D", "Em"]);
  // En mineur : la dominante majeure, et pas l'accord diminué du 2ᵉ degré.
  assert.deepEqual(accordsDuPupitre("Am").map((a) => `${a.degre} ${a.nom}`), ["i Am", "III C", "iv Dm", "V E", "VI F", "VII G"]);
});

test("l'aiguille de l'accordeur : juste à dix centièmes près", () => {
  assert.equal(justesse(0).classe, "juste");
  assert.equal(justesse(-9).classe, "juste");
  assert.equal(justesse(25).texte, "un peu haut");
  assert.equal(justesse(-25).texte, "un peu bas");
});

test("chaque geste du menu en cercle a son icône, et le clavier de l'ordinateur ses dix-huit touches", () => {
  for (const g of GESTES) assert.ok(ICONES[g.icone], `icône ${g.icone} (${g.id})`);
  assert.equal(new Set(GESTES.map((g) => g.id)).size, 12);
  assert.equal(Object.keys(TOUCHES_ORDI).length, 18);
});
