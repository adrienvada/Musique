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
import { epellationsDeLAccord } from "./accords.js";

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

/**
 * Comment écrire la hauteur `h` dans la tonalité : { lettre, alt, octave }
 * (do4 = 60). Dans l'ordre :
 *   1. la note de la gamme, telle que l'armure l'écrit ;
 *   2. la note de l'accord en cours (`accord` : epellationsDeLAccord), comme
 *      l'accord l'écrit : fa♯ dans un ré 7 en fa majeur, pas sol♭ ;
 *   3. en mineur, la sixte et la sensible haussées (sol♯ en la mineur) ;
 *   4. une note étrangère : le bécarre d'abord, puis le sens de la ligne
 *      (`sens` : +1 si elle monte, −1 si elle descend : do ré♭ do mais do do♯
 *      ré), et à défaut celui de l'armure.
 */
export function epeler(h, tonalite = "C", { accord = null, sens = 0 } = {}) {
  const k = lireTonalite(tonalite);
  const pc = mod12(h);
  let choix = null;
  for (const l of LETTRES) {
    const alt = k.armure[l] || 0;
    if (mod12(NATUREL[l] + alt) === pc) { choix = { lettre: l, alt }; break; }
  }
  if (!choix && accord) {
    const a = accord.find((x) => x.pc === pc && Math.abs(x.alt) <= 2);
    if (a) choix = { lettre: a.lettre, alt: a.alt };
  }
  if (!choix && k.mineur) {
    const iTonique = LETTRES.indexOf(k.tonique[0]);
    for (const [degre, ecart] of [[6, 11], [5, 9]]) {
      if (mod12(k.pc + ecart) !== pc) continue;
      const l = LETTRES[(iTonique + degre) % 7];
      choix = { lettre: l, alt: (k.armure[l] || 0) + 1 };
    }
  }
  if (!choix) {
    const s = sens || (k.quintes > 0 ? 1 : k.quintes < 0 ? -1 : (k.mineur && pc === 8 ? 1 : PREFERENCE_DO[pc] ?? 1));
    const candidats = [];
    for (const alt of [0, s, -s]) for (const l of LETTRES) if (mod12(NATUREL[l] + alt) === pc) candidats.push({ lettre: l, alt });
    choix = candidats[0];
  }
  return { ...choix, octave: Math.round((h - NATUREL[choix.lettre] - choix.alt) / 12) - 1 };
}

/**
 * Le sens de la ligne autour de la note `n` : +1 si elle monte vers la
 * suivante (ou vient d'en dessous), −1 si elle descend, 0 si rien ne le dit.
 * La suivante est la note la plus proche en hauteur parmi celles qui
 * commencent juste après (une mélodie au-dessus d'un accord tenu suit sa
 * propre ligne). `groupes` : les notes de la voix par début, dans l'ordre ;
 * `i` : le groupe de `n`.
 */
function sensDeLaLigne(groupes, i, n) {
  const voisine = (g) => g && g.reduce((m, x) => (!m || Math.abs(x.h - n.h) < Math.abs(m.h - n.h) ? x : m), null);
  const s = voisine(groupes[i + 1]);
  if (s && s.h !== n.h) return Math.sign(s.h - n.h);
  const p = voisine(groupes[i - 1]);
  if (p && p.h !== n.h) return Math.sign(n.h - p.h);
  return 0;
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

// Les durées qu'on sait écrire d'un seul signe, en pas : ronde pointée
// (la mesure entière d'un 12/8), ronde, blanche pointée, blanche, noire
// pointée, noire, croche pointée, croche, double.
const NOTABLES = [24, 16, 12, 8, 6, 4, 3, 2, 1];

/**
 * Coupe [a, b[ (dans une seule mesure) en durées notables.
 * - Une note qui commence à contretemps s'arrête au temps suivant, puis
 *   repart liée : c'est ce qui rend une syncope lisible.
 * - En mesure composée (6/8, 9/8, 12/8 : le temps est une noire pointée,
 *   6 pas), une note qui part sur un temps n'y prend d'abord qu'un nombre
 *   entier de temps (noire, blanche ou ronde pointée), puis le reste. Sinon
 *   le plus grand signe cachait un temps : quatre croches en tête d'un 6/8
 *   devenaient une blanche, qui ne se termine pas sur le deuxième temps.
 */
function fragmenter(a, b, debutMesure, temps) {
  const morceaux = [];
  const compose = temps === 6;
  let x = a;
  while (x < b) {
    let y = b;
    const dedans = x - debutMesure;
    if (dedans % temps !== 0) y = Math.min(y, debutMesure + (Math.floor(dedans / temps) + 1) * temps);
    let l = NOTABLES.find((d) => d <= y - x);
    if (compose && dedans % temps === 0 && y - x >= temps) l = NOTABLES.find((d) => d % temps === 0 && d <= y - x);
    morceaux.push([x, x + l]);
    x += l;
  }
  return morceaux;
}

/**
 * La ligature : les croches d'un même groupe se lient. Le groupe est le
 * temps, sauf en 3/8, où les trois croches de la mesure se lient ensemble
 * (le temps y reste la croche, pour le métronome et le découpage).
 */
function groupeDeLigature(seq) {
  const [n, d] = seq.mesure;
  return n === 3 && d === 8 ? 6 : pasParTemps(seq);
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
 * vient du jeton précédent. `mesures` : la liste des mesures (lesMesures).
 */
function decouperCouche(evenements, { mesures, total, coupures, epellation }) {
  const bornes = new Set([0, total, ...coupures, ...mesures.map((m) => m.debut)]);
  for (const e of evenements) { bornes.add(e.d); bornes.add(e.d + e.l); }
  const liste = [...bornes].filter((x) => x >= 0 && x <= total).sort((a, b) => a - b);
  const parMesure = mesures.map(() => []);
  let im = 0;
  for (let i = 0; i + 1 < liste.length; i++) {
    const a = liste[i], b = liste[i + 1];
    while (im + 1 < mesures.length && mesures[im + 1].debut <= a) im++;
    const e = evenements.find((x) => x.d <= a && x.d + x.l > a);
    for (const [x, y] of fragmenter(a, b, mesures[im].debut, mesures[im].temps)) {
      parMesure[im].push({
        a: x, l: y - x, silence: !e, lie: !!e && e.d + e.l > y,
        // L'épellation est celle de la note entière : un morceau lié garde la même.
        notes: e ? e.notes.map((n) => ({ id: n.id, h: n.h, suite: e.d < x, e: epellation.get(n) })) : [],
      });
    }
  }
  return parMesure;
}

/**
 * Les mesures de la partition, de 0 à `total` : [{ debut, longueur, mesure,
 * temps, ligature, tonalite, k, change: { mesure, tonalite } }]. `sections` :
 * [{ d, mesure, tonalite }], triées, la première en 0 ; une idée n'en a
 * qu'une, un morceau une par bloc qui change de mesure ou de tonalité.
 * `change` dit ce qu'une mesure change par rapport à la précédente (pour le
 * MusicXML) ; la toute première change tout.
 */
function lesMesures(sections, total) {
  const mesures = [];
  sections.forEach((s, i) => {
    const jusque = i + 1 < sections.length ? Math.min(total, sections[i + 1].d) : total;
    const longueur = (s.mesure[0] * 16) / s.mesure[1];
    const info = { mesure: s.mesure, temps: pasParTemps(s), ligature: groupeDeLigature(s), tonalite: s.tonalite, k: lireTonalite(s.tonalite) };
    for (let x = s.d; x < jusque; x += longueur) {
      const avant = mesures.at(-1);
      mesures.push({
        debut: x, longueur: Math.min(longueur, jusque - x), ...info,
        change: {
          mesure: !avant || avant.mesure.join("/") !== s.mesure.join("/"),
          tonalite: !avant || avant.tonalite !== s.tonalite,
        },
      });
    }
  });
  return mesures;
}

/** Où finissent les mesures qui contiennent `derniere` (pas), d'après les sections. */
function finDesMesures(sections, derniere) {
  const s = [...sections].reverse().find((x) => x.d <= Math.max(0, derniere - 1)) || sections[0];
  const longueur = (s.mesure[0] * 16) / s.mesure[1];
  return s.d + Math.max(1, Math.ceil((derniere - s.d) / longueur)) * longueur;
}

/**
 * L'épellation de chaque note des voix (Map note → { lettre, alt, octave }),
 * d'après la tonalité, l'accord posé au moment où elle commence et le sens
 * de sa ligne. L'accompagnement, fait des notes des accords, s'écrit donc
 * comme ses accords.
 */
function epellationsDesVoix(seq, voix, sections) {
  // Ce qui vaut au pas `d` : le dernier élément de la liste (triée) qui commence avant.
  const enVigueur = (liste) => (d) => {
    let r = null;
    for (const x of liste) { if (x.d > d) break; r = x; }
    return r;
  };
  const accordA = enVigueur((seq.accords || []).filter((a) => epellationsDeLAccord(a.nom).length).sort((a, b) => a.d - b.d)
    .map((a) => ({ d: a.d, notes: epellationsDeLAccord(a.nom) })));
  const sectionA = enVigueur(sections);
  const epellation = new Map();
  for (const v of voix) {
    const parDebut = new Map();
    for (const n of [...v.notes].sort((a, b) => a.d - b.d)) {
      if (!parDebut.has(n.d)) parDebut.set(n.d, []);
      parDebut.get(n.d).push(n);
    }
    const groupes = [...parDebut.values()];
    groupes.forEach((g, i) => {
      for (const n of g) {
        const accord = accordA(n.d);
        epellation.set(n, epeler(n.h, (sectionA(n.d) || sections[0]).tonalite, { accord: accord && accord.notes, sens: sensDeLaLigne(groupes, i, n) }));
      }
    });
  }
  return epellation;
}

/** La clé d'une voix : celle qu'on lui a donnée, sinon d'après sa hauteur moyenne. */
function cleDe(voix, rang) {
  if (voix.cle) return voix.cle;
  if (!voix.notes.length) return rang === 0 ? "sol" : "fa";
  const hauteurs = voix.notes.map((n) => n.h).sort((a, b) => a - b);
  return hauteurs[Math.floor(hauteurs.length / 2)] < 55 ? "fa" : "sol";
}

/**
 * L'idée mise en mesures, commune à la partition (ABC) et au MusicXML :
 * pour chaque voix, ses couches, mesure par mesure, en jetons notables.
 * Chaque note porte son épellation (`e`) et l'altération à écrire
 * (`signe`, null si l'armure ou la mesure la donnent déjà).
 *
 * L'épellation se fait note par note, avec l'accord en cours et le sens de
 * la ligne (epeler) : la même hauteur peut s'écrire fa♯ sous un ré 7 et
 * sol♭ dans une ligne qui descend vers fa.
 *
 * Les voix qui partagent une `portee` (l'accompagnement : ses accords et sa
 * basse) se gravent ensemble, sur une seule portée. `sections` (un morceau
 * dont les blocs changent de mesure ou de tonalité) : [{ d, mesure,
 * tonalite }], la première en 0 ; par défaut, celles de l'idée.
 */
export function mettreEnMesures(seq, { voix = seq.pistes, mesuresEnPlus = 0, sections = null } = {}) {
  const lesSections = sections && sections.length ? sections : [{ d: 0, mesure: seq.mesure, tonalite: seq.tonalite }];
  let total = finDesMesures(lesSections, finSequence(seq));
  const derniereSection = lesSections.at(-1);
  total += mesuresEnPlus * ((derniereSection.mesure[0] * 16) / derniereSection.mesure[1]);
  const mesures = lesMesures(lesSections, total);
  const nb = mesures.length;
  const accords = new Map((seq.accords || []).filter((a) => a.d < total).map((a) => [a.d, a.nom]));
  const coupures = [...accords.keys()];
  const epellation = epellationsDesVoix(seq, voix, lesSections);
  // Les voix d'une même portée se rassemblent (leurs notes passent par les mêmes couches).
  const portees = [];
  for (const v of voix) {
    const p = v.portee !== undefined && portees.find((x) => x.portee === v.portee);
    if (p) p.notes = [...p.notes, ...v.notes];
    else portees.push({ ...v, notes: [...v.notes] });
  }
  // Les changements d'accord ne coupent que la couche qui porte leurs symboles.
  const parVoix = portees.map((v, iv) => couches(v.notes).map((c, ic) => decouperCouche(c, { mesures, total, coupures: iv === 0 && ic === 0 ? coupures : [], epellation })));
  for (const lesCouches of parVoix) {
    for (let m = 0; m < nb; m++) {
      const k = mesures[m].k;
      // Une altération vaut jusqu'à la barre, pour la même note à la même
      // octave. abcjs l'oublie d'une couche à l'autre : une note déjà
      // altérée dans une autre couche redit la sienne.
      const dejaAlterees = new Set();
      for (const couche of lesCouches) {
        const ecrites = new Map([...dejaAlterees].map((cle) => [cle, NaN]));
        for (const t of couche[m]) {
          for (const n of t.notes) {
            const cle = n.e.lettre + n.e.octave;
            n.signe = null;
            if (n.suite) {
              // Une note liée garde sa hauteur sans redire l'altération. Après
              // la barre, la même note non liée redira la sienne.
              if (!ecrites.has(cle)) ecrites.set(cle, NaN);
            } else {
              const enVigueur = ecrites.has(cle) ? ecrites.get(cle) : (k.armure[n.e.lettre] || 0);
              if (enVigueur !== n.e.alt) { n.signe = n.e.alt; ecrites.set(cle, n.e.alt); }
            }
          }
        }
        for (const [cle, alt] of ecrites) if (!Number.isNaN(alt)) dejaAlterees.add(cle);
      }
    }
  }
  const premiere = mesures[0];
  return {
    k: premiere.k, mesure: premiere.longueur, temps: premiere.temps, ligature: premiere.ligature,
    mesures, total, nb, accords, portees: portees.map((p) => ({ nom: p.nom, cle: p.cle })), cles: portees.map((v, i) => cleDe(v, i)), parVoix,
  };
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
  const { mesures, nb, accords, cles, parVoix } = mettreEnMesures(seq, { voix, mesuresEnPlus });
  const entete = ["X:1"];
  if (titre) entete.push("T:" + titre.replace(/\n/g, " "));
  entete.push(`M:${seq.mesure[0]}/${seq.mesure[1]}`, "L:1/8", `Q:1/4=${seq.tempo}`, `K:${seq.tonalite}`);
  const avecVoix = parVoix.length > 1 || cles[0] !== "sol";
  if (avecVoix) parVoix.forEach((_, i) => entete.push(`V:${i + 1} clef=${cles[i] === "fa" ? "bass" : "treble"}`));
  let abc = entete.join("\n") + "\n";
  const jetons = [];

  for (let m0 = 0; m0 < nb; m0 += mesuresParLigne) {
    parVoix.forEach((lesCouches, iv) => {
      // Le premier élément d'une ligne commence, pour abcjs, dans « [V:1] ».
      let debutLigne = abc.length;
      if (avecVoix) abc += `[V:${iv + 1}] `;
      for (let m = m0; m < Math.min(nb, m0 + mesuresParLigne); m++) {
        lesCouches.forEach((couche, ic) => {
          // Une couche s'écrit dans toutes les mesures, même vide : sinon
          // abcjs y invente un silence qui ne renvoie à rien.
          if (ic > 0) abc += " &";
          let precedent = null;
          const { debut: debutMesure, ligature: groupe } = mesures[m];
          for (const t of couche[m]) {
            const dedans = t.a - debutMesure;
            const ligature = precedent && !t.silence && !precedent.silence && t.l < 4 && precedent.l < 4
              && Math.floor(dedans / groupe) === Math.floor((precedent.a - debutMesure) / groupe);
            // abcjs fait commencer l'élément à l'espace, ou au symbole d'accord, qui le précède.
            const avant = debutLigne ?? abc.length;
            debutLigne = null;
            if (!ligature && !/[\n ]$/.test(abc)) abc += " ";
            if (iv === 0 && ic === 0 && accords.has(t.a)) abc += `"${accords.get(t.a)}"`;
            const debut = abc.length;
            abc += texteJeton(t, ic > 0);
            jetons.push({ avant, debut, fin: abc.length, voix: iv, couche: ic, a: t.a, l: t.l, ids: t.notes.map((n) => n.id), silence: t.silence });
            precedent = t;
          }
        });
        abc += m === nb - 1 ? " |]" : " |";
      }
      abc += "\n";
    });
  }
  return { abc, jetons };
}

function texteJeton(t, invisible) {
  const duree = dureeABC(t.l / 2); // L:1/8 : une croche = deux pas
  // Dans une couche du dessous, les silences ne s'affichent pas (« x »).
  if (t.silence) return (invisible ? "x" : "z") + duree;
  const notes = t.notes.map((n) => (n.signe === null ? "" : ALT_ABC[n.signe]) + lettreAbc(n.e));
  // La liaison suit la durée et vaut pour tout l'accord : « F4- », « [CEG]2- ».
  return (notes.length > 1 ? "[" + notes.join("") + "]" : notes[0]) + duree + (t.lie ? "-" : "");
}

/** Le jeton de la partition à la position `pos` de l'ABC (startChar d'abcjs). */
export function jetonA(jetons, pos) {
  return jetons.find((j) => pos >= j.avant && pos < j.fin) || null;
}

// ------------------------------------------------------------------------
// Une page lue (ABC) en notes
// ------------------------------------------------------------------------

const MINEURS = /^(m|min|minor|aeo|aeolian)$/i;

/** La tonalité d'une clé d'abcjs ({ root, acc, mode }) ou d'un champ K: : « Eb », « F#m ». */
function tonaliteAbc(cle) {
  if (!cle || !/^[A-G]$/.test(cle.root || "")) return "C";
  return cle.root + (cle.acc === "sharp" || cle.acc === "#" ? "#" : cle.acc === "flat" || cle.acc === "b" ? "b" : "") + (MINEURS.test(cle.mode || "") ? "m" : "");
}

/** La mesure d'un chiffrage d'abcjs : [n, d] ; null si elle ne se lit pas. */
function mesureAbc(m) {
  if (!m) return null;
  if (m.type === "common_time") return [4, 4];
  if (m.type === "cut_time") return [2, 2];
  const v = m.value && m.value[0];
  const n = v && String(v.num).split("+").reduce((s, x) => s + Number(x), 0), d = v && Number(v.den);
  return n > 0 && [1, 2, 4, 8, 16].includes(d) ? [n, d] : null;
}

/** La durée écrite d'un élément d'abcjs (en rondes), triolets compris. */
const dureeEcrite = (e, triolet) => (e.el_type === "note" && e.duration ? e.duration * triolet : 0);

/**
 * Une page lue (son ABC) jouée par abcjs (passé en paramètre) : ses voix en
 * notes au temps exact, reprises dépliées, et ce qu'il faut pour l'écrire
 * ailleurs (MIDI, idée, MusicXML). Les temps sont en pas, fractionnaires :
 * un triolet de croches dure 4/3 de pas.
 *
 * Une levée en tête de page tombe à la fin d'une mesure de silences, comme
 * dans une idée : tout est décalé pour que la première barre de la page
 * tombe sur une barre.
 *
 * @returns { voix: [{ notes: [{ d, l, h, v }] }] (les voix qui jouent),
 *   tempo, sections: [{ d, barre, mesure (null : mesure libre, « M:none »),
 *   tonalite }] } : une section par changement de tonalité ou de mesure en
 *   cours de page (« [K:Eb][M:12/8] »), qui commence en `d` et a sa première
 *   barre en `barre` (sa levée est entre les deux).
 */
export function lirePage(abc, lib) {
  const [tune] = lib.parseOnly(abc);
  const audio = tune.setUpAudio({ chordsOff: true });
  const q = /^Q:\s*(?:(\d+)\/(\d+)\s*=\s*)?(\d+)/m.exec(abc);
  const tempo = q ? Math.round(Number(q[3]) * (q[1] ? (4 * Number(q[1])) / Number(q[2]) : 1)) : 90;
  const k = /^K:\s*([A-G])([#b]?)\s*([A-Za-z]*)/m.exec(abc);
  const enTete = {
    tonalite: k ? tonaliteAbc({ root: k[1], acc: k[2], mode: k[3] }) : "C",
    // abcjs prend « M:none » pour du 4/4 : la mesure libre se lit dans l'en-tête.
    mesure: /^M:\s*none\b/im.test(abc) ? null : mesureAbc(tune.getMeter()) || [4, 4],
  };
  // Les éléments de la première voix de la première portée, dans l'ordre
  // écrit, avec la clé et le chiffrage de chaque début de ligne.
  const elements = [];
  for (const l of tune.lines) {
    if (!l.staff || !l.staff.length) continue;
    const st = l.staff[0];
    if (st.key) elements.push({ el_type: "key", ...st.key });
    if (st.meter) elements.push({ el_type: "meter", ...st.meter });
    elements.push(...((st.voices && st.voices[0]) || []));
  }
  // L'instant joué de chaque note écrite (sa première fois, si une reprise la répète).
  const jouee = new Map();
  for (const e of audio.tracks[0] || []) if (e.cmd === "note" && e.startChar !== undefined && !jouee.has(e.startChar)) jouee.set(e.startChar, e.start);
  // Depuis l'élément i : la durée écrite jusqu'à la première note jouée (ses silences), et jusqu'à la première barre.
  const avancer = (i) => {
    let t = 0, triolet = 1, avantNote = null, avantBarre = null;
    for (let j = i; j < elements.length && (avantNote === null || avantBarre === null); j++) {
      const e = elements[j];
      if (e.el_type === "bar" && avantBarre === null) avantBarre = t;
      if (e.startTriplet) triolet = e.tripletMultiplier || 1;
      if (avantNote === null && e.el_type === "note" && e.pitches && jouee.has(e.startChar)) avantNote = { t, debut: jouee.get(e.startChar) };
      t += dureeEcrite(e, triolet);
      if (e.endTriplet) triolet = 1;
    }
    return { avantNote, avantBarre };
  };
  const sections = [{ d: 0, barre: 0, ...enTete }];
  let courante = { ...enTete };
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    if (e.el_type !== "key" && e.el_type !== "meter") continue;
    const nouvelle = { ...courante };
    if (e.el_type === "key") nouvelle.tonalite = tonaliteAbc(e);
    else nouvelle.mesure = mesureAbc(e) || courante.mesure;
    if (nouvelle.tonalite === courante.tonalite && String(nouvelle.mesure) === String(courante.mesure)) continue;
    // Un [K:] et un [M:] côte à côte font une seule section.
    let j = i + 1;
    while (j < elements.length && (elements[j].el_type === "key" || elements[j].el_type === "meter")) {
      if (elements[j].el_type === "key") nouvelle.tonalite = tonaliteAbc(elements[j]);
      else nouvelle.mesure = mesureAbc(elements[j]) || nouvelle.mesure;
      j++;
    }
    // Juste après une barre (« C8|[M:3/4]D6| »), la section commence sur sa
    // première barre ; sinon (« B2 c2 [M:12/8]G | ») sa levée va jusqu'à la suivante.
    let p = i - 1;
    while (p >= 0 && (elements[p].el_type === "key" || elements[p].el_type === "meter")) p--;
    const surUneBarre = p < 0 || elements[p].el_type === "bar";
    i = j - 1;
    const { avantNote, avantBarre } = avancer(j);
    if (!avantNote) break; // plus rien ne joue après le changement
    const d = (avantNote.debut - avantNote.t) * 16;
    courante = nouvelle;
    if (d <= 0) { Object.assign(sections[0], nouvelle); continue; }
    sections.push({ d, barre: surUneBarre ? d : d + (avantBarre ?? avantNote.t) * 16, ...nouvelle });
  }
  // La levée d'en-tête : ce qui précède la première barre, s'il manque de quoi faire une mesure.
  let decalage = 0;
  if (sections[0].mesure) {
    const longueur = (sections[0].mesure[0] * 16) / sections[0].mesure[1];
    const { avantBarre } = avancer(0);
    const levee = avantBarre === null ? 0 : (avantBarre * 16) % longueur;
    if (levee > 1e-9 && longueur - levee > 1e-9) decalage = longueur - levee;
    sections[0].barre = avantBarre === null ? 0 : avantBarre * 16 + decalage;
  }
  for (const s of sections.slice(1)) { s.d += decalage; s.barre += decalage; }
  const voix = audio.tracks
    .map((t) => ({ notes: t.filter((e) => e.cmd === "note" && e.pitch >= 0).map((e) => ({ d: e.start * 16 + decalage, l: e.duration * 16, h: e.pitch, v: e.volume })) }))
    .filter((v) => v.notes.length);
  return { voix, tempo, sections };
}

// Les tonalités qu'une idée ne propose pas, et leur nom dans le menu (les notes ne changent pas).
const ENHARMONIQUES = { Gb: "F#", "C#": "Db", Cb: "B", "G#": "Ab", "D#": "Eb", "A#": "Bb", Fb: "E", "E#": "F", "B#": "C", "D#m": "Ebm", "A#m": "Bbm", Dbm: "C#m", Gbm: "F#m", Abm: "G#m", "E#m": "Fm", "B#m": "Cm" };

/**
 * Une page lue devenue idée : abcjs (passé en paramètre) la joue en notes,
 * reprises dépliées. Le tempo vient de Q:. Une idée n'a qu'une mesure et
 * qu'une tonalité : celles de la plus longue section de la page (une page
 * qui commence par une gamme en mesure libre puis passe en 12/8 et en mi♭
 * devient une idée en 12/8 et en mi♭), et ses barres tombent sur celles de
 * l'idée. Les notes sont recalées au pas (une double croche) : un triolet
 * s'y arrondit, c'est la limite d'une idée.
 */
export function sequenceDepuisAbc(abc, lib, { tempo = null } = {}) {
  const page = lirePage(abc, lib);
  const fin = Math.max(0, ...page.voix.flatMap((v) => v.notes.map((n) => n.d + n.l)));
  const duree = (s, i) => (i + 1 < page.sections.length ? page.sections[i + 1].d : fin) - s.d;
  const avecMesure = page.sections.filter((s) => s.mesure);
  const principale = (avecMesure.length ? avecMesure : page.sections)
    .reduce((m, s) => (duree(s, page.sections.indexOf(s)) > duree(m, page.sections.indexOf(m)) ? s : m));
  const mesure = principale.mesure || [4, 4];
  const tonalite = TONALITES.includes(principale.tonalite) ? principale.tonalite : ENHARMONIQUES[principale.tonalite] || "C";
  const longueur = (mesure[0] * 16) / mesure[1];
  const decalage = principale.mesure ? (longueur - (Math.round(principale.barre) % longueur)) % longueur : 0;
  const seq = nouvelleSequence({ tempo: tempo || page.tempo, mesure, tonalite });
  seq.pistes = page.voix.map((v, i, toutes) => ({
    nom: i === 0 ? "Mélodie" : toutes.length === 2 ? "Main gauche" : `Voix ${i + 1}`,
    notes: v.notes.map((n) => ({ id: seq.suivant++, d: Math.round(n.d) + decalage, l: Math.max(1, Math.round(n.l)), h: n.h })),
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
 * trop courte prend un pas de grille. Jeu lié : une note relâchée un pas
 * de grille au plus avant la suivante tient jusqu'à elle, une note qui
 * déborde à peine sur la suivante s'arrête où l'autre commence. Deux fois
 * la même hauteur ne se chevauchent jamais.
 *
 * La dernière note (ou le dernier accord) n'a pas de suivante : c'est la
 * fin du temps où elle commence qui en tient lieu (`temps`, en pas : la
 * noire par défaut), avec la même tolérance. Sans quoi des noires jouées un
 * peu détachées restaient des noires, sauf la dernière, qui devenait une
 * croche. Une note qui dépasse déjà son temps (une syncope) ne bouge pas.
 *
 * Deux attaques de la même note qui tombent sur le même pas n'en font
 * qu'une (la plus longue), comme `poser` l'aurait fait : le compte des notes
 * gardées est celui des notes écrites.
 */
export function quantifier(evenements, { grille = 2, origine = 0, temps = 4 } = {}) {
  const notes = [];
  for (const e of [...evenements].sort((x, y) => x.debut - y.debut)) {
    let d = Math.round(e.debut / grille) * grille;
    let f = Math.round(e.fin / grille) * grille;
    if (d < 0) { if (f <= 0) continue; d = 0; }
    if (f <= d) f = d + grille;
    const double = notes.find((n) => n.d === d + origine && n.h === e.h);
    if (double) { double.l = Math.max(double.l, f - d); continue; }
    notes.push({ d: d + origine, l: f - d, h: e.h, v: e.v });
  }
  for (const n of notes) {
    const suivante = notes.find((m) => m !== n && m.d > n.d && m.d < n.d + n.l && (m.h === n.h || n.d + n.l - m.d <= grille));
    if (suivante) n.l = suivante.d - n.d;
  }
  for (const n of notes) {
    // La note qui suit de plus près (celles qui commencent ensemble forment un accord).
    const apres = notes.filter((m) => m.d > n.d);
    // Après la dernière attaque, c'est la fin de son temps qui joue ce rôle.
    const prochaine = apres.length ? Math.min(...apres.map((m) => m.d)) : origine + (Math.floor((n.d - origine) / temps) + 1) * temps;
    const ecart = prochaine - (n.d + n.l);
    if (ecart > 0 && ecart <= grille) n.l += ecart;
  }
  return notes;
}
