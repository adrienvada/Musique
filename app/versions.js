/**
 * LES VERSIONS D'UNE PARTITION, DITES EN UNE LIGNE (D6)
 *
 * La bibliothèque commune garde, à chaque écriture, la version d'avant (20
 * au plus, 30 jours), et 30 jours ce qui a été supprimé (lot données,
 * bibliotheque.js). Les écrans (versions-ui.js) montrent ces versions ; ici,
 * sans DOM, ce qu'ils en disent : ce qu'une version a changé par rapport à
 * celle d'avant, « quand c'est simple » (deux changements au plus, sinon
 * « et d'autres changements »), et combien de jours une partition reste
 * encore dans la corbeille.
 *
 * Vérifié par `npm run types`, essayé sous Node (tests/versions.test.mjs).
 */

/** Garder 30 jours (bibliotheque.js, LIMITES.garde). */
export const JOURS_DE_GARDE = 30;
const JOUR = 86400000;

const pluriel = (/** @type {number} */ n, /** @type {string} */ mot, motPluriel = `${mot}s`) => `${n} ${n > 1 ? motPluriel : mot}`;
const couper = (/** @type {string} */ t, /** @type {number} */ n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const egal = (/** @type {any} */ a, /** @type {any} */ b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const estObjet = (/** @type {any} */ v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Les notes de toutes les pistes, sans leur numéro (deux appareils ont pu renuméroter). */
function notesDe(/** @type {any} */ f) {
  const s = estObjet(f.sequence) ? f.sequence : null;
  if (!s || !Array.isArray(s.pistes)) return [];
  return s.pistes.flatMap((p, i) => (estObjet(p) && Array.isArray(p.notes) ? p.notes.map((n) => `${i}:${n.d},${n.l},${n.h}`) : [])).sort();
}
const accordsDe = (/** @type {any} */ f) => (estObjet(f.sequence) && Array.isArray(f.sequence.accords) ? f.sequence.accords.map((a) => `${a.d}:${a.nom}`) : []);
const doutesRestants = (/** @type {any} */ f) => (Array.isArray(f.doutes) ? f.doutes.filter((d) => estObjet(d) && !d.leve).length : 0);

/**
 * Ce que `apres` a changé par rapport à `avant` (deux fiches de la même
 * partition), en une ligne : « 3 notes de plus · titre « Pluie » ». Vide
 * s'il n'y a rien à dire (seule la date a bougé) ou pas de version d'avant.
 * @param {any} avant  la version d'avant (null : la plus ancienne gardée)
 * @param {any} apres
 * @returns {string}
 */
export function resumeChangement(avant, apres) {
  if (!estObjet(avant) || !estObjet(apres)) return "";
  /** @type {string[]} */
  const faits = [];
  if (avant.titre !== apres.titre && typeof apres.titre === "string") faits.push(`titre « ${couper(apres.titre, 40)} »`);
  if (apres.type === "idee") {
    const a = notesDe(avant), b = notesDe(apres);
    if (b.length > a.length) faits.push(`${pluriel(b.length - a.length, "note")} de plus`);
    else if (b.length < a.length) faits.push(`${pluriel(a.length - b.length, "note")} de moins`);
    else if (!egal(a, b)) faits.push("notes changées");
    const ca = accordsDe(avant), cb = accordsDe(apres);
    if (!ca.length && cb.length) faits.push(pluriel(cb.length, "accord posé", "accords posés"));
    else if (ca.length && !cb.length) faits.push("accords retirés");
    else if (!egal(ca, cb)) faits.push("accords changés");
    const sa = estObjet(avant.sequence) ? avant.sequence : {}, sb = estObjet(apres.sequence) ? apres.sequence : {};
    if (sa.tempo !== sb.tempo && Number.isFinite(sb.tempo)) faits.push(`tempo ${sb.tempo}`);
    if (!egal(sa.mesure, sb.mesure) && Array.isArray(sb.mesure)) faits.push(`mesure ${sb.mesure.join("/")}`);
    if (sa.tonalite !== sb.tonalite && typeof sb.tonalite === "string") faits.push(`tonalité ${sb.tonalite}`);
  } else if (apres.type === "morceau") {
    const a = Array.isArray(avant.blocs) ? avant.blocs : [], b = Array.isArray(apres.blocs) ? apres.blocs : [];
    if (b.length > a.length) faits.push(`${pluriel(b.length - a.length, "partie")} de plus`);
    else if (b.length < a.length) faits.push(`${pluriel(a.length - b.length, "partie")} de moins`);
    else if (!egal(a, b)) faits.push("parties changées");
    if (avant.tempo !== apres.tempo && Number.isFinite(apres.tempo)) faits.push(`tempo ${apres.tempo}`);
  } else {
    if (avant.abc !== apres.abc) faits.push("partition corrigée");
    const da = doutesRestants(avant), db = doutesRestants(apres);
    if (db < da) faits.push(`${pluriel(da - db, "doute réglé", "doutes réglés")}`);
    else if (db > da) faits.push(`${pluriel(db - da, "doute rouvert", "doutes rouverts")}`);
    if (avant.statut !== apres.statut) faits.push(apres.statut === "prete" ? "marquée prête" : "de nouveau à relire");
    if (avant.tempo !== apres.tempo && Number.isFinite(apres.tempo)) faits.push(`tempo ${apres.tempo}`);
    if ((avant.transposition || 0) !== (apres.transposition || 0)) faits.push("transposée");
  }
  const ea = Array.isArray(avant.etiquettes) ? avant.etiquettes : [], eb = Array.isArray(apres.etiquettes) ? apres.etiquettes : [];
  const plus = eb.filter((t) => !ea.includes(t)), moins = ea.filter((t) => !eb.includes(t));
  if (plus.length || moins.length) faits.push(`étiquettes ${[...plus.map((t) => `+${t}`), ...moins.map((t) => `−${t}`)].slice(0, 3).join(" ")}`);
  if ((avant.note || "") !== (apres.note || "")) faits.push(apres.note ? "note changée" : "note effacée");
  if (!!avant.favori !== !!apres.favori) faits.push(apres.favori ? "en favori" : "plus en favori");
  if (!egal(avant.memo, apres.memo)) faits.push(!apres.memo ? "mémo effacé" : !avant.memo ? "mémo ajouté" : "mémo changé");
  if (faits.length > 2) return `${faits.slice(0, 2).join(" · ")} et d'autres changements`;
  return faits.join(" · ");
}

/**
 * Les jours qui restent avant que la corbeille oublie une partition (au moins 0).
 * @param {string} expireLe  la date ISO où elle part pour de bon
 * @param {number} [maintenant]
 */
export function joursRestants(expireLe, maintenant = Date.now()) {
  const t = Date.parse(expireLe);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - maintenant) / JOUR));
}

/**
 * « encore 27 jours », « encore 1 jour », « dernier jour » : ce qui reste avant l'oubli.
 * @param {string} expireLe
 * @param {number} [maintenant]
 */
export function resteDansLaCorbeille(expireLe, maintenant = Date.now()) {
  const j = joursRestants(expireLe, maintenant);
  return j <= 1 ? "dernier jour" : `encore ${j} jours`;
}

/**
 * « Idée », « Morceau », « Partition » : la sorte d'une fiche, pour une ligne.
 * @param {any} type
 */
export const nomDeSorte = (type) => (type === "idee" ? "Idée" : type === "morceau" ? "Morceau" : "Partition");

/**
 * « revenue », « revenu » : l'accord avec la sorte (une idée, une partition ; un morceau).
 * @param {any} type
 * @param {string} radical  « revenu », « supprimé »
 */
export const accordeSorte = (type, radical) => `${radical}${type === "morceau" ? "" : "e"}`;
