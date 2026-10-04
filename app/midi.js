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
import { lirePage, lireTonalite, nouvelleSequence, pasParTemps, quantifier } from "./sequence.js";

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

// ---------------------------------------------------------------------------
// Lire un fichier MIDI : l'aller-retour avec Ableton
// ---------------------------------------------------------------------------
//
// Une phrase retravaillée dans Live (ou venue de n'importe quel logiciel)
// revient dans Portée en idée. Le lecteur est à nous, comme l'écrivain : un
// fichier MIDI standard est simple à lire, et une bibliothèque de plus
// aurait été une dépendance de plus pour le site et pour claude.ai.

/** Un texte MIDI : en UTF-8 s'il en est, sinon en Latin-1 (ce que la plupart des logiciels écrivent). */
function decoderTexte(octets) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(octets); } catch { return String.fromCharCode(...octets); }
}

/**
 * Un fichier MIDI standard (format 0 ou 1) : { format, ppq, pistes: [{ nom,
 * notes: [{ t, fin, h, v, canal }] }], tempo (noires par minute), mesure
 * ([n, d]), armure ({ quintes, mineur }) }, les temps en tics. Le tempo, la
 * mesure et l'armure sont les premiers du fichier (null s'il n'y en a pas).
 * Sait lire le « running status » (un octet d'état sous-entendu), le note-on
 * de vélocité 0 qui vaut note-off, et saute ce qui ne fait pas de note
 * (sysex, contrôleurs, blocs inconnus). Une erreur claire sinon.
 */
export function lireFichierMidi(donnees) {
  const o = donnees instanceof Uint8Array ? donnees : new Uint8Array(donnees);
  let i = 0;
  const u8 = () => { if (i >= o.length) throw new Error("le fichier MIDI est tronqué"); return o[i++]; };
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  const vlq = () => {
    let v = 0;
    for (let n = 0; n < 4; n++) { const b = u8(); v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; }
    throw new Error("le fichier MIDI est illisible (une durée trop longue)");
  };
  const bloc = () => String.fromCharCode(u8(), u8(), u8(), u8());
  if (o.length < 14 || bloc() !== "MThd") throw new Error("ce n'est pas un fichier MIDI");
  const longueurEntete = u32();
  const format = u16(), nbPistes = u16(), division = u16();
  if (division & 0x8000) throw new Error("ce fichier MIDI compte le temps en images (SMPTE) : Portée ne sait pas le lire");
  i = 8 + longueurEntete;
  const ppq = division || 480;
  const pistes = [];
  let tempo = null, mesure = null, armure = null;
  while (pistes.length < nbPistes && o.length - i >= 8) {
    const type = bloc(), longueur = u32();
    const fin = Math.min(o.length, i + longueur);
    if (type !== "MTrk") { i = fin; continue; } // un bloc d'un autre logiciel : on le saute
    const piste = { nom: null, notes: [] };
    const ouvertes = new Map(); // canal × 128 + hauteur → les notes qui sonnent, la plus ancienne d'abord
    let t = 0, statut = 0;
    while (i < fin) {
      t += vlq();
      let b = o[i];
      if (b >= 0x80) i++;
      else if (statut) b = statut; // running status : l'état d'avant vaut encore
      else throw new Error("le fichier MIDI est illisible (un événement sans état)");
      if (b === 0xff) {
        const type = u8(), n = vlq();
        const meta = o.slice(i, i + n);
        i += n;
        statut = 0; // un méta-événement interrompt le running status
        if (type === 0x2f) break;
        if (type === 0x03 && piste.nom === null) piste.nom = decoderTexte(meta).trim();
        if (type === 0x51 && tempo === null && n === 3) tempo = 60000000 / ((meta[0] << 16) | (meta[1] << 8) | meta[2]);
        if (type === 0x58 && mesure === null && n >= 2) mesure = [meta[0], 2 ** meta[1]];
        if (type === 0x59 && armure === null && n >= 2) armure = { quintes: (meta[0] << 24) >> 24, mineur: meta[1] === 1 };
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        const n = vlq(); // à part : « i += vlq() » perdrait l'octet de longueur que vlq vient de lire
        i += n;
        statut = 0;
        continue;
      }
      if (b > 0xf0) continue; // messages système : rien à garder (et sans données dans un fichier)
      statut = b;
      const commande = b & 0xf0, canal = b & 0x0f;
      const d1 = u8(), d2 = commande === 0xc0 || commande === 0xd0 ? 0 : u8();
      const cle = canal * 128 + d1;
      if (commande === 0x90 && d2 > 0) {
        if (!ouvertes.has(cle)) ouvertes.set(cle, []);
        ouvertes.get(cle).push({ t, v: d2 });
      } else if (commande === 0x80 || commande === 0x90) {
        const n = (ouvertes.get(cle) || []).shift();
        if (n) piste.notes.push({ t: n.t, fin: t, h: d1, v: n.v, canal });
      }
    }
    // Une note jamais relâchée s'arrête avec la piste.
    for (const [cle, pile] of ouvertes) for (const n of pile) piste.notes.push({ t: n.t, fin: Math.max(t, n.t + 1), h: cle % 128, v: n.v, canal: Math.floor(cle / 128) });
    piste.notes.sort((a, b) => a.t - b.t || a.h - b.h);
    pistes.push(piste);
    i = fin;
  }
  return { format, ppq, pistes, tempo, mesure, armure };
}

// Les tonalités du menu d'une idée, d'après l'armure du fichier (les enharmoniques rares prennent leur voisine).
const MAJEURES = { "-7": "B", "-6": "F#", "-5": "Db", "-4": "Ab", "-3": "Eb", "-2": "Bb", "-1": "F", 0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "Db" };
const MINEURES = { "-7": "G#m", "-6": "Ebm", "-5": "Bbm", "-4": "Fm", "-3": "Cm", "-2": "Gm", "-1": "Dm", 0: "Am", 1: "Em", 2: "Bm", 3: "F#m", 4: "C#m", 5: "G#m", 6: "Ebm", 7: "Bbm" };
// Ce que Portée écrit en ASCII redevient français au retour.
const NOMS_DE_RETOUR = { Melodie: "Mélodie" };
export const PISTES_MAX = 4;

/**
 * Un fichier MIDI devenu idée : { sequence, ecartees: { pistes, batterie } }.
 *   - une piste de l'idée par piste du fichier qui joue, et par canal quand
 *     une piste en mêle plusieurs (un fichier de format 0) ; au plus quatre
 *     (une idée n'est pas un arrangement), les suivantes sont comptées dans
 *     `ecartees.pistes` ;
 *   - la batterie (canal 10) reste dehors : une idée n'a pas de percussions ;
 *   - les notes recalées au pas (la double croche) par le même arrondi que
 *     le jeu en direct (`quantifier`, avec le jeu lié) : un fichier sorti de
 *     Live, déjà sur la grille, ne bouge pas ;
 *   - le tempo, la mesure et la tonalité du fichier (les premiers : une
 *     idée n'en a qu'un) ; sans eux, 120, 4/4 et do, comme le veut le MIDI.
 */
export function ideeDepuisMidi(donnees) {
  const m = lireFichierMidi(donnees);
  const mesure = m.mesure && m.mesure[0] >= 1 && m.mesure[0] <= 32 && [1, 2, 4, 8, 16].includes(m.mesure[1]) ? m.mesure : [4, 4];
  const tempo = Math.max(20, Math.min(300, Math.round(m.tempo || 120)));
  const tonalite = m.armure ? (m.armure.mineur ? MINEURES : MAJEURES)[m.armure.quintes] || "C" : "C";
  const seq = nouvelleSequence({ tempo, mesure, tonalite });
  const groupes = [];
  let batterie = false;
  for (const p of m.pistes) {
    if (p.notes.some((n) => n.canal === 9)) batterie = true;
    const canaux = [...new Set(p.notes.map((n) => n.canal))].filter((c) => c !== 9);
    // Le nom de la piste ne va qu'à une piste d'un seul canal ; plusieurs canaux font plusieurs pistes sans nom.
    for (const c of canaux) groupes.push({ nom: canaux.length === 1 ? p.nom : null, notes: p.notes.filter((n) => n.canal === c) });
  }
  const parPas = m.ppq / 4;
  const temps = pasParTemps(seq);
  seq.pistes = groupes.slice(0, PISTES_MAX).map((g, i) => {
    const notes = quantifier(g.notes.map((n) => ({ debut: n.t / parPas, fin: n.fin / parPas, h: n.h, v: n.v })), { grille: 1, temps })
      .map((n) => ({ id: seq.suivant++, d: n.d, l: n.l, h: n.h, v: n.v }));
    const hauteurs = notes.map((n) => n.h).sort((a, b) => a - b);
    const piste = { nom: NOMS_DE_RETOUR[g.nom] || g.nom || (i === 0 ? "Mélodie" : `Piste ${i + 1}`), notes };
    if (hauteurs.length && hauteurs[Math.floor(hauteurs.length / 2)] < 55) piste.cle = "fa";
    return piste;
  });
  if (!seq.pistes.length) seq.pistes = [{ nom: "Mélodie", notes: [] }];
  return { sequence: seq, ecartees: { pistes: Math.max(0, groupes.length - PISTES_MAX), batterie } };
}
