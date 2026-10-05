/**
 * « CORRIGER » ET LES PAGES MANUSCRITES, SUR LE SITE ASSEMBLÉ (lot atelier)
 *
 * Ce que le lot lecteur a préparé, branché dans l'appli et essayé au
 * navigateur : le modèle d'un PDF reconnu à ses lignes grises, une version
 * de modèle inconnue refusée (L9), une page lue par l'ancien lecteur relue
 * à l'ouverture.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, RACINE, contexte, dossierTemporaire, lancer, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";
import { lireFichier } from "../../outils/lire.mjs";
import { compacter } from "../../app/fiche.js";

const MELODIE = path.join(RACINE, "tests/pages/2026-09-30-melodie-standard.pdf");

let serveur, navigateur, dossier, melodie;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  navigateur = await lancer();
  dossier = dossierTemporaire("atelier");
  melodie = await lireFichier(MELODIE);
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

/** Le PDF de la mélodie, un morceau de texte remplacé par un autre de même longueur (le sujet du PDF). */
function pdfModifie(avant, apres) {
  assert.equal(avant.length, apres.length);
  const texte = fs.readFileSync(MELODIE).toString("latin1");
  assert.ok(texte.includes(avant));
  return Buffer.from(texte.replace(avant, apres), "latin1");
}

/** Le message passager, dès qu'il correspond à `motif`. */
async function messageQui(page, motif) {
  await page.waitForFunction((m) => new RegExp(m).test(document.getElementById("toast").textContent), motif.source, { timeout: 20000 });
  return page.textContent("#toast");
}

/** Une sauvegarde de Portée, écrite dans le dossier de l'essai, qui contient ces partitions ([{ id, donnees, pages }]). */
function sauvegarde(nom, partitions) {
  const fichier = path.join(dossier, `${nom}.json`);
  fs.writeFileSync(fichier, JSON.stringify({ format: "portee-sauvegarde", version: 1, creeLe: new Date().toISOString(), partitions }));
  return fichier;
}

/** Restaure une sauvegarde et revient au carnet, où ses partitions sont arrivées. */
async function restaurer(page, fichier, n) {
  await page.click("#tab-reglages");
  await page.setInputFiles("#restaurer", fichier);
  await page.click("#tab-carnet");
  await page.waitForFunction((k) => document.querySelectorAll("#liste .ligne-carnet").length === k, n);
}

/** Ouvre une partition lue depuis le carnet (son titre commence par `titre`). */
async function ouvrirPartition(page, titre) {
  await page.click(`#liste .ligne-carnet button[aria-label^="Ouvrir « ${titre}"]`);
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
}

test("L9 · un PDF dont le sujet se trompe ou manque : ses lignes grises disent le modèle, et on le dit ; une version inconnue est refusée", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    // Le sujet dit « piano », les lignes sont celles de la mélodie : lue en mélodie, comme `npm run lire`.
    await page.setInputFiles("#fichier", { name: "Faux piano.pdf", mimeType: "application/pdf", buffer: pdfModifie("portee:melodie-standard:v1", "portee:piano-standard:v1  ") });
    const faux = await messageQui(page, /^« Faux piano » est lue/);
    assert.match(faux, /Le PDF dit « Piano », mais ses lignes sont celles de « Mélodie » : lue avec ce modèle\./, faux);
    await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
    assert.equal(await page.inputValue("#abc"), melodie.abc.replace(/^T:.*$/m, "T:Faux piano"));
    await page.click("#vue-atelier [data-retour]");
    // Sans sujet du tout : reconnu à ses lignes.
    await page.setInputFiles("#fichier", { name: "Sans sujet.pdf", mimeType: "application/pdf", buffer: pdfModifie("portee:melodie-standard:v1", " ".repeat(26)) });
    assert.match(await messageQui(page, /^« Sans sujet » est lue/), /ne disait pas son modèle : reconnu à ses lignes \(Mélodie\)/);
    await page.click("#vue-atelier [data-retour]");
    // Une version que cette appli ne connaît pas : refusée, avec quoi faire, et rien n'est rangé.
    await page.setInputFiles("#fichier", { name: "Version 2.pdf", mimeType: "application/pdf", buffer: pdfModifie("portee:melodie-standard:v1", "portee:melodie-standard:v2") });
    const v2 = await messageQui(page, /^Impossible de lire « Version 2\.pdf »/);
    assert.match(v2, /v2, que cette version de Portée ne connaît pas.*mets l'appli à jour/, v2);
    assert.equal(await page.locator("#liste .ligne-carnet").count(), 2);
    // La version du modèle est rangée avec la page (une relecture prendra la même calibration).
    const versions = await page.evaluate(() => new Promise((ok) => {
      const r = indexedDB.open("portee");
      r.onsuccess = () => { const q = r.result.transaction("partitions").objectStore("partitions").getAll(); q.onsuccess = () => { ok(q.result.map((p) => [p.versionModele, p.versionLecteur])); r.result.close(); }; };
    }));
    assert.deepEqual(versions, [[1, 2], [1, 2]]);
    // Le refus garde son détail dans la console (après la calibration v2, cherchée en vain), et rien d'autre ne s'y plaint.
    assert.deepEqual(page.erreurs.map((e) => /404|v2, que cette version/.test(e)), [true, true]);
    page.erreurs.length = 0;
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("une page lue par l'ancien lecteur, jamais touchée, est relue à l'ouverture ; une page corrigée garde sa lecture", async () => {
  const traits = [compacter(melodie.pages[0].traits)];
  const ancien = melodie.abc.replace(/^T:.*$/m, "T:Ancienne").replace(/\|/, "||"); // une lecture d'avant, un peu autre
  const date = "2026-09-30T10:00:00.000Z";
  const fiche = (titre, abc) => ({ titre, modele: "melodie-standard", abc, abcLu: ancien, doutes: [{ page: 1, portee: 0, message: "Ligne 2, 3ᵉ mesure : 11 croches au lieu de 12.", leve: false }], statut: "a-relire", nbPages: 1, versionLecteur: 1, creeLe: date, modifieLe: date });
  const fichier = sauvegarde("anciennes", [
    { id: "pancienne", donnees: fiche("Ancienne", ancien), pages: traits },
    { id: "pcorrigee", donnees: fiche("Corrigée", ancien.replace(/c2/, "d2")), pages: traits },
  ]);
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await restaurer(page, fichier, 2);
    await ouvrirPartition(page, "Ancienne");
    const dit = await messageQui(page, /a été relue par le lecteur d'aujourd'hui/);
    assert.equal(dit, `« Ancienne » a été relue par le lecteur d'aujourd'hui, qui lit mieux : ${melodie.doutes.length} points à vérifier.`);
    await page.waitForFunction((abc) => document.getElementById("abc").value === abc, melodie.abc.replace(/^T:.*$/m, "T:Ancienne"));
    // Ses doutes sont ceux de la lecture neuve, avec leurs réponses fermées.
    await page.waitForSelector("#doutes .reponses .reponse[data-reponse]");
    assert.equal(await page.textContent("#dock-titre"), `Doute 1 sur ${melodie.doutes.length}`);
    // Une page que tu as corrigée garde ta lecture.
    await page.click("#vue-atelier [data-retour]");
    await ouvrirPartition(page, "Corrigée");
    assert.equal(await page.inputValue("#abc"), ancien.replace(/c2/, "d2"));
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
