/**
 * L'ÉDITEUR D'IDÉE, SUR LE SITE ASSEMBLÉ
 *
 * Noter une idée au clavier de l'ordinateur, la voir en grille puis en
 * partition, la retrouver après rechargement ; chanter une note dans le
 * faux micro de Chromium (un chanteur de synthèse) ; et le bouton
 * « précédent », qui ferme une feuille du bas puis recule d'un écran au
 * lieu de quitter Portée.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, TELEPHONE, contexte, dossierTemporaire, ecrireChant, lancer, ouvrirPortee, siteAssemble, verifierPropre, attendrePortee } from "./commun.mjs";

let serveur, navigateur, dossier;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  dossier = dossierTemporaire("chant");
  // La4 puis do5, tenus près d'une seconde chacun, en boucle.
  navigateur = await lancer({ micro: ecrireChant(path.join(dossier, "chant.wav"), [69, 72]) });
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const notesDeLaGrille = (page) => page.locator("#idee-grille .g-note:not(.autre)");

test("noter une idée au clavier de l'ordinateur, la voir en grille puis en partition, la retrouver après rechargement", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
    // A S D F : do ré mi fa, comme dans Ableton.
    for (const k of ["KeyA", "KeyS", "KeyD", "KeyF"]) await page.keyboard.press(k);
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 4);
    assert.deepEqual(await notesDeLaGrille(page).evaluateAll((n) => n.map((x) => x.textContent.trim())), ["do4", "ré4", "mi4", "fa4"]);
    // La même idée en partition.
    await page.click('#idee-affichage [data-affichage="partition"]');
    await page.waitForFunction(() => document.querySelectorAll("#idee-gravure .abcjs-note").length === 4);
    await page.click('#idee-affichage [data-affichage="grille"]');
    await page.waitForSelector("#idee-grille .g-note:not(.autre)");
    // Elle s'enregistre toute seule (0,7 s après la dernière note) : un rechargement la retrouve.
    await page.waitForFunction(() => document.getElementById("idee-etat").textContent === "Enregistrée");
    await page.reload();
    await attendrePortee(page);
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 1);
    await page.click("#liste .ligne-carnet .ligne-ouvrir");
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 4);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("chanter une note au micro l'écrit", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    await ctx.grantPermissions(["microphone"], { origin: serveur.origine });
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#noter-chant");
    await page.waitForSelector("#vue-idee:not([hidden]) #micro-panneau:not([hidden])");
    // Le chanteur de synthèse tient la4 puis do5 : deux notes s'écrivent, à la suite.
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length >= 2, null, { timeout: 15000 });
    const notes = await notesDeLaGrille(page).evaluateAll((n) => n.map((x) => x.textContent.trim()));
    assert.ok(notes.includes("la4") && notes.includes("do5"), `notes chantées : ${notes.join(" ")}`);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("le bouton précédent ferme une feuille du bas, puis revient au carnet, sans quitter Portée", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden])");
    await page.click("#idee-plus");
    await page.waitForSelector("#idee-menu[open]");
    await page.goBack();
    await page.waitForSelector("#idee-menu:not([open])", { state: "attached" });
    assert.equal(await page.isVisible("#vue-idee"), true, "toujours dans l'idée");
    await page.goBack();
    await page.waitForSelector("#vue-biblio:not([hidden])");
    assert.equal(new URL(page.url()).pathname, "/Musique/");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
