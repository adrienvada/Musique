/**
 * « CORRIGER » ET LES PAGES MANUSCRITES, SUR LE SITE ASSEMBLÉ (lot atelier)
 *
 * Ce que le lot lecteur a préparé, branché dans l'appli et essayé au
 * navigateur : le modèle d'un PDF reconnu à ses lignes grises, une version
 * de modèle inconnue refusée (L9), une page lue par l'ancien lecteur relue
 * à l'ouverture.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { servir } from "./serveur.mjs";
import { ORDINATEUR, RACINE, TELEPHONE, contexte, dossierTemporaire, importerLesExemples, lancer, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";
import { lireFichier } from "../../outils/lire.mjs";
import { compacter } from "../../app/fiche.js";
import { preparerDoutes } from "../../app/doutes.js";
import { lirePartition } from "../../lecteur/partition.js";
import { ajouterExemple, gabaritsVides } from "../../lecteur/gabarits.js";
import { chargerFabrique, forme, Page } from "../fabrique.mjs";

const MELODIE = path.join(RACINE, "tests/pages/2026-09-30-melodie-standard.pdf");

let serveur, navigateur, dossier, melodie;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  navigateur = await lancer();
  dossier = dossierTemporaire("atelier");
  melodie = await lireFichier(MELODIE);
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

/** Le PDF de la mélodie, un morceau de texte remplacé par un autre de même longueur (le sujet du PDF). */
function pdfModifie(avant, apres) {
  assert.equal(avant.length, apres.length);
  const texte = fs.readFileSync(MELODIE).toString("latin1");
  assert.ok(texte.includes(avant));
  return Buffer.from(texte.replace(avant, apres), "latin1");
}

/** Le message passager, dès qu'il correspond à `motif`. */
async function messageQui(page, motif) {
  await page.waitForFunction((m) => new RegExp(m).test(document.getElementById("toast").textContent), motif.source, { timeout: 20000 });
  return page.textContent("#toast");
}

/** Une sauvegarde de Portée, écrite dans le dossier de l'essai, qui contient ces partitions ([{ id, donnees, pages }]). */
function sauvegarde(nom, partitions) {
  const fichier = path.join(dossier, `${nom}.json`);
  fs.writeFileSync(fichier, JSON.stringify({ format: "portee-sauvegarde", version: 1, creeLe: new Date().toISOString(), partitions }));
  return fichier;
}

/** Restaure une sauvegarde et revient au carnet, où ses partitions sont arrivées. */
async function restaurer(page, fichier, n) {
  await page.click("#tab-reglages");
  await page.setInputFiles("#restaurer", fichier);
  await page.click("#tab-carnet");
  await page.waitForFunction((k) => document.querySelectorAll("#liste .ligne-carnet").length === k, n);
}

/** Ouvre une partition lue depuis le carnet (son titre commence par `titre`). */
async function ouvrirPartition(page, titre) {
  await page.click(`#liste .ligne-carnet button[aria-label^="Ouvrir « ${titre}"]`);
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
}

test("L9 · un PDF dont le sujet se trompe ou manque : ses lignes grises disent le modèle, et on le dit ; une version inconnue est refusée", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    // Le sujet dit « piano », les lignes sont celles de la mélodie : lue en mélodie, comme `npm run lire`.
    await page.setInputFiles("#fichier", { name: "Faux piano.pdf", mimeType: "application/pdf", buffer: pdfModifie("portee:melodie-standard:v1", "portee:piano-standard:v1  ") });
    const faux = await messageQui(page, /^« Faux piano » est lue/);
    assert.match(faux, /Le PDF dit « Piano », mais ses lignes sont celles de « Mélodie » : lue avec ce modèle\./, faux);
    await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
    assert.equal(await page.inputValue("#abc"), melodie.abc.replace(/^T:.*$/m, "T:Faux piano"));
    await page.click("#vue-atelier [data-retour]");
    // Sans sujet du tout : reconnu à ses lignes.
    await page.setInputFiles("#fichier", { name: "Sans sujet.pdf", mimeType: "application/pdf", buffer: pdfModifie("portee:melodie-standard:v1", " ".repeat(26)) });
    assert.match(await messageQui(page, /^« Sans sujet » est lue/), /ne disait pas son modèle : reconnu à ses lignes \(Mélodie\)/);
    await page.click("#vue-atelier [data-retour]");
    // Une version que cette appli ne connaît pas : refusée, avec quoi faire, et rien n'est rangé.
    await page.setInputFiles("#fichier", { name: "Version 2.pdf", mimeType: "application/pdf", buffer: pdfModifie("portee:melodie-standard:v1", "portee:melodie-standard:v2") });
    const v2 = await messageQui(page, /^Impossible de lire « Version 2\.pdf »/);
    assert.match(v2, /v2, que cette version de Portée ne connaît pas.*mets l'appli à jour/, v2);
    assert.equal(await page.locator("#liste .ligne-carnet").count(), 2);
    // La version du modèle est rangée avec la page (une relecture prendra la même calibration).
    const versions = await page.evaluate(() => new Promise((ok) => {
      const r = indexedDB.open("portee");
      r.onsuccess = () => { const q = r.result.transaction("partitions").objectStore("partitions").getAll(); q.onsuccess = () => { ok(q.result.map((p) => [p.versionModele, p.versionLecteur])); r.result.close(); }; };
    }));
    assert.deepEqual(versions, [[1, 2], [1, 2]]);
    // Le refus garde son détail dans la console (après la calibration v2, cherchée en vain), et rien d'autre ne s'y plaint.
    assert.deepEqual(page.erreurs.map((e) => /404|v2, que cette version/.test(e)), [true, true]);
    page.erreurs.length = 0;
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("les modèles à télécharger : l'étalonnage en est, un vrai PDF ; une erreur du serveur n'est pas rangée comme un PDF, et on le dit", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#tab-partitions");
    await page.click("#ouvrir-modeles");
    await page.waitForSelector("#panneau-modeles:not([hidden])");
    const bouton = (nom) => page.locator("#liste-modeles .modele").filter({ has: page.locator(".nom", { hasText: new RegExp(`^${nom}$`) }) }).locator("button");
    const [etalonnage] = await Promise.all([page.waitForEvent("download"), bouton("Étalonnage").click()]);
    assert.equal(etalonnage.suggestedFilename(), "Portée - Étalonnage.pdf");
    assert.equal(fs.readFileSync(await etalonnage.path()).subarray(0, 5).toString(), "%PDF-");
    // Le serveur ne donne pas le PDF (404) : rien n'est téléchargé, et le message dit quoi faire.
    await page.route("**/modeles/piano-standard.pdf", (r) => r.fulfill({ status: 404, contentType: "text/html", body: "<h1>Introuvable</h1>" }));
    let telecharges = 0;
    page.on("download", () => { telecharges++; });
    await bouton("Piano").click();
    assert.equal(await messageQui(page, /^Le modèle n'a pas pu être téléchargé/), "Le modèle n'a pas pu être téléchargé : le serveur ne l'a pas donné (erreur 404). Réessaie dans un moment.");
    assert.equal(telecharges, 0);
    // La console garde le refus du serveur et son détail ; rien d'autre ne s'y plaint.
    assert.deepEqual(page.erreurs.map((e) => /404|le serveur ne l'a pas donné/.test(e)), page.erreurs.map(() => true));
    page.erreurs.length = 0;
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("une page lue par l'ancien lecteur, jamais touchée, est relue à l'ouverture ; une page corrigée garde sa lecture", async () => {
  const traits = [compacter(melodie.pages[0].traits)];
  const ancien = melodie.abc.replace(/^T:.*$/m, "T:Ancienne").replace(/\|/, "||"); // une lecture d'avant, un peu autre
  const date = "2026-09-30T10:00:00.000Z";
  const fiche = (titre, abc) => ({ titre, modele: "melodie-standard", abc, abcLu: ancien, doutes: [{ page: 1, portee: 0, message: "Ligne 2, 3ᵉ mesure : 11 croches au lieu de 12.", leve: false }], statut: "a-relire", nbPages: 1, versionLecteur: 1, creeLe: date, modifieLe: date });
  const fichier = sauvegarde("anciennes", [
    { id: "pancienne", donnees: fiche("Ancienne", ancien), pages: traits },
    { id: "pcorrigee", donnees: fiche("Corrigée", ancien.replace(/c2/, "d2")), pages: traits },
  ]);
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await restaurer(page, fichier, 2);
    await ouvrirPartition(page, "Ancienne");
    const dit = await messageQui(page, /a été relue par le lecteur d'aujourd'hui/);
    assert.equal(dit, `« Ancienne » a été relue par le lecteur d'aujourd'hui, qui lit mieux : ${melodie.doutes.length} points à vérifier.`);
    await page.waitForFunction((abc) => document.getElementById("abc").value === abc, melodie.abc.replace(/^T:.*$/m, "T:Ancienne"));
    // Ses doutes sont ceux de la lecture neuve, avec leurs réponses fermées.
    await page.waitForSelector("#doutes .reponses .reponse[data-reponse]");
    assert.equal(await page.textContent("#dock-titre"), `Doute 1 sur ${melodie.doutes.length}`);
    // Une page que tu as corrigée garde ta lecture.
    await page.click("#vue-atelier [data-retour]");
    await ouvrirPartition(page, "Corrigée");
    assert.equal(await page.inputValue("#abc"), ancien.replace(/c2/, "d2"));
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

/** Le doute ouvert : son titre, ses réponses fermées, et l'état de chaque point d'avancement (réglé ou pas). */
const etatDuPanneau = (page) => page.evaluate(() => ({
  titre: document.getElementById("dock-titre").textContent,
  question: document.querySelector("#doutes .doute-question")?.textContent || null,
  reponses: [...document.querySelectorAll("#doutes .reponses .reponse[data-reponse]")].map((b) => b.textContent.trim()),
  faits: [...document.querySelectorAll("#pas-doutes .pas-doute")].map((b) => b.classList.contains("fait")),
}));

test("L13 · L15 · « Croche » fausse une mesure : son doute vient aussitôt, sa proposition règle aussi l'autre doute, et « Annuler » défait tout", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    await ouvrirPartition(page, "Essai melodie");
    const abc0 = await page.inputValue("#abc");
    const n = melodie.doutes.length;
    let etat = await etatDuPanneau(page);
    assert.deepEqual([etat.titre, etat.question, etat.reponses], [`Doute 1 sur ${n}`, "Croche ou noire ?", ["Noire", "Croche"]]);
    // Le crochet en deux morceaux est un crochet : la mesure tombe à 11 croches, et le dit tout de suite.
    await page.click('#doutes .reponse[data-reponse="croche"]');
    await page.waitForFunction((k) => document.getElementById("dock-titre").textContent === `Doute ${k} sur ${k}`, n + 1);
    etat = await etatDuPanneau(page);
    assert.equal(etat.question, "Il manque une croche");
    assert.deepEqual(etat.reponses, ["8ᵉ note en noire", "Ajouter un silence", "Allonger la dernière note"]);
    assert.deepEqual(etat.faits.slice(0, 2), [true, false]);
    // La proposition complète la mesure, et règle avec elle le doute de la ligature de « GG » (le 2ᵉ).
    await page.click('#doutes .reponse[data-reponse="proposition-1"]');
    await page.waitForFunction(() => /\|: c2 c edc g2 GG2 G \|/.test(document.getElementById("abc").value));
    etat = await etatDuPanneau(page);
    assert.deepEqual([etat.faits[0], etat.faits[1], etat.faits[n]], [true, true, true]);
    // « Annuler » : la proposition, puis « Croche » ; le doute ajouté par le recompte part avec.
    await page.click("#annuler");
    await page.waitForFunction(() => !/GG2/.test(document.getElementById("abc").value));
    assert.deepEqual((await etatDuPanneau(page)).faits.slice(0, 2), [true, false]);
    await page.click("#annuler");
    await page.waitForFunction((abc) => document.getElementById("abc").value === abc, abc0);
    etat = await etatDuPanneau(page);
    assert.deepEqual([etat.titre, etat.faits.length, etat.faits.some(Boolean)], [`Doute 1 sur ${n}`, n, false]);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("H3 · l'avis que Claude a rangé depuis une conversation se lit dans la carte du doute, comme du texte, et le site ne propose pas de « Demander à Claude » (H1) ; I13 · le mode avancé se plaint en français", async () => {
  const doutes = preparerDoutes(melodie.doutes).map((d, k) => (k === 0 ? { ...d, avis: { auteur: "claude", texte: "<img src=x>Plutôt une croche : le crochet est net." } } : d));
  const date = new Date().toISOString();
  const fichier = sauvegarde("avis", [{
    id: "pavis", pages: [compacter(melodie.pages[0].traits)],
    donnees: { titre: "Avis", modele: "melodie-standard", versionModele: 1, versionLecteur: 2, abc: melodie.abc, abcLu: melodie.abc, doutes, statut: "a-relire", nbPages: 1, creeLe: date, modifieLe: date },
  }]);
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await restaurer(page, fichier, 1);
    await ouvrirPartition(page, "Avis");
    const avis = await page.evaluate(() => {
      const b = document.querySelector("#doutes .avis-claude");
      return b && { etiquette: b.querySelector(".surtitre").textContent, texte: b.querySelector("p").textContent, images: b.querySelectorAll("img").length };
    });
    assert.deepEqual(avis, { etiquette: "Claude", texte: "<img src=x>Plutôt une croche : le crochet est net.", images: 0 });
    // L'avis ne s'applique pas : le doute reste ouvert, la réponse reste à toucher.
    assert.equal(await page.locator("#pas-doutes .pas-doute.fait").count(), 0);
    // Hors de claude.ai, personne à qui demander : pas de bouton « Demander à Claude » (H1).
    assert.equal(await page.locator('#doutes [data-geste="demander-avis"]').count(), 0);
    // Le mode avancé : un caractère que la gravure ne connaît pas se dit en français.
    await page.click("#plus-atelier");
    await page.click("#voir-abc");
    await page.fill("#abc", (await page.inputValue("#abc")).replace(/\|/, "| h"));
    await page.waitForFunction(() => /Texte ABC à revoir/.test(document.getElementById("etat-abc").textContent));
    const etat = await page.textContent("#etat-abc");
    assert.match(etat, /^Texte ABC à revoir Ligne \d+, \d+ᵉ caractère \(« h »\) : un caractère que la gravure ne connaît pas, ignoré\.( Et \d+ autres endroits\.)?$/, etat);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

// ------------------------------------------------------------------------
// Corriger au téléphone (I14)
// ------------------------------------------------------------------------

/** La note choisie, telle qu'elle se voit : sa largeur, et si elle est dans le cadre de la partition lue et au-dessus du panneau du bas. */
const noteChoisie = (page) => page.evaluate(() => {
  const n = document.querySelector("#gravure-atelier .abcjs-note_selected");
  if (!n) return null;
  const r = n.getBoundingClientRect(), c = document.getElementById("cadre-lue").getBoundingClientRect();
  const bas = window.innerHeight - document.getElementById("dock-atelier").offsetHeight;
  return { largeur: r.width, dansLeCadre: r.left >= c.left - 1 && r.right <= c.right + 1, visible: r.top >= 0 && r.bottom <= bas };
});

test("I14 · au téléphone : ‹ et › vont de note en note, − et + (ou deux doigts) agrandissent la partition lue, et la note choisie reste en vue", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    await ouvrirPartition(page, "Essai melodie");
    await page.click('#vues-atelier [data-vue="lue"]');
    const abc0 = await page.inputValue("#abc");
    assert.equal(await page.textContent("#zoom-val"), "100 %");
    // Une note touchée : ‹ et › sont là, et vont à la voisine (comme ← et → au clavier).
    const boite = await page.locator("#gravure-atelier .abcjs-note").nth(2).boundingBox();
    await page.touchscreen.tap(boite.x + boite.width / 2, boite.y + boite.height / 2);
    await page.waitForSelector("#outils-note:not([hidden])");
    const premiere = await page.textContent("#note-choisie");
    const largeur0 = (await noteChoisie(page)).largeur;
    await page.tap("#note-suivante");
    await page.waitForFunction((n) => document.getElementById("note-choisie").textContent !== n, premiere);
    await page.tap("#note-precedente");
    await page.waitForFunction((n) => document.getElementById("note-choisie").textContent === n, premiere);
    // Trois crans : 200 %, les notes deux fois plus larges, la partition défile de côté.
    for (let k = 0; k < 3; k++) await page.tap("#zoom-plus");
    assert.equal(await page.textContent("#zoom-val"), "200 %");
    const zoomee = await noteChoisie(page);
    assert.ok(Math.abs(zoomee.largeur / largeur0 - 2) < 0.1, `${largeur0} → ${zoomee.largeur}`);
    assert.ok(await page.evaluate(() => { const c = document.getElementById("cadre-lue"); return c.scrollWidth > c.clientWidth * 1.8; }));
    // La note choisie reste en vue, note après note, jusqu'au bout de la ligne et au-delà.
    for (let k = 0; k < 14; k++) {
      await page.tap("#note-suivante");
      const v = await noteChoisie(page);
      assert.ok(v && v.dansLeCadre && v.visible, `note ${k + 1} : ${JSON.stringify(v)}`);
    }
    // Rien ne fait moins de 44 px au doigt ; la page ne déborde pas.
    const tailles = await page.evaluate(() => ["note-precedente", "note-suivante", "zoom-moins", "zoom-plus"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return Math.min(r.width, r.height); }));
    assert.ok(tailles.every((t) => t >= 44), String(tailles));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    // Deux doigts qui s'écartent : la partition grandit (au plus 300 %), et aucune note ne bouge sous eux.
    const choisie = await page.textContent("#note-choisie");
    const cdp = await ctx.newCDPSession(page);
    const c = await page.locator("#cadre-lue").boundingBox();
    const y = c.y + Math.min(60, c.height / 2), x = c.x + c.width / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 40, y, id: 1 }, { x: x + 40, y, id: 2 }] });
    for (let k = 1; k <= 6; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 40 - 12 * k, y, id: 1 }, { x: x + 40 + 12 * k, y, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => document.getElementById("zoom-val").textContent === "300 %");
    assert.equal(await page.inputValue("#abc"), abc0);
    assert.equal(await page.textContent("#note-choisie"), choisie);
    assert.equal(await page.isDisabled("#zoom-plus"), true);
    // Retenu sur cet appareil : la page rouverte garde son zoom.
    await page.click("#vue-atelier [data-retour]");
    await ouvrirPartition(page, "Essai melodie");
    assert.equal(await page.textContent("#zoom-val"), "300 %");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

// ------------------------------------------------------------------------
// Tes gabarits (L16) : apprendre d'une réponse
// ------------------------------------------------------------------------

/** Une mesure fabriquée de tes vrais traits, avec une croix que les règles ne savent pas lire (tests/fabrique.mjs). */
function pageCroix(f, graine) {
  const pg = new Page(f);
  pg.haut(240, 2); pg.haut(304, 3);
  const croix = pg.ajouter(forme("croix", 370, pg.p.y(4), f.IL, graine));
  pg.haut(420, 4); pg.haut(484, 5); pg.barre(540);
  return { traits: pg.traits, croix };
}
/** Une page lue comme l'import la range (enregistrerLecture), pour une sauvegarde. */
function pageLue(id, titre, traits, cal) {
  const r = lirePartition([traits], cal, { titre });
  const date = new Date().toISOString();
  return { id, pages: [compacter(traits)], donnees: { titre, modele: "melodie-standard", versionModele: 1, versionLecteur: 2, abc: r.abc, abcLu: r.abc, doutes: preparerDoutes(r.doutes), statut: "a-relire", nbPages: 1, creeLe: date, modifieLe: date } };
}

test("L16 · une réponse t'apprend le signe : la page quittée, Portée propose de relire l'autre, qui se lit alors sans question ; une réponse annulée n'apprend rien", async () => {
  const f = await chargerFabrique();
  const un = pageCroix(f, 41), deux = pageCroix(f, 42);
  // Ce que doit lire la seconde page avec ce que la première aura appris (un dièse, d'après sa croix).
  const appris = ajouterExemple(gabaritsVides(), un.croix.map((i) => un.traits[i]), "diese", f.IL);
  const attendu = lirePartition([deux.traits], f.CAL, { titre: "Croix 2", gabarits: appris });
  assert.deepEqual(attendu.doutes, []);
  assert.match(attendu.abc, /\^B2/);
  const fichier = sauvegarde("croix", [pageLue("pcroix1", "Croix 1", un.traits, f.CAL), pageLue("pcroix2", "Croix 2", deux.traits, f.CAL)]);
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await restaurer(page, fichier, 2);
    await ouvrirPartition(page, "Croix 1");
    assert.equal(await page.textContent("#doutes .doute-question"), "Un signe que je ne reconnais pas");
    // « Un bécarre », puis « Annuler » : rien à apprendre de cette réponse-là.
    await page.click('#doutes .reponse[data-reponse="becarre"]');
    await page.waitForFunction(() => /=B2/.test(document.getElementById("abc").value));
    await page.click("#annuler");
    await page.waitForFunction(() => !/=B2/.test(document.getElementById("abc").value));
    await page.click('#doutes .reponse[data-reponse="diese"]');
    await page.waitForFunction(() => /\^B2/.test(document.getElementById("abc").value));
    // On quitte la page : le dièse rejoint tes gabarits, et un message propose de relire l'autre page.
    await page.click("#vue-atelier [data-retour]");
    await page.waitForSelector("#toast-geste button");
    assert.equal(await page.textContent("#toast-geste span"), "Portée a appris un signe de ton écriture. Relire ta page pas encore corrigée ?");
    const gabarits = await page.evaluate(() => new Promise((ok) => {
      const r = indexedDB.open("portee");
      r.onsuccess = () => { const q = r.result.transaction("partitions").objectStore("partitions").getAll(); q.onsuccess = () => { ok(q.result.filter((x) => x.type === "gabarits").map((x) => [x.etiquette, x.exemples.length])); r.result.close(); }; };
    }));
    assert.deepEqual(gabarits, [["diese", 1]]);
    await page.click("#toast-geste button");
    await messageQui(page, /^1 page se lit autrement avec ce que Portée a appris/);
    // La seconde page, relue : la croix est un dièse, sans question. Le carnet ne montre que tes deux pages.
    assert.equal(await page.locator("#liste .ligne-carnet").count(), 2);
    await ouvrirPartition(page, "Croix 2");
    assert.equal(await page.inputValue("#abc"), attendu.abc);
    await page.waitForSelector("#doutes .relu");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

// ------------------------------------------------------------------------
// Chaque genre de doute a sa carte
// ------------------------------------------------------------------------

/**
 * Une page fabriquée où le lecteur aurait levé un doute de chaque genre (et
 * de chaque variante) : la forme exacte que rend lirePartition, sur un ABC
 * fait main. Ses traits sont ceux de la mélodie (la loupe a de quoi montrer).
 */
function tousLesDoutes() {
  const abc = ["X:1", "T:Tous les doutes", "M:4/4", "L:1/8", "K:G", "C2 D2 E2 | G2 A2 B2 c2 | d2 e2 f2 g2 | abc d2 e2 f2 |", "a2 g2 f2 e2 | ded c2 B2 A2 |"].join("\n") + "\n";
  const place = (motif, n = 0) => { let k = -1; for (let i = 0; i <= n; i++) k = abc.indexOf(motif, k + 1); assert.ok(k >= 0, motif); return { debut: k, fin: k + motif.length }; };
  const l1 = abc.indexOf("C2 D2"), l2 = abc.indexOf("a2 g2");
  const ligne1 = { debut: l1, fin: abc.indexOf("\n", l1) }, ligne2 = { debut: l2, fin: abc.indexOf("\n", l2) };
  const L = melodie.cal.systemes[0].portees[0].lignes;
  let x = 200;
  const doute = (id, message, extra) => ({ id, page: 1, portee: 0, boite: { x0: (x += 60), y0: L[0] - 12, x1: x + 40, y1: L[4] + 12 }, message, ...extra });
  const doutes = [
    doute("d1", "Petit trait au bout de la hampe : un crochet ?", { type: "crochet", cible: place("D2"), alternative: { croches: 1 } }),
    doute("d2", "Ligne 1, 1ʳᵉ mesure : 6 croches au lieu de 8.", { type: "mesure", cible: { debut: place("C2").debut, fin: place("E2").fin }, ligne: 1, rang: 1, trouve: 6, attendu: 8 }),
    doute("d3", "Tête pleine sans hampe : lue comme une noire.", { type: "sans-hampe", cible: place("G2") }),
    doute("d4", "Tête vide sans hampe, loin de la portée : lue comme une ronde.", { type: "sans-hampe", cible: place("A2") }),
    doute("d5", "Un petit signe au-dessus de trois notes liées : un triolet ?", { type: "triolet", cible: place("ded"), traits: [40] }),
    doute("d6", "La ligature s'arrête juste avant la queue de cette note : lue liée.", { type: "ligature", lue: "liee", cible: { debut: place("abc").debut + 1, fin: place("abc").debut + 2 }, alternative: { croches: 2 }, ecart: 0.47 }),
    doute("d7", "Tête entre deux places : lue si, presque la.", { type: "hauteur", cible: place("B2"), alternative: { note: 0, pas: -1 }, ecart: 0.43 }),
    doute("d8", "Un point un peu loin de sa note : pas compté.", { type: "point", lue: "sans", cible: place("c2"), alternative: { croches: 3 } }),
    doute("d9", "Une tête de justesse : ce gribouillis est peut-être un trait.", { type: "tete", cible: place("e2"), alternative: { supprimer: true } }),
    doute("d10", "Un trait droit sans tête : une note manque peut-être ici.", { type: "tete-manquante", cible: place("f2") }),
    doute("d11", "Signe non reconnu.", { type: "signe", traits: [41], cibleSuivante: place("g2"), ciblePrecedente: place("f2") }),
    doute("d12", "Armure de 1 bémol et 2 dièses : lue en D.", { type: "armure", variante: "melee", cle: "D", autres: ["F", "C"], bemols: 1, dieses: 2, cibleLigne: ligne1 }),
    doute("d13", "Un dièse juste devant la première note.", { type: "armure", variante: "premiere-note", lue: "alteration", alteration: "^", cle: "G", autreCle: "D", cible: place("a2"), cibleLigne: ligne2 }),
    doute("d14", "Pas d'armure en début de ligne : celle de la ligne précédente (G) est reprise.", { type: "armure", cle: "G", autres: ["C"], cibleLigne: ligne2 }),
    doute("d15", "Chiffrage lu 4/4, contredit par les mesures.", { type: "chiffrage", variante: "contredit", m: "4/4", lu: true, appuis: 1, total: 4, autres: ["3/4", "6/8"], chiffres: [{ traits: [17], haut: true }, { traits: [18], haut: false }], cibleLigne: { debut: ligne1.debut, fin: ligne2.fin } }),
    doute("d16", "Chiffrage écrit, sans mesure complète pour le vérifier.", { type: "chiffrage" }),
    doute("d17", "Quelque chose d'étrange ici.", { type: "autre" }),
  ];
  return { abc, doutes: preparerDoutes(doutes) };
}

for (const [nom, appareil] of [["au téléphone", TELEPHONE], ["à l'ordinateur", ORDINATEUR]]) {
  test(`chaque genre de doute a sa carte, sa loupe et ses réponses fermées, qui s'appliquent et s'annulent (${nom})`, async () => {
    const { abc, doutes } = tousLesDoutes();
    const date = new Date().toISOString();
    const fichier = sauvegarde(`tous-${appareil.isMobile ? "telephone" : "ordinateur"}`, [{
      id: "ptous", pages: [compacter(melodie.pages[0].traits)],
      donnees: { titre: "Tous les doutes", modele: "melodie-standard", versionModele: 1, versionLecteur: 2, abc, abcLu: abc, doutes, statut: "a-relire", nbPages: 1, creeLe: date, modifieLe: date },
    }]);
    const ctx = await contexte(navigateur, { appareil });
    try {
      const page = await ouvrirPortee(ctx, serveur.url);
      await restaurer(page, fichier, 1);
      await ouvrirPartition(page, "Tous les doutes");
      const vues = [];
      for (let i = 0; i < doutes.length; i++) {
        await page.click(`#pas-doutes .pas-doute:nth-child(${i + 1})`);
        await page.waitForFunction((k) => document.getElementById("dock-titre").textContent.startsWith(`Doute ${k} sur`), i + 1);
        const carte = await page.evaluate(() => {
          const svg = document.querySelector("#doutes .loupe svg");
          const reponses = [...document.querySelectorAll("#doutes .reponses .reponse[data-reponse]")];
          return {
            question: document.querySelector("#doutes .doute-question").textContent,
            reponses: reponses.map((b) => b.textContent.trim()),
            loupe: !!(svg && svg.getAttribute("viewBox") && svg.querySelector(".encre polyline")),
            petites: reponses.filter((b) => b.getBoundingClientRect().height < 44).length,
            deborde: document.documentElement.scrollWidth > window.innerWidth,
          };
        });
        vues.push(carte.question);
        assert.ok(carte.reponses.length >= 1, `${carte.question} : aucune réponse fermée`);
        assert.ok(carte.loupe, `${carte.question} : pas de loupe`);
        assert.equal(carte.petites, 0, `${carte.question} : une réponse fait moins de 44 px`);
        assert.equal(carte.deborde, false, `${carte.question} : la page déborde`);
        // La dernière réponse (souvent celle qui change la note) : le doute est réglé ; « Annuler » le rouvre et rend l'ABC.
        await page.locator("#doutes .reponses .reponse[data-reponse]").last().click();
        await page.waitForFunction((k) => document.querySelector(`#pas-doutes .pas-doute:nth-child(${k})`).classList.contains("fait"), i + 1);
        await page.click("#annuler");
        await page.waitForFunction((k) => !document.querySelector(`#pas-doutes .pas-doute:nth-child(${k})`).classList.contains("fait"), i + 1);
        assert.equal(await page.inputValue("#abc"), abc, carte.question);
      }
      assert.deepEqual(vues, [
        "Croche ou noire ?", "Il manque 2 croches", "Est-ce une noire ?", "Est-ce une ronde ?", "Un triolet ?", "Croche liée ou noire ?",
        "Si ou la ?", "Pointée ou pas ?", "Une note ou un trait ?", "Il manque une note ?", "Un signe que je ne reconnais pas",
        "Bémols ou dièses ?", "Armure ou altération ?", "Même armure qu'avant ?", "Le chiffrage est-il bon ?", "Le chiffrage est-il bon ?", "À vérifier",
      ]);
      await verifierPropre(page);
    } finally { await ctx.close(); }
  });
}
