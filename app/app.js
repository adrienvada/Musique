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
import { lireDocument } from "./lecteur/extraction.js";
import { lirePartition } from "./lecteur/partition.js";
import { dessinerPage } from "./manuscrit.js";
import { Piano } from "./piano.js";
import { decompacter, nouvelId, ouvrirStockage, restaurer, sauvegarde } from "./stockage.js";
import { zipper } from "./zip.js";
import * as ed from "./edition.js";
import { adresseEnregistree, connecteurDirect, enregistrerAdresse, FORME_ADRESSE } from "./connecteur.js";
import { creerSynchro } from "./synchro.js";
import { creerEditeurIdee, midiDeLIdee } from "./idee.js";
import { Transport } from "./transport.js";
import { notesDePage, surlignage } from "./ecoute-page.js";
import { installerEveil } from "./eveil.js";
import { sequenceDepuisAbc, pasParMesure, pasParTemps, ecrireAbc } from "./sequence.js";
import { voixCompletes, transposerIdee } from "./harmonie.js";
import { creerVueMorceau } from "./vue-morceau.js";
import { midiDuMorceau, musicXmlDuMorceau, sourceDuMorceau, assembler } from "./morceau.js";
import { ecrireMusicXml, musicXmlDeLaPage } from "./musicxml.js";
import { midiDeLaPage, ideeDepuisMidi } from "./midi.js";
import { ico, injecterIcones } from "./icones.js";
import { ambianceStudio } from "./preferences.js";
import { creerHistorique } from "./historique.js";
import { installerInfobulles } from "./infobulles.js";
import { creerAccueil } from "./accueil.js";
import { cibleVisible, completerDoutes, initialiserVise, modifEntre, poser, suivre } from "./doutes.js";
import { afficherVueAtelier, dateRelative, dessinerCarteDoute, dessinerConsigne, dessinerPas, dessinerRelu, dessinerReperes, placerOnglets, suivreDock } from "./atelier.js";
import { fermerFeuille, ouvrirFeuille } from "./feuilles.js";

const VERSION_LECTEUR = 1;
// Nom du connecteur tel qu'Adrien l'a ajouté dans claude.ai (Paramètres → Connecteurs).
const CONNECTEUR = "Portée reMarkable";
const $ = (id) => document.getElementById(id);
const ABCJS = () => window.ABCJS;
// Pour la gravure seulement : la dernière ligne s'étire sur toute la largeur,
// sinon une pièce d'une mesure s'affiche minuscule. abcjs compte ses
// positions (startChar) dans ce texte-là : on retranche le préfixe.
const PREFIXE_GRAVURE = "%%stretchlast 1\n";
const pourGravure = (abc) => PREFIXE_GRAVURE + abc;
const dansClaude = () => !!(window.claude && typeof window.claude.use === "function");
const MODELES = [
  { id: "melodie-standard", nom: "Mélodie", detail: "7 portées, pour une ligne mélodique." },
  { id: "melodie-large", nom: "Mélodie, large", detail: "5 portées aux interlignes plus grands." },
  { id: "piano-standard", nom: "Piano", detail: "4 systèmes de deux portées, main droite et main gauche." },
  { id: "piano-large", nom: "Piano, large", detail: "3 systèmes, plus de place pour écrire." },
];

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
piano.surAttente = (oui) => {
  if (oui) { toast(EN_CHARGEMENT, 30000); return; }
  const t = $("toast");
  if (t.textContent === EN_CHARGEMENT) { t.hidden = true; try { if (t.hidePopover) t.hidePopover(); } catch { /* déjà fermé */ } }
};
const calibrations = new Map();
let editeur = null; // l'éditeur d'idée (idee.js), créé au démarrage
let vueMorceau = null; // l'écran d'un morceau (vue-morceau.js)
let accueil = null; // l'accueil et ses quatre onglets (accueil.js)

async function calibration(modele) {
  if (!calibrations.has(modele)) {
    const r = await fetch(new URL(`./modeles/${modele}.json`, import.meta.url));
    if (!r.ok) throw new Error(`Modèle inconnu : ${modele}`);
    calibrations.set(modele, await r.json());
  }
  return calibrations.get(modele);
}

// ------------------------------------------------------------------------
// Petits outils d'interface
// ------------------------------------------------------------------------

let minuterieToast = null;
function toast(texte, duree = 4000) {
  const t = $("toast");
  t.textContent = texte;
  t.hidden = false;
  // En « popover », le message passe au-dessus d'une feuille du bas ouverte
  // (un <dialog> est dans la couche du dessus) au lieu d'être grisé dessous.
  // Le rouvrir le remet au premier plan ; sans popover, il s'affiche comme avant.
  if (t.showPopover) { try { if (t.matches(":popover-open")) t.hidePopover(); t.showPopover(); } catch { /* sans popover */ } }
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => { t.hidden = true; if (t.hidePopover) try { t.hidePopover(); } catch { /* déjà fermé */ } }, duree);
}

function dateCourte(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function pastilleStatut(p) {
  const restants = (p.doutes || []).filter((d) => !d.leve).length;
  const span = document.createElement("span");
  if (p.type === "idee") { span.className = "pastille p-idee"; span.textContent = "Idée"; }
  else if (p.type === "morceau") { span.className = "pastille p-morceau"; span.textContent = "Morceau"; }
  else if (p.statut === "prete") { span.className = "pastille p-ok"; span.textContent = "Prête"; }
  else { span.className = "pastille p-doute"; span.textContent = restants ? `À relire · ${restants} doute${restants > 1 ? "s" : ""}` : "À relire"; }
  return span;
}

function titreDepuisFichier(nom) {
  return nom.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+copy$/i, "").trim() || "Sans titre";
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
  for (const p of etat.partitions) for (const t of p.etiquettes || []) compte.set(t, (compte.get(t) || 0) + 1);
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

async function appelerOutil(outil, args) {
  const m = await mcp();
  if (!m) throw { code: "sans_adresse", message: "Pas d'adresse de connecteur." };
  const r = await m.callTool(CONNECTEUR, outil, args, { cache: false });
  return r.payload;
}

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
  synchro ??= creerSynchro({ local: etat.stockage, appeler: appelerOutil, surEtat: afficherSynchro });
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

const heure = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function afficherSynchro(e) {
  if (e) dernierEtat = e;
  const actif = synchronisable();
  $("synchroniser").hidden = !actif;
  $("activer-synchro").hidden = actif || dansClaude() || !(etat.stockage && etat.stockage.synchronisable);
  majReglagesRm();
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
  const attente = d.attente ? ` · ${d.attente} modification${d.attente > 1 ? "s" : ""} en attente` : "";
  if (d.etat === "encours") $("mode").textContent = "Synchronisation…";
  else if (d.etat === "ok") $("mode").textContent = `Synchronisé à ${heure(d.le)}` + attente;
  else $("mode").textContent = (navigator.onLine === false ? "Hors ligne" : "Synchronisation impossible") + attente;
  $("mode-detail").textContent = d.etat === "erreur"
    ? `Tes partitions restent dans ce navigateur et partiront à la prochaine connexion. (${(d.erreur && (d.erreur.message || d.erreur.code)) || "erreur"})`
    : "Ta bibliothèque est synchronisée : tu retrouves les mêmes partitions sur chaque appareil où tu as collé l'adresse du connecteur.";
  // L'icône du haut : verte quand tout est parti, ambre quand quelque chose attend.
  accueil.montrerSynchro({ nuage: d.etat !== "erreur", ton: d.etat === "ok" ? "ok" : d.etat === "erreur" ? "alerte" : "gris", titre: $("mode").textContent });
}

/**
 * Les lignes « Ma reMarkable » des Réglages : où en est le connecteur, où en est la tablette.
 * La tablette n'est connue qu'après un premier appel au connecteur (le panneau de l'onglet Partitions).
 */
function majReglagesRm() {
  const adresse = !!adresseEnregistree();
  $("rm-connecteur").textContent = dansClaude() ? "Portée reMarkable (claude.ai)" : adresse ? "Adresse enregistrée" : "Pas encore d'adresse";
  $("rm-tablette").textContent = tabletteReliee === true ? "Reliée" : tabletteReliee === false ? "À relier"
    : dansClaude() || adresse ? "Pas encore vérifiée" : "Colle l'adresse du connecteur";
  $("changer-adresse").hidden = dansClaude() || !adresse;
}

function formulaireSynchro() {
  const bloc = document.createElement("div");
  bloc.className = "aide-connecteur";
  const p = document.createElement("p");
  p.textContent = "Colle l'adresse de ton connecteur « Portée reMarkable » (la même que dans claude.ai). Fais-le sur chaque appareil : ils partageront la même bibliothèque, et le bouton reMarkable marchera aussi.";
  bloc.append(p, formulaireAdresse(() => { bloc.remove(); toast("Synchronisation activée."); }));
  return bloc;
}

// ------------------------------------------------------------------------
// Modèles à mettre sur la tablette, sauvegarde de la bibliothèque
// ------------------------------------------------------------------------

/** Les panneaux de la reMarkable et des modèles sont dans l'onglet Partitions : on y va d'abord. */
function versPartitions() {
  if (etat.onglet !== "partitions") accueil.choisirOnglet("partitions");
}

function afficherModeles() {
  versPartitions();
  $("panneau-modeles").hidden = false;
  const zone = $("liste-modeles");
  if (zone.childElementCount) return;
  for (const m of MODELES) {
    const bloc = document.createElement("div");
    bloc.className = "modele";
    const img = document.createElement("img");
    img.src = new URL(`./modeles/apercu/${m.id}.svg`, import.meta.url).href;
    img.alt = `Aperçu du modèle ${m.nom}`;
    img.loading = "lazy";
    const nom = document.createElement("span");
    nom.className = "nom"; nom.textContent = m.nom;
    const detail = document.createElement("span");
    detail.className = "remarque"; detail.textContent = m.detail;
    const b = document.createElement("button");
    b.className = "btn btn-petit";
    b.textContent = "Télécharger le PDF";
    b.addEventListener("click", async () => {
      try {
        const r = await fetch(new URL(`./modeles/${m.id}.pdf`, import.meta.url));
        await etat.stockage.enregistrerFichier(`Portée - ${m.nom}.pdf`, new Blob([await r.arrayBuffer()], { type: "application/pdf" }));
      } catch (e) {
        if (e && e.code === "declined") return;
        toast("Le modèle n'a pas pu être téléchargé : " + (e.message || e.code || "erreur"));
      }
    });
    bloc.append(img, nom, detail, b);
    zone.appendChild(bloc);
  }
  $("panneau-modeles").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function sauvegarderBibliotheque() {
  try {
    const contenu = await sauvegarde(etat.stockage, etat.partitions);
    const jour = new Date().toISOString().slice(0, 10);
    await etat.stockage.enregistrerFichier(`Portée - sauvegarde ${jour}.json`, new Blob([JSON.stringify(contenu)], { type: "application/json" }));
    toast(`${contenu.partitions.length} partition${contenu.partitions.length > 1 ? "s" : ""} sauvegardée${contenu.partitions.length > 1 ? "s" : ""}.`);
  } catch (e) {
    if (e && e.code === "declined") return;
    toast("La sauvegarde n'a pas abouti : " + (e.message || e.code || "erreur"));
  }
}

async function restaurerBibliotheque(fichier) {
  try {
    const contenu = JSON.parse(await fichier.text());
    const { ajoutees, ignorees } = await restaurer(etat.stockage, contenu, new Set(etat.partitions.map((p) => p.id)));
    const deja = ignorees ? ` (${ignorees} déjà dans ta bibliothèque)` : "";
    toast(ajoutees ? `${ajoutees} partition${ajoutees > 1 ? "s" : ""} restaurée${ajoutees > 1 ? "s" : ""}${deja}.` : `Rien à restaurer : tout est déjà dans ta bibliothèque.`);
  } catch (e) {
    toast(e instanceof SyntaxError ? "Ce fichier n'est pas une sauvegarde de Portée." : (e.message || "La restauration n'a pas abouti."), 7000);
  }
}

function nomModele(m) {
  return { "melodie-large": "Mélodie, large", "melodie-standard": "Mélodie", "piano-large": "Piano, large", "piano-standard": "Piano" }[m] || m || "";
}

// ------------------------------------------------------------------------
// Import d'une page exportée de la tablette
// ------------------------------------------------------------------------

let pdfjsPromesse = null;
function chargerPdfjs() {
  if (!pdfjsPromesse) {
    pdfjsPromesse = import("./vendor/pdfjs/pdf.min.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfjsPromesse;
}

async function importer(fichiers) {
  if (!etat.stockage) { toast("La bibliothèque s'ouvre encore, réessaie dans un instant."); return; }
  let dernier = null;
  for (const f of fichiers) {
    try {
      toast(`Lecture de « ${f.name} »…`, 60000);
      if (/\.midi?$/i.test(f.name) || /midi/i.test(f.type)) { dernier = (await importerMidi(f)) || dernier; continue; }
      const pdfjs = await chargerPdfjs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
      const lu = await lireDocument(pdfjs, doc);
      if (!lu.modele) {
        toast(`« ${f.name} » n'a pas été écrit sur un modèle Portée : impossible de savoir où sont les lignes. Duplique un modèle sur la tablette et écris dessus.`, 9000);
        continue;
      }
      // La tablette exporte tout le document : on ne garde que les pages écrites.
      const pages = lu.pages.map((p) => p.traits).filter((t) => t.length > 0);
      if (!pages.length) { toast(`« ${f.name} » ne contient aucun trait.`); continue; }
      dernier = await enregistrerLecture({ titre: titreDepuisFichier(f.name), modele: lu.modele, pages });
    } catch (e) {
      console.error(e);
      toast(`Impossible de lire « ${f.name} » : ${e.message || e}`, 9000);
    }
  }
  if (dernier && fichiers.length === 1) ouvrir(dernier, "atelier");
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
  await etat.stockage.creer(id, {
    type: "idee", titre, sequence, abc: ecrireAbc(sequence, { voix: voixCompletes(sequence), titre }).abc,
    statut: "idee", nbPages: 0, modele: null, tempo: sequence.tempo, note: "", etiquettes: [], favori: false, memo: null,
    creeLe: maintenant, modifieLe: maintenant,
  }, []);
  const laisse = [ecartees.pistes ? `${ecartees.pistes} piste${ecartees.pistes > 1 ? "s" : ""} de plus` : "", ecartees.batterie ? "la batterie" : ""].filter(Boolean).join(" et ");
  toast(`« ${titre} » : ${nb} note${nb > 1 ? "s" : ""}, une idée de plus.${laisse ? ` Laissées de côté : ${laisse} (une idée garde quatre pistes, sans percussions).` : ""}`, laisse ? 8000 : 4000);
  return id;
}

/**
 * Lit les pages et range la partition. Commun à l'import d'un PDF et à
 * l'import direct depuis la reMarkable.
 */
async function enregistrerLecture({ titre, modele, pages, source = null }) {
  const cal = await calibration(modele);
  const res = lirePartition(pages, cal, { titre });
  const maintenant = new Date().toISOString();
  const id = nouvelId();
  await etat.stockage.creer(id, {
    titre,
    modele,
    abc: res.abc,
    abcLu: res.abc,
    doutes: res.doutes.map((d) => ({ ...d, leve: false })),
    statut: "a-relire",
    nbPages: pages.length,
    apercu: apercuTraits(pages[0], cal),
    versionLecteur: VERSION_LECTEUR,
    source,
    creeLe: maintenant,
    modifieLe: maintenant,
  }, pages);
  toast(`« ${titre} » est lue : ${res.doutes.length ? `${res.doutes.length} point${res.doutes.length > 1 ? "s" : ""} à vérifier` : "rien à signaler"}.`);
  return id;
}

// ------------------------------------------------------------------------
// Ma reMarkable : parcourir la tablette et importer au clic
// ------------------------------------------------------------------------
//
// Sur claude.ai, la page ne peut joindre aucun serveur : elle passe par le
// connecteur « Portée reMarkable » qu'Adrien a ajouté à claude.ai. Ailleurs
// (GitHub Pages), elle appelle ce même connecteur directement, à l'adresse
// qu'Adrien a collée une fois (connecteur.js). Deux outils lisent la
// tablette, « arborescence » et « document » ; « relier » sert une fois,
// avec le code à 8 lettres de my.remarkable.com.

let mcpPromesse = null;
const mcp = () => (mcpPromesse ??= (async () => {
  if (dansClaude()) return window.claude.use("mcp").catch(() => null);
  const adresse = adresseEnregistree();
  return adresse ? connecteurDirect(adresse) : null;
})());
let noeudsRm = [];
let tabletteReliee = null; // null tant que le connecteur n'a pas répondu
const ouverts = new Set();

function etatRm(texte, aide = null) {
  const e = $("etat-rm");
  e.textContent = texte;
  if (aide) e.appendChild(aide);
}

/** Le message d'un outil en échec (texte renvoyé par le connecteur). */
function texteOutil(err) {
  const c = err && err.result && err.result.content;
  const t = Array.isArray(c) && c.find((x) => x && x.type === "text");
  return (t && t.text) || (err && err.message) || "";
}

/** Ce qu'il faut faire, selon ce qui bloque. Chaque cas a sa réponse. */
function expliquerErreurRm(err) {
  const code = err && err.code;
  const bloc = document.createElement("div");
  bloc.className = "aide-connecteur";
  const p = (t) => { const x = document.createElement("p"); x.textContent = t; bloc.appendChild(x); return x; };
  if (code === "adresse_invalide") {
    p("Cette adresse ne mène à aucun connecteur. Vérifie-la (elle finit par la clé), ou colle la nouvelle.");
    bloc.appendChild(formulaireAdresse());
  } else if (code === "server_not_connected" || code === "server_not_found") {
    p(`Le connecteur « ${CONNECTEUR} » n'est pas ajouté à ton compte claude.ai.`);
    p("Ajoute-le dans claude.ai → Paramètres → Connecteurs → Ajouter un connecteur personnalisé, avec exactement ce nom et l'adresse que Claude t'a donnée. Puis recharge cette page.");
  } else if (code === "needs_reauth") {
    p(`Reconnecte « ${CONNECTEUR} » dans claude.ai → Paramètres → Connecteurs, puis réessaie.`);
  } else if (code === "not_in_manifest") {
    p("Tu as refusé à Portée l'accès à ta reMarkable. Recharge la page pour qu'elle te le redemande.");
  } else if (code === "selection_required") {
    p(`Plusieurs connecteurs s'appellent « ${CONNECTEUR} » : choisis le bon quand claude.ai te le demande, ou supprime le doublon.`);
  } else if (code === "server_unavailable" || code === "upstream_error") {
    p("Le connecteur ne répond pas pour l'instant. Réessaie dans un moment : si ça dure, le projet Supabase s'est peut-être endormi (tableau de bord Supabase → relancer le projet).");
  } else if (code === "tool_error") {
    p(texteOutil(err) || "La reMarkable a refusé la demande.");
  } else if (code === "blocked_by_policy" || code === "approval_required") {
    p("Ton organisation claude.ai bloque ce connecteur pour les pages.");
  } else {
    p(`La reMarkable n'a pas pu être lue (${code || err.message || "erreur"}).`);
  }
  return bloc;
}

async function ouvrirRemarkable(rafraichir = false) {
  versPartitions();
  $("panneau-remarkable").hidden = false;
  $("panneau-remarkable").scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("arbre-rm").textContent = "";
  const m = await mcp();
  if (!m) {
    const bloc = document.createElement("div");
    bloc.className = "aide-connecteur";
    if (dansClaude()) {
      bloc.textContent = "La page n'a pas accès aux connecteurs de claude.ai : recharge-la et autorise « Portée reMarkable ».";
    } else {
      const p = document.createElement("p");
      p.textContent = "Pour parcourir ta reMarkable depuis ce site, colle une fois l'adresse de ton connecteur « Portée reMarkable » (la même que dans claude.ai). Elle reste dans ce navigateur, nulle part ailleurs.";
      bloc.append(p, formulaireAdresse());
    }
    etatRm("", bloc);
    return;
  }
  etatRm("Lecture de ta reMarkable… (quelques secondes la première fois)");
  try {
    const r = await m.callTool(CONNECTEUR, "arborescence", {}, rafraichir ? { cache: { refresh: true } } : undefined);
    recevoirArbre(r.payload);
  } catch (e) {
    console.error(e);
    etatRm("", expliquerErreurRm(e));
  }
}

function oublierAdresse() {
  enregistrerAdresse("");
  mcpPromesse = null;
  tabletteReliee = null;
  $("changer-adresse").hidden = true;
  arreterSynchro();
  majReglagesRm();
  // On reste dans les Réglages : l'adresse se recolle juste dessous.
  const zone = $("zone-adresse");
  zone.textContent = "";
  const bloc = document.createElement("div");
  bloc.className = "aide-connecteur";
  const p = document.createElement("p");
  p.textContent = "L'ancienne adresse est oubliée. Colle celle de ton connecteur « Portée reMarkable » (la même que dans claude.ai) : elle reste dans ce navigateur, nulle part ailleurs.";
  bloc.append(p, formulaireAdresse(() => { zone.textContent = ""; toast("Adresse enregistrée."); }));
  zone.appendChild(bloc);
  bloc.querySelector("input").focus();
}

function recevoirArbre(reponse) {
  if (reponse && reponse.connectee === false) {
    tabletteReliee = false;
    majReglagesRm();
    noeudsRm = [];
    $("arbre-rm").textContent = "";
    etatRm("", formulaireRelier(reponse.raison));
    return;
  }
  tabletteReliee = true;
  majReglagesRm();
  noeudsRm = (reponse && reponse.noeuds) || [];
  const n = noeudsRm.filter((x) => x.type === "document").length;
  etatRm(n === 1 ? "1 document sur ta reMarkable." : `${n} documents sur ta reMarkable.`);
  dessinerArbre();
}

/** L'adresse du connecteur, pour appeler la tablette hors de claude.ai. */
function formulaireAdresse(apres = () => ouvrirRemarkable(true)) {
  const form = document.createElement("form");
  form.className = "rangee";
  const champ = document.createElement("input");
  Object.assign(champ, { className: "champ", type: "url", placeholder: "https://….supabase.co/functions/v1/portee-remarkable/…", autocomplete: "off", spellcheck: false, value: adresseEnregistree() });
  champ.setAttribute("aria-label", "Adresse du connecteur Portée reMarkable");
  const bouton = document.createElement("button");
  bouton.className = "btn btn-plein"; bouton.type = "submit"; bouton.textContent = "Enregistrer";
  const retour = document.createElement("p");
  retour.className = "remarque"; retour.setAttribute("role", "alert");
  form.append(champ, bouton, retour);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const adresse = champ.value.trim();
    if (!FORME_ADRESSE.test(adresse)) {
      retour.textContent = "L'adresse ressemble à https://<projet>.supabase.co/functions/v1/portee-remarkable/<clé>.";
      return;
    }
    enregistrerAdresse(adresse);
    mcpPromesse = null;
    $("changer-adresse").hidden = false;
    demarrerSynchro();
    apres();
  });
  return form;
}

/** Relier la tablette, une fois pour toutes : le code à 8 lettres de my.remarkable.com. */
function formulaireRelier(raison) {
  const bloc = document.createElement("div");
  bloc.className = "aide-connecteur";
  const intro = document.createElement("p");
  intro.textContent = raison === "revoquee"
    ? "Ta reMarkable ne reconnaît plus Portée (appareil retiré de ton compte ?). Relie-la à nouveau :"
    : "Il reste à relier Portée à ta reMarkable. C'est à faire une seule fois :";
  const etapes = document.createElement("ol");
  const e1 = document.createElement("li");
  const lien = document.createElement("a");
  lien.href = "https://my.remarkable.com/device/desktop/connect";
  lien.target = "_blank";
  lien.rel = "noopener";
  lien.textContent = "my.remarkable.com/device/desktop/connect";
  e1.append("Ouvre ", lien, " (connecte-toi à ton compte reMarkable) ;");
  const e2 = document.createElement("li");
  e2.textContent = "recopie ici le code à 8 lettres affiché, sans attendre : il expire au bout de quelques minutes.";
  etapes.append(e1, e2);
  const form = document.createElement("form");
  form.className = "rangee";
  const champ = document.createElement("input");
  Object.assign(champ, { className: "champ", id: "code-rm", maxLength: 8, placeholder: "abcdefgh", autocomplete: "off", spellcheck: false });
  champ.setAttribute("autocapitalize", "none");
  champ.setAttribute("aria-label", "Code à 8 lettres de my.remarkable.com");
  champ.style.flex = "0 1 160px";
  const bouton = document.createElement("button");
  bouton.className = "btn btn-plein";
  bouton.type = "submit";
  bouton.textContent = "Relier";
  form.append(champ, bouton);
  const retour = document.createElement("p");
  retour.className = "remarque";
  retour.setAttribute("role", "alert");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const code = champ.value.trim().toLowerCase();
    if (!/^[a-z]{8}$/.test(code)) { retour.textContent = "Le code fait exactement 8 lettres."; champ.focus(); return; }
    const m = await mcp();
    if (!m) return;
    bouton.disabled = true;
    bouton.textContent = "Liaison…";
    retour.textContent = "";
    try {
      const r = await m.callTool(CONNECTEUR, "relier", { code }, { cache: false });
      toast("Ta reMarkable est reliée à Portée.");
      recevoirArbre(r.payload);
    } catch (e) {
      console.error(e);
      if (e && e.code === "tool_error") retour.textContent = texteOutil(e) || "reMarkable a refusé ce code.";
      else etatRm("", expliquerErreurRm(e));
    } finally {
      bouton.disabled = false;
      bouton.textContent = "Relier";
    }
  });
  bloc.append(intro, etapes, form, retour);
  return bloc;
}

function dessinerArbre() {
  const zone = $("arbre-rm");
  zone.textContent = "";
  const q = $("recherche-rm").value.trim().toLowerCase();
  const enfants = new Map();
  for (const n of noeudsRm) {
    const cle = n.parent || "";
    if (!enfants.has(cle)) enfants.set(cle, []);
    enfants.get(cle).push(n);
  }
  const trier = (l) => l.sort((a, b) => (a.type === b.type ? a.nom.localeCompare(b.nom, "fr") : a.type === "dossier" ? -1 : 1));
  const importees = new Map(etat.partitions.filter((p) => p.source && p.source.remarkable).map((p) => [p.source.remarkable, p]));
  // Avec une recherche : liste à plat des documents qui correspondent.
  if (q) {
    const trouves = trier(noeudsRm.filter((n) => n.type === "document" && n.nom.toLowerCase().includes(q)));
    if (!trouves.length) { const p = document.createElement("p"); p.className = "remarque"; p.textContent = "Aucun document ne porte ce nom."; zone.appendChild(p); }
    for (const d of trouves) zone.appendChild(ligneDocument(d, importees.get(d.id)));
    return;
  }
  const construire = (parent, conteneur) => {
    for (const n of trier(enfants.get(parent) || [])) {
      if (n.type === "dossier") {
        const det = document.createElement("details");
        det.open = ouverts.has(n.id);
        det.addEventListener("toggle", () => (det.open ? ouverts.add(n.id) : ouverts.delete(n.id)));
        const sum = document.createElement("summary");
        sum.textContent = n.nom;
        const sous = document.createElement("div");
        sous.className = "enfants";
        det.append(sum, sous);
        conteneur.appendChild(det);
        construire(n.id, sous);
      } else {
        conteneur.appendChild(ligneDocument(n, importees.get(n.id)));
      }
    }
  };
  construire("", zone);
}

function ligneDocument(d, dejaImportee) {
  const ligne = document.createElement("div");
  ligne.className = "doc-rm";
  const nom = document.createElement("span");
  nom.className = "nom"; nom.textContent = d.nom;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = [d.modifie ? dateCourte(d.modifie) : "", d.pdf ? "" : "carnet (pas un modèle Portée)"].filter(Boolean).join(" · ");
  const b = document.createElement("button");
  b.className = "btn btn-petit" + (d.pdf ? " btn-plein" : "");
  b.textContent = dejaImportee ? "Réimporter" : "Importer";
  b.disabled = !d.pdf;
  b.addEventListener("click", () => importerRemarkable(d, b));
  ligne.append(nom, meta);
  if (dejaImportee) {
    const voir = document.createElement("button");
    voir.className = "btn btn-petit";
    voir.textContent = "Ouvrir";
    voir.addEventListener("click", () => ouvrir(dejaImportee.id));
    ligne.append(voir);
  }
  ligne.append(b);
  return ligne;
}

async function importerRemarkable(d, bouton) {
  const m = await mcp();
  if (!m) return;
  const libelle = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = "Lecture…";
  try {
    const r = await m.callTool(CONNECTEUR, "document", { id: d.id }, { cache: false });
    const doc = r.payload || {};
    if (!doc.modele) {
      toast(`« ${d.nom} » n'a pas été écrit sur un modèle Portée : impossible de savoir où sont les lignes.`, 9000);
      return;
    }
    const pages = (doc.pages || []).map((p) => decompacter(p.traits)).filter((t) => t.length > 0);
    if (!pages.length) { toast(`« ${d.nom} » ne contient encore aucun trait.`); return; }
    const id = await enregistrerLecture({ titre: doc.nom || d.nom, modele: doc.modele, pages, source: { remarkable: d.id, modifie: d.modifie || null } });
    $("panneau-remarkable").hidden = true;
    ouvrir(id, "atelier");
  } catch (e) {
    console.error(e);
    const aide = expliquerErreurRm(e);
    etatRm("", aide);
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }
}

/** Quelques traits simplifiés du haut de la page, pour la vignette. */
function apercuTraits(traits, cal) {
  const y0 = Math.min(...traits.flat().map((p) => p[1]));
  const limite = y0 + 9 * cal.interligne;
  return traits
    .filter((t) => t.some((p) => p[1] < limite))
    .map((t) => t.filter((_, i) => i % 3 === 0 || i === t.length - 1).map(([x, y]) => [Math.round(x), Math.round(y)]))
    .slice(0, 400);
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
  else { s.className = "pastille p-doute"; s.textContent = restants ? `${restants} doute${restants > 1 ? "s" : ""}` : "À relire"; }
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
  return `${n} page${n > 1 ? "s" : ""} · lue ${dateRelative(p.creeLe)}`;
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
  $("confirmer").hidden = true;
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
async function ecouter({ objet, abc, zone, bouton, qpm, transposition = 0, voixMuettes = new Set(), titre = "" }) {
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
  $("confirmer-lecteur").hidden = true;
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

const nomDeFichier = (p) => (p.titre || "").replace(/[\\/:*?"<>|]+/g, " ").trim() || "partition";

/**
 * Le MIDI d'une page lue : une piste par main, tempo, transposition et
 * changements de la page compris. Par le même écrivain que les idées
 * (midi.js) : abcjs écrivait des pistes sans nom et perdait les changements.
 */
function midiDe(abc, { tempo, transposition = 0, titre = "" } = {}) {
  return midiDeLaPage(abc, ABCJS(), { tempo, transposition, titre });
}

/** Le MIDI de n'importe quelle partition : une idée part de ses notes, une page lue, de son ABC. */
function midiDePartition(p, reglages = {}) {
  if (p.type === "idee") return midiDeLIdee(p);
  if (p.type === "morceau") return midiDuMorceau(p, ideesParId());
  return midiDe(p.abc, { tempo: reglages.tempo ?? p.tempo, transposition: reglages.transposition ?? p.transposition ?? 0, titre: p.titre });
}

/** Télécharge le .mid (dans un .zip sur claude.ai, dont la liste des formats ignore .mid). */
async function exporterMidi(p, reglages = {}) {
  if (!p.type && !ABCJS()) { toast("abcjs n'a pas pu se charger (connexion ?)."); return; }
  const base = nomDeFichier(p);
  try {
    const octets = midiDePartition(p, reglages);
    if (etat.stockage.midiDirect) await etat.stockage.enregistrerFichier(`${base}.mid`, new Blob([octets], { type: "audio/midi" }));
    else await etat.stockage.enregistrerFichier(`${base} (MIDI).zip`, zipper([{ nom: `${base}.mid`, donnees: octets }]));
  } catch (e) {
    if (e && e.code === "declined") return;
    console.error(e);
    toast("L'export MIDI n'a pas abouti : " + (e.message || e.code || "erreur"));
  }
}

/** Toutes les partitions en MIDI, dans un seul .zip. */
async function toutEnMidi() {
  if (!ABCJS() && etat.partitions.some((p) => !p.type)) { toast("abcjs n'a pas pu se charger (connexion ?)."); return; }
  const pris = new Set();
  const fichiers = etat.partitions.map((p) => {
    let nom = nomDeFichier(p), n = 2;
    while (pris.has(nom)) nom = `${nomDeFichier(p)} (${n++})`;
    pris.add(nom);
    return { nom: `${nom}.mid`, donnees: midiDePartition(p) };
  });
  try {
    await etat.stockage.enregistrerFichier("Portée - MIDI.zip", zipper(fichiers));
  } catch (e) {
    if (e && e.code === "declined") return;
    toast("L'export n'a pas abouti : " + (e.message || e.code || "erreur"));
  }
}

/**
 * Envoie le MIDI là où on veut (AirDrop, Fichiers, mail…) avec le partage
 * du téléphone ; sinon (ordinateur, claude.ai), le télécharge.
 */
async function partagerMidi(p) {
  try {
    const fichier = new File([midiDePartition(p)], `${nomDeFichier(p)}.mid`, { type: "audio/midi" });
    if (!dansClaude() && navigator.canShare && navigator.canShare({ files: [fichier] })) {
      await navigator.share({ files: [fichier], title: p.titre });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
    console.warn("Partage impossible, téléchargement à la place", e);
  }
  await exporterMidi(p);
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
  return `${notes} note${notes > 1 ? "s" : ""} · ♩ ${seq.tempo}`;
}

/**
 * Le MusicXML (MuseScore) : une idée part de ses notes, un morceau de ses
 * blocs assemblés (comme pour le MIDI), une page lue de son ABC joué en
 * notes, avec la transposition choisie à l'écoute (le MIDI la prenait, le
 * MusicXML l'oubliait). Sur claude.ai, dans un .zip (liste fermée des formats).
 */
async function exporterMusicXml(p) {
  try {
    let texte;
    if (p.type === "idee") texte = ecrireMusicXml(p.sequence, { voix: voixCompletes(p.sequence), titre: p.titre });
    else if (p.type === "morceau") texte = musicXmlDuMorceau(p, ideesParId());
    else {
      if (!ABCJS()) { toast("abcjs n'a pas pu se charger (connexion ?)."); return; }
      texte = musicXmlDeLaPage(p.abc, ABCJS(), { tempo: p.tempo, transposition: p.transposition || 0, titre: p.titre });
    }
    const nom = `${nomDeFichier(p)}.musicxml`;
    const octets = new TextEncoder().encode(texte);
    if (etat.stockage.midiDirect) await etat.stockage.enregistrerFichier(nom, new Blob([octets], { type: "application/vnd.recordare.musicxml+xml" }));
    else await etat.stockage.enregistrerFichier(`${nomDeFichier(p)} (MusicXML).zip`, zipper([{ nom, donnees: octets }]));
  } catch (e) {
    if (e && e.code === "declined") return;
    console.error(e);
    toast("L'export MusicXML n'a pas abouti : " + (e.message || e.code || "erreur"));
  }
}

async function exporterAbc() {
  const p = etat.courante;
  try {
    await etat.stockage.enregistrerFichier(`${nomDeFichier(p)}.txt`, p.abc);
  } catch (e) {
    if (e && e.code === "declined") return;
    toast("L'export n'a pas abouti : " + (e.message || e.code || "erreur"));
  }
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

  // Import
  $("fichier").addEventListener("change", (e) => { importer([...e.target.files]); e.target.value = ""; });
  $("exemples").addEventListener("click", async () => {
    const noms = ["2026-09-30-piano-standard.pdf", "2026-09-30-melodie-standard.pdf"];
    const fichiers = [];
    for (const n of noms) {
      const r = await fetch(new URL(`./exemples/${n}`, import.meta.url));
      if (r.ok) fichiers.push(new File([await r.blob()], n.replace("2026-09-30-", "Essai "), { type: "application/pdf" }));
    }
    importer(fichiers);
  });

  // Ma reMarkable, modèles, bibliothèque
  $("ouvrir-remarkable").addEventListener("click", () => ouvrirRemarkable(false));
  $("reglage-rm").addEventListener("click", () => ouvrirRemarkable(false));
  $("vide-remarkable").addEventListener("click", () => ouvrirRemarkable(false));
  $("ouvrir-modeles").addEventListener("click", afficherModeles);
  $("vide-modeles").addEventListener("click", afficherModeles);
  $("fermer-modeles").addEventListener("click", () => { $("panneau-modeles").hidden = true; });
  $("changer-adresse").addEventListener("click", oublierAdresse);
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
  $("actualiser-rm").addEventListener("click", () => ouvrirRemarkable(true));
  $("fermer-rm").addEventListener("click", () => { $("panneau-remarkable").hidden = true; });
  $("recherche-rm").addEventListener("input", dessinerArbre);

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
    objet: objetAtelier, abc: $("abc").value, zone: $("gravure-atelier"), bouton: $("ecouter-atelier"), qpm: tempoInitial(objetAtelier),
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
  // Supprimer : la feuille « ••• » demande confirmation sous la barre, comme avant.
  $("supprimer").addEventListener("click", () => { $("confirmer").hidden = false; window.scrollTo({ top: 0, behavior: "smooth" }); });
  $("supprimer-lecteur").addEventListener("click", () => { $("confirmer-lecteur").hidden = false; window.scrollTo({ top: 0, behavior: "smooth" }); });
  $("confirmer-non").addEventListener("click", () => { $("confirmer").hidden = true; });
  $("confirmer-lecteur-non").addEventListener("click", () => { $("confirmer-lecteur").hidden = true; });
  $("confirmer-oui").addEventListener("click", supprimerOuverte);
  $("confirmer-lecteur-oui").addEventListener("click", supprimerOuverte);

  // Lecteur
  const voixMuettes = () => new Set([...($("main-droite").checked ? [] : [1]), ...($("main-gauche").checked ? [] : [2])]);
  $("ecouter").addEventListener("click", () => ecouter({
    objet: objetLecteur, abc: etat.courante.abc, zone: $("gravure-lecteur"), bouton: $("ecouter"),
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
  $("export-abc").addEventListener("click", exporterAbc);
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
      if (!(await veutSupprimer(p))) return undefined;
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

/**
 * Faut-il supprimer `p` (partition, idée ou morceau) ? La question se pose
 * dans la fenêtre de l'appli, pas avec window.confirm : celle du navigateur
 * ne suit pas l'ambiance de l'appli, et une page intégrée (claude.ai) peut
 * ne pas avoir le droit de l'ouvrir, la réponse est alors « non » sans rien
 * montrer. Une idée qui sert dans un morceau le dit : sa partie y sera sautée.
 */
async function veutSupprimer(p) {
  const quoi = p.type === "morceau" ? "le morceau" : p.type === "idee" ? "l'idée" : "la partition";
  let texte = "Ses pages partent avec elle. C'est définitif.";
  if (p.type === "morceau") texte = "Ses idées restent dans ta bibliothèque. C'est définitif.";
  if (p.type === "idee") {
    const morceaux = etat.partitions.filter((m) => m.type === "morceau" && (m.blocs || []).some((b) => b.idee === p.id)).map((m) => `« ${m.titre} »`);
    texte = morceaux.length ? `Elle sert dans ${morceaux.join(", ")} : cette partie y sera sautée. C'est définitif.` : "C'est définitif.";
  }
  return (await dialogue(`Supprimer ${quoi} « ${p.titre} » ?`, texte, [{ valeur: "supprimer", texte: "Supprimer", danger: true }])) === "supprimer";
}

/** Supprime `p` de la bibliothèque (et des autres appareils, par la synchro). */
async function supprimerDeLaBibliotheque(p) {
  await etat.stockage.supprimer(p.id, p.type ? 0 : p.nbPages || 0);
  toast(`« ${p.titre} » est supprimé${p.type === "morceau" ? "" : "e"}.`);
}

/** Une petite fenêtre : un titre, des boutons ; rend la valeur du bouton choisi (ou null). */
function dialogue(titre, texte, choix) {
  const d = $("dialogue");
  const f = $("dialogue-dedans");
  f.textContent = "";
  const h = document.createElement("h2"); h.textContent = titre;
  const p = document.createElement("p"); p.className = "remarque"; p.textContent = texte;
  const liste = document.createElement("div"); liste.className = "liste-choix";
  for (const c of choix) {
    const b = document.createElement("button");
    b.className = "btn" + (c.plein ? " btn-plein" : "") + (c.danger ? " btn-danger" : "");
    b.value = c.valeur; b.textContent = c.texte;
    liste.appendChild(b);
  }
  const annuler = document.createElement("button");
  annuler.className = "btn btn-petit"; annuler.value = ""; annuler.textContent = "Annuler";
  f.append(h, p, liste, annuler);
  return new Promise((ok) => {
    d.addEventListener("close", () => ok(d.returnValue || null), { once: true });
    d.returnValue = "";
    d.showModal();
  });
}

/** « Ajouter à un morceau » : un morceau existant, ou un nouveau. */
async function choisirMorceau(p) {
  const morceaux = etat.partitions.filter((x) => x.type === "morceau");
  const choix = await dialogue("Ajouter à un morceau", `« ${p.titre} » devient un bloc du morceau choisi.`, [
    { valeur: "nouveau", texte: "+ Un nouveau morceau", plein: true },
    ...morceaux.map((x) => ({ valeur: x.id, texte: `${x.titre} (${(x.blocs || []).length} bloc${(x.blocs || []).length > 1 ? "s" : ""})` })),
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
    veutSupprimer,
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
    supprimer: async (p) => { if (await veutSupprimer(p)) await supprimerDeLaBibliotheque(p); },
    etiquettes: toutesEtiquettes,
    dateCourte, resumeIdee, nomModele, pastilleStatut,
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

async function demarrer() {
  injecterIcones();
  // Un appui long sur une icône dit ce qu'elle fait.
  installerInfobulles();
  // Au retour d'arrière-plan ou d'un appel : le son reprend, l'écran se rallume (eveil.js, M8).
  installerEveil({ piano });
  creerAccueilDeLAppli();
  brancher();
  creerEditeur();
  creerVueDuMorceau();
  afficherBibliotheque();
  etat.stockage = await ouvrirStockage();
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
  $("changer-adresse").hidden = dansClaude() || !adresseEnregistree();
  // Hors ligne et installable, hors de claude.ai (sw.js n'existe que sur le site).
  if (!dansClaude() && "serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  etat.stockage.ecouter(
    (liste) => {
      etat.partitions = liste;
      if (etat.vue === "biblio") afficherBibliotheque();
      if (etat.vue === "morceau") vueMorceau.rafraichir();
    },
    (e) => toast("La bibliothèque ne répond plus : recharge la page. (" + (e.code || e.message) + ")", 9000),
  );
}

demarrer();
