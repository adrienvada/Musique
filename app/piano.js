/**
 * LE PIANO
 *
 * Un Steinway enregistré note par note (échantillons AKAI du domaine
 * public, voir piano/LISEZMOI.md), en trois couches de nuances : MF, la
 * couche de base, puis PP et FF, chargées seulement quand une note jouée
 * doucement ou fort les demande (un clavier MIDI, une page lue et ses
 * accents). Une note prend l'échantillon le plus proche dans sa couche,
 * celui du dessus à égalité (descendre un son s'entend moins que le monter),
 * et le transpose de deux demi-tons au plus. Plus elle est jouée doucement,
 * plus un filtre passe-bas l'assombrit : la nuance change le timbre, pas
 * seulement le volume.
 *
 * Ce que l'audit du 04/10 a changé ici :
 *   - « Arrêter » coupe vraiment (M1). Le transport programme les notes un
 *     peu d'avance ; chaque voix, programmée ou qui sonne, est tenue dans
 *     une liste, et silence() empêche de partir celles qui n'ont pas commencé
 *     (avant, le gain programmé remettait le son après l'arrêt) et éteint les
 *     autres en quelques dizaines de millisecondes ;
 *   - le premier son vient vite (audit de l'interface) : les échantillons se
 *     téléchargent un par un, quatre à la fois, ceux de la note touchée
 *     d'abord, puis ceux du registre où l'on joue, puis le reste. Une note
 *     touchée avant que son échantillon soit là l'attend et part à son
 *     arrivée, au lieu d'être perdue. Avant, les 29 fichiers partaient
 *     ensemble : en 4G lente, rien ne sonnait avant dix secondes ;
 *   - un échec de téléchargement ne rend plus le piano muet jusqu'au
 *     rechargement (M3) : on réessaie au toucher suivant, un échantillon
 *     manquant est remplacé par son voisin, et le problème est dit
 *     (surProbleme), même quand le geste qui jouait ne l'écoute pas ;
 *   - un limiteur au lieu d'un compresseur (M4) : six notes fortes ensemble
 *     montaient à +4 dBFS et saturaient. Les échantillons ont −1 dB de marge
 *     et un gain chacun (echantillons.json), qui met d'accord deux voisins ;
 *   - la pédale de maintien (M9) : tant qu'elle est enfoncée, une touche
 *     relâchée continue de sonner ;
 *   - le retour d'arrière-plan ou d'un appel (M8) : reveiller() relance le
 *     son, ou recrée le contexte si Safari le garde endormi (les sons déjà
 *     décodés resservent).
 *
 * Le son ne peut démarrer qu'après un geste de l'utilisateur : le contexte se
 * crée et se réveille dans le geste qui joue (debut(), pret()).
 */
import { sessionAudio } from "./eveil.js";
import { accorde, pluriel } from "./ui.js";
import { expliquer } from "./erreurs.js";

/** Le niveau de la sortie, avant le limiteur. */
export const GAIN_SORTIE = 0.6;
/** Le limiteur : seuil −6 dBFS, sans genou, ratio 20, attaque d'une milliseconde. */
export const LIMITEUR = { threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.12 };
/** Au-delà de cet écart (en demi-tons), un échantillon ne remplace pas le bon : la note l'attend (ou une autre couche la joue). */
const ECART_MAX = 3;
/** Le fondu quand on coupe (silence) : une constante de temps de 12 ms, la voix s'arrête 100 ms après. */
const FONDU = 0.012;
/** Combien de temps attendre que le son se réveille avant de le dire. */
const REVEIL_MAX = 1500;
/** Combien de téléchargements à la fois : assez pour remplir un bon réseau, pas trop pour qu'un réseau lent serve d'abord ce qu'on attend. */
const EN_PARALLELE = 4;
/** Le registre servi en premier tant que l'appli n'en a pas dit d'autre (preferer) : l'octave du do central. */
const REGISTRE = [60, 72];
/** Une note qui attend son échantillon plus longtemps ne part plus : elle arriverait trop tard pour avoir un sens. */
const ATTENTE_MAX = 2500;
/** Avant de dire « piano en chargement », on laisse au réseau le temps de répondre. */
const AVANT_DE_DIRE = 250;
/** Un échantillon manqué ne se redemande pas avant ce délai. */
const REESSAI = 5000;
export const MESSAGE_RESEAU = "Le piano n'a pas pu se télécharger : il lui faut le réseau la première fois. Touche une note pour réessayer.";

/** Le gain d'une note selon sa force (1-127) : la courbe d'avant, relevée de ce que le limiteur n'ajoute plus. */
export const gainDeForce = (v) => 1.05 * Math.pow(Math.max(1, Math.min(127, v)) / 127, 1.4);

/**
 * La fréquence de coupure du passe-bas : ouverte en haut des vélocités de la
 * couche, deux fois plus basse tous les 20 de force en dessous (bornée à
 * 800 Hz). En haut d'une couche, l'échantillon sonne tel qu'enregistré ; en
 * bas, il s'approche du timbre de la couche plus douce.
 */
export function coupure(force, haut) {
  return Math.max(800, Math.min(20000, 20000 * Math.pow(2, -(haut - force) / 20)));
}

/** L'échantillon le plus proche de `midi` (celui du dessus à égalité de distance). */
export function plusProche(echantillons, midi) {
  let m = null;
  for (const e of echantillons) {
    if (!m) { m = e; continue; }
    const d = Math.abs(e.midi - midi), dm = Math.abs(m.midi - midi);
    if (d < dm || (d === dm && e.midi > m.midi)) m = e;
  }
  return m;
}

/** Le nom de la couche dont les vélocités contiennent `force` ; la base sinon. */
export function coucheDe(index, force) {
  const c = (index.couches || []).find((x) => force >= x.velocites[0] && force <= x.velocites[1]);
  return c ? c.nom : index.base;
}

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

export class Piano {
  /**
   * @param base   l'adresse du dossier des échantillons (finit par « / »)
   * @param options { lire(url) → Response : fetch par défaut (les tests le remplacent) }
   */
  constructor(base, { lire = null } = {}) {
    this.base = base;
    this.lire = lire || ((u) => fetch(u));
    this.ctx = null;
    this.index = null;
    this.couches = new Map(); // nom → l'état de la couche (voir couche())
    this.files = [[], [], []]; // ce qui reste à télécharger : maintenant, la base, les autres couches
    this.enVol = 0;
    this.voix = new Set(); // toutes les voix programmées ou qui sonnent
    this.attentes = new Set(); // les notes touchées qui attendent leur échantillon
    this.attendus = 0;
    this.registre = REGISTRE;
    this.pedaleBas = false;
    /** Dire un problème (réseau, son bloqué) : branché par l'appli sur ses messages. */
    this.surProbleme = null;
    /** Dire que le piano se télécharge (true), puis qu'il est là (false). */
    this.surAttente = null;
    /** Ce qui doit savoir qu'un nouveau contexte remplace l'ancien (le transport s'arrête). */
    this.recreations = new Set();
  }

  /** Les échantillons de la couche de base déjà là, ou null tant qu'aucun ne l'est. */
  get echantillons() {
    const c = this.index && this.couches.get(this.index.base);
    return c && c.echantillons.length ? c.echantillons : null;
  }

  // --- Le contexte audio -------------------------------------------------------------

  /** Crée le contexte et la sortie, une fois (synchrone : dans le geste). */
  contexte() {
    if (this.ctx) return this.ctx;
    // Avant de créer le contexte : sur l'iPhone, le son passe alors même en silencieux.
    sessionAudio("playback");
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error("Ce navigateur ne sait pas jouer de son.");
    let ctx;
    try { ctx = new AC({ latencyHint: "interactive" }); } catch { ctx = new AC(); }
    this.brancher(ctx);
    return ctx;
  }

  /** La sortie sur un contexte donné (l'appli, ou un contexte hors ligne pour les essais) : gain, puis limiteur. */
  brancher(ctx) {
    this.ctx = ctx;
    // Un contexte hors ligne (essais) ne se réveille pas : il rend quand on le lui demande.
    this.horsLigne = typeof ctx.startRendering === "function";
    this.sortie = ctx.createGain();
    this.sortie.gain.value = GAIN_SORTIE;
    const lim = ctx.createDynamicsCompressor();
    for (const [k, v] of Object.entries(LIMITEUR)) lim[k].value = v;
    this.sortie.connect(lim).connect(ctx.destination);
    this.limiteur = lim;
  }

  /** Réveille le son ; rend true s'il tourne. Safari peut ne jamais tenir la promesse : on n'attend pas plus de `delai`. */
  async reprendre(delai = REVEIL_MAX) {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.state === "running" || this.horsLigne) return true;
    sessionAudio("playback");
    let r;
    try { r = ctx.resume(); } catch { return false; }
    await Promise.race([Promise.resolve(r).catch(() => {}), attendre(delai)]);
    return ctx.state === "running";
  }

  /**
   * Au retour d'arrière-plan, d'un appel, de l'écran verrouillé : le son
   * reprend. S'il ne reprend pas (Safari garde parfois le contexte endormi
   * pour de bon), on en crée un autre : les sons décodés y resservent, et le
   * prochain toucher le réveille.
   */
  async reveiller() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    if (await this.reprendre()) return;
    if (this.ctx === ctx) this.recreer();
  }

  recreer() {
    const ancien = this.ctx;
    this.silence();
    this.voix.clear();
    this.ctx = null;
    for (const f of this.recreations) { try { f(); } catch { /* chacun pour soi */ } }
    try { ancien.close(); } catch { /* déjà fermé */ }
    this.contexte();
  }

  /**
   * Le piano prêt à jouer `hauteurs` (les notes d'une écoute) : le contexte
   * réveillé, et leurs échantillons arrivés (ou manqués : leurs voisins les
   * remplacent). Sans hauteurs, celui du registre où l'on joue. Le reste se
   * télécharge ensuite, sans faire attendre. Une erreur dit pourquoi si rien
   * ne vient (le réseau, le son bloqué).
   */
  async pret({ hauteurs = null } = {}) {
    this.contexte();
    if (!(await this.reprendre())) {
      const e = new Error("Le son ne démarre pas : touche à nouveau dans un instant (un appel ou une autre appli le garde peut-être).");
      this.signaler(e.message);
      throw e;
    }
    try { await this.chargerIndex(); } catch (e) { this.signaler(expliquer(e, MESSAGE_RESEAU)); throw e; }
    const base = this.couche(this.index.base);
    const voulus = this.echantillonsPour(base, hauteurs && hauteurs.length ? hauteurs : [Math.round((this.registre[0] + this.registre[1]) / 2)]);
    this.demander(base, voulus, { priorite: 0 });
    this.demander(base, this.ordreDeFond(base), { priorite: 1 });
    this.lance = true;
    this.attenteCommence();
    try { await this.attendreEchantillons(base, voulus); } finally { this.attenteFinie(); }
    if (!base.echantillons.length) { this.signaler(MESSAGE_RESEAU); throw new Error(MESSAGE_RESEAU); }
  }

  /**
   * Le registre où l'on joue (le clavier affiché) : ses échantillons passent
   * devant les autres. Avec `prechauffer`, ils se téléchargent tout de suite,
   * avant le premier toucher (sans être décodés : il faudrait un contexte
   * audio, qui attend un geste) ; le premier son n'a plus qu'à les décoder.
   * Rien ne se télécharge d'avance si le navigateur demande d'économiser les données.
   */
  preferer(bas, haut, { prechauffer = false } = {}) {
    this.registre = [bas, haut];
    const voulus = [];
    for (let h = bas; h <= haut; h++) voulus.push(h);
    if (this.index && this.ctx) {
      this.demander(this.couche(this.index.base), this.echantillonsPour(this.couche(this.index.base), voulus), { priorite: 0 });
      return;
    }
    const econome = globalThis.navigator && navigator.connection && navigator.connection.saveData;
    if (!prechauffer || econome) return;
    // Discret : un réseau absent se dira au premier son, pas à l'ouverture de l'idée.
    this.chargerIndex().then(() => {
      const base = this.couche(this.index.base);
      for (const midi of this.echantillonsPour(base, voulus)) this.precharger(base, midi);
    }, () => {});
  }

  /** Les octets d'un échantillon, téléchargés d'avance (décodés à son premier usage). */
  precharger(c, midi) {
    if (c.octets.has(midi) || c.etats.get(midi) === "pret") return;
    const def = c.defs.find((d) => d.midi === midi);
    const p = Promise.resolve(this.lire(this.base + def.fichier)).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); });
    c.octets.set(midi, p);
    p.catch(() => c.octets.delete(midi));
  }

  // --- Le téléchargement ----------------------------------------------------------------

  /** La liste des échantillons (une fois ; un échec se réessaie à l'appel suivant). */
  chargerIndex() {
    if (this.index) return Promise.resolve(this.index);
    if (!this.indexEnCours) {
      this.indexEnCours = (async () => {
        let r = null;
        try { r = await this.lire(this.base + "echantillons.json"); } catch { /* le réseau */ }
        if (!r || !r.ok) throw new Error(MESSAGE_RESEAU);
        this.index = { base: "mf", ...(await r.json()) };
        return this.index;
      })();
      // Une promesse rejetée ne se garde pas : le toucher suivant réessaie (M3).
      this.indexEnCours.then(() => { this.indexEnCours = null; }, () => { this.indexEnCours = null; });
    }
    return this.indexEnCours;
  }

  /** L'état d'une couche : ses échantillons prévus, ceux qui sont là, et où en est chacun. */
  couche(nom) {
    let c = this.couches.get(nom);
    if (c) return c;
    const def = this.index.couches.find((x) => x.nom === nom);
    if (!def) throw new Error(`Couche inconnue : ${nom}`);
    c = {
      nom, velocites: def.velocites,
      defs: [...def.echantillons].sort((a, b) => a.midi - b.midi),
      echantillons: [],
      etats: new Map(), // midi → "attente" | "vol" | "pret" | "echec"
      echecs: new Map(), // midi → quand
      octets: new Map(), // midi → promesse des octets téléchargés d'avance (preferer)
      attentes: [], // { midis, ok } : qui attend quels échantillons
      signale: false,
    };
    this.couches.set(nom, c);
    return c;
  }

  /** Les échantillons qui joueront ces hauteurs (les plus proches, dans la liste complète de la couche). */
  echantillonsPour(c, hauteurs) {
    return [...new Set(hauteurs.map((h) => plusProche(c.defs, h).midi))];
  }

  /** Tous les échantillons de la couche, du plus proche du registre au plus loin. */
  ordreDeFond(c) {
    const milieu = (this.registre[0] + this.registre[1]) / 2;
    return c.defs.map((d) => d.midi).sort((a, b) => Math.abs(a - milieu) - Math.abs(b - milieu));
  }

  /**
   * Met des échantillons en file : priorité 0, ce qu'on attend maintenant (le
   * dernier demandé passe en tête) ; 1, le reste de la base ; 2, les autres
   * couches. Ce qui est là, en route, ou manqué il y a peu ne bouge pas.
   */
  demander(c, midis, { priorite = 1 } = {}) {
    const maintenant = Date.now();
    const neufs = [];
    for (const midi of midis) {
      const etat = c.etats.get(midi);
      if (etat === "pret" || etat === "vol") continue;
      if (etat === "echec" && maintenant - c.echecs.get(midi) < REESSAI) continue;
      if (etat === "attente") {
        // Déjà en file : il n'y recule jamais ; une demande urgente le fait passer en tête.
        const ici = (x) => x.c === c && x.midi === midi;
        const p = this.files.findIndex((f) => f.some(ici));
        if (p >= 0 && (p < priorite || (p === priorite && priorite > 0))) continue;
        if (p >= 0) this.files[p].splice(this.files[p].findIndex(ici), 1);
      }
      c.etats.set(midi, "attente");
      neufs.push({ c, midi });
    }
    if (priorite === 0) this.files[0].unshift(...neufs);
    else this.files[priorite].push(...neufs);
    this.pomper();
  }

  pomper() {
    while (this.enVol < EN_PARALLELE) {
      const f = this.files.find((x) => x.length);
      if (!f) return;
      const { c, midi } = f.shift();
      if (c.etats.get(midi) !== "attente") continue;
      c.etats.set(midi, "vol");
      this.enVol++;
      this.telecharger(c, midi).finally(() => { this.enVol--; this.pomper(); });
    }
  }

  async telecharger(c, midi) {
    const def = c.defs.find((d) => d.midi === midi);
    try {
      let octets = null;
      const avance = c.octets.get(midi);
      c.octets.delete(midi);
      if (avance) octets = await avance.catch(() => null);
      if (!octets) {
        const r = await this.lire(this.base + def.fichier);
        if (!r.ok) throw new Error(String(r.status));
        octets = await r.arrayBuffer();
      }
      const buffer = await this.ctx.decodeAudioData(octets);
      const e = { midi, buffer, gain: def.gain ?? 1 };
      const i = c.echantillons.findIndex((x) => x.midi > midi);
      if (i < 0) c.echantillons.push(e); else c.echantillons.splice(i, 0, e);
      c.etats.set(midi, "pret");
    } catch {
      c.etats.set(midi, "echec");
      c.echecs.set(midi, Date.now());
    }
    this.apresArrivee(c);
  }

  /** Un échantillon est arrivé (ou a manqué) : ceux qui l'attendaient repartent. */
  apresArrivee(c) {
    const regle = (m) => { const e = c.etats.get(m); return e === "pret" || e === "echec"; };
    c.attentes = c.attentes.filter((a) => { if ([...a.midis].every(regle)) { a.ok(); return false; } return true; });
    if (c === this.couches.get(this.index.base)) this.reprendreAttentes();
    // Tout est passé, et il en manque : on le dit une fois (la base seulement ; les autres couches ont la base).
    const enCours = [...c.etats.values()].some((e) => e === "attente" || e === "vol");
    const manques = [...c.etats.values()].filter((e) => e === "echec").length;
    if (!enCours && manques && c.echantillons.length && c.nom === this.index.base && !c.signale) {
      c.signale = true;
      this.signaler(`${pluriel(manques, "note")} du piano n'${accorde(manques, "a", "ont")} pas pu se télécharger : ${accorde(manques, "sa voisine la remplace", "leurs voisines les remplacent")}.`);
    }
    if (!manques) c.signale = false;
  }

  /** Attend que ces échantillons soient là, ou manqués. */
  attendreEchantillons(c, midis) {
    const regle = (m) => { const e = c.etats.get(m); return e === "pret" || e === "echec"; };
    if (midis.every(regle)) return Promise.resolve();
    return new Promise((ok) => c.attentes.push({ midis: new Set(midis), ok }));
  }

  /** Toute une couche (la base sans nom), attendue jusqu'au bout : les essais hors ligne, les couches PP et FF. */
  async chargerCouche(nom = null, { priorite = 2 } = {}) {
    try { await this.chargerIndex(); } catch (e) { this.signaler(expliquer(e, MESSAGE_RESEAU)); throw e; }
    const c = this.couche(nom || this.index.base);
    const tous = c.defs.map((d) => d.midi);
    this.demander(c, tous, { priorite });
    await this.attendreEchantillons(c, tous);
    if (!c.echantillons.length) throw new Error(MESSAGE_RESEAU);
    return c;
  }

  /** Les échantillons de la base, attendus jusqu'au bout. */
  charger() {
    this.lance = true;
    return this.chargerCouche(null, { priorite: 1 });
  }

  /** Une couche plus douce ou plus forte, chargée en arrière-plan ; en attendant, la base la remplace. */
  chargerPlusTard(nom) {
    const c = this.couche(nom);
    this.demander(c, this.ordreDeFond(c), { priorite: 2 });
  }

  /** Dit un problème à l'appli, une fois toutes les huit secondes au plus pour le même. */
  signaler(texte) {
    const t = Date.now();
    if (this.dernierSignal && this.dernierSignal.texte === texte && t - this.dernierSignal.t < 8000) return;
    this.dernierSignal = { texte, t };
    try { if (this.surProbleme) this.surProbleme(texte); } catch { /* l'appli s'en charge */ }
  }

  /** « Piano en chargement » : dit si l'attente dure, et quand elle finit. */
  attenteCommence() {
    if (this.attendus++ > 0) return;
    clearTimeout(this.minuterieAttente);
    this.minuterieAttente = setTimeout(() => {
      if (this.attendus > 0 && !this.ditAttente) { this.ditAttente = true; try { if (this.surAttente) this.surAttente(true); } catch { /* facultatif */ } }
    }, AVANT_DE_DIRE);
  }

  attenteFinie() {
    if (this.attendus === 0 || --this.attendus > 0) return;
    clearTimeout(this.minuterieAttente);
    if (this.ditAttente) { this.ditAttente = false; try { if (this.surAttente) this.surAttente(false); } catch { /* facultatif */ } }
  }

  // --- Jouer ------------------------------------------------------------------------

  /** La couche et l'échantillon d'une note, parmi ceux qui sont là. */
  choisir(midi, force) {
    const base = this.couches.get(this.index.base);
    let couche = base;
    const voulue = coucheDe(this.index, force);
    if (voulue !== base.nom) {
      const c = this.couches.get(voulue);
      if (c && c.echantillons.length) couche = c;
      else this.chargerPlusTard(voulue);
    }
    let e = plusProche(couche.echantillons, midi);
    if (couche !== base && Math.abs(e.midi - midi) > ECART_MAX) { couche = base; e = plusProche(base.echantillons, midi); }
    return { couche, e };
  }

  /** Le bon échantillon de cette note est-il là, ou un voisin assez proche, ou le bon est-il manqué (le voisin le remplace) ? */
  jouable(base, midi) {
    if (!base || !base.echantillons.length) return false;
    const ideal = plusProche(base.defs, midi).midi;
    const etat = base.etats.get(ideal);
    if (etat === "pret" || etat === "echec") return true;
    return Math.abs(plusProche(base.echantillons, midi).midi - midi) <= ECART_MAX;
  }

  /**
   * Joue une note : hauteur MIDI, durée en secondes, force 0-127, et
   * l'instant (horloge audio) où elle part : tout de suite par défaut.
   */
  note(midi, duree, force = 90, quand = null) {
    const v = this.debut(midi, force, quand, { duree });
    if (v && !v.attend) this.fin(v, v.t + Math.max(duree, 0.1));
    return v;
  }

  /**
   * Enfonce une touche : la note sonne jusqu'à fin() (le doigt se lève).
   * Jouée tout de suite (`quand` absent) avant que son échantillon soit là,
   * elle l'attend : son échantillon passe devant les autres, et elle part à
   * son arrivée (une voix « en attente », que fin() relâche aussi).
   */
  debut(midi, force = 90, quand = null, { duree = null } = {}) {
    let ctx;
    try { ctx = this.contexte(); } catch { return null; }
    // Dans le geste : un contexte endormi (ou recréé au retour d'arrière-plan) se réveille ici.
    if (ctx.state !== "running" && !this.horsLigne) this.reprendre().catch(() => {});
    // Le premier son lance tout le téléchargement (cette note d'abord, le reste ensuite).
    if (!this.lance) this.pret({ hauteurs: [midi] }).catch(() => {});
    const base = this.index && this.couches.get(this.index.base);
    if (!this.jouable(base, midi)) {
      if (base) this.demander(base, this.echantillonsPour(base, [midi]), { priorite: 0 });
      if (quand !== null && base && base.echantillons.length) return this.jouer(midi, force, quand);
      return quand === null ? this.attendreSon(midi, force, duree) : null;
    }
    const ideal = plusProche(base.defs, midi).midi;
    if (base.etats.get(ideal) !== "pret") this.demander(base, [ideal], { priorite: 0 });
    return this.jouer(midi, force, quand);
  }

  /** La voix elle-même : l'échantillon, son filtre, son gain, vers la sortie. */
  jouer(midi, force, quand) {
    const ctx = this.ctx;
    const { couche, e } = this.choisir(midi, force);
    const t = Math.max(quand ?? 0, ctx.currentTime + 0.01);
    // La même note qui sonnait encore (relâchée, ou tenue par la pédale) s'efface vite :
    // le marteau refrappe la corde, les deux sons ne s'additionnent pas.
    for (const v of this.voix) if (v.midi === midi && v.t < t && !v.coupee && (v.pedale || v.fin <= t)) this.couper(v, t, 0.04);
    const src = ctx.createBufferSource();
    src.buffer = e.buffer;
    src.playbackRate.value = Math.pow(2, (midi - e.midi) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(e.gain * gainDeForce(force), t);
    let filtre = null;
    const fc = coupure(force, couche.velocites[1]);
    if (fc < 16000) {
      filtre = ctx.createBiquadFilter();
      filtre.type = "lowpass";
      filtre.frequency.value = fc;
      filtre.Q.value = 0.707;
      src.connect(filtre).connect(g);
    } else src.connect(g);
    g.connect(this.sortie);
    src.start(t);
    src.stop(t + e.buffer.duration / src.playbackRate.value + 0.05);
    const v = { midi, src, g, filtre, t, fin: Infinity, pedale: false, coupee: false };
    this.voix.add(v);
    src.onended = () => {
      this.voix.delete(v);
      try { g.disconnect(); if (filtre) filtre.disconnect(); } catch { /* déjà débranché */ }
    };
    return v;
  }

  /** Une note touchée trop tôt : elle partira à l'arrivée de son échantillon (`duree` : une note courte, sinon tenue). */
  attendreSon(midi, force, duree) {
    const v = { midi, force, duree, attend: true, depuis: Date.now(), relache: false, vraie: null, t: Infinity, fin: Infinity, coupee: false, pedale: false };
    this.attentes.add(v);
    this.attenteCommence();
    // Un réseau qui ne répond plus : passé le délai, la note renonce (et « en chargement » s'efface).
    setTimeout(() => this.reprendreAttentes(), ATTENTE_MAX + 20);
    return v;
  }

  /** Des échantillons sont arrivés : les notes qui les attendaient partent (ou renoncent, si l'attente a trop duré). */
  reprendreAttentes() {
    if (!this.attentes.size) return;
    const base = this.index && this.couches.get(this.index.base);
    for (const v of [...this.attentes]) {
      const trop = Date.now() - v.depuis > ATTENTE_MAX;
      if (!v.coupee && !trop && !this.jouable(base, v.midi)) continue;
      this.attentes.delete(v);
      this.attenteFinie();
      if (v.coupee || trop) { v.coupee = true; continue; }
      const vraie = this.jouer(v.midi, v.force, null);
      v.vraie = vraie;
      v.t = vraie.t;
      // Une touche déjà relevée s'entend quand même, brièvement (ou tenue par la pédale).
      if (v.duree !== null) this.fin(vraie, vraie.t + Math.max(v.duree, 0.1));
      else if (v.relache) this.fin(vraie, this.pedaleBas ? null : vraie.t + 0.3);
    }
  }

  /**
   * L'étouffoir retombe, maintenant ou à l'instant donné. Une touche relâchée
   * pendant que la pédale de maintien est enfoncée continue de sonner, jusqu'à
   * ce que la pédale se relève (seulement pour ce qu'on joue, pas pour ce que
   * le transport programme : lui donne toujours l'instant).
   */
  fin(v, quand = null) {
    if (!v || !this.ctx || v.coupee) return;
    if (v.attend) {
      if (v.vraie) this.fin(v.vraie, quand);
      else v.relache = true;
      return;
    }
    if (quand === null && this.pedaleBas) { v.pedale = true; return; }
    const t = Math.max(quand ?? 0, this.ctx.currentTime);
    v.pedale = false;
    v.fin = t;
    v.g.gain.setTargetAtTime(0, t, 0.1);
    try { v.src.stop(t + 1); } catch { /* déjà arrêtée */ }
  }

  /** La pédale de maintien (CC64) s'enfonce ou se relève ; relevée, elle laisse retomber ce qu'elle tenait. */
  pedale(bas) {
    this.pedaleBas = !!bas;
    if (bas || !this.ctx) return;
    for (const v of this.voix) if (v.pedale) { v.pedale = false; this.fin(v, this.ctx.currentTime); }
  }

  /** Coupe une voix : si elle n'a pas commencé, elle ne partira pas ; sinon, un fondu très court. */
  couper(v, t, fondu = FONDU) {
    v.coupee = true;
    v.pedale = false;
    try { v.g.gain.cancelScheduledValues(t); } catch { /* rien de programmé */ }
    // Pas encore partie (même d'un cheveu) : son gain programmé vient d'être annulé, elle ne doit
    // pas partir au gain par défaut. Partie : l'événement qui a posé son gain reste, le fondu part de là.
    if (v.t >= t) {
      v.g.gain.setValueAtTime(0, t);
      try { v.src.stop(t); } catch { /* déjà arrêtée */ }
    } else {
      v.g.gain.setTargetAtTime(0, t, fondu);
      try { v.src.stop(t + fondu * 8); } catch { /* déjà arrêtée */ }
    }
  }

  /** Plus rien : ce qui sonne s'éteint, ce qui était programmé ne part pas, ce qui attendait son échantillon renonce. */
  silence() {
    for (const v of this.attentes) { v.coupee = true; this.attenteFinie(); }
    this.attentes.clear();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voix) this.couper(v, t);
    this.voix.clear();
  }
}
