/**
 * JOUER : BOUCLE, MÉTRONOME, DÉCOMPTE, ENREGISTREMENT
 *
 * Tout ce que Portée fait sonner passe par ici : une idée, un morceau, une
 * page lue sur la tablette (ses notes, que joue l'écoute des pages). Une
 * idée se joue directement depuis ses notes, au pas près, pour trois
 * raisons :
 *   - on la modifie pendant qu'elle tourne en boucle (la source est relue
 *     à chaque instant) ;
 *   - l'enregistrement en direct a besoin d'une horloge exacte : décompte,
 *     métronome, et l'instant de chaque touche, en pas ;
 *   - l'accompagnement (harmonie.js) sonne avec la mélodie.
 *
 * Ordonnanceur classique de Web Audio : toutes les 25 ms, on programme ce
 * qui tombe dans les 350 ms à venir. Chaque pas programmé laisse un repère
 * (instant audio, pas) : c'est ce qui permet de dire « où on en est », boucle
 * comprise, et de placer une touche jouée.
 *
 * Pourquoi 350 ms d'avance (150 avant l'audit du 04/10, M2) : au téléphone,
 * regraver la partition pendant la boucle occupait le fil principal jusqu'à
 * 250 ms, et 7 à 16 % des notes partaient en retard. L'avance ne gêne plus
 * l'arrêt : « Arrêter » coupe aussi ce qui était programmé (piano.silence(),
 * et les clics du métronome ici).
 *
 * L'instant d'une touche (M6) : il est pris à l'événement (pointeur, clavier,
 * message MIDI), pas quand le code s'exécute, et rapporté à ce qu'on
 * entendait à cet instant-là (getOutputTimestamp : ce que le haut-parleur
 * joue) ; une latence réglée par l'appareil s'y retranche.
 */
import { garderEveille, laisserDormir, preparerLecture, annoncerLecture, finLecture } from "./eveil.js";

export const AVANCE = 0.35;
const RYTHME = 25;

/**
 * Le tempo (en noires par minute, comme l'idée le garde) d'après les
 * écarts entre des tapes, en millisecondes. On tape les temps, ceux que bat
 * le métronome : la noire pointée en 6/8, 9/8 et 12/8, la blanche en 2/2, la
 * croche en 3/8 (M12). Avant, l'écart était pris pour une noire : en 12/8, le
 * métronome battait aux deux tiers de ce qu'on avait tapé.
 * @param pasParTemps  le temps de la mesure, en pas (sequence.pasParTemps)
 */
export function tempoDesTapes(ecartsMs, pasParTemps = 4) {
  const ecarts = ecartsMs.filter((x) => x > 0);
  if (!ecarts.length) return null;
  const moyen = ecarts.reduce((a, b) => a + b, 0) / ecarts.length;
  return (60000 / moyen) * (pasParTemps / 4);
}

/** Les hauteurs qu'une écoute va jouer : le piano télécharge leurs échantillons d'abord. */
export function hauteursDe(s, depuis = 0) {
  const h = new Set();
  const fin = Math.min(s.fin, Math.max(0, depuis) + 8192);
  for (let p = Math.max(0, depuis); p < fin; p++) for (const n of s.notesA(p)) h.add(n.h);
  return [...h];
}

export class Transport {
  constructor(piano) {
    this.piano = piano;
    this.actif = false;
    this.attente = null; // l'écoute demandée qui attend le piano
    this.reperes = [];
    this.clics = []; // les clics programmés : { o, g, t, decompte }
    /** La sortie MIDI vers un autre logiciel (sortie-midi.js), quand l'appli en a branché une. */
    this.sortieMidi = null;
    // Un contexte audio neuf (retour d'arrière-plan) : ce qui était programmé n'existe plus.
    if (piano.recreations) piano.recreations.add(() => this.arreter());
  }

  /**
   * @param source  () => { tempo, mesure (pas), temps (pas), fin (pas), notesA(pas) → [{ h, l, v }] }
   * @param options {
   *   depuis      pas de départ ;
   *   boucle      [de, a[ ou null ;
   *   metronome   clics sur chaque temps ;
   *   decompte    nombre de mesures de clics avant de commencer ;
   *   sansFin     ne s'arrête pas à la fin de l'idée (enregistrement) ;
   *   titre       ce qui joue, pour les commandes de l'écran verrouillé ;
   *   relancer()  ce que fait « lecture » sur l'écran verrouillé ;
   *   surPosition(pas) à chaque image ; surFin() à l'arrêt.
   * }
   */
  async jouer(source, options = {}) {
    const { depuis = 0, boucle = null, metronome = false, decompte = 0, sansFin = false, surPosition = () => {}, surFin = () => {} } = options;
    // Une écoute qui attend le piano (il se télécharge) : arrêtée entre-temps, elle ne part
    // pas une fois qu'il est là (arreter() appelle son surFin) ; redemandée (le même bouton,
    // touché deux fois), seule la dernière demande part. jouer() rend alors false.
    const moi = { surFin };
    this.attente = moi;
    // Dans le geste, avant d'attendre le piano : Safari ne laisse jouer un élément <audio> que là.
    if (options.titre) preparerLecture();
    try { await this.piano.pret({ hauteurs: hauteursDe(source(), depuis) }); }
    catch (e) { if (this.attente === moi) this.attente = null; if (!this.actif) finLecture(); throw e; }
    if (this.attente !== moi) return false;
    this.attente = null;
    this.arreter();
    const ctx = this.piano.ctx;
    const s = source();
    this.source = source;
    this.options = { boucle, metronome, sansFin, surFin };
    this.actif = true;
    this.fini = false;
    this.reperes = [];
    this.prochain = depuis - decompte * s.mesure;
    this.debutMusique = depuis;
    this.instant = ctx.currentTime + 0.08;
    this.minuterie = setInterval(() => this.programmer(), RYTHME);
    this.programmer();
    garderEveille("lecture");
    if (options.titre) annoncerLecture({ titre: options.titre, arreter: () => this.arreter(), relancer: options.relancer || null });
    const image = () => {
      if (!this.actif) return;
      surPosition(this.position());
      this.animation = requestAnimationFrame(image);
    };
    this.animation = requestAnimationFrame(image);
    return true;
  }

  /** Change la boucle ou le métronome sans s'arrêter. */
  regler(changements) {
    if (!this.options) return;
    Object.assign(this.options, changements);
    // Le métronome coupé : les clics déjà programmés (hors décompte) ne partent pas.
    if (changements.metronome === false && this.actif) this.couperClics({ saufDecompte: true });
  }

  /** Les notes de la musique partent-elles aussi vers la sortie MIDI, et le piano se tait-il pendant ce temps ? */
  get midiActif() { return !!(this.sortieMidi && this.sortieMidi.active); }

  programmer() {
    if (!this.actif) return;
    const ctx = this.piano.ctx;
    const midi = this.midiActif ? this.sortieMidi : null;
    if (this.fini) { if (midi) midi.pousser(ctx.currentTime, (t) => this.versPage(t)); return; }
    const s = this.source();
    const dureePas = 60 / (s.tempo * 4);
    const { boucle, metronome, sansFin } = this.options;
    const muet = !!(midi && midi.pianoMuet);
    while (this.instant < ctx.currentTime + AVANCE) {
      const p = this.prochain, t = this.instant;
      const dansDecompte = p < this.debutMusique;
      if (!dansDecompte) {
        for (const n of s.notesA(p)) {
          const duree = n.l * dureePas, v = n.v || 90;
          if (!muet) this.piano.note(n.h, duree, v, t);
          if (midi) midi.programmer(n.h, t, t + duree, v);
        }
      }
      const dansMesure = ((p % s.mesure) + s.mesure) % s.mesure;
      if ((metronome || dansDecompte) && dansMesure % s.temps === 0) this.clic(t, dansMesure === 0, dansDecompte);
      this.reperes.push({ t, pas: p, dureePas });
      if (this.reperes.length > 256) this.reperes.splice(0, 128);
      this.prochain++;
      this.instant += dureePas;
      if (boucle && this.prochain >= boucle[1] && !dansDecompte) this.prochain = boucle[0];
      else if (!boucle && !sansFin && this.prochain >= Math.max(s.fin, this.debutMusique + 1)) {
        // La dernière note finit de sonner, puis on s'arrête, sans la couper.
        this.fini = true;
        const reste = (this.instant - ctx.currentTime) * 1000;
        this.finPrevue = setTimeout(() => this.arreter({ naturel: true }), reste + 150);
        break;
      }
    }
    if (midi) midi.pousser(ctx.currentTime, (t) => this.versPage(t));
    // Les clics passés ne servent plus à rien.
    const vieux = ctx.currentTime - 0.2;
    if (this.clics.length > 32) this.clics = this.clics.filter((c) => c.t > vieux);
  }

  // --- Les horloges ------------------------------------------------------------------

  /**
   * L'instant du contexte audio qu'on entendait à l'instant `tempsPage` de la
   * page (performance.now(), event.timeStamp, MIDIMessageEvent.timeStamp) :
   * getOutputTimestamp dit ce que le haut-parleur jouait à quel moment ; sans
   * lui, l'horloge du contexte moins ses latences annoncées.
   */
  instantEntendu(tempsPage = null) {
    const ctx = this.piano.ctx;
    const maintenant = performance.now();
    const T = tempsPage ?? maintenant;
    if (!ctx) return 0;
    try {
      const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (T - ts.performanceTime) / 1000;
    } catch { /* pas d'horodatage de sortie */ }
    return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0) - (maintenant - T) / 1000;
  }

  /** L'inverse : l'instant de la page où l'on entendra l'instant `t` du contexte (pour horodater les messages MIDI). */
  versPage(t) {
    const ctx = this.piano.ctx;
    const maintenant = performance.now();
    if (!ctx) return maintenant;
    try {
      const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.performanceTime + (t - ts.contextTime) * 1000;
    } catch { /* pas d'horodatage de sortie */ }
    return maintenant + (t - ctx.currentTime + (ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
  }

  /** Où en est la musique à l'instant entendu `t` du contexte, en pas (fractionnaires ; négatif pendant le décompte). */
  positionEntendue(t) {
    if (!this.reperes.length) return this.debutMusique ?? 0;
    let r = this.reperes[0];
    for (const x of this.reperes) { if (x.t <= t) r = x; else break; }
    return r.pas + Math.max(0, Math.min(1, (t - r.t) / r.dureePas));
  }

  /**
   * Où en est ce qu'on entend, en pas : maintenant, ou à l'instant `tempsPage`
   * d'un geste ; `latence` (en secondes) : le retard du geste sur ce qu'on
   * entend, réglé sur l'appareil (« tape avec le clic »).
   */
  position(tempsPage = null, { latence = 0 } = {}) {
    return this.positionEntendue(this.instantEntendu(tempsPage) - latence);
  }

  // --- Le métronome ------------------------------------------------------------------

  /** Deux tons de clic : le premier temps de la mesure plus aigu. */
  clic(t, fort, decompte = false) {
    const ctx = this.piano.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = fort ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(fort ? 0.75 : 0.45, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.piano.sortie);
    o.start(t);
    o.stop(t + 0.08);
    this.clics.push({ o, g, t, decompte });
    return { o, g, t };
  }

  /** Les clics programmés ne partent pas ; celui qui sonne s'éteint. */
  couperClics({ saufDecompte = false } = {}) {
    const ctx = this.piano.ctx;
    if (!ctx) { this.clics = []; return; }
    const t = ctx.currentTime;
    const gardes = [];
    for (const c of this.clics) {
      if (saufDecompte && c.decompte) { gardes.push(c); continue; }
      if (c.t + 0.08 <= t) continue;
      try {
        // Garder la valeur en cours plutôt que d'annuler la rampe (qui ferait sauter le gain).
        if (c.g.gain.cancelAndHoldAtTime) c.g.gain.cancelAndHoldAtTime(t);
        else c.g.gain.cancelScheduledValues(t);
        if (c.t >= t) { c.g.gain.setValueAtTime(0, t); c.o.stop(t); }
        else { c.g.gain.setTargetAtTime(0, t, 0.004); c.o.stop(t + 0.03); }
      } catch { /* déjà arrêté */ }
    }
    this.clics = gardes;
  }

  /**
   * Arrête : ce qui sonne s'éteint, ce qui était programmé ne part pas (le
   * piano, le métronome, la sortie MIDI). À la fin naturelle d'une écoute
   * (`naturel`), rien n'est coupé : la dernière note finit de sonner.
   */
  arreter({ naturel = false } = {}) {
    const etait = this.actif;
    this.actif = false;
    // Une écoute qui attendait encore le piano ne partira pas : son écran se remet en place.
    if (this.attente) { const a = this.attente; this.attente = null; try { a.surFin(); } catch { /* son écran s'en charge */ } }
    clearInterval(this.minuterie);
    clearTimeout(this.finPrevue);
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.animation);
    this.minuterie = null;
    if (!naturel) {
      this.piano.silence();
      this.couperClics();
      if (this.sortieMidi) this.sortieMidi.toutEteindre((t) => this.versPage(t));
    } else if (this.sortieMidi) this.sortieMidi.pousser(Infinity, (t) => this.versPage(t));
    this.clics = [];
    laisserDormir("lecture");
    finLecture();
    if (etait && this.options) this.options.surFin();
  }
}
