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

/**
 * Ce qu'on montre de la page, d'après la calibration (et plus des pixels
 * écrits en dur, valables pour le seul format de la reMarkable 2) : toute la
 * hauteur, et en largeur, de la moitié de la marge gauche (l'accolade du piano
 * y est) à la moitié de la marge droite.
 */
export function cadrePage(cal) {
  const largeur = (cal.page && cal.page.largeur) || 1404, hauteur = (cal.page && cal.page.hauteur) || 1872;
  const gauche = cal.x_debut / 2, droite = cal.x_fin + (largeur - cal.x_fin) / 2;
  return { gauche, droite, largeur: droite - gauche, hauteur };
}

/** Hauteur utile : des premières aux dernières portées où tu as écrit. */
function cadrage(cal, traits, marge) {
  let y0 = Infinity, y1 = -Infinity;
  for (const t of traits) for (const [, y] of t) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!Number.isFinite(y0)) { y0 = cal.systemes[0].portees[0].lignes[0]; y1 = y0 + 8 * cal.interligne; }
  return [Math.max(0, y0 - marge), Math.min(cadrePage(cal).hauteur, y1 + marge)];
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
  const page = cadrePage(cal);
  if (w > page.largeur) { w = page.largeur; h = w / ratio; }
  const x = Math.min(Math.max((boite.x0 + boite.x1) / 2 - w / 2, page.gauche), Math.max(page.gauche, page.droite - w));
  const y = Math.min(Math.max((boite.y0 + boite.y1) / 2 - h / 2, 0), Math.max(0, page.hauteur - h));
  return { x, y, w, h };
}

/**
 * Le passage d'un doute, pour l'image envoyée à Claude (H1) : la boîte du
 * doute, quatre interlignes de chaque côté, et toute la hauteur de sa portée
 * (les lignes donnent la hauteur des notes) avec deux interlignes et demi
 * au-dessus et au-dessous pour les lignes supplémentaires. Sans sortir de
 * la page.
 */
export function cadreAvis(cal, boite) {
  const il = cal.interligne;
  const portees = (cal.systemes || []).flatMap((s) => s.portees);
  const cy = (boite.y0 + boite.y1) / 2;
  const milieu = (q) => (q.lignes[0] + q.lignes[4]) / 2;
  const p = portees.reduce((m, q) => (Math.abs(milieu(q) - cy) < Math.abs(milieu(m) - cy) ? q : m), portees[0]);
  const page = cadrePage(cal);
  const x0 = Math.max(page.gauche, boite.x0 - 4 * il), x1 = Math.min(page.droite, boite.x1 + 4 * il);
  const y0 = Math.max(0, Math.min(boite.y0, p ? p.lignes[0] : boite.y0) - 2.5 * il);
  const y1 = Math.min(page.hauteur, Math.max(boite.y1, p ? p.lignes[4] : boite.y1) + 2.5 * il);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Le passage d'un doute dessiné sur un canevas (son contexte 2D), pour Claude
 * (H1) : les lignes du modèle, tes traits, un cadre bleu autour de ce que
 * vise le doute (`cadre`, sa boîte), et un numéro sur chaque tête que le
 * lecteur a lue (`tetes`, de gauche à droite : le même ordre que le texte de
 * la question). En noir sur blanc quel que soit le thème de l'écran : l'image
 * n'est pas pour l'écran, elle doit se lire pareil partout.
 * @param {any} ctx  le contexte 2D du canevas, de vue.w × échelle sur vue.h × échelle
 * @param {any} cal
 * @param {number[][][]} traits
 * @param {{ vue: { x: number, y: number, w: number, h: number }, echelle: number, tetes?: { x0: number, y0: number }[], cadre?: { x0: number, y0: number, x1: number, y1: number } | null }} options
 */
export function dessinerPassage(ctx, cal, traits, { vue, echelle, tetes = [], cadre = null }) {
  const il = cal.interligne;
  const X = (x) => (x - vue.x) * echelle, Y = (y) => (y - vue.y) * echelle;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, vue.w * echelle, vue.h * echelle);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Les lignes du modèle, en gris : on les distingue de l'encre, comme sur la tablette.
  ctx.strokeStyle = "#9a9a9a";
  ctx.lineWidth = Math.max(1, 0.06 * il * echelle);
  for (const s of cal.systemes || []) {
    for (const p of s.portees) {
      for (const y of p.lignes) { ctx.beginPath(); ctx.moveTo(X(cal.x_debut), Y(y)); ctx.lineTo(X(cal.x_fin), Y(y)); ctx.stroke(); }
    }
  }
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(1.5, 0.15 * il * echelle);
  for (const t of traits) {
    if (!Array.isArray(t) || t.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(X(t[0][0]), Y(t[0][1]));
    for (let k = 1; k < t.length; k++) ctx.lineTo(X(t[k][0]), Y(t[k][1]));
    ctx.stroke();
  }
  // Ce que vise le doute, encadré (le texte de la question le dit).
  if (cadre) {
    const pad = 0.35 * il;
    ctx.strokeStyle = "#2f4bc2";
    ctx.lineWidth = Math.max(1.5, 0.09 * il * echelle);
    ctx.setLineDash([0.3 * il * echelle, 0.2 * il * echelle]);
    ctx.strokeRect(X(cadre.x0 - pad), Y(cadre.y0 - pad), (cadre.x1 - cadre.x0 + 2 * pad) * echelle, (cadre.y1 - cadre.y0 + 2 * pad) * echelle);
    ctx.setLineDash([]);
  }
  // Les numéros, en haut à gauche de chaque tête (les queues montent à sa droite), assez petits pour ne pas cacher la voisine.
  const r = 0.34 * il * echelle;
  ctx.font = `bold ${Math.round(0.46 * il * echelle)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  tetes.forEach((t, k) => {
    const cx = X(t.x0) - 0.25 * il * echelle, cy = Y(t.y0) - 0.3 * il * echelle;
    ctx.fillStyle = "#2f4bc2";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(k + 1), cx, cy + 0.03 * il * echelle);
  });
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
    const page = cadrePage(cal);
    svg.setAttribute("viewBox", `${page.gauche} ${y0} ${page.largeur} ${y1 - y0}`);
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
