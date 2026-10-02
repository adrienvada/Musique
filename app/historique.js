/**
 * LE BOUTON « PRÉCÉDENT »
 *
 * Portée est une seule page : sans rien faire, le bouton précédent du
 * téléphone (ou du navigateur, ou le geste de retour) quittait l'appli au lieu
 * de fermer la feuille ouverte ou de revenir à l'écran d'avant.
 *
 * Plutôt qu'une entrée d'historique par écran et par feuille (qu'il faudrait
 * garder en phase avec tout ce qui s'ouvre et se ferme d'un toucher, d'une
 * touche Échap ou d'un geste), une seule entrée « de garde » se pose au-dessus
 * de l'accueil dès que l'appli n'est plus à sa racine. Un « précédent » la
 * consomme : l'appli recule alors d'un pas (fermer la feuille, quitter la
 * sélection, revenir à l'écran d'avant…), et remet la garde si elle n'est
 * toujours pas à sa racine. À la racine, plus de garde : le « précédent »
 * suivant quitte Portée, comme partout ailleurs.
 *
 * L'appli dit où est sa racine (`racine()`) et comment reculer d'un pas
 * (`reculer()`). Ce module surveille ce qui s'ouvre et se ferme (feuilles,
 * menus, écrans, onglets) pour poser ou retirer la garde au bon moment.
 */
export function creerHistorique({ racine, reculer }) {
  let actif = true;
  let enRetrait = 0; // nos propres retraits de garde, dont on ignore le popstate
  const surGarde = () => !!(history.state && history.state.portee === "garde");

  try {
    if (!history.state || !history.state.portee) history.replaceState({ portee: "base" }, "");
  } catch { actif = false; } // une page sans historique utilisable (cadre très fermé) : on fait sans

  /** Pose la garde si l'appli a quitté sa racine ; la retire si elle y est revenue. */
  function synchroniser() {
    if (!actif || enRetrait) return;
    const aLaRacine = racine();
    try {
      if (!aLaRacine && !surGarde()) history.pushState({ portee: "garde" }, "");
      else if (aLaRacine && surGarde()) { enRetrait++; history.back(); }
    } catch { actif = false; }
  }

  addEventListener("popstate", () => {
    if (!actif) return;
    if (enRetrait) { enRetrait--; synchroniser(); return; }
    // Revenus sous la garde : c'est un « précédent ». (Un « suivant » qui
    // ramène sur la garde n'a rien à faire.)
    if (!surGarde() && !racine()) reculer();
    synchroniser();
  });

  // Ce qui s'ouvre et se ferme : feuilles (<dialog open>), menus et écrans
  // (hidden), onglets (aria-selected). Un seul passage par tour, en fin de tâche.
  let prevu = false;
  new MutationObserver(() => {
    if (prevu) return;
    prevu = true;
    queueMicrotask(() => { prevu = false; synchroniser(); });
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open", "hidden", "aria-selected", "aria-pressed"] });

  return { synchroniser };
}
