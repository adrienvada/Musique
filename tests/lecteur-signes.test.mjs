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

test("du texte au-dessus et entre les portées ne fait plus de notes (titre, paroles, accords chiffrés)", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.texte(300, 120); pg.texte(340, 125); pg.texte(380, 118); // un mot au-dessus de la 1ʳᵉ portée
  [2, 3, 4, 5].forEach((p, i) => pg.note(260 + i * 90, p)); pg.barre(680);
  pg.texte(300, 395); pg.texte(345, 398); // des paroles entre la 1ʳᵉ et la 2ᵉ portée
  const r = lire(pg);
  assert.equal(r.corps, "G2 A2 B2 c2 |");
  assert.deepEqual(r.doutes, []);
  // Une boucle seule, à deux interlignes de la portée et sans ligne supplémentaire : gardée, mais demandée.
  const seule = new Page(f);
  [2, 3, 4].forEach((p, i) => seule.note(260 + i * 90, p)); seule.teteVide(560, 12); seule.barre(680);
  const s = lire(seule);
  assert.equal(s.corps, "G2 A2 B2 c'8 |");
  assert.deepEqual(s.doutes, ["sans-hampe"]);
});

test("une note entre deux portées va à la portée de ses lignes supplémentaires et de sa hampe", async () => {
  const f = await chargerFabrique();
  const hautes = new Page(f, 1); // 2ᵉ portée : do6 et la5, au-dessus d'elle
  const y = (pas) => hautes.p.y(pas);
  hautes.bas(280, 12); hautes.traits.push([[260, y(10)], [300, y(10)]], [[260, y(12)], [300, y(12)]]);
  hautes.bas(400, 10); hautes.traits.push([[380, y(10)], [420, y(10)]]);
  hautes.bas(520, 4); hautes.bas(640, 5); hautes.barre(760);
  assert.equal(lire(hautes).corps, "c'2 a2 B2 c2 |");
  const basses = new Page(f, 0); // 1ʳᵉ portée : la3 et do4, sous elle
  const z = (pas) => basses.p.y(pas);
  basses.haut(280, -4); basses.traits.push([[260, z(-2)], [300, z(-2)]], [[260, z(-4)], [300, z(-4)]]);
  basses.haut(400, -2); basses.traits.push([[380, z(-2)], [420, z(-2)]]);
  basses.haut(520, 2); basses.bas(640, 5); basses.barre(760);
  assert.equal(lire(basses).corps, "A,2 C2 G2 c2 |");
});

test("une hampe sans tête n'est plus un soupir : elle demande s'il manque une note", async () => {
  const r = await lireFichier("tests/pages/2026-09-30-melodie-standard.pdf");
  const sans = r.pages[0].traits.filter((_, i) => i !== 9); // la tête du sol4 de la gamme, retirée
  const res = lirePartition([sans], r.cal, { titre: "x" });
  assert.equal(res.abc.split("\n").find((l) => l.startsWith("C2 D2")), "C2 D2 E2 F2 A2 B2 c2");
  const d = res.doutes.find((x) => x.type === "tete-manquante");
  assert.ok(d, "doute « tête manquante » absent");
  assert.equal(res.abc.slice(d.cible.debut, d.cible.fin), "F2"); // la note d'avant
});

test("les durées que tes pages n'ont pas : blanches, ronde, doubles croches, notes pointées", async () => {
  const f = await chargerFabrique();
  const blanches = new Page(f);
  blanches.hampe(blanches.teteVide(260, 2), "haut"); blanches.hampe(blanches.teteVide(420, 4), "bas"); blanches.barre(560); blanches.teteVide(700, 5); blanches.barre(900);
  assert.equal(lire(blanches).abc, "M:4/4 K:C | G4 B4 | c8 |");
  const doubles = new Page(f);
  const hs = [2, 3, 4, 5].map((p, i) => doubles.haut(240 + i * 50, p)); doubles.ligature(hs[0], hs[3]); doubles.ligature(hs[0], hs[3], 0.6);
  doubles.haut(470, 2); doubles.hampe(doubles.teteVide(580, 5), "bas"); doubles.barre(720);
  assert.equal(lire(doubles).abc, "M:4/4 K:C | G/A/B/c/ G2 c4 |");
  const pointees = new Page(f);
  pointees.haut(240, 2); pointees.point(240 + 0.9 * f.IL, 2.5); pointees.crochet(pointees.haut(380, 3)); pointees.hampe(pointees.teteVide(480, 4), "bas"); pointees.barre(600);
  pointees.hampe(pointees.teteVide(680, 5), "bas"); pointees.point(680 + 0.9 * f.IL, 5); pointees.bas(880, 5); pointees.barre(1000);
  const r = lire(pointees);
  assert.equal(r.abc, "M:4/4 K:C | G3 A B4 | c6 c2 |");
  assert.deepEqual(r.doutes, []);
});

test("un accord à hampe courte reste un accord ; une tête au-dessus du bout de la hampe se rejoint d'un geste", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  const t1 = pg.tete(260, 0); pg.tete(260, 2); pg.tete(260, 5); pg.hampe(t1, "haut", 3.5); // la hampe dépasse le do de 1 interligne
  const t2 = pg.tete(380, 1); pg.tete(380, 3); pg.tete(380, 6); pg.hampe(t2, "haut", 4.5);
  const t3 = pg.teteVide(520, 0); pg.teteVide(520, 2); pg.teteVide(520, 5); pg.hampe(t3, "haut", 4.5); pg.barre(680);
  assert.equal(lire(pg).corps, "[EGc]2 [FAd]2 [EGc]4 |");
  // Une hampe trop courte : la tête du haut est au-dessus de son bout.
  const court = new Page(f);
  const t = court.tete(260, 0); court.tete(260, 4); court.hampe(t, "haut", 1.6);
  court.haut(380, 2); court.haut(480, 3); court.bas(580, 4); court.barre(700);
  const r = lire(court);
  assert.equal(r.corps, "B2 E2 G2 A2 B2 |"); // la tête sans hampe, un peu à gauche de la hampe, vient en premier
  const [d] = r.r.doutes.filter((x) => x.type === "sans-hampe");
  const { poser, preparerDoutes } = await import("../app/doutes.js");
  const [p] = preparerDoutes([d]);
  const q = poser(p, r.r.abc);
  assert.deepEqual(q.reponses.map((x) => x.id), ["noire", "accord", "enlever"]);
  const res = q.reponses[1].geste(r.r.abc);
  assert.match(res.abc, /\n\[EB\]2 G2 A2 B2 \|$/);
});

test("une liaison de durée entre deux notes de même hauteur s'écrit « - » ; un legato ne change rien", async () => {
  const f = await chargerFabrique();
  const liee = new Page(f);
  liee.bas(260, 5); liee.bas(400, 5); liee.arc(270, 390, liee.p.y(5) + 0.5 * f.IL, 0.5); liee.hampe(liee.teteVide(560, 5), "bas"); liee.barre(720);
  const r = lire(liee);
  assert.equal(r.corps, "c2- c2 c4 |");
  assert.deepEqual(r.doutes, []);
  const legato = new Page(f);
  legato.bas(260, 5); legato.bas(400, 6); legato.arc(270, 390, legato.p.y(5) + 0.5 * f.IL, 0.5); legato.hampe(legato.teteVide(560, 5), "bas"); legato.barre(720);
  assert.equal(lire(legato).corps, "c2 d2 c4 |");
});

test("pause et demi-pause, par leur place : la pause dure toute la mesure", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.rectangle(350, 6, true); pg.barre(520); pg.rectangle(640, 4, false); pg.hampe(pg.teteVide(800, 2), "haut"); pg.barre(950);
  const r = lire(pg);
  assert.equal(r.abc, "M:4/4 K:C | z8 | z4 G4 |");
  assert.deepEqual(r.doutes, []);
  // En 3/4, la même pause fait six croches.
  const trois = new Page(f);
  [2, 3, 4].forEach((p, i) => trois.note(240 + i * 80, p)); trois.barre(470); trois.rectangle(560, 6, true); trois.barre(680);
  [2, 3, 4].forEach((p, i) => trois.note(740 + i * 80, p)); trois.barre(980);
  assert.equal(lire(trois).abc, "M:3/4 K:C | G2 A2 B2 | z6 | G2 A2 B2 |");
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
