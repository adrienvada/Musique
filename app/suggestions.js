/**
 * LES SUGGESTIONS DE CLAUDE, CÔTÉ APPLI (H3)
 *
 * Dans une conversation, Claude range des propositions à côté d'une
 * partition d'Adrien (C5) : le connecteur les garde à part,
 * suggestions/<partition>/<sid>.json, sans toucher la partition ni la synchro.
 * Une fiche : { sid, cible, genre, contenu, pourquoi, creeLe, auteur }.
 * Genres et contenus (conversation.js, suggestion_ecrire), temps en pas :
 *   - « accords » { accords: [{ debut, nom }] }, debut depuis le début ;
 *   - « suite » { notes: [{ debut, duree, hauteur, velocite? }], accords? },
 *     debut compté depuis la fin de la partition ;
 *   - « variation » { notes, accords? }, qui remplacent sa mélodie ;
 *   - « texte » { note?, titre?, etiquettes?, doute? } : `doute` est le rang
 *     d'un doute de la page, auquel `note` répond.
 *
 * Le connecteur vérifie à l'écriture ; l'appli revérifie à la lecture, parce
 * qu'une fiche peut venir de n'importe où (un connecteur plus ancien, une
 * main, un stockage abîmé) et que la partition a pu changer depuis :
 *   - validerSuggestion(fiche, cible) → { ok: true, proposition } ou
 *     { ok: false, raison } (avec `sansEffet: true` si elle ne changerait
 *     rien : déjà appliquée ailleurs, ou un doute déjà réglé) ;
 *   - appliquerSuggestion(cible, proposition) → la nouvelle fiche, pure :
 *     c'est l'écran qui l'écrit, d'un geste d'Adrien ;
 *   - resumeSuggestion(fiche) → une courte phrase, du texte simple que
 *     l'écran échappe.
 *
 * Une réponse à un doute n'est qu'une phrase : elle ne peut pas changer
 * l'ABC (Adrien ne lit pas l'ABC, et seul un geste d'edition.js le
 * réécrit). Appliquée, elle devient l'avis de Claude sur ce doute
 * (`avis`), que l'atelier montre près de la question ; le doute reste à
 * régler d'un toucher.
 *
 * Sans dépendance hors claude-idee.js (la lecture de ce que Claude rend).
 */
import { ajouterNotes, chevauchement, champs, couper, enPas, estObjet, formeSure, lireNotes, lirePourquoi, nettoyer, nomDAccord, poserAccords, remplacerNotes } from "./claude-idee.js";

export const GENRES_SUGGESTION = ["accords", "suite", "variation", "texte"];

// Les bornes du connecteur (conversation.js) : ce qu'il a pu écrire, pas plus.
const MAX_NOTES = 4000;
const MAX_ACCORDS = 512;
const FIN_SUGGESTION = 8192;
const MAX_NOTE = 2000;
const MAX_TITRE = 120;
const MAX_ETIQUETTES = 10;
const MAX_ETIQUETTE = 40;
const MAX_POURQUOI = 2000;
// Et celles de la bibliothèque (fiche.js) : au-delà, elle rabattrait en silence.
const MAX_PAS = 16384;
const MAX_NOTES_FICHE = 20000;
const MAX_NOTE_FICHE = 20000;
const MAX_ETIQUETTES_FICHE = 50;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TOUT = { bas: 21, haut: 108 };

const refus = (/** @type {string} */ raison, sansEffet = false) => ({ ok: /** @type {false} */ (false), raison, ...(sansEffet ? { sansEffet: true } : {}) });
const reussi = (/** @type {object} */ proposition) => ({ ok: /** @type {true} */ (true), proposition });

/** Des accords [{ debut, nom }] lus en { d, nom } (d = debut + decalage, avant `fin`) ; { accords, raison }. */
function lireAccords(/** @type {unknown} */ liste, /** @type {number} */ decalage, /** @type {number} */ fin, auMoinsUn = true) {
  const non = (/** @type {string} */ raison) => ({ accords: /** @type {{ d: number, nom: string }[] | null} */ (null), raison });
  if (!Array.isArray(liste) || (auMoinsUn && !liste.length)) return non("accords : une liste non vide attendue");
  if (liste.length > MAX_ACCORDS) return non(`accords : ${MAX_ACCORDS} au plus`);
  /** @type {{ d: number, nom: string }[]} */
  const accords = [];
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i], ici = `accords[${i}]`;
    const e = champs(a, ["debut", "nom"], ["debut", "nom"], ici);
    if (e) return non(e);
    if (!Number.isInteger(a.debut) || a.debut < 0 || a.debut + decalage >= fin) return non(`${ici} : hors de la partition`);
    const nom = nomDAccord(a.nom);
    if (!nom) return non(`${ici} : accord illisible ${JSON.stringify(a.nom)}`);
    const d = a.debut + decalage;
    if (accords.some((x) => x.d === d)) return non(`${ici} : deux accords au même début`);
    accords.push({ d, nom });
  }
  accords.sort((a, b) => a.d - b.d);
  return { accords, raison: /** @type {string | null} */ (null) };
}

/** Une étiquette telle que la bibliothèque la range (fiche.js) : rognée, en minuscules. */
const etiquette = (/** @type {string} */ t) => nettoyer(t).toLowerCase();
const memesAccords = (/** @type {{ d: number, nom: string }[]} */ a, /** @type {{ d: number, nom: string }[]} */ b) => JSON.stringify(a.map((x) => [x.d, x.nom])) === JSON.stringify([...b].sort((x, y) => x.d - y.d).map((x) => [x.d, x.nom]));

/** La séquence d'une idée, si elle est lisible : sans elle, rien de musical ne s'applique. */
function sequenceDe(/** @type {Record<string, any>} */ cible) {
  const s = cible.type === "idee" ? cible.sequence : null;
  const lisible = estObjet(s) && Array.isArray(s.mesure) && Array.isArray(s.pistes) && s.pistes.length > 0 && s.pistes.every((p) => estObjet(p) && Array.isArray(p.notes));
  return lisible ? /** @type {any} */ (s) : null;
}

/** @param {Record<string, any>} c @param {Record<string, any>} cible @param {object} base */
function validerMusique(/** @type {string} */ genre, c, cible, base) {
  const seq = sequenceDe(cible);
  if (!seq) return refus(cible.type === "idee" ? "cette idée est illisible" : "des notes et des accords ne s'appliquent qu'à une idée");
  const { ppm, fin, finLibre } = enPas(seq);
  if (genre === "accords") {
    const e = champs(c, ["accords"], ["accords"], "contenu (accords)");
    if (e) return refus(e);
    const lus = lireAccords(c.accords, 0, fin);
    if (lus.raison) return refus(lus.raison);
    if (memesAccords(lus.accords, seq.accords || [])) return refus("ces accords sont déjà ceux de l'idée", true);
    return reussi({ ...base, accords: lus.accords });
  }
  const e = champs(c, ["notes", "accords"], ["notes"], `contenu (${genre})`);
  if (e) return refus(e);
  const suite = genre === "suite";
  // La suite commence à la barre qui suit la dernière mesure ; la variation
  // peut s'allonger (des valeurs doublées) jusqu'au double de l'idée.
  const origine = suite ? fin : 0;
  const bout = Math.min(MAX_PAS, suite ? fin + FIN_SUGGESTION : finLibre);
  const lues = lireNotes(c.notes, { decalage: origine, fenetre: [origine, bout], tessiture: TOUT, max: MAX_NOTES, velocite: true, ou: "contenu.notes" });
  if (lues.raison) return refus(lues.raison);
  const ch = chevauchement(lues.notes, suite ? seq.pistes[0].notes : []);
  if (ch) return refus(ch);
  const restantes = seq.pistes.reduce((t, p, i) => t + (suite || i > 0 ? p.notes.length : 0), 0);
  if (restantes + lues.notes.length > MAX_NOTES_FICHE) return refus("la partition aurait trop de notes");
  // Les accords tiennent dans l'idée telle qu'elle sera : jusqu'à la barre après la dernière note.
  const autres = seq.pistes.slice(suite ? 0 : 1).flatMap((p) => p.notes);
  const finNouvelle = Math.ceil(Math.max(...lues.notes.map((n) => n.d + n.l), ...autres.map((n) => n.d + n.l), 1) / ppm) * ppm;
  let accords = null;
  if (c.accords !== undefined) {
    const la = lireAccords(c.accords, origine, finNouvelle, false);
    if (la.raison) return refus(la.raison);
    // Une liste vide ne dit pas « efface les accords » sans ambiguïté : dans le doute, ceux d'Adrien restent.
    accords = la.accords.length ? la.accords : null;
  }
  if (!suite) {
    const cle = (/** @type {{ d: number, l: number, h: number }[]} */ l) => l.map((n) => `${n.d},${n.l},${n.h}`).sort().join(";");
    if (cle(lues.notes) === cle(seq.pistes[0].notes) && (!accords || memesAccords(accords, seq.accords || []))) return refus("cette variation est déjà la mélodie de l'idée", true);
  }
  return reussi({ ...base, notes: lues.notes, accords, origine });
}

/** @param {Record<string, any>} c @param {Record<string, any>} cible @param {object} base */
function validerTexte(c, cible, base) {
  const e = champs(c, ["note", "titre", "etiquettes", "doute"], [], "contenu (texte)");
  if (e) return refus(e);
  if (c.note === undefined && c.titre === undefined && c.etiquettes === undefined) return refus("contenu (texte) : au moins une note, un titre ou des étiquettes");
  /** @type {Record<string, any>} */
  const p = { ...base };
  const effets = [];
  if (c.note !== undefined) {
    if (typeof c.note !== "string") return refus("note : un texte attendu");
    const note = nettoyer(c.note, { lignes: true });
    if (!note) return refus("note : vide");
    if (note.length > MAX_NOTE) return refus(`note : ${MAX_NOTE} caractères au plus`);
    p.note = note;
  }
  if (c.doute !== undefined) {
    const doutes = Array.isArray(cible.doutes) ? cible.doutes : [];
    if (!doutes.length) return refus("cette partition n'a pas de doute");
    if (!Number.isInteger(c.doute) || c.doute < 0 || c.doute >= doutes.length || !estObjet(doutes[c.doute])) return refus(`doute : un rang de 0 à ${doutes.length - 1}`);
    if (p.note === undefined) return refus("doute : la réponse (note) manque");
    if (doutes[c.doute].leve === true) return refus("ce doute est déjà réglé", true);
    p.doute = c.doute;
    const avis = doutes[c.doute].avis;
    effets.push(!(estObjet(avis) && avis.texte === p.note));
  } else if (p.note !== undefined) {
    const actuelle = typeof cible.note === "string" ? cible.note : "";
    if (actuelle.length + p.note.length + 2 > MAX_NOTE_FICHE) return refus("la note de la partition est pleine");
    effets.push(!actuelle.includes(p.note));
  }
  if (c.titre !== undefined) {
    if (typeof c.titre !== "string") return refus("titre : un texte attendu");
    const titre = nettoyer(c.titre);
    if (!titre) return refus("titre : vide");
    if (titre.length > MAX_TITRE) return refus(`titre : ${MAX_TITRE} caractères au plus`);
    p.titre = titre;
    effets.push(titre !== cible.titre);
  }
  if (c.etiquettes !== undefined) {
    if (!Array.isArray(c.etiquettes) || !c.etiquettes.length || c.etiquettes.length > MAX_ETIQUETTES) return refus(`etiquettes : de 1 à ${MAX_ETIQUETTES}`);
    /** @type {string[]} */
    const etiquettes = [];
    for (const [i, t] of c.etiquettes.entries()) {
      if (typeof t !== "string") return refus(`etiquettes[${i}] : un texte attendu`);
      const n = etiquette(t);
      if (!n || n.length > MAX_ETIQUETTE) return refus(`etiquettes[${i}] : de 1 à ${MAX_ETIQUETTE} caractères`);
      if (!etiquettes.includes(n)) etiquettes.push(n);
    }
    const siennes = Array.isArray(cible.etiquettes) ? cible.etiquettes : [];
    p.etiquettes = etiquettes;
    effets.push(etiquettes.some((t) => !siennes.includes(t)));
  }
  if (!effets.some(Boolean)) return refus("elle ne changerait rien", true);
  return reussi(p);
}

/**
 * Vérifie une suggestion pour sa partition (`cible` : la fiche telle que
 * l'appli la lit, avec son `id`). Rend { ok: true, proposition } ou
 * { ok: false, raison, sansEffet? }. Propositions, temps en pas, positions
 * déjà absolues : « accords » { accords: [{ d, nom }] } ; « suite » et
 * « variation » { notes: [{ d, l, h, v? }], accords: [{ d, nom }] ou null,
 * origine } ; « texte » { titre?, etiquettes?, note?, doute? }. Toutes ont
 * genre, sid (ou null) et pourquoi. Revalider juste avant d'appliquer : la
 * partition a pu changer entre la liste et le geste.
 * @param {unknown} fiche @param {unknown} cible
 */
export function validerSuggestion(fiche, cible) {
  const f = formeSure(fiche);
  if (f) return refus(f);
  if (!estObjet(fiche)) return refus("une suggestion est un objet");
  if (!estObjet(cible)) return refus("la partition visée manque");
  if (fiche.sid !== undefined && (typeof fiche.sid !== "string" || !ID.test(fiche.sid))) return refus("sid illisible");
  if (typeof fiche.cible !== "string" || !ID.test(fiche.cible)) return refus("cible illisible : à quelle partition va-t-elle ?");
  if (cible.id !== undefined && fiche.cible !== cible.id) return refus("cette suggestion est pour une autre partition");
  if (!GENRES_SUGGESTION.includes(fiche.genre)) return refus(`genre inconnu : ${JSON.stringify(fiche.genre)}`);
  if (!estObjet(fiche.contenu)) return refus("contenu : un objet attendu");
  const pq = lirePourquoi(fiche.pourquoi, MAX_POURQUOI);
  if (pq.raison) return refus(pq.raison);
  const base = { genre: fiche.genre, sid: fiche.sid ?? null, pourquoi: pq.pourquoi };
  return fiche.genre === "texte" ? validerTexte(fiche.contenu, cible, base) : validerMusique(fiche.genre, fiche.contenu, cible, base);
}

/**
 * La suggestion validée, appliquée : une NOUVELLE fiche (la `cible` reçue
 * n'est jamais touchée). « accords » : ceux de l'idée remplacés, les accords
 * plaqués en route s'il n'y avait pas d'accompagnement ; « suite » : des
 * notes après la fin de la mélodie (et ses accords) ; « variation » : la
 * piste 0 remplacée (et les accords, s'il y en a) ; « texte » : le titre, les
 * étiquettes ajoutées aux siennes, la note ajoutée à la sienne, ou l'avis
 * sur le doute. L'ABC d'une idée n'est que la traduction de ses notes : il
 * est vidé, et le stockage le refait (normaliserFiche, fiche.js), comme pour
 * une idée écrite par le connecteur.
 * @param {Record<string, any>} cible @param {Record<string, any>} proposition
 * @returns {Record<string, any>}
 */
export function appliquerSuggestion(cible, proposition) {
  if (!proposition || !GENRES_SUGGESTION.includes(proposition.genre)) throw new Error("Cette suggestion n'a pas été validée.");
  const f = JSON.parse(JSON.stringify(cible));
  if (proposition.genre === "texte") {
    if (proposition.titre !== undefined) f.titre = proposition.titre;
    if (proposition.etiquettes !== undefined) {
      const siennes = Array.isArray(f.etiquettes) ? f.etiquettes : [];
      f.etiquettes = [...new Set([...siennes, ...proposition.etiquettes])].slice(0, MAX_ETIQUETTES_FICHE);
    }
    if (proposition.doute !== undefined) {
      if (!Array.isArray(f.doutes) || !estObjet(f.doutes[proposition.doute])) throw new Error("Ce doute n'est plus dans la partition : revalide la suggestion.");
      f.doutes[proposition.doute] = { ...f.doutes[proposition.doute], avis: { auteur: "claude", texte: proposition.note } };
    } else if (proposition.note !== undefined) {
      const actuelle = typeof f.note === "string" ? f.note : "";
      if (!actuelle.includes(proposition.note)) f.note = actuelle ? `${actuelle}\n\n${proposition.note}` : proposition.note;
    }
    // Le titre d'une idée est dans son ABC (T:) : il se refait aussi.
    if (f.type === "idee" && proposition.titre !== undefined) f.abc = "";
    return f;
  }
  const seq = f.sequence;
  if (proposition.genre === "accords") poserAccords(seq, proposition.accords, 0, Infinity);
  else {
    if (proposition.genre === "suite") ajouterNotes(seq, 0, proposition.notes);
    else remplacerNotes(seq, 0, seq.pistes[0].notes.map((/** @type {{ id: number }} */ n) => n.id), proposition.notes);
    // Les accords de la suite s'ajoutent après la fin ; ceux d'une variation remplacent tous les autres.
    if (proposition.accords) poserAccords(seq, proposition.accords, proposition.origine, Infinity);
  }
  f.abc = "";
  return f;
}

const pluriel = (/** @type {number} */ n, /** @type {string} */ mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/**
 * « Claude propose des accords », « Claude répond au doute n° 3 » : une
 * phrase courte pour la liste. Du texte simple, que l'écran échappe ; une
 * fiche mal formée donne une phrase prudente, jamais une erreur.
 * @param {unknown} fiche
 */
export function resumeSuggestion(fiche) {
  if (!estObjet(fiche) || !estObjet(fiche.contenu)) return "Claude propose quelque chose";
  const c = fiche.contenu;
  const nb = (/** @type {unknown} */ l) => (Array.isArray(l) ? l.length : 0);
  if (fiche.genre === "accords") return nb(c.accords) ? `Claude propose ${pluriel(nb(c.accords), "accord")}` : "Claude propose des accords";
  if (fiche.genre === "suite") return nb(c.notes) ? `Claude propose une suite de ${pluriel(nb(c.notes), "note")}` : "Claude propose une suite";
  if (fiche.genre === "variation") return "Claude propose une variation de la mélodie";
  if (fiche.genre !== "texte") return "Claude propose quelque chose";
  if (Number.isInteger(c.doute) && c.doute >= 0) return `Claude répond au doute n° ${c.doute + 1}`;
  const titre = typeof c.titre === "string" ? couper(nettoyer(c.titre), 60) : "";
  const etiquettes = Array.isArray(c.etiquettes) ? c.etiquettes.filter((t) => typeof t === "string").map((t) => couper(etiquette(t), 40)).filter(Boolean) : [];
  const note = typeof c.note === "string" && nettoyer(c.note) !== "";
  const parts = [titre && "un titre", etiquettes.length && "des étiquettes", note && "une note"].filter(Boolean);
  if (parts.length > 1) return `Claude propose ${parts.slice(0, -1).join(", ")} et ${parts.at(-1)}`;
  if (titre) return `Claude propose un titre : « ${titre} »`;
  if (etiquettes.length) return `Claude propose des étiquettes : ${etiquettes.slice(0, 5).join(", ")}`;
  return note ? "Claude propose une note" : "Claude propose quelque chose";
}
