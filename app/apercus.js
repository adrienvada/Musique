/**
 * LES VIGNETTES
 *
 * Ce qu'on voit d'une partition avant de l'ouvrir : une idée en petits
 * traits (ses notes), un morceau en frise (ses blocs, aux couleurs de
 * l'écran Morceau), une page lue par le début de sa première portée.
 *
 * Elles vivaient chez l'écran qui les avait inventées (l'éditeur d'idée,
 * l'écran Morceau, l'accueil) : l'accueil importait tout l'éditeur d'idée
 * pour dessiner une vignette (audit du 04/10, T3).
 */
import { pasParMesure } from "./sequence.js";
import { assembler, couleursDesIdees } from "./morceau.js";
import { dessinerPage } from "./manuscrit.js";

/** Une vignette de l'idée : ses notes en petits traits (pour la bibliothèque). */
export function dessinerApercu(svg, seq) {
  const notes = (seq && seq.pistes || []).flatMap((p) => p.notes);
  svg.setAttribute("viewBox", "0 0 240 120");
  svg.setAttribute("preserveAspectRatio", "none");
  if (!notes.length) { svg.innerHTML = ""; return; }
  const fin = Math.max(pasParMesure(seq) * 2, ...notes.map((n) => n.d + n.l));
  const bas = Math.min(...notes.map((n) => n.h)) - 2, haut = Math.max(...notes.map((n) => n.h)) + 2;
  const ex = 228 / fin, ey = 104 / Math.max(12, haut - bas);
  svg.innerHTML = notes.map((n) => `<rect class="apercu-note" x="${6 + n.d * ex}" y="${8 + (haut - n.h) * ey - 2}" width="${Math.max(2, n.l * ex - 1)}" height="4" rx="2"/>`).join("");
}

/**
 * La vignette d'un morceau dans la bibliothèque : sa frise en miniature, les
 * couleurs de l'écran Morceau. Un trait fin sépare les passages d'un même
 * bloc répété, un trait plus large les blocs entre eux ; elle se lit aussi
 * bien à 56 × 46 qu'à 240 × 120 (le dessin s'étire, sans rien de fin).
 */
export function dessinerApercuMorceau(svg, morceau, idees) {
  const a = assembler(morceau, idees);
  svg.setAttribute("viewBox", "0 0 240 120");
  svg.setAttribute("preserveAspectRatio", "none");
  if (!a.fin) {
    svg.innerHTML = `<rect class="mini-vide" x="8" y="32" width="224" height="56" rx="6"/>`;
    return;
  }
  const couleurs = couleursDesIdees(morceau.blocs);
  const ideeDuBloc = new Map((morceau.blocs || []).map((b) => [b.id, b.idee]));
  const X = 8, L = 224;
  svg.innerHTML = a.passages.map((p, i) => {
    const suite = a.passages[i + 1];
    const trait = !suite ? 0 : suite.bloc === p.bloc ? 1.5 : 4;
    const x = X + (p.debut / a.fin) * L;
    const w = Math.max(2.5, ((p.fin - p.debut) / a.fin) * L - trait);
    return `<rect class="mini-seg section-${couleurs.get(ideeDuBloc.get(p.bloc)) || 1}" x="${x.toFixed(2)}" y="32" width="${w.toFixed(2)}" height="56" rx="4"/>`;
  }).join("");
}

/**
 * L'aperçu d'une page écrite à la main : le début de la première portée, plus
 * grand que nature plutôt que toute la page en poussière. Le dessin de la page
 * (manuscrit.js) cadre sur toute la largeur ; on recadre ici sur le format de
 * la vignette, à gauche (la clé, les premières notes).
 */
export function dessinerApercuPage(svg, cal, traits, ratio) {
  dessinerPage(svg, cal, traits, { compact: true, limite: 9 * cal.interligne });
  const [x, y, , h] = svg.getAttribute("viewBox").split(" ").map(Number);
  svg.setAttribute("viewBox", `${x} ${y} ${Math.round(h * ratio)} ${Math.round(h)}`);
  svg.setAttribute("preserveAspectRatio", "xMinYMid slice");
}

/**
 * Ce que la vignette d'une page lue garde de ses traits, à l'import : les
 * neuf premiers interlignes de la page, un point sur trois, arrondis. Assez
 * pour reconnaître la page, assez peu pour que la bibliothèque reste légère.
 */
export function apercuTraits(traits, cal) {
  const y0 = Math.min(...traits.flat().map((p) => p[1]));
  const limite = y0 + 9 * cal.interligne;
  return traits
    .filter((t) => t.some((p) => p[1] < limite))
    .map((t) => t.filter((_, i) => i % 3 === 0 || i === t.length - 1).map(([x, y]) => [Math.round(x), Math.round(y)]))
    .slice(0, 400);
}
