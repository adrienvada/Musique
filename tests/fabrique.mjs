/**
 * FABRIQUE DE MESURES, À PARTIR DE TES VRAIS TRAITS
 *
 * Les deux pages d'essai n'ont ni tête vide, ni accord, ni double croche, ni
 * bécarre : le lecteur avait des chemins jamais exécutés. Cette fabrique
 * compose des mesures avec les gabarits tirés de la page de mélodie (une tête,
 * un crochet, un point, un bémol, un soupir, un demi-soupir, tels que tu les
 * as écrits), et des traits droits tremblés pour les hampes, barres et
 * ligatures. Reprise des expériences de l'audit du 04/10 (synth.mjs).
 *
 * Ce n'est pas un test (pas de « .test » dans le nom) : les tests l'importent.
 */
import { lireFichier } from "../outils/lire.mjs";
import { lirePartition } from "../lecteur/partition.js";

let chargee = null;

/** La page de mélodie, ses traits et sa calibration (lus une fois : la promesse est gardée, pas son résultat). */
export function chargerFabrique() {
  chargee ||= lireFichier("tests/pages/2026-09-30-melodie-standard.pdf").then((r) => ({ T: r.pages[0].traits, CAL: r.cal, IL: r.cal.interligne }));
  return chargee;
}

/** Générateur pseudo-aléatoire reproductible (mulberry32) et loi normale. */
export function alea(graine = 1) {
  let a = graine >>> 0;
  const u = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const normale = () => { let x = 0, y = 0; while (!x) x = u(); while (!y) y = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * y); };
  return { u, normale };
}

const centre = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [(x0 + x1) / 2, (y0 + y1) / 2, x0, y0, x1, y1];
};
const placer = (pts, cx, cy, k = 1) => { const [ax, ay] = centre(pts); return pts.map(([x, y]) => [cx + (x - ax) * k, cy + (y - ay) * k]); };
const placerGroupe = (strokes, cx, cy, k = 1) => { const [ax, ay] = centre(strokes.flat()); return strokes.map((s) => s.map(([x, y]) => [cx + (x - ax) * k, cy + (y - ay) * k])); };

/**
 * Une page en construction sur la portée `n` (0 = la première). Chaque méthode
 * ajoute des traits et rend ce qu'il faut pour la suite (une tête, une hampe…).
 */
export class Page {
  constructor(f, n = 0) {
    this.f = f;
    this.traits = [];
    const s = f.CAL.systemes[n].portees[0];
    this.p = { bas: s.lignes[4], haut: s.lignes[0], y: (pas) => s.lignes[4] - (pas * f.IL) / 2 };
    this.graine = 1;
    const T = f.T;
    // Gabarits tirés de la page de mélodie (numéros des traits du PDF d'essai).
    this.G = { tete: T[128], crochet: T[29], point: T[36], bemol: [T[21], T[22]], soupir: T[134], demiSoupir: T[83] };
  }
  ligne(a, b, n = 12, trem = 0.3) {
    const { normale } = alea(this.graine++);
    const pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (b[0] - a[0]) * t + trem * normale(), a[1] + (b[1] - a[1]) * t + trem * normale()]); }
    return pts;
  }
  /** Une tête pleine (ton gribouillis de do5, déplacé), centrée sur la position `pas`. */
  tete(x, pas, k = 1) { const y = this.p.y(pas); this.traits.push(placer(this.G.tete, x, y, k)); return { x, y, pas, d: x + 0.3 * this.f.IL, g: x - 0.3 * this.f.IL }; }
  /** Une tête vide : une boucle fermée un peu penchée. */
  teteVide(x, pas, { tours = 1.12, rx = 0.52, ry = 0.36, incl = -0.35 } = {}) {
    const IL = this.f.IL, y = this.p.y(pas), pts = [], n = 40;
    for (let i = 0; i <= n * tours; i++) { const a = (i / n) * 2 * Math.PI + 2.5; const ex = rx * IL * Math.cos(a), ey = ry * IL * Math.sin(a); pts.push([x + ex * Math.cos(incl) - ey * Math.sin(incl), y + ex * Math.sin(incl) + ey * Math.cos(incl)]); }
    this.traits.push(pts);
    return { x, y, pas, d: x + 0.45 * IL, g: x - 0.45 * IL };
  }
  hampe(t, dir = "haut", long = 3.3) {
    const IL = this.f.IL, x = dir === "haut" ? t.d : t.g;
    const y0 = t.y + (dir === "haut" ? -0.1 : 0.1) * IL, y1 = t.y + (dir === "haut" ? -long : long) * IL;
    this.traits.push(this.ligne([x, y0], [x + 0.5, y1], 10));
    return { x, bout: [x + 0.5, y1], dir };
  }
  /** Ton crochet de croche, accroché au bout de la hampe (en miroir pour une hampe descendante). */
  crochet(h, k = 1) {
    const [bx, by] = h.bout, c = this.G.crochet;
    const [, , x0, y0] = centre(c);
    const pts = c.map(([x, y]) => [bx + (x - x0) * k, h.dir === "haut" ? by + (y - y0) * k : by - (y - y0) * k]);
    this.traits.push(pts);
    return pts;
  }
  ligature(h1, h2, decalage = 0) { const s = h1.dir === "haut" ? 1 : -1, IL = this.f.IL; this.traits.push(this.ligne([h1.bout[0], h1.bout[1] + s * decalage * IL], [h2.bout[0], h2.bout[1] + s * decalage * IL], 14)); }
  point(x, pas) { this.traits.push(placer(this.G.point, x, this.p.y(pas))); }
  bemol(x, pas) { const y = this.p.y(pas); for (const s of placerGroupe(this.G.bemol, x, y - 0.45 * this.f.IL)) this.traits.push(s); }
  diese(x, pas) {
    const IL = this.f.IL, y = this.p.y(pas), a = 0.32 * IL, h = 1.35 * IL;
    this.traits.push(this.ligne([x - a, y - h], [x - a + 1, y + h], 8), this.ligne([x + a, y - h - 3], [x + a + 1, y + h - 3], 8),
      this.ligne([x - 0.75 * IL, y - 0.3 * IL], [x + 0.75 * IL, y - 0.55 * IL], 8), this.ligne([x - 0.75 * IL, y + 0.45 * IL], [x + 0.75 * IL, y + 0.2 * IL], 8));
  }
  /** Un bécarre en deux « L » : le premier descend puis part à droite, le second part à droite puis descend. */
  becarre(x, pas) {
    const IL = this.f.IL, y = this.p.y(pas), a = 0.28 * IL;
    this.traits.push([...this.ligne([x - a, y - 1.4 * IL], [x - a, y + 0.45 * IL], 8), ...this.ligne([x - a, y + 0.45 * IL], [x + a, y + 0.25 * IL], 4)]);
    this.traits.push([...this.ligne([x - a, y - 0.35 * IL], [x + a, y - 0.55 * IL], 4), ...this.ligne([x + a, y - 0.55 * IL], [x + a, y + 1.4 * IL], 8)]);
  }
  barre(x) { this.traits.push(this.ligne([x, this.p.haut - 2], [x + 0.5, this.p.bas + 2], 12)); }
  soupir(x, pas = 4) { this.traits.push(placer(this.G.soupir, x, this.p.y(pas))); }
  demiSoupir(x, pas = 4) { this.traits.push(placer(this.G.demiSoupir, x, this.p.y(pas))); }
  /** Demi-pause (posée sur la ligne `pas`) ou pause (pendue sous elle) : un petit pavé noirci. */
  rectangle(x, pas, sous) {
    const IL = this.f.IL, y = this.p.y(pas) + (sous ? 0.22 * IL : -0.22 * IL), pts = [];
    for (let i = 0; i < 9; i++) pts.push([x - 0.4 * IL, y - 0.2 * IL + (i * 0.4 * IL) / 8], [x + 0.4 * IL, y - 0.2 * IL + (i * 0.4 * IL) / 8 + 0.02 * IL]);
    this.traits.push(pts);
  }
  /** Un arc (liaison) de x0 à x1, creusé de `h` interlignes vers le bas (vers le haut si h < 0). */
  arc(x0, x1, y, h = 0.5) { const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push([x0 + (x1 - x0) * t, y + h * this.f.IL * Math.sin(Math.PI * t)]); } this.traits.push(pts); }
  /** Un « 3 » de triolet, en deux bosses. */
  chiffre3(x, y) {
    const IL = this.f.IL, pts = [];
    for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; pts.push([x + 0.3 * IL * Math.cos(a), y - 0.3 * IL + 0.3 * IL * Math.sin(a)]); }
    for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; pts.push([x + 0.33 * IL * Math.cos(a), y + 0.3 * IL + 0.3 * IL * Math.sin(a)]); }
    this.traits.push(pts);
  }
  /** Une lettre « o » écrite à côté de la musique (titre, paroles, accords chiffrés). */
  texte(x, y, k = 1) { const IL = this.f.IL, o = []; for (let i = 0; i <= 30; i++) { const a = (i / 30) * 2.1 * Math.PI; o.push([x + 0.35 * IL * k * Math.cos(a), y + 0.4 * IL * k * Math.sin(a)]); } this.traits.push(o); }
  /** Une ligne supplémentaire à la position `pas` (paire, hors de la portée), autour de x. */
  ligneSup(x, pas) { const IL = this.f.IL, y = this.p.y(pas); this.traits.push(this.ligne([x - 0.7 * IL, y], [x + 0.7 * IL, y + 0.3], 6, 0.2)); }
  /** Note à hampe montante ou descendante, selon sa place. */
  haut(x, pas, k) { return this.hampe(this.tete(x, pas, k), "haut"); }
  bas(x, pas, k) { return this.hampe(this.tete(x, pas, k), "bas"); }
  note(x, pas, k) { return pas >= 4 ? this.bas(x, pas, k) : this.haut(x, pas, k); }
}

export const corps = (abc) => abc.split("\n").filter((l) => !/^[A-Za-z]:|^%%/.test(l)).join("\n");
export const entete = (abc) => abc.split("\n").filter((l) => /^[MK]:/.test(l)).join(" ");

/** Lit une page fabriquée : l'ABC (chiffrage, armure, corps) et les types de doutes. */
export function lire(page, options = {}) {
  const r = lirePartition([page.traits], page.f.CAL, { titre: "x", ...options });
  return { abc: `${entete(r.abc)} | ${corps(r.abc).replace(/\n/g, " / ")}`, corps: corps(r.abc), doutes: r.doutes.map((d) => d.type), r };
}
