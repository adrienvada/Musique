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
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, RACINE, attendreQue, contexte, importerLesExemples, lancer, octetsDu, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";
import { demarrerFauxStockage } from "../faux-cloud.mjs";
import { Bibliotheque } from "../../supabase/functions/portee-remarkable/bibliotheque.js";
import { coffreMemoire } from "../../supabase/functions/portee-remarkable/coffre.js";
import { repondreHttp } from "../../supabase/functions/portee-remarkable/http.js";
import { objetsSupabase } from "../../supabase/functions/portee-remarkable/objets.js";
import { CloudRemarkable } from "../../supabase/functions/portee-remarkable/remarkable.js";

/**
 * Un appareil relié à une bibliothèque commune : le vrai connecteur (http.js)
 * sur le faux stockage des tests, à une adresse de la forme exacte que
 * l'appli attend, assemblée ici (rien qui ressemble à un vrai secret dans le
 * dépôt). L'adresse est collée d'avance : la synchronisation part au démarrage.
 */
async function appareilSynchronise(appareil = ORDINATEUR) {
  const stockage = await demarrerFauxStockage();
  const projet = ["essai", "ecrans"].join("").padEnd(20, "x");
  const cle = ["cle", "d", "essai", "ecrans"].join("-").padEnd(32, "0");
  const adresse = `https://${projet}.supabase.co/functions/v1/portee-remarkable/${cle}`;
  const bibliotheque = new Bibliotheque(objetsSupabase(stockage.url, stockage.cle));
  const tablette = new CloudRemarkable(coffreMemoire(null), { auth: "http://127.0.0.1:9", sync: "http://127.0.0.1:9" });
  const ctx = await contexte(navigateur, {
    appareil,
    routes: [[(u) => u.hostname === `${projet}.supabase.co`, async (route) => {
      const r = route.request();
      const reponse = await repondreHttp(new Request(r.url(), { method: r.method(), headers: await r.allHeaders(), body: r.postData() ?? undefined }), {
        cle, cloud: () => tablette, bibliotheque: () => bibliotheque, origines: [serveur.origine],
      });
      await route.fulfill({ status: reponse.status, headers: Object.fromEntries(reponse.headers), body: Buffer.from(await reponse.arrayBuffer()) });
    }]],
  });
  await ctx.addInitScript((a) => { try { localStorage.setItem("portee:connecteur", a); } catch { /* sans stockage */ } }, adresse);
  return { ctx, bibliotheque, fermer: async () => { await ctx.close(); await stockage.fermer(); } };
}

/** Les messages passagers, notés au fil de l'eau (un message peut en remplacer un autre avant qu'on le lise). */
const noterLesMessages = (page) => page.evaluate(() => {
  window.__messages = [];
  const t = document.getElementById("toast");
  new MutationObserver(() => { if (t.textContent) window.__messages.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true });
});
const messages = (page) => page.evaluate(() => window.__messages);
const synchroniserMaintenant = (page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
/** La partition `id` est dans la base de la page (la synchro l'a reçue). */
const recue = (page, id) => attendreQue(page, (i) => new Promise((ok) => {
  const r = indexedDB.open("portee");
  r.onsuccess = () => { const q = r.result.transaction("partitions").objectStore("partitions").get(i); q.onsuccess = () => { ok(!!q.result); r.result.close(); }; };
  r.onerror = () => ok(false);
}), id);

const MELODIE = path.join(RACINE, "tests/pages/2026-09-30-melodie-standard.pdf");

/** Le message passager, dès qu'il correspond à `motif`. */
async function messageQui(page, motif) {
  await page.waitForFunction((m) => new RegExp(m).test(document.getElementById("toast").textContent), motif.source, { timeout: 20000 });
  return page.textContent("#toast");
}

/** Les exceptions de la page (les erreurs gardées dans la console, elles, sont voulues ici). */
const exceptions = (page) => page.erreurs.filter((e) => e.startsWith("[exception]"));

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

test("un PDF illisible, puis pdf.js qui ne vient pas : le message dit quoi faire, en français ; le réseau revenu, l'import remarche sans recharger (T4, I13)", async () => {
  // Sans service worker : sa copie de pdf.js passerait par-dessus la panne.
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR, serviceWorkers: "block" });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    // Un fichier qui n'a de PDF que le nom.
    await page.setInputFiles("#fichier", { name: "pas-un-pdf.pdf", mimeType: "application/pdf", buffer: Buffer.from("ceci n'est pas un PDF") });
    const illisible = await messageQui(page, /^Impossible de lire « pas-un-pdf\.pdf »/);
    assert.doesNotMatch(illisible, /Invalid|structure/i, illisible);
    assert.match(illisible, /pas un PDF lisible.*Exporte la page à nouveau/, illisible);
    // pdf.js ne vient pas (le réseau a manqué) ; c'est la première fois qu'on le demande.
    const ctx2 = await contexte(navigateur, { appareil: ORDINATEUR, serviceWorkers: "block" });
    try {
      const page2 = await ouvrirPortee(ctx2, serveur.url);
      serveur.etat.pannes.set("vendor/pdfjs/pdf.min.mjs", 503);
      await page2.setInputFiles("#fichier", MELODIE);
      const panne = await messageQui(page2, /^Impossible de lire « 2026-09-30-melodie-standard\.pdf »/);
      assert.doesNotMatch(panne, /Failed|fetch|dynamically/i, panne);
      assert.match(panne, /Portée n'a pas pu se charger.*réseau/, panne);
      // Le réseau revient : le même import marche, sans recharger la page.
      serveur.etat.pannes.delete("vendor/pdfjs/pdf.min.mjs");
      await page2.setInputFiles("#fichier", MELODIE);
      await page2.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached", timeout: 20000 });
      assert.deepEqual(exceptions(page2), []);
    } finally { await ctx2.close(); }
    assert.deepEqual(exceptions(page), []);
  } finally {
    serveur.etat.pannes.clear();
    await ctx.close();
  }
});

test("une idée ouverte ne se dit « modifiée sur un autre appareil » que si elle l'a été (T4)", async () => {
  const { ctx, bibliotheque, fermer } = await appareilSynchronise();
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.waitForFunction(() => /Synchronisé/.test(document.getElementById("mode").textContent), null, { timeout: 20000 });
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
    for (const k of ["KeyA", "KeyS", "KeyD"]) await page.keyboard.press(k);
    await page.waitForFunction(() => document.getElementById("idee-etat").textContent === "Enregistrée");
    // L'idée rejoint la bibliothèque commune.
    const debut = Date.now();
    let fiche = null;
    while (!fiche && Date.now() - debut < 15000) {
      fiche = (await bibliotheque.changements()).partitions.find((f) => f.donnees?.type === "idee") || null;
      if (!fiche) await new Promise((ok) => setTimeout(ok, 200));
    }
    assert.ok(fiche, "l'idée est partie");
    await noterLesMessages(page);
    // Un autre appareil ajoute une partition qui n'a rien à voir.
    const maintenant = new Date().toISOString();
    const autre = { type: "idee", titre: "Autre chose", statut: "idee", nbPages: 0, modele: null, tempo: 90, sequence: { version: 1, tempo: 90, mesure: [4, 4], tonalite: "C", accompagnement: "aucun", suivant: 2, accords: [], pistes: [{ nom: "Mélodie", cle: "sol", notes: [{ id: 1, d: 0, l: 4, h: 72 }] }] }, creeLe: maintenant };
    assert.equal((await bibliotheque.ecrire({ id: "pautre", donnees: autre, pages: [], modifieLe: maintenant })).accepte, true);
    await synchroniserMaintenant(page);
    await recue(page, "pautre");
    await page.waitForTimeout(400); // rafraichirOuverte a eu le temps de passer
    assert.deepEqual((await messages(page)).filter((m) => /autre appareil/.test(m)), [], "rien n'a changé pour l'idée ouverte");
    assert.equal(await page.locator("#idee-grille .g-note:not(.autre)").count(), 3);
    // Cette fois, l'idée ouverte elle-même change ailleurs : elle se reprend, et le dit.
    const plusTard = new Date(Date.now() + 1000).toISOString();
    const seq = structuredClone(fiche.donnees.sequence);
    seq.pistes[0].notes.push({ id: 99, d: 12, l: 4, h: 77 });
    assert.equal((await bibliotheque.ecrire({ id: fiche.id, donnees: { ...fiche.donnees, sequence: seq }, pages: [], modifieLe: plusTard })).accepte, true);
    await synchroniserMaintenant(page);
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 4, null, { timeout: 15000 });
    assert.equal((await messages(page)).filter((m) => /modifiée sur un autre appareil/.test(m)).length, 1);
    await verifierPropre(page);
  } finally { await fermer(); }
});

test("quatre notes, puis un rechargement tout de suite : l'idée est là (T4)", async (t) => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
    for (const k of ["KeyA", "KeyS", "KeyD", "KeyF"]) await page.keyboard.press(k);
    // Bien avant les 0,7 s du premier enregistrement : sinon, cette machine est trop lente pour l'essai.
    if ((await page.textContent("#idee-etat")) !== "Enregistrement…") { t.skip("le premier enregistrement est déjà passé"); return; }
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 1, null, { timeout: 10000 })
      .catch(() => assert.fail("l'idée a été perdue au rechargement"));
    await page.click("#liste .ligne-carnet .ligne-ouvrir");
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 4);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
