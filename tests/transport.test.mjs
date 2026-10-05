/**
 * Le transport, sans navigateur (faux contexte audio, temps avancé à la
 * main) : « Arrêter » ne laisse partir ni note ni clic (M1), l'avance de
 * planification (M2), la fin naturelle qui ne coupe pas la dernière note,
 * l'instant d'un geste rapporté à ce qu'on entendait (M6), le tempo tapé au
 * temps de la mesure et le métronome qui le suit (M12).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Transport, AVANCE, tempoDesTapes } from "../app/transport.js";
import { Piano } from "../app/piano.js";
import { pasParMesure, pasParTemps } from "../app/sequence.js";
import { FauxContexte, fauxServeur, indexEssai } from "./faux-audio.mjs";

// Le transport suit la lecture image par image : sous Node, une image toutes les 16 ms suffit.
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 16);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

async function transportEssai() {
  const ctx = new FauxContexte();
  const p = new Piano("piano/", { lire: fauxServeur(indexEssai()).lire });
  p.brancher(ctx);
  const t = new Transport(p);
  return { t, p, ctx };
}

/** Une idée : une croche par pas pair (en 4/4 à 120), sur `mesures` mesures. */
function arpege({ tempo = 120, mesures = 4, mesure = [4, 4] } = {}) {
  const parPas = new Map();
  const total = mesures * pasParMesure({ mesure });
  for (let p = 0; p < total; p += 2) parPas.set(p, [{ h: 60 + (p % 12), l: 2 }]);
  return () => ({ tempo, mesure: pasParMesure({ mesure }), temps: pasParTemps({ mesure }), fin: total, notesA: (x) => parPas.get(x) || [] });
}

/** Fait avancer le temps par pas de 25 ms, comme la minuterie du transport. */
function laisserJouer(t, ctx, secondes) {
  for (let i = 0; i < Math.round(secondes / 0.025); i++) { ctx.avancer(0.025); t.programmer(); }
}

const sourcesPiano = (ctx) => ctx.sources.filter((s) => s.genre === "buffer");
const clics = (ctx) => ctx.sources.filter((s) => s.genre === "oscillateur");

test("l'avance : on programme ce qui tombe dans les 350 ms à venir", async () => {
  const { t, ctx } = await transportEssai();
  assert.ok(AVANCE >= 0.3 && AVANCE <= 0.4);
  await t.jouer(arpege());
  const debut = Math.min(...sourcesPiano(ctx).map((s) => s.debut));
  const fin = Math.max(...sourcesPiano(ctx).map((s) => s.debut));
  assert.ok(fin - ctx.currentTime <= AVANCE + 1e-9 && fin - ctx.currentTime > AVANCE - 0.13, `programmé jusqu'à ${fin}`);
  assert.ok(debut >= ctx.currentTime);
  t.arreter();
});

test("Arrêter : aucune note ni aucun clic ne part après, ce qui sonne s'éteint en 100 ms", async () => {
  const { t, ctx } = await transportEssai();
  let fini = 0;
  await t.jouer(arpege(), { metronome: true, surFin: () => fini++ });
  laisserJouer(t, ctx, 0.6);
  const arret = ctx.currentTime;
  const programmes = sourcesPiano(ctx).filter((s) => s.debut > arret).length;
  assert.ok(programmes >= 1, "des notes étaient programmées d'avance");
  t.arreter();
  assert.equal(fini, 1);
  for (const s of [...sourcesPiano(ctx), ...clics(ctx)]) {
    for (const x of [arret + 0.11, arret + 0.3, arret + 1]) assert.equal(s.sonneA(x), false, `${s.genre} partie à ${s.debut}, encore là à ${x}`);
  }
  // Et plus rien ne se programme.
  const avant = ctx.sources.length;
  laisserJouer(t, ctx, 0.5);
  assert.equal(ctx.sources.length, avant);
});

test("couper le métronome pendant la lecture : les clics déjà programmés ne partent pas", async () => {
  const { t, ctx } = await transportEssai();
  await t.jouer(arpege(), { metronome: true });
  laisserJouer(t, ctx, 0.2);
  const maintenant = ctx.currentTime;
  t.regler({ metronome: false });
  for (const c of clics(ctx)) if (c.debut > maintenant) assert.equal(c.sonneA(c.debut + 0.01), false);
  t.arreter();
});

test("la fin naturelle ne coupe pas la dernière note", async () => {
  const { t, ctx } = await transportEssai();
  let fini = 0;
  await t.jouer(arpege({ mesures: 1 }), { surFin: () => fini++ });
  laisserJouer(t, ctx, 2.5);
  assert.ok(t.fini);
  const derniere = sourcesPiano(ctx).sort((a, b) => b.debut - a.debut)[0];
  // Le transport s'arrête de lui-même (sa minuterie) ; on le fait ici à la main, comme elle.
  t.arreter({ naturel: true });
  assert.equal(fini, 1);
  assert.ok(!derniere.gainAval.evenements.some((e) => e.type === "cible" && e.tau < 0.05), "pas de fondu d'arrêt sur la dernière note");
});

test("l'instant d'un geste : ce qu'on entendait au moment de l'événement, moins la latence réglée", async () => {
  const { t, ctx } = await transportEssai();
  await t.jouer(arpege(), { sansFin: true });
  laisserJouer(t, ctx, 1);
  // Un geste qui a eu lieu il y a 80 ms (un message MIDI traité en retard, un toucher) :
  const maintenant = performance.now();
  const dureePas = 60 / (120 * 4);
  const ici = t.position(maintenant);
  const avant = t.position(maintenant - 80);
  assert.ok(Math.abs((ici - avant) - 0.08 / dureePas) < 0.05, `écart ${ici - avant} pas`);
  // getOutputTimestamp dit ce que joue le haut-parleur : la latence de sortie est retranchée.
  assert.ok(Math.abs(t.instantEntendu(maintenant) - (ctx.currentTime - ctx.latenceSortie)) < 0.005);
  // La latence de l'appareil (« tape avec le clic ») se retranche aussi.
  assert.ok(Math.abs((ici - t.position(maintenant, { latence: 0.05 })) - 0.05 / dureePas) < 0.05);
  // Sans getOutputTimestamp, l'horloge du contexte moins ses latences annoncées.
  ctx.horodatage = false;
  assert.ok(Math.abs(t.instantEntendu(maintenant) - (ctx.currentTime - ctx.outputLatency)) < 0.005);
  // Et l'inverse, pour horodater les messages MIDI.
  ctx.horodatage = true;
  const page = t.versPage(ctx.currentTime + 0.2);
  assert.ok(Math.abs(t.instantEntendu(page) - (ctx.currentTime + 0.2)) < 0.002);
  t.arreter();
});

test("le tempo tapé se compte au temps de la mesure, et le métronome bat ce qu'on a tapé", () => {
  // On tape toutes les 600 ms : 100 temps par minute.
  const cas = [
    { mesure: [4, 4], noires: 100 },
    { mesure: [6, 8], noires: 150 },   // le temps : la noire pointée
    { mesure: [12, 8], noires: 150 },  // avant : 100, et le métronome battait à 400 ms au lieu de 600
    { mesure: [2, 2], noires: 200 },   // la blanche
    { mesure: [3, 8], noires: 50 },    // la croche
  ];
  for (const { mesure, noires } of cas) {
    const temps = pasParTemps({ mesure });
    const tempo = tempoDesTapes([600, 600, 600], temps);
    assert.ok(Math.abs(tempo - noires) < 1e-9, `${mesure.join("/")} : ${tempo}`);
    // Le métronome clique tous les `temps` pas, à `tempo` noires (4 pas) par minute.
    const intervalle = temps * (60 / (tempo * 4));
    assert.ok(Math.abs(intervalle - 0.6) < 1e-9, `${mesure.join("/")} : un clic toutes les ${intervalle} s`);
  }
  assert.equal(tempoDesTapes([]), null);
});

test("le décompte clique au temps de la mesure (12/8 : quatre clics par mesure)", async () => {
  const { t, ctx } = await transportEssai();
  await t.jouer(arpege({ mesure: [12, 8], tempo: 150 }), { decompte: 1, sansFin: true });
  laisserJouer(t, ctx, 1.5);
  const departs = clics(ctx).map((c) => c.debut).sort((a, b) => a - b).slice(0, 4);
  const ecarts = departs.slice(1).map((x, i) => x - departs[i]);
  for (const e of ecarts) assert.ok(Math.abs(e - 0.6) < 1e-9, `clic toutes les ${e} s`);
  t.arreter();
});
