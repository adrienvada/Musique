/**
 * PORTÉE — l'appli
 *
 * Trois écrans : la bibliothèque (tes partitions), « Corriger » (ta page à
 * côté de ce que Portée a lu) et « Écouter et exporter » (la partition
 * gravée, jouée au piano, exportée en MIDI). Tout passe par le texte ABC de
 * la partition : le lecteur de traits l'écrit, abcjs le grave et le joue.
 * Adrien ne l'écrit jamais lui-même : il touche une note et choisit un
 * geste (plus haut, noire, dièse…), et edition.js réécrit l'ABC.
 *
 * Ce module ne fait que composer (audit du 04/10, T3) : il crée les écrans
 * et les modules, leur passe ce dont ils ont besoin, et tient le registre
 * des écrans (navigation.js dit ce que chacun déclare). Le reste vit chez
 * qui s'en sert : un écran (accueil, ecran-atelier, ecran-lecteur, idee,
 * vue-morceau), ses enregistrements (enregistreur.js, page-ouverte.js),
 * les gestes sur une partition entière (gestes.js), l'import, les exports,
 * la tablette, la synchronisation, les erreurs.
 */
import { Piano } from "./piano.js";
import { Transport } from "./transport.js";
import { nouvelId, ouvrirStockage } from "./stockage.js";
import { egal } from "./fiche.js";
import { midiDuMorceau } from "./morceau.js";
import { midiDeLIdee } from "./midi.js";
import { creerEditeurIdee } from "./idee.js";
import { creerVueMorceau } from "./vue-morceau.js";
import { creerAccueil, toutesEtiquettes } from "./accueil.js";
import { creerEcranAtelier } from "./ecran-atelier.js";
import { creerEcranLecteur } from "./ecran-lecteur.js";
import { creerPageOuverte } from "./page-ouverte.js";
import { creerEcoute } from "./ecoute.js";
import { reprendreSecours } from "./enregistreur.js";
import { creerEcoutePage } from "./atelier.js";
import { creerExports } from "./exports.js";
import { calibration, creerImport } from "./import-pdf.js";
import { creerTablette } from "./tablette.js";
import { creerSynchronisation } from "./synchronisation-ui.js";
import { brancherSauvegarde } from "./sauvegarde-ui.js";
import { brancherHorsLigne, brancherInstallation } from "./mises-a-jour.js";
import { installerEveil } from "./eveil.js";
import { brancherLive } from "./reglages-live.js";
import { injecterIcones } from "./icones.js";
import { ambianceStudio } from "./preferences.js";
import { creerNavigation } from "./navigation.js";
import { creerGestes } from "./gestes.js";
import { creerHistorique } from "./historique.js";
import { installerInfobulles } from "./infobulles.js";
import { cause, explication, expliquer, installerFilet } from "./erreurs.js";
import { $, retirerToast, toast } from "./ui.js";
import { veutSupprimer } from "./dialogue.js";

const ABCJS = () => window.ABCJS;
const dansClaude = () => !!(window.claude && typeof window.claude.use === "function");
// L'état de l'appli : la bibliothèque. L'écran montré et d'où l'on vient sont à la
// navigation (navigation.js) ; chaque écran tient le sien (l'accueil son onglet et
// ses filtres, « Corriger » sa note choisie et son historique…).
const etat = {
  stockage: null,
  partitions: [],
};

const piano = new Piano(new URL("./piano/", import.meta.url).href);
const transport = new Transport(piano);
// Le piano dit ce qui ne va pas (le réseau, un son bloqué) et quand il se télécharge, même
// quand le geste qui jouait ne l'écoute pas (piano.js, audit du 04/10, M3).
const EN_CHARGEMENT = "Piano en chargement… La première fois, il se télécharge avec le réseau.";
piano.surProbleme = (texte) => toast(texte, 7000);
piano.surAttente = (oui) => (oui ? toast(EN_CHARGEMENT, 30000) : retirerToast(EN_CHARGEMENT));
let editeur = null; // l'éditeur d'idée (idee.js), créé au démarrage
let vueMorceau = null; // l'écran d'un morceau (vue-morceau.js)
let accueil = null; // l'accueil et ses quatre onglets (accueil.js)
let tablette = null; // le panneau « Ma reMarkable », l'adresse du connecteur, les modèles (tablette.js)
let synchronisation = null; // la bibliothèque synchronisée, vue de l'appli (synchronisation-ui.js)
let atelier = null; // « Corriger » (ecran-atelier.js)
let lecteur = null; // « Écouter et exporter » (ecran-lecteur.js)
let ecrans = null; // le registre des écrans, pour la navigation (creerRegistre, plus bas)

// La page lue ouverte, que « Corriger » et « Écouter » partagent, avec ses
// enregistrements (page-ouverte.js) ; et leur écoute, une seule pour les deux.
const pageOuverte = creerPageOuverte({
  stockage: () => etat.stockage,
  surEtat: (e, err) => { $("enregistre").textContent = e === "attente" ? "…" : e === "ok" ? "Enregistré" : `Non enregistré : ${cause(err)}`; },
});
const ecoutePage = creerEcoute(transport);
const ecouterPage = creerEcoutePage({ ecoute: ecoutePage, abcjs: ABCJS });

// ------------------------------------------------------------------------
// Ouvrir une partition dans son écran
// ------------------------------------------------------------------------

// La navigation entre les écrans et le bouton « précédent » (navigation.js).
const navigation = creerNavigation({
  ecrans: () => ecrans,
  lire: (id) => etat.stockage.lire(id),
  rouvrir: (p, vue) => (p.type === "idee" ? ouvrirIdee(p) : p.type === "morceau" ? ouvrirMorceau(p) : ouvrir(p.id, vue)),
  arreterLeSon: () => { ecoutePage.arreter(); transport.arreter(); },
  studio: ambianceStudio,
});
const montrer = (vue) => navigation.montrer(vue);

// Chaque ouverture a son numéro : deux ouvertures rapprochées, seule la dernière s'affiche.
let ouvertures = 0;

async function ouvrir(id, vue = "atelier") {
  const demande = ++ouvertures;
  navigation.retenir();
  let p, pages = [];
  try {
    p = await etat.stockage.lire(id);
    if (p && !p.type) pages = await etat.stockage.pages(id, p.nbPages || 0).catch(() => []);
  } catch (e) {
    console.error(e);
    toast(`Cette partition ne s'ouvre pas : ${explication(e)}`);
    return;
  }
  if (demande !== ouvertures) return; // une autre ouverture est partie entre-temps
  if (!p) { toast("Cette partition n'existe plus."); return; }
  if (p.type === "idee") { ouvrirIdee(p); return; }
  if (p.type === "morceau") { ouvrirMorceau(p); return; }
  ouvrirPage(p, pages, vue);
}

/** Une page lue, dans « Corriger » ou « Écouter » : chacun repart de zéro pour elle. */
function ouvrirPage(p, pages, vue) {
  pageOuverte.ouvrir(p, pages);
  atelier.ouvrir();
  lecteur.ouvrir(p);
  $("fil-titre").textContent = p.titre;
  montrer(vue);
}

/** Ouvre un morceau ; sans partition, un nouveau, qui ne s'enregistre qu'au premier bloc. */
function ouvrirMorceau(p = null) {
  navigation.retenir();
  if (navigation.vue === "morceau") vueMorceau.fermer();
  montrer("morceau");
  vueMorceau.ouvrir(p);
}

// ------------------------------------------------------------------------
// Le registre des écrans (navigation.js dit ce que chacun déclare)
// ------------------------------------------------------------------------
//
// Ceux qui montrent une partition disent aussi à la synchronisation
// (synchronisation-ui.js) laquelle (`partition`), s'ils sont en train
// d'écrire (`occupe`), comment la reprendre quand elle change ailleurs
// (`recharger` → true s'ils l'ont reprise), et quoi dire si elle a disparu.

function creerRegistre() {
  const sans = () => false;
  // « Corriger » et « Écouter » montrent la même page lue.
  const page = {
    partition: () => (pageOuverte.partition ? pageOuverte.partition.id : null),
    occupe: () => pageOuverte.occupe,
    recharger: rechargerPage,
    supprimee: () => `« ${pageOuverte.partition.titre} » a été supprimée sur un autre appareil.`,
  };
  ecrans = {
    biblio: { afficher: () => accueil.afficher(), fermer: () => {}, reculer: () => accueil.reculer(), aLaRacine: () => accueil.aLaRacine(), partition: () => null },
    atelier: { afficher: () => atelier.afficher(), fermer: () => atelier.fermer(), reculer: () => atelier.reculer(), aLaRacine: sans, toucheBas: (e) => atelier.toucheBas(e), ...page },
    lecteur: { afficher: () => lecteur.afficher(), fermer: () => lecteur.fermer(), reculer: () => lecteur.reculer(), aLaRacine: sans, toucheBas: (e) => lecteur.toucheBas(e), ...page },
    idee: {
      fermer: () => editeur.fermer(), reculer: () => editeur.reculer(), aLaRacine: sans,
      // Espace ou Entrée sur un bouton de l'éditeur : c'est le bouton qu'on touche, pas l'écoute.
      toucheBas: (e) => !(e.target.closest && e.target.closest("button") && (e.key === " " || e.key === "Enter")) && editeur.toucheBas(e),
      toucheHaut: (e) => editeur.toucheHaut(e),
      partition: () => editeur.id, occupe: () => editeur.occupe(), recharger: (p) => editeur.recharger(p),
      supprimee: () => "Cette idée a été supprimée sur un autre appareil.",
    },
    morceau: {
      fermer: () => vueMorceau.fermer(), reculer: sans, aLaRacine: sans,
      partition: () => vueMorceau.id, occupe: () => vueMorceau.occupe(), recharger: (p) => vueMorceau.recharger(p),
      supprimee: () => "Ce morceau a été supprimé sur un autre appareil.",
    },
  };
}


const ideesParId = () => new Map(etat.partitions.filter((x) => x.type === "idee").map((x) => [x.id, x]));

// L'import des PDF et des .mid (import-pdf.js) ; la tablette (tablette.js) range ce
// qu'elle lit par le même chemin.
// La page d'étalonnage et tes gabarits (L16) passent aussi par lui : « Corriger » y range ce que tes réponses apprennent.
const lecture = creerImport({ stockage: () => etat.stockage, ouvrir: (id, vue) => ouvrir(id, vue), partitions: () => etat.partitions });
const { importer, importerExemples, enregistrerLecture } = lecture;

// Les exports (MIDI, MusicXML, ABC, partage) : exports.js.
const { exporterMidi, toutEnMidi, partagerMidi, exporterMusicXml, exporterAbc } = creerExports({
  stockage: () => etat.stockage, partitions: () => etat.partitions, idees: ideesParId, abcjs: ABCJS, dansClaude,
});

// Supprimer, dupliquer, ajouter à un morceau, le menu ••• de l'éditeur : gestes.js.
const gestes = creerGestes({
  stockage: () => etat.stockage, partitions: () => etat.partitions, nouvelId, pageOuverte,
  editeur: () => editeur, vueMorceau: () => vueMorceau, ouvrir: (id) => ouvrir(id), ouvrirMorceau, montrer,
  exports: { exporterMidi, exporterMusicXml },
});

/** Ouvre une idée dans l'éditeur ; sans partition, une nouvelle idée, vide. */
function ouvrirIdee(p = null, options = {}) {
  navigation.retenir();
  if (navigation.vue === "idee") editeur.fermer();
  montrer("idee");
  editeur.ouvrir(p, options);
}

// ------------------------------------------------------------------------
// La page lue ouverte : la reprendre si elle change ailleurs, la supprimer
// ------------------------------------------------------------------------

// Ce que « Corriger » et « Écouter » montrent d'une page : une version d'ailleurs qui n'y change rien ne se recharge pas.
const CHAMPS_PAGE = ["titre", "abc", "doutes", "statut", "tempo", "transposition"];

/** Une page lue a changé ailleurs : on la reprend, avec ses traits. */
async function rechargerPage(neuve) {
  const p = pageOuverte.partition;
  if (!p || (neuve.modifieLe || "") <= (p.modifieLe || "")) return false;
  if (CHAMPS_PAGE.every((c) => egal(neuve[c], p[c]))) return false;
  const pages = await etat.stockage.pages(neuve.id, neuve.nbPages || 0).catch(() => null);
  if (pageOuverte.partition !== p) return false; // une autre partition s'est ouverte entre-temps
  pageOuverte.ouvrir(neuve, pages || pageOuverte.pages);
  $("fil-titre").textContent = neuve.titre;
  montrer(navigation.vue);
  return true;
}

/** Les panneaux de la reMarkable et des modèles sont dans l'onglet Partitions : on y va d'abord. */
function versPartitions() {
  if (accueil.onglet !== "partitions") accueil.choisirOnglet("partitions");
}

// ------------------------------------------------------------------------
// Branchements
// ------------------------------------------------------------------------

function brancher() {
  // « Portée », en haut : le carnet. Un seul dessin (l'accueil en avait un second, à lui).
  $("aller-biblio").addEventListener("click", () => { accueil.choisirOnglet("carnet", { dessiner: false }); montrer("biblio"); });
  // Chaque écran (idée, morceau, pages) a sa propre barre et son bouton retour.
  document.addEventListener("click", (ev) => { if (ev.target.closest("[data-retour]")) navigation.revenir(); });
  $("onglet-atelier").addEventListener("click", () => montrer("atelier"));
  $("onglet-lecteur").addEventListener("click", () => montrer("lecteur"));

  // Import (import-pdf.js) ; la tablette et les modèles se branchent eux-mêmes (tablette.js).
  $("fichier").addEventListener("change", (e) => { importer([...e.target.files]); e.target.value = ""; });
  $("exemples").addEventListener("click", importerExemples);

  // La bibliothèque : tout en MIDI ; la sauvegarde dans un fichier (sauvegarde-ui.js)
  $("tout-midi").addEventListener("click", toutEnMidi);
  brancherSauvegarde({ stockage: () => etat.stockage, partitions: () => etat.partitions });

  // Les raccourcis : chaque écran les siens (le registre, navigation.js).
  document.addEventListener("keydown", navigation.toucheBas);
  document.addEventListener("keyup", navigation.toucheHaut);

  // Appli installable (hors claude.ai) : le navigateur propose, on montre le bouton (mises-a-jour.js).
  brancherInstallation();
}

/** « Corriger » et « Écouter » : la même page lue, la même écoute. */
function creerEcransDePage() {
  const arreterEcoute = () => ecoutePage.arreter();
  atelier = creerEcranAtelier({
    page: pageOuverte, piano, abcjs: ABCJS, calibration, ecouter: ecouterPage, arreterEcoute,
    valider: () => montrer("lecteur"), supprimer: gestes.supprimerOuverte,
    gabarits: lecture.gabarits, apprendre: lecture.apprendre, aRelire: lecture.aRelire, relireEtDire: lecture.relireEtDire,
    // Le second avis de Claude sur un doute (H1) : sur claude.ai seulement.
    claude: dansClaude() ? window.claude : null,
  });
  lecteur = creerEcranLecteur({
    page: pageOuverte, abcjs: ABCJS, ecouter: ecouterPage, arreterEcoute,
    exports: { exporterMidi, exporterMusicXml, exporterAbc }, ouvrirIdee, supprimer: gestes.supprimerOuverte,
  });
}

function creerVueDuMorceau() {
  vueMorceau = creerVueMorceau({
    transport, toast, nouvelId,
    stockage: () => etat.stockage,
    partitions: () => etat.partitions,
    partager: partagerMidi,
    exporterMusicXml,
    ouvrirIdee: (id) => ouvrir(id),
    quitter: () => montrer("biblio"),
    veutSupprimer: (p) => veutSupprimer(p, etat.partitions),
  });
}

/** L'accueil : ses onglets, sa recherche, ses listes. Il ne sait rien de la tablette ni du stockage : tout passe par ces dépendances. */
function creerAccueilDeLAppli() {
  accueil = creerAccueil({
    toast, transport, ouvrir, ouvrirIdee, ouvrirMorceau, calibration, ideesParId, importer,
    stockage: () => etat.stockage, partitions: () => etat.partitions,
    panneaux: { reculer: () => tablette.reculer(), aLaRacine: () => tablette.aLaRacine() },
    partagerMidi, exporterMidi,
    supprimer: async (p) => { if (await veutSupprimer(p, etat.partitions)) await gestes.supprimerDeLaBibliotheque(p); },
  });
}

function creerEditeur() {
  editeur = creerEditeurIdee({
    piano, transport, toast, nouvelId,
    stockage: () => etat.stockage,
    abcjs: ABCJS,
    partager: partagerMidi,
    menu: gestes.actionIdee,
    titreChange: (t) => { $("fil-titre").textContent = t; },
    etiquettes: () => toutesEtiquettes(etat.partitions),
    nouvelleDepuis: (seq) => ouvrirIdee(null, { seq, titre: "Idée tirée d'une phrase" }),
  });
}

async function demarrer() {
  // Une erreur que rien n'a attrapée se dit, en français (erreurs.js, T4).
  installerFilet((texte) => toast(texte, 8000));
  injecterIcones();
  // Un appui long sur une icône dit ce qu'elle fait.
  installerInfobulles();
  // Au retour d'arrière-plan ou d'un appel : le son reprend, l'écran se rallume (eveil.js, M8).
  installerEveil({ piano });
  creerAccueilDeLAppli();
  tablette = creerTablette({
    dansClaude, stockage: () => etat.stockage, partitions: () => etat.partitions,
    ouvrir: (id, vue) => ouvrir(id, vue), enregistrerLecture, importerEtalonnage: lecture.importerEtalonnage, versPartitions,
    surAdresse: () => synchronisation.demarrer(), surOubli: () => synchronisation.arreter(),
  });
  synchronisation = creerSynchronisation({
    dansClaude, stockage: () => etat.stockage,
    appeler: (outil, args) => tablette.appelerOutil(outil, args),
    formulaireAdresse: (apres) => tablette.formulaireAdresse(apres), majReglagesRm: () => tablette.majReglagesRm(),
    montrerSynchro: (x) => accueil.montrerSynchro(x),
    ouverte: () => navigation.partitionOuverte(),
    quitter: () => { if (navigation.vue === "atelier" || navigation.vue === "lecteur") pageOuverte.fermer(); montrer("biblio"); },
  });
  brancher();
  creerEditeur();
  creerVueDuMorceau();
  creerEcransDePage();
  creerRegistre();
  accueil.afficher();
  let bloquee = false;
  try {
    etat.stockage = await ouvrirStockage({
      // Un autre onglet garde la base ouverte sur une version précédente : on
      // le dit, et la bibliothèque s'ouvre dès qu'il la lâche (audit, S13).
      surBloque: (message) => { bloquee = true; $("mode").textContent = message; toast(message, 120000); },
    });
  } catch (e) {
    // Base déjà passée à une version plus récente : pas de bibliothèque vide en douce.
    // Le message du stockage est en français ; celui du navigateur reste dans la console (I13).
    console.error(e);
    const message = expliquer(e, "La bibliothèque ne s'ouvre pas : recharge la page.");
    $("mode").textContent = message;
    toast(message, 120000);
    return;
  }
  if (bloquee) toast("Ta bibliothèque est ouverte.");
  // Ce que la page d'avant n'a pas eu le temps d'écrire en se fermant (enregistreur.js).
  await reprendreSecours(etat.stockage);
  // Une version plus récente de Portée, ouverte dans un autre onglet, a besoin de la base : celle-ci la lâche.
  if (etat.stockage.surFermeture) etat.stockage.surFermeture(() => toast("Portée a été mise à jour dans un autre onglet : recharge cette page pour continuer.", 120000));
  // Le bouton « précédent » du téléphone recule dans l'appli au lieu de la quitter.
  creerHistorique({ racine: navigation.aLaRacine, reculer: navigation.reculer }).synchroniser();
  // Raccourci de l'appli installée (« Nouvelle idée ») : on y va tout droit.
  if (new URLSearchParams(location.search).has("idee")) ouvrirIdee(null);
  const surClaude = etat.stockage.mode === "claude";
  if (surClaude) {
    $("mode").textContent = "Enregistré sur claude.ai";
    $("mode-detail").textContent = "Tes partitions sont enregistrées sur claude.ai : elles te suivent sur tous tes appareils.";
  }
  synchronisation.afficher(null);
  synchronisation.demarrer();
  // Un autre onglet a changé une partition : celle qui est ouverte ici se reprend (S8).
  synchronisation.brancher();
  tablette.majReglagesRm();
  // Hors ligne et ses mises à jour, sur le site (mises-a-jour.js).
  brancherHorsLigne({ dansClaude: dansClaude() });
  etat.stockage.ecouter(
    (liste) => {
      etat.partitions = liste;
      if (navigation.vue === "biblio") accueil.afficher();
      if (navigation.vue === "morceau") vueMorceau.rafraichir();
    },
    (e) => { console.error(e); toast(`La bibliothèque ne répond plus : ${explication(e, "recharge la page.")}`, 9000); },
  );
  // Avec Live (audit du 04/10, M10) : la sortie MIDI et le dossier des .mid, sur ordinateur seulement.
  const live = brancherLive({
    transport, toast, dansClaude: dansClaude(),
    fabriquer: (p, idees) => (p.type === "idee" ? midiDeLIdee(p) : midiDuMorceau(p, idees)),
  });
  if (live.dossier) etat.stockage.ecouter((liste) => live.surListe(liste), () => { /* le premier abonné le dit déjà */ });
}

demarrer();
