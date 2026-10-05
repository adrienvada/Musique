/**
 * DEMANDER À CLAUDE, SUR UNE IDÉE (H2)
 *
 * La version claude.ai peut interroger Claude depuis la page (capacité
 * `sample`). Sur ce qu'il rend, les modèles se trompent souvent : en ABC,
 * les meilleurs ne réussissent qu'environ la moitié des exercices publics
 * (audit du 04/10, H2). D'où la règle : Claude propose, Portée vérifie,
 * Adrien écoute puis choisit. Ce module tient les deux bouts :
 *   - demande(genre, idee, options) : ce qui part, un texte compact en
 *     français (l'idée en notes, ce qu'on attend, la forme exacte du JSON
 *     à rendre) et les options de `sample.json` ;
 *   - valider(genre, reponse, idee, options) : ce qui revient, vérifié
 *     champ par champ. Ce qui n'a pas la forme demandée est refusé, jamais
 *     réparé en silence : une réponse « presque juste » a souvent compris
 *     autre chose que ce qu'on croit, et Adrien ne lit pas le JSON ;
 *   - appliquer(genre, idee, proposition, options) : une NOUVELLE idée, que
 *     l'écran écrit d'un coup (un seul « Annuler ») ;
 *   - outilsSurCopie(idee, gestes) : pour une demande libre, des outils que
 *     Claude appelle, et qui ne touchent qu'une copie.
 * Il n'appelle jamais `sample` (l'écran le fait, avec `signal`, `onText` et
 * les codes d'erreur), n'écrit rien et ne touche pas la page.
 *
 * L'idée est la séquence de sequence.js : { tempo, mesure, tonalite,
 * pistes: [{ nom, notes: [{ id, d, l, h, v? }] }], accords: [{ d, nom }],
 * accompagnement, suivant }, le temps en pas de double croche.
 *
 * POURQUOI PAS D'IMPORT DE sequence.js. Ce module est vérifié par
 * `npm run types` ; sequence.js ne le passe pas encore (deux JSDoc écrites
 * en prose), et un module vérifié qui l'importerait l'y entraînerait, ses
 * erreurs avec. Les outils de « libre » sont pourtant ses gestes
 * (transposer, étirer…) : Claude fait ce que ferait le doigt d'Adrien.
 * L'écran, qui importe déjà sequence.js, les passe donc en paramètre
 * (`gestes`). Le reste est recopié ici, en petit : la mesure en pas et le
 * nom d'une note dans la tonalité ; un test vérifie qu'ils ne s'écartent
 * pas de sequence.js. Le jour où sequence.js passera, l'import direct
 * remplacera paramètre et copies.
 *
 * Sans dépendance hors accords.js : appli et tests.
 */
import { FORME, QUALITES, lireAccord } from "./accords.js";

/**
 * @typedef {{ id: number, d: number, l: number, h: number, v?: number }} Note
 * @typedef {{ nom: string, cle?: string, notes: Note[] }} Piste
 * @typedef {{ d: number, nom: string }} Accord
 * @typedef {{ version?: number, tempo: number, mesure: number[], tonalite: string, pistes: Piste[], accords?: Accord[], accompagnement?: string, suivant: number }} Sequence
 * @typedef {{ piste?: number, ids: Iterable<number> }} Selection
 * @typedef {{ d: number, l: number, h: number, v?: number }} NoteNeuve
 *
 * Les gestes de sequence.js dont les outils se servent (l'écran passe
 * `import * as sq from "./sequence.js"`).
 * @typedef {object} Gestes
 * @property {(seq: Sequence, p: number, ids: number[], demiTons: number) => void} transposer
 * @property {(seq: Sequence, p: number, ids: number[], facteur: number) => void} etirer
 * @property {(seq: Sequence, p: number, ids: number[]) => void} retrograder
 * @property {(seq: Sequence, p: number, ids: number[]) => void} renverser
 * @property {(seq: Sequence, p: number, ids: number[], grille: number) => void} recaler
 * @property {(seq: Sequence, p: number, note: { d: number, l: number, h: number }) => number} poser
 * @property {(seq: Sequence, p: number, ids: number[], options?: { decaler?: boolean }) => void} effacer
 *
 * @typedef {object} Options
 * @property {Selection} [selection]  les notes choisies (idee.js : { piste: e.piste, ids: e.selection }) ; vide : toute l'idée
 * @property {number} [piste]  la piste visée sans sélection (0 par défaut)
 * @property {string} [intention]  pour une variation : l'une des clés d'INTENTIONS
 * @property {string} [phrase]  pour « libre » : ce qu'Adrien demande, avec ses mots
 * @property {string} [titre]  pour « titre » : le titre actuel
 * @property {string[]} [etiquettes]  pour « titre » : les étiquettes actuelles
 * @property {string[]} [etiquettesConnues]  pour « titre » : celles de la bibliothèque, à reprendre si elles conviennent
 * @property {object[]} [outils]  pour « libre » : les outils d'outilsSurCopie, quand sample.limits() annonce `tools`
 * @property {Sequence} [copie]  pour valider « libre » avec outils : l'état final de la copie (copie())
 */

export const GENRES = ["accords", "suite", "variation", "titre", "libre"];

/**
 * Les intentions d'une variation, et ce qu'elles veulent dire pour Claude :
 * un mot seul (« plus calme ») laisse trop de place à l'interprétation.
 */
export const INTENTIONS = {
  "plus calme": "moins de notes, des valeurs plus longues, peu de sauts : la ligne se pose",
  "plus sautillante": "des notes plus courtes et détachées, des rythmes pointés, quelques sauts",
  "en mineur": "le même dessin en mineur : la tierce et la sixte de la gamme abaissées d'un demi-ton (si l'idée est déjà en mineur, une couleur plus sombre encore)",
  "plus ornée": "des notes de passage, des broderies et des appoggiatures autour de la mélodie, qui reste reconnaissable",
};

/** Ce que l'écran dit quand une réponse est refusée : `raison`, elle, sert aux tests et à la console. */
export const MESSAGE_REFUS = "Claude n'a pas proposé quelque chose de jouable : réessaie.";

const BORNES = { bas: 21, haut: 108 }; // le clavier du piano, comme sequence.js
// Une idée de prise de notes dépasse rarement quelques centaines de notes ;
// au-delà de 2 000, la demande pèserait plus de 30 Ko : mieux vaut choisir
// un passage que d'envoyer tout.
const MAX_NOTES_ENVOYEES = 2000;
// Au plus quatre notes à la fois à chaque double croche : plus qu'une main
// n'en joue. Un tableau plus long n'est plus une proposition, c'est une
// réponse qui déborde (et 4 000 au plus, la borne du connecteur).
const NOTES_PAR_PAS = 4;
const MAX_NOTES = 4000;
// Une octave de marge autour de ce que la piste joue déjà : une suite ou une
// variation peut monter ou descendre, en écho ; au-delà, c'est presque
// toujours une octave mal comptée. Pour « libre », Adrien a pu demander de
// changer de registre : deux octaves.
const MARGE = 12;
const MARGE_LIBRE = 24;
const MAX_MESURES = 256; // comme idee_ecrire au connecteur
const MAX_PAS = 16384; // au-delà, la bibliothèque rabattrait la note (fiche.js)
const MAX_TITRE = 60; // une ligne de la bibliothèque, la barre du haut d'un téléphone
const MAX_ETIQUETTES = 5;
const MAX_ETIQUETTE = 30;
const MAX_POURQUOI = 400; // une ou deux phrases ; au-delà, coupé (ce n'est que du texte à montrer)
const MAX_PHRASE = 500;

// ------------------------------------------------------------------------
// Recopié de sequence.js (voir plus haut) : la mesure en pas, le nom des notes
// ------------------------------------------------------------------------

const LETTRES = "CDEFGAB";
/** @type {Record<string, number>} */
const NATUREL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** @type {Record<string, string>} */
const NOMS = { C: "do", D: "ré", E: "mi", F: "fa", G: "sol", A: "la", B: "si" };
/** @type {Record<string, string>} */
const SIGNES = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };
/** @type {Record<string, number>} */
const QUINTES = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, "G#": 8, "D#": 9, "A#": 10, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
/** @type {Record<number, number>} */
const PREFERENCE_DO = { 1: 1, 3: -1, 6: 1, 8: -1, 10: -1 };
const mod12 = (/** @type {number} */ x) => ((x % 12) + 12) % 12;

const pasParMesure = (/** @type {Sequence} */ seq) => (seq.mesure[0] * 16) / seq.mesure[1];
/** @param {Sequence} seq */
function pasParTemps(seq) {
  const [n, d] = seq.mesure;
  if (d === 8 && n % 3 === 0 && n > 3) return 6;
  return 16 / d;
}
/** @param {Sequence} seq */
function finSequence(seq) {
  let f = 0;
  for (const p of seq.pistes) for (const n of p.notes) f = Math.max(f, n.d + n.l);
  for (const a of seq.accords || []) f = Math.max(f, a.d + 1);
  return f;
}
const nbMesures = (/** @type {Sequence} */ seq) => Math.max(1, Math.ceil(finSequence(seq) / pasParMesure(seq)));

/** @param {string} t */
function lireTonalite(t) {
  const m = /^([A-G][#b]?)(m?)$/.exec(t || "") || [null, "C", ""];
  const tonique = m[1], mineur = m[2] === "m";
  const quintes = (QUINTES[tonique] ?? 0) - (mineur ? 3 : 0);
  /** @type {Record<string, number>} */
  const armure = {};
  for (let i = 0; i < Math.min(7, Math.abs(quintes)); i++) armure[(quintes > 0 ? "FCGDAEB" : "BEADGCF")[i]] = quintes > 0 ? 1 : -1;
  const pc = mod12(NATUREL[tonique[0]] + (tonique[1] === "#" ? 1 : tonique[1] === "b" ? -1 : 0));
  return { tonique, mineur, quintes, armure, pc };
}

/** « la mineur », « si♭ majeur » (sequence.js, nomTonalite, sans la majuscule). */
function nomTonalite(/** @type {string} */ t) {
  const k = lireTonalite(t);
  const alt = k.tonique[1] === "#" ? "♯" : k.tonique[1] === "b" ? "♭" : "";
  return `${NOMS[k.tonique[0]]}${alt} ${k.mineur ? "mineur" : "majeur"}`;
}

/**
 * « sol4 », « si♭3 » : la hauteur `h` écrite dans la tonalité, comme
 * sequence.js (nomNote) l'écrit : la note de la gamme, puis en mineur la
 * sixte et la sensible haussées, puis le bécarre, puis le sens de l'armure.
 */
function nomNote(/** @type {number} */ h, /** @type {string} */ tonalite) {
  const k = lireTonalite(tonalite);
  const pc = mod12(h);
  let choix = null;
  for (const l of LETTRES) {
    const alt = k.armure[l] || 0;
    if (mod12(NATUREL[l] + alt) === pc) { choix = { lettre: l, alt }; break; }
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
    const s = k.quintes > 0 ? 1 : k.quintes < 0 ? -1 : (k.mineur && pc === 8 ? 1 : PREFERENCE_DO[pc] ?? 1);
    choisir: for (const alt of [0, s, -s]) {
      for (const l of LETTRES) if (mod12(NATUREL[l] + alt) === pc) { choix = { lettre: l, alt }; break choisir; }
    }
  }
  return NOMS[choix.lettre] + SIGNES[choix.alt] + (Math.round((h - NATUREL[choix.lettre] - choix.alt) / 12) - 1);
}

/** @param {Sequence} seq @returns {Sequence} */
const cloner = (seq) => JSON.parse(JSON.stringify(seq));

/**
 * L'idée comptée en pas : { ppm (pas par mesure), ppt (par temps), nb
 * (mesures), fin (la barre après la dernière mesure), finLibre (jusqu'où une
 * réécriture entière peut aller, voir finLibre) }. suggestions.js s'en sert
 * aussi, plutôt qu'une troisième copie de sequence.js.
 * @param {Sequence} seq
 */
export function enPas(seq) {
  const ppm = pasParMesure(seq), nb = nbMesures(seq);
  return { ppm, ppt: pasParTemps(seq), nb, fin: nb * ppm, finLibre: finLibre(seq) };
}

// ------------------------------------------------------------------------
// Lire ce qui revient : la forme d'abord, puis chaque champ
// (claude-doute.js et suggestions.js s'en servent aussi : une seule façon de
// lire ce que Claude rend)
// ------------------------------------------------------------------------

// `__proto__` dans un objet copié par Object.assign change son prototype ;
// les deux autres n'ont rien à faire dans une réponse.
const CLES_INTERDITES = new Set(["__proto__", "constructor", "prototype"]);
const MAX_NOEUDS = 50000; // 4 000 notes de cinq valeurs, et de la marge
const MAX_PROFONDEUR = 8; // { contenu: { notes: [ { … } ] } } en demande quatre
const MAX_CHAINE = 20000;

/**
 * La forme d'une valeur reçue : du JSON simple (objets ordinaires, listes,
 * textes, nombres finis, booléens, null), sans clé piégée, ni trop grand ni
 * trop profond. Rend null si tout va bien, sinon la raison.
 * @param {unknown} x
 * @returns {string | null}
 */
export function formeSure(x) {
  let noeuds = 0;
  /** @param {unknown} v @param {number} profondeur @returns {string | null} */
  const voir = (v, profondeur) => {
    if (++noeuds > MAX_NOEUDS) return "réponse trop grande";
    if (v === null || typeof v === "boolean") return null;
    if (typeof v === "string") return v.length > MAX_CHAINE ? "texte trop long" : null;
    if (typeof v === "number") return Number.isFinite(v) ? null : "nombre invalide";
    if (profondeur >= MAX_PROFONDEUR) return "réponse trop imbriquée";
    if (Array.isArray(v)) {
      if (v.length > MAX_NOEUDS) return "liste trop longue";
      for (let i = 0; i < v.length; i++) {
        const r = voir(v[i], profondeur + 1);
        if (r) return r;
      }
      return null;
    }
    if (typeof v === "object") {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return "objet inattendu";
      for (const k of Object.keys(v)) {
        if (CLES_INTERDITES.has(k)) return `clé interdite « ${k} »`;
        const r = voir(v[k], profondeur + 1);
        if (r) return r;
      }
      return null;
    }
    return "valeur inattendue";
  };
  return voir(x, 0);
}

/**
 * Un objet ordinaire (pas une liste, pas null).
 * @param {unknown} x @returns {x is Record<string, any>}
 */
export function estObjet(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/**
 * Un objet aux seules clés `permis`, avec toutes les `requis` ; null, ou la
 * raison. Une clé inattendue dit que Claude a compris une autre forme que
 * celle demandée : ses nombres ne veulent peut-être pas dire ce qu'on croit.
 * @param {unknown} o @param {string[]} permis @param {string[]} requis @param {string} ou
 */
export function champs(o, permis, requis, ou) {
  if (!estObjet(o)) return `${ou} : un objet attendu`;
  const inconnue = Object.keys(o).find((k) => !permis.includes(k));
  if (inconnue !== undefined) return `${ou} : clé inattendue « ${inconnue} »`;
  const manque = requis.find((k) => !(k in o));
  return manque === undefined ? null : `${ou} : « ${manque} » manque`;
}

export const entierDans = (/** @type {unknown} */ v, /** @type {number} */ min, /** @type {number} */ max) => Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max;

/**
 * Un texte nettoyé : les espaces (retours à la ligne compris, sauf avec
 * `lignes`) ramenés à un seul, les caractères de contrôle et invisibles
 * (\p{Cc}, \p{Cf} : zéro-largeur, sens d'écriture) retirés, les bouts rognés.
 * @param {string} texte @param {{ lignes?: boolean }} [options]
 */
export function nettoyer(texte, { lignes = false } = {}) {
  let t = String(texte);
  t = lignes ? t.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" && lignes ? c : "")).trim();
}

/** Coupé à `max` caractères, au dernier mot entier, avec « … ». */
export function couper(/** @type {string} */ texte, /** @type {number} */ max) {
  if (texte.length <= max) return texte;
  const bout = texte.slice(0, max - 1);
  const espace = bout.lastIndexOf(" ");
  return (espace > max / 2 ? bout.slice(0, espace) : bout).replace(/[\s,;:.]+$/, "") + "…";
}

/**
 * Le « pourquoi » d'une réponse : facultatif (ce n'est pas de la musique),
 * mais un texte s'il est là ; nettoyé, et coupé au-delà de `max` plutôt que
 * refusé : il n'est qu'à montrer. { pourquoi, raison } (raison : null si tout va bien).
 * @param {unknown} v @param {number} [max]
 */
export function lirePourquoi(v, max = MAX_POURQUOI) {
  if (v === undefined) return { pourquoi: "", raison: null };
  if (typeof v !== "string") return { pourquoi: "", raison: "pourquoi : un texte attendu" };
  return { pourquoi: couper(nettoyer(v), max), raison: null };
}

const refus = (/** @type {string} */ raison) => ({ ok: /** @type {false} */ (false), raison });

/**
 * Des notes proposées, [{ debut, duree, hauteur, velocite? }] en pas, lues
 * en notes d'idée [{ d, l, h, v? }] (d = debut + decalage), triées comme
 * sequence.js les range. Rend { notes, raison } : notes null, et la raison, si elles ne vont pas.
 * @param {unknown} liste
 * @param {{ decalage?: number, fenetre: number[], tessiture: { bas: number, haut: number }, max: number, velocite?: boolean, ou?: string }} regles
 *   `fenetre` : [a, b[ où chaque note doit tenir ; `velocite` : permise (le connecteur l'accepte).
 */
export function lireNotes(liste, { decalage = 0, fenetre, tessiture, max, velocite = false, ou = "notes" }) {
  const non = (/** @type {string} */ raison) => ({ notes: /** @type {NoteNeuve[] | null} */ (null), raison });
  if (!Array.isArray(liste) || !liste.length) return non(`${ou} : une liste non vide attendue`);
  if (liste.length > max) return non(`${ou} : ${max} notes au plus`);
  const [a, b] = fenetre;
  /** @type {NoteNeuve[]} */
  const notes = [];
  for (let i = 0; i < liste.length; i++) {
    const ici = `${ou}[${i}]`;
    const n = liste[i];
    const e = champs(n, velocite ? ["debut", "duree", "hauteur", "velocite"] : ["debut", "duree", "hauteur"], ["debut", "duree", "hauteur"], ici);
    if (e) return non(e);
    if (!Number.isInteger(n.debut) || !Number.isInteger(n.duree) || !Number.isInteger(n.hauteur)) return non(`${ici} : des entiers attendus`);
    const d = n.debut + decalage;
    if (n.duree < 1) return non(`${ici} : durée nulle ou négative`);
    if (d < a || d + n.duree > b) return non(`${ici} : hors de la place permise (pas ${a - decalage} à ${b - decalage})`);
    if (!entierDans(n.hauteur, BORNES.bas, BORNES.haut)) return non(`${ici} : hauteur ${n.hauteur} hors du clavier`);
    if (n.hauteur < tessiture.bas || n.hauteur > tessiture.haut) return non(`${ici} : hauteur ${n.hauteur} hors de la tessiture (${tessiture.bas} à ${tessiture.haut})`);
    /** @type {NoteNeuve} */
    const note = { d, l: n.duree, h: n.hauteur };
    if (n.velocite !== undefined) {
      if (!entierDans(n.velocite, 1, 127)) return non(`${ici} : vélocité de 1 à 127`);
      note.v = n.velocite;
    }
    notes.push(note);
  }
  notes.sort((x, y) => x.d - y.d || x.h - y.h);
  return { notes, raison: /** @type {string | null} */ (null) };
}

/**
 * Deux notes de même hauteur qui se chevauchent, dont l'une au moins est
 * neuve (celles d'avant ont pu se chevaucher déjà : ce n'est pas l'affaire
 * de Claude). Le MIDI et la grille ne sauraient laquelle couper. Rend la
 * description du premier chevauchement, ou null.
 * @param {NoteNeuve[]} neuves @param {{ d: number, l: number, h: number }[]} [restantes]
 */
export function chevauchement(neuves, restantes = []) {
  const toutes = [...neuves.map((n) => ({ n, neuve: true })), ...restantes.map((n) => ({ n, neuve: false }))]
    .sort((x, y) => x.n.h - y.n.h || x.n.d - y.n.d);
  let hauteur = null, finTout = -1, finNeuves = -1;
  for (const { n, neuve } of toutes) {
    if (n.h !== hauteur) { hauteur = n.h; finTout = -1; finNeuves = -1; }
    // Une note chevauche une note d'avant si l'une d'elles finit après son début.
    if ((neuve && finTout > n.d) || finNeuves > n.d) return `deux notes de hauteur ${n.h} se chevauchent (au pas ${n.d})`;
    finTout = Math.max(finTout, n.d + n.l);
    if (neuve) finNeuves = Math.max(finNeuves, n.d + n.l);
  }
  return null;
}

/** Combien de paires de notes de même hauteur se chevauchent, piste par piste. */
function chevauchements(/** @type {Sequence} */ seq) {
  let total = 0;
  for (const p of seq.pistes) {
    const notes = [...p.notes].sort((x, y) => x.h - y.h || x.d - y.d);
    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length && notes[j].h === notes[i].h && notes[j].d < notes[i].d + notes[i].l; j++) total++;
    }
  }
  return total;
}

/** Un nom d'accord que Portée sait lire et jouer (accords.js), rogné ; null sinon. */
export function nomDAccord(/** @type {unknown} */ nom) {
  if (typeof nom !== "string" || nom.length > 24) return null;
  const n = nom.trim();
  return FORME.test(n) && lireAccord(n) ? n : null;
}

// ------------------------------------------------------------------------
// Le cadre d'une demande : ce qu'on demande, où, entre quelles bornes
// ------------------------------------------------------------------------

/** La tessiture permise autour des notes d'une piste ; cinq octaves autour du do central si elle est vide. */
function tessitureDe(/** @type {Note[]} */ notes, /** @type {number} */ marge) {
  if (!notes.length) return { bas: 36, haut: 96 };
  let bas = Infinity, haut = -Infinity;
  for (const n of notes) { bas = Math.min(bas, n.h); haut = Math.max(haut, n.h); }
  return { bas: Math.max(BORNES.bas, bas - marge), haut: Math.min(BORNES.haut, haut + marge) };
}

/**
 * Jusqu'où « libre » peut aller : le double de l'idée, au moins quatre
 * mesures de plus (« ajoute une fin »), sans dépasser 256 mesures. Au-delà,
 * une note n'est plus une proposition mais une erreur de calcul.
 */
function finLibre(/** @type {Sequence} */ seq) {
  const nb = nbMesures(seq);
  return Math.max(nb, Math.min(MAX_MESURES, Math.max(2 * nb, nb + 4))) * pasParMesure(seq);
}

/**
 * La sélection, lue sur l'idée : { selection: { piste, ids, debut, fin } ou
 * null (sans sélection), raison (null si elle va) }.
 * @param {Sequence} seq @param {Selection | undefined} sel
 */
function selectionDe(seq, sel) {
  /** @type {{ selection: { piste: number, ids: number[], debut: number, fin: number } | null, raison: string | null }} */
  const sortie = { selection: null, raison: null };
  if (!sel || sel.ids == null) return sortie;
  const voulus = new Set(sel.ids);
  if (!voulus.size) return sortie;
  const p = sel.piste ?? 0;
  const piste = seq.pistes[p];
  if (!piste) return { ...sortie, raison: `La piste ${p + 1} n'existe pas.` };
  const notes = piste.notes.filter((n) => voulus.has(n.id));
  if (!notes.length) return { ...sortie, raison: "Les notes choisies ne sont plus dans l'idée." };
  sortie.selection = {
    piste: p, ids: notes.map((n) => n.id),
    debut: Math.min(...notes.map((n) => n.d)), fin: Math.max(...notes.map((n) => n.d + n.l)),
  };
  return sortie;
}

/**
 * @typedef {object} Cadre
 * @property {string} [raison]  ce qui empêche la demande
 * @property {number} ppm  pas par mesure
 * @property {number} ppt  pas par temps
 * @property {number} nb  mesures de l'idée
 * @property {number} piste
 * @property {{ piste: number, ids: number[], debut: number, fin: number } | null} selection
 * @property {number[]} [mesures]  pour les accords : la première et la dernière mesure (comptées de 1)
 * @property {number[]} [fenetre]  [a, b[ en pas, où les notes doivent tenir
 * @property {number} [origine]  pour une suite : où elle commence
 * @property {number[]} [ids]  les notes que la proposition remplace
 * @property {{ bas: number, haut: number }} [tessiture]
 * @property {number} [maxNotes]
 */

/** @param {string} genre @param {Sequence} seq @param {Options} options @returns {Cadre} */
function cadre(genre, seq, options) {
  const ppm = pasParMesure(seq), ppt = pasParTemps(seq), nb = nbMesures(seq);
  /** @type {Cadre} */
  const c = { ppm, ppt, nb, piste: 0, selection: null };
  const non = (/** @type {string} */ raison) => ({ ...c, raison });
  if (!GENRES.includes(genre)) return non(`Genre inconnu : « ${genre} ».`);
  const total = seq.pistes.reduce((t, p) => t + p.notes.length, 0);
  if (total > MAX_NOTES_ENVOYEES) return non(`Cette idée a trop de notes pour Claude (plus de ${MAX_NOTES_ENVOYEES}) : essaie sur une idée plus courte.`);
  const lue = selectionDe(seq, options.selection);
  if (lue.raison) return non(lue.raison);
  const sel = lue.selection;
  c.selection = sel;
  c.piste = sel ? sel.piste : options.piste ?? 0;
  const piste = seq.pistes[c.piste];
  if (!piste) return non(`La piste ${c.piste + 1} n'existe pas.`);
  const finIdee = nb * ppm;
  if (genre === "accords") {
    if (!total) return non("Écris d'abord quelques notes : Claude propose des accords d'après elles.");
    c.mesures = sel ? [Math.floor(sel.debut / ppm) + 1, Math.ceil(sel.fin / ppm)] : [1, nb];
  } else if (genre === "suite") {
    if (!piste.notes.length) return non("Écris d'abord le début de l'idée : Claude en propose la suite.");
    if (finIdee + 2 * ppm > MAX_PAS) return non("Cette idée est déjà au plus long : la bibliothèque ne garderait pas sa suite.");
    c.origine = finIdee;
    c.fenetre = [finIdee, finIdee + 2 * ppm];
    c.ids = [];
    c.tessiture = tessitureDe(piste.notes, MARGE);
  } else if (genre === "variation") {
    // Une clé propre à INTENTIONS : « in » accepterait « toString » ou « __proto__ ».
    if (typeof options.intention !== "string" || !Object.hasOwn(INTENTIONS, options.intention)) return non(`Intention inconnue : choisis parmi ${Object.keys(INTENTIONS).join(", ")}.`);
    if (!piste.notes.length) return non("Écris d'abord quelques notes : Claude varie ce qui est écrit.");
    c.fenetre = sel ? [sel.debut, sel.fin] : [0, finIdee];
    c.ids = sel ? sel.ids : piste.notes.map((n) => n.id);
    c.tessiture = tessitureDe(piste.notes, MARGE);
  } else if (genre === "titre") {
    if (!total) return non("Écris d'abord quelques notes : Claude trouve un titre d'après elles.");
  } else {
    const phrase = typeof options.phrase === "string" ? nettoyer(options.phrase) : "";
    if (!phrase) return non("Dis à Claude ce que tu veux, en une phrase.");
    if (phrase.length > MAX_PHRASE) return non(`Ta demande est trop longue : ${MAX_PHRASE} caractères au plus.`);
    c.fenetre = [0, finLibre(seq)];
    c.ids = piste.notes.map((n) => n.id);
    c.tessiture = tessitureDe(piste.notes, MARGE_LIBRE);
  }
  if (c.fenetre) c.maxNotes = Math.min(MAX_NOTES, NOTES_PAR_PAS * (c.fenetre[1] - c.fenetre[0]));
  return c;
}

/**
 * Ce qui empêche de demander (pas de notes, pas d'intention, une phrase
 * vide…), en français pour Adrien, ou null : l'écran grise le bouton et le
 * dit, plutôt que d'envoyer une demande sans objet.
 * @param {string} genre @param {Sequence} idee @param {Options} [options]
 */
export function empechement(genre, idee, options = {}) {
  return cadre(genre, idee, options).raison || null;
}

// ------------------------------------------------------------------------
// Ce qui part
// ------------------------------------------------------------------------

/** « 3.1 », « 2.3 » (mesure.temps, comptés de 1), « 4.2+1 » hors d'un temps. */
function position(/** @type {number} */ d, /** @type {Cadre} */ c) {
  const m = Math.floor(d / c.ppm) + 1, dans = d % c.ppm;
  const t = Math.floor(dans / c.ppt) + 1, reste = dans % c.ppt;
  return `${m}.${t}${reste ? `+${reste}` : ""}`;
}

const lesMesures = (/** @type {number} */ m1, /** @type {number} */ m2) => (m1 === m2 ? `la mesure ${m1}` : `les mesures ${m1} à ${m2}`);

/** Les lignes qui décrivent l'idée : tempo, mesure, tonalité, accords, notes (mesure par mesure). */
function decrireIdee(/** @type {Sequence} */ seq, /** @type {Cadre} */ c) {
  const temps = c.ppm / c.ppt;
  const lignes = [
    `Tempo : ${seq.tempo} à la noire. Mesure : ${seq.mesure[0]}/${seq.mesure[1]} (${c.ppm} pas par mesure : ${temps} temps de ${c.ppt} pas). Tonalité : ${nomTonalite(seq.tonalite)} (${seq.tonalite}). ${c.nb} mesure${c.nb > 1 ? "s" : ""}.`,
    "Le temps se compte en pas de double croche : 4 pas = une noire. Mesures et temps se comptent à partir de 1, les pas à partir de 0.",
  ];
  const accords = [...(seq.accords || [])].filter((a) => nomDAccord(a.nom)).sort((a, b) => a.d - b.d);
  lignes.push(accords.length
    ? `Accords (mesure.temps nom ; un accord sonne jusqu'au suivant) : ${accords.map((a) => `${position(a.d, c)} ${a.nom.trim()}`).join(", ")}.`
    : "Accords : aucun.");
  const choisies = new Set(c.selection ? c.selection.ids : []);
  lignes.push(`Notes, mesure par mesure. Chaque note : début et durée en pas depuis le début de l'idée, hauteur MIDI, nom (« 4 2 71 si4 » : au pas 4, deux pas, MIDI 71, si4)${choisies.size ? " ; * = les notes choisies par Adrien" : ""}.`);
  seq.pistes.forEach((p, i) => {
    lignes.push(`Piste ${i + 1} « ${nettoyer(p.nom || "")} »${p.notes.length ? " :" : " : vide."}`);
    /** @type {Map<number, string[]>} */
    const parMesure = new Map();
    for (const n of [...p.notes].sort((x, y) => x.d - y.d || x.h - y.h)) {
      const m = Math.floor(n.d / c.ppm) + 1;
      if (!parMesure.has(m)) parMesure.set(m, []);
      parMesure.get(m).push(`${n.d} ${n.l} ${n.h} ${nomNote(n.h, seq.tonalite)}${choisies.has(n.id) && c.selection.piste === i ? "*" : ""}`);
    }
    for (const [m, notes] of parMesure) lignes.push(`m${m} : ${notes.join(" ; ")}`);
  });
  if (c.selection) {
    const s = c.selection;
    lignes.push(`Adrien a choisi ${s.ids.length} note${s.ids.length > 1 ? "s" : ""} de la piste ${s.piste + 1}, du pas ${s.debut} au pas ${s.fin} (${lesMesures(Math.floor(s.debut / c.ppm) + 1, Math.ceil(s.fin / c.ppm))}).`);
  }
  return lignes;
}

const JSON_SEUL = "Réponds seulement par un objet JSON de cette forme, sans texte autour :";
const POURQUOI = "« pourquoi » : une ou deux phrases en français pour Adrien, qui ne lit pas l'ABC : parle en noms de notes (do, ré, mi), en mesures et en temps, sans numéros MIDI.";
const NOTES_SANS_CHEVAUCHER = "Deux notes de même hauteur ne se chevauchent pas.";

/** La hauteur d'exemple : la dernière note de la piste, ou le do central. */
function hauteurExemple(/** @type {Sequence} */ seq, /** @type {number} */ p) {
  const notes = seq.pistes[p].notes;
  return notes.length ? notes.reduce((m, n) => (n.d >= m.d ? n : m)).h : 60;
}

const bornesHauteur = (/** @type {{ bas: number, haut: number }} */ t, /** @type {string} */ k) => `de ${t.bas} (${nomNote(t.bas, k)}) à ${t.haut} (${nomNote(t.haut, k)})`;

/** @param {string} genre @param {Sequence} seq @param {Cadre} c @param {Options} options */
function tache(genre, seq, c, options) {
  const k = seq.tonalite;
  const nomPiste = `la piste ${c.piste + 1} « ${nettoyer(seq.pistes[c.piste].nom || "")} »`;
  if (genre === "accords") {
    const [m1, m2] = c.mesures;
    const temps = c.ppm / c.ppt;
    // Le majeur d'abord : JavaScript range « 6 », « 7 », « 9 » devant les autres clés.
    const qualites = ["(majeur)", ...Object.keys(QUALITES).filter((q) => q)].join(", ");
    const lieu = c.selection ? `${lesMesures(m1, m2)}, où sont les notes choisies` : `toute l'idée (${lesMesures(m1, m2)})`;
    return [
      `Ce qu'Adrien te demande : des accords pour ${lieu}. Ils remplacent ceux qui y sont.`,
      `Un ou deux accords par mesure, chacun sur un temps (de 1 à ${temps}) ; un accord sonne jusqu'au suivant, inutile de le répéter.`,
      `Noms à l'anglaise, avec # et b (pas ♯ ni ♭) : C, Am, F#m7, Bb, G7, Dsus4, Cmaj7, Em/B. Sortes d'accords permises : ${qualites} ; une basse après « / ».`,
      JSON_SEUL,
      `{"accords": [{"mesure": ${m1}, "temps": 1, "nom": "${k}"}], "pourquoi": "…"}`,
      POURQUOI,
    ];
  }
  if (genre === "suite") {
    const n = c.nb;
    return [
      `Ce qu'Adrien te demande : la suite de ${nomPiste}, deux mesures qui prolongent l'idée juste après sa dernière mesure (les mesures ${n + 1} et ${n + 2}).`,
      `« debut » se compte depuis la fin de l'idée : 0 = le premier temps de la mesure ${n + 1}. Chaque note finit au plus tard au pas ${2 * c.ppm} (debut + duree ≤ ${2 * c.ppm}).`,
      `Hauteurs ${bornesHauteur(c.tessiture, k)}. Garde la tonalité, le caractère et les rythmes de l'idée. ${NOTES_SANS_CHEVAUCHER}`,
      JSON_SEUL,
      `{"notes": [{"debut": 0, "duree": ${c.ppt}, "hauteur": ${hauteurExemple(seq, c.piste)}}], "pourquoi": "…"}`,
      POURQUOI,
    ];
  }
  if (genre === "variation") {
    const [a, b] = c.fenetre;
    const quoi = c.selection ? `des notes choisies (marquées *, sur ${nomPiste})` : `de toute ${nomPiste}`;
    return [
      `Ce qu'Adrien te demande : une variation ${quoi}, ${options.intention} : ${INTENTIONS[options.intention]}.`,
      `Rends toutes les notes qui remplaceront ${c.selection ? "les notes choisies ; les autres ne bougent pas" : "celles de la piste"}. « debut » se compte depuis le début de l'idée ; chaque note tient du pas ${a} au pas ${b} (debut ≥ ${a}, debut + duree ≤ ${b}).`,
      `Hauteurs ${bornesHauteur(c.tessiture, k)}. ${NOTES_SANS_CHEVAUCHER}`,
      JSON_SEUL,
      `{"notes": [{"debut": ${a}, "duree": ${c.ppt}, "hauteur": ${hauteurExemple(seq, c.piste)}}], "pourquoi": "…"}`,
      POURQUOI,
    ];
  }
  if (genre === "titre") {
    const liste = (/** @type {unknown} */ x, /** @type {number} */ n) => (Array.isArray(x) ? x.filter((t) => typeof t === "string").map((t) => couper(nettoyer(t), 40)).filter(Boolean).slice(0, n) : []);
    const actuel = typeof options.titre === "string" ? couper(nettoyer(options.titre), 120) : "";
    const siennes = liste(options.etiquettes, 20), connues = liste(options.etiquettesConnues, 40);
    return [
      `Ce qu'Adrien te demande : un titre pour cette idée, court et évocateur, en français (${MAX_TITRE} caractères au plus), et de 0 à ${MAX_ETIQUETTES} étiquettes (un ou deux mots en minuscules chacune, ${MAX_ETIQUETTE} caractères au plus : une humeur, un genre, un usage).`,
      ...(actuel ? [`Son titre actuel : « ${actuel} ».`] : []),
      ...(siennes.length ? [`Ses étiquettes actuelles : ${siennes.join(", ")}.`] : []),
      ...(connues.length ? [`Étiquettes déjà dans sa bibliothèque (reprends-les si elles conviennent) : ${connues.join(", ")}.`] : []),
      JSON_SEUL,
      `{"titre": "…", "etiquettes": ["…"]}`,
    ];
  }
  const phrase = couper(nettoyer(options.phrase), MAX_PHRASE);
  const [, w] = c.fenetre;
  if (Array.isArray(options.outils) && options.outils.length) {
    return [
      `Ce qu'Adrien te demande, avec ses mots : « ${phrase} »`,
      "Tu as des outils qui modifient une copie de l'idée : rien n'est gardé avant qu'Adrien l'ait écoutée et acceptée. Sers-t'en pour faire ce qu'il demande (plusieurs appels si besoin). Les pistes se comptent à partir de 1, les pas à partir de 0.",
      "Si sa demande ne se fait pas avec ces outils, ne touche à rien et dis-le dans « pourquoi ».",
      "Quand c'est fait, réponds seulement par un objet JSON de cette forme, sans texte autour :",
      `{"pourquoi": "…"}`,
      `« pourquoi » : ce que tu as fait, en une ou deux phrases en français pour Adrien, qui ne lit pas l'ABC : parle en noms de notes (do, ré, mi), en mesures et en temps.`,
    ];
  }
  return [
    `Ce qu'Adrien te demande, avec ses mots : « ${phrase} »`,
    `Rends toutes les notes de ${nomPiste} une fois sa demande faite, celles que tu ne changes pas comprises : elles remplaceront la piste. « debut » se compte depuis le début de l'idée ; chaque note finit au plus tard au pas ${w} (debut + duree ≤ ${w}).`,
    `Hauteurs ${bornesHauteur(c.tessiture, k)}. ${NOTES_SANS_CHEVAUCHER} Si sa demande ne se fait pas en notes, rends les notes telles quelles et dis-le dans « pourquoi ».`,
    JSON_SEUL,
    `{"notes": [{"debut": 0, "duree": ${c.ppt}, "hauteur": ${hauteurExemple(seq, c.piste)}}], "pourquoi": "…"}`,
    POURQUOI,
  ];
}

/**
 * Ce qu'on envoie à Claude : { input, opts }, prêts pour
 * `sample.json(input, { ...opts, signal, onText })`. `input` est un texte
 * (la forme simple de sample.d.ts) ; `opts.modelTier` est « quick » pour un
 * titre (court, sans réflexion), « default » sinon. `opts.cache` est false :
 * une réponse refusée ici a pourtant réussi pour `sample`, qui la
 * rejouerait pendant cinq minutes à chaque « réessaie » ; et redemander des
 * accords doit en proposer d'autres. Pour « libre » avec `options.outils`,
 * `opts.tools` les porte. Lance une Error (en français) si la demande est
 * sans objet (empechement).
 * @param {string} genre @param {Sequence} idee @param {Options} [options]
 * @returns {{ input: string, opts: { modelTier: "default" | "quick", cache: false, tools?: object[] } }}
 */
export function demande(genre, idee, options = {}) {
  const c = cadre(genre, idee, options);
  if (c.raison) throw new Error(c.raison);
  const input = [
    "Tu aides Adrien à composer dans Portée, son carnet de musique de poche. Voici l'une de ses idées, en notes.",
    "",
    ...decrireIdee(idee, c),
    "",
    ...tache(genre, idee, c, options),
  ].join("\n");
  /** @type {{ modelTier: "default" | "quick", cache: false, tools?: object[] }} */
  const opts = { modelTier: genre === "titre" ? "quick" : "default", cache: false };
  if (genre === "libre" && Array.isArray(options.outils) && options.outils.length) opts.tools = options.outils;
  return { input, opts };
}

// ------------------------------------------------------------------------
// Ce qui revient
// ------------------------------------------------------------------------

/** Les notes remplacées sont-elles exactement les nouvelles ? (une « variation » qui ne change rien) */
function memesNotes(/** @type {Note[]} */ avant, /** @type {NoteNeuve[]} */ apres) {
  const cle = (/** @type {NoteNeuve[]} */ l) => l.map((n) => `${n.d},${n.l},${n.h}`).sort().join(";");
  return cle(avant) === cle(apres);
}

/** @param {unknown} rep @param {Sequence} seq @param {Cadre} c */
function validerAccords(rep, seq, c) {
  const e = champs(rep, ["accords", "pourquoi"], ["accords"], "réponse");
  if (e) return refus(e);
  const liste = /** @type {{ accords: unknown }} */ (rep).accords;
  const [m1, m2] = c.mesures;
  const temps = c.ppm / c.ppt;
  const max = 2 * (m2 - m1 + 1);
  if (!Array.isArray(liste) || !liste.length) return refus("accords : une liste non vide attendue");
  if (liste.length > max) return refus(`accords : ${max} au plus (deux par mesure)`);
  /** @type {Accord[]} */
  const accords = [];
  /** @type {Map<number, number>} */
  const parMesure = new Map();
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i], ici = `accords[${i}]`;
    const ea = champs(a, ["mesure", "temps", "nom"], ["mesure", "temps", "nom"], ici);
    if (ea) return refus(ea);
    if (!entierDans(a.mesure, m1, m2)) return refus(`${ici} : mesure de ${m1} à ${m2} attendue, reçu ${JSON.stringify(a.mesure)}`);
    if (!entierDans(a.temps, 1, temps)) return refus(`${ici} : temps de 1 à ${temps} attendu, reçu ${JSON.stringify(a.temps)}`);
    const nom = nomDAccord(a.nom);
    if (!nom) return refus(`${ici} : accord illisible ${JSON.stringify(a.nom)}`);
    const d = (a.mesure - 1) * c.ppm + (a.temps - 1) * c.ppt;
    if (accords.some((x) => x.d === d)) return refus(`${ici} : deux accords au même temps`);
    parMesure.set(a.mesure, (parMesure.get(a.mesure) || 0) + 1);
    if (parMesure.get(a.mesure) > 2) return refus(`${ici} : plus de deux accords dans la mesure ${a.mesure}`);
    accords.push({ d, nom });
  }
  const p = lirePourquoi(/** @type {{ pourquoi?: unknown }} */ (rep).pourquoi);
  if (p.raison) return refus(p.raison);
  accords.sort((a, b) => a.d - b.d);
  return { ok: /** @type {true} */ (true), proposition: { genre: "accords", accords, debut: (m1 - 1) * c.ppm, fin: m2 * c.ppm, pourquoi: p.pourquoi } };
}

/** Suite, variation, ou « libre » sans outils : des notes à poser sur une piste. */
function validerNotes(/** @type {string} */ genre, /** @type {unknown} */ rep, /** @type {Sequence} */ seq, /** @type {Cadre} */ c) {
  const e = champs(rep, ["notes", "pourquoi"], ["notes"], "réponse");
  if (e) return refus(e);
  const r = /** @type {{ notes: unknown, pourquoi?: unknown }} */ (rep);
  const lues = lireNotes(r.notes, { decalage: genre === "suite" ? c.origine : 0, fenetre: c.fenetre, tessiture: c.tessiture, max: c.maxNotes });
  if (lues.raison) return refus(lues.raison);
  const remplacees = new Set(c.ids);
  const piste = seq.pistes[c.piste];
  const restantes = piste.notes.filter((n) => !remplacees.has(n.id));
  const ch = chevauchement(lues.notes, restantes);
  if (ch) return refus(ch);
  const p = lirePourquoi(r.pourquoi);
  if (p.raison) return refus(p.raison);
  if (genre !== "suite" && memesNotes(piste.notes.filter((n) => remplacees.has(n.id)), lues.notes)) {
    return { ok: /** @type {false} */ (false), raison: "Claude n'a rien changé.", pourquoi: p.pourquoi };
  }
  return { ok: /** @type {true} */ (true), proposition: { genre, piste: c.piste, ids: [...c.ids], notes: lues.notes, pourquoi: p.pourquoi } };
}

function validerTitre(/** @type {unknown} */ rep) {
  const e = champs(rep, ["titre", "etiquettes", "pourquoi"], ["titre"], "réponse");
  if (e) return refus(e);
  const r = /** @type {{ titre: unknown, etiquettes?: unknown, pourquoi?: unknown }} */ (rep);
  if (typeof r.titre !== "string") return refus("titre : un texte attendu");
  const titre = nettoyer(r.titre);
  if (!titre) return refus("titre : vide");
  if (titre.length > MAX_TITRE) return refus(`titre : ${MAX_TITRE} caractères au plus`);
  /** @type {string[]} */
  const etiquettes = [];
  if (r.etiquettes !== undefined) {
    if (!Array.isArray(r.etiquettes)) return refus("etiquettes : une liste attendue");
    if (r.etiquettes.length > MAX_ETIQUETTES) return refus(`etiquettes : ${MAX_ETIQUETTES} au plus`);
    for (const [i, t] of r.etiquettes.entries()) {
      if (typeof t !== "string") return refus(`etiquettes[${i}] : un texte attendu`);
      // En minuscules, comme la bibliothèque les range (fiche.js) : ce n'est pas réparer, c'est leur forme.
      const n = nettoyer(t).toLowerCase();
      if (!n) return refus(`etiquettes[${i}] : vide`);
      if (n.length > MAX_ETIQUETTE) return refus(`etiquettes[${i}] : ${MAX_ETIQUETTE} caractères au plus`);
      if (!etiquettes.includes(n)) etiquettes.push(n);
    }
  }
  const p = lirePourquoi(r.pourquoi);
  if (p.raison) return refus(p.raison);
  return { ok: /** @type {true} */ (true), proposition: { genre: "titre", titre, etiquettes, pourquoi: p.pourquoi } };
}

/**
 * « libre » avec outils : Claude a travaillé sur la copie, sa réponse dit
 * seulement ce qu'il a fait. On revérifie la copie elle-même : bornes,
 * chevauchements, et qu'elle diffère de l'idée.
 * @param {unknown} rep @param {Sequence} seq @param {Cadre} c @param {Sequence} copie
 */
function validerCopie(rep, seq, c, copie) {
  const e = champs(rep, ["pourquoi"], [], "réponse");
  if (e) return refus(e);
  const p = lirePourquoi(/** @type {{ pourquoi?: unknown }} */ (rep).pourquoi);
  if (p.raison) return refus(p.raison);
  const f = formeSure(copie);
  if (f) return refus(`copie : ${f}`);
  if (!estObjet(copie) || !Array.isArray(copie.pistes) || copie.pistes.length !== seq.pistes.length) return refus("copie : ce n'est pas l'idée");
  const [, w] = c.fenetre;
  for (const [i, piste] of copie.pistes.entries()) {
    if (!estObjet(piste) || !Array.isArray(piste.notes)) return refus(`copie : piste ${i + 1} illisible`);
    for (const n of piste.notes) {
      if (!estObjet(n) || !Number.isInteger(n.id) || !entierDans(n.d, 0, w - 1) || !entierDans(n.l, 1, w - n.d) || !entierDans(n.h, BORNES.bas, BORNES.haut)) return refus(`copie : une note de la piste ${i + 1} est hors des bornes`);
    }
  }
  for (const a of copie.accords || []) {
    if (!estObjet(a) || !entierDans(a.d, 0, w - 1) || !nomDAccord(a.nom)) return refus("copie : un accord illisible ou hors de l'idée");
  }
  if (chevauchements(copie) > chevauchements(seq)) return refus("copie : deux notes de même hauteur se chevauchent");
  const musique = (/** @type {Sequence} */ s) => JSON.stringify([s.pistes.map((x) => x.notes.map((n) => [n.d, n.l, n.h]).sort()), (s.accords || []).map((a) => [a.d, a.nom]).sort()]);
  if (musique(copie) === musique(seq)) return { ok: /** @type {false} */ (false), raison: "Claude n'a rien changé.", pourquoi: p.pourquoi };
  return { ok: /** @type {true} */ (true), proposition: { genre: "libre", sequence: cloner(copie), pourquoi: p.pourquoi } };
}

/**
 * Vérifie ce que Claude a rendu (le JSON déjà lu par `sample.json`), avec
 * les mêmes `options` qu'à demande(). Rend { ok: true, proposition } ou
 * { ok: false, raison } : `raison` sert aux tests et à la console ; l'écran
 * dit seulement MESSAGE_REFUS. Quand Claude n'a rien changé (« libre »,
 * « variation »), le refus porte aussi son `pourquoi`, que l'écran peut
 * montrer (« je ne sais pas mettre cette idée en valse »).
 *
 * Propositions : « accords » { accords: [{ d, nom }], debut, fin } (en pas ;
 * [debut, fin[ : les mesures dont ils remplacent les accords) ; « suite »,
 * « variation », « libre » sans outils { piste, ids (les notes remplacées),
 * notes: [{ d, l, h }] } ; « libre » avec outils { sequence } ; « titre »
 * { titre, etiquettes }. Toutes ont `genre` et `pourquoi`.
 * @param {string} genre @param {unknown} reponse @param {Sequence} idee @param {Options} [options]
 */
export function valider(genre, reponse, idee, options = {}) {
  const c = cadre(genre, idee, options);
  if (c.raison) return refus(c.raison);
  const f = formeSure(reponse);
  if (f) return refus(f);
  if (!estObjet(reponse)) return refus("un objet JSON attendu");
  if (genre === "accords") return validerAccords(reponse, idee, c);
  if (genre === "titre") return validerTitre(reponse);
  if (genre === "libre" && options.copie !== undefined) return validerCopie(reponse, idee, c, options.copie);
  return validerNotes(genre, reponse, idee, c);
}

// ------------------------------------------------------------------------
// Appliquer : une nouvelle idée, jamais l'ancienne modifiée
// (de petites fonctions que sequence.js n'a pas : remplacer d'un coup)
// ------------------------------------------------------------------------

/** Ajoute des notes à une piste (sur place), chacune avec un numéro neuf, et la range comme sequence.js. */
export function ajouterNotes(/** @type {Sequence} */ seq, /** @type {number} */ p, /** @type {NoteNeuve[]} */ notes) {
  const piste = seq.pistes[p];
  // Un `suivant` en retard sur les numéros donnerait deux fois le même.
  let max = 0;
  for (const x of seq.pistes) for (const n of x.notes) max = Math.max(max, n.id || 0);
  seq.suivant = Math.max(Number.isInteger(seq.suivant) ? seq.suivant : 1, max + 1);
  for (const n of notes) piste.notes.push({ id: seq.suivant++, d: n.d, l: n.l, h: n.h, ...(n.v ? { v: n.v } : {}) });
  piste.notes.sort((a, b) => a.d - b.d || a.h - b.h);
}

/** Remplace des notes d'une piste (sur place) : celles de `ids` partent, `notes` arrivent. */
export function remplacerNotes(/** @type {Sequence} */ seq, /** @type {number} */ p, /** @type {number[]} */ ids, /** @type {NoteNeuve[]} */ notes) {
  const partis = new Set(ids);
  seq.pistes[p].notes = seq.pistes[p].notes.filter((n) => !partis.has(n.id));
  ajouterNotes(seq, p, notes);
}

/**
 * Pose des accords sur [debut, fin[ à la place de ceux qui y étaient. Un
 * accord sonne jusqu'au suivant : si celui qui sonnait à `fin` a été
 * remplacé et que l'idée continue, on le redit à `fin`, sinon la mesure
 * d'après changerait d'harmonie sans qu'on l'ait demandé. Le premier accord
 * met les accords plaqués en route, comme dans l'appli (décision du 01/10).
 * @param {Sequence} seq @param {Accord[]} accords @param {number} debut @param {number} fin
 */
export function poserAccords(seq, accords, debut, fin) {
  const avant = [...(seq.accords || [])].sort((a, b) => a.d - b.d);
  const enVigueur = (/** @type {Accord[]} */ liste, /** @type {number} */ pos) => liste.filter((a) => a.d <= pos).at(-1) || null;
  const sonnait = enVigueur(avant, fin);
  const nouveaux = [...avant.filter((a) => a.d < debut || a.d >= fin), ...accords.map((a) => ({ d: a.d, nom: a.nom }))].sort((a, b) => a.d - b.d);
  const continueApres = seq.pistes.some((p) => p.notes.some((n) => n.d + n.l > fin)) || avant.some((a) => a.d > fin);
  if (sonnait && sonnait.d < fin && continueApres && !nouveaux.some((a) => a.d === fin)) {
    const maintenant = enVigueur(nouveaux, fin);
    if (!maintenant || maintenant.nom !== sonnait.nom) nouveaux.push({ d: fin, nom: sonnait.nom });
  }
  seq.accords = nouveaux.sort((a, b) => a.d - b.d);
  if (seq.accords.length && (!seq.accompagnement || seq.accompagnement === "aucun")) seq.accompagnement = "plaque";
}

/**
 * La proposition validée, appliquée : une NOUVELLE séquence (l'idée reçue
 * n'est jamais touchée), que l'écran écrit d'un coup pour qu'un seul
 * « Annuler » la défasse. Pour « titre », { titre, etiquettes } : ils vivent
 * à côté des notes (idee.js : e.titre, e.etiquettes), hors d'« Annuler » ;
 * les étiquettes proposées s'ajoutent à `options.etiquettes`.
 * @param {string} genre @param {Sequence} idee @param {any} proposition @param {Options} [options]
 * @returns {Sequence | { titre: string, etiquettes: string[] }}
 */
export function appliquer(genre, idee, proposition, options = {}) {
  if (!proposition || proposition.genre !== genre) throw new Error(`Cette proposition n'est pas du genre « ${genre} ».`);
  if (genre === "titre") {
    const siennes = Array.isArray(options.etiquettes) ? options.etiquettes.filter((t) => typeof t === "string") : [];
    return { titre: proposition.titre, etiquettes: [...new Set([...siennes, ...proposition.etiquettes])] };
  }
  if (genre === "libre" && proposition.sequence) return cloner(proposition.sequence);
  const seq = cloner(idee);
  if (genre === "accords") poserAccords(seq, proposition.accords, proposition.debut, proposition.fin);
  else remplacerNotes(seq, proposition.piste, proposition.ids, proposition.notes);
  return seq;
}

// ------------------------------------------------------------------------
// « libre », quand la page peut offrir des outils à Claude
// ------------------------------------------------------------------------

const PORTEE = {
  piste: { type: "integer", minimum: 1, description: "La piste, comptée de 1 (1 par défaut)." },
  debut: { type: "integer", minimum: 0, description: "Seulement les notes qui commencent à partir de ce pas (0 par défaut)." },
  fin: { type: "integer", minimum: 1, description: "… et avant ce pas (la fin de l'idée par défaut)." },
};
// Sans « required » quand rien n'est requis : une liste vide n'est pas permise partout (JSON Schema draft 4).
const schema = (/** @type {Record<string, unknown>} */ proprietes, /** @type {string[]} */ requis = []) => ({
  type: /** @type {"object"} */ ("object"), properties: proprietes, ...(requis.length ? { required: requis } : {}), additionalProperties: false,
});

/**
 * Des outils pour Claude, au format de sample.d.ts ({ name, description,
 * inputSchema, execute }), qui travaillent sur une COPIE de l'idée :
 * transposer, étirer, à l'envers, miroir, recaler, poser des accords,
 * ajouter ou effacer des notes. Les gestes sont ceux de sequence.js
 * (`gestes`, voir l'en-tête) : Claude fait ce que ferait Adrien. Chaque
 * `execute` rend peu de chose (ce qui est fait et la taille de la copie) et
 * lève une Error en français sur une entrée invalide : Claude la lit et
 * corrige. Un geste qui ferait se chevaucher deux notes de même hauteur, ou
 * déborder l'idée, est défait avant l'erreur : la copie reste jouable.
 * `copie()` rend l'état final, à passer à valider (options.copie).
 * `max` : combien d'outils au plus (sample.limits().tools.maxCount) ; les
 * premiers sont les plus utiles.
 * @param {Sequence} idee @param {Gestes} gestes @param {{ max?: number }} [options]
 */
export function outilsSurCopie(idee, gestes, { max = Infinity } = {}) {
  for (const g of ["transposer", "etirer", "retrograder", "renverser", "recaler", "poser", "effacer"]) {
    if (!gestes || typeof gestes[g] !== "function") throw new Error(`outilsSurCopie : le geste « ${g} » de sequence.js manque.`);
  }
  let etat = cloner(idee);
  const ppm = pasParMesure(idee), ppt = pasParTemps(idee);
  const w = finLibre(idee);
  const verifier = (/** @type {unknown} */ entree, /** @type {string[]} */ permis, /** @type {string[]} */ requis = []) => {
    const e = champs(entree ?? {}, permis, requis, "entrée") || formeSure(entree ?? {});
    if (e) throw new Error(`${e} (permis : ${permis.join(", ")}).`);
    return /** @type {Record<string, any>} */ (entree ?? {});
  };
  const pisteDe = (/** @type {unknown} */ v) => {
    if (v === undefined) return 0;
    if (!entierDans(v, 1, etat.pistes.length)) throw new Error(`piste : de 1 à ${etat.pistes.length}.`);
    return /** @type {number} */ (v) - 1;
  };
  /** Les notes d'une piste qui commencent dans [debut, fin[. */
  const choisir = (/** @type {Record<string, any>} */ e) => {
    const p = pisteDe(e.piste);
    if (e.debut !== undefined && !entierDans(e.debut, 0, w)) throw new Error(`debut : un pas de 0 à ${w}.`);
    if (e.fin !== undefined && !entierDans(e.fin, 1, w)) throw new Error(`fin : un pas de 1 à ${w}.`);
    const debut = e.debut ?? 0, fin = e.fin ?? w;
    const ids = etat.pistes[p].notes.filter((n) => n.d >= debut && n.d < fin).map((n) => n.id);
    if (!ids.length) throw new Error(`Aucune note de la piste ${p + 1} ne commence entre les pas ${debut} et ${fin}.`);
    return { p, ids };
  };
  const resume = (/** @type {string} */ fait) => {
    const notes = etat.pistes.reduce((t, x) => t + x.notes.length, 0);
    return { fait, notes, mesures: Math.max(1, Math.ceil(finSequence(etat) / ppm)) };
  };
  /** Fait un geste ; s'il abîme la copie, le défait et le dit à Claude. */
  const geste = (/** @type {() => string} */ f) => {
    const sauve = cloner(etat), avant = chevauchements(etat);
    let fait;
    try {
      fait = f();
    } catch (erreur) {
      etat = sauve;
      throw new Error(`Rien n'est fait : ${erreur && erreur.message ? erreur.message : "le geste a échoué"}.`, { cause: erreur });
    }
    let raison = null;
    if (chevauchements(etat) > avant) raison = "deux notes de même hauteur se chevaucheraient";
    else if (finSequence(etat) > w) raison = `l'idée dépasserait le pas ${w}`;
    if (raison) { etat = sauve; throw new Error(`Rien n'est fait : ${raison}. Choisis d'autres notes ou un autre réglage.`); }
    return resume(fait);
  };
  const nb = (/** @type {number} */ n, /** @type {string} */ mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

  /** @type {{ name: string, description: string, inputSchema: object, execute: (entree: Record<string, unknown>) => unknown }[]} */
  const outils = [
    {
      name: "transposer",
      description: "Monte ou descend des notes de la copie de « demiTons » demi-tons (12 = une octave). Sans debut ni fin : toute la piste. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ demiTons: { type: "integer", minimum: -24, maximum: 24, description: "De -24 à 24, sauf 0." }, ...PORTEE }, ["demiTons"]),
      execute: (x) => {
        const e = verifier(x, ["demiTons", "piste", "debut", "fin"], ["demiTons"]);
        if (!entierDans(e.demiTons, -24, 24) || e.demiTons === 0) throw new Error("demiTons : un entier de -24 à 24, sauf 0.");
        const { p, ids } = choisir(e);
        return geste(() => { gestes.transposer(etat, p, ids, e.demiTons); return `${nb(ids.length, "note")} ${e.demiTons > 0 ? "montée" : "descendue"}${ids.length > 1 ? "s" : ""} de ${Math.abs(e.demiTons)} demi-ton${Math.abs(e.demiTons) > 1 ? "s" : ""}`; });
      },
    },
    {
      name: "etirer",
      description: "Double les durées (facteur 2 : plus lent) ou les divise par deux (0.5 : plus vite), à partir de la première note choisie ; ce qui suit sur la piste se décale d'autant. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ facteur: { type: "number", enum: [2, 0.5], description: "2 ou 0.5." }, ...PORTEE }, ["facteur"]),
      execute: (x) => {
        const e = verifier(x, ["facteur", "piste", "debut", "fin"], ["facteur"]);
        if (e.facteur !== 2 && e.facteur !== 0.5) throw new Error("facteur : 2 ou 0.5.");
        const { p, ids } = choisir(e);
        return geste(() => { gestes.etirer(etat, p, ids, e.facteur); return `${nb(ids.length, "note")} ${e.facteur === 2 ? "deux fois plus lentes" : "deux fois plus rapides"}`; });
      },
    },
    {
      name: "a_l_envers",
      description: "Joue des notes à l'envers (rétrograde) : la dernière devient la première, au même endroit. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ ...PORTEE }),
      execute: (x) => {
        const e = verifier(x, ["piste", "debut", "fin"]);
        const { p, ids } = choisir(e);
        return geste(() => { gestes.retrograder(etat, p, ids); return `${nb(ids.length, "note")} à l'envers`; });
      },
    },
    {
      name: "miroir",
      description: "Renverse des notes en miroir autour de la première : ce qui montait descend, du même intervalle. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ ...PORTEE }),
      execute: (x) => {
        const e = verifier(x, ["piste", "debut", "fin"]);
        const { p, ids } = choisir(e);
        return geste(() => { gestes.renverser(etat, p, ids); return `${nb(ids.length, "note")} en miroir`; });
      },
    },
    {
      name: "recaler",
      description: "Recale débuts et durées de notes sur une grille, en pas (1 = double croche, 2 = croche, 4 = noire, 8 = blanche). Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ grille: { type: "integer", enum: [1, 2, 4, 8], description: "La grille, en pas." }, ...PORTEE }, ["grille"]),
      execute: (x) => {
        const e = verifier(x, ["grille", "piste", "debut", "fin"], ["grille"]);
        if (![1, 2, 4, 8].includes(e.grille)) throw new Error("grille : 1, 2, 4 ou 8 pas.");
        const { p, ids } = choisir(e);
        return geste(() => { gestes.recaler(etat, p, ids, e.grille); return `${nb(ids.length, "note")} recalée${ids.length > 1 ? "s" : ""} sur ${e.grille} pas`; });
      },
    },
    {
      name: "poser_accords",
      description: `Pose des accords (mesure et temps comptés de 1, ${ppm / ppt} temps par mesure ; noms à l'anglaise : C, Am, F#m7, Bb, G7, Dsus4, Cmaj7, Em/B). Dans chaque mesure citée, ils remplacent ceux qui y étaient ; un accord sonne jusqu'au suivant. Rend ce qui est fait et la taille de la copie.`,
      inputSchema: schema({
        accords: {
          type: "array", minItems: 1, maxItems: 64,
          items: schema({ mesure: { type: "integer", minimum: 1 }, temps: { type: "integer", minimum: 1, maximum: ppm / ppt }, nom: { type: "string" } }, ["mesure", "temps", "nom"]),
        },
      }, ["accords"]),
      execute: (x) => {
        const e = verifier(x, ["accords"], ["accords"]);
        const derniere = w / ppm;
        if (!Array.isArray(e.accords) || !e.accords.length || e.accords.length > 64) throw new Error("accords : de 1 à 64 accords.");
        /** @type {Accord[]} */
        const lus = [];
        for (const [i, a] of e.accords.entries()) {
          const ea = champs(a, ["mesure", "temps", "nom"], ["mesure", "temps", "nom"], `accords[${i}]`);
          if (ea) throw new Error(`${ea}.`);
          if (!entierDans(a.mesure, 1, derniere)) throw new Error(`accords[${i}].mesure : de 1 à ${derniere}.`);
          if (!entierDans(a.temps, 1, ppm / ppt)) throw new Error(`accords[${i}].temps : de 1 à ${ppm / ppt}.`);
          const nom = nomDAccord(a.nom);
          if (!nom) throw new Error(`accords[${i}].nom : « ${String(a.nom).slice(0, 24)} » ne se lit pas ; par exemple C, Am, F#m7, Bb, G7, Dsus4, Cmaj7, Em/B.`);
          const d = (a.mesure - 1) * ppm + (a.temps - 1) * ppt;
          if (lus.some((y) => y.d === d)) throw new Error(`accords[${i}] : deux accords au même temps.`);
          lus.push({ d, nom });
        }
        return geste(() => {
          for (const m of new Set(lus.map((a) => Math.floor(a.d / ppm)))) poserAccords(etat, lus.filter((a) => Math.floor(a.d / ppm) === m), m * ppm, (m + 1) * ppm);
          return `${nb(lus.length, "accord")} posé${lus.length > 1 ? "s" : ""}`;
        });
      },
    },
    {
      name: "ajouter_notes",
      description: "Ajoute des notes à une piste de la copie (debut et duree en pas depuis le début de l'idée, hauteur MIDI de 21 à 108, 60 = do central) ; rien d'autre ne bouge. Deux notes de même hauteur ne se chevauchent pas. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({
        notes: {
          type: "array", minItems: 1, maxItems: 256,
          items: schema({ debut: { type: "integer", minimum: 0 }, duree: { type: "integer", minimum: 1 }, hauteur: { type: "integer", minimum: BORNES.bas, maximum: BORNES.haut } }, ["debut", "duree", "hauteur"]),
        },
        piste: PORTEE.piste,
      }, ["notes"]),
      execute: (x) => {
        const e = verifier(x, ["notes", "piste"], ["notes"]);
        const p = pisteDe(e.piste);
        const lues = lireNotes(e.notes, { fenetre: [0, w], tessiture: BORNES, max: 256 });
        if (lues.raison) throw new Error(`${lues.raison}.`);
        const ch = chevauchement(lues.notes, etat.pistes[p].notes);
        if (ch) throw new Error(`${ch}.`);
        return geste(() => {
          for (const n of lues.notes) gestes.poser(etat, p, { d: n.d, l: n.l, h: n.h });
          return `${nb(lues.notes.length, "note")} ajoutée${lues.notes.length > 1 ? "s" : ""}`;
        });
      },
    },
    {
      name: "effacer_notes",
      description: "Efface des notes d'une piste de la copie : celles qui commencent entre debut et fin, et seulement de ces hauteurs MIDI si « hauteurs » est donné ; le reste ne bouge pas. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ ...PORTEE, hauteurs: { type: "array", minItems: 1, maxItems: 88, items: { type: "integer", minimum: BORNES.bas, maximum: BORNES.haut } } }),
      execute: (x) => {
        const e = verifier(x, ["piste", "debut", "fin", "hauteurs"]);
        const choix = choisir(e);
        const p = choix.p;
        let ids = choix.ids;
        if (e.hauteurs !== undefined) {
          if (!Array.isArray(e.hauteurs) || !e.hauteurs.length || e.hauteurs.length > 88 || !e.hauteurs.every((h) => entierDans(h, BORNES.bas, BORNES.haut))) throw new Error("hauteurs : des hauteurs MIDI de 21 à 108.");
          const voulues = new Set(e.hauteurs), gardes = new Set(ids);
          ids = etat.pistes[p].notes.filter((n) => gardes.has(n.id) && voulues.has(n.h)).map((n) => n.id);
          if (!ids.length) throw new Error("Aucune note de ces hauteurs à cet endroit.");
        }
        return geste(() => { gestes.effacer(etat, p, ids, { decaler: false }); return `${nb(ids.length, "note")} effacée${ids.length > 1 ? "s" : ""}`; });
      },
    },
  ];
  return { outils: outils.slice(0, Math.max(0, max)), copie: () => cloner(etat) };
}
