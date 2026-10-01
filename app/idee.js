/**
 * L'ÉDITEUR D'IDÉE
 *
 * Noter une mélodie, une phrase, une grille, là où elle vient, téléphone en
 * main. Tout part du clavier (à l'écran, de l'ordinateur ou MIDI) et du
 * micro, et tout se corrige au doigt, dans la grille ou sur la partition :
 *
 *   - sans note choisie, une touche écrit à la suite, comme dans un texte
 *     (à la place du curseur, de la durée choisie ; plusieurs doigts font
 *     un accord) ;
 *   - avec une note choisie, une touche lui donne sa hauteur : on essaie
 *     jusqu'à ce que ça sonne juste ;
 *   - « Enregistrer » : un décompte, le métronome, et on joue en direct ;
 *     les notes se recalent sur la grille ;
 *   - tout s'annule, tout s'enregistre tout seul (et se synchronise).
 *
 * L'idée vit en notes (sequence.js) ; la partition n'en est qu'une
 * traduction. Ce module ne parle à l'appli que par les dépendances qu'on
 * lui passe (stockage, piano, transport, messages).
 */
import * as sq from "./sequence.js";
import { fichierMidi } from "./midi.js";
import { voixCompletes, transposerIdee, STYLES, suggerer, harmoniser, accordsDeLaTonalite, lireAccord, nomRacine, joliAccord, QUALITES } from "./harmonie.js";
import { creerClavier } from "./clavier.js";
import { creerGrille } from "./grille.js";
import { Micro } from "./micro.js";

const $ = (id) => document.getElementById(id);
const DUREES = [
  { pas: 1, nom: "double croche" }, { pas: 2, nom: "croche" }, { pas: 4, nom: "noire" },
  { pas: 8, nom: "blanche" }, { pas: 16, nom: "ronde" },
];
const MESURES = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8", "2/2"];
// Le clavier de l'ordinateur, comme dans Ableton : la rangée du milieu pour
// les touches blanches, celle du dessus pour les noires (positions physiques :
// pareil en AZERTY).
const TOUCHES_ORDI = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
const CLE_DEFAUTS = "portee:idee-defauts";

/** Une petite note dessinée, pour les boutons de durée. */
export function iconeDuree(pas) {
  const pleine = pas <= 4, hampe = pas < 16, crochets = pas === 2 ? 1 : pas === 1 ? 2 : 0;
  let s = `<svg viewBox="0 0 20 30" width="16" height="24" aria-hidden="true"><ellipse cx="8" cy="24" rx="5.2" ry="3.8" transform="rotate(-20 8 24)" fill="${pleine ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.6"/>`;
  if (hampe) s += `<line x1="12.6" y1="23" x2="12.6" y2="3" stroke="currentColor" stroke-width="1.6"/>`;
  for (let i = 0; i < crochets; i++) s += `<path d="M12.6 ${3 + i * 6} q6 4 4 11" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
  return s + "</svg>";
}

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

const titreDuJour = () => {
  const d = new Date();
  return `Idée du ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
};

function defauts() {
  try { return { tempo: 90, mesure: [4, 4], tonalite: "C", ...JSON.parse(localStorage.getItem(CLE_DEFAUTS) || "{}") }; } catch { return { tempo: 90, mesure: [4, 4], tonalite: "C" }; }
}

/**
 * @param deps {
 *   piano, transport, stockage() → le stockage ouvert, toast(texte),
 *   nouvelId(), partager(p) (envoie le MIDI), telecharger(p, format),
 *   supprimer(p), dupliquer(p), ajouterAuMorceau(p), titreChange(t),
 *   abcjs() → window.ABCJS, micro (micro.js, facultatif), accords (feuille
 *   des accords, facultative), menuRadial (facultatif)
 * }
 */
export function creerEditeurIdee(deps) {
  const { piano, transport, toast } = deps;
  const e = {
    id: null, creeLe: null, titre: "", seq: null, piste: 0,
    selection: new Set(), curseur: 0,
    duree: 4, pointee: false,
    affichage: localStorage.getItem("portee:affichage-idee") || "grille",
    boucle: false, metronome: false, recalage: 2,
    annuler: [], refaire: [],
    version: 0, enregistrement: null, accordEnCours: null,
    jetons: [], elements: new Map(),
    sauvegarde: Promise.resolve(), minuterie: null, ouverte: false,
  };
  const tenues = new Map(); // hauteur → note qui sonne (piano)

  // --- Construction des morceaux d'interface --------------------------------

  const clavier = creerClavier($("idee-clavier"), { surNote: (h, bas, v) => (bas ? enfoncer(h, v) : relever(h)) });
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
    curseur: (pas) => { e.selection.clear(); e.curseur = pas; rafraichir(); },
    ecouter: (h) => entendre([h]),
    accord: (m, pas) => ouvrirAccords(m, pas),
    menu: (id, x, y) => { if (!e.selection.has(id)) choisir([id]); if (deps.menuRadial) deps.menuRadial.ouvrir(x, y); },
  });

  $("idee-durees").querySelectorAll("[data-pas]").forEach((b) => { b.innerHTML = iconeDuree(Number(b.dataset.pas)); });
  $("idee-mesure").innerHTML = MESURES.map((m) => `<option value="${m}">${m}</option>`).join("");
  $("idee-tonalite").innerHTML = sq.TONALITES.map((t) => `<option value="${t}">${sq.nomTonalite(t)}</option>`).join("");
  $("idee-accomp").innerHTML = STYLES.map((s) => `<option value="${s.id}">${s.nom}</option>`).join("");

  // --- Ouvrir, fermer ---------------------------------------------------------

  /** Ouvre une idée enregistrée, ou une nouvelle (null) qui ne s'enregistre qu'à la première note. */
  function ouvrir(p = null, { seq = null, titre = null } = {}) {
    e.ouverte = true;
    e.id = p ? p.id : null;
    e.creeLe = p ? p.creeLe : null;
    e.titre = p ? p.titre : titre || titreDuJour();
    e.seq = p ? sq.cloner(p.sequence) : seq ? sq.cloner(seq) : sq.nouvelleSequence(defauts());
    e.piste = 0;
    e.selection = new Set();
    e.curseur = sq.finSequence(e.seq);
    e.annuler = []; e.refaire = [];
    e.version++;
    // Une idée née d'une partition (« continuer en idée ») s'enregistre tout de suite.
    if (!p && seq) planifierSauvegarde(0);
    $("idee-titre").value = e.titre;
    $("idee-reglages").hidden = true;
    $("idee-menu").hidden = true;
    afficherAffichage();
    rafraichir();
    requestAnimationFrame(() => grille.centrer());
    const notes = e.seq.pistes[0].notes;
    clavier.amener(notes.length ? notes[notes.length - 1].h : 60);
    if (localStorage.getItem("portee:midi") === "1") brancherMidi(false);
  }

  /** Quitte l'éditeur : arrête le son, enregistre ce qui reste. */
  async function fermer() {
    if (!e.ouverte) return;
    e.ouverte = false;
    if (e.enregistrement) arreterEnregistrement();
    transport.arreter();
    arreterMicro();
    for (const h of [...tenues.keys()]) relever(h);
    if (e.minuterie) { clearTimeout(e.minuterie); e.minuterie = null; sauver(); }
    await e.sauvegarde;
  }

  /** L'idée a changé sur un autre appareil : on la reprend, sauf modification en cours ici. */
  function recharger(p) {
    if (!e.ouverte || p.id !== e.id || e.minuterie || e.enregistrement) return false;
    e.titre = p.titre;
    e.seq = sq.cloner(p.sequence);
    e.selection = new Set([...e.selection].filter((id) => e.seq.pistes[e.piste]?.notes.some((n) => n.id === id)));
    if (!e.seq.pistes[e.piste]) e.piste = 0;
    e.version++;
    $("idee-titre").value = e.titre;
    rafraichir();
    return true;
  }

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
    $("idee-etat").textContent = "…";
    e.minuterie = setTimeout(() => { e.minuterie = null; sauver(); }, delai);
  }

  const vide = () => e.seq.pistes.every((p) => !p.notes.length) && !(e.seq.accords || []).length;

  function donnees() {
    const { abc } = sq.ecrireAbc(e.seq, { voix: voixCompletes(e.seq), titre: e.titre });
    return { type: "idee", titre: e.titre, sequence: sq.cloner(e.seq), abc, statut: "idee", nbPages: 0, modele: null, tempo: e.seq.tempo };
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
        $("idee-etat").textContent = "Non enregistrée : " + (err.message || err.code || "erreur");
      }
    });
    return e.sauvegarde;
  }

  // --- Jouer une note, écrire au clavier -----------------------------------------

  function entendre(hauteurs, duree = 0.6) {
    piano.pret().then(() => hauteurs.forEach((h) => piano.note(h, duree, 85))).catch(() => {});
  }

  /** Une touche s'enfonce (clavier à l'écran, de l'ordinateur, MIDI, ou note chantée). */
  function enfoncer(h, v = 90, { muet = false } = {}) {
    if (!e.ouverte) return;
    if (tenues.has(h)) relever(h);
    const autres = tenues.size > 0;
    tenues.set(h, null);
    clavier.montrer(h, true);
    if (!muet) {
      if (piano.echantillons) tenues.set(h, piano.debut(h, v));
      else piano.pret().then(() => { if (tenues.has(h) && !tenues.get(h)) tenues.set(h, piano.debut(h, v)); }).catch(() => {});
    }
    if (e.enregistrement) {
      e.enregistrement.ouvertes.set(h, { debut: transport.position(), v });
      return;
    }
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

  function relever(h) {
    if (!tenues.has(h)) return;
    piano.fin(tenues.get(h));
    tenues.delete(h);
    clavier.montrer(h, false);
    if (e.enregistrement) {
      const o = e.enregistrement.ouvertes.get(h);
      if (o) { e.enregistrement.notes.push({ h, debut: o.debut, fin: transport.position(), v: o.v }); e.enregistrement.ouvertes.delete(h); }
    }
    if (!tenues.size) e.accordEnCours = null;
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

  // --- Sélection ----------------------------------------------------------------

  function choisir(ids, ajouter = false) {
    if (ajouter) for (const id of ids) (e.selection.has(id) ? e.selection.delete(id) : e.selection.add(id));
    else e.selection = new Set(ids);
    const sel = choisies();
    if (sel.length) {
      e.curseur = Math.max(...sel.map((n) => n.d + n.l));
      // La durée affichée devient celle de la note : on voit ce qu'elle est.
      const l = sel[0].l;
      const base = [1, 2, 4, 8, 16].find((d) => d === l || d * 1.5 === l);
      if (base) { e.duree = base; e.pointee = base !== l; }
      entendre(sel.filter((n) => n.d === sel[0].d).map((n) => n.h));
      grille.montrer(sel[0]);
    }
    rafraichir();
  }

  /** La note d'avant ou d'après (sans sélection : le curseur saute d'une note). */
  function voisine(sens) {
    const notes = notesPiste();
    if (!notes.length) return;
    const debuts = [...new Set(notes.map((n) => n.d))].sort((a, b) => a - b);
    const sel = choisies();
    let cible;
    if (sel.length) {
      const d0 = Math.min(...sel.map((n) => n.d));
      cible = sens > 0 ? debuts.find((d) => d > d0) : [...debuts].reverse().find((d) => d < d0);
    } else {
      cible = sens > 0 ? debuts.find((d) => d >= e.curseur) : [...debuts].reverse().find((d) => d < e.curseur);
    }
    if (cible === undefined) return;
    choisir(notes.filter((n) => n.d === cible).map((n) => n.id));
  }

  function transformer(nom) {
    const ids = [...e.selection];
    if (!ids.length) return;
    switch (nom) {
      case "monter": return modifier(() => sq.transposer(e.seq, e.piste, ids, 1), { entendre: choisiesApres(ids, 1) });
      case "descendre": return modifier(() => sq.transposer(e.seq, e.piste, ids, -1), { entendre: choisiesApres(ids, -1) });
      case "octave-haut": return modifier(() => sq.transposer(e.seq, e.piste, ids, 12), { entendre: choisiesApres(ids, 12) });
      case "octave-bas": return modifier(() => sq.transposer(e.seq, e.piste, ids, -12), { entendre: choisiesApres(ids, -12) });
      case "dupliquer": return modifier(() => { const copies = sq.dupliquerSelection(e.seq, e.piste, ids); e.selection = new Set(copies); });
      case "doubler": return modifier(() => sq.etirer(e.seq, e.piste, ids, 2));
      case "diviser": return modifier(() => sq.etirer(e.seq, e.piste, ids, 0.5));
      case "retrograder": return modifier(() => sq.retrograder(e.seq, e.piste, ids));
      case "renverser": return modifier(() => sq.renverser(e.seq, e.piste, ids));
      case "recaler": return modifier(() => sq.recaler(e.seq, e.piste, ids, e.recalage));
      case "effacer": return effacer();
      case "nouvelle": return deps.nouvelleDepuis && deps.nouvelleDepuis(extraire(ids));
      default: return undefined;
    }
  }

  /** Les hauteurs de la sélection après transposition (pour les faire entendre). */
  function choisiesApres(ids, demiTons) {
    const sel = notesPiste().filter((n) => ids.includes(n.id));
    const d0 = Math.min(...sel.map((n) => n.d));
    return sel.filter((n) => n.d === d0).map((n) => n.h + demiTons);
  }

  /** La sélection, seule, comme une idée à part (calée au début). */
  function extraire(ids) {
    const sel = notesPiste().filter((n) => ids.includes(n.id));
    const mesure = sq.pasParMesure(e.seq);
    const d0 = Math.floor(Math.min(...sel.map((n) => n.d)) / mesure) * mesure;
    const seq = sq.nouvelleSequence({ tempo: e.seq.tempo, mesure: e.seq.mesure, tonalite: e.seq.tonalite });
    for (const n of sel) sq.poser(seq, 0, { d: n.d - d0, l: n.l, h: n.h, v: n.v });
    return seq;
  }

  // --- Lecture, boucle, enregistrement -------------------------------------------

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

  async function jouer() {
    if (transport.actif) { transport.arreter(); return; }
    if (e.enregistrement) return;
    if (micro.actif) arreterMicro();
    const s = source();
    const boucle = e.boucle ? etendueBoucle() : null;
    let depuis = 0;
    if (boucle) depuis = boucle[0];
    else if (e.selection.size) depuis = Math.min(...choisies().map((n) => n.d));
    else if (e.curseur > 0 && e.curseur < s.fin) depuis = e.curseur;
    $("idee-jouer").textContent = "■";
    $("idee-jouer").setAttribute("aria-label", "Arrêter");
    try {
      await transport.jouer(source, {
        depuis, boucle, metronome: e.metronome,
        surPosition: suivreLecture,
        surFin: () => { $("idee-jouer").textContent = "▶"; $("idee-jouer").setAttribute("aria-label", "Écouter"); suivreLecture(null); },
      });
    } catch (err) {
      $("idee-jouer").textContent = "▶";
      toast(err.message || "Le piano n'a pas pu se charger.");
    }
  }

  let dernierJeton = null;
  function suivreLecture(pas) {
    if (e.affichage === "grille") grille.lecture(pas);
    else {
      const j = pas === null ? null : e.jetons.find((x) => x.voix === e.piste && x.couche === 0 && pas >= x.a && pas < x.a + x.l);
      if (j === dernierJeton) return;
      for (const el of (dernierJeton && e.elements.get(dernierJeton)) || []) el.classList.remove("joue");
      for (const el of (j && e.elements.get(j)) || []) el.classList.add("joue");
      dernierJeton = j;
    }
    if (e.enregistrement) {
      const decompte = Math.ceil((e.enregistrement.depuis - pas) / sq.pasParTemps(e.seq));
      $("idee-decompte").hidden = !(pas !== null && pas < e.enregistrement.depuis);
      $("idee-decompte").textContent = decompte > 0 ? decompte : "";
    }
  }

  async function enregistrer() {
    if (e.enregistrement) { arreterEnregistrement(); return; }
    transport.arreter();
    if (micro.actif) arreterMicro();
    const mesure = sq.pasParMesure(e.seq);
    const depuis = Math.floor(Math.min(e.curseur, sq.finSequence(e.seq)) / mesure) * mesure;
    e.selection.clear();
    e.enregistrement = { depuis, notes: [], ouvertes: new Map() };
    $("idee-enregistrer").setAttribute("aria-pressed", "true");
    $("idee-mode").textContent = "Enregistrement : joue après le décompte";
    rafraichir();
    try {
      await transport.jouer(source, { depuis, decompte: 1, metronome: true, sansFin: true, surPosition: suivreLecture, surFin: () => { if (e.enregistrement) arreterEnregistrement(); } });
    } catch (err) {
      e.enregistrement = null;
      $("idee-enregistrer").setAttribute("aria-pressed", "false");
      toast(err.message || "Le piano n'a pas pu se charger.");
    }
  }

  function arreterEnregistrement() {
    const r = e.enregistrement;
    if (!r) return;
    const fin = transport.position();
    for (const [h, o] of r.ouvertes) r.notes.push({ h, debut: o.debut, fin, v: o.v });
    e.enregistrement = null;
    transport.arreter();
    $("idee-enregistrer").setAttribute("aria-pressed", "false");
    $("idee-decompte").hidden = true;
    suivreLecture(null);
    const notes = sq.quantifier(r.notes.map((n) => ({ ...n, debut: n.debut - r.depuis, fin: n.fin - r.depuis })), { grille: e.recalage, origine: r.depuis });
    if (!notes.length) { rafraichir(); return; }
    modifier(() => {
      const ids = notes.map((n) => sq.poser(e.seq, e.piste, n));
      e.selection = new Set(ids);
      e.curseur = Math.max(...notes.map((n) => n.d + n.l));
    });
    toast(`${notes.length} note${notes.length > 1 ? "s" : ""} enregistrée${notes.length > 1 ? "s" : ""}. Touche « Annuler » pour recommencer.`);
  }

  // --- Les accords ------------------------------------------------------------------
  //
  // On touche la ligne des accords, au-dessus d'une mesure : Portée propose
  // ceux qui vont avec les notes de la mesure (de la tonalité d'abord). On
  // les essaie (ils sonnent), on passe à la mesure suivante. Le premier
  // accord posé met l'accompagnement en route, pour qu'on les entende.

  const accordsOuverts = { d: 0 };
  let racineChoisie = null;

  function ouvrirAccords(m, pas = 0) {
    const mesure = sq.pasParMesure(e.seq);
    const moitie = Math.floor(mesure / 2);
    // Un accord à mi-mesure, s'il y en a un et qu'on touche la seconde moitié.
    const milieu = pas - m * mesure >= moitie && e.seq.accords.some((a) => a.d === m * mesure + moitie);
    accordsOuverts.d = m * mesure + (milieu ? moitie : 0);
    $("idee-reglages").hidden = true;
    $("idee-menu").hidden = true;
    $("feuille-accords").hidden = false;
    afficherAccords();
  }

  function afficherAccords() {
    if ($("feuille-accords").hidden) return;
    const mesure = sq.pasParMesure(e.seq);
    const d = accordsOuverts.d;
    const m = Math.floor(d / mesure);
    const moitie = Math.floor(mesure / 2);
    const fin = (e.seq.accords || []).filter((a) => a.d > d).reduce((x, a) => Math.min(x, a.d), (m + 1) * mesure);
    const actuel = (e.seq.accords || []).find((a) => a.d === d);
    $("accords-ou").textContent = `Mesure ${m + 1}${d % mesure ? ", 2ᵉ moitié" : ""}`;
    const degres = new Map(accordsDeLaTonalite(e.seq.tonalite).map((a) => [a.nom, a.degre]));
    const proposes = suggerer(e.seq, d, fin, 8);
    if (actuel && !proposes.includes(actuel.nom)) proposes.unshift(actuel.nom);
    $("accords-proposes").innerHTML = proposes.map((nom) => `<button class="btn" data-accord="${nom}" aria-pressed="${actuel && actuel.nom === nom}">${joliAccord(nom)}${degres.has(nom) ? ` <span class="degre">${degres.get(nom)}</span>` : ""}</button>`).join("");
    const k = sq.lireTonalite(e.seq.tonalite);
    const racines = Array.from({ length: 12 }, (_, i) => nomRacine(k.pc + i, e.seq.tonalite));
    const lu = actuel ? lireAccord(actuel.nom) : null;
    racineChoisie = racineChoisie ?? (lu ? nomRacine(lu.racine, e.seq.tonalite) : racines[0]);
    $("accords-racines").innerHTML = racines.map((r) => `<button class="btn" data-racine="${r}" aria-pressed="${r === racineChoisie}">${joliAccord(r)}</button>`).join("");
    $("accords-qualites").innerHTML = Object.keys(QUALITES).map((q) => `<button class="btn" data-accord="${racineChoisie}${q}" aria-pressed="${actuel && actuel.nom === racineChoisie + q}">${joliAccord(racineChoisie + q)}</button>`).join("");
    $("accord-retirer").disabled = !actuel;
    const aMilieu = (e.seq.accords || []).some((a) => a.d === m * mesure + moitie);
    $("accord-milieu").textContent = d % mesure ? "Revenir au début de la mesure" : aMilieu ? "Accord du milieu de la mesure" : "Changer au milieu de la mesure";
    $("accord-avant").disabled = d === 0;
  }

  /** Fait entendre un accord, comme l'accompagnement le jouera. */
  function entendreAccord(nom) {
    const a = lireAccord(nom);
    if (!a) return;
    entendre([36 + (a.basse ?? a.racine), ...a.intervalles.map((i) => 48 + a.racine + i)], 1.2);
  }

  function poserAccord(nom) {
    const d = accordsOuverts.d;
    const premier = !(e.seq.accords || []).length;
    modifier(() => {
      e.seq.accords = (e.seq.accords || []).filter((a) => a.d !== d);
      e.seq.accords.push({ d, nom });
      e.seq.accords.sort((a, b) => a.d - b.d);
      if (premier && (!e.seq.accompagnement || e.seq.accompagnement === "aucun")) e.seq.accompagnement = "plaque";
    });
    entendreAccord(nom);
    if (premier) toast("Les accords s'entendent en accords plaqués ; un autre style dans les réglages (♩).", 6000);
    afficherAccords();
  }

  $("feuille-accords").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.accord) { poserAccord(b.dataset.accord); return; }
    if (b.dataset.racine) { racineChoisie = b.dataset.racine; afficherAccords(); }
  });
  $("accords-fermer").addEventListener("click", () => { $("feuille-accords").hidden = true; });
  $("accord-avant").addEventListener("click", () => { const mesure = sq.pasParMesure(e.seq); accordsOuverts.d = Math.max(0, (Math.ceil(accordsOuverts.d / mesure) - 1) * mesure); racineChoisie = null; afficherAccords(); });
  $("accord-apres").addEventListener("click", () => { const mesure = sq.pasParMesure(e.seq); accordsOuverts.d = (Math.floor(accordsOuverts.d / mesure) + 1) * mesure; racineChoisie = null; afficherAccords(); });
  $("accord-milieu").addEventListener("click", () => {
    const mesure = sq.pasParMesure(e.seq);
    const debut = Math.floor(accordsOuverts.d / mesure) * mesure;
    accordsOuverts.d = accordsOuverts.d % mesure ? debut : debut + Math.floor(mesure / 2);
    racineChoisie = null;
    afficherAccords();
  });
  $("accord-retirer").addEventListener("click", () => {
    const d = accordsOuverts.d;
    modifier(() => { e.seq.accords = (e.seq.accords || []).filter((a) => a.d !== d); });
    afficherAccords();
  });
  $("accords-tout").addEventListener("click", () => {
    if (!notesPiste().length && e.piste === 0) { toast("Écris d'abord une mélodie : les accords se proposent d'après ses notes."); return; }
    modifier(() => {
      e.seq.accords = harmoniser(e.seq);
      if (!e.seq.accompagnement || e.seq.accompagnement === "aucun") e.seq.accompagnement = "plaque";
    });
    afficherAccords();
    toast(`${e.seq.accords.length} accord${e.seq.accords.length > 1 ? "s" : ""} proposé${e.seq.accords.length > 1 ? "s" : ""} : écoute, puis change ceux qui ne te plaisent pas.`, 6000);
  });

  // --- Chanter une note -----------------------------------------------------------

  let minuterieSilence = null;
  const micro = new Micro({
    surNote: (h) => {
      // Comme une touche du clavier, sans le son (il repasserait dans le micro).
      enfoncer(h, 90, { muet: true });
      relever(h);
      $("micro-note").textContent = "✓ " + sq.nomNote(h, e.seq.tonalite);
      $("micro-note").classList.add("ecrite");
      $("micro-aide").textContent = "Écrite. Chante la suivante (une même note : respire entre les deux).";
    },
    surEcoute: ({ h, cents, niveau }) => {
      $("micro-niveau").style.width = `${Math.min(100, niveau * 400)}%`;
      if (h === null) return;
      clearTimeout(minuterieSilence);
      minuterieSilence = setTimeout(() => { if (micro.actif) arreterMicro("Plus rien depuis 30 secondes : micro coupé."); }, 30000);
      $("micro-note").classList.remove("ecrite");
      $("micro-note").textContent = sq.nomNote(h, e.seq.tonalite);
      $("micro-aiguille").style.left = `${50 + cents}%`;
    },
  });

  async function basculerMicro() {
    if (micro.actif) { arreterMicro(); return; }
    transport.arreter();
    if (e.enregistrement) arreterEnregistrement();
    $("micro-panneau").hidden = false;
    $("micro-note").textContent = "…";
    $("micro-aide").textContent = "Chante une note et tiens-la : elle s'écrit. Puis la suivante.";
    try {
      await micro.demarrer();
      $("idee-micro").setAttribute("aria-pressed", "true");
      minuterieSilence = setTimeout(() => { if (micro.actif) arreterMicro("Plus rien depuis 30 secondes : micro coupé."); }, 30000);
    } catch (err) {
      $("micro-panneau").hidden = true;
      const refus = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      toast(refus ? "Portée n'a pas accès au micro. Autorise-le dans les réglages du navigateur (sur claude.ai, la page n'y a pas droit : ouvre Portée sur adrienvada.fr/Musique)." : (err.message || "Le micro n'a pas pu s'ouvrir."), 9000);
    }
  }

  function arreterMicro(message = null) {
    clearTimeout(minuterieSilence);
    micro.arreter();
    $("idee-micro").setAttribute("aria-pressed", "false");
    $("micro-panneau").hidden = true;
    if (message) toast(message);
  }

  // --- Clavier MIDI ------------------------------------------------------------

  let accesMidi = null;
  async function brancherMidi(demande) {
    if (!navigator.requestMIDIAccess) {
      if (demande) toast("Ce navigateur ne lit pas les claviers MIDI (Safari, iPhone, iPad). Sur ordinateur ou Android, Chrome et Edge le font.", 8000);
      return;
    }
    try {
      accesMidi = accesMidi || await navigator.requestMIDIAccess();
      const brancher = () => {
        const entrees = [...accesMidi.inputs.values()];
        for (const x of entrees) x.onmidimessage = surMessageMidi;
        $("idee-midi-etat").textContent = entrees.length ? `Branché : ${entrees.map((x) => x.name).join(", ")}` : "Aucun clavier MIDI branché pour l'instant.";
      };
      accesMidi.onstatechange = brancher;
      brancher();
      localStorage.setItem("portee:midi", "1");
    } catch {
      if (demande) toast("Portée n'a pas eu accès au clavier MIDI.");
    }
  }

  function surMessageMidi(m) {
    const [statut, note, force] = m.data;
    const type = statut & 0xf0;
    if (type === 0x90 && force > 0) enfoncer(note, force);
    else if (type === 0x80 || (type === 0x90 && force === 0)) relever(note);
  }

  // --- Affichage ------------------------------------------------------------------

  function afficherAffichage() {
    $("idee-grille").hidden = e.affichage !== "grille";
    $("idee-partition").hidden = e.affichage !== "partition";
    document.querySelectorAll("[data-affichage]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.affichage === e.affichage)));
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
      grille.afficher({ seq: e.seq, piste: e.piste, selection: e.selection, curseur: e.curseur, boucle: e.boucle ? etendueBoucle() : null, pas: Math.min(dureeCourante(), sq.pasParTemps(e.seq)), accordsVisibles: true });
    } else graverPartition();
  }

  function majCommandes() {
    const sel = choisies();
    const k = e.seq;
    $("idee-resume").textContent = `♩ ${k.tempo} · ${k.mesure.join("/")} · ${sq.nomTonalite(k.tonalite).replace(" majeur", "").replace(" mineur", " m")}`;
    $("idee-resume").parentElement.title = `Tempo ${k.tempo}, mesure ${k.mesure.join("/")}, ${sq.nomTonalite(k.tonalite)}`;
    $("idee-tempo").value = k.tempo;
    $("idee-tempo-val").textContent = `♩ = ${k.tempo}`;
    $("idee-mesure").value = k.mesure.join("/");
    $("idee-tonalite").value = k.tonalite;
    $("idee-accomp").value = k.accompagnement || "aucun";
    $("idee-recalage").value = String(e.recalage);
    $("idee-durees").querySelectorAll("[data-pas]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.pas) === e.duree)));
    $("idee-pointee").setAttribute("aria-pressed", String(e.pointee));
    $("idee-pointee").disabled = e.duree === 1;
    $("idee-boucle").setAttribute("aria-pressed", String(e.boucle));
    $("idee-metronome").setAttribute("aria-pressed", String(e.metronome));
    $("idee-annuler").disabled = !e.annuler.length;
    $("idee-refaire").disabled = !e.refaire.length;
    // Les pistes : « Mélodie », « Basse »…
    const pistes = $("idee-pistes");
    pistes.innerHTML = e.seq.pistes.length < 2 ? "" : e.seq.pistes.map((p, i) => `<button class="puce" data-piste="${i}" aria-pressed="${i === e.piste}">${p.nom}</button>`).join("");
    $("idee-basse").hidden = e.seq.pistes.length >= 2;
    // La sélection, et ce que fera le clavier.
    $("idee-selection").hidden = !sel.length;
    if (sel.length) {
      const d0 = Math.min(...sel.map((n) => n.d));
      const premieres = sel.filter((n) => n.d === d0);
      const nom = premieres.map((n) => sq.nomNote(n.h, k.tonalite)).join("-");
      const duree = DUREES.find((d) => d.pas === premieres[0].l || d.pas * 1.5 === premieres[0].l);
      const dureeNom = duree ? duree.nom + (duree.pas === premieres[0].l ? "" : " pointée") : `${premieres[0].l} pas`;
      $("idee-nom-choix").textContent = sel.length > premieres.length ? `${sel.length} notes` : `${premieres.length > 1 ? "accord " : ""}${nom} · ${dureeNom}`;
      $("idee-mode").textContent = "Le clavier change la note choisie";
    } else if (!e.enregistrement) {
      const avant = notesPiste().filter((n) => n.d + n.l <= e.curseur).sort((a, b) => b.d + b.l - (a.d + a.l))[0];
      $("idee-mode").textContent = avant ? `Le clavier écrit après ${sq.nomNote(avant.h, k.tonalite)}` : "Le clavier écrit au début";
    }
    clavier.marquer(sel.map((n) => n.h));
    afficherAccords();
  }

  // --- La partition (gravée par abcjs) ----------------------------------------------

  function graverPartition() {
    const lib = deps.abcjs();
    const zone = $("idee-gravure");
    if (!lib) { zone.textContent = "La partition n'a pas pu se charger (connexion ?). La grille marche sans."; return; }
    const largeur = zone.clientWidth || 600;
    const { abc, jetons } = sq.ecrireAbc(e.seq, { voix: voixCompletes(e.seq), mesuresParLigne: Math.max(1, Math.min(6, Math.floor(largeur / 180))) });
    const [objet] = lib.renderAbc(zone, abc, {
      responsive: "resize", add_classes: true, paddingtop: 4, paddingleft: 0, paddingright: 0,
      clickListener: surClicPartition, selectTypes: ["note"],
      selectionColor: getComputedStyle(document.documentElement).getPropertyValue("--stylo").trim() || "#2B48B0",
    });
    e.jetons = jetons;
    e.elements = new Map();
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
    for (const [j, els] of e.elements) if (j.ids.some((id) => e.selection.has(id)) && j.voix === e.piste) els.forEach((x) => x.classList.add("choisie"));
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

  // --- Branchements -----------------------------------------------------------------

  $("idee-titre").addEventListener("change", () => {
    e.titre = $("idee-titre").value.trim() || titreDuJour();
    $("idee-titre").value = e.titre;
    if (deps.titreChange) deps.titreChange(e.titre);
    planifierSauvegarde(0);
  });
  document.querySelectorAll("[data-affichage]").forEach((b) => b.addEventListener("click", () => {
    e.affichage = b.dataset.affichage;
    try { localStorage.setItem("portee:affichage-idee", e.affichage); } catch { /* facultatif */ }
    transport.arreter();
    afficherAffichage();
    rafraichir();
  }));
  $("idee-reglages-bouton").addEventListener("click", () => {
    const p = $("idee-reglages");
    p.hidden = !p.hidden;
    $("idee-reglages-bouton").setAttribute("aria-expanded", String(!p.hidden));
    $("idee-menu").hidden = true;
  });
  $("idee-plus").addEventListener("click", () => {
    const m = $("idee-menu");
    m.hidden = !m.hidden;
    $("idee-plus").setAttribute("aria-expanded", String(!m.hidden));
    $("idee-reglages").hidden = true;
  });
  $("idee-menu").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-menu]");
    if (!b) return;
    $("idee-menu").hidden = true;
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

  // Réglages
  const reglage = (f) => { modifier(f); memoriserDefauts(); };
  let minuterieTempo = null;
  $("idee-tempo").addEventListener("input", () => {
    const t = Number($("idee-tempo").value);
    $("idee-tempo-val").textContent = `♩ = ${t}`;
    clearTimeout(minuterieTempo);
    minuterieTempo = setTimeout(() => reglage(() => { e.seq.tempo = t; }), 250);
  });
  const tapes = [];
  $("idee-taper").addEventListener("click", () => {
    const t = performance.now();
    if (tapes.length && t - tapes[tapes.length - 1] > 2000) tapes.length = 0;
    tapes.push(t);
    if (tapes.length > 6) tapes.shift();
    if (tapes.length < 3) { $("idee-tempo-val").textContent = "Encore…"; return; }
    const ecarts = tapes.slice(1).map((x, i) => x - tapes[i]);
    const tempo = Math.max(40, Math.min(240, Math.round(60000 / (ecarts.reduce((a, b) => a + b, 0) / ecarts.length))));
    reglage(() => { e.seq.tempo = tempo; });
  });
  $("idee-mesure").addEventListener("change", () => reglage(() => { e.seq.mesure = $("idee-mesure").value.split("/").map(Number); }));
  $("idee-tonalite").addEventListener("change", () => reglage(() => { e.seq.tonalite = $("idee-tonalite").value; }));
  $("idee-transp-moins").addEventListener("click", () => modifier(() => transposerIdee(e.seq, -1)));
  $("idee-transp-plus").addEventListener("click", () => modifier(() => transposerIdee(e.seq, 1)));
  $("idee-accomp").addEventListener("change", () => modifier(() => { e.seq.accompagnement = $("idee-accomp").value; }));
  $("idee-recalage").addEventListener("change", () => { e.recalage = Number($("idee-recalage").value); });
  $("idee-midi").addEventListener("click", () => brancherMidi(true));

  // Pistes
  $("idee-basse").addEventListener("click", () => {
    modifier(() => { e.seq.pistes.push({ nom: "Basse", cle: "fa", notes: [] }); e.piste = e.seq.pistes.length - 1; e.selection.clear(); e.curseur = 0; });
    clavier.amener(36);
    $("idee-reglages").hidden = true;
    toast("Piste de basse : ce que tu joues va maintenant dans la basse. Touche « Mélodie » pour revenir.");
  });
  $("idee-pistes").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-piste]");
    if (!b) return;
    e.piste = Number(b.dataset.piste);
    e.selection.clear();
    e.curseur = Math.max(0, ...notesPiste().map((n) => n.d + n.l));
    rafraichir();
  });

  // Saisie
  $("idee-durees").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.pas) choisirDuree(Number(b.dataset.pas));
  });
  $("idee-pointee").addEventListener("click", basculerPointee);
  $("idee-silence").addEventListener("click", silence);
  $("idee-effacer").addEventListener("click", effacer);
  $("idee-selection").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-action]");
    if (!b) return;
    const a = b.dataset.action;
    if (a === "precedente") voisine(-1);
    else if (a === "suivante") voisine(1);
    else if (a === "deselectionner") { e.selection.clear(); rafraichir(); }
    else if (a === "plus") { if (deps.menuRadial) { const r = b.getBoundingClientRect(); deps.menuRadial.ouvrir(r.left + r.width / 2, r.top); } }
    else transformer(a);
  });

  // Transport
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
  $("idee-enregistrer").addEventListener("click", enregistrer);
  $("idee-micro").addEventListener("click", basculerMicro);
  $("micro-fini").addEventListener("click", () => arreterMicro());
  $("idee-annuler").addEventListener("click", () => revenir(e.annuler, e.refaire));
  $("idee-refaire").addEventListener("click", () => revenir(e.refaire, e.annuler));
  $("idee-zoom-moins").addEventListener("click", () => grille.zoom(1 / 1.3));
  $("idee-zoom-plus").addEventListener("click", () => grille.zoom(1.3));
  new ResizeObserver(() => { if (e.ouverte && e.affichage === "partition") rafraichir(); }).observe($("idee-partition"));
  // Un volet ouvert (réglages, menu) se referme quand on touche ailleurs.
  document.addEventListener("pointerdown", (ev) => {
    for (const [volet, bouton] of [["idee-reglages", "idee-reglages-bouton"], ["idee-menu", "idee-plus"], ["feuille-accords", "idee-grille .g-regle"]]) {
      if ($(volet).hidden || ev.target.closest(`#${volet}, #${bouton}`)) continue;
      $(volet).hidden = true;
      document.querySelector(`#${bouton}`).setAttribute("aria-expanded", "false");
    }
  });

  function memoriserDefauts() {
    try { localStorage.setItem(CLE_DEFAUTS, JSON.stringify({ tempo: e.seq.tempo, mesure: e.seq.mesure, tonalite: e.seq.tonalite })); } catch { /* facultatif */ }
  }

  async function sauverMaintenant() {
    if (e.minuterie) { clearTimeout(e.minuterie); e.minuterie = null; sauver(); }
    await e.sauvegarde;
  }

  function partitionCourante() {
    if (!e.id) return null;
    return { id: e.id, ...donnees(), creeLe: e.creeLe };
  }

  // --- Clavier de l'ordinateur -----------------------------------------------------

  let octaveOrdi = 60;
  /** Rend true si la touche a servi. */
  function toucheBas(ev) {
    if (!e.ouverte) return false;
    if (ev.repeat && TOUCHES_ORDI[ev.code] !== undefined) return true; // touche tenue : rien de plus
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { revenir(ev.shiftKey ? e.refaire : e.annuler, ev.shiftKey ? e.annuler : e.refaire); return true; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { revenir(e.refaire, e.annuler); return true; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    if (TOUCHES_ORDI[ev.code] !== undefined) { enfoncer(octaveOrdi + TOUCHES_ORDI[ev.code]); return true; }
    const actions = {
      KeyZ: () => { octaveOrdi = Math.max(24, octaveOrdi - 12); clavier.amener(octaveOrdi); toast(`Clavier de l'ordinateur : à partir de ${sq.nomNote(octaveOrdi)}`, 1500); },
      KeyX: () => { octaveOrdi = Math.min(96, octaveOrdi + 12); clavier.amener(octaveOrdi); toast(`Clavier de l'ordinateur : à partir de ${sq.nomNote(octaveOrdi)}`, 1500); },
      Space: jouer,
      KeyR: enregistrer,
      Digit1: () => choisirDuree(1), Digit2: () => choisirDuree(2), Digit3: () => choisirDuree(4), Digit4: () => choisirDuree(8), Digit5: () => choisirDuree(16),
      Period: basculerPointee, NumpadDecimal: basculerPointee,
      Digit0: silence, Numpad0: silence,
      Backspace: effacer, Delete: effacer,
      ArrowLeft: () => voisine(-1), ArrowRight: () => voisine(1),
      ArrowUp: () => transformer(ev.shiftKey ? "octave-haut" : "monter"),
      ArrowDown: () => transformer(ev.shiftKey ? "octave-bas" : "descendre"),
      Escape: () => { e.selection.clear(); rafraichir(); },
    };
    const f = actions[ev.code];
    if (!f) return false;
    f();
    return true;
  }

  function toucheHaut(ev) {
    if (TOUCHES_ORDI[ev.code] === undefined) return false;
    const h = octaveOrdi + TOUCHES_ORDI[ev.code];
    relever(h);
    return true;
  }

  return {
    ouvrir, fermer, recharger, toucheBas, toucheHaut, enfoncer, relever, transformer,
    get id() { return e.id; },
    get seq() { return e.seq; },
    get selection() { return e.selection; },
    get ouverte() { return e.ouverte; },
    get curseur() { return e.curseur; },
    modifier, rafraichir, choisir,
    etat: e,
  };
}
