/**
 * LE MOUVEMENT, SAUF SI L'ON EN DEMANDE MOINS
 *
 * Le réglage « Réduire les animations » du téléphone (prefers-reduced-motion)
 * arrête les animations et les transitions de Portée (systeme.css). Les
 * défilements, eux, se demandent en JavaScript : quatre glissaient doucement
 * malgré ce réglage (« Corriger » vers la partition lue ou le mode avancé, les
 * panneaux de la tablette et des modèles ; audit du 04/10, I3). Ils passent
 * par ici.
 *
 * Sans DOM sous Node (les essais) : `globalThis` n'y a pas de matchMedia, et
 * le mouvement n'est alors pas réduit.
 */

/** Vrai si l'appareil demande moins de mouvement. */
export function mouvementReduit() {
  const mm = /** @type {any} */ (globalThis).matchMedia;
  return typeof mm === "function" && mm("(prefers-reduced-motion: reduce)").matches;
}

/** Le `behavior` d'un défilement : doux, ou d'un coup si l'on a demandé moins de mouvement. */
export function defilement() {
  return mouvementReduit() ? "auto" : "smooth";
}
