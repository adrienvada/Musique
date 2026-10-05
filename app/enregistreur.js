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
 * LA COPIE DE SECOURS. Une page qui se recharge ou se ferme n'a pas le
 * temps d'attendre une écriture d'IndexedDB : Chromium l'abandonne avec la
 * page (essayé : `pagehide` arrive trop tard, et `beforeunload` ne suffit
 * pas toujours quand la machine est chargée). Ce qui attend, ou s'écrit
 * encore, part donc aussi dans une copie de secours, écrite d'un coup dans
 * le stockage local du navigateur (`localStorage`, qui ne fait pas
 * attendre) ; au démarrage suivant, `reprendreSecours` la remet dans la
 * bibliothèque si l'écriture n'a pas eu le temps de finir, puis l'efface.
 *
 * Sans DOM (essayé sous Node, tests/enregistreur.test.mjs) : la page ne
 * sert qu'à se vider quand elle se ferme, si elle existe.
 */

const CLE_SECOURS = "portee:secours";

/** Tous les enregistreurs de la page, pour les vider quand elle se ferme. */
const tous = new Set();
let ecoute = false;

/** Le stockage local du navigateur, s'il y en a un et qu'on a le droit de s'en servir. */
function local() {
  try { return /** @type {any} */ (globalThis).localStorage || null; } catch { return null; }
}

/**
 * Vide tous les enregistreurs. `fermeture` : la page se recharge ou se
 * ferme ; ce qui attend part aussi dans la copie de secours.
 */
export function viderTout({ fermeture = false } = {}) {
  if (fermeture) garderSecours([...tous].flatMap((e) => e.secours()));
  for (const e of tous) e.vider();
}

/** Écrit la copie de secours, d'un coup (sans rien attendre). */
function garderSecours(entrees) {
  const l = local();
  if (!l || !entrees.length) return;
  try { l.setItem(CLE_SECOURS, JSON.stringify(entrees)); } catch { /* stockage local plein ou refusé : l'écriture d'IndexedDB reste */ }
}

function effacerSecours() {
  const l = local();
  try { if (l && l.getItem(CLE_SECOURS) !== null) l.removeItem(CLE_SECOURS); } catch { /* refusé : rien à effacer */ }
}

/**
 * Remet dans la bibliothèque ce que la page d'avant n'a pas eu le temps
 * d'écrire en se fermant, puis efface la copie. Une version déjà là, aussi
 * récente ou plus, gagne : l'écriture avait fini (ou un autre appareil est
 * passé après).
 * @param stockage le stockage ouvert (lire, creer, modifier)
 * @returns {Promise<number>} combien de partitions sont revenues
 */
export async function reprendreSecours(stockage) {
  const l = local();
  let entrees;
  try { entrees = JSON.parse((l && l.getItem(CLE_SECOURS)) || "[]"); } catch { entrees = []; }
  if (!Array.isArray(entrees) || !entrees.length) return 0;
  try { l.removeItem(CLE_SECOURS); } catch { /* déjà effacée */ }
  let revenues = 0;
  for (const x of entrees) {
    if (!x || typeof x.id !== "string" || !x.donnees || typeof x.donnees.modifieLe !== "string") continue;
    try {
      const ici = await stockage.lire(x.id);
      if (!ici) {
        if (!x.creer) continue; // supprimée depuis : on ne la fait pas revenir
        await stockage.creer(x.id, x.donnees, []);
      } else {
        if ((ici.modifieLe || "") >= x.donnees.modifieLe) continue;
        await stockage.modifier(x.id, x.donnees);
      }
      revenues++;
    } catch (e) {
      console.error("Copie de secours", e);
    }
  }
  return revenues;
}

function ecouterLaPage() {
  if (ecoute || typeof globalThis.addEventListener !== "function") return;
  ecoute = true;
  // `visibilitychange` (cachée) : le téléphone change d'appli, et la page peut être
  // tuée sans autre avertissement ; elle vit encore, l'écriture a le temps de finir.
  // `beforeunload` et `pagehide` : la page se recharge ou se ferme ; on écrit aussi la
  // copie de secours. Aucun des deux ne demande rien à Adrien (pas de
  // `preventDefault`), et aucun n'empêche le cache arrière des navigateurs.
  const fermer = () => viderTout({ fermeture: true });
  globalThis.addEventListener("beforeunload", fermer);
  globalThis.addEventListener("pagehide", fermer);
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
 *   secours?: (cible: C, contenu: T) => ({ id: string, donnees: any, creer?: boolean } | null),
 * }} o
 *   ecrire    l'écriture elle-même (l'écran sait comment, et dit lui-même ce qui ne va pas) ;
 *   delai     en millisecondes, après le dernier geste ;
 *   fondre    deux contenus pour la même cible (par défaut, le second complète le premier) ;
 *   surAttente  quelque chose attend d'être écrit (l'écran le montre : « … ») ;
 *   secours   la fiche (ou le changement) à garder dans la copie de secours, daté de
 *             maintenant ; `creer` : elle n'est pas encore dans la bibliothèque.
 */
export function creerEnregistreur({ ecrire, delai = 700, fondre = (a, b) => ({ ...a, ...b }), surAttente = () => {}, secours = null }) {
  /** @type {{ cible: C, contenu: T } | null} */
  let attente = null;
  /** @type {{ cible: C, contenu: T }[]} */
  let enVol = [];
  let minuterie = null;
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
    const ecriture = attente;
    attente = null;
    const lancer = () => { try { return Promise.resolve(ecrire(ecriture.cible, ecriture.contenu)); } catch (e) { return Promise.reject(e); } };
    const suite = enVol.length === 0 ? lancer() : chaine.then(lancer);
    enVol.push(ecriture);
    chaine = suite.catch((e) => console.error("Enregistrement", e)).finally(() => {
      enVol = enVol.filter((x) => x !== ecriture);
      // Tout est écrit, et la page vit encore (une fermeture annulée) : la copie de secours ne sert plus.
      if ([...tous].every((x) => !x.occupe)) effacerSecours();
    });
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
    /**
     * Ce qui attend ou s'écrit encore, pour la copie de secours (la page se
     * ferme) : une entrée par cible, ses contenus fondus dans l'ordre.
     */
    secours() {
      if (!secours) return [];
      const parCible = new Map();
      for (const x of [...enVol, ...(attente ? [attente] : [])]) {
        parCible.set(x.cible, parCible.has(x.cible) ? fondre(parCible.get(x.cible), x.contenu) : x.contenu);
      }
      return [...parCible].map(([cible, contenu]) => secours(cible, contenu)).filter(Boolean);
    },
    /** Quelque chose attend d'être écrit, ou s'écrit. */
    get occupe() { return !!attente || enVol.length > 0; },
    /** La cible de ce qui attend (ou null). */
    get enAttente() { return attente ? attente.cible : null; },
  };
  tous.add(moi);
  ecouterLaPage();
  return moi;
}
