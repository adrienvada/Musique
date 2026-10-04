/**
 * Le MIDI d'une idée : relu octet par octet, il doit redonner les pistes,
 * leurs noms, le tempo, la mesure, l'armure (et leurs changements) et chaque
 * note au tic près ; chaque piste finit à la barre, et une même note n'est
 * jamais rejouée pendant qu'elle sonne.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { fichierMidi, texteMidi, midiDeLaPage, lireFichierMidi, ideeDepuisMidi } from "../app/midi.js";

/** Un petit lecteur de MIDI, juste ce qu'il faut pour vérifier (indépendant de celui de l'appli). */
function lireMidi(octets) {
  let i = 0;
  const u32 = () => (octets[i++] << 24 | octets[i++] << 16 | octets[i++] << 8 | octets[i++]) >>> 0;
  const u16 = () => (octets[i++] << 8) | octets[i++];
  const vlq = () => { let v = 0, b; do { b = octets[i++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  const texte = (n) => new TextDecoder().decode(octets.slice(i, (i += n)));
  assert.equal(texte(4), "MThd");
  assert.equal(u32(), 6);
  const format = u16(), nb = u16(), ppq = u16();
  const pistes = [];
  for (let p = 0; p < nb; p++) {
    assert.equal(texte(4), "MTrk");
    const fin = u32() + i;
    const piste = { nom: null, notes: [], meta: {}, mesures: [], armures: [], programme: null, fin: null, octetsDuNom: null };
    const ouvertes = new Map();
    let t = 0;
    while (i < fin) {
      t += vlq();
      const statut = octets[i++];
      if (statut === 0xff) {
        const type = octets[i++], n = vlq();
        const donnees = octets.slice(i, i + n);
        if (type === 0x03) { piste.octetsDuNom = [...donnees]; piste.nom = texte(n); } else i += n;
        if (type === 0x51) piste.meta.tempo = Math.round(60000000 / ((donnees[0] << 16) | (donnees[1] << 8) | donnees[2]));
        if (type === 0x58) { piste.mesures.push([t, donnees[0], 2 ** donnees[1]]); piste.meta.mesure ??= [donnees[0], 2 ** donnees[1]]; }
        if (type === 0x59) { piste.armures.push([t, (donnees[0] << 24) >> 24, donnees[1]]); piste.meta.armure ??= [(donnees[0] << 24) >> 24, donnees[1]]; }
        if (type === 0x2f) { assert.equal(i, fin); piste.fin = t; }
      } else if ((statut & 0xf0) === 0x90 && octets[i + 1] > 0) {
        assert.ok(!ouvertes.has(octets[i]), `note ${octets[i]} rejouée à ${t} pendant qu'elle sonne`);
        ouvertes.set(octets[i], { t, h: octets[i], v: octets[i + 1], canal: statut & 15 });
        i += 2;
      } else if ((statut & 0xf0) === 0x80 || (statut & 0xf0) === 0x90) {
        const o = ouvertes.get(octets[i]);
        piste.notes.push([o.t, t - o.t, o.h, o.v, o.canal]);
        ouvertes.delete(octets[i]);
        i += 2;
      } else if ((statut & 0xf0) === 0xc0) {
        piste.programme = octets[i++];
      } else {
        throw new Error("événement inattendu " + statut.toString(16));
      }
    }
    pistes.push(piste);
  }
  return { format, ppq, pistes };
}

test("une piste de tempo, puis une piste nommée par voix", () => {
  const midi = lireMidi(fichierMidi([
    { nom: "Mélodie", notes: [{ d: 0, l: 4, h: 60 }, { d: 4, l: 2, h: 64, v: 110 }, { d: 6, l: 2, h: 64 }] },
    { nom: "Accords", notes: [{ d: 0, l: 16, h: 48 }, { d: 0, l: 16, h: 55 }] },
  ], { tempo: 132, mesure: [6, 8], quintes: -3, mineur: true, titre: "Idée du matin" }));
  assert.equal(midi.format, 1);
  assert.equal(midi.ppq, 480);
  assert.equal(midi.pistes.length, 3);
  const [conducteur, melodie, accords] = midi.pistes;
  // Les noms en ASCII : aucun logiciel ne peut les lire de travers.
  assert.equal(conducteur.nom, "Idee du matin");
  assert.deepEqual(conducteur.meta, { tempo: 132, mesure: [6, 8], armure: [-3, 1] });
  assert.equal(melodie.nom, "Melodie");
  assert.ok(melodie.octetsDuNom.every((o) => o < 128));
  assert.equal(melodie.programme, 0);
  // Une double croche = 120 tics ; la note répétée se rejoue (fin avant début).
  assert.deepEqual(melodie.notes, [[0, 480, 60, 90, 0], [480, 240, 64, 110, 0], [720, 240, 64, 90, 0]]);
  assert.deepEqual(accords.notes.map((n) => n.slice(0, 3)), [[0, 1920, 48], [0, 1920, 55]]);
  assert.ok(accords.notes.every((n) => n[4] === 1));
});

test("transposition, notes hors du clavier MIDI ignorées, canal 10 évité", () => {
  const voix = Array.from({ length: 11 }, (_, i) => ({ nom: `V${i}`, notes: [{ d: i, l: 1, h: 60 + i }] }));
  voix[0].notes.push({ d: 0, l: 1, h: 126 });
  const midi = lireMidi(fichierMidi(voix, { transposition: 2 }));
  assert.deepEqual(midi.pistes[1].notes.map((n) => n[2]), [62]);
  assert.deepEqual(midi.pistes.slice(1).map((p) => p.notes[0][4]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
});

test("chaque piste finit à la barre, pas à la dernière note", () => {
  // Une note qui finit au pas 22, en 4/4 : la musique finit à la barre du pas 32.
  const midi = lireMidi(fichierMidi([{ nom: "Mélodie", notes: [{ d: 0, l: 4, h: 60 }, { d: 18, l: 4, h: 62 }] }], { mesure: [4, 4] }));
  assert.deepEqual(midi.pistes.map((p) => p.fin), [32 * 120, 32 * 120]);
  // En 3/4 (12 pas par mesure) : la barre du pas 24.
  const valse = lireMidi(fichierMidi([{ nom: "Mélodie", notes: [{ d: 0, l: 14, h: 60 }] }], { mesure: [3, 4] }));
  assert.equal(valse.pistes[1].fin, 24 * 120);
  // Celui qui sait où finit l'idée le dit (une mesure de silence au bout, par exemple).
  assert.equal(lireMidi(fichierMidi([{ nom: "M", notes: [{ d: 0, l: 4, h: 60 }] }], { fin: 48 })).pistes[1].fin, 48 * 120);
});

test("une même note n'est jamais rejouée pendant qu'elle sonne : la première s'arrête juste avant", () => {
  // Deux do posés sur la grille qui se chevauchent, un mi de même début et de durées différentes.
  const midi = lireMidi(fichierMidi([{ nom: "M", notes: [{ d: 0, l: 8, h: 60 }, { d: 4, l: 8, h: 60 }, { d: 16, l: 4, h: 64 }, { d: 16, l: 8, h: 64 }] }]));
  assert.deepEqual(midi.pistes[1].notes.map((n) => n.slice(0, 3)), [[0, 480, 60], [480, 960, 60], [1920, 960, 64]]);
});

test("les changements de mesure et d'armure en cours de route, et les temps hors du pas (triolets)", () => {
  const midi = lireMidi(fichierMidi([{ nom: "M", notes: [{ d: 0, l: 4 / 3, h: 60 }, { d: 4 / 3, l: 4 / 3, h: 62 }, { d: 8 / 3, l: 4 / 3, h: 64 }, { d: 16, l: 12, h: 67 }] }], {
    mesure: [4, 4], quintes: 0, changements: [{ d: 16, mesure: [3, 4], quintes: 1, mineur: false }],
  }));
  const [conducteur, voix] = midi.pistes;
  assert.deepEqual(conducteur.mesures, [[0, 4, 4], [1920, 3, 4]]);
  assert.deepEqual(conducteur.armures, [[0, 0, 0], [1920, 1, 0]]);
  // Un triolet de croches : 160 tics chacune, exactement.
  assert.deepEqual(voix.notes.slice(0, 3).map((n) => n.slice(0, 2)), [[0, 160], [160, 160], [320, 160]]);
  // La fin suit la mesure en vigueur : la barre du 3/4 qui suit le pas 28.
  assert.equal(voix.fin, 28 * 120);
  // Mesure libre (M:none) : pas de chiffrage au début.
  assert.deepEqual(lireMidi(fichierMidi([{ nom: "M", notes: [{ d: 0, l: 4, h: 60 }] }], { mesure: null })).pistes[0].mesures, []);
});

test("une page lue : pistes nommées par main, sans piste vide, ses changements gardés", () => {
  // Deux mains : « Main droite », « Main gauche », et rien d'autre (abcjs ajoutait une piste vide, sans nom).
  const piano = lireMidi(midiDeLaPage("X:1\nM:4/4\nL:1/8\nQ:1/4=90\nK:C\n%%score {1 2}\nV:1 clef=treble\nV:2 clef=bass\n[V:1] GABc dcAG |\n[V:2] C,2 z2 G,,2 z2 ||\n", abcjs, { titre: "Page de piano" }));
  assert.deepEqual(piano.pistes.map((p) => p.nom), ["Page de piano", "Main droite", "Main gauche"]);
  assert.deepEqual(piano.pistes.map((p) => p.notes.length), [0, 8, 2]);
  // La page de mélodie : la gamme en mesure libre, puis mi♭ et 12/8 après une levée d'une croche.
  const melodie = lireMidi(midiDeLaPage("X:1\nM:none\nL:1/8\nQ:1/4=90\nK:C\nC2 D2 E2 F2 G2 A2 B2 c2\n[K:Eb][M:12/8]G |: c2 c2 edc g2 GG G :|\n", abcjs));
  const [conducteur, voix] = melodie.pistes;
  assert.equal(voix.nom, "Melodie");
  assert.deepEqual(conducteur.armures, [[0, 0, 0], [32 * 120, -3, 0]]);
  assert.deepEqual(conducteur.mesures, [[32 * 120, 1, 8], [34 * 120, 12, 8]], "la levée, puis le 12/8 à la barre");
  // Les notes à leur durée écrite, et la fin à la barre du 12/8.
  assert.deepEqual(voix.notes.slice(0, 2).map((n) => n.slice(0, 3)), [[0, 480, 60], [480, 480, 62]]);
  assert.equal((voix.fin - 34 * 120) % (24 * 120), 0);
  // Un triolet reste un triolet (160 tics la croche), la transposition et le tempo suivent les réglages.
  const triolet = lireMidi(midiDeLaPage("X:1\nM:2/4\nL:1/8\nQ:1/4=90\nK:C\n(3CDE G2|c4|]\n", abcjs, { tempo: 120, transposition: 2 }));
  assert.deepEqual(triolet.pistes[1].notes.slice(0, 3).map((n) => n.slice(0, 3)), [[0, 160, 62], [160, 160, 64], [320, 160, 66]]);
  assert.equal(triolet.pistes[0].meta.tempo, 120);
});

test("les textes en ASCII : accents, signes et guillemets", () => {
  assert.equal(texteMidi("Mélodie"), "Melodie");
  assert.equal(texteMidi("Basse des accords"), "Basse des accords");
  assert.equal(texteMidi("« Idée » — fa♯, si♭ ’n’ Œuvre"), '"Idee" - fa#, sib \'n\' OEuvre');
  assert.equal(texteMidi("Ça déménage 🎵"), "Ca demenage");
});

// --- Importer un .mid (N8) ------------------------------------------------------------

const notesDe = (piste) => piste.notes.map((n) => [n.d, n.l, n.h]);

test("aller-retour : ce que Portée écrit, Portée le relit à l'identique", () => {
  const voix = [
    { nom: "Mélodie", notes: [{ d: 0, l: 6, h: 67, v: 100 }, { d: 6, l: 2, h: 69 }, { d: 8, l: 4, h: 71 }, { d: 12, l: 12, h: 72 }] },
    { nom: "Basse", notes: [{ d: 0, l: 12, h: 36 }, { d: 12, l: 12, h: 43 }] },
  ];
  const { sequence: seq, ecartees } = ideeDepuisMidi(fichierMidi(voix, { tempo: 132, mesure: [6, 8], quintes: -3, mineur: true, titre: "Idée du matin" }));
  assert.deepEqual([seq.tempo, seq.mesure, seq.tonalite], [132, [6, 8], "Cm"]);
  assert.deepEqual(seq.pistes.map((p) => p.nom), ["Mélodie", "Basse"], "« Melodie » redevient « Mélodie »");
  assert.deepEqual(notesDe(seq.pistes[0]), [[0, 6, 67], [6, 2, 69], [8, 4, 71], [12, 12, 72]]);
  assert.deepEqual(notesDe(seq.pistes[1]), [[0, 12, 36], [12, 12, 43]]);
  assert.equal(seq.pistes[0].notes[0].v, 100);
  assert.equal(seq.pistes[1].cle, "fa", "une piste grave se lit en clé de fa");
  assert.deepEqual(ecartees, { pistes: 0, batterie: false });
  // Les identifiants suivent : on peut éditer l'idée tout de suite.
  assert.equal(new Set(seq.pistes.flatMap((p) => p.notes.map((n) => n.id))).size, 6);
  assert.ok(seq.suivant > 6);
});

/** Un fichier d'un autre logiciel, fabriqué octet par octet. */
function fichierEtranger() {
  const vlq = (n) => { const o = [n & 0x7f]; while ((n >>= 7)) o.unshift((n & 0x7f) | 0x80); return o; };
  const u32 = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 0xff);
  const nom = [..."Piano électrique"].map((c) => c.charCodeAt(0)); // en Latin-1, comme beaucoup de logiciels
  const ev = [
    0, 0xff, 0x03, nom.length, ...nom,
    0, 0xff, 0x51, 3, 0x09, 0x27, 0xc0,         // 600 000 µs la noire : 100 à la minute
    0, 0xff, 0x58, 4, 3, 2, 24, 8,              // 3/4
    0, 0xff, 0x59, 2, 2, 0,                     // ré majeur
    0, 0xf0, 5, 0x7e, 0x7f, 0x09, 0x01, 0xf7,   // un sysex (« GM on ») à sauter
    0, 0xc0, 0,                                 // programme
    0, 0xb0, 7, 100,                            // un contrôleur (volume)
    0, 0x90, 62, 80,                            // ré4
    ...vlq(48), 62, 0,                          // running status : note-on de vélocité 0 = note-off
    0, 66, 80,                                  // running status : fa♯4
    0, 0x99, 36, 100,                           // grosse caisse, canal 10
    ...vlq(24), 0x89, 36, 0,
    ...vlq(24), 0x90, 66, 0,
    0, 69, 80,                                  // la4
    ...vlq(96), 0x80, 69, 64,                   // un vrai note-off, avec sa vélocité de relâche
    0, 0xff, 0x2f, 0,
  ];
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, // format 0, une piste, 96 tics la noire
    0x58, 0x46, 0x49, 0x48, 0, 0, 0, 2, 1, 2,              // un bloc inconnu (« XFIH »), à sauter
    0x4d, 0x54, 0x72, 0x6b, ...u32(ev.length), ...ev,
  ]);
}

test("un fichier d'un autre logiciel : running status, note-on à vélocité 0, batterie à part", () => {
  const lu = lireFichierMidi(fichierEtranger());
  assert.equal(lu.format, 0);
  assert.equal(lu.ppq, 96);
  assert.equal(lu.pistes[0].nom, "Piano électrique");
  // Ce que mido lit de ce même fichier (vérifié) : à temps égal, la plus grave d'abord.
  assert.deepEqual(lu.pistes[0].notes.map((n) => [n.t, n.fin, n.h, n.canal]), [[0, 48, 62, 0], [48, 72, 36, 9], [48, 96, 66, 0], [96, 192, 69, 0]]);
  const { sequence: seq, ecartees } = ideeDepuisMidi(fichierEtranger());
  assert.deepEqual([seq.tempo, seq.mesure, seq.tonalite], [100, [3, 4], "D"]);
  assert.equal(seq.pistes.length, 1);
  assert.equal(seq.pistes[0].nom, "Piano électrique");
  // 96 tics la noire : 24 par pas.
  assert.deepEqual(notesDe(seq.pistes[0]), [[0, 2, 62], [2, 2, 66], [4, 4, 69]]);
  assert.equal(ecartees.batterie, true);
});

test("importer : au plus quatre pistes, l'arrondi du jeu en direct, et des erreurs claires", () => {
  // Six pistes : les quatre premières qui jouent sont gardées, les autres comptées.
  const six = Array.from({ length: 6 }, (_, i) => ({ nom: `P${i}`, notes: [{ d: 0, l: 4, h: 60 + i }] }));
  const { sequence: seq, ecartees } = ideeDepuisMidi(fichierMidi([{ nom: "Vide", notes: [] }, ...six]));
  assert.deepEqual(seq.pistes.map((p) => p.nom), ["P0", "P1", "P2", "P3"]);
  assert.equal(ecartees.pistes, 2);
  // Un jeu humain (un peu à côté) se recale au pas, avec le jeu lié du direct.
  const humain = fichierMidi([{ nom: "M", notes: [{ d: 0.3, l: 3.4, h: 60 }, { d: 4.2, l: 3.5, h: 62 }, { d: 7.9, l: 4, h: 64 }] }]);
  assert.deepEqual(notesDe(ideeDepuisMidi(humain).sequence.pistes[0]), [[0, 4, 60], [4, 4, 62], [8, 4, 64]]);
  // Sans tempo, mesure ni armure : 120, 4/4, do (les valeurs du MIDI).
  const nu = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12, 0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0]);
  const vide = ideeDepuisMidi(nu).sequence;
  assert.deepEqual([vide.tempo, vide.mesure, vide.tonalite, vide.pistes[0].nom], [120, [4, 4], "C", "Mélodie"]);
  assert.deepEqual(notesDe(vide.pistes[0]), [[0, 4, 60]]);
  assert.throws(() => lireFichierMidi(new TextEncoder().encode("%PDF-1.7 pas un MIDI")), /pas un fichier MIDI/);
  assert.throws(() => lireFichierMidi(new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0xe7, 0x28])), /SMPTE/);
});
