/**
 * LES ACCORDS D'UNE IDÉE
 *
 * Sous la mélodie, une grille d'accords (« Am », « G7 », « F/A »…), posés
 * sur les mesures. Portée en propose qui vont avec les notes de la mesure
 * (ceux de la tonalité d'abord), et en tire un accompagnement simple :
 * accords plaqués, basse et accords, ou arpège. Cet accompagnement est une
 * voix de plus, calculée : il se grave sous la mélodie, sonne avec elle et
 * part en MIDI sur sa propre piste. On ne le corrige pas note à note : on
 * change l'accord.
 *
 * Sans dépendance (appli et tests).
 */
import { lireTonalite, pasParMesure, pasParTemps, nbMesures } from "./sequence.js";

const RACINES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const mod12 = (x) => ((x % 12) + 12) % 12;

/** Les sortes d'accords qu'on sait lire et jouer : suffixe → intervalles (demi-tons). */
export const QUALITES = {
  "": [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], "7sus4": [0, 5, 7, 10], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
  9: [0, 4, 7, 10, 14], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14],
};
const FORME = /^([A-G])([#b]?)(maj7|m7b5|dim7|7sus4|add9|sus2|sus4|dim|aug|maj|m9|m7|m6|m|7|6|9)?(?:\/([A-G])([#b]?))?$/;

/** « F#m7/E » → { racine: 6, qualite: "m7", intervalles, basse: 4 } ; null si illisible. */
export function lireAccord(nom) {
  const m = FORME.exec((nom || "").trim());
  if (!m) return null;
  const alt = (a) => (a === "#" ? 1 : a === "b" ? -1 : 0);
  const qualite = m[3] === "maj" ? "" : m[3] || "";
  return {
    racine: mod12(RACINES[m[1]] + alt(m[2])),
    qualite,
    intervalles: QUALITES[qualite],
    basse: m[4] ? mod12(RACINES[m[4]] + alt(m[5])) : null,
  };
}

/** « F#m7b5 » → « F♯m7b5 », « Bb » → « B♭ » : pour l'affichage. */
export const joliAccord = (nom) => nom.replace(/#/g, "♯").replace(/([A-G])b/g, "$1♭");

const DIESES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BEMOLS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Le nom d'une note (racine d'accord), en dièses ou en bémols selon la tonalité. */
export function nomRacine(pc, tonalite = "C") {
  const k = lireTonalite(tonalite);
  const bemols = k.quintes < 0 || (k.quintes === 0 && [3, 8, 10].includes(pc));
  return (bemols ? BEMOLS : DIESES)[mod12(pc)];
}

/** Monte ou descend un nom d'accord (« Am/C », +2 → « Bm/D »). */
export function transposerAccord(nom, demiTons, tonalite = "C") {
  const a = lireAccord(nom);
  if (!a) return nom;
  const basse = a.basse === null ? "" : "/" + nomRacine(a.basse + demiTons, tonalite);
  return nomRacine(a.racine + demiTons, tonalite) + a.qualite + basse;
}

/** Les accords de la tonalité, du plus courant au plus rare, avec leur degré. */
export function accordsDeLaTonalite(tonalite) {
  const k = lireTonalite(tonalite);
  const gamme = k.mineur ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const qualites = k.mineur ? ["m", "dim", "", "m", "m", "", ""] : ["", "m", "m", "", "", "m", "dim"];
  const degres = k.mineur ? ["i", "ii°", "III", "iv", "v", "VI", "VII"] : ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
  const ordre = k.mineur ? [0, 3, 4, 5, 6, 2, 1] : [0, 4, 3, 5, 1, 2, 6];
  const liste = ordre.map((i) => ({ nom: nomRacine(k.pc + gamme[i], tonalite) + qualites[i], degre: degres[i] }));
  // La dominante : majeure (et sa septième) même en mineur.
  const dominante = nomRacine(k.pc + 7, tonalite);
  if (k.mineur) liste.splice(2, 0, { nom: dominante, degre: "V" });
  liste.push({ nom: dominante + "7", degre: "V7" });
  return liste;
}

const PREFERENCES = { I: 0.3, i: 0.3, V: 0.25, IV: 0.25, iv: 0.25, vi: 0.15, VI: 0.15, V7: 0.15, ii: 0.1, III: 0.1, VII: 0.1, iii: 0.05, v: 0.05, "vii°": -0.1, "ii°": -0.1 };

/**
 * Les accords qui vont avec les notes entre `debut` et `fin` (pas) de la
 * première piste : une note de l'accord compte pour, une note à un
 * demi-ton d'une note de l'accord compte contre ; le premier temps pèse
 * plus. Rend les noms, du meilleur au moins bon.
 */
export function suggerer(seq, debut, fin, combien = 6) {
  const notes = seq.pistes[0].notes.filter((n) => n.d < fin && n.d + n.l > debut);
  const candidats = accordsDeLaTonalite(seq.tonalite);
  if (!notes.length) return candidats.slice(0, combien).map((c) => c.nom);
  const poids = notes.map((n) => {
    const recouvre = Math.min(fin, n.d + n.l) - Math.max(debut, n.d);
    return { pc: mod12(n.h), w: recouvre * (n.d === debut ? 1.5 : 1) };
  });
  const total = poids.reduce((s, p) => s + p.w, 0) || 1;
  const notes1 = candidats.map((c) => {
    const a = lireAccord(c.nom);
    const tons = new Set(a.intervalles.map((i) => mod12(a.racine + i)));
    let score = 0;
    for (const { pc, w } of poids) {
      if (tons.has(pc)) score += w;
      else if (tons.has(mod12(pc + 1)) || tons.has(mod12(pc - 1))) score -= 0.5 * w;
      else score -= 0.1 * w;
    }
    return { nom: c.nom, score: score / total + (PREFERENCES[c.degre] || 0) };
  });
  return notes1.sort((a, b) => b.score - a.score).slice(0, combien).map((c) => c.nom);
}

/** Un accord par mesure, d'après la mélodie : le premier et le dernier tirent vers la tonique. */
export function harmoniser(seq) {
  const mesure = pasParMesure(seq);
  const tonique = accordsDeLaTonalite(seq.tonalite)[0].nom;
  const nb = nbMesures(seq);
  const accords = [];
  for (let m = 0; m < nb; m++) {
    const propositions = suggerer(seq, m * mesure, (m + 1) * mesure, 3);
    let choix = propositions[0];
    if ((m === 0 || m === nb - 1) && propositions.includes(tonique)) choix = tonique;
    else if (accords.length && propositions.slice(0, 2).includes(accords.at(-1).nom)) choix = accords.at(-1).nom;
    accords.push({ d: m * mesure, nom: choix });
  }
  // Deux mesures de suite sur le même accord : un seul symbole.
  return accords.filter((a, i) => i === 0 || a.nom !== accords[i - 1].nom);
}

export const STYLES = [
  { id: "aucun", nom: "Sans" },
  { id: "plaque", nom: "Plaqués" },
  { id: "basse", nom: "Basse et accords" },
  { id: "arpege", nom: "Arpège" },
];

/**
 * Les notes d'un accord : l'accord à partir de l'octave du do3, la basse
 * dans l'octave du dessous (la note après « / », sinon la racine).
 */
function disposition(a) {
  return { tons: a.intervalles.map((i) => 48 + a.racine + i), basse: 36 + (a.basse ?? a.racine) };
}

/** L'accompagnement d'une idée, d'après ses accords et le style choisi. */
export function accompagnement(seq, style = seq.accompagnement) {
  if (!style || style === "aucun" || !seq.accords || !seq.accords.length) return [];
  const mesure = pasParMesure(seq), temps = pasParTemps(seq);
  const total = nbMesures(seq) * mesure;
  const accords = [...seq.accords].sort((a, b) => a.d - b.d);
  const notes = [];
  const ajouter = (d, l, h, v = 70) => { if (l > 0 && d < total) notes.push({ id: -(notes.length + 1), d, l: Math.min(l, total - d), h, v }); };
  accords.forEach((ac, i) => {
    const a = lireAccord(ac.nom);
    if (!a) return;
    const fin = i + 1 < accords.length ? accords[i + 1].d : total;
    const { tons, basse } = disposition(a);
    if (style === "plaque") {
      // Un accord par mesure (rejoué à chaque barre, pour qu'on l'entende).
      for (let d = ac.d; d < fin; d = Math.min(fin, (Math.floor(d / mesure) + 1) * mesure)) {
        const l = Math.min(fin, (Math.floor(d / mesure) + 1) * mesure) - d;
        for (const h of new Set([basse, ...tons])) ajouter(d, l, h);
      }
    } else if (style === "basse") {
      // La basse sur le premier temps, l'accord (sans la racine) sur les autres.
      for (let d = ac.d; d < fin; d += temps) {
        const l = Math.min(temps, fin - d);
        if ((d % mesure) === 0 || d === ac.d) ajouter(d, l, basse, 80);
        else for (const h of tons.slice(1)) ajouter(d, l, h, 60);
      }
    } else if (style === "arpege") {
      // Des croches qui montent et redescendent : racine, quinte, octave, tierce…
      const motif = [basse, tons[0], tons[2] ?? tons[1], tons[0] + 12, tons[1] + 12, tons[0] + 12, tons[2] ?? tons[1], tons[0]];
      let k = 0;
      for (let d = ac.d; d < fin; d += 2, k++) {
        if (d % mesure === 0) k = 0;
        ajouter(d, Math.min(2, fin - d), motif[k % motif.length], k === 0 ? 75 : 62);
      }
    }
  });
  return notes;
}

/** Les voix à graver, jouer et exporter : les pistes, plus l'accompagnement s'il y en a un. */
export function voixCompletes(seq) {
  const voix = seq.pistes.map((p) => ({ ...p }));
  const acc = accompagnement(seq);
  if (acc.length) voix.push({ nom: "Accords", cle: "fa", notes: acc });
  return voix;
}

const TONIQUES_MAJ = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const TONIQUES_MIN = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

/** Toute l'idée transposée : notes, accords et tonalité. */
export function transposerIdee(seq, demiTons) {
  const k = lireTonalite(seq.tonalite);
  const tonalite = (k.mineur ? TONIQUES_MIN : TONIQUES_MAJ)[mod12(k.pc + demiTons)];
  for (const p of seq.pistes) for (const n of p.notes) n.h = Math.max(21, Math.min(108, n.h + demiTons));
  seq.accords = (seq.accords || []).map((a) => ({ ...a, nom: transposerAccord(a.nom, demiTons, tonalite) }));
  seq.tonalite = tonalite;
}
