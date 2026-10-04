/**
 * ASSEMBLER L'APPLI DANS dist/
 *
 *   npm run appli                 → dist/ prêt à publier sur claude.ai
 *   npm run appli -- --autonome   → dist/ pour GitHub Pages : page complète
 *                                   (<!doctype>…), installable, hors ligne
 *   … --sortie <dossier>          → ailleurs que dist/ (les essais de bout en
 *                                   bout, tests/e2e/) ; la carte des fichiers
 *                                   va alors dans <dossier>.fichiers.json
 *
 * L'appli a besoin, à côté de sa page : de ses modules (app/), du lecteur
 * (lecteur/), des modèles (calibrations, PDF à télécharger, aperçus), du
 * piano (app/piano/), de pdf.js et d'abcjs (copiés depuis node_modules,
 * versions figées par package.json), de ses polices (les paquets
 * @fontsource, voir app/styles/polices.css) et des pages d'essai
 * (tests/pages/), qu'on peut importer d'un clic. En autonome s'ajoutent le
 * manifeste, les icônes et le service worker (hors ligne), dont le cache
 * change avec le contenu.
 *
 * abcjs et les polices venaient de CDN (cdnjs, Google Fonts) : servis par
 * le site, ils ne dépendent plus d'un tiers, ne donnent plus l'adresse IP
 * des visiteurs à Google, et la gravure marche hors ligne dès la première
 * visite (audit du 04/10, S2). Le site porte en plus une politique de
 * sécurité du contenu (CSP, plus bas) : sans domaine extérieur à autoriser,
 * elle peut être stricte.
 *
 * Pour un premier affichage rapide au téléphone, la page arrive avec ce
 * dont elle a besoin tout de suite : le jeu d'icônes déjà écrit (avant, les
 * icônes n'apparaissaient qu'une fois les modules chargés, quatre secondes
 * sur un téléphone lent), et la liste de ses modules en `modulepreload`
 * (le navigateur les demande tous d'un coup, au lieu de les découvrir
 * import après import).
 *
 * En autonome encore, chaque module et chaque feuille de style porte la
 * version dans son adresse (`idee.js?v=…`). GitHub Pages laisse les fichiers
 * dix minutes dans le cache du navigateur, et un rechargement reprend même
 * les modules gardés en mémoire sans rien demander : juste après une mise
 * en ligne, la page neuve tournait avec des modules anciens, et l'éditeur
 * plantait (02/10). Une adresse neuve à chaque version, et aucun cache ne
 * peut plus mélanger deux versions. Les fichiers tiers (pdf.js, abcjs, les
 * polices) portent la version de leur paquet : leur adresse ne change que
 * s'ils changent, le service worker les garde d'une version à l'autre sans
 * les retélécharger.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jeuDIcones } from "../app/icones.js";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const autonome = args.includes("--autonome");
const sortieDemandee = (() => {
  const i = args.findIndex((a) => a === "--sortie" || a.startsWith("--sortie="));
  if (i < 0) return null;
  const valeur = args[i].includes("=") ? args[i].slice("--sortie=".length) : args[i + 1];
  if (!valeur) throw new Error("--sortie : il manque le dossier");
  return path.resolve(valeur);
})();
const dist = sortieDemandee || path.join(racine, "dist");

/**
 * La politique de sécurité du contenu du site. Elle ferme la porte une
 * seconde fois à un texte qui entrerait dans la page sans être échappé (S1) :
 * aucun script en ligne, aucun gestionnaire `onerror=`, rien d'un autre
 * domaine. Chaque permission a sa raison :
 *  - style 'unsafe-inline' : la grille et abcjs placent leurs éléments par
 *    l'attribut `style` (un style ne peut pas exécuter de code) ;
 *  - img et media data: blob: : les aperçus, le mémo vocal qu'on réécoute ;
 *  - worker 'self' blob: : le worker de pdf.js ;
 *  - connect https://*.supabase.co : le connecteur « Portée reMarkable »,
 *    dont l'adresse se colle dans chaque navigateur (elle n'est pas dans le
 *    code) : seul le domaine de Supabase est connu d'avance ;
 *  - form-action 'none' : aucun formulaire n'envoie quoi que ce soit (la
 *    fenêtre de l'appli se ferme par `method="dialog"`, sans envoi).
 * En <meta> (GitHub Pages ne laisse pas choisir ses en-têtes), au tout début
 * de <head> : elle ne protège que ce qui vient après elle. La version
 * claude.ai n'en porte pas : claude.ai pose la sienne sur l'artefact.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "connect-src 'self' https://*.supabase.co",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Ce que dit Portée d'elle-même (moteurs de recherche, partage d'un lien) : le carnet d'abord, la tablette ensuite. */
const DESCRIPTION = "Ton carnet d'idées musicales : note une mélodie au clavier ou en la chantant, écoute-la au piano, envoie-la en MIDI vers Ableton. Tes pages écrites sur la reMarkable y sont lues et corrigées.";

fs.rmSync(dist, { recursive: true, force: true });
const copier = (src, dst) => {
  fs.mkdirSync(path.dirname(path.join(dist, dst)), { recursive: true });
  fs.copyFileSync(path.join(racine, src), path.join(dist, dst));
  return dst;
};
/**
 * Copie un script tiers. Le publieur de claude.ai refuse les caractères de
 * contrôle bruts (ESC…) que pdf.js et abcjs gardent dans leurs chaînes.
 * Écrits \xNN, ils désignent exactement le même caractère : le code ne
 * change pas.
 */
const copierScript = (src, dst) => {
  copier(src, dst);
  const cible = path.join(dist, dst);
  // eslint-disable-next-line no-control-regex -- ce sont justement eux qu'on cherche
  const texte = fs.readFileSync(cible, "latin1").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"));
  fs.writeFileSync(cible, texte, "latin1");
  return dst;
};
const versionDuPaquet = (paquet) => JSON.parse(fs.readFileSync(path.join(racine, "node_modules", paquet, "package.json"), "utf8")).version;
const lire = (f) => fs.readFileSync(path.join(dist, f), "utf8");
const ecrire = (f, texte) => fs.writeFileSync(path.join(dist, f), texte);

const fichiers = [];
// Tous les modules de l'appli (sw.js à part : il n'existe que sur le site).
for (const f of fs.readdirSync(path.join(racine, "app")).filter((f) => f.endsWith(".js") && f !== "sw.js").sort()) fichiers.push(copier(`app/${f}`, f));
// Une feuille de style par écran, le système commun (styles/systeme.css) et les polices.
for (const f of fs.readdirSync(path.join(racine, "app/styles")).filter((f) => f.endsWith(".css")).sort()) fichiers.push(copier(`app/styles/${f}`, `styles/${f}`));
for (const f of fs.readdirSync(path.join(racine, "lecteur"))) fichiers.push(copier(`lecteur/${f}`, `lecteur/${f}`));
for (const f of fs.readdirSync(path.join(racine, "modeles")).filter((f) => /\.(json|pdf)$/.test(f))) fichiers.push(copier(`modeles/${f}`, `modeles/${f}`));
for (const f of fs.readdirSync(path.join(racine, "modeles/apercu")).filter((f) => f.endsWith(".svg"))) fichiers.push(copier(`modeles/apercu/${f}`, `modeles/apercu/${f}`));
for (const f of fs.readdirSync(path.join(racine, "app/piano")).filter((f) => /\.(mp3|json)$/.test(f))) fichiers.push(copier(`app/piano/${f}`, `piano/${f}`));
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) fichiers.push(copierScript(`node_modules/pdfjs-dist/legacy/build/${f}`, `vendor/pdfjs/${f}`));
// abcjs (MIT) : sa licence demande que la notice accompagne le code.
fichiers.push(copierScript("node_modules/abcjs/dist/abcjs-basic-min.js", "vendor/abcjs/abcjs-basic-min.js"));
fichiers.push(copier("node_modules/abcjs/LICENSE.md", "vendor/abcjs/LICENCE.txt"));
// Les polices : exactement les fichiers que nomme styles/polices.css, et le
// texte de leur licence (SIL OFL 1.1), qui doit voyager avec elles.
const PAQUETS_POLICES = [["young-serif-", "@fontsource/young-serif", "Young-Serif"], ["ibm-plex-sans-", "@fontsource/ibm-plex-sans", "IBM-Plex-Sans"], ["ibm-plex-mono-", "@fontsource/ibm-plex-mono", "IBM-Plex-Mono"]];
const paquetDeLaPolice = (f) => {
  const paquet = PAQUETS_POLICES.find(([prefixe]) => f.startsWith(prefixe));
  if (!paquet || !f.endsWith(".woff2")) throw new Error(`polices.css : ${f} ne vient d'aucun paquet @fontsource connu`);
  return paquet[1];
};
const POLICE = /url\("\.\.\/polices\/([^"]+)"\)/g;
const polices = new Set([...lire("styles/polices.css").matchAll(POLICE)].map((m) => m[1]));
if (!polices.size) throw new Error("polices.css : aucune police nommée");
for (const f of [...polices].sort()) fichiers.push(copier(`node_modules/${paquetDeLaPolice(f)}/files/${f}`, `polices/${f}`));
for (const [, paquet, nom] of PAQUETS_POLICES) fichiers.push(copier(`node_modules/${paquet}/LICENSE`, `polices/LICENCE-${nom}-OFL.txt`));
for (const f of fs.readdirSync(path.join(racine, "tests/pages")).filter((f) => f.endsWith(".pdf"))) fichiers.push(copier(`tests/pages/${f}`, `exemples/${f}`));

let page = fs.readFileSync(path.join(racine, "app/index.html"), "utf8");
// Plus rien d'un CDN : la page ne charge que ses propres fichiers.
// (Un lien <a> qu'on suit d'un toucher, comme my.remarkable.com, n'est pas une ressource.)
const externe = /(?:src|href)="https?:\/\/[^"]+"/.exec(page.replace(/<a [^>]*>/g, ""));
if (externe) throw new Error(`index.html : une ressource vient encore d'ailleurs (${externe[0]})`);

// Ce qui va dans <head> : le titre et les feuilles de style, en tête du
// fichier ; le reste est le corps de la page.
const lignes = page.split("\n");
let n = 0;
while (n < lignes.length && /^\s*(?:<title>.*<\/title>|<link [^>]*>|<!--.*-->|)\s*$/.test(lignes[n])) n++;
let tete = lignes.slice(0, n).join("\n").trim();
let corps = lignes.slice(n).join("\n");
if (!tete.includes("<title>") || /<link rel="stylesheet"/.test(corps)) throw new Error("index.html : le titre et les feuilles de style doivent ouvrir le fichier");

// Les modules que la page charge d'emblée : app.js et tout ce qu'il importe,
// de proche en proche (pas les imports dynamiques, comme pdf.js, chargés à
// la demande).
const modules = [];
for (const file = ["app.js"]; file.length;) {
  const f = file.shift();
  if (modules.includes(f)) continue;
  modules.push(f);
  for (const m of lire(f).matchAll(/(?:\bfrom|\bimport)\s+(["'])(\.\.?\/[^"']+?\.js)\1/g)) file.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[2])));
}

let version = null;
if (autonome) {
  fichiers.push(copier("app/manifest.webmanifest", "manifest.webmanifest"));
  for (const f of fs.readdirSync(path.join(racine, "app/icones"))) fichiers.push(copier(`app/icones/${f}`, `icones/${f}`));
  // Le cache hors ligne porte l'empreinte du contenu, service worker
  // compris : chaque version l'invalide.
  const source = fs.readFileSync(path.join(racine, "app/sw.js"), "utf8");
  const empreinte = crypto.createHash("sha256");
  for (const f of [...fichiers].sort()) empreinte.update(f).update(fs.readFileSync(path.join(dist, f)));
  empreinte.update(page).update(source);
  version = empreinte.digest("hex").slice(0, 12);

  // La version dans l'adresse des modules : tous les imports relatifs, sans
  // exception (un module importé sous deux adresses serait chargé deux fois,
  // avec deux états).
  const IMPORT = /((?:\bfrom|\bimport)\s*\(?\s*)(["'])(\.\.?\/[^"']+?\.js)\2/g;
  for (const f of fichiers.filter((f) => f.endsWith(".js") && !f.startsWith("vendor/"))) {
    const texte = lire(f).replace(IMPORT, `$1$2$3?v=${version}$2`);
    const oublie = /(?:\bfrom|\bimport)\s*\(?\s*["']\.\.?\/[^"'?]+?\.js["']/.exec(texte);
    if (oublie) throw new Error(`${f} : un import sans version (${oublie[0]})`);
    ecrire(f, texte);
  }
  // Les fichiers tiers portent la version de leur paquet : pdf.js (son
  // module et son worker, appelés par app.js), abcjs (la page), les polices
  // (polices.css).
  const pdfjs = versionDuPaquet("pdfjs-dist");
  let app = lire("app.js");
  for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
    const adresse = `"./vendor/pdfjs/${f}"`;
    if (!app.includes(adresse)) throw new Error(`app.js : ${adresse} introuvable (pdf.js a changé de place ?)`);
    app = app.replaceAll(adresse, `"./vendor/pdfjs/${f}?v=${pdfjs}"`);
  }
  ecrire("app.js", app);
  ecrire("styles/polices.css", lire("styles/polices.css").replace(POLICE, (_, f) => `url("../polices/${f}?v=${versionDuPaquet(paquetDeLaPolice(f))}")`));
  const ABCJS = 'src="vendor/abcjs/abcjs-basic-min.js"';
  if (!corps.includes(ABCJS)) throw new Error("index.html : abcjs introuvable");
  corps = corps.replace(ABCJS, `src="vendor/abcjs/abcjs-basic-min.js?v=${versionDuPaquet("abcjs")}"`);
  tete = tete.replace(/(<link rel="stylesheet" href=")(styles\/[^"]+\.css)(")/g, `$1$2?v=${version}$3`);
  corps = corps.replace(/(<script type="module" src=")(app\.js)(")/, `$1$2?v=${version}$3`);
  if (!corps.includes(`app.js?v=${version}`)) throw new Error("index.html : app.js sans version");

  // Le service worker reçoit la liste exacte de ce qu'il garde, sous
  // l'adresse que la page demandera (version comprise). À l'installation :
  // la page (./) et tout ce qu'il faut pour l'ouvrir hors ligne. En tâche de
  // fond, une fois l'appli ouverte : pdf.js (1,8 Mo, seulement pour importer
  // un PDF). Le piano a son propre cache, d'après sa propre empreinte : lourd,
  // il ne se retélécharge que s'il change. Les licences n'y sont pas : l'appli
  // ne les demande jamais.
  const adresse = (f) => {
    if (f.startsWith("vendor/pdfjs/")) return `${f}?v=${pdfjs}`;
    if (f.startsWith("vendor/abcjs/")) return `${f}?v=${versionDuPaquet("abcjs")}`;
    if (f.startsWith("polices/")) return `${f}?v=${versionDuPaquet(paquetDeLaPolice(path.posix.basename(f)))}`;
    if ((f.endsWith(".js") && !f.startsWith("vendor/")) || (f.startsWith("styles/") && f.endsWith(".css"))) return `${f}?v=${version}`;
    return f;
  };
  const piano = fichiers.filter((f) => f.startsWith("piano/")).sort();
  const empreintePiano = crypto.createHash("sha256");
  for (const f of piano) empreintePiano.update(f).update(fs.readFileSync(path.join(dist, f)));
  const gardes = fichiers.filter((f) => !f.startsWith("piano/") && !/\/LICENCE[^/]*\.txt$/.test(f));
  const enFond = gardes.filter((f) => f.startsWith("vendor/pdfjs/")).map(adresse);
  const coquille = ["./", ...gardes.filter((f) => !f.startsWith("vendor/pdfjs/")).map(adresse)];
  const sw = source
    .replace('"__VERSION__"', JSON.stringify(version))
    .replace('["__COQUILLE__"]', JSON.stringify(coquille))
    .replace('["__EN_FOND__"]', JSON.stringify(enFond))
    .replace('"__PIANO__"', JSON.stringify(empreintePiano.digest("hex").slice(0, 12)))
    .replace('["__PIANO_FICHIERS__"]', JSON.stringify(piano));
  if (/__[A-Z_]+__/.test(sw)) throw new Error("sw.js : une valeur n'a pas été remplie");
  ecrire("sw.js", sw);
  fichiers.push("sw.js");
}

// La page : le jeu d'icônes en tête du corps (icones.js, la seule source ;
// injecterIcones() ne le double pas), et la liste des modules à précharger
// après les feuilles de style, avec la version de leur adresse.
const precharger = modules.map((f) => `<link rel="modulepreload" href="${f}${version ? `?v=${version}` : ""}">`).join("\n");
corps = `${jeuDIcones()}\n${corps}`;
if (autonome) {
  page = [
    "<!doctype html>",
    '<html lang="fr"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    `<meta name="description" content="${DESCRIPTION}">`,
    // La couleur de la barre du navigateur suit celle de Portée : le papier clair, ou sombre.
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#EDEEEA">',
    '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#17181B">',
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icones/icone.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="icones/icone-180.png">',
    tete,
    precharger,
    "</head><body>",
    corps.trim(),
    "</body></html>",
    "",
  ].join("\n");
} else {
  // claude.ai enveloppe la page dans son propre document : elle reste un fragment.
  page = [tete, precharger, corps.trim(), ""].join("\n");
}
ecrire("index.html", page);

// La liste des fichiers, dans le format que l'outil de publication attend
// (chemins relatifs au dépôt, d'où l'on publie).
const carte = Object.fromEntries(fichiers.map((f) => [f, path.relative(racine, path.join(dist, f))]));
fs.writeFileSync(`${dist}.fichiers.json`, JSON.stringify(carte, null, 2) + "\n");
const taille = fichiers.reduce((a, f) => a + fs.statSync(path.join(dist, f)).size, 0);
console.log(`${path.relative(racine, dist) || "."}/ : index.html + ${fichiers.length} fichiers, ${(taille / 1024 / 1024).toFixed(2)} Mo${autonome ? " (page autonome)" : ""}`);
