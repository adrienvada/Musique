/**
 * LES ÉCHANTILLONS DU PIANO (app/piano/)
 *
 *   node outils/echantillons-piano.mjs
 *
 * Réécrit app/piano/*.mp3 et app/piano/echantillons.json à partir des
 * enregistrements d'origine : le Steinway de SplendidGrandPiano (AKAI,
 * domaine public), tel que la bibliothèque smplr le sert en m4a. Il faut
 * ffmpeg (avec libmp3lame) et un accès au réseau ; les enregistrements
 * téléchargés sont gardés dans le dossier temporaire du système.
 *
 * Trois couches de nuances : MF (mezzo-forte), chargée au premier son, puis
 * PP et FF, chargées seulement quand une note jouée doucement ou fort les
 * demande (piano.js). Pour chaque note retenue :
 *   1. l'enregistrement, en mono à 44,1 kHz, coupé à 6 s (5 s pour PP et FF)
 *      avec un fondu de sortie ;
 *   2. sa crête ramenée à −1,5 dBFS, puis encodé en MP3 et relu : la crête
 *      relue doit rester sous −1 dBFS. Les fichiers d'avant montaient jusqu'à
 *      +2,7 dBFS et s'écrêtaient au décodage (audit du 04/10, M4) ;
 *   3. son niveau mesuré sur les 300 premières millisecondes, et un gain qui
 *      le ramène sur une courbe lisse d'un bout à l'autre du clavier : chaque
 *      échantillon est normalisé à sa crête, et deux voisins pouvaient
 *      sonner à 10 dB l'un de l'autre. Les trois couches suivent la même
 *      courbe : à force égale, elles sonnent aussi fort, seul le timbre
 *      change, et passer d'une couche à l'autre ne fait pas de saut.
 *
 * Pourquoi un la5 qui n'est plus le 81 : celui de la couche MF s'éteint très
 * vite (−55 dB à 1 s, contre −35 à −42 dB pour ses voisins) ; le la♯5 (82)
 * le remplace, transposé d'un demi-ton.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dossierPiano = path.join(racine, "app/piano");
const cache = path.join(os.tmpdir(), "portee-piano-sources");
const SOURCE = "https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples";
const SR = 44100;

// Les notes gardées, en MIDI : à peu près une sur trois, pour qu'aucune note
// jouée ne soit à plus de deux demi-tons de son échantillon.
const MF = [23, 27, 29, 33, 35, 38, 41, 45, 48, 50, 53, 57, 60, 62, 65, 69, 72, 74, 77, 82, 83, 87, 90, 93, 96, 99, 102, 105, 108];
const PP = MF;
// Au-dessus du la5 (93), la couche FF de l'enregistrement reprend les sons MF : on s'arrête là.
const FF = [23, 27, 29, 33, 35, 38, 41, 45, 48, 50, 53, 57, 60, 62, 65, 69, 72, 74, 77, 82, 83, 86, 89, 93];

/** Les couches : nom, vélocités qu'elles couvrent (1 à 127), notes, durée gardée, qualité MP3 (VBR LAME). */
const COUCHES = [
  { nom: "mf", velocites: [65, 100], notes: MF, duree: 6, qualite: 2, prefixe: (m) => (m >= 37 && m <= 72 ? "MF" : "Mf") },
  { nom: "pp", velocites: [1, 64], notes: PP, duree: 5, qualite: 4, prefixe: () => "PP" },
  { nom: "ff", velocites: [101, 127], notes: FF, duree: 5, qualite: 4, prefixe: () => "FF" },
];

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** Le nom du fichier d'origine : « MF C3 » pour le do4 (MIDI 60), l'octave à la façon de Yamaha. */
const nomSource = (couche, midi) => `${couche.prefixe(midi)} ${NOTES[midi % 12]}${Math.floor(midi / 12) - 2}`;
const db = (x) => 20 * Math.log10(x + 1e-12);

async function telecharger(nom) {
  fs.mkdirSync(cache, { recursive: true });
  const f = path.join(cache, `${nom}.m4a`);
  if (fs.existsSync(f)) return f;
  for (let essai = 1; ; essai++) {
    const r = await fetch(`${SOURCE}/${encodeURIComponent(nom)}.m4a`);
    if (r.ok) { fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return f; }
    if (essai >= 4) throw new Error(`${nom} : ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 1500 * essai));
  }
}

/** Un fichier son → échantillons mono, flottants, à 44,1 kHz (ffmpeg moyenne les deux canaux). */
function decoder(f) {
  const brut = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "f32le", "-ac", "1", "-ar", String(SR), "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength));
}

function encoder(x, f, qualite) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", "-", "-c:a", "libmp3lame", "-q:a", String(qualite), f], { input: Buffer.from(x.buffer, x.byteOffset, x.byteLength) });
}

const crete = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; };
function debut(x) { const seuil = 0.01 * crete(x); let i = 0; while (i < x.length && Math.abs(x[i]) < seuil) i++; return i; }
function rms(x, a, b) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }

/** Coupe l'attaque au plus près (une milliseconde avant), garde `duree` secondes, fondu de sortie en cosinus. */
function preparer(x, duree) {
  const d = Math.max(0, debut(x) - Math.round(0.001 * SR));
  const n = Math.min(x.length - d, Math.round(duree * SR));
  const y = x.slice(d, d + n);
  const fondu = Math.min(n, Math.round(Math.max(0.25, Math.min(0.5, 0.08 * (n / SR))) * SR));
  for (let i = 0; i < fondu; i++) y[n - fondu + i] *= 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / fondu));
  return y;
}

/** Encode avec −1 dB de marge au moins, relu après encodage (le MP3 dépasse un peu la crête d'origine). */
function encoderAvecMarge(y, f, qualite) {
  let cible = -1.5;
  for (let essai = 0; essai < 5; essai++) {
    const g = 10 ** (cible / 20) / crete(y);
    encoder(y.map((v) => v * g), f, qualite);
    const relu = decoder(f);
    const c = db(crete(relu));
    if (c <= -1) return { relu, crete: c };
    cible -= c + 1 + 0.2;
  }
  throw new Error(`${f} : la crête ne descend pas sous −1 dBFS`);
}

/** Le niveau d'une note : l'efficace des 300 premières millisecondes, en dB. */
const niveau = (x) => { const d = debut(x); return db(rms(x, d, Math.min(x.length, d + Math.round(0.3 * SR)))); };

/** La courbe visée : la médiane glissante (cinq voisins), puis lissée sur trois. Les écarts isolés disparaissent, la pente du clavier reste. */
function courbe(niveaux) {
  const med = niveaux.map((_, i) => {
    const v = niveaux.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  return med.map((_, i) => { const v = med.slice(Math.max(0, i - 1), i + 2); return v.reduce((a, b) => a + b, 0) / v.length; });
}

/** La courbe de la couche MF, lue à une hauteur quelconque (interpolée entre ses notes). */
function lireCourbe(points, midi) {
  if (midi <= points[0].midi) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    if (midi <= points[i].midi) {
      const a = points[i - 1], b = points[i];
      return a.v + ((b.v - a.v) * (midi - a.midi)) / (b.midi - a.midi);
    }
  }
  return points[points.length - 1].v;
}

const nomFichier = (couche, midi) => `${String(midi).padStart(3, "0")}-${couche.nom}.mp3`;

const mesures = new Map(); // couche → [{ midi, niveau, crete, octets, duree }]
for (const couche of COUCHES) {
  const lignes = [];
  for (const midi of couche.notes) {
    const x = decoder(await telecharger(nomSource(couche, midi)));
    const y = preparer(x, couche.duree);
    const f = path.join(dossierPiano, nomFichier(couche, midi));
    const { relu, crete: c } = encoderAvecMarge(y, f, couche.qualite);
    lignes.push({ midi, niveau: niveau(relu), crete: c, octets: fs.statSync(f).size, duree: y.length / SR });
  }
  mesures.set(couche.nom, lignes);
}

const mf = mesures.get("mf");
const visee = courbe(mf.map((l) => l.niveau));
const points = mf.map((l, i) => ({ midi: l.midi, v: visee[i] }));
const borner = (x) => Math.max(-6, Math.min(6, x));
const index = {
  source: SOURCE,
  licence: "Domaine public (échantillons Steinway publiés par AKAI, ~2000) — https://github.com/sfzinstruments/SplendidGrandPiano (README : « Public Domain samples by AKAI »)",
  preparation: "outils/echantillons-piano.mjs",
  base: "mf",
  couches: COUCHES.map((couche) => ({
    nom: couche.nom,
    velocites: couche.velocites,
    echantillons: mesures.get(couche.nom).map((l) => ({
      midi: l.midi,
      fichier: nomFichier(couche, l.midi),
      // Le gain qui ramène la note sur la courbe (arrondi au centième de dB près, en facteur).
      gain: Math.round(10 ** (borner(lireCourbe(points, l.midi) - l.niveau) / 20) * 1000) / 1000,
    })),
  })),
};
fs.writeFileSync(path.join(dossierPiano, "echantillons.json"), JSON.stringify(index, null, 2) + "\n");

for (const couche of COUCHES) {
  const lignes = mesures.get(couche.nom);
  const total = lignes.reduce((a, l) => a + l.octets, 0);
  console.log(`\n${couche.nom.toUpperCase()} : ${lignes.length} notes, ${(total / 1024 / 1024).toFixed(2)} Mo`);
  console.log("midi  durée  crête  niveau  visé   gain");
  const gains = index.couches.find((c) => c.nom === couche.nom).echantillons;
  lignes.forEach((l, i) => console.log(`${String(l.midi).padStart(4)} ${l.duree.toFixed(2).padStart(6)} ${l.crete.toFixed(1).padStart(6)} ${l.niveau.toFixed(1).padStart(7)} ${lireCourbe(points, l.midi).toFixed(1).padStart(6)} ${db(gains[i].gain).toFixed(1).padStart(6)}`));
}
