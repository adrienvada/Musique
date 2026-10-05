/**
 * Le banc d'essai du lecteur (L17), sur une sauvegarde fabriquée à partir de
 * tes pages d'essai : tes corrections y sont faites au toucher (les gestes
 * d'edition.js), et le banc doit retrouver chacune, dire si un doute la
 * signalait, et ne rien écrire.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lireFichier } from "../outils/lire.mjs";
import { aligner, evaluer, evenementsDe, taux } from "../outils/banc-lecteur.mjs";
import { compacter } from "../app/stockage.js";
import * as ed from "../app/edition.js";

/** Une sauvegarde de Portée : ta mélodie corrigée trois fois, ton piano tel quel, et ce que le banc doit laisser. */
async function sauvegarde() {
  const mel = await lireFichier("tests/pages/2026-09-30-melodie-standard.pdf");
  const pia = await lireFichier("tests/pages/2026-09-30-piano-standard.pdf");
  let abc = mel.abc;
  // Le petit trait du doute d1 était un vrai crochet ; la première note, un ré ; une barre retirée.
  const d1 = mel.doutes.find((d) => d.type === "crochet");
  abc = ed.changerDuree(abc, ed.lireJeton(abc, d1.cible.debut), 1).abc;
  abc = ed.deplacer(abc, ed.lireJeton(abc, abc.indexOf("C2 D2")), 1).abc;
  const barre = abc.indexOf(" | ", abc.indexOf("\nc2 c agf"));
  abc = abc.slice(0, barre) + abc.slice(barre + 2);
  const pages = (r) => r.pages.map((p) => compacter(p.traits));
  return {
    format: "portee-sauvegarde", version: 1, creeLe: "2026-10-04T00:00:00.000Z",
    partitions: [
      { id: "m", donnees: { titre: "Mélodie", modele: "melodie-standard", abc, abcLu: mel.abc, statut: "prete", nbPages: 1 }, pages: pages(mel) },
      { id: "p", donnees: { titre: "Piano", modele: "piano-standard", abc: pia.abc, abcLu: pia.abc, statut: "prete", nbPages: 1 }, pages: pages(pia) },
      { id: "r", donnees: { titre: "À relire", modele: "piano-standard", abc: pia.abc, statut: "a-relire", nbPages: 1 }, pages: pages(pia) },
      { id: "i", donnees: { titre: "Une idée", type: "idee", abc: "X:1\nK:C\nC", statut: "idee" }, pages: [] },
      { id: "g", donnees: { titre: "Géante", modele: "melodie-geante", abc, statut: "prete", nbPages: 1 }, pages: pages(mel) },
    ],
  };
}

test("les événements d'un ABC : hauteurs qui sonnent, triolets, voix, barres", () => {
  const abc = "X:1\nM:4/4\nL:1/8\nK:F\n[V:1] B2 (3cde [CEG]2 z2 | ^F2 F2 x4 |\n[V:2] C,8 |";
  const evs = evenementsDe(abc);
  assert.deepEqual([...evs.keys()], ["1", "2"]);
  const v1 = evs.get("1");
  // Si bémol (armure de fa), le triolet aux deux tiers, un accord, un silence ; le second fa reste dièse dans la mesure.
  assert.deepEqual(v1.map((e) => [e.genre, e.midi && e.midi.join("+"), Math.round((e.croches || 0) * 100) / 100]), [
    ["note", "70", 2], ["note", "72", 0.67], ["note", "74", 0.67], ["note", "76", 0.67], ["note", "60+64+67", 2], ["silence", "", 2],
    ["barre", undefined, 0], ["note", "66", 2], ["note", "66", 2], ["barre", undefined, 0],
  ]);
  assert.equal(v1[v1.length - 1].t, 16); // le silence invisible fait passer le temps, sans compter
  assert.deepEqual(evs.get("2").map((e) => e.genre), ["note", "barre"]);
});

test("l'alignement : une note fausse ne décale pas la suite ; une note manquante ou en trop se voit", () => {
  const n = (midi, croches = 2) => ({ genre: "note", midi: [midi], croches });
  const valide = [n(60), n(62), n(64), n(65)];
  assert.deepEqual(aligner(valide, [n(60), n(61), n(64), n(65)]).map(([a, b]) => [a && a.midi[0], b && b.midi[0]]), [[60, 60], [62, 61], [64, 64], [65, 65]]);
  assert.deepEqual(aligner(valide, [n(60), n(64), n(65)]).map(([a, b]) => [a && a.midi[0], b && b.midi[0]]), [[60, 60], [62, null], [64, 64], [65, 65]]);
  assert.deepEqual(aligner(valide, [n(60), n(62), n(63), n(64), n(65)]).filter(([a]) => !a).map(([, b]) => b.midi[0]), [63]);
});

test("le banc retrouve chacune de tes corrections, et dit si un doute la signalait", async () => {
  const res = evaluer(await sauvegarde());
  assert.deepEqual(res.pages.map((p) => p.titre), ["Mélodie", "Piano"]);
  assert.equal(res.ignorees, 2); // la page à relire et l'idée
  assert.deepEqual(res.echecs.map((e) => e.titre), ["Géante"]);
  assert.match(res.echecs[0].raison, /ne connaît pas/);
  const [mel, pia] = res.pages;
  assert.deepEqual([mel.notes, mel.hauteur, mel.duree, mel.manquantes, mel.enTrop, mel.barres, mel.barresFausses], [48, 1, 1, 0, 0, 3, 1]);
  // Le crochet : le doute d1 le demandait. La première note et la barre : aucune question, des erreurs silencieuses.
  assert.deepEqual(mel.detail.map((e) => [e.genre, e.doute && e.doute.id]), [["hauteur", null], ["duree", "d1"], ["barre en trop", null]]);
  assert.deepEqual([mel.erreurs, mel.silencieuses, mel.doutes, mel.doutesSitues, mel.doutesJustes], [3, 2, 6, 6, 1]);
  assert.equal(mel.corrigee, true);
  assert.deepEqual([pia.erreurs, pia.notes, pia.corrigee], [0, 12, false]);
  const t = taux(res.total);
  assert.deepEqual([t.hauteurs, t.durees, t.barres, t.silencieuses, t.precisionDoutes], [1 / 55, 1 / 60, 1 / 5, 2 / 3, 1 / 6]);
  assert.equal(taux(pia).silencieuses, null); // rien à compter : pas un taux nul
  assert.throws(() => evaluer({ partitions: [] }), /pas une sauvegarde de Portée/);
});

test("en ligne de commande : les chiffres dans le terminal, rien d'écrit à côté", async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "portee-banc-"));
  try {
    const fichier = path.join(dossier, "sauvegarde.json");
    fs.writeFileSync(fichier, JSON.stringify(await sauvegarde()));
    const sortie = execFileSync(process.execPath, ["outils/banc-lecteur.mjs", fichier, "--detail"], { encoding: "utf8" });
    assert.match(sortie, /2 pages prêtes, 2 autres laissées de côté/);
    assert.match(sortie, /hauteur : validé ré4 \(2 croches\), lu do4 \(2 croches\) — sans doute/);
    assert.match(sortie, /En tout : 60 notes · hauteurs 1,8 % \(1\)/);
    const json = JSON.parse(execFileSync(process.execPath, ["outils/banc-lecteur.mjs", fichier, "--json"], { encoding: "utf8" }));
    assert.equal(json.total.erreurs, 3);
    assert.equal(json.pages[0].detail, undefined); // le détail ne sort qu'avec --detail
    assert.deepEqual(fs.readdirSync(dossier), ["sauvegarde.json"]);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});
