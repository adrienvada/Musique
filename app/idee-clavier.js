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
 *     pour l'octave), qui joue dans tous les modes ;
 *   - un clavier MIDI (Chrome et Edge ; bouton #idee-midi dans la feuille
 *     Tempo), rebranché tout seul à l'ouverture s'il l'a déjà été.
 * Sans note choisie, une touche écrit à la suite, de la durée choisie ;
 * avec une note choisie, elle lui donne sa hauteur (c'est le cœur qui en
 * décide, dans enfoncer).
 *
 * Deux préférences de cet appareil (preferences.js) : « portee:clavier-gamme »
 * (montrer la gamme sur le piano ; oui sauf "0", réglée dans l'accueil) et
 * « portee:clavier-facon » (Piano ou Gamme, retenu d'une fois sur l'autre).
 *
 * Reçoit du cœur (ctx) : e (l'état : duree, pointee, seq, ouverte), $,
 *   toast, enfoncer(h, v), relever(h), choisirDuree(pas), basculerPointee(),
 *   silence(), effacer(), choisies().
 * Rend : { entrer(), sortir(), maj(), ouvrir(notes), toucheBas(ev),
 *   toucheHaut(ev), montrer(h, enfoncee), marquer(hauteurs), amener(h) }.
 */
import { creerClavier } from "./clavier.js";
import { nomNote } from "./sequence.js";
import { lirePref, ecrirePref } from "./preferences.js";

// Le clavier de l'ordinateur, comme dans Ableton : la rangée du milieu pour
// les touches blanches, celle du dessus pour les noires (positions physiques :
// pareil en AZERTY).
export const TOUCHES_ORDI = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

const CLE_GAMME = "portee:clavier-gamme";
const CLE_FACON = "portee:clavier-facon";

export function creerModeClavier(ctx) {
  const { e, $, toast } = ctx;
  const panneau = $("pupitre-clavier");
  // Les touches de gamme écrivent par le même chemin que celles du piano
  // (enfoncer, relever) : le jeu en direct, la note choisie qui prend la hauteur… marchent pareil.
  const clavier = creerClavier($("idee-clavier"), {
    surNote: (h, bas, v) => (bas ? ctx.enfoncer(h, v) : ctx.relever(h)),
    // Un geste sur les chevrons ou la carte : les touches de l'ordinateur suivent l'octave montrée.
    surOctave: (bas) => { octaveOrdi = bas; },
    surFacon: (f) => ecrirePref(CLE_FACON, f),
  });

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

  // Les touches de l'ordinateur jouent à partir de cette octave ; ‹ ›, la carte, Z et X la changent
  // toutes les trois, et le clavier à l'écran la montre (avant, Z X bougeaient un clavier invisible).
  let octaveOrdi = 60;
  /** Les touches qui jouent, et Z X pour l'octave. Rend true si la touche a servi. */
  function toucheBas(ev) {
    if (TOUCHES_ORDI[ev.code] !== undefined) {
      if (!ev.repeat) ctx.enfoncer(octaveOrdi + TOUCHES_ORDI[ev.code]); // touche tenue : rien de plus
      return true;
    }
    if (ev.code === "KeyZ" || ev.code === "KeyX") {
      octaveOrdi = ev.code === "KeyZ" ? Math.max(24, octaveOrdi - 12) : Math.min(96, octaveOrdi + 12);
      clavier.aller(octaveOrdi);
      toast(`Clavier de l'ordinateur : à partir de ${nomNote(octaveOrdi)}`, 1500);
      return true;
    }
    return false;
  }

  function toucheHaut(ev) {
    if (TOUCHES_ORDI[ev.code] === undefined) return false;
    ctx.relever(octaveOrdi + TOUCHES_ORDI[ev.code]);
    return true;
  }

  // --- Le clavier MIDI -------------------------------------------------------

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
      ecrirePref("portee:midi", "1");
    } catch {
      if (demande) toast("Portée n'a pas eu accès au clavier MIDI.");
    }
  }

  function surMessageMidi(m) {
    const [statut, note, force] = m.data;
    const type = statut & 0xf0;
    if (type === 0x90 && force > 0) ctx.enfoncer(note, force);
    else if (type === 0x80 || (type === 0x90 && force === 0)) ctx.relever(note);
  }
  $("idee-midi").addEventListener("click", () => brancherMidi(true));

  return {
    entrer() { panneau.hidden = false; lirePrefs(); },
    sortir() { panneau.hidden = true; },
    maj,
    /** Une idée s'ouvre : le clavier montre sa dernière note, le MIDI se rebranche. */
    ouvrir(notes) {
      lirePrefs();
      choixVu = "";
      clavier.amener(notes.length ? notes[notes.length - 1].h : 60);
      if (lirePref("portee:midi") === "1") brancherMidi(false);
    },
    toucheBas, toucheHaut,
    montrer: (h, enfoncee) => clavier.montrer(h, enfoncee),
    marquer: (hauteurs) => clavier.marquer(hauteurs),
    amener: (h) => clavier.amener(h),
  };
}
