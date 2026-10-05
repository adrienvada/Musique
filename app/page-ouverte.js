/**
 * LA PAGE LUE OUVERTE, QUE « CORRIGER » ET « ÉCOUTER » PARTAGENT
 *
 * La partition (sa fiche), ses traits page par page, et ses enregistrements.
 * Un changement (`changer`) vaut tout de suite pour la fiche en mémoire :
 * l'autre écran, les exports et la synchronisation voient la dernière
 * correction ; il part dans le stockage un instant après (enregistreur.js),
 * avec la copie prise au moment du geste et pour la page de ce moment-là.
 *
 * Avant (audit du 04/10, T4), la minuterie de « Corriger » lisait la
 * partition ouverte et le texte ABC au moment où elle partait : revenir à la
 * bibliothèque et ouvrir une autre partition dans les 800 ms perdait la
 * correction et réécrivait l'autre partition. Le tempo d'« Écouter » avait
 * la même minuterie. Ouvrir une autre page, ou quitter l'un des deux
 * écrans, vide maintenant ce qui attendait.
 *
 * Sans DOM : l'écran montre l'état des enregistrements par `surEtat`.
 */
import { creerEnregistreur } from "./enregistreur.js";

/**
 * @param {{ stockage: () => any, surEtat?: (etat: "attente" | "ok" | "erreur", erreur?: any) => void }} deps
 */
export function creerPageOuverte({ stockage, surEtat = () => {} }) {
  let partition = null;
  /** @type {any[][]} */
  let pages = [];

  /** Écrit un changement de `p` : sa date (toujours plus récente, le stockage y veille), puis la fiche. */
  async function ecrire(p, patch) {
    const complet = { ...patch, modifieLe: new Date().toISOString() };
    p.modifieLe = complet.modifieLe;
    try {
      await stockage().modifier(p.id, complet);
      if (p === partition) surEtat("ok");
    } catch (e) {
      console.error(e);
      if (p === partition) surEtat("erreur", e);
    }
  }
  const ecritures = creerEnregistreur({
    ecrire, delai: 800,
    surAttente: (p) => { if (p === partition) surEtat("attente"); },
    // La page se ferme avant l'écriture : le changement part dans la copie de secours.
    secours: (p, patch) => ({ id: p.id, donnees: { ...patch, modifieLe: new Date().toISOString() } }),
  });

  return {
    /** La fiche de la page ouverte (ou null). */
    get partition() { return partition; },
    /** Ses traits, page par page. */
    get pages() { return pages; },
    /** Une autre page s'ouvre (ou la même, rechargée) : ce qui attendait pour l'autre part d'abord. */
    ouvrir(p, traits = []) {
      if (p !== partition) ecritures.vider();
      partition = p;
      pages = traits;
    },
    /** Plus de page ouverte (supprimée) : ce qui attendait pour elle ne part pas. */
    fermer() {
      ecritures.oublier();
      partition = null;
      pages = [];
    },
    /**
     * Change la page : tout de suite en mémoire, dans `delai` ms dans le stockage.
     * @param {object} patch  les champs qui changent (copiés : la suite des gestes ne les touche plus)
     * @param {{ delai?: number, p?: any }} [o]  `p` : une autre fiche que la page ouverte (celle d'un geste en cours)
     */
    changer(patch, { delai = 0, p = partition } = {}) {
      if (!p) return;
      Object.assign(p, patch);
      ecritures.planifier(p, structuredClone(patch), delai);
    },
    /** Écrit tout de suite ce qui attend ; rend la promesse de toutes les écritures. */
    vider: () => ecritures.vider(),
    /** Une écriture attend ou part. */
    get occupe() { return ecritures.occupe; },
  };
}
