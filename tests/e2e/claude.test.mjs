/**
 * LA VERSION CLAUDE.AI, SIMULÉE
 *
 * Ce que `npm run appli` assemble pour claude.ai (une page en fragment, sans
 * service worker ni CSP à elle), enveloppé dans un document comme le fait
 * claude.ai, avec un faux `window.claude` (faux-claude.mjs) : la base de
 * l'artefact, les téléchargements, et le connecteur « Portée reMarkable »
 * par `use("mcp")`, qui appelle `traiter()`, le vrai connecteur, sur le
 * faux cloud des tests.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, RACINE, attendrePortee, contexte, dossierTemporaire, lancer, nouvellePage, verifierPropre } from "./commun.mjs";
import { installerFauxClaude, lireZip } from "./faux-claude.mjs";
import { demarrerFauxCloud } from "../faux-cloud.mjs";
import { lireFichier } from "../../outils/lire.mjs";
import { coffreMemoire } from "../../supabase/functions/portee-remarkable/coffre.js";
import { traiter } from "../../supabase/functions/portee-remarkable/mcp.js";
import { CloudRemarkable } from "../../supabase/functions/portee-remarkable/remarkable.js";

let serveur, navigateur, cloud, dossier;
before(async () => {
  dossier = dossierTemporaire("claude");
  const sortie = path.join(dossier, "claude");
  execFileSync(process.execPath, [path.join(RACINE, "outils/assembler-appli.mjs"), "--sortie", sortie], { stdio: "pipe" });
  // claude.ai met la page dans un document à lui.
  const habiller = (fragment) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${fragment}</body></html>`;
  serveur = await servir({ dossier: sortie, habiller });
  const pdf = await lireFichier(path.join(RACINE, "tests/pages/2026-09-30-piano-standard.pdf"));
  cloud = await demarrerFauxCloud({ id: "doc-piano", nom: "Essai piano", pdf: fs.readFileSync(path.join(RACINE, "modeles/piano-standard.pdf")), pages: [pdf.pages[0].traits] });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
  await cloud?.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

/** Un navigateur avec le faux claude.ai, et une tablette jamais reliée. */
async function avecClaude() {
  const tablette = new CloudRemarkable(coffreMemoire(null), { auth: cloud.url, sync: cloud.url });
  const appels = [];
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  const claude = await installerFauxClaude(ctx, {
    async appelerOutil(serveurMcp, outil, args) {
      appels.push(outil);
      if (serveurMcp !== "Portée reMarkable") return { erreur: { code: "server_not_found", message: serveurMcp } };
      const r = await traiter({ jsonrpc: "2.0", id: appels.length, method: "tools/call", params: { name: outil, arguments: args } }, tablette);
      if (r.error) return { erreur: { code: "tool_error", message: r.error.message } };
      if (r.result.isError) return { erreur: { code: "tool_error", message: "tool_error", result: r.result } };
      return { payload: r.result.structuredContent };
    },
  });
  return { ctx, claude, appels };
}

async function ouvrir(ctx) {
  const page = await nouvellePage(ctx);
  await page.goto(serveur.url);
  await attendrePortee(page);
  assert.equal(await page.locator("#mode").textContent(), "Enregistré sur claude.ai");
  return page;
}

test("claude.ai : relier la tablette, importer une page, l'exporter en MIDI (zippé), la retrouver après rechargement", async () => {
  const { ctx, claude, appels } = await avecClaude();
  try {
    const page = await ouvrir(ctx);
    await page.click("#tab-partitions");
    await page.click("#ouvrir-remarkable");
    await page.fill("#code-rm", "abcdefgh");
    await page.click('#panneau-remarkable form:has(#code-rm) button[type="submit"]');
    await page.click('#arbre-rm summary:has-text("Partitions")');
    await page.click('#arbre-rm .doc-rm:has-text("Essai piano") button:has-text("Importer")');
    await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached", timeout: 20000 });
    assert.deepEqual(appels, ["arborescence", "relier", "document"]);
    // La partition et ses traits sont dans la base de l'artefact.
    const cles = [...claude.base.keys()];
    assert.equal(cles.filter((k) => /^partitions\/[^/]+$/.test(k)).length, 1);
    assert.ok(cles.some((k) => /^partitions\/[^/]+\/pages\/1$/.test(k)), "les traits de la page");
    // Le MIDI part dans un .zip : la liste des téléchargements de claude.ai ignore .mid.
    await page.click("#onglet-lecteur");
    await page.waitForSelector("#vue-lecteur:not([hidden]) #gravure-lecteur svg .abcjs-note");
    await page.click("#export-midi");
    const debut = Date.now();
    while (!claude.telechargements.length && Date.now() - debut < 10000) await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(claude.telechargements[0]?.nom, "Essai piano (MIDI).zip");
    const zip = lireZip(claude.telechargements[0].octets);
    assert.deepEqual(Object.keys(zip), ["Essai piano.mid"]);
    assert.equal(zip["Essai piano.mid"].subarray(0, 4).toString("latin1"), "MThd");
    // La base vit hors de la page : un rechargement retrouve la partition.
    await page.reload();
    await attendrePortee(page);
    await page.click("#tab-carnet"); // l'accueil rouvre l'onglet qu'on avait quitté (Partitions)
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 1);
    assert.equal(await page.locator("#liste .ligne-titre").textContent(), "Essai piano");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("claude.ai : une sauvegarde piégée ne fait rien exécuter, même sans la CSP du site (S1)", async () => {
  const { ctx } = await avecClaude();
  const fichier = path.join(dossier, "piegee.json");
  const charge = (champ) => `<img src=x onerror="(window.__xss=window.__xss||[]).push('${champ}')">${champ}`;
  const date = "2026-10-04T10:00:00.000Z";
  fs.writeFileSync(fichier, JSON.stringify({
    format: "portee-sauvegarde", version: 1, creeLe: date,
    partitions: [{
      id: "ppiegee", pages: [], donnees: {
        type: "idee", titre: charge("titre"), abc: "X:1\nK:C\nC|", statut: "idee", nbPages: 0, modele: null, tempo: 100, note: "", favori: false,
        etiquettes: [charge("etiquette")], memo: { duree: charge("memo"), type: "audio/mp4" }, creeLe: date, modifieLe: date,
        sequence: { version: 1, tempo: 100, mesure: [4, 4], tonalite: "C", accompagnement: "aucun", suivant: 9, accords: [{ d: 0, nom: charge("accord") }],
          pistes: [{ nom: "Mélodie", notes: [{ id: 1, d: 0, l: 4, h: 60 }] }, { nom: charge("piste"), notes: [{ id: 2, d: 0, l: 4, h: 48 }] }] },
      },
    }],
  }));
  try {
    const page = await ouvrir(ctx);
    await page.click("#tab-reglages");
    await page.setInputFiles("#restaurer", fichier);
    await page.waitForSelector("#toast:not([hidden])");
    await page.click("#tab-carnet");
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length > 0);
    await page.click("#liste .ligne-carnet .ligne-ouvrir");
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-grille .g-note", { state: "attached" });
    await page.click("#idee-plus");
    await page.click('#idee-menu [data-menu="infos"]');
    await page.waitForSelector("#idee-infos[open]");
    assert.equal(await page.evaluate(() => window.__xss), undefined, "du code a été exécuté");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
