/**
 * LES ICÔNES DE PORTÉE
 *
 * Une seule famille, au trait (24 × 24, trait de 1,75, bouts ronds), de la
 * couleur du texte. Elles remplacent les caractères qui servaient d'icônes
 * (▶ ↶ ✕ ★ ⠿ •••) et l'emoji du micro : chaque police les dessinait à sa
 * façon, à des tailles différentes, et un lecteur d'écran les lisait mal.
 *
 * Le jeu est injecté une fois dans la page (des <symbol> cachés) : la page
 * écrit <svg class="ico"><use href="#i-lire"></use></svg>, le code
 * ico("lire"). Ajouter une icône ici la rend disponible partout.
 *
 * Sans dépendance (appli et tests).
 */

/** Le dessin de chaque icône (contenu d'un viewBox 0 0 24 24). */
export const ICONES = {
  // Écouter et enregistrer
  lire: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  boucle: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  metronome: '<path d="M9 3.5h6l3.8 17H5.2z"/><path d="M12 15.5l5-8.5"/><path d="M8.2 15.5h7.6"/>',
  rec: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
  micro: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  ecouter: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.5"/>',
  onde: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3"/>',
  taper: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5V9a1.5 1.5 0 0 1 3 0v2"/><path d="M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.8-2.4L4 15.5a1.6 1.6 0 0 1 2.4-2l2.6 2.5"/>',
  // Annuler, naviguer
  annuler: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  refaire: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  retour: '<path d="M15 18l-6-6 6-6"/>',
  suivant: '<path d="M9 18l6-6-6-6"/>',
  "chevron-bas": '<path d="M6 9l6 6 6-6"/>',
  "chevron-haut": '<path d="M6 15l6-6 6 6"/>',
  fermer: '<path d="M6 6l12 12M18 6L6 18"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  moins: '<path d="M5 12h14"/>',
  "plus-actions": '<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  chercher: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  // Ranger et partager
  partager: '<path d="M12 3.5v11"/><path d="M8 7.5l4-4 4 4"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/>',
  telecharger: '<path d="M12 3.5v11"/><path d="M8 10.5l4 4 4-4"/><path d="M5 17v2a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-2"/>',
  nuage: '<path d="M7.5 18.5h9.5a4 4 0 0 0 .5-7.97A5.75 5.75 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7.5 18.5z"/><path d="M9.5 14.2l1.9 1.9 3.6-3.6"/>',
  "nuage-vide": '<path d="M7.5 18.5h9.5a4 4 0 0 0 .5-7.97A5.75 5.75 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7.5 18.5z"/>',
  carnet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18"/><path d="M12.5 8h3.5M12.5 11.5h3.5"/>',
  partition: '<path d="M6.5 3h8l4 4v14h-12z"/><path d="M14.5 3v4h4"/><path d="M9.5 11.5h6M9.5 14.5h6M9.5 17.5h6"/>',
  morceau: '<rect x="3" y="7" width="5" height="10" rx="1.5"/><rect x="10" y="7" width="5" height="10" rx="1.5"/><rect x="17" y="7" width="4" height="10" rx="1.5"/>',
  reglages: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  tablette: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8.5 7h7M8.5 10.5h7M8.5 14h4"/>',
  page: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  imprimer: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="1.5"/><path d="M7 14h10v6.5H7z"/>',
  corbeille: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
  // Les versions précédentes (D6) : une horloge qu'on remonte.
  historique: '<path d="M4 12a8 8 0 1 0 2.35-5.65"/><path d="M4 4.5v4.2h4.2"/><path d="M12 8v4.3l2.8 1.7"/>',
  copier: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  crayon: '<path d="M4 20l4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2z"/><path d="M14.5 7l2.5 2.5"/>',
  etoile: '<path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.95 5.6L12 16.6l-5 2.65.95-5.6L3.9 9.7l5.6-.8z"/>',
  "etoile-pleine": '<path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.95 5.6L12 16.6l-5 2.65.95-5.6L3.9 9.7l5.6-.8z" fill="currentColor"/>',
  etiquette: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>',
  attention: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5"/><path d="M12 17.2v.1"/>',
  poignee: '<circle cx="9" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="17.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
  // Jouer et écrire
  clavier: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 13v6.5M15 13v6.5"/><path d="M7.5 4.5V13h3V4.5M13.5 4.5V13h3V4.5"/>',
  accords: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6"/>',
  // La grille : le bord du clavier, et des notes en barres décalées (un piano roll).
  // La partition : deux croches liées, le signe de la musique écrite. Les
  // premiers dessins (des lignes et un cadre) se lisaient comme une liste.
  "vue-grille": '<path d="M4 3.5v17"/><rect x="7" y="5" width="6.5" height="3.6" rx="1.2" fill="currentColor" stroke="none"/><rect x="11.5" y="10.2" width="9" height="3.6" rx="1.2" fill="currentColor" stroke="none"/><rect x="8" y="15.4" width="5.5" height="3.6" rx="1.2" fill="currentColor" stroke="none"/>',
  "vue-portee": '<ellipse cx="7.2" cy="17.6" rx="3.2" ry="2.4" transform="rotate(-20 7.2 17.6)" fill="currentColor" stroke="none"/><ellipse cx="17" cy="15.6" rx="3.2" ry="2.4" transform="rotate(-20 17 15.6)" fill="currentColor" stroke="none"/><path d="M10 17V6.2M19.8 15V4.2"/><path d="M10 4.9l9.8-2.2v3.2L10 8.1z" fill="currentColor" stroke="none"/>',
  effacer: '<path d="M9 5.5h10.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9L3.5 12z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>',
  haut: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  bas: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  "oct-haut": '<path d="M6 12l6-6 6 6M6 18l6-6 6 6"/>',
  "oct-bas": '<path d="M6 6l6 6 6-6M6 12l6 6 6-6"/>',
  aimant: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4"/>',
  allonger: '<path d="M3 12h18M17 8l4 4-4 4M7 8l-4 4 4 4"/>',
  raccourcir: '<path d="M3 12h7M14 12h7M7 8l4 4-4 4M17 8l-4 4 4 4"/>',
  envers: '<path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/>',
  miroir: '<path d="M12 3v18"/><path d="M8 7l-4 5 4 5z"/><path d="M16 7l4 5-4 5z"/>',
  nouvelle: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8.5v7M8.5 12h7"/>',
  repeter: '<rect x="3" y="7" width="8" height="10" rx="1.5"/><rect x="13" y="7" width="8" height="10" rx="1.5"/><path d="M15.5 12h3"/>',
  selection: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/>',
  // Durées (en pas : 1 = double croche … 16 = ronde), point, silence
  d1: '<ellipse cx="9.5" cy="17.5" rx="3.7" ry="2.6" transform="rotate(-20 9.5 17.5)" fill="currentColor"/><path d="M12.9 16.6V3.8"/><path d="M12.9 3.8c.5 2.4 4.6 3.2 3.9 6.8"/><path d="M12.9 8c.5 2.4 4.6 3.2 3.9 6.8"/>',
  d2: '<ellipse cx="9.5" cy="17.5" rx="3.7" ry="2.6" transform="rotate(-20 9.5 17.5)" fill="currentColor"/><path d="M12.9 16.6V3.8"/><path d="M12.9 3.8c.5 2.8 4.8 3.8 3.9 8.2"/>',
  d4: '<ellipse cx="9.5" cy="17.5" rx="3.7" ry="2.6" transform="rotate(-20 9.5 17.5)" fill="currentColor"/><path d="M12.9 16.6V3.8"/>',
  d8: '<ellipse cx="9.5" cy="17.5" rx="3.7" ry="2.6" transform="rotate(-20 9.5 17.5)"/><path d="M12.9 16.6V3.8"/>',
  d16: '<ellipse cx="12" cy="13.5" rx="5.2" ry="3.6" transform="rotate(-20 12 13.5)"/>',
  point: '<ellipse cx="9.5" cy="17.5" rx="3.7" ry="2.6" transform="rotate(-20 9.5 17.5)" fill="currentColor"/><path d="M12.9 16.6V3.8"/><circle cx="18" cy="16.5" r="1.6" fill="currentColor" stroke="none"/>',
  silence: '<path d="M10 3.5l4 4.5-3.2 3.6 4.2 4.6c-2.4-1-4.8-.2-3.8 3.3"/>',
  // Choisir aussi la note suivante (la sélection s'étend vers la droite)
  etendre: '<path d="M3.5 12h7M7 8.5v7"/><path d="M14 6l6 6-6 6"/>',
  // Demander à Claude (idee-claude.js) : une étincelle, le signe d'une proposition
  // qu'on n'a pas écrite soi-même (pas le logo de Claude) ; et une bulle pour
  // « Ce que tu veux », la demande dite en une phrase.
  etincelle: '<path d="M10.5 3c.6 4.2 3.3 6.9 7.5 7.5-4.2.6-6.9 3.3-7.5 7.5-.6-4.2-3.3-6.9-7.5-7.5 4.2-.6 6.9-3.3 7.5-7.5z"/><path d="M18.5 15.5c.25 1.6 1.4 2.75 3 3-1.6.25-2.75 1.4-3 3-.25-1.6-1.4-2.75-3-3 1.6-.25 2.75-1.4 3-3z"/>',
  bulle: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8.5L6 19.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z"/><path d="M7.5 9h9M7.5 12h6"/>',
};

/** Une icône en SVG, prête pour innerHTML. taille : "" (22 px), "s" (18) ou "l" (28). */
export function ico(nom, taille = "") {
  return `<svg class="ico${taille ? " " + taille : ""}" aria-hidden="true" focusable="false"><use href="#i-${nom}"></use></svg>`;
}

/**
 * Le jeu d'icônes, en HTML : un <svg> caché de <symbol>. L'assembleur
 * (outils/assembler-appli.mjs) l'écrit d'avance dans la page, pour que les
 * icônes soient là dès le premier affichage, sans attendre les modules.
 */
export function jeuDIcones() {
  const symboles = Object.entries(ICONES).map(([nom, dessin]) => `<symbol id="i-${nom}" viewBox="0 0 24 24">${dessin}</symbol>`).join("");
  return `<svg id="icones-portee" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${symboles}</svg>`;
}

/** Met le jeu d'icônes dans la page, s'il n'y est pas déjà : les <use href="#i-…"> le trouvent. */
export function injecterIcones(doc = document) {
  if (doc.getElementById("icones-portee")) return;
  doc.body.insertAdjacentHTML("afterbegin", jeuDIcones());
}
