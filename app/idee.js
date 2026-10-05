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
 * boucle, métronome), la barre du haut, les feuilles Tempo, ••• et Carnet,
 * et le choix du mode du pupitre. Le reste vit dans des modules qui
 * reçoivent un contexte explicite (ctx, plus bas) et ne partagent rien
 * d'autre :
 *   idee-clavier.js   le mode Clavier (durées, clavier à l'écran, de
 *                     l'ordinateur, MIDI) ;
 *   idee-chant.js     le mode Chanter (micro, accordeur) ;
 *   idee-accords.js   le mode Accords et la feuille des accords ;
 *   idee-selection.js la pilule, la boîte à outils, la rangée de
 *                     sélection, les transformations, le menu en cercle ;
 *   idee-direct.js    le jeu en direct (décompte, enregistrement, recalage).
 *
 * L'idée vit en notes (sequence.js) ; la partition n'en est qu'une
 * traduction. Ce module ne parle à l'appli que par les dépendances qu'on
 * lui passe (stockage, piano, transport, messages).
 */
import { lirePref, ecrirePref } from "./preferences.js";
import * as sq from "./sequence.js";
import { fichierMidi } from "./midi.js";
import { voixCompletes, transposerIdee, STYLES } from "./harmonie.js";
import { creerGrille } from "./grille.js";
import { ico } from "./icones.js";
import { $, dateCourte, echapper } from "./ui.js";
import { confirmer } from "./dialogue.js";
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";
import { creerModeClavier } from "./idee-clavier.js";
import { creerChant, messageMicro } from "./idee-chant.js";
import { creerAccords } from "./idee-accords.js";
import { creerSelection } from "./idee-selection.js";
import { creerDirect } from "./idee-direct.js";
import { tempoDesTapes } from "./transport.js";
import { sessionAudio, garderEveille, laisserDormir } from "./eveil.js";

const MESURES = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8", "2/2"];
const CLE_DEFAUTS = "portee:idee-defauts";
const CLE_MODE = "portee:mode-idee";
const MODES = ["clavier", "chanter", "accords"];

/** Une vignette de l'idée : ses notes en petits traits (pour la bibliothèque). */
export function dessinerApercu(svg, seq) {
  const notes = (seq && seq.pistes || []).flatMap((p) => p.notes);
  svg.setAttribute("viewBox", "0 0 240 120");
  svg.setAttribute("preserveAspectRatio", "none");
  if (!notes.length) { svg.innerHTML = ""; return; }
  const fin = Math.max(sq.pasParMesure(seq) * 2, ...notes.map((n) => n.d + n.l));
  const bas = Math.min(...notes.map((n) => n.h)) - 2, haut = Math.max(...notes.map((n) => n.h)) + 2;
  const ex = 228 / fin, ey = 104 / Math.max(12, haut - bas);
  svg.innerHTML = notes.map((n) => `<rect class="apercu-note" x="${6 + n.d * ex}" y="${8 + (haut - n.h) * ey - 2}" width="${Math.max(2, n.l * ex - 1)}" height="4" rx="2"/>`).join("");
}

/** Le MIDI d'une idée (pistes, accompagnement compris). */
export function midiDeLIdee(p, { transposition = 0 } = {}) {
  const seq = p.sequence;
  const k = sq.lireTonalite(seq.tonalite);
  return fichierMidi(voixCompletes(seq), { tempo: seq.tempo, mesure: seq.mesure, quintes: k.quintes, mineur: k.mineur, titre: p.titre, transposition });
}

const titreDuJour = () => `Idée du ${dateCourte(new Date().toISOString())}`;

function defauts() {
  try { return { tempo: 90, mesure: [4, 4], tonalite: "C", ...JSON.parse(lirePref(CLE_DEFAUTS) || "{}") }; } catch { return { tempo: 90, mesure: [4, 4], tonalite: "C" }; }
}

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
    sauvegarde: Promise.resolve(), minuterie: null, ouverte: false,
  };
  const tenues = new Map(); // hauteur → note qui sonne (piano)
  // Le tempo se règle par petits pas (−, +, le curseur) : on l'affiche tout
  // de suite, on ne l'écrit qu'une fois le geste fini (un seul « Annuler »).
  let tempoEnAttente = null, minuterieTempo = null;

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

  $("idee-mesure").innerHTML = MESURES.map((m) => `<option value="${m}">${m}</option>`).join("");
  $("idee-tonalite").innerHTML = sq.TONALITES.map((t) => `<option value="${t}">${sq.nomTonalite(t)}</option>`).join("");
  $("idee-accomp").innerHTML = STYLES.map((s) => `<option value="${s.id}">${s.nom}</option>`).join("");
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
    e.ouverte = true;
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
    afficherInfos();
    if (memo) { ouvrirFeuille($("idee-infos")); memoEnregistrer(); }
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
    if (enregistreur) enregistreur.stop();
    if (lecteurMemo) { lecteurMemo.pause(); lecteurMemo = null; }
    for (const h of [...tenues.keys()]) relever(h);
    // Une pédale restée enfoncée ne doit pas tenir les notes des autres écrans.
    piano.pedale(false);
    if (e.minuterie) { clearTimeout(e.minuterie); e.minuterie = null; sauver(); }
    await e.sauvegarde;
  }

  /** L'idée a changé sur un autre appareil : on la reprend, sauf modification en cours ici. */
  function recharger(p) {
    if (!e.ouverte || p.id !== e.id || e.minuterie || e.enregistrement) return false;
    e.titre = p.titre;
    e.seq = sq.cloner(p.sequence);
    e.note = p.note || ""; e.etiquettes = p.etiquettes || []; e.favori = !!p.favori; e.memo = p.memo || null;
    afficherInfos();
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

  function planifierSauvegarde(delai = 700) {
    clearTimeout(e.minuterie);
    $("idee-etat").textContent = "Enregistrement…";
    e.minuterie = setTimeout(() => { e.minuterie = null; sauver(); }, delai);
  }

  // Une idée sans note, sans accord, sans mot ni mémo ne s'enregistre pas.
  const vide = () => e.seq.pistes.every((p) => !p.notes.length) && !(e.seq.accords || []).length && !e.memo && !e.note && !e.etiquettes.length;

  function donnees() {
    const { abc } = sq.ecrireAbc(e.seq, { voix: voixCompletes(e.seq), titre: e.titre });
    return {
      type: "idee", titre: e.titre, sequence: sq.cloner(e.seq), abc, statut: "idee", nbPages: 0, modele: null, tempo: e.seq.tempo,
      note: e.note, etiquettes: e.etiquettes, favori: e.favori, memo: e.memo,
    };
  }

  /** Enregistre (les écritures se suivent, jamais deux à la fois). */
  function sauver() {
    e.sauvegarde = e.sauvegarde.then(async () => {
      const stockage = deps.stockage();
      if (!stockage) return;
      const maintenant = new Date().toISOString();
      try {
        if (!e.id) {
          if (vide()) { $("idee-etat").textContent = ""; return; } // une idée vide ne s'enregistre pas
          e.id = deps.nouvelId();
          e.creeLe = maintenant;
          await stockage.creer(e.id, { ...donnees(), creeLe: maintenant, modifieLe: maintenant }, []);
        } else {
          await stockage.modifier(e.id, { ...donnees(), modifieLe: maintenant });
        }
        if (e.ouverte) $("idee-etat").textContent = "Enregistrée";
      } catch (err) {
        console.error(err);
        const texte = "Non enregistrée : " + (err.message || err.code || "erreur");
        $("idee-etat").textContent = texte;
        // L'état ne se voit plus dans la barre : une erreur se dit tout haut.
        if (e.ouverte) toast(`L'idée n'a pas pu être enregistrée (${err.message || err.code || "erreur"}).`, 8000);
      }
    });
    return e.sauvegarde;
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

  // --- Le carnet : note, étiquettes, favori, mémo vocal ---------------------------

  function afficherInfos() {
    $("info-note").value = e.note;
    $("info-favori").setAttribute("aria-pressed", String(e.favori));
    $("info-favori").innerHTML = `${ico(e.favori ? "etoile-pleine" : "etoile", "s")}Favori`;
    $("info-favori").setAttribute("aria-label", e.favori ? "Favori (toucher pour retirer)" : "Mettre en favori");
    const zone = $("info-etiquettes");
    zone.textContent = "";
    for (const t of e.etiquettes) {
      const span = document.createElement("span");
      span.className = "etiquette";
      span.textContent = t;
      const x = document.createElement("button");
      x.type = "button"; x.innerHTML = ico("fermer", "s"); x.setAttribute("aria-label", `Retirer l'étiquette ${t}`);
      x.addEventListener("click", () => { e.etiquettes = e.etiquettes.filter((y) => y !== t); afficherInfos(); planifierSauvegarde(0); });
      span.appendChild(x);
      zone.appendChild(span);
    }
    const connues = deps.etiquettes ? deps.etiquettes().filter((t) => !e.etiquettes.includes(t)) : [];
    $("info-etiquettes-connues").innerHTML = connues.map((t) => `<option value="${echapper(t)}">`).join("");
    $("memo-ecouter").hidden = $("memo-effacer").hidden = !e.memo || !!enregistreur;
    if (!enregistreur) {
      $("memo-enregistrer-texte").textContent = e.memo ? "Refaire le mémo" : "Enregistrer un mémo";
      $("memo-etat").textContent = e.memo ? `${e.memo.duree} s` : "";
    }
  }

  let enregistreur = null, lecteurMemo = null;

  const enBase64 = (blob) => new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });
  const depuisBase64 = (memo) => {
    const octets = Uint8Array.from(atob(memo.base64), (c) => c.charCodeAt(0));
    return new Blob([octets], { type: memo.type || "audio/mp4" });
  };

  async function memoEnregistrer() {
    if (enregistreur) { enregistreur.stop(); return; }
    if (!window.MediaRecorder || !navigator.mediaDevices) { toast("Ce navigateur ne sait pas enregistrer de son."); return; }
    transport.arreter();
    // Le mémo prend le micro : l'accordeur le rend (il reprendra en revenant au mode Chanter).
    if (e.modeOuvert && e.mode === "chanter") choisirMode("clavier");
    let flux;
    // Sur l'iPhone, le micro demande une session « enregistrer et jouer », rendue à « jouer » à la fin :
    // sans quoi le piano obéirait de nouveau au bouton silencieux (eveil.js, M8).
    sessionAudio("play-and-record");
    try {
      flux = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      sessionAudio("playback");
      toast(messageMicro(err), 9000);
      return;
    }
    // Le format que lisent tous les appareils d'abord (Safari enregistre en MP4).
    const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(flux, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    const bouts = [];
    const debut = Date.now();
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) bouts.push(ev.data); };
    const montre = setInterval(() => {
      const s = Math.round((Date.now() - debut) / 1000);
      $("memo-etat").textContent = `0:${String(s).padStart(2, "0")} / 1:00`;
      if (s >= 60) rec.stop();
    }, 250);
    rec.onstop = async () => {
      clearInterval(montre);
      for (const piste of flux.getTracks()) piste.stop();
      sessionAudio("playback");
      laisserDormir("memo");
      enregistreur = null;
      $("memo-enregistrer").setAttribute("aria-pressed", "false");
      const blob = new Blob(bouts, { type: rec.mimeType || type || "audio/webm" });
      const duree = Math.max(1, Math.round((Date.now() - debut) / 1000));
      if (!blob.size) { afficherInfos(); return; }
      await garderMemo({ type: blob.type, base64: await enBase64(blob), duree });
      toast("Mémo gardé avec l'idée.");
    };
    rec.start(1000);
    // Une minute sans toucher l'écran : il s'éteindrait en plein mémo, et l'iPhone couperait le micro.
    garderEveille("memo");
    enregistreur = rec;
    $("memo-enregistrer").setAttribute("aria-pressed", "true");
    $("memo-enregistrer-texte").textContent = "Arrêter le mémo";
    $("memo-ecouter").hidden = $("memo-effacer").hidden = true;
  }

  /** Garde le mémo (ou l'efface, avec null) : la fiche d'abord, puis le son. */
  async function garderMemo(memo) {
    e.memo = memo ? { duree: memo.duree, type: memo.type } : null;
    clearTimeout(e.minuterie); e.minuterie = null;
    await sauver();
    if (e.id) await deps.stockage().ecrireMemo(e.id, memo).catch((err) => toast("Le mémo n'a pas pu être gardé : " + (err.message || err)));
    afficherInfos();
  }

  const boutonMemo = (lit) => { $("memo-ecouter").innerHTML = `${ico(lit ? "stop" : "lire", "s")}<span>${lit ? "Arrêter" : "Écouter"}</span>`; };
  async function memoEcouter() {
    if (lecteurMemo) { lecteurMemo.pause(); lecteurMemo = null; boutonMemo(false); return; }
    const memo = e.id ? await deps.stockage().lireMemo(e.id).catch(() => null) : null;
    if (!memo) { toast("Le son de ce mémo n'est pas encore arrivé sur cet appareil (synchronisation)."); return; }
    lecteurMemo = new Audio(URL.createObjectURL(depuisBase64(memo)));
    boutonMemo(true);
    lecteurMemo.onended = () => { lecteurMemo = null; boutonMemo(false); };
    lecteurMemo.play().catch(() => { lecteurMemo = null; boutonMemo(false); toast("Ce navigateur ne sait pas lire ce mémo."); });
  }

  $("info-fermer").addEventListener("click", () => fermerFeuille($("idee-infos")));
  $("info-favori").addEventListener("click", () => { e.favori = !e.favori; afficherInfos(); planifierSauvegarde(0); });
  $("info-note").addEventListener("input", () => { e.note = $("info-note").value; planifierSauvegarde(); });
  $("info-etiquette-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = $("info-etiquette").value.trim().toLowerCase();
    if (t && !e.etiquettes.includes(t)) { e.etiquettes = [...e.etiquettes, t]; planifierSauvegarde(0); }
    $("info-etiquette").value = "";
    afficherInfos();
  });
  $("memo-enregistrer").addEventListener("click", memoEnregistrer);
  $("memo-ecouter").addEventListener("click", memoEcouter);
  // La même question que partout ailleurs (dialogue.js), dans l'ambiance de l'appli.
  $("memo-effacer").addEventListener("click", async () => {
    if (await confirmer({ titre: "Effacer le mémo vocal ?", texte: "Son enregistrement part avec lui. C'est définitif.", oui: "Effacer" })) garderMemo(null);
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
    if (tempoEnAttente === null) { $("idee-tempo").value = k.tempo; $("idee-tempo-val").textContent = k.tempo; }
    const mesure = k.mesure.join("/");
    $("idee-mesure").value = mesure;
    $("idee-mesures").querySelectorAll("[data-mesure]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mesure === mesure)));
    $("idee-tonalite").value = k.tonalite;
    $("idee-accomp").value = k.accompagnement || "aucun";
    $("idee-boucle").setAttribute("aria-pressed", String(e.boucle));
    $("idee-metronome").setAttribute("aria-pressed", String(e.metronome));
    $("idee-annuler").disabled = !e.annuler.length || !!e.enregistrement;
    $("idee-refaire").disabled = !e.refaire.length || !!e.enregistrement;
    // Les pistes : une puce dans la barre (dès qu'il y en a deux), le choix dans la feuille Tempo.
    const plusieurs = k.pistes.length > 1;
    $("idee-piste-puce").hidden = !plusieurs;
    $("idee-piste-puce").textContent = k.pistes[e.piste].nom;
    $("idee-piste-puce").setAttribute("aria-label", `Piste : ${k.pistes[e.piste].nom} (toucher pour changer)`);
    $("idee-pistes").hidden = !plusieurs;
    $("idee-pistes").innerHTML = plusieurs ? k.pistes.map((p, i) => `<button data-piste="${i}" aria-pressed="${i === e.piste}">${echapper(p.nom)}</button>`).join("") : "";
    $("idee-basse").hidden = plusieurs;
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
  $("idee-piste-puce").addEventListener("click", () => changerPiste((e.piste + 1) % e.seq.pistes.length));
  $("idee-menu").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-menu]");
    if (!b) return;
    fermerFeuille($("idee-menu"));
    if (b.dataset.menu === "infos") { afficherInfos(); ouvrirFeuille($("idee-infos")); return; }
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

  // --- La feuille Tempo et mesure ---------------------------------------------------

  const reglage = (f) => { modifier(f); memoriserDefauts(); };
  function changerTempo(t) {
    t = Math.max(40, Math.min(240, Math.round(t)));
    tempoEnAttente = t;
    $("idee-tempo-val").textContent = t;
    $("idee-tempo").value = t;
    clearTimeout(minuterieTempo);
    minuterieTempo = setTimeout(() => {
      const v = tempoEnAttente;
      tempoEnAttente = null;
      if (v !== e.seq.tempo) reglage(() => { e.seq.tempo = v; });
    }, 350);
  }
  const tempoAffiche = () => (tempoEnAttente ?? e.seq.tempo);
  $("idee-tempo").addEventListener("input", () => changerTempo(Number($("idee-tempo").value)));
  $("idee-tempo-moins").addEventListener("click", () => changerTempo(tempoAffiche() - 1));
  $("idee-tempo-plus").addEventListener("click", () => changerTempo(tempoAffiche() + 1));
  const tapes = [];
  $("idee-taper").addEventListener("click", () => {
    const t = performance.now();
    if (tapes.length && t - tapes[tapes.length - 1] > 2000) tapes.length = 0;
    tapes.push(t);
    if (tapes.length > 6) tapes.shift();
    if (tapes.length < 3) { $("idee-taper-texte").textContent = "Encore…"; return; }
    $("idee-taper-texte").textContent = "Taper le tempo";
    const ecarts = tapes.slice(1).map((x, i) => x - tapes[i]);
    // On tape les temps de la mesure, ceux que bat le métronome (la noire pointée en 6/8, la blanche
    // en 2/2) ; l'idée garde des noires par minute (M12). Avant, en 12/8, le métronome battait aux
    // deux tiers de ce qu'on avait tapé.
    changerTempo(tempoDesTapes(ecarts, sq.pasParTemps(e.seq)));
  });
  const changerMesure = (m) => reglage(() => { e.seq.mesure = m.split("/").map(Number); });
  $("idee-mesure").addEventListener("change", () => changerMesure($("idee-mesure").value));
  $("idee-mesures").addEventListener("click", (ev) => { const b = ev.target.closest("[data-mesure]"); if (b) changerMesure(b.dataset.mesure); });
  $("idee-tonalite").addEventListener("change", () => reglage(() => { e.seq.tonalite = $("idee-tonalite").value; }));
  $("idee-transp-moins").addEventListener("click", () => modifier(() => transposerIdee(e.seq, -1)));
  $("idee-transp-plus").addEventListener("click", () => modifier(() => transposerIdee(e.seq, 1)));
  $("idee-accomp").addEventListener("change", () => modifier(() => { e.seq.accompagnement = $("idee-accomp").value; }));
  $("idee-reglages").querySelector(".idee-zoom").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-zoom]");
    if (b) grille.zoom(Number(b.dataset.facteur), b.dataset.zoom);
  });

  // Les pistes
  function changerPiste(i) {
    e.piste = i;
    e.selection.clear();
    e.curseur = Math.max(0, ...notesPiste().map((n) => n.d + n.l));
    clavierMode.amener(notesPiste().length ? notesPiste()[notesPiste().length - 1].h : (e.seq.pistes[i].cle === "fa" ? 36 : 60));
    rafraichir();
  }
  $("idee-basse").addEventListener("click", () => {
    modifier(() => { e.seq.pistes.push({ nom: "Basse", cle: "fa", notes: [] }); e.piste = e.seq.pistes.length - 1; e.selection.clear(); e.curseur = 0; });
    clavierMode.amener(36);
    fermerFeuille($("idee-reglages"));
    toast("Piste de basse : ce que tu joues va maintenant dans la basse. Touche « Basse », en haut, pour revenir à la mélodie.", 6000);
  });
  $("idee-pistes").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-piste]");
    if (b) changerPiste(Number(b.dataset.piste));
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

  function memoriserDefauts() {
    ecrirePref(CLE_DEFAUTS, JSON.stringify({ tempo: e.seq.tempo, mesure: e.seq.mesure, tonalite: e.seq.tonalite }));
  }

  async function sauverMaintenant() {
    if (e.minuterie) { clearTimeout(e.minuterie); e.minuterie = null; sauver(); }
    await e.sauvegarde;
  }

  function partitionCourante() {
    if (!e.id) return null;
    return { id: e.id, ...donnees(), creeLe: e.creeLe };
  }

  // --- Le clavier de l'ordinateur -----------------------------------------------------

  /** Rend true si la touche a servi. */
  function toucheBas(ev) {
    if (!e.ouverte) return false;
    // Une feuille ouverte, ou le menu en cercle : les touches sont à eux.
    if (document.querySelector("#vue-idee dialog[open]") || selection.menuOuvert) return false;
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

  return {
    ouvrir, fermer, recharger, toucheBas, toucheHaut, enfoncer, relever,
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
