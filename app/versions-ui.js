/**
 * LES AUTRES VERSIONS D'UNE PARTITION, VUES DE L'APPLI
 *
 * Ce qu'on fait depuis le « ••• » d'une ligne ou d'une carte quand une
 * partition a plusieurs versions : la copie de conflit qu'a rangée la
 * synchronisation (D4 : garder celle-ci, les deux, ou l'autre ; la logique
 * est dans conflits.js).
 *
 * Les questions passent par dialogue.js, les erreurs par erreurs.js ; ce qui
 * écrit passe par le stockage (stockage.modifier, stockage.supprimer), et la
 * synchronisation l'emporte vers les autres appareils.
 */
import { MARQUE_CONFLIT, trancher } from "./conflits.js";
import { confirmer } from "./dialogue.js";
import { explication } from "./erreurs.js";
import { toast } from "./ui.js";

/**
 * @param deps {
 *   stockage() → le stockage ouvert, partitions() → la bibliothèque,
 *   synchronisee() → la synchronisation est branchée (ce qui part va à la corbeille de la bibliothèque commune)
 * }
 */
export function creerVersions(deps) {
  /** Ce qui part va à la corbeille (30 jours) avec la synchronisation ; sans elle, pour de bon. */
  const ouVa = () => (deps.synchronisee() ? "à la corbeille : tu pourras la récupérer pendant 30 jours (Réglages, Corbeille)" : "pour de bon");

  /** L'autre version d'une copie de conflit, si elle est encore là. */
  const autreDe = (copie) => deps.partitions().find((x) => x.id === copie.conflitDe) || null;

  /**
   * Trancher entre une copie de conflit et l'autre version (D4). « Garder
   * celle-ci » et « Garder l'autre » font partir une version : on demande ;
   * « Garder les deux » ne défait rien, on le fait tout de suite.
   * @param {"celle-ci" | "les-deux" | "l-autre"} choix
   */
  async function trancherConflit(choix, copie) {
    const autre = autreDe(copie);
    const titre = copie.titre.endsWith(MARQUE_CONFLIT) ? copie.titre.slice(0, -MARQUE_CONFLIT.length) : copie.titre;
    if (choix === "celle-ci") {
      const texte = autre ? `Elle remplace l'autre version, qui part ${ouVa()}.` : "L'autre version n'est plus là : celle-ci reste, sans la marque.";
      if (!(await confirmer({ titre: `Garder cette version de « ${titre} » ?`, texte, oui: "Garder celle-ci", danger: false }))) return;
    } else if (choix === "l-autre") {
      if (!(await confirmer({ titre: `Garder l'autre version de « ${titre} » ?`, texte: `Celle-ci part ${ouVa()}.`, oui: "Garder l'autre", danger: false }))) return;
    }
    try {
      await trancher(choix, copie, deps.stockage());
    } catch (e) {
      console.error(e);
      toast(`Rien n'a changé : ${explication(e)}`, 7000);
      return;
    }
    toast(choix === "les-deux" ? `Les deux versions de « ${titre} » restent.`
      : choix === "celle-ci" ? `« ${titre} » : cette version est gardée.`
        : `« ${titre} » : l'autre version est gardée.`);
  }

  return { trancherConflit, autreDe };
}
