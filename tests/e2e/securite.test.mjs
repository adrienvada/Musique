/**
 * SÉCURITÉ, SUR LE SITE ASSEMBLÉ
 *
 * Une sauvegarde piégée (S1) : du HTML dans tous les champs où l'audit a
 * fait exécuter du code (le titre, les étiquettes, le nom d'une piste, la
 * durée du mémo, le nom d'un accord, l'identifiant d'une note). Rien ne doit
 * s'exécuter, et rien ne doit même arriver jusqu'à la CSP : une violation
 * voudrait dire qu'un texte est entré dans la page sans être échappé, et
 * que seule la seconde porte (la CSP) a tenu.
 *
 * Le connecteur, appelé par le site : son adresse collée, la tablette
 * reliée, une page importée, la bibliothèque synchronisée, sous la CSP du
 * site (connect-src https://*.supabase.co). Le connecteur est le vrai code
 * (repondreHttp), branché sur le faux cloud reMarkable et le faux stockage
 * des tests : rien ne sort de la machine.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, RACINE, TELEPHONE, contexte, dossierTemporaire, lancer, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";
import { demarrerFauxCloud, demarrerFauxStockage } from "../faux-cloud.mjs";
import { lireFichier } from "../../outils/lire.mjs";
import { Bibliotheque } from "../../supabase/functions/portee-remarkable/bibliotheque.js";
import { coffreMemoire } from "../../supabase/functions/portee-remarkable/coffre.js";
import { repondreHttp } from "../../supabase/functions/portee-remarkable/http.js";
import { objetsSupabase } from "../../supabase/functions/portee-remarkable/objets.js";
import { CloudRemarkable } from "../../supabase/functions/portee-remarkable/remarkable.js";

let serveur, navigateur, dossier;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  navigateur = await lancer();
  dossier = dossierTemporaire("securite");
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

/** Une charge qui, si elle s'exécutait, le noterait dans window.__xss. */
const charge = (champ) => `<img src=x onerror="(window.__xss=window.__xss||[]).push('${champ}')">${champ}`;

function sauvegardePiegee() {
  const date = "2026-10-04T10:00:00.000Z";
  const idee = (id, donnees) => ({ id, pages: [], donnees: { type: "idee", abc: "X:1\nK:C\nC|", statut: "idee", nbPages: 0, modele: null, tempo: 100, note: "", favori: false, creeLe: date, modifieLe: date, ...donnees } });
  const sequence = (pistes, accords = []) => ({ version: 1, tempo: 100, mesure: [4, 4], tonalite: "C", accompagnement: "aucun", suivant: 9, accords, pistes });
  return {
    format: "portee-sauvegarde", version: 1, creeLe: date,
    partitions: [
      // Des textes libres : ils doivent arriver tels quels, échappés.
      idee("ppiegee", {
        titre: charge("titre"),
        etiquettes: [charge("etiquette")],
        sequence: sequence([{ nom: "Mélodie", notes: [{ id: 1, d: 0, l: 4, h: 60 }, { id: 2, d: 4, l: 4, h: 64 }] }, { nom: charge("piste"), notes: [{ id: 3, d: 0, l: 8, h: 48 }] }], [{ d: 0, nom: charge("accord") }]),
      }),
      // Des champs qui ne devraient contenir qu'un nombre : la durée du mémo, l'identifiant d'une note.
      idee("pformes", {
        titre: "Idée aux champs bizarres",
        etiquettes: [],
        memo: { duree: charge("memo"), type: "audio/mp4" },
        sequence: sequence([{ nom: "Mélodie", notes: [{ id: `1"><img src=q onerror="(window.__xss=window.__xss||[]).push('note')">`, d: 0, l: 8, h: 60 }] }]),
      }),
    ],
  };
}

test("une sauvegarde piégée ne fait rien exécuter (S1), et rien n'atteint la CSP", async () => {
  const fichier = path.join(dossier, "piegee.json");
  fs.writeFileSync(fichier, JSON.stringify(sauvegardePiegee()));
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#tab-reglages");
    await page.setInputFiles("#restaurer", fichier);
    await page.waitForSelector("#toast:not([hidden])");
    await page.click("#tab-carnet");
    // Le carnet montre ce qui a été restauré (titres, étiquettes, mémo).
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length > 0);
    // Chaque idée ouverte : la grille (accords sur la règle, notes), la puce des pistes, la partition, le carnet de l'idée.
    for (let i = 0; i < await page.locator("#liste .ligne-carnet").count(); i++) {
      await page.locator("#liste .ligne-carnet .ligne-ouvrir").nth(i).click();
      await page.waitForSelector("#vue-idee:not([hidden]) #idee-grille .g-note", { state: "attached" });
      await page.click('#idee-affichage [data-affichage="partition"]');
      await page.waitForSelector("#idee-gravure svg", { state: "attached" });
      await page.click('#idee-affichage [data-affichage="grille"]');
      await page.click("#idee-plus");
      await page.click('#idee-menu [data-menu="infos"]');
      await page.waitForSelector("#idee-infos[open]");
      await page.keyboard.press("Escape");
      await page.click("#vue-idee [data-retour]");
      await page.waitForSelector("#vue-biblio:not([hidden])");
    }
    assert.equal(await page.evaluate(() => window.__xss), undefined, "du code a été exécuté");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("le connecteur, appelé par le site sous sa CSP : relier la tablette, importer une page, synchroniser", async () => {
  const pdf = await lireFichier(path.join(RACINE, "tests/pages/2026-09-30-piano-standard.pdf"));
  const cloud = await demarrerFauxCloud({ id: "doc-piano", nom: "Essai piano", pdf: fs.readFileSync(path.join(RACINE, "modeles/piano-standard.pdf")), pages: [pdf.pages[0].traits] });
  const stockage = await demarrerFauxStockage();
  // Une adresse de la forme exacte que l'appli attend, assemblée ici : rien qui
  // ressemble à un vrai secret dans le dépôt.
  const projet = ["essai", "local"].join("").padEnd(20, "x");
  const cle = ["cle", "d", "essai", "local"].join("-").padEnd(32, "0");
  const adresse = `https://${projet}.supabase.co/functions/v1/portee-remarkable/${cle}`;
  const tablette = new CloudRemarkable(coffreMemoire(null), { auth: cloud.url, sync: cloud.url });
  const bibliotheque = new Bibliotheque(objetsSupabase(stockage.url, stockage.cle));
  const appels = [];
  const ctx = await contexte(navigateur, {
    appareil: TELEPHONE,
    routes: [[(u) => u.hostname === `${projet}.supabase.co`, async (route) => {
      const r = route.request();
      const corps = r.postData();
      if (corps) appels.push(JSON.parse(corps).params?.name);
      const reponse = await repondreHttp(new Request(r.url(), { method: r.method(), headers: await r.allHeaders(), body: corps ?? undefined }), {
        cle, cloud: () => tablette, bibliotheque: () => bibliotheque, origines: [serveur.origine],
      });
      await route.fulfill({ status: reponse.status, headers: Object.fromEntries(reponse.headers), body: Buffer.from(await reponse.arrayBuffer()) });
    }]],
  });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#tab-partitions");
    await page.click("#ouvrir-remarkable");
    await page.fill('#panneau-remarkable input[type="url"]', adresse);
    await page.click('#panneau-remarkable button[type="submit"]');
    // Jamais reliée : le code de my.remarkable.com.
    await page.fill("#code-rm", "abcdefgh");
    await page.click('#panneau-remarkable form:has(#code-rm) button[type="submit"]');
    await page.click('#arbre-rm summary:has-text("Partitions")');
    await page.click('#arbre-rm .doc-rm:has-text("Essai piano") button:has-text("Importer")');
    await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached", timeout: 20000 });
    for (const outil of ["arborescence", "relier", "document"]) assert.ok(appels.includes(outil), `${outil} appelé (${appels.join(", ")})`);
    // La synchronisation est partie aussi : la page importée rejoint la bibliothèque commune.
    const debut = Date.now();
    while (!(await bibliotheque.changements()).partitions.length && Date.now() - debut < 15000) await new Promise((ok) => setTimeout(ok, 200));
    assert.deepEqual((await bibliotheque.changements()).partitions.map((f) => f.donnees?.titre), ["Essai piano"]);
    await verifierPropre(page);
  } finally {
    await ctx.close();
    await cloud.fermer();
    await stockage.fermer();
  }
});
