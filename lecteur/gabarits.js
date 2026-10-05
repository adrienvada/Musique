/**
 * TES GABARITS : DES SIGNES APPRIS SUR TON ÉCRITURE (L16)
 *
 * Le lecteur reconnaît les silences, les altérations et les chiffres
 * d'après des règles (lecteur.js), réglées sur deux pages : elles ne savent
 * pas lire un chiffre, et chaque main fait ses signes à sa façon. Ici, le
 * lecteur compare un signe à des exemples de TON écriture : ceux de la page
 * d'étalonnage (chaque signe écrit trois fois), puis chaque signe que tu as
 * corrigé. La recherche le dit depuis longtemps : avec les exemples du
 * scripteur, l'erreur diminue de moitié. Il n'y a qu'un scripteur, toi.
 *
 * LA MÉTHODE : $Q, le reconnaisseur par nuage de points de Vatavu, Anthony
 * et Wobbrock (« $Q: A Super-Quick, Articulation-Invariant Stroke-Gesture
 * Recognizer for Low-Resource Devices », MobileHCI 2018), écrit ici d'après
 * l'article :
 *   1. le signe (tous ses traits) est rééchantillonné en 32 points, répartis
 *      régulièrement le long du tracé ;
 *   2. il est centré sur son barycentre et mesuré en interlignes. C'est le
 *      seul écart avec l'article, qui ramène chaque signe à la même taille :
 *      ici, la taille compte (un soupir est deux fois plus haut qu'un
 *      demi-soupir), et l'interligne de la page la rend comparable d'un
 *      modèle à l'autre ;
 *   3. deux signes se comparent comme deux nuages de points : chaque point
 *      de l'un est apparié, glouton, au point libre le plus proche de
 *      l'autre (les premiers appariés pèsent le plus), en partant de
 *      plusieurs points de départ et dans les deux sens. L'ordre et le sens
 *      des traits ne comptent pas : un dièse se reconnaît quel que soit
 *      l'ordre de ses quatre traits ;
 *   4. pour aller vite, $Q calcule d'abord une borne inférieure de chaque
 *      appariement avec une table des plus proches voisins (64 × 64 cases),
 *      et abandonne un appariement dès qu'il dépasse le meilleur trouvé.
 *      La table est approchée (la case, pas le point exact) : c'est le
 *      compromis de l'article, sans effet mesurable sur l'étiquette choisie.
 *
 * Un signe trop loin de tous tes exemples n'est pas reconnu (seuil de
 * rejet) : le lecteur garde alors ses règles, ou en fait un doute.
 *
 * Les gabarits sont des données simples (JSON) : { version, exemples:
 * [{ id, etiquette, source, points }] }, les points en interlignes. Ils
 * voyagent avec la bibliothèque, et aucune fonction ne les modifie : chacune
 * rend de nouveaux gabarits.
 *
 * Pur, sans dépendance : le navigateur et Node s'en servent tels quels.
 */
import { boite } from "./geometrie.js";
import { preparerTraits } from "./traits.js";

export const VERSION_GABARITS = 1;

/** Points par nuage : 32, comme dans l'article (au-delà, rien ne s'améliore). */
export const NB_POINTS = 32;
// La table des plus proches voisins couvre ±3 interlignes autour du
// barycentre (un soupir fait 4 interlignes de haut), en 64 × 64 cases.
const FENETRE = 3;
const GRILLE = 64;
const POIDS = (NB_POINTS * (NB_POINTS + 1)) / 2; // somme des poids n, n-1… 1

/**
 * Les seuils. La distance d'un signe à un exemple est l'écart moyen
 * (quadratique) entre leurs points appariés, en interlignes ; pour juger si
 * elle est petite, on la rapporte au rayon du signe (l'écart moyen de ses
 * points à son barycentre) : 0,1 interligne d'écart, c'est beaucoup pour un
 * point de « 3 », peu pour un soupir. Réglés le 04/10 sur tes signes du 30/09
 * (six bémols, trois soupirs, deux demi-soupirs, les chiffres du « 12/8 ») et
 * sur 20 variantes déformées de chacun (bruit, rotation, taille) : un bémol
 * est à 0,14 à 0,17 rayon de tes autres bémols, à plus de 0,29 de tout autre
 * signe ; une tête ou un accent, à plus de 0,7 de tout gabarit.
 *  - sur : en deçà, et nettement plus près que toute autre étiquette (la
 *    seconde au moins 1/0,8 fois plus loin), le signe est reconnu sans question ;
 *  - rejet : au-delà, le signe n'est pas reconnu ;
 *  - entre les deux, ou trop près d'une autre étiquette : reconnu de justesse.
 */
export const SEUILS = { sur: 0.3, rejet: 0.45, marge: 0.8 };

/** Ce que tes gabarits savent reconnaître, et à quoi chaque étiquette sert. */
export const ETIQUETTES = {
  soupir: { nom: "soupir", famille: "silence", croches: 2 },
  "demi-soupir": { nom: "demi-soupir", famille: "silence", croches: 1 },
  "quart-soupir": { nom: "quart de soupir", famille: "silence", croches: 0.5 },
  diese: { nom: "dièse", famille: "alteration", abc: "^" },
  bemol: { nom: "bémol", famille: "alteration", abc: "_" },
  becarre: { nom: "bécarre", famille: "alteration", abc: "=" },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => [String(k), { nom: `chiffre ${k}`, famille: "chiffre" }])),
  C: { nom: "C (4/4)", famille: "metre", m: "C", croches: 8 },
  "C|": { nom: "C barré (2/2)", famille: "metre", m: "C|", croches: 8 },
  triolet: { nom: "3 de triolet", famille: "triolet" },
};

/** Les étiquettes d'une ou plusieurs familles (silence, alteration, chiffre, metre, triolet). */
export function etiquettesDe(...familles) {
  return Object.keys(ETIQUETTES).filter((e) => familles.includes(ETIQUETTES[e].famille));
}

export function gabaritsVides() {
  return { version: VERSION_GABARITS, exemples: [] };
}

// ------------------------------------------------------------------------
// Le nuage de points d'un signe
// ------------------------------------------------------------------------

const carre = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const arrondi = (v) => Math.round(v * 1000) / 1000 + 0; // + 0 : jamais de « -0 » dans le JSON

/**
 * `n` points répartis régulièrement le long des traits, mis bout à bout (le
 * saut d'un trait au suivant ne compte pas). Un signe fait de seuls points
 * (aucune longueur) devient n fois son barycentre.
 */
function reechantillonner(traits, n) {
  const segments = [];
  let total = 0;
  for (const t of traits) {
    for (let i = 1; i < t.length; i++) {
      const d = Math.sqrt(carre(t[i - 1], t[i]));
      if (d > 0) { segments.push([t[i - 1], t[i], d]); total += d; }
    }
  }
  const tous = traits.flat();
  if (!tous.length) return [];
  if (!total) {
    const c = [tous.reduce((s, p) => s + p[0], 0) / tous.length, tous.reduce((s, p) => s + p[1], 0) / tous.length];
    return Array.from({ length: n }, () => [...c]);
  }
  const pas = total / (n - 1);
  const sortie = [];
  let parcouru = 0, k = 0;
  for (const [a, b, d] of segments) {
    while (k < n && k * pas <= parcouru + d + 1e-9) {
      const t = Math.min(1, Math.max(0, (k * pas - parcouru) / d));
      sortie.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      k++;
    }
    parcouru += d;
  }
  const dernier = segments[segments.length - 1][1];
  while (sortie.length < n) sortie.push([dernier[0], dernier[1]]);
  return sortie;
}

/**
 * Le nuage d'un signe : ses traits rééchantillonnés, centrés sur leur
 * barycentre, en interlignes (arrondis au millième, pour des gabarits
 * compacts). Null s'il n'y a rien à lire.
 */
export function nuage(traits, il) {
  if (!(il > 0)) throw new Error("L'interligne manque : un signe se mesure en interlignes.");
  const pts = reechantillonner((traits || []).filter((t) => Array.isArray(t) && t.length), NB_POINTS);
  if (!pts.length) return null;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [arrondi((x - cx) / il), arrondi((y - cy) / il)]);
}

// ------------------------------------------------------------------------
// $Q : table des plus proches voisins, bornes inférieures, appariement
// ------------------------------------------------------------------------

const caseDe = (v) => Math.max(0, Math.min(GRILLE - 1, Math.floor(((v + FENETRE) / (2 * FENETRE)) * GRILLE)));

/** Pour chaque case de la grille, le point du nuage le plus proche de son centre. */
function table(points) {
  const lut = new Uint8Array(GRILLE * GRILLE);
  const cote = (2 * FENETRE) / GRILLE;
  for (let gx = 0; gx < GRILLE; gx++) {
    const x = -FENETRE + (gx + 0.5) * cote;
    for (let gy = 0; gy < GRILLE; gy++) {
      const y = -FENETRE + (gy + 0.5) * cote;
      let meilleur = 0, d = Infinity;
      for (let i = 0; i < points.length; i++) {
        const e = (points[i][0] - x) ** 2 + (points[i][1] - y) ** 2;
        if (e < d) { d = e; meilleur = i; }
      }
      lut[gx * GRILLE + gy] = meilleur;
    }
  }
  return lut;
}

/**
 * Les bornes inférieures de l'appariement de p1 sur p2, pour chaque point de
 * départ pris de `pas` en `pas` ($Q) : chaque point de p1 apparié à son plus
 * proche voisin dans p2 (d'après la table de p2), avec les poids du départ.
 */
function bornes(p1, p2, pas, lut2) {
  const n = p1.length;
  const lb = new Float64Array(Math.floor(n / pas) + 1);
  const cumul = new Float64Array(n);
  let lb0 = 0;
  for (let i = 0; i < n; i++) {
    const j = lut2[caseDe(p1[i][0]) * GRILLE + caseDe(p1[i][1])];
    const d = carre(p1[i], p2[j]);
    cumul[i] = i ? cumul[i - 1] + d : d;
    lb0 += (n - i) * d;
  }
  lb[0] = lb0;
  for (let i = pas, k = 1; i < n; i += pas, k++) lb[k] = lb0 + i * cumul[n - 1] - n * cumul[i - 1];
  return lb;
}

/**
 * L'appariement glouton de p1 sur p2 à partir du point `debut` : chaque point
 * de p1, dans l'ordre, prend le point libre de p2 le plus proche ; le premier
 * pèse n, le dernier 1. On s'arrête dès que la somme dépasse `plafond`.
 */
function apparierDepuis(p1, p2, debut, plafond) {
  const n = p1.length;
  const libres = Array.from({ length: n }, (_, i) => i);
  let nLibres = n, somme = 0, poids = n, i = debut;
  do {
    let u = 0, b = Infinity;
    for (let k = 0; k < nLibres; k++) {
      const d = carre(p1[i], p2[libres[k]]);
      if (d < b) { b = d; u = k; }
    }
    libres[u] = libres[--nLibres];
    somme += poids * b;
    if (somme >= plafond) return somme;
    poids--;
    i = (i + 1) % n;
  } while (i !== debut);
  return somme;
}

/** La distance (somme pondérée) entre deux nuages préparés, ou au moins `plafond` s'ils sont plus loin. */
function apparier(a, b, plafond) {
  const n = a.points.length;
  const pas = Math.floor(Math.sqrt(n));
  const lb1 = bornes(a.points, b.points, pas, b.lut);
  const lb2 = bornes(b.points, a.points, pas, a.lut);
  let meilleure = plafond;
  for (let i = 0, k = 0; i < n; i += pas, k++) {
    if (lb1[k] < meilleure) meilleure = Math.min(meilleure, apparierDepuis(a.points, b.points, i, meilleure));
    if (lb2[k] < meilleure) meilleure = Math.min(meilleure, apparierDepuis(b.points, a.points, i, meilleure));
  }
  return meilleure;
}

// La table de chaque exemple, calculée une fois : elle ne va pas dans le JSON.
const tables = new WeakMap();
function prepare(exemple) {
  let t = tables.get(exemple);
  if (!t) { t = { points: exemple.points, lut: table(exemple.points) }; tables.set(exemple, t); }
  return t;
}

/** L'écart moyen, en interlignes, d'une somme pondérée de carrés. */
const ecartMoyen = (somme) => Math.sqrt(somme / POIDS);

/**
 * La distance entre deux nuages, en interlignes (l'écart moyen entre leurs
 * points appariés), avec les mêmes points de départ que $Q, mais sans borne
 * ni abandon : la référence des tests et des réglages.
 */
export function distance(a, b) {
  const n = a.length;
  const pas = Math.floor(Math.sqrt(n));
  let meilleure = Infinity;
  for (let i = 0; i < n; i += pas) {
    meilleure = Math.min(meilleure, apparierDepuis(a, b, i, Infinity), apparierDepuis(b, a, i, Infinity));
  }
  return ecartMoyen(meilleure);
}

// ------------------------------------------------------------------------
// Reconnaître
// ------------------------------------------------------------------------

/** Le rayon d'un nuage : l'écart moyen de ses points à son barycentre (l'origine), en interlignes. */
export function rayon(points) {
  return Math.sqrt(points.reduce((s, [x, y]) => s + x * x + y * y, 0) / Math.max(1, points.length));
}

/**
 * Le signe fait de ces traits (en pixels de la page), d'après tes gabarits.
 * `parmi` : les étiquettes possibles à cet endroit (un chiffre ne s'écrit
 * qu'en tête de ligne). Rend null sans gabarit à comparer, sinon
 * { etiquette, distance, ecart, seconde, verdict } :
 *  - distance : l'écart au plus proche exemple, rapporté au rayon du signe
 *    (voir SEUILS) ; ecart : le même en interlignes ;
 *  - verdict « sur » : reconnu, nettement ; « juste » : reconnu de justesse
 *    (assez loin, ou une autre étiquette presque aussi proche) ;
 *  - « rejete » : trop loin de tout (etiquette est alors null) ;
 *  - seconde : la plus proche des autres étiquettes, si elle compte.
 */
export function reconnaitre(gabarits, traits, il, { parmi = null } = {}) {
  const exemples = ((gabarits && gabarits.exemples) || []).filter((e) => !parmi || parmi.includes(e.etiquette));
  if (!exemples.length) return null;
  const points = nuage(preparerTraits(traits), il);
  if (!points) return null;
  const signe = { points, lut: table(points) };
  // Un point n'a presque pas de rayon : un vingtième d'interligne au moins, pour ne pas diviser par zéro.
  const r = Math.max(rayon(points), 0.05);
  // Au-delà du rejet, aucune étiquette ne compte : l'appariement s'arrête là.
  const plafond = (SEUILS.rejet * r) ** 2 * POIDS * (1 + 1e-9);
  const parEtiquette = new Map();
  for (const e of exemples) {
    const avant = parEtiquette.has(e.etiquette) ? parEtiquette.get(e.etiquette) : plafond;
    const d = apparier(signe, prepare(e), avant);
    if (d < avant) parEtiquette.set(e.etiquette, d);
  }
  const classees = [...parEtiquette.entries()].map(([etiquette, s]) => ({ etiquette, ecart: ecartMoyen(s) }))
    .sort((a, b) => a.ecart - b.ecart || (a.etiquette < b.etiquette ? -1 : 1));
  const arrondir = (x) => Math.round(x * 1000) / 1000;
  if (!classees.length) return { etiquette: null, distance: null, ecart: null, seconde: null, verdict: "rejete" };
  const [premiere, seconde] = classees;
  const nette = !seconde || premiere.ecart <= SEUILS.marge * seconde.ecart;
  return {
    etiquette: premiere.etiquette,
    distance: arrondir(premiere.ecart / r),
    ecart: arrondir(premiere.ecart),
    seconde: seconde ? { etiquette: seconde.etiquette, distance: arrondir(seconde.ecart / r) } : null,
    verdict: premiere.ecart / r <= SEUILS.sur && nette ? "sur" : "juste",
  };
}

// ------------------------------------------------------------------------
// Apprendre
// ------------------------------------------------------------------------

/** Un identifiant tiré du contenu : le même exemple appris sur deux appareils ne compte qu'une fois. */
function identifiant(etiquette, points) {
  let h = 2166136261;
  const texte = etiquette + ":" + points.map((p) => p.join(",")).join(";");
  for (let i = 0; i < texte.length; i++) { h ^= texte.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Au plus `max` exemples par étiquette : les plus anciens partent les premiers. */
function borner(exemples, max) {
  const restants = new Map();
  for (const e of exemples) restants.set(e.etiquette, (restants.get(e.etiquette) || 0) + 1);
  return exemples.filter((e) => {
    const n = restants.get(e.etiquette);
    if (n > max) { restants.set(e.etiquette, n - 1); return false; }
    return true;
  });
}

/**
 * De nouveaux gabarits, avec un exemple de plus : les traits d'un signe (en
 * pixels de sa page), son étiquette et l'interligne de sa page. Pour apprendre
 * d'une correction : le signe que le lecteur avait mal lu, avec ce que tu as
 * répondu. `max` : au plus tant d'exemples par étiquette (24 : de quoi suivre
 * ton écriture, sans que les gabarits grossissent sans fin).
 */
export function ajouterExemple(gabarits, traits, etiquette, il, { source = "correction", max = 24 } = {}) {
  if (!ETIQUETTES[etiquette]) throw new Error(`Étiquette inconnue : « ${etiquette} ».`);
  const base = gabarits && Array.isArray(gabarits.exemples) ? gabarits : gabaritsVides();
  const points = nuage(preparerTraits(traits), il);
  if (!points) return base;
  const exemple = { id: identifiant(etiquette, points), etiquette, source, points };
  if (base.exemples.some((e) => e.id === exemple.id)) return base;
  return { ...base, version: VERSION_GABARITS, exemples: borner([...base.exemples, exemple], max) };
}

/**
 * Les gabarits de deux appareils, réunis : chaque exemple une fois (par son
 * identifiant), ceux de `a` d'abord. Pour la synchronisation, à la place du
 * plus récent qui écrase l'autre (un exemple appris sur le téléphone serait perdu).
 */
export function fusionnerGabarits(a, b, { max = 24 } = {}) {
  const vus = new Set();
  const exemples = [];
  for (const e of [...((a && a.exemples) || []), ...((b && b.exemples) || [])]) {
    if (!e || !ETIQUETTES[e.etiquette] || vus.has(e.id)) continue;
    vus.add(e.id);
    exemples.push(e);
  }
  return { version: VERSION_GABARITS, exemples: borner(exemples, max) };
}

// ------------------------------------------------------------------------
// La page d'étalonnage
// ------------------------------------------------------------------------

/**
 * Ce que tu as écrit sur une page d'étalonnage, en gabarits. Chaque case de
 * la calibration (`cal.cases`) a son étiquette ; les traits qui y tombent (par
 * le centre de leur boîte) se regroupent en exemples de gauche à droite : un
 * trait qui chevauche le précédent (à une demi-interligne près) fait partie
 * du même signe, comme les quatre traits d'un dièse. Un exemple démesuré
 * (plus de 5 interlignes : une rature, une flèche) est écarté.
 * @returns {{ gabarits, cases: [{ etiquette, nom, exemples, traits }], ignores: number[], ecartes: number[][] }}
 *   `traits` : les numéros des traits de chaque exemple ; `ignores` : les
 *   traits hors des cases ; `ecartes` : les exemples démesurés.
 */
export function lireEtalonnage(traitsBruts, cal, gabarits = gabaritsVides()) {
  if (!cal || cal.genre !== "etalonnage" || !Array.isArray(cal.cases)) throw new Error("Ce n'est pas une page d'étalonnage.");
  const il = cal.interligne;
  const traits = preparerTraits(traitsBruts, cal.page).map((points, id) => ({ id, points, ...(points.length ? boite(points) : {}) }));
  const parCase = cal.cases.map(() => []);
  const ignores = [];
  for (const t of traits) {
    if (!t.points.length) continue;
    const k = cal.cases.findIndex((c) => t.cx >= c.x0 && t.cx <= c.x1 && t.cy >= c.y0 && t.cy <= c.y1);
    if (k < 0) ignores.push(t.id);
    else parCase[k].push(t);
  }
  let appris = gabarits && Array.isArray(gabarits.exemples) ? gabarits : gabaritsVides();
  const ecartes = [];
  const cases = cal.cases.map((c, k) => {
    const groupes = [];
    for (const t of [...parCase[k]].sort((a, b) => a.x0 - b.x0 || a.id - b.id)) {
      const g = groupes[groupes.length - 1];
      if (g && t.x0 <= g.x1 + 0.5 * il) { g.traits.push(t); g.x1 = Math.max(g.x1, t.x1); }
      else groupes.push({ traits: [t], x1: t.x1 });
    }
    const gardes = [];
    for (const g of groupes) {
      const b = boite(g.traits.flatMap((t) => t.points));
      if (b.l > 5 * il || b.h > 5 * il) { ecartes.push(g.traits.map((t) => t.id)); continue; }
      appris = ajouterExemple(appris, g.traits.map((t) => t.points), c.etiquette, il, { source: "etalonnage" });
      gardes.push(g.traits.map((t) => t.id));
    }
    return { etiquette: c.etiquette, nom: c.nom, exemples: gardes.length, traits: gardes };
  });
  return { gabarits: appris, cases, ignores, ecartes };
}
