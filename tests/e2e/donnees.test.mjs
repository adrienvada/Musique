/**
 * LES ÉCRANS DES DONNÉES, SUR LE SITE ASSEMBLÉ
 *
 * Ce que le lot « données » avait préparé sans écran, branché dans l'appli
 * (D2, D4, D6, D7, D9, H3, B12) : ce qui garde la bibliothèque sur cet
 * appareil et la sauvegarde ; ce que la synchronisation met de côté ; les
 * copies de conflit ; la corbeille et les versions précédentes ; les
 * suggestions que Claude range depuis une conversation. La synchronisation
 * passe par le vrai connecteur (http.js), sur le faux stockage des tests.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, TELEPHONE, contexte, dossierTemporaire, importerLesExemples, lancer, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";

let serveur, navigateur;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
});

/** Le message passager, dès qu'il correspond à `motif`. */
async function messageQui(page, motif) {
  await page.waitForFunction((m) => new RegExp(m).test(document.getElementById("toast").textContent), motif.source, { timeout: 20000 });
  return page.textContent("#toast");
}

/** Une idée de trois notes, notée au clavier de l'ordinateur, puis retour au carnet. */
async function noterUneIdee(page, n = 3) {
  await page.click("#nouvelle-idee");
  await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
  for (const k of ["KeyA", "KeyS", "KeyD", "KeyF"].slice(0, n)) await page.keyboard.press(k);
  await page.waitForFunction(() => document.getElementById("idee-etat").textContent === "Enregistrée");
  await page.click("#vue-idee [data-retour]");
  await page.waitForSelector("#vue-biblio:not([hidden])");
}

// ---------------------------------------------------------------------------
// D7 : deux onglets
// ---------------------------------------------------------------------------

test("deux onglets : ce qui est noté dans l'un apparaît dans l'autre ; l'idée ouverte des deux côtés se reprend, « dans un autre onglet » (D7)", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const a = await ouvrirPortee(ctx, serveur.url);
    const b = await ouvrirPortee(ctx, serveur.url);
    await noterUneIdee(a);
    // La liste de l'autre onglet se rafraîchit d'elle-même.
    await b.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 1);
    await b.click("#liste .ligne-carnet .ligne-ouvrir");
    await b.waitForSelector("#vue-idee:not([hidden])");
    await b.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 3);
    // La même idée, changée dans le premier onglet : le second la reprend, et dit d'où vient le changement.
    await a.click("#liste .ligne-carnet .ligne-ouvrir");
    // La grille de l'éditeur garde celle d'avant tant qu'il n'est pas rouvert : on attend l'écran.
    await a.waitForFunction(() => !document.getElementById("vue-idee").hidden && document.getElementById("idee-etat").textContent === "");
    await a.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 3);
    await a.keyboard.press("KeyF");
    await a.waitForFunction(() => document.getElementById("idee-etat").textContent === "Enregistrée");
    await b.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 4, null, { timeout: 15000 });
    assert.match(await messageQui(b, /autre onglet/), /a été modifiée dans un autre onglet : mise à jour\.$/);
    await verifierPropre(a);
    await verifierPropre(b);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// D9 et B12 : ce qui garde la bibliothèque, la sauvegarde et son rappel
// ---------------------------------------------------------------------------

test("Réglages : la bibliothèque protégée ou non, la place prise ; la sauvegarde dit ce qu'elle contient, et sa date (D9, B12)", async () => {
  const dossier = dossierTemporaire("garde");
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    await noterUneIdee(page);
    await page.click("#tab-reglages");
    await page.waitForSelector("#garde-ligne:not([hidden])");
    assert.match(await page.textContent("#garde-protegee"), /^(Oui|Non|On ne sait pas)$/);
    assert.match(await page.textContent("#garde-place"), /\d+(,\d)? (octets|Ko|Mo|Go)/);
    // Chromium, hors Safari : pas de guide d'installation.
    assert.equal(await page.isVisible("#garde-guide"), false);
    assert.equal(await page.textContent("#derniere-sauvegarde"), "Jamais");
    // Une idée n'est pas une partition (B12).
    const [telechargement] = await Promise.all([page.waitForEvent("download"), page.click("#sauvegarder")]);
    assert.equal(await messageQui(page, /sauvegard/), "1 idée et 2 partitions sauvegardées.");
    const fichier = path.join(dossier, telechargement.suggestedFilename());
    await telechargement.saveAs(fichier);
    assert.match(await page.textContent("#derniere-sauvegarde"), /^le \d+ /);
    await verifierPropre(page);
    // Restaurée dans un navigateur vierge : le bilan le dit par sorte.
    const vierge = await contexte(navigateur, { appareil: TELEPHONE });
    try {
      const autre = await ouvrirPortee(vierge, serveur.url);
      await autre.click("#tab-reglages");
      await autre.setInputFiles("#restaurer", fichier);
      assert.equal(await messageQui(autre, /revenu/), "1 idée et 2 partitions revenues.");
      await verifierPropre(autre);
    } finally { await vierge.close(); }
  } finally {
    await ctx.close();
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test("sans synchronisation, une sauvegarde de plus de 30 jours se rappelle : dans les Réglages, et discrètement en haut (D9)", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    await ctx.addInitScript((quand) => { try { localStorage.setItem("portee:derniere-sauvegarde", quand); } catch { /* sans stockage */ } }, new Date(Date.now() - 45 * 86400000).toISOString());
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    await page.waitForFunction(() => document.getElementById("etat-synchro").dataset.ton === "alerte");
    assert.match(await page.getAttribute("#etat-synchro", "aria-label"), /pense à sauvegarder/);
    // L'icône mène à la sauvegarde.
    await page.click("#etat-synchro");
    await page.waitForSelector("#rappel-sauvegarde:not([hidden])");
    assert.match(await page.textContent("#rappel-sauvegarde"), /date de 45 jours/);
    // Sauvegardée : le rappel s'en va, partout.
    await Promise.all([page.waitForEvent("download"), page.click("#sauvegarder")]);
    await page.waitForSelector("#rappel-sauvegarde", { state: "hidden" });
    await page.waitForFunction(() => document.getElementById("etat-synchro").dataset.ton === "gris");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("sur l'iPhone, dans Safari : pas protégée, et le guide pour installer Portée sur l'écran d'accueil (D9)", async () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
  const ctx = await contexte(navigateur, { appareil: { ...TELEPHONE, userAgent: iphone } });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#tab-reglages");
    await page.waitForSelector("#garde-guide:not([hidden])");
    assert.equal(await page.textContent("#garde-protegee"), "Non");
    const guide = await page.textContent("#garde-guide");
    assert.match(guide, /Installe Portée sur l'écran d'accueil/);
    assert.match(guide, /Partager/);
    assert.match(guide, /7 jours sans visite/);
    assert.match(guide, /sauvegarde/); // pas de synchronisation : l'appli installée repart d'une sauvegarde
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
