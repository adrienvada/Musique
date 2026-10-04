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
 * L'origine est le coin haut gauche de la page telle que le PDF la décrit
 * (sa MediaBox) : une page dont la boîte ne part pas de (0, 0) était lue
 * décalée d'autant, toutes ses notes fausses (audit du 04/10, M9).
 *
 * On garde aussi les lignes grises du modèle (les portées imprimées) : elles
 * disent quel modèle a servi quand le sujet du PDF manque ou se trompe, et
 * permettent de se recaler dessus (modeles.js). Sur les pages d'essai, elles
 * tombent sur la calibration à 0,000 px près.
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

function rvb(couleur) {
  if (typeof couleur === "string" && couleur.startsWith("#") && couleur.length === 7) return [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16));
  if (Array.isArray(couleur) && couleur.length === 3) return couleur;
  return null;
}

/** Une couleur est de l'encre si elle est presque noire. */
function estEncre(couleur) {
  const c = rvb(couleur);
  return !!c && Math.max(...c) < 60;
}

/** Le gris neutre des lignes imprimées du modèle (ni l'encre, ni le blanc). */
function estGris(couleur) {
  const c = rvb(couleur);
  return !!c && Math.max(...c) - Math.min(...c) < 8 && c[0] >= 60 && c[0] <= 230;
}

/**
 * Le sujet d'un PDF Portée : « portee:<modèle>:v<version> ». La version
 * compte : une page écrite sur un modèle v2 ne doit pas être lue avec la
 * calibration v1 (avant, elle était jetée en chemin).
 */
export function lireSujet(sujet) {
  const m = /^portee:([a-z0-9-]+):v(\d+)$/.exec(String(sujet || "").trim());
  if (m) return { modele: m[1], version: Number(m[2]) };
  const ancien = /^portee:([a-z0-9-]+)/.exec(String(sujet || "").trim());
  return ancien ? { modele: ancien[1], version: null } : { modele: null, version: null };
}

/**
 * Lit un document PDF déjà ouvert par pdf.js.
 * @param {any} pdfjs  la bibliothèque pdf.js (son `OPS`)
 * @param {any} doc    le document ouvert par pdf.js
 * @returns {Promise<{ modele: string|null, version: number|null,
 *             pages: { traits: number[][][], lignes: number[], verticales: number[] }[] }>}
 *   Chaque trait est une liste de points [x, y] en pixels de l'écran ;
 *   `lignes` (ordonnées) et `verticales` (abscisses) sont les traits gris du modèle.
 */
export async function lireDocument(pdfjs, doc) {
  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const { modele, version } = lireSujet(meta.info && meta.info.Subject);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push(await lirePageDuDocument(pdfjs, page));
  }
  return { modele, version, pages };
}

/** Les traits d'encre d'une page (ce qu'Adrien a écrit), comme avant. */
export async function lireTraits(pdfjs, page) {
  return (await lirePageDuDocument(pdfjs, page)).traits;
}

/** Les traits d'encre et les lignes grises du modèle d'une page. */
export async function lirePageDuDocument(pdfjs, page) {
  const OPS = pdfjs.OPS;
  const [vx0, vy0, vx1, vy1] = page.view;
  const gauche = Math.min(vx0, vx1), haut = Math.max(vy0, vy1);
  const liste = await page.getOperatorList();
  const pile = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let trait = "#000000";
  const traits = [], lignes = [], verticales = [];
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
      const encre = estEncre(trait), gris = !encre && estGris(trait);
      if ((!encre && !gris) || !donnees) continue;
      const vers = (x, y) => {
        const px = ctm[0] * x + ctm[2] * y + ctm[4];
        const py = ctm[1] * x + ctm[3] * y + ctm[5];
        return [(px - gauche) * PX_PAR_POINT, (haut - py) * PX_PAR_POINT];
      };
      const chemins = [];
      let courant = [];
      const fermer = () => {
        if (courant.length > 1) chemins.push(courant);
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
      if (encre) { traits.push(...chemins); continue; }
      // Une ligne du modèle : droite, horizontale (portée) ou verticale (début et fin de système).
      for (const ch of chemins) {
        const [a, b] = [ch[0], ch[ch.length - 1]];
        if (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[0] - b[0]) > 600) lignes.push(Math.round(((a[1] + b[1]) / 2) * 1000) / 1000);
        else if (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) > 60) verticales.push(Math.round(((a[0] + b[0]) / 2) * 1000) / 1000);
      }
    }
  }
  return { traits, lignes: lignes.sort((a, b) => a - b), verticales: [...new Set(verticales)].sort((a, b) => a - b) };
}
