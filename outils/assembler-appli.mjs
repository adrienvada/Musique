/**
 * ASSEMBLER L'APPLI DANS dist/
 *
 *   npm run appli            → dist/ prêt à publier sur claude.ai
 *   npm run appli -- --autonome → dist/ pour GitHub Pages : page complète
 *                                 (<!doctype>…), installable, hors ligne
 *
 * L'appli a besoin, à côté de sa page : de ses modules (app/), du lecteur
 * (lecteur/), des modèles (calibrations, PDF à télécharger, aperçus), du
 * piano (app/piano/), de pdf.js (copié depuis node_modules, version figée
 * par package.json) et des pages d'essai (tests/pages/), qu'on peut
 * importer d'un clic. En autonome s'ajoutent le manifeste, les icônes et
 * le service worker (hors ligne), dont le cache change avec le contenu.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(racine, "dist");
const autonome = process.argv.includes("--autonome");

fs.rmSync(dist, { recursive: true, force: true });
const copier = (src, dst) => {
  fs.mkdirSync(path.dirname(path.join(dist, dst)), { recursive: true });
  fs.copyFileSync(path.join(racine, src), path.join(dist, dst));
  return dst;
};

const fichiers = [];
for (const f of ["app.js", "stockage.js", "piano.js", "zip.js", "manuscrit.js", "edition.js", "connecteur.js", "synchro.js"]) fichiers.push(copier(`app/${f}`, f));
for (const f of fs.readdirSync(path.join(racine, "lecteur"))) fichiers.push(copier(`lecteur/${f}`, `lecteur/${f}`));
for (const f of fs.readdirSync(path.join(racine, "modeles")).filter((f) => /\.(json|pdf)$/.test(f))) fichiers.push(copier(`modeles/${f}`, `modeles/${f}`));
for (const f of fs.readdirSync(path.join(racine, "modeles/apercu")).filter((f) => f.endsWith(".svg"))) fichiers.push(copier(`modeles/apercu/${f}`, `modeles/apercu/${f}`));
for (const f of fs.readdirSync(path.join(racine, "app/piano")).filter((f) => /\.(mp3|json)$/.test(f))) fichiers.push(copier(`app/piano/${f}`, `piano/${f}`));
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  fichiers.push(copier(`node_modules/pdfjs-dist/legacy/build/${f}`, `vendor/pdfjs/${f}`));
  // Le publieur de claude.ai refuse les caractères de contrôle bruts (ESC…)
  // que pdf.js garde dans une table de données. Écrits \xNN, ils désignent
  // exactement le même caractère : le code ne change pas.
  const cible = path.join(dist, `vendor/pdfjs/${f}`);
  const texte = fs.readFileSync(cible, "latin1").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"));
  fs.writeFileSync(cible, texte, "latin1");
}
for (const f of fs.readdirSync(path.join(racine, "tests/pages")).filter((f) => f.endsWith(".pdf"))) fichiers.push(copier(`tests/pages/${f}`, `exemples/${f}`));

let page = fs.readFileSync(path.join(racine, "app/index.html"), "utf8");
if (autonome) {
  fichiers.push(copier("app/manifest.webmanifest", "manifest.webmanifest"));
  for (const f of fs.readdirSync(path.join(racine, "app/icones"))) fichiers.push(copier(`app/icones/${f}`, `icones/${f}`));
  // Le cache hors ligne porte l'empreinte du contenu : chaque version l'invalide.
  const empreinte = crypto.createHash("sha256");
  for (const f of [...fichiers].sort()) empreinte.update(fs.readFileSync(path.join(dist, f)));
  empreinte.update(page);
  const sw = fs.readFileSync(path.join(racine, "app/sw.js"), "utf8").replace("__VERSION__", empreinte.digest("hex").slice(0, 12));
  fs.writeFileSync(path.join(dist, "sw.js"), sw);
  fichiers.push("sw.js");
  page = [
    "<!doctype html>",
    '<html lang="fr"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="description" content="Tes partitions écrites à la main sur la reMarkable, lues, corrigées, jouées au piano et exportées en MIDI.">',
    '<meta name="theme-color" content="#2B48B0">',
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icones/icone.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="icones/icone-180.png">',
    "</head><body>",
    page,
    "</body></html>",
    "",
  ].join("\n");
}
fs.writeFileSync(path.join(dist, "index.html"), page);

// La liste des fichiers, dans le format que l'outil de publication attend.
const carte = Object.fromEntries(fichiers.map((f) => [f, path.join("dist", f)]));
fs.writeFileSync(path.join(racine, "dist.fichiers.json"), JSON.stringify(carte, null, 2) + "\n");
const taille = fichiers.reduce((a, f) => a + fs.statSync(path.join(dist, f)).size, 0);
console.log(`dist/ : index.html + ${fichiers.length} fichiers, ${(taille / 1024 / 1024).toFixed(2)} Mo${autonome ? " (page autonome)" : ""}`);
