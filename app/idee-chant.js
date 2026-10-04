/**
 * L'ÉDITEUR D'IDÉE : LE MODE CHANTER
 *
 * Le pupitre devient un accordeur (#micro-panneau) : le nom de la note
 * entendue en très grand, un verdict en mots (« juste », « un peu haut »,
 * « un peu bas »), une jauge dont le milieu est la zone « juste » et dont
 * l'aiguille bouge avec la voix, et une barre de tenue qui se remplit
 * pendant le quart de seconde avant que la note s'écrive (puis un petit
 * éclat). Dessous, la durée des notes chantées (la même que celle du mode
 * Clavier) et les dernières notes de l'idée.
 *
 * Sur la grille elle-même (grille.js, ctx.grille.voix), la hauteur chantée se
 * dessine en direct : un trait qui défile, et la rangée visée qui s'allume.
 * On voit sa voix glisser vers la note, au lieu de la deviner à une aiguille.
 *
 * Le micro écoute tant que le mode est ouvert (il démarre en y entrant,
 * s'arrête en le quittant) ; une note tenue s'écrit à la suite, comme une
 * touche du clavier (micro.js, algorithme YIN). Il se tait pendant que le
 * piano joue (sinon il réécrirait ce qu'il entend) et reprend après ; trente
 * secondes sans rien entendre le coupent. Le son ne quitte pas l'appareil.
 *
 * Reçoit du cœur (ctx) : e (l'état : seq, ouverte, mode, duree, pointee), $,
 *   enfoncer(h, v, { muet }), relever(h), choisirDuree(pas),
 *   basculerPointee(), notesPiste(), grille (sa couche « voix »).
 * Rend : { entrer(), sortir(), pause(), reprendre(), maj(), fermer(), actif }.
 * Exporte aussi messageMicro(err), que le carnet (mémo vocal) emploie,
 * justesse(cents) et positionAiguille(cents).
 */
import { Micro } from "./micro.js";
import { nomNote } from "./sequence.js";

const SILENCE_MAX = 30000;
// Un trou d'une mesure ou deux (une consonne, un vibrato) ne vide pas l'écran :
// la note reste affichée le temps d'un souffle.
const RETENUE = 300;
const NB_GARDEES = 6;
const INDICE = "Chante une note et tiens-la : elle s'écrit.";
const INDICE_SUITE = "Écrite. Chante la suivante (même note : respire entre les deux).";

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

/**
 * Où se pose l'aiguille sur la jauge, en % de sa largeur : au milieu quand la
 * voix est juste, aux bords (4 % et 96 %) à un demi-ton, c'est-à-dire là où la
 * note d'à côté prend le relais. La zone « juste » (±10 centièmes) occupe donc
 * de 40,8 % à 59,2 % : c'est ce que dessine idee-chant.css.
 */
export function positionAiguille(cents) {
  return 50 + Math.max(-50, Math.min(50, cents)) * 0.92;
}

/**
 * Écarte les sauts isolés de la hauteur : YIN se trompe parfois d'une octave
 * le temps d'une mesure, et le trait de la voix ferait un pic. Un saut de
 * plus de quatre demi-tons ne se trace que si la mesure suivante le confirme.
 * Rend la hauteur à tracer, ou undefined (rien à tracer cette fois-ci) ;
 * null remet le filtre à zéro (silence).
 */
export function creerFiltreSauts() {
  let dernier = null, candidat = null;
  return (m) => {
    if (m === null) { dernier = candidat = null; return null; }
    if (dernier === null || Math.abs(m - dernier) <= 4) { dernier = m; candidat = null; return m; }
    if (candidat !== null && Math.abs(m - candidat) <= 1.5) { dernier = m; candidat = null; return m; }
    candidat = m;
    return undefined;
  };
}

export function creerChant(ctx) {
  const { e, $ } = ctx;
  const panneau = $("micro-panneau");
  const jauge = panneau.querySelector(".micro-justesse");
  const voix = ctx.grille.voix;
  const filtre = creerFiltreSauts();
  let minuterieSilence = null, minuterieEclat = null;
  let enPause = false;
  let demarrage = null;
  let indice = INDICE; // ce que dit l'écran quand personne ne chante
  let notePosee = null; // la note écrite en grand
  let verdictPose = "";
  let hCents = null; // la note dont on mesure l'écart…
  let cents = 0; // … et cet écart, lissé : le vibrato ne fait pas sauter le verdict
  let mLisse = null; // la hauteur tracée sur la grille, lissée
  let derniereVoix = 0;
  let neuve = false; // la note qu'on écrit vient de la voix : sa puce s'anime
  let signatureGardees = "";

  const aide = (texte) => { $("micro-aide").textContent = texte; };
  const nom = (h) => nomNote(h, e.seq ? e.seq.tonalite : "C");

  // Chaque morceau d'écran ne se réécrit que s'il change : l'écran est mis à
  // jour vingt-cinq fois par seconde, et le lecteur d'écran ne doit pas
  // répéter le nom d'une note qui n'a pas bougé.
  function poserNote(h) {
    if (h === notePosee) return;
    notePosee = h;
    $("micro-note").textContent = h === null ? "" : nom(h);
  }
  function poserVerdict(texte, classe) {
    const cle = `${classe}|${texte}`;
    if (cle === verdictPose) return;
    verdictPose = cle;
    const el = $("chant-justesse");
    el.textContent = texte;
    el.className = `chant-justesse ${classe}`;
  }
  function poserTenue(t) {
    $("chant-tenue-barre").style.transform = `scaleX(${t})`;
    panneau.classList.toggle("ecrite", t >= 1);
  }

  /** Plus de voix : le nom s'efface, le verdict redevient l'indice, la jauge se range. */
  function reposer() {
    hCents = null;
    mLisse = null;
    filtre(null);
    panneau.classList.remove("voix");
    poserNote(null);
    poserVerdict(indice, "indice");
    jauge.classList.remove("juste");
    $("micro-aiguille").style.left = "50%";
    poserTenue(0);
  }

  /** Un petit éclat : la note vient de s'écrire. */
  function eclat() {
    panneau.classList.remove("eclat");
    void panneau.offsetWidth; // relance l'animation si la note d'avant brillait encore
    panneau.classList.add("eclat");
    clearTimeout(minuterieEclat);
    minuterieEclat = setTimeout(() => panneau.classList.remove("eclat"), 700);
    voix.eclat();
  }

  const relancerSilence = () => {
    clearTimeout(minuterieSilence);
    minuterieSilence = setTimeout(() => { if (micro.actif) arreter("Micro coupé : plus rien depuis 30 secondes."); }, SILENCE_MAX);
  };

  const micro = new Micro({
    surNote: (h) => {
      // Comme une touche du clavier, sans le son (il repasserait dans le micro).
      neuve = true;
      ctx.enfoncer(h, 90, { muet: true });
      ctx.relever(h);
      neuve = false;
      indice = INDICE_SUITE;
      $("chant-annonce").textContent = `${nom(h)} écrite`;
      eclat();
    },
    surEcoute: ({ h, cents: ecart, m, niveau, tenue }) => {
      $("micro-niveau").style.width = `${Math.min(100, niveau * 400)}%`;
      const maintenant = performance.now();
      if (h === null) {
        filtre(null);
        mLisse = null;
        const enRetenue = maintenant - derniereVoix < RETENUE;
        // Le trait s'interrompt (et file vers la gauche) ; la rangée visée reste allumée un souffle.
        voix.point(null, { cible: enRetenue ? hCents : null, tenue: 0 });
        poserTenue(0);
        if (!enRetenue && panneau.classList.contains("voix")) reposer();
        return;
      }
      derniereVoix = maintenant;
      relancerSilence();
      if (h !== hCents) { hCents = h; cents = ecart; } else cents += (ecart - cents) * 0.35;
      panneau.classList.add("voix");
      poserNote(h);
      const j = justesse(Math.round(cents));
      poserVerdict(j.texte, j.classe);
      jauge.classList.toggle("juste", j.classe === "juste");
      $("micro-aiguille").style.left = `${positionAiguille(cents)}%`;
      poserTenue(tenue);
      const brut = filtre(m);
      if (brut !== undefined) {
        // Un léger lissage : la mesure de YIN tremble un peu, le vibrato se voit encore.
        mLisse = mLisse === null || Math.abs(brut - mLisse) > 1.5 ? brut : mLisse + (brut - mLisse) * 0.6;
        voix.point(mLisse, { cible: h, tenue });
      }
    },
  });

  /** À l'écoute, la jauge et la barre ; sinon, le message (et le bouton pour relancer). */
  function etat(ecoute) {
    panneau.classList.toggle("ecoute", ecoute);
    // Pendant que le piano joue, le micro revient tout seul : pas de bouton pour le rappeler.
    $("micro-relancer").hidden = ecoute || enPause;
    if (!ecoute) { reposer(); voix.fin(); }
  }

  async function ecouter() {
    if (micro.actif || demarrage) return;
    enPause = false;
    indice = INDICE;
    reposer();
    aide("");
    // Sans aucun geste de l'utilisateur sur la page (Portée ouverte tout
    // droit sur une idée), le navigateur garderait le son endormi : on
    // attend qu'il touche « Écouter ».
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
      etat(false);
      aide("Touche « Écouter » pour que le micro t'entende.");
      return;
    }
    etat(true);
    const moi = micro.demarrer();
    demarrage = moi;
    try {
      await moi;
      if (e.mode !== "chanter" || !e.ouverte) { micro.arreter(); return; }
      relancerSilence();
    } catch (err) {
      etat(false);
      aide(messageMicro(err));
    } finally {
      // Relu après l'attente : seul le démarrage en cours se retire.
      if (demarrage === moi) demarrage = null;
    }
  }

  function arreter(message = null) {
    clearTimeout(minuterieSilence);
    micro.arreter();
    etat(false);
    $("micro-niveau").style.width = "0%";
    if (message) aide(message);
  }

  // --- La durée des notes chantées : celle du mode Clavier ----------------------

  $("chant-durees").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-duree]");
    if (b) ctx.choisirDuree(Number(b.dataset.duree));
  });
  $("chant-pointee").addEventListener("click", () => ctx.basculerPointee());

  // --- Les dernières notes de l'idée -------------------------------------------

  /**
   * Les dernières notes de la piste, la plus récente d'abord. Elles viennent
   * de l'idée elle-même (pas d'une liste tenue à part) : annuler la dernière
   * note, ou en écrire une au clavier, se voit aussi ici.
   */
  function majGardees() {
    if (!e.seq) return;
    const dernieres = ctx.notesPiste().slice(-NB_GARDEES).reverse();
    const signature = dernieres.map((n) => n.id).join() + e.seq.tonalite;
    if (signature === signatureGardees) return;
    signatureGardees = signature;
    $("chant-gardees").innerHTML = dernieres.length
      ? dernieres.map((n, i) => `<li class="gardee${i === 0 ? " recente" : ""}${i === 0 && neuve ? " neuve" : ""}">${nom(n.h)}</li>`).join("")
      : '<li class="chant-sans-note">pas encore de note</li>';
  }

  $("micro-relancer").addEventListener("click", ecouter);

  return {
    /** Le mode s'ouvre : le panneau se montre, le micro écoute. */
    entrer() { signatureGardees = ""; panneau.hidden = false; ecouter(); },
    /** Le mode se ferme (ou l'idée) : le micro se coupe. */
    sortir() { enPause = false; arreter(); panneau.hidden = true; },
    /** Le piano va jouer (écoute, jeu en direct) : le micro se tait. */
    pause() {
      if (!micro.actif) return;
      enPause = true;
      arreter("Le micro se tait pendant que le piano joue.");
    },
    /** Le piano s'est tu : le micro reprend, si le mode est toujours ouvert. */
    reprendre() {
      if (!enPause) return;
      enPause = false;
      if (e.mode === "chanter" && e.ouverte) ecouter();
    },
    /** À chaque redessin de l'idée : la durée choisie, les dernières notes. */
    maj() {
      for (const b of $("chant-durees").querySelectorAll("[data-duree]")) b.setAttribute("aria-pressed", String(Number(b.dataset.duree) === e.duree));
      $("chant-pointee").setAttribute("aria-pressed", String(e.pointee));
      $("chant-pointee").disabled = e.duree === 1;
      majGardees();
    },
    fermer() { enPause = false; arreter(); },
    get actif() { return micro.actif; },
  };
}
