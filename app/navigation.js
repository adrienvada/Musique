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
 *
 * S'ANNONCER (audit du 04/10, I11). L'onglet du navigateur dit l'écran et
 * la partition (« Ma ballade · Corriger · Portée »), comme le titre de
 * l'écran (son h1, caché à l'œil) ; le lecteur d'écran entend l'écran qui
 * s'ouvre. Les messages passagers de l'écran qu'on quitte s'en vont.
 */
import { $, annoncer, couleurDuJeton, retirerMessagesPasses, suivreMessages } from "./ui.js";

const VUES = ["biblio", "atelier", "lecteur", "idee", "morceau"];

/** Le nom de chaque écran (l'accueil prend celui de son onglet). */
const NOMS = { atelier: "Corriger", lecteur: "Écouter et exporter", idee: "Idée", morceau: "Morceau" };

/** Le titre de la partition montrée : chaque écran l'écrit dans sa page. */
function titreDe(vue) {
  if (vue === "atelier") return $("titre").value.trim();
  if (vue === "lecteur") return $("titre-lecteur").textContent.trim();
  if (vue === "idee") return $("idee-titre").value.trim();
  if (vue === "morceau") return $("morceau-titre").value.trim();
  return "";
}

/**
 * Les flèches dans une rangée d'onglets (Clavier, Chanter, Accords ;
 * Corriger, Écouter) : l'onglet d'à côté, comme dans l'accueil (le motif des
 * onglets). Seulement si l'on y est venu au clavier (`auClavier`) : un
 * onglet touché à la souris garde le focus, et ← → y choisissent toujours
 * la note d'à côté. Rend true si la touche a servi.
 */
function flecheOnglet(e, auClavier) {
  const onglet = e.target.closest && e.target.closest('[role="tab"]');
  const rangee = onglet && onglet.closest('[role="tablist"]');
  const sens = { ArrowRight: 1, ArrowLeft: -1, Home: "debut", End: "fin" }[e.key];
  if (!rangee || sens === undefined || e.altKey || e.ctrlKey || e.metaKey || !auClavier) return false;
  const onglets = [...rangee.querySelectorAll('[role="tab"]')].filter((t) => !t.hidden && !t.disabled);
  const i = onglets.indexOf(onglet);
  const cible = sens === "debut" ? onglets[0] : sens === "fin" ? onglets.at(-1) : onglets[(i + sens + onglets.length) % onglets.length];
  if (!cible || cible === onglet) return true;
  cible.click();
  // Corriger ↔ Écouter : la rangée change d'écran avec lui ; le focus la suit.
  cible.focus();
  return true;
}

/**
 * La barre du navigateur (theme-color : le site, l'appli installée) prend la
 * couleur de la barre de l'écran : celle du Studio dans l'éditeur, le papier
 * clair ou sombre ailleurs (audit du 04/10, I3). L'assembleur écrit les deux
 * du Papier, une par réglage du téléphone : on les garde pour y revenir.
 * claude.ai n'en a pas (la page y est un fragment).
 */
function suivreAmbiance() {
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (!metas.length) return;
  const studio = document.body.classList.contains("studio") ? couleurDuJeton("--feuille") : null;
  for (const m of metas) {
    if (!m.dataset.papier) m.dataset.papier = m.getAttribute("content");
    m.setAttribute("content", studio || m.dataset.papier);
  }
}

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
    // Les messages de l'écran qu'on quitte : ils cachaient le haut du suivant.
    if (vue !== nouvelle) retirerMessagesPasses();
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
    suivreAmbiance();
    // (L'écran qui arrive se pose d'un fondu, en CSS : systeme.css, `.vue`. Pas de
    // document.startViewTransition : il change la page un instant plus tard, alors que
    // l'éditeur se mesure et prend ses couleurs juste après montrer().)
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
    // Le titre, une fois l'écran rempli : l'éditeur et le morceau écrivent le leur juste après.
    queueMicrotask(() => titrer({ dire: true }));
  }

  /**
   * L'onglet du navigateur et le titre de l'écran (h1) disent où l'on est ;
   * `dire` : le lecteur d'écran l'entend (un écran qui s'ouvre). Le même
   * écran redessiné (une version reçue d'ailleurs, une suggestion gardée)
   * ne se redit pas.
   */
  let dernierDit = "";
  function titrer({ dire = false } = {}) {
    let nom = NOMS[vue], quoi = "";
    if (vue === "biblio") {
      const onglet = $("onglets-accueil").querySelector('[aria-selected="true"] .libelle');
      nom = onglet ? onglet.textContent.trim() : "Carnet";
    } else quoi = titreDe(vue);
    document.title = [quoi, nom, "Portée"].filter(Boolean).join(" · ");
    const h1 = $(`titre-ecran-${vue}`);
    if (h1) h1.textContent = quoi ? `${nom} « ${quoi} »` : nom;
    const texte = quoi ? `${nom} : « ${quoi} »` : nom;
    if (dire && texte !== dernierDit) annoncer(texte);
    if (dire) dernierDit = texte;
  }

  // Le titre suit aussi ce qui change sans changer d'écran : l'onglet de l'accueil, la
  // partition renommée ici (les champs de titre) ou ailleurs (#fil-titre, que l'appli
  // réécrit pour l'idée : un titre proposé par Claude, une autre version reçue).
  suivreMessages();
  if (typeof MutationObserver === "function") {
    const retitrer = () => titrer();
    new MutationObserver(retitrer).observe($("onglets-accueil"), { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
    new MutationObserver(retitrer).observe($("fil-titre"), { childList: true, characterData: true, subtree: true });
  }
  for (const id of ["titre", "idee-titre", "morceau-titre"]) $(id).addEventListener("change", () => titrer());
  titrer();

  // Comment le focus est arrivé où il est : au clavier (Tab), ou d'un toucher ou d'un clic.
  // `:focus-visible` ne le dit pas : Chromium le passe à vrai dès qu'une touche est
  // pressée, avant qu'on la lise (essayé).
  let focusAuClavier = false;
  document.addEventListener("pointerdown", () => { focusAuClavier = false; }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Tab") focusAuClavier = true; }, true);

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
    // Une flèche sur un onglet est à la rangée d'onglets (l'accueil a déjà la sienne : defaultPrevented).
    if (!e.defaultPrevented && flecheOnglet(e, focusAuClavier)) { e.preventDefault(); return; }
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
    // Celle du dessus d'abord. Une question (#dialogue) s'ouvre toujours par-dessus la
    // feuille qui la pose, même quand celle-ci vient après elle dans la page (les
    // versions et la corbeille sont posées à la fin, versions-ui.js) : l'ordre de la
    // page fermait la feuille et laissait la question ouverte. Sur Android, le geste
    // retour ferme déjà le <dialog> du dessus sans passer par ici (le navigateur le
    // compte comme une demande de fermeture, sans toucher à l'historique) : rien ne
    // se ferme deux fois.
    if (feuilles.length) { (document.querySelector("#dialogue[open]") || feuilles.at(-1)).close(); return; }
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
