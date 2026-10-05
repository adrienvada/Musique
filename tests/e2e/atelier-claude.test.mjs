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
import { ORDINATEUR, RACINE, TELEPHONE, attendrePortee, contexte, dossierTemporaire, lancer, nouvellePage, verifierPropre } from "./commun.mjs";
import { installerFauxClaude } from "./faux-claude.mjs";
import { demarrerFauxCloud, ecrireRm } from "../faux-cloud.mjs";
import { chargerFabrique, deformer, forme, Page } from "../fabrique.mjs";
import { chargerCalibration, lireFichier } from "../../outils/lire.mjs";
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
  const melodie = await lireFichier(path.join(RACINE, "tests/pages/2026-09-30-melodie-standard.pdf"));
  const pdfMelodie = fs.readFileSync(path.join(RACINE, "modeles/melodie-standard.pdf"));
  cloud = await demarrerFauxCloud({ id: "doc-quarts", nom: "Quarts", pdf: pdfMelodie, pages: [quarts] }, {
    autres: [
      { id: "doc-etalonnage", nom: "Étalonnage", pdf: fs.readFileSync(path.join(RACINE, "modeles/etalonnage.pdf")), pages: [etalonnage.traits] },
      { id: "doc-melodie", nom: "Mélodie", pdf: pdfMelodie, pages: [melodie.pages[0].traits] },
    ],
  });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
  await cloud?.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

/**
 * Un faux `sample` (et `permissions`), d'après leurs définitions (sample.d.ts,
 * permissions.d.ts) : `sample.json(entree, options)` note chaque appel (le
 * texte, les options, l'image décrite : son type et sa taille) et répond ce
 * que l'essai a prévu, dans l'ordre : { json } (l'avis), { erreur: { code } },
 * ou { attendre: true } (il ne répond jamais : on l'arrête). Un `signal`
 * arrêté rejette { code: "cancelled" }, comme le vrai. `images` : ce que dit
 * `limits()`. Il enveloppe le faux claude.ai de faux-claude.mjs.
 */
async function installerFauxSample(ctx, { reponses, images = true }) {
  const appels = [];
  await ctx.exposeBinding("__fauxSample", async (_source, entree, options) => {
    appels.push({ entree, options });
    return reponses[Math.min(appels.length, reponses.length) - 1];
  });
  await ctx.addInitScript(({ avecImages }) => {
    const use = window.claude.use;
    const decrire = async (b) => { const i = await createImageBitmap(b); return { type: b.type, octets: b.size, largeur: i.width, hauteur: i.height }; };
    // Le vrai `sample` rejette un objet simple { code, message }, pas une Error : le faux aussi.
    const sample = Object.assign(async () => Promise.reject({ code: "invalid_request", message: "seul sample.json sert ici" }), {
      async json(entree, options = {}) {
        const vues = {
          modelTier: options.modelTier, cache: options.cache, signal: options.signal instanceof AbortSignal,
          images: options.images ? await Promise.all([].concat(options.images).map(decrire)) : [],
        };
        if (options.signal && options.signal.aborted) return Promise.reject({ code: "cancelled", message: "aborted" });
        return new Promise((ok, ko) => {
          if (options.signal) options.signal.addEventListener("abort", () => ko({ code: "cancelled", message: "aborted" }));
          window.__fauxSample(entree, vues).then((r) => { if (r && r.erreur) ko(r.erreur); else if (r && !r.attendre) ok(r.json); }, ko);
        });
      },
      limits: async () => ({ maxPromptBytes: 262144, ...(avecImages ? { images: { maxCount: 5, maxInputBytes: 5 * 1024 * 1024, mediaTypes: ["image/png", "image/jpeg"] } } : {}) }),
    });
    window.__autorisations = 0;
    const permissions = { state: async () => "granted", request: async () => ({ sample: "granted" }), manage: async () => { window.__autorisations++; } };
    window.claude = { use: async (nom) => (nom === "sample" ? sample : nom === "permissions" ? permissions : use(nom)) };
  }, { avecImages: images });
  return appels;
}

/** Un navigateur avec le faux claude.ai, et une tablette que l'essai relie. `sample` : les options d'installerFauxSample ; `appareil` : l'ordinateur, ou le téléphone. */
async function avecClaude({ sample = null, appareil = ORDINATEUR } = {}) {
  const tablette = new CloudRemarkable(coffreMemoire(null), { auth: cloud.url, sync: cloud.url });
  const appels = [];
  const ctx = await contexte(navigateur, { appareil });
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
  const avis = sample ? await installerFauxSample(ctx, sample) : null;
  return { ctx, claude, appels, avis };
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

// ------------------------------------------------------------------------
// Le second avis de Claude sur un doute (H1)
// ------------------------------------------------------------------------

/** La mélodie importée de la tablette, ouverte dans « Corriger » sur son premier doute (« Croche ou noire ? »). */
async function melodieOuverte(page) {
  await relierLaTablette(page);
  await importer(page, "Mélodie");
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached", timeout: 20000 });
  assert.equal(await page.textContent("#doutes .doute-question"), "Croche ou noire ?");
}
/** Ce que la carte montre de Claude : son état, et ses textes l'un après l'autre. */
const carteAvis = (page) => page.evaluate(() => {
  const b = document.querySelector("#doutes .avis-claude[data-avis]");
  if (!b) return null;
  const textes = [...b.querySelectorAll("*")].filter((e) => !e.children.length).map((e) => e.textContent.trim()).filter(Boolean);
  return { etat: b.dataset.avis, texte: textes.join(" ") };
});

test("claude.ai · H1 · au téléphone, « Demander à Claude » : le passage et la question partent ; « Claude pense : Croche » ; un toucher l'applique, un « Annuler » le défait", async () => {
  const pourquoi = "Le petit trait au bout de la hampe est un crochet, net.";
  const { ctx, avis } = await avecClaude({ appareil: TELEPHONE, sample: { reponses: [{ json: { reponse: 2, confiance: 0.7, pourquoi } }] } });
  try {
    const page = await ouvrir(ctx);
    await melodieOuverte(page);
    const abc0 = await page.inputValue("#abc");
    await page.click('#doutes [data-geste="demander-avis"]');
    await page.waitForSelector('#doutes .avis-claude[data-avis="pret"]');
    assert.deepEqual(await carteAvis(page), { etat: "pret", texte: `Claude Claude pense : Croche — assez sûr ${pourquoi}` });
    // Ce qui est parti : une question, avec les réponses que tu vois et ce que le lecteur a compris, et l'image du passage.
    assert.equal(avis.length, 1);
    const [{ entree, options }] = avis;
    for (const x of ["Question : Croche ou noire ?", "1. Noire", "2. Croche (la note devient une croche)", "M:12/8", "K:Eb (mi♭ majeur)", "c2 c2 edc g2 GG G",
      "numérotées comme sur l'image", "ne la conteste pas", "Têtes, de gauche à droite", "La question porte sur la tête ", "un cadre bleu en pointillés"]) assert.ok(entree.includes(x), `« ${x} » manque :\n${entree}`);
    assert.deepEqual({ ...options, images: options.images.map((i) => i.type) }, { modelTier: "default", cache: false, signal: true, images: ["image/png"] });
    assert.ok(options.images[0].largeur >= 600 && options.images[0].hauteur >= 200, JSON.stringify(options.images[0]));
    // L'avis ne s'applique pas tout seul.
    assert.equal(await page.inputValue("#abc"), abc0);
    assert.equal(await page.locator("#pas-doutes .pas-doute.fait").count(), 0);
    // Un toucher sur la proposition : la réponse « Croche », comme si tu l'avais touchée ; la mesure recomptée le dit.
    await page.click('#doutes [data-geste="appliquer-avis"]');
    await page.waitForFunction((abc) => document.getElementById("abc").value !== abc, abc0);
    assert.equal(await page.textContent("#doutes .doute-question"), "Il manque une croche");
    assert.equal(await page.isVisible("#pas-doutes .pas-doute:nth-child(1).fait"), true);
    // Un seul « Annuler » défait le tout.
    await page.click("#annuler");
    await page.waitForFunction((abc) => document.getElementById("abc").value === abc, abc0);
    assert.equal(await page.locator("#pas-doutes .pas-doute.fait").count(), 0);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("claude.ai · H1 · « Arrêter », un avis qui ne tient pas, Claude très demandé, Claude qui ne sait pas : rien ne s'applique, et rien ne repart tout seul", async () => {
  const { ctx, avis } = await avecClaude({ sample: { reponses: [
    { attendre: true },
    { json: { reponse: 7, confiance: 0.9, pourquoi: "La septième." } },
    { erreur: { code: "rate_limited", message: "too many requests" } },
    { json: { reponse: null, pourquoi: "Le trait est trop court pour trancher." } },
  ] } });
  try {
    const page = await ouvrir(ctx);
    await melodieOuverte(page);
    const abc0 = await page.inputValue("#abc");
    const demander = async () => { await page.click('#doutes [data-geste="demander-avis"]'); };
    // « Claude regarde… », puis « Arrêter » : la question s'arrête, le bouton revient.
    await demander();
    await page.waitForSelector('#doutes .avis-claude[data-avis="attente"]');
    assert.equal((await carteAvis(page)).texte, "Claude Claude regarde… Arrêter");
    // On arrête une question déjà partie : arrêtée pendant que l'image se dessine, elle ne partirait pas du tout
    // (sample rejette d'emblée un signal arrêté), et le faux servirait sa première réponse à la question suivante.
    for (let t = 0; avis.length < 1 && t < 200; t++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(avis.length, 1);
    await page.click('#doutes [data-geste="arreter-avis"]');
    await page.waitForSelector('#doutes [data-geste="demander-avis"]');
    assert.equal(await carteAvis(page), null);
    // Une réponse hors de la liste : « Claude n'a pas su répondre ».
    await demander();
    await page.waitForSelector('#doutes .avis-claude[data-avis="erreur"]');
    assert.equal((await carteAvis(page)).texte, "Claude Claude n'a pas su répondre : réessaie, ou réponds toi-même.");
    // Trop d'appels : dit en clair ; le bouton reste, rien ne repart seul.
    await demander();
    await page.waitForFunction(() => /très demandé/.test(document.querySelector("#doutes .avis-claude")?.textContent || ""));
    assert.equal((await carteAvis(page)).texte, "Claude Claude est très demandé : réessaie dans un moment.");
    // Claude ne sait pas : un avis qu'on montre tel quel, sans rien à toucher.
    await demander();
    await page.waitForSelector('#doutes .avis-claude[data-avis="pret"]');
    assert.equal((await carteAvis(page)).texte, "Claude Claude ne sait pas trancher. Le trait est trop court pour trancher.");
    assert.equal(await page.locator('#doutes [data-geste="appliquer-avis"]').count(), 0);
    assert.equal(avis.length, 4);
    assert.equal(await page.inputValue("#abc"), abc0);
    // Ailleurs dans la page : ce que la console garde de ces échecs n'est pas une erreur.
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("claude.ai · H1 · sans images, la question part en texte seul ; pas permis, Claude se cache pour la visite, et « Autoriser » le fait revenir", async () => {
  const { ctx, avis } = await avecClaude({ sample: { images: false, reponses: [{ erreur: { code: "not_granted", message: "denied" } }, { json: { reponse: 1, confiance: 0.9, pourquoi: "Une noire." } }] } });
  try {
    const page = await ouvrir(ctx);
    await melodieOuverte(page);
    await page.click('#doutes [data-geste="demander-avis"]');
    await page.waitForSelector("#toast-geste button");
    assert.equal(await page.textContent("#toast-geste span"), "Tu n'as pas autorisé Claude pour cette page : ses avis sont cachés jusqu'au prochain chargement.");
    assert.deepEqual(avis[0].options.images, []);
    assert.ok(!avis[0].entree.includes("image"), avis[0].entree);
    // Caché pour toute la visite : sur ce doute et sur les autres.
    assert.equal(await page.locator('#doutes [data-geste="demander-avis"]').count(), 0);
    await page.click("#pas-doutes .pas-doute:nth-child(2)");
    await page.waitForFunction(() => document.getElementById("dock-titre").textContent.startsWith("Doute 2 sur"));
    assert.equal(await page.locator('#doutes [data-geste="demander-avis"]').count(), 0);
    // « Autoriser » ouvre les autorisations de la page ; accordé, le bouton revient.
    await page.click("#toast-geste button");
    await page.waitForSelector('#doutes [data-geste="demander-avis"]');
    assert.equal(await page.evaluate(() => window.__autorisations), 1);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
