/**
 * LES FEUILLES DU BAS
 *
 * Une feuille est un <dialog class="feuille-bas"> (systeme.css) : elle monte
 * sous le pouce, au-dessus d'un voile, et garde le focus tant qu'elle est
 * ouverte. Le <dialog> natif fait déjà le plus dur (Échap, focus, couche du
 * dessus) ; ici, on ajoute ce qu'il ne fait pas : fermer d'un toucher sur
 * le voile, et prévenir quand la feuille se ferme.
 */

/**
 * Prépare une feuille, une fois.
 * @param dlg        le <dialog class="feuille-bas">
 * @param surFermer  appelé à chaque fermeture (voile, Échap, bouton…)
 */
export function brancherFeuille(dlg, { surFermer } = {}) {
  if (dlg.dataset.branchee) return dlg;
  dlg.dataset.branchee = "1";
  // Un toucher hors du cadre de la feuille tombe sur le voile (::backdrop),
  // que le navigateur attribue au <dialog> lui-même.
  dlg.addEventListener("click", (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
  if (surFermer) dlg.addEventListener("close", () => surFermer(dlg.returnValue));
  return dlg;
}

/** Ouvre la feuille (sans effet si elle l'est déjà). */
export function ouvrirFeuille(dlg) {
  brancherFeuille(dlg);
  if (!dlg.open) dlg.showModal();
}

/** Ferme la feuille (sans effet si elle l'est déjà). */
export function fermerFeuille(dlg, valeur = "") {
  if (dlg.open) dlg.close(valeur);
}
