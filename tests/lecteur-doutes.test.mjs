/**
 * Les doutes de marge (L2), la mesure qui tranche (L15) et les doutes
 * recalculés après chaque geste (L13), sur ta page de mélodie et sur des
 * mesures fabriquées. Les réponses passent par les vrais gestes d'edition.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { lireFichier } from "../outils/lire.mjs";
import { chargerFabrique, corps, Page } from "./fabrique.mjs";
import { lirePartition } from "../lecteur/partition.js";
import { mesuresDeLAbc, poser, preparerDoutes, recalculerDoutes, suivre } from "../app/doutes.js";

const MELODIE = "tests/pages/2026-09-30-melodie-standard.pdf";

/** Répond comme l'atelier : le geste, le suivi des autres doutes, le doute (et ceux qu'il règle) levés. */
function repondre(abc, doutes, id, reponse) {
  const d = doutes.find((x) => x.id === id);
  const q = poser(d, abc);
  const r = q.reponses.find((x) => x.id === reponse);
  assert.ok(r, `réponse « ${reponse} » absente de ${q.reponses.map((x) => x.id)} (${q.titre})`);
  const res = r.geste ? r.geste(abc) : null;
  if (res) suivre(doutes, res.modif);
  d.leve = true;
  for (const autre of r.regle || []) doutes.find((x) => x.id === autre).leve = true;
  return res ? res.abc : abc;
}
const valide = (abc) => { const [tune] = abcjs.parseOnly(abc); assert.equal((tune.warnings || []).length, 0, String(tune.warnings)); };

test("tes ligatures au ras d'une hampe : « Croche liée ou noire ? », et la réponse coupe la ligature", async () => {
  const r = await lireFichier(MELODIE);
  const doutes = preparerDoutes(r.doutes);
  const q = poser(doutes.find((d) => d.id === "d2"), r.abc);
  assert.equal(q.titre, "Croche liée ou noire ?");
  assert.deepEqual(q.reponses.map((x) => x.texte), ["Croche liée", "Noire"]);
  assert.equal(q.cible.genre, "note");
  const abc = repondre(r.abc, doutes, "d2", "autre");
  assert.match(corps(abc), /edc g2 G G2 G \|/); // « GG » devient « G G2 »
  valide(abc);
  // La même chose pour « dedc », à la 3ᵉ ligne.
  const abc2 = repondre(abc, doutes, "d6", "autre");
  assert.match(corps(abc2), /gcc ded c2 z z2 G :\|/);
  valide(abc2);
});

test("une tête entre deux places : « La ou sol ? », et la réponse la déplace d'un cran", async () => {
  const r = await lireFichier(MELODIE);
  const doutes = preparerDoutes(r.doutes);
  const q = poser(doutes.find((d) => d.id === "d4"), r.abc);
  assert.equal(q.titre, "La ou sol ?");
  assert.deepEqual(q.reponses.map((x) => [x.texte, x.icone]), [["La", "ok"], ["Sol", "bas"]]);
  // C'est le la du second « agf » de la 3ᵉ ligne : il devient un sol.
  const abc = repondre(r.abc, doutes, "d4", "autre");
  assert.match(corps(abc), /^c2 c agf gcc ggf \| gcc/m);
  valide(abc);
});

test("trancher par la mesure : après « Croche » au doute du crochet, la mesure le dit, et propose la noire de « GG »", async () => {
  const r = await lireFichier(MELODIE);
  let doutes = preparerDoutes(r.doutes);
  // La réponse que l'image suggère (le crochet en deux morceaux est un crochet) : la mesure tombe à 11 croches.
  let abc = repondre(r.abc, doutes, "d1", "croche");
  assert.equal(doutes.filter((d) => d.type === "mesure").length, 1);
  doutes = recalculerDoutes(doutes, abc);
  const nouveau = doutes.find((d) => d.origine === "recalcul");
  assert.ok(nouveau, "la mesure de 11 croches n'a pas son doute");
  assert.deepEqual([nouveau.id, nouveau.ligne, nouveau.rang, nouveau.trouve, nouveau.attendu], ["r1", 2, 1, 11, 12]);
  assert.equal(abc.slice(nouveau.vise.debut, nouveau.vise.fin), "c2 c edc g2 GG G");
  assert.deepEqual(nouveau.propositions.map((p) => [p.texte, p.regle]), [["8ᵉ note en noire", ["d2"]]]);
  // La question propose d'abord cette lecture, puis les gestes de toujours.
  const q = poser(nouveau, abc);
  assert.equal(q.titre, "Il manque une croche");
  assert.deepEqual(q.reponses.map((x) => x.texte), ["8ᵉ note en noire", "Ajouter un silence", "Allonger la dernière note"]);
  abc = repondre(abc, doutes, "r1", "proposition-1");
  assert.match(corps(abc), /\|: c2 c edc g2 GG2 G \|/);
  assert.equal(doutes.find((d) => d.id === "d2").leve, true); // le doute de la ligature est réglé avec
  assert.equal(poser(nouveau, abc).titre, "La mesure est complète");
  // Recalculer encore n'ajoute rien : chaque mesure fausse a son doute.
  assert.equal(recalculerDoutes(doutes, abc).length, doutes.length);
  valide(abc);
});

test("dans l'autre sens : la noire de « GG » donne 13 croches, et la mesure propose la croche du crochet", async () => {
  const r = await lireFichier(MELODIE);
  let doutes = preparerDoutes(r.doutes);
  let abc = repondre(r.abc, doutes, "d2", "autre");
  doutes = recalculerDoutes(doutes, abc);
  const nouveau = doutes.find((d) => d.origine === "recalcul");
  assert.equal(poser(nouveau, abc).titre, "Il y a une croche de trop");
  assert.deepEqual(nouveau.propositions.map((p) => p.texte), ["2ᵉ note en croche"]);
  abc = repondre(abc, doutes, "r1", "proposition-1");
  assert.match(corps(abc), /\|: c2 c edc g2 G G2 G \|/); // la lecture de l'audit, par deux réponses
  valide(abc);
});

test("les mesures de l'ABC d'aujourd'hui, voix par voix, avec leur chiffrage", async () => {
  const m = await lireFichier(MELODIE);
  const mel = mesuresDeLAbc(m.abc);
  assert.deepEqual(mel.map((x) => [x.systeme, x.croches, x.attendu, x.fermee]), [
    [1, 16, null, false], [2, 1, 12, true], [2, 12, 12, true], [2, 11, 12, false], [3, 12, 12, true], [3, 11, 12, true],
  ]);
  const p = await lireFichier("tests/pages/2026-09-30-piano-standard.pdf");
  assert.deepEqual(mesuresDeLAbc(p.abc).map((x) => [x.voix, x.systeme, x.croches]), [["1", 1, 8], ["2", 1, 8]]);
  // Au piano, une main qui ne tombe plus juste après un geste : le doute dit laquelle.
  const abc = p.abc.replace("G,,2 z2 |", "G,,2 z |");
  const [d] = recalculerDoutes([], abc);
  assert.deepEqual([d.type, d.main, d.trouve, d.attendu, d.boite], ["mesure", "gauche", 7, 8, null]);
});

test("une mesure fabriquée qui ne tombe pas juste propose la lecture qui la complète (L15)", async () => {
  const f = await chargerFabrique();
  const pg = new Page(f);
  // Une ligature qui s'arrête à 0,6 interligne de la 4ᵉ hampe (au-delà de la tolérance) : la 4ᵉ note est lue
  // noire, la mesure fait 9 croches. Liée, elle serait une croche, et la mesure tomberait juste.
  const hs = [2, 3, 4, 5].map((p, i) => pg.haut(240 + i * 55, p));
  pg.traits.push(pg.ligne([hs[0].bout[0], hs[0].bout[1]], [hs[3].bout[0] - 0.6 * f.IL, hs[3].bout[1]], 14));
  pg.haut(500, 2); pg.haut(590, 3); pg.barre(680);
  pg.haut(740, 2); pg.haut(830, 3); pg.haut(920, 4); pg.bas(1010, 5); pg.barre(1100);
  const r = lirePartition([pg.traits], f.CAL, { titre: "x" });
  assert.equal(corps(r.abc), "GAB c2 G2 A2 | G2 A2 B2 c2 |");
  assert.deepEqual(r.doutes.map((d) => d.type), ["mesure", "ligature"]); // dans l'ordre de la page : la mesure commence avant la 4ᵉ hampe
  const [mesure, lig] = r.doutes;
  assert.deepEqual([lig.lue, lig.alternative.croches, mesure.trouve, mesure.attendu], ["seule", 1, 9, 8]);
  // Et, en mesure simple, trois croches liées pourraient être un triolet : proposé en second.
  assert.deepEqual(mesure.propositions.map((p) => [p.texte, p.regle]), [["4ᵉ note en croche", ["d2"]], ["Triolet sur les 1ʳᵉ à 3ᵉ notes", []]]);
  const doutes = preparerDoutes(r.doutes);
  assert.deepEqual(poser(doutes[0], r.abc).reponses.map((x) => x.texte), ["4ᵉ note en croche", "Triolet sur les 1ʳᵉ à 3ᵉ notes", "Raccourcir la dernière note"]);
  const abc = repondre(r.abc, doutes, "d1", "proposition-1");
  assert.equal(corps(abc), "GAB c G2 A2 | G2 A2 B2 c2 |");
  assert.equal(doutes[1].leve, true);
  // Répondre « croche liée » au doute de la ligature fait la même chose, et relie la note au groupe.
  const autre = preparerDoutes(r.doutes);
  assert.equal(corps(repondre(r.abc, autre, "d2", "autre")), "GABc G2 A2 | G2 A2 B2 c2 |");
});
