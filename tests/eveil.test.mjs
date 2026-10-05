/**
 * Garder le son et l'écran éveillés (audit du 04/10, M8), sans navigateur :
 * un faux navigator (session audio, verrou de l'écran, commandes de l'écran
 * verrouillé), un faux document qui se cache et revient. Ce qu'on vérifie :
 * la session audio suit le micro, l'écran reste allumé tant qu'une écoute, le
 * jeu en direct, le chant ou un mémo le demande (et le verrou revient au
 * retour sur la page), les commandes de l'écran verrouillé arrêtent et
 * relancent ce qui joue, et rien ne casse quand le navigateur ne sait pas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sessionAudio, garderEveille, laisserDormir, raisonsEveil, preparerLecture, annoncerLecture, finLecture, lectureAnnoncee, installerEveil } from "../app/eveil.js";
import { Transport } from "../app/transport.js";
import { Piano } from "../app/piano.js";
import { pasParMesure, pasParTemps } from "../app/sequence.js";
import { FauxContexte, fauxServeur, indexEssai } from "./faux-audio.mjs";

globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 16);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

// --- Un faux navigateur ----------------------------------------------------------

const verrous = [];
const wakeLock = {
  refuser: false,
  demandes: 0,
  async request(type) {
    this.demandes++;
    if (this.refuser) throw new Error("NotAllowedError");
    const v = new EventTarget();
    v.type = type;
    v.released = false;
    v.release = async () => { if (!v.released) { v.released = true; v.dispatchEvent(new Event("release")); } };
    verrous.push(v);
    return v;
  },
};
const mediaSession = { metadata: null, playbackState: "none", actions: {}, setActionHandler(a, f) { this.actions[a] = f; } };
const audioSession = { type: "auto" };
const faux = { audioSession, wakeLock, mediaSession };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: faux });
globalThis.MediaMetadata = class { constructor(o) { Object.assign(this, o); } };
const audios = [];
globalThis.Audio = class {
  constructor(src) { this.src = src; this.lectures = 0; this.pauses = 0; this.attributs = {}; audios.push(this); }
  play() { this.lectures++; return Promise.resolve(); }
  pause() { this.pauses++; }
  setAttribute(k, v) { this.attributs[k] = v; }
};
const doc = new EventTarget();
doc.visibilityState = "visible";
globalThis.document = doc;
globalThis.window = new EventTarget();

/** La page se cache ou revient. */
function voir(etat) {
  doc.visibilityState = etat;
  doc.dispatchEvent(new Event("visibilitychange"));
}

/** Laisse passer les promesses en cours (la demande du verrou). */
const derouler = () => new Promise((ok) => setTimeout(ok, 0));
const tenus = () => verrous.filter((v) => !v.released);

// --- La session audio --------------------------------------------------------------

test("la session audio : « playback » pour le piano, « play-and-record » le temps du micro ; rien ne casse sans elle", () => {
  sessionAudio("playback");
  assert.equal(audioSession.type, "playback");
  sessionAudio("play-and-record");
  assert.equal(audioSession.type, "play-and-record");
  sessionAudio("playback");
  assert.equal(audioSession.type, "playback");
  // Le piano la règle avant de créer son contexte : sur l'iPhone, il sonne alors même en silencieux.
  audioSession.type = "auto";
  const vrai = globalThis.AudioContext;
  globalThis.AudioContext = class extends FauxContexte {};
  try { new Piano("piano/").contexte(); } finally { globalThis.AudioContext = vrai; }
  assert.equal(audioSession.type, "playback");
  // Un navigateur sans session audio (tout sauf Safari), ou qui la refuse (un cadre isolé) : rien.
  delete faux.audioSession;
  assert.doesNotThrow(() => sessionAudio("playback"));
  Object.defineProperty(faux, "audioSession", { configurable: true, get: () => ({ set type(_) { throw new Error("refusé"); } }) });
  assert.doesNotThrow(() => sessionAudio("playback"));
  delete faux.audioSession;
  faux.audioSession = audioSession;
});

// --- L'écran allumé ----------------------------------------------------------------

test("l'écran reste allumé tant qu'une raison le demande, et se relâche avec la dernière", async () => {
  garderEveille("lecture");
  garderEveille("direct");
  await derouler();
  assert.equal(wakeLock.demandes, 1);
  assert.equal(tenus().length, 1);
  assert.equal(tenus()[0].type, "screen");
  laisserDormir("lecture");
  assert.equal(tenus().length, 1, "le jeu en direct le demande encore");
  laisserDormir("direct");
  assert.equal(tenus().length, 0);
  assert.equal(raisonsEveil().size, 0);
  // Accordé après coup, quand plus rien ne le demande : il est rendu aussitôt.
  garderEveille("chant");
  laisserDormir("chant");
  await derouler();
  assert.equal(tenus().length, 0);
});

test("le verrou relâché par le navigateur (page cachée) revient au retour sur la page, et le son se réveille", async () => {
  let reveils = 0;
  installerEveil({ piano: { reveiller: async () => { reveils++; } } });
  garderEveille("chant");
  await derouler();
  assert.equal(tenus().length, 1);
  // La page passe en arrière-plan : le navigateur rend le verrou de lui-même.
  voir("hidden");
  await tenus()[0].release();
  assert.equal(tenus().length, 0);
  assert.equal(reveils, 0, "caché, rien ne se réveille");
  // Elle revient : le son se réveille, le verrou est redemandé.
  voir("visible");
  await derouler();
  assert.equal(reveils, 1);
  assert.equal(tenus().length, 1);
  // Une page reprise du cache « précédent » (iPhone) : de même.
  await tenus()[0].release();
  const retour = new Event("pageshow");
  Object.defineProperty(retour, "persisted", { value: true });
  globalThis.window.dispatchEvent(retour);
  await derouler();
  assert.equal(reveils, 2);
  assert.equal(tenus().length, 1);
  laisserDormir("chant");
  assert.equal(tenus().length, 0);
  // Sans raison, le retour sur la page ne demande rien.
  const avant = wakeLock.demandes;
  doc.dispatchEvent(new Event("visibilitychange"));
  await derouler();
  assert.equal(wakeLock.demandes, avant);
});

test("un verrou refusé (cadre isolé, économie d'énergie) ne casse rien, et se redemande plus tard", async () => {
  wakeLock.refuser = true;
  assert.doesNotThrow(() => garderEveille("memo"));
  await derouler();
  assert.equal(tenus().length, 0);
  wakeLock.refuser = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  await derouler();
  assert.equal(tenus().length, 1);
  laisserDormir("memo");
  // Un navigateur sans verrou de l'écran : rien.
  delete faux.wakeLock;
  assert.doesNotThrow(() => { garderEveille("lecture"); laisserDormir("lecture"); });
  faux.wakeLock = wakeLock;
});

// --- Les commandes de l'écran verrouillé ----------------------------------------------

test("les commandes de l'écran verrouillé : le titre, pause et arrêt arrêtent, lecture relance", () => {
  let arrets = 0, relances = 0;
  preparerLecture();
  assert.equal(audios.length, 1, "le son muet qui tient les commandes");
  assert.equal(audios[0].lectures, 1);
  annoncerLecture({ titre: "Idée du matin", arreter: () => arrets++, relancer: () => relances++ });
  assert.equal(audios.length, 1, "un seul, réutilisé");
  assert.equal(mediaSession.metadata.title, "Idée du matin");
  assert.equal(mediaSession.metadata.artist, "Portée");
  assert.equal(mediaSession.playbackState, "playing");
  mediaSession.actions.pause();
  mediaSession.actions.stop();
  assert.equal(arrets, 2);
  mediaSession.actions.play();
  assert.equal(relances, 1);
  finLecture();
  assert.equal(mediaSession.playbackState, "paused");
  assert.equal(mediaSession.actions.pause, null);
  assert.equal(mediaSession.actions.stop, null);
  assert.ok(audios[0].pauses >= 1, "le son muet se tait");
  // « Lecture » reste : elle relance ce qui jouait.
  mediaSession.actions.play();
  assert.equal(relances, 2);
  // Sans relance possible (une page lue dans l'atelier, par exemple), pas de bouton lecture.
  annoncerLecture({ titre: "Page 3", arreter: () => arrets++ });
  assert.equal(mediaSession.actions.play, null);
  finLecture();
});

test("le transport annonce ce qui joue, garde l'écran allumé, et l'écran verrouillé l'arrête", async () => {
  const ctx = new FauxContexte();
  const p = new Piano("piano/", { lire: fauxServeur(indexEssai()).lire });
  p.brancher(ctx);
  const t = new Transport(p);
  const parPas = new Map([[0, [{ h: 60, l: 4 }]], [4, [{ h: 64, l: 4 }]]]);
  const source = () => ({ tempo: 120, mesure: pasParMesure({ mesure: [4, 4] }), temps: pasParTemps({ mesure: [4, 4] }), fin: 64, notesA: (x) => parPas.get(x) || [] });
  let finies = 0;
  assert.ok(await t.jouer(source, { titre: "Ma grille", surFin: () => finies++ }));
  await derouler();
  assert.ok(raisonsEveil().has("lecture"));
  assert.equal(tenus().length, 1);
  assert.equal(lectureAnnoncee().titre, "Ma grille");
  assert.equal(mediaSession.metadata.title, "Ma grille");
  assert.equal(mediaSession.playbackState, "playing");
  // « Arrêt » sur l'écran verrouillé.
  mediaSession.actions.stop();
  assert.equal(t.actif, false);
  assert.equal(finies, 1);
  assert.ok(!raisonsEveil().has("lecture"));
  assert.equal(tenus().length, 0);
  assert.equal(mediaSession.playbackState, "paused");
  // Une écoute sans titre (le clic d'une tape, un essai) ne touche pas aux commandes.
  mediaSession.metadata = null;
  await t.jouer(source);
  assert.equal(mediaSession.metadata, null);
  assert.ok(raisonsEveil().has("lecture"));
  t.arreter();
  assert.ok(!raisonsEveil().has("lecture"));
});

test("sans Media Session (claude.ai, vieux navigateur) : rien ne casse, aucun son muet", () => {
  delete faux.mediaSession;
  const avant = audios.length;
  assert.doesNotThrow(() => { preparerLecture(); annoncerLecture({ titre: "x", arreter() {} }); finLecture(); });
  assert.equal(audios.length, avant);
  faux.mediaSession = mediaSession;
});
