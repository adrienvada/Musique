/**
 * TA PAGE, REDESSINÉE
 *
 * L'atelier ne garde pas d'image de la page : il redessine les lignes du
 * modèle (calibration) et tes traits (stockés en vecteurs). C'est net à
 * toutes les tailles, léger, et les doutes se surlignent au bon endroit.
 */
const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/** Hauteur utile : des premières aux dernières portées où tu as écrit. */
function cadrage(cal, traits, marge) {
  let y0 = Infinity, y1 = -Infinity;
  for (const t of traits) for (const [, y] of t) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!Number.isFinite(y0)) { y0 = cal.systemes[0].portees[0].lignes[0]; y1 = y0 + 8 * cal.interligne; }
  return [Math.max(0, y0 - marge), Math.min(1872, y1 + marge)];
}

/** Le cadre d'un doute : sa boîte, un peu élargie pour entourer le geste plutôt que le serrer. */
export function cadreDoute(cal, b) {
  const pad = cal.interligne * 0.4;
  return { x: b.x0 - pad, y: b.y0 - pad, largeur: b.x1 - b.x0 + 2 * pad, hauteur: b.y1 - b.y0 + 2 * pad };
}

/**
 * La loupe d'un doute : la fenêtre de la page (viewBox) qui entoure `boite`,
 * au format `ratio` (largeur / hauteur) de la loupe affichée. Une note seule
 * (une boîte minuscule) reste lisible, une mesure entière montre aussi ses
 * voisines ; la fenêtre ne sort jamais de la page.
 */
export function fenetreLoupe(cal, boite, ratio) {
  const il = cal.interligne;
  const largeurBoite = boite.x1 - boite.x0, hauteurBoite = boite.y1 - boite.y0;
  let h = Math.max(hauteurBoite + 2.5 * il, 7 * il);
  let w = h * ratio;
  if (largeurBoite + 3 * il > w) { w = largeurBoite + 3 * il; h = w / ratio; }
  // Une loupe très large (tablette) ne montre pas plus que la page : elle perd en hauteur plutôt que de sortir de la feuille.
  if (w > 1330) { w = 1330; h = w / ratio; }
  const x = Math.min(Math.max((boite.x0 + boite.x1) / 2 - w / 2, 40), Math.max(40, 1370 - w));
  const y = Math.min(Math.max((boite.y0 + boite.y1) / 2 - h / 2, 0), Math.max(0, 1872 - h));
  return { x, y, w, h };
}

/**
 * @param svg      élément <svg> à remplir
 * @param cal      calibration du modèle
 * @param traits   traits de la page (listes de points)
 * @param options  { doutes: [{boite, leve}], actif: index du doute à mettre en avant, compact,
 *                   vue: { x, y, w, h } pour ne montrer qu'un passage (la loupe d'un doute) }
 */
export function dessinerPage(svg, cal, traits, options = {}) {
  const { doutes = [], actif = -1, compact = false, limite = null, vue = null } = options;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const marge = cal.interligne * (compact ? 1.5 : 2.5);
  let [y0, y1] = cadrage(cal, traits, marge);
  if (limite) y1 = Math.min(y1, y0 + limite);
  if (vue) {
    svg.setAttribute("viewBox", `${vue.x} ${vue.y} ${vue.w} ${vue.h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  } else {
    svg.setAttribute("viewBox", `40 ${y0} 1330 ${y1 - y0}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
  }
  const fond = el("g", { class: "papier" }, svg);
  for (const s of cal.systemes) {
    for (const p of s.portees) {
      for (const y of p.lignes) el("line", { x1: cal.x_debut, x2: cal.x_fin, y1: y, y2: y }, fond);
    }
    const haut = s.portees[0].lignes[0], bas = s.portees[s.portees.length - 1].lignes[4];
    el("line", { x1: cal.x_debut, x2: cal.x_debut, y1: haut, y2: bas }, fond);
    el("line", { x1: cal.x_fin, x2: cal.x_fin, y1: haut, y2: bas }, fond);
  }
  const surlignage = el("g", { class: "surlignage" }, svg);
  doutes.forEach((d, i) => {
    if (!d.boite) return;
    const { x, y, largeur, hauteur } = cadreDoute(cal, d.boite);
    el("rect", {
      x, y, width: largeur, height: hauteur, rx: cal.interligne * 0.4,
      class: "doute" + (i === actif ? " actif" : "") + (d.leve ? " leve" : ""), "data-doute": i,
    }, surlignage);
  });
  const encre = el("g", { class: "encre" }, svg);
  for (const t of traits) {
    if (t.length < 2) continue;
    el("polyline", { points: t.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ") }, encre);
  }
}
