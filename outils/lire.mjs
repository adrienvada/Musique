/**
 * LIRE UNE PAGE EN LIGNE DE COMMANDE
 *
 *   npm run lire -- tests/pages/2026-09-30-piano-standard.pdf [--svg]
 *
 * Affiche l'ABC et les doutes. Avec --svg, écrit à côté du PDF une image
 * de contrôle où chaque trait est coloré selon ce que le lecteur en a
 * compris (têtes, hampes, ligatures, barres, signes…).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { lireDocument } from "../lecteur/extraction.js";
import { lirePartition } from "../lecteur/partition.js";
import { ajuster, fichierCalibration, identifierModele, recaler, verifierVersion } from "../lecteur/modeles.js";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Les calibrations en cours des modèles du dépôt (modeles/<id>.json), pour reconnaître une page. */
export function calibrationsConnues() {
  const dossier = path.join(racine, "modeles");
  return fs.readdirSync(dossier).filter((f) => /^[a-z0-9-]+\.json$/.test(f) && !/-v\d+\.json$/.test(f) && f !== "index.json")
    .map((f) => JSON.parse(fs.readFileSync(path.join(dossier, f), "utf8")));
}

/**
 * La calibration d'un modèle à sa version (modeles/<id>-v<N>.json), ou celle
 * en cours si c'est la même version. Un modèle ou une version inconnus : un
 * message clair plutôt qu'un ENOENT, et jamais la calibration d'une autre version.
 */
export function chargerCalibration(modele, version) {
  const dossier = path.join(racine, "modeles");
  const v = version || 1;
  const versionnee = path.join(dossier, fichierCalibration(modele, v));
  if (fs.existsSync(versionnee)) return JSON.parse(fs.readFileSync(versionnee, "utf8"));
  const courante = path.join(dossier, fichierCalibration(modele, null));
  if (!fs.existsSync(courante)) throw new Error(`Cette page a été écrite sur le modèle « ${modele} », que cette version de Portée ne connaît pas.`);
  const cal = JSON.parse(fs.readFileSync(courante, "utf8"));
  verifierVersion(cal, { modele, version: v });
  return cal;
}

/**
 * Lit un PDF exporté de la tablette. Le modèle vient du sujet du PDF ; ses
 * lignes grises le confirment, le trouvent quand le sujet manque, et
 * l'emportent quand il se trompe (`avertissement` le dit). Chaque page est
 * recalée sur ses lignes grises quand elles ont bougé.
 */
export async function lireFichier(chemin, { gabarits = null } = {}) {
  const data = new Uint8Array(fs.readFileSync(chemin));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const lu = await lireDocument(pdfjs, doc);
  let { modele, version } = lu;
  let avertissement = null;
  const reconnu = lu.pages.length ? identifierModele(lu.pages[0], calibrationsConnues()) : null;
  if (reconnu && reconnu.cal.modele !== modele) {
    avertissement = modele
      ? `Le PDF dit « ${modele} », mais ses lignes sont celles de « ${reconnu.cal.modele} » : lu avec « ${reconnu.cal.modele} ».`
      : `Le PDF ne dit pas son modèle ; ses lignes sont celles de « ${reconnu.cal.modele} ».`;
    modele = reconnu.cal.modele;
    version = reconnu.cal.version;
  }
  if (!modele) throw new Error(`${chemin} n'a pas été écrit sur un modèle Portée`);
  let cal;
  try { cal = chargerCalibration(modele, version); } catch (e) { throw new Error(`${chemin} : ${e.message}`, { cause: e }); }
  const titre = path.basename(chemin, ".pdf");
  const traits = lu.pages.map((p) => { const t = ajuster(p, cal); return t && t.ecart < 1.5 ? recaler(p.traits, t) : p.traits; });
  return { ...lirePartition(traits, cal, { titre, gabarits }), cal, pages: lu.pages, modele, version, avertissement };
}

const COULEURS = {
  tete: "#1f4fd1", hampe: "#0a8a3a", ligature: "#c05600", barre: "#7a2bb5",
  crochet: "#d1006f", point: "#555", "point-duree": "#d1006f", "point-reprise": "#7a2bb5",
  soupir: "#00838f", "demi-soupir": "#00838f", "bemol-armure": "#8a6d00", "diese-armure": "#8a6d00",
  bemol: "#8a6d00", diese: "#8a6d00", becarre: "#8a6d00", entete: "#999", articulation: "#bbb",
  liaison: "#bbb", "hors-portee": "#bbb", inconnu: "#e00000",
  "ligne-sup": "#7a7a7a", "liaison-duree": "#0a8a3a", "hampe-seule": "#e00000", "triolet?": "#d1006f",
  "quart-soupir": "#00838f", chiffre: "#999",
};

export function svgControle(res, numeroPage = 0) {
  const { cal } = res;
  const lue = res.lues[numeroPage];
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1404 1872" width="1404" height="1872" style="background:#fff">`];
  for (const s of cal.systemes) for (const p of s.portees) for (const y of p.lignes) out.push(`<line x1="${cal.x_debut}" x2="${cal.x_fin}" y1="${y}" y2="${y}" stroke="#ccc" stroke-width="2"/>`);
  const couleurTrait = new Map();
  lue.tetes.forEach((t) => t.traits.forEach((id) => couleurTrait.set(id, "tete")));
  const segs = [];
  for (const h of lue.hampes) segs.push([h.seg, "hampe"]);
  for (const l of lue.ligatures) segs.push([l.seg, "ligature"]);
  for (const b of lue.barres) out.push(`<line x1="${b.x}" x2="${b.x}" y1="${b.y0}" y2="${b.y1}" stroke="${COULEURS.barre}" stroke-width="7" opacity=".5"/>`);
  for (const t of lue.traits) {
    const c = couleurTrait.get(t.id);
    out.push(`<polyline points="${t.points.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${c ? COULEURS[c] : "#000"}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const [s, r] of segs) out.push(`<line x1="${s.a[0]}" y1="${s.a[1]}" x2="${s.b[0]}" y2="${s.b[1]}" stroke="${COULEURS[r]}" stroke-width="6" opacity=".75"/>`);
  for (const g of lue.signes) {
    const c = COULEURS[g.nature] || "#e00000";
    out.push(`<polyline points="${g.points.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="5" opacity=".8"/>`);
    out.push(`<text x="${g.x0}" y="${g.y1 + 16}" font-size="13" fill="${c}" font-family="sans-serif">${g.nature}</text>`);
  }
  for (const t of lue.tetes) out.push(`<text x="${t.x0}" y="${t.y0 - 4}" font-size="14" fill="${COULEURS.tete}" font-family="sans-serif">${t.nom || ""}</text>`);
  for (const d of res.doutes.filter((d) => d.page === numeroPage + 1)) {
    const b = d.boite;
    out.push(`<rect x="${b.x0 - 6}" y="${b.y0 - 6}" width="${b.x1 - b.x0 + 12}" height="${b.y1 - b.y0 + 12}" fill="#ffd400" opacity=".35"/>`);
  }
  out.push("</svg>");
  return out.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const svg = args.includes("--svg");
  // --gabarits fichier.json : tes gabarits (page d'étalonnage, corrections), pour lire avec eux (L16).
  const g = args.indexOf("--gabarits");
  const gabarits = g >= 0 ? JSON.parse(fs.readFileSync(args[g + 1], "utf8")) : null;
  for (const f of args.filter((a, i) => !a.startsWith("--") && (g < 0 || i !== g + 1))) {
    let res;
    try { res = await lireFichier(f, { gabarits }); } catch (e) { console.error(`\n=== ${f}\n  ${e.message}`); process.exitCode = 1; continue; }
    console.log(`\n=== ${f}\n${res.abc}`);
    if (res.avertissement) console.log(`  attention : ${res.avertissement}`);
    for (const d of res.doutes) console.log(`  doute ${d.id} p${d.page} portée ${d.portee + 1}${d.mesure ? ` mesure ${d.mesure}` : ""} : ${d.message}`);
    if (svg) {
      res.lues.forEach((_, i) => {
        const sortie = f.replace(/\.pdf$/, `-controle-p${i + 1}.svg`);
        fs.writeFileSync(sortie, svgControle(res, i));
        console.log(`  contrôle : ${sortie}`);
      });
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
