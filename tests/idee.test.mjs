/**
 * L'éditeur d'idée : ce qui se calcule sans écran. Où se pose la pilule de
 * la sélection, ce que dit la rangée de sélection, les six accords du mode
 * Accords, ce que dit l'aiguille de l'accordeur.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { placerPilule, nomDuChoix, titreDuChoix, lieuDuChoix, dureeCommune, GESTES, FAMILLES } from "../app/idee-selection.js";
import { disposer } from "../app/menu-radial.js";
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

test("le clavier de l'ordinateur a ses dix-huit touches", () => {
  assert.equal(Object.keys(TOUCHES_ORDI).length, 18);
});

test("la boîte à outils se titre par la note, ou par le nombre de notes choisies", () => {
  assert.equal(titreDuChoix([{ d: 0, l: 2, h: 71 }], "C", nomNote), "si4, croche");
  assert.equal(titreDuChoix([{ d: 4, l: 4, h: 60 }, { d: 4, l: 4, h: 64 }], "C", nomNote), "accord do4-mi4, noire");
  assert.equal(titreDuChoix([{ d: 0, l: 4, h: 60 }, { d: 4, l: 4, h: 62 }, { d: 8, l: 4, h: 64 }, { d: 12, l: 4, h: 65 }], "C", nomNote), "4 notes choisies");
});

test("la rangée de sélection dit où sont plusieurs notes, par la mesure de leur début", () => {
  const mesure = 16;
  assert.equal(lieuDuChoix([{ d: 16, l: 4 }, { d: 20, l: 4 }], mesure), "mesure 2");
  assert.equal(lieuDuChoix([{ d: 12, l: 4 }, { d: 16, l: 4 }, { d: 36, l: 8 }], mesure), "mesures 1 à 3");
  assert.equal(lieuDuChoix([], mesure), "");
});

test("la durée commune des notes choisies allume la boîte : une durée, pointée ou non, sinon rien", () => {
  assert.deepEqual(dureeCommune([{ l: 4 }, { l: 4 }]), { pas: 4, pointee: false });
  assert.deepEqual(dureeCommune([{ l: 6 }]), { pas: 4, pointee: true });
  assert.deepEqual(dureeCommune([{ l: 3 }]), { pas: 2, pointee: true });
  assert.equal(dureeCommune([{ l: 4 }, { l: 2 }]), null);
  assert.equal(dureeCommune([{ l: 5 }]), null);
  assert.equal(dureeCommune([]), null);
});

test("chaque geste du menu en cercle a son icône, sa famille, et le cercle les groupe", () => {
  for (const g of GESTES) {
    assert.ok(ICONES[g.icone], `icône ${g.icone} (${g.id})`);
    assert.ok(FAMILLES[g.famille], `famille de ${g.id}`);
  }
  assert.equal(new Set(GESTES.map((g) => g.id)).size, GESTES.length);
  // Les gestes d'une famille se suivent (sinon le cercle les séparerait).
  const suite = GESTES.map((g) => g.famille).filter((f, i, t) => f !== t[i - 1]);
  assert.equal(new Set(suite).size, suite.length, "chaque famille d'un seul tenant");

  const { angles, groupes } = disposer(GESTES);
  assert.equal(groupes.length, Object.keys(FAMILLES).length);
  const pas = (a, b) => ((angles[b] - angles[a]) * 180) / Math.PI;
  // Dans une famille : un pas ; d'une famille à l'autre : un pas et demi ; et le tour est bouclé.
  const intra = pas(0, 1), inter = pas(3, 4);
  assert.ok(Math.abs(inter - 1.5 * intra) < 1e-9, `creux de ${inter}° pour un pas de ${intra}°`);
  for (const g of groupes) for (let k = 1; k < g.indices.length; k++) assert.ok(Math.abs(pas(g.indices[k - 1], g.indices[k]) - intra) < 1e-9);
  const tour = pas(0, GESTES.length - 1) + inter;
  assert.ok(Math.abs(tour - 360) < 1e-9, `le tour fait ${tour}°`);
  // La hauteur monte : octave plus bas en premier, plus haut en dernier, et sur le côté gauche (le creux est en bas).
  const id = (nom) => GESTES.findIndex((g) => g.id === nom);
  const y = (nom) => Math.sin(angles[id(nom)]);
  assert.ok(y("octave-haut") < y("monter") && y("monter") < y("descendre") && y("descendre") < y("octave-bas"), "le plus haut est le plus haut à l'écran");
  // Sans famille : un cercle régulier, le premier geste en haut.
  const simple = disposer([{}, {}, {}, {}]);
  assert.ok(Math.abs(simple.angles[0] + Math.PI / 2) < 1e-9 && Math.abs(simple.angles[1] - simple.angles[0] - Math.PI / 2) < 1e-9);
});
