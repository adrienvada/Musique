/**
 * LES MORCEAUX : DES IDÉES EN BLOCS
 *
 * Une intro, un couplet, un refrain… notés séparément, au fil des jours.
 * Un morceau les met bout à bout : chaque bloc renvoie à une idée de la
 * bibliothèque (on ne la recopie pas : la corriger corrige le morceau), avec
 * un nom de section et un nombre de fois. On réordonne les blocs au doigt,
 * on écoute l'enchaînement, on l'envoie en MIDI (une piste par voix : la
 * mélodie de tous les blocs, la basse, les accords).
 *
 * Chaque bloc dure un nombre entier de mesures de son idée. Le tempo est
 * celui du morceau (celui de la première idée, au départ).
 */
import { nbMesures, pasParMesure, pasParTemps, lireTonalite } from "./sequence.js";
import { voixCompletes } from "./harmonie.js";
import { fichierMidi } from "./midi.js";

export const SECTIONS = ["Intro", "Couplet", "Pré-refrain", "Refrain", "Pont", "Solo", "Outro"];

/**
 * Le morceau à plat : ses voix (notes décalées bloc après bloc), et où
 * commence et finit chaque passage d'un bloc.
 * @param morceau { blocs: [{ id, idee, nom, fois }], tempo }
 * @param idees   Map id → partition (type idee) ; un bloc dont l'idée a disparu est sauté
 */
export function assembler(morceau, idees) {
  const voix = new Map(); // nom → notes
  const passages = [];
  let debut = 0, premiere = null;
  for (const bloc of morceau.blocs || []) {
    const p = idees.get(bloc.idee);
    if (!p || !p.sequence) continue;
    const seq = p.sequence;
    premiere = premiere || seq;
    const longueur = nbMesures(seq) * pasParMesure(seq);
    const lesVoix = voixCompletes(seq);
    for (let fois = 0; fois < Math.max(1, bloc.fois || 1); fois++) {
      lesVoix.forEach((v, i) => {
        const nom = i === 0 ? "Mélodie" : v.nom || `Voix ${i + 1}`;
        if (!voix.has(nom)) voix.set(nom, []);
        for (const n of v.notes) voix.get(nom).push({ d: n.d + debut, l: n.l, h: n.h, v: n.v });
      });
      passages.push({ bloc: bloc.id, debut, fin: debut + longueur, fois });
      debut += longueur;
    }
  }
  const seq0 = premiere || { tempo: 90, mesure: [4, 4], tonalite: "C" };
  return {
    voix: [...voix].map(([nom, notes]) => ({ nom, notes: notes.sort((a, b) => a.d - b.d) })),
    passages,
    fin: debut,
    tempo: morceau.tempo || seq0.tempo,
    mesure: seq0.mesure,
    tonalite: seq0.tonalite,
  };
}

/** Le MIDI de l'enchaînement. */
export function midiDuMorceau(morceau, idees) {
  const a = assembler(morceau, idees);
  const k = lireTonalite(a.tonalite);
  return fichierMidi(a.voix, { tempo: a.tempo, mesure: a.mesure, quintes: k.quintes, mineur: k.mineur, titre: morceau.titre });
}

/** Ce que le transport joue (transport.js). */
export function sourceDuMorceau(a) {
  const parPas = new Map();
  for (const v of a.voix) for (const n of v.notes) {
    if (!parPas.has(n.d)) parPas.set(n.d, []);
    parPas.get(n.d).push(n);
  }
  const mesure = (a.mesure[0] * 16) / a.mesure[1];
  const temps = pasParTemps({ mesure: a.mesure });
  return () => ({ tempo: a.tempo, mesure, temps, fin: a.fin, notesA: (p) => parPas.get(p) || [] });
}

// --- La structure en frise ---------------------------------------------------------

/** Les couleurs de section (--section-1 à --section-6, morceau.css). */
export const NB_COULEURS = 6;

/** Empreinte stable d'un texte (FNV-1a) : de quoi répartir les idées entre les couleurs. */
function empreinte(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) { h ^= texte.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

/**
 * La couleur (1 à 6) de chaque idée d'un morceau : une même idée garde la
 * sienne partout où elle revient (frise, cartes, vignette de la bibliothèque).
 * Elle vient de l'idée, pas de la place du bloc : réordonner ou répéter un
 * bloc ne recolore rien. Deux idées d'un même morceau ne partagent une
 * couleur qu'au-delà de six idées ; quand deux tombent sur la même, la
 * première dans l'ordre alphabétique des identifiants garde la sienne, l'autre
 * prend la suivante libre (l'ordre des blocs n'y entre pas).
 * @returns Map idée → 1…6
 */
export function couleursDesIdees(blocs) {
  const ids = [...new Set((blocs || []).map((b) => b.idee).filter(Boolean))].sort();
  const prises = new Set();
  const couleurs = new Map();
  for (const id of ids) {
    const voulue = empreinte(id) % NB_COULEURS;
    let c = voulue;
    // Six tours sans place libre ramènent à la couleur voulue : on la partage.
    for (let k = 0; k < NB_COULEURS && prises.has(c); k++) c = (c + 1) % NB_COULEURS;
    prises.add(c);
    couleurs.set(id, c + 1);
  }
  return couleurs;
}

/** « 1:57 » : des secondes en minutes:secondes. */
export function dureeEnTexte(secondes) {
  const s = Math.max(0, Math.round(secondes));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Le morceau vu d'en haut : un segment par bloc, aussi long que ses passages
 * (mesures × fois), pour la frise de l'écran Morceau et la vignette de la
 * bibliothèque. Un bloc dont l'idée a disparu y figure, muet (manque : true) :
 * l'assemblage le saute, et la frise le dit.
 * @returns { segments: [{ bloc, nom, idee, couleur, fois, mesures, pas, debut, fin, manque }],
 *            mesures, pas, secondes, tempo }
 */
export function structure(morceau, idees) {
  const a = assembler(morceau, idees);
  const couleurs = couleursDesIdees(morceau.blocs);
  const segments = [];
  let mesures = 0;
  for (const b of morceau.blocs || []) {
    const p = idees.get(b.idee);
    const passages = a.passages.filter((x) => x.bloc === b.id);
    if (!p || !p.sequence || !passages.length) {
      segments.push({ bloc: b.id, nom: b.nom, idee: b.idee, couleur: 0, fois: Math.max(1, b.fois || 1), mesures: 0, pas: 0, debut: 0, fin: 0, manque: true });
      continue;
    }
    const debut = passages[0].debut, fin = passages[passages.length - 1].fin;
    const nb = nbMesures(p.sequence) * passages.length;
    mesures += nb;
    segments.push({ bloc: b.id, nom: b.nom, idee: b.idee, couleur: couleurs.get(b.idee), fois: passages.length, mesures: nb, pas: fin - debut, debut, fin, manque: false });
  }
  return { segments, mesures, pas: a.fin, secondes: (a.fin / 4) * (60 / a.tempo), tempo: a.tempo };
}

/** Un nom de section pour le bloc suivant : on déroule Intro, Couplet, Refrain… */
export function sectionSuivante(blocs) {
  const deja = new Set(blocs.map((b) => b.nom));
  if (!blocs.length) return "Intro";
  for (const s of ["Couplet", "Refrain", "Pont", "Outro"]) if (!deja.has(s)) return s;
  return blocs.length % 2 ? "Refrain" : "Couplet";
}
