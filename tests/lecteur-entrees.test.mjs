/**
 * Ce que le lecteur reçoit : des traits au demi-pixel quelle que soit leur
 * source, des entrées abîmées qui ne le font plus planter, un PDF dont la page
 * ne part pas de (0, 0), la version du modèle et ses lignes grises.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { lireFichier } from "../outils/lire.mjs";
import { lirePartition } from "../lecteur/partition.js";
import { degreOctave, verifierCalibration } from "../lecteur/lecteur.js";
import { preparerTraits } from "../lecteur/traits.js";
import { lireDocument, lireSujet } from "../lecteur/extraction.js";
import { compacter, decompacter } from "../app/stockage.js";

const MELODIE = "tests/pages/2026-09-30-melodie-standard.pdf";
const PIANO = "tests/pages/2026-09-30-piano-standard.pdf";
const corps = (abc) => abc.split("\n").filter((l) => !/^[A-Za-z]:|^%%/.test(l)).join("\n");

/** Le PDF d'essai, avec un morceau de texte remplacé (pdf.js retrouve ses objets même si la longueur change). */
async function documentModifie(chemin, avant, apres) {
  const texte = fs.readFileSync(chemin).toString("latin1");
  assert.ok(texte.includes(avant), `« ${avant} » absent de ${chemin}`);
  const data = new Uint8Array(Buffer.from(texte.replace(avant, apres), "latin1"));
  return pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
}

test("les traits sont ramenés au demi-pixel, comme le stockage les range", () => {
  const traits = [[[10.26, 20.74], [11.1, 21.9]], [[0.25, -0.25], [3.75, 4.249]]];
  const prets = preparerTraits(traits);
  assert.deepEqual(prets, [[[10.5, 20.5], [11, 22]], [[0.5, -0], [4, 4]]]);
  // Le même arrondi que stockage.compacter : une page rangée puis relue ne bouge plus.
  assert.deepEqual(decompacter(compacter(traits)).map((t) => t.map((p) => p.map((v) => v + 0))), prets.map((t) => t.map((p) => p.map((v) => v + 0))));
  // Et l'appliquer deux fois ne change rien.
  assert.deepEqual(preparerTraits(prets), prets);
});

test("points non finis, hors de la page et traits vides sont écartés, sans décaler les numéros", () => {
  const prets = preparerTraits([[[NaN, 1], [5, 5], [Infinity, 2], [6, 6]], [], [[1e9, 2e9], [3e9, 1]], null, [[7, 7]]]);
  assert.deepEqual(prets, [[[5, 5], [6, 6]], [], [], [], [[7, 7]]]);
});

test("une page abîmée se lit comme la page propre (point NaN, trait vide, trait d'un point, trait géant)", async () => {
  const r = await lireFichier(MELODIE);
  const traits = r.pages[0].traits.map((t) => t.slice());
  traits[0] = traits[0].slice(); traits[0].splice(5, 0, [NaN, NaN]);
  traits.push([], [[500, 500]], [[Infinity, 1e9], [Infinity, 2e9]], [[-5000, -5000], [9000, 9000]]);
  const res = lirePartition([traits], r.cal, { titre: "x" });
  assert.equal(corps(res.abc), corps(r.abc));
  assert.deepEqual(res.doutes.map((d) => d.type), r.doutes.map((d) => d.type));
  // Aucune page, une page vide : une partition vide, sans erreur.
  assert.equal(corps(lirePartition([], r.cal).abc), "");
  assert.equal(corps(lirePartition([[]], r.cal).abc), "");
});

test("une calibration incomplète est refusée avec un message clair", async () => {
  const { cal } = await lireFichier(PIANO);
  assert.throws(() => verifierCalibration({ ...cal, interligne: undefined }), /interligne manque/);
  assert.throws(() => lirePartition([[]], { ...cal, systemes: [] }), /aucune portée/);
  assert.throws(() => lirePartition([[]], { ...cal, systemes: [{ portees: [{ ...cal.systemes[0].portees[0], lignes: [1, 2, 3] }] }] }), /cinq lignes/);
  assert.throws(() => lirePartition([[]], { genre: "etalonnage", interligne: 28, cases: [] }), /étalonnage/);
  assert.throws(() => degreOctave("ut"), /pas un nom de note/);
  assert.deepEqual([degreOctave("mi4"), degreOctave("sol2"), degreOctave("fa3")], [[2, 4], [4, 2], [3, 3]]);
});

test("une clé que le lecteur ne connaissait pas (ut) se lit d'après sa ligne du bas", async () => {
  const r = await lireFichier(MELODIE);
  const ut = { ...r.cal, systemes: r.cal.systemes.map((s) => ({ portees: s.portees.map((p) => ({ ...p, cle: "ut3", ligne_du_bas: "fa3" })) })) };
  const res = lirePartition(r.pages.map((p) => p.traits), ut, { titre: "x" });
  // Tout est lu une septième plus bas (fa3 au lieu de mi4 sur la ligne du bas), et la clé est dite à abcjs.
  assert.equal(corps(res.abc).split("\n")[0], "D,2 E,2 F,2 G,2 A,2 B,2 C2 D2");
  assert.match(res.abc, /^K:C clef=alto$/m);
});

test("le sujet du PDF donne le modèle et sa version", () => {
  assert.deepEqual(lireSujet("portee:melodie-standard:v1"), { modele: "melodie-standard", version: 1 });
  assert.deepEqual(lireSujet("portee:piano-large:v12"), { modele: "piano-large", version: 12 });
  assert.deepEqual(lireSujet("portee:piano-standard:v1x"), { modele: "piano-standard", version: null });
  assert.deepEqual(lireSujet("Portée — Mélodie"), { modele: null, version: null });
  assert.deepEqual(lireSujet(undefined), { modele: null, version: null });
});

test("une page v2 annonce sa version, au lieu d'être lue en silence comme une v1", async () => {
  const doc = await documentModifie(MELODIE, "portee:melodie-standard:v1", "portee:melodie-standard:v2");
  const lu = await lireDocument(pdfjs, doc);
  assert.deepEqual([lu.modele, lu.version], ["melodie-standard", 2]);
});

test("une page dont la boîte ne part pas de (0, 0) se lit comme la page d'origine", async () => {
  const r = await lireFichier(MELODIE);
  const doc = await documentModifie(MELODIE, "/MediaBox[ 0 0 447.29199 596.3894]", "/MediaBox[0 -50 447.29199 596.3894]");
  assert.deepEqual((await doc.getPage(1)).view.map(Math.round), [0, -50, 447, 596]);
  const lu = await lireDocument(pdfjs, doc);
  const res = lirePartition(lu.pages.map((p) => p.traits), r.cal, { titre: "x" });
  assert.equal(corps(res.abc), corps(r.abc));
});

test("les lignes grises du modèle sont relues, exactes à la calibration", async () => {
  for (const f of [MELODIE, PIANO]) {
    const r = await lireFichier(f);
    const attendues = r.cal.systemes.flatMap((s) => s.portees.flatMap((p) => p.lignes));
    const { lignes, verticales } = r.pages[0];
    assert.equal(lignes.length, attendues.length, f);
    attendues.forEach((y, i) => assert.ok(Math.abs(lignes[i] - y) < 0.01, `${f} : ligne ${i} à ${lignes[i]} au lieu de ${y}`));
    assert.deepEqual(verticales.map(Math.round), [r.cal.x_debut, r.cal.x_fin]);
  }
});

test("un modèle inconnu est refusé avec un message clair (et plus un ENOENT)", async () => {
  const texte = fs.readFileSync(MELODIE).toString("latin1").replace("portee:melodie-standard:v1", "portee:melodie-geante--:v1");
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "portee-"));
  const chemin = path.join(dossier, "modele-inconnu.pdf");
  fs.writeFileSync(chemin, Buffer.from(texte, "latin1"));
  try {
    await assert.rejects(lireFichier(chemin), /modèle « melodie-geante-- », que cette version de Portée ne connaît pas/);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});
