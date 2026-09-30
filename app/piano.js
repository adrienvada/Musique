/**
 * LE PIANO
 *
 * Un Steinway enregistré note par note (échantillons AKAI du domaine
 * public, voir piano/LISEZMOI.md). On a gardé une note sur trois : chaque
 * note jouée prend l'échantillon le plus proche et le transpose de moins
 * de deux demi-tons, ce qui ne s'entend pas.
 *
 * Le son ne peut démarrer qu'après un geste de l'utilisateur : pret()
 * s'appelle depuis un clic.
 */
export class Piano {
  constructor(base) {
    this.base = base;
    this.ctx = null;
    this.echantillons = null;
    this.actives = new Set();
  }

  async pret() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("Ce navigateur ne sait pas jouer de son.");
      this.ctx = new AC();
      this.sortie = this.ctx.createGain();
      this.sortie.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      this.sortie.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.chargement) this.chargement = this.charger();
    await this.chargement;
  }

  async charger() {
    const index = await (await fetch(this.base + "index.json")).json();
    this.echantillons = await Promise.all(
      index.echantillons.map(async (e) => {
        const octets = await (await fetch(this.base + e.fichier)).arrayBuffer();
        return { midi: e.midi, buffer: await this.ctx.decodeAudioData(octets) };
      }),
    );
  }

  /** Joue une note : hauteur MIDI, durée en secondes, force 0-127. */
  note(midi, duree, force = 90) {
    if (!this.echantillons) return;
    let e = this.echantillons[0];
    for (const x of this.echantillons) if (Math.abs(x.midi - midi) < Math.abs(e.midi - midi)) e = x;
    const t = this.ctx.currentTime + 0.01;
    const src = this.ctx.createBufferSource();
    src.buffer = e.buffer;
    src.playbackRate.value = Math.pow(2, (midi - e.midi) / 12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.75 * Math.pow(force / 127, 1.4), t);
    const fin = t + Math.max(duree, 0.1);
    g.gain.setTargetAtTime(0, fin, 0.1); // l'étouffoir retombe
    src.connect(g).connect(this.sortie);
    src.start(t);
    src.stop(fin + 1);
    const entree = { src, g };
    this.actives.add(entree);
    src.onended = () => this.actives.delete(entree);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const { g } of this.actives) g.gain.setTargetAtTime(0, t, 0.05);
  }
}
