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
import { OPTIONS_AVIS, PAS_SU_REPONDRE, avisPossible, direAvis, entreeDoute, issueAvis, messageDoute, validerAvis } from "../app/claude-doute.js";

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
    "1. Ajouter un silence (un silence d'une croche complète la mesure)", "2. Allonger la dernière note (la dernière note est allongée)"]) {
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

// ------------------------------------------------------------------------
// Autour de la question (lot atelier) : ce qui part, ce qu'on fait d'un échec
// ------------------------------------------------------------------------

test("ce qui part avec la question : la mesure du doute, son chiffrage et son armure, et ce que le lecteur a compris", async () => {
  const r = await lireFichier(MELODIE);
  const doutes = preparerDoutes(r.doutes);
  // Le crochet de la 2ᵉ ligne : sa mesure entière, en 12/8 et mi♭ majeur, telle que l'ABC d'aujourd'hui l'écrit.
  const crochet = doutes.find((d) => d.type === "crochet");
  const tetes = [{ nom: "do5", ecart: 0.1 }, { nom: "do5", ecart: -0.45 }, { nom: "mi♭5" }];
  const e = entreeDoute({ doute: crochet, abc: r.abc, tetes });
  assert.equal(e.abcMesure, "c2 c2 edc g2 GG G");
  assert.deepEqual([e.chiffrage, e.armure], ["12/8", "Eb"]);
  assert.deepEqual(e.compris.notes, [{ nom: "do5" }, { nom: "do5", sure: false }, { nom: "mi♭5" }]);
  assert.deepEqual(e.compris.sur, ["3 têtes dans ce passage"]);
  // Le message qui en part : la mesure, l'armure dite en clair, les têtes numérotées comme sur l'image.
  const m = messageDoute({ question: poser(crochet, r.abc), ...e, image: true });
  for (const x of ["M:12/8", "K:Eb (mi♭ majeur)", "c2 c2 edc g2 GG G", "1. do5 ; 2. do5 (à vérifier) ; 3. mi♭5", "numérotées comme sur l'image", "ne la conteste pas"]) assert.ok(m.includes(x), `« ${x} » manque :\n${m}`);
  // Les vraies têtes du passage : la question dit laquelle elle vise (celle de la boîte du doute).
  const autour = r.lues[0].tetes.filter((t) => t.portee === crochet.portee && t.cx >= crochet.boite.x0 - 150 && t.cx <= crochet.boite.x1 + 150).sort((u, v) => u.cx - v.cx);
  const ec = entreeDoute({ doute: crochet, abc: r.abc, tetes: autour, interligne: r.cal.interligne });
  assert.equal(ec.compris.concernees.length, 1, JSON.stringify(ec.compris));
  const k = ec.compris.concernees[0];
  assert.ok(autour[k - 1].cx >= crochet.boite.x0 && autour[k - 1].cx <= crochet.boite.x1);
  assert.ok(messageDoute({ question: poser(crochet, r.abc), ...ec }).includes(`La question porte sur la tête ${k}.`));
  // Toutes les têtes visées (une mesure entière) : rien à préciser.
  assert.equal(entreeDoute({ doute: { ...crochet, boite: { x0: 0, y0: 0, x1: 5000, y1: 5000 } }, abc: r.abc, tetes: autour }).compris.concernees, undefined);
  // Une tête entre deux places : son écart, en interlignes, et ce qui la ferait changer de note.
  const hauteur = doutes.find((d) => d.type === "hauteur");
  assert.deepEqual(entreeDoute({ doute: hauteur, abc: r.abc }).compris.mesures, [{ quoi: "écart de la tête douteuse au milieu de sa place", valeur: hauteur.ecart / 2, seuil: 0.25 }]);
  const ligature = doutes.find((d) => d.type === "ligature");
  assert.deepEqual(entreeDoute({ doute: ligature, abc: r.abc }).compris.mesures.map((x) => [x.valeur, x.seuil]), [[ligature.ecart, 0.55]]);
  // Une armure ou un chiffrage : toute la ligne. Un doute qui ne vise plus rien : pas de mesure (le message le dit).
  const ligne = { type: "armure", cle: "Eb", viseLigne: { debut: r.abc.indexOf("[K:Eb]"), fin: r.abc.indexOf("\n", r.abc.indexOf("[K:Eb]")) } };
  assert.ok(entreeDoute({ doute: ligne, abc: r.abc }).abcMesure.startsWith("[K:Eb][M:12/8]G |:"));
  assert.equal(entreeDoute({ doute: { type: "crochet", vise: null }, abc: r.abc }).abcMesure, "");
  // Une tête sans nom (une donnée abîmée) ne part pas.
  assert.deepEqual(entreeDoute({ doute: crochet, abc: r.abc, tetes: [{ ecart: 0 }, null, { nom: "la4" }] }).compris.notes, [{ nom: "la4" }]);
});

test("un échec de sample : caché pour la visite, refait sans image, ou dit en clair ; « Arrêter » ne dit rien ; une erreur de Portée se traduit", () => {
  // Ce que rejette sample : un objet simple, avec son code (sample.d.ts).
  const echec = (code) => issueAvis({ code, message: "in English" });
  assert.deepEqual(echec("cancelled"), { message: null });
  for (const code of ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"]) {
    const i = echec(code);
    assert.equal(i.cacher, true, code);
    assert.match(i.message, /cachés jusqu'au prochain chargement/);
  }
  assert.match(echec("not_granted").message, /^Tu n'as pas autorisé Claude/);
  for (const code of ["images_unavailable", "image_rejected"]) assert.equal(echec(code).sansImage, true, code);
  assert.equal(echec("rate_limited").message, "Claude est très demandé : réessaie dans un moment.");
  assert.match(echec("session_expired").message, /reconnecte-toi/);
  assert.match(echec("refused").message, /préféré ne pas répondre/);
  for (const code of ["invalid_json", "empty_completion", "upstream_error", "invalid_request", "prompt_too_large", "un_code_inconnu", undefined]) assert.deepEqual(echec(code), { message: PAS_SU_REPONDRE }, String(code));
  assert.deepEqual(issueAvis(null), { message: PAS_SU_REPONDRE });
  // Une erreur de Portée (la page relue, le modèle chargé) : la traduction des erreurs, comme partout.
  assert.match(issueAvis(new TypeError("Failed to fetch")).message, /^Pas de connexion\. Réessaie quand le réseau sera revenu\.$/);
  assert.equal(issueAvis(Object.assign(new Error("Cette page a été écrite sur le modèle « Piano », que cette version de Portée ne connaît pas : mets l'appli à jour."), { code: "modele_inconnu" })).message,
    "Cette page a été écrite sur le modèle « Piano », que cette version de Portée ne connaît pas : mets l'appli à jour.");
  assert.equal(issueAvis(new Error("boom")).message, PAS_SU_REPONDRE);
});

test("l'avis se dit en mots : la réponse choisie et son assurance, ou « ne sait pas trancher »", () => {
  const avis = (rang, confiance) => ok(validerAvis({ reponse: rang === null ? null : rang + 1, confiance, pourquoi: "Le trait au bout de la hampe est net." }, QUESTION));
  assert.deepEqual(direAvis(avis(1, 0.7)), { titre: "Claude pense : Croche — assez sûr", pourquoi: "Le trait au bout de la hampe est net." });
  assert.deepEqual([0.95, 0.85, 0.65, 0.5, 0.2].map((c) => direAvis(avis(0, c)).titre.split(" — ")[1]), ["sûr", "sûr", "assez sûr", "hésitant", "très hésitant"]);
  assert.equal(direAvis(avis(null, 0.3)).titre, "Claude ne sait pas trancher.");
});
