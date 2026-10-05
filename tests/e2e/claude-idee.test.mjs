/**
 * DEMANDER À CLAUDE DANS L'ÉDITEUR D'IDÉE (H2), DANS LA VERSION CLAUDE.AI SIMULÉE
 *
 * La version claude.ai (assemblée comme pour la publier, enveloppée dans un
 * document comme le fait claude.ai), avec le faux claude.ai de
 * faux-claude.mjs et un faux `sample` (faux-sample.mjs) qui répond ce que
 * l'essai a prévu, au téléphone :
 *  - des accords vérifiés, écoutés, gardés d'un geste puis annulés d'un
 *    geste ; une réponse injouable refusée, sans rien écrire ;
 *  - une suite écoutée puis gardée ; une variation des notes choisies, depuis
 *    la boîte à outils ;
 *  - un titre et des étiquettes retouchés avant d'être gardés ; « Ce que tu
 *    veux », avec les outils de la page sur une copie de l'idée ;
 *  - « Arrêter » pendant que Claude réfléchit, `rate_limited`, et
 *    `not_granted` (la fonction se cache, « Autoriser Claude » la rend).
 * Et sur le site, comme dans une version claude.ai sans `sample`, rien
 * n'apparaît : ni grisé, ni caché derrière un message.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { RACINE, TELEPHONE, attendrePortee, contexte, dossierTemporaire, lancer, nouvellePage, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";
import { installerFauxClaude } from "./faux-claude.mjs";
import { installerFauxSample } from "./faux-sample.mjs";

let serveurClaude, serveurSite, navigateur, dossier;
before(async () => {
  dossier = dossierTemporaire("claude-idee");
  const sortie = path.join(dossier, "claude");
  execFileSync(process.execPath, [path.join(RACINE, "outils/assembler-appli.mjs"), "--sortie", sortie], { stdio: "pipe" });
  // claude.ai met la page dans un document à lui (comme claude.test.mjs).
  const habiller = (fragment) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${fragment}</body></html>`;
  serveurClaude = await servir({ dossier: sortie, habiller });
  serveurSite = await servir({ dossier: siteAssemble() });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveurClaude?.fermer();
  await serveurSite?.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const SANS_CONNECTEUR = async () => ({ erreur: { code: "server_not_found", message: "aucun connecteur dans cet essai" } });

/** La version claude.ai, au téléphone, avec un Claude qui répond `reponses` dans l'ordre. */
async function avecClaude(reponses, options = {}) {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  await installerFauxClaude(ctx, { appelerOutil: SANS_CONNECTEUR });
  const faux = await installerFauxSample(ctx, { repondre: ({ n }) => reponses[n - 1], ...options });
  const page = await nouvellePage(ctx);
  await page.goto(serveurClaude.url);
  await attendrePortee(page);
  return { ctx, page, ...faux };
}

/** Une idée de huit noires, de do4 à do5 : deux mesures de 4/4, en do majeur. */
async function huitNotes(page) {
  await page.click("#nouvelle-idee");
  await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
  for (const k of ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"]) await page.keyboard.press(k);
  await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 8);
}

/** « ••• » de l'idée, puis « Demander à Claude ». */
async function ouvrirClaude(page) {
  await page.click("#idee-plus");
  await page.waitForSelector("#idee-menu[open]");
  await page.click('#idee-menu [data-menu="claude"]');
  await page.waitForSelector("#idee-claude[open] #claude-genres:not([hidden])");
}

const notesDeLaGrille = (page) => page.locator("#idee-grille .g-note:not(.autre)").evaluateAll((n) => n.map((x) => x.textContent.trim()));
const accordsDeLaGrille = (page) => page.locator("#idee-grille .g-accord").evaluateAll((n) => n.map((x) => x.textContent.trim()));
const nombreDeNotes = (page, n) => page.waitForFunction((n) => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === n, n);
// L'entrée du « ••• » (fermé : on lit son attribut, pas ce qu'on voit).
const entreeCachee = (page) => page.$eval('#idee-menu [data-menu="claude"]', (b) => b.hidden);
const enPause = (page) => page.waitForFunction(() => document.getElementById("claude-ecouter").getAttribute("aria-pressed") === "false");

test("des accords vérifiés et écoutés ; une autre proposition, injouable, refusée ; la suivante gardée d'un geste, annulée d'un geste", async () => {
  const { ctx, page, appels } = await avecClaude([
    { json: { accords: [{ mesure: 1, temps: 1, nom: "C" }, { mesure: 2, temps: 1, nom: "F" }, { mesure: 2, temps: 3, nom: "G7" }], pourquoi: "Une cadence toute simple." } },
    // Une mesure qui n'existe pas, un accord que personne ne sait jouer.
    { json: { accords: [{ mesure: 7, temps: 1, nom: "H7" }], pourquoi: "Un accord inventé." } },
    { json: { accords: [{ mesure: 1, temps: 1, nom: "Am" }, { mesure: 2, temps: 1, nom: "G" }], pourquoi: "Plus sombre." } },
  ]);
  try {
    await huitNotes(page);
    await ouvrirClaude(page);
    assert.equal(await page.textContent("#claude-sur"), "Sur toute l'idée : 2 mesures, do majeur.");
    await page.click('#claude-genres [data-genre="accords"]');
    await page.waitForSelector("#claude-proposition:not([hidden])");
    assert.equal(await page.textContent("#claude-resume"), "3 accords sur les mesures 1 et 2");
    // La bande des mesures : le nom des accords (sans « 3ᵉ temps »).
    assert.deepEqual(await page.locator("#claude-apercu .claude-accord").evaluateAll((n) => n.map((x) => x.lastChild.textContent)), ["C", "F", "G7"]);
    assert.equal(await page.textContent("#claude-pourquoi"), "«\u00a0Une cadence toute simple.\u00a0»");
    // Ce qui est parti : l'idée en notes, la forme exacte du JSON, le modèle de tous les jours, sans cache.
    const { input, opts } = appels[0];
    assert.deepEqual(opts, { modelTier: "default", cache: false, outils: [] });
    for (const x of ["Tempo : 90 à la noire", "Mesure : 4/4", "Tonalité : do majeur (C)", "m1 : 0 4 60 do4 ; 4 4 62 ré4", '{"accords": [{"mesure": 1, "temps": 1, "nom": "C"}], "pourquoi": "…"}']) {
      assert.ok(input.includes(x), `« ${x} » manque dans la demande`);
    }
    // Écouter ne change rien à l'idée.
    await page.click("#claude-ecouter");
    await page.waitForFunction(() => document.getElementById("claude-ecouter").getAttribute("aria-pressed") === "true");
    await page.click("#claude-ecouter");
    await enPause(page);
    assert.deepEqual(await accordsDeLaGrille(page), []);
    // « Une autre » redemande ; celle-ci est injouable : refusée, dite sans détail, rien ne s'écrit.
    await page.click("#claude-autre");
    await page.waitForSelector("#claude-message:not([hidden])");
    assert.equal(await page.textContent("#claude-message-texte"), "Claude n'a pas proposé quelque chose de jouable : réessaie.");
    assert.equal(appels[1].input, appels[0].input); // la même demande : c'est `cache: false` qui la fait repartir
    assert.deepEqual(await accordsDeLaGrille(page), []);
    // « Réessayer » : une troisième, gardée d'un geste, annulée d'un geste.
    await page.click("#claude-reessayer");
    await page.waitForSelector("#claude-proposition:not([hidden])");
    assert.equal(await page.textContent("#claude-resume"), "2 accords sur les mesures 1 et 2");
    await page.click("#claude-garder");
    await page.waitForSelector("#idee-claude:not([open])", { state: "attached" });
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-accord").length === 2);
    assert.deepEqual(await accordsDeLaGrille(page), ["Am", "G"]);
    await page.click("#idee-annuler");
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-accord").length === 0);
    assert.equal((await notesDeLaGrille(page)).length, 8);
    assert.equal(appels.length, 3);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("une suite écoutée puis gardée ; une variation des notes choisies, depuis la boîte à outils", async () => {
  const { ctx, page, appels } = await avecClaude([
    { json: { notes: [{ debut: 0, duree: 4, hauteur: 71 }, { debut: 4, duree: 4, hauteur: 69 }, { debut: 8, duree: 4, hauteur: 67 }, { debut: 12, duree: 4, hauteur: 65 }, { debut: 16, duree: 16, hauteur: 64 }], pourquoi: "La ligne redescend." } },
    { json: { notes: [{ debut: 0, duree: 32, hauteur: 60 }, { debut: 32, duree: 32, hauteur: 64 }], pourquoi: "Deux rondes, et l'on respire." } },
  ]);
  try {
    await huitNotes(page);
    await ouvrirClaude(page);
    await page.click('#claude-genres [data-genre="suite"]');
    await page.waitForSelector("#claude-proposition:not([hidden])");
    assert.equal(await page.textContent("#claude-resume"), "5 notes sur les mesures 3 et 4");
    assert.equal(await page.locator("#claude-apercu .claude-note.claude-propose").count(), 5);
    assert.ok(appels[0].input.includes("les mesures 3 et 4"));
    // Écoutée d'abord : rien ne s'écrit.
    await page.click("#claude-ecouter");
    await page.waitForFunction(() => document.getElementById("claude-ecouter").getAttribute("aria-pressed") === "true");
    await page.click("#claude-ecouter");
    await enPause(page);
    assert.equal((await notesDeLaGrille(page)).length, 8);
    await page.click("#claude-garder");
    await nombreDeNotes(page, 13);
    assert.deepEqual((await notesDeLaGrille(page)).slice(8), ["si4", "la4", "sol4", "fa4", "mi4"]);
    // Tout choisir, la boîte à outils, « Demander à Claude » : sur les notes choisies.
    await page.keyboard.press("Control+KeyA");
    await page.waitForSelector("#idee-pilule:not([hidden])");
    await page.click('#idee-pilule [data-action="plus"]');
    await page.waitForSelector("#idee-boite[open]");
    await page.click('#idee-boite [data-action="claude"]');
    await page.waitForSelector("#idee-claude[open] #claude-genres:not([hidden])");
    // La boîte laisse la place à la feuille de Claude (elle redescend, I3 : on attend qu'elle soit partie).
    await page.waitForSelector("#idee-boite", { state: "hidden", timeout: 2000 });
    assert.equal(await page.textContent("#claude-sur"), "Sur les 13 notes choisies, mesures 1 à 4.");
    await page.click('#claude-genres [data-genre="variation"]');
    await page.click('#claude-intentions-choix [data-intention="plus calme"]');
    await page.waitForSelector("#claude-proposition:not([hidden])");
    assert.equal(await page.textContent("#claude-resume"), "2 notes à la place de 13");
    assert.ok(appels[1].input.includes("* = les notes choisies par Adrien"));
    assert.ok(appels[1].input.includes("plus calme : moins de notes"));
    await page.click("#claude-garder");
    await nombreDeNotes(page, 2);
    // Les nouvelles notes sont choisies : on voit ce qui a changé.
    assert.equal(await page.locator("#idee-grille .g-note.choisie").count(), 2);
    await page.click("#idee-annuler");
    await nombreDeNotes(page, 13);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("un titre et des étiquettes retouchés avant de garder ; « Ce que tu veux », avec les outils de la page", async () => {
  const { ctx, page, appels } = await avecClaude([
    { json: { titre: "Montée du matin", etiquettes: ["lumineux"], pourquoi: "Elle monte." } },
    {
      outils: [{ name: "transposer_idee", input: { demiTons: 2 } }, { name: "etirer", input: { facteur: 2, debut: 16, fin: 32 } }],
      json: { pourquoi: "En ré, et la deuxième mesure deux fois plus lente." },
    },
  ]);
  try {
    await huitNotes(page);
    await ouvrirClaude(page);
    await page.click('#claude-genres [data-genre="titre"]');
    await page.waitForSelector("#claude-champs:not([hidden])");
    assert.equal(appels[0].opts.modelTier, "quick"); // court, sans réflexion
    assert.equal(await page.inputValue("#claude-titre-champ"), "Montée du matin");
    assert.equal(await page.inputValue("#claude-etiquettes-champ"), "lumineux");
    assert.equal(await page.isVisible("#claude-ecouter"), false); // un titre ne s'écoute pas
    await page.fill("#claude-titre-champ", "Montée d'octobre");
    await page.fill("#claude-etiquettes-champ", "lumineux, Gamme");
    await page.click("#claude-garder");
    await page.waitForFunction(() => document.getElementById("idee-titre").value === "Montée d'octobre");
    await page.click("#idee-plus");
    await page.click('#idee-menu [data-menu="infos"]');
    await page.waitForSelector("#idee-infos[open]");
    assert.deepEqual(await page.locator("#info-etiquettes .etiquette").evaluateAll((n) => n.map((x) => x.textContent.trim())), ["lumineux", "gamme"]);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#idee-infos:not([open])", { state: "attached" });
    // « Ce que tu veux » : Claude fait ses gestes sur une copie, on la voit et on l'écoute avant de la garder.
    await ouvrirClaude(page);
    await page.click('#claude-genres [data-genre="libre"]');
    await page.fill("#claude-phrase", "Transpose en ré et double les durées de la deuxième mesure");
    await page.click('#claude-libre button[type="submit"]');
    await page.waitForSelector("#claude-proposition:not([hidden])");
    assert.equal(await page.textContent("#claude-resume"), "8 notes changées, en ré majeur");
    const { opts, outils, input } = appels[1];
    assert.equal(opts.cache, false);
    assert.ok(opts.outils.includes("transposer_idee") && opts.outils.includes("etirer"), opts.outils.join(", "));
    assert.ok(input.includes("« Transpose en ré et double les durées de la deuxième mesure »"));
    assert.match(outils[0].rendu.fait, /en ré majeur/);
    assert.deepEqual(await notesDeLaGrille(page), ["do4", "ré4", "mi4", "fa4", "sol4", "la4", "si4", "do5"]); // rien d'écrit encore
    await page.click("#claude-garder");
    await page.waitForFunction(() => document.querySelector("#idee-grille .g-note:not(.autre)").textContent.trim() === "ré4");
    assert.match(await page.textContent("#idee-resume"), /Ré majeur/);
    await page.click("#idee-annuler");
    await page.waitForFunction(() => document.querySelector("#idee-grille .g-note:not(.autre)").textContent.trim() === "do4");
    assert.match(await page.textContent("#idee-resume"), /Do majeur/);
    // Le bouton « précédent » du téléphone ferme la feuille, comme les autres, sans quitter l'idée.
    await ouvrirClaude(page);
    await page.goBack();
    await page.waitForSelector("#idee-claude:not([open])", { state: "attached" });
    assert.equal(await page.isVisible("#vue-idee"), true);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("« Arrêter » pendant que Claude réfléchit, rate_limited, et not_granted : la fonction se cache, « Autoriser Claude » la rend", async () => {
  const { ctx, page, appels, autorisations } = await avecClaude([
    { attendre: true },
    { erreur: { code: "rate_limited", message: "Too many requests." } },
    { erreur: { code: "not_granted", message: "The viewer has not allowed this artifact to use Claude." } },
    { erreur: { code: "not_granted", message: "The viewer has not allowed this artifact to use Claude." } },
  ]);
  try {
    await huitNotes(page);
    await ouvrirClaude(page);
    await page.click('#claude-genres [data-genre="suite"]');
    await page.waitForSelector("#claude-attente:not([hidden])");
    assert.equal(await page.textContent("#claude-reflechit"), "Claude réfléchit…");
    await page.click("#claude-arreter");
    await page.waitForSelector("#claude-genres:not([hidden])");
    assert.equal(await page.isVisible("#claude-message"), false, "« Arrêter » ne dit rien");
    // Claude très demandé : on le dit, la fonction reste.
    await page.click('#claude-genres [data-genre="suite"]');
    await page.waitForSelector("#claude-message:not([hidden])");
    assert.equal(await page.textContent("#claude-message-texte"), "Claude est très demandé : réessaie dans un moment.");
    assert.equal(await page.isVisible("#claude-reessayer"), true);
    assert.equal(await page.isVisible("#claude-autoriser"), false);
    // Pas autorisé : la feuille le dit et propose d'autoriser ; « Réessayer » ne sert plus.
    await page.click("#claude-reessayer");
    await page.waitForSelector("#claude-autoriser:not([hidden])");
    assert.match(await page.textContent("#claude-message-texte"), /n'est pas autorisé pour cette page/);
    assert.equal(await page.isVisible("#claude-reessayer"), false);
    assert.equal(await entreeCachee(page), true, "la fonction se cache pour la visite");
    await page.click("#claude-autoriser");
    await page.waitForSelector("#claude-genres:not([hidden])");
    assert.deepEqual([autorisations.manage, autorisations.state], [1, ["sample"]]);
    assert.equal(await entreeCachee(page), false, "autorisé : la fonction revient");
    // Refusé encore, la feuille fermée : plus de « Demander à Claude » dans le « ••• ».
    await page.click('#claude-genres [data-genre="suite"]');
    await page.waitForSelector("#claude-autoriser:not([hidden])");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#idee-claude:not([open])", { state: "attached" });
    await page.click("#idee-plus");
    await page.waitForSelector("#idee-menu[open]");
    assert.equal(await page.isVisible('#idee-menu [data-menu="claude"]'), false);
    assert.equal(appels.length, 4, "jamais de nouvel essai tout seul");
    assert.equal((await notesDeLaGrille(page)).length, 8);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("« Ce que tu veux » sans outils de page : des notes, vérifiées ; après tools_unavailable, la demande suivante part sans outils", async () => {
  const { ctx, page, appels } = await avecClaude([
    { erreur: { code: "tools_unavailable", message: "This view cannot run page tools." } },
    { json: { notes: [60, 62, 64, 65, 67, 69, 71, 72].map((h, i) => ({ debut: i * 4, duree: 4, hauteur: h + 2 })), pourquoi: "Tout un ton plus haut." } },
  ]);
  try {
    await huitNotes(page);
    await ouvrirClaude(page);
    await page.click('#claude-genres [data-genre="libre"]');
    await page.fill("#claude-phrase", "Monte tout d'un ton");
    await page.click('#claude-libre button[type="submit"]');
    await page.waitForSelector("#claude-message:not([hidden])");
    assert.equal(await page.textContent("#claude-message-texte"), "Claude ne peut pas se servir de ses outils ici : redemande, il répondra en notes.");
    assert.ok(appels[0].opts.outils.length > 0, "la première demande offrait les outils");
    await page.click("#claude-reessayer");
    await page.waitForSelector("#claude-proposition:not([hidden])");
    // Sans outils : toute la piste en notes, vérifiée comme le reste.
    assert.deepEqual(appels[1].opts.outils, []);
    assert.ok(appels[1].input.includes("celles que tu ne changes pas comprises"));
    assert.equal(await page.textContent("#claude-resume"), "8 notes à la place de 8");
    await page.click("#claude-garder");
    await page.waitForFunction(() => document.querySelector("#idee-grille .g-note:not(.autre)").textContent.trim() === "ré4");
    assert.match(await page.textContent("#idee-resume"), /Do majeur/); // des notes, pas la tonalité
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

/** Ni dans le « ••• » de l'idée, ni dans la boîte à outils de la sélection. */
async function rienNApparait(page) {
  await huitNotes(page);
  await page.click("#idee-plus");
  await page.waitForSelector("#idee-menu[open]");
  assert.equal(await page.isVisible('#idee-menu [data-menu="claude"]'), false);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#idee-menu:not([open])", { state: "attached" });
  await page.keyboard.press("ArrowLeft");
  await page.waitForSelector("#idee-pilule:not([hidden])");
  await page.click('#idee-pilule [data-action="plus"]');
  await page.waitForSelector("#idee-boite[open]");
  assert.equal(await page.isVisible('#idee-boite [data-action="claude"]'), false);
  assert.equal(await page.isVisible("#idee-claude"), false);
}

test("sur le site, et dans une version claude.ai sans `sample`, « Demander à Claude » n'apparaît nulle part", async () => {
  const site = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(site, serveurSite.url);
    assert.equal(await page.evaluate(() => typeof window.claude), "undefined");
    await rienNApparait(page);
    await verifierPropre(page);
  } finally { await site.close(); }
  // claude.ai sans la capacité : le faux claude.ai refuse « sample » (comme un use() qui rend null).
  const sans = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    await installerFauxClaude(sans, { appelerOutil: SANS_CONNECTEUR });
    const page = await nouvellePage(sans);
    await page.goto(serveurClaude.url);
    await attendrePortee(page);
    await rienNApparait(page);
    await verifierPropre(page);
  } finally { await sans.close(); }
});
