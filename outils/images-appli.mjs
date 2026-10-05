/**
 * LES IMAGES DE L'APPLI INSTALLÉE : ICÔNES ET CAPTURES (audit du 04/10, I4)
 *
 *   node outils/images-appli.mjs
 *
 * Refait dans Chromium ce que le manifeste (app/manifest.webmanifest)
 * montre au système, dans app/icones/ :
 *  - les icônes de l'appli, d'après icone.svg, la seule source : « any »,
 *    arrondies (l'ordinateur, et Android quand il ne découpe pas), et
 *    « maskable », à fond perdu : Android les découpe en cercle, en goutte ou
 *    en carré arrondi, et la clé de sol reste dans la zone sûre (un cercle de
 *    40 % du côté autour du centre ; elle n'en prend que 32 %). Avant, une
 *    seule icône servait aux deux (« any maskable »), ce que Chrome
 *    déconseille ; l'icône de l'iPhone (180 px) reste à fond perdu ;
 *  - les icônes des raccourcis (Nouvelle idée, Chanter, Mémo), avec les
 *    symboles d'app/icones.js, ceux des trois tuiles du carnet ;
 *  - les captures que Chrome montre avant d'installer : étroites (le
 *    téléphone) et large (l'ordinateur), prises dans l'appli assemblée, sur
 *    l'idée d'exemple et les pages d'essai. En WebP (Chromium sait l'écrire) :
 *    bien plus léger qu'en PNG ; le service worker ne les garde pas (seul le
 *    système les demande, avant l'installation).
 *
 * Jamais retouchées à la main : on relance ce script (Chromium de
 * Playwright, `LANG=C.UTF-8`). Les captures dépendent de l'appli : à refaire
 * quand un écran change beaucoup.
 */
// Les fonctions passées à page.evaluate tournent dans la page : elles y voient le navigateur.
/* global document, Image */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { jeuDIcones } from "../app/icones.js";
import { servir } from "../tests/e2e/serveur.mjs";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const icones = path.join(racine, "app/icones");
const captures = path.join(icones, "captures");
fs.mkdirSync(captures, { recursive: true });
const svg = fs.readFileSync(path.join(icones, "icone.svg"), "utf8");
const BLEU = /fill="(#[0-9A-Fa-f]{6})"/.exec(svg)[1]; // le fond de l'icône
const PAPIER = "#F8F8F5"; // la clé de sol

const navigateur = await chromium.launch({ env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });

/** Une image carrée de `cote` px, d'après du HTML qui la remplit ; `rayon` en fraction du côté (0 : à fond perdu). */
async function dessiner(fichier, cote, dedans, rayon = 0) {
  const page = await navigateur.newPage({ viewport: { width: cote, height: cote }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${jeuDIcones()}
    <div id="c" style="width:${cote}px;height:${cote}px;border-radius:${rayon * cote}px;overflow:hidden">${dedans}</div></body></html>`);
  await page.locator("#c").screenshot({ path: path.join(icones, fichier), omitBackground: true });
  await page.close();
}

// L'icône de l'appli : icone.svg, à sa taille.
const icone = svg.replace("<svg ", '<svg width="100%" height="100%" style="display:block" ');
for (const cote of [192, 512]) {
  await dessiner(`icone-${cote}.png`, cote, icone, 0.2);
  await dessiner(`icone-maskable-${cote}.png`, cote, icone);
}
await dessiner("icone-180.png", 180, icone);

// Les raccourcis : le symbole de la tuile, en clair sur le bleu de Portée, au milieu (assez pour un cercle).
for (const [nom, symbole] of [["idee", "clavier"], ["chanter", "micro"], ["memo", "onde"]]) {
  const dessin = `<div style="width:100%;height:100%;background:${BLEU};display:grid;place-items:center">
    <svg viewBox="0 0 24 24" style="width:46%;height:46%;color:${PAPIER}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${symbole}"></use></svg></div>`;
  await dessiner(`raccourci-${nom}.png`, 192, dessin);
}

// Les captures, dans l'appli assemblée et servie comme GitHub Pages.
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "portee-images-"));
execFileSync(process.execPath, [path.join(racine, "outils/assembler-appli.mjs"), "--autonome", "--sortie", path.join(dossier, "site")], { stdio: "pipe" });
const serveur = await servir({ dossier: path.join(dossier, "site") });
// Les pages d'essai, sous le nom que leur donne « Essayer avec les pages d'essai ».
const pages = ["2026-09-30-melodie-standard.pdf", "2026-09-30-piano-standard.pdf"].map((f) => ({
  name: f.replace("2026-09-30-", "Essai "), mimeType: "application/pdf", buffer: fs.readFileSync(path.join(racine, "tests/pages", f)),
}));

/** Une capture en WebP (Chromium l'écrit à partir du PNG). */
async function capturer(page, fichier) {
  // Un message passager (le piano qui se charge…) ne dit rien de l'appli.
  await page.evaluate(() => { for (const t of document.querySelectorAll(".toast")) t.hidden = true; });
  const png = await page.screenshot();
  const vierge = await navigateur.newPage();
  const webp = await vierge.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.82).split(",")[1];
  }, png.toString("base64"));
  await vierge.close();
  fs.writeFileSync(path.join(captures, fichier), Buffer.from(webp, "base64"));
}

const lisible = async (page) => { await page.waitForFunction(() => !/Ouverture/.test(document.getElementById("mode").textContent)); };
try {
  // Au téléphone : l'idée d'exemple, puis le carnet.
  const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR", colorScheme: "light" });
  let page = await tel.newPage();
  await page.goto(serveur.url);
  await lisible(page);
  await page.locator("#exemple-idee").tap();
  await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length > 20);
  await page.waitForTimeout(800);
  await capturer(page, "telephone-idee.webp");
  await page.locator("#vue-idee [data-retour]").tap();
  await page.locator("#fichier").setInputFiles(pages);
  await page.waitForFunction(() => document.querySelectorAll("#liste .ligne-carnet").length === 3, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await capturer(page, "telephone-carnet.webp");
  await tel.close();
  // À l'ordinateur : Corriger, la page lue à côté de ta page.
  const ordi = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, locale: "fr-FR", colorScheme: "light" });
  page = await ordi.newPage();
  await page.goto(serveur.url);
  await lisible(page);
  await page.locator("#fichier").setInputFiles(pages.slice(0, 1));
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached", timeout: 60000 });
  await page.waitForTimeout(1000);
  await capturer(page, "ordinateur-corriger.webp");
  await ordi.close();
} finally {
  await navigateur.close();
  await serveur.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
}
for (const f of [...fs.readdirSync(icones).filter((f) => f.endsWith(".png")), ...fs.readdirSync(captures).map((f) => `captures/${f}`)]) {
  console.log(`${f} : ${(fs.statSync(path.join(icones, f)).size / 1024).toFixed(0)} Ko`);
}
