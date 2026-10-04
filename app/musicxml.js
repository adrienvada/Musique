/**
 * LE MUSICXML D'UNE IDÉE (pour MuseScore, Sibelius, Dorico…)
 *
 * La même mise en mesures que la partition (sequence.js : mesures, couches,
 * liaisons, altérations), écrite en MusicXML 4.0 : une partie par voix
 * (mélodie, basse, accompagnement), les accords en symboles (<harmony>), le
 * tempo, l'armure et la mesure. Une couche du dessous devient une seconde
 * voix de la même portée.
 *
 * Sans dépendance (appli et tests).
 */
import { mettreEnMesures } from "./sequence.js";
import { lireAccord } from "./harmonie.js";

const TYPES = { 1: ["16th", 0], 2: ["eighth", 0], 3: ["eighth", 1], 4: ["quarter", 0], 6: ["quarter", 1], 8: ["half", 0], 12: ["half", 1], 16: ["whole", 0], 24: ["whole", 1] };
const SIGNES = { "-2": "flat-flat", "-1": "flat", 0: "natural", 1: "sharp", 2: "double-sharp" };
const SORTES = {
  "": "major", m: "minor", 7: "dominant", maj7: "major-seventh", m7: "minor-seventh", dim: "diminished",
  dim7: "diminished-seventh", m7b5: "half-diminished", aug: "augmented", sus2: "suspended-second",
  sus4: "suspended-fourth", "7sus4": "suspended-fourth", 6: "major-sixth", m6: "minor-sixth",
  9: "dominant-ninth", add9: "major", m9: "minor-ninth",
};

const echapper = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** <root>, <kind>, <bass> d'un symbole d'accord (« F#m7/E »). */
function harmonie(nom) {
  const a = lireAccord(nom);
  const m = /^([A-G])([#b]?)[^/]*(?:\/([A-G])([#b]?))?$/.exec(nom);
  if (!a || !m) return "";
  const alt = (x) => (x === "#" ? 1 : x === "b" ? -1 : 0);
  const racine = `<root><root-step>${m[1]}</root-step>${alt(m[2]) ? `<root-alter>${alt(m[2])}</root-alter>` : ""}</root>`;
  const basse = m[3] ? `<bass><bass-step>${m[3]}</bass-step>${alt(m[4]) ? `<bass-alter>${alt(m[4])}</bass-alter>` : ""}</bass>` : "";
  return `<harmony print-frame="no">${racine}<kind text="${echapper(a.qualite)}">${SORTES[a.qualite] || "major"}</kind>${basse}</harmony>`;
}

/**
 * @param seq    l'idée (sequence.js)
 * @param voix   ses voix (pistes, accompagnement compris : voixCompletes)
 * @returns le texte du fichier .musicxml
 */
export function ecrireMusicXml(seq, { voix = seq.pistes, titre = "Idée" } = {}) {
  const { k, mesure, nb, accords, cles, parVoix } = mettreEnMesures(seq, { voix });
  const lignes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${echapper(titre)}</work-title></work>`,
    '<identification><encoding><software>Portée</software></encoding></identification>',
    "<part-list>",
    ...voix.map((v, i) => `<score-part id="P${i + 1}"><part-name>${echapper(v.nom || `Voix ${i + 1}`)}</part-name><score-instrument id="P${i + 1}-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="P${i + 1}-I1"><midi-channel>${i + 1}</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>`),
    "</part-list>",
  ];
  parVoix.forEach((lesCouches, iv) => {
    lignes.push(`<part id="P${iv + 1}">`);
    for (let m = 0; m < nb; m++) {
      lignes.push(`<measure number="${m + 1}">`);
      if (m === 0) {
        const cle = cles[iv] === "fa" ? "<sign>F</sign><line>4</line>" : "<sign>G</sign><line>2</line>";
        lignes.push(`<attributes><divisions>4</divisions><key><fifths>${k.quintes}</fifths><mode>${k.mineur ? "minor" : "major"}</mode></key><time><beats>${seq.mesure[0]}</beats><beat-type>${seq.mesure[1]}</beat-type></time><clef>${cle}</clef></attributes>`);
        if (iv === 0) lignes.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${seq.tempo}</per-minute></metronome></direction-type><sound tempo="${seq.tempo}"/></direction>`);
      }
      lesCouches.forEach((mesures, ic) => {
        // Une couche de plus : on revient au début de la mesure, sur une autre voix.
        if (ic > 0) lignes.push(`<backup><duration>${mesure}</duration></backup>`);
        for (const t of mesures[m]) {
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
