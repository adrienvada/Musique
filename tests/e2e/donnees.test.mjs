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
import { demarrerFauxStockage } from "../faux-cloud.mjs";
import { Bibliotheque } from "../../supabase/functions/portee-remarkable/bibliotheque.js";
import { coffreMemoire } from "../../supabase/functions/portee-remarkable/coffre.js";
import { repondreHttp } from "../../supabase/functions/portee-remarkable/http.js";
import { objetsSupabase } from "../../supabase/functions/portee-remarkable/objets.js";
import { CloudRemarkable } from "../../supabase/functions/portee-remarkable/remarkable.js";
import { Suggestions } from "../../supabase/functions/portee-remarkable/suggestions.js";

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

/**
 * Une bibliothèque commune : le vrai connecteur (http.js), suggestions
 * comprises, sur le faux stockage des tests, à une adresse de la forme
 * exacte que l'appli attend, assemblée ici (rien qui ressemble à un vrai
 * secret dans le dépôt). `appareil()` : un navigateur neuf qui y est relié
 * (l'adresse collée d'avance : la synchronisation part au démarrage).
 */
async function bibliothequeCommune() {
  const stockage = await demarrerFauxStockage();
  const projet = ["essai", "donnees"].join("").padEnd(20, "x");
  const cle = ["cle", "d", "essai", "donnees"].join("-").padEnd(32, "0");
  const adresse = `https://${projet}.supabase.co/functions/v1/portee-remarkable/${cle}`;
  const objets = objetsSupabase(stockage.url, stockage.cle);
  const bibliotheque = new Bibliotheque(objets);
  const suggestions = new Suggestions(objets);
  const tablette = new CloudRemarkable(coffreMemoire(null), { auth: "http://127.0.0.1:9", sync: "http://127.0.0.1:9" });
  const appels = [];
  const contextes = [];
  async function appareil(appareil = ORDINATEUR) {
    const ctx = await contexte(navigateur, {
      appareil,
      routes: [[(u) => u.hostname === `${projet}.supabase.co`, async (route) => {
        const r = route.request();
        const corps = r.postData();
        try { appels.push(JSON.parse(corps).params.name); } catch { /* préflight */ }
        const reponse = await repondreHttp(new Request(r.url(), { method: r.method(), headers: await r.allHeaders(), body: corps ?? undefined }), {
          cle, cloud: () => tablette, bibliotheque: () => bibliotheque, suggestions: () => suggestions, origines: [serveur.origine],
        });
        await route.fulfill({ status: reponse.status, headers: Object.fromEntries(reponse.headers), body: Buffer.from(await reponse.arrayBuffer()) });
      }]],
    });
    await ctx.addInitScript((a) => { try { localStorage.setItem("portee:connecteur", a); } catch { /* sans stockage */ } }, adresse);
    contextes.push(ctx);
    return ctx;
  }
  return {
    objets, bibliotheque, suggestions, appareil, appels,
    fermer: async () => { for (const c of contextes) await c.close(); await stockage.fermer(); },
  };
}

/** Une idée telle que le connecteur la range (la forme de `idee_ecrire`). */
const ideeCommune = (titre, notes = [{ id: 1, d: 0, l: 4, h: 72 }], extra = {}) => {
  const maintenant = new Date().toISOString();
  return {
    type: "idee", titre, statut: "idee", nbPages: 0, modele: null, tempo: 90, note: "", etiquettes: [], favori: false, memo: null,
    sequence: { version: 1, tempo: 90, mesure: [4, 4], tonalite: "C", accompagnement: "aucun", suivant: 50, accords: [], pistes: [{ nom: "Mélodie", cle: "sol", notes }] },
    creeLe: maintenant, modifieLe: maintenant, ...extra,
  };
};

/** Une passe de synchronisation tout de suite (comme au retour sur l'onglet). */
const synchroniserMaintenant = (page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

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
// D2 : ce que la synchronisation met de côté
// ---------------------------------------------------------------------------

test("ce que la synchronisation met de côté se voit, avec sa raison, en haut et dans les Réglages ; « Réessayer » relance (D2)", async () => {
  const commun = await bibliothequeCommune();
  try {
    // Une fiche abîmée dans la bibliothèque commune : elle ne peut pas se ranger ici.
    await commun.objets.ecrire("bibliotheque/pabimee.json", { id: "pabimee", donnees: "pas une fiche", modifieLe: new Date().toISOString(), supprime: false, pagesLe: null, rev: 1 });
    const ctx = await commun.appareil(TELEPHONE);
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.waitForFunction(() => /1 mise de côté/.test(document.getElementById("mode").textContent), null, { timeout: 20000 });
    assert.equal(await page.getAttribute("#etat-synchro", "data-ton"), "alerte");
    assert.match(await page.getAttribute("#etat-synchro", "aria-label"), /1 mise de côté/);
    await page.click("#etat-synchro");
    await page.waitForSelector("#synchro-de-cote:not([hidden])");
    assert.match(await page.textContent("#de-cote-resume"), /1 partition mise de côté : elle ne passe pas, les autres si\./);
    assert.match(await page.textContent("#de-cote-liste"), /Une partition d'un autre appareil\s*Pas rangée ici : fiche illisible/);
    // Une partition d'ici, datée de 2031 (une horloge déréglée) : la bibliothèque commune la refuse, et dit pourquoi.
    await page.evaluate(() => new Promise((ok) => {
      const r = indexedDB.open("portee");
      r.onsuccess = () => {
        const t = r.result.transaction(["partitions", "envois"], "readwrite");
        const quand = "2031-01-01T00:00:00.000Z";
        t.objectStore("partitions").put({ type: "idee", titre: "Venue du futur", statut: "idee", nbPages: 0, modele: null, abc: "", note: "", etiquettes: [], favori: false, memo: null, sequence: { version: 1, tempo: 90, mesure: [4, 4], tonalite: "C", accompagnement: "aucun", suivant: 2, accords: [], pistes: [{ nom: "Mélodie", notes: [{ id: 1, d: 0, l: 4, h: 72 }] }] }, creeLe: quand, modifieLe: quand }, "pfutur");
        t.objectStore("envois").put({ numero: "essai-1", modifieLe: quand, pages: false, supprime: false }, "pfutur");
        t.oncomplete = () => { r.result.close(); ok(); };
      };
    }));
    await synchroniserMaintenant(page);
    await page.waitForFunction(() => /2 partitions mises de côté/.test(document.getElementById("de-cote-resume").textContent), null, { timeout: 20000 });
    assert.match(await page.textContent("#de-cote-liste"), /« Venue du futur »\s*Refusée par la bibliothèque commune : la date de modification est à plus d'un jour dans le futur : l'horloge de cet appareil est sans doute déréglée\./);
    // Réparée là-bas, la fiche abîmée arrive à « Réessayer » ; celle du futur reste de côté, et le dit.
    assert.equal((await commun.bibliotheque.ecrire({ id: "pabimee", donnees: ideeCommune("Réparée"), pages: [], modifieLe: new Date().toISOString() })).accepte, true);
    await page.click("#reessayer-synchro");
    assert.equal(await messageQui(page, /de côté|passé/), "1 partition reste de côté : la raison est dans la liste.");
    await page.waitForFunction(() => /1 partition mise de côté/.test(document.getElementById("de-cote-resume").textContent));
    assert.doesNotMatch(await page.textContent("#de-cote-liste"), /autre appareil/);
    await page.click("#tab-carnet");
    await page.waitForSelector('#liste .ligne-titre:text-is("Réparée")');
    await verifierPropre(page);
  } finally { await commun.fermer(); }
});

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
