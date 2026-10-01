/**
 * La bibliothèque synchronisée : deux « appareils » (deux bases IndexedDB),
 * le connecteur (protocole MCP, bibliotheque.js) et le stockage Supabase
 * (faux, mais le vrai client objets.js), de bout en bout.
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { stockageIndexe } from "../app/stockage.js";
import { creerSynchro } from "../app/synchro.js";
import { Bibliotheque } from "../supabase/functions/portee-remarkable/bibliotheque.js";
import { objetsSupabase } from "../supabase/functions/portee-remarkable/objets.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { demarrerFauxStockage } from "./faux-cloud.mjs";

const pages = [[[[100, 200], [110, 210]], [[300, 400], [305, 450]]]]; // une page, deux traits
const partition = (titre, modifieLe, abc = "X:1\nK:C\nC2 D2|") => ({ titre, modele: "melodie-standard", abc, abcLu: abc, doutes: [], statut: "a-relire", nbPages: 1, creeLe: modifieLe, modifieLe });

let n = 0;
async function monde() {
  const stockage = await demarrerFauxStockage();
  const bib = new Bibliotheque(objetsSupabase(stockage.url, stockage.cle));
  const appeler = async (outil, args) => {
    const r = await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: outil, arguments: args } }, null, bib);
    if (r.result.isError) throw new Error(r.result.content[0].text);
    return r.result.structuredContent;
  };
  const appareil = async () => {
    const local = await stockageIndexe(`essai-${n++}`);
    const etats = [];
    return { local, synchro: creerSynchro({ local, appeler, surEtat: (e) => etats.push(e) }), etats };
  };
  return { stockage, bib, appeler, appareil };
}

const titres = async (local) => (await new Promise((ok) => local.ecouter(ok))).map((p) => p.titre).sort();

test("deux appareils : création, modification, suppression voyagent dans les deux sens", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("valse", partition("Valse", "2026-09-30T10:00:00.000Z"), pages);
    await ordi.synchro.synchroniser();
    assert.deepEqual(await ordi.local.enAttente(), []);
    assert.deepEqual(await tel.synchro.synchroniser(), { envoyees: 0, recues: 1 });
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
    // Les traits d'une partition supprimée ne restent pas dans le stockage.
    assert.equal(stockage.objet("portee-remarkable", "pages/valse.json"), undefined);
    assert.equal(JSON.parse(stockage.objet("portee-remarkable", "bibliotheque/valse.json")).supprime, true);
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

test("la bibliothèque commune refuse un identifiant ou une écriture incomplète", async () => {
  const { stockage, appeler } = await monde();
  try {
    await assert.rejects(appeler("bibliotheque_ecrire", { id: "../x", modifieLe: "2026-09-30T10:00:00.000Z", donnees: {} }), /invalide/);
    await assert.rejects(appeler("bibliotheque_ecrire", { id: "abcd", modifieLe: "2026-09-30T10:00:00.000Z" }), /données/);
    assert.deepEqual(await appeler("bibliotheque_changements", {}), { partitions: [], curseur: null });
  } finally {
    await stockage.fermer();
  }
});
