/**
 * L'ÉDITEUR D'IDÉE : LE MODE CLAVIER
 *
 * Tout ce qu'on joue au clavier :
 *   - le pupitre du mode Clavier (#pupitre-clavier) : la rangée des durées
 *     (#idee-durees : double croche à ronde, pointée, silence, effacer) et le
 *     clavier à l'écran (#idee-clavier, clavier.js) ;
 *   - le clavier de l'ordinateur, disposé comme dans Ableton (la rangée
 *     A S D F… pour les touches blanches, W E T Y U pour les noires, Z X
 *     pour l'octave), qui joue dans tous les modes ;
 *   - un clavier MIDI (Chrome et Edge ; bouton #idee-midi dans la feuille
 *     Tempo), rebranché tout seul à l'ouverture s'il l'a déjà été.
 * Sans note choisie, une touche écrit à la suite, de la durée choisie ;
 * avec une note choisie, elle lui donne sa hauteur (c'est le cœur qui en
 * décide, dans enfoncer).
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

export function creerModeClavier(ctx) {
  const { e, $, toast } = ctx;
  const panneau = $("pupitre-clavier");
  const clavier = creerClavier($("idee-clavier"), { surNote: (h, bas, v) => (bas ? ctx.enfoncer(h, v) : ctx.relever(h)) });

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
    clavier.marquer(ctx.choisies().map((n) => n.h));
  }

  // --- Le clavier de l'ordinateur --------------------------------------------

  let octaveOrdi = 60;
  /** Les touches qui jouent, et Z X pour l'octave. Rend true si la touche a servi. */
  function toucheBas(ev) {
    if (TOUCHES_ORDI[ev.code] !== undefined) {
      if (!ev.repeat) ctx.enfoncer(octaveOrdi + TOUCHES_ORDI[ev.code]); // touche tenue : rien de plus
      return true;
    }
    if (ev.code === "KeyZ" || ev.code === "KeyX") {
      octaveOrdi = ev.code === "KeyZ" ? Math.max(24, octaveOrdi - 12) : Math.min(96, octaveOrdi + 12);
      clavier.amener(octaveOrdi);
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
    entrer() { panneau.hidden = false; },
    sortir() { panneau.hidden = true; },
    maj,
    /** Une idée s'ouvre : le clavier montre sa dernière note, le MIDI se rebranche. */
    ouvrir(notes) {
      clavier.amener(notes.length ? notes[notes.length - 1].h : 60);
      if (lirePref("portee:midi") === "1") brancherMidi(false);
    },
    toucheBas, toucheHaut,
    montrer: (h, enfoncee) => clavier.montrer(h, enfoncee),
    marquer: (hauteurs) => clavier.marquer(hauteurs),
    amener: (h) => clavier.amener(h),
  };
}
