/**
 * JOUER UNE IDÉE : BOUCLE, MÉTRONOME, DÉCOMPTE, ENREGISTREMENT
 *
 * Une partition lue sur la tablette se joue par abcjs. Une idée se joue
 * directement depuis ses notes, au pas près, pour trois raisons :
 *   - on la modifie pendant qu'elle tourne en boucle (la source est relue
 *     à chaque instant) ;
 *   - l'enregistrement en direct a besoin d'une horloge exacte : décompte,
 *     métronome, et l'instant de chaque touche, en pas ;
 *   - l'accompagnement (harmonie.js) sonne avec la mélodie.
 *
 * Ordonnanceur classique de Web Audio : toutes les 25 ms, on programme ce
 * qui tombe dans les 150 ms à venir. Chaque pas programmé laisse un repère
 * (instant audio, pas) : c'est ce qui permet de dire « où on en est », boucle
 * comprise, et de placer une touche jouée.
 */
const AVANCE = 0.15;
const RYTHME = 25;

export class Transport {
  constructor(piano) {
    this.piano = piano;
    this.actif = false;
    this.reperes = [];
  }

  /**
   * @param source  () => { tempo, mesure (pas), temps (pas), fin (pas), notesA(pas) → [{ h, l, v }] }
   * @param options {
   *   depuis      pas de départ ;
   *   boucle      [de, a[ ou null ;
   *   metronome   clics sur chaque temps ;
   *   decompte    nombre de mesures de clics avant de commencer ;
   *   sansFin     ne s'arrête pas à la fin de l'idée (enregistrement) ;
   *   surPosition(pas) à chaque image ; surFin() à l'arrêt.
   * }
   */
  async jouer(source, options = {}) {
    await this.piano.pret();
    this.arreter();
    const { depuis = 0, boucle = null, metronome = false, decompte = 0, sansFin = false, surPosition = () => {}, surFin = () => {} } = options;
    const ctx = this.piano.ctx;
    const s = source();
    this.source = source;
    this.options = { boucle, metronome, sansFin, surFin };
    this.actif = true;
    this.reperes = [];
    this.prochain = depuis - decompte * s.mesure;
    this.debutMusique = depuis;
    this.instant = ctx.currentTime + 0.08;
    this.minuterie = setInterval(() => this.programmer(), RYTHME);
    this.programmer();
    const image = () => {
      if (!this.actif) return;
      surPosition(this.position());
      this.animation = requestAnimationFrame(image);
    };
    this.animation = requestAnimationFrame(image);
  }

  /** Change la boucle ou le métronome sans s'arrêter. */
  regler(changements) {
    if (this.options) Object.assign(this.options, changements);
  }

  programmer() {
    if (!this.actif) return;
    const ctx = this.piano.ctx;
    const s = this.source();
    const dureePas = 60 / (s.tempo * 4);
    const { boucle, metronome, sansFin } = this.options;
    while (this.instant < ctx.currentTime + AVANCE) {
      const p = this.prochain, t = this.instant;
      const dansDecompte = p < this.debutMusique;
      if (!dansDecompte) {
        for (const n of s.notesA(p)) this.piano.note(n.h, n.l * dureePas, n.v || 90, t);
      }
      const dansMesure = ((p % s.mesure) + s.mesure) % s.mesure;
      if ((metronome || dansDecompte) && dansMesure % s.temps === 0) this.clic(t, dansMesure === 0);
      this.reperes.push({ t, pas: p, dureePas });
      if (this.reperes.length > 256) this.reperes.splice(0, 128);
      this.prochain++;
      this.instant += dureePas;
      if (boucle && this.prochain >= boucle[1] && !dansDecompte) this.prochain = boucle[0];
      else if (!boucle && !sansFin && this.prochain >= Math.max(s.fin, this.debutMusique + 1)) {
        // La dernière note finit de sonner, puis on s'arrête.
        const reste = (this.instant - ctx.currentTime) * 1000;
        clearInterval(this.minuterie);
        this.minuterie = null;
        this.finPrevue = setTimeout(() => this.arreter(), reste + 150);
        return;
      }
    }
  }

  /** Où en est la musique, en pas (fractionnaires ; négatif pendant le décompte). */
  position(instant = null) {
    if (!this.reperes.length) return this.debutMusique ?? 0;
    const ctx = this.piano.ctx;
    const t = (instant ?? ctx.currentTime) - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
    let r = this.reperes[0];
    for (const x of this.reperes) { if (x.t <= t) r = x; else break; }
    return r.pas + Math.max(0, Math.min(1, (t - r.t) / r.dureePas));
  }

  /** Deux tons de clic : le premier temps de la mesure plus aigu. */
  clic(t, fort) {
    const ctx = this.piano.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = fort ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(fort ? 0.5 : 0.3, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.piano.sortie);
    o.start(t);
    o.stop(t + 0.08);
  }

  arreter() {
    const etait = this.actif;
    this.actif = false;
    clearInterval(this.minuterie);
    clearTimeout(this.finPrevue);
    cancelAnimationFrame(this.animation);
    this.minuterie = null;
    this.piano.silence();
    if (etait && this.options) this.options.surFin();
  }
}
