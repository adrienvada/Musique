/**
 * PORTÉE — l'appli
 *
 * Trois écrans : la bibliothèque (tes partitions), « Corriger » (ta page à
 * côté de ce que Portée a lu) et « Écouter et exporter » (la partition
 * gravée, jouée au piano, exportée en MIDI). Tout passe par le texte ABC de
 * la partition : le lecteur de traits l'écrit, abcjs le grave et le joue.
 * Adrien ne l'écrit jamais lui-même : il touche une note et choisit un
 * geste (plus haut, noire, dièse…), et edition.js réécrit l'ABC.
 */
import { Piano } from "./piano.js";
import { Transport } from "./transport.js";
import { nouvelId, ouvrirStockage, restaurer, sauvegarde } from "./stockage.js";
import { egal } from "./fiche.js";
import { pasParMesure, pasParTemps } from "./sequence.js";
import { voixCompletes } from "./harmonie.js";
import { midiDuMorceau, sourceDuMorceau, assembler } from "./morceau.js";
import { midiDeLIdee } from "./midi.js";
import { creerEditeurIdee } from "./idee.js";
import { creerVueMorceau } from "./vue-morceau.js";
import { creerAccueil } from "./accueil.js";
import { creerEcranAtelier } from "./ecran-atelier.js";
import { creerEcranLecteur } from "./ecran-lecteur.js";
import { creerPageOuverte } from "./page-ouverte.js";
import { creerEcoute } from "./ecoute.js";
import { creerEcoutePage, libelleLecture } from "./atelier.js";
import { creerExports } from "./exports.js";
import { calibration, creerImport } from "./import-pdf.js";
import { creerTablette } from "./tablette.js";
import { creerSynchronisation } from "./synchronisation-ui.js";
import { installerEveil } from "./eveil.js";
import { brancherLive } from "./reglages-live.js";
import { injecterIcones } from "./icones.js";
import { ambianceStudio } from "./preferences.js";
import { creerHistorique } from "./historique.js";
import { installerInfobulles } from "./infobulles.js";
import { cause, explication, expliquer } from "./erreurs.js";
import { $, accorde, pluriel, retirerToast, toast } from "./ui.js";
import { dialogue, veutSupprimer } from "./dialogue.js";

const ABCJS = () => window.ABCJS;
const dansClaude = () => !!(window.claude && typeof window.claude.use === "function");
// L'état de l'appli : la bibliothèque, l'écran ouvert, et d'où l'on vient. Chaque
// écran tient le sien (l'accueil son onglet et ses filtres, « Corriger » sa note
// choisie et son historique…).
const etat = {
  stockage: null,
  partitions: [],
  vue: "biblio",
  pile: [],           // les écrans d'où l'on vient (hors accueil), pour « précédent »
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

// La page lue ouverte, que « Corriger » et « Écouter » partagent, avec ses
// enregistrements (page-ouverte.js) ; et leur écoute, une seule pour les deux.
const pageOuverte = creerPageOuverte({
  stockage: () => etat.stockage,
  surEtat: (e, err) => { $("enregistre").textContent = e === "attente" ? "…" : e === "ok" ? "Enregistré" : `Non enregistré : ${cause(err)}`; },
});
const ecoutePage = creerEcoute(transport);
const ecouterPage = creerEcoutePage({ ecoute: ecoutePage, abcjs: ABCJS });

// ------------------------------------------------------------------------
// Petits outils d'interface
// ------------------------------------------------------------------------

function pastilleStatut(p) {
  const restants = (p.doutes || []).filter((d) => !d.leve).length;
  const span = document.createElement("span");
  if (p.type === "idee") { span.className = "pastille p-idee"; span.textContent = "Idée"; }
  else if (p.type === "morceau") { span.className = "pastille p-morceau"; span.textContent = "Morceau"; }
  else if (p.statut === "prete") { span.className = "pastille p-ok"; span.textContent = "Prête"; }
  else { span.className = "pastille p-doute"; span.textContent = restants ? `À relire · ${pluriel(restants, "doute")}` : "À relire"; }
  return span;
}

// ------------------------------------------------------------------------
// Navigation
// ------------------------------------------------------------------------

function montrer(vue) {
  if (vue === "biblio") etat.pile = [];
  // L'écran qu'on quitte s'arrête et fait partir ce qui attendait d'être enregistré.
  if (etat.vue !== vue && ecrans) ecrans[etat.vue].fermer();
  ecoutePage.arreter();
  transport.arreter();
  etat.vue = vue;
  for (const v of ["biblio", "atelier", "lecteur", "idee", "morceau"]) $(`vue-${v}`).hidden = v !== vue;
  const dansPartition = vue !== "biblio";
  // L'écran Idée prend toute la hauteur : le clavier sous le pouce.
  document.body.classList.toggle("plein", vue === "idee");
  // L'écran ouvert, pour les règles qui en dépendent (où tombent les messages…).
  document.body.dataset.vue = vue;
  // Papier pour lire, Studio pour jouer : l'éditeur passe en sombre (sauf réglage contraire).
  document.body.classList.toggle("studio", vue === "idee" && ambianceStudio());
  // La barre de Portée ne sert qu'à l'accueil : un écran qui a sa propre barre
  // (avec son retour, [data-retour]) la remplace ; les autres la gardent.
  document.querySelector(".barre-haut").hidden = vue !== "biblio" && !!$(`vue-${vue}`).querySelector("[data-retour]");
  // Les onglets, la recherche et la synchro sont ceux de l'accueil : ailleurs, la
  // barre (quand elle reste) ne garde que son retour, et ne couvre pas le clavier.
  for (const id of ["onglets-accueil", "chercher", "etat-synchro"]) $(id).hidden = vue !== "biblio";
  $("fil").hidden = !dansPartition || vue === "idee" || vue === "morceau";
  // Corriger ↔ Écouter : les onglets vivent dans la barre de l'écran de partition (atelier.js).
  $("onglet-atelier").setAttribute("aria-selected", String(vue === "atelier"));
  $("onglet-lecteur").setAttribute("aria-selected", String(vue === "lecteur"));
  if (vue === "biblio") afficherBibliotheque();
  if (vue === "atelier") atelier.afficher();
  if (vue === "lecteur") lecteur.afficher();
  window.scrollTo({ top: 0 });
}

// Chaque ouverture a son numéro : deux ouvertures rapprochées, seule la dernière s'affiche.
let ouvertures = 0;

async function ouvrir(id, vue = "atelier") {
  const demande = ++ouvertures;
  retenirEcran();
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
  retenirEcran();
  if (etat.vue === "morceau") vueMorceau.fermer();
  montrer("morceau");
  vueMorceau.ouvrir(p);
}

// ------------------------------------------------------------------------
// « Précédent » : la flèche de retour des écrans, et le bouton du téléphone
// ------------------------------------------------------------------------
//
// Un écran peut en ouvrir un autre (l'idée d'un bloc de morceau, « Continuer
// en idée » depuis une page lue, une idée tirée d'une phrase…) : on retient
// celui qu'on quitte, et revenir en arrière y ramène, au lieu de sauter à
// l'accueil. L'accueil vide la pile.

let enRetour = false;

/** Retient l'écran qu'on quitte pour un autre (pas l'accueil), pour y revenir. */
function retenirEcran() {
  if (enRetour || etat.vue === "biblio") return;
  const id = etat.vue === "idee" ? editeur && editeur.id : etat.vue === "morceau" ? vueMorceau && vueMorceau.id : pageOuverte.partition && pageOuverte.partition.id;
  if (!id) return; // pas encore enregistré (une idée encore vide) : rien où revenir
  const dernier = etat.pile.at(-1);
  if (dernier && dernier.id === id) { dernier.vue = etat.vue; return; }
  etat.pile.push({ vue: etat.vue, id });
}

/** Un écran en arrière : celui d'où l'on venait, sinon l'accueil. */
async function revenirEcran() {
  enRetour = true;
  try {
    while (etat.pile.length) {
      const { vue, id } = etat.pile.pop();
      const p = await etat.stockage.lire(id).catch(() => null);
      if (!p) continue; // supprimée entre-temps : on remonte encore
      if (p.type === "idee") ouvrirIdee(p);
      else if (p.type === "morceau") ouvrirMorceau(p);
      else await ouvrir(id, vue);
      return;
    }
    montrer("biblio");
  } finally { enRetour = false; }
}

// ------------------------------------------------------------------------
// Le registre des écrans
// ------------------------------------------------------------------------
//
// Chaque écran dit lui-même comment on le quitte (`fermer` : il arrête son
// son, fait partir ce qui attendait d'être enregistré), s'il a encore un pas
// à défaire avant (`reculer` → true : une note choisie, le jeu en direct, un
// panneau ouvert) et s'il est à sa racine (`aLaRacine`, l'accueil seulement).
// Avant, « précédent » cliquait les boutons des autres écrans (audit du 04/10,
// T3). Un calque qui n'est pas un <dialog> se déclare dans le `reculer` et
// l'`aLaRacine` de son écran ; les <dialog> ouverts se ferment avant tout.

let ecrans = null;

function creerRegistre() {
  const sans = () => false;
  ecrans = {
    biblio: { fermer: () => {}, reculer: () => accueil.reculer(), aLaRacine: () => accueil.aLaRacine() },
    atelier: { fermer: () => atelier.fermer(), reculer: () => atelier.reculer(), aLaRacine: sans },
    lecteur: { fermer: () => lecteur.fermer(), reculer: () => lecteur.reculer(), aLaRacine: sans },
    idee: { fermer: () => editeur.fermer(), reculer: () => editeur.reculer(), aLaRacine: sans },
    morceau: { fermer: () => vueMorceau.fermer(), reculer: sans, aLaRacine: sans },
  };
}

/** L'appli est à sa racine : le carnet, rien d'ouvert par-dessus. */
function aLaRacine() {
  return etat.vue === "biblio" && !document.querySelector("dialog[open]") && ecrans.biblio.aLaRacine();
}

/** Un pas en arrière, du plus proche au plus lointain : ce qui est ouvert par-dessus, puis l'écran. */
function reculer() {
  const feuilles = [...document.querySelectorAll("dialog[open]")];
  if (feuilles.length) { feuilles.at(-1).close(); return; }
  if (ecrans[etat.vue].reculer()) return;
  if (etat.vue !== "biblio") revenirEcran();
}

const ideesParId = () => new Map(etat.partitions.filter((x) => x.type === "idee").map((x) => [x.id, x]));

// L'import des PDF et des .mid (import-pdf.js) ; la tablette (tablette.js) range ce
// qu'elle lit par le même chemin.
const { importer, importerExemples, enregistrerLecture } = creerImport({ stockage: () => etat.stockage, ouvrir: (id, vue) => ouvrir(id, vue) });

// Les exports (MIDI, MusicXML, ABC, partage) : exports.js.
const { exporterMidi, toutEnMidi, partagerMidi, exporterMusicXml, exporterAbc } = creerExports({
  stockage: () => etat.stockage, partitions: () => etat.partitions, idees: ideesParId, abcjs: ABCJS, dansClaude,
});

/** Ouvre une idée dans l'éditeur ; sans partition, une nouvelle idée, vide. */
function ouvrirIdee(p = null, options = {}) {
  retenirEcran();
  if (etat.vue === "idee") editeur.fermer();
  montrer("idee");
  editeur.ouvrir(p, options);
}

// ------------------------------------------------------------------------
// Bibliothèque
// ------------------------------------------------------------------------

/** Toutes les étiquettes de la bibliothèque, les plus employées d'abord. */
function toutesEtiquettes() {
  const compte = new Map();
  // Une fiche abîmée (des étiquettes qui ne sont pas une liste) vidait tout le
  // carnet (audit, S6) : le stockage les remet en forme, et ceci ne casse plus.
  for (const p of etat.partitions) {
    for (const t of Array.isArray(p.etiquettes) ? p.etiquettes : []) if (typeof t === "string" && t) compte.set(t, (compte.get(t) || 0) + 1);
  }
  return [...compte].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).map(([t]) => t);
}

/** Redessine l'onglet visible de l'accueil (carnet, partitions, morceaux). Le dessin est dans accueil.js. */
function afficherBibliotheque() {
  accueil.afficher();
}

// ------------------------------------------------------------------------
// La partition ouverte, pour la synchronisation
// ------------------------------------------------------------------------
//
// Ce que chaque écran dit de ce qu'il montre (synchronisation-ui.js) : de quoi
// le reprendre quand la partition change ailleurs, et ne pas le faire pendant
// qu'il écrit.

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
  montrer(etat.vue);
  return true;
}

const montrees = {
  idee: {
    partition: () => editeur.id, occupe: () => editeur.occupe(), recharger: (p) => editeur.recharger(p),
    supprimee: () => "Cette idée a été supprimée sur un autre appareil.",
  },
  morceau: {
    partition: () => vueMorceau.id, occupe: () => vueMorceau.occupe(), recharger: (p) => vueMorceau.recharger(p),
    supprimee: () => "Ce morceau a été supprimé sur un autre appareil.",
  },
  page: {
    partition: () => (pageOuverte.partition ? pageOuverte.partition.id : null),
    // Une correction en cours ici garde la main : elle partira à son tour.
    occupe: () => pageOuverte.occupe,
    recharger: rechargerPage,
    supprimee: () => `« ${pageOuverte.partition.titre} » a été supprimée sur un autre appareil.`,
  },
};
/** L'écran ouvert, s'il montre une partition. */
const partitionOuverte = () => (etat.vue === "idee" ? montrees.idee : etat.vue === "morceau" ? montrees.morceau
  : etat.vue === "atelier" || etat.vue === "lecteur" ? montrees.page : null);

// ------------------------------------------------------------------------
// Modèles à mettre sur la tablette, sauvegarde de la bibliothèque
// ------------------------------------------------------------------------

/** Les panneaux de la reMarkable et des modèles sont dans l'onglet Partitions : on y va d'abord. */
function versPartitions() {
  if (accueil.onglet !== "partitions") accueil.choisirOnglet("partitions");
}

async function sauvegarderBibliotheque() {
  try {
    const contenu = await sauvegarde(etat.stockage, etat.partitions);
    const jour = new Date().toISOString().slice(0, 10);
    await etat.stockage.enregistrerFichier(`Portée - sauvegarde ${jour}.json`, new Blob([JSON.stringify(contenu)], { type: "application/json" }));
    const n = contenu.partitions.length;
    toast(`${pluriel(n, "partition")} ${accorde(n, "sauvegardée")}.`);
  } catch (e) {
    if (e && e.code === "declined") return;
    toast("La sauvegarde n'a pas abouti : " + (e.message || e.code || "erreur"));
  }
}

async function restaurerBibliotheque(fichier) {
  try {
    const contenu = JSON.parse(await fichier.text());
    const bilan = await restaurer(etat.stockage, contenu, new Set(etat.partitions.map((p) => p.id)));
    toast(bilanRestauration(bilan), bilan.echecs.length ? 10000 : 5000);
  } catch (e) {
    toast(e instanceof SyntaxError ? "Ce fichier n'est pas une sauvegarde de Portée." : (e.message || "La restauration n'a pas abouti."), 7000);
  }
}

/**
 * Ce que la restauration a fait, en une phrase : combien sont revenues
 * (même supprimées ailleurs depuis), combien étaient déjà là (gardées telles
 * quelles), et lesquelles n'ont pas pu revenir, avec la raison.
 */
function bilanRestauration({ revenues = 0, ignorees = 0, differentes = 0, echecs = [] }) {
  if (!revenues && !echecs.length) return ignorees ? "Rien à restaurer : tout est déjà dans ta bibliothèque." : "Cette sauvegarde est vide.";
  const morceaux = [];
  if (revenues) morceaux.push(pluriel(revenues, "partition revenue", "partitions revenues"));
  if (ignorees) {
    const changees = differentes ? ` (dont ${pluriel(differentes, "modifiée depuis, gardée telle quelle", "modifiées depuis, gardées telles quelles")})` : "";
    morceaux.push(`${ignorees} déjà là${changees}`);
  }
  if (echecs.length) {
    const lesquelles = echecs.slice(0, 3).map((x) => `« ${x.titre} » (${x.raison})`).join(", ") + (echecs.length > 3 ? "…" : "");
    morceaux.push(`${pluriel(echecs.length, "n'a pas pu revenir", "n'ont pas pu revenir")} : ${lesquelles}`);
  }
  return morceaux.join(" · ") + ".";
}

function nomModele(m) {
  return { "melodie-large": "Mélodie, large", "melodie-standard": "Mélodie", "piano-large": "Piano, large", "piano-standard": "Piano" }[m] || m || "";
}

// ------------------------------------------------------------------------
// La page lue ouverte : la supprimer (« Corriger » et « Écouter »)
// ------------------------------------------------------------------------

/** Supprime la page ouverte, après la même question que depuis le carnet (dialogue.js). */
async function supprimerOuverte() {
  const p = pageOuverte.partition;
  if (!p || !(await veutSupprimer(p, etat.partitions))) return;
  try {
    await pageOuverte.vider();
    await etat.stockage.supprimer(p.id, p.nbPages || 0);
  } catch (e) {
    console.error(e);
    toast(`« ${p.titre} » n'a pas pu être supprimée : ${explication(e)}`, 7000);
    return;
  }
  if (pageOuverte.partition === p) pageOuverte.fermer();
  toast(`« ${p.titre} » est supprimée.`);
  montrer("biblio");
}

// Les cartes de la bibliothèque ont leur écoute (ecoute.js) : la clé est le bouton touché.
const ecouteCartes = creerEcoute(transport);

/** Écoute une idée (ou un morceau) depuis sa carte, sans l'ouvrir. Le même bouton arrête. */
async function ecouterIdee(p, bouton) {
  if (ecouteCartes.cle === bouton) { ecouteCartes.arreter(); return; }
  let source;
  if (p.type === "morceau") source = sourceDuMorceau(assembler(p, ideesParId()));
  else {
    const seq = p.sequence;
    const parPas = new Map();
    let fin = 0;
    for (const v of voixCompletes(seq)) for (const n of v.notes) { if (!parPas.has(n.d)) parPas.set(n.d, []); parPas.get(n.d).push(n); fin = Math.max(fin, n.d + n.l); }
    source = () => ({ tempo: seq.tempo, mesure: pasParMesure(seq), temps: pasParTemps(seq), fin, notesA: (x) => parPas.get(x) || [] });
  }
  const libelle = bouton.innerHTML;
  const lecture = ecouteCartes.jouer(bouton, source, {
    // Les commandes de l'écran verrouillé (eveil.js, M8) : le titre, et « lecture » qui relance.
    titre: p.titre || (p.type === "morceau" ? "Morceau" : "Idée"), relancer: () => { if (ecouteCartes.cle === null) bouton.click(); },
    surArret: () => { bouton.innerHTML = libelle; },
  });
  libelleLecture(bouton, true);
  try {
    await lecture;
  } catch (e) {
    console.error(e);
    toast(expliquer(e, "Le piano n'a pas pu se charger."));
  }
}

/** « 4 mesures · ♩ 90 · Do majeur » */
function resumeIdee(seq) {
  if (!seq) return "";
  const notes = seq.pistes.reduce((n, p) => n + p.notes.length, 0);
  return `${pluriel(notes, "note")} · ♩ ${seq.tempo}`;
}

// ------------------------------------------------------------------------
// Branchements
// ------------------------------------------------------------------------

function brancher() {
  // « Portée », en haut : le carnet. Un seul dessin (l'accueil en avait un second, à lui).
  $("aller-biblio").addEventListener("click", () => { accueil.choisirOnglet("carnet", { dessiner: false }); montrer("biblio"); });
  // Chaque écran (idée, morceau, pages) a sa propre barre et son bouton retour.
  document.addEventListener("click", (ev) => { if (ev.target.closest("[data-retour]")) revenirEcran(); });
  $("onglet-atelier").addEventListener("click", () => montrer("atelier"));
  $("onglet-lecteur").addEventListener("click", () => montrer("lecteur"));

  // Import (import-pdf.js) ; la tablette et les modèles se branchent eux-mêmes (tablette.js).
  $("fichier").addEventListener("change", (e) => { importer([...e.target.files]); e.target.value = ""; });
  $("exemples").addEventListener("click", importerExemples);

  // La bibliothèque
  $("tout-midi").addEventListener("click", toutEnMidi);
  $("sauvegarder").addEventListener("click", sauvegarderBibliotheque);
  $("restaurer").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) restaurerBibliotheque(f); });

  document.addEventListener("keydown", clavier);
  document.addEventListener("keyup", (e) => { if (etat.vue === "idee" && editeur.toucheHaut(e)) e.preventDefault(); });

  // Appli installable (hors claude.ai) : le navigateur propose, on montre le bouton.
  let invitation = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); invitation = e; $("installer").hidden = false; });
  $("installer").addEventListener("click", async () => {
    if (!invitation) return;
    invitation.prompt();
    await invitation.userChoice.catch(() => null);
    invitation = null;
    $("installer").hidden = true;
  });
}

/** Raccourcis : chaque écran a les siens (Espace pour écouter ; dans « Corriger », les gestes sur la note choisie). */
function clavier(e) {
  const cible = e.target;
  if (cible.closest && cible.closest("input, textarea, select, [contenteditable]")) return;
  if (etat.vue === "idee") {
    if (cible.closest && cible.closest("button") && (e.key === " " || e.key === "Enter")) return;
    if (editeur.toucheBas(e)) e.preventDefault();
    return;
  }
  const ecran = etat.vue === "atelier" ? atelier : etat.vue === "lecteur" ? lecteur : null;
  if (ecran && ecran.toucheBas(e)) e.preventDefault();
}

/** Ce que le menu « ••• » de l'éditeur d'idée demande. */
async function actionIdee(action, p) {
  switch (action) {
    case "telecharger-midi": return exporterMidi(p);
    case "dupliquer": {
      const id = nouvelId();
      const maintenant = new Date().toISOString();
      const { id: _ancien, ...donnees } = p;
      await etat.stockage.creer(id, { ...donnees, titre: `${p.titre} (copie)`, creeLe: maintenant, modifieLe: maintenant }, []);
      toast("Copie faite : tu y es.");
      return ouvrir(id);
    }
    case "supprimer": {
      if (!(await veutSupprimer(p, etat.partitions))) return undefined;
      await editeur.fermer();
      await supprimerDeLaBibliotheque(p);
      return montrer("biblio");
    }
    case "morceau": return choisirMorceau(p);
    case "musicxml": return exporterMusicXml(p);
    default:
      toast("Bientôt.");
      return undefined;
  }
}

/** Supprime `p` de la bibliothèque (et des autres appareils, par la synchro). */
async function supprimerDeLaBibliotheque(p) {
  await etat.stockage.supprimer(p.id, p.type ? 0 : p.nbPages || 0);
  toast(`« ${p.titre} » est supprimé${p.type === "morceau" ? "" : "e"}.`);
}

/** « Ajouter à un morceau » : un morceau existant, ou un nouveau. */
async function choisirMorceau(p) {
  const morceaux = etat.partitions.filter((x) => x.type === "morceau");
  const choix = await dialogue("Ajouter à un morceau", `« ${p.titre} » devient un bloc du morceau choisi.`, [
    { valeur: "nouveau", texte: "+ Un nouveau morceau", plein: true },
    ...morceaux.map((x) => ({ valeur: x.id, texte: `${x.titre} (${pluriel((x.blocs || []).length, "bloc")})` })),
  ]);
  if (!choix) return;
  await editeur.fermer();
  if (choix === "nouveau") ouvrirMorceau(null);
  else ouvrirMorceau(await etat.stockage.lire(choix));
  vueMorceau.ajouter(p.id);
  $("morceau-choix").hidden = true;
}

/** « Corriger » et « Écouter » : la même page lue, la même écoute. */
function creerEcransDePage() {
  const arreterEcoute = () => ecoutePage.arreter();
  atelier = creerEcranAtelier({
    page: pageOuverte, piano, abcjs: ABCJS, calibration, ecouter: ecouterPage, arreterEcoute,
    valider: () => montrer("lecteur"), supprimer: supprimerOuverte,
  });
  lecteur = creerEcranLecteur({
    page: pageOuverte, abcjs: ABCJS, ecouter: ecouterPage, arreterEcoute,
    exports: { exporterMidi, exporterMusicXml, exporterAbc }, ouvrirIdee, supprimer: supprimerOuverte,
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
    toast, ouvrir, ouvrirIdee, ouvrirMorceau, calibration, ideesParId, importer,
    stockage: () => etat.stockage, partitions: () => etat.partitions,
    panneaux: { reculer: () => tablette.reculer(), aLaRacine: () => tablette.aLaRacine() },
    ecouter: ecouterIdee,
    enLecture: (bouton) => ecouteCartes.cle === bouton,
    arreter: () => ecouteCartes.arreter(),
    partagerMidi, exporterMidi,
    supprimer: async (p) => { if (await veutSupprimer(p, etat.partitions)) await supprimerDeLaBibliotheque(p); },
    etiquettes: toutesEtiquettes,
    resumeIdee, nomModele, pastilleStatut,
  });
}

function creerEditeur() {
  editeur = creerEditeurIdee({
    piano, transport, toast, nouvelId,
    stockage: () => etat.stockage,
    abcjs: ABCJS,
    partager: partagerMidi,
    menu: actionIdee,
    titreChange: (t) => { $("fil-titre").textContent = t; },
    etiquettes: toutesEtiquettes,
    nouvelleDepuis: (seq) => ouvrirIdee(null, { seq, titre: "Idée tirée d'une phrase" }),
  });
}

/**
 * Le service worker (sw.js) garde l'appli pour le hors-ligne. Une version
 * mise en ligne s'installe en arrière-plan, puis prend la main ; si la page
 * ouverte n'est pas de cette version, un message passager propose de
 * recharger. Rien ne se recharge tout seul : on peut être au milieu d'une
 * prise ou d'une correction.
 *
 * Une appli installée reste ouverte des jours : en y revenant (au plus une
 * fois toutes les dix minutes), on demande s'il y a une nouvelle version,
 * sans attendre que le navigateur y pense.
 *
 * L'inscription attend que la page soit chargée : la copie de l'appli ne
 * lui dispute pas le réseau. Ce qui est lourd et ne sert pas au démarrage
 * (pdf.js, le piano) se copie ensuite, en tâche de fond.
 */
function brancherServiceWorker() {
  // La version de la page : celle de l'adresse de ce module (app.js?v=…).
  const maVersion = new URL(import.meta.url).searchParams.get("v");
  const copierEnFond = (sw) => sw && sw.postMessage({ type: "portee-precharger" });
  navigator.serviceWorker.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.type !== "portee-version") return;
    copierEnFond(e.source); // une version qui vient de prendre la main
    if (maVersion && m.version !== maVersion) proposerRechargement();
  });
  let verifiee = Date.now();
  const inscrire = () => navigator.serviceWorker.register("sw.js").then((inscription) => {
    navigator.serviceWorker.ready.then((r) => copierEnFond(r.active));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || Date.now() - verifiee < 10 * 60 * 1000) return;
      verifiee = Date.now();
      inscription.update().catch(() => {}); // hors ligne : la prochaine fois
    });
  }).catch(() => {});
  if (document.readyState === "complete") inscrire();
  else addEventListener("load", inscrire, { once: true });
}

/** « Une nouvelle version est prête » : un message passager, avec de quoi recharger. */
function proposerRechargement() {
  if ($("toast-version")) return;
  const m = document.createElement("div");
  m.className = "toast toast-action";
  m.id = "toast-version";
  m.setAttribute("role", "status");
  m.setAttribute("popover", "manual");
  const texte = document.createElement("span");
  texte.textContent = "Une nouvelle version de Portée est prête.";
  const recharger = document.createElement("button");
  recharger.className = "btn btn-petit";
  recharger.textContent = "Recharger";
  recharger.addEventListener("click", () => location.reload());
  m.append(texte, recharger);
  document.body.appendChild(m);
  // En « popover », comme les autres messages : au-dessus d'une feuille ouverte.
  if (m.showPopover) { try { m.showPopover(); } catch { /* sans popover : il s'affiche quand même */ } }
  setTimeout(() => m.remove(), 20000);
}

async function demarrer() {
  injecterIcones();
  // Un appui long sur une icône dit ce qu'elle fait.
  installerInfobulles();
  // Au retour d'arrière-plan ou d'un appel : le son reprend, l'écran se rallume (eveil.js, M8).
  installerEveil({ piano });
  creerAccueilDeLAppli();
  tablette = creerTablette({
    dansClaude, stockage: () => etat.stockage, partitions: () => etat.partitions,
    ouvrir: (id, vue) => ouvrir(id, vue), enregistrerLecture, versPartitions,
    surAdresse: () => synchronisation.demarrer(), surOubli: () => synchronisation.arreter(),
  });
  synchronisation = creerSynchronisation({
    dansClaude, stockage: () => etat.stockage,
    appeler: (outil, args) => tablette.appelerOutil(outil, args),
    formulaireAdresse: (apres) => tablette.formulaireAdresse(apres), majReglagesRm: () => tablette.majReglagesRm(),
    montrerSynchro: (x) => accueil.montrerSynchro(x),
    ouverte: partitionOuverte,
    quitter: () => { if (etat.vue === "atelier" || etat.vue === "lecteur") pageOuverte.fermer(); montrer("biblio"); },
  });
  brancher();
  creerEditeur();
  creerVueDuMorceau();
  creerEcransDePage();
  creerRegistre();
  afficherBibliotheque();
  let bloquee = false;
  try {
    etat.stockage = await ouvrirStockage({
      // Un autre onglet garde la base ouverte sur une version précédente : on
      // le dit, et la bibliothèque s'ouvre dès qu'il la lâche (audit, S13).
      surBloque: (message) => { bloquee = true; $("mode").textContent = message; toast(message, 120000); },
    });
  } catch (e) {
    // Base déjà passée à une version plus récente : pas de bibliothèque vide en douce.
    const message = (e && e.message) || "La bibliothèque ne s'ouvre pas : recharge la page.";
    $("mode").textContent = message;
    toast(message, 120000);
    return;
  }
  if (bloquee) toast("Ta bibliothèque est ouverte.");
  // Une version plus récente de Portée, ouverte dans un autre onglet, a besoin de la base : celle-ci la lâche.
  if (etat.stockage.surFermeture) etat.stockage.surFermeture(() => toast("Portée a été mise à jour dans un autre onglet : recharge cette page pour continuer.", 120000));
  // Le bouton « précédent » du téléphone recule dans l'appli au lieu de la quitter.
  creerHistorique({ racine: aLaRacine, reculer }).synchroniser();
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
  // Hors ligne et installable, hors de claude.ai (sw.js n'existe que sur le site).
  // Un contexte sûr : https, ou l'ordinateur lui-même (les essais de bout en bout).
  if (!dansClaude() && "serviceWorker" in navigator && window.isSecureContext) brancherServiceWorker();
  etat.stockage.ecouter(
    (liste) => {
      etat.partitions = liste;
      if (etat.vue === "biblio") afficherBibliotheque();
      if (etat.vue === "morceau") vueMorceau.rafraichir();
    },
    (e) => toast("La bibliothèque ne répond plus : recharge la page. (" + (e.code || e.message) + ")", 9000),
  );
  // Avec Live (audit du 04/10, M10) : la sortie MIDI et le dossier des .mid, sur ordinateur seulement.
  const live = brancherLive({
    transport, toast, dansClaude: dansClaude(),
    fabriquer: (p, idees) => (p.type === "idee" ? midiDeLIdee(p) : midiDuMorceau(p, idees)),
  });
  if (live.dossier) etat.stockage.ecouter((liste) => live.surListe(liste), () => { /* le premier abonné le dit déjà */ });
}

demarrer();
