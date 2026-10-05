/**
 * Un faux contexte Web Audio, pour essayer sous Node le piano, le transport
 * et la sortie MIDI sans navigateur. Il ne fait aucun son : il garde ce
 * qu'on lui demande (départs, arrêts, automations des gains) et sait dire si
 * une source sonne à un instant donné. Le temps n'avance que quand le test
 * l'avance (avancer()).
 */

/** Un paramètre audio qui garde ses automations, et sait dire sa valeur à un instant. */
export class FauxParam {
  constructor(valeur = 1) { this.value = valeur; this.evenements = []; }
  setValueAtTime(v, t) { this.evenements.push({ type: "valeur", v, t }); return this; }
  setTargetAtTime(v, t, tau) { this.evenements.push({ type: "cible", v, t, tau }); return this; }
  linearRampToValueAtTime(v, t) { this.evenements.push({ type: "lineaire", v, t }); return this; }
  exponentialRampToValueAtTime(v, t) { this.evenements.push({ type: "expo", v, t }); return this; }
  cancelScheduledValues(t) { this.evenements = this.evenements.filter((e) => e.t < t); return this; }
  cancelAndHoldAtTime(t) { const v = this.valeurA(t); this.cancelScheduledValues(t); this.evenements.push({ type: "valeur", v, t }); return this; }
  /** La valeur à l'instant t, d'après les automations (approchée : assez pour les essais). */
  valeurA(t) {
    let v = this.value, t0 = 0;
    const evs = [...this.evenements].sort((a, b) => a.t - b.t);
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === "lineaire" || e.type === "expo") {
        if (t >= e.t) { v = e.v; t0 = e.t; continue; }
        const f = Math.max(0, (t - t0) / (e.t - t0));
        return e.type === "lineaire" ? v + (e.v - v) * f : v * Math.pow(e.v / Math.max(v, 1e-9), f);
      }
      if (e.t > t) break;
      if (e.type === "valeur") { v = e.v; t0 = e.t; }
      if (e.type === "cible") {
        const suivant = evs[i + 1];
        const fin = suivant && suivant.t <= t ? suivant.t : t;
        v = e.v + (v - e.v) * Math.exp(-(fin - e.t) / e.tau);
        t0 = fin;
      }
    }
    return v;
  }
}

class FauxNoeud {
  constructor(ctx) { this.context = ctx; this.sorties = []; }
  connect(n) { this.sorties.push(n); return n; }
  disconnect() { this.sorties = []; }
}

class FauxSource extends FauxNoeud {
  constructor(ctx, genre) {
    super(ctx);
    this.genre = genre;
    this.debut = null;
    this.arret = Infinity;
    this.onended = null;
    this.playbackRate = new FauxParam(1);
    this.frequency = new FauxParam(440);
    ctx.sources.push(this);
  }
  start(t = 0) { this.debut = t; }
  stop(t = 0) { this.arret = t; }
  /** Le gain qu'elle traverse (son premier nœud de gain en aval). */
  get gainAval() {
    let n = this.sorties[0];
    while (n && !n.gain) n = n.sorties[0];
    return n ? n.gain : null;
  }
  /** Sonne-t-elle à l'instant t ? Partie, pas arrêtée, et son gain au-dessus de −80 dB. */
  sonneA(t) {
    if (this.debut === null || t < this.debut || t >= this.arret || t >= this.debut + (this.buffer ? this.buffer.duration / this.playbackRate.value : 1)) return false;
    const g = this.gainAval;
    return !g || Math.abs(g.valeurA(t)) > 1e-4;
  }
}

export class FauxContexte {
  constructor({ latenceSortie = 0.04, sampleRate = 48000 } = {}) {
    this.currentTime = 0;
    this.state = "running";
    this.sampleRate = sampleRate;
    this.latenceSortie = latenceSortie;
    this.outputLatency = latenceSortie;
    this.baseLatency = 0;
    this.sources = [];
    this.destination = new FauxNoeud(this);
    this.horodatage = true; // getOutputTimestamp disponible
  }
  createGain() { const n = new FauxNoeud(this); n.gain = new FauxParam(1); return n; }
  createBufferSource() { return new FauxSource(this, "buffer"); }
  createOscillator() { return new FauxSource(this, "oscillateur"); }
  createBiquadFilter() { const n = new FauxNoeud(this); n.frequency = new FauxParam(350); n.Q = new FauxParam(1); n.type = "lowpass"; return n; }
  createDynamicsCompressor() {
    const n = new FauxNoeud(this);
    for (const k of ["threshold", "knee", "ratio", "attack", "release"]) n[k] = new FauxParam(0);
    return n;
  }
  async decodeAudioData(octets) {
    const o = new Uint8Array(octets);
    return { duration: o.length ? o[0] / 10 : 2, sampleRate: this.sampleRate, length: 1, numberOfChannels: 1 };
  }
  async resume() { if (this.state !== "closed") this.state = "running"; }
  async close() { this.state = "closed"; }
  /** Ce que le haut-parleur joue en ce moment : l'horloge du contexte, moins la latence de sortie. */
  getOutputTimestamp() {
    if (!this.horodatage) return { contextTime: 0, performanceTime: 0 };
    return { contextTime: Math.max(1e-6, this.currentTime - this.latenceSortie), performanceTime: performance.now() };
  }
  /** Le temps passe : les sources arrêtées finissent (onended). */
  avancer(dt) {
    this.currentTime += dt;
    for (const s of this.sources) {
      if (!s.fini && s.debut !== null && s.arret <= this.currentTime) { s.fini = true; if (s.onended) s.onended(); }
    }
  }
}

/**
 * Un faux fetch qui sert une liste d'échantillons et leurs fichiers ;
 * `pannes` : des adresses qui échouent (une fois chacune) ; `manuel` : les
 * réponses attendent qu'on les serve (servir(motif)), comme un réseau lent.
 */
export function fauxServeur(index, { pannes = [], manuel = false } = {}) {
  const restantes = [...pannes];
  const demandes = [];
  const enAttente = [];
  const repondre = (url) => {
    const i = restantes.findIndex((p) => url.includes(p));
    if (i >= 0) { restantes.splice(i, 1); throw new TypeError("Failed to fetch"); }
    if (url.endsWith("echantillons.json")) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(index)) };
    // Chaque faux fichier dit sa durée (en dixièmes de seconde) dans son premier octet.
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([40]).buffer };
  };
  const lire = async (url) => {
    demandes.push(url);
    if (manuel) await new Promise((ok) => enAttente.push({ url, ok }));
    return repondre(url);
  };
  /** Laisse les promesses se dérouler : les requêtes qui en découlent arrivent. */
  const derouler = async () => { for (let i = 0; i < 3; i++) await new Promise((ok) => setTimeout(ok, 0)); };
  /** Sert les requêtes en attente dont l'adresse contient `motif` (toutes sans motif), puis laisse les promesses se dérouler. */
  const servir = async (motif = "") => {
    await derouler();
    for (const r of enAttente.filter((x) => x.url.includes(motif))) { enAttente.splice(enAttente.indexOf(r), 1); r.ok(); }
    await derouler();
  };
  return { lire, demandes, servir, enAttente };
}

/** Une petite liste d'échantillons, à la façon de app/piano/echantillons.json. */
export function indexEssai({ base = "mf" } = {}) {
  const couche = (nom, velocites, notes) => ({ nom, velocites, echantillons: notes.map((midi) => ({ midi, fichier: `${String(midi).padStart(3, "0")}-${nom}.mp3`, gain: 1 })) });
  return {
    base,
    couches: [
      couche("mf", [65, 100], [48, 52, 55, 60, 64, 67, 72]),
      couche("pp", [1, 64], [48, 55, 60, 67, 72]),
      couche("ff", [101, 127], [48, 55, 60, 67]),
    ],
  };
}
