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
 * Ce module tient le cœur : l'état (e), qu'il est seul à écrire avec les
 * modules qui changent l'idée, annuler et refaire, le dessin (grille.js ou
 * idee-partition.js), la barre du haut, la feuille •••, et le choix du
 * mode du pupitre. Le reste vit
 * dans des modules qui reçoivent un contexte explicite (ctx, plus bas) et
 * ne partagent rien d'autre ; ceux qui n'ont qu'à lire l'état le reçoivent
 * en lecture seule (le clavier, le chant, la partition) :
 *   idee-clavier.js   le mode Clavier (durées, clavier à l'écran, de
 *                     l'ordinateur, MIDI) ;
 *   idee-chant.js     le mode Chanter (micro, accordeur) ;
 *   idee-accords.js   le mode Accords et la feuille des accords ;
 *   idee-selection.js la pilule, la boîte à outils, la rangée de
 *                     sélection, les transformations, le menu en cercle ;
 *   idee-direct.js    le jeu en direct (décompte, enregistrement, recalage) ;
 *   idee-carnet.js    la feuille Carnet (note, étiquettes, favori, mémo vocal) ;
 *   idee-tempo.js     la feuille Tempo et mesure (et les pistes) ;
 *   idee-partition.js la partition gravée par abcjs (et sa mise en page) ;
 *   idee-enregistrement.js  les enregistrements dans la bibliothèque ;
 *   idee-ecoute.js    écouter, la boucle, le métronome ;
 *   idee-claude.js    « Demander à Claude » (la version claude.ai) : il lit
 *                     l'état, et n'écrit que par remplacerIdee et changerTitre.
 *
 * L'idée vit en notes (sequence.js) ; la partition n'en est qu'une
 * traduction. Ce module ne parle à l'appli que par les dépendances qu'on
 * lui passe (stockage, piano, transport, messages).
 */
import { lirePref, ecrirePref } from "./preferences.js";
import * as sq from "./sequence.js";
import { creerGrille } from "./grille.js";
import { $, dateCourte } from "./ui.js";
import { egal } from "./fiche.js";
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";
import { creerModeClavier } from "./idee-clavier.js";
import { creerChant } from "./idee-chant.js";
import { creerAccords } from "./idee-accords.js";
import { creerSelection } from "./idee-selection.js";
import { creerDirect } from "./idee-direct.js";
import { creerCarnet } from "./idee-carnet.js";
import { creerTempo, defauts } from "./idee-tempo.js";
import { creerPartition } from "./idee-partition.js";
import { creerEnregistrementIdee } from "./idee-enregistrement.js";
import { creerEcouteIdee } from "./idee-ecoute.js";
import { creerClaude } from "./idee-claude.js";

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
    ouverte: false,
    // L'idée ouverte, pour ses enregistrements : son identifiant, si elle est déjà dans
    // la bibliothèque (`cree`), et la dernière version qu'elle y sait (`derniere`), d'où
    // part la fusion si un autre onglet ou la synchro l'a changée entre-temps (S8).
    session: { id: null, creeLe: null, cree: false, derniere: null },
  };
  const tenues = new Map(); // hauteur → note qui sonne (piano)
  // Les enregistrements de l'idée, un instant après le dernier geste (idee-enregistrement.js).
  const ecritures = creerEnregistrementIdee({
    e, stockage: deps.stockage, nouvelId: deps.nouvelId, toast,
    etat: (texte) => { $("idee-etat").textContent = texte; },
  });

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

  // Écouter, la boucle, le métronome (idee-ecoute.js) : les modules du pupitre en
  // empruntent la source et la pause du micro ; elle, les modules créés plus bas.
  const ecoute = creerEcouteIdee({
    e, $, transport, toast, grille, rafraichir, choisies: () => choisies(),
    chant: () => chant, direct: () => direct, partition: () => partition,
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
    source: ecoute.source, suivreLecture: ecoute.suivre, avantSon: ecoute.avantSon, apresSon: ecoute.apresSon, choisirMode,
    boiteSelection, grille,
    // La boîte à outils de la sélection (idee-selection.js) cache le pupitre : elle a son propre « Annuler ».
    annuler: () => revenir(e.annuler, e.refaire),
    // … et « Demander à Claude » sur les notes choisies (idee-claude.js, créé plus bas).
    demanderAClaude: (options) => claude.ouvrir(options),
  };
  // Ce que ces modules n'ont qu'à lire, ils le lisent en lecture seule : une
  // écriture y lève une erreur, au lieu de changer l'idée sans passer par le
  // cœur (ni « Annuler », ni enregistrement). Audit du 04/10, T3.
  const refuser = (_e, cle) => { throw new TypeError(`L'état de l'éditeur ne s'écrit que dans idee.js (${String(cle)}).`); };
  const lecture = new Proxy(e, { set: refuser, deleteProperty: refuser, defineProperty: refuser });
  const clavierMode = creerModeClavier({ ...ctx, e: lecture });
  const chant = creerChant({ ...ctx, e: lecture });
  const accords = creerAccords(ctx);
  const selection = creerSelection(ctx);
  const direct = creerDirect(ctx);
  const modes = { clavier: clavierMode, chanter: chant, accords };
  // La feuille Tempo et mesure (idee-tempo.js) ; le clavier à l'écran suit la piste choisie.
  const tempo = creerTempo({
    e, $, toast, grille, modifier, rafraichir,
    notesPiste: () => notesPiste(), amener: (h) => clavierMode.amener(h),
  });
  // La partition gravée (idee-partition.js) : ce qu'un toucher veut dire, c'est le cœur qui le décide.
  const partition = creerPartition({
    e: lecture, $, transport, abcjs: deps.abcjs, rafraichir,
    surClic: surClicPartition, apresGravure: () => selection.placer(),
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
    partition.oublier();
    // Une idée née d'une partition (« continuer en idée ») s'enregistre tout de suite.
    if (!p && seq) planifierSauvegarde(0);
    $("idee-titre").value = e.titre;
    $("idee-etat").textContent = "";
    for (const f of feuilles) fermerFeuille(f);
    accords.fermer();
    // Une demande à Claude pour l'idée d'avant ne vaut pas pour celle-ci.
    claude.fermer();
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
    claude.fermer();
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

  /** Enregistre un instant après le dernier geste (idee-enregistrement.js). */
  function planifierSauvegarde(delai) { ecritures.planifier(delai); }

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
    return e.affichage === "grille" ? grille.boite([...e.selection]) : partition.boite();
  }

  /** On a touché la partition : une note se choisit, un silence y place le curseur. */
  function surClicPartition(j) {
    if (j.voix >= e.seq.pistes.length) { toast("L'accompagnement suit les accords : touche un accord, dans la grille, pour le changer."); return; }
    if (j.voix !== e.piste) e.piste = j.voix;
    if (j.silence) { e.selection.clear(); e.curseur = j.a; rafraichir(); return; }
    choisir(j.ids);
  }

  // --- Le carnet : note, étiquettes, favori, mémo vocal (idee-carnet.js) ----------

  const carnet = creerCarnet({
    e, $, toast, transport, etiquettes: deps.etiquettes, stockage: deps.stockage,
    planifierSauvegarde, sauverMaintenant: () => ecritures.vider(), choisirMode,
  });

  // --- Demander à Claude (idee-claude.js), dans la version claude.ai ------------------
  //
  // Il lit l'état en lecture seule, et n'écrit que par ces deux méthodes : le
  // lot architecture a fermé l'état exprès, on ne le rouvre pas pour lui.

  /**
   * Ce qu'Adrien garde de ce que Claude propose : toute la séquence, d'un
   * coup, par `modifier` (un seul « Annuler » la défait). `choisir` : les
   * notes à choisir ensuite (une variation des notes choisies) ; sinon la
   * sélection garde ce qui existe encore. `curseurALaFin` : après une suite,
   * on continue d'écrire au bout.
   */
  function remplacerIdee(seq, { choisir = null, curseurALaFin = false } = {}) {
    modifier(() => {
      e.seq = sq.cloner(seq);
      if (!e.seq.pistes[e.piste]) e.piste = 0;
      const restent = new Set(notesPiste().map((n) => n.id));
      e.selection = new Set((choisir || [...e.selection]).filter((id) => restent.has(id)));
      if (curseurALaFin) e.curseur = sq.finSequence(e.seq);
    });
  }

  /** Le titre et les étiquettes proposés, retouchés par Adrien : comme s'il les avait écrits (hors d'« Annuler », comme eux). */
  function changerTitre(titre, etiquettes) {
    e.titre = titre || titreDuJour();
    e.etiquettes = [...etiquettes];
    $("idee-titre").value = e.titre;
    if (deps.titreChange) deps.titreChange(e.titre);
    carnet.afficher();
    planifierSauvegarde(0);
  }

  const claude = creerClaude({
    e: lecture, $, transport, toast, avantSon: ecoute.avantSon, apresSon: ecoute.apresSon,
    etiquettes: deps.etiquettes, remplacerIdee, changerTitre,
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
        boucle: e.boucle ? ecoute.etendueBoucle() : null, pas: Math.min(dureeCourante(), sq.pasParTemps(e.seq)),
        mesureChoisie: e.mesureChoisie, accordsVisibles: true,
      });
    } else partition.planifier();
    selection.placer();
  }

  function majCommandes() {
    const k = e.seq;
    $("idee-resume").textContent = `${k.tempo} · ${k.mesure.join("/")} · ${sq.nomTonalite(k.tonalite)}`;
    const dit = `Tempo ${k.tempo}, mesure ${k.mesure.join("/")}, ${sq.nomTonalite(k.tonalite)} : changer`;
    $("idee-reglages-bouton").title = dit;
    $("idee-reglages-bouton").setAttribute("aria-label", dit);
    tempo.maj();
    ecoute.maj();
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
    // Une feuille de l'éditeur, comme les deux d'avant : elle a besoin de l'idée telle qu'elle est
    // à l'écran (sa sélection), et « Ce que tu veux » sert aussi sur une idée encore vide.
    if (b.dataset.menu === "claude") { claude.ouvrir(); return; }
    await sauverMaintenant();
    const p = ecritures.fiche();
    if (!p) { toast("L'idée est vide : joue au moins une note."); return; }
    deps.menu(b.dataset.menu, p);
  });
  $("idee-partager").addEventListener("click", async () => {
    await sauverMaintenant();
    const p = ecritures.fiche();
    if (!p) { toast("L'idée est vide : joue au moins une note."); return; }
    deps.partager(p);
  });

  // --- Annuler, refaire, la place qui change -----------------------------------------

  $("idee-annuler").addEventListener("click", () => revenir(e.annuler, e.refaire));
  $("idee-refaire").addEventListener("click", () => revenir(e.refaire, e.annuler));
  new ResizeObserver(() => { if (e.ouverte) rafraichir(); }).observe($("idee-surface"));
  $("idee-partition").addEventListener("scroll", () => selection.placer());

  const sauverMaintenant = () => ecritures.vider();

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
      Space: ecoute.jouer,
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

  // Ce dont l'appli se sert, rien de plus (T3) : l'état (`etat: e`), `modifier`,
  // `choisir` et les touches du piano en sortaient, et rien ne s'en servait.
  // Un module qui en aurait besoin le demandera ici, en lecture seule si
  // lire lui suffit.
  return {
    ouvrir, fermer, recharger, occupe, reculer, toucheBas, toucheHaut,
    /** L'idée ouverte (null : une nouvelle, pas encore enregistrée). */
    get id() { return e.id; },
    // Les suggestions de Claude (H3, suggestions-ui.js) : lire l'idée telle qu'elle est, puis la
    // changer d'un geste. Ce n'est pas un rechargement : un seul pas d'« Annuler » (T3 : l'API
    // ne s'élargit qu'au besoin).
    /** L'idée telle qu'elle est maintenant, avec ce qui n'est pas encore enregistré (null : pas encore enregistrée). */
    fiche: () => ecritures.fiche(),
    /**
     * Pose la fiche `f` de l'idée ouverte comme un seul geste : ses notes et
     * ses accords en un pas d'« Annuler » ; son titre, ses étiquettes et sa
     * note suivent, comme dans le carnet. Rend false si ce n'est plus elle.
     */
    changer(f) {
      if (!e.ouverte || !f || f.id !== e.id) return false;
      e.titre = f.titre;
      e.etiquettes = Array.isArray(f.etiquettes) ? [...f.etiquettes] : [];
      e.note = typeof f.note === "string" ? f.note : "";
      $("idee-titre").value = e.titre;
      if (deps.titreChange) deps.titreChange(e.titre);
      carnet.afficher();
      // Les mêmes notes (un titre, une étiquette) : rien à annuler dans la grille, l'idée s'enregistre.
      if (egal(f.sequence, e.seq)) { rafraichir(); planifierSauvegarde(0); return true; }
      modifier(() => {
        e.seq = sq.cloner(f.sequence);
        if (!e.seq.pistes[e.piste]) e.piste = 0;
        e.selection = new Set();
        e.curseur = Math.min(e.curseur, sq.finSequence(e.seq));
      });
      return true;
    },
  };
}
