/**
 * Tests de garde.js : ce que les Réglages disent de la bibliothèque rangée
 * dans ce navigateur (D9) — protégée ou non, la place prise, le guide
 * d'installation quand Safari peut tout effacer —, le rappel de sauvegarde
 * sans synchronisation, et le compte par sorte des messages de sauvegarde
 * (B12 : une idée n'est pas une partition).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { accordeA, compteParSorte, garde, rappelSauvegarde, RAPPEL_JOURS, sorteDe, tailleLisible } from "../app/garde.js";

const ETAT = { protege: true, utilise: 3_400_000, quota: 120e9, installee: false, ios: false, safari: false, risque: false };
const JOUR = 86400000;
const MAINTENANT = Date.parse("2026-10-05T12:00:00Z");

test("une taille dite comme le téléphone la dit", () => {
  assert.equal(tailleLisible(820), "820 octets");
  assert.equal(tailleLisible(12_345), "12 Ko");
  assert.equal(tailleLisible(3_400_000), "3,4 Mo");
  assert.equal(tailleLisible(1_200_000_000), "1,2 Go");
  assert.equal(tailleLisible(56_000_000), "56 Mo");
  assert.equal(tailleLisible(null), "");
  assert.equal(tailleLisible(-1), "");
});

test("protégée ou non : ce que le navigateur a promis, sauf Safari sans installation", () => {
  assert.deepEqual(garde(ETAT), { protegee: "Oui", place: "3,4 Mo", proteger: false, conseil: null, guide: null });
  // Chrome sans promesse : on peut la redemander.
  const chrome = garde({ ...ETAT, protege: false, risque: true });
  assert.equal(chrome.protegee, "Non");
  assert.equal(chrome.proteger, true);
  assert.match(chrome.conseil, /manque de place/);
  assert.equal(chrome.guide, null);
  // Un navigateur qui ne sait pas le dire.
  assert.equal(garde({ ...ETAT, protege: null }).protegee, "On ne sait pas");
  // Pas d'état du tout (le navigateur a refusé) : rien ne casse.
  assert.deepEqual(garde(null), { protegee: "On ne sait pas", place: "", proteger: false, conseil: null, guide: null });
});

test("sur l'iPhone, sans installation : non protégée, et le guide de l'écran d'accueil, avec son pourquoi", () => {
  const g = garde({ ...ETAT, protege: true, ios: true, safari: true, risque: true });
  // Même promise, la bibliothèque de Safari s'efface au bout de 7 jours sans visite.
  assert.equal(g.protegee, "Non");
  assert.equal(g.proteger, false); // redemander à Safari n'y changerait rien
  assert.equal(g.guide.titre, "Installe Portée sur l'écran d'accueil");
  assert.match(g.guide.etapes.join(" "), /Partager.*Sur l'écran d'accueil/);
  assert.match(g.guide.pourquoi, /7 jours sans visite/);
  // L'appli installée repart de la synchronisation, ou d'une sauvegarde.
  assert.match(g.guide.apres, /sauvegarde/);
  assert.match(garde({ ...ETAT, ios: true, safari: true, risque: true }, { synchronisee: true }).guide.apres, /synchronisation/);
  // Installée : rien à faire.
  assert.equal(garde({ ...ETAT, ios: true, safari: true, installee: true }).guide, null);
  // Safari sur un Mac : le Dock.
  assert.match(garde({ ...ETAT, safari: true, risque: true }).guide.etapes.join(" "), /Ajouter au Dock/);
});

test("le rappel de sauvegarde : sans synchronisation, au-delà de 30 jours", () => {
  const il = (jours) => new Date(MAINTENANT - jours * JOUR).toISOString();
  assert.equal(rappelSauvegarde({ derniere: il(RAPPEL_JOURS), maintenant: MAINTENANT }), null);
  assert.match(rappelSauvegarde({ derniere: il(45), maintenant: MAINTENANT }), /date de 45 jours/);
  // Jamais sauvegardée : depuis la plus ancienne partition.
  assert.equal(rappelSauvegarde({ plusAncienne: il(3), maintenant: MAINTENANT }), null);
  assert.match(rappelSauvegarde({ plusAncienne: il(40), maintenant: MAINTENANT }), /jamais sauvegardé/);
  // Une bibliothèque vide, la synchronisation, ou claude.ai : pas de rappel.
  assert.equal(rappelSauvegarde({ maintenant: MAINTENANT }), null);
  assert.equal(rappelSauvegarde({ derniere: il(90), synchronisee: true, maintenant: MAINTENANT }), null);
  assert.equal(rappelSauvegarde({ derniere: il(90), surClaude: true, maintenant: MAINTENANT }), null);
  // Une date abîmée ne fait rien dire de faux.
  assert.equal(rappelSauvegarde({ derniere: "zzz", maintenant: MAINTENANT }), null);
});

test("le compte par sorte, et l'accord qui va avec (B12)", () => {
  const c = compteParSorte({ idee: 2, morceau: 1, partition: 3 });
  assert.deepEqual(c, { texte: "2 idées, 1 morceau et 3 partitions", total: 6, feminin: false });
  assert.equal(accordeA(c, "sauvegardé"), "sauvegardés");
  const idees = compteParSorte({ idee: 2 });
  assert.equal(idees.texte, "2 idées");
  assert.equal(accordeA(idees, "revenu"), "revenues");
  assert.equal(accordeA(compteParSorte({ morceau: 1 }), "revenu"), "revenu");
  assert.equal(accordeA(compteParSorte({ partition: 1 }), "sauvegardé"), "sauvegardée");
  assert.deepEqual(compteParSorte({}), { texte: "", total: 0, feminin: true });
  assert.equal(sorteDe({ type: "idee" }), "idee");
  assert.equal(sorteDe({ type: "morceau" }), "morceau");
  assert.equal(sorteDe({ statut: "prete" }), "partition");
  assert.equal(sorteDe(null), "partition");
});
