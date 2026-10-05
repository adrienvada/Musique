/**
 * L'ÉDITEUR D'IDÉE : LE CŒUR
 *
 * Noter une mélodie, une phrase, une grille, là où elle vient, téléphone en
 * main. Un studio de poche : une barre en haut (le titre ; toucher le tempo
 * ouvre « Tempo et mesure »), la grille ou la partition qui prend l'écran,
 * et un pupitre sous le pouce (le transport, puis trois modes : Clavier,
 * Chanter, Accords).
 *
 *   - sans note choisie, une touche écrit à la suite, comme dans un texte
 *     (à la place du curseur, de la durée choisie ; plusieurs doigts font
 *     un accord) ;
 *   - avec une note choisie, une touche lui donne sa hauteur : on essaie
 *     jusqu'à ce que ça sonne juste ;
 *   - tout s'annule, tout s'enregistre tout seul (et se synchronise).
 *
 * Ce module tient le cœur : l'état (e), annuler et refaire, la sauvegarde,
 * le dessin (grille.js ou la partition d'abcjs), le transport (écouter,
 * boucle, métronome), la barre du haut, la feuille •••, et le choix du mode
 * du pupitre. Le reste vit dans des modules qui
 * reçoivent un contexte explicite (ctx, plus bas) et ne partagent rien
 * d'autre :
 *   idee-clavier.js   le mode Clavier (durées, clavier à l'écran, de
 *                     l'ordinateur, MIDI) ;
 *   idee-chant.js     le mode Chanter (micro, accordeur) ;
 *   idee-accords.js   le mode Accords et la feuille des accords ;
 *   idee-selection.js la pilule, la boîte à outils, la rangée de
 *                     sélection, les transformations, le menu en cercle ;
 *   idee-direct.js    le jeu en direct (décompte, enregistrement, recalage) ;
 *   idee-carnet.js    la feuille Carnet (note, étiquettes, favori, mémo vocal) ;
 *   idee-tempo.js     la feuille Tempo et mesure (et les pistes).
 *
 * L'idée vit en notes (sequence.js) ; la partition n'en est qu'une
 * traduction. Ce module ne parle à l'appli que par les dépendances qu'on
 * lui passe (stockage, piano, transport, messages).
 */
import { lirePref, ecrirePref } from "./preferences.js";
import * as sq from "./sequence.js";
import { voixCompletes } from "./harmonie.js";
import { creerGrille } from "./grille.js";
import { ico } from "./icones.js";
import { $, dateCourte } from "./ui.js";
import { creerEnregistreur } from "./enregistreur.js";
import { cause, explication } from "./erreurs.js";
import { egal } from "./fiche.js";
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";
import { creerModeClavier } from "./idee-clavier.js";
import { creerChant } from "./idee-chant.js";
import { creerAccords } from "./idee-accords.js";
import { creerSelection } from "./idee-selection.js";
import { creerDirect } from "./idee-direct.js";
import { creerCarnet } from "./idee-carnet.js";
import { creerTempo, defauts } from "./idee-tempo.js";

const CLE_MODE = "portee:mode-idee";
const MODES = ["clavier", "chanter", "accords"];
// Ce que l'éditeur montre d'une idée : une version d'ailleurs qui ne change rien de cela ne se recharge pas.
const CHAMPS_MONTRES = ["titre", "sequence", "note", "etiquettes", "favori", "memo"];

const titreDuJour = () => `Idée du ${dateCourte(new Date().toISOString())}`;

/**
 * @param deps {
 *   piano, transport, stockage() → le stockage ouvert, toast(texte),
 *   nouvelId(), partager(p) (envoie le MIDI), menu(action, p) (les actions
 *   de la feuille •••), titreChange(t), etiquettes() → celles de la
 *   bibliothèque, nouvelleDepuis(seq), abcjs() → window.ABCJS
 * }
 */
export function creerEditeurIdee(deps) {
  const { piano, transport, toast } = deps;
  const e = {
    id: null, creeLe: null, titre: "", seq: null, piste: 0,
    note: "", etiquettes: [], favori: false, memo: null,
    selection: new Set(), curseur: 0, mesureChoisie: 0,
    duree: 4, pointee: false,
    affichage: lirePref("portee:affichage-idee") || "grille",
    mode: "clavier", modeOuvert: false,
    boucle: false, metronome: false, recalage: 2,
    annuler: [], refaire: [],
    version: 0,
    enregistrement: null, // le jeu en direct en cours (idee-direct.js seul l'écrit)
    accordEnCours: null,
    jetons: [], elements: new Map(),
    ouverte: false,
    // L'idée ouverte, pour ses enregistrements : son identifiant, si elle est déjà dans
    // la bibliothèque (`cree`), et la dernière version qu'elle y sait (`derniere`), d'où
    // part la fusion si un autre onglet ou la synchro l'a changée entre-temps (S8).
    session: { id: null, creeLe: null, cree: false, derniere: null },
  };
  const tenues = new Map(); // hauteur → note qui sonne (piano)
  // Les enregistrements de l'idée, un instant après le dernier geste (enregistreur.js).
  const ecritures = creerEnregistreur({ ecrire: (s, x) => ecrire(s, x), secours: (s, x) => secours(s, x), delai: 700, fondre: (_avant, apres) => apres });

  // --- La grille ---------------------------------------------------------------

  const grille = creerGrille($("idee-grille"), {
    poser: (d, h) => modifier(() => {
      const id = sq.poser(e.seq, e.piste, { d, l: dureeCourante(), h });
      e.selection = new Set([id]);
      e.curseur = d + dureeCourante();
    }, { entendre: [h] }),
    choisir: (id, ajouter) => choisir([id], ajouter),
    deplacer: (id, d, h) => modifier(() => sq.deplacer(e.seq, e.piste, id, d, h)),
    redimensionner: (id, l) => modifier(() => sq.redimensionner(e.seq, e.piste, id, l)),
    effacer: (id) => modifier(() => { sq.effacer(e.seq, e.piste, [id], { decaler: false }); e.selection.delete(id); }),
    curseur: (pas, m) => { e.selection.clear(); e.curseur = pas; e.mesureChoisie = m; rafraichir(); },
    ecouter: (h) => entendre([h]),
    accord: (m, pas) => accords.ouvrirFeuille(m, pas),
    menu: (id, x, y) => { if (!e.selection.has(id)) choisir([id]); selection.ouvrirMenu(x, y, { glisser: true }); },
    defile: () => selection.placer(),
  });

  // --- Le contexte des modules ---------------------------------------------------
  //
  // Tout ce qu'un module du pupitre peut lire ou faire passe par ici : pas
  // de variable partagée en douce. Les fonctions sont celles du cœur, plus bas.

  const ctx = {
    e, $, sq, deps, piano, transport, toast,
    modifier, rafraichir, entendre, enfoncer, relever, pedale,
    dureeCourante: () => dureeCourante(), choisirDuree, basculerPointee, silence, effacer,
    choisir, notesPiste: () => notesPiste(), choisies: () => choisies(),
    source, suivreLecture, avantSon, apresSon, choisirMode,
    boiteSelection, grille,
    // La boîte à outils de la sélection (idee-selection.js) cache le pupitre : elle a son propre « Annuler ».
    annuler: () => revenir(e.annuler, e.refaire),
  };
  const clavierMode = creerModeClavier(ctx);
  const chant = creerChant(ctx);
  const accords = creerAccords(ctx);
  const selection = creerSelection(ctx);
  const direct = creerDirect(ctx);
  const modes = { clavier: clavierMode, chanter: chant, accords };
  // La feuille Tempo et mesure (idee-tempo.js) ; le clavier à l'écran suit la piste choisie.
  const tempo = creerTempo({
    e, $, toast, grille, modifier, rafraichir,
    notesPiste: () => notesPiste(), amener: (h) => clavierMode.amener(h),
  });
  const feuilles = ["idee-reglages", "idee-menu", "idee-infos"].map((id) => brancherFeuille($(id)));
  for (const f of feuilles) f.addEventListener("click", (ev) => { if (ev.target.closest("[data-fermer]")) fermerFeuille(f); });

  // --- Ouvrir, fermer ---------------------------------------------------------

  /**
   * Ouvre une idée enregistrée, ou une nouvelle (null) qui ne s'enregistre
   * qu'à la première note.
   * @param options { seq, titre (une idée née d'une partition ou d'une
   *   phrase), memo (ouvrir le carnet et enregistrer un mémo), mode
   *   ("clavier", "chanter" ou "accords" ; sinon le dernier employé) }
   */
  function ouvrir(p = null, { seq = null, titre = null, memo = false, mode = null } = {}) {
    // Ce qui attendait pour l'idée d'avant part d'abord, avec son contenu à elle.
    ecritures.vider();
    e.ouverte = true;
    e.session = { id: p ? p.id : null, creeLe: p ? p.creeLe : null, cree: !!p, derniere: p };
    e.id = p ? p.id : null;
    e.creeLe = p ? p.creeLe : null;
    e.titre = p ? p.titre : titre || titreDuJour();
    e.note = (p && p.note) || "";
    e.etiquettes = (p && p.etiquettes) || [];
    e.favori = !!(p && p.favori);
    e.memo = (p && p.memo) || null;
    e.seq = p ? sq.cloner(p.sequence) : seq ? sq.cloner(seq) : sq.nouvelleSequence(defauts());
    e.piste = 0;
    e.selection = new Set();
    e.curseur = sq.finSequence(e.seq);
    e.mesureChoisie = Math.max(0, Math.floor(Math.max(0, e.curseur - 1) / sq.pasParMesure(e.seq)));
    e.annuler = []; e.refaire = [];
    e.version++;
    // Une autre idée : sa partition se grave tout de suite, avec sa propre mise en page.
    gravee = null; miseEnPage = null;
    // Une idée née d'une partition (« continuer en idée ») s'enregistre tout de suite.
    if (!p && seq) planifierSauvegarde(0);
    $("idee-titre").value = e.titre;
    $("idee-etat").textContent = "";
    for (const f of feuilles) fermerFeuille(f);
    accords.fermer();
    direct.ouvrir();
    afficherAffichage();
    // Un mémo vocal prend le micro : on l'ouvre au clavier, pas au chant.
    choisirMode(MODES.includes(mode) ? mode : memo ? "clavier" : lirePref(CLE_MODE));
    rafraichir();
    carnet.afficher();
    if (memo) { ouvrirFeuille($("idee-infos")); carnet.enregistrerMemo(); }
    requestAnimationFrame(() => grille.centrer());
    clavierMode.ouvrir(e.seq.pistes[0].notes);
  }

  /** Quitte l'éditeur : arrête le son et le micro, enregistre ce qui reste. */
  async function fermer() {
    if (!e.ouverte) return;
    e.ouverte = false;
    if (e.enregistrement) direct.arreter();
    transport.arreter();
    if (e.modeOuvert) { modes[e.mode].sortir(); e.modeOuvert = false; }
    chant.fermer();
    selection.fermer();
    accords.fermer();
    for (const f of feuilles) fermerFeuille(f);
    carnet.fermer();
    for (const h of [...tenues.keys()]) relever(h);
    // Une pédale restée enfoncée ne doit pas tenir les notes des autres écrans.
    piano.pedale(false);
    await ecritures.vider();
  }

  /** Une écriture attend ou part, le tempo se règle, ou le jeu en direct tourne : on ne recharge pas sous les doigts. */
  const occupe = () => ecritures.occupe || tempo.enAttente || !!e.enregistrement;

  /**
   * L'idée a changé ailleurs (un autre appareil, un autre onglet) : on la
   * reprend, sauf modification en cours ici. Rien de ce qu'elle montre n'a
   * changé : rien à faire, et rien à dire (T4).
   */
  function recharger(p) {
    if (!e.ouverte || p.id !== e.id || occupe()) return false;
    if (CHAMPS_MONTRES.every((c) => egal(p[c], e.session.derniere && e.session.derniere[c]))) return false;
    e.session.derniere = p;
    e.titre = p.titre;
    e.seq = sq.cloner(p.sequence);
    e.note = p.note || ""; e.etiquettes = p.etiquettes || []; e.favori = !!p.favori; e.memo = p.memo || null;
    carnet.afficher();
    e.selection = new Set([...e.selection].filter((id) => e.seq.pistes[e.piste]?.notes.some((n) => n.id === id)));
    if (!e.seq.pistes[e.piste]) e.piste = 0;
    e.version++;
    $("idee-titre").value = e.titre;
    rafraichir();
    return true;
  }

  // --- Les modes du pupitre -----------------------------------------------------

  /** Clavier, Chanter ou Accords : le pupitre change, le dernier choisi est retenu. */
  function choisirMode(mode) {
    if (!MODES.includes(mode)) mode = "clavier";
    if (e.modeOuvert && e.mode === mode) return;
    if (e.modeOuvert) modes[e.mode].sortir();
    e.mode = mode;
    e.modeOuvert = true;
    ecrirePref(CLE_MODE, mode);
    document.querySelectorAll("#idee-modes [data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    $("idee-pupitre").dataset.pupitre = mode;
    modes[mode].entrer();
    rafraichir();
  }
  $("idee-modes").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-mode]");
    if (b) choisirMode(b.dataset.mode);
  });

  // --- Modifier, annuler, enregistrer -----------------------------------------

  const dureeCourante = () => Math.max(1, Math.round(e.duree * (e.pointee ? 1.5 : 1)));
  const notesPiste = () => e.seq.pistes[e.piste].notes;
  const choisies = () => notesPiste().filter((n) => e.selection.has(n.id));

  /** Un geste qui change l'idée : on garde l'état d'avant (Annuler), on redessine, on enregistre. */
  function modifier(f, { entendre: hauteurs = null } = {}) {
    e.annuler.push(JSON.stringify({ seq: e.seq, curseur: e.curseur, piste: e.piste }));
    if (e.annuler.length > 300) e.annuler.shift();
    e.refaire = [];
    f();
    e.version++;
    rafraichir();
    planifierSauvegarde();
    if (hauteurs) entendre(hauteurs);
  }

  function revenir(depuis, vers) {
    // Pendant le jeu en direct, « Annuler » arrêterait la prise au passage et la ferait écrire après coup.
    if (e.enregistrement) return;
    const etat = depuis.pop();
    if (!etat) return;
    vers.push(JSON.stringify({ seq: e.seq, curseur: e.curseur, piste: e.piste }));
    const x = JSON.parse(etat);
    e.seq = x.seq; e.curseur = x.curseur; e.piste = Math.min(x.piste, e.seq.pistes.length - 1);
    e.selection = new Set([...e.selection].filter((id) => notesPiste().some((n) => n.id === id)));
    e.version++;
    transport.arreter();
    rafraichir();
    planifierSauvegarde();
  }

  /**
   * Enregistre un instant après le dernier geste (enregistreur.js) : ce qui
   * part est la copie de l'idée prise maintenant, pour l'idée de maintenant.
   */
  function planifierSauvegarde(delai = 700) {
    $("idee-etat").textContent = "Enregistrement…";
    ecritures.planifier(e.session, instantane(), delai);
  }

  /** Ce que l'idée montre, copié (les gestes qui suivent ne le changent plus). */
  const instantane = () => ({ titre: e.titre, seq: sq.cloner(e.seq), note: e.note, etiquettes: [...e.etiquettes], favori: e.favori, memo: e.memo });

  // Une idée sans note, sans accord, sans mot ni mémo ne s'enregistre pas.
  const vide = (x) => x.seq.pistes.every((p) => !p.notes.length) && !(x.seq.accords || []).length && !x.memo && !x.note && !x.etiquettes.length;

  /** La fiche d'une idée, telle que le stockage la garde (l'ABC est écrit d'après ses notes). */
  function donneesDe(x) {
    const { abc } = sq.ecrireAbc(x.seq, { voix: voixCompletes(x.seq), titre: x.titre });
    return {
      type: "idee", titre: x.titre, sequence: x.seq, abc, statut: "idee", nbPages: 0, modele: null, tempo: x.seq.tempo,
      note: x.note, etiquettes: x.etiquettes, favori: x.favori, memo: x.memo,
    };
  }
  const donnees = () => donneesDe(instantane());

  /**
   * Écrit une copie de l'idée (`x`) dans son idée (`s`, la session de
   * l'ouverture où on l'a prise) : la créer à la première note, sinon la
   * modifier en disant d'où l'on part (S8).
   */
  /** Une idée neuve reçoit son identifiant : à sa première écriture, ou pour la copie de secours. */
  function nommer(s, maintenant) {
    if (s.id) return;
    s.id = deps.nouvelId();
    s.creeLe = maintenant;
    if (s === e.session) { e.id = s.id; e.creeLe = maintenant; }
  }

  /** La copie de secours, quand la page se ferme avant l'écriture (enregistreur.js). */
  function secours(s, x) {
    if (!s.cree && vide(x)) return null;
    const maintenant = new Date().toISOString();
    nommer(s, maintenant);
    return { id: s.id, creer: !s.cree, donnees: { ...donneesDe(x), creeLe: s.creeLe, modifieLe: maintenant } };
  }

  async function ecrire(s, x) {
    const stockage = deps.stockage();
    if (!stockage) return;
    const ici = () => s === e.session && e.ouverte;
    const maintenant = new Date().toISOString();
    try {
      if (!s.cree) {
        if (vide(x)) { if (ici()) $("idee-etat").textContent = ""; return; } // une idée vide ne s'enregistre pas
        nommer(s, maintenant);
        const fiche = { ...donneesDe(x), creeLe: s.creeLe, modifieLe: maintenant };
        // Écrite, elle devient la dernière version connue (les écritures se suivent : `s` n'a pas bougé).
        await stockage.creer(s.id, fiche, []).then(() => { s.cree = true; s.derniere = fiche; });
      } else {
        const fiche = { ...donneesDe(x), modifieLe: maintenant };
        await stockage.modifier(s.id, fiche, { depuis: s.derniere }).then(() => { s.derniere = fiche; });
      }
      if (ici()) $("idee-etat").textContent = "Enregistrée";
    } catch (err) {
      console.error(err);
      if (s !== e.session) return;
      $("idee-etat").textContent = "Non enregistrée : " + cause(err);
      // L'état ne se voit plus dans la barre : une erreur se dit tout haut.
      if (e.ouverte) toast(`L'idée n'a pas pu être enregistrée : ${explication(err)}`, 8000);
    }
  }

  // --- Jouer une note, écrire -----------------------------------------------------

  function entendre(hauteurs, duree = 0.6) {
    piano.pret().then(() => hauteurs.forEach((h) => piano.note(h, duree, 85))).catch(() => {});
  }

  /**
   * Une touche s'enfonce (clavier à l'écran, de l'ordinateur, MIDI, ou note
   * chantée) ; `quand` : l'instant du geste (horloge de la page), que le jeu
   * en direct garde (M6).
   */
  function enfoncer(h, v = 90, { muet = false, quand = null } = {}) {
    if (!e.ouverte) return;
    if (tenues.has(h)) relever(h);
    const autres = tenues.size > 0;
    tenues.set(h, null);
    clavierMode.montrer(h, true);
    // Même avant que le piano soit là : la note attend son échantillon et part à son arrivée
    // (piano.js), au lieu d'être perdue comme le premier toucher l'était.
    if (!muet) tenues.set(h, piano.debut(h, v));
    // En direct, la touche est notée à l'instant ; elle ne s'écrit qu'à la fin.
    if (direct.enfoncer(h, v, quand, { muet })) return;
    const sel = [...e.selection];
    if (autres && e.accordEnCours !== null) {
      // Un doigt de plus pendant que les autres tiennent : un accord.
      modifier(() => {
        const id = sq.ajouterALAccord(e.seq, e.piste, e.accordEnCours, h);
        if (id !== null && e.selection.size) e.selection.add(id);
      });
      return;
    }
    if (sel.length) {
      modifier(() => sq.fixerHauteur(e.seq, e.piste, sel, h));
      e.accordEnCours = sel[0];
    } else {
      modifier(() => {
        const l = dureeCourante();
        const [id] = sq.inserer(e.seq, e.piste, e.curseur, [h], l);
        e.accordEnCours = id;
        e.curseur += l;
      });
      // La grille suit ce qu'on écrit.
      const n = notesPiste().find((x) => x.id === e.accordEnCours);
      if (n) requestAnimationFrame(() => grille.montrer(n));
    }
  }

  function relever(h, quand = null) {
    if (!tenues.has(h)) return;
    piano.fin(tenues.get(h));
    tenues.delete(h);
    clavierMode.montrer(h, false);
    direct.relever(h, quand);
    if (!tenues.size) e.accordEnCours = null;
  }

  /** La pédale de maintien du clavier MIDI (M9) : le piano tient les notes, le jeu en direct aussi. */
  function pedale(bas, quand = null) {
    piano.pedale(bas);
    direct.pedale(bas, quand);
  }

  function silence() {
    const sel = choisies();
    if (sel.length) {
      // Les notes choisies deviennent un silence de même durée.
      modifier(() => { sq.effacer(e.seq, e.piste, sel.map((n) => n.id), { decaler: false }); e.selection.clear(); });
      return;
    }
    modifier(() => { sq.insererSilence(e.seq, e.piste, e.curseur, dureeCourante()); e.curseur += dureeCourante(); });
  }

  function effacer() {
    const sel = choisies();
    if (sel.length) {
      const debut = Math.min(...sel.map((n) => n.d));
      modifier(() => { sq.effacer(e.seq, e.piste, sel.map((n) => n.id)); e.selection.clear(); e.curseur = debut; });
      return;
    }
    if (e.curseur <= 0) return;
    modifier(() => { e.curseur = sq.effacerAvant(e.seq, e.piste, e.curseur, dureeCourante()); });
  }

  function choisirDuree(pas) {
    e.duree = pas;
    if (pas === 1) e.pointee = false;
    appliquerDuree();
  }

  function basculerPointee() {
    if (e.duree === 1) return;
    e.pointee = !e.pointee;
    appliquerDuree();
  }

  /** La durée choisie vaut pour les prochaines notes, et pour la sélection s'il y en a une. */
  function appliquerDuree() {
    const sel = [...e.selection];
    if (sel.length) modifier(() => sq.changerDuree(e.seq, e.piste, sel, dureeCourante()));
    else rafraichir();
  }

  /** Choisit des notes (ou en ajoute, ou en retire, avec `ajouter`). */
  function choisir(ids, ajouter = false) {
    if (ajouter) {
      const tous = ids.every((id) => e.selection.has(id));
      for (const id of ids) (tous ? e.selection.delete(id) : e.selection.add(id));
    } else e.selection = new Set(ids);
    const sel = choisies();
    if (sel.length) {
      e.curseur = Math.max(...sel.map((n) => n.d + n.l));
      // Les accords visent la mesure de la note choisie.
      e.mesureChoisie = Math.floor(Math.min(...sel.map((n) => n.d)) / sq.pasParMesure(e.seq));
      // La durée affichée devient celle de la note : on voit ce qu'elle est.
      const l = sel[0].l;
      const base = [1, 2, 4, 8, 16].find((d) => d === l || d * 1.5 === l);
      if (base) { e.duree = base; e.pointee = base !== l; }
      entendre(sel.filter((n) => n.d === sel[0].d).map((n) => n.h));
      if (e.affichage === "grille") grille.montrer(sel[0]);
    }
    rafraichir();
  }

  /** Le cadre des notes choisies à l'écran, et la zone visible (pour la pilule). */
  function boiteSelection() {
    if (!e.selection.size || !e.ouverte) return null;
    if (e.affichage === "grille") return grille.boite([...e.selection]);
    const zone = $("idee-partition");
    const els = [...zone.querySelectorAll(".choisie")];
    if (!els.length) return null;
    const rs = els.map((x) => x.getBoundingClientRect()).filter((r) => r.width || r.height);
    if (!rs.length) return null;
    return {
      boite: { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) },
      zone: zone.getBoundingClientRect(),
    };
  }

  // --- Écouter, boucle, métronome ---------------------------------------------

  let cache = { version: -1 };
  /** Ce que le transport joue : toutes les voix (accompagnement compris), indexées par pas. */
  function source() {
    if (cache.version !== e.version) {
      const parPas = new Map();
      let fin = 0;
      for (const v of voixCompletes(e.seq)) {
        for (const n of v.notes) {
          if (!parPas.has(n.d)) parPas.set(n.d, []);
          parPas.get(n.d).push(n);
          fin = Math.max(fin, n.d + n.l);
        }
      }
      cache = { version: e.version, parPas, fin };
    }
    return { tempo: e.seq.tempo, mesure: sq.pasParMesure(e.seq), temps: sq.pasParTemps(e.seq), fin: cache.fin, notesA: (p) => cache.parPas.get(p) || [] };
  }

  /** La boucle : les mesures de la sélection, sinon toute l'idée. */
  function etendueBoucle() {
    const mesure = sq.pasParMesure(e.seq);
    const sel = choisies();
    if (sel.length) {
      const [a, b] = sq.etendue(sel);
      return [Math.floor(a / mesure) * mesure, Math.ceil(b / mesure) * mesure];
    }
    return [0, sq.nbMesures(e.seq) * mesure];
  }

  // Le micro et le piano ne marchent pas ensemble (le piano repasserait dans
  // le micro) : le micro se tait tant que le piano joue, puis reprend.
  function avantSon() { chant.pause(); }
  function apresSon() { chant.reprendre(); }

  function majJouer(enCours) {
    const b = $("idee-jouer");
    b.innerHTML = ico(enCours ? "pause" : "lire");
    b.setAttribute("aria-label", enCours ? "Arrêter l'écoute" : "Écouter");
    b.setAttribute("aria-pressed", String(enCours));
  }

  async function jouer() {
    if (transport.actif) { transport.arreter(); return; }
    if (e.enregistrement) return;
    avantSon();
    const s = source();
    const boucle = e.boucle ? etendueBoucle() : null;
    let depuis = 0;
    if (boucle) depuis = boucle[0];
    else if (e.selection.size) depuis = Math.min(...choisies().map((n) => n.d));
    else if (e.curseur > 0 && e.curseur < s.fin) depuis = e.curseur;
    majJouer(true);
    try {
      await transport.jouer(source, {
        depuis, boucle, metronome: e.metronome,
        // Les commandes de l'écran verrouillé (eveil.js, M8) : le titre, et « lecture » qui relance.
        titre: e.titre, relancer: () => { if (e.ouverte && !transport.actif) jouer(); },
        surPosition: suivreLecture,
        surFin: () => { majJouer(false); suivreLecture(null); apresSon(); apresLecture(); },
      });
    } catch (err) {
      majJouer(false);
      apresSon();
      toast(err.message || "Le piano n'a pas pu se charger.");
    }
  }

  let dernierJeton = null;
  /** Suit la lecture : la tête dans la grille, ou la note jouée sur la partition. */
  function suivreLecture(pas) {
    if (e.affichage === "grille") grille.lecture(pas);
    else {
      const j = pas === null ? null : e.jetons.find((x) => x.voix === e.piste && x.couche === 0 && pas >= x.a && pas < x.a + x.l);
      if (j !== dernierJeton) {
        for (const el of (dernierJeton && e.elements.get(dernierJeton)) || []) el.classList.remove("joue");
        for (const el of (j && e.elements.get(j)) || []) el.classList.add("joue");
        dernierJeton = j;
      }
    }
    direct.suivre(pas);
  }

  // --- Le carnet : note, étiquettes, favori, mémo vocal (idee-carnet.js) ----------

  const carnet = creerCarnet({
    e, $, toast, transport, etiquettes: deps.etiquettes, stockage: deps.stockage,
    planifierSauvegarde, sauverMaintenant: () => ecritures.vider(), choisirMode,
  });

  // --- Affichage ------------------------------------------------------------------

  /**
   * Grille ou partition. Le choix se fait dans la barre du haut, les deux
   * côte à côte, celui qu'on voit allumé : un seul bouton qui montrait
   * l'autre affichage passait pour un menu, et on ne trouvait pas la partition.
   */
  function afficherAffichage() {
    $("idee-grille").hidden = e.affichage !== "grille";
    $("idee-partition").hidden = e.affichage !== "partition";
    $("idee-affichage").querySelectorAll("[data-affichage]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.affichage === e.affichage)));
  }

  let image = null;
  function rafraichir() {
    if (!e.seq) return;
    cancelAnimationFrame(image);
    image = requestAnimationFrame(dessiner);
    majCommandes();
  }

  function dessiner() {
    if (e.affichage === "grille") {
      grille.afficher({
        seq: e.seq, piste: e.piste, selection: e.selection, curseur: e.curseur,
        // Avec une note choisie, le clavier la change : le curseur n'écrit plus, on le cache.
        curseurVisible: !e.selection.size,
        boucle: e.boucle ? etendueBoucle() : null, pas: Math.min(dureeCourante(), sq.pasParTemps(e.seq)),
        mesureChoisie: e.mesureChoisie, accordsVisibles: true,
      });
    } else planifierGravure();
    selection.placer();
  }

  // La gravure se regroupe (audit du 04/10, M2, et audit de l'interface).
  // abcjs regrave toute la partition : de 10 à 40 ms pour une idée courte au
  // téléphone, plus de 400 ms pour 64 mesures, et jusqu'à trois gravures par
  // changement (six sur grand écran) pour ajuster la mise en page.
  //   - Pendant la lecture : une gravure toutes les 300 ms au plus, d'un seul
  //     passage, avec la mise en page d'avant ; sinon le transport manquait
  //     des notes. L'arrêt regrave en entier.
  //   - En écrivant : 150 ms après la dernière note, d'un seul passage tant
  //     que le nombre de mesures ne change pas ; dix notes tapées vite ne
  //     coûtent qu'une gravure.
  //   - Choisir une note ne regrave plus rien : seules ses couleurs changent.
  const GRAVURE_EN_LECTURE = 300, GRAVURE_EN_ECRIVANT = 150;
  let gravureFaite = 0, gravureAttendue = null, gravureRapide = false;
  let gravee = null; // { id, version, largeur, hauteur, mesures } : ce que montre la gravure en place
  const tailleGravure = () => ({ largeur: $("idee-gravure").clientWidth || 600, hauteur: Math.max(160, ($("idee-partition").clientHeight || 400) - 36) });
  function planifierGravure() {
    const zone = $("idee-gravure");
    const { largeur, hauteur } = tailleGravure();
    const fraiche = gravee && gravee.id === e.id && gravee.version === e.version && gravee.largeur === largeur && gravee.hauteur === hauteur && zone.querySelector("svg");
    clearTimeout(gravureAttendue);
    gravureAttendue = null;
    if (fraiche) { marquerChoisies(); return; }
    if (!gravee || gravee.id !== e.id) { graverPartition(); return; } // la première gravure de cette idée : tout de suite
    const lecture = transport.actif;
    const attente = lecture ? gravureFaite + GRAVURE_EN_LECTURE - performance.now() : GRAVURE_EN_ECRIVANT;
    const graverMaintenant = () => {
      gravureAttendue = null;
      if (!e.ouverte || e.affichage !== "partition") return;
      gravureFaite = performance.now();
      const memes = gravee && gravee.mesures === sq.nbMesures(e.seq);
      if (transport.actif) gravureRapide = true;
      graverPartition({ unPassage: transport.actif || memes });
      selection.placer();
    };
    if (attente <= 0) graverMaintenant();
    else gravureAttendue = setTimeout(graverMaintenant, attente);
  }
  /** La lecture s'arrête : la partition gravée d'un seul passage retrouve sa mise en page ajustée. */
  function apresLecture() {
    if (!gravureRapide || !e.ouverte || e.affichage !== "partition") return;
    gravureRapide = false;
    gravee = null;
    rafraichir();
  }

  function majCommandes() {
    const k = e.seq;
    $("idee-resume").textContent = `${k.tempo} · ${k.mesure.join("/")} · ${sq.nomTonalite(k.tonalite)}`;
    const dit = `Tempo ${k.tempo}, mesure ${k.mesure.join("/")}, ${sq.nomTonalite(k.tonalite)} : changer`;
    $("idee-reglages-bouton").title = dit;
    $("idee-reglages-bouton").setAttribute("aria-label", dit);
    tempo.maj();
    $("idee-boucle").setAttribute("aria-pressed", String(e.boucle));
    $("idee-metronome").setAttribute("aria-pressed", String(e.metronome));
    $("idee-annuler").disabled = !e.annuler.length || !!e.enregistrement;
    $("idee-refaire").disabled = !e.refaire.length || !!e.enregistrement;
    // Les pistes : une puce dans la barre (dès qu'il y en a deux), le choix dans la feuille Tempo.
    $("idee-piste-puce").hidden = k.pistes.length < 2;
    $("idee-piste-puce").textContent = k.pistes[e.piste].nom;
    $("idee-piste-puce").setAttribute("aria-label", `Piste : ${k.pistes[e.piste].nom} (toucher pour changer)`);
    // Une note choisie : la rangée de la sélection se glisse au-dessus du
    // mode, qui se resserre ; le pupitre garde sa hauteur, la grille ne bouge pas.
    $("idee-pupitre").classList.toggle("avec-selection", e.selection.size > 0);
    clavierMode.maj();
    selection.maj();
    accords.maj();
    direct.maj();
    chant.maj();
    if (!e.enregistrement) {
      const sel = choisies();
      $("idee-mode").textContent = sel.length ? "Le clavier change la note choisie" : "";
    }
  }

  // --- La partition (gravée par abcjs) ----------------------------------------------

  let miseEnPage = null; // { largeur, parLigne, largeurPortee } : celle de la dernière gravure ajustée
  /** @param o { unPassage : pendant la lecture, une seule gravure, avec la mise en page d'avant (M2) } */
  function graverPartition({ unPassage = false } = {}) {
    const lib = deps.abcjs();
    const zone = $("idee-gravure");
    if (!lib) { zone.textContent = "La partition n'a pas pu se charger (connexion ?). La grille marche sans."; return; }
    const { largeur, hauteur } = tailleGravure();
    const toutes = voixCompletes(e.seq);
    const couleur = getComputedStyle(document.body).getPropertyValue("--stylo").trim() || "#2B48B0";
    // La gravure remplit la place de la grille. Au téléphone, deux mesures
    // par ligne, assez grandes pour se lire et se toucher au doigt ; une
    // idée courte en prend moins par ligne, ou se grave plus grand, plutôt
    // que de laisser un grand vide sous la portée. Bornes : la portée
    // agrandie deux fois au plus au téléphone (1,6 fois sur un grand écran),
    // et assez de place par mesure pour que les notes ne se touchent pas.
    const mesures = sq.nbMesures(e.seq);
    const agrandiMax = largeur < 700 ? 2 : 1.6;
    const etroite = largeur / agrandiMax; // la portée la plus étroite permise
    let parLigne = Math.max(1, Math.min(6, Math.floor(largeur / 170)));
    let largeurPortee = parLigne * 200, h = 0, objet = null, jetons = [];
    const reprise = unPassage && miseEnPage && miseEnPage.largeur === largeur;
    if (reprise) ({ parLigne, largeurPortee } = miseEnPage);
    const graver = () => {
      const ecrit = sq.ecrireAbc(e.seq, { voix: toutes, mesuresParLigne: parLigne });
      jetons = ecrit.jetons;
      [objet] = lib.renderAbc(zone, ecrit.abc, {
        responsive: "resize", add_classes: true, paddingtop: 6, paddingbottom: 6, paddingleft: 0, paddingright: 0,
        staffwidth: largeurPortee,
        clickListener: surClicPartition, selectTypes: ["note"], selectionColor: couleur,
      });
      h = zone.getBoundingClientRect().height;
    };
    graver();
    // Pas plus de 420 px par mesure : sur un grand écran, une ligne de plus
    // pour remplir la hauteur étalerait les notes d'un bord à l'autre.
    const moinsParLigne = Math.max(1, Math.floor(largeur / 420));
    while (!reprise && parLigne > moinsParLigne && h < hauteur * 0.6) {
      // La hauteur qu'aurait la gravure avec une mesure de moins par ligne.
      const autre = Math.max((parLigne - 1) * 200, etroite);
      const ensuite = h * (largeurPortee / autre) * (Math.ceil(mesures / (parLigne - 1)) / Math.ceil(mesures / parLigne));
      if (ensuite > hauteur) break;
      parLigne--;
      largeurPortee = autre;
      graver();
    }
    if (!reprise && h < hauteur * 0.6) {
      // Encore de la place : les mêmes lignes, gravées plus grand.
      const voulue = Math.max(parLigne * 130, etroite, (largeurPortee * h) / (hauteur * 0.85));
      if (voulue < largeurPortee - 10) { largeurPortee = Math.round(voulue); graver(); }
    }
    if (!reprise) miseEnPage = { largeur, parLigne, largeurPortee };
    e.jetons = jetons;
    e.elements = new Map();
    dernierJeton = null;
    for (const ligne of (objet && objet.lines) || []) {
      for (const portee of ligne.staff || []) {
        for (const voix of portee.voices || []) {
          for (const el of voix) {
            if (el.el_type !== "note" || !el.abselem) continue;
            const j = sq.jetonA(jetons, el.startChar);
            if (j) e.elements.set(j, (el.abselem.elemset || []).filter(Boolean));
          }
        }
      }
    }
    gravee = { id: e.id, version: e.version, largeur, hauteur, mesures };
    marquerChoisies();
  }

  /** Les notes choisies en couleur sur la gravure en place, et le curseur : sans rien regraver. */
  function marquerChoisies() {
    for (const [j, els] of e.elements) {
      const oui = j.voix === e.piste && j.ids.some((id) => e.selection.has(id));
      els.forEach((x) => x.classList.toggle("choisie", oui));
    }
    placerCaret();
  }

  function surClicPartition(abcelem) {
    const j = sq.jetonA(e.jetons, abcelem.startChar);
    if (!j) return;
    if (j.voix >= e.seq.pistes.length) { toast("L'accompagnement suit les accords : touche un accord, dans la grille, pour le changer."); return; }
    if (j.voix !== e.piste) e.piste = j.voix;
    if (j.silence) { e.selection.clear(); e.curseur = j.a; rafraichir(); return; }
    choisir(j.ids);
  }

  /** Le curseur sur la partition : un trait avant la note où le clavier écrira. */
  function placerCaret() {
    const caret = $("idee-caret");
    const zone = $("idee-partition");
    const candidats = e.jetons.filter((j) => j.voix === e.piste && j.couche === 0);
    let j = candidats.find((x) => x.a >= e.curseur);
    let apres = false;
    if (!j) { j = candidats[candidats.length - 1]; apres = true; }
    const els = j && e.elements.get(j);
    caret.hidden = !els || !els.length || e.selection.size > 0;
    if (caret.hidden) return;
    const r = els[0].getBoundingClientRect(), z = zone.getBoundingClientRect();
    caret.style.left = `${(apres ? r.right + 6 : r.left - 4) - z.left + zone.scrollLeft}px`;
    caret.style.top = `${r.top - z.top + zone.scrollTop - 18}px`;
    caret.style.height = `${Math.max(40, r.height + 36)}px`;
  }

  // --- La barre du haut ---------------------------------------------------------

  $("idee-titre").addEventListener("change", () => {
    e.titre = $("idee-titre").value.trim() || titreDuJour();
    $("idee-titre").value = e.titre;
    if (deps.titreChange) deps.titreChange(e.titre);
    planifierSauvegarde(0);
  });
  $("idee-titre").addEventListener("keydown", (ev) => { if (ev.key === "Enter") $("idee-titre").blur(); });
  $("idee-affichage").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-affichage]");
    if (!b || b.dataset.affichage === e.affichage) return;
    e.affichage = b.dataset.affichage;
    ecrirePref("portee:affichage-idee", e.affichage);
    transport.arreter();
    afficherAffichage();
    rafraichir();
  });
  $("idee-reglages-bouton").addEventListener("click", () => ouvrirFeuille($("idee-reglages")));
  $("idee-plus").addEventListener("click", () => ouvrirFeuille($("idee-menu")));
  $("idee-piste-puce").addEventListener("click", () => tempo.changerPiste((e.piste + 1) % e.seq.pistes.length));
  $("idee-menu").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-menu]");
    if (!b) return;
    fermerFeuille($("idee-menu"));
    if (b.dataset.menu === "infos") { carnet.afficher(); ouvrirFeuille($("idee-infos")); return; }
    if (b.dataset.menu === "reglages") { ouvrirFeuille($("idee-reglages")); return; }
    await sauverMaintenant();
    const p = partitionCourante();
    if (!p) { toast("L'idée est vide : joue au moins une note."); return; }
    deps.menu(b.dataset.menu, p);
  });
  $("idee-partager").addEventListener("click", async () => {
    await sauverMaintenant();
    const p = partitionCourante();
    if (!p) { toast("L'idée est vide : joue au moins une note."); return; }
    deps.partager(p);
  });

  // --- Le transport -------------------------------------------------------------

  $("idee-jouer").addEventListener("click", jouer);
  $("idee-boucle").addEventListener("click", () => {
    e.boucle = !e.boucle;
    transport.regler({ boucle: e.boucle ? etendueBoucle() : null });
    rafraichir();
  });
  $("idee-metronome").addEventListener("click", () => {
    e.metronome = !e.metronome;
    transport.regler({ metronome: e.metronome });
    rafraichir();
  });
  $("idee-annuler").addEventListener("click", () => revenir(e.annuler, e.refaire));
  $("idee-refaire").addEventListener("click", () => revenir(e.refaire, e.annuler));
  new ResizeObserver(() => { if (e.ouverte) rafraichir(); }).observe($("idee-surface"));
  $("idee-partition").addEventListener("scroll", () => selection.placer());

  const sauverMaintenant = () => ecritures.vider();

  function partitionCourante() {
    if (!e.id) return null;
    return { id: e.id, ...donnees(), creeLe: e.creeLe };
  }

  // --- Le clavier de l'ordinateur -----------------------------------------------------

  /** Rend true si la touche a servi. */
  function toucheBas(ev) {
    if (!e.ouverte) return false;
    // Une feuille ou une fenêtre ouverte (celle de l'appli aussi, « Supprimer l'idée ? »),
    // ou le menu en cercle : les touches sont à eux, Échap les ferme (I6).
    if (document.querySelector("dialog[open]") || selection.menuOuvert) return false;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { revenir(ev.shiftKey ? e.refaire : e.annuler, ev.shiftKey ? e.annuler : e.refaire); return true; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { revenir(e.refaire, e.annuler); return true; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") { selection.tout(); return true; }
    if (ev.shiftKey && ev.code === "ArrowRight") { selection.etendre(); return true; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    if (clavierMode.toucheBas(ev)) return true;
    const actions = {
      Space: jouer,
      KeyR: direct.basculer,
      // Capturer la dernière phrase jouée, avec son rythme (M13, comme dans Live).
      KeyC: direct.capturer,
      Digit1: () => choisirDuree(1), Digit2: () => choisirDuree(2), Digit3: () => choisirDuree(4), Digit4: () => choisirDuree(8), Digit5: () => choisirDuree(16),
      Period: basculerPointee, NumpadDecimal: basculerPointee,
      Digit0: silence, Numpad0: silence,
      Backspace: effacer, Delete: effacer,
      ArrowLeft: () => selection.voisine(-1), ArrowRight: () => selection.voisine(1),
      ArrowUp: () => selection.transformer(ev.shiftKey ? "octave-haut" : "monter"),
      ArrowDown: () => selection.transformer(ev.shiftKey ? "octave-bas" : "descendre"),
      Escape: selection.aucune,
    };
    const f = actions[ev.code];
    if (!f) return false;
    f();
    return true;
  }

  function toucheHaut(ev) {
    if (!e.ouverte) return false;
    return clavierMode.toucheHaut(ev);
  }

  /**
   * « Précédent » dans l'éditeur, avant de quitter l'écran : le menu en
   * cercle se ferme, le jeu en direct s'arrête (la feuille de l'arrondi
   * s'ouvre), puis les notes choisies se laissent. Rend true s'il a reculé
   * d'un pas. (Avant, app.js cliquait ces boutons-là lui-même.)
   */
  function reculer() {
    if (selection.menuOuvert) { selection.fermerMenu(); return true; }
    if (e.enregistrement && e.enregistrement.phase !== "arrondi") { direct.arreter(); return true; }
    if (choisies().length) { selection.aucune(); return true; }
    return false;
  }

  return {
    ouvrir, fermer, recharger, occupe, reculer, toucheBas, toucheHaut, enfoncer, relever,
    transformer: (nom) => selection.transformer(nom),
    choisirMode,
    get id() { return e.id; },
    get seq() { return e.seq; },
    get selection() { return e.selection; },
    get ouverte() { return e.ouverte; },
    get curseur() { return e.curseur; },
    get mode() { return e.mode; },
    modifier, rafraichir, choisir,
    etat: e,
  };
}
