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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, RACINE, TELEPHONE, attendrePortee, contexte, dossierTemporaire, importerLesExemples, lancer, nouvellePage, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";
import { installerFauxClaude } from "./faux-claude.mjs";
import { demarrerFauxStockage } from "../faux-cloud.mjs";
import { traiter } from "../../supabase/functions/portee-remarkable/mcp.js";
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
// D4 : la version de l'autre appareil
// ---------------------------------------------------------------------------

/** La fiche de la bibliothèque commune qui répond à `critere`, dès qu'elle y est. */
async function ficheCommune(commun, critere, { timeout = 20000 } = {}) {
  const fin = Date.now() + timeout;
  for (;;) {
    const f = (await commun.bibliotheque.changements()).partitions.find(critere);
    if (f) return f;
    if (Date.now() > fin) throw new Error("la fiche n'est jamais arrivée dans la bibliothèque commune");
    await new Promise((ok) => setTimeout(ok, 200));
  }
}

/** Ouvre une partition lue depuis le carnet (son titre commence par `titre`). */
async function ouvrirPartition(page, titre) {
  await page.click(`#liste .ligne-carnet button[aria-label^="Ouvrir « ${titre}"]`);
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
}

test("une page corrigée ici et sur un autre appareil : la version de l'autre est à côté, « À choisir » ; « Garder celle-ci » la met à la place, l'autre va à la corbeille (D4)", async () => {
  const commun = await bibliothequeCommune();
  try {
    const ctx = await commun.appareil(ORDINATEUR);
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    const fiche = await ficheCommune(commun, (f) => f.donnees && f.donnees.titre === "Essai melodie-standard");
    await page.waitForFunction(() => /^Synchronisé à [\d:]+$/.test(document.getElementById("mode").textContent), null, { timeout: 20000 });
    // Un autre appareil corrige la page.
    const abcLa = `${fiche.donnees.abc}% corrigée sur l'autre appareil\n`;
    const plusTard = new Date(Date.now() + 1000).toISOString();
    assert.equal((await commun.bibliotheque.ecrire({ id: fiche.id, donnees: { ...fiche.donnees, abc: abcLa }, pages: null, modifieLe: plusTard, base: fiche.modifieLe, baseRev: fiche.rev })).accepte, true);
    // Ici, la même page corrigée autrement : une note montée d'un degré.
    await ouvrirPartition(page, "Essai melodie");
    await page.click('#vues-atelier [data-vue="lue"]');
    const note = await page.locator("#gravure-atelier .abcjs-note").nth(2).boundingBox();
    await page.mouse.click(note.x + note.width / 2, note.y + note.height / 2);
    await page.waitForSelector("#outils-note:not([hidden])");
    await page.click('#outils-note [data-geste="haut"]');
    await page.click("#vue-atelier [data-retour]");
    // La synchronisation ne mélange pas les deux textes : celui de l'autre appareil est à côté, et ça se dit.
    assert.match(await messageQui(page, /corrigée ici et sur un autre appareil/), /dans ton carnet \(« À choisir »\)/);
    const copie = page.locator(".ligne-carnet", { has: page.locator('.ligne-titre:text-is("Essai melodie-standard (version de l\'autre appareil)")') });
    await copie.waitFor();
    assert.equal(await copie.locator(".pastille.p-conflit").textContent(), "À choisir");
    // Son « ••• » : trancher d'abord.
    await copie.locator(".plus").click();
    await page.waitForSelector("#feuille-actions[open]");
    assert.match(await page.textContent("#feuille-sous"), /La version de l'autre appareil de « Essai melodie-standard »/);
    const choix = await page.locator("#feuille-liste .btn").allTextContents();
    assert.deepEqual(choix.slice(0, 3), ["Garder celle-ci", "Garder les deux", "Garder l'autre"]);
    await page.click('#feuille-liste .btn:has-text("Garder celle-ci")');
    await page.waitForSelector("#dialogue[open]");
    assert.match(await page.textContent("#dialogue"), /qui part à la corbeille : tu pourras la récupérer pendant 30 jours/);
    await page.click('#dialogue button[value="oui"]');
    assert.match(await messageQui(page, /est gardée/), /cette version est gardée/);
    // Il n'en reste qu'une, sans marque, avec le texte de l'autre appareil ; l'autre est dans la corbeille commune.
    await page.waitForFunction(() => [...document.querySelectorAll("#liste .ligne-titre")].filter((t) => t.textContent.startsWith("Essai melodie")).length === 1);
    assert.equal(await page.locator("#liste .p-conflit").count(), 0);
    const debut = Date.now();
    while (!(await commun.bibliotheque.corbeille()).some((e) => e.id === fiche.id)) {
      assert.ok(Date.now() - debut < 20000, "l'autre version est allée à la corbeille de la bibliothèque commune");
      await new Promise((ok) => setTimeout(ok, 200));
    }
    await verifierPropre(page);
  } finally { await commun.fermer(); }
});

// ---------------------------------------------------------------------------
// D6 : les versions précédentes et la corbeille
// ---------------------------------------------------------------------------

/** Le nombre de notes de la mélodie d'une fiche de la bibliothèque commune. */
const notesCommunes = (f) => (f && f.donnees && f.donnees.sequence ? f.donnees.sequence.pistes[0].notes.length : -1);

test("les versions précédentes d'une idée : ce que chacune a changé, et « Récupérer cette version » ; la corbeille rend ce qu'on a supprimé (D6)", async () => {
  const commun = await bibliothequeCommune();
  try {
    const ctx = await commun.appareil(TELEPHONE);
    const page = await ouvrirPortee(ctx, serveur.url);
    await noterUneIdee(page);
    const premiere = await ficheCommune(commun, (f) => notesCommunes(f) === 3);
    // Une note de plus, depuis l'éditeur : la bibliothèque commune garde la version d'avant.
    await page.click("#liste .ligne-carnet .ligne-ouvrir");
    await page.waitForFunction(() => !document.getElementById("vue-idee").hidden && document.getElementById("idee-etat").textContent === "");
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => document.getElementById("idee-etat").textContent === "Enregistrée");
    await page.click("#vue-idee [data-retour]");
    await ficheCommune(commun, (f) => f.id === premiere.id && notesCommunes(f) === 4);
    // Le « ••• » de la ligne : « Versions précédentes ».
    await page.click("#liste .ligne-carnet .plus");
    await page.click('#feuille-liste .btn:has-text("Versions précédentes")');
    await page.waitForSelector("#feuille-versions[open]");
    await page.waitForFunction(() => document.querySelectorAll("#feuille-versions .version").length === 2, null, { timeout: 20000 });
    await page.waitForFunction(() => ![...document.querySelectorAll("#feuille-versions .version-resume")].some((r) => r.textContent === "…"));
    const lignes = await page.locator("#feuille-versions .version").allTextContents();
    assert.match(lignes[0], /^Maintenant\s*1 note de plus$/);
    assert.match(lignes[1], /La plus ancienne gardée\..*Récupérer cette version/);
    // Récupérer : une question, qui dit que la version d'aujourd'hui reste.
    await page.click("#feuille-versions .version >> nth=1 >> button");
    await page.waitForSelector("#dialogue[open]");
    assert.match(await page.textContent("#dialogue"), /Celle que tu as maintenant reste dans les versions précédentes/);
    await page.click('#dialogue button[value="oui"]');
    assert.match(await messageQui(page, /est revenue/), /la version du .* est revenue\./);
    await page.waitForSelector("#feuille-versions:not([open])", { state: "attached" });
    // Elle s'écrit comme une modification neuve : trois notes, ici et dans la bibliothèque commune.
    await page.waitForFunction(() => /3 notes/.test(document.querySelector("#liste .ligne-carnet .ligne-quand").textContent));
    await ficheCommune(commun, (f) => f.id === premiere.id && notesCommunes(f) === 3);
    assert.equal((await commun.bibliotheque.versions(premiere.id)).length, 3, "celle d'aujourd'hui est devenue une version précédente");

    // Depuis l'éditeur aussi, dans son « ••• ».
    await page.click("#liste .ligne-carnet .ligne-ouvrir");
    await page.waitForSelector("#vue-idee:not([hidden])");
    await page.click("#idee-plus");
    await page.click('#idee-menu [data-menu="versions"]');
    await page.waitForFunction(() => document.querySelectorAll("#feuille-versions[open] .version").length === 3, null, { timeout: 20000 });
    await page.keyboard.press("Escape");
    await page.waitForSelector("#feuille-versions:not([open])", { state: "attached" });
    await page.click("#vue-idee [data-retour]");

    // Supprimée, puis récupérée de la corbeille.
    await page.click("#liste .ligne-carnet .plus");
    await page.click('#feuille-liste .btn:has-text("Supprimer")');
    await page.click('#dialogue button[value="oui"]');
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 0);
    await ficheCommune(commun, (f) => f.id === premiere.id && f.supprime);
    await page.click("#tab-reglages");
    await page.click("#ouvrir-corbeille");
    await page.waitForSelector("#feuille-corbeille[open] .version");
    assert.match(await page.textContent("#feuille-corbeille .version"), /Idée · supprimée le \d+ .* · encore 30 jours/);
    await page.click('#feuille-corbeille .version button[aria-label^="Récupérer « Idée du"]');
    assert.match(await messageQui(page, /dans ta bibliothèque/), /est revenue dans ta bibliothèque\./);
    assert.match(await page.textContent("#feuille-corbeille .versions-liste"), /La corbeille est vide\./);
    await page.keyboard.press("Escape");
    await page.click("#tab-carnet");
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 1);
    await ficheCommune(commun, (f) => f.id === premiere.id && !f.supprime);
    await verifierPropre(page);
  } finally { await commun.fermer(); }
});

test("sans connecteur, ni corbeille ni versions précédentes : caché, pas grisé (D6)", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await noterUneIdee(page);
    await page.click("#liste .ligne-carnet .plus");
    await page.waitForSelector("#feuille-actions[open]");
    assert.equal(await page.locator('#feuille-liste .btn:has-text("Versions précédentes")').count(), 0);
    await page.keyboard.press("Escape");
    await page.click("#liste .ligne-carnet .ligne-ouvrir");
    await page.waitForSelector("#vue-idee:not([hidden])");
    await page.click("#idee-plus");
    await page.waitForSelector("#idee-menu[open]");
    assert.equal(await page.isVisible('#idee-menu [data-menu="versions"]'), false);
    await page.keyboard.press("Escape");
    await page.click("#vue-idee [data-retour]");
    await page.click("#tab-reglages");
    assert.equal(await page.isVisible("#ouvrir-corbeille"), false);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// H3 et C5 : les suggestions que Claude range depuis une conversation
// ---------------------------------------------------------------------------

/** Une fiche de la base de la page (IndexedDB « portee »), telle qu'elle est rangée. */
const ficheIci = (page, id) => page.evaluate((i) => new Promise((ok) => {
  const r = indexedDB.open("portee");
  r.onsuccess = () => {
    const q = r.result.transaction("partitions").objectStore("partitions").get(i);
    q.onsuccess = () => { ok(q.result || null); r.result.close(); };
  };
}), id);

/** Attend que la fiche `id` de la page réponde à `critere` (une fonction, en texte). */
async function attendreIci(page, id, critere, { timeout = 15000 } = {}) {
  const fin = Date.now() + timeout;
  for (;;) {
    const f = await ficheIci(page, id);
    if (f && critere(f)) return f;
    if (Date.now() > fin) throw new Error(`la fiche ${id} n'a jamais pris l'état attendu : ${JSON.stringify(f && f.sequence ? f.sequence.accords : f)}`);
    await new Promise((ok) => setTimeout(ok, 150));
  }
}

test("une idée notée par Claude, et ses suggestions : marquées dans le carnet, montrées dans l'idée ; écouter, appliquer (puis annuler), ignorer ; une suggestion qui ne va plus se dit et part (H3, C5)", async () => {
  const commun = await bibliothequeCommune();
  try {
    const outils = { bibliotheque: commun.bibliotheque, suggestions: commun.suggestions };
    // Dans une conversation, Claude note une idée, puis range deux propositions pour elle.
    const { appelerConversation } = await import("../../supabase/functions/portee-remarkable/conversation.js");
    const idee = await appelerConversation("idee_ecrire", { titre: "Pluie", tonalite: "Am", notes: [{ debut: 0, duree: 4, hauteur: 69 }, { debut: 4, duree: 4, hauteur: 72 }, { debut: 8, duree: 8, hauteur: 76 }, { debut: 16, duree: 16, hauteur: 74 }] }, outils);
    await appelerConversation("suggestion_ecrire", { cible: idee.id, genre: "accords", contenu: { accords: [{ debut: 0, nom: "Am" }, { debut: 16, nom: "F" }] }, pourquoi: "La mélodie descend vers le fa." }, outils);
    await new Promise((ok) => setTimeout(ok, 5)); // les suggestions se trient à la milliseconde
    await appelerConversation("suggestion_ecrire", { cible: idee.id, genre: "texte", contenu: { titre: "Pluie d'automne" }, pourquoi: "Elle descend comme la pluie." }, outils);
    const ctx = await commun.appareil(TELEPHONE);
    const page = await ouvrirPortee(ctx, serveur.url);
    // Le carnet : « Claude » (elle l'a notée), et ce qu'il propose.
    const ligne = page.locator(".ligne-carnet", { has: page.locator('.ligne-titre:text-is("Pluie")') });
    await ligne.waitFor({ timeout: 20000 });
    assert.equal(await ligne.locator(".pastille.p-claude").textContent(), "Claude");
    await page.waitForFunction(() => /Claude propose 2 choses/.test(document.querySelector("#liste .ligne-carnet .ligne-aide")?.textContent || ""), null, { timeout: 20000 });
    // L'idée : le bandeau, la plus récente d'abord.
    await ligne.locator(".ligne-ouvrir").click();
    await page.waitForSelector("#idee-suggestions:not([hidden])");
    assert.match(await page.textContent("#idee-suggestions .bandeau-texte"), /^Claude propose un titre : « Pluie d'automne »$/);
    assert.equal(await page.textContent("#idee-suggestions .bandeau-compte"), "1 sur 2");
    // Ignorer : elle part du connecteur, la suivante vient.
    await page.click('#idee-suggestions button[aria-label="Ignorer"]');
    await page.waitForFunction(() => /2 accords/.test(document.querySelector("#idee-suggestions .bandeau-texte")?.textContent || ""));
    assert.deepEqual((await commun.suggestions.lister(idee.id)).map((s) => s.genre), ["accords"]);
    // Pourquoi : il se déplie d'un toucher.
    assert.equal(await page.isVisible("#idee-suggestions .bandeau-pourquoi"), false);
    await page.click("#idee-suggestions .bandeau-quoi");
    assert.equal(await page.getAttribute("#idee-suggestions .bandeau-quoi", "aria-expanded"), "true");
    assert.equal(await page.textContent("#idee-suggestions .bandeau-pourquoi"), "Pourquoi : La mélodie descend vers le fa.");
    // Écouter : l'idée avec les accords, sans rien écrire.
    await page.click('#idee-suggestions button[aria-label="Écouter"]');
    await page.waitForSelector('#idee-suggestions button[aria-label="Arrêter"]');
    await page.click('#idee-suggestions button[aria-label="Arrêter"]');
    await page.waitForSelector('#idee-suggestions button[aria-label="Écouter"]');
    assert.deepEqual((await ficheIci(page, idee.id)).sequence.accords, []);
    // Appliquer : un seul geste ; la suggestion part ; « Annuler » le défait.
    await page.click('#idee-suggestions button[aria-label="Appliquer"]');
    await page.waitForSelector("#idee-suggestions", { state: "hidden" });
    const avecAccords = await attendreIci(page, idee.id, (f) => f.sequence.accords.length === 2);
    assert.deepEqual(avecAccords.sequence.accords.map((a) => [a.d, a.nom]), [[0, "Am"], [16, "F"]]);
    assert.deepEqual(await commun.suggestions.lister(idee.id), []);
    await page.click("#toast-annuler-suggestion button");
    await attendreIci(page, idee.id, (f) => f.sequence.accords.length === 0);
    // L'« Annuler » de l'éditeur, lui, défait le geste qui a défait : les accords reviennent, en un pas.
    await page.click("#idee-annuler");
    await attendreIci(page, idee.id, (f) => f.sequence.accords.length === 2);
    await page.click("#vue-idee [data-retour]");
    await page.waitForFunction(() => !/Claude propose/.test(document.querySelector("#liste .ligne-carnet .ligne-aide")?.textContent || ""));

    // Une suggestion qui ne va plus (des accords bien après la fin) : elle se dit, et part sans rien changer.
    await commun.suggestions.ecrire({ cible: idee.id, genre: "accords", contenu: { accords: [{ debut: 9000, nom: "C" }] }, pourquoi: "Trop loin." });
    await ligne.locator(".ligne-ouvrir").click();
    assert.match(await messageQui(page, /ne peut pas s'appliquer/), /^Cette suggestion ne peut pas s'appliquer \(accords\[0\] : hors de la partition\) : elle est retirée\.$/);
    assert.equal(await page.isVisible("#idee-suggestions"), false);
    assert.deepEqual(await commun.suggestions.lister(idee.id), []);
    // Ce qui vient de Claude s'écrit en texte, jamais en HTML (S1).
    await page.click("#vue-idee [data-retour]");
    await commun.suggestions.ecrire({ cible: idee.id, genre: "texte", contenu: { titre: '<img src=x onerror="window.__pirate=1">' }, pourquoi: '<b onmouseover="window.__pirate=2">gras</b>' });
    await ligne.locator(".ligne-ouvrir").click();
    await page.waitForSelector("#idee-suggestions:not([hidden])");
    await page.click("#idee-suggestions .bandeau-quoi");
    assert.equal(await page.textContent("#idee-suggestions .bandeau-texte"), 'Claude propose un titre : « <img src=x onerror="window.__pirate=1"> »');
    assert.equal(await page.textContent("#idee-suggestions .bandeau-pourquoi"), 'Pourquoi : <b onmouseover="window.__pirate=2">gras</b>');
    assert.equal(await page.locator("#idee-suggestions img, #idee-suggestions b").count(), 0);
    await page.hover("#idee-suggestions .bandeau-pourquoi");
    assert.equal(await page.evaluate(() => window.__pirate), undefined);
    await page.click('#idee-suggestions button[aria-label="Ignorer"]');
    await page.waitForSelector("#idee-suggestions", { state: "hidden" });
    await verifierPropre(page);
  } finally { await commun.fermer(); }
});

test("« Corriger » : Claude répond à un doute ; appliquée, sa réponse devient son avis sur le doute, qui reste ouvert (H3)", async () => {
  const commun = await bibliothequeCommune();
  try {
    const ctx = await commun.appareil(ORDINATEUR);
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    const fiche = await ficheCommune(commun, (f) => f.donnees && f.donnees.titre === "Essai melodie-standard");
    const rang = fiche.donnees.doutes.findIndex((d) => !d.leve);
    const { appelerConversation } = await import("../../supabase/functions/portee-remarkable/conversation.js");
    await appelerConversation("suggestion_ecrire", { cible: fiche.id, genre: "texte", contenu: { doute: rang, note: "C'est sans doute une croche : la mesure tombe juste." }, pourquoi: "Avec une croche, la mesure fait ses huit croches." }, { bibliotheque: commun.bibliotheque, suggestions: commun.suggestions });
    await ouvrirPartition(page, "Essai melodie");
    await page.waitForSelector("#atelier-suggestions:not([hidden])");
    assert.equal(await page.textContent("#atelier-suggestions .bandeau-texte"), `Claude répond au doute n° ${rang + 1}`);
    // Pas de musique à écouter : seulement Appliquer et Ignorer.
    assert.equal(await page.locator('#atelier-suggestions button[aria-label="Écouter"]').count(), 0);
    await page.click('#atelier-suggestions button[aria-label="Appliquer"]');
    await page.waitForSelector("#atelier-suggestions", { state: "hidden" });
    const relue = await attendreIci(page, fiche.id, (f) => !!(f.doutes[rang] && f.doutes[rang].avis));
    assert.deepEqual(relue.doutes[rang].avis, { auteur: "claude", texte: "C'est sans doute une croche : la mesure tombe juste." });
    assert.equal(relue.doutes[rang].leve, false, "le doute reste à régler d'un toucher");
    assert.equal(relue.abc, fiche.donnees.abc, "l'ABC n'a pas bougé");
    assert.deepEqual(await commun.suggestions.lister(fiche.id), []);
    await verifierPropre(page);
  } finally { await commun.fermer(); }
});

test("claude.ai : les suggestions passent par la capacité mcp ; l'idée de la base de la page les montre et les applique (H3)", async () => {
  const dossier = dossierTemporaire("claude-donnees");
  const sortie = path.join(dossier, "claude");
  execFileSync(process.execPath, [path.join(RACINE, "outils/assembler-appli.mjs"), "--sortie", sortie], { stdio: "pipe" });
  // claude.ai met la page dans un document à lui.
  const habiller = (fragment) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${fragment}</body></html>`;
  const site = await servir({ dossier: sortie, habiller });
  const stockage = await demarrerFauxStockage();
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const objets = objetsSupabase(stockage.url, stockage.cle);
    const bibliotheque = new Bibliotheque(objets), suggestions = new Suggestions(objets);
    const { appelerConversation } = await import("../../supabase/functions/portee-remarkable/conversation.js");
    const idee = await appelerConversation("idee_ecrire", { titre: "Pluie", notes: [{ debut: 0, duree: 4, hauteur: 69 }, { debut: 4, duree: 12, hauteur: 72 }] }, { bibliotheque });
    await appelerConversation("suggestion_ecrire", { cible: idee.id, genre: "accords", contenu: { accords: [{ debut: 0, nom: "Am" }] }, pourquoi: "En la mineur." }, { bibliotheque, suggestions });
    // Le manifeste après la republication : les outils de la tablette, et ceux des suggestions.
    const manifeste = ["arborescence", "document", "relier", "suggestions_lister", "suggestion_retirer"];
    const appels = [];
    const claude = await installerFauxClaude(ctx, {
      async appelerOutil(serveurMcp, outil, args) {
        if (serveurMcp !== "Portée reMarkable" || !manifeste.includes(outil)) return { erreur: { code: "not_in_manifest", message: outil } };
        appels.push(outil);
        const r = await traiter({ jsonrpc: "2.0", id: appels.length, method: "tools/call", params: { name: outil, arguments: args } }, null, bibliotheque, { suggestions });
        if (r.error) return { erreur: { code: "tool_error", message: r.error.message } };
        if (r.result.isError) return { erreur: { code: "tool_error", message: "tool_error", result: r.result } };
        return { payload: r.result.structuredContent };
      },
    });
    // La même idée dans la base de la page (une sauvegarde du site restaurée ici : les identifiants suivent).
    const fiche = (await bibliotheque.changements()).partitions.find((f) => f.id === idee.id).donnees;
    claude.base.set(`partitions/${idee.id}`, fiche);
    const page = await nouvellePage(ctx);
    await page.goto(site.url);
    await attendrePortee(page);
    // Sur claude.ai, rien ne part sans un geste : le carnet ne demande rien au connecteur.
    await page.waitForSelector("#liste .ligne-carnet");
    assert.deepEqual(appels, []);
    await page.click("#liste .ligne-carnet .ligne-ouvrir");
    await page.waitForSelector("#idee-suggestions:not([hidden])");
    assert.equal(await page.textContent("#idee-suggestions .bandeau-texte"), "Claude propose 1 accord");
    await page.click('#idee-suggestions button[aria-label="Appliquer"]');
    await page.waitForSelector("#idee-suggestions", { state: "hidden" });
    const fin = Date.now() + 10000;
    while (!((claude.base.get(`partitions/${idee.id}`).sequence.accords || []).length)) {
      assert.ok(Date.now() < fin, "les accords sont dans la base de la page");
      await new Promise((ok) => setTimeout(ok, 100));
    }
    assert.deepEqual(claude.base.get(`partitions/${idee.id}`).sequence.accords.map((a) => a.nom), ["Am"]);
    assert.deepEqual(appels, ["suggestions_lister", "suggestion_retirer"]);
    assert.deepEqual(await suggestions.lister(idee.id), []);
    await verifierPropre(page);
  } finally {
    await ctx.close();
    await site.fermer();
    await stockage.fermer();
    fs.rmSync(dossier, { recursive: true, force: true });
  }
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
