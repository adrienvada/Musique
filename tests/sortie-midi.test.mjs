/**
 * La sortie MIDI vers Live (audit du 04/10, M10), sans navigateur : un faux
 * port MIDI qui note ce qu'il reçoit et quand. Ce qu'on vérifie : les notes
 * partent horodatées, seulement dans les 100 ms à venir ; une même hauteur
 * jouée par deux voix ne s'éteint qu'avec la dernière ; l'arrêt éteint tout,
 * après le dernier message parti ; un port débranché rend le piano ; le
 * retour du port (IAC, loopMIDI) est reconnu ; et le transport y envoie ce
 * qu'il joue, piano muet ou non.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SortieMidi, HORIZON, enBoucle, portRetenu, sortieMidiPossible } from "../app/sortie-midi.js";
import { Transport } from "../app/transport.js";
import { Piano } from "../app/piano.js";
import { pasParMesure, pasParTemps } from "../app/sequence.js";
import { FauxContexte, fauxServeur, indexEssai } from "./faux-audio.mjs";

globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 16);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
// Les préférences de l'appareil (le port choisi, le piano muet) : un faux stockage local.
const prefs = new Map();
globalThis.localStorage = { getItem: (k) => (prefs.has(k) ? prefs.get(k) : null), setItem: (k, v) => prefs.set(k, String(v)), removeItem: (k) => prefs.delete(k) };

/** Un port de sortie qui note chaque message : [octets…, instant]. */
function fauxPort(id, name) {
  return { id, name, state: "connected", recus: [], send(octets, t) { this.recus.push([...octets, t]); }, open: async () => {} };
}
/** L'accès MIDI : des sorties, et le signal d'un port qui se branche ou se débranche. */
function fauxAcces(ports) {
  const acces = new EventTarget();
  acces.outputs = new Map(ports.map((p) => [p.id, p]));
  acces.inputs = new Map();
  return acces;
}
/** L'heure du son (s) → l'heure de la page (ms) : ici, la même horloge. */
const versPage = (t) => t * 1000;

async function sortieEssai() {
  prefs.clear();
  const port = fauxPort("iac-1", "Gestionnaire IAC Bus 1");
  const acces = fauxAcces([port]);
  let maintenant = 0;
  const s = new SortieMidi({ acces: async () => acces, maintenant: () => maintenant });
  await s.choisir("iac-1");
  return { s, port, acces, regler: (ms) => { maintenant = ms; } };
}

test("Chrome ou Edge sur ordinateur seulement, hors d'un cadre", () => {
  const nav = (mobile) => ({ requestMIDIAccess() {}, userAgentData: { mobile } });
  const fenetre = (navigator, cadre = false) => { const g = { navigator }; g.self = g; g.top = cadre ? {} : g; return g; };
  assert.equal(sortieMidiPossible(fenetre(nav(false))), true);
  assert.equal(sortieMidiPossible(fenetre(nav(true))), false, "Android");
  assert.equal(sortieMidiPossible(fenetre(nav(false), true)), false, "claude.ai");
  assert.equal(sortieMidiPossible(fenetre({ userAgentData: { mobile: false } })), false, "sans Web MIDI");
  assert.equal(sortieMidiPossible(fenetre({ requestMIDIAccess() {} })), false, "Firefox, Safari : pas de userAgentData");
});

test("les notes partent horodatées, seulement celles des 100 ms à venir", async () => {
  const { s, port } = await sortieEssai();
  assert.ok(HORIZON >= 0.08 && HORIZON <= 0.15);
  s.programmer(60, 1.0, 1.5, 100);
  s.programmer(64, 1.25, 1.5, 70);
  s.pousser(0.85, versPage);
  assert.deepEqual(port.recus, [], "trop tôt : rien ne part");
  s.pousser(0.91, versPage);
  assert.deepEqual(port.recus, [[0x90, 60, 100, 1000]]);
  s.pousser(1.2, versPage);
  assert.deepEqual(port.recus.slice(1), [[0x90, 64, 70, 1250]]);
  s.pousser(1.45, versPage);
  assert.deepEqual(port.recus.slice(2), [[0x80, 60, 0, 1500], [0x80, 64, 0, 1500]]);
  // La force reste entre 1 et 127.
  s.programmer(67, 2, 2.1, 200);
  s.programmer(69, 2, 2.1, 0.2);
  s.pousser(Infinity, versPage);
  assert.deepEqual(port.recus.slice(4).filter((m) => m[0] === 0x90).map((m) => m[2]), [127, 1]);
});

test("une même hauteur dans deux voix : relancée, éteinte avec la dernière ; une note redite juste après elle-même", async () => {
  const { s, port } = await sortieEssai();
  // Les accords tiennent le do de 1 à 2 s, la mélodie le rejoue de 1,2 à 1,4 s.
  s.programmer(60, 1.0, 2.0, 80);
  s.programmer(60, 1.2, 1.4, 90);
  s.pousser(Infinity, versPage);
  assert.deepEqual(port.recus, [
    [0x90, 60, 80, 1000],
    [0x80, 60, 0, 1200], [0x90, 60, 90, 1200],
    [0x80, 60, 0, 2000],
  ]);
  // Deux croches sur la même note, sans silence : la fin de la première avant le début de la seconde.
  port.recus.length = 0;
  s.programmer(62, 3.0, 3.25, 90);
  s.programmer(62, 3.25, 3.5, 90);
  s.pousser(Infinity, versPage);
  assert.deepEqual(port.recus, [[0x90, 62, 90, 3000], [0x80, 62, 0, 3250], [0x90, 62, 90, 3250], [0x80, 62, 0, 3500]]);
});

test("l'arrêt : ce qui n'est pas parti ne part pas, tout s'éteint après le dernier message parti", async () => {
  const { s, port, regler } = await sortieEssai();
  s.programmer(60, 1.0, 1.5, 90);
  s.programmer(64, 1.05, 1.5, 90);
  s.programmer(67, 1.3, 1.5, 90);
  s.pousser(0.96, versPage); // le do et le mi partent (le mi pour 1,05 s)
  assert.equal(port.recus.length, 2);
  regler(990); // on arrête à 0,99 s : le mi, déjà parti, sonnera à 1,05 s
  s.toutEteindre();
  const fin = port.recus.slice(2);
  // Les extinctions arrivent après le mi : sinon il partirait après elles, et tiendrait.
  assert.deepEqual(fin.map((m) => m.slice(0, 3)), [[0x80, 60, 0], [0x80, 64, 0], [0xb0, 123, 0]]);
  assert.ok(fin.every((m) => m[3] > 1050), JSON.stringify(fin));
  // Le sol n'était pas parti : il ne part jamais.
  s.pousser(Infinity, versPage);
  assert.equal(port.recus.length, 5);
});

test("un port débranché rend le piano ; rebranché (même nom), il reprend", async () => {
  const { s, port, acces } = await sortieEssai();
  s.muetVoulu = true;
  assert.ok(s.active && s.pianoMuet);
  port.state = "disconnected";
  acces.dispatchEvent(new Event("statechange"));
  assert.equal(s.active, false);
  assert.equal(s.pianoMuet, false, "Portée ne reste pas muette");
  assert.equal(s.nom, "Gestionnaire IAC Bus 1", "le réglage reste");
  s.programmer(60, 1, 2, 90);
  s.pousser(Infinity, versPage);
  assert.equal(port.recus.length, 0, "rien n'est envoyé à un port parti");
  // Revenu sous un autre identifiant (un autre démarrage du pilote) : retrouvé par son nom.
  const revenu = fauxPort("iac-2", "Gestionnaire IAC Bus 1");
  acces.outputs = new Map([["iac-2", revenu]]);
  acces.dispatchEvent(new Event("statechange"));
  assert.equal(s.active, true);
  assert.equal(s.port, revenu);
  // Le port gardé d'une visite à l'autre.
  assert.deepEqual(portRetenu(), { id: "iac-1", nom: "Gestionnaire IAC Bus 1" });
  const s2 = new SortieMidi({ acces: async () => acces });
  assert.equal(await s2.rebrancher(), true);
  assert.equal(s2.port, revenu);
  // Aucune : plus rien ne part, et le nom s'efface.
  await s2.choisir(null);
  assert.equal(s2.active, false);
  assert.equal(portRetenu(), null);
});

test("le retour du port (IAC, loopMIDI : une entrée du même nom) est reconnu, pour que le clavier l'ignore", async () => {
  await sortieEssai();
  assert.equal(enBoucle({ name: "Gestionnaire IAC Bus 1" }), true);
  assert.equal(enBoucle({ name: "Arturia KeyStep 37" }), false);
  prefs.clear();
  assert.equal(enBoucle({ name: "Gestionnaire IAC Bus 1" }), false, "sans sortie choisie, toute entrée est un clavier");
});

/** Le transport branché sur un faux piano et sur la sortie. */
async function transportEssai() {
  const ctx = new FauxContexte();
  // L'horloge de la page avance avec celle du son (le faux contexte avance à la main, depuis 1 s).
  ctx.avancer(1);
  ctx.getOutputTimestamp = () => ({ contextTime: ctx.currentTime, performanceTime: 5000 + ctx.currentTime * 1000 });
  const p = new Piano("piano/", { lire: fauxServeur(indexEssai()).lire });
  p.brancher(ctx);
  const t = new Transport(p);
  const essai = await sortieEssai();
  t.sortieMidi = essai.s;
  return { t, ctx, ...essai };
}
const arpege = () => {
  const parPas = new Map([[0, [{ h: 60, l: 2, v: 100 }]], [2, [{ h: 64, l: 2 }]], [4, [{ h: 67, l: 4 }]]]);
  return () => ({ tempo: 120, mesure: pasParMesure({ mesure: [4, 4] }), temps: pasParTemps({ mesure: [4, 4] }), fin: 8, notesA: (x) => parPas.get(x) || [] });
};
function laisserJouer(t, ctx, secondes) {
  for (let i = 0; i < Math.round(secondes / 0.025); i++) { ctx.avancer(0.025); t.programmer(); }
}

test("le transport envoie ce qu'il joue, aux instants du piano ; le piano peut se taire", async () => {
  const { t, ctx, port, s } = await transportEssai();
  try {
    await t.jouer(arpege());
    laisserJouer(t, ctx, 1.5);
    const debuts = port.recus.filter((m) => m[0] === 0x90);
    assert.deepEqual(debuts.map((m) => m[1]), [60, 64, 67]);
    assert.equal(debuts[0][2], 100);
    // Aux instants où le piano les joue (une croche : 250 ms à 120), sur l'heure de la page.
    const piano = ctx.sources.filter((x) => x.genre === "buffer").map((x) => x.debut);
    assert.equal(piano.length, 3, "le piano joue aussi");
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(debuts[i][3] - t.versPage(piano[i])) < 1, `${debuts[i][3]} / ${t.versPage(piano[i])}`);
    assert.ok(Math.abs(debuts[1][3] - debuts[0][3] - 250) < 1);
    t.arreter();
    // Le piano muet : seule la sortie joue.
    s.muetVoulu = true;
    port.recus.length = 0;
    const avant = ctx.sources.length;
    await t.jouer(arpege());
    laisserJouer(t, ctx, 1.5);
    assert.equal(ctx.sources.filter((x, i) => i >= avant && x.genre === "buffer").length, 0);
    assert.equal(port.recus.filter((m) => m[0] === 0x90).length, 3);
  } finally { t.arreter(); }
});

test("le transport arrêté : All Notes Off ; fini de lui-même : la dernière note s'éteint à sa fin", async () => {
  const { t, ctx, port } = await transportEssai();
  try {
    await t.jouer(arpege());
    laisserJouer(t, ctx, 0.3);
    t.arreter();
    assert.deepEqual(port.recus.at(-1).slice(0, 3), [0xb0, 123, 0]);
    port.recus.length = 0;
    await t.jouer(arpege());
    laisserJouer(t, ctx, 1.2);
    // La fin naturelle (programmée par le transport) : tout ce qui reste part, rien n'est coupé.
    t.arreter({ naturel: true });
    const fins = port.recus.filter((m) => m[0] === 0x80).map((m) => m[1]);
    assert.deepEqual(fins.sort(), [60, 64, 67]);
    // Ni au début (rien ne sonnait), ni à la fin : un All Notes Off couperait dans Live la dernière note.
    assert.ok(!port.recus.some((m) => m[0] === 0xb0), JSON.stringify(port.recus));
  } finally { t.arreter(); }
});
