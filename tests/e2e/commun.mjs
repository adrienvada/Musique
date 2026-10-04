/**
 * LE SOCLE DES ESSAIS DE BOUT EN BOUT
 *
 * Chromium, piloté par Playwright, ouvre Portée telle qu'elle est mise en
 * ligne (le site assemblé par `npm run appli -- --autonome`, servi comme
 * GitHub Pages par serveur.mjs). Rien ne sort de la machine : tout ce qui
 * ne va pas au serveur local est refusé et noté (et la résolution des noms
 * est coupée en plus, au cas où), ce qui vérifie au passage que le site ne
 * dépend plus d'aucun CDN.
 *
 * Chaque page est surveillée : erreurs de console, exceptions, et
 * violations de la politique de sécurité du contenu (CSP). Un essai se
 * termine par `verifierPropre`, qui exige qu'il n'y en ait aucune.
 *
 * On attend des états (un élément visible, un texte, un nombre de notes),
 * jamais un délai fixe : les essais restent rapides et ne dépendent pas de
 * la vitesse de la machine.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Le site essayé : dist/, ou un autre assemblage (PORTEE_E2E_SITE), pour
// vérifier qu'un essai sait voir le défaut qu'il garde (sur une version d'avant).
export const DIST = process.env.PORTEE_E2E_SITE ? path.resolve(process.env.PORTEE_E2E_SITE) : path.join(RACINE, "dist");

/** Le site assemblé est là (npm run e2e l'assemble avant de lancer les essais). */
export function siteAssemble() {
  if (!fs.existsSync(path.join(DIST, "sw.js"))) {
    throw new Error("dist/ n'est pas le site assemblé : lance `npm run e2e` (il fait `npm run appli -- --autonome` d'abord).");
  }
  return DIST;
}

/** Un dossier temporaire propre à l'essai. */
export const dossierTemporaire = (nom) => fs.mkdtempSync(path.join(os.tmpdir(), `portee-${nom}-`));

/** La version d'un site assemblé (celle qu'écrit l'assembleur dans sw.js). */
export const versionDu = (dossier) => /const VERSION = "([0-9a-f]+)"/.exec(fs.readFileSync(path.join(dossier, "sw.js"), "utf8"))[1];

/** Les listes que l'assembleur a écrites dans sw.js : { COQUILLE, EN_FOND, PIANO_FICHIERS }. */
export function listesDu(dossier) {
  const sw = fs.readFileSync(path.join(dossier, "sw.js"), "utf8");
  const liste = (nom) => JSON.parse(new RegExp(`const ${nom} = (\\[.*\\]);`).exec(sw)[1]);
  return { COQUILLE: liste("COQUILLE"), EN_FOND: liste("EN_FOND"), PIANO_FICHIERS: liste("PIANO_FICHIERS") };
}

/**
 * Attend que Portée soit entièrement gardée pour le hors-ligne : le service
 * worker a la main, la coquille est copiée, et la copie en tâche de fond
 * (pdf.js, le piano) est finie.
 */
export async function attendreToutGarde(page, dossier, { timeout = 30000 } = {}) {
  const { COQUILLE, EN_FOND, PIANO_FICHIERS } = listesDu(dossier);
  const attendu = { version: versionDu(dossier), coquille: COQUILLE.length + EN_FOND.length, piano: PIANO_FICHIERS.length };
  await attendreQue(page, async ({ version, coquille, piano }) => {
    if (!navigator.serviceWorker.controller) return false;
    const n = async (nom) => (await caches.has(nom)) ? (await (await caches.open(nom)).keys()).length : 0;
    const pianos = (await caches.keys()).filter((k) => k.startsWith("portee-piano-"));
    return (await n(`portee-${version}`)) === coquille && pianos.length === 1 && (await n(pianos[0])) === piano;
  }, attendu, { timeout });
}

/**
 * Une « mise en ligne » : le même site sous une autre version, comme après
 * une fusion sur main. Mêmes fichiers, même service worker, mais une autre
 * empreinte partout où elle apparaît (adresses des modules, nom du cache).
 */
export function nouvelleVersion(dossier, cible) {
  const avant = versionDu(dossier);
  const apres = (BigInt("0x" + avant) ^ 0xfffn).toString(16).padStart(avant.length, "0");
  fs.cpSync(dossier, cible, { recursive: true });
  for (const f of fs.readdirSync(cible, { recursive: true })) {
    const chemin = path.join(cible, f);
    if (!/\.(js|html|css)$/.test(f) || f.startsWith("vendor")) continue;
    const texte = fs.readFileSync(chemin, "utf8");
    if (texte.includes(avant)) fs.writeFileSync(chemin, texte.replaceAll(avant, apres));
  }
  return apres;
}

/**
 * Chromium comme sur l'ordinateur d'Adrien : en français et en UTF-8 (sans
 * locale UTF-8, un nom de fichier accentué se télécharge sous le nom
 * « download »), le son permis sans geste, un faux micro (un fichier WAV
 * qu'on lui donne) et sa permission accordée d'avance.
 */
export async function lancer({ micro = null } = {}) {
  const args = [
    "--no-proxy-server",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ];
  if (micro) args.push(`--use-file-for-fake-audio-capture=${micro}`);
  return chromium.launch({ env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, args });
}

/** Les tailles d'écran des essais : le téléphone d'Adrien (au doigt) et l'ordinateur (clavier, souris). */
export const TELEPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const ORDINATEUR = { viewport: { width: 1280, height: 900 } };

/**
 * Un navigateur vierge (son propre stockage) qui ne parle qu'au serveur
 * local. `routes` : d'autres adresses à servir sans quitter la machine
 * (le faux connecteur Supabase, par exemple), sous la forme
 * [[(url) => bool, (route) => …]].
 */
export async function contexte(navigateur, { appareil = ORDINATEUR, routes = [], ...options } = {}) {
  const ctx = await navigateur.newContext({ locale: "fr-FR", acceptDownloads: true, ...appareil, ...options });
  const sorties = [];
  await ctx.route(() => true, async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") return route.continue();
    for (const [correspond, servir] of routes) if (correspond(u)) return servir(route);
    sorties.push(u.href);
    return route.abort("internetdisconnected");
  });
  // Les violations de la CSP, vues de la page elle-même (le script d'essai
  // passe avant la page, la CSP ne le concerne pas).
  await ctx.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__violations.push(`${e.violatedDirective} : ${e.blockedURI || "en ligne"} (${e.sourceFile || "?"}:${e.lineNumber || 0})`);
    });
  });
  ctx.sorties = sorties;
  return ctx;
}

/** Une page surveillée : ses erreurs de console et ses exceptions s'accumulent dans `page.erreurs`. */
export async function nouvellePage(ctx) {
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on("console", (m) => { if (m.type() === "error") page.erreurs.push(`[console] ${m.text()}`); });
  page.on("pageerror", (e) => page.erreurs.push(`[exception] ${e.message}`));
  return page;
}

/** Attend que Portée ait ouvert sa bibliothèque. */
export async function attendrePortee(page) {
  await page.waitForFunction(() => {
    const m = document.getElementById("mode");
    return m && !/Ouverture/.test(m.textContent) && document.querySelector("#onglet-carnet");
  });
}

/** Ouvre Portée dans une page neuve du contexte. */
export async function ouvrirPortee(ctx, url) {
  const page = await nouvellePage(ctx);
  await page.goto(url);
  await attendrePortee(page);
  return page;
}

/**
 * Attend qu'une condition asynchrone, calculée dans la page, devienne vraie
 * (les caches, le service worker…). `page.waitForFunction` n'attend pas une
 * promesse : il la prendrait pour « vrai » tout de suite.
 */
export async function attendreQue(page, condition, arg, { timeout = 15000 } = {}) {
  const fin = Date.now() + timeout;
  for (;;) {
    const valeur = await page.evaluate(condition, arg);
    if (valeur) return valeur;
    if (Date.now() > fin) throw new Error(`toujours faux au bout de ${timeout} ms : ${condition}`);
    await new Promise((ok) => setTimeout(ok, 100));
  }
}

/** Les caches de la page : { nom: nombre d'entrées }. */
export const etatDesCaches = (page) => page.evaluate(async () => {
  const sortie = {};
  for (const k of await caches.keys()) sortie[k] = (await (await caches.open(k)).keys()).length;
  return sortie;
});

/** Aucune erreur, aucune violation de la CSP, rien de demandé hors de la machine. */
export async function verifierPropre(page) {
  const violations = await page.evaluate(() => window.__violations || []);
  assert.deepEqual(violations, [], "violations de la CSP");
  assert.deepEqual(page.erreurs, [], "erreurs dans la page");
  assert.deepEqual(page.context().sorties, [], "requêtes hors de la machine");
}

/** Le contenu d'un téléchargement, en octets. */
export async function octetsDu(telechargement) {
  const chemin = await telechargement.path();
  return fs.readFileSync(chemin);
}

/**
 * Un chanteur de synthèse pour le faux micro de Chromium : un fichier WAV
 * (48 kHz, mono, 16 bits) où chaque note tient `duree` secondes, séparée
 * de la suivante par un souffle de silence. Chromium le joue en boucle.
 * La voix a deux harmoniques, pour ressembler un peu à une voix.
 */
export function ecrireChant(chemin, notes, { duree = 0.9, souffle = 0.35 } = {}) {
  const f = 48000;
  const echantillons = [];
  for (const midi of notes) {
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    const n = Math.round(duree * f);
    for (let i = 0; i < n; i++) {
      const t = i / f;
      const enveloppe = Math.min(1, i / (0.02 * f), (n - i) / (0.02 * f));
      echantillons.push(enveloppe * (0.5 * Math.sin(2 * Math.PI * hz * t) + 0.15 * Math.sin(4 * Math.PI * hz * t)));
    }
    for (let i = 0; i < Math.round(souffle * f); i++) echantillons.push(0);
  }
  const donnees = Buffer.alloc(echantillons.length * 2);
  echantillons.forEach((v, i) => donnees.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const tete = Buffer.alloc(44);
  tete.write("RIFF", 0); tete.writeUInt32LE(36 + donnees.length, 4); tete.write("WAVE", 8);
  tete.write("fmt ", 12); tete.writeUInt32LE(16, 16); tete.writeUInt16LE(1, 20); tete.writeUInt16LE(1, 22);
  tete.writeUInt32LE(f, 24); tete.writeUInt32LE(f * 2, 28); tete.writeUInt16LE(2, 32); tete.writeUInt16LE(16, 34);
  tete.write("data", 36); tete.writeUInt32LE(donnees.length, 40);
  fs.writeFileSync(chemin, Buffer.concat([tete, donnees]));
  return chemin;
}

/** Les pages d'essai (tests/pages/), importées par le bouton « Essayer avec les pages d'essai ». */
export async function importerLesExemples(page) {
  await page.click("#exemples");
  await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length >= 2, null, { timeout: 30000 });
}
