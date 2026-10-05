/**
 * IMPORTER : UNE PAGE EXPORTÉE DE LA TABLETTE, OU UN FICHIER MIDI
 *
 * Un PDF exporté de la reMarkable : pdf.js en tire les traits
 * (lecteur/extraction.js), le lecteur de traits les lit en ABC, et la
 * partition se range « à relire ». Un .mid (de Live, par exemple) devient
 * une idée. Les traits venus directement de la tablette (tablette.js)
 * passent par la même porte : `enregistrerLecture`.
 *
 * Les modèles de papier (modeles/*.json) disent où sont les lignes, version
 * par version (audit du 04/10, L9) : `calibration(modele, version)` charge
 * celle sur laquelle la page a été écrite, jamais celle d'une autre version.
 * Le sujet du PDF dit le modèle ; ses lignes grises le confirment, le
 * trouvent quand le sujet manque, et l'emportent quand il se trompe, comme
 * `npm run lire` ; une page qui a bougé (boîte décalée, export
 * redimensionné) se recale sur elles.
 */
import { lireDocument } from "./lecteur/extraction.js";
import { lirePartition, VERSION_LECTEUR } from "./lecteur/partition.js";
import { ajuster, fichierCalibration, identifierModele, recaler, verifierVersion } from "./lecteur/modeles.js";
import { gabaritsVides, lireEtalonnage } from "./lecteur/gabarits.js";
import { lireGabarits, nouvelId, rangerGabarits } from "./stockage.js";
import { egal } from "./fiche.js";
import { ideeDepuisMidi } from "./midi.js";
import { ecrireAbc } from "./sequence.js";
import { voixCompletes } from "./harmonie.js";
import { preparerDoutes } from "./doutes.js";
import { apercuTraits } from "./apercus.js";
import { bilanEtalonnage, MODELES, nomModele } from "./tablette.js";
import { confirmer } from "./dialogue.js";
import { erreur, explication } from "./erreurs.js";
import { pluriel, toast } from "./ui.js";

const EXEMPLES = ["2026-09-30-piano-standard.pdf", "2026-09-30-melodie-standard.pdf"];

// Les promesses de chaque calibration (« melodie-standard:v1 », ou
// « melodie-standard:en-cours ») : chacune n'est demandée qu'une fois.
const calibrations = new Map();

/** Garde la promesse ; un échec (le réseau) ne reste pas : le prochain appel redemande. */
function retenir(cle, charger) {
  if (!calibrations.has(cle)) {
    const promesse = charger();
    calibrations.set(cle, promesse);
    promesse.catch(() => { if (calibrations.get(cle) === promesse) calibrations.delete(cle); });
  }
  return calibrations.get(cle);
}

const adresseModele = (fichier) => new URL(`./modeles/${fichier}`, import.meta.url);

/**
 * La calibration d'un modèle de papier, à la version où la page a été écrite
 * (où sont les portées, l'interligne…) : `modeles/<modèle>-v<N>.json`, à
 * défaut la version en cours (`<modèle>.json`) si c'est la même. Une version
 * que cette appli ne connaît pas est refusée (« mets l'appli à jour ») plutôt
 * que lue de travers. Sans version (une page lue avant le 05/10, un PDF
 * d'avant les versions) : la v1, la seule qui existait.
 * @param {string} modele
 * @param {number | null} [version]
 */
export function calibration(modele, version = null) {
  const v = Number.isInteger(version) && version > 0 ? version : 1;
  return retenir(`${modele}:v${v}`, async () => {
    let r = await fetch(adresseModele(fichierCalibration(modele, v)));
    if (!r.ok) r = await fetch(adresseModele(fichierCalibration(modele, null)));
    if (!r.ok) throw erreur("modele_inconnu", `Cette page a été écrite sur le modèle « ${nomModele(modele)} », que cette version de Portée ne connaît pas : mets l'appli à jour.`);
    const cal = await r.json();
    verifierVersion(cal, { modele, version: v });
    return cal;
  });
}

/** Les calibrations en cours des modèles de Portée (la page d'étalonnage comprise) : de quoi reconnaître une page à ses lignes. */
function calibrationsConnues() {
  return Promise.all(MODELES.map((m) => retenir(`${m.id}:en-cours`, async () => {
    const r = await fetch(adresseModele(fichierCalibration(m.id, null)));
    if (!r.ok) throw erreur("modele_inconnu", `Le modèle « ${m.nom} » n'a pas pu venir.`);
    return r.json();
  }).catch(() => null))).then((cals) => cals.filter(Boolean));
}

/**
 * Le modèle d'un PDF lu (lireDocument), et ses pages recalées sur leurs
 * lignes grises. `avertissement` : le sujet manquait, ou se trompait (les
 * lignes l'emportent, et on le dit). Null si rien ne dit le modèle.
 */
async function modeleDuPdf(lu) {
  let { modele, version } = lu;
  let avertissement = null;
  const avecLignes = lu.pages.length && lu.pages[0].lignes && lu.pages[0].lignes.length;
  const reconnu = avecLignes ? identifierModele(lu.pages[0], await calibrationsConnues()) : null;
  if (reconnu && reconnu.cal.modele !== modele) {
    avertissement = modele
      ? `Le PDF dit « ${nomModele(modele)} », mais ses lignes sont celles de « ${nomModele(reconnu.cal.modele)} » : lue avec ce modèle.`
      : `Le PDF ne disait pas son modèle : reconnu à ses lignes (${nomModele(reconnu.cal.modele)}).`;
    modele = reconnu.cal.modele;
    version = reconnu.cal.version || 1;
  }
  if (!modele) return null;
  const cal = await calibration(modele, version);
  const pages = lu.pages.map((p) => { const t = ajuster(p, cal); return t && t.ecart < 1.5 ? recaler(p.traits, t) : p.traits; });
  return { modele, version: cal.version || 1, cal, pages, avertissement };
}

/** Un fichier que l'import sait lire : un PDF (de la tablette) ou un .mid (de Live, par exemple). */
export const estImportable = (f) => /\.(pdf|midi?)$/i.test(f.name) || f.type === "application/pdf" || /midi/i.test(f.type);

/** Une sauvegarde de Portée (un .json), qui se restaure au lieu de s'importer. */
const estSauvegarde = (f) => /\.json$/i.test(f.name) || f.type === "application/json";

/**
 * Le cache où le service worker garde un fichier partagé vers Portée, le
 * temps que la page le prenne (sw.js, share_target du manifeste).
 */
export const CACHE_PARTAGE = "portee-partage";

/** « Essai melodie standard » d'après « Essai_melodie standard copy.pdf ». */
export function titreDepuisFichier(nom) {
  return nom.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+copy$/i, "").trim() || "Sans titre";
}

/**
 * pdf.js, chargé à la demande (1,8 Mo, seulement pour importer un PDF).
 *
 * Après un échec (le réseau a manqué), on retente à une autre adresse : le
 * navigateur garde l'échec d'un import() attaché à son adresse jusqu'au
 * rechargement de la page (essayé dans Chromium), et l'appli gardait en
 * plus la promesse ratée. L'import de PDF échouait alors jusqu'au
 * rechargement, même le réseau revenu (audit du 04/10, T4).
 */
let pdfjsPromesse = null, essaisPdfjs = 0;
function chargerPdfjs() {
  if (!pdfjsPromesse) {
    const adresse = new URL("./vendor/pdfjs/pdf.min.mjs", import.meta.url);
    if (essaisPdfjs) adresse.searchParams.set("essai", String(essaisPdfjs));
    essaisPdfjs++;
    pdfjsPromesse = import(adresse.href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
      return pdfjs;
    }, (e) => {
      pdfjsPromesse = null;
      throw e;
    });
  }
  return pdfjsPromesse;
}

/** Le titre que la lecture a écrit dans l'ABC (T:), pour qu'une relecture écrive le même. */
const titreLu = (p) => ((p.abcLu || "").match(/^T:(.*)$/m) || [])[1] ?? p.titre;

/**
 * Une page lue que tu n'as pas encore touchée : rien de corrigé, aucun doute
 * réglé, pas « Prête ». Une relecture ne peut rien y défaire ; une page
 * corrigée ou validée porte ta lecture (et le banc d'essai la prend pour vraie).
 * @param {any} p
 */
export const pasEncoreCorrigee = (p) => !!p && !p.type && p.abc === p.abcLu && p.statut !== "prete" && !(p.doutes || []).some((d) => d.leve);

/**
 * @param {Object} deps { stockage() → le stockage ouvert, ouvrir(id, vue),
 *   partitions() → la bibliothèque (pour relire les pages pas encore corrigées) }
 */
export function creerImport({ stockage, ouvrir, partitions = () => [] }) {
  /**
   * Tes gabarits (L16), pour lire avec eux. Une bibliothèque qui ne les rend
   * pas (une fiche abîmée) ne bloque pas la lecture : sans eux, rien ne
   * change à ce qu'elle lit.
   */
  async function gabarits() {
    try { return await lireGabarits(stockage()); } catch (e) { console.warn("Tes gabarits ne se lisent pas : lecture sans eux.", e); return null; }
  }

  /** Range ce que Portée vient d'apprendre de ton écriture (une page d'étalonnage, une réponse) ; rend le nombre d'exemples neufs. */
  const apprendre = (g) => rangerGabarits(stockage(), g);

  /**
   * Lit les pages et range la partition. Commun à l'import d'un PDF et à
   * l'import direct depuis la reMarkable. `version` : celle du modèle
   * (le sujet du PDF, ou `versionModele` du connecteur ; absente, la v1).
   * `avertissement` : ce qu'il faut dire en plus (un modèle reconnu à ses
   * lignes, une page de la tablette illisible). La lecture se fait avec tes
   * gabarits : tes silences, altérations et chiffres, appris (L16).
   */
  async function enregistrerLecture({ titre, modele, version = null, pages, source = null, avertissement = null }) {
    const cal = await calibration(modele, version);
    const res = lirePartition(pages, cal, { titre, gabarits: await gabarits() });
    const maintenant = new Date().toISOString();
    const id = nouvelId();
    await stockage().creer(id, {
      titre,
      modele,
      // La version du modèle : une relecture (et le banc d'essai) prendra la même calibration.
      versionModele: cal.version || 1,
      abc: res.abc,
      abcLu: res.abc,
      // La forme que les essais du lecteur vérifient (doutes.js) : aucun doute levé, chacun vise sa cible.
      doutes: preparerDoutes(res.doutes),
      statut: "a-relire",
      nbPages: pages.length,
      apercu: apercuTraits(pages[0], cal),
      versionLecteur: VERSION_LECTEUR,
      source,
      creeLe: maintenant,
      modifieLe: maintenant,
    }, pages);
    const bilan = res.doutes.length ? `${pluriel(res.doutes.length, "point")} à vérifier` : "rien à signaler";
    toast(`« ${titre} » est lue : ${bilan}.${avertissement ? ` ${avertissement}` : ""}`, avertissement ? 9000 : 4000);
    return id;
  }

  /**
   * Un fichier MIDI devient une idée : l'aller-retour avec Ableton (une phrase
   * retravaillée dans Live revient dans Portée). Les notes sont recalées au
   * pas (midi.js, ideeDepuisMidi) ; l'idée s'enregistre comme une autre, et
   * s'ouvre si c'est le seul fichier importé.
   */
  async function importerMidi(f) {
    const titre = f.name.replace(/\.midi?$/i, "").replace(/[_]+/g, " ").trim() || "Idée MIDI";
    const { sequence, ecartees } = ideeDepuisMidi(new Uint8Array(await f.arrayBuffer()));
    const nb = sequence.pistes.reduce((n, p) => n + p.notes.length, 0);
    if (!nb) { toast(`« ${f.name} » ne contient aucune note à garder.`, 6000); return null; }
    const id = nouvelId();
    const maintenant = new Date().toISOString();
    await stockage().creer(id, {
      type: "idee", titre, sequence, abc: ecrireAbc(sequence, { voix: voixCompletes(sequence), titre }).abc,
      statut: "idee", nbPages: 0, modele: null, tempo: sequence.tempo, note: "", etiquettes: [], favori: false, memo: null,
      creeLe: maintenant, modifieLe: maintenant,
    }, []);
    const laisse = [ecartees.pistes ? `${pluriel(ecartees.pistes, "piste")} de plus` : "", ecartees.batterie ? "la batterie" : ""].filter(Boolean).join(" et ");
    toast(`« ${titre} » : ${pluriel(nb, "note")}, une idée de plus.${laisse ? ` Laissées de côté : ${laisse} (une idée garde quatre pistes, sans percussions).` : ""}`, laisse ? 8000 : 4000);
    return id;
  }

  /**
   * Les pages pas encore corrigées, relues avec tes gabarits d'aujourd'hui
   * (L16) : un signe qu'elles laissaient de côté peut maintenant se lire.
   * Chaque page est relue d'après sa fiche du moment (si tu l'as corrigée
   * entre-temps, elle n'y passe pas). Rend { relues, changees }.
   */
  async function relirePages(ids) {
    const g = await gabarits();
    let relues = 0, changees = 0;
    for (const id of ids) {
      try {
        const f = await stockage().lire(id);
        if (!pasEncoreCorrigee(f) || !f.nbPages) continue;
        const pages = await stockage().pages(id, f.nbPages);
        if (!pages.some((t) => t.length)) continue;
        const res = lirePartition(pages, await calibration(f.modele, f.versionModele), { titre: titreLu(f), gabarits: g });
        relues++;
        const doutes = preparerDoutes(res.doutes);
        if (res.abc === f.abc && egal(doutes, f.doutes || [])) continue;
        await stockage().modifier(id, { abc: res.abc, abcLu: res.abc, doutes, versionLecteur: VERSION_LECTEUR, modifieLe: new Date().toISOString() }, { depuis: f });
        changees++;
      } catch (e) {
        console.error(e); // une page qui ne se relit pas garde sa lecture ; les autres continuent
      }
    }
    return { relues, changees };
  }

  /** Les pages qui gagneraient à être relues (hors `sauf`, la page ouverte). */
  const aRelire = (sauf = null) => partitions().filter((p) => pasEncoreCorrigee(p) && p.nbPages > 0 && p.id !== sauf).map((p) => p.id);

  /** Relit, puis dit ce qui a changé. */
  async function relireEtDire(ids) {
    toast(`Relecture de ${pluriel(ids.length, "page")}…`, 60000);
    const { changees } = await relirePages(ids);
    toast(changees ? `${pluriel(changees, "page")} ${changees > 1 ? "se lisent" : "se lit"} autrement avec ce que Portée a appris : ses doutes sont à jour.` : "Relues : elles se lisent comme avant.", 6000);
  }

  /**
   * Quand tes gabarits changent : relire les pages pas encore corrigées ?
   * Une question (dialogue.js), jamais une relecture d'office. `texte` : ce
   * qui vient d'être appris, dit avant la question.
   */
  async function proposerRelecture({ sauf = null, texte = "" } = {}) {
    const ids = aRelire(sauf);
    if (!ids.length) return false;
    const n = ids.length;
    const oui = await confirmer({
      titre: n > 1 ? `Relire tes ${n} pages pas encore corrigées ?` : "Relire ta page pas encore corrigée ?",
      texte: `${texte ? `${texte} ` : ""}Relue avec ce que Portée vient d'apprendre, ${n > 1 ? "chacune se lira" : "elle se lira"} peut-être mieux. Les pages que tu as corrigées ne bougent pas.`,
      oui: "Relire", danger: false,
    });
    if (oui) await relireEtDire(ids);
    return oui;
  }

  /**
   * Une page d'étalonnage remplie (L16) : pas une partition. Chaque case
   * apprend son signe (lireEtalonnage), page après page ; ce qui est appris
   * rejoint tes gabarits, puis Portée propose de relire les pages pas encore
   * corrigées. Le message dit combien de signes sont appris, et quelles
   * cases sont restées vides.
   */
  async function importerEtalonnage({ nom, pages, version = null, avertissement = null }) {
    const cal = await calibration("etalonnage", version);
    let g = (await gabarits()) || gabaritsVides();
    const compte = new Map(cal.cases.map((c) => [c.etiquette, 0]));
    for (const traits of pages) {
      const r = lireEtalonnage(traits, cal, g);
      g = r.gabarits;
      for (const c of r.cases) compte.set(c.etiquette, (compte.get(c.etiquette) || 0) + c.exemples);
    }
    const appris = [...compte.values()].reduce((a, b) => a + b, 0);
    const neufs = appris ? await apprendre(g) : 0;
    const vides = cal.cases.filter((c) => !compte.get(c.etiquette)).map((c) => c.nom);
    const bilan = bilanEtalonnage({ appris, neufs, vides, cases: cal.cases.length }) + (avertissement ? ` ${avertissement}` : "");
    if (!neufs || !(await proposerRelecture({ texte: bilan }))) toast(bilan, 12000);
    return { appris, neufs, vides, nom };
  }

  /** Des PDF de la tablette, ou des .mid : chacun lu à son tour ; un seul fichier s'ouvre aussitôt. */
  async function importer(fichiers) {
    if (!stockage()) { toast("La bibliothèque s'ouvre encore, réessaie dans un instant."); return; }
    let dernier = null;
    for (const f of fichiers) {
      try {
        toast(`Lecture de « ${f.name} »…`, 60000);
        if (/\.midi?$/i.test(f.name) || /midi/i.test(f.type)) { dernier = (await importerMidi(f)) || dernier; continue; }
        const pdfjs = await chargerPdfjs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
        const lu = await modeleDuPdf(await lireDocument(pdfjs, doc));
        if (!lu) {
          toast(`« ${f.name} » n'a pas été écrit sur un modèle Portée : impossible de savoir où sont les lignes. Duplique un modèle sur la tablette et écris dessus.`, 9000);
          continue;
        }
        // La tablette exporte tout le document : on ne garde que les pages écrites.
        const pages = lu.pages.filter((t) => t.length > 0);
        if (!pages.length) { toast(`« ${f.name} » ne contient aucun trait.`); continue; }
        // La page d'étalonnage (L16) apprend tes signes : pas de partition.
        if (lu.cal.genre === "etalonnage") { await importerEtalonnage({ nom: titreDepuisFichier(f.name), pages, version: lu.version, avertissement: lu.avertissement }); continue; }
        dernier = await enregistrerLecture({ titre: titreDepuisFichier(f.name), modele: lu.modele, version: lu.version, pages, avertissement: lu.avertissement });
      } catch (e) {
        console.error(e);
        toast(`Impossible de lire « ${f.name} » : ${explication(e)}`, 9000);
      }
    }
    if (dernier && fichiers.length === 1) ouvrir(dernier, "atelier");
  }

  /** « Essayer avec les pages d'essai » : les deux pages du 30/09, importées comme des PDF. */
  async function importerExemples() {
    const fichiers = [];
    for (const n of EXEMPLES) {
      try {
        const r = await fetch(new URL(`./exemples/${n}`, import.meta.url));
        if (r.ok) fichiers.push(new File([await r.blob()], n.replace("2026-09-30-", "Essai "), { type: "application/pdf" }));
      } catch (e) {
        console.error(e);
        toast(`Les pages d'essai n'ont pas pu venir : ${explication(e)}`, 9000);
        return;
      }
    }
    await importer(fichiers);
  }

  // -------------------------------------------------------------------------
  // Un fichier qu'on ouvre avec Portée, ou qu'on lui partage (l'appli installée, I4)
  // -------------------------------------------------------------------------

  /**
   * Des fichiers reçus d'ailleurs que du bouton « Importer » : un PDF ou un
   * .mid passent par l'import, une sauvegarde par la restauration
   * (`restaurer`, sauvegarde-ui.js). Aucun autre chemin d'écriture.
   */
  async function recevoir(fichiers, { restaurer }) {
    const sauvegardes = fichiers.filter(estSauvegarde);
    const lisibles = fichiers.filter((f) => !estSauvegarde(f) && estImportable(f));
    if (lisibles.length + sauvegardes.length < fichiers.length) toast("Portée ouvre les PDF de la tablette, les fichiers MIDI et ses sauvegardes : le reste est laissé de côté.", 7000);
    if (lisibles.length) await importer(lisibles);
    for (const f of sauvegardes) await restaurer(f);
  }

  /**
   * Un fichier partagé vers Portée (Android : l'appli reMarkable ou Fichiers
   * → Partager → Portée). Le système l'a envoyé au service worker, qui l'a
   * gardé et a rouvert la page sur `?partage` (sw.js) : on le reprend, une
   * fois, et il quitte le cache.
   */
  async function recevoirPartage({ restaurer }) {
    let cache;
    try { cache = await caches.open(CACHE_PARTAGE); } catch { return; }
    const fichiers = [];
    for (const requete of await cache.keys()) {
      const r = await cache.match(requete);
      if (r) fichiers.push(new File([await r.blob()], decodeURIComponent(r.headers.get("x-portee-nom") || "partage.pdf"), { type: r.headers.get("content-type") || "" }));
      await cache.delete(requete);
    }
    // L'adresse redevient celle de l'appli (le même état d'historique, historique.js) : recharger
    // plus tard n'y chercherait plus un partage déjà pris.
    try { history.replaceState(history.state, "", location.pathname); } catch { /* un historique fermé : sans suite */ }
    if (fichiers.length) await recevoir(fichiers, { restaurer });
    else toast("Le partage n'a apporté aucun fichier : partage un PDF exporté de la tablette, ou un fichier MIDI.", 7000);
  }

  /**
   * Ce que l'appli installée reçoit en se lançant. Sur l'ordinateur (Chrome,
   * Edge), un fichier ouvert d'un double clic (file_handlers), ou un
   * raccourci touché alors que Portée est déjà ouverte : le manifeste dit
   * « focus-existing », la fenêtre ouverte reçoit le lancement au lieu
   * d'une deuxième fenêtre ; `raccourci(adresse)` ouvre ce qu'il dit
   * (accueil.js). Le premier lancement est celui de cette page : son
   * adresse est déjà lue au démarrage. Sur Android, un partage (voir
   * recevoirPartage).
   */
  function recevoirLancements({ raccourci, restaurer }) {
    if (new URLSearchParams(location.search).has("partage")) recevoirPartage({ restaurer }).catch((e) => { console.error(e); toast(`Le fichier partagé n'a pas pu s'ouvrir : ${explication(e)}`, 9000); });
    if (!("launchQueue" in window)) return;
    let premier = true;
    window.launchQueue.setConsumer(async (lancement) => {
      const deCettePage = premier && lancement.targetURL === location.href;
      premier = false;
      const fichiers = [];
      for (const poignee of lancement.files || []) {
        try { fichiers.push(await poignee.getFile()); } catch (e) { console.error(e); toast(`Ce fichier n'a pas pu s'ouvrir : ${explication(e)}`, 9000); }
      }
      if (fichiers.length) await recevoir(fichiers, { restaurer });
      else if (lancement.targetURL && !deCettePage) raccourci(lancement.targetURL);
    });
  }

  return { importer, importerExemples, enregistrerLecture, importerEtalonnage, gabarits, apprendre, proposerRelecture, aRelire, relireEtDire, recevoirLancements };
}
