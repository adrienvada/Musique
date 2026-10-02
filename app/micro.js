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
 */

/**
 * La fréquence fondamentale d'un bout de son, ou null s'il n'y a pas de
 * note (silence, souffle, bruit).
 * @returns {{ hz: number, clarte: number } | null} clarte : 0 à 1
 */
export function detecterHauteur(x, frequence, { seuil = 0.15, min = 65, max = 1200 } = {}) {
  // Au-delà de 32 kHz, on garde un échantillon sur deux (moyenné) : quatre
  // fois moins de calcul, et la voix ne monte pas si haut.
  if (frequence > 32000) {
    const y = new Float32Array(Math.floor(x.length / 2));
    for (let i = 0; i < y.length; i++) y[i] = (x[2 * i] + x[2 * i + 1]) / 2;
    x = y;
    frequence /= 2;
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
  }

  async demarrer() {
    if (this.actif) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Ce navigateur ne donne pas accès au micro.");
    }
    // Sans traitement de la voix : il déforme la hauteur.
    this.flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
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
        const err = new Error("Touche « Écouter » pour que le micro t'entende.");
        err.name = "GesteRequis";
        throw err;
      }
    }
    this.analyse = this.ctx.createAnalyser();
    this.analyse.fftSize = 2048;
    this.ctx.createMediaStreamSource(this.flux).connect(this.analyse);
    this.tampon = new Float32Array(this.analyse.fftSize);
    this.centre = null;
    this.compte = 0;
    this.derniere = null;
    this.silences = 99;
    this.actif = true;
    this.minuterie = setInterval(() => this.mesurer(), 40);
  }

  mesurer() {
    this.analyse.getFloatTimeDomainData(this.tampon);
    let s = 0;
    for (const v of this.tampon) s += v * v;
    const niveau = Math.sqrt(s / this.tampon.length);
    const r = niveau > 0.012 ? detecterHauteur(this.tampon, this.ctx.sampleRate) : null;
    if (!r || r.clarte < 0.8) {
      this.centre = null;
      this.compte = 0;
      this.silences++;
      this.surEcoute({ h: null, cents: 0, niveau, m: null, tenue: 0 });
      return;
    }
    // La note tenue, c'est la moyenne des mesures qui restent à moins d'un
    // demi-ton les unes des autres : un vibrato ne la fait pas changer.
    const m = midiDe(r.hz);
    if (this.centre !== null && Math.abs(m - this.centre) < 0.6) { this.compte++; this.centre += (m - this.centre) / this.compte; }
    else { this.centre = m; this.compte = 1; }
    const h = Math.round(this.centre);
    this.surEcoute({ h, cents: Math.round((m - h) * 100), niveau, m, tenue: Math.min(1, this.compte / MESURES_TENUE) });
    // Un quart de seconde sur la même note : elle est écrite.
    // La même note redite attend une respiration ; une autre s'écrit tout de suite (legato).
    if (this.compte === MESURES_TENUE && (h !== this.derniere || this.silences >= 3)) {
      this.derniere = h;
      this.silences = 0;
      this.surNote(h);
    }
    if (this.compte >= MESURES_TENUE) this.silences = 0;
  }

  arreter() {
    if (!this.actif) return;
    this.actif = false;
    clearInterval(this.minuterie);
    for (const piste of this.flux.getTracks()) piste.stop();
    this.ctx.close().catch(() => {});
  }
}
