/**
 * Les modèles et leurs versions (L9) : chaque version garde sa calibration,
 * une version inconnue est refusée, et les lignes grises du PDF reconnaissent
 * le modèle et recalent une page qui a bougé.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { calibrationsConnues, chargerCalibration, lireFichier } from "../outils/lire.mjs";
import { ajuster, estIdentite, fichierCalibration, identifierModele, recaler, verifierVersion } from "../lecteur/modeles.js";

const MELODIE = "tests/pages/2026-09-30-melodie-standard.pdf";
const corps = (abc) => abc.split("\n").filter((l) => !/^[A-Za-z]:|^%%/.test(l)).join("\n");

/** Le PDF d'essai avec un morceau de texte remplacé, écrit dans un dossier temporaire. */
function pdfModifie(avant, apres) {
  const texte = fs.readFileSync(MELODIE).toString("latin1");
  assert.ok(texte.includes(avant));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "portee-"));
  const chemin = path.join(dossier, "page.pdf");
  fs.writeFileSync(chemin, Buffer.from(texte.replace(avant, apres), "latin1"));
  return { chemin, nettoyer: () => fs.rmSync(dossier, { recursive: true, force: true }) };
}

test("chaque modèle a sa calibration versionnée, identique à la calibration en cours", () => {
  for (const cal of calibrationsConnues()) {
    const versionnee = JSON.parse(fs.readFileSync(path.join("modeles", fichierCalibration(cal.modele, cal.version)), "utf8"));
    assert.deepEqual(versionnee, cal, cal.modele);
    assert.equal(cal.a_verifier, undefined); // la note du 30/09 sur les .rm est vérifiée depuis : retirée
  }
  assert.equal(fichierCalibration("piano-large", 3), "piano-large-v3.json");
  assert.throws(() => fichierCalibration("../secret", 1), /illisible/);
});

test("une version inconnue est refusée avec un message clair, jamais lue avec une autre calibration", async () => {
  const cal = chargerCalibration("melodie-standard", 1);
  assert.doesNotThrow(() => verifierVersion(cal, { modele: "melodie-standard", version: 1 }));
  assert.doesNotThrow(() => verifierVersion(cal, { modele: "melodie-standard", version: null })); // les pages d'avant : v1
  assert.throws(() => verifierVersion(cal, { modele: "melodie-standard", version: 2 }), /v2, que cette version de Portée ne connaît pas/);
  assert.throws(() => chargerCalibration("melodie-standard", 7), /v7/);
  assert.throws(() => chargerCalibration("melodie-geante", 1), /ne connaît pas/);
  const v2 = pdfModifie("portee:melodie-standard:v1", "portee:melodie-standard:v2");
  try {
    await assert.rejects(lireFichier(v2.chemin), /v2, que cette version de Portée ne connaît pas/);
  } finally { v2.nettoyer(); }
});

test("les lignes grises reconnaissent le modèle quand le sujet manque ou se trompe", async () => {
  const r = await lireFichier(MELODIE);
  const connues = calibrationsConnues();
  assert.equal(identifierModele(r.pages[0], connues).cal.modele, "melodie-standard");
  const piano = await lireFichier("tests/pages/2026-09-30-piano-standard.pdf");
  assert.equal(identifierModele(piano.pages[0], connues).cal.modele, "piano-standard");
  assert.equal(identifierModele({ lignes: [], verticales: [] }, connues), null);
  for (const [avant, apres, attendu] of [
    ["portee:melodie-standard:v1", "xxxxxxxxxxxxxxxxxxxxxxxxxx", /ne dit pas son modèle/],
    ["portee:melodie-standard:v1", "portee:piano-standard:v1xx", /ses lignes sont celles de « melodie-standard »/],
  ]) {
    const f = pdfModifie(avant, apres);
    try {
      const lu = await lireFichier(f.chemin);
      assert.match(lu.avertissement, attendu);
      assert.equal(corps(lu.abc), corps(r.abc));
    } finally { f.nettoyer(); }
  }
});

test("ta page redessinée et la loupe d'un doute suivent la taille de la page de la calibration", async () => {
  const { cadrePage, fenetreLoupe } = await import("../app/manuscrit.js");
  const cal = chargerCalibration("melodie-standard", 1);
  assert.deepEqual(cadrePage(cal), { gauche: 40, droite: 1374, largeur: 1334, hauteur: 1872 });
  const autre = { ...cal, page: { largeur: 1000, hauteur: 1400 }, x_debut: 60, x_fin: 950 };
  for (const boite of [{ x0: 900, y0: 1350, x1: 990, y1: 1399 }, { x0: 0, y0: 0, x1: 20, y1: 20 }, { x0: 100, y0: 300, x1: 940, y1: 400 }]) {
    const v = fenetreLoupe(autre, boite, 3.6);
    const p = cadrePage(autre);
    assert.ok(v.x >= p.gauche - 1e-9 && v.x + v.w <= p.droite + 1e-9 && v.y >= 0 && v.y + v.h <= p.hauteur + 1e-9, JSON.stringify(v));
  }
});

test("une page qui a bougé se recale sur ses lignes grises", async () => {
  const r = await lireFichier(MELODIE);
  // Sur tes pages, les lignes tombent sur la calibration : rien à recaler.
  assert.ok(estIdentite(ajuster(r.pages[0], r.cal)));
  // Une boîte de page agrandie de 20 points en haut : tout descend de 63 px, encre et lignes grises.
  const f = pdfModifie("/MediaBox[ 0 0 447.29199 596.3894]", "/MediaBox[ 0 0 447.29199 616.3894]");
  try {
    const lu = await lireFichier(f.chemin);
    assert.equal(corps(lu.abc), corps(r.abc));
    const t = ajuster(lu.pages[0], lu.cal);
    assert.ok(Math.abs(t.by + 20 * 226 / 72) < 0.01 && t.ecart < 0.01, JSON.stringify(t));
  } finally { f.nettoyer(); }
  // recaler applique la transformation, et ne touche à rien quand elle est l'identité.
  assert.deepEqual(recaler([[[10, 20]]], { ay: 1, by: 5, ax: 2, bx: 0 }), [[[20, 25]]]);
  const traits = [[[1, 2]]];
  assert.equal(recaler(traits, { ay: 1, by: 0, ax: 1, bx: 0 }), traits);
});
