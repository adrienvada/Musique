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

/**
 * @param svg      élément <svg> à remplir
 * @param cal      calibration du modèle
 * @param traits   traits de la page (listes de points)
 * @param options  { doutes: [{boite, leve}], actif: index du doute à mettre en avant, compact }
 */
export function dessinerPage(svg, cal, traits, options = {}) {
  const { doutes = [], actif = -1, compact = false, limite = null } = options;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const marge = cal.interligne * (compact ? 1.5 : 2.5);
  let [y0, y1] = cadrage(cal, traits, marge);
  if (limite) y1 = Math.min(y1, y0 + limite);
  svg.setAttribute("viewBox", `40 ${y0} 1330 ${y1 - y0}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
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
    if (d.leve || !d.boite) return;
    const b = d.boite, pad = cal.interligne * 0.4;
    el("rect", {
      x: b.x0 - pad, y: b.y0 - pad, width: b.x1 - b.x0 + 2 * pad, height: b.y1 - b.y0 + 2 * pad, rx: 6,
      class: i === actif ? "doute actif" : "doute", "data-doute": i,
    }, surlignage);
  });
  const encre = el("g", { class: "encre" }, svg);
  for (const t of traits) {
    if (t.length < 2) continue;
    el("polyline", { points: t.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ") }, encre);
  }
}
