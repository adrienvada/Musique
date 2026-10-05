/**
 * Les traits venus de la tablette (fichiers .rm) suivent les règles du PDF :
 * l'encre noire seule, des points valides, des blocs qui ne débordent pas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { estEncre, lireLignes, lirePageRm, traitsDePage } from "../supabase/functions/portee-remarkable/rm.js";
import { lireFichier } from "../outils/lire.mjs";
import { lirePartition } from "../lecteur/partition.js";

const corps = (abc) => abc.split("\n").filter((l) => !/^[A-Za-z]:|^%%/.test(l)).join("\n");

/**
 * Une page .rm v6 minimale : un bloc « ligne » par trait, avec son outil et sa couleur.
 * `points` sont dans le repère de la tablette (abscisse centrée), écrits tels quels.
 */
function ecrire(lignes) {
  const morceaux = [Buffer.from("reMarkable .lines file, version=6          ", "latin1")];
  const varuint = (n) => {
    const o = [];
    do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n);
    return Buffer.from(o);
  };
  const tag = (index, type) => varuint((index << 4) | type);
  const id = (index, a, b) => Buffer.concat([tag(index, 0xf), Buffer.from([a]), varuint(b)]);
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  lignes.forEach(({ points, outil = 4, couleur = 0, taille = null }, k) => {
    const pts = Buffer.alloc(14 * points.length);
    points.forEach(([x, y], i) => { pts.writeFloatLE(x, 14 * i); pts.writeFloatLE(y, 14 * i + 4); });
    const ligne = Buffer.concat([
      tag(1, 0x4), u32(outil), tag(2, 0x4), u32(couleur),
      tag(3, 0x8), (() => { const b = Buffer.alloc(8); b.writeDoubleLE(1); return b; })(),
      tag(4, 0x4), (() => { const b = Buffer.alloc(4); b.writeFloatLE(0); return b; })(),
      tag(5, 0xc), u32(taille ?? pts.length), pts,
    ]);
    const valeur = Buffer.concat([Buffer.from([3]), ligne]);
    const corpsBloc = Buffer.concat([
      id(1, 0, 11), id(2, 1, k + 100), id(3, 0, 0), id(4, 0, 0), tag(5, 0x4), u32(0),
      tag(6, 0xc), u32(valeur.length), valeur,
    ]);
    morceaux.push(u32(corpsBloc.length), Buffer.from([0, 2, 2, 0x05]), corpsBloc);
  });
  return new Uint8Array(Buffer.concat(morceaux));
}

const trait = (x0, y0) => [[x0, y0], [x0 + 10, y0 + 5], [x0 + 20, y0 + 15]];

test("seule l'encre noire compte, comme dans le PDF exporté : ni gris, ni blanc, ni couleur, ni ombrage", () => {
  const page = ecrire([
    { points: trait(0, 100) },                     // fineliner noir : gardé
    { points: trait(0, 200), outil: 15 },          // stylo à bille noir : gardé
    { points: trait(0, 300), couleur: 1 },         // gris
    { points: trait(0, 400), couleur: 2 },         // blanc
    { points: trait(0, 500), couleur: 6 },         // bleu
    { points: trait(0, 600), outil: 23 },          // ombrage, même en noir
    { points: trait(0, 700), outil: 5 },           // surligneur
    { points: trait(0, 800), outil: 6 },           // gomme
  ]);
  assert.equal(lireLignes(page).length, 6); // tout ce que rmscene rend, sauf gomme et surligneur
  const traits = traitsDePage(page);
  assert.equal(traits.length, 2);
  assert.deepEqual(traits.map((t) => Math.round(t[0][1])), [100, 199]);
  assert.equal(estEncre({ outil: 4, couleur: 0 }), true);
  assert.equal(estEncre({ outil: 23, couleur: 0 }), false);
  // Le fichier de rmscene n'a que des couleurs et l'ombrage : aucun trait d'encre noire.
  const couleurs = new Uint8Array(fs.readFileSync("tests/fixtures/rm/Color_and_tool_v3.14.4.rm"));
  assert.equal(lireLignes(couleurs).length, 25);
  assert.equal(traitsDePage(couleurs).length, 0);
});

test("un point non fini ou absurde est écarté, le reste du trait est gardé", () => {
  const page = ecrire([{ points: [[0, 100], [NaN, 110], [10, 120], [Infinity, 1], [3e9, 5], [20, 130]] }]);
  const [t] = traitsDePage(page);
  assert.equal(t.length, 3);
  assert.ok(t.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
});

test("des points qui débordent de leur bloc ne lisent plus le bloc suivant", () => {
  const propre = ecrire([{ points: trait(0, 100) }, { points: trait(50, 300) }]);
  const gonflee = ecrire([{ points: trait(0, 100), taille: 14 * 3 + 14 * 30 }, { points: trait(50, 300) }]);
  assert.equal(lireLignes(propre).length, 2);
  const lues = lireLignes(gonflee);
  // La première ligne annonce 33 points dans un bloc qui en tient 3 : elle est sautée,
  // la seconde se lit telle quelle (avant, la première avalait la seconde comme coordonnées).
  assert.equal(lues.length, 1);
  assert.deepEqual(lues[0].points.map((p) => p.map(Math.round)), trait(50, 300));
  const bizarre = ecrire([{ points: trait(0, 100), taille: 13 }]);
  assert.equal(lireLignes(bizarre).length, 0); // une taille qui n'est pas un nombre entier de points
});

test("un fichier tronqué ou abîmé se lit sans erreur, jusqu'où il peut", () => {
  const page = ecrire([{ points: trait(0, 100) }, { points: trait(50, 300) }]);
  for (let n = 0; n < page.length; n += 7) {
    const r = lirePageRm(page.subarray(0, n));
    assert.ok(Array.isArray(r.traits));
    assert.ok(r.traits.flat().every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  }
  assert.equal(lirePageRm(page).traits.length, 2);
  // Un en-tête inconnu : l'erreur est rendue, pas levée (le connecteur lit les autres pages).
  const r = lirePageRm(new TextEncoder().encode("reMarkable .lines file, version=5          "));
  assert.deepEqual(r.traits, []);
  assert.match(r.erreur, /\.rm v6/);
  // Un bloc qui annonce 4 Go : on s'arrête, sans lire au-delà du fichier.
  const geant = new Uint8Array([...page.subarray(0, 43), 0xff, 0xff, 0xff, 0xff, 0, 2, 2, 5, ...new Uint8Array(100)]);
  assert.deepEqual(lireLignes(geant), []);
});

test("une page d'essai mêlée de traits gris et colorés se lit comme son PDF", async () => {
  const pdf = await lireFichier("tests/pages/2026-09-30-piano-standard.pdf");
  // Ses traits, ramenés au repère de la tablette, plus des traits gris, bleus et ombrés par-dessus.
  const versTablette = ([x, y]) => [(x - 702) * 227 / 226, y * 227 / 226];
  const lignes = pdf.pages[0].traits.map((t) => ({ points: t.map(versTablette) }));
  lignes.push({ points: [[-500, 300], [400, 300]], couleur: 1 }, { points: [[-200, 260], [-100, 330]], couleur: 6 }, { points: [[0, 250], [30, 270], [0, 290]], outil: 23 });
  const res = lirePartition([traitsDePage(ecrire(lignes))], pdf.cal, { titre: "x" });
  assert.equal(corps(res.abc), corps(pdf.abc));
});
