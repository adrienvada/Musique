/**
 * LES DEUX ASSEMBLAGES, VÉRIFIÉS SANS NAVIGATEUR
 *
 * Le site (dist/, assemblé par `npm run e2e`) : sa page ne demande rien
 * d'ailleurs et porte sa CSP au tout début de <head> ; son service worker
 * garde exactement ce que la page demandera, sous la même adresse.
 *
 * La version claude.ai (assemblée ici dans un dossier temporaire) : rien de
 * ce que le publieur de claude.ai refuse (caractères de contrôle bruts), un
 * type connu pour chaque fichier, et la carte des fichiers complète.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DIST, RACINE, dossierTemporaire, listesDu, siteAssemble, versionDu } from "./commun.mjs";

siteAssemble();
const page = fs.readFileSync(path.join(DIST, "index.html"), "utf8");

test("le site : rien d'un autre domaine, la CSP en tête, le titre et les styles dans <head>", () => {
  const sansLiens = page.replace(/<a [^>]*>/g, "");
  assert.equal(/(?:src|href)="https?:\/\//.exec(sansLiens), null, "une ressource vient d'ailleurs");
  for (const f of fs.readdirSync(path.join(DIST, "styles"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(DIST, "styles", f), "utf8"), /https?:\/\/|@import/, `styles/${f}`);
  }
  assert.match(page, /^<!doctype html>\n<html lang="fr"><head><meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';/);
  const tete = page.slice(0, page.indexOf("</head>"));
  assert.match(tete, /<title>Portée<\/title>/);
  assert.equal((tete.match(/rel="stylesheet"/g) || []).length, (page.match(/rel="stylesheet"/g) || []).length, "une feuille de style hors de <head>");
  assert.match(tete, /<link rel="modulepreload" href="app\.js\?v=/);
  // Les icônes sont dans la page dès son arrivée.
  assert.match(page, /<body>\n<svg id="icones-portee"[^>]*><symbol id="i-/);
});

test("le site : le service worker garde exactement ce que la page demandera", () => {
  const version = versionDu(DIST);
  const { COQUILLE, EN_FOND, PIANO_FICHIERS } = listesDu(DIST);
  const gardes = new Set([...COQUILLE, ...EN_FOND]);
  // Chaque adresse gardée existe dans le site.
  for (const a of gardes) if (a !== "./") assert.ok(fs.existsSync(path.join(DIST, a.split("?")[0])), a);
  // Ce que la page appelle (scripts, styles, modules préchargés, manifeste, icônes).
  for (const [, a] of page.matchAll(/(?:src|href)="([^"#:]+)"/g)) assert.ok(gardes.has(a), `la page appelle ${a}, que le service worker ne garde pas`);
  // Ce que les modules importent, de module en module.
  for (const a of gardes) {
    if (!/\.js\?v=/.test(a)) continue;
    const texte = fs.readFileSync(path.join(DIST, a.split("?")[0]), "utf8");
    for (const [, cible] of texte.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g)) {
      const absolue = path.posix.normalize(path.posix.join(path.posix.dirname(a), cible));
      assert.ok(gardes.has(absolue), `${a} importe ${cible}, que le service worker ne garde pas`);
    }
  }
  // Ce que les feuilles de style appellent (les polices).
  const polices = fs.readFileSync(path.join(DIST, "styles/polices.css"), "utf8");
  for (const [, url] of polices.matchAll(/url\("\.\.\/([^"]+)"\)/g)) assert.ok(gardes.has(url), url);
  // Les modules de la version portent sa version ; pdf.js, abcjs et les polices, celle de leur paquet.
  assert.ok(COQUILLE.includes(`app.js?v=${version}`));
  const paquet = (nom) => JSON.parse(fs.readFileSync(path.join(RACINE, "node_modules", nom, "package.json"), "utf8")).version;
  assert.deepEqual(EN_FOND, [`vendor/pdfjs/pdf.min.mjs?v=${paquet("pdfjs-dist")}`, `vendor/pdfjs/pdf.worker.min.mjs?v=${paquet("pdfjs-dist")}`]);
  assert.ok(COQUILLE.includes(`vendor/abcjs/abcjs-basic-min.js?v=${paquet("abcjs")}`));
  // Le piano, tout entier, dans son cache à lui.
  assert.deepEqual(PIANO_FICHIERS, fs.readdirSync(path.join(DIST, "piano")).map((f) => `piano/${f}`).sort());
});

test("la version claude.ai : publiable telle quelle", () => {
  const sortie = path.join(dossierTemporaire("claude"), "claude");
  execFileSync(process.execPath, [path.join(RACINE, "outils/assembler-appli.mjs"), "--sortie", sortie], { stdio: "pipe" });
  const carte = JSON.parse(fs.readFileSync(`${sortie}.fichiers.json`, "utf8"));
  const fichiers = fs.readdirSync(sortie, { recursive: true }).filter((f) => fs.statSync(path.join(sortie, f)).isFile() && f !== "index.html");
  // La carte nomme chaque fichier, et rien d'autre.
  assert.deepEqual(Object.keys(carte).sort(), fichiers.map((f) => f.split(path.sep).join("/")).sort());
  // abcjs et les polices voyagent avec elle ; ni service worker, ni CSP, ni manifeste (claude.ai a les siens).
  for (const f of ["vendor/abcjs/abcjs-basic-min.js", "vendor/abcjs/LICENCE.txt", "polices/ibm-plex-sans-latin-400-normal.woff2", "polices/LICENCE-IBM-Plex-Sans-OFL.txt"]) assert.ok(carte[f], f);
  for (const f of ["sw.js", "manifest.webmanifest"]) assert.equal(carte[f], undefined, f);
  const fragment = fs.readFileSync(path.join(sortie, "index.html"), "utf8");
  assert.doesNotMatch(fragment, /Content-Security-Policy|<!doctype|<head>/i);
  assert.match(fragment, /^<title>Portée<\/title>/);
  // Le publieur refuse les caractères de contrôle bruts dans un fichier texte.
  const TYPES = { ".js": "text", ".mjs": "text", ".css": "text", ".json": "text", ".svg": "text", ".txt": "text", ".html": "text", ".pdf": "binaire", ".mp3": "binaire", ".woff2": "binaire", ".png": "binaire" };
  for (const f of [...fichiers, "index.html"]) {
    const genre = TYPES[path.extname(f)];
    assert.ok(genre, `${f} : un type de fichier que le publieur ne connaît peut-être pas`);
    // eslint-disable-next-line no-control-regex -- ce sont justement eux qu'on cherche
    if (genre === "text") assert.doesNotMatch(fs.readFileSync(path.join(sortie, f), "latin1"), /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/, f);
  }
});
