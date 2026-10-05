/**
 * L'ÉCRAN « CORRIGER »
 *
 * Ta page à côté de ce que Portée a lu. Les doutes du lecteur viennent un
 * par un dans le panneau du bas (une loupe, une question, de gros
 * boutons) ; une note se touche dans la partition lue (ou se glisse) et se
 * corrige d'un geste : plus haut, plus bas, durée, point, altération,
 * silence, une de plus, supprimer. Tout se fait aussi au clavier et
 * s'annule. edition.js réécrit l'ABC, qui reste la seule source de vérité :
 * Adrien ne le lit pas, le texte reste dans le « mode avancé ».
 *
 * Une fabrique, comme l'éditeur d'idée et l'écran Morceau (audit du 04/10,
 * T3) : il vivait dans app.js, son état éparpillé entre `etat`, des
 * variables de module et la page (l'ABC en cours se lisait dans le champ du
 * mode avancé, « enregistrement en attente » dans le texte « … »). Ici, son
 * état est à lui ; la page ouverte (sa fiche, ses traits, ses
 * enregistrements) est partagée avec « Écouter » (page-ouverte.js).
 */
import { lirePartition, VERSION_LECTEUR } from "./lecteur/partition.js";
import { ajouterExemple, gabaritsVides } from "./lecteur/gabarits.js";
import { cadreAvis, dessinerPage, dessinerPassage } from "./manuscrit.js";
import * as ed from "./edition.js";
import { cibleVisible, completerDoutes, initialiserVise, modifEntre, poser, preparerDoutes, recalculerDoutes, suivre } from "./doutes.js";
import { avisPossible, direAvis, entreeDoute, issueAvis, messageDoute, OPTIONS_AVIS, PAS_SU_REPONDRE, validerAvis } from "./claude-doute.js";
import {
  afficherVueAtelier, avertissementAbc, dessinerCarteDoute, dessinerConsigne, dessinerPas, dessinerRelu, dessinerReperes,
  pastilleBarre, placerOnglets, PREFIXE_GRAVURE, pourGravure, proposerGeste, suivreDock, tempoInitial,
} from "./atelier.js";
import { fermerFeuille, ouvrirFeuille } from "./feuilles.js";
import { ecrirePref, lirePref } from "./preferences.js";
import { explication } from "./erreurs.js";
import { $, couleurDuJeton as couleur, dateRelative, el, gravureSansTabulation, pluriel, toast } from "./ui.js";

/**
 * Les durées au clavier : 1 double croche… 5 ronde (en croches). Par la place
 * de la touche, sans Maj (le « & » d'un AZERTY), ou par le chiffre tapé (Maj
 * et « & » sur un AZERTY, le pavé numérique). Avec Maj, la place ne compte
 * pas : sur un QWERTY, Maj et 3 donnent « # », le dièse.
 */
const DUREES_AU_CLAVIER = { Digit1: 0.5, Digit2: 1, Digit3: 2, Digit4: 4, Digit5: 8, Numpad1: 0.5, Numpad2: 1, Numpad3: 2, Numpad4: 4, Numpad5: 8 };
const DUREES_PAR_CHIFFRE = { 1: 0.5, 2: 1, 3: 2, 4: 4, 5: 8 };
const dureeDeLaTouche = (e) => (!e.shiftKey && DUREES_AU_CLAVIER[e.code]) || DUREES_PAR_CHIFFRE[e.key] || null;

/**
 * Le zoom de la partition lue (I14) : au doigt, une note gravée faisait 4 à
 * 7 px de large. De la largeur de l'écran (1) au triple ; − et + vont de cran
 * en cran, le pincement entre les deux. Retenu sur cet appareil.
 */
const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];
const bornerZoom = (z) => Math.min(ZOOMS.at(-1), Math.max(ZOOMS[0], Math.round(z * 100) / 100));

/**
 * @param deps {
 *   page (page-ouverte.js), piano, abcjs() → window.ABCJS, calibration(modele, version),
 *   ecouter(o) (atelier.js, creerEcoutePage), arreterEcoute(),
 *   valider() (« C'est bon » : la page est prête, on va l'écouter),
 *   supprimer() (la page ouverte, après la question),
 *   gabarits() → tes gabarits (L16), apprendre(g) → le nombre d'exemples neufs,
 *   aRelire(sauf) → les pages pas encore corrigées, relireEtDire(ids) (import-pdf.js),
 *   claude → window.claude sur claude.ai, sinon null (le second avis de Claude, H1)
 * }
 */
export function creerEcranAtelier(deps) {
  const { page, piano, abcjs, calibration } = deps;
  /** L'état de « Corriger », pour la page ouverte (repart à zéro à chaque ouverture). */
  const a = {
    ouvert: false,      // l'écran est affiché
    numeroPage: 0,      // la page de traits affichée
    douteActif: -1,
    selection: null,    // début, dans l'ABC, de la note choisie
    historique: [],     // l'état d'avant chaque geste (ABC et doutes), pour « Annuler »
    manuel: null,       // le doute que « Je corrige moi-même » règle en ce moment (son rang), ou null
    abc: "",            // le texte ABC en cours (le champ du mode avancé le montre)
    abcPrecedent: "",   // l'ABC avant la dernière saisie : de quoi suivre les doutes pendant qu'on tape
  };
  let objet = null;     // la partition lue, gravée par abcjs
  let dernierAvertissement = null; // le dernier reproche d'abcjs, dit une fois dans la console
  let minuterieGravure = null, minuterieEclat = null;
  let renduDoutes = 0;
  let dockEnOutils = false, dockReplie = false;
  let derniereNote = { alteration: "", lettre: "C", octave: 5 };
  // Ce que tes réponses apprennent à tes gabarits (L16), en attendant qu'on quitte la page.
  let lecons = [];
  let zoom = bornerZoom(Number(lirePref("portee:atelier-zoom")) || 1);
  let pincement = null; // deux doigts sur la partition lue : { d0, z0, x }
  // Le second avis de Claude (H1) : la fonction `sample` de claude.ai (null sur le site : la fonction
  // n'existe pas), si elle envoie des images, si Claude est caché pour cette visite (pas permis),
  // et l'avis de chaque doute de la page ouverte : { etat, ctl, abc, resultat, message }.
  let sample = null, imagesPossibles = false, claudeCache = false;
  const avis = new Map();

  const p = () => page.partition;
  const doutesDe = () => (p() && p().doutes) || [];
  const premierOuvert = () => doutesDe().findIndex((d) => !d.leve);
  const jetonChoisi = () => (a.selection === null ? null : ed.lireJeton(a.abc, a.selection));

  /** Une autre page s'ouvre : « Corriger » repart d'un historique neuf, sans note choisie (ce que la page d'avant a appris part d'abord). */
  function ouvrir() {
    apprendreDesReponses();
    arreterLesAvis();
    avis.clear();
    Object.assign(a, { numeroPage: 0, douteActif: -1, selection: null, historique: [], manuel: null });
  }

  /**
   * Une réponse qui t'apprend un signe (L16 : un signe inconnu, un triolet,
   * un chiffrage) : ses traits et ce qu'ils sont, retenus pour plus tard.
   * Pas tout de suite : une réponse annulée n'apprend rien. Un exemple faux
   * resterait dans tes gabarits (ils se réunissent d'un appareil à l'autre,
   * rien n'en sort), et ferait lire de travers les signes qui lui ressemblent.
   */
  function retenirLecon(d, r) {
    if (!r.apprendre || !r.apprendre.length || d.id === undefined) return;
    const traits = page.pages[(d.page || 1) - 1] || [];
    const exemples = r.apprendre
      .map((x) => ({ etiquette: x.etiquette, traits: (x.traits || []).map((k) => traits[k]).filter((t) => Array.isArray(t) && t.length) }))
      .filter((x) => x.traits.length);
    if (exemples.length) lecons.push({ fiche: p(), doute: d.id, reponse: r.texte, exemples });
  }

  /**
   * On quitte la page (ou on en ouvre une autre) : les réponses qui tiennent
   * encore apprennent leurs signes à tes gabarits, avec l'interligne de leur
   * page. S'il y a du neuf et des pages pas encore corrigées, un message
   * propose de les relire (jamais d'office).
   */
  async function apprendreDesReponses() {
    const aFaire = lecons;
    lecons = [];
    const tiennent = aFaire.filter((l) => { const d = (l.fiche.doutes || []).find((x) => x.id === l.doute); return d && d.leve && d.reponse === l.reponse; });
    if (!tiennent.length || !deps.apprendre) return;
    try {
      let g = gabaritsVides();
      for (const l of tiennent) {
        const cal = await calibration(l.fiche.modele, l.fiche.versionModele);
        for (const x of l.exemples) g = ajouterExemple(g, x.traits, x.etiquette, cal.interligne);
      }
      const neufs = await deps.apprendre(g);
      if (!neufs) return;
      const ids = deps.aRelire ? deps.aRelire(tiennent[0].fiche.id) : [];
      const appris = `Portée a appris ${neufs === 1 ? "un signe" : `${neufs} signes`} de ton écriture.`;
      if (ids.length) proposerGeste(`${appris} Relire ${ids.length > 1 ? `tes ${ids.length} pages pas encore corrigées` : "ta page pas encore corrigée"} ?`, "Relire", () => deps.relireEtDire(ids));
      else toast(appris, 4000);
    } catch (e) {
      console.error(e);
      toast(`Ce que tes réponses ont appris à Portée n'a pas pu être gardé : ${explication(e)}`, 7000);
    }
  }

  /** Le texte ABC de l'atelier ; il en garde la valeur d'avant pour suivre les doutes. */
  function poserAbc(texte) {
    a.abc = texte;
    a.abcPrecedent = texte;
    $("abc").value = texte;
  }

  /** « 2 pages · lue il y a 3 min », sous le titre. */
  function infosPage() {
    const n = page.pages.length || p().nbPages || 1;
    return `${pluriel(n, "page")} · lue ${dateRelative(p().creeLe)}`;
  }

  function majStatut() {
    $("statut-atelier").replaceChildren(pastilleBarre(p()));
  }

  async function afficher() {
    const x = p();
    a.ouvert = true;
    placerOnglets("vue-atelier");
    $("titre").value = x.titre;
    poserAbc(x.abc);
    $("infos-atelier").textContent = infosPage();
    $("enregistre").textContent = "";
    $("annuler").disabled = a.historique.length === 0;
    afficherVueAtelier();
    initialiserVise(x.doutes || [], x.abc, x.abcLu);
    try {
      if (await relireSiAncienne(x)) poserAbc(x.abc);
      await retrouverCibles(x);
      await dessinerManuscrit();
    } catch (e) {
      // Le modèle de la page n'est pas venu (le réseau ?) : la partition lue reste là pour corriger.
      console.error(e);
      toast(`Ta page n'a pas pu se dessiner : ${explication(e)}`, 7000);
    }
    if (p() !== x) return; // une autre page s'est ouverte entre-temps
    graver();
    poserZoom(zoom, { retenir: false });
    majOutils();
    afficherDoutes();
  }

  /** On quitte l'écran : la lecture s'arrête, ce qui attendait d'être enregistré part, et tes réponses apprennent leurs signes. */
  function fermer() {
    a.ouvert = false;
    clearTimeout(minuterieGravure);
    apprendreDesReponses();
    // Un avis que plus personne n'attend ne se paie pas : Claude s'arrête (sample : `signal`).
    arreterLesAvis();
    return page.vider();
  }

  /** Le titre que la lecture avait écrit dans l'ABC (T:), pour qu'une relecture écrive le même. */
  const titreLu = (x) => (x.abcLu.match(/^T:(.*)$/m) || [])[1] ?? x.titre;

  /**
   * Une page lue par un lecteur plus ancien (VERSION_LECTEUR) et que tu n'as
   * pas encore touchée : rien de corrigé, aucun doute réglé, pas « Prête ». Le
   * lecteur est déterministe : on la relit avec celui d'aujourd'hui, qui lit
   * mieux et pose ses questions avec des réponses fermées (L1 à L19). Une page
   * corrigée ou validée garde sa lecture : c'est la tienne (le banc d'essai
   * la prend pour vraie, L17). Rend true si elle a été relue.
   */
  async function relireSiAncienne(x) {
    const doutes = x.doutes || [];
    if ((x.versionLecteur || 1) >= VERSION_LECTEUR || x.abc !== x.abcLu || x.statut === "prete" || doutes.some((d) => d.leve) || !page.pages.length) return false;
    const cal = await calibration(x.modele, x.versionModele);
    const gabarits = deps.gabarits ? await deps.gabarits() : null;
    const res = lirePartition(page.pages, cal, { titre: titreLu(x), gabarits });
    if (p() !== x) return false; // une autre page s'est ouverte pendant la lecture
    page.changer({ abc: res.abc, abcLu: res.abc, doutes: preparerDoutes(res.doutes), versionLecteur: VERSION_LECTEUR, versionModele: cal.version || 1 }, { p: x });
    const bilan = res.doutes.length ? `${pluriel(res.doutes.length, "point")} à vérifier` : "rien à signaler";
    toast(`« ${x.titre} » a été relue par le lecteur d'aujourd'hui, qui lit mieux : ${bilan}.`, 6000);
    return true;
  }

  /**
   * Une partition lue avant que les doutes sachent où est leur note : tant que rien
   * n'a été corrigé, on relit ses traits (c'est déterministe) pour la leur donner.
   */
  async function retrouverCibles(x) {
    const doutes = x.doutes || [];
    if (!doutes.some((d) => !d.type) || x.abc !== x.abcLu || !page.pages.length) return;
    try {
      const titre = titreLu(x);
      const res = lirePartition(page.pages, await calibration(x.modele, x.versionModele), { titre });
      if (res.abc !== x.abcLu) return; // la lecture a changé depuis : on ne devine pas
      // Pour cette page-là, même si une autre s'est ouverte pendant la relecture.
      page.changer({ doutes: completerDoutes(doutes, res.doutes) }, { p: x });
    } catch (e) {
      console.warn("Les doutes de cette partition restent sans cible", e);
    }
  }

  async function dessinerManuscrit() {
    const x = p();
    const nav = $("pages-nav");
    nav.textContent = "";
    if (page.pages.length > 1) {
      page.pages.forEach((_, i) => {
        const b = el("button", "puce", `page ${i + 1}`);
        b.setAttribute("aria-pressed", String(i === a.numeroPage));
        b.addEventListener("click", () => { a.numeroPage = i; dessinerManuscrit().catch((e) => console.error(e)); });
        nav.appendChild(b);
      });
    }
    const cal = await calibration(x.modele, x.versionModele);
    if (p() !== x) return;
    const svg = $("page");
    dessinerPage(svg, cal, page.pages[a.numeroPage] || []);
    dessinerReperes($("reperes"), svg, cal, doutesDe(), a.numeroPage + 1, a.douteActif, ouvrirDoute);
  }
  /** Redessine la page sans attendre ; une page qui ne se dessine pas ne casse pas le geste. */
  const redessinerManuscrit = () => { dessinerManuscrit().catch((e) => console.error(e)); };

  function graver() {
    const lib = abcjs();
    const zone = $("gravure-atelier");
    if (!lib) { zone.textContent = "La gravure n'a pas pu se charger (connexion ?)."; return; }
    [objet] = lib.renderAbc(zone, pourGravure(a.abc), {
      responsive: "resize", add_classes: true, paddingtop: 0, paddingleft: 0, paddingright: 0,
      // Toucher une note la choisit ; la glisser change sa hauteur.
      clickListener: surClicNote, dragging: true, selectTypes: ["note"],
      selectionColor: couleur("--stylo", "#2B48B0"), dragColor: couleur("--stylo", "#2B48B0"),
    });
    // ← → choisissent la note et elle se dit (#note-choisie) : pas deux cents arrêts de tabulation sans nom (I11).
    gravureSansTabulation(zone, "La partition lue");
    surligner();
    // Un ABC que abcjs ne comprend pas (tapé à la main) : on le dit en français, sans jargon ; son détail va dans la console.
    const e = $("etat-abc");
    e.textContent = "";
    const avert = (objet && objet.warnings) || [];
    if (avert.length) {
      if (avert[0] !== dernierAvertissement) console.warn("Ce qu'abcjs reproche au texte ABC :", avert);
      e.append(el("span", "pastille p-doute", "Texte ABC à revoir"), " " + avertissementAbc(avert[0], avert.length - 1));
    }
    dernierAvertissement = avert[0] || null;
  }

  // ------------------------------------------------------------------------
  // Corriger au toucher
  // ------------------------------------------------------------------------

  /**
   * Où commence, dans l'ABC, la note qu'abcjs situe à `startChar`. Après une
   * barre (« |: c2 »), abcjs la fait commencer à l'espace qui la précède :
   * la note ne se lisait pas, et la toucher ne la choisissait pas.
   */
  function debutDeNote(startChar) {
    let debut = startChar - PREFIXE_GRAVURE.length;
    while (a.abc[debut] === " " || a.abc[debut] === "\t") debut++;
    return debut;
  }

  function surClicNote(abcelem, _numero, _classes, _analyse, glisse) {
    if (!abcelem || abcelem.el_type !== "note") return;
    const debut = debutDeNote(abcelem.startChar);
    const j = ed.lireJeton(a.abc, debut);
    if (!j) return;
    // abcjs compte les degrés vers le bas : un glissé vers le haut est négatif.
    if (glisse && glisse.step) { appliquer(ed.deplacer(a.abc, j, -glisse.step), { entendre: true }); return; }
    a.selection = debut;
    majOutils();
    entendre(j);
  }

  /**
   * Surligne dans la partition lue : la note choisie ; à défaut, ce que vise le
   * doute ouvert (une note, ou toute la mesure), pour qu'on voie de quoi il parle.
   */
  function surligner() {
    const gravure = objet && objet.engraver;
    if (!gravure) return;
    const j = jetonChoisi();
    const d = doutesDe()[a.douteActif];
    const cible = j ? { debut: j.debut, fin: j.fin } : d && a.ouvert ? cibleVisible(d, a.abc) : null;
    try {
      // rangeHighlight commence par effacer la sélection d'avant : une plage vide (-1) suffit à tout effacer.
      if (cible) gravure.rangeHighlight(cible.debut + PREFIXE_GRAVURE.length, cible.fin + PREFIXE_GRAVURE.length);
      else gravure.rangeHighlight(-1, -1);
    } catch { /* gravure en cours */ }
  }

  /** Un instant, la note qu'une réponse vient de changer (puis on revient à ce qui est surligné d'ordinaire). */
  function eclat(debut, fin) {
    const gravure = objet && objet.engraver;
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
    $("dock-manuel").hidden = a.manuel === null;
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

  /**
   * Fait entendre la note choisie (ou l'accord), brièvement, telle qu'elle
   * sonne à sa place : l'armure, et les altérations écrites plus tôt dans la
   * mesure (le second fa de « ^F2 F2 » sonnait naturel, audit du 04/10, L19).
   */
  function entendre(j) {
    if (!j || j.type === "silence") return;
    const hauteurs = ed.hauteursMidiA(a.abc, j);
    piano.pret().then(() => hauteurs.forEach((h) => piano.note(h, 0.7, 80))).catch(() => {});
  }

  /** L'ABC et les doutes de la page, enregistrés un instant après le dernier geste (avec leur copie de maintenant). */
  function planifierSauvegarde() {
    page.changer({ abc: a.abc, ...(p().doutes ? { doutes: p().doutes } : {}) }, { delai: 800 });
  }

  /**
   * Les mesures de l'ABC d'aujourd'hui, recomptées (L13) : après la bonne
   * réponse à un doute, une mesure pouvait tomber à 11 croches sans que rien
   * ne le dise. Les doutes qu'il faut en plus s'ajoutent à la fin ; rend leurs
   * rangs.
   */
  function recalculer() {
    const x = p();
    if (!x) return [];
    const avant = doutesDe().length;
    const apres = recalculerDoutes(doutesDe(), a.abc);
    if (apres.length === avant) return [];
    x.doutes = apres;
    return apres.map((_, k) => k).slice(avant);
  }

  /** Une réponse qui complète une mesure (L15) règle aussi les doutes qu'elle tranche (`regle`, leurs numéros). */
  function reglerAussi(i, regle, reponse) {
    if (!regle || !regle.length) return;
    doutesDe().forEach((d, k) => {
      if (k !== i && !d.leve && d.id !== undefined && regle.includes(d.id)) { d.leve = true; d.reponse = reponse; }
    });
  }

  /**
   * Applique un geste : mémorise l'état d'avant, regrave, enregistre. Les doutes
   * suivent le texte qui bouge ; une réponse à un doute (`doute`) le règle dans
   * le même geste, avec ceux qu'elle tranche aussi (`regle`), pour
   * qu'« Annuler » défasse le tout. Puis les mesures se recomptent (L13) : si
   * la réponse en fausse une, son doute vient aussitôt.
   */
  function appliquer(res, { entendre: jouer = false, doute = null, reponse = "", regle = [], selectionner = true } = {}) {
    if (!res) return;
    deps.arreterEcoute();
    memoriser(a.abc);
    poserAbc(res.abc);
    suivre(doutesDe(), res.modif);
    // Réglés d'abord : le recompte ne propose que les autres lectures des doutes encore ouverts.
    if (doute !== null) {
      reglerAussi(doute, regle, reponse);
      marquer(doute, true, reponse);
    }
    const nouveaux = recalculer();
    if (doute !== null && nouveaux.length) a.douteActif = nouveaux[0];
    a.selection = !selectionner ? null : res.fin > res.debut ? res.debut : prochaineNote(res.abc, res.debut);
    graver();
    majOutils();
    planifierSauvegarde();
    if (doute !== null) {
      redessinerManuscrit();
      afficherDoutes().then(() => eclat(res.debut, res.fin));
    }
    if (jouer) entendre(jetonChoisi());
  }

  /**
   * L'état d'avant chaque geste, pour « Annuler » : l'ABC, et les doutes tels
   * qu'ils étaient, entiers. Avant, seuls leur état et leur note visée étaient
   * gardés : un geste d'armure décalait aussi la ligne que vise un autre doute
   * (`viseLigne`), et les propositions d'une mesure, qu'« Annuler » ne
   * remettait pas en place ; et les doutes ajoutés par le recompte des
   * mesures (L13) restaient.
   */
  function memoriser(abc = a.abc) {
    a.historique.push({ abc, doutes: structuredClone(doutesDe()), actif: a.douteActif });
    if (a.historique.length > 200) a.historique.shift();
    $("annuler").disabled = false;
  }

  function annuler() {
    const avant = a.historique.pop();
    if (avant === undefined) return;
    deps.arreterEcoute();
    poserAbc(avant.abc);
    if (p()) p().doutes = avant.doutes;
    // Défaire un geste pendant « Je corrige moi-même » n'en sort pas, tant que le doute reste ouvert.
    if (a.manuel !== null && doutesDe()[a.manuel] && !doutesDe()[a.manuel].leve) a.douteActif = a.manuel;
    else { a.manuel = null; a.douteActif = avant.actif; }
    if (a.selection !== null && !ed.lireJeton(avant.abc, a.selection)) a.selection = null;
    $("annuler").disabled = a.historique.length === 0;
    graver();
    majOutils();
    redessinerManuscrit();
    afficherDoutes();
    planifierSauvegarde();
  }

  /** Les débuts de toutes les notes et silences, dans l'ordre (d'après abcjs). */
  function positionsNotes() {
    const positions = new Set();
    for (const ligne of (objet && objet.lines) || []) {
      for (const portee of ligne.staff || []) {
        for (const voix of portee.voices || []) {
          for (const x of voix) if (x.el_type === "note" && !x.rest?.type?.startsWith("invisible")) positions.add(debutDeNote(x.startChar));
        }
      }
    }
    return [...positions].sort((u, v) => u - v);
  }

  function prochaineNote(abc, depuis) {
    const suivante = positionsNotes().find((x) => x >= depuis && ed.lireJeton(abc, x));
    if (suivante !== undefined) return suivante;
    let pos = depuis;
    while (pos < abc.length && !ed.lireJeton(abc, pos)) pos++;
    return pos < abc.length ? pos : null;
  }

  function choisirVoisine(sens) {
    const liste = positionsNotes();
    if (!liste.length) return;
    let i = a.selection === null ? (sens > 0 ? 0 : liste.length - 1) : liste.findIndex((x) => x === a.selection) + sens;
    i = Math.max(0, Math.min(liste.length - 1, i));
    a.selection = liste[i];
    surligner();
    majOutils();
    garderEnVue();
    entendre(jetonChoisi());
  }

  // ------------------------------------------------------------------------
  // Le zoom de la partition lue (I14)
  // ------------------------------------------------------------------------

  /** L'élément gravé de la note choisie (abcjs garde ce qu'il a surligné), ou null. */
  function elementChoisi() {
    const choisi = a.selection !== null && objet && objet.engraver && objet.engraver.selected && objet.engraver.selected[0];
    return (choisi && choisi.elemset && choisi.elemset[0]) || null;
  }

  /**
   * La note choisie reste en vue : au milieu du cadre, de côté (zoomée, la
   * partition défile), et entre la barre du haut et le panneau du bas.
   */
  function garderEnVue({ verticale = true } = {}) {
    const note = elementChoisi();
    if (!note || !a.ouvert) return;
    const cadre = $("cadre-lue");
    const rc = cadre.getBoundingClientRect(), rn = note.getBoundingClientRect();
    if (!rn.width && !rn.height) return; // la partition lue n'est pas montrée (« Ta page » seule)
    cadre.scrollLeft += rn.left + rn.width / 2 - (rc.left + rc.width / 2);
    if (!verticale) return;
    const barre = $("vue-atelier").querySelector(".barre-ecran");
    const haut = (barre ? barre.getBoundingClientRect().bottom : 0) + 8;
    const bas = window.innerHeight - $("dock-atelier").offsetHeight - 8;
    const n = note.getBoundingClientRect();
    if (n.bottom > bas) window.scrollBy({ top: n.bottom - bas });
    else if (n.top < haut) window.scrollBy({ top: n.top - haut });
  }

  /**
   * Pose le zoom. Sans note choisie, ce qui était au milieu du cadre (ou sous
   * les doigts, `centre`, en pixels depuis son bord gauche) y reste.
   */
  function poserZoom(z, { centre = null, retenir = true } = {}) {
    const neuf = bornerZoom(z);
    const cadre = $("cadre-lue");
    const c = centre ?? cadre.clientWidth / 2;
    const avant = { largeur: cadre.scrollWidth, gauche: cadre.scrollLeft };
    zoom = neuf;
    $("zoom-lue").style.setProperty("--zoom", String(zoom));
    $("zoom-val").textContent = `${Math.round(zoom * 100)} %`;
    $("zoom-moins").disabled = zoom <= ZOOMS[0];
    $("zoom-plus").disabled = zoom >= ZOOMS.at(-1);
    if (retenir) ecrirePref("portee:atelier-zoom", String(zoom));
    if (elementChoisi()) { garderEnVue(); return; }
    if (avant.largeur) cadre.scrollLeft = ((avant.gauche + c) * cadre.scrollWidth) / avant.largeur - c;
  }

  /** Le cran suivant (sens > 0) ou précédent du zoom. */
  function zoomer(sens) {
    const suivant = sens > 0 ? ZOOMS.find((z) => z > zoom + 1e-6) : ZOOMS.findLast((z) => z < zoom - 1e-6);
    if (suivant !== undefined) poserZoom(suivant);
  }

  /**
   * Pincer la partition lue l'agrandit. Les deux doigts restent à Portée :
   * abcjs prendrait leur glissé pour celui d'une note (il change sa hauteur).
   * Un pincement se suit jusqu'au dernier doigt levé ; la gravure repart
   * ensuite d'un état propre (abcjs avait vu le premier doigt se poser).
   */
  function brancherPincement(cadre) {
    const ecart = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const options = { capture: true, passive: true };
    cadre.addEventListener("touchstart", (e) => {
      if (e.touches.length < 2) return;
      e.stopPropagation();
      const rc = cadre.getBoundingClientRect();
      pincement = { d0: ecart(e.touches) || 1, z0: zoom, x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rc.left };
    }, options);
    cadre.addEventListener("touchmove", (e) => {
      if (!pincement) return;
      e.stopPropagation();
      if (e.touches.length >= 2) poserZoom((pincement.z0 * ecart(e.touches)) / pincement.d0, { centre: pincement.x, retenir: false });
    }, options);
    const lever = (e) => {
      if (!pincement) return;
      e.stopPropagation();
      if (e.touches.length) return;
      pincement = null;
      ecrirePref("portee:atelier-zoom", String(zoom));
      graver();
      garderEnVue();
    };
    cadre.addEventListener("touchend", lever, options);
    cadre.addEventListener("touchcancel", lever, options);
  }

  /** Plus de note choisie : le panneau du bas revient au doute. */
  function laisserLaNote() {
    a.selection = null;
    graver();
    majOutils();
  }

  /** Un geste de la barre d'outils ou du clavier. */
  function geste(nom, valeur) {
    const j = jetonChoisi();
    if (!j) { toast("Touche d'abord une note de la partition."); return; }
    const abc = a.abc;
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
    a.manuel = null;
    a.douteActif = leve ? prochainDoute(i) : i;
  }

  /** Ouvre un doute : sa carte en bas, son repère sur la page (la bonne page, s'il y en a plusieurs). */
  function ouvrirDoute(i) {
    const d = doutesDe()[i];
    if (!d) return;
    a.manuel = null;
    dockReplie = false;
    a.selection = null;
    a.douteActif = i;
    a.numeroPage = Math.max(0, Math.min((d.page || 1) - 1, Math.max(0, page.pages.length - 1)));
    redessinerManuscrit();
    majOutils();
    afficherDoutes();
  }

  /** Dessine le panneau du bas : une carte de doute, la consigne de « Je corrige moi-même », ou « Tout est relu ». */
  async function afficherDoutes() {
    const x = p();
    const doutes = doutesDe();
    const rendu = ++renduDoutes;
    if (a.douteActif >= doutes.length) a.douteActif = -1;
    // Tant qu'il reste un doute, on n'en laisse pas un autre à l'écran qu'un doute choisi.
    if (a.douteActif < 0 && a.manuel === null) { const o = premierOuvert(); if (o >= 0) a.douteActif = o; }
    const actif = a.douteActif;
    dessinerPas(doutes, actif, ouvrirDoute, a.manuel !== null);
    majStatut();
    let cal = null;
    try { cal = await calibration(x.modele, x.versionModele); } catch (e) { console.error(e); }
    if (rendu !== renduDoutes || p() !== x) return;
    const zone = $("doutes");
    if (a.manuel !== null) {
      const q = poser(doutes[a.manuel], a.abc);
      dessinerConsigne(zone, q.cible && q.cible.genre === "mesure" ? "Touche la note à corriger dans la mesure surlignée de la partition lue." : "Touche la note à corriger dans la partition lue.");
    } else if (actif >= 0) {
      const d = doutes[actif];
      const question = poser(d, a.abc);
      dessinerCarteDoute(zone, {
        doute: d, question, cal, traits: page.pages[(d.page || 1) - 1] || [],
        surReponse: (r) => repondre(actif, r),
        surRouvrir: () => leverDoute(actif, false),
        surMoiMeme: () => commencerManuel(actif),
        surVoulu: () => leverDoute(actif, true, "C'est voulu"),
        // Le second avis de Claude (H1) : sur claude.ai seulement, et pour une question à deux réponses fermées au moins.
        claude: etatClaude(d, actif, question),
        surDemander: () => demanderAvis(actif),
        surArreter: () => { const e = avis.get(cleAvis(d, actif)); if (e && e.etat === "attente") e.ctl.abort(); },
        surAppliquerAvis: () => appliquerAvis(actif),
      });
    } else {
      dessinerRelu(zone, { aucun: !doutes.length, surRevoir: () => ouvrirDoute(0), surValider: valider });
    }
    surligner();
  }

  /** Une réponse : le vrai geste d'edition.js sur la bonne note, puis le doute est réglé (et « Annuler » défait les deux). */
  function repondre(i, r) {
    const res = r.geste ? r.geste(a.abc) : null;
    if (r.geste && !res) { toast("Cette réponse ne s'applique plus : corrige la note toi-même."); afficherDoutes(); return; }
    retenirLecon(doutesDe()[i], r);
    if (res) appliquer(res, { doute: i, reponse: r.texte, regle: r.regle, selectionner: false });
    else {
      memoriser();
      reglerAussi(i, r.regle, r.texte);
      marquer(i, true, r.texte);
      a.selection = null;
      page.changer({ doutes: p().doutes });
      redessinerManuscrit(); afficherDoutes(); majOutils();
    }
    dockReplie = false;
    toast(r.fait, 2400);
  }

  /** « C'est voulu » ou « Rouvrir » : règle ou rouvre un doute sans toucher à l'ABC. */
  function leverDoute(i, leve, reponse = "") {
    memoriser();
    marquer(i, leve, reponse);
    if (leve) a.selection = null;
    page.changer({ doutes: p().doutes });
    redessinerManuscrit();
    afficherDoutes();
    majOutils();
  }

  /** « Je corrige moi-même » : la partition lue se montre, la note visée est choisie (ou la mesure, surlignée) et les outils apparaissent. */
  function commencerManuel(i) {
    const d = doutesDe()[i];
    a.manuel = i;
    a.douteActif = i;
    if (afficherVueAtelier() === "page") afficherVueAtelier("deux");
    const c = cibleVisible(d, a.abc);
    a.selection = c && c.genre === "note" ? c.debut : null;
    redessinerManuscrit();
    majOutils();
    afficherDoutes();
    // Zoomée, la partition lue défile de côté jusqu'à la note visée.
    garderEnVue({ verticale: false });
    // Une fois le panneau redimensionné (sa hauteur règle la marge du bas), on amène la partition lue sous la barre.
    setTimeout(() => $("zone-lue").scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    if (a.selection !== null) entendre(jetonChoisi());
  }

  /** Fin de « Je corrige moi-même » : le doute est réglé (`regle`), ou on revient à sa question. */
  function finirManuel(regle) {
    const i = a.manuel;
    if (i === null) return;
    if (regle) { leverDoute(i, true, "Corrigé à la main"); return; }
    a.manuel = null;
    a.selection = null;
    redessinerManuscrit();
    majOutils();
    afficherDoutes();
  }

  /** « C'est bon » : la page est prête (même s'il reste des doutes) ; on va l'écouter. */
  async function valider() {
    page.changer({ abc: a.abc, ...(p().doutes ? { doutes: p().doutes } : {}), statut: "prete" });
    await page.vider();
    deps.valider();
  }

  // ------------------------------------------------------------------------
  // Le second avis de Claude sur un doute (H1, claude.ai seulement)
  // ------------------------------------------------------------------------
  //
  // Claude voit le passage (une image, si cette vue en envoie), ce que le
  // lecteur a compris et la question fermée, et dit quelle réponse il
  // choisirait (claude-doute.js). Son avis se montre comme une proposition :
  // un toucher l'applique par le même chemin que ta réponse, jamais seul.
  // Demandé d'un geste, jamais au chargement ni en boucle ; un nouvel essai
  // ne part jamais tout seul.

  /** `sample`, une fois, sans rien demander à Adrien (l'accord vient au premier appel). Null : la fonction n'existe pas. */
  async function preparerClaude() {
    if (!deps.claude || typeof deps.claude.use !== "function") return;
    try {
      const s = await deps.claude.use("sample");
      if (!s || typeof s.json !== "function") return;
      sample = s;
      const limites = typeof s.limits === "function" ? await s.limits().catch(() => null) : null;
      imagesPossibles = !!(limites && limites.images);
      if (a.ouvert) afficherDoutes();
    } catch { /* pas de Claude ici : rien ne change */ }
  }

  /** L'avis d'un doute se retrouve par sa partition et son numéro (sa place, pour un doute d'avant les numéros). */
  const cleAvis = (d, i) => `${p() ? p().id : ""}:${d.id !== undefined ? d.id : `#${i}`}`;

  /** Ce que la carte du doute montre de Claude, ou null s'il n'est pas là. */
  function etatClaude(d, i, question) {
    if (!sample || claudeCache || d.leve) return null;
    const e = avis.get(cleAvis(d, i));
    const possible = avisPossible(question);
    if (!e) return possible ? { possible, etat: null } : null;
    if (e.etat === "pret") return { possible, etat: "pret", ...direAvis(e.resultat), applicable: e.resultat.rang !== null };
    return { possible, etat: e.etat, message: e.message };
  }

  function arreterLesAvis() {
    for (const e of avis.values()) if (e.etat === "attente") e.ctl.abort();
  }

  /** Claude n'est pas permis ici : sa fonction se cache, pour toute la visite. */
  function cacherClaude() {
    claudeCache = true;
    arreterLesAvis();
    avis.clear();
  }

  /**
   * L'image du passage (un PNG d'environ 1 100 pixels de côté : claude.ai la
   * ramène de toute façon vers 1,2 mégapixel), les têtes numérotées comme
   * dans le texte, ce que vise le doute encadré.
   */
  async function imageDuPassage(cal, traits, vue, tetes, cadre) {
    const echelle = Math.min(4, Math.max(1.5, 1100 / Math.max(vue.w, vue.h)));
    const canevas = document.createElement("canvas");
    canevas.width = Math.round(vue.w * echelle);
    canevas.height = Math.round(vue.h * echelle);
    dessinerPassage(canevas.getContext("2d"), cal, traits, { vue, echelle, tetes, cadre });
    return new Promise((ok) => canevas.toBlob((b) => ok(b), "image/png"));
  }

  /**
   * Ce qui part avec la question : le passage (les têtes que le lecteur y a
   * lues, de gauche à droite, relues sur la page : c'est déterministe), la
   * mesure en ABC, et l'image si cette vue en envoie.
   */
  async function preparerEntree(x, d) {
    const cal = await calibration(x.modele, x.versionModele);
    const traits = page.pages[(d.page || 1) - 1] || [];
    const vue = d.boite ? cadreAvis(cal, d.boite) : null;
    let tetes = [];
    if (vue && traits.length) {
      try {
        const lue = lirePartition([traits], cal, { titre: "passage" }).lues[0];
        tetes = (lue ? lue.tetes : [])
          .filter((t) => t.portee === d.portee && t.cx >= vue.x && t.cx <= vue.x + vue.w && t.cy >= vue.y && t.cy <= vue.y + vue.h)
          .sort((u, v) => u.cx - v.cx || u.cy - v.cy).slice(0, 32);
      } catch (e) { console.warn("Les têtes du passage ne se relisent pas : la question part sans elles.", e); }
    }
    const texte = entreeDoute({ doute: d, abc: a.abc, tetes, interligne: cal.interligne });
    const image = imagesPossibles && vue && traits.length ? await imageDuPassage(cal, traits, vue, tetes, d.boite) : null;
    return { texte, image };
  }

  /** « Demander à Claude » : la question part, « Claude regarde… » jusqu'à son avis, qu'on peut arrêter. */
  async function demanderAvis(i) {
    const x = p(), d = doutesDe()[i];
    if (!sample || claudeCache || !x || !d) return;
    const question = poser(d, a.abc);
    if (!avisPossible(question)) return;
    const cle = cleAvis(d, i);
    const e = { etat: "attente", ctl: new AbortController(), abc: a.abc, resultat: null, message: "" };
    avis.set(cle, e);
    afficherDoutes();
    try {
      const entree = await preparerEntree(x, d);
      // Une copie de la question telle qu'elle part : l'avis se vérifie contre elle.
      const demande = (image) => sample.json(messageDoute({ question, ...entree.texte, image: !!image }), { ...OPTIONS_AVIS, signal: e.ctl.signal, ...(image ? { images: [image] } : {}) });
      let reponse;
      try {
        reponse = await demande(entree.image);
      } catch (err) {
        // Cette vue n'envoie pas d'image, ou l'a refusée : la question repart sans elle, une fois.
        if (!entree.image || !issueAvis(err).sansImage) throw err;
        imagesPossibles = false;
        reponse = await demande(null);
      }
      const v = validerAvis(reponse, question);
      if (v.ok) Object.assign(e, { etat: "pret", resultat: v });
      else { console.warn("L'avis de Claude ne tient pas :", v.raison, reponse); Object.assign(e, { etat: "erreur", message: PAS_SU_REPONDRE }); }
    } catch (err) {
      const issue = issueAvis(err);
      if (err && err.code !== "cancelled") console.warn("Claude n'a pas répondu :", err);
      if (issue.cacher) {
        // Pas permis ici : la fonction se cache pour la visite ; s'il y a de quoi l'autoriser, on le propose.
        cacherClaude();
        proposerAutorisation(issue.message);
      } else if (issue.message === null) {
        if (avis.get(cle) === e) avis.delete(cle);
      } else Object.assign(e, { etat: "erreur", message: issue.message });
    }
    if (a.ouvert) afficherDoutes();
  }

  /** Claude n'est pas permis pour cette page : le dire, et ouvrir les autorisations de claude.ai si elles existent ici. */
  async function proposerAutorisation(message) {
    const permissions = deps.claude ? await deps.claude.use("permissions").catch(() => null) : null;
    if (!permissions || typeof permissions.manage !== "function") { toast(message, 8000); return; }
    proposerGeste(message, "Autoriser", async () => {
      try {
        await permissions.manage();
        const etat = await permissions.state("sample").catch(() => null);
        if (etat === "granted" || etat === "prompt") { claudeCache = false; if (a.ouvert) afficherDoutes(); }
      } catch {
        toast("Les autorisations de la page s'ouvrent depuis son menu, en haut de claude.ai.", 6000);
      }
    });
  }

  /** L'avis de Claude, touché : sa réponse s'applique comme si tu l'avais touchée (un seul « Annuler »). */
  function appliquerAvis(i) {
    const d = doutesDe()[i];
    const e = d && avis.get(cleAvis(d, i));
    if (!e || e.etat !== "pret" || e.resultat.rang === null) return;
    avis.delete(cleAvis(d, i));
    // La partition a changé depuis la question : son avis ne vaut plus.
    const r = e.abc === a.abc ? poser(d, a.abc).reponses[e.resultat.rang] : null;
    if (!r || r.id !== e.resultat.choix.id) { toast("La partition a changé depuis : redemande à Claude, ou réponds toi-même."); afficherDoutes(); return; }
    repondre(i, r);
  }

  // ------------------------------------------------------------------------
  // Branchements
  // ------------------------------------------------------------------------

  $("titre").addEventListener("change", () => { if (p()) page.changer({ titre: $("titre").value.trim() || "Sans titre" }); });
  // Saisie à la main (mode avancé) : un seul « Annuler » par salve de frappe, et les doutes suivent le texte qui bouge.
  let avantSaisie = null;
  $("abc").addEventListener("focus", () => { avantSaisie = $("abc").value; });
  $("abc").addEventListener("input", () => {
    deps.arreterEcoute();
    if (avantSaisie !== null) { memoriser(avantSaisie); avantSaisie = null; }
    a.abc = $("abc").value;
    suivre(doutesDe(), modifEntre(a.abcPrecedent, a.abc));
    a.abcPrecedent = a.abc;
    a.selection = null;
    clearTimeout(minuterieGravure);
    minuterieGravure = setTimeout(() => { graver(); majOutils(); }, 250);
    planifierSauvegarde();
  });
  $("abc").addEventListener("blur", () => { avantSaisie = null; });
  // La saisie finie (le champ quitté) : les mesures se recomptent (L13). Pas à
  // chaque touche : une note à moitié tapée ferait un doute de plus, qui resterait.
  $("abc").addEventListener("change", () => {
    if (!recalculer().length) return;
    afficherDoutes();
    planifierSauvegarde();
  });
  $("relire").addEventListener("click", () => {
    const x = p();
    memoriser(a.abc);
    poserAbc(x.abcLu);
    // L'ABC redevient celui de la lecture : ses doutes aussi, ouverts, chacun à
    // la place que la lecture lui avait donnée (ses autres visées comprises) ;
    // ceux du recompte des mesures n'ont plus d'objet. « Annuler » défait le tout.
    if (x.doutes) x.doutes = preparerDoutes(x.doutes.filter((d) => d.origine !== "recalcul").map(({ reponse: _r, ...d }) => d));
    a.douteActif = -1;
    a.manuel = null;
    a.selection = null;
    graver();
    majOutils();
    redessinerManuscrit();
    afficherDoutes();
    page.changer({ abc: x.abcLu, ...(x.doutes ? { doutes: x.doutes } : {}) });
  });
  $("annuler").addEventListener("click", annuler);
  $("outils-note").addEventListener("click", (e) => {
    const b = e.target.closest("[data-geste], [data-duree], [data-alteration]");
    if (!b || b.disabled) return;
    if (b.dataset.duree) geste("duree", Number(b.dataset.duree));
    else if (b.dataset.alteration) geste("alteration", b.dataset.alteration);
    else geste(b.dataset.geste);
  });
  $("fermer-note").addEventListener("click", () => { a.selection = null; majOutils(); });
  // Au doigt (I14) : la note d'avant, celle d'après, et la partition lue plus grande.
  $("note-precedente").addEventListener("click", () => choisirVoisine(-1));
  $("note-suivante").addEventListener("click", () => choisirVoisine(1));
  $("zoom-moins").addEventListener("click", () => zoomer(-1));
  $("zoom-plus").addEventListener("click", () => zoomer(1));
  brancherPincement($("cadre-lue"));
  // Claude dans la page (H1) : sur claude.ai, la fonction se prépare sans rien demander.
  preparerClaude();
  $("replier-dock").addEventListener("click", () => { dockReplie = !dockReplie; majDock(); });
  $("vues-atelier").addEventListener("click", (e) => {
    const b = e.target.closest("[data-vue]");
    if (b) afficherVueAtelier(b.dataset.vue, true);
  });
  $("manuel-retour").addEventListener("click", () => finirManuel(false));
  $("manuel-fini").addEventListener("click", () => finirManuel(true));
  $("ecouter-atelier").addEventListener("click", () => deps.ecouter({
    objet, abc: a.abc, bouton: $("ecouter-atelier"), qpm: tempoInitial(objet),
    titre: (p() && p().titre) || "Partition",
  }));
  // Le panneau du bas est fixé : l'écran lui laisse sa hauteur.
  suivreDock($("vue-atelier"), $("dock-atelier"));
  // « ••• » : une feuille du bas. Toucher une de ses actions la referme.
  $("plus-atelier").addEventListener("click", () => ouvrirFeuille($("feuille-atelier")));
  $("feuille-atelier").addEventListener("click", (e) => { if (e.target.closest(".liste-actions .btn")) fermerFeuille($("feuille-atelier")); });
  $("valider-menu").addEventListener("click", valider);
  $("voir-abc").addEventListener("click", () => {
    const avance = document.querySelector("#vue-atelier .avance");
    avance.open = true;
    avance.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("supprimer").addEventListener("click", deps.supprimer);

  /**
   * Raccourcis de « Corriger » : les gestes sur la note choisie. Rend true si
   * la touche a servi.
   *
   * Les durées se lisent par la touche (`code` : Digit1 à Digit5, et le pavé
   * numérique), comme dans l'éditeur d'idée : sur un clavier AZERTY, celui
   * d'Adrien, « 1 » sans Maj donne « & », et rien ne se passait (I12). Les
   * lettres, elles, restent celles qu'on lit sur la touche (`key`) : b pour
   * bémol, n pour naturel, z pour le silence de l'ABC ; la touche marquée Z
   * d'un AZERTY est à la place du W d'un QWERTY.
   */
  function toucheBas(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { annuler(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const duree = dureeDeLaTouche(e);
    if (duree) { geste("duree", duree); return true; }
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
      Escape: laisserLaNote,
    };
    const touche = e.code === "NumpadDecimal" ? "." : e.code === "NumpadAdd" ? "+" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (actions[touche] && (a.selection !== null || touche.startsWith("Arrow"))) {
      actions[touche]();
      return true;
    }
    return false;
  }

  return {
    ouvrir, afficher, fermer, toucheBas,
    /** Une note est choisie : « précédent » la laisse d'abord (comme dans l'éditeur d'idée). */
    reculer() {
      if (a.selection === null) return false;
      laisserLaNote();
      return true;
    },
  };
}
