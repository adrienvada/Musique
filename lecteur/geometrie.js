/**
 * Outils de géométrie pour les traits de la tablette.
 * Un trait est une liste de points [x, y] en pixels de l'écran.
 */

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function longueur(points) {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i]);
  return l;
}

export function boite(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, l: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Distance d'un point au segment [a, b]. */
export function distSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = dx * dx + dy * dy;
  let t = n ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / n : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Simplification de Ramer-Douglas-Peucker : garde les coins, lisse le tremblement. */
export function simplifier(points, eps) {
  if (points.length < 3) return points.slice();
  let max = 0, idx = 0;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = distSegment(points[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  const g = simplifier(points.slice(0, idx + 1), eps);
  const d = simplifier(points.slice(idx), eps);
  return g.slice(0, -1).concat(d);
}

/** Angle d'un segment par rapport à l'horizontale, en degrés (0 à 90). */
export function angle(a, b) {
  return (Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180) / Math.PI;
}

/** Abscisse d'un segment à une ordonnée donnée (prolongé si besoin). */
export function xA(a, b, y) {
  if (Math.abs(b[1] - a[1]) < 1e-6) return (a[0] + b[0]) / 2;
  return a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
}

/** Nombre d'allers-retours horizontaux d'un trait (un soupir zigzague). */
export function retournements(points, seuil) {
  let n = 0, sens = 0, ancre = points[0][0];
  for (const [x] of points) {
    const d = x - ancre;
    if (Math.abs(d) < seuil) continue;
    const s = Math.sign(d);
    if (sens && s !== sens) n++;
    sens = s;
    ancre = x;
  }
  return n;
}
