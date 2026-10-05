/**
 * LE BANC D'ESSAI DU LECTEUR (L17)
 *
 *   node outils/banc-lecteur.mjs ma-sauvegarde.json [--gabarits g.json] [--detail] [--json]
 *
 * Pour chaque page lue que tu as marquée « Prête » dans une sauvegarde de
 * Portée (Réglages → Sauvegarder), le banc relit ses traits avec le lecteur
 * d'aujourd'hui et compare ce qu'il lit à l'ABC que tu as validé. Il compte,
 * à part : les erreurs de hauteur (la note qui sonne, armure et altérations
 * comprises), de durée, les notes manquantes ou en trop, les barres de
 * mesure mal placées ; la part des erreurs qui ne lèvent aucun doute (les
 * erreurs silencieuses, les pires : rien ne te dit de regarder là) ; et la
 * précision des doutes (combien désignent une vraie erreur).
 *
 * POURQUOI. Les seuils du lecteur ont été réglés sur deux pages. Un réglage
 * qui améliore ces deux pages peut en abîmer d'autres : seul un banc sur
 * tes pages validées le dit. Lance-le avant et après un changement du
 * lecteur ; --json donne les chiffres à comparer.
 *
 * RIEN N'EST ÉCRIT : tout s'affiche dans le terminal. Ta sauvegarde (tes
 * pages, tes partitions) ne doit pas entrer dans le dépôt, qui est public.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lirePartition, VERSION_LECTEUR } from "../lecteur/partition.js";
import { decompacter } from "../app/stockage.js";
import * as ed from "../app/edition.js";
import { chargerCalibration } from "./lire.mjs";

// ------------------------------------------------------------------------
// Les événements d'un ABC : notes, silences, barres, voix par voix
// ------------------------------------------------------------------------

const BARRE = /^(:*\|+\]?:*|::|:+)/;

/**
 * Les événements de chaque voix d'un ABC (Map voix → liste), dans l'ordre :
 * { genre: note|silence|barre, t (en croches depuis le début de la voix),
 *   croches (ce qu'il dure, triolets compris), midi (les hauteurs qui
 *   sonnent), debut, fin (sa place dans l'ABC) }. Les silences invisibles
 *   (« x », qui complètent une voix) font passer le temps sans compter.
 */
export function evenementsDe(abc) {
  const voix = new Map();
  let p = 0;
  for (const texte of abc.split("\n")) {
    const debutLigne = p;
    p += texte.length + 1;
    if (/^[A-Za-z]:|^%/.test(texte) || !texte.trim()) continue;
    const v = /^\[V:\s*([^\]\s]+)\]\s*/.exec(texte);
    const nom = v ? v[1] : "1";
    if (!voix.has(nom)) voix.set(nom, { t: 0, evs: [] });
    const courante = voix.get(nom);
    let pos = v ? v[0].length : 0, triolet = 0;
    while (pos < texte.length) {
      const c = texte[pos];
      if (c === " " || c === "-") { pos++; continue; }
      const champ = /^\[[A-Za-z]:[^\]]*\]/.exec(texte.slice(pos));
      if (champ) { pos += champ[0].length; continue; }
      const barre = BARRE.exec(texte.slice(pos));
      if (barre) {
        courante.evs.push({ genre: "barre", t: courante.t, debut: debutLigne + pos, fin: debutLigne + pos + barre[0].length });
        pos += barre[0].length;
        continue;
      }
      if (texte.startsWith("(3", pos)) { triolet = 3; pos += 2; continue; }
      const j = ed.lireJeton(abc, debutLigne + pos);
      if (!j || j.fin <= debutLigne + pos) { pos++; continue; }
      const croches = triolet ? (j.croches * 2) / 3 : j.croches;
      if (triolet) triolet--;
      if (!j.invisible) {
        courante.evs.push({
          genre: j.type === "silence" ? "silence" : "note", t: courante.t, croches,
          midi: j.type === "silence" ? [] : [...ed.hauteursMidiA(abc, j)].sort((a, b) => a - b), debut: j.debut, fin: j.fin,
        });
      }
      courante.t += croches;
      pos = j.fin - debutLigne;
    }
  }
  return new Map([...voix].map(([k, x]) => [k, x.evs]));
}

// ------------------------------------------------------------------------
// Aligner ce que tu as validé et ce que le lecteur lit
// ------------------------------------------------------------------------

const memes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const presque = (a, b) => Math.abs(a - b) < 1e-6;

/** Ce qui diffère entre deux événements alignés : [] s'ils sont pareils. */
function ecarts(v, l) {
  if (v.genre !== l.genre) return ["nature"];
  const e = [];
  if (v.genre === "note" && !memes(v.midi, l.midi)) e.push("hauteur");
  if (!presque(v.croches, l.croches)) e.push("duree");
  return e;
}

/**
 * L'alignement des deux suites de notes et silences (distance d'édition) :
 * des paires [validé, lu], l'un des deux null pour une note manquante ou en
 * trop. Une note fausse coûte moins qu'une note retirée puis remise, pour
 * qu'une seule erreur ne décale pas tout ce qui suit.
 */
export function aligner(valides, lus) {
  const n = valides.length, m = lus.length;
  const cout = (v, l) => { const e = ecarts(v, l); return !e.length ? 0 : e.length === 1 && e[0] !== "nature" ? 1 : 1.5; };
  const d = Array.from({ length: n + 1 }, (_, i) => Float64Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cout(valides[i - 1], lus[j - 1]));
  }
  const paires = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && presque(d[i][j], d[i - 1][j - 1] + cout(valides[i - 1], lus[j - 1]))) { paires.push([valides[--i], lus[--j]]); continue; }
    if (i > 0 && presque(d[i][j], d[i - 1][j] + 1)) { paires.push([valides[--i], null]); continue; }
    paires.push([null, lus[--j]]);
  }
  return paires.reverse();
}

// ------------------------------------------------------------------------
// Comparer une page
// ------------------------------------------------------------------------

/** Les zones de l'ABC lu que vise un doute : sa note ou sa mesure, ses lignes, les notes autour. */
const zonesDe = (d) => ["cible", "cibleLigne", "cibleSuivante", "ciblePrecedente", "cibleAccord"].map((k) => d[k]).filter(Boolean);
const touche = (zone, lieu) => lieu.debut <= zone.fin && lieu.fin >= zone.debut;

/**
 * Compare l'ABC validé et l'ABC relu (avec ses doutes). Rend les comptes et
 * la liste des erreurs, chacune avec sa place dans l'ABC relu (`lieu`) et le
 * doute qui la couvre, s'il y en a un.
 */
export function comparer(abcValide, lu) {
  const ev = evenementsDe(abcValide), el = evenementsDe(lu.abc);
  const compte = { notes: 0, paires: 0, pairesNotes: 0, hauteur: 0, duree: 0, nature: 0, manquantes: 0, enTrop: 0, barres: 0, barresFausses: 0 };
  const erreurs = [];
  const finDe = (evs) => (evs.length ? evs[evs.length - 1].fin : lu.abc.length);
  for (const voix of new Set([...ev.keys(), ...el.keys()])) {
    const v = ev.get(voix) || [], l = el.get(voix) || [];
    const notesV = v.filter((e) => e.genre !== "barre"), notesL = l.filter((e) => e.genre !== "barre");
    compte.notes += notesV.length;
    const paires = aligner(notesV, notesL);
    // Chaque barre se repère par le nombre de notes qui la précèdent (pas par
    // l'instant : une seule durée fausse décalerait toutes les barres suivantes).
    const rang = new Map(), rangLu = new Map();
    notesV.forEach((e, i) => rang.set(e, i));
    notesL.forEach((e, i) => rangLu.set(e, i));
    const enLu = new Array(notesV.length + 1).fill(0); // validé : avant la note i → lu : avant la note enLu[i]
    let dernier = 0;
    for (const [a, b] of paires) {
      if (b) dernier = rangLu.get(b) + 1;
      if (a) enLu[rang.get(a) + 1] = dernier;
    }
    const avant = (evs, e) => evs.slice(0, evs.indexOf(e)).filter((x) => x.genre !== "barre").length;
    paires.forEach(([a, b], k) => {
      if (a && b) {
        compte.paires++;
        if (a.genre === "note" && b.genre === "note") compte.pairesNotes++;
        for (const genre of ecarts(a, b)) { compte[genre]++; erreurs.push({ genre, voix, lieu: b, valide: a, lu: b }); }
      } else if (a) {
        // Une note manquante : là où le lecteur passe à la suivante.
        compte.manquantes++;
        const suivante = paires.slice(k + 1).find(([, x]) => x);
        const p = suivante ? suivante[1].debut : finDe(notesL);
        erreurs.push({ genre: "manquante", voix, lieu: { debut: p, fin: p }, valide: a, lu: null });
      } else {
        compte.enTrop++;
        erreurs.push({ genre: "en trop", voix, lieu: b, valide: null, lu: b });
      }
    });
    // Les barres : après la même note, de part et d'autre (une reprise ou une
    // double barre compte comme une barre : c'est la place qui compte ici).
    const barresV = v.filter((e) => e.genre === "barre"), barresL = l.filter((e) => e.genre === "barre");
    compte.barres += barresV.length;
    const placesL = new Set(barresL.map((b) => avant(l, b)));
    const placesV = new Set(barresV.map((b) => enLu[avant(v, b)]));
    for (const b of barresV) {
      const place = enLu[avant(v, b)];
      if (placesL.has(place)) continue;
      compte.barresFausses++;
      const proche = notesL[place] || { debut: finDe(notesL) };
      erreurs.push({ genre: "barre manquante", voix, lieu: { debut: proche.debut, fin: proche.debut }, valide: b, lu: null });
    }
    for (const b of barresL) {
      if (placesV.has(avant(l, b))) continue;
      compte.barresFausses++;
      erreurs.push({ genre: "barre en trop", voix, lieu: b, valide: null, lu: b });
    }
  }
  // Silencieuse : aucune zone de doute ne la touche. Un doute est juste s'il touche une erreur.
  const doutes = lu.doutes.map((d) => ({ d, zones: zonesDe(d) }));
  for (const e of erreurs) e.doute = (doutes.find((x) => x.zones.some((z) => touche(z, e.lieu))) || {}).d || null;
  const situes = doutes.filter((x) => x.zones.length);
  const justes = situes.filter((x) => erreurs.some((e) => x.zones.some((z) => touche(z, e.lieu))));
  return {
    ...compte, erreurs: erreurs.length, silencieuses: erreurs.filter((e) => !e.doute).length,
    doutes: lu.doutes.length, doutesSitues: situes.length, doutesJustes: justes.length, detail: erreurs,
  };
}

// ------------------------------------------------------------------------
// Le banc : toutes les pages prêtes d'une sauvegarde
// ------------------------------------------------------------------------

/**
 * Évalue le lecteur sur une sauvegarde (son contenu JSON). `gabarits` : pour
 * lire avec tes gabarits (L16). Une page illisible (modèle inconnu, traits
 * abîmés) est comptée à part et n'arrête pas les autres.
 * @returns {{ pages: object[], ignorees: number, echecs: { titre, raison }[], total: object }}
 */
export function evaluer(sauvegarde, { gabarits = null, calibration = chargerCalibration } = {}) {
  if (!sauvegarde || sauvegarde.format !== "portee-sauvegarde" || !Array.isArray(sauvegarde.partitions)) {
    throw new Error("Ce fichier n'est pas une sauvegarde de Portée.");
  }
  const pages = [], echecs = [];
  let ignorees = 0;
  for (const e of sauvegarde.partitions) {
    const f = (e && e.donnees) || {};
    const titre = typeof f.titre === "string" ? f.titre : "Sans titre";
    // Seulement les pages lues que tu as validées : leur ABC est la vérité.
    if (f.type || f.statut !== "prete" || !Array.isArray(e.pages) || !e.pages.length || typeof f.abc !== "string") { ignorees++; continue; }
    try {
      const cal = calibration(f.modele, f.versionModele || 1);
      const lu = lirePartition(e.pages.map(decompacter), cal, { titre, gabarits });
      pages.push({ titre, modele: f.modele, nbPages: e.pages.length, corrigee: f.abcLu !== undefined && f.abcLu !== f.abc, ...comparer(f.abc, lu) });
    } catch (err) {
      echecs.push({ titre, raison: (err && err.message) || String(err) });
    }
  }
  const somme = (k) => pages.reduce((a, p) => a + p[k], 0);
  const total = Object.fromEntries(["notes", "paires", "pairesNotes", "hauteur", "duree", "nature", "manquantes", "enTrop", "barres", "barresFausses", "erreurs", "silencieuses", "doutes", "doutesSitues", "doutesJustes"].map((k) => [k, somme(k)]));
  return { versionLecteur: VERSION_LECTEUR, avecGabarits: !!(gabarits && gabarits.exemples && gabarits.exemples.length), pages, ignorees, echecs, total };
}

/** Les taux, en proportions (null quand il n'y a rien à compter). */
export function taux(c) {
  const r = (a, b) => (b ? a / b : null);
  return {
    hauteurs: r(c.hauteur, c.pairesNotes),
    durees: r(c.duree, c.paires),
    symboles: r(c.hauteur + c.duree + c.nature + c.manquantes + c.enTrop, c.notes),
    barres: r(c.barresFausses, c.barres),
    silencieuses: r(c.silencieuses, c.erreurs),
    precisionDoutes: r(c.doutesJustes, c.doutesSitues),
  };
}

// ------------------------------------------------------------------------
// En ligne de commande
// ------------------------------------------------------------------------

const pourcent = (x) => (x === null ? "—" : `${(100 * x).toFixed(1).replace(".", ",")} %`);
const pluriel = (n, mot, mots = mot + "s") => `${n} ${n > 1 ? mots : mot}`;
const NOTES = ["do", "do♯", "ré", "mi♭", "mi", "fa", "fa♯", "sol", "sol♯", "la", "si♭", "si"];
/** « ré4 » pour 62 : la note qui sonne, octave comprise (do4 = do central). */
const nomMidi = (m) => `${NOTES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

function ligne(c) {
  const t = taux(c);
  return [
    `${pluriel(c.notes, "note")}`,
    `hauteurs ${pourcent(t.hauteurs)} (${c.hauteur})`,
    `durées ${pourcent(t.durees)} (${c.duree})`,
    `${c.manquantes} manquante${c.manquantes > 1 ? "s" : ""}, ${c.enTrop} en trop`,
    `barres ${pourcent(t.barres)} (${c.barresFausses})`,
    `erreurs silencieuses ${pourcent(t.silencieuses)} (${c.silencieuses} sur ${c.erreurs})`,
    `doutes justes ${pourcent(t.precisionDoutes)} (${c.doutesJustes} sur ${c.doutesSitues})`,
  ].join(" · ");
}

function main() {
  const args = process.argv.slice(2);
  const g = args.indexOf("--gabarits");
  const fichier = args.find((a, i) => !a.startsWith("--") && (g < 0 || i !== g + 1));
  if (!fichier) {
    console.error("Usage : node outils/banc-lecteur.mjs ma-sauvegarde.json [--gabarits g.json] [--detail] [--json]");
    process.exitCode = 2;
    return;
  }
  const gabarits = g >= 0 ? JSON.parse(fs.readFileSync(args[g + 1], "utf8")) : null;
  const res = evaluer(JSON.parse(fs.readFileSync(fichier, "utf8")), { gabarits });
  if (args.includes("--json")) {
    const { pages, ...reste } = res;
    console.log(JSON.stringify({ ...reste, taux: taux(res.total), pages: pages.map(({ detail: _d, ...p }) => ({ ...p, taux: taux(p) })) }, null, 2));
    return;
  }
  console.log(`Banc d'essai du lecteur (version ${res.versionLecteur}${res.avecGabarits ? ", avec tes gabarits" : ""}) : ${pluriel(res.pages.length, "page prête", "pages prêtes")}${res.ignorees ? `, ${res.ignorees} autre${res.ignorees > 1 ? "s" : ""} laissée${res.ignorees > 1 ? "s" : ""} de côté` : ""}.`);
  for (const p of res.pages) {
    console.log(`\n« ${p.titre} » (${pluriel(p.nbPages, "page")}, ${p.modele}${p.corrigee ? ", corrigée" : ""})\n  ${ligne(p)}`);
    if (!args.includes("--detail")) continue;
    for (const e of p.detail) {
      const quoi = (x) => (!x ? "rien" : x.genre === "barre" ? "une barre" : x.genre === "silence" ? `un silence de ${x.croches} croche${x.croches > 1 ? "s" : ""}` : `${x.midi.map(nomMidi).join("-")} (${x.croches} croche${x.croches > 1 ? "s" : ""})`);
      console.log(`    ${e.genre}${e.voix !== "1" ? ` (voix ${e.voix})` : ""} : validé ${quoi(e.valide)}, lu ${quoi(e.lu)}${e.doute ? ` — doute ${e.doute.id} (${e.doute.type})` : " — sans doute"}`);
    }
  }
  for (const e of res.echecs) console.log(`\n« ${e.titre} » : illisible (${e.raison})`);
  if (res.pages.length) console.log(`\nEn tout : ${ligne(res.total)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
