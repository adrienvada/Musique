/**
 * PETITS OUTILS DE L'INTERFACE
 *
 * `echapper` : tout texte qui entre dans du HTML écrit en chaîne (innerHTML,
 * attributs) passe par elle. Un titre, une étiquette, un nom d'accord ou de
 * piste viennent d'Adrien, mais aussi d'une sauvegarde restaurée ou de la
 * synchro : non échappés, ils pouvaient exécuter du code dans la page et lire
 * l'adresse du connecteur (audit du 04/10, S1). Le texte posé avec
 * `textContent` n'en a pas besoin.
 */
const ENTITES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Le texte, prêt à entrer dans du HTML (contenu ou valeur d'attribut entre guillemets). */
export const echapper = (texte) => String(texte ?? "").replace(/[&<>"']/g, (c) => ENTITES[c]);
