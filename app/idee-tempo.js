/**
 * LA FEUILLE « TEMPO ET MESURE » DE L'ÉDITEUR D'IDÉE
 *
 * Le tempo (le curseur, − et +, taper le tempo), la mesure, la tonalité, la
 * transposition, l'accompagnement, le zoom de la grille et les pistes (en
 * ajouter une de basse, choisir celle où l'on écrit). Toucher le résumé du
 * tempo, dans la barre du haut, l'ouvre.
 *
 * Elle vivait dans idee.js (audit du 04/10, T3). Elle reçoit son contexte de
 * l'éditeur, comme les modules du pupitre : tout changement de l'idée passe
 * par `modifier` (un seul « Annuler », puis l'enregistrement).
 *
 * Le tempo, la mesure et la tonalité qu'on règle deviennent ceux des idées
 * suivantes (`defauts`).
 */
import { lirePref, ecrirePref } from "./preferences.js";
import * as sq from "./sequence.js";
import { transposerIdee, STYLES } from "./harmonie.js";
import { echapper } from "./ui.js";
import { fermerFeuille } from "./feuilles.js";
import { tempoDesTapes } from "./transport.js";

const MESURES = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8", "2/2"];
const CLE_DEFAUTS = "portee:idee-defauts";

/** Le tempo, la mesure et la tonalité d'une nouvelle idée : ceux qu'on a réglés en dernier. */
export function defauts() {
  try { return { tempo: 90, mesure: [4, 4], tonalite: "C", ...JSON.parse(lirePref(CLE_DEFAUTS) || "{}") }; } catch { return { tempo: 90, mesure: [4, 4], tonalite: "C" }; }
}

/**
 * @param ctx {
 *   e (l'état de l'éditeur), $, toast, grille, modifier(f), rafraichir(),
 *   notesPiste(), amener(h) (le clavier à l'écran se place à cette hauteur)
 * }
 */
export function creerTempo(ctx) {
  const { e, $ } = ctx;
  // Le tempo se règle par petits pas (−, +, le curseur) : on l'affiche tout
  // de suite, on ne l'écrit qu'une fois le geste fini (un seul « Annuler »).
  let enAttente = null, minuterie = null;

  $("idee-mesure").innerHTML = MESURES.map((m) => `<option value="${m}">${m}</option>`).join("");
  $("idee-tonalite").innerHTML = sq.TONALITES.map((t) => `<option value="${t}">${sq.nomTonalite(t)}</option>`).join("");
  $("idee-accomp").innerHTML = STYLES.map((s) => `<option value="${s.id}">${s.nom}</option>`).join("");

  function memoriserDefauts() {
    ecrirePref(CLE_DEFAUTS, JSON.stringify({ tempo: e.seq.tempo, mesure: e.seq.mesure, tonalite: e.seq.tonalite }));
  }
  const reglage = (f) => { ctx.modifier(f); memoriserDefauts(); };

  function changerTempo(t) {
    t = Math.max(40, Math.min(240, Math.round(t)));
    enAttente = t;
    $("idee-tempo-val").textContent = t;
    $("idee-tempo").value = t;
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      const v = enAttente;
      enAttente = null;
      if (v !== e.seq.tempo) reglage(() => { e.seq.tempo = v; });
    }, 350);
  }
  const tempoAffiche = () => (enAttente ?? e.seq.tempo);
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
  $("idee-transp-moins").addEventListener("click", () => ctx.modifier(() => transposerIdee(e.seq, -1)));
  $("idee-transp-plus").addEventListener("click", () => ctx.modifier(() => transposerIdee(e.seq, 1)));
  $("idee-accomp").addEventListener("change", () => ctx.modifier(() => { e.seq.accompagnement = $("idee-accomp").value; }));
  $("idee-reglages").querySelector(".idee-zoom").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-zoom]");
    if (b) ctx.grille.zoom(Number(b.dataset.facteur), b.dataset.zoom);
  });

  // Les pistes : une puce dans la barre du haut (dès qu'il y en a deux), le choix ici.
  function changerPiste(i) {
    e.piste = i;
    e.selection.clear();
    const notes = ctx.notesPiste();
    e.curseur = Math.max(0, ...notes.map((n) => n.d + n.l));
    ctx.amener(notes.length ? notes[notes.length - 1].h : (e.seq.pistes[i].cle === "fa" ? 36 : 60));
    ctx.rafraichir();
  }
  $("idee-basse").addEventListener("click", () => {
    ctx.modifier(() => { e.seq.pistes.push({ nom: "Basse", cle: "fa", notes: [] }); e.piste = e.seq.pistes.length - 1; e.selection.clear(); e.curseur = 0; });
    ctx.amener(36);
    fermerFeuille($("idee-reglages"));
    ctx.toast("Piste de basse : ce que tu joues va maintenant dans la basse. Touche « Basse », en haut, pour revenir à la mélodie.", 6000);
  });
  $("idee-pistes").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-piste]");
    if (b) changerPiste(Number(b.dataset.piste));
  });

  /** La feuille montre l'idée telle qu'elle est (le tempo qu'on règle reste celui qu'on voit). */
  function maj() {
    const k = e.seq;
    if (enAttente === null) { $("idee-tempo").value = k.tempo; $("idee-tempo-val").textContent = k.tempo; }
    const mesure = k.mesure.join("/");
    $("idee-mesure").value = mesure;
    $("idee-mesures").querySelectorAll("[data-mesure]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mesure === mesure)));
    $("idee-tonalite").value = k.tonalite;
    $("idee-accomp").value = k.accompagnement || "aucun";
    const plusieurs = k.pistes.length > 1;
    $("idee-pistes").hidden = !plusieurs;
    $("idee-pistes").innerHTML = plusieurs ? k.pistes.map((p, i) => `<button data-piste="${i}" aria-pressed="${i === e.piste}">${echapper(p.nom)}</button>`).join("") : "";
    $("idee-basse").hidden = plusieurs;
  }

  return {
    maj, changerPiste,
    /** Un tempo se règle (le geste n'est pas fini) : l'idée ne se recharge pas sous les doigts. */
    get enAttente() { return enAttente !== null; },
  };
}
