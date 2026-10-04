/**
 * LE FICHIER MIDI (idées, morceaux, pages lues)
 *
 * Une idée a ses notes au pas près, une page lue les siennes au temps exact
 * (abcjs la joue en notes : lirePage, sequence.js), un morceau met des idées
 * bout à bout : tout part par le même écrivain. Format 1 : une piste de
 * tempo (titre, tempo, mesure, armure, et leurs changements en cours de
 * route), puis une piste par voix, nommée, chacune sur son canal : la
 * mélodie et les pistes de l'idée (« Basse » si tu en as ajouté une),
 * « Accords » et « Basse des accords » quand il y a un accompagnement,
 * « Main droite » et « Main gauche » pour une page de piano. Glissé dans
 * Ableton, chaque voix arrive sur sa propre piste, au tempo de l'idée.
 *
 * Pour Live :
 *   - les noms sont écrits en ASCII (« Melodie ») : un fichier MIDI ne dit
 *     pas l'encodage de ses textes, et chaque logiciel devine (mido et
 *     @tonejs/midi lisent du Latin-1 et affichaient « MÃ©lodie », music21
 *     de l'UTF-8). L'ASCII est le seul texte que tous lisent pareil ;
 *   - chaque piste finit à la barre de la dernière mesure, pas à la dernière
 *     note : un clip tombe juste et boucle sans trou ;
 *   - une même note n'est jamais rejouée pendant qu'elle sonne : la
 *     première s'arrête où la suivante commence (sinon le deuxième note-on
 *     reste sans fin, ou coupe la mauvaise note, selon le logiciel).
 *
 * Sans dépendance (appli et tests) : abcjs, pour lire une page, est passé
 * en paramètre.
 */
import { lirePage, lireTonalite } from "./sequence.js";

const PPQ = 480; // tics par noire ; un pas (double croche) = 120 tics
const TICS_PAR_PAS = PPQ / 4;
const tics = (pas) => Math.round(pas * TICS_PAR_PAS); // un triolet de croches : 4/3 de pas, 160 tics

function vlq(n) {
  const octets = [n & 0x7f];
  while ((n >>= 7)) octets.unshift((n & 0x7f) | 0x80);
  return octets;
}

/**
 * Un texte du fichier (titre, nom de piste) en ASCII : les accents tombent
 * (é → e), les signes usuels se traduisent (♯ → #, ’ → '), le reste part.
 */
export function texteMidi(s) {
  return String(s ?? "")
    .replace(/♯/g, "#").replace(/♭/g, "b").replace(/[‘’]/g, "'").replace(/«\s*/g, '"').replace(/\s*»/g, '"').replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/…/g, "...").replace(/œ/g, "oe").replace(/Œ/g, "OE").replace(/æ/g, "ae").replace(/Æ/g, "AE")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();
}
const texte = (s) => [...texteMidi(s)].map((c) => c.charCodeAt(0));

function piste(evenements, fin) {
  // evenements : [{ t (tics), octets }], triés ; on écrit les écarts.
  const corps = [];
  let avant = 0;
  for (const e of evenements) {
    corps.push(...vlq(e.t - avant), ...e.octets);
    avant = e.t;
  }
  corps.push(...vlq(Math.max(0, fin - avant)), 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...[24, 16, 8, 0].map((s) => (corps.length >>> s) & 0xff), ...corps];
}

const meta = (type, donnees) => [0xff, type, ...vlq(donnees.length), ...donnees];
const metaMesure = ([n, d]) => meta(0x58, [n, Math.round(Math.log2(d)), 24, 8]);
const metaArmure = (quintes, mineur) => meta(0x59, [(quintes + 256) & 0xff, mineur ? 1 : 0]);

/**
 * Où finit la musique, à la barre : la fin de la mesure où tombe la
 * dernière note, d'après les mesures en vigueur (pas). Sans mesure (page en
 * mesure libre), la dernière note.
 */
function finALaBarre(derniere, mesure, changements) {
  const sections = [{ d: 0, mesure }, ...changements.filter((c) => c.mesure !== undefined)].sort((a, b) => a.d - b.d);
  const s = [...sections].reverse().find((x) => x.d <= derniere) || sections[0];
  if (!s.mesure || derniere <= s.d) return derniere;
  const longueur = (s.mesure[0] * 16) / s.mesure[1];
  return s.d + Math.ceil((derniere - s.d) / longueur - 1e-9) * longueur;
}

/** Les notes d'une voix, sans deux fois la même hauteur qui se chevauchent. */
function sansChevauchement(notes) {
  const parHauteur = new Map();
  for (const n of notes) {
    if (!parHauteur.has(n.h)) parHauteur.set(n.h, []);
    parHauteur.get(n.h).push(n);
  }
  const sortie = [];
  for (const liste of parHauteur.values()) {
    // À début égal, la plus longue d'abord : c'est elle qui reste.
    liste.sort((a, b) => a.d - b.d || b.l - a.l);
    liste.forEach((n, i) => {
      if (i > 0 && liste[i - 1].d === n.d) return;
      const suivante = liste.slice(i + 1).find((m) => m.d > n.d);
      sortie.push(suivante && n.d + n.l > suivante.d ? { ...n, l: suivante.d - n.d } : n);
    });
  }
  return sortie;
}

/**
 * @param voix  [{ nom, notes: [{ d, l, h, v }] }] (d, l en pas, fractionnaires permis)
 * @param options { tempo, mesure: [n, d] (null : mesure libre), quintes, mineur, titre,
 *                  transposition, changements: [{ d, mesure?, quintes?, mineur? }] (en cours
 *                  de route, en pas), fin (pas ; par défaut, la barre après la dernière note) }
 * @returns Uint8Array
 */
export function fichierMidi(voix, { tempo = 90, mesure = [4, 4], quintes = 0, mineur = false, titre = "", transposition = 0, changements = [], fin = null } = {}) {
  const microsecondes = Math.round(60000000 / tempo);
  const conducteur = [
    { t: 0, octets: meta(0x03, texte(titre || "Portée")) },
    { t: 0, octets: meta(0x51, [(microsecondes >> 16) & 0xff, (microsecondes >> 8) & 0xff, microsecondes & 0xff]) },
  ];
  if (mesure) conducteur.push({ t: 0, octets: metaMesure(mesure) });
  conducteur.push({ t: 0, octets: metaArmure(quintes, mineur) });
  for (const c of [...changements].sort((a, b) => a.d - b.d)) {
    if (c.mesure) conducteur.push({ t: tics(c.d), octets: metaMesure(c.mesure) });
    if (c.quintes !== undefined) conducteur.push({ t: tics(c.d), octets: metaArmure(c.quintes, !!c.mineur) });
  }
  conducteur.sort((a, b) => a.t - b.t);

  const propres = voix.map((v) => sansChevauchement(v.notes
    .map((n) => ({ ...n, h: n.h + transposition }))
    .filter((n) => n.h >= 0 && n.h <= 127 && n.l > 0)));
  const derniere = Math.max(0, ...propres.flat().map((n) => n.d + n.l), ...changements.map((c) => c.d));
  const finTics = tics(fin ?? finALaBarre(derniere, mesure, changements));

  const pistes = [piste(conducteur, finTics)];
  voix.forEach((v, i) => {
    const canal = i >= 9 ? i + 1 : i; // le canal 10 est celui des percussions
    const ev = [
      { t: 0, ordre: 0, octets: meta(0x03, texte(v.nom || `Voix ${i + 1}`)) },
      { t: 0, ordre: 0, octets: [0xc0 | canal, 0] }, // piano acoustique
    ];
    for (const n of propres[i]) {
      const force = Math.max(1, Math.min(127, Math.round(n.v || 90)));
      ev.push({ t: tics(n.d), ordre: 2, octets: [0x90 | canal, n.h, force] });
      ev.push({ t: tics(n.d + n.l), ordre: 1, octets: [0x80 | canal, n.h, 0] });
    }
    // À tic égal : les fins de notes avant les débuts (une note répétée se rejoue).
    ev.sort((a, b) => a.t - b.t || a.ordre - b.ordre);
    pistes.push(piste(ev, Math.max(finTics, ev.at(-1).t)));
  });
  const entete = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, pistes.length, (PPQ >> 8) & 0xff, PPQ & 0xff];
  return new Uint8Array([...entete, ...pistes.flat()]);
}

/** Une levée de `pas` pas en chiffrage MIDI (1/8 pour une croche), dans l'unité de la mesure qui suit si possible ; null sinon. */
function chiffrageDeLevee(pas, mesure) {
  for (const den of [mesure[1], 8, 16]) {
    const num = (pas * den) / 16;
    if (Math.abs(num - Math.round(num)) < 1e-9 && num >= 1) return [Math.round(num), den];
  }
  return null;
}

/**
 * Le MIDI d'une page lue, par le même écrivain que les idées. Avant, abcjs
 * l'écrivait (getMidiFile) : pistes sans nom, une piste vide de plus pour
 * une page de piano, et les changements de la page (« [K:Eb][M:12/8] »)
 * perdus, Live restait en 4/4 et en do. Maintenant :
 *   - une piste par voix qui joue, « Main droite » et « Main gauche » pour
 *     une page de piano, « Mélodie » pour une page de mélodie ;
 *   - chaque changement de tonalité au moment où il arrive, chaque
 *     changement de mesure à la barre qui suit, précédé d'une mesure de la
 *     longueur de la levée s'il y en a une : la grille de Live tombe sur les
 *     barres de la page ;
 *   - les notes à leur durée écrite (abcjs les raccourcissait un peu pour le
 *     son) et au temps exact : un triolet reste un triolet.
 * @param lib abcjs
 */
export function midiDeLaPage(abc, lib, { tempo = null, transposition = 0, titre = "" } = {}) {
  const page = lirePage(abc, lib);
  const noms = page.voix.length === 1 ? ["Mélodie"] : page.voix.length === 2 ? ["Main droite", "Main gauche"] : page.voix.map((_, i) => `Voix ${i + 1}`);
  const [debut, ...suite] = page.sections;
  const k = lireTonalite(debut.tonalite);
  const changements = [];
  let avant = debut;
  for (const s of suite) {
    if (s.tonalite !== avant.tonalite) {
      const ks = lireTonalite(s.tonalite);
      changements.push({ d: s.d, quintes: ks.quintes, mineur: ks.mineur });
    }
    if (s.mesure && String(s.mesure) !== String(avant.mesure)) {
      const levee = s.barre - s.d;
      const chiffrage = levee > 1e-9 && chiffrageDeLevee(levee, s.mesure);
      if (chiffrage) changements.push({ d: s.d, mesure: chiffrage });
      changements.push({ d: chiffrage ? s.barre : s.d, mesure: s.mesure });
    }
    avant = s;
  }
  return fichierMidi(page.voix.map((v, i) => ({ nom: noms[i], notes: v.notes })), {
    tempo: tempo || page.tempo, mesure: debut.mesure, quintes: k.quintes, mineur: k.mineur, titre, transposition, changements,
  });
}
