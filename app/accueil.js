/**
 * L'ACCUEIL : QUATRE ONGLETS
 *
 * « Noter d'abord, retrouver ensuite ». L'accueil (la vue `biblio`) a quatre
 * onglets, retenus d'une fois sur l'autre :
 *   - Carnet : trois façons de noter une idée (jouer, chanter, fredonner un
 *     mémo), puis tout ce qu'on a noté, en lignes compactes groupées par date ;
 *   - Partitions : les pages écrites à la main (cartes), et ce qui les amène
 *     ici (reMarkable, PDF, modèles) ;
 *   - Morceaux : les idées mises bout à bout ;
 *   - Réglages : des groupes de lignes (tablette, synchronisation, éditeur,
 *     sauvegarde, appli).
 *
 * Les onglets vivent DANS la vue `biblio` : pour `montrer()` (app.js), l'accueil
 * reste une seule vue, et sa barre du haut (avec les onglets) disparaît avec elle.
 *
 * Ce module dessine et câble ce qui est propre à l'accueil ; tout ce qu'il
 * faut à l'appli (ouvrir une partition, écouter, exporter, importer…) lui est
 * passé en dépendances, comme pour l'éditeur d'idée et l'écran du morceau.
 */
import { dessinerApercu } from "./idee.js";
import { dessinerApercuMorceau } from "./vue-morceau.js";
import { dessinerPage } from "./manuscrit.js";
import { assembler } from "./morceau.js";
import { ico } from "./icones.js";
import { echapper } from "./ui.js";
import { ambianceStudio, lirePref, ecrirePref } from "./preferences.js";
import { brancherFeuille, fermerFeuille, ouvrirFeuille } from "./feuilles.js";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
export const ONGLETS = ["carnet", "partitions", "morceaux", "reglages"];
const CLE_ONGLET = "portee:onglet";

const el = (tag, classe = "", texte = null) => {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texte !== null) e.textContent = texte;
  return e;
};

/** Ce que la recherche regarde : le titre, les étiquettes, la note. */
const texteDe = (p) => [p.titre, ...(p.etiquettes || []), p.note || ""].join(" ").toLowerCase();

/** « Aujourd'hui », « Cette semaine »… : le carnet se lit par date. */
function periode(iso) {
  const d = new Date(iso || 0), maintenant = new Date();
  const jours = (new Date(maintenant.toDateString()) - new Date(d.toDateString())) / 86400000;
  if (jours <= 0) return "Aujourd'hui";
  if (jours === 1) return "Hier";
  if (jours < 7) return "Cette semaine";
  if (jours < 31) return "Ce mois-ci";
  return "Plus ancien";
}

/**
 * La date, dite au plus court : sous « Aujourd'hui », l'heure suffit. Une ligne
 * du carnet n'a que ~190 px pour son texte, et la date vient en dernier.
 */
function quand(iso, groupe) {
  if (!iso) return "";
  const d = new Date(iso);
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (groupe === "Aujourd'hui" || groupe === "Hier") return heure;
  if (groupe === "Cette semaine") return `${d.toLocaleDateString("fr-FR", { weekday: "short" })} ${heure}`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** « 1:57 » : la durée d'un morceau, d'après ses blocs et son tempo. */
function dureeMorceau(p, idees) {
  const a = assembler(p, idees);
  if (!a.fin) return "";
  const s = Math.round((a.fin / 4) * (60 / a.tempo));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** « Intro · Couplet ×2 · Refrain » : les parties d'un morceau, dans l'ordre. */
function partiesDuMorceau(p) {
  return (p.blocs || []).map((b) => (b.fois > 1 ? `${b.nom} ×${b.fois}` : b.nom)).filter(Boolean).join(" · ");
}

/**
 * L'aperçu d'une page écrite à la main : le début de la première portée, plus
 * grand que nature plutôt que toute la page en poussière. Le dessin de la page
 * (manuscrit.js) cadre sur toute la largeur ; on recadre ici sur le format de
 * la vignette, à gauche (la clé, les premières notes).
 */
function dessinerApercuPage(svg, cal, traits, ratio) {
  dessinerPage(svg, cal, traits, { compact: true, limite: 9 * cal.interligne });
  const [x, y, , h] = svg.getAttribute("viewBox").split(" ").map(Number);
  svg.setAttribute("viewBox", `${x} ${y} ${Math.round(h * ratio)} ${Math.round(h)}`);
  svg.setAttribute("preserveAspectRatio", "xMinYMid slice");
}

/**
 * @param deps {
 *   etat, ouvrir(id, vue), ouvrirIdee(p, options), ouvrirMorceau(p),
 *   ecouter(p, bouton), enLecture(bouton), arreter(), partagerMidi(p), exporterMidi(p),
 *   supprimer(p) (demande confirmation, puis supprime),
 *   calibration(modele), ideesParId(), etiquettes(), importer(fichiers),
 *   dateCourte(iso), resumeIdee(seq), nomModele(m), pastilleStatut(p), toast(texte)
 * }
 */
export function creerAccueil(deps) {
  const { etat, toast } = deps;
  const onglets = [...document.querySelectorAll("#onglets-accueil [role='tab']")];
  const feuille = $("feuille-actions");
  let actionsDe = null;       // l'id de la partition dont la feuille est ouverte
  let boutonEcoute = null;    // le « Écouter » de la feuille, tant qu'elle est ouverte
  let refocaliser = null;     // { id, classe } : où remettre le focus après avoir touché une étoile (la liste est redessinée)

  etat.onglet = ONGLETS.includes(lirePref(CLE_ONGLET)) ? lirePref(CLE_ONGLET) : "carnet";
  etat.filtrePages = "tout";

  const recherche = () => $("recherche").value.trim().toLowerCase();
  const surRecherche = (p) => { const q = recherche(); return !q || texteDe(p).includes(q); };

  // ---------------------------------------------------------------------------
  // Les onglets
  // ---------------------------------------------------------------------------

  function choisirOnglet(nom, { focus = false } = {}) {
    if (!ONGLETS.includes(nom)) nom = "carnet";
    etat.onglet = nom;
    ecrirePref(CLE_ONGLET, nom);
    for (const t of onglets) {
      const actif = t.dataset.onglet === nom;
      t.setAttribute("aria-selected", String(actif));
      t.tabIndex = actif ? 0 : -1;
      if (actif && focus) t.focus();
    }
    for (const n of ONGLETS) $(`onglet-${n}`).hidden = n !== nom;
    // La recherche ne sert pas dans les réglages (la feuille de style la masque).
    document.querySelector(".barre-haut").dataset.onglet = nom;
    afficher();
    window.scrollTo({ top: 0 });
  }

  function brancherOnglets() {
    for (const t of onglets) t.addEventListener("click", () => choisirOnglet(t.dataset.onglet));
    // Le clavier suit le motif des onglets : flèches pour passer de l'un à l'autre.
    $("onglets-accueil").addEventListener("keydown", (e) => {
      const i = ONGLETS.indexOf(etat.onglet);
      const cible = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ONGLETS.length - 1 }[e.key];
      if (cible === undefined) return;
      e.preventDefault();
      choisirOnglet(ONGLETS[(cible + ONGLETS.length) % ONGLETS.length], { focus: true });
    });
    // « Portée », en haut : le carnet.
    $("aller-biblio").addEventListener("click", () => choisirOnglet("carnet"));
  }

  // ---------------------------------------------------------------------------
  // La recherche
  // ---------------------------------------------------------------------------

  function ouvrirRecherche() {
    if (etat.onglet === "reglages") choisirOnglet("carnet");
    $("recherche-zone").hidden = false;
    $("chercher").setAttribute("aria-expanded", "true");
    $("recherche").focus();
  }

  function fermerRecherche() {
    $("recherche-zone").hidden = true;
    $("chercher").setAttribute("aria-expanded", "false");
    if ($("recherche").value) { $("recherche").value = ""; afficher(); }
    $("chercher").focus();
  }

  function brancherRecherche() {
    $("chercher").addEventListener("click", () => ($("recherche-zone").hidden ? ouvrirRecherche() : fermerRecherche()));
    $("fermer-recherche").addEventListener("click", fermerRecherche);
    $("recherche").addEventListener("input", afficher);
    $("recherche").addEventListener("keydown", (e) => { if (e.key === "Escape") fermerRecherche(); });
  }

  // ---------------------------------------------------------------------------
  // Les vignettes
  // ---------------------------------------------------------------------------

  /** La vignette d'une partition : ses notes en barres, la frise d'un morceau, ou sa page. */
  function apercuDe(p, classe, ratio) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", classe);
    svg.setAttribute("aria-hidden", "true");
    if (p.type === "idee") {
      dessinerApercu(svg, p.sequence);
      // Un mémo vocal sans note : le micro, plutôt qu'un cadre vide.
      if (!svg.firstChild && p.memo) {
        svg.setAttribute("viewBox", "0 0 56 46");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.style.color = "var(--gris)";
        svg.innerHTML = '<use href="#i-micro" x="16" y="11" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>';
      }
    } else if (p.type === "morceau") dessinerApercuMorceau(svg, p, deps.ideesParId());
    else if (p.apercu && p.modele) {
      // Le cadre réel de la vignette (il change d'un écran à l'autre) ; à défaut, celui qu'on attendait.
      deps.calibration(p.modele).then((cal) => {
        const r = svg.getBoundingClientRect();
        dessinerApercuPage(svg, cal, p.apercu, r.width && r.height ? r.width / r.height : ratio);
      }).catch(() => {});
    }
    return svg;
  }

  /** Les petits boutons d'une ligne : l'étoile (un toucher) et « ••• » (la feuille d'actions). */
  function boutonFavori(p) {
    const b = el("button", "favori");
    b.type = "button";
    b.setAttribute("aria-pressed", String(!!p.favori));
    b.setAttribute("aria-label", p.favori ? `Retirer « ${p.titre} » des favoris` : `Mettre « ${p.titre} » en favori`);
    b.innerHTML = ico(p.favori ? "etoile-pleine" : "etoile");
    b.addEventListener("click", () => { refocaliser = { id: p.id, classe: "favori" }; basculerFavori(p); });
    return b;
  }

  function boutonPlus(p) {
    const b = el("button", "plus");
    b.type = "button";
    b.setAttribute("aria-label", `Actions pour « ${p.titre} »`);
    b.setAttribute("aria-haspopup", "dialog");
    b.innerHTML = ico("plus-actions");
    // La feuille rend elle-même le focus à ce bouton en se fermant.
    b.addEventListener("click", () => ouvrirActions(p));
    return b;
  }

  const basculerFavori = (p) => etat.stockage.modifier(p.id, { favori: !p.favori, modifieLe: new Date().toISOString() });
  const ouvrirPartition = (p) => deps.ouvrir(p.id, p.statut === "prete" ? "lecteur" : "atelier");

  // ---------------------------------------------------------------------------
  // Le carnet : tout, en lignes compactes
  // ---------------------------------------------------------------------------

  function correspondFiltre(p) {
    if (etat.etiquette && !(p.etiquettes || []).includes(etat.etiquette)) return false;
    switch (etat.filtre) {
      case "favori": return !!p.favori;
      case "idee": case "morceau": return p.type === etat.filtre;
      case "partition": return !p.type;
      default: return true;
    }
  }

  /** Ce qui précède la date : le genre, puis ce qu'on sait de la pièce. */
  function genreEtResume(p) {
    if (p.type === "idee") return ["Idée", deps.resumeIdee(p.sequence)];
    if (p.type === "morceau") return ["Morceau", (p.blocs || []).map((b) => b.nom).join(", ")];
    return [p.statut === "prete" ? "Partition prête" : "Partition", deps.nomModele(p.modele)];
  }

  /** Mémo, étiquettes, note en abrégé : une seule ligne, discrète. */
  function ligneAide(p) {
    if (!((p.etiquettes || []).length || p.memo || p.note)) return null;
    const l = el("span", "ligne-aide");
    if (p.memo) { const m = el("span", "aide-memo"); m.innerHTML = `${ico("micro", "s")}${echapper(p.memo.duree)} s`; l.appendChild(m); }
    for (const t of p.etiquettes || []) l.appendChild(el("span", "aide-etiquette", "# " + t));
    if (p.note) l.appendChild(el("span", "aide-note", p.note.length > 60 ? p.note.slice(0, 60) + "…" : p.note));
    return l;
  }

  function creerLigne(p, groupe) {
    const ligne = el("article", "ligne-carnet");
    ligne.dataset.id = p.id;
    const ouvrir = el("button", "ligne-ouvrir");
    ouvrir.type = "button";
    ouvrir.setAttribute("aria-label", `Ouvrir « ${p.titre} »`);
    ouvrir.addEventListener("click", () => ouvrirPartition(p));

    const texte = el("span", "ligne-texte");
    texte.appendChild(el("span", "ligne-titre", p.titre));
    const meta = el("span", "ligne-meta");
    // « À relire » : le seul état qui demande quelque chose ; une idée n'en a pas.
    if (!p.type && p.statut !== "prete") meta.appendChild(el("span", "pastille p-doute", "À relire"));
    const [genre, resume] = genreEtResume(p);
    const date = groupe ? quand(p.modifieLe, groupe) : deps.dateCourte(p.modifieLe);
    // Avec « À relire » devant, le mot « Partition » n'apprend rien : la place sert à la date.
    meta.appendChild(el("span", "ligne-quand", [meta.firstChild ? "" : genre, resume, date].filter(Boolean).join(" · ")));
    texte.appendChild(meta);
    const aide = ligneAide(p);
    if (aide) texte.appendChild(aide);

    ouvrir.append(apercuDe(p, "apercu", 56 / 46), texte);
    ligne.append(ouvrir, boutonFavori(p), boutonPlus(p));
    return ligne;
  }

  function rendreFiltres() {
    for (const b of document.querySelectorAll("#filtres-carnet [data-filtre]")) b.setAttribute("aria-pressed", String(b.dataset.filtre === etat.filtre));
    const toutes = deps.etiquettes();
    if (etat.etiquette && !toutes.includes(etat.etiquette)) etat.etiquette = null;
    const zone = $("filtres-etiquettes");
    zone.textContent = "";
    for (const t of toutes) {
      const b = el("button", "puce", "# " + t);
      b.type = "button";
      b.dataset.etiquette = t;
      b.setAttribute("aria-pressed", String(t === etat.etiquette));
      zone.appendChild(b);
    }
  }

  function rendreCarnet() {
    const vide = !!etat.stockage && etat.partitions.length === 0;
    // Pendant une recherche, les résultats prennent la place : la carte « Noter une idée » revient avec la liste complète.
    $("capture").hidden = !!recherche();
    // Tant que la bibliothèque s'ouvre, rien : l'accueil des premières fois ne doit pas clignoter.
    $("vide").hidden = !vide;
    $("filtres-carnet").hidden = !etat.stockage || vide;
    rendreFiltres();
    const liste = $("liste");
    liste.textContent = "";
    const q = recherche();
    const visibles = etat.partitions.filter((p) => correspondFiltre(p) && surRecherche(p));
    $("aucun").hidden = !(etat.partitions.length > 0 && visibles.length === 0);
    let avant = null;
    for (const p of visibles) {
      // Sans recherche, le carnet se découpe par date (il est trié du plus récent au plus ancien).
      const per = q ? null : periode(p.modifieLe);
      if (per && per !== avant) {
        liste.appendChild(el("p", "surtitre groupe-date", per));
        avant = per;
      }
      liste.appendChild(creerLigne(p, per));
    }
  }

  // ---------------------------------------------------------------------------
  // Les partitions : les pages écrites à la main, en cartes
  // ---------------------------------------------------------------------------

  function rendrePartitions() {
    for (const b of document.querySelectorAll("#filtres-pages [data-filtre-page]")) b.setAttribute("aria-pressed", String(b.dataset.filtrePage === etat.filtrePages));
    const pages = etat.partitions.filter((p) => !p.type);
    const aRelire = pages.filter((p) => p.statut !== "prete").length;
    $("resume-partitions").textContent = pages.length
      ? `${pages.length} page${pages.length > 1 ? "s" : ""} écrite${pages.length > 1 ? "s" : ""} à la main${aRelire ? ` · ${aRelire} à relire` : ""}`
      : "Les pages écrites à la main sur ta tablette apparaîtront ici.";
    $("filtres-pages").hidden = pages.length === 0;
    const visibles = pages.filter((p) => (etat.filtrePages === "tout" || p.statut === etat.filtrePages) && surRecherche(p));
    const liste = $("liste-partitions");
    liste.textContent = "";
    const aucune = $("aucune-partition");
    aucune.hidden = visibles.length > 0 || pages.length === 0;
    aucune.textContent = "Rien ne correspond. Essaie un autre mot, ou le filtre « Toutes ».";
    for (const p of visibles) {
      const carte = el("article", "carte-page");
      carte.dataset.id = p.id;
      const ouvrir = el("button", "carte-ouvrir");
      ouvrir.type = "button";
      ouvrir.setAttribute("aria-label", `Ouvrir « ${p.titre} »`);
      ouvrir.addEventListener("click", () => ouvrirPartition(p));
      const corps = el("span", "carte-corps");
      corps.append(el("span", "titre", p.titre), deps.pastilleStatut(p), el("span", "meta", [deps.nomModele(p.modele), quand(p.modifieLe, "Plus ancien")].filter(Boolean).join(" · ")));
      ouvrir.append(apercuDe(p, "apercu-grand", 2), corps);
      carte.append(ouvrir, boutonPlus(p));
      liste.appendChild(carte);
    }
  }

  // ---------------------------------------------------------------------------
  // Les morceaux : des cartes avec la frise, la durée, les parties
  // ---------------------------------------------------------------------------

  function rendreMorceaux() {
    const morceaux = etat.partitions.filter((p) => p.type === "morceau");
    $("resume-morceaux").textContent = morceaux.length
      ? `${morceaux.length} morceau${morceaux.length > 1 ? "x" : ""}`
      : "Des idées mises bout à bout : une intro, un couplet, un refrain…";
    const visibles = morceaux.filter(surRecherche);
    const liste = $("liste-morceaux");
    liste.textContent = "";
    const aucun = $("aucun-morceau");
    aucun.hidden = visibles.length > 0;
    aucun.textContent = morceaux.length ? "Rien ne correspond. Essaie un autre mot." : "Pas encore de morceau. Note quelques idées, puis assemble-les : intro, couplet, refrain.";
    const idees = deps.ideesParId();
    for (const p of visibles) {
      const carte = el("article", "carte-morceau");
      carte.dataset.id = p.id;
      const ouvrir = el("button", "carte-ouvrir");
      ouvrir.type = "button";
      ouvrir.setAttribute("aria-label", `Ouvrir « ${p.titre} »`);
      ouvrir.addEventListener("click", () => deps.ouvrir(p.id));
      const tete = el("span", "carte-tete");
      tete.append(el("span", "titre", p.titre), el("span", "mono duree", dureeMorceau(p, idees)));
      const parties = partiesDuMorceau(p);
      ouvrir.append(tete, apercuDe(p, "frise"), el("span", "parties", parties || "Aucune partie pour l'instant"));
      carte.append(ouvrir, boutonPlus(p));
      liste.appendChild(carte);
    }
  }

  // ---------------------------------------------------------------------------
  // La feuille d'actions (« ••• »)
  // ---------------------------------------------------------------------------

  function ouvrirActions(p) {
    actionsDe = p.id;
    boutonEcoute = null;
    $("feuille-titre").textContent = p.titre;
    const [genre, resume] = genreEtResume(p);
    const duree = p.type === "morceau" ? dureeMorceau(p, deps.ideesParId()) : "";
    $("feuille-sous").textContent = [genre, resume, duree, deps.dateCourte(p.modifieLe)].filter(Boolean).join(" · ");
    const liste = $("feuille-liste");
    liste.textContent = "";
    const ajouter = (icone, texte, agir, { plein = false, danger = false } = {}) => {
      const b = el("button", "btn" + (plein ? " btn-plein" : "") + (danger ? " btn-danger" : ""));
      b.type = "button";
      b.innerHTML = `${ico(icone, "s")}${texte}`;
      b.addEventListener("click", (ev) => agir(ev.currentTarget));
      liste.appendChild(b);
      return b;
    };
    // On ferme avant d'agir : l'action peut ouvrir un autre écran, ou le partage du téléphone.
    const puis = (f) => () => { fermerFeuille(feuille); f(); };
    if (p.type === "idee" || p.type === "morceau") {
      ajouter("carnet", "Ouvrir", puis(() => deps.ouvrir(p.id)), { plein: true });
      // L'écoute reste dans la feuille : « Arrêter » est là, sous le doigt ; fermer la feuille coupe le son.
      boutonEcoute = ajouter("lire", "Écouter", (b) => deps.ecouter(p, b));
      ajouter("partager", "Envoyer le MIDI", puis(() => deps.partagerMidi(p)));
    } else {
      ajouter("crayon", "Corriger", puis(() => deps.ouvrir(p.id, "atelier")), { plein: p.statut !== "prete" });
      ajouter("lire", "Écouter", puis(() => deps.ouvrir(p.id, "lecteur")), { plein: p.statut === "prete" });
      ajouter("telecharger", "MIDI", puis(() => deps.exporterMidi(p)));
    }
    ajouter(p.favori ? "etoile-pleine" : "etoile", p.favori ? "Retirer des favoris" : "Mettre en favori", puis(() => basculerFavori(p)));
    // Supprimer se faisait seulement de l'intérieur (le « ••• » de l'écran ouvert) :
    // depuis la liste, on ne trouvait pas comment. La question vient ensuite.
    ajouter("corbeille", "Supprimer", puis(() => deps.supprimer(p)), { danger: true });
    ouvrirFeuille(feuille);
  }

  function brancherFeuilleActions() {
    brancherFeuille(feuille, {
      surFermer: () => {
        if (boutonEcoute && deps.enLecture(boutonEcoute)) deps.arreter();
        actionsDe = null;
        boutonEcoute = null;
      },
    });
    $("feuille-fermer").addEventListener("click", () => fermerFeuille(feuille));
  }

  // ---------------------------------------------------------------------------
  // Le dépôt d'un PDF : sur tout l'accueil, la zone ne s'allume qu'au survol d'un fichier
  // ---------------------------------------------------------------------------

  function brancherDepot() {
    const zone = $("vue-biblio"), depot = $("depot");
    const fichiers = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => {
      if (!fichiers(e)) return;
      e.preventDefault();
      depot.classList.add("survol");
    }));
    zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) depot.classList.remove("survol"); });
    zone.addEventListener("drop", (e) => {
      if (!fichiers(e)) return;
      // Sans preventDefault, le navigateur quitterait Portée pour afficher le PDF.
      e.preventDefault();
      depot.classList.remove("survol");
      const pdf = [...e.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
      if (pdf.length) deps.importer(pdf); else toast("Dépose un fichier PDF exporté de la tablette.");
    });
    // Un <label> ne prend pas le focus de lui-même : sans cela, le clavier ne l'atteint pas.
    for (const l of document.querySelectorAll("#vue-biblio label[for][tabindex]")) {
      l.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $(l.htmlFor).click(); } });
    }
  }

  // ---------------------------------------------------------------------------
  // Les réglages qui n'appartiennent qu'à l'accueil
  // ---------------------------------------------------------------------------

  /** Ambiance de l'éditeur : Studio (sombre, par défaut) ou Papier. */
  function brancherAmbiance() {
    const boutons = [...document.querySelectorAll("#ambiance [data-ambiance]")];
    const montrer = () => {
      const v = ambianceStudio() ? "studio" : "papier";
      for (const b of boutons) b.setAttribute("aria-pressed", String(b.dataset.ambiance === v));
    };
    for (const b of boutons) b.addEventListener("click", () => {
      ecrirePref("portee:ambiance", b.dataset.ambiance);
      montrer();
      // Un navigateur qui refuse le stockage local (page claude.ai) ne retient pas le choix : on le dit.
      if (ambianceStudio() !== (b.dataset.ambiance === "studio")) toast("Ce navigateur ne garde pas les réglages : l'éditeur reste en " + (ambianceStudio() ? "Studio" : "Papier") + ".");
    });
    montrer();
  }

  /**
   * Montrer la gamme de l'idée sur le clavier de l'éditeur : oui par défaut (idee-clavier.js
   * le relit à chaque ouverture d'une idée ; seul "0" la coupe).
   */
  function brancherGammeClavier() {
    const b = $("reglage-gamme");
    const actif = () => lirePref("portee:clavier-gamme") !== "0";
    const montrer = () => b.setAttribute("aria-checked", String(actif()));
    b.addEventListener("click", () => {
      const voulu = !actif();
      ecrirePref("portee:clavier-gamme", voulu ? "1" : "0");
      montrer();
      if (actif() !== voulu) toast("Ce navigateur ne garde pas les réglages : la gamme reste " + (actif() ? "affichée" : "masquée") + " sur le clavier.");
    });
    montrer();
  }

  /** L'icône de la barre du haut : l'état de la synchronisation d'un coup d'œil. */
  function montrerSynchro({ nuage, ton, titre }) {
    const b = $("etat-synchro");
    b.innerHTML = ico(nuage ? "nuage" : "nuage-vide");
    b.dataset.ton = ton;
    b.title = titre;
    b.setAttribute("aria-label", `${titre} (ouvrir les réglages)`);
  }

  // ---------------------------------------------------------------------------
  // Tout redessiner
  // ---------------------------------------------------------------------------

  /** Dessine l'onglet visible (les autres se dessinent quand on y va). */
  function afficher() {
    if (etat.onglet === "carnet") rendreCarnet();
    else if (etat.onglet === "partitions") rendrePartitions();
    else if (etat.onglet === "morceaux") rendreMorceaux();
    // Sans partition, rien à exporter ni à sauvegarder (restaurer reste là).
    $("tout-midi").hidden = $("sauvegarder").hidden = etat.partitions.length === 0;
    // La feuille ouverte sur une partition qui vient de disparaître (une autre fenêtre l'a supprimée) se ferme.
    if (actionsDe && feuille.open && !etat.partitions.some((p) => p.id === actionsDe)) fermerFeuille(feuille);
    if (refocaliser) {
      const { id, classe } = refocaliser;
      refocaliser = null;
      const cible = document.querySelector(`#vue-biblio [data-id="${CSS.escape(id)}"] .${classe}`);
      if (cible && document.activeElement === document.body) cible.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Les branchements
  // ---------------------------------------------------------------------------

  brancherOnglets();
  brancherRecherche();
  brancherFeuilleActions();
  brancherDepot();
  brancherAmbiance();
  brancherGammeClavier();

  // Noter une idée : trois entrées, dans l'éditeur. Le mode « chanter » est une option
  // que l'éditeur sait lire ; sans lui, l'éditeur s'ouvre comme pour « Jouer ».
  $("nouvelle-idee").addEventListener("click", () => deps.ouvrirIdee(null, { mode: "clavier" }));
  $("noter-chant").addEventListener("click", () => deps.ouvrirIdee(null, { mode: "chanter" }));
  // Fredonner tout de suite : une idée neuve, le mémo qui enregistre déjà.
  $("nouveau-memo").addEventListener("click", () => deps.ouvrirIdee(null, { memo: true }));
  $("vide-idee").addEventListener("click", () => deps.ouvrirIdee(null, { mode: "clavier" }));
  $("nouveau-morceau").addEventListener("click", () => deps.ouvrirMorceau(null));

  // Les filtres : un seul à la fois, plus une étiquette.
  $("filtres-carnet").addEventListener("click", (e) => {
    const f = e.target.closest("[data-filtre]");
    if (f) { etat.filtre = f.dataset.filtre; afficher(); return; }
    const t = e.target.closest("[data-etiquette]");
    if (t) { etat.etiquette = etat.etiquette === t.dataset.etiquette ? null : t.dataset.etiquette; afficher(); }
  });
  $("filtres-pages").addEventListener("click", (e) => {
    const f = e.target.closest("[data-filtre-page]");
    if (f) { etat.filtrePages = f.dataset.filtrePage; afficher(); }
  });

  // L'état de la synchronisation mène aux réglages.
  $("etat-synchro").addEventListener("click", () => { choisirOnglet("reglages"); $("rg-synchro").scrollIntoView({ block: "start" }); });

  choisirOnglet(etat.onglet);
  return { afficher, choisirOnglet, montrerSynchro };
}
