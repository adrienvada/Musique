/**
 * UNE FICHE DE LA BIBLIOTHÈQUE : VÉRIFIÉE, REMISE EN FORME, FUSIONNÉE
 *
 * Une fiche (le titre, l'ABC, les notes d'une idée, les blocs d'un
 * morceau…) arrive de partout : d'une sauvegarde, de la bibliothèque
 * commune, d'une version plus ancienne de l'appli, de Claude (le connecteur
 * peut écrire une idée sans son ABC). Une seule fiche mal formée, des
 * étiquettes qui n'étaient pas une liste, vidait le carnet, et la synchro la
 * portait sur tous les appareils (audit du 04/10, S6). Chaque fiche passe
 * donc par `normaliserFiche` avant d'être rangée, reçue ou affichée : chaque
 * champ connu y reprend son type et ses bornes. Un champ inconnu est gardé
 * tel quel, s'il est du JSON raisonnable : une version plus récente de
 * l'appli a pu l'ajouter, et l'effacer ici l'effacerait partout.
 *
 * `fusionnerFiches` réunit deux versions d'une même fiche, modifiées chacune
 * de son côté depuis la dernière version qu'elles avaient en commun (la
 * « base ») : pour chaque champ, le côté qui l'a changé l'emporte. La
 * synchronisation s'en sert au lieu de garder la fiche entière la plus
 * récente, qui effaçait une note ajoutée ailleurs (audit, D4).
 *
 * Sans dépendance au navigateur : le même module sert à l'appli et aux tests.
 */
import { BORNES, ecrireAbc, nouvelleSequence } from "./sequence.js";
import { STYLES, voixCompletes } from "./harmonie.js";

/** La date d'une fiche qui n'en a pas : la plus ancienne, pour qu'elle ne gagne aucune comparaison. */
export const EPOQUE = "1970-01-01T00:00:00.000Z";
const FIN_DES_TEMPS = "9999-12-31T23:59:59.999Z";
const FIN_T = Date.parse(FIN_DES_TEMPS);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TYPE = /^[a-z][a-z0-9-]{0,30}$/;
const TONALITE = /^[A-G][#b]?m?$/;
const TYPE_AUDIO = /^audio\/[a-z0-9.+-]{1,40}(;[ a-z0-9=.,+"-]{0,60})?$/i;
// Des bornes larges : elles arrêtent une fiche absurde, pas un vrai usage.
// Un ABC de page fait quelques kilo-octets ; une idée de 64 mesures, 1 024
// pas : 16 384 pas, ce sont 1 024 mesures de 4/4. Plus loin, une seule note
// suffisait à faire un ABC de plusieurs centaines de kilo-octets.
const MAX_TEXTE = 200000;
const MAX_NOTE = 20000;
const MAX_PAS = 16384;
const MAX_NOTES = 20000;
const MAX_INCONNU = 100 * 1024;
const DENOMINATEURS = [1, 2, 4, 8, 16];
const STYLES_CONNUS = new Set(STYLES.map((s) => s.id));
// Ce que la synchronisation range à côté de la fiche : pas des données d'Adrien.
const INTERNES = new Set(["id", "pagesLe"]);

const estObjet = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const nombre = (x) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);
const entier = (x, min, max, defaut) => {
  const n = Math.round(nombre(x));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
};
const texte = (x, max) => (typeof x === "string" ? x.slice(0, max) : typeof x === "number" && Number.isFinite(x) ? String(x) : undefined);

/** Une copie en JSON pur (ni fonction, ni cycle, ni `undefined`), ou undefined si trop lourde ou impossible. */
function jsonSur(x, max) {
  try {
    const s = JSON.stringify(x);
    return s === undefined || s.length > max ? undefined : JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Une date ISO complète (« 2026-10-04T10:15:00.000Z »), ou null. Toujours la
 * même forme, sur 24 caractères : les dates se comparent alors comme des
 * textes, partout où l'appli les trie.
 */
export function dateIso(x) {
  if (typeof x !== "string" && typeof x !== "number") return null;
  const t = typeof x === "number" ? x : Date.parse(x);
  if (!Number.isFinite(t)) return null;
  if (t < 0) return EPOQUE;
  return t > FIN_T ? FIN_DES_TEMPS : new Date(t).toISOString();
}

/** Une milliseconde plus tard que `iso` (une date ISO valide). */
export const uneMsPlusTard = (iso) => new Date(Date.parse(iso) + 1).toISOString();

// ------------------------------------------------------------------------
// Chaque champ connu, remis en forme. `undefined` : le champ part.
// ------------------------------------------------------------------------

function normaliserEtiquettes(v) {
  const brutes = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const sortie = [];
  for (const t of brutes) {
    if (typeof t !== "string" && typeof t !== "number") continue;
    const n = String(t).trim().toLowerCase().slice(0, 40);
    if (n && !sortie.includes(n)) sortie.push(n);
    if (sortie.length >= 50) break;
  }
  return sortie;
}

/** Le mémo, dans la fiche : sa durée et son format. Le son lui-même vit à part (les « pages »). */
function normaliserMemo(v) {
  if (!estObjet(v)) return null;
  return {
    duree: entier(v.duree, 0, 3600, 0),
    type: typeof v.type === "string" && TYPE_AUDIO.test(v.type) ? v.type : "audio/webm",
  };
}

/** Les champs simples d'une note ou d'un bloc qu'on ne connaît pas encore : seulement des valeurs simples. */
function extrasSimples(o, connus) {
  const sortie = {};
  for (const [k, v] of Object.entries(o)) {
    if (connus.has(k)) continue;
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 200)) sortie[k] = v;
  }
  return sortie;
}

const CHAMPS_NOTE = new Set(["id", "d", "l", "h", "v"]);
const dans = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;

function normaliserNote(n) {
  if (!estObjet(n)) return null;
  // Le cas courant d'abord, sans détour : une note déjà en forme (la liste se relit à chaque enregistrement).
  if (dans(n.id, 1, Number.MAX_SAFE_INTEGER) && dans(n.d, 0, MAX_PAS) && dans(n.l, 1, MAX_PAS) && dans(n.h, BORNES.bas, BORNES.haut)) {
    if (n.v === undefined && Object.keys(n).length === 4) return { id: n.id, d: n.d, l: n.l, h: n.h };
    if (dans(n.v, 1, 127) && Object.keys(n).length === 5) return { id: n.id, d: n.d, l: n.l, h: n.h, v: n.v };
  }
  const d = entier(n.d, 0, MAX_PAS, null), l = entier(n.l, 1, MAX_PAS, null), h = entier(n.h, BORNES.bas, BORNES.haut, null);
  if (d === null || l === null || h === null) return null;
  const note = { ...extrasSimples(n, CHAMPS_NOTE), id: entier(n.id, 1, Number.MAX_SAFE_INTEGER, 0), d, l, h };
  const v = entier(n.v, 1, 127, null);
  if (v !== null) note.v = v;
  return note;
}

/** La séquence d'une idée (sequence.js) : mesure, tonalité, pistes de notes, accords. */
export function normaliserSequence(v) {
  if (!estObjet(v)) return nouvelleSequence();
  const sortie = {};
  // Les champs inconnus d'abord : les connus passent par-dessus.
  for (const [k, x] of Object.entries(v)) {
    if (["version", "tempo", "mesure", "tonalite", "pistes", "accords", "accompagnement", "suivant"].includes(k)) continue;
    const c = jsonSur(x, MAX_INCONNU);
    if (c !== undefined) sortie[k] = c;
  }
  sortie.version = entier(v.version, 1, 99, 1);
  sortie.tempo = entier(v.tempo, 20, 400, 90);
  const den = Array.isArray(v.mesure) ? Math.round(nombre(v.mesure[1])) : NaN;
  sortie.mesure = Array.isArray(v.mesure) ? [entier(v.mesure[0], 1, 32, 4), DENOMINATEURS.includes(den) ? den : 4] : [4, 4];
  sortie.tonalite = typeof v.tonalite === "string" && TONALITE.test(v.tonalite) ? v.tonalite : "C";
  // Chaque note a un numéro à elle, dans toute l'idée (sequence.js le tire de `suivant`) :
  // un numéro absent ou déjà pris en reçoit un neuf.
  const pris = new Set();
  const aRenumeroter = [];
  let total = 0;
  const pistes = (Array.isArray(v.pistes) ? v.pistes : []).filter(estObjet).slice(0, 16).map((p, i) => {
    const piste = { ...(jsonSur(extrasSimples(p, new Set(["nom", "cle", "notes"])), MAX_INCONNU) || {}), nom: texte(p.nom, 60) ?? (i === 0 ? "Mélodie" : `Voix ${i + 1}`) };
    if (p.cle === "sol" || p.cle === "fa") piste.cle = p.cle;
    piste.notes = [];
    for (const brute of Array.isArray(p.notes) ? p.notes : []) {
      if (total >= MAX_NOTES) break;
      const n = normaliserNote(brute);
      if (!n) continue;
      total++;
      if (!n.id || pris.has(n.id)) aRenumeroter.push(n); else pris.add(n.id);
      piste.notes.push(n);
    }
    return piste;
  });
  if (!pistes.length) pistes.push({ nom: "Mélodie", notes: [] });
  let prochain = Math.max(0, ...pris) + 1;
  for (const n of aRenumeroter) { n.id = prochain++; pris.add(n.id); }
  sortie.pistes = pistes;
  // Un accord par position : le dernier écrit l'emporte, comme dans la feuille des accords.
  const accords = new Map();
  for (const a of Array.isArray(v.accords) ? v.accords : []) {
    if (!estObjet(a)) continue;
    const d = entier(a.d, 0, MAX_PAS, null), nom = texte(a.nom, 24);
    if (d === null || !nom) continue;
    accords.set(d, { ...extrasSimples(a, new Set(["d", "nom"])), d, nom });
  }
  sortie.accords = [...accords.values()].sort((a, b) => a.d - b.d);
  sortie.accompagnement = typeof v.accompagnement === "string" && STYLES_CONNUS.has(v.accompagnement) ? v.accompagnement : "aucun";
  sortie.suivant = Math.max(entier(v.suivant, 1, Number.MAX_SAFE_INTEGER, 1), prochain);
  return sortie;
}

function normaliserDoutes(v) {
  if (!Array.isArray(v)) return [];
  const sortie = [];
  for (const d of v.slice(0, 500)) {
    if (!estObjet(d)) continue;
    const o = jsonSur(d, 20000);
    if (!o) continue;
    o.leve = d.leve === true;
    if ("message" in o && typeof o.message !== "string") o.message = texte(o.message, 2000) ?? "";
    sortie.push(o);
  }
  return sortie;
}

function normaliserBlocs(v) {
  if (!Array.isArray(v)) return [];
  const vus = new Set();
  return v.filter(estObjet).slice(0, 500).map((b, i) => {
    let id = typeof b.id === "string" && b.id ? b.id.slice(0, 64) : `b${i}`;
    while (vus.has(id)) id += "-" + i;
    vus.add(id);
    return { ...extrasSimples(b, new Set(["id", "idee", "nom", "fois"])), id, idee: typeof b.idee === "string" ? b.idee.slice(0, 64) : "", nom: texte(b.nom, 60) ?? "", fois: entier(b.fois, 1, 16, 1) };
  });
}

/** La vignette d'une page lue : quelques traits [[x, y]…] (apercus.js, apercuTraits). */
function normaliserApercu(v) {
  if (!Array.isArray(v)) return undefined;
  // Déjà en forme (le cas de toutes les vignettes écrites par l'appli) : copiée telle quelle, sans tout refaire point par point.
  const point = (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  if (v.length <= 400 && v.every((t) => Array.isArray(t) && t.length && t.length <= 4000 && t.every(point))) return v.map((t) => t.map((p) => [p[0], p[1]]));
  const sortie = [];
  for (const t of v.slice(0, 400)) {
    if (!Array.isArray(t)) continue;
    const pts = [];
    for (const p of t.slice(0, 4000)) if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push([p[0], p[1]]);
    if (pts.length) sortie.push(pts);
  }
  return sortie;
}

const NORMES = {
  titre: (v) => texte(v, 300) ?? "Sans titre",
  type: (v) => (typeof v === "string" && TYPE.test(v) ? v : undefined),
  statut: (v) => (typeof v === "string" && v && v.length <= 40 ? v : undefined),
  modele: (v) => (typeof v === "string" && v.length <= 80 ? v : null),
  abc: (v) => (typeof v === "string" ? v.slice(0, MAX_TEXTE) : ""),
  abcLu: (v) => (typeof v === "string" ? v.slice(0, MAX_TEXTE) : undefined),
  note: (v) => texte(v, MAX_NOTE) ?? "",
  etiquettes: normaliserEtiquettes,
  favori: (v) => v === true || v === 1 || v === "true",
  memo: normaliserMemo,
  sequence: normaliserSequence,
  tempo: (v) => entier(v, 20, 400, undefined),
  transposition: (v) => entier(v, -24, 24, 0),
  nbPages: (v) => entier(v, 0, 500, 0),
  doutes: normaliserDoutes,
  blocs: normaliserBlocs,
  apercu: normaliserApercu,
  versionLecteur: (v) => entier(v, 0, 10000, undefined),
  source: (v) => (estObjet(v) ? jsonSur(v, 4096) ?? null : null),
  conflitDe: (v) => (typeof v === "string" && ID.test(v) ? v : undefined),
  creeLe: (v) => dateIso(v) ?? undefined,
  modifieLe: (v) => dateIso(v) ?? undefined,
};

/** L'ABC d'une idée, refait depuis ses notes, comme l'éditeur le fait à chaque changement (idee.js). */
export function abcDeLIdee(f) {
  try {
    return ecrireAbc(f.sequence, { voix: voixCompletes(f.sequence), titre: f.titre }).abc.slice(0, MAX_TEXTE);
  } catch {
    return "X:1\nK:C\n";
  }
}

/**
 * Remet une fiche en forme, sans jamais la modifier en place : une copie,
 * ou null si ce n'est pas une fiche du tout (pas un objet). Une fiche déjà
 * en forme ressort identique.
 */
export function normaliserFiche(brute) {
  if (!estObjet(brute)) return null;
  const f = {};
  for (const [cle, valeur] of Object.entries(brute)) {
    if (valeur === undefined || INTERNES.has(cle)) continue;
    const norme = Object.prototype.hasOwnProperty.call(NORMES, cle) ? NORMES[cle] : null;
    const v = norme ? norme(valeur) : jsonSur(valeur, MAX_INCONNU);
    if (v !== undefined) f[cle] = v;
  }
  if (typeof f.titre !== "string") f.titre = "Sans titre";
  f.creeLe ??= f.modifieLe ?? EPOQUE;
  f.modifieLe ??= f.creeLe;
  if (f.type === "idee") {
    f.sequence ??= nouvelleSequence();
    f.statut ??= "idee";
    f.nbPages ??= 0;
    if (!("modele" in f)) f.modele = null;
    // Écrite sans ABC (par Claude, par le connecteur) : on le refait depuis les notes.
    if (!f.abc) f.abc = abcDeLIdee(f);
  } else if (f.type === "morceau") {
    f.blocs ??= [];
    f.statut ??= "morceau";
  } else if (!f.type) {
    f.statut ??= "a-relire";
    if (f.abc === undefined) f.abc = f.abcLu ?? "";
  }
  return f;
}

/**
 * Remet en forme les seuls champs présents d'une modification partielle
 * (`{ favori: true }`), sans compléter le reste : la base de claude.ai
 * fusionne elle-même les champs d'un document.
 */
export function normaliserChamps(patch) {
  if (!estObjet(patch)) return {};
  const sortie = {};
  for (const [cle, valeur] of Object.entries(patch)) {
    if (valeur === undefined || INTERNES.has(cle)) continue;
    const norme = Object.prototype.hasOwnProperty.call(NORMES, cle) ? NORMES[cle] : null;
    const v = norme ? norme(valeur) : jsonSur(valeur, MAX_INCONNU);
    if (v !== undefined) sortie[cle] = v;
  }
  return sortie;
}

// ------------------------------------------------------------------------
// Comparer
// ------------------------------------------------------------------------

function trierCles(x) {
  if (Array.isArray(x)) return x.map(trierCles);
  if (estObjet(x)) {
    const o = {};
    for (const k of Object.keys(x).sort()) if (x[k] !== undefined) o[k] = trierCles(x[k]);
    return o;
  }
  return x;
}

/** Même contenu (l'ordre des clés ne compte pas, `undefined` vaut absent). */
export function egal(a, b) {
  if (a === b) return true;
  return JSON.stringify(trierCles(a)) === JSON.stringify(trierCles(b));
}

/**
 * Une empreinte courte du contenu (FNV-1a sur 32 bits, du JSON aux clés
 * triées) : de quoi reconnaître une version sans la garder entière. Deux
 * versions ne se distinguent pas par leur seule date : deux appareils dont
 * l'horloge retarde datent tous deux « la version d'avant + 1 ms ».
 */
export function empreinte(x) {
  const s = JSON.stringify(trierCles(x)) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

/** Le contenu d'une fiche, sans ses dates : deux versions identiques à la date près sont la même. */
export function sansDates(f) {
  if (!f) return f;
  const { modifieLe: _m, creeLe: _c, ...reste } = f;
  return reste;
}

// ------------------------------------------------------------------------
// Fusionner deux versions d'une fiche
// ------------------------------------------------------------------------

/** Un champ à trois versions : celle qui a changé depuis la base ; changé des deux côtés, `departager`. */
function troisVoies(b, l, d, departager) {
  if (egal(l, d)) return l;
  if (egal(l, b)) return d;
  if (egal(d, b)) return l;
  return departager(l, d);
}

/** Des étiquettes : les ajouts des deux côtés, moins les retraits des deux côtés. */
function fusionnerEnsembles(b = [], l = [], d = []) {
  const base = new Set(b), ici = new Set(l), la = new Set(d);
  const retirees = new Set([...base].filter((t) => !ici.has(t) || !la.has(t)));
  const sortie = l.filter((t) => !retirees.has(t));
  for (const t of d) if (!base.has(t) && !sortie.includes(t)) sortie.push(t);
  return sortie;
}

/**
 * Les notes d'une piste, note par note (chaque note a son numéro) : les
 * ajouts des deux côtés restent ; une note retirée d'un côté part, sauf si
 * l'autre l'a changée entre-temps (on ne jette pas un travail) ; changée
 * des deux côtés, la plus récente.
 */
function fusionnerNotes(b, l, d, departager, numeroNeuf) {
  const B = new Map(b.map((n) => [n.id, n])), L = new Map(l.map((n) => [n.id, n])), D = new Map(d.map((n) => [n.id, n]));
  const sortie = [];
  for (const n of l) {
    const nb = B.get(n.id), nd = D.get(n.id);
    if (nb) {
      if (!nd) { if (!egal(n, nb)) sortie.push(n); continue; }
      sortie.push(troisVoies(nb, n, nd, departager));
    } else {
      sortie.push(n);
      // Le même numéro tiré des deux côtés (`suivant` était le même) pour deux notes différentes : on garde les deux.
      if (nd && !egal(n, nd)) sortie.push({ ...nd, id: numeroNeuf() });
    }
  }
  for (const n of d) {
    if (L.has(n.id)) continue;
    const nb = B.get(n.id);
    if (nb && egal(n, nb)) continue; // retirée ici, pas touchée là-bas : elle part
    sortie.push(n);
  }
  // Deux notes au même endroit, à la même hauteur (ajoutées chacune de son côté) : une seule, la plus longue, comme poser().
  const parPlace = new Map();
  for (const n of sortie) {
    const cle = `${n.d}:${n.h}`;
    const deja = parPlace.get(cle);
    if (!deja || n.l > deja.l) parPlace.set(cle, n);
  }
  return [...parPlace.values()].sort((x, y) => x.d - y.d || x.h - y.h);
}

/** Des éléments repérés par une clé (les accords par leur position) : même règle que les notes. */
function fusionnerParCle(b, l, d, cle, departager) {
  const B = new Map(b.map((x) => [cle(x), x])), L = new Map(l.map((x) => [cle(x), x])), D = new Map(d.map((x) => [cle(x), x]));
  const sortie = [];
  for (const k of new Set([...L.keys(), ...D.keys()])) {
    const xb = B.get(k), xl = L.get(k), xd = D.get(k);
    if (xl && xd) sortie.push(troisVoies(xb, xl, xd, departager));
    else if (xl) { if (!xb || !egal(xl, xb)) sortie.push(xl); }
    else if (!xb || !egal(xd, xb)) sortie.push(xd);
  }
  return sortie;
}

function fusionnerSequences(b, l, d, departager) {
  const sortie = {};
  for (const k of new Set([...Object.keys(b || {}), ...Object.keys(l), ...Object.keys(d)])) {
    if (k === "pistes" || k === "accords" || k === "suivant") continue;
    const v = troisVoies(b && b[k], l[k], d[k], departager);
    if (v !== undefined) sortie[k] = v;
  }
  const toutes = [...(b?.pistes || []), ...l.pistes, ...d.pistes].flatMap((p) => p.notes);
  let prochain = Math.max(l.suivant || 1, d.suivant || 1, ...toutes.map((n) => n.id + 1));
  const numeroNeuf = () => prochain++;
  const pistes = [];
  for (let i = 0; i < Math.max(l.pistes.length, d.pistes.length); i++) {
    const pb = b?.pistes?.[i], pl = l.pistes[i], pd = d.pistes[i];
    if (!pl || !pd) {
      const seule = pl || pd;
      if (!pb || !egal(seule, pb)) pistes.push(seule); // retirée d'un côté sans changer de l'autre : elle part
      continue;
    }
    const piste = {};
    for (const k of new Set([...Object.keys(pb || {}), ...Object.keys(pl), ...Object.keys(pd)])) {
      if (k === "notes") continue;
      const v = troisVoies(pb && pb[k], pl[k], pd[k], departager);
      if (v !== undefined) piste[k] = v;
    }
    piste.notes = fusionnerNotes(pb?.notes || [], pl.notes, pd.notes, departager, numeroNeuf);
    pistes.push(piste);
  }
  sortie.pistes = pistes.length ? pistes : [{ nom: "Mélodie", notes: [] }];
  sortie.accords = fusionnerParCle(b?.accords || [], l.accords || [], d.accords || [], (a) => a.d, departager).sort((x, y) => x.d - y.d);
  sortie.suivant = prochain;
  return sortie;
}

/**
 * Deux versions d'une même fiche → une seule. `base` : la dernière version
 * que les deux connaissaient (null : inconnue, on garde alors la plus
 * récente entière, comme avant les bases). Les trois sont remises en forme.
 *
 * Changé d'un seul côté : ce côté gagne. Changé des deux côtés : les
 * étiquettes se réunissent, les notes d'une idée se fusionnent note par
 * note, les accords position par position ; ailleurs, la plus récente.
 * Le texte d'une page lue (son ABC et ses doutes) changé des deux côtés ne
 * se mélange pas : la fiche garde celui d'ici, et `copie` rend la version
 * de l'autre appareil, à garder à part (une copie de conflit).
 *
 * @returns { donnees, copie: null | fiche, memo: "locale" | "distante" (d'où vient le mémo, donc le son) }
 */
export function fusionnerFiches({ base, locale, distante }) {
  const plusRecente = (locale.modifieLe || "") >= (distante.modifieLe || "") ? "locale" : "distante";
  if (!base) {
    const gagnante = plusRecente === "locale" ? locale : distante;
    return { donnees: gagnante, copie: null, memo: plusRecente };
  }
  const departager = (l, d) => (plusRecente === "locale" ? l : d);
  const donnees = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(locale), ...Object.keys(distante)])) {
    if (k === "modifieLe" || k === "creeLe") continue;
    const b = base[k], l = locale[k], d = distante[k];
    const deuxFois = !egal(l, d) && !egal(l, b) && !egal(d, b);
    let v;
    if (k === "etiquettes" && deuxFois) v = fusionnerEnsembles(b, l, d);
    else if (k === "sequence" && deuxFois && estObjet(l) && estObjet(d)) v = fusionnerSequences(estObjet(b) ? b : null, l, d, departager);
    else v = troisVoies(b, l, d, departager);
    if (v !== undefined) donnees[k] = v;
  }
  let memo = plusRecente;
  if (egal(locale.memo, distante.memo) || egal(distante.memo, base.memo)) memo = "locale";
  else if (egal(locale.memo, base.memo)) memo = "distante";

  let copie = null;
  if (!locale.type && !distante.type) {
    const texteDe = (f) => ({ abc: f.abc, doutes: f.doutes });
    const ici = !egal(texteDe(locale), texteDe(base)), la = !egal(texteDe(distante), texteDe(base));
    if (ici && la && !egal(texteDe(locale), texteDe(distante))) {
      for (const k of ["abc", "doutes"]) { if (locale[k] === undefined) delete donnees[k]; else donnees[k] = locale[k]; }
      copie = distante;
    }
  }
  donnees.creeLe = [locale.creeLe, distante.creeLe].filter(Boolean).sort()[0] || EPOQUE;
  // Plus récente que les deux : un appareil d'avant les bases la prend pour la dernière.
  const apresLa = uneMsPlusTard(distante.modifieLe || EPOQUE);
  donnees.modifieLe = (locale.modifieLe || "") > apresLa ? locale.modifieLe : apresLa;
  // L'ABC d'une idée n'est que la traduction de ses notes et de son titre : il suit ce qui a été gardé.
  if (donnees.type === "idee") {
    if (egal(donnees.sequence, locale.sequence) && donnees.titre === locale.titre) donnees.abc = locale.abc;
    else if (egal(donnees.sequence, distante.sequence) && donnees.titre === distante.titre) donnees.abc = distante.abc;
    else donnees.abc = abcDeLIdee(donnees);
  }
  return { donnees: normaliserFiche(donnees), copie, memo };
}
