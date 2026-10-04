/**
 * La bibliothèque synchronisée : deux « appareils » (deux bases IndexedDB),
 * le connecteur (protocole MCP, bibliotheque.js) et le stockage Supabase
 * (faux, mais le vrai client objets.js), de bout en bout. Les scénarios de
 * perte de données de l'audit viendront à part.
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { stockageIndexe } from "../app/stockage.js";
import { creerSynchro } from "../app/synchro.js";
import { Bibliotheque, LIMITES, verifierEcriture } from "../supabase/functions/portee-remarkable/bibliotheque.js";
import { objetsSupabase } from "../supabase/functions/portee-remarkable/objets.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { demarrerFauxStockage } from "./faux-cloud.mjs";

const pages = [[[[100, 200], [110, 210]], [[300, 400], [305, 450]]]]; // une page, deux traits
const partition = (titre, modifieLe, abc = "X:1\nK:C\nC2 D2|") => ({ titre, modele: "melodie-standard", abc, abcLu: abc, doutes: [], statut: "a-relire", nbPages: 1, creeLe: modifieLe, modifieLe });
const seq = (notes, accords = []) => ({ version: 1, tempo: 100, mesure: [4, 4], tonalite: "C", pistes: [{ nom: "Mélodie", notes }], accords, accompagnement: "aucun", suivant: 9 });
const idee = (titre, modifieLe, notes = [], extra = {}) => ({ type: "idee", titre, sequence: seq(notes), abc: "X:1", statut: "idee", nbPages: 0, modele: null, creeLe: modifieLe, modifieLe, ...extra });
const JOUR = 24 * 3600 * 1000;

let n = 0;
/** `appeler` rejette comme connecteurDirect : { code: "tool_error" } quand l'outil échoue. */
async function monde({ maintenant } = {}) {
  const stockage = await demarrerFauxStockage();
  const objets = objetsSupabase(stockage.url, stockage.cle);
  const bib = new Bibliotheque(objets, maintenant ? { maintenant } : {});
  const appeler = async (outil, args) => {
    const r = await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: outil, arguments: JSON.parse(JSON.stringify(args)) } }, null, bib);
    if (r.result.isError) throw Object.assign(new Error(r.result.content[0].text), { code: "tool_error", result: r.result });
    return r.result.structuredContent;
  };
  const appareil = async ({ appel = appeler, verrou } = {}) => {
    const local = await stockageIndexe(`essai-${n++}`);
    const etats = [];
    return { local, synchro: creerSynchro({ local, appeler: appel, surEtat: (e) => etats.push(e), ...(verrou ? { verrou } : {}) }), etats };
  };
  return { stockage, objets, bib, appeler, appareil };
}

const titres = async (local) => (await new Promise((ok) => local.ecouter(ok))).map((p) => p.titre).sort();
const objet = (stockage, chemin) => { const t = stockage.objet("portee-remarkable", chemin); return t && JSON.parse(t); };
const notesDe = (f) => f.sequence.pistes[0].notes.map((x) => x.h).sort((a, b) => a - b);

test("deux appareils : création, modification, suppression voyagent dans les deux sens", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("valse", partition("Valse", "2026-09-30T10:00:00.000Z"), pages);
    await ordi.synchro.synchroniser();
    assert.deepEqual(await ordi.local.enAttente(), []);
    const b = await tel.synchro.synchroniser();
    assert.deepEqual(b, { envoyees: 0, recues: 1 });
    assert.deepEqual(await titres(tel.local), ["Valse"]);
    assert.deepEqual(await tel.local.pages("valse"), pages); // les traits suivent
    // Le téléphone corrige ; l'ordinateur reçoit la correction, sans retélécharger les pages.
    await tel.local.modifier("valse", { abc: "X:1\nK:C\nE2 F2|", modifieLe: "2026-09-30T11:00:00.000Z" });
    await tel.synchro.synchroniser();
    await ordi.synchro.synchroniser();
    assert.equal((await ordi.local.lire("valse")).abc, "X:1\nK:C\nE2 F2|");
    assert.deepEqual(await ordi.local.pages("valse"), pages);
    // L'ordinateur supprime ; le téléphone suit.
    await ordi.local.supprimer("valse");
    await ordi.synchro.synchroniser();
    await tel.synchro.synchroniser();
    assert.deepEqual(await titres(tel.local), []);
    assert.equal(await tel.local.lire("valse"), null);
    assert.equal(objet(stockage, "bibliotheque/valse.json").supprime, true);
    // Ses traits et sa dernière version restent 30 jours, avec la corbeille.
    assert.ok(objet(stockage, "pages/valse.json"));
    assert.equal(objet(stockage, "corbeille/valse.json").titre, "Valse");
  } finally {
    await stockage.fermer();
  }
});

test("hors ligne, la file attend ; un appareil qui rejoint apporte ce qu'il avait", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil();
    // Avant toute synchronisation : deux partitions déjà là.
    await ordi.local.creer("a1", partition("Nocturne", "2026-09-30T09:00:00.000Z"), pages);
    await ordi.local.creer("a2", partition("Étude", "2026-09-30T09:05:00.000Z"), pages);
    // Un connecteur injoignable : l'erreur remonte, la file reste.
    const panne = creerSynchro({ local: ordi.local, appeler: async () => { throw Object.assign(new Error("hors ligne"), { code: "server_unavailable" }); } });
    await assert.rejects(panne.synchroniser(), /hors ligne/);
    assert.equal((await ordi.local.enAttente()).length, 2);
    await ordi.synchro.synchroniser();
    assert.equal((await ordi.local.enAttente()).length, 0);
    const tel = await appareil();
    await tel.local.creer("t1", partition("Berceuse", "2026-09-30T12:00:00.000Z"), pages);
    await tel.synchro.synchroniser(); // rejoint : envoie la sienne, reçoit les deux autres
    await ordi.synchro.synchroniser();
    assert.deepEqual(await titres(ordi.local), ["Berceuse", "Nocturne", "Étude"]);
    assert.deepEqual(await titres(tel.local), ["Berceuse", "Nocturne", "Étude"]);
    assert.equal(ordi.etats.at(-1).etat, "ok");
  } finally {
    await stockage.fermer();
  }
});

test("conflit : la modification la plus récente gagne, même envoyée en second", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("p", partition("Pièce", "2026-09-30T10:00:00.000Z"), pages);
    await ordi.synchro.synchroniser();
    await tel.synchro.synchroniser();
    // Les deux corrigent sans se synchroniser ; le téléphone est le plus récent.
    await ordi.local.modifier("p", { titre: "Pièce (ordi)", modifieLe: "2026-09-30T10:10:00.000Z" });
    await tel.local.modifier("p", { titre: "Pièce (tél)", modifieLe: "2026-09-30T10:20:00.000Z" });
    await tel.synchro.synchroniser();
    await ordi.synchro.synchroniser(); // son envoi est refusé : il reprend la version du téléphone
    assert.equal((await ordi.local.lire("p")).titre, "Pièce (tél)");
    await tel.synchro.synchroniser();
    assert.equal((await tel.local.lire("p")).titre, "Pièce (tél)");
    // Une horloge en retard ne fait pas perdre une modification faite après coup.
    await ordi.local.modifier("p", { titre: "Pièce (ordi, après)", modifieLe: "2026-09-30T10:15:00.000Z" });
    await ordi.synchro.synchroniser();
    await tel.synchro.synchroniser();
    assert.equal((await tel.local.lire("p")).titre, "Pièce (ordi, après)");
  } finally {
    await stockage.fermer();
  }
});

test("la bibliothèque commune refuse un identifiant ou une écriture incomplète, en disant pourquoi", async () => {
  const { stockage, appeler } = await monde();
  try {
    const refus = async (args) => (await appeler("bibliotheque_ecrire", args)).refus;
    assert.match(await refus({ id: "../x", modifieLe: "2026-09-30T10:00:00.000Z", donnees: {} }), /Identifiant/);
    assert.match(await refus({ id: "abcd", modifieLe: "2026-09-30T10:00:00.000Z" }), /données/);
    assert.match(await refus({ id: "abcd", modifieLe: "2026-09-30T10:00:00.000Z", donnees: { titre: "x" }, supprime: "oui" }), /supprime/);
    assert.match(await refus({ id: "abcd", modifieLe: "2026-09-30T10:00:00.000Z", donnees: { titre: "x" }, base: "hier" }), /base/);
    assert.match(await refus({ id: "abcd", modifieLe: "2026-09-30T10:00:00.000Z", donnees: { titre: "x" }, pages: [[["a"]]] }), /page/);
    assert.deepEqual(await appeler("bibliotheque_changements", {}), { partitions: [], curseur: null });
    // Les outils de lecture, eux, refusent par une erreur.
    await assert.rejects(appeler("bibliotheque_pages", { id: "../x" }), /invalide/);
  } finally {
    await stockage.fermer();
  }
});

test("le texte qui accompagne un résultat de la bibliothèque dit ce qui s'est passé", async () => {
  const { stockage, bib } = await monde();
  try {
    const texte = async (name, args) => (await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, null, bib)).result.content[0].text;
    assert.match(await texte("bibliotheque_ecrire", { id: "p", modifieLe: "zzz", donnees: { titre: "x" } }), /^Refusée : Il faut la date/);
    assert.equal(await texte("bibliotheque_ecrire", { id: "p", modifieLe: "2026-10-01T10:00:00.000Z", donnees: { titre: "x" }, base: null }), "Enregistrée dans la bibliothèque commune.");
    assert.match(await texte("bibliotheque_ecrire", { id: "p", modifieLe: "2026-10-01T10:01:00.000Z", donnees: { titre: "y" }, base: null }), /autre version, à fusionner/);
    assert.match(await texte("bibliotheque_versions", { id: "p" }), /^1 version gardée/);
    assert.match(await texte("bibliotheque_corbeille", {}), /^0 partition dans la corbeille/);
    assert.equal(await texte("bibliotheque_version", { id: "p", modifieLe: "2020-01-01T00:00:00.000Z" }), "Cette version n'est plus gardée.");
  } finally {
    await stockage.fermer();
  }
});

test("verifierEcriture : ce qui passe, ce qui ne passe pas", () => {
  const maintenant = Date.parse("2026-10-04T12:00:00.000Z");
  const ok = { id: "p1", modifieLe: "2026-10-04T12:00:00.000Z", donnees: { titre: "x", etiquettes: [], memo: null, tempo: null, doutes: null } };
  assert.equal(verifierEcriture(ok, maintenant), null);
  assert.equal(verifierEcriture({ ...ok, modifieLe: "1970-01-01T00:00:00.000Z" }, maintenant), null, "une fiche sans date (normalisée) passe");
  assert.equal(verifierEcriture({ ...ok, modifieLe: "2026-10-05T11:00:00.000Z" }, maintenant), null, "une horloge un peu en avance passe");
  assert.match(verifierEcriture({ ...ok, modifieLe: "2026-10-05T12:00:01.000Z" }, maintenant), /futur/);
  assert.equal(verifierEcriture({ id: "p1", supprime: true, modifieLe: "2026-10-04T12:00:00.000Z", base: null }, maintenant), null);
  assert.match(verifierEcriture({ ...ok, donnees: { titre: 5 } }, maintenant), /titre/);
  assert.match(verifierEcriture({ ...ok, donnees: { titre: "x", favori: "oui" } }, maintenant), /favori/);
  assert.match(verifierEcriture({ ...ok, donnees: { titre: "x", sequence: { pistes: 3 } } }, maintenant), /sequence/);
  assert.equal(verifierEcriture({ ...ok, pages: [[[1, 2, 3, 4]], [{ memo: { base64: "AAAA", type: "audio/mp4", duree: 1 } }][0]] }, maintenant), null);
  assert.match(verifierEcriture({ ...ok, donnees: { titre: "x", note: "é".repeat(LIMITES.donnees / 2) } }, maintenant), /trop lourde/, "les octets comptent, pas les caractères");
});

test("une idée et son mémo vocal voyagent d'un appareil à l'autre", async () => {
  const { stockage, appareil } = await monde();
  try {
    const tel = await appareil(), ordi = await appareil();
    const sequence = { version: 1, tempo: 100, mesure: [4, 4], tonalite: "C", pistes: [{ nom: "Mélodie", notes: [{ id: 1, d: 0, l: 4, h: 60 }] }], accords: [], accompagnement: "aucun", suivant: 2 };
    const i1 = { type: "idee", titre: "Idée du métro", sequence, abc: "X:1\nK:C\nC2|", statut: "idee", nbPages: 0, modele: null, creeLe: "2026-10-01T08:00:00.000Z", modifieLe: "2026-10-01T08:00:00.000Z" };
    await tel.local.creer("i1", i1, []);
    // Le mémo s'ajoute après coup : la fiche change, le contenu lourd aussi.
    await tel.local.modifier("i1", { memo: { duree: 3, type: "audio/mp4" }, modifieLe: "2026-10-01T08:01:00.000Z" });
    await tel.local.ecrireMemo("i1", { type: "audio/mp4", base64: "AAAAGGZ0eXBNNEEg", duree: 3 });
    await tel.synchro.synchroniser();
    const b = await ordi.synchro.synchroniser();
    assert.deepEqual([b.envoyees, b.recues], [0, 1]);
    const recue = await ordi.local.lire("i1");
    assert.equal(recue.titre, "Idée du métro");
    assert.deepEqual(recue.sequence.pistes[0].notes, sequence.pistes[0].notes);
    assert.deepEqual(await ordi.local.lireMemo("i1"), { type: "audio/mp4", base64: "AAAAGGZ0eXBNNEEg", duree: 3 });
    // Le mémo effacé sur l'ordinateur disparaît aussi du téléphone.
    await ordi.local.modifier("i1", { memo: null, modifieLe: "2026-10-01T09:00:00.000Z" });
    await ordi.local.ecrireMemo("i1", null);
    await ordi.synchro.synchroniser();
    await tel.synchro.synchroniser();
    assert.equal(await tel.local.lireMemo("i1"), null);
    assert.equal(objet(stockage, "pages/i1.json").length, 0);
  } finally {
    await stockage.fermer();
  }
});

test("D4 · écriture conditionnelle : partie d'une version dépassée, elle est refusée avec la version actuelle", async () => {
  const { stockage, appeler } = await monde();
  try {
    const v1 = await appeler("bibliotheque_ecrire", { id: "p", donnees: { titre: "Un" }, modifieLe: "2026-10-01T10:00:00.000Z", base: null });
    assert.equal(v1.accepte, true);
    assert.equal(v1.fiche.rev, 1);
    // base: null veut dire « elle ne doit pas encore exister ».
    const doublon = await appeler("bibliotheque_ecrire", { id: "p", donnees: { titre: "Autre" }, modifieLe: "2026-10-01T10:01:00.000Z", base: null });
    assert.equal(doublon.accepte, false);
    assert.equal(doublon.actuelle.donnees.titre, "Un");
    const v2 = await appeler("bibliotheque_ecrire", { id: "p", donnees: { titre: "Deux" }, modifieLe: "2026-10-01T10:02:00.000Z", base: "2026-10-01T10:00:00.000Z" });
    assert.equal(v2.accepte, true);
    // Partie de la version 1, alors que la 2 est là : refusée, même plus récente.
    const tard = await appeler("bibliotheque_ecrire", { id: "p", donnees: { titre: "Trois" }, modifieLe: "2026-10-01T10:30:00.000Z", base: "2026-10-01T10:00:00.000Z" });
    assert.equal(tard.accepte, false);
    assert.equal(tard.actuelle.donnees.titre, "Deux");
    // Sans base (un appareil d'avant), le plus récent gagne, comme avant.
    assert.equal((await appeler("bibliotheque_ecrire", { id: "p", donnees: { titre: "Vieux" }, modifieLe: "2026-10-01T09:00:00.000Z" })).accepte, false);
    assert.equal((await appeler("bibliotheque_ecrire", { id: "p", donnees: { titre: "Neuf" }, modifieLe: "2026-10-01T11:00:00.000Z" })).accepte, true);
    assert.equal(objet(stockage, "verrous/p.json"), undefined, "aucun verrou ne traîne");
  } finally {
    await stockage.fermer();
  }
});

test("D6 · l'historique est élagué en écrivant : 20 versions au plus par partition", async () => {
  const { stockage, appeler } = await monde();
  try {
    let base = null;
    for (let k = 1; k <= 25; k++) {
      const modifieLe = new Date(Date.parse("2026-10-01T10:00:00.000Z") + k * 60000).toISOString();
      const r = await appeler("bibliotheque_ecrire", { id: "p", donnees: { titre: `v${k}` }, modifieLe, base });
      assert.equal(r.accepte, true);
      base = modifieLe;
    }
    const gardees = [...stockage.compartiments.get("portee-remarkable").objets.keys()].filter((c) => c.startsWith("versions/p/"));
    assert.equal(gardees.length, LIMITES.versions);
    const versions = await appeler("bibliotheque_versions", { id: "p" });
    assert.equal(versions.versions.length, LIMITES.versions + 1, "les 20 précédentes, plus l'actuelle");
    assert.equal((await appeler("bibliotheque_version", { id: "p", modifieLe: versions.versions[1].modifieLe })).fiche.donnees.titre, "v24");
    assert.deepEqual(await appeler("bibliotheque_version", { id: "p", modifieLe: "2026-10-01T10:01:00.000Z" }), { fiche: null }, "la plus ancienne est partie");
  } finally {
    await stockage.fermer();
  }
});

test("D10 · un curseur illisible repart du début ; un curseur à jour ne relit que le recouvrement", async () => {
  const { stockage, appeler } = await monde();
  try {
    await appeler("bibliotheque_ecrire", { id: "a", donnees: { titre: "A" }, modifieLe: "2026-10-01T10:00:00.000Z" });
    assert.equal((await appeler("bibliotheque_changements", { depuis: "n'importe quoi" })).partitions.length, 1);
    const { curseur } = await appeler("bibliotheque_changements", {});
    assert.equal((await appeler("bibliotheque_changements", { depuis: curseur })).partitions.length, 1, "écrite il y a moins de 10 s : relue");
    const plusTard = new Date(Date.parse(curseur) + LIMITES.recouvrement + 1).toISOString();
    assert.deepEqual(await appeler("bibliotheque_changements", { depuis: plusTard }), { partitions: [], curseur: plusTard });
  } finally {
    await stockage.fermer();
  }
});
