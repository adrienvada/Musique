/**
 * PETITS OUTILS DE L'INTERFACE
 *
 * Ce que chaque écran redéfinissait chez lui (audit du 04/10, T3) : `$` et
 * `el` pour la page, `pluriel` et `accorde` pour les nombres, les dates
 * dites au plus court, et le message passager (`toast`).
 *
 * `echapper` : tout texte qui entre dans du HTML écrit en chaîne (innerHTML,
 * attributs) passe par elle. Un titre, une étiquette, un nom d'accord ou de
 * piste viennent d'Adrien, mais aussi d'une sauvegarde restaurée ou de la
 * synchro : non échappés, ils pouvaient exécuter du code dans la page et lire
 * l'adresse du connecteur (audit du 04/10, S1). Le texte posé avec
 * `textContent` n'en a pas besoin.
 *
 * Ce module se lit aussi sans page (les tests sous Node, `npm run types`) :
 * il ne touche au document qu'au moment où on l'appelle.
 */
const ENTITES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Le texte, prêt à entrer dans du HTML (contenu ou valeur d'attribut entre guillemets). */
export const echapper = (texte) => String(texte ?? "").replace(/[&<>"']/g, (c) => ENTITES[c]);

/** La page. Par `globalThis` : sous Node et pour la vérification des types, il n'y en a pas. */
const page = () => /** @type {any} */ (globalThis).document;

/** L'élément de la page qui porte cet identifiant. */
export const $ = (id) => page().getElementById(id);

/**
 * Un élément neuf, avec sa classe et son texte.
 * @param {string} tag
 * @param {string} [classe]
 * @param {string | null} [texte]
 */
export function el(tag, classe = "", texte = null) {
  const e = page().createElement(tag);
  if (classe) e.className = classe;
  if (texte !== null && texte !== undefined) e.textContent = texte;
  return e;
}

/**
 * La couleur d'un jeton (« --stylo ») telle qu'elle s'affiche ici, pour qui
 * colore lui-même (abcjs, la note choisie). Un jeton s'écrit
 * light-dark(clair, sombre) (systeme.css, T5) : sa valeur brute n'est pas
 * une couleur, seul son emploi la résout. On la fait donc employer.
 * @param {string} nom
 * @param {string} secours  si la page n'est pas là
 */
export function couleurDuJeton(nom, secours) {
  const corps = page() && page().body;
  if (!corps) return secours;
  const sonde = el("span");
  sonde.style.color = `var(${nom})`;
  corps.appendChild(sonde);
  const couleur = /** @type {any} */ (globalThis).getComputedStyle(sonde).color;
  sonde.remove();
  return couleur || secours;
}

/**
 * « 1 note », « 3 notes », « 2 morceaux » : le nombre et son nom, accordé
 * (le pluriel au-delà de 1, comme chaque écran le faisait chez lui).
 * @param {number} n
 * @param {string} mot
 * @param {string} [motPluriel]
 */
export const pluriel = (n, mot, motPluriel = `${mot}s`) => `${n} ${accorde(n, mot, motPluriel)}`;

/**
 * Le mot seul, accordé au nombre : « jouée » ou « jouées ».
 * @param {number} n
 * @param {string} mot
 * @param {string} [motPluriel]
 */
export const accorde = (n, mot, motPluriel = `${mot}s`) => (n > 1 ? motPluriel : mot);

/** « 14:03 ». */
export const heure = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** « 5 oct., 14:03 » : une date de la bibliothèque, dite court. */
export function dateCourte(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + ", " + heure(iso);
}

/**
 * « il y a 2 min », « il y a 3 h », « le 30 sept. » : quand une page a été lue.
 * @param {string} iso
 * @param {number} [maintenant]
 */
export function dateRelative(iso, maintenant = Date.now()) {
  const t = Date.parse(iso);
  if (!t) return "";
  const s = (maintenant - t) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `le ${new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
}

// ------------------------------------------------------------------------
// Le message passager
// ------------------------------------------------------------------------

let minuterieToast = null;

/** L'instant présent, pour dater les messages (l'horloge de la page ; sous Node aussi). */
const maintenant = () => /** @type {any} */ (globalThis).performance.now();

/** Cache le message passager. */
function cacherToast() {
  const t = $("toast");
  t.hidden = true;
  try { if (t.hidePopover) t.hidePopover(); } catch { /* déjà fermé */ }
}

/** Un message passager, en haut de l'écran, `duree` millisecondes. */
export function toast(texte, duree = 4000) {
  const t = $("toast");
  t.textContent = texte;
  t.hidden = false;
  // Son heure : en changeant d'écran, un message plus ancien s'en va (retirerMessagesPasses).
  t.dataset.depuis = String(maintenant());
  // En « popover », le message passe au-dessus d'une feuille du bas ouverte
  // (un <dialog> est dans la couche du dessus) au lieu d'être grisé dessous.
  // Le rouvrir le remet au premier plan ; sans popover, il s'affiche comme avant.
  if (t.showPopover) { try { if (t.matches(":popover-open")) t.hidePopover(); t.showPopover(); } catch { /* sans popover */ } }
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(cacherToast, duree);
}

/** Retire le message passager s'il dit encore `texte` (un autre l'a peut-être remplacé). */
export function retirerToast(texte) {
  if ($("toast").textContent === texte) cacherToast();
}

/**
 * Les messages qui proposent un geste (« Relire », « Annuler » : `.toast-action`,
 * écrits par chaque écran) reçoivent leur heure en entrant dans la page : on
 * ne la leur demande pas, chaque écran les écrit à sa façon. À brancher une
 * fois, au démarrage (navigation.js).
 */
export function suivreMessages() {
  const corps = page() && page().body;
  const Observateur = /** @type {any} */ (globalThis).MutationObserver;
  if (!corps || typeof Observateur !== "function") return;
  new Observateur((changements) => {
    for (const c of changements) {
      for (const n of c.addedNodes) if (n.classList && n.classList.contains("toast")) n.dataset.depuis = String(maintenant());
    }
  }).observe(corps, { childList: true });
}

/**
 * En changeant d'écran, les messages de l'écran d'avant s'en vont : ils
 * restaient par-dessus « Ta page | Lue » ou la règle de la grille, à propos
 * d'un écran qu'on venait de quitter (audit du 04/10). Un message de moins
 * de `age` ms parle du changement lui-même (« Page lue… », « … supprimée ») :
 * il reste. « Une nouvelle version est prête » vaut pour toute l'appli :
 * il reste aussi. Les messages gardent leur place, en haut.
 * @param {number} [age]
 */
export function retirerMessagesPasses(age = 1000) {
  const doc = page();
  if (!doc) return;
  const vieux = (m) => maintenant() - (Number(m.dataset.depuis) || 0) > age;
  const t = $("toast");
  if (t && !t.hidden && vieux(t)) cacherToast();
  for (const m of doc.querySelectorAll(".toast.toast-action")) if (m.id !== "toast-version" && vieux(m)) m.remove();
}

// ------------------------------------------------------------------------
// Ce que le lecteur d'écran entend
// ------------------------------------------------------------------------

/**
 * Une partition gravée par abcjs, pour le clavier et le lecteur d'écran :
 * abcjs fait de chaque note qu'on peut toucher un arrêt de tabulation, sans
 * nom (« g », deux cents fois de suite pour une longue idée ; audit du
 * 04/10, I11). L'éditeur et « Corriger » ont leur chemin au clavier (← →
 * choisissent la note d'à côté, qui se dit) : les notes sortent de la
 * tabulation, et la partition prend un nom en français (abcjs dit « Sheet
 * Music »).
 * @param {any} zone  l'élément où abcjs a gravé
 * @param {string} nom
 */
export function gravureSansTabulation(zone, nom) {
  if (!zone) return;
  for (const n of zone.querySelectorAll('[selectable="true"]')) n.setAttribute("tabindex", "-1");
  for (const svg of zone.querySelectorAll("svg[role='img']")) svg.setAttribute("aria-label", nom);
}

let minuterieAnnonce = null;

/**
 * Une phrase courte pour le lecteur d'écran, sans rien montrer : l'écran
 * ouvert, l'étoile touchée, le nombre de résultats. Avant, le carnet entier
 * était une région vivante (aria-live) : une étoile touchée faisait relire
 * ses 8 000 caractères (audit du 04/10, I11). La région se vide d'abord :
 * la même phrase deux fois de suite se redit.
 * @param {string} texte
 */
export function annoncer(texte) {
  const r = $("annonce");
  if (!r) return;
  r.textContent = "";
  clearTimeout(minuterieAnnonce);
  minuterieAnnonce = setTimeout(() => { r.textContent = texte; }, 60);
}
