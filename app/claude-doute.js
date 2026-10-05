/**
 * UN SECOND AVIS DE CLAUDE SUR UN DOUTE (H1)
 *
 * Les grands modèles lisent mal une partition entière : sur un banc de 2026,
 * Claude s'écartait de 80 à 92 % de la bonne partition ; ils comptent mal
 * les lignes, qui donnent la hauteur (audit du 04/10). Mais une question
 * fermée sur une seule mesure, avec ce que le lecteur en a mesuré, est à
 * leur portée. Ce module prépare cette question et lit l'avis qui revient :
 *   - messageDoute({ question, abcMesure, chiffrage, armure, compris, image })
 *     → le texte à passer à `sample.json` : la mesure en ABC, ce que le
 *     lecteur a compris, la question de `poser` (doutes.js) et ses réponses,
 *     EXACTEMENT celles qu'Adrien voit, numérotées ;
 *   - validerAvis(reponse, question) → { ok, rang, choix, confiance,
 *     pourquoi } ou { ok: false, raison }.
 *
 * La hauteur se calcule, elle ne se demande pas : le lecteur la tire de la
 * position de la tête sur les lignes de son modèle, et la vision des modèles
 * reste « approximative » pour situer et compter (documentation de Claude).
 * Le message le dit à Claude, qui ne la conteste pas.
 *
 * Claude conseille, il ne corrige pas : l'avis montre une réponse ; c'est le
 * toucher d'Adrien qui applique son geste (edition.js), comme toujours.
 * Rien n'appelle `sample` ici, rien n'écrit, et l'image (le passage
 * recadré, têtes numérotées) est fabriquée par l'écran.
 *
 * Autour, pour l'écran (lot atelier) : `entreeDoute` prépare ce qui part
 * avec la question (la mesure du doute en ABC, son chiffrage, son armure,
 * ce que le lecteur a compris), `issueAvis` dit quoi faire d'un code
 * d'erreur de `sample`, et `direAvis` met l'avis en mots.
 *
 * Sans dépendance hors doutes.js, edition.js et claude-idee.js (la lecture
 * des réponses).
 */
import { mesuresDeLAbc, nomCle, typeDe } from "./doutes.js";
import { champA } from "./edition.js";
import { expliquer } from "./erreurs.js";
import { champs, couper, entierDans, formeSure, lirePourquoi, nettoyer } from "./claude-idee.js";

/**
 * Ce que `poser` (doutes.js) rend, dans ce qui sert ici.
 * @typedef {{ id?: string, texte: string, fait?: string }} Reponse
 * @typedef {{ type?: string, titre?: string, detail?: string, reponses: Reponse[] }} Question
 *
 * Ce que le lecteur a compris de la mesure, préparé par l'écran.
 * @typedef {object} Compris
 * @property {{ nom: string, duree?: string, sure?: boolean }[]} [notes]  les têtes de gauche à droite (numérotées ainsi sur l'image) ; nom : la hauteur calculée par la position, « sol4 »
 * @property {string[]} [sur]  ce qui est sûr : « les barres de mesure », « trois têtes »
 * @property {{ quoi: string, valeur: number, seuil?: number }[]} [mesures]  des longueurs en interlignes : « distance du point à sa tête », 2.3, seuil 2.2
 * @property {number[]} [concernees]  les numéros (comptés de 1) des têtes que vise le doute, quand il n'en vise qu'une partie
 */

/**
 * Les options de `sample.json` pour un avis : le modèle de tous les jours
 * (une question fermée, pas un problème difficile) ; jamais en cache, parce
 * qu'un avis refusé ici a réussi pour `sample`, qui le rejouerait pendant
 * cinq minutes à chaque « réessaie ». L'écran y ajoute `signal`, `onText`
 * et, si `sample.limits()` annonce des images, `images`.
 */
export const OPTIONS_AVIS = Object.freeze({ modelTier: /** @type {"default"} */ ("default"), cache: /** @type {false} */ (false) });

// Une phrase pour Adrien ; au-delà, coupée (elle n'est qu'à montrer).
const MAX_POURQUOI = 300;
// Des bornes larges sur ce que l'écran prépare : une mesure n'a pas trente-deux têtes.
const MAX_ABC = 1500;
const MAX_NOTES = 32;
const MAX_LISTE = 10;

const refus = (/** @type {string} */ raison) => ({ ok: /** @type {false} */ (false), raison });
const texte = (/** @type {unknown} */ x, /** @type {number} */ max) => (typeof x === "string" ? couper(nettoyer(x), max) : "");
const nombre = (/** @type {number} */ x) => String(Math.round(x * 100) / 100).replace(".", ",");

/**
 * Une question qu'on peut poser à Claude : au moins deux réponses fermées.
 * Avec une seule (« C'est vu »), il n'y a rien à trancher ; sans réponse
 * (la note visée n'est plus là), Adrien corrige lui-même. L'écran ne montre
 * « Demander à Claude » que si c'est vrai.
 * @param {unknown} question
 */
export function avisPossible(question) {
  const q = /** @type {Question} */ (question);
  return !!q && Array.isArray(q.reponses) && q.reponses.length >= 2 && q.reponses.every((r) => r && typeof r.texte === "string" && r.texte.trim());
}

/** « K:Bb (si♭ majeur) », « K:C (sans altération à la clé) ». */
function decrireArmure(/** @type {unknown} */ armure) {
  const k = texte(armure, 12);
  if (!k) return null;
  if (k === "C") return "K:C (sans altération à la clé)";
  return /^[A-G][b#]?$/.test(k) ? `K:${k} (${nomCle(k)})` : `K:${k}`;
}

/** Les lignes de « ce que le lecteur a compris ». */
function decrireCompris(/** @type {Compris | string | undefined} */ compris, /** @type {boolean} */ image) {
  if (typeof compris === "string") return compris.trim() ? [texte(compris, 2000)] : [];
  if (!compris || typeof compris !== "object") return [];
  const lignes = [];
  const notes = Array.isArray(compris.notes) ? compris.notes.slice(0, MAX_NOTES) : [];
  if (notes.length) {
    const tetes = notes.map((n, i) => {
      const nom = texte(n && n.nom, 12) || "?";
      const duree = texte(n && n.duree, 30);
      const doute = n && n.sure === false ? " (à vérifier)" : "";
      return `${i + 1}. ${nom}${duree ? `, ${duree}` : ""}${doute}`;
    });
    lignes.push(`Têtes, de gauche à droite${image ? " (numérotées comme sur l'image)" : ""} : ${tetes.join(" ; ")}.`);
    const visees = (Array.isArray(compris.concernees) ? compris.concernees : []).filter((k) => Number.isInteger(k) && k >= 1 && k <= notes.length).slice(0, MAX_LISTE);
    if (visees.length) lignes.push(`La question porte sur ${visees.length === 1 ? `la tête ${visees[0]}` : `les têtes ${visees.slice(0, -1).join(", ")} et ${visees.at(-1)}`}.`);
  }
  const sur = Array.isArray(compris.sur) ? compris.sur.map((s) => texte(s, 80)).filter(Boolean).slice(0, MAX_LISTE) : [];
  if (sur.length) lignes.push(`Sûr : ${sur.join(" ; ")}.`);
  const mesures = (Array.isArray(compris.mesures) ? compris.mesures : [])
    .filter((m) => m && typeof m.quoi === "string" && Number.isFinite(m.valeur)).slice(0, MAX_LISTE)
    .map((m) => `${texte(m.quoi, 80)} : ${nombre(m.valeur)}${Number.isFinite(m.seuil) ? ` (seuil : ${nombre(m.seuil)})` : ""}`);
  if (mesures.length) lignes.push(`Mesuré, en interlignes (l'écart entre deux lignes de la portée) : ${mesures.join(" ; ")}.`);
  return lignes;
}

/**
 * Le texte à envoyer pour un doute (l'entrée de `sample.json`, avec
 * OPTIONS_AVIS). `question` : ce que rend poser(d, abc) ; ses réponses
 * partent toutes, dans l'ordre, numérotées de 1. `abcMesure` : l'ABC de la
 * mesure ; `chiffrage` (« 3/4 ») et `armure` (« Bb ») : ceux de la ligne ;
 * `compris` : voir le type Compris (ou un texte déjà rédigé) ; `image` :
 * true si l'écran joint le passage recadré. Lance une Error si la question
 * n'a pas deux réponses fermées (avisPossible).
 * @param {{ question: Question, abcMesure?: string, chiffrage?: string, armure?: string, compris?: Compris | string, image?: boolean }} entree
 * @returns {string}
 */
export function messageDoute({ question, abcMesure = "", chiffrage = "", armure = "", compris = undefined, image = false }) {
  if (!avisPossible(question)) throw new Error("Ce doute n'a pas deux réponses fermées : il n'y a rien à demander à Claude.");
  const m = texte(chiffrage, 12), k = decrireArmure(armure);
  const abc = typeof abcMesure === "string" ? couper(nettoyer(abcMesure, { lignes: true }), MAX_ABC) : "";
  const lignes = [
    "Tu aides Adrien à relire une page de musique qu'il a écrite à la main sur sa tablette. Un programme l'a lue ; sur un point, il hésite et pose une question fermée. Donne ton avis sur cette seule question.",
    "",
    "La mesure, telle que le programme l'a comprise, en ABC (L:1/8 : l'unité est la croche) :",
    ...(m ? [`M:${m}`] : []),
    ...(k ? [k] : []),
    abc || "(l'ABC de la mesure n'est pas disponible)",
    "",
    "Ce que le programme a compris :",
    ...decrireCompris(compris, image),
    "La hauteur de chaque tête vient de sa place sur les lignes de la portée, que le programme mesure : la question ne porte pas sur elle, ne la conteste pas.",
  ];
  if (image) lignes.push("", "L'image jointe montre ce passage, recadré, tel qu'Adrien l'a écrit : les têtes y sont numérotées dans le même ordre que ci-dessus, et un cadre bleu en pointillés entoure ce sur quoi porte la question. Les lignes grises sont celles de la portée imprimée.");
  const titre = texte(question.titre, 200), detail = texte(question.detail, 600);
  lignes.push("", `Question : ${titre || "À vérifier"}`, ...(detail ? [detail] : []), "", "Réponses possibles :");
  question.reponses.forEach((r, i) => {
    const t = texte(r.texte, 120);
    // Ce que fait la réponse, quand elle le dit mieux que son bouton (« Croche » : « la note devient une croche »).
    const fait = texte(r.fait, 200).replace(/\.$/, "");
    const effet = fait && fait !== t ? ` (${fait.charAt(0).toLowerCase()}${fait.slice(1)})` : "";
    lignes.push(`${i + 1}. ${t}${effet}`);
  });
  lignes.push(
    "",
    "Réponds seulement par un objet JSON de cette forme, sans texte autour :",
    // Des emplacements, pas un exemple : un « 1 » d'exemple tirerait l'avis vers la première réponse.
    '{"reponse": <numéro ou null>, "confiance": <de 0 à 1>, "pourquoi": "<une phrase>"}',
    `« reponse » : le numéro de la réponse la plus probable (de 1 à ${question.reponses.length}), ou null si tu ne peux pas trancher. « confiance » : un nombre de 0 à 1. « pourquoi » : une phrase en français pour Adrien, qui ne lit pas l'ABC : parle en noms de notes (do, ré, mi) et en durées (noire, croche).`,
  );
  return lignes.join("\n");
}

/**
 * L'avis de Claude, vérifié contre la question posée. Rend { ok: true, rang,
 * choix, confiance, pourquoi } : `rang` est la place de la réponse dans
 * question.reponses (comptée de 0, comme le rang d'un doute au connecteur ;
 * Claude, lui, a vu des numéros comptés de 1), `choix` cette réponse.
 * `reponse: null` (Claude ne sait pas) est un avis valide : rang et choix
 * null, à montrer comme tel. Sinon { ok: false, raison } : un numéro hors
 * de la liste, une confiance hors de 0..1, un mauvais type sont refusés.
 * @param {unknown} reponse @param {Question} question
 */
export function validerAvis(reponse, question) {
  if (!avisPossible(question)) return refus("la question n'a pas deux réponses fermées");
  const f = formeSure(reponse);
  if (f) return refus(f);
  const e = champs(reponse, ["reponse", "confiance", "pourquoi"], ["reponse"], "réponse");
  if (e) return refus(e);
  const r = /** @type {{ reponse: unknown, confiance?: unknown, pourquoi?: unknown }} */ (reponse);
  const n = question.reponses.length;
  if (r.reponse !== null && !entierDans(r.reponse, 1, n)) return refus(`reponse : un numéro de 1 à ${n}, ou null ; reçu ${JSON.stringify(r.reponse)}`);
  const numero = /** @type {number | null} */ (r.reponse);
  let confiance = 0;
  if (r.confiance === undefined) {
    // Sans avis, pas de confiance à donner ; avec un avis, elle compte (l'écran dit « Claude hésite »).
    if (numero !== null) return refus("« confiance » manque");
  } else if (typeof r.confiance !== "number" || !(r.confiance >= 0 && r.confiance <= 1)) {
    return refus(`confiance : un nombre de 0 à 1 ; reçu ${JSON.stringify(r.confiance)}`);
  } else confiance = r.confiance;
  const p = lirePourquoi(r.pourquoi, MAX_POURQUOI);
  if (p.raison) return refus(p.raison);
  const rang = numero === null ? null : numero - 1;
  return { ok: /** @type {true} */ (true), rang, choix: rang === null ? null : question.reponses[rang], confiance, pourquoi: p.pourquoi };
}

// ------------------------------------------------------------------------
// Autour de la question : ce que l'écran prépare, et ce qu'il fait de l'avis
// ------------------------------------------------------------------------

/**
 * Une tête du passage, d'après le lecteur (lecteur.js, `lues[].tetes`) : son
 * nom (« sol4 », d'après sa place sur les lignes) et son écart à cette place,
 * en demi-interlignes (à 0,5, elle changerait de note), et son centre sur la
 * page (pour savoir si le doute la vise).
 * @typedef {{ nom?: string, ecart?: number, cx?: number, cy?: number }} Tete
 */

/** Où vise un doute dans l'ABC d'aujourd'hui : sa note ou sa mesure, ses voisines, ou sa ligne. */
function viseeDe(/** @type {any} */ d) {
  for (const v of [d.vise, d.viseSuivante, d.visePrecedente, d.viseAccord]) if (v && Number.isInteger(v.debut)) return { ...v, ligne: false };
  return d.viseLigne && Number.isInteger(d.viseLigne.debut) ? { ...d.viseLigne, ligne: true } : null;
}

/**
 * Ce qui part avec la question (les champs de messageDoute, sauf la question
 * et l'image) : la mesure du doute en ABC (ou sa ligne, pour une armure ou
 * un chiffrage), son chiffrage et son armure, et ce que le lecteur a compris
 * du passage. `tetes` : celles du passage, de gauche à droite, numérotées
 * ainsi sur l'image ; `interligne` : celui de la page, pour reconnaître les
 * têtes que vise le doute. Rien n'est inventé : un doute qui ne vise plus
 * rien part sans mesure (le message le dit).
 * @param {{ doute: any, abc: string, tetes?: Tete[], interligne?: number }} entree
 * @returns {{ abcMesure: string, chiffrage: string, armure: string, compris: Compris }}
 */
export function entreeDoute({ doute, abc, tetes = [], interligne = 0 }) {
  const d = doute || {};
  const v = viseeDe(d);
  let abcMesure = "";
  if (v && v.ligne) abcMesure = abc.slice(v.debut, v.fin);
  else if (v) {
    const m = mesuresDeLAbc(abc).find((x) => x.debut <= v.debut && v.debut < Math.max(x.fin, x.debut + 1));
    abcMesure = m ? abc.slice(m.debut, m.fin) : abc.slice(v.debut, v.fin);
  }
  const pos = v ? v.debut : abc.length;
  const metre = champA(abc, pos, "M");
  const lues = (Array.isArray(tetes) ? tetes : []).filter((t) => t && typeof t.nom === "string").slice(0, 32);
  const notes = lues.map((t) => ({ nom: t.nom, ...(Number.isFinite(t.ecart) && Math.abs(t.ecart) >= 0.4 ? { sure: false } : {}) }));
  // Les têtes que vise le doute, quand il n'en vise qu'une partie : Claude sait de laquelle on parle.
  // Sa boîte entoure parfois un signe plutôt que la tête (le crochet, au bout de la queue) : une
  // marge d'une queue en hauteur, et d'une tête vers la gauche (la queue montante est à droite).
  const b = d.boite, il = Number.isFinite(interligne) && interligne > 0 ? interligne : 0;
  const dedans = (/** @type {Tete} */ t) => !!b && Number.isFinite(t.cx) && Number.isFinite(t.cy)
    && t.cx >= b.x0 - 0.8 * il && t.cx <= b.x1 + 0.2 * il && t.cy >= b.y0 - 4 * il && t.cy <= b.y1 + 4 * il;
  const concernees = lues.map((t, k) => (dedans(t) ? k + 1 : 0)).filter(Boolean);
  const sur = [];
  if (notes.length) sur.push(notes.length === 1 ? "une seule tête dans ce passage" : `${notes.length} têtes dans ce passage`);
  const type = typeDe(d);
  if (type === "mesure" && Number.isFinite(d.trouve) && Number.isFinite(d.attendu)) sur.push(`le chiffrage demande ${d.attendu} croches par mesure`);
  /** @type {{ quoi: string, valeur: number, seuil?: number }[]} */
  const mesures = [];
  if (type === "hauteur" && Number.isFinite(d.ecart)) mesures.push({ quoi: "écart de la tête douteuse au milieu de sa place", valeur: d.ecart / 2, seuil: 0.25 });
  if (type === "ligature" && Number.isFinite(d.ecart)) mesures.push({ quoi: "écart entre le bout de la ligature et la queue de la note", valeur: d.ecart, seuil: 0.55 });
  const compris = { notes, sur, mesures, ...(concernees.length && concernees.length < notes.length ? { concernees } : {}) };
  return { abcMesure, chiffrage: metre && metre !== "none" ? metre : "", armure: champA(abc, pos, "K"), compris };
}

/** Ce qu'on dit quand l'avis n'a pas pu venir, ou ne tient pas (un numéro hors de la liste, du JSON illisible). */
export const PAS_SU_REPONDRE = "Claude n'a pas su répondre : réessaie, ou réponds toi-même.";

/**
 * Ce que l'écran fait d'un échec : `cacher` la fonction pour la visite
 * (Claude n'est pas permis ici), `sansImage` (refaire sans l'image : cette
 * vue n'en envoie pas, ou l'a refusée), sinon un `message` (null : rien à
 * dire, Adrien a arrêté). Jamais de nouvel essai tout seul, sauf sans
 * l'image, une fois.
 *
 * `sample` rejette un objet simple qui porte son code (sample.d.ts,
 * `SampleErrorCode`). `invalid_json`, `empty_completion`, `upstream_error`
 * et tout code inconnu disent PAS_SU_REPONDRE, comme MESSAGE_REFUS pour une
 * idée : « réessaie » vaut pour une coupure comme pour une réponse
 * illisible. Une vraie Error vient de Portée (la page n'a pas pu se relire,
 * son modèle se charger) : elle passe par la traduction des erreurs, comme
 * partout ailleurs.
 * @param {any} err
 * @returns {{ cacher?: boolean, sansImage?: boolean, message: string | null }}
 */
export function issueAvis(err) {
  if (err instanceof Error) return { message: expliquer(err, PAS_SU_REPONDRE) };
  switch (err && err.code) {
    case "cancelled": return { message: null };
    case "not_granted": return { cacher: true, message: "Tu n'as pas autorisé Claude pour cette page : ses avis sont cachés jusqu'au prochain chargement." };
    case "sampling_disabled": case "not_declared": case "capability_disabled": case "capability_removed":
      return { cacher: true, message: "Claude n'est pas disponible ici : ses avis sont cachés jusqu'au prochain chargement." };
    case "images_unavailable": case "image_rejected": return { sansImage: true, message: PAS_SU_REPONDRE };
    case "rate_limited": return { message: "Claude est très demandé : réessaie dans un moment." };
    case "session_expired": return { message: "Ta session claude.ai a expiré : reconnecte-toi, puis réessaie." };
    case "refused": return { message: "Claude a préféré ne pas répondre à cette question : réponds toi-même." };
    default: return { message: PAS_SU_REPONDRE }; // la console garde le détail
  }
}

/** La confiance en mots : Adrien n'a pas à lire un nombre. */
const assurance = (/** @type {number} */ c) => (c >= 0.85 ? "sûr" : c >= 0.65 ? "assez sûr" : c >= 0.45 ? "hésitant" : "très hésitant");

/**
 * L'avis validé (validerAvis), en mots : « Claude pense : Croche — assez
 * sûr », ou « Claude ne sait pas trancher. », et sa phrase.
 * @param {{ rang: number | null, choix: Reponse | null, confiance: number, pourquoi?: string }} avis
 */
export function direAvis(avis) {
  const titre = avis.choix ? `Claude pense : ${avis.choix.texte} — ${assurance(avis.confiance)}` : "Claude ne sait pas trancher.";
  return { titre, pourquoi: avis.pourquoi || "" };
}
