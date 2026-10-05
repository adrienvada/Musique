/**
 * L'INTERFACE, ÉCRAN PAR ÉCRAN
 *
 * Un tour de Portée au téléphone (chaque écran, chaque feuille du bas) pour
 * deux règles de CLAUDE.md : tout bouton à icône a un nom (aria-label ou
 * title : le lecteur d'écran le dit, l'appui long l'affiche), et rien ne
 * fait moins de 44 px au doigt, à 390 px de large (le téléphone d'Adrien)
 * comme à 320 (le plus petit qu'on rencontre encore).
 *
 * Le tour passe partout où l'on touche : l'accueil et ses quatre onglets,
 * une idée (ses modes, une note choisie, ses feuilles), un morceau, une page
 * lue (Corriger, une note choisie, Écouter) ; puis ce que la troisième vague
 * a ajouté : la version claude.ai (« Demander à Claude » et ses étapes, le
 * second avis sur un doute) et la bibliothèque commune (le bandeau des
 * suggestions, les versions précédentes, la corbeille).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { RACINE, TELEPHONE, attendrePortee, contexte, dossierTemporaire, importerLesExemples, lancer, nouvellePage, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";
import { installerFauxClaude } from "./faux-claude.mjs";
import { installerFauxSample } from "./faux-sample.mjs";
import { demarrerFauxStockage } from "../faux-cloud.mjs";
import { Bibliotheque } from "../../supabase/functions/portee-remarkable/bibliotheque.js";
import { coffreMemoire } from "../../supabase/functions/portee-remarkable/coffre.js";
import { appelerConversation } from "../../supabase/functions/portee-remarkable/conversation.js";
import { repondreHttp } from "../../supabase/functions/portee-remarkable/http.js";
import { objetsSupabase } from "../../supabase/functions/portee-remarkable/objets.js";
import { CloudRemarkable } from "../../supabase/functions/portee-remarkable/remarkable.js";
import { Suggestions } from "../../supabase/functions/portee-remarkable/suggestions.js";

let serveur, serveurClaude, navigateur, dossier;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  // La version claude.ai, enveloppée dans un document comme le fait claude.ai (claude-idee.test.mjs).
  dossier = dossierTemporaire("interface");
  const sortie = path.join(dossier, "claude");
  execFileSync(process.execPath, [path.join(RACINE, "outils/assembler-appli.mjs"), "--sortie", sortie], { stdio: "pipe" });
  const habiller = (fragment) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${fragment}</body></html>`;
  serveurClaude = await servir({ dossier: sortie, habiller });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
  await serveurClaude?.fermer();
  if (dossier) fs.rmSync(dossier, { recursive: true, force: true });
});

/** Les boutons à icône sans nom (ni aria-label, ni title, ni texte visible). */
const iconesSansNom = (page) => page.evaluate(() => [...document.querySelectorAll("button, [role=button], a[href]")]
  .filter((el) => el.querySelector("svg.ico, .ico"))
  .filter((el) => {
    const copie = el.cloneNode(true);
    copie.querySelectorAll("[aria-hidden=true], svg").forEach((x) => x.remove());
    return !copie.textContent.trim() && !el.getAttribute("aria-label") && !el.getAttribute("title") && !el.getAttribute("aria-labelledby");
  })
  .map((el) => el.outerHTML.slice(0, 140)));

/**
 * LES EXCEPTIONS ACTÉES : ce qui reste sous 44 px, et pourquoi. Chacune dit
 * où la trouver et ce qui la rend acceptable ; tout le reste doit passer.
 * Les rangées de la grille et les notes gravées ne sont pas dans la liste
 * parce que l'essai ne les compte pas (ce ne sont ni des boutons ni des
 * champs), mais elles sont actées aussi :
 *  - les rangées de la grille : de 6 à 44 px selon le zoom (pincer, ou la
 *    feuille Tempo et mesure), c'est à Adrien de choisir ;
 *  - les notes gravées des partitions : le zoom de « Corriger » (− et +,
 *    ou deux doigts) les agrandit jusqu'à 300 %.
 */
const EXCEPTIONS = [
  {
    // Les touches du piano à l'écran (clavier.js), boutons pour le lecteur d'écran : un vrai piano
    // veut les noires plus étroites que les blanches (28 × 68 à 390 px, 26 × 68 à 320), et le
    // clavier garde au moins une octave (sept blanches) : à 320 px, les blanches font 42 de large.
    // On les joue en glissant de l'une à l'autre, comme sur un piano ; la Gamme (huit grosses
    // touches) est là pour qui veut viser large.
    pourquoi: "touches du piano : la forme d'un vrai clavier",
    correspond: (c) => c.classes.includes("touche"),
  },
  {
    // La carte des octaves (clavier.js) : cinq cases dans une bande de 44 px de haut. On vise une
    // région de la bande, pas une case : un toucher ou un glissé n'importe où dans la bande va à
    // l'octave qui est dessous (caseSous). C'est la bande qui est la cible, et elle fait plus de 44 px
    // de côté ; ses cases restent des boutons pour le clavier de l'ordinateur et le lecteur d'écran.
    pourquoi: "carte des octaves : la bande entière est la cible",
    correspond: (c) => c.classes.includes("carte-octave") && c.parent && c.parent.largeur >= 44 && c.parent.hauteur >= 44,
  },
  {
    // Un libellé (label for=…) au-dessus de son champ : le toucher ne fait que donner le focus au
    // champ, qui est juste à côté et fait lui-même 44 px. Le champ est la cible ; le libellé, une
    // seconde façon de l'atteindre (WCAG 2.5.8, « équivalent »). Le grossir n'ajouterait que du vide.
    pourquoi: "libellé d'un champ de 44 px : le champ est la cible",
    correspond: (c) => c.tag === "label" && c.controle && c.controle.largeur >= 44 && c.controle.hauteur >= 44,
  },
];

/** Les cibles visibles de moins de `min` px de large ou de haut, hors exceptions actées. */
const petitesCibles = async (page, min = 44) => {
  const cibles = await page.evaluate((min) => {
    const sortie = [];
    for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, label[for], [role=button], [role=tab], [role=switch]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest("[hidden], dialog:not([open])")) continue;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.pointerEvents === "none") continue;
      if (r.width < min - 0.5 || r.height < min - 0.5) {
        const nom = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
        const p = el.parentElement.getBoundingClientRect();
        const champ = el.tagName === "LABEL" && el.htmlFor ? document.getElementById(el.htmlFor) : null;
        const c = champ && !champ.closest("[hidden]") ? champ.getBoundingClientRect() : null;
        sortie.push({
          texte: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : ""} « ${nom} » ${Math.round(r.width)}×${Math.round(r.height)}`,
          tag: el.tagName.toLowerCase(), classes: [...el.classList], parent: { largeur: p.width, hauteur: p.height },
          controle: c ? { largeur: c.width, hauteur: c.height } : null,
        });
      }
    }
    return sortie;
  }, min);
  return cibles.filter((c) => !EXCEPTIONS.some((x) => x.correspond(c))).map((c) => c.texte);
};

/** Un clic, ou un clic par le code : à 320 px, une cible peut déborder de l'écran (c'est ce qu'on mesure). */
const cliqueur = (page, parLeCode) => (parLeCode ? (sel) => page.locator(sel).first().evaluate((el) => el.click()) : (sel) => page.click(sel));

/** Ouvre une feuille, relève l'écran, la referme par Échap. */
const feuilleDe = (page, cliquer, releve) => async (bouton, id, nom) => {
  await cliquer(bouton);
  await page.waitForSelector(`#${id}[open]`);
  await releve(nom);
  await page.keyboard.press("Escape");
  await page.waitForSelector(`#${id}:not([open])`, { state: "attached" });
};

/** Touche une note gravée de « Ce que Portée a lu » (abcjs écoute le pointeur sur toute la partition). */
async function toucherUneNote(page, rang = 2) {
  const note = page.locator("#gravure-atelier .abcjs-note").nth(rang);
  await note.scrollIntoViewIfNeeded();
  const b = await note.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForSelector("#outils-note:not([hidden])");
}

/**
 * Le tour du site : l'accueil et ses quatre onglets, une idée (ses trois
 * modes, une note choisie, ses feuilles), un morceau, une page lue (Corriger,
 * une note choisie, Écouter). `releve(nom)` est appelé à chaque étape.
 */
async function parcourir(page, releve, { cliquer = (sel) => page.click(sel) } = {}) {
  const feuille = feuilleDe(page, cliquer, releve);
  await importerLesExemples(page);
  await releve("Carnet");
  await cliquer("#nouvelle-idee");
  await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
  for (const k of ["KeyA", "KeyS", "KeyD", "KeyF"]) await page.keyboard.press(k);
  await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 4);
  await releve("Idée · Clavier");
  await cliquer('#idee-modes [data-mode="accords"]');
  await releve("Idée · Accords");
  await feuille("#accords-plus", "feuille-accords", "Feuille · les accords");
  await cliquer('#idee-modes [data-mode="clavier"]');
  await page.keyboard.press("ArrowLeft");
  await page.waitForSelector("#idee-pilule:not([hidden])");
  await releve("Idée · une note choisie");
  await feuille('#idee-pilule [data-action="plus"]', "idee-boite", "Feuille · la boîte à outils");
  await cliquer('#idee-selection [data-action="deselectionner"]');
  await feuille("#idee-reglages-bouton", "idee-reglages", "Feuille · Tempo et mesure");
  await feuille("#idee-plus", "idee-menu", "Feuille · ••• de l'idée");
  await cliquer("#idee-plus");
  await feuille('#idee-menu [data-menu="infos"]', "idee-infos", "Feuille · le carnet de l'idée");
  await cliquer('#idee-affichage [data-affichage="partition"]');
  await page.waitForSelector("#idee-gravure svg .abcjs-note", { state: "attached" });
  await releve("Idée · Partition");
  await cliquer('#idee-affichage [data-affichage="grille"]');
  await cliquer("#vue-idee [data-retour]");
  await page.waitForSelector("#vue-biblio:not([hidden])");
  await feuille("#liste .ligne-carnet .plus", "feuille-actions", "Feuille · ••• d'une ligne du carnet");
  await cliquer("#tab-partitions");
  await releve("Partitions");
  await cliquer("#tab-morceaux");
  await releve("Morceaux");
  await cliquer("#nouveau-morceau");
  await page.waitForSelector("#morceau-choix[open]");
  await releve("Feuille · quelle idée ?");
  await cliquer("#morceau-idees .choix-idee");
  await page.waitForSelector("#morceau-blocs .bloc");
  await releve("Morceau · un bloc");
  await feuille("#morceau-plus", "morceau-menu", "Feuille · ••• du morceau");
  await cliquer("#vue-morceau [data-retour]");
  await page.waitForSelector("#vue-biblio:not([hidden])");
  await cliquer("#tab-reglages");
  await releve("Réglages");
  await cliquer("#tab-partitions");
  await cliquer('#liste-partitions .carte-ouvrir[aria-label^="Ouvrir « Essai melodie"]');
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
  await releve("Corriger · un doute");
  await feuille("#plus-atelier", "feuille-atelier", "Feuille · ••• de Corriger");
  // Une note choisie : ‹ et › autour de son nom, les outils (dont ♯ ♭ ♮), le zoom de la partition lue.
  await cliquer('#vues-atelier [data-vue="lue"]');
  await toucherUneNote(page);
  await releve("Corriger · une note choisie");
  await cliquer("#fermer-note");
  await cliquer('#vues-atelier [data-vue="deux"]');
  await cliquer("#onglet-lecteur");
  await page.waitForSelector("#vue-lecteur:not([hidden]) #gravure-lecteur svg .abcjs-note", { state: "attached" });
  await releve("Écouter et exporter");
  await feuille("#plus-lecteur", "feuille-lecteur", "Feuille · autres formats");
}

/**
 * La version claude.ai (son faux claude.ai et un faux `sample`) : le second
 * avis de Claude sur un doute de « Corriger », puis « Demander à Claude »
 * dans l'idée, étape par étape (que demander, la précision, ta phrase,
 * Claude qui réfléchit, sa proposition, un message).
 */
async function parcourirClaude(page, releve, { cliquer = (sel) => page.click(sel) } = {}) {
  await importerLesExemples(page);
  await cliquer('#liste .ligne-carnet button[aria-label^="Ouvrir « Essai melodie"]');
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
  await cliquer('#doutes [data-geste="demander-avis"]');
  await page.waitForSelector('#doutes .avis-claude[data-avis="pret"]');
  await releve("Corriger · l'avis de Claude");
  await cliquer("#vue-atelier [data-retour]");
  await page.waitForSelector("#vue-biblio:not([hidden])");
  await cliquer("#nouvelle-idee");
  await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
  for (const k of ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"]) await page.keyboard.press(k);
  await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 8);
  await cliquer("#idee-plus");
  await page.waitForSelector("#idee-menu[open]");
  await cliquer('#idee-menu [data-menu="claude"]');
  await page.waitForSelector("#idee-claude[open] #claude-genres:not([hidden])");
  await releve("Feuille · Demander à Claude");
  await cliquer('#claude-genres [data-genre="variation"]');
  await page.waitForSelector("#claude-intentions:not([hidden])");
  await releve("Demander à Claude · une variation, mais comment ?");
  await cliquer("#claude-retour");
  await cliquer('#claude-genres [data-genre="libre"]');
  await page.waitForSelector("#claude-libre:not([hidden])");
  await releve("Demander à Claude · ce que tu veux");
  await cliquer("#claude-retour");
  await cliquer('#claude-genres [data-genre="accords"]');
  await page.waitForSelector("#claude-proposition:not([hidden])");
  await releve("Demander à Claude · sa proposition");
  await cliquer("#claude-autre");
  await page.waitForSelector("#claude-attente:not([hidden])");
  await releve("Demander à Claude · Claude réfléchit");
  await cliquer("#claude-arreter");
  await page.waitForSelector("#claude-attente", { state: "hidden" });
  await cliquer('#claude-genres [data-genre="suite"]');
  await page.waitForSelector("#claude-message:not([hidden])");
  await releve("Demander à Claude · un message");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#idee-claude:not([open])", { state: "attached" });
  // L'entrée de la boîte à outils, sous les familles de gestes.
  await page.keyboard.press("ArrowLeft");
  await page.waitForSelector("#idee-pilule:not([hidden])");
  await cliquer('#idee-pilule [data-action="plus"]');
  await page.waitForSelector("#idee-boite[open]");
  await releve("Feuille · la boîte à outils, avec Claude");
  await page.keyboard.press("Escape");
}

/** Les réponses du faux `sample`, dans l'ordre du tour : l'avis, des accords, un Claude qui réfléchit, puis très demandé. */
const REPONSES_CLAUDE = [
  { json: { reponse: 2, confiance: 0.7, pourquoi: "Le petit trait au bout de la hampe est un crochet." } },
  { json: { accords: [{ mesure: 1, temps: 1, nom: "C" }, { mesure: 2, temps: 1, nom: "F" }, { mesure: 2, temps: 3, nom: "G7" }], pourquoi: "Une cadence toute simple." } },
  { attendre: true },
  { erreur: { code: "rate_limited", message: "slow down" } },
];

/**
 * Une bibliothèque commune : le vrai connecteur (http.js), suggestions
 * comprises, sur le faux stockage des tests (comme donnees.test.mjs), à une
 * adresse de la forme que l'appli attend, assemblée ici.
 */
async function bibliothequeCommune() {
  const stockage = await demarrerFauxStockage();
  const projet = ["essai", "interface"].join("").padEnd(20, "x");
  const cle = ["cle", "d", "essai", "interface"].join("-").padEnd(32, "0");
  const adresse = `https://${projet}.supabase.co/functions/v1/portee-remarkable/${cle}`;
  const objets = objetsSupabase(stockage.url, stockage.cle);
  const bibliotheque = new Bibliotheque(objets);
  const suggestions = new Suggestions(objets);
  const tablette = new CloudRemarkable(coffreMemoire(null), { auth: "http://127.0.0.1:9", sync: "http://127.0.0.1:9" });
  const contextes = [];
  async function appareil(appareil) {
    const ctx = await contexte(navigateur, {
      appareil,
      routes: [[(u) => u.hostname === `${projet}.supabase.co`, async (route) => {
        const r = route.request();
        const corps = r.postData();
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
  /** La fiche de la bibliothèque commune qui répond à `critere`, dès qu'elle y est. */
  async function fiche(critere, { timeout = 20000 } = {}) {
    const fin = Date.now() + timeout;
    for (;;) {
      const f = (await bibliotheque.changements()).partitions.find(critere);
      if (f) return f;
      if (Date.now() > fin) throw new Error("la fiche n'est jamais arrivée dans la bibliothèque commune");
      await new Promise((ok) => setTimeout(ok, 200));
    }
  }
  return {
    bibliotheque, suggestions, appareil, fiche,
    outils: { bibliotheque, suggestions },
    fermer: async () => { for (const c of contextes) await c.close(); await stockage.fermer(); },
  };
}

/**
 * Avec la bibliothèque commune : le bandeau des suggestions de Claude (dans
 * l'idée, déplié, et dans « Corriger »), les versions précédentes d'une
 * idée, puis la corbeille.
 */
async function parcourirCommun(page, releve, commun, { cliquer = (sel) => page.click(sel) } = {}) {
  // Les pages d'essai d'abord, tant que le carnet est vide ; puis Claude note une idée dans une
  // conversation, et range une proposition pour elle. Une passe de synchronisation l'amène ici.
  await importerLesExemples(page);
  const idee = await appelerConversation("idee_ecrire", { titre: "Pluie", tonalite: "Am", notes: [{ debut: 0, duree: 4, hauteur: 69 }, { debut: 4, duree: 4, hauteur: 72 }, { debut: 8, duree: 8, hauteur: 76 }, { debut: 16, duree: 16, hauteur: 74 }] }, commun.outils);
  await appelerConversation("suggestion_ecrire", { cible: idee.id, genre: "accords", contenu: { accords: [{ debut: 0, nom: "Am" }, { debut: 16, nom: "F" }] }, pourquoi: "La mélodie descend vers le fa." }, commun.outils);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const ligne = page.locator(".ligne-carnet", { has: page.locator('.ligne-titre:text-is("Pluie")') });
  await ligne.waitFor({ timeout: 20000 });
  await ligne.locator(".ligne-ouvrir").evaluate((b) => b.click());
  await page.waitForSelector("#idee-suggestions:not([hidden])");
  await releve("Idée · le bandeau des suggestions");
  await cliquer("#idee-suggestions .bandeau-quoi");
  await releve("Idée · le bandeau déplié");
  // Une note de plus : la bibliothèque commune garde la version d'avant.
  await page.keyboard.press("KeyA");
  await page.waitForFunction(() => document.getElementById("idee-etat").textContent === "Enregistrée");
  await cliquer("#vue-idee [data-retour]");
  await commun.fiche((f) => f.id === idee.id && f.donnees.sequence.pistes[0].notes.length === 5);
  await ligne.locator(".plus").evaluate((b) => b.click());
  await page.waitForSelector("#feuille-actions[open]");
  await cliquer('#feuille-liste .btn:has-text("Versions précédentes")');
  await page.waitForFunction(() => document.querySelectorAll("#feuille-versions[open] .version").length === 2, null, { timeout: 20000 });
  await releve("Feuille · les versions précédentes");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#feuille-versions:not([open])", { state: "attached" });
  // Une page lue à qui Claude répond sur un doute : le bandeau de « Corriger ».
  const lue = await commun.fiche((f) => f.donnees && f.donnees.titre === "Essai melodie-standard");
  const rang = lue.donnees.doutes.findIndex((d) => !d.leve);
  await appelerConversation("suggestion_ecrire", { cible: lue.id, genre: "texte", contenu: { doute: rang, note: "Sans doute une croche." }, pourquoi: "La mesure tombe juste." }, commun.outils);
  await cliquer('#liste .ligne-carnet button[aria-label^="Ouvrir « Essai melodie"]');
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
  await page.waitForSelector("#atelier-suggestions:not([hidden])");
  await releve("Corriger · le bandeau des suggestions");
  await cliquer("#vue-atelier [data-retour]");
  await page.waitForSelector("#vue-biblio:not([hidden])");
  // Supprimée, puis dans la corbeille des Réglages.
  await ligne.locator(".plus").evaluate((b) => b.click());
  await page.waitForSelector("#feuille-actions[open]");
  await cliquer('#feuille-liste .btn:has-text("Supprimer")');
  await cliquer('#dialogue button[value="oui"]');
  await commun.fiche((f) => f.id === idee.id && f.supprime);
  await cliquer("#tab-reglages");
  await cliquer("#ouvrir-corbeille");
  await page.waitForSelector("#feuille-corbeille[open] .version");
  await releve("Feuille · la corbeille");
  await page.keyboard.press("Escape");
}

/**
 * Le tour complet, à une largeur donnée : le site, la version claude.ai, la
 * bibliothèque commune. `releve(page, nom)` est appelé à chaque étape ;
 * `parLeCode` : les clics passent par le code (à 320 px, une cible peut
 * déborder de l'écran : c'est ce qu'on mesure).
 */
async function tour(releve, { largeur = 390, parLeCode = false } = {}) {
  const appareil = { ...TELEPHONE, viewport: { width: largeur, height: 844 } };
  // Le site.
  {
    const ctx = await contexte(navigateur, { appareil });
    try {
      const page = await ouvrirPortee(ctx, serveur.url);
      await parcourir(page, (nom) => releve(page, nom), { cliquer: cliqueur(page, parLeCode) });
      await verifierPropre(page);
    } finally { await ctx.close(); }
  }
  // La version claude.ai.
  {
    const ctx = await contexte(navigateur, { appareil });
    try {
      await installerFauxClaude(ctx, { appelerOutil: async () => ({ erreur: { code: "server_not_found", message: "aucun connecteur dans cet essai" } }) });
      await installerFauxSample(ctx, { repondre: ({ n }) => REPONSES_CLAUDE[n - 1] });
      const page = await nouvellePage(ctx);
      await page.goto(serveurClaude.url);
      await attendrePortee(page);
      await parcourirClaude(page, (nom) => releve(page, nom), { cliquer: cliqueur(page, parLeCode) });
      await verifierPropre(page);
    } finally { await ctx.close(); }
  }
  // La bibliothèque commune.
  const commun = await bibliothequeCommune();
  try {
    const ctx = await commun.appareil(appareil);
    const page = await ouvrirPortee(ctx, serveur.url);
    await parcourirCommun(page, (nom) => releve(page, nom), commun, { cliquer: cliqueur(page, parLeCode) });
    await verifierPropre(page);
  } finally { await commun.fermer(); }
}

// Les largeurs essayées : le téléphone d'Adrien, puis le plus petit. D'autres à la main :
// PORTEE_E2E_LARGEURS=360,375 npm run e2e (chacune refait le tour complet).
const LARGEURS = process.env.PORTEE_E2E_LARGEURS ? process.env.PORTEE_E2E_LARGEURS.split(",").map(Number) : [390, 320];

// Une cible trop petite, et les écrans où on la trouve (elle revient souvent d'un écran à l'autre).
const petites = new Map();
const noter = async (page, ecran, largeur) => {
  for (const c of await petitesCibles(page)) petites.set(`${largeur} px : ${c}`, [...(petites.get(`${largeur} px : ${c}`) || []), ecran]);
};
const faites = new Set(); // les largeurs déjà parcourues (le premier essai fait la première)

test("tout bouton à icône a un nom (aria-label ou title)", async () => {
  // Le même tour sert aussi à l'essai suivant (les cibles à cette largeur) : un tour de moins.
  const sansNom = [];
  await tour(async (page, ecran) => {
    for (const b of await iconesSansNom(page)) sansNom.push(`${ecran} : ${b}`);
    await noter(page, ecran, LARGEURS[0]);
  }, { largeur: LARGEURS[0], parLeCode: true });
  faites.add(LARGEURS[0]);
  assert.deepEqual(sansNom, []);
});

test("rien ne fait moins de 44 px au doigt, à 390 et à 320 px de large", async () => {
  for (const largeur of LARGEURS) {
    if (faites.has(largeur)) continue;
    await tour((page, ecran) => noter(page, ecran, largeur), { largeur, parLeCode: true });
    faites.add(largeur);
  }
  const liste = [...petites].map(([c, ecrans]) => `${c} (${ecrans[0]}${ecrans.length > 1 ? ` et ${ecrans.length - 1} autres écrans` : ""})`);
  assert.deepEqual(liste, [], `${liste.length} cibles de moins de 44 px`);
});
