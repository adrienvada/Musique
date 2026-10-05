/**
 * Tes gabarits (L16) : un reconnaisseur de signes appris sur ton écriture ($Q,
 * Vatavu, Anthony et Wobbrock, MobileHCI 2018), la page d'étalonnage qui le
 * nourrit, et la lecture avec lui. Les signes viennent de tes pages du 30/09
 * (bémols, soupirs, demi-soupirs, chiffres du « 12/8 ») ou sont tracés comme à
 * la main (tests/fabrique.mjs) ; aucun jeu de données d'ailleurs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { calibrationsConnues, chargerCalibration, lireFichier } from "../outils/lire.mjs";
import {
  ajouterExemple, distance, ETIQUETTES, fusionnerGabarits, gabaritsVides, lireEtalonnage, NB_POINTS, nuage, rayon, reconnaitre, SEUILS,
} from "../lecteur/gabarits.js";
import { assembler, lirePage } from "../lecteur/lecteur.js";
import { lirePartition } from "../lecteur/partition.js";
import { lireDocument } from "../lecteur/extraction.js";
import { identifierModele } from "../lecteur/modeles.js";
import { preparerTraits } from "../lecteur/traits.js";
import { exemplesDuChiffrage, poser, preparerDoutes } from "../app/doutes.js";
import { chargerFabrique, deformer, forme, lire, Page } from "./fabrique.mjs";

const MELODIE = "tests/pages/2026-09-30-melodie-standard.pdf";
const PIANO = "tests/pages/2026-09-30-piano-standard.pdf";

let pages = null;
/** Tes deux pages, et tes signes par leurs numéros de traits (voir l'image de contrôle). Lus une fois. */
function signes() {
  pages ||= Promise.all([lireFichier(MELODIE), lireFichier(PIANO)]).then(([m, p]) => {
    const de = (r, ids) => ids.map((i) => r.pages[0].traits[i]);
    return {
      mel: m, pia: p,
      bemols: [[21, 22], [23, 24], [25, 26], [89, 90], [91, 92], [93, 94]].map((ids) => de(m, ids)),
      soupir: de(m, [134]), soupirsPiano: [de(p, [11]), de(p, [14])],
      demiSoupirs: [de(m, [83]), de(m, [133])],
      chiffres: { 1: de(m, [17]), 2: de(m, [18]), 8: de(m, [19, 20]) },
      tete: de(m, [128]),
    };
  });
  return pages;
}

/** Des gabarits faits de signes déformés (comme d'autres fois de ta main) : jamais le signe lui-même. */
function apprendre(G, traits, etiquette, il, graines) {
  for (const g of graines) G = ajouterExemple(G, deformer(traits, il, g), etiquette, il, { source: "essai" });
  return G;
}

// ------------------------------------------------------------------------
// Le reconnaisseur
// ------------------------------------------------------------------------

test("un signe devient un nuage de 32 points, centré, mesuré en interlignes", () => {
  const signe = [[[100, 100], [130, 160]], [[90, 130], [140, 130]]];
  const n = nuage(signe, 32);
  assert.equal(n.length, NB_POINTS);
  const moyenne = (k) => n.reduce((a, p) => a + p[k], 0) / n.length;
  assert.ok(Math.abs(moyenne(0)) < 0.002 && Math.abs(moyenne(1)) < 0.002);
  // Déplacé sur la page : le même nuage ; deux fois plus grand sur un modèle deux fois plus large : le même aussi.
  assert.deepEqual(nuage(signe.map((t) => t.map(([x, y]) => [x + 333, y - 77])), 32), n);
  const double = nuage(signe.map((t) => t.map(([x, y]) => [2 * x, 2 * y])), 64);
  double.forEach((p, i) => assert.ok(Math.abs(p[0] - n[i][0]) < 0.002 && Math.abs(p[1] - n[i][1]) < 0.002));
  // Mais la taille compte, à interligne égal : un signe deux fois plus grand est loin.
  assert.ok(distance(nuage(signe.map((t) => t.map(([x, y]) => [2 * x, 2 * y])), 32), n) > 0.5);
  assert.equal(nuage([], 32), null);
  assert.throws(() => nuage(signe, 0), /interligne/);
});

test("l'ordre et le sens des traits ne changent rien : un dièse reste un dièse", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.diese(500, 4);
  const diese = pg.traits;
  let G = apprendre(gabaritsVides(), diese, "diese", f.IL, [1, 2]);
  G = apprendre(G, (await signes()).bemols[0], "bemol", f.IL, [3, 4]);
  const tel = reconnaitre(G, deformer(diese, f.IL, 9), f.IL);
  const melange = reconnaitre(G, deformer([...diese].reverse().map((t) => [...t].reverse()), f.IL, 9), f.IL);
  assert.equal(tel.etiquette, "diese");
  assert.equal(melange.etiquette, "diese");
  assert.ok(Math.abs(tel.distance - melange.distance) < 0.05, `${tel.distance} / ${melange.distance}`);
});

test("les bornes inférieures et l'abandon de $Q gardent l'étiquette de la recherche complète", async () => {
  const s = await signes();
  const il = 32;
  let G = gabaritsVides();
  G = apprendre(G, s.bemols[0], "bemol", il, [1, 2]);
  G = apprendre(G, s.soupir, "soupir", il, [3, 4]);
  G = apprendre(G, s.demiSoupirs[0], "demi-soupir", il, [5, 6]);
  for (const [c, t] of Object.entries(s.chiffres)) G = apprendre(G, t, c, il, [7, 8]);
  const essais = [...s.bemols, ...s.demiSoupirs, s.soupir, ...Object.values(s.chiffres)].flatMap((t, i) => [t, deformer(t, il, 100 + i)]);
  for (const t of essais) {
    const r = reconnaitre(G, t, il);
    const pts = nuage(preparerTraits(t), il);
    const complet = G.exemples.map((e) => [e.etiquette, distance(pts, e.points)]).sort((a, b) => a[1] - b[1])[0];
    assert.equal(r.etiquette, complet[0]);
    // La table des plus proches voisins est approchée (la case, pas le point) : à peine plus loin, parfois.
    const relatif = complet[1] / Math.max(rayon(pts), 0.05);
    assert.ok(r.distance >= relatif - 0.002 && r.distance - relatif < 0.03, `${r.distance} / ${relatif}`);
  }
});

test("tes bémols, soupirs et demi-soupirs se reconnaissent d'une ligne, d'une page et d'un modèle à l'autre", async () => {
  const s = await signes();
  // Un seul exemple de chaque, pris sur la mélodie (interligne 32) ; les chiffres du « 12/8 » pour brouiller.
  let G = gabaritsVides();
  G = ajouterExemple(G, s.bemols[0], "bemol", 32);
  G = ajouterExemple(G, s.soupir, "soupir", 32);
  G = ajouterExemple(G, s.demiSoupirs[0], "demi-soupir", 32);
  for (const [c, t] of Object.entries(s.chiffres)) G = ajouterExemple(G, t, c, 32);
  for (const b of s.bemols.slice(1)) assert.deepEqual([reconnaitre(G, b, 32).etiquette, reconnaitre(G, b, 32).verdict], ["bemol", "sur"]);
  assert.deepEqual([reconnaitre(G, s.demiSoupirs[1], 32).etiquette, reconnaitre(G, s.demiSoupirs[1], 32).verdict], ["demi-soupir", "sur"]);
  // Les soupirs du piano (interligne 28), d'après celui de la mélodie : reconnus.
  for (const t of s.soupirsPiano) assert.equal(reconnaitre(G, t, 28).etiquette, "soupir");
  // Une tête de note ne ressemble à rien de tout ça.
  assert.deepEqual(reconnaitre(G, s.tete, 32), { etiquette: null, distance: null, ecart: null, seconde: null, verdict: "rejete" });
  // `parmi` restreint les étiquettes possibles ; sans gabarit à comparer, rien.
  assert.notEqual(reconnaitre(G, s.bemols[1], 32, { parmi: ["1", "2", "8"] }).etiquette, "bemol");
  assert.equal(reconnaitre(gabaritsVides(), s.bemols[1], 32), null);
  assert.equal(reconnaitre(G, s.bemols[1], 32, { parmi: ["triolet"] }), null);
  assert.ok(SEUILS.sur < SEUILS.rejet && SEUILS.marge < 1);
});

test("apprendre d'une correction : de nouveaux gabarits, sans doublon, bornés ; deux appareils se réunissent", async () => {
  const s = await signes();
  const vides = gabaritsVides();
  const un = ajouterExemple(vides, s.bemols[0], "bemol", 32);
  assert.equal(vides.exemples.length, 0); // rien n'est modifié : de nouveaux gabarits
  assert.deepEqual(un.exemples.map((e) => [e.etiquette, e.source, e.points.length]), [["bemol", "correction", 32]]);
  assert.equal(ajouterExemple(un, s.bemols[0], "bemol", 32), un); // le même exemple ne compte qu'une fois
  assert.equal(ajouterExemple(un, [[]], "bemol", 32), un); // rien à apprendre
  // Au plus `max` exemples par étiquette : les plus anciens partent.
  let G = gabaritsVides();
  s.bemols.forEach((b) => { G = ajouterExemple(G, b, "bemol", 32, { max: 4 }); });
  G = ajouterExemple(G, s.soupir, "soupir", 32, { max: 4 });
  assert.equal(G.exemples.filter((e) => e.etiquette === "bemol").length, 4);
  assert.deepEqual(G.exemples.map((e) => e.id).slice(0, 4), s.bemols.slice(2).map((b) => ajouterExemple(vides, b, "bemol", 32).exemples[0].id));
  // Deux appareils : chacun ses exemples, réunis sans doublon (et un exemple illisible écarté).
  const telephone = ajouterExemple(un, s.soupir, "soupir", 32);
  const ordinateur = ajouterExemple(un, s.demiSoupirs[0], "demi-soupir", 32);
  const reunis = fusionnerGabarits(telephone, { ...ordinateur, exemples: [...ordinateur.exemples, { id: "x", etiquette: "trompette", points: [] }] });
  assert.deepEqual(reunis.exemples.map((e) => e.etiquette), ["bemol", "soupir", "demi-soupir"]);
  // Les gabarits voyagent en JSON, et se relisent pareil.
  const relus = JSON.parse(JSON.stringify(reunis));
  assert.equal(reconnaitre(relus, s.bemols[3], 32).etiquette, "bemol");
  assert.throws(() => ajouterExemple(vides, s.bemols[0], "trompette", 32), /Étiquette inconnue/);
  assert.throws(() => ajouterExemple(vides, s.bemols[0], "bemol"), /interligne/);
});

// ------------------------------------------------------------------------
// La page d'étalonnage
// ------------------------------------------------------------------------

test("la page d'étalonnage : une case par signe connu, et ses lignes grises la reconnaissent", async () => {
  const cal = chargerCalibration("etalonnage", 1);
  assert.equal(cal.genre, "etalonnage");
  assert.deepEqual(new Set(cal.cases.map((c) => c.etiquette)), new Set(Object.keys(ETIQUETTES)));
  for (const c of cal.cases) {
    assert.ok(c.x0 >= cal.x_debut && c.x1 <= cal.x_fin && c.y0 >= 0 && c.y1 <= cal.page.hauteur, c.etiquette);
    // Assez de place pour trois exemples, et aucune case n'empiète sur une autre.
    assert.ok(c.x1 - c.x0 > 3 * 2.5 * cal.interligne && c.y1 - c.y0 > 8 * cal.interligne, c.etiquette);
    for (const d of cal.cases) if (d !== c) assert.ok(c.x1 <= d.x0 || d.x1 <= c.x0 || c.y1 <= d.y0 || d.y1 <= c.y0, `${c.etiquette} / ${d.etiquette}`);
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync("modeles/etalonnage.pdf")), isEvalSupported: false, verbosity: 0 }).promise;
  const lu = await lireDocument(pdfjs, doc);
  assert.deepEqual([lu.modele, lu.version], ["etalonnage", 1]);
  assert.deepEqual(lu.pages[0].lignes, cal.systemes.flatMap((s) => s.portees[0].lignes));
  assert.equal(identifierModele(lu.pages[0], calibrationsConnues()).cal.modele, "etalonnage");
  // Lue vierge : rien appris, et pas une partition.
  const r = await lireFichier("modeles/etalonnage.pdf");
  assert.equal(r.etalonnage, true);
  assert.equal(r.gabarits.exemples.length, 0);
  assert.equal(r.cases.length, 4);
  assert.throws(() => lirePartition([[]], cal), /étalonnage/);
});

test("lireEtalonnage : trois exemples par case, un dièse en quatre traits reste un exemple", async () => {
  const s = await signes();
  const f = await chargerFabrique();
  const cal = chargerCalibration("etalonnage", 1);
  const il = cal.interligne;
  const traits = [];
  const ecrire = (etiquette, faire) => {
    const c = cal.cases.find((x) => x.etiquette === etiquette);
    const pas = (c.x1 - c.x0) / 3, y = (c.y0 + c.y1) / 2;
    for (let k = 0; k < 3; k++) traits.push(...faire(c.x0 + (k + 0.5) * pas, y, k));
  };
  const place = (t, x, y) => { const pts = t.flat(); const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length; return t.map((u) => u.map(([a, b]) => [a - cx + x, b - cy + y])); };
  ecrire("bemol", (x, y, k) => place(deformer(s.bemols[k], il, 10 + k), x, y));
  ecrire("soupir", (x, y, k) => place(deformer(s.soupir, il, 20 + k), x, y));
  ecrire("diese", (x, y, k) => { const pg = new Page(f); pg.diese(500, 4); return place(deformer(pg.traits, il, 30 + k), x, y); });
  ecrire("3", (x, y, k) => forme("3", x, y, il, 40 + k));
  // Un trait hors des cases (une note dans la marge) et une rature démesurée dans une case.
  traits.push([[20, 1800], [60, 1810]]);
  const c8 = cal.cases.find((x) => x.etiquette === "8");
  traits.push([[c8.x0 + 10, c8.y0 + 10], [c8.x1 - 10, c8.y1 - 10]]);
  const r = lireEtalonnage(traits, cal);
  const compte = Object.fromEntries(r.cases.filter((c) => c.exemples).map((c) => [c.etiquette, c.exemples]));
  assert.deepEqual(compte, { bemol: 3, soupir: 3, diese: 3, 3: 3 });
  assert.deepEqual(r.cases.find((c) => c.etiquette === "diese").traits.map((t) => t.length), [4, 4, 4]);
  assert.deepEqual([r.ignores, r.ecartes], [[traits.length - 2], [[traits.length - 1]]]);
  assert.ok(r.gabarits.exemples.every((e) => e.source === "etalonnage"));
  // Ce qu'elle a appris reconnaît tes autres bémols, et un dièse tracé une autre fois.
  assert.equal(reconnaitre(r.gabarits, s.bemols[4], 32).etiquette, "bemol");
  const pg = new Page(f); pg.diese(700, 5);
  assert.equal(reconnaitre(r.gabarits, deformer(pg.traits, il, 77), il).etiquette, "diese");
  // Une deuxième page complète les gabarits de la première.
  const encore = lireEtalonnage(traits.slice(0, 3), cal, r.gabarits);
  assert.equal(encore.gabarits.exemples.length, r.gabarits.exemples.length + 1);
  assert.throws(() => lireEtalonnage(traits, chargerCalibration("melodie-standard", 1)), /pas une page d'étalonnage/);
});

// ------------------------------------------------------------------------
// Lire avec tes gabarits
// ------------------------------------------------------------------------

test("sans gabarits (ou des gabarits vides), la lecture ne change pas", async () => {
  const s = await signes();
  for (const r of [s.mel, s.pia]) {
    const traits = r.pages.map((p) => p.traits);
    const avant = lirePartition(traits, r.cal, { titre: "x" });
    for (const gabarits of [null, gabaritsVides(), { exemples: "abîmés" }]) {
      const apres = lirePartition(traits, r.cal, { titre: "x", gabarits });
      assert.equal(apres.abc, avant.abc);
      assert.equal(JSON.stringify(apres.doutes), JSON.stringify(avant.doutes));
    }
  }
});

test("avec tes gabarits, tes deux pages se lisent pareil, et le « 12/8 » est lu au lieu d'être deviné", async () => {
  const s = await signes();
  let G = gabaritsVides();
  s.bemols.forEach((b, i) => { G = apprendre(G, b, "bemol", 32, [50 + i]); });
  G = apprendre(G, s.soupir, "soupir", 32, [60, 61]);
  s.demiSoupirs.forEach((d, i) => { G = apprendre(G, d, "demi-soupir", 32, [70 + i]); });
  for (const [c, t] of Object.entries(s.chiffres)) G = apprendre(G, t, c, 32, [80, 81]);
  for (const r of [s.mel, s.pia]) {
    const traits = r.pages.map((p) => p.traits);
    const sans = lirePartition(traits, r.cal, { titre: "x" }), avec = lirePartition(traits, r.cal, { titre: "x", gabarits: G });
    assert.equal(avec.abc, sans.abc);
    assert.deepEqual(avec.doutes.map((d) => d.type), sans.doutes.map((d) => d.type));
  }
  const lue = lirePage(s.mel.pages[0].traits, s.mel.cal, 1, { gabarits: G });
  assert.deepEqual(lue.signes.filter((g) => g.nature === "chiffre").map((g) => [g.chiffre, g.traits]), [["1", [17]], ["2", [18]], ["8", [19, 20]]]);
  assert.deepEqual(assembler(lue).entetes[1].metre, { m: "12/8", croches: 12 });
  assert.equal(lue.signes.filter((g) => g.reconnu && g.reconnu.etiquette === "bemol").length, 6);
});

/** Un chiffrage écrit en tête de la portée, le chiffre du haut sur le chiffre du bas. */
function chiffrage(pg, haut, bas, graine) {
  const il = pg.f.IL;
  return [...pg.ajouter(forme(haut, 215, pg.p.haut + il, il, graine)), ...pg.ajouter(forme(bas, 215, pg.p.haut + 3 * il, il, graine + 1))];
}
/** Des gabarits de chiffres (tracés comme à la main), quatre fois chacun. */
function gabaritsDeChiffres(il) {
  let G = gabaritsVides();
  for (const [k, c] of ["3", "4", "6", "8"].entries()) for (const g of [1, 2, 3, 4]) G = ajouterExemple(G, forme(c, 0, 0, il, 10 * k + g), c, il);
  return G;
}

test("le chiffrage écrit se lit : 3/4 n'est plus deviné 6/8, même quand ses deux chiffres se touchent", async () => {
  const f = await chargerFabrique();
  const page = (graine) => {
    const pg = new Page(f);
    chiffrage(pg, "3", "4", graine);
    let x = 290;
    for (let m = 0; m < 2; m++) {
      for (let g = 0; g < 2; g++) { const hs = [0, 1, 2].map((k) => pg.haut(x + k * 52, 2 + k)); pg.ligature(hs[0], hs[2]); x += 176; }
      pg.barre(x - 10); x += 30;
    }
    return pg;
  };
  // Six croches par mesure, liées par trois : sans gabarits, c'est un 6/8.
  assert.equal(lire(page(101)).abc, "M:6/8 K:C | GAB GAB | GAB GAB |");
  const r = lire(page(101), { gabarits: gabaritsDeChiffres(f.IL) });
  assert.equal(r.abc, "M:3/4 K:C | GAB GAB | GAB GAB |");
  assert.deepEqual(r.doutes, []);
  // Un « 4 » tracé trop loin de tes exemples n'est reconnu que de justesse : le chiffrage se devine, comme avant.
  assert.equal(lire(page(201), { gabarits: gabaritsDeChiffres(f.IL) }).abc, "M:6/8 K:C | GAB GAB | GAB GAB |");
});

test("un chiffrage lu que les mesures contredisent devient une question, qui apprend ta réponse", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  const ids = chiffrage(pg, "3", "4", 301);
  let x = 290;
  for (let m = 0; m < 3; m++) { for (let k = 0; k < 4; k++) { pg.haut(x, 2 + k); x += 64; } pg.barre(x - 14); x += 36; }
  const r = lire(pg, { gabarits: gabaritsDeChiffres(f.IL) });
  assert.match(r.abc, /^M:3\/4 /);
  const d = r.r.doutes.find((x) => x.type === "chiffrage");
  assert.deepEqual([d.variante, d.lu, d.m, d.autres, d.appuis, d.total], ["contredit", true, "3/4", ["4/4"], 0, 2]);
  assert.deepEqual(d.chiffres, [{ traits: [ids[0]], haut: true }, { traits: ids.slice(1), haut: false }]);
  const q = poser(preparerDoutes([d])[0], r.r.abc);
  // La première mesure peut être une levée : elle ne compte que si elle tombe juste.
  assert.equal(q.detail, "J'ai lu 3/4, mais aucune des 2 mesures ne tombe juste.");
  assert.equal(d.message, "Chiffrage lu : 3/4, mais aucune des 2 mesures ne le confirme.");
  const quatre = q.reponses.find((x) => x.texte === "4/4");
  assert.deepEqual(quatre.apprendre, [{ traits: [ids[0]], etiquette: "4" }, { traits: ids.slice(1), etiquette: "4" }]);
  assert.match(quatre.geste(r.r.abc).abc, /^M:4\/4$/m);
  // Ce qu'apprend une réponse : un chiffre par signe, du haut puis du bas ; rien si le compte n'y est pas.
  assert.deepEqual(exemplesDuChiffrage({ chiffres: [{ traits: [1], haut: true }, { traits: [2], haut: true }, { traits: [3], haut: false }] }, "12/8").map((e) => e.etiquette), ["1", "2", "8"]);
  assert.deepEqual(exemplesDuChiffrage({ chiffres: [{ traits: [1], haut: true }] }, "C"), [{ traits: [1], etiquette: "C" }]);
  assert.deepEqual(exemplesDuChiffrage({ chiffres: [{ traits: [1], haut: true }] }, "12/8"), []);
  assert.deepEqual(exemplesDuChiffrage({}, "4/4"), []);
});

test("un quart de soupir se lit avec tes gabarits (les règles ne le connaissent pas)", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  let x = 240;
  for (let k = 0; k < 3; k++) { pg.haut(x, 2 + k); x += 64; }
  pg.crochet(pg.haut(x, 3)); x += 70;
  pg.ajouter(forme("quart-soupir", x, pg.p.y(4), f.IL, 21)); x += 50;
  pg.ajouter(forme("quart-soupir", x, pg.p.y(4), f.IL, 22)); x += 50;
  pg.barre(x);
  assert.deepEqual(lire(pg).doutes, ["signe", "signe"]);
  let G = gabaritsVides();
  for (const g of [1, 2, 3]) G = ajouterExemple(G, forme("quart-soupir", 0, 0, f.IL, g), "quart-soupir", f.IL);
  G = ajouterExemple(G, [f.T[83]], "demi-soupir", f.IL);
  G = ajouterExemple(G, [f.T[134]], "soupir", f.IL);
  const r = lire(pg, { gabarits: G });
  assert.equal(r.abc, "M:4/4 K:C | G2 A2 B2 A z/ z/ |");
  assert.deepEqual(r.doutes, []);
});

test("un triolet se lit avec tes gabarits : « (3 », la mesure tombe juste, sans question", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  let x = 240;
  const hs = [0, 1, 2].map((k) => pg.haut(x + k * 52, 2 + k));
  pg.ligature(hs[0], hs[2]);
  const trois = pg.ajouter(forme("triolet", x + 67, hs[1].bout[1] - 1.5 * f.IL, f.IL, 31));
  x += 186;
  for (let k = 0; k < 3; k++) { pg.haut(x, 3 + k); x += 64; }
  pg.barre(x); x += 40;
  for (let k = 0; k < 4; k++) { pg.haut(x, 2 + k); x += 64; }
  pg.barre(x);
  const sans = lire(pg);
  assert.deepEqual([sans.abc, sans.doutes], ["M:4/4 K:C | GAB A2 B2 c2 | G2 A2 B2 c2 |", ["mesure", "triolet"]]);
  // Le doute dit les traits de son « 3 » : « Oui, un triolet » les apprend.
  const d = sans.r.doutes.find((x) => x.type === "triolet");
  assert.deepEqual(d.traits, trois);
  const oui = poser(preparerDoutes([d])[0], sans.r.abc).reponses.find((x) => x.id === "triolet");
  assert.deepEqual(oui.apprendre, [{ traits: trois, etiquette: "triolet" }]);
  let G = gabaritsVides();
  for (const g of [1, 2, 3]) G = ajouterExemple(G, forme("triolet", 0, 0, f.IL, g), "triolet", f.IL);
  const avec = lire(pg, { gabarits: G });
  assert.deepEqual([avec.abc, avec.doutes], ["M:4/4 K:C | (3GAB A2 B2 c2 | G2 A2 B2 c2 |", []]);
});

test("un signe que tes gabarits reconnaissent : nettement, il est lu ; de justesse, la question le propose et l'apprend", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.haut(240, 2); pg.haut(304, 3);
  const croix = pg.ajouter(forme("croix", 370, pg.p.y(4), f.IL, 41));
  pg.haut(420, 4); pg.haut(484, 5); pg.barre(540);
  // Les règles ne savent pas lire cette croix : « signe non reconnu », et la question propose tout.
  const sans = lire(pg);
  assert.deepEqual([sans.abc, sans.doutes], ["M:4/4 K:C | G2 A2 B2 c2 |", ["signe"]]);
  const q0 = poser(preparerDoutes(sans.r.doutes)[0], sans.r.abc);
  assert.equal(q0.titre, "Un signe que je ne reconnais pas");
  assert.deepEqual(q0.reponses.map((x) => x.id), ["diese", "bemol", "becarre", "soupir", "demi-soupir", "quart-soupir", "ignorer"]);
  // Tu dis que c'est un dièse : la note qui suit le prend, et l'exemple est appris.
  const diese = q0.reponses[0];
  assert.equal(diese.geste(sans.r.abc).abc.split("\n").pop(), "G2 A2 ^B2 c2 |");
  assert.deepEqual(diese.apprendre, [{ traits: croix, etiquette: "diese" }]);
  const G = ajouterExemple(gabaritsVides(), diese.apprendre[0].traits.map((i) => pg.traits[i]), "diese", f.IL);
  // La fois suivante, une croix pareille est lue comme un dièse, sans question.
  const pg2 = new Page(f);
  pg2.haut(240, 2); pg2.haut(304, 3);
  pg2.ajouter(forme("croix", 370, pg2.p.y(4), f.IL, 42));
  pg2.haut(420, 4); pg2.haut(484, 5); pg2.barre(540);
  assert.deepEqual([lire(pg2, { gabarits: G }).abc, lire(pg2, { gabarits: G }).doutes], ["M:4/4 K:C | G2 A2 ^B2 c2 |", []]);
  // Deux étiquettes aussi proches l'une que l'autre : de justesse. La lecture ne change pas, la question propose.
  const exemple = forme("croix", 0, 0, f.IL, 1);
  const deux = ajouterExemple(ajouterExemple(gabaritsVides(), exemple, "diese", f.IL), exemple, "becarre", f.IL);
  const juste = lire(pg, { gabarits: deux });
  assert.deepEqual([juste.abc, juste.doutes], ["M:4/4 K:C | G2 A2 B2 c2 |", ["signe"]]);
  const d = preparerDoutes(juste.r.doutes)[0];
  assert.equal(d.propose, "becarre");
  const q = poser(d, juste.r.abc);
  assert.equal(q.titre, "Est-ce un bécarre ?");
  assert.equal(q.reponses[0].id, "becarre");
  assert.equal(q.reponses[0].geste(juste.r.abc).abc.split("\n").pop(), "G2 A2 =B2 c2 |");
  // Un silence se pose après la note qui précède le signe.
  assert.equal(q.reponses.find((x) => x.id === "soupir").geste(juste.r.abc).abc.split("\n").pop(), "G2 A2 z2 B2 c2 |");
});
