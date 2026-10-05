/**
 * « Demander à Claude » sur une idée (H2) : ce qui part (un texte compact,
 * la forme exacte du JSON attendu), ce qui revient (vérifié, jamais réparé),
 * ce qui s'applique (une nouvelle idée, l'ancienne intacte), et les outils
 * de « libre », qui ne touchent qu'une copie. Les bonnes réponses, les
 * fausses, et les pièges qu'un modèle tend sans le vouloir.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as sq from "../app/sequence.js";
import { MESURES } from "../supabase/functions/portee-remarkable/conversation.js";
import { INTENTIONS, MESSAGE_REFUS, appliquer, chevauchement, demande, empechement, formeSure, nettoyer, outilsSurCopie, poserAccords, valider } from "../app/claude-idee.js";

/** Une idée de notes [d, l, h] (piste 0), avec ses accords. */
function idee(notes, { accords = [], ...options } = {}) {
  const seq = sq.nouvelleSequence(options);
  for (const [d, l, h] of notes) sq.poser(seq, 0, { d, l, h });
  seq.accords = accords.map(([d, nom]) => ({ d, nom }));
  return seq;
}
// La mineur, 3/4 : trois mesures, trois accords.
const VALSE = () => idee([[0, 4, 69], [4, 2, 71], [6, 2, 72], [8, 4, 76], [12, 8, 74], [20, 4, 72], [24, 12, 69]], { tempo: 96, mesure: [3, 4], tonalite: "Am", accords: [[0, "Am"], [12, "Dm"], [24, "E7"]] });
const fige = (x) => JSON.parse(JSON.stringify(x));
const ok = (r) => { assert.equal(r.ok, true, r.raison); return r.proposition; };
const non = (r, motif) => { assert.equal(r.ok, false, JSON.stringify(r.proposition)); assert.match(r.raison, motif); };

// ------------------------------------------------------------------------
// Ce qui part
// ------------------------------------------------------------------------

test("la demande : tempo, mesure, tonalité, notes nommées, accords, et la forme du JSON", () => {
  const seq = VALSE();
  const { input, opts } = demande("accords", seq);
  assert.equal(typeof input, "string");
  assert.deepEqual(opts, { modelTier: "default", cache: false }); // ni signal ni onText : l'écran les ajoute
  for (const attendu of ["Tempo : 96", "Mesure : 3/4 (12 pas par mesure : 3 temps de 4 pas)", "Tonalité : la mineur (Am)", "3 mesures",
    "1.1 Am, 2.1 Dm, 3.1 E7", "m1 : 0 4 69 la4 ; 4 2 71 si4 ; 6 2 72 do5 ; 8 4 76 mi5", "m3 : 24 12 69 la4",
    "toute l'idée (les mesures 1 à 3)", "de 1 à 3", '{"accords": [{"mesure": 1, "temps": 1, "nom": "Am"}], "pourquoi": "…"}', "sans numéros MIDI"]) {
    assert.ok(input.includes(attendu), `« ${attendu} » manque :\n${input}`);
  }
  // Un titre se demande au modèle rapide ; le reste, au modèle de tous les jours. Jamais en cache :
  // une réponse refusée ici serait rejouée pendant cinq minutes à chaque « réessaie ».
  assert.deepEqual(demande("titre", seq).opts, { modelTier: "quick", cache: false });
  for (const g of ["suite", "libre"]) assert.equal(demande(g, seq, { phrase: "Plus triste" }).opts.modelTier, "default");
  assert.equal(demande("variation", seq, { intention: "plus calme" }).opts.cache, false);
});

test("chaque genre dit ce qu'il attend : la place, les bornes, l'exemple", () => {
  const seq = VALSE();
  const ids = seq.pistes[0].notes.slice(1, 4).map((n) => n.id);
  const suite = demande("suite", seq).input;
  for (const x of ["les mesures 4 et 5", "0 = le premier temps de la mesure 4", "debut + duree ≤ 24", "Hauteurs de 57 (la3) à 88 (mi6)", '{"notes": [{"debut": 0, "duree": 4, "hauteur": 69}]']) assert.ok(suite.includes(x), x);
  const variation = demande("variation", seq, { selection: { piste: 0, ids: new Set(ids) }, intention: "plus ornée" }).input;
  for (const x of ["4 2 71 si4* ; 6 2 72 do5* ; 8 4 76 mi5*", "0 4 69 la4 ;", "du pas 4 au pas 12 (la mesure 1)", "plus ornée : des notes de passage", "debut ≥ 4, debut + duree ≤ 12", "les autres ne bougent pas"]) assert.ok(variation.includes(x), x);
  const titre = demande("titre", seq, { titre: "Idée du 5 octobre", etiquettes: ["valse"], etiquettesConnues: ["nuit", "piano"] }).input;
  for (const x of ["« Idée du 5 octobre »", "Ses étiquettes actuelles : valse.", "reprends-les si elles conviennent) : nuit, piano", '{"titre": "…", "etiquettes": ["…"]}']) assert.ok(titre.includes(x), x);
  const libre = demande("libre", seq, { phrase: "  Rends la fin\nplus triste " }).input;
  for (const x of ["« Rends la fin plus triste »", "celles que tu ne changes pas comprises", "debut + duree ≤ 84", "rends les notes telles quelles"]) assert.ok(libre.includes(x), x);
  // Avec des outils : ils partent dans les options, et la réponse ne dit que ce qui a été fait.
  const { outils } = outilsSurCopie(seq, sq);
  const avec = demande("libre", seq, { phrase: "Rends la fin plus triste", outils });
  assert.equal(avec.opts.tools, outils);
  assert.ok(avec.input.includes('{"pourquoi": "…"}') && avec.input.includes("une copie de l'idée"));
});

test("les noms de notes et la mesure en pas sont ceux de sequence.js (copiés ici, ils ne doivent pas s'écarter)", () => {
  for (const k of sq.TONALITES) {
    const seq = sq.nouvelleSequence({ tonalite: k });
    for (let h = 21; h <= 108; h++) seq.pistes[0].notes.push({ id: h, d: (h - 21) * 4, l: 4, h });
    seq.suivant = 109;
    const { input } = demande("titre", seq);
    assert.ok(input.includes(`Tonalité : ${sq.nomTonalite(k).toLowerCase()} (${k})`), k);
    const lus = new Map([...input.matchAll(/(\d+) 4 (\d+) (\S+)/g)].map((m) => [Number(m[2]), m[3]]));
    for (let h = 21; h <= 108; h++) assert.equal(lus.get(h), sq.nomNote(h, k), `${h} en ${k}`);
  }
  for (const m of MESURES) {
    const mesure = m.split("/").map(Number);
    const seq = idee([[0, 1, 60], [100, 1, 62]], { mesure });
    const ppm = sq.pasParMesure(seq), ppt = sq.pasParTemps(seq);
    const { input } = demande("accords", seq);
    assert.ok(input.includes(`(${ppm} pas par mesure : ${ppm / ppt} temps de ${ppt} pas)`), m);
    assert.ok(input.includes(`${sq.nbMesures(seq)} mesures`), m);
  }
});

test("une idée de 64 mesures, une double croche à chaque pas, tient sous 24 000 caractères", () => {
  // 1 024 notes : une idée plus dense que tout ce qu'Adrien note au téléphone.
  // 24 000 caractères, c'est environ 8 000 jetons : une petite part de ce que
  // Claude lit d'un coup, et dix fois moins que les 256 Kio permis par `sample`.
  const notes = Array.from({ length: 64 * 16 }, (_, i) => [i, 1, 60 + ((i * 5) % 24)]);
  const seq = idee(notes, { accords: Array.from({ length: 64 }, (_, m) => [m * 16, m % 2 ? "G7" : "C"]) });
  assert.equal(sq.nbMesures(seq), 64);
  for (const g of ["accords", "suite", "variation", "titre", "libre"]) {
    const { input } = demande(g, seq, { intention: "plus calme", phrase: "Plus calme" });
    assert.ok(input.length < 24000, `${g} : ${input.length}`);
    assert.ok(Buffer.byteLength(input) < 256 * 1024);
  }
  // Au-delà de 2 000 notes, on ne demande pas : mieux vaut un passage.
  const enorme = idee(Array.from({ length: 2100 }, (_, i) => [i, 1, 60 + (i % 12)]));
  assert.match(empechement("accords", enorme), /trop de notes/);
  assert.throws(() => demande("accords", enorme), /trop de notes/);
});

test("ce qui empêche de demander se dit en français, avant d'envoyer quoi que ce soit", () => {
  const vide = sq.nouvelleSequence();
  assert.match(empechement("accords", vide), /Écris d'abord/);
  assert.match(empechement("suite", vide), /Écris d'abord/);
  assert.match(empechement("titre", vide), /Écris d'abord/);
  assert.match(empechement("variation", VALSE()), /Intention inconnue/);
  assert.match(empechement("variation", VALSE(), { intention: "toString" }), /Intention inconnue/); // pas un nom hérité
  assert.match(empechement("variation", VALSE(), { intention: "__proto__" }), /Intention inconnue/);
  assert.match(empechement("libre", VALSE(), { phrase: "   " }), /une phrase/);
  assert.match(empechement("libre", VALSE(), { phrase: "x".repeat(501) }), /trop longue/);
  assert.match(empechement("chanson", VALSE()), /Genre inconnu/);
  assert.match(empechement("variation", VALSE(), { intention: "plus calme", selection: { piste: 0, ids: [999] } }), /plus dans l'idée/);
  assert.equal(empechement("libre", vide, { phrase: "Écris-moi une mélodie en la mineur" }), null);
  assert.equal(empechement("variation", VALSE(), { intention: "en mineur", selection: { piste: 0, ids: new Set() } }), null); // rien de choisi : toute la piste
  assert.equal(Object.keys(INTENTIONS).length, 4);
  assert.match(MESSAGE_REFUS, /réessaie/);
});

// ------------------------------------------------------------------------
// Ce qui revient : les accords
// ------------------------------------------------------------------------

test("accords : une bonne réponse devient des positions en pas", () => {
  const seq = VALSE();
  const p = ok(valider("accords", { accords: [{ mesure: 3, temps: 1, nom: "E7" }, { mesure: 1, temps: 1, nom: " Am " }, { mesure: 2, temps: 1, nom: "F" }, { mesure: 2, temps: 3, nom: "G7" }], pourquoi: "  Une cadence\n\nsimple. " }, seq));
  assert.deepEqual(p.accords, [{ d: 0, nom: "Am" }, { d: 12, nom: "F" }, { d: 20, nom: "G7" }, { d: 24, nom: "E7" }]);
  assert.deepEqual([p.debut, p.fin, p.pourquoi], [0, 36, "Une cadence simple."]);
  // Sans « pourquoi », la proposition reste bonne : ce n'est pas de la musique.
  assert.equal(ok(valider("accords", { accords: [{ mesure: 1, temps: 1, nom: "Am" }] }, seq)).pourquoi, "");
  // Sur une sélection : seulement les mesures où elle est.
  const ids = seq.pistes[0].notes.filter((n) => n.d >= 12 && n.d < 24).map((n) => n.id);
  const sel = { selection: { piste: 0, ids } };
  assert.ok(demande("accords", seq, sel).input.includes("la mesure 2, où sont les notes choisies"));
  assert.deepEqual(ok(valider("accords", { accords: [{ mesure: 2, temps: 1, nom: "Bdim" }] }, seq, sel)).accords, [{ d: 12, nom: "Bdim" }]);
  non(valider("accords", { accords: [{ mesure: 1, temps: 1, nom: "Am" }] }, seq, sel), /mesure de 2 à 2/);
});

test("accords : ce qui ne se lit pas, ne tombe pas sur un temps ou déborde est refusé", () => {
  const seq = VALSE();
  const un = (a) => valider("accords", { accords: [a] }, seq);
  non(un({ mesure: 1, temps: 1, nom: "H7" }), /illisible/);
  non(un({ mesure: 1, temps: 1, nom: "B♭" }), /illisible/); // on a demandé « b », pas « ♭ »
  non(un({ mesure: 1, temps: 1, nom: "Cm7b9" }), /illisible/);
  non(un({ mesure: 1, temps: 1, nom: "" }), /illisible/);
  non(un({ mesure: 1, temps: 1, nom: 7 }), /illisible/);
  non(un({ mesure: 0, temps: 1, nom: "Am" }), /mesure de 1 à 3/);
  non(un({ mesure: 4, temps: 1, nom: "Am" }), /mesure de 1 à 3/);
  non(un({ mesure: 1, temps: 4, nom: "Am" }), /temps de 1 à 3/);
  non(un({ mesure: 1, temps: 1.5, nom: "Am" }), /temps/);
  non(un({ mesure: "1", temps: 1, nom: "Am" }), /mesure/);
  non(un({ mesure: 1, nom: "Am" }), /« temps » manque/);
  non(un({ mesure: 1, temps: 1, nom: "Am", debut: 0 }), /clé inattendue « debut »/);
  non(valider("accords", { accords: [{ mesure: 1, temps: 1, nom: "Am" }, { mesure: 1, temps: 2, nom: "F" }, { mesure: 1, temps: 3, nom: "G" }] }, seq), /plus de deux/);
  non(valider("accords", { accords: [{ mesure: 1, temps: 1, nom: "Am" }, { mesure: 1, temps: 1, nom: "F" }] }, seq), /même temps/);
  non(valider("accords", { accords: [] }, seq), /non vide/);
  non(valider("accords", { accords: Array.from({ length: 7 }, (_, i) => ({ mesure: 1 + (i % 3), temps: 1, nom: "C" })) }, seq), /6 au plus/);
  non(valider("accords", { accords: "Am F E7" }, seq), /liste/);
  non(valider("accords", { accords: [{ mesure: 1, temps: 1, nom: "Am" }], pourquoi: 3 }, seq), /pourquoi/);
  non(valider("accords", { accords: [{ mesure: 1, temps: 1, nom: "Am" }], tonalite: "Am" }, seq), /clé inattendue/);
});

test("ce qui n'a pas la forme d'une réponse est refusé avant tout examen", () => {
  const seq = VALSE();
  for (const [reponse, motif] of [
    [null, /objet/], ["Am F E7", /objet/], [42, /objet/], [[{ mesure: 1, temps: 1, nom: "Am" }], /objet/], [undefined, /valeur inattendue/],
    [{ accords: [{ mesure: NaN, temps: 1, nom: "Am" }] }, /nombre invalide/],
    [{ accords: [{ mesure: Infinity, temps: 1, nom: "Am" }] }, /nombre invalide/],
    [JSON.parse('{"__proto__": {"admin": true}, "accords": [{"mesure": 1, "temps": 1, "nom": "Am"}]}'), /clé interdite « __proto__ »/],
    [JSON.parse('{"accords": [{"mesure": 1, "temps": 1, "nom": "Am", "constructor": {"prototype": 1}}]}'), /clé interdite/],
    [{ accords: new Array(60000).fill({ mesure: 1, temps: 1, nom: "Am" }) }, /trop grande|trop longue/],
    [{ accords: [{ mesure: 1, temps: 1, nom: "A".repeat(30000) }] }, /texte trop long/],
    [{ accords: [{ mesure: 1, temps: 1, nom: "Am", x: new Date() }] }, /objet inattendu/],
    [{ accords: [{ mesure: 1, temps: 1, nom: "Am", x: () => 1 }] }, /valeur inattendue/],
  ]) non(valider("accords", reponse, seq), motif);
  let profond = { accords: [] };
  for (let i = 0; i < 20; i++) profond = { x: profond };
  assert.match(formeSure(profond), /imbriquée/);
  // Le prototype de l'objet n'a pas bougé.
  assert.equal({}.admin, undefined);
});

// ------------------------------------------------------------------------
// Suite, variation, libre : des notes
// ------------------------------------------------------------------------

test("suite : deux mesures après la fin, debut compté depuis la fin", () => {
  const seq = VALSE();
  const p = ok(valider("suite", { notes: [{ debut: 0, duree: 4, hauteur: 71 }, { debut: 4, duree: 8, hauteur: 72 }, { debut: 12, duree: 12, hauteur: 69 }, { debut: 12, duree: 12, hauteur: 64 }], pourquoi: "Une fin." }, seq));
  assert.deepEqual(p.notes, [{ d: 36, l: 4, h: 71 }, { d: 40, l: 8, h: 72 }, { d: 48, l: 12, h: 64 }, { d: 48, l: 12, h: 69 }]);
  assert.deepEqual([p.piste, p.ids], [0, []]);
  const une = (n) => valider("suite", { notes: [n] }, seq);
  non(une({ debut: 0, duree: 0, hauteur: 69 }), /durée nulle/);
  non(une({ debut: 0, duree: -4, hauteur: 69 }), /durée nulle/);
  non(une({ debut: 0, duree: 2.5, hauteur: 69 }), /entiers/);
  non(une({ debut: -1, duree: 4, hauteur: 69 }), /hors de la place/);
  non(une({ debut: 20, duree: 8, hauteur: 69 }), /hors de la place permise \(pas 0 à 24\)/);
  non(une({ debut: 0, duree: 4, hauteur: 20 }), /hors du clavier/);
  non(une({ debut: 0, duree: 4, hauteur: 109 }), /hors du clavier/);
  non(une({ debut: 0, duree: 4, hauteur: 40 }), /tessiture \(57 à 88\)/); // une octave mal comptée
  non(une({ debut: 0, duree: 4, hauteur: "69" }), /entiers/);
  non(une({ debut: 0, duree: 4 }), /« hauteur » manque/);
  non(une({ debut: 0, duree: 4, hauteur: 69, velocite: 80 }), /clé inattendue « velocite »/);
  non(une({ debut: 0, fin: 4, hauteur: 69 }), /clé inattendue « fin »/);
  non(valider("suite", { notes: [{ debut: 0, duree: 8, hauteur: 69 }, { debut: 4, duree: 4, hauteur: 69 }] }, seq), /se chevauchent/);
  non(valider("suite", { notes: [] }, seq), /non vide/);
  non(valider("suite", { notes: Array.from({ length: 97 }, (_, i) => ({ debut: i % 24, duree: 1, hauteur: 60 + (i % 20) })) }, seq), /96 notes au plus/);
});

test("variation : la sélection remplacée, dans son étendue, sans heurter les notes qui restent", () => {
  const seq = VALSE();
  const ids = seq.pistes[0].notes.slice(1, 4).map((n) => n.id); // si4 do5 mi5, pas 4 à 12
  const options = { selection: { piste: 0, ids }, intention: "plus ornée" };
  const p = ok(valider("variation", { notes: [{ debut: 4, duree: 1, hauteur: 71 }, { debut: 5, duree: 1, hauteur: 72 }, { debut: 6, duree: 2, hauteur: 74 }, { debut: 8, duree: 4, hauteur: 76 }] }, seq, options));
  assert.deepEqual(p.ids, ids);
  non(valider("variation", { notes: [{ debut: 3, duree: 2, hauteur: 71 }] }, seq, options), /hors de la place permise \(pas 4 à 12\)/);
  non(valider("variation", { notes: [{ debut: 10, duree: 4, hauteur: 76 }] }, seq, options), /hors de la place/);
  // La même que l'original : rien à écouter. Le refus garde le « pourquoi » de Claude.
  const pareil = valider("variation", { notes: [{ debut: 4, duree: 2, hauteur: 71 }, { debut: 6, duree: 2, hauteur: 72 }, { debut: 8, duree: 4, hauteur: 76 }], pourquoi: "Elle est déjà parfaite." }, seq, options);
  non(pareil, /rien changé/);
  assert.equal(pareil.pourquoi, "Elle est déjà parfaite.");
  // Toute la piste : de 0 à la fin de l'idée ; une note qui chevauche une note restée, refusée.
  const tout = { intention: "plus calme" };
  ok(valider("variation", { notes: [{ debut: 0, duree: 12, hauteur: 69 }, { debut: 12, duree: 12, hauteur: 74 }, { debut: 24, duree: 12, hauteur: 69 }] }, seq, tout));
  non(valider("variation", { notes: [{ debut: 24, duree: 13, hauteur: 69 }] }, seq, tout), /hors de la place/);
  const deux = sq.cloner(seq);
  deux.pistes[0].notes.push({ id: 50, d: 10, l: 1, h: 74 }); // un ré5 dans l'étendue, mais pas choisi : il reste
  deux.suivant = 51;
  non(valider("variation", { notes: [{ debut: 4, duree: 8, hauteur: 74 }] }, deux, options), /deux notes de hauteur 74 se chevauchent/);
  ok(valider("variation", { notes: [{ debut: 4, duree: 6, hauteur: 74 }] }, deux, options)); // elle finit où il commence
});

test("libre sans outils : toute la piste, jusqu'au double de l'idée, deux octaves de marge", () => {
  const seq = VALSE();
  const o = { phrase: "Une octave plus haut, et une fin" };
  const notes = seq.pistes[0].notes.map((n) => ({ debut: n.d, duree: n.l, hauteur: n.h + 12 }));
  const p = ok(valider("libre", { notes: [...notes, { debut: 36, duree: 12, hauteur: 93 }], pourquoi: "Plus haut." }, seq, o));
  assert.equal(p.notes.length, 8);
  non(valider("libre", { notes: [{ debut: 80, duree: 8, hauteur: 69 }] }, seq, o), /hors de la place permise \(pas 0 à 84\)/);
  non(valider("libre", { notes: [{ debut: 0, duree: 8, hauteur: 101 }] }, seq, o), /tessiture/);
  const pareil = valider("libre", { notes: seq.pistes[0].notes.map((n) => ({ debut: n.d, duree: n.l, hauteur: n.h })), pourquoi: "Je ne sais pas faire une valse en notes." }, seq, { phrase: "Fais-en une valse" });
  non(pareil, /rien changé/);
  assert.match(pareil.pourquoi, /valse/);
});

test("titre : nettoyé, borné, quelques étiquettes courtes", () => {
  const seq = VALSE();
  const p = ok(valider("titre", { titre: "  Pluie​ d'octobre\n ", etiquettes: ["Mélancolique", "valse", "VALSE"] }, seq));
  assert.deepEqual([p.titre, p.etiquettes], ["Pluie d'octobre", ["mélancolique", "valse"]]);
  assert.deepEqual(ok(valider("titre", { titre: "Averse" }, seq)).etiquettes, []);
  non(valider("titre", { titre: "x".repeat(61) }, seq), /60 caractères/);
  non(valider("titre", { titre: " \u0007 " }, seq), /vide/);
  non(valider("titre", { titre: 12 }, seq), /texte/);
  non(valider("titre", { etiquettes: ["a"] }, seq), /« titre » manque/);
  non(valider("titre", { titre: "Averse", etiquettes: "pluie" }, seq), /liste/);
  non(valider("titre", { titre: "Averse", etiquettes: ["a", "b", "c", "d", "e", "f"] }, seq), /5 au plus/);
  non(valider("titre", { titre: "Averse", etiquettes: ["x".repeat(31)] }, seq), /30 caractères/);
  non(valider("titre", { titre: "Averse", etiquettes: [""] }, seq), /vide/);
  non(valider("titre", { titre: "Averse", etiquettes: [3] }, seq), /texte/);
  assert.equal(nettoyer("a‮bc\u0000d"), "abcd"); // ni retournement d'écriture, ni caractère nul
  assert.equal(nettoyer(" ligne 1 \r\n\r\n\r\n ligne\t2 ", { lignes: true }), "ligne 1\n\nligne 2");
});

test("le pourquoi est montré tel quel, nettoyé, et coupé s'il est trop long", () => {
  const seq = VALSE();
  const p = ok(valider("accords", { accords: [{ mesure: 1, temps: 1, nom: "Am" }], pourquoi: "mot ".repeat(200) }, seq));
  assert.ok(p.pourquoi.length <= 400 && p.pourquoi.endsWith("…"), p.pourquoi);
});

// ------------------------------------------------------------------------
// Appliquer : une nouvelle idée, l'ancienne intacte
// ------------------------------------------------------------------------

test("appliquer ne modifie jamais l'idée reçue, et rend une idée neuve", () => {
  const seq = VALSE();
  const avant = fige(seq);
  const ids = seq.pistes[0].notes.slice(1, 4).map((n) => n.id);
  const sel = { selection: { piste: 0, ids }, intention: "plus ornée" };
  const cas = [
    ["accords", { accords: [{ mesure: 2, temps: 1, nom: "F" }] }, {}],
    ["suite", { notes: [{ debut: 0, duree: 12, hauteur: 69 }] }, {}],
    ["variation", { notes: [{ debut: 4, duree: 4, hauteur: 72 }, { debut: 8, duree: 4, hauteur: 74 }] }, sel],
    ["libre", { notes: [{ debut: 0, duree: 36, hauteur: 69 }] }, { phrase: "Une seule note" }],
  ];
  for (const [genre, reponse, options] of cas) {
    const p = ok(valider(genre, reponse, seq, options));
    const neuve = appliquer(genre, seq, p, options);
    assert.notEqual(neuve, seq);
    assert.notEqual(neuve.pistes, seq.pistes);
    assert.deepEqual(seq, avant, genre);
    // Une idée que sequence.js sait écrire (les ids restent uniques, `suivant` devant eux).
    const tous = neuve.pistes.flatMap((x) => x.notes.map((n) => n.id));
    assert.equal(new Set(tous).size, tous.length, genre);
    assert.ok(tous.every((id) => id < neuve.suivant), genre);
    assert.ok(sq.ecrireAbc(neuve).abc.startsWith("X:1"), genre);
  }
  assert.throws(() => appliquer("suite", seq, { genre: "accords" }), /genre « suite »/);
});

test("appliquer des accords : ceux des mesures visées remplacés, l'harmonie d'après gardée, les accords plaqués en route", () => {
  const seq = idee([[0, 16, 60], [16, 16, 62], [32, 16, 64], [48, 16, 65]], { accords: [[0, "C"], [32, "Am"]] });
  // Mesure 2 seulement (une sélection) : la mesure 3 gardait le do (il sonnait jusqu'à la mesure 3)…
  const sel = { selection: { piste: 0, ids: [seq.pistes[0].notes[1].id] } };
  const p = ok(valider("accords", { accords: [{ mesure: 2, temps: 1, nom: "G7" }] }, seq, sel));
  assert.deepEqual(appliquer("accords", seq, p, sel).accords, [{ d: 0, nom: "C" }, { d: 16, nom: "G7" }, { d: 32, nom: "Am" }]);
  // … et sans accord à la mesure 3, celui qui sonnait y est redit, pour que la suite ne change pas.
  const sans = idee([[0, 16, 60], [16, 16, 62], [32, 16, 64]], { accords: [[0, "C"]] });
  const selSans = { selection: { piste: 0, ids: [sans.pistes[0].notes[1].id] } };
  const q = ok(valider("accords", { accords: [{ mesure: 2, temps: 1, nom: "G7" }] }, sans, selSans));
  assert.deepEqual(appliquer("accords", sans, q, selSans).accords, [{ d: 0, nom: "C" }, { d: 16, nom: "G7" }, { d: 32, nom: "C" }]);
  // Toute l'idée : tout est remplacé ; le premier accord met les accords plaqués en route.
  assert.equal(seq.accompagnement, "aucun");
  const r = appliquer("accords", seq, ok(valider("accords", { accords: [{ mesure: 1, temps: 1, nom: "F" }, { mesure: 3, temps: 3, nom: "C/E" }] }, seq)));
  assert.deepEqual(r.accords, [{ d: 0, nom: "F" }, { d: 40, nom: "C/E" }]);
  assert.equal(r.accompagnement, "plaque");
  const arpege = { ...sq.cloner(seq), accompagnement: "arpege" };
  assert.equal(appliquer("accords", arpege, ok(valider("accords", { accords: [{ mesure: 1, temps: 1, nom: "F" }] }, arpege))).accompagnement, "arpege");
  // poserAccords sert aussi ailleurs (suggestions.js) : jusqu'à la fin, rien n'est redit.
  const s = sq.cloner(seq);
  poserAccords(s, [{ d: 0, nom: "Dm" }], 0, Infinity);
  assert.deepEqual(s.accords, [{ d: 0, nom: "Dm" }]);
});

test("appliquer suite et variation : notes posées, numéros neufs, rien d'autre ne bouge", () => {
  const seq = VALSE();
  const suite = appliquer("suite", seq, ok(valider("suite", { notes: [{ debut: 0, duree: 4, hauteur: 71 }, { debut: 4, duree: 8, hauteur: 69 }] }, seq)));
  assert.deepEqual(suite.pistes[0].notes.slice(-2).map((n) => [n.d, n.l, n.h]), [[36, 4, 71], [40, 8, 69]]);
  assert.equal(sq.nbMesures(suite), 4); // une mesure de 3/4 de plus
  assert.deepEqual(suite.accords, seq.accords);
  const ids = seq.pistes[0].notes.slice(1, 4).map((n) => n.id);
  const options = { selection: { piste: 0, ids }, intention: "plus calme" };
  const v = appliquer("variation", seq, ok(valider("variation", { notes: [{ debut: 4, duree: 8, hauteur: 72 }] }, seq, options)), options);
  assert.deepEqual(v.pistes[0].notes.map((n) => [n.d, n.l, n.h]), [[0, 4, 69], [4, 8, 72], [12, 8, 74], [20, 4, 72], [24, 12, 69]]);
  assert.ok(!v.pistes[0].notes.some((n) => ids.includes(n.id)));
});

test("appliquer un titre : le titre, et les étiquettes proposées ajoutées aux siennes", () => {
  const seq = VALSE();
  const p = ok(valider("titre", { titre: "Pluie d'octobre", etiquettes: ["valse", "nuit"] }, seq));
  assert.deepEqual(appliquer("titre", seq, p, { etiquettes: ["valse", "piano"] }), { titre: "Pluie d'octobre", etiquettes: ["valse", "piano", "nuit"] });
});

// ------------------------------------------------------------------------
// « libre » avec des outils : une copie, les gestes de sequence.js
// ------------------------------------------------------------------------

test("les outils ont la forme de sample.d.ts, et des descriptions et schémas dans les bornes", () => {
  const { outils, copie } = outilsSurCopie(VALSE(), sq);
  assert.deepEqual(outils.map((o) => o.name), ["transposer", "etirer", "a_l_envers", "miroir", "recaler", "poser_accords", "ajouter_notes", "effacer_notes"]);
  for (const o of outils) {
    assert.match(o.name, /^[A-Za-z0-9_-]{1,128}$/);
    assert.ok(o.description.length > 40 && Buffer.byteLength(o.description) <= 1024, o.name);
    assert.equal(o.inputSchema.type, "object", o.name);
    assert.equal(o.inputSchema.additionalProperties, false, o.name);
    assert.ok(!("required" in o.inputSchema) || o.inputSchema.required.length > 0, o.name); // pas de « required » vide
    assert.ok(Buffer.byteLength(JSON.stringify(o.inputSchema)) <= 4096, o.name);
    assert.equal(typeof o.execute, "function");
  }
  assert.equal(typeof copie, "function");
  assert.equal(outilsSurCopie(VALSE(), sq, { max: 3 }).outils.length, 3);
  assert.throws(() => outilsSurCopie(VALSE(), {}), /geste « transposer »/);
});

test("les outils travaillent sur une copie, avec les gestes de sequence.js, et rendent peu de chose", () => {
  const seq = VALSE();
  const avant = fige(seq);
  const { outils, copie } = outilsSurCopie(seq, sq);
  const outil = (nom) => outils.find((o) => o.name === nom);
  const r = outil("transposer").execute({ demiTons: 12, debut: 24 }, { signal: new AbortController().signal });
  assert.deepEqual(r, { fait: "1 note montée de 12 demi-tons", notes: 7, mesures: 3 });
  assert.ok(JSON.stringify(r).length < 200);
  // Le même geste que sequence.js, fait à la main sur une autre copie.
  const attendu = sq.cloner(seq);
  sq.transposer(attendu, 0, [attendu.pistes[0].notes[6].id], 12);
  assert.deepEqual(copie(), attendu);
  outil("etirer").execute({ facteur: 2, debut: 0, fin: 12 });
  sq.etirer(attendu, 0, attendu.pistes[0].notes.filter((n) => n.d < 12).map((n) => n.id), 2);
  assert.deepEqual(copie(), attendu);
  outil("a_l_envers").execute({ piste: 1 });
  sq.retrograder(attendu, 0, attendu.pistes[0].notes.map((n) => n.id));
  outil("miroir").execute({});
  sq.renverser(attendu, 0, attendu.pistes[0].notes.map((n) => n.id));
  outil("recaler").execute({ grille: 4 });
  sq.recaler(attendu, 0, attendu.pistes[0].notes.map((n) => n.id), 4);
  assert.deepEqual(copie(), attendu);
  outil("poser_accords").execute({ accords: [{ mesure: 2, temps: 1, nom: "F" }] });
  assert.deepEqual(copie().accords.find((a) => a.d === 12), { d: 12, nom: "F" });
  outil("ajouter_notes").execute({ notes: [{ debut: 80, duree: 4, hauteur: 60 }] });
  assert.ok(copie().pistes[0].notes.some((n) => n.d === 80 && n.h === 60));
  assert.match(outil("effacer_notes").execute({ debut: 80, hauteurs: [60] }).fait, /1 note effacée/);
  // L'idée reçue n'a pas bougé ; copie() rend un état qu'on peut garder (une copie de la copie).
  assert.deepEqual(seq, avant);
  const c = copie();
  c.pistes[0].notes = [];
  assert.ok(copie().pistes[0].notes.length > 0);
});

test("poser_accords : mesure après mesure, ce que Claude pose sonne jusqu'à son accord suivant", () => {
  const seq = idee([[0, 16, 60], [16, 16, 62], [32, 16, 64]], { accords: [[0, "C"]] });
  const { outils, copie } = outilsSurCopie(seq, sq);
  // Donnés dans le désordre : le fa de la mesure 1 tient jusqu'au sol 7 du 3ᵉ temps de la mesure 2,
  // puis le do d'avant revient à la mesure 3, qu'on n'a pas demandé de changer.
  outils.find((o) => o.name === "poser_accords").execute({ accords: [{ mesure: 2, temps: 3, nom: "G7" }, { mesure: 1, temps: 1, nom: "F" }] });
  assert.deepEqual(copie().accords, [{ d: 0, nom: "F" }, { d: 24, nom: "G7" }, { d: 32, nom: "C" }]);
  assert.equal(copie().accompagnement, "plaque");
});

test("une entrée invalide lève une erreur en français ; un geste qui abîmerait la copie est défait", () => {
  const seq = VALSE();
  const { outils, copie } = outilsSurCopie(seq, sq);
  const outil = (nom) => outils.find((o) => o.name === nom);
  for (const [nom, entree, motif] of [
    ["transposer", { demiTons: 0 }, /sauf 0/],
    ["transposer", { demiTons: "12" }, /demiTons/],
    ["transposer", {}, /« demiTons » manque/],
    ["transposer", { demiTons: 2, octave: 1 }, /clé inattendue « octave »/],
    ["transposer", { demiTons: 2, piste: 2 }, /piste : de 1 à 1/],
    ["transposer", { demiTons: 2, debut: 40 }, /Aucune note/],
    ["etirer", { facteur: 3 }, /2 ou 0.5/],
    ["recaler", { grille: 3 }, /1, 2, 4 ou 8/],
    ["poser_accords", { accords: [{ mesure: 1, temps: 1, nom: "Do" }] }, /ne se lit pas/],
    ["poser_accords", { accords: [{ mesure: 1, temps: 9, nom: "C" }] }, /temps : de 1 à 3/],
    ["poser_accords", { accords: [] }, /de 1 à 64/],
    ["ajouter_notes", { notes: [{ debut: 0, duree: 4, hauteur: 69 }] }, /se chevauchent/],
    ["ajouter_notes", { notes: [{ debut: 0, duree: 0, hauteur: 30 }] }, /durée nulle/],
    ["ajouter_notes", { notes: [{ debut: 0, duree: 4, hauteur: 200 }] }, /hors du clavier/],
    ["ajouter_notes", { notes: [{ debut: 84, duree: 4, hauteur: 60 }] }, /hors de la place/],
    ["effacer_notes", { hauteurs: [61] }, /Aucune note de ces hauteurs/],
    ["transposer", JSON.parse('{"demiTons": 2, "__proto__": {}}'), /clé/],
    ["transposer", "monte", /un objet/],
  ]) {
    assert.throws(() => outil(nom).execute(entree), (e) => e instanceof Error && motif.test(e.message), `${nom} ${JSON.stringify(entree)}`);
  }
  assert.deepEqual(copie(), seq); // rien n'a changé
  // Recaler sur la blanche ferait se chevaucher deux do5 : défait, et dit.
  const deux = idee([[0, 2, 72], [2, 2, 72]]);
  const o = outilsSurCopie(deux, sq);
  assert.throws(() => o.outils.find((x) => x.name === "recaler").execute({ grille: 8 }), /Rien n'est fait : deux notes de même hauteur/);
  assert.deepEqual(o.copie(), deux);
  // Étirer au-delà du double de l'idée : défait aussi.
  const longue = idee([[0, 48, 60]], { mesure: [3, 4] });
  const l = outilsSurCopie(longue, sq);
  l.outils.find((x) => x.name === "etirer").execute({ facteur: 2 });
  assert.throws(() => l.outils.find((x) => x.name === "etirer").execute({ facteur: 2 }), /dépasserait/);
});

test("libre avec outils : la copie est revérifiée, et une copie inchangée n'est pas une proposition", () => {
  const seq = VALSE();
  const o = { phrase: "Une octave plus haut" };
  const s = outilsSurCopie(seq, sq);
  // Claude n'a rien fait : son pourquoi dit pourquoi.
  const rien = valider("libre", { pourquoi: "Je ne peux pas changer la mesure." }, seq, { ...o, copie: s.copie() });
  non(rien, /rien changé/);
  assert.match(rien.pourquoi, /mesure/);
  s.outils[0].execute({ demiTons: 12 });
  const p = ok(valider("libre", { pourquoi: "Tout monte d'une octave." }, seq, { ...o, copie: s.copie() }));
  const neuve = appliquer("libre", seq, p, o);
  assert.deepEqual(neuve.pistes[0].notes.map((n) => n.h), seq.pistes[0].notes.map((n) => n.h + 12));
  // Une copie trafiquée après coup ne passe pas.
  const abimee = s.copie();
  abimee.pistes[0].notes[0].h = 300;
  non(valider("libre", { pourquoi: "x" }, seq, { ...o, copie: abimee }), /hors des bornes/);
  const chevauche = s.copie();
  chevauche.pistes[0].notes.push({ id: 99, d: 1, l: 2, h: chevauche.pistes[0].notes[0].h });
  non(valider("libre", {}, seq, { ...o, copie: chevauche }), /se chevauchent/);
  non(valider("libre", { notes: [] }, seq, { ...o, copie: s.copie() }), /clé inattendue « notes »/);
  non(valider("libre", {}, seq, { ...o, copie: { ...s.copie(), mesure: [7, 8] } }), /tempo, mesure ou tonalité/);
  const doublon = s.copie();
  doublon.pistes[0].notes[1].id = doublon.pistes[0].notes[0].id;
  non(valider("libre", {}, seq, { ...o, copie: doublon }), /même numéro/);
  non(valider("libre", { pourquoi: "x" }, seq, { ...o, copie: { pistes: "rien" } }), /pas l'idée/);
});

test("chevauchement : seules comptent les paires où une note est neuve", () => {
  const vieilles = [{ d: 0, l: 8, h: 60 }, { d: 4, l: 8, h: 60 }]; // déjà là, déjà chevauchantes
  assert.equal(chevauchement([{ d: 20, l: 4, h: 60 }], vieilles), null);
  assert.match(chevauchement([{ d: 10, l: 4, h: 60 }], vieilles), /hauteur 60/);
  assert.match(chevauchement([{ d: 0, l: 2, h: 62 }, { d: 0, l: 4, h: 62 }]), /se chevauchent/);
  assert.equal(chevauchement([{ d: 0, l: 2, h: 62 }, { d: 2, l: 2, h: 62 }]), null); // qui se suivent ne se chevauchent pas
});
