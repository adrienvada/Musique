/**
 * LES PARCOURS DE CLAUDE.md, SUR LE SITE ASSEMBLÉ
 *
 * Ce qu'on faisait à la main avant chaque mise en ligne : la page s'ouvre
 * sans erreur, on importe les pages d'essai, on règle un doute et on
 * corrige une note (puis on annule), on écoute, on exporte le MIDI, on
 * sauvegarde puis on restaure dans un navigateur vierge. Chaque essai part
 * d'un navigateur neuf ; la CSP du site est là, et rien ne sort de la
 * machine (commun.mjs).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, TELEPHONE, contexte, dossierTemporaire, importerLesExemples, lancer, octetsDu, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";

let serveur, navigateur;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
});

/** Ouvre une partition lue depuis le carnet (son titre commence par `titre`). */
async function ouvrirPartition(page, titre) {
  await page.click(`#liste .ligne-carnet button[aria-label^="Ouvrir « ${titre}"]`);
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
}

test("la page s'ouvre sans erreur ; ses polices et abcjs viennent du site", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    const etat = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        polices: [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")))].sort(),
        abcjs: typeof window.ABCJS,
        icones: !!document.querySelector("#icones-portee #i-carnet"),
      };
    });
    assert.deepEqual(etat.polices, ["IBM Plex Sans", "Young Serif"]);
    assert.equal(etat.abcjs, "object");
    assert.equal(etat.icones, true);
    assert.ok(serveur.etat.demandes.some((d) => d.startsWith("/Musique/polices/") && d.includes(".woff2")), "les polices viennent du site");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("importer les pages d'essai, régler un doute, corriger une note, annuler", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    assert.deepEqual((await page.locator("#liste .ligne-titre").allTextContents()).sort(), ["Essai melodie-standard", "Essai piano-standard"]);
    await ouvrirPartition(page, "Essai melodie");
    const abc0 = await page.inputValue("#abc");
    // Un doute : on choisit une réponse fermée ; le doute est réglé, le suivant vient.
    const question = page.locator("#doutes .doute-question");
    const q1 = await question.textContent();
    await page.locator("#doutes .reponses .reponse[data-reponse]").last().click();
    await page.waitForFunction((q) => document.querySelector("#doutes .doute-question")?.textContent !== q || document.querySelector("#doutes .doute-etat"), q1);
    assert.equal(await page.isEnabled("#annuler"), true);
    // « Annuler » défait la réponse et rouvre le doute.
    await page.click("#annuler");
    await page.waitForFunction((q) => document.querySelector("#doutes .doute-question")?.textContent === q, q1);
    assert.equal(await page.inputValue("#abc"), abc0);
    // Une note touchée dans la partition lue, montée d'un degré, puis l'annulation.
    await page.click('#vues-atelier [data-vue="lue"]');
    const note = await page.locator("#gravure-atelier .abcjs-note").nth(2).boundingBox();
    await page.mouse.click(note.x + note.width / 2, note.y + note.height / 2);
    await page.waitForSelector("#outils-note:not([hidden])");
    const avant = await page.locator("#note-choisie").textContent();
    await page.click('#outils-note [data-geste="haut"]');
    await page.waitForFunction((a) => document.getElementById("note-choisie").textContent !== a, avant);
    assert.notEqual(await page.inputValue("#abc"), abc0);
    await page.click("#annuler");
    await page.waitForFunction((abc) => document.getElementById("abc").value === abc, abc0);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("écouter puis arrêter ; le MIDI exporté commence par MThd", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    // Les notes qui partent vraiment au piano (le son, lui, ne s'entend pas ici).
    await ctx.addInitScript(() => {
      window.__notes = 0;
      const depart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...a) { window.__notes++; return depart.apply(this, a); };
    });
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    await ouvrirPartition(page, "Essai melodie");
    await page.click("#onglet-lecteur");
    await page.waitForSelector("#vue-lecteur:not([hidden]) #gravure-lecteur svg .abcjs-note");
    await page.click("#ecouter");
    await page.waitForFunction(() => /Arrêter/.test(document.getElementById("ecouter").textContent) && window.__notes > 0, null, { timeout: 20000 });
    await page.click("#ecouter");
    await page.waitForFunction(() => /Écouter/.test(document.getElementById("ecouter").textContent));
    const [telechargement] = await Promise.all([page.waitForEvent("download"), page.click("#export-midi")]);
    assert.equal(telechargement.suggestedFilename(), "Essai melodie-standard.mid");
    assert.equal((await octetsDu(telechargement)).subarray(0, 4).toString("latin1"), "MThd");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("sauvegarder, puis restaurer dans un navigateur vierge", async () => {
  const dossier = dossierTemporaire("sauvegarde");
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  let fichier, titres;
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    // Une idée aussi, notée au clavier de l'ordinateur.
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden])");
    for (const k of ["KeyA", "KeyS", "KeyD"]) await page.keyboard.press(k);
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 3);
    await page.click("#vue-idee [data-retour]");
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 3);
    titres = (await page.locator("#liste .ligne-titre").allTextContents()).sort();
    await page.click("#tab-reglages");
    const [telechargement] = await Promise.all([page.waitForEvent("download"), page.click("#sauvegarder")]);
    assert.match(telechargement.suggestedFilename(), /^Portée - sauvegarde \d{4}-\d\d-\d\d\.json$/);
    fichier = path.join(dossier, telechargement.suggestedFilename());
    await telechargement.saveAs(fichier);
    await verifierPropre(page);
  } finally { await ctx.close(); }
  // Un autre navigateur, vierge : la sauvegarde y ramène tout, traits compris.
  const vierge = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(vierge, serveur.url);
    assert.equal(await page.locator("#liste .ligne-carnet").count(), 0);
    await page.click("#tab-reglages");
    await page.setInputFiles("#restaurer", fichier);
    await page.click("#tab-carnet");
    await page.waitForFunction((n) => document.querySelectorAll("#liste .ligne-carnet").length === n, titres.length);
    assert.deepEqual((await page.locator("#liste .ligne-titre").allTextContents()).sort(), titres);
    await ouvrirPartition(page, "Essai melodie");
    // Ta page, redessinée d'après ses traits : ils ont voyagé avec la sauvegarde.
    await page.click('#vues-atelier [data-vue="page"]');
    await page.waitForFunction(() => document.querySelectorAll("#page .encre polyline").length > 20);
    await verifierPropre(page);
  } finally {
    await vierge.close();
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});
