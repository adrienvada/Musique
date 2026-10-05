/**
 * LES ÉCRANS ENTRE EUX, SUR LE SITE ASSEMBLÉ
 *
 * Ce que l'audit du code et celui de l'interface (04/10) ont reproduit au
 * navigateur, et qui tient à la façon dont les écrans se passent la main
 * (T3, T4, I6, I12, I13) : une seule façon de demander « Supprimer ? »,
 * les touches qui restent aux fenêtres ouvertes, les enregistrements qui
 * partent avant qu'on change de partition, l'écoute qui ne part pas sur un
 * écran qu'on a quitté, les messages d'erreur en français.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, contexte, importerLesExemples, lancer, octetsDu, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";

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

/** Ce qui a le focus : son texte, ou son nom. */
const focus = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? (a.textContent || a.getAttribute("aria-label") || a.id || a.tagName).trim() : null;
});

test("supprimer une page lue : la même question que depuis le carnet, « Annuler » d'abord, Échap la ferme", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    await ouvrirPartition(page, "Essai melodie");
    await page.click("#plus-atelier");
    await page.click("#supprimer");
    await page.waitForSelector("#dialogue[open]");
    assert.match(await page.textContent("#dialogue h2"), /^Supprimer la partition « Essai melodie-standard » \?$/);
    // Un Entrée de trop ne supprime rien : le focus est sur « Annuler ».
    assert.equal(await focus(page), "Annuler");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#dialogue:not([open])", { state: "attached" });
    assert.equal(await page.isVisible("#vue-atelier"), true, "toujours dans « Corriger »");
    // Cette fois, oui.
    await page.click("#plus-atelier");
    await page.click("#supprimer");
    await page.click('#dialogue button[value="oui"]');
    await page.waitForSelector("#vue-biblio:not([hidden])");
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 1);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("les exports passent tous par exports.js : MusicXML et ABC d'une page, tout en MIDI", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    await ouvrirPartition(page, "Essai melodie");
    await page.click("#onglet-lecteur");
    await page.waitForSelector("#vue-lecteur:not([hidden]) #gravure-lecteur svg .abcjs-note");
    const telecharger = async (ouvrir, bouton) => {
      if (ouvrir) await page.click(ouvrir);
      const [t] = await Promise.all([page.waitForEvent("download"), page.click(bouton)]);
      return { nom: t.suggestedFilename(), octets: await octetsDu(t) };
    };
    const xml = await telecharger("#plus-lecteur", "#export-musicxml");
    assert.equal(xml.nom, "Essai melodie-standard.musicxml");
    assert.match(xml.octets.toString("utf8"), /<score-partwise/);
    const abc = await telecharger("#plus-lecteur", "#export-abc");
    assert.equal(abc.nom, "Essai melodie-standard.txt");
    assert.match(abc.octets.toString("utf8"), /^X:/m);
    await page.click("#vue-lecteur [data-retour]");
    await page.click("#tab-reglages");
    const tout = await telecharger(null, "#tout-midi");
    assert.equal(tout.nom, "Portée - MIDI.zip");
    assert.equal(tout.octets.subarray(0, 2).toString("latin1"), "PK");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
