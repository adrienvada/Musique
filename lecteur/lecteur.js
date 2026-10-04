/**
 * LE LECTEUR : des traits de la tablette à la partition.
 *
 * Entrée : les traits d'une ou plusieurs pages (listes de points en pixels
 * de l'écran) et la calibration du modèle (position de chaque ligne).
 * Sortie : une partition structurée (portées, mesures, notes, silences),
 * que abc.js transforme en texte ABC, et la liste des doutes.
 *
 * LA MÉTHODE, dans l'ordre :
 *   1. les têtes : petits gribouillis compacts (pleines) ou petites boucles
 *      fermées (vides) ; la hauteur vient de la calibration ;
 *   2. chaque autre trait est simplifié en segments (Ramer-Douglas-Peucker) :
 *      un même trait peut contenir une hampe ET une ligature ;
 *   3. hampes : segments verticaux qui partent d'une tête ;
 *   4. barres de mesure : segments verticaux sans tête qui traversent la portée ;
 *   5. ligatures : segments obliques qui relient des bouts de hampes ;
 *   6. le reste est un « signe » : crochet, point, silence, altération,
 *      accent, chiffre… reconnu d'après sa taille, sa forme et sa place.
 *
 * Tous les seuils s'expriment en interlignes : ils valent pour tous les
 * modèles, larges ou serrés. Ils ont été réglés sur les pages d'essai du
 * 30/09 (tests/pages/) ; une valeur changée doit garder ces tests au vert.
 */
import { angle, boite, dist, distSegment, longueur, retournements, simplifier, xA } from "./geometrie.js";
import { preparerTraits } from "./traits.js";

const NOMS = ["C", "D", "E", "F", "G", "A", "B"];
const NOMS_FR = ["do", "ré", "mi", "fa", "sol", "la", "si"];

/**
 * Les marges des décisions limites (L2) : une lecture prise au ras d'un seuil
 * est gardée, mais devient une question fermée qui propose l'autre lecture.
 * Réglées le 04/10 sur tes deux pages et sur des milliers de pages perturbées
 * (bruit, rotation, arrondi) : assez larges pour qu'une lecture qui bascule
 * ne bascule jamais en silence, assez étroites pour ne pas te noyer de
 * questions sur une page bien lue. Exportées pour ces essais ; le lecteur,
 * lui, ne les modifie jamais.
 */
export const MARGES = {
  // Hauteur : une tête à plus de 0,4 demi-interligne de sa place (le
  // maximum est 0,5, où elle change de note) est « entre deux notes ».
  hauteur: 0.4,
  // Ligature : écart, en interlignes, entre son bout et une hampe ; la
  // tolérance est de 0,55 (voir l'étape 5 de lirePage).
  ligature: [0.3, 0.7],
  // Tête pleine : longueur du trait sur (largeur + hauteur), au-delà de 2,3 ;
  // en dessous de cette valeur, la tête l'est de justesse.
  rapportTete: 2.4,
  // Point de durée : distance à sa tête, en interlignes ; il compte jusqu'à 2,2.
  point: [1.9, 2.6],
};
// Tonalités selon le nombre de bémols ou de dièses à l'armure.
const TONALITES_BEMOLS = ["C", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
const TONALITES_DIESES = ["C", "G", "D", "A", "E", "B", "F#", "C#"];

// ------------------------------------------------------------------------
// Portées
// ------------------------------------------------------------------------

/**
 * Degré (0 = do) et octave (4 = octave du do central) d'un nom de note
 * (« mi4 », « sol2 », « fa3 »). La ligne du bas de chaque portée est écrite
 * ainsi dans la calibration : lire le nom plutôt qu'une table des clés connues
 * laisse un futur modèle en clé d'ut se lire sans toucher au lecteur (avant,
 * une clé autre que sol ou fa faisait planter la lecture).
 */
export function degreOctave(nom) {
  const m = /^(do|ré|re|mi|fa|sol|la|si)(-?\d)$/.exec(String(nom || ""));
  if (!m) throw new Error(`Calibration illisible : « ${nom} » n'est pas un nom de note (mi4, sol2…).`);
  return [NOMS_FR.indexOf(m[1] === "re" ? "ré" : m[1]), Number(m[2])];
}

/**
 * Une calibration se lit-elle comme une partition ? Elle doit avoir un
 * interligne et au moins une portée de cinq lignes. Une page d'étalonnage
 * (L16) n'a que des cases : elle se lit avec lireEtalonnage (gabarits.js).
 * Sans cette vérification, une calibration incomplète donnait une lecture
 * vide sans rien dire, ou un plantage incompréhensible.
 */
export function verifierCalibration(cal) {
  if (!cal || typeof cal !== "object") throw new Error("Pas de calibration : impossible de savoir où sont les lignes.");
  if (cal.genre === "etalonnage") throw new Error("C'est une page d'étalonnage : elle sert à apprendre ton écriture, pas à lire une partition.");
  if (!(cal.interligne > 0)) throw new Error(`Calibration incomplète (${cal.modele || "modèle inconnu"}) : l'interligne manque.`);
  const systemes = Array.isArray(cal.systemes) ? cal.systemes : [];
  if (!systemes.length || systemes.some((s) => !Array.isArray(s.portees) || !s.portees.length)) {
    throw new Error(`Calibration incomplète (${cal.modele || "modèle inconnu"}) : aucune portée.`);
  }
  for (const s of systemes) {
    for (const p of s.portees) {
      if (!Array.isArray(p.lignes) || p.lignes.length !== 5 || p.lignes.some((y) => !Number.isFinite(y))) {
        throw new Error(`Calibration incomplète (${cal.modele || "modèle inconnu"}) : une portée n'a pas ses cinq lignes.`);
      }
      degreOctave(p.ligne_du_bas);
    }
  }
}

function listerPortees(cal) {
  verifierCalibration(cal);
  const portees = [];
  cal.systemes.forEach((s, is) => {
    s.portees.forEach((p, ip) => {
      portees.push({
        index: portees.length,
        systeme: is,
        voix: ip,
        cle: p.cle,
        ligneDuBas: p.ligne_du_bas,
        bas0: degreOctave(p.ligne_du_bas),
        lignes: p.lignes,
        haut: p.lignes[0],
        bas: p.lignes[4],
      });
    });
  });
  return portees;
}

/** La portée à laquelle appartient une ordonnée : la plus proche de sa bande. */
function porteeDe(portees, y) {
  let meilleure = null, dmin = Infinity;
  for (const p of portees) {
    const d = y < p.haut ? p.haut - y : y > p.bas ? y - p.bas : 0;
    if (d < dmin) { dmin = d; meilleure = p; }
  }
  return meilleure;
}

/** Demi-interlignes au-dessus de la ligne du bas (0 = sur la ligne du bas). */
function pasDe(portee, y, il) {
  return (portee.bas - y) / (il / 2);
}

function nomDePas(portee, pas) {
  const [degre0, octave0] = portee.bas0 || degreOctave(portee.ligneDuBas);
  const rang = degre0 + pas;
  return { lettre: NOMS[((rang % 7) + 7) % 7], octave: octave0 + Math.floor(rang / 7) };
}

// ------------------------------------------------------------------------
// 1. Têtes
// ------------------------------------------------------------------------

function mesurer(points, id) {
  if (!points.length) return { id, points, x0: 0, y0: 0, x1: 0, y1: 0, l: 0, h: 0, cx: 0, cy: 0, longueur: 0, ferme: 0, vide: true };
  const b = boite(points);
  const l = longueur(points);
  return { id, points, ...b, longueur: l, ferme: dist(points[0], points[points.length - 1]) };
}

/**
 * Une tête pleine : un gribouillis compact, bien plus long que sa taille.
 * La largeur minimale était de 0,35 interligne, et une de tes têtes de la
 * mélodie en fait 0,353 : arrondie au demi-pixel avec une autre phase, elle
 * disparaissait quatre fois sur dix (audit du 04/10). Elle descend à 0,25 ;
 * pour qu'un point (de durée) ne devienne jamais une tête, la tête doit
 * mesurer au moins 0,45 interligne dans un sens, la taille au-delà de
 * laquelle un trait n'est plus un point (estPoint).
 */
function estTetePleine(t, il) {
  const compacte = t.l > 0.25 * il && t.l < 1.5 * il && t.h > 0.3 * il && t.h < 1.4 * il && Math.max(t.l, t.h) >= 0.45 * il;
  return compacte && t.longueur > 2.3 * (t.l + t.h);
}

function estTeteVide(t, il) {
  const compacte = t.l > 0.5 * il && t.l < 1.6 * il && t.h > 0.4 * il && t.h < 1.3 * il;
  const boucle = t.ferme < 0.4 * Math.max(t.l, t.h);
  const tour = t.longueur > 1.2 * (t.l + t.h) && t.longueur <= 2.3 * (t.l + t.h);
  return compacte && boucle && tour;
}

/** Un point (de durée ou de reprise) : un tout petit trait, court. */
function estPoint(t, il) {
  return Math.max(t.l, t.h) < 0.45 * il && t.longueur < 1.6 * il;
}

/**
 * Les traits repassés : [repassé, original]. Un trait B est un doublon de A
 * quand tous ses points sont à moins de `tol` du tracé de A et qu'il n'est
 * pas plus long que lui (B ne prolonge pas A : une retouche qui allonge une
 * hampe reste lue comme telle plus loin). Deux traits identiques : le second
 * est le doublon. Les formes de tête ne comptent pas (voir lirePage).
 */
function doublons(traits, formes, tol) {
  const sortie = [];
  const pris = new Set();
  const dedans = (b, a) => b.points.every((p) => {
    for (let i = 1; i < a.points.length; i++) if (distSegment(p, a.points[i - 1], a.points[i]) < tol) return true;
    return a.points.length === 1 && dist(p, a.points[0]) < tol;
  });
  for (const b of traits) {
    if (b.vide) continue;
    for (const a of traits) {
      // Une tête repassée sur une tête, un trait sur un trait : jamais un trait sur une tête.
      if (a === b || a.vide || !formes[a.id] !== !formes[b.id] || pris.has(a.id)) continue;
      if (b.x0 < a.x0 - tol || b.x1 > a.x1 + tol || b.y0 < a.y0 - tol || b.y1 > a.y1 + tol) continue;
      if (b.longueur > 1.1 * a.longueur + tol) continue;
      // Deux traits identiques : le premier reste, le second est le doublon.
      if (dedans(b, a) && (!dedans(a, b) || a.id < b.id)) { sortie.push([b, a]); pris.add(b.id); break; }
    }
  }
  return sortie;
}

/** Plusieurs coups de stylo pour noircir une même tête : on les réunit. */
function fusionnerTetes(tetes, il) {
  const groupes = [];
  for (const t of tetes.sort((a, b) => a.x0 - b.x0)) {
    const g = groupes.find((g) => g.pleine === t.pleine && Math.hypot(g.cx - t.cx, g.cy - t.cy) < 0.6 * il);
    if (g) {
      g.traits.push(t.id);
      g.x0 = Math.min(g.x0, t.x0); g.x1 = Math.max(g.x1, t.x1);
      g.y0 = Math.min(g.y0, t.y0); g.y1 = Math.max(g.y1, t.y1);
      g.cx = (g.x0 + g.x1) / 2; g.cy = (g.y0 + g.y1) / 2;
    } else {
      groupes.push({ traits: [t.id], pleine: t.pleine, x0: t.x0, x1: t.x1, y0: t.y0, y1: t.y1, cx: t.cx, cy: t.cy });
    }
  }
  return groupes;
}

// ------------------------------------------------------------------------
// Lecture d'une page
// ------------------------------------------------------------------------

export function lirePage(traitsBruts, cal, numeroPage = 1) {
  const portees = listerPortees(cal);
  const il = cal.interligne;
  // Au demi-pixel, sans point invalide (traits.js) : la même page se lit
  // toujours de la même façon, qu'elle vienne du PDF, du connecteur ou de la bibliothèque.
  const traits = preparerTraits(traitsBruts, cal.page).map((pts, i) => mesurer(pts, i));
  const classe = traits.map((t) => (t.vide ? "vide" : null)); // ce qu'est devenu chaque trait

  // 0. Les formes de tête, et les traits repassés. Un trait repassé à
  //    l'identique (ou presque) sur un autre n'est pas un nouveau signe : une
  //    hampe repassée devenait une barre de mesure, un bémol d'armure repassé
  //    un dièse (trop de traits), un point repassé n'était plus un point. On
  //    l'écarte avant tout le reste. Une tête repassée aussi : sa boîte
  //    grandissait, et sa hauteur pouvait changer. Mais jamais un petit trait
  //    contre une tête : le second coup de stylo d'une tête en fait partie.
  const formes = traits.map((t) => (t.vide ? null : estTetePleine(t, il) ? "pleine" : estTeteVide(t, il) ? "vide" : null));
  for (const [b, a] of doublons(traits, formes, 0.15 * il)) {
    classe[b.id] = "doublon";
    b.doublonDe = a.id;
  }

  // 1. Têtes
  const candidates = [];
  for (const t of traits) {
    if (classe[t.id] || !formes[t.id]) continue;
    candidates.push({ ...t, pleine: formes[t.id] === "pleine" });
  }
  const tetes = fusionnerTetes(candidates, il).map((t, i) => {
    const portee = porteeDe(portees, t.cy);
    const exact = pasDe(portee, t.cy, il);
    // Le plus « gribouillé » de ses traits : près de 2,3, la tête l'est de justesse (L2).
    const rapport = Math.max(...t.traits.map((id) => traits[id].longueur / Math.max(1e-6, traits[id].l + traits[id].h)));
    return { ...t, id: i, portee: portee.index, pas: Math.round(exact), ecart: exact - Math.round(exact), rapport };
  });
  for (const t of tetes) for (const id of t.traits) classe[id] = "tete";
  // Un petit trait posé sur une tête (retouche, second passage) en fait partie.
  // Un trait de la taille d'un point n'en fait partie que s'il tombe dans la
  // tête elle-même : juste à côté, c'est le point d'une note pointée (avant,
  // il était avalé par la tête à 0,25 interligne près, et la note perdait son point).
  for (const t of traits) {
    if (classe[t.id] || Math.max(t.l, t.h) > 1.2 * il) continue;
    const marge = estPoint(t, il) ? 0 : 0.25 * il;
    const tete = tetes.find((u) => t.cx > u.x0 - marge && t.cx < u.x1 + marge && t.cy > u.y0 - marge && t.cy < u.y1 + marge);
    if (tete) { tete.traits.push(t.id); classe[t.id] = "tete"; }
  }

  // 2. Segments des autres traits. Une hampe légèrement coudée donne deux
  //    segments presque alignés : on les recolle, sinon aucun n'est assez long.
  const segments = [];
  for (const t of traits) {
    if (classe[t.id]) continue;
    const s = recoller(simplifier(t.points, 0.14 * il));
    for (let k = 1; k < s.length; k++) {
      const a = s[k - 1], b = s[k];
      segments.push({ trait: t.id, rang: k - 1, nb: s.length - 1, a, b, lg: dist(a, b), ang: angle(a, b), role: null });
    }
  }

  // 3. Hampes : un segment vertical, une tête à un bout.
  const hampes = [];
  const verticaux = segments.filter((s) => s.ang > 62 && s.lg >= 1.4 * il);
  const paires = [];
  for (const s of verticaux) {
    const [haut, bas] = s.a[1] < s.b[1] ? [s.a, s.b] : [s.b, s.a];
    for (const t of tetes) {
      for (const [bout, loin, dir] of [[bas, haut, "haut"], [haut, bas, "bas"]]) {
        const dy = Math.abs(t.cy - bout[1]);
        if (dy > 1.0 * il) continue;
        const dx = xA(s.a, s.b, t.cy) - t.cx;
        if (Math.abs(dx) > 1.35 * il) continue;
        if (Math.abs(loin[1] - t.cy) < 1.5 * il) continue;
        // Côté attendu : hampe montante à droite de la tête, descendante à gauche.
        const cote = dir === "haut" ? (dx >= -0.2 * il ? 0 : 0.8) : (dx <= 0.2 * il ? 0 : 0.8);
        paires.push({ s, t, dir, cout: dy / il + Math.abs(Math.abs(dx) - 0.55 * il) / il + cote, bout, loin });
      }
    }
  }
  paires.sort((a, b) => a.cout - b.cout);
  const tetePrise = new Set(), segPris = new Set();
  for (const p of paires) {
    if (tetePrise.has(p.t.id) || segPris.has(p.s)) continue;
    tetePrise.add(p.t.id); segPris.add(p.s);
    p.s.role = "hampe";
    hampes.push({ id: hampes.length, seg: p.s, dir: p.dir, tetes: [p.t], pied: p.bout, bout: p.loin, x: (p.s.a[0] + p.s.b[0]) / 2, crochets: 0, ligatures: [] });
  }
  // Accords : d'autres têtes empilées le long de la même hampe. La hampe doit
  // dépasser la note du haut d'un peu plus d'une tête (0,8 interligne) : il
  // fallait plus de 2 interlignes, et un accord à hampe courte se lisait en
  // notes séparées (L10). Une tête qui a sa propre hampe n'est jamais prise.
  for (const h of hampes) {
    const [ya, yb] = [h.pied[1], h.bout[1]].sort((a, b) => a - b);
    for (const t of tetes) {
      if (tetePrise.has(t.id)) continue;
      const dx = xA(h.seg.a, h.seg.b, t.cy) - t.cx;
      const dansHampe = t.cy > ya - 0.8 * il && t.cy < yb + 0.8 * il && Math.abs(t.cy - h.bout[1]) > 0.8 * il;
      if (Math.abs(dx) < 1.35 * il && dansHampe && h.tetes.some((u) => Math.abs(u.cx - t.cx) < 1.2 * il)) {
        h.tetes.push(t); tetePrise.add(t.id);
      }
    }
  }
  for (const t of tetes) t.hampe = hampes.find((h) => h.tetes.includes(t)) || null;

  // Pauses et demi-pauses (L12) : un petit pavé noirci, nettement plus large
  // que haut, pendu sous la 4ᵉ ligne (pause) ou posé sur la 3ᵉ (demi-pause).
  // Il ressemble à une tête pleine sans hampe, et était lu comme une noire :
  // c'est sa forme et sa place qui le distinguent. Tes têtes ne sont jamais
  // plus larges qu'une fois et quart leur hauteur (pages du 30/09).
  const repos = [];
  for (let i = tetes.length - 1; i >= 0; i--) {
    const t = tetes[i];
    if (t.hampe || !t.pleine) continue;
    const l = t.x1 - t.x0, h = t.y1 - t.y0;
    if (l < 1.4 * h || h > 0.6 * il || l < 0.5 * il || l > 1.6 * il) continue;
    const p = portees[t.portee];
    const pendue = Math.abs(t.y0 - p.lignes[1]) < 0.25 * il && t.y1 > p.lignes[1];
    const posee = Math.abs(t.y1 - p.lignes[2]) < 0.25 * il && t.y0 < p.lignes[2];
    if (!pendue && !posee) continue;
    const pause = pendue && (!posee || Math.abs(t.y0 - p.lignes[1]) < Math.abs(t.y1 - p.lignes[2]));
    repos.push({ nature: pause ? "pause" : "demi-pause", portee: p.index, traits: t.traits, x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1, cx: t.cx, cy: t.cy });
    for (const id of t.traits) classe[id] = "silence";
    tetes.splice(i, 1);
  }

  // Retouches : un trait repassé sur une hampe ou une barre, ou qui la
  // prolonge de quelques millimètres, n'est pas un nouveau signe.
  const colleA = (s, lignes) => {
    const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]);
    return lignes.some((v) => {
      const vy0 = Math.min(v.a[1], v.b[1]), vy1 = Math.max(v.a[1], v.b[1]);
      const x = xA(v.a, v.b, (y0 + y1) / 2);
      const recouvre = Math.min(y1, vy1 + 0.6 * il) - Math.max(y0, vy0 - 0.6 * il);
      return Math.abs(x - (s.a[0] + s.b[0]) / 2) < 0.4 * il && recouvre > 0.5 * s.lg;
    });
  };
  // 3b. Retouches de hampe, avant les barres : une hampe repassée qui traverse
  //     la portée devenait une barre de mesure. Elles font au moins une
  //     demi-interligne : plus court, c'est le point d'une noire pointée,
  //     posé juste à côté d'une hampe montante, que la retouche avalait.
  const lignesHampes = hampes.map((h) => ({ a: h.seg.a, b: h.seg.b }));
  for (const s of segments) {
    if (s.role || s.ang < 65 || s.lg < 0.5 * il) continue;
    if (colleA(s, lignesHampes)) s.role = "retouche";
  }

  // 4. Barres de mesure : verticales sans tête, qui traversent une portée.
  const barres = [];
  for (const s of segments) {
    if (s.role || s.ang < 70) continue;
    const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]);
    const x = (s.a[0] + s.b[0]) / 2;
    // Une barre va d'une ligne extérieure à l'autre (à trois quarts
    // d'interligne près ; la plus courte de tes pages s'arrête à 0,57) : une
    // hampe sans tête, partie du milieu de la portée, n'en est pas une (L8).
    const couvertes = portees.filter((p) => {
      const recouvre = Math.min(y1, p.bas) - Math.max(y0, p.haut);
      return recouvre >= 0.7 * (p.bas - p.haut) && y0 <= p.haut + 0.75 * il && y1 >= p.bas - 0.75 * il && x > cal.x_debut && x < cal.x_fin + il;
    });
    if (!couvertes.length) continue;
    s.role = "barre";
    for (const p of couvertes) barres.push({ portee: p.index, x, y0, y1, traits: [s.trait] });
  }

  // 4b. Retouches de barre, de toute longueur.
  const lignesBarres = segments.filter((s) => s.role === "barre").map((s) => ({ a: s.a, b: s.b }));
  for (const s of segments) {
    if (s.role || s.ang < 65) continue;
    if (colleA(s, lignesBarres)) s.role = "retouche";
  }
  // Une retouche qui prolonge une hampe au-delà de son bout (pour rejoindre
  // la ligature, typiquement) déplace ce bout : sinon la hampe « s'arrête »
  // avant la ligature et la note perd sa durée (page de piano du 30/09).
  for (const s of segments) {
    if (s.role !== "retouche") continue;
    for (const h of hampes) {
      const x = xA(h.seg.a, h.seg.b, (s.a[1] + s.b[1]) / 2);
      if (Math.abs(x - (s.a[0] + s.b[0]) / 2) > 0.4 * il) continue;
      const sens = Math.sign(h.bout[1] - h.pied[1]); // +1 : hampe descendante
      const loin = sens > 0 ? (s.a[1] > s.b[1] ? s.a : s.b) : (s.a[1] < s.b[1] ? s.a : s.b);
      const depasse = (loin[1] - h.bout[1]) * sens;
      const proche = Math.min(Math.abs(s.a[1] - h.bout[1]), Math.abs(s.b[1] - h.bout[1])) < 0.8 * il;
      if (depasse > 0 && proche) h.bout = [loin[0], loin[1]];
    }
  }

  // 5. Ligatures : segments qui passent par les bouts de plusieurs hampes.
  // Une ligature touche une hampe si elle passe au-dessus (ou en dessous) de
  // son bout. La main s'arrête souvent un peu avant la dernière hampe (jusqu'à
  // 0,34 interligne sur les pages du 30/09), mais une ligature qui finit
  // 0,72 interligne avant la hampe du groupe suivant ne la prend pas
  // (mélodie du 30/09, 3ᵉ ligne) : on tolère 0,55 interligne.
  // `contact` : de combien la ligature s'arrête avant la hampe (dx, 0 si elle
  // passe au-dessus) et à quelle distance elle passe de son bout (dv).
  const contact = (s, h) => {
    const x = h.bout[0];
    const [sx0, sx1] = [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])];
    const dx = x < sx0 ? sx0 - x : x > sx1 ? x - sx1 : 0;
    const yl = yA(s.a, s.b, x);
    const sens = Math.sign(h.pied[1] - h.bout[1]) || 1;
    const y0 = h.bout[1], y1 = h.bout[1] + sens * Math.min(1.8 * il, dist(h.bout, h.pied));
    const bas = Math.min(y0, y1), haut = Math.max(y0, y1);
    return { dx, dv: yl < bas ? bas - yl : yl > haut ? yl - haut : 0 };
  };
  const touche = (s, h, tolerance) => { const c = contact(s, h); return c.dx <= 0.55 * il && c.dv < tolerance; };
  const ligatures = [];
  const candidatsLig = segments.filter((s) => !s.role && s.ang <= 60 && s.lg >= 0.7 * il);
  for (const s of candidatsLig) {
    const reliees = hampes.filter((h) => touche(s, h, 0.8 * il));
    if (reliees.length >= 2) {
      s.role = "ligature";
      ligatures.push({ id: ligatures.length, seg: s, hampes: reliees });
    }
  }
  // Une ligature tracée en deux fois : le second morceau prolonge le premier.
  for (const s of candidatsLig) {
    if (s.role) continue;
    const reliees = hampes.filter((h) => touche(s, h, 0.8 * il));
    const prolonge = ligatures.find((l) => alignes(l.seg, s, 0.5 * il));
    if (prolonge && (reliees.length || s.lg < 2 * il)) {
      s.role = "ligature";
      ligatures.push({ id: ligatures.length, seg: s, hampes: reliees, suite: prolonge.id });
    }
  }
  // Niveau de ligature de chaque hampe : 1 = croches, 2 = doubles croches.
  for (const h of hampes) {
    h.ligatures = ligatures.filter((l) => l.hampes.includes(h));
    h.niveaux = niveauxDe(h, h.ligatures, il);
  }
  // Ligatures au ras d'une hampe (L2). Sur ta mélodie, deux ligatures
  // s'arrêtent à 0,47 et 0,48 interligne d'une hampe, pour une tolérance de
  // 0,55 : la note est lue liée (croche), mais l'image montre peut-être une
  // noire. Entre 0,3 et 0,7 interligne, la lecture est gardée et devient une
  // question (« Croche liée ou noire ? »), avec l'autre durée en réponse.
  for (const h of hampes) {
    for (const l of ligatures) {
      const { dx, dv } = contact(l.seg, h);
      if (l.hampes.includes(h)) {
        if (dx >= MARGES.ligature[0] * il && (!h.limiteLigature || dx > h.limiteLigature.ecart)) h.limiteLigature = { ecart: dx, lue: "liee", ligature: l };
      } else if (!h.ligatures.length && dx > 0.55 * il && dx <= MARGES.ligature[1] * il && dv < 0.8 * il) {
        if (!h.limiteLigature || dx < h.limiteLigature.ecart) h.limiteLigature = { ecart: dx, lue: "seule", ligature: l };
      }
    }
  }
  // Groupe de ligature : les hampes reliées, de proche en proche.
  const groupe = new Map();
  const racine = (id) => (groupe.get(id) === id || groupe.get(id) === undefined ? id : racine(groupe.get(id)));
  for (const l of ligatures) {
    const ids = l.hampes.map((h) => h.id);
    if (l.suite !== undefined) ids.push(...ligatures[l.suite].hampes.map((h) => h.id));
    for (const id of ids) if (!groupe.has(id)) groupe.set(id, id);
    for (const id of ids.slice(1)) groupe.set(racine(id), racine(ids[0]));
  }
  for (const h of hampes) h.groupe = groupe.has(h.id) ? racine(h.id) : null;
  // Petits traits repassés le long d'une ligature.
  for (const s of segments) {
    if (s.role || s.ang > 65 || s.lg > 2 * il) continue;
    if (ligatures.some((l) => alignes(l.seg, s, 0.5 * il))) s.role = "retouche";
  }

  // 6. Signes : ce qui reste, trait par trait (les morceaux de trait
  //    qui ne sont ni hampe, ni barre, ni ligature, ni retouche).
  const morceaux = [];
  const parTrait = new Map();
  for (const s of segments) {
    if (!parTrait.has(s.trait)) parTrait.set(s.trait, []);
    parTrait.get(s.trait).push(s);
  }
  for (const [id, segs] of parTrait) {
    const libres = segs.filter((s) => !s.role);
    const roles = segs.filter((s) => s.role).map((s) => s.role);
    classe[id] = libres.length === segs.length ? "signe" : roles.find((r) => r !== "retouche") || "retouche";
    if (!libres.length) continue;
    const entier = libres.length === segs.length;
    let courant = [];
    const pousser = () => {
      if (!courant.length) return;
      const pts = entier ? traits[id].points : [courant[0].a, ...courant.map((s) => s.b)];
      const lg = entier ? traits[id].longueur : courant.reduce((a, s) => a + s.lg, 0);
      // Petite bavure au bout d'une hampe ou d'une barre : on l'oublie.
      if (entier || lg >= 0.5 * il) morceaux.push({ traits: [id], partiel: !entier, points: pts, ...boite(pts), longueur: lg, nature: null });
      courant = [];
    };
    for (const s of segs) { if (s.role) pousser(); else courant.push(s); }
    pousser();
  }

  // Crochets : un morceau accroché au bout d'une hampe sans ligature, qui
  // s'en écarte franchement (un petit retour de stylo n'en est pas un).
  for (const g of morceaux) {
    for (const h of hampes) {
      if (h.ligatures.length) continue;
      const accroche = g.points.some((p) => dist(p, h.bout) < 0.8 * il);
      const ecart = Math.max(...g.points.map((p) => Math.abs(p[0] - xA(h.seg.a, h.seg.b, p[1]))));
      if (accroche && g.longueur >= 0.9 * il && ecart >= 0.4 * il && Math.max(g.l, g.h) < 3.2 * il) {
        g.nature = "crochet"; g.hampe = h;
        break;
      }
      // Trop petit pour trancher : la note reste une noire, mais on le signale.
      if (accroche && g.longueur >= 0.45 * il && g.longueur < 0.9 * il && ecart >= 0.2 * il) {
        g.nature = "crochet-douteux"; g.hampeDouteuse = h;
        break;
      }
    }
  }
  for (const h of hampes) {
    const cs = morceaux.filter((g) => g.hampe === h);
    // Deux crochets = double croche ; un crochet tracé en deux morceaux reste un crochet.
    h.crochets = cs.length >= 2 && Math.abs(Math.min(...cs.map((c) => c.cy)) - Math.max(...cs.map((c) => c.cy))) > 0.5 * il ? 2 : cs.length ? 1 : 0;
  }

  // Les autres morceaux se regroupent quand ils se touchent : un bémol se
  // trace souvent en deux (la barre, puis la boucle), un dièse en quatre.
  const libres = morceaux.filter((g) => !g.nature && !g.partiel);
  const signes = morceaux.filter((g) => g.nature || g.partiel);
  const pris = new Set();
  for (let i = 0; i < libres.length; i++) {
    if (pris.has(i)) continue;
    const groupe = [libres[i]]; pris.add(i);
    for (let k = 0; k < groupe.length; k++) {
      for (let j = 0; j < libres.length; j++) {
        if (pris.has(j)) continue;
        const a = groupe[k], b = libres[j];
        const voisins = b.x0 < a.x1 + 0.3 * il && a.x0 < b.x1 + 0.3 * il && b.y0 < a.y1 + 0.3 * il && a.y0 < b.y1 + 0.3 * il;
        const petits = Math.max(a.l, a.h, b.l, b.h) < 3 * il;
        // Les traits doivent vraiment se toucher : deux bémols côte à côte ne font pas un signe.
        if (voisins && petits && seTouchent(a.points, b.points, 0.22 * il)) { groupe.push(b); pris.add(j); }
      }
    }
    const pts = groupe.flatMap((g) => g.points);
    signes.push({ traits: groupe.flatMap((g) => g.traits), membres: groupe, partiel: false, points: pts, ...boite(pts), longueur: groupe.reduce((a, g) => a + g.longueur, 0), nature: null });
  }

  // Petits points : durée (à droite d'une tête) ou reprise (près d'une barre).
  for (const g of signes) {
    if (g.nature || g.partiel || (g.membres && g.membres.length > 1)) continue;
    if (Math.max(g.l, g.h) < 0.45 * il && g.longueur < 1.6 * il) g.nature = "point";
  }

  // Lignes supplémentaires : un trait court, droit, presque horizontal, hors
  // de la portée, à côté d'une tête. Elles disent à quelle portée une note
  // appartient quand elle tombe entre deux portées.
  const lignesSup = [];
  for (const g of signes) {
    if (g.nature || g.partiel || (g.membres && g.membres.length > 1)) continue;
    const droit = dist(g.points[0], g.points[g.points.length - 1]) / Math.max(g.longueur, 1e-6);
    if (droit < 0.9 || g.h > 0.45 * il || g.l < 0.6 * il || g.l > 3 * il) continue;
    const p = porteeDe(portees, g.cy);
    if (g.cy > p.haut - 0.6 * il && g.cy < p.bas + 0.6 * il) continue;
    if (!tetes.some((t) => t.cx > g.x0 - 0.5 * il && t.cx < g.x1 + 0.5 * il && Math.abs(t.cy - g.cy) < 2.6 * il)) continue;
    g.nature = "ligne-sup"; g.portee = p.index;
    lignesSup.push(g);
  }
  const lignesSupDe = (t) => lignesSup.filter((l) => t.cx > l.x0 - 0.5 * il && t.cx < l.x1 + 0.5 * il && Math.abs(l.cy - t.cy) < 2.6 * il);

  // La portée de chaque tête (L7). Dans sa bande (aux positions juste au-dessus
  // et juste au-dessous, qui n'ont pas besoin de ligne supplémentaire), c'est
  // la plus proche. Entre deux portées, la plus proche se trompait : le do6 de
  // la 2ᵉ portée, à deux lignes supplémentaires au-dessus d'elle, était lu sur
  // la 1ʳᵉ. Décident alors : les lignes supplémentaires (combien il en faut
  // pour rejoindre chaque portée, et celles qui sont entre la note et sa
  // portée), la hampe (elle pointe vers sa portée : vers le haut sous la
  // portée, vers le bas au-dessus), la ligature (ses autres notes).
  for (const t of tetes) {
    if (portees.some((p) => t.cy > p.haut - 0.75 * il && t.cy < p.bas + 0.75 * il)) continue;
    const dessus = portees.filter((p) => p.bas <= t.cy).sort((a, b) => b.bas - a.bas)[0];
    const dessous = portees.filter((p) => p.haut >= t.cy).sort((a, b) => a.haut - b.haut)[0];
    if (!dessus || !dessous) continue;
    let pour = 0; // > 0 : la portée du dessus, < 0 : celle du dessous
    const sup = lignesSupDe(t);
    if (sup.length) {
      const pourDessus = Math.floor((t.cy - dessus.bas) / il + 0.25), pourDessous = Math.floor((dessous.haut - t.cy) / il + 0.25);
      if (sup.length === pourDessus && sup.length !== pourDessous) pour += 2;
      if (sup.length === pourDessous && sup.length !== pourDessus) pour -= 2;
    }
    for (const l of sup) {
      if (l.cy > dessus.bas + 0.5 * il && l.cy < t.cy - 0.3 * il) pour += 2;
      if (l.cy < dessous.haut - 0.5 * il && l.cy > t.cy + 0.3 * il) pour -= 2;
    }
    if (t.hampe) pour += t.hampe.bout[1] < t.cy ? 1 : -1;
    if (t.hampe && t.hampe.groupe !== null) {
      for (const h of hampes) {
        if (h === t.hampe || h.groupe !== t.hampe.groupe) continue;
        const u = h.tetes[0];
        if (u.cy > dessus.haut && u.cy < dessus.bas + 0.6 * il) pour += 1;
        if (u.cy > dessous.haut - 0.6 * il && u.cy < dessous.bas) pour -= 1;
      }
    }
    const p = pour > 0 ? dessus : pour < 0 ? dessous : porteeDe(portees, t.cy);
    if (p.index === t.portee) continue;
    const exact = pasDe(p, t.cy, il);
    Object.assign(t, { portee: p.index, pas: Math.round(exact), ecart: exact - Math.round(exact) });
  }

  // Du texte n'est pas de la musique (L6) : un titre, des paroles, des
  // accords chiffrés, une nuance écrite à la main faisaient des rondes et des
  // noires. Une « tête » sans hampe ni ligne supplémentaire, hors de la portée,
  // est du texte si elle en est loin (plus de 2,5 interlignes), ou si une autre
  // boucle pareille est écrite à côté d'elle (les lettres d'un mot).
  const horsBande = (t) => { const p = portees[t.portee]; return (t.cy < p.haut ? p.haut - t.cy : t.cy > p.bas ? t.cy - p.bas : 0) / il; };
  const seules = tetes.filter((t) => !t.hampe && horsBande(t) > 0.75 && !lignesSupDe(t).length);
  const texte = new Set(seules.filter((t) => horsBande(t) > 2.5
    || seules.some((u) => u !== t && Math.abs(u.cy - t.cy) < 0.4 * il && Math.abs(u.cx - t.cx) < 1.6 * il)));
  for (let i = tetes.length - 1; i >= 0; i--) {
    if (!texte.has(tetes[i])) continue;
    for (const id of tetes[i].traits) classe[id] = "texte";
    tetes.splice(i, 1);
  }
  // Une tête sans hampe ni ligne supplémentaire, à plus d'un interligne de la portée : on la garde, mais on le demande.
  for (const t of seules) if (!texte.has(t) && horsBande(t) > 1.2) t.loin = true;

  // Zone d'en-tête de chaque portée (armure, chiffrage) : avant la première
  // note ou barre, et jamais plus de 9 interlignes après la clé imprimée
  // (sept dièses et un chiffrage y tiennent). Sans cette borne, une ligne dont
  // aucune tête n'était lue devenait tout entière un « en-tête », sans un doute.
  const finEnTete = (cal.x_apres_cle ?? cal.x_debut + 3.2 * il) + 9 * il;
  const debutMusique = portees.map((p) => {
    const xs = [
      ...hampes.filter((h) => h.tetes[0].portee === p.index).map((h) => Math.min(h.x, ...h.tetes.map((t) => t.x0))),
      ...tetes.filter((t) => t.portee === p.index).map((t) => t.x0),
      ...barres.filter((b) => b.portee === p.index).map((b) => b.x),
    ];
    return Math.min(xs.length ? Math.min(...xs) - 0.3 * il : Infinity, finEnTete);
  });

  const remplaces = [];
  for (const g of signes) {
    if (g.nature) continue;
    const p = porteeDe(portees, g.cy);
    g.portee = p.index;
    if (g.partiel) { g.nature = "reste"; continue; }
    const forme = formeAlteration(g, il);
    // Une hampe sans tête n'est pas un signe d'en-tête : plus longue que les
    // barres d'un dièse ou d'un bémol (2,7 interlignes au plus).
    const longueHampe = hampeSeule(g, il) && g.h >= 2.8 * il;
    if (g.x1 < debutMusique[p.index] && g.x0 > cal.x_debut && !longueHampe) {
      // Deux dièses d'armure qui se touchent ne font qu'un signe de huit
      // traits, qui n'était ni un dièse ni rien : la ligne passait en do (L10).
      const dieses = !forme ? separerDieses(g, il) : null;
      if (dieses) {
        g.nature = "separe";
        for (const d of dieses) remplaces.push({ ...d, portee: p.index, nature: "diese-armure", pas: hauteurAlteration(d, "diese", p, il) });
        continue;
      }
      g.nature = forme === "bemol" ? "bemol-armure" : forme === "diese" ? "diese-armure" : "entete";
      if (forme === "bemol" || forme === "diese") g.pas = hauteurAlteration(g, forme, p, il);
      continue;
    }
    const dansPortee = g.cy > p.haut - 0.6 * il && g.cy < p.bas + 0.6 * il;
    // L'altération va à la tête qui la suit, à sa hauteur : pour un bémol, celle de sa boucle.
    const pasG = forme ? hauteurAlteration(g, forme, p, il) : null;
    const voisines = forme ? tetes.filter((t) => t.portee === p.index && g.x1 < t.x0 + 0.3 * il && t.x0 - g.x1 < 1.6 * il && Math.abs(t.pas - pasG) <= 1.5) : [];
    const teteVoisine = voisines.sort((a, b) => Math.abs(a.pas - pasG) - Math.abs(b.pas - pasG) || a.x0 - b.x0)[0];
    if (teteVoisine) {
      g.nature = forme; g.tete = teteVoisine; g.pas = pasG;
      continue;
    }
    // Une altération sans note derrière elle : un signe à relire, jamais un
    // silence (un bécarre devenait un soupir).
    if (forme && dansPortee) { g.nature = "inconnu"; g.forme = forme; continue; }
    const pres = tetes.find((t) => Math.abs(t.cx - g.cx) < 1.3 * il && Math.abs(t.cy - g.cy) < 3.2 * il && Math.abs(t.cy - g.cy) > 0.7 * il);
    if (!dansPortee) {
      g.nature = pres && Math.max(g.l, g.h) < 1.4 * il ? "articulation" : g.l > 1.8 * il && g.h < 1.3 * il ? "liaison" : "hors-portee";
      continue;
    }
    const silence = typeSilence(g, il, tetes.filter((t) => t.portee === p.index));
    if (silence) { g.nature = silence; continue; }
    // Un trait seul, droit et vertical, sans tête : une hampe dont la tête
    // n'a pas été lue (L8). Avant, s'il était un peu courbé, c'était un soupir.
    if (hampeSeule(g, il)) { g.nature = "hampe-seule"; continue; }
    if (g.l > 1.8 * il && g.h < 1.3 * il) { g.nature = "liaison"; continue; }
    if (pres && Math.max(g.l, g.h) < 1.4 * il && (g.cy < p.lignes[1] || g.cy > p.lignes[3])) { g.nature = "articulation"; continue; }
    g.nature = "inconnu";
  }
  for (let i = signes.length - 1; i >= 0; i--) if (signes[i].nature === "separe") signes.splice(i, 1);
  signes.push(...remplaces);

  // Armure, ou altération de la première note (L5) ? Un dièse juste devant la
  // première note d'une ligne, à sa hauteur, passait pour l'armure : toute la
  // ligne changeait de tonalité. C'est une altération quand il colle à la
  // note (moins de 1,2 interligne ; tes armures du 30/09 en sont à 1,6), ou
  // quand il n'est pas là où l'armure le mettrait (un fa♯ d'armure s'écrit
  // sur la ligne du haut en clé de sol, pas dans le premier interligne). Le
  // doute « armure » propose l'autre lecture.
  const hesitations = [];
  for (const p of portees) {
    const armure = signes.filter((g) => g.portee === p.index && /-armure$/.test(g.nature)).sort((a, b) => a.x0 - b.x0);
    if (!armure.length) continue;
    const A = armure[armure.length - 1];
    const apres = tetes.filter((t) => t.portee === p.index && t.x0 > A.x1 - 0.2 * il).sort((a, b) => a.x0 - b.x0);
    if (!apres.length) continue;
    const ecartX = apres[0].x0 - A.x1;
    const tete = apres.filter((t) => t.x0 < apres[0].x0 + 0.8 * il).find((t) => Math.abs(t.pas - A.pas) <= 0.6);
    if (!tete || ecartX > 1.6 * il) continue;
    const type = A.nature === "bemol-armure" ? "bemol" : "diese";
    const rang = armure.filter((g) => g !== A && g.nature === A.nature).length;
    const attendu = positionArmure(type, rang, p);
    const habituelle = attendu !== null && Math.abs(A.pas - attendu) <= 0.6;
    const alteration = ecartX < 1.2 * il || !habituelle;
    if (alteration) { A.nature = type; A.tete = tete; }
    hesitations.push({ portee: p.index, signe: A, tete, lue: alteration ? "alteration" : "armure", alteration: type === "bemol" ? "_" : "^" });
  }

  return { page: numeroPage, il, portees, traits, classe, tetes, hampes, barres, ligatures, signes, debutMusique, hesitations, repos };
}

// Place habituelle des altérations d'armure, en demi-interlignes au-dessus de
// la ligne du bas, en clé de sol : si♭ mi♭ la♭ ré♭ sol♭ do♭ fa♭, et fa♯ do♯
// sol♯ ré♯ la♯ mi♯ si♯. Les autres clés décalent tout d'autant que leur ligne du bas.
const ARMURE_SOL = { bemol: [4, 7, 3, 6, 2, 5, 1], diese: [8, 5, 9, 6, 3, 7, 4] };
const DECALAGE_ARMURE = { mi4: 0, sol2: -2, fa3: -1 };

function positionArmure(type, rang, portee) {
  const decalage = DECALAGE_ARMURE[portee.ligneDuBas];
  if (decalage === undefined || rang > 6) return null;
  return ARMURE_SOL[type][rang] + decalage;
}

/**
 * La hauteur d'une altération, en demi-interlignes au-dessus de la ligne du
 * bas : le centre d'un dièse ou d'un bécarre, la boucle d'un bémol (sa barre
 * monte au-dessus de la note). Mesuré sur tes armures du 30/09 : la boucle
 * tombe à 0,4 demi-interligne près de sa note.
 */
function hauteurAlteration(g, forme, portee, il) {
  let y = g.cy;
  if (forme === "bemol") {
    const membres = g.membres || [g];
    const boucle = membres.length === 2 ? membres.reduce((a, b) => (a.h < b.h ? a : b)) : null;
    y = boucle ? boucle.cy : g.y1 - 0.42 * il;
  }
  return pasDe(portee, y, il);
}

/**
 * Plusieurs dièses collés, un seul signe : on les sépare par leurs barres
 * verticales, deux par dièse. Rend les dièses (chacun ses traits), ou null.
 */
function separerDieses(g, il) {
  const membres = g.membres || [];
  if (membres.length < 6 || membres.length > 20 || g.h > 4.5 * il) return null;
  const verticales = membres.filter((m) => m.h > 0.9 * il && m.l < 0.6 * il).sort((a, b) => a.cx - b.cx);
  if (verticales.length < 4 || verticales.length % 2) return null;
  const paires = [];
  for (let i = 0; i < verticales.length; i += 2) {
    const [a, b] = [verticales[i], verticales[i + 1]];
    if (b.cx - a.cx > 1.1 * il) return null;
    paires.push([a, b]);
  }
  const reste = membres.filter((m) => !verticales.includes(m));
  const dieses = paires.map((p) => ({ membres: [...p] }));
  for (const m of reste) {
    const k = paires.map((p) => Math.abs((p[0].cx + p[1].cx) / 2 - m.cx)).reduce((best, d, i, ds) => (d < ds[best] ? i : best), 0);
    dieses[k].membres.push(m);
  }
  if (dieses.some((d) => d.membres.length < 3 || d.membres.length > 5)) return null;
  return dieses.map((d) => {
    const pts = d.membres.flatMap((m) => m.points);
    return { traits: d.membres.flatMap((m) => m.traits), membres: d.membres, partiel: false, points: pts, ...boite(pts), longueur: d.membres.reduce((a, m) => a + m.longueur, 0) };
  });
}

// ------------------------------------------------------------------------
// Formes des signes
// ------------------------------------------------------------------------

/** Combien de niveaux de ligature croisent une hampe : deux ligatures qui la croisent au même endroit sont un seul niveau. */
function niveauxDe(h, ligatures, il) {
  const niveaux = [];
  for (const l of ligatures) {
    const le = Math.abs(yA(l.seg.a, l.seg.b, h.bout[0]) - h.bout[1]);
    if (!niveaux.some((n) => Math.abs(n - le) < 0.45 * il)) niveaux.push(le);
  }
  return niveaux.length;
}

/** Deux tracés se touchent-ils (à `tol` près) ? On compare des points pris le long de chacun. */
function seTouchent(a, b, tol) {
  const echantillon = (pts) => (pts.length <= 60 ? pts : pts.filter((_, i) => i % Math.ceil(pts.length / 60) === 0));
  const ea = echantillon(a), eb = echantillon(b);
  for (let i = 0; i < ea.length; i++) {
    for (let j = 0; j < eb.length; j++) {
      if (Math.abs(ea[i][0] - eb[j][0]) < tol && Math.abs(ea[i][1] - eb[j][1]) < tol) return true;
      if (j < eb.length - 1 && distSegment(ea[i], eb[j], eb[j + 1]) < tol) return true;
    }
  }
  return false;
}

/** Recolle les segments consécutifs presque alignés (moins de 18° d'écart). */
function recoller(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const d1 = Math.atan2(b[1] - a[1], b[0] - a[0]), d2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let diff = Math.abs(d1 - d2) * 180 / Math.PI;
    if (diff > 180) diff = 360 - diff;
    if (diff >= 18) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Deux segments sur une même droite (ligature tracée en deux fois). */
function alignes(s1, s2, tol) {
  const d = Math.min(distSegment(s2.a, s1.a, s1.b), distSegment(s2.b, s1.a, s1.b), distSegment(s1.a, s2.a, s2.b), distSegment(s1.b, s2.a, s2.b));
  const ecartAngle = Math.abs(angleOriente(s1) - angleOriente(s2));
  return d < tol && Math.min(ecartAngle, 180 - ecartAngle) < 20;
}

function angleOriente(s) {
  let a = (Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * 180) / Math.PI;
  if (a < 0) a += 180;
  return a;
}

/** Ordonnée d'un segment à une abscisse donnée (prolongé si besoin). */
function yA(a, b, x) {
  if (Math.abs(b[0] - a[0]) < 1e-6) return (a[1] + b[1]) / 2;
  return a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
}

/**
 * Bémol, dièse ou bécarre, d'après la composition du signe.
 * Bémol : une barre verticale et une petite boucle en bas à droite (en un
 * ou deux traits). Dièse : au moins trois traits droits croisés.
 */
function formeAlteration(g, il) {
  if (g.h < 1.0 * il || g.h > 3.4 * il || g.l > 1.8 * il) return null;
  const membres = g.membres || [g];
  const barres = membres.filter((m) => m.h > 0.9 * il && m.l < 0.4 * il);
  if (membres.length === 2 && barres.length === 1) {
    const barre = barres[0], boucle = membres.find((m) => m !== barre);
    const enBas = boucle.cy > barre.y0 + 0.5 * barre.h && boucle.h < 1.1 * il;
    const aDroite = boucle.cx > barre.cx;
    if (enBas && aDroite) return "bemol";
    if (boucle.h > 0.9 * il) return "becarre";
  }
  // Bécarre en deux « L » : à gauche, la barre qui descend puis part à
  // droite ; à droite, le trait qui part à droite puis descend, plus bas.
  // Avant, aucun des deux n'était assez fin pour une barre, et le bécarre
  // devenait un soupir (L10).
  if (membres.length === 2 && g.l < 1.3 * il) {
    const [a, b] = [...membres].sort((m, n) => m.y0 - n.y0);
    const grands = membres.every((m) => m.h > 1.2 * il && m.l > 0.2 * il && m.l < 1.0 * il);
    const decales = a.y0 < b.y0 - 0.3 * il && a.y1 < b.y1 - 0.3 * il && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5 * il;
    const recouvre = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.4 * Math.min(a.l, b.l);
    const sommet = a.points.reduce((p, q) => (q[1] < p[1] ? q : p)), pied = b.points.reduce((p, q) => (q[1] > p[1] ? q : p));
    if (grands && decales && recouvre && sommet[0] < pied[0]) return "becarre";
  }
  if (membres.length === 1 && g.l < 1.2 * il) {
    // D'un seul trait : d'abord la barre, qui descend, puis la boucle, en bas
    // à droite. Le « 1 » d'un chiffrage (qui monte en biais puis descend)
    // ne passe pas.
    const s = recoller(simplifier(g.points, 0.14 * il));
    const [a, b] = s;
    const barre = b && angle(a, b) > 65 && b[1] > a[1] && dist(a, b) > 0.8 * il;
    const reste = g.points.slice(g.points.findIndex((p) => p[0] === b?.[0] && p[1] === b?.[1]));
    if (barre && reste.length > 3) {
      const bx = Math.min(...reste.map((p) => p[1]));
      const droite = Math.max(...reste.map((p) => p[0])) - Math.max(a[0], b[0]);
      if (bx > g.y0 + 0.4 * g.h && droite > 0.25 * il) return "bemol";
    }
  }
  if (membres.length >= 3 && membres.length <= 5 && g.l < 1.8 * il) return "diese";
  return null;
}

/**
 * Soupir (noire) : grand trait sinueux ; demi-soupir (croche) : petit « 7 ».
 * Un soupir doit zigzaguer (L8) : une hampe sans tête, un peu courbée, haute
 * de plus de 2,3 interlignes, passait pour un soupir en silence. Mesuré sur
 * tes cinq silences du 30/09 : droiture 0,42 à 0,72, au moins trois
 * allers-retours d'un dixième d'interligne pour les soupirs.
 */
function typeSilence(g, il, tetesPortee) {
  // D'un seul trait, comme tous tes silences : deux traits qui se touchent (une
  // hampe sans tête et un reste de tête) faisaient un demi-soupir en silence.
  if (g.partiel || (g.membres && g.membres.length > 1)) return null;
  const loinDesTetes = !tetesPortee.some((t) => Math.abs(t.cx - g.cx) < 0.8 * il && Math.abs(t.cy - g.cy) < 2 * il);
  if (!loinDesTetes) return null;
  const droit = dist(g.points[0], g.points[g.points.length - 1]) / Math.max(g.longueur, 1);
  if (droit > 0.85 || g.l > 1.5 * il || g.h < 0.8 * il || g.h > 4.5 * il) return null;
  // Réglé sur les pages du 30/09 : le « 7 » du demi-soupir reste sous 2,3
  // interlignes et zigzague peu ; le soupir est plus grand ou zigzague.
  const zig = retournements(g.points, 0.18 * il);
  if (g.h >= 2.3 * il || zig >= 3) return g.l <= 1.4 * il && retournements(g.points, 0.1 * il) >= 2 ? "soupir" : null;
  if (g.l >= 0.3 * il && droit <= 0.8) return "demi-soupir";
  return null;
}

/** Une hampe sans tête : un trait seul, droit, vertical, assez long pour une hampe. */
function hampeSeule(g, il) {
  if (g.partiel || (g.membres && g.membres.length > 1)) return false;
  const droit = dist(g.points[0], g.points[g.points.length - 1]) / Math.max(g.longueur, 1e-6);
  return droit > 0.85 && g.h >= 1.4 * il && g.l < 0.6 * il;
}

// ------------------------------------------------------------------------
// Assemblage : des éléments reconnus aux mesures
// ------------------------------------------------------------------------

/** Durée en croches d'une note, d'après sa forme. */
function dureeNote(tete, hampe) {
  if (!hampe) return tete.pleine ? null : 8; // ronde ; tête pleine sans hampe = doute
  if (!tete.pleine) return 4;
  const drapeaux = Math.max(hampe.crochets, niveauLigature(hampe));
  return drapeaux >= 2 ? 0.5 : drapeaux === 1 ? 1 : 2;
}

function niveauLigature(h) {
  return h.niveaux || 0;
}

/**
 * Assemble une page lue en événements rangés par portée. La calibration n'y
 * sert plus (lirePage a tout mesuré) : elle n'est plus demandée (L19).
 */
export function assembler(lue) {
  const { il, portees, tetes, hampes, barres, signes } = lue;
  const doutes = [];
  const parPortee = portees.map(() => []);

  // Notes (une par hampe, accords compris) et têtes sans hampe.
  const vues = new Set();
  for (const h of hampes) {
    const t0 = h.tetes[0];
    const duree = dureeNote(t0, h);
    const ev = { type: "note", x: h.x, tetes: h.tetes, hampe: h, duree, points: 0, ligature: h.groupe };
    h.tetes.forEach((t) => vues.add(t.id));
    parPortee[t0.portee].push(ev);
  }
  for (const t of tetes) {
    if (vues.has(t.id)) continue;
    const duree = dureeNote(t, null);
    const ev = { type: "note", x: t.cx, tetes: [t], hampe: null, duree: duree ?? 2, points: 0, ligature: null };
    // Une tête pleine sans hampe, juste au-dessus (ou au-dessous) d'une note à
    // hampe : sans doute une note de l'accord dont la hampe est courte (L10).
    // La réponse « C'est une note de l'accord » le refait d'un geste.
    const voisin = parPortee[t.portee].find((e) => e.hampe && e.tetes.some((u) => Math.abs(u.cx - t.cx) < 1.2 * il && Math.abs(u.cy - t.cy) < 4 * il));
    if (duree === null) doutes.push(doute(lue, t.portee, t, "Tête pleine sans hampe : lue comme une noire.", { type: "sans-hampe", _ev: ev, ...(voisin ? { _accord: voisin } : {}) }));
    // Une tête vide sans hampe est une ronde ; loin de la portée, sans ligne
    // supplémentaire, c'est peut-être du texte (L6) : on le demande.
    else if (t.loin) doutes.push(doute(lue, t.portee, t, "Tête vide sans hampe, loin de la portée : lue comme une ronde.", { type: "sans-hampe", _ev: ev }));
    parPortee[t.portee].push(ev);
  }

  // Pauses (toute la mesure, quelle qu'elle soit : partition.js en fixe la
  // durée une fois le chiffrage connu) et demi-pauses (L12).
  for (const r of lue.repos || []) {
    parPortee[r.portee].push({ type: "silence", x: r.cx, duree: r.nature === "pause" ? 8 : 4, pause: r.nature === "pause", signe: r });
  }

  // Points de durée et points de reprise.
  const pointsReprise = [];
  for (const g of signes.filter((g) => g.nature === "point")) {
    const p = porteeDe(portees, g.cy);
    const barre = barres.find((b) => b.portee === p.index && Math.abs(b.x - g.cx) < 1.5 * il && g.cy > p.haut && g.cy < p.bas);
    if (barre) { pointsReprise.push({ barre, cote: g.cx < barre.x ? "gauche" : "droite" }); g.nature = "point-reprise"; continue; }
    const ev = parPortee[p.index].find((e) => e.type === "note" && e.tetes.some((t) => g.cx - t.cx > 0.4 * il && g.cx - t.cx < 2.2 * il && Math.abs(g.cy - t.cy) < 0.8 * il));
    if (ev) {
      ev.points = 1; g.nature = "point-duree";
      // Loin de sa tête (au-delà de 1,9 interligne) : pointée de justesse (L2).
      if (ev.tetes.every((t) => g.cx - t.cx > MARGES.point[0] * il)) ev.limitePoint = { lue: "pointee", signe: g };
      continue;
    }
    // Un point un peu trop loin pour compter : la note n'est pas pointée, de justesse.
    const loin = parPortee[p.index].find((e) => e.type === "note" && !e.points && e.tetes.some((t) => g.cx - t.cx >= 2.2 * il && g.cx - t.cx < MARGES.point[1] * il && Math.abs(g.cy - t.cy) < 0.8 * il));
    if (loin) loin.limitePoint = { lue: "sans", signe: g };
  }

  // Décisions limites (L2) : la lecture est gardée, l'autre lecture devient
  // une réponse fermée (`alternative`, écrite comme un geste d'edition.js :
  // une durée en croches, un pas plus haut ou plus bas, une note à enlever).
  // partition.js s'en sert aussi pour trancher par la mesure (L15).
  const avecPoint = (e, d) => d * (e.points ? 1.5 : 1);
  for (const e of parPortee.flat()) {
    if (e.type !== "note") continue;
    [...e.tetes].sort((a, b) => a.pas - b.pas).forEach((t, k) => {
      if (Math.abs(t.ecart) < MARGES.hauteur) return;
      const sens = t.ecart > 0 ? 1 : -1;
      const nom = (pas) => { const n = nomDePas(portees[t.portee], pas); return NOMS_FR[NOMS.indexOf(n.lettre)]; };
      doutes.push(doute(lue, t.portee, t, `Tête entre deux places : lue ${nom(t.pas)}, presque ${nom(t.pas + sens)}.`,
        { type: "hauteur", _ev: e, alternative: { note: k, pas: sens }, ecart: Math.round(Math.abs(t.ecart) * 100) / 100 }));
    });
    const h = e.hampe;
    if (h && h.limiteLigature) {
      const lim = h.limiteLigature;
      const niveaux = lim.lue === "liee" ? niveauxDe(h, h.ligatures.filter((l) => l !== lim.ligature), il) : h.niveaux + 1;
      const drapeaux = Math.max(h.crochets, niveaux);
      const alt = avecPoint(e, !e.tetes[0].pleine ? 4 : drapeaux >= 2 ? 0.5 : drapeaux === 1 ? 1 : 2);
      if (Math.abs(alt - avecPoint(e, e.duree)) > 1e-6) {
        const b = { x0: Math.min(h.x, lim.ligature.seg.a[0], lim.ligature.seg.b[0]) - 0.2 * il, x1: Math.max(h.x, lim.ligature.seg.a[0], lim.ligature.seg.b[0]) + 0.2 * il,
          y0: Math.min(h.bout[1], lim.ligature.seg.a[1], lim.ligature.seg.b[1]) - 0.3 * il, y1: Math.max(h.bout[1], lim.ligature.seg.a[1], lim.ligature.seg.b[1]) + 0.3 * il };
        doutes.push(doute(lue, e.tetes[0].portee, b, lim.lue === "liee"
          ? "La ligature s'arrête juste avant la queue de cette note : lue liée."
          : "La ligature s'arrête juste avant la queue de cette note : lue seule.",
        { type: "ligature", lue: lim.lue, _ev: e, alternative: { croches: alt }, ecart: Math.round((lim.ecart / il) * 100) / 100 }));
      }
    }
    const t0 = e.tetes[0];
    if (e.tetes.length === 1 && t0.pleine && t0.rapport < MARGES.rapportTete) {
      doutes.push(doute(lue, t0.portee, t0, "Une tête de justesse : ce gribouillis est peut-être un trait.", { type: "tete", _ev: e, alternative: { supprimer: true } }));
    }
    if (e.limitePoint) {
      const g = e.limitePoint.signe;
      const alt = e.points ? e.duree : e.duree * 1.5;
      doutes.push(doute(lue, t0.portee, { x0: Math.min(t0.x0, g.x0), y0: Math.min(t0.y0, g.y0), x1: Math.max(t0.x1, g.x1), y1: Math.max(t0.y1, g.y1) },
        e.points ? "Un point loin de sa note : lu comme pointée." : "Un point un peu loin de sa note : pas compté.",
        { type: "point", lue: e.limitePoint.lue, _ev: e, alternative: { croches: alt } }));
    }
  }

  // Altérations accidentelles.
  for (const g of signes.filter((g) => ["bemol", "diese", "becarre"].includes(g.nature))) {
    g.tete.alteration = { bemol: "_", diese: "^", becarre: "=" }[g.nature];
  }

  // Silences.
  for (const g of signes.filter((g) => g.nature === "soupir" || g.nature === "demi-soupir")) {
    parPortee[g.portee].push({ type: "silence", x: g.cx, duree: g.nature === "soupir" ? 2 : 1, signe: g });
  }

  // Barres (fusion des traits doublés, double barre, reprises). Deux traits à
  // moins d'un quart d'interligne sont une seule barre, repassée : elle
  // s'écrivait « || » (une double barre), alors qu'on ne voit qu'un trait
  // appuyé (piano du 30/09, à la main gauche ; mélodie, 3ᵉ ligne). Une double
  // barre a ses deux traits nettement séparés.
  for (const p of portees) {
    const bs = barres.filter((b) => b.portee === p.index).sort((a, b) => a.x - b.x);
    const groupes = [];
    for (const b of bs) {
      const g = groupes[groupes.length - 1];
      if (g && b.x - g.x1 < 0.25 * il) { g.x1 = b.x; g.traits.push(...b.traits); g.repassee = true; }
      else if (g && b.x - g.x1 < 1.0 * il) { g.x1 = b.x; g.double = true; g.traits.push(...b.traits); }
      else groupes.push({ x0: b.x, x1: b.x, traits: [...b.traits], double: false, repassee: false, reprise: { gauche: false, droite: false } });
    }
    for (const r of pointsReprise.filter((r) => r.barre.portee === p.index)) {
      const g = groupes.find((g) => r.barre.x >= g.x0 - 1 && r.barre.x <= g.x1 + 1);
      if (g) g.reprise[r.cote] = true;
    }
    for (const g of groupes) parPortee[p.index].push({ type: "barre", x: (g.x0 + g.x1) / 2, ...g });
  }

  for (const evs of parPortee) evs.sort((a, b) => a.x - b.x);

  // Liaisons de durée (L11) : un arc qui part d'une tête et arrive à la note
  // suivante, de même hauteur, l'allonge (« - » en ABC). Détectées, elles
  // étaient jetées. Un arc entre deux hauteurs différentes est un legato :
  // il ne change pas le rythme, il reste ignoré.
  for (const g of signes) {
    if (!["liaison", "inconnu", "articulation", "hors-portee"].includes(g.nature) || g.partiel) continue;
    if (g.l < 0.8 * il || g.h > 1.1 * il || g.l < 1.5 * g.h) continue;
    const gauche = g.points.reduce((a, b) => (b[0] < a[0] ? b : a)), droite = g.points.reduce((a, b) => (b[0] > a[0] ? b : a));
    const fleche = Math.max(...g.points.map((q) => distSegment(q, gauche, droite)));
    if (fleche < 0.12 * il) continue; // droit : une ligne, pas un arc
    const p = porteeDe(portees, g.cy);
    const notes = parPortee[p.index].filter((e) => e.type === "note");
    const bout = (pt, versLaDroite) => notes
      .map((e) => ({ e, d: Math.min(...e.tetes.map((t) => (Math.abs(t.cy - pt[1]) < 1.2 * il && (versLaDroite ? t.cx - pt[0] > -0.5 * il : pt[0] - t.cx > -0.5 * il) ? Math.hypot(t.cx - pt[0], t.cy - pt[1]) : Infinity))) }))
      .filter((x) => x.d < 1.6 * il).sort((a, b) => a.d - b.d)[0];
    const a = bout(gauche, false), b = bout(droite, true);
    if (!a || !b || a.e === b.e || a.e.x >= b.e.x) continue;
    const suivante = notes.find((e) => e.x > a.e.x);
    if (suivante !== b.e || !a.e.tetes.some((t) => b.e.tetes.some((u) => u.pas === t.pas))) continue;
    a.e.liee = true;
    g.nature = "liaison-duree";
  }

  // Triolet (L12) : un petit signe au-dessus ou au-dessous d'un groupe de
  // trois notes liées. Sans gabarits, le lecteur ne sait pas lire ce « 3 » :
  // il le demande, et la réponse écrit le triolet (avant : un 9/8 deviné).
  const groupesDe = (evs) => {
    const g = new Map();
    for (const e of evs) if (e.type === "note" && e.ligature !== null) (g.get(e.ligature) || g.set(e.ligature, []).get(e.ligature)).push(e);
    return [...g.values()];
  };
  // Le « 3 » est plus haut que large et fait deux bosses (au moins deux
  // allers-retours) : un accent « > » au-dessus des mêmes notes ne compte pas.
  // En mesure composée (6/8, 12/8…), trois croches liées sont la règle :
  // partition.js y retire ces doutes.
  for (const [pi, evs] of parPortee.entries()) {
    for (const groupe of groupesDe(evs)) {
      if (groupe.length !== 3) continue;
      const xs = groupe.map((e) => e.x);
      const bouts = groupe.map((e) => e.hampe.bout[1]), cys = groupe.flatMap((e) => e.tetes.map((t) => t.cy));
      const montantes = bouts[0] < cys[0];
      const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
      const cote = (g) => montantes
        ? (g.cy < Math.max(...bouts) + 0.3 * il && g.cy > Math.min(...bouts) - 2.5 * il) || (g.cy > Math.max(...cys) + 0.5 * il && g.cy < Math.max(...cys) + 2.5 * il)
        : (g.cy > Math.min(...bouts) - 0.3 * il && g.cy < Math.max(...bouts) + 2.5 * il) || (g.cy < Math.min(...cys) - 0.5 * il && g.cy > Math.min(...cys) - 2.5 * il);
      const trois = signes.find((g) => ["hors-portee", "articulation", "inconnu"].includes(g.nature) && !g.partiel
        && g.h >= 0.3 * il && g.h <= 1.6 * il && g.h >= 1.1 * g.l && retournements(g.points, 0.08 * il) >= 2
        && g.cx > x0 - 0.5 * il && g.cx < x1 + 0.5 * il && cote(g));
      if (!trois) continue;
      trois.nature = "triolet?";
      groupe[0].triolet = true; // la mesure compte une croche de moins pour deviner le chiffrage
      doutes.push(doute(lue, pi, trois, "Un petit signe au-dessus de trois notes liées : un triolet ?", { type: "triolet", _ev: groupe[0], _evFin: groupe[2] }));
    }
  }

  // En-tête de chaque portée : armure et chiffrage.
  const entetes = portees.map((p) => {
    const gs = signes.filter((g) => g.portee === p.index);
    const bemols = gs.filter((g) => g.nature === "bemol-armure").length;
    const dieses = gs.filter((g) => g.nature === "diese-armure").length;
    const chiffres = gs.filter((g) => g.nature === "entete");
    return { bemols, dieses, chiffrage: chiffres.length > 0, chiffres };
  });

  // Plus de quatre signes inconnus en tête de ligne : ce n'est plus un
  // chiffrage (« 12/8 » en fait trois). On les montre plutôt que de les taire.
  for (const p of portees) {
    const inconnus = signes.filter((g) => g.portee === p.index && g.nature === "entete");
    if (inconnus.length > 4) for (const g of inconnus) doutes.push(doute(lue, p.index, g, "Signe au début de la ligne, ni armure ni chiffrage : ignoré.", { type: "signe" }));
  }

  // Une hampe sans tête (L8) : la note manque peut-être. Le doute vise la
  // note d'avant sur la même portée (« Je corrige moi-même » la choisit).
  for (const g of signes.filter((g) => g.nature === "hampe-seule")) {
    const avant = parPortee[g.portee].filter((e) => e.type === "note" && e.x < g.cx).sort((a, b) => b.x - a.x)[0];
    doutes.push(doute(lue, g.portee, g, "Un trait droit sans tête : une note manque peut-être ici.", { type: "tete-manquante", _ev: avant || null }));
  }

  // Armure ou altération de la première note : la lecture choisie, et l'autre
  // en réponse fermée. partition.js y ajoute les tonalités et la ligne visée.
  for (const h of lue.hesitations || []) {
    const ev = parPortee[h.portee].find((e) => e.type === "note" && e.tetes.includes(h.tete));
    if (!ev) continue;
    const b = { x0: Math.min(h.signe.x0, h.tete.x0), y0: Math.min(h.signe.y0, h.tete.y0), x1: Math.max(h.signe.x1, h.tete.x1), y1: Math.max(h.signe.y1, h.tete.y1) };
    doutes.push(doute(lue, h.portee, b, h.lue === "alteration"
      ? "Une altération juste devant la première note : lue comme une altération de cette note, pas comme l'armure."
      : "Une altération à la hauteur de la première note : lue comme l'armure de la ligne.",
    { type: "armure", variante: "premiere-note", lue: h.lue, alteration: h.alteration, _ev: ev, _hesitation: h }));
  }

  // Signes inconnus dans les portées : doutes.
  for (const g of signes.filter((g) => g.nature === "inconnu")) {
    const pres = hampes.find((h) => Math.abs(xA(h.seg.a, h.seg.b, g.cy) - g.cx) < 0.8 * il && g.cy > Math.min(h.pied[1], h.bout[1]) - il && g.cy < Math.max(h.pied[1], h.bout[1]) + il);
    if (pres && signes.some((x) => x.nature === "crochet-douteux" && x.hampeDouteuse === pres)) continue;
    doutes.push(doute(lue, g.portee, g, "Signe non reconnu : ignoré.", { type: "signe" }));
  }
  const vuesDouteuses = new Set();
  for (const g of signes.filter((g) => g.nature === "crochet-douteux")) {
    if (vuesDouteuses.has(g.hampeDouteuse)) continue;
    vuesDouteuses.add(g.hampeDouteuse);
    const ev = parPortee.flat().find((e) => e.type === "note" && e.hampe === g.hampeDouteuse);
    doutes.push(doute(lue, g.hampeDouteuse.tetes[0].portee, g, "Petit trait au bout de la hampe : lu comme une noire. Si c'est un crochet, la note est une croche.",
      { type: "crochet", _ev: ev, ...(ev ? { alternative: { croches: avecPoint(ev, 1) } } : {}) }));
  }

  return { parPortee, entetes, doutes };
}

/**
 * Un doute. `type` dit de quoi il s'agit (l'atelier en tire une question
 * fermée) ; `_ev` est l'événement concerné, que partition.js remplace par sa
 * place dans l'ABC (`cible`) avant de rendre les doutes : il ne sort jamais
 * de la lecture.
 */
function doute(lue, porteeIndex, boiteElt, message, extra = {}) {
  return {
    page: lue.page,
    portee: porteeIndex,
    boite: { x0: boiteElt.x0, y0: boiteElt.y0, x1: boiteElt.x1, y1: boiteElt.y1 },
    message,
    ...extra,
  };
}

// ------------------------------------------------------------------------
// Tonalité et hauteurs
// ------------------------------------------------------------------------

export function tonalite(bemols, dieses) {
  if (bemols && !dieses) return TONALITES_BEMOLS[Math.min(bemols, 7)];
  if (dieses && !bemols) return TONALITES_DIESES[Math.min(dieses, 7)];
  return "C";
}

export { nomDePas, porteeDe, listerPortees };
