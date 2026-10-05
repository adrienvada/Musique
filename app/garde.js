/**
 * CE QUI GARDE TA BIBLIOTHÈQUE SUR CET APPAREIL, ET SA SAUVEGARDE (D9)
 *
 * Ce que les Réglages disent de la bibliothèque rangée dans ce navigateur :
 * s'il a promis de la garder, la place qu'elle prend, et, quand on peut la
 * perdre sans le vouloir, comment l'éviter. Safari efface au bout de 7 jours
 * sans visite tout ce qu'un site garde, sauf pour une appli de l'écran
 * d'accueil (audit du 04/10, D9) : sur l'iPhone, l'installer est le seul
 * moyen de la garder. Ailleurs, un navigateur à court de place peut effacer
 * un site qu'il n'a pas promis de garder.
 *
 * Et la dernière sauvegarde dans un fichier : sans synchronisation, c'est la
 * seule copie de la bibliothèque hors de ce navigateur. Au-delà de 30 jours,
 * un rappel discret.
 *
 * Sans DOM : vérifié par `npm run types`, essayé sous Node
 * (tests/garde.test.mjs). L'écran est dans sauvegarde-ui.js.
 */

/** La préférence posée à chaque sauvegarde réussie (la date, en ISO). */
export const CLE_DERNIERE_SAUVEGARDE = "portee:derniere-sauvegarde";
/** Au-delà, sans synchronisation, on rappelle de sauvegarder. */
export const RAPPEL_JOURS = 30;
const JOUR = 86400000;

/**
 * « 820 octets », « 12 Ko », « 3,4 Mo », « 1,2 Go » : une taille, dite comme
 * le téléphone la dit (une décimale sous 10, la virgule française).
 * @param {number | null | undefined} octets
 * @returns {string}
 */
export function tailleLisible(octets) {
  if (!Number.isFinite(octets) || octets < 0) return "";
  if (octets < 1000) return `${Math.round(octets)} octets`;
  const unites = ["Ko", "Mo", "Go", "To"];
  let v = octets / 1000, i = 0;
  while (v >= 1000 && i < unites.length - 1) { v /= 1000; i++; }
  const chiffres = v < 10 ? (Math.round(v * 10) / 10).toString().replace(".", ",") : String(Math.round(v));
  return `${chiffres} ${unites[i]}`;
}

/**
 * @typedef {{ protege: boolean | null, utilise: number | null, quota: number | null, installee: boolean, ios: boolean, safari: boolean, risque: boolean }} EtatStockage
 *   ce que rend etatStockage() (stockage.js)
 * @typedef {{ titre: string, pourquoi: string, etapes: string[], apres: string }} Guide
 */

/**
 * Ce qu'on dit de la bibliothèque de ce navigateur.
 * @param {EtatStockage} etat
 * @param {{ synchronisee?: boolean }} [o]  synchronisee : la synchronisation est branchée
 *   (l'appli installée repart d'elle ; sinon, d'une sauvegarde)
 * @returns {{ protegee: string, place: string, proteger: boolean, conseil: string | null, guide: Guide | null }}
 *   protegee : « Oui », « Non » ou « On ne sait pas » ; place : « 3,4 Mo » (vide
 *   si le navigateur ne le dit pas) ; proteger : on peut redemander au navigateur
 *   de la garder, et `conseil` dit pourquoi ; guide : comment installer Portée,
 *   quand c'est ce qui la protège
 */
export function garde(etat, { synchronisee = false } = {}) {
  const e = etat || /** @type {EtatStockage} */ ({ protege: null, utilise: null, quota: null, installee: false, ios: false, safari: false, risque: false });
  // Safari efface même ce qu'il a promis de garder, si le site n'est pas installé.
  const protegee = e.risque ? "Non" : e.protege === true ? "Oui" : e.protege === false ? "Non" : "On ne sait pas";
  const place = tailleLisible(e.utilise);
  // L'appli installée a sa propre bibliothèque (Safari ne la partage pas) : elle se remplit d'ailleurs.
  const apres = synchronisee
    ? "L'appli installée a sa propre bibliothèque, vide au début : colle l'adresse du connecteur dans ses Réglages, et la synchronisation y ramène toutes tes partitions."
    : "L'appli installée a sa propre bibliothèque, vide au début : sauvegarde d'abord ta bibliothèque ici (Sauvegarde, dans ces Réglages), puis restaure-la dans l'appli installée.";
  const pourquoi = "Sinon, Safari efface tout ce que Portée garde au bout de 7 jours sans visite : tes partitions avec.";
  /** @type {Guide | null} */
  let guide = null;
  if (e.safari && !e.installee && e.ios) {
    guide = {
      titre: "Installe Portée sur l'écran d'accueil",
      pourquoi,
      etapes: [
        "Dans Safari, touche Partager (le carré et sa flèche).",
        "Choisis « Sur l'écran d'accueil », puis « Ajouter ».",
        "Ouvre Portée depuis son icône : là, ta bibliothèque est gardée.",
      ],
      apres,
    };
  } else if (e.safari && !e.installee) {
    guide = {
      titre: "Ajoute Portée au Dock",
      pourquoi,
      etapes: [
        "Dans Safari, ouvre le menu Fichier.",
        "Choisis « Ajouter au Dock », puis « Ajouter ».",
        "Ouvre Portée depuis le Dock : là, ta bibliothèque est gardée.",
      ],
      apres,
    };
  }
  const proteger = e.protege === false && !e.safari;
  const conseil = proteger
    ? "Sans cette promesse, le navigateur peut effacer ta bibliothèque s'il manque de place. Installer Portée sur cet appareil la protège aussi."
    : null;
  return { protegee, place, proteger, conseil, guide };
}

/**
 * Faut-il rappeler de sauvegarder ? Seulement sans synchronisation (et hors
 * de claude.ai, qui garde lui-même la bibliothèque) : la sauvegarde y est la
 * seule copie hors de ce navigateur. Jamais sauvegardée : on compte depuis la
 * plus ancienne partition (une bibliothèque toute neuve n'a rien à craindre).
 * @param {{ derniere?: string | null, plusAncienne?: string | null, synchronisee?: boolean, surClaude?: boolean, maintenant?: number }} o
 * @returns {string | null}  le rappel, ou null
 */
export function rappelSauvegarde({ derniere = null, plusAncienne = null, synchronisee = false, surClaude = false, maintenant = Date.now() }) {
  if (synchronisee || surClaude) return null;
  const depuis = Date.parse(derniere || plusAncienne || "");
  if (!Number.isFinite(depuis)) return null;
  const jours = Math.floor((maintenant - depuis) / JOUR);
  if (jours <= RAPPEL_JOURS) return null;
  return derniere
    ? `Ta dernière sauvegarde date de ${jours} jours : refais-en une. Sans synchronisation, c'est la seule copie de ta bibliothèque hors de ce navigateur.`
    : "Tu n'as encore jamais sauvegardé ta bibliothèque : fais-le de temps en temps. Sans synchronisation, c'est la seule copie hors de ce navigateur.";
}

/**
 * Les sortes d'éléments de la bibliothèque, leur nom, et s'il est féminin.
 * @type {[string, string, string, boolean][]}
 */
const SORTES = [
  ["idee", "idée", "idées", true],
  ["morceau", "morceau", "morceaux", false],
  ["partition", "partition", "partitions", true],
];

/** La sorte d'une fiche : « idee », « morceau », ou « partition » (une page lue). */
export const sorteDe = (/** @type {any} */ d) => (d && (d.type === "idee" || d.type === "morceau") ? d.type : "partition");

/**
 * « 2 idées, 1 morceau et 3 partitions » : un compte par sorte, pour les
 * messages de la sauvegarde et de la restauration. Ils disaient
 * « partitions » pour tout, idées et morceaux compris (audit de l'interface,
 * B12). `feminin` : rien que des idées et des partitions (« revenues »).
 * @param {{ idee?: number, morceau?: number, partition?: number }} sortes
 * @returns {{ texte: string, total: number, feminin: boolean }}
 */
export function compteParSorte(sortes) {
  const morceaux = [];
  let total = 0, feminin = true;
  for (const [cle, un, plusieurs, fem] of SORTES) {
    const n = Number.isInteger(sortes[cle]) && sortes[cle] > 0 ? sortes[cle] : 0;
    if (!n) continue;
    morceaux.push(`${n} ${n > 1 ? plusieurs : un}`);
    total += n;
    if (!fem) feminin = false;
  }
  const texte = morceaux.length > 1 ? `${morceaux.slice(0, -1).join(", ")} et ${morceaux.at(-1)}` : morceaux[0] || "";
  return { texte, total, feminin };
}

/**
 * « sauvegardées », « revenus » : le participe accordé au compte (le
 * masculin l'emporte dès qu'il y a un morceau).
 * @param {{ total: number, feminin: boolean }} compte
 * @param {string} radical  « sauvegardé », « revenu »
 */
export const accordeA = (compte, radical) => `${radical}${compte.feminin ? "e" : ""}${compte.total > 1 ? "s" : ""}`;
