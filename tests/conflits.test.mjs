/**
 * Les copies de conflit (D4) : la version de l'autre appareil d'une page
 * lue, rangée à côté par la synchronisation. On tranche d'un geste — garder
 * celle-ci, les deux, ou l'autre — et ce qui part passe par
 * stockage.supprimer (la corbeille, de l'autre côté de la synchro). Avec le
 * vrai stockage IndexedDB (fake-indexeddb), et celui de claude.ai sur une
 * fausse base, qui ne savait pas retirer un champ.
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { stockageClaude, stockageIndexe } from "../app/stockage.js";
import { MARQUE_CONFLIT, estCopieDeConflit, titreSansMarque, trancher } from "../app/conflits.js";

const QUAND = "2026-10-01T10:00:00.000Z";
const page = (titre, extra = {}) => ({ titre, modele: "melodie-standard", abc: "X:1\nK:C\nC2 D2|", doutes: [], statut: "a-relire", nbPages: 1, creeLe: QUAND, modifieLe: QUAND, ...extra });
const traits = [[[[1, 2], [3, 4]]]];

let n = 0;
/** Une page et la version de l'autre appareil, dans un stockage IndexedDB neuf. */
async function deuxVersions() {
  const local = await stockageIndexe(`conflits-${n++}`);
  await local.creer("valse", page("Valse"), traits);
  await local.creer("valse-c1", page(`Valse${MARQUE_CONFLIT}`, { conflitDe: "valse", abc: "X:1\nK:C\nE2 F2|" }), traits);
  return local;
}

test("une copie de conflit se reconnaît, et son titre se retrouve sans la marque", () => {
  assert.equal(estCopieDeConflit({ conflitDe: "valse" }), true);
  assert.equal(estCopieDeConflit({ conflitDe: "" }), false);
  assert.equal(estCopieDeConflit({}), false);
  assert.equal(estCopieDeConflit(null), false);
  assert.equal(titreSansMarque(`Valse${MARQUE_CONFLIT}`), "Valse");
  assert.equal(titreSansMarque("Valse"), "Valse");
  // Rien d'autre que la marque : on garde le titre tel quel plutôt qu'un titre vide.
  assert.equal(titreSansMarque(MARQUE_CONFLIT.trim()), MARQUE_CONFLIT.trim());
  assert.equal(titreSansMarque(undefined), "");
});

test("garder celle-ci : elle remplace l'autre (qui part, et la synchro l'enverra), sous son titre sans marque", async () => {
  const local = await deuxVersions();
  const { gardee, supprimee } = await trancher("celle-ci", await local.lire("valse-c1"), local);
  assert.equal(supprimee.id, "valse");
  assert.equal(await local.lire("valse"), null);
  const copie = await local.lire("valse-c1");
  assert.equal(copie.titre, "Valse");
  assert.equal("conflitDe" in copie, false);
  assert.equal(copie.abc, "X:1\nK:C\nE2 F2|");
  assert.equal(gardee.titre, "Valse");
  assert.deepEqual(await local.pages("valse-c1"), traits, "ses traits restent");
  // Les deux changements partiront vers la bibliothèque commune : la suppression de l'autre, la copie sans marque.
  const envois = Object.fromEntries((await local.enAttente()).map((e) => [e.id, e]));
  assert.equal(envois.valse.supprime, true);
  assert.equal(envois["valse-c1"].supprime, false);
});

test("garder les deux : la marque s'en va, les deux restent, chacune avec son titre", async () => {
  const local = await deuxVersions();
  const { supprimee } = await trancher("les-deux", await local.lire("valse-c1"), local);
  assert.equal(supprimee, null);
  assert.equal((await local.lire("valse")).titre, "Valse");
  const copie = await local.lire("valse-c1");
  assert.equal(copie.titre, `Valse${MARQUE_CONFLIT}`);
  assert.equal(estCopieDeConflit(copie), false);
});

test("garder l'autre : celle-ci part ; sans l'autre, on ne la supprime pas", async () => {
  const local = await deuxVersions();
  const { gardee } = await trancher("l-autre", await local.lire("valse-c1"), local);
  assert.equal(gardee.id, "valse");
  assert.equal(await local.lire("valse-c1"), null);
  assert.equal((await local.lire("valse")).abc, "X:1\nK:C\nC2 D2|");
  // L'autre a disparu entre-temps : la copie est tout ce qui reste, on ne la jette pas.
  const seule = await deuxVersions();
  await seule.supprimer("valse");
  await assert.rejects(trancher("l-autre", await seule.lire("valse-c1"), seule), /n'est plus dans ta bibliothèque/);
  assert.ok(await seule.lire("valse-c1"));
  // Et « garder celle-ci » ne supprime rien de plus.
  assert.equal((await trancher("celle-ci", await seule.lire("valse-c1"), seule)).supprimee, null);
  assert.equal((await seule.lire("valse-c1")).titre, "Valse");
  await assert.rejects(trancher("celle-ci", await seule.lire("valse-c1"), seule), /pas une version de l'autre appareil/);
});

/** Une fausse base de claude.ai : `update` fusionne, `set` remplace (db.d.ts). */
function fausseBase() {
  const docs = new Map();
  const doc = (chemin) => ({
    get: async () => ({ exists: docs.has(chemin), data: () => structuredClone(docs.get(chemin)) }),
    set: async (d) => { docs.set(chemin, structuredClone(d)); },
    update: async (d) => { if (!docs.has(chemin)) throw new Error("invalid_argument"); docs.set(chemin, { ...docs.get(chemin), ...structuredClone(d) }); },
    delete: async () => { docs.delete(chemin); },
  });
  return { docs, db: { doc, collection: (nom) => ({ doc: (id) => doc(`${nom}/${id}`) }) } };
}

test("sur claude.ai aussi, la marque s'en va : un champ à undefined est retiré (update ne savait pas)", async () => {
  const { docs, db } = fausseBase();
  const s = stockageClaude(db, null);
  await s.creer("valse", page("Valse"), traits);
  await s.creer("valse-c1", page(`Valse${MARQUE_CONFLIT}`, { conflitDe: "valse" }), traits);
  await trancher("les-deux", await s.lire("valse-c1"), s);
  assert.equal("conflitDe" in docs.get("partitions/valse-c1"), false);
  assert.equal(docs.get("partitions/valse-c1").titre, `Valse${MARQUE_CONFLIT}`);
  assert.ok(docs.has("partitions/valse-c1/pages/1"), "ses traits restent");
  // Une modification ordinaire reste une fusion : rien d'autre ne part.
  await s.modifier("valse", { favori: true });
  assert.equal(docs.get("partitions/valse").favori, true);
  assert.equal(docs.get("partitions/valse").abc, "X:1\nK:C\nC2 D2|");
  await trancher("celle-ci", { ...(await s.lire("valse-c1")), conflitDe: "valse" }, s);
  assert.equal(docs.has("partitions/valse"), false);
});
