/**
 * LA BIBLIOTHÈQUE SYNCHRONISÉE, CÔTÉ CONNECTEUR
 *
 * Chaque appareil garde toute la bibliothèque dans son navigateur (hors
 * ligne compris) ; le connecteur en garde la référence commune, en objets
 * JSON dans le stockage Supabase :
 *   bibliotheque/<id>.json   { id, donnees, modifieLe, supprime, pagesLe }
 *   pages/<id>.json          les traits, compactés (lourds : à part)
 *
 * Règle : le plus récent gagne (modifieLe, écrit par l'appareil qui a fait
 * la modification). Une partition supprimée laisse une « pierre tombale »
 * (supprime: true) pour que les autres appareils la suppriment aussi.
 *
 * Un appareil demande « ce qui a changé depuis mon curseur » : le curseur
 * est la date d'écriture du stockage (son horloge, pas celle des appareils).
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/; // ni « / » ni « .. » : l'id devient un nom de fichier
const PARALLELE = 12;

export class Bibliotheque {
  constructor(objets) {
    this.objets = objets;
  }

  /** Les fiches écrites après `depuis` (toutes si absent), et le nouveau curseur. */
  async changements(depuis = null) {
    const liste = await this.objets.lister("bibliotheque");
    const curseur = liste.reduce((m, o) => (o.maj > m ? o.maj : m), depuis || "");
    const nouvelles = liste.filter((o) => !depuis || o.maj > depuis);
    const fiches = await enParallele(nouvelles, (o) => this.objets.lire(`bibliotheque/${o.nom}`));
    return { partitions: fiches.filter(Boolean), curseur: curseur || null };
  }

  async pages(id) {
    verifierId(id);
    return (await this.objets.lire(`pages/${id}.json`)) || [];
  }

  /**
   * Écrit une partition (ou sa suppression). Refusé si la référence a déjà
   * plus récent : l'appareil reçoit alors la version gagnante.
   */
  async ecrire({ id, donnees = null, pages = null, supprime = false, modifieLe }) {
    verifierId(id);
    if (typeof modifieLe !== "string" || !modifieLe) throw new Error("Il faut la date de modification (modifieLe).");
    if (!supprime && (!donnees || typeof donnees !== "object")) throw new Error("Il faut les données de la partition.");
    const actuelle = await this.objets.lire(`bibliotheque/${id}.json`);
    if (actuelle && actuelle.modifieLe > modifieLe) return { accepte: false, actuelle };
    if (supprime) {
      await this.objets.supprimer(`pages/${id}.json`);
    } else if (pages) {
      await this.objets.ecrire(`pages/${id}.json`, pages);
    }
    const fiche = {
      id,
      donnees: supprime ? null : donnees,
      modifieLe,
      supprime: !!supprime,
      pagesLe: supprime ? null : pages ? modifieLe : (actuelle && actuelle.pagesLe) || null,
    };
    await this.objets.ecrire(`bibliotheque/${id}.json`, fiche);
    return { accepte: true, fiche };
  }
}

function verifierId(id) {
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Identifiant de partition invalide.");
}

async function enParallele(liste, f) {
  const sortie = new Array(liste.length);
  let suivant = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLELE, liste.length) }, async () => {
    while (suivant < liste.length) {
      const i = suivant++;
      sortie[i] = await f(liste[i], i);
    }
  }));
  return sortie;
}
