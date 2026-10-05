/**
 * LA NAVIGATION ENTRE LES ÉCRANS, ET LE BOUTON « PRÉCÉDENT »
 *
 * Cinq écrans : l'accueil (`biblio`), « Corriger » (`atelier`), « Écouter
 * et exporter » (`lecteur`), l'éditeur d'idée (`idee`) et le morceau
 * (`morceau`). Un seul se montre à la fois.
 *
 * Un écran peut en ouvrir un autre (l'idée d'un bloc de morceau,
 * « Continuer en idée » depuis une page lue, une idée tirée d'une
 * phrase…) : on retient celui qu'on quitte, et revenir en arrière y
 * ramène, au lieu de sauter à l'accueil. L'accueil vide la pile.
 *
 * LE REGISTRE DES ÉCRANS. Chaque écran dit lui-même comment on le quitte
 * (`fermer` : il arrête son son, fait partir ce qui attendait d'être
 * enregistré), comment il se dessine (`afficher`, s'il se dessine en
 * arrivant), s'il a encore un pas à défaire avant qu'on le quitte
 * (`reculer` → true : une note choisie, le jeu en direct, un panneau
 * ouvert), s'il est à sa racine (`aLaRacine`, l'accueil seulement), et,
 * s'il montre une partition, laquelle (`partition`), et ses raccourcis
 * (`toucheBas`, `toucheHaut` → true si la touche a servi). Avant,
 * « précédent » cliquait les boutons des autres écrans et lisait leur page
 * (audit du 04/10, T3). Un calque qui n'est pas un <dialog> se déclare dans
 * le `reculer` et l'`aLaRacine` de son écran ; les <dialog> ouverts se
 * ferment avant tout.
 */
import { $ } from "./ui.js";

const VUES = ["biblio", "atelier", "lecteur", "idee", "morceau"];

/**
 * @param deps {
 *   ecrans() → le registre (nom → écran),
 *   lire(id) → la fiche d'une partition (ou null),
 *   rouvrir(p, vue) (revenir à un écran d'avant : la partition dans son écran),
 *   arreterLeSon() (ce qui joue s'arrête quand on change d'écran),
 *   studio() → l'ambiance Studio est choisie pour l'éditeur
 * }
 */
export function creerNavigation(deps) {
  let vue = "biblio";
  let pile = []; // les écrans d'où l'on vient (hors accueil) : { vue, id }
  let enRetour = false;
  const ecrans = () => deps.ecrans();

  /** Montre un écran (et quitte celui d'avant, qui fait partir ses enregistrements). */
  function montrer(nouvelle) {
    if (nouvelle === "biblio") pile = [];
    if (vue !== nouvelle) ecrans()[vue].fermer();
    deps.arreterLeSon();
    vue = nouvelle;
    for (const v of VUES) $(`vue-${v}`).hidden = v !== nouvelle;
    const dansPartition = nouvelle !== "biblio";
    // L'écran Idée prend toute la hauteur : le clavier sous le pouce.
    document.body.classList.toggle("plein", nouvelle === "idee");
    // L'écran ouvert, pour les règles qui en dépendent (où tombent les messages…).
    document.body.dataset.vue = nouvelle;
    // Papier pour lire, Studio pour jouer : l'éditeur passe en sombre (sauf réglage contraire).
    document.body.classList.toggle("studio", nouvelle === "idee" && deps.studio());
    // La barre de Portée ne sert qu'à l'accueil : un écran qui a sa propre barre
    // (avec son retour, [data-retour]) la remplace ; les autres la gardent.
    document.querySelector(".barre-haut").hidden = nouvelle !== "biblio" && !!$(`vue-${nouvelle}`).querySelector("[data-retour]");
    // Les onglets, la recherche et la synchro sont ceux de l'accueil : ailleurs, la
    // barre (quand elle reste) ne garde que son retour, et ne couvre pas le clavier.
    for (const id of ["onglets-accueil", "chercher", "etat-synchro"]) $(id).hidden = nouvelle !== "biblio";
    $("fil").hidden = !dansPartition || nouvelle === "idee" || nouvelle === "morceau";
    // Corriger ↔ Écouter : les onglets vivent dans la barre de l'écran de partition (atelier.js).
    $("onglet-atelier").setAttribute("aria-selected", String(nouvelle === "atelier"));
    $("onglet-lecteur").setAttribute("aria-selected", String(nouvelle === "lecteur"));
    const ecran = ecrans()[nouvelle];
    if (ecran.afficher) ecran.afficher();
    window.scrollTo({ top: 0 });
  }

  /** Retient l'écran qu'on quitte pour un autre (pas l'accueil), pour y revenir. */
  function retenir() {
    if (enRetour || vue === "biblio") return;
    const id = ecrans()[vue].partition();
    if (!id) return; // pas encore enregistré (une idée encore vide) : rien où revenir
    const dernier = pile.at(-1);
    if (dernier && dernier.id === id) { dernier.vue = vue; return; }
    pile.push({ vue, id });
  }

  /** Un écran en arrière : celui d'où l'on venait, sinon l'accueil. */
  async function revenir() {
    enRetour = true;
    try {
      while (pile.length) {
        const { vue: avant, id } = pile.pop();
        const p = await deps.lire(id).catch(() => null);
        if (!p) continue; // supprimée entre-temps : on remonte encore
        await deps.rouvrir(p, avant);
        return;
      }
      montrer("biblio");
    } finally { enRetour = false; }
  }

  /** L'appli est à sa racine : le carnet, rien d'ouvert par-dessus. */
  function aLaRacine() {
    return vue === "biblio" && !document.querySelector("dialog[open]") && ecrans().biblio.aLaRacine();
  }

  /**
   * Les raccourcis de l'écran montré. Une fenêtre ou une feuille ouverte
   * garde les touches pour elle : avant, Suppr effaçait la note derrière la
   * feuille « ••• », ↑ la montait, et Échap retirait la sélection au lieu de
   * fermer la fenêtre (audit du 04/10, I6). Échap, laissé au navigateur,
   * ferme le <dialog>. Un champ de texte garde aussi les siennes.
   */
  function toucheBas(e) {
    if (document.querySelector("dialog[open]")) return;
    const cible = e.target;
    if (cible.closest && cible.closest("input, textarea, select, [contenteditable]")) return;
    const ecran = ecrans()[vue];
    if (ecran.toucheBas && ecran.toucheBas(e)) e.preventDefault();
  }

  /** Une touche relâchée (le clavier de l'ordinateur joue tant qu'on appuie). */
  function toucheHaut(e) {
    const ecran = ecrans()[vue];
    if (ecran.toucheHaut && ecran.toucheHaut(e)) e.preventDefault();
  }

  /** Un pas en arrière, du plus proche au plus lointain : ce qui est ouvert par-dessus, l'écran, puis l'écran d'avant. */
  function reculer() {
    const feuilles = [...document.querySelectorAll("dialog[open]")];
    if (feuilles.length) { feuilles.at(-1).close(); return; }
    if (ecrans()[vue].reculer()) return;
    if (vue !== "biblio") revenir();
  }

  return {
    montrer, retenir, revenir, aLaRacine, reculer, toucheBas, toucheHaut,
    /** L'écran montré. */
    get vue() { return vue; },
    /** L'écran montré, s'il montre une partition (pour la synchronisation). */
    partitionOuverte: () => (ecrans()[vue].partition ? ecrans()[vue] : null),
  };
}
