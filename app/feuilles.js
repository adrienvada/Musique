/**
 * LES FEUILLES DU BAS
 *
 * Une feuille est un <dialog class="feuille-bas"> (systeme.css) : elle monte
 * sous le pouce, au-dessus d'un voile, et garde le focus tant qu'elle est
 * ouverte. Le <dialog> natif fait déjà le plus dur (Échap, focus, couche du
 * dessus, et le geste retour d'Android, qui la ferme) ; ici, on ajoute ce
 * qu'il ne fait pas : fermer d'un toucher sur le voile, et prévenir quand la
 * feuille se ferme.
 *
 * Pourquoi pas `closedby="any"`, qui ferme au voile sans rien écrire (Chrome
 * 134, Firefox 141) ? Essayé (audit du 04/10, I3) : au doigt, Chromium ferme la
 * feuille dès qu'on relève le doigt, et le toucher atteint alors ce qui est
 * sous le voile (la recherche s'ouvrait, trois fois sur trois). Ici, la feuille
 * se ferme sur le clic, une fois le toucher fini : ce clic est à elle, rien ne
 * passe au travers ; et cela marche aussi sur Safari, qui ne connaît pas
 * closedby. L'essai le garde (tests/e2e/feuilles.test.mjs).
 */

/**
 * Prépare une feuille, une fois.
 * @param dlg        le <dialog class="feuille-bas">
 * @param surFermer  appelé à chaque fermeture (voile, Échap, bouton…)
 */
export function brancherFeuille(dlg, { surFermer } = {}) {
  if (dlg.dataset.branchee) return dlg;
  dlg.dataset.branchee = "1";
  // Un toucher hors du cadre de la feuille tombe sur le voile (::backdrop), que le
  // navigateur attribue au <dialog> lui-même.
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
