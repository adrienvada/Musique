/**
 * PORTÉE — l'appli
 *
 * Trois écrans : la bibliothèque (tes partitions), l'atelier (ta page à
 * côté de ce que Portée a lu, pour corriger) et le lecteur (la partition
 * gravée, jouée au piano). Tout passe par le texte ABC de la partition :
 * le lecteur de traits l'écrit, tu le corriges, abcjs le grave et le joue.
 */
import { lireDocument } from "./lecteur/extraction.js";
import { lirePartition } from "./lecteur/partition.js";
import { dessinerPage } from "./manuscrit.js";
import { Piano } from "./piano.js";
import { nouvelId, ouvrirStockage } from "./stockage.js";
import { zipper } from "./zip.js";

const VERSION_LECTEUR = 1;
const $ = (id) => document.getElementById(id);
const ABCJS = () => window.ABCJS;
// Pour la gravure seulement : la dernière ligne s'étire sur toute la largeur,
// sinon une pièce d'une mesure s'affiche minuscule.
const pourGravure = (abc) => "%%stretchlast 1\n" + abc;

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
  etat.transposition = 0;
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
  for (const p of visibles) {
    const carte = document.createElement("button");
    carte.className = "carte";
    carte.addEventListener("click", () => ouvrir(p.id, p.statut === "prete" ? "lecteur" : "atelier"));
    const apercu = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    apercu.setAttribute("role", "img");
    apercu.setAttribute("aria-label", `Aperçu de ${p.titre}`);
    carte.appendChild(apercu);
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
    carte.appendChild(infos);
    liste.appendChild(carte);
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
      const cal = await calibration(lu.modele);
      // La tablette exporte tout le document : on ne garde que les pages écrites.
      const pages = lu.pages.map((p) => p.traits).filter((t) => t.length > 0);
      if (!pages.length) { toast(`« ${f.name} » ne contient aucun trait.`); continue; }
      const titre = titreDepuisFichier(f.name);
      const res = lirePartition(pages, cal, { titre });
      const maintenant = new Date().toISOString();
      const id = nouvelId();
      const premierSysteme = pages[0];
      await etat.stockage.creer(id, {
        titre,
        modele: lu.modele,
        abc: res.abc,
        abcLu: res.abc,
        doutes: res.doutes.map((d) => ({ ...d, leve: false })),
        statut: "a-relire",
        nbPages: pages.length,
        apercu: apercuTraits(premierSysteme, cal),
        versionLecteur: VERSION_LECTEUR,
        creeLe: maintenant,
        modifieLe: maintenant,
      }, pages);
      dernier = id;
      toast(`« ${titre} » est lue : ${res.doutes.length ? `${res.doutes.length} point${res.doutes.length > 1 ? "s" : ""} à vérifier` : "rien à signaler"}.`);
    } catch (e) {
      console.error(e);
      toast(`Impossible de lire « ${f.name} » : ${e.message || e}`, 9000);
    }
  }
  if (dernier && fichiers.length === 1) ouvrir(dernier, "atelier");
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
  await dessinerManuscrit();
  graverAtelier();
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

function graverAtelier() {
  const lib = ABCJS();
  const zone = $("gravure-atelier");
  if (!lib) { zone.textContent = "La gravure n'a pas pu se charger (connexion ?)."; return; }
  const abc = $("abc").value;
  const [objet] = lib.renderAbc(zone, pourGravure(abc), { responsive: "resize", add_classes: true, paddingtop: 0, paddingleft: 0, paddingright: 0 });
  objetAtelier = objet;
  const e = $("etat-abc");
  e.textContent = "";
  const avert = (objet && objet.warnings) || [];
  const pastille = document.createElement("span");
  if (avert.length) {
    pastille.className = "pastille p-doute"; pastille.textContent = "ABC à corriger";
    e.append(pastille, " " + avert[0].replace(/<[^>]+>/g, ""));
  } else {
    pastille.className = "pastille p-ok"; pastille.textContent = "ABC valide";
    e.append(pastille);
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
  const q = tempoInitial(objetLecteur);
  $("tempo").value = q;
  $("tempo-val").textContent = `♩ = ${q}`;
}

function graverLecteur() {
  const lib = ABCJS();
  const zone = $("gravure-lecteur");
  if (!lib) { zone.textContent = "La gravure n'a pas pu se charger (connexion ?)."; return; }
  [objetLecteur] = lib.renderAbc(zone, pourGravure(etat.courante.abc), { responsive: "resize", add_classes: true, visualTranspose: etat.transposition, paddingleft: 0, paddingright: 0 });
  $("transp-val").textContent = (etat.transposition > 0 ? "+" : "") + etat.transposition;
}

async function exporter(type) {
  const p = etat.courante;
  const base = p.titre.replace(/[\\/:*?"<>|]+/g, " ").trim() || "partition";
  try {
    if (type === "abc") {
      await etat.stockage.enregistrerFichier(`${base}.txt`, p.abc);
    } else {
      const [binaire] = ABCJS().synth.getMidiFile(p.abc, { midiOutputType: "binary", qpm: Number($("tempo").value), midiTranspose: etat.transposition });
      const octets = binaire instanceof Uint8Array ? binaire : new Uint8Array(binaire);
      await etat.stockage.enregistrerFichier(`${base} (MIDI).zip`, zipper([{ nom: `${base}.mid`, donnees: octets }]));
    }
  } catch (e) {
    if (e && e.code === "declined") return;
    console.error(e);
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
  $("abc").addEventListener("input", () => {
    arreterLecture();
    clearTimeout(minuterieGravure);
    minuterieGravure = setTimeout(graverAtelier, 250);
    clearTimeout(minuterieSauvegarde);
    $("enregistre").textContent = "…";
    minuterieSauvegarde = setTimeout(() => sauver({ abc: $("abc").value }), 1200);
  });
  $("relire").addEventListener("click", () => {
    $("abc").value = etat.courante.abcLu;
    graverAtelier();
    sauver({ abc: etat.courante.abcLu });
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
  $("tempo").addEventListener("input", () => { $("tempo-val").textContent = `♩ = ${$("tempo").value}`; arreterLecture(); });
  const transposer = (d) => { etat.transposition = Math.max(-12, Math.min(12, etat.transposition + d)); arreterLecture(); graverLecteur(); };
  $("transp-moins").addEventListener("click", () => transposer(-1));
  $("transp-plus").addEventListener("click", () => transposer(1));
  $("main-droite").addEventListener("change", arreterLecture);
  $("main-gauche").addEventListener("change", arreterLecture);
  $("export-abc").addEventListener("click", () => exporter("abc"));
  $("export-midi").addEventListener("click", () => exporter("midi"));
}

async function demarrer() {
  brancher();
  afficherBibliotheque();
  etat.stockage = await ouvrirStockage();
  $("mode").textContent = etat.stockage.mode === "claude"
    ? "Enregistré sur claude.ai : tes partitions te suivent sur tes appareils"
    : "Mode local : tes partitions restent dans ce navigateur";
  etat.stockage.ecouter(
    (liste) => {
      etat.partitions = liste;
      if (etat.vue === "biblio") afficherBibliotheque();
    },
    (e) => toast("La bibliothèque ne répond plus : recharge la page. (" + (e.code || e.message) + ")", 9000),
  );
}

demarrer();
