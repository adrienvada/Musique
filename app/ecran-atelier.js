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
import { lirePartition } from "./lecteur/partition.js";
import { dessinerPage } from "./manuscrit.js";
import * as ed from "./edition.js";
import { cibleVisible, completerDoutes, initialiserVise, modifEntre, poser, suivre } from "./doutes.js";
import {
  afficherVueAtelier, dessinerCarteDoute, dessinerConsigne, dessinerPas, dessinerRelu, dessinerReperes,
  pastilleBarre, placerOnglets, PREFIXE_GRAVURE, pourGravure, suivreDock, tempoInitial,
} from "./atelier.js";
import { fermerFeuille, ouvrirFeuille } from "./feuilles.js";
import { explication } from "./erreurs.js";
import { $, couleurDuJeton as couleur, dateRelative, el, pluriel, toast } from "./ui.js";

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
 * @param deps {
 *   page (page-ouverte.js), piano, abcjs() → window.ABCJS, calibration(modele),
 *   ecouter(o) (atelier.js, creerEcoutePage), arreterEcoute(),
 *   valider() (« C'est bon » : la page est prête, on va l'écouter),
 *   supprimer() (la page ouverte, après la question)
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
  let minuterieGravure = null, minuterieEclat = null;
  let renduDoutes = 0;
  let dockEnOutils = false, dockReplie = false;
  let derniereNote = { alteration: "", lettre: "C", octave: 5 };

  const p = () => page.partition;
  const doutesDe = () => (p() && p().doutes) || [];
  const premierOuvert = () => doutesDe().findIndex((d) => !d.leve);
  const jetonChoisi = () => (a.selection === null ? null : ed.lireJeton(a.abc, a.selection));

  /** Une autre page s'ouvre : « Corriger » repart d'un historique neuf, sans note choisie. */
  function ouvrir() {
    Object.assign(a, { numeroPage: 0, douteActif: -1, selection: null, historique: [], manuel: null });
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
      await retrouverCibles(x);
      await dessinerManuscrit();
    } catch (e) {
      // Le modèle de la page n'est pas venu (le réseau ?) : la partition lue reste là pour corriger.
      console.error(e);
      toast(`Ta page n'a pas pu se dessiner : ${explication(e)}`, 7000);
    }
    if (p() !== x) return; // une autre page s'est ouverte entre-temps
    graver();
    majOutils();
    afficherDoutes();
  }

  /** On quitte l'écran : la lecture s'arrête, ce qui attendait d'être enregistré part. */
  function fermer() {
    a.ouvert = false;
    clearTimeout(minuterieGravure);
    return page.vider();
  }

  /**
   * Une partition lue avant que les doutes sachent où est leur note : tant que rien
   * n'a été corrigé, on relit ses traits (c'est déterministe) pour la leur donner.
   */
  async function retrouverCibles(x) {
    const doutes = x.doutes || [];
    if (!doutes.some((d) => !d.type) || x.abc !== x.abcLu || !page.pages.length) return;
    try {
      const titre = (x.abcLu.match(/^T:(.*)$/m) || [])[1] ?? x.titre;
      const res = lirePartition(page.pages, await calibration(x.modele), { titre });
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
    const cal = await calibration(x.modele);
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
    surligner();
    // Un ABC que abcjs ne comprend pas (tapé à la main) : on le dit, sans jargon.
    const e = $("etat-abc");
    e.textContent = "";
    const avert = (objet && objet.warnings) || [];
    if (avert.length) e.append(el("span", "pastille p-doute", "Texte ABC à revoir"), " " + avert[0].replace(/<[^>]+>/g, ""));
  }

  // ------------------------------------------------------------------------
  // Corriger au toucher
  // ------------------------------------------------------------------------

  function surClicNote(abcelem, _numero, _classes, _analyse, glisse) {
    if (!abcelem || abcelem.el_type !== "note") return;
    const debut = abcelem.startChar - PREFIXE_GRAVURE.length;
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

  /** Fait entendre la note choisie (ou l'accord), brièvement. */
  function entendre(j) {
    if (!j || j.type === "silence") return;
    const hauteurs = ed.hauteursMidi(j, ed.armureA(a.abc, j.debut));
    piano.pret().then(() => hauteurs.forEach((h) => piano.note(h, 0.7, 80))).catch(() => {});
  }

  /** L'ABC et les doutes de la page, enregistrés un instant après le dernier geste (avec leur copie de maintenant). */
  function planifierSauvegarde() {
    page.changer({ abc: a.abc, ...(p().doutes ? { doutes: p().doutes } : {}) }, { delai: 800 });
  }

  /**
   * Applique un geste : mémorise l'état d'avant, regrave, enregistre. Les doutes
   * suivent le texte qui bouge ; une réponse à un doute (`doute`) le règle dans
   * le même geste, pour qu'« Annuler » défasse les deux.
   */
  function appliquer(res, { entendre: jouer = false, doute = null, reponse = "", selectionner = true } = {}) {
    if (!res) return;
    deps.arreterEcoute();
    memoriser(a.abc);
    poserAbc(res.abc);
    suivre(doutesDe(), res.modif);
    if (doute !== null) marquer(doute, true, reponse);
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

  /** L'état d'avant chaque geste, pour « Annuler » : l'ABC, et où en étaient les doutes. */
  function memoriser(abc = a.abc) {
    a.historique.push({
      abc,
      doutes: doutesDe().map((d) => ({ leve: !!d.leve, reponse: d.reponse, vise: d.vise ? { ...d.vise } : null })),
      actif: a.douteActif,
    });
    if (a.historique.length > 200) a.historique.shift();
    $("annuler").disabled = false;
  }

  function annuler() {
    const avant = a.historique.pop();
    if (avant === undefined) return;
    deps.arreterEcoute();
    poserAbc(avant.abc);
    doutesDe().forEach((d, k) => {
      const s = avant.doutes[k];
      if (!s) return;
      d.leve = s.leve; d.vise = s.vise;
      if (s.reponse) d.reponse = s.reponse; else delete d.reponse;
    });
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
          for (const x of voix) if (x.el_type === "note" && !x.rest?.type?.startsWith("invisible")) positions.add(x.startChar - PREFIXE_GRAVURE.length);
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
    entendre(jetonChoisi());
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
    try { cal = await calibration(x.modele); } catch (e) { console.error(e); }
    if (rendu !== renduDoutes || p() !== x) return;
    const zone = $("doutes");
    if (a.manuel !== null) {
      const q = poser(doutes[a.manuel], a.abc);
      dessinerConsigne(zone, q.cible && q.cible.genre === "mesure" ? "Touche la note à corriger dans la mesure surlignée de la partition lue." : "Touche la note à corriger dans la partition lue.");
    } else if (actif >= 0) {
      const d = doutes[actif];
      dessinerCarteDoute(zone, {
        doute: d, question: poser(d, a.abc), cal, traits: page.pages[(d.page || 1) - 1] || [],
        surReponse: (r) => repondre(actif, r),
        surRouvrir: () => leverDoute(actif, false),
        surMoiMeme: () => commencerManuel(actif),
        surVoulu: () => leverDoute(actif, true, "C'est voulu"),
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
    if (res) appliquer(res, { doute: i, reponse: r.texte, selectionner: false });
    else { memoriser(); marquer(i, true, r.texte); a.selection = null; page.changer({ doutes: p().doutes }); redessinerManuscrit(); afficherDoutes(); majOutils(); }
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
  $("relire").addEventListener("click", () => {
    const x = p();
    memoriser(a.abc);
    poserAbc(x.abcLu);
    // L'ABC redevient celui de la lecture : chaque doute retrouve la place que la lecture lui avait donnée.
    for (const d of doutesDe()) d.vise = d.cible ? { ...d.cible } : null;
    a.selection = null;
    graver();
    majOutils();
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
