/**
 * Un second avis de Claude sur un doute (H1) : la question part avec
 * exactement les réponses de `poser`, numérotées, et ce que le lecteur a
 * compris ; l'avis qui revient est vérifié contre elle. Sur les vrais doutes
 * de la page de mélodie, puis sur des questions faites à la main.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { lireFichier } from "../outils/lire.mjs";
import { poser, preparerDoutes } from "../app/doutes.js";
import { OPTIONS_AVIS, avisPossible, messageDoute, validerAvis } from "../app/claude-doute.js";

const MELODIE = "tests/pages/2026-09-30-melodie-standard.pdf";
const QUESTION = { type: "crochet", titre: "Croche ou noire ?", detail: "Il y a un petit trait au bout de la hampe : un crochet, ou un reste de geste ?", reponses: [{ id: "noire", texte: "Noire", fait: "La note est une noire." }, { id: "croche", texte: "Croche", fait: "La note devient une croche." }] };
const ok = (r) => { assert.equal(r.ok, true, r.raison); return r; };
const non = (r, motif) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.match(r.raison, motif); };

test("le message porte les réponses de poser, toutes, dans l'ordre, numérotées de 1", async () => {
  const r = await lireFichier(MELODIE);
  const doutes = preparerDoutes(r.doutes);
  assert.ok(doutes.length >= 4);
  for (const d of doutes) {
    const q = poser(d, r.abc);
    assert.ok(avisPossible(q), d.type);
    const abcMesure = d.vise ? r.abc.slice(d.vise.debut, d.vise.fin) : "";
    const m = messageDoute({ question: q, abcMesure, chiffrage: "4/4", armure: "C" });
    const numerotees = [...m.matchAll(/^(\d+)\. (.+?)(?: \(.*\))?$/gm)].map((x) => [Number(x[1]), x[2]]);
    assert.deepEqual(numerotees, q.reponses.map((x, i) => [i + 1, x.texte]), d.type);
    assert.ok(m.includes(`Question : ${q.titre}`), d.type);
    assert.ok(m.includes(`(de 1 à ${q.reponses.length})`), d.type);
    if (abcMesure) assert.ok(m.includes(abcMesure), d.type);
    assert.ok(m.length < 4000, `${d.type} : ${m.length}`);
  }
  // La mesure de onze croches : ses deux gestes, et ce qu'ils font.
  const q = poser(doutes[2], r.abc);
  const m = messageDoute({ question: q, abcMesure: r.abc.slice(doutes[2].vise.debut, doutes[2].vise.fin), chiffrage: "4/4", armure: "C" });
  for (const x of ["c2 c edc g2 z GG", "M:4/4", "K:C (sans altération à la clé)", "Question : Il manque une croche", "j'en compte 11 au lieu de 12",
    "1. Ajouter un silence (un silence de une croche complète la mesure)", "2. Allonger la dernière note (la dernière note est allongée)"]) {
    assert.ok(m.includes(x), `« ${x} » manque :\n${m}`);
  }
});

test("le message dit d'où vient la hauteur, ce qui est sûr, et la forme exacte de l'avis", () => {
  const compris = {
    notes: [{ nom: "la4", duree: "noire" }, { nom: "do5", duree: "croche", sure: false }, { nom: "fa5" }],
    sur: ["les barres de mesure", "trois têtes"],
    mesures: [{ quoi: "distance du point à sa tête", valeur: 2.345, seuil: 2.2 }, { quoi: "ignorée", valeur: NaN }],
  };
  const m = messageDoute({ question: QUESTION, abcMesure: "A2 c F", chiffrage: "3/4", armure: "Bb", compris });
  for (const x of ["M:3/4", "K:Bb (si♭ majeur)", "A2 c F", "L:1/8 : l'unité est la croche",
    "Têtes, de gauche à droite : 1. la4, noire ; 2. do5, croche (à vérifier) ; 3. fa5.",
    "Sûr : les barres de mesure ; trois têtes.", "distance du point à sa tête : 2,35 (seuil : 2,2)",
    "ne la conteste pas", "1. Noire (la note est une noire)", "2. Croche (la note devient une croche)",
    '{"reponse": <numéro ou null>, "confiance": <de 0 à 1>, "pourquoi": "<une phrase>"}', "ou null si tu ne peux pas trancher"]) {
    assert.ok(m.includes(x), `« ${x} » manque :\n${m}`);
  }
  assert.ok(!m.includes("ignorée"), "une mesure sans valeur ne part pas");
  // L'image : une phrase seulement si l'écran la joint, et les têtes « comme sur l'image ».
  assert.ok(!m.includes("image"));
  const avec = messageDoute({ question: QUESTION, compris, image: true });
  assert.ok(avec.includes("L'image jointe montre ce passage, recadré") && avec.includes("(numérotées comme sur l'image)"));
  assert.ok(avec.includes("(l'ABC de la mesure n'est pas disponible)"));
  // Ce que l'écran a déjà rédigé passe tel quel ; les caractères de contrôle, non.
  assert.ok(messageDoute({ question: QUESTION, compris: "Trois têtes,\u0000 une hampe." }).includes("Trois têtes, une hampe."));
  // Les options : jamais en cache, rien de ce que l'écran ajoute.
  assert.deepEqual({ ...OPTIONS_AVIS }, { modelTier: "default", cache: false });
  assert.ok(Object.isFrozen(OPTIONS_AVIS));
});

test("sans deux réponses fermées, il n'y a rien à demander", () => {
  assert.equal(avisPossible(QUESTION), true);
  for (const q of [null, "Croche ou noire ?", {}, { reponses: [] }, { reponses: [{ texte: "C'est vu" }] }, { reponses: [{ texte: "Noire" }, { texte: " " }] }, { reponses: [{ texte: "Noire" }, null] }]) {
    assert.equal(avisPossible(q), false, JSON.stringify(q));
  }
  assert.throws(() => messageDoute({ question: { titre: "À vérifier", reponses: [{ texte: "C'est vu" }] } }), /rien à demander/);
  non(validerAvis({ reponse: 1, confiance: 1 }, { reponses: [{ texte: "C'est vu" }] }), /deux réponses/);
});

test("un avis juste : le rang (compté de 0), la réponse choisie, la confiance, le pourquoi nettoyé", () => {
  const r = ok(validerAvis({ reponse: 2, confiance: 0.75, pourquoi: "  Le trait part de la hampe\nvers la droite : un crochet. " }, QUESTION));
  assert.equal(r.rang, 1);
  assert.equal(r.choix, QUESTION.reponses[1]);
  assert.equal(r.confiance, 0.75);
  assert.equal(r.pourquoi, "Le trait part de la hampe vers la droite : un crochet.");
  assert.deepEqual(ok(validerAvis({ reponse: 1, confiance: 0 }, QUESTION)).rang, 0);
  assert.equal(ok(validerAvis({ reponse: 1, confiance: 1, pourquoi: "mot ".repeat(200) }, QUESTION)).pourquoi.length <= 300, true);
  // Claude ne sait pas : c'est un avis, qu'on montre comme tel.
  const sansAvis = ok(validerAvis({ reponse: null, pourquoi: "Le trait est trop court pour trancher." }, QUESTION));
  assert.deepEqual([sansAvis.rang, sansAvis.choix, sansAvis.confiance], [null, null, 0]);
  assert.equal(ok(validerAvis({ reponse: null, confiance: 0.3 }, QUESTION)).confiance, 0.3);
});

test("un avis faux ou mal formé est refusé, jamais réparé", () => {
  for (const [avis, motif] of [
    [{ reponse: 0, confiance: 0.5 }, /de 1 à 2/], // compté de 0 alors qu'on a numéroté de 1
    [{ reponse: 3, confiance: 0.5 }, /de 1 à 2/],
    [{ reponse: 1.5, confiance: 0.5 }, /de 1 à 2/],
    [{ reponse: "2", confiance: 0.5 }, /de 1 à 2/],
    [{ reponse: true, confiance: 0.5 }, /de 1 à 2/],
    [{ reponse: "Croche", confiance: 0.5 }, /de 1 à 2/],
    [{ reponse: 2 }, /« confiance » manque/],
    [{ reponse: 2, confiance: 1.2 }, /de 0 à 1/],
    [{ reponse: 2, confiance: -0.1 }, /de 0 à 1/],
    [{ reponse: 2, confiance: 80 }, /de 0 à 1/], // un pourcentage
    [{ reponse: 2, confiance: "0.8" }, /de 0 à 1/],
    [{ reponse: 2, confiance: NaN }, /nombre invalide/],
    [{ reponse: 2, confiance: 0.8, pourquoi: 42 }, /pourquoi/],
    [{ reponse: 2, confiance: 0.8, hauteur: "sol4" }, /clé inattendue « hauteur »/],
    [{ confiance: 0.8 }, /« reponse » manque/],
    [JSON.parse('{"reponse": 2, "confiance": 0.8, "__proto__": {"x": 1}}'), /clé interdite/],
    [{ reponse: 2, confiance: 0.8, pourquoi: "x".repeat(30000) }, /texte trop long/],
    [null, /objet/], ["2", /objet/], [[2, 0.8], /objet/], [2, /objet/],
  ]) non(validerAvis(avis, QUESTION), motif);
});
