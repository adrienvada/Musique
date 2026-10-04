/**
 * Les signes que les pages d'essai n'ont pas, en mesures fabriquées à partir
 * de tes vrais traits (tests/fabrique.mjs) : traits repassés, points,
 * altérations, têtes loin de la portée, silences, accords, liaisons…
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chargerFabrique, lire, Page } from "./fabrique.mjs";
import { lireFichier } from "../outils/lire.mjs";
import { lirePartition } from "../lecteur/partition.js";

const PAGES = ["tests/pages/2026-09-30-melodie-standard.pdf", "tests/pages/2026-09-30-piano-standard.pdf"];
const signature = (r) => `${r.abc}\n${r.doutes.map((d) => d.type).join(",")}`;

test("repasser un trait de tes pages, à l'identique ou presque, ne change rien", async () => {
  for (const f of PAGES) {
    const r = await lireFichier(f);
    const { cal } = r, traits = r.pages[0].traits, il = cal.interligne;
    const base = signature(lirePartition([traits], cal, { titre: "x" }));
    traits.forEach((t, i) => {
      for (const d of [0, 0.08]) {
        const copie = t.map(([x, y]) => [x + d * il, y + 0.3 * d * il]);
        assert.equal(signature(lirePartition([[...traits, copie]], cal, { titre: "x" })), base, `${f}, trait ${i} repassé (${d} il)`);
      }
    });
  }
});

test("une hampe repassée à côté d'elle-même reste une hampe, pas une barre de mesure", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  const h = pg.haut(240, 2);
  pg.traits.push(pg.ligne([h.x + 0.25 * f.IL, pg.p.y(2) - 0.2 * f.IL], [h.bout[0] + 0.25 * f.IL, h.bout[1]], 10)); // repassée 0,25 il à droite
  pg.haut(330, 3); pg.haut(420, 4); pg.bas(510, 5); pg.barre(620);
  assert.equal(lire(pg).corps, "G2 A2 B2 c2 |");
});

test("le point d'une noire pointée à hampe montante n'est plus avalé par la hampe", async () => {
  const f = await chargerFabrique();
  for (const [dir, pas, attendu] of [["haut", 2, "G3 A B2 c2 |"], ["bas", 6, "d3 A B2 c2 |"]]) {
    for (const d of [0.4, 0.6, 0.8]) {
      const pg = new Page(f);
      pg.hampe(pg.tete(260, pas), dir); pg.point(260 + d * f.IL, pas + 0.5);
      pg.crochet(pg.haut(420, 3)); pg.bas(560, 4); pg.bas(680, 5); pg.barre(800);
      assert.equal(lire(pg).corps, attendu, `hampe ${dir}, point à ${d} il`);
    }
  }
});

test("une barre repassée est une barre simple ; une double barre a ses traits séparés", async () => {
  const f = await chargerFabrique();
  const mesure = (pg) => { pg.haut(240, 2); pg.haut(330, 3); pg.haut(420, 4); pg.bas(510, 5); };
  const repassee = new Page(f); mesure(repassee); repassee.barre(620); repassee.barre(620 + 0.1 * f.IL);
  assert.equal(lire(repassee).corps, "G2 A2 B2 c2 |");
  const double = new Page(f); mesure(double); double.barre(620); double.barre(620 + 0.6 * f.IL);
  assert.equal(lire(double).corps, "G2 A2 B2 c2 |]"); // en fin de pièce, la double barre est une barre de fin
});

test("altérations dans la mesure : dièse, bémol et bécarre en deux « L » (qui devenait un soupir)", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.haut(240, 2); pg.diese(330, 1); pg.haut(380, 1); pg.bemol(480, 4); pg.bas(520, 4); pg.becarre(620, 4); pg.bas(660, 4); pg.barre(780);
  const r = lire(pg);
  assert.equal(r.corps, "G2 ^F2 _B2 =B2 |");
  assert.deepEqual(r.doutes, []);
});

test("un dièse ou un bémol collé à la première note est une altération, pas l'armure, et le doute le dit", async () => {
  const f = await chargerFabrique();
  const diese = new Page(f);
  diese.diese(220, 1); diese.haut(270, 1); diese.haut(380, 2); diese.haut(490, 3); diese.bas(600, 4); diese.barre(720);
  const r = lire(diese);
  assert.equal(r.abc, "M:4/4 K:C | ^F2 G2 A2 B2 |");
  const [d] = r.r.doutes;
  assert.deepEqual([d.type, d.variante, d.lue, d.cle, d.autreCle], ["armure", "premiere-note", "alteration", "C", "G"]);
  assert.equal(r.r.abc.slice(d.cible.debut, d.cible.fin), "^F2");
  const bemol = new Page(f);
  bemol.bemol(220, 4); bemol.bas(270, 4); bemol.haut(380, 2); bemol.haut(490, 3); bemol.bas(600, 4); bemol.barre(720);
  assert.equal(lire(bemol).abc, "M:4/4 K:C | _B2 G2 A2 B2 |");
});

test("une armure loin de la première note reste l'armure, même à sa hauteur", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.diese(200, 8); pg.bas(300, 8); pg.haut(400, 2); pg.haut(500, 3); pg.bas(600, 4); pg.barre(720);
  const r = lire(pg);
  // Le fa♯ est sur la ligne du haut, là où l'armure le met, à deux interlignes de la note : sol majeur.
  assert.equal(r.abc, "M:4/4 K:G | f2 G2 A2 B2 |");
  assert.deepEqual(r.doutes, []);
});

test("deux dièses d'armure qui se touchent font ré majeur (ils faisaient do majeur)", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.diese(205, 8); pg.diese(245, 5); [2, 3, 4, 5].forEach((p, i) => pg.note(320 + i * 80, p)); pg.barre(700);
  assert.equal(lire(pg).abc, "M:4/4 K:D | G2 A2 B2 c2 |");
});

test("une armure mêlée de bémols et de dièses : les plus nombreux, et un doute", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.bemol(195, 4); pg.bemol(228, 7); pg.diese(290, 8); [2, 3, 4, 5].forEach((p, i) => pg.note(380 + i * 80, p)); pg.barre(740);
  const r = lire(pg);
  assert.equal(r.abc, "M:4/4 K:Bb | G2 A2 B2 c2 |");
  const [d] = r.r.doutes;
  assert.deepEqual([d.type, d.variante, d.bemols, d.dieses, d.cle, d.autres], ["armure", "melee", 2, 1, "Bb", ["G", "C"]]);
});
