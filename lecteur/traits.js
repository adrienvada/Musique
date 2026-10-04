/**
 * LES TRAITS, PRÊTS À LIRE
 *
 * Trois chemins mènent les traits d'une page au lecteur : le PDF exporté par
 * la tablette (des décimaux), le connecteur (arrondis au demi-pixel pour le
 * voyage) et la bibliothèque (rangés au demi-pixel, app/stockage.js). Avant,
 * une page importée en PDF était lue sur ses décimaux, puis relue sur les
 * traits rangés, arrondis : la relecture pouvait différer de la première
 * lecture. Le lecteur ramène donc tout au demi-pixel avant de lire : une même
 * page donne toujours la même lecture, d'où qu'elle vienne. L'arrondi est
 * celui du stockage (Math.round(x * 2) / 2), et l'appliquer deux fois ne
 * change rien.
 *
 * Il écarte aussi ce qui ne peut pas être de l'écriture : un point non fini
 * (un fichier .rm abîmé), un point très loin de la page, un trait vide. Un
 * trait vide reste à sa place, vide : les numéros des traits (classe[i] du
 * lecteur, images de contrôle) suivent ceux de l'entrée.
 */

/** Le pas d'arrondi des traits, en pixels de l'écran : celui du stockage et du connecteur. */
export const PAS_ARRONDI = 0.5;

const arrondir = (v) => Math.round(v / PAS_ARRONDI) * PAS_ARRONDI;

/**
 * Les traits d'une page, au demi-pixel, sans point invalide.
 * @param traits  listes de points [x, y] en pixels de l'écran
 * @param page    { largeur, hauteur } de la calibration : un point à plus
 *                d'une demi-page du bord n'a pas pu être écrit sur la page
 */
export function preparerTraits(traits, page = {}) {
  const L = page.largeur || 1404, H = page.hauteur || 1872;
  const dedans = (x, y) => x > -L / 2 && x < 1.5 * L && y > -H / 2 && y < 1.5 * H;
  if (!Array.isArray(traits)) return [];
  return traits.map((t) => {
    if (!Array.isArray(t)) return [];
    const sortie = [];
    for (const p of t) {
      if (!p || !(p.length >= 2)) continue;
      const x = Number(p[0]), y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !dedans(x, y)) continue;
      sortie.push([arrondir(x), arrondir(y)]);
    }
    return sortie;
  });
}
