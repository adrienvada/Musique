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

/** Un nom de section pour le bloc suivant : on déroule Intro, Couplet, Refrain… */
export function sectionSuivante(blocs) {
  const deja = new Set(blocs.map((b) => b.nom));
  if (!blocs.length) return "Intro";
  for (const s of ["Couplet", "Refrain", "Pont", "Outro"]) if (!deja.has(s)) return s;
  return blocs.length % 2 ? "Refrain" : "Couplet";
}
