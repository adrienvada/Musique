/**
 * CLAUDE DANS LES CONVERSATIONS D'ADRIEN
 *
 * Les outils bibliotheque_* servent la synchronisation : ils lisent ou
 * réécrivent des fiches entières, traits compris. Dans une conversation,
 * Claude ne pouvait donc que tout lire ou tout écraser. Ces outils-ci lui
 * donnent juste ce qu'il faut :
 *   - partitions_lister, partition_lire : retrouver une partition et la
 *     lire, sans les traits (titre, ABC, doutes non levés, tempo, mesure,
 *     tonalité ; les notes pour une idée) ;
 *   - idee_ecrire : noter une idée neuve, jamais par-dessus une autre ;
 *   - suggestion_ecrire, suggestions_lister, suggestion_retirer : ranger une
 *     proposition à côté d'une partition, qu'Adrien applique d'un geste dans
 *     Portée (suggestions.js) ;
 *   - partition_montrer : la partition gravée et jouable dans la
 *     conversation (vue-partition.js, extension MCP Apps) ;
 *   - le prompt relire_page, qui guide Claude sur une page lue.
 *
 * Tout passe par l'API publique de la bibliothèque (changements, ecrire) :
 * aucune règle de la synchro n'est contournée. Les entrées sont vérifiées
 * strictement : une erreur dit à Claude quoi corriger.
 */
import { abcDeSecours } from "./abc.js";
import { hasard, verifierIdentifiant } from "./suggestions.js";
import { URI_VUE } from "./vue-partition.js";

// Ce que l'appli sait faire. Les mêmes listes qu'app/sequence.js, app/idee.js
// et app/harmonie.js (le connecteur est déployé seul, il ne peut pas les
// importer) : un test vérifie qu'elles ne s'écartent pas.
export const TONALITES = [
  ..."C G D A E B F# Db Ab Eb Bb F".split(" "),
  ..."Am Em Bm F#m C#m G#m Ebm Bbm Fm Cm Gm Dm".split(" "),
];
export const MESURES = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8", "2/2"];
export const FORME_ACCORD = /^([A-G])([#b]?)(maj7|m7b5|dim7|7sus4|madd9|add9|sus2|sus4|dim|aug|maj|m9|m7|m6|m|7|6|9)?(?:\/([A-G])([#b]?))?$/;
export const BORNES = { bas: 21, haut: 108 }; // le clavier du piano
const TEMPO = { min: 40, max: 240, defaut: 90 };
const MAX_NOTES = 4000;
const MAX_ACCORDS = 512;
const MAX_MESURES = 256;
const FIN_SUGGESTION = 8192; // 512 noires : de quoi suggérer, pas de quoi déborder
const MAX_LISTE = 200;

/** Un identifiant de partition neuf, au format de nouvelId() (app/stockage.js). */
export function nouvelId() {
  return "p" + Date.now().toString(36) + hasard(5);
}

// ------------------------------------------------------------------------
// Les définitions
// ------------------------------------------------------------------------

const PAS = "en pas de double croche (4 pas = une noire, 16 = une mesure de 4/4)";
const SCHEMA_ID = { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$", description: "L'identifiant de la partition, tel que partitions_lister le donne." };
const SCHEMA_NOTE = {
  type: "object",
  properties: {
    debut: { type: "integer", minimum: 0, description: `Début, ${PAS}.` },
    duree: { type: "integer", minimum: 1, description: `Durée, ${PAS}.` },
    hauteur: { type: "integer", minimum: BORNES.bas, maximum: BORNES.haut, description: "Hauteur MIDI : 60 = do central (do4), 61 = do♯4, 72 = do5." },
    velocite: { type: "integer", minimum: 1, maximum: 127, description: "Facultatif : la force, de 1 à 127." },
  },
  required: ["debut", "duree", "hauteur"],
  additionalProperties: false,
};
const SCHEMA_ACCORD = {
  type: "object",
  properties: {
    debut: { type: "integer", minimum: 0, description: `Où l'accord commence, ${PAS}.` },
    nom: { type: "string", pattern: FORME_ACCORD.source, description: "Le chiffrage, à l'anglaise : C, Am, F#m7, Bb, G7, Dsus4, Cmaj7, Em/B." },
  },
  required: ["debut", "nom"],
  additionalProperties: false,
};
const LECTURE = { readOnlyHint: true, openWorldHint: false };

export const OUTILS_CONVERSATION = [
  {
    name: "partitions_lister",
    title: "Partitions de la bibliothèque",
    description: "Liste les partitions de la bibliothèque Portée d'Adrien, des plus récentes aux plus anciennes : pages lues sur sa reMarkable (type page), idées notées dans l'appli (idee) et morceaux faits d'idées (morceau). Chaque entrée : id, titre, type, statut, modifieLe, doutes (le nombre de doutes encore à lever, pour une page), etiquettes, favori. Sert à trouver l'identifiant d'une partition d'après son titre, avant partition_lire.",
    inputSchema: {
      type: "object",
      properties: {
        recherche: { type: "string", maxLength: 100, description: "Facultatif : un mot du titre ou d'une étiquette (accents et majuscules ignorés)." },
        type: { type: "string", enum: ["page", "idee", "morceau"], description: "Facultatif : un seul type." },
      },
      additionalProperties: false,
    },
    annotations: LECTURE,
  },
  {
    name: "partition_lire",
    title: "Lire une partition",
    description: `Lit une partition de la bibliothèque, sans ses traits : titre, type, tempo, mesure, tonalité, l'ABC, et pour une page lue sur la tablette ses doutes encore à lever (rang, type, message, page, mesure). Pour une idée : ses notes (debut et duree ${PAS}, hauteur MIDI) et ses accords. Pour un morceau : ses blocs. Adrien ne lit pas l'ABC : parle-lui en noms de notes (do, ré, mi), en mesures et en temps.`,
    inputSchema: { type: "object", properties: { id: SCHEMA_ID }, required: ["id"], additionalProperties: false },
    annotations: LECTURE,
  },
  {
    name: "idee_ecrire",
    title: "Noter une nouvelle idée",
    description: `Crée une nouvelle idée dans la bibliothèque Portée d'Adrien : une mélodie en notes (debut et duree ${PAS}, hauteur MIDI de 21 à 108, 60 = do central), avec des accords si tu veux. Elle ne remplace jamais rien : chaque appel crée une idée de plus, avec un identifiant neuf. Elle apparaît dans Portée, sur ses appareils, à la synchronisation suivante, et Adrien peut l'écouter, la corriger ou l'effacer. N'appelle cet outil que si Adrien te demande de noter ou de créer une idée.`,
    inputSchema: {
      type: "object",
      properties: {
        titre: { type: "string", minLength: 1, maxLength: 120, description: "Le titre de l'idée, en français." },
        tempo: { type: "integer", minimum: TEMPO.min, maximum: TEMPO.max, description: `Noires par minute (${TEMPO.defaut} si absent).` },
        mesure: { type: "string", enum: MESURES, description: "La mesure (4/4 si absente)." },
        tonalite: { type: "string", enum: TONALITES, description: "La tonalité, à l'anglaise : C, G, F#m, Bb… (C si absente)." },
        notes: { type: "array", minItems: 1, maxItems: MAX_NOTES, items: SCHEMA_NOTE, description: "Les notes de la mélodie. Deux notes de même hauteur ne se chevauchent pas." },
        accords: { type: "array", maxItems: MAX_ACCORDS, items: SCHEMA_ACCORD, description: "Facultatif : un accord par début, de préférence en début de mesure ou de demi-mesure." },
      },
      required: ["titre", "notes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "suggestion_ecrire",
    title: "Suggérer quelque chose pour une partition",
    description: `Range une proposition à côté d'une partition, sans la modifier : Adrien la voit dans Portée, l'écoute, et l'applique d'un geste ou l'écarte. Selon genre, contenu porte : « accords » → { accords } (debut ${PAS} depuis le début de la partition) ; « suite » → { notes, accords? } qui la prolongent (debut compté depuis la fin de la partition) ; « variation » → { notes, accords? } qui remplaceraient sa mélodie (debut depuis le début) ; « texte » → { note?, titre?, etiquettes?, doute? } (doute : le rang d'un doute donné par partition_lire, auquel la note répond). pourquoi : une ou deux phrases pour Adrien, sans jargon ABC.`,
    inputSchema: {
      type: "object",
      properties: {
        cible: SCHEMA_ID,
        genre: { type: "string", enum: ["accords", "suite", "variation", "texte"] },
        contenu: {
          type: "object",
          properties: {
            accords: { type: "array", maxItems: MAX_ACCORDS, items: SCHEMA_ACCORD },
            notes: { type: "array", maxItems: MAX_NOTES, items: SCHEMA_NOTE },
            note: { type: "string", maxLength: 2000, description: "Pour « texte » : la remarque, en français." },
            titre: { type: "string", maxLength: 120, description: "Pour « texte » : un titre proposé." },
            etiquettes: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 40 }, description: "Pour « texte » : des étiquettes proposées." },
            doute: { type: "integer", minimum: 0, description: "Pour « texte » : le rang du doute auquel la note répond." },
          },
          additionalProperties: false,
        },
        pourquoi: { type: "string", minLength: 1, maxLength: 2000, description: "Pourquoi cette proposition, pour Adrien." },
      },
      required: ["cible", "genre", "contenu", "pourquoi"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "suggestions_lister",
    title: "Suggestions en attente",
    description: "Les suggestions rangées pour une partition (ou pour toutes), les plus récentes d'abord : sid, cible, genre, contenu, pourquoi, creeLe. Une suggestion appliquée ou écartée par Adrien n'y est plus.",
    inputSchema: { type: "object", properties: { cible: { ...SCHEMA_ID, description: "Facultatif : l'identifiant de la partition." } }, additionalProperties: false },
    annotations: LECTURE,
  },
  {
    name: "suggestion_retirer",
    title: "Retirer une suggestion",
    description: "Retire une suggestion rangée (par exemple une proposition devenue fausse). La partition n'est pas touchée. Rend { retiree } : false si elle n'existait déjà plus.",
    inputSchema: {
      type: "object",
      properties: { cible: SCHEMA_ID, sid: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$", description: "L'identifiant de la suggestion (suggestions_lister)." } },
      required: ["cible", "sid"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "partition_montrer",
    title: "Montrer une partition",
    description: "Montre une partition de la bibliothèque dans la conversation, gravée et jouable au piano, quand l'application sait afficher une interface ; sinon rend son ABC. Pour une idée tout juste notée par idee_ecrire, une partition simple est écrite d'après ses notes. Un morceau ne se montre pas : montre ses idées une à une.",
    inputSchema: { type: "object", properties: { id: SCHEMA_ID }, required: ["id"], additionalProperties: false },
    annotations: LECTURE,
    // L'interface qui affiche le résultat (MCP Apps) ; la clé à plat est
    // l'ancienne forme, que des hôtes lisent encore.
    _meta: { ui: { resourceUri: URI_VUE }, "ui/resourceUri": URI_VUE },
  },
];

export const NOMS_CONVERSATION = new Set(OUTILS_CONVERSATION.map((o) => o.name));

// ------------------------------------------------------------------------
// Vérifier les entrées
// ------------------------------------------------------------------------

// On refuse exprès les caractères de contrôle dans ce qu'on reçoit :
// l'expression les nomme, c'est voulu (la règle ne se tait que pour elle).
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function champs(objet, permis, ou) {
  if (!objet || typeof objet !== "object" || Array.isArray(objet)) throw new Error(`${ou} : un objet.`);
  const inconnu = Object.keys(objet).find((k) => !permis.includes(k));
  if (inconnu) throw new Error(`${ou} : champ inconnu « ${inconnu} » (permis : ${permis.join(", ")}).`);
}

function texte(v, max, ou) {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${ou} : un texte non vide.`);
  if (v.length > max) throw new Error(`${ou} : ${max} caractères au plus.`);
  if (CONTROLE.test(v)) throw new Error(`${ou} : pas de caractère de contrôle.`);
  return v.trim();
}

function entier(v, min, max, ou) {
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${ou} : un entier de ${min} à ${max}, reçu ${JSON.stringify(v)}.`);
  return v;
}

function parmi(v, liste, ou) {
  if (!liste.includes(v)) throw new Error(`${ou} : l'une de ${liste.join(", ")} ; reçu ${JSON.stringify(v)}.`);
  return v;
}

/** Des notes vérifiées, triées comme dans l'appli (début, puis hauteur). */
function lireNotes(notes, fin, ou = "notes") {
  if (!Array.isArray(notes) || !notes.length || notes.length > MAX_NOTES) throw new Error(`${ou} : de 1 à ${MAX_NOTES} notes.`);
  const sortie = notes.map((n, i) => {
    const ici = `${ou}[${i}]`;
    champs(n, ["debut", "duree", "hauteur", "velocite"], ici);
    const debut = entier(n.debut, 0, fin - 1, `${ici}.debut`);
    const duree = entier(n.duree, 1, fin - debut, `${ici}.duree`);
    const hauteur = entier(n.hauteur, BORNES.bas, BORNES.haut, `${ici}.hauteur (21 = la0, 60 = do central, 108 = do8)`);
    const note = { debut, duree, hauteur };
    if (n.velocite !== undefined) note.velocite = entier(n.velocite, 1, 127, `${ici}.velocite`);
    return note;
  }).sort((a, b) => a.debut - b.debut || a.hauteur - b.hauteur);
  // Deux notes de même hauteur qui se chevauchent : le MIDI et la grille ne sauraient laquelle couper.
  const derniere = new Map();
  for (const n of sortie) {
    const avant = derniere.get(n.hauteur);
    if (avant && avant.debut + avant.duree > n.debut) throw new Error(`${ou} : deux notes de hauteur ${n.hauteur} se chevauchent (débuts ${avant.debut} et ${n.debut}).`);
    derniere.set(n.hauteur, n);
  }
  return sortie;
}

function lireAccords(accords, fin, ou = "accords", { auMoinsUn = false } = {}) {
  if (!Array.isArray(accords) || accords.length > MAX_ACCORDS || (auMoinsUn && !accords.length)) throw new Error(`${ou} : ${auMoinsUn ? "de 1" : "de 0"} à ${MAX_ACCORDS} accords.`);
  const vus = new Set();
  return accords.map((a, i) => {
    const ici = `${ou}[${i}]`;
    champs(a, ["debut", "nom"], ici);
    const debut = entier(a.debut, 0, fin - 1, `${ici}.debut`);
    if (typeof a.nom !== "string" || !FORME_ACCORD.test(a.nom.trim())) throw new Error(`${ici}.nom : un chiffrage comme C, Am, F#m7, Bb, G7, Dsus4, Cmaj7 ou Em/B ; reçu ${JSON.stringify(a.nom)}.`);
    if (vus.has(debut)) throw new Error(`${ou} : deux accords au même début (${debut}).`);
    vus.add(debut);
    return { debut, nom: a.nom.trim() };
  }).sort((a, b) => a.debut - b.debut);
}

// ------------------------------------------------------------------------
// Lire la bibliothèque
// ------------------------------------------------------------------------

const typeDe = (d) => (d.type === "idee" ? "idee" : d.type === "morceau" ? "morceau" : "page");
const sansAccents = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const enteteAbc = (abc, lettre) => {
  const m = new RegExp(`^${lettre}:\\s*(.+?)\\s*$`, "m").exec(abc || "");
  return m ? m[1] : null;
};
function tempoAbc(abc) {
  const q = /^Q:\s*(?:(\d+)\/(\d+)\s*=\s*)?(\d+)/m.exec(abc || "");
  return q ? Math.round(Number(q[3]) * (q[1] ? (4 * Number(q[1])) / Number(q[2]) : 1)) : null;
}

/**
 * Les fiches vivantes de la bibliothèque (sans les pierres tombales), et
 * seulement des partitions. Les gabarits de l'écriture d'Adrien (L16)
 * voyagent avec la bibliothèque dans des fiches cachées (`type: "gabarits"`) :
 * ce ne sont pas des partitions, Claude ne les liste, ne les lit ni ne les
 * vise (sinon ils compteraient comme des pages).
 */
async function fiches(bibliotheque) {
  const { partitions } = await bibliotheque.changements(null);
  return (partitions || []).filter((f) => f && !f.supprime && f.donnees && typeof f.donnees === "object" && f.donnees.type !== "gabarits");
}

export async function lireFiche(bibliotheque, id, toutes = null) {
  verifierIdentifiant(id, "Identifiant de partition");
  const liste = toutes || (await fiches(bibliotheque));
  const f = liste.find((x) => x.id === id);
  if (!f) throw new Error(`Aucune partition « ${id} » dans la bibliothèque (partitions_lister donne les identifiants).`);
  return f;
}

const doutesOuverts = (d) => (Array.isArray(d.doutes) ? d.doutes : [])
  .map((x, rang) => ({ rang, x }))
  .filter(({ x }) => x && !x.leve)
  .map(({ rang, x }) => ({ rang, type: x.type || null, message: x.message || "", page: x.page ?? null, mesure: x.mesure ?? null }));

/** Une partition telle que Claude la lit : sans traits, sans rien d'interne. */
function vue(f, toutes) {
  const d = f.donnees;
  const type = typeDe(d);
  const base = {
    id: f.id, titre: d.titre || "(sans titre)", type, statut: d.statut || null,
    creeLe: d.creeLe || null, modifieLe: f.modifieLe || d.modifieLe || null,
    etiquettes: Array.isArray(d.etiquettes) ? d.etiquettes : [], favori: !!d.favori, note: d.note || "",
  };
  if (type === "idee") {
    const s = d.sequence || {};
    const mesure = Array.isArray(s.mesure) ? s.mesure : [4, 4];
    return {
      ...base,
      tempo: s.tempo ?? d.tempo ?? null, mesure: mesure.join("/"), tonalite: s.tonalite || "C", pasParMesure: (mesure[0] * 16) / mesure[1],
      sequence: {
        pistes: (s.pistes || []).map((p) => ({ nom: p.nom, notes: (p.notes || []).map((n) => ({ debut: n.d, duree: n.l, hauteur: n.h, ...(n.v ? { velocite: n.v } : {}) })) })),
        accords: (s.accords || []).map((a) => ({ debut: a.d, nom: a.nom })),
        accompagnement: s.accompagnement || "aucun",
      },
      abc: d.abc || "",
      memo: !!d.memo,
    };
  }
  if (type === "morceau") {
    const titres = new Map(toutes.map((x) => [x.id, x.donnees.titre]));
    return { ...base, tempo: d.tempo ?? null, blocs: (d.blocs || []).map((b) => ({ nom: b.nom || "", idee: b.idee, titreIdee: titres.get(b.idee) ?? null, fois: b.fois || 1 })) };
  }
  const abc = d.abc || "";
  return {
    ...base,
    modele: d.modele || null, nbPages: d.nbPages ?? null,
    tempo: d.tempo ?? tempoAbc(abc), mesure: enteteAbc(abc, "M"), tonalite: enteteAbc(abc, "K"), transposition: d.transposition || 0,
    abc,
    doutes: doutesOuverts(d),
  };
}

async function lister(bibliotheque, args) {
  champs(args, ["recherche", "type"], "partitions_lister");
  // Une recherche vide veut dire « tout », pas une erreur.
  const recherche = args.recherche === undefined || args.recherche === "" ? "" : sansAccents(texte(args.recherche, 100, "recherche"));
  const type = args.type === undefined ? null : parmi(args.type, ["page", "idee", "morceau"], "type");
  const choisies = (await fiches(bibliotheque))
    .filter((f) => !type || typeDe(f.donnees) === type)
    .filter((f) => !recherche || sansAccents([f.donnees.titre, ...(f.donnees.etiquettes || [])].join(" ")).includes(recherche))
    .sort((a, b) => String(b.modifieLe || "").localeCompare(String(a.modifieLe || "")));
  return {
    partitions: choisies.slice(0, MAX_LISTE).map((f) => {
      const d = f.donnees;
      const t = typeDe(d);
      return {
        id: f.id, titre: d.titre || "(sans titre)", type: t, statut: d.statut || null, modifieLe: f.modifieLe || null,
        ...(t === "page" ? { doutes: doutesOuverts(d).length } : {}),
        etiquettes: Array.isArray(d.etiquettes) ? d.etiquettes : [], favori: !!d.favori,
      };
    }),
    total: choisies.length,
  };
}

async function lire(bibliotheque, args) {
  champs(args, ["id"], "partition_lire");
  const toutes = await fiches(bibliotheque);
  return vue(await lireFiche(bibliotheque, args.id, toutes), toutes);
}

/** De quoi graver et jouer une partition dans la conversation. */
async function montrer(bibliotheque, args) {
  champs(args, ["id"], "partition_montrer");
  const toutes = await fiches(bibliotheque);
  const f = await lireFiche(bibliotheque, args.id, toutes);
  const v = vue(f, toutes);
  // Seul un morceau n'a pas d'ABC à lui (`in` le dit aussi à la vérification des types).
  if (v.type === "morceau" || !("abc" in v)) throw new Error("Un morceau ne se montre pas encore ici : montre ses idées une à une (partition_lire donne ses blocs).");
  let abc = v.abc, source = "partition";
  if (!abc && v.type === "idee") {
    // Une idée de Claude, pas encore passée par l'appli : une partition simple, d'après ses notes.
    abc = abcDeSecours(f.donnees.sequence, v.titre);
    source = "notes";
  }
  if (!abc) throw new Error("Cette partition n'a pas encore d'ABC à graver.");
  return { id: v.id, titre: v.titre, type: v.type, tempo: v.tempo, mesure: v.mesure, tonalite: v.tonalite, abc, source };
}

// ------------------------------------------------------------------------
// Écrire : une idée neuve, ou une suggestion à côté
// ------------------------------------------------------------------------

/** La fiche d'une idée, exactement comme l'appli la range (app/idee.js). */
export function ficheIdee({ titre, tempo, mesure, tonalite, notes, accords }, maintenant = new Date().toISOString()) {
  const sequence = {
    version: 1,
    tempo,
    mesure: mesure.split("/").map(Number),
    tonalite,
    pistes: [{ nom: "Mélodie", notes: notes.map((n, i) => ({ id: i + 1, d: n.debut, l: n.duree, h: n.hauteur, ...(n.velocite ? { v: n.velocite } : {}) })) }],
    accords: accords.map((a) => ({ d: a.debut, nom: a.nom })),
    // Comme dans l'appli : le premier accord posé met les accords plaqués en route.
    accompagnement: accords.length ? "plaque" : "aucun",
    suivant: notes.length + 1,
  };
  return {
    type: "idee", titre, sequence,
    abc: "", // l'appli le réécrit d'après les notes, à la réception
    statut: "idee", nbPages: 0, modele: null, tempo,
    note: "", etiquettes: [], favori: false, memo: null,
    source: { claude: true },
    creeLe: maintenant, modifieLe: maintenant,
  };
}

async function creerIdee(bibliotheque, args) {
  champs(args, ["titre", "tempo", "mesure", "tonalite", "notes", "accords"], "idee_ecrire");
  const titre = texte(args.titre, 120, "titre");
  const tempo = args.tempo === undefined ? TEMPO.defaut : entier(args.tempo, TEMPO.min, TEMPO.max, "tempo");
  const mesure = args.mesure === undefined ? "4/4" : parmi(args.mesure, MESURES, "mesure");
  const tonalite = args.tonalite === undefined ? "C" : parmi(args.tonalite, TONALITES, "tonalite");
  const [n, d] = mesure.split("/").map(Number);
  const pasParMesure = (n * 16) / d;
  const fin = MAX_MESURES * pasParMesure;
  const notes = lireNotes(args.notes, fin);
  const accords = args.accords === undefined ? [] : lireAccords(args.accords, fin);
  const maintenant = new Date().toISOString();
  const donnees = ficheIdee({ titre, tempo, mesure, tonalite, notes, accords }, maintenant);
  // Un identifiant neuf : rien d'existant n'est jamais réécrit.
  const id = nouvelId();
  const r = await bibliotheque.ecrire({ id, donnees, pages: [], supprime: false, modifieLe: maintenant });
  if (!r || r.accepte === false) throw new Error(refusDeLIdee(r));
  const derniere = Math.max(...notes.map((x) => x.debut + x.duree), ...accords.map((a) => a.debut + 1));
  return { id, titre, notes: notes.length, accords: accords.length, mesures: Math.ceil(derniere / pasParMesure), tempo, mesure, tonalite };
}

/**
 * Ce que Claude lit quand la bibliothèque refuse l'idée. Avec une raison
 * (`refus` : une fiche trop lourde…), la même idée serait refusée encore :
 * « réessaie » le faisait tourner en rond ; il doit savoir pourquoi, et quoi
 * changer. Les bornes de idee_ecrire tiennent déjà une idée sous les 256 Ko
 * de la bibliothèque : c'est une garde, pour le jour où l'une bougerait.
 * Sans raison, une autre écriture passait au même moment (un conflit) :
 * réessayer suffit.
 */
function refusDeLIdee(r) {
  const raison = r && typeof r.refus === "string" ? r.refus.trim() : "";
  if (!raison) return "La bibliothèque a refusé l'idée : réessaie dans un instant.";
  const phrase = /[.!?…]$/.test(raison) ? raison : `${raison}.`;
  return `La bibliothèque a refusé l'idée. ${phrase} Rien n'est enregistré, et la même idée serait refusée encore : corrige ce point, ou dis-le à Adrien.`;
}

async function suggerer(bibliotheque, suggestions, args) {
  champs(args, ["cible", "genre", "contenu", "pourquoi"], "suggestion_ecrire");
  const fiche = await lireFiche(bibliotheque, args.cible);
  const genre = parmi(args.genre, ["accords", "suite", "variation", "texte"], "genre");
  const c = args.contenu;
  const pourquoi = texte(args.pourquoi, 2000, "pourquoi");
  let contenu;
  if (genre === "accords") {
    champs(c, ["accords"], "contenu (accords)");
    contenu = { accords: lireAccords(c.accords, FIN_SUGGESTION, "contenu.accords", { auMoinsUn: true }) };
  } else if (genre === "suite" || genre === "variation") {
    champs(c, ["notes", "accords"], `contenu (${genre})`);
    contenu = { notes: lireNotes(c.notes, FIN_SUGGESTION, "contenu.notes") };
    if (c.accords !== undefined) contenu.accords = lireAccords(c.accords, FIN_SUGGESTION, "contenu.accords");
  } else {
    champs(c, ["note", "titre", "etiquettes", "doute"], "contenu (texte)");
    contenu = {};
    if (c.note !== undefined) contenu.note = texte(c.note, 2000, "contenu.note");
    if (c.titre !== undefined) contenu.titre = texte(c.titre, 120, "contenu.titre");
    if (c.etiquettes !== undefined) {
      if (!Array.isArray(c.etiquettes) || !c.etiquettes.length || c.etiquettes.length > 10) throw new Error("contenu.etiquettes : de 1 à 10 étiquettes.");
      contenu.etiquettes = c.etiquettes.map((e, i) => texte(e, 40, `contenu.etiquettes[${i}]`));
    }
    if (c.doute !== undefined) {
      const nb = Array.isArray(fiche.donnees.doutes) ? fiche.donnees.doutes.length : 0;
      if (!nb) throw new Error("contenu.doute : cette partition n'a pas de doute.");
      contenu.doute = entier(c.doute, 0, nb - 1, "contenu.doute (le rang donné par partition_lire)");
    }
    if (!Object.keys(contenu).length) throw new Error("contenu (texte) : au moins note, titre, etiquettes ou doute.");
  }
  return suggestions.ecrire({ cible: fiche.id, genre, contenu, pourquoi });
}

// ------------------------------------------------------------------------
// L'aiguillage et les textes
// ------------------------------------------------------------------------

export async function appelerConversation(nom, args, { bibliotheque = null, suggestions = null } = {}) {
  const bib = () => {
    if (!bibliotheque) throw new Error("La bibliothèque Portée n'est pas disponible sur ce connecteur.");
    return bibliotheque;
  };
  const sug = () => {
    if (!suggestions) throw new Error("Les suggestions ne sont pas disponibles sur ce connecteur.");
    return suggestions;
  };
  switch (nom) {
    case "partitions_lister": return lister(bib(), args);
    case "partition_lire": return lire(bib(), args);
    case "idee_ecrire": return creerIdee(bib(), args);
    case "suggestion_ecrire": return suggerer(bib(), sug(), args);
    case "suggestions_lister": {
      champs(args, ["cible"], "suggestions_lister");
      return { suggestions: await sug().lister(args.cible === undefined ? null : args.cible) };
    }
    case "suggestion_retirer": {
      champs(args, ["cible", "sid"], "suggestion_retirer");
      return sug().retirer(args.cible, args.sid);
    }
    case "partition_montrer": return montrer(bib(), args);
    default: throw new Error(`Outil inconnu : ${nom}`);
  }
}

/**
 * Le texte d'un résultat, pour Claude : le JSON lui-même tant qu'il reste
 * raisonnable (un client peut ne lire que le texte), une phrase pour ce
 * qui vient d'être écrit.
 */
export function texteConversation(nom, r) {
  if (nom === "idee_ecrire") return `L'idée « ${r.titre} » est créée (id ${r.id}) : ${r.notes} note${r.notes > 1 ? "s" : ""}, ${r.accords} accord${r.accords > 1 ? "s" : ""}, ${r.mesures} mesure${r.mesures > 1 ? "s" : ""}. Elle apparaîtra dans Portée à la prochaine synchronisation.`;
  if (nom === "suggestion_ecrire") return `Suggestion rangée (sid ${r.sid}) pour la partition ${r.cible} : Adrien la verra dans Portée et choisira de l'appliquer ou non.`;
  if (nom === "suggestion_retirer") return r.retiree ? "Suggestion retirée." : "Cette suggestion n'existait déjà plus.";
  if (nom === "partition_montrer") {
    // Pour un hôte sans interface, l'ABC lui-même : Claude sait le lire.
    const origine = r.source === "notes" ? " (écrite d'après ses notes, en attendant que Portée l'écrive)" : "";
    const abc = r.abc.length <= 20000 ? `\n\n${r.abc}` : "";
    return `« ${r.titre} » : la partition${origine} s'affiche, avec un bouton pour l'écouter.${abc}`;
  }
  const json = JSON.stringify(r);
  return json.length <= 60000 ? json : `Résultat structuré de ${Math.round(json.length / 1024)} Ko (voir structuredContent).`;
}

// ------------------------------------------------------------------------
// Le prompt « relire une page »
// ------------------------------------------------------------------------

export const INVITES = [
  {
    name: "relire_page",
    title: "Relire une page avec Claude",
    description: "Relire une page lue sur la reMarkable : ses doutes, et pour chacun une réponse proposée en suggestion, sans rien écrire dans la bibliothèque.",
    arguments: [{ name: "id", description: "L'identifiant de la page (partitions_lister le donne).", required: true }],
  },
];

/** Le texte d'un prompt ; une Error si le nom ou les arguments ne vont pas. */
export function texteInvite(nom, args = {}) {
  if (nom !== "relire_page") throw new Error(`Prompt inconnu : ${nom}`);
  const id = args && args.id;
  verifierIdentifiant(id, "Identifiant de la page");
  return {
    description: `Relire la page ${id} de la bibliothèque Portée`,
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: [
          `Relis avec moi la page « ${id} » de ma bibliothèque Portée, une page de musique que j'ai écrite à la main sur ma reMarkable.`,
          `1. Appelle partition_lire avec l'identifiant ${id} : tu y trouves l'ABC que le lecteur a compris, et les doutes qu'il n'a pas levés (rang, type, message, page, mesure).`,
          "2. Pour chaque doute, regarde la mesure concernée dans l'ABC (une mesure qui ne tombe pas juste, une durée ou une hauteur incertaine, une armure) et choisis la réponse la plus probable.",
          "3. Range chaque réponse avec suggestion_ecrire : genre « texte », contenu { doute: <le rang>, note: <ta réponse en une phrase> }, et dans pourquoi ce qui t'y fait croire. Je les verrai dans Portée et je les appliquerai d'un geste.",
          "4. N'écris jamais dans la bibliothèque (bibliotheque_ecrire, idee_ecrire) sans que je te l'aie demandé : tes réponses restent des suggestions.",
          "Je ne lis pas l'ABC : parle-moi en noms de notes (do, ré, mi), en mesures et en temps, jamais en lettres ABC. Termine par un résumé court de ce que tu as proposé.",
        ].join("\n"),
      },
    }],
  };
}
