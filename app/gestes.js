/**
 * LES GESTES SUR UNE PARTITION ENTIÈRE : SUPPRIMER, DUPLIQUER, AJOUTER À UN MORCEAU
 *
 * Ce qu'on fait d'une partition depuis l'écran qui la montre : la page lue
 * qu'on supprime depuis « Corriger » ou « Écouter », et le menu « ••• » de
 * l'éditeur d'idée (télécharger, dupliquer, supprimer, ajouter à un
 * morceau, MusicXML). Chaque échec se dit, en français (erreurs.js) : avant,
 * supprimer, dupliquer ou ajouter à un morceau pouvait échouer sans un mot
 * (audit du 04/10, T4).
 *
 * Ils vivaient dans app.js (T3), qui ne fait plus que composer.
 */
import { $, pluriel, toast } from "./ui.js";
import { dialogue, veutSupprimer } from "./dialogue.js";
import { explication } from "./erreurs.js";

/**
 * @param deps {
 *   stockage() → le stockage ouvert, partitions() → la bibliothèque,
 *   nouvelId(), pageOuverte (page-ouverte.js), editeur() → l'éditeur d'idée,
 *   vueMorceau() → l'écran du morceau, ouvrir(id) (une partition, dans son
 *   écran), ouvrirMorceau(p), montrer(vue), exports (exports.js),
 *   versions() → les versions précédentes (versions-ui.js)
 * }
 */
export function creerGestes(deps) {
  /** Supprime `p` de la bibliothèque (et des autres appareils, par la synchro). Rend true si c'est fait. */
  async function supprimerDeLaBibliotheque(p) {
    const e = p.type === "morceau" ? "" : "e";
    try {
      await deps.stockage().supprimer(p.id, p.type ? 0 : p.nbPages || 0);
    } catch (err) {
      console.error(err);
      toast(`« ${p.titre} » n'a pas pu être supprimé${e} : ${explication(err)}`, 7000);
      return false;
    }
    toast(`« ${p.titre} » est supprimé${e}.`);
    return true;
  }

  /** Supprime la page ouverte, après la même question que depuis le carnet (dialogue.js). */
  async function supprimerOuverte() {
    const { pageOuverte } = deps;
    const p = pageOuverte.partition;
    if (!p || !(await veutSupprimer(p, deps.partitions()))) return;
    try {
      await pageOuverte.vider();
      await deps.stockage().supprimer(p.id, p.nbPages || 0);
    } catch (e) {
      console.error(e);
      toast(`« ${p.titre} » n'a pas pu être supprimée : ${explication(e)}`, 7000);
      return;
    }
    if (pageOuverte.partition === p) pageOuverte.fermer();
    toast(`« ${p.titre} » est supprimée.`);
    deps.montrer("biblio");
  }

  /** Une copie de l'idée, qu'on ouvre aussitôt. */
  async function dupliquer(p) {
    const id = deps.nouvelId();
    const maintenant = new Date().toISOString();
    const { id: _ancien, ...donnees } = p;
    try {
      await deps.stockage().creer(id, { ...donnees, titre: `${p.titre} (copie)`, creeLe: maintenant, modifieLe: maintenant }, []);
    } catch (e) {
      console.error(e);
      toast(`La copie n'a pas pu se faire : ${explication(e)}`, 7000);
      return;
    }
    toast("Copie faite : tu y es.");
    await deps.ouvrir(id);
  }

  /** « Ajouter à un morceau » : un morceau existant, ou un nouveau. */
  async function choisirMorceau(p) {
    const morceaux = deps.partitions().filter((x) => x.type === "morceau");
    const choix = await dialogue("Ajouter à un morceau", `« ${p.titre} » devient un bloc du morceau choisi.`, [
      { valeur: "nouveau", texte: "Un nouveau morceau", icone: "plus", plein: true },
      ...morceaux.map((x) => ({ valeur: x.id, texte: `${x.titre} (${pluriel((x.blocs || []).length, "bloc")})` })),
    ]);
    if (!choix) return;
    let morceau = null;
    try {
      if (choix !== "nouveau") morceau = await deps.stockage().lire(choix);
    } catch (e) {
      console.error(e);
      toast(`Ce morceau ne s'ouvre pas : ${explication(e)}`, 7000);
      return;
    }
    await deps.editeur().fermer();
    deps.ouvrirMorceau(morceau);
    deps.vueMorceau().ajouter(p.id);
    $("morceau-choix").hidden = true;
  }

  /** Ce que le menu « ••• » de l'éditeur d'idée demande. */
  async function actionIdee(action, p) {
    switch (action) {
      case "telecharger-midi": return deps.exports.exporterMidi(p);
      case "dupliquer": return dupliquer(p);
      case "supprimer": {
        if (!(await veutSupprimer(p, deps.partitions()))) return undefined;
        await deps.editeur().fermer();
        await supprimerDeLaBibliotheque(p);
        return deps.montrer("biblio");
      }
      case "morceau": return choisirMorceau(p);
      case "musicxml": return deps.exports.exporterMusicXml(p);
      // Les versions que garde la bibliothèque commune (D6, versions-ui.js).
      case "versions": return deps.versions().ouvrirVersions(p);
      default:
        toast("Bientôt.");
        return undefined;
    }
  }

  return { actionIdee, supprimerOuverte, supprimerDeLaBibliotheque };
}
