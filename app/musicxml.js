/**
 * LE MUSICXML (pour MuseScore, Sibelius, Dorico…)
 *
 * La même mise en mesures que la partition (sequence.js : mesures, couches,
 * liaisons, altérations), écrite en MusicXML 4.0 : une partie par portée
 * (la mélodie, les pistes de l'idée, l'accompagnement), les accords en
 * symboles (<harmony>), le tempo, l'armure et la mesure, et leurs
 * changements d'une section à l'autre (les blocs d'un morceau, les
 * changements d'une page lue). Une couche du dessous devient une seconde
 * voix de la même portée.
 *
 * Sans dépendance (appli et tests) : abcjs, pour lire une page, est passé en
 * paramètre.
 */
import { mettreEnMesures, lirePage, pasParTemps, auPas } from "./sequence.js";
import { lireAccord, tonaliteTransposee } from "./harmonie.js";

const TYPES = { 1: ["16th", 0], 2: ["eighth", 0], 3: ["eighth", 1], 4: ["quarter", 0], 6: ["quarter", 1], 8: ["half", 0], 12: ["half", 1], 16: ["whole", 0], 24: ["whole", 1] };
const SIGNES = { "-2": "flat-flat", "-1": "flat", 0: "natural", 1: "sharp", 2: "double-sharp" };
// La sorte d'accord (<kind>) et ce qu'elle ne dit pas (<degree>) : MusicXML
// n'a pas de « 7sus4 » ni d'« add9 ». Sans les degrés, MuseScore lisait
// « Gsus » pour G7sus4 et un accord parfait pour Cadd9.
const SORTES = {
  "": ["major"], m: ["minor"], 7: ["dominant"], maj7: ["major-seventh"], m7: ["minor-seventh"], dim: ["diminished"],
  dim7: ["diminished-seventh"], m7b5: ["half-diminished"], aug: ["augmented"], sus2: ["suspended-second"],
  sus4: ["suspended-fourth"], "7sus4": ["suspended-fourth", [7, -1]], 6: ["major-sixth"], m6: ["minor-sixth"],
  9: ["dominant-ninth"], add9: ["major", [9, 0]], madd9: ["minor", [9, 0]], m9: ["minor-ninth"],
};

const echapper = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** <root>, <kind>, <degree>, <bass> d'un symbole d'accord (« F#m7/E »). */
function harmonie(nom) {
  const a = lireAccord(nom);
  const m = /^([A-G])([#b]?)[^/]*(?:\/([A-G])([#b]?))?$/.exec(nom);
  if (!a || !m) return "";
  const alt = (x) => (x === "#" ? 1 : x === "b" ? -1 : 0);
  const [sorte, degre] = SORTES[a.qualite] || ["major"];
  const racine = `<root><root-step>${m[1]}</root-step>${alt(m[2]) ? `<root-alter>${alt(m[2])}</root-alter>` : ""}</root>`;
  const basse = m[3] ? `<bass><bass-step>${m[3]}</bass-step>${alt(m[4]) ? `<bass-alter>${alt(m[4])}</bass-alter>` : ""}</bass>` : "";
  const ajout = degre ? `<degree><degree-value>${degre[0]}</degree-value><degree-alter>${degre[1]}</degree-alter><degree-type>add</degree-type></degree>` : "";
  return `<harmony print-frame="no">${racine}<kind text="${echapper(a.qualite)}">${sorte}</kind>${basse}${ajout}</harmony>`;
}

/**
 * Le tempo, dans l'unité du temps : la noire, ou la noire pointée en 6/8,
 * 9/8 et 12/8 (90 à la noire y devient 60 à la noire pointée). <sound> dit
 * toujours le tempo à la noire, comme le veut MusicXML.
 */
function metronome(tempo, mesure) {
  const compose = pasParTemps({ mesure }) === 6;
  const parMinute = compose ? Math.round((tempo * 2) / 3) : tempo;
  return `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>${compose ? "<beat-unit-dot/>" : ""}<per-minute>${parMinute}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>`;
}

/**
 * @param seq      l'idée (sequence.js), ou ce qui en tient lieu (un morceau assemblé)
 * @param voix     ses voix (pistes, accompagnement compris : voixCompletes)
 * @param sections les changements de mesure et de tonalité : [{ d, mesure, tonalite, barre? }]
 * @returns le texte du fichier .musicxml
 */
export function ecrireMusicXml(seq, { voix = seq.pistes, titre = "Idée", sections = null } = {}) {
  const { mesures, nb, accords, portees, cles, parVoix } = mettreEnMesures(seq, { voix, sections });
  const lignes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${echapper(titre)}</work-title></work>`,
    '<identification><encoding><software>Portée</software></encoding></identification>',
    "<part-list>",
    ...portees.map((v, i) => `<score-part id="P${i + 1}"><part-name>${echapper(v.nom || `Voix ${i + 1}`)}</part-name><score-instrument id="P${i + 1}-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="P${i + 1}-I1"><midi-channel>${i + 1}</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>`),
    "</part-list>",
  ];
  parVoix.forEach((lesCouches, iv) => {
    lignes.push(`<part id="P${iv + 1}">`);
    for (let m = 0; m < nb; m++) {
      const me = mesures[m];
      // Une levée (une mesure incomplète en tête de section) ne compte pas dans la numérotation.
      lignes.push(`<measure number="${m + 1}"${me.levee ? ' implicit="yes"' : ""}>`);
      const cle = cles[iv] === "fa" ? "<sign>F</sign><line>4</line>" : "<sign>G</sign><line>2</line>";
      const armure = `<key><fifths>${me.k.quintes}</fifths><mode>${me.k.mineur ? "minor" : "major"}</mode></key>`;
      const chiffrage = `<time><beats>${me.mesure[0]}</beats><beat-type>${me.mesure[1]}</beat-type></time>`;
      if (m === 0) lignes.push(`<attributes><divisions>4</divisions>${armure}${chiffrage}<clef>${cle}</clef></attributes>`);
      else if (me.change.mesure || me.change.tonalite) lignes.push(`<attributes>${me.change.tonalite ? armure : ""}${me.change.mesure ? chiffrage : ""}</attributes>`);
      // Le tempo au début, et de nouveau quand l'unité du temps change (4/4 → 6/8 : la noire devient la noire pointée).
      const avant = m > 0 && mesures[m - 1];
      if (iv === 0 && (m === 0 || (me.change.mesure && pasParTemps(me) !== pasParTemps(avant) && (pasParTemps(me) === 6 || pasParTemps(avant) === 6)))) lignes.push(metronome(seq.tempo, me.mesure));
      lesCouches.forEach((couche, ic) => {
        // Une couche de plus : on revient au début de la mesure, sur une autre voix.
        if (ic > 0) lignes.push(`<backup><duration>${me.longueur}</duration></backup>`);
        for (const t of couche[m]) {
          if (iv === 0 && ic === 0 && accords.has(t.a)) lignes.push(harmonie(accords.get(t.a)));
          if (t.silence && ic > 0) { lignes.push(`<forward><duration>${t.l}</duration><voice>${ic + 1}</voice></forward>`); continue; }
          const [type, point] = TYPES[t.l];
          const fin = `<duration>${t.l}</duration>`;
          if (t.silence) { lignes.push(`<note><rest/>${fin}<voice>${ic + 1}</voice><type>${type}</type>${point ? "<dot/>" : ""}</note>`); continue; }
          t.notes.forEach((n, i) => {
            const liaisons = [n.suite ? "stop" : null, t.lie ? "start" : null].filter(Boolean);
            lignes.push("<note>"
              + (i > 0 ? "<chord/>" : "")
              + `<pitch><step>${n.e.lettre}</step>${n.e.alt ? `<alter>${n.e.alt}</alter>` : ""}<octave>${n.e.octave}</octave></pitch>`
              + fin
              + liaisons.map((x) => `<tie type="${x}"/>`).join("")
              + `<voice>${ic + 1}</voice><type>${type}</type>${point ? "<dot/>" : ""}`
              + (n.signe !== null ? `<accidental>${SIGNES[n.signe]}</accidental>` : "")
              + (liaisons.length ? `<notations>${liaisons.map((x) => `<tied type="${x}"/>`).join("")}</notations>` : "")
              + "</note>");
          });
        }
      });
      if (m === nb - 1) lignes.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
      lignes.push("</measure>");
    }
    lignes.push("</part>");
  });
  lignes.push("</score-partwise>", "");
  return lignes.join("\n");
}

/**
 * Le MusicXML d'une page lue : ses notes recalées au pas, ses changements
 * de tonalité et de mesure là où la page les fait (une levée devient une
 * mesure incomplète), et la transposition choisie à l'écoute, comme le MIDI.
 *
 * Un triolet s'y arrondit (double, croche, double) : la mise en mesures est
 * celle des idées, qui vivent au pas. Le garder demanderait des n-olets
 * dans cette mise en mesures (des durées en tiers de pas, <time-modification>) ;
 * le MIDI de la page, lui, le garde exact.
 * @param lib abcjs
 */
export function musicXmlDeLaPage(abc, lib, { tempo = null, transposition = 0, titre = "Page" } = {}) {
  const page = lirePage(abc, lib);
  const borner = (h) => Math.max(0, Math.min(127, h + transposition));
  let id = 1;
  const voix = page.voix.map((v, i, toutes) => ({
    nom: toutes.length === 2 ? ["Main droite", "Main gauche"][i] : toutes.length === 1 ? "Mélodie" : `Voix ${i + 1}`,
    notes: v.notes.map((n) => ({ id: id++, ...auPas(n), h: borner(n.h) })),
  }));
  // Une mesure libre (« M:none ») se découpe en 4/4, comme le fait abcjs. Un
  // changement de tonalité seul ne coupe pas une mesure : il prend effet à la
  // barre qui suit ; un changement de mesure commence sur sa levée.
  const sections = [];
  for (const s of page.sections) {
    const avant = sections.at(-1);
    const mesure = s.mesure || (avant ? avant.mesure : [4, 4]);
    const tonalite = tonaliteTransposee(s.tonalite, transposition);
    if (!avant) { sections.push({ d: 0, mesure, tonalite }); continue; }
    const changeDeMesure = String(mesure) !== String(avant.mesure);
    const d = Math.round(changeDeMesure ? s.d : s.barre), barre = Math.round(s.barre);
    if (d <= avant.d) { Object.assign(avant, { mesure, tonalite }); continue; }
    sections.push({ d, barre, mesure, tonalite });
  }
  const seq = { tempo: tempo || page.tempo, mesure: sections[0].mesure, tonalite: sections[0].tonalite, pistes: voix, accords: [] };
  return ecrireMusicXml(seq, { voix, titre, sections });
}
