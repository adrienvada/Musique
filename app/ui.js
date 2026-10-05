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

/** Cache le message passager. */
function cacherToast() {
  const t = $("toast");
  t.hidden = true;
  try { if (t.hidePopover) t.hidePopover(); } catch { /* déjà fermé */ }
}

/** Un message passager, en bas de l'écran, `duree` millisecondes. */
export function toast(texte, duree = 4000) {
  const t = $("toast");
  t.textContent = texte;
  t.hidden = false;
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
