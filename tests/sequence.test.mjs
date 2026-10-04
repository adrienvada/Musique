/**
 * Une idée en notes, traduite en ABC : abcjs doit y relire exactement les
 * mêmes notes (hauteur, début, durée), quels que soient la mesure, la
 * tonalité, les syncopes et les accords. Et les gestes d'édition.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import * as sq from "../app/sequence.js";
import { lireJeton } from "../app/edition.js";

/** Ce qu'abcjs entend dans un ABC : [[d, l, h]], toutes voix et couches confondues, triés. */
function entendu(abc) {
  const [tune] = abcjs.parseOnly(abc);
  assert.deepEqual(tune.warnings || [], [], abc);
  return tune.setUpAudio({ chordsOff: true }).tracks.flatMap((t) =>
    t.filter((e) => e.cmd === "note").map((e) => [Math.round(e.start * 16), Math.round(e.duration * 16), e.pitch])).sort(trier);
}
const trier = (a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1];
const attendu = (seq) => seq.pistes.flatMap((p) => p.notes.map((n) => [n.d, n.l, n.h])).sort(trier);
const notesDe = (seq, p = 0) => seq.pistes[p].notes.map((n) => [n.d, n.l, n.h]).sort(trier);

function idee(notes, options = {}) {
  const seq = sq.nouvelleSequence(options);
  for (const [d, l, h] of notes) sq.poser(seq, 0, { d, l, h });
  return seq;
}

test("une mélodie simple : mesures, ligatures, silences", () => {
  const seq = idee([[0, 4, 60], [4, 2, 62], [6, 2, 64], [8, 1, 65], [9, 1, 67], [10, 1, 69], [11, 1, 71], [12, 4, 72], [20, 4, 67]]);
  const { abc } = sq.ecrireAbc(seq);
  assert.equal(abc, "X:1\nM:4/4\nL:1/8\nQ:1/4=90\nK:C\nC2 DE F/G/A/B/ c2 | z2 G2 z4 |]\n");
  assert.deepEqual(entendu(abc), attendu(seq));
});

test("syncopes et notes longues : coupées au temps, liées, et toujours justes", () => {
  // croche, noire à contretemps (coupée au temps), blanche qui passe la barre
  const seq = idee([[0, 2, 60], [2, 4, 62], [6, 2, 64], [8, 12, 65], [20, 5, 67]]);
  const { abc } = sq.ecrireAbc(seq);
  assert.equal(abc.split("\n")[5], "CD- DE F4- | F2 G2- G/ z3/ z2 |]");
  assert.deepEqual(entendu(abc), attendu(seq));
});

test("mesures composées : chaque temps se voit, la ronde pointée remplit un 12/8", () => {
  const corps = (abc) => abc.split("\n").slice(5).join("\n").trim();
  // 6/8 : quatre croches en tête de mesure, noire pointée liée à une croche (pas une blanche,
  // qui cacherait le 2ᵉ temps) ; cinq croches, noire pointée liée à une noire.
  const six = idee([[0, 8, 66], [8, 4, 69], [12, 10, 74], [22, 2, 73], [24, 12, 74]], { mesure: [6, 8], tonalite: "D" });
  assert.equal(corps(sq.ecrireAbc(six).abc), "F3- F A2 | d3- d2 c | d6 |]");
  assert.deepEqual(entendu(sq.ecrireAbc(six).abc), attendu(six));
  // 12/8 : une mesure entière est une ronde pointée, pas ronde + croche + noire pointée.
  const douze = idee([[0, 24, 63], [24, 16, 66], [40, 8, 65], [48, 18, 70], [66, 6, 62]], { mesure: [12, 8], tonalite: "Ebm" });
  assert.equal(corps(sq.ecrireAbc(douze).abc), "E12 | G6- G2 F- F3 | B6- B3 =D3 |]");
  assert.deepEqual(entendu(sq.ecrireAbc(douze).abc), attendu(douze));
  // 9/8 : trois temps n'ont pas de signe unique (blanche pointée liée à une noire pointée).
  const neuf = idee([[0, 18, 60], [18, 4, 62], [22, 2, 64], [24, 12, 65]], { mesure: [9, 8] });
  assert.equal(corps(sq.ecrireAbc(neuf).abc), "C6- C3 | D2 E F6 |]");
  assert.deepEqual(entendu(sq.ecrireAbc(neuf).abc), attendu(neuf));
  // Ailleurs, rien ne change : la blanche pointée d'un 3/4, la ronde d'un 4/4.
  assert.equal(corps(sq.ecrireAbc(idee([[0, 12, 60]], { mesure: [3, 4] })).abc), "C6 |]");
  assert.equal(corps(sq.ecrireAbc(idee([[0, 16, 60]])).abc), "C8 |]");
});

test("en 3/8, les trois croches d'une mesure se lient ensemble", () => {
  const seq = idee([[0, 2, 60], [2, 2, 62], [4, 2, 64], [6, 1, 65], [7, 1, 67], [8, 4, 69]], { mesure: [3, 8] });
  const { abc } = sq.ecrireAbc(seq);
  assert.equal(abc.split("\n")[5], "CDE | F/G/ A2 |]");
  assert.deepEqual(entendu(abc), attendu(seq));
  // En 2/4, la ligature suit toujours la noire.
  assert.equal(sq.ecrireAbc(idee([[0, 2, 60], [2, 2, 62], [4, 2, 64], [6, 2, 65]], { mesure: [2, 4] })).abc.split("\n")[5], "CD EF |]");
});

test("altérations : armure, bécarre dans la mesure, note liée par-dessus la barre", () => {
  // En sol majeur : fa♯ (armure), fa bécarre, fa♯ à nouveau, fa♯ lié par-dessus la barre, puis fa, fa♯.
  const seq = idee([[0, 2, 66], [2, 2, 65], [4, 2, 66], [8, 12, 66], [20, 4, 65], [24, 4, 66]], { tonalite: "G" });
  const { abc } = sq.ecrireAbc(seq);
  assert.match(abc, /K:G\nF=F \^F z F4- \| F2 =F2 \^F2 z2 \|\]/);
  assert.deepEqual(entendu(abc), attendu(seq));
  // En la mineur, la sensible s'écrit sol♯, pas la♭.
  assert.equal(sq.nomNote(68, "Am"), "sol♯4");
  assert.equal(sq.nomNote(68, "C"), "la♭4");
  assert.equal(sq.nomNote(70, "F"), "si♭4");
  assert.equal(sq.nomNote(66, "Bb"), "sol♭4");
  assert.equal(sq.nomNote(60, "C#"), "si♯3");
  assert.equal(sq.nomNote(71, "Gb"), "do♭5");
});

test("orthographe : les notes d'un accord s'écrivent comme l'accord, les autres suivent la ligne", () => {
  // Une voix d'accompagnement (les notes de l'accord) et une mélodie, sous des accords posés.
  const epel = (tonalite, accords, voix) => {
    const seq = sq.nouvelleSequence({ tonalite });
    seq.accords = accords.map(([d, nom]) => ({ d, nom }));
    const lesVoix = voix.map((notes, i) => ({ nom: `V${i}`, notes: notes.map(([d, l, h], j) => ({ id: i * 100 + j, d, l, h })) }));
    seq.pistes = lesVoix;
    const { parVoix } = sq.mettreEnMesures(seq, { voix: lesVoix });
    const noms = parVoix.map((couches) => couches.flatMap((mesures) => mesures.flat().flatMap((t) => t.notes.filter((n) => !n.suite).map((n) => n.e.lettre + ({ "-1": "b", 0: "", 1: "#" })[n.e.alt]))));
    // Et abcjs relit les mêmes hauteurs.
    const { abc } = sq.ecrireAbc(seq, { voix: lesVoix });
    assert.deepEqual(entendu(abc), lesVoix.flatMap((v) => v.notes.map((n) => [n.d, n.l, n.h])).sort(trier), abc);
    return noms;
  };
  // Ré 7 en fa majeur : fa♯ (MuseScore recevait un sol♭).
  assert.deepEqual(epel("F", [[0, "D7"]], [[[0, 16, 50], [0, 16, 54], [0, 16, 57], [0, 16, 60]]])[0], ["D", "F#", "A", "C"]);
  // En do : mi 7 a son sol♯, si 7 son ré♯ et son fa♯, ré♭ son ré♭ et son la♭.
  const enDo = epel("C", [[0, "E7"], [16, "B7"], [32, "Db"]], [[[0, 16, 56]], [[16, 16, 63], [16, 16, 66]], [[32, 16, 61], [32, 16, 68]]].map((x) => x));
  assert.deepEqual(enDo, [["G#"], ["D#", "F#"], ["Db", "Ab"]]);
  // En sol : si♭ et fa bécarre dans B♭ (pas la♯), mi♭ dans Cm (pas ré♯).
  assert.deepEqual(epel("G", [[0, "Bb"], [16, "Cm"]], [[[0, 16, 58], [0, 16, 65], [16, 16, 63]]])[0], ["Bb", "F", "Eb"]);
  // Sans accord, une note de passage montante prend le dièse, descendante le bémol, en do comme en si♭.
  assert.deepEqual(epel("C", [], [[[0, 4, 60], [4, 4, 61], [8, 4, 62], [12, 4, 62], [16, 4, 61], [20, 4, 60]]])[0], ["C", "C#", "D", "D", "Db", "C"]);
  assert.deepEqual(epel("Bb", [], [[[0, 4, 65], [4, 4, 66], [8, 4, 67], [12, 4, 67], [16, 4, 66], [20, 4, 65]]])[0], ["F", "F#", "G", "G", "Gb", "F"]);
  // La broderie inférieure revient vers le haut : ré♯, pas mi♭, entre deux mi.
  assert.deepEqual(epel("C", [], [[[0, 4, 64], [4, 4, 63], [8, 4, 64]]])[0], ["E", "D#", "E"]);
  // La mélodie suit l'accord avant la ligne : sol♯ sous E7, même s'il descend vers sol.
  assert.deepEqual(epel("C", [[0, "E7"]], [[[0, 4, 68], [4, 4, 67]]])[0], ["G#", "G"]);
  // Hors contexte, l'épellation de la tonalité ne change pas (nomNote).
  assert.equal(sq.nomNote(66, "F"), "sol♭4");
  assert.equal(sq.nomNote(68, "Am"), "sol♯4");
});

test("accords, symboles d'accords et deux voix", () => {
  const seq = idee([[0, 8, 60], [0, 8, 64], [0, 4, 67], [4, 4, 69], [8, 8, 72]]);
  seq.accords = [{ d: 0, nom: "C" }, { d: 12, nom: "Am" }];
  seq.pistes.push({ nom: "Basse", notes: [{ id: 99, d: 0, l: 16, h: 36 }, { id: 98, d: 16, l: 4, h: 45 }] });
  const { abc } = sq.ecrireAbc(seq);
  assert.match(abc, /V:1 clef=treble\nV:2 clef=bass\n/);
  // La mélodie (sol, la, do) au-dessus d'un accord tenu (do-mi) : deux couches sur la même portée.
  assert.match(abc, /\[V:1\] "C"G2 A2 c2- "Am"c2 & \[CE\]4 x4 \| z8 & x8 \|\]\n\[V:2\] C,,8 \| A,,2 z6 \|\]/);
  assert.deepEqual(entendu(abc), attendu(seq));
});

test("la carte des jetons retrouve chaque note dans l'ABC", () => {
  const seq = idee([[0, 2, 60], [2, 6, 62], [8, 2, 64], [8, 2, 67]], { tonalite: "D" });
  const { abc, jetons } = sq.ecrireAbc(seq);
  for (const j of jetons) {
    const lu = lireJeton(abc, j.debut);
    assert.ok(lu, abc.slice(j.debut, j.fin));
    assert.ok(["", "-"].includes(abc.slice(lu.fin, j.fin)), abc.slice(j.debut, j.fin)); // la liaison suit le jeton
    assert.equal(lu.croches * 2, j.l);
    assert.equal(j.silence, lu.type === "silence");
  }
  const ids = seq.pistes[0].notes.map((n) => n.id);
  assert.deepEqual(jetons.filter((j) => j.voix === 0 && !j.silence).map((j) => j.ids), [[ids[0]], [ids[1]], [ids[1]], [ids[2], ids[3]]]);
  // Les positions qu'abcjs donne (startChar) tombent sur les jetons.
  const [tune] = abcjs.parseOnly(abc);
  const debuts = tune.lines.flatMap((l) => l.staff.flatMap((s) => s.voices.flat())).filter((e) => e.el_type === "note").map((e) => e.startChar);
  assert.deepEqual(debuts, jetons.map((j) => j.debut));
});

// Un générateur pseudo-aléatoire reproductible.
function hasard(graine) {
  let x = graine;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("mille idées au hasard : abcjs relit toujours les mêmes notes", () => {
  const mesures = [[4, 4], [3, 4], [2, 4], [6, 8], [12, 8], [5, 8], [2, 2]];
  const r = hasard(7);
  for (let essai = 0; essai < 1000; essai++) {
    const mesure = mesures[essai % mesures.length];
    const tonalite = sq.TONALITES[essai % sq.TONALITES.length];
    const seq = sq.nouvelleSequence({ mesure, tonalite, tempo: 100 });
    let d = 0;
    const nb = 3 + Math.floor(r() * 14);
    for (let i = 0; i < nb; i++) {
      d += Math.floor(r() * 3) === 0 ? Math.floor(r() * 5) : 0; // parfois un silence
      const l = 1 + Math.floor(r() * 14);
      const hauteurs = new Set([48 + Math.floor(r() * 36)]);
      if (r() < 0.2) hauteurs.add([...hauteurs][0] + 3 + Math.floor(r() * 5));
      for (const h of hauteurs) sq.poser(seq, 0, { d, l, h });
      d += r() < 0.15 ? Math.floor(l / 2) : l; // parfois des notes qui se chevauchent
    }
    if (r() < 0.3) seq.accords = [{ d: 0, nom: "C" }, { d: 1 + Math.floor(r() * 20), nom: "G7" }];
    // Deux notes de même hauteur qui se chevauchent n'ont pas de sens : on les écarte.
    const notes = seq.pistes[0].notes;
    seq.pistes[0].notes = notes.filter((n) => !notes.some((m) => m !== n && m.h === n.h && m.d < n.d && m.d + m.l > n.d));
    const { abc, jetons } = sq.ecrireAbc(seq, { mesuresParLigne: 1 + (essai % 4) });
    assert.deepEqual(entendu(abc), attendu(seq), abc);
    // Chaque note ou silence qu'abcjs grave renvoie à un jeton de la carte, donc aux notes de l'idée.
    const [tune] = abcjs.parseOnly(abc);
    for (const el of tune.lines.flatMap((l) => l.staff.flatMap((st) => st.voices.flat())).filter((e) => e.el_type === "note")) {
      const j = sq.jetonA(jetons, el.startChar);
      assert.ok(j, `${abc}\n${el.startChar}`);
      assert.equal(!!el.rest, j.silence, `${abc}\n${el.startChar} ${JSON.stringify(j)}`);
      if (el.pitches) assert.equal(j.ids.length, el.pitches.length);
    }
  }
});

test("d'un ABC à une idée : notes, mesure, tonalité, tempo, reprises dépliées", () => {
  const abc = "X:1\nM:3/4\nL:1/8\nQ:1/4=72\nK:Eb\nV:1\nV:2 clef=bass\n[V:1] |: G2 A2 B2 :| e6 |]\n[V:2] |: E,6 :| B,,6 |]\n";
  const seq = sq.sequenceDepuisAbc(abc, abcjs);
  assert.deepEqual(seq.mesure, [3, 4]);
  assert.equal(seq.tonalite, "Eb");
  assert.equal(seq.tempo, 72);
  assert.equal(seq.pistes.length, 2);
  assert.deepEqual(notesDe(seq, 0), [[0, 4, 67], [4, 4, 68], [8, 4, 70], [12, 4, 67], [16, 4, 68], [20, 4, 70], [24, 12, 75]]);
  assert.deepEqual(notesDe(seq, 1), [[0, 12, 51], [12, 12, 51], [24, 12, 46]]);
  assert.equal(sq.sequenceDepuisAbc("X:1\nL:1/8\nK:Amin\nA2|]\n", abcjs).tonalite, "Am");
  assert.equal(sq.sequenceDepuisAbc("X:1\nL:1/8\nK:Gmaj\nG2|]\n", abcjs).tonalite, "G");
  // Et retour : l'ABC réécrit sonne pareil.
  assert.deepEqual(entendu(sq.ecrireAbc(seq).abc), attendu(seq));
});

test("écrire comme dans un texte : insérer, effacer, ⌫, changer la durée", () => {
  const seq = idee([[0, 2, 60], [2, 2, 62], [4, 4, 64]]);
  const [nouvelle] = sq.inserer(seq, 0, 2, [67], 2);
  assert.deepEqual(notesDe(seq), [[0, 2, 60], [2, 2, 67], [4, 2, 62], [6, 4, 64]]);
  sq.effacer(seq, 0, [nouvelle]);
  assert.deepEqual(notesDe(seq), [[0, 2, 60], [2, 2, 62], [4, 4, 64]]);
  // Un accord : retirer une de ses notes ne décale rien.
  const ajout = sq.ajouterALAccord(seq, 0, seq.pistes[0].notes[0].id, 64);
  sq.effacer(seq, 0, [ajout]);
  assert.deepEqual(notesDe(seq), [[0, 2, 60], [2, 2, 62], [4, 4, 64]]);
  // ⌫ à la fin : retire la dernière note ; dans un silence, en retire un bout.
  assert.equal(sq.effacerAvant(seq, 0, 8), 4);
  assert.deepEqual(notesDe(seq), [[0, 2, 60], [2, 2, 62]]);
  sq.insererSilence(seq, 0, 0, 4);
  assert.equal(sq.effacerAvant(seq, 0, 4, 2), 2);
  assert.deepEqual(notesDe(seq), [[2, 2, 60], [4, 2, 62]]);
  // Une noire devient blanche : la suite recule.
  sq.changerDuree(seq, 0, [seq.pistes[0].notes[0].id], 8);
  assert.deepEqual(notesDe(seq), [[2, 8, 60], [10, 2, 62]]);
  sq.fixerHauteur(seq, 0, [seq.pistes[0].notes[1].id], 70);
  assert.deepEqual(notesDe(seq), [[2, 8, 60], [10, 2, 70]]);
});

test("transformer une phrase : dupliquer, ×2, ÷2, à l'envers, en miroir, recaler", () => {
  const seq = idee([[0, 2, 60], [2, 2, 64], [4, 4, 67], [8, 4, 72]]);
  const phrase = seq.pistes[0].notes.slice(0, 3).map((n) => n.id);
  sq.dupliquerSelection(seq, 0, phrase);
  assert.deepEqual(notesDe(seq), [[0, 2, 60], [2, 2, 64], [4, 4, 67], [8, 2, 60], [10, 2, 64], [12, 4, 67], [16, 4, 72]]);
  const s2 = idee([[0, 2, 60], [2, 2, 64], [4, 4, 67], [8, 4, 72]]);
  const p2 = s2.pistes[0].notes.slice(0, 3).map((n) => n.id);
  sq.etirer(s2, 0, p2, 2);
  assert.deepEqual(notesDe(s2), [[0, 4, 60], [4, 4, 64], [8, 8, 67], [16, 4, 72]]);
  sq.etirer(s2, 0, p2, 0.5);
  assert.deepEqual(notesDe(s2), [[0, 2, 60], [2, 2, 64], [4, 4, 67], [8, 4, 72]]);
  sq.retrograder(s2, 0, p2);
  assert.deepEqual(notesDe(s2), [[0, 4, 67], [4, 2, 64], [6, 2, 60], [8, 4, 72]]);
  sq.renverser(s2, 0, p2);
  assert.deepEqual(notesDe(s2), [[0, 4, 67], [4, 2, 70], [6, 2, 74], [8, 4, 72]]);
  const s3 = idee([[1, 3, 60], [5, 2, 62]]);
  sq.recaler(s3, 0, s3.pistes[0].notes.map((n) => n.id), 4);
  assert.deepEqual(notesDe(s3), [[0, 4, 60], [4, 4, 62]]);
});

test("jouer en direct : les notes se recalent sur la grille", () => {
  const notes = sq.quantifier([
    { h: 60, debut: -0.2, fin: 1.7 },   // un poil en avance : sur le temps
    { h: 62, debut: 2.1, fin: 2.4 },    // très courte : une croche de grille
    { h: 64, debut: 3.9, fin: 8.2 },
    { h: 64, debut: 7.8, fin: 9.6 },    // rejouée avant la fin de la précédente
    { h: 67, debut: 9.9, fin: 12.6 },   // jeu lié : déborde sur la suivante
    { h: 69, debut: 12.1, fin: 13.9 },
  ], { grille: 2, origine: 16 });
  // La dernière, relâchée une croche avant la fin de son temps, tient jusqu'à elle (jeu lié).
  assert.deepEqual(notes.map((n) => [n.d, n.l, n.h]), [[16, 2, 60], [18, 2, 62], [20, 4, 64], [24, 2, 64], [26, 2, 67], [28, 4, 69]]);
  // Des noires jouées un peu détachées (relâchées une croche trop tôt) restent des noires ;
  // un vrai silence (plus d'une croche) reste un silence.
  const detachees = sq.quantifier([
    { h: 60, debut: 0, fin: 2.9 }, { h: 62, debut: 4, fin: 6.2 }, { h: 64, debut: 8, fin: 9 }, { h: 65, debut: 13, fin: 15 },
  ], { grille: 2 });
  assert.deepEqual(detachees.map((n) => [n.d, n.l, n.h]), [[0, 4, 60], [4, 4, 62], [8, 2, 64], [14, 2, 65]]);
  // Un accord tenu sous la mélodie, lui, reste tenu.
  const tenu = sq.quantifier([{ h: 48, debut: 0, fin: 8 }, { h: 72, debut: 2, fin: 4 }], { grille: 2 });
  assert.deepEqual(tenu.map((n) => [n.d, n.l, n.h]), [[0, 8, 48], [2, 2, 72]]);
});

test("l'arrondi : la dernière note se prolonge comme les autres, une double attaque ne compte qu'une fois", () => {
  const brut = (n) => [n.d, n.l, n.h];
  // Des noires tenues à 60 % : toutes restent des noires, la dernière aussi (avant : une croche).
  const noires = [0, 4, 8, 12].map((d, i) => ({ h: 60 + i, debut: d + 0.1, fin: d + 0.1 + 2.4 }));
  assert.deepEqual(sq.quantifier(noires, { grille: 2 }).map(brut), [[0, 4, 60], [4, 4, 61], [8, 4, 62], [12, 4, 63]]);
  assert.deepEqual(sq.quantifier(noires.map((n) => ({ ...n, fin: n.debut + 3 })), { grille: 1 }).map(brut), [[0, 4, 60], [4, 4, 61], [8, 4, 62], [12, 4, 63]]);
  // Le dernier accord relâché en désordre : toutes ses notes tiennent jusqu'au temps.
  const accord = [{ h: 60, debut: 0, fin: 3.4 }, { h: 64, debut: 0, fin: 3.6 }, { h: 67, debut: 0, fin: 4.4 }];
  assert.deepEqual(sq.quantifier(accord, { grille: 1 }).map(brut), [[0, 4, 60], [0, 4, 64], [0, 4, 67]]);
  // Au-delà d'un pas de grille, c'est un silence, pour la dernière comme pour les autres ;
  // une note qui dépasse déjà son temps (syncope) ne bouge pas ; en 6/8, le temps est la noire pointée.
  assert.deepEqual(sq.quantifier([{ h: 60, debut: 0, fin: 1.6 }], { grille: 1 }).map(brut), [[0, 2, 60]]);
  assert.deepEqual(sq.quantifier([{ h: 60, debut: 2, fin: 5.8 }], { grille: 2 }).map(brut), [[2, 4, 60]]);
  assert.deepEqual(sq.quantifier([{ h: 60, debut: 0, fin: 4.2 }], { grille: 2, temps: 6 }).map(brut), [[0, 6, 60]]);
  // La même note attaquée deux fois dans le même pas de grille : une seule note, la plus longue.
  const repetee = sq.quantifier([{ h: 60, debut: 0, fin: 0.6 }, { h: 60, debut: 0.8, fin: 1.6 }, { h: 60, debut: 2, fin: 3 }], { grille: 2 });
  assert.deepEqual(repetee.map(brut), [[0, 2, 60], [2, 2, 60]]);
  // Le compte des notes gardées est donc celui des notes écrites.
  const seq = sq.nouvelleSequence();
  for (const n of repetee) sq.poser(seq, 0, n);
  assert.equal(seq.pistes[0].notes.length, repetee.length);
});
