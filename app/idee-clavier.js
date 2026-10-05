/**
 * L'ÉDITEUR D'IDÉE : LE MODE CLAVIER
 *
 * Tout ce qu'on joue au clavier :
 *   - le pupitre du mode Clavier (#pupitre-clavier) : la rangée des durées
 *     (#idee-durees : double croche à ronde, pointée, silence, effacer) et le
 *     clavier à l'écran (#idee-clavier, clavier.js) : un piano où la gamme de
 *     l'idée se voit, ou huit grosses touches de gamme (Piano / Gamme), et
 *     la carte des octaves ;
 *   - le clavier de l'ordinateur, disposé comme dans Ableton (la rangée
 *     A S D F… pour les touches blanches, W E T Y U pour les noires, Z X
 *     pour l'octave : des places, qui portent Q S D F…, Z E T Y U et W X sur
 *     un AZERTY), qui joue dans tous les modes ; son aide montre les lettres
 *     du clavier branché (I12) ;
 *   - un clavier MIDI (Chrome et Edge ; bouton #idee-midi dans la feuille
 *     Tempo), rebranché tout seul à l'ouverture s'il l'a déjà été, et sa
 *     pédale de maintien (CC64) : le piano tient les notes, le jeu en direct
 *     les enregistre tenues (audit du 04/10, M9).
 * Chaque touche donne l'instant de son geste (event.timeStamp, ou celui du
 * message MIDI) : le jeu en direct la place à cet instant-là (M6).
 * Sans note choisie, une touche écrit à la suite, de la durée choisie ;
 * avec une note choisie, elle lui donne sa hauteur (c'est le cœur qui en
 * décide, dans enfoncer).
 *
 * Deux préférences de cet appareil (preferences.js) : « portee:clavier-gamme »
 * (montrer la gamme sur le piano ; oui sauf "0", réglée dans l'accueil) et
 * « portee:clavier-facon » (Piano ou Gamme, retenu d'une fois sur l'autre).
 *
 * Reçoit du cœur (ctx) : e (l'état : duree, pointee, seq, ouverte), $,
 *   toast, piano, enfoncer(h, v, { quand }), relever(h, quand),
 *   pedale(bas, quand), choisirDuree(pas), basculerPointee(), silence(),
 *   effacer(), choisies().
 * Rend : { entrer(), sortir(), maj(), ouvrir(notes), toucheBas(ev),
 *   toucheHaut(ev), montrer(h, enfoncee), marquer(hauteurs), amener(h) }.
 */
import { creerClavier } from "./clavier.js";
import { nomNote } from "./sequence.js";
import { lirePref, ecrirePref } from "./preferences.js";
import { enBoucle } from "./sortie-midi.js";

// Le clavier de l'ordinateur, comme dans Ableton : la rangée du milieu pour
// les touches blanches, celle du dessus pour les noires (positions physiques :
// pareil en AZERTY).
export const TOUCHES_ORDI = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

/**
 * Ce que dit un message MIDI : { type: "debut", note, force }, { type: "fin",
 * note }, { type: "pedale", bas } (la pédale de maintien, CC64 : enfoncée à
 * partir de 64), ou null (le reste ne nous concerne pas). Tous canaux.
 */
export function lireMessageMidi(data) {
  const [statut, a, b] = data || [];
  const type = statut & 0xf0;
  if (type === 0x90 && b > 0) return { type: "debut", note: a, force: b };
  if (type === 0x80 || (type === 0x90 && b === 0)) return { type: "fin", note: a };
  if (type === 0xb0 && a === 64) return { type: "pedale", bas: b >= 64 };
  return null;
}

/**
 * L'instant d'un message MIDI, sur l'horloge de la page : son horodatage s'il
 * est plausible (à moins de cinq secondes de maintenant), sinon maintenant.
 * Un message traité en retard (le fil principal occupé) garde ainsi l'instant
 * où la touche a été jouée.
 */
export function instantMidi(timeStamp, maintenant = performance.now()) {
  return timeStamp > 0 && Math.abs(maintenant - timeStamp) < 5000 ? timeStamp : maintenant;
}

const CLE_GAMME = "portee:clavier-gamme";
const CLE_FACON = "portee:clavier-facon";

// --- Les lettres de ton clavier (audit du 04/10, I12) ------------------------
//
// Les touches jouent par leur place (`code`), comme dans Ableton : sur le
// clavier AZERTY d'Adrien, la place de A porte Q, celle de W porte Z, celle
// de Z porte W. L'aide montrait les lettres d'un QWERTY (« A W S E D… Z X »)
// alors qu'il fallait taper « Q Z S E D… W X ». Elle montre maintenant
// celles du clavier branché : Chromium les donne (navigator.keyboard) ; sinon
// (Safari, Firefox, la page dans claude.ai) on les apprend de la première
// touche jouée qui les distingue (A, W, Z, Y…) ; d'ici là, une mention dit
// les lettres d'un AZERTY.

/** Ce qui change d'une disposition à l'autre, pour les touches que l'aide nomme ou qu'on joue. */
const ECHANGES = {
  qwerty: {},
  azerty: { KeyA: "q", KeyQ: "a", KeyW: "z", KeyZ: "w", Semicolon: "m" },
  qwertz: { KeyY: "z", KeyZ: "y" },
};

/** La lettre de la touche `code` dans une disposition (null : une touche qui n'est pas une lettre). */
export function lettreSelon(disposition, code) {
  return ECHANGES[disposition][code] || (/^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : null);
}

/**
 * La disposition que disent les touches déjà jouées (`appris` : code →
 * lettre), si une seule leur va ; sinon null (S, E, D sont les mêmes partout).
 * @param {Map<string, string>} appris
 */
export function dispositionDe(appris) {
  const possibles = Object.keys(ECHANGES).filter((d) => [...appris].every(([code, lettre]) => {
    const attendue = lettreSelon(d, code);
    return attendue === null || attendue === lettre;
  }));
  return possibles.length === 1 ? possibles[0] : null;
}

export function creerModeClavier(ctx) {
  const { e, $, toast } = ctx;
  const panneau = $("pupitre-clavier");
  // Les touches de gamme écrivent par le même chemin que celles du piano
  // (enfoncer, relever) : le jeu en direct, la note choisie qui prend la hauteur… marchent pareil.
  const clavier = creerClavier($("idee-clavier"), {
    surNote: (h, bas, v, quand) => (bas ? ctx.enfoncer(h, v, { quand }) : ctx.relever(h, quand)),
    // Un geste sur les chevrons ou la carte : les touches de l'ordinateur suivent l'octave montrée.
    surOctave: (bas) => { octaveOrdi = bas; preferer(); },
    surFacon: (f) => ecrirePref(CLE_FACON, f),
  });

  /**
   * Le piano télécharge d'abord les sons de l'octave montrée (piano.js) : le
   * premier toucher n'attend pas le reste du clavier. À l'ouverture d'une
   * idée, ils se téléchargent même avant le premier toucher.
   */
  function preferer({ prechauffer = false, vers = null } = {}) {
    // Le clavier pas encore dessiné (caché) : l'octave de la note qu'il va montrer.
    const bas = clavier.bas ?? (vers !== null ? 12 * Math.floor(vers / 12) : octaveOrdi);
    if (ctx.piano && ctx.piano.preferer) ctx.piano.preferer(bas, bas + 12, { prechauffer });
  }

  /** Les préférences, lues à l'ouverture d'une idée et quand le mode reparaît : l'accueil les change entre-temps. */
  function lirePrefs() {
    clavier.regler({ montrerGamme: lirePref(CLE_GAMME) !== "0", facon: lirePref(CLE_FACON) === "gamme" ? "gamme" : "piano" });
  }
  lirePrefs();

  // --- Les durées -----------------------------------------------------------

  $("idee-durees").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.pas) ctx.choisirDuree(Number(b.dataset.pas));
    else if (b.id === "idee-pointee") ctx.basculerPointee();
    else if (b.id === "idee-silence") ctx.silence();
    else if (b.id === "idee-effacer") ctx.effacer();
  });

  function maj() {
    $("idee-durees").querySelectorAll("[data-pas]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.pas) === e.duree)));
    $("idee-pointee").setAttribute("aria-pressed", String(e.pointee));
    $("idee-pointee").disabled = e.duree === 1;
    // Avec une note choisie, ⌫ l'efface ; sinon, il efface la note d'avant.
    $("idee-effacer").setAttribute("aria-label", ctx.choisies().length ? "Effacer la note choisie" : "Effacer la note d'avant");
    // La gamme de l'idée sur les touches (elle change avec la tonalité, dans la feuille Tempo).
    clavier.regler({ tonalite: e.seq.tonalite });
    const choisies = ctx.choisies();
    clavier.marquer(choisies.map((n) => n.h));
    // Une nouvelle note choisie : le clavier montre sa hauteur (le trait bleu n'a de sens que visible).
    // La rangée de sélection prend la place de la barre des octaves : on les rejoint ainsi.
    const cle = choisies.map((n) => n.id).join(",");
    if (cle !== choixVu) {
      choixVu = cle;
      if (choisies.length && !choisies.some((n) => clavier.visible(n.h))) clavier.amener(choisies[0].h);
    }
  }
  let choixVu = "";

  // --- Le clavier de l'ordinateur --------------------------------------------

  // --- L'aide : les lettres de ton clavier (I12, voir plus haut) ---------------

  let carte = null; // ce que dit le navigateur (code → lettre), s'il le dit
  const appris = new Map(); // code → lettre, appris des touches jouées
  let disposition = null; // « azerty »… quand les touches jouées l'ont dit

  /** Réécrit les lettres de l'aide avec celles de ce clavier ; la mention AZERTY part quand on les sait. */
  function ecrireAide() {
    const aide = $("idee-raccourcis");
    if (!aide) return;
    for (const k of aide.querySelectorAll("kbd[data-touche]")) {
      const lettre = (carte && carte.get(k.dataset.touche)) || appris.get(k.dataset.touche) || (disposition && lettreSelon(disposition, k.dataset.touche));
      if (lettre) k.textContent = lettre.toUpperCase();
    }
    $("idee-raccourcis-azerty").hidden = !!(carte || disposition);
  }

  /** La carte du clavier, chez Chromium (une page dans claude.ai ou Safari ne l'ont pas : on apprendra). */
  async function lireCarte() {
    try {
      if (navigator.keyboard && navigator.keyboard.getLayoutMap) carte = await navigator.keyboard.getLayoutMap();
    } catch { carte = null; /* refusée (un cadre), ou absente */ }
    // Une carte vide ne dit rien du clavier : la mention reste, et les touches jouées apprendront.
    if (carte && !carte.size) carte = null;
    ecrireAide();
  }

  /** Une touche jouée dit sa lettre : de quoi deviner la disposition, sans rien demander. */
  function apprendre(ev) {
    if (carte || ev.key.length !== 1 || appris.get(ev.code) === ev.key.toLowerCase()) return;
    appris.set(ev.code, ev.key.toLowerCase());
    disposition = dispositionDe(appris);
    ecrireAide();
  }
  lireCarte();

  // Les touches de l'ordinateur jouent à partir de cette octave ; ‹ ›, la carte, Z et X la changent
  // toutes les trois, et le clavier à l'écran la montre (avant, Z X bougeaient un clavier invisible).
  let octaveOrdi = 60;
  /** Les touches qui jouent, et Z X pour l'octave. Rend true si la touche a servi. */
  function toucheBas(ev) {
    if (TOUCHES_ORDI[ev.code] !== undefined || ev.code === "KeyZ" || ev.code === "KeyX") apprendre(ev);
    if (TOUCHES_ORDI[ev.code] !== undefined) {
      if (!ev.repeat) ctx.enfoncer(octaveOrdi + TOUCHES_ORDI[ev.code], undefined, { quand: ev.timeStamp }); // touche tenue : rien de plus
      return true;
    }
    if (ev.code === "KeyZ" || ev.code === "KeyX") {
      octaveOrdi = ev.code === "KeyZ" ? Math.max(24, octaveOrdi - 12) : Math.min(96, octaveOrdi + 12);
      clavier.aller(octaveOrdi);
      preferer();
      toast(`Clavier de l'ordinateur : à partir de ${nomNote(octaveOrdi)}`, 1500);
      return true;
    }
    return false;
  }

  function toucheHaut(ev) {
    if (TOUCHES_ORDI[ev.code] === undefined) return false;
    ctx.relever(octaveOrdi + TOUCHES_ORDI[ev.code], ev.timeStamp);
    return true;
  }

  // --- Le clavier MIDI -------------------------------------------------------

  // L'accès MIDI, demandé une seule fois (la promesse) : deux touchers rapides sur « Brancher » ne le
  // demandent pas deux fois. Refusé, il pourra être redemandé.
  let accesMidi = null;
  async function brancherMidi(demande) {
    if (!navigator.requestMIDIAccess) {
      if (demande) toast("Ce navigateur ne lit pas les claviers MIDI (Safari, iPhone, iPad). Sur ordinateur ou Android, Chrome et Edge le font.", 8000);
      return;
    }
    if (!accesMidi) accesMidi = navigator.requestMIDIAccess().catch((err) => { accesMidi = null; throw err; });
    try {
      const acces = await accesMidi;
      const brancher = () => {
        // L'entrée qui porte le nom de la sortie MIDI choisie (IAC, loopMIDI) renvoie les notes que
        // Portée y joue : on ne l'écoute pas, sinon chaque écoute réécrirait l'idée (sortie-midi.js).
        const entrees = [...acces.inputs.values()].filter((x) => !enBoucle(x));
        for (const x of acces.inputs.values()) x.onmidimessage = enBoucle(x) ? null : surMessageMidi;
        $("idee-midi-etat").textContent = entrees.length ? `Branché : ${entrees.map((x) => x.name).join(", ")}` : "Aucun clavier MIDI branché pour l'instant.";
      };
      acces.onstatechange = brancher;
      brancher();
      ecrirePref("portee:midi", "1");
    } catch {
      if (demande) toast("Portée n'a pas eu accès au clavier MIDI.");
    }
  }

  function surMessageMidi(m) {
    // La sortie MIDI choisie après le branchement du clavier : son retour se tait aussi.
    if (enBoucle(m.currentTarget || m.target)) return;
    const x = lireMessageMidi(m.data);
    if (!x) return;
    const quand = instantMidi(m.timeStamp);
    if (x.type === "debut") ctx.enfoncer(x.note, x.force, { quand });
    else if (x.type === "fin") ctx.relever(x.note, quand);
    else ctx.pedale(x.bas, quand);
  }
  $("idee-midi").addEventListener("click", () => brancherMidi(true));

  return {
    entrer() { panneau.hidden = false; lirePrefs(); },
    sortir() { panneau.hidden = true; },
    maj,
    /** Une idée s'ouvre : le clavier montre sa dernière note, le MIDI se rebranche. */
    ouvrir(notes) {
      lirePrefs();
      // Un autre clavier a pu être branché entre-temps.
      lireCarte();
      choixVu = "";
      const derniere = notes.length ? notes[notes.length - 1].h : 60;
      clavier.amener(derniere);
      preferer({ prechauffer: true, vers: derniere });
      if (lirePref("portee:midi") === "1") brancherMidi(false);
    },
    toucheBas, toucheHaut,
    montrer: (h, enfoncee) => clavier.montrer(h, enfoncee),
    marquer: (hauteurs) => clavier.marquer(hauteurs),
    amener: (h) => clavier.amener(h),
  };
}
