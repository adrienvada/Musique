/**
 * Les suggestions rangées par Claude depuis une conversation (H3, côté
 * appli) : celles que le vrai connecteur écrit passent, et s'appliquent en
 * une nouvelle fiche que la bibliothèque sait relire ; celles qui viennent
 * d'ailleurs sont revérifiées, et refusées si elles ne vont pas ou ne
 * changeraient rien.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { appelerConversation } from "../supabase/functions/portee-remarkable/conversation.js";
import { Suggestions } from "../supabase/functions/portee-remarkable/suggestions.js";
import { normaliserFiche } from "../app/fiche.js";
import { GENRES_SUGGESTION, appliquerSuggestion, resumeSuggestion, validerSuggestion } from "../app/suggestions.js";

const QUAND = "2026-10-05T09:00:00.000Z";
const IDEE = {
  type: "idee", titre: "Pluie", statut: "idee", nbPages: 0, modele: null, tempo: 80, note: "À jouer lentement.", etiquettes: ["nuit"], favori: false, memo: null, abc: "", creeLe: QUAND, modifieLe: QUAND,
  sequence: { version: 1, tempo: 80, mesure: [4, 4], tonalite: "Am", pistes: [{ nom: "Mélodie", notes: [{ id: 1, d: 0, l: 4, h: 69 }, { id: 2, d: 4, l: 4, h: 72 }, { id: 3, d: 8, l: 8, h: 76 }, { id: 4, d: 16, l: 16, h: 74 }] }, { nom: "Basse", cle: "fa", notes: [{ id: 5, d: 0, l: 32, h: 45 }] }], accords: [{ d: 0, nom: "Am" }], accompagnement: "aucun", suivant: 6 },
};
const PAGE = {
  titre: "Valse à l'été", modele: "melodie-standard", abc: "X:1\nT:Valse à l'été\nM:3/4\nL:1/8\nQ:1/4=96\nK:F\nF2 A2 c2 | f4 e2 |]\n", statut: "a-relire", nbPages: 1, creeLe: QUAND, modifieLe: QUAND, etiquettes: ["valse"], note: "",
  doutes: [
    { type: "mesure", page: 1, message: "La mesure 2 fait 6 croches.", leve: true },
    { type: "crochet", page: 1, message: "Petit trait au bout de la hampe : lu comme une noire.", leve: false },
  ],
};
/** Les fiches telles que l'appli les lit : remises en forme, avec leur id. */
const pluie = () => ({ ...normaliserFiche(IDEE), id: "pluie" });
const valse = () => ({ ...normaliserFiche(PAGE), id: "valse" });
const fiche = (genre, contenu, extra = {}) => ({ sid: "s123abc", cible: "pluie", genre, contenu, pourquoi: "Parce que.", creeLe: QUAND, auteur: "claude", ...extra });
const ok = (r) => { assert.equal(r.ok, true, r.raison); return r.proposition; };
const non = (r, motif) => { assert.equal(r.ok, false, JSON.stringify(r.proposition)); assert.match(r.raison, motif); return r; };
const fige = (x) => JSON.parse(JSON.stringify(x));
const sansCle = (f, cle) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== cle));

/** Le vrai outil du connecteur, sur une bibliothèque et un stockage en mémoire. */
async function rangerParClaude(args) {
  const objets = new Map();
  const suggestions = new Suggestions({
    ecrire: async (chemin, f) => { objets.set(chemin, fige(f)); },
    lire: async (chemin) => objets.get(chemin) ?? null,
    lister: async (dossier) => [...objets.keys()].filter((k) => k.startsWith(`${dossier}/`)).map((k) => ({ nom: k.slice(dossier.length + 1) })),
  });
  const bibliotheque = { changements: async () => ({ partitions: [{ id: "pluie", donnees: IDEE, modifieLe: QUAND }, { id: "valse", donnees: PAGE, modifieLe: QUAND }] }) };
  await appelerConversation("suggestion_ecrire", args, { bibliotheque, suggestions });
  const [rangee] = await suggestions.lister(args.cible);
  return rangee;
}

test("ce que le connecteur range passe, et s'applique en une fiche que la bibliothèque relit", async () => {
  // Des accords
  const accords = await rangerParClaude({ cible: "pluie", genre: "accords", contenu: { accords: [{ debut: 16, nom: "F" }, { debut: 0, nom: "Am" }, { debut: 24, nom: "E7" }] }, pourquoi: "La mélodie descend vers le fa." });
  const pa = ok(validerSuggestion(accords, pluie()));
  assert.deepEqual(pa.accords, [{ d: 0, nom: "Am" }, { d: 16, nom: "F" }, { d: 24, nom: "E7" }]);
  assert.equal(pa.sid, accords.sid);
  const fa = appliquerSuggestion(pluie(), pa);
  assert.deepEqual(fa.sequence.accords, pa.accords);
  assert.equal(fa.sequence.accompagnement, "plaque"); // le premier accord s'entend
  // Une suite, avec un accord (debut comptés depuis la fin : la barre de la mesure 3)
  const suite = await rangerParClaude({ cible: "pluie", genre: "suite", contenu: { notes: [{ debut: 0, duree: 8, hauteur: 76, velocite: 90 }, { debut: 8, duree: 8, hauteur: 69 }], accords: [{ debut: 0, nom: "E7" }] }, pourquoi: "Une fin en suspens." });
  const ps = ok(validerSuggestion(suite, pluie()));
  assert.deepEqual(ps.notes, [{ d: 32, l: 8, h: 76, v: 90 }, { d: 40, l: 8, h: 69 }]);
  const fs = appliquerSuggestion(pluie(), ps);
  assert.deepEqual(fs.sequence.pistes[0].notes.slice(-2), [{ id: 6, d: 32, l: 8, h: 76, v: 90 }, { id: 7, d: 40, l: 8, h: 69 }]);
  assert.deepEqual(fs.sequence.accords, [{ d: 0, nom: "Am" }, { d: 32, nom: "E7" }]);
  assert.equal(fs.sequence.suivant, 8);
  assert.deepEqual(fs.sequence.pistes[1], pluie().sequence.pistes[1]); // la basse n'a pas bougé
  // Une réponse à un doute de la page
  const texte = await rangerParClaude({ cible: "valse", genre: "texte", contenu: { doute: 1, note: "C'est sans doute une croche : la mesure tombe juste." }, pourquoi: "Avec une croche, la mesure fait ses six croches." });
  const pt = ok(validerSuggestion(texte, valse()));
  const ft = appliquerSuggestion(valse(), pt);
  assert.deepEqual(ft.doutes[1].avis, { auteur: "claude", texte: "C'est sans doute une croche : la mesure tombe juste." });
  assert.equal(ft.doutes[1].leve, false); // l'avis ne règle pas le doute : le toucher d'Adrien, si
  assert.equal(ft.abc, PAGE.abc); // l'ABC d'une page ne bouge jamais ici
  // Chaque fiche appliquée se relit, et l'ABC d'une idée s'y refait d'après ses notes.
  for (const f of [fa, fs, ft]) {
    const relue = normaliserFiche(f);
    assert.ok(relue && relue.abc, f.titre);
    const [tune] = abcjs.parseOnly(relue.abc);
    assert.deepEqual(tune.warnings || [], [], relue.abc);
  }
  assert.equal(fa.abc, "");
  assert.match(normaliserFiche(fs).abc, /"E7"/);
});

test("appliquer ne touche jamais la partition reçue", () => {
  const cas = [
    [fiche("accords", { accords: [{ debut: 0, nom: "Dm" }] }), pluie],
    [fiche("suite", { notes: [{ debut: 0, duree: 4, hauteur: 60 }] }), pluie],
    [fiche("variation", { notes: [{ debut: 0, duree: 32, hauteur: 69 }], accords: [{ debut: 0, nom: "A7" }] }), pluie],
    [fiche("texte", { titre: "Averse", etiquettes: ["Pluie", "nuit"], note: "Un peu plus vite ?" }), pluie],
    [fiche("texte", { doute: 1, note: "Une croche." }, { cible: "valse" }), valse],
  ];
  for (const [f, cible] of cas) {
    const c = cible();
    const avant = fige(c);
    const neuve = appliquerSuggestion(c, ok(validerSuggestion(f, c)));
    assert.deepEqual(c, avant, f.genre);
    assert.notEqual(neuve, c);
    assert.ok(normaliserFiche(neuve), f.genre);
  }
  assert.throws(() => appliquerSuggestion(pluie(), { genre: "melodie" }), /validée/);
});

test("variation : la mélodie remplacée, les autres pistes et les accords gardés sauf s'ils sont proposés", () => {
  const c = pluie();
  const sans = appliquerSuggestion(c, ok(validerSuggestion(fiche("variation", { notes: [{ debut: 0, duree: 16, hauteur: 69 }, { debut: 16, duree: 16, hauteur: 76 }] }), c)));
  assert.deepEqual(sans.sequence.pistes[0].notes.map((n) => [n.d, n.l, n.h]), [[0, 16, 69], [16, 16, 76]]);
  assert.deepEqual(sans.sequence.pistes[1], c.sequence.pistes[1]);
  assert.deepEqual(sans.sequence.accords, c.sequence.accords);
  // Une liste d'accords vide n'efface pas ceux d'Adrien.
  const vide = appliquerSuggestion(c, ok(validerSuggestion(fiche("variation", { notes: [{ debut: 0, duree: 32, hauteur: 69 }], accords: [] }), c)));
  assert.deepEqual(vide.sequence.accords, c.sequence.accords);
  const avec = appliquerSuggestion(c, ok(validerSuggestion(fiche("variation", { notes: [{ debut: 0, duree: 32, hauteur: 69 }], accords: [{ debut: 0, nom: "Dm" }, { debut: 16, nom: "E" }] }), c)));
  assert.deepEqual(avec.sequence.accords, [{ d: 0, nom: "Dm" }, { d: 16, nom: "E" }]);
  // Elle peut s'allonger (valeurs doublées) jusqu'au double de l'idée, pas plus.
  ok(validerSuggestion(fiche("variation", { notes: [{ debut: 60, duree: 4, hauteur: 69 }] }), c));
  non(validerSuggestion(fiche("variation", { notes: [{ debut: 92, duree: 8, hauteur: 69 }] }), c), /hors de la place/);
});

test("texte : titre, étiquettes ajoutées, note ajoutée à la sienne, bornés", () => {
  const c = pluie();
  const p = ok(validerSuggestion(fiche("texte", { titre: "  Averse\nd'octobre ", etiquettes: ["Pluie", "nuit", "pluie"], note: "Un peu plus vite ?\r\n\r\n\r\nEt plus doux." }), c));
  assert.deepEqual([p.titre, p.etiquettes, p.note], ["Averse d'octobre", ["pluie", "nuit"], "Un peu plus vite ?\n\nEt plus doux."]);
  const f = appliquerSuggestion(c, p);
  assert.equal(f.titre, "Averse d'octobre");
  assert.deepEqual(f.etiquettes, ["nuit", "pluie"]);
  assert.equal(f.note, "À jouer lentement.\n\nUn peu plus vite ?\n\nEt plus doux.");
  assert.equal(f.abc, ""); // le titre d'une idée est dans son ABC
  assert.match(normaliserFiche(f).abc, /^T:Averse d'octobre$/m);
  non(validerSuggestion(fiche("texte", { titre: "x".repeat(121) }), c), /120 caractères/);
  non(validerSuggestion(fiche("texte", { titre: 3 }), c), /texte/);
  non(validerSuggestion(fiche("texte", { note: "x".repeat(2001) }), c), /2000 caractères/);
  non(validerSuggestion(fiche("texte", { note: " \u0000 " }), c), /vide/);
  non(validerSuggestion(fiche("texte", { etiquettes: [] }), c), /de 1 à 10/);
  non(validerSuggestion(fiche("texte", { etiquettes: Array.from({ length: 11 }, (_, i) => `e${i}`) }), c), /de 1 à 10/);
  non(validerSuggestion(fiche("texte", { etiquettes: ["x".repeat(41)] }), c), /de 1 à 40/);
  non(validerSuggestion(fiche("texte", { etiquettes: "pluie" }), c), /de 1 à 10/);
  non(validerSuggestion(fiche("texte", {}), c), /au moins/);
  non(validerSuggestion(fiche("texte", { couleur: "bleu" }), c), /clé inattendue « couleur »/);
  const pleine = { ...pluie(), note: "x".repeat(19990) };
  non(validerSuggestion(fiche("texte", { note: "Encore un mot." }), pleine), /pleine/);
});

test("une réponse à un doute : un doute qui existe, ouvert, et une note", () => {
  const v = valse();
  const doute = (contenu) => fiche("texte", contenu, { cible: "valse" });
  ok(validerSuggestion(doute({ doute: 1, note: "Une croche." }), v));
  non(validerSuggestion(doute({ doute: 2, note: "x" }), v), /rang de 0 à 1/);
  non(validerSuggestion(doute({ doute: -1, note: "x" }), v), /rang/);
  non(validerSuggestion(doute({ doute: "1", note: "x" }), v), /rang/);
  non(validerSuggestion(doute({ doute: 1 }), v), /au moins/);
  non(validerSuggestion(doute({ doute: 1, titre: "Valse" }), v), /la réponse \(note\) manque/);
  const regle = non(validerSuggestion(doute({ doute: 0, note: "x" }), v), /déjà réglé/);
  assert.equal(regle.sansEffet, true);
  non(validerSuggestion(fiche("texte", { doute: 0, note: "x" }), pluie()), /pas de doute/);
  // Le doute a disparu entre la validation et le geste : rien n'est écrit au hasard.
  const p = ok(validerSuggestion(doute({ doute: 1, note: "Une croche." }), v));
  assert.throws(() => appliquerSuggestion({ ...v, doutes: [] }, p), /plus dans la partition/);
});

test("ce qui ne va pas est refusé : hauteurs, durées, accords, positions, partition", () => {
  const c = pluie();
  const notes = (n, genre = "suite") => validerSuggestion(fiche(genre, { notes: [n] }), c);
  non(notes({ debut: 0, duree: 4, hauteur: 20 }), /hors du clavier/);
  non(notes({ debut: 0, duree: 4, hauteur: 109 }), /hors du clavier/);
  non(notes({ debut: 0, duree: 0, hauteur: 60 }), /durée nulle/);
  non(notes({ debut: 0, duree: -2, hauteur: 60 }), /durée nulle/);
  non(notes({ debut: 0, duree: 1.5, hauteur: 60 }), /entiers/);
  non(notes({ debut: -4, duree: 4, hauteur: 60 }), /hors de la place/);
  non(notes({ debut: 8192, duree: 4, hauteur: 60 }), /hors de la place/);
  non(notes({ debut: 0, duree: 4, hauteur: 60, velocite: 0 }), /vélocité/);
  non(notes({ debut: 0, duree: 4, hauteur: 60, fin: 4 }), /clé inattendue « fin »/);
  non(notes({ debut: 0, duree: 4 }), /« hauteur » manque/);
  non(validerSuggestion(fiche("suite", { notes: [{ debut: 0, duree: 8, hauteur: 60 }, { debut: 4, duree: 4, hauteur: 60 }] }), c), /se chevauchent/);
  non(validerSuggestion(fiche("suite", { notes: [] }), c), /non vide/);
  non(validerSuggestion(fiche("suite", { notes: Array.from({ length: 4001 }, (_, i) => ({ debut: i, duree: 1, hauteur: 60 })) }), c), /4000 notes au plus/);
  non(validerSuggestion(fiche("suite", { notes: [{ debut: 0, duree: 4, hauteur: 60 }], accords: [{ debut: 4, nom: "H7" }] }), c), /illisible/);
  non(validerSuggestion(fiche("suite", { notes: [{ debut: 0, duree: 4, hauteur: 60 }], accords: [{ debut: 16, nom: "C" }] }), c), /hors de la partition/); // après la suite
  const accords = (a) => validerSuggestion(fiche("accords", { accords: a }), c);
  non(accords([{ debut: 0, nom: "Do" }]), /illisible/);
  non(accords([{ debut: 0, nom: "B♭" }]), /illisible/);
  non(accords([{ debut: 32, nom: "C" }]), /hors de la partition/); // l'idée fait deux mesures
  non(accords([{ debut: 1.5, nom: "C" }]), /hors de la partition/);
  non(accords([{ debut: 0, nom: "C" }, { debut: 0, nom: "G" }]), /même début/);
  non(accords([]), /non vide/);
  non(accords([{ debut: 0, nom: "C", temps: 1 }]), /clé inattendue/);
  non(validerSuggestion(fiche("accords", { accords: [{ debut: 0, nom: "C" }], notes: [] }), c), /clé inattendue « notes »/);
  // Des notes ou des accords ne vont qu'à une idée.
  non(validerSuggestion(fiche("accords", { accords: [{ debut: 0, nom: "C" }] }, { cible: "valse" }), valse()), /qu'à une idée/);
  non(validerSuggestion(fiche("accords", { accords: [{ debut: 0, nom: "C" }] }), { ...pluie(), sequence: { pistes: "rien" } }), /illisible/);
});

test("ce qui n'a pas la forme d'une suggestion est refusé avant tout examen", () => {
  const c = pluie();
  for (const [f, motif] of [
    [null, /objet/], ["accords", /objet/], [[fiche("accords", { accords: [{ debut: 0, nom: "C" }] })], /objet/],
    [fiche("accords", { accords: [{ debut: 0, nom: "C" }] }, { cible: "valse" }), /autre partition/],
    [sansCle(fiche("accords", { accords: [{ debut: 0, nom: "C" }] }), "cible"), /cible illisible/],
    [fiche("accords", { accords: [{ debut: 0, nom: "C" }] }, { cible: undefined }), /valeur inattendue/], // pas du JSON
    [fiche("accords", { accords: [{ debut: 0, nom: "C" }] }, { cible: "../pluie" }), /cible illisible/],
    [fiche("accords", { accords: [{ debut: 0, nom: "C" }] }, { sid: "s/../x" }), /sid illisible/],
    [fiche("melodie", { notes: [] }), /genre inconnu/],
    [fiche("accords", "Am F"), /contenu : un objet/],
    [fiche("accords", { accords: [{ debut: 0, nom: "C" }] }, { pourquoi: 12 }), /pourquoi/],
    [fiche("accords", { accords: [{ debut: NaN, nom: "C" }] }), /nombre invalide/],
    [JSON.parse('{"sid": "s1", "cible": "pluie", "genre": "accords", "contenu": {"accords": [{"debut": 0, "nom": "C"}], "__proto__": {"x": 1}}, "pourquoi": "x"}'), /clé interdite « __proto__ »/],
    [fiche("suite", { notes: new Array(60000).fill({ debut: 0, duree: 1, hauteur: 60 }) }), /trop grande|trop longue/],
  ]) non(validerSuggestion(f, c), motif);
  non(validerSuggestion(fiche("accords", { accords: [{ debut: 0, nom: "C" }] }), null), /partition visée manque/);
  assert.deepEqual(GENRES_SUGGESTION, ["accords", "suite", "variation", "texte"]);
  // Un pourquoi absent n'empêche rien ; trop long, il est coupé.
  assert.equal(ok(validerSuggestion(sansCle(fiche("accords", { accords: [{ debut: 0, nom: "C" }] }), "pourquoi"), c)).pourquoi, "");
  assert.ok(ok(validerSuggestion(fiche("accords", { accords: [{ debut: 0, nom: "C" }] }, { pourquoi: "mot ".repeat(1000) }), c)).pourquoi.length <= 2000);
});

test("une suggestion qui ne changerait rien le dit (déjà appliquée sur un autre appareil)", () => {
  const c = pluie();
  const deja = (f, cible = c) => { const r = non(validerSuggestion(f, cible), /déjà|rien/); assert.equal(r.sansEffet, true); };
  deja(fiche("accords", { accords: [{ debut: 0, nom: "Am" }] }));
  deja(fiche("variation", { notes: c.sequence.pistes[0].notes.map((n) => ({ debut: n.d, duree: n.l, hauteur: n.h })) }));
  deja(fiche("texte", { titre: "Pluie" }));
  deja(fiche("texte", { etiquettes: ["Nuit"] }));
  deja(fiche("texte", { note: "À jouer lentement." }));
  const v = valse();
  const p = ok(validerSuggestion(fiche("texte", { doute: 1, note: "Une croche." }, { cible: "valse" }), v));
  deja(fiche("texte", { doute: 1, note: "Une croche." }, { cible: "valse" }), appliquerSuggestion(v, p));
  // Une suggestion fausse n'est pas « sans effet » : elle est fausse.
  assert.equal(validerSuggestion(fiche("accords", { accords: [{ debut: 0, nom: "Do" }] }), c).sansEffet, undefined);
});

test("le résumé : une phrase courte, prudente sur une fiche mal formée", () => {
  assert.equal(resumeSuggestion(fiche("accords", { accords: [{ debut: 0, nom: "Am" }, { debut: 16, nom: "F" }] })), "Claude propose 2 accords");
  assert.equal(resumeSuggestion(fiche("accords", { accords: [{ debut: 0, nom: "Am" }] })), "Claude propose 1 accord");
  assert.equal(resumeSuggestion(fiche("suite", { notes: [{ debut: 0, duree: 4, hauteur: 60 }] })), "Claude propose une suite de 1 note");
  assert.equal(resumeSuggestion(fiche("variation", { notes: [] })), "Claude propose une variation de la mélodie");
  assert.equal(resumeSuggestion(fiche("texte", { doute: 2, note: "Une croche." })), "Claude répond au doute n° 3");
  assert.equal(resumeSuggestion(fiche("texte", { titre: "  Averse\n" })), "Claude propose un titre : « Averse »");
  assert.equal(resumeSuggestion(fiche("texte", { etiquettes: ["Pluie", "nuit"] })), "Claude propose des étiquettes : pluie, nuit");
  assert.equal(resumeSuggestion(fiche("texte", { note: "Plus vite." })), "Claude propose une note");
  assert.equal(resumeSuggestion(fiche("texte", { titre: "Averse", etiquettes: ["pluie"], note: "x" })), "Claude propose un titre, des étiquettes et une note");
  assert.equal(resumeSuggestion(fiche("texte", { titre: "<b>Averse</b>" })), "Claude propose un titre : « <b>Averse</b> »"); // du texte : l'écran l'échappe
  for (const f of [null, "x", {}, { genre: "accords" }, { genre: "melodie", contenu: {} }, fiche("texte", {}), fiche("accords", { accords: "Am" })]) {
    assert.equal(typeof resumeSuggestion(f), "string");
    assert.match(resumeSuggestion(f), /^Claude /);
  }
});
