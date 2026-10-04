/**
 * Claude dans les conversations (C5) : lire une partition, noter une idée
 * neuve (jamais par-dessus une autre), ranger une suggestion à côté, et le
 * prompt « relire une page ». Sur le vrai code de la bibliothèque, avec le
 * faux stockage ; l'idée créée est reçue par la vraie synchro de l'appli.
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import abcjs from "abcjs";
import { Bibliotheque } from "../supabase/functions/portee-remarkable/bibliotheque.js";
import { objetsSupabase } from "../supabase/functions/portee-remarkable/objets.js";
import { Suggestions } from "../supabase/functions/portee-remarkable/suggestions.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { FORME_ACCORD, MESURES, nouvelId, OUTILS_CONVERSATION, TONALITES } from "../supabase/functions/portee-remarkable/conversation.js";
import * as sq from "../app/sequence.js";
import { lireAccord, voixCompletes } from "../app/harmonie.js";
import { nouvelId as nouvelIdAppli, stockageIndexe } from "../app/stockage.js";
import { creerSynchro } from "../app/synchro.js";
import { demarrerFauxStockage } from "./faux-cloud.mjs";

const QUAND = "2026-10-01T10:00:00.000Z";
const PAGE = {
  titre: "Valse à l'été", modele: "melodie-standard", abc: "X:1\nT:Valse à l'été\nM:3/4\nL:1/8\nQ:1/4=96\nK:F\nF2 A2 c2 | f4 e2 |]\n", abcLu: "",
  doutes: [
    { type: "mesure", page: 1, portee: 0, mesure: 2, message: "La mesure 2 fait 6 croches.", boite: { x0: 1, y0: 2, x1: 3, y1: 4 }, leve: true },
    { type: "crochet", page: 1, portee: 0, message: "Petit trait au bout de la hampe : lu comme une noire.", boite: { x0: 1, y0: 2, x1: 3, y1: 4 }, leve: false },
  ],
  statut: "a-relire", nbPages: 1, apercu: [[[1, 2]]], creeLe: QUAND, modifieLe: QUAND, etiquettes: ["valse"],
};
const IDEE = {
  type: "idee", titre: "Pluie", statut: "idee", nbPages: 0, modele: null, tempo: 80, note: "", etiquettes: [], favori: true, memo: null, abc: "X:1\nK:C\nC2|]\n", creeLe: QUAND, modifieLe: QUAND,
  sequence: { version: 1, tempo: 80, mesure: [4, 4], tonalite: "Am", pistes: [{ nom: "Mélodie", notes: [{ id: 1, d: 0, l: 4, h: 69 }, { id: 2, d: 4, l: 4, h: 72, v: 90 }] }], accords: [{ d: 0, nom: "Am" }], accompagnement: "plaque", suivant: 3 },
};
const MORCEAU = { type: "morceau", titre: "Chanson", tempo: 100, blocs: [{ id: "b1", idee: "pluie", nom: "Couplet", fois: 2 }], creeLe: QUAND, modifieLe: QUAND };

async function monde() {
  const stockage = await demarrerFauxStockage();
  const bib = new Bibliotheque(objetsSupabase(stockage.url, stockage.cle));
  const sug = new Suggestions(objetsSupabase(stockage.url, stockage.cle));
  await bib.ecrire({ id: "valse", donnees: PAGE, pages: [[[100, 200, 110, 210]]], modifieLe: QUAND });
  await bib.ecrire({ id: "pluie", donnees: IDEE, pages: [], modifieLe: QUAND });
  await bib.ecrire({ id: "chanson", donnees: MORCEAU, pages: [], modifieLe: QUAND });
  await bib.ecrire({ id: "efface", supprime: true, modifieLe: QUAND });
  const outil = async (name, args = {}) => (await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, null, bib, { suggestions: sug })).result;
  return { stockage, bib, sug, outil };
}

test("les outils de la conversation : schémas stricts, annotations justes", () => {
  const parNom = new Map(OUTILS_CONVERSATION.map((o) => [o.name, o]));
  for (const o of OUTILS_CONVERSATION) {
    assert.ok(o.title && o.description.length > 80, o.name);
    assert.equal(o.inputSchema.type, "object", o.name);
    assert.equal(o.inputSchema.additionalProperties, false, o.name);
    assert.ok(o.annotations && typeof o.annotations.readOnlyHint === "boolean", o.name);
    assert.equal(o.annotations.openWorldHint, false, o.name); // rien hors de la bibliothèque d'Adrien
  }
  for (const n of ["partitions_lister", "partition_lire", "suggestions_lister"]) assert.equal(parNom.get(n).annotations.readOnlyHint, true, n);
  // Créer n'écrase jamais rien ; retirer une suggestion est destructeur, mais sans effet la seconde fois.
  assert.deepEqual(parNom.get("idee_ecrire").annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
  assert.equal(parNom.get("suggestion_ecrire").annotations.destructiveHint, false);
  assert.equal(parNom.get("suggestion_retirer").annotations.destructiveHint, true);
  assert.equal(parNom.get("suggestion_retirer").annotations.idempotentHint, true);
  assert.deepEqual(parNom.get("idee_ecrire").inputSchema.required, ["titre", "notes"]);
});

test("partitions_lister : titres, types et doutes, sans les supprimées ; recherche sans accents", async () => {
  const { stockage, outil } = await monde();
  try {
    const r = await outil("partitions_lister");
    const { partitions, total } = r.structuredContent;
    assert.equal(total, 3);
    assert.deepEqual(partitions.map((p) => [p.id, p.type]).sort(), [["chanson", "morceau"], ["pluie", "idee"], ["valse", "page"]]);
    assert.equal(partitions.find((p) => p.id === "valse").doutes, 1); // un doute levé, un ouvert
    assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent); // le texte redit le JSON
    assert.deepEqual((await outil("partitions_lister", { recherche: "ETE" })).structuredContent.partitions.map((p) => p.id), ["valse"]);
    assert.deepEqual((await outil("partitions_lister", { recherche: "valse" })).structuredContent.partitions.map((p) => p.id), ["valse"]); // l'étiquette aussi
    assert.deepEqual((await outil("partitions_lister", { type: "idee" })).structuredContent.partitions.map((p) => p.id), ["pluie"]);
    assert.equal((await outil("partitions_lister", { type: "dessin" })).isError, true);
    assert.equal((await outil("partitions_lister", { tri: "titre" })).isError, true);
  } finally {
    await stockage.fermer();
  }
});

test("partition_lire : sans les traits ; les doutes encore ouverts ; les notes d'une idée", async () => {
  const { stockage, outil } = await monde();
  try {
    const page = (await outil("partition_lire", { id: "valse" })).structuredContent;
    assert.equal(page.type, "page");
    assert.equal(page.mesure, "3/4");
    assert.equal(page.tonalite, "F");
    assert.equal(page.tempo, 96);
    assert.equal(page.abc, PAGE.abc);
    assert.deepEqual(page.doutes, [{ rang: 1, type: "crochet", message: "Petit trait au bout de la hampe : lu comme une noire.", page: 1, mesure: null }]);
    for (const interne of ["pages", "traits", "apercu", "boite", "abcLu"]) assert.ok(!JSON.stringify(page).includes(`"${interne}"`), interne);
    const idee = (await outil("partition_lire", { id: "pluie" })).structuredContent;
    assert.equal(idee.type, "idee");
    assert.equal(idee.tonalite, "Am");
    assert.equal(idee.pasParMesure, 16);
    assert.deepEqual(idee.sequence.pistes[0].notes, [{ debut: 0, duree: 4, hauteur: 69 }, { debut: 4, duree: 4, hauteur: 72, velocite: 90 }]);
    assert.deepEqual(idee.sequence.accords, [{ debut: 0, nom: "Am" }]);
    const morceau = (await outil("partition_lire", { id: "chanson" })).structuredContent;
    assert.deepEqual(morceau.blocs, [{ nom: "Couplet", idee: "pluie", titreIdee: "Pluie", fois: 2 }]);
    // Une partition inconnue, supprimée ou mal nommée : une erreur qui dit où chercher.
    for (const id of ["inconnue", "efface"]) {
      const r = await outil("partition_lire", { id });
      assert.equal(r.isError, true);
      assert.match(r.content[0].text, /partitions_lister/);
    }
    assert.equal((await outil("partition_lire", { id: "../pages/valse" })).isError, true);
  } finally {
    await stockage.fermer();
  }
});

test("idee_ecrire crée une idée neuve, de la forme exacte d'une idée de l'appli", async () => {
  const { stockage, bib, outil } = await monde();
  try {
    const avant = (await bib.changements(null)).partitions;
    const args = {
      titre: "Promenade", tempo: 72, mesure: "3/4", tonalite: "G",
      notes: [{ debut: 12, duree: 4, hauteur: 71 }, { debut: 0, duree: 4, hauteur: 67 }, { debut: 4, duree: 8, hauteur: 69, velocite: 100 }],
      accords: [{ debut: 12, nom: "D7" }, { debut: 0, nom: "G" }],
    };
    const r = await outil("idee_ecrire", args);
    assert.equal(r.isError, undefined, r.content[0].text);
    const { id } = r.structuredContent;
    assert.match(id, /^p[0-9a-z]{6,}$/);
    assert.match(r.content[0].text, /Promenade/);
    assert.equal(r.structuredContent.mesures, 2);
    // Rien d'existant n'a bougé ; une seule fiche de plus.
    const apres = (await bib.changements(null)).partitions;
    assert.equal(apres.length, avant.length + 1);
    for (const f of avant) assert.deepEqual(apres.find((x) => x.id === f.id), f);
    // La forme d'une idée de l'appli (app/idee.js, donnees()), notes triées.
    const d = apres.find((x) => x.id === id).donnees;
    for (const cle of ["type", "titre", "sequence", "abc", "statut", "nbPages", "modele", "tempo", "note", "etiquettes", "favori", "memo", "creeLe", "modifieLe"]) assert.ok(cle in d, cle);
    assert.deepEqual({ ...d, creeLe: null, modifieLe: null }, {
      type: "idee", titre: "Promenade", abc: "", statut: "idee", nbPages: 0, modele: null, tempo: 72, note: "", etiquettes: [], favori: false, memo: null,
      source: { claude: true }, creeLe: null, modifieLe: null,
      sequence: {
        version: 1, tempo: 72, mesure: [3, 4], tonalite: "G",
        pistes: [{ nom: "Mélodie", notes: [{ id: 1, d: 0, l: 4, h: 67 }, { id: 2, d: 4, l: 8, h: 69, v: 100 }, { id: 3, d: 12, l: 4, h: 71 }] }],
        accords: [{ d: 0, nom: "G" }, { d: 12, nom: "D7" }], accompagnement: "plaque", suivant: 4,
      },
    });
    assert.equal(d.creeLe, d.modifieLe);
    // L'appli sait l'écrire en partition, et abcjs y relit les mêmes notes.
    const { abc } = sq.ecrireAbc(d.sequence, { voix: [d.sequence.pistes[0]], titre: d.titre });
    const [tune] = abcjs.parseOnly(abc);
    const lues = tune.setUpAudio({ chordsOff: true }).tracks[0].filter((e) => e.cmd === "note" && e.pitch >= 0).map((e) => [Math.round(e.start * 16), e.pitch]);
    assert.deepEqual(lues, [[0, 67], [4, 69], [12, 71]]);
    assert.ok(voixCompletes(d.sequence).length >= 2); // l'accompagnement plaqué se calcule
    // Deux appels, deux idées.
    const autre = (await outil("idee_ecrire", { titre: "Promenade", notes: [{ debut: 0, duree: 4, hauteur: 60 }] })).structuredContent;
    assert.notEqual(autre.id, id);
    assert.deepEqual([autre.tempo, autre.mesure, autre.tonalite], [90, "4/4", "C"]); // les réglages par défaut de l'appli
  } finally {
    await stockage.fermer();
  }
});

test("l'idée de Claude arrive dans l'appli par la synchro, comme une autre", async () => {
  const { stockage, bib, outil } = await monde();
  try {
    const { id } = (await outil("idee_ecrire", { titre: "Arrivée", notes: [{ debut: 0, duree: 2, hauteur: 64 }, { debut: 2, duree: 2, hauteur: 65 }] })).structuredContent;
    const local = await stockageIndexe(`conversation-${Date.now()}`);
    const appeler = async (name, args) => (await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, null, bib)).result.structuredContent;
    await creerSynchro({ local, appeler }).synchroniser();
    const recue = await local.lire(id);
    assert.equal(recue.type, "idee");
    assert.equal(recue.titre, "Arrivée");
    assert.deepEqual(recue.sequence.pistes[0].notes.map((n) => n.h), [64, 65]);
  } finally {
    await stockage.fermer();
  }
});

test("idee_ecrire refuse ce qui ne va pas, dit quoi corriger, et n'écrit rien", async () => {
  const { stockage, bib, outil } = await monde();
  try {
    const n = (await bib.changements(null)).partitions.length;
    const note = { debut: 0, duree: 4, hauteur: 60 };
    const cas = [
      [{ titre: "x", notes: [{ ...note, hauteur: 120 }] }, /notes\[0\]\.hauteur/],
      [{ titre: "x", notes: [{ ...note, duree: 0 }] }, /notes\[0\]\.duree/],
      [{ titre: "x", notes: [{ ...note, debut: -1 }] }, /notes\[0\]\.debut/],
      [{ titre: "x", notes: [{ ...note, debut: 1.5 }] }, /notes\[0\]\.debut/],
      [{ titre: "x", notes: [] }, /notes/],
      [{ titre: "x", notes: Array.from({ length: 4001 }, (_, i) => ({ debut: i, duree: 1, hauteur: 60 + (i % 12) })) }, /4000/],
      [{ titre: "x", notes: [note, { debut: 2, duree: 4, hauteur: 60 }] }, /se chevauchent/],
      [{ titre: "x", notes: [note], accords: [{ debut: 0, nom: "H7" }] }, /accords\[0\]\.nom/],
      [{ titre: "x", notes: [note], accords: [{ debut: 0, nom: "C" }, { debut: 0, nom: "G" }] }, /même début/],
      [{ titre: "x", notes: [note], mesure: "3/8" }, /mesure/],
      [{ titre: "x", notes: [note], tonalite: "Cmaj" }, /tonalite/],
      [{ titre: "x", notes: [note], tempo: 300 }, /tempo/],
      [{ titre: "x", notes: [note], couleur: "bleu" }, /couleur/],
      [{ titre: "  ", notes: [note] }, /titre/],
      [{ titre: "a\u0007b", notes: [note] }, /titre/],
      [{ titre: "x", notes: [{ ...note, octave: 4 }] }, /octave/],
      [{ titre: "x", notes: [{ debut: 4095, duree: 2, hauteur: 60 }] }, /duree/], // au-delà de 256 mesures
    ];
    for (const [args, motif] of cas) {
      const r = await outil("idee_ecrire", args);
      assert.equal(r.isError, true, JSON.stringify(args).slice(0, 80));
      assert.match(r.content[0].text, motif);
    }
    assert.equal((await bib.changements(null)).partitions.length, n);
  } finally {
    await stockage.fermer();
  }
});

test("suggestion_ecrire range une proposition à part, sans toucher la partition", async () => {
  const { stockage, bib, outil } = await monde();
  try {
    const avant = (await bib.changements(null)).partitions.find((f) => f.id === "pluie");
    const r = await outil("suggestion_ecrire", { cible: "pluie", genre: "accords", contenu: { accords: [{ debut: 16, nom: "F" }, { debut: 0, nom: "Am" }] }, pourquoi: "La mélodie descend vers le fa à la deuxième mesure." });
    assert.equal(r.isError, undefined, r.content[0].text);
    const s = r.structuredContent;
    assert.match(s.sid, /^s[0-9a-z]+$/);
    assert.deepEqual(s.contenu, { accords: [{ debut: 0, nom: "Am" }, { debut: 16, nom: "F" }] });
    assert.equal(s.auteur, "claude");
    // Rangée sous suggestions/<partition>/, la partition intacte.
    assert.ok(stockage.objet("portee-remarkable", `suggestions/pluie/${s.sid}.json`));
    assert.deepEqual((await bib.changements(null)).partitions.find((f) => f.id === "pluie"), avant);
    // Une réponse à un doute de la page, et une suite.
    const texte = await outil("suggestion_ecrire", { cible: "valse", genre: "texte", contenu: { doute: 1, note: "C'est sans doute une croche : la mesure tombe juste." }, pourquoi: "Avec une croche, la mesure 3 fait ses six croches." });
    assert.equal(texte.isError, undefined, texte.content[0].text);
    const suite = await outil("suggestion_ecrire", { cible: "pluie", genre: "suite", contenu: { notes: [{ debut: 0, duree: 8, hauteur: 76 }], accords: [{ debut: 0, nom: "E7" }] }, pourquoi: "Une fin en suspens, sur la dominante." });
    assert.equal(suite.isError, undefined, suite.content[0].text);
    // La liste : par partition, ou toutes.
    assert.deepEqual((await outil("suggestions_lister", { cible: "pluie" })).structuredContent.suggestions.map((x) => x.genre).sort(), ["accords", "suite"]);
    assert.equal((await outil("suggestions_lister")).structuredContent.suggestions.length, 3);
    // Ce qui ne va pas.
    const refus = [
      [{ cible: "inconnue", genre: "texte", contenu: { note: "x" }, pourquoi: "x" }, /partitions_lister/],
      [{ cible: "valse", genre: "texte", contenu: { doute: 5, note: "x" }, pourquoi: "x" }, /doute/],
      [{ cible: "pluie", genre: "texte", contenu: { doute: 0 }, pourquoi: "x" }, /pas de doute/],
      [{ cible: "pluie", genre: "texte", contenu: {}, pourquoi: "x" }, /au moins/],
      [{ cible: "pluie", genre: "accords", contenu: { notes: [{ debut: 0, duree: 1, hauteur: 60 }] }, pourquoi: "x" }, /notes/],
      [{ cible: "pluie", genre: "accords", contenu: { accords: [] }, pourquoi: "x" }, /de 1/],
      [{ cible: "pluie", genre: "melodie", contenu: { note: "x" }, pourquoi: "x" }, /genre/],
      [{ cible: "pluie", genre: "texte", contenu: { note: "x" }, pourquoi: "" }, /pourquoi/],
      [{ cible: "pluie", genre: "texte", contenu: { note: "x" } }, /pourquoi/],
    ];
    for (const [args, motif] of refus) {
      const x = await outil("suggestion_ecrire", args);
      assert.equal(x.isError, true, JSON.stringify(args));
      assert.match(x.content[0].text, motif);
    }
    assert.equal((await outil("suggestions_lister")).structuredContent.suggestions.length, 3);
  } finally {
    await stockage.fermer();
  }
});

test("suggestion_retirer : la retire, et la seconde fois ne fait rien", async () => {
  const { stockage, outil } = await monde();
  try {
    const { sid } = (await outil("suggestion_ecrire", { cible: "pluie", genre: "texte", contenu: { titre: "Averse" }, pourquoi: "Un titre plus vif." })).structuredContent;
    assert.deepEqual((await outil("suggestion_retirer", { cible: "pluie", sid })).structuredContent, { retiree: true });
    assert.deepEqual((await outil("suggestion_retirer", { cible: "pluie", sid })).structuredContent, { retiree: false });
    assert.deepEqual((await outil("suggestions_lister", { cible: "pluie" })).structuredContent.suggestions, []);
    assert.equal((await outil("suggestion_retirer", { cible: "pluie", sid: "../../bibliotheque/pluie" })).isError, true);
  } finally {
    await stockage.fermer();
  }
});

test("le prompt relire_page guide Claude, sans rien écrire", async () => {
  const init = await traiter({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, null);
  assert.deepEqual(init.result.capabilities.prompts, { listChanged: false });
  const liste = (await traiter({ jsonrpc: "2.0", id: 2, method: "prompts/list" }, null)).result.prompts;
  assert.equal(liste.length, 1);
  assert.equal(liste[0].name, "relire_page");
  assert.deepEqual(liste[0].arguments, [{ name: "id", description: "L'identifiant de la page (partitions_lister le donne).", required: true }]);
  const p = (await traiter({ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "relire_page", arguments: { id: "valse" } } }, null)).result;
  const texte = p.messages[0].content.text;
  assert.equal(p.messages[0].role, "user");
  for (const attendu of ["partition_lire", "valse", "suggestion_ecrire", "N'écris jamais dans la bibliothèque", "noms de notes"]) assert.ok(texte.includes(attendu), attendu);
  assert.equal((await traiter({ jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "tout_effacer" } }, null)).error.code, -32602);
  assert.equal((await traiter({ jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "relire_page", arguments: {} } }, null)).error.code, -32602);
});

test("les listes du connecteur sont celles de l'appli", () => {
  // Le connecteur est déployé seul : il recopie ces listes, ce test les garde d'accord.
  assert.deepEqual(TONALITES, sq.TONALITES);
  const source = fs.readdirSync("app").filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(`app/${f}`, "utf8")).join("\n");
  const m = /const MESURES = (\[[^\]]*\])/.exec(source);
  assert.ok(m, "la liste des mesures de l'éditeur d'idée (const MESURES) a changé de forme");
  assert.deepEqual(MESURES, JSON.parse(m[1]));
  const accords = ["C", "Am", "F#m7", "Bb", "G7", "Dsus4", "Cmaj7", "Em/B", "Ebmaj7", "Bm7b5", "Cdim7", "Gaug", "D9", "Fmadd9", "A7sus4", "C6", "Am6", "Cadd9", "H7", "c", "C#m7/G#", "Cmin", "C/H", "Csus"];
  for (const a of accords) assert.equal(FORME_ACCORD.test(a), lireAccord(a) !== null, a);
  // Le même format d'identifiant que l'appli.
  const forme = (id) => id.replace(/[0-9a-z]/g, "x").length;
  assert.equal(nouvelId()[0], nouvelIdAppli()[0]);
  assert.ok(Math.abs(forme(nouvelId()) - forme(nouvelIdAppli())) <= 1);
  assert.match(nouvelId(), /^p[0-9a-z]+$/);
});
