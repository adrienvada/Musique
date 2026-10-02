/**
 * Les accords : lire un nom, en proposer d'après la mélodie, harmoniser,
 * accompagner, transposer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../app/harmonie.js";
import { nouvelleSequence, poser, ecrireAbc } from "../app/sequence.js";

function idee(notes, options = {}) {
  const seq = nouvelleSequence(options);
  for (const [d, l, ht] of notes) poser(seq, 0, { d, l, h: ht });
  return seq;
}

test("lire un nom d'accord", () => {
  assert.deepEqual(h.lireAccord("F#m7/E"), { racine: 6, qualite: "m7", intervalles: [0, 3, 7, 10], basse: 4 });
  assert.deepEqual(h.lireAccord("Bb").intervalles, [0, 4, 7]);
  assert.equal(h.lireAccord("Cmaj").qualite, "");
  assert.equal(h.lireAccord("Cmaj7").qualite, "maj7");
  assert.equal(h.lireAccord("H7"), null);
  assert.equal(h.transposerAccord("Am/C", 2, "D"), "Bm/D");
  assert.equal(h.transposerAccord("G7", -2, "F"), "F7");
  assert.equal(h.transposerAccord("C", 3, "Eb"), "Eb");
});

test("les accords de la tonalité, et ceux qui vont avec la mélodie", () => {
  assert.deepEqual(h.accordsDeLaTonalite("C").map((a) => a.nom), ["C", "G", "F", "Am", "Dm", "Em", "Bdim", "G7"]);
  assert.deepEqual(h.accordsDeLaTonalite("Am").slice(0, 4).map((a) => a.nom), ["Am", "Dm", "E", "Em"]);
  // do-mi-sol en blanches : do majeur d'abord ; si-ré-fa : sol (ou sol 7).
  assert.equal(h.suggerer(idee([[0, 4, 60], [4, 4, 64], [8, 8, 67]]), 0, 16)[0], "C");
  assert.ok(["G", "G7"].includes(h.suggerer(idee([[0, 4, 71], [4, 4, 74], [8, 8, 77]]), 0, 16)[0]));
  // Une mélodie de quatre mesures : I … V … I.
  const seq = idee([[0, 8, 60], [8, 8, 64], [16, 8, 65], [24, 8, 69], [32, 8, 67], [40, 8, 71], [48, 16, 72]]);
  assert.deepEqual(h.harmoniser(seq).map((a) => [a.d, a.nom]), [[0, "C"], [16, "F"], [32, "G"], [48, "C"]]);
});

test("l'accompagnement : une voix de plus, dans la mesure, gravée en clé de fa", () => {
  const seq = idee([[0, 16, 72], [16, 16, 71]]);
  seq.accords = [{ d: 0, nom: "C" }, { d: 16, nom: "G/B" }];
  seq.accompagnement = "plaque";
  // Sol avec si à la basse : le si en dessous, l'accord au-dessus.
  assert.deepEqual(h.accompagnement(seq).map((n) => [n.d, n.l, n.h]), [[0, 16, 36], [0, 16, 48], [0, 16, 52], [0, 16, 55], [16, 16, 47], [16, 16, 55], [16, 16, 59], [16, 16, 62]]);
  seq.accompagnement = "basse";
  const basse = h.accompagnement(seq);
  assert.deepEqual(basse.filter((n) => n.d % 16 === 0).map((n) => n.h), [36, 47]);
  assert.equal(basse.filter((n) => n.d === 4).length, 2); // tierce et quinte sur le 2e temps
  seq.accompagnement = "arpege";
  const arpege = h.accompagnement(seq);
  assert.equal(arpege.length, 16);
  assert.ok(arpege.every((n) => n.l === 2));
  const voix = h.voixCompletes(seq);
  assert.equal(voix.length, 2);
  assert.match(ecrireAbc(seq, { voix }).abc, /V:2 clef=bass/);
  seq.accompagnement = "aucun";
  assert.equal(h.voixCompletes(seq).length, 1);
});

test("transposer toute l'idée : notes, accords et tonalité suivent", () => {
  const seq = idee([[0, 4, 69], [4, 4, 72]], { tonalite: "Am" });
  seq.accords = [{ d: 0, nom: "Am" }, { d: 4, nom: "E7" }];
  h.transposerIdee(seq, 3);
  assert.equal(seq.tonalite, "Cm");
  assert.deepEqual(seq.pistes[0].notes.map((n) => n.h), [72, 75]);
  assert.deepEqual(seq.accords.map((a) => a.nom), ["Cm", "G7"]);
});

test("la roue : les sept accords de la tonalité, dans l'ordre des degrés", () => {
  const roue = (t) => h.roueDeLaTonalite(t).map((r) => `${r.degre} ${r.nom}`).join(", ");
  assert.equal(roue("C"), "I C, ii Dm, iii Em, IV F, V G, vi Am, vii° Bdim");
  // En mineur, la dominante est majeure (la sensible) : c'est elle qui tire vers la tonique.
  assert.equal(roue("Am"), "i Am, ii° Bdim, III C, iv Dm, V E, VI F, VII G");
  // Chaque racine garde la lettre de son degré : mi♯ et non fa, en fa♯ majeur et en ré♯ mineur.
  assert.equal(roue("F#"), "I F#, ii G#m, iii A#m, IV B, V C#, vi D#m, vii° E#dim");
  assert.equal(roue("D#m"), "i D#m, ii° E#dim, III F#, iv G#m, V A#, VI B, VII C#");
  assert.equal(roue("Bb"), "I Bb, ii Cm, iii Dm, IV Eb, V F, vi Gm, vii° Adim");
  // Chaque accord de la roue se lit, et sa racine est celle du degré.
  for (const t of ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F", "Am", "Em", "Bm", "F#m", "C#m", "G#m", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm"]) {
    const roue7 = h.roueDeLaTonalite(t);
    assert.equal(roue7.length, 7, t);
    assert.equal(new Set(roue7.map((r) => r.racine)).size, 7, `sept racines distinctes en ${t}`);
    for (const r of roue7) assert.equal(h.lireAccord(r.nom).racine, r.racine, `${r.nom} en ${t}`);
  }
  // Un accord se place sur la roue par sa racine, quelle que soit sa couleur ; un étranger n'y est pas.
  assert.equal(h.degreDeLAccord("G7", "C"), 4);
  assert.equal(h.degreDeLAccord("F#m7/E", "A"), 5);
  assert.equal(h.degreDeLAccord("F#m7/E", "C"), -1);
  assert.equal(h.degreDeLAccord("n'importe quoi", "C"), -1);
});

test("ce qui vient souvent après : la table des fonctions harmoniques", () => {
  assert.deepEqual(h.suitesProbables("C", null), ["C"], "au début, on commence sur la tonique");
  assert.deepEqual(h.suitesProbables("C", "C"), ["Dm", "F", "G", "Am"]);
  assert.deepEqual(h.suitesProbables("C", "G7"), ["C", "Am"], "G7 est le V : retour à la tonique, ou cadence rompue");
  assert.deepEqual(h.suitesProbables("C", "Dm"), ["G", "Bdim"]);
  assert.deepEqual(h.suitesProbables("A", "F#m7/E"), ["Bm", "D", "E"], "un accord posé à la main compte par sa racine");
  assert.deepEqual(h.suitesProbables("C", "F#m7/E"), [], "un étranger à la tonalité : la table ne dit rien");
  assert.deepEqual(h.suitesProbables("Am", "Am"), ["C", "Dm", "E", "F"]);
  assert.deepEqual(h.suitesProbables("Am", "Dm"), ["Am", "E", "G"]);
  assert.deepEqual(h.suitesProbables("Am", "E7"), ["Am", "F"]);
  // Pour toutes les tonalités : jamais l'accord lui-même, toujours de la roue, et la dominante mène à la tonique.
  for (const t of ["C", "F#", "Eb", "Am", "C#m", "Bbm"]) {
    const roue = h.roueDeLaTonalite(t);
    for (const r of roue) {
      const suites = h.suitesProbables(t, r.nom);
      assert.ok(suites.length >= 1 && suites.length <= 4, `${r.nom} en ${t} : ${suites.length} suites`);
      assert.ok(!suites.includes(r.nom), `${r.nom} ne se suit pas lui-même`);
      assert.ok(suites.every((s) => roue.some((x) => x.nom === s)));
    }
    assert.ok(h.suitesProbables(t, roue[4].nom).includes(roue[0].nom), `en ${t}, V mène à la tonique`);
  }
});

test("ce que la mélodie appelle, ramené à la roue", () => {
  const seq = idee([[0, 4, 60], [4, 4, 64], [8, 8, 67]]);
  const appel = h.accordsDeLaMelodie(seq, 0, 16);
  assert.equal(appel[0], "C");
  assert.ok(appel.length <= 3 && new Set(appel).size === appel.length);
  assert.ok(appel.every((n) => h.roueDeLaTonalite("C").some((r) => r.nom === n)), "uniquement des accords de la roue");
  // Si-ré-fa : sol, que `suggerer` propose parfois en G7 : c'est le G de la roue.
  assert.ok(h.accordsDeLaMelodie(idee([[0, 4, 71], [4, 4, 74], [8, 8, 77]]), 0, 16).includes("G"));
  // Une mesure sans note, une idée sans mélodie : rien à conseiller.
  assert.deepEqual(h.accordsDeLaMelodie(idee([[0, 4, 60]]), 16, 32), []);
  assert.deepEqual(h.accordsDeLaMelodie(idee([]), 0, 16), []);
  // En la mineur, mi-sol-si appelle d'abord Em, qui n'est pas sur la roue (la dominante y est le E majeur) :
  // on ne garde que ce qui s'y trouve, et Em lui-même n'y est jamais compté.
  const mineur = idee([[0, 4, 64], [4, 4, 67], [8, 8, 71]], { tonalite: "Am" });
  assert.equal(h.suggerer(mineur, 0, 16, 1)[0], "Em");
  assert.deepEqual(h.accordsDeLaMelodie(mineur, 0, 16), ["E", "G", "C"]);
  assert.ok(!h.accordsDeLaMelodie(mineur, 0, 16).includes("Em"));
});

test("les notes d'un accord, en clair, bien orthographiées", () => {
  assert.deepEqual(h.notesDeLAccord("C"), ["do", "mi", "sol"]);
  assert.deepEqual(h.notesDeLAccord("Dm7"), ["ré", "fa", "la", "do"]);
  assert.deepEqual(h.notesDeLAccord("F#m7/E"), ["mi", "fa♯", "la", "do♯"], "la basse d'abord");
  assert.deepEqual(h.notesDeLAccord("Ebmaj7"), ["mi♭", "sol", "si♭", "ré"]);
  assert.deepEqual(h.notesDeLAccord("Bdim"), ["si", "ré", "fa"]);
  assert.deepEqual(h.notesDeLAccord("Bdim7"), ["si", "ré", "fa", "la♭"], "septième diminuée : la♭, pas sol♯");
  assert.deepEqual(h.notesDeLAccord("E#dim"), ["mi♯", "sol♯", "si"]);
  assert.deepEqual(h.notesDeLAccord("Gsus4"), ["sol", "do", "ré"]);
  assert.deepEqual(h.notesDeLAccord("Caug"), ["do", "mi", "sol♯"]);
  assert.deepEqual(h.notesDeLAccord("C/D"), ["ré", "do", "mi", "sol"], "une basse étrangère à l'accord s'ajoute");
  assert.deepEqual(h.notesDeLAccord("pas un accord"), []);
});

test("les couleurs d'un accord : simple, septième, sus4, add9", () => {
  const ap = (nom, couleur, t = "C") => h.appliquerCouleur(nom, couleur, t);
  // La septième de la tonalité : celle qu'on obtient en empilant les tierces de la gamme.
  assert.equal(ap("C", "septieme"), "Cmaj7");
  assert.equal(ap("G", "septieme"), "G7");
  assert.equal(ap("Dm", "septieme"), "Dm7");
  assert.equal(ap("Bdim", "septieme"), "Bm7b5");
  assert.equal(ap("Am", "septieme", "Am"), "Am7");
  assert.equal(ap("F", "septieme", "Am"), "Fmaj7");
  assert.equal(ap("G", "septieme", "Am"), "G7");
  // La dominante du mineur est majeure : sa septième est la 7, pas celle de la gamme naturelle (Em7).
  assert.equal(ap("E", "septieme", "Am"), "E7");
  // Hors tonalité : la septième la plus courante de sa famille.
  assert.equal(ap("Eb", "septieme"), "Eb7");
  assert.equal(ap("F#m", "septieme"), "F#m7");
  assert.equal(ap("Dm", "sus4"), "Dsus4");
  assert.equal(ap("C", "add9"), "Cadd9");
  assert.equal(ap("Dm", "add9"), "Dmadd9");
  assert.equal(ap("Bdim", "add9"), null, "pas de add9 sur un accord diminué");
  // Simple remet la triade : de l'accord, pas du degré (Gsus4 sans tierce reprend celle de son degré).
  assert.equal(ap("F#m7/E", "simple", "A"), "F#m", "la basse tombe, la racine reste");
  assert.equal(ap("Dsus4", "simple"), "Dm");
  assert.equal(ap("Gsus4", "simple"), "G");
  assert.equal(ap("Cmaj7", "simple"), "C");
  assert.equal(ap("pas un accord", "simple"), null);
  // Tout ce qu'on fabrique se relit.
  for (const nom of ["C", "Dm", "Bdim", "E", "F#m", "Eb"]) for (const c of ["simple", "septieme", "sus4", "add9"]) {
    const r = ap(nom, c);
    if (r) assert.ok(h.lireAccord(r), `${nom} + ${c} → ${r}`);
  }
  // La puce allumée d'un accord posé.
  assert.equal(h.couleurDe("G"), "simple");
  assert.equal(h.couleurDe("Am7"), "septieme");
  assert.equal(h.couleurDe("Cmaj7"), "septieme");
  assert.equal(h.couleurDe("F#m7/E"), "septieme");
  assert.equal(h.couleurDe("Gsus4"), "sus4");
  assert.equal(h.couleurDe("Dmadd9"), "add9");
  assert.equal(h.couleurDe("Csus2"), null);
  assert.equal(h.couleurDe("C6"), null);
  assert.equal(h.couleurDe("?"), null);
  assert.deepEqual(h.lireAccord("Dmadd9"), { racine: 2, qualite: "madd9", intervalles: [0, 3, 7, 14], basse: null });
});

test("le dessin d'un style, c'est le calcul de l'accompagnement", () => {
  assert.deepEqual(h.motifAccompagnement("aucun").notes, []);
  const plaque = h.motifAccompagnement("plaque");
  assert.equal(plaque.pas, 16);
  assert.deepEqual(plaque.notes.map((n) => [n.d, n.l]), [[0, 16], [0, 16], [0, 16], [0, 16]], "basse et trois notes, toute la mesure");
  const basse = h.motifAccompagnement("basse");
  assert.deepEqual(basse.notes.map((n) => n.d), [0, 4, 4, 8, 8, 12, 12], "la basse au premier temps, la tierce et la quinte aux suivants");
  assert.equal(h.motifAccompagnement("arpege").notes.length, 8, "huit croches");
  // Le dessin suit la mesure : trois temps, 12 pas.
  const valse = h.motifAccompagnement("basse", [3, 4]);
  assert.equal(valse.pas, 12);
  assert.deepEqual(valse.notes.map((n) => n.d), [0, 4, 4, 8, 8]);
  assert.equal(h.motifAccompagnement("arpege", [6, 8]).pas, 12);
});
