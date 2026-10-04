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
// Une dominante secondaire n'est proposée que si la mélodie l'appelle : elle
// part avec le même petit avantage qu'un accord peu courant de la tonalité.
const PREFERENCE_SECONDAIRE = 0.1;

/**
 * Les dominantes secondaires de la tonalité : le 7 qui mène à chaque accord
 * de la roue (sauf la tonique, qui a déjà la sienne, et l'accord diminué).
 * Chacune porte ses notes étrangères à la gamme (`appel`) : fa♯ pour D7 en
 * do, qui mène à sol ; sol♯ pour E7, qui mène à la mineur ; si♭ pour C7, qui
 * mène à fa. Sans note étrangère (G7 vers do en la mineur), rien ne la
 * distingue d'un accord de la tonalité : elle n'est pas proposée.
 */
function dominantesSecondaires(tonalite) {
  const k = lireTonalite(tonalite);
  const gamme = (k.mineur ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((x) => mod12(k.pc + x));
  return roueDeLaTonalite(tonalite).filter((r) => r.indice > 0 && r.qualite !== "dim").map((r) => {
    const racine = mod12(r.racine + 7);
    const appel = [0, 4, 7, 10].map((x) => mod12(racine + x)).filter((pc) => !gamme.includes(pc));
    return { nom: nomRacine(racine, tonalite) + "7", degre: `V/${r.degre}`, appel, cible: r.nom };
  }).filter((c) => c.appel.length);
}

/**
 * Chaque accord candidat, noté d'après les notes entre `debut` et `fin`
 * (pas) de la première piste : une note de l'accord compte pour, une note à
 * un demi-ton d'une note de l'accord compte contre ; le premier temps pèse
 * plus. Les candidats : les accords de la tonalité, et les dominantes
 * secondaires dont la mélodie joue une note étrangère. Du meilleur au moins
 * bon : [{ nom, degre, score }].
 */
function noter(seq, debut, fin) {
  const notes = seq.pistes[0].notes.filter((n) => n.d < fin && n.d + n.l > debut);
  const candidats = accordsDeLaTonalite(seq.tonalite);
  if (!notes.length) return candidats.map((c) => ({ ...c, score: 0 }));
  const jouees = new Set(notes.map((n) => mod12(n.h)));
  for (const s of dominantesSecondaires(seq.tonalite)) if (s.appel.some((pc) => jouees.has(pc))) candidats.push(s);
  const poids = notes.map((n) => {
    const recouvre = Math.min(fin, n.d + n.l) - Math.max(debut, n.d);
    return { pc: mod12(n.h), w: recouvre * (n.d === debut ? 1.5 : 1) };
  });
  const total = poids.reduce((s, p) => s + p.w, 0) || 1;
  return candidats.map((c) => {
    const a = lireAccord(c.nom);
    const tons = new Set(a.intervalles.map((i) => mod12(a.racine + i)));
    let score = 0;
    for (const { pc, w } of poids) {
      if (tons.has(pc)) score += w;
      else if (tons.has(mod12(pc + 1)) || tons.has(mod12(pc - 1))) score -= 0.5 * w;
      else score -= 0.1 * w;
    }
    const prefere = c.degre.startsWith("V/") ? PREFERENCE_SECONDAIRE : PREFERENCES[c.degre] || 0;
    return { nom: c.nom, degre: c.degre, cible: c.cible || null, score: score / total + prefere };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Les accords qui vont avec les notes entre `debut` et `fin` (pas) de la
 * première piste, du meilleur au moins bon (leurs noms). Sans note, ceux de
 * la tonalité, du plus courant au plus rare.
 */
export function suggerer(seq, debut, fin, combien = 6) {
  return noter(seq, debut, fin).slice(0, combien).map((c) => c.nom);
}

/**
 * La part d'une moitié de mesure que la mélodie passe hors de l'accord
 * `nom` : 1 si toutes ses notes y sont étrangères, 0 si toutes en sont.
 */
function horsDeLAccord(seq, debut, fin, nom) {
  const a = lireAccord(nom);
  const tons = new Set(a.intervalles.map((i) => mod12(a.racine + i)));
  let dehors = 0, sonne = 0;
  for (const n of seq.pistes[0].notes) {
    const l = Math.min(fin, n.d + n.l) - Math.max(debut, n.d);
    if (l <= 0) continue;
    sonne += l;
    if (!tons.has(mod12(n.h))) dehors += l;
  }
  return sonne ? dehors / sonne : 0;
}

// Une moitié de mesure qui passe les trois quarts de son temps hors de
// l'accord de la mesure le demande clairement : une note de passage (une
// croche, ou une noire sur deux) n'y suffit pas, une note tenue oui.
const PARTAGE = 0.75;
const PHRASE = 4; // les phrases vont par quatre mesures, comme dans presque toutes les chansons
// Une règle (cadence, tonique, résolution) ne choisit qu'un accord presque
// aussi bon que le meilleur : elle tranche entre deux accords qui vont tous
// deux avec la mélodie, elle n'en impose pas un qui jure.
const MARGE = 0.3;

/**
 * Les accords d'une idée, d'après sa mélodie, comme un harmoniste pressé :
 *   - un accord par mesure, deux quand une moitié de mesure le demande
 *     clairement (4/4, 2/4, 2/2, 6/8, 12/8 : des mesures qui se coupent en
 *     deux temps égaux) ;
 *   - la première mesure sur la tonique, si la mélodie le permet ;
 *   - la fin de chaque phrase de quatre mesures sur une cadence : la
 *     dernière mesure sur la tonique (la dominante d'abord, si la mesure se
 *     partage : cadence parfaite), les autres sur la dominante quand la
 *     mélodie s'y prête (demi-cadence). Une levée ne compte pas dans la
 *     phrase ;
 *   - une dominante secondaire (D7 en do, appelé par un fa♯) mène à son
 *     accord (sol) quand la mélodie le permet ;
 *   - ailleurs, le meilleur accord, mais on garde celui d'avant s'il est
 *     parmi les deux meilleurs : une harmonie qui change à chaque mesure
 *     fatigue. Cette règle ne joue plus aux fins de phrase : elle y effaçait
 *     la demi-cadence (l'Hymne à la joie restait en ré à la 4ᵉ mesure).
 */
export function harmoniser(seq) {
  const mesure = pasParMesure(seq), temps = pasParTemps(seq);
  const nb = nbMesures(seq);
  const tonalite = accordsDeLaTonalite(seq.tonalite);
  const tonique = new Set([tonalite[0].nom]);
  const dominantes = new Set(tonalite.filter((c) => c.degre === "V" || c.degre === "V7").map((c) => c.nom));
  const melodie = seq.pistes[0].notes;
  if (!melodie.length) return [];
  const moitie = (mesure / temps) % 2 === 0 ? mesure / 2 : null;
  // Une levée : la mélodie n'entre qu'à partir de la moitié de la première mesure.
  const premiere = Math.min(...melodie.map((n) => n.d));
  const levee = nb > 1 && premiere >= mesure / 2 && premiere < mesure;
  // Parmi les trois meilleurs, et presque aussi bon que le premier, celui qu'on veut ; sinon le meilleur.
  const preferer = (notes, voulus) => (voulus && notes.slice(0, 3).find((c) => voulus.has(c.nom) && c.score >= notes[0].score - MARGE)) || notes[0];
  const accords = [];
  let precedent = null; // le dernier accord posé (avec sa cible, si c'est une dominante secondaire)
  for (let m = 0; m < nb; m++) {
    const debut = m * mesure, fin = debut + mesure;
    if (!melodie.some((n) => n.d < fin && n.d + n.l > debut)) continue; // l'accord d'avant continue
    const rang = levee ? m : m + 1;
    const cadence = m === nb - 1 ? "parfaite" : rang % PHRASE === 0 ? "demi" : null;
    const resolution = precedent && precedent.cible ? new Set([precedent.cible]) : null;
    const entiere = noter(seq, debut, fin);
    // Deux accords dans la mesure ? Seulement si une moitié se passe clairement de l'accord de la mesure.
    if (moitie && !(m === 0 && levee)) {
      const moities = [[debut, debut + moitie], [debut + moitie, fin]];
      if (moities.some(([a, b]) => horsDeLAccord(seq, a, b, entiere[0].nom) >= PARTAGE)) {
        const [n1, n2] = moities.map(([a, b]) => noter(seq, a, b));
        const c1 = preferer(n1, cadence === "parfaite" ? dominantes : m === 0 ? tonique : resolution);
        const c2 = preferer(n2, cadence === "parfaite" ? tonique : cadence === "demi" ? dominantes : c1.cible ? new Set([c1.cible]) : null);
        if (c1.nom !== c2.nom) {
          accords.push({ d: debut, nom: c1.nom }, { d: debut + moitie, nom: c2.nom });
          precedent = c2;
          continue;
        }
      }
    }
    let choix = preferer(entiere, m === 0 || cadence === "parfaite" ? tonique : cadence === "demi" ? dominantes : resolution);
    if (choix === entiere[0] && !cadence && m > 0 && !resolution) {
      const garde = entiere.slice(0, 2).find((c) => precedent && c.nom === precedent.nom);
      if (garde) choix = garde;
    }
    accords.push({ d: debut, nom: choix.nom });
    precedent = choix;
  }
  // Deux fois de suite le même accord : un seul symbole.
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

// ---------------------------------------------------------------------------
// La conduite des voix : où se placent les notes de chaque accord
// ---------------------------------------------------------------------------
//
// Avant, chaque accord était plaqué en position fondamentale à partir du
// do3 : tout bougeait en parallèle (C Am F G C : 64 demi-tons parcourus par
// les voix du dessus), et l'accompagnement passait au-dessus d'une mélodie
// grave. Maintenant, comme un pianiste : chaque accord prend le renversement
// le plus proche du précédent, sous la mélodie de sa mesure, et la basse
// reste en dessous.

const PLAFOND = 72;                 // do5 : l'accompagnement ne monte jamais plus haut
const CENTRE = 57;                  // la3 : là où il sonne clair sans gêner la mélodie
const PLANCHERS = [48, 45, 43, 40]; // do3 ; plus bas seulement si la mélodie descend
const REGISTRE = 0.2;               // le poids du registre face au mouvement des voix

/**
 * Les notes de l'accord au-dessus de la basse (0-11). Avec une neuvième, la
 * basse dit déjà la racine : les voix du dessus la laissent et sonnent en
 * tierces (fa la do mi pour ré m9), pas en grappe (mi fa do ré). Si la basse
 * est une autre note (C9/E), la racine reste et c'est la quinte, la plus
 * dispensable, qui part : quatre voix au plus sous la mélodie.
 */
function tonsDe(a) {
  let iv = a.intervalles;
  if (iv.includes(14) && (a.basse === null || a.basse === a.racine)) iv = iv.filter((i) => i !== 0);
  else if (iv.length > 4) iv = iv.filter((i) => i !== 7);
  return [...new Set(iv.map((i) => mod12(a.racine + i)))];
}

/** Les accords serrés (chaque renversement, à chaque octave) dont toutes les notes tiennent entre `plancher` et `plafond`. */
function dispositions(tons, plancher, plafond) {
  const tries = [...tons].sort((x, y) => x - y);
  const sortie = [];
  tries.forEach((_, r) => {
    const ordre = [...tries.slice(r), ...tries.slice(0, r)];
    for (let bas = plancher; bas <= plafond; bas++) {
      if (mod12(bas) !== ordre[0]) continue;
      const v = [bas];
      for (const pc of ordre.slice(1)) { let x = v.at(-1) + 1; while (mod12(x) !== pc) x++; v.push(x); }
      if (v.at(-1) <= plafond) sortie.push(v);
    }
  });
  return sortie;
}

/** Le mouvement des voix d'un accord à l'autre (demi-tons), voix par voix du grave à l'aigu. */
function mouvement(u, v) {
  let s = 0;
  for (let i = 0; i < Math.max(u.length, v.length); i++) s += Math.abs(u[Math.min(i, u.length - 1)] - v[Math.min(i, v.length - 1)]);
  return s;
}
const ecartAuCentre = (v) => Math.abs(v.reduce((s, x) => s + x, 0) / v.length - CENTRE);

/**
 * La disposition de chaque accord. On choisit l'enchaînement entier (le
 * moins de mouvement possible, sans quitter le registre), pas accord par
 * accord : un premier choix pris au hasard pourrait coincer la suite.
 * `possibles[i]` : les dispositions permises du i-ème accord.
 */
function conduire(possibles) {
  const couts = possibles.map((liste) => liste.map(() => Infinity));
  const venant = possibles.map((liste) => liste.map(() => -1));
  possibles.forEach((liste, i) => liste.forEach((v, j) => {
    const propre = REGISTRE * ecartAuCentre(v);
    if (i === 0) { couts[0][j] = propre; return; }
    possibles[i - 1].forEach((u, k) => {
      const c = couts[i - 1][k] + mouvement(u, v) + propre;
      if (c < couts[i][j]) { couts[i][j] = c; venant[i][j] = k; }
    });
  }));
  const choix = [];
  let j = couts.at(-1).indexOf(Math.min(...couts.at(-1)));
  for (let i = possibles.length - 1; i >= 0; i--) { choix[i] = possibles[i][j]; j = venant[i][j]; }
  return choix;
}

/** L'accompagnement d'une idée, d'après ses accords et le style choisi. */
export function accompagnement(seq, style = seq.accompagnement) {
  if (!style || style === "aucun" || !seq.accords || !seq.accords.length) return [];
  const mesure = pasParMesure(seq), temps = pasParTemps(seq);
  const total = nbMesures(seq) * mesure;
  const melodie = (seq.pistes[0] && seq.pistes[0].notes) || [];
  const accords = [...seq.accords].sort((a, b) => a.d - b.d)
    .map((ac, i, tous) => ({ ...ac, a: lireAccord(ac.nom), fin: i + 1 < tous.length ? tous[i + 1].d : total }))
    .filter((ac) => ac.a && ac.d < total);
  if (!accords.length) return [];
  // Chaque accord sous la note la plus grave que la mélodie joue pendant qu'il sonne.
  const plafonds = accords.map((ac) => {
    const dessus = melodie.filter((n) => n.d < ac.fin && n.d + n.l > ac.d).map((n) => n.h);
    return Math.min(PLAFOND, dessus.length ? Math.min(...dessus) - 1 : PLAFOND);
  });
  const possibles = accords.map((ac, i) => {
    for (const plancher of PLANCHERS) {
      const liste = dispositions(tonsDe(ac.a), plancher, plafonds[i]);
      if (liste.length) return liste;
    }
    // Une mélodie plus grave que tout accord : l'accord reste à sa place, sous le do5.
    plafonds[i] = PLAFOND;
    return dispositions(tonsDe(ac.a), PLANCHERS[0], PLAFOND);
  });
  const choix = conduire(possibles);
  const notes = [];
  // Chaque note dit si elle est la basse ou l'accord : le MIDI les met sur deux pistes (voixCompletes).
  const ajouter = (d, l, h, v, role) => { if (l > 0 && d < total) notes.push({ id: -(notes.length + 1), d, l: Math.min(l, total - d), h, v, role }); };
  accords.forEach((ac, i) => {
    const { a, fin } = ac;
    const voix = choix[i];
    // La basse (la note après « / », sinon la racine) dans l'octave du do2, sous l'accord.
    let basse = 36 + (a.basse ?? a.racine);
    while (basse >= voix[0]) basse -= 12;
    if (style === "plaque") {
      // Un accord par mesure (rejoué à chaque barre, pour qu'on l'entende).
      for (let d = ac.d; d < fin; d = Math.min(fin, (Math.floor(d / mesure) + 1) * mesure)) {
        const l = Math.min(fin, (Math.floor(d / mesure) + 1) * mesure) - d;
        ajouter(d, l, basse, 70, "basse");
        for (const h of voix) ajouter(d, l, h, 70, "accord");
      }
    } else if (style === "basse") {
      // La basse sur le premier temps, l'accord (sans sa racine, que la basse vient de dire) sur les autres.
      const sansRacine = voix.filter((h) => mod12(h) !== a.racine);
      const dessus = sansRacine.length >= 2 ? sansRacine : voix;
      for (let d = ac.d; d < fin; d += temps) {
        const l = Math.min(temps, fin - d);
        if ((d % mesure) === 0 || d === ac.d) ajouter(d, l, basse, 80, "basse");
        else for (const h of dessus) ajouter(d, l, h, 60, "accord");
      }
    } else if (style === "arpege") {
      // Des croches : la basse, puis l'accord qui monte et redescend, toutes
      // ses notes comprises (la septième, la neuvième). Un accord de trois
      // notes prend l'octave de la plus grave, s'il reste de la place sous
      // la mélodie, pour que le motif d'une mesure de 4/4 ne bégaie pas.
      const haut = [...voix];
      if (haut.length === 3 && haut[0] + 12 > haut[2] && haut[0] + 12 <= plafonds[i]) haut.push(haut[0] + 12);
      const vague = [...haut, ...haut.slice(1, -1).reverse()];
      let k = 0;
      for (let d = ac.d; d < fin; d += 2, k++) {
        if (d % mesure === 0) k = 0;
        if (k === 0) ajouter(d, Math.min(2, fin - d), basse, 75, "basse");
        else ajouter(d, Math.min(2, fin - d), vague[(k - 1) % vague.length], 62, "accord");
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

/**
 * Les voix à graver, jouer et exporter : les pistes, plus l'accompagnement
 * s'il y en a un, en deux voix, « Accords » et « Basse des accords ». Le MIDI
 * les sépare (dans Live, la basse va sur sa propre piste, vers une basse) ;
 * la partition et le MusicXML les gardent sur une seule portée en clé de fa
 * (`portee`), comme la main gauche d'un pianiste. « Basse des accords » et
 * pas « Basse » : une piste de basse jouée par toi ne s'y mélange pas.
 */
export function voixCompletes(seq) {
  const voix = seq.pistes.map((p) => ({ ...p }));
  const acc = accompagnement(seq);
  const accords = acc.filter((n) => n.role !== "basse"), basses = acc.filter((n) => n.role === "basse");
  if (accords.length) voix.push({ nom: "Accords", cle: "fa", portee: "accompagnement", notes: accords });
  if (basses.length) voix.push({ nom: "Basse des accords", cle: "fa", portee: "accompagnement", notes: basses });
  return voix;
}

const TONIQUES_MAJ = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const TONIQUES_MIN = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

/**
 * Une tonalité montée ou descendue de `demiTons`, nommée comme dans le menu
 * des tonalités (« C » + 3 → « Eb ») ; sans transposition, elle ne change pas.
 */
export function tonaliteTransposee(tonalite, demiTons) {
  if (!demiTons) return tonalite;
  const k = lireTonalite(tonalite);
  return (k.mineur ? TONIQUES_MIN : TONIQUES_MAJ)[mod12(k.pc + demiTons)];
}

/** Toute l'idée transposée : notes, accords et tonalité. */
export function transposerIdee(seq, demiTons) {
  const k = lireTonalite(seq.tonalite);
  const tonalite = (k.mineur ? TONIQUES_MIN : TONIQUES_MAJ)[mod12(k.pc + demiTons)];
  for (const p of seq.pistes) for (const n of p.notes) n.h = Math.max(21, Math.min(108, n.h + demiTons));
  seq.accords = (seq.accords || []).map((a) => ({ ...a, nom: transposerAccord(a.nom, demiTons, tonalite) }));
  seq.tonalite = tonalite;
}
