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
import { RACINES, FORME, lireAccord, epellationsDeLAccord } from "./accords.js";

// La lecture des noms d'accords vit dans accords.js (la partition s'en sert
// aussi) ; on la redonne ici, où l'appli l'a toujours cherchée.
export { lireAccord, QUALITES } from "./accords.js";

const mod12 = (x) => ((x % 12) + 12) % 12;

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

// ---------------------------------------------------------------------------
// La roue : les sept accords de la tonalité, ce qui s'enchaîne, la couleur
// ---------------------------------------------------------------------------
//
// La feuille des accords et le pupitre posent les accords sur une roue de
// sept : un par degré de la gamme, dans l'ordre des degrés (pas celui des
// quintes), parce que c'est l'ordre où on les compte et où on les cherche.

const LETTRES = "CDEFGAB";
const GAMMES = { majeur: [0, 2, 4, 5, 7, 9, 11], mineur: [0, 2, 3, 5, 7, 8, 10] };
const DEGRES = {
  majeur: { qualites: ["", "m", "m", "", "", "m", "dim"], noms: ["I", "ii", "iii", "IV", "V", "vi", "vii°"] },
  // En mineur, la dominante est majeure (V, avec la sensible) : c'est elle qui
  // tire vers la tonique, et celle que `harmoniser` et le pupitre posent. Le
  // v mineur de la gamme naturelle reste à un toucher (« Un autre accord »).
  mineur: { qualites: ["m", "dim", "", "m", "", "", ""], noms: ["i", "ii°", "III", "iv", "V", "VI", "VII"] },
};

/** La note qui s'écrit avec cette lettre et sonne à `pc` : « C », « C# », « Db » ; null si elle voudrait deux signes. */
function epeler(lettre, pc) {
  const ecart = ((mod12(pc - RACINES[lettre]) + 6) % 12) - 6;
  return ecart === 0 ? lettre : ecart === 1 ? lettre + "#" : ecart === -1 ? lettre + "b" : null;
}

/**
 * Les sept accords de la tonalité, dans l'ordre des degrés : { nom, degre,
 * racine (0-11), qualite, indice }. Chaque racine garde la lettre de son degré
 * (mi♯ et non fa en fa♯ majeur), comme l'écrirait un musicien.
 */
export function roueDeLaTonalite(tonalite) {
  const k = lireTonalite(tonalite);
  const gamme = GAMMES[k.mineur ? "mineur" : "majeur"], degres = DEGRES[k.mineur ? "mineur" : "majeur"];
  const iTonique = LETTRES.indexOf(k.tonique[0]);
  return gamme.map((ecart, i) => {
    const racine = mod12(k.pc + ecart);
    const lettre = epeler(LETTRES[(iTonique + i) % 7], racine) ?? nomRacine(racine, tonalite);
    return { nom: lettre + degres.qualites[i], degre: degres.noms[i], racine, qualite: degres.qualites[i], indice: i };
  });
}

/** La triade d'un accord : "" (majeure), "m" (mineure), "dim" ; null s'il n'a pas de tierce (sus2, sus4). */
export function familleDe(accord) {
  const tons = new Set(accord.intervalles);
  if (tons.has(3)) return tons.has(6) ? "dim" : "m";
  return tons.has(4) ? "" : null;
}

/** La place d'un accord dans la roue (0 à 6), d'après sa racine, quelle que soit sa couleur ; -1 s'il n'est pas de la tonalité. */
export function degreDeLAccord(nom, tonalite) {
  const a = lireAccord(nom);
  return a ? roueDeLaTonalite(tonalite).findIndex((r) => r.racine === a.racine) : -1;
}

/**
 * Ce qui vient souvent après chaque degré : une petite table de fonctions
 * harmoniques, pas un modèle de la musique. On distingue trois rôles :
 *   - la tonique (I, vi, iii ; i, III, VI) : le repos ;
 *   - la sous-dominante (IV, ii ; iv, ii°) : on s'éloigne du repos ;
 *   - la dominante (V, vii° ; V, VII) : on veut y revenir.
 * Le repos mène partout ; l'éloignement mène à la dominante ou revient au
 * repos ; la dominante retombe sur la tonique, ou « se trompe » sur le
 * sixième degré (la cadence rompue). Chaque ligne est un degré (I, ii, iii…),
 * ses suites sont des indices de la roue. On n'a gardé que ce qui s'entend
 * dans mille chansons : si tout était cerclé, rien ne se détacherait.
 */
const SUITES = {
  majeur: [
    [1, 3, 4, 5], // I    → ii, IV, V, vi
    [4, 6],       // ii   → V, vii°
    [3, 5],       // iii  → IV, vi
    [0, 1, 4],    // IV   → I, ii, V
    [0, 5],       // V    → I, vi (cadence rompue)
    [1, 3, 4],    // vi   → ii, IV, V
    [0, 2],       // vii° → I, iii
  ],
  mineur: [
    [2, 3, 4, 5], // i    → III, iv, V, VI
    [4],          // ii°  → V
    [3, 5, 6],    // III  → iv, VI, VII
    [0, 4, 6],    // iv   → i, V, VII
    [0, 5],       // V    → i, VI (cadence rompue)
    [3, 4, 6],    // VI   → iv, V, VII
    [0, 2],       // VII  → i, III
  ],
};

/**
 * Les accords de la roue (leurs noms) qui viennent souvent après l'accord
 * `avant`. Sans accord avant (début de l'idée), on commence sur la tonique ;
 * après un accord étranger à la tonalité, la table ne dit rien : [].
 */
export function suitesProbables(tonalite, avant) {
  const roue = roueDeLaTonalite(tonalite);
  if (!avant) return [roue[0].nom];
  const i = degreDeLAccord(avant, tonalite);
  if (i < 0) return [];
  return SUITES[lireTonalite(tonalite).mineur ? "mineur" : "majeur"][i].map((j) => roue[j].nom);
}

/**
 * Les accords de la roue que la mélodie entre `debut` et `fin` appelle,
 * du plus au moins probable (`suggerer`, ramené à la roue : G7 et G sont
 * le même accord de la roue). Une idée sans mélodie ne propose rien :
 * `suggerer` y rendrait seulement les accords usuels, ce n'est pas un conseil.
 */
export function accordsDeLaMelodie(seq, debut, fin, combien = 3) {
  if (!seq.pistes[0].notes.some((n) => n.d < fin && n.d + n.l > debut)) return [];
  const roue = roueDeLaTonalite(seq.tonalite);
  const noms = [];
  for (const nom of suggerer(seq, debut, fin, 8)) {
    const a = lireAccord(nom);
    // La même racine et la même triade : Em n'est pas le E de la roue en mineur.
    const r = a && roue.find((x) => x.racine === a.racine && x.qualite === familleDe(a));
    if (r && !noms.includes(r.nom)) noms.push(r.nom);
    if (noms.length >= combien) break;
  }
  return noms;
}

const SIGNES = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };
const NOTES_FR = { C: "do", D: "ré", E: "mi", F: "fa", G: "sol", A: "la", B: "si" };

/**
 * Les notes d'un accord, en clair, du grave à l'aigu : « C » → ["do", "mi",
 * "sol"], « F#m7/E » → ["mi", "fa♯", "la", "do♯"] (la basse d'abord).
 */
export function notesDeLAccord(nom) {
  return epellationsDeLAccord(nom).map((n) => NOTES_FR[n.lettre] + (SIGNES[n.alt] ?? ""));
}

/**
 * Les « couleurs » d'un accord, les puces de la feuille : on garde la racine
 * et on change la sorte d'accord. Elles s'appliquent à un accord posé comme
 * à un accord de la roue encore à poser.
 */
export const COULEURS = [
  { id: "simple", nom: "Simple" },
  { id: "septieme", nom: "Septième" },
  { id: "sus4", nom: "Sus4" },
  { id: "add9", nom: "Add9" },
];

const SEPTIEMES = { "0,4,7,11": "maj7", "0,4,7,10": "7", "0,3,7,10": "m7", "0,3,6,10": "m7b5" };

/**
 * La septième d'un accord : celle de la tonalité s'il en est (do majeur 7
 * sur do, mais sol 7 sur sol : ce que donne la gamme en empilant les
 * tierces), sinon la plus courante de sa famille (7, m7, m7b5).
 */
function septieme(racine, famille, tonalite) {
  const k = lireTonalite(tonalite);
  const gamme = GAMMES[k.mineur ? "mineur" : "majeur"].map((x) => mod12(k.pc + x));
  const i = gamme.indexOf(racine);
  if (i >= 0) {
    const tons = [0, 2, 4, 6].map((j) => mod12(gamme[(i + j) % 7] - racine));
    const triade = tons[1] === 3 ? (tons[2] === 6 ? "dim" : "m") : tons[1] === 4 && tons[2] === 7 ? "" : null;
    // La dominante du mineur (mi majeur en la mineur) n'est pas empilée sur la gamme : elle prend la 7.
    if (triade === famille && SEPTIEMES[tons.join()]) return SEPTIEMES[tons.join()];
  }
  return { "": "7", m: "m7", dim: "m7b5" }[famille];
}

/**
 * L'accord `nom` dans la couleur voulue (simple, septième, sus4, add9), sans
 * sa basse : « Dm » + septième → « Dm7 », « C » → « Cmaj7 », « G » → « G7 ».
 * Null si la couleur n'a pas de sens sur lui (add9 sur un accord diminué)
 * ou si le nom ne se lit pas.
 */
export function appliquerCouleur(nom, couleur, tonalite = "C") {
  const m = FORME.exec((nom || "").trim());
  const a = lireAccord(nom);
  if (!m || !a) return null;
  // Un accord sans tierce (sus4) garde la famille de son degré dans la tonalité.
  const roue = roueDeLaTonalite(tonalite).find((r) => r.racine === a.racine);
  const famille = familleDe(a) ?? (roue ? roue.qualite : "");
  const qualite = {
    simple: famille,
    septieme: septieme(a.racine, famille, tonalite),
    sus4: "sus4",
    add9: famille === "" ? "add9" : famille === "m" ? "madd9" : null,
  }[couleur];
  return qualite == null ? null : m[1] + m[2] + qualite;
}

/** La couleur (puce) d'un accord posé, ou null s'il n'en a aucune (sus2, 6, aug…). */
export function couleurDe(nom) {
  const a = lireAccord(nom);
  if (!a) return null;
  if (["", "m", "dim"].includes(a.qualite)) return "simple";
  if (["7", "maj7", "m7", "m7b5", "dim7", "9", "m9"].includes(a.qualite)) return "septieme";
  if (["sus4", "7sus4"].includes(a.qualite)) return "sus4";
  if (["add9", "madd9"].includes(a.qualite)) return "add9";
  return null;
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

/**
 * Le dessin d'un style d'accompagnement : ce qu'il joue sur une mesure d'un
 * accord de do majeur, tel que `accompagnement` le calcule (pas un schéma à
 * part qui pourrait s'en écarter). { pas (la longueur de la mesure), notes :
 * [{ d, l, h }] }.
 */
export function motifAccompagnement(style, mesure = [4, 4]) {
  const seq = { mesure: [...mesure], tonalite: "C", pistes: [{ nom: "", notes: [] }], accords: [{ d: 0, nom: "C" }], accompagnement: style };
  const pas = pasParMesure(seq);
  seq.pistes[0].notes.push({ id: 1, d: 0, l: pas, h: 72 }); // une mesure pleine, pour que l'idée en compte une
  return { pas, notes: accompagnement(seq, style).map(({ d, l, h }) => ({ d, l, h })) };
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
