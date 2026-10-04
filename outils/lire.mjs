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

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function lireFichier(chemin) {
  const data = new Uint8Array(fs.readFileSync(chemin));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const lu = await lireDocument(pdfjs, doc);
  if (!lu.modele) throw new Error(`${chemin} n'a pas été écrit sur un modèle Portée`);
  const fichier = path.join(racine, "modeles", `${lu.modele}.json`);
  // Un nom de modèle que ce dépôt ne connaît pas : un message clair plutôt qu'un ENOENT.
  if (!fs.existsSync(fichier)) throw new Error(`${chemin} a été écrit sur le modèle « ${lu.modele} », que cette version de Portée ne connaît pas.`);
  const cal = JSON.parse(fs.readFileSync(fichier, "utf8"));
  const titre = path.basename(chemin, ".pdf");
  return { ...lirePartition(lu.pages.map((p) => p.traits), cal, { titre }), cal, pages: lu.pages, modele: lu.modele, version: lu.version };
}

const COULEURS = {
  tete: "#1f4fd1", hampe: "#0a8a3a", ligature: "#c05600", barre: "#7a2bb5",
  crochet: "#d1006f", point: "#555", "point-duree": "#d1006f", "point-reprise": "#7a2bb5",
  soupir: "#00838f", "demi-soupir": "#00838f", "bemol-armure": "#8a6d00", "diese-armure": "#8a6d00",
  bemol: "#8a6d00", diese: "#8a6d00", becarre: "#8a6d00", entete: "#999", articulation: "#bbb",
  liaison: "#bbb", "hors-portee": "#bbb", inconnu: "#e00000",
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
  for (const f of args.filter((a) => !a.startsWith("--"))) {
    const res = await lireFichier(f);
    console.log(`\n=== ${f}\n${res.abc}`);
    for (const d of res.doutes) console.log(`  doute p${d.page} portée ${d.portee + 1}${d.mesure ? ` mesure ${d.mesure}` : ""} : ${d.message}`);
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
