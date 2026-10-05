/**
 * L'ENREGISTREMENT DIFFÉRÉ, COMMUN À TOUS LES ÉCRANS
 *
 * Chaque écran enregistre un instant après le dernier geste : dix notes
 * tapées vite ne font qu'une écriture. Il y en avait trois façons
 * (« Corriger », l'éditeur d'idée, le morceau), avec deux défauts que
 * l'audit du 04/10 a reproduits au navigateur (T4) :
 *   - la minuterie de « Corriger » lisait la partition ouverte et le texte
 *     ABC au moment où elle partait, pas au moment du geste : revenir à la
 *     bibliothèque et ouvrir une autre partition dans les 800 ms perdait la
 *     correction, et réécrivait l'autre partition ;
 *   - rien n'écrivait quand la page se fermait : une idée rechargée moins de
 *     0,7 s après sa dernière note était perdue.
 *
 * Ici, ce qui sera écrit est fixé quand on le planifie : la cible (la
 * partition) et son contenu, que l'écran copie à ce moment-là. Deux
 * contenus pour la même cible se fondent (le tempo, puis la
 * transposition) ; une autre cible fait d'abord partir ce qui attendait.
 * `vider()` écrit tout de suite ce qui attend : les écrans vident en
 * quittant, en ouvrant une autre partition ; et tous les enregistreurs se
 * vident quand la page passe en arrière-plan, se recharge ou se ferme
 * (`visibilitychange`, `beforeunload`, `pagehide`). Les écritures se
 * suivent, jamais deux à la fois.
 *
 * Sans DOM (essayé sous Node, tests/enregistreur.test.mjs) : la page ne
 * sert qu'à se vider quand elle se ferme, si elle existe.
 */

/** Tous les enregistreurs de la page, pour les vider quand elle se ferme. */
const tous = new Set();
let ecoute = false;

/** Vide tous les enregistreurs : la page part en arrière-plan, ou se ferme. */
export function viderTout() {
  for (const e of tous) e.vider();
}

function ecouterLaPage() {
  if (ecoute || typeof globalThis.addEventListener !== "function") return;
  ecoute = true;
  // `visibilitychange` (cachée) : le téléphone change d'appli, et la page peut être
  // tuée sans autre avertissement ; elle vit encore, l'écriture a le temps de finir.
  // `beforeunload` : la page va se recharger ou se fermer. `pagehide` seul arrive trop
  // tard : Chromium abandonne alors la transaction IndexedDB avec la page (essayé :
  // l'idée rechargée aussitôt était perdue) ; `beforeunload` part au début de la
  // navigation et lui en laisse le temps. Aucun des deux ne demande rien à Adrien
  // (pas de `preventDefault`), et aucun n'empêche le cache arrière des navigateurs.
  globalThis.addEventListener("beforeunload", viderTout);
  globalThis.addEventListener("pagehide", viderTout);
  const doc = /** @type {any} */ (globalThis).document;
  if (doc) doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "hidden") viderTout(); });
}

/**
 * @template C, T
 * @param {{
 *   ecrire: (cible: C, contenu: T) => (Promise<any> | void),
 *   delai?: number,
 *   fondre?: (avant: T, apres: T) => T,
 *   surAttente?: (cible: C) => void,
 * }} o
 *   ecrire    l'écriture elle-même (l'écran sait comment, et dit lui-même ce qui ne va pas) ;
 *   delai     en millisecondes, après le dernier geste ;
 *   fondre    deux contenus pour la même cible (par défaut, le second complète le premier) ;
 *   surAttente  quelque chose attend d'être écrit (l'écran le montre : « … »).
 */
export function creerEnregistreur({ ecrire, delai = 700, fondre = (a, b) => ({ ...a, ...b }), surAttente = () => {} }) {
  /** @type {{ cible: C, contenu: T } | null} */
  let attente = null;
  let minuterie = null;
  let enVol = 0;
  /** @type {Promise<void>} */
  let chaine = Promise.resolve();

  /**
   * Fait partir ce qui attend, à la suite des écritures en cours. Sans
   * écriture en cours, elle part tout de suite, dans le même geste : quand
   * la page se ferme, il ne reste peut-être pas d'autre tour.
   */
  function partir() {
    clearTimeout(minuterie);
    minuterie = null;
    if (!attente) return chaine;
    const { cible, contenu } = attente;
    attente = null;
    const lancer = () => { try { return Promise.resolve(ecrire(cible, contenu)); } catch (e) { return Promise.reject(e); } };
    const suite = enVol === 0 ? lancer() : chaine.then(lancer);
    enVol++;
    chaine = suite.catch((e) => console.error("Enregistrement", e)).finally(() => { enVol--; });
    return chaine;
  }

  const moi = {
    /**
     * Écrira `contenu` dans `cible`, `d` millisecondes après le dernier appel.
     * @param {C} cible
     * @param {T} contenu  fixé maintenant : l'écran en donne une copie
     * @param {number} [d]
     */
    planifier(cible, contenu, d = delai) {
      if (attente && attente.cible !== cible) partir();
      attente = attente ? { cible, contenu: fondre(attente.contenu, contenu) } : { cible, contenu };
      clearTimeout(minuterie);
      surAttente(cible);
      if (d <= 0) { partir(); return; }
      minuterie = setTimeout(partir, d);
    },
    /** Écrit tout de suite ce qui attend, et rend la promesse de toutes les écritures. */
    vider: () => partir(),
    /** Oublie ce qui attend, sans l'écrire (la partition vient d'être supprimée). */
    oublier() {
      clearTimeout(minuterie);
      minuterie = null;
      attente = null;
    },
    /** Quelque chose attend d'être écrit, ou s'écrit. */
    get occupe() { return !!attente || enVol > 0; },
    /** La cible de ce qui attend (ou null). */
    get enAttente() { return attente ? attente.cible : null; },
  };
  tous.add(moi);
  ecouterLaPage();
  return moi;
}
