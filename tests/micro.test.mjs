/**
 * Chanter une note : la hauteur se lit sur des sons fabriqués (sinus,
 * sons riches en harmoniques comme la voix, vibrato), et le bruit n'en
 * donne aucune. Puis ce que le micro dit à l'écran mesure après mesure (la
 * tenue, l'écart à la note, une même note redite) et ce que l'écran en fait
 * (l'aiguille, le trait de la voix), sans micro ni navigateur.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detecterHauteur, midiDe, Micro, tailleFenetre } from "../app/micro.js";
import { positionAiguille, creerFiltreSauts } from "../app/idee-chant.js";
import { raisonsEveil } from "../app/eveil.js";

const SR = 48000;
function son(f, { duree = 2048, harmoniques = [1], vibrato = 0, bruit = 0, graine = 1 } = {}) {
  let x = graine;
  const hasard = () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const t = new Float32Array(duree);
  let phase = 0;
  for (let i = 0; i < duree; i++) {
    const fi = f * (1 + vibrato * Math.sin((2 * Math.PI * 5.5 * i) / SR));
    phase += (2 * Math.PI * fi) / SR;
    let v = 0;
    harmoniques.forEach((a, k) => { v += a * Math.sin((k + 1) * phase); });
    t[i] = 0.3 * v + bruit * hasard();
  }
  return t;
}

test("sinus : la fréquence au demi-centième près, de la basse à la soprano", () => {
  for (const f of [82.41, 110, 196, 261.63, 440, 659.25, 987.77]) {
    const r = detecterHauteur(son(f), SR);
    assert.ok(r, `${f} Hz`);
    assert.ok(Math.abs(midiDe(r.hz) - midiDe(f)) < 0.05, `${f} Hz → ${r.hz}`);
    assert.ok(r.clarte > 0.9);
  }
});

test("une voix (harmoniques fortes, fondamentale faible) : la bonne octave", () => {
  // Une voix d'homme sur un la2 : le 2e et le 3e harmonique plus forts que la fondamentale.
  const r = detecterHauteur(son(110, { harmoniques: [0.4, 1, 0.8, 0.5, 0.3, 0.2] }), SR);
  assert.equal(Math.round(midiDe(r.hz)), 45);
  // Un sol4 chanté avec du vibrato et un peu de souffle.
  const v = detecterHauteur(son(392, { harmoniques: [1, 0.6, 0.3], vibrato: 0.012, bruit: 0.03 }), SR);
  assert.equal(Math.round(midiDe(v.hz)), 67);
  // Le même son à 44,1 kHz.
  const t = new Float32Array(2048);
  for (let i = 0; i < t.length; i++) t[i] = 0.3 * Math.sin((2 * Math.PI * 293.66 * i) / 44100);
  assert.equal(Math.round(midiDe(detecterHauteur(t, 44100).hz)), 62);
});

test("silence et bruit : pas de note", () => {
  assert.equal(detecterHauteur(new Float32Array(2048), SR), null);
  const bruit = son(440, { harmoniques: [0], bruit: 0.5, graine: 7 });
  const r = detecterHauteur(bruit, SR);
  assert.ok(r === null || r.clarte < 0.8, JSON.stringify(r));
});

// --- La tenue : ce que le micro dit à l'écran, mesure après mesure ---------------

/** Un Micro sans micro : on lui donne à la main le son de chaque mesure. */
function micro() {
  const notes = [], mesures = [];
  const m = new Micro({ surNote: (h) => notes.push(h), surEcoute: (x) => mesures.push(x) });
  let tampon = new Float32Array(2048);
  m.analyse = { getFloatTimeDomainData: (t) => t.set(tampon) };
  m.tampon = new Float32Array(2048);
  m.ctx = { sampleRate: SR };
  m.centre = null; m.compte = 0; m.derniere = null; m.silences = 99;
  return {
    notes, mesures,
    chante: (x, n = 1) => { tampon = x; for (let i = 0; i < n; i++) m.mesurer(); },
    tais: (n = 1) => { tampon = new Float32Array(2048); for (let i = 0; i < n; i++) m.mesurer(); },
  };
}
const voix = (f) => son(f, { harmoniques: [1, 0.6, 0.3] });

test("la tenue se remplit en six mesures, puis la note s'écrit, une seule fois", () => {
  const { notes, mesures, chante } = micro();
  chante(voix(392), 9);
  assert.deepEqual(notes, [67]);
  assert.deepEqual(mesures.slice(0, 6).map((x) => Math.round(x.tenue * 6)), [1, 2, 3, 4, 5, 6]);
  // Tenue au-delà : la barre reste pleine, rien de plus ne s'écrit.
  assert.ok(mesures.slice(6).every((x) => x.tenue === 1));
  // L'écran reçoit la hauteur exacte (en demi-tons fractionnaires) et l'écart à la note.
  const x = mesures[0];
  assert.equal(x.h, 67);
  assert.ok(Math.abs(x.m - 67) < 0.05, `m = ${x.m}`);
  assert.ok(Math.abs(x.cents) <= 5);
});

test("une voix un peu haute : l'écart se lit en centièmes de demi-ton", () => {
  const { mesures, chante } = micro();
  chante(voix(392 * 2 ** (30 / 1200)), 1); // trente centièmes au-dessus du sol4
  assert.equal(mesures[0].h, 67);
  assert.ok(Math.abs(mesures[0].cents - 30) <= 3, `cents = ${mesures[0].cents}`);
});

test("le silence remet la tenue à zéro ; la même note redite attend une respiration", () => {
  const { notes, mesures, chante, tais } = micro();
  chante(voix(392), 6);
  tais(1);
  assert.deepEqual(mesures[mesures.length - 1], { h: null, cents: 0, niveau: 0, m: null, tenue: 0 });
  // Un souffle trop court (moins de trois mesures de silence) : la même note ne se réécrit pas.
  chante(voix(392), 6);
  assert.deepEqual(notes, [67]);
  // Une vraie respiration : elle s'écrit de nouveau.
  tais(3);
  chante(voix(392), 6);
  assert.deepEqual(notes, [67, 67]);
});

test("une autre note s'écrit tout de suite, sans respirer (legato)", () => {
  const { notes, mesures, chante } = micro();
  chante(voix(392), 6);
  chante(voix(440), 6);
  assert.deepEqual(notes, [67, 69]);
  // La première mesure du la pourrait être la crête d'un vibrato : l'écran garde le sol le temps
  // d'une mesure (40 ms). À la deuxième, la tenue du la repart de zéro, et ces deux mesures comptent :
  // la note s'écrit toujours au bout de six.
  assert.equal(mesures[6].h, 67);
  assert.equal(mesures[7].h, 69);
  assert.equal(Math.round(mesures[7].tenue * 6), 2);
});

// --- Le vibrato, les sifflements, les cartes son rapides (audit du 04/10, M7) ------

/** Un son tenu, continu : une voix (trois harmoniques) qui vibre de ±`cents` à `vitesse` Hz, ou glisse de f à `vers` entre t1 et t2. */
function sonTenu(f, { sr = SR, duree = 1.5, cents = 0, vitesse = 5.5, vers = null, t1 = 0.6, t2 = 0.75 } = {}) {
  const x = new Float32Array(Math.round(sr * duree));
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    let fi = f * 2 ** ((cents * Math.sin(2 * Math.PI * vitesse * t)) / 1200);
    if (vers) fi = t < t1 ? f : t > t2 ? vers : f * (vers / f) ** ((t - t1) / (t2 - t1));
    phase += (2 * Math.PI * fi) / sr;
    x[i] = 0.2 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase)) * Math.min(1, t / 0.03);
  }
  return x;
}

/** Ce que le micro écrit de ce son : une mesure toutes les 40 ms, sur la fenêtre la plus récente, comme dans l'appli. */
function notesEcrites(x, sr = SR) {
  const notes = [];
  const m = new Micro({ surNote: (h) => notes.push(h) });
  const n = tailleFenetre(sr);
  let fin = 0;
  m.analyse = { getFloatTimeDomainData: (t) => { t.fill(0); const d = Math.max(0, fin - n); t.set(x.subarray(d, fin), n - (fin - d)); } };
  m.tampon = new Float32Array(n);
  m.ctx = { sampleRate: sr };
  m.derniere = null; m.silences = 99;
  const pas = Math.round(0.04 * sr);
  for (fin = pas; fin <= x.length; fin += pas) m.mesurer();
  return notes;
}

test("un grand vibrato : la note s'écrit quand même, une seule fois", () => {
  // Avant, une seule mesure à plus de 0,6 demi-ton de la moyenne remettait la tenue à zéro : dès
  // ±45 centièmes à 5 Hz, la note ne s'écrivait jamais. Une mesure isolée hors de la note est
  // maintenant la crête d'un vibrato ; il en faut deux de suite pour faire une autre note.
  for (const [cents, vitesse] of [[30, 5], [45, 5], [60, 5], [60, 6.5], [80, 5], [100, 5.5]]) {
    assert.deepEqual(notesEcrites(sonTenu(220, { cents, vitesse })), [57], `±${cents} c à ${vitesse} Hz`);
  }
});

test("le legato glissé reste deux notes, la justesse approximative une seule", () => {
  // Du la au do en 150 ms, du la au mi en 300 ms : la deuxième note s'écrit, après le glissé.
  assert.deepEqual(notesEcrites(sonTenu(220, { vers: 261.63 })), [57, 60]);
  assert.deepEqual(notesEcrites(sonTenu(220, { vers: 329.63, t2: 0.9 })), [57, 64]);
  // Un demi-ton, sans glisser : c'est une autre note (le seuil de la crête est à 0,8 demi-ton).
  assert.deepEqual(notesEcrites(sonTenu(220, { vers: 233.08, t2: 0.601 })), [57, 58]);
  // Une voix entre deux notes (le la chanté 45 centièmes trop haut) ne fait pas osciller la note.
  assert.deepEqual(notesEcrites(sonTenu(220 * 2 ** (45 / 1200))), [57]);
});

test("un sifflement aigu : la bonne octave jusqu'au do6", () => {
  // Avant, la recherche s'arrêtait à 1 200 Hz : un mi5, un la5 sifflés s'écrivaient une octave trop bas.
  for (const [f, h] of [[880, 81], [1318.5, 88], [1760, 93], [2093, 96]]) {
    const x = new Float32Array(2048);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / SR);
    const r = detecterHauteur(x, SR);
    assert.ok(r && Math.abs(midiDe(r.hz) - h) < 0.1, `${f} Hz → ${r && r.hz}`);
  }
});

test("une carte son à 88,2 ou 96 kHz : la fenêtre s'allonge, le grave d'une basse se reconnaît", () => {
  assert.equal(tailleFenetre(44100), 2048);
  assert.equal(tailleFenetre(48000), 2048);
  assert.equal(tailleFenetre(88200), 4096);
  assert.equal(tailleFenetre(96000), 4096);
  // Avant, à 96 kHz, rien sous 94 Hz : le mi1 (82 Hz) d'une basse n'était pas entendu.
  for (const sr of [88200, 96000]) {
    assert.deepEqual(notesEcrites(sonTenu(82.41, { sr, duree: 0.6 }), sr), [40], `${sr} Hz`);
    assert.deepEqual(notesEcrites(sonTenu(1760, { sr, duree: 0.6 }), sr), [93], `${sr} Hz, sifflé`);
  }
});

test("le micro s'ouvre sans traitement de la voix ; l'iPhone enregistre le temps de l'écoute, l'écran reste allumé", async () => {
  const contraintes = [], session = { type: "auto" };
  const avant = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { audioSession: session, mediaDevices: { getUserMedia: async (c) => { contraintes.push(c); return { getTracks: () => [{ stop() {} }] }; } } },
  });
  class FauxContexte {
    constructor() { this.state = "running"; this.sampleRate = 96000; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData: (t) => t.fill(0) }; }
    createMediaStreamSource() { return { connect() {} }; }
    close() { return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: FauxContexte };
  try {
    const m = new Micro({ surNote() {} });
    await m.demarrer();
    // Le gain automatique faisait varier le niveau d'une mesure à l'autre : coupé, comme l'écho et le bruit.
    assert.deepEqual(contraintes, [{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }]);
    assert.equal(session.type, "play-and-record");
    assert.equal(m.analyse.fftSize, 4096);
    assert.ok(raisonsEveil().has("chant"));
    m.arreter();
    assert.equal(session.type, "playback");
    assert.ok(!raisonsEveil().has("chant"));
    // Un micro refusé : la session revient à « playback » (le piano doit encore sonner en silencieux).
    navigator.mediaDevices.getUserMedia = async () => { throw new Error("refusé"); };
    await assert.rejects(new Micro({ surNote() {} }).demarrer(), /refusé/);
    assert.equal(session.type, "playback");
  } finally {
    delete globalThis.window;
    if (avant) Object.defineProperty(globalThis, "navigator", avant);
  }
});

// --- Ce que fait l'écran de ces mesures --------------------------------------------

test("l'aiguille : au milieu quand c'est juste, aux bords à un demi-ton, jamais au-delà", () => {
  assert.equal(positionAiguille(0), 50);
  assert.equal(positionAiguille(50), 96);
  assert.equal(positionAiguille(-50), 4);
  assert.equal(positionAiguille(300), 96);
  // La zone « juste » (± 10 centièmes) est celle que dessine idee-chant.css : 40,8 % à 59,2 %.
  assert.ok(Math.abs(positionAiguille(-10) - 40.8) < 1e-9 && Math.abs(positionAiguille(10) - 59.2) < 1e-9);
});

test("le trait de la voix ignore un saut d'octave isolé, mais suit un vrai changement de note", () => {
  const filtre = creerFiltreSauts();
  assert.equal(filtre(67), 67);
  assert.equal(filtre(67.2), 67.2);
  // YIN se trompe d'une octave le temps d'une mesure : rien n'est tracé…
  assert.equal(filtre(79), undefined);
  // … et la voix revient : le trait reprend là où il était.
  assert.equal(filtre(67.1), 67.1);
  // Un vrai saut (une quinte), confirmé par la mesure suivante : il se trace.
  assert.equal(filtre(74), undefined);
  assert.equal(filtre(74.1), 74.1);
  // Le silence remet le filtre à zéro : la première note d'après se trace sans condition.
  assert.equal(filtre(null), null);
  assert.equal(filtre(55), 55);
});
