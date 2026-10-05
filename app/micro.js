/**
 * CHANTER UNE NOTE
 *
 * Le micro écoute ; dès qu'une note chantée (ou sifflée, ou jouée sur un
 * instrument) tient un quart de seconde, Portée la reconnaît et l'écrit,
 * comme si on avait touché la touche du clavier. On chante la suivante, et
 * ainsi de suite : la durée reste celle qu'on a choisie. Une même note
 * redite s'écrit à nouveau après une respiration.
 *
 * Rien n'est enregistré : le son ne quitte pas l'appareil.
 *
 * À chaque mesure (toutes les 40 ms), Micro dit aussi à l'écran où en est la
 * voix : sa hauteur exacte (pour la tracer sur la grille) et l'avancée de la
 * tenue, de 0 à 1 (pour que le chanteur voie combien de temps il lui reste à
 * tenir avant que la note s'écrive).
 *
 * La hauteur se mesure avec l'algorithme YIN (de Cheveigné et Kawahara,
 * 2002), robuste pour la voix : une fonction pure, testée sur des sons
 * fabriqués (tests/micro.test.mjs).
 *
 * Ce que l'audit du 04/10 a changé ici (M7) :
 *   - le vibrato : une mesure compte pour la note tenue tant qu'elle en reste
 *     à 0,8 demi-ton, la note suit la médiane des six dernières mesures, et il
 *     faut deux mesures de suite au-delà pour faire une autre note (une seule,
 *     c'est la crête d'un vibrato). Avant, une seule mesure à plus de 0,6
 *     demi-ton de la moyenne remettait la tenue à zéro : au-delà de ±40
 *     centièmes de vibrato, la note ne s'écrivait jamais (voir suivre()) ;
 *   - le sifflement : on cherche jusqu'à 2 500 Hz au lieu de 1 200 ; un
 *     sifflement plus aigu s'écrivait une octave trop bas ;
 *   - les cartes son à 88,2 ou 96 kHz : la décimation suit la fréquence
 *     d'échantillonnage (on ramène le son vers 24 kHz), et la fenêtre
 *     d'analyse s'allonge avec elle ; avant, les graves n'y étaient pas
 *     reconnus ;
 *   - le micro sans gain automatique, comme sans écho ni réduction de
 *     bruit : il remontait le bruit de fond entre deux notes, et le niveau
 *     d'une même voix changeait d'une seconde à l'autre ;
 *   - sur l'iPhone, la session audio passe en « play-and-record » le temps
 *     que le micro écoute, puis revient à « playback » (eveil.js, M8).
 */
import { sessionAudio, garderEveille, laisserDormir } from "./eveil.js";

/** On ramène le son vers cette fréquence avant de chercher sa hauteur : assez pour un sifflement, peu de calcul. */
const FREQUENCE_ANALYSE = 24000;

/**
 * La fréquence fondamentale d'un bout de son, ou null s'il n'y a pas de
 * note (silence, souffle, bruit).
 * @returns {{ hz: number, clarte: number } | null} clarte : 0 à 1
 */
export function detecterHauteur(x, frequence, { seuil = 0.15, min = 65, max = 2500 } = {}) {
  // Un échantillon sur deux à 44,1 et 48 kHz, un sur quatre à 88,2 et 96 kHz (moyennés) : bien moins
  // de calcul, et même un sifflement reste loin de la moitié de la fréquence d'arrivée.
  const pas = Math.max(1, Math.round(frequence / FREQUENCE_ANALYSE));
  if (pas > 1) {
    const y = new Float32Array(Math.floor(x.length / pas));
    for (let i = 0; i < y.length; i++) {
      let s = 0;
      for (let k = 0; k < pas; k++) s += x[pas * i + k];
      y[i] = s / pas;
    }
    x = y;
    frequence /= pas;
  }
  const W = Math.floor(x.length / 2);
  const tauMin = Math.max(2, Math.floor(frequence / max));
  const tauMax = Math.min(W - 1, Math.ceil(frequence / min));
  let energie = 0;
  for (let i = 0; i < x.length; i++) energie += x[i] * x[i];
  if (energie / x.length < 1e-6) return null;
  // Différence cumulée normalisée (étapes 2 et 3 de YIN).
  const d = new Float32Array(tauMax + 2);
  d[0] = 1;
  let cumul = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const e = x[j] - x[j + tau]; s += e * e; }
    cumul += s;
    d[tau] = cumul > 0 ? (s * tau) / cumul : 1;
  }
  // Premier creux sous le seuil (étape 4) : le plus petit décalage, donc la bonne octave.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < seuil) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Interpolation parabolique autour du creux (étape 5).
  const a = d[tau - 1], b = d[tau], c = d[tau + 1];
  const decalage = a + c - 2 * b !== 0 ? (a - c) / (2 * (a + c - 2 * b)) : 0;
  return { hz: frequence / (tau + decalage), clarte: Math.max(0, Math.min(1, 1 - b)) };
}

/** Hauteur MIDI (fractionnaire) d'une fréquence : 69 = la 440. */
export const midiDe = (hz) => 69 + 12 * Math.log2(hz / 440);

/** Six mesures de suite (40 ms chacune : un quart de seconde) sur la même note, et elle s'écrit. */
export const MESURES_TENUE = 6;
/** Une mesure à cette distance au plus de la note tenue (en demi-tons) en est encore : le vibrato reste dedans. */
export const TOLERANCE = 0.8;
/** La note tenue suit la médiane des six dernières mesures, quand elle s'en écarte de plus de 0,6 demi-ton. */
const DERIVE = 0.6;
const FENETRE = 6;

/** La médiane d'une petite liste de nombres. */
export function mediane(valeurs) {
  const v = [...valeurs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** La taille de la fenêtre d'analyse : 2 048 échantillons à 44,1 ou 48 kHz, deux fois plus au-delà (la même durée, ou presque). */
export const tailleFenetre = (frequence) => (frequence > 50000 ? 4096 : 2048);

/**
 * Écoute le micro et annonce chaque note tenue.
 *   surNote(h)    : une note a tenu assez longtemps ;
 *   surEcoute(e)  : à chaque mesure { h, cents, niveau, m, tenue } : h la
 *                   note tenue (null : rien), cents l'écart de la voix à cette
 *                   note, m la hauteur exacte de la voix (MIDI fractionnaire,
 *                   null : rien), tenue l'avancée vers l'écriture (0 à 1).
 */
export class Micro {
  constructor({ surNote, surEcoute = () => {} }) {
    this.surNote = surNote;
    this.surEcoute = surEcoute;
    this.actif = false;
    this.oublier();
  }

  async demarrer() {
    if (this.actif) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Ce navigateur ne donne pas accès au micro.");
    }
    // Sur l'iPhone, le micro demande une session « enregistrer et jouer » ; elle revient à « jouer » à l'arrêt.
    sessionAudio("play-and-record");
    // Sans aucun traitement de la voix : l'annulation d'écho et la réduction de bruit déforment la
    // hauteur, le gain automatique remonte le bruit de fond entre deux notes.
    try {
      this.flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      sessionAudio("playback");
      throw e;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === "suspended") {
      // Hors d'un geste, certains navigateurs (Safari) ne réveillent pas le
      // son et la promesse ne se tient jamais : on n'attend pas plus d'une
      // seconde et demie, puis on demande un toucher.
      await Promise.race([this.ctx.resume().catch(() => {}), new Promise((ok) => setTimeout(ok, 1500))]);
      if (this.ctx.state !== "running") {
        for (const piste of this.flux.getTracks()) piste.stop();
        this.ctx.close().catch(() => {});
        sessionAudio("playback");
        const err = new Error("Touche « Écouter » pour que le micro t'entende.");
        err.name = "GesteRequis";
        throw err;
      }
    }
    this.analyse = this.ctx.createAnalyser();
    // La même durée de son à toutes les fréquences : à 96 kHz, 2 048 échantillons ne laissaient rien
    // entendre sous 94 Hz (le mi1 d'une basse est à 82).
    this.analyse.fftSize = tailleFenetre(this.ctx.sampleRate);
    this.ctx.createMediaStreamSource(this.flux).connect(this.analyse);
    this.tampon = new Float32Array(this.analyse.fftSize);
    this.oublier();
    this.derniere = null;
    this.silences = 99;
    this.actif = true;
    // L'écran reste allumé tant que le micro écoute (on chante sans toucher l'écran).
    garderEveille("chant");
    this.minuterie = setInterval(() => this.mesurer(), 40);
  }

  mesurer() {
    this.analyse.getFloatTimeDomainData(this.tampon);
    let s = 0;
    for (const v of this.tampon) s += v * v;
    const niveau = Math.sqrt(s / this.tampon.length);
    const r = niveau > 0.012 ? detecterHauteur(this.tampon, this.ctx.sampleRate) : null;
    if (!r || r.clarte < 0.8) {
      this.oublier();
      this.silences++;
      this.surEcoute({ h: null, cents: 0, niveau, m: null, tenue: 0 });
      return;
    }
    const m = midiDe(r.hz);
    const comptee = this.suivre(m);
    const h = this.note;
    this.surEcoute({ h, cents: Math.round((m - h) * 100), niveau, m, tenue: Math.min(1, this.compte / MESURES_TENUE) });
    // Une mesure à l'écart (la crête d'un grand vibrato, ou la première d'une autre note) attend la
    // suivante : l'écran garde la note tenue, rien ne s'écrit.
    if (!comptee) return;
    // Un quart de seconde sur la même note : elle est écrite.
    // La même note redite attend une respiration ; une autre s'écrit tout de suite (legato).
    if (this.compte === MESURES_TENUE && (h !== this.derniere || this.silences >= 3)) {
      this.derniere = h;
      this.silences = 0;
      this.surNote(h);
    }
    if (this.compte >= MESURES_TENUE) this.silences = 0;
  }

  /**
   * Une mesure de plus sur la voix (`m`, en demi-tons fractionnaires) : la
   * note qu'elle tient (this.note) et depuis combien de mesures (this.compte).
   * Rend false pour une mesure laissée de côté en attendant la suivante.
   *   - Une mesure à 0,8 demi-ton au plus de la note entre dans la fenêtre
   *     des six dernières ; la note suit leur médiane (elle ne change que si
   *     la médiane s'en écarte de plus de 0,6 : une voix juste à 50 centièmes
   *     près ne la fait pas osciller). Le vibrato reste dedans.
   *   - Une mesure plus loin peut être la crête d'un grand vibrato : seules
   *     deux mesures de suite au-delà, du même côté, font une autre note
   *     (le legato), qui part alors avec ces deux mesures. Avant, la première
   *     mesure trop loin d'une moyenne remettait tout à zéro : au-delà de ±40
   *     centièmes de vibrato, la note ne s'écrivait jamais.
   */
  suivre(m) {
    if (this.note !== null && this.note !== undefined && Math.abs(m - this.note) > TOLERANCE) {
      const ecart = m - this.note;
      if (this.horsNote !== null && this.horsNote !== undefined && Math.sign(this.horsNote) === Math.sign(ecart)) {
        this.recentes = [this.note + this.horsNote, m];
        this.note = Math.round(mediane(this.recentes));
        this.compte = 2;
        this.horsNote = null;
        return true;
      }
      this.horsNote = ecart;
      return false;
    }
    this.horsNote = null;
    this.recentes.push(m);
    if (this.recentes.length > FENETRE) this.recentes.shift();
    const centre = mediane(this.recentes);
    if (this.note === null || this.note === undefined || Math.abs(centre - this.note) > DERIVE) { this.note = Math.round(centre); this.compte = 1; }
    else this.compte++;
    return true;
  }

  /** Plus de voix (silence, souffle) : la tenue repart de zéro. */
  oublier() {
    this.recentes = [];
    this.note = null;
    this.horsNote = null;
    this.compte = 0;
  }

  arreter() {
    if (!this.actif) return;
    this.actif = false;
    clearInterval(this.minuterie);
    for (const piste of this.flux.getTracks()) piste.stop();
    this.ctx.close().catch(() => {});
    laisserDormir("chant");
    sessionAudio("playback");
  }
}
