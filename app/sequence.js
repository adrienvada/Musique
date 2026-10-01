/**
 * UNE IDÉE MUSICALE, EN NOTES
 *
 * Une partition lue sur la tablette vit en ABC : le lecteur l'écrit, et
 * edition.js la corrige. Une idée notée dans l'appli, elle, vit en notes,
 * comme dans Ableton : des pistes de notes { début, longueur, hauteur MIDI }.
 * La grille, le clavier, le micro et l'enregistrement les manipulent sans
 * se soucier de notation (barres de mesure, liaisons, altérations).
 *
 * L'ABC n'en est qu'une traduction, refaite à chaque changement pour la
 * gravure. Elle garde la carte de ses jetons : toucher une note de la
 * partition retrouve la note de l'idée. Le MIDI part directement des notes
 * (midi.js).
 *
 * Unité de temps : le pas, une double croche (quatre par noire). C'est assez
 * fin pour une idée, et une note jouée en direct est recalée sur ce pas.
 *
 * Sans dépendance : le même module sert à l'appli et aux tests. abcjs, quand
 * il faut lire un ABC (sequenceDepuisAbc), est passé en paramètre.
 */
import { dureeABC } from "./edition.js";

export const PAS_PAR_NOIRE = 4;
const LETTRES = "CDEFGAB";
const NATUREL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOMS = { C: "do", D: "ré", E: "mi", F: "fa", G: "sol", A: "la", B: "si" };
const SIGNES = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };
const ALT_ABC = { "-2": "__", "-1": "_", 0: "=", 1: "^", 2: "^^" };
const mod12 = (x) => ((x % 12) + 12) % 12;
export const BORNES = { bas: 21, haut: 108 }; // le clavier du piano

// ------------------------------------------------------------------------
// L'idée et ses mesures
// ------------------------------------------------------------------------

export function nouvelleSequence({ tempo = 90, mesure = [4, 4], tonalite = "C" } = {}) {
  return { version: 1, tempo, mesure: [...mesure], tonalite, pistes: [{ nom: "Mélodie", notes: [] }], accords: [], accompagnement: "aucun", suivant: 1 };
}

export const cloner = (seq) => JSON.parse(JSON.stringify(seq));
export const pasParMesure = (seq) => (seq.mesure[0] * 16) / seq.mesure[1];

/** Le temps, en pas : la noire, ou la noire pointée en 6/8, 9/8, 12/8. */
export function pasParTemps(seq) {
  const [n, d] = seq.mesure;
  if (d === 8 && n % 3 === 0 && n > 3) return 6;
  return 16 / d;
}

/** Où finit la dernière note (ou le dernier accord), en pas. */
export function finSequence(seq) {
  let f = 0;
  for (const p of seq.pistes) for (const n of p.notes) f = Math.max(f, n.d + n.l);
  for (const a of seq.accords || []) f = Math.max(f, a.d + 1);
  return f;
}

export const nbMesures = (seq) => Math.max(1, Math.ceil(finSequence(seq) / pasParMesure(seq)));

// ------------------------------------------------------------------------
// Tonalités et noms de notes
// ------------------------------------------------------------------------

const QUINTES = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, "G#": 8, "D#": 9, "A#": 10, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };

/** Les tonalités proposées : les douze majeures et les douze mineures usuelles. */
export const TONALITES = [
  ..."C G D A E B F# Db Ab Eb Bb F".split(" "),
  ..."Am Em Bm F#m C#m G#m Ebm Bbm Fm Cm Gm Dm".split(" "),
];

/** « C », « F#m », « Bb »… → tonique, mode, armure (altération de chaque lettre). */
export function lireTonalite(t) {
  const m = /^([A-G][#b]?)(m?)$/.exec(t || "") || [null, "C", ""];
  const tonique = m[1], mineur = m[2] === "m";
  const quintes = (QUINTES[tonique] ?? 0) - (mineur ? 3 : 0);
  const armure = {};
  for (let i = 0; i < Math.min(7, Math.abs(quintes)); i++) armure[(quintes > 0 ? "FCGDAEB" : "BEADGCF")[i]] = quintes > 0 ? 1 : -1;
  const pc = mod12(NATUREL[tonique[0]] + (tonique[1] === "#" ? 1 : tonique[1] === "b" ? -1 : 0));
  return { tonique, mineur, quintes, armure, pc };
}

export function nomTonalite(t) {
  const k = lireTonalite(t);
  const alt = k.tonique[1] === "#" ? "♯" : k.tonique[1] === "b" ? "♭" : "";
  return `${NOMS[k.tonique[0]][0].toUpperCase()}${NOMS[k.tonique[0]].slice(1)}${alt} ${k.mineur ? "mineur" : "majeur"}`;
}

// En do majeur (et la mineur), les notes étrangères les plus courantes.
const PREFERENCE_DO = { 1: 1, 3: -1, 6: 1, 8: -1, 10: -1 };

/** Comment écrire la hauteur `h` dans la tonalité : { lettre, alt, octave } (do4 = 60). */
export function epeler(h, tonalite = "C") {
  const k = lireTonalite(tonalite);
  const pc = mod12(h);
  let choix = null;
  for (const l of LETTRES) {
    const alt = k.armure[l] || 0;
    if (mod12(NATUREL[l] + alt) === pc) { choix = { lettre: l, alt }; break; }
  }
  // En mineur, la sensible et la sixte haussées gardent leur lettre (sol♯ en la mineur).
  if (!choix && k.mineur) {
    const iTonique = LETTRES.indexOf(k.tonique[0]);
    for (const [degre, ecart] of [[6, 11], [5, 9]]) {
      if (mod12(k.pc + ecart) !== pc) continue;
      const l = LETTRES[(iTonique + degre) % 7];
      choix = { lettre: l, alt: (k.armure[l] || 0) + 1 };
    }
  }
  // Note étrangère : le bécarre d'abord, puis le dièse ou le bémol de l'armure.
  if (!choix) {
    const sens = k.quintes > 0 ? 1 : k.quintes < 0 ? -1 : (k.mineur && pc === 8 ? 1 : PREFERENCE_DO[pc] ?? 1);
    const candidats = [];
    for (const alt of [0, sens, -sens]) for (const l of LETTRES) if (mod12(NATUREL[l] + alt) === pc) candidats.push({ lettre: l, alt });
    choix = candidats[0];
  }
  return { ...choix, octave: Math.round((h - NATUREL[choix.lettre] - choix.alt) / 12) - 1 };
}

/** « sol4 », « si♭3 » : le nom d'une hauteur, dans la tonalité. */
export function nomNote(h, tonalite = "C") {
  const e = epeler(h, tonalite);
  return NOMS[e.lettre] + SIGNES[e.alt] + e.octave;
}

function lettreAbc({ lettre, octave }) {
  return octave >= 5 ? lettre.toLowerCase() + "'".repeat(octave - 5) : lettre + ",".repeat(Math.max(0, 4 - octave));
}

// ------------------------------------------------------------------------
// Des notes à la partition : mesures, liaisons, ligatures
// ------------------------------------------------------------------------

// Les durées qu'on sait écrire d'un seul signe, en pas : ronde, blanche
// pointée, blanche, noire pointée, noire, croche pointée, croche, double.
const NOTABLES = [16, 12, 8, 6, 4, 3, 2, 1];

/**
 * Coupe [a, b[ (dans une seule mesure) en durées notables. Une note qui
 * commence à contretemps s'arrête au temps suivant, puis repart liée :
 * c'est ce qui rend une syncope lisible.
 */
function fragmenter(a, b, mesure, temps) {
  const morceaux = [];
  const debutMesure = Math.floor(a / mesure) * mesure;
  let x = a;
  while (x < b) {
    let y = b;
    const dedans = x - debutMesure;
    if (dedans % temps !== 0) y = Math.min(y, debutMesure + (Math.floor(dedans / temps) + 1) * temps);
    const l = NOTABLES.find((d) => d <= y - x);
    morceaux.push([x, x + l]);
    x += l;
  }
  return morceaux;
}

/**
 * Les couches d'une voix. abcjs ne sait lier, d'un accord au suivant, que
 * l'accord entier (ou la note de même rang, ce qui casse dès qu'une note
 * s'ajoute). On range donc les notes en « événements » (même début, même
 * durée : un accord homogène) et les événements en couches qui ne se
 * chevauchent pas. Une mélodie tient dans une couche ; une note tenue sous
 * une mélodie en ouvre une seconde (« & » en ABC, sur la même portée).
 */
function couches(notes) {
  const evenements = new Map();
  for (const n of notes) {
    const cle = n.d + ":" + n.l;
    if (!evenements.has(cle)) evenements.set(cle, { d: n.d, l: n.l, notes: [] });
    evenements.get(cle).notes.push(n);
  }
  const haut = (e) => Math.max(...e.notes.map((n) => n.h));
  // La ligne du dessus d'abord : elle prend la première couche.
  const liste = [...evenements.values()].sort((a, b) => a.d - b.d || haut(b) - haut(a));
  const sortie = [];
  for (const e of liste) {
    e.notes.sort((a, b) => a.h - b.h);
    let c = sortie.find((x) => x.fin <= e.d);
    if (!c) { c = { fin: 0, evenements: [] }; sortie.push(c); }
    c.evenements.push(e);
    c.fin = e.d + e.l;
  }
  return sortie.length ? sortie.map((c) => c.evenements) : [[]];
}

/**
 * Une couche, mesure par mesure : des jetons { a, l, silence, notes, lie }.
 * `lie` : l'accord continue au jeton suivant ; `suite` (par note) : il
 * vient du jeton précédent.
 */
function decouperCouche(evenements, { mesure, temps, total, coupures }) {
  const bornes = new Set([0, total, ...coupures]);
  for (let x = 0; x <= total; x += mesure) bornes.add(x);
  for (const e of evenements) { bornes.add(e.d); bornes.add(e.d + e.l); }
  const liste = [...bornes].filter((x) => x >= 0 && x <= total).sort((a, b) => a - b);
  const mesures = Array.from({ length: Math.round(total / mesure) }, () => []);
  for (let i = 0; i + 1 < liste.length; i++) {
    const a = liste[i], b = liste[i + 1];
    const e = evenements.find((x) => x.d <= a && x.d + x.l > a);
    for (const [x, y] of fragmenter(a, b, mesure, temps)) {
      mesures[Math.floor(x / mesure)].push({
        a: x, l: y - x, silence: !e, lie: !!e && e.d + e.l > y,
        notes: e ? e.notes.map((n) => ({ id: n.id, h: n.h, suite: e.d < x })) : [],
      });
    }
  }
  return mesures;
}

/** La clé d'une voix : celle qu'on lui a donnée, sinon d'après sa hauteur moyenne. */
function cleDe(voix, rang) {
  if (voix.cle) return voix.cle;
  if (!voix.notes.length) return rang === 0 ? "sol" : "fa";
  const hauteurs = voix.notes.map((n) => n.h).sort((a, b) => a - b);
  return hauteurs[Math.floor(hauteurs.length / 2)] < 55 ? "fa" : "sol";
}

/**
 * L'ABC d'une idée, et la carte de ses jetons : { abc, jetons: [{ debut,
 * fin, voix, a, l, ids, silence }] } (debut, fin : positions dans l'ABC).
 *
 * `voix` : par défaut, les pistes de l'idée ; l'appelant peut y ajouter
 * l'accompagnement (harmonie.js). Les symboles d'accords vont sur la
 * première voix.
 */
export function ecrireAbc(seq, { voix = seq.pistes, titre = "", mesuresParLigne = 4, mesuresEnPlus = 0 } = {}) {
  const k = lireTonalite(seq.tonalite);
  const mesure = pasParMesure(seq), temps = pasParTemps(seq);
  const total = (nbMesures(seq) + mesuresEnPlus) * mesure;
  const accords = new Map((seq.accords || []).filter((a) => a.d < total).map((a) => [a.d, a.nom]));
  const coupures = [...accords.keys()];
  const epellations = new Map();
  const epeler1 = (h) => { if (!epellations.has(h)) epellations.set(h, epeler(h, seq.tonalite)); return epellations.get(h); };

  const entete = ["X:1"];
  if (titre) entete.push("T:" + titre.replace(/\n/g, " "));
  entete.push(`M:${seq.mesure[0]}/${seq.mesure[1]}`, "L:1/8", `Q:1/4=${seq.tempo}`, `K:${seq.tonalite}`);
  const cles = voix.map((v, i) => cleDe(v, i));
  const avecVoix = voix.length > 1 || cles[0] !== "sol";
  if (avecVoix) voix.forEach((v, i) => entete.push(`V:${i + 1} clef=${cles[i] === "fa" ? "bass" : "treble"}`));
  let abc = entete.join("\n") + "\n";
  const jetons = [];

  // Les changements d'accord ne coupent que la couche qui porte leurs symboles.
  const parVoix = voix.map((v, iv) => couches(v.notes).map((c, ic) => decouperCouche(c, { mesure, temps, total, coupures: iv === 0 && ic === 0 ? coupures : [] })));
  const nb = Math.round(total / mesure);
  for (let m0 = 0; m0 < nb; m0 += mesuresParLigne) {
    parVoix.forEach((lesCouches, iv) => {
      // Le premier élément d'une ligne commence, pour abcjs, dans « [V:1] ».
      let debutLigne = abc.length;
      if (avecVoix) abc += `[V:${iv + 1}] `;
      for (let m = m0; m < Math.min(nb, m0 + mesuresParLigne); m++) {
        // Altérations écrites : elles valent jusqu'à la barre, pour la même
        // note à la même octave. abcjs les oublie d'une couche à l'autre :
        // une note déjà altérée dans une autre couche redit la sienne.
        const dejaAlterees = new Set();
        lesCouches.forEach((mesures, ic) => {
          // Une couche s'écrit dans toutes les mesures, même vide : sinon
          // abcjs y invente un silence qui ne renvoie à rien.
          if (ic > 0) abc += " &";
          const ecrites = new Map([...dejaAlterees].map((cle) => [cle, NaN]));
          let precedent = null;
          for (const t of mesures[m]) {
            const dedans = t.a - m * mesure;
            const ligature = precedent && !t.silence && !precedent.silence && t.l < 4 && precedent.l < 4
              && Math.floor(dedans / temps) === Math.floor((precedent.a - m * mesure) / temps);
            // abcjs fait commencer l'élément à l'espace, ou au symbole d'accord, qui le précède.
            const avant = debutLigne ?? abc.length;
            debutLigne = null;
            if (!ligature && !/[\n ]$/.test(abc)) abc += " ";
            if (iv === 0 && ic === 0 && accords.has(t.a)) abc += `"${accords.get(t.a)}"`;
            const debut = abc.length;
            abc += texteJeton(t, ecrites, k, epeler1, ic > 0);
            jetons.push({ avant, debut, fin: abc.length, voix: iv, couche: ic, a: t.a, l: t.l, ids: t.notes.map((n) => n.id), silence: t.silence });
            precedent = t;
          }
          for (const [cle, alt] of ecrites) if (!Number.isNaN(alt)) dejaAlterees.add(cle);
        });
        abc += m === nb - 1 ? " |]" : " |";
      }
      abc += "\n";
    });
  }
  return { abc, jetons };
}

function texteJeton(t, ecrites, k, epeler1, invisible) {
  const duree = dureeABC(t.l / 2); // L:1/8 : une croche = deux pas
  // Dans une couche du dessous, les silences ne s'affichent pas (« x »).
  if (t.silence) return (invisible ? "x" : "z") + duree;
  const notes = t.notes.map((n) => {
    const e = epeler1(n.h);
    const cle = e.lettre + e.octave;
    let signe = "";
    if (n.suite) {
      // Une note liée garde sa hauteur sans redire l'altération. Après la
      // barre, la même note non liée redira la sienne, quelle qu'elle soit.
      if (!ecrites.has(cle)) ecrites.set(cle, NaN);
    } else {
      const enVigueur = ecrites.has(cle) ? ecrites.get(cle) : (k.armure[e.lettre] || 0);
      if (enVigueur !== e.alt) { signe = ALT_ABC[e.alt]; ecrites.set(cle, e.alt); }
    }
    return signe + lettreAbc(e);
  });
  // La liaison suit la durée et vaut pour tout l'accord : « F4- », « [CEG]2- ».
  return (notes.length > 1 ? "[" + notes.join("") + "]" : notes[0]) + duree + (t.lie ? "-" : "");
}

/** Le jeton de la partition à la position `pos` de l'ABC (startChar d'abcjs). */
export function jetonA(jetons, pos) {
  return jetons.find((j) => pos >= j.avant && pos < j.fin) || null;
}

/**
 * Une partition ABC (lue sur la tablette) devenue idée : abcjs (passé en
 * paramètre) la joue en notes, reprises dépliées. Le tempo vient de Q:.
 */
export function sequenceDepuisAbc(abc, lib, { tempo = null } = {}) {
  const [tune] = lib.parseOnly(abc);
  const audio = tune.setUpAudio({ chordsOff: true });
  let mesure = [4, 4];
  try { const f = tune.getMeterFraction(); if (f && f.num && f.den) mesure = [f.num, f.den]; } catch { /* chiffrage libre */ }
  if (![1, 2, 4, 8, 16].includes(mesure[1])) mesure = [4, 4];
  const k = /^K:\s*([A-G][#b]?)\s*([A-Za-z]*)/m.exec(abc);
  let tonalite = k ? k[1] + (/^(m|min|minor|aeo|aeolian)$/i.test(k[2]) ? "m" : "") : "C";
  if (!TONALITES.includes(tonalite)) tonalite = "C";
  const q = /^Q:\s*(?:(\d+)\/(\d+)\s*=\s*)?(\d+)/m.exec(abc);
  const tempoAbc = q ? Math.round(Number(q[3]) * (q[1] ? (4 * Number(q[1])) / Number(q[2]) : 1)) : 90;
  const seq = nouvelleSequence({ tempo: tempo || tempoAbc, mesure, tonalite });
  seq.pistes = audio.tracks.map((t, i) => ({
    nom: i === 0 ? "Mélodie" : audio.tracks.length === 2 ? "Main gauche" : `Voix ${i + 1}`,
    notes: t.filter((e) => e.cmd === "note" && e.pitch >= 0).map((e) => ({
      id: seq.suivant++, d: Math.round(e.start * 16), l: Math.max(1, Math.round(e.duration * 16)), h: e.pitch,
    })),
  }));
  if (!seq.pistes.length) seq.pistes = [{ nom: "Mélodie", notes: [] }];
  seq.pistes.forEach(trier);
  return seq;
}

// ------------------------------------------------------------------------
// Gestes d'édition (ils modifient l'idée sur place ; l'appelant en garde
// une copie pour « Annuler »)
// ------------------------------------------------------------------------

function trier(piste) {
  piste.notes.sort((a, b) => a.d - b.d || a.h - b.h);
}

const borner = (h) => Math.max(BORNES.bas, Math.min(BORNES.haut, h));

export function notesDe(seq, p, ids) {
  const voulus = new Set(ids);
  return seq.pistes[p].notes.filter((n) => voulus.has(n.id));
}

/**
 * Insère une note (ou un accord) de longueur `l` à `pos`. Comme dans un
 * texte, ce qui suit dans la piste se pousse pour lui faire de la place.
 */
export function inserer(seq, p, pos, hauteurs, l) {
  const piste = seq.pistes[p];
  for (const n of piste.notes) if (n.d >= pos) n.d += l;
  const ids = [...new Set(hauteurs.map(borner))].map((h) => {
    const n = { id: seq.suivant++, d: pos, l, h };
    piste.notes.push(n);
    return n.id;
  });
  trier(piste);
  return ids;
}

/** Ajoute une note posée librement (grille, enregistrement) : rien ne bouge. */
export function poser(seq, p, { d, l, h, v }) {
  const piste = seq.pistes[p];
  h = borner(h);
  // Deux fois la même note au même endroit : la plus longue reste.
  const double = piste.notes.find((n) => n.d === d && n.h === h);
  if (double) { double.l = Math.max(double.l, l); return double.id; }
  const n = { id: seq.suivant++, d: Math.max(0, d), l: Math.max(1, l), h };
  if (v) n.v = v;
  piste.notes.push(n);
  trier(piste);
  return n.id;
}

/** Une note de plus dans l'accord de `ref` (même début, même durée). */
export function ajouterALAccord(seq, p, ref, h) {
  const r = seq.pistes[p].notes.find((n) => n.id === ref);
  if (!r) return null;
  return poser(seq, p, { d: r.d, l: r.l, h });
}

/** Un silence de longueur `l` à `pos` : ce qui suit se pousse. */
export function insererSilence(seq, p, pos, l) {
  for (const n of seq.pistes[p].notes) if (n.d >= pos) n.d += l;
}

/**
 * Retire des notes. Avec `decaler`, ce qui suivait se rapproche, comme dans
 * un texte, sauf si une autre note commençait au même endroit (accord).
 */
export function effacer(seq, p, ids, { decaler = true } = {}) {
  const piste = seq.pistes[p];
  const voulus = new Set(ids);
  const partis = piste.notes.filter((n) => voulus.has(n.id));
  piste.notes = piste.notes.filter((n) => !voulus.has(n.id));
  if (!decaler) return;
  const debuts = [...new Set(partis.map((n) => n.d))].sort((a, b) => b - a);
  for (const d of debuts) {
    if (piste.notes.some((n) => n.d === d)) continue;
    const l = Math.max(...partis.filter((n) => n.d === d).map((n) => n.l));
    for (const n of piste.notes) if (n.d >= d + l) n.d -= l;
  }
}

/**
 * La touche ⌫ : retire ce qui précède le curseur (la note ou l'accord qui y
 * finit, ou un bout du silence) et rend la nouvelle place du curseur.
 */
export function effacerAvant(seq, p, curseur, lSilence = 2) {
  const piste = seq.pistes[p];
  if (curseur <= 0) return 0;
  const avant = piste.notes.filter((n) => n.d < curseur);
  if (!avant.length) {
    const l = Math.min(curseur, lSilence);
    for (const n of piste.notes) if (n.d >= curseur) n.d -= l;
    return curseur - l;
  }
  const finAvant = Math.max(...avant.map((n) => n.d + n.l));
  if (finAvant < curseur) {
    // Un silence juste avant le curseur : on en retire un bout.
    const l = Math.min(curseur - finAvant, lSilence);
    for (const n of piste.notes) if (n.d >= curseur) n.d -= l;
    return curseur - l;
  }
  const dernier = Math.max(...avant.filter((n) => n.d + n.l >= curseur).map((n) => n.d));
  const groupe = avant.filter((n) => n.d === dernier);
  effacer(seq, p, groupe.map((n) => n.id));
  return dernier;
}

/** Nouvelle durée (en pas) ; avec `decaler`, ce qui suit suit. */
export function changerDuree(seq, p, ids, l, { decaler = true } = {}) {
  const piste = seq.pistes[p];
  const choisies = notesDe(seq, p, ids);
  const debuts = [...new Set(choisies.map((n) => n.d))].sort((a, b) => b - a);
  for (const d of debuts) {
    const groupe = choisies.filter((n) => n.d === d);
    const ancienne = Math.max(...groupe.map((n) => n.l));
    for (const n of groupe) n.l = l;
    if (decaler && l !== ancienne) for (const n of piste.notes) if (n.d >= d + ancienne && !groupe.includes(n)) n.d += l - ancienne;
  }
  trier(piste);
}

/** Monte ou descend de `demiTons`. */
export function transposer(seq, p, ids, demiTons) {
  for (const n of notesDe(seq, p, ids)) n.h = borner(n.h + demiTons);
  trier(seq.pistes[p]);
}

/**
 * Donne la hauteur `h` à la sélection (la touche jouée remplace la note
 * choisie). Un accord se transpose : sa note la plus grave va sur `h`.
 */
export function fixerHauteur(seq, p, ids, h) {
  const choisies = notesDe(seq, p, ids);
  if (!choisies.length) return;
  const grave = Math.min(...choisies.map((n) => n.h));
  transposer(seq, p, ids, h - grave);
}

/** Grille : déplace une note (début, hauteur) sans toucher aux autres. */
export function deplacer(seq, p, id, d, h) {
  const n = seq.pistes[p].notes.find((x) => x.id === id);
  if (!n) return;
  n.d = Math.max(0, d);
  n.h = borner(h);
  trier(seq.pistes[p]);
}

export function redimensionner(seq, p, id, l) {
  const n = seq.pistes[p].notes.find((x) => x.id === id);
  if (n) n.l = Math.max(1, l);
}

/** L'étendue d'une sélection : [début, fin[. */
export function etendue(notes) {
  if (!notes.length) return null;
  return [Math.min(...notes.map((n) => n.d)), Math.max(...notes.map((n) => n.d + n.l))];
}

/** Recopie la sélection juste après elle (ce qui suit se pousse) ; rend les nouvelles notes. */
export function dupliquerSelection(seq, p, ids) {
  const choisies = notesDe(seq, p, ids);
  const e = etendue(choisies);
  if (!e) return [];
  const [a, b] = e;
  const piste = seq.pistes[p];
  for (const n of piste.notes) if (n.d >= b) n.d += b - a;
  const copies = choisies.map((n) => ({ ...n, id: seq.suivant++, d: n.d + (b - a) }));
  piste.notes.push(...copies);
  trier(piste);
  return copies.map((n) => n.id);
}

/** Durées ×2 ou ÷2 à partir du début de la sélection ; ce qui suit suit. */
export function etirer(seq, p, ids, facteur) {
  const choisies = notesDe(seq, p, ids);
  const e = etendue(choisies);
  if (!e) return;
  const [a, b] = e;
  const piste = seq.pistes[p];
  for (const n of choisies) {
    n.d = a + Math.round((n.d - a) * facteur);
    n.l = Math.max(1, Math.round(n.l * facteur));
  }
  const ecart = a + Math.round((b - a) * facteur) - b;
  for (const n of piste.notes) if (!choisies.includes(n) && n.d >= b) n.d += ecart;
  trier(piste);
}

/** À l'envers : la dernière note devient la première. */
export function retrograder(seq, p, ids) {
  const choisies = notesDe(seq, p, ids);
  const e = etendue(choisies);
  if (!e) return;
  const [a, b] = e;
  for (const n of choisies) n.d = a + (b - (n.d + n.l));
  trier(seq.pistes[p]);
}

/** En miroir autour de la première note : ce qui montait descend. */
export function renverser(seq, p, ids) {
  const choisies = notesDe(seq, p, ids);
  if (!choisies.length) return;
  const pivot = [...choisies].sort((x, y) => x.d - y.d || y.h - x.h)[0].h;
  for (const n of choisies) n.h = borner(2 * pivot - n.h);
  trier(seq.pistes[p]);
}

/** Recale débuts et durées sur la grille (en pas). */
export function recaler(seq, p, ids, grille) {
  for (const n of notesDe(seq, p, ids)) {
    const d = Math.round(n.d / grille) * grille;
    const f = Math.round((n.d + n.l) / grille) * grille;
    n.d = d;
    n.l = Math.max(grille, f - d);
  }
  trier(seq.pistes[p]);
}

/**
 * Des notes jouées en direct (début et fin en pas, fractionnaires, depuis
 * le premier temps) → des notes recalées sur la grille (en pas). Une note
 * trop courte prend un pas de grille. Une note qui déborde à peine sur la
 * suivante (jeu lié) s'arrête où l'autre commence ; deux fois la même
 * hauteur ne se chevauchent jamais.
 */
export function quantifier(evenements, { grille = 2, origine = 0 } = {}) {
  const notes = [];
  for (const e of [...evenements].sort((x, y) => x.debut - y.debut)) {
    let d = Math.round(e.debut / grille) * grille;
    let f = Math.round(e.fin / grille) * grille;
    if (d < 0) { if (f <= 0) continue; d = 0; }
    if (f <= d) f = d + grille;
    notes.push({ d: d + origine, l: f - d, h: e.h, v: e.v });
  }
  for (const n of notes) {
    const suivante = notes.find((m) => m !== n && m.d > n.d && m.d < n.d + n.l && (m.h === n.h || n.d + n.l - m.d <= grille));
    if (suivante) n.l = suivante.d - n.d;
  }
  return notes;
}
