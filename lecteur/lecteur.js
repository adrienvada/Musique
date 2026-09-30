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

const NOMS = ["C", "D", "E", "F", "G", "A", "B"];
// Degré (0 = do) et octave (4 = octave du do central) de la ligne du bas.
const LIGNE_DU_BAS = { mi4: [2, 4], sol2: [4, 2] };
// Ordre des bémols et des dièses à l'armure.
const ORDRE_BEMOLS = ["B", "E", "A", "D", "G", "C", "F"];
const ORDRE_DIESES = ["F", "C", "G", "D", "A", "E", "B"];
const TONALITES_BEMOLS = ["C", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
const TONALITES_DIESES = ["C", "G", "D", "A", "E", "B", "F#", "C#"];

// ------------------------------------------------------------------------
// Portées
// ------------------------------------------------------------------------

function listerPortees(cal) {
  const portees = [];
  cal.systemes.forEach((s, is) => {
    s.portees.forEach((p, ip) => {
      portees.push({
        index: portees.length,
        systeme: is,
        voix: ip,
        cle: p.cle,
        ligneDuBas: p.ligne_du_bas,
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
  const [degre0, octave0] = LIGNE_DU_BAS[portee.ligneDuBas];
  const rang = degre0 + pas;
  return { lettre: NOMS[((rang % 7) + 7) % 7], octave: octave0 + Math.floor(rang / 7) };
}

// ------------------------------------------------------------------------
// 1. Têtes
// ------------------------------------------------------------------------

function mesurer(points, id) {
  const b = boite(points);
  const l = longueur(points);
  return { id, points, ...b, longueur: l, ferme: dist(points[0], points[points.length - 1]) };
}

function estTetePleine(t, il) {
  const compacte = t.l > 0.35 * il && t.l < 1.5 * il && t.h > 0.3 * il && t.h < 1.4 * il;
  return compacte && t.longueur > 2.3 * (t.l + t.h);
}

function estTeteVide(t, il) {
  const compacte = t.l > 0.5 * il && t.l < 1.6 * il && t.h > 0.4 * il && t.h < 1.3 * il;
  const boucle = t.ferme < 0.4 * Math.max(t.l, t.h);
  const tour = t.longueur > 1.2 * (t.l + t.h) && t.longueur <= 2.3 * (t.l + t.h);
  return compacte && boucle && tour;
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
  const il = cal.interligne;
  const portees = listerPortees(cal);
  const traits = traitsBruts.map((pts, i) => mesurer(pts, i));
  const classe = new Array(traits.length).fill(null); // ce qu'est devenu chaque trait

  // 1. Têtes
  const candidates = [];
  for (const t of traits) {
    if (estTetePleine(t, il)) candidates.push({ ...t, pleine: true });
    else if (estTeteVide(t, il)) candidates.push({ ...t, pleine: false });
  }
  const tetes = fusionnerTetes(candidates, il).map((t, i) => {
    const portee = porteeDe(portees, t.cy);
    const exact = pasDe(portee, t.cy, il);
    return { ...t, id: i, portee: portee.index, pas: Math.round(exact), ecart: exact - Math.round(exact) };
  });
  for (const t of tetes) for (const id of t.traits) classe[id] = "tete";
  // Un petit trait posé sur une tête (retouche, second passage) en fait partie.
  for (const t of traits) {
    if (classe[t.id] || Math.max(t.l, t.h) > 1.2 * il) continue;
    const tete = tetes.find((u) => t.cx > u.x0 - 0.25 * il && t.cx < u.x1 + 0.25 * il && t.cy > u.y0 - 0.25 * il && t.cy < u.y1 + 0.25 * il);
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
  // Accords : d'autres têtes empilées le long de la même hampe.
  for (const h of hampes) {
    const [ya, yb] = [h.pied[1], h.bout[1]].sort((a, b) => a - b);
    for (const t of tetes) {
      if (tetePrise.has(t.id)) continue;
      const dx = xA(h.seg.a, h.seg.b, t.cy) - t.cx;
      const dansHampe = t.cy > ya - 0.8 * il && t.cy < yb + 0.8 * il && Math.abs(t.cy - h.bout[1]) > 2 * il;
      if (Math.abs(dx) < 1.35 * il && dansHampe && h.tetes.some((u) => Math.abs(u.cx - t.cx) < 1.2 * il)) {
        h.tetes.push(t); tetePrise.add(t.id);
      }
    }
  }
  for (const t of tetes) t.hampe = hampes.find((h) => h.tetes.includes(t)) || null;

  // 4. Barres de mesure : verticales sans tête, qui traversent une portée.
  const barres = [];
  for (const s of segments) {
    if (s.role || s.ang < 70) continue;
    const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]);
    const x = (s.a[0] + s.b[0]) / 2;
    const couvertes = portees.filter((p) => {
      const recouvre = Math.min(y1, p.bas) - Math.max(y0, p.haut);
      return recouvre >= 0.7 * (p.bas - p.haut) && x > cal.x_debut && x < cal.x_fin + il;
    });
    if (!couvertes.length) continue;
    s.role = "barre";
    for (const p of couvertes) barres.push({ portee: p.index, x, y0, y1, epaisse: false, traits: [s.trait] });
  }

  // 4b. Retouches : un trait repassé sur une hampe ou une barre, ou qui la
  //     prolonge de quelques millimètres, n'est pas un nouveau signe.
  const lignesVerticales = [
    ...hampes.map((h) => ({ a: h.seg.a, b: h.seg.b })),
    ...segments.filter((s) => s.role === "barre").map((s) => ({ a: s.a, b: s.b })),
  ];
  for (const s of segments) {
    if (s.role || s.ang < 65) continue;
    const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]);
    const colle = lignesVerticales.some((v) => {
      const vy0 = Math.min(v.a[1], v.b[1]), vy1 = Math.max(v.a[1], v.b[1]);
      const x = xA(v.a, v.b, (y0 + y1) / 2);
      const recouvre = Math.min(y1, vy1 + 0.6 * il) - Math.max(y0, vy0 - 0.6 * il);
      return Math.abs(x - (s.a[0] + s.b[0]) / 2) < 0.4 * il && recouvre > 0.5 * s.lg;
    });
    if (colle) s.role = "retouche";
  }

  // 5. Ligatures : segments qui passent par les bouts de plusieurs hampes.
  const touche = (s, h, portee) => {
    // La ligature passe près du bout de la hampe (ou un peu en dessous : ligature secondaire).
    const pas = 12;
    for (let i = 0; i <= pas; i++) {
      const f = (i / pas) * Math.min(1.8 * il, dist(h.bout, h.pied));
      const u = [h.bout[0] + ((h.pied[0] - h.bout[0]) * f) / dist(h.bout, h.pied), h.bout[1] + ((h.pied[1] - h.bout[1]) * f) / dist(h.bout, h.pied)];
      if (distSegment(u, s.a, s.b) < portee) return true;
    }
    return false;
  };
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
  // Deux ligatures qui croisent la hampe au même endroit sont un seul niveau.
  for (const h of hampes) {
    const niveaux = [];
    for (const l of ligatures.filter((l) => l.hampes.includes(h))) {
      const y = yA(l.seg.a, l.seg.b, h.bout[0]);
      const le = Math.abs(y - h.bout[1]);
      if (!niveaux.some((n) => Math.abs(n - le) < 0.45 * il)) niveaux.push(le);
    }
    h.ligatures = ligatures.filter((l) => l.hampes.includes(h));
    h.niveaux = niveaux.length;
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
        const proches = b.x0 < a.x1 + 0.2 * il && a.x0 < b.x1 + 0.2 * il && b.y0 < a.y1 + 0.2 * il && a.y0 < b.y1 + 0.2 * il;
        const petits = Math.max(a.l, a.h, b.l, b.h) < 3 * il;
        if (proches && petits) { groupe.push(b); pris.add(j); }
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

  // Zone d'en-tête de chaque portée (armure, chiffrage) : avant la première note ou barre.
  const debutMusique = portees.map((p) => {
    const xs = [
      ...hampes.filter((h) => h.tetes[0].portee === p.index).map((h) => Math.min(h.x, ...h.tetes.map((t) => t.x0))),
      ...tetes.filter((t) => t.portee === p.index).map((t) => t.x0),
      ...barres.filter((b) => b.portee === p.index).map((b) => b.x),
    ];
    return xs.length ? Math.min(...xs) - 0.3 * il : Infinity;
  });

  for (const g of signes) {
    if (g.nature) continue;
    const p = porteeDe(portees, g.cy);
    g.portee = p.index;
    if (g.partiel) { g.nature = "reste"; continue; }
    const forme = formeAlteration(g, il);
    if (g.x1 < debutMusique[p.index] && g.x0 > cal.x_debut) {
      g.nature = forme === "bemol" ? "bemol-armure" : forme === "diese" ? "diese-armure" : "entete";
      continue;
    }
    const dansPortee = g.cy > p.haut - 0.6 * il && g.cy < p.bas + 0.6 * il;
    const teteVoisine = tetes.find((t) => t.portee === p.index && g.x1 < t.x0 + 0.3 * il && t.x0 - g.x1 < 1.6 * il && Math.abs(t.cy - g.cy) < 1.3 * il);
    if (teteVoisine && forme) {
      g.nature = forme; g.tete = teteVoisine;
      continue;
    }
    const pres = tetes.find((t) => Math.abs(t.cx - g.cx) < 1.3 * il && Math.abs(t.cy - g.cy) < 3.2 * il && Math.abs(t.cy - g.cy) > 0.7 * il);
    if (!dansPortee) {
      g.nature = pres && Math.max(g.l, g.h) < 1.4 * il ? "articulation" : g.l > 1.8 * il && g.h < 1.3 * il ? "liaison" : "hors-portee";
      continue;
    }
    const silence = typeSilence(g, il, tetes.filter((t) => t.portee === p.index));
    if (silence) { g.nature = silence; continue; }
    if (g.l > 1.8 * il && g.h < 1.3 * il) { g.nature = "liaison"; continue; }
    if (pres && Math.max(g.l, g.h) < 1.4 * il && (g.cy < p.lignes[1] || g.cy > p.lignes[3])) { g.nature = "articulation"; continue; }
    g.nature = "inconnu";
  }

  return { page: numeroPage, il, portees, traits, classe, tetes, hampes, barres, ligatures, signes, debutMusique };
}

// ------------------------------------------------------------------------
// Formes des signes
// ------------------------------------------------------------------------

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
  if (membres.length === 1) {
    const haut = g.points.filter((p) => p[1] < g.y0 + 0.4 * g.h);
    const bas = g.points.filter((p) => p[1] > g.y0 + 0.6 * g.h);
    if (haut.length && bas.length) {
      const lh = Math.max(...haut.map((p) => p[0])) - Math.min(...haut.map((p) => p[0]));
      const lb = Math.max(...bas.map((p) => p[0])) - Math.min(...bas.map((p) => p[0]));
      if (lh < 0.35 * il && lb > 0.35 * il && lb > 1.5 * lh && g.l < 1.2 * il) return "bemol";
    }
  }
  if (membres.length >= 3 && membres.length <= 5 && g.l < 1.8 * il) return "diese";
  return null;
}

/** Soupir (noire) : grand trait sinueux ; demi-soupir (croche) : petit « 7 ». */
function typeSilence(g, il, tetesPortee) {
  if (g.partiel || (g.membres && g.membres.length > 2)) return null;
  const loinDesTetes = !tetesPortee.some((t) => Math.abs(t.cx - g.cx) < 0.8 * il && Math.abs(t.cy - g.cy) < 2 * il);
  if (!loinDesTetes) return null;
  const droit = dist(g.points[0], g.points[g.points.length - 1]) / Math.max(g.longueur, 1);
  if (droit > 0.95 || g.l > 1.5 * il || g.h < 0.8 * il || g.h > 4.5 * il) return null;
  // Réglé sur les pages du 30/09 : le « 7 » du demi-soupir reste sous 2,3
  // interlignes et zigzague peu ; le soupir est plus grand ou zigzague.
  const zig = retournements(g.points, 0.18 * il);
  if (g.h >= 2.3 * il || zig >= 3) return g.l <= 1.4 * il ? "soupir" : null;
  if (g.l >= 0.3 * il) return "demi-soupir";
  return null;
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

/** Assemble une page lue en événements rangés par portée. */
export function assembler(lue, cal) {
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
    if (duree === null) doutes.push(doute(lue, t.portee, t, "Tête pleine sans hampe : lue comme une noire."));
    parPortee[t.portee].push({ type: "note", x: t.cx, tetes: [t], hampe: null, duree: duree ?? 2, points: 0, ligature: null });
  }

  // Points de durée et points de reprise.
  const pointsReprise = [];
  for (const g of signes.filter((g) => g.nature === "point")) {
    const p = porteeDe(portees, g.cy);
    const barre = barres.find((b) => b.portee === p.index && Math.abs(b.x - g.cx) < 1.5 * il && g.cy > p.haut && g.cy < p.bas);
    if (barre) { pointsReprise.push({ barre, cote: g.cx < barre.x ? "gauche" : "droite" }); g.nature = "point-reprise"; continue; }
    const ev = parPortee[p.index].find((e) => e.type === "note" && e.tetes.some((t) => g.cx - t.cx > 0.4 * il && g.cx - t.cx < 2.2 * il && Math.abs(g.cy - t.cy) < 0.8 * il));
    if (ev) { ev.points = 1; g.nature = "point-duree"; }
  }

  // Altérations accidentelles.
  for (const g of signes.filter((g) => ["bemol", "diese", "becarre"].includes(g.nature))) {
    g.tete.alteration = { bemol: "_", diese: "^", becarre: "=" }[g.nature];
  }

  // Silences.
  for (const g of signes.filter((g) => g.nature === "soupir" || g.nature === "demi-soupir")) {
    parPortee[g.portee].push({ type: "silence", x: g.cx, duree: g.nature === "soupir" ? 2 : 1, signe: g });
  }

  // Barres (fusion des traits doublés, double barre, reprises).
  for (const p of portees) {
    const bs = barres.filter((b) => b.portee === p.index).sort((a, b) => a.x - b.x);
    const groupes = [];
    for (const b of bs) {
      const g = groupes[groupes.length - 1];
      if (g && b.x - g.x1 < 0.25 * il) { g.x1 = b.x; g.traits.push(...b.traits); g.epais = true; }
      else if (g && b.x - g.x1 < 1.0 * il) { g.x1 = b.x; g.double = true; g.traits.push(...b.traits); }
      else groupes.push({ x0: b.x, x1: b.x, traits: [...b.traits], double: false, epais: false, reprise: { gauche: false, droite: false } });
    }
    for (const r of pointsReprise.filter((r) => r.barre.portee === p.index)) {
      const g = groupes.find((g) => r.barre.x >= g.x0 - 1 && r.barre.x <= g.x1 + 1);
      if (g) g.reprise[r.cote] = true;
    }
    for (const g of groupes) parPortee[p.index].push({ type: "barre", x: (g.x0 + g.x1) / 2, ...g });
  }

  for (const evs of parPortee) evs.sort((a, b) => a.x - b.x);

  // En-tête de chaque portée : armure et chiffrage.
  const entetes = portees.map((p) => {
    const gs = signes.filter((g) => g.portee === p.index);
    const bemols = gs.filter((g) => g.nature === "bemol-armure").length;
    const dieses = gs.filter((g) => g.nature === "diese-armure").length;
    const chiffres = gs.filter((g) => g.nature === "entete");
    return { bemols, dieses, chiffrage: chiffres.length > 0, chiffres };
  });

  // Signes inconnus dans les portées : doutes.
  for (const g of signes.filter((g) => g.nature === "inconnu")) {
    const pres = hampes.find((h) => Math.abs(xA(h.seg.a, h.seg.b, g.cy) - g.cx) < 0.8 * il && g.cy > Math.min(h.pied[1], h.bout[1]) - il && g.cy < Math.max(h.pied[1], h.bout[1]) + il);
    if (pres && signes.some((x) => x.nature === "crochet-douteux" && x.hampeDouteuse === pres)) continue;
    doutes.push(doute(lue, g.portee, g, "Signe non reconnu : ignoré."));
  }
  const vuesDouteuses = new Set();
  for (const g of signes.filter((g) => g.nature === "crochet-douteux")) {
    if (vuesDouteuses.has(g.hampeDouteuse)) continue;
    vuesDouteuses.add(g.hampeDouteuse);
    doutes.push(doute(lue, g.hampeDouteuse.tetes[0].portee, g, "Petit trait au bout de la hampe : lu comme une noire. Si c'est un crochet, la note est une croche."));
  }

  return { parPortee, entetes, doutes };
}

function doute(lue, porteeIndex, boiteElt, message) {
  return {
    page: lue.page,
    portee: porteeIndex,
    boite: { x0: boiteElt.x0, y0: boiteElt.y0, x1: boiteElt.x1, y1: boiteElt.y1 },
    message,
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

export function alterationsArmure(bemols, dieses) {
  const a = {};
  ORDRE_BEMOLS.slice(0, bemols).forEach((l) => (a[l] = "_"));
  ORDRE_DIESES.slice(0, dieses).forEach((l) => (a[l] = "^"));
  return a;
}

export { nomDePas, porteeDe, listerPortees };
