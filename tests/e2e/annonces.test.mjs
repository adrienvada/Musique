/**
 * S'ANNONCER, SE LANCER, TENIR LA CHARGE (audit du 04/10, I4, I9, I11, I12, I15)
 *
 * Ce que l'audit de l'interface a mesuré, rejoué sur le site assemblé :
 *  - le lecteur d'écran sait où il est (un titre par écran, l'onglet du
 *    navigateur qui suit) et entend une phrase courte au lieu de tout le
 *    carnet ; les lignes disent tout ce qu'elles montrent ; les touches du
 *    piano, la grille et les notes gravées ont un nom ou sortent de la
 *    tabulation ; les onglets suivent les flèches (I11) ;
 *  - les messages passagers de l'écran qu'on quitte s'en vont ; le panneau
 *    « Ma reMarkable » sans connecteur ne propose ni Chercher ni Actualiser ;
 *  - (la suite de ce fichier : la grosse bibliothèque, le clavier AZERTY,
 *    les premiers pas, l'appli installée).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { servir } from "./serveur.mjs";
import { DIST, ORDINATEUR, RACINE, TELEPHONE, contexte, dossierTemporaire, importerLesExemples, lancer, listesDu, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";

let serveur, navigateur;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
});

/** Les titres (h1) que le lecteur d'écran trouve : ceux qui ne sont pas dans une partie cachée. */
const titresVus = (page) => page.evaluate(() => [...document.querySelectorAll("h1")].filter((h) => !h.closest("[hidden]")).map((h) => h.textContent.trim()));
/** Ce que dit la région d'annonce, dès qu'elle correspond. */
const annonce = async (page, motif) => {
  await page.waitForFunction((m) => new RegExp(m).test(document.getElementById("annonce").textContent), motif.source);
  return page.textContent("#annonce");
};

test("chaque écran a un titre, l'onglet du navigateur le suit, et l'écran qui s'ouvre se dit (I11)", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    assert.equal(await page.title(), "Carnet · Portée");
    assert.deepEqual(await titresVus(page), ["Noter une idée"]);
    // Le logo se nomme par ce qu'il montre (WCAG 2.5.3).
    assert.match(await page.getAttribute("#aller-biblio", "aria-label"), /^Portée/);
    await page.click("#tab-partitions");
    await page.waitForFunction(() => document.title === "Partitions · Portée");
    assert.deepEqual(await titresVus(page), ["Partitions"]);
    await page.click("#tab-carnet");
    await importerLesExemples(page);
    await page.click('#liste .ligne-carnet button[aria-label^="Ouvrir « Essai melodie"]');
    await page.waitForSelector("#vue-atelier:not([hidden])");
    await page.waitForFunction(() => document.title === "Essai melodie-standard · Corriger · Portée");
    assert.deepEqual(await titresVus(page), ["Corriger « Essai melodie-standard »"]);
    assert.equal(await annonce(page, /Corriger/), "Corriger : « Essai melodie-standard »");
    await page.click("#onglet-lecteur");
    await page.waitForFunction(() => document.title === "Essai melodie-standard · Écouter et exporter · Portée");
    assert.deepEqual(await titresVus(page), ["Écouter et exporter « Essai melodie-standard »"]);
    // Renommée ici : l'onglet suit.
    await page.click("#onglet-atelier");
    await page.fill("#titre", "Ma mélodie");
    await page.press("#titre", "Tab");
    await page.waitForFunction(() => document.title === "Ma mélodie · Corriger · Portée");
    await page.click("#vue-atelier [data-retour]");
    await page.waitForFunction(() => document.title === "Carnet · Portée");
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden])");
    const titreIdee = await page.inputValue("#idee-titre");
    await page.waitForFunction((t) => document.title === `${t} · Idée · Portée`, titreIdee);
    assert.deepEqual(await titresVus(page), [`Idée « ${titreIdee} »`]);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("une étoile touchée se dit en une phrase ; une ligne dit son état et sa date (I11)", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    // Le carnet n'est plus une région vivante : il se relisait en entier.
    assert.equal(await page.getAttribute("#liste", "aria-live"), null);
    const nom = await page.getAttribute('#liste .ligne-carnet button[aria-label^="Ouvrir « Essai melodie"]', "aria-label");
    assert.match(nom, /^Ouvrir « Essai melodie-standard », À relire, Mélodie · \d\d:\d\d$/);
    await page.locator('#liste .ligne-carnet:has(button[aria-label^="Ouvrir « Essai melodie"]) .favori').tap();
    assert.equal(await annonce(page, /favoris/), "« Essai melodie-standard » est dans tes favoris.");
    // Les cartes de l'onglet Partitions aussi.
    await page.locator("#tab-partitions").tap();
    const carte = await page.getAttribute('#liste-partitions .carte-ouvrir[aria-label^="Ouvrir « Essai piano"]', "aria-label");
    assert.match(carte, /^Ouvrir « Essai piano-standard », À relire( · \d+ doutes?)?, Piano · /);
    // Un filtre touché dit ce qui reste.
    await page.locator('#filtres-pages [data-filtre-page="prete"]').tap();
    assert.equal(await annonce(page, /correspond/), "Rien ne correspond");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("les messages de l'écran qu'on quitte s'en vont ; ceux qui parlent du changement restent", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    await page.waitForFunction(() => /est lue/.test(document.getElementById("toast").textContent) && !document.getElementById("toast").hidden);
    // Plus d'une seconde après : il parlait de l'accueil, pas de l'idée.
    await page.waitForTimeout(1200);
    await page.locator("#nouvelle-idee").tap();
    await page.waitForSelector("#vue-idee:not([hidden])");
    assert.equal(await page.evaluate(() => document.getElementById("toast").hidden), true);
    await page.locator("#vue-idee [data-retour]").tap();
    // Supprimer depuis « Corriger » : « … est supprimée » s'écrit juste avant le retour au carnet, et reste.
    await page.locator('#liste .ligne-carnet button[aria-label^="Ouvrir « Essai piano"]').tap();
    await page.waitForSelector("#vue-atelier:not([hidden])");
    await page.locator("#plus-atelier").tap();
    await page.locator("#feuille-atelier button", { hasText: "Supprimer" }).tap();
    await page.locator("#dialogue button", { hasText: "Supprimer" }).tap();
    await page.waitForSelector("#vue-biblio:not([hidden])");
    await page.waitForFunction(() => /est supprimée/.test(document.getElementById("toast").textContent));
    assert.equal(await page.evaluate(() => document.getElementById("toast").hidden), false);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("Ma reMarkable sans connecteur : ni Chercher ni Actualiser, seulement l'adresse à coller ; l'import dit « PDF ou MIDI »", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.locator("#tab-partitions").tap();
    assert.equal((await page.textContent("#importer-pdf")).trim(), "Importer un PDF ou un MIDI");
    await page.locator("#ouvrir-remarkable").tap();
    await page.waitForSelector("#panneau-remarkable:not([hidden]) .aide-connecteur input[type=url]");
    assert.equal(await page.isVisible("#recherche-rm"), false);
    assert.equal(await page.isVisible("#actualiser-rm"), false);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("les touches du piano se nomment, la grille se prend au clavier, les notes gravées sortent de la tabulation (I11)", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
    const touches = await page.evaluate(() => [...document.querySelectorAll("#idee-clavier .touche")].slice(0, 3).map((t) => [t.getAttribute("role"), t.getAttribute("aria-label"), t.tabIndex]));
    assert.deepEqual(touches.map(([role, , tab]) => [role, tab]), [["button", -1], ["button", -1], ["button", -1]]);
    assert.match(touches[0][1], /^do\d$/);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll("#idee-clavier .touche.noire")].every((t) => / (dièse|bémol) \d$/.test(t.getAttribute("aria-label")))));
    // Une touche activée sans pointeur (le lecteur d'écran) joue et écrit sa note.
    await page.evaluate(() => document.querySelector("#idee-clavier .touche.blanche").click());
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 1);
    // La zone de la grille qui défile se prend au clavier, avec un nom.
    assert.deepEqual(await page.evaluate(() => { const d = document.querySelector("#idee-grille .g-defil"); return [d.tabIndex, d.getAttribute("role"), !!d.getAttribute("aria-label")]; }), [0, "group", true]);
    for (const k of ["KeyS", "KeyD"]) await page.keyboard.press(k);
    await page.click('#idee-affichage [data-affichage="partition"]');
    await page.waitForSelector("#idee-gravure svg .abcjs-note", { state: "attached" });
    assert.deepEqual(await page.evaluate(() => [...new Set([...document.querySelectorAll('#idee-gravure [selectable="true"]')].map((n) => n.getAttribute("tabindex")))]), ["-1"]);
    assert.equal(await page.getAttribute("#idee-gravure svg[role=img]", "aria-label"), "La partition de l'idée");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("les onglets suivent les flèches au clavier ; touchés à la souris, ← → choisissent toujours la note (I11)", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    // Les pages d'essai d'abord : l'invitation à les importer n'est que dans un carnet vide.
    await importerLesExemples(page);
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
    for (const k of ["KeyA", "KeyS", "KeyD"]) await page.keyboard.press(k);
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 3);
    const mode = () => page.evaluate(() => document.querySelector('#idee-modes [aria-selected="true"]').dataset.mode);
    // À la souris : l'onglet garde le focus, mais ← choisit la note d'avant, comme avant.
    await page.click('#idee-modes [data-mode="accords"]');
    await page.click('#idee-modes [data-mode="clavier"]');
    await page.keyboard.press("ArrowLeft");
    await page.waitForSelector("#idee-selection:not([hidden])");
    assert.equal(await mode(), "clavier");
    await page.keyboard.press("Escape");
    // Au clavier : → passe à l'onglet suivant (Chanter), ← revient, Fin va au dernier.
    await page.focus('#idee-modes [data-mode="clavier"]');
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("End");
    await page.waitForFunction(() => document.querySelector('#idee-modes [aria-selected="true"]').dataset.mode === "accords");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.mode), "accords");
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector('#idee-modes [aria-selected="true"]').dataset.mode === "clavier");
    await page.click("#vue-idee [data-retour]");
    // Corriger ↔ Écouter : la rangée change d'écran, le focus la suit.
    await page.click('#liste .ligne-carnet button[aria-label^="Ouvrir « Essai melodie"]');
    await page.waitForSelector("#vue-atelier:not([hidden])");
    await page.focus("#onglet-atelier");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    await page.waitForSelector("#vue-lecteur:not([hidden])");
    assert.equal(await page.evaluate(() => document.activeElement.id), "onglet-lecteur");
    await page.keyboard.press("ArrowLeft");
    await page.waitForSelector("#vue-atelier:not([hidden])");
    assert.equal(await page.evaluate(() => document.activeElement.id), "onglet-atelier");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// L'appli installée (I4)
// ---------------------------------------------------------------------------

const MELODIE = path.join(RACINE, "tests/pages/2026-09-30-melodie-standard.pdf");

test("le manifeste : installable, une identité fixe, des icônes « any » et « maskable », des captures, des raccourcis (I4)", async () => {
  // Un profil normal : un contexte de navigation privée n'est jamais installable. Et le vrai
  // Chromium (« channel ») : le Chromium allégé des essais ne sait pas ce qu'est une appli installée.
  const profil = dossierTemporaire("installable");
  const ctx = await chromium.launchPersistentContext(profil, {
    channel: "chromium", env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, locale: "fr-FR",
    args: ["--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
  });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(serveur.url);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
    const cdp = await ctx.newCDPSession(page);
    assert.deepEqual((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors, []);
    // L'identité est celle qu'avait Portée sans « id » (son adresse, /Musique/) : une appli déjà installée le reste.
    assert.equal((await cdp.send("Page.getAppId")).appId, `${serveur.origine}/Musique/`);
    const { errors, data } = await cdp.send("Page.getAppManifest");
    assert.deepEqual(errors, []);
    const m = JSON.parse(data);
    assert.deepEqual(m.categories, ["music"]);
    assert.deepEqual(m.launch_handler, { client_mode: "focus-existing" });
    assert.deepEqual(m.shortcuts.map((s) => s.url), ["./?idee", "./?chanter", "./?memo"]);
    assert.deepEqual(m.icons.map((i) => `${i.sizes} ${i.purpose}`), ["192x192 any", "512x512 any", "192x192 maskable", "512x512 maskable"]);
    assert.deepEqual(m.screenshots.map((c) => c.form_factor), ["narrow", "narrow", "wide"]);
    assert.deepEqual(Object.keys(m.file_handlers[0].accept), ["application/pdf", "audio/midi", "application/json"]);
    assert.equal(m.share_target.method, "POST");
    // Chaque image a la taille que le manifeste annonce.
    const images = [...m.icons, ...m.shortcuts.flatMap((s) => s.icons), ...m.screenshots];
    const tailles = await page.evaluate((liste) => Promise.all(liste.map(async ({ src }) => {
      const img = new Image();
      img.src = new URL(src, location.href).href;
      await img.decode();
      return `${img.naturalWidth}x${img.naturalHeight}`;
    })), images);
    assert.deepEqual(tailles, images.map((i) => i.sizes));
    // Le service worker ne garde pas les captures : seul le système les demande, avant d'installer.
    const { COQUILLE } = listesDu(DIST);
    assert.equal(COQUILLE.some((a) => a.startsWith("icones/captures/")), false);
    assert.ok(COQUILLE.includes("icones/icone-maskable-512.png"));
  } finally {
    await ctx.close();
    fs.rmSync(profil, { recursive: true, force: true });
  }
});

test("les raccourcis s'ouvrent : Nouvelle idée, Chanter, Mémo (I4)", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, `${serveur.url}?chanter`);
    await page.waitForSelector("#vue-idee:not([hidden])");
    assert.equal(await page.getAttribute('#idee-modes [data-mode="chanter"]', "aria-selected"), "true");
    await page.goto(`${serveur.url}?memo`);
    // Le mémo enregistre déjà, dans la feuille Carnet de l'idée.
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-infos[open]");
    await page.goto(`${serveur.url}?idee`);
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
    assert.equal(await page.locator("#idee-infos[open]").count(), 0);
    assert.deepEqual(page.erreurs.filter((e) => e.startsWith("[exception]")), []);
  } finally { await ctx.close(); }
});

test("un fichier ouvert d'un double clic, un raccourci touché Portée ouverte : la fenêtre ouverte les reçoit (launchQueue, I4)", async () => {
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    // Chrome sur l'ordinateur, appli installée : le système passe les lancements à la page par launchQueue.
    // (Chromium a déjà la sienne, qu'une simple affectation ne remplace pas.)
    await ctx.addInitScript(() => { Object.defineProperty(window, "launchQueue", { configurable: true, value: { setConsumer: (f) => { window.__lancer = f; } } }); });
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.waitForFunction(() => typeof window.__lancer === "function");
    const pdf = fs.readFileSync(MELODIE).toString("base64");
    await page.evaluate((b64) => {
      const f = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "Ouvert d'un double clic.pdf", { type: "application/pdf" });
      return window.__lancer({ targetURL: new URL("./?ouvrir", location.href).href, files: [{ getFile: async () => f }] });
    }, pdf);
    await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached", timeout: 30000 });
    assert.equal(await page.inputValue("#titre"), "Ouvert d'un double clic");
    // Un raccourci, Portée déjà ouverte (focus-existing) : la même fenêtre va à l'éditeur, en mode Chanter.
    await page.evaluate(() => window.__lancer({ targetURL: new URL("./?chanter", location.href).href, files: [] }));
    await page.waitForSelector("#vue-idee:not([hidden])");
    assert.equal(await page.getAttribute('#idee-modes [data-mode="chanter"]', "aria-selected"), "true");
    await page.click("#vue-idee [data-retour]");
    // Une sauvegarde ouverte d'un double clic : la restauration, comme depuis les Réglages.
    const sauvegarde = JSON.stringify({ format: "portee-sauvegarde", version: 1, partitions: [] });
    await page.evaluate((texte) => window.__lancer({ targetURL: location.href, files: [{ getFile: async () => new File([texte], "Portée - sauvegarde.json", { type: "application/json" }) }] }), sauvegarde);
    await page.waitForFunction(() => /sauvegarde|déjà|vide/i.test(document.getElementById("toast").textContent));
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("un PDF partagé vers Portée (Android) : le service worker le garde, la page l'importe, une fois (I4)", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
    // Ce qu'envoie Android : un POST multipart à ./?partage (share_target du manifeste).
    const pdf = fs.readFileSync(MELODIE).toString("base64");
    const reponse = await page.evaluate(async (b64) => {
      const corps = new FormData();
      corps.append("fichiers", new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "Partagé de la tablette.pdf", { type: "application/pdf" }));
      // Le service worker répond 303 vers la même adresse : la page qui s'y rouvre prendra le fichier.
      const r = await fetch("./?partage", { method: "POST", body: corps });
      return { statut: r.status, adresse: new URL(r.url).search, garde: (await (await caches.open("portee-partage")).keys()).length };
    }, pdf);
    assert.deepEqual(reponse, { statut: 200, adresse: "?partage", garde: 1 });
    // Le serveur (un site statique, comme GitHub Pages) n'a jamais vu le POST.
    assert.equal(serveur.etat.demandes.filter((d) => d === "/Musique/?partage").length, 1);
    await page.goto(`${serveur.url}?partage`);
    await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached", timeout: 30000 });
    assert.equal(await page.inputValue("#titre"), "Partagé de la tablette");
    // Pris une fois : il quitte le cache, un rechargement ne l'importe pas deux fois.
    assert.equal(await page.evaluate(async () => (await (await caches.open("portee-partage")).keys()).length), 0);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// Les premiers pas (I15)
// ---------------------------------------------------------------------------

test("premier lancement au téléphone : essayer sans rien écrire est en vue, et l'idée d'exemple s'efface comme une autre (I15)", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.waitForSelector("#vide:not([hidden])");
    // Au-dessus de la barre d'onglets, fixée en bas : on les voit sans faire défiler (avant : y = 937 px pour 844).
    const places = await page.evaluate(() => {
      const barre = document.getElementById("onglets-accueil").getBoundingClientRect().top;
      return ["exemple-idee", "exemples"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, dessous: r.bottom <= barre, haut: Math.round(r.height) }; });
    });
    assert.deepEqual(places, [{ id: "exemple-idee", dessous: true, haut: places[0].haut }, { id: "exemples", dessous: true, haut: places[1].haut }]);
    assert.ok(places.every((p) => p.haut >= 44), JSON.stringify(places));
    // Rien n'est écrit tant qu'on ne l'ouvre pas.
    assert.equal(await page.locator("#liste .ligne-carnet").count(), 0);
    await page.locator("#exemple-idee").tap();
    await page.waitForSelector("#vue-idee:not([hidden])");
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 33);
    assert.equal(await page.inputValue("#idee-titre"), "Exemple : Au clair de la lune");
    // Ses accords sur la règle, et sa partition.
    assert.ok(await page.locator("#idee-grille .g-accord").count() >= 12);
    await page.locator('#idee-affichage [data-affichage="partition"]').tap();
    await page.waitForSelector("#idee-gravure svg .abcjs-note", { state: "attached" });
    await page.locator('#idee-affichage [data-affichage="grille"]').tap();
    await page.locator("#vue-idee [data-retour]").tap();
    await page.waitForSelector('#liste .ligne-carnet button[aria-label^="Ouvrir « Exemple : Au clair de la lune"]');
    // Elle s'efface comme une autre, et le carnet vide revient.
    await page.locator("#liste .ligne-carnet .plus").tap();
    await page.locator("#feuille-liste button", { hasText: "Supprimer" }).tap();
    await page.locator("#dialogue button", { hasText: "Supprimer" }).tap();
    await page.waitForSelector("#vide:not([hidden])");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// Le clavier AZERTY (I12)
// ---------------------------------------------------------------------------

/** Les lettres que l'aide du clavier montre, et si la mention AZERTY est là. */
const aideDuClavier = (page) => page.evaluate(() => ({
  lettres: [...document.querySelectorAll("#idee-raccourcis kbd[data-touche]")].map((k) => k.textContent).join(" "),
  mention: !document.getElementById("idee-raccourcis-azerty").hidden,
}));

test("l'aide du clavier montre les lettres d'un AZERTY : par le navigateur, ou apprises d'une touche jouée (I12)", async () => {
  // Chromium sur l'ordinateur d'Adrien : la carte du clavier dit AZERTY.
  const ctx = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    await ctx.addInitScript(() => {
      const azerty = { KeyA: "q", KeyW: "z", KeyS: "s", KeyE: "e", KeyD: "d", KeyZ: "w", KeyX: "x", KeyR: "r" };
      Object.defineProperty(navigator, "keyboard", { configurable: true, value: { getLayoutMap: async () => new Map(Object.entries(azerty)) } });
    });
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.click("#nouvelle-idee");
    await page.waitForFunction(() => document.querySelector('#idee-raccourcis kbd[data-touche="KeyA"]').textContent === "Q");
    assert.deepEqual(await aideDuClavier(page), { lettres: "Q Z S E D W X R", mention: false });
    await verifierPropre(page);
  } finally { await ctx.close(); }
  // Sans carte (Safari, Firefox, la page dans claude.ai) : la mention, puis les lettres apprises.
  const ctx2 = await contexte(navigateur, { appareil: ORDINATEUR });
  try {
    await ctx2.addInitScript(() => {
      Object.defineProperty(navigator, "keyboard", { configurable: true, value: { getLayoutMap: async () => { throw new DOMException("refusée", "SecurityError"); } } });
    });
    const page = await ouvrirPortee(ctx2, serveur.url);
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
    assert.deepEqual(await aideDuClavier(page), { lettres: "A W S E D Z X R", mention: true });
    // La touche à la place de A, sur un AZERTY : elle porte Q, et joue une note.
    await page.evaluate(() => { for (const type of ["keydown", "keyup"]) document.body.dispatchEvent(new KeyboardEvent(type, { key: "q", code: "KeyA", bubbles: true, cancelable: true })); });
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 1);
    assert.deepEqual(await aideDuClavier(page), { lettres: "Q Z S E D W X R", mention: false });
    await verifierPropre(page);
  } finally { await ctx2.close(); }
});

// ---------------------------------------------------------------------------
// Une grosse bibliothèque (I9)
// ---------------------------------------------------------------------------

test("une étoile ne refait que sa ligne, et la recherche se regroupe et garde les lignes (I9)", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    // Chaque ligne reçoit une marque : une ligne refaite ne l'a plus.
    const marquer = () => page.evaluate(() => { for (const l of document.querySelectorAll("#liste .ligne-carnet")) l.__marque = l.dataset.id; });
    const marquees = () => page.evaluate(() => [...document.querySelectorAll("#liste .ligne-carnet")].filter((l) => l.__marque === l.dataset.id).map((l) => l.querySelector(".ligne-titre").textContent));
    await marquer();
    await page.locator('#liste .ligne-carnet:has(button[aria-label^="Ouvrir « Essai piano"]) .favori').tap();
    await page.waitForSelector('#liste .ligne-carnet:has(button[aria-label^="Ouvrir « Essai piano"]) .favori[aria-pressed="true"]');
    assert.deepEqual(await marquees(), ["Essai melodie-standard"]);
    // Le focus revient sur l'étoile de la ligne refaite.
    assert.equal(await page.evaluate(() => document.activeElement.closest(".ligne-carnet")?.querySelector(".ligne-titre").textContent), "Essai piano-standard");
    // La recherche : une seule fois dessinée pour des lettres tapées vite, et les lignes gardées.
    await marquer();
    await page.locator("#chercher").tap();
    await page.evaluate(() => { window.__dessins = 0; new MutationObserver(() => window.__dessins++).observe(document.getElementById("liste"), { childList: true }); });
    await page.locator("#recherche").pressSequentially("piano", { delay: 30 });
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 1);
    assert.equal(await page.evaluate(() => window.__dessins), 1);
    assert.deepEqual(await marquees(), ["Essai piano-standard"]);
    // Pendant une recherche, la date se dit en entier (le jour et l'heure).
    assert.match(await page.textContent("#liste .ligne-quand"), / · \d{1,2} \S+, \d\d:\d\d$/);
    await page.locator("#fermer-recherche").tap();
    await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 2);
    assert.deepEqual((await marquees()).sort(), ["Essai melodie-standard", "Essai piano-standard"]);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("pincer la grille l'étire sans la redessiner ; le vrai dessin vient au lever des doigts (I9)", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await page.locator("#nouvelle-idee").tap();
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
    for (let i = 0; i < 4; i++) await page.locator("#idee-clavier .touche.blanche").nth(i).tap();
    await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 4);
    const largeur = () => page.evaluate(() => document.querySelector("#idee-grille .g-note:not(.autre)").getBoundingClientRect().width);
    const avant = await largeur();
    await page.evaluate(() => { window.__redessins = 0; new MutationObserver(() => window.__redessins++).observe(document.querySelector("#idee-grille .g-notes"), { childList: true }); });
    const cdp = await ctx.newCDPSession(page);
    const b = await page.locator("#idee-grille .g-defil").boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 40 - i * 8, y: cy, id: 1 }, { x: cx + 40 + i * 8, y: cy, id: 2 }] });
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok())));
    }
    // Pendant le geste : étiré (en largeur seulement), rien de redessiné.
    const etire = /scale\(([\d.]+), 1\)/.exec(await page.evaluate(() => document.querySelector("#idee-grille .g-etire").style.transform));
    assert.ok(etire && Number(etire[1]) > 1.5, String(etire));
    assert.equal(await page.evaluate(() => window.__redessins), 0);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => window.__redessins > 0);
    assert.equal(await page.evaluate(() => document.querySelector("#idee-grille .g-etire").style.transform), "");
    const apres = await largeur();
    assert.ok(apres > avant * 1.5, `${avant} → ${apres}`);
    // Le zoom choisi se garde sur l'appareil, comme avant.
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("portee:zoom-grille") || "null")?.px > 11);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
