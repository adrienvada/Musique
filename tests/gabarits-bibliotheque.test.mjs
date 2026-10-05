/**
 * Les gabarits de ton écriture dans la bibliothèque (L16, lot atelier) :
 * une fiche cachée par signe (fiche.js), réunie par union, jamais « la plus
 * récente gagne » ; rangée et relue par stockage.js, absente du carnet,
 * partie vers les autres appareils, emportée par la sauvegarde et réunie à
 * la restauration. Les exemples viennent du vrai lecteur (gabarits.js).
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { ajouterExemple, ETIQUETTES, fusionnerGabarits, gabaritsVides, NB_POINTS } from "../lecteur/gabarits.js";
import { egal, fusionnerExemples, fusionnerFiches, idGabarits, normaliserFiche, SIGNES_GABARITS, TYPE_GABARITS } from "../app/fiche.js";
import { lireGabarits, rangerGabarits, restaurer, sauvegarde, stockageClaude, stockageIndexe } from "../app/stockage.js";
import { creerSynchro } from "../app/synchro.js";
import { Bibliotheque } from "../supabase/functions/portee-remarkable/bibliotheque.js";
import { objetsSupabase } from "../supabase/functions/portee-remarkable/objets.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { demarrerFauxStockage } from "./faux-cloud.mjs";

const IL = 32;
/** Un signe tracé (des traits en pixels) : un trait penché et un crochet, déplacés selon `k` pour que chaque exemple soit autre. */
const signe = (k) => [[[100 + k, 100], [104 + k, 160 + k]], [[104 + k, 100], [120, 110 + k], [104 + k, 125]]];
/** Des gabarits appris par le vrai lecteur : `n` exemples de chaque signe donné. */
function appris(signes, n, depart = 0, base = gabaritsVides()) {
  let g = base;
  for (const s of signes) for (let k = 0; k < n; k++) g = ajouterExemple(g, signe(depart + k + 3 * s.length), s, IL, { source: "essai" });
  return g;
}

test("les signes, les 32 points et la fusion recopiés dans fiche.js restent ceux du lecteur", () => {
  assert.deepEqual([...SIGNES_GABARITS].sort(), Object.keys(ETIQUETTES).sort());
  assert.equal(NB_POINTS, 32);
  const a = appris(["bemol", "soupir"], 20), b = appris(["bemol", "diese"], 20, 10);
  assert.deepEqual(fusionnerExemples(a.exemples, b.exemples), fusionnerGabarits(a, b).exemples);
  assert.equal(fusionnerExemples(a.exemples, b.exemples).filter((e) => e.etiquette === "bemol").length, 24);
  assert.equal(idGabarits("C|"), "gabarits-C-barre");
  assert.ok(SIGNES_GABARITS.every((s) => /^[A-Za-z0-9_-]{1,64}$/.test(idGabarits(s))), "un identifiant que la bibliothèque commune accepte");
});

test("une fiche de gabarits ressort en forme : seuls les exemples justes de son signe restent, bornés", () => {
  const g = appris(["bemol"], 3);
  const [bon] = g.exemples;
  const brute = {
    type: TYPE_GABARITS, titre: "x", etiquette: "bemol", version: "1", creeLe: "2026-10-05T10:00:00.000Z", modifieLe: "2026-10-05T10:00:00.000Z",
    exemples: [
      ...g.exemples,
      { ...bon, id: "autre", etiquette: "soupir" }, // un autre signe
      { ...bon, id: "court", points: bon.points.slice(0, 31) }, // 31 points
      { ...bon, id: "nan", points: bon.points.map((p, i) => (i ? p : [NaN, 0])) },
      { ...bon, id: "loin", points: bon.points.map((p, i) => (i ? p : [1e9, 0])) },
      { ...bon, id: "<b>" }, // un identifiant qui n'en est pas un
      { ...bon }, // le même, deux fois
      "pas un exemple",
    ],
  };
  const f = normaliserFiche(brute);
  assert.deepEqual(f.exemples.map((e) => e.id), g.exemples.map((e) => e.id));
  assert.deepEqual([f.version, f.statut, f.nbPages, f.etiquette], [1, TYPE_GABARITS, 0, "bemol"]);
  assert.deepEqual(normaliserFiche(f), f, "deux passages valent un");
  // Trop d'exemples (une fiche bricolée) : les 24 derniers.
  const trop = appris(["bemol"], 30);
  assert.deepEqual(normaliserFiche({ ...brute, exemples: trop.exemples }).exemples.map((e) => e.id), trop.exemples.slice(-24).map((e) => e.id));
});

test("deux versions d'une fiche de gabarits se réunissent, avec ou sans base, et la réunion passe après les deux", () => {
  const debut = appris(["bemol"], 2);
  const ici = appris(["bemol"], 1, 50, debut), la = appris(["bemol"], 1, 70, debut);
  const fiche = (g, modifieLe) => normaliserFiche({ type: TYPE_GABARITS, titre: "g", etiquette: "bemol", version: 1, exemples: g.exemples, creeLe: "2026-10-01T10:00:00.000Z", modifieLe });
  const base = fiche(debut, "2026-10-02T10:00:00.000Z");
  const locale = fiche(ici, "2026-10-03T10:00:00.000Z"), distante = fiche(la, "2026-10-04T10:00:00.000Z");
  for (const b of [base, null]) {
    const { donnees, copie } = fusionnerFiches({ base: b, locale, distante });
    assert.equal(copie, null);
    assert.deepEqual(new Set(donnees.exemples.map((e) => e.id)), new Set([...ici.exemples, ...la.exemples].map((e) => e.id)));
    assert.ok(donnees.modifieLe > distante.modifieLe && donnees.modifieLe > locale.modifieLe);
  }
});

test("IndexedDB : une fiche par signe, absente du carnet, partie vers les autres appareils ; ranger deux fois la même chose n'écrit rien", async () => {
  const local = await stockageIndexe("gabarits-1");
  try {
    await local.creer("p1", { titre: "Valse", modele: "melodie-standard", abc: "X:1\nK:C\nC2|", statut: "a-relire", nbPages: 0, creeLe: "2026-10-01T10:00:00.000Z", modifieLe: "2026-10-01T10:00:00.000Z" }, []);
    const g = appris(["bemol", "soupir", "C|"], 3);
    assert.equal(await rangerGabarits(local, g), 9);
    assert.deepEqual((await new Promise((ok) => local.ecouter(ok))).map((p) => p.id), ["p1"], "le carnet ne voit que les partitions");
    const lus = await lireGabarits(local);
    assert.deepEqual(new Set(lus.exemples.map((e) => e.id)), new Set(g.exemples.map((e) => e.id)));
    assert.equal((await local.lire("gabarits-C-barre")).exemples.length, 3);
    const envois = (await local.enAttente()).map((e) => e.id).sort();
    assert.deepEqual(envois, ["gabarits-C-barre", "gabarits-bemol", "gabarits-soupir", "p1"]);
    // La même chose encore : rien de neuf, rien à envoyer de plus.
    const avant = await local.lire("gabarits-bemol");
    assert.equal(await rangerGabarits(local, g), 0);
    assert.equal((await local.lire("gabarits-bemol")).modifieLe, avant.modifieLe);
    // Un exemple de plus : il rejoint les autres.
    assert.equal(await rangerGabarits(local, appris(["bemol"], 1, 90)), 1);
    assert.equal((await local.lire("gabarits-bemol")).exemples.length, 4);
  } finally { local.fermer(); }
});

test("deux appareils apprennent chacun de leur côté : la synchro réunit tout, partout, et le carnet reste vide", async () => {
  const stockage = await demarrerFauxStockage();
  const bib = new Bibliotheque(objetsSupabase(stockage.url, stockage.cle));
  const appeler = async (outil, args) => {
    const r = await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: outil, arguments: JSON.parse(JSON.stringify(args)) } }, null, bib);
    if (r.result.isError) throw Object.assign(new Error(r.result.content[0].text), { code: "tool_error", result: r.result });
    return r.result.structuredContent;
  };
  const appareil = async (nom) => { const local = await stockageIndexe(nom); return { local, synchro: creerSynchro({ local, appeler, surEtat: () => {} }) }; };
  const ordi = await appareil("gabarits-ordi"), tel = await appareil("gabarits-tel");
  try {
    await rangerGabarits(ordi.local, appris(["bemol"], 2));
    await ordi.synchro.synchroniser(); await tel.synchro.synchroniser();
    assert.equal((await lireGabarits(tel.local)).exemples.length, 2);
    // Chacun de son côté : un bémol sur l'ordinateur ; un autre bémol et deux soupirs sur le téléphone.
    await rangerGabarits(ordi.local, appris(["bemol"], 1, 60));
    await rangerGabarits(tel.local, appris(["bemol", "soupir"], 1, 80));
    await rangerGabarits(tel.local, appris(["soupir"], 1, 99));
    await ordi.synchro.synchroniser(); await tel.synchro.synchroniser(); await ordi.synchro.synchroniser();
    for (const local of [ordi.local, tel.local]) {
      const g = await lireGabarits(local);
      assert.deepEqual([g.exemples.filter((e) => e.etiquette === "bemol").length, g.exemples.filter((e) => e.etiquette === "soupir").length], [4, 2]);
      assert.deepEqual(await new Promise((ok) => local.ecouter(ok)), []);
    }
    const serveur = JSON.parse(stockage.objet("portee-remarkable", "bibliotheque/gabarits-bemol.json"));
    assert.equal(serveur.donnees.exemples.length, 4);
  } finally { ordi.local.fermer(); tel.local.fermer(); await stockage.fermer(); }
});

test("la sauvegarde emporte tes gabarits, et la restauration les réunit à ceux d'ici", async () => {
  const ici = await stockageIndexe("gabarits-2");
  const ailleurs = await stockageIndexe("gabarits-3");
  try {
    await rangerGabarits(ici, appris(["bemol", "3"], 2));
    const fichier = JSON.parse(JSON.stringify(await sauvegarde(ici, [])));
    assert.equal(fichier.gabarits.exemples.length, 4);
    assert.deepEqual(fichier.partitions, []);
    // Ailleurs, un bémol appris là-bas : la restauration ajoute les tiens, sans retirer le sien.
    const sien = appris(["bemol"], 1, 40);
    await rangerGabarits(ailleurs, sien);
    const bilan = await restaurer(ailleurs, fichier);
    assert.deepEqual([bilan.gabarits, bilan.revenues, bilan.echecs], [4, 0, []]);
    const lus = await lireGabarits(ailleurs);
    assert.equal(lus.exemples.length, 5);
    assert.ok(lus.exemples.some((e) => e.id === sien.exemples[0].id));
    // Restaurer encore : rien de plus. Une fiche de gabarits glissée parmi les partitions est réunie elle aussi.
    assert.equal((await restaurer(ailleurs, fichier)).gabarits, 0);
    const glissee = { id: "gabarits-soupir", donnees: { type: TYPE_GABARITS, titre: "g", etiquette: "soupir", version: 1, exemples: appris(["soupir"], 2).exemples, modifieLe: "2026-10-05T10:00:00.000Z" }, pages: [] };
    const r = await restaurer(ailleurs, { format: "portee-sauvegarde", version: 1, partitions: [glissee] });
    assert.deepEqual([r.gabarits, r.revenues], [2, 0]);
    assert.deepEqual((await new Promise((ok) => ailleurs.ecouter(ok))).length, 0);
  } finally { ici.fermer(); ailleurs.fermer(); }
});

test("claude.ai : les fiches de gabarits sont dans la base de la page, chacune sous 256 Kio, et hors du carnet", async () => {
  const docs = new Map();
  const abonnes = new Set();
  const prevenir = () => { const snap = { docs: [...docs].filter(([c]) => /^partitions\/[^/]+$/.test(c)).map(([c, v]) => ({ id: c.split("/")[1], data: () => structuredClone(v) })) }; abonnes.forEach((f) => f(snap)); };
  const doc = (chemin) => ({
    async get() { return { exists: docs.has(chemin), data: () => structuredClone(docs.get(chemin)) }; },
    async set(v) { assert.ok(JSON.stringify(v).length < 256 * 1024, `${chemin} : plus de 256 Kio`); docs.set(chemin, structuredClone(v)); prevenir(); },
    async update(v) { docs.set(chemin, { ...docs.get(chemin), ...structuredClone(v) }); prevenir(); },
    async delete() { docs.delete(chemin); prevenir(); },
  });
  const db = { doc, collection: (n) => ({ doc: (id) => doc(`${n}/${id}`), orderBy: () => ({ onSnapshot: (f) => { abonnes.add(f); prevenir(); return () => abonnes.delete(f); } }) }) };
  const local = stockageClaude(db, null);
  // Tout ce que tes gabarits peuvent tenir : 24 exemples de chacun des 18 signes.
  const plein = appris(SIGNES_GABARITS, 24);
  assert.equal(await rangerGabarits(local, plein), 24 * 18);
  assert.equal([...docs.keys()].filter((c) => c.startsWith("partitions/gabarits-")).length, 18);
  assert.ok([...docs.values()].every((v) => JSON.stringify(v).length < 32 * 1024), "une fiche de signe fait moins de 32 Ko");
  assert.deepEqual(await new Promise((ok) => local.ecouter(ok)), []);
  assert.equal((await lireGabarits(local)).exemples.length, 24 * 18);
  // Un exemple de plus d'un signe plein : le plus ancien part.
  await rangerGabarits(local, appris(["bemol"], 1, 500));
  const bemol = (await local.lire("gabarits-bemol")).exemples;
  assert.equal(bemol.length, 24);
  assert.ok(!egal(bemol[0], plein.exemples.find((e) => e.etiquette === "bemol")));
});
