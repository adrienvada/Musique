/**
 * Les seize scénarios de perte de données de l'audit du 04/10 (S1 à S16),
 * rejoués avec les vrais modules : stockage.js, synchro.js, bibliotheque.js,
 * objets.js et mcp.js, sur fake-indexeddb et le faux stockage Supabase.
 * L'audit les avait écrits pour montrer chaque défaut (un test vert voulait
 * dire « défaut reproduit ») ; ils vérifient maintenant le comportement
 * corrigé. Le repère de chaque test renvoie au rapport (docs/AUDIT-2026-10.md).
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { restaurer, sauvegarde, stockageIndexe } from "../app/stockage.js";
import { creerSynchro } from "../app/synchro.js";
import { Bibliotheque } from "../supabase/functions/portee-remarkable/bibliotheque.js";
import { objetsSupabase } from "../supabase/functions/portee-remarkable/objets.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { demarrerFauxStockage } from "./faux-cloud.mjs";

const pages = [[[[100, 200], [110, 210]]]];
const seq = (notes) => ({ version: 1, tempo: 100, mesure: [4, 4], tonalite: "C", pistes: [{ nom: "Mélodie", notes }], accords: [], accompagnement: "aucun", suivant: 9 });
const idee = (titre, modifieLe, notes = []) => ({ type: "idee", titre, sequence: seq(notes), abc: "X:1", statut: "idee", nbPages: 0, modele: null, creeLe: modifieLe, modifieLe });
const partition = (titre, modifieLe) => ({ titre, modele: "melodie-standard", abc: "X:1\nK:C\nC2|", doutes: [], statut: "a-relire", nbPages: 1, creeLe: modifieLe, modifieLe });

let n = 0;
/**
 * Le connecteur et son stockage, et des appareils. `appeler` rejette comme
 * connecteurDirect (app/connecteur.js) : { code: "tool_error" } quand
 * l'outil échoue. `crochet(moment, outil, args, local)` s'intercale avant
 * et après chaque appel d'un appareil.
 */
async function monde({ crochet = null } = {}) {
  const stockage = await demarrerFauxStockage();
  const bib = new Bibliotheque(objetsSupabase(stockage.url, stockage.cle));
  const appelerBrut = async (outil, args) => {
    const r = await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: outil, arguments: JSON.parse(JSON.stringify(args)) } }, null, bib);
    if (r.result.isError) throw Object.assign(new Error(r.result.content[0].text), { code: "tool_error", result: r.result });
    return r.result.structuredContent;
  };
  const appareil = async (nom = `scenario-${n++}`) => {
    const local = await stockageIndexe(nom);
    const etats = [];
    const appeler = async (outil, args) => {
      if (crochet) await crochet("avant", outil, args, local);
      const r = await appelerBrut(outil, args);
      if (crochet) await crochet("apres", outil, args, local);
      return r;
    };
    return { local, etats, synchro: creerSynchro({ local, appeler, surEtat: (e) => etats.push(e) }) };
  };
  return { stockage, bib, appeler: appelerBrut, appareil };
}
const fiche = (stockage, id) => { const t = stockage.objet("portee-remarkable", `bibliotheque/${id}.json`); return t && JSON.parse(t); };
const pagesServeur = (stockage, id) => { const t = stockage.objet("portee-remarkable", `pages/${id}.json`); return t && JSON.parse(t); };
const liste = (local) => new Promise((ok) => local.ecouter(ok));
const notesDe = (f) => f.sequence.pistes[0].notes.map((x) => x.id).sort((a, b) => a - b);

test("S1 · même idée modifiée sur deux appareils hors ligne : la note de l'un et le titre de l'autre restent", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("i", idee("Refrain", "2026-10-01T10:00:00.000Z", [{ id: 1, d: 0, l: 4, h: 60 }]), []);
    await ordi.synchro.synchroniser(); await tel.synchro.synchroniser();
    // Hors ligne : l'ordi ajoute une note, le téléphone (plus tard) change seulement le titre.
    const o = await ordi.local.lire("i");
    await ordi.local.modifier("i", { sequence: seq([...o.sequence.pistes[0].notes, { id: 2, d: 4, l: 4, h: 64 }]), modifieLe: "2026-10-01T10:05:00.000Z" });
    await tel.local.modifier("i", { titre: "Refrain (tél)", modifieLe: "2026-10-01T10:06:00.000Z" });
    await ordi.synchro.synchroniser(); await tel.synchro.synchroniser(); await ordi.synchro.synchroniser();
    for (const f of [await ordi.local.lire("i"), await tel.local.lire("i"), fiche(stockage, "i").donnees]) {
      assert.equal(f.titre, "Refrain (tél)");
      assert.deepEqual(notesDe(f), [1, 2], "la note ajoutée sur l'ordinateur est partout");
    }
    // L'ABC suit les notes et le titre gardés.
    assert.match((await ordi.local.lire("i")).abc, /T:Refrain \(tél\)/);
  } finally { await stockage.fermer(); }
});

test("S2 · horloge en avance sur un appareil : les deux corrections d'une page restent, l'une en copie de conflit", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("p", partition("Valse", "2026-10-01T10:00:00.000Z"), pages);
    await ordi.synchro.synchroniser(); await tel.synchro.synchroniser();
    // Le téléphone a 10 min d'avance : sa correction faite à 10:01 (vraie heure) est datée 10:11.
    await tel.local.modifier("p", { abc: "X:1\nK:C\nD2|", modifieLe: "2026-10-01T10:11:00.000Z" });
    await tel.synchro.synchroniser();
    // L'ordinateur (à l'heure) corrige à 10:05, avant d'avoir reçu celle du téléphone.
    await ordi.local.modifier("p", { abc: "X:1\nK:C\nE2|", modifieLe: "2026-10-01T10:05:00.000Z" });
    const bilan = await ordi.synchro.synchroniser();
    assert.equal(bilan.conflits, 1);
    assert.equal((await ordi.local.lire("p")).abc, "X:1\nK:C\nE2|", "la correction d'ici reste");
    const copie = (await liste(ordi.local)).find((x) => x.conflitDe === "p");
    assert.ok(copie, "la correction du téléphone est gardée à part");
    assert.equal(copie.titre, "Valse (version de l'autre appareil)");
    assert.equal(copie.abc, "X:1\nK:C\nD2|");
    assert.deepEqual(await ordi.local.pages(copie.id), pages, "la copie a les traits de la page");
    await tel.synchro.synchroniser();
    assert.equal((await tel.local.lire("p")).abc, "X:1\nK:C\nE2|");
    assert.equal((await tel.local.lire(copie.id)).abc, "X:1\nK:C\nD2|");
  } finally { await stockage.fermer(); }
});

test("S3 · suppression sur un appareil dont l'horloge retarde : la partition part partout", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    // Écrite par le téléphone, qui a 10 min d'avance.
    await tel.local.creer("z", partition("Nocturne", new Date(Date.now() + 10 * 60000).toISOString()), pages);
    await tel.synchro.synchroniser(); await ordi.synchro.synchroniser();
    assert.ok(await ordi.local.lire("z"));
    // L'ordinateur (à l'heure) la supprime : la pierre tombale passe quand même après la version d'ici.
    await ordi.local.supprimer("z");
    const [envoi] = await ordi.local.enAttente();
    assert.ok(envoi.modifieLe > (fiche(stockage, "z").modifieLe), "pierre tombale datée après la version supprimée");
    const bilan = await ordi.synchro.synchroniser();
    assert.equal(bilan.envoyees, 1);
    assert.deepEqual(await ordi.local.enAttente(), []);
    assert.equal(fiche(stockage, "z").supprime, true, "supprimée dans la bibliothèque commune");
    await tel.synchro.synchroniser();
    assert.equal(await tel.local.lire("z"), null, "et sur le téléphone");
    await ordi.synchro.synchroniser();
    assert.equal(await ordi.local.lire("z"), null);
  } finally { await stockage.fermer(); }
});

test("S4 · restaurer une sauvegarde après une suppression : la partition revient, partout, et y reste", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("v", partition("Vieille valse", "2026-09-01T10:00:00.000Z"), pages);
    await ordi.synchro.synchroniser(); await tel.synchro.synchroniser();
    const fichier = JSON.parse(JSON.stringify(await sauvegarde(ordi.local, await liste(ordi.local))));
    await tel.local.supprimer("v"); // par erreur, sur l'autre appareil
    await tel.synchro.synchroniser(); await ordi.synchro.synchroniser();
    assert.equal(await ordi.local.lire("v"), null);
    const r = await restaurer(ordi.local, fichier, new Set());
    assert.equal(r.revenues, 1);
    assert.ok((await ordi.local.lire("v")).modifieLe > "2026-10-01", "elle prend la date d'aujourd'hui");
    await ordi.synchro.synchroniser();
    assert.equal((await ordi.local.lire("v")).titre, "Vieille valse", "toujours là après la synchro");
    assert.equal(fiche(stockage, "v").supprime, false);
    await tel.synchro.synchroniser();
    assert.equal((await tel.local.lire("v")).titre, "Vieille valse", "revenue sur l'autre appareil");
    assert.deepEqual(await tel.local.pages("v"), pages, "avec ses traits");
  } finally { await stockage.fermer(); }
});

test("S5 · un envoi refusé est mis de côté : les autres partent, la réception a lieu", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await tel.local.creer("t1", partition("Du téléphone", "2026-10-01T09:00:00.000Z"), pages);
    await tel.synchro.synchroniser();
    // Un identifiant que le connecteur refuse, rangé tel quel (comme le faisait une ancienne restauration).
    await ordi.local.creer("ma partition", partition("Mal nommée", "2026-10-01T08:00:00.000Z"), []);
    await ordi.local.creer("nouvelle", partition("Nouvelle", "2026-10-01T08:30:00.000Z"), []);
    const bilan = await ordi.synchro.synchroniser();
    assert.equal(bilan.quarantaine, 1);
    assert.ok(fiche(stockage, "nouvelle"), "les envois suivants partent");
    assert.equal((await ordi.local.lire("t1")).titre, "Du téléphone", "et la réception a lieu");
    const [q] = await ordi.synchro.quarantaine();
    assert.equal(q.id, "ma partition");
    assert.equal(q.sens, "envoi");
    assert.match(q.raison, /Identifiant/);
    assert.equal(ordi.etats.at(-1).etat, "ok");
    assert.equal(ordi.etats.at(-1).quarantaine, 1);
    // Ce qui vient ensuite part normalement ; la partition refusée ne repart pas à chaque passage.
    await ordi.local.creer("pabc123", partition("Notée ensuite", "2026-10-01T11:00:00.000Z"), pages);
    await ordi.synchro.synchroniser();
    assert.ok(fiche(stockage, "pabc123"));
    // Une sauvegarde avec ce même identifiant revient sous un identifiant neuf, et part.
    const autre = await appareil();
    await autre.synchro.synchroniser();
    const r = await restaurer(autre.local, { format: "portee-sauvegarde", partitions: [
      { id: "ma partition", donnees: partition("Mal nommée", "2026-10-01T08:00:00.000Z"), pages: [] },
      { id: "sansdate", donnees: { titre: "Sans date" }, pages: [] },
    ] }, new Set());
    assert.equal(r.revenues, 2);
    await autre.synchro.synchroniser();
    assert.deepEqual(await autre.synchro.quarantaine(), []);
    assert.equal(fiche(stockage, "sansdate").donnees.titre, "Sans date");
    assert.ok((await liste(autre.local)).some((p) => p.titre === "Mal nommée" && p.id !== "ma partition"));
  } finally { await stockage.fermer(); }
});

test("S5 bis · un ancien connecteur qui refuse par une erreur ne bloque plus rien non plus", async () => {
  const { stockage, appeler } = await monde();
  try {
    const local = await stockageIndexe(`scenario-${n++}`);
    // Le connecteur d'avant le 04/10 levait une erreur d'outil pour un identifiant refusé.
    const ancien = async (outil, args) => {
      if (outil === "bibliotheque_ecrire" && args.id === "ma partition") throw { code: "tool_error", message: "tool_error", result: { content: [{ type: "text", text: "Identifiant de partition invalide." }] } };
      return appeler(outil, args);
    };
    const synchro = creerSynchro({ local, appeler: ancien });
    await local.creer("ma partition", partition("Mal nommée", "2026-10-01T08:00:00.000Z"), []);
    await local.creer("pbien", partition("Bien nommée", "2026-10-01T08:30:00.000Z"), []);
    await synchro.synchroniser();
    assert.ok(fiche(stockage, "pbien"));
    assert.match((await synchro.quarantaine())[0].raison, /Identifiant de partition invalide/);
    // Mise de côté, elle repart quand la fiche change (un autre numéro d'envoi).
    await local.modifier("ma partition", { titre: "Renommée" });
    const avant = (await local.quarantaine()).length;
    assert.equal(avant, 1);
    await synchro.synchroniser();
    assert.equal((await synchro.quarantaine()).length, 1, "refusée de nouveau, de côté de nouveau");
  } finally { await stockage.fermer(); }
});

test("S6 · mémo vocal enregistré pendant une synchro : il part au passage suivant, et arrive", async () => {
  let pendant = null;
  const { stockage, appareil } = await monde({
    crochet: async (moment, outil, _args, local) => {
      if (moment === "avant" && outil === "bibliotheque_ecrire" && pendant) { const f = pendant; pendant = null; await f(local); }
    },
  });
  try {
    const tel = await appareil(), ordi = await appareil();
    await tel.local.creer("m", idee("Idée", "2026-10-01T10:00:00.000Z"), []);
    await tel.synchro.synchroniser();
    // Le chemin de garderMemo (idee.js) : la fiche d'abord, puis le son ; la synchro part entre les deux.
    await tel.local.modifier("m", { memo: { duree: 3, type: "audio/mp4" }, modifieLe: "2026-10-01T10:01:00.000Z" });
    pendant = (local) => local.ecrireMemo("m", { type: "audio/mp4", base64: "AAAA", duree: 3 });
    await tel.synchro.synchroniser();
    assert.equal((await tel.local.enAttente()).length, 1, "le son attend encore : son envoi n'a pas été effacé");
    await tel.synchro.synchroniser();
    assert.deepEqual(pagesServeur(stockage, "m"), [{ memo: { type: "audio/mp4", base64: "AAAA", duree: 3 } }], "le son est monté");
    await ordi.synchro.synchroniser();
    assert.deepEqual(await ordi.local.lireMemo("m"), { type: "audio/mp4", base64: "AAAA", duree: 3 }, "et l'ordinateur le reçoit");
  } finally { await stockage.fermer(); }
});

test("S7 · une correction enregistrée pendant que la synchro range son envoi n'est pas écrasée", async () => {
  // L'atelier enregistre juste à la fin de la transaction où la synchro marque l'envoi comme fait.
  let declencheur = null;
  const orig = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (noms, mode) {
    const t = orig.call(this, noms, mode);
    if (declencheur && mode === "readwrite" && [].concat(noms).sort().join() === "bases,envois") { const f = declencheur; declencheur = null; t.addEventListener("complete", f); }
    return t;
  };
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("p", partition("Étude", "2026-10-01T10:00:00.000Z"), pages);
    await ordi.synchro.synchroniser();
    await ordi.local.modifier("p", { abc: "B", modifieLe: "2026-10-01T10:01:00.000Z" });
    let correction;
    declencheur = () => { correction = ordi.local.modifier("p", { abc: "C", modifieLe: "2026-10-01T10:02:00.000Z" }); };
    await ordi.synchro.synchroniser();
    await correction;
    assert.equal((await ordi.local.lire("p")).abc, "C", "la correction reste");
    assert.equal((await ordi.local.enAttente()).length, 1, "et attend son envoi");
    await ordi.synchro.synchroniser();
    await tel.synchro.synchroniser();
    assert.equal((await tel.local.lire("p")).abc, "C");
  } finally { IDBDatabase.prototype.transaction = orig; await stockage.fermer(); }
});

test("S7 bis · une correction faite pendant qu'une version arrive : les deux se fusionnent", async () => {
  let pendant = null;
  const { stockage, appareil } = await monde({
    crochet: async (moment, outil, _args, local) => {
      if (moment === "apres" && outil === "bibliotheque_pages" && pendant) { const f = pendant; pendant = null; await f(local); }
    },
  });
  try {
    const tel = await appareil(), ordi = await appareil();
    await tel.local.creer("i", idee("Pluie", "2026-10-01T10:00:00.000Z", [{ id: 1, d: 0, l: 4, h: 60 }]), []);
    await tel.synchro.synchroniser(); await ordi.synchro.synchroniser();
    // Le téléphone change le son (les pages) et le titre ; l'ordinateur ajoute une étiquette pendant qu'il reçoit.
    await tel.local.modifier("i", { titre: "Pluie d'été" });
    await tel.local.ecrireMemo("i", { type: "audio/mp4", base64: "BBBB", duree: 2 });
    await tel.synchro.synchroniser();
    pendant = (local) => local.modifier("i", { etiquettes: ["ballade"] });
    await ordi.synchro.synchroniser();
    const f = await ordi.local.lire("i");
    assert.equal(f.titre, "Pluie d'été");
    assert.deepEqual(f.etiquettes, ["ballade"]);
    assert.deepEqual(await ordi.local.lireMemo("i"), { type: "audio/mp4", base64: "BBBB", duree: 2 });
    await ordi.synchro.synchroniser(); await tel.synchro.synchroniser();
    assert.deepEqual((await tel.local.lire("i")).etiquettes, ["ballade"]);
  } finally { await stockage.fermer(); }
});

test("S8 · deux onglets du même navigateur : chacun voit les changements de l'autre, et un enregistrement en retard fusionne", async () => {
  const ongletA = await stockageIndexe("onglets"), ongletB = await stockageIndexe("onglets");
  try {
    const vuB = [], idsB = [];
    ongletB.ecouter((l) => vuB.push(l.map((p) => p.titre)));
    ongletB.surAutreOnglet((ids) => idsB.push(...ids));
    await new Promise((r) => setTimeout(r, 20));
    await ongletA.creer("x", idee("Créée dans A", "2026-10-01T10:00:00.000Z", [{ id: 1, d: 0, l: 4, h: 60 }]), []);
    const chargeeParB = await ongletB.lire("x"); // l'éditeur de B ouvre l'idée
    await ongletA.modifier("x", { titre: "Renommée dans A", modifieLe: "2026-10-01T10:01:00.000Z" });
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(vuB.at(-1), ["Renommée dans A"], "B a rafraîchi sa liste");
    assert.ok(idsB.includes("x"), "et sait quelle partition a changé");
    // B enregistre l'idée entière, comme idee.js, en disant d'où il est parti : le titre de A reste.
    const { id: _id, ...depuis } = chargeeParB;
    await ongletB.modifier("x", { ...depuis, sequence: seq([{ id: 1, d: 0, l: 4, h: 60 }, { id: 2, d: 4, l: 4, h: 67 }]), modifieLe: "2026-10-01T10:02:00.000Z" }, { depuis });
    const finale = await ongletA.lire("x");
    assert.equal(finale.titre, "Renommée dans A");
    assert.deepEqual(notesDe(finale), [1, 2]);
  } finally { ongletA.fermer(); ongletB.fermer(); }
});

test("S9 · deux écritures simultanées de la même partition : jamais la plus ancienne par-dessus la plus récente", async () => {
  // Un stockage lent, avec la création exclusive du vrai (objets.creer) : le verrou.
  const memoire = new Map(); let horloge = 0;
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const objets = {
    async lire(c) { await attendre(5); const o = memoire.get(c); return o ? JSON.parse(o.corps) : null; },
    async ecrire(c, o) { await attendre(c.includes("bibliotheque/") && o.donnees && o.donnees.titre === "Récente" ? 1 : 30); memoire.set(c, { corps: JSON.stringify(o), maj: new Date(1e12 + ++horloge).toISOString() }); },
    async creer(c, o) { await attendre(3); if (memoire.has(c)) return false; memoire.set(c, { corps: JSON.stringify(o), maj: new Date(1e12 + ++horloge).toISOString() }); return true; },
    async supprimer(c) { memoire.delete(c); },
    async lister(d) { return [...memoire].filter(([c]) => c.startsWith(d + "/")).map(([c, o]) => ({ nom: c.slice(d.length + 1), maj: o.maj })); },
  };
  const bib = new Bibliotheque(objets);
  for (const ordre of [["Ancienne", "Récente"], ["Récente", "Ancienne"]]) {
    memoire.clear();
    const ecrire = (titre) => bib.ecrire({ id: "p", donnees: { titre }, pages: [[[1, 2]]], modifieLe: titre === "Récente" ? "2026-10-01T10:30:00.000Z" : "2026-10-01T10:00:00.000Z" });
    const [a, b] = await Promise.all(ordre.map(ecrire));
    const finale = JSON.parse(memoire.get("bibliotheque/p.json").corps);
    assert.equal(finale.donnees.titre, "Récente", `ordre ${ordre.join(", ")}`);
    // Celle qui arrive en second voit la première : refusée si elle est plus ancienne.
    const ancienne = ordre[0] === "Ancienne" ? a : b;
    if (ordre[1] === "Ancienne") assert.equal(ancienne.accepte, false);
    assert.equal(memoire.has("verrous/p.json"), false, "le verrou est rendu");
  }
  // Écritures conditionnelles parties de la même version : une seule passe, l'autre reçoit la gagnante.
  memoire.clear();
  const [x, y] = await Promise.all(["Ordi", "Tél"].map((titre, i) => bib.ecrire({ id: "q", donnees: { titre }, modifieLe: `2026-10-01T10:0${i}:00.000Z`, base: null })));
  assert.equal([x, y].filter((r) => r.accepte).length, 1);
  const refusee = [x, y].find((r) => !r.accepte);
  assert.equal(refusee.actuelle.donnees.titre, JSON.parse(memoire.get("bibliotheque/q.json").corps).donnees.titre);
});

test("S10 · curseur par horodatage : une écriture visible juste après la liste n'est plus sautée", async () => {
  const memoire = new Map();
  const visibles = new Set();
  const objets = {
    async lire(c) { const o = memoire.get(c); return o ? JSON.parse(o.corps) : null; },
    async ecrire(c, o, { maj, visible = true } = {}) { memoire.set(c, { corps: JSON.stringify(o), maj }); if (visible) visibles.add(c); },
    async supprimer() {},
    async lister(d) { return [...memoire].filter(([c]) => visibles.has(c) && c.startsWith(d + "/")).map(([c, o]) => ({ nom: c.slice(d.length + 1), maj: o.maj })); },
  };
  const bib = new Bibliotheque(objets);
  // L'écriture A reçoit son horodatage (12:00:00.100) mais n'est visible qu'après (commit lent).
  await objets.ecrire("bibliotheque/a.json", { id: "a", donnees: { titre: "A" }, modifieLe: "2026-10-01T12:00:00.000Z" }, { maj: "2026-10-01T12:00:00.100Z", visible: false });
  await objets.ecrire("bibliotheque/b.json", { id: "b", donnees: { titre: "B" }, modifieLe: "2026-10-01T12:00:00.000Z" }, { maj: "2026-10-01T12:00:00.150Z" });
  const r1 = await bib.changements(null);
  assert.deepEqual(r1.partitions.map((p) => p.id), ["b"]);
  visibles.add("bibliotheque/a.json"); // A devient visible
  const r2 = await bib.changements(r1.curseur);
  assert.ok(r2.partitions.some((p) => p.id === "a"), "A arrive, grâce au recouvrement");
  assert.equal(r2.curseur, r1.curseur);
});

test("S10 bis · le recouvrement redonne des fiches déjà reçues : l'appareil les reconnaît", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("a", partition("Alpha", "2026-10-01T10:00:00.000Z"), pages);
    await ordi.synchro.synchroniser();
    assert.equal((await tel.synchro.synchroniser()).recues, 1);
    // Moins de 10 s plus tard : la même fiche revient, rien n'est reçu deux fois.
    assert.equal((await tel.synchro.synchroniser()).recues, 0);
    assert.equal((await ordi.synchro.synchroniser()).recues, 0, "pas même son propre envoi");
    assert.deepEqual(await tel.local.enAttente(), []);
  } finally { await stockage.fermer(); }
});

test("S11 · envoi interrompu entre les traits et la fiche, réponse perdue : rejoué sans dégât (contrôle)", async () => {
  let coupe = true;
  const { stockage, appeler, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("p", partition("Pièce", "2026-10-01T10:00:00.000Z"), pages);
    // Le connecteur a tout écrit, l'appareil reçoit une erreur de réseau.
    const panne = creerSynchro({ local: ordi.local, appeler: async (outil, args) => {
      const r = await appeler(outil, args);
      if (outil === "bibliotheque_ecrire" && coupe) { coupe = false; throw Object.assign(new Error("réseau coupé"), { code: "server_unavailable" }); }
      return r;
    } });
    await assert.rejects(panne.synchroniser(), /coupé/);
    assert.equal((await ordi.local.enAttente()).length, 1);
    // La passe suivante reconnaît son propre envoi en le recevant : rien à renvoyer.
    const bilan = await ordi.synchro.synchroniser();
    assert.equal(bilan.envoyees, 0);
    assert.deepEqual(await ordi.local.enAttente(), []);
    await tel.synchro.synchroniser();
    assert.equal((await tel.local.lire("p")).titre, "Pièce");
    assert.deepEqual(await tel.local.pages("p"), pages);
  } finally { await stockage.fermer(); }
});

test("S12 · une réception qui échoue (stockage plein) est mise de côté : le curseur avance, elle réessaie", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("gros", partition("Gros", "2026-10-01T10:00:00.000Z"), pages);
    await ordi.local.creer("petit", partition("Petit", "2026-10-01T10:01:00.000Z"), pages);
    await ordi.synchro.synchroniser();
    const appliquer = tel.local.appliquerSynchro;
    let plein = true;
    tel.local.appliquerSynchro = async (id, e) => {
      if (id === "gros" && plein) throw Object.assign(new Error("QuotaExceededError : le stockage de ce navigateur est plein"), { name: "QuotaExceededError" });
      return appliquer(id, e);
    };
    const bilan = await tel.synchro.synchroniser();
    assert.equal(bilan.recues, 1);
    assert.equal((await tel.local.lire("petit")).titre, "Petit", "les autres arrivent");
    assert.ok(await tel.local.lireMeta("curseur"), "le curseur avance");
    const [q] = await tel.synchro.quarantaine();
    assert.equal(q.id, "gros"); assert.equal(q.sens, "reception"); assert.match(q.raison, /plein/);
    plein = false; // de la place s'est libérée
    await tel.synchro.synchroniser();
    assert.equal((await tel.local.lire("gros")).titre, "Gros");
    assert.deepEqual(await tel.synchro.quarantaine(), []);
  } finally { await stockage.fermer(); }
});

test("S12 bis · une réception mise de côté puis dépassée ne revient pas écraser la version plus récente", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("x", partition("Version 1", "2026-10-01T10:00:00.000Z"), pages);
    await ordi.synchro.synchroniser(); await tel.synchro.synchroniser();
    await ordi.local.modifier("x", { titre: "Version 2" });
    await ordi.synchro.synchroniser();
    // Le téléphone corrige de son côté, puis synchronise. La première fois qu'il
    // range la version 2, le stockage est plein : elle est mise de côté. Son envoi,
    // refusé (la bibliothèque a la version 2), la reprend en fusionnant, et part.
    await tel.local.modifier("x", { abc: "X:1\nK:C\nG2|" });
    const appliquer = tel.local.appliquerSynchro;
    let echecs = 0;
    tel.local.appliquerSynchro = async (id, e) => {
      if (e.donnees && e.donnees.titre === "Version 2" && echecs++ === 0) throw new Error("stockage plein");
      return appliquer(id, e);
    };
    await tel.synchro.synchroniser();
    assert.equal(echecs, 2, "mise de côté, puis reprise par le refus de l'envoi");
    // Au passage suivant, la version 2 mise de côté ne doit pas revenir par-dessus la 3.
    await tel.synchro.synchroniser();
    const f = await tel.local.lire("x");
    assert.equal(f.titre, "Version 2");
    assert.equal(f.abc, "X:1\nK:C\nG2|", "la correction du téléphone n'est pas écrasée par la vieille version mise de côté");
    assert.deepEqual(await tel.synchro.quarantaine(), []);
    await ordi.synchro.synchroniser();
    assert.equal((await ordi.local.lire("x")).abc, "X:1\nK:C\nG2|");
  } finally { await stockage.fermer(); }
});

test("S13 · base bloquée par un onglet resté sur l'ancienne version : un message clair, puis la bibliothèque, entière", async () => {
  // Un onglet ancien garde la base ouverte en version 1 et ne gère pas versionchange.
  const ouvrirAncien = (nom) => new Promise((ok, ko) => {
    const r = indexedDB.open(nom, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("partitions").put({ titre: "Gardée", modifieLe: "2026-10-01T10:00:00.000Z" }, "pg");
    r.onsuccess = () => ok(r.result); r.onerror = ko;
  });
  // Sans attente : une erreur qui dit quoi faire, pas une bibliothèque vide en douce.
  // (Sur une base à part : une demande d'ouverture attend derrière la précédente, comme dans un navigateur.)
  const ancien1 = await ouvrirAncien("portee-bloquee-1");
  await assert.rejects(stockageIndexe("portee-bloquee-1"), (e) => e.code === "base_bloquee" && /Ferme l'autre onglet de Portée/.test(e.message));
  ancien1.close();
  // Avec attente : le message, puis la base s'ouvre dès que l'autre onglet la lâche.
  const ancien = await ouvrirAncien("portee-bloquee");
  const messages = [];
  const local = await stockageIndexe("portee-bloquee", { surBloque: (m) => { messages.push(m); setTimeout(() => ancien.close(), 10); } });
  try {
    assert.match(messages[0], /Ferme l'autre onglet/);
    assert.equal((await local.lire("pg")).titre, "Gardée", "rien n'est perdu à la migration");
    // Et cette version-ci lâche la base quand une plus récente la demande.
    let fermee = false;
    local.surFermeture(() => { fermee = true; });
    const neuve = await new Promise((ok, ko) => { const r = indexedDB.open("portee-bloquee", 9); r.onsuccess = () => ok(r.result); r.onerror = ko; r.onblocked = () => ko(new Error("bloquée")); });
    assert.equal(fermee, true);
    neuve.close();
    await assert.rejects(local.lire("pg"), /recharge cette page/);
  } finally { local.fermer(); }
});

test("S14 · mémo sur une idée déjà synchronisée, sans autre changement : l'autre appareil le reçoit", async () => {
  const { stockage, appareil } = await monde();
  try {
    const tel = await appareil(), ordi = await appareil();
    await tel.local.creer("m2", idee("Idée", "2026-10-01T10:00:00.000Z"), []);
    await tel.synchro.synchroniser(); await ordi.synchro.synchroniser();
    await tel.local.ecrireMemo("m2", { type: "audio/mp4", base64: "BBBB", duree: 2 });
    assert.deepEqual((await tel.local.lire("m2")).memo, { duree: 2, type: "audio/mp4" }, "la fiche dit qu'il y a un mémo");
    await tel.synchro.synchroniser();
    assert.deepEqual(pagesServeur(stockage, "m2"), [{ memo: { type: "audio/mp4", base64: "BBBB", duree: 2 } }]);
    await ordi.synchro.synchroniser();
    assert.deepEqual(await ordi.local.lireMemo("m2"), { type: "audio/mp4", base64: "BBBB", duree: 2 });
  } finally { await stockage.fermer(); }
});

test("S15 · en ligne : une étoile posée sur un téléphone pas encore à jour garde les notes ajoutées sur l'ordinateur", async () => {
  const { stockage, appareil } = await monde();
  try {
    const ordi = await appareil(), tel = await appareil();
    await ordi.local.creer("i", idee("Thème", "2026-10-01T10:00:00.000Z", [{ id: 1, d: 0, l: 4, h: 60 }]), []);
    await ordi.synchro.synchroniser(); await tel.synchro.synchroniser();
    const o = await ordi.local.lire("i");
    await ordi.local.modifier("i", { sequence: seq([...o.sequence.pistes[0].notes, { id: 2, d: 4, l: 4, h: 62 }, { id: 3, d: 8, l: 4, h: 64 }, { id: 4, d: 12, l: 4, h: 65 }]), modifieLe: new Date(Date.now() - 1000).toISOString() });
    await ordi.synchro.synchroniser();
    // Le téléphone, pas encore resynchronisé, met l'idée en favori (comme accueil.js).
    await tel.local.modifier("i", { favori: true, modifieLe: new Date().toISOString() });
    await tel.synchro.synchroniser();
    await ordi.synchro.synchroniser();
    for (const f of [await ordi.local.lire("i"), await tel.local.lire("i")]) {
      assert.equal(f.favori, true);
      assert.deepEqual(notesDe(f), [1, 2, 3, 4], "les trois notes ajoutées sur l'ordinateur restent");
    }
  } finally { await stockage.fermer(); }
});

test("S16 · après un repli sur localStorage, la reprise dans IndexedDB garde le mémo et met tout à envoyer", async () => {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const { stockage, appareil } = await monde();
  try {
    m.set("portee:partitions", JSON.stringify({ pmemo: idee("Idée notée pendant le repli", "2026-10-02T09:00:00.000Z") }));
    m.set("portee:pages:pmemo", JSON.stringify([]));
    m.set("portee:memo:pmemo", JSON.stringify({ type: "audio/mp4", base64: "CCCC", duree: 4 }));
    const tel = await appareil("reprise");
    await tel.local.ecrireMeta("rejoint", true); // appareil déjà relié à la bibliothèque commune
    assert.ok(await tel.local.lire("pmemo"), "l'idée est reprise…");
    assert.deepEqual(await tel.local.lireMemo("pmemo"), { type: "audio/mp4", base64: "CCCC", duree: 4 }, "…avec son mémo…");
    assert.equal((await tel.local.enAttente())[0].id, "pmemo", "…et mise à envoyer");
    assert.equal(m.size, 0, "localStorage est vidé");
    await tel.synchro.synchroniser();
    const ordi = await appareil();
    await ordi.synchro.synchroniser();
    assert.deepEqual(await ordi.local.lireMemo("pmemo"), { type: "audio/mp4", base64: "CCCC", duree: 4 });
  } finally { delete globalThis.localStorage; await stockage.fermer(); }
});

test("Propagation · une fiche empoisonnée, une date absurde ou des pages énormes ne passent plus le connecteur", async () => {
  const { stockage, appeler, appareil } = await monde();
  try {
    const refus = async (args) => {
      const r = await appeler("bibliotheque_ecrire", args);
      assert.equal(r.accepte, false, JSON.stringify(args).slice(0, 80));
      return r.refus;
    };
    assert.match(await refus({ id: "pxss", modifieLe: "2026-10-04T10:00:00.000Z", donnees: { type: "idee", titre: "x", etiquettes: 5 } }), /etiquettes/);
    assert.match(await refus({ id: "pxss", modifieLe: "2026-10-04T10:00:00.000Z", donnees: { type: "idee", titre: "x", sequence: "pas une séquence" } }), /sequence/);
    assert.match(await refus({ id: "pxss", modifieLe: "2026-10-04T10:00:00.000Z", donnees: { type: "idee", titre: "x", memo: { duree: "<img src=x onerror=alert(1)>" } } }), /memo/);
    assert.match(await refus({ id: "pvalse", supprime: true, modifieLe: "9999-12-31T00:00:00.000Z" }), /futur/);
    assert.match(await refus({ id: "pzz", modifieLe: "zzz", donnees: { titre: "date absurde" } }), /date/);
    assert.match(await refus({ id: "pgros", modifieLe: "2026-10-04T10:00:00.000Z", donnees: { titre: "gros" }, pages: ["A".repeat(6e6)] }), /trop lourdes/);
    assert.match(await refus({ id: "pgros", modifieLe: "2026-10-04T10:00:00.000Z", donnees: { titre: "gros", note: "x".repeat(300 * 1024) } }), /trop lourde/);
    assert.equal(stockage.objet("portee-remarkable", "bibliotheque/pxss.json"), undefined);
    // Une fiche déjà là, d'avant la vérification : elle arrive remise en forme, et le carnet tient.
    const objets = objetsSupabase(stockage.url, stockage.cle);
    await objets.ecrire("bibliotheque/pvieille.json", { id: "pvieille", modifieLe: "2026-10-04T10:00:00.000Z", supprime: false, pagesLe: null,
      donnees: { type: "idee", titre: "Vieille", memo: { duree: "<img src=x onerror=alert(1)>" }, etiquettes: 5, sequence: "pas une séquence", note: 7 } });
    const tel = await appareil();
    await tel.synchro.synchroniser();
    const f = await tel.local.lire("pvieille");
    assert.deepEqual(f.etiquettes, []);
    assert.equal(f.memo.duree, 0);
    assert.equal(f.note, "7");
    assert.deepEqual(f.sequence.pistes, [{ nom: "Mélodie", notes: [] }]);
    assert.deepEqual((await liste(tel.local)).map((p) => p.titre), ["Vieille"]);
  } finally { await stockage.fermer(); }
});
