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
import { lirePartition } from "./lecteur/partition.js";
import { dessinerPage } from "./manuscrit.js";
import { Piano } from "./piano.js";
import { nouvelId, ouvrirStockage, restaurer, sauvegarde } from "./stockage.js";
import * as ed from "./edition.js";
import { adresseEnregistree } from "./connecteur.js";
import { creerSynchro } from "./synchro.js";
import { creerEditeurIdee } from "./idee.js";
import { Transport } from "./transport.js";
import { notesDePage, surlignage } from "./ecoute-page.js";
import { installerEveil } from "./eveil.js";
import { brancherLive } from "./reglages-live.js";
import { sequenceDepuisAbc, pasParMesure, pasParTemps } from "./sequence.js";
import { voixCompletes, transposerIdee } from "./harmonie.js";
import { creerVueMorceau } from "./vue-morceau.js";
import { midiDuMorceau, sourceDuMorceau, assembler } from "./morceau.js";
import { midiDeLIdee } from "./midi.js";
import { creerExports } from "./exports.js";
import { calibration, creerImport } from "./import-pdf.js";
import { creerTablette } from "./tablette.js";
import { ico, injecterIcones } from "./icones.js";
import { ambianceStudio } from "./preferences.js";
import { creerHistorique } from "./historique.js";
import { installerInfobulles } from "./infobulles.js";
import { creerAccueil } from "./accueil.js";
import { cibleVisible, completerDoutes, initialiserVise, modifEntre, poser, suivre } from "./doutes.js";
import { afficherVueAtelier, dessinerCarteDoute, dessinerConsigne, dessinerPas, dessinerRelu, dessinerReperes, placerOnglets, suivreDock } from "./atelier.js";
import { fermerFeuille, ouvrirFeuille } from "./feuilles.js";
import { $, accorde, dateRelative, heure, pluriel, retirerToast, toast } from "./ui.js";
import { dialogue, veutSupprimer } from "./dialogue.js";

const ABCJS = () => window.ABCJS;
// Pour la gravure seulement : la dernière ligne s'étire sur toute la largeur,
// sinon une pièce d'une mesure s'affiche minuscule. abcjs compte ses
// positions (startChar) dans ce texte-là : on retranche le préfixe.
const PREFIXE_GRAVURE = "%%stretchlast 1\n";
const pourGravure = (abc) => PREFIXE_GRAVURE + abc;
const dansClaude = () => !!(window.claude && typeof window.claude.use === "function");
const etat = {
  stockage: null,
  partitions: [],
  filtre: "tout",     // filtre du carnet : tout, idee, partition, morceau, favori
  etiquette: null,    // filtre par étiquette (carnet)
  onglet: "carnet",   // l'onglet de l'accueil, retenu dans une préférence (accueil.js)
  filtrePages: "tout", // filtre de l'onglet Partitions : tout, a-relire, prete
  courante: null,     // la partition ouverte (document)
  pages: [],          // ses traits, page par page
  page: 0,            // page affichée dans l'atelier
  douteActif: -1,
  vue: "biblio",
  transposition: 0,
  selection: null,    // début, dans l'ABC, de la note choisie dans « Corriger »
  historique: [],     // l'état d'avant chaque geste (ABC et doutes), pour « Annuler »
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
  if (etat.vue === "idee" && vue !== "idee" && editeur) editeur.fermer();
  if (etat.vue === "morceau" && vue !== "morceau" && vueMorceau) vueMorceau.fermer();
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
  arreterLecture();
  if (vue === "biblio") afficherBibliotheque();
  if (vue === "atelier") afficherAtelier();
  if (vue === "lecteur") afficherLecteur();
  window.scrollTo({ top: 0 });
}

async function ouvrir(id, vue = "atelier") {
  retenirEcran();
  const p = await etat.stockage.lire(id);
  if (!p) { toast("Cette partition n'existe plus."); return; }
  if (p.type === "idee") { ouvrirIdee(p); return; }
  if (p.type === "morceau") { ouvrirMorceau(p); return; }
  etat.courante = p;
  etat.page = 0;
  etat.douteActif = -1;
  etat.transposition = p.transposition || 0;
  etat.selection = null;
  etat.historique = [];
  $("fil-titre").textContent = p.titre;
  etat.pages = await etat.stockage.pages(id, p.nbPages || 0).catch(() => []);
  montrer(vue);
}

/** Ouvre un morceau ; sans partition, un nouveau, qui ne s'enregistre qu'au premier bloc. */
function ouvrirMorceau(p = null) {
  retenirEcran();
  etat.courante = p;
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
  const id = etat.vue === "idee" ? editeur && editeur.id : etat.vue === "morceau" ? vueMorceau && vueMorceau.id : etat.courante && etat.courante.id;
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

const visible = (sel) => !!document.querySelector(sel);

/** L'appli est à sa racine : le carnet, rien d'ouvert par-dessus. */
function aLaRacine() {
  return etat.vue === "biblio" && etat.onglet === "carnet"
    && !visible("dialog[open]") && !visible(".radial:not([hidden])")
    && $("recherche-zone").hidden && $("panneau-remarkable").hidden && $("panneau-modeles").hidden;
}

/** Un pas en arrière, du plus proche au plus lointain : ce qui est ouvert par-dessus, puis l'écran. */
function reculer() {
  const feuilles = [...document.querySelectorAll("dialog[open]")];
  if (feuilles.length) { feuilles.at(-1).close(); return; }
  const cercle = document.querySelector(".radial:not([hidden])");
  if (cercle) { cercle.querySelector(".radial-centre").click(); return; }
  if (etat.vue === "biblio") {
    if (!$("recherche-zone").hidden) { $("fermer-recherche").click(); return; }
    if (!$("panneau-remarkable").hidden) { $("fermer-rm").click(); return; }
    if (!$("panneau-modeles").hidden) { $("fermer-modeles").click(); return; }
    if (etat.onglet !== "carnet") accueil.choisirOnglet("carnet");
    return;
  }
  if (etat.vue === "idee") {
    // Pendant le jeu en direct, « précédent » l'arrête (la feuille de l'arrondi s'ouvre) ;
    // avec des notes choisies, il les laisse.
    if ($("idee-enregistrer").getAttribute("aria-pressed") === "true") { $("idee-enregistrer").click(); return; }
    const laisser = document.querySelector('#idee-selection:not([hidden]) [data-action="deselectionner"]');
    if (laisser) { laisser.click(); return; }
  }
  revenirEcran();
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
  etat.courante = p;
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
// Bibliothèque synchronisée (site seulement ; sur claude.ai, sa base suffit)
// ------------------------------------------------------------------------
//
// Chaque appareil garde toute la bibliothèque ; synchro.js échange les
// changements avec la bibliothèque commune, par le connecteur. Déclencheurs :
// démarrage, retour sur l'onglet ou du réseau, quelques secondes après une
// modification, et toutes les 90 s tant que la page est visible.

let synchro = null, minuterieSynchro = null, battement = null, dernierEtat = null;

function synchronisable() {
  return !dansClaude() && etat.stockage && etat.stockage.synchronisable && !!adresseEnregistree();
}

async function demarrerSynchro() {
  if (!synchronisable()) { afficherSynchro(null); return; }
  // Une autre adresse, c'est une autre bibliothèque commune : on la rejoint depuis le début.
  const adresse = adresseEnregistree();
  if ((await etat.stockage.lireMeta("adresse")) !== adresse) {
    await etat.stockage.ecrireMeta("curseur", null);
    await etat.stockage.ecrireMeta("rejoint", false);
    await etat.stockage.ecrireMeta("adresse", adresse);
  }
  synchro ??= creerSynchro({ local: etat.stockage, appeler: (outil, args) => tablette.appelerOutil(outil, args), surEtat: afficherSynchro });
  etat.stockage.surChangement(() => { clearTimeout(minuterieSynchro); minuterieSynchro = setTimeout(synchroniser, 2500); });
  clearInterval(battement);
  battement = setInterval(() => { if (document.visibilityState === "visible") synchroniser(); }, 90000);
  synchroniser();
}

function arreterSynchro() {
  clearInterval(battement);
  clearTimeout(minuterieSynchro);
  if (etat.stockage && etat.stockage.surChangement) etat.stockage.surChangement(() => {});
  synchro = null;
  afficherSynchro(null);
}

async function synchroniser() {
  if (!synchro || !synchronisable()) return;
  try {
    const { recues } = await synchro.synchroniser();
    if (recues) await rafraichirOuverte();
  } catch (e) {
    console.warn("Synchronisation", e);
  }
}

/** La partition ouverte a changé sur un autre appareil : on la recharge, ou on revient à la bibliothèque. */
async function rafraichirOuverte() {
  if (etat.vue === "morceau") {
    if (!vueMorceau.id) return;
    const neuf = await etat.stockage.lire(vueMorceau.id);
    if (!neuf) { toast("Ce morceau a été supprimé sur un autre appareil."); montrer("biblio"); return; }
    vueMorceau.recharger(neuf);
    return;
  }
  if (etat.vue === "idee") {
    if (!editeur.id) return;
    const neuve = await etat.stockage.lire(editeur.id);
    if (!neuve) { toast("Cette idée a été supprimée sur un autre appareil."); montrer("biblio"); return; }
    if (editeur.recharger(neuve)) toast(`« ${neuve.titre} » a été modifiée sur un autre appareil : mise à jour.`);
    return;
  }
  const p = etat.courante;
  if (!p || etat.vue === "biblio") return;
  const neuve = await etat.stockage.lire(p.id);
  if (!neuve) {
    toast(`« ${p.titre} » a été supprimée sur un autre appareil.`);
    etat.courante = null;
    montrer("biblio");
    return;
  }
  if ((neuve.modifieLe || "") <= (p.modifieLe || "")) return;
  // Une correction en cours ici garde la main : elle partira à son tour.
  if ($("enregistre").textContent === "…") return;
  toast(`« ${neuve.titre} » a été modifiée sur un autre appareil : mise à jour.`);
  etat.courante = neuve;
  etat.pages = await etat.stockage.pages(neuve.id, neuve.nbPages || 0).catch(() => etat.pages);
  $("fil-titre").textContent = neuve.titre;
  montrer(etat.vue);
}

function afficherSynchro(e) {
  if (e) dernierEtat = e;
  const actif = synchronisable();
  $("synchroniser").hidden = !actif;
  $("activer-synchro").hidden = actif || dansClaude() || !(etat.stockage && etat.stockage.synchronisable);
  tablette.majReglagesRm();
  if (!etat.stockage) return;
  if (dansClaude() || etat.stockage.mode === "claude") {
    // Les textes de claude.ai sont posés au démarrage ; ici, seulement l'icône du haut.
    const surClaude = etat.stockage.mode === "claude";
    if (!surClaude) $("mode").textContent = "Enregistré dans ce navigateur";
    accueil.montrerSynchro(surClaude
      ? { nuage: true, ton: "ok", titre: "Enregistré sur claude.ai" }
      : { nuage: false, ton: "gris", titre: "Enregistré dans ce navigateur" });
    return;
  }
  if (!actif) {
    $("mode").textContent = "Enregistré dans ce navigateur";
    $("mode-detail").textContent = "Tes partitions restent dans ce navigateur. Active la synchronisation pour les retrouver sur tous tes appareils, ou sauvegarde-les dans un fichier.";
    accueil.montrerSynchro({ nuage: false, ton: "gris", titre: "Enregistré dans ce navigateur, pas synchronisé" });
    return;
  }
  const d = dernierEtat || { etat: "encours" };
  const attente = d.attente ? ` · ${pluriel(d.attente, "modification")} en attente` : "";
  if (d.etat === "encours") $("mode").textContent = "Synchronisation…";
  else if (d.etat === "ok") $("mode").textContent = `Synchronisé à ${heure(d.le)}` + attente;
  else $("mode").textContent = (navigator.onLine === false ? "Hors ligne" : "Synchronisation impossible") + attente;
  $("mode-detail").textContent = d.etat === "erreur"
    ? `Tes partitions restent dans ce navigateur et partiront à la prochaine connexion. (${(d.erreur && (d.erreur.message || d.erreur.code)) || "erreur"})`
    : "Ta bibliothèque est synchronisée : tu retrouves les mêmes partitions sur chaque appareil où tu as collé l'adresse du connecteur.";
  // L'icône du haut : verte quand tout est parti, ambre quand quelque chose attend.
  accueil.montrerSynchro({ nuage: d.etat !== "erreur", ton: d.etat === "ok" ? "ok" : d.etat === "erreur" ? "alerte" : "gris", titre: $("mode").textContent });
}

function formulaireSynchro() {
  const bloc = document.createElement("div");
  bloc.className = "aide-connecteur";
  const p = document.createElement("p");
  p.textContent = "Colle l'adresse de ton connecteur « Portée reMarkable » (la même que dans claude.ai). Fais-le sur chaque appareil : ils partageront la même bibliothèque, et le bouton reMarkable marchera aussi.";
  bloc.append(p, tablette.formulaireAdresse(() => { bloc.remove(); toast("Synchronisation activée."); }));
  return bloc;
}

// ------------------------------------------------------------------------
// Modèles à mettre sur la tablette, sauvegarde de la bibliothèque
// ------------------------------------------------------------------------

/** Les panneaux de la reMarkable et des modèles sont dans l'onglet Partitions : on y va d'abord. */
function versPartitions() {
  if (etat.onglet !== "partitions") accueil.choisirOnglet("partitions");
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
// Atelier
// ------------------------------------------------------------------------

let minuterieGravure = null, minuterieSauvegarde = null, minuterieEclat = null, objetAtelier = null;
// Le doute que « Je corrige moi-même » règle en ce moment (son rang), ou null.
let manuel = null;
// Le texte ABC avant la dernière saisie : de quoi suivre les doutes pendant qu'on tape dans le mode avancé.
let abcPrecedent = "";
let historiqueVu = null;
let renduDoutes = 0;
let dockEnOutils = false;
let dockReplie = false;

const doutesDe = () => (etat.courante && etat.courante.doutes) || [];
const premierOuvert = () => doutesDe().findIndex((d) => !d.leve);

/** L'état d'une partition dans sa barre : « Prête », ou le nombre de doutes qui restent. */
function pastilleBarre(p) {
  const s = document.createElement("span");
  const restants = (p.doutes || []).filter((d) => !d.leve).length;
  if (p.statut === "prete") { s.className = "pastille p-ok"; s.textContent = "Prête"; }
  else { s.className = "pastille p-doute"; s.textContent = restants ? pluriel(restants, "doute") : "À relire"; }
  return s;
}

function majStatut() {
  $("statut-atelier").replaceChildren(pastilleBarre(etat.courante));
  $("statut-lecteur").replaceChildren(pastilleBarre(etat.courante));
}

/** « 2 pages · lue il y a 3 min », sous le titre. */
function infosPage() {
  const p = etat.courante;
  const n = etat.pages.length || p.nbPages || 1;
  return `${pluriel(n, "page")} · lue ${dateRelative(p.creeLe)}`;
}

/** Le texte ABC de l'atelier ; il en garde la valeur d'avant pour suivre les doutes. */
function poserAbc(texte) {
  $("abc").value = texte;
  abcPrecedent = texte;
}

async function afficherAtelier() {
  const p = etat.courante;
  placerOnglets("vue-atelier");
  // « Je corrige moi-même » ne survit pas à la fermeture de la partition (ouvrir() repart d'un historique neuf).
  if (historiqueVu !== etat.historique) { historiqueVu = etat.historique; manuel = null; }
  $("titre").value = p.titre;
  poserAbc(p.abc);
  $("infos-atelier").textContent = infosPage();
  $("enregistre").textContent = "";
  $("annuler").disabled = etat.historique.length === 0;
  afficherVueAtelier();
  initialiserVise(p.doutes || [], p.abc, p.abcLu);
  await retrouverCibles(p);
  await dessinerManuscrit();
  graverAtelier();
  majOutils();
  afficherDoutes();
}

/**
 * Une partition lue avant que les doutes sachent où est leur note : tant que rien
 * n'a été corrigé, on relit ses traits (c'est déterministe) pour la leur donner.
 */
async function retrouverCibles(p) {
  const doutes = p.doutes || [];
  if (!doutes.some((d) => !d.type) || p.abc !== p.abcLu || !etat.pages.length) return;
  try {
    const titre = (p.abcLu.match(/^T:(.*)$/m) || [])[1] ?? p.titre;
    const res = lirePartition(etat.pages, await calibration(p.modele), { titre });
    if (res.abc !== p.abcLu) return; // la lecture a changé depuis : on ne devine pas
    p.doutes = completerDoutes(doutes, res.doutes);
    await sauver({ doutes: p.doutes });
  } catch (e) {
    console.warn("Les doutes de cette partition restent sans cible", e);
  }
}

async function dessinerManuscrit() {
  const p = etat.courante;
  const nav = $("pages-nav");
  nav.textContent = "";
  if (etat.pages.length > 1) {
    etat.pages.forEach((_, i) => {
      const b = document.createElement("button");
      b.className = "puce"; b.textContent = `page ${i + 1}`;
      b.setAttribute("aria-pressed", String(i === etat.page));
      b.addEventListener("click", () => { etat.page = i; dessinerManuscrit(); });
      nav.appendChild(b);
    });
  }
  const cal = await calibration(p.modele);
  const svg = $("page");
  dessinerPage(svg, cal, etat.pages[etat.page] || []);
  dessinerReperes($("reperes"), svg, cal, doutesDe(), etat.page + 1, etat.douteActif, ouvrirDoute);
}

const couleur = (nom, secours) => getComputedStyle(document.documentElement).getPropertyValue(nom).trim() || secours;

function graverAtelier() {
  const lib = ABCJS();
  const zone = $("gravure-atelier");
  if (!lib) { zone.textContent = "La gravure n'a pas pu se charger (connexion ?)."; return; }
  const abc = $("abc").value;
  const [objet] = lib.renderAbc(zone, pourGravure(abc), {
    responsive: "resize", add_classes: true, paddingtop: 0, paddingleft: 0, paddingright: 0,
    // Toucher une note la choisit ; la glisser change sa hauteur.
    clickListener: surClicNote, dragging: true, selectTypes: ["note"],
    selectionColor: couleur("--stylo", "#2B48B0"), dragColor: couleur("--stylo", "#2B48B0"),
  });
  objetAtelier = objet;
  surligner();
  // Un ABC que abcjs ne comprend pas (tapé à la main) : on le dit, sans jargon.
  const e = $("etat-abc");
  e.textContent = "";
  const avert = (objet && objet.warnings) || [];
  if (avert.length) {
    const pastille = document.createElement("span");
    pastille.className = "pastille p-doute"; pastille.textContent = "Texte ABC à revoir";
    e.append(pastille, " " + avert[0].replace(/<[^>]+>/g, ""));
  }
}

// ------------------------------------------------------------------------
// Corriger au toucher
// ------------------------------------------------------------------------

const abcCourant = () => $("abc").value;
const jetonChoisi = () => (etat.selection === null ? null : ed.lireJeton(abcCourant(), etat.selection));
let derniereNote = { alteration: "", lettre: "C", octave: 5 };

function surClicNote(abcelem, _numero, _classes, _analyse, glisse) {
  if (!abcelem || abcelem.el_type !== "note") return;
  const debut = abcelem.startChar - PREFIXE_GRAVURE.length;
  const j = ed.lireJeton(abcCourant(), debut);
  if (!j) return;
  // abcjs compte les degrés vers le bas : un glissé vers le haut est négatif.
  if (glisse && glisse.step) { appliquer(ed.deplacer(abcCourant(), j, -glisse.step), { entendre: true }); return; }
  etat.selection = debut;
  majOutils();
  entendre(j);
}

/**
 * Surligne dans la partition lue : la note choisie ; à défaut, ce que vise le
 * doute ouvert (une note, ou toute la mesure), pour qu'on voie de quoi il parle.
 */
function surligner() {
  const gravure = objetAtelier && objetAtelier.engraver;
  if (!gravure) return;
  const j = jetonChoisi();
  const d = doutesDe()[etat.douteActif];
  const cible = j ? { debut: j.debut, fin: j.fin } : d && etat.vue === "atelier" ? cibleVisible(d, abcCourant()) : null;
  try {
    // rangeHighlight commence par effacer la sélection d'avant : une plage vide (-1) suffit à tout effacer.
    if (cible) gravure.rangeHighlight(cible.debut + PREFIXE_GRAVURE.length, cible.fin + PREFIXE_GRAVURE.length);
    else gravure.rangeHighlight(-1, -1);
  } catch { /* gravure en cours */ }
}

/** Un instant, la note qu'une réponse vient de changer (puis on revient à ce qui est surligné d'ordinaire). */
function eclat(debut, fin) {
  const gravure = objetAtelier && objetAtelier.engraver;
  if (!gravure || fin <= debut) return;
  try { gravure.rangeHighlight(debut + PREFIXE_GRAVURE.length, fin + PREFIXE_GRAVURE.length); } catch { return; }
  clearTimeout(minuterieEclat);
  minuterieEclat = setTimeout(surligner, 1400);
}

/** Le panneau du bas : les outils quand une note est choisie, sinon le doute (ou « Tout est relu »). */
function majDock(j = jetonChoisi()) {
  const outils = !!j;
  $("outils-note").hidden = !outils;
  $("tete-note").hidden = !outils;
  $("fermer-note").hidden = !outils;
  $("tete-doutes").hidden = outils;
  $("doutes").hidden = outils;
  $("dock-manuel").hidden = manuel === null;
  // Replié, il ne laisse que sa tête : on voit la page en entier. Choisir une note le redéplie.
  const replie = dockReplie && !outils;
  $("dock-atelier").classList.toggle("replie", replie);
  const bascule = $("replier-dock");
  bascule.hidden = outils;
  bascule.setAttribute("aria-expanded", String(!replie));
  bascule.setAttribute("aria-label", replie ? "Déplier le panneau" : "Replier le panneau");
  bascule.querySelector("use").setAttribute("href", replie ? "#i-chevron-haut" : "#i-chevron-bas");
  // De retour des outils, la loupe se redessine à sa vraie taille (elle ne se mesure pas cachée).
  const etaitEnOutils = dockEnOutils;
  dockEnOutils = outils;
  if (etaitEnOutils && !outils) afficherDoutes();
}

function majOutils() {
  const j = jetonChoisi();
  const barre = $("outils-note");
  majDock(j);
  surligner();
  if (!j) { $("note-choisie").textContent = ""; return; }
  if (j.notes.length) derniereNote = { ...j.notes[0], alteration: "" };
  $("note-choisie").textContent = ed.decrire(j);
  const silence = j.type === "silence";
  const base = ed.estPointee(j.croches) ? j.croches / 1.5 : j.croches;
  barre.querySelectorAll("[data-duree]").forEach((b) => b.setAttribute("aria-pressed", String(Math.abs(Number(b.dataset.duree) - base) < 1e-9)));
  barre.querySelector('[data-geste="point"]').setAttribute("aria-pressed", String(ed.estPointee(j.croches)));
  barre.querySelectorAll("[data-alteration]").forEach((b) => {
    b.disabled = silence;
    b.setAttribute("aria-pressed", String(j.notes.length > 0 && j.notes.every((n) => n.alteration === b.dataset.alteration)));
  });
  barre.querySelectorAll('[data-geste="haut"], [data-geste="bas"]').forEach((b) => { b.disabled = silence; });
  const bs = $("bouton-silence");
  bs.setAttribute("aria-pressed", String(silence));
  bs.setAttribute("aria-label", silence ? "Changer en note" : "Changer en silence");
}

/** Fait entendre la note choisie (ou l'accord), brièvement. */
function entendre(j) {
  if (!j || j.type === "silence") return;
  const hauteurs = ed.hauteursMidi(j, ed.armureA(abcCourant(), j.debut));
  piano.pret().then(() => hauteurs.forEach((h) => piano.note(h, 0.7, 80))).catch(() => {});
}

/**
 * Applique un geste : mémorise l'état d'avant, regrave, enregistre. Les doutes
 * suivent le texte qui bouge ; une réponse à un doute (`doute`) le règle dans
 * le même geste, pour qu'« Annuler » défasse les deux.
 */
function appliquer(res, { entendre: jouer = false, doute = null, reponse = "", selectionner = true } = {}) {
  if (!res) return;
  arreterLecture();
  memoriser(abcCourant());
  poserAbc(res.abc);
  suivre(doutesDe(), res.modif);
  if (doute !== null) marquer(doute, true, reponse);
  etat.selection = !selectionner ? null : res.fin > res.debut ? res.debut : prochaineNote(res.abc, res.debut);
  graverAtelier();
  majOutils();
  planifierSauvegarde();
  if (doute !== null) {
    dessinerManuscrit();
    afficherDoutes().then(() => eclat(res.debut, res.fin));
  }
  if (jouer) entendre(jetonChoisi());
}

/** L'état d'avant chaque geste, pour « Annuler » : l'ABC, et où en étaient les doutes. */
function memoriser(abc = abcCourant()) {
  etat.historique.push({
    abc,
    doutes: doutesDe().map((d) => ({ leve: !!d.leve, reponse: d.reponse, vise: d.vise ? { ...d.vise } : null })),
    actif: etat.douteActif,
  });
  if (etat.historique.length > 200) etat.historique.shift();
  $("annuler").disabled = false;
}

function annuler() {
  const avant = etat.historique.pop();
  if (avant === undefined) return;
  arreterLecture();
  poserAbc(avant.abc);
  doutesDe().forEach((d, k) => {
    const s = avant.doutes[k];
    if (!s) return;
    d.leve = s.leve; d.vise = s.vise;
    if (s.reponse) d.reponse = s.reponse; else delete d.reponse;
  });
  // Défaire un geste pendant « Je corrige moi-même » n'en sort pas, tant que le doute reste ouvert.
  if (manuel !== null && doutesDe()[manuel] && !doutesDe()[manuel].leve) etat.douteActif = manuel;
  else { manuel = null; etat.douteActif = avant.actif; }
  if (etat.selection !== null && !ed.lireJeton(avant.abc, etat.selection)) etat.selection = null;
  $("annuler").disabled = etat.historique.length === 0;
  graverAtelier();
  majOutils();
  dessinerManuscrit();
  afficherDoutes();
  planifierSauvegarde();
}

function planifierSauvegarde() {
  clearTimeout(minuterieSauvegarde);
  $("enregistre").textContent = "…";
  minuterieSauvegarde = setTimeout(() => sauver({ abc: abcCourant(), ...(etat.courante && etat.courante.doutes ? { doutes: etat.courante.doutes } : {}) }), 800);
}

/** Les débuts de toutes les notes et silences, dans l'ordre (d'après abcjs). */
function positionsNotes() {
  const positions = new Set();
  for (const ligne of (objetAtelier && objetAtelier.lines) || []) {
    for (const portee of ligne.staff || []) {
      for (const voix of portee.voices || []) {
        for (const el of voix) if (el.el_type === "note" && !el.rest?.type?.startsWith("invisible")) positions.add(el.startChar - PREFIXE_GRAVURE.length);
      }
    }
  }
  return [...positions].sort((a, b) => a - b);
}

function prochaineNote(abc, depuis) {
  const suivante = positionsNotes().find((p) => p >= depuis && ed.lireJeton(abc, p));
  if (suivante !== undefined) return suivante;
  let pos = depuis;
  while (pos < abc.length && !ed.lireJeton(abc, pos)) pos++;
  return pos < abc.length ? pos : null;
}

function choisirVoisine(sens) {
  const liste = positionsNotes();
  if (!liste.length) return;
  let i = etat.selection === null ? (sens > 0 ? 0 : liste.length - 1) : liste.findIndex((p) => p === etat.selection) + sens;
  i = Math.max(0, Math.min(liste.length - 1, i));
  etat.selection = liste[i];
  surligner();
  majOutils();
  entendre(jetonChoisi());
}

/** Un geste de la barre d'outils ou du clavier. */
function geste(nom, valeur) {
  const j = jetonChoisi();
  if (!j) { toast("Touche d'abord une note de la partition."); return; }
  const abc = abcCourant();
  switch (nom) {
    case "haut": return appliquer(ed.deplacer(abc, j, valeur || 1), { entendre: true });
    case "bas": return appliquer(ed.deplacer(abc, j, -(valeur || 1)), { entendre: true });
    case "duree": return appliquer(ed.changerDuree(abc, j, valeur));
    case "point": return appliquer(ed.basculerPoint(abc, j));
    case "alteration": return appliquer(ed.alterer(abc, j, valeur), { entendre: true });
    case "silence": return appliquer(ed.basculerSilence(abc, j, derniereNote), { entendre: true });
    case "dupliquer": return appliquer(ed.dupliquer(abc, j), { entendre: true });
    case "supprimer": return appliquer(ed.supprimer(abc, j));
    default: return undefined;
  }
}

// ------------------------------------------------------------------------
// Les doutes, un par un
// ------------------------------------------------------------------------

/** Le doute ouvert qui suit `apres` (en reprenant au début), ou -1 s'il n'en reste aucun. */
function prochainDoute(apres) {
  const d = doutesDe();
  for (let k = 1; k <= d.length; k++) {
    const j = (apres + k) % d.length;
    if (!d[j].leve) return j;
  }
  return -1;
}

/** Règle (ou rouvre) un doute en mémoire et passe au suivant ; l'appelant a déjà mémorisé l'état d'avant. */
function marquer(i, leve, reponse = "") {
  const d = doutesDe()[i];
  d.leve = leve;
  if (leve) d.reponse = reponse; else delete d.reponse;
  manuel = null;
  etat.douteActif = leve ? prochainDoute(i) : i;
}

/** Ouvre un doute : sa carte en bas, son repère sur la page (la bonne page, s'il y en a plusieurs). */
function ouvrirDoute(i) {
  const d = doutesDe()[i];
  if (!d) return;
  manuel = null;
  dockReplie = false;
  etat.selection = null;
  etat.douteActif = i;
  etat.page =Math.max(0, Math.min((d.page || 1) - 1, Math.max(0, etat.pages.length - 1)));
  dessinerManuscrit();
  majOutils();
  afficherDoutes();
}

/** Dessine le panneau du bas : une carte de doute, la consigne de « Je corrige moi-même », ou « Tout est relu ». */
async function afficherDoutes() {
  const p = etat.courante;
  const doutes = doutesDe();
  const rendu = ++renduDoutes;
  if (etat.douteActif >= doutes.length) etat.douteActif = -1;
  // Tant qu'il reste un doute, on n'en laisse pas un autre à l'écran qu'un doute choisi.
  if (etat.douteActif < 0 && manuel === null) { const o = premierOuvert(); if (o >= 0) etat.douteActif = o; }
  const actif = etat.douteActif;
  dessinerPas(doutes, actif, ouvrirDoute, manuel !== null);
  majStatut();
  const cal = await calibration(p.modele);
  if (rendu !== renduDoutes || etat.courante !== p) return;
  const zone = $("doutes");
  if (manuel !== null) {
    const q = poser(doutes[manuel], abcCourant());
    dessinerConsigne(zone, q.cible && q.cible.genre === "mesure" ? "Touche la note à corriger dans la mesure surlignée de la partition lue." : "Touche la note à corriger dans la partition lue.");
  } else if (actif >= 0) {
    const d = doutes[actif];
    dessinerCarteDoute(zone, {
      doute: d, question: poser(d, abcCourant()), cal, traits: etat.pages[(d.page || 1) - 1] || [],
      surReponse: (r) => repondre(actif, r),
      surRouvrir: () => leverDoute(actif, false),
      surMoiMeme: () => commencerManuel(actif),
      surVoulu: () => leverDoute(actif, true, "C'est voulu"),
    });
  } else {
    dessinerRelu(zone, { aucun: !doutes.length, surRevoir: () => ouvrirDoute(0), surValider: validerAtelier });
  }
  surligner();
}

/** Une réponse : le vrai geste d'edition.js sur la bonne note, puis le doute est réglé (et « Annuler » défait les deux). */
function repondre(i, r) {
  const res = r.geste ? r.geste(abcCourant()) : null;
  if (r.geste && !res) { toast("Cette réponse ne s'applique plus : corrige la note toi-même."); afficherDoutes(); return; }
  if (res) appliquer(res, { doute: i, reponse: r.texte, selectionner: false });
  else { memoriser(); marquer(i, true, r.texte); etat.selection = null; sauver({ doutes: etat.courante.doutes }); dessinerManuscrit(); afficherDoutes(); majOutils(); }
  dockReplie = false;
  toast(r.fait, 2400);
}

/** « C'est voulu » ou « Rouvrir » : règle ou rouvre un doute sans toucher à l'ABC. */
async function leverDoute(i, leve, reponse = "") {
  memoriser();
  marquer(i, leve, reponse);
  if (leve) etat.selection = null;
  await sauver({ doutes: etat.courante.doutes });
  dessinerManuscrit();
  afficherDoutes();
  majOutils();
}

/** « Je corrige moi-même » : la partition lue se montre, la note visée est choisie (ou la mesure, surlignée) et les outils apparaissent. */
function commencerManuel(i) {
  const d = doutesDe()[i];
  manuel = i;
  etat.douteActif = i;
  if (afficherVueAtelier() === "page") afficherVueAtelier("deux");
  const c = cibleVisible(d, abcCourant());
  etat.selection = c && c.genre === "note" ? c.debut : null;
  dessinerManuscrit();
  majOutils();
  afficherDoutes();
  // Une fois le panneau redimensionné (sa hauteur règle la marge du bas), on amène la partition lue sous la barre.
  setTimeout(() => $("zone-lue").scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  if (etat.selection !== null) entendre(jetonChoisi());
}

/** Fin de « Je corrige moi-même » : le doute est réglé (`regle`), ou on revient à sa question. */
function finirManuel(regle) {
  const i = manuel;
  if (i === null) return;
  if (regle) { leverDoute(i, true, "Corrigé à la main"); return; }
  manuel = null;
  etat.selection = null;
  dessinerManuscrit();
  majOutils();
  afficherDoutes();
}

async function validerAtelier() {
  clearTimeout(minuterieSauvegarde);
  await sauver({ abc: $("abc").value, ...(etat.courante.doutes ? { doutes: etat.courante.doutes } : {}), statut: "prete" });
  montrer("lecteur");
}

async function sauver(patch) {
  if (!etat.courante) return;
  const p = etat.courante;
  const complet = { ...patch, modifieLe: new Date().toISOString() };
  Object.assign(p, complet);
  try {
    await etat.stockage.modifier(p.id, complet);
    $("enregistre").textContent = "Enregistré";
  } catch (e) {
    console.error(e);
    $("enregistre").textContent = "Non enregistré : " + (e.message || e.code || "erreur");
  }
}

/** Supprime la partition ouverte (après la confirmation de l'atelier ou du lecteur). */
async function supprimerOuverte() {
  const p = etat.courante;
  await etat.stockage.supprimer(p.id, p.nbPages || 0);
  etat.courante = null;
  toast(`« ${p.titre} » est supprimée.`);
  montrer("biblio");
}

// ------------------------------------------------------------------------
// Écoute (atelier et lecteur)
// ------------------------------------------------------------------------

let lecture = null;

/** Le bouton d'écoute d'une partition : « Écouter » ou « Arrêter », avec son icône. */
function libelleLecture(bouton, joue) {
  bouton.innerHTML = joue ? `${ico("stop", "s")}Arrêter` : `${ico("lire", "s")}Écouter`;
}

function arreterLecture() {
  if (!lecture) return;
  const l = lecture;
  lecture = null;
  // La page joue sur le transport (M5) : l'arrêter coupe aussi ce qui était programmé.
  transport.arreter();
  l.surlignage.eteindre();
  libelleLecture(l.bouton, false);
}

/**
 * Écoute une page lue (lecteur ou atelier) : ses notes passent par le
 * transport, sur l'horloge du son (ecoute-page.js, audit du 04/10, M5) ;
 * TimingCallbacks ne sert plus qu'à surligner ce qui joue.
 */
async function ecouter({ objet, abc, bouton, qpm, transposition = 0, voixMuettes = new Set(), titre = "" }) {
  if (lecture) { const meme = lecture.bouton === bouton; arreterLecture(); if (meme) return; }
  if (!objet) return;
  const { source } = notesDePage(objet, pourGravure(abc), { tempo: qpm, transposition, voixMuettes });
  const moi = { bouton, surlignage: surlignage(ABCJS(), objet, qpm) };
  lecture = moi;
  bouton.textContent = "Chargement du piano…";
  try {
    await transport.jouer(source, {
      titre: titre || "Partition",
      relancer: () => { if (!lecture) bouton.click(); },
      surPosition: (pas) => moi.surlignage.surligner(pas),
      surFin: () => {
        moi.surlignage.eteindre();
        if (lecture === moi) { lecture = null; libelleLecture(bouton, false); }
      },
    });
    if (lecture === moi) libelleLecture(bouton, true);
  } catch (e) {
    if (lecture === moi) { lecture = null; libelleLecture(bouton, false); }
    toast(e.message || "Le piano n'a pas pu se charger.");
  }
}

/** Tempo en noires par minute, d'après la partition gravée. */
function tempoInitial(objet) {
  try {
    const f = objet.getMeterFraction();
    const noires = (f.num / f.den) * 4;
    const ms = objet.millisecondsPerMeasure();
    if (noires > 0 && ms > 0) return Math.round((60000 * noires) / ms);
  } catch { /* chiffrage libre : valeur par défaut */ }
  return 90;
}

// ------------------------------------------------------------------------
// Lecteur
// ------------------------------------------------------------------------

let objetLecteur = null;

function afficherLecteur() {
  const p = etat.courante;
  placerOnglets("vue-lecteur");
  $("titre-lecteur").textContent = p.titre;
  majStatut();
  const k = (p.abc.match(/^K:(.*)$/m) || [])[1] || "C";
  const m0 = (p.abc.match(/^M:(.*)$/m) || [])[1];
  const m = !m0 || m0 === "none" ? "libre" : m0;
  $("meta-lecteur").textContent = `${k} · ${m === "libre" ? "mesure libre" : m} · lue ${dateRelative(p.creeLe)}`;
  $("mains").hidden = !/^\[V:2\]/m.test(p.abc);
  graverLecteur();
  const q = p.tempo || tempoInitial(objetLecteur);
  $("tempo").value = q;
  $("tempo-val").textContent = `♩ = ${q}`;
}

function graverLecteur() {
  const lib = ABCJS();
  const zone = $("gravure-lecteur");
  $("transp-val").textContent = (etat.transposition > 0 ? "+" : "") + etat.transposition;
  if (!lib) { zone.textContent = "La gravure n'a pas pu se charger (connexion ?)."; return; }
  [objetLecteur] = lib.renderAbc(zone, pourGravure(etat.courante.abc), { responsive: "resize", add_classes: true, visualTranspose: etat.transposition, paddingleft: 0, paddingright: 0 });
}

/** Écoute une idée depuis sa carte, sans l'ouvrir. */
async function ecouterIdee(p, bouton) {
  if (transport.actif && transport.carte === bouton) { transport.arreter(); return; }
  transport.arreter();
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
  libelleLecture(bouton, true);
  transport.carte = bouton;
  try {
    await transport.jouer(source, {
      // Les commandes de l'écran verrouillé (eveil.js, M8) : le titre, et « lecture » qui relance.
      titre: p.titre || (p.type === "morceau" ? "Morceau" : "Idée"), relancer: () => { if (!transport.actif) bouton.click(); },
      surFin: () => { bouton.innerHTML = libelle; transport.carte = null; },
    });
  } catch (e) {
    bouton.innerHTML = libelle;
    toast(e.message || "Le piano n'a pas pu se charger.");
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
  $("aller-biblio").addEventListener("click", () => montrer("biblio"));
  // Chaque écran (idée, morceau, pages) a sa propre barre et son bouton retour.
  document.addEventListener("click", (ev) => { if (ev.target.closest("[data-retour]")) revenirEcran(); });
  $("onglet-atelier").addEventListener("click", () => montrer("atelier"));
  $("onglet-lecteur").addEventListener("click", () => montrer("lecteur"));

  // Import (import-pdf.js) ; la tablette et les modèles se branchent eux-mêmes (tablette.js).
  $("fichier").addEventListener("change", (e) => { importer([...e.target.files]); e.target.value = ""; });
  $("exemples").addEventListener("click", importerExemples);

  // La bibliothèque
  $("tout-midi").addEventListener("click", toutEnMidi);
  $("synchroniser").addEventListener("click", synchroniser);
  $("activer-synchro").addEventListener("click", () => {
    if (!document.querySelector("#zone-synchro .aide-connecteur")) $("zone-synchro").appendChild(formulaireSynchro());
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") synchroniser(); });
  window.addEventListener("online", synchroniser);
  window.addEventListener("offline", () => afficherSynchro(dernierEtat && { ...dernierEtat, etat: "erreur", erreur: { message: "hors ligne" } }));
  $("sauvegarder").addEventListener("click", sauvegarderBibliotheque);
  $("restaurer").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) restaurerBibliotheque(f); });

  // Atelier
  $("titre").addEventListener("change", () => sauver({ titre: $("titre").value.trim() || "Sans titre" }));
  // Saisie à la main (mode avancé) : un seul « Annuler » par salve de frappe, et les doutes suivent le texte qui bouge.
  let avantSaisie = null;
  $("abc").addEventListener("focus", () => { avantSaisie = $("abc").value; });
  $("abc").addEventListener("input", () => {
    arreterLecture();
    if (avantSaisie !== null) { memoriser(avantSaisie); avantSaisie = null; }
    suivre(doutesDe(), modifEntre(abcPrecedent, $("abc").value));
    abcPrecedent = $("abc").value;
    etat.selection = null;
    clearTimeout(minuterieGravure);
    minuterieGravure = setTimeout(() => { graverAtelier(); majOutils(); }, 250);
    planifierSauvegarde();
  });
  $("abc").addEventListener("blur", () => { avantSaisie = null; });
  $("relire").addEventListener("click", () => {
    memoriser(abcCourant());
    poserAbc(etat.courante.abcLu);
    // L'ABC redevient celui de la lecture : chaque doute retrouve la place que la lecture lui avait donnée.
    for (const d of doutesDe()) d.vise = d.cible ? { ...d.cible } : null;
    etat.selection = null;
    graverAtelier();
    majOutils();
    afficherDoutes();
    sauver({ abc: etat.courante.abcLu, ...(etat.courante.doutes ? { doutes: etat.courante.doutes } : {}) });
  });
  $("annuler").addEventListener("click", annuler);
  $("outils-note").addEventListener("click", (e) => {
    const b = e.target.closest("[data-geste], [data-duree], [data-alteration]");
    if (!b || b.disabled) return;
    if (b.dataset.duree) geste("duree", Number(b.dataset.duree));
    else if (b.dataset.alteration) geste("alteration", b.dataset.alteration);
    else geste(b.dataset.geste);
  });
  $("fermer-note").addEventListener("click", () => { etat.selection = null; majOutils(); });
  $("replier-dock").addEventListener("click", () => { dockReplie = !dockReplie; majDock(); });
  $("vues-atelier").addEventListener("click", (e) => {
    const b = e.target.closest("[data-vue]");
    if (b) afficherVueAtelier(b.dataset.vue, true);
  });
  $("manuel-retour").addEventListener("click", () => finirManuel(false));
  $("manuel-fini").addEventListener("click", () => finirManuel(true));
  $("ecouter-atelier").addEventListener("click", () => ecouter({
    objet: objetAtelier, abc: $("abc").value, bouton: $("ecouter-atelier"), qpm: tempoInitial(objetAtelier),
    titre: (etat.courante && etat.courante.titre) || "Partition",
  }));
  // Le panneau du bas est fixé : chaque écran lui laisse sa hauteur.
  suivreDock($("vue-atelier"), $("dock-atelier"));
  suivreDock($("vue-lecteur"), $("transport-lecteur"));
  // Les « ••• » : une feuille du bas par écran. Toucher une de ses actions la referme.
  for (const [bouton, feuille] of [["plus-atelier", "feuille-atelier"], ["plus-lecteur", "feuille-lecteur"]]) {
    $(bouton).addEventListener("click", () => ouvrirFeuille($(feuille)));
    $(feuille).addEventListener("click", (e) => { if (e.target.closest(".liste-actions .btn")) fermerFeuille($(feuille)); });
  }
  $("valider-menu").addEventListener("click", validerAtelier);
  $("voir-abc").addEventListener("click", () => {
    const avance = document.querySelector("#vue-atelier .avance");
    avance.open = true;
    avance.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.addEventListener("keydown", clavier);
  document.addEventListener("keyup", (e) => { if (etat.vue === "idee" && editeur.toucheHaut(e)) e.preventDefault(); });
  // Supprimer : la même question que depuis le carnet (dialogue.js), plutôt qu'un bandeau sous la barre.
  const demanderSuppression = async () => { if (etat.courante && (await veutSupprimer(etat.courante, etat.partitions))) supprimerOuverte(); };
  $("supprimer").addEventListener("click", demanderSuppression);
  $("supprimer-lecteur").addEventListener("click", demanderSuppression);

  // Lecteur
  const voixMuettes = () => new Set([...($("main-droite").checked ? [] : [1]), ...($("main-gauche").checked ? [] : [2])]);
  $("ecouter").addEventListener("click", () => ecouter({
    objet: objetLecteur, abc: etat.courante.abc, bouton: $("ecouter"),
    qpm: Number($("tempo").value), transposition: etat.transposition, voixMuettes: voixMuettes(),
    titre: (etat.courante && etat.courante.titre) || "Partition",
  }));
  let minuterieTempo = null;
  $("tempo").addEventListener("input", () => {
    $("tempo-val").textContent = `♩ = ${$("tempo").value}`;
    arreterLecture();
    clearTimeout(minuterieTempo);
    minuterieTempo = setTimeout(() => sauver({ tempo: Number($("tempo").value) }), 600);
  });
  const transposer = (d) => {
    etat.transposition = Math.max(-12, Math.min(12, etat.transposition + d));
    arreterLecture();
    graverLecteur();
    sauver({ transposition: etat.transposition });
  };
  $("transp-moins").addEventListener("click", () => transposer(-1));
  $("transp-plus").addEventListener("click", () => transposer(1));
  $("main-droite").addEventListener("change", arreterLecture);
  $("main-gauche").addEventListener("change", arreterLecture);
  $("export-abc").addEventListener("click", () => exporterAbc(etat.courante));
  $("export-musicxml").addEventListener("click", () => exporterMusicXml(etat.courante));
  // Une page lue devient une idée : on la prolonge au clavier, en direct, avec des accords.
  $("continuer-idee").addEventListener("click", () => {
    const p = etat.courante;
    if (!ABCJS()) { toast("abcjs n'a pas pu se charger (connexion ?)."); return; }
    try {
      const seq = sequenceDepuisAbc(p.abc, ABCJS(), { tempo: p.tempo });
      // Ce qu'on entend (et ce que le MIDI exporte) : la page transposée.
      transposerIdee(seq, p.transposition || 0);
      ouvrirIdee(null, { seq, titre: `${p.titre} (idée)` });
      toast("Une copie en idée : la page d'origine ne change pas.");
    } catch (e) {
      console.error(e);
      toast("Cette partition n'a pas pu devenir une idée : " + (e.message || "erreur"));
    }
  });
  $("export-midi").addEventListener("click", () => exporterMidi(etat.courante, { tempo: Number($("tempo").value), transposition: etat.transposition }));
  $("imprimer").addEventListener("click", () => window.print());

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

/** Raccourcis : Espace pour écouter ; dans « Corriger », les gestes sur la note choisie. */
function clavier(e) {
  const cible = e.target;
  if (cible.closest && cible.closest("input, textarea, select, [contenteditable]")) return;
  if (etat.vue === "idee") {
    if (cible.closest && cible.closest("button") && (e.key === " " || e.key === "Enter")) return;
    if (editeur.toucheBas(e)) e.preventDefault();
    return;
  }
  if (e.key === " " && etat.vue === "lecteur" && !cible.closest("button")) {
    e.preventDefault();
    $("ecouter").click();
    return;
  }
  if (etat.vue !== "atelier") return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); annuler(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const durees = { 1: 0.5, 2: 1, 3: 2, 4: 4, 5: 8 };
  const actions = {
    ArrowUp: () => geste("haut", e.shiftKey ? 7 : 1),
    ArrowDown: () => geste("bas", e.shiftKey ? 7 : 1),
    ArrowLeft: () => choisirVoisine(-1),
    ArrowRight: () => choisirVoisine(1),
    ".": () => geste("point"),
    "#": () => geste("alteration", "^"),
    b: () => geste("alteration", "_"),
    n: () => geste("alteration", "="),
    z: () => geste("silence"),
    "+": () => geste("dupliquer"),
    Delete: () => geste("supprimer"),
    Backspace: () => geste("supprimer"),
    Escape: () => { etat.selection = null; graverAtelier(); majOutils(); },
  };
  if (durees[e.key]) { e.preventDefault(); geste("duree", durees[e.key]); return; }
  if (actions[e.key] && (etat.selection !== null || e.key.startsWith("Arrow"))) {
    e.preventDefault();
    actions[e.key]();
  }
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
    etat, toast, ouvrir, ouvrirIdee, ouvrirMorceau, calibration, ideesParId, importer,
    ecouter: ecouterIdee,
    enLecture: (bouton) => transport.actif && transport.carte === bouton,
    arreter: () => transport.arreter(),
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
    surAdresse: () => demarrerSynchro(), surOubli: () => arreterSynchro(),
  });
  brancher();
  creerEditeur();
  creerVueDuMorceau();
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
  afficherSynchro(null);
  demarrerSynchro();
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
