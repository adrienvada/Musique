/**
 * EXTRACTION DES TRAITS D'UNE PAGE EXPORTÉE EN PDF
 *
 * La reMarkable n'aplatit pas la page en image : elle ajoute chaque trait
 * au PDF d'origine sous forme de chemin vectoriel noir. On relit la liste
 * des opérations de dessin de la page (pdf.js) et on garde les chemins
 * tracés en noir ; le modèle, lui, est gris.
 *
 * Tout est rendu en pixels de l'écran de la tablette (1404 × 1872,
 * 226 ppp, origine en haut à gauche) : le repère de la calibration.
 *
 * Le module ne charge pas pdf.js lui-même : on lui passe la bibliothèque,
 * pour qu'il tourne aussi bien dans le navigateur que sous Node (tests).
 */

export const PX_PAR_POINT = 226 / 72;

// Codes des commandes de chemin de pdf.js (DrawOPS, versions ≥ 5).
const MOVE = 0, LINE = 1, CURVE = 2, QUAD = 3, CLOSE = 4;

const multiplier = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Une couleur est de l'encre si elle est presque noire. */
function estEncre(couleur) {
  if (typeof couleur === "string" && couleur.startsWith("#") && couleur.length === 7) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16));
    return Math.max(r, g, b) < 60;
  }
  if (Array.isArray(couleur)) return Math.max(...couleur) < 60;
  return false;
}

/**
 * Lit un document PDF déjà ouvert par pdf.js.
 * @returns {{ modele: string|null, pages: {traits: number[][][]}[] }}
 *   Chaque trait est une liste de points [x, y] en pixels de l'écran.
 */
export async function lireDocument(pdfjs, doc) {
  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const sujet = (meta.info && meta.info.Subject) || "";
  const modele = sujet.startsWith("portee:") ? sujet.split(":")[1] : null;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push({ traits: await lireTraits(pdfjs, page) });
  }
  return { modele, pages };
}

export async function lireTraits(pdfjs, page) {
  const OPS = pdfjs.OPS;
  const hauteurPt = page.view[3] - page.view[1];
  const liste = await page.getOperatorList();
  const pile = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let trait = "#000000";
  const traits = [];
  for (let i = 0; i < liste.fnArray.length; i++) {
    const op = liste.fnArray[i];
    const args = liste.argsArray[i];
    if (op === OPS.save) pile.push({ ctm, trait });
    else if (op === OPS.restore) ({ ctm, trait } = pile.pop() || { ctm, trait });
    else if (op === OPS.transform) ctm = multiplier(ctm, args);
    else if (op === OPS.setStrokeRGBColor) trait = args[0];
    else if (op === OPS.constructPath) {
      const [peinture, [donnees]] = args;
      if (peinture !== OPS.stroke && peinture !== OPS.closeStroke) continue;
      if (!estEncre(trait) || !donnees) continue;
      const vers = (x, y) => {
        const px = ctm[0] * x + ctm[2] * y + ctm[4];
        const py = ctm[1] * x + ctm[3] * y + ctm[5];
        return [px * PX_PAR_POINT, (hauteurPt - py) * PX_PAR_POINT];
      };
      let courant = [];
      const fermer = () => {
        if (courant.length > 1) traits.push(courant);
        courant = [];
      };
      for (let k = 0; k < donnees.length; ) {
        const c = donnees[k];
        if (c === MOVE) { fermer(); courant.push(vers(donnees[k + 1], donnees[k + 2])); k += 3; }
        else if (c === LINE) { courant.push(vers(donnees[k + 1], donnees[k + 2])); k += 3; }
        else if (c === CURVE) { courant.push(vers(donnees[k + 5], donnees[k + 6])); k += 7; }
        else if (c === QUAD) { courant.push(vers(donnees[k + 3], donnees[k + 4])); k += 5; }
        else if (c === CLOSE) { if (courant.length) courant.push(courant[0]); k += 1; }
        else break; // format inconnu : on s'arrête plutôt que de lire de travers
      }
      fermer();
    }
  }
  return traits;
}
