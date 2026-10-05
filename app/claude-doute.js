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
 * Sans dépendance hors doutes.js et claude-idee.js (la lecture des réponses).
 */
import { nomCle } from "./doutes.js";
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
    "La hauteur de chaque tête vient de sa place sur les lignes de la portée, que le programme mesure : ne la conteste pas. La question porte sur autre chose.",
  ];
  if (image) lignes.push("", "L'image jointe montre ce passage, recadré, tel qu'Adrien l'a écrit : les têtes y sont numérotées dans le même ordre que ci-dessus.");
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
