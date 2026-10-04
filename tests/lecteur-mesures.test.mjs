/**
 * Le chiffrage et la levée (L1) : plus d'erreur de rythme qui se cache. Le
 * chiffrage se choisit parmi les mesures usuelles, une contradiction devient
 * un doute au lieu d'un nouveau chiffrage, et une levée n'est acceptée qu'en
 * tête de pièce. Mesures fabriquées à partir de tes vrais traits.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chargerFabrique, corps, entete, Page } from "./fabrique.mjs";
import { lireFichier } from "../outils/lire.mjs";
import { devinerChiffrage, lirePartition } from "../lecteur/partition.js";
import { jetonsDeLaMesure, poser, preparerDoutes, suivre } from "../app/doutes.js";

/** Des mesures de noires (`n` noires chacune), barre après chacune, sur la portée `p`. */
function noires(f, mesures, p = 0) {
  const pg = new Page(f, p);
  let x = 220;
  for (const n of mesures) {
    for (let i = 0; i < n; i++) { pg.note(x, [2, 3, 4, 5, 6][i % 5]); x += 64; }
    pg.barre(x - 14); x += 36;
  }
  return pg;
}
/** Plusieurs portées fabriquées, lues comme une seule page. */
function lirePages(f, ...pages) {
  const r = lirePartition([pages.flatMap((p) => p.traits)], f.CAL, { titre: "x" });
  return { abc: `${entete(r.abc)} | ${corps(r.abc).replace(/\n/g, " / ")}`, doutes: r.doutes, r };
}

test("seuls les chiffrages usuels se devinent ; 5/4 et 7/8 seulement si toute la pièce le dit", () => {
  assert.equal(devinerChiffrage([8, 8, 8], false).m, "4/4");
  assert.equal(devinerChiffrage([6, 6], true).m, "6/8");
  assert.equal(devinerChiffrage([6, 6], false).m, "3/4");
  assert.equal(devinerChiffrage([12, 11], true).m, "12/8");
  assert.equal(devinerChiffrage([8, 10, 8, 10], false).m, "4/4"); // une mesure fausse sur deux : pas 5/4
  assert.equal(devinerChiffrage([10, 10], false).m, "5/4");
  assert.equal(devinerChiffrage([7, 7, 7], false).m, "7/8");
  assert.equal(devinerChiffrage([7, 8, 7], false).m, "4/4");
  assert.equal(devinerChiffrage([10], false), null); // une seule mesure de 10 croches : rien de sûr
  assert.equal(devinerChiffrage([5, 5, 5], false), null);
  // Une levée vote quand elle tombe juste, et ne contredit rien sinon.
  assert.deepEqual([devinerChiffrage([10], false, [8]).m, devinerChiffrage([10], false, [8]).total], ["4/4", 2]);
  assert.equal(devinerChiffrage([12, 12], true, [1]).total, 2);
});

test("une mesure fausse sur deux ne donne plus 5/4 en silence : 4/4, et un doute sur la mesure fausse", async () => {
  const f = await chargerFabrique();
  const r = lirePages(f, noires(f, [4, 5]));
  assert.equal(r.abc, "M:4/4 K:C | G2 A2 B2 c2 | G2 A2 B2 c2 d2 |");
  assert.deepEqual(r.doutes.map((d) => [d.type, d.rang, d.trouve, d.attendu]), [["mesure", 2, 10, 8]]);
});

test("un point oublié ne donne plus 7/8 : la mesure courte est un doute", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.hampe(pg.tete(240, 2), "haut"); pg.point(240 + 0.6 * f.IL, 2.5); pg.crochet(pg.haut(330, 3)); pg.haut(420, 4); pg.bas(510, 5); pg.barre(590);
  pg.haut(650, 2); pg.crochet(pg.haut(740, 3)); pg.haut(830, 4); pg.bas(920, 5); pg.barre(1000); // le même rythme, le point oublié
  const r = lirePages(f, pg);
  assert.equal(r.abc, "M:4/4 K:C | G3 A B2 c2 | G2 A B2 c2 |");
  assert.deepEqual(r.doutes.map((d) => [d.type, d.trouve]), [["mesure", 7]]);
});

test("une ligne aux mesures fausses ne change plus de chiffrage : elle lève des doutes", async () => {
  const f = await chargerFabrique();
  const r = lirePages(f, noires(f, [4, 4], 0), noires(f, [3, 3], 1));
  // Avant : « [M:3/4] » à la 2ᵉ ligne, sans rien demander. Pas de chiffrage écrit, pas de changement.
  assert.equal(r.abc, "M:4/4 K:C | G2 A2 B2 c2 | G2 A2 B2 c2 | / G2 A2 B2 | G2 A2 B2 |");
  assert.deepEqual(r.doutes.map((d) => [d.type, d.ligne, d.rang]), [["mesure", 2, 1], ["mesure", 2, 2]]);
});

test("des mesures qui se contredisent toutes : le chiffrage lui-même devient un doute, qu'une réponse corrige", async () => {
  const f = await chargerFabrique();
  const r = lirePages(f, noires(f, [4, 3, 2, 5]));
  assert.match(r.abc, /^M:4\/4 /);
  const d = r.doutes.find((x) => x.type === "chiffrage");
  assert.deepEqual([d.variante, d.m, d.appuis, d.total, d.autres], ["contredit", "4/4", 1, 4, ["3/4", "2/4"]]);
  const doutes = preparerDoutes(r.r.doutes);
  const q = poser(doutes.find((x) => x.type === "chiffrage"), r.r.abc);
  assert.deepEqual(q.reponses.map((x) => x.texte), ["Oui, 4/4", "3/4", "2/4"]);
  const res = q.reponses[1].geste(r.r.abc);
  assert.match(res.abc, /^M:3\/4$/m);
});

test("une levée n'est acceptée qu'en tête de pièce et suivie d'une mesure complète", async () => {
  const f = await chargerFabrique();
  // En tête, suivie de deux mesures complètes : une levée, sans doute, et la 1ʳᵉ mesure est celle d'après.
  const levee = lirePages(f, noires(f, [1, 4, 4]));
  assert.equal(levee.abc, "M:4/4 K:C | G2 | G2 A2 B2 c2 | G2 A2 B2 c2 |");
  assert.deepEqual(levee.doutes, []);
  // Suivie d'une mesure incomplète : ce n'est plus une levée, les deux mesures sont des doutes.
  const pas = lirePages(f, noires(f, [1, 3, 4, 4]));
  assert.deepEqual(pas.doutes.map((d) => [d.type, d.rang, d.trouve]), [["mesure", 1, 2], ["mesure", 2, 6]]);
  // En tête de la 2ᵉ ligne, sans chiffrage écrit : une mesure courte, pas une levée.
  const ligne2 = lirePages(f, noires(f, [4, 4], 0), noires(f, [1, 4], 1));
  assert.deepEqual(ligne2.doutes.map((d) => [d.type, d.ligne, d.rang, d.trouve]), [["mesure", 2, 1, 2]]);
});

test("au piano, une levée doit avoir la même durée dans les deux mains", async () => {
  const r = await lireFichier("tests/pages/2026-09-30-piano-standard.pdf");
  const sansSoupir = r.pages[0].traits.filter((_, i) => i !== 11); // un soupir de la main gauche retiré
  const res = lirePartition([sansSoupir], r.cal, { titre: "x" });
  // Avant : la main gauche, plus courte, passait pour une levée, sans rien dire.
  assert.deepEqual(res.doutes.map((d) => [d.type, d.main, d.trouve, d.attendu]), [["mesure", "gauche", 6, 8]]);
});

test("un triolet ne donne plus 9/8 : il est demandé, et la réponse complète la mesure", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  const hs = [2, 3, 4].map((p, i) => pg.haut(250 + i * 55, p)); pg.ligature(hs[0], hs[2]); pg.chiffre3(310, hs[0].bout[1] - 0.8 * f.IL);
  pg.bas(470, 5); pg.hampe(pg.teteVide(600, 5), "bas"); pg.barre(740);
  const r = lirePages(f, pg);
  assert.equal(r.abc, "M:4/4 K:C | GAB c2 c4 |");
  assert.deepEqual(r.doutes.map((d) => d.type), ["triolet", "mesure"]);
  const doutes = preparerDoutes(r.r.doutes);
  const q = poser(doutes[0], r.r.abc);
  assert.equal(q.titre, "Un triolet ?");
  const res = q.reponses.find((x) => x.id === "triolet").geste(r.r.abc);
  suivre(doutes, res.modif);
  assert.equal(corps(res.abc), "(3GAB c2 c4 |");
  assert.equal(jetonsDeLaMesure(doutes[1], res.abc).reduce((t, j) => t + j.duree, 0), 8);
  assert.equal(poser(doutes[1], res.abc).titre, "La mesure est complète");
});
