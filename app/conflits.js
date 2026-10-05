/**
 * LES COPIES DE CONFLIT : GARDER CELLE-CI, LES DEUX, OU L'AUTRE (D4)
 *
 * Quand le texte d'une page lue (son ABC, ses doutes) a changé ici et sur un
 * autre appareil, la synchronisation ne mélange pas les deux : la fiche
 * garde celui d'ici, et celui de l'autre devient une copie à côté,
 * « Valse (version de l'autre appareil) », qui porte `conflitDe`
 * (l'identifiant de l'autre ; synchro.js, lot données). C'est toi qui
 * tranches, depuis le « ••• » de la copie :
 *   - garder celle-ci : elle remplace l'autre, qui va à la corbeille
 *     (30 jours pour la récupérer, sur le site synchronisé) ; elle reprend
 *     le titre sans « (version de l'autre appareil) » ;
 *   - garder les deux : la marque s'en va, les deux restent ;
 *   - garder l'autre : celle-ci va à la corbeille.
 *
 * Tout passe par stockage.modifier et stockage.supprimer : la synchro
 * l'envoie aux autres appareils. Sans DOM : essayé sous Node avec un faux
 * stockage (tests/conflits.test.mjs) ; l'écran est dans versions-ui.js.
 */

/** Ce que la synchro ajoute au titre de la copie (synchro.js, copieDeConflit). */
export const MARQUE_CONFLIT = " (version de l'autre appareil)";

/**
 * La fiche est la version de l'autre appareil d'une partition.
 * @param {any} p
 */
export const estCopieDeConflit = (p) => !!p && typeof p.conflitDe === "string" && p.conflitDe !== "";

/**
 * Le titre sans « (version de l'autre appareil) ».
 * @param {any} titre
 * @returns {string}
 */
export function titreSansMarque(titre) {
  const t = typeof titre === "string" ? titre : "";
  return t.endsWith(MARQUE_CONFLIT) ? t.slice(0, -MARQUE_CONFLIT.length).trim() || t : t;
}

/** @typedef {"celle-ci" | "les-deux" | "l-autre"} Choix */

/**
 * Tranche entre une copie de conflit et l'autre version.
 * @param {Choix} choix
 * @param {any} copie  la fiche de la copie, avec son `id`
 * @param {{ lire: (id: string) => Promise<any>, modifier: (id: string, patch: object) => Promise<void>, supprimer: (id: string, nb?: number) => Promise<void> }} stockage
 * @param {string} [maintenant]
 * @returns {Promise<{ gardee: any, supprimee: any }>}  ce qui reste, et ce qui part (ou null)
 */
export async function trancher(choix, copie, stockage, maintenant = new Date().toISOString()) {
  if (!estCopieDeConflit(copie)) throw new Error("Cette partition n'est pas une version de l'autre appareil.");
  const autre = await stockage.lire(copie.conflitDe);
  if (choix === "l-autre") {
    if (!autre) throw new Error("L'autre version n'est plus dans ta bibliothèque : garde celle-ci.");
    await stockage.supprimer(copie.id, copie.nbPages || 0);
    return { gardee: autre, supprimee: copie };
  }
  if (choix !== "celle-ci" && choix !== "les-deux") throw new Error(`Choix inconnu : ${String(choix)}.`);
  // La marque s'en va d'abord : si la suppression de l'autre échoue ensuite, rien n'est perdu.
  /** @type {Record<string, any>} */
  const patch = { conflitDe: undefined, modifieLe: maintenant };
  if (choix === "celle-ci") patch.titre = titreSansMarque(copie.titre);
  await stockage.modifier(copie.id, patch);
  const gardee = { ...copie, ...patch };
  delete gardee.conflitDe;
  if (choix === "les-deux" || !autre) return { gardee, supprimee: null };
  await stockage.supprimer(autre.id, autre.nbPages || 0);
  return { gardee, supprimee: autre };
}
