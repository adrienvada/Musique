/**
 * HORS LIGNE (le service worker du site, I5)
 *
 * Chaque essai a son serveur : on le coupe (hors ligne), on le ralentit, on
 * y met une nouvelle version, ou une panne sur un fichier. C'est le serveur
 * qu'on coupe : ni `context.setOffline` ni le bridage de Chromium ne
 * touchent les requêtes du service worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, TELEPHONE, attendrePortee, attendreToutGarde, contexte, dossierTemporaire, importerLesExemples, lancer, nouvelleVersion, nouvellePage, ouvrirPortee, siteAssemble, versionDu, verifierPropre } from "./commun.mjs";

const SITE = siteAssemble();
const versionDeLaPage = (page) => page.evaluate(() => new URL(document.querySelector('script[type="module"]').src).searchParams.get("v"));

/** Un serveur et un navigateur pour l'essai, fermés à la fin. */
async function monde(f) {
  const serveur = await servir({ dossier: SITE });
  const navigateur = await lancer();
  try { await f(serveur, navigateur); } finally {
    await navigateur.close();
    await serveur.fermer();
  }
}

test("hors ligne dès la première visite : la page, l'import des pages d'essai, la gravure, le piano", () => monde(async (serveur, navigateur) => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  await ctx.addInitScript(() => {
    window.__notes = 0;
    const depart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { window.__notes++; return depart.apply(this, a); };
  });
  const page = await ouvrirPortee(ctx, serveur.url);
  await attendreToutGarde(page, SITE);
  serveur.reseau(false);
  await page.reload();
  await attendrePortee(page);
  await importerLesExemples(page); // pdf.js et son worker, les calibrations, les pages : tout vient de la copie
  await page.click('#liste .ligne-carnet button[aria-label^="Ouvrir « Essai melodie"]');
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
  await page.click("#onglet-lecteur");
  await page.click("#ecouter");
  await page.waitForFunction(() => /Arrêter/.test(document.getElementById("ecouter").textContent) && window.__notes > 0, null, { timeout: 15000 });
  await verifierPropre(page);
}));

test("une mise en ligne ratée laisse l'ancienne version entière ; la suivante propose de recharger, et tient hors ligne", () => monde(async (serveur, navigateur) => {
  const v2 = path.join(dossierTemporaire("v2"), "dist");
  const version2 = nouvelleVersion(SITE, v2);
  try {
    const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
    const page = await ouvrirPortee(ctx, serveur.url);
    await attendreToutGarde(page, SITE);
    // La v2 est en ligne, mais un de ses modules ne répond pas : son service worker n'est pas installé.
    serveur.mettreEnLigne(v2);
    serveur.etat.pannes.set("accueil.js", 503);
    const fin = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await r.update().catch(() => {});
      const w = r.installing;
      if (!w) return "rien à installer";
      return new Promise((ok) => w.addEventListener("statechange", () => { if (w.state === "redundant" || w.state === "activated") ok(w.state); }));
    });
    assert.equal(fin, "redundant");
    serveur.reseau(false);
    await page.reload();
    await attendrePortee(page);
    assert.equal(await versionDeLaPage(page), versionDu(SITE), "hors ligne, la v1 entière");
    // La panne passée : la v2 s'installe pendant que la page v1 reste ouverte, qui propose de recharger.
    serveur.reseau(true);
    serveur.etat.pannes.clear();
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForSelector("#toast-version");
    await attendreToutGarde(page, v2);
    await Promise.all([page.waitForNavigation(), page.click("#toast-version button")]);
    await attendrePortee(page);
    assert.equal(await versionDeLaPage(page), version2);
    serveur.reseau(false);
    await page.reload();
    await attendrePortee(page);
    assert.equal(await versionDeLaPage(page), version2, "hors ligne, la v2");
    await verifierPropre(page);
  } finally { fs.rmSync(path.dirname(v2), { recursive: true, force: true }); }
}));

test("une réponse d'erreur n'est jamais gardée : abcjs revient dès que le serveur répond", () => monde(async (serveur, navigateur) => {
  const ABCJS = "vendor/abcjs/abcjs-basic-min.js";
  serveur.etat.pannes.set(ABCJS, 503); // un portail Wi-Fi, une panne passagère
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  const page = await nouvellePage(ctx);
  await page.goto(serveur.url);
  await attendrePortee(page);
  assert.equal(await page.evaluate(() => typeof window.ABCJS), "undefined");
  serveur.etat.pannes.clear();
  await page.reload();
  await attendrePortee(page);
  await attendreToutGarde(page, SITE);
  serveur.reseau(false);
  await page.reload();
  await attendrePortee(page);
  assert.equal(await page.evaluate(() => typeof window.ABCJS), "object", "hors ligne, abcjs vient de la copie");
  // Les erreurs de la visite en panne étaient voulues (abcjs absent) ; depuis, plus aucune.
  page.erreurs.length = 0;
  await page.reload();
  await attendrePortee(page);
  await verifierPropre(page);
}));

test("un réseau qui traîne : au bout de 2,5 s, la copie", () => monde(async (serveur, navigateur) => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  const page = await ouvrirPortee(ctx, serveur.url);
  await attendreToutGarde(page, SITE);
  serveur.ralentir(10000); // chaque réponse du serveur met 10 s
  const debut = Date.now();
  await page.reload({ waitUntil: "commit" });
  await attendrePortee(page);
  const duree = Date.now() - debut;
  serveur.ralentir(0);
  assert.ok(duree < 7000, `l'appli a mis ${duree} ms à s'ouvrir (le serveur, 10 s)`);
  assert.equal(await page.evaluate(() => typeof window.ABCJS), "object");
  await verifierPropre(page);
}));
