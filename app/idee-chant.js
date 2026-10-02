/**
 * L'ÉDITEUR D'IDÉE : LE MODE CHANTER
 *
 * Le pupitre devient un accordeur (#micro-panneau) : le nom de la note
 * entendue en grand, l'aiguille de justesse, le niveau du micro et une aide
 * courte. Le micro écoute tant que le mode est ouvert (il démarre en y
 * entrant, s'arrête en le quittant) ; une note tenue s'écrit à la suite,
 * comme une touche du clavier (micro.js, algorithme YIN). Il se tait
 * pendant que le piano joue (sinon il réécrirait ce qu'il entend) et
 * reprend après ; trente secondes sans rien entendre le coupent.
 * Avant, un panneau flottant écoutait par-dessus la grille et cachait les
 * notes qu'on venait de chanter.
 *
 * Reçoit du cœur (ctx) : e (l'état : seq, ouverte, mode), $, toast,
 *   enfoncer(h, v, { muet }), relever(h).
 * Rend : { entrer(), sortir(), pause(), reprendre(), maj(), fermer(), actif }.
 * Exporte aussi messageMicro(err), que le carnet (mémo vocal) emploie.
 */
import { Micro } from "./micro.js";
import { nomNote } from "./sequence.js";
import { ico } from "./icones.js";

const SILENCE_MAX = 30000;
const AIDE = "Chante une note et tiens-la : elle s'écrit. Puis la suivante.";

/** Ce qui empêche d'ouvrir le micro, dit simplement. */
export function messageMicro(err) {
  const nom = err && err.name;
  if (nom === "NotAllowedError" || nom === "SecurityError") return "Portée n'a pas accès au micro : autorise-le dans les réglages du navigateur. (Dans la page claude.ai, il n'y a pas droit : ouvre Portée sur adrienvada.fr/Musique.)";
  if (nom === "NotFoundError" || nom === "OverconstrainedError") return "Aucun micro trouvé sur cet appareil.";
  if (nom === "NotReadableError") return "Le micro est déjà pris par une autre appli.";
  return (err && err.message) || "Le micro n'a pas pu s'ouvrir.";
}

/** Ce que dit l'aiguille : juste à dix centièmes de demi-ton près. */
export function justesse(cents) {
  if (Math.abs(cents) <= 10) return { texte: "juste", classe: "juste" };
  return cents > 0 ? { texte: "un peu haut", classe: "haut" } : { texte: "un peu bas", classe: "bas" };
}

export function creerChant(ctx) {
  const { e, $ } = ctx;
  const panneau = $("micro-panneau");
  let minuterieSilence = null;
  let enPause = false;
  let demarrage = null;

  const aide = (texte) => { $("micro-aide").textContent = texte; };
  function montrerNote(h, ecrite = false) {
    const el = $("micro-note");
    el.classList.toggle("ecrite", ecrite);
    el.innerHTML = h === null ? "" : `${ecrite ? ico("ok", "s") : ""}<span>${nomNote(h, e.seq ? e.seq.tonalite : "C")}</span>`;
    if (h === null || ecrite) { $("chant-justesse").textContent = ecrite ? "écrite" : ""; $("chant-justesse").className = "chant-justesse"; }
  }
  const relancerSilence = () => {
    clearTimeout(minuterieSilence);
    minuterieSilence = setTimeout(() => { if (micro.actif) arreter("Micro coupé : plus rien depuis 30 secondes."); }, SILENCE_MAX);
  };

  const micro = new Micro({
    surNote: (h) => {
      // Comme une touche du clavier, sans le son (il repasserait dans le micro).
      ctx.enfoncer(h, 90, { muet: true });
      ctx.relever(h);
      montrerNote(h, true);
      aide("Écrite. Chante la suivante (une même note : respire entre les deux).");
    },
    surEcoute: ({ h, cents, niveau }) => {
      $("micro-niveau").style.width = `${Math.min(100, niveau * 400)}%`;
      if (h === null) return;
      relancerSilence();
      montrerNote(h);
      const j = justesse(cents);
      $("chant-justesse").textContent = j.texte;
      $("chant-justesse").className = `chant-justesse ${j.classe}`;
      $("micro-aiguille").style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
    },
  });

  function etat(ecoute) {
    panneau.classList.toggle("ecoute", ecoute);
    $("micro-relancer").hidden = ecoute;
  }

  async function ecouter() {
    if (micro.actif || demarrage) return;
    enPause = false;
    montrerNote(null);
    aide(AIDE);
    // Sans aucun geste de l'utilisateur sur la page (Portée ouverte tout
    // droit sur une idée), le navigateur garderait le son endormi : on
    // attend qu'il touche « Écouter ».
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
      etat(false);
      aide("Touche « Écouter » pour que le micro t'entende.");
      return;
    }
    etat(true);
    demarrage = micro.demarrer();
    try {
      await demarrage;
      if (e.mode !== "chanter" || !e.ouverte) { micro.arreter(); return; }
      relancerSilence();
    } catch (err) {
      etat(false);
      aide(messageMicro(err));
    } finally {
      demarrage = null;
    }
  }

  function arreter(message = null) {
    clearTimeout(minuterieSilence);
    micro.arreter();
    etat(false);
    $("micro-niveau").style.width = "0%";
    if (message) aide(message);
  }

  $("micro-relancer").addEventListener("click", ecouter);

  return {
    /** Le mode s'ouvre : le panneau se montre, le micro écoute. */
    entrer() { panneau.hidden = false; ecouter(); },
    /** Le mode se ferme (ou l'idée) : le micro se coupe. */
    sortir() { enPause = false; arreter(); panneau.hidden = true; },
    /** Le piano va jouer (écoute, jeu en direct) : le micro se tait. */
    pause() {
      if (!micro.actif) return;
      arreter("Le micro se tait pendant que le piano joue.");
      enPause = true;
    },
    /** Le piano s'est tu : le micro reprend, si le mode est toujours ouvert. */
    reprendre() {
      if (!enPause) return;
      enPause = false;
      if (e.mode === "chanter" && e.ouverte) ecouter();
    },
    maj() {},
    fermer() { enPause = false; arreter(); },
    get actif() { return micro.actif; },
  };
}
