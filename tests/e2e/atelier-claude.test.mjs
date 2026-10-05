/**
 * « CORRIGER » DANS LA VERSION CLAUDE.AI, SIMULÉE (lot atelier)
 *
 * La page assemblée pour claude.ai, avec un faux `window.claude`
 * (faux-claude.mjs) : la base de l'artefact, et le connecteur « Portée
 * reMarkable » par `use("mcp")`, qui appelle le vrai connecteur sur le faux
 * cloud des tests. On y essaie ce qui n'existe que là : la page
 * d'étalonnage venue de la tablette, rangée dans la base de la page (L16).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, RACINE, attendrePortee, contexte, dossierTemporaire, lancer, nouvellePage, verifierPropre } from "./commun.mjs";
import { installerFauxClaude } from "./faux-claude.mjs";
import { demarrerFauxCloud, ecrireRm } from "../faux-cloud.mjs";
import { chargerFabrique, deformer, forme, Page } from "../fabrique.mjs";
import { chargerCalibration } from "../../outils/lire.mjs";
import { compacter, decompacter } from "../../app/fiche.js";
import { lireEtalonnage } from "../../lecteur/gabarits.js";
import { lirePartition } from "../../lecteur/partition.js";
import { coffreMemoire } from "../../supabase/functions/portee-remarkable/coffre.js";
import { traiter } from "../../supabase/functions/portee-remarkable/mcp.js";
import { CloudRemarkable } from "../../supabase/functions/portee-remarkable/remarkable.js";
import { traitsDePage } from "../../supabase/functions/portee-remarkable/rm.js";

let serveur, navigateur, cloud, dossier, quarts, etalonnage, fabrique;

/** Des traits comme l'appli les reçoit de la tablette : en .rm, lus par le connecteur, compactés au demi-pixel. */
const allerRetour = (traits) => decompacter(compacter(traitsDePage(ecrireRm(traits))));

/** La page d'étalonnage remplie de tes silences, trois fois chacun, comme à la main : quarts de soupir, soupirs, demi-soupirs. */
function etalonnageRempli(f) {
  const cal = chargerCalibration("etalonnage", 1);
  const place = (t, x, y) => { const pts = t.flat(); const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length; return t.map((u) => u.map(([a, b]) => [a - cx + x, b - cy + y])); };
  const traits = [];
  const ecrire = (etiquette, faire) => {
    const c = cal.cases.find((x) => x.etiquette === etiquette);
    const pas = (c.x1 - c.x0) / 3, y = (c.y0 + c.y1) / 2;
    for (let k = 0; k < 3; k++) traits.push(...faire(c.x0 + (k + 0.5) * pas, y, k));
  };
  ecrire("quart-soupir", (x, y, k) => forme("quart-soupir", x, y, cal.interligne, 50 + k));
  ecrire("soupir", (x, y, k) => place(deformer([f.T[134]], cal.interligne, 60 + k), x, y));
  ecrire("demi-soupir", (x, y, k) => place(deformer([f.T[83]], cal.interligne, 70 + k), x, y));
  return { cal, traits };
}
/** Une mesure de ta mélodie qui finit par deux quarts de soupir : les règles ne les connaissent pas, tes gabarits si. */
function pageQuarts(f) {
  const pg = new Page(f);
  let x = 240;
  for (let k = 0; k < 3; k++) { pg.haut(x, 2 + k); x += 64; }
  pg.crochet(pg.haut(x, 3)); x += 70;
  pg.ajouter(forme("quart-soupir", x, pg.p.y(4), f.IL, 21)); x += 50;
  pg.ajouter(forme("quart-soupir", x, pg.p.y(4), f.IL, 22)); x += 50;
  pg.barre(x);
  return pg.traits;
}

before(async () => {
  dossier = dossierTemporaire("atelier-claude");
  const sortie = path.join(dossier, "claude");
  execFileSync(process.execPath, [path.join(RACINE, "outils/assembler-appli.mjs"), "--sortie", sortie], { stdio: "pipe" });
  // claude.ai met la page dans un document à lui.
  const habiller = (fragment) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${fragment}</body></html>`;
  serveur = await servir({ dossier: sortie, habiller });
  fabrique = await chargerFabrique();
  quarts = pageQuarts(fabrique);
  etalonnage = etalonnageRempli(fabrique);
  cloud = await demarrerFauxCloud({ id: "doc-quarts", nom: "Quarts", pdf: fs.readFileSync(path.join(RACINE, "modeles/melodie-standard.pdf")), pages: [quarts] }, {
    autres: [{ id: "doc-etalonnage", nom: "Étalonnage", pdf: fs.readFileSync(path.join(RACINE, "modeles/etalonnage.pdf")), pages: [etalonnage.traits] }],
  });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
  await cloud?.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

/** Un navigateur avec le faux claude.ai, et une tablette que l'essai relie. */
async function avecClaude() {
  const tablette = new CloudRemarkable(coffreMemoire(null), { auth: cloud.url, sync: cloud.url });
  const appels = [];
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  const claude = await installerFauxClaude(ctx, {
    async appelerOutil(serveurMcp, outil, args) {
      appels.push({ outil, args });
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

/** Relie la tablette (le code du faux cloud) et ouvre le dossier « Partitions ». */
async function relierLaTablette(page) {
  await page.click("#tab-partitions");
  await page.click("#ouvrir-remarkable");
  await page.fill("#code-rm", "abcdefgh");
  await page.click('#panneau-remarkable form:has(#code-rm) button[type="submit"]');
  await page.click('#arbre-rm summary:has-text("Partitions")');
}
const importer = (page, nom) => page.click(`#arbre-rm .doc-rm:has-text("${nom}") button:has-text("Importer")`);

test("claude.ai · L16 · la page d'étalonnage, venue de la tablette : pas une partition ; ses signes rangés dans la base ; la page pas encore corrigée se relit avec eux", async () => {
  // Ce que le lecteur doit lire, avant et après l'étalonnage, sur les traits tels que la tablette les donne.
  const sans = lirePartition([allerRetour(quarts)], fabrique.CAL, { titre: "Quarts" });
  const appris = lireEtalonnage(allerRetour(etalonnage.traits), etalonnage.cal).gabarits;
  const avec = lirePartition([allerRetour(quarts)], fabrique.CAL, { titre: "Quarts", gabarits: appris });
  assert.deepEqual([sans.doutes.length, avec.doutes.length], [2, 1], "un quart de soupir lu grâce aux gabarits, l'autre de justesse");
  assert.notEqual(avec.abc, sans.abc);
  const { ctx, claude, appels } = await avecClaude();
  try {
    const page = await ouvrir(ctx);
    await relierLaTablette(page);
    // D'abord une page aux deux quarts de soupir : les règles ne les lisent pas, deux questions.
    await importer(page, "Quarts");
    await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached", timeout: 20000 });
    assert.equal(await page.textContent("#dock-titre"), "Doute 1 sur 2");
    assert.equal(await page.textContent("#doutes .doute-question"), "Un signe que je ne reconnais pas");
    // Sur claude.ai, le document vient par tranches (une plage de pages, puis ce qui reste).
    assert.deepEqual(appels.filter((a) => a.outil === "document").map((a) => a.args), [{ id: "doc-quarts", pages: { de: 1, a: 500 } }]);
    await page.click("#vue-atelier [data-retour]");
    // La page d'étalonnage : elle apprend tes quarts de soupir, dit ce qui reste vide, et propose de relire.
    // (La tablette est reliée, et le dossier reste ouvert : l'appli s'en souvient.)
    await page.click("#tab-partitions");
    await page.click("#ouvrir-remarkable");
    await page.waitForSelector('#arbre-rm .doc-rm:has-text("Étalonnage") button:has-text("Importer")');
    await importer(page, "Étalonnage");
    await page.waitForSelector("#dialogue[open]");
    const question = await page.textContent("#dialogue h2");
    const texte = await page.textContent("#dialogue .remarque");
    assert.equal(question, "Relire ta page pas encore corrigée ?");
    assert.match(texte, /^Portée a appris 9 signes de ton écriture\. Cases restées vides : dièse, bémol, bécarre, chiffre 1, .*, 3 de triolet\. Tu peux les remplir et importer la page à nouveau\. Relue avec ce que Portée vient d'apprendre, elle se lira peut-être mieux\./, texte);
    // Dans la base de la page : une fiche par signe appris ; aucune partition de plus.
    for (const s of ["quart-soupir", "soupir", "demi-soupir"]) assert.equal(claude.base.get(`partitions/gabarits-${s}`).exemples.length, 3, s);
    assert.equal([...claude.base.keys()].filter((k) => /^partitions\/[^/]+$/.test(k) && !k.includes("gabarits")).length, 1);
    await page.click('#dialogue button[value="oui"]');
    await page.waitForFunction(() => /^1 page se lit autrement/.test(document.getElementById("toast").textContent), null, { timeout: 20000 });
    // La page relue avec tes gabarits : un quart de soupir lu, un doute de moins.
    await page.click("#tab-carnet");
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 1);
    await page.click('#liste .ligne-carnet button[aria-label^="Ouvrir « Quarts"]');
    await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
    assert.equal(await page.inputValue("#abc"), avec.abc);
    assert.equal(await page.textContent("#dock-titre"), "Doute 1 sur 1");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
