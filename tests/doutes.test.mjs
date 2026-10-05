/**
 * Les doutes, un par un : chaque doute sait où est sa note dans l'ABC, la
 * question se pose sur le texte d'aujourd'hui, et une réponse applique le vrai
 * geste d'edition.js sans décaler les autres doutes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { lireFichier } from "../outils/lire.mjs";
import { completerDoutes, deplacerVise, jetonsDeLaMesure, modifEntre, noteVisee, nomCle, poser, preparerDoutes, suivre, typeDe } from "../app/doutes.js";

const MELODIE = "tests/pages/2026-09-30-melodie-standard.pdf";
const total = (d, abc) => jetonsDeLaMesure(d, abc).reduce((t, j) => t + j.croches, 0);
const corpsDe = (abc) => abc.split("\n").filter((l) => !/^[A-Za-z]:|^%%/.test(l)).join("\n");

/** Applique une réponse comme l'atelier : le geste, puis le suivi des autres doutes. */
function repondre(abc, doutes, i, id) {
  const q = poser(doutes[i], abc);
  const r = q.reponses.find((x) => x.id === id);
  assert.ok(r, `réponse « ${id} » absente de ${q.reponses.map((x) => x.id)}`);
  const res = r.geste ? r.geste(abc) : null;
  if (res) suivre(doutes, res.modif);
  doutes[i].leve = true;
  return res ? res.abc : abc;
}

test("la lecture dit où est chaque doute dans l'ABC, sans changer l'ABC", async () => {
  const r = await lireFichier(MELODIE);
  // Dans l'ordre de la page. Depuis le 04/10 (L2), une ligature qui s'arrête au
  // ras d'une hampe et une tête entre deux places sont aussi des questions.
  assert.deepEqual(r.doutes.map((d) => d.type), ["crochet", "ligature", "mesure", "hauteur", "hauteur", "ligature"]);
  assert.deepEqual(r.doutes.map((d) => d.id), ["d1", "d2", "d3", "d4", "d5", "d6"]);
  const [crochet, , mesure] = r.doutes;
  assert.equal(r.abc.slice(crochet.cible.debut, crochet.cible.fin), "c2");
  assert.equal(r.abc.slice(mesure.cible.debut, mesure.cible.fin), "c2 c edc g2 z GG");
  // La levée (le sol seul, devant la reprise) n'est pas une mesure : la mesure
  // de 11 croches est la 2ᵉ de la ligne, plus la 3ᵉ (audit du 04/10, L19).
  assert.deepEqual([mesure.ligne, mesure.rang, mesure.trouve, mesure.attendu], [2, 2, 11, 12]);
  // Rien d'interne ne sort de la lecture : les doutes se rangent tels quels.
  assert.equal(JSON.stringify(r.doutes), JSON.stringify(JSON.parse(JSON.stringify(r.doutes))));
  assert.ok(r.doutes.every((d) => !("_ev" in d) && !("_mes" in d)));
  const [tune] = abcjs.parseOnly(r.abc);
  assert.equal((tune.warnings || []).length, 0);
});

test("une page de piano : la mesure douteuse d'une main se retrouve dans sa ligne", async () => {
  const r = await lireFichier("tests/pages/2026-09-30-piano-standard.pdf");
  assert.equal(r.doutes.length, 0);
});

test("répondre « croche » puis « ajouter un silence » : la note change, la mesure se complète", async () => {
  const r = await lireFichier(MELODIE);
  const doutes = preparerDoutes(r.doutes);
  assert.equal(poser(doutes[0], r.abc).titre, "Croche ou noire ?");
  assert.deepEqual(poser(doutes[0], r.abc).reponses.map((x) => x.texte), ["Noire", "Croche"]);

  let abc = repondre(r.abc, doutes, 0, "croche");
  assert.equal(abc.length, r.abc.length - 1);
  assert.equal(noteVisee(doutes[0], abc) && abc.slice(doutes[0].vise.debut, doutes[0].vise.fin), "c"); // la même note, devenue croche
  // Le doute de la mesure vise toujours sa mesure, décalée d'un caractère.
  assert.equal(abc.slice(doutes[2].vise.debut, doutes[2].vise.fin), "c2 c edc g2 z GG");

  const q = poser(doutes[2], abc);
  assert.equal(q.titre, "Il manque une croche");
  assert.equal(q.detail, "Ligne 2, 2ᵉ mesure : j'en compte 11 au lieu de 12."); // la levée ne compte pas
  assert.deepEqual(q.reponses.map((x) => x.texte), ["Ajouter un silence", "Allonger la dernière note"]);
  assert.ok(q.voulu && q.manuel);

  abc = repondre(abc, doutes, 2, "silence");
  assert.equal(abc.slice(doutes[2].vise.debut, doutes[2].vise.fin), "c2 c edc g2 z GG z");
  assert.equal(total(doutes[2], abc), 12);
  assert.equal(poser(doutes[2], abc).titre, "La mesure est complète");
  const [tune] = abcjs.parseOnly(abc);
  assert.equal((tune.warnings || []).length, 0);
});

test("« allonger la dernière note » complète aussi la mesure, et « raccourcir » en retire une", async () => {
  const r = await lireFichier(MELODIE);
  const doutes = preparerDoutes(r.doutes);
  const abc = repondre(r.abc, doutes, 2, "allonger");
  assert.equal(abc.slice(doutes[2].vise.debut, doutes[2].vise.fin), "c2 c edc g2 z GG2"); // le dernier G, collé au premier, passe de 1 à 2
  assert.equal(total(doutes[2], abc), 12);
  // Une mesure de trop : on raccourcit la dernière note.
  const trop = preparerDoutes([{ ...r.doutes[2] }]);
  const abcTrop = r.abc.replace("z GG", "z GG3"); // 13 croches
  suivre(trop, { de: trop[0].vise.fin, a: trop[0].vise.fin, longueur: 1 }); // le « 3 » écrit à la fin de la mesure
  const q = poser(trop[0], abcTrop);
  assert.equal(q.titre, "Il y a une croche de trop");
  assert.deepEqual(q.reponses.map((x) => x.id), ["raccourcir"]);
  assert.equal(repondre(abcTrop, trop, 0, "raccourcir"), r.abc.replace("z GG", "z GG2"));
});

test("répondre « noire » ne change pas l'ABC ; défaire une note ôte les réponses fermées", async () => {
  const r = await lireFichier(MELODIE);
  const doutes = preparerDoutes(r.doutes);
  assert.equal(repondre(r.abc, doutes, 0, "noire"), r.abc);
  // La note visée est supprimée à la main : plus de réponse fermée, mais on peut toujours corriger ou laisser.
  const sans = preparerDoutes(r.doutes);
  const res = { abc: r.abc.slice(0, sans[0].vise.debut) + r.abc.slice(sans[0].vise.fin + 1), modif: { de: sans[0].vise.debut, a: sans[0].vise.fin + 1, longueur: 0 } };
  suivre(sans, res.modif);
  assert.equal(sans[0].vise, null);
  const q = poser(sans[0], res.abc);
  assert.deepEqual([q.reponses.length, q.manuel], [0, true]);
  assert.equal(q.titre, "Croche ou noire ?");
  // L'autre doute a suivi.
  assert.equal(res.abc.slice(sans[2].vise.debut, sans[2].vise.fin), "c2 c edc g2 z GG");
});

test("suivre les corrections : une note ne s'étend pas à ses voisines, une mesure grandit à ses bords", () => {
  const note = { debut: 10, fin: 12 };
  assert.deepEqual(deplacerVise(note, { de: 10, a: 12, longueur: 1 }), { debut: 10, fin: 11 }); // remplacée
  assert.deepEqual(deplacerVise(note, { de: 12, a: 12, longueur: 3 }), { debut: 10, fin: 12 }); // une copie juste après
  assert.deepEqual(deplacerVise(note, { de: 10, a: 10, longueur: 3 }), { debut: 13, fin: 15 }); // une copie juste avant
  assert.deepEqual(deplacerVise(note, { de: 0, a: 4, longueur: 1 }), { debut: 7, fin: 9 }); // plus tôt
  assert.equal(deplacerVise(note, { de: 11, a: 14, longueur: 0 }), null); // coupée en deux
  assert.equal(deplacerVise(note, { de: 10, a: 13, longueur: 0 }), null); // supprimée avec son espace
  const mesure = { debut: 20, fin: 30 };
  assert.deepEqual(deplacerVise(mesure, { de: 30, a: 30, longueur: 3 }, true), { debut: 20, fin: 33 }); // silence ajouté à la fin
  assert.deepEqual(deplacerVise(mesure, { de: 22, a: 24, longueur: 0 }, true), { debut: 20, fin: 28 }); // une note ôtée dedans
  assert.equal(deplacerVise(null, { de: 0, a: 0, longueur: 1 }), null);
  assert.deepEqual(modifEntre("abc def", "abc xdef"), { de: 4, a: 4, longueur: 1 });
  assert.deepEqual(modifEntre("abc", "abc"), { de: 3, a: 3, longueur: 0 });
});

test("les anciens doutes, sans type ni cible : la question se pose, mais sans réponse fermée", async () => {
  const r = await lireFichier(MELODIE);
  // Une partition lue avant le 02/10 : ses seuls doutes étaient le crochet et la mesure, sans type ni cible.
  const anciens = r.doutes.filter((d) => ["crochet", "mesure"].includes(d.type)).map(({ message, page, portee, boite }) => ({ message, page, portee, boite, leve: false }));
  assert.deepEqual(anciens.map(typeDe), ["crochet", "mesure"]);
  const q = poser(anciens[1], r.abc);
  assert.equal(q.titre, "Il manque une croche");
  assert.deepEqual([q.reponses.length, q.manuel, q.voulu], [0, true, true]);
  // Une partition pas encore corrigée retrouve ses cibles en relisant ses traits.
  const complets = completerDoutes(anciens, r.doutes);
  assert.deepEqual(complets.map((d) => d.type), ["crochet", "mesure"]);
  assert.equal(r.abc.slice(complets[0].vise.debut, complets[0].vise.fin), "c2");
  assert.equal(poser(complets[1], r.abc).reponses.length, 2);
});

test("les autres doutes : une question fermée chacun", () => {
  const armure = poser({ type: "armure", cle: "Eb", message: "Pas d'armure…" }, "");
  assert.equal(armure.titre, "Même armure qu'avant ?");
  assert.match(armure.detail, /mi♭ majeur/);
  assert.equal(nomCle("F#"), "fa♯ majeur");
  const sans = poser({ type: "sans-hampe", message: "Tête pleine sans hampe : lue comme une noire.", vise: { debut: 2, fin: 4 } }, "e c2 d");
  assert.deepEqual(sans.reponses.map((x) => x.id), ["noire", "enlever"]);
  assert.equal(sans.reponses[1].geste("e c2 d").abc, "e d");
  assert.equal(poser({ type: "signe" }, "").reponses.length, 1);
  assert.equal(poser({ type: "chiffrage" }, "").reponses.length, 1);
  // Une ronde loin de la portée (L6) et une hampe sans tête (L8).
  const ronde = poser({ type: "sans-hampe", message: "Tête vide sans hampe, loin de la portée : lue comme une ronde.", vise: { debut: 0, fin: 3 } }, "c'8 d2");
  assert.equal(ronde.titre, "Est-ce une ronde ?");
  assert.deepEqual(ronde.reponses.map((x) => x.id), ["ronde", "enlever"]);
  const manque = poser({ type: "tete-manquante", vise: { debut: 0, fin: 2 } }, "F2 A2");
  assert.equal(manque.titre, "Il manque une note ?");
  assert.deepEqual([manque.reponses.map((x) => x.id), manque.manuel, manque.cible.genre], [["ignorer"], true, "note"]);
  assert.equal(poser({ message: "?" }, "").titre, "À vérifier");
});

test("armure ou altération de la première note : chaque réponse réécrit la ligne en un seul geste", async () => {
  const { chargerFabrique, Page, lire } = await import("./fabrique.mjs");
  const f = await chargerFabrique();
  const pg = new Page(f);
  pg.diese(220, 1); pg.haut(270, 1); pg.haut(380, 2); pg.haut(490, 3); pg.bas(600, 4); pg.barre(720);
  const { r } = lire(pg);
  const doutes = preparerDoutes(r.doutes);
  const q = poser(doutes[0], r.abc);
  assert.equal(q.titre, "Armure ou altération ?");
  assert.deepEqual(q.reponses.map((x) => x.texte), ["Cette note seulement", "Toute la ligne : sol majeur"]);
  assert.equal(q.cible.genre, "note");
  // « Toute la ligne » : sol majeur à l'armure, et le fa n'a plus son dièse.
  const abc = repondre(r.abc, doutes, 0, "ligne");
  assert.match(abc, /^K:G$/m);
  assert.equal(corpsDe(abc), "F2 G2 A2 B2 |");
  assert.equal(abc.slice(doutes[0].vise.debut, doutes[0].vise.fin), "F2"); // la note suivie à travers les deux modifications
  const [tune] = abcjs.parseOnly(abc);
  assert.equal((tune.warnings || []).length, 0);
});

test("armure mêlée et armure reprise : des réponses qui écrivent l'armure choisie", () => {
  const abc = "X:1\nT:x\nM:4/4\nL:1/8\nK:C\nG2 A2 B2 c2 |\nc2 B2 A2 G2 |";
  const ligne = { debut: abc.indexOf("G2 A2"), fin: abc.indexOf("\n", abc.indexOf("G2 A2")) };
  const melee = preparerDoutes([{ type: "armure", variante: "melee", cle: "Bb", autres: ["G", "C"], bemols: 2, dieses: 1, cible: null, cibleLigne: ligne }]);
  // La lecture avait choisi si♭ (deux bémols, un dièse) : le K: est déjà là, la réponse « Sol majeur » le change.
  const avecBb = abc.replace("K:C", "K:Bb");
  melee[0].viseLigne = { debut: ligne.debut + 1, fin: ligne.fin + 1 };
  const q = poser(melee[0], avecBb);
  assert.equal(q.titre, "Bémols ou dièses ?");
  assert.deepEqual(q.reponses.map((x) => x.texte), ["Si♭ majeur", "Sol majeur", "Sans armure"]);
  assert.match(repondre(avecBb, melee, 0, "cle-G"), /^K:G$/m);
  const reprise = preparerDoutes([{ type: "armure", cle: "Eb", message: "Pas d'armure en début de ligne…", cibleLigne: { debut: abc.indexOf("c2 B2"), fin: abc.length } }]);
  const texte = abc.replace("K:C", "K:Eb");
  reprise[0].viseLigne = { debut: texte.indexOf("c2 B2"), fin: texte.length };
  assert.deepEqual(poser(reprise[0], texte).reponses.map((x) => x.texte), ["Oui, la même", "Non, sans armure"]);
  assert.equal(repondre(texte, reprise, 0, "sans").split("\n").pop(), "[K:C]c2 B2 A2 G2 |");
});

test("quand la page a été lue : des mots, pas une horloge", async () => {
  const { dateRelative } = await import("../app/atelier.js");
  const maintenant = Date.parse("2026-10-02T12:00:00Z");
  const il = (secondes) => new Date(maintenant - secondes * 1000).toISOString();
  assert.equal(dateRelative(il(20), maintenant), "à l'instant");
  assert.equal(dateRelative(il(125), maintenant), "il y a 2 min");
  assert.equal(dateRelative(il(3 * 3600), maintenant), "il y a 3 h");
  assert.match(dateRelative(il(3 * 86400), maintenant), /^le \d+ sept\.$/);
  assert.equal(dateRelative("", maintenant), "");
});
