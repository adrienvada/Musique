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
import { dessinerApercu, dessinerApercuMorceau, dessinerApercuPage } from "./apercus.js";
import { assembler, sourceDuMorceau } from "./morceau.js";
import { indexerParPas, pasParMesure, pasParTemps } from "./sequence.js";
import { voixCompletes } from "./harmonie.js";
import { creerEcoute } from "./ecoute.js";
import { libelleLecture } from "./atelier.js";
import { expliquer } from "./erreurs.js";
import { compteParSorte, sorteDe } from "./garde.js";
import { ico } from "./icones.js";
import { $, annoncer, dateCourte, echapper, el, formaterDate, heure, pluriel } from "./ui.js";
import { ambianceStudio, lirePref, ecrirePref } from "./preferences.js";
import { brancherFeuille, fermerFeuille, ouvrirFeuille } from "./feuilles.js";
import { estCopieDeConflit } from "./conflits.js";

const NS = "http://www.w3.org/2000/svg";
export const ONGLETS = ["carnet", "partitions", "morceaux", "reglages"];
const CLE_ONGLET = "portee:onglet";

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
  if (groupe === "Aujourd'hui" || groupe === "Hier") return heure(iso);
  // Les formats faits une fois (ui.js) : un carnet d'un an en demandait des centaines par dessin (I9).
  if (groupe === "Cette semaine") return `${formaterDate(d, { weekday: "short" })} ${heure(iso)}`;
  return formaterDate(d, { day: "numeric", month: "short" });
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

/** « 12 notes · ♩ 90 » : ce qu'on sait d'une idée sans l'ouvrir. */
function resumeIdee(seq) {
  if (!seq) return "";
  const notes = seq.pistes.reduce((n, p) => n + p.notes.length, 0);
  return `${pluriel(notes, "note")} · ♩ ${seq.tempo}`;
}

/** Le nom du modèle de papier d'une page (« Piano, large »). */
function nomModele(m) {
  return { "melodie-large": "Mélodie, large", "melodie-standard": "Mélodie", "piano-large": "Piano, large", "piano-standard": "Piano" }[m] || m || "";
}

/**
 * « À choisir » : la version de l'autre appareil d'une partition (une copie
 * de conflit, D4), qui attend que tu tranches depuis son « ••• ».
 */
const pastilleConflit = () => {
  const s = el("span", "pastille p-conflit", "À choisir");
  s.title = "La version de l'autre appareil : garde celle-ci, les deux, ou l'autre (•••)";
  return s;
};

/** La pastille d'une carte : le genre (idée, morceau), ou l'état d'une page lue. */
function pastilleStatut(p) {
  const restants = (p.doutes || []).filter((d) => !d.leve).length;
  if (estCopieDeConflit(p)) return pastilleConflit();
  if (p.type === "idee") return el("span", "pastille p-idee", "Idée");
  if (p.type === "morceau") return el("span", "pastille p-morceau", "Morceau");
  if (p.statut === "prete") return el("span", "pastille p-ok", "Prête");
  return el("span", "pastille p-doute", restants ? `À relire · ${pluriel(restants, "doute")}` : "À relire");
}

/**
 * Le nom d'une ligne ou d'une carte pour le lecteur d'écran : « Ouvrir « Ma
 * ballade » », puis tout ce qu'elle montre (son état, sa date, ses
 * étiquettes…). Avec « Ouvrir « titre » » seul, il perdait « À relire ·
 * 14:03 » (audit du 04/10, I11). Il commence toujours par « Ouvrir
 * « titre » » : la commande vocale et les essais s'y fient. « ♩ 90 » se lit
 * « tempo 90 » : le signe se lit mal, ou pas du tout.
 * @param {string} titre
 * @param {Array<string | null | undefined | false>} parties
 */
export const nomDeLigne = (titre, parties) => [`Ouvrir « ${titre} »`, ...parties.filter(Boolean).map((t) => String(t).replace(/♩ ?/g, "tempo "))].join(", ");

/** « 2 idées et 3 partitions », ou « Rien ne correspond » : ce qu'une recherche ou un filtre laisse voir. */
export function compteVisible(liste) {
  const sortes = { idee: 0, morceau: 0, partition: 0 };
  for (const p of liste) sortes[sorteDe(p)]++;
  return compteParSorte(sortes).texte || "Rien ne correspond";
}

/** Toutes les étiquettes de la bibliothèque, les plus employées d'abord (le carnet, l'éditeur d'idée). */
export function toutesEtiquettes(partitions) {
  const compte = new Map();
  // Une fiche abîmée (des étiquettes qui ne sont pas une liste) vidait tout le
  // carnet (audit, S6) : le stockage les remet en forme, et ceci ne casse plus.
  for (const p of partitions) {
    for (const t of Array.isArray(p.etiquettes) ? p.etiquettes : []) if (typeof t === "string" && t) compte.set(t, (compte.get(t) || 0) + 1);
  }
  return [...compte].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).map(([t]) => t);
}

/**
 * @param deps {
 *   stockage() → le stockage ouvert, partitions() → la bibliothèque,
 *   panneaux { reculer(), aLaRacine() } (ceux de la tablette, dans l'onglet Partitions),
 *   transport (pour écouter depuis une carte),
 *   ouvrir(id, vue), ouvrirIdee(p, options), ouvrirMorceau(p),
 *   partagerMidi(p), exporterMidi(p),
 *   supprimer(p) (demande confirmation, puis supprime),
 *   calibration(modele, version), ideesParId(), importer(fichiers), toast(texte),
 *   afficherReglages() (les Réglages relisent ce qui garde la bibliothèque, sauvegarde-ui.js),
 *   versions (versions-ui.js : la copie de conflit, les versions précédentes),
 *   suggestionsPour(id) → combien de suggestions de Claude attendent (suggestions-ui.js)
 * }
 */
export function creerAccueil(deps) {
  const { toast } = deps;
  // L'état de l'accueil est à lui (avant, il l'écrivait dans celui de l'appli, audit du 04/10, T3).
  const etat = {
    onglet: ONGLETS.includes(lirePref(CLE_ONGLET)) ? lirePref(CLE_ONGLET) : "carnet",
    filtre: "tout",       // filtre du carnet : tout, idee, partition, morceau, favori
    etiquette: null,      // filtre par étiquette (carnet)
    filtrePages: "tout",  // filtre de l'onglet Partitions : tout, a-relire, prete
  };
  const partitions = () => deps.partitions();
  // Les cartes ont leur écoute (ecoute.js) : la clé est le bouton touché, le même bouton arrête.
  const ecoute = creerEcoute(deps.transport);
  const onglets = [...document.querySelectorAll("#onglets-accueil [role='tab']")];
  const feuille = $("feuille-actions");
  let actionsDe = null;       // l'id de la partition dont la feuille est ouverte
  let boutonEcoute = null;    // le « Écouter » de la feuille, tant qu'elle est ouverte
  let refocaliser = null;     // { id, classe } : où remettre le focus après avoir touché une étoile (la liste est redessinée)
  let visibles = [];          // ce que l'onglet ouvert montre (après filtres et recherche), pour le dire

  const recherche = () => $("recherche").value.trim().toLowerCase();
  const surRecherche = (p) => { const q = recherche(); return !q || texteDe(p).includes(q); };

  // ---------------------------------------------------------------------------
  // Les onglets
  // ---------------------------------------------------------------------------

  /** Un onglet de l'accueil ; `dessiner: false` quand l'écran sera dessiné juste après (montrer). */
  function choisirOnglet(nom, { focus = false, dessiner = true } = {}) {
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
    if (!dessiner) return;
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
    clearTimeout(minuterieRecherche);
    if ($("recherche").value) { $("recherche").value = ""; afficher(); }
    $("chercher").focus();
  }

  // Ce que la recherche trouve se dit quand on s'arrête de taper, en une phrase (I11) : le carnet
  // ne se relit plus à chaque lettre. Assez tard pour ne pas couper la frappe.
  let minuterieDire = null;
  function direLeCompte({ attendre = 0 } = {}) {
    clearTimeout(minuterieDire);
    minuterieDire = setTimeout(() => annoncer(compteVisible(visibles)), attendre);
  }

  // La recherche se regroupe : on dessine 150 ms après la dernière lettre, pas à chaque
  // lettre. Avec un an d'idées, chaque lettre tapée coûtait 0,6 à 0,9 s au téléphone, et
  // la suivante attendait (audit du 04/10, I9).
  let minuterieRecherche = null;
  function brancherRecherche() {
    $("chercher").addEventListener("click", () => ($("recherche-zone").hidden ? ouvrirRecherche() : fermerRecherche()));
    $("fermer-recherche").addEventListener("click", fermerRecherche);
    $("recherche").addEventListener("input", () => {
      clearTimeout(minuterieRecherche);
      minuterieRecherche = setTimeout(() => {
        afficher();
        if (recherche()) direLeCompte({ attendre: 650 });
      }, 150);
    });
    $("recherche").addEventListener("keydown", (e) => { if (e.key === "Escape") fermerRecherche(); });
  }

  // ---------------------------------------------------------------------------
  // Les vignettes
  // ---------------------------------------------------------------------------

  // Le cadre réel des vignettes de page, par sorte de vignette (toutes celles d'une liste ont le
  // même) : mesuré une fois, pas une fois par vignette. Chaque mesure forçait une mise en page
  // de tout le carnet, entre deux vignettes dessinées (audit du 04/10, I9). Il change avec la fenêtre.
  const cadres = new Map();
  addEventListener("resize", () => cadres.clear());
  function ratioDu(svg, classe) {
    if (!cadres.has(classe)) {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return null; // pas encore à l'écran : on mesurera la prochaine fois
      cadres.set(classe, r.width / r.height);
    }
    return cadres.get(classe);
  }

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
      // La calibration de la version sur laquelle la page a été écrite (L9) : jamais celle d'une autre.
      deps.calibration(p.modele, p.versionModele).then((cal) => {
        dessinerApercuPage(svg, cal, p.apercu, ratioDu(svg, classe) || ratio);
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
    b.addEventListener("click", async () => {
      refocaliser = { id: p.id, classe: "favori" };
      await basculerFavori(p);
      // Le carnet ne se relit plus en entier (I11) : une phrase dit ce qui a changé.
      annoncer(p.favori ? `« ${p.titre} » n'est plus dans tes favoris.` : `« ${p.titre} » est dans tes favoris.`);
    });
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

  const basculerFavori = (p) => deps.stockage().modifier(p.id, { favori: !p.favori, modifieLe: new Date().toISOString() });
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
    if (p.type === "idee") return ["Idée", resumeIdee(p.sequence)];
    if (p.type === "morceau") return ["Morceau", (p.blocs || []).map((b) => b.nom).join(", ")];
    return [p.statut === "prete" ? "Partition prête" : "Partition", nomModele(p.modele)];
  }

  /** « Claude propose » : des suggestions de Claude attendent dans la partition (H3). */
  function marqueClaude(n) {
    const c = el("span", "aide-claude");
    c.innerHTML = ico("etincelle", "s");
    c.appendChild(el("span", "", n > 1 ? `Claude propose ${n} choses` : "Claude propose"));
    return c;
  }

  /** Mémo, étiquettes, note en abrégé : une seule ligne, discrète. Ce que Claude propose vient en tête (H3). */
  function ligneAide(p) {
    const propositions = deps.suggestionsPour ? deps.suggestionsPour(p.id) : 0;
    if (!((p.etiquettes || []).length || p.memo || p.note || propositions)) return null;
    const l = el("span", "ligne-aide");
    if (propositions) l.appendChild(marqueClaude(propositions));
    if (p.memo) { const m = el("span", "aide-memo"); m.innerHTML = `${ico("micro", "s")}${echapper(p.memo.duree)} s`; l.appendChild(m); }
    for (const t of p.etiquettes || []) l.appendChild(el("span", "aide-etiquette", "# " + t));
    if (p.note) l.appendChild(el("span", "aide-note", p.note.length > 60 ? p.note.slice(0, 60) + "…" : p.note));
    return l;
  }

  /** La même ligne d'aide, dite au lecteur d'écran (le micro et « # » ne se lisent pas). */
  function partiesAide(p) {
    const propositions = deps.suggestionsPour ? deps.suggestionsPour(p.id) : 0;
    return [
      propositions ? (propositions > 1 ? `Claude propose ${propositions} choses` : "Claude propose") : "",
      p.memo ? `mémo de ${p.memo.duree} s` : "",
      (p.etiquettes || []).length ? `${(p.etiquettes || []).length > 1 ? "étiquettes" : "étiquette"} ${(p.etiquettes || []).join(", ")}` : "",
      p.note ? (p.note.length > 60 ? p.note.slice(0, 60) + "…" : p.note) : "",
    ];
  }

  function creerLigne(p, groupe) {
    const ligne = el("article", "ligne-carnet");
    ligne.dataset.id = p.id;
    const ouvrir = el("button", "ligne-ouvrir");
    ouvrir.type = "button";
    ouvrir.addEventListener("click", () => ouvrirPartition(p));

    const texte = el("span", "ligne-texte");
    texte.appendChild(el("span", "ligne-titre", p.titre));
    const meta = el("span", "ligne-meta");
    // « À relire » : le seul état qui demande quelque chose ; une idée n'en a pas. La version de
    // l'autre appareil (D4) demande plus : « À choisir » prend sa place.
    if (estCopieDeConflit(p)) meta.appendChild(pastilleConflit());
    else if (!p.type && p.statut !== "prete") meta.appendChild(el("span", "pastille p-doute", "À relire"));
    // Une idée que Claude a notée dans une conversation (idee_ecrire) : elle le dit (H3, C5).
    else if (p.source && p.source.claude === true) {
      const c = el("span", "pastille p-claude", "Claude");
      c.title = "Notée par Claude dans une conversation";
      meta.appendChild(c);
    }
    meta.appendChild(el("span", "ligne-quand"));
    texte.appendChild(meta);
    const aide = ligneAide(p);
    if (aide) texte.appendChild(aide);
    ouvrir.append(apercuDe(p, "apercu", 56 / 46), texte);
    ligne.append(ouvrir, boutonFavori(p), boutonPlus(p));
    dater(ligne, p, groupe);
    return ligne;
  }

  /**
   * La date d'une ligne, et son nom qui la dit : sous son groupe (« 14:03 »
   * sous « Aujourd'hui »), ou en entier pendant une recherche. C'est la seule
   * chose qui change d'une ligne quand une recherche commence : on la refait
   * sans refaire la ligne (I9 : la première lettre redessinait tout).
   */
  function dater(ligne, p, groupe) {
    const meta = ligne.querySelector(".ligne-meta");
    const [genre, resume] = genreEtResume(p);
    const date = groupe ? quand(p.modifieLe, groupe) : dateCourte(p.modifieLe);
    // Avec « À relire » devant, le mot « Partition » n'apprend rien : la place sert à la date.
    const avecPastille = !meta.firstElementChild.classList.contains("ligne-quand");
    meta.querySelector(".ligne-quand").textContent = [avecPastille ? "" : genre, resume, date].filter(Boolean).join(" · ");
    const etats = [...meta.children].map((c) => (c.classList.contains("p-claude") ? "notée par Claude" : c.textContent));
    ligne.querySelector(".ligne-ouvrir").setAttribute("aria-label", nomDeLigne(p.titre, etats.concat(ligne.querySelector(".ligne-aide") ? partiesAide(p) : [])));
  }

  function rendreFiltres() {
    for (const b of document.querySelectorAll("#filtres-carnet [data-filtre]")) b.setAttribute("aria-pressed", String(b.dataset.filtre === etat.filtre));
    const toutes = toutesEtiquettes(partitions());
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

  /**
   * Les lignes déjà dessinées, par partition ({ cle, ligne }), et les titres
   * des groupes de dates. Une ligne dont rien de ce qu'elle montre n'a changé
   * est reprise telle quelle : toucher une étoile redessinait les 150 lignes
   * d'un an de carnet, 0,7 s au téléphone, et chaque lettre de la recherche
   * autant (audit du 04/10, I9). Ce qu'une ligne montre tient à sa fiche
   * (dont la date change à chaque écriture, stockage.js), à ce que Claude
   * propose et, pour un morceau, aux idées qu'il enchaîne (sa frise) ; son
   * groupe de dates ne change que sa date (`dater`).
   */
  let lignes = new Map(), groupes = new Map();
  function cleDeLigne(p, idees) {
    const c = [p.modifieLe, deps.suggestionsPour ? deps.suggestionsPour(p.id) : 0, p.titre, !!p.favori, p.statut || ""];
    if (p.type === "morceau") for (const b of p.blocs || []) c.push(idees.get(b.idee)?.modifieLe || "");
    return JSON.stringify(c);
  }

  /** Met les enfants de `conteneur` dans l'ordre de `voulus`, en ne bougeant que ce qui a changé. */
  function ranger(conteneur, voulus) {
    const gardes = new Set(voulus);
    for (const n of [...conteneur.children]) if (!gardes.has(n)) n.remove();
    let ici = conteneur.firstElementChild;
    for (const n of voulus) {
      if (n === ici) { ici = ici.nextElementSibling; continue; }
      conteneur.insertBefore(n, ici);
    }
  }

  function rendreCarnet() {
    const vide = !!deps.stockage() && partitions().length === 0;
    // Pendant une recherche, les résultats prennent la place : la carte « Noter une idée » revient avec la liste complète.
    $("capture").hidden = !!recherche();
    // Tant que la bibliothèque s'ouvre, rien : l'accueil des premières fois ne doit pas clignoter.
    $("vide").hidden = !vide;
    $("filtres-carnet").hidden = !deps.stockage() || vide;
    rendreFiltres();
    const q = recherche();
    visibles = partitions().filter((p) => correspondFiltre(p) && surRecherche(p));
    $("aucun").hidden = !(partitions().length > 0 && visibles.length === 0);
    const idees = deps.ideesParId();
    const voulus = [], dessinees = new Map(), titres = new Map();
    let avant = null;
    for (const p of visibles) {
      // Sans recherche, le carnet se découpe par date (il est trié du plus récent au plus ancien).
      const per = q ? null : periode(p.modifieLe);
      if (per && per !== avant) {
        const titre = groupes.get(per) || el("p", "surtitre groupe-date", per);
        titres.set(per, titre);
        voulus.push(titre);
        avant = per;
      }
      const cle = cleDeLigne(p, idees);
      const deja = lignes.get(p.id);
      let ligne;
      if (deja && deja.cle === cle) {
        ligne = deja.ligne;
        // La même ligne sous un autre groupe (minuit est passé, une recherche commence) : sa date seule.
        if (deja.groupe !== per) dater(ligne, p, per);
      } else ligne = creerLigne(p, per);
      dessinees.set(p.id, { cle, ligne, groupe: per });
      voulus.push(ligne);
    }
    // Les lignes qu'une recherche ou un filtre cache restent prêtes : elles reviennent sans se refaire.
    const presentes = new Set(partitions().map((p) => p.id));
    for (const [id, l] of lignes) if (!dessinees.has(id) && presentes.has(id)) dessinees.set(id, l);
    lignes = dessinees;
    groupes = titres;
    ranger($("liste"), voulus);
  }

  // ---------------------------------------------------------------------------
  // Les partitions : les pages écrites à la main, en cartes
  // ---------------------------------------------------------------------------

  function rendrePartitions() {
    for (const b of document.querySelectorAll("#filtres-pages [data-filtre-page]")) b.setAttribute("aria-pressed", String(b.dataset.filtrePage === etat.filtrePages));
    const pages = partitions().filter((p) => !p.type);
    const aRelire = pages.filter((p) => p.statut !== "prete").length;
    $("resume-partitions").textContent = pages.length
      ? `${pluriel(pages.length, "page écrite", "pages écrites")} à la main${aRelire ? ` · ${aRelire} à relire` : ""}`
      : "Les pages écrites à la main sur ta tablette apparaîtront ici.";
    $("filtres-pages").hidden = pages.length === 0;
    visibles = pages.filter((p) => (etat.filtrePages === "tout" || p.statut === etat.filtrePages) && surRecherche(p));
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
      ouvrir.addEventListener("click", () => ouvrirPartition(p));
      const corps = el("span", "carte-corps");
      const statut = pastilleStatut(p), meta = [nomModele(p.modele), quand(p.modifieLe, "Plus ancien")].filter(Boolean).join(" · ");
      corps.append(el("span", "titre", p.titre), statut, el("span", "meta", meta));
      const propositions = deps.suggestionsPour ? deps.suggestionsPour(p.id) : 0;
      if (propositions) corps.appendChild(marqueClaude(propositions));
      ouvrir.setAttribute("aria-label", nomDeLigne(p.titre, [statut.textContent, meta, propositions ? (propositions > 1 ? `Claude propose ${propositions} choses` : "Claude propose") : ""]));
      ouvrir.append(apercuDe(p, "apercu-grand", 2), corps);
      carte.append(ouvrir, boutonPlus(p));
      liste.appendChild(carte);
    }
  }

  // ---------------------------------------------------------------------------
  // Les morceaux : des cartes avec la frise, la durée, les parties
  // ---------------------------------------------------------------------------

  function rendreMorceaux() {
    const morceaux = partitions().filter((p) => p.type === "morceau");
    $("resume-morceaux").textContent = morceaux.length
      ? pluriel(morceaux.length, "morceau", "morceaux")
      : "Des idées mises bout à bout : une intro, un couplet, un refrain…";
    visibles = morceaux.filter(surRecherche);
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
      ouvrir.addEventListener("click", () => deps.ouvrir(p.id));
      const tete = el("span", "carte-tete");
      const duree = dureeMorceau(p, idees);
      tete.append(el("span", "titre", p.titre), el("span", "mono duree", duree));
      const parties = partiesDuMorceau(p);
      ouvrir.append(tete, apercuDe(p, "frise"), el("span", "parties", parties || "Aucune partie pour l'instant"));
      ouvrir.setAttribute("aria-label", nomDeLigne(p.titre, [duree && `durée ${duree}`, parties || "aucune partie pour l'instant"]));
      carte.append(ouvrir, boutonPlus(p));
      liste.appendChild(carte);
    }
  }

  // ---------------------------------------------------------------------------
  // Écouter depuis une carte, sans l'ouvrir
  // ---------------------------------------------------------------------------

  /** Écoute une idée (ou un morceau) depuis sa carte. Le même bouton arrête. */
  async function ecouter(p, bouton) {
    if (ecoute.cle === bouton) { ecoute.arreter(); return; }
    let source;
    if (p.type === "morceau") source = sourceDuMorceau(assembler(p, deps.ideesParId()));
    else {
      const seq = p.sequence;
      const { notesA, fin } = indexerParPas(voixCompletes(seq).flatMap((v) => v.notes));
      source = () => ({ tempo: seq.tempo, mesure: pasParMesure(seq), temps: pasParTemps(seq), fin, notesA });
    }
    const libelle = bouton.innerHTML;
    const lecture = ecoute.jouer(bouton, source, {
      // Les commandes de l'écran verrouillé (eveil.js, M8) : le titre, et « lecture » qui relance.
      titre: p.titre || (p.type === "morceau" ? "Morceau" : "Idée"), relancer: () => { if (ecoute.cle === null) bouton.click(); },
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

  // ---------------------------------------------------------------------------
  // La feuille d'actions (« ••• »)
  // ---------------------------------------------------------------------------

  function ouvrirActions(p) {
    actionsDe = p.id;
    boutonEcoute = null;
    $("feuille-titre").textContent = p.titre;
    const [genre, resume] = genreEtResume(p);
    const duree = p.type === "morceau" ? dureeMorceau(p, deps.ideesParId()) : "";
    $("feuille-sous").textContent = [genre, resume, duree, dateCourte(p.modifieLe)].filter(Boolean).join(" · ");
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
    // La version de l'autre appareil (D4) : trancher d'abord, c'est ce qu'elle attend.
    const aTrancher = estCopieDeConflit(p) && !!deps.versions;
    if (aTrancher) {
      const autre = deps.versions.autreDe(p);
      $("feuille-sous").textContent = autre
        ? `La version de l'autre appareil de « ${autre.titre} » : tu l'avais corrigée ici et là-bas. Laquelle garder ?`
        : "La version de l'autre appareil : l'autre version n'est plus dans ta bibliothèque.";
      ajouter("ok", "Garder celle-ci", puis(() => deps.versions.trancherConflit("celle-ci", p)), { plein: true });
      ajouter("copier", "Garder les deux", puis(() => deps.versions.trancherConflit("les-deux", p)));
      if (autre) ajouter("annuler", "Garder l'autre", puis(() => deps.versions.trancherConflit("l-autre", p)));
    }
    if (p.type === "idee" || p.type === "morceau") {
      ajouter("carnet", "Ouvrir", puis(() => deps.ouvrir(p.id)), { plein: true });
      // L'écoute reste dans la feuille : « Arrêter » est là, sous le doigt ; fermer la feuille coupe le son.
      boutonEcoute = ajouter("lire", "Écouter", (b) => ecouter(p, b));
      ajouter("partager", "Envoyer le MIDI", puis(() => deps.partagerMidi(p)));
    } else {
      // Une seule action principale : trancher, quand la version attend un choix.
      ajouter("crayon", "Corriger", puis(() => deps.ouvrir(p.id, "atelier")), { plein: !aTrancher && p.statut !== "prete" });
      ajouter("lire", "Écouter", puis(() => deps.ouvrir(p.id, "lecteur")), { plein: !aTrancher && p.statut === "prete" });
      ajouter("telecharger", "MIDI", puis(() => deps.exporterMidi(p)));
    }
    ajouter(p.favori ? "etoile-pleine" : "etoile", p.favori ? "Retirer des favoris" : "Mettre en favori", puis(() => basculerFavori(p)));
    // Les versions que garde la bibliothèque commune (D6) : avec la synchronisation seulement.
    if (deps.versions && deps.versions.possibles()) ajouter("historique", "Versions précédentes", puis(() => deps.versions.ouvrirVersions(p)));
    // Supprimer se faisait seulement de l'intérieur (le « ••• » de l'écran ouvert) :
    // depuis la liste, on ne trouvait pas comment. La question vient ensuite.
    ajouter("corbeille", "Supprimer", puis(() => deps.supprimer(p)), { danger: true });
    ouvrirFeuille(feuille);
  }

  function brancherFeuilleActions() {
    brancherFeuille(feuille, {
      surFermer: () => {
        if (boutonEcoute && ecoute.cle === boutonEcoute) ecoute.arreter();
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
      // Un PDF de la tablette devient une page à relire, un MIDI (de Live, par exemple) une idée.
      const pdf = [...e.dataTransfer.files].filter((f) => /\.(pdf|midi?)$/i.test(f.name) || f.type === "application/pdf" || /midi/i.test(f.type));
      if (pdf.length) deps.importer(pdf); else toast("Dépose un PDF exporté de la tablette, ou un fichier MIDI.");
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

  /**
   * L'icône de la barre du haut : l'état de la synchronisation d'un coup d'œil.
   * `vers` : la section des Réglages où elle mène (la synchronisation, ou la
   * sauvegarde quand c'est elle qu'il faut refaire).
   */
  function montrerSynchro({ nuage, ton, titre, vers = "rg-synchro" }) {
    const b = $("etat-synchro");
    b.innerHTML = ico(nuage ? "nuage" : "nuage-vide");
    b.dataset.ton = ton;
    b.dataset.vers = vers;
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
    // Les Réglages relisent ce qui garde la bibliothèque (sauvegarde-ui.js) : la place, la dernière sauvegarde.
    else if (deps.afficherReglages) deps.afficherReglages();
    // Sans partition, rien à exporter ni à sauvegarder (restaurer reste là).
    $("tout-midi").hidden = $("sauvegarder").hidden = partitions().length === 0;
    // La feuille ouverte sur une partition qui vient de disparaître (une autre fenêtre l'a supprimée) se ferme.
    if (actionsDe && feuille.open && !partitions().some((p) => p.id === actionsDe)) fermerFeuille(feuille);
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
  // Un filtre touché : ce qui reste se dit (I11), puisque la liste ne se relit plus.
  $("filtres-carnet").addEventListener("click", (e) => {
    const f = e.target.closest("[data-filtre]");
    if (f) { etat.filtre = f.dataset.filtre; afficher(); direLeCompte(); return; }
    const t = e.target.closest("[data-etiquette]");
    if (t) { etat.etiquette = etat.etiquette === t.dataset.etiquette ? null : t.dataset.etiquette; afficher(); direLeCompte(); }
  });
  $("filtres-pages").addEventListener("click", (e) => {
    const f = e.target.closest("[data-filtre-page]");
    if (f) { etat.filtrePages = f.dataset.filtrePage; afficher(); direLeCompte(); }
  });

  // L'état de la synchronisation mène aux réglages : à la section dont il parle.
  $("etat-synchro").addEventListener("click", (ev) => {
    choisirOnglet("reglages");
    ($(ev.currentTarget.dataset.vers || "rg-synchro") || $("rg-synchro")).scrollIntoView({ block: "start" });
  });

  choisirOnglet(etat.onglet);
  return {
    afficher, choisirOnglet, montrerSynchro,
    /** L'onglet ouvert : carnet, partitions, morceaux ou reglages. */
    get onglet() { return etat.onglet; },
    /**
     * « Précédent » dans l'accueil, du plus proche au plus lointain : la
     * recherche, un panneau de la tablette, puis le carnet. Rend true s'il a
     * reculé d'un pas ; au carnet, rien ne reste à défaire.
     */
    reculer() {
      if (!$("recherche-zone").hidden) { fermerRecherche(); return true; }
      if (deps.panneaux.reculer()) return true;
      if (etat.onglet !== "carnet") { choisirOnglet("carnet"); return true; }
      return false;
    },
    /** Le carnet, sans recherche ni panneau ouvert : la racine de l'appli. */
    aLaRacine: () => etat.onglet === "carnet" && $("recherche-zone").hidden && deps.panneaux.aLaRacine(),
  };
}
