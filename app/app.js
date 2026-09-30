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
  filtre: "tout",
  courante: null,     // la partition ouverte (document)
  pages: [],          // ses traits, page par page
  page: 0,            // page affichée dans l'atelier
  douteActif: -1,
  vue: "biblio",
  transposition: 0,
  selection: null,    // début, dans l'ABC, de la note choisie dans « Corriger »
  historique: [],     // les ABC d'avant chaque geste, pour « Annuler »
};

const piano = new Piano(new URL("./piano/", import.meta.url).href);
const calibrations = new Map();

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
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => (t.hidden = true), duree);
}

function dateCourte(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function pastilleStatut(p) {
  const restants = (p.doutes || []).filter((d) => !d.leve).length;
  const span = document.createElement("span");
  if (p.statut === "prete") { span.className = "pastille p-ok"; span.textContent = "Prête"; }
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
  etat.vue = vue;
  for (const v of ["biblio", "atelier", "lecteur"]) $(`vue-${v}`).hidden = v !== vue;
  const dansPartition = vue !== "biblio";
  $("fil").hidden = !dansPartition;
  $("onglets").hidden = !dansPartition;
  $("onglet-atelier").setAttribute("aria-selected", String(vue === "atelier"));
  $("onglet-lecteur").setAttribute("aria-selected", String(vue === "lecteur"));
  arreterLecture();
  if (vue === "atelier") afficherAtelier();
  if (vue === "lecteur") afficherLecteur();
  window.scrollTo({ top: 0 });
}

async function ouvrir(id, vue = "atelier") {
  const p = await etat.stockage.lire(id);
  if (!p) { toast("Cette partition n'existe plus."); return; }
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

// ------------------------------------------------------------------------
// Bibliothèque
// ------------------------------------------------------------------------

function afficherBibliotheque() {
  const q = $("recherche").value.trim().toLowerCase();
  const liste = $("liste");
  liste.textContent = "";
  const visibles = etat.partitions.filter((p) =>
    (etat.filtre === "tout" || p.statut === etat.filtre) && (!q || (p.titre || "").toLowerCase().includes(q)));
  $("vide").hidden = etat.partitions.length > 0;
  $("aucun").hidden = !(etat.partitions.length > 0 && visibles.length === 0);
  $("tout-midi").hidden = $("sauvegarder").hidden = etat.partitions.length === 0;
  for (const p of visibles) {
    const carte = document.createElement("article");
    carte.className = "carte";
    const principal = document.createElement("button");
    principal.className = "ouvrir";
    principal.setAttribute("aria-label", `Ouvrir « ${p.titre} »`);
    principal.addEventListener("click", () => ouvrir(p.id, p.statut === "prete" ? "lecteur" : "atelier"));
    const apercu = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    apercu.setAttribute("role", "img");
    apercu.setAttribute("aria-label", `Aperçu de ${p.titre}`);
    principal.appendChild(apercu);
    if (p.apercu && p.modele) {
      calibration(p.modele).then((cal) => dessinerPage(apercu, cal, p.apercu, { compact: true, limite: 9 * cal.interligne })).catch(() => {});
    }
    const infos = document.createElement("div");
    infos.className = "infos";
    const titre = document.createElement("span");
    titre.className = "titre"; titre.textContent = p.titre;
    const meta = document.createElement("span");
    meta.className = "meta"; meta.textContent = `${nomModele(p.modele)} · ${dateCourte(p.modifieLe)}`;
    infos.append(titre, meta, pastilleStatut(p));
    principal.appendChild(infos);
    const actions = document.createElement("div");
    actions.className = "actions";
    const bouton = (texte, f, plein = false) => {
      const b = document.createElement("button");
      b.className = "btn btn-petit" + (plein ? " btn-plein" : "");
      b.textContent = texte;
      b.addEventListener("click", f);
      actions.appendChild(b);
    };
    bouton("Corriger", () => ouvrir(p.id, "atelier"), p.statut !== "prete");
    bouton("Écouter", () => ouvrir(p.id, "lecteur"), p.statut === "prete");
    bouton("MIDI", () => exporterMidi(p));
    carte.append(principal, actions);
    liste.appendChild(carte);
  }
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
  if (!etat.stockage || dansClaude() || etat.stockage.mode === "claude") return;
  if (!actif) {
    $("mode").textContent = "Enregistré dans ce navigateur";
    $("mode-detail").textContent = "Tes partitions restent dans ce navigateur. Active la synchronisation pour les retrouver sur tous tes appareils, ou sauvegarde-les dans un fichier.";
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

function afficherModeles() {
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
  $("panneau-remarkable").hidden = false;
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
  $("changer-adresse").hidden = true;
  arreterSynchro();
  ouvrirRemarkable(false);
}

function recevoirArbre(reponse) {
  if (reponse && reponse.connectee === false) {
    noeudsRm = [];
    $("arbre-rm").textContent = "";
    etatRm("", formulaireRelier(reponse.raison));
    return;
  }
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

let minuterieGravure = null, minuterieSauvegarde = null, objetAtelier = null;

async function afficherAtelier() {
  const p = etat.courante;
  $("titre").value = p.titre;
  $("abc").value = p.abc;
  $("confirmer").hidden = true;
  $("statut-atelier").replaceChildren(pastilleStatut(p));
  $("enregistre").textContent = "";
  $("annuler").disabled = etat.historique.length === 0;
  await dessinerManuscrit();
  graverAtelier();
  majOutils();
  afficherDoutes();
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
  dessinerPage(svg, cal, etat.pages[etat.page] || [], {
    doutes: (p.doutes || []).map((d) => ((d.page || 1) === etat.page + 1 ? d : { ...d, leve: true })),
    actif: etat.douteActif,
  });
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

/** Surligne la note choisie après chaque nouvelle gravure. */
function surligner() {
  const j = jetonChoisi();
  if (!j || !objetAtelier || !objetAtelier.engraver) return;
  try { objetAtelier.engraver.rangeHighlight(j.debut + PREFIXE_GRAVURE.length, j.fin + PREFIXE_GRAVURE.length); } catch { /* gravure en cours */ }
}

function majOutils() {
  const j = jetonChoisi();
  const barre = $("outils-note");
  barre.querySelectorAll("button").forEach((b) => { b.disabled = !j; b.setAttribute("aria-pressed", "false"); });
  if (!j) { $("note-choisie").textContent = "Aucune note choisie : touche une note de la partition."; return; }
  if (j.notes.length) derniereNote = { ...j.notes[0], alteration: "" };
  $("note-choisie").textContent = ed.decrire(j);
  const base = ed.estPointee(j.croches) ? j.croches / 1.5 : j.croches;
  barre.querySelectorAll("[data-duree]").forEach((b) => b.setAttribute("aria-pressed", String(Math.abs(Number(b.dataset.duree) - base) < 1e-9)));
  barre.querySelector('[data-geste="point"]').setAttribute("aria-pressed", String(ed.estPointee(j.croches)));
  barre.querySelectorAll("[data-alteration]").forEach((b) => {
    b.disabled = j.type === "silence";
    b.setAttribute("aria-pressed", String(j.notes.length > 0 && j.notes.every((n) => n.alteration === b.dataset.alteration)));
  });
  barre.querySelectorAll('[data-geste="haut"], [data-geste="bas"]').forEach((b) => { b.disabled = j.type === "silence"; });
  $("bouton-silence").textContent = j.type === "silence" ? "en note" : "en silence";
}

/** Fait entendre la note choisie (ou l'accord), brièvement. */
function entendre(j) {
  if (!j || j.type === "silence") return;
  const hauteurs = ed.hauteursMidi(j, ed.armureA(abcCourant(), j.debut));
  piano.pret().then(() => hauteurs.forEach((h) => piano.note(h, 0.7, 80))).catch(() => {});
}

/** Applique un geste : mémorise l'état d'avant, regrave, enregistre. */
function appliquer(res, { entendre: jouer = false } = {}) {
  if (!res) return;
  arreterLecture();
  memoriser(abcCourant());
  $("abc").value = res.abc;
  etat.selection = res.fin > res.debut ? res.debut : prochaineNote(res.abc, res.debut);
  graverAtelier();
  majOutils();
  planifierSauvegarde();
  if (jouer) entendre(jetonChoisi());
}

function memoriser(abc) {
  etat.historique.push(abc);
  if (etat.historique.length > 200) etat.historique.shift();
  $("annuler").disabled = false;
}

function annuler() {
  const avant = etat.historique.pop();
  if (avant === undefined) return;
  arreterLecture();
  $("abc").value = avant;
  if (etat.selection !== null && !ed.lireJeton(avant, etat.selection)) etat.selection = null;
  $("annuler").disabled = etat.historique.length === 0;
  graverAtelier();
  majOutils();
  planifierSauvegarde();
}

function planifierSauvegarde() {
  clearTimeout(minuterieSauvegarde);
  $("enregistre").textContent = "…";
  minuterieSauvegarde = setTimeout(() => sauver({ abc: abcCourant() }), 800);
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

function afficherDoutes() {
  const p = etat.courante;
  const zone = $("doutes");
  zone.textContent = "";
  const doutes = p.doutes || [];
  if (!doutes.length) {
    const r = document.createElement("p");
    r.className = "remarque";
    r.textContent = "Portée n'a rien trouvé de douteux. Écoute pour vérifier, puis valide.";
    zone.appendChild(r);
    return;
  }
  doutes.forEach((d, i) => {
    const item = document.createElement("div");
    item.className = "doute-item" + (d.leve ? " leve" : "") + (i === etat.douteActif ? " actif" : "");
    const msg = document.createElement("p");
    msg.textContent = (d.leve ? "Vu : " : "") + d.message;
    const actions = document.createElement("div");
    actions.className = "rangee";
    const voir = document.createElement("button");
    voir.className = "btn btn-petit"; voir.textContent = "Montrer sur la page";
    voir.addEventListener("click", () => { etat.douteActif = i; etat.page = (d.page || 1) - 1; dessinerManuscrit(); afficherDoutes(); $("page").scrollIntoView({ behavior: "smooth", block: "center" }); });
    const vu = document.createElement("button");
    vu.className = "btn btn-petit"; vu.textContent = d.leve ? "Rouvrir" : "C'est vu";
    vu.addEventListener("click", () => leverDoute(i, !d.leve));
    actions.append(voir, vu);
    item.append(msg, actions);
    zone.appendChild(item);
  });
}

async function leverDoute(i, leve) {
  const p = etat.courante;
  const doutes = p.doutes.map((d, k) => (k === i ? { ...d, leve } : d));
  p.doutes = doutes;
  await sauver({ doutes });
  afficherDoutes();
  dessinerManuscrit();
  $("statut-atelier").replaceChildren(pastilleStatut(p));
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

// ------------------------------------------------------------------------
// Écoute (atelier et lecteur)
// ------------------------------------------------------------------------

let lecture = null;

function arreterLecture() {
  if (!lecture) return;
  lecture.tc.stop();
  piano.silence();
  lecture.zone.querySelectorAll(".joue").forEach((n) => n.classList.remove("joue"));
  lecture.bouton.textContent = "▶ Écouter";
  lecture = null;
}

/** Rangées de caractères de chaque voix dans l'ABC (pour couper une main). */
function plagesVoix(abc) {
  const plages = [];
  let pos = 0;
  for (const ligne of abc.split("\n")) {
    const m = ligne.match(/^\[V:(\d+)\]/);
    if (m) plages.push({ voix: Number(m[1]), de: pos, a: pos + ligne.length });
    pos += ligne.length + 1;
  }
  return plages;
}

async function ecouter({ objet, abc, zone, bouton, qpm, transposition = 0, voixMuettes = new Set() }) {
  if (lecture) { const meme = lecture.bouton === bouton; arreterLecture(); if (meme) return; }
  if (!objet) return;
  bouton.textContent = "Chargement du piano…";
  try { await piano.pret(); }
  catch (e) { bouton.textContent = "▶ Écouter"; toast(e.message || "Le piano n'a pas pu se charger."); return; }
  objet.setUpAudio();
  const ronde = (4 * 60) / qpm;
  const plages = plagesVoix(pourGravure(abc));
  const voixDe = (c) => (plages.find((p) => c >= p.de && c <= p.a) || { voix: 1 }).voix;
  const tc = new (ABCJS().TimingCallbacks)(objet, {
    qpm,
    eventCallback: (ev) => {
      if (!ev) { arreterLecture(); return; }
      zone.querySelectorAll(".joue").forEach((n) => n.classList.remove("joue"));
      (ev.elements || []).flat().forEach((n) => n && n.classList && n.classList.add("joue"));
      for (const p of ev.midiPitches || []) {
        if (voixMuettes.has(voixDe(p.startChar))) continue;
        piano.note(p.pitch + transposition, p.duration * ronde, p.volume || 90);
      }
    },
  });
  lecture = { tc, zone, bouton };
  bouton.textContent = "■ Arrêter";
  tc.start();
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
  $("titre-lecteur").textContent = p.titre;
  const k = (p.abc.match(/^K:(.*)$/m) || [])[1] || "C";
  const m0 = (p.abc.match(/^M:(.*)$/m) || [])[1];
  const m = !m0 || m0 === "none" ? "libre" : m0;
  $("meta-lecteur").textContent = `tonalité ${k} · mesure ${m} · ${nomModele(p.modele)}`;
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

/** Le MIDI d'une partition : une piste par voix (par main au piano), tempo et transposition compris. */
function midiDe(abc, { tempo, transposition = 0 } = {}) {
  const options = { midiOutputType: "binary", midiTranspose: transposition };
  if (tempo) options.qpm = tempo; // sinon, le tempo écrit dans l'ABC (Q:)
  const [binaire] = ABCJS().synth.getMidiFile(abc, options);
  return binaire instanceof Uint8Array ? binaire : new Uint8Array(binaire);
}

/** Télécharge le .mid (dans un .zip sur claude.ai, dont la liste des formats ignore .mid). */
async function exporterMidi(p, reglages = {}) {
  if (!ABCJS()) { toast("abcjs n'a pas pu se charger (connexion ?)."); return; }
  const base = nomDeFichier(p);
  try {
    const octets = midiDe(p.abc, { tempo: reglages.tempo ?? p.tempo, transposition: reglages.transposition ?? p.transposition ?? 0 });
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
  if (!ABCJS()) { toast("abcjs n'a pas pu se charger (connexion ?)."); return; }
  const pris = new Set();
  const fichiers = etat.partitions.map((p) => {
    let nom = nomDeFichier(p), n = 2;
    while (pris.has(nom)) nom = `${nomDeFichier(p)} (${n++})`;
    pris.add(nom);
    return { nom: `${nom}.mid`, donnees: midiDe(p.abc, { tempo: p.tempo, transposition: p.transposition || 0 }) };
  });
  try {
    await etat.stockage.enregistrerFichier("Portée - MIDI.zip", zipper(fichiers));
  } catch (e) {
    if (e && e.code === "declined") return;
    toast("L'export n'a pas abouti : " + (e.message || e.code || "erreur"));
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
  $("onglet-atelier").addEventListener("click", () => montrer("atelier"));
  $("onglet-lecteur").addEventListener("click", () => montrer("lecteur"));

  // Import
  $("fichier").addEventListener("change", (e) => { importer([...e.target.files]); e.target.value = ""; });
  const depot = $("depot");
  ["dragenter", "dragover"].forEach((t) => depot.addEventListener(t, (e) => { e.preventDefault(); depot.classList.add("survol"); }));
  ["dragleave", "drop"].forEach((t) => depot.addEventListener(t, () => depot.classList.remove("survol")));
  depot.addEventListener("drop", (e) => {
    e.preventDefault();
    const fichiers = [...(e.dataTransfer?.files || [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (fichiers.length) importer(fichiers); else toast("Dépose un fichier PDF exporté de la tablette.");
  });
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
  $("vide-remarkable").addEventListener("click", () => ouvrirRemarkable(false));
  $("ouvrir-modeles").addEventListener("click", afficherModeles);
  $("vide-modeles").addEventListener("click", afficherModeles);
  $("fermer-modeles").addEventListener("click", () => { $("panneau-modeles").hidden = true; });
  $("changer-adresse").addEventListener("click", oublierAdresse);
  $("tout-midi").addEventListener("click", toutEnMidi);
  $("synchroniser").addEventListener("click", synchroniser);
  $("activer-synchro").addEventListener("click", () => {
    if (!document.querySelector("#pied-biblio .aide-connecteur")) $("pied-biblio").appendChild(formulaireSynchro());
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") synchroniser(); });
  window.addEventListener("online", synchroniser);
  window.addEventListener("offline", () => afficherSynchro(dernierEtat && { ...dernierEtat, etat: "erreur", erreur: { message: "hors ligne" } }));
  $("sauvegarder").addEventListener("click", sauvegarderBibliotheque);
  $("restaurer").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) restaurerBibliotheque(f); });
  $("actualiser-rm").addEventListener("click", () => ouvrirRemarkable(true));
  $("fermer-rm").addEventListener("click", () => { $("panneau-remarkable").hidden = true; });
  $("recherche-rm").addEventListener("input", dessinerArbre);

  // Bibliothèque
  $("recherche").addEventListener("input", afficherBibliotheque);
  document.querySelectorAll("[data-filtre]").forEach((b) => b.addEventListener("click", () => {
    etat.filtre = b.dataset.filtre;
    document.querySelectorAll("[data-filtre]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    afficherBibliotheque();
  }));

  // Atelier
  $("titre").addEventListener("change", () => {
    const t = $("titre").value.trim() || "Sans titre";
    $("fil-titre").textContent = t;
    sauver({ titre: t });
  });
  // Saisie à la main (mode avancé) : un seul « Annuler » par salve de frappe.
  let avantSaisie = null;
  $("abc").addEventListener("focus", () => { avantSaisie = $("abc").value; });
  $("abc").addEventListener("input", () => {
    arreterLecture();
    if (avantSaisie !== null) { memoriser(avantSaisie); avantSaisie = null; }
    etat.selection = null;
    clearTimeout(minuterieGravure);
    minuterieGravure = setTimeout(() => { graverAtelier(); majOutils(); }, 250);
    planifierSauvegarde();
  });
  $("abc").addEventListener("blur", () => { avantSaisie = null; });
  $("relire").addEventListener("click", () => {
    memoriser(abcCourant());
    $("abc").value = etat.courante.abcLu;
    etat.selection = null;
    graverAtelier();
    majOutils();
    sauver({ abc: etat.courante.abcLu });
  });
  $("annuler").addEventListener("click", annuler);
  $("outils-note").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.duree) geste("duree", Number(b.dataset.duree));
    else if (b.dataset.alteration) geste("alteration", b.dataset.alteration);
    else geste(b.dataset.geste);
  });
  $("page").addEventListener("click", (e) => {
    const r = e.target.closest("[data-doute]");
    if (!r) return;
    etat.douteActif = Number(r.dataset.doute);
    dessinerManuscrit(); afficherDoutes();
  });
  $("ecouter-atelier").addEventListener("click", () => ecouter({
    objet: objetAtelier, abc: $("abc").value, zone: $("gravure-atelier"), bouton: $("ecouter-atelier"), qpm: tempoInitial(objetAtelier),
  }));
  $("valider").addEventListener("click", async () => {
    clearTimeout(minuterieSauvegarde);
    await sauver({ abc: $("abc").value, statut: "prete" });
    montrer("lecteur");
  });
  document.addEventListener("keydown", clavier);
  $("supprimer").addEventListener("click", () => { $("confirmer").hidden = false; });
  $("confirmer-non").addEventListener("click", () => { $("confirmer").hidden = true; });
  $("confirmer-oui").addEventListener("click", async () => {
    const p = etat.courante;
    await etat.stockage.supprimer(p.id, p.nbPages || 0);
    etat.courante = null;
    toast(`« ${p.titre} » est supprimée.`);
    montrer("biblio");
  });

  // Lecteur
  const voixMuettes = () => new Set([...($("main-droite").checked ? [] : [1]), ...($("main-gauche").checked ? [] : [2])]);
  $("ecouter").addEventListener("click", () => ecouter({
    objet: objetLecteur, abc: etat.courante.abc, zone: $("gravure-lecteur"), bouton: $("ecouter"),
    qpm: Number($("tempo").value), transposition: etat.transposition, voixMuettes: voixMuettes(),
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

async function demarrer() {
  brancher();
  afficherBibliotheque();
  etat.stockage = await ouvrirStockage();
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
    },
    (e) => toast("La bibliothèque ne répond plus : recharge la page. (" + (e.code || e.message) + ")", 9000),
  );
}

demarrer();
