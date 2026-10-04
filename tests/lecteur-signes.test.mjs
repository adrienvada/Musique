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
