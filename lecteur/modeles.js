/**
 * LES MODÈLES, LEURS VERSIONS ET LEURS LIGNES GRISES (L9)
 *
 * Une page dit sur quel modèle elle a été écrite par le sujet de son PDF
 * (« portee:melodie-standard:v1 »). La version compte : un modèle v2 aurait
 * d'autres lignes, et le lire avec la calibration v1 placerait toutes les
 * notes de travers, sans rien dire. Chaque version garde donc sa calibration
 * (`modeles/<modèle>-v<N>.json`, écrite par le générateur à côté de
 * `<modèle>.json`, la version en cours), et une version inconnue est refusée
 * avec un message clair.
 *
 * Les lignes grises du modèle sont dans le PDF exporté (extraction.js), à
 * 0,000 px près de la calibration sur tes pages d'essai. Elles disent quel
 * modèle a servi quand le sujet manque ou se trompe, et permettent de se
 * recaler dessus si la page a bougé (une boîte de page décalée, un export
 * redimensionné) : les traits sont ramenés là où la calibration les attend.
 *
 * Pur, sans dépendance : le navigateur et Node s'en servent tels quels.
 */

/** Le fichier de la calibration d'un modèle à une version donnée. */
export function fichierCalibration(modele, version) {
  if (!/^[a-z0-9-]+$/.test(modele || "")) throw new Error(`Nom de modèle illisible : « ${modele} ».`);
  return version ? `${modele}-v${version}.json` : `${modele}.json`;
}

/**
 * Vérifie qu'une calibration est bien celle de la page : même modèle, même
 * version. Une page sans version dans son sujet est une v1 (il n'y en avait pas
 * d'autre avant le 04/10).
 */
export function verifierVersion(cal, { modele, version }) {
  const attendue = version || 1;
  if (cal.modele && modele && cal.modele !== modele) throw new Error(`La calibration est celle du modèle « ${cal.modele} », pas de « ${modele} ».`);
  if ((cal.version || 1) !== attendue) {
    throw new Error(`Cette page a été écrite sur le modèle « ${cal.titre || modele} » v${attendue}, que cette version de Portée ne connaît pas (elle connaît la v${cal.version || 1}) : mets l'appli à jour.`);
  }
}

/** Toutes les lignes de portée d'une calibration, de haut en bas. */
const lignesDe = (cal) => (cal.systemes || []).flatMap((s) => s.portees.flatMap((p) => p.lignes)).sort((a, b) => a - b);

/**
 * La transformation qui amène les lignes grises trouvées sur celles de la
 * calibration : y' = ay·y + by (moindres carrés, ligne à ligne, dans l'ordre),
 * et x' = ax·x + bx d'après les deux barres verticales des systèmes quand elles
 * sont là. `ecart` : le plus grand écart restant, en pixels. Null si les
 * lignes ne correspondent pas une à une.
 */
export function ajuster(page, cal) {
  const trouvees = [...(page.lignes || [])].sort((a, b) => a - b);
  const attendues = lignesDe(cal);
  if (trouvees.length < 5 || trouvees.length !== attendues.length) return null;
  const n = trouvees.length;
  const mx = trouvees.reduce((a, b) => a + b, 0) / n, my = attendues.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (trouvees[i] - mx) * (attendues[i] - my); sxx += (trouvees[i] - mx) ** 2; }
  const ay = sxx ? sxy / sxx : 1, by = my - ay * mx;
  const ecart = Math.max(...trouvees.map((y, i) => Math.abs(ay * y + by - attendues[i])));
  let ax = 1, bx = 0;
  const v = [...(page.verticales || [])].sort((a, b) => a - b);
  if (v.length >= 2 && cal.x_debut !== undefined && cal.x_fin !== undefined && v[v.length - 1] - v[0] > 100) {
    ax = (cal.x_fin - cal.x_debut) / (v[v.length - 1] - v[0]);
    bx = cal.x_debut - ax * v[0];
  }
  return { ay, by, ax, bx, ecart };
}

/** La transformation ne change rien (à un centième de pixel près sur la page). */
export function estIdentite(t) {
  return !t || (Math.abs(t.ay - 1) * 2000 < 0.01 && Math.abs(t.by) < 0.01 && Math.abs(t.ax - 1) * 1500 < 0.01 && Math.abs(t.bx) < 0.01);
}

/**
 * Quel modèle a servi, d'après les lignes grises de la page ? `calibrations` :
 * celles que l'appli connaît. Rend { cal, transformation } pour la meilleure,
 * si ses lignes tombent à 1,5 px près (une fois recalées) et que l'échelle est
 * presque la même (3 % au plus), sinon null.
 */
export function identifierModele(page, calibrations) {
  let meilleur = null;
  for (const cal of calibrations) {
    if (cal.genre === "etalonnage") continue;
    const t = ajuster(page, cal);
    if (!t || t.ecart > 1.5 || Math.abs(t.ay - 1) > 0.03) continue;
    if (!meilleur || t.ecart < meilleur.transformation.ecart) meilleur = { cal, transformation: t };
  }
  return meilleur;
}

/** Les traits ramenés dans le repère de la calibration. */
export function recaler(traits, t) {
  if (estIdentite(t)) return traits;
  return traits.map((tr) => tr.map(([x, y]) => [t.ax * x + t.bx, t.ay * y + t.by]));
}
