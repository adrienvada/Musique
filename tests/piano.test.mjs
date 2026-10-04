/**
 * Le piano, sans navigateur (faux contexte audio) : « Arrêter » coupe ce qui
 * était programmé (M1), un chargement manqué se réessaie et un échantillon
 * manquant est remplacé par son voisin (M3), le choix de l'échantillon et de
 * la couche selon la force, le filtre des nuances et le limiteur (M4), la
 * pédale de maintien (M9), le réveil après un appel ou l'arrière-plan (M8).
 * Et les vrais fichiers d'app/piano : la liste, les gains, les tailles.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Piano, plusProche, coucheDe, coupure, gainDeForce, GAIN_SORTIE, LIMITEUR } from "../app/piano.js";
import { FauxContexte, fauxServeur, indexEssai } from "./faux-audio.mjs";

/** Un piano branché sur un faux contexte, la couche de base chargée. */
async function pianoEssai(options = {}) {
  const ctx = new FauxContexte();
  const serveur = fauxServeur(indexEssai(), options);
  const p = new Piano("piano/", { lire: serveur.lire });
  p.brancher(ctx);
  return { p, ctx, serveur };
}

test("le limiteur et le niveau de sortie : seuil −6 dB, sans genou, ratio 20, attaque d'1 ms", async () => {
  const { p } = await pianoEssai();
  assert.equal(p.sortie.gain.value, GAIN_SORTIE);
  assert.ok(GAIN_SORTIE <= 0.65);
  assert.equal(p.limiteur.threshold.value, -6);
  assert.equal(p.limiteur.knee.value, 0);
  assert.equal(p.limiteur.ratio.value, 20);
  assert.equal(p.limiteur.attack.value, 0.001);
  assert.deepEqual(LIMITEUR.threshold, -6);
});

test("Arrêter : ce qui était programmé ne part pas, ce qui sonne s'éteint en moins de 100 ms", async () => {
  const { p, ctx } = await pianoEssai();
  await p.charger();
  p.note(60, 2, 90, 0);         // part tout de suite
  p.note(67, 3, 90, 0.12);      // programmée d'avance, comme le fait le transport
  p.note(72, 1, 90, 0.30);
  ctx.avancer(0.05);
  p.silence();                  // « Arrêter » à 50 ms
  const [do4, sol4, do5] = ctx.sources;
  // Avant l'audit, sol4 partait à 120 ms et tenait trois secondes.
  for (const t of [0.12, 0.2, 0.5, 1, 2.5]) {
    assert.equal(sol4.sonneA(t), false, `sol4 à ${t} s`);
    assert.equal(do5.sonneA(t), false, `do5 à ${t} s`);
  }
  assert.ok(sol4.arret <= sol4.debut, "arrêtée avant de partir");
  // Le do4 sonnait : un fondu, et la source s'arrête 100 ms après.
  assert.ok(do4.arret <= 0.05 + 0.1 + 1e-9);
  assert.ok(do4.gainAval.valeurA(0.15) < 1e-3, `gain à 150 ms : ${do4.gainAval.valeurA(0.15)}`);
  assert.equal(p.voix.size, 0);
});

test("un chargement manqué se réessaie au toucher suivant, et le problème est dit", async () => {
  const ctx = new FauxContexte();
  const serveur = fauxServeur(indexEssai(), { pannes: ["echantillons.json"] });
  const p = new Piano("piano/", { lire: serveur.lire });
  const dits = [];
  p.surProbleme = (t) => dits.push(t);
  p.brancher(ctx);
  // Un message en français, pas « Failed to fetch ».
  await assert.rejects(p.pret(), /Le piano n'a pas pu se télécharger : il lui faut le réseau la première fois/);
  assert.equal(dits.length, 1);
  // Avant, la promesse rejetée était gardée : le piano restait muet jusqu'au rechargement.
  await p.charger();
  assert.ok(p.echantillons && p.echantillons.length === 7);
  assert.ok(p.debut(60, 90));
});

test("un échantillon manquant : son voisin le remplace, on le redemande ensuite", async () => {
  const { p, serveur } = await pianoEssai({ pannes: ["060-mf"] });
  const dits = [];
  p.surProbleme = (t) => dits.push(t);
  await p.charger();
  assert.deepEqual(p.echantillons.map((e) => e.midi), [48, 52, 55, 64, 67, 72]);
  assert.match(dits[0], /1 note du piano/);
  // Le do4 manque : le mi4 (à quatre demi-tons) le remplace, plus proche que le sol3 (à cinq).
  const v = p.debut(60, 90);
  assert.ok(!v.attend, "il joue tout de suite, sans attendre un son manqué");
  assert.equal(v.src.playbackRate.value, Math.pow(2, (60 - 64) / 12));
  // Plus tard, un autre toucher redemande ce qui manquait.
  p.couche("mf").echecs.set(60, 0);
  await p.pret({ hauteurs: [60] });
  assert.equal(serveur.demandes.filter((u) => u.includes("060-mf")).length, 2);
  assert.ok(p.echantillons.some((e) => e.midi === 60));
});

test("le premier son : la note touchée attend son échantillon, qui passe devant les autres, et part à son arrivée", async () => {
  const ctx = new FauxContexte();
  const serveur = fauxServeur(indexEssai(), { manuel: true });
  const p = new Piano("piano/", { lire: serveur.lire });
  p.brancher(ctx);
  const attentes = [];
  p.surAttente = (oui) => attentes.push(oui);
  // Le tout premier toucher, rien n'est encore là : la note attend au lieu d'être perdue.
  const v = p.debut(67, 90);
  assert.ok(v && v.attend);
  await serveur.servir("echantillons.json");
  // Son échantillon d'abord, puis le registre du do central (le plus proche d'abord), quatre à la fois.
  const fichiers = serveur.demandes.filter((u) => u.endsWith(".mp3"));
  assert.equal(fichiers[0], "piano/067-mf.mp3");
  assert.equal(fichiers.length, 4, "quatre téléchargements à la fois");
  assert.equal(ctx.sources.length, 0);
  await serveur.servir("067-mf");
  assert.ok(v.vraie, "la note est partie à l'arrivée de son échantillon");
  assert.equal(v.vraie.src.playbackRate.value, 1);
  // Le doigt se lève : la note s'arrête comme une autre.
  p.fin(v);
  assert.ok(Number.isFinite(v.vraie.fin));
  await serveur.servir();
  await serveur.servir();
  assert.equal(serveur.demandes.filter((u) => u.endsWith(".mp3")).length, 7, "le reste suit, sans qu'on attende");
  assert.equal(p.echantillons.length, 7);
});

test("une touche relevée avant l'arrivée de son échantillon s'entend quand même, brièvement", async () => {
  const ctx = new FauxContexte();
  const serveur = fauxServeur(indexEssai(), { manuel: true });
  const p = new Piano("piano/", { lire: serveur.lire });
  p.brancher(ctx);
  const v = p.debut(48, 90);
  p.fin(v); // un toucher bref, avant que rien n'arrive
  await serveur.servir("echantillons.json");
  await serveur.servir("048-mf");
  assert.ok(v.vraie);
  assert.ok(v.vraie.fin - v.vraie.t <= 0.31 && v.vraie.fin > v.vraie.t);
});

test("« piano en chargement » : dit quand l'attente dure, effacé quand le son est là", async () => {
  const ctx = new FauxContexte();
  const serveur = fauxServeur(indexEssai(), { manuel: true });
  const p = new Piano("piano/", { lire: serveur.lire });
  p.brancher(ctx);
  const dit = [];
  p.surAttente = (oui) => dit.push(oui);
  p.debut(60, 90);
  await new Promise((ok) => setTimeout(ok, 300));
  assert.deepEqual(dit, [true]);
  await serveur.servir();
  await serveur.servir();
  assert.deepEqual(dit, [true, false]);
});

test("à l'ouverture d'une idée, les sons de l'octave montrée se téléchargent avant le premier toucher", async () => {
  const serveur = fauxServeur(indexEssai());
  const p = new Piano("piano/", { lire: serveur.lire });
  // Pas encore de contexte audio (il attend un geste) : on télécharge sans décoder.
  p.preferer(60, 72, { prechauffer: true });
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(p.ctx, null);
  const avance = serveur.demandes.filter((u) => u.endsWith(".mp3")).sort();
  assert.deepEqual(avance, ["piano/060-mf.mp3", "piano/064-mf.mp3", "piano/067-mf.mp3", "piano/072-mf.mp3"]);
  // Le premier toucher : le contexte se crée, l'échantillon déjà téléchargé se décode, sans le redemander.
  const vrai = globalThis.AudioContext;
  globalThis.AudioContext = class extends FauxContexte {};
  try {
    const v = p.debut(64, 90);
    await serveur.servir();
    await new Promise((ok) => setTimeout(ok, 10));
    assert.ok(v.attend ? v.vraie : v, "la note a sonné");
    assert.equal(serveur.demandes.filter((u) => u.includes("064-mf")).length, 1);
  } finally { globalThis.AudioContext = vrai; }
});

test("le registre du clavier affiché passe devant le reste", async () => {
  const ctx = new FauxContexte();
  const serveur = fauxServeur(indexEssai(), { manuel: true });
  const p = new Piano("piano/", { lire: serveur.lire });
  p.brancher(ctx);
  p.preferer(48, 55);
  const pret = p.pret();
  await serveur.servir("echantillons.json");
  const fichiers = serveur.demandes.filter((u) => u.endsWith(".mp3"));
  assert.deepEqual(fichiers.slice(0, 3).sort(), ["piano/048-mf.mp3", "piano/052-mf.mp3", "piano/055-mf.mp3"]);
  await serveur.servir();
  await pret;
});

test("l'échantillon le plus proche, celui du dessus à égalité", () => {
  const ech = [48, 52, 55, 60].map((midi) => ({ midi }));
  assert.equal(plusProche(ech, 50).midi, 52); // 48 et 52 à deux demi-tons : le dessus
  assert.equal(plusProche(ech, 49).midi, 48);
  assert.equal(plusProche(ech, 58).midi, 60);
  assert.equal(plusProche(ech, 70).midi, 60);
});

test("la couche selon la force ; une couche pas encore là laisse la base jouer, et se charge", async () => {
  const index = indexEssai();
  assert.equal(coucheDe(index, 40), "pp");
  assert.equal(coucheDe(index, 64), "pp");
  assert.equal(coucheDe(index, 90), "mf");
  assert.equal(coucheDe(index, 110), "ff");
  const { p, serveur } = await pianoEssai();
  await p.charger();
  assert.equal(serveur.demandes.filter((u) => u.includes("-ff")).length, 0, "FF n'est chargée qu'à la demande");
  const v1 = p.debut(60, 120);
  assert.ok(v1 && !v1.attend, "la base joue en attendant");
  assert.ok(serveur.demandes.some((u) => u.includes("060-ff")));
  const ff = await p.chargerCouche("ff");
  assert.equal(p.choisir(60, 120).couche.nom, "ff");
  assert.equal(ff.echantillons.length, 4);
  // Au-delà de trois demi-tons du dernier son FF (67), la base reprend.
  assert.equal(p.choisir(76, 120).couche.nom, "mf");
  assert.equal(p.choisir(69, 120).couche.nom, "ff");
});

test("les nuances : un passe-bas d'autant plus bas que la note est douce, ouvert en haut de la couche", async () => {
  assert.equal(coupure(100, 100), 20000);
  assert.equal(coupure(80, 100), 10000);
  assert.equal(coupure(60, 100), 5000);
  assert.equal(coupure(1, 100), 800);
  const { p, ctx } = await pianoEssai();
  await p.charger();
  assert.equal(p.debut(60, 100).filtre, null, "en haut de la couche, pas de filtre");
  const douce = p.debut(60, 70);
  assert.ok(douce.filtre && Math.abs(douce.filtre.frequency.value - coupure(70, 100)) < 1e-9);
  // Le gain suit la force (la même courbe pour toutes les couches) et le gain de l'échantillon.
  assert.ok(gainDeForce(127) > gainDeForce(90) && gainDeForce(90) > gainDeForce(40));
  assert.ok(Math.abs(douce.g.gain.valeurA(ctx.currentTime + 0.02) - gainDeForce(70)) < 1e-9);
});

test("la pédale de maintien tient les touches relâchées, et les laisse retomber quand elle se relève", async () => {
  const { p, ctx } = await pianoEssai();
  await p.charger();
  p.pedale(true);
  const v = p.debut(60, 90);
  ctx.avancer(0.3);
  p.fin(v); // le doigt se lève
  ctx.avancer(1);
  assert.ok(v.src.sonneA(ctx.currentTime), "la note tient");
  p.pedale(false);
  assert.ok(v.fin <= ctx.currentTime + 1e-9, "relâchée au lever de la pédale");
  // Ce que le transport programme ne dépend pas de la pédale : il donne toujours l'instant.
  p.pedale(true);
  const w = p.note(64, 0.5, 90, ctx.currentTime + 0.1);
  assert.ok(Number.isFinite(w.fin));
  p.pedale(false);
});

test("la même note rejouée sous la pédale : l'ancienne s'efface vite au lieu de s'additionner", async () => {
  const { p, ctx } = await pianoEssai();
  await p.charger();
  p.pedale(true);
  const a = p.debut(60, 90);
  ctx.avancer(0.2);
  p.fin(a);
  ctx.avancer(0.2);
  p.debut(60, 90);
  assert.ok(a.coupee);
  assert.ok(a.src.arret < ctx.currentTime + 0.5);
});

test("réveil : un contexte qui ne reprend pas est remplacé, les sons décodés resservent", async () => {
  const { p, ctx } = await pianoEssai();
  await p.charger();
  const tampons = p.echantillons.map((e) => e.buffer);
  let prevenu = 0;
  p.recreations.add(() => prevenu++);
  // Safari garde le contexte « interrompu » : la reprise ne vient jamais.
  ctx.state = "interrupted";
  ctx.resume = () => new Promise(() => {});
  const vrai = globalThis.AudioContext;
  globalThis.AudioContext = class extends FauxContexte {};
  try {
    await p.reveiller();
    assert.notEqual(p.ctx, ctx);
    assert.equal(prevenu, 1);
    assert.deepEqual(p.echantillons.map((e) => e.buffer), tampons);
    assert.ok(p.debut(60, 90));
  } finally { globalThis.AudioContext = vrai; }
});

test("les vrais échantillons : trois couches, des gains raisonnables, des fichiers présents, PP et FF sous 3 Mo", () => {
  const dossier = new URL("../app/piano/", import.meta.url);
  const index = JSON.parse(fs.readFileSync(new URL("echantillons.json", dossier), "utf8"));
  assert.equal(index.base, "mf");
  assert.deepEqual(index.couches.map((c) => c.nom), ["mf", "pp", "ff"]);
  let enPlus = 0;
  for (const c of index.couches) {
    for (const e of c.echantillons) {
      assert.ok(fs.existsSync(new URL(e.fichier, dossier)), e.fichier);
      assert.ok(e.gain > 0.5 && e.gain < 2, `${e.fichier} : gain ${e.gain}`);
      if (c.nom !== "mf") enPlus += fs.statSync(new URL(e.fichier, dossier)).size;
    }
  }
  assert.ok(enPlus < 3 * 1024 * 1024, `PP et FF : ${enPlus} octets`);
  // Toutes les notes du piano à deux demi-tons au plus d'un son MF.
  const mf = index.couches[0].echantillons;
  for (let h = 21; h <= 108; h++) assert.ok(Math.abs(plusProche(mf, h).midi - h) <= 2, `MIDI ${h}`);
  // Le la5 éteint (81) n'est plus là.
  assert.ok(!mf.some((e) => e.midi === 81));
  // Les vélocités des couches se suivent sans trou.
  const bornes = index.couches.map((c) => c.velocites).sort((a, b) => a[0] - b[0]);
  assert.equal(bornes[0][0], 1);
  for (let i = 1; i < bornes.length; i++) assert.equal(bornes[i][0], bornes[i - 1][1] + 1);
  assert.equal(bornes[bornes.length - 1][1], 127);
});
